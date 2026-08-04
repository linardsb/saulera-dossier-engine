// #68 — the passport's three routes, at the layer where the decisions actually live.
//
// The split this file sits on is the repo's: `fakeD1` proves the SQL a store BUILT,
// `node:sqlite` proves behaviour that branches on a constraint or on `meta.changes`. Almost
// everything below is the second kind, because almost every rule this ticket adds is a refusal:
// a status a candidate may not write, a date the column would reject, a row that is not theirs.
// Under the fake, `setItemState` reports `{changes: 1}` whatever it was handed, so the 404 and
// the idempotency assertions would pass while the logic was wrong.
//
// The single most important test in the ticket is "a candidate cannot write `verified`". The
// store accepts all five statuses by design (#70's sweep and #71's recruiter both need it), so
// the narrowing lives in functions/prep/compliance/api/item.js alone — one file, one literal,
// and this is what holds it there.
//
// Engine: node:sqlite, which this machine's default Node 20 does not have — every test skips
// there with the remedy in the message, and Node 24 proves the rest.

import { test } from "node:test";
import assert from "node:assert/strict";

import { hashToken } from "../src/portal/store.js";
import { COMPLIANCE_CATALOGUE, ITEM_KEYS } from "../src/compliance/catalogue.js";
import { createCandidate, rotateCandidateSession, setItemState } from "../src/compliance/store.js";
import { COMPLIANCE_COOKIE, sessionExpiry } from "../src/compliance/tokens.js";
import { mintToken } from "../src/prep/tokens.js";
import { onRequestGet as itemsRoute } from "../functions/prep/compliance/api/items.js";
import { onRequestPost as itemRoute } from "../functions/prep/compliance/api/item.js";
import { onRequestPost as deleteRoute } from "../functions/prep/compliance/api/delete.js";
import { onRequestGet as demoRoute } from "../functions/prep/compliance/demo.js";
import { d1Shape, openMigrated, skip } from "./helpers/sqlite-d1.js";
import { fakeD1 } from "./helpers/fake-d1.js";

const itemRow = (db, candidateId, itemKey) =>
  db.prepare("SELECT * FROM compliance_item WHERE candidate_id = ? AND item_key = ?").get(candidateId, itemKey);

/** A GET carrying the compliance cookie, or nothing. No Origin: the curl path. */
const getWith = (token) => ({
  headers: { get: (name) => (name === "Cookie" && token ? `${COMPLIANCE_COOKIE}=${token}` : null) },
});

/** A POST carrying the compliance cookie and a JSON body. */
const postWith = (token, body) => ({
  headers: { get: (name) => (name === "Cookie" && token ? `${COMPLIANCE_COOKIE}=${token}` : null) },
  json: async () => body,
});

/** One candidate with a full seeded checklist, signed in. Returns their cookie value. */
async function seed(db) {
  const d1 = d1Shape(db);
  await createCandidate(d1, { id: "cand-A", fullName: "Priya Raman", email: "priya@example.com" });
  const token = mintToken();
  await rotateCandidateSession(d1, {
    candidateId: "cand-A",
    newHash: await hashToken(token),
    expiresAt: sessionExpiry(),
  });
  return { d1, token, env: { DB: d1 } };
}

// ── the narrowing, which is the point of the whole route ───────────────────────────────

test("a candidate cannot write `verified` — status is not in the body vocabulary", { skip }, async () => {
  const db = openMigrated();
  const { token, env } = await seed(db);

  const response = await itemRoute({
    request: postWith(token, { item_key: "hcpc_registration", status: "verified", reference: "RA12345" }),
    env,
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "unexpected_fields", fields: ["status"] });
  // And nothing was written. A 400 that had already run the UPDATE would be the same bug with a
  // tidier status code.
  assert.equal(itemRow(db, "cand-A", "hcpc_registration").status, "missing");
});

test("the only status this route can ever write is `submitted`", { skip }, async () => {
  const db = openMigrated();
  const { token, env } = await seed(db);

  // Every status a candidate might try to smuggle, through the one key that exists.
  for (const status of ["verified", "expiring", "expired", "missing"]) {
    const response = await itemRoute({
      request: postWith(token, { item_key: "references", reference: `two, from ${status}` , status }),
      env,
    });
    assert.equal(response.status, 400, `${status} must not be writable by a candidate`);
  }

  const ok = await itemRoute({ request: postWith(token, { item_key: "references", reference: "two supplied" }), env });
  assert.equal(ok.status, 200);
  assert.equal(itemRow(db, "cand-A", "references").status, "submitted");
});

