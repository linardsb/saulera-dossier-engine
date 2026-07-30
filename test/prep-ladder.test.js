// #23 — the readiness ladder's rules, pinned from both directions.
//
// The one that matters most is the honesty rule: a revealed attempt must never raise
// success_rate (SPEC "State"). It is asserted symmetrically — the same rating-4 attempt
// leaves the rate exactly unchanged as `revealed` and raises it as `recall` — because a
// naive "exclude reveals from successes only" passes the first half and fails the second
// by making reveals LOWER the rate.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  STAGES,
  stageNumber,
  SUCCESS_RATING,
  isSuccess,
  successRate,
  nextStage,
  replayProgress,
} from "../src/prep/ladder.js";

/** An attempt row the store would shape, with core (null-axis) defaults. */
const at = (mode, rating, axis = null) => ({ mode, rating, axis, created_at: "" });

/* ── the honesty rule ──────────────────────────────────────────────────────────────────── */

test("a revealed rating-4 attempt leaves successRate exactly unchanged", () => {
  const histories = [
    [],
    [at("recall", 4)],
    [at("recall", 2), at("nudged", 3)],
    [at("recall", 1), at("recall", 1), at("recall", 4)],
  ];
  for (const history of histories) {
    const before = successRate(history);
    const after = successRate([...history, at("revealed", 4)]);
    assert.equal(after, before, "a reveal must move the rate in NO direction");
  }
});

test("the same attempt as recall raises the rate — the other half of the symmetry", () => {
  const history = [at("recall", 2), at("nudged", 3)];
  assert.ok(successRate([...history, at("recall", 4)]) > successRate(history));
});

test("an all-revealed log has rate 0, not NaN", () => {
  assert.equal(successRate([at("revealed", 4), at("revealed", 4)]), 0);
});

test("isSuccess refuses a revealed attempt whatever its rating", () => {
  assert.equal(isSuccess(at("revealed", 4)), false);
  assert.equal(isSuccess(at("recall", SUCCESS_RATING)), true);
  assert.equal(isSuccess(at("nudged", 2)), false);
  assert.equal(isSuccess(at("nudged", null)), false, "a NULL rating is not a success");
});

/* ── the vocabulary ────────────────────────────────────────────────────────────────────── */

test("the stage vocabulary and its numbering", () => {
  assert.deepEqual(STAGES, ["", "can_answer", "holds_up", "unaided", "under_pressure"]);
  assert.equal(stageNumber(""), 0);
  assert.equal(stageNumber("unaided"), 3);
  assert.equal(stageNumber("under_pressure"), 4);
  assert.equal(stageNumber("garbage"), 0, "outside the vocabulary reads as not-yet-started");
});

/* ── transitions, one fixture per pinned rule ──────────────────────────────────────────── */

test("'' -> can_answer on one nudged success (SPEC: with notes or a nudge)", () => {
  assert.equal(nextStage({ stage: "", attempts: [at("nudged", 3)] }), "can_answer");
  assert.equal(nextStage({ stage: "", attempts: [at("recall", 2)] }), "");
  assert.equal(nextStage({ stage: "", attempts: [at("revealed", 4)] }), "", "reveals never promote");
});

test("can_answer -> holds_up needs 4 attempts, rate >= 0.6 AND a variant success", () => {
  const withVariant = [at("recall", 3), at("nudged", 3, "lateral"), at("recall", 2), at("recall", 4)];
  assert.equal(nextStage({ stage: "can_answer", attempts: withVariant }), "holds_up");

  const noVariant = [at("recall", 3), at("nudged", 3), at("recall", 2), at("recall", 4)];
  assert.equal(
    nextStage({ stage: "can_answer", attempts: noVariant }),
    "can_answer",
    "3-of-4 with no variant success stays stage 1",
  );

  const tooFew = [at("recall", 3), at("nudged", 3, "vertical"), at("recall", 4)];
  assert.equal(
    nextStage({ stage: "can_answer", attempts: tooFew }),
    "can_answer",
    "a rate needs a sample: 3 attempts are not 4",
  );

  const lowRate = [at("recall", 3, "lateral"), at("recall", 1), at("recall", 1), at("recall", 2)];
  assert.equal(nextStage({ stage: "can_answer", attempts: lowRate }), "can_answer");
});

test("one good answer alone is stage 1, not stage 2", () => {
  const one = [at("recall", 4)];
  assert.equal(nextStage({ stage: "", attempts: one }), "can_answer");
  assert.equal(nextStage({ stage: "can_answer", attempts: one }), "can_answer");
});

test("holds_up -> unaided on 3 trailing recall successes", () => {
  const base = [at("nudged", 3, "lateral"), at("recall", 3), at("recall", 2)];
  const trailing = [...base, at("recall", 3), at("recall", 4), at("recall", 3)];
  assert.equal(nextStage({ stage: "holds_up", attempts: trailing }), "unaided");

  const nudgedTail = [...base, at("recall", 3), at("nudged", 4), at("recall", 3)];
  assert.equal(
    nextStage({ stage: "holds_up", attempts: nudgedTail }),
    "holds_up",
    "a nudge in the last 3 is not 'fewer nudges'",
  );

  // A trailing reveal is invisible to the tail — it is excluded from counting entirely,
  // so it neither completes nor breaks the run of 3.
  const revealedTail = [...trailing, at("revealed", 4)];
  assert.equal(nextStage({ stage: "holds_up", attempts: revealedTail }), "unaided");
});

test("nothing reaches under_pressure in the pilot (decision 21)", () => {
  const perfect = Array.from({ length: 20 }, () => at("recall", 4, "lateral"));
  assert.equal(nextStage({ stage: "unaided", attempts: perfect }), "unaided");
  assert.equal(replayProgress(perfect).stage, "unaided");
});

/* ── replayProgress, the fold ──────────────────────────────────────────────────────────── */

test("transitions are single-step: one turn can never jump '' -> holds_up", () => {
  // A log whose LAST attempt satisfies every condition at once still walks one stage per
  // attempt: the first success promotes to can_answer, later attempts to holds_up.
  const log = [at("recall", 1), at("recall", 3, "lateral")];
  assert.equal(replayProgress(log).stage, "can_answer");
});

test("the fold over a full log equals the fold of a prefix continued (cache invariant)", () => {
  const log = [
    at("recall", 2),
    at("nudged", 3),
    at("recall", 3, "lateral"),
    at("recall", 4),
    at("recall", 3),
    at("recall", 3),
    at("recall", 4),
  ];
  const whole = replayProgress(log);

  // Continue the fold from a prefix by hand: stage carried forward, log re-fed whole.
  let stage = replayProgress(log.slice(0, 3)).stage;
  const seen = log.slice(0, 3);
  for (const attempt of log.slice(3)) {
    seen.push(attempt);
    stage = nextStage({ stage, attempts: seen });
  }
  assert.equal(stage, whole.stage);
});

test("a prefix/full comparison detects a stage rise mid-log — the 'moved' mechanism", () => {
  const before = [at("recall", 1)];
  const session = [at("recall", 3)];
  const pre = replayProgress(before);
  const post = replayProgress([...before, ...session]);
  assert.equal(pre.stage, "");
  assert.equal(post.stage, "can_answer");
  assert.ok(post.successRate > pre.successRate);
});

test("an all-revealed log replays to {'', 0}", () => {
  const log = [at("revealed", 4), at("revealed", 4), at("revealed", 3)];
  assert.deepEqual(replayProgress(log), { stage: "", successRate: 0 });
});
