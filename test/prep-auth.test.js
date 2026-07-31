// #20 AC1–AC3 — the door, proven against real SQL rather than recorded strings.
//
// The class of failure this file catches is one no recorded-SQL assertion can see, and it is
// the reason this file exists separately from test/portal-store.test.js. Four of this
// ticket's behaviours branch on `meta.changes`, and test/helpers/fake-d1.js returns
// `{ changes: 1 }` unconditionally:
//
//   reused token rejected   openInvite -> changes === 0     under the fake: always 1
//   expired token rejected  the datetime guard              under the fake: always 1
//   opened_at set once      COALESCE + the pre-read         under the fake: no row to read
//   OTP single-use and cap  attempts, and the delete        under the fake: no row to read
//
// Every one of them PASSES under the fake while the logic is wrong. So they run here, against
// node:sqlite, with the migrations applied in wrangler's order — the same split #17 made
// between portal-store.test.js and portal-purge.test.js.
//
// Engine: node:sqlite, which this machine's default Node 20 does not have — every test skips
// there with the remedy in the message, and Node 24 proves the rest. The harness itself
// (the adapter, the migrations, the PRAGMA foreign_keys gotcha, the skip) moved to
// test/helpers/sqlite-d1.js when #22 became its third caller; the reasoning went with it.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  consumeOtp,
  createInvite,
  hashToken,
  inviteByEmail,
  inviteByTokenHash,
  issueOtp,
  openInvite,
  purgeExpired,
  rotateSession,
} from "../src/portal/store.js";
import { hashOtpCode, mintToken, SESSION_COOKIE } from "../src/prep/tokens.js";
import { sessionFromRequest, requireSession } from "../src/prep/session.js";
import { onRequestPost as deleteRoute } from "../functions/prep/api/delete.js";
import { onRequestPost as otpRoute } from "../functions/prep/auth/otp.js";
import { at, d1Shape, openMigrated, skip } from "./helpers/sqlite-d1.js";

const rowOf = (db, id) => db.prepare("SELECT * FROM invite WHERE id = ?").get(id);
const otpRows = (db, inviteId) => db.prepare("SELECT * FROM otp WHERE invite_id = ?").all(inviteId);

/** A Request-shaped object carrying just the session cookie. */
const requestWith = (token) => ({
  headers: { get: (name) => (name === "Cookie" && token !== null ? `${SESSION_COOKIE}=${token}` : null) },
});

/**
 * The three invites every test starts from, seeded through the real writer:
 *   L  live      — interview in 7 days, open for 21
 *   X  expired   — died yesterday
 *   O  opened    — live, and already exchanged once (so its token has rotated)
 * Returns the raw tokens, because after an exchange only the caller knows them.
 */
async function seed(db) {
  const d1 = d1Shape(db);
  const tokens = { L: mintToken(), X: mintToken(), O: mintToken() };

  await createInvite(d1, {
    id: "inv-L", clientId: "c-1", email: "live@example.com",
    interviewAt: at(7), tokenHash: await hashToken(tokens.L), expiresAt: at(21),
  });
  await createInvite(d1, {
    id: "inv-X", clientId: "c-1", email: "expired@example.com",
    interviewAt: at(-15), tokenHash: await hashToken(tokens.X), expiresAt: at(-1),
  });
  await createInvite(d1, {
    id: "inv-O", clientId: "c-1", email: "opened@example.com",
    interviewAt: at(3), tokenHash: await hashToken(tokens.O), expiresAt: at(17),
  });

  // O is opened the way production opens one, not by an UPDATE this test invented.
  tokens.OSession = mintToken();
  await openInvite(d1, { oldHash: await hashToken(tokens.O), newHash: await hashToken(tokens.OSession) });

  return { d1, tokens };
}

// ── AC #1: expired, forged and reused tokens are rejected ──────────────────────────────

