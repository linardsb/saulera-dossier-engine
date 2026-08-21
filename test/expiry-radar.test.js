// #70 — the expiry radar, proven against real SQL rather than recorded strings.
//
// The class of failure this file catches is the one test/compliance-store.test.js cannot see at
// all: the fake runs no SQL, so a `<` where the rule means `<=`, an amber test that runs before
// the red one, or a compare-and-swap that is not actually atomic all pass there while being
// wrong. The split is deliberate — that file proves the STATEMENTS (nothing interpolated, bind
// parity, which columns are projected), this one proves the ARITHMETIC.
//
// EVERY FIXTURE DATE IS COMPUTED BY SQLITE ITSELF (`SELECT date('now','+30 days')`), not by the
// helper's `at()`. That is test/extension-radar.test.js's rule and it matters more here than
// anywhere: `at()` builds a stamp from the JS clock, and a ±30-day boundary computed on one
// clock and compared on another flips near midnight UTC — a test that fails once a day at 00:00
// and passes every other hour is worse than no test. Every threshold is read off the CATALOGUE
// for the same reason the sweep reads it: a retune must not silently invalidate this file.
//
// The seeds go through `createCandidate` and `setItemState` — the same writers production uses.
// The two cases that bypass them (a non-expiring item holding a date, an item_key retired from
// the catalogue) use raw SQL on purpose: neither state is reachable through a route, and the
// point of each test is that the CATALOGUE GUARD stops it rather than the SQL.
//
// Engine: `node:sqlite`, which this machine's default Node 20 does not have; every test skips
// there with the remedy in the message, and Node 24 proves the rest. The PRAGMA foreign_keys
// gotcha that makes the cascade case meaningful is written down in test/helpers/sqlite-d1.js.

import { test } from "node:test";
import assert from "node:assert/strict";

import { COMPLIANCE_CATALOGUE, MAX_AMBER_DAYS } from "../src/compliance/catalogue.js";
import {
  claimItemExpiry,
  createCandidate,
  deleteCandidate,
  dueExpiryItems,
  itemsByCandidate,
  setItemState,
} from "../src/compliance/store.js";
import { mailExpiryNudges, sweepExpiryStates } from "../src/compliance/nudges.js";
import { d1Shape, openMigrated, skip } from "./helpers/sqlite-d1.js";

/** The catalogue's own number for an item — never a literal, for the sweep's own reason. */
const amberOf = (key) => COMPLIANCE_CATALOGUE.find((item) => item.key === key).amberDays;

/** A date SQLite computed, so the fixture's arithmetic and the query's are the same arithmetic. */
const dayOffset = (db, days) =>
  db.prepare(`SELECT date('now', '${days >= 0 ? "+" : "-"}${Math.abs(days)} days') AS d`).get().d;

const open = () => {
  const db = openMigrated();
  return { db, d1: d1Shape(db) };
};

/** One candidate with a full checklist, then one item given a state and a date. */
async function seedItem(
  d1,
  db,
  { candidate = "cand-1", itemKey, status = "submitted", expiryDays },
) {
  const existing = db.prepare("SELECT id FROM candidate WHERE id = ?").get(candidate);
  if (!existing) {
    await createCandidate(d1, {
      id: candidate,
      fullName: `Candidate ${candidate}`,
      email: `${candidate}@example.com`,
    });
  }
  await setItemState(d1, {
    candidateId: candidate,
    itemKey,
    status,
    reference: `REF-${itemKey}`,
    expiryDate: expiryDays === null ? null : dayOffset(db, expiryDays),
  });
}

const statusOf = (db, candidate, itemKey) =>
  db
    .prepare("SELECT status FROM compliance_item WHERE candidate_id = ? AND item_key = ?")
    .get(candidate, itemKey).status;

const dateOf = (db, candidate, itemKey) =>
  db
    .prepare("SELECT expiry_date FROM compliance_item WHERE candidate_id = ? AND item_key = ?")
    .get(candidate, itemKey).expiry_date;

