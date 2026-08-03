// #71 — the recruiter compliance dashboard: its two routes, and the page that drives them.
//
// Three blocks, split by what each engine can see. Choosing the right one per assertion is the
// whole discipline of this suite, so each block says what it proves and what it cannot.
//
// BLOCK 1 · the routes against the RECORDING FAKE. What that proves and nothing else: the ORDER
// of the statements, which statements NEVER RAN, and the exact SQL text. It runs no SQL and
// enforces no constraint, so it would pass a `>` where the rule means `>=` and it cannot see a
// compare-and-swap's loser at all. The most valuable assertion in this block is that a reject on
// a deployment that cannot send mail prepares NO `UPDATE` — without it, a half-configured
// deployment resets a locum's item and never tells them why, and the reason exists nowhere else.
//
// BLOCK 2 · a SOURCE SCAN over the page and its script. It reads the file text rather than a
// render, test/counts.test.js's idiom and its stated reason: the constraint is on what a file is
// ALLOWED TO ASK FOR, which is a property of the text and not of any particular paint.
//
// BLOCK 3 · REAL migrated SQLite with PRAGMA foreign_keys ON. Everything the fake cannot see —
// the boundaries, the CAS's winner and its loser, what a verify leaves standing, and the one
// assertion this whole ticket turns on: that risk is fresh WITHOUT A SWEEP HAVING RUN.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { fakeD1 } from "./helpers/fake-d1.js";
import { d1Shape, openMigrated, skip } from "./helpers/sqlite-d1.js";
import { COMPLIANCE_CATALOGUE, ITEM_KEYS, MAX_AMBER_DAYS } from "../src/compliance/catalogue.js";
import { dueExpiryItems } from "../src/compliance/store.js";
import { onRequestGet as listRoute } from "../functions/api/compliance.js";
import { onRequestPut as writeRoute } from "../functions/api/compliance/[id].js";
import { onRequestPost as bookingRoute } from "../functions/api/assignments.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const PAGE = read("public/compliance.html");
const SCRIPT = read("public/compliance.js");
const WRITE_ROUTE_SOURCE = read("functions/api/compliance/[id].js");

/** The route's own cap, read off its source rather than retyped — one home for the number. */
const REASON_MAX = Number(WRITE_ROUTE_SOURCE.match(/const REASON_MAX = (\d+)/)[1]);

/** Every statement the handler prepared, as text. */
const sqlOf = (db) => db.calls.map((call) => call.sql);

/** Anchored at the start of the statement, and that is not fussiness: `getAgency` selects
 *  `updated_at`, so an unanchored /UPDATE/i counts a read as a write and every bail-before-write
 *  assertion below passes for the wrong reason. */
const isWrite = (sql) => /^\s*UPDATE\b/i.test(sql);
const anyUpdate = (db) => sqlOf(db).some(isWrite);

/** No Sec-Fetch-Site and no Origin is the curl path, which sameOrigin admits deliberately. */
const put = (body, site) => ({
  url: "https://engine.pages.dev/api/compliance/cand-1",
  headers: { get: (name) => (name === "Sec-Fetch-Site" ? (site ?? null) : null) },
  json: async () => body,
});

const MAILABLE = { RESEND_API_KEY: "re_test_key_123", PREP_BASE_URL: "https://engine.pages.dev" };

/**
 * Runs `fn` with fetch replaced by a recorder — test/prep-email.test.js's helper, and its
 * warning: an escaped stub poisons every later test file in the same process, so it is restored
 * in a finally. Any test whose reject reaches the send MUST go through this, or the suite posts
 * to Resend.
 */
async function withFetch(fn) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ id: "msg_1" }), { status: 200 });
  };
  try {
    return { calls, result: await fn() };
  } finally {
    globalThis.fetch = original;
  }
}

/** One checklist row as listComplianceState returns it. */
const row = (candidateId, name, itemKey, over = {}) => ({
  candidate_id: candidateId,
  candidate_name: name,
  item_key: itemKey,
  status: "missing",
  reference: "",
  expiry_date: null,
  checked_at: null,
  days_left: null,
  ...over,
});

// ── BLOCK 1 · the GET ──────────────────────────────────────────────────────────────────

test("the dashboard answers 503 without a binding", async () => {
  const response = await listRoute({ env: {} });
  assert.equal(response.status, 503);
});

