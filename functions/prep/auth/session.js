// GET /prep/auth/session -> 200 { ok: true, expires_at } | 200 { ok: false }
//
// "Am I signed in?", for the pages to ask on load (#20). #21 and #24 use it to decide
// between rendering prep and bouncing to /prep/login.
//
// 200 in BOTH cases, deliberately. This route is asked on every first visit by a candidate
// who is not signed in yet — that is its normal, expected answer, not a failure. Answering
// 401 would put a red line in the console of every ordinary visit, and a console that cries
// wolf on the happy path teaches everyone to ignore it on the day it means something.
// Routes that hold candidate CONTENT use requireSession, which throws 401 properly.
//
// It returns the expiry and nothing else. Not the invite id, not the client id, and not the
// token: a page that knows when the session ends can say so, and needs no identifier to do it.

import { sessionFromRequest } from "../../../src/prep/session.js";
import { json, errorResponse } from "../../../src/http.js";

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!env.DB) return json({ error: "not_configured" }, 503);

  try {
    const session = await sessionFromRequest(env.DB, request);
    if (!session) return json({ ok: false });
    return json({ ok: true, expires_at: session.expiresAt });
  } catch (err) {
    return errorResponse(err);
  }
}
