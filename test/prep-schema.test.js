// #19 AC1 and AC4 — the vocabulary is closed, and nothing in it can carry an answer or a score.
//
// Portal architecture §3 says the component vocabulary IS the safety rail: "there *is no*
// component that renders a finished answer in the candidate's voice, and no component that
// renders a score or rank. The locked rules stop being prompt instructions and become
// structural." A sentence like that is only true if something fails when it stops being true.
//
// Three groups below, in increasing order of how easily they rot:
//
//   1. assertBrief rejects each vocabulary breach — the enforcement the AC can actually reach,
//      since BRIEF_SCHEMA's const/enum are enforced by Anthropic's decoder at request time.
//   2. a walk over BRIEF_SCHEMA asserting no property is answer- or score-shaped.
//   3. the walker's OWN coverage, because a branch the walker cannot read is invisible to
//      group 2 rather than a failure of it — the lesson of test/schema.test.js:84-112.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BLOCK_NAMES,
  BRIEF_SCHEMA,
  CONCERNS_SCHEMA,
  assertBrief,
  foldConcerns,
} from "../src/prep/schema.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(readFileSync(join(here, "fixtures/prep-payload.json"), "utf8"));

/** A deep copy of the fixture, so a mutation case cannot leak into the next test. */
const payload = () => structuredClone(FIXTURE);

/** The message a call throws, or "did not throw". assertBrief throws plain Errors, not StoreErrors. */
function messageOf(fn) {
  try {
    fn();
    return "did not throw";
  } catch (err) {
    assert.ok(!("code" in err), "a shape bug is a plain Error, not a StoreError with an HTTP status");
    return err.message;
  }
}

/* ── group 1: the vocabulary, enforced independently of the decoder ─────────────────────── */

test("the fixture payload is a valid brief, so every rejection below is about the mutation", () => {
  const p = payload();
  assert.equal(assertBrief(p), p, "assertBrief returns the payload it was given");
});

test("a block name outside the vocabulary is rejected, at the top level and inside children", () => {
  const top = payload();
  top.blocks[0].name = "ModelAnswerCard";
  assert.match(
    messageOf(() => assertBrief(top)),
    /blocks\[0\]\.name is ModelAnswerCard, which is not in the vocabulary/,
  );

  // The nested case is the one a shape check misses. #21 builds its registry from BLOCK_NAMES,
  // so a sixth name renders as nothing at all rather than as an error.
  const nested = payload();
  nested.blocks[1].children[0].name = "AnswerCard";
  assert.match(
    messageOf(() => assertBrief(nested)),
    /blocks\[1\]\.children\[0\]\.name is AnswerCard/,
  );
});

test("children on a block that does not nest is rejected", () => {
  // Only CompetencyMap nests. The schema is non-recursive by construction; this is the runtime
  // half of that, and without it a leaf could grow a tree the renderer never walks.
  const p = payload();
  p.blocks[0].children = [];
  assert.match(messageOf(() => assertBrief(p)), /blocks\[0\]\.children on a PrimerCard/);

  const deep = payload();
  deep.blocks[1].children[0] = { name: "CompetencyMap", props: { intro: "", competency_ids: [] }, children: [] };
  assert.match(messageOf(() => assertBrief(deep)), /nested inside children/);
});

test("a child that is in the vocabulary but is not a StoryBankCard is rejected", () => {
  // The gap a CompetencyMap-only nesting guard leaves. `children.items` is a single $ref to
  // StoryBankCard, so the decoder cannot emit this — but assertBrief exists precisely because a
  // rule living only in the schema is an untested claim about a third party's decoder, and the
  // payload does not always arrive from it (the script's re-verify path, #22 re-verifying a
  // stored payload). A PanelBrief that lands in here carries source attributions that
  // verifyBrief never descends to check, and #21 renders it happily — attribution and all.
  for (const name of BLOCK_NAMES.filter((n) => n !== "StoryBankCard")) {
    const p = payload();
    p.blocks[1].children[0] = { name, props: {} };
    assert.match(
      messageOf(() => assertBrief(p)),
      new RegExp(`blocks\\[1\\]\\.children\\[0\\] is a ${name} nested inside children`),
      `a nested ${name} must be rejected`,
    );
  }
});

