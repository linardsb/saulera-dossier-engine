// POST /prep/api/delete { token } -> 200 { ok: true }
//
// The day-one delete-now (#17, decision 13): the same scope the automatic purge takes,
// immediately. Idempotent 200 by design — a candidate holding a stale link is already in
// the clean state the button promises, and a not-found would make it lie. The raw token is
// hashed in-memory and never stored or logged. POST only, no GET handler: a delete
// reachable by URL-click gets prefetched by mail scanners.

import { deleteInviteByTokenHash, hashToken } from "../../../src/portal/store.js";
import { json, readJson, sameOrigin, errorResponse } from "../../../src/http.js";

// The whole body vocabulary. Answering 400 on anything else is what keeps this endpoint
// from quietly growing fields — same three-line rule as /api/events.
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

    const token = String(body.token ?? "").trim();
    if (!token) return json({ error: "missing_fields" }, 400);

    await deleteInviteByTokenHash(env.DB, await hashToken(token));
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
