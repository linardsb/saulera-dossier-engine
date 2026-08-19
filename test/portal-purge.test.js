// #17 AC1–AC3 — the data lifecycle, proven against real SQL rather than recorded strings.
//
// The class of failure this file catches: the cascade chain or the purge boundary being
// subtly wrong in ways no recorded-SQL assertion can see — a missing ON DELETE CASCADE that
// leaves orphaned candidate rows, an ALTER that breaks on a populated table, a `<` where the
// retention rule means `<=`. It applies both migrations in order onto a database that already
// has data, seeds mixed-age invites with full scopes, and asserts row-for-row exactness.
//
// Engine: `node:sqlite`, which this machine's default Node 20 does not have — every test
// skips there with the remedy in the message, and CI/dev runs under Node 24 prove the rest.
// The adapter and the skip come from test/helpers/sqlite-d1.js, where the PRAGMA
// foreign_keys gotcha that makes them non-optional is written down.
//
// `openMigrated` is deliberately NOT the shared one. The helper applies every migration and
// then seeds; this file has to seed BETWEEN 0001 and 0002, because the ALTER landing on an
// events table that already has rows is one of the things AC #1 asserts. Sharing the helper
// here would delete the assertion rather than reuse a fixture.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { deleteInviteByTokenHash, hashToken, purgeExpired } from "../src/portal/store.js";
import { d1Shape, skip } from "./helpers/sqlite-d1.js";

const migrations = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

let DatabaseSync;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch {
  // Node < 22.5: ERR_UNKNOWN_BUILTIN_MODULE. `skip` above carries the remedy.
}

const PORTAL_TABLES = [
  "invite",
  "candidate_role",
  "competency",
  "question",
  "attempt",
  "habit",
  "otp",
  "debrief",
  "debrief_competency",
  "story",
  "story_competency",
];

// Which invite a row belongs to, by the reference each table declares. Fixture ids embed the
// invite's letter ('inv-A', 'role-A', 'comp-A-1'), so scope membership is readable off the key.
const SCOPE_KEY = {
  invite: (r) => r.id,
  candidate_role: (r) => r.invite_id,
  competency: (r) => r.role_id,
  question: (r) => r.competency_id,
  attempt: (r) => r.competency_id,
  habit: (r) => r.role_id,
  otp: (r) => r.invite_id,
  // #77. `deb-A` and `role-A` both split to 'A', which is what keeps inviteOf below one function.
  debrief: (r) => r.candidate_role_id,
  debrief_competency: (r) => r.debrief_id,
  // #78, and the same rule with one trap worth naming: `inviteOf` reads the letter out of
  // `.split("-")[1]`, so the fixture story ids MUST be `story-A-1` — letter in the second
  // position. A uuid (which is what production mints) or a `story-1-A` would yield `undefined`
  // for every row, and the deepEqual below would then compare an empty survivor list against an
  // empty one and pass while proving nothing about the cascade.
  story: (r) => r.candidate_role_id,
  story_competency: (r) => r.story_id,
};
const inviteOf = (row, table) => SCOPE_KEY[table](row).split("-")[1];

/**
 * Every migration, in wrangler's order, onto a database that is POPULATED between the first two —
 * the ALTER has to land on an events table that already has rows, because that is what it will
 * meet in production (AC #1's second proof, after `npm run db:local`).
 *
 * The tail after 0002 is applied by enumeration rather than by name, and #77 is why: this file
 * stopped at 0002 while every caged table lived there, and the debrief's two tables (0011) do not.
 * A fixture that seeds a table the schema has not created fails with `no such table`, which reads
 * exactly like the cascade bug this file exists to catch. Enumerating is also what makes the NEXT
 * caged table free — sqlite-d1.js:110-116 makes the same argument for the shared helper: a caller
 * that applies only the migrations it has heard of is testing a schema this deployment does not run.
 */