// ── the boundary, per item type, which is the whole point ──────────────────────────────

test("the amber window is each item's OWN, not one number for all", { skip }, async () => {
  const { db, d1 } = open();
  // Both thresholds in ONE sweep. This is the assertion that a single hardcoded 60 would fail:
  // it would amber the 30-day items sitting 45 days out.
  await seedItem(d1, db, { itemKey: "hcpc_registration", expiryDays: amberOf("hcpc_registration") });
  await seedItem(d1, db, { itemKey: "dbs_enhanced", expiryDays: amberOf("dbs_enhanced") + 1 });
  await seedItem(d1, db, { itemKey: "immunisations", expiryDays: amberOf("immunisations") });
  await seedItem(d1, db, { itemKey: "indemnity", expiryDays: amberOf("indemnity") + 1 });
  await seedItem(d1, db, { itemKey: "fit_to_work", expiryDays: 45 });

  await sweepExpiryStates(d1);

  assert.equal(statusOf(db, "cand-1", "hcpc_registration"), "expiring", "inclusive at the far edge");
  assert.equal(statusOf(db, "cand-1", "dbs_enhanced"), "submitted", "one day past it is silent");
  assert.equal(statusOf(db, "cand-1", "immunisations"), "expiring", "the 30-day item at 30 days");
  assert.equal(statusOf(db, "cand-1", "indemnity"), "submitted", "the 30-day item at 31 days");
  // Selected by the SQL (45 <= MAX_AMBER_DAYS) and discarded by targetFor. The over-select is
  // the design: SQL narrows, the catalogue decides.
  assert.equal(statusOf(db, "cand-1", "fit_to_work"), "submitted", "a 30-day item at 45 days");
});

test("it runs out today: amber, never red", { skip }, async () => {
  const { db, d1 } = open();
  await seedItem(d1, db, { itemKey: "immunisations", expiryDays: 0 });

  await sweepExpiryStates(d1);
  // isNotPast's argument (src/prep/dates.js): a certificate valid to the 3rd is valid all day
  // on the 3rd.
  assert.equal(statusOf(db, "cand-1", "immunisations"), "expiring");
});

test("it ran out yesterday: red", { skip }, async () => {
  const { db, d1 } = open();
  await seedItem(d1, db, { itemKey: "immunisations", expiryDays: -1 });

  await sweepExpiryStates(d1);
  assert.equal(statusOf(db, "cand-1", "immunisations"), "expired");
});

test("a verified item lapsed 90 days ago goes STRAIGHT to expired", { skip }, async () => {
  const { db, d1 } = open();
  await seedItem(d1, db, { itemKey: "hcpc_registration", status: "verified", expiryDays: -90 });

  // RED IS TESTED FIRST in targetFor. Every negative number also satisfies "<= amberDays", so an
  // amber-first ordering would tell a candidate their registration that lapsed in May "runs out
  // soon". There is no second condition to get wrong — only the order.
  const claimed = await sweepExpiryStates(d1);
  assert.equal(statusOf(db, "cand-1", "hcpc_registration"), "expired");
  assert.deepEqual(
    claimed.map((row) => row.status),
    ["expired"],
    "and it never passed through expiring on the way",
  );
});

// ── the states the sweep may start from, and the two it may write ──────────────────────

test("submitted, verified and expiring are the three states a crossing starts from", { skip }, async () => {
  const { db, d1 } = open();
  await seedItem(d1, db, { itemKey: "hcpc_registration", status: "submitted", expiryDays: 10 });
  await seedItem(d1, db, { itemKey: "dbs_enhanced", status: "verified", expiryDays: 10 });
  await seedItem(d1, db, { itemKey: "immunisations", status: "expiring", expiryDays: -1 });

  await sweepExpiryStates(d1);
  assert.equal(statusOf(db, "cand-1", "hcpc_registration"), "expiring");
  assert.equal(statusOf(db, "cand-1", "dbs_enhanced"), "expiring");
  assert.equal(statusOf(db, "cand-1", "immunisations"), "expired", "amber → red is the second crossing");
});

