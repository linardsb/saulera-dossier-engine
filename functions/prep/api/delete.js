// POST /prep/api/delete { token? } -> 200 { ok: true }
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
// HttpOnly cookie, which is by design unreadable to #24's delete button. Cookie first, body
// second: the cookie is what a signed-in candidate has, and the body is what someone holding
// a fresh, unclicked link has. Both are the candidate; neither is anyone else.

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

    const token = readCookie(request) || String(body.token ?? "").trim();
    // Still a 400 with neither. An erase with nothing naming what to erase is a caller fault
    // — and answering the idempotent {ok: true} to it would tell a candidate their data was
    // deleted when no statement ran.
    if (!token) return json({ error: "missing_fields" }, 400);

    await deleteInviteByTokenHash(env.DB, await hashToken(token));
    // Clear the session on the way out. A candidate who just erased everything must not keep
    // a cookie pointing at a row that no longer exists — every /prep page would bounce them
    // to the login screen with no explanation, which reads like the delete failed.
    return new Response(JSON.stringify({ ok: true }), {
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