test("the SQL the store builds binds 'submitted' as a literal, never a caller's word", { skip: false }, async () => {
  // The fake's job: prove the statement, not the outcome. `setItemState` is shared with #70 and
  // #71 and will keep its five-status vocabulary — so what this asserts is that the route's
  // literal is what reaches the bind, and that every user value is bound rather than inlined.
  const db = fakeD1([null]);
  await setItemState(db, {
    candidateId: "cand-A",
    itemKey: "hcpc_registration",
    status: "submitted",
    reference: "RA12345",
    expiryDate: "2027-03-01",
  });
  const [call] = db.calls;
  assert.match(call.sql, /UPDATE compliance_item/);
  assert.doesNotMatch(call.sql, /RA12345|cand-A|submitted/, "no user value and no status is interpolated");
  assert.deepEqual(call.args, ["submitted", "RA12345", "2027-03-01", "cand-A", "hcpc_registration"]);
});

// ── the input rules ────────────────────────────────────────────────────────────────────

test("an unknown item_key is a 400 from the route, never a 500 from the store", { skip }, async () => {
  const db = openMigrated();
  const { token, env } = await seed(db);
  for (const itemKey of ["passport_scan", "", "  ", "hcpc registration"]) {
    const response = await itemRoute({ request: postWith(token, { item_key: itemKey, reference: "x" }), env });
    assert.equal(response.status, 400, `${JSON.stringify(itemKey)} must be a caller fault`);
  }
});

test("a reference is required — an empty one is a 400 and writes nothing", { skip }, async () => {
  const db = openMigrated();
  const { token, env } = await seed(db);
  for (const reference of [undefined, "", "   "]) {
    const response = await itemRoute({
      request: postWith(token, { item_key: "hcpc_registration", reference, expiry_date: "2027-03-01" }),
      env,
    });
    assert.equal(response.status, 400);
  }
  assert.equal(itemRow(db, "cand-A", "hcpc_registration").status, "missing");
});

test("a date that is not a date is a 400, not the column's 500", { skip }, async () => {
  const db = openMigrated();
  const { token, env } = await seed(db);

  // `2026-02-30` is the one that matters: well-shaped, and V8 silently ROLLS it to 2 March. The
  // rest are the shapes a phone or a paste actually produces.
  for (const expiry of ["2026-02-30", "01/03/2026", "soon", "", "2026-13-01", "2027-3-1", "2027-03-01T00:00:00Z"]) {
    const response = await itemRoute({
      request: postWith(token, { item_key: "hcpc_registration", reference: "RA12345", expiry_date: expiry }),
      env,
    });
    assert.equal(response.status, 400, `${JSON.stringify(expiry)} must not reach the CHECK`);
  }
  assert.equal(itemRow(db, "cand-A", "hcpc_registration").status, "missing");

  const good = await itemRoute({
    request: postWith(token, { item_key: "hcpc_registration", reference: "RA12345", expiry_date: "2027-03-01" }),
    env,
  });
  assert.equal(good.status, 200);
  const row = itemRow(db, "cand-A", "hcpc_registration");
  assert.equal(row.status, "submitted");
  assert.equal(row.reference, "RA12345");
  assert.equal(row.expiry_date, "2027-03-01");
  assert.ok(row.checked_at, "the write stamps when it was last looked at");
});

test("the catalogue decides whether a date is required, in both directions", { skip }, async () => {
  const db = openMigrated();
  const { token, env } = await seed(db);

  // expires: true with no date — invisible to #70's radar, so it is refused rather than stored.
  const missingDate = await itemRoute({
    request: postWith(token, { item_key: "dbs_enhanced", reference: "001234567890" }),
    env,
  });
  assert.equal(missingDate.status, 400);

  // expires: false WITH a date — a deadline for something that has none.
  const strayDate = await itemRoute({
    request: postWith(token, { item_key: "wtr_choice", reference: "opted out", expiry_date: "2027-03-01" }),
    env,
  });
  assert.equal(strayDate.status, 400);
  assert.deepEqual(await strayDate.json(), { error: "unexpected_fields", fields: ["expiry_date"] });

  // And the non-expiring item writes a NULL expiry rather than an empty string.
  const ok = await itemRoute({ request: postWith(token, { item_key: "wtr_choice", reference: "opted out" }), env });
  assert.equal(ok.status, 200);
  assert.equal(itemRow(db, "cand-A", "wtr_choice").expiry_date, null);
});

