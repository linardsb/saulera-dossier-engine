// #22 — striking a competency, proved against the contract it has to keep.
//
// The class of failure here is a DANGLING REFERENCE, and it is invisible to a happy-path
// test. Strike one competency out of a fixture whose CompetencyMap happens to list the other
// two and everything renders; strike the one that a StoryBankCard was the sole cover for and
// `assertBrief` throws on the way back out — at Send, in front of the recruiter, after the
// model call has already been paid for.
//
// So the central test here is exhaustive rather than illustrative: every non-empty subset of
// the fixture's competencies is struck and the result re-asserted. Three competencies is
// seven subsets, which is cheap; the point is that it needs no one to have imagined the
// particular block shape that breaks.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { strikeCompetencies } from "../src/prep/strike.js";
import { assertBrief } from "../src/prep/schema.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

/** A fresh deep copy per test, so a mutation in one cannot leak into the next
 *  (test/prep-schema.test.js:28's discipline). */
const load = () => JSON.parse(readFileSync(join(fixtures, "prep-payload.json"), "utf8"));

/** Every competency id mentioned anywhere a reference can legally live. */
function referencedIds(payload) {
  const found = [];
  const walk = (block) => {
    if (block?.name === "CompetencyMap") {
      found.push(...(block.props?.competency_ids ?? []));
      (block.children ?? []).forEach(walk);
    }
    if (block?.name === "StoryBankCard") found.push(...(block.props?.covers_competency_ids ?? []));
    // #79. A reference this walk does not know about is invisible to the exhaustive subset test
    // rather than a failure of it: `assertBrief` would still catch the dangling id, but the
    // "nothing points at it any more" assertion would pass vacuously for concerns.
    if (block?.name === "LikelyConcerns") {
      found.push(...(block.props?.concerns ?? []).map((c) => c?.competency_id));
    }
  };
  (payload.blocks ?? []).forEach(walk);
  found.push(...(payload.questions ?? []).map((q) => q.competency_id));
  return found;
}

test("the fixture is the shape these tests claim to exercise", () => {
  // A guard on the guard: if the fixture is ever reduced to one competency and no nesting,
  // every assertion below still passes while proving nothing.
  const payload = load();
  assert.ok(payload.competencies.length >= 3, "at least three competencies, so subsets are interesting");
  const map = payload.blocks.find((b) => b.name === "CompetencyMap");
  assert.ok(map?.children?.length, "a CompetencyMap with children, for the drop-the-subtree case");
  assert.ok(
    payload.blocks.some((b) => b.name === "StoryBankCard"),
    "a top-level StoryBankCard, for the emptied-cover case",
  );
  // #79's two, and they have to point at DIFFERENT competencies or "prune one, drop the block"
  // are the same case and only one of them is ever exercised.
  const concerns = payload.blocks.find((b) => b.name === "LikelyConcerns")?.props.concerns ?? [];
  assert.equal(new Set(concerns.map((c) => c.competency_id)).size, 2, "two concerns, two competencies");
  assert.ok(
    payload.blocks.some((b) => b.name === "QuestionsToAsk"),
    "a QuestionsToAsk block, for the references-nothing case",
  );
});

test("striking one competency removes it, its questions and every reference to it", () => {
  const payload = load();
  const target = payload.competencies[0].id;

  const result = strikeCompetencies(payload, [target]);

  assert.ok(!result.competencies.some((c) => c.id === target), "the competency is gone");
  assert.ok(!result.questions.some((q) => q.competency_id === target), "its questions are gone");
  assert.ok(!referencedIds(result).includes(target), "nothing points at it any more");
  assert.doesNotThrow(() => assertBrief(result), "and the result is still a valid brief");
});

test("EXHAUSTIVE: every non-empty proper subset leaves a brief that still asserts", () => {
  // The assertion that catches a dangling reference nobody thought of. Bitmask over the
  // competencies; the full set is excluded because striking everything is the throw below.
  const ids = load().competencies.map((c) => c.id);
  const total = 2 ** ids.length;
  let checked = 0;

  for (let mask = 1; mask < total - 1; mask++) {
    const struck = ids.filter((_, i) => mask & (1 << i));
    const result = strikeCompetencies(load(), struck);

    assert.doesNotThrow(
      () => assertBrief(result),
      `striking [${struck.join(", ")}] must leave a valid brief`,
    );
    for (const id of struck) {
      assert.ok(
        !referencedIds(result).includes(id),
        `striking [${struck.join(", ")}] left a reference to ${id}`,
      );
    }
    // A competency that survived must keep at least one question, which is assertBrief's own
    // rule (schema.js:317-321) and the one most likely to break under a multi-strike.
    for (const c of result.competencies) {
      assert.ok(
        result.questions.some((q) => q.competency_id === c.id),
        `${c.id} survived the strike with no questions`,
      );
    }
    checked++;
  }

  assert.equal(checked, total - 2, "every non-empty proper subset was exercised");
});

test("striking every competency throws — there is nothing left to send", () => {
  const payload = load();
  assert.throws(
    () => strikeCompetencies(payload, payload.competencies.map((c) => c.id)),
    /nothing left to send/,
  );
});

test("striking an id that is not in the payload is a no-op, not an error", () => {
  // The browser can post a stale id: the recruiter unticks a row, presses Prepare again, and
  // the new payload's competencies are named differently. Refusing would turn a normal
  // sequence of clicks into an error the recruiter cannot act on.
  const payload = load();
  const result = strikeCompetencies(payload, ["no-such-competency"]);
  assert.deepEqual(result, payload, "the payload comes back unchanged");
});

