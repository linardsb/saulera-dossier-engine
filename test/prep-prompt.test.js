// #19 AC3 and the prompt half of AC4 — what the model is told, and where the breakpoint sits.
//
// The rules are asserted as PROPERTIES, not as prose. `PREP_SYSTEM` is copy that will be tuned;
// pinning it whole would make every wording change a false failure, and a test that cries wolf
// gets deleted. What must not change is that the two non-negotiables are still in there and that
// the verbatim-quote rule points at the brief.
//
// The breakpoint assertions are the ones that fail in production rather than in review: a
// breakpoint on the wrong block does not error, it just silently never caches, and
// usage.cache_read_input_tokens is the only signal.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PREP_SYSTEM,
  buildPrepMessages,
  concernsTaskBlock,
  prepInputsBlock,
  visibleNoteBlock,
} from "../src/prep/prompt.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIELDS = JSON.parse(readFileSync(join(here, "fixtures/prep-visible-fields.json"), "utf8"));

const INPUTS = {
  clientName: "Ashdown Park Community Healthcare",
  visibleFields: FIELDS,
  brief: "Band 6 community nurse. Must hold a current NMC pin.",
  cv: "Registered nurse. NMC registration current to Mar 2028.",
  interviewAt: "2026-08-12",
};

/* ── the rules that cannot loosen ───────────────────────────────────────────────────────── */

test("PREP_SYSTEM carries SPEC's first non-negotiable: never the candidate's answer", () => {
  // "Whatever the tool produces is the part the candidate does not learn — and a polished answer
  // they can't deliver is worse than a rough one they own, because interviewers hear the seam."
  assert.match(PREP_SYSTEM, /NEVER write the candidate's answer in their voice/);
  assert.match(PREP_SYSTEM, /skeleton/i, "the permitted alternative has to be named, not implied");
});

test("PREP_SYSTEM carries SPEC's second non-negotiable: never coach fabrication", () => {
  assert.match(PREP_SYSTEM, /NEVER coach fabrication/);
  assert.match(PREP_SYSTEM, /genuine mismatch plainly/);
});

test("PREP_SYSTEM forbids scoring, ranking and predicting the outcome", () => {
  // SPEC's tone section: "Never imply the tool predicts whether they'll get the job." The schema
  // walker makes this structural; this makes it said out loud as well, because a score can be
  // written into a free-text prop that no walker can catch.
  assert.match(PREP_SYSTEM, /NEVER score, rank, or rate the candidate/);
  assert.match(PREP_SYSTEM, /never predict whether they will get the job/);
});

test("PREP_SYSTEM points the verbatim-quote rule at the brief, and only the brief", () => {
  assert.match(PREP_SYSTEM, /VERBATIM span copied\s+character-for-character/);
  assert.match(PREP_SYSTEM, /do not\s+quote the CV/, "a competency sourced from the CV is a category error");
  assert.match(PREP_SYSTEM, /deterministic check runs after you/);
});

test("PREP_SYSTEM says the material is already filtered and must not be speculated past", () => {
  // Decision 2 makes visibility the recruiter's control. The model filling a gap with what a
  // company "like this one" usually does would hand the candidate an invented client fact —
  // indistinguishable, to them, from the privileged knowledge that is the point of the product.
  assert.match(PREP_SYSTEM, /already been filtered/);
  assert.match(PREP_SYSTEM, /If the material does not say, say it does not say/);
});

/* ── the cache breakpoint ───────────────────────────────────────────────────────────────── */

test("the breakpoint is on the visible slice, with the per-candidate inputs after it", () => {
  const blocks = buildPrepMessages(INPUTS)[0].content;

  const cached = blocks.filter((b) => b.cache_control);
  assert.equal(cached.length, 1, "exactly one breakpoint");
  assert.equal(cached[0], blocks[0], "and it is the FIRST block — a prefix, not a suffix");
  assert.ok(cached[0].text.includes(FIELDS[0].text.trim()), "the slice is what gets reused");

  // The whole point: brief, CV and date vary per candidate. Inside the cached prefix they would
  // invalidate it on every request and the cache would never read.
  assert.ok(!cached[0].text.includes(INPUTS.brief), "the brief must sit AFTER the breakpoint");
  assert.ok(!cached[0].text.includes(INPUTS.cv), "the CV must sit AFTER the breakpoint");
  assert.ok(!cached[0].text.includes(INPUTS.interviewAt), "the date must sit AFTER the breakpoint");

  assert.ok(blocks[1].text.includes(INPUTS.brief));
  assert.ok(blocks[1].text.includes(INPUTS.cv));
  assert.ok(blocks[1].text.includes(INPUTS.interviewAt));
});

test("the message is one user turn of two text blocks", () => {
  const [message] = buildPrepMessages(INPUTS);
  assert.equal(message.role, "user");
  assert.equal(message.content.length, 2);
  assert.equal(message.content.every((b) => b.type === "text"), true);
});

/* ── the visible slice, rendered ────────────────────────────────────────────────────────── */

test("each field carries its key, so a note-derived claim can be checked against it", () => {
  // #18 gives every visible field a stable slug. Without the key in the prompt, the model has
  // nothing to put in source_field_key and verifyBrief's note-half check has nothing to check.
  const text = visibleNoteBlock("Ashdown Park Community Healthcare", FIELDS);

  for (const f of FIELDS) {
    assert.ok(text.includes(`key="${f.key}"`), `${f.key} must be nameable`);
    assert.ok(text.includes(`heading="${f.heading}"`));
    assert.ok(text.includes(f.text.trim()));
  }
});

test("a quotation mark in a heading does not break out of the attribute", () => {
  // A recruiter writing `## What they mean by "autonomy"` is writing ordinary prose, not an
  // attack — the note is the agency's own text. What breaks is the CACHED PREFIX: an attribute
  // closed early malforms the one block that has to stay well-formed and byte-identical across
  // every candidate for this client. Built on its own field so the shared FIELDS fixture, which
  // the ordering and caching tests read, stays untouched.
  const text = visibleNoteBlock("Ashdown Park Community Healthcare", [
    { key: "their-language", heading: 'What they mean by "autonomy"', level: 2, text: "Not solo." },
  ]);

  assert.ok(
    text.includes('heading="What they mean by &quot;autonomy&quot;"'),
    "the quote is escaped rather than closing the attribute",
  );
  assert.equal(
    text.match(/<field [^>]*>/g).length,
    1,
    "and the field is still one well-formed opening tag",
  );
});

test("fields are rendered in the order given, never sorted or deduped", () => {
  // A derived order would make the cached prefix unstable between saves, and a prefix that
  // changes silently stops caching rather than erroring.
  const text = visibleNoteBlock("X", FIELDS);
  const positions = FIELDS.map((f) => text.indexOf(`key="${f.key}"`));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));

  const reversed = visibleNoteBlock("X", [...FIELDS].reverse());
  assert.notEqual(reversed, text, "reversing the input reverses the output — nothing re-sorts it");
});

