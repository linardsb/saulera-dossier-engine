// GET /prep/compliance/demo -> 302 /prep/compliance/ signed in as the demo candidate.
// SHOWCASE ONLY.
//
// Exists so a demo can open the compliance passport without waiting on an email: it seeds the
// demo candidate on first click (through `createCandidate`, so the checklist arrives through
// its one writer), then re-mints their session token on every click and hands the browser the
// cookie directly. Gated on DEMO_MODE, which is set only in the local .dev.vars — on any
// deployment without it this route is a 404, because /prep/* is Access-BYPASSED and an ungated
// version of this file would be a sign-in-as-anyone button on the open internet.
// Delete after the demo.
//
// IT IS ALSO THE ONLY PATH IN #68 THAT CREATES A CANDIDATE ROW, and it is gated for that
// reason as much as for the sign-in. Production candidate creation belongs to #71's recruiter
// surface, along with the invite email that would carry it; this ticket ships the candidate
// half of the passport and says so out loud rather than growing a recruiter route its
// acceptance criteria never mention.

import { hashToken } from "../../../src/portal/store.js";
import { createCandidate, rotateCandidateSession } from "../../../src/compliance/store.js";
import { complianceCookie, sessionExpiry } from "../../../src/compliance/tokens.js";
import { maxAgeFrom, mintToken } from "../../../src/prep/tokens.js";

const DEMO_CANDIDATE = {
  id: "cand-demo",
  fullName: "Demo Locum",
  email: "demo.locum@example.com",
};

export async function onRequestGet(context) {
  const { env } = context;
  if (env.DEMO_MODE !== "1" || !env.DB) return new Response("Not found", { status: 404 });

  // Checked rather than attempted-and-swallowed: `createCandidate` throws on the PRIMARY KEY,
  // and a blanket catch here would also swallow a half-seeded checklist — the one failure this
  // route needs to surface, because a short checklist demos as a working product with items
  // missing.
  const existing = await env.DB.prepare("SELECT id FROM candidate WHERE id = ?")
    .bind(DEMO_CANDIDATE.id)
    .first();
  if (!existing) await createCandidate(env.DB, DEMO_CANDIDATE);

  const next = mintToken();
  const expiresAt = sessionExpiry();
  await rotateCandidateSession(env.DB, {
    candidateId: DEMO_CANDIDATE.id,
    newHash: await hashToken(next),
    expiresAt,
  });

  return new Response(null, {
    status: 302,
    headers: {
      Location: "/prep/compliance/",
      "Cache-Control": "no-store",
      "Set-Cookie": complianceCookie(next, maxAgeFrom(expiresAt)),
    },
  });
}
