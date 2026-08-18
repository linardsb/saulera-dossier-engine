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

import { generateBrief, MAX_TOKENS, CONCERNS_MAX_TOKENS } from "../src/prep/generate.js";
import { BRIEF_SCHEMA, CONCERNS_SCHEMA } from "../src/prep/schema.js";
import { MODEL, EFFORT, FALLBACK_BETA } from "../src/generate.js";
import { StoreError } from "../src/store.js";
import { visibleFields } from "../src/note-fields.js";

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

/**
 * `message` may be one reply for every call, or an array answered in order — #79 makes this
 * module issue TWO requests, and a fake that cannot tell them apart would let the second one be
 * handed the first one's answer and still go green.
 *
 * An array entry may also be a function, which is called and may throw: that is how the
 * degraded-second-call path is exercised.
 */
function fakeAnthropic(message) {
  const calls = [];
  const replies = Array.isArray(message) ? message : null;
  return {
    calls,
    // The beta namespace, because the refusal fallback rides the beta endpoint. A fake with
    // BOTH namespaces would let the module quietly call the wrong one and still pass.
    beta: {
      messages: {
        stream(request) {
          calls.push(request);
          const reply = replies ? replies[calls.length - 1] : message;
          if (typeof reply === "function") return { finalMessage: async () => reply() };
          return { finalMessage: async () => reply };
        },
      },
    },
  };
}

/** A payload as the FIRST call now returns it: #79's two blocks are the second call's. */
const briefOnly = () => {
  const p = structuredClone(PAYLOAD);
  p.blocks = p.blocks.filter((b) => b.name !== "LikelyConcerns" && b.name !== "QuestionsToAsk");
  p.questions = p.questions.filter((q) => q.type !== "concern");
  return p;
};

/** What the SECOND call returns: no block names, because generate.js writes those itself. */
const CONCERNS = () => ({
  concerns_intro: "Two things they will want to test before they offer.",
  concerns: [
    {
      concern: "You came out of an acute ward.",
      competency_id: "comp-lone-working",
      evidence_quote: "Community Staff Nurse — Weald Valley Community Trust, 2022–2026",
    },
    {
      concern: "The caseload includes IV therapy and your CV does not mention it.",
      competency_id: "comp-wound-management",
      evidence_quote: "",
    },
  ],
  concern_questions: [
    { competency_id: "comp-lone-working", text: "What makes you different from them?" },
    { competency_id: "comp-wound-management", text: "How would you get up to speed on IV therapy?" },
  ],
  questions_intro: "A few worth having in your pocket.",
  questions_to_ask: ["How is the caseload split across the Crawley corridor?"],
});

/** The two-call happy path: the brief, then the concerns. */
const bothCalls = () => [ok(briefOnly()), ok(CONCERNS())];

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

/* ── #79: the second call, and what it costs ───────────────────────────────────────────── */

test("#79: a second call carries the two surfaces, and the first call never asks for them", async () => {
  // WHY THERE ARE TWO. BRIEF_SCHEMA shipped at Claude Opus 5's structured-outputs grammar
  // ceiling: a seventh block variant is a 400, measured. So this asserts the split itself —
  // the first request must not name either block, or the whole Send dies rather than degrading.
  const db = fakeAnthropic(bothCalls());
  const result = await generateBrief(db, INPUTS);

  assert.equal(db.calls.length, 2, "one call for the brief, one for the concerns");

  // On the BRANCH names, not on the serialised text: `question.type`'s description mentions
  // LikelyConcerns in prose, which is free — descriptions cost no grammar at all (measured: the
  // eight-branch schema with every description stripped still 400s). It is the seventh and
  // eighth `anyOf` branches that are the 400.
  const branches = db.calls[0].output_config.format.schema.properties.blocks.items.anyOf;
  const named = branches.map((b) => b.properties.name.const);
  assert.equal(named.length, 5, "five branches is what compiles; six is the 400 #50 shipped");
  for (const name of ["FirstDayPrimer", "LikelyConcerns", "QuestionsToAsk"]) {
    assert.ok(!named.includes(name), `${name} in the first call's anyOf is a dead Send button`);
  }

  assert.deepEqual(db.calls[1].output_config.format.schema, CONCERNS_SCHEMA);
  assert.equal(db.calls[1].max_tokens, CONCERNS_MAX_TOKENS, "sized for its own, smaller answer");
  assert.equal(db.calls[1].model, MODEL, "the same model — one definition, both calls");

  // Both blocks arrive folded, under names generate.js wrote rather than a decoder minted.
  const concerns = result.payload.blocks.find((b) => b.name === "LikelyConcerns");
  const asks = result.payload.blocks.find((b) => b.name === "QuestionsToAsk");
  assert.ok(concerns && asks, "both surfaces reached the payload");
  assert.equal(concerns.props.concerns.length, 2);
  assert.deepEqual(asks.props.questions, ["How is the caseload split across the Crawley corridor?"]);

  // The counter questions are ordinary questions in the bank, minted probing.
  const minted = result.payload.questions.filter((q) => q.type === "concern");
  assert.equal(minted.length, 2);
  assert.ok(minted.every((q) => q.difficulty === "probing"), "a counter never opens a competency");
  assert.ok(minted.every((q) => q.axis === "core"));
});

