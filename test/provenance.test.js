// #4 AC6 — the verifier's own test suite.
//
// `smoke.test.js` proves the ported spike modules run against real model output. This file
// is the adversarial pass: it exists because the sentence "nothing in this pack is
// unsourced, and the ones we could not source are marked" is said out loud to a clinical
// staffing client, and the only thing making it true is this module failing closed.
//
// So the bias here is toward cases that would let something through, not cases that
// confirm the happy path. Every test below is a way the check could quietly pass a claim
// it should have demoted.

import { test } from "node:test";
import assert from "node:assert/strict";

import { assertPack, allClaims } from "../src/pack.js";
import { verifyPack, provenanceSummary, normalise } from "../src/provenance.js";

const CV = [
  "Registered General Nurse, NMC PIN current to March 2027.",
  "Six years on an acute medical ward at Queen Victoria Hospital.",
  "Led the ward's falls-prevention audit in 2025.",
].join("\n");

const CLIENT_NOTE = [
  "This trust interviews in two stages and always asks for a clinical scenario.",
  "They will not shortlist without a named ward-level referee.",
].join("\n");

const INPUTS = { cv: CV, clientNote: CLIENT_NOTE };

/** A minimal pack that passes assertPack, carrying exactly the claims under test. */
function packWith(claims, section = "evidence") {
  const empty = { evidence: [], process_fit: [], gaps: [] };
  return assertPack({
    candidate_ref: "CAND-001",
    role_title: "Band 5 RGN",
    headline: "Acute medical ward nurse, PIN current.",
    ...empty,
    [section]: claims,
    open_questions: [],
  });
}

const claim = (over = {}) => ({
  text: "Holds a current NMC registration.",
  source_quote: "NMC PIN current to March 2027",
  source_type: "cv",
  ...over,
});

const only = (result) => allClaims(result.pack)[0];

// ── The check must pass what it should ─────────────────────────────────────────────

test("a verbatim span passes", () => {
  const { pack, failures } = verifyPack(packWith([claim()]), INPUTS);
  assert.deepEqual(failures, []);
  assert.equal(allClaims(pack)[0].source_type, "cv");
});

test("normalisation tolerates whitespace, smart quotes, dashes and case", () => {
  // Each of these is the same span as the CV, mangled in a way a model plausibly
  // produces when it re-types rather than copies. All must still pass — this is the
  // documented latitude, and if it were tighter the check would fail honest packs.
  const variants = [
    "NMC   PIN   current to March 2027", // collapsed whitespace runs
    "NMC PIN\ncurrent to March 2027", // wrapped across a line break
    "  NMC PIN current to March 2027  ", // padded
    "nmc pin current to march 2027", // case
    "Registered General Nurse, NMC PIN current", // a shorter true substring
  ];
  for (const source_quote of variants) {
    const { failures } = verifyPack(packWith([claim({ source_quote })]), INPUTS);
    assert.deepEqual(failures, [], `should have passed: ${JSON.stringify(source_quote)}`);
  }
});

test("a claim already typed unverified passes through untouched", () => {
  // AC6. The verifier resolves claims the model asserted a source for; it must not try to
  // resolve one the model already gave up on. Two things matter: no failure is recorded
  // (this is not an error, it is the model behaving correctly), and the claim is returned
  // unchanged — in particular it does NOT acquire a `failed_quote`, which would make an
  // honest abstention look like a caught fabrication in the diagnostics.
  const c = claim({
    text: "May have theatre experience.",
    source_quote: "",
    source_type: "unverified",
  });
  const { pack, failures } = verifyPack(packWith([c]), INPUTS);

  assert.deepEqual(failures, []);
  // Compare the section entry, not allClaims() — that helper decorates each claim with
  // `section` and `index` for callers, which a deepEqual against the input would trip on.
  assert.deepEqual(pack.evidence[0], c);
  assert.ok(!("failed_quote" in pack.evidence[0]), "must not add failed_quote");
});

test("an unverified claim keeps a non-empty quote rather than having it checked", () => {
  // A model may type `unverified` while still showing its working. That text is not a
  // source claim, so it must be neither verified nor demoted — just carried.
  const c = claim({
    source_quote: "something the model was thinking about",
    source_type: "unverified",
  });
  const { pack, failures } = verifyPack(packWith([c]), INPUTS);
  assert.deepEqual(failures, []);
  assert.equal(only({ pack }).source_quote, "something the model was thinking about");
});

// ── The check must fail what it should ─────────────────────────────────────────────

