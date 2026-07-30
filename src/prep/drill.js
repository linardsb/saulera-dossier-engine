// The in-session model call site (#23). Portal architecture §5, second bullet: "In session
// (claude-sonnet-5): feedback on an attempt, lateral/vertical variants, nudges.
// Request/response, one POST per turn."
//
// This mirrors src/prep/generate.js down to the order of its guards, and deliberately does
// NOT import MODEL/EFFORT from src/generate.js: those are the Opus Send call's constants,
// and a session turn is a different animal — one paragraph of feedback where latency is the
// felt-experience risk (§6's "dead air"), not a 48k-token composed brief. NOTHING is shared —
// not even FALLBACK_BETA: claude-sonnet-5 does not support the `fallbacks` parameter (a live
// probe on 30 Jul 2026 confirmed the 400: "'claude-sonnet-5' does not support the `fallbacks`
// parameter"), so a refusal here is answered honestly as a 502 the candidate can retry, and
// the calls ride the plain (non-beta) namespace because nothing beta remains in the request.
//
// THE STRUCTURAL SAFETY RAIL (architecture §3): every schema below is shaped so that "a
// finished answer in the candidate's voice" is UNREPRESENTABLE. Feedback has no field an
// answer could travel in; a nudge is one reframe; a reveal is a list of HEADINGS (the
// StoryBankCard skeleton contract, src/prep/schema.js) — prose in their voice has nowhere
// to go. The assert twins re-enforce the vocabulary at runtime, because a rule living only
// in the schema is an untested claim about a third party's decoder (schema.js's argument).
//
// ⚠ Stateless with respect to candidates. The answer text lives for the life of the call
// and is written nowhere — not to D1 (attempt.note stays ''), not to a log line, not to an
// error message. Prompts carry only question text, competency label and the answer itself.

import { StoreError } from "../store.js";
import { HABITS } from "./habits.js";

export const SESSION_MODEL = "claude-sonnet-5";

/**
 * A turn is one paragraph of feedback, and the candidate is waiting on it. Low effort and
 * a modest cap — the Send call's 48k/"high" reasoning does not transfer. max_tokens caps
 * thinking and text together, so this still leaves adaptive thinking room to move.
 */
export const SESSION_MAX_TOKENS = 8_000;
export const SESSION_EFFORT = "low";

// The two non-negotiables are worded VERBATIM as PREP_SYSTEM rules 1–2 word them —
// test/prep-drill.test.js greps both prompts for the same phrases, which is what keeps the
// two call sites from drifting apart.
export const SESSION_SYSTEM = `You run one turn of a private interview practice drill. Your reader
is a candidate preparing for a confirmed interview. Nothing they do here reaches an employer or a
recruiter — that privacy is what lets you be blunt and specific instead of hedged.

Rules, in order of importance:

1. NEVER write the candidate's answer in their voice. Not a model answer, not a polished
   paragraph they could read out, not a "you could say something like…". A polished answer they
   cannot deliver is worse than a rough one they own, because interviewers hear the seam. What
   you may offer instead: a skeleton of HEADINGS they fill in themselves, a worked example from a
   DIFFERENT scenario than the one they will be asked about, and questions that unstick them.

2. NEVER coach fabrication. Not experience they do not have, not enthusiasm for values they do
   not hold. Help them find and evidence genuine overlap, and name a genuine mismatch plainly —
   that is useful information for the candidate, not a failure.

3. NEVER score, rank, or rate the candidate in anything they will read, and never predict
   whether they will get the job. The rating you return in feedback is internal to the engine
   and is never shown to them. No readiness level, no percentage, no verdict.

4. One improvement, not five. Name the single change that would most improve the answer, and
   say what already worked — specifically, not as padding. Specific over kind, but never a bare
   verdict: "two minutes in before the result landed — lead with it" beats both "good effort"
   and "too long". No encouragement they did not earn.

5. A habit is only what they actually DID in this answer, from the fixed list you are given.
   When you are not sure, say none. Never invent a pattern from one data point, and never
   record a claimed learning style.`;

/* ── the schemas, and their assert twins ───────────────────────────────────────────────── */

const str = (description) => ({ type: "string", description });

