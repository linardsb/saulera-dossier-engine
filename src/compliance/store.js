// The compliance cage's data lifecycle (#67). This module is the only code that deletes
// compliance data, and it only ever deletes whole candidate cages: the schema's ON DELETE
// CASCADE chain (proven table-by-table in test/schema.test.js, exercised against real SQL in
// test/compliance-purge.test.js) means each DELETE FROM candidate below takes that
// candidate's assignments and their entire checklist with it. There is no soft delete and no
// archive — spike #66 inherits portal decision 13's hard delete, and a tombstone for a lapsed
// locum is still a record that they were once vetted.
//
// What rests here is METADATA: a status word, a reference number, a date. Never a document,
// never a URL to one. That is the whole reason this epic ships without a DPIA for document
// custody, and migrations/0008_compliance.sql's column list is where it is enforced.
//
// Same contract as src/store.js and src/portal/store.js: every function takes a D1-shaped
// `db` as its first argument. No HTTP, no Response, no env. Every user value is a bound
// parameter; nothing is ever interpolated into a SQL string.

import { StoreError } from "../store.js";
import { equalHex } from "../portal/store.js";
import { COMPLIANCE_CATALOGUE, ITEM_KEYS, ITEM_STATUSES } from "./catalogue.js";

/**
 * The booking vocabulary, as `assignment.status`'s CHECK declares it.
 *
 * Exported for the same reason `DIFFICULTY` is: #69's extension radar should read this list
 * rather than invent a second one that the column would reject. Note what the purge does NOT
 * do with it — see `purgeDormant`.
 */
export const ASSIGNMENT_STATUSES = ["booked", "active", "ended", "cancelled"];

/** Every listed field, present and non-blank, or the store's own 400. */
function requireFields(values) {
  const missing = Object.entries(values)
    .filter(([, v]) => typeof v !== "string" || !v.trim())
    .map(([k]) => k);
  if (missing.length) {
    throw new StoreError("missing_fields", 400, `${missing.join(", ")}: required`);
  }
}

/**
 * A value from a closed vocabulary, or the store's own 400 BEFORE the SQL runs.
 *
 * `insertVariant`'s move, and its error code: a predictable bad input must not reach the
 * caller as a raw ERR_SQLITE_ERROR from a CHECK, because a constraint message is not an
 * answer a route can render. The code stays `missing_fields` so route error-mapping keeps one
 * branch for "the caller sent something this store will not write".
 */
function requireOneOf(field, value, allowed) {
  if (!allowed.includes(value)) {
    throw new StoreError("missing_fields", 400, `${field}: must be one of ${allowed.join(", ")}`);
  }
}

/**
 * A candidate and their whole checklist, in one call.
 *
 * The checklist is seeded HERE rather than by INSERTs in the migration: there are no existing
 * candidates to backfill, and one writer means a catalogue edit (#70 retuning an item, #68
 * adding one) reaches new candidates without a second code path to keep in step.
 *
 * Sequential single statements, and deliberately not D1's multi-statement batch API — the
 * argument src/store.js:384 makes: test/helpers/fake-d1.js does not implement batch, and
 * a store the test fake cannot drive is a store with untested SQL. D1 has no transaction
 * either, so this can half-fail and leave a candidate with a short checklist. At this layer
 * that is acceptable: `compliance_item` is UNIQUE per (candidate, item), so the heal is
 * `deleteCandidate` then a second call, and no partial state is ever mistaken for a complete
 * one — a missing row reads as an item nobody has started, which is what it is.
 *
 * `created_at` is not bound: the DDL default is the dormancy clock's only source, and a
 * caller-supplied creation date would be a caller-supplied retention date.
 *
 * @returns `{ ok: true, items }` — the checklist length, so a caller can assert the seed.
 */
