// #23 — targeting: ranking, spacing, variant demand, sessions, movement, close.
//
// Everything runs on fixtures with an explicit `now` — no wall clock, so the spacing
// buckets and the 30-minute session gap are asserted exactly, not approximately.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  readiness,
  rankCompetencies,
  daysToInterview,
  cooldownDays,
  eligible,
  nextQuestion,
  leastRecentlyAttempted,
  MAX_VARIANTS_PER_COMPETENCY,
  sessionsOf,
  movement,
  closePayload,
  SESSION_GAP_MINUTES,
  SUGGEST_CLOSE_TURNS,
  DAY_BEFORE_CLOSE_TURNS,
  isDayBefore,
  confidenceQuestion,
  drillState,
  SHAKY_DAMPEN,
  storyGap,
} from "../src/prep/targeting.js";

const NOW = Date.parse("2026-07-30T12:00:00Z");
const now = new Date(NOW);
/** A SQLite stamp `minutes` from NOW (negative = past). */
const stamp = (minutes) =>
  new Date(NOW + minutes * 60_000).toISOString().slice(0, 19).replace("T", " ");

const attempt = (over = {}) => ({
  mode: "recall",
  rating: 3,
  axis: null,
  question_id: "q-1",
  created_at: stamp(-1),
  ...over,
});

/* ── ranking ───────────────────────────────────────────────────────────────────────────── */

// Four competencies with distinct products, including a deliberate tie:
//   A: 5 × (1 − 0)     = 5
//   D: 4 × (1 − 0.25)  = 3   ties with C, wins on importance
//   C: 3 × (1 − 0)     = 3
//   B: 4 × (1 − 0.3)   = 2.8
const A = { id: "a", label: "A", importance: 5, stage: "", success_rate: 0 };
const B = { id: "b", label: "B", importance: 4, stage: "can_answer", success_rate: 0.5 };
const C = { id: "c", label: "C", importance: 3, stage: "", success_rate: 0 };
const D = { id: "d", label: "D", importance: 4, stage: "can_answer", success_rate: 0.25 };

test("readiness is (stageNumber + clamped rate) / 5", () => {
  assert.equal(readiness({ stage: "", success_rate: 0 }), 0);
  assert.equal(readiness({ stage: "can_answer", success_rate: 0.5 }), 0.3);
  assert.equal(readiness({ stage: "under_pressure", success_rate: 1 }), 1);
  assert.equal(readiness({ stage: "", success_rate: 7 }), 0.2, "rate clamps to [0,1]");
});

test("the full ranking order, tie broken by importance then id", () => {
  const ranked = rankCompetencies([B, C, D, A]).map((c) => c.id);
  assert.deepEqual(ranked, ["a", "d", "c", "b"]);

  // Same product AND same importance: id ascending decides, deterministically.
  const twin1 = { id: "x", importance: 3, stage: "", success_rate: 0 };
  const twin2 = { id: "w", importance: 3, stage: "", success_rate: 0 };
  assert.deepEqual(rankCompetencies([twin1, twin2]).map((c) => c.id), ["w", "x"]);
});

/* ── spacing ───────────────────────────────────────────────────────────────────────────── */

test("daysToInterview is whole UTC days and may be negative", () => {
  assert.equal(daysToInterview(stamp(2 * 24 * 60), now), 2);
  assert.equal(daysToInterview(stamp(-2 * 24 * 60), now), -2, "post-interview is a real state");
  assert.equal(daysToInterview(stamp(0), now), 0);
});

test("the cooldown buckets match SPEC's spacing table", () => {
  assert.equal(cooldownDays(2), 0);
  assert.equal(cooldownDays(-2), 0, "negative days is the <= 3 bucket too");
  assert.equal(cooldownDays(7), 2);
  assert.equal(cooldownDays(14), 2);
  assert.equal(cooldownDays(30), 5);
});

const rankedFour = rankCompetencies([A, B, C, D]);
const withLast = (minutesAgo) =>
  rankedFour.map((c) => ({ ...c, last_attempt_at: minutesAgo == null ? null : stamp(-minutesAgo) }));

