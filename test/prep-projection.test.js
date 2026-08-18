// #22 — what leaves the building for a candidate, and what does not (R6).
//
// The class of failure this file catches is the one the issue named: the page renders
// correctly while the RESPONSE carries the model's failed guesses and an importance score.
// public/prep/registry.js is careful never to print `failed_quote`; a response body walks
// straight past that care, and View Source is one keystroke.
//
// So the central assertions are over the SERIALISED projection, not over the rendered tree —
// a grep of what actually goes on the wire. Each one is paired with a structural assertion,
// because a document-wide substring grep can fail while the code is right (a block prop could
// legitimately be called `questions` one day) and a gate that cries wolf gets deleted.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { candidateProjection } from "../src/prep/projection.js";
import { assertBrief } from "../src/prep/schema.js";
import { verifyBrief } from "../src/prep/verify.js";
import { renderBlocks } from "../public/prep/registry.js";
import { fakeDocument, serialize } from "./helpers/dom.js";

const here = dirname(fileURLToPath(import.meta.url));

/** The shipped fixture: already verified, and already carrying one demoted competency. */
const shipped = () =>
  JSON.parse(readFileSync(join(here, "..", "public", "prep", "brief.fixture.json"), "utf8"));

/**
 * #19's raw payload, put through verifyBrief against a brief that does NOT contain the third
 * competency's quote, a field-key list that does not contain the panel's keys, and (#79) no CV
 * at all — so the result carries a demoted competency, a demoted panel entry AND a demoted
 * concern, which is the set the fixture alone cannot give.
 */
function demoted() {
  const raw = JSON.parse(readFileSync(join(here, "fixtures", "prep-payload.json"), "utf8"));
  const brief = readFileSync(join(here, "fixtures", "prep-brief.md"), "utf8");
  // No field keys at all: every panel entry demotes, which is the "recruiter shared nothing"
  // case from the plan's edge list. The empty CV is the same move for #79's concerns, and it is
  // deliberate here rather than an omission of the new argument: a demoted concern is what this
  // file needs to prove `failed_evidence_quote` never reaches the wire.
  return verifyBrief(assertBrief(raw), { brief, cv: "", fieldKeys: [] });
}

test("the fixtures are the shape these tests claim to exercise", () => {
  const fixture = shipped();
  assert.ok(
    fixture.competencies.some((c) => c.verified === false && c.failed_quote),
    "the shipped fixture carries a demoted competency",
  );
  const { payload } = demoted();
  assert.ok(
    payload.blocks.some((b) => (b.props?.panel ?? []).some((e) => "failed_field_key" in e)),
    "the demoted payload carries a demoted panel entry",
  );
});

test("THE NAMED ASSERTION: the serialised projection contains failed_quote nowhere", () => {
  for (const [label, payload] of [["the shipped fixture", shipped()], ["a demoted payload", demoted().payload]]) {
    const wire = JSON.stringify(candidateProjection(payload));
    assert.ok(!wire.includes("failed_quote"), `${label}: failed_quote reached the wire`);
  }
});

test("#79: a demoted concern is INDISTINGUISHABLE from an honest gap on the wire", () => {
  // public/prep/registry.js's LikelyConcerns states the rule: "a demoted quote and an honest gap
  // render identically to a candidate ... the difference is a diagnostic for us rather than news
  // for them." That was true of the PIXELS and false of the WIRE — the projection shipped
  // `failed_evidence_quote: ""`, so the KEY's presence told a reader of the response which
  // concerns the model had invented an answer for.
  //
  // The reason the panel branch keeps ITS key does not apply here: `panelUnsourced` reads
  // `"failed_field_key" in entry` on the projected object, and nothing reads this one. The
  // demotion count is taken before the projection, and the STORED row keeps its marker — the
  // projection is a copy made for the response.
  const { payload } = demoted();
  const stored = payload.blocks.find((b) => b.name === "LikelyConcerns");
  assert.ok(
    stored.props.concerns.some((c) => "failed_evidence_quote" in c),
    "the demoted payload needs a demoted concern for this to mean anything",
  );

  const projection = candidateProjection(payload);
  const shippedConcerns = projection.blocks.find((b) => b.name === "LikelyConcerns").props.concerns;
  for (const concern of shippedConcerns) {
    assert.ok(
      !("failed_evidence_quote" in concern),
      `${concern.competency_id} still carries the demotion marker as a key`,
    );
  }
  assert.ok(
    !JSON.stringify(projection).includes("failed_evidence_quote"),
    "and the name is nowhere on the wire",
  );

  // The rest of the concern is untouched — this removes a diagnostic, not the content.
  assert.ok(shippedConcerns.every((c) => c.concern && c.competency_id), "the concerns still ship");
});

