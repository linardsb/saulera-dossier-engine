// POST /prep/api/turn — one turn of the drill (#23). Two actions:
//   { action: "help",    question_id, rung: "nudge" | "reveal" }
//   { action: "attempt", question_id, mode: "recall" | "nudged" | "revealed", answer_text }
//
// THE EXECUTION ORDER IS THE RECOVERY STORY. There is no transaction on D1/Pages, so the
// order below is what makes every failure land somewhere safe:
//   1. Everything that can 4xx runs before anything spends or writes — a caller fault
//      costs nothing.
//   2. The feedback model call runs BEFORE any DB write: a refusal or truncation 502s a
//      turn that left NO state, so the candidate retries and nothing double-counts.
//   3. The writes run in dependency order: recordAttempt -> replay -> setCompetencyProgress
//      -> observeHabit. Each later write is derivable from the attempt log, so a crash
//      between them leaves a stale CACHE, never wrong TRUTH — the next turn's replay heals
//      it. This is why recompute-then-write (ladder.js's invariant) is not optional.
//   4. Variant minting is LAST and DEGRADES, never kills: a mint failure answers the turn
//      with `next_question: null` — the attempt is already safe and the feedback already
//      paid for; the next attempt turn simply re-demands the mint.
//
// Double-submit needs no lock: both requests replay the FULL log, so the second write is
// correct whatever order D1 serialised the inserts in (the cache-vs-truth invariant).
//
// `rung` and `mode` are DIFFERENT words on purpose: a rung is a help step requested, a
// mode is what the attempt turned out to be. One field carrying both meanings is how a
// 'nudge' ends up in the attempt.mode CHECK — which is the DB backstop, not the plan.
//
// ⚠ CANDIDATE ROUTE, and ⚠ stateless with respect to the answer: `answer_text` lives for
// the life of the request — it reaches the feedback call and is persisted NOWHERE
// (attempt.note stays '', decision 13's minimisation: feedback already extracted its
// value, and a stored transcript is candidate data with no reader). It never appears in
// an error message or a log line. Responses are hand-built literals: no store row is ever
// spread into one (projection.js's argument); `rating`, `stage`, `success_rate`,
// `importance`, `difficulty` and `axis` never leave the server.

import Anthropic from "@anthropic-ai/sdk";

import {
  roleByInviteId,
  questionForRole,
  questionsByRole,
  competenciesByRole,
  attemptsByRole,
  recordAttempt,
  setCompetencyProgress,
  insertVariant,
  observeHabit,
  shakyCompetencyIds,
} from "../../../src/portal/store.js";
import { requireSession } from "../../../src/prep/session.js";
import { replayProgress } from "../../../src/prep/ladder.js";
import {
  drillState,
  movement,
  daysToInterview,
  isDayBefore,
  SUGGEST_CLOSE_TURNS,
  DAY_BEFORE_CLOSE_TURNS,
} from "../../../src/prep/targeting.js";
import { HABIT_LABELS, PATTERN_THRESHOLD } from "../../../src/prep/habits.js";
import { feedbackOnAttempt, mintNudge, mintReveal, mintVariant } from "../../../src/prep/drill.js";
import { json, readJson, sameOrigin, errorResponse } from "../../../src/http.js";

// The whole body vocabulary — anything else is a 400, which is what keeps this endpoint
// from quietly growing fields (delete.js's rule).
const ALLOWED = new Set(["action", "question_id", "mode", "rung", "answer_text"]);