test("a missing item is never selected — it holds no date", { skip }, async () => {
  const { db, d1 } = open();
  await createCandidate(d1, { id: "cand-1", fullName: "Priya Nair", email: "p@example.com" });

  assert.deepEqual(await dueExpiryItems(d1, MAX_AMBER_DAYS), [], "a fresh checklist has no deadlines");
  assert.deepEqual(await sweepExpiryStates(d1), []);
  assert.equal(statusOf(db, "cand-1", "hcpc_registration"), "missing");
});

test("expired is terminal: a later sweep claims nothing", { skip }, async () => {
  const { db, d1 } = open();
  await seedItem(d1, db, { itemKey: "immunisations", status: "expired", expiryDays: -5 });

  assert.deepEqual(await sweepExpiryStates(d1), [], "an item cannot get more expired");
  assert.equal(statusOf(db, "cand-1", "immunisations"), "expired");
});

test("a non-expiring item holding a date is skipped by the CATALOGUE, not by the SQL", { skip }, async () => {
  const { db, d1 } = open();
  await createCandidate(d1, { id: "cand-1", fullName: "Priya Nair", email: "p@example.com" });
  // Forced straight through SQL: functions/prep/compliance/api/item.js answers 400 for a date on
  // an item the catalogue marks `expires: false`, so this state is unreachable in production. The
  // point is that even if it existed, `entry.expires` is what declines it.
  db.prepare(
    "UPDATE compliance_item SET status = 'submitted', expiry_date = ? WHERE candidate_id = 'cand-1' AND item_key = 'references'",
  ).run(dayOffset(db, 5));

  const due = await dueExpiryItems(d1, MAX_AMBER_DAYS);
  assert.equal(due.length, 1, "the SQL does select it — it has a date and a live status");
  assert.deepEqual(await sweepExpiryStates(d1), [], "and the catalogue guard is what stops it");
  assert.equal(statusOf(db, "cand-1", "references"), "submitted");
});

test("an item_key retired from the catalogue is skipped, not thrown", { skip }, async () => {
  const { db, d1 } = open();
  await createCandidate(d1, { id: "cand-1", fullName: "Priya Nair", email: "p@example.com" });
  // compliance_item.item_key carries no CHECK by design, so a catalogue edit leaves old rows
  // behind. A sweep that threw here would take every other candidate's crossing down with it.
  db.prepare(
    "INSERT INTO compliance_item (candidate_id, item_key, status, expiry_date) VALUES (?, ?, ?, ?)",
  ).run("cand-1", "mandatory_training", "submitted", dayOffset(db, 5));

  assert.deepEqual(await sweepExpiryStates(d1), []);
  assert.equal(statusOf(db, "cand-1", "mandatory_training"), "submitted");
});

// ── the claim ──────────────────────────────────────────────────────────────────────────

test("two sweeps in a row: the first claims, the second claims nothing", { skip }, async () => {
  const { db, d1 } = open();
  await seedItem(d1, db, { itemKey: "immunisations", expiryDays: 10 });

  assert.equal((await sweepExpiryStates(d1)).length, 1, "one crossing");
  assert.equal(statusOf(db, "cand-1", "immunisations"), "expiring");
  // The row is still SELECTED on the second sweep (it is still inside its window and still in a
  // live status) and is left alone because target === row.status. That is what makes one
  // crossing produce exactly one nudge.
  assert.deepEqual(await sweepExpiryStates(d1), [], "amber does not re-fire while it sits amber");
});

test("claimItemExpiry wins once and loses every time after", { skip }, async () => {
  const { db, d1 } = open();
  await seedItem(d1, db, { itemKey: "immunisations", expiryDays: 10 });
  const [row] = await dueExpiryItems(d1, MAX_AMBER_DAYS);

  const args = { id: row.id, from: "submitted", to: "expiring", expiryDate: row.expiry_date };
  assert.equal(await claimItemExpiry(d1, args), true, "the first caller claims it");
  assert.equal(await claimItemExpiry(d1, args), false, "the second sees changes === 0");
  assert.equal(statusOf(db, "cand-1", "immunisations"), "expiring");
});