function openMigrated() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON"); // D1's default; SQLite's is OFF
  const files = readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort();
  // 0001 by NAME, not position (#84 L6): the seed below must land between init and 0002's ALTER,
  // and a positional files[0] would silently seed after the wrong migration if a file ever sorts
  // ahead of init — turning "the ALTER lands on populated events" into a test of nothing.
  if (files[0] !== "0001_init.sql") throw new Error(`expected 0001_init.sql first, found ${files[0]}`);
  db.exec(readFileSync(join(migrations, files[0]), "utf8"));
  db.exec("INSERT INTO clients (id, name) VALUES ('c-1', 'Ashdown Park Community Healthcare')");
  db.exec("INSERT INTO events (client_id, duration_ms) VALUES ('c-1', 8200)");
  for (const file of files.slice(1)) db.exec(readFileSync(join(migrations, file), "utf8"));
  return db;
}

/**
 * One invite with its entire scope: the handover payload, two competencies, a core question
 * with a variant_of child (the self-reference must cascade with its parent), an attempt in
 * each of the three modes, a habit, an otp, the private debrief (#77) and its two shaky ticks,
 * and the storybank (#78) — two stories and two of their ticks.
 * Per invite that is 1+1+2+2+3+1+1+1+2+2+2 rows.
 */
async function seedInvite(db, letter, interviewOffset) {
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const invite = `inv-${letter}`;
  const role = `role-${letter}`;
  run(
    `INSERT INTO invite (id, client_id, token_hash, email, interview_at, expires_at)
     VALUES (?, 'c-1', ?, ?, datetime('now', ?), datetime('now', ?, '+14 days'))`,
    invite, await hashToken(`token-${letter}`), `${letter}@example.com`, interviewOffset, interviewOffset,
  );
  run("INSERT INTO candidate_role (id, invite_id, jd_text, cv_text) VALUES (?, ?, 'jd', 'cv')", role, invite);
  for (const n of [1, 2]) {
    run("INSERT INTO competency (id, role_id, label) VALUES (?, ?, ?)", `comp-${letter}-${n}`, role, `Competency ${n}`);
  }
  run("INSERT INTO question (id, competency_id, text) VALUES (?, ?, 'core question')", `q-${letter}-core`, `comp-${letter}-1`);
  run(
    "INSERT INTO question (id, competency_id, text, variant_of, axis) VALUES (?, ?, 'variant', ?, 'lateral')",
    `q-${letter}-var`, `comp-${letter}-1`, `q-${letter}-core`,
  );
  for (const mode of ["recall", "nudged", "revealed"]) {
    run("INSERT INTO attempt (competency_id, question_id, mode, rating) VALUES (?, ?, ?, 3)", `comp-${letter}-1`, `q-${letter}-core`, mode);
  }
  run("INSERT INTO habit (role_id, label) VALUES (?, 'buries the result')", role);
  run("INSERT INTO otp (invite_id, code_hash, expires_at) VALUES (?, ?, datetime('now', '+15 minutes'))", invite, await hashToken(`code-${letter}`));
  // #77. One placed line and one still unplaced, which is the shape the form actually saves — a
  // `null` placement is a real state, not a half-written row, so the cascade must take it too.
  run(
    "INSERT INTO debrief (id, candidate_role_id, asked_json, fix_text) VALUES (?, ?, ?, ?)",
    `deb-${letter}`, role,
    JSON.stringify([
      { text: "Tell me about a lone visit that went wrong.", competency_id: `comp-${letter}-1` },
      { text: "Why this trust?", competency_id: null },
    ]),
    "Lead with the result, not the setup.",
  );
  for (const n of [1, 2]) {
    run("INSERT INTO debrief_competency (debrief_id, competency_id) VALUES (?, ?)", `deb-${letter}`, `comp-${letter}-${n}`);
  }
  // #78. Two stories, and the second one carries NO ticks on purpose. An unmapped story is a real
  // state the candidate leaves behind — a title typed and not yet linked to any part of the job,
  // or one whose only competency a re-handover removed — and it holds the same free text as a
  // mapped one. A fixture where every story had a tick would prove the cascade only for rows the
  // join table also reaches, and would say nothing about the one row shape most likely to be
  // orphaned.
  run(
    "INSERT INTO story (id, candidate_role_id, title, sketch) VALUES (?, ?, ?, ?)",
    `story-${letter}-1`, role, "The escalation on nights",
    "A patient's family refused the care plan at 2am and I had nobody to hand it to.",
  );
  run(
    "INSERT INTO story (id, candidate_role_id, title, sketch) VALUES (?, ?, ?, ?)",
    `story-${letter}-2`, role, "The audit nobody wanted", "",
  );
  for (const n of [1, 2]) {
    run("INSERT INTO story_competency (story_id, competency_id) VALUES (?, ?)", `story-${letter}-1`, `comp-${letter}-${n}`);
  }
}