test("a PanelBrief whose panel is not an array is rejected", () => {
  // verifyBrief:55 reaches the note half of §3 through `props.panel` and returns the block
  // untouched when it is not an array — so without this the provenance check is SKIPPED rather
  // than failed, which is the version of the failure nobody sees.
  const p = payload();
  const i = p.blocks.findIndex((b) => b.name === "PanelBrief");
  assert.ok(i > -1, "the fixture must carry a PanelBrief for this to test anything");

  p.blocks[i].props.panel = { who: "a lone object, not a list" };
  assert.match(messageOf(() => assertBrief(p)), new RegExp(`blocks\\[${i}\\]\\.props\\.panel`));

  const missing = payload();
  delete missing.blocks[i].props.panel;
  assert.match(messageOf(() => assertBrief(missing)), /props\.panel must be an array/);
});

test("a competency with an empty or missing source_quote is rejected", () => {
  // The brief half of architecture §3 rests entirely on this quote existing. A competency with
  // no quote is not an unverified competency — it is one with no provenance mechanism at all.
  const empty = payload();
  empty.competencies[0].source_quote = "   ";
  assert.match(messageOf(() => assertBrief(empty)), /competencies\[0\]\.source_quote is empty/);

  const missing = payload();
  delete missing.competencies[1].source_quote;
  assert.match(messageOf(() => assertBrief(missing)), /competencies\[1\]\.source_quote is empty/);
});

test("two competencies sharing an id are rejected", () => {
  // The ids are MODEL-CHOSEN SLUGS, and nothing in BRIEF_SCHEMA can say "unique" — structured
  // outputs reject the constraint vocabulary that would. Downstream, `${roleId}:${competency.id}`
  // meets `competency.id TEXT PRIMARY KEY` (src/portal/store.js:195) and the second INSERT throws
  // a raw ERR_SQLITE_ERROR: a 500 for a model output problem, on a send the recruiter has
  // already paid for. The strike is wrong too — src/prep/strike.js filters by id, so unticking
  // one of a pair removes both.
  // The realistic shape, and the one no other guard can see: the model emits the same slug
  // twice. Every reference still resolves — the id exists, twice — and both copies carry a
  // quote, so without this check the payload is valid all the way to the constraint.
  const duped = payload();
  duped.competencies.push({ ...duped.competencies[2] });
  assert.match(
    messageOf(() => assertBrief(duped)),
    /competencies\[3\]\.id is comp-documentation, which is already taken/,
  );

  // Uniqueness is checked BEFORE references resolve, so the other form — a rename that also
  // strands the questions pointing at the old id — is still reported as the duplicate it is
  // rather than as a dangling reference two guards later, which would send the reader to the
  // wrong half of the payload.
  const renamed = payload();
  renamed.competencies[1].id = renamed.competencies[0].id;
  assert.match(messageOf(() => assertBrief(renamed)), /competencies\[1\]\.id is .* already taken/);
});

test("a dangling competency reference is rejected wherever it appears", () => {
  // A dangling id renders as a hole in #21's registry, and nothing downstream catches it.
  const q = payload();
  q.questions[0].competency_id = "comp-nonexistent";
  assert.match(messageOf(() => assertBrief(q)), /questions\[0\]\.competency_id is comp-nonexistent/);

  const map = payload();
  map.blocks[1].props.competency_ids.push("comp-invented");
  assert.match(
    messageOf(() => assertBrief(map)),
    /blocks\[1\]\.props\.competency_ids\[3\] is comp-invented/,
  );

  const story = payload();
  story.blocks[1].children[0].props.covers_competency_ids = ["comp-invented"];
  assert.match(
    messageOf(() => assertBrief(story)),
    /blocks\[1\]\.children\[0\]\.props\.covers_competency_ids\[0\] is comp-invented/,
  );
});

test("a competency with zero questions is rejected", () => {
  // The ticket mints the core bank PER COMPETENCY. A competency with no questions passes every
  // shape check, passes the script's sendable gate, and hands #23 something it cannot drill.
  const p = payload();
  p.questions = p.questions.filter((q) => q.competency_id !== "comp-documentation");
  assert.match(messageOf(() => assertBrief(p)), /comp-documentation\) has no questions/);
});

