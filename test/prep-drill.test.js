// #23 — the session call boundary, on the fake-client pattern of test/prep-generate.test.js.
//
// What is worth asserting is the REQUEST each call builds and what it does with the answer:
// the model constant, the schemas' closed shape (no field an answer could travel in), the
// non-negotiables pinned in BOTH system prompts, and the failure register.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SESSION_MODEL,
  SESSION_MAX_TOKENS,
  SESSION_EFFORT,
  SESSION_SYSTEM,
  FEEDBACK_SCHEMA,
  NUDGE_SCHEMA,
  REVEAL_SCHEMA,
  VARIANT_SCHEMA,
  assertFeedback,
  assertNudge,
  assertReveal,
  assertVariant,
  feedbackOnAttempt,
  mintNudge,
  mintReveal,
  mintVariant,
} from "../src/prep/drill.js";
import { PREP_SYSTEM } from "../src/prep/prompt.js";
import { HABITS } from "../src/prep/habits.js";
import { StoreError } from "../src/store.js";

function fakeAnthropic(message) {
  const calls = [];
  return {
    calls,
    // The PLAIN namespace only — no beta. claude-sonnet-5 rejects the `fallbacks`
    // parameter (live 400, 30 Jul 2026), so drill.js rides client.messages; a fake with
    // BOTH namespaces would let the module quietly call the wrong one and still pass.
    messages: {
      stream(request) {
        calls.push(request);
        return { finalMessage: async () => message };
      },
    },
  };
}

const ok = (payload, extra = {}) => ({
  stop_reason: "end_turn",
  content: [{ type: "text", text: JSON.stringify(payload) }],
  ...extra,
});

const FEEDBACK = { worked: "Named the number.", improvement: "Lead with the result.", rating: 3, habit: "none" };
const INPUTS = { question: "Tell me about a difficult visit.", answerText: "I once…", mode: "recall", competencyLabel: "Lone working" };

async function codeOf(fn) {
  try {
    await fn();
    return "did not throw";
  } catch (err) {
    assert.ok(err instanceof StoreError, `expected a StoreError, got ${err}`);
    return err.code;
  }
}

/* ── the request shape ─────────────────────────────────────────────────────────────────── */

test("all four calls name claude-sonnet-5 — never the Send call's Opus", async () => {
  const runs = [
    (c) => feedbackOnAttempt(c, INPUTS),
    (c) => mintNudge(c, INPUTS),
    (c) => mintReveal(c, INPUTS),
    (c) => mintVariant(c, { axis: "lateral", baseQuestion: "Q", competencyLabel: "L" }),
  ];
  const payloads = [FEEDBACK, { nudge: "What changed?" }, { skeleton: ["The setup"] }, { text: "V?", difficulty: "standard" }];

  for (const [i, run] of runs.entries()) {
    const client = fakeAnthropic(ok(payloads[i]));
    await run(client);
    const [req] = client.calls;
    assert.equal(req.model, SESSION_MODEL);
    assert.equal(SESSION_MODEL, "claude-sonnet-5", "architecture §5's session model");
    assert.equal(req.max_tokens, SESSION_MAX_TOKENS);
    assert.equal(req.output_config.effort, SESSION_EFFORT);
    assert.equal(req.output_config.format.type, "json_schema");
    assert.deepEqual(req.thinking, { type: "adaptive" });
    // claude-sonnet-5 does not support `fallbacks` — sending it is a 400 and a dead
    // drill button. The Opus Send call keeps its pair; this call must carry NEITHER.
    assert.equal(req.fallbacks, undefined, "'claude-sonnet-5' rejects the fallbacks parameter");
    assert.equal(req.betas, undefined, "and nothing beta remains in the request");
    assert.equal(req.output_format, undefined, "output_format is deprecated API-wide");
    for (const param of ["temperature", "top_p", "top_k"]) {
      assert.equal(req[param], undefined, `${param} 400s on this model family`);
    }
    const cached = req.messages.flatMap((m) => m.content).filter((b) => b?.cache_control);
    assert.equal(cached.length, 0, "no breakpoint: each turn's content is unique");
  }
});