test("#79: the second call reads the cached prefix and is told the competencies by id", async () => {
  // The economics of the split. If the second call rewrote the prefix it would cost as much as
  // the first, and decision 5's caching argument would be gone. Only the CLOSING instruction
  // differs, and that sits after the breakpoint.
  const db = fakeAnthropic(bothCalls());
  await generateBrief(db, INPUTS);
  const [first, second] = db.calls;

  assert.deepEqual(
    second.messages[0].content[0],
    first.messages[0].content[0],
    "the cached block is byte-identical, so the second call is a cache READ",
  );
  assert.equal(second.system, first.system, "and PREP_SYSTEM is the same string");
  assert.notEqual(second.messages[0].content[1].text, first.messages[0].content[1].text);

  // Sequential for a reason: a concern names a competency_id, and those ids are the first
  // call's output. The second call is handed them, so it cannot invent one.
  const inputs = second.messages[0].content[1].text;
  for (const c of briefOnly().competencies) {
    assert.ok(inputs.includes(c.id), `${c.id} was not offered to the second call`);
    assert.ok(inputs.includes(c.label), `${c.label} was not offered to the second call`);
  }
});

test("#79: a failed second call degrades to a brief without the blocks, and says so", async () => {
  // The brief is this route's product; the two extra surfaces are additive. Killing a prep brief
  // the recruiter has already promised a candidate, because a secondary call timed out, is the
  // same dead Send button MAX_TOKENS is sized to avoid. Degrading is the call — but never in
  // silence, so it lands in `failures` where scripts/gen-brief.js prints it and exits 1.
  const cases = [
    ["a thrown error", () => { throw new Error("socket hang up"); }],
    ["a refusal", { stop_reason: "refusal", content: [] }],
    ["a truncation", { stop_reason: "max_tokens", content: [] }],
    ["unparseable JSON", { stop_reason: "end_turn", content: [{ type: "text", text: "{oh dear" }] }],
    ["no text at all", { stop_reason: "end_turn", content: [] }],
  ];

  for (const [why, reply] of cases) {
    const db = fakeAnthropic([ok(briefOnly()), reply]);
    const result = await generateBrief(db, INPUTS);

    assert.ok(result.payload.blocks.length, `${why}: there is still a brief`);
    assert.ok(
      !result.payload.blocks.some((b) => ["LikelyConcerns", "QuestionsToAsk"].includes(b.name)),
      `${why}: no half-built block was folded in`,
    );
    const failure = result.failures.find((f) => f.kind === "concerns_call");
    assert.ok(failure, `${why}: the loss was not recorded`);
    assert.equal(result.provenance.concern_total, 0, `${why}: and it counts as zero concerns`);
  }
});

