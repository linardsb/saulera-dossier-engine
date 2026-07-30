// GET /prep/api/brief -> 200 { role_title, blocks, competencies }
//
// The candidate's own prep brief (#22), which is what turns #21's dashboard from a renderer of
// a checked-in fixture into a page about a real person's interview.
//
// ⚠ CANDIDATE ROUTE — and the directory is the security decision, in the opposite direction
// from functions/api/prep/. This tree is Access-BYPASSED (scripts/setup-access.py:110-111 puts
// `Bypass → Everyone` on <project>.pages.dev/prep), which is what lets a candidate who has
// never heard of Cloudflare Access reach it at all; `requireSession` on the invite cookie is
// what stops everyone else. Inverting the two directories inverts the security in BOTH
// directions at once — this route would 302 candidates to a login they cannot pass, and the
// send route would mint magic links for anyone.
//
// The middleware deliberately does not guard: functions/prep/_middleware.js runs on every
// /prep/* request including the privacy notice and the login page, so each content route
// calls requireSession itself (src/prep/session.js:1-11 makes the argument).
//
// It also already ran `purgeExpired` before this handler was reached, so an invite past
// interview + 30 days has no row left to find. Nothing extra to do here, and a second purge
// would be a second full-table scan per request.

import { candidateProjection } from "../../../src/prep/projection.js";
import { assertBrief } from "../../../src/prep/schema.js";
import { briefJsonByInviteId } from "../../../src/portal/store.js";
import { requireSession } from "../../../src/prep/session.js";
import { json, errorResponse } from "../../../src/http.js";

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!env.DB) return json({ error: "not_configured" }, 503);

  try {
    // No sameOrigin check. This is a GET, and src/http.js:41-43 says the bolt is for mutating
    // methods only — on a GET it would break authenticated curl and every debugging session
    // for no gain the cookie's own SameSite=Lax does not already give.
    const session = await requireSession(env.DB, request);

    const raw = await briefJsonByInviteId(env.DB, session.inviteId);
    if (!raw || !String(raw).trim()) {
      // A real state, not an error: the invite exists and the handover has not been written.
      // The page says "your prep is not ready yet" rather than failing.
      return json({ error: "not_found" }, 404);
    }

    let payload;
    try {
      payload = assertBrief(JSON.parse(raw));
    } catch (err) {
      // A stored payload that no longer satisfies the contract is a DEPLOYMENT fault, not the
      // candidate's — a migration, or a change to assertBrief that the stored rows predate. 502
      // says "upstream of you", and the log carries the code alone: the message can quote the
      // payload, and the payload is candidate data.
      console.error("stored brief failed assertBrief:", err?.name ?? "unknown");
      return json({ error: "bad_brief" }, 502);
    }

    // THE PROJECTION, never the stored row. src/prep/projection.js's header says what comes
    // out and why; the short version is that `failed_quote`, `importance` and `questions` are
    // one View Source away if this returns `payload` directly.
    return json(candidateProjection(payload));
  } catch (err) {
    return errorResponse(err);
  }
}
