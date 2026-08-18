// THE GUARD ON THE CEILING. Does the contract this product sends still COMPILE at Anthropic?
//
// Found the hard way on #79, 18 Aug 2026. `BRIEF_SCHEMA` had shipped for weeks sitting at Claude
// Opus 5's structured-outputs grammar ceiling with no headroom at all, and nothing in a suite of
// 1,300 tests could see it. The first structural addition — two block variants — came back
//
//   400 The compiled grammar is too large, which would cause performance issues.
//
// which is not a degraded brief. It is a dead Send button in front of a recruiter who has already
// told a candidate their prep is coming, and it would have been found in production.
//
// Measured that day, so the next reader does not have to re-derive it:
//   · six branches + ONE extra top-level string[] ......... 400 grammar too large
//   · seven branches, the seventh as small as expressible .. 400 grammar too large
//   · eight branches with EVERY description stripped ....... 400 grammar too large
//   · the same, with the fallback chain removed ............ 400 grammar too large
//   · merged props object with optional properties ........ 400 "Schema is too complex"
// So it is not byte size (the stripped schema is half the bytes of a passing one), not the
// fallbacks, and not the descriptions. It is the compiled grammar, and the budget is spent.
//
// PROBE AT THE PARAMETERS THE PRODUCT SENDS. THIS IS THE WHOLE FILE.
// The first version of this gate probed with `thinking: { type: "disabled" }` and passed —
// while production was 400ing. `thinking: { type: "adaptive" }` LOWERS the ceiling:
//
//   the five + FirstDayPrimer, adaptive .... 400      the same, disabled .... OK
//   the five alone,            adaptive .... OK
//
// It is the TOTAL GRAMMAR and not the branch count: adding a sixth branch as cheap as
// `PrimerCard` compiles, while `FirstDayPrimer` — an array of three-field objects — does not.
// "Five" is this schema's number, not a documented API limit; treat any addition as unmeasured
// until this file says otherwise.
//
// A gate that probes on easier settings than production runs on is not a gate. `EFFORT` and the
// thinking mode are read off the modules that send them, so this file cannot drift from
// production by editing a literal here. Two parameters are DELIBERATELY not production's:
// `max_tokens` is 16, and the prompt is `system: "x"` / `content: "hi"`, because the grammar is
// compiled before a single token is generated — the schema is the whole subject of this file, and
// the rest of a real request would be paid for on every run to prove nothing extra.
//
// WHY THIS FILE IS NOT IN `npm test`. It needs a real key and it costs a live request per test.
// `npm test` is `node --test test/*.test.js` — a shell glob, and `*` does not cross a `/` — so
// living in `test/live/` is what makes "not part of npm test's contract" true in the WIRING and
// not only in a comment. #33's rule is that a run which skipped anything proves less than it
// says, and CI enforces it by refusing any skip; a key-gated file inside the glob made that gate
// red on every PR, including its own.
//
//   ANTHROPIC_API_KEY=sk-ant-... npm run test:live
//
// And it does not skip without a key. The skip idiom existed because this file was in the glob;
// out of it, the command is only ever run deliberately, so a keyless run is a MISTAKE and says so
// — the same shape as test/node-version.test.js, the loud half of #33's gate. Nothing here runs
// automatically: after a schema change, this is a command someone has to type. There is no
// scheduled job yet (a `pull_request` run from a fork receives no secrets, so a repo secret does
// not solve it) — that gap is #90, tracked rather than forgotten.
//
// A rejection costs nothing: the request is refused before a single token is generated.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import Anthropic from "@anthropic-ai/sdk";

import { BRIEF_SCHEMA, CONCERNS_SCHEMA } from "../../src/prep/schema.js";
import { MODEL, EFFORT, FALLBACK_BETA } from "../../src/generate.js";
import { MAX_TOKENS } from "../../src/prep/generate.js";

const key = process.env.ANTHROPIC_API_KEY;
const skip = key ? false : "no ANTHROPIC_API_KEY: the ceiling is UNCHECKED on this run";

/**
 * The loud half. Without this, a keyless `npm run test:live` exits 0 over four skips — a run that
 * reports success while the ceiling went entirely unprobed, which is #33's failure mode and the
 * one this whole file exists to stop.
 */
test("this gate was asked for, so it needs the key it runs on", () => {
  assert.ok(
    key,
    "ANTHROPIC_API_KEY is unset, so nothing below can run and this command proved NOTHING about " +
      "the grammar ceiling. It is not part of `npm test` precisely so that it is never a silent " +
      "skip: run it with a key, or do not count it.\n\n" +
      "  ANTHROPIC_API_KEY=sk-ant-... npm run test:live",
  );
});

/**
 * Compile the schema at the parameters `generateBrief` sends — the thinking mode above all,
 * because that is the one that moves the ceiling and the one the first version of this gate got
 * wrong. `max_tokens` is the only deliberate difference: the grammar is compiled before a token
 * is generated, so a full answer is not worth buying on every run. `MAX_TOKENS` is imported so
 * that if it ever starts mattering, the import is already here to widen.
 */