test("a forged token matches no invite at all", { skip }, async () => {
  const db = openMigrated();
  const { d1 } = await seed(db);

  // The whole guessing attack, in one assertion: a 256-bit token that was never minted here
  // hashes to something no row holds, and the lookup that every route starts with returns null.
  assert.equal(await inviteByTokenHash(d1, await hashToken("not-a-real-token")), null);
  assert.equal(await inviteByTokenHash(d1, await hashToken(mintToken())), null, "nor a well-formed one");
});

test("an expired token cannot be exchanged, and is not consumed by the attempt", { skip }, async () => {
  const db = openMigrated();
  const { d1, tokens } = await seed(db);
  const before = rowOf(db, "inv-X");

  const result = await openInvite(d1, {
    oldHash: await hashToken(tokens.X),
    newHash: await hashToken(mintToken()),
  });
  assert.deepEqual(result, { rotated: false }, "the datetime guard in the WHERE is what refuses it");

  // The row must be untouched, not merely un-rotated. A failed exchange that still burned the
  // token would turn "your prep has expired" into "your link is invalid" on a retry, and the
  // candidate would be told the wrong thing about why they cannot get in.
  assert.deepEqual(rowOf(db, "inv-X"), before, "an expired invite is left byte-identical");
  assert.equal(before.opened_at, null, "and was never stamped opened");
});

test("a valid token is exchanged exactly once — the second click finds nothing", { skip }, async () => {
  const db = openMigrated();
  const { d1, tokens } = await seed(db);
  const session = mintToken();

  const first = await openInvite(d1, {
    oldHash: await hashToken(tokens.L),
    newHash: await hashToken(session),
  });
  assert.deepEqual(first, { rotated: true });

  const opened = rowOf(db, "inv-L");
  assert.equal(opened.token_hash, await hashToken(session), "the emailed token is replaced by the session token");
  assert.notEqual(opened.token_hash, await hashToken(tokens.L), "and the emailed one is gone from the row");
  assert.ok(opened.opened_at, "opened_at is stamped by the exchange");
  assert.equal(opened.status, "opened");

  // AC #1's "reused tokens rejected". It holds STRUCTURALLY: there is no `used` flag to
  // check, the old hash simply no longer matches any row, so a replayed link cannot succeed
  // even if every guard above were deleted.
  const replay = await openInvite(d1, {
    oldHash: await hashToken(tokens.L),
    newHash: await hashToken(mintToken()),
  });
  assert.deepEqual(replay, { rotated: false }, "the same link a second time rotates nothing");
  assert.deepEqual(rowOf(db, "inv-L"), opened, "and leaves the session it already issued alone");
});

test("two simultaneous exchanges of one link: exactly one wins", { skip }, async () => {
  const db = openMigrated();
  const { d1, tokens } = await seed(db);

  // A mail scanner and the candidate clicking at the same moment. Both statements match the
  // same row; SQLite serialises them; the loser finds the old hash gone. If the exchange were
  // a read-then-write instead of one statement, both would win and two browsers would hold a
  // session — and the second would silently overwrite the first's cookie into uselessness.
  const results = await Promise.all([
    openInvite(d1, { oldHash: await hashToken(tokens.L), newHash: await hashToken(mintToken()) }),
    openInvite(d1, { oldHash: await hashToken(tokens.L), newHash: await hashToken(mintToken()) }),
  ]);
  assert.equal(results.filter((r) => r.rotated).length, 1, "exactly one of two racing clicks rotates");
});

// ── AC #3: opened_at is set exactly once ───────────────────────────────────────────────

