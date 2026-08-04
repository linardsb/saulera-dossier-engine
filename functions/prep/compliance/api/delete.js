// POST /prep/compliance/api/delete {} -> 200 { ok: true, deleted: 0 | 1 } + the cleared cookie
//
// ⚠ CANDIDATE ROUTE — see ./items.js for why this tree is Access-bypassed and what stops
// everyone else.
//
// Delete-now, day one (#68). The architecture doc requires it in those words — "candidate-
// visible delete-now from day one" — and it is not polish: this is the lawful-basis posture for
// a surface holding health-adjacent metadata. One `DELETE FROM candidate` and the schema's
// cascade take the whole cage: the checklist, the assignments, and any live sign-in code.
//
// THE COOKIE IS THE ONLY CREDENTIAL, which is where this parts company with
// functions/prep/api/delete.js. That route accepts a body token because the portal emails one
// and a candidate may hold an unclicked invite; nothing emails a compliance token, so there is
// no named target that could outrank the ambient one, and `ALLOWED` is empty — any key at all
// answers 400. (The delete button still sends `{}` rather than nothing: `readJson` throws
// `bad_json` on a body-less POST, before the empty vocabulary is ever consulted.)
//
// Idempotent 200 by design — a candidate holding a stale cookie is already in the clean state
// the button promises, and a not-found would make it lie to someone who pressed it twice.
// `deleted` rides alongside so idempotent does not mean blind.
//
// POST only, no GET handler: a delete reachable by URL-click gets prefetched by mail scanners.

import { deleteCandidate } from "../../../../src/compliance/store.js";
import { requireCandidate } from "../../../../src/compliance/session.js";
import { clearComplianceCookie } from "../../../../src/compliance/tokens.js";
import { json, readJson, sameOrigin, errorResponse } from "../../../../src/http.js";

// Deliberately empty. There is nothing to name and nothing to opt into, and an endpoint that
// erases a cage must not quietly grow a field — the same three-line rule /api/events keeps.
const ALLOWED = new Set();

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

    const { candidateId } = await requireCandidate(env.DB, request);
    const { deleted } = await deleteCandidate(env.DB, candidateId);

    // Clear the session on the way out. A candidate who just erased everything must not keep a
    // cookie pointing at a row that no longer exists — every compliance screen would bounce
    // them to the sign-in page with no explanation, which reads like the delete failed.
    return new Response(JSON.stringify({ ok: true, deleted }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "Set-Cookie": clearComplianceCookie(),
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
