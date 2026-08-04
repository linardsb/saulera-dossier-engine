// #68 — the compliance cage's own door, proven against real SQL rather than recorded strings.
//
// The class of failure this file catches is exactly the one test/prep-auth.test.js was written
// for, arriving a second time at a second root. Five of this ticket's behaviours branch on
// `meta.changes` or on a row the statement before it deleted, and test/helpers/fake-d1.js
// returns `{ changes: 1 }` unconditionally and stores nothing:
//
//   OTP single-use          the DELETE on success        under the fake: no row to miss
//   the five-attempt cap    attempts, read then compared under the fake: no row to read
//   expiry                  the datetime guard           under the fake: no guard runs
//   session rotation        one credential column        under the fake: always "rotated"
//   the cascade + the purge ON DELETE CASCADE            under the fake: nothing cascades
//
// Every one of them PASSES under the fake while the logic is wrong. So they run here, against
// node:sqlite, with every migration applied in wrangler's order — the split #17 made between
// portal-store.test.js and portal-purge.test.js, and #67 made between compliance-store.test.js
// and compliance-purge.test.js.
//
// The duplicated OTP implementation is the reason the coverage is duplicated too. The portal's
// suite proves the portal's copy; nothing it asserts reaches src/compliance/store.js, and the
// comment in that file naming the two homes is a pointer, not a test.
//
// Engine: node:sqlite, which this machine's default Node 20 does not have — every test skips
// there with the remedy in the message, and Node 24 proves the rest.

import { test } from "node:test";
import assert from "node:assert/strict";

import { hashToken } from "../src/portal/store.js";
import {
  candidateByEmail,
  consumeCandidateOtp,
  createCandidate,
  deleteCandidate,
  issueCandidateOtp,
  rotateCandidateSession,
} from "../src/compliance/store.js";
import { candidateFromRequest, requireCandidate } from "../src/compliance/session.js";
import { COMPLIANCE_COOKIE, SESSION_DAYS, sessionExpiry } from "../src/compliance/tokens.js";
import { hashOtpCode, mintToken } from "../src/prep/tokens.js";
import { SESSION_COOKIE } from "../src/prep/tokens.js";
import { onRequestPost as otpRoute } from "../functions/prep/compliance/auth/otp.js";
import { onRequestPost as verifyRoute } from "../functions/prep/compliance/auth/verify.js";
import { d1Shape, openMigrated, skip } from "./helpers/sqlite-d1.js";

const otpRows = (db, candidateId) =>
  db.prepare("SELECT * FROM candidate_otp WHERE candidate_id = ?").all(candidateId);
const candidateRow = (db, id) => db.prepare("SELECT * FROM candidate WHERE id = ?").get(id);

/** A Request-shaped object carrying just the compliance cookie. `null` means no Cookie header. */
const requestWith = (token, name = COMPLIANCE_COOKIE) => ({
  headers: { get: (header) => (header === "Cookie" && token !== null ? `${name}=${token}` : null) },
});

/** No Sec-Fetch-Site and no Origin is the curl path, which `sameOrigin` allows. */
const postOf = (body) => ({ headers: { get: () => null }, json: async () => body });

/**
 * Two candidates, seeded through the real writer so each carries a full checklist:
 *   A  the one every test signs in as
 *   B  the neighbour, so "a code issued for one cannot be spent on another" has a second party
 */
async function seed(db) {
  const d1 = d1Shape(db);
  await createCandidate(d1, { id: "cand-A", fullName: "Priya Raman", email: "priya@example.com" });
  await createCandidate(d1, { id: "cand-B", fullName: "Tom Ellis", email: "Tom.Ellis@example.com" });
  return { d1 };
}

/** Sign a candidate in the way the verify route does, and hand back the raw cookie value. */
async function signIn(d1, candidateId) {
  const token = mintToken();
  await rotateCandidateSession(d1, {
    candidateId,
    newHash: await hashToken(token),
    expiresAt: sessionExpiry(),
  });
  return token;
}

// ── the lookup ─────────────────────────────────────────────────────────────────────────

