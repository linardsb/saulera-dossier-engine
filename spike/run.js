// API path. Same prompt, same schema, same verifier as the subscription path — the only
// thing this adds is the measurement the subscription path cannot make: generation
// latency (architecture §5.2 — "the ten minutes is partly a latency budget and not only
// a review-time budget").
//
//   npm install @anthropic-ai/sdk
//   ANTHROPIC_API_KEY=sk-ant-... node spike/run.js
//
// Not needed to settle §7's decision rules, and #6 no longer wants the number: it shipped as
// a two-route seam around the recruiter's own Claude session (the Amendment of 27 July 2026),
// so this deployment has no model call to time. The file stays because the API path is a door
// kept shut rather than bricked up — it still works with a key. What it prints is this
// machine's model latency, not the product's guardrail number; read "Still to record" in
// spike/README.md before writing the result anywhere.

import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PACK_SCHEMA } from "./schema.js";
import { SYSTEM, userPrompt } from "./prompt.js";
import { verifyPack } from "./verify.js";
import { renderInline, renderAppendix, renderFailures } from "./render.js";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), "utf8");

const brief = read("inputs/brief.md");
const cv = read("inputs/cv.md");
const clientNote = read("inputs/client-note.md");

const client = new Anthropic();

// max_tokens caps thinking AND response text together, and thinking is on by default on
// Opus 5 — size with headroom or the pack truncates mid-page. Streaming because a
// non-streaming request this large risks an HTTP timeout.
const started = Date.now();
const stream = client.messages.stream({
  model: "claude-opus-5",
  max_tokens: 32000,
  system: SYSTEM,
  output_config: {
    effort: "high",
    format: { type: "json_schema", schema: PACK_SCHEMA },
  },
  messages: [{ role: "user", content: userPrompt({ brief, cv, clientNote }) }],
});

const message = await stream.finalMessage();
const latencyMs = Date.now() - started;

if (message.stop_reason === "refusal") {
  console.error("Refused:", message.stop_details);
  process.exit(1);
}
if (message.stop_reason === "max_tokens") {
  console.error("Truncated — raise max_tokens or lower effort.");
}

const text = message.content.find((b) => b.type === "text")?.text ?? "";
const pack = JSON.parse(text);
const { pack: verified, failures } = verifyPack(pack, { cv, clientNote });

const out = join(here, "out");
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "pack.api.json"), JSON.stringify(pack, null, 2));
writeFileSync(join(out, "pack-inline.api.txt"), renderInline(verified));
writeFileSync(join(out, "pack-appendix.api.txt"), renderAppendix(verified));

console.log(renderFailures(failures, verified));
console.log(`Generation latency: ${(latencyMs / 1000).toFixed(1)}s`);
console.log(
  `Tokens: ${message.usage.input_tokens} in, ${message.usage.output_tokens} out`,
);
console.log(
  "\nThat is this machine's model latency, not the round trip the guardrail is measured on.\n" +
    "Record it under its own name if at all, never in spike/README.md's first row. Timing\n" +
    "your review to sendable is still a separate number, and that row is still open.",
);