test("at 2 days out only the top half is eligible, with no cooldown", () => {
  const drilled = withLast(5); // attempted five minutes ago — no cooldown applies
  const open = eligible(drilled, { daysToInterview: 2, now });
  assert.deepEqual(open.map((c) => c.id), ["a", "d"], "top ⌈half⌉ of 4 is 2, in rank order");
});

test("at -2 days (second stage, inside +14d access) the bucket is the same", () => {
  const open = eligible(withLast(5), { daysToInterview: -2, now });
  assert.deepEqual(open.map((c) => c.id), ["a", "d"]);
});

test("at 7 days a competency drilled yesterday is cooling; 3 days ago is open", () => {
  const mixed = rankedFour.map((c, i) => ({
    ...c,
    last_attempt_at: i % 2 === 0 ? stamp(-24 * 60) : stamp(-3 * 24 * 60),
  }));
  const open = eligible(mixed, { daysToInterview: 7, now });
  assert.deepEqual(open.map((c) => c.id), ["d", "b"], "the 1-day-old ones sit out the 2-day cooldown");
});

test("at 30 days the cooldown stretches to 5 days", () => {
  const threeDaysAgo = withLast(3 * 24 * 60);
  assert.equal(eligible(threeDaysAgo, { daysToInterview: 30, now }).length, 1, "never-empty override");
  const sixDaysAgo = withLast(6 * 24 * 60);
  assert.equal(eligible(sixDaysAgo, { daysToInterview: 30, now }).length, 4);
});

test("all cooling -> the top-ranked one is served anyway (a session must never be empty)", () => {
  const open = eligible(withLast(60), { daysToInterview: 7, now });
  assert.deepEqual(open.map((c) => c.id), ["a"]);
});

test("never attempted means never cooling", () => {
  const open = eligible(withLast(null), { daysToInterview: 30, now });
  assert.equal(open.length, 4);
});

/* ── day-before (#25) ──────────────────────────────────────────────────────────────────── */

test("isDayBefore: day-of and tomorrow only — negatives and 2+ days are normal sessions", () => {
  // Days 2–3 keep the top-half pool via eligible but do NOT get the day-before shape.
  for (const [days, expected] of [[-1, false], [0, true], [1, true], [2, false], [3, false]]) {
    assert.equal(isDayBefore(days), expected, `isDayBefore(${days})`);
  }
});

test("DAY_BEFORE_CLOSE_TURNS is pinned below the normal threshold", () => {
  assert.equal(DAY_BEFORE_CLOSE_TURNS, 3, "a run-through is half a drill");
  assert.ok(DAY_BEFORE_CLOSE_TURNS < SUGGEST_CLOSE_TURNS, "day-before is provably shorter");
});

test("confidenceQuestion picks the highest-readiness competency with a success", () => {
  // B is readier than D (0.3 vs 0.25); A has no success at all.
  const ranked = rankCompetencies([A, B, D]);
  const questionsBy = new Map([
    ["a", [core("a#0", 1)]],
    ["b", [{ ...core("b#0", 1), competency_id: "b" }]],
    ["d", [{ ...core("d#0", 1), competency_id: "d" }]],
  ]);
  const attemptsBy = new Map([
    ["a", []],
    ["b", [attempt({ question_id: "b#0", rating: 4 })]],
    ["d", [attempt({ question_id: "d#0", rating: 3 })]],
  ]);
  const pick = confidenceQuestion({ ranked, questionsBy, attemptsBy });
  assert.equal(pick.id, "b#0", "the strongest covered competency opens the session");
});

test("confidenceQuestion serves the least-recently-attempted question within the pick", () => {
  const ranked = rankCompetencies([B]);
  const questions = [
    { ...core("b#0", 1), competency_id: "b" },
    { ...core("b#1", 2), competency_id: "b" },
  ];
  const attemptsBy = new Map([
    ["b", [attempt({ question_id: "b#1", rating: 4, created_at: stamp(-5) })]],
  ]);
  const pick = confidenceQuestion({ ranked, questionsBy: new Map([["b", questions]]), attemptsBy });
  assert.equal(pick.id, "b#0", "unattempted counts as oldest");
});

