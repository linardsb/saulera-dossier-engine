// #67 — the compliance store's SQL shapes, against the recording fake.
//
// The class of failure this file catches: the retention machinery quietly changing shape. The
// purge deleting from a child table would mask a broken cascade; the retention number drifting
// from 12 months would change what "we delete a dormant candidate's compliance record" means
// without anyone deciding it; a `status` bound into the seed INSERT would move the decision
// about what an untouched checklist looks like out of the DDL and into a loop. Real deletion
// behaviour — the cascade, the boundary, the CHECKs — is proven against real SQLite in
// test/compliance-purge.test.js; this file proves the statements themselves.

import { test } from "node:test";
import assert from "node:assert/strict";

import { fakeD1 } from "./helpers/fake-d1.js";
import { StoreError } from "../src/store.js";
import {
  COMPLIANCE_CATALOGUE,
  EXPIRY_STATES,
  ITEM_KEYS,
  ITEM_STATUSES,
  MAX_AMBER_DAYS,
} from "../src/compliance/catalogue.js";
import {
  ASSIGNMENT_STATUSES,
  candidateByEmail,
  candidateBySessionHash,
  claimExtensionNudge,
  claimItemExpiry,
  consumeCandidateOtp,
  createAssignment,
  createCandidate,
  deleteCandidate,
  dueExpiryItems,
  dueExtensionNudges,
  issueCandidateOtp,
  itemsByCandidate,
  listAssignments,
  candidateEmailById,
  listComplianceState,
  purgeDormant,
  rejectItem,
  rotateCandidateSession,
  setItemState,
  updateAssignment,
  verifyItem,
} from "../src/compliance/store.js";

/** The error code a call throws, or the string "did not throw". */
async function codeOf(fn) {
  try {
    await fn();
    return "did not throw";
  } catch (err) {
    assert.ok(err instanceof StoreError, `expected a StoreError, got ${err}`);
    return err.code;
  }
}

// ── the purge statement, which is the retention promise ────────────────────────────────

test("purgeDormant deletes from candidate alone — the cascade does the rest", async () => {
  const db = fakeD1([null]);
  await purgeDormant(db);

  assert.equal(db.calls.length, 1, "the purge is exactly one statement");
  const sql = db.calls[0].sql;
  assert.match(sql, /^DELETE FROM candidate\b/i, "the purge targets the cage root and only the root");

  // Naming a child table here would delete rows the cascade already takes — and would keep
  // the suite green while the cascade itself was broken. schema.test.js proves the chain;
  // this proves the purge leans on it.
  for (const other of ["compliance_item", "invite", "candidate_role", "otp", "clients", "events", "agency"]) {
    assert.ok(!sql.includes(other), `the purge must not name ${other}: the cascade owns the children`);
  }

  // `assignment` is the one table it may name, and must: it is the dormancy CLOCK, read in a
  // NOT EXISTS to ask whether this candidate has a booking that is still live. It is not a
  // child being swept — the cascade takes assignment rows either way.
  assert.match(
    sql,
    /NOT\s+EXISTS[\s\S]*FROM\s+assignment/i,
    "dormancy is 'no live assignment', so the statement has to look at assignment to know",
  );
});

