// GET /prep/api/session -> 200 { competencies, next_question, habits, last_close,
//                                turns_this_session, suggest_close }
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
} from "../../../src/portal/store.js";
import { requireSession } from "../../../src/prep/session.js";
import {
  drillState,
  leastRecentlyAttempted,
  movement,
  closePayload,
  SESSION_GAP_MINUTES,
  SUGGEST_CLOSE_TURNS,
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

    const state = drillState({ competencies, questions, attempts, interviewAt: role.interview_at, now });

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

    // Zero model calls: a {mint} demand degrades to re-serving, never to the sdk.
    let nextQuestion = state.demand.question ?? null;
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
      suggest_close: current ? current.length >= SUGGEST_CLOSE_TURNS : false,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
