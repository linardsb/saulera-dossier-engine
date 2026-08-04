// #69 — the bookings routes, and the page that drives them.
//
// Two groups, split by what each engine can see.
//
// ROUTES, against the recording fake. What that proves and nothing else: the ORDER of the
// statements, and which statements never ran. The single most valuable assertion in this file is
// that a POST with an unknown client_id issues NO INSERT at all — `assignment.client_id` is a
// NOT NULL foreign key, so without the getClient guard `createCandidate` would already have run
// and seeded eight compliance_item rows before the constraint threw, leaving an orphan candidate
// nobody asked for, uncollectable by purgeDormant for twelve months, behind a 500 that on this
// deployment reads as deployment fault. The fake can see it precisely because it records
// statement text and runs none of it.
//
// SOURCE SCAN, over the page and its script. It reads the file text rather than a render,
// test/counts.test.js's idiom and its stated reason: the constraint is on what a file is ALLOWED
// TO ASK FOR, not on what it happens to display today. A page can be correct now and one fetch
// away from not being.
//
// The date boundary and the claim's atomicity are NOT here — the fake runs no SQL and would pass
// a `>` where the rule means `>=`. test/extension-radar.test.js owns those, against real SQLite.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { fakeD1 } from "./helpers/fake-d1.js";
import { d1Shape, openMigrated, skip } from "./helpers/sqlite-d1.js";
import { createAssignment } from "../src/compliance/store.js";
import { onRequestGet as listRoute, onRequestPost as createRoute } from "../functions/api/assignments.js";
import { onRequestPut as updateRoute } from "../functions/api/assignments/[id].js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const PAGE = read("public/assignments.html");
const SCRIPT = read("public/assignments.js");

const CLIENT = { id: "c-1", name: "Ashdown Park Community Healthcare", note: "" };

/** A body-carrying request. No Sec-Fetch-Site and no Origin is the curl path, which sameOrigin
 *  admits deliberately (src/http.js:44-50) — the cross-origin case sets the header explicitly. */
const post = (body, site) => ({
  url: "https://engine.pages.dev/api/assignments",
  headers: { get: (name) => (name === "Sec-Fetch-Site" ? (site ?? null) : null) },
  json: async () => body,
});

const VALID = {
  candidate_name: "Priya Nair",
  candidate_email: "priya@example.com",
  client_id: "c-1",
  start_date: "2026-09-01",
  end_date: "2026-10-15",
};

/** Every statement the handler prepared, as text. */
const sqlOf = (db) => db.calls.map((call) => call.sql);
const anyInsert = (db) => sqlOf(db).some((sql) => /INSERT/i.test(sql));

// ── the POST, and the ordering that keeps a failed booking from leaving a candidate ────

test("an unknown client_id answers 404 and writes NOTHING", async () => {
  // getClient is queued a null, so it throws the store's not_found. If the guard ever moves
  // below createCandidate this assertion fails on the INSERT, not on the status code.
  const db = fakeD1([null]);
  const response = await createRoute({ request: post(VALID), env: { DB: db } });

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "not_found" });
  assert.equal(anyInsert(db), false, "no candidate, no checklist, no booking — nothing was written");
  assert.equal(db.calls.length, 1, "and it cost exactly one statement to find out");
});

test("a known client, a new candidate: the checklist is seeded and the booking recorded", async () => {
  // getClient -> the client; candidateByEmail -> nobody. Everything after is a run().
  const db = fakeD1([CLIENT, null]);
  const response = await createRoute({ request: post(VALID), env: { DB: db } });

  assert.equal(response.status, 201);
  const sql = sqlOf(db);
  assert.equal(sql.filter((s) => /INSERT INTO candidate\b/.test(s)).length, 1);
  // createCandidate seeds all eight catalogue rows — recording a booking IS the moment a
  // candidate's compliance file starts existing, and this is where that becomes visible.
  assert.equal(sql.filter((s) => /INSERT INTO compliance_item\b/.test(s)).length, 8);
  assert.equal(sql.filter((s) => /INSERT INTO assignment\b/.test(s)).length, 1);

  const body = await response.json();
  assert.equal(body.assignment.status, "booked", "the store's default, not this route's word");
  assert.equal(body.assignment.client_name, CLIENT.name);
});