test("a hallucinated quote present in neither input is demoted", () => {
  // AC6, and the case the whole module exists for. Not a paraphrase of something real
  // and not a cross-document mix-up — a span that simply is not in the CV or the note.
  const c = claim({
    text: "Completed an advanced life support course.",
    source_quote: "ALS certification renewed in January 2026",
  });
  const { pack, failures } = verifyPack(packWith([c]), INPUTS);

  assert.equal(failures.length, 1);
  assert.equal(failures[0].reason, "quote not found in source");
  assert.equal(only({ pack }).source_type, "unverified");
  assert.equal(only({ pack }).failed_quote, "ALS certification renewed in January 2026");
  // The claim text survives. Demote, don't drop — the recruiter must see what was
  // asserted in order to confirm or strike it.
  assert.equal(only({ pack }).text, "Completed an advanced life support course.");
});

test("a near-miss fails — one wrong word is a fabrication, not a rounding error", () => {
  // "current to March 2027" vs "valid to March 2027". Semantically identical, and that is
  // exactly why it must fail: the moment the check tolerates this it is exercising
  // judgment, and the claim in the room stops being true.
  const { failures } = verifyPack(
    packWith([claim({ source_quote: "NMC PIN valid to March 2027" })]),
    INPUTS,
  );
  assert.equal(failures.length, 1);
  assert.equal(failures[0].reason, "quote not found in source");
});

test("a real span attributed to the wrong document fails", () => {
  // The span exists — in the CV — but the claim says client_note. Sourcing means the
  // right source, not merely that the words occur somewhere.
  const { failures } = verifyPack(
    packWith([claim({ source_type: "client_note" })]),
    INPUTS,
  );
  assert.equal(failures.length, 1);
  assert.equal(failures[0].claimed_source, "client_note");
});

test("empty and whitespace-only quotes both fail as empty, not as not-found", () => {
  // A whitespace-only quote normalises to "" and must take the same branch as "". If it
  // fell through to the substring check it would match anything, since "" is in every
  // string — the one input that would let a claim pass with no evidence at all.
  for (const source_quote of ["", "   ", "\n\t "]) {
    const { pack, failures } = verifyPack(packWith([claim({ source_quote })]), INPUTS);
    assert.equal(failures.length, 1, `expected failure for ${JSON.stringify(source_quote)}`);
    assert.equal(failures[0].reason, "empty quote");
    assert.equal(only({ pack }).source_type, "unverified");
  }
});

test("a missing client note fails its claims rather than throwing", () => {
  // Real failure mode: the agency has not written the note yet. The verifier must treat
  // that as unsourced, not crash the generation — an exception here would take out the
  // whole pack over a field the recruiter simply has not filled in.
  const c = claim({
    source_quote: "interviews in two stages",
    source_type: "client_note",
  });
  for (const inputs of [{ cv: CV }, { cv: CV, clientNote: "" }, { cv: CV, clientNote: null }]) {
    const { pack, failures } = verifyPack(packWith([c], "process_fit"), inputs);
    assert.equal(failures.length, 1);
    assert.equal(only({ pack }).source_type, "unverified");
  }
});

// ── Structural guarantees ──────────────────────────────────────────────────────────

test("failures carry the section and index needed to locate the claim", () => {
  const pack = assertPack({
    candidate_ref: "CAND-002",
    role_title: "Band 5 RGN",
    headline: "…",
    evidence: [claim(), claim({ source_quote: "not in any document" })],
    process_fit: [],
    gaps: [claim({ source_quote: "also not present" })],
    open_questions: [],
  });
  const { failures } = verifyPack(pack, INPUTS);

  assert.equal(failures.length, 2);
  assert.deepEqual(
    failures.map((f) => [f.section, f.index]),
    [["evidence", 1], ["gaps", 0]],
  );
});

test("every section carrying claims is checked, not just evidence", () => {
  // A verifier that only walked `evidence` would pass this pack silently, and
  // process_fit is the section sourced from the client note — the part a job board
  // cannot produce and the part most worth trusting.
  const bad = claim({ source_quote: "fabricated span" });
  for (const section of ["evidence", "process_fit", "gaps"]) {
    const { failures } = verifyPack(packWith([bad], section), INPUTS);
    assert.equal(failures.length, 1, `${section} was not checked`);
    assert.equal(failures[0].section, section);
  }
});

