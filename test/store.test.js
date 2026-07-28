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
  INVITE_EVENT_KINDS,
  NAME_MAX,
  NOTE_MAX,
  SEND_FORMATS,
  StoreError,
  VISIBILITY_KEYS_MAX,
  cleanAgencyName,
  cleanName,
  cleanNote,
  cleanRenderer,
  cleanSendFormat,
  clientWithFields,
  createClient,
  deleteClient,
  eventCounts,
  getAgency,
  getClient,
  listClients,
  listVisibleKeys,
  newClientId,
  recordEvent,
  recordInviteEvent,
  setFieldVisibility,
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
  // #17 widened events with invite delivery kinds. The list's packs count is PRD §7's
  // primary metric, and an unfiltered JOIN would silently inflate it with invites.
  assert.match(sql, /e\.kind = 'pack_generated'/, "the packs metric must not count invite events");
});

test("listClients returns an empty array rather than undefined on an empty database", async () => {
  assert.deepEqual(await listClients(fakeD1([[]])), []);
});

// ── partial updates, where a deliberate clear is easy to lose ──────────────────────────

test("updateClient with an empty note writes the empty note", async () => {
  // Four queued results, not three: since #18 a note save also reads the visibility allow-list
  // and deletes the keys the new note no longer contains. `[]` is that read coming back empty.
  const db = fakeD1([CLIENT, null, [], CLIENT]);
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

test("deleteClient checks the client exists before issuing the DELETE", async () => {
  const db = fakeD1([CLIENT, null]);
  const result = await deleteClient(db, CLIENT.id);
  // The name comes back so the screen can say what it removed.
  assert.deepEqual(result, { ok: true, name: CLIENT.name });
  const statements = db.calls.map((call) => call.sql);
  assert.match(statements[0], /^SELECT/);
  assert.match(statements[1], /^DELETE FROM clients WHERE id = \?$/);
  // The id is bound, never interpolated — same property the update path asserts.
  assert.deepEqual(db.calls[1].args, [CLIENT.id]);
});

test("deleteClient on an unknown id is not_found and issues no DELETE", async () => {
  const db = fakeD1([null]);
  assert.equal(await codeOf(() => deleteClient(db, "nope")), "not_found");
  assert.equal(db.calls.length, 1, "the DELETE must not run when the SELECT found nothing");
});

test("deleteClient issues exactly one DELETE: the events go by the schema's cascade", async () => {
  // ON DELETE CASCADE in migrations/0001_init.sql is what removes the events. A second
  // statement here would be the same fact in two places, drifting independently.
  const db = fakeD1([CLIENT, null]);
  await deleteClient(db, CLIENT.id);
  const deletes = db.calls.filter((call) => /^DELETE/.test(call.sql));
  assert.equal(deletes.length, 1);
  assert.doesNotMatch(deletes[0].sql, /events/);
});

test("getClient on an unknown id is not_found, not null", async () => {
  assert.equal(await codeOf(() => getClient(fakeD1([null]), "nope")), "not_found");
});

// ── the candidate-visibility allow-list (#18) ──────────────────────────────────────────
//
// A fourth assertion of the same kind as the three in the header: what is bound rather than
// interpolated, and — the one that matters here — what writes do NOT happen on a rejected
// request. A permission written despite a 400 is the leak this whole ticket exists to prevent,
// and it is invisible in a return value.

// A note with two headings, so a prune has something to keep and something to drop.
const TWO_SECTION_NOTE = "## Their process\n\nTwo stages.\n\n## Practical\n\nThey move fast.";
const TWO_SECTION_CLIENT = { ...CLIENT, note: TWO_SECTION_NOTE };

test("listVisibleKeys selects field_key alone, never the note and never a JOIN", async () => {
  const db = fakeD1([[{ field_key: "practical" }, { field_key: "their-process" }]]);
  const keys = await listVisibleKeys(db, CLIENT.id);
  assert.deepEqual(keys, ["practical", "their-process"]);

  const sql = db.calls[0].sql;
  assert.match(sql, /^SELECT field_key FROM note_visibility/i, "one column, from one table");
  assert.doesNotMatch(sql, /\bjoin\b/i, "a permissions read must never reach clients.note");
  assert.doesNotMatch(sql, /\bnote\b/i, "note_visibility is the table; the note column is not here");
  assert.deepEqual(db.calls[0].args, [CLIENT.id], "the id is bound, never interpolated");
});

test("listVisibleKeys on a client that has shared nothing is [], not undefined", async () => {
  assert.deepEqual(await listVisibleKeys(fakeD1([[]]), CLIENT.id), []);
});

test("setFieldVisibility inserts on true and deletes on false, with the key bound", async () => {
  const on = fakeD1([TWO_SECTION_CLIENT, null, TWO_SECTION_CLIENT, []]);
  await setFieldVisibility(on, CLIENT.id, { "their-process": true });
  const insert = on.calls.find((c) => /^INSERT/i.test(c.sql));
  assert.ok(insert, "ticking should INSERT");
  assert.match(insert.sql, /^INSERT OR IGNORE INTO note_visibility/i, "re-ticking must be a no-op");
  assert.deepEqual(insert.args, [CLIENT.id, "their-process"]);
  assert.doesNotMatch(insert.sql, /created_at/i, "the timestamp is the database's clock");

  const off = fakeD1([TWO_SECTION_CLIENT, null, TWO_SECTION_CLIENT, []]);
  await setFieldVisibility(off, CLIENT.id, { "their-process": false });
  const del = off.calls.find((c) => /^DELETE/i.test(c.sql));
  assert.ok(del, "unticking should DELETE");
  assert.deepEqual(del.args, [CLIENT.id, "their-process"]);

  // The key is agency-authored text, so it is a value and never part of the statement.
  for (const db of [on, off]) {
    for (const call of db.calls) {
      assert.ok(!call.sql.includes("their-process"), `the key reached the SQL: ${call.sql}`);
    }
  }
});

test("a field key that is not a heading in this note is rejected, and nothing is written", async () => {
  // R5: an allow-list entry for a heading that does not exist is a permission waiting for a
  // name. Write `## Salary` six months later and it would already be shared.
  const db = fakeD1([TWO_SECTION_CLIENT]);
  assert.equal(
    await codeOf(() => setFieldVisibility(db, CLIENT.id, { salary: true })),
    "unknown_field",
  );
  assert.ok(
    !db.calls.some((c) => /^(INSERT|DELETE)/i.test(c.sql)),
    "a rejected key must leave no row behind",
  );
});

test("one unknown key rejects the whole request, including the keys that were valid", async () => {
  // Validated in full before anything is written, so a half-applied permission set is not a
  // state this function can produce.
  const db = fakeD1([TWO_SECTION_CLIENT]);
  assert.equal(
    await codeOf(() => setFieldVisibility(db, CLIENT.id, { practical: true, salary: true })),
    "unknown_field",
  );
  assert.ok(!db.calls.some((c) => /^INSERT/i.test(c.sql)), "the valid key must not slip through");
});

test("a duplicated heading is unflaggable through the store, not just through the parser", async () => {
  const duplicated = { ...CLIENT, note: "## Notes\n\nfirst\n\n## Notes\n\nsecond" };
  const db = fakeD1([duplicated]);
  assert.equal(
    await codeOf(() => setFieldVisibility(db, CLIENT.id, { notes: true })),
    "unknown_field",
    "both sections carry key: null, so `notes` is not a heading this note offers",
  );
  assert.ok(!db.calls.some((c) => /^INSERT/i.test(c.sql)));
});

test("a non-boolean visibility value is refused before the client is even looked up", async () => {
  // "false" is a string and is truthy. A coerced truthy value on this path shares a section.
  for (const value of ["true", "false", 1, 0, null, undefined, [], {}]) {
    const db = fakeD1([TWO_SECTION_CLIENT]);
    assert.equal(
      await codeOf(() => setFieldVisibility(db, CLIENT.id, { practical: value })),
      "missing_fields",
      `visibility value ${JSON.stringify(value)} should be rejected`,
    );
    assert.equal(db.calls.length, 0, "the scalar is checked before anything is read or written");
  }
});

test("a visibility patch with no keys is an error, not a silent no-op", async () => {
  assert.equal(
    await codeOf(() => setFieldVisibility(fakeD1([]), CLIENT.id, {})),
    "missing_fields",
  );
});

test("more than VISIBILITY_KEYS_MAX keys in one request is too_long", async () => {
  const patch = {};
  for (let i = 0; i <= VISIBILITY_KEYS_MAX; i += 1) patch[`section-${i}`] = true;
  const db = fakeD1([TWO_SECTION_CLIENT]);
  assert.equal(await codeOf(() => setFieldVisibility(db, CLIENT.id, patch)), "too_long");
  assert.equal(db.calls.length, 0);
});

test("a __proto__ key in the visibility patch is rejected and touches no prototype", async () => {
  const db = fakeD1([TWO_SECTION_CLIENT]);
  const patch = JSON.parse('{"__proto__": true}');
  const code = await codeOf(() => setFieldVisibility(db, CLIENT.id, patch));
  // Either vocabulary is correct here — what must not happen is a write.
  assert.ok(["unknown_field", "missing_fields"].includes(code), `unexpected code ${code}`);
  assert.ok(!db.calls.some((c) => /^(INSERT|DELETE)/i.test(c.sql)));
  assert.equal({}.polluted, undefined);
});

test("setFieldVisibility on an unknown client is not_found and writes nothing", async () => {
  const db = fakeD1([null]);
  assert.equal(
    await codeOf(() => setFieldVisibility(db, "nope", { practical: true })),
    "not_found",
  );
  assert.equal(db.calls.length, 1, "the write must not run when the client does not exist");
});

test("clientWithFields returns the note's sections with their flag, and no section bodies", async () => {
  const db = fakeD1([TWO_SECTION_CLIENT, [{ field_key: "practical" }]]);
  const { client, fields } = await clientWithFields(db, CLIENT.id);

  // The client keeps exactly its existing shape — public/app.js reads this endpoint too.
  assert.deepEqual(Object.keys(client).sort(), ["created_at", "id", "name", "note", "updated_at"]);

  assert.deepEqual(fields.map((f) => f.key), ["their-process", "practical"]);
  assert.deepEqual(fields.map((f) => f.candidate_visible), [false, true]);
  for (const field of fields) {
    assert.deepEqual(Object.keys(field).sort(), ["candidate_visible", "chars", "heading", "key"]);
    assert.equal(typeof field.chars, "number");
  }
  assert.ok(
    !JSON.stringify(fields).includes("Two stages"),
    "section bodies must not ride on the wire a second time",
  );
});

test("clientWithFields marks a duplicated heading unflaggable rather than dropping it", async () => {
  const duplicated = { ...CLIENT, note: "## Notes\n\nfirst\n\n## Notes\n\nsecond" };
  const db = fakeD1([duplicated, [{ field_key: "notes" }]]);
  const { fields } = await clientWithFields(db, CLIENT.id);
  assert.equal(fields.length, 2, "the recruiter can see both in the textarea, so both are listed");
  assert.deepEqual(fields.map((f) => f.key), [null, null]);
  assert.deepEqual(
    fields.map((f) => f.candidate_visible),
    [false, false],
    "an orphan row for `notes` must not light either checkbox",
  );
});

// ── the prune: a heading that goes away takes its permission with it ────────────────────

test("saving a note deletes exactly the permissions whose headings are gone", async () => {
  // Stored {their-process, practical}; the saved note keeps only `their-process`.
  const db = fakeD1([
    CLIENT,                                                        // getClient
    null,                                                          // UPDATE clients
    [{ field_key: "practical" }, { field_key: "their-process" }],  // listVisibleKeys
    null,                                                          // DELETE practical
    CLIENT,                                                        // getClient
  ]);
  await updateClient(db, CLIENT.id, { note: "## Their process\n\nTwo stages." });

  const deletes = db.calls.filter((c) => /^DELETE FROM note_visibility/i.test(c.sql));
  assert.equal(deletes.length, 1, "exactly the stale key, and only it");
  assert.deepEqual(deletes[0].args, [CLIENT.id, "practical"]);
  assert.deepEqual(
    deletes[0].sql,
    "DELETE FROM note_visibility WHERE client_id = ? AND field_key = ?",
    "one fixed statement per key — no NOT IN list built from an uncapped heading count (R6)",
  );
});

test("clearing the note drops every permission, which is the same rule at its limit", async () => {
  const db = fakeD1([
    CLIENT,
    null,
    [{ field_key: "practical" }, { field_key: "their-process" }],
    null,
    null,
    CLIENT,
  ]);
  await updateClient(db, CLIENT.id, { note: "" });
  const deletes = db.calls.filter((c) => /^DELETE FROM note_visibility/i.test(c.sql));
  assert.deepEqual(deletes.map((d) => d.args[1]).sort(), ["practical", "their-process"]);
});

test("saving a note whose headings all survive deletes nothing", async () => {
  const db = fakeD1([CLIENT, null, [{ field_key: "their-process" }], CLIENT]);
  await updateClient(db, CLIENT.id, { note: `${TWO_SECTION_NOTE}\n\n## New\n\nbody` });
  assert.equal(db.calls.filter((c) => /^DELETE/i.test(c.sql)).length, 0);
});

test("duplicating a section drops its permission, because the key stops being produced", async () => {
  // The write-side half of R4. The parser nulls both keys, so `notes` is no longer a key this
  // note produces, so the stored row is stale and goes — which is what makes the survivor come
  // back unticked when the first copy is later deleted.
  const db = fakeD1([CLIENT, null, [{ field_key: "notes" }], null, CLIENT]);
  await updateClient(db, CLIENT.id, { note: "## Notes\n\nfirst\n\n## Notes\n\nsecond" });
  const deletes = db.calls.filter((c) => /^DELETE FROM note_visibility/i.test(c.sql));
  assert.equal(deletes.length, 1);
  assert.deepEqual(deletes[0].args, [CLIENT.id, "notes"]);
});

test("a name-only update issues neither the visibility read nor a delete", async () => {
  // Pruning is a fact about the note's headings. A rename of the client must not touch it —
  // and the fixture is the proof: three queued results, exactly as before #18.
  const db = fakeD1([CLIENT, null, CLIENT]);
  await updateClient(db, CLIENT.id, { name: "Sussex Care Partners" });
  assert.ok(
    !db.calls.some((c) => /note_visibility/i.test(c.sql)),
    "a name-only update must not read or write the allow-list",
  );
});

test("the prune runs against the CLEANED note, not the raw patch value", async () => {
  // cleanNote is what gets stored, so it is what the headings must be parsed from. Pruning
  // against a note that was never saved would drop the wrong keys.
  const db = fakeD1([CLIENT, null, [{ field_key: "practical" }], null, CLIENT]);
  await updateClient(db, CLIENT.id, { note: undefined });
  const update = db.calls.find((c) => /^UPDATE clients/i.test(c.sql));
  assert.equal(update.args[0], "", "cleanNote turns a missing note into an empty one");
  const deletes = db.calls.filter((c) => /^DELETE FROM note_visibility/i.test(c.sql));
  assert.equal(deletes.length, 1, "and the prune sees the empty note, so every key is stale");
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

test("no SQL on the whole event path mentions a name, a candidate, a cv or a note", async () => {
  const db = fakeD1([{ id: CLIENT.id }, null, { id: CLIENT.id }, null]);
  await recordEvent(db, { clientId: CLIENT.id, durationMs: 1 });
  await recordInviteEvent(db, { clientId: CLIENT.id, kind: "invite_sent" });
  await eventCounts(db);

  // EVERY call, not the ones whose SQL happens to say "events". The filter here used to be
  // /events/i.test(c.sql), which excluded recordEvent's own existence check by construction —
  // and that check was `SELECT id, name, note, … FROM clients`. The assertion's name was true
  // of the statements it looked at and false of the path it claimed to cover.
  //
  // The closed kind vocabulary ('pack_generated' et al) is stripped before matching: those
  // literals are the schema's own CHECK-locked words, not candidate data, and eventCounts
  // legitimately names them. Everything OUTSIDE that vocabulary still fails on sight.
  assert.ok(db.calls.length >= 5, "the event path should have issued the calls being checked");
  for (const call of db.calls) {
    assert.doesNotMatch(
      call.sql.replace(/'(pack_generated|invite_sent|invite_opened)'/g, "''"),
      /\bname\b|candidate|\bcv\b|\bnote\b|\bpack_|role|brief/i,
      `AC4: the counter records {client, timestamp, duration, kind} and nothing else — ${call.sql}`,
    );
  }
});

test("the event path reads the client's id and never its note", async () => {
  const db = fakeD1([{ id: CLIENT.id }, null]);
  await recordEvent(db, { clientId: CLIENT.id, durationMs: 1 });

  const select = db.calls.find((c) => /^SELECT/i.test(c.sql));
  assert.match(select.sql, /^SELECT id FROM clients/i, "an existence check needs the id alone");
});

test("recordEvent refuses an unknown client and a nonsense duration", async () => {
  assert.equal(
    await codeOf(() => recordEvent(fakeD1([null]), { clientId: "nope", durationMs: 1 })),
    "not_found",
  );
  // 1e21 passes Number.isInteger, lands as a real in an INTEGER column, and makes
  // SUM(duration_ms) permanently 1.79e308 — one row poisoning the epic's primary metric.
  for (const durationMs of [-1, 1.5, "8200", null, undefined, NaN, 1e21, Number.MAX_VALUE]) {
    assert.equal(
      await codeOf(() => recordEvent(fakeD1([{ id: CLIENT.id }, null]), { clientId: CLIENT.id, durationMs })),
      "missing_fields",
      `duration_ms ${durationMs} should be rejected`,
    );
  }
});

test("a malformed duration is named even when the client is also wrong", async () => {
  // Checking the client first reported not_found and hid the malformed field, so a caller
  // fixing one fault at a time never learned about the second.
  assert.equal(
    await codeOf(() => recordEvent(fakeD1([null]), { clientId: "nope", durationMs: -1 })),
    "missing_fields",
  );
});

test("eventCounts totals packs alone, even when invite counts are non-zero", async () => {
  const db = fakeD1([[
    { client_id: "a", packs: 6, invites_sent: 4, invites_opened: 3 },
    { client_id: "b", packs: 2, invites_sent: 9, invites_opened: 0 },
  ]]);
  const counts = await eventCounts(db);
  // 8, not 24: PRD §7's primary metric is packs generated versus submissions made, and
  // invite delivery telemetry inflating it would make the sales number a lie.
  assert.equal(counts.total, 8, "total must sum packs only, never the invite counts");
  assert.deepEqual(counts.per_client.map((r) => r.client_id), ["a", "b"]);
  assert.deepEqual(
    Object.keys(counts.per_client[0]).sort(),
    ["client_id", "invites_opened", "invites_sent", "packs"],
    "the per-client row carries the three counts and the client id, nothing else",
  );
});

test("eventCounts on an empty table is zero, not null", async () => {
  assert.deepEqual(await eventCounts(fakeD1([[]])), { total: 0, per_client: [] });
});

// ── invite delivery events, which must stay exactly as narrow as decision 3 ────────────

test("recordInviteEvent rejects an unknown or missing kind before touching the database", async () => {
  // 'pack_generated' is deliberately in the reject list: packs are recordEvent's to write,
  // and a caller reaching for this function to record one is holding the wrong tool.
  for (const kind of [undefined, null, "", "opened", "pack_generated", "invite_deleted"]) {
    const db = fakeD1([]);
    assert.equal(
      await codeOf(() => recordInviteEvent(db, { clientId: CLIENT.id, kind })),
      "missing_fields",
      `kind ${JSON.stringify(kind)} should be rejected`,
    );
    assert.equal(db.calls.length, 0, "an invalid kind must fail before any SQL is issued");
  }
});

test("recordInviteEvent binds the client and the kind, and the duration is the literal 0", async () => {
  const db = fakeD1([{ id: CLIENT.id }, null]);
  await recordInviteEvent(db, { clientId: CLIENT.id, kind: "invite_sent" });

  const insert = db.calls.find((c) => /^INSERT INTO events/i.test(c.sql));
  assert.ok(insert, "an INSERT should have been issued");
  assert.match(
    insert.sql,
    /\(client_id, duration_ms, kind\)/,
    "exactly the three columns — no invite id, no email, ever (decision 3)",
  );
  assert.deepEqual(insert.args, [CLIENT.id, "invite_sent"]);
  // The timestamp is the database's here too — same rule as recordEvent.
  assert.doesNotMatch(insert.sql, /created_at/i);
});

test("recordInviteEvent refuses an unknown client, same as recordEvent", async () => {
  assert.equal(
    await codeOf(() => recordInviteEvent(fakeD1([null]), { clientId: "nope", kind: "invite_opened" })),
    "not_found",
  );
  assert.deepEqual(INVITE_EVENT_KINDS, ["invite_sent", "invite_opened"]);
});

// ── the agency row ─────────────────────────────────────────────────────────────────────

test("a missing agency row is a broken deployment, not something to insert", async () => {
  // not_migrated, not not_configured: a missing binding and an unmigrated database are
  // different faults with different remedies, and DEPLOY.md's triage table maps them apart.
  assert.equal(await codeOf(() => getAgency(fakeD1([null]))), "not_migrated");
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

test("an over-long agency name is an error, not a silent truncation", async () => {
  // One validation vocabulary. This used to .slice(0, NAME_MAX) while cleanName called the
  // identical situation too_long, so the agency got back a name it never typed.
  assert.equal(cleanAgencyName(""), "", "the migration seeds this row with an empty name");
  assert.equal(cleanAgencyName("  Sussex Care Partners  "), "Sussex Care Partners");
  assert.equal(cleanAgencyName("a".repeat(NAME_MAX)), "a".repeat(NAME_MAX));
  assert.equal(await codeOf(() => cleanAgencyName("a".repeat(NAME_MAX + 1))), "too_long");
  assert.equal(
    await codeOf(() => updateAgency(fakeD1([AGENCY]), { name: "a".repeat(NAME_MAX + 1) })),
    "too_long",
  );
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
