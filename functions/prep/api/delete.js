// POST /prep/api/delete { token? } -> 200 { ok: true, deleted: 0 | 1 }
//
// The day-one delete-now (#17, decision 13): the same scope the automatic purge takes,
// immediately. Idempotent 200 by design — a candidate holding a stale link is already in
// the clean state the button promises, and a not-found would make it lie. The raw token is
// hashed in-memory and never stored or logged. POST only, no GET handler: a delete
// reachable by URL-click gets prefetched by mail scanners.
//
// #20 made the cookie the primary credential, and this route had to follow or break. The
// emailed token now dies at first click — /prep/auth/enter rotates it — so a body token is
// only ever the token a candidate has not spent yet. Afterwards the live credential is in an
// HttpOnly cookie, which is by design unreadable to #24's delete button: the button sends no
// token, and the cookie is the only thing it has.
//
// THE BODY TOKEN WINS, and the cookie is the fallback. The first cut had it the other way
// round and wrote it as `cookie || body`, which made the cookie unconditional: whenever any
// session cookie was present the body token was never hashed and never consulted. One
// browser can hold two invites — a clicked A and an emailed, unclicked B — so a candidate
// asking to erase B erased A instead, and was told `{ok: true}`. On a shared or kiosk
// machine the two invites need not even belong to the same person. An erase names its
// target; an ambient credential must not silently outrank the named one.
//
// The cookie is still tried, but only after an explicit token matched nothing — which is
// both the ordinary signed-in case (#24's button, no body at all) and the reason the store
// now reports `deleted` rather than a bare ok.

import { deleteInviteByTokenHash, hashToken } from "../../../src/portal/store.js";
import { clearCookie, readCookie } from "../../../src/prep/tokens.js";
import { json, readJson, sameOrigin, errorResponse } from "../../../src/http.js";

// The whole body vocabulary. Answering 400 on anything else is what keeps this endpoint
// from quietly growing fields — same three-line rule as /api/events. `token` is now OPTIONAL
// rather than required, but it is still the only key this endpoint accepts.
const ALLOWED = new Set(["token"]);

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.DB) return json({ error: "not_configured" }, 503);
  if (!sameOrigin(request)) return json({ error: "cross_origin" }, 403);

  try {
    const body = await readJson(request);
    const unexpected = Object.keys(body ?? {}).filter((key) => !ALLOWED.has(key));
    if (unexpected.length) {
      return json({ error: "unexpected_fields", fields: unexpected }, 400);
    }

    const bodyToken = String(body.token ?? "").trim();
    const cookieToken = readCookie(request);
    // Still a 400 with neither. An erase with nothing naming what to erase is a caller fault
    // — and answering the idempotent {ok: true} to it would tell a candidate their data was
    // deleted when no statement ran.
    if (!bodyToken && !cookieToken) return json({ error: "missing_fields" }, 400);

    let deleted = 0;
    if (bodyToken) {
      ({ deleted } = await deleteInviteByTokenHash(env.DB, await hashToken(bodyToken)));
    }
    if (!deleted && cookieToken) {
      ({ deleted } = await deleteInviteByTokenHash(env.DB, await hashToken(cookieToken)));
    }
    // Clear the session on the way out. A candidate who just erased everything must not keep
    // a cookie pointing at a row that no longer exists — every /prep page would bounce them
    // to the login screen with no explanation, which reads like the delete failed.
    //
    // `deleted` is reported rather than flattened away. The 200 stays idempotent, so nothing
    // #17 decided changes; but a stale credential now answers `{ok: true, deleted: 0}`
    // instead of claiming an erasure that never ran, and #24 can say which happened.
    return new Response(JSON.stringify({ ok: true, deleted }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "Set-Cookie": clearCookie(),
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