test("the driver hands integer ids back as numbers — recorded, not assumed", { skip }, async () => {
  const { db, d1 } = open();
  await seedItem(d1, db, { itemKey: "immunisations", expiryDays: 10 });
  const rows = await dueExpiryItems(d1, MAX_AMBER_DAYS);

  // claimItemExpiry's guard is Number.isInteger, which is stricter than any other id guard in
  // the store, and a throw there kills the WHOLE sweep rather than one row. So the answer is
  // recorded here rather than reasoned about. The bigint branch stays as the fail-safe.
  assert.equal(typeof rows[0].id, "number");
  assert.equal(typeof rows[0].days_left, "number", "and SQLite's arithmetic arrives as a number too");
  assert.equal(rows[0].days_left, 10, "an exact integer: both operands are date-only");
});

test("a stale `from` loses the claim", { skip }, async () => {
  const { db, d1 } = open();
  await seedItem(d1, db, { itemKey: "immunisations", status: "verified", expiryDays: 10 });
  const [row] = await dueExpiryItems(d1, MAX_AMBER_DAYS);

  const won = await claimItemExpiry(d1, {
    id: row.id,
    from: "submitted", // not what the row says
    to: "expiring",
    expiryDate: row.expiry_date,
  });
  assert.equal(won, false);
  assert.equal(statusOf(db, "cand-1", "immunisations"), "verified", "and nothing moved");
});

test("A STALE DATE LOSES EVEN WHEN THE STATUS IS UNCHANGED — the reason this test exists", { skip }, async () => {
  const { db, d1 } = open();
  await seedItem(d1, db, { itemKey: "immunisations", expiryDays: 29 });
  const [row] = await dueExpiryItems(d1, MAX_AMBER_DAYS);

  // THE ORDINARY RENEWAL, which does NOT change the status: functions/prep/compliance/api/item.js
  // always writes `submitted`, so a locum renewing an immunisation record 20 months out goes
  // submitted → submitted with a new date.
  const renewed = dayOffset(db, 600);
  await setItemState(d1, {
    candidateId: "cand-1",
    itemKey: "immunisations",
    status: "submitted",
    reference: "IMM-NEW",
    expiryDate: renewed,
  });

  // The sweep now tries to claim with what it OBSERVED, which is stale. A status-only guard
  // matches this and stamps `expiring` over a date twenty months out — the card would read
  // "Expiring · runs out <2028>", the candidate's email would name a date no longer in the
  // database, and it would be STICKY, because the next sweep does not select that row at all.
  const won = await claimItemExpiry(d1, {
    id: row.id,
    from: "submitted",
    to: "expiring",
    expiryDate: row.expiry_date,
  });
  assert.equal(won, false, "the date in the WHERE is what closes it");
  assert.equal(statusOf(db, "cand-1", "immunisations"), "submitted", "the renewal stands");
  assert.equal(dateOf(db, "cand-1", "immunisations"), renewed, "with its own date");
});

test("a re-submit that only fixes a typo keeps the same date, and the claim still wins", { skip }, async () => {
  const { db, d1 } = open();
  await seedItem(d1, db, { itemKey: "immunisations", expiryDays: 10 });
  const [row] = await dueExpiryItems(d1, MAX_AMBER_DAYS);

  // Same date, corrected reference. Nothing about the deadline changed, so the crossing is still
  // true and the claim is still right to win.
  await setItemState(d1, {
    candidateId: "cand-1",
    itemKey: "immunisations",
    status: "submitted",
    reference: "IMM-CORRECTED",
    expiryDate: row.expiry_date,
  });

  const won = await claimItemExpiry(d1, {
    id: row.id,
    from: "submitted",
    to: "expiring",
    expiryDate: row.expiry_date,
  });
  assert.equal(won, true);
  assert.equal(statusOf(db, "cand-1", "immunisations"), "expiring");
});