test("the input payload is not mutated", () => {
  // The Function persists body.brief alongside the STRUCK payload and re-asserts the original
  // on the way in; an in-place edit would make those two disagree invisibly.
  const payload = load();
  const before = structuredClone(payload);

  strikeCompetencies(payload, [payload.competencies[0].id]);

  assert.deepEqual(payload, before, "strikeCompetencies is pure");
});

test("a CompetencyMap whose ids all strike is dropped, and its children go with it", () => {
  // The fixture's map lists all three competencies, so striking its ids would strike the whole
  // brief and hit the throw instead of this path. Narrowing it to one competency is what makes
  // the two outcomes separable: the map empties while two competencies are still standing.
  const payload = load();
  const map = payload.blocks.find((b) => b.name === "CompetencyMap");
  const [doomed, ...survivors] = payload.competencies.map((c) => c.id);
  map.props.competency_ids = [doomed];
  assert.ok(map.children.length, "the fixture's map has children to lose");

  const result = strikeCompetencies(payload, [doomed]);

  assert.ok(
    !result.blocks.some((b) => b.name === "CompetencyMap"),
    "the emptied map is dropped, not kept as a heading with nothing under it (R5)",
  );
  // The sharp half: a child card covering a SURVIVING competency is gone too, because the
  // grouping it lived under is what stopped existing. Asserting only the map's absence would
  // pass even if the children had been reparented to the top level.
  assert.ok(
    survivors.some((id) => map.children.some((c) => c.props.covers_competency_ids.includes(id))),
    "the fixture's children cover a surviving competency, so their loss is attributable to the map",
  );
  const cards = result.blocks.filter((b) => b.name === "StoryBankCard");
  assert.equal(cards.length, 1, "only the top-level card remains; the nested ones went with the map");

  assert.ok(result.competencies.length === survivors.length, "the survivors survived");
  assert.doesNotThrow(() => assertBrief(result));
});

test("a StoryBankCard whose covers all strike is dropped", () => {
  const payload = load();
  const card = payload.blocks.find((b) => b.name === "StoryBankCard");
  const before = payload.blocks.filter((b) => b.name === "StoryBankCard").length;

  const result = strikeCompetencies(payload, card.props.covers_competency_ids);
  const after = result.blocks.filter((b) => b.name === "StoryBankCard").length;

  assert.ok(after < before, "a prompt covering no competency is a prompt with no target");
  assert.doesNotThrow(() => assertBrief(result));
});

test("#79: striking a competency removes the concern that sits under it, and its question", () => {
  const payload = load();
  const concerns = payload.blocks.find((b) => b.name === "LikelyConcerns").props.concerns;
  const target = concerns[0].competency_id;

  const result = strikeCompetencies(payload, [target]);
  const left = result.blocks.find((b) => b.name === "LikelyConcerns").props.concerns;

  assert.equal(left.length, concerns.length - 1, "the concern went with its competency");
  assert.ok(!left.some((c) => c.competency_id === target));
  // The pairing survives for free: `questions` is filtered by competency_id, so the concern and
  // the question that drills it are removed together. Without this, assertBrief throws at
  // send.js and the recruiter gets a 400 on a button they had every reason to press.
  assert.ok(!result.questions.some((q) => q.competency_id === target && q.type === "concern"));
  assert.doesNotThrow(() => assertBrief(result));
});

test("#79: a LikelyConcerns block whose every concern is struck is dropped, not kept empty", () => {
  const payload = load();
  const concerns = payload.blocks.find((b) => b.name === "LikelyConcerns").props.concerns;
  const ids = [...new Set(concerns.map((c) => c.competency_id))];
  assert.ok(ids.length < payload.competencies.length, "at least one competency survives the strike");

  const result = strikeCompetencies(payload, ids);

  assert.ok(
    !result.blocks.some((b) => b.name === "LikelyConcerns"),
    "a concerns block naming no objection is a heading with nothing under it (R5)",
  );
  assert.doesNotThrow(() => assertBrief(result));
});

test("#79: a QuestionsToAsk block survives every strike untouched", () => {
  // It references no competency — the questions are about the CLIENT, not about any one thing
  // the recruiter can untick. Its absence from strike.js's branches is a decision, and this is
  // where that decision is checked rather than assumed.
  const payload = load();
  const before = payload.blocks.find((b) => b.name === "QuestionsToAsk");

  for (const c of payload.competencies.slice(0, -1)) {
    const result = strikeCompetencies(load(), [c.id]);
    assert.deepEqual(result.blocks.find((b) => b.name === "QuestionsToAsk"), before, `striking ${c.id}`);
  }
});

test("blocks that reference no competency are untouched", () => {
  const payload = load();
  const result = strikeCompetencies(payload, [payload.competencies[0].id]);

  for (const name of ["PrimerCard", "PanelBrief", "LogisticsRail", "QuestionsToAsk"]) {
    assert.deepEqual(
      result.blocks.find((b) => b.name === name),
      payload.blocks.find((b) => b.name === name),
      `${name} carries no competency reference and must survive verbatim`,
    );
  }
});

test("an empty or absent strike list returns an equivalent payload", () => {
  const payload = load();
  assert.deepEqual(strikeCompetencies(payload, []), payload);
  assert.deepEqual(strikeCompetencies(payload), payload, "and a missing argument is the same thing");
});
