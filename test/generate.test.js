// #6 — the single model-call boundary.
//
// The model call is stubbed. What is worth asserting here is not what Claude writes — that is
// the spike's job and the prompt's — but the REQUEST this module builds and what it does with
// the answer. Three classes of thing, all of which fail in production rather than in review:
//
//   - request shape: parameters that 400 on Claude Opus 5, and max_tokens sized for thinking
//   - the cache breakpoint: on the reused client note, with the per-submission inputs after it
//   - the verifier: it runs BEFORE the pack is returned, and it demotes rather than drops
//
// The fake records the request and hands back a canned message, so none of this needs a key.

import { test } from "node:test";
import assert from "node:assert/strict";

import { generatePack, MODEL, MAX_TOKENS, FALLBACK_BETA } from "../src/generate.js";
import { PACK_SCHEMA } from "../src/pack.js";
import { StoreError } from "../src/store.js";

const CV = "Senior Staff Nurse, Orthopaedic Theatres, 2018-2026. NMC PIN 04H1234E.";
const NOTE = "Panel is always Sarah (theatre manager) plus one senior scrub. They run a scenario.";

const INPUTS = {
  clientName: "Ashdown Park Community Healthcare",
  clientNote: NOTE,
  brief: "Theatre nurse, nights, three months.",
  cv: CV,
};