export async function createCandidate(db, { id, fullName, email, phone } = {}) {
  requireFields({ id, fullName, email });
  await db
    .prepare("INSERT INTO candidate (id, full_name, email, phone) VALUES (?, ?, ?, ?)")
    .bind(id, fullName, email, String(phone ?? ""))
    .run();

  for (const item of COMPLIANCE_CATALOGUE) {
    // Two columns bound and no third. `status` opens at the DDL's 'missing' and `reference`
    // at its '' — binding a column you have no value for is how a default stops being the
    // one place that decides what an untouched checklist row looks like.
    await db
      .prepare("INSERT INTO compliance_item (candidate_id, item_key) VALUES (?, ?)")
      .bind(id, item.key)
      .run();
  }
  return { ok: true, items: ITEM_KEYS.length };
}

/**
 * Delete-now (spike #66, inheriting decision 13): the same scope the purge takes,
 * immediately, and the seam #68's candidate-facing delete button will call. Idempotent by
 * design — `{ok: true}` whether or not a row matched, because after the call the candidate's
 * compliance state is clean either way, and a not-found answer would make the delete button
 * lie to someone who pressed it twice.
 *
 * `deleted` rides alongside it because idempotent must not mean blind: a recruiter surface
 * deleting on a candidate's behalf needs to know whether it actually took a cage or was
 * looking at a stale list.
 */
export async function deleteCandidate(db, candidateId) {
  const result = await db.prepare("DELETE FROM candidate WHERE id = ?").bind(candidateId).run();
  return { ok: true, deleted: result.meta.changes ?? 0 };
}

/**
 * The retention rule as one statement (architecture, "Retention: 12-month dormancy purge"):
 * a candidate with no assignment active in the last 12 months dies, and the cascade takes the
 * assignments and the checklist. A lapsed locum needs re-verification anyway, so holding
 * their DBS state is holding health-adjacent data that has stopped being useful.
 *
 * No bound values — the boundary is the schema's own clock, never a caller's, exactly as
 * `purgeExpired`'s is. Pages has no cron, so functions/prep/_middleware.js runs this lazily
 * on every portal request and scripts/purge.py is the assurance path for a portal nobody
 * visits.
 *
 * Three rules, and the WHERE is all of them:
 *   - a candidate with no assignments at all purges 12 months after `created_at`. The spike
 *     is silent on this case; leaving a never-booked candidate immortal would be the wrong
 *     default for a cage whose whole claim is that it empties itself.
 *   - an OPEN assignment (`end_date` NULL) keeps its candidate alive at any age. A booking
 *     with no end is a live one.
 *   - any assignment that ended within 12 months keeps them alive; at exactly 12 months the
 *     `>` is false and the cage goes, which is `purgeExpired`'s `<=` boundary restated.
 *
 * Dormancy is DATE-driven and deliberately NOT status-driven. `assignment.status` is
 * human-maintained and a status and a date can disagree — a row still saying 'active' whose
 * end_date passed thirteen months ago is a stale status, and letting it extend retention
 * would make a bookkeeping error into a privacy breach. Dates are also what #69's radar
 * reads, so both answer to the same column.
 *
 * The NOT EXISTS subquery is a departure from `purgeExpired`'s single-table WHERE, and it
 * names `assignment` on purpose: `assignment` is the clock, not a child being swept. Two
 * statements (SELECT the dormant ids, then DELETE ... IN) were the alternative and were
 * rejected — one statement has no read-then-write window, and the cascade still owns every
 * child.
 */
export async function purgeDormant(db) {
  const result = await db
    .prepare(
      `DELETE FROM candidate
        WHERE datetime(created_at, '+12 months') <= datetime('now')
          AND NOT EXISTS (
                SELECT 1 FROM assignment
                 WHERE assignment.candidate_id = candidate.id
                   AND (assignment.end_date IS NULL
                        OR datetime(assignment.end_date, '+12 months') > datetime('now')))`,
    )
    .run();
  return { purged: result.meta.changes ?? 0 };
}

/**
 * One booking of one candidate at one client (#69's radar reads these dates).
 *
 * `status` is validated against the vocabulary before the INSERT so a bad value is this
 * store's 400 rather than the CHECK's raw error, and it is always bound — the INSERT names
 * the column, so the DDL default cannot apply and 'booked' is duplicated here deliberately.
 * The two must move together; test/schema.test.js locks the DDL half.
 *
 * `endDate` normalises to null: an open booking is a real state, and `undefined` reaching a
 * bind is a different bug with the same symptom.
 */
