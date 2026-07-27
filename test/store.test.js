// #5 — the store's own test suite.
//
// `schema.test.js` proves the shape of the tables. This file proves the shape of the SQL and
// the validation, and its bias is the same as `provenance.test.js`': toward the cases that
// would let something through, not the ones that confirm the happy path.
//
// Three of the assertions here are security or boundary properties rather than behaviour, and
// they are asserted against the recorded SQL rather than against a query result, because that
// is the only place they are visible:
//
//   - no user value ever reaches the SQL string (injection)
//   - the list query never selects the note column (personal data on a navigation surface)
//   - the events insert touches nothing outside {client_id, duration_ms} (AC4)

import { test } from "node:test";
import assert from "node:assert/strict";

import { fakeD1 } from "./helpers/fake-d1.js";
import {
  NAME_MAX,
  NOTE_MAX,
  SEND_FORMATS,
  StoreError,
  cleanName,
  cleanNote,
  cleanRenderer,
  cleanSendFormat,
  createClient,
  eventCounts,
  getAgency,
  getClient,
  listClients,
  newClientId,
  recordEvent,
  updateAgency,
  updateClient,
} from "../src/store.js";
import { RENDERERS } from "../src/render/index.js";

const CLIENT = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Ashdown Park Community Healthcare",
  note: "## Their process\n\nTwo stages.",
  created_at: "2026-07-27 10:00:00",
  updated_at: "2026-07-27 10:00:00",
};

const AGENCY = {
  id: 1,
  name: "",
  send_format: "email_body",
  renderer: "appendix",
  updated_at: "2026-07-27 10:00:00",
};

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

// ── validation ─────────────────────────────────────────────────────────────────────────

test("cleanName rejects empty and whitespace-only, keeps interior spaces", async () => {
  assert.equal(await codeOf(() => cleanName("")), "missing_fields");
  assert.equal(await codeOf(() => cleanName("   ")), "missing_fields");
  assert.equal(await codeOf(() => cleanName(null)), "missing_fields");
  assert.equal(cleanName("  Ashdown Park Community Healthcare  "), "Ashdown Park Community Healthcare");
  assert.equal(cleanName("a".repeat(NAME_MAX)), "a".repeat(NAME_MAX));
  assert.equal(await codeOf(() => cleanName("a".repeat(NAME_MAX + 1))), "too_long");
});

test("cleanNote treats a missing note as empty and a long one as an error", async () => {
  assert.equal(cleanNote(null), "");
  assert.equal(cleanNote(undefined), "");
  assert.equal(cleanNote(""), "");
  assert.equal(cleanNote("x".repeat(NOTE_MAX)).length, NOTE_MAX);
  assert.equal(await codeOf(() => cleanNote("x".repeat(NOTE_MAX + 1))), "too_long");
});

test("cleanNote round-trips a note byte-identical", () => {
  // Leading spaces, a blank line, trailing spaces, a trailing newline, a curly quote. All of it
  // has to survive: src/provenance.js matches verbatim quotes against this text later, and
  // normalise() there is what handles whitespace — at comparison time, not in the store.
  const messy = "  ## Their process\n\nTwo stages.  \n\n\nThe trust’s panel.   \n";
  assert.equal(cleanNote(messy), messy);
});

test("cleanRenderer follows RENDERERS, so #9's .docx needs no change here", async () => {
  for (const id of Object.keys(RENDERERS)) assert.equal(cleanRenderer(id), id);
  assert.equal(await codeOf(() => cleanRenderer("docx")), "bad_renderer");
  assert.equal(await codeOf(() => cleanRenderer("")), "bad_renderer");
  assert.equal(await codeOf(() => cleanRenderer(null)), "bad_renderer");
});

test("cleanSendFormat accepts the three formats and nothing else", async () => {
  for (const f of SEND_FORMATS) assert.equal(cleanSendFormat(f), f);
  assert.equal(await codeOf(() => cleanSendFormat("carrier_pigeon")), "missing_fields");
});

test("newClientId is a uuid and does not repeat", () => {
  const id = newClientId();
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.notEqual(newClientId(), newClientId());
});

// ── the list query, which must not carry the note ──────────────────────────────────────

test("listClients selects LENGTH(note) and never the note itself", async () => {
  const db = fakeD1([[{ id: CLIENT.id, name: CLIENT.name, note_chars: 1650, packs: 0 }]]);
  const rows = await listClients(db);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].packs, 0);
  assert.ok(!("note" in rows[0]), "the list must not carry note text");

  const sql = db.calls[0].sql;
  assert.match(sql, /LENGTH\(\s*c\.note\s*\)/i, "the list reports the note's length");
  assert.doesNotMatch(
    sql.replace(/LENGTH\([^)]*\)/gi, ""),
    /\bc?\.?note\b/i,
    "the bare note column must not appear outside LENGTH()",
  );
});

test("listClients returns an empty array rather than undefined on an empty database", async () => {
  assert.deepEqual(await listClients(fakeD1([[]])), []);
});

// ── partial updates, where a deliberate clear is easy to lose ──────────────────────────

test("updateClient with an empty note writes the empty note", async () => {
  const db = fakeD1([CLIENT, null, CLIENT]);
  await updateClient(db, CLIENT.id, { note: "" });

  const update = db.calls.find((c) => /^UPDATE clients/i.test(c.sql));
  assert.ok(update, "an UPDATE should have been issued");
  assert.match(update.sql, /note = \?/);
  assert.equal(update.args[0], "", "the empty note is bound, not dropped as falsy");
});