test("a question outside the core axis is rejected, because this call mints the core bank", () => {
  // Decision 6: lateral and vertical variation is #23's session engine, on claude-sonnet-5. The
  // schema keeps the full vocabulary so #23 writes into the same column; assertBrief keeps THIS
  // call to what decision 6 gives it.
  const p = payload();
  p.questions[2].axis = "lateral";
  assert.match(messageOf(() => assertBrief(p)), /questions\[2\]\.axis is lateral/);
});

test("a difficulty outside the enum is rejected", () => {
  const p = payload();
  p.questions[1].difficulty = "brutal";
  assert.match(messageOf(() => assertBrief(p)), /questions\[1\]\.difficulty is brutal/);
});

test("a question type outside the enum is rejected; a valid or absent one passes", () => {
  // #50, on #49's A3 rule: a present value is checked against the enum, and #79 added a fourth.
  // The indices are chosen rather than arbitrary — the fixture's concern questions carry the
  // pairing every LikelyConcerns entry depends on, so retyping one is not a type test, it is
  // the pairing rule firing. Its own test is below.
  const valid = payload();
  valid.questions[0].type = "client";
  valid.questions[1].type = "competency";
  valid.questions[3].type = "screening";
  assert.doesNotThrow(() => assertBrief(valid));

  const invalid = payload();
  invalid.questions[1].type = "clinical";
  assert.match(messageOf(() => assertBrief(invalid)), /questions\[1\]\.type is clinical/);

  // Absence is still tolerated: stored pre-#50 payloads re-assert on every brief read, and the
  // source fixture no longer supplies that case by accident (#79 typed every question).
  const untyped = payload();
  untyped.questions.forEach((q) => {
    if (q.type !== "concern") delete q.type;
  });
  assert.doesNotThrow(() => assertBrief(untyped));
});

test("a FirstDayPrimer with items renders as a valid brief; a non-array items is rejected", () => {
  const p = payload();
  p.blocks.push({
    name: "FirstDayPrimer",
    props: {
      intro: "What we know about day one.",
      items: [
        { topic: "Getting in", detail: "Report to the imaging reception.", source_field_key: "their-process" },
      ],
    },
  });
  assert.doesNotThrow(() => assertBrief(p));

  const bad = payload();
  bad.blocks.push({ name: "FirstDayPrimer", props: { intro: "x", items: "not a list" } });
  const i = bad.blocks.length - 1;
  assert.match(
    messageOf(() => assertBrief(bad)),
    new RegExp(`blocks\\[${i}\\]\\.props\\.items must be an array`),
  );
});

/* ── #79: the two new blocks and the concern↔question pairing ───────────────────────────── */

/** The three the FIRST call must never be asked for — a sixth branch is a live outage. */
const SECOND_CALL = ["FirstDayPrimer", "LikelyConcerns", "QuestionsToAsk"];

test("the vocabulary is eight names; FIVE come from a decoder and three from foldConcerns", () => {
  // MEASURED against the live API at the parameters this product sends: under
  // `thinking: adaptive`, five block branches compile and SIX do not. #50 shipped a sixth
  // (FirstDayPrimer) and every prep Send 400'd until it was moved to the second call. So the
  // vocabulary a payload may USE (eight) and the vocabulary one request may ASK FOR (five)
  // stopped being the same list, and this is where that stays honest.
  assert.equal(BLOCK_NAMES.length, 8, "#79 took decision 22's six to eight");

  const minted = BRIEF_SCHEMA.properties.blocks.items.anyOf.map((b) => b.properties.name.const);
  assert.equal(minted.length, 5, "five compiles; six is the 400 that took production down");
  assert.deepEqual(
    minted.sort(),
    BLOCK_NAMES.filter((n) => !SECOND_CALL.includes(n)).sort(),
    "a name with no def is a name the decoder can never emit; a def with no name is dead weight",
  );
  for (const name of SECOND_CALL) {
    assert.ok(
      !minted.includes(name),
      `${name} back in the anyOf is a 400 — the whole request dies, not just the block`,
    );
  }
});

