// GET /api/clients/:id                                  -> { client, fields }  including the note
// PUT /api/clients/:id { name?, note?, visibility? }      -> { client, fields }  partial update
// DELETE /api/clients/:id                                -> { ok, name }
//
// `fields` (#18) is the note's own markdown sections — `{ key, heading, chars,
// candidate_visible }` each — and never their body text: the recruiter is reading the note in
// the textarea, so a second copy of the same personal data on the wire buys nothing. `client`
// keeps exactly the shape it always had, because public/app.js reads this endpoint too.
//
// `visibility` is `{ [field_key]: boolean }`, the recruiter ticking which sections a candidate
// may see. Presence is permission and the default is hidden, so a key absent from the note is
// rejected rather than stored (`unknown_field`).
//
// PUT is the save path for the product's compounding asset, so every failure has to be precise
// enough for the screen to keep the agency's text and say what to do about it (R8). A bare 500
// where the truth is 404 or 400 makes that impossible.
//
// DELETE removes the client, its note, its events and its visibility rows (the schema
// cascades). It is the screen's job to make that deliberate — the API's job is only to be
// same-origin and precise.

import {
  clientWithFields,
  updateClient,
  deleteClient,
  setFieldVisibility,
  StoreError,
} from "../../../src/store.js";
import { json, readJson, sameOrigin, errorResponse } from "../../../src/http.js";

export async function onRequestGet(context) {
  const { env, params } = context;

  if (!env.DB) return json({ error: "not_configured" }, 503);

  try {
    // params values are arrays for [[catchall]] routes, and it costs nothing to be certain.
    return json(await clientWithFields(env.DB, String(params.id)));
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
    const id = String(params.id);
    const patch = {};
    // Only the fields this endpoint owns. Anything else in the body is ignored rather than
    // rejected: unlike /api/events, there is no boundary here that a stray key could breach.
    if (Object.hasOwn(body, "name")) patch.name = body.name;
    if (Object.hasOwn(body, "note")) patch.note = body.note;

    if (Object.hasOwn(body, "visibility")) {
      const { visibility } = body;
      // readJson already rejects a null/array/scalar BODY; this is the same rule one level in.
      if (visibility === null || typeof visibility !== "object" || Array.isArray(visibility)) {
        throw new StoreError("missing_fields", 400, "visibility: must be an object of field keys");
      }
      // The note first, then the permissions. The editor never sends both, but the other order
      // would validate the ticked keys against the note as it was BEFORE the save, so ticking a
      // heading in the same request that introduced it would be a spurious `unknown_field`.
      if (Object.keys(patch).length) await updateClient(env.DB, id, patch);
      return json(await setFieldVisibility(env.DB, id, visibility));
    }

    // No visibility key: exactly the path this endpoint always had, including updateClient's
    // `missing_fields` on a body with nothing to change. Only the response grew a sibling key.
    await updateClient(env.DB, id, patch);
    return json(await clientWithFields(env.DB, id));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function onRequestDelete(context) {
  const { request, env, params } = context;

  if (!env.DB) return json({ error: "not_configured" }, 503);
  if (!sameOrigin(request)) return json({ error: "cross_origin" }, 403);

  try {
    return json(await deleteClient(env.DB, String(params.id)));
  } catch (err) {
    return errorResponse(err);
  }
}