test("candidateByEmail is case-insensitive and does NOT filter on expiry", { skip }, async () => {
  const db = openMigrated();
  const { d1 } = await seed(db);

  assert.equal((await candidateByEmail(d1, "PRIYA@EXAMPLE.COM"))?.id, "cand-A", "a retyped address matches");
  assert.equal((await candidateByEmail(d1, "tom.ellis@example.com"))?.id, "cand-B");
  assert.equal(await candidateByEmail(d1, "nobody@example.com"), null);

  // The whole difference from inviteByEmail, and the reason this store could not reuse it: an
  // ancient candidate is still a candidate. Only the dormancy purge removes them, and until it
  // does they can sign in — a compliance file has no interview to close it.
  db.prepare("UPDATE candidate SET created_at = datetime('now', '-11 months') WHERE id = ?").run("cand-A");
  assert.equal((await candidateByEmail(d1, "priya@example.com"))?.id, "cand-A", "age is not expiry");

  // Two columns and no third: a name reaching this far is a name one careless template from a
  // log line.
  assert.deepEqual(Object.keys(await candidateByEmail(d1, "priya@example.com")).sort(), ["email", "id"]);
});

// ── the code ───────────────────────────────────────────────────────────────────────────

test("a code is single-use — the second spend of a right code fails", { skip }, async () => {
  const db = openMigrated();
  const { d1 } = await seed(db);
  const hash = await hashOtpCode("cand-A", "049217");
  await issueCandidateOtp(d1, { candidateId: "cand-A", codeHash: hash, ttlMinutes: 10 });

  assert.deepEqual(await consumeCandidateOtp(d1, { candidateId: "cand-A", codeHash: hash, maxAttempts: 5 }), {
    ok: true,
  });
  // Single-use is the DELETE, not a flag: the row is gone, so the second call cannot find one
  // and answers exactly as a never-issued code does.
  assert.equal(otpRows(db, "cand-A").length, 0);
  assert.deepEqual(await consumeCandidateOtp(d1, { candidateId: "cand-A", codeHash: hash, maxAttempts: 5 }), {
    ok: false,
    reason: "expired",
  });
});

test("five guesses are allowed and the sixth deletes the row", { skip }, async () => {
  const db = openMigrated();
  const { d1 } = await seed(db);
  const right = await hashOtpCode("cand-A", "049217");
  const wrong = await hashOtpCode("cand-A", "000000");
  await issueCandidateOtp(d1, { candidateId: "cand-A", codeHash: right, ttlMinutes: 10 });

  // The arithmetic most likely to be "fixed" into an off-by-one. Five wrong guesses each answer
  // invalid_code and leave attempts at 5; the sixth is refused WITHOUT a comparison.
  for (let n = 1; n <= 5; n += 1) {
    assert.deepEqual(
      await consumeCandidateOtp(d1, { candidateId: "cand-A", codeHash: wrong, maxAttempts: 5 }),
      { ok: false, reason: "invalid_code" },
      `guess ${n} of 5 is answered as a wrong code`,
    );
  }
  assert.equal(otpRows(db, "cand-A")[0].attempts, 5);

  assert.deepEqual(await consumeCandidateOtp(d1, { candidateId: "cand-A", codeHash: wrong, maxAttempts: 5 }), {
    ok: false,
    reason: "too_many_attempts",
  });
  assert.equal(otpRows(db, "cand-A").length, 0, "the capped row is deleted, not just refused");

  // And the RIGHT code no longer works either — the cap took the row it was in.
  assert.deepEqual(await consumeCandidateOtp(d1, { candidateId: "cand-A", codeHash: right, maxAttempts: 5 }), {
    ok: false,
    reason: "expired",
  });
});

test("an expired code and a never-issued code answer identically", { skip }, async () => {
  const db = openMigrated();
  const { d1 } = await seed(db);
  const hash = await hashOtpCode("cand-A", "049217");
  await issueCandidateOtp(d1, { candidateId: "cand-A", codeHash: hash, ttlMinutes: 10 });
  db.prepare("UPDATE candidate_otp SET expires_at = datetime('now', '-1 minute') WHERE candidate_id = ?").run("cand-A");

  const timedOut = await consumeCandidateOtp(d1, { candidateId: "cand-A", codeHash: hash, maxAttempts: 5 });
  const neverAsked = await consumeCandidateOtp(d1, { candidateId: "cand-B", codeHash: hash, maxAttempts: 5 });
  assert.deepEqual(timedOut, { ok: false, reason: "expired" });
  assert.deepEqual(
    neverAsked,
    timedOut,
    "the difference between a code that timed out and one that was never asked for is not the " +
      "candidate's to see",
  );
});

test("a code issued for one candidate cannot be spent by another", { skip }, async () => {
  const db = openMigrated();
  const { d1 } = await seed(db);
  // The candidate id is in the hash preimage precisely for this: two locums who happen to draw
  // the same six digits must not be able to sign in as each other.
  await issueCandidateOtp(d1, { candidateId: "cand-A", codeHash: await hashOtpCode("cand-A", "049217"), ttlMinutes: 10 });
  await issueCandidateOtp(d1, { candidateId: "cand-B", codeHash: await hashOtpCode("cand-B", "049217"), ttlMinutes: 10 });

  assert.deepEqual(
    await consumeCandidateOtp(d1, { candidateId: "cand-B", codeHash: await hashOtpCode("cand-A", "049217"), maxAttempts: 5 }),
    { ok: false, reason: "invalid_code" },
  );
});