test("a second booking for the same email reuses the candidate and re-seeds nothing", async () => {
  const db = fakeD1([CLIENT, { id: "cand-1", email: "priya@example.com" }]);
  const response = await createRoute({ request: post(VALID), env: { DB: db } });

  assert.equal(response.status, 201);
  const sql = sqlOf(db);
  assert.equal(sql.filter((s) => /INSERT INTO candidate\b/.test(s)).length, 0, "no second candidate row");
  assert.equal(sql.filter((s) => /INSERT INTO compliance_item\b/.test(s)).length, 0, "no re-seeded checklist");
  assert.equal(sql.filter((s) => /INSERT INTO assignment\b/.test(s)).length, 1);
});

test("a key outside the vocabulary answers 400 and writes nothing", async () => {
  const db = fakeD1([CLIENT, null]);
  const response = await createRoute({
    request: post({ ...VALID, candidate_nhs_number: "943 476 5919" }),
    env: { DB: db },
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "unexpected_fields", fields: ["candidate_nhs_number"] });
  assert.equal(db.calls.length, 0, "the refusal is before any statement");
});

test("a rolled date is a 400 at the door, never a CHECK at the column", async () => {
  // V8 refuses 2026-13-01 but silently ROLLS 2026-02-30 to 2 March. Left to the column's CHECK
  // this would be an ERR_SQLITE_ERROR and a 500, and a 500 on this deployment means deployment
  // fault — a signal a caller-fixable input must not pollute.
  for (const field of ["start_date", "end_date"]) {
    const db = fakeD1([CLIENT, null]);
    const response = await createRoute({
      request: post({ ...VALID, [field]: "2026-02-30" }),
      env: { DB: db },
    });
    assert.equal(response.status, 400, `${field}: a rolled date must not reach the column`);
    assert.deepEqual(await response.json(), { error: "missing_fields", field });
    assert.equal(db.calls.length, 0);
  }
});

test("an end date before the start date is refused", async () => {
  const db = fakeD1([CLIENT, null]);
  const response = await createRoute({
    request: post({ ...VALID, start_date: "2026-10-01", end_date: "2026-09-01" }),
    env: { DB: db },
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "missing_fields", field: "end_date" });
  assert.equal(db.calls.length, 0);
});

test("an empty end date is an OPEN booking, not a refusal", async () => {
  const db = fakeD1([CLIENT, null]);
  const response = await createRoute({
    request: post({ ...VALID, end_date: "" }),
    env: { DB: db },
  });

  assert.equal(response.status, 201);
  assert.equal((await response.json()).assignment.end_date, null);
});

test("a cross-origin POST is 403, and a missing binding is 503", async () => {
  const db = fakeD1([CLIENT, null]);
  const blocked = await createRoute({ request: post(VALID, "cross-site"), env: { DB: db } });
  assert.equal(blocked.status, 403);
  assert.equal(db.calls.length, 0);

  const unconfigured = await createRoute({ request: post(VALID), env: {} });
  assert.equal(unconfigured.status, 503);
});

// ── the GET ────────────────────────────────────────────────────────────────────────────

test("the list carries the catalogue's lead time, so the browser holds no copy of it", async () => {
  const db = fakeD1([[{ id: "asg-1", candidate_name: "Priya Nair" }]]);
  const response = await listRoute({ env: { DB: db } });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.lead_days, 14, "sourced from EXTENSION_LEAD_DAYS, not written in the page");
  assert.equal(body.assignments.length, 1);
  // The projection is decided in the store. Neither the candidate's id nor their email is in it,
  // and the statement must not ask for them.
  const sql = sqlOf(db)[0];
  assert.doesNotMatch(sql, /\bemail\b/, "the bookings list selects no email");
  assert.doesNotMatch(sql, /SELECT \*/, "named columns, never SELECT *");
});

test("the list answers 503 without a binding", async () => {
  const response = await listRoute({ env: {} });
  assert.equal(response.status, 503);
});

// ── the PUT: extend versus resolve ─────────────────────────────────────────────────────

const put = (body, site) => ({
  url: "https://engine.pages.dev/api/assignments/asg-1",
  headers: { get: (name) => (name === "Sec-Fetch-Site" ? (site ?? null) : null) },
  json: async () => body,
});