/** A pack whose quotes are all genuinely in CV/NOTE, plus one fabricated citation. */
const PACK = {
  candidate_ref: "C-4471",
  role_title: "Theatre Nurse (Scrub)",
  headline: "Eight years scrub, available at two weeks' notice.",
  evidence: [
    {
      requirement: "NMC registration",
      text: "Holds current NMC registration.",
      source_quote: "NMC PIN 04H1234E",
      source_type: "cv",
    },
    {
      requirement: "Paediatric theatre experience",
      text: "Has extensive paediatric theatre experience.",
      // Not in the CV. This is the fabricated-citation case the verifier exists for.
      source_quote: "Twelve years in paediatric theatres",
      source_type: "cv",
    },
  ],
  process_fit: [
    {
      text: "Expect a clinical scenario rather than a competency grid.",
      source_quote: "They run a scenario",
      source_type: "client_note",
    },
  ],
  gaps: [
    { text: "No documented ITU experience.", source_quote: "", source_type: "unverified" },
  ],
  open_questions: ["Confirm the start date."],
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

const ok = (pack = PACK, extra = {}) => ({
  stop_reason: "end_turn",
  content: [{ type: "text", text: JSON.stringify(pack) }],
  usage: { input_tokens: 4000, cache_read_input_tokens: 3200, output_tokens: 900 },
  ...extra,
});

/* ── the request shape ─────────────────────────────────────────────────────────────────── */

test("the request names Claude Opus 5 and carries nothing that 400s on it", async () => {
  const db = fakeAnthropic(ok());
  await generatePack(db, INPUTS);
  const [req] = db.calls;

  assert.equal(req.model, MODEL);
  assert.equal(MODEL, "claude-opus-5");

  // All four are removed on Claude Opus 5 and return a 400 — the failure is a dead endpoint,
  // not a degraded pack, so it is worth a test rather than a comment.
  assert.equal(req.thinking?.budget_tokens, undefined, "budget_tokens was removed");
  for (const param of ["temperature", "top_p", "top_k"]) {
    assert.equal(req[param], undefined, `${param} was removed on Claude Opus 5`);
  }
  // The deprecated spelling. `output_config.format` is the one that still works.
  assert.equal(req.output_format, undefined, "output_format is deprecated API-wide");
});

test("max_tokens leaves room for thinking, which shares the same cap", async () => {
  // Thinking is ON BY DEFAULT on Claude Opus 5 and max_tokens caps thinking + response text
  // TOGETHER. A cap sized around the pack alone truncates it mid-page.
  const db = fakeAnthropic(ok());
  await generatePack(db, INPUTS);

  assert.equal(db.calls[0].max_tokens, MAX_TOKENS);
  assert.ok(MAX_TOKENS >= 16_000, `${MAX_TOKENS} leaves no headroom for thinking`);
  assert.deepEqual(db.calls[0].thinking, { type: "adaptive" });
});

test("structured outputs carry the pack schema, and effort is set", async () => {
  const db = fakeAnthropic(ok());
  await generatePack(db, INPUTS);
  const { output_config: config } = db.calls[0];

  assert.equal(config.format.type, "json_schema");
  assert.equal(config.format.schema, PACK_SCHEMA, "the schema is #4's, not a copy");
  assert.ok(config.effort, "effort is the lever before the pack shrinks (§5.2)");
});

test("the call streams, because a minutes-long request should not be held on one response",
  async () => {
    const db = fakeAnthropic(ok());
    await generatePack(db, INPUTS);
    // A non-streaming call at this max_tokens is what the SDK's own timeout guidance warns
    // about; `stream()` is also what `.finalMessage()` hangs off.
    assert.equal(db.calls.length, 1);
  });

test("the refusal fallback is opted into, because a false-positive decline is a dead button",
  async () => {
    // Claude Opus 5's safety classifiers can decline a benign request. `fallbacks: "default"`
    // re-runs a declined request on Anthropic's recommended substitute in the same round trip;
    // without it a false positive surfaces to a recruiter as a pack that simply never comes.
    const db = fakeAnthropic(ok());
    await generatePack(db, INPUTS);
    const [req] = db.calls;

    assert.equal(req.fallbacks, "default");
    assert.ok(req.betas?.includes(FALLBACK_BETA), "the fallback rides its beta header");
  });

/* ── the cache breakpoint ──────────────────────────────────────────────────────────────── */

test("the cache breakpoint is on the client note, with the per-submission inputs after it",
  async () => {
    const db = fakeAnthropic(ok());
    await generatePack(db, INPUTS);
    const blocks = db.calls[0].messages[0].content;

    const cached = blocks.filter((b) => b.cache_control);
    assert.equal(cached.length, 1, "exactly one breakpoint");
    assert.equal(cached[0], blocks[0], "and it is the FIRST block — a prefix, not a suffix");
    assert.ok(cached[0].text.includes(NOTE), "the note is what gets reused across packs");

    // The whole point: brief and CV vary per submission. Inside the cached prefix they would
    // invalidate it on every request and the cache would never read.
    assert.ok(!cached[0].text.includes(INPUTS.brief), "the brief must sit AFTER the breakpoint");
    assert.ok(!cached[0].text.includes(CV), "the CV must sit AFTER the breakpoint");
    assert.ok(blocks[1].text.includes(INPUTS.brief) && blocks[1].text.includes(CV));
  });

test("the system prompt is the spike's, unrewritten", async () => {
  const db = fakeAnthropic(ok());
  await generatePack(db, INPUTS);
  // Render order is tools → system → messages, so system sits inside the cached prefix too.
  assert.match(db.calls[0].system, /NEVER write a claim you cannot source/);
});

/* ── the imaging domain read (#46) ─────────────────────────────────────────────────────── */

const IMAGING_INPUTS = {
  clientName: "East Sussex Imaging",
  clientNote: NOTE,
  brief: "Locum MRI/CT Radiographer. Siemens Aera and Vida, Canon CT. HCPC essential. Day rate.",
  cv: "HCPC-registered Diagnostic Radiographer. Siemens and GE MRI; Canon CT.",
};

test("an imaging brief puts the domain block in the request, after the cached note", async () => {
  const db = fakeAnthropic(ok());
  await generatePack(db, IMAGING_INPUTS);
  const blocks = db.calls[0].messages[0].content;

  assert.ok(blocks[1].text.includes("HCPC"), "the domain guidance rides the second block");
  // The cached prefix stays brief-independent: bare note block, breakpoint intact.
  assert.ok(!blocks[0].text.includes("HCPC"));
  assert.deepEqual(blocks[0].cache_control, { type: "ephemeral" });
});

test("the result carries the deterministic brief profile", async () => {
  const imaging = await generatePack(fakeAnthropic(ok()), IMAGING_INPUTS);
  assert.equal(imaging.brief_profile.role_shape, "locum");
  assert.equal(imaging.brief_profile.imaging, true);

  const nursing = await generatePack(fakeAnthropic(ok()), INPUTS);
  assert.equal(nursing.brief_profile.imaging, false);
  // And the nursing request itself is untouched by the imaging vocabulary.
  const db = fakeAnthropic(ok());
  await generatePack(db, INPUTS);
  assert.ok(!JSON.stringify(db.calls[0].messages).includes("HCPC"));
});

/* ── the verifier runs before the pack is returned (AC6) ───────────────────────────────── */

test("a fabricated citation is demoted, not returned as sourced", async () => {
  const result = await generatePack(fakeAnthropic(ok()), INPUTS);

  const fabricated = result.pack.evidence[1];
  assert.equal(fabricated.source_type, "unverified", "the quote is not in the CV");
  assert.equal(fabricated.failed_quote, "Twelve years in paediatric theatres",
    "what it thought it was citing is preserved, which is what makes a bad pack diagnosable");
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].reason, "quote not found in source");
});

