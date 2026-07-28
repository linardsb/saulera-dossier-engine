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

export const NAME_MAX = 120;

// A product judgement, not a platform limit: D1 allows 2 MB per string, and a bound parameter
// travels outside the statement text so the 100 KB statement cap does not apply. 100,000
// characters is roughly 15,000 words, which is a process description rather than a rolling
// interview log. If the note turns out to be the latter, this is the number to raise.
export const NOTE_MAX = 100_000;

export const SEND_FORMATS = ["email_body", "attachment", "ats_field"];

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
         LEFT JOIN events e ON e.client_id = c.id
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
 */
export async function updateClient(db, id, patch = {}) {
  const columns = [];
  const values = [];
  // A fixed allow-list. A caller-supplied key never reaches the SQL string.
  if (Object.hasOwn(patch, "name")) {
    columns.push("name = ?");
    values.push(cleanName(patch.name));
  }
  if (Object.hasOwn(patch, "note")) {
    columns.push("note = ?");
    values.push(cleanNote(patch.note));
  }
  if (!columns.length) {
    throw new StoreError("missing_fields", 400, "update: nothing to change");
  }

  const client = await getClient(db, id); // 404 before writing, not after
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

/** The metric: how many packs were generated, in total and per client. */
export async function eventCounts(db) {
  const { results } = await db
    .prepare(
      `SELECT client_id, COUNT(*) AS packs
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