test("re-submitting an item is idempotent, and puts a verified one back to submitted", { skip }, async () => {
  const db = openMigrated();
  const { d1, token, env } = await seed(db);
  const body = { item_key: "hcpc_registration", reference: "RA12345", expiry_date: "2027-03-01" };

  assert.equal((await itemRoute({ request: postWith(token, body), env })).status, 200);
  assert.equal((await itemRoute({ request: postWith(token, body), env })).status, 200);
  assert.equal(itemRow(db, "cand-A", "hcpc_registration").reference, "RA12345");

  // The recruiter's write (#71's, simulated through the store), then a new number from the
  // candidate. Back to `submitted` on purpose: nobody has checked the new one.
  await setItemState(d1, { candidateId: "cand-A", itemKey: "hcpc_registration", status: "verified", reference: "RA12345" });
  assert.equal((await itemRoute({ request: postWith(token, { ...body, reference: "RA99999" }), env })).status, 200);
  const row = itemRow(db, "cand-A", "hcpc_registration");
  assert.equal(row.status, "submitted");
  assert.equal(row.reference, "RA99999");
});

test("a candidate whose checklist was never seeded gets a 404, not a silent success", { skip }, async () => {
  const db = openMigrated();
  const { d1, token, env } = await seed(db);
  db.prepare("DELETE FROM compliance_item WHERE candidate_id = ?").run("cand-A");

  const response = await itemRoute({
    request: postWith(token, { item_key: "hcpc_registration", reference: "RA12345", expiry_date: "2027-03-01" }),
    env,
  });
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "not_found" });
  assert.equal(await d1.prepare("SELECT COUNT(*) AS n FROM compliance_item").bind().first("n"), 0);
});

// ── the read ───────────────────────────────────────────────────────────────────────────

test("the items route returns every catalogue item, in catalogue order, even with no row", { skip }, async () => {
  const db = openMigrated();
  const { token, env } = await seed(db);
  // A checklist that predates a catalogue addition. catalogue.js:14-16 says this is expected,
  // and a left join off the ROWS rather than off the catalogue would make the item vanish.
  db.prepare("DELETE FROM compliance_item WHERE candidate_id = ? AND item_key = ?").run("cand-A", "fit_to_work");

  const payload = await (await itemsRoute({ request: getWith(token), env })).json();
  assert.deepEqual(
    payload.items.map((item) => item.item_key),
    ITEM_KEYS,
    "catalogue order, not the store's ORDER BY item_key — that is a stable READ order",
  );
  const orphan = payload.items.find((item) => item.item_key === "fit_to_work");
  assert.deepEqual(orphan, {
    item_key: "fit_to_work",
    label: "Fit-to-work check",
    expires: true,
    amber_days: 30,
    status: "missing",
    reference: "",
    expiry_date: null,
  });
});

test("the items route joins the catalogue server-side, thresholds included", { skip }, async () => {
  const db = openMigrated();
  const { token, env } = await seed(db);
  const payload = await (await itemsRoute({ request: getWith(token), env })).json();

  for (const entry of COMPLIANCE_CATALOGUE) {
    const item = payload.items.find((i) => i.item_key === entry.key);
    assert.equal(item.label, entry.label, "the label the browser renders comes from here");
    assert.equal(item.expires, entry.expires);
    // #70's seam: the radar reads the catalogue's number rather than inventing a second.
    assert.equal(item.amber_days, entry.amberDays);
  }
});

test("the items route returns no identity of any kind", { skip }, async () => {
  const db = openMigrated();
  const { token, env } = await seed(db);
  const response = await itemsRoute({ request: getWith(token), env });
  const raw = await response.text();

  assert.deepEqual(Object.keys(JSON.parse(raw)).sort(), ["awaiting_review", "done", "items", "total"]);
  for (const value of ["cand-A", "priya@example.com", "Priya Raman", "session"]) {
    assert.ok(!raw.includes(value), `${value} reached the body — the projection widened without a decision`);
  }
  for (const item of JSON.parse(raw).items) {
    assert.deepEqual(
      Object.keys(item).sort(),
      ["amber_days", "expires", "expiry_date", "item_key", "label", "reference", "status"],
    );
  }
});

test("the counting rule: done is submitted + verified, awaiting_review is submitted alone", { skip }, async () => {
  const db = openMigrated();
  const { d1, token, env } = await seed(db);

  const empty = await (await itemsRoute({ request: getWith(token), env })).json();
  assert.equal(empty.total, COMPLIANCE_CATALOGUE.length, "the total is the catalogue's length, never a constant");
  assert.equal(empty.done, 0);
  assert.equal(empty.awaiting_review, 0);

  await setItemState(d1, { candidateId: "cand-A", itemKey: "hcpc_registration", status: "verified", reference: "RA1" });
  await setItemState(d1, { candidateId: "cand-A", itemKey: "dbs_enhanced", status: "submitted", reference: "D1" });
  await setItemState(d1, { candidateId: "cand-A", itemKey: "immunisations", status: "expiring", reference: "I1" });
  await setItemState(d1, { candidateId: "cand-A", itemKey: "indemnity", status: "expired", reference: "X1" });

  const payload = await (await itemsRoute({ request: getWith(token), env })).json();
  assert.equal(payload.done, 2, "a candidate has nothing left to do on submitted OR verified");
  assert.equal(payload.awaiting_review, 1, "and 'we have it' stays tellable apart from 'it is checked'");
});

