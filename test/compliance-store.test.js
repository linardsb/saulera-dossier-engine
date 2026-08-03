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
import { ITEM_KEYS, ITEM_STATUSES } from "../src/compliance/catalogue.js";
import {
  ASSIGNMENT_STATUSES,
  createAssignment,
  createCandidate,
  deleteCandidate,
  itemsByCandidate,
  purgeDormant,
  setItemState,
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