test("opened_at survives every later sign-in byte-identical", { skip }, async () => {
  const db = openMigrated();
  const { d1, tokens } = await seed(db);
  await openInvite(d1, { oldHash: await hashToken(tokens.L), newHash: await hashToken(mintToken()) });

  const stamped = rowOf(db, "inv-L").opened_at;
  assert.ok(stamped, "the first exchange stamps it");

  // Two returning logins, which is what rotateSession models. Decision 23 counts invites
  // opened as a sales claim: if signing back in re-stamped this, the number would climb with
  // device count rather than reach, and the claim would quietly become a different claim.
  for (const _ of [1, 2]) {
    const { rotated } = await rotateSession(d1, { inviteId: "inv-L", newHash: await hashToken(mintToken()) });
    assert.equal(rotated, true);
    assert.equal(rowOf(db, "inv-L").opened_at, stamped, "a returning login is not a new open");
    assert.equal(rowOf(db, "inv-L").status, "opened", "and does not move status either");
  }
});

test("rotateSession never opens an invite that was never opened", { skip }, async () => {
  const db = openMigrated();
  const { d1 } = await seed(db);
  // A candidate could in principle reach the OTP path without ever clicking their link.
  // That is a sign-in, not an open, and the counter must not learn about it.
  assert.equal(rowOf(db, "inv-L").opened_at, null);
  await rotateSession(d1, { inviteId: "inv-L", newHash: await hashToken(mintToken()) });
  assert.equal(rowOf(db, "inv-L").opened_at, null, "rotateSession touches token_hash and nothing else");
  assert.equal(rowOf(db, "inv-L").status, "sent");
});

test("rotateSession refuses an expired invite", { skip }, async () => {
  const db = openMigrated();
  const { d1 } = await seed(db);
  const before = rowOf(db, "inv-X");
  assert.deepEqual(
    await rotateSession(d1, { inviteId: "inv-X", newHash: await hashToken(mintToken()) }),
    { rotated: false },
    "a correct OTP for a dead invite still issues no session",
  );
  assert.deepEqual(rowOf(db, "inv-X"), before);
});

// ── the returning-login lookup ─────────────────────────────────────────────────────────

test("inviteByEmail is case-insensitive, skips the dead, and takes the newest", { skip }, async () => {
  const db = openMigrated();
  const { d1 } = await seed(db);

  assert.equal((await inviteByEmail(d1, "LIVE@Example.COM"))?.id, "inv-L", "a retyped address still matches");
  assert.equal(await inviteByEmail(d1, "expired@example.com"), null, "an expired invite issues no code");
  assert.equal(await inviteByEmail(d1, "nobody@example.com"), null);

  // A candidate re-invited for a second role holds two live invites. The newest is the one
  // the email in their hand refers to.
  //
  // The first invite is backdated rather than the second being created "later": sent_at is
  // datetime('now') at one-second resolution, so two rows written in the same tick tie and
  // SQLite may return either. That tie is undefined in production too — see inviteByEmail —
  // and a test that leaned on it would be flaky rather than strict. Days apart is the real
  // shape of a re-invite anyway.
  db.prepare("UPDATE invite SET sent_at = datetime('now', '-3 days') WHERE id = 'inv-L'").run();
  await createInvite(d1, {
    id: "inv-L2", clientId: "c-1", email: "live@example.com",
    interviewAt: at(9), tokenHash: await hashToken(mintToken()), expiresAt: at(23),
  });
  assert.equal((await inviteByEmail(d1, "live@example.com"))?.id, "inv-L2", "ORDER BY sent_at DESC picks the newest");
});

// ── AC #2: the OTP is single-use, short-lived and attempt-capped ───────────────────────

test("a correct code verifies once and the row is gone — single-use IS the delete", { skip }, async () => {
  const db = openMigrated();
  const { d1 } = await seed(db);
  const code = "049217";
  await issueOtp(d1, { inviteId: "inv-L", codeHash: await hashOtpCode("inv-L", code), ttlMinutes: 10 });

  assert.deepEqual(
    await consumeOtp(d1, { inviteId: "inv-L", codeHash: await hashOtpCode("inv-L", code), maxAttempts: 5 }),
    { ok: true },
  );
  assert.equal(otpRows(db, "inv-L").length, 0, "the row is deleted on success, so it cannot be replayed");

  // The same code again finds nothing. `expired` and not `invalid_code`, because from the
  // candidate's side there is genuinely nothing left to verify against.
  assert.deepEqual(
    await consumeOtp(d1, { inviteId: "inv-L", codeHash: await hashOtpCode("inv-L", code), maxAttempts: 5 }),
    { ok: false, reason: "expired" },
  );
});

