// GET /prep/demo -> 302 /prep/ signed in as the seeded demo invite. SHOWCASE ONLY.
//
// Exists so a demo can open the candidate portal without the magic-link dance: it re-mints
// the demo invite's token on every click and hands the browser the session cookie directly.
// Gated on DEMO_MODE, which is set only in the local .dev.vars — on any deployment without
// it this route is a 404, because /prep/* is public and an ungated version of this file
// would be a sign-in-as-someone button on the open internet. Delete after the demo.

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