test("a status-only resolve issues a statement that does NOT mention nudge_sent_at", async () => {
  // THE ROUTE-LEVEL HALF OF THE RE-ARM RULE. The store discriminates with Object.hasOwn, so a
  // patch built as `{ endDate: undefined, status }` would look like a two-field patch and clear
  // the claim on a resolve — the exact bug the re-arm exists to avoid, arriving through the
  // route. The fake can see it because it records the statement text.
  const db = fakeD1([]);
  const response = await updateRoute({ request: put({ status: "ended" }), env: { DB: db }, params: { id: "asg-1" } });

  assert.equal(response.status, 200);
  assert.equal(db.calls.length, 1);
  assert.doesNotMatch(db.calls[0].sql, /nudge_sent_at/, "resolving settles the nudge, it does not re-arm it");
  assert.match(db.calls[0].sql, /status = \?/);
});

test("a new end date clears the claim in the same statement", async () => {
  const db = fakeD1([]);
  const response = await updateRoute({
    request: put({ end_date: "2026-12-01" }),
    env: { DB: db },
    params: { id: "asg-1" },
  });

  assert.equal(response.status, 200);
  assert.match(db.calls[0].sql, /end_date = \?/);
  assert.match(db.calls[0].sql, /nudge_sent_at = NULL/, "extending re-arms the radar");
  // One statement, because D1 has no transaction and two would be a live half-state.
  assert.equal(db.calls.length, 1);
});

test("an unknown status is 400, and the vocabulary is not duplicated in the route", async () => {
  const db = fakeD1([]);
  const response = await updateRoute({
    request: put({ status: "extended" }),
    env: { DB: db },
    params: { id: "asg-1" },
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "missing_fields" });
  assert.equal(db.calls.length, 0, "the store threw before any statement was prepared");
  assert.doesNotMatch(read("functions/api/assignments/[id].js"), /"cancelled"/, "ASSIGNMENT_STATUSES has one home");
});

test("an unknown booking is 404", async () => {
  // fakeD1 answers `{changes: 1}` unconditionally, and the not-found branch is exactly the one
  // that needs the other answer — so this is the one statement stub in the file.
  const noRows = {
    prepare: () => ({
      bind() { return this; },
      async run() { return { success: true, meta: { changes: 0 } }; },
    }),
  };
  const response = await updateRoute({
    request: put({ status: "ended" }),
    env: { DB: noRows },
    params: { id: "no-such-booking" },
  });

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "not_found" });
});

test("a body with nothing to change is 400, and a stray key is 400", async () => {
  const empty = await updateRoute({ request: put({}), env: { DB: fakeD1([]) }, params: { id: "asg-1" } });
  assert.equal(empty.status, 400);

  const stray = await updateRoute({
    request: put({ status: "ended", nudge_sent_at: null }),
    env: { DB: fakeD1([]) },
    params: { id: "asg-1" },
  });
  assert.equal(stray.status, 400);
  assert.deepEqual(await stray.json(), { error: "unexpected_fields", fields: ["nudge_sent_at"] });
});

test("a cross-origin PUT is 403 and a missing binding is 503", async () => {
  const blocked = await updateRoute({
    request: put({ status: "ended" }, "cross-site"),
    env: { DB: fakeD1([]) },
    params: { id: "asg-1" },
  });
  assert.equal(blocked.status, 403);

  const unconfigured = await updateRoute({
    request: put({ status: "ended" }),
    env: {},
    params: { id: "asg-1" },
  });
  assert.equal(unconfigured.status, 503);
});

// ── the page and its script ────────────────────────────────────────────────────────────

test("assignments.js asks for exactly two API roots and nothing else", () => {
  const paths = [...SCRIPT.matchAll(/"(\/api\/[^"]*)"/g)].map((m) => m[1]);
  assert.ok(paths.length > 0, "this scan is reading the file wrong");
  for (const path of paths) {
    assert.ok(
      path === "/api/clients" || path.startsWith("/api/assignments"),
      `assignments.js reaches ${path}, which is outside this screen's two endpoints`,
    );
  }
});

test("assignments.js parses no HTML and reaches no browser storage", () => {
  for (const sink of ["innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval("]) {
    assert.ok(!SCRIPT.includes(sink), `assignments.js uses ${sink} — a candidate name is text, never markup`);
  }
  for (const store of ["localStorage", "sessionStorage", "indexedDB", "document.cookie"]) {
    assert.ok(!SCRIPT.includes(store), `assignments.js reaches ${store}`);
  }
});