test("the retention number is 12 months, compared through datetime(), and binds nothing", async () => {
  const db = fakeD1([null]);
  await purgeDormant(db);

  const call = db.calls[0];
  // The load-bearing number, twice over — the created_at clock for a never-booked candidate
  // and the end_date clock for a lapsed one. A drive-by change to 24 months is a change to
  // the privacy notice and to spike #66's retention decision, and it must fail a test first.
  assert.equal(
    (call.sql.match(/'\+12 months'/g) ?? []).length,
    2,
    "both dormancy clocks are 12 months: creation for a candidate who never had a booking, " +
      "and the last end_date for one who did",
  );
  assert.match(call.sql, /datetime\(/, "dates compare through datetime(), which also reads ISO-8601 forms");
  assert.equal(call.args.length, 0, "the purge boundary is the schema's clock — no caller value can move it");
});

test("purgeDormant reports the count from meta.changes", async () => {
  assert.deepEqual(await purgeDormant(fakeD1([null])), { purged: 1 }); // fake-d1 run() reports changes: 1
});

// ── the seed: one candidate, one checklist, from the catalogue ─────────────────────────

test("createCandidate writes the candidate then one row per catalogue item", async () => {
  const db = fakeD1([]);
  const result = await createCandidate(db, {
    id: "cand-1",
    fullName: "Priya Raman",
    email: "priya@example.com",
  });

  assert.deepEqual(result, { ok: true, items: ITEM_KEYS.length });
  assert.equal(db.calls.length, 1 + ITEM_KEYS.length, "the candidate row, then the whole checklist");

  assert.match(db.calls[0].sql, /^INSERT INTO candidate \(id, full_name, email, phone\)/i);
  assert.deepEqual(
    db.calls[0].args,
    ["cand-1", "Priya Raman", "priya@example.com", ""],
    "an absent phone is the empty string the column defaults to, never undefined reaching a bind",
  );
  assert.ok(
    !db.calls[0].sql.includes("created_at"),
    "created_at is the dormancy clock: the DDL default is its only source, because a " +
      "caller-supplied creation date is a caller-supplied retention date",
  );

  const seeded = db.calls.slice(1);
  for (const call of seeded) {
    assert.match(call.sql, /^INSERT INTO compliance_item \(candidate_id, item_key\) VALUES \(\?, \?\)$/i);
    assert.equal(call.args[0], "cand-1", "every checklist row is bound to the candidate it belongs to");
    assert.ok(ITEM_KEYS.includes(call.args[1]), `${call.args[1]} is not a catalogue key`);
    // Two columns and no third. Binding `status` here would move the decision about what an
    // untouched item looks like out of the DDL and into this loop, where it could disagree.
    assert.ok(!/status|reference|expiry_date|checked_at/i.test(call.sql), "the DDL defaults own the rest");
  }
  assert.deepEqual(
    seeded.map((c) => c.args[1]),
    ITEM_KEYS,
    "the whole catalogue is seeded, in catalogue order — a partial checklist would read as " +
      "items nobody has to do",
  );
});

// ── the closed vocabularies, checked before the SQL ────────────────────────────────────

test("setItemState rejects an unknown item_key and an unknown status with the store's 400", async () => {
  const db = fakeD1([]);

  assert.equal(
    await codeOf(() => setItemState(db, { candidateId: "cand-1", itemKey: "passport_photo", status: "verified" })),
    "missing_fields",
    "item_key carries no CHECK — the catalogue is the vocabulary, and the store is where it bites",
  );
  assert.equal(
    await codeOf(() => setItemState(db, { candidateId: "cand-1", itemKey: ITEM_KEYS[0], status: "chased" })),
    "missing_fields",
    "a sixth status is a schema change to make in the open, not a value a route can pass through",
  );
  assert.equal(
    db.calls.length,
    0,
    "both answers arrive BEFORE the SQL: a predictable bad input must not reach a caller as a " +
      "raw ERR_SQLITE_ERROR from a CHECK",
  );

  // Every state the column admits is accepted here, so the store's list and the DDL's cannot
  // drift in the direction that locks a legitimate write out.
  for (const status of ITEM_STATUSES) {
    assert.equal(
      await codeOf(() => setItemState(fakeD1([]), { candidateId: "cand-1", itemKey: ITEM_KEYS[0], status })),
      "did not throw",
      `${status} is one of the five the schema admits`,
    );
  }
});

test("setItemState updates exactly the four columns and stamps checked_at from SQLite's clock", async () => {
  const db = fakeD1([]);
  const result = await setItemState(db, {
    candidateId: "cand-1",
    itemKey: "hcpc_registration",
    status: "verified",
    reference: "RA12345",
    expiryDate: "2027-04-30",
  });

  assert.equal(db.calls.length, 1, "one statement");
  const call = db.calls[0];
  assert.match(call.sql, /^UPDATE compliance_item\b/i);
  assert.match(
    call.sql,
    /checked_at = datetime\('now'\)/i,
    "when an item was last looked at is a fact about the write — a bound timestamp would be a " +
      "caller-supplied audit trail",
  );
  assert.deepEqual(
    call.args,
    ["verified", "RA12345", "2027-04-30", "cand-1", "hcpc_registration"],
    "every caller value travels as a bound parameter, in the order the statement names them",
  );
  assert.deepEqual(result, { updated: true }); // fake-d1 run() reports changes: 1

  // An absent reference and an absent expiry are the column's own empty and NULL, never
  // undefined: the CHECK on expiry_date reads NULL as "no expiry", and undefined is a
  // different bug with the same symptom.
  const bare = fakeD1([]);
  await setItemState(bare, { candidateId: "cand-1", itemKey: "references", status: "submitted" });
  assert.deepEqual(bare.calls[0].args, ["submitted", "", null, "cand-1", "references"]);
});

test("createAssignment defaults to booked, binds an open booking as NULL, and refuses a fifth state", async () => {
  const db = fakeD1([]);
  await createAssignment(db, {
    id: "asg-1",
    candidateId: "cand-1",
    clientId: "c-1",
    startDate: "2026-09-01",
  });

  assert.match(db.calls[0].sql, /^INSERT INTO assignment \(id, candidate_id, client_id, start_date, end_date, status\)/i);
  assert.deepEqual(
    db.calls[0].args,
    ["asg-1", "cand-1", "c-1", "2026-09-01", null, "booked"],
    "an open booking's end_date is NULL — the one immortality the dormancy purge grants — and " +
      "'booked' is duplicated from the DDL here because the INSERT names the column",
  );

  for (const status of ASSIGNMENT_STATUSES) {
    assert.equal(
      await codeOf(() =>
        createAssignment(fakeD1([]), { id: "a", candidateId: "c", clientId: "c-1", startDate: "2026-09-01", status }),
      ),
      "did not throw",
      `${status} is one of the four the schema admits`,
    );
  }
  const rejecting = fakeD1([]);
  assert.equal(
    await codeOf(() =>
      createAssignment(rejecting, {
        id: "a",
        candidateId: "c",
        clientId: "c-1",
        startDate: "2026-09-01",
        status: "extended",
      }),
    ),
    "missing_fields",
    "#69 may want an 'extended' state; it arrives as a migration and a lock change, not as a bind",
  );
  assert.equal(rejecting.calls.length, 0, "checked before the SQL");
});

// ── delete-now, which must be idempotent, and the read, which must stay narrow ──────────

test("deleteCandidate binds the id and answers ok regardless of matched rows", async () => {
  const db = fakeD1([null]);
  const result = await deleteCandidate(db, "cand-1");

  // {ok: true} even though the fake reports changes — and the same shape at changes 0: a
  // candidate who pressed delete twice is already in the clean state the button promises.
  // The count rides alongside so a recruiter surface knows whether it took a real cage;
  // whether it reads 0 correctly is provable only against real SQL, in compliance-purge.
  assert.deepEqual(result, { ok: true, deleted: 1 }); // fake-d1 run() reports changes: 1
  assert.equal(db.calls.length, 1, "delete-now is exactly one statement");
  assert.match(db.calls[0].sql, /^DELETE FROM candidate WHERE id = \?$/i);
  assert.deepEqual(db.calls[0].args, ["cand-1"], "the id travels as a bound parameter");
});

test("itemsByCandidate names its columns and never selects *", async () => {
  const db = fakeD1([[{ item_key: "references", status: "missing" }]]);
  const rows = await itemsByCandidate(db, "cand-1");

  assert.deepEqual(rows, [{ item_key: "references", status: "missing" }]);
  const sql = db.calls[0].sql;
  assert.ok(!sql.includes("*"), "briefJsonByInviteId's discipline: a column added later reaches a screen only when someone names it");
  assert.match(sql, /SELECT item_key, status, reference, expiry_date, checked_at\b/i);
  assert.match(sql, /ORDER BY item_key/i, "a stable read; display order is the caller's from the catalogue");
  assert.deepEqual(db.calls[0].args, ["cand-1"]);
});

// ── the store's own 400, before anything reaches SQL ───────────────────────────────────

test("missing required fields are the store's own 400, and nothing is written", async () => {
  const cases = [
    ["createCandidate", (db) => createCandidate(db)],
    ["createCandidate without an email", (db) => createCandidate(db, { id: "c", fullName: "Priya Raman" })],
    ["createAssignment", (db) => createAssignment(db)],
    ["createAssignment without a start date", (db) => createAssignment(db, { id: "a", candidateId: "c", clientId: "c-1" })],
    ["setItemState", (db) => setItemState(db)],
    ["setItemState with a blank status", (db) => setItemState(db, { candidateId: "c", itemKey: ITEM_KEYS[0], status: "  " })],
  ];

  for (const [name, call] of cases) {
    const db = fakeD1([]);
    assert.equal(await codeOf(() => call(db)), "missing_fields", `${name} must be the store's 400`);
    assert.equal(db.calls.length, 0, `${name} must not reach the database`);
  }
});

// ── the cage's own door, as SQL shapes (#68) ───────────────────────────────────────────
//
// These five duplicate src/portal/store.js's OTP and session statements at a new root, and the
// duplication is deliberate (a table name cannot be a bound parameter — the reason is written
// at the top of src/compliance/store.js). Duplicated SQL needs duplicated assertions: nothing
// test/portal-store.test.js proves reaches these functions, and the pointer comment between the
// two files is a note to a reader, not a test.

test("candidateByEmail binds the address and does not filter on expiry", async () => {
  const db = fakeD1([{ id: "cand-1", email: "priya@example.com" }]);
  await candidateByEmail(db, "PRIYA@example.com");

  const sql = db.calls[0].sql;
  assert.match(sql, /lower\(email\) = lower\(\?\)/i, "a retyped address is the same person");
  assert.ok(!sql.includes("PRIYA"), "the address travels as a bound parameter, never in the SQL");
  assert.deepEqual(db.calls[0].args, ["PRIYA@example.com"]);
  assert.match(sql, /SELECT id, email\b/i, "two columns and no third — a name here is a name in a log line");
  // The whole difference from inviteByEmail. An invite dies and a stale one must not be a door;
  // a compliance record is durable, and only the dormancy purge removes it.
  assert.ok(!/expires_at|created_at.*<=|datetime\('now'\)/i.test(sql), "no expiry filter belongs here");
  assert.match(sql, /ORDER BY created_at DESC LIMIT 1/i, "a duplicate is a re-registration; the newest is meant");
});

test("issueCandidateOtp deletes before it inserts, and binds the TTL rather than templating it", async () => {
  const db = fakeD1([null, null, null]);
  const result = await issueCandidateOtp(db, {
    candidateId: "cand-1",
    codeHash: "h",
    ttlMinutes: 10,
    cooldownMinutes: 1,
  });

  assert.deepEqual(result, { ok: true, issued: true });
  assert.equal(db.calls.length, 3, "the freshness read, the DELETE, then the INSERT");

  // The cooldown read: "minted within the cooldown" is derived from expires_at, so there is no
  // second column to keep in step. The bound integer is TTL − cooldown.
  assert.match(db.calls[0].sql, /FROM candidate_otp[\s\S]*datetime\(expires_at, '-' \|\| \? \|\| ' minutes'\)/i);
  assert.deepEqual(db.calls[0].args, ["cand-1", 9]);

  // THE RATE LIMIT: requesting a code invalidates the old one, so a candidate mashing the
  // button ends with one usable code rather than forty.
  assert.match(db.calls[1].sql, /^DELETE FROM candidate_otp WHERE candidate_id = \?$/i);
  assert.deepEqual(db.calls[1].args, ["cand-1"]);

  assert.match(db.calls[2].sql, /INSERT INTO candidate_otp \(candidate_id, code_hash, expires_at\)/i);
  // The modifier is assembled by SQLite from a bound value. The number is ours, not a caller's,
  // and it stays outside the SQL text all the same.
  assert.match(db.calls[2].sql, /datetime\('now', '\+' \|\| \? \|\| ' minutes'\)/i);
  assert.deepEqual(db.calls[2].args, ["cand-1", "h", 10]);
  assert.ok(!db.calls[2].sql.includes("attempts"), "the counter opens at the DDL's own default");
});

test("issueCandidateOtp leaves a fresh code standing and writes nothing", async () => {
  const db = fakeD1([{ fresh: 1 }]);
  assert.deepEqual(
    await issueCandidateOtp(db, { candidateId: "cand-1", codeHash: "h", ttlMinutes: 10, cooldownMinutes: 1 }),
    { ok: true, issued: false },
  );
  assert.equal(db.calls.length, 1, "the row it leaves alone is the code the candidate is typing");
});

test("consumeCandidateOtp reads the newest row and never selects the hash into a wider shape", async () => {
  const db = fakeD1([{ id: 7, code_hash: "h", attempts: 0, live: 1 }, null]);
  assert.deepEqual(await consumeCandidateOtp(db, { candidateId: "cand-1", codeHash: "h", maxAttempts: 5 }), {
    ok: true,
  });

  assert.match(db.calls[0].sql, /SELECT id, code_hash, attempts, datetime\('now'\) <= datetime\(expires_at\) AS live/i);
  assert.match(db.calls[0].sql, /ORDER BY id DESC LIMIT 1/i);
  assert.deepEqual(db.calls[0].args, ["cand-1"]);
  // Single-use is the DELETE and never a `used` flag: a flag can be checked in the wrong order
  // and a missing row cannot.
  assert.match(db.calls[1].sql, /^DELETE FROM candidate_otp WHERE id = \?$/i);
  assert.deepEqual(db.calls[1].args, [7]);
});

test("consumeCandidateOtp increments on a mismatch and deletes at the cap", async () => {
  const wrong = fakeD1([{ id: 7, code_hash: "h", attempts: 2, live: 1 }, null]);
  assert.deepEqual(await consumeCandidateOtp(wrong, { candidateId: "cand-1", codeHash: "other", maxAttempts: 5 }), {
    ok: false,
    reason: "invalid_code",
  });
  assert.match(wrong.calls[1].sql, /UPDATE candidate_otp SET attempts = attempts \+ 1 WHERE id = \?/i);

  const capped = fakeD1([{ id: 7, code_hash: "h", attempts: 5, live: 1 }, null]);
  assert.deepEqual(await consumeCandidateOtp(capped, { candidateId: "cand-1", codeHash: "h", maxAttempts: 5 }), {
    ok: false,
    reason: "too_many_attempts",
  });
  // The cap is checked BEFORE the comparison, so the sixth call refuses without comparing
  // anything — and the row goes rather than merely being refused.
  assert.match(capped.calls[1].sql, /^DELETE FROM candidate_otp WHERE id = \?$/i);

  // No row at all: the same answer an expired one gets, and no second statement.
  const none = fakeD1([null]);
  assert.deepEqual(await consumeCandidateOtp(none, { candidateId: "cand-1", codeHash: "h", maxAttempts: 5 }), {
    ok: false,
    reason: "expired",
  });
  assert.equal(none.calls.length, 1);
});

test("rotateCandidateSession writes both columns in one statement and guards on nothing else", async () => {
  const db = fakeD1([null]);
  assert.deepEqual(
    await rotateCandidateSession(db, { candidateId: "cand-1", newHash: "h", expiresAt: "2026-08-17 09:15:30" }),
    { rotated: true }, // fake-d1 run() reports changes: 1
  );

  assert.equal(db.calls.length, 1, "a hash without an expiry is a session that never ends");
  assert.match(db.calls[0].sql, /^UPDATE candidate SET session_hash = \?, session_expires_at = \? WHERE id = \?$/i);
  assert.deepEqual(db.calls[0].args, ["h", "2026-08-17 09:15:30", "cand-1"]);
  // Where this parts company with rotateSession: the portal guards on the invite's own
  // lifetime, and `candidate` has none — the column being written IS the session's whole clock.
  assert.ok(!/expires_at\)/i.test(db.calls[0].sql.replace(/session_expires_at/g, "")), "no lifetime guard to add");
});