test("both system prompts carry the two non-negotiables — the AC's 'every model prompt'", () => {
  for (const [name, prompt] of [["SESSION_SYSTEM", SESSION_SYSTEM], ["PREP_SYSTEM", PREP_SYSTEM]]) {
    assert.match(prompt, /candidate's answer in their voice/, `${name} rule 1`);
    assert.match(prompt, /coach fabrication/, `${name} rule 2`);
  }
  assert.match(SESSION_SYSTEM, /internal to the engine/, "the rating never reaches the candidate");
});

/* ── the schemas structurally cannot carry a finished answer ───────────────────────────── */

test("FEEDBACK_SCHEMA is closed: exactly four keys, none answer-shaped", () => {
  assert.equal(FEEDBACK_SCHEMA.additionalProperties, false);
  assert.deepEqual(Object.keys(FEEDBACK_SCHEMA.properties), ["worked", "improvement", "rating", "habit"]);
  assert.deepEqual(FEEDBACK_SCHEMA.required, ["worked", "improvement", "rating", "habit"]);
  assert.deepEqual(FEEDBACK_SCHEMA.properties.rating.enum, [1, 2, 3, 4], "enum, not min/max");
  assert.deepEqual(FEEDBACK_SCHEMA.properties.habit.enum, [...HABITS, "none"]);
});

test("the reveal schema is headings-only, and the nudge is one string", () => {
  assert.deepEqual(Object.keys(REVEAL_SCHEMA.properties), ["skeleton"]);
  assert.equal(REVEAL_SCHEMA.properties.skeleton.items.type, "string");
  assert.equal(REVEAL_SCHEMA.additionalProperties, false);
  assert.deepEqual(Object.keys(NUDGE_SCHEMA.properties), ["nudge"]);
});

test("the variant schema has NO axis field — the axis is the caller's decision", async () => {
  assert.deepEqual(Object.keys(VARIANT_SCHEMA.properties), ["text", "difficulty"]);

  const client = fakeAnthropic(ok({ text: "And if they refused?", difficulty: "probing" }));
  await mintVariant(client, { axis: "vertical", baseQuestion: "Base Q", competencyLabel: "L" });
  const prompt = client.calls[0].messages[0].content;
  assert.match(prompt, /VERTICAL/, "the caller's axis is in the prompt");
  assert.match(prompt, /Base Q/, "the base question travels so it cannot be re-asked verbatim");
  assert.match(prompt, /verbatim/);
});

/* ── the assert twins ──────────────────────────────────────────────────────────────────── */

test("a fifth field or an out-of-vocabulary habit fails assertFeedback", () => {
  assert.throws(() => assertFeedback({ ...FEEDBACK, answer: "Here is what to say…" }), /vocabulary/);
  assert.throws(() => assertFeedback({ ...FEEDBACK, habit: "visual_learner" }), /vocabulary/);
  assert.throws(() => assertFeedback({ ...FEEDBACK, rating: 5 }), /1-4/);
  assert.throws(() => assertFeedback({ ...FEEDBACK, worked: "  " }), /empty/);
  assert.deepEqual(assertFeedback({ ...FEEDBACK }), FEEDBACK, "a clean payload passes through");
});

test("assertReveal bounds the skeleton to 1-8 non-empty headings", () => {
  assert.throws(() => assertReveal({ skeleton: [] }), /1-8/);
  assert.throws(() => assertReveal({ skeleton: Array(9).fill("h") }), /1-8/);
  assert.throws(() => assertReveal({ skeleton: ["ok", ""] }), /empty/);
  assert.ok(assertReveal({ skeleton: ["The setup", "What made it hard"] }));
});

test("assertNudge and assertVariant hold their vocabularies", () => {
  assert.throws(() => assertNudge({ nudge: "x", answer: "y" }), /vocabulary/);
  assert.throws(() => assertVariant({ text: "Q", difficulty: "brutal" }), /difficulty/);
  assert.throws(() => assertVariant({ text: "Q", difficulty: "standard", axis: "lateral" }), /vocabulary/);
});

/* ── the failure register ──────────────────────────────────────────────────────────────── */

test("refusal, truncation and bad shapes each carry their own 502 code", async () => {
  assert.equal(
    await codeOf(() => feedbackOnAttempt(fakeAnthropic(ok(FEEDBACK, { stop_reason: "refusal" })), INPUTS)),
    "model_refused",
  );
  assert.equal(
    await codeOf(() => feedbackOnAttempt(fakeAnthropic(ok(FEEDBACK, { stop_reason: "max_tokens" })), INPUTS)),
    "truncated",
  );
  assert.equal(
    await codeOf(() =>
      feedbackOnAttempt(
        fakeAnthropic({ stop_reason: "end_turn", content: [{ type: "text", text: "not json" }] }),
        INPUTS,
      ),
    ),
    "bad_turn",
  );
  assert.equal(
    await codeOf(() =>
      feedbackOnAttempt(
        fakeAnthropic({ stop_reason: "end_turn", content: [{ type: "thinking", thinking: "…" }] }),
        INPUTS,
      ),
    ),
    "bad_turn",
  );
  assert.equal(
    await codeOf(() => feedbackOnAttempt(fakeAnthropic(ok({ ...FEEDBACK, extra: "field" })), INPUTS)),
    "bad_turn",
  );
});