test("a wrong code increments attempts by exactly one and leaves the row alive", { skip }, async () => {
  const db = openMigrated();
  const { d1 } = await seed(db);
  await issueOtp(d1, { inviteId: "inv-L", codeHash: await hashOtpCode("inv-L", "049217"), ttlMinutes: 10 });

  for (const expected of [1, 2, 3]) {
    assert.deepEqual(
      await consumeOtp(d1, { inviteId: "inv-L", codeHash: await hashOtpCode("inv-L", "000000"), maxAttempts: 5 }),
      { ok: false, reason: "invalid_code" },
    );
    assert.equal(otpRows(db, "inv-L")[0].attempts, expected, "attempts increments by one per wrong guess");
  }
  // The right code still works with attempts spent — the cap bounds guessing, it does not
  // punish a candidate who mistyped twice and then got it right.
  assert.deepEqual(
    await consumeOtp(d1, { inviteId: "inv-L", codeHash: await hashOtpCode("inv-L", "049217"), maxAttempts: 5 }),
    { ok: true },
  );
});

test("five guesses are allowed and the sixth call is refused without comparing", { skip }, async () => {
  const db = openMigrated();
  const { d1 } = await seed(db);
  const wrong = { inviteId: "inv-L", codeHash: await hashOtpCode("inv-L", "000000"), maxAttempts: 5 };
  const right = { inviteId: "inv-L", codeHash: await hashOtpCode("inv-L", "049217"), maxAttempts: 5 };
  await issueOtp(d1, { inviteId: "inv-L", codeHash: right.codeHash, ttlMinutes: 10 });

  // The exact arithmetic, pinned. This is the assertion that fails if anyone "fixes" the cap
  // into an off-by-one: five wrong guesses each answer invalid_code, leaving attempts at 5.
  for (let i = 1; i <= 5; i++) {
    assert.deepEqual(await consumeOtp(d1, wrong), { ok: false, reason: "invalid_code" }, `guess ${i} of 5`);
  }
  assert.equal(otpRows(db, "inv-L")[0].attempts, 5, "five spent, none wasted, none double-counted");

  // The sixth call is refused at the cap BEFORE any comparison — so even the RIGHT code is
  // turned away. That ordering is what makes the cap a cap rather than a suggestion.
  assert.deepEqual(await consumeOtp(d1, right), { ok: false, reason: "too_many_attempts" });
  assert.equal(otpRows(db, "inv-L").length, 0, "cap-out deletes the row: there is no oracle left to ask");

  // And afterwards there is nothing to verify against at all.
  assert.deepEqual(await consumeOtp(d1, right), { ok: false, reason: "expired" });
});

test("a code past its TTL is refused even when it is correct", { skip }, async () => {
  const db = openMigrated();
  const { d1 } = await seed(db);
  const codeHash = await hashOtpCode("inv-L", "049217");
  // Written directly, because issueOtp cannot mint one already dead — the TTL is the point.
  db.prepare("INSERT INTO otp (invite_id, code_hash, expires_at) VALUES (?, ?, datetime('now','-1 minute'))")
    .run("inv-L", codeHash);

  assert.deepEqual(
    await consumeOtp(d1, { inviteId: "inv-L", codeHash, maxAttempts: 5 }),
    { ok: false, reason: "expired" },
    "the ten-minute window is enforced by the row, not by whoever calls it",
  );
  assert.equal(otpRows(db, "inv-L").length, 1, "a dead row is read and left alone — nothing to increment");
});

