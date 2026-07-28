// GET /prep/auth/enter?t=<token> -> 302 /prep/ with the session cookie
//
// The magic link (#20, decision 12). It spends the emailed token and mints a session in its
// place, so the link works exactly once. That is what makes "reused tokens rejected" and
// "opened_at set exactly once" the same fact — see openInvite's comment in src/portal/store.js.
//
// Three deliberate departures from the house Function spine, each load-bearing:
//
// 1. No sameOrigin check. This is a top-level navigation from a mail client, which is by
//    definition cross-site — the check documented for mutating methods in src/http.js would
//    reject every real candidate. It is safe to omit because the token IS the authorisation:
//    there is no ambient credential for a cross-site request to ride, and a forged link
//    carries nothing.
// 2. A GET that mutates. Ordinarily wrong, and functions/prep/api/delete.js says so out loud.
//    The exception is bought knowingly: a link in an email can only ever be a GET, and the
//    thing it mutates is the credential it just spent.
// 3. Failures redirect rather than answer JSON. A candidate who clicks a dead link is a
//    person in front of a browser, not a caller parsing a body; /prep/login can explain
//    itself and offer the code path, which a 401 cannot.

import {
  hashToken,
  inviteByTokenHash,
  openInvite,
} from "../../../src/portal/store.js";
import { recordInviteEvent } from "../../../src/store.js";
import { maxAgeFrom, mintToken, sessionCookie } from "../../../src/prep/tokens.js";
import { json, errorResponse } from "../../../src/http.js";

// Relative, never built from request.url: an absolute URL would inherit whatever Host the
// edge saw, which is a header an attacker controls.
const redirect = (location, cookie) =>
  new Response(null, {
    status: 302,
    headers: {
      Location: location,
      "Cache-Control": "no-store",
      ...(cookie ? { "Set-Cookie": cookie } : {}),
    },
  });

// `?e=` is the whole vocabulary the login page renders. Two values, because there are two
// things worth telling a candidate apart: a link that has expired (their prep has closed,
// nothing to do) and one that is dead for any other reason (already clicked, or never real —
// ask for a code). Anything finer would tell a stranger holding a forged link whether it
// nearly worked.
const INVALID = "/prep/login?e=invalid";
const EXPIRED = "/prep/login?e=expired";

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!env.DB) return json({ error: "not_configured" }, 503);

  try {
    const raw = new URL(request.url).searchParams.get("t") ?? "";
    if (!raw) return redirect(INVALID);

    // Hashed once and reused: the same value must select the row and appear in the UPDATE's
    // WHERE, and hashing twice invites the two to drift apart under a later edit.
    const presented = await hashToken(raw);
    const invite = await inviteByTokenHash(env.DB, presented);
    if (!invite) return redirect(INVALID);

    // Read before the write: after openInvite, the row can no longer say whether THIS click
    // was the first one, and `invite_opened` must be recorded exactly once (AC #3).
    const maxAge = maxAgeFrom(invite.expires_at);
    if (maxAge <= 0) return redirect(EXPIRED);
    const wasUnopened = invite.opened_at === null;

    const next = mintToken();
    const { rotated } = await openInvite(env.DB, {
      oldHash: presented,
      newHash: await hashToken(next),
    });
    // Lost a race with a simultaneous click, or the invite expired between the read and the
    // write. Either way the token is spent and this browser did not get the session.
    if (!rotated) return redirect(INVALID);

    if (wasUnopened) {
      try {
        await recordInviteEvent(env.DB, { clientId: invite.client_id, kind: "invite_opened" });
      } catch (err) {
        // Telemetry must never cost a candidate their session. recordInviteEvent checks the
        // client exists first, so this catch covers a real path and not a theoretical one:
        // a client deleted between invite and click would otherwise 500 a valid sign-in.
        const reason = err?.code ?? "unknown";
        console.error("invite_opened not recorded:", reason);
      }
    }

    return redirect("/prep/", sessionCookie(next, maxAge));
  } catch (err) {
    return errorResponse(err);
  }
}
