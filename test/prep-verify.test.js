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
// #79's second haystack. Every call below passes it, so a test asserting a failure COUNT is
// counting the failure it named rather than two demoted concerns it never mentioned.
const CV = read("fixtures/prep-cv.md");
const FIXTURE = JSON.parse(read("fixtures/prep-payload.json"));
const FIELD_KEYS = JSON.parse(read("fixtures/prep-visible-fields.json")).map((f) => f.key);

const payload = () => structuredClone(FIXTURE);
const run = (p = payload(), keys = FIELD_KEYS) =>
  verifyBrief(assertBrief(p), { brief: BRIEF, cv: CV, fieldKeys: keys });

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
  const { failures } = verifyBrief(p, { brief: BRIEF, cv: CV, fieldKeys: FIELD_KEYS });

  assert.equal(failures[0].reason, "empty quote");
});

test("whitespace, curly quotes and case do not defeat a genuine quote", () => {
  // normalise()'s latitude, carried across from the pack. A model that tidies a line wrap or
  // smartens an apostrophe has not fabricated anything, and failing it would train the next
  // reader to loosen the check itself.
  const p = payload();
  p.competencies[0].source_quote = "  COMFORTABLE   lone working\n  with a rural caseload  ";
  p.competencies[1].source_quote = "genuinely used to working alone in people’s homes";

  const { payload: out, failures } = verifyBrief(p, { brief: BRIEF, cv: CV, fieldKeys: FIELD_KEYS });
  assert.equal(out.competencies[0].verified, true, "collapsed whitespace and case");
  assert.equal(out.competencies[1].verified, true, "a curly apostrophe folded to ASCII");
  assert.equal(failures.length, 1, "and the paraphrase is still the only failure");
});