test("an empty database is an empty list, not an error", async () => {
  const db = fakeD1([[]]);
  const response = await listRoute({ env: { DB: db } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { candidates: [] });
});

test("the checklist is built from the CATALOGUE, not from the rows that came back", async () => {
  // Two rows only, and in an order the catalogue does not use. A route iterating the rows would
  // answer with two items in that order; iterating the catalogue answers with all eight in the
  // catalogue's, which is what makes an item added after a candidate was seeded appear as
  // something to start rather than vanish.
  const db = fakeD1([
    [
      row("cand-1", "Priya Nair", "wtr_choice", { status: "submitted", reference: "opted out" }),
      row("cand-1", "Priya Nair", "dbs_enhanced", { status: "verified", reference: "0012" }),
    ],
  ]);
  const body = await (await listRoute({ env: { DB: db } })).json();

  assert.equal(body.candidates.length, 1);
  const candidate = body.candidates[0];
  assert.deepEqual(candidate.items.map((item) => item.item_key), ITEM_KEYS, "catalogue order, every key");
  assert.equal(candidate.total, COMPLIANCE_CATALOGUE.length, "never a hardcoded total");
  assert.equal(candidate.items.find((item) => item.item_key === "hcpc_registration").status, "missing",
    "an item with no row reads as one nobody has started");
  assert.equal(candidate.id, "cand-1", "the id the write route is addressed by");
  assert.equal(candidate.full_name, "Priya Nair");
});

test("the dashboard's statement selects candidate_id, and no email", async () => {
  const db = fakeD1([[]]);
  await listRoute({ env: { DB: db } });
  const sql = sqlOf(db)[0];
  const projection = sql.slice(0, sql.search(/\bFROM\b/));

  assert.ok(!projection.includes("*"), "named columns, never SELECT *");
  // The one store read that DOES return candidate_id, and the reason it is right: this list is
  // the address book for a write. A screen that cannot name the row it is acting on cannot act.
  assert.match(projection, /candidate_id/, "the PUT is /api/compliance/:candidateId");
  // And the thing it still refuses. The reject email's address is read server-side by the write
  // route, one column at a time — this payload never carries one.
  assert.doesNotMatch(projection, /\bemail\b/, "the dashboard needs no address");
});

test("RISK IS COMPUTED FROM THE DATE, NOT READ OFF status — the staleness fix", async () => {
  // The row is `submitted` and has been for weeks; nothing has swept, because the sweep runs
  // only on /prep/* and a recruiter's request triggers none. Its date is inside its own amber
  // window, so the screen must say so anyway.
  const immunisations = COMPLIANCE_CATALOGUE.find((item) => item.key === "immunisations");
  const db = fakeD1([
    [
      row("cand-1", "Priya Nair", "immunisations", {
        status: "submitted",
        reference: "IMM-4",
        expiry_date: "2026-09-01",
        days_left: immunisations.amberDays - 1,
      }),
      row("cand-1", "Priya Nair", "hcpc_registration", {
        status: "submitted",
        reference: "PH-9",
        expiry_date: "2020-01-01",
        days_left: -4,
      }),
    ],
  ]);
  const body = await (await listRoute({ env: { DB: db } })).json();
  const items = body.candidates[0].items;
  const at = (key) => items.find((item) => item.item_key === key);

  assert.equal(at("immunisations").risk, "expiring", "inside its own window, whatever the column says");
  assert.equal(at("immunisations").status, "submitted", "and the chase state is untouched — two facts, not one");
  assert.equal(at("hcpc_registration").risk, "expired", "a lapsed date reads as lapsed with no sweep");
  assert.equal(body.candidates[0].at_risk, 2, "at_risk counts the computed risk");
  // A non-expiring item can hold no deadline and never carries a risk.
  assert.equal(at("references").risk, null);
  assert.equal(at("references").days_left, null);
});

test("the per-item threshold rides the wire, so the browser holds no copy of it", async () => {
  const db = fakeD1([[row("cand-1", "Priya Nair", "immunisations")]]);
  const body = await (await listRoute({ env: { DB: db } })).json();
  const items = body.candidates[0].items;

  for (const entry of COMPLIANCE_CATALOGUE) {
    const item = items.find((i) => i.item_key === entry.key);
    assert.equal(item.amber_days, entry.amberDays, `${entry.key}: the catalogue's number, not a literal`);
    assert.equal(item.expires, entry.expires);
    assert.equal(item.label, entry.label, "the label, so the page never renders a key");
  }
});

test("the four counts each answer a different question", async () => {
  const db = fakeD1([
    [
      row("cand-1", "Priya Nair", "dbs_enhanced", { status: "verified" }),
      row("cand-1", "Priya Nair", "right_to_work", { status: "verified" }),
      row("cand-1", "Priya Nair", "immunisations", { status: "submitted" }),
      row("cand-1", "Priya Nair", "indemnity", { status: "expiring", expiry_date: "2026-09-01", days_left: 5 }),
      // The remaining four keys have no row at all, so they are `missing`.
    ],
  ]);
  const candidate = (await (await listRoute({ env: { DB: db } })).json()).candidates[0];

  // COMPLETENESS IS `verified` ALONE, deliberately unlike items.js's DONE (submitted|verified).
  // The candidate's screen counts what THEY have finished; this counts what has been CHECKED,
  // and the gap between the two is the work on the recruiter's desk.
  assert.equal(candidate.verified, 2);
  assert.equal(candidate.awaiting_review, 1, "same predicate and same name as the candidate's screen");
  assert.equal(candidate.at_risk, 1, "from the computed risk");
  assert.equal(candidate.missing, 4, "the four keys with no row");
  assert.equal(candidate.total, 8);
});

test("the worst candidate sorts first, and the order is the CONTRACT", async () => {
  // Server-side, because "a booking-blocking red item is unmissable" is the ticket's promise and
  // a render function could quietly reorder it. Names are chosen so alphabetical order is the
  // OPPOSITE of the required one — otherwise this passes for the wrong reason.
  const db = fakeD1([
    [
      row("c-a", "Anna Clean", "dbs_enhanced", { status: "verified" }),
      row("c-b", "Ben Amber", "immunisations", { status: "submitted", expiry_date: "2026-09-01", days_left: 3 }),
      row("c-c", "Cara Red", "hcpc_registration", { status: "submitted", expiry_date: "2020-01-01", days_left: -9 }),
    ],
  ]);
  const body = await (await listRoute({ env: { DB: db } })).json();
  assert.deepEqual(body.candidates.map((c) => c.full_name), ["Cara Red", "Ben Amber", "Anna Clean"]);
  // And the sort's working columns do not leak into the contract.
  for (const candidate of body.candidates) {
    assert.deepEqual(
      Object.keys(candidate).sort(),
      ["at_risk", "awaiting_review", "full_name", "id", "items", "missing", "total", "verified"],
    );
  }
});

test("a candidate with no checklist rows still appears, rather than vanishing", async () => {
  // Unreachable through createCandidate, which seeds all eight — reachable by hand, and this is
  // the one screen where a candidate quietly disappearing is the failure it exists to prevent.
  // The LEFT JOIN hands back one row with a null item_key.
  const db = fakeD1([[row("cand-1", "Priya Nair", null)]]);
  const body = await (await listRoute({ env: { DB: db } })).json();

  assert.equal(body.candidates.length, 1);
  assert.equal(body.candidates[0].missing, 8, "eight items nobody has started, which is the truth");
  assert.equal(body.candidates[0].verified, 0);
});

// ── BLOCK 1 · the PUT ──────────────────────────────────────────────────────────────────

test("a key outside the vocabulary is 400 and writes nothing", async () => {
  const db = fakeD1([]);
  const response = await writeRoute({
    request: put({ item_key: "dbs_enhanced", action: "verify", note: "looks fine" }),
    env: { DB: db },
    params: { id: "cand-1" },
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "unexpected_fields", fields: ["note"] });
  assert.equal(db.calls.length, 0, "the refusal is before any statement");
});

test("an unknown item_key and an unknown action are both 400 before any statement", async () => {
  for (const body of [
    { item_key: "passport_photo", action: "verify" },
    { item_key: "dbs_enhanced", action: "approve" },
    { item_key: "dbs_enhanced", action: "" },
  ]) {
    const db = fakeD1([]);
    const response = await writeRoute({ request: put(body), env: { DB: db }, params: { id: "cand-1" } });
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal((await response.json()).error, "missing_fields");
    assert.equal(db.calls.length, 0, "the vocabulary is checked at the door, never at a CHECK");
  }
});

test("a reason on a VERIFY is 400, not a silently ignored key", async () => {
  // item.js's treatment of a date on a non-expiring item: a body carrying a field the action has
  // no use for is a caller who believes something this route is not doing.
  const db = fakeD1([]);
  const response = await writeRoute({
    request: put({ item_key: "dbs_enhanced", action: "verify", reason: "wrong name" }),
    env: { DB: db },
    params: { id: "cand-1" },
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "unexpected_fields", fields: ["reason"] });
  assert.equal(db.calls.length, 0);
});

test("a reject with no reason, or a runaway one, is 400 and writes nothing", async () => {
  for (const reason of [undefined, "", "   ", "x".repeat(REASON_MAX + 1)]) {
    const db = fakeD1([]);
    const response = await writeRoute({
      request: put({ item_key: "dbs_enhanced", action: "reject", reason }),
      env: { DB: db, ...MAILABLE },
      params: { id: "cand-1" },
    });
    assert.equal(response.status, 400, `reason ${JSON.stringify(reason)?.slice(0, 20)}`);
    assert.deepEqual(await response.json(), { error: "missing_fields", field: "reason" });
    assert.equal(db.calls.length, 0);
  }

  // At the cap exactly is accepted — the boundary the other half of that check depends on.
  const db = fakeD1([{ email: "priya@example.com" }]);
  const { result } = await withFetch(() =>
    writeRoute({
      request: put({ item_key: "dbs_enhanced", action: "reject", reason: "x".repeat(REASON_MAX) }),
      env: { DB: db, ...MAILABLE },
      params: { id: "cand-1" },
    }),
  );
  assert.equal(result.status, 200);
});

test("A REJECT ON A DEPLOYMENT THAT CANNOT SEND WRITES NOTHING", async () => {
  // The single most valuable assertion in this file. The reject's whole CONTENT — the reason —
  // exists only in the email; nothing stores it. A write with no send leaves a locum staring at
  // an item that has silently emptied itself, with no way to learn why. So the route bails
  // BEFORE the write and the item stays `submitted`, which is true.
  //
  // Asserted on the ABSENCE OF AN `UPDATE` rather than on `db.calls.length === 0`: the address
  // lookup legitimately issues a SELECT on the paths that get that far, so a zero-statement
  // assertion would pass or fail for the wrong reason.
  for (const [name, env] of [
    ["no API key", { PREP_BASE_URL: MAILABLE.PREP_BASE_URL }],
    ["no base URL", { RESEND_API_KEY: MAILABLE.RESEND_API_KEY }],
    ["a base URL that is not a bare https origin", { ...MAILABLE, PREP_BASE_URL: "https://x.dev/prep?a=1" }],
    ["a base URL that is not https", { ...MAILABLE, PREP_BASE_URL: "http://x.dev" }],
  ]) {
    const db = fakeD1([{ email: "priya@example.com" }]);
    const response = await writeRoute({
      request: put({ item_key: "dbs_enhanced", action: "reject", reason: "the name does not match" }),
      env: { DB: db, ...env },
      params: { id: "cand-1" },
    });

    assert.equal(response.status, 503, name);
    assert.deepEqual(await response.json(), { error: "mail_not_configured" });
    assert.equal(anyUpdate(db), false, `${name}: the item is still awaiting review`);
  }
});

test("a reject for an unknown candidate is 404 BEFORE the write, not after", async () => {
  const db = fakeD1([null]); // candidateEmailById finds nobody
  const response = await writeRoute({
    request: put({ item_key: "dbs_enhanced", action: "reject", reason: "the name does not match" }),
    env: { DB: db, ...MAILABLE },
    params: { id: "no-such-candidate" },
  });

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "not_found" });
  assert.equal(anyUpdate(db), false, "404 before writing, not after");
  assert.equal(db.calls.length, 1, "and it cost exactly one statement to find out");
});

