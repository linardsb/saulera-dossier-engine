// The portal's data lifecycle (#17). This module is the only code that deletes candidate
// data, and it only ever deletes whole invite scopes: the schema's ON DELETE CASCADE chain
// (proven table-by-table in test/schema.test.js) means each DELETE FROM invite below takes
// the candidate_role, competencies, questions, attempts, habits and otp codes with it.
// There is no soft delete and no archive — decision 13 says hard delete, and a tombstone
// is candidate data.
//
// #20 adds the auth statements below the lifecycle ones. They belong in the same file for
// the same reason the deletes do: `invite.token_hash` is one column, and the code that
// writes it, rotates it and reads it should be readable in one place — a credential split
// across two modules is a credential with two policies.
//
// Same contract as src/store.js: every function takes a D1-shaped `db` as its first
// argument. No HTTP, no Response, no env. Every user value is a bound parameter; nothing
// is ever interpolated into a SQL string.

import { StoreError } from "../store.js";

/**
 * SHA-256 hex of a magic-link token. Only the hash ever rests (decision 12) — the raw
 * token lives in the candidate's email and nowhere else, so a database read cannot
 * impersonate a candidate. `crypto.subtle` and `TextEncoder` are global in the Workers
 * runtime and on Node 20+; no imports, and the digest call is why this is async.
 */
