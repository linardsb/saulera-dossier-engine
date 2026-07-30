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

import { BLOCK_NAMES, BRIEF_SCHEMA, assertBrief } from "../src/prep/schema.js";

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

const WALKED = walk(BRIEF_SCHEMA);

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

test("the walker reached every block variant in the vocabulary", () => {
  assert.deepEqual(
    [...WALKED.blockNames].sort(),
    [...BLOCK_NAMES].sort(),
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