// ── delete-now ─────────────────────────────────────────────────────────────────────────

test("delete-now erases the cage, clears the cookie and is idempotent", { skip }, async () => {
  const db = openMigrated();
  const { token, env } = await seed(db);

  const first = await deleteRoute({ request: postWith(token, {}), env });
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { ok: true, deleted: 1 });
  assert.match(first.headers.get("Set-Cookie"), /^compliance_session=; Max-Age=0; Path=\/prep\/compliance;/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM candidate").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM compliance_item").get().n, 0, "the cascade took the checklist");

  // The second press: the cookie now points at a row that is gone, so the guard answers first.
  // 401 rather than a lying 200 — and the page bounces to sign-in, which is the honest screen.
  assert.equal((await deleteRoute({ request: postWith(token, {}), env })).status, 401);
});

test("the delete route accepts no field at all", { skip }, async () => {
  const db = openMigrated();
  const { token, env } = await seed(db);
  const response = await deleteRoute({ request: postWith(token, { token: "anything" }), env });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "unexpected_fields", fields: ["token"] });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM candidate").get().n, 1, "nothing was erased");
});

// ── the guard, on every route ──────────────────────────────────────────────────────────

test("every route answers 401 with no cookie and 401 with a stale one", { skip }, async () => {
  const db = openMigrated();
  const { token, env } = await seed(db);
  const body = { item_key: "hcpc_registration", reference: "RA12345", expiry_date: "2027-03-01" };

  assert.equal((await itemsRoute({ request: getWith(null), env })).status, 401);
  assert.equal((await itemRoute({ request: postWith(null, body), env })).status, 401);
  assert.equal((await deleteRoute({ request: postWith(null, {}), env })).status, 401);

  db.prepare("UPDATE candidate SET session_expires_at = datetime('now', '-1 second') WHERE id = ?").run("cand-A");
  assert.equal((await itemsRoute({ request: getWith(token), env })).status, 401);
  assert.equal((await itemRoute({ request: postWith(token, body), env })).status, 401);
  assert.equal((await deleteRoute({ request: postWith(token, {}), env })).status, 401);
});

test("the mutating routes refuse a cross-origin POST and every route needs a binding", { skip }, async () => {
  const db = openMigrated();
  const { token, env } = await seed(db);
  const crossOrigin = {
    headers: { get: (name) => (name === "Sec-Fetch-Site" ? "cross-site" : null) },
    json: async () => ({}),
  };

  for (const route of [itemRoute, deleteRoute]) {
    assert.equal((await route({ request: crossOrigin, env })).status, 403);
  }
  // The GET deliberately has no such check: src/http.js:41-43 keeps the bolt to mutating
  // methods, or authenticated curl and every debugging session break for no gain.
  assert.equal((await itemsRoute({ request: getWith(token), env: {} })).status, 503);
  assert.equal((await itemRoute({ request: postWith(token, {}), env: {} })).status, 503);
  assert.equal((await deleteRoute({ request: postWith(token, {}), env: {} })).status, 503);
});

// ── the demo door ──────────────────────────────────────────────────────────────────────

test("the demo door is a 404 unless DEMO_MODE is set, and seeds through the real writer", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);

  assert.equal((await demoRoute({ env: { DB: d1 } })).status, 404, "ungated, this is sign-in-as-anyone");
  assert.equal((await demoRoute({ env: { DEMO_MODE: "1" } })).status, 404);

  const env = { DB: d1, DEMO_MODE: "1" };
  const first = await demoRoute({ env });
  assert.equal(first.status, 302);
  assert.equal(first.headers.get("Location"), "/prep/compliance/");
  assert.match(first.headers.get("Set-Cookie"), /^compliance_session=[^;]+; Max-Age=\d+; Path=\/prep\/compliance;/);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM compliance_item").get().n,
    ITEM_KEYS.length,
    "the checklist arrived through createCandidate, the one writer that seeds it",
  );

  // A second click must not throw on the PRIMARY KEY, and must not double the checklist.
  const second = await demoRoute({ env });
  assert.equal(second.status, 302);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM candidate").get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM compliance_item").get().n, ITEM_KEYS.length);

  // And it rotated: the first cookie is dead, exactly like any other second sign-in.
  const older = first.headers.get("Set-Cookie").slice("compliance_session=".length).split(";")[0];
  assert.equal((await itemsRoute({ request: getWith(older), env })).status, 401);
});