test("confidenceQuestion returns null with no prior success — caller falls back", () => {
  const ranked = rankCompetencies([A, C]);
  const questionsBy = new Map([["a", [core("a#0", 1)]], ["c", []]]);
  const attemptsBy = new Map([
    ["a", [attempt({ question_id: "a#0", rating: 1 })]],
    ["c", []],
  ]);
  assert.equal(confidenceQuestion({ ranked, questionsBy, attemptsBy }), null);
});

test("confidenceQuestion ignores revealed-mode 'successes' — the honesty rule holds here too", () => {
  const ranked = rankCompetencies([B]);
  const questionsBy = new Map([["b", [{ ...core("b#0", 1), competency_id: "b" }]]]);
  const attemptsBy = new Map([
    ["b", [attempt({ question_id: "b#0", mode: "revealed", rating: 4 })]],
  ]);
  assert.equal(confidenceQuestion({ ranked, questionsBy, attemptsBy }), null);
});

/* ── the debrief's dampening (#77) ─────────────────────────────────────────────────────── */

test("a shaky tick moves the queue: the ticked competency becomes the target", () => {
  // Two competencies identical in every input the ranking reads — same importance, same cached
  // stage and rate — so the ONLY thing that can separate them is the tick. Without it the id
  // tiebreak decides and 'p' wins; with it, 'q' does.
  const p = { id: "p", label: "P", importance: 4, stage: "can_answer", success_rate: 0.5 };
  const q = { id: "q", label: "Q", importance: 4, stage: "can_answer", success_rate: 0.5 };
  const args = { competencies: [p, q], questions: [], attempts: [], interviewAt: stamp(20 * 24 * 60), now };

  assert.equal(drillState(args).target.id, "p", "with no tick, the id tiebreak decides");
  assert.equal(drillState({ ...args, shakyIds: ["q"] }).target.id, "q");
  assert.equal(
    drillState({ ...args, shakyIds: [] }).target.id,
    "p",
    "unticking puts it back — the dampening is not sticky in the ranking, only in the row",
  );
});

test("readiness clamps at 0 — a shaky competency at the bottom never goes negative", () => {
  assert.equal(readiness({ stage: "", success_rate: 0, shaky: true }), 0);
  assert.equal(readiness({ stage: "can_answer", success_rate: 0, shaky: true }), 0);
  assert.equal(
    readiness({ stage: "can_answer", success_rate: 0.5, shaky: true }),
    0.3 - SHAKY_DAMPEN,
    "one rung of readiness's own five-point denominator",
  );
  assert.equal(readiness({ stage: "can_answer", success_rate: 0.5 }), 0.3, "no tick, no change");
});

test("confidenceQuestion inherits the dampening — a shaky competency does not open the day before", () => {
  // Both hold a success, so both are eligible for the confidence rep. B is readier (0.3 vs 0.25)
  // and would open the session; ticking it shaky drops it to 0.1 and D opens instead.
  const questionsBy = new Map([
    ["b", [{ ...core("b#0", 1), competency_id: "b" }]],
    ["d", [{ ...core("d#0", 1), competency_id: "d" }]],
  ]);
  const attemptsBy = new Map([
    ["b", [attempt({ question_id: "b#0", rating: 4 })]],
    ["d", [attempt({ question_id: "d#0", rating: 3 })]],
  ]);
  const plain = confidenceQuestion({ ranked: rankCompetencies([B, D]), questionsBy, attemptsBy });
  assert.equal(plain.id, "b#0");

  const damped = confidenceQuestion({
    ranked: rankCompetencies([{ ...B, shaky: true }, D]),
    questionsBy,
    attemptsBy,
  });
  assert.equal(damped.id, "d#0", "the competency they said felt shaky is not the one to open on");
});

/* ── variant demand ────────────────────────────────────────────────────────────────────── */

const core = (id, difficulty) => ({ id, competency_id: "a", text: `Q ${id}`, axis: null, difficulty, variant_of: null });
const variant = (id, axis, difficulty = 2) => ({ id, competency_id: "a", text: `V ${id}`, axis, difficulty, variant_of: "a#0" });