test("a reject for a candidate with a blank address is 503, and writes nothing", async () => {
  // The second door into the same failure, closed. Without this the guard is reachable around:
  // configuration is fine, the item resets, and no message is possible.
  for (const email of [null, "", "   "]) {
    const db = fakeD1([{ email }]);
    const response = await writeRoute({
      request: put({ item_key: "dbs_enhanced", action: "reject", reason: "the name does not match" }),
      env: { DB: db, ...MAILABLE },
      params: { id: "cand-1" },
    });

    assert.equal(response.status, 503, JSON.stringify(email));
    assert.deepEqual(await response.json(), { error: "mail_not_configured" });
    assert.equal(anyUpdate(db), false);
  }
});

test("a cross-origin PUT is 403 and a missing binding is 503", async () => {
  const db = fakeD1([]);
  const blocked = await writeRoute({
    request: put({ item_key: "dbs_enhanced", action: "verify" }, "cross-site"),
    env: { DB: db, ...MAILABLE },
    params: { id: "cand-1" },
  });
  assert.equal(blocked.status, 403);
  assert.equal(db.calls.length, 0);

  const unconfigured = await writeRoute({
    request: put({ item_key: "dbs_enhanced", action: "verify" }),
    env: MAILABLE,
    params: { id: "cand-1" },
  });
  assert.equal(unconfigured.status, 503);
});

