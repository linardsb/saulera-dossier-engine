// #19 — the Send-to-Candidate call boundary.
//
// The model call is stubbed. What is worth asserting is not what Claude writes — that is the
// prompt's job and the live run's — but the REQUEST this module builds and what it does with the
// answer. Four classes of thing, all of which fail in production rather than in review:
//
//   - request shape: parameters that 400 on Claude Opus 5, and max_tokens sized for thinking
//   - the cache breakpoint: on the reused visible slice, with the per-candidate inputs after it
//   - the checks: assertBrief and verifyBrief both run BEFORE the payload is returned
//   - the divergence from generatePack: an empty visible slice is legal and still calls the model
//
// The helpers below are copied from test/generate.test.js rather than imported. The repo keeps
// test helpers local, and a shared fake is a shared assumption about the SDK's shape — the exact
// thing each of these files should be asserting for itself.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { generateBrief, MAX_TOKENS } from "../src/prep/generate.js";
import { BRIEF_SCHEMA } from "../src/prep/schema.js";
import { MODEL, EFFORT, FALLBACK_BETA } from "../src/generate.js";
import { StoreError } from "../src/store.js";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), "utf8");

const BRIEF = read("fixtures/prep-brief.md");
const CV = read("fixtures/prep-cv.md");
const FIELDS = JSON.parse(read("fixtures/prep-visible-fields.json"));
const PAYLOAD = JSON.parse(read("fixtures/prep-payload.json"));

const INPUTS = {
  clientName: "Ashdown Park Community Healthcare",
  visibleFields: FIELDS,
  brief: BRIEF,
  cv: CV,
  interviewAt: "2026-08-12",
};

function fakeAnthropic(message) {
  const calls = [];
  return {
    calls,
    // The beta namespace, because the refusal fallback rides the beta endpoint. A fake with
    // BOTH namespaces would let the module quietly call the wrong one and still pass.
    beta: {
      messages: {
        stream(request) {
          calls.push(request);
          return { finalMessage: async () => message };
        },
      },
    },
  };
}

const ok = (payload = PAYLOAD, extra = {}) => ({
  stop_reason: "end_turn",
  content: [{ type: "text", text: JSON.stringify(payload) }],
  usage: { input_tokens: 6000, cache_read_input_tokens: 2400, output_tokens: 2100 },
  ...extra,
});

const payload = () => structuredClone(PAYLOAD);

/* ── the request shape ─────────────────────────────────────────────────────────────────── */

test("the request names Claude Opus 5 and carries nothing that 400s on it", async () => {
  const db = fakeAnthropic(ok());
  await generateBrief(db, INPUTS);
  const [req] = db.calls;

  assert.equal(req.model, MODEL);
  assert.equal(MODEL, "claude-opus-5", "the same model constant the pack call uses — one definition");

  // All four are removed on Claude Opus 5 and return a 400. The failure is a dead Send button,
  // not a degraded brief, so it is worth a test rather than a comment.
  assert.equal(req.thinking?.budget_tokens, undefined, "budget_tokens was removed");
  for (const param of ["temperature", "top_p", "top_k"]) {
    assert.equal(req[param], undefined, `${param} was removed on Claude Opus 5`);
  }
  assert.equal(req.output_format, undefined, "output_format is deprecated API-wide");
});

test("max_tokens leaves room for thinking, which shares the same cap", async () => {
  const db = fakeAnthropic(ok());
  await generateBrief(db, INPUTS);

  assert.equal(db.calls[0].max_tokens, MAX_TOKENS);
  // The measured probe was 1,641 output tokens at effort "low" over a three-line brief. At high
  // effort over a real brief and CV, plus adaptive thinking on the same cap, the floor is 32k.
  assert.ok(MAX_TOKENS >= 32_000, `${MAX_TOKENS} leaves no headroom for thinking`);
  assert.deepEqual(db.calls[0].thinking, { type: "adaptive" });
});

test("structured outputs carry the brief schema itself, not a copy", async () => {
  const db = fakeAnthropic(ok());
  await generateBrief(db, INPUTS);
  const { output_config: config } = db.calls[0];

  assert.equal(config.format.type, "json_schema");
  // Identity, not deep equality: a copy would drift from the schema the walker in
  // prep-schema.test.js guards, and the guard would then be defending nothing that ships.
  assert.equal(config.format.schema, BRIEF_SCHEMA, "the schema is prep/schema.js's");
  // Pinned to the constant, not merely truthy: effort is the one parameter here with a direct
  // latency and cost consequence — "the lever before the pack shrinks" (generate.js:39-45) — and
  // it is imported so a silent drop to "low" cannot pass the way any non-empty string would.
  assert.equal(config.effort, EFFORT, "effort is the pack call's constant — one definition");
  assert.equal(EFFORT, "high");
});

test("the refusal fallback is opted into, with its matched beta header", async () => {
  const db = fakeAnthropic(ok());
  await generateBrief(db, INPUTS);
  const [req] = db.calls;

  // `fallbacks: "default"` (the scalar form) and server-side-fallback-2026-07-01 are a matched
  // pair; the array form with this header is a 400. Both come from src/generate.js.
  assert.equal(req.fallbacks, "default");
  assert.ok(req.betas?.includes(FALLBACK_BETA), "the fallback rides its beta header");
});

