// The Send-to-Candidate model call (#19). Portal architecture §5: "At Send (claude-opus-5):
// compose the prep brief blocks, extract competencies with quotes, mint the core question bank.
// One call, prompt-cached on the client note."
//
// This mirrors src/generate.js deliberately, down to the order of its guards, and imports MODEL,
// EFFORT and FALLBACK_BETA from it rather than restating them — there is one definition of which
// model this product calls and how it handles a refusal, and two call sites that share it.
//
// It is a module and not a Function for the reason src/generate.js gives: a Function cannot be
// imported into `node --test`, and the properties worth asserting — that the breakpoint is where
// we think it is, that max_tokens leaves room for thinking, that the payload is verified before
// it is returned — are only assertable if the call is importable. #22 is the HTTP adapter over it.
//
// ⚠ Stateless with respect to candidates. The CV and the brief are held for the life of the call
// and written nowhere — not to D1, not to a log line, not to an error message. Nothing here
// persists; #17 owns candidate_role.brief_json, and this function returns a plain object.

import { MODEL, EFFORT, FALLBACK_BETA } from "../generate.js";
import { cleanInput } from "../prompt.js";
import { StoreError } from "../store.js";
import { BRIEF_SCHEMA, assertBrief } from "./schema.js";
import { PREP_SYSTEM, buildPrepMessages } from "./prompt.js";
import { verifyBrief, briefSummary } from "./verify.js";

/**
 * max_tokens with headroom, sized fresh here rather than inherited.
 *
 * On Claude Opus 5 thinking is ON BY DEFAULT and **max_tokens caps thinking and response text
 * together**. This payload is larger than a pack: five block variants, five or six competencies
 * each carrying a verbatim quote, and a question bank per competency.
 *
 * The number is measured, not guessed. A live probe on 28 Jul 2026 produced 1,641 output tokens
 * for 5 blocks, 3 competencies and 9 questions at effort "low", over a three-line brief with no
 * CV. A real brief plus a CV at effort "high" is several times that, with adaptive thinking on
 * top. 48k is roughly an order of magnitude of headroom, and the failure it buys off is the
 * expensive one: a truncation here is a dead Send button in front of a recruiter who has already
 * told a candidate the prep is coming. Lower EFFORT before lowering this.
 */
export const MAX_TOKENS = 48_000;

/**
 * One prep brief: the candidate-visible slice of the client note, plus the brief, the CV and the
 * interview date in — a verified payload of blocks, competencies and the core question bank out.
 *
 * `client` is an @anthropic-ai/sdk instance, passed in rather than constructed here so the test
 * suite can hand in a fake and assert on the request that was built.
 *
 * `visibleFields` is #18's `visibleFields(note, visibleKeys)` return value. This function never
 * reads `client.note` and must never be given it: the filter is the seam, and reaching past it
 * is how privileged knowledge reaches a candidate.
 */
export async function generateBrief(
  client,
  { clientName, visibleFields, brief, cv, interviewAt } = {},
) {
  const inputs = {
    clientName: String(clientName ?? ""),
    // Deliberately NOT cleaned or defaulted into a shape: an empty array is legal (below), and
    // silently substituting one for a caller's mistake would hide the seam being bypassed.
    visibleFields: visibleFields ?? [],
    brief: cleanInput(brief, "brief"),
    cv: cleanInput(cv, "cv"),
    interviewAt: String(interviewAt ?? ""),
  };

  // The deliberate divergence from generatePack's `note_empty` guard. There, refusing is honest:
  // the note IS the pack's whole premise. Here, decision 2 makes per-field visibility the
  // RECRUITER'S control — a recruiter who has shared nothing has made a legitimate choice, and
  // the prep brief still has the brief and the CV to work from. Refusing would turn their
  // privacy decision into a broken button.

  const startedAt = Date.now();

  // The cache breakpoint lives in buildPrepMessages(), on the visible slice, because that slice
  // is the one input reused across every candidate for the same client. Render order is
  // tools → system → messages, so the cached prefix covers PREP_SYSTEM plus the slice, and the
  // brief, CV and date — which vary per candidate — sit after it and invalidate nothing.
  //
  // Claude Opus 5's minimum cacheable prefix is 512 tokens. A thin slice does not clear it, and a
  // prefix under the minimum silently does not cache rather than erroring —
  // `usage.cache_read_input_tokens` on the result is how you tell.
  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: PREP_SYSTEM,
    // Explicit rather than relying on the default, same as src/generate.js:94.
    thinking: { type: "adaptive" },
    output_config: {
      effort: EFFORT,
      // Structured outputs, not a "return JSON" instruction — this is what closes the component
      // vocabulary at the decoder. `output_config.format`, never the deprecated `output_format`.
      format: { type: "json_schema", schema: BRIEF_SCHEMA },
    },
    // FALLBACK_BETA and the scalar `fallbacks: "default"` are a matched pair — the header pins
    // the form. Pairing this header with the array form is a 400. Change neither in isolation.
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    messages: buildPrepMessages(inputs),
  });

  const message = await stream.finalMessage();
  const durationMs = Date.now() - startedAt;

  // Guard before parsing. A refusal here means the whole fallback chain declined; a truncation
  // is a half-written prep brief rather than an error unless stop_reason is checked first.
  if (message.stop_reason === "refusal") {
    throw new StoreError("model_refused", 502, "the model declined to write this prep brief");
  }
  if (message.stop_reason === "max_tokens") {
    throw new StoreError("truncated", 502, `prep brief truncated at ${MAX_TOKENS} tokens`);
  }

  const text = (message.content ?? []).find((b) => b.type === "text")?.text;
  if (!text) throw new StoreError("no_brief", 502, "the model returned no prep brief");

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new StoreError("no_brief", 502, "the model's prep brief was not valid JSON");
  }

  // Shape first, then sourcing, then return — the payload is verified BEFORE it is returned, and
  // an unsourceable competency comes back marked, never dropped and never silently promoted.
  // The CLEANED brief is the haystack, because the cleaned brief is what the model was given.
  const { payload, failures } = verifyBrief(assertBrief(parsed), {
    brief: inputs.brief,
    fieldKeys: inputs.visibleFields.map((f) => f.key),
  });

  return {
    payload,
    failures,
    provenance: briefSummary(payload),
    duration_ms: durationMs,
    usage: message.usage ?? null,
  };
}