test("the cooldown coalesces a repeat request and leaves the standing code alone", { skip }, async () => {
  const db = openMigrated();
  const { d1 } = await seed(db);
  const first = await hashOtpCode("cand-A", "111111");
  const second = await hashOtpCode("cand-A", "222222");

  assert.deepEqual(
    await issueCandidateOtp(d1, { candidateId: "cand-A", codeHash: first, ttlMinutes: 10, cooldownMinutes: 1 }),
    { ok: true, issued: true },
  );
  assert.deepEqual(
    await issueCandidateOtp(d1, { candidateId: "cand-A", codeHash: second, ttlMinutes: 10, cooldownMinutes: 1 }),
    { ok: true, issued: false },
    "inside the cooldown the second request changes nothing",
  );
  const rows = otpRows(db, "cand-A");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].code_hash, first, "the row left alone is the code the candidate is typing");

  // With no cooldown the DELETE-before-INSERT still bounds how many codes are live at once.
  await issueCandidateOtp(d1, { candidateId: "cand-A", codeHash: second, ttlMinutes: 10, cooldownMinutes: 0 });
  assert.equal(otpRows(db, "cand-A").length, 1);
  assert.deepEqual(await consumeCandidateOtp(d1, { candidateId: "cand-A", codeHash: first, maxAttempts: 5 }), {
    ok: false,
    reason: "invalid_code",
  });
});

// ── the session ────────────────────────────────────────────────────────────────────────

test("a rotated session is readable from the cookie, and a forged one is not", { skip }, async () => {
  const db = openMigrated();
  const { d1 } = await seed(db);
  const token = await signIn(d1, "cand-A");

  const session = await candidateFromRequest(d1, requestWith(token));
  assert.equal(session.candidateId, "cand-A");
  // The return value carries no token, no hash and no identity — the property src/prep/session.js
  // exists to keep, at the tighter setting this surface allows.
  assert.deepEqual(Object.keys(session).sort(), ["candidateId", "expiresAt"]);

  assert.equal(await candidateFromRequest(d1, requestWith(mintToken())), null, "a forged token is nobody");
  assert.equal(await candidateFromRequest(d1, requestWith(null)), null, "no cookie is nobody");
  assert.equal(await candidateFromRequest(d1, requestWith("")), null, "an empty cookie is nobody");
});

test("the guard is blind to the prep portal's cookie, and vice versa", { skip }, async () => {
  const db = openMigrated();
  const { d1 } = await seed(db);
  const token = await signIn(d1, "cand-A");

  // A candidate holding both cookies is the ordinary case: /prep/compliance sits under /prep, so
  // Path=/prep sends the prep cookie here too. `readCookie` matches by NAME, so the neighbour is
  // never mistaken for ours — and a compliance token arriving under the prep cookie's name is
  // not a compliance session.
  assert.equal(await candidateFromRequest(d1, requestWith(token, SESSION_COOKIE)), null);
  const both = {
    headers: {
      get: (header) =>
        header === "Cookie" ? `${SESSION_COOKIE}=some-other-token; ${COMPLIANCE_COOKIE}=${token}` : null,
    },
  };
  assert.equal((await candidateFromRequest(d1, both)).candidateId, "cand-A");
});

test("a session past its expiry is nobody, and so is an unparseable one", { skip }, async () => {
  const db = openMigrated();
  const { d1 } = await seed(db);
  const token = await signIn(d1, "cand-A");

  db.prepare("UPDATE candidate SET session_expires_at = datetime('now', '-1 second') WHERE id = ?").run("cand-A");
  assert.equal(await candidateFromRequest(d1, requestWith(token)), null);

  // maxAgeFrom floors at 0, so a stamp nothing can parse is treated as expired. Fail closed —
  // written past the column's CHECK, which is what stops this state arising in the first place.
  db.prepare("PRAGMA ignore_check_constraints = ON").run();
  db.prepare("UPDATE candidate SET session_expires_at = 'not-a-date' WHERE id = ?").run("cand-A");
  assert.equal(await candidateFromRequest(d1, requestWith(token)), null);
});