test("candidateBySessionHash returns two columns, never the hash, and never filters expiry", async () => {
  const db = fakeD1([{ id: "cand-1", session_expires_at: "2026-08-17 09:15:30" }]);
  await candidateBySessionHash(db, "abc123");

  const sql = db.calls[0].sql;
  assert.match(sql, /^SELECT id, session_expires_at FROM candidate WHERE session_hash = \?$/i);
  assert.ok(!/SELECT[^F]*session_hash/i.test(sql), "a hash that is never read cannot reach a log line");
  assert.ok(!sql.includes("*"), "named columns, so a column added later reaches a screen only when someone names it");
  assert.deepEqual(db.calls[0].args, ["abc123"]);
});

test("the door's own 400s fire before any SQL runs", async () => {
  const cases = [
    ["issueCandidateOtp without a hash", (db) => issueCandidateOtp(db, { candidateId: "c", ttlMinutes: 10 })],
    ["issueCandidateOtp with a zero TTL", (db) => issueCandidateOtp(db, { candidateId: "c", codeHash: "h", ttlMinutes: 0 })],
    [
      "issueCandidateOtp with a cooldown at or past the TTL",
      (db) => issueCandidateOtp(db, { candidateId: "c", codeHash: "h", ttlMinutes: 10, cooldownMinutes: 10 }),
    ],
    ["consumeCandidateOtp without a cap", (db) => consumeCandidateOtp(db, { candidateId: "c", codeHash: "h" })],
    ["rotateCandidateSession without an expiry", (db) => rotateCandidateSession(db, { candidateId: "c", newHash: "h" })],
  ];

  for (const [name, call] of cases) {
    const db = fakeD1([]);
    assert.equal(await codeOf(() => call(db)), "missing_fields", `${name} must be the store's 400`);
    assert.equal(db.calls.length, 0, `${name} must not reach the database`);
  }
});

