// The candidate's credential, minted and serialised (#20). Pure: no D1, no env, no Response,
// no imports beyond the hash the portal store already owns — which is what makes every rule
// below directly testable in `node --test`.
//
// The one property this module exists to keep: a raw token lives in exactly two places, the
// candidate's email or their cookie, and this function's return value on the way there.
// Everywhere else — the database, a log line, a query string we generate — it is a hash.
//
// `crypto` is global in the Workers runtime and on Node 20+, so there is deliberately no
// `node:crypto` import: that module does not exist at the edge and importing it would break
// every Function that reaches this file.

import { hashToken } from "../portal/store.js";

// 256 bits. Guessing a value this wide is not the threat model — the emailed link and the
// cookie are, and both are stolen rather than guessed. The size is here so that brute force
// never becomes the cheap attack as the rest of the design changes around it.
export const TOKEN_BYTES = 32;

export const SESSION_COOKIE = "prep_session";

/** A magic-link or session token: 43 base64url characters, from 32 CSPRNG bytes. */
export function mintToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_BYTES));
  // base64url by hand rather than by dependency: `btoa` is global in both runtimes, and the
  // three substitutions are the whole difference from base64. The `=` padding is stripped
  // because it survives a URL only as %3D and buys nothing back.
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * A six-digit returning-login code, as a STRING.
 *
 * Rejection-sampled, not `% 1e6` on a raw draw: 2^32 is not a multiple of 10^6, so the plain
 * modulo makes the first 4,967,296 values fractionally likelier than the rest. Redrawing above
 * the largest clean multiple removes the bias for the cost of one extra draw in ~1,400.
 *
 * It is a string and never a number, because '000123' is a valid code and `Number('000123')`
 * is 123 — a six-digit code that silently becomes three digits is a code space 1,000× smaller
 * than the one the attempt cap was sized against. test/prep-tokens.test.js fails loudly if
 * anyone tidies this into an integer.
 */
export function mintOtpCode() {
  const LIMIT = 4_294_000_000; // 4294 × 10^6, the largest multiple of 10^6 below 2^32
  let n;
  do {
    n = crypto.getRandomValues(new Uint32Array(1))[0];
  } while (n >= LIMIT);
  return String(n % 1_000_000).padStart(6, "0");
}

/**
 * The hash an otp row stores. The invite id is in the preimage on purpose: six digits is a
 * 10^6 space, so an unsalted digest of a code is a lookup table anyone can precompute in
 * seconds. Binding the hash to the invite it was issued for makes a stolen `code_hash`
 * useless without the row it came from, and means two candidates holding the same six digits
 * never collide.
 */
export async function hashOtpCode(inviteId, code) {
  return hashToken(`${inviteId}:${code}`);
}

/**
 * The session cookie, with every attribute load-bearing:
 *
 *   Path=/prep     one hostname serves two audiences (#20, decision 18). The candidate's
 *                  credential must never ride a request to the recruiter's tool, and scoping
 *                  the path is what keeps it off /api/* and /clients.html entirely.
 *   HttpOnly       no candidate-facing script has any reason to read this. #24's delete
 *                  button sends the cookie by being same-origin, not by reading it.
 *   Secure         the portal is HTTPS-only; a cookie that would travel in clear is a bug.
 *   SameSite=Lax   NOT Strict. The only way this cookie is ever first set is a top-level
 *                  navigation from a mail client, which is by definition cross-site, and
 *                  Strict is dropped on exactly that navigation — the candidate would land
 *                  signed out on the one click the whole ticket exists to make work.
 *
 * There is deliberately no Domain attribute: without one the cookie is host-only, and adding
 * one would widen it to every sibling host on pages.dev.
 */
export function sessionCookie(token, maxAgeSeconds) {
  return `${SESSION_COOKIE}=${token}; Max-Age=${maxAgeSeconds}; Path=/prep; HttpOnly; Secure; SameSite=Lax`;
}

/** The same cookie, expired. Attributes must match or the browser sets a second cookie. */
export function clearCookie() {
  return `${SESSION_COOKIE}=; Max-Age=0; Path=/prep; HttpOnly; Secure; SameSite=Lax`;
}

/**
 * One cookie's value off a request, or null.
 *
 * It parses EVERY cookie on the request, not just ours — Cloudflare Access sets its own on
 * this hostname — so it splits on the first `=` only: any other cookie's value may legally
 * contain one, and splitting on all of them would truncate a neighbour and, worse, could
 * match a fragment as if it were a name.
 */
export function readCookie(request, name = SESSION_COOKIE) {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  for (const pair of header.split(";")) {
    const at = pair.indexOf("=");
    if (at === -1) continue;
    if (pair.slice(0, at).trim() === name) return pair.slice(at + 1).trim();
  }
  return null;
}

/**
 * Whole seconds from `now` until a SQLite datetime string, floored at 0 — the cookie's
 * Max-Age, so the session dies exactly when the invite does (decision 11: interview + 14d).
 *
 * The `T` and the `Z` are the load-bearing part. SQLite writes 'YYYY-MM-DD HH:MM:SS' in UTC
 * with nothing saying so, and `Date.parse` reads a space-separated string as LOCAL time. In
 * British Summer Time that is an hour of drift in whichever direction hurts: the cookie
 * outliving the invite, or a candidate signed out an hour early with a link that still says
 * it works. Naming the zone explicitly is the fix, and it is why the test passes an explicit
 * UTC `now` rather than trusting the wall clock it happens to run on.
 */
export function maxAgeFrom(expiresAt, now = new Date()) {
  const iso = String(expiresAt).trim().replace(" ", "T");
  // Already zoned (an ISO 'Z' or a ±hh:mm offset) — leave it; otherwise it is SQLite's UTC.
  const stamped = /[Zz]$|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`;
  const seconds = Math.floor((Date.parse(stamped) - now.getTime()) / 1000);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}