test("#79: a second call that ANSWERS but mispairs degrades too — the brief is not lost", async () => {
  // The five cases above are all CALL failures. This is the other half, and the one the degrade
  // contract missed: a second call that succeeds, returns valid JSON, and satisfies
  // CONCERNS_SCHEMA completely — while saying something that cannot be folded into THIS brief.
  //
  // CONCERNS_SCHEMA cannot prevent any of it. `competency_id` is a free string (there is no way
  // to say "an id from that other array"), and structured outputs reject `minItems`, so the two
  // arrays cannot be length-paired. `assertBrief` catches what the schema could not — and used to
  // do it by throwing, which meant a cheap second call took the expensive first call's brief with
  // it. The recruiter loses a brief that was CORRECT, in front of a candidate they have already
  // promised, and the retry pays for both calls again.
  const base = CONCERNS();
  const cases = [
    [
      "a concern with no counter",
      { ...base, concerns: [base.concerns[0]], concern_questions: [] },
    ],
    [
      "a concern under an id the first call never emitted",
      {
        ...base,
        concerns: [{ ...base.concerns[0], competency_id: "comp-invented" }],
        concern_questions: [{ competency_id: "comp-invented", text: "How would you cope?" }],
      },
    ],
    [
      "a counter tagged under a different competency",
      {
        ...base,
        concerns: [base.concerns[0]],
        concern_questions: [{ competency_id: "comp-documentation", text: "How do you record it?" }],
      },
    ],
    [
      "a counter with an empty question",
      {
        ...base,
        concerns: [base.concerns[0]],
        concern_questions: [{ competency_id: base.concerns[0].competency_id, text: "" }],
      },
    ],
  ];

  for (const [why, extra] of cases) {
    const db = fakeAnthropic([ok(briefOnly()), ok(extra)]);
    const result = await generateBrief(db, INPUTS);

    assert.ok(result.payload.blocks.length, `${why}: the first call's brief still ships`);
    assert.ok(
      !result.payload.blocks.some((b) =>
        ["LikelyConcerns", "QuestionsToAsk", "FirstDayPrimer"].includes(b.name),
      ),
      `${why}: nothing from the unassertable answer was folded in`,
    );
    assert.ok(
      !result.payload.questions.some((q) => q.type === "concern"),
      `${why}: and no counter survived without its block`,
    );

    // Degraded, never silent — same entry the five call failures produce, so every reader of
    // `failures` handles one case rather than two.
    const failure = result.failures.find((f) => f.kind === "concerns_call");
    assert.ok(failure, `${why}: the loss was not recorded`);
    assert.equal(result.provenance.concern_total, 0, `${why}: and it counts as zero concerns`);
  }
});

test("#79: the fold's own error message never reaches the failure entry", async () => {
  // `assertBrief` quotes the offending value, and the offending value is model output — a
  // competency id, or the concern text itself. The degrade's reason is hand-written for exactly
  // that reason, the same rule generateConcerns' catch keeps.
  const base = CONCERNS();
  const db = fakeAnthropic([
    ok(briefOnly()),
    ok({
      ...base,
      concerns: [{ ...base.concerns[0], competency_id: "comp-weald-valley-secret" }],
      concern_questions: [{ competency_id: "comp-weald-valley-secret", text: "How would you cope?" }],
    }),
  ]);
  const result = await generateBrief(db, INPUTS);

  const wire = JSON.stringify(result.failures.find((f) => f.kind === "concerns_call"));
  assert.ok(!wire.includes("comp-weald-valley-secret"), "the fold error's message was passed through");
  assert.ok(!wire.includes("brief:"), "and so was assertBrief's prefix");
});

test("#79: a malformed competencies list is a 502 bad_brief, not a 500", async () => {
  // `generateConcerns` reads `competencies` OUTSIDE its own try, so `(competencies ?? [])
  // .filter(...)` threw a TypeError on anything that is neither null nor an array — out of a
  // function documented NEVER THROWS, past generateBrief unwrapped, and into errorResponse as
  // `500 internal`. DEPLOY.md's triage table reads that as "the migration did not run" and sends
  // the operator to `npm run db:remote` for what is a model output problem. Reachability is low
  // (the decoder constrains the field) — the cost is an operator's hour on the wrong wall.
  for (const competencies of [{ id: "comp-x" }, "comp-x", 7, true]) {
    const broken = briefOnly();
    broken.competencies = competencies;

    const db = fakeAnthropic([ok(broken), ok(CONCERNS())]);
    const err = await generateBrief(db, INPUTS).then(
      () => null,
      (e) => e,
    );

    assert.ok(err instanceof StoreError, `${JSON.stringify(competencies)}: not a StoreError`);
    assert.equal(err.code, "bad_brief", `${JSON.stringify(competencies)}: wrong code`);
    assert.equal(err.status, 502, `${JSON.stringify(competencies)}: wrong status`);
  }
});

test("#79: a first call that is itself unshaped is still a 502 — the degrade is not a swallow", async () => {
  // The degrade must not become a catch-all. If the FIRST call's payload cannot assert on its
  // own, there is no brief to ship and 502 bad_brief is the honest answer — including when the
  // second call is perfectly fine, which is the case a naive fallback would hide.
  const broken = briefOnly();
  broken.questions = broken.questions.filter((q) => q.competency_id !== "comp-documentation");

  const db = fakeAnthropic([ok(broken), ok(CONCERNS())]);
  const err = await generateBrief(db, INPUTS).then(
    () => null,
    (e) => e,
  );

  assert.ok(err instanceof StoreError, "an unshaped first call still throws");
  assert.equal(err.code, "bad_brief");
  assert.equal(err.status, 502);
});

