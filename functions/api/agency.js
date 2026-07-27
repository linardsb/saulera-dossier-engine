// GET /api/agency                                        -> { agency }
// PUT /api/agency { name?, send_format?, renderer? }      -> { agency }
//
// One row per deployment, holding the two things read at generation and render time. Branding
// is not here: it lives in public/tokens.css because it has to apply before first paint and
// cannot wait on a fetch (#5, Decision 6).

import { getAgency, updateAgency } from "../../src/store.js";
import { json, readJson, sameOrigin, errorResponse } from "../../src/http.js";

export async function onRequestGet(context) {
  const { env } = context;

  if (!env.DB) return json({ error: "not_configured" }, 503);

  try {
    return json({ agency: await getAgency(env.DB) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function onRequestPut(context) {
  const { request, env } = context;

  if (!env.DB) return json({ error: "not_configured" }, 503);
  if (!sameOrigin(request)) return json({ error: "cross_origin" }, 403);

  try {
    const body = await readJson(request);
    const patch = {};
    for (const field of ["name", "send_format", "renderer"]) {
      if (Object.hasOwn(body, field)) patch[field] = body[field];
    }
    return json({ agency: await updateAgency(env.DB, patch) });
  } catch (err) {
    return errorResponse(err);
  }
}
