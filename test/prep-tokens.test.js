// #20 — the credential itself, and the cookie that carries it.
//
// The class of failure this file catches: a token that looks random and is not, and a cookie
// whose attributes quietly loosen. Both fail silently in every other test — a predictable
// token still round-trips through the store, and a cookie missing HttpOnly still signs a
// candidate in. Neither shows up until someone is reading a stranger's prep.
//
// Not to be confused with test/tokens.test.js, which is the CSS contrast gate over
// public/tokens.css. This file is about secrets; that one is about colour.

import { test } from "node:test";
import assert from "node:assert/strict";

import { hashToken } from "../src/portal/store.js";
import {
  SESSION_COOKIE,
  clearCookie,
  hashOtpCode,
  maxAgeFrom,
  mintOtpCode,
  mintToken,
  readCookie,
  sessionCookie,
} from "../src/prep/tokens.js";

/** A Request-shaped object with just the header surface readCookie touches. */
const withCookie = (value) => ({
  headers: { get: (name) => (name === "Cookie" && value !== undefined ? value : null) },
});

// ── the token: wide, uniform, and URL-safe ─────────────────────────────────────────────

test("mintToken returns 43 base64url characters and nothing that needs escaping", () => {
  const token = mintToken();
  // 32 bytes is 43 base64 characters plus one '=' of padding, which is stripped. A token
  // that arrives shorter means the byte count moved; one carrying '+', '/' or '=' would be
  // mangled by the query string it travels in and the candidate would land on ?e=invalid.
  assert.match(token, /^[A-Za-z0-9_-]{43}$/, `not URL-safe base64url: ${token}`);
  assert.equal(encodeURIComponent(token), token, "a token must survive a URL untouched");
});

test("1000 tokens are 1000 distinct values", () => {
  // The cheapest test there is for the failure that matters most: a mint that stops drawing
  // fresh randomness — a cached buffer, a seeded PRNG, a `Math.random()` "simplification" —
  // and starts handing every candidate the same door key.
  const seen = new Set();
  for (let i = 0; i < 1000; i++) seen.add(mintToken());
  assert.equal(seen.size, 1000, "a repeated token means the mint stopped being random");
});

// ── the six-digit code, which is a string ──────────────────────────────────────────────

test("mintOtpCode is always exactly six digits, and leading zeros survive", () => {
  let leadingZero = 0;
  for (let i = 0; i < 1000; i++) {
    const code = mintOtpCode();
    assert.match(code, /^\d{6}$/, `not six digits: ${JSON.stringify(code)}`);
    if (code.startsWith("0")) leadingZero++;
  }
  // ~10% of draws start with '0'; the odds of none in 1000 are about 1 in 10^45. If this
  // fails, someone made the code a number: Number('000123') is 123, which is a three-digit
  // code in a space the attempt cap of 5 was never sized for.
  assert.ok(leadingZero > 0, "no code in 1000 started with 0 — the code became a number");
});

test("codes spread across the whole space rather than clustering", () => {
  // A weak guard against modulo bias and against a draw narrower than it looks (a Uint8Array
  // read as if it were 32 bits would top out at 255). Ten buckets, 2000 draws: every bucket
  // should land near 200, and an empty one means a whole tenth of the space is unreachable.
  const buckets = new Array(10).fill(0);
  for (let i = 0; i < 2000; i++) buckets[Number(mintOtpCode()[0])]++;
  for (const [digit, n] of buckets.entries()) {
    assert.ok(n > 60, `codes starting with ${digit} came up only ${n} times in 2000`);
  }
});

// ── the otp hash, bound to its invite ──────────────────────────────────────────────────

test("hashOtpCode binds the code to its invite: the same six digits hash differently", async () => {
  // Without the invite id in the preimage, `code_hash` is a digest of a value from a
  // 10^6 space — a lookup table anyone can build in seconds — and one leaked table would
  // read every outstanding code on the deployment at once.
  assert.notEqual(
    await hashOtpCode("inv-1", "000123"),
    await hashOtpCode("inv-2", "000123"),
    "two invites sharing a code must not share a hash",
  );
});

test("the otp preimage is exactly `${inviteId}:${code}`", async () => {
  // Pinning the SHAPE, not a digest constant. If the separator or the order changes, every
  // otp row already issued stops verifying and every returning candidate is locked out with
  // no error that says why — a silent break the deployment discovers from support email.
  assert.equal(await hashOtpCode("inv-1", "000123"), await hashToken("inv-1:000123"));
});

// ── the cookie, attribute by attribute ─────────────────────────────────────────────────