test("no claim is dropped, and a real quote survives", async () => {
  const result = await generatePack(fakeAnthropic(ok()), INPUTS);

  const claims = [...result.pack.evidence, ...result.pack.process_fit, ...result.pack.gaps];
  assert.equal(claims.length, 4, "every claim the model wrote comes back");
  assert.equal(result.pack.evidence[0].source_type, "cv", "a real quote is left alone");
  assert.equal(result.pack.process_fit[0].source_type, "client_note");
  assert.deepEqual(result.provenance, { cv: 1, client_note: 1, unverified: 2, total: 4 });
});

/* ── the answers that are not a pack ───────────────────────────────────────────────────── */

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
    await codeOf(() => generatePack(fakeAnthropic(ok(PACK, { stop_reason: "refusal" })), INPUTS)),
    "model_refused",
  );
  // The dangerous one: a truncated pack is a half-written submission, not an error, unless
  // stop_reason is checked before the text is parsed.
  assert.equal(
    await codeOf(() => generatePack(fakeAnthropic(ok(PACK, { stop_reason: "max_tokens" })), INPUTS)),
    "truncated",
  );
  assert.equal(
    await codeOf(() => generatePack(
      fakeAnthropic({ stop_reason: "end_turn", content: [{ type: "text", text: "not json" }] }),
      INPUTS,
    )),
    "no_pack",
  );
});

test("a client with no note is refused before the model call", async () => {
  const db = fakeAnthropic(ok());
  assert.equal(
    await codeOf(() => generatePack(db, { ...INPUTS, clientNote: "   " })),
    "note_empty",
  );
  assert.equal(db.calls.length, 0, "and it costs nothing — the note IS the product");
});

test("an empty or over-long brief or CV is refused before the model call", async () => {
  const db = fakeAnthropic(ok());
  assert.equal(await codeOf(() => generatePack(db, { ...INPUTS, brief: "" })), "missing_fields");
  assert.equal(await codeOf(() => generatePack(db, { ...INPUTS, cv: "  " })), "missing_fields");
  assert.equal(
    await codeOf(() => generatePack(db, { ...INPUTS, cv: "x".repeat(100_001) })),
    "too_long",
  );
  assert.equal(db.calls.length, 0);
});

test("the duration is measured here, server-side, and the usage is passed through", async () => {
  const result = await generatePack(fakeAnthropic(ok()), INPUTS);
  assert.ok(Number.isInteger(result.duration_ms) && result.duration_ms >= 0);
  // cache_read_input_tokens is how you tell the breakpoint is actually caching — a note under
  // Claude Opus 5's 512-token minimum silently does not cache rather than erroring.
  assert.equal(result.usage.cache_read_input_tokens, 3200);
});