test("foldConcerns mints the other two names, by literal, and pairs every concern", () => {
  // The second call carries no block `name` at all: the names are written here, in code, so a
  // decoder cannot mint a ninth one. This is the assertion that the folded shape is the same
  // shape `assertBrief` and the registry already expect.
  const p = payload();
  p.blocks = p.blocks.filter((b) => b.name !== "LikelyConcerns" && b.name !== "QuestionsToAsk");
  p.questions = p.questions.filter((q) => q.type !== "concern");

  const folded = foldConcerns(p, {
    concerns_intro: "Two things they will test.",
    concerns: [
      { concern: "You came from a ward.", competency_id: "comp-lone-working", evidence_quote: "x" },
    ],
    concern_questions: [
      { competency_id: "comp-lone-working", text: "What makes you different?" },
    ],
    questions_intro: "A few worth asking.",
    questions_to_ask: ["How is the caseload split?"],
  });

  const concerns = folded.blocks.find((b) => b.name === "LikelyConcerns");
  const asks = folded.blocks.find((b) => b.name === "QuestionsToAsk");
  assert.ok(concerns && asks, "both names were minted");
  assert.equal(concerns.props.intro, "Two things they will test.");
  assert.deepEqual(asks.props.questions, ["How is the caseload split?"]);

  const minted = folded.questions.find((q) => q.type === "concern");
  assert.deepEqual(minted, {
    competency_id: "comp-lone-working",
    text: "What makes you different?",
    axis: "core",
    // NOT asked for — minted here, because a counter must not be the first question served on a
    // competency. targeting.js:158-163 serves the EASIEST unattempted core question, and a
    // concern question is a core question.
    difficulty: "probing",
    type: "concern",
  });

  assert.equal(assertBrief(folded), folded, "and the folded payload is an ordinary valid brief");
  assert.deepEqual(p.blocks.length, folded.blocks.length - 2, "the input was not mutated");
});

test("foldConcerns adds no empty block, and tolerates a missing half", () => {
  // "An empty block is worse than an absent one" is BRIEF_SCHEMA's own rule, and it applies to a
  // block we assemble ourselves. A degraded second call reaches here as null.
  const p = payload();
  p.blocks = p.blocks.filter((b) => b.name !== "LikelyConcerns" && b.name !== "QuestionsToAsk");
  p.questions = p.questions.filter((q) => q.type !== "concern");
  const before = p.blocks.length;

  for (const extra of [null, undefined, {}, { concerns: [], questions_to_ask: [] }]) {
    const folded = foldConcerns(p, extra);
    assert.equal(folded.blocks.length, before, `${JSON.stringify(extra)} minted a block`);
    assert.doesNotThrow(() => assertBrief(folded));
  }

  // Concerns without questions-to-ask, and the reverse: each half stands alone.
  const onlyAsks = foldConcerns(p, { questions_intro: "i", questions_to_ask: ["q?"] });
  assert.equal(onlyAsks.blocks.filter((b) => b.name === "QuestionsToAsk").length, 1);
  assert.equal(onlyAsks.blocks.filter((b) => b.name === "LikelyConcerns").length, 0);
  assert.doesNotThrow(() => assertBrief(onlyAsks));
});

test("a concern naming no competency is rejected, and the message says which id", () => {
  const p = payload();
  const block = p.blocks.find((b) => b.name === "LikelyConcerns");
  const i = p.blocks.indexOf(block);
  block.props.concerns[0].competency_id = "comp-invented";
  assert.match(
    messageOf(() => assertBrief(p)),
    new RegExp(`blocks\\[${i}\\]\\.props\\.concerns\\[0\\] is comp-invented, which is no competency`),
  );
});

test("a non-array concerns, and a non-array questions on QuestionsToAsk, are both rejected", () => {
  // The same reason PanelBrief.panel and FirstDayPrimer.items are checked here: verifyBrief
  // reaches the CV haystack through this array and skips SILENTLY when it is not one. A skipped
  // provenance check is the failure nobody sees.
  const concerns = payload();
  const ci = concerns.blocks.findIndex((b) => b.name === "LikelyConcerns");
  concerns.blocks[ci].props.concerns = "not a list";
  assert.match(
    messageOf(() => assertBrief(concerns)),
    new RegExp(`blocks\\[${ci}\\]\\.props\\.concerns must be an array`),
  );

  const asks = payload();
  const ai = asks.blocks.findIndex((b) => b.name === "QuestionsToAsk");
  asks.blocks[ai].props.questions = { 0: "not a list" };
  assert.match(
    messageOf(() => assertBrief(asks)),
    new RegExp(`blocks\\[${ai}\\]\\.props\\.questions must be an array`),
  );
});