// A local cap rather than src/prompt.js's cleanInput: that helper refuses empty input,
// and an empty answer_text is legal here on a revealed turn ("I revealed and moved on"
// is a real state). 20k characters is minutes of monologue past any real answer.
const ANSWER_MAX = 20_000;

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.DB) return json({ error: "not_configured" }, 503);
  if (!sameOrigin(request)) return json({ error: "cross_origin" }, 403);

  try {
    const body = await readJson(request);
    const unexpected = Object.keys(body).filter((key) => !ALLOWED.has(key));
    if (unexpected.length) return json({ error: "unexpected_fields", fields: unexpected }, 400);

    const action = body.action;
    const questionId = String(body.question_id ?? "");
    if (!questionId) return json({ error: "missing_fields" }, 400);

    // The two vocabularies, and the rule that they never cross.
    if (action === "help") {
      if (!["nudge", "reveal"].includes(body.rung)) return json({ error: "missing_fields" }, 400);
      const crossed = ["mode", "answer_text"].filter((k) => body[k] !== undefined);
      if (crossed.length) return json({ error: "unexpected_fields", fields: crossed }, 400);
    } else if (action === "attempt") {
      if (!["recall", "nudged", "revealed"].includes(body.mode)) {
        return json({ error: "missing_fields" }, 400);
      }
      if (body.rung !== undefined) return json({ error: "unexpected_fields", fields: ["rung"] }, 400);
      if (typeof (body.answer_text ?? "") !== "string") return json({ error: "missing_fields" }, 400);
      const text = String(body.answer_text ?? "");
      if (text.length > ANSWER_MAX) return json({ error: "too_long" }, 400);
      // Empty is legal ONLY on a revealed turn.
      if (!text.trim() && body.mode !== "revealed") return json({ error: "missing_fields" }, 400);
    } else {
      return json({ error: "missing_fields" }, 400);
    }

    const session = await requireSession(env.DB, request);
    if (!env.ANTHROPIC_API_KEY) return json({ error: "no_model_key" }, 503);
    // The client is injectable for the test suite (context.data), constructed at the
    // route otherwise — prepare.js's pattern.
    const client = context.data?.client ?? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

    const role = await roleByInviteId(env.DB, session.inviteId);
    if (!role) return json({ error: "not_found" }, 404);

    // THE OWNERSHIP CHECK: 404 on a question under someone else's invite, so questions
    // cannot be attempted — or enumerated — across candidates.
    const question = await questionForRole(env.DB, { questionId, roleId: role.role_id });
    if (!question) return json({ error: "not_found" }, 404);

    // ── the help rungs: model calls, NO attempt row ─────────────────────────────────
    // The rung is not the attempt. The client reports the rung reached in the eventual
    // attempt's `mode` — SPEC records which rung was REACHED, and the attempt is the
    // unit of record.
    if (action === "help") {
      const inputs = { question: question.text, competencyLabel: question.competency_label };
      if (body.rung === "nudge") {
        const { nudge } = await mintNudge(client, inputs);
        return json({ nudge });
      }
      const { skeleton } = await mintReveal(client, inputs);
      return json({ skeleton });
    }

    // ── the attempt ─────────────────────────────────────────────────────────────────
    const mode = body.mode;
    const answerText = String(body.answer_text ?? "");

    // An empty revealed attempt skips the feedback call entirely: there is no answer to
    // give feedback on, and inventing encouragement about a non-attempt is exactly the
    // unearned feedback SPEC's tone rules refuse.
    let feedback = null;
    if (answerText.trim()) {
      feedback = await feedbackOnAttempt(client, {
        question: question.text,
        answerText,
        mode,
        competencyLabel: question.competency_label,
      });
    }

    // The writes, in dependency order (see the header). The competency id comes from the
    // QUESTION ROW — the body has no competency field at all.
    await recordAttempt(env.DB, {
      competencyId: question.competency_id,
      questionId: question.id,
      mode,
      rating: feedback?.rating ?? null,
      note: "",
    });

    const attempts = await attemptsByRole(env.DB, role.role_id);
    const mine = attempts.filter((a) => a.competency_id === question.competency_id);
    const progress = replayProgress(mine);
    await setCompetencyProgress(env.DB, {
      competencyId: question.competency_id,
      stage: progress.stage,
      successRate: progress.successRate,
    });

    // Announce a habit ONLY on the observation that made it exactly 2 — the moment noise
    // becomes a pattern. Every ≥2 turn would be nagging (decision 17's register); the
    // standing list lives on session GET.
    let habit = null;
    if (feedback && feedback.habit !== "none") {
      const { evidenceCount } = await observeHabit(env.DB, {
        roleId: role.role_id,
        label: feedback.habit,
      });
      if (evidenceCount === PATTERN_THRESHOLD) {
        habit = HABIT_LABELS[feedback.habit] ?? feedback.habit;
      }
    }

    // ── the next question, minting LAST and degrading ───────────────────────────────
    const now = new Date();
    const competencies = await competenciesByRole(env.DB, role.role_id);
    const questions = await questionsByRole(env.DB, role.role_id);
    // The debrief's shaky ticks (#77), read here with the other targeting inputs rather than at
    // the top: a debrief saved mid-turn is picked up on the NEXT turn either way, which is the
    // same staleness the competency cache already has and is harmless for the same reason — the
    // ticks only reorder a queue, and the next turn reorders it again.
    const shakyIds = await shakyCompetencyIds(env.DB, role.role_id);
    const state = drillState({ competencies, questions, attempts, interviewAt: role.interview_at, now, shakyIds });

    let nextQuestion = state.demand.question
      ? { id: state.demand.question.id, text: state.demand.question.text }
      : null;
    if (!nextQuestion && state.demand.mint && state.target) {
      try {
        const base = questions.find((q) => q.id === state.demand.mint.variantOf);
        const minted = await mintVariant(client, {
          axis: state.demand.mint.axis,
          baseQuestion: base?.text ?? "",
          competencyLabel: state.target.label,
        });
        const inserted = await insertVariant(env.DB, {
          competencyId: state.target.id,
          text: minted.text,
          variantOf: state.demand.mint.variantOf,
          axis: state.demand.mint.axis,
          difficulty: minted.difficulty,
        });
        nextQuestion = { id: inserted.id, text: inserted.text };
      } catch (err) {
        // Degrade, never discard a paid turn: the attempt row exists and the feedback is
        // in hand. The code alone is logged — a message could quote candidate text.
        console.error("variant mint failed:", err?.code ?? err?.name ?? "unknown");
        nextQuestion = null;
      }
    }

    // We just wrote an attempt, so the last derived session block IS the current one.
    const current = state.sessions[state.sessions.length - 1] ?? [];
    const moved = movement(mine, current[0]?.created_at ?? now) === "up";

    // The day-before close threshold (#25), derived the same way session GET derives it.
    const dayBefore = isDayBefore(daysToInterview(role.interview_at, now));

    return json({
      feedback: feedback ? { worked: feedback.worked, improvement: feedback.improvement } : null,
      habit,
      next_question: nextQuestion,
      competency: { id: question.competency_id, label: question.competency_label, moved },
      turns_this_session: current.length,
      suggest_close: current.length >= (dayBefore ? DAY_BEFORE_CLOSE_TURNS : SUGGEST_CLOSE_TURNS),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