test("the amber threshold is not written in the browser", () => {
  // It comes down the wire as `lead_days`. A literal here would give the threshold a second home
  // while the sweep kept the first — the drift "thresholds live in the catalogue" exists to stop.
  const copyStart = SCRIPT.indexOf("var COPY = {");
  const copyEnd = SCRIPT.indexOf("\n  };", copyStart);
  const code = SCRIPT.slice(0, copyStart) + SCRIPT.slice(copyEnd);
  assert.doesNotMatch(code, /\b14\b/, "assignments.js carries its own copy of EXTENSION_LEAD_DAYS");
  assert.match(SCRIPT, /lead_days/, "and it reads the one the API sends");
});

test("the bookings page carries the chrome contract", () => {
  assert.match(PAGE, /<script src="\/assignments\.js"><\/script>/, "the script tag");
  assert.match(PAGE, /<meta name="robots" content="noindex, nofollow">/, "a recruiter screen is not indexed");
  assert.doesNotMatch(PAGE, /maximum-scale|user-scalable=no/, "pinch zoom stays available (WCAG 1.4.4)");
  assert.doesNotMatch(PAGE, /<style/, "every rule lives in app.css — chrome.test.js's INLINE_STYLE_PAGES is hardcoded");
  assert.match(PAGE, /aria-current="page"[^>]*>Bookings|href="\/assignments" aria-current="page"/, "this screen is current in its own nav");
});

test("the bookings screen accepts no document, of any kind", () => {
  // Metadata-only is spike #66's first decision, and a booking screen is a plausible place for
  // someone to add "attach the signed contract". test/compliance-pages.test.js makes the same
  // assertion over the candidate's checklist; this is that rule at the recruiter's root.
  for (const source of [PAGE, SCRIPT]) {
    assert.doesNotMatch(source, /type="file"|FormData|multipart|enctype/i, "an upload control appeared");
  }
});

test("every visible string on the screen lives in COPY", () => {
  // The house rule for a browser script: one object holding the words, so the whole voice of the
  // screen can be read and revised in one place rather than hunted through render functions.
  const copyStart = SCRIPT.indexOf("var COPY = {");
  assert.ok(copyStart > -1, "assignments.js has no COPY object");
  const copyEnd = SCRIPT.indexOf("\n  };", copyStart);
  const code = SCRIPT.slice(0, copyStart) + SCRIPT.slice(copyEnd);
  assert.doesNotMatch(code, /textContent = "[^"]+"/, "a visible string was set outside COPY");
});

// ── the POST against a REAL database, with foreign keys on ─────────────────────────────
//
// Everything above runs on the recording fake, which enforces no constraint — so the orphan
// guard is proven there only by the ABSENCE of an INSERT. This block proves the other half: that
// the constraint it guards against is real, that the guard beats it, and that the counts a
// recruiter would check by hand come out right. It is the Level 4 manual sweep's steps 4, 5 and
// 6 made durable, which matters because a manual sweep is run once and a test is run forever.
//
// PRAGMA foreign_keys is ON in openMigrated (D1's default; plain SQLite's is OFF), and without
// it every assertion here would pass while proving nothing — test/helpers/sqlite-d1.js says so.

const counts = (db) => ({
  candidates: db.prepare("SELECT count(*) AS n FROM candidate").get().n,
  items: db.prepare("SELECT count(*) AS n FROM compliance_item").get().n,
  bookings: db.prepare("SELECT count(*) AS n FROM assignment").get().n,
});

test("a real booking: one candidate, eight checklist rows, one booking", { skip }, async () => {
  const db = openMigrated();
  const env = { DB: d1Shape(db) };

  const first = await createRoute({ request: post(VALID), env });
  assert.equal(first.status, 201);
  // The invariant a recruiter can check by hand: items = 8 × candidates.
  assert.deepEqual(counts(db), { candidates: 1, items: 8, bookings: 1 });

  // A second booking for the same email reuses the candidate and re-seeds nothing — the
  // checklist they have already filled in is not wiped by recording their next contract.
  const second = await createRoute({
    request: post({ ...VALID, start_date: "2026-11-01", end_date: "2027-01-31" }),
    env,
  });
  assert.equal(second.status, 201);
  assert.deepEqual(counts(db), { candidates: 1, items: 8, bookings: 2 });

  // A different candidate does get their own cage.
  await createRoute({
    request: post({ ...VALID, candidate_name: "Marcus Adeyemi", candidate_email: "marcus@example.com" }),
    env,
  });
  assert.deepEqual(counts(db), { candidates: 2, items: 16, bookings: 3 });
});

