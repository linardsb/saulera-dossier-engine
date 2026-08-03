// #67 — the compliance cage's data lifecycle, proven against real SQL rather than recorded
// strings.
//
// The class of failure this file catches: the cascade chain or the dormancy boundary being
// subtly wrong in ways no recorded-SQL assertion can see — a missing ON DELETE CASCADE that
// leaves a deleted candidate's DBS state behind, a `>` where the rule means `>=`, a CHECK that
// lets an unparseable date create an immortal row. It applies every migration in order, seeds
// candidates of mixed age with mixed bookings, and asserts row-for-row exactness.
//
// The seeds go through `createCandidate` and `createAssignment` — the same writers production
// uses (test/portal-purge.test.js's stated principle). The one thing they cannot express is a
// backdated `created_at`, and deliberately so: the DDL default is the dormancy clock's only
// source, so the fixture reaches past the writer with a plain UPDATE to age a row.
//
// Engine: `node:sqlite`, which this machine's default Node 20 does not have — every test skips
// there with the remedy in the message, and CI/dev runs under Node 24 prove the rest. The
// adapter, the shared `openMigrated` and the skip come from test/helpers/sqlite-d1.js, where
// the PRAGMA foreign_keys gotcha that makes them non-optional is written down.

import { test } from "node:test";
import assert from "node:assert/strict";

import { ITEM_KEYS } from "../src/compliance/catalogue.js";
import {
  createAssignment,
  createCandidate,
  deleteCandidate,
  itemsByCandidate,
  purgeDormant,
} from "../src/compliance/store.js";
import { d1Shape, openMigrated, skip } from "./helpers/sqlite-d1.js";

const COMPLIANCE_TABLES = ["candidate", "assignment", "compliance_item"];

// Which candidate a row belongs to. Fixture ids embed the letter ('cand-A', 'asg-A-0'), so
// cage membership is readable off the key exactly as invite scope is in portal-purge.
const SCOPE_KEY = {
  candidate: (r) => r.id,
  assignment: (r) => r.candidate_id,
  compliance_item: (r) => r.candidate_id,
};
const candidateOf = (row, table) => SCOPE_KEY[table](row).split("-")[1];

const rowsOf = (db, table) => db.prepare(`SELECT * FROM ${table} ORDER BY id`).all();
const countOf = (db, table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;

/**
 * A date SQLite itself computed, so month arithmetic in the fixture and month arithmetic in
 * the purge are the same arithmetic. JS `Date` math would land a day out across a leap year
 * and the exact-boundary case below would pass or fail for the wrong reason.
 */
const dateAt = (db, modifier) => db.prepare("SELECT datetime('now', ?) AS d").get(modifier).d;

/** The engine and portal rows the purge must never touch. */
function seedOtherRegimes(db) {
  db.exec("INSERT INTO events (client_id, duration_ms) VALUES ('c-1', 8200)");
  db.exec(
    `INSERT INTO invite (id, client_id, token_hash, email, interview_at, expires_at)
     VALUES ('inv-1', 'c-1', 'h-1', 'live@example.com', datetime('now', '+2 days'), datetime('now', '+16 days'))`,
  );
}

/**
 * One candidate with a full checklist and the bookings the case needs. `created` and each
 * assignment's `start`/`end` are SQLite date modifiers; `end: null` is an open booking.
 */
async function seedCandidate(db, d1, letter, { created, assignments = [] }) {
  const id = `cand-${letter}`;
  await createCandidate(d1, {
    id,
    fullName: `Candidate ${letter}`,
    email: `${letter.toLowerCase()}@example.com`,
    phone: "07700 900123",
  });
  db.prepare("UPDATE candidate SET created_at = datetime('now', ?) WHERE id = ?").run(created, id);

  for (const [n, { start, end, status }] of assignments.entries()) {
    await createAssignment(d1, {
      id: `asg-${letter}-${n}`,
      candidateId: id,
      clientId: "c-1",
      startDate: dateAt(db, start),
      endDate: end === null ? null : dateAt(db, end),
      status,
    });
  }
}

// ── the migration applies, and the third regime exists ─────────────────────────────────

test("0008 applies clean after 0001–0007 and the compliance cage's three tables exist", { skip }, () => {
  const db = openMigrated();

  const names = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((r) => r.name);
  assert.deepEqual(names, [
    "agency",
    "assignment",
    "attempt",
    "candidate",
    "candidate_role",
    "clients",
    "competency",
    "compliance_item",
    "events",
    "habit",
    "invite",
    "note_visibility",
    "otp",
    "question",
  ]);
});

test("createCandidate seeds the whole catalogue at the DDL's own defaults", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  const result = await createCandidate(d1, { id: "cand-A", fullName: "Priya Raman", email: "p@example.com" });

  assert.deepEqual(result, { ok: true, items: ITEM_KEYS.length });
  const items = await itemsByCandidate(d1, "cand-A");
  assert.deepEqual(
    items.map((i) => i.item_key),
    [...ITEM_KEYS].sort(),
    "every catalogue item gets a row — a checklist that starts short reads as items nobody has to do",
  );
  for (const item of items) {
    assert.deepEqual(
      { status: item.status, reference: item.reference, expiry_date: item.expiry_date, checked_at: item.checked_at },
      { status: "missing", reference: "", expiry_date: null, checked_at: null },
      `${item.item_key} opens at 'missing': nothing handed over is the honest starting state`,
    );
  }
});