async function compiles(schema) {
  const client = new Anthropic({ apiKey: key });
  assert.ok(MAX_TOKENS > 16, "imported so a future reader can raise the ceiling probe with it");
  try {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 16,
      system: "x",
      // NOT `disabled`, and never `disabled`: src/prep/generate.js sends adaptive, and adaptive
      // is what lowers the limit from six block variants to five.
      thinking: { type: "adaptive" },
      output_config: { effort: EFFORT, format: { type: "json_schema", schema } },
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      messages: [{ role: "user", content: "hi" }],
    });
    await stream.finalMessage();
    return { ok: true };
  } catch (err) {
    return { ok: false, why: String(err?.message ?? err) };
  }
}

/** The mode the product sends, read off the module rather than trusted to a comment. */
test("this gate probes the thinking mode BOTH calls actually use", { skip }, async () => {
  const source = readFileSync(new URL("../../src/prep/generate.js", import.meta.url), "utf8");
  const sent = source.match(/thinking:\s*\{\s*type:\s*"adaptive"\s*\}/g) ?? [];

  // THE COUNT, NOT THE PRESENCE. #79 gave this module a SECOND call, and a bare `assert.match`
  // passes as soon as EITHER literal matches. The silent pass that buys: a later ticket reads
  // this file's own table ("six branches, thinking: disabled ....... OK"), switches the
  // BRIEF_SCHEMA call to `disabled` to win a sixth branch back, and leaves generateConcerns on
  // adaptive. One literal still matches, `compiles()` still probes adaptive, and the gate stays
  // green while production sends a mode nothing measured — verbatim the failure the assertion
  // below describes. Counting is what closes it.
  //
  // An `assert.match` on the SOURCE, deliberately: a refactor to a shared constant fails here
  // loudly rather than passing vacuously, and being told to update this gate is the point.
  assert.equal(
    sent.length,
    2,
    `src/prep/generate.js sends adaptive thinking on ${sent.length} call(s), not 2. The ceiling ` +
      "moves with the thinking mode, and `compiles()` below probes ONE mode for both calls — so " +
      "either a call changed mode (re-measure the table at the top of this file, and give " +
      "`compiles()` the mode each schema is actually sent at) or a call was added or removed " +
      "(update this count). Left alone, this whole file goes back to passing while production " +
      "400s, which is exactly how #50's outage survived for weeks.",
  );
});

test("BRIEF_SCHEMA still compiles — the contract the Send button depends on", { skip }, async () => {
  const { ok, why } = await compiles(BRIEF_SCHEMA);
  assert.ok(
    ok,
    "BRIEF_SCHEMA no longer compiles at Anthropic, so /api/prep/prepare is dead for every " +
      "recruiter the moment this deploys. This is not a test to loosen: something was added to " +
      "the schema and it has to come back out, or move to its own call the way #79's two blocks " +
      `did (src/prep/schema.js's CALL_ONE_BLOCK_NAMES note).\n\n${why}`,
  );
});

test("CONCERNS_SCHEMA still compiles — #79's second call", { skip }, async () => {
  const { ok, why } = await compiles(CONCERNS_SCHEMA);
  assert.ok(ok, `CONCERNS_SCHEMA no longer compiles; the brief degrades to no concerns.\n\n${why}`);
});

test("#50's SIXTH BRANCH IS STILL AN OUTAGE — the actual bug, reproduced", { skip }, async () => {
  // The assertion nobody expects to see: it puts `FirstDayPrimer` back where b4a06df had it and
  // proves the request still dies. Here rather than in prose so a future ticket that moves a
  // block onto the first call discovers the consequence in CI instead of in front of a recruiter.
  //
  // THE BRANCH, NOT THE COUNT. A sixth branch is not fatal in itself — duplicating the small
  // `PrimerCard` def compiles fine. It is total grammar, and `FirstDayPrimer` is an array of
  // three-field objects, which is one of the expensive shapes. So this reconstructs #50's own
  // branch out of the parts CONCERNS_SCHEMA still carries rather than standing in a cheap proxy
  // that would pass and prove nothing.
  const probe = structuredClone(BRIEF_SCHEMA);
  const branches = probe.properties.blocks.items.anyOf;
  assert.equal(branches.length, 5, "the first call asks for five; #50's sixth is what follows");
  branches.push({
    type: "object",
    additionalProperties: false,
    properties: {
      name: { type: "string", const: "FirstDayPrimer" },
      props: {
        type: "object",
        additionalProperties: false,
        properties: {
          intro: CONCERNS_SCHEMA.properties.first_day_intro,
          items: CONCERNS_SCHEMA.properties.first_day_items,
        },
        required: ["intro", "items"],
      },
    },
    required: ["name", "props"],
  });

  const { ok, why } = await compiles(probe);
  assert.equal(
    ok,
    false,
    "BRIEF_SCHEMA now has room for #50's FirstDayPrimer branch, which it did not have on " +
      "18 Aug 2026. Re-measure the table at the top of this file, and reconsider whether it, " +
      "LikelyConcerns and QuestionsToAsk still need the second call.",
  );

  // AND FOR THE RIGHT REASON. This is the one test in the file whose assertion is SATISFIED by
  // things going wrong: `compiles()` catches every exception, so a 401, a 429, a 529, a model
  // rename or a typo in the probe branch above all make it green — including runs where the
  // grammar ceiling was never exercised at all. Checking the message is what separates "the
  // ceiling still bites" from "the request never got there".
  assert.match(
    why,
    /grammar is too large/i,
    "the probe failed, but not on the ceiling — so #50's branch is UNMEASURED on this run rather " +
      `than proven fatal. Read the error before trusting the green above it.\n\n${why}`,
  );
});
