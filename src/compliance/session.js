// The candidate's compliance-session guard (#68), called per route.
//
// Deliberately NOT middleware, and deliberately NOT an extension of src/prep/session.js.
//
// Not middleware for the reason that file's header gives: functions/prep/_middleware.js runs on
// every /prep/* request including static assets, which is #17's feature — any portal traffic at
// all keeps both retention promises enforced. A session check there would gate the sign-in page
// a candidate needs in order to get a session, and a guard that locks you out of the door you
// use to get in is not a guard.
//
// Not an extension because these are TWO INDEPENDENT GUARDS OVER TWO INDEPENDENT COOKIES. A
// candidate holding both `prep_session` and `compliance_session` is the ordinary case — the
// compliance tree sits under /prep, so the prep cookie's Path=/prep sends it here too — and
// neither guard may ever see the other's credential. This file therefore imports nothing from
// src/prep/session.js: the shared parts are the primitives (`readCookie`, `maxAgeFrom`), which
// come from src/prep/tokens.js and know nothing about either session.

import { StoreError } from "../store.js";
import { hashToken } from "../portal/store.js";
import { maxAgeFrom, readCookie } from "../prep/tokens.js";
import { candidateBySessionHash } from "./store.js";
import { COMPLIANCE_COOKIE } from "./tokens.js";

/**
 * Which candidate this request is, from the compliance cookie — or null, for every way of not
 * being anyone: no cookie, a forged one, one rotated out from under it by a newer sign-in on
 * another device, one whose candidate was erased by delete-now or by the dormancy purge, and
 * one whose session has simply run out.
 *
 * Expiry is applied here rather than in the SELECT for the reason `candidateBySessionHash`
 * states: one read, and the caller owns the policy. Here the policy is "no", because a
 * candidate with a stale cookie has nothing to be told apart — the sign-in page explains
 * itself. Through `maxAgeFrom` rather than a second `Date.parse`, so this reads
 * `session_expires_at` as UTC by the same rule the cookie's own Max-Age used; it floors at 0,
 * so an unparseable stamp is treated as expired. Fail closed.
 *
 * THE RETURN VALUE CARRIES NO TOKEN AND NO HASH, and no identity either — src/prep/session.js's
 * property, kept at the tighter setting this surface allows. A route needs to know WHICH
 * candidate it is serving and never what unlocks them; and because nothing in the passport
 * greets anyone by name, there is no reason for an email or a name to travel this far.
 */
export async function candidateFromRequest(db, request) {
  const token = readCookie(request, COMPLIANCE_COOKIE);
  if (!token) return null;

  const candidate = await candidateBySessionHash(db, await hashToken(token));
  if (!candidate) return null;
  if (maxAgeFrom(candidate.session_expires_at) <= 0) return null;

  return { candidateId: candidate.id, expiresAt: candidate.session_expires_at };
}

/**
 * The same, as a guard. Routes call this and let `errorResponse` map the throw — StoreError
 * carries its own status, so 401 needs no change to src/http.js.
 */
export async function requireCandidate(db, request) {
  const candidate = await candidateFromRequest(db, request);
  if (!candidate) throw new StoreError("invalid_token", 401, "no valid compliance session");
  return candidate;
}