test("requesting a second code kills the first, and only one row ever exists", { skip }, async () => {
  const db = openMigrated();
  const { d1 } = await seed(db);
  const first = await hashOtpCode("inv-L", "111111");
  const second = await hashOtpCode("inv-L", "222222");

  await issueOtp(d1, { inviteId: "inv-L", codeHash: first, ttlMinutes: 10 });
  await issueOtp(d1, { inviteId: "inv-L", codeHash: second, ttlMinutes: 10 });

  // One live code per invite is the whole rate-limit design: a candidate mashing "send me a
  // code" ends with one usable code, not forty outstanding ones.
  assert.equal(otpRows(db, "inv-L").length, 1, "the DELETE before the INSERT is not decoration");
  assert.deepEqual(
    await consumeOtp(d1, { inviteId: "inv-L", codeHash: first, maxAttempts: 5 }),
    { ok: false, reason: "invalid_code" },
    "the superseded code no longer verifies",
  );
  assert.deepEqual(await consumeOtp(d1, { inviteId: "inv-L", codeHash: second, maxAttempts: 5 }), { ok: true });
});

test("a fresh code inside the cooldown blocks rotation — the lockout attack buys nothing", { skip }, async () => {
  const db = openMigrated();
  const { d1 } = await seed(db);
  const first = await hashOtpCode("inv-L", "111111");
  const second = await hashOtpCode("inv-L", "222222");

  assert.deepEqual(
    await issueOtp(d1, { inviteId: "inv-L", codeHash: first, ttlMinutes: 10, cooldownMinutes: 1 }),
    { ok: true, issued: true },
  );
  // The repeat request inside the minute: answered ok, but the standing row is untouched —
  // it is the code the candidate is currently typing.
  assert.deepEqual(
    await issueOtp(d1, { inviteId: "inv-L", codeHash: second, ttlMinutes: 10, cooldownMinutes: 1 }),
    { ok: true, issued: false },
  );
  const rows = otpRows(db, "inv-L");
  assert.equal(rows.length, 1, "the coalesced request neither deleted nor inserted");
  assert.equal(rows[0].code_hash, first, "the ORIGINAL code stands");
  assert.deepEqual(await consumeOtp(d1, { inviteId: "inv-L", codeHash: first, maxAttempts: 5 }), { ok: true });
});

test("a code older than the cooldown rotates as before", { skip }, async () => {
  const db = openMigrated();
  const { d1 } = await seed(db);
  const first = await hashOtpCode("inv-L", "111111");
  const second = await hashOtpCode("inv-L", "222222");

  await issueOtp(d1, { inviteId: "inv-L", codeHash: first, ttlMinutes: 10, cooldownMinutes: 1 });
  // Backdate the mint past the cooldown by shrinking expires_at (TTL 10, expires in 8 ⇒
  // minted 2 minutes ago) — the direct-write idiom above, because issueOtp cannot mint stale.
  db.prepare("UPDATE otp SET expires_at = datetime('now', '+8 minutes') WHERE invite_id = 'inv-L'").run();

  assert.deepEqual(
    await issueOtp(d1, { inviteId: "inv-L", codeHash: second, ttlMinutes: 10, cooldownMinutes: 1 }),
    { ok: true, issued: true },
  );
  const rows = otpRows(db, "inv-L");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].code_hash, second, "past the cooldown, rotation resumes");
});

test("a coalesced reissue preserves the guess budget — attempts no longer resets on demand", { skip }, async () => {
  const db = openMigrated();
  const { d1 } = await seed(db);
  await issueOtp(d1, {
    inviteId: "inv-L",
    codeHash: await hashOtpCode("inv-L", "049217"),
    ttlMinutes: 10,
    cooldownMinutes: 1,
  });
  for (let i = 0; i < 2; i++) {
    await consumeOtp(d1, { inviteId: "inv-L", codeHash: await hashOtpCode("inv-L", "000000"), maxAttempts: 5 });
  }
  assert.equal(otpRows(db, "inv-L")[0].attempts, 2);

  // The sentence #31 exists to make true: requesting a new code no longer resets the counter.
  assert.deepEqual(
    await issueOtp(d1, {
      inviteId: "inv-L",
      codeHash: await hashOtpCode("inv-L", "999999"),
      ttlMinutes: 10,
      cooldownMinutes: 1,
    }),
    { ok: true, issued: false },
  );
  assert.equal(otpRows(db, "inv-L")[0].attempts, 2, "the 5-guess budget survives the coalesced request");
});