test("requireCandidate throws a 401 StoreError rather than returning null", { skip }, async () => {
  const db = openMigrated();
  const { d1 } = await seed(db);

  await assert.rejects(() => requireCandidate(d1, requestWith(null)), (err) => {
    assert.equal(err.code, "invalid_token");
    assert.equal(err.status, 401);
    return true;
  });
  const token = await signIn(d1, "cand-A");
  assert.equal((await requireCandidate(d1, requestWith(token))).candidateId, "cand-A");
});

test("a second sign-in rotates the first device out", { skip }, async () => {
  const db = openMigrated();
  const { d1 } = await seed(db);
  const phone = await signIn(d1, "cand-A");
  const laptop = await signIn(d1, "cand-A");

  assert.equal(await candidateFromRequest(d1, requestWith(phone)), null, "the older cookie stops working");
  assert.equal((await candidateFromRequest(d1, requestWith(laptop))).candidateId, "cand-A");
  // One credential column, so one live session — the decision migrations/0009 was shaped around.
  assert.equal(otpRows(db, "cand-A").length, 0);
});

test("rotateCandidateSession reports false for a candidate that is gone", { skip }, async () => {
  const db = openMigrated();
  const { d1 } = await seed(db);
  await deleteCandidate(d1, "cand-A");
  assert.deepEqual(
    await rotateCandidateSession(d1, { candidateId: "cand-A", newHash: "h", expiresAt: sessionExpiry() }),
    { rotated: false },
    "delete-now on another device between the lookup and the write is a 410, not a 200",
  );
});

test("sessionExpiry lands SESSION_DAYS ahead, in the format the column accepts", { skip }, async () => {
  const db = openMigrated();
  const { d1 } = await seed(db);
  const expiresAt = sessionExpiry(new Date("2026-08-03T09:15:30Z"));
  assert.equal(expiresAt, "2026-08-17 09:15:30", `${SESSION_DAYS} days ahead, UTC, SQLite's own shape`);

  // And the column takes it: the CHECK is what would turn a hand-rolled format into a 500.
  await rotateCandidateSession(d1, { candidateId: "cand-A", newHash: "h", expiresAt });
  assert.equal(candidateRow(db, "cand-A").session_expires_at, expiresAt);
});

// ── the cage takes the credential with it ──────────────────────────────────────────────

test("deleting a candidate takes their live code with them", { skip }, async () => {
  const db = openMigrated();
  const { d1 } = await seed(db);
  await issueCandidateOtp(d1, { candidateId: "cand-A", codeHash: "h-A", ttlMinutes: 10 });
  await issueCandidateOtp(d1, { candidateId: "cand-B", codeHash: "h-B", ttlMinutes: 10 });

  assert.deepEqual(await deleteCandidate(d1, "cand-A"), { ok: true, deleted: 1 });
  assert.equal(otpRows(db, "cand-A").length, 0, "the cascade, not a second statement");
  assert.equal(otpRows(db, "cand-B").length, 1, "and only that candidate's");
});

// The dormancy purge's half of the same promise lives in test/compliance-purge.test.js, where
// the retention rules are proven — that suite owns the clock and this one owns the door.

// ── the routes ─────────────────────────────────────────────────────────────────────────

