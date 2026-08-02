// The client knowledge store (#5). Architecture §4: "That note is the product. The generation
// is the cheap part." This module is where that note lives.
//
// Store logic sits here rather than inside the Functions for three reasons, in order of
// weight. The test runner is `node --test` with zero dependencies, and a Function cannot be
// imported into it while a pure module can. #6 will call the store directly from Claude Code
// rather than over HTTP, because generation runs on a machine with a login and not on Pages.
// And the SQL assertions that make AC3 and AC4 testable — the list query never selects the
// note, the events insert touches no column outside the allowed four — are only expressible
// if the SQL lives somewhere importable.
//
// Every function takes a D1-shaped `db` as its first argument. No HTTP, no Response, no env.
// Every user value is a bound parameter; nothing is ever interpolated into a SQL string.

import { RENDERERS } from "./render/index.js";
import { LOCUM_FIELDS, locumFieldFor, parseNoteFields } from "./note-fields.js";

export const NAME_MAX = 120;

// A product judgement, not a platform limit: D1 allows 2 MB per string, and a bound parameter
// travels outside the statement text so the 100 KB statement cap does not apply. 100,000
// characters is roughly 15,000 words, which is a process description rather than a rolling
// interview log. If the note turns out to be the latter, this is the number to raise.
export const NOTE_MAX = 100_000;

export const SEND_FORMATS = ["email_body", "attachment", "ats_field"];

// The two invite delivery kinds (#17, decision 3). `pack_generated` is deliberately not here:
// packs are recorded by recordEvent, and the schema's DDL default writes their kind.
export const INVITE_EVENT_KINDS = ["invite_sent", "invite_opened"];

// A bound on ONE visibility request (#18). The editor sends a single key per toggle, but a
// 100,000-character note could in principle carry thousands of headings, and setFieldVisibility
// issues one statement per key. This caps the work a single request can ask for; it is not a
// cap on how many sections a client may have shared over time.
export const VISIBILITY_KEYS_MAX = 50;

/**
 * A store failure with the HTTP shape already decided, so the Function layer maps rather than
 * guesses. `code` is the lowercase snake_case vocabulary the saulera Functions established.
 */
export class StoreError extends Error {
  constructor(code, status, message) {
    super(message ?? code);
    this.name = "StoreError";
    this.code = code;
    this.status = status;
  }
}

/**
 * The client list: navigation and empty-state surface, not content.
 *
 * It deliberately returns LENGTH(note) rather than the note. The list is the screen's
 * navigation, and shipping every note in it would grow the payload without limit and put
 * personal data (§5.3: the notes name hiring managers) on a screen that does not need it.
 *
 * `packs` is the per-client event count, which is what makes PRD §7's primary metric visible
 * rather than latent. COALESCE, because a client with no events must read 0 and not null.
 */
export async function listClients(db) {
  const { results } = await db
    .prepare(
      `SELECT c.id,
              c.name,
              c.updated_at,
              LENGTH(c.note) AS note_chars,
              COALESCE(COUNT(e.id), 0) AS packs
         FROM clients c
         LEFT JOIN events e ON e.client_id = c.id AND e.kind = 'pack_generated'
        GROUP BY c.id
        ORDER BY c.name`,
    )
    .all();
  return results ?? [];
}

// ── validation ─────────────────────────────────────────────────────────────────────────
//
// The idiom is src/pack.js's: throw with the field named, so a caller reading the message
// knows what to fix. The difference is that these carry a code and a status, because the HTTP
// layer answers them rather than a developer reading a stack trace.

/** A client id. `crypto.randomUUID()` is global in the Workers runtime and on Node 20 and 24. */
export function newClientId() {
  return crypto.randomUUID();
}

export function cleanName(raw) {
  const name = String(raw ?? "").trim();
  if (!name) throw new StoreError("missing_fields", 400, "name: must not be empty");
  if (name.length > NAME_MAX) {
    throw new StoreError("too_long", 400, `name: longer than ${NAME_MAX} characters`);
  }
  return name;
}

/**
 * The agency's own name, which unlike a client's may legitimately be empty — the migration
 * seeds the row that way.
 *
 * The length rule is the same rule, and it throws rather than truncating. Truncating silently
 * stored the first 120 characters of a longer name while `cleanName` called the identical
 * situation `too_long`, which is two validation vocabularies for one concept and leaves the
 * agency looking at a name it did not type.
 */