test("neither new block nests, at the top level or inside children", () => {
  for (const name of ["LikelyConcerns", "QuestionsToAsk"]) {
    const p = payload();
    const i = p.blocks.findIndex((b) => b.name === name);
    p.blocks[i].children = [];
    assert.match(
      messageOf(() => assertBrief(p)),
      new RegExp(`blocks\\[${i}\\]\\.children on a ${name}, which does not nest`),
      `${name} took children`,
    );

    const nested = payload();
    nested.blocks[1].children.push(structuredClone(nested.blocks[i]));
    const j = nested.blocks[1].children.length - 1;
    assert.match(
      messageOf(() => assertBrief(nested)),
      new RegExp(`blocks\\[1\\]\\.children\\[${j}\\] is a ${name} nested inside children`),
      `${name} was smuggled into a CompetencyMap`,
    );
  }
});

test("a concern with no concern question under its competency is rejected", () => {
  // AC2's structural half. `type` is the only thing that tags a counter — the D1 question table
  // is type-free by decision (test/prep-send.test.js:279) — so the tag is checked here or
  // nowhere, and a named objection with nothing to drill is what gets through if it is not.
  const p = payload();
  const block = p.blocks.find((b) => b.name === "LikelyConcerns");
  const i = p.blocks.indexOf(block);
  const orphan = block.props.concerns[0].competency_id;
  for (const q of p.questions) {
    if (q.competency_id === orphan && q.type === "concern") q.type = "competency";
  }
  assert.match(
    messageOf(() => assertBrief(p)),
    new RegExp(`blocks\\[${i}\\]\\.props\\.concerns\\[0\\] \\(${orphan}\\) has no concern question`),
  );

  // And the same payload WITH the pairing passes, so the rule is about the pairing rather than
  // about the block being present at all.
  assert.doesNotThrow(() => assertBrief(payload()));
});

test("a concern question is not itself enough — it has to be under the concern's competency", () => {
  // The near-miss: the model tags a counter, but against a different competency. Every shape
  // check passes and the concern is still undrillable.
  const p = payload();
  const block = p.blocks.find((b) => b.name === "LikelyConcerns");
  const target = block.props.concerns[0].competency_id;
  const elsewhere = p.competencies.find((c) => c.id !== target).id;
  for (const q of p.questions) {
    if (q.competency_id === target && q.type === "concern") q.competency_id = elsewhere;
  }
  assert.match(messageOf(() => assertBrief(p)), /has no concern question/);
});

test("foldConcerns mints FirstDayPrimer on EMPTINESS alone — it never reads engagement", () => {
  // CHARACTERISATION, not an endorsement. CONCERNS_SCHEMA's note used to claim "emit this block
  // only for a locum booking" survived the move to the second call "as a rule about the FOLD".
  // It did not (PR #89 review, F17): the fold's only rule is emptiness, and "locum only" is a
  // prompt instruction in `concernsTaskBlock`'s branch — exactly as it was before the move.
  //
  // So this pins what the code ACTUALLY does, in both directions, because the comment alone had
  // already drifted once. If a model ever fills `first_day_items` for a permanent role, the block
  // ships; the prompt is the only thing saying it shouldn't. Making that structural is a
  // behaviour change with its own question behind it — a misclassified locum would silently lose
  // a good primer — so it is left as it is, and left VISIBLE here rather than asserted in prose.
  const base = () => {
    const p = payload();
    p.blocks = p.blocks.filter((b) => !["LikelyConcerns", "QuestionsToAsk"].includes(b.name));
    p.questions = p.questions.filter((q) => q.type !== "concern");
    return p;
  };
  const items = [{ item: "Ask at the desk for a badge", source_field_key: "getting-in" }];

  // Non-empty mints the block. `foldConcerns` takes no engagement argument at all, so there is
  // no branch to exercise — that IS the finding.
  const filled = foldConcerns(base(), { first_day_intro: "Day one.", first_day_items: items });
  const primer = filled.blocks.find((b) => b.name === "FirstDayPrimer");
  assert.ok(primer, "a non-empty list mints the block, whatever the engagement");
  assert.deepEqual(primer.props.items, items);

  // Empty mints nothing — the half that IS structural, and the half the locum rule leans on.
  for (const extra of [{ first_day_items: [] }, { first_day_items: null }, {}]) {
    const folded = foldConcerns(base(), { first_day_intro: "Day one.", ...extra });
    assert.ok(
      !folded.blocks.some((b) => b.name === "FirstDayPrimer"),
      `${JSON.stringify(extra)} minted an empty block, which is worse than an absent one`,
    );
  }
});