test("claimItemExpiry refuses a state no sweep may write, before any SQL runs", { skip }, async () => {
  const { db, d1 } = open();
  await seedItem(d1, db, { itemKey: "immunisations", expiryDays: 10 });
  const [row] = await dueExpiryItems(d1, MAX_AMBER_DAYS);
  const base = { id: row.id, from: "submitted", expiryDate: row.expiry_date };

  // A sweep that could write `verified` would let a clock mark a document as checked.
  await assert.rejects(() => claimItemExpiry(d1, { ...base, to: "verified" }), /must be one of/);
  await assert.rejects(() => claimItemExpiry(d1, { ...base, to: "missing" }), /must be one of/);
  await assert.rejects(() => claimItemExpiry(d1, { ...base, to: "submitted" }), /must be one of/);
  await assert.rejects(() => claimItemExpiry(d1, { ...base, from: "lapsed", to: "expired" }), /must be one of/);
  await assert.rejects(
    () => claimItemExpiry(d1, { id: row.id, from: "submitted", to: "expiring", expiryDate: "" }),
    /required/,
  );
  await assert.rejects(
    () => claimItemExpiry(d1, { ...base, id: "5", to: "expiring" }),
    /must be an integer/,
  );
  await assert.rejects(() => claimItemExpiry(d1, {}), /must be an integer/);

  assert.equal(statusOf(db, "cand-1", "immunisations"), "submitted", "and none of them wrote anything");
});

// ── the renewal, which is the re-arm and needs no code in this ticket ──────────────────

test("a renewal drops the item out of amber and it crosses again on the new date", { skip }, async () => {
  const { db, d1 } = open();
  await seedItem(d1, db, { itemKey: "immunisations", expiryDays: 10 });
  await sweepExpiryStates(d1);
  assert.equal(statusOf(db, "cand-1", "immunisations"), "expiring");

  // The passport's own write (functions/prep/compliance/api/item.js). No code in this ticket
  // does this — the route already did — and this test is what records the loop so a future
  // change to that route cannot break the radar silently.
  await setItemState(d1, {
    candidateId: "cand-1",
    itemKey: "immunisations",
    status: "submitted",
    reference: "IMM-2027",
    expiryDate: dayOffset(db, 200),
  });
  assert.deepEqual(await sweepExpiryStates(d1), [], "200 days out is outside every window");
  assert.equal(statusOf(db, "cand-1", "immunisations"), "submitted");

  await setItemState(d1, {
    candidateId: "cand-1",
    itemKey: "immunisations",
    status: "submitted",
    reference: "IMM-2027",
    expiryDate: dayOffset(db, 10),
  });
  assert.equal((await sweepExpiryStates(d1)).length, 1, "the new deadline produces a new crossing");
  assert.equal(statusOf(db, "cand-1", "immunisations"), "expiring");
});

// ── the two sends ──────────────────────────────────────────────────────────────────────

const CONFIGURED = {
  RESEND_API_KEY: "re_test_key",
  PREP_BASE_URL: "https://engine.pages.dev",
  RECRUITER_EMAIL: "desk@ttrhealthcare.example",
};

/** Sweep, then mail, with `fetch` stubbed — and report what went out. */
async function sweep(d1, env, { failFirst = false } = {}) {
  const original = globalThis.fetch;
  const sends = [];
  let attempts = 0;
  globalThis.fetch = async (url, options) => {
    attempts += 1;
    if (failFirst && attempts === 1) throw new TypeError("network down");
    sends.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ id: "msg_1" }), { status: 200 });
  };
  try {
    const claimed = await sweepExpiryStates(d1);
    await mailExpiryNudges({ DB: d1, ...env }, claimed);
    return { sends, claimed, attempts };
  } finally {
    globalThis.fetch = original;
  }
}

/** Two candidates, three crossings, one sweep. */
async function seedTwoCandidates(d1, db) {
  await seedItem(d1, db, { itemKey: "hcpc_registration", expiryDays: 10 });
  await seedItem(d1, db, { itemKey: "immunisations", expiryDays: 5 });
  await seedItem(d1, db, { candidate: "cand-2", itemKey: "dbs_enhanced", expiryDays: 12 });
}