export function cleanAgencyName(raw) {
  const name = String(raw ?? "").trim();
  if (name.length > NAME_MAX) {
    throw new StoreError("too_long", 400, `name: longer than ${NAME_MAX} characters`);
  }
  return name;
}

/**
 * The note, untouched.
 *
 * It does not trim, collapse or normalise anything. This is markdown the agency wrote, and
 * `src/provenance.js` matches verbatim quotes against it later — `normalise()` there handles
 * whitespace at comparison time, so the store must not pre-mangle the source. A missing note
 * becomes "", because a client can exist before anybody has written anything down.
 */
export function cleanNote(raw) {
  if (raw === null || raw === undefined) return "";
  const note = String(raw);
  if (note.length > NOTE_MAX) {
    throw new StoreError("too_long", 400, `note: longer than ${NOTE_MAX} characters`);
  }
  return note;
}

/**
 * Valid renderer ids come from RENDERERS, not from a literal here. When #9 adds a .docx
 * renderer it becomes valid with no migration and no change to this function.
 */
export function cleanRenderer(raw) {
  const renderer = String(raw ?? "");
  if (!Object.hasOwn(RENDERERS, renderer)) {
    throw new StoreError(
      "bad_renderer",
      400,
      `renderer: ${renderer || "(empty)"} is not one of ${Object.keys(RENDERERS).join(", ")}`,
    );
  }
  return renderer;
}

export function cleanSendFormat(raw) {
  const format = String(raw ?? "");
  if (!SEND_FORMATS.includes(format)) {
    throw new StoreError(
      "missing_fields",
      400,
      `send_format: ${format || "(empty)"} is not one of ${SEND_FORMATS.join(", ")}`,
    );
  }
  return format;
}

// ── clients ────────────────────────────────────────────────────────────────────────────

/** One client including its note. Throws `not_found` rather than returning null. */
export async function getClient(db, id) {
  const client = await db
    .prepare("SELECT id, name, note, created_at, updated_at FROM clients WHERE id = ?")
    .bind(String(id ?? ""))
    .first();
  if (!client) throw new StoreError("not_found", 404, `no client with id ${id}`);
  return client;
}

export async function createClient(db, { name, note } = {}) {
  const id = newClientId();
  await db
    .prepare("INSERT INTO clients (id, name, note) VALUES (?, ?, ?)")
    .bind(id, cleanName(name), cleanNote(note))
    .run();
  return getClient(db, id);
}

/**
 * A partial update: name, note, either, or both.
 *
 * `note: ""` is a legitimate value meaning the agency cleared the note, so presence is tested
 * with Object.hasOwn and never with truthiness. `if (patch.note)` would silently discard a
 * deliberate clear, which on the surface that *is* the product is the worst kind of bug.
 *
 * `updated_at` is set explicitly because a column default applies only on INSERT.
 *
 * Saving the note also prunes its candidate-visibility permissions (#18) — see below.
 */
export async function updateClient(db, id, patch = {}) {
  const columns = [];
  const values = [];
  let note = null; // the CLEANED note, when one is being saved — see the prune below
  // A fixed allow-list. A caller-supplied key never reaches the SQL string.
  if (Object.hasOwn(patch, "name")) {
    columns.push("name = ?");
    values.push(cleanName(patch.name));
  }
  if (Object.hasOwn(patch, "note")) {
    note = cleanNote(patch.note);
    columns.push("note = ?");
    values.push(note);
  }
  if (!columns.length) {
    throw new StoreError("missing_fields", 400, "update: nothing to change");
  }

  const client = await getClient(db, id); // 404 before writing, not after

  // A heading that no longer exists must not keep its permission (#18). Rename a section while
  // its permission is stored, retype the old name six months later, and without this the
  // section is already shared with nobody having ticked it. Clearing the note drops every
  // permission, which is the same rule at its limit.
  //
  // THE PRUNE RUNS BEFORE THE UPDATE, AND THE ORDER IS THE POINT. D1 gives this path no
  // transaction, so a failure part-way through leaves whichever statements already ran. Run the
  // UPDATE first and that half-state is: the note now has NEW headings while permissions for
  // the OLD ones survive — the armed form of the leak above, waiting for someone to retype a
  // heading. Run the prune first and the half-state is a note that still has its old headings
  // with some permissions already revoked. One direction over-shares, the other over-hides, and
  // this is a module where a bug of omission must hide.
  //
  // The behaviour change that buys: a save that fails at the UPDATE has still revoked
  // permissions for headings that are, from the recruiter's point of view, still in the note.
  // They see the save fail, their text is still on screen, and the ticks they have to re-tick
  // are the ones for sections they were editing. That is the acceptable side of this trade.
  //
  // Note this is the note-save path only. A name-only update issues neither the SELECT nor a
  // DELETE, because pruning is a fact about the note's headings.
  //
  // The prune diffs in JavaScript and deletes one bound key at a time. The obvious shape — one
  // DELETE whose WHERE clause excludes a generated `(?, ?, …)` list of surviving keys — was
  // rejected: it binds one parameter per parsed heading against D1's per-query parameter cap,
  // so a heavily-headed note would fail the save path for the product's compounding asset, on
  // the recruiter's own text. This shape is bounded by stored permissions — few, and
  // recruiter-created — and has no dynamic SQL at all, which is a stronger property than the
  // UPDATE below.
  if (note !== null) {
    const kept = new Set(parseNoteFields(note).map((f) => f.key).filter(Boolean));
    const stale = (await listVisibleKeys(db, client.id)).filter((key) => !kept.has(key));
    for (const key of stale) {
      await db
        .prepare("DELETE FROM note_visibility WHERE client_id = ? AND field_key = ?")
        .bind(client.id, key)
        .run();
    }
  }

  await db
    .prepare(`UPDATE clients SET ${columns.join(", ")}, updated_at = datetime('now') WHERE id = ?`)
    .bind(...values, client.id)
    .run();

  return getClient(db, client.id);
}