test("a competency whose ONLY question is its own counter is rejected", () => {
  // THE PRODUCT REGRESSION #79 OPENED. `assertBrief` runs only AFTER the fold, so call one's bank
  // is never inspected on its own — and a counter counted toward "every competency has questions"
  // would let a first call that skipped a competency ship anyway. `nextQuestion` then serves the
  // easiest unattempted core question, and if the only one is the counter (always "probing"),
  // the candidate's FIRST question on that competency is "how would you answer, never having
  // done this?" — the exact thing test/prep-targeting.test.js calls the one regression nothing
  // else would catch. Before #79 this same call-one output threw `has no questions`. It has to
  // keep throwing.
  const p = payload();
  const block = p.blocks.find((b) => b.name === "LikelyConcerns");
  const drilled = block.props.concerns[0].competency_id;

  // Everything ordinary for that competency removed; the counter left in place, so the pairing
  // rule above is still satisfied and this rule is the only one that can fire.
  p.questions = p.questions.filter((q) => q.competency_id !== drilled || q.type === "concern");
  assert.ok(
    p.questions.some((q) => q.competency_id === drilled && q.type === "concern"),
    "the counter has to survive, or this tests the wrong rule",
  );

  assert.match(
    messageOf(() => assertBrief(p)),
    new RegExp(`\\(${drilled}\\) has no questions of its own`),
  );
});

test("foldConcerns drops a counter no concern names, rather than folding an orphan", () => {
  // `competency_id` is a free string on CONCERNS_SCHEMA — structured outputs cannot express "an
  // id from that other array" — and `minItems` is rejected, so the two lists cannot be paired by
  // length either. This fold is the only place they meet. A counter to an objection the brief
  // never shows is a "probing" question the candidate cannot place; dropped, they lose nothing
  // they were ever told about.
  const p = payload();
  p.blocks = p.blocks.filter((b) => b.name !== "LikelyConcerns" && b.name !== "QuestionsToAsk");
  p.questions = p.questions.filter((q) => q.type !== "concern");

  const folded = foldConcerns(p, {
    concerns_intro: "One thing they will test.",
    concerns: [
      { concern: "You came from a ward.", competency_id: "comp-lone-working", evidence_quote: "x" },
    ],
    concern_questions: [
      { competency_id: "comp-lone-working", text: "What makes you different?" },
      // Valid against CONCERNS_SCHEMA, and an orphan: no concern sits under this id.
      { competency_id: "comp-documentation", text: "How do you keep records under pressure?" },
    ],
    questions_intro: "A few worth asking.",
    questions_to_ask: ["How is the caseload split?"],
  });

  const counters = folded.questions.filter((q) => q.type === "concern");
  assert.deepEqual(
    counters.map((q) => q.competency_id),
    ["comp-lone-working"],
    "the orphan was folded in",
  );
  assert.doesNotThrow(() => assertBrief(folded));
});