test("no success yet -> the easiest unattempted core question", () => {
  const questions = [core("a#0", 2), core("a#1", 1), core("a#2", 3)];
  assert.equal(nextQuestion({ questions, attempts: [] }).question.id, "a#1");

  // NULL difficulty reads as 2 (standard), and ties break by id.
  const withNull = [core("a#0", null), core("a#1", 1)];
  assert.equal(nextQuestion({ questions: withNull, attempts: [] }).question.id, "a#1");

  const attempted = [attempt({ question_id: "a#1", rating: 1 })];
  assert.equal(nextQuestion({ questions, attempts: attempted }).question.id, "a#0");
});

test("#79: a concern counter is not the first question a candidate meets", () => {
  // THE ONE PRODUCT REGRESSION ON THIS TICKET THAT NOTHING ELSE WOULD CATCH. A concern question
  // reaches D1 with `axis` NULL — the tag rides brief_json and the question table is type-free —
  // so it is an ORDINARY CORE ROW here, and step 1 serves the easiest unattempted one. A counter
  // marked "gentle" would therefore become the first question ever served on its competency:
  // "how do you answer never having done IV therapy?" as the opening screen, to someone SPEC
  // describes as anxious, short on time, and ready to close the tab.
  //
  // Nothing in code can enforce it — `difficulty` is a free enum on every question — so it is
  // stated in PREP_SYSTEM, repeated in the schema's description for "concern", pinned in the
  // fixture, and asserted here on the behaviour that actually matters.
  const questions = [core("a#0", 2), core("a#1", 3)]; // an ordinary standard, then the counter
  assert.equal(
    nextQuestion({ questions, attempts: [] }).question.id,
    "a#0",
    "probing sorts last, so the ordinary question opens and the counter comes after a win",
  );

  // And the failure it guards against, spelled out: the same bank with the counter pitched
  // gentle opens ON the counter.
  const mispitched = [core("a#0", 2), core("a#1", 1)];
  assert.equal(nextQuestion({ questions: mispitched, attempts: [] }).question.id, "a#1");
});

test("#79: the fixture's own concern questions are pitched probing", () => {
  // The prompt rule, pinned where a fixture edit would trip over it: every fixture derived from
  // prep-payload.json feeds the drill, and a counter pitched gentle there is the regression
  // above shipped rather than described.
  const payload = JSON.parse(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures/prep-payload.json"), "utf8"),
  );
  const concerns = payload.questions.filter((q) => q.type === "concern");
  assert.ok(concerns.length, "the fixture carries concern questions at all");
  for (const q of concerns) {
    assert.equal(q.difficulty, "probing", `${q.text.slice(0, 40)}… must not open a competency`);
  }
});

test("with a success, an unattempted stored variant wins — lateral before vertical", () => {
  const questions = [core("a#0", 1), variant("a#v-2", "vertical"), variant("a#v-1", "lateral")];
  const attempts = [attempt({ question_id: "a#0", rating: 4 })];
  assert.equal(nextQuestion({ questions, attempts }).question.id, "a#v-1");
});

test("no unattempted question anywhere -> {mint}, lateral first, off the last success", () => {
  const questions = [core("a#0", 1), core("a#1", 2)];
  const attempts = [
    attempt({ question_id: "a#0", rating: 4, created_at: stamp(-10) }),
    attempt({ question_id: "a#1", rating: 3, created_at: stamp(-5) }),
  ];
  const demand = nextQuestion({ questions, attempts });
  assert.deepEqual(demand, { mint: { axis: "lateral", variantOf: "a#1" } });
});

test("after a lateral success the mint demand turns vertical", () => {
  const questions = [core("a#0", 1), variant("a#v-1", "lateral")];
  const attempts = [
    attempt({ question_id: "a#0", rating: 4, created_at: stamp(-10) }),
    attempt({ question_id: "a#v-1", rating: 3, axis: "lateral", created_at: stamp(-5) }),
  ];
  assert.equal(nextQuestion({ questions, attempts }).mint.axis, "vertical");
});

test("a revealed 'success' does not count toward variant demand", () => {
  const questions = [core("a#0", 1), core("a#1", 2)];
  const attempts = [attempt({ question_id: "a#0", mode: "revealed", rating: 4 })];
  // No non-revealed success -> still walking the core bank.
  assert.equal(nextQuestion({ questions, attempts }).question.id, "a#1");
});