// ── the dormancy rule, at the exact boundary ───────────────────────────────────────────

test("purgeDormant takes exactly the dormant cages, including the exact 12-month boundary, row-for-row", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  seedOtherRegimes(db);

  // A's booking still SAYS 'active' thirteen months after it ended. That stale status is the
  // whole reason the purge answers to dates: if retention read the status column, a
  // bookkeeping error would silently extend how long health-adjacent data is held.
  await seedCandidate(db, d1, "A", {
    created: "-400 days",
    assignments: [{ start: "-16 months", end: "-13 months", status: "active" }],
  });
  // D is the boundary: end_date + 12 months is NOW, and `> datetime('now')` is false there —
  // purgeExpired's `<=` restated from the other side.
  await seedCandidate(db, d1, "D", {
    created: "-400 days",
    assignments: [{ start: "-15 months", end: "-12 months", status: "ended" }],
  });
  await seedCandidate(db, d1, "B", {
    created: "-400 days",
    assignments: [{ start: "-5 months", end: "-2 months", status: "ended" }],
  });
  // C's booking has no end. An open booking is a live one, at any age of candidate.
  await seedCandidate(db, d1, "C", {
    created: "-400 days",
    assignments: [{ start: "-14 months", end: null, status: "active" }],
  });
  // E never gained a booking at all. The spike is silent on this case; leaving them immortal
  // would be the wrong default for a cage whose claim is that it empties itself.
  await seedCandidate(db, d1, "E", { created: "-13 months" });
  await seedCandidate(db, d1, "F", { created: "-2 months" });

  const before = Object.fromEntries(COMPLIANCE_TABLES.map((t) => [t, rowsOf(db, t)]));

  const { purged } = await purgeDormant(d1);
  assert.equal(purged, 3, "A (lapsed 13 months), D (the exact 12-month boundary) and E (never booked) go");

  for (const table of COMPLIANCE_TABLES) {
    const survivors = before[table].filter((row) => ["B", "C", "F"].includes(candidateOf(row, table)));
    assert.deepEqual(
      rowsOf(db, table),
      survivors,
      `${table}: the live cages survive byte-identical, the dormant ones vanish entirely — ` +
        `including their checklists, which the cascade takes`,
    );
  }

  // Neither of the other two regimes is the compliance purge's to touch.
  assert.equal(countOf(db, "clients"), 1);
  assert.equal(countOf(db, "agency"), 1);
  assert.equal(countOf(db, "events"), 1, "the aggregate counter outlives every identity");
  assert.equal(countOf(db, "invite"), 1, "the portal cage answers to its own clock, not this one");

  // A second pass finds nothing: {purged: 0}, no error, the portal serves normally.
  assert.deepEqual(await purgeDormant(d1), { purged: 0 });
});

// ── delete-now returns the candidate to a clean state, idempotently ────────────────────