test("an empty visible slice still produces a well-formed block", () => {
  // A recruiter who shares nothing has made a legitimate choice (decision 2), and the brief still
  // generates from the brief and the CV. This must not be a crash or a malformed tag.
  const text = visibleNoteBlock("Ashdown Park Community Healthcare", []);
  assert.match(text, /<client_knowledge>\s*<\/client_knowledge>/);
  assert.ok(!text.includes("<field"));

  const blocks = buildPrepMessages({ ...INPUTS, visibleFields: [] })[0].content;
  assert.equal(blocks.length, 2);
  assert.ok(blocks[0].cache_control);
});

test("the inputs block closes on the instruction to compose", () => {
  assert.match(prepInputsBlock(INPUTS), /Compose the candidate's prep brief\.$/);
  assert.match(
    prepInputsBlock({ ...INPUTS, engagement: "locum" }),
    /Compose the candidate's prep brief\.$/,
  );
});

/* ── the engagement branch (#50) ────────────────────────────────────────────────────────── */

test("the cached prefix is byte-identical between a locum and a perm call for the same client", () => {
  // The whole economics of the breakpoint: the engagement branch is per-candidate text, and a
  // single conditional byte inside the first block would silently stop the cache reading.
  const locum = buildPrepMessages({ ...INPUTS, engagement: "locum" })[0].content;
  const perm = buildPrepMessages({ ...INPUTS, engagement: "permanent" })[0].content;

  assert.equal(locum[0].text, perm[0].text, "the first block must not vary with engagement");
  assert.ok(locum[0].cache_control && perm[0].cache_control);
  assert.notEqual(locum[1].text, perm[1].text, "the branch lives in the second block");
});

test("the locum branch asks for the slim mix; every other value does not", () => {
  const locum = prepInputsBlock({ ...INPUTS, engagement: "locum" });
  assert.match(locum, /locum booking/);
  assert.match(locum, /"client"/);
  assert.match(locum, /"screening"/);
  assert.match(locum, /Never generic clinical coaching/);

  // #46 D2: "unknown" behaves as perm. All three non-locum values get the one-line rule.
  for (const engagement of ["permanent", "unknown", undefined]) {
    const text = prepInputsBlock({ ...INPUTS, engagement });
    assert.doesNotMatch(text, /This is a locum booking/, `${engagement} must not take the locum branch`);
    assert.match(text, /every question type "competency"/);
  }
});

// THE RULE THAT WOULD HAVE CAUGHT #79's OWN BUG, generalised past the one block that got it.
// Naming a block in a prompt is asking a decoder for a variant, and the first call's `anyOf`
// carries five of the eight names. FirstDayPrimer got this assertion when it moved; LikelyConcerns
// and QuestionsToAsk kept their PREP_SYSTEM rules and did not, so for a whole PR the first call was
// told to emit two blocks it cannot express. Both calls are checked, and the second call is
// checked too: CONCERNS_SCHEMA carries no `name` at all — `foldConcerns` writes all three names in
// code — so naming a block there is the same category error one call further on.
test("no call names a block its own schema cannot emit", () => {
  const MOVED = /FirstDayPrimer|LikelyConcerns|QuestionsToAsk/;
  const competencies = [{ id: "comp-x", label: "Working alone" }];

  assert.doesNotMatch(PREP_SYSTEM, MOVED, "the cached prefix is read by BOTH calls");

  for (const engagement of ["locum", "permanent", "unknown", undefined]) {
    assert.doesNotMatch(
      prepInputsBlock({ ...INPUTS, engagement }),
      MOVED,
      `the first call must not name a block it cannot emit (${engagement})`,
    );
    assert.doesNotMatch(
      concernsTaskBlock(competencies, engagement),
      MOVED,
      `the second call returns bare fields; the names are minted in code (${engagement})`,
    );
  }
});

// The counter's `type` and `difficulty` are minted by foldConcerns and are on NEITHER schema, so
// no call can return them. Asking for either buys tokens for a field that would be rejected — and
// it was the perm branch's "except the concern counters" carve-out that made assertBrief's
// question rule (schema.js, `asked`) unable to tell a real question from a counter.
test("neither call is asked for a question type or difficulty it cannot return", () => {
  const competencies = [{ id: "comp-x", label: "Working alone" }];
  for (const engagement of ["locum", "permanent", "unknown", undefined]) {
    for (const text of [
      prepInputsBlock({ ...INPUTS, engagement }),
      concernsTaskBlock(competencies, engagement),
    ]) {
      assert.doesNotMatch(text, /"concern"/, `no call mints a concern type (${engagement})`);
      assert.doesNotMatch(text, /probing/, `no call sets a counter's difficulty (${engagement})`);
    }
  }
});

test("the SECOND call's task carries the primer instruction, and only for a locum", () => {
  // Where the locum branch went. Still per-candidate and still after the cache breakpoint —
  // `prepInputsBlock` composes both — so moving it changed which call asks, not what is cached.
  const competencies = [{ id: "comp-x", label: "Working alone" }];

  const locum = concernsTaskBlock(competencies, "locum");
  assert.match(locum, /first_day_items from the client knowledge/);
  assert.match(locum, /names the field it came from/, "provenance survived the move");
  assert.match(locum, /EMPTY list/, "an empty block is still worse than an absent one");

  for (const engagement of ["permanent", "unknown", undefined]) {
    const text = concernsTaskBlock(competencies, engagement);
    assert.match(text, /first_day_items is an EMPTY list/, `${engagement} asks for no primer`);
    assert.doesNotMatch(text, /scanner fleet/, `${engagement} must not take the locum branch`);
  }

  // Both branches still carry the concerns work, which is the point of the call.
  for (const engagement of ["locum", "permanent"]) {
    assert.match(concernsTaskBlock(competencies, engagement), /EMPTY evidence_quote/);
    assert.match(concernsTaskBlock(competencies, engagement), /comp-x/, "the ids are handed back in");
  }
});

// Where PREP_SYSTEM's rules 7 and 8 went. Asserted as properties, not prose — the copy will be
// tuned, but a call that is not told to derive concerns from the CV/brief GAP, or not told the
// counter shares the concern's competency, produces something assertBrief then rejects for it.
test("the SECOND call's task carries the two rules that left PREP_SYSTEM", () => {
  const competencies = [{ id: "comp-x", label: "Working alone" }];

  for (const engagement of ["locum", "permanent", "unknown", undefined]) {
    const text = concernsTaskBlock(competencies, engagement);

    // Rule 7: the objection, its source, its framing, and its evidence.
    assert.match(text, /\bconcerns\b/, "the field, since the block name is minted in code");
    assert.match(text, /GAP between the candidate's CV and the client brief/);
    assert.match(text, /about the record, never about the person/);
    assert.match(text, /VERBATIM span of THEIR CV/);

    // The pairing assertBrief enforces. Without this the model may answer with concerns and no
    // counters, which is F2's degrade path rather than a brief.
    assert.match(text, /concern_questions/);
    assert.match(text, /one question per concern/i);
    assert.match(text, /OWN competency/i, "the counter drills the concern's own competency");

    // Rule 8, including the two prohibitions that make it safe rather than merely useful.
    assert.match(text, /questions_to_ask/);
    assert.match(text, /never a script/);
    assert.match(text, /answer is already in the brief/);
    assert.match(text, /reveal what the\s+agency knows privately/);
  }
});

test("PREP_SYSTEM stays engagement-free — it lives inside the cached prefix", () => {
  // The rule from prompt.js: the system prompt may gain only unconditional text. Any of these
  // words appearing there means someone branched the cached prefix.
  assert.doesNotMatch(PREP_SYSTEM, /locum|FirstDayPrimer|engagement/i);
});