test("two candidates, three crossings → two candidate emails and ONE digest", { skip }, async () => {
  const { db, d1 } = open();
  await seedTwoCandidates(d1, db);

  const { sends, claimed } = await sweep(d1, CONFIGURED);
  assert.equal(claimed.length, 3, "three rows crossed");
  assert.equal(sends.length, 3, "grouped: one per candidate, plus one digest");

  const digest = sends.find((body) => body.to === CONFIGURED.RECRUITER_EMAIL);
  const toOne = sends.find((body) => body.to === "cand-1@example.com");
  const toTwo = sends.find((body) => body.to === "cand-2@example.com");
  assert.ok(digest && toOne && toTwo, "all three recipients are distinct");

  // The digest is the whole answer, so it names everyone.
  assert.ok(digest.text.includes("Candidate cand-1"), "the digest names the first candidate");
  assert.ok(digest.text.includes("Candidate cand-2"), "and the second");
  assert.equal(digest.subject, "Compliance expiries: 3 to chase", "a count, never a name");

  // A locum whose two items lapse the same week gets ONE email listing both, and nothing about
  // anyone else's paperwork.
  assert.ok(toOne.text.includes("HCPC registration"), "one message lists both of their items");
  assert.ok(toOne.text.includes("Immunisation record"));
  assert.ok(!toOne.text.includes("Enhanced DBS check"), "and never another candidate's");
  assert.ok(!toOne.text.includes("Candidate cand-2"), "nor their name");
});

test("the candidate's email links to the COMPLIANCE door and carries no reference number", { skip }, async () => {
  const { db, d1 } = open();
  await seedItem(d1, db, { itemKey: "immunisations", expiryDays: 5 });

  const { sends } = await sweep(d1, CONFIGURED);
  const body = sends.find((sent) => sent.to === "cand-1@example.com");

  const link = "https://engine.pages.dev/prep/compliance/login";
  assert.ok(body.text.split("\n").includes(link), "bare on its own line, for plain-text clients");
  assert.ok(body.html.includes(`href="${link}"`), "and inside an href in the html half");
  // The two portals hold independent cookies; /prep/login would sign them in to the wrong product.
  assert.ok(!/\/prep\/login/.test(body.text), "never the interview-prep door");
  // sendReminderEmail's rule: no raw token exists to send, and minting one would rotate
  // session_hash under a live session.
  assert.ok(!/\/prep\/auth\/enter/.test(JSON.stringify(body)), "and never a token-shaped path");

  // It is theirs, they typed it, and reading it back to them in a message that could sit in an
  // inbox for years is not what this email is for.
  assert.ok(!JSON.stringify(body).includes("REF-immunisations"), "no reference number, either half");
});

test("the digest links to the RECRUITER's screen, never to a candidate door (#71)", { skip }, async () => {
  const { db, d1 } = open();
  await seedItem(d1, db, { itemKey: "immunisations", expiryDays: 5 });

  const { sends } = await sweep(d1, CONFIGURED);
  const digest = sends.find((sent) => sent.to === CONFIGURED.RECRUITER_EMAIL);

  // This message carried NO link when #70 shipped it, because there was no recruiter compliance
  // surface to point at — /assignments deliberately projects no compliance state, so a link
  // there would have pointed at a screen that could not show what the email is about. #71 built
  // /compliance and this is the assertion that changed with it.
  for (const [half, content] of Object.entries({ text: digest.text, html: digest.html })) {
    assert.ok(content.includes(`${CONFIGURED.PREP_BASE_URL}/compliance`), `the ${half} half links the dashboard`);
    // The rule that did NOT change, and the one that matters more: a /prep/* link would send the
    // recruiter to a candidate's door, where the cookies are a different product's.
    assert.ok(!content.includes("/prep/"), `the ${half} half points at no portal path`);
  }
});

