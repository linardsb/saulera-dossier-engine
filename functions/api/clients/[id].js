// GET /api/clients/:id                  -> { client }  including the note
// PUT /api/clients/:id { name?, note? }  -> { client }  partial update
//
// PUT is the save path for the product's compounding asset, so every failure has to be precise
// enough for the screen to keep the agency's text and say what to do about it (R8). A bare 500
// where the truth is 404 or 400 makes that impossible.

import { getClient, updateClient } from "../../../src/store.js";
import { json, readJson, sameOrigin, errorResponse } from "../../../src/http.js";

export async function onRequestGet(context) {
  const { env, params } = context;

  if (!env.DB) return json({ error: "not_configured" }, 503);

  try {
    // params values are arrays for [[catchall]] routes, and it costs nothing to be certain.
    return json({ client: await getClient(env.DB, String(params.id)) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function onRequestPut(context) {
  const { request, env, params } = context;

  if (!env.DB) return json({ error: "not_configured" }, 503);
  if (!sameOrigin(request)) return json({ error: "cross_origin" }, 403);

  try {
    const body = await readJson(request);
    const patch = {};
    // Only the two fields this endpoint owns. Anything else in the body is ignored rather than
    // rejected: unlike /api/events, there is no boundary here that a stray key could breach.
    if (Object.hasOwn(body, "name")) patch.name = body.name;
    if (Object.hasOwn(body, "note")) patch.note = body.note;

    return json({ client: await updateClient(env.DB, String(params.id), patch) });
  } catch (err) {
    return errorResponse(err);
  }
}