test("the otp route: three branches, one answer, one email", { skip }, async () => {
  const db = openMigrated();
  const { d1 } = await seed(db);

  const sends = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    sends.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ id: "email-1" }), { status: 200 });
  };
  try {
    const env = { DB: d1, RESEND_API_KEY: "re_test" };
    const first = await otpRoute({ request: postOf({ email: "priya@example.com" }), env });
    const standing = otpRows(db, "cand-A")[0].code_hash;
    const second = await otpRoute({ request: postOf({ email: "priya@example.com" }), env });
    const unknown = await otpRoute({ request: postOf({ email: "nobody@example.com" }), env });

    // The anti-enumeration contract, and it is sharper here than on the prep route: a status
    // that told these three apart would answer "is this person being vetted by this agency".
    for (const response of [first, second, unknown]) {
      assert.equal(response.status, 202);
      assert.deepEqual(await response.json(), { ok: true });
    }
    assert.equal(sends.length, 1, "the coalesced repeat and the unknown address send nothing");
    assert.equal(sends[0].to, "priya@example.com", "and the one email went to the candidate's own address");
    assert.equal(otpRows(db, "cand-A")[0].code_hash, standing, "the repeat left the standing code alone");
    assert.equal(otpRows(db, "cand-A").length, 1, "one live code throughout");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("the otp route answers 400 for an empty address and for a stray field", { skip }, async () => {
  const db = openMigrated();
  const { d1 } = await seed(db);
  const env = { DB: d1 };

  assert.equal((await otpRoute({ request: postOf({ email: "  " }), env })).status, 400);
  const stray = await otpRoute({ request: postOf({ email: "priya@example.com", code: "1" }), env });
  assert.equal(stray.status, 400);
  assert.deepEqual(await stray.json(), { error: "unexpected_fields", fields: ["code"] });
});

test("the verify route: a wrong code is 401 with nothing distinguishing in the body", { skip }, async () => {
  const db = openMigrated();
  const { d1 } = await seed(db);
  const env = { DB: d1 };
  await issueCandidateOtp(d1, { candidateId: "cand-A", codeHash: await hashOtpCode("cand-A", "049217"), ttlMinutes: 10 });

  const wrongCode = await verifyRoute({ request: postOf({ email: "priya@example.com", code: "000000" }), env });
  const unknownEmail = await verifyRoute({ request: postOf({ email: "nobody@example.com", code: "000000" }), env });
  assert.equal(wrongCode.status, 401);
  assert.equal(unknownEmail.status, 401);
  const wrongBody = await wrongCode.json();
  assert.deepEqual(wrongBody, { error: "invalid_code" });
  assert.deepEqual(
    await unknownEmail.json(),
    wrongBody,
    "an address nobody holds and a wrong code are the same answer, or the 202 one route " +
      "earlier bought nothing",
  );

  // A wrong LENGTH is a typo and must not burn one of the five: the attempt counter is
  // untouched by it, and only the six-digit guess above moved it.
  const short = await verifyRoute({ request: postOf({ email: "priya@example.com", code: "04921" }), env });
  assert.equal(short.status, 401);
  assert.equal(otpRows(db, "cand-A")[0].attempts, 1, "one guess spent, by the six-digit one only");
});

test("the verify route hands back the compliance cookie, scoped to its own path", { skip }, async () => {
  const db = openMigrated();
  const { d1 } = await seed(db);
  const env = { DB: d1 };
  await issueCandidateOtp(d1, { candidateId: "cand-A", codeHash: await hashOtpCode("cand-A", "049217"), ttlMinutes: 10 });

  // Pasted as the mail client shows it. The digits strip is what accepts this.
  const response = await verifyRoute({ request: postOf({ email: "PRIYA@example.com", code: "049 217" }), env });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });

  const cookie = response.headers.get("Set-Cookie");
  assert.match(cookie, new RegExp(`^${COMPLIANCE_COOKIE}=`), "the compliance cookie, not the prep one");
  assert.match(cookie, /Path=\/prep\/compliance;/, "the narrow path is what keeps it off /prep/brief");
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  assert.doesNotMatch(cookie, /Domain=/, "host-only, or it widens to every sibling on pages.dev");

  // The cookie it handed back is a working session, and the code it spent is gone.
  const token = cookie.slice(COMPLIANCE_COOKIE.length + 1, cookie.indexOf(";"));
  assert.equal((await candidateFromRequest(d1, requestWith(token))).candidateId, "cand-A");
  assert.equal(otpRows(db, "cand-A").length, 0, "single-use: the code was spent by the sign-in");
});

test("the verify route answers 410 once the code has expired, and 429 once capped", { skip }, async () => {
  const db = openMigrated();
  const { d1 } = await seed(db);
  const env = { DB: d1 };
  const right = await hashOtpCode("cand-A", "049217");

  await issueCandidateOtp(d1, { candidateId: "cand-A", codeHash: right, ttlMinutes: 10 });
  db.prepare("UPDATE candidate_otp SET expires_at = datetime('now', '-1 minute') WHERE candidate_id = ?").run("cand-A");
  assert.equal((await verifyRoute({ request: postOf({ email: "priya@example.com", code: "049217" }), env })).status, 410);

  await issueCandidateOtp(d1, { candidateId: "cand-A", codeHash: right, ttlMinutes: 10, cooldownMinutes: 0 });
  db.prepare("UPDATE candidate_otp SET attempts = 5 WHERE candidate_id = ?").run("cand-A");
  assert.equal((await verifyRoute({ request: postOf({ email: "priya@example.com", code: "049217" }), env })).status, 429);
});

test("both auth routes answer 503 with no binding and 403 cross-origin", { skip }, async () => {
  const db = openMigrated();
  const { d1 } = await seed(db);
  const crossOrigin = {
    headers: { get: (name) => (name === "Sec-Fetch-Site" ? "cross-site" : null) },
    json: async () => ({ email: "priya@example.com" }),
  };
  for (const route of [otpRoute, verifyRoute]) {
    assert.equal((await route({ request: postOf({ email: "priya@example.com" }), env: {} })).status, 503);
    assert.equal((await route({ request: crossOrigin, env: { DB: d1 } })).status, 403);
  }
});
