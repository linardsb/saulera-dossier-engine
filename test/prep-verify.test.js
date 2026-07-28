// #19 AC2 — the provenance check fails a fabricated quote.
//
// The pack's version of this sentence is said to a client. This one is said to a CANDIDATE, who
// will walk into a room and prepare against whatever we hand them: a fabricated "the panel
// always asks X" is worse than no prep at all. So the bias here is the same as
// provenance.test.js's — toward the cases that would let something through, not the happy path.
//
// The fixture payload carries the fabricated-citation case on purpose: two competency quotes are
// literal spans of prep-brief.md and the third is a paraphrase. If that ever stops being true
// the first test below fails loudly rather than the rest passing vacuously.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { assertBrief } from "../src/prep/schema.js";
import { verifyBrief, briefSummary } from "../src/prep/verify.js";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), "utf8");

const BRIEF = read("fixtures/prep-brief.md");
const FIXTURE = JSON.parse(read("fixtures/prep-payload.json"));
const FIELD_KEYS = JSON.parse(read("fixtures/prep-visible-fields.json")).map((f) => f.key);

const payload = () => structuredClone(FIXTURE);
const run = (p = payload(), keys = FIELD_KEYS) =>
  verifyBrief(assertBrief(p), { brief: BRIEF, fieldKeys: keys });

/* ── the competency quotes ─────────────────────────────────────────────────────────────── */

test("a quote that is a literal span of the brief survives verified", () => {
  const { payload: out } = run();

  assert.equal(out.competencies[0].verified, true, "an exact single-line span");
  assert.equal(out.competencies[0].failed_quote, undefined, "and nothing is marked on it");
  // The second quote is line-wrapped in prep-brief.md. It verifies because normalise() collapses
  // whitespace runs — the same latitude the pack takes, and no more.
  assert.equal(out.competencies[1].verified, true, "a span that crosses a line wrap");
});

test("a paraphrased quote is demoted, marked, and still there", () => {
  const { payload: out, failures } = run();
  const fabricated = out.competencies[2];

  assert.equal(fabricated.verified, false);
  assert.equal(
    fabricated.failed_quote,
    "the postholder must document every visit before the end of the day",
    "what it thought it was citing is preserved, which is what makes a bad brief diagnosable",
  );
  assert.equal(fabricated.label, FIXTURE.competencies[2].label, "the competency itself is intact");
  assert.equal(out.competencies.length, 3, "demote, don't drop — nothing is removed");

  assert.equal(failures.length, 1, "one failure, and it is the paraphrase");
  assert.deepEqual(failures[0], {
    kind: "competency",
    index: 2,
    label: FIXTURE.competencies[2].label,
    quote: FIXTURE.competencies[2].source_quote,
    reason: "quote not found in the brief",
  });
});

test("an empty quote is its own reason, not the same failure as a wrong one", () => {
  // The two are different defects. A wrong quote is a model that cited something; an empty one
  // is a model that cited nothing and said it had. assertBrief rejects the empty case on the way
  // in, so this is the belt for anything reaching verifyBrief by another route (the script's
  // re-verify path, #22 re-verifying a stored payload).
  const p = payload();
  p.competencies[0].source_quote = "";
  const { failures } = verifyBrief(p, { brief: BRIEF, fieldKeys: FIELD_KEYS });

  assert.equal(failures[0].reason, "empty quote");
});

test("whitespace, curly quotes and case do not defeat a genuine quote", () => {
  // normalise()'s latitude, carried across from the pack. A model that tidies a line wrap or
  // smartens an apostrophe has not fabricated anything, and failing it would train the next
  // reader to loosen the check itself.
  const p = payload();
  p.competencies[0].source_quote = "  COMFORTABLE   lone working\n  with a rural caseload  ";
  p.competencies[1].source_quote = "genuinely used to working alone in people’s homes";

  const { payload: out, failures } = verifyBrief(p, { brief: BRIEF, fieldKeys: FIELD_KEYS });
  assert.equal(out.competencies[0].verified, true, "collapsed whitespace and case");
  assert.equal(out.competencies[1].verified, true, "a curly apostrophe folded to ASCII");
  assert.equal(failures.length, 1, "and the paraphrase is still the only failure");
});