test("sessionCookie carries every attribute that makes it safe, and no Domain", () => {
  const cookie = sessionCookie("abc", 60);

  assert.ok(cookie.startsWith(`${SESSION_COOKIE}=abc;`), `wrong name or value: ${cookie}`);
  for (const attribute of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/prep", "Max-Age=60"]) {
    assert.ok(cookie.includes(attribute), `the session cookie lost ${attribute}: ${cookie}`);
  }
  // Lax and not Strict, said as an assertion because "tightening" it to Strict looks like an
  // improvement and would break the magic link: Strict is dropped on the top-level navigation
  // from a mail client, which is the only way this cookie is ever first set.
  assert.ok(!cookie.includes("SameSite=Strict"), "Strict breaks the one click this ticket exists for");
  // Host-only by omission. A Domain attribute would hand the candidate's credential to every
  // sibling host on pages.dev.
  assert.ok(!/domain=/i.test(cookie), `the cookie must stay host-only: ${cookie}`);
});

test("clearCookie empties the value and matches the set cookie's attributes", () => {
  const cleared = clearCookie();
  assert.ok(cleared.includes("Max-Age=0"), "a clear is Max-Age=0");
  assert.ok(cleared.startsWith(`${SESSION_COOKIE}=;`), "the value must be emptied");
  // Path must match the cookie being cleared, or the browser keeps the original and sets a
  // second one beside it — delete-now would answer ok while the candidate stayed signed in.
  for (const attribute of ["Path=/prep", "HttpOnly", "Secure", "SameSite=Lax"]) {
    assert.ok(cleared.includes(attribute), `clearCookie lost ${attribute}: ${cleared}`);
  }
});

// ── reading a cookie off a request that carries several ────────────────────────────────

test("readCookie finds its own value among neighbours, spaces and all", () => {
  const request = withCookie(`CF_Authorization=xyz; ${SESSION_COOKIE}=wanted;  other=z`);
  assert.equal(readCookie(request), "wanted");
  assert.equal(readCookie(request, "other"), "z", "trailing cookies parse too");
});

test("readCookie splits on the first = only, so a neighbour's value survives", () => {
  // Access's own cookie on this hostname is a JWT, and base64 padding is '='. Splitting on
  // every '=' would truncate it — and a name matched against a fragment is worse than a
  // truncated value.
  const request = withCookie(`CF_Authorization=a.b.c==; ${SESSION_COOKIE}=tok`);
  assert.equal(readCookie(request, "CF_Authorization"), "a.b.c==");
  assert.equal(readCookie(request), "tok");
});

test("readCookie returns null when absent, when the header is missing, and on junk", () => {
  assert.equal(readCookie(withCookie("other=1")), null, "absent cookie");
  assert.equal(readCookie(withCookie()), null, "no Cookie header at all");
  assert.equal(readCookie(withCookie("")), null, "an empty header is not a cookie");
  assert.equal(readCookie(withCookie("novalue; other=1")), null, "a nameless fragment is skipped");
  // A prefix must not match: `xprep_session` is a different cookie, and returning its value
  // would let any other cookie on the hostname impersonate the session.
  assert.equal(readCookie(withCookie(`x${SESSION_COOKIE}=nope`)), null, "names match whole, not by suffix");
});

// ── Max-Age from a SQLite timestamp, in UTC ────────────────────────────────────────────

test("maxAgeFrom reads SQLite's space-separated string as UTC, not local time", () => {
  // The explicit `now` is the point of the test: with the wall clock this passes in London
  // in January and fails in July, which is the drift the 'Z' exists to remove. An hour of
  // error either signs a candidate out early or leaves the cookie alive past the invite.
  const now = new Date("2026-07-28T12:00:00Z");
  assert.equal(maxAgeFrom("2026-07-28 13:00:00", now), 3600, "one hour ahead is 3600 seconds");
  assert.equal(maxAgeFrom("2026-08-11 12:00:00", now), 14 * 24 * 3600, "decision 11's 14 days");
});

test("maxAgeFrom floors at 0 for a past or unreadable timestamp", () => {
  const now = new Date("2026-07-28T12:00:00Z");
  assert.equal(maxAgeFrom("2026-07-28 11:00:00", now), 0, "an hour ago is 0, never negative");
  assert.equal(maxAgeFrom("2026-07-28 12:00:00", now), 0, "the exact boundary has nothing left to give");
  // A negative Max-Age is a session cookie that outlives the browser tab, so an unparseable
  // expires_at must fail closed rather than fall through to "until you close the window".
  assert.equal(maxAgeFrom("next Tuesday", now), 0, "unparseable fails closed");
});

test("maxAgeFrom respects a timestamp that already states its zone", () => {
  const now = new Date("2026-07-28T12:00:00Z");
  assert.equal(maxAgeFrom("2026-07-28T13:00:00Z", now), 3600, "an ISO 'Z' form is not re-stamped");
  assert.equal(maxAgeFrom("2026-07-28T14:00:00+01:00", now), 3600, "an offset is honoured as written");
});