test("cooldown 0 keeps the lockout semantics — the old world, opted into explicitly", { skip }, async () => {
  const db = openMigrated();
  const { d1 } = await seed(db);
  const first = await hashOtpCode("inv-L", "111111");
  const second = await hashOtpCode("inv-L", "222222");

  await issueOtp(d1, { inviteId: "inv-L", codeHash: first, ttlMinutes: 10, cooldownMinutes: 0 });
  assert.deepEqual(
    await issueOtp(d1, { inviteId: "inv-L", codeHash: second, ttlMinutes: 10, cooldownMinutes: 0 }),
    { ok: true, issued: true },
  );
  assert.deepEqual(
    await consumeOtp(d1, { inviteId: "inv-L", codeHash: first, maxAttempts: 5 }),
    { ok: false, reason: "invalid_code" },
    "with no cooldown the second issue still kills the first code",
  );
});

test("the otp route: three branches, one answer, one email (PR #41 review, Medium 1)", { skip }, async () => {
  const db = openMigrated();
  const { d1 } = await seed(db);

  // The route is where the cooldown's two halves meet: issueOtp decides, and the mail block
  // obeys `issued`. This test pins the wiring — drop `cooldownMinutes` from the call, or move
  // the 202 inside `if (issued)`, and this fails while every store-layer test stays green.
  const sends = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    sends.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ id: "email-1" }), { status: 200 });
  };
  try {
    const env = { DB: d1, RESEND_API_KEY: "re_test" };
    /** No Sec-Fetch-Site and no Origin is the curl path, as deleteRequest below notes. */
    const requestFor = (email) => ({ headers: { get: () => null }, json: async () => ({ email }) });

    const first = await otpRoute({ request: requestFor("live@example.com"), env });
    const standing = otpRows(db, "inv-L")[0].code_hash;
    const second = await otpRoute({ request: requestFor("live@example.com"), env });
    const unknown = await otpRoute({ request: requestFor("nobody@example.com"), env });

    // The anti-enumeration contract: issued, cooling down and no-invite are indistinguishable.
    for (const response of [first, second, unknown]) {
      assert.equal(response.status, 202);
      assert.deepEqual(await response.json(), { ok: true });
    }
    assert.equal(sends.length, 1, "the coalesced repeat and the unknown address send nothing");
    assert.equal(sends[0].to, "live@example.com", "and the one email went to the invite's address");
    const rows = otpRows(db, "inv-L");
    assert.equal(rows.length, 1, "one live code throughout");
    assert.equal(rows[0].code_hash, standing, "the repeat request left the standing code alone");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("a code issued for one invite cannot be spent on another", { skip }, async () => {
  const db = openMigrated();
  const { d1 } = await seed(db);
  // The invite id is in the hash preimage precisely for this. Two candidates who happen to
  // draw the same six digits must not be able to sign in as each other.
  await issueOtp(d1, { inviteId: "inv-L", codeHash: await hashOtpCode("inv-L", "049217"), ttlMinutes: 10 });
  await issueOtp(d1, { inviteId: "inv-O", codeHash: await hashOtpCode("inv-O", "049217"), ttlMinutes: 10 });

  assert.deepEqual(
    await consumeOtp(d1, { inviteId: "inv-O", codeHash: await hashOtpCode("inv-L", "049217"), maxAttempts: 5 }),
    { ok: false, reason: "invalid_code" },
    "the same six digits hash differently per invite",
  );
});

// ── the session guard, which is what every later ticket leans on ───────────────────────

test("a live session cookie resolves to its invite, and carries no credential back", { skip }, async () => {
  const db = openMigrated();
  const { d1, tokens } = await seed(db);
  const session = mintToken();
  await openInvite(d1, { oldHash: await hashToken(tokens.L), newHash: await hashToken(session) });

  const resolved = await sessionFromRequest(d1, requestWith(session));
  assert.deepEqual(resolved, { inviteId: "inv-L", clientId: "c-1", expiresAt: rowOf(db, "inv-L").expires_at });
  // A route needs to know WHICH invite it serves, never what unlocks it.
  assert.deepEqual(Object.keys(resolved).sort(), ["clientId", "expiresAt", "inviteId"]);
});

test("every way of not being signed in resolves to null", { skip }, async () => {
  const db = openMigrated();
  const { d1, tokens } = await seed(db);

  assert.equal(await sessionFromRequest(d1, requestWith(null)), null, "no cookie");
  assert.equal(await sessionFromRequest(d1, requestWith(mintToken())), null, "a forged cookie");
  assert.equal(await sessionFromRequest(d1, requestWith(tokens.X)), null, "an expired invite");

  // The one that matters most for #17: delete-now removed the row, so the cookie in the
  // candidate's browser stops meaning anything the moment they press the button. Asserted
  // live-then-dead, because "returns null" proves nothing if it never resolved to begin with.
  const beforeDelete = await sessionFromRequest(d1, requestWith(tokens.OSession));
  assert.equal(beforeDelete?.inviteId, "inv-O", "O holds a live session to begin with");
  db.prepare("DELETE FROM invite WHERE id = 'inv-O'").run();
  assert.equal(await sessionFromRequest(d1, requestWith(tokens.OSession)), null, "after delete-now the cookie is inert");

  // And a superseded session: signing in again rotates the column, so the older cookie dies
  // — which is what stops a stolen laptop staying signed in after the candidate signs in
  // somewhere else.
  const beforeRotate = await sessionFromRequest(d1, requestWith(tokens.L));
  assert.equal(beforeRotate?.inviteId, "inv-L", "L's unspent invite token is a valid session");
  await rotateSession(d1, { inviteId: "inv-L", newHash: await hashToken(mintToken()) });
  assert.equal(await sessionFromRequest(d1, requestWith(tokens.L)), null, "a rotated-out token is nobody");
});

test("requireSession throws invalid_token 401 rather than returning null", { skip }, async () => {
  const db = openMigrated();
  const { d1 } = await seed(db);
  await assert.rejects(
    () => requireSession(d1, requestWith(mintToken())),
    (err) => err.code === "invalid_token" && err.status === 401,
    "routes map this through errorResponse, which is why the status rides the error",
  );
});

// ── the retention cage still holds after the ALTER ─────────────────────────────────────

test("purge takes an expired invite's otp row with it", { skip }, async () => {
  const db = openMigrated();
  const { d1 } = await seed(db);
  await createInvite(d1, {
    id: "inv-P", clientId: "c-1", email: "purge@example.com",
    interviewAt: at(-40), tokenHash: await hashToken(mintToken()), expiresAt: at(-26),
  });
  await issueOtp(d1, { inviteId: "inv-P", codeHash: await hashOtpCode("inv-P", "049217"), ttlMinutes: 10 });
  assert.equal(otpRows(db, "inv-P").length, 1);

  // 0004 widened a table inside decision 13's cage. If the ALTER had rebuilt the table — the
  // way adding a CHECK would have to — the foreign key could come back without its cascade,
  // and a purged candidate's codes would outlive the invite that promised to take them.
  const { purged } = await purgeExpired(d1);
  assert.equal(purged, 1, "only the 30-day-past invite purges");
  assert.equal(otpRows(db, "inv-P").length, 0, "and its otp row goes with it, by cascade");
  assert.ok(rowOf(db, "inv-L"), "the live invite is untouched");
});

// ── delete-now picks the credential the caller NAMED (PR #30 review, Medium 1) ──────────
//
// These run here, against real SQL, and not in a fake-d1 file, for the reason this whole
// file exists: the behaviour branches on `meta.changes`, and the fake hard-codes it to 1.
// "the cookie matched nothing, so fall through to the body token" is unobservable under a
// fake that says every DELETE matched — both assertions below would pass while broken.

/** A Request the delete route accepts: no Sec-Fetch-Site and no Origin is the curl path. */
const deleteRequest = ({ cookie = null, body = {} } = {}) => ({
  headers: { get: (name) => (name === "Cookie" && cookie !== null ? `${SESSION_COOKIE}=${cookie}` : null) },
  json: async () => body,
});

test("a live cookie does not outrank the token the caller asked to erase", { skip }, async () => {
  const db = openMigrated();
  const { d1, tokens } = await seed(db);

  // The kiosk case, exactly: one browser holding two invites. O has been clicked, so its
  // cookie is live and matches a row; L is still an unclicked emailed link. The caller
  // names L. Under `cookie || body` the cookie won, L was never hashed, and O — a different
  // invite, possibly a different person — was destroyed instead, under an {ok: true}.
  const response = await deleteRoute({
    request: deleteRequest({ cookie: tokens.OSession, body: { token: tokens.L } }),
    env: { DB: d1 },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, deleted: 1 });
  assert.equal(rowOf(db, "inv-L"), undefined, "the invite the caller NAMED is the one erased");
  assert.ok(rowOf(db, "inv-O"), "and the one it merely had a cookie for survives");
});

test("a rotated-out cookie erases nothing, and the answer says so", { skip }, async () => {
  const db = openMigrated();
  const { d1, tokens } = await seed(db);

  // tokens.O was rotated out by the exchange in seed(), which is ordinary after #20: signing
  // in on a second device does this to the first device's cookie. It matches no row, so no
  // statement runs — and the endpoint used to answer a bare {ok: true} to that, telling a
  // candidate their data was erased while every row of it survived.
  const response = await deleteRoute({
    request: deleteRequest({ cookie: tokens.O }),
    env: { DB: d1 },
  });

  assert.equal(response.status, 200, "still idempotent — #17's contract is unchanged");
  assert.deepEqual(await response.json(), { ok: true, deleted: 0 }, "but no longer claiming an erasure");
  assert.ok(rowOf(db, "inv-O"), "the row is still there, which is what deleted: 0 means");
});

test("the cookie is still the credential when no token is named", { skip }, async () => {
  const db = openMigrated();
  const { d1, tokens } = await seed(db);

  // #24's button cannot read the HttpOnly cookie, so it sends no body at all. The fallback
  // is the whole reason the cookie is still consulted.
  const response = await deleteRoute({
    request: deleteRequest({ cookie: tokens.OSession }),
    env: { DB: d1 },
  });

  assert.deepEqual(await response.json(), { ok: true, deleted: 1 });
  assert.equal(rowOf(db, "inv-O"), undefined, "the signed-in candidate's own invite");
  assert.ok(rowOf(db, "inv-L"), "and nothing else");
});

test("a body token that matches nothing falls through to the cookie", { skip }, async () => {
  const db = openMigrated();
  const { d1, tokens } = await seed(db);

  // Explicit-first must not mean explicit-only: a candidate pasting a spent link while
  // signed in should still erase the session they actually hold.
  const response = await deleteRoute({
    request: deleteRequest({ cookie: tokens.OSession, body: { token: tokens.O } }),
    env: { DB: d1 },
  });

  assert.deepEqual(await response.json(), { ok: true, deleted: 1 });
  assert.equal(rowOf(db, "inv-O"), undefined);
});

test("neither credential is still a 400, not an idempotent lie", { skip }, async () => {
  const db = openMigrated();
  const { d1 } = await seed(db);

  const response = await deleteRoute({ request: deleteRequest(), env: { DB: d1 } });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "missing_fields" });
});