/**
 * Delete a client, its note and its events.
 *
 * The events go too, by the schema's own ON DELETE CASCADE rather than a second statement
 * here. That is deliberate about the metric: a deleted client is the agency saying this row
 * should not exist, and packs counted against a client that no longer does are a number about
 * nothing. The 404-before-write mirrors updateClient, and returning the deleted client's name
 * lets the screen say what it removed rather than a bare ok.
 */
export async function deleteClient(db, id) {
  const client = await getClient(db, id); // not_found before deleting, same as updateClient
  await db.prepare("DELETE FROM clients WHERE id = ?").bind(client.id).run();
  return { ok: true, name: client.name };
}

// ── the note's candidate-visibility allow-list ─────────────────────────────────────────
//
// #18, architecture decision 2. Presence is permission: a row in note_visibility means the
// recruiter ticked that heading, and no row means hidden. There is no boolean to invert, so an
// empty table is the fail-closed default for every note that already exists.
//
// The gate itself is src/note-fields.js's `visibleFields()`. These functions only decide what
// may be stored; nothing here renders or sends anything to a candidate.

/**
 * The heading slugs this client has shared. Deliberately narrower than getClient, in exactly
 * the spirit of requireClient below: one column, and never a JOIN to clients.
 *
 * A permissions read has no business carrying the note. The note is business-context personal
 * data naming hiring managers, and this is a path that only needs to know which strings were
 * ticked.
 */
export async function listVisibleKeys(db, clientId) {
  const { results } = await db
    .prepare("SELECT field_key FROM note_visibility WHERE client_id = ? ORDER BY field_key")
    .bind(String(clientId ?? ""))
    .all();
  return (results ?? []).map((row) => row.field_key);
}

/**
 * A client, plus what its note's sections are and which of them a candidate may see.
 *
 * The section BODY text is deliberately absent. The recruiter is reading the note in the
 * textarea two inches above this list, so a second copy of the same personal data on the wire
 * buys nothing; `chars` gives the row its "how much is in here" line instead, in the idiom of
 * clients.js's rowMeta. #22 has a real send-preview surface and can decide differently there.
 *
 * A duplicate heading keeps its `key: null` and still travels, because the recruiter can see
 * that section in the textarea — the UI has to say why it cannot be ticked rather than let it
 * silently go missing.
 *
 * `client` keeps exactly its existing shape. public/app.js reads this endpoint too: a sibling
 * key is additive, a changed `client` is not.
 */
export async function clientWithFields(db, id) {
  const client = await getClient(db, id);
  const visible = new Set(await listVisibleKeys(db, client.id));
  const fields = parseNoteFields(client.note).map((field) => ({
    key: field.key,
    heading: field.heading,
    chars: field.chars,
    candidate_visible: field.key !== null && visible.has(field.key),
  }));
  // The locum checklist (#48): which of the five named fields the SAVED note records. The
  // `match` regex never crosses the wire — only {id, heading, hint, present} does. Computed
  // here rather than in the browser because clients.js cannot import this vocabulary (no
  // build step), and this function is the one serialisation point all three API paths share.
  const present = new Set(fields.map((f) => locumFieldFor(f.heading)).filter(Boolean));
  const locum_fields = LOCUM_FIELDS.map(({ id, heading, hint }) => ({
    id, heading, hint, present: present.has(id),
  }));
  return { client, fields, locum_fields };
}

