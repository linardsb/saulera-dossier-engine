// The HTTP helpers the Functions share (#5). One JSON response shape in this codebase, not
// two: `json()` is the saulera Functions' helper verbatim, `no-store` default included.
//
// This file lives in `src/` on purpose. Anything under `functions/` is a route, so a helper
// module there would be a live endpoint.

import { StoreError } from "./store.js";

export function json(obj, status = 200, cache = "no-store") {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": cache },
  });
}

/** The request body, or a StoreError the Function layer already knows how to answer. */
export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new StoreError("bad_json", 400);
  }
}

/**
 * Cloudflare Access is the door and it authenticates with a cookie. This is the bolt: a
 * cross-site POST riding the reader's Access cookie is cheaper to rule out here than to reason
 * about Cloudflare's cookie attributes.
 *
 * Apply it to mutating methods only. On GET it would break authenticated curl and every
 * debugging session, for no gain a same-site cookie policy does not already give.
 */
export function sameOrigin(request) {
  const site = request.headers.get("Sec-Fetch-Site");
  if (site) return site === "same-origin"; // every current browser sends this
  const origin = request.headers.get("Origin");
  if (!origin) return true; // curl and local scripts have no Origin
  return origin === new URL(request.url).origin;
}

/**
 * A store failure as a response. Anything that is not a StoreError is a bug in this code, not
 * a fault the caller can fix, so it answers 500 with nothing leaked from the message.
 */
export function errorResponse(err) {
  if (err instanceof StoreError) return json({ error: err.code }, err.status);
  return json({ error: "internal" }, 500);
}