test("an unknown client leaves NOTHING behind — the orphan case, against the real constraint", { skip }, async () => {
  const db = openMigrated();
  const env = { DB: d1Shape(db) };
  await createRoute({ request: post(VALID), env });
  const before = counts(db);

  const response = await createRoute({
    request: post({ ...VALID, candidate_email: "new@example.com", client_id: "c-does-not-exist" }),
    env,
  });

  assert.equal(response.status, 404, "not a 500 — a 500 on this deployment reads as deployment fault");
  assert.deepEqual(counts(db), before, "no candidate, no eight checklist rows, no booking");

  // And the constraint the guard is standing in front of is real: reaching createAssignment with
  // that id throws at the database. This is what would have run AFTER createCandidate.
  await assert.rejects(
    () =>
      createAssignment(env.DB, {
        id: "asg-orphan",
        candidateId: "no-such-candidate",
        clientId: "c-does-not-exist",
        startDate: "2026-09-01",
      }),
    /FOREIGN KEY|constraint/i,
    "if this stops throwing, PRAGMA foreign_keys is off and this whole block proves nothing",
  );
});

test("a rolled date is a 400 and writes nothing, against the real CHECK", { skip }, async () => {
  const db = openMigrated();
  const env = { DB: d1Shape(db) };

  const response = await createRoute({ request: post({ ...VALID, end_date: "2026-02-30" }), env });
  assert.equal(response.status, 400, "the route caught it, not the column");
  assert.deepEqual(counts(db), { candidates: 0, items: 0, bookings: 0 });
});

test("the list, the extend and the resolve, end to end through the routes", { skip }, async () => {
  const db = openMigrated();
  const env = { DB: d1Shape(db) };
  // Dates computed by SQLite, so the fixture's arithmetic and the query's are the same one —
  // and the start is in the past, or the route's own end-before-start rule refuses the booking.
  const started = db.prepare("SELECT date('now', '-30 days') AS d").get().d;
  const soon = db.prepare("SELECT date('now', '+9 days') AS d").get().d;
  const far = db.prepare("SELECT date('now', '+40 days') AS d").get().d;

  const created = await createRoute({
    request: post({ ...VALID, start_date: started, end_date: far }),
    env,
  });
  assert.equal(created.status, 201);
  const second = await createRoute({
    request: post({
      ...VALID,
      candidate_email: "marcus@example.com",
      candidate_name: "Marcus Adeyemi",
      start_date: started,
      end_date: soon,
    }),
    env,
  });
  assert.equal(second.status, 201);

  const listed = await (await listRoute({ env })).json();
  assert.deepEqual(listed.assignments.map((a) => a.candidate_name), ["Marcus Adeyemi", "Priya Nair"],
    "the one ending in nine days sorts above the one ending in forty");
  assert.equal(listed.lead_days, 14);

  const nine = listed.assignments[0];
  db.prepare("UPDATE assignment SET nudge_sent_at = datetime('now') WHERE id = ?").run(nine.id);

  // EXTEND re-arms.
  const extended = await updateRoute({
    request: put({ end_date: far }),
    env,
    params: { id: nine.id },
  });
  assert.equal(extended.status, 200);
  assert.equal(
    db.prepare("SELECT nudge_sent_at FROM assignment WHERE id = ?").get(nine.id).nudge_sent_at,
    null,
    "the new deadline will nudge again",
  );

  // RESOLVE does not.
  db.prepare("UPDATE assignment SET nudge_sent_at = datetime('now') WHERE id = ?").run(nine.id);
  const before = db.prepare("SELECT nudge_sent_at FROM assignment WHERE id = ?").get(nine.id).nudge_sent_at;
  await updateRoute({ request: put({ status: "ended" }), env, params: { id: nine.id } });
  assert.equal(
    db.prepare("SELECT nudge_sent_at FROM assignment WHERE id = ?").get(nine.id).nudge_sent_at,
    before,
    "marking a booking ended settles the nudge rather than re-asking",
  );

  // And it sinks to the bottom of the list.
  const resorted = await (await listRoute({ env })).json();
  assert.equal(resorted.assignments[resorted.assignments.length - 1].id, nine.id);
});

test("delete-now still takes every booking with it", { skip }, async () => {
  const db = openMigrated();
  const env = { DB: d1Shape(db) };
  await createRoute({ request: post(VALID), env });

  db.prepare("DELETE FROM candidate").run();
  assert.deepEqual(counts(db), { candidates: 0, items: 0, bookings: 0 }, "the cascade owns the new column too");
});