test("with no PREP_BASE_URL the digest still sends, unchanged (#71)", { skip }, async () => {
  const { db, d1 } = open();
  await seedItem(d1, db, { itemKey: "immunisations", expiryDays: 5 });

  // The two configuration guards stay INDEPENDENT. The link is an enrichment: coupling the
  // digest to PREP_BASE_URL would stop a deployment that has RECRUITER_EMAIL and no base URL
  // receiving the digest it receives today — a regression dressed as a feature.
  const { sends } = await sweep(d1, { ...CONFIGURED, PREP_BASE_URL: "" });
  const digest = sends.find((sent) => sent.to === CONFIGURED.RECRUITER_EMAIL);

  assert.ok(digest, "the digest still goes out");
  assert.doesNotMatch(digest.text, /https?:\/\//, "and carries no URL, exactly as it did in #70");
  assert.doesNotMatch(digest.html, /https?:\/\//);
});

test("THE STATE MOVES WITH NO MAIL CONFIGURATION WHATSOEVER", { skip }, async () => {
  const { db, d1 } = open();
  await seedItem(d1, db, { itemKey: "immunisations", expiryDays: 5 });

  // No env in sight — not even a database wrapper carrying one. This is the assertion that fails
  // if someone "harmonises" this sweep with sendDueExtensionNudges' bail-before-claim rule, and
  // it is the single most important test in the file: `status` is what the passport RENDERS, so
  // refusing to claim would mean showing a locum a green "Sent in" chip over a lapsed record.
  const claimed = await sweepExpiryStates(d1);
  assert.equal(claimed.length, 1);
  assert.equal(statusOf(db, "cand-1", "immunisations"), "expiring");
});

test("PREP_BASE_URL without RECRUITER_EMAIL: the candidates are told, the desk is not", { skip }, async () => {
  const { db, d1 } = open();
  await seedTwoCandidates(d1, db);

  const env = { ...CONFIGURED };
  delete env.RECRUITER_EMAIL;
  const { sends } = await sweep(d1, env);

  assert.equal(sends.length, 2, "one per candidate");
  assert.ok(!sends.some((body) => body.to === CONFIGURED.RECRUITER_EMAIL), "and no digest");
});

test("RECRUITER_EMAIL without PREP_BASE_URL: the desk is told, the candidates are not", { skip }, async () => {
  const { db, d1 } = open();
  await seedTwoCandidates(d1, db);

  const env = { ...CONFIGURED };
  delete env.PREP_BASE_URL;
  const { sends } = await sweep(d1, env);

  // The candidate's message is a link and nothing else useful; without a base URL there is no
  // link to send. The digest carries none, so it is unaffected — two independent guards.
  assert.equal(sends.length, 1);
  assert.equal(sends[0].to, CONFIGURED.RECRUITER_EMAIL);
});

test("a RECRUITER_EMAIL with a comma sends no digest — and the candidates still hear", { skip }, async () => {
  const { db, d1 } = open();
  await seedTwoCandidates(d1, db);

  const { sends } = await sweep(d1, {
    ...CONFIGURED,
    RECRUITER_EMAIL: "desk@ttr.example, someone@else.example",
  });

  // A comma in `to` is a second recipient nobody chose, on the message that names the most
  // people at once. recipient() fails closed and the candidate half is untouched by it.
  assert.equal(sends.length, 2);
  assert.ok(!sends.some((body) => /someone@else/.test(body.to)));
});

test("with no RESEND_API_KEY nothing is sent, and the states have already moved", { skip }, async () => {
  const { db, d1 } = open();
  await seedItem(d1, db, { itemKey: "immunisations", expiryDays: 5 });

  const env = { ...CONFIGURED };
  delete env.RESEND_API_KEY;
  const { sends } = await sweep(d1, env);

  assert.equal(sends.length, 0);
  assert.equal(statusOf(db, "cand-1", "immunisations"), "expiring", "the claim is not gated on mail");
});

test("one failed send does not stop the batch, and rolls nothing back", { skip }, async () => {
  const { db, d1 } = open();
  await seedTwoCandidates(d1, db);

  const { sends, attempts } = await sweep(d1, CONFIGURED, { failFirst: true });

  assert.equal(attempts, 3, "all three were attempted");
  assert.equal(sends.length, 2, "and the two after the failure went out");
  // AT-MOST-ONCE outranks delivery: the state is the claim, so a failed send leaves the state
  // moved with no message behind it. That is the cost, and it is stated in the module header,
  // DEPLOY.md and scripts/remind.py rather than engineered around.
  assert.equal(statusOf(db, "cand-1", "hcpc_registration"), "expiring");
  assert.equal(statusOf(db, "cand-2", "dbs_enhanced"), "expiring");
});

test("an empty claim set never reaches getAgency or fetch", { skip }, async () => {
  const { db, d1 } = open();
  await seedItem(d1, db, { itemKey: "immunisations", expiryDays: 200 });

  const { sends, claimed } = await sweep(d1, CONFIGURED);
  assert.deepEqual(claimed, [], "nothing crossed");
  assert.equal(sends.length, 0, "so the quiet day costs no mail call at all");
});

test("the agency's name reaches both messages through mailFrom", { skip }, async () => {
  const { db, d1 } = open();
  db.prepare("UPDATE agency SET name = 'TTR Healthcare' WHERE id = 1").run();
  await seedItem(d1, db, { itemKey: "immunisations", expiryDays: 5 });

  const { sends } = await sweep(d1, CONFIGURED);
  for (const body of sends) {
    assert.equal(body.from, '"TTR Healthcare" <prep@saulera.com>');
  }
  const toCandidate = sends.find((sent) => sent.to === "cand-1@example.com");
  assert.ok(toCandidate.text.includes("TTR Healthcare"), "and it is named in the body too");
});

// ── the cage still owns everything ─────────────────────────────────────────────────────

test("deleteCandidate takes every swept row with it", { skip }, async () => {
  const { db, d1 } = open();
  await seedItem(d1, db, { itemKey: "immunisations", expiryDays: 5 });
  await sweepExpiryStates(d1);
  assert.equal(statusOf(db, "cand-1", "immunisations"), "expiring", "there is a swept row to take");

  await deleteCandidate(d1, "cand-1");
  assert.equal(
    db.prepare("SELECT count(*) AS n FROM compliance_item").get().n,
    0,
    "the sweep's writes did not escape the cage",
  );
});

// ── what the passport reads ────────────────────────────────────────────────────────────

test("after a sweep the passport's own read returns expiring", { skip }, async () => {
  const { db, d1 } = open();
  await seedItem(d1, db, { itemKey: "immunisations", expiryDays: 5 });
  await sweepExpiryStates(d1);

  // The one assertion that connects this ticket to the chip CSS shipped unrenderable in #68:
  // public/prep/prep.css's .mark-expiring and passport.js's COPY.chip both key off this word.
  const rows = await itemsByCandidate(d1, "cand-1");
  const item = rows.find((row) => row.item_key === "immunisations");
  assert.equal(item.status, "expiring");
  assert.equal(item.reference, "REF-immunisations", "and the sweep touched nothing else");
  assert.equal(item.checked_at !== null, true, "checked_at still says when a PERSON last touched it");
});

test("the sweep does not stamp checked_at", { skip }, async () => {
  const { db, d1 } = open();
  await seedItem(d1, db, { itemKey: "immunisations", expiryDays: 5 });
  const before = db
    .prepare("SELECT checked_at FROM compliance_item WHERE candidate_id = 'cand-1' AND item_key = 'immunisations'")
    .get().checked_at;

  await sweepExpiryStates(d1);
  const after = db
    .prepare("SELECT checked_at FROM compliance_item WHERE candidate_id = 'cand-1' AND item_key = 'immunisations'")
    .get().checked_at;

  // That column means "when did a PERSON last touch this" — #71's dashboard wants it. Stamping
  // it with the moment a sweep read a date would destroy the one fact it is for.
  assert.equal(after, before);
});