test("the invented quote text itself is absent, not merely its key", () => {
  // The subtler half, and the one a "delete the failed_quote key" implementation fails.
  // verifyBrief demotes by ADDING failed_quote and leaving source_quote in place
  // (verify.js:48), so the same invented sentence sits under a name that sounds trustworthy.
  const fixture = shipped();
  const bad = fixture.competencies.find((c) => c.verified === false);
  assert.ok(bad.failed_quote, "the fixture's demoted competency has a quote to leak");

  const wire = JSON.stringify(candidateProjection(fixture));
  assert.ok(!wire.includes(bad.failed_quote), "the model's invented sentence reached the candidate");

  const projected = candidateProjection(fixture).competencies.find((c) => c.id === bad.id);
  assert.equal(projected.source_quote, "", "and structurally, an unverified competency carries no quote");
});

test("importance is gone — a numeral is a score whatever it measures", () => {
  const fixture = shipped();
  assert.ok(fixture.competencies.every((c) => "importance" in c), "the stored row carries it");

  const projection = candidateProjection(fixture);
  assert.ok(
    projection.competencies.every((c) => !("importance" in c)),
    "structurally absent from every competency",
  );
  assert.ok(!JSON.stringify(projection).includes("importance"), "and absent from the wire");
});

test("questions are gone entirely — this endpoint does not serve them", () => {
  const fixture = shipped();
  assert.ok(fixture.questions.length, "the stored payload has a question bank");

  const projection = candidateProjection(fixture);
  assert.ok(!("questions" in projection), "the key is absent, not empty");

  // TWO NETS, because neither contains the other.
  //
  // This was a bare scan for the WORD "questions" anywhere on the wire until #79's QuestionsToAsk
  // block arrived carrying a prop of that name — the questions the candidate ASKS, which this
  // endpoint does serve. The scan had to stop being global. It did not have to stop existing,
  // and swapping it for the text loop alone was a TRADE described as a sharpening:
  //
  //  · the text loop catches a passthrough of the BANK under a renamed key, which the word scan
  //    never did — genuinely sharper, and kept;
  //  · the word scan catches what the text loop cannot, and both cases are live. A future
  //    `projectBlock` branch emitting `props.questions = payload.questions.map((q) => ({
  //    difficulty: q.difficulty }))` ships every question's difficulty score to the candidate
  //    with no question TEXT in it at all. So does a leak of the bank's `id`, `competency_id` or
  //    `axis`. And `wire.includes(q.text)` needs a byte-identical match, so a truncated or
  //    reworded question passes it.
  //
  // Scoping the word scan to everything OUTSIDE the one block entitled to the word keeps it.
  const wire = JSON.stringify(projection);
  for (const q of fixture.questions) {
    assert.ok(!wire.includes(q.text), `a question reached the candidate: ${q.text.slice(0, 40)}…`);
  }

  const withoutAsks = {
    ...projection,
    blocks: projection.blocks.filter((b) => b.name !== "QuestionsToAsk"),
  };
  assert.ok(
    !JSON.stringify(withoutAsks).includes("questions"),
    "the bank travelled under some key outside QuestionsToAsk — nested, renamed, or transformed",
  );

  // And the exemption is not a hole: the block it carves out is checked to be exactly the one
  // that serves the candidate's own questions, so a future block cannot hide behind the name.
  const asks = projection.blocks.filter((b) => b.name === "QuestionsToAsk");
  assert.equal(asks.length, 1, "one block is exempt from the word scan, and this is it");
  assert.ok(
    asks[0].props.questions.every((q) => typeof q === "string"),
    "QuestionsToAsk carries bare strings; a bank question is an object, and would be visible here",
  );
});

test("the projection keeps exactly the fields the page reads", () => {
  // `engagement` joined in #50: the session page routes on it. The shipped fixture predates the
  // flag, so it reads "unknown" — #46 D2's tolerant default, which behaves as perm.
  const projection = candidateProjection(shipped());
  assert.deepEqual(Object.keys(projection).sort(), ["blocks", "competencies", "engagement", "role_title"]);
  assert.equal(projection.engagement, "unknown");
  for (const c of projection.competencies) {
    assert.deepEqual(Object.keys(c).sort(), ["id", "label", "source_quote", "verified"]);
  }
});

test("verified survives on both sides, so a sourced brief is not marked unverified", () => {
  // registry.js:195-196 — `verified` absent is treated as unverified. Dropping it would put an
  // Unverified mark on every perfectly sourced competency for every candidate.
  const fixture = shipped();
  const projection = candidateProjection(fixture);

  for (const original of fixture.competencies) {
    const projected = projection.competencies.find((c) => c.id === original.id);
    assert.equal(projected.verified, original.verified === true, `${original.id} kept its verdict`);
  }
  assert.ok(projection.competencies.some((c) => c.verified === true), "and some are true");
  assert.ok(projection.competencies.some((c) => c.verified === false), "and some are false");
});

test("a verified competency keeps its quote — the page prints it", () => {
  const fixture = shipped();
  const good = fixture.competencies.find((c) => c.verified === true);
  const projected = candidateProjection(fixture).competencies.find((c) => c.id === good.id);
  assert.equal(projected.source_quote, good.source_quote);
});