test("an orphan counter that reaches assertBrief anyway is rejected", () => {
  // The fold filters these at the mint and BRIEF_SCHEMA's `type` enum no longer offers the value,
  // so this is the backstop for a stored payload or a future minting path. assertBrief is the
  // contract; the fold is one of its callers.
  const p = payload();
  const block = p.blocks.find((b) => b.name === "LikelyConcerns");
  const named = new Set(block.props.concerns.map((c) => c.competency_id));
  const unnamed = p.competencies.find((c) => !named.has(c.id));
  assert.ok(unnamed, "the fixture needs a competency with no concern for this to mean anything");

  p.questions.push({
    competency_id: unnamed.id,
    text: "How would you answer, never having done this?",
    axis: "core",
    difficulty: "probing",
    type: "concern",
  });

  assert.match(
    messageOf(() => assertBrief(p)),
    new RegExp(`counters ${unnamed.id}, which no concern names`),
  );
});

test("#79: a pre-#79 stored payload still asserts — the regression that matters most", () => {
  // Every stored brief re-asserts on EVERY candidate page load
  // (functions/prep/api/brief.js:49, where a throw is a 502 on a page the candidate can do
  // nothing about). A brief minted before this ticket carries neither new block and no `type`
  // on any question. Both have to stay tolerated, and after #79 the source fixture no longer
  // supplies that shape by accident — so it is made here, deliberately, and asserted by name.
  const p = payload();
  p.blocks = p.blocks.filter((b) => b.name !== "LikelyConcerns" && b.name !== "QuestionsToAsk");
  p.questions = p.questions.filter((q) => q.type !== "concern");
  p.questions.forEach((q) => {
    delete q.type;
  });

  assert.ok(!p.blocks.some((b) => b.name === "LikelyConcerns"), "no concerns block, as before #79");
  assert.ok(p.questions.every((q) => q.type === undefined), "and no question carries a type");
  assert.ok(p.competencies.length === 3 && p.blocks.length === 5, "and it is still a whole brief");
  assert.equal(assertBrief(p), p, "a payload sent before today keeps loading");

  // The pairing rule is VACUOUS here rather than merely satisfied: there is no LikelyConcerns
  // block to pair against, which is why a payload with no concern question at all passes.
  assert.ok(!p.questions.some((q) => q.type === "concern"), "and nothing was quietly re-tagged");
});

test("a source_field_key outside the visible slice is NOT a shape error", () => {
  // It is a provenance failure, and provenance failures demote rather than throw
  // (provenance.js:62). A model that writes `their-processes` for `their-process` must not kill
  // a Send a recruiter is standing in front of. src/prep/verify.js is where it is caught.
  const p = payload();
  p.blocks[2].props.panel[0].source_field_key = "invented-key";
  assert.doesNotThrow(() => assertBrief(p));
});

/* ── group 2: no block can carry an answer or a score ───────────────────────────────────── */

/**
 * Every property name in BRIEF_SCHEMA, and every block `name` const the walk could read.
 *
 * Returned rather than asserted in place so group 3 can check what this walk actually reached.
 * `$ref` nodes are not resolved: a $ref carries no `name.const` and no properties of its own,
 * and the def it points at is walked in its own right under $defs.
 */
function walk(schema) {
  const propertyNames = [];
  const blockNames = new Set();
  const defsVisited = new Set();

  const visit = (node, path) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((n, i) => visit(n, `${path}[${i}]`));
      return;
    }
    if (path.startsWith("$defs.")) defsVisited.add(path.split(".")[1]);
    if (node.properties?.name?.const) blockNames.add(node.properties.name.const);

    for (const [key, value] of Object.entries(node.properties ?? {})) {
      propertyNames.push({ name: key, path: `${path}.properties.${key}` });
      visit(value, `${path}.properties.${key}`);
    }
    for (const [key, value] of Object.entries(node.$defs ?? {})) visit(value, `$defs.${key}`);
    if (node.items) visit(node.items, `${path}.items`);
    for (const branch of ["anyOf", "allOf", "oneOf"]) {
      (node[branch] ?? []).forEach((n, i) => visit(n, `${path}.${branch}[${i}]`));
    }
  };

  visit(schema, "$");
  return { propertyNames, blockNames, defsVisited };
}

/**
 * BOTH contracts the model fills, walked as one.
 *
 * #79 split the request in two — BRIEF_SCHEMA hit Claude Opus 5's grammar ceiling, so the likely
 * concerns and the questions to ask are asked for by CONCERNS_SCHEMA and folded into `blocks`
 * afterwards. A walk over BRIEF_SCHEMA alone would therefore stop covering two of the eight
 * blocks in the vocabulary, and group 3's whole argument is that an unwalked branch is INVISIBLE
 * to the assertion above rather than a failure of it. Adding a schema the model fills means
 * adding it here, in the same commit.
 */