/**
 * Tick and untick sections. `patch` is `{ [field_key]: boolean }`.
 *
 * @returns the same shape as clientWithFields, so a caller always re-renders from server truth
 *   rather than from the control it just clicked.
 */
export async function setFieldVisibility(db, id, patch = {}) {
  // Object.entries, never for…in: a body of {"__proto__": true} arrives here as parsed JSON,
  // and entries sees own keys only. The `known` check below would reject it anyway — belt and
  // braces on the one function whose entire job is a permission.
  const entries = Object.entries(patch ?? {});

  if (!entries.length) {
    // The same rule as updateClient: nothing to change is an error, not a silent no-op.
    throw new StoreError("missing_fields", 400, "visibility: nothing to change");
  }
  if (entries.length > VISIBILITY_KEYS_MAX) {
    throw new StoreError(
      "too_long",
      400,
      `visibility: more than ${VISIBILITY_KEYS_MAX} keys in one request`,
    );
  }

  // Every value must be a real boolean, and this is checked before the client exists — the
  // recordEvent order, so a request that gets both wrong names the malformed field instead of
  // hiding it behind a 404. `"false"` is a string and is truthy; a coerced truthy value on this
  // path is a section shared that nobody ticked.
  for (const [key, value] of entries) {
    if (typeof value !== "boolean") {
      throw new StoreError("missing_fields", 400, `visibility: ${key} must be true or false`);
    }
  }

  const client = await getClient(db, id); // 404 before writing, as updateClient does

  // The one place the note is legitimately read on a visibility path: the keys are validated
  // against it. filter(Boolean) drops the null keys of duplicate headings, so a section whose
  // name appears twice cannot be flagged at all.
  //
  // A key that is not a current heading is rejected rather than stored, because an allow-list
  // entry for a heading that does not exist is a permission waiting for a name: write
  // `## Salary` six months later and it would already be shared.
  const known = new Set(parseNoteFields(client.note).map((f) => f.key).filter(Boolean));
  for (const [key] of entries) {
    if (!known.has(key)) {
      throw new StoreError("unknown_field", 400, `visibility: ${key} is not a heading in this note`);
    }
  }

  // Sequential single statements, and deliberately not D1's multi-statement batch API:
  // test/helpers/fake-d1.js does not implement it, and a store the test fake cannot drive is a
  // store with untested SQL.
  //
  // INSERT OR IGNORE so ticking an already-ticked section is a no-op rather than a conflict to
  // reason about. created_at keeps its DDL default: the database's clock, not the caller's.
  for (const [key, wanted] of entries) {
    const statement = wanted
      ? db.prepare("INSERT OR IGNORE INTO note_visibility (client_id, field_key) VALUES (?, ?)")
      : db.prepare("DELETE FROM note_visibility WHERE client_id = ? AND field_key = ?");
    await statement.bind(client.id, key).run();
  }

  return clientWithFields(db, client.id);
}

// ── agency ─────────────────────────────────────────────────────────────────────────────

/**
 * The one agency row. There is no create path: a missing row means the migration did not run,
 * which is a broken deployment and not something to paper over by inserting one.
 */
export async function getAgency(db) {
  const agency = await db
    .prepare("SELECT id, name, send_format, renderer, updated_at FROM agency WHERE id = 1")
    .first();
  if (!agency) {
    // Not `not_configured`: that code means the DB binding did not resolve, which is a
    // different fault with a different fix (bind it in the dashboard, versus run the
    // migration). One code for both sent DEPLOY.md's triage table to the wrong remedy half
    // the time.
    throw new StoreError(
      "not_migrated",
      503,
      "agency: no row — the migration has not run against this database",
    );
  }
  return agency;
}

