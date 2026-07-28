#!/usr/bin/env node
/**
 * Produce a sendable submission pack from a pack JSON the Claude Code session just wrote.
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT A SERVER. The architecture doc's Amendment of 27 July 2026
 * decides model access: "packs are generated in Claude Code on the Anthropic subscription. There
 * is no API key, no server-side model call, and no Pages Function." A subscription authenticates
 * Claude Code through a short-lived OAuth token in a local credential file that the CLI
 * refreshes; a V8 isolate has no filesystem to hold it and no process to refresh it. So the
 * machine with the login IS the runtime. The amendment defers the self-serve web app (#6/#8)
 * until an agency self-serves, at which point a per-token key becomes the right trade — "Not
 * before."
 *
 * The division of labour: the session does the judgement (read the brief, the CV and the client
 * note, write claims that each carry a verbatim source_quote), and this script does everything
 * that must be deterministic — schema assertion, the literal-quote check, rendering. Generation
 * is the cheap part; the check is what makes "nothing in this pack is unsourced" a claim rather
 * than a promise, and a check the model runs on itself is not a check.
 *
 * No candidate text reaches a server on this path, which is the stronger data posture the
 * amendment names for PRD §6.4.
 *
 *   node scripts/pack.mjs --pack out/pack.json --cv in/cv.md --note in/note.md \
 *                         [--renderer appendix|inline] [--out out/]
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { assertPack } from "../src/pack.js";
import { verifyPack, provenanceSummary } from "../src/provenance.js";
import { render, RENDERERS, DEFAULT_RENDERER } from "../src/render/index.js";

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const packPath = arg("pack");
const cvPath = arg("cv");
const notePath = arg("note");
const rendererId = arg("renderer", DEFAULT_RENDERER);
const outDir = arg("out", packPath ? dirname(resolve(packPath)) : ".");

if (!packPath || !cvPath || !notePath) {
  console.error(
    "usage: node scripts/pack.mjs --pack <pack.json> --cv <cv.md> --note <client-note.md>\n" +
      "                            [--renderer appendix|inline] [--out <dir>]"
  );
  process.exit(2);
}
if (!RENDERERS[rendererId]) {
  console.error(`unknown renderer ${rendererId}. one of: ${Object.keys(RENDERERS).join(", ")}`);
  process.exit(2);
}

const read = (p) => readFileSync(resolve(p), "utf8");
const cv = read(cvPath);
const clientNote = read(notePath);

let pack;
try {
  pack = JSON.parse(read(packPath));
} catch (err) {
  console.error(`${packPath} is not valid JSON: ${err.message}`);
  process.exit(1);
}

// Shape first. A pack missing a section is a generation bug, and saying so here is cheaper than
// a renderer throwing halfway down a page.
try {
  assertPack(pack);
} catch (err) {
  console.error(`pack does not match PACK_SCHEMA: ${err.message}`);
  process.exit(1);
}

// The deterministic check. Anything whose quote is not found literally in the CV or the note is
// demoted and marked — never dropped, because a silently removed claim is the failure mode the
// recruiter cannot see.
const { pack: verified, failures } = verifyPack(pack, { cv, clientNote });
const summary = provenanceSummary(verified);
const { text, html } = render(verified, rendererId);

mkdirSync(resolve(outDir), { recursive: true });
const base = join(resolve(outDir), "pack");
writeFileSync(`${base}.txt`, text);
writeFileSync(`${base}.html`, html);

console.log(`renderer: ${rendererId}`);
console.log(
  `provenance: ${summary.cv} from the CV, ${summary.client_note} from the client note, ` +
    `${summary.unverified} unverified — ${summary.total} claims` +
    (failures.length ? `, ${failures.length} DEMOTED` : "")
);

if (failures.length) {
  // Loud on purpose. A demotion means the model paraphrased a quote it claimed was verbatim,
  // and that is the one defect this whole mechanism exists to catch.
  console.log("\nquotes not found literally in the source — these are now marked unverified:");
  for (const f of failures) {
    console.log(`  · ${f.section}[${f.index}] — ${f.reason}`);
    console.log(`      claim: ${String(f.text).slice(0, 88)}`);
    console.log(`      quote: ${JSON.stringify(String(f.quote).slice(0, 88))} (claimed: ${f.claimed_source})`);
  }
}

console.log(`\nwrote ${base}.txt and ${base}.html`);