test("#79: no candidate text reaches a degraded second call's failure entry", async () => {
  // The rule this file already holds for every other model failure. An SDK error can carry the
  // request body, and the request body is the candidate's CV.
  const db = fakeAnthropic([
    ok(briefOnly()),
    () => { throw new Error(`upstream said: ${CV}`); },
  ]);
  const result = await generateBrief(db, INPUTS);

  const wire = JSON.stringify(result.failures.find((f) => f.kind === "concerns_call"));
  assert.ok(!wire.includes("Weald Valley"), "the CV reached the failure entry");
  assert.ok(!wire.includes("socket") && !wire.includes("upstream"), "and neither did the raw error");
});

/* ── AC3 (#79): the unshared half of the note cannot reach either new block ─────────────── */

test("AC3: an unticked note section reaches nothing in the request, and the ticked half does", async () => {
  // Built from the REAL gate rather than a hand-made array, because the claim is about the
  // seam and not about a fixture. `visibleFields` (src/note-fields.js:209-214) is the only
  // channel; this asserts that #79's two blocks added no second one.
  //
  // The existing `.note` grep gate covers functions/api/prep/prepare.js ONLY
  // (test/prep-prepare.test.js:166-171) — verified. It does not reach src/prep/prompt.js or
  // this module, so AC3 is not already covered and this test is not redundant.
  const NOTE = [
    "## Their process",
    "Two stages, both in East Grinstead.",
    "",
    "## What we really think",
    "Rejected our last two candidates for being vague under pressure. Do not share.",
  ].join("\n");

  const slice = visibleFields(NOTE, ["their-process"]);
  assert.equal(slice.length, 1, "the gate handed over one section, so the test has a hidden half");

  const db = fakeAnthropic(bothCalls());
  await generateBrief(db, { ...INPUTS, visibleFields: slice });

  // EVERY request, not just the first. #79 added a second call, and a leak proof that read
  // `calls[0]` would have stopped covering the very blocks the criterion is about.
  assert.equal(db.calls.length, 2, "both calls are about to be searched");
  for (const [i, call] of db.calls.entries()) {
    // THE WHOLE serialised request, not visibleNoteBlock's output. The point is that no new
    // parameter smuggled the note in through the second content block, the system prompt, or
    // anywhere else — buildPrepMessages is the only way text reaches the model, so a leak
    // anywhere in this object is a leak.
    const sent = JSON.stringify(call);
    assert.ok(!sent.includes("Rejected our last two candidates"), `call ${i}: unshared text travelled`);
    assert.ok(!sent.includes("what-we-really-think"), `call ${i}: even its key travelled`);
    assert.ok(sent.includes("Two stages, both in East Grinstead"), `call ${i}: the SHARED half must be there`);
  }
});

test("AC3, structurally: the prompt has one input surface and it never reads the note", () => {
  // The grep half, mirroring the Level 1 gate test/prep-prepare.test.js applies to the Function.
  // `visibleFields` is already filtered by the time it arrives, so what makes AC3 provable is
  // that there is no OTHER parameter — a `note` argument added for #79's concerns would have
  // been the obvious shortcut and this is what refuses it.
  const source = read("../src/prep/prompt.js").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.doesNotMatch(source, /\.note\b/, "src/prep/prompt.js must never read a client note");

  const signature = source.match(/export function buildPrepMessages\(\{([^}]*)\}\)/);
  assert.ok(signature, "buildPrepMessages still takes one destructured object");
  assert.deepEqual(
    signature[1].split(",").map((s) => s.trim()).filter(Boolean).sort(),
    // `task` is #79's second call selecting its closing instruction — a choice between
    // instructions this module already holds, never a channel for caller text: nothing
    // interpolates it into the note block or the inputs block.
    ["brief", "clientName", "cv", "engagement", "interviewAt", "task", "visibleFields"],
    "#79 added no channel into the prompt; the note is not one of these and cannot become one " +
      "without this line changing",
  );
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
    // #79: the CV reached verifyBrief, so the fixture's evidenced concern stands up and the
    // honest gap is counted as itself. Both would read `concern_unsourced: 2` if generate.js
    // had forgotten the second haystack — which is the failure this line actually guards.
    concern_sourced: 1,
    concern_unsourced: 0,
    concern_no_material: 1,
    concern_total: 2,
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

  assert.equal(db.calls.length, 2, "the call happens — and #79's second one after it");
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
