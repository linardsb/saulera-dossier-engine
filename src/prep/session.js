// The candidate's session guard (#20), called per route.
//
// Deliberately NOT middleware. `functions/prep/_middleware.js` runs on every /prep/* request,
// static assets included — that is #17's feature, because any portal traffic at all keeps the
// 30-day purge enforced. Putting a session check there would gate the privacy notice, which UK
// GDPR requires be readable, and the login page, which is how a candidate gets a session in
// the first place. A guard that locks you out of the door you use to get in is not a guard.
//
// So each route that holds candidate content calls requireSession itself, and the list of
// routes that deliberately do not is written down below where a reader and a test can both
// see it — rather than living in the head of whoever last touched the middleware.

import { StoreError } from "../store.js";
import { hashToken, inviteByTokenHash } from "../portal/store.js";
import { SESSION_COOKIE, maxAgeFrom, readCookie } from "./tokens.js";

/**
 * The /prep paths that must work with no session, and why each one is on the list:
 *   /prep/privacy      the retention notice — legally required to be readable
 *   /prep/login        where a candidate without a link asks for a code
 *   /prep/auth/enter   the magic link itself; the token IS the credential
 *   /prep/auth/otp     requesting that code
 *   /prep/auth/verify  spending it
 * Everything else under /prep is candidate content and calls requireSession.
 */
export const PUBLIC_PREP_PATHS = [
  "/prep/privacy",
  "/prep/login",
  "/prep/auth/enter",
  "/prep/auth/otp",
  "/prep/auth/verify",
];

/**
 * Who this request is, from the session cookie — or null, for every way of not being anyone:
 * no cookie, a forged one, one whose invite was rotated out from under it by a newer sign-in,
 * one whose invite was deleted by delete-now, and one whose invite has expired.
 *
 * Expiry is checked here rather than in the SELECT for the reason inviteByTokenHash states:
 * the row is fetched once and each caller applies its own policy. Here the policy is simply
 * "no", because a candidate with a stale cookie has nothing to be told apart — the login page
 * explains itself.
 *
 * The return value carries no token and no hash. A route needs to know WHICH invite it is
 * serving, never what unlocks it.
 */
export async function sessionFromRequest(db, request) {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;

  const invite = await inviteByTokenHash(db, await hashToken(token));
  if (!invite) return null;
  // Through maxAgeFrom rather than a second Date.parse, so this reads `expires_at` as UTC by
  // the same rule the cookie's own Max-Age used — two readings of one timestamp that disagree
  // by an hour is precisely the bug that helper exists to prevent. It floors at 0, so an
  // unparseable expiry is treated as expired: fail closed.
  if (maxAgeFrom(invite.expires_at) <= 0) return null;

  return { inviteId: invite.id, clientId: invite.client_id, expiresAt: invite.expires_at };
}

/**
 * The same, as a guard. Routes call this and let `errorResponse` map the throw — StoreError
 * carries its own status, so 401 needs no change to src/http.js.
 */
export async function requireSession(db, request) {
  const session = await sessionFromRequest(db, request);
  if (!session) throw new StoreError("invalid_token", 401, "no valid prep session");
  return session;
}