const walkAll = (...schemas) => {
  const walks = schemas.map(walk);
  return {
    propertyNames: walks.flatMap((w) => w.propertyNames),
    blockNames: new Set(walks.flatMap((w) => [...w.blockNames])),
    defsVisited: new Set(walks.flatMap((w) => [...w.defsVisited])),
  };
};

const WALKED = walkAll(BRIEF_SCHEMA, CONCERNS_SCHEMA);

test("no property in the contract is answer-shaped or score-shaped", () => {
  // `importance` is deliberately absent from this pattern. It is the importance of a COMPETENCY
  // TO THE ROLE — a property of the job, extracted from the brief — and it lives on
  // `competencies`, never on a block. It is not a rating of the candidate. Do not widen the
  // regex to include it; that fails a correct file and teaches the next reader to delete the test.
  const forbidden = /answer|score|rank|rating|grade|readiness|success_rate|verdict|percentile/i;

  for (const { name, path } of WALKED.propertyNames) {
    assert.ok(
      !forbidden.test(name),
      `${path} is named "${name}". Architecture §3: there *is no* component that renders a ` +
        "finished answer in the candidate's voice, and no component that renders a score or " +
        "rank — that is what makes the locked rules structural rather than prompt instructions. " +
        "A property with this name gives the model somewhere to put one. If the epic genuinely " +
        "needs it, that is a decision to make in the open, not a regex to loosen.",
    );
  }
});

test("the skeleton prop says, in the schema itself, that it is headings and not sentences", () => {
  // SPEC's first non-negotiable, and the one failure a passing test suite cannot catch — a
  // skeleton entry that is a sentence in the candidate's voice is well-formed JSON. The live
  // probe found this `description` alone was enough to produce headings; it is load-bearing
  // prompt text sitting inside the schema, exactly as pack.js:20-24 is.
  const skeleton = BRIEF_SCHEMA.$defs.StoryBankCard.properties.props.properties.skeleton;
  assert.match(skeleton.description, /HEADINGS THE CANDIDATE FILLS IN/);
  assert.match(skeleton.description, /never sentences in the candidate's voice/);
});

/* ── group 3: the walker's own blind spots, which are failures and not silence ───────────── */

test("the walker reached every block variant a DECODER can mint", () => {
  // Five, not eight, and CALL_ONE_BLOCK_NAMES says why: a sixth `anyOf` branch is a 400 under
  // the thinking mode this product sends. The other three are minted in code by `foldConcerns`
  // — asserted below, which is the part of the vocabulary this walk structurally cannot see.
  assert.deepEqual(
    [...WALKED.blockNames].sort(),
    BLOCK_NAMES.filter((n) => !SECOND_CALL.includes(n)).sort(),
    "a variant the walker could not read is invisible to the assertion above, not a failure of " +
      "it — a `props.model_answer` added inside an unwalked anyOf branch would sail through the " +
      "test that exists to defend the epic's hardest non-negotiable. If the schema grew a " +
      "construct this walker does not handle ($ref indirection, a nested oneOf, a variant behind " +
      "a conditional), teach the walker that construct — do not delete this check.",
  );
});

test("the walker reached every $defs entry", () => {
  assert.deepEqual(
    [...WALKED.defsVisited].sort(),
    Object.keys(BRIEF_SCHEMA.$defs).sort(),
    "$defs is exactly where a depth-limited schema hides its leaves, and a def the walker never " +
      "entered contributes no property names to the assertion above.",
  );
});

test("the walker read a meaningful number of properties, not zero", () => {
  // The degenerate pass: a walker that returns [] satisfies "no property is answer-shaped"
  // perfectly. Silence that looks identical to compliance.
  assert.ok(
    WALKED.propertyNames.length > 25,
    `the walk found ${WALKED.propertyNames.length} properties, which is too few for this ` +
      "contract — an empty or near-empty walk passes the forbidden-name assertion vacuously",
  );
});
