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

test("blocks that reference no competency are untouched", () => {
  const payload = load();
  const result = strikeCompetencies(payload, [payload.competencies[0].id]);

  for (const name of ["PrimerCard", "PanelBrief", "LogisticsRail"]) {
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