test("nothing fuzzy gets through: a near-miss is still a miss", () => {
  // The entire value of this check is that it involves no judgment. A quote that is one word
  // different from the brief is exactly the case a semantic check would wave through.
  const p = payload();
  p.competencies[0].source_quote = "Comfortable lone working with a rural workload";
  const { payload: out } = verifyBrief(p, { brief: BRIEF, fieldKeys: FIELD_KEYS });

  assert.equal(out.competencies[0].verified, false, '"workload" is not "caseload"');
});

/* ── the note half: source_field_key against the slice actually handed in ───────────────── */

test("a panel claim naming a field that was handed in survives untouched", () => {
  const { payload: out } = run();
  const panel = out.blocks[2].props.panel;

  assert.deepEqual(panel, FIXTURE.blocks[2].props.panel, "both keys were in the visible slice");
});

test("a panel claim naming a field that was not handed in is blanked and reported", () => {
  // The near-miss slug is the realistic case: `their-processes` for `their-process`. #21 would
  // render a source attribution pointing at nothing, which reads to a candidate as provenance.
  const p = payload();
  p.blocks[2].props.panel[0].source_field_key = "their-processes";
  const { payload: out, failures } = verifyBrief(p, { brief: BRIEF, fieldKeys: FIELD_KEYS });

  assert.equal(out.blocks[2].props.panel[0].source_field_key, "");
  assert.equal(out.blocks[2].props.panel[0].failed_field_key, "their-processes");
  assert.equal(
    out.blocks[2].props.panel[0].what_they_probe,
    FIXTURE.blocks[2].props.panel[0].what_they_probe,
    "the claim itself stays — demote, don't drop",
  );
  assert.ok(
    failures.some(
      (f) => f.kind === "panel_source" && f.block_index === 2 && f.panel_index === 0 &&
        f.key === "their-processes" && f.reason === "field key not in the visible slice",
    ),
    "the failure names the block, the entry and the key",
  );
});

test("an empty visible slice demotes every panel claim rather than throwing", () => {
  // A recruiter who shares nothing has made a legitimate choice (decision 2), and the brief still
  // generates from the JD and the CV. Every note-derived claim is then unsourceable, which is a
  // demotion the recruiter can see — not an exception in front of them.
  const { payload: out, failures } = run(payload(), []);

  assert.equal(out.blocks[2].props.panel.every((e) => e.source_field_key === ""), true);
  assert.equal(failures.filter((f) => f.kind === "panel_source").length, 2);
});

/* ── the caller's copy is not the verifier's copy ───────────────────────────────────────── */

test("verifyBrief does not mutate the payload it was handed", () => {
  // The panel blanking sits three levels deep. Mutating in place would make the returned payload
  // alias the parsed one, and "the fabricated quote came back marked" would be unfalsifiable.
  const p = payload();
  p.blocks[2].props.panel[0].source_field_key = "invented";
  verifyBrief(p, { brief: BRIEF, fieldKeys: FIELD_KEYS });

  assert.equal(p.blocks[2].props.panel[0].source_field_key, "invented");
  assert.equal(p.competencies[2].verified, undefined);
});

/* ── the summary ───────────────────────────────────────────────────────────────────────── */

test("briefSummary counts what the recruiter is being asked to stand behind", () => {
  const { payload: out } = run();
  assert.deepEqual(briefSummary(out), {
    sourced: 2,
    unverified: 1,
    total: 3,
    panel_sourced: 2,
    panel_unsourced: 0,
    panel_total: 2,
  });
});

test("briefSummary moves with the note half too, not only the competencies", () => {
  // The reason this matters: #22 wires its Send gate to this summary. A summary derived purely
  // from `competencies` is byte-identical between a clean brief and one with EVERY panel
  // attribution hallucinated — so the button goes green on exactly the defect verifyBrief was
  // added to catch. This is the assertion that makes that impossible.
  const clean = briefSummary(run().payload);

  const p = payload();
  for (const entry of p.blocks[2].props.panel) entry.source_field_key = "never-shared";
  const dirty = briefSummary(run(p).payload);

  assert.notDeepEqual(dirty, clean, "an all-hallucinated panel must not summarise as a clean one");
  assert.deepEqual(
    { sourced: dirty.sourced, unverified: dirty.unverified, total: dirty.total },
    { sourced: clean.sourced, unverified: clean.unverified, total: clean.total },
    "and the competency counts are untouched — the note half is what moved",
  );
  assert.equal(dirty.panel_sourced, 0);
  assert.equal(dirty.panel_unsourced, 2);
  assert.equal(dirty.panel_total, 2, "demote, don't drop, holds in the counts as well");
});

