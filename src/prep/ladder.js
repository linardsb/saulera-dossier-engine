// The readiness ladder as pure rules (#23). SPEC "Readiness ladder" is the table these
// transitions transcribe; SPEC "State" supplies the sentence that makes the rest honest:
// "a revealed answer must never raise success_rate, or the ladder inflates and the candidate
// walks into the interview believing stage 3."
//
// THE CACHE-VS-TRUTH INVARIANT, which everything downstream leans on: the attempt log is the
// only source of truth, and `competency.stage` / `competency.success_rate` are recompute-then-
// write caches of `replayProgress` over that log. Anything derivable from the log — "moved this
// session", crash recovery between untransacted writes, double-submit convergence — is derived
// by replaying, never by trusting the stored columns.
//
// Stage 4 (`under_pressure`) exists in the vocabulary and nothing in the pilot writes it —
// pressure mode is post-pilot (architecture decision 21).
//
// Pure like src/prep/dates.js: no D1, no HTTP, no `node:` imports — this runs at the edge.
// Attempts are plain objects `{mode, rating, axis, created_at}` (axis of the question
// attempted, null for core), oldest-first; the store shapes them.

/** The stage vocabulary. '' is the DDL default #22 left: not yet stage 1. */
export const STAGES = ["", "can_answer", "holds_up", "unaided", "under_pressure"];

/** 0–4, and 0 for anything outside the vocabulary — fail toward "not yet started". */
export function stageNumber(stage) {
  const n = STAGES.indexOf(stage);
  return n === -1 ? 0 : n;
}

/** Success = rating ≥ 3 (3 solid, 4 strong; 1–2 are not there yet). */
export const SUCCESS_RATING = 3;

/** A successful attempt the ladder may count: non-revealed, rated at or above the bar. */
export function isSuccess(attempt) {
  return attempt.mode !== "revealed" && (attempt.rating ?? 0) >= SUCCESS_RATING;
}

/**
 * THE HONESTY RULE. Revealed attempts are excluded from the numerator AND the denominator:
 * a revealed attempt can never raise the rate, whatever its rating — and excluding it from
 * successes only would make reveals LOWER the rate, which punishes using the help ladder
 * and is not the rule. The row still exists for re-queueing and the "fewer nudges" signal.
 */
export function successRate(attempts) {
  const counted = attempts.filter((a) => a.mode !== "revealed");
  if (!counted.length) return 0;
  return counted.filter(isSuccess).length / counted.length;
}

/**
 * One step up the ladder, or stay — monotonic, single-step, never down. `attempts` is the
 * whole ordered log for the competency (oldest first), so a turn can never jump '' →
 * holds_up: the fold in replayProgress applies this once per attempt.
 *
 *   ''         → can_answer  any non-revealed success (a nudged success counts — SPEC:
 *                            "with notes or a nudge")
 *   can_answer → holds_up    ≥ 4 non-revealed attempts, rate ≥ 0.6, and ≥ 1 successful
 *                            non-revealed attempt on a variant question — SPEC: "differently-
 *                            worded versions and follow-up probes; a rate needs a sample".
 *                            One good answer stays stage 1 by construction.
 *   holds_up   → unaided     the last 3 non-revealed attempts all recall and successful —
 *                            SPEC: "without notes, fewer nudges"
 *   unaided    → (stays)     stage 4 is post-pilot (decision 21)
 */
export function nextStage({ stage, attempts }) {
  const counted = attempts.filter((a) => a.mode !== "revealed");

  if (stage === "") {
    return counted.some(isSuccess) ? "can_answer" : "";
  }
  if (stage === "can_answer") {
    const variantSuccess = counted.some(
      (a) => (a.axis === "lateral" || a.axis === "vertical") && isSuccess(a),
    );
    return counted.length >= 4 && successRate(attempts) >= 0.6 && variantSuccess
      ? "holds_up"
      : "can_answer";
  }
  if (stage === "holds_up") {
    const last = counted.slice(-3);
    return last.length === 3 && last.every((a) => a.mode === "recall" && isSuccess(a))
      ? "unaided"
      : "holds_up";
  }
  return stage;
}

/**
 * The pure fold that IS the competency's progress: walk the ordered log applying nextStage
 * after each attempt, return `{stage, successRate}`. Callable on any prefix of the log,
 * which is how "moved this session" is computed everywhere — fold the pre-session prefix,
 * fold the whole log, compare. Two double-submitted turns each replay the full log, so the
 * second write is correct whatever order D1 serialised the inserts in.
 */
export function replayProgress(attempts) {
  let stage = "";
  const seen = [];
  for (const attempt of attempts) {
    seen.push(attempt);
    stage = nextStage({ stage, attempts: seen });
  }
  return { stage, successRate: successRate(attempts) };
}
