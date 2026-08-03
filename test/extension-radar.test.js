// #69 — the extension radar, proven against real SQL rather than recorded strings.
//
// The class of failure this file catches is the one test/compliance-store.test.js cannot see at
// all: the fake runs no SQL, so a `>` where the rule means `>=`, a `datetime()` where the rule
// means `date()`, or a claim that is not actually atomic all pass there while being wrong. The
// split is deliberate — that file proves the STATEMENTS (nothing interpolated, bind parity,
// which columns are projected), this one proves the ARITHMETIC.
//
// EVERY FIXTURE DATE IS COMPUTED BY SQLITE ITSELF (`SELECT date('now','+14 days')`), not by the
// helper's `at()`. That is test/compliance-purge.test.js's rule and it matters more here than
// anywhere: `at()` builds a stamp from the JS clock, and a ±14-day boundary computed on one
// clock and compared on another flips near midnight UTC — a test that fails once a day at 00:00
// and passes every other hour is worse than no test.
//
// The seeds go through `createCandidate` and `createAssignment` — the same writers production
// uses. Engine: `node:sqlite`, which this machine's default Node 20 does not have; every test
// skips there with the remedy in the message, and Node 24 proves the rest. The PRAGMA
// foreign_keys gotcha that makes the cascade case meaningful is written down in
// test/helpers/sqlite-d1.js.

import { test } from "node:test";
import assert from "node:assert/strict";

import { EXTENSION_LEAD_DAYS } from "../src/compliance/catalogue.js";
import {
  claimExtensionNudge,
  createAssignment,
  createCandidate,
  deleteCandidate,
  dueExtensionNudges,
  listAssignments,
  updateAssignment,
} from "../src/compliance/store.js";
import { sendDueExtensionNudges } from "../src/compliance/nudges.js";
import { d1Shape, openMigrated, skip } from "./helpers/sqlite-d1.js";

/** A date SQLite computed, so the fixture's arithmetic and the query's are the same arithmetic. */
const dayOffset = (db, days) =>
  db.prepare(`SELECT date('now', '${days >= 0 ? "+" : "-"}${Math.abs(days)} days') AS d`).get().d;

/** One candidate and one booking, seeded through the production writers. */
async function seed(d1, db, { id, endDays, status, candidate = "cand-1" }) {
  const existing = db.prepare("SELECT id FROM candidate WHERE id = ?").get(candidate);
  if (!existing) {
    await createCandidate(d1, {
      id: candidate,
      fullName: `Candidate ${candidate}`,
      email: `${candidate}@example.com`,
    });
  }
  await createAssignment(d1, {
    id,
    candidateId: candidate,
    clientId: "c-1",
    startDate: dayOffset(db, -30),
    endDate: endDays === null ? null : dayOffset(db, endDays),
    status,
  });
}

const open = () => {
  const db = openMigrated();
  return { db, d1: d1Shape(db) };
};

const dueIds = async (d1) =>
  (await dueExtensionNudges(d1, EXTENSION_LEAD_DAYS)).map((row) => row.id);

const stampOf = (db, id) =>
  db.prepare("SELECT nudge_sent_at FROM assignment WHERE id = ?").get(id).nudge_sent_at;

// ── the boundary, which is the whole predicate ─────────────────────────────────────────

test("the fourteenth day is due and the fifteenth is not", { skip }, async () => {
  const { db, d1 } = open();
  await seed(d1, db, { id: "asg-13", endDays: EXTENSION_LEAD_DAYS - 1 });
  await seed(d1, db, { id: "asg-14", endDays: EXTENSION_LEAD_DAYS });
  await seed(d1, db, { id: "asg-15", endDays: EXTENSION_LEAD_DAYS + 1 });

  assert.deepEqual(
    await dueIds(d1),
    ["asg-13", "asg-14"],
    "the window is inclusive at its far edge (<=), and one day past it is silent",
  );
});

test("a booking ending today is due; one that ended yesterday is not", { skip }, async () => {
  const { db, d1 } = open();
  await seed(d1, db, { id: "asg-today", endDays: 0 });
  await seed(d1, db, { id: "asg-yesterday", endDays: -1 });

  // Day granularity, isNotPast's argument: a contract ending today is still a contract you can
  // act on at 14:00. And the radar's promise is fourteen days of WARNING — "your contract ended
  // yesterday" is a different message and #71's at-risk list is its surface.
  assert.deepEqual(await dueIds(d1), ["asg-today"]);
});

test("an open booking is never due, at any age", { skip }, async () => {
  const { db, d1 } = open();
  await seed(d1, db, { id: "asg-open", endDays: null });
  await seed(d1, db, { id: "asg-old-open", endDays: null, candidate: "cand-2" });
  db.prepare("UPDATE assignment SET start_date = date('now', '-800 days')").run();

  assert.deepEqual(await dueIds(d1), [], "no end date is no deadline to warn about");
});