test("at the mint cap the least-recently-attempted question is re-served, no {mint}", () => {
  const variants = Array.from({ length: MAX_VARIANTS_PER_COMPETENCY }, (_, i) =>
    variant(`a#v-${i}`, "lateral"),
  );
  const questions = [core("a#0", 1), ...variants];
  const attempts = [
    attempt({ question_id: "a#0", rating: 4, created_at: stamp(-100) }),
    ...variants.map((v, i) =>
      attempt({ question_id: v.id, axis: "lateral", rating: 3, created_at: stamp(-90 + i) }),
    ),
  ];
  const served = nextQuestion({ questions, attempts });
  assert.equal(served.mint, undefined, "the cap holds decision 6's cost envelope");
  assert.equal(served.question.id, "a#0", "oldest attempt is re-served");
});

test("questions the candidate was really asked do not spend the mint budget", () => {
  // #81 M1. `insertAskedQuestion` writes `axis = 'lateral'` so a real question is SERVED like a
  // stored variant — which is the point. Counting it toward the cap is a different claim, and a
  // wrong one: the cap bounds what we spend, and these cost nothing. Nine of them under one
  // competency would otherwise stop it ever minting again, permanently, and the competency a
  // candidate lists most questions under is the one they ticked shaky.
  const asked = Array.from({ length: MAX_VARIANTS_PER_COMPETENCY + 1 }, (_, i) => ({
    id: `a#asked-${i}`,
    competency_id: "a",
    text: `A question they really asked, number ${i}.`,
    axis: "lateral",
    difficulty: null,
    variant_of: null, // what tells a real question from one of ours
  }));
  const questions = [core("a#0", 1), ...asked];
  const attempts = [
    attempt({ question_id: "a#0", rating: 4, created_at: stamp(-100) }),
    ...asked.map((q, i) =>
      attempt({ question_id: q.id, axis: "lateral", rating: 3, created_at: stamp(-90 + i) }),
    ),
  ];

  assert.ok(nextQuestion({ questions, attempts }).mint, "the competency can still mint");
});

test("leastRecentlyAttempted treats unattempted as oldest", () => {
  const questions = [core("a#0", 2), core("a#1", 1)];
  const attempts = [attempt({ question_id: "a#1", created_at: stamp(-5) })];
  assert.equal(leastRecentlyAttempted(questions, attempts).id, "a#0");
});

/* ── sessions & movement ───────────────────────────────────────────────────────────────── */

test("sessionsOf splits on a 31-minute gap and not on 29", () => {
  const log = [
    attempt({ created_at: stamp(-120) }),
    attempt({ created_at: stamp(-91) }), // 29 minutes later — same session
    attempt({ created_at: stamp(-60) }), // 31 minutes later — new session
  ];
  const sessions = sessionsOf(log);
  assert.equal(sessions.length, 2);
  assert.equal(sessions[0].length, 2);
  assert.equal(sessions[1].length, 1);
  assert.equal(SESSION_GAP_MINUTES, 30);
});

test("movement is 'up' on a stage rise and null on a flat session", () => {
  const before = [attempt({ rating: 1, created_at: stamp(-120) })];
  const session = [attempt({ rating: 3, created_at: stamp(-10) })];
  assert.equal(movement([...before, ...session], stamp(-10)), "up");

  const flat = [attempt({ rating: 1, created_at: stamp(-10) })];
  assert.equal(movement([...before, ...flat], stamp(-10)), null);
});

/* ── close payload ─────────────────────────────────────────────────────────────────────── */

test("closePayload picks the stage-riser as improved, and never leaks numbers", () => {
  const competencies = [A, D];
  const attemptsByCompetency = new Map([
    ["a", [attempt({ rating: 3, created_at: stamp(-10) })]], // '' -> can_answer in-session
    ["d", []],
  ]);
  const close = closePayload({
    competencies,
    attemptsByCompetency,
    sessionStart: stamp(-15),
    sessionEnd: null,
    ranked: [D, A],
    queued: ["Q one", "Q two", "Q three", "Q four"],
  });
  assert.deepEqual(close.improved, { id: "a", label: "A" });
  assert.deepEqual(close.next, { id: "d", label: "D" });
  assert.deepEqual(close.queued, ["Q one", "Q two", "Q three"], "queued caps at 3");
  assert.ok(!JSON.stringify(close).match(/importance|stage|success_rate/));
});

