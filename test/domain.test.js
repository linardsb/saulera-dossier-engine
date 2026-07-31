// src/domain.js — the deterministic imaging-locum read (#46).
//
// The personas here are the demo candidates from docs/handover-louis-meeting.md: the fixtures
// pin that the vocabulary the client actually uses (HCPC, Siemens Aera/Vida, day rate, MSK
// lists) parses the way the epic needs. The guard-rail cases pin the deliberate
// case-sensitivity calls and the "General Hospital" clause guard.

import { test } from "node:test";
import assert from "node:assert/strict";

import { briefProfile, ROLE_SHAPES } from "../src/domain.js";

const PRIYA_BRIEF =
  "Locum MRI/CT Radiographer, East Sussex. Rotational cover across MRI and CT lists. " +
  "Fleet is Siemens Aera and Vida, one GE MRI, Canon CT. HCPC registration essential. " +
  "Day rate DOE, inside IR35. Possibility of a permanent contract for the right person.";

const PRIYA_CV =
  "HCPC-registered Diagnostic Radiographer, 8 years; last 3 as rotational MRI/CT locum. " +
  "Siemens (Aera, Vida) and GE MRI; Canon CT. IV cannulation certified.";

const MARCUS_BRIEF =
  "Locum General & MSK Sonographer, Peterborough. General abdominal lists, small parts, " +
  "and MSK ultrasound. Reports independently. HCPC required.";

// The nursing brief from test/prompt.test.js — the perm flow this ticket must not disturb.
const NURSING_BRIEF = "Band 6 community nurse. Must hold a current NMC pin.";

test("a Priya-style locum imaging brief parses fully", () => {
  const profile = briefProfile(PRIYA_BRIEF, PRIYA_CV);
  assert.equal(profile.imaging, true);
  assert.equal(profile.role_shape, "locum");
  assert.deepEqual(profile.modalities, ["mri", "ct"]);
  for (const make of ["siemens", "ge", "canon"]) {
    assert.ok(profile.scanner_makes.includes(make), `scanner_makes is missing ${make}`);
  }
});

test("a Marcus-style sonographer brief parses ultrasound, msk and general", () => {
  const profile = briefProfile(MARCUS_BRIEF);
  assert.equal(profile.imaging, true);
  assert.ok(profile.modalities.includes("ultrasound"));
  assert.ok(profile.specialisms.includes("msk"));
  assert.ok(profile.specialisms.includes("general"));
});

test("the existing nursing brief is not imaging and nothing is invented", () => {
  const profile = briefProfile(NURSING_BRIEF, "Registered nurse. NMC registration current.");
  assert.equal(profile.imaging, false);
  assert.equal(profile.role_shape, "unknown");
  assert.deepEqual(profile.modalities, []);
  assert.deepEqual(profile.specialisms, []);
  assert.deepEqual(profile.scanner_makes, []);
});

test("'General Hospital' is a place, not a specialism; per annum reads permanent", () => {
  const profile = briefProfile(
    "East Grinstead General Hospital, permanent Band 7 MRI radiographer, salary per annum.",
  );
  assert.ok(!profile.specialisms.includes("general"), "the clause guard failed");
  assert.equal(profile.role_shape, "permanent");
  assert.equal(profile.imaging, true);
});

test("'p.a.' salary shorthand reads permanent (PR #51 review, medium)", () => {
  const profile = briefProfile("Band 7 MRI radiographer. Salary £38k p.a. plus benefits.");
  assert.equal(profile.role_shape, "permanent");
});

test("a hospital name near an imaging noun is still a place (PR #51 review, low)", () => {
  const profile = briefProfile("Sonographer post at West Suffolk General Hospital. HCPC required.");
  assert.ok(!profile.specialisms.includes("general"), "the hospital lookahead failed");
  assert.equal(profile.imaging, true);
});

test("scanner makes are read from the CV when the brief does not name a fleet", () => {
  const profile = briefProfile(
    "Locum MRI Radiographer, HCPC required.",
    "Philips and Siemens MRI experience across three trusts.",
  );
  assert.deepEqual(profile.scanner_makes, ["siemens", "philips"]);
});

test("locum beats permanent when both indicator classes hit (decision D3)", () => {
  // The common shape: a locum booking dangling "possibility of a permanent contract".
  const profile = briefProfile(PRIYA_BRIEF);
  assert.equal(profile.role_shape, "locum");
});

test("null, empty and undefined inputs give the unknown/empty profile without throwing", () => {
  for (const input of [null, undefined, ""]) {
    const profile = briefProfile(input, input);
    assert.deepEqual(profile, {
      imaging: false,
      role_shape: "unknown",
      modalities: [],
      specialisms: [],
      scanner_makes: [],
    });
  }
});

test("lowercase 'ge west' and 'the surgeon' do not hit GE or ultrasound", () => {
  // GE and CT are deliberately case-sensitive; "sonograph" must not fire inside other words.
  const profile = briefProfile("Imaging department post at ge west with the surgeon on site.");
  assert.ok(!profile.scanner_makes.includes("ge"));
  assert.ok(!profile.modalities.includes("ultrasound"));
});

test("ROLE_SHAPES is the three-value contract downstream slices branch on", () => {
  assert.deepEqual(ROLE_SHAPES, ["locum", "permanent", "unknown"]);
});