test("a cancelled or ended booking inside the window is never due", { skip }, async () => {
  const { db, d1 } = open();
  await seed(d1, db, { id: "asg-booked", endDays: 5 });
  await seed(d1, db, { id: "asg-active", endDays: 6, status: "active" });
  await seed(d1, db, { id: "asg-ended", endDays: 7, status: "ended" });
  await seed(d1, db, { id: "asg-cancelled", endDays: 8, status: "cancelled" });

  // THE DELIBERATE INVERSION of purgeDormant's date-only rule. There a stale status extending
  // retention would be a privacy breach; here a stale status suppressing a nudge costs one email.
  assert.deepEqual(await dueIds(d1), ["asg-booked", "asg-active"]);
});

test("the due set is ordered soonest-first", { skip }, async () => {
  const { db, d1 } = open();
  await seed(d1, db, { id: "asg-c", endDays: 12 });
  await seed(d1, db, { id: "asg-a", endDays: 2 });
  await seed(d1, db, { id: "asg-b", endDays: 7 });

  assert.deepEqual(await dueIds(d1), ["asg-a", "asg-b", "asg-c"]);
});

// ── the claim ──────────────────────────────────────────────────────────────────────────

test("the claim has exactly one winner, and the booking drops out of the due set", { skip }, async () => {
  const { db, d1 } = open();
  await seed(d1, db, { id: "asg-1", endDays: 3 });

  assert.equal(await claimExtensionNudge(d1, "asg-1"), true, "the first caller claims it");
  assert.equal(await claimExtensionNudge(d1, "asg-1"), false, "the second sees changes === 0");
  assert.deepEqual(await dueIds(d1), [], "and it is no longer due");
  assert.ok(stampOf(db, "asg-1"), "the stamp is the whole record of a sent nudge");
});

test("claiming a booking that does not exist is false, not an error", { skip }, async () => {
  const { d1 } = open();
  assert.equal(await claimExtensionNudge(d1, "no-such-booking"), false);
  assert.equal(await claimExtensionNudge(d1, undefined), false, "and an absent id fails closed");
});

// ── the re-arm, which is the one thing here with no precedent in #25 ────────────────────

test("extending a nudged booking re-arms the radar", { skip }, async () => {
  const { db, d1 } = open();
  await seed(d1, db, { id: "asg-1", endDays: 3 });
  await claimExtensionNudge(d1, "asg-1");
  assert.deepEqual(await dueIds(d1), [], "claimed, so silent");

  // September → December: without the clear, the new deadline would never nudge and the radar
  // would go quiet exactly where it had just proved its value.
  await updateAssignment(d1, "asg-1", { endDate: dayOffset(db, 90) });
  assert.equal(stampOf(db, "asg-1"), null, "the stamp is cleared in the same statement");
  assert.deepEqual(await dueIds(d1), [], "and 90 days out is not yet inside the window");

  await updateAssignment(d1, "asg-1", { endDate: dayOffset(db, 10) });
  assert.deepEqual(await dueIds(d1), ["asg-1"], "the new deadline produces a new nudge");
});

test("extending INSIDE the window re-arms immediately — the accepted cost, recorded", { skip }, async () => {
  const { db, d1 } = open();
  await seed(d1, db, { id: "asg-1", endDays: 3 });
  await claimExtensionNudge(d1, "asg-1");

  // Four more days, still inside fourteen. This sends a SECOND email, and that email is true:
  // the booking still ends inside the window and the recruiter has a new date. One rule with no
  // arithmetic beats a cleverer rule with a boundary nobody can hold in their head. Asserted so
  // the accepted cost is a recorded decision rather than a surprise.
  await updateAssignment(d1, "asg-1", { endDate: dayOffset(db, 7) });
  assert.deepEqual(await dueIds(d1), ["asg-1"]);
});

test("resolving a nudged booking does NOT re-arm it", { skip }, async () => {
  const { db, d1 } = open();
  await seed(d1, db, { id: "asg-1", endDays: 3 });
  await claimExtensionNudge(d1, "asg-1");
  const before = stampOf(db, "asg-1");

  await updateAssignment(d1, "asg-1", { status: "ended" });
  assert.equal(stampOf(db, "asg-1"), before, "marking a booking ended settles the nudge");
  assert.deepEqual(await dueIds(d1), []);
});

test("clearing the end date reopens the booking, and its candidate is held", { skip }, async () => {
  const { db, d1 } = open();
  await seed(d1, db, { id: "asg-1", endDays: 3 });

  // The route sends null for an empty value. purgeDormant grants an OPEN booking's candidate
  // indefinite retention ("a booking with no end is a live one"), and that is now reachable from
  // a recruiter control rather than only from a considered createAssignment call. Asserted here
  // so the retention consequence is a recorded decision.
  await updateAssignment(d1, "asg-1", { endDate: null });
  assert.equal(db.prepare("SELECT end_date FROM assignment WHERE id = 'asg-1'").get().end_date, null);
  assert.deepEqual(await dueIds(d1), [], "an open booking has no deadline to warn about");
});