export async function hashToken(token) {
  if (typeof token !== "string" || !token) {
    throw new StoreError("missing_fields", 400, "token: must be a non-empty string");
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The retention rule as one statement (decision 13): every invite whose interview is 30 or
 * more days past dies, and the cascade does the rest. No bound values — the boundary is
 * the schema's own clock, never a caller's. Pages has no cron, so functions/prep runs this
 * lazily on every portal request. That guard is a full-table scan — wrapping interview_at
 * in datetime() defeats `invite_by_interview`, and deliberately so: the schema admits
 * ISO-8601 'T' forms, which a raw string comparison against datetime('now')'s
 * space-separated format would misorder on the boundary day. Fine at invite-count scale;
 * the index is left for #22's date-ordered lookups. scripts/purge.py is the assurance
 * path for a portal nobody visits.
 */
export async function purgeExpired(db) {
  const result = await db
    .prepare("DELETE FROM invite WHERE datetime(interview_at, '+30 days') <= datetime('now')")
    .run();
  return { purged: result.meta.changes ?? 0 };
}

/**
 * Delete-now (decision 13): the same scope the purge takes, immediately. Idempotent by
 * design — `{ok: true}` whether or not a row matched, because after the call the
 * candidate's state is clean either way, and a not-found answer would make the delete
 * button lie to a candidate holding a stale link.
 */
export async function deleteInviteByTokenHash(db, tokenHash) {
  await db.prepare("DELETE FROM invite WHERE token_hash = ?").bind(tokenHash).run();
  return { ok: true };
}

// ── the auth statements (#20) ──────────────────────────────────────────────────────────
//
// One idea holds this half of the file together: the invite token ROTATES on every exchange.
// The emailed token is swapped for a freshly minted one the moment it is used, so a replayed
// link finds no matching hash. That is what makes "reused tokens rejected" and "opened_at set
// exactly once" the same structural fact rather than two guards that can disagree. It also
// keeps `invite.token_hash` the one credential column — no session table, no divergence from
// architecture §4 — and it is why decision 12 pairs the link with an email-code return: a
// single-use link needs a way back in, and that is the OTP half, not a workaround for it.

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
 * Two hex digests compared without an early return.
 *
 * A plain `===` on the hex of a HASH leaks nothing an attacker can use — they would be
 * timing their way toward a digest they cannot invert. This costs one loop over 64
 * characters and removes the argument, which is cheaper than having it again in review.
 */
function equalHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * A new invite, ready to be emailed (#20 mints, #22 sends).
 *
 * It lives here rather than in #22 so that #20's tests can seed real rows through the same
 * writer production uses, and so #22 inherits a tested one. `sent_at` is stamped now because
 * the row is created at the moment of sending — there is no draft state — and `status` opens
 * at 'sent' because 0002 deliberately left that vocabulary to this ticket.
 */
export async function createInvite(db, { id, clientId, email, interviewAt, tokenHash, expiresAt } = {}) {
  requireFields({ id, clientId, email, interviewAt, tokenHash, expiresAt });
  await db
    .prepare(
      `INSERT INTO invite (id, client_id, token_hash, email, interview_at, sent_at, expires_at, status)
       VALUES (?, ?, ?, ?, ?, datetime('now'), ?, 'sent')`,
    )
    .bind(id, clientId, tokenHash, email, interviewAt, expiresAt)
    .run();
  return { ok: true };
}

/**
 * The invite a token hash belongs to, or null.
 *
 * It never selects `token_hash`. Nothing downstream needs it, and a hash that is never read
 * is a hash that cannot end up in a log line or an error body.
 *
 * It deliberately does NOT filter on expiry. The caller decides what an expired row means,
 * and the two callers mean different things: `enter.js` needs the expired row in order to
 * tell *expired* (→ ?e=expired, "your prep has closed") apart from *forged or already used*
 * (→ ?e=invalid, "send me a code"), because openInvite collapses both into changes === 0 and
 * cannot distinguish them afterwards. `sessionFromRequest` applies its own check for the same
 * reason. One SELECT, two policies, each stated where it applies.
 */
export async function inviteByTokenHash(db, tokenHash) {
  return db
    .prepare(
      `SELECT id, client_id, email, interview_at, opened_at, expires_at, status
         FROM invite WHERE token_hash = ?`,
    )
    .bind(tokenHash)
    .first();
}

/**
 * The exchange: spend the emailed token, mint the session in its place — one statement.
 *
 * The old hash in the WHERE is the atomicity guard. Two simultaneous clicks (a mail scanner
 * and the candidate, say) both match the same row; SQLite serialises the writes, exactly one
 * UPDATE finds the old hash still there, and the loser sees changes === 0. There is no
 * read-then-write window to lose.
 *
 * COALESCE is what makes `opened_at` a first-open stamp rather than a last-seen one: the
 * second exchange cannot reach this statement at all, but the COALESCE says the intent in
 * the SQL rather than relying on that. The caller decides whether to record the
 * `invite_opened` event from the `opened_at` it read BEFORE calling — after this returns,
 * the row can no longer tell you whether this call was the first.
 */
export async function openInvite(db, { oldHash, newHash } = {}) {
  requireFields({ oldHash, newHash });
  const result = await db
    .prepare(
      `UPDATE invite
          SET token_hash = ?,
              status     = 'opened',
              opened_at  = COALESCE(opened_at, datetime('now'))
        WHERE token_hash = ?
          AND datetime('now') <= datetime(expires_at)`,
    )
    .bind(newHash, oldHash)
    .run();
  return { rotated: (result.meta?.changes ?? 0) === 1 };
}

/**
 * Rotate the session token for an invite already known to be the candidate's — the OTP
 * path's half of the exchange.
 *
 * It deliberately touches neither `opened_at` nor `status`. A returning login is not a new
 * open: decision 23's sales claim counts invites opened, and it must not inflate every time
 * a candidate signs back in from a second device.
 */
export async function rotateSession(db, { inviteId, newHash } = {}) {
  requireFields({ inviteId, newHash });
  const result = await db
    .prepare(
      `UPDATE invite SET token_hash = ?
        WHERE id = ? AND datetime('now') <= datetime(expires_at)`,
    )
    .bind(newHash, inviteId)
    .run();
  return { rotated: (result.meta?.changes ?? 0) === 1 };
}

/**
 * The live invite an email address belongs to, for the returning-login path.
 *
 * Case-insensitive, because a candidate retypes the address by hand and 'A.Patel@' is the
 * same person as 'a.patel@'. LIMIT 1 on the newest, because one candidate may hold several
 * live invites from the same agency and the one they just received is the one they mean.
 * `sent_at` has one-second resolution, so two invites written in the same tick tie and either
 * may be returned — left undefined deliberately: same-second duplicates for one address are a
 * double-clicked Send, and the two rows are interchangeable to the candidate holding them.
 * Expiry is filtered HERE, unlike inviteByTokenHash: there is nothing to explain to the
 * candidate either way — /prep/auth/otp answers 202 whether or not a row came back, so that
 * the endpoint cannot be used to enumerate an agency's candidate list.
 */
export async function inviteByEmail(db, email) {
  return db
    .prepare(
      `SELECT id, client_id, email, expires_at
         FROM invite
        WHERE lower(email) = lower(?)
          AND datetime('now') <= datetime(expires_at)
        ORDER BY sent_at DESC LIMIT 1`,
    )
    .bind(String(email ?? ""))
    .first();
}

/**
 * Issue a returning-login code: exactly one live code per invite.
 *
 * The DELETE before the INSERT is the whole rate-limit design. Requesting a new code
 * invalidates the old one, which is both the least surprising behaviour (the newest email is
 * the one that works) and a free cap on how many codes can be outstanding — a candidate
 * mashing "send me a code" ends with one usable code, not forty.
 */
export async function issueOtp(db, { inviteId, codeHash, ttlMinutes } = {}) {
  requireFields({ inviteId, codeHash });
  if (!Number.isInteger(ttlMinutes) || ttlMinutes <= 0) {
    throw new StoreError("missing_fields", 400, "ttlMinutes: must be a positive integer");
  }
  await db.prepare("DELETE FROM otp WHERE invite_id = ?").bind(inviteId).run();
  // The modifier is assembled by SQLite from a BOUND value, never templated into the
  // statement — `'+' || ? || ' minutes'` keeps the number outside the SQL text even though
  // it is ours and not a caller's. The Number.isInteger guard above is what makes that
  // concatenation produce a modifier SQLite can read rather than a silent NULL.
  await db
    .prepare(
      `INSERT INTO otp (invite_id, code_hash, expires_at)
       VALUES (?, ?, datetime('now', '+' || ? || ' minutes'))`,
    )
    .bind(inviteId, codeHash, ttlMinutes)
    .run();
  return { ok: true };
}

/**
 * The whole verify decision, in one place so no route can get the order wrong.
 *
 * The arithmetic is load-bearing and is the thing most likely to be "fixed" into an
 * off-by-one. The cap is checked BEFORE the comparison, and only a mismatch increments. With
 * maxAttempts 5 that means five wrong guesses are each answered `invalid_code`, leaving
 * attempts at 5, and the SIXTH call is refused without comparing anything — cap reached, row
 * deleted. Five guesses allowed; the sixth is the one that 429s.
 *
 * Single-use is the DELETE on success: there is no `used` flag to check, because a flag can
 * be checked in the wrong order and a missing row cannot.
 */
export async function consumeOtp(db, { inviteId, codeHash, maxAttempts } = {}) {
  requireFields({ inviteId, codeHash });
  if (!Number.isInteger(maxAttempts) || maxAttempts <= 0) {
    throw new StoreError("missing_fields", 400, "maxAttempts: must be a positive integer");
  }

  const row = await db
    .prepare(
      `SELECT id, code_hash, attempts, datetime('now') <= datetime(expires_at) AS live
         FROM otp WHERE invite_id = ? ORDER BY id DESC LIMIT 1`,
    )
    .bind(inviteId)
    .first();

  // No row and an expired row are the same answer on purpose. A candidate whose code timed
  // out and one who never requested a code are told the same thing — ask for a new code —
  // and the difference between them is not the candidate's to see.
  if (!row || !row.live) return { ok: false, reason: "expired" };

  if (row.attempts >= maxAttempts) {
    await db.prepare("DELETE FROM otp WHERE id = ?").bind(row.id).run();
    return { ok: false, reason: "too_many_attempts" };
  }

  if (!equalHex(String(row.code_hash), codeHash)) {
    await db.prepare("UPDATE otp SET attempts = attempts + 1 WHERE id = ?").bind(row.id).run();
    return { ok: false, reason: "invalid_code" };
  }

  await db.prepare("DELETE FROM otp WHERE id = ?").bind(row.id).run();
  return { ok: true };
}
