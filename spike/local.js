// Subscription path: the pack in spike/pack.json was generated in a Claude Code session
// rather than through the API. Everything downstream of generation — the provenance
// check and both renderers — is plain JS and needs no key, so this runs the real
// mechanism over real model output.
//
//   node spike/local.js            verify + render
//   node spike/local.js --tamper   corrupt one quote first, to prove the check bites
//
// What this path does NOT measure: generation latency for the Function (architecture
// §5.2 warns the ten minutes is partly a latency budget). That needs a key — measure it
// in #6 with spike/run.js.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyPack } from "./verify.js";
import { renderInline, renderAppendix, renderFailures } from "./render.js";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), "utf8");

const cv = read("inputs/cv.md");
const clientNote = read("inputs/client-note.md");
const pack = JSON.parse(read("pack.json"));

if (process.argv.includes("--tamper")) {
  // Paraphrase one quote — exactly the failure the deterministic check exists to catch.
  pack.evidence[0].source_quote = pack.evidence[0].source_quote.replace(
    /registration current/i,
    "registration is current and valid",
  );
  console.log("TAMPER: paraphrased evidence[0].source_quote\n");
}

const { pack: verified, failures } = verifyPack(pack, { cv, clientNote });

const out = join(here, "out");
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "pack-inline.txt"), renderInline(verified));
writeFileSync(join(out, "pack-appendix.txt"), renderAppendix(verified));
writeFileSync(join(out, "provenance.txt"), renderFailures(failures, verified));

console.log(renderFailures(failures, verified));
console.log(`Wrote spike/out/pack-inline.txt, pack-appendix.txt, provenance.txt`);
