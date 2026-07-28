// The portal's data lifecycle (#17). This module is the only code that deletes candidate
// data, and it only ever deletes whole invite scopes: the schema's ON DELETE CASCADE chain
// (proven table-by-table in test/schema.test.js) means each DELETE FROM invite below takes
// the candidate_role, competencies, questions, attempts, habits and otp codes with it.
// There is no soft delete and no archive — decision 13 says hard delete, and a tombstone
// is candidate data.
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