test("updateAssignment refuses an unknown status and an empty patch", { skip }, async () => {
  const { db, d1 } = open();
  await seed(d1, db, { id: "asg-1", endDays: 3 });

  await assert.rejects(() => updateAssignment(d1, "asg-1", { status: "extended" }), /must be one of/);
  await assert.rejects(() => updateAssignment(d1, "asg-1", {}), /nothing to change/);
  assert.equal(
    (await updateAssignment(d1, "no-such-booking", { status: "ended" })).updated,
    false,
    "changes === 0 carries not-found on its own",
  );
});

// ── what the screen reads ──────────────────────────────────────────────────────────────

test("listAssignments sinks resolved rows, then open ones, then soonest-first", { skip }, async () => {
  const { db, d1 } = open();
  await seed(d1, db, { id: "asg-open", endDays: null });
  await seed(d1, db, { id: "asg-far", endDays: 40 });
  await seed(d1, db, { id: "asg-soon", endDays: 4 });
  await seed(d1, db, { id: "asg-done", endDays: 2, status: "ended" });

  const rows = await listAssignments(d1);
  assert.deepEqual(rows.map((r) => r.id), ["asg-soon", "asg-far", "asg-open", "asg-done"]);
  // Named columns, and the projection is the decision: no candidate_id, no email, no compliance
  // state. #71's dashboard owns the checklist column.
  assert.deepEqual(
    Object.keys(rows[0]).sort(),
    ["candidate_name", "client_name", "end_date", "id", "nudge_sent_at", "start_date", "status"],
  );
});

// ── the cage still owns everything ─────────────────────────────────────────────────────

test("deleteCandidate takes the booking and its nudge stamp with it", { skip }, async () => {
  const { db, d1 } = open();
  await seed(d1, db, { id: "asg-1", endDays: 3 });
  await claimExtensionNudge(d1, "asg-1");
  assert.ok(stampOf(db, "asg-1"), "there is a stamp to take");

  await deleteCandidate(d1, "cand-1");
  assert.equal(db.prepare("SELECT count(*) AS n FROM assignment").get().n, 0, "the new column did not escape the cage");
});

// ── the sweep's guard ──────────────────────────────────────────────────────────────────

const CONFIGURED = {
  RESEND_API_KEY: "re_test_key",
  PREP_BASE_URL: "https://engine.pages.dev",
  RECRUITER_EMAIL: "desk@ttrhealthcare.example",
};

/** Run the sweep with `fetch` stubbed, and report what it did. */
async function sweep(db, d1, env) {
  const original = globalThis.fetch;
  const sends = [];
  globalThis.fetch = async (url, options) => {
    sends.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ id: "msg_1" }), { status: 200 });
  };
  try {
    await sendDueExtensionNudges({ DB: d1, ...env });
  } finally {
    globalThis.fetch = original;
  }
  return { sends, claimed: db.prepare("SELECT count(*) AS n FROM assignment WHERE nudge_sent_at IS NOT NULL").get().n };
}

for (const missing of ["DB", "RESEND_API_KEY", "PREP_BASE_URL", "RECRUITER_EMAIL"]) {
  test(`the sweep bails BEFORE claiming when ${missing} is missing`, { skip }, async () => {
    const { db, d1 } = open();
    await seed(d1, db, { id: "asg-1", endDays: 3 });

    const env = { ...CONFIGURED };
    delete env[missing];
    const { sends, claimed } = await sweep(db, missing === "DB" ? null : d1, env);

    // A sweep that cannot send must not claim, or a half-configured deployment burns each
    // booking's one nudge on nothing. Nothing is burned, so it recovers by itself once fixed.
    assert.equal(sends.length, 0, "nothing was sent");
    assert.equal(claimed, 0, "and nothing was claimed");
  });
}

test("a RECRUITER_EMAIL with a comma is refused — a second recipient nobody chose", { skip }, async () => {
  const { db, d1 } = open();
  await seed(d1, db, { id: "asg-1", endDays: 3 });

  const { sends, claimed } = await sweep(db, d1, {
    ...CONFIGURED,
    RECRUITER_EMAIL: "desk@ttr.example, someone@else.example",
  });
  assert.equal(sends.length, 0);
  assert.equal(claimed, 0);
});

test("a fully configured sweep sends exactly one nudge per due booking, once", { skip }, async () => {
  const { db, d1 } = open();
  await seed(d1, db, { id: "asg-due", endDays: 9 });
  await seed(d1, db, { id: "asg-far", endDays: 40 });

  const first = await sweep(db, d1, CONFIGURED);
  assert.equal(first.sends.length, 1, "only the booking inside the window");
  assert.equal(first.sends[0].to, CONFIGURED.RECRUITER_EMAIL);
  assert.match(first.sends[0].text, /\/assignments/, "the link is the recruiter's screen");
  assert.doesNotMatch(first.sends[0].text, /\/prep\//, "and never the candidate's portal");

  const second = await sweep(db, d1, CONFIGURED);
  assert.equal(second.sends.length, 0, "a second sweep sends nothing — the claim stands");
  assert.equal(second.claimed, 1);
});
