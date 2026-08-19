// GET /prep/demo -> 302 /prep/ signed in as the seeded demo invite. SHOWCASE ONLY.
//
// Exists so a demo can open the candidate portal without the magic-link dance: it re-mints
// the demo invite's token on every click and hands the browser the session cookie directly.
// Gated on DEMO_MODE — on any deployment without it this route is a 404, because /prep/* is
// public and an ungated version of this file would be a sign-in-as-someone button on the open
// internet. Delete after the demo.
//
// THIS COMMENT USED TO SAY DEMO_MODE IS "set only in the local .dev.vars". It is not, and the
// correction matters more than the sentence: `wrangler pages secret list` shows DEMO_MODE on the
// PRODUCTION environment (set 4 Aug 2026 for the Louis demo, never unwound). So this route is
// live on the open internet right now, and every visitor who opens it is signed in as the same
// `inv-demo` invite — one candidate_role, one storybank, one debrief, shared by strangers.
// Anything a visitor stores under it is replayed to the next visitor, which is what turns
// self-injection into cross-visitor injection wherever candidate text reaches a prompt
// (src/prep/drill.js `fence`). A comment that misstates where a gate is set is how the gate stops
// being checked.

import { hashToken } from "../../src/portal/store.js";
import { maxAgeFrom, mintToken, sessionCookie } from "../../src/prep/tokens.js";

const DEMO_INVITE_ID = "inv-demo";

export async function onRequestGet(context) {
  const { env } = context;
  if (env.DEMO_MODE !== "1" || !env.DB) return new Response("Not found", { status: 404 });

  const invite = await env.DB.prepare("SELECT expires_at FROM invite WHERE id = ?")
    .bind(DEMO_INVITE_ID)
    .first();
  if (!invite) return new Response("Demo invite not seeded", { status: 404 });

  const maxAge = maxAgeFrom(invite.expires_at);
  if (maxAge <= 0) return new Response("Demo invite expired — re-seed it", { status: 410 });

  const next = mintToken();
  await env.DB.prepare("UPDATE invite SET token_hash = ?, opened_at = COALESCE(opened_at, datetime('now')) WHERE id = ?")
    .bind(await hashToken(next), DEMO_INVITE_ID)
    .run();

  return new Response(null, {
    status: 302,
    headers: {
      Location: "/prep/",
      "Cache-Control": "no-store",
      "Set-Cookie": sessionCookie(next, maxAge),
    },
  });
}