test("nothing fuzzy gets through: a near-miss is still a miss", () => {
  // The entire value of this check is that it involves no judgment. A quote that is one word
  // different from the brief is exactly the case a semantic check would wave through.
  const p = payload();
  p.competencies[0].source_quote = "Comfortable lone working with a rural workload";
  const { payload: out } = verifyBrief(p, { brief: BRIEF, cv: CV, fieldKeys: FIELD_KEYS });

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
  const { payload: out, failures } = verifyBrief(p, { brief: BRIEF, cv: CV, fieldKeys: FIELD_KEYS });

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

test("the idempotence guard cannot be forged into a way past the allow-list", () => {
  // The guard exists so a re-verified payload keeps its diagnostic. Keyed on mere PRESENCE it
  // was also a hole: `{"failed_field_key": null}` is legal JSON, survives readJson and
  // assertBrief, and returned here before the allow-list was consulted — so a payload coming
  // back through the browser round trip could name a HIDDEN note section and have it verify
  // with zero failures, contradicting the guarantee functions/api/prep/send.js advertises.
  const forged = payload();
  forged.blocks[2].props.panel[0].source_field_key = "why-candidates-have-been-turned-down";
  forged.blocks[2].props.panel[0].failed_field_key = null;
  const { payload: out, failures } = verifyBrief(forged, { brief: BRIEF, cv: CV, fieldKeys: FIELD_KEYS });

  assert.equal(out.blocks[2].props.panel[0].source_field_key, "", "a hidden key does not verify");
  assert.ok(
    failures.some((f) => f.kind === "panel_source" && f.key === "why-candidates-have-been-turned-down"),
    "and it is reported rather than passed through in silence",
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

/* ── the primer half (#50): the same rule, on FirstDayPrimer.items ──────────────────────── */

/** The fixture with a FirstDayPrimer appended — one sourced item, one citing `keyForSecond`. */
function withPrimer(keyForSecond) {
  const p = payload();
  p.blocks.push({
    name: "FirstDayPrimer",
    props: {
      intro: "What we know about day one.",
      items: [
        { topic: "Who to report to", detail: "The Clinical Services Manager.", source_field_key: "their-process" },
        { topic: "Getting in", detail: "Park behind the imaging block.", source_field_key: keyForSecond },
      ],
    },
  });
  return p;
}

test("a primer item naming a field that was not handed in is blanked and reported", () => {
  const p = withPrimer("why-candidates-have-been-turned-down");
  const { payload: out, failures } = run(p);
  const items = out.blocks.at(-1).props.items;

  assert.deepEqual(items[0], p.blocks.at(-1).props.items[0], "the sourced item is untouched");
  assert.equal(items[1].source_field_key, "");
  assert.equal(items[1].failed_field_key, "why-candidates-have-been-turned-down");
  assert.equal(items[1].detail, "Park behind the imaging block.", "demote, don't drop");
  assert.ok(
    failures.some(
      (f) => f.kind === "primer_source" && f.block_index === out.blocks.length - 1 &&
        f.item_index === 1 && f.key === "why-candidates-have-been-turned-down" &&
        f.reason === "field key not in the visible slice",
    ),
    "the failure names the block, the item and the key",
  );
});

test("re-verifying a demoted primer item preserves its diagnostic and re-reports nothing", () => {
  const pass1 = run(withPrimer("invented-key"));
  const pass2 = run(pass1.payload);

  assert.equal(pass2.payload.blocks.at(-1).props.items[1].failed_field_key, "invented-key");
  assert.equal(pass2.failures.filter((f) => f.kind === "primer_source").length, 0, "not re-reported");
  assert.deepEqual(briefSummary(pass2.payload), briefSummary(pass1.payload), "and the counts hold");
});

test("primer counts are additive and read off the payload's own markers", () => {
  const summary = briefSummary(run(withPrimer("invented-key")).payload);
  assert.equal(summary.primer_sourced, 1);
  assert.equal(summary.primer_unsourced, 1);
  assert.equal(summary.primer_total, 2);
  // The competency and panel halves are untouched by the primer's arrival.
  assert.deepEqual(
    { sourced: summary.sourced, panel_total: summary.panel_total },
    { sourced: 2, panel_total: 2 },
  );
});

/* ── the concern half (#79): the same rule, against the CV instead of the brief ─────────── */

/** Where the fixture's LikelyConcerns block sits, and its entries after a run. */
const concernIndex = () => FIXTURE.blocks.findIndex((b) => b.name === "LikelyConcerns");
const concernsOf = (p) => p.blocks[concernIndex()].props.concerns;

test("the fixture is the shape these concern tests claim to exercise", () => {
  // A guard on the guard, in this file's own register: one concern quotes the CV verbatim and
  // one is the honest gap. Lose either and half the assertions below pass vacuously.
  const concerns = concernsOf(FIXTURE);
  assert.equal(concerns.length, 2);
  assert.ok(concerns[0].evidence_quote.trim(), "one concern the CV answers");
  assert.equal(concerns[1].evidence_quote, "", "one concern it does not");
});

test("a concern quoting the CV verbatim survives with no marker", () => {
  const { payload: out, failures } = run();
  const concern = concernsOf(out)[0];

  assert.deepEqual(concern, concernsOf(FIXTURE)[0], "untouched, byte for byte");
  assert.equal("failed_evidence_quote" in concern, false);
  assert.equal(failures.filter((f) => f.kind === "concern_source").length, 0);
});

test("AC4: an empty evidence_quote is untouched and is NOT a failure", () => {
  // THE ONE THAT MATTERS. SPEC Amendment 1: "if the material holds no genuine counter, say so
  // plainly." An empty quote IS that plain statement. quoteAppears returns false for an empty
  // needle (provenance.js:37-39), so without the guard in demoteConcern every honest gap would
  // be recorded as a hallucination — and the page would then tell a candidate we invented
  // something, over a model that behaved exactly as instructed.
  const { payload: out, failures } = run();
  const gap = concernsOf(out)[1];

  assert.equal(gap.evidence_quote, "");
  assert.equal("failed_evidence_quote" in gap, false, "no marker: nothing was demoted");
  assert.deepEqual(failures.filter((f) => f.kind === "concern_source"), []);
});

test("a concern quoting something that is not in the CV is blanked, marked and reported", () => {
  const p = payload();
  concernsOf(p)[0].evidence_quote = "Twelve years of IV therapy in the community";
  const { payload: out, failures } = run(p);
  const concern = concernsOf(out)[0];

  assert.equal(concern.evidence_quote, "", "the invented span does not travel under its own name");
  assert.equal(concern.failed_evidence_quote, "Twelve years of IV therapy in the community");
  assert.equal(concern.concern, concernsOf(FIXTURE)[0].concern, "the objection itself stays");
  assert.deepEqual(
    failures.filter((f) => f.kind === "concern_source"),
    [
      {
        kind: "concern_source",
        block_index: concernIndex(),
        concern_index: 0,
        quote: "Twelve years of IV therapy in the community",
        reason: "quote not found in the CV",
      },
    ],
    "the failure names the block, the entry and the quote",
  );
});

test("re-verifying a demoted concern preserves its diagnostic and re-reports nothing", () => {
  const p = payload();
  concernsOf(p)[0].evidence_quote = "Ten years running an IV therapy service";

  const pass1 = run(p);
  const pass2 = run(pass1.payload);

  assert.equal(
    concernsOf(pass2.payload)[0].failed_evidence_quote,
    "Ten years running an IV therapy service",
    "the span the model invented survives the second pass",
  );
  assert.equal(pass2.failures.filter((f) => f.kind === "concern_source").length, 0, "not re-reported");
  assert.deepEqual(briefSummary(pass2.payload), briefSummary(pass1.payload), "and the counts hold");
});

test("a forged failed_evidence_quote does not buy a quote past the CV check", () => {
  // The panel half's lesson, applied here: `{"failed_evidence_quote": null}` is legal JSON that
  // survives readJson and assertBrief. Keyed on mere PRESENCE, the guard would return early and
  // a span that is nowhere in the CV would travel to the candidate wearing no mark at all. The
  // guard is on the BLANK quote instead, so a non-blank one is always checked.
  const forged = payload();
  concernsOf(forged)[0].evidence_quote = "Led the trust's IV therapy rollout";
  concernsOf(forged)[0].failed_evidence_quote = null;

  const { payload: out, failures } = run(forged);
  assert.equal(concernsOf(out)[0].evidence_quote, "", "the forged marker bought nothing");
  assert.equal(concernsOf(out)[0].failed_evidence_quote, "Led the trust's IV therapy rollout");
  assert.equal(failures.filter((f) => f.kind === "concern_source").length, 1);
});

test("THE TWO HAYSTACKS DO NOT CROSS", () => {
  // The whole reason there are two. A competency is what the ROLE demands and can only come
  // from the brief; a concern's evidence is what the CANDIDATE has and can only come from their
  // own material. One haystack, or a verifier that tried both, would wave through exactly these
  // two — and each is a category error wearing the shape of a valid citation.
  const cvIntoBrief = payload();
  cvIntoBrief.competencies[0].source_quote = "Ward link nurse for tissue viability from 2021";
  const a = run(cvIntoBrief);
  assert.equal(a.payload.competencies[0].verified, false, "a CV span is no competency source");

  const briefIntoCv = payload();
  concernsOf(briefIntoCv)[0].evidence_quote = "Comfortable lone working with a rural caseload";
  const b = run(briefIntoCv);
  assert.equal(concernsOf(b.payload)[0].evidence_quote, "", "a brief span is no counter");
  assert.equal(b.failures.filter((f) => f.kind === "concern_source").length, 1);
});

test("a quote whose whitespace differs from the CV's still stands up", () => {
  // normalise()'s latitude, held to exactly the same standard as the competency half: a model
  // that collapsed a line wrap has not fabricated anything.
  const p = payload();
  concernsOf(p)[0].evidence_quote = "  COMMUNITY   Staff Nurse\n — Weald Valley Community Trust,  2022–2026 ";
  const { payload: out, failures } = run(p);

  assert.equal("failed_evidence_quote" in concernsOf(out)[0], false);
  assert.equal(failures.filter((f) => f.kind === "concern_source").length, 0);
});

test("no CV at all demotes every non-empty concern — fail closed, and loudly", () => {
  // A caller that forgot the new argument. Fail-closed is correct, and it is worth pinning:
  // silently verifying against `undefined` would be the alternative, and it would mean a stored
  // payload could carry any span at all past this check.
  const { payload: out, failures } = verifyBrief(assertBrief(payload()), {
    brief: BRIEF,
    fieldKeys: FIELD_KEYS,
  });

  assert.equal(concernsOf(out)[0].evidence_quote, "");
  assert.ok("failed_evidence_quote" in concernsOf(out)[0]);
  assert.equal(concernsOf(out)[1].evidence_quote, "", "the honest gap is still not a failure");
  assert.equal("failed_evidence_quote" in concernsOf(out)[1], false);
  assert.equal(failures.filter((f) => f.kind === "concern_source").length, 1);
});

test("concern counts are additive, three-way, and read off the payload's own markers", () => {
  const p = payload();
  concernsOf(p)[0].evidence_quote = "Ran an IV therapy clinic";
  const summary = briefSummary(run(p).payload);

  assert.equal(summary.concern_sourced, 0);
  assert.equal(summary.concern_unsourced, 1, "the demoted one");
  assert.equal(summary.concern_no_material, 1, "the honest gap, counted as itself");
  assert.equal(summary.concern_total, 2);
  assert.equal(
    summary.concern_sourced + summary.concern_unsourced + summary.concern_no_material,
    summary.concern_total,
    "the three partition the total — a concern is in exactly one of them",
  );
  // Every pre-existing counter is untouched by the concerns' arrival.
  assert.deepEqual(
    { sourced: summary.sourced, panel_total: summary.panel_total, primer_total: summary.primer_total },
    { sourced: 2, panel_total: 2, primer_total: 0 },
  );
});

test("a demoted concern payload still passes assertBrief, so it can be re-verified at all", () => {
  const p = payload();
  concernsOf(p)[0].evidence_quote = "not in the CV anywhere";
  const { payload: demoted } = run(p);

  assert.equal(assertBrief(demoted), demoted, "the marked payload is still a valid brief");
});

/* ── the caller's copy is not the verifier's copy ───────────────────────────────────────── */

test("verifyBrief does not mutate the payload it was handed", () => {
  // The panel blanking sits three levels deep. Mutating in place would make the returned payload
  // alias the parsed one, and "the fabricated quote came back marked" would be unfalsifiable.
  const p = payload();
  p.blocks[2].props.panel[0].source_field_key = "invented";
  concernsOf(p)[0].evidence_quote = "invented span";
  verifyBrief(p, { brief: BRIEF, cv: CV, fieldKeys: FIELD_KEYS });

  assert.equal(p.blocks[2].props.panel[0].source_field_key, "invented");
  assert.equal(p.competencies[2].verified, undefined);
  assert.equal(concernsOf(p)[0].evidence_quote, "invented span", "#79's branch clones down too");
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
    // The fixture predates #50, which is itself the assertion: a payload with no FirstDayPrimer
    // — every stored pre-#50 brief — counts zero rather than failing.
    primer_sourced: 0,
    primer_unsourced: 0,
    primer_total: 0,
    // #79's three-way split, on the fixture's two concerns: one quotes the CV verbatim, one is
    // the honest gap. Neither is a failure, and the middle number is what says so.
    concern_sourced: 1,
    concern_unsourced: 0,
    concern_no_material: 1,
    concern_total: 2,
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
  const { payload: demoted } = verifyBrief(assertBrief(p), { brief: BRIEF, cv: CV, fieldKeys: FIELD_KEYS });

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

  const pass1 = verifyBrief(p, { brief: BRIEF, cv: CV, fieldKeys: FIELD_KEYS });
  const pass2 = verifyBrief(pass1.payload, { brief: BRIEF, cv: CV, fieldKeys: FIELD_KEYS });

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
    primer_sourced: 0,
    primer_unsourced: 0,
    primer_total: 0,
    concern_sourced: 0,
    concern_unsourced: 0,
    concern_no_material: 0,
    concern_total: 0,
  });
  const { payload: out, failures } = verifyBrief(
    { role_title: "", blocks: [], competencies: [], questions: [] },
    { brief: BRIEF, cv: CV, fieldKeys: FIELD_KEYS },
  );
  assert.deepEqual(failures, []);
  assert.deepEqual(out.competencies, []);
});
