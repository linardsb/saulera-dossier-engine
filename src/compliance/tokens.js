// The compliance passport's credential, serialised (#68). Pure: no D1, no env, no Response.
//
// A SECOND COOKIE, not a widened first one. `src/prep/tokens.js` already mints tokens and
// codes and this file imports none of that work — what it adds is one cookie name and one
// path, because those two values are the whole security boundary between the two candidate
// surfaces. Widening `sessionCookie()` to take a name and a path would put both regimes'
// credentials through one function whose every call site would then have to be read to know
// which cookie it built; the house has already made this call in the other direction and
// written down why (`functions/prep/auth/verify.js:21-23`: "two small duplications rather
// than one shared risk").
//
// PATH IS THE POINT. `Path=/prep/compliance` means the browser sends this cookie to the
// passport's own routes and nowhere else — never to /prep/brief, never to /prep/session. That
// is exactly what `Path=/prep` does for the prep session against /api/* and /clients.html
// (tokens.js:66-69), one level deeper. The reverse direction is harmless and deliberately not
// prevented: the prep cookie DOES ride requests to /prep/compliance/*, and `readCookie` splits
// on the first `=` and matches by name, so a neighbour cookie is never mistaken for ours.
//
// The generic primitives — mintToken, mintOtpCode, hashOtpCode, readCookie, maxAgeFrom — are
// imported from ../prep/tokens.js at the call sites and deliberately NOT re-exported here. One
// definition of "a token is 32 CSPRNG bytes", and a reader chasing it lands in the file that
// explains it rather than in a forwarding line.

import { addDays, toSqliteUtc } from "../prep/dates.js";

export const COMPLIANCE_COOKIE = "compliance_session";

/**
 * How long a compliance sign-in lasts.
 *
 * The portal's answer does not transfer. There, the cookie dies exactly when the invite does
 * (`maxAgeFrom(invite.expires_at)`, decision 11) because an interview ends; a compliance file
 * has no such event — it is durable by design, which is the whole reason spike #66 gave it a
 * root of its own. So this is a number rather than a derivation, and it is this plan's call,
 * not the architecture doc's.
 *
 * Fourteen days: long enough that a locum chasing a certificate over a fortnight is not
 * re-authenticating in the middle of the task, short enough that a lost phone loses access
 * inside a window this product already accepts for the prep cookie. It is one constant and one
 * test away from changing, and if the owner wants tighter for special-category data that is a
 * one-line change.
 */
export const SESSION_DAYS = 14;

/**
 * The compliance session cookie. Every attribute carries the reason `sessionCookie` states,
 * and one of them differs:
 *
 *   Path=/prep/compliance  the narrower scope described in the header — the whole reason this
 *                          function exists rather than a second call to sessionCookie().
 *   HttpOnly               no candidate-facing script has any reason to read this. The delete
 *                          button sends it by being same-origin, not by reading it.
 *   Secure                 the portal is HTTPS-only; a cookie that would travel in clear is a bug.
 *   SameSite=Lax           NOT Strict, even though nothing emails a link to this surface today.
 *                          Strict is dropped on exactly the top-level cross-site navigation a
 *                          future emailed link would arrive by, so choosing it here would leave
 *                          a trap for whoever adds that link — they would land signed out with
 *                          nothing on the page saying why.
 *
 * No Domain attribute, so the cookie stays host-only: adding one would widen it to every
 * sibling host on pages.dev.
 */
export function complianceCookie(token, maxAgeSeconds) {
  return `${COMPLIANCE_COOKIE}=${token}; Max-Age=${maxAgeSeconds}; Path=/prep/compliance; HttpOnly; Secure; SameSite=Lax`;
}

/** The same cookie, expired. Attributes must match or the browser sets a second cookie. */
export function clearComplianceCookie() {
  return `${COMPLIANCE_COOKIE}=; Max-Age=0; Path=/prep/compliance; HttpOnly; Secure; SameSite=Lax`;
}

/**
 * When a session minted now runs out, in the format `candidate.session_expires_at` accepts —
 * SQLite's 'YYYY-MM-DD HH:MM:SS', UTC.
 *
 * Through `src/prep/dates.js` rather than hand-rolled, and specifically NOT through
 * `setDate(d.getDate() + 14)`: that is a LOCAL-time mutator, so across a BST boundary it keeps
 * the wall-clock hour and moves the UTC instant by an hour (dates.js:79-85). An hour of drift
 * here is a cookie that outlives its row or a candidate signed out early, which is the same
 * class of bug `maxAgeFrom`'s `Z` rule exists to prevent, arriving through a different door.
 */
export function sessionExpiry(now = new Date()) {
  return addDays(toSqliteUtc(now.toISOString()), SESSION_DAYS);
}
