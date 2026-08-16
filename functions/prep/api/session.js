// GET /prep/api/session -> 200 { competencies, next_question, habits, last_close,
//                                turns_this_session, suggest_close, day_before,
//                                day_before_focus }
//
// The drill's resume point (#23): everything a candidate's browser needs to pick the
// session back up, derived entirely from D1 — there is no session table, so there is
// nothing to go stale. ZERO MODEL CALLS and ZERO ANTHROPIC_API_KEY READS, structurally:
// this file imports neither the sdk nor drill.js, which is the "cached core questions
// return without a model call" AC made un-regressable. If targeting demands a mint here,
// the least-recently-attempted question is served instead — the next attempt turn (POST
// /prep/api/turn) is where minting happens.
//
// ⚠ CANDIDATE ROUTE — same posture as brief.js: the /prep tree is Access-bypassed, the
// invite cookie via requireSession is the only door, and the middleware already ran the
// purge. No sameOrigin on a GET (src/http.js:41-43).
//
// THE PROJECTION DISCIPLINE (projection.js's argument, restated because this response is
// built from the engine's own rows): the response object is written as a LITERAL — no
// spread of a store row, because a spread is one refactor away from shipping `importance`,
// `stage`, `success_rate` or `difficulty` to a browser. Competencies carry {id, label,
// covered, moved}; questions carry {id, text}; habits are plain-language strings.

import {
  roleByInviteId,
  competenciesByRole,
  questionsByRole,
  attemptsByRole,
  habitsByRole,
  shakyCompetencyIds,
} from "../../../src/portal/store.js";
import { requireSession } from "../../../src/prep/session.js";
import {
  drillState,
  leastRecentlyAttempted,
  movement,
  closePayload,
  daysToInterview,
  isDayBefore,
  confidenceQuestion,
  SESSION_GAP_MINUTES,
  SUGGEST_CLOSE_TURNS,
  DAY_BEFORE_CLOSE_TURNS,
} from "../../../src/prep/targeting.js";
import { surfacedHabits, HABIT_LABELS } from "../../../src/prep/habits.js";
import { toUtcDate } from "../../../src/prep/dates.js";
import { json, errorResponse } from "../../../src/http.js";

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!env.DB) return json({ error: "not_configured" }, 503);

  try {
    const session = await requireSession(env.DB, request);

    const role = await roleByInviteId(env.DB, session.inviteId);
    // A real state, not an error: the invite exists and the handover has not been
    // written (brief.js's register). The page says "not ready yet" rather than failing.
    if (!role) return json({ error: "not_found" }, 404);

    const now = new Date();
    const competencies = await competenciesByRole(env.DB, role.role_id);
    const questions = await questionsByRole(env.DB, role.role_id);
    const attempts = await attemptsByRole(env.DB, role.role_id);
    const habitRows = await habitsByRole(env.DB, role.role_id);
    // The candidate's own debrief ticks (#77). Ids only — a shaky competency ranks as though it
    // were a stage lower, and NOTHING about it is shown: the flag stays inside targeting, and the
    // competency literals below name four fields, none of them this one.
    const shakyIds = await shakyCompetencyIds(env.DB, role.role_id);

    const state = drillState({ competencies, questions, attempts, interviewAt: role.interview_at, now, shakyIds });

    // Day-before is DERIVED, never stored (#25): the same route `now`, the same stamp the
    // spacing already reads. Day-of counts; post-interview does not.
    const days = daysToInterview(role.interview_at, now);
    const dayBefore = isDayBefore(days);

    // The session boundary is derived, never stored: the last block of attempts is the
    // CURRENT session only while its last attempt is under 30 minutes old.
    const sessions = state.sessions;
    const last = sessions[sessions.length - 1] ?? null;
    const lastTime = last ? (toUtcDate(last[last.length - 1].created_at)?.getTime() ?? 0) : 0;
    const currentIsLive = last !== null && now.getTime() - lastTime <= SESSION_GAP_MINUTES * 60_000;
    const current = currentIsLive ? last : null;
    const completed = currentIsLive ? sessions.slice(0, -1) : sessions;

    // Close payload of the LAST COMPLETED session (SPEC Session shape 3), null if none.
    let lastClose = null;
    const closing = completed[completed.length - 1] ?? null;
    if (closing) {
      const after = sessions[completed.length] ?? null; // the session following it
      lastClose = closePayload({
        competencies,
        attemptsByCompetency: state.attemptsBy,
        sessionStart: closing[0].created_at,
        sessionEnd: after ? after[0].created_at : null,
        ranked: state.ranked,
        queued: state.queued,
      });
    }

    // `moved` is scoped to the LATEST session's attempts, not all-time — the same
    // replay-based definition turn.js uses; the stored stage columns cannot answer it.
    const latest = current ?? closing;
    const movedIds = new Set();
    if (latest) {
      for (const c of competencies) {
        const log = state.attemptsBy.get(c.id) ?? [];
        if (movement(log, latest[0].created_at) === "up") movedIds.add(c.id);
      }
    }

    // The confidence rep (#25): a day-before session that has not started yet opens on the
    // candidate's strongest covered competency, and falls back to normal targeting when no
    // competency has a success to open on.
    let nextQuestion = null;
    if (dayBefore && !current) {
      nextQuestion = confidenceQuestion({
        ranked: state.ranked,
        questionsBy: state.questionsBy,
        attemptsBy: state.attemptsBy,
      });
    }

    // Zero model calls: a {mint} demand degrades to re-serving, never to the sdk.
    if (!nextQuestion) nextQuestion = state.demand.question ?? null;
    if (!nextQuestion && state.demand.mint && state.target) {
      nextQuestion = leastRecentlyAttempted(
        state.questionsBy.get(state.target.id) ?? [],
        state.attemptsBy.get(state.target.id) ?? [],
      );
    }

    return json({
      competencies: competencies.map((c) => ({
        id: c.id,
        label: c.label,
        covered: (state.attemptsBy.get(c.id) ?? []).length > 0,
        moved: movedIds.has(c.id),
      })),
      next_question: nextQuestion ? { id: nextQuestion.id, text: nextQuestion.text } : null,
      habits: surfacedHabits(habitRows).map((h) => HABIT_LABELS[h.label] ?? h.label),
      last_close: lastClose,
      turns_this_session: current ? current.length : 0,
      suggest_close: current
        ? current.length >= (dayBefore ? DAY_BEFORE_CLOSE_TURNS : SUGGEST_CLOSE_TURNS)
        : false,
      day_before: dayBefore,
      // Labels in RANK order, because `competencies` above is store order (by id) — the
      // DayBeforeMode focus list must name the top-ranked ones. Labels only, never a rank.
      day_before_focus: dayBefore ? state.ranked.slice(0, 3).map((c) => c.label) : [],
      // Whether the debrief page has anything to offer (#77) — the same day-granularity gate
      // /prep/api/debrief applies, off the `days` already computed above rather than a second
      // reading of the stamp. Not candidate data worth withholding: it is derived from a date
      // the candidate already knows.
      debrief_available: days <= 0,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