test("VERIFY IS ONE UPDATE THAT TOUCHES NEITHER THE REFERENCE NOR THE DATE", async () => {
  // The regression this catches is someone routing verify through `setItemState`, which writes
  // both columns unconditionally — so verifying a document would wipe the number and the date
  // that made it verifiable, drop the row out of dueExpiryItems, and leave a permanent hole in
  // the radar opened by the action whose whole point is diligence.
  const db = fakeD1([]);
  const response = await writeRoute({
    request: put({ item_key: "dbs_enhanced", action: "verify" }),
    env: { DB: db },
    params: { id: "cand-1" },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(db.calls.length, 1, "one statement: the CAS is the whole action");
  const sql = db.calls[0].sql;
  assert.match(sql, /^UPDATE compliance_item/, "not routed through a wider writer");
  assert.match(sql, /status = 'verified'/, "the first and only write of `verified` in the product");
  assert.match(sql, /AND status = 'submitted'/, "the compare-and-swap, which is also the state guard");
  assert.match(sql, /checked_at = datetime\('now'\)/, "a person touched this, unlike the sweep");
  assert.doesNotMatch(sql, /reference/, "the number the recruiter just checked is left standing");
  assert.doesNotMatch(sql, /expiry_date/, "and so is the date");
  assert.deepEqual(db.calls[0].args, ["cand-1", "dbs_enhanced"], "both bound, never templated");
});

test("REJECT clears the reference and the date, and sends after the write", async () => {
  const db = fakeD1([{ email: "priya@example.com" }]);
  const { calls, result } = await withFetch(() =>
    writeRoute({
      request: put({ item_key: "dbs_enhanced", action: "reject", reason: "the certificate is in a different name" }),
      env: { DB: db, ...MAILABLE },
      params: { id: "cand-1" },
    }),
  );

  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { ok: true, emailed: true });

  const update = sqlOf(db).find(isWrite);
  assert.match(update, /status = 'missing'/);
  assert.match(update, /reference = ''/, "the number typed for a document that was not accepted");
  assert.match(update, /expiry_date = NULL/, "a rejected item has no deadline, so it leaves the radar");
  assert.match(update, /AND status = 'submitted'/);

  // The address lookup ran BEFORE the update — that ordering is the bail-before-write rule. The
  // third statement is `getAgency`, which runs after the write because a missing agency row must
  // not decide whether the reject applies (it degrades to "your recruitment agency").
  const order = sqlOf(db).map((sql) => (isWrite(sql) ? "write" : "read"));
  assert.deepEqual(order, ["read", "write", "read"]);
  assert.equal(calls.length, 1, "exactly one message");
});

test("the rejection message carries the item's LABEL and the reason, and points at the compliance door", async () => {
  const db = fakeD1([{ email: "priya@example.com" }]);
  const { calls } = await withFetch(() =>
    writeRoute({
      request: put({ item_key: "dbs_enhanced", action: "reject", reason: "the certificate is in a different name" }),
      env: { DB: db, ...MAILABLE },
      params: { id: "cand-1" },
    }),
  );
  const body = JSON.parse(calls[0].init.body);
  const label = COMPLIANCE_CATALOGUE.find((item) => item.key === "dbs_enhanced").label;

  assert.ok(body.subject.includes(label), "a candidate must never read `dbs_enhanced` in an email");
  assert.ok(!body.subject.includes("different name"), "the reason is never in an inbox preview");
  assert.ok(body.text.includes("the certificate is in a different name"), "and it is in the body");
  assert.ok(body.text.includes("/prep/compliance/login"), "the compliance door");
  assert.ok(!body.text.includes("/prep/login"), "never the interview-prep one — independent cookies");
});

test("a send that throws is reported, and the reset is NOT rolled back", async () => {
  const db = fakeD1([{ email: "priya@example.com" }]);
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ message: "no" }), { status: 403 });
  let response;
  try {
    response = await writeRoute({
      request: put({ item_key: "dbs_enhanced", action: "reject", reason: "the certificate is in a different name" }),
      env: { DB: db, ...MAILABLE },
      params: { id: "cand-1" },
    });
  } finally {
    globalThis.fetch = original;
  }

  assert.equal(response.status, 200);
  // After the guards above, `emailed: false` means exactly one thing — Resend threw — which is
  // what makes the page's copy for it ("we could not send it; call them") honest. A rollback
  // would be a second write racing the candidate's own re-submit.
  assert.deepEqual(await response.json(), { ok: true, emailed: false });
  assert.equal(anyUpdate(db), true, "the item genuinely is reset");
});

test("a compare-and-swap that matches nothing is 409, and says which state refused", async () => {
  // fakeD1's run() answers `changes: 1` unconditionally, so the loser needs the one statement
  // stub in this file — test/assignments.test.js's move for the same reason.
  const noRows = {
    prepare: () => ({
      bind() { return this; },
      async run() { return { success: true, meta: { changes: 0 } }; },
      async first() { return { email: "priya@example.com" }; },
    }),
  };

  for (const body of [
    { item_key: "dbs_enhanced", action: "verify" },
    { item_key: "dbs_enhanced", action: "reject", reason: "the name does not match" },
  ]) {
    const { result } = await withFetch(() =>
      writeRoute({ request: put(body), env: { DB: noRows, ...MAILABLE }, params: { id: "cand-1" } }),
    );
    assert.equal(result.status, 409, body.action);
    // 409 and not 404: the row exists and it is the STATE that refused. A recruiter told "not
    // found" would reload and see it still sitting there.
    assert.deepEqual(await result.json(), { error: "not_submitted" });
  }
});