test("the system prompt is PREP_SYSTEM, and it is inside the cached prefix", async () => {
  const db = fakeAnthropic(ok());
  await generateBrief(db, INPUTS);
  // Render order is tools → system → messages, so system sits inside the cached prefix too.
  assert.match(db.calls[0].system, /NEVER write the candidate's answer in their voice/);
});

/* ── the cache breakpoint ──────────────────────────────────────────────────────────────── */

test("the breakpoint is on the visible slice, with the per-candidate inputs after it", async () => {
  const db = fakeAnthropic(ok());
  await generateBrief(db, INPUTS);
  const blocks = db.calls[0].messages[0].content;

  const cached = blocks.filter((b) => b.cache_control);
  assert.equal(cached.length, 1, "exactly one breakpoint");
  assert.equal(cached[0], blocks[0], "and it is the FIRST block — a prefix, not a suffix");
  assert.ok(cached[0].text.includes(FIELDS[0].text.trim()), "the slice is reused per candidate");

  // Inside the cached prefix, the brief and CV would invalidate it on every candidate and the
  // cache would never read — which is the whole ~30p-per-call economics of decision 6.
  assert.ok(!cached[0].text.includes(BRIEF), "the brief must sit AFTER the breakpoint");
  assert.ok(!cached[0].text.includes(CV), "the CV must sit AFTER the breakpoint");
  assert.ok(blocks[1].text.includes(BRIEF) && blocks[1].text.includes(CV));
});

/* ── the engagement stamp (#50) ────────────────────────────────────────────────────────── */

test("engagement is computed from the cleaned inputs, stamped on the payload, and told to the prompt", async () => {
  // The fixture brief says "permanent" outright; the other two are the same brief re-worded.
  // The stamp is src/domain.js's own read — deterministic, never the model's.
  const cases = [
    [BRIEF, "permanent"],
    ["Locum radiographer, day rate £320, inside IR35. CT and MRI lists.", "locum"],
    ["Radiographer needed for a busy imaging department.", "unknown"],
  ];
  for (const [brief, expected] of cases) {
    const db = fakeAnthropic(ok());
    const result = await generateBrief(db, { ...INPUTS, brief });
    assert.equal(result.payload.engagement, expected, `${expected} brief`);

    // And the prompt saw the same flag: the locum call's second block asks for the primer, the
    // others carry the one-line perm rule. The cached first block never varies (prep-prompt's
    // byte-identity test owns that half).
    const inputs = db.calls[0].messages[0].content[1].text;
    assert.equal(inputs.includes("This is a locum booking"), expected === "locum");
  }
});

test("a fabricated competency quote comes back demoted, marked, and not dropped", async () => {
  const result = await generateBrief(fakeAnthropic(ok()), INPUTS);

  assert.equal(result.payload.competencies.length, 3, "every competency the model wrote comes back");
  assert.equal(result.payload.competencies[0].verified, true, "a real quote is left alone");
  assert.equal(result.payload.competencies[2].verified, false);
  assert.equal(
    result.payload.competencies[2].failed_quote,
    PAYLOAD.competencies[2].source_quote,
    "what it thought it was citing is preserved, which is what makes a bad brief diagnosable",
  );
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].reason, "quote not found in the brief");
  assert.deepEqual(result.provenance, {
    sourced: 2,
    unverified: 1,
    total: 3,
    panel_sourced: 2,
    panel_unsourced: 0,
    panel_total: 2,
    primer_sourced: 0,
    primer_unsourced: 0,
    primer_total: 0,
  });
});

test("a panel claim naming a field key that was not handed in is demoted too", async () => {
  const p = payload();
  p.blocks[2].props.panel[0].source_field_key = "why-candidates-have-been-turned-down";
  const result = await generateBrief(fakeAnthropic(ok(p)), INPUTS);

  // The realistic bad case: a real heading from the note that the recruiter did NOT tick. The
  // model cannot have seen it, so naming it means it invented the attribution.
  assert.equal(result.payload.blocks[2].props.panel[0].source_field_key, "");
  assert.ok(result.failures.some((f) => f.kind === "panel_source"));
});

test("a block name outside the vocabulary throws before the payload is returned", async () => {
  // assertBrief, not the schema: the schema's `const` is enforced by Anthropic's decoder at
  // request time, where the fake cannot reach it. This is the enforcement AC #1 names.
  const p = payload();
  p.blocks[0].name = "ModelAnswerCard";

  await assert.rejects(
    () => generateBrief(fakeAnthropic(ok(p)), INPUTS),
    /not in the vocabulary/,
  );
});

