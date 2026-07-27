// GET  /api/clients            -> { clients: [{ id, name, updated_at, note_chars, packs }] }
// POST /api/clients { name, note? } -> 201 { client }
//
// A thin adapter: parse, guard, delegate, serialise. Everything that could be wrong about the
// data is `src/store.js`'s problem, and everything that could be wrong about the request is
// this file's.
//
// `functions/` sits at the repo root, never under `public/`. DEPLOY.md §1 says why: Pages
// resolves Functions from the project root, and a `functions/` directory under `public/`
// publishes the source as a static file where it never runs.

import { listClients, createClient } from "../../src/store.js";
import { json, readJson, sameOrigin, errorResponse } from "../../src/http.js";

export async function onRequestGet(context) {
  const { env } = context;

  // Binding first, deliberately. A missing binding is a deployment fault the caller cannot
  // fix, so 503 is the honest answer.
  if (!env.DB) return json({ error: "not_configured" }, 503);

  try {
    return json({ clients: await listClients(env.DB) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.DB) return json({ error: "not_configured" }, 503);
  if (!sameOrigin(request)) return json({ error: "cross_origin" }, 403);

  try {
    const body = await readJson(request);
    return json({ client: await createClient(env.DB, body) }, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