// ── BLOCK 2 · the page and its script ──────────────────────────────────────────────────

test("compliance.js asks for exactly one API root and nothing else", () => {
  const paths = [...SCRIPT.matchAll(/"(\/api\/[^"]*)"/g)].map((m) => m[1]);
  assert.ok(paths.length > 0, "this scan is reading the file wrong");
  for (const path of paths) {
    assert.ok(path.startsWith("/api/compliance"), `compliance.js reaches ${path}, outside this screen's endpoint`);
  }
});

test("compliance.js issues no fetch outside its own api() helper", () => {
  // One `fetch(` — the one inside api(). A second would be a request the assertion above cannot
  // see, which is the only way this file could grow another source quietly.
  const fetches = SCRIPT.match(/\bfetch\s*\(/g) ?? [];
  assert.equal(fetches.length, 1, "exactly one fetch, and it is the api() helper's");
});

/**
 * The script with its COPY object cut out — every gate below is on the CODE.
 *
 * The two guards are not belt-and-braces. If the closing `\n  };` ever moves, `indexOf` answers
 * -1, `slice(-1)` yields ONE CHARACTER, and every assertion built on this passes while scanning
 * nothing at all: the forbidden-word gate, the threshold gate and the every-string-in-COPY gate,
 * all green, all vacuous. A gate that cannot fail is worse than no gate, because it is cited as
 * evidence.
 */
function codeOutsideCopy() {
  const copyStart = SCRIPT.indexOf("var COPY = {");
  assert.ok(copyStart > -1, "compliance.js has no COPY object");
  const copyEnd = SCRIPT.indexOf("\n  };", copyStart);
  assert.ok(copyEnd > copyStart, "the COPY slice collapsed — every gate below would pass vacuously");
  const code = SCRIPT.slice(0, copyStart) + SCRIPT.slice(copyEnd);
  assert.ok(code.includes("encodeURIComponent"), "…and the code half really is inside the slice");
  return code;
}

test("AC #5: the dashboard names no prep-portal behaviour telemetry", () => {
  // Epic #65 AC #5. Prep-portal behaviour never reaches a recruiter compliance surface, and this
  // is the screen where "it would be useful to see whether they practised" would land first.
  //
  // Scoped OUTSIDE the COPY object, test/counts.test.js's rule and its reason: COPY is prose for
  // a recruiter and prose may legitimately contain a word the code must not.
  //
  // TWO DELIBERATE DIVERGENCES FROM test/counts.test.js's LIST, and both matter.
  //
  // 1. `turn` and other bare words are unusable here. That file matches with
  //    `new RegExp(word, "i")` — a SUBSTRING match with no word boundary — so `turn` ⊂ `return`
  //    and the gate would fail against any JavaScript ever written. Every entry below is a real
  //    identifier in src/, functions/ or migrations/ (checked by grep) and none is a substring
  //    of a common word. Do not add a ninth without checking both.
  // 2. `email` is deliberately ABSENT, unlike counts.js's list. The reject response carries
  //    `{ emailed: true|false }` and this page renders a line about it, so the word legitimately
  //    appears in this file's code. The no-address guarantee is enforced where it is actually
  //    enforceable — in the store's projection, asserted in test/compliance-store.test.js — and
  //    not by a word scan over a browser script. A gate that fails on correct code gets deleted,
  //    which would cost the real check.
  const code = codeOutsideCopy();
  for (const forbidden of ["competency", "habit", "attempt", "brief_json", "invite_id", "opened_at", "drill", "ladder"]) {
    assert.ok(
      !new RegExp(forbidden, "i").test(code),
      `compliance.js reads or renders ${forbidden}, which is prep-portal behaviour`,
    );
  }
});

test("compliance.js parses no HTML and reaches no browser storage", () => {
  for (const sink of ["innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval("]) {
    assert.ok(!SCRIPT.includes(sink), `compliance.js uses ${sink} — a reference number is text, never markup`);
  }
  for (const store of ["localStorage", "sessionStorage", "indexedDB", "document.cookie"]) {
    assert.ok(!SCRIPT.includes(store), `compliance.js reaches ${store}`);
  }
});

test("the compliance screen accepts no document, of any kind", () => {
  // Metadata-only is spike #66's first decision, and THIS is the most plausible place in the
  // whole product for someone to add "attach the DBS certificate" — a screen with a verify
  // button already on it. test/assignments.test.js makes the same assertion at the bookings root.
  for (const source of [PAGE, SCRIPT]) {
    assert.doesNotMatch(source, /type="file"|FormData|multipart|enctype/i, "an upload control appeared");
  }
});

test("no threshold is written in the browser", () => {
  // `risk` arrives already decided by the server, from the catalogue's per-item amberDays. A
  // literal here would give those thresholds a second home while the sweep kept the first — the
  // drift test/assignments.test.js:309 exists to stop, at a second root.
  const code = codeOutsideCopy();
  assert.doesNotMatch(code, /\b(30|60)\b/, "compliance.js carries its own copy of a catalogue threshold");
  assert.ok(!SCRIPT.includes("amberDays"), "and it never names the catalogue's field either");
  assert.match(SCRIPT, /item\.risk/, "it reads the decision the API sends");
});

test("nothing candidate-shaped goes in the URL", () => {
  // The candidate id travels in the PATH OF THE PUT, which is a request and not a location.
  assert.ok(!SCRIPT.includes("window.location"), "no candidate id in the address bar");
  assert.ok(!SCRIPT.includes("history.pushState"));
  assert.match(SCRIPT, /encodeURIComponent\(candidateId\)/, "and it is encoded into the request path");
});

test("every visible string on the screen lives in COPY", () => {
  // The house rule for a browser script: one object holding the words, so the whole voice of the
  // screen can be read and revised in one place rather than hunted through render functions.
  assert.doesNotMatch(codeOutsideCopy(), /textContent = "[^"]+"/, "a visible string was set outside COPY");
});

test("the compliance page carries the chrome contract", () => {
  assert.match(PAGE, /<script src="\/compliance\.js"><\/script>/, "the script tag");
  assert.match(PAGE, /<meta name="robots" content="noindex, nofollow">/, "a recruiter screen is not indexed");
  assert.doesNotMatch(PAGE, /maximum-scale|user-scalable=no/, "pinch zoom stays available (WCAG 1.4.4)");
  // test/chrome.test.js's INLINE_STYLE_PAGES is hardcoded, so a page-scoped block here would be
  // silently ungated in BOTH directions — no colour check and no motion check.
  assert.doesNotMatch(PAGE, /<style/, "every rule lives in app.css");
  assert.match(PAGE, /href="\/compliance" aria-current="page"/, "this screen is current in its own nav");
});

test("every recruiter screen links the dashboard exactly once", () => {
  // The nav is duplicated per page on purpose — static aria-current, because each file knows
  // which screen it is, and there is no build step to share a partial with.
  for (const page of [
    "public/index.html",
    "public/clients.html",
    "public/counts.html",
    "public/assignments.html",
    "public/compliance.html",
  ]) {
    const links = read(page).match(/href="\/compliance"/g) ?? [];
    assert.equal(links.length, 1, `${page} links /compliance ${links.length} times`);
  }
});

test("the page states what it holds and what it does not", () => {
  // The bound belongs beside the promise, /counts' rule: a screen offering to track compliance
  // documents has to say, on the screen, that it holds none of them.
  const text = PAGE.replace(/\s+/g, " ");
  assert.ok(text.includes("about to run out"), "the promise");
  assert.ok(text.includes("never the document itself"), "and its bound");
});

// ── BLOCK 3 · the routes against REAL migrated SQLite ──────────────────────────────────
//
// Everything above runs on the recording fake, which enforces no constraint and answers
// `changes: 1` unconditionally — so a compare-and-swap's loser is invisible there, and a `<=`
// written as `<` would pass every assertion in Block 1. This block is where the boundaries, the
// CAS and the cascade are actually proven.
//
// Every fixture date is computed by SQLITE ITSELF and every threshold is read off the CATALOGUE
// rather than typed — test/expiry-radar.test.js's discipline, and the reason its ±1-day
// assertions mean anything. PRAGMA foreign_keys is ON in openMigrated (D1's default; plain
// SQLite's is OFF).

const VALID_BOOKING = {
  candidate_name: "Priya Nair",
  candidate_email: "priya@example.com",
  client_id: "c-1",
};

const post = (body) => ({
  url: "https://engine.pages.dev/api/assignments",
  headers: { get: () => null },
  json: async () => body,
});

/** A migrated database with one client, and a helper that computes dates in SQL. */
function open() {
  const db = openMigrated();
  const d1 = d1Shape(db);
  const date = (offset) => db.prepare(`SELECT date('now', '${offset} days') AS d`).get().d;
  return { db, d1, date, env: { DB: d1 } };
}

/** The one production path that creates a candidate and seeds its eight checklist rows. */
async function seedCandidate(env, date, over = {}) {
  const response = await bookingRoute({
    request: post({ ...VALID_BOOKING, start_date: date("-30"), end_date: date("+90"), ...over }),
    env,
  });
  assert.equal(response.status, 201, "the booking is what starts a candidate's compliance file");
}

/** What the candidate's own POST writes, without standing up a portal session for it. */
const submit = (db, email, itemKey, expiryDate) =>
  db
    .prepare(
      `UPDATE compliance_item SET status = 'submitted', reference = ?, expiry_date = ?
        WHERE item_key = ? AND candidate_id = (SELECT id FROM candidate WHERE email = ?)`,
    )
    .run(`REF-${itemKey}`, expiryDate, itemKey, email);

const itemRow = (db, email, itemKey) =>
  db
    .prepare(
      `SELECT status, reference, expiry_date, checked_at FROM compliance_item
        WHERE item_key = ? AND candidate_id = (SELECT id FROM candidate WHERE email = ?)`,
    )
    .get(itemKey, email);

const listed = async (env) => (await (await listRoute({ env })).json()).candidates;
const itemOf = (candidate, key) => candidate.items.find((item) => item.item_key === key);

const AMBER_OF = (key) => COMPLIANCE_CATALOGUE.find((item) => item.key === key).amberDays;

test("RISK IS FRESH WITH NO SWEEP HAVING RUN — the difference between a dashboard and a cache",
  { skip },
  async () => {
    const { db, date, env } = open();
    await seedCandidate(env, date);

    // Inside its own amber window, and PAST for the second. Nothing has swept: sweepExpiryStates
    // runs on the /prep/* middleware and this test never touches it, exactly as a recruiter
    // opening the screen never touches it.
    submit(db, VALID_BOOKING.candidate_email, "immunisations", date(`+${AMBER_OF("immunisations") - 1}`));
    submit(db, VALID_BOOKING.candidate_email, "hcpc_registration", date("-4"));

    const [candidate] = await listed(env);

    assert.equal(itemOf(candidate, "immunisations").status, "submitted", "the column is untouched…");
    assert.equal(itemOf(candidate, "immunisations").risk, "expiring", "…and the screen says so anyway");
    assert.equal(itemOf(candidate, "hcpc_registration").status, "submitted");
    assert.equal(itemOf(candidate, "hcpc_registration").risk, "expired", "red is tested before amber");
    assert.equal(itemOf(candidate, "hcpc_registration").days_left, -4, "computed by SQLite, not by V8");
    assert.equal(candidate.at_risk, 2);
    assert.equal(candidate.awaiting_review, 2, "two facts about the same rows, and both are true");
  });

test("the ±1-day boundary holds for two items with DIFFERENT windows, in one GET", { skip }, async () => {
  // The assertion a hardcoded 30 or 60 would fail: `immunisations` and `hcpc_registration` carry
  // different lead times, and each is placed at its own edge.
  const { db, date, env } = open();
  await seedCandidate(env, date);
  const email = VALID_BOOKING.candidate_email;

  for (const key of ["immunisations", "hcpc_registration"]) {
    submit(db, email, key, date(`+${AMBER_OF(key)}`));
  }
  let [candidate] = await listed(env);
  for (const key of ["immunisations", "hcpc_registration"]) {
    assert.equal(itemOf(candidate, key).risk, "expiring", `${key}: the far edge is INCLUSIVE`);
    assert.equal(itemOf(candidate, key).days_left, AMBER_OF(key));
  }

  for (const key of ["immunisations", "hcpc_registration"]) {
    submit(db, email, key, date(`+${AMBER_OF(key) + 1}`));
  }
  [candidate] = await listed(env);
  for (const key of ["immunisations", "hcpc_registration"]) {
    assert.equal(itemOf(candidate, key).risk, null, `${key}: one day outside its own window is not amber`);
  }

  // And today is AMBER, not red: a certificate valid to the 3rd is valid all day on the 3rd.
  submit(db, email, "immunisations", date("+0"));
  [candidate] = await listed(env);
  assert.equal(itemOf(candidate, "immunisations").days_left, 0);
  assert.equal(itemOf(candidate, "immunisations").risk, "expiring");
});

test("VERIFY LEAVES THE REFERENCE AND THE DATE STANDING", { skip }, async () => {
  // The setItemState trap, made permanent. Read both before, verify, read both after.
  const { db, date, env } = open();
  await seedCandidate(env, date);
  const email = VALID_BOOKING.candidate_email;
  const expiry = date("+400");
  submit(db, email, "dbs_enhanced", expiry);
  const before = itemRow(db, email, "dbs_enhanced");

  const [candidate] = await listed(env);
  const response = await writeRoute({
    request: put({ item_key: "dbs_enhanced", action: "verify" }),
    env,
    params: { id: candidate.id },
  });
  assert.equal(response.status, 200);

  const after = itemRow(db, email, "dbs_enhanced");
  assert.equal(after.status, "verified", "the first and only write of `verified` in the product");
  assert.equal(after.reference, before.reference, "the number the recruiter just checked");
  assert.equal(after.expiry_date, expiry, "and the date that made it verifiable — still in the radar");
  assert.notEqual(after.checked_at, null, "a person touched this");

  // Still visible to the sweep, which is the whole point of not wiping the date.
  const due = await dueExpiryItems(env.DB, MAX_AMBER_DAYS);
  assert.equal(due.some((row) => row.item_key === "dbs_enhanced"), false, "…though not yet due, at 400 days out");
  const [recount] = await listed(env);
  assert.equal(recount.verified, 1);
  assert.equal(recount.awaiting_review, 0);
});

test("verifying twice does not re-stamp checked_at — the double-click case", { skip }, async () => {
  const { db, date, env } = open();
  await seedCandidate(env, date);
  const email = VALID_BOOKING.candidate_email;
  submit(db, email, "dbs_enhanced", date("+400"));
  const [candidate] = await listed(env);
  const verify = () =>
    writeRoute({ request: put({ item_key: "dbs_enhanced", action: "verify" }), env, params: { id: candidate.id } });

  assert.equal((await verify()).status, 200);
  // A marker in the column, so "unchanged" is an assertion rather than a coincidence of both
  // writes landing in the same second.
  db.prepare("UPDATE compliance_item SET checked_at = '2020-01-01 00:00:00' WHERE item_key = 'dbs_enhanced'").run();

  const second = await verify();
  assert.equal(second.status, 409, "the CAS finds `verified`, matches nothing, and says so");
  assert.deepEqual(await second.json(), { error: "not_submitted" });
  assert.equal(itemRow(db, email, "dbs_enhanced").checked_at, "2020-01-01 00:00:00", "nothing was written");
});

test("verify is refused from every state but `submitted`", { skip }, async () => {
  const { db, date, env } = open();
  await seedCandidate(env, date);
  const email = VALID_BOOKING.candidate_email;
  const [candidate] = await listed(env);

  for (const status of ["missing", "verified", "expiring", "expired"]) {
    db.prepare(
      `UPDATE compliance_item SET status = ?, expiry_date = ?
        WHERE item_key = 'immunisations' AND candidate_id = (SELECT id FROM candidate WHERE email = ?)`,
    ).run(status, status === "missing" ? null : date("+5"), email);

    const response = await writeRoute({
      request: put({ item_key: "immunisations", action: "verify" }),
      env,
      params: { id: candidate.id },
    });
    assert.equal(response.status, 409, `verify from ${status}`);
    assert.equal(itemRow(db, email, "immunisations").status, status, "and nothing was written");
  }

  // `expiring` IS A DELIBERATE PRODUCT HOLE, not an oversight — an item that ambers while it
  // sits on the recruiter's desk can only be cleared by the candidate re-submitting. Allowing it
  // would reopen the re-nudge loop: dueExpiryItems selects `verified`, so the next sweep would
  // re-amber the row and send a SECOND email for the same expiry date. Carried to the owner as
  // Open Question 1 rather than fixed in the CAS. The row still RENDERS correctly meanwhile —
  // asserted below, because that is what makes the hole survivable rather than invisible.
  const [rendered] = await listed(env);
  assert.equal(itemOf(rendered, "immunisations").status, "expired", "the chase state, as the sweep left it");
  assert.equal(itemOf(rendered, "immunisations").risk, "expiring", "and the real risk, computed from the date");
});

test("REJECT resets the item and drops it out of the radar", { skip }, async () => {
  const { db, date, env } = open();
  await seedCandidate(env, date);
  const email = VALID_BOOKING.candidate_email;
  submit(db, email, "immunisations", date(`+${AMBER_OF("immunisations") - 2}`));

  // It is in the sweep's window before the reject — otherwise the assertion after it is empty.
  const before = await dueExpiryItems(env.DB, MAX_AMBER_DAYS);
  assert.equal(before.some((row) => row.item_key === "immunisations"), true);

  const [candidate] = await listed(env);
  const { calls, result } = await withFetch(() =>
    writeRoute({
      request: put({ item_key: "immunisations", action: "reject", reason: "the record stops in 2019" }),
      env: { ...env, ...MAILABLE },
      params: { id: candidate.id },
    }),
  );

  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { ok: true, emailed: true });
  assert.equal(calls.length, 1, "and the candidate was told why");

  const after = itemRow(db, email, "immunisations");
  assert.equal(after.status, "missing", "the checklist tells the truth: nothing valid is on file");
  assert.equal(after.reference, "", "the number they typed for a document that was not accepted");
  assert.equal(after.expiry_date, null, "a rejected item has no deadline");

  // A refused certificate must not go on nudging them about a document just turned down.
  const due = await dueExpiryItems(env.DB, MAX_AMBER_DAYS);
  assert.equal(due.some((row) => row.item_key === "immunisations"), false, "it has left the radar");

  const [recount] = await listed(env);
  assert.equal(itemOf(recount, "immunisations").risk, null);
  assert.equal(recount.at_risk, 0);
  assert.equal(recount.missing, 8);
});