test("a shape failure is a 502 bad_brief, in the register of every other model failure here", async () => {
  // assertBrief throws a PLAIN Error by design — schema.js calls it "a shape bug, not an HTTP
  // outcome" — so the route would answer `500 internal`, which DEPLOY.md's triage table reads as
  // "the migration did not run". The operator would be sent to `npm run db:remote` for a payload
  // problem. Every branch is exercised: these are all rules BRIEF_SCHEMA cannot state, so a
  // payload the decoder accepted reaches them.
  const noQuestions = payload();
  noQuestions.questions = noQuestions.questions.filter(
    (q) => q.competency_id !== noQuestions.competencies[0].id,
  );
  assert.equal(await codeOf(() => generateBrief(fakeAnthropic(ok(noQuestions)), INPUTS)), "bad_brief");

  // Appended, not renamed: the duplicate is then the ONLY defect, so this asserts the
  // uniqueness rule rather than the dangling reference a rename would also create.
  const duped = payload();
  duped.competencies.push({ ...duped.competencies[2] });
  assert.equal(await codeOf(() => generateBrief(fakeAnthropic(ok(duped)), INPUTS)), "bad_brief");

  const axis = payload();
  axis.questions[0].axis = "lateral";
  assert.equal(await codeOf(() => generateBrief(fakeAnthropic(ok(axis)), INPUTS)), "bad_brief");

  // The message survives the wrap: errorResponse sends the browser only the code, so this
  // sentence reaches the LOG — where it is the one line saying WHICH rule the answer broke.
  await assert.rejects(
    () => generateBrief(fakeAnthropic(ok(duped)), INPUTS),
    /already taken/,
  );
});

/* ── the answers that are not a prep brief ─────────────────────────────────────────────── */

async function codeOf(fn) {
  try {
    await fn();
    return "did not throw";
  } catch (err) {
    assert.ok(err instanceof StoreError, `expected a StoreError, got ${err}`);
    return err.code;
  }
}

test("a refusal, a truncation and unparseable output are each their own error", async () => {
  assert.equal(
    await codeOf(() => generateBrief(fakeAnthropic(ok(PAYLOAD, { stop_reason: "refusal" })), INPUTS)),
    "model_refused",
  );
  // The dangerous one: a truncated payload is a half-written prep brief, not an error, unless
  // stop_reason is checked before the text is parsed.
  assert.equal(
    await codeOf(() => generateBrief(fakeAnthropic(ok(PAYLOAD, { stop_reason: "max_tokens" })), INPUTS)),
    "truncated",
  );
  assert.equal(
    await codeOf(() => generateBrief(
      fakeAnthropic({ stop_reason: "end_turn", content: [{ type: "text", text: "not json" }] }),
      INPUTS,
    )),
    "no_brief",
  );
  assert.equal(
    await codeOf(() => generateBrief(
      fakeAnthropic({ stop_reason: "end_turn", content: [{ type: "thinking", thinking: "…" }] }),
      INPUTS,
    )),
    "no_brief",
  );
});

test("an empty or over-long brief or CV is refused before the model call", async () => {
  const db = fakeAnthropic(ok());
  assert.equal(await codeOf(() => generateBrief(db, { ...INPUTS, brief: "" })), "missing_fields");
  assert.equal(await codeOf(() => generateBrief(db, { ...INPUTS, cv: "  " })), "missing_fields");
  assert.equal(
    await codeOf(() => generateBrief(db, { ...INPUTS, cv: "x".repeat(100_001) })),
    "too_long",
  );
  assert.equal(db.calls.length, 0, "and it costs nothing");
});

test("an empty visible slice STILL calls the model — the divergence from note_empty", async () => {
  // generatePack refuses a client with no note, because the note is the pack's whole premise.
  // Here decision 2 makes per-field visibility the RECRUITER'S control: sharing nothing is a
  // legitimate choice, and the prep brief still has the brief and the CV. Refusing would turn a
  // privacy decision into a broken button in front of them.
  const db = fakeAnthropic(ok());
  const result = await generateBrief(db, { ...INPUTS, visibleFields: [] });

  assert.equal(db.calls.length, 1, "the call happens");
  assert.equal(result.payload.competencies.length, 3);
  // Every panel claim is unsourceable now, and says so rather than throwing.
  assert.equal(result.failures.filter((f) => f.kind === "panel_source").length, 2);
});

test("the duration is measured here, server-side, and the usage is passed through", async () => {
  const result = await generateBrief(fakeAnthropic(ok()), INPUTS);
  assert.ok(Number.isInteger(result.duration_ms) && result.duration_ms >= 0);
  // cache_read_input_tokens is how you tell the breakpoint is actually caching — a slice under
  // Claude Opus 5's 512-token minimum silently does not cache rather than erroring.
  assert.equal(result.usage.cache_read_input_tokens, 2400);
});

test("no candidate text reaches an error message", async () => {
  // src/prompt.js:126-128 — the message names the field and never carries the value. The CV is
  // the most sensitive thing this call touches and it is written nowhere, including here.
  const db = fakeAnthropic(ok());
  try {
    await generateBrief(db, { ...INPUTS, cv: "x".repeat(100_001) });
    assert.fail("expected a StoreError");
  } catch (err) {
    assert.ok(!err.message.includes("xxx"), "the value must not be in the message");
    assert.match(err.message, /^cv: /);
  }
});