test("the summary's top-level-only scan is complete because assertBrief closes the nested case", () => {
  // briefSummary walks payload.blocks and does not descend, exactly as verifyBrief does not.
  // That is only sound while assertBrief refuses a PanelBrief inside CompetencyMap.children —
  // the same guard, holding up both halves. Pinned as a pair so removing one surfaces here
  // rather than as a Send gate that silently stops counting what it was built to count.
  const sneaky = payload();
  sneaky.blocks[1].children.push({
    name: "PanelBrief",
    props: { intro: "x", panel: [{ who: "a", what_they_probe: "b", source_field_key: "NOPE" }] },
  });

  assert.equal(briefSummary(sneaky).panel_total, 2, "the nested panel is not counted");
  assert.throws(() => assertBrief(sneaky), /nested inside children/, "and never gets this far");
});

test("a demoted payload still passes assertBrief, so it can be re-verified at all", () => {
  // failed_field_key is not in BRIEF_SCHEMA (the panel item is additionalProperties: false), so
  // the demoted form is the decoder's output plus a marker. assertBrief does not validate props
  // contents, which is what makes the re-verify path possible — pinned because #17 storing and
  // #22 reloading this payload both depend on it and neither would notice it breaking.
  const p = payload();
  p.blocks[2].props.panel[0].source_field_key = "invented-key";
  const { payload: demoted } = verifyBrief(assertBrief(p), { brief: BRIEF, fieldKeys: FIELD_KEYS });

  assert.equal(demoted.blocks[2].props.panel[0].failed_field_key, "invented-key");
  assert.equal(assertBrief(demoted), demoted, "the marked payload is still a valid brief");
});

test("re-verifying an already-verified payload changes nothing", () => {
  // The re-verify path is real — the script's own, and #22 re-verifying a payload out of storage.
  // verifyPack is idempotent because it early-returns on an already-demoted claim; verifyBrief's
  // panel half has to be too, or the second pass overwrites failed_field_key with the blank it
  // wrote on the first and the diagnostic is gone at the moment it is being read.
  const p = payload();
  p.blocks[2].props.panel[0].source_field_key = "their-processes";

  const pass1 = verifyBrief(p, { brief: BRIEF, fieldKeys: FIELD_KEYS });
  const pass2 = verifyBrief(pass1.payload, { brief: BRIEF, fieldKeys: FIELD_KEYS });

  assert.equal(
    pass2.payload.blocks[2].props.panel[0].failed_field_key,
    "their-processes",
    "the key the model invented survives the second pass",
  );
  assert.equal(pass2.failures.filter((f) => f.kind === "panel_source").length, 0, "not re-reported");
  assert.deepEqual(briefSummary(pass2.payload), briefSummary(pass1.payload), "and the gate holds");
  // The competency half is already idempotent for free: source_quote is preserved, so the same
  // quote fails the same way and failed_quote is rewritten with the same value.
  assert.deepEqual(pass2.payload.competencies, pass1.payload.competencies);
});

test("a brief with nothing extractable summarises as zero rather than crashing", () => {
  // A brief so thin the model finds no competency in it is a real state, and the script has to
  // print something about it rather than throw on the way to saying so.
  assert.deepEqual(briefSummary({ competencies: [], blocks: [] }), {
    sourced: 0,
    unverified: 0,
    total: 0,
    panel_sourced: 0,
    panel_unsourced: 0,
    panel_total: 0,
  });
  const { payload: out, failures } = verifyBrief(
    { role_title: "", blocks: [], competencies: [], questions: [] },
    { brief: BRIEF, fieldKeys: FIELD_KEYS },
  );
  assert.deepEqual(failures, []);
  assert.deepEqual(out.competencies, []);
});
