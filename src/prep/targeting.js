// What to ask next (#23). SPEC "Targeting": rank competencies by
// `importance × (1 − readiness)` and drill the top of that list — the whole value of having
// the JD, and what separates this from a generic question bank. Spacing (SPEC's table) is
// compressed by time-to-interview; variation ("start varying early") decides which question
// within the chosen competency.
//
// THE CACHE-VS-TRUTH SPLIT, named because it is easy to un-split by accident: ranking reads
// the STORED `stage`/`success_rate` columns — targeting's read cache — while `movement`
// replays the attempt log, which is the truth. The stored columns cannot answer "moved this
// session" on their own (there is no timestamped stage history), and the log is too slow to
// re-fold for every ranking read at no benefit. Both sides are ladder.js's invariant.
//
// Pure like src/prep/dates.js: no D1, no HTTP, no `node:` imports. Rows arrive already
// shaped by the store — `difficulty` is numeric (the DIFFICULTY map wrote it), `axis` NULL
// means core (store.js R3), attempts oldest-first.

import { toUtcDate } from "./dates.js";
import { replayProgress, isSuccess, stageNumber } from "./ladder.js";

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Number(n) || 0));

/** Readiness in [0, 1]: stage carries most of it, the rate refines within a stage. */
export function readiness({ stage, success_rate }) {
  return (stageNumber(stage) + clamp(success_rate, 0, 1)) / 5;
}

/**
 * SPEC's ranking, made deterministic for fixtures: `importance × (1 − readiness)`
 * descending, ties broken by importance descending, then id ascending.
 */