test("a reject that cannot be sent leaves the item exactly where it was", { skip }, async () => {
  const { db, date, env } = open();
  await seedCandidate(env, date);
  const email = VALID_BOOKING.candidate_email;
  submit(db, email, "immunisations", date("+40"));
  const [candidate] = await listed(env);

  const response = await writeRoute({
    request: put({ item_key: "immunisations", action: "reject", reason: "the record stops in 2019" }),
    env: { ...env, PREP_BASE_URL: MAILABLE.PREP_BASE_URL }, // no RESEND_API_KEY
    params: { id: candidate.id },
  });

  assert.equal(response.status, 503);
  const after = itemRow(db, email, "immunisations");
  assert.equal(after.status, "submitted", "still awaiting review, which is TRUE");
  assert.equal(after.reference, "REF-immunisations", "and their reference is untouched");
  assert.equal(after.expiry_date, date("+40"));
});

test("the worst candidate sorts first, against real data", { skip }, async () => {
  const { db, date, env } = open();
  // Alphabetical order is deliberately the OPPOSITE of the required one.
  await seedCandidate(env, date, { candidate_name: "Anna Clean", candidate_email: "anna@example.com" });
  await seedCandidate(env, date, { candidate_name: "Ben Amber", candidate_email: "ben@example.com" });
  await seedCandidate(env, date, { candidate_name: "Cara Red", candidate_email: "cara@example.com" });

  // Anna is fully verified, Ben has one item inside its window, Cara has one that lapsed.
  db.prepare("UPDATE compliance_item SET status = 'verified' WHERE candidate_id = (SELECT id FROM candidate WHERE email = 'anna@example.com')").run();
  submit(db, "ben@example.com", "immunisations", date(`+${AMBER_OF("immunisations") - 3}`));
  submit(db, "cara@example.com", "hcpc_registration", date("-1"));

  const candidates = await listed(env);
  assert.deepEqual(candidates.map((c) => c.full_name), ["Cara Red", "Ben Amber", "Anna Clean"]);
  assert.equal(candidates[2].verified, 8, "8 of 8 verified, and nothing at risk");
  assert.equal(candidates[2].at_risk, 0);
});