export const FEEDBACK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    worked: str(
      "What already worked in this answer, specifically — one or two sentences. Never a " +
        "rewritten answer, never padding.",
    ),
    improvement: str(
      "The ONE change that would most improve this answer, concretely enough to act on next " +
        "attempt. Not a list, not a rewritten answer.",
    ),
    // enum, not minimum/maximum — numeric constraints are rejected by structured outputs.
    rating: {
      type: "integer",
      enum: [1, 2, 3, 4],
      description:
        "Internal to the engine, never shown to the candidate. 1 = no relevant answer, " +
        "2 = relevant but duties-not-outcomes or rambling, 3 = solid, 4 = strong.",
    },
    habit: {
      type: "string",
      enum: [...HABITS, "none"],
      description:
        "What the candidate actually did in THIS answer, from the fixed list — or none. " +
        "Never a guess, never a learning style.",
    },
  },
  required: ["worked", "improvement", "rating", "habit"],
};

export const NUDGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    nudge: str(
      "A reframe or ONE probing sub-question that unsticks the candidate. Content-free: it " +
        "must not contain material the answer itself would — it points, it never supplies.",
    ),
  },
  required: ["nudge"],
};

export const REVEAL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    skeleton: {
      type: "array",
      items: { type: "string" },
      description:
        "HEADINGS THE CANDIDATE FILLS IN — never sentences in the candidate's voice, and " +
        'never a finished answer. Each entry names a part of the answer they must supply ' +
        '("What made escalation difficult"), and must not contain the answer to it.',
    },
  },
  required: ["skeleton"],
};

export const VARIANT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    text: str("The variant question, as an interviewer would actually ask it."),
    difficulty: { type: "string", enum: ["gentle", "standard", "probing"] },
  },
  required: ["text", "difficulty"],
};

