// POST /api/events { client_id, duration_ms } -> 201 { ok: true }
// GET  /api/events                            -> { total, per_client: [{ client_id, packs, invites_sent, invites_opened }] }
//
// AC4, and the runtime half of the mechanism that keeps it true. The schema test fails on a
// fifth events column and the store test fails on events SQL that mentions a forbidden one;
// this endpoint fails on a body that carries one.

import { recordEvent, eventCounts } from "../../src/store.js";
import { json, readJson, sameOrigin, errorResponse } from "../../src/http.js";

// The whole body vocabulary. #6 is the caller, and this is the one place a well-meaning change
// could start writing candidate data into the deployment — a candidate_name added "just for
// debugging" breaches the one boundary architecture §5.6 calls expensive to unpick. Answering
// 400 rather than ignoring the key is what makes that fail loudly, and it costs three lines.
const ALLOWED = new Set(["client_id", "duration_ms"]);

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

    // The timestamp is the database's, never the caller's: a caller who can set the time can
    // rewrite the metric.
    await recordEvent(env.DB, {
      clientId: body.client_id,
      durationMs: body.duration_ms,
    });
    return json({ ok: true }, 201);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function onRequestGet(context) {
  const { env } = context;

  if (!env.DB) return json({ error: "not_configured" }, 503);

  try {
    return json(await eventCounts(env.DB));
  } catch (err) {
    return errorResponse(err);
  }
}
