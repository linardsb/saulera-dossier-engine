#!/usr/bin/env node
/**
 * Drive the candidate prep-brief seam (#19) end to end, with a real key and no UI.
 *
 * WHY THIS EXISTS. #19 ships a seam and nothing that calls it: the CTA is #22, the registry that
 * renders the blocks is #21, the tables that store the payload are #17. Without this script the
 * only exercise the call gets is a fake that returns a canned message, which proves the request
 * this module builds and nothing at all about whether Claude can satisfy the contract. That
 * question — does a five-way anyOf of const-named variants compile, does a skeleton come back as
 * headings rather than sentences — cannot be answered by a test, and it is the question the
 * ticket actually turns on.
 *
 * WHAT "SENDABLE" MEANS, decided here because this is the first place it has to be decided:
 * assertBrief passed, and EVERY competency quote verified. A prep brief with a fabricated
 * citation is worse than no prep at all — the candidate prepares against it and walks into the
 * room carrying our mistake. So a demotion is a non-zero exit, loudly, in the register of
 * scripts/pack.mjs. #22 will want the same gate before it sends an invite.
 *
 *   node scripts/gen-brief.js --brief <brief.md> --cv <cv.md> --fields <visible-fields.json> \
 *                             --client "<name>" --interview 2026-08-12 [--out out/]
 *
 * `--fields` is #18's visibleFields(note, visibleKeys) output, as JSON. Deliberately not `--note`:
 * this path never sees the whole note, and giving it a flag that took one would be the leak.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

import Anthropic from "@anthropic-ai/sdk";

import { generateBrief } from "../src/prep/generate.js";

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const briefPath = arg("brief");
const cvPath = arg("cv");
const fieldsPath = arg("fields");
const clientName = arg("client");
const interviewAt = arg("interview");
const outDir = arg("out", ".");

if (!briefPath || !cvPath || !fieldsPath || !clientName || !interviewAt) {
  console.error(
    "usage: node scripts/gen-brief.js --brief <brief.md> --cv <cv.md> \\\n" +
      "                                --fields <visible-fields.json> --client \"<name>\" \\\n" +
      "                                --interview <YYYY-MM-DD> [--out <dir>]",
  );
  process.exit(2);
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error(
    "ANTHROPIC_API_KEY is not set. This script makes a real call to claude-opus-5.\n" +
      "  export ANTHROPIC_API_KEY=sk-ant-...   # or source the value from .dev.vars",
  );
  process.exit(2);
}

const read = (p) => readFileSync(resolve(p), "utf8");

let visibleFields;
try {
  visibleFields = JSON.parse(read(fieldsPath));
  if (!Array.isArray(visibleFields)) throw new Error("not an array of fields");
} catch (err) {
  console.error(`${fieldsPath} is not a visibleFields() array: ${err.message}`);
  process.exit(2);
}

let result;
try {
  result = await generateBrief(new Anthropic(), {
    clientName,
    visibleFields,
    brief: read(briefPath),
    cv: read(cvPath),
    interviewAt,
  });
} catch (err) {
  // StoreError carries a code; anything else is a shape bug from assertBrief or the SDK.
  console.error(`generation failed${err.code ? ` (${err.code})` : ""}: ${err.message}`);
  process.exit(1);
}

const { payload, failures, provenance, duration_ms: durationMs, usage } = result;

mkdirSync(resolve(outDir), { recursive: true });
const out = join(resolve(outDir), "brief.json");
writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`);

const questionsBy = new Map();
for (const q of payload.questions) {
  questionsBy.set(q.competency_id, (questionsBy.get(q.competency_id) ?? 0) + 1);
}

console.log(`role: ${payload.role_title}`);
console.log(
  "blocks: " +
    payload.blocks
      .map((b) => (b.children ? `${b.name}(${b.children.length})` : b.name))
      .join(", "),
);
console.log(
  `competencies: ${provenance.sourced} sourced, ${provenance.unverified} unverified — ` +
    `${provenance.total} total`,
);
for (const c of payload.competencies) {
  console.log(
    `  · ${c.verified ? "sourced   " : "UNVERIFIED"} ${c.id} — ` +
      `${questionsBy.get(c.id) ?? 0} questions, importance ${c.importance}`,
  );
}
console.log(`questions: ${payload.questions.length}`);

// The only way to tell the breakpoint actually cached. 0 on a first run is expected — the schema
// compiles once and the prefix is cold — and a visible slice under Claude Opus 5's 512-token
// minimum silently never caches rather than erroring. Run it twice before calling it a bug.
console.log(
  `cache: ${usage?.cache_read_input_tokens ?? 0} read, ` +
    `${usage?.cache_creation_input_tokens ?? 0} written · ` +
    `output ${usage?.output_tokens ?? "?"} tokens`,
);
console.log(`duration: ${(durationMs / 1000).toFixed(1)}s`);
console.log(`\nwrote ${out}`);

if (failures.length) {
  // Loud on purpose. A demotion means the model cited something it could not stand up, and that
  // is the one defect this whole mechanism exists to catch.
  console.log("\nNOT SENDABLE — these did not verify:");
  for (const f of failures) {
    if (f.kind === "competency") {
      console.log(`  · competency[${f.index}] (${f.label}) — ${f.reason}`);
      console.log(`      quote: ${JSON.stringify(String(f.quote).slice(0, 88))}`);
    } else {
      console.log(
        `  · blocks[${f.block_index}].panel[${f.panel_index}] — ${f.reason}` +
          `\n      key: ${JSON.stringify(f.key)}`,
      );
    }
  }
  process.exit(1);
}

console.log("\nsendable: every competency quote verified against the brief.");