const nonEmpty = (value, where) => {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${where}: empty`);
};

const closed = (payload, keys, where) => {
  if (!payload || typeof payload !== "object") throw new Error(`${where}: not an object`);
  for (const key of Object.keys(payload)) {
    if (!keys.includes(key)) throw new Error(`${where}.${key}: outside the vocabulary`);
  }
};

export function assertFeedback(payload) {
  closed(payload, ["worked", "improvement", "rating", "habit"], "feedback");
  nonEmpty(payload.worked, "feedback.worked");
  nonEmpty(payload.improvement, "feedback.improvement");
  if (![1, 2, 3, 4].includes(payload.rating)) throw new Error("feedback.rating: not 1-4");
  if (![...HABITS, "none"].includes(payload.habit)) {
    throw new Error(`feedback.habit: ${payload.habit} is not in the vocabulary`);
  }
  return payload;
}

export function assertNudge(payload) {
  closed(payload, ["nudge"], "nudge");
  nonEmpty(payload.nudge, "nudge.nudge");
  return payload;
}

export function assertReveal(payload) {
  closed(payload, ["skeleton"], "reveal");
  if (!Array.isArray(payload.skeleton)) throw new Error("reveal.skeleton: not an array");
  if (payload.skeleton.length < 1 || payload.skeleton.length > 8) {
    throw new Error("reveal.skeleton: 1-8 headings");
  }
  payload.skeleton.forEach((entry, i) => nonEmpty(entry, `reveal.skeleton[${i}]`));
  return payload;
}

export function assertVariant(payload) {
  closed(payload, ["text", "difficulty"], "variant");
  nonEmpty(payload.text, "variant.text");
  if (!["gentle", "standard", "probing"].includes(payload.difficulty)) {
    throw new Error(`variant.difficulty: ${payload.difficulty}`);
  }
  return payload;
}

/* ── the one call shape ────────────────────────────────────────────────────────────────── */

/**
 * generateBrief's guard order, shared by all four calls: stream → stop_reason guards →
 * find text → parse → assert. Messages are a plain single user turn with NO cache_control:
 * each turn's content is unique, so there is no reusable prefix worth a breakpoint.
 */
async function sessionCall(client, { prompt, schema, assert }) {
  // The PLAIN namespace, deliberately: the Opus calls ride client.beta.messages for the
  // fallback beta, which claude-sonnet-5 rejects (header note above) — nothing beta is
  // left in this request, and the beta surface would be a claim the model cannot honour.
  const stream = client.messages.stream({
    model: SESSION_MODEL,
    max_tokens: SESSION_MAX_TOKENS,
    system: SESSION_SYSTEM,
    thinking: { type: "adaptive" },
    output_config: {
      effort: SESSION_EFFORT,
      // Structured outputs: `output_config.format`, never the deprecated `output_format`.
      format: { type: "json_schema", schema },
    },
    messages: [{ role: "user", content: prompt }],
  });

  const message = await stream.finalMessage();

  if (message.stop_reason === "refusal") {
    throw new StoreError("model_refused", 502, "the model declined this turn");
  }
  if (message.stop_reason === "max_tokens") {
    throw new StoreError("truncated", 502, `turn truncated at ${SESSION_MAX_TOKENS} tokens`);
  }

  const text = (message.content ?? []).find((b) => b.type === "text")?.text;
  if (!text) throw new StoreError("bad_turn", 502, "the model returned no turn");

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new StoreError("bad_turn", 502, "the model's turn was not valid JSON");
  }
  try {
    return assert(parsed);
  } catch (err) {
    // The message never quotes the payload: the payload can quote the answer text.
    throw new StoreError("bad_turn", 502, String(err?.message ?? "not a valid turn"));
  }
}

/* ── the four calls ────────────────────────────────────────────────────────────────────── */

/** Feedback on one attempt: one improvement, one thing that worked, the internal rating. */
export async function feedbackOnAttempt(client, { question, answerText, mode, competencyLabel } = {}) {
  const prompt =
    `The competency being drilled: ${competencyLabel}\n\n` +
    `The interview question:\n<question>\n${question}\n</question>\n\n` +
    `The candidate's answer, given ${
      mode === "revealed"
        ? "after revealing the answer structure"
        : mode === "nudged"
          ? "after one nudge"
          : "cold, from recall"
    }:\n<answer>\n${answerText}\n</answer>\n\n` +
    `Give feedback on this attempt. Never return a bare "wrong": for a behavioural answer there ` +
    `usually isn't one — there's a rambling answer, a duties-not-outcomes answer, an answer with ` +
    `no numbers in it.`;
  return sessionCall(client, { prompt, schema: FEEDBACK_SCHEMA, assert: assertFeedback });
}

/** The first help rung: a reframe or one probing sub-question, never content. */
export async function mintNudge(client, { question, competencyLabel } = {}) {
  const prompt =
    `The competency being drilled: ${competencyLabel}\n\n` +
    `The candidate is stuck on this interview question:\n<question>\n${question}\n</question>\n\n` +
    `Give ONE nudge: a reframe or one probing sub-question that unsticks them. It must not ` +
    `contain material their answer would — it points at where to look, it never supplies what ` +
    `they would say.`;
  return sessionCall(client, { prompt, schema: NUDGE_SCHEMA, assert: assertNudge });
}

/** The second help rung: a skeleton of headings — a model STRUCTURE, still not their answer. */
export async function mintReveal(client, { question, competencyLabel } = {}) {
  const prompt =
    `The competency being drilled: ${competencyLabel}\n\n` +
    `The candidate has asked to reveal the structure of a strong answer to:\n` +
    `<question>\n${question}\n</question>\n\n` +
    `Give a skeleton of HEADINGS they fill in themselves. Each heading names a part of the ` +
    `answer they must supply ("What made escalation difficult") and must not contain the answer ` +
    `to it. Never sentences in their voice.`;
  return sessionCall(client, { prompt, schema: REVEAL_SCHEMA, assert: assertReveal });
}

/**
 * A live variant (decision 6). The AXIS IS THE CALLER'S DECISION, from targeting — the
 * schema has no axis field, so the model cannot re-decide it.
 */
export async function mintVariant(client, { axis, baseQuestion, competencyLabel, roleTitle } = {}) {
  const direction =
    axis === "vertical"
      ? `VERTICAL: the follow-up probe a real interviewer would ask next — "and what would you ` +
        `have done if the stakeholder had refused?" Real interviewers do this, so it is ` +
        `practice, not cruelty.`
      : `LATERAL: the same competency in a different scenario or different company context, at ` +
        `the same difficulty.`;
  const prompt =
    `The competency being drilled: ${competencyLabel}\n` +
    (roleTitle ? `The role: ${roleTitle}\n` : "") +
    `\nThe question the candidate has already answered:\n<question>\n${baseQuestion}\n</question>\n\n` +
    `Write ONE variant along this axis — ${direction}\n\n` +
    `Do not re-ask the base question verbatim or near-verbatim: variation is what makes an ` +
    `answer survive a phrasing the candidate didn't rehearse.`;
  return sessionCall(client, { prompt, schema: VARIANT_SCHEMA, assert: assertVariant });
}