export function rankCompetencies(competencies) {
  return [...competencies].sort((a, b) => {
    const scoreA = a.importance * (1 - readiness(a));
    const scoreB = b.importance * (1 - readiness(b));
    if (scoreB !== scoreA) return scoreB - scoreA;
    if (b.importance !== a.importance) return b.importance - a.importance;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * Whole UTC days until the interview — MAY BE NEGATIVE. Decision 11 keeps access open
 * until interview + 14 days precisely for second stages, so post-interview drilling is a
 * real state, not an error; a negative answer lands in the ≤ 3-day bucket below.
 * `toUtcDate` is the one reading of a SQLite stamp (dates.js's rule) — never a second one.
 */
export function daysToInterview(interviewAt, now = new Date()) {
  const date = toUtcDate(interviewAt);
  if (!date) return 0;
  const day = (d) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.round((day(date) - day(now)) / 86_400_000);
}

/**
 * SPEC's spacing table as per-competency cooldowns. The unit is WALL-CLOCK days —
 * `eligible` compares raw milliseconds, so a cooldown of 2 means a full 48 h since the
 * last non-revealed attempt, not two calendar dates like `daysToInterview` counts.
 */
export function cooldownDays(days) {
  if (days <= 3) return 0; // 1–3 days (and past-interview): same day is fine
  if (days <= 14) return 2; // 1–2 weeks: every 2–3 days
  return 5; // 3+ weeks: every 5–7 days
}

/**
 * The ranked competencies still eligible to drill now, in rank order.
 *
 * Each entry carries `last_attempt_at` — the stamp of its last NON-revealed attempt, or
 * null (the store/route shapes it; a revealed-and-moved-on does not reset the clock).
 * Rules, per the pinned spacing:
 *   - ≤ 3 days out (negative included): no cooldown, but only the top ⌈half⌉ of the ranked
 *     list is eligible — coverage beats depth, top-ranked only (SPEC's 1–3 day row).
 *   - otherwise: a competency inside its cooldown window is skipped…
 *   - …UNLESS every competency is cooling — then the top-ranked one is served anyway. A
 *     session must never be empty while questions exist.
 */
export function eligible(ranked, { daysToInterview: days, now = new Date() } = {}) {
  let pool = ranked;
  if (days <= 3) pool = ranked.slice(0, Math.ceil(ranked.length / 2));

  const cooldown = cooldownDays(days);
  const cooling = (c) => {
    if (!cooldown || !c.last_attempt_at) return false;
    const last = toUtcDate(c.last_attempt_at);
    if (!last) return false;
    return now.getTime() - last.getTime() < cooldown * 86_400_000;
  };

  const open = pool.filter((c) => !cooling(c));
  if (open.length) return open;
  return pool.length ? [pool[0]] : [];
}

/**
 * Decision 6's cost envelope, made unbreachable: at 8 stored variants a competency stops
 * minting and re-serves the least-recently-attempted question instead — one determined
 * candidate drilling one competency all day cannot run up the model bill.
 */
export const MAX_VARIANTS_PER_COMPETENCY = 8;

/** NULL difficulty reads as 2 (standard) — the store's DIFFICULTY map's middle value. */
const difficultyOf = (q) => (q.difficulty == null ? 2 : q.difficulty);

const byDifficultyThenId = (a, b) =>
  difficultyOf(a) - difficultyOf(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * The question least recently attempted — unattempted questions count as oldest, ties by
 * difficulty then id so fixtures are deterministic.
 */
export function leastRecentlyAttempted(questions, attempts) {
  const lastAt = new Map();
  for (const a of attempts) {
    lastAt.set(a.question_id, a.created_at); // attempts are ordered, later wins
  }
  return [...questions].sort((a, b) => {
    const ta = lastAt.has(a.id) ? String(lastAt.get(a.id)) : "";
    const tb = lastAt.has(b.id) ? String(lastAt.get(b.id)) : "";
    if (ta !== tb) return ta < tb ? -1 : 1; // '' (never attempted) sorts first
    return byDifficultyThenId(a, b);
  })[0] ?? null;
}

/**
 * The next question within a chosen competency — SPEC: "start varying early".
 *
 * `questions` and `attempts` are this competency's rows only. Returns `{question}` or
 * `{mint: {axis, variantOf}}` (the only model call for question supply):
 *   1. no non-revealed success yet → the easiest unattempted core question;
 *   2. else an unattempted stored variant (lateral before vertical, difficulty asc);
 *   3. else mint — lateral until a lateral variant has been answered well, then vertical;
 *      `variant_of` = the question last succeeded on (fallback: the first core question);
 *   4. at MAX_VARIANTS_PER_COMPETENCY stored variants, re-serve instead of minting.
 */
export function nextQuestion({ questions, attempts }) {
  const attempted = new Set(attempts.map((a) => a.question_id));
  const hasSuccess = attempts.some(isSuccess);

  if (!hasSuccess) {
    const core = questions
      .filter((q) => q.axis == null && !attempted.has(q.id))
      .sort(byDifficultyThenId)[0];
    if (core) return { question: core };
  }

  const axisRank = { lateral: 0, vertical: 1 };
  const variant = questions
    .filter((q) => q.axis != null && !attempted.has(q.id))
    .sort((a, b) => axisRank[a.axis] - axisRank[b.axis] || byDifficultyThenId(a, b))[0];
  if (variant) return { question: variant };

  const stored = questions.filter((q) => q.axis != null);
  if (stored.length >= MAX_VARIANTS_PER_COMPETENCY) {
    return { question: leastRecentlyAttempted(questions, attempts) };
  }
  if (!questions.length) return { question: null };

  const lateralSuccess = attempts.some((a) => a.axis === "lateral" && isSuccess(a));
  const lastSuccess = [...attempts].reverse().find(isSuccess);
  const firstCore = questions.filter((q) => q.axis == null).sort(byDifficultyThenId)[0];
  return {
    mint: {
      axis: lateralSuccess ? "vertical" : "lateral",
      variantOf: lastSuccess?.question_id ?? firstCore?.id ?? questions[0].id,
    },
  };
}

/** Attempts more than this far apart belong to different sessions. */
export const SESSION_GAP_MINUTES = 30;

/**
 * The whole-role attempt log split into sessions on a > 30-minute gap. A projection of
 * the log, not state — which is what makes sessions resumable with no session table.
 */
export function sessionsOf(attempts) {
  const sessions = [];
  let previous = null;
  for (const attempt of attempts) {
    const time = toUtcDate(attempt.created_at)?.getTime() ?? 0;
    if (previous === null || time - previous > SESSION_GAP_MINUTES * 60_000) {
      sessions.push([]);
    }
    sessions[sessions.length - 1].push(attempt);
    previous = time;
  }
  return sessions;
}

/**
 * THE ONE DEFINITION OF `moved`, used by both routes: replay the pre-session prefix of a
 * competency's log against the whole log; 'up' if the stage or the rate rose, else null.
 * `sessionStart` is anything toUtcDate reads (or a Date): the first attempt of the session.
 */
export function movement(competencyAttempts, sessionStart) {
  const start =
    sessionStart instanceof Date ? sessionStart.getTime() : toUtcDate(sessionStart)?.getTime();
  if (start == null) return null;
  const before = competencyAttempts.filter(
    (a) => (toUtcDate(a.created_at)?.getTime() ?? 0) < start,
  );
  const pre = replayProgress(before);
  const post = replayProgress(competencyAttempts);
  if (stageNumber(post.stage) > stageNumber(pre.stage)) return "up";
  if (post.successRate > pre.successRate) return "up";
  return null;
}

/**
 * SPEC Session shape 3 — the close: one thing that improved, one thing to work on next,
 * and what's queued. `improved` prefers a stage-riser (first in rank order), else the
 * biggest rate rise, else null. Everything candidate-bound here is {id, label} or text —
 * never a stage, a rate, or an importance.
 *
 * @param competencies    all rows `{id, label, ...}`
 * @param attemptsByCompetency  Map/object id → that competency's whole ordered log
 * @param sessionStart    first attempt of the session being closed
 * @param sessionEnd      exclusive upper bound (start of the NEXT session), or null for "now"
 * @param ranked          the current ranked list (for `next`)
 * @param queued          up to 3 question texts targeting would serve next
 */
export function closePayload({ competencies, attemptsByCompetency, sessionStart, sessionEnd, ranked, queued }) {
  const timeOf = (v) => (v instanceof Date ? v.getTime() : toUtcDate(v)?.getTime() ?? null);
  const start = timeOf(sessionStart);
  const end = sessionEnd == null ? Infinity : timeOf(sessionEnd) ?? Infinity;
  const logOf = (id) =>
    (attemptsByCompetency instanceof Map ? attemptsByCompetency.get(id) : attemptsByCompetency[id]) ?? [];

  let stageRiser = null;
  let bestRateRise = 0;
  let rateRiser = null;
  for (const c of ranked ?? competencies) {
    const log = logOf(c.id).filter((a) => (toUtcDate(a.created_at)?.getTime() ?? 0) < end);
    if (start == null) continue;
    const pre = replayProgress(log.filter((a) => (toUtcDate(a.created_at)?.getTime() ?? 0) < start));
    const post = replayProgress(log);
    if (stageNumber(post.stage) > stageNumber(pre.stage) && !stageRiser) stageRiser = c;
    const rise = post.successRate - pre.successRate;
    if (rise > bestRateRise) {
      bestRateRise = rise;
      rateRiser = c;
    }
  }

  const pick = stageRiser ?? rateRiser;
  const asLabel = (c) => (c ? { id: c.id, label: c.label } : null);
  return {
    improved: asLabel(pick),
    next: asLabel(ranked?.[0] ?? null),
    queued: (queued ?? []).slice(0, 3),
  };
}

/** Suggest closing from the 6th attempt-turn of a session (~8–12 min of drilling). */
export const SUGGEST_CLOSE_TURNS = 6;

/**
 * The whole targeting derivation both routes share, composed once. src/http.js's header
 * rules out helper modules under functions/, and the two Functions repeating this walk is
 * how the two would drift — so it lives here, pure and tested.
 *
 * Takes the store's rows verbatim; returns:
 *   ranked      the full ranked list (with last_attempt_at joined on)
 *   open        the eligible slice of it, in rank order
 *   target      open[0] or null
 *   demand      nextQuestion() for the target — {question} or {mint}
 *   queued      up to 3 question texts targeting would serve next (mints skipped)
 *   sessions    sessionsOf(attempts)
 *   questionsBy / attemptsBy   Maps keyed by competency id
 */
export function drillState({ competencies, questions, attempts, interviewAt, now = new Date() }) {
  const questionsBy = new Map();
  for (const q of questions) {
    if (!questionsBy.has(q.competency_id)) questionsBy.set(q.competency_id, []);
    questionsBy.get(q.competency_id).push(q);
  }
  const attemptsBy = new Map();
  const lastNonRevealed = new Map();
  for (const a of attempts) {
    if (!attemptsBy.has(a.competency_id)) attemptsBy.set(a.competency_id, []);
    attemptsBy.get(a.competency_id).push(a);
    if (a.mode !== "revealed") lastNonRevealed.set(a.competency_id, a.created_at);
  }

  const ranked = rankCompetencies(
    competencies.map((c) => ({ ...c, last_attempt_at: lastNonRevealed.get(c.id) ?? null })),
  );
  const days = daysToInterview(interviewAt, now);
  const open = eligible(ranked, { daysToInterview: days, now });
  const target = open[0] ?? null;

  const demandOf = (c) =>
    nextQuestion({ questions: questionsBy.get(c.id) ?? [], attempts: attemptsBy.get(c.id) ?? [] });
  const demand = target ? demandOf(target) : { question: null };

  const queued = [];
  for (const c of open) {
    const d = demandOf(c);
    if (d.question) queued.push(d.question.text);
    if (queued.length === 3) break;
  }

  return { ranked, open, target, demand, queued, sessions: sessionsOf(attempts), questionsBy, attemptsBy };
}