test("verifyPack does not mutate the pack it was given", () => {
  // Callers hold the raw model output for diagnostics. If verification edited it in
  // place, the record of what the model actually said would be lost at the moment it
  // became interesting.
  const original = packWith([claim({ source_quote: "fabricated span" })]);
  const snapshot = structuredClone(original);
  verifyPack(original, INPUTS);
  assert.deepEqual(original, snapshot);
});

test("no code path returns a sourced claim that failed its check", () => {
  // The invariant, stated directly. Whatever the input, every claim in the returned pack
  // is either verified against its named source or typed unverified.
  const packs = [
    packWith([claim(), claim({ source_quote: "nope" })]),
    packWith([claim({ source_quote: "" })]),
    packWith([claim({ source_type: "unverified", source_quote: "" })]),
    packWith([claim({ source_type: "client_note" })], "process_fit"),
  ];
  for (const p of packs) {
    const { pack } = verifyPack(p, INPUTS);
    for (const c of allClaims(pack)) {
      if (c.source_type === "unverified") continue;
      const haystack = normalise(c.source_type === "cv" ? CV : CLIENT_NOTE);
      assert.ok(
        normalise(c.source_quote) && haystack.includes(normalise(c.source_quote)),
        `claim survived as ${c.source_type} without a literal match: ${c.source_quote}`,
      );
    }
  }
});

test("provenanceSummary counts the verified pack, not the claimed one", () => {
  // The summary drives §7's weekly evidence gate. Counting pre-verification would report
  // zero unsourced claims on a pack full of fabrications — the exact metric failing in
  // the exact way it exists to catch.
  const pack = packWith([
    claim(),
    claim({ source_quote: "fabricated" }),
    claim({ source_type: "unverified", source_quote: "" }),
  ]);
  const { pack: verified } = verifyPack(pack, INPUTS);

  assert.deepEqual(provenanceSummary(verified), {
    cv: 1,
    client_note: 0,
    unverified: 2,
    total: 3,
  });
  assert.equal(provenanceSummary(pack).unverified, 1, "pre-verification count differs");
});

// ── the locum sections (#49) ───────────────────────────────────────────────────────

test("a fabricated compliance quote is demoted with the section named", () => {
  const pack = assertPack({
    ...packWith([]),
    compliance: [
      {
        check: "DBS",
        text: "DBS clear, dated this year.",
        source_quote: "enhanced DBS dated January 2026",
        source_type: "cv",
      },
    ],
  });
  const { pack: verified, failures } = verifyPack(pack, INPUTS);

  assert.equal(failures.length, 1);
  assert.equal(failures[0].section, "compliance");
  assert.equal(verified.compliance[0].source_type, "unverified");
  assert.equal(verified.compliance[0].failed_quote, "enhanced DBS dated January 2026");
  assert.equal(verified.compliance[0].text, "DBS clear, dated this year.", "demoted, not dropped");
});

test("provenanceSummary counts claims across all three locum sections", () => {
  const locumClaim = (extra) => ({ ...claim({ source_type: "unverified", source_quote: "" }), ...extra });
  const pack = assertPack({
    ...packWith([claim()]),
    compliance: [locumClaim({ check: "DBS" })],
    booking: [locumClaim({ item: "Rate" })],
    modality_matrix: [locumClaim({ row: "CT" })],
  });
  assert.deepEqual(provenanceSummary(pack), {
    cv: 1,
    client_note: 0,
    unverified: 3,
    total: 4,
  });
});

test("a pack without the locum sections verifies and counts as before, gaining nothing", () => {
  const pack = packWith([claim()]);
  const { pack: verified, failures } = verifyPack(pack, INPUTS);
  assert.deepEqual(failures, []);
  assert.ok(!("compliance" in verified), "a legacy pack must not gain empty locum arrays");
  assert.equal(provenanceSummary(verified).total, 1);
});

// ── normalise() itself ─────────────────────────────────────────────────────────────

test("normalise folds only what it claims to fold", () => {
  assert.equal(normalise("a\n  b"), "a b");
  assert.equal(normalise("the trust’s"), "the trust's");
  assert.equal(normalise("“quoted”"), '"quoted"');
  assert.equal(normalise("2024–2025"), "2024-2025");
  assert.equal(normalise("  Mixed CASE  "), "mixed case");
  assert.equal(normalise(null), "");
  assert.equal(normalise(undefined), "");
  // Not folded: different words stay different. This is the line between verification
  // and a second opinion.
  assert.notEqual(normalise("registration current"), normalise("registration is current"));
  assert.notEqual(normalise("nurse"), normalise("nurses"));
});