// `debrief_competency` has no `id` column — the pair IS the primary key (#77) — and SQLite would
// answer `ORDER BY id` there with the implicit rowid, which is not stable across a re-insert and
// is not the fact the row records. One order key per table, decided here once rather than in each
// assertion, so the row-for-row deepEqual below compares like with like.
// `story_competency` (#78) is the same shape and takes the same treatment for the same reason.
const ORDER_BY = {
  debrief_competency: "debrief_id, competency_id",
  story_competency: "story_id, competency_id",
};
const rowsOf = (db, table) =>
  db.prepare(`SELECT * FROM ${table} ORDER BY ${ORDER_BY[table] ?? "id"}`).all();
const countOf = (db, table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;

// ── AC #1: the migrations apply, in order, onto a database that already has data ───────

test("0002 applies clean after 0001 and the ALTER backfills kind on existing rows", { skip }, () => {
  const db = openMigrated();

  // What THIS file needs of the schema, and no more: every table its fixtures seed must exist
  // after the walk. The closed table universe was pinned here too, as a third hand-maintained
  // copy of the list schema.test.js computes and compliance-purge.test.js repeats — so a 0013
  // adding a table failed this file with a message about `kind` backfilling, which invited the
  // "just add the name" fix (#84 L6). The exact-universe claim lives in those two files.
  const names = new Set(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((r) => r.name),
  );
  for (const table of PORTAL_TABLES) {
    assert.ok(names.has(table), `${table}: seedInvite writes here and the migrations no longer create it`);
  }

  // The legacy row was inserted before the ALTER ran; the DDL default is what makes
  // recordEvent's untouched SQL keep writing pack events.
  assert.equal(db.prepare("SELECT kind FROM events").get().kind, "pack_generated");
});

// ── AC #2: purge deletes exactly the expired invite scopes and nothing else ────────────

test("purgeExpired takes the expired scopes — including the exact 30-day boundary — row-for-row", { skip }, async () => {
  const db = openMigrated();
  await seedInvite(db, "A", "-40 days"); // expired
  await seedInvite(db, "D", "-30 days"); // the boundary: interview_at + 30d is now, and <= purges it
  await seedInvite(db, "B", "-5 days"); //  live
  await seedInvite(db, "C", "+7 days"); //  future

  const before = Object.fromEntries(PORTAL_TABLES.map((t) => [t, rowsOf(db, t)]));

  const { purged } = await purgeExpired(d1Shape(db));
  assert.equal(purged, 2, "A (-40d) and the exact -30d boundary invite D purge; B and C do not");

  for (const table of PORTAL_TABLES) {
    const survivors = before[table].filter((row) => ["B", "C"].includes(inviteOf(row, table)));
    assert.deepEqual(
      rowsOf(db, table),
      survivors,
      `${table}: the live and future scopes must survive byte-identical, the expired ones vanish entirely`,
    );
  }

  // The engine tables are not the purge's to touch.
  assert.equal(countOf(db, "agency"), 1);
  assert.equal(countOf(db, "clients"), 1);
  assert.equal(countOf(db, "events"), 1, "the aggregate counter survives purge — counts outlive identities");

  // A second pass finds nothing: {purged: 0}, no error, the portal serves normally.
  assert.deepEqual(await purgeExpired(d1Shape(db)), { purged: 0 });
});

// ── AC #3: delete-now returns the candidate to a clean state, idempotently ─────────────

test("deleteInviteByTokenHash drops one whole scope and leaves the rest untouched", { skip }, async () => {
  const db = openMigrated();
  await seedInvite(db, "B", "-5 days");
  await seedInvite(db, "C", "+7 days");
  const before = Object.fromEntries(PORTAL_TABLES.map((t) => [t, rowsOf(db, t)]));

  const result = await deleteInviteByTokenHash(d1Shape(db), await hashToken("token-B"));
  assert.deepEqual(result, { ok: true, deleted: 1 });

  for (const table of PORTAL_TABLES) {
    assert.deepEqual(
      rowsOf(db, table),
      before[table].filter((row) => inviteOf(row, table) === "C"),
      `${table}: delete-now takes exactly B's scope — C stays byte-identical`,
    );
  }
  assert.equal(countOf(db, "clients"), 1);
  assert.equal(countOf(db, "events"), 1);

  // Idempotent: the second call matches nothing and still answers ok — the candidate's
  // state is clean either way, and a stale link must not make the delete button lie. The
  // `deleted: 0` beside it is the honest half, and only real SQL can show it: fake-d1
  // reports changes 1 unconditionally, so this assertion is meaningless anywhere but here.
  assert.deepEqual(
    await deleteInviteByTokenHash(d1Shape(db), await hashToken("token-B")),
    { ok: true, deleted: 0 },
  );
});

// ── the honesty rule and the closed vocabulary, at the SQL level ───────────────────────

test("a fourth attempt.mode and a fourth events.kind are constraint violations", { skip }, async () => {
  const db = openMigrated();
  await seedInvite(db, "B", "-5 days");

  assert.throws(
    () => db.prepare("INSERT INTO attempt (competency_id, question_id, mode) VALUES ('comp-B-1', 'q-B-core', 'shown')").run(),
    /CHECK/i,
    "SPEC State: a revealed answer must never count as recall — the CHECK is what stops #23 inventing a fourth mode",
  );
  assert.throws(
    () => db.prepare("INSERT INTO events (client_id, duration_ms, kind) VALUES ('c-1', 0, 'invite_deleted')").run(),
    /CHECK/i,
    "decision 3/23: the telemetry vocabulary is closed — a fourth kind is a schema change to make in the open",
  );
});

test("an unparseable interview_at is a constraint violation, not an immortal row", { skip }, () => {
  const db = openMigrated();
  const insert = db.prepare(
    `INSERT INTO invite (id, client_id, token_hash, email, interview_at, expires_at)
     VALUES (?, 'c-1', ?, 'x@example.com', ?, datetime('now', '+14 days'))`,
  );

  // datetime('next Tuesday') is NULL, NULL <= datetime('now') is NULL, and the purge's
  // WHERE would never match — the scope outlives retention with no signal, breaching the
  // privacy page's 30-day promise. The CHECK moves that failure to write time, loudly.
  assert.throws(
    () => insert.run("inv-X", "h-X", "next Tuesday"),
    /CHECK/i,
    "decision 13: a scope that cannot state its interview date cannot honour retention — reject the write",
  );

  // Every form the schema comment promises still inserts: datetime('now')'s own format,
  // ISO-8601 'T' and 'Z' forms, and date-only.
  const accepted = ["2026-06-01 09:00:00", "2026-06-01T09:00:00", "2026-06-01T09:00:00Z", "2026-06-01"];
  for (const [i, at] of accepted.entries()) {
    insert.run(`inv-ok-${i}`, `h-ok-${i}`, at);
  }
  assert.equal(countOf(db, "invite"), accepted.length);
});
