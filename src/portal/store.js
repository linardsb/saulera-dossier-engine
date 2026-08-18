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
 *
 * `deleted` rides alongside it because idempotent must not mean blind. #20's rotation made
 * a present-but-stale credential ordinary — signing in on a second device rotates the
 * first device's cookie out — so the caller can hold two tokens and needs to know whether
 * the first one it tried matched anything before it decides about the second. The answer
 * stays `{ok: true}` at zero; the count is what makes that decision possible.
 */
export async function deleteInviteByTokenHash(db, tokenHash) {
  const result = await db.prepare("DELETE FROM invite WHERE token_hash = ?").bind(tokenHash).run();
  return { ok: true, deleted: result.meta.changes ?? 0 };
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
 *
 * Exported for #68's `consumeCandidateOtp`, which duplicates this file's OTP SQL deliberately
 * (a table name cannot be a bound parameter) but must NOT duplicate this: a second copy of a
 * constant-time comparison is a second place for someone to "simplify" it back to `===`. The
 * precedent is src/prep/tokens.js importing `hashToken` from here — pure helpers cross the
 * regime boundary, SQL does not.
 */
export function equalHex(a, b) {
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
 *
 * `sendKey` (#34) is the send's idempotency key, optional so every pre-#34 caller and every
 * key-less browser keeps today's behaviour (NULL, which the UNIQUE index ignores). When a key
 * is passed and already stands, the INSERT throws on `invite_send_key` — deliberately: the
 * route reads that constraint as "the earlier send fully succeeded" and answers 409, because
 * a rolled-back send frees its key when the rollback deletes the row.
 */
export async function createInvite(db, { id, clientId, email, interviewAt, tokenHash, expiresAt, sendKey } = {}) {
  requireFields({ id, clientId, email, interviewAt, tokenHash, expiresAt });
  await db
    .prepare(
      `INSERT INTO invite (id, client_id, token_hash, email, interview_at, sent_at, expires_at, status, send_key)
       VALUES (?, ?, ?, ?, ?, datetime('now'), ?, 'sent', ?)`,
    )
    .bind(id, clientId, tokenHash, email, interviewAt, expiresAt, sendKey ?? null)
    .run();
  return { ok: true };
}

// ── the handover (#22) ─────────────────────────────────────────────────────────────────
//
// What Send persists once the invite row exists: the privileged inputs (decision 14 — the CV
// travels, and dies with the same purge), the composed brief, and the core question bank
// decision 6 caches here so #23 never pays for it again.
//
// It is written AFTER the invite deliberately. There is no transaction available, so the
// rollback is `deleteInviteByTokenHash` and the cascade — which only works if the invite is
// the thing already standing. See the failure ordering in functions/api/prep/send.js.

/**
 * The payload's difficulty vocabulary, as the column's.
 *
 * #19's schema calls difficulty `gentle|standard|probing` (src/prep/schema.js:309) and 0002
 * declares the column INTEGER. This is not tidiness: SQLite type affinity does not REJECT a
 * string in an INTEGER column — it stores `'standard'` as text, silently, and nothing fails
 * until #23 runs `ORDER BY difficulty` and gets a text sort over a column every reader
 * believes is numeric. Same class of trap as mintOtpCode's note about `Number('000123')`.
 *
 * Exported so #23 reads the same map rather than inventing a second one.
 */
export const DIFFICULTY = { gentle: 1, standard: 2, probing: 3 };

/**
 * The whole handover for one invite: the role row, its competencies, and their questions.
 *
 * Sequential single statements, and deliberately not D1's multi-statement batch API — the
 * argument src/store.js:376-379 makes: test/helpers/fake-d1.js does not implement batch, and
 * a store the test fake cannot drive is a store with untested SQL.
 *
 * `candidate_role.invite_id` is UNIQUE, so a second call for one invite fails loudly. That is
 * right: two handovers for one invite would mean two briefs behind one link.
 *
 * @returns `{ roleId, competencies, questions }` — the counts, so a caller can assert.
 */
export async function persistHandover(
  db,
  { inviteId, jdText, ethosText, cvText, payload } = {},
) {
  requireFields({ inviteId });
  const roleId = crypto.randomUUID();

  await db
    .prepare(
      `INSERT INTO candidate_role (id, invite_id, jd_text, ethos_text, cv_text, brief_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      roleId,
      inviteId,
      String(jdText ?? ""),
      String(ethosText ?? ""),
      String(cvText ?? ""),
      JSON.stringify(payload ?? {}),
    )
    .run();

  const competencies = payload?.competencies ?? [];
  const questions = payload?.questions ?? [];
  let questionCount = 0;

  for (const competency of competencies) {
    // R2 — THE PRIMARY KEY COLLISION, and the subtlest thing in this ticket.
    //
    // `competency.id` is TEXT PRIMARY KEY and the payload's ids are MODEL-CHOSEN SLUGS
    // ('stakeholder-management'). The first candidate for a client works. The second
    // candidate for the same client, with a similar brief, produces the same slug — and the
    // insert fails on a constraint, in production, on the recruiter's second-ever Send.
    // test/helpers/fake-d1.js returns `{changes: 1}` and enforces nothing, so a suite built
    // on it passes while this is broken; test/prep-send.test.js proves it on node:sqlite.
    //
    // `roleId` is a UUID and contains no colon, so the join is unambiguous and #23 can derive
    // the row id from `candidate_role.id` plus the payload it reads.
    const competencyRowId = `${roleId}:${competency.id}`;

    await db
      .prepare(
        `INSERT INTO competency (id, role_id, label, source_quote, importance)
         VALUES (?, ?, ?, ?, ?)`,
      )
      // `stage` and `success_rate` are left to their DDL defaults: this ticket does not own
      // them, and binding a column you have no value for is how a default quietly stops being
      // the one place that decides.
      //
      // `importance` is bound to the SCHEMA'S OWN VOCABULARY — integer 1..5 — and not merely to
      // "a finite number". This is the trap DIFFICULTY above describes, one bind along: the
      // column is INTEGER and SQLite affinity does not reject what does not fit it. `2.5` and
      // `1e21` both store as REAL, and `"3"` fails Number.isFinite and lands as 0, which is a
      // LOST score rather than a visible error. `assertBrief` cannot help here — the enum lives
      // in BRIEF_SCHEMA, enforced by the decoder at request time, which the browser round trip
      // does not go through.
      .bind(
        competencyRowId,
        roleId,
        String(competency.label ?? ""),
        String(competency.source_quote ?? ""),
        Number.isInteger(competency.importance) &&
          competency.importance >= 1 &&
          competency.importance <= 5
          ? competency.importance
          : 0,
      )
      .run();

    const mine = questions.filter((q) => q.competency_id === competency.id);
    for (const [index, question] of mine.entries()) {
      await db
        .prepare(
          `INSERT INTO question (id, competency_id, text, axis, difficulty)
           VALUES (?, ?, ?, ?, ?)`,
        )
        // R3 — `axis` is NULL, NOT 'core'.
        //
        // The column carries CHECK (axis IN ('lateral','vertical')) and 'core' is not in it:
        // 0002 deliberately reserves that column for #23's variants, and the core bank is the
        // rows with a NULL axis and no variant_of. NULL is storable because `NULL IN (…)`
        // evaluates to NULL, and A CHECK THAT EVALUATES TO NULL IS NOT A VIOLATION. That
        // parenthetical is here on purpose: without it the next reader assumes this got lucky
        // and "fixes" it to 'core', which fails at insert on the recruiter's first Send.
        //
        // `difficulty` goes through DIFFICULTY above — see the note there for why the map is
        // correctness rather than neatness.
        .bind(
          `${competencyRowId}#${index}`,
          competencyRowId,
          String(question.text ?? ""),
          null,
          DIFFICULTY[question.difficulty] ?? null,
        )
        .run();
      questionCount += 1;
    }
  }

  return { roleId, competencies: competencies.length, questions: questionCount };
}

/**
 * The stored brief for an invite, as raw JSON text — or null.
 *
 * ONE COLUMN, and never `SELECT *`. `cv_text`, `jd_text` and `ethos_text` live in the same row
 * and have no business in a response headed for a browser: the CV is the candidate's own, but
 * the ethos text is the agency's private read on a client, filtered once already by #18's
 * gate, and re-serving it whole would undo that filter in one line. This is
 * `listVisibleKeys`'s stated discipline (src/store.js:283-289) applied to the portal's most
 * sensitive row.
 */
export async function briefJsonByInviteId(db, inviteId) {
  return db
    .prepare("SELECT brief_json FROM candidate_role WHERE invite_id = ?")
    .bind(String(inviteId ?? ""))
    .first("brief_json");
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
 *
 * The cooldown (#31) is the other half of that design, added when the route went public: the
 * DELETE bounds how many codes are valid at once, not how many are issued, and a fresh row
 * resets `attempts`. While a code minted less than `cooldownMinutes` ago is standing, a repeat
 * request is answered `{ ok: true, issued: false }` and changes nothing — the row it leaves
 * alone is the code the candidate is currently typing, which is the point.
 */
export async function issueOtp(db, { inviteId, codeHash, ttlMinutes, cooldownMinutes = 0 } = {}) {
  requireFields({ inviteId, codeHash });
  if (!Number.isInteger(ttlMinutes) || ttlMinutes <= 0) {
    throw new StoreError("missing_fields", 400, "ttlMinutes: must be a positive integer");
  }
  if (!Number.isInteger(cooldownMinutes) || cooldownMinutes < 0 || cooldownMinutes >= ttlMinutes) {
    throw new StoreError("missing_fields", 400, "cooldownMinutes: must be an integer >= 0 and < ttlMinutes");
  }
  if (cooldownMinutes > 0) {
    // The mint time is derivable — a row expires at mint + TTL, so "minted within the
    // cooldown" is `now < expires_at − (TTL − cooldown)`. No new column, and freshness
    // implies liveness because cooldown < TTL is enforced above. The bound is precomputed
    // to one integer for the same reason the TTL below is bound, not templated.
    //
    // Two accepted assumptions, weighed on review (PR #41):
    // - The derivation uses THIS call's ttlMinutes, so a row minted under a different TTL
    //   (i.e. OTP_TTL_MINUTES changed between deploys) gets a skewed window for up to one
    //   TTL, then self-heals. It can never read a dead row as fresh — the bound is always
    //   earlier than expires_at — so the skew delays or skips a coalesce, nothing worse.
    // - This is a read-then-act with no transaction on D1, unlike openInvite's single
    //   statement: parallel requests at a window boundary can each see no fresh row and all
    //   rotate. The burst is bounded by concurrency, the newest email still holds the live
    //   code, and the next window coalesces again — accepted over a WHERE-guarded DELETE
    //   dance that would obscure the one decision this comment exists to explain.
    const fresh = await db
      .prepare(
        `SELECT 1 AS fresh FROM otp
          WHERE invite_id = ?
            AND datetime('now') < datetime(expires_at, '-' || ? || ' minutes')`,
      )
      .bind(inviteId, ttlMinutes - cooldownMinutes)
      .first();
    if (fresh) return { ok: true, issued: false };
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
  return { ok: true, issued: true };
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

// ── the session engine (#23) ───────────────────────────────────────────────────────────
//
// Reads and writes for the drill: everything the targeting/ladder/habits modules consume
// arrives through here, already shaped (numeric difficulty, oldest-first attempts), and
// everything the engine decides lands through here. No D1 batch, for the reason
// src/store.js:376-379 gives: the test fake cannot drive it. There is no transaction on
// D1/Pages either — the callers order their writes so a crash leaves a stale CACHE, never
// wrong TRUTH (see functions/prep/api/turn.js).

/**
 * The two values the engine needs about an invite's role — and NEVER `cv_text`,
 * `ethos_text` or `jd_text`, which live in the same row and have no business near a
 * session response (briefJsonByInviteId's discipline, restated because it is one lazy
 * `SELECT *` away from being lost). Null when the handover has not been written.
 */
export async function roleByInviteId(db, inviteId) {
  return db
    .prepare(
      `SELECT candidate_role.id AS role_id, invite.interview_at
         FROM candidate_role JOIN invite ON invite.id = candidate_role.invite_id
        WHERE candidate_role.invite_id = ?`,
    )
    .bind(String(inviteId ?? ""))
    .first();
}

/** The ranking's inputs: id, label, importance, and the cached stage/rate columns. */
export async function competenciesByRole(db, roleId) {
  const { results } = await db
    .prepare(
      `SELECT id, label, importance, stage, success_rate
         FROM competency WHERE role_id = ? ORDER BY id`,
    )
    .bind(String(roleId ?? ""))
    .all();
  return results ?? [];
}

/** Every question under the role, core and variants alike, in serving order. */
export async function questionsByRole(db, roleId) {
  const { results } = await db
    .prepare(
      `SELECT q.id, q.competency_id, q.text, q.axis, q.difficulty, q.variant_of
         FROM question q JOIN competency c ON c.id = q.competency_id
        WHERE c.role_id = ?
        ORDER BY q.competency_id, q.difficulty, q.id`,
    )
    .bind(String(roleId ?? ""))
    .all();
  return results ?? [];
}

/**
 * The whole attempt log, oldest first, each row carrying the attempted question's `axis`
 * (LEFT JOIN — the ladder's variant rules read it). The `id` tiebreak matters:
 * `created_at` has 1-second resolution and two turns can land in one tick, and a replay
 * over a nondeterministically-ordered log is a nondeterministic stage.
 */
export async function attemptsByRole(db, roleId) {
  const { results } = await db
    .prepare(
      `SELECT a.id, a.competency_id, a.question_id, a.mode, a.rating, a.created_at,
              q.axis
         FROM attempt a
         JOIN competency c ON c.id = a.competency_id
         LEFT JOIN question q ON q.id = a.question_id
        WHERE c.role_id = ?
        ORDER BY a.created_at, a.id`,
    )
    .bind(String(roleId ?? ""))
    .all();
  return results ?? [];
}

/**
 * THE OWNERSHIP CHECK: the question row only if its competency belongs to this role, else
 * null — turn.js answers 404 on null, so one candidate cannot attempt (or enumerate)
 * another invite's questions. The competency label rides along because every model prompt
 * needs it and a second query would re-ask the same join.
 */
export async function questionForRole(db, { questionId, roleId } = {}) {
  return db
    .prepare(
      `SELECT q.id, q.competency_id, q.text, q.axis, q.difficulty,
              c.label AS competency_label
         FROM question q JOIN competency c ON c.id = q.competency_id
        WHERE q.id = ? AND c.role_id = ?`,
    )
    .bind(String(questionId ?? ""), String(roleId ?? ""))
    .first();
}

/**
 * One attempt row — the unit of record. `competencyId` is ALWAYS the one from
 * `questionForRole`'s row, never a client-supplied value: turn.js's body has no
 * competency field at all, because an attempt filed under the wrong competency corrupts
 * the replay silently.
 *
 * `rating` is bound to the schema's own 1..4 or NULL — the INTEGER-affinity trap
 * DIFFICULTY documents: SQLite stores `2.5` or `"3"` without complaint, and the replay
 * would read them as it pleases. NULL is legal and meaningful (an empty revealed turn).
 */
export async function recordAttempt(db, { competencyId, questionId, mode, rating, note } = {}) {
  requireFields({ competencyId, questionId, mode });
  await db
    .prepare(
      `INSERT INTO attempt (competency_id, question_id, mode, rating, note)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(
      competencyId,
      questionId,
      mode,
      Number.isInteger(rating) && rating >= 1 && rating <= 4 ? rating : null,
      String(note ?? ""),
    )
    .run();
  return { ok: true };
}

/**
 * The cache write: both columns at once, always from `replayProgress` of the log — never
 * incremented in place. If this write is lost, the next turn's replay heals it.
 */
export async function setCompetencyProgress(db, { competencyId, stage, successRate } = {}) {
  requireFields({ competencyId });
  await db
    .prepare("UPDATE competency SET stage = ?, success_rate = ? WHERE id = ?")
    .bind(String(stage ?? ""), Number(successRate) || 0, competencyId)
    .run();
  return { ok: true };
}

/**
 * A minted variant becomes a question like any other (decision 6's "generated live",
 * persisted so the next serve is free and the purge takes it with the scope).
 *
 * The id is `${competencyId}#v-<uuid>` — it cannot collide with `#${index}` core ids and
 * is unique across re-mints, unlike a count-derived suffix. `axis` is checked BEFORE the
 * insert so a bad value is this store's 400, not the CHECK's raw ERR_SQLITE_ERROR.
 * `difficulty` goes through DIFFICULTY — the same affinity trap as ever.
 */
export async function insertVariant(db, { competencyId, text, variantOf, axis, difficulty } = {}) {
  requireFields({ competencyId, text, variantOf, axis });
  if (axis !== "lateral" && axis !== "vertical") {
    throw new StoreError("missing_fields", 400, "axis: must be lateral or vertical");
  }
  const id = `${competencyId}#v-${crypto.randomUUID()}`;
  await db
    .prepare(
      `INSERT INTO question (id, competency_id, text, variant_of, axis, difficulty)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, competencyId, String(text), variantOf, axis, DIFFICULTY[difficulty] ?? null)
    .run();
  return { id, text: String(text) };
}

/**
 * One observation of a habit: +1 on an ACTIVE row with this label, else a fresh row at
 * the DDL's default 1. The count read back is what lets turn.js announce a habit exactly
 * once — on the observation that made it 2 (the moment noise becomes a pattern).
 *
 * ONE statement, not UPDATE-then-INSERT: habits sit outside the log-replay invariant,
 * so a race that inserts two active rows for one label would double-count forever with
 * nothing to heal it. 0005's partial unique index is the backstop this upsert rides.
 */
export async function observeHabit(db, { roleId, label } = {}) {
  requireFields({ roleId, label });
  const evidenceCount = await db
    .prepare(
      `INSERT INTO habit (role_id, label) VALUES (?, ?)
       ON CONFLICT (role_id, label) WHERE active = 1
       DO UPDATE SET evidence_count = evidence_count + 1
       RETURNING evidence_count`,
    )
    .bind(roleId, label)
    .first("evidence_count");
  return { evidenceCount: evidenceCount ?? 1 };
}

// ── the one reminder (#25, decision 17) ────────────────────────────────────────────────

/**
 * The invites due their single reminder: interview tomorrow (UTC calendar, SQLite's own
 * clock) and never reminded. Wrapping interview_at in `date()` defeats `invite_by_interview`
 * — a full scan, purgeExpired's deliberate trade restated: the schema admits both the space
 * and 'T' stamp forms, which raw string comparison would misorder, and invite-count scale
 * makes the scan free. No status filter needed — expiry
 * is interview + 14 days, so a day-before invite is live by construction, and a deleted
 * invite has no row. id + email and NOTHING else: the email builder needs nothing more,
 * and `role_title` lives only inside brief_json, deliberately not parsed in a sweep.
 *
 * ONE row per email (decision 17 is per-candidate, not per-invite): a re-sent "lost"
 * invite is a second row for the same person, and two rows must not mean two emails on
 * the same evening. The group spans claimed rows too — `HAVING max(reminder_sent_at)
 * IS NULL` — because filtering claimed rows in the WHERE would promote the duplicate
 * to due on the very next sweep. min(id) makes the chosen row deterministic.
 *
 * And no reminder on the day the candidate was already emailed (#39): an invite created
 * on the eve is immediately due, which mailed the invite and "Your interview is
 * tomorrow" back to back. `date(max(sent_at)) < date('now')` asks "did today already
 * bring this candidate an email?" of the NEWEST invite, in the HAVING like the clause
 * above it — a per-row filter in the WHERE would leave an older invite due while
 * today's re-send just mailed, the same evening's second email through the side door.
 * `datetime()` inside the max for the reason the WHERE wraps interview_at in date():
 * the schema admits both stamp forms, and raw TEXT max would misorder them. "Today" is
 * SQLite's today, UTC — a UK invite sent in the small hours of the eve lands on
 * yesterday's UTC date and is still reminded; accepted, the sweep's whole clock is UTC.
 * The cost, stated openly: an eve-created invite is never reminded at all, because the
 * sweep's window IS the eve — the invite email is that evening's email.
 */
export async function dueReminders(db) {
  const { results } = await db
    .prepare(
      `SELECT min(id) AS id, email FROM invite
        WHERE date(interview_at) = date('now', '+1 day')
        GROUP BY email
       HAVING max(reminder_sent_at) IS NULL
          AND date(max(datetime(sent_at))) < date('now')`,
    )
    .all();
  return results ?? [];
}

/**
 * The atomic claim, openInvite's move restated: exactly one caller finds the column still
 * NULL, and the loser sees changes === 0. There is no read-then-write window to lose, which
 * is what makes decision 17's "exactly one reminder" structural rather than hopeful. The
 * claim is at-most-once BY DESIGN — the caller never rolls it back on a failed send.
 */
export async function claimReminder(db, inviteId) {
  const result = await db
    .prepare(
      `UPDATE invite SET reminder_sent_at = datetime('now')
        WHERE id = ? AND reminder_sent_at IS NULL`,
    )
    .bind(String(inviteId ?? ""))
    .run();
  return (result.meta?.changes ?? 0) === 1;
}

/** The standing habit list, for session GET's plain-language surface. */
export async function habitsByRole(db, roleId) {
  const { results } = await db
    .prepare(
      "SELECT label, evidence_count, active FROM habit WHERE role_id = ? ORDER BY id",
    )
    .bind(String(roleId ?? ""))
    .all();
  return results ?? [];
}

// ── the private debrief (#77) ──────────────────────────────────────────────────────────
//
// What the candidate writes down after the real interview: the questions they were actually
// asked, which competencies felt shaky, and one thing to fix. It never crosses the wall
// (DECISIONS.md decision 2) — no recruiter surface reads any of it, and test/prep-debrief.test.js
// asserts that as a reachability claim rather than a promise.
//
// Same contract as everything above: `db` first, bound parameters only, no batch.

/**
 * The candidate's debrief for a role, or null.
 *
 * Raw columns — the ROUTE parses `asked_json`, the way functions/prep/api/brief.js parses
 * `brief_json`. A store that parsed it would have to decide what a corrupt row means, and that
 * decision is the caller's: brief.js answers 502 because the payload is a contract another module
 * owns, and the debrief route starts the list empty because it wrote the value itself.
 */
export async function debriefByRole(db, roleId) {
  return db
    .prepare(
      "SELECT id, asked_json, fix_text, created_at FROM debrief WHERE candidate_role_id = ?",
    )
    .bind(String(roleId ?? ""))
    .first();
}

/**
 * Write the debrief, whether or not one stands, and return the id the row now has.
 *
 * `asked` is an ARRAY and this function stringifies it — `persistHandover`'s treatment of
 * `brief_json`, so there is one JSON.stringify in the codebase rather than one per caller.
 *
 * ON CONFLICT on the UNIQUE `candidate_role_id`, so the id is minted once and every later save
 * edits the same row. That is what lets the ticks hang off it: DELETE-then-INSERT here would
 * cascade `debrief_competency` away on every save, and a partial save that failed between the two
 * writes would leave the candidate's ticks silently gone. `RETURNING id` (observeHabit's idiom) so
 * the caller needs no re-read, and on the conflict path it returns the STANDING row's id — not
 * the uuid this call minted and did not use.
 *
 * `requireFields` covers `roleId` alone: `asked` (`[]`) and `fixText` (`''`) are legitimately empty
 * on a partial save, which is the whole point of the form being resumable.
 */
export async function upsertDebrief(db, { roleId, asked, fixText } = {}) {
  requireFields({ roleId });
  const id = await db
    .prepare(
      `INSERT INTO debrief (id, candidate_role_id, asked_json, fix_text) VALUES (?, ?, ?, ?)
       ON CONFLICT (candidate_role_id) DO UPDATE
          SET asked_json = excluded.asked_json, fix_text = excluded.fix_text
       RETURNING id`,
    )
    .bind(crypto.randomUUID(), roleId, JSON.stringify(asked ?? []), String(fixText ?? ""))
    .first("id");
  return { id };
}

/**
 * Replace the whole tick set.
 *
 * DELETE then INSERT — `issueOtp`'s idiom (:435): the newest save is the truth, and a set replaced
 * wholesale has no half-state to reconcile. Untick-then-save is therefore a real erasure, which is
 * what a candidate means by unticking a box.
 *
 * `ON CONFLICT DO NOTHING` because there is NO TRANSACTION here and two saves can interleave —
 * two tabs, or a client retry on a slow response; the page's in-flight guard is per page. Without
 * it, `r1.DELETE → r2.DELETE → r1.INSERT c → r2.INSERT c` raises a UNIQUE violation on the
 * composite key, which is not a StoreError, so the route answers `500 internal` — the exact
 * signal DEPLOY.md's triage table reads as "migration 0011 was never applied". A candidate with
 * two tabs open would send an operator to re-run migrations.
 *
 * WHAT THIS DOES NOT CLOSE, stated rather than implied: a failure between the DELETE and the
 * INSERTs leaves the ticks EMPTY, not stale — previously-saved ones are gone. The set is small,
 * the page re-fetches it, and re-ticking is one tap per box; the alternative (INSERT the new set
 * first, then delete the complement) needs its own branch for the untick-everything case, because
 * `competency_id NOT IN ()` is a syntax error on the empty set. Not worth it for a set this size.
 *
 * Callers pass ids ALREADY checked against the role. This function does not re-check: the route
 * has the competency list in hand for its own 404, and a second check here would be a second
 * policy for one fact.
 */
export async function setShakyCompetencies(db, { debriefId, competencyIds } = {}) {
  requireFields({ debriefId });
  await db.prepare("DELETE FROM debrief_competency WHERE debrief_id = ?").bind(debriefId).run();
  for (const competencyId of competencyIds ?? []) {
    await db
      .prepare(
        `INSERT INTO debrief_competency (debrief_id, competency_id) VALUES (?, ?)
         ON CONFLICT (debrief_id, competency_id) DO NOTHING`,
      )
      .bind(debriefId, String(competencyId))
      .run();
  }
  return { ok: true };
}

/**
 * The competency ids this role's candidate called shaky — targeting's only read of the debrief.
 *
 * A plain array of ids; the caller makes the Set. Scoped through `debrief.candidate_role_id`, so
 * a role with no debrief answers `[]` rather than every tick in the database.
 */
export async function shakyCompetencyIds(db, roleId) {
  const { results } = await db
    .prepare(
      `SELECT dc.competency_id FROM debrief_competency dc
         JOIN debrief d ON d.id = dc.debrief_id
        WHERE d.candidate_role_id = ?
        ORDER BY dc.competency_id`,
    )
    .bind(String(roleId ?? ""))
    .all();
  return (results ?? []).map((row) => row.competency_id);
}

/**
 * A question the candidate was really asked, filed under the competency THEY assigned it to.
 *
 * THE ID IS DERIVED FROM THE TEXT, and that is the whole idempotency: `${competencyId}#asked-`
 * plus the first 16 hex of the text's SHA-256 (`hashToken`, this file's own helper). Re-saving the
 * same form re-derives the same id and `ON CONFLICT DO NOTHING` makes the second save a no-op — by
 * construction, not by a read-then-write race on a route whose ORDINARY path is re-saving. It can
 * collide with neither `#${index}` core ids nor `#v-${uuid}` variants. The caller must pass the
 * same normalised text it stored in `asked_json`, or one stray space mints a second row.
 *
 * It is an INSERT key and nothing else. Never read a line's current placement back off these ids:
 * a line moved between competencies leaves its first row standing, so two ids share one digest and
 * `question` has no stamp to order them by. The placement lives in `debrief.asked_json`, which is
 * why that column is JSON.
 *
 * `axis = 'lateral'`, `variant_of` NULL. Lateral because targeting reads a non-null axis as "a
 * stored variant" and serves unattempted ones before it mints (targeting.js:146-150) — which is
 * exactly what a real question deserves, and it needs no new serving path. It is also TRUE in
 * SPEC's vocabulary: same competency, a real interviewer's phrasing, same difficulty. The
 * consequence to keep in view is that `nextStage`'s `can_answer → holds_up` transition needs a
 * successful non-revealed attempt on a VARIANT, and an asked question now qualifies — so the
 * ladder can move faster after a debrief. That is right (a real question is the strongest evidence
 * an answer survives a phrasing nobody rehearsed) and it is not an accident.
 *
 * NULL `variant_of` because this question is not a variant OF one of ours; the column is nullable
 * and nothing branches on it. NULL `difficulty`, which targeting reads as standard
 * (targeting.js:102).
 */
export async function insertAskedQuestion(db, { competencyId, text } = {}) {
  requireFields({ competencyId, text });
  const id = `${competencyId}#asked-${(await hashToken(String(text))).slice(0, 16)}`;
  const result = await db
    .prepare(
      `INSERT INTO question (id, competency_id, text, variant_of, axis, difficulty)
       VALUES (?, ?, ?, NULL, 'lateral', NULL)
       ON CONFLICT (id) DO NOTHING`,
    )
    .bind(id, competencyId, String(text))
    .run();
  return { id, inserted: (result.meta?.changes ?? 0) === 1 };
}

// ── the storybank (#78) ────────────────────────────────────────────────────────────────
//
// The candidate's own interview stories — a title and a sketch in their own words, each ticked
// against the parts of the job it covers. SPEC Amendment 1: the tool may prompt for a story's
// SHAPE and never drafts its content, which is the spec's first unloosenable rule wearing a
// different coat. Nothing in this section writes a story; every value below arrives from a form.
//
// It never crosses the wall (DECISIONS.md decision 2), same as the debrief above, and
// test/prep-storybank.test.js asserts that as a reachability claim rather than a promise.
//
// NOT THE `StoryBankCard` BLOCK. That is the MODEL-WRITTEN brief block in src/prep/schema.js — a
// prompt, a skeleton and a competency mapping composed at Send. This is CANDIDATE-WRITTEN state
// the tool must never write. Near-identical names, opposite things; migrations/0012_storybank.sql
// argues it at length, and the two are never merged, renamed into each other, or fed from here.
//
// THE ASYMMETRY THAT IS THE FEATURE'S SAFETY: `title` is a thing the model may be shown so a nudge
// can ask "which of your stories fits here?". `sketch` is not. That is enforced by having two
// different functions with two different SELECT lists rather than one function and a rule about
// who calls it — `storyTitlesByRole` has no sketch to leak.
//
// Same contract as everything above: `db` first, bound parameters only, no batch.

/**
 * Every story on this role, oldest first, WITH sketches — the editor's read and the only one.
 *
 * This is the one function in the codebase that selects `sketch`, and exactly one route calls it:
 * functions/prep/api/stories.js's GET, which renders it on the candidate's own editor. A
 * model-facing caller reaching for this function instead of `storyTitlesByRole` IS the leak AC2
 * forbids, which is why the two exist separately and why the test file asserts which file imports
 * which.
 *
 * `ORDER BY created_at, rowid`, and the tiebreak is not decoration — it is a bug this file had
 * until a flaky test found it. `created_at` defaults to `datetime('now')`, which is SECOND
 * granularity, and two stories saved in the same second therefore tie. The obvious tiebreak, `id`,
 * is a uuid (createStory mints it), so ties would resolve in an order that is arbitrary AND
 * stable: a candidate who adds two stories quickly would find the second one permanently above the
 * first, with no way to move it. `rowid` is SQLite's own insertion counter, so a tie falls back to
 * the order the rows were actually written — which is the order the candidate wrote them in, and
 * the only honest answer for a list they own. (VACUUM may renumber rowids; it copies in rowid
 * order, so the relative order this depends on survives.)
 */
export async function storiesByRole(db, roleId) {
  const { results } = await db
    .prepare(
      `SELECT id, title, sketch, created_at FROM story
        WHERE candidate_role_id = ? ORDER BY created_at, rowid`,
    )
    .bind(String(roleId ?? ""))
    .all();
  return results ?? [];
}

/**
 * Every (story_id, competency_id) pair on this role — the editor's ticks and targeting's cover set.
 *
 * Scoped through `story.candidate_role_id`, so a role with no stories answers `[]` rather than
 * every tick in the database — `shakyCompetencyIds`'s reasoning, one table over.
 */
export async function storyCompetenciesByRole(db, roleId) {
  const { results } = await db
    .prepare(
      `SELECT sc.story_id, sc.competency_id FROM story_competency sc
         JOIN story s ON s.id = sc.story_id
        WHERE s.candidate_role_id = ?
        ORDER BY sc.story_id, sc.competency_id`,
    )
    .bind(String(roleId ?? ""))
    .all();
  return results ?? [];
}

/**
 * How many stories this role has. The cap's read, and nothing else.
 *
 * Exists so the twelve-story cap does not have to fetch every sketch to count rows. The POST path
 * called `storiesByRole` for `.length`, which put every paragraph the candidate has ever written
 * onto the write path with no reader for it, and made the claim above — exactly one route calls
 * the sketch-bearing query — untrue at handler granularity even though it stayed true per file.
 *
 * NOT A GUARANTEE THAT THE CAP HOLDS, and the distinction matters. This is a read, the INSERT is a
 * separate statement, and there is no transaction between them, so two concurrent POSTs both read
 * 11 and both write: raced to 21 rows on a 12-cap role. The cap is a courtesy to an honest client,
 * not a bound anything downstream may rely on — which is why `storyTitlesByRole` carries its own
 * `LIMIT` and `mintNudge` slices again.
 */
export async function countStoriesByRole(db, roleId) {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM story WHERE candidate_role_id = ?")
    .bind(String(roleId ?? ""))
    .first();
  return Number(row?.n ?? 0);
}

/**
 * The TITLES only, as a plain array of strings. The one function a model-facing caller may import.
 *
 * WHY THIS EXISTS AS A SEPARATE FUNCTION, in the terms that matter: `sketch` is the candidate's own
 * words about their own life and MUST NEVER REACH A MODEL PROMPT OR A LOG LINE. A single
 * "storiesByRole" used everywhere would make that a rule about callers — and a rule about callers
 * is one refactor from being untrue. This query has no sketch in it, so the nudge path cannot leak
 * one however it is rewritten. test/prep-storybank.test.js asserts both halves: that this SQL
 * selects `title` and never mentions `sketch`, and that functions/prep/api/turn.js imports this
 * function and not the other.
 *
 * Same `created_at, rowid` order as `storiesByRole` — see its JSDoc for why the tiebreak is not
 * `id` — so the titles a nudge is shown are in the order the candidate sees on their own page. A
 * nudge that says "your second story" must mean the one they would count second.
 *
 * `LIMIT 12` IS A SECURITY BOUND, not a convenience. The twelve-story cap in
 * functions/prep/api/stories.js is a read-then-write with no transaction around it, so two
 * concurrent POSTs race straight through it — 21 rows on a 12-cap role, reproduced. Anything this
 * function returns is interpolated into a prompt (src/prep/drill.js `mintNudge`), so an unbounded
 * result is an unbounded payload in a model's user turn. The bound belongs in the statement, where
 * no route ordering can step around it. `mintNudge` slices as well; neither is redundant, because
 * neither can see the other.
 */
export async function storyTitlesByRole(db, roleId) {
  const { results } = await db
    .prepare(
      "SELECT title FROM story WHERE candidate_role_id = ? ORDER BY created_at, rowid LIMIT 12",
    )
    .bind(String(roleId ?? ""))
    .all();
  return (results ?? []).map((row) => row.title);
}

/**
 * A new story. THE ID IS MINTED HERE and never taken from a caller.
 *
 * WHY CREATE AND UPDATE ARE TWO FUNCTIONS AND NOT ONE UPSERT — the most important decision in this
 * section, and the one place the storybank deliberately diverges from `upsertDebrief` above.
 *
 * A `saveStory` shaped as `INSERT … ON CONFLICT (id) DO UPDATE` would take the id FROM THE REQUEST
 * BODY as its conflict target. A body id belonging to another invite would then either overwrite
 * that candidate's story or insert a row under this role carrying a foreign id, and the only thing
 * standing between either and a real caller would be a membership check the route runs in a
 * SEPARATE STATEMENT on a database with no transaction. `upsertDebrief` has no such exposure
 * because its conflict target is `candidate_role_id`, which comes from the SESSION and not from
 * the body — the difference is the source of the key, not the shape of the SQL.
 *
 * Splitting the two puts the ownership check INSIDE THE WHERE CLAUSE (see updateStory and
 * deleteStory), where no ordering, no race and no future refactor of the route can bypass it. A
 * later reader who "simplifies" these back into one `ON CONFLICT (id)` statement re-opens a
 * cross-invite write.
 *
 * `requireFields` covers `roleId` and `title` only: `sketch` is legitimately `''` — a title-only
 * story is a real half-written state and the page is resumable.
 */
export async function createStory(db, { roleId, title, sketch } = {}) {
  const id = crypto.randomUUID();
  requireFields({ roleId, title });
  await db
    .prepare("INSERT INTO story (id, candidate_role_id, title, sketch) VALUES (?, ?, ?, ?)")
    .bind(id, roleId, String(title), String(sketch ?? ""))
    .run();
  return { id };
}

/**
 * Edit one story, ROLE-SCOPED IN THE SQL so a story id from another invite updates nothing.
 *
 * The `AND candidate_role_id = ?` is the ownership check itself, not a belt beside one — see
 * createStory's argument for why it lives here and not in a preceding SELECT. `{updated: false}`
 * is how a foreign or deleted id comes back, and the route answers `404 not_found` on it having
 * written nothing.
 *
 * `created_at` is deliberately untouched, so editing a story does not move it in the candidate's
 * own list.
 */
export async function updateStory(db, { roleId, storyId, title, sketch } = {}) {
  requireFields({ roleId, storyId, title });
  const result = await db
    .prepare("UPDATE story SET title = ?, sketch = ? WHERE id = ? AND candidate_role_id = ?")
    .bind(String(title), String(sketch ?? ""), storyId, roleId)
    .run();
  return { updated: (result.meta?.changes ?? 0) === 1 };
}

/**
 * Replace one story's whole tick set — `setShakyCompetencies`'s idiom, story-scoped.
 *
 * DELETE then INSERT, so a set replaced wholesale has no half-state to reconcile and unticking
 * every box is a real erasure — which is what a candidate means by it.
 *
 * WHAT "THE NEWEST SAVE IS THE TRUTH" IS WORTH, stated accurately because this docstring used to
 * claim it outright. It holds for saves that do not overlap, which is every save from one page.
 * Under interleaving it is a UNION, not a replacement: `r1.DELETE → r2.DELETE → r1.INSERT a →
 * r2.INSERT b` leaves `[a, b]` when the last writer said `[b]` only. Reproduced, not reasoned
 * about. The consequence is specific and worse here than for the debrief's version of this
 * function: a resurrected tick makes `storyGap` report a competency as covered at the moment the
 * candidate said it is not, so the feature's only output is silently suppressed by its own
 * bookkeeping.
 *
 * NOT FIXED HERE, deliberately. A correct fix needs a per-story write generation to compare
 * against, and the schema has no such column by design — 0012 is deliberately minimal. Adding a
 * fake one (a timestamp at second granularity) would buy nothing this comment does not. What is
 * cheap and real is that the window is two overlapping writes to the SAME story, which needs two
 * tabs or a retry against a slow response, and the page re-fetches after every save, so the union
 * is visible on screen and one tap per box corrects it. Filed rather than papered over.
 *
 * `ON CONFLICT DO NOTHING` because there is NO TRANSACTION here and two saves can interleave (two
 * tabs, or a client retry on a slow response; the page's in-flight guard is per page). Without it,
 * `r1.DELETE → r2.DELETE → r1.INSERT c → r2.INSERT c` raises a UNIQUE violation on the composite
 * key, which is not a StoreError, so the route answers `500 internal` — the exact signal
 * DEPLOY.md's triage table reads as "migration 0012 was never applied". Do not remove it to get
 * last-writer-wins: that trades a silent merge for a 500 and fixes nothing.
 *
 * WHAT THIS DOES NOT CLOSE, stated rather than implied: a failure between the DELETE and the
 * INSERTs leaves this story's ticks EMPTY, not stale. The set is small, the page re-fetches it,
 * and re-ticking is one tap per box. THE SKETCHES ARE NOT EXPOSED TO THIS AT ALL, and that is the
 * whole reason the ticks and the story are written by two different statements rather than one
 * whole-set replace: paragraphs of prose cannot be re-typed, so nothing here ever deletes them.
 *
 * Callers pass ids ALREADY checked against the role, and pass `storyId` ALREADY confirmed to
 * belong to it — this function does not re-check either, because the route has the competency list
 * in hand for its own 404 and `updateStory`'s WHERE clause has already answered the second.
 */
export async function setStoryCompetencies(db, { storyId, competencyIds } = {}) {
  requireFields({ storyId });
  await db.prepare("DELETE FROM story_competency WHERE story_id = ?").bind(storyId).run();
  for (const competencyId of competencyIds ?? []) {
    await db
      .prepare(
        `INSERT INTO story_competency (story_id, competency_id) VALUES (?, ?)
         ON CONFLICT (story_id, competency_id) DO NOTHING`,
      )
      .bind(storyId, String(competencyId))
      .run();
  }
  return { ok: true };
}

/**
 * Delete one story, scoped to the role so a story id from another invite deletes nothing.
 *
 * Same argument as `updateStory`: the `AND candidate_role_id = ?` IS the ownership check, in the
 * one place a race cannot get between it and the write. `{deleted: false}` on a miss, and the
 * route answers 404.
 *
 * `story_competency` goes with it BY CASCADE (0012), never a second DELETE — a second statement
 * would be a second place for the erasure to be half-done, and the schema already promises this
 * one cannot be.
 */
export async function deleteStory(db, { roleId, storyId } = {}) {
  requireFields({ roleId, storyId });
  const result = await db
    .prepare("DELETE FROM story WHERE id = ? AND candidate_role_id = ?")
    .bind(storyId, roleId)
    .run();
  return { deleted: (result.meta?.changes ?? 0) === 1 };
}