// ── the extension radar's four statements (#69) ────────────────────────────────────────
//
// STATEMENT SHAPE ONLY. The fake runs no SQL, so a `>` where the rule means `>=` is invisible
// here — test/extension-radar.test.js owns the arithmetic, against real SQLite. The split is
// deliberate: this file proves what was BUILT, that one proves what it DOES.

test("dueExtensionNudges binds the lead time and interpolates nothing", async () => {
  const db = fakeD1([[]]);
  await dueExtensionNudges(db, 14);

  assert.equal(db.calls.length, 1, "the radar's whole predicate is one statement");
  const sql = db.calls[0].sql;
  // The modifier is assembled by SQLite from a BOUND value — issueCandidateOtp's idiom — so the
  // number stays outside the statement text even though it is ours and not a caller's.
  assert.match(sql, /date\('now', '\+' \|\| \? \|\| ' days'\)/, "the bound-modifier idiom, not a template");
  assert.ok(!sql.includes("14"), "the threshold is never written into the SQL");
  assert.deepEqual(db.calls[0].args, [14]);

  // The five clauses, each one a decision (read the function's comment for why).
  assert.match(sql, /a\.end_date IS NOT NULL/, "an open booking has no deadline to warn about");
  assert.match(sql, /a\.nudge_sent_at IS NULL/, "the claim column IS the idempotency");
  assert.match(sql, /a\.status IN \('booked', 'active'\)/, "the deliberate inversion of purgeDormant's date-only rule");
  assert.match(sql, /date\(a\.end_date\) >= date\('now'\)/, "a booking that already ended is a different message");
  assert.ok(!/datetime\(a\.end_date\)/.test(sql), "day granularity, not instants");
});