export async function createAssignment(
  db,
  { id, candidateId, clientId, startDate, endDate, status } = {},
) {
  requireFields({ id, candidateId, clientId, startDate });
  if (status !== undefined && status !== null) {
    requireOneOf("status", status, ASSIGNMENT_STATUSES);
  }
  await db
    .prepare(
      `INSERT INTO assignment (id, candidate_id, client_id, start_date, end_date, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, candidateId, clientId, startDate, endDate ?? null, status ?? "booked")
    .run();
  return { ok: true };
}

/**
 * The state of one checklist item, written by whoever verified it (#68's recruiter action,
 * #70's expiry sweep).
 *
 * Both vocabularies are checked here — the key against the catalogue, the status against the
 * column's five — so a typo answers 400 rather than a constraint failure, and an item_key
 * that is not in the catalogue never becomes a row nothing can render.
 *
 * `checked_at` is stamped from SQLite's clock rather than bound: "when was this last looked
 * at" is a fact about the write, and a caller-supplied timestamp is a caller-supplied audit
 * trail.
 *
 * @returns `{ updated }` — false when no row matched, so a route can 404 a candidate whose
 *   checklist was never seeded instead of silently reporting success.
 */
export async function setItemState(db, { candidateId, itemKey, status, reference, expiryDate } = {}) {
  requireFields({ candidateId, itemKey, status });
  requireOneOf("itemKey", itemKey, ITEM_KEYS);
  requireOneOf("status", status, ITEM_STATUSES);
  const result = await db
    .prepare(
      `UPDATE compliance_item
          SET status = ?, reference = ?, expiry_date = ?, checked_at = datetime('now')
        WHERE candidate_id = ? AND item_key = ?`,
    )
    .bind(status, String(reference ?? ""), expiryDate ?? null, candidateId, itemKey)
    .run();
  return { updated: (result.meta.changes ?? 0) === 1 };
}

/**
 * One candidate's checklist, oldest promise of this ticket: what is missing and what is about
 * to expire.
 *
 * Named columns and never `SELECT *` (briefJsonByInviteId's discipline): the row's shape is
 * decided here, so a column added later reaches a screen only when someone names it. Ordered
 * by key for a stable read; catalogue display order and labels are the caller's to apply from
 * COMPLIANCE_CATALOGUE.
 */
export async function itemsByCandidate(db, candidateId) {
  const { results } = await db
    .prepare(
      `SELECT item_key, status, reference, expiry_date, checked_at
         FROM compliance_item
        WHERE candidate_id = ?
        ORDER BY item_key`,
    )
    .bind(String(candidateId ?? ""))
    .all();
  return results ?? [];
}

// ── the cage's own door (#68) ──────────────────────────────────────────────────────────
//
// WHY THIS IS A DUPLICATE OF src/portal/store.js AND NOT A SHARED IMPLEMENTATION. The tempting
// refactor is to parameterise `issueOtp` / `consumeOtp` over a table name and a parent column
// and serve both regimes from one function. It is refused for three reasons, and this comment
// is the mitigation for the cost — a fix to the cooldown derivation now has two homes, and
// each points at the other.
//
//   1. This file's contract (line 15) is that nothing is ever interpolated into a SQL string.
//      A table name cannot be a bound parameter, so the generalised version would put a
//      string-built statement at the centre of the product's credential path.
//   2. They are not the same function. `inviteByEmail` filters expiry in the SELECT because an
//      invite dies; `candidateByEmail` must not, because a compliance record does not.
//      `rotateSession` guards on `expires_at` in the WHERE; `rotateCandidateSession` has no
//      such column to guard on. A shared implementation would need two flags on day one.
//   3. The house has already made this call and written it down: "two small duplications
//      rather than one shared risk" (functions/prep/auth/verify.js:21-23).
//
// The one thing NOT duplicated is `equalHex`, imported above: a second copy of a constant-time
// comparison is a second place for someone to simplify it back to `===`.

/**
 * The candidate an email address belongs to, for the sign-in path.
 *
 * Case-insensitive, because a locum retypes the address by hand and 'A.Patel@' is the same
 * person as 'a.patel@'. Newest first for the reason `inviteByEmail` takes the newest: a
 * duplicate is a re-registration, and the one they just gave the agency is the one they mean.
 *
 * NO EXPIRY FILTER, which is where this parts company with `inviteByEmail`. An invite dies 14
 * days after an interview, so a stale one must not be a door; a compliance record has no such
 * event and is durable by design — the 12-month dormancy purge is the only thing that removes
 * it, and a row that still exists is a row a candidate may still sign in to.
 *
 * Two columns and no third: the caller needs the id to hang a code off and the address to send
 * it to. A name here would be a name in a log line one careless template later.
 */
export async function candidateByEmail(db, email) {
  return db
    .prepare(
      `SELECT id, email
         FROM candidate
        WHERE lower(email) = lower(?)
        ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(String(email ?? ""))
    .first();
}

/**
 * Issue a sign-in code: exactly one live code per candidate. `issueOtp`'s design, at the new
 * root — read that function's comment for the full argument; the short form is here.
 *
 * The DELETE before the INSERT is the whole rate limit: requesting a new code invalidates the
 * old one, so the newest email is the one that works and a candidate mashing the button ends
 * with one usable code rather than forty.
 *
 * The cooldown is the other half. A row expires at mint + TTL, so "minted within the cooldown"
 * is `now < expires_at − (TTL − cooldown)` — no new column, and freshness implies liveness
 * because cooldown < TTL is enforced below. While a fresh code stands, a repeat request is
 * answered `{ ok: true, issued: false }` and changes nothing: the row it leaves alone is the
 * code the candidate is currently typing.
 *
 * The same two accepted assumptions as the portal's, weighed there and unchanged here: the
 * derivation uses THIS call's ttlMinutes and self-heals within one TTL if the constant moves,
 * and the read-then-act has no transaction on D1, so a burst at a window boundary can rotate
 * more than once. Neither can read a dead row as fresh.
 */
export async function issueCandidateOtp(
  db,
  { candidateId, codeHash, ttlMinutes, cooldownMinutes = 0 } = {},
) {
  requireFields({ candidateId, codeHash });
  if (!Number.isInteger(ttlMinutes) || ttlMinutes <= 0) {
    throw new StoreError("missing_fields", 400, "ttlMinutes: must be a positive integer");
  }
  if (!Number.isInteger(cooldownMinutes) || cooldownMinutes < 0 || cooldownMinutes >= ttlMinutes) {
    throw new StoreError("missing_fields", 400, "cooldownMinutes: must be an integer >= 0 and < ttlMinutes");
  }
  if (cooldownMinutes > 0) {
    const fresh = await db
      .prepare(
        `SELECT 1 AS fresh FROM candidate_otp
          WHERE candidate_id = ?
            AND datetime('now') < datetime(expires_at, '-' || ? || ' minutes')`,
      )
      .bind(candidateId, ttlMinutes - cooldownMinutes)
      .first();
    if (fresh) return { ok: true, issued: false };
  }
  await db.prepare("DELETE FROM candidate_otp WHERE candidate_id = ?").bind(candidateId).run();
  // The modifier is assembled by SQLite from a BOUND value, never templated into the
  // statement — the number is ours and not a caller's, and it stays outside the SQL text all
  // the same. The Number.isInteger guard above is what makes that concatenation produce a
  // modifier SQLite can read rather than a silent NULL.
  await db
    .prepare(
      `INSERT INTO candidate_otp (candidate_id, code_hash, expires_at)
       VALUES (?, ?, datetime('now', '+' || ? || ' minutes'))`,
    )
    .bind(candidateId, codeHash, ttlMinutes)
    .run();
  return { ok: true, issued: true };
}

/**
 * The whole verify decision, in one place so no route can get the order wrong. `consumeOtp`'s
 * arithmetic, at the new root, and it is the part most likely to be "fixed" into an off-by-one.
 *
 * The cap is checked BEFORE the comparison, and only a mismatch increments. With maxAttempts 5
 * that means five wrong guesses are each answered `invalid_code`, leaving attempts at 5, and
 * the SIXTH call is refused without comparing anything — cap reached, row deleted. Five
 * guesses allowed; the sixth is the one that 429s.
 *
 * Single-use is the DELETE on success: there is no `used` flag to check, because a flag can be
 * checked in the wrong order and a missing row cannot.
 */
export async function consumeCandidateOtp(db, { candidateId, codeHash, maxAttempts } = {}) {
  requireFields({ candidateId, codeHash });
  if (!Number.isInteger(maxAttempts) || maxAttempts <= 0) {
    throw new StoreError("missing_fields", 400, "maxAttempts: must be a positive integer");
  }

  const row = await db
    .prepare(
      `SELECT id, code_hash, attempts, datetime('now') <= datetime(expires_at) AS live
         FROM candidate_otp WHERE candidate_id = ? ORDER BY id DESC LIMIT 1`,
    )
    .bind(candidateId)
    .first();

  // No row and an expired row are the same answer on purpose. A candidate whose code timed out
  // and one who never requested a code are told the same thing — ask for a new code — and the
  // difference between them is not the candidate's to see.
  if (!row || !row.live) return { ok: false, reason: "expired" };

  if (row.attempts >= maxAttempts) {
    await db.prepare("DELETE FROM candidate_otp WHERE id = ?").bind(row.id).run();
    return { ok: false, reason: "too_many_attempts" };
  }

  if (!equalHex(String(row.code_hash), codeHash)) {
    await db.prepare("UPDATE candidate_otp SET attempts = attempts + 1 WHERE id = ?").bind(row.id).run();
    return { ok: false, reason: "invalid_code" };
  }

  await db.prepare("DELETE FROM candidate_otp WHERE id = ?").bind(row.id).run();
  return { ok: true };
}

/**
 * Mint a session in the candidate's credential column — the sign-in's second half.
 *
 * One UPDATE setting BOTH columns, because a hash without an expiry is a session that never
 * ends and an expiry without a hash is a row nothing can unlock. Writing them separately would
 * make either of those a live state between two statements D1 cannot wrap in a transaction.
 *
 * No `expires_at` guard in the WHERE, which is where this parts company with `rotateSession`:
 * the portal guards on the invite's own lifetime because an expired invite must not hand out a
 * session, and `candidate` has no such lifetime to guard on. The column being written IS the
 * session's whole clock.
 *
 * Rotating rather than adding: one credential column means a second device signing in evicts
 * the first, exactly as the portal's does. That is the decision, not a limitation — concurrent
 * devices would be a `candidate_session` table and a decision to make in the open.
 *
 * @returns `{ rotated }` — false when no row matched, so a route can answer rather than
 *   silently reporting a sign-in that never landed.
 */
export async function rotateCandidateSession(db, { candidateId, newHash, expiresAt } = {}) {
  requireFields({ candidateId, newHash, expiresAt });
  const result = await db
    .prepare("UPDATE candidate SET session_hash = ?, session_expires_at = ? WHERE id = ?")
    .bind(newHash, expiresAt, candidateId)
    .run();
  return { rotated: (result.meta?.changes ?? 0) === 1 };
}

/**
 * Who a session cookie belongs to — the read behind every guarded compliance route.
 *
 * TWO COLUMNS AND NO THIRD. Nothing downstream renders a name or an email: the passport
 * answers "what do I still owe you", and a candidate reading their own screen does not need to
 * be told who they are. A column selected in case someone needs it is how a projection widens
 * without a decision, and named columns rather than `SELECT *` is this file's rule already
 * (`itemsByCandidate`).
 *
 * It never selects `session_hash`. Nothing downstream needs it, and a hash that is never read
 * is a hash that cannot end up in a log line or an error body (`inviteByTokenHash`'s rule).
 *
 * Expiry is deliberately NOT filtered here. The row is fetched once and the caller applies its
 * own policy, for the reason src/prep/session.js:39-42 gives — here the policy is simply "no",
 * because a candidate with a stale cookie has nothing to be told apart.
 */
export async function candidateBySessionHash(db, sessionHash) {
  return db
    .prepare("SELECT id, session_expires_at FROM candidate WHERE session_hash = ?")
    .bind(String(sessionHash ?? ""))
    .first();
}