test("deleteCandidate drops one whole cage and leaves the rest untouched", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  seedOtherRegimes(db);
  await seedCandidate(db, d1, "B", {
    created: "-2 months",
    assignments: [{ start: "-1 months", end: null, status: "active" }],
  });
  await seedCandidate(db, d1, "C", {
    created: "-2 months",
    assignments: [{ start: "-1 months", end: null, status: "active" }],
  });
  const before = Object.fromEntries(COMPLIANCE_TABLES.map((t) => [t, rowsOf(db, t)]));

  assert.deepEqual(await deleteCandidate(d1, "cand-B"), { ok: true, deleted: 1 });

  for (const table of COMPLIANCE_TABLES) {
    assert.deepEqual(
      rowsOf(db, table),
      before[table].filter((row) => candidateOf(row, table) === "C"),
      `${table}: delete-now takes exactly B's cage — C stays byte-identical`,
    );
  }
  assert.equal(countOf(db, "clients"), 1);
  assert.equal(countOf(db, "events"), 1);
  assert.equal(countOf(db, "invite"), 1);

  // Idempotent: the second call matches nothing and still answers ok — after either call the
  // candidate's compliance state is clean. The `deleted: 0` beside it is the honest half, and
  // only real SQL can show it: fake-d1 reports changes 1 unconditionally.
  assert.deepEqual(await deleteCandidate(d1, "cand-B"), { ok: true, deleted: 0 });
});

// ── the closed vocabularies and the date guards, at the SQL level ──────────────────────

test("a sixth compliance_item.status and a fifth assignment.status are constraint violations", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  await seedCandidate(db, d1, "B", {
    created: "-2 months",
    assignments: [{ start: "-1 months", end: null, status: "active" }],
  });

  assert.throws(
    () => db.prepare("UPDATE compliance_item SET status = 'chased' WHERE candidate_id = 'cand-B'").run(),
    /CHECK/i,
    "the checklist has five states — #70's sweep must not invent a sixth, because the " +
      "dashboard's completeness count is defined over exactly these",
  );
  assert.throws(
    () => db.prepare("UPDATE assignment SET status = 'extended' WHERE candidate_id = 'cand-B'").run(),
    /CHECK/i,
    "#69 may want an 'extended' booking state; it arrives as a migration and a lock change",
  );
});

test("an unparseable date is a constraint violation on every guarded column, not an immortal row", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  await seedCandidate(db, d1, "B", { created: "-2 months" });

  // datetime('next Tuesday') is NULL, NULL never satisfies the purge's comparison, and the
  // cage would outlive retention with no signal. The CHECK moves that failure to write time,
  // loudly — 0002's interview_at treatment, applied to the columns the clocks read.
  assert.throws(
    () =>
      db
        .prepare("INSERT INTO candidate (id, full_name, email, created_at) VALUES ('cand-X', 'X', 'x@example.com', ?)")
        .run("next Tuesday"),
    /CHECK/i,
    "a candidate who cannot state when their record began cannot honour dormancy",
  );
  assert.throws(
    () =>
      db
        .prepare(
          "INSERT INTO assignment (id, candidate_id, client_id, start_date) VALUES ('asg-X', 'cand-B', 'c-1', ?)",
        )
        .run("whenever"),
    /CHECK/i,
    "a booking that cannot state when it began",
  );
  assert.throws(
    () => db.prepare("UPDATE compliance_item SET expiry_date = 'next Tuesday' WHERE candidate_id = 'cand-B'").run(),
    /CHECK/i,
    "an expiry the radar cannot read is an expiry that never fires — #70 would go quiet, silently",
  );

  // Every form the schema comment promises still writes: datetime('now')'s own format,
  // ISO-8601 'T' and 'Z' forms, and date-only.
  const accepted = ["2027-04-30 09:00:00", "2027-04-30T09:00:00", "2027-04-30T09:00:00Z", "2027-04-30"];
  const update = db.prepare("UPDATE compliance_item SET expiry_date = ? WHERE candidate_id = 'cand-B'");
  for (const date of accepted) update.run(date);
  assert.equal(countOf(db, "compliance_item"), ITEM_KEYS.length);

  // NULL is the "no expiry" case the References and WTR items live in permanently.
  db.prepare("UPDATE compliance_item SET expiry_date = NULL WHERE candidate_id = 'cand-B'").run();
});

test("a second row for the same candidate and item is a constraint violation", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  await seedCandidate(db, d1, "B", { created: "-2 months" });

  assert.throws(
    () =>
      db
        .prepare("INSERT INTO compliance_item (candidate_id, item_key) VALUES ('cand-B', ?)")
        .run(ITEM_KEYS[0]),
    /UNIQUE/i,
    "two rows for one candidate's HCPC registration would let the passport show 'verified' " +
      "and 'expired' at the same time",
  );

  // A second createCandidate for the same id fails on the candidate's own PRIMARY KEY, before
  // it can double the checklist.
  await assert.rejects(
    () => createCandidate(d1, { id: "cand-B", fullName: "Someone Else", email: "b2@example.com" }),
    /UNIQUE|constraint/i,
  );
});