test("dueExtensionNudges refuses a non-integer lead time BEFORE any SQL runs", async () => {
  for (const bad of [0, -1, 14.5, "14", null, undefined]) {
    const db = fakeD1([]);
    assert.equal(await codeOf(() => dueExtensionNudges(db, bad)), "missing_fields", `leadDays ${bad}`);
    assert.equal(db.calls.length, 0, "the guard is what makes the bound modifier readable, so it runs first");
  }
});

test("the radar's projection names its columns and carries no email", async () => {
  for (const [name, call] of [
    ["dueExtensionNudges", (db) => dueExtensionNudges(db, 14)],
    ["listAssignments", (db) => listAssignments(db)],
  ]) {
    const db = fakeD1([[]]);
    await call(db);
    const sql = db.calls[0].sql;
    // The PROJECTION alone. `candidate_id` is legitimately in the JOIN condition — it is what
    // makes the name reachable — and asserting over the whole statement would forbid the join
    // rather than the leak.
    const projection = sql.slice(0, sql.search(/\bFROM\b/));
    assert.ok(!projection.includes("*"), `${name}: named columns, never SELECT *`);
    assert.doesNotMatch(projection, /\bemail\b/, `${name}: the booking screens need no address`);
    assert.doesNotMatch(projection, /candidate_id/, `${name}: the name is joined, the id is not returned`);
    assert.doesNotMatch(sql, /compliance_item/, `${name}: #71's dashboard owns the checklist column`);
  }
});

test("claimExtensionNudge is claimReminder's move: one winner, no read-then-write window", async () => {
  const db = fakeD1([]);
  assert.equal(await claimExtensionNudge(db, "asg-1"), true); // fake-d1 run() reports changes: 1

  assert.equal(db.calls.length, 1);
  assert.match(
    db.calls[0].sql,
    /^UPDATE assignment SET nudge_sent_at = datetime\('now'\)\s+WHERE id = \? AND nudge_sent_at IS NULL$/i,
  );
  assert.deepEqual(db.calls[0].args, ["asg-1"]);

  // An undefined bind is a D1 error; the empty string matches nothing, which is fail-closed.
  const absent = fakeD1([]);
  await claimExtensionNudge(absent, undefined);
  assert.deepEqual(absent.calls[0].args, [""]);
});

test("listAssignments sorts resolved last, open below dated, soonest first", async () => {
  const db = fakeD1([[]]);
  await listAssignments(db);

  const sql = db.calls[0].sql;
  assert.match(sql, /CASE WHEN a\.status IN \('ended', 'cancelled'\) THEN 1 ELSE 0 END/, "resolved sinks");
  // 0 (false, i.e. HAS a date) sorts first in SQLite. Do not "fix" this to IS NOT NULL.
  assert.match(sql, /a\.end_date IS NULL,/, "open sits below dated");
  assert.match(sql, /date\(a\.end_date\),/, "then soonest first");
  assert.deepEqual(db.calls[0].args, [], "the whole list, so nothing to bind");
});

test("updateAssignment builds its SET clause from a FIXED allow-list, never a caller's keys", async () => {
  const db = fakeD1([]);
  await updateAssignment(db, "asg-1", { endDate: "2026-12-01", status: "active" });

  assert.equal(db.calls.length, 1, "D1 has no transaction; two statements would be a live half-state");
  const sql = db.calls[0].sql;
  assert.match(sql, /^UPDATE assignment SET end_date = \?, nudge_sent_at = NULL, status = \? WHERE id = \?$/i);
  assert.deepEqual(db.calls[0].args, ["2026-12-01", "active", "asg-1"]);

  // A caller-supplied key cannot reach the SQL string — the file's line-15 contract.
  const injected = fakeD1([]);
  await updateAssignment(injected, "asg-1", { "status = 'ended', id": "x", status: "ended" });
  assert.match(injected.calls[0].sql, /^UPDATE assignment SET status = \? WHERE id = \?$/i);
});

test("THE RE-ARM: a new end date clears the claim; a status change alone does not", async () => {
  // The one thing in #69 with no precedent in #25. invite.reminder_sent_at guards a deadline
  // that CANNOT move; nudge_sent_at guards one that EXISTS to move, and extending is the
  // successful outcome of the nudge. Without the clear the radar fires once per booking ever.
  const extend = fakeD1([]);
  await updateAssignment(extend, "asg-1", { endDate: "2026-12-01" });
  assert.match(extend.calls[0].sql, /nudge_sent_at = NULL/);
  // No placeholder for the clear, so the ?-to-bind parity this fake enforces still holds.
  assert.deepEqual(extend.calls[0].args, ["2026-12-01", "asg-1"]);

  const resolve = fakeD1([]);
  await updateAssignment(resolve, "asg-1", { status: "ended" });
  assert.doesNotMatch(resolve.calls[0].sql, /nudge_sent_at/, "resolving settles the nudge, it does not re-arm it");

  // Object.hasOwn and not truthiness: clearing the end date is a meaningful patch that reopens
  // the booking, and `if (patch.endDate)` would silently drop it.
  const clear = fakeD1([]);
  await updateAssignment(clear, "asg-1", { endDate: null });
  assert.deepEqual(clear.calls[0].args, [null, "asg-1"]);
});