test("two candidates sharing a name come back in a stable order", { skip }, async () => {
  const { date, env } = open();
  await seedCandidate(env, date, { candidate_email: "priya.one@example.com" });
  await seedCandidate(env, date, { candidate_email: "priya.two@example.com" });

  const first = (await listed(env)).map((c) => c.id);
  const second = (await listed(env)).map((c) => c.id);
  assert.equal(first.length, 2);
  assert.deepEqual(first, second, "the candidate.id tiebreak, or two reads could disagree");
});

test("a non-expiring item never carries a deadline or a risk", { skip }, async () => {
  const { db, date, env } = open();
  await seedCandidate(env, date);
  // `references` and `wtr_choice` are `expires: false` and hold no date — item.js answers 400 for
  // one. Even with a date forced into the column by hand, the route refuses to invent a risk.
  db.prepare(
    `UPDATE compliance_item SET status = 'submitted', expiry_date = ? WHERE item_key = 'references'`,
  ).run(date("-1"));

  const [candidate] = await listed(env);
  assert.equal(itemOf(candidate, "references").expires, false);
  assert.equal(itemOf(candidate, "references").risk, null, "an item with no deadline cannot be at risk");
  assert.equal(itemOf(candidate, "wtr_choice").days_left, null);
  assert.equal(candidate.at_risk, 0);
});

test("a candidate whose rows were removed by hand still appears, with the truth", { skip }, async () => {
  const { db, date, env } = open();
  await seedCandidate(env, date);
  db.prepare("DELETE FROM compliance_item").run();

  const [candidate] = await listed(env);
  assert.equal(candidate.full_name, "Priya Nair", "the LEFT JOIN keeps the person on the screen");
  assert.equal(candidate.missing, 8, "eight items nobody has started");
  assert.equal(candidate.total, 8);
});

test("delete-now still empties the whole cage", { skip }, async () => {
  const { db, date, env } = open();
  await seedCandidate(env, date);
  db.prepare("DELETE FROM candidate").run();

  assert.deepEqual(await listed(env), [], "the cascade owns everything this screen reads");
});