test("a demoted PanelBrief entry still renders as unsourced after projection", () => {
  // THE FAIL-OPEN TRAP. Removing `failed_field_key` would lean panelUnsourced's decision on
  // its second clause alone; asserting the caption rather than the key's absence is what makes
  // the test about the candidate's screen instead of about the object shape.
  const { payload } = demoted();
  const projection = candidateProjection(payload);

  const entries = projection.blocks.flatMap((b) => b.props?.panel ?? []);
  assert.ok(entries.length, "there are panel entries to check");
  for (const entry of entries) {
    assert.ok("failed_field_key" in entry, "the demotion marker survives the projection");
    assert.equal(entry.failed_field_key, "", "but the slug the model invented does not");
  }

  const doc = fakeDocument();
  const mount = doc.createElement("div");
  renderBlocks(projection, mount, { doc });
  const rendered = serialize(mount);

  assert.ok(
    rendered.includes("We could not tie this back to our notes"),
    "the guessed panel row still wears its Unverified caption",
  );
  assert.ok(
    !rendered.includes("From our notes on this client"),
    "and no guessed row claims to be sourced",
  );
});

test("the projection is a valid input to renderBlocks", () => {
  const doc = fakeDocument();
  const mount = doc.createElement("div");

  const result = renderBlocks(candidateProjection(shipped()), mount, { doc });

  assert.ok(result.rendered > 0, "blocks rendered");
  assert.equal(result.skipped.length, 0, "and none was skipped");
});

test("an unverified competency renders its Unverified note, not a quote", () => {
  const fixture = shipped();
  const bad = fixture.competencies.find((c) => c.verified === false);

  const doc = fakeDocument();
  const mount = doc.createElement("div");
  renderBlocks(candidateProjection(fixture), mount, { doc });
  const rendered = serialize(mount);

  assert.ok(!rendered.includes(bad.failed_quote), "the invented sentence is not on the screen either");
});

/* ── the locum widening (#50) ──────────────────────────────────────────────────────────── */

test("a locum payload's questions are served as {text, type} and nothing else", () => {
  const fixture = shipped();
  fixture.engagement = "locum";
  fixture.questions.forEach((q, i) => {
    q.type = ["client", "competency", "screening"][i % 3];
  });

  const projection = candidateProjection(fixture);
  assert.equal(projection.engagement, "locum");
  assert.equal(projection.questions.length, fixture.questions.length);
  for (const [i, q] of projection.questions.entries()) {
    // Key SETS, the suite's habit: no id means the list can never be POSTed against — the
    // design, not an omission — and no competency_id, difficulty or axis reaches the wire.
    assert.deepEqual(Object.keys(q).sort(), ["text", "type"]);
    assert.equal(q.text, fixture.questions[i].text);
    assert.equal(q.type, fixture.questions[i].type);
  }
});

test("a locum question without a type defaults to competency — belt and braces only", () => {
  const fixture = shipped();
  fixture.engagement = "locum";
  // The pre-#50 case has to be MADE now rather than found: #79 typed every question in the
  // source fixture, so the untyped payload this branch exists for is no longer lying around.
  // Stripping it here keeps the test about the default instead of passing because the fixture
  // happened to say "competency" anyway.
  fixture.questions.forEach((q) => {
    delete q.type;
  });
  const projection = candidateProjection(fixture);
  assert.ok(projection.questions.every((q) => q.type === "competency"));
});

test("a perm or unknown payload still carries no questions at all", () => {
  // A5: perm exposure would leak the bank ahead of the drill. The conditional is the rule.
  for (const engagement of ["permanent", "unknown", undefined]) {
    const fixture = shipped();
    if (engagement) fixture.engagement = engagement;
    const projection = candidateProjection(fixture);
    assert.equal("questions" in projection, false, `${engagement}: the key must be absent`);
  }
});

test("a demoted primer item is projected like a panel entry: marker kept, slug blanked", () => {
  const fixture = shipped();
  fixture.engagement = "locum";
  fixture.blocks.push({
    name: "FirstDayPrimer",
    props: {
      intro: "Day one.",
      items: [
        { topic: "Getting in", detail: "Report to imaging reception.", source_field_key: "their-process" },
        { topic: "Scanners", detail: "A guessed fleet.", source_field_key: "", failed_field_key: "a-hidden-key" },
      ],
    },
  });

  const projected = candidateProjection(fixture).blocks.at(-1).props.items;
  assert.equal(projected[0].failed_field_key, undefined, "a sourced item carries no marker");
  assert.ok("failed_field_key" in projected[1], "the demotion marker survives");
  assert.equal(projected[1].failed_field_key, "", "but the slug the model invented does not");
  assert.ok(!JSON.stringify(candidateProjection(fixture)).includes("a-hidden-key"));
});

test("the projection does not mutate the stored payload", () => {
  const fixture = shipped();
  const before = structuredClone(fixture);
  candidateProjection(fixture);
  assert.deepEqual(fixture, before);
});