test("updateAssignment's own 400s fire before any SQL runs", async () => {
  const cases = [
    ["an unknown status", (db) => updateAssignment(db, "asg-1", { status: "extended" })],
    ["a status the CHECK admits nowhere", (db) => updateAssignment(db, "asg-1", { status: "redeployed" })],
    ["an empty patch", (db) => updateAssignment(db, "asg-1", {})],
    ["a missing id", (db) => updateAssignment(db, "", { status: "ended" })],
  ];

  for (const [name, call] of cases) {
    const db = fakeD1([]);
    assert.equal(await codeOf(() => call(db)), "missing_fields", `${name} must be the store's 400`);
    assert.equal(db.calls.length, 0, `${name} must not reach the database`);
  }

  // And the vocabulary it checks against is the exported one, not a second list.
  assert.deepEqual(ASSIGNMENT_STATUSES, ["booked", "active", "ended", "cancelled"]);
});

// ── the expiry radar's two statements (#70) ────────────────────────────────────────────
//
// STATEMENT SHAPE ONLY, and here the split matters more than anywhere: `run()` returns
// `changes: 1` unconditionally, so the compare-and-swap's LOSER cannot be seen in this file at
// all. test/expiry-radar.test.js owns that against real SQLite. What this file proves is what
// was BUILT — what is bound, what is projected, and what is refused before any SQL runs.