test("updateClient without a note issues no note write at all", async () => {
  const db = fakeD1([CLIENT, null, CLIENT]);
  await updateClient(db, CLIENT.id, { name: "Sussex Care Partners" });

  const update = db.calls.find((c) => /^UPDATE clients/i.test(c.sql));
  assert.doesNotMatch(update.sql, /note/i, "a name-only update must not touch the note");
  assert.match(update.sql, /updated_at = datetime\('now'\)/i, "a default applies only on INSERT");
});

test("updateClient with nothing to change is an error, not a silent no-op", async () => {
  assert.equal(await codeOf(() => updateClient(fakeD1([CLIENT]), CLIENT.id, {})), "missing_fields");
});

test("getClient on an unknown id is not_found, not null", async () => {
  assert.equal(await codeOf(() => getClient(fakeD1([null]), "nope")), "not_found");
});

// ── injection ──────────────────────────────────────────────────────────────────────────

test("a client name that is a SQL payload is bound, never interpolated", async () => {
  const payload = "Robert'); DROP TABLE clients;--";

  const create = fakeD1([null, { ...CLIENT, name: payload }]);
  await createClient(create, { name: payload });

  const update = fakeD1([CLIENT, null, { ...CLIENT, name: payload }]);
  await updateClient(update, CLIENT.id, { name: payload });

  for (const db of [create, update]) {
    for (const call of db.calls) {
      assert.doesNotMatch(call.sql, /DROP/i, `SQL carried the payload: ${call.sql}`);
      assert.ok(!call.sql.includes(payload), `SQL carried the payload: ${call.sql}`);
    }
    assert.ok(
      db.calls.some((c) => c.args.includes(payload)),
      "the payload should travel as a bound parameter",
    );
  }
});

// ── the event counter, which is the boundary ───────────────────────────────────────────

test("recordEvent binds the client and the duration and nothing else", async () => {
  const db = fakeD1([CLIENT, null]);
  await recordEvent(db, { clientId: CLIENT.id, durationMs: 8200 });

  const insert = db.calls.find((c) => /^INSERT INTO events/i.test(c.sql));
  assert.ok(insert, "an INSERT should have been issued");
  assert.deepEqual(insert.args, [CLIENT.id, 8200]);
  // The timestamp is the database's. A caller who can set the time can rewrite the metric.
  assert.doesNotMatch(insert.sql, /created_at/i);
});

test("no events SQL mentions a name, a candidate, a cv or a note", async () => {
  const db = fakeD1([CLIENT, null]);
  await recordEvent(db, { clientId: CLIENT.id, durationMs: 1 });
  await eventCounts(db);

  for (const call of db.calls.filter((c) => /events/i.test(c.sql))) {
    assert.doesNotMatch(
      call.sql,
      /\bname\b|candidate|\bcv\b|\bnote\b|\bpack_|role|brief/i,
      `AC4: the counter records {client, timestamp, duration} and nothing else — ${call.sql}`,
    );
  }
});

test("recordEvent refuses an unknown client and a nonsense duration", async () => {
  assert.equal(
    await codeOf(() => recordEvent(fakeD1([null]), { clientId: "nope", durationMs: 1 })),
    "not_found",
  );
  for (const durationMs of [-1, 1.5, "8200", null, undefined, NaN]) {
    assert.equal(
      await codeOf(() => recordEvent(fakeD1([CLIENT, null]), { clientId: CLIENT.id, durationMs })),
      "missing_fields",
      `duration_ms ${durationMs} should be rejected`,
    );
  }
});

test("eventCounts totals the per-client rows", async () => {
  const db = fakeD1([[{ client_id: "a", packs: 6 }, { client_id: "b", packs: 2 }]]);
  const counts = await eventCounts(db);
  assert.equal(counts.total, 8);
  assert.deepEqual(counts.per_client.map((r) => r.client_id), ["a", "b"]);
});

test("eventCounts on an empty table is zero, not null", async () => {
  assert.deepEqual(await eventCounts(fakeD1([[]])), { total: 0, per_client: [] });
});

// ── the agency row ─────────────────────────────────────────────────────────────────────

test("a missing agency row is a broken deployment, not something to insert", async () => {
  assert.equal(await codeOf(() => getAgency(fakeD1([null]))), "not_configured");
  const db = fakeD1([null]);
  await codeOf(() => getAgency(db));
  assert.ok(
    !db.calls.some((c) => /^INSERT INTO agency/i.test(c.sql)),
    "silently creating the row would hide a migration that did not run",
  );
});

test("updateAgency validates the renderer and the send format before writing", async () => {
  assert.equal(
    await codeOf(() => updateAgency(fakeD1([AGENCY]), { renderer: "docx" })),
    "bad_renderer",
  );
  assert.equal(
    await codeOf(() => updateAgency(fakeD1([AGENCY]), { send_format: "fax" })),
    "missing_fields",
  );

  const db = fakeD1([AGENCY, null, { ...AGENCY, renderer: "inline" }]);
  await updateAgency(db, { renderer: "inline" });
  const update = db.calls.find((c) => /^UPDATE agency/i.test(c.sql));
  assert.match(update.sql, /renderer = \?/);
  assert.equal(update.args[0], "inline");
});

test("the agency row carries no branding column (Decision 6)", async () => {
  const db = fakeD1([AGENCY]);
  await getAgency(db);
  assert.doesNotMatch(
    db.calls[0].sql,
    /colour|color|logo|brand|font/i,
    "branding lives in public/tokens.css, because it has to apply before first paint",
  );
});