test("closePayload with no stage rise picks the BIGGEST rate riser, not the first in rank", () => {
  const attemptsByCompetency = new Map([
    // a: can_answer before and after; rate 1/2 -> 2/3 (a rise of ~0.17)
    ["a", [
      attempt({ rating: 3, created_at: stamp(-120) }),
      attempt({ rating: 1, created_at: stamp(-110) }),
      attempt({ rating: 3, created_at: stamp(-10) }),
    ]],
    // d: can_answer before and after (no variant success, so no stage rise at 5 counted
    // attempts even at rate 0.6); rate 1/3 -> 3/5 — the bigger rise, ranked second.
    ["d", [
      attempt({ rating: 3, created_at: stamp(-120) }),
      attempt({ rating: 1, created_at: stamp(-115) }),
      attempt({ rating: 1, created_at: stamp(-110) }),
      attempt({ rating: 3, created_at: stamp(-10) }),
      attempt({ rating: 3, created_at: stamp(-5) }),
    ]],
  ]);
  const close = closePayload({
    competencies: [A, D],
    attemptsByCompetency,
    sessionStart: stamp(-15),
    sessionEnd: null,
    ranked: [A, D],
    queued: [],
  });
  assert.deepEqual(close.improved, { id: "d", label: "D" });
});

test("closePayload with a flat session improves nothing", () => {
  const close = closePayload({
    competencies: [A],
    attemptsByCompetency: new Map([["a", [attempt({ rating: 1, created_at: stamp(-5) })]]]),
    sessionStart: stamp(-10),
    sessionEnd: null,
    ranked: [A],
    queued: [],
  });
  assert.equal(close.improved, null);
});

/* ── the story gap (#78) ───────────────────────────────────────────────────────────────── */
//
// Pure, so no `{ skip }`: this function takes ids and rows and never touches SQLite. The list it
// walks is `rankCompetencies`' own output, which is what makes the flag agree with what the drill
// would serve next rather than being a second opinion about the same competencies.

test("with no stories at all the gap is the top-ranked competency", () => {
  // The honest first prompt on an empty storybank, and the reason this is not special-cased: a
  // candidate with nothing written down has no material for the thing most likely to come up,
  // which is exactly what the flag says.
  const ranked = rankCompetencies([A, B, C]);
  assert.deepEqual(storyGap({ ranked, coveredIds: [] }), { id: ranked[0].id, label: ranked[0].label });
});

test("with every competency covered there is no gap", () => {
  const ranked = rankCompetencies([A, B, C]);
  assert.equal(storyGap({ ranked, coveredIds: ["a", "b", "c"] }), null);
});

test("a role with no competencies has no gap, and does not throw", () => {
  // The edge the page has to survive: a handover that wrote no competencies still renders, and a
  // title-only story still saves. `find` over an empty list is `undefined`, which must read as
  // "nothing to flag" rather than as a missing label the page would render blank.
  assert.equal(storyGap({ ranked: [], coveredIds: [] }), null);
  assert.equal(storyGap({}), null, "and a caller that passes nothing gets the same answer");
});

test("the gap skips covered competencies and names the highest-ranked one left", () => {
  const ranked = rankCompetencies([A, B, C]);
  const gap = storyGap({ ranked, coveredIds: [ranked[0].id] });
  assert.deepEqual(gap, { id: ranked[1].id, label: ranked[1].label });
  assert.notEqual(gap.id, ranked[0].id, "the covered one is skipped rather than merely deprioritised");
});

test("the gap carries an id and a label and NOTHING else", () => {
  // The assertion that stops a rank, a readiness or an importance leaking later. Every one of
  // those is on the row this function reads, and returning the row itself would ship all three to
  // a page whose whole copy rule is that no number appears on it (SPEC's ladder rule, twice).
  const ranked = rankCompetencies([A, B]);
  const gap = storyGap({ ranked, coveredIds: [] });
  assert.deepEqual(Object.keys(gap).sort(), ["id", "label"]);
});