test("dueExpiryItems binds the widest window and interpolates nothing", async () => {
  const db = fakeD1([[]]);
  await dueExpiryItems(db, MAX_AMBER_DAYS);

  assert.equal(db.calls.length, 1, "the radar's whole predicate is one statement");
  const sql = db.calls[0].sql;
  // dueExtensionNudges' idiom: the modifier is assembled by SQLite from a BOUND value, so the
  // number stays outside the statement text even though it is ours and not a caller's.
  assert.match(sql, /date\('now', '\+' \|\| \? \|\| ' days'\)/, "the bound-modifier idiom, not a template");
  assert.deepEqual(db.calls[0].args, [MAX_AMBER_DAYS]);

  // No catalogue threshold is ever written into the SQL. A literal here is the failure
  // MAX_AMBER_DAYS exists to prevent, and it would fail SILENTLY.
  for (const threshold of new Set(COMPLIANCE_CATALOGUE.map((item) => item.amberDays).filter(Boolean))) {
    assert.ok(!sql.includes(String(threshold)), `the ${threshold}-day window is never a literal`);
  }

  // The clauses, each one a decision (read the function's comment for why).
  assert.match(sql, /i\.expiry_date IS NOT NULL/, "an item with no date has no deadline");
  assert.match(
    sql,
    /i\.status IN \('submitted', 'verified', 'expiring'\)/,
    "the three states a crossing can start from; expired is terminal",
  );
  assert.match(sql, /date\(i\.expiry_date\) <= date\('now'/, "inclusive at the far edge");
  assert.ok(!/datetime\(i\.expiry_date\)/.test(sql), "day granularity, not instants");
});

test("dueExpiryItems computes days_left in SQL — one clock, not two", async () => {
  const db = fakeD1([[]]);
  await dueExpiryItems(db, MAX_AMBER_DAYS);
  const sql = db.calls[0].sql;

  // THE POINT OF THE QUERY. Doing this arithmetic in JavaScript would compare SQLite's clock
  // (the WHERE) against V8's (the decision) — the ±1-day flip near midnight UTC that
  // test/extension-radar.test.js's header calls worse than no test.
  assert.match(sql, /julianday\(date\(i\.expiry_date\)\) - julianday\(date\('now'\)\)/);
  assert.match(sql, /AS days_left/, "and the caller reads an integer rather than computing one");

  // Named columns, never SELECT *. This projection deliberately DOES carry the name and the
  // address — the digest names who to chase and the nudge has to reach them — which is why it is
  // asserted here rather than added to the booking screens' no-email loop above.
  const projection = sql.slice(0, sql.search(/\bFROM\b/));
  assert.ok(!projection.includes("*"), "named columns, never SELECT *");
  assert.match(projection, /candidate\.full_name AS candidate_name/);
  assert.match(projection, /candidate\.email\s+AS candidate_email/);
  assert.ok(!/reference/.test(projection), "the sweep has no use for what the candidate typed");
});

test("dueExpiryItems refuses a non-integer window BEFORE any SQL runs", async () => {
  for (const bad of [0, -1, 30.5, "30", null, undefined]) {
    const db = fakeD1([]);
    assert.equal(await codeOf(() => dueExpiryItems(db, bad)), "missing_fields", `maxAmberDays ${bad}`);
    assert.equal(db.calls.length, 0, "the guard is what makes the bound modifier readable, so it runs first");
  }
});

test("claimItemExpiry's WHERE carries BOTH observed values — the tidy-up this forbids", async () => {
  const db = fakeD1([]);
  const won = await claimItemExpiry(db, {
    id: 5,
    from: "submitted",
    to: "expiring",
    expiryDate: "2026-09-01",
  });
  assert.equal(won, true); // fake-d1 run() reports changes: 1

  assert.equal(db.calls.length, 1, "one statement: the claim IS the state change");
  const sql = db.calls[0].sql;
  assert.deepEqual(db.calls[0].args, ["expiring", 5, "submitted", "2026-09-01"]);

  const where = sql.slice(sql.indexOf("WHERE"));
  assert.match(where, /status = \?/, "the observed status");
  // THE ONE THAT MUST NOT BE DROPPED AS REDUNDANT. item.js always writes `submitted`, so the
  // ordinary renewal is submitted → submitted with a NEW date, and a status-only guard matches
  // it — stamping `expiring` over a date two years out, stickily. test/expiry-radar.test.js
  // proves the failure; this asserts the mechanism is still in the statement.
  assert.match(where, /expiry_date = \?/, "and the observed date, which is the load-bearing half");
  assert.ok(!where.includes("IN ("), "never broadened to a status list — that is the same bug, wider");

  // The SET clause names `status` and nothing else. `expiry_date` appears in the WHERE, so this
  // must match on the SET clause rather than on the whole statement.
  const set = sql.slice(sql.indexOf("SET"), sql.indexOf("WHERE"));
  assert.match(set, /SET status = \?/);
  // checked_at means "when did a PERSON last touch this". Overwriting it with the moment a sweep
  // read a date would destroy the one fact #71's dashboard wants.
  assert.ok(!set.includes("checked_at"), "the sweep is not a person and does not stamp one");
  assert.ok(!set.includes("reference"), "nor does it touch what the candidate typed");
});

test("claimItemExpiry's own 400s all fire before any SQL runs", async () => {
  const good = { id: 5, from: "submitted", to: "expiring", expiryDate: "2026-09-01" };
  const cases = [
    // A sweep that could write `verified` would let a clock mark a document as checked.
    ["a state only a person may write", { ...good, to: "verified" }],
    ["a state that is not a crossing", { ...good, to: "missing" }],
    ["a state the sweep never writes", { ...good, to: "submitted" }],
    ["a `from` outside the column's five", { ...good, from: "lapsed" }],
    ["a blank expiry date", { ...good, expiryDate: "" }],
    ["a missing expiry date", { ...good, expiryDate: undefined }],
    // An undefined bind is a D1 error, and a text id would silently match nothing.
    ["a text id", { ...good, id: "5" }],
    ["a float id", { ...good, id: 5.5 }],
    ["no arguments at all", {}],
  ];

  for (const [name, args] of cases) {
    const db = fakeD1([]);
    assert.equal(await codeOf(() => claimItemExpiry(db, args)), "missing_fields", `${name} must be the store's 400`);
    assert.equal(db.calls.length, 0, `${name} must not reach the database`);
  }

  // And the vocabulary it checks `to` against is the narrow exported one, not the column's five.
  assert.deepEqual(EXPIRY_STATES, ["expiring", "expired"]);
  for (const state of EXPIRY_STATES) {
    assert.ok(ITEM_STATUSES.includes(state), "a subset of the column's CHECK, never a sixth state");
  }
});

// ── the dashboard's four statements (#71) ──────────────────────────────────────────────
//
// STATEMENT SHAPE ONLY, and the split matters here exactly as it did for #70: `run()` returns
// `changes: 1` unconditionally, so the compare-and-swap's LOSER cannot be seen in this file at
// all. test/compliance-dashboard.test.js owns that against real SQLite. What this proves is what
// was BUILT — what is bound, what is projected, and what each write refuses to touch.

test("listComplianceState computes days_left in SQL — one clock, not two", async () => {
  const db = fakeD1([[]]);
  await listComplianceState(db);

  assert.equal(db.calls.length, 1, "the whole screen is one statement");
  const sql = db.calls[0].sql;
  assert.deepEqual(db.calls[0].args, [], "no caller value in this statement, so no bind");

  // dueExpiryItems' argument verbatim: the dashboard decides amber and red from this number at
  // render time and the sweep decides it from the same arithmetic. Computing one of them in V8
  // would put the two surfaces a day apart near midnight UTC.
  assert.match(sql, /julianday\(date\(i\.expiry_date\)\) - julianday\(date\('now'\)\)/);
  assert.match(sql, /AS days_left/);
  // The CASE makes the null EXPLICIT. Unlike dueExpiryItems this selects rows with no date at
  // all, and a reader has to be able to tell "there is no deadline" from "the arithmetic failed".
  assert.match(sql, /CASE WHEN i\.expiry_date IS NULL THEN NULL/);
  // No catalogue threshold is ever written into this statement: the per-item window is applied
  // by the route, from the catalogue, one item at a time.
  for (const threshold of new Set(COMPLIANCE_CATALOGUE.map((item) => item.amberDays).filter(Boolean))) {
    assert.ok(!sql.includes(String(threshold)), `the ${threshold}-day window is never a literal here`);
  }
});

test("listComplianceState projects candidate_id, and no address", async () => {
  // DELIBERATELY NOT ADDED TO THE PROJECTION LOOP ABOVE. That loop asserts
  // doesNotMatch(projection, /candidate_id/) for the booking screens, and this statement has to
  // violate it — so the assertion lives here, where the reason can sit beside it. #70's
  // dueExpiryItems is in this file for the same reason.
  const db = fakeD1([[]]);
  await listComplianceState(db);
  const sql = db.calls[0].sql;
  const projection = sql.slice(0, sql.search(/\bFROM\b/));

  assert.ok(!projection.includes("*"), "named columns, never SELECT *");
  // THE ADDRESS BOOK FOR A WRITE. The dashboard's PUT is /api/compliance/:candidateId, and a
  // screen that cannot name the row it is acting on cannot act.
  assert.match(projection, /candidate\.id AS candidate_id/);
  // And what it still refuses. The reject email's address is read by the write route through
  // candidateEmailById, one column at a time — this payload never carries one.
  assert.doesNotMatch(projection, /\bemail\b/, "the recruiter's screen needs no address");
  // It drives from `candidate` and LEFT JOINs the items: the promise is "every candidate the
  // agency has recorded", and an inner join would answer with every candidate who still has
  // rows — making a candidate vanish from the one screen whose job is that nobody is missed.
  assert.match(sql, /FROM candidate\s+LEFT JOIN compliance_item/);
  assert.match(sql, /ORDER BY candidate\.full_name, candidate\.id, i\.item_key/, "name, then the id tiebreak");
});

test("verifyItem is a compare-and-swap that touches NEITHER the reference NOR the date", async () => {
  const db = fakeD1([]);
  assert.deepEqual(await verifyItem(db, { candidateId: "cand-1", itemKey: "dbs_enhanced" }), { updated: true });

  assert.equal(db.calls.length, 1);
  const sql = db.calls[0].sql;
  assert.deepEqual(db.calls[0].args, ["cand-1", "dbs_enhanced"]);

  const set = sql.slice(sql.indexOf("SET"), sql.indexOf("WHERE"));
  // THE `setItemState` TRAP, asserted. That function writes `reference = ?` and `expiry_date = ?`
  // unconditionally, so a verify routed through it would arrive with "" and null and WIPE the
  // number and the date that made the document verifiable — dropping the row out of
  // dueExpiryItems permanently, by the one action whose whole point is diligence.
  assert.ok(!set.includes("reference"), "the number the recruiter just checked is left standing");
  assert.ok(!set.includes("expiry_date"), "and so is the date");
  assert.match(set, /status = 'verified'/, "the first and only write of `verified` in the product");
  // checked_at means "when did a PERSON last touch this". claimItemExpiry declines to stamp it
  // for exactly that reason; a verify is a person, so it does.
  assert.match(set, /checked_at = datetime\('now'\)/);

  const where = sql.slice(sql.indexOf("WHERE"));
  // THE GUARD, WHICH IS NOT A FILTER. It refuses an item nobody submitted, it closes the
  // re-nudge loop (dueExpiryItems selects `verified`, so verifying an item already at `expiring`
  // would let the next sweep re-amber it and send a SECOND email for the same date), and it
  // makes a double-click's second request a no-op rather than a re-stamped checked_at.
  assert.match(where, /AND status = 'submitted'/);
  assert.ok(!where.includes("IN ("), "never broadened to a status list — that is the re-nudge loop");
});

test("rejectItem clears the reference and the date, under the same guard", async () => {
  const db = fakeD1([]);
  assert.deepEqual(await rejectItem(db, { candidateId: "cand-1", itemKey: "dbs_enhanced" }), { updated: true });

  const sql = db.calls[0].sql;
  const set = sql.slice(sql.indexOf("SET"), sql.indexOf("WHERE"));
  assert.match(set, /status = 'missing'/);
  // A rejected item has no valid document behind it, so it has no deadline. Clearing the date
  // drops the row out of dueExpiryItems — otherwise a refused certificate would go on nudging
  // the candidate about a document the recruiter has just told them is not accepted.
  assert.match(set, /expiry_date = NULL/);
  assert.match(set, /reference = ''/, "and the number they typed for it goes with it");
  assert.match(set, /checked_at = datetime\('now'\)/, "a person did this too");
  assert.match(sql.slice(sql.indexOf("WHERE")), /AND status = 'submitted'/);
  // `NULL` and `''` are literal fragments with NO placeholder, so the ?-to-bind parity
  // test/helpers/fake-d1.js enforces still holds. Do not "tidy" them into bound values: the
  // columns are being CLEARED, not set to a caller's value.
  assert.deepEqual(db.calls[0].args, ["cand-1", "dbs_enhanced"]);
});

test("the two writes name their statuses as LITERALS, never interpolated from ITEM_STATUSES", async () => {
  // This file's rule (dueExtensionNudges, dueExpiryItems): a status list is not a bound value.
  // The inverse also has to hold — a status must never arrive as a bound one either, or the
  // narrow write becomes the wide one it was split off from.
  for (const call of [verifyItem, rejectItem]) {
    const db = fakeD1([]);
    await call(db, { candidateId: "cand-1", itemKey: "dbs_enhanced" });
    assert.ok(!db.calls[0].sql.includes("status = ?"), "the status is decided by the function, not by the caller");
    for (const value of db.calls[0].args) {
      assert.ok(!ITEM_STATUSES.includes(value), `${value} is a status and must not be bound here`);
    }
  }
});

test("verifyItem's and rejectItem's own 400s fire before any SQL runs", async () => {
  const cases = [
    ["an item_key outside the catalogue", { candidateId: "cand-1", itemKey: "passport_photo" }],
    ["a blank item_key", { candidateId: "cand-1", itemKey: "" }],
    ["a missing item_key", { candidateId: "cand-1" }],
    ["a blank candidate id", { candidateId: "", itemKey: "dbs_enhanced" }],
    ["a missing candidate id", { itemKey: "dbs_enhanced" }],
    ["no arguments at all", {}],
  ];

  for (const call of [verifyItem, rejectItem]) {
    for (const [name, args] of cases) {
      const db = fakeD1([]);
      assert.equal(await codeOf(() => call(db, args)), "missing_fields", `${name} must be the store's 400`);
      assert.equal(db.calls.length, 0, `${name} must not reach the database`);
    }
  }

  // And the vocabulary they check against is the exported one, not a second list.
  assert.deepEqual(ITEM_KEYS, COMPLIANCE_CATALOGUE.map((item) => item.key));
});

test("candidateEmailById takes ONE column and no second", async () => {
  const db = fakeD1([{ email: "priya@example.com" }]);
  assert.deepEqual(await candidateEmailById(db, "cand-1"), { email: "priya@example.com" });

  const sql = db.calls[0].sql;
  assert.equal(sql, "SELECT email FROM candidate WHERE id = ?");
  // candidateBySessionHash's "two columns and no third" at its narrowest. The rejection message
  // greets nobody by name — sendExpiryNudgeEmail greets nobody either — so a `full_name` here
  // would be a column selected in case someone needs it, on the path where an address is handed
  // to a third-party mail provider.
  assert.ok(!sql.includes("full_name"), "the message needs an address and nothing else");
  assert.deepEqual(db.calls[0].args, ["cand-1"]);

  // An undefined bind is a D1 error; the empty string matches nothing, which is fail-closed.
  const absent = fakeD1([null]);
  await candidateEmailById(absent, undefined);
  assert.deepEqual(absent.calls[0].args, [""]);
});
