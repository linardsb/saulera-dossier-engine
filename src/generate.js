// The single model-call boundary, restored (#6, superseded 28 Jul 2026). Architecture §5.6:
// "Every model call goes through one Function, which is also the boundary that lets the data
// posture in §6.4 stay switchable." The 27 Jul amendment replaced this with the recruiter's
// own Claude session; the owner reversed that on 28 Jul once the tab trip was felt in use.
// The seam (`/api/prompt` + `/api/verify`) stays as the fallback path, so this module coming
// back does not remove the way that works without a key.
//
// This module is the call itself; `functions/api/generate.js` is the HTTP adapter over it.
// Splitting them is the same reason `src/store.js` exists apart from its Functions: a Function
// cannot be imported into `node --test`, and the properties worth asserting here — that the
// cache breakpoint is where we think it is, that max_tokens leaves room for thinking, that the
// pack is verified before it is returned — are only assertable if the call is importable.
//
// ⚠ Stateless with respect to candidates. The CV and the pack are held for the life of the
// request and written nowhere — not to D1, not to a log line, not to an error message. The
// event counter is the only thing that persists, and it carries neither.

import { briefProfile } from "./domain.js";
import { PACK_SCHEMA, assertPack } from "./pack.js";
import { SYSTEM, buildMessages, cleanInput } from "./prompt.js";
import { verifyPack, provenanceSummary } from "./provenance.js";
import { StoreError } from "./store.js";

export const MODEL = "claude-opus-5";

/**
 * max_tokens with headroom, deliberately.
 *
 * On Claude Opus 5 thinking is ON BY DEFAULT and **max_tokens caps thinking and response text
 * together**. The pack itself is a couple of thousand tokens; the thinking that produces it is
 * not, and an undersized cap truncates the pack mid-page with stop_reason "max_tokens" — which
 * on this product means a half-written submission pack rather than an error.
 *
 * This is also why the call streams. The SDK raises its own timeout ceiling for large
 * max_tokens on a non-streaming request, but a request that may run for minutes has no reason
 * to be held open on a single response; `.finalMessage()` gives back the same message.
 */
export const MAX_TOKENS = 32_000;

/**
 * Effort is the lever before the pack shrinks (§5.2's sizing note): the ten minutes in the
 * guardrail is partly a latency budget, and adaptive thinking over a 10k-token input at high
 * effort is not instant. If a deployment is missing the guardrail, lower this before touching
 * the prompt or the schema.
 */
export const EFFORT = "high";

/**
 * Claude Opus 5 runs safety classifiers that can decline a request with stop_reason "refusal".
 * Nothing in a recruitment pack should trip them, which is exactly why a false positive would
 * otherwise be a dead button on a screen a recruiter is standing in front of. The server-side
 * fallback re-runs a declined request on Anthropic's recommended substitute model in the same
 * round trip; a refusal that still comes back after that is answered honestly below.
 */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/**
 * One pack: a client's note plus a brief and a CV in, a verified canonical pack out.
 *
 * `client` is an @anthropic-ai/sdk instance, passed in rather than constructed here so the
 * test suite can hand in a fake and assert on the request that was built.
 */
export async function generatePack(client, { clientName, clientNote, brief, cv } = {}) {
  const inputs = {
    clientName: String(clientName ?? ""),
    clientNote: String(clientNote ?? ""),
    brief: cleanInput(brief, "brief"),
    cv: cleanInput(cv, "cv"),
  };

  // A client with an empty note is a real state — the agency added it and has not written
  // anything down yet — and it is the failure mode architecture §6.5 actually fears. Refusing
  // is the honest answer: the note is what the pack has that a job board does not, and
  // generating without one produces a pack whose whole premise is missing.
  if (!inputs.clientNote.trim()) {
    throw new StoreError("note_empty", 400, "client: no note written yet");
  }

  // The deterministic read of the brief, returned so callers can branch without a model in
  // the loop. buildMessages computes its own — the parse is cheap, and threading it through
  // would change a signature for nothing. Derived from candidate text, so it must never
  // reach a log line or an error message.
  const profile = briefProfile(inputs.brief, inputs.cv);

  const startedAt = Date.now();

  // The cache breakpoint lives in buildMessages(), on the client note, because the note is the
  // one input reused across every pack for the same client. Render order is tools → system →
  // messages, so the cached prefix covers SYSTEM plus the note, and the brief and CV — which
  // vary per submission — sit after it and invalidate nothing.
  //
  // Claude Opus 5's minimum cacheable prefix is 512 tokens. A real client note clears that; a
  // two-line stub does not, and a prefix under the minimum silently does not cache rather than
  // erroring — `usage.cache_read_input_tokens` on the result is how you tell.
  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM,
    // Explicit rather than relying on the default: thinking is on by default on Claude Opus 5
    // but was off by default on Opus 4.8, and this file should say which it wants.
    thinking: { type: "adaptive" },
    output_config: {
      effort: EFFORT,
      // Structured outputs, not a "return JSON" instruction — this is what turns the sourcing
      // promise into a mechanism. `output_config.format`, never the deprecated `output_format`.
      format: { type: "json_schema", schema: PACK_SCHEMA },
    },
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    messages: buildMessages(inputs),
  });

  const message = await stream.finalMessage();
  const durationMs = Date.now() - startedAt;

  // Guard before parsing. Structured outputs make malformed output unlikely rather than
  // impossible, and a refusal or a truncation is not a pack. A refusal here means the whole
  // fallback chain declined, which is the honest thing to surface.
  if (message.stop_reason === "refusal") {
    throw new StoreError("model_refused", 502, "the model declined to write this pack");
  }
  if (message.stop_reason === "max_tokens") {
    throw new StoreError("truncated", 502, `pack truncated at ${MAX_TOKENS} tokens`);
  }

  const text = (message.content ?? []).find((b) => b.type === "text")?.text;
  if (!text) throw new StoreError("no_pack", 502, "the model returned no pack");

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new StoreError("no_pack", 502, "the model's pack was not valid JSON");
  }

  // AC6: the verifier runs over the result BEFORE it is returned, and an unverified claim
  // comes back marked — never dropped, never silently promoted. verifyPack demotes; nothing
  // here can turn a failed check back into a sourced claim.
  const { pack, failures } = verifyPack(assertPack(parsed), inputs);

  return {
    pack,
    failures,
    brief_profile: profile,
    provenance: provenanceSummary(pack),
    duration_ms: durationMs,
    usage: message.usage ?? null,
  };
}