export async function updateAgency(db, patch = {}) {
  const columns = [];
  const values = [];
  if (Object.hasOwn(patch, "name")) {
    columns.push("name = ?");
    values.push(cleanAgencyName(patch.name));
  }
  if (Object.hasOwn(patch, "send_format")) {
    columns.push("send_format = ?");
    values.push(cleanSendFormat(patch.send_format));
  }
  if (Object.hasOwn(patch, "renderer")) {
    columns.push("renderer = ?");
    values.push(cleanRenderer(patch.renderer));
  }
  if (!columns.length) {
    throw new StoreError("missing_fields", 400, "update: nothing to change");
  }

  await getAgency(db); // 503 before writing if the deployment is broken
  await db
    .prepare(`UPDATE agency SET ${columns.join(", ")}, updated_at = datetime('now') WHERE id = 1`)
    .bind(...values)
    .run();
  return getAgency(db);
}

// ── the event counter ──────────────────────────────────────────────────────────────────
//
// AC4: {client, timestamp, duration} and nothing else, ever. This is the sole mechanism behind
// the epic's primary metric, and #5 names it as the first thing that gets silently descoped.

/**
 * Does this client exist? Deliberately narrower than `getClient`.
 *
 * The events path needs a boolean and nothing else. `getClient` selects the whole row, so
 * recording one pack dragged up to NOTE_MAX characters of the note — business-context personal
 * data naming hiring managers — across the wire, on the one path AC4 says must never touch it.
 */
async function requireClient(db, id) {
  const found = await db
    .prepare("SELECT id FROM clients WHERE id = ?")
    .bind(String(id ?? ""))
    .first("id");
  if (!found) throw new StoreError("not_found", 404, `no client with id ${id}`);
  return found;
}

/**
 * One generation event. The timestamp is the database's, not the caller's — a caller who can
 * set the time can rewrite the metric.
 */
export async function recordEvent(db, { clientId, durationMs } = {}) {
  // The duration before the client, so a request that gets both wrong names both faults. The
  // other order reported not_found and hid the malformed field entirely.
  //
  // The upper bound is not decoration: Number.isInteger(1e21) is true, SQLite's INTEGER
  // affinity stores it as a real, and one such row makes SUM(duration_ms) permanently
  // 1.79e308 — one bad event poisoning the metric this ticket exists to create.
  if (
    !Number.isInteger(durationMs) ||
    durationMs < 0 ||
    durationMs > Number.MAX_SAFE_INTEGER
  ) {
    throw new StoreError(
      "missing_fields",
      400,
      "duration_ms: must be a non-negative integer no larger than Number.MAX_SAFE_INTEGER",
    );
  }
  await requireClient(db, clientId); // an event for an unknown client is a bug, not a row
  await db
    .prepare("INSERT INTO events (client_id, duration_ms) VALUES (?, ?)")
    .bind(String(clientId), durationMs)
    .run();
  return { ok: true };
}

/**
 * One invite delivery event — the entire invite telemetry surface (#17, decision 3). No
 * invite id, no email, ever: per-invite sent/opened state lives on `invite` and dies with
 * it, so these rows stay non-personal and the counts survive a purge. Recorded server-side
 * by #22's Send and open handlers, which import the store directly — the HTTP events
 * endpoint cannot write these, deliberately.
 *
 * Duration 0: delivery telemetry has no duration, and the column stays NOT NULL.
 */
export async function recordInviteEvent(db, { clientId, kind } = {}) {
  if (!INVITE_EVENT_KINDS.includes(kind)) {
    throw new StoreError(
      "missing_fields",
      400,
      `kind: must be one of ${INVITE_EVENT_KINDS.join(", ")}`,
    );
  }
  await requireClient(db, clientId); // an event for an unknown client is a bug, not a row
  await db
    .prepare("INSERT INTO events (client_id, duration_ms, kind) VALUES (?, 0, ?)")
    .bind(String(clientId), kind)
    .run();
  return { ok: true };
}

/**
 * The metric: how many packs were generated, in total and per client, with the invite
 * delivery counts alongside. `total` sums packs alone — PRD §7's primary metric is packs
 * generated versus submissions made, and invite telemetry must not inflate it.
 */
export async function eventCounts(db) {
  const { results } = await db
    .prepare(
      `SELECT client_id,
              COUNT(CASE WHEN kind = 'pack_generated' THEN 1 END) AS packs,
              COUNT(CASE WHEN kind = 'invite_sent'    THEN 1 END) AS invites_sent,
              COUNT(CASE WHEN kind = 'invite_opened'  THEN 1 END) AS invites_opened
         FROM events
        GROUP BY client_id`,
    )
    .all();
  const perClient = results ?? [];
  return {
    total: perClient.reduce((sum, row) => sum + row.packs, 0),
    per_client: perClient,
  };
}
