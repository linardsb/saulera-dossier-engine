// POST /prep/auth/verify { email, code } -> 200 { ok: true } + the session cookie
//
// The returning login's second half (#20). It trades six digits for the same session cookie
// the magic link issues, by rotating the same `invite.token_hash` column — one credential
// column, two doors into it (architecture §4).
//
// An unknown email address answers exactly as a wrong code does, for the reason
// /prep/auth/otp answers 202 to everything: a different status here would undo the
// enumeration guard one route earlier, since an attacker would simply ask this one instead.

import { consumeOtp, hashToken, inviteByEmail, rotateSession } from "../../../src/portal/store.js";
import { hashOtpCode, maxAgeFrom, mintToken, sessionCookie } from "../../../src/prep/tokens.js";
import { json, readJson, sameOrigin, errorResponse } from "../../../src/http.js";

const ALLOWED = new Set(["email", "code"]);

// Five guesses. The sixth call is refused without a comparison and the row is deleted — see
// consumeOtp, which owns that arithmetic so no route can get the order wrong.
export const MAX_OTP_ATTEMPTS = 5;

// json() builds a fixed header set and cannot carry Set-Cookie. Widening it would touch the
// four other routes that depend on its shape, so the cookie-bearing response is built here
// and in enter.js — two small duplications rather than one shared risk.
const withSession = (cookie, payload) =>
  new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Set-Cookie": cookie,
    },
  });

// What a failed verify says, in every case where saying more would disclose something: no
// invite for that address, a wrong code, a code that was never issued. One answer, one shape.
const REJECTED = { reason: "invalid_code", status: 401 };
const OUTCOMES = {
  invalid_code: REJECTED,
  expired: { reason: "expired", status: 410 },
  too_many_attempts: { reason: "too_many_attempts", status: 429 },
};

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

    const email = String(body.email ?? "").trim();
    if (!email) return json({ error: "missing_fields" }, 400);

    // Candidates paste what their mail client shows them: '123 456', '123-456', sometimes
    // with a stray space on the end. Stripping to digits accepts all of it.
    const digits = String(body.code ?? "").replace(/\D/g, "");
    // A wrong LENGTH is a typo, not a guess, and must not burn one of the five attempts —
    // otherwise a candidate fat-fingering their way through a five-digit paste is locked out
    // of an account nobody attacked. It also costs an attacker nothing to send six digits,
    // so allowing this for free gives away nothing.
    if (digits.length !== 6) return json({ error: REJECTED.reason }, REJECTED.status);

    const invite = await inviteByEmail(env.DB, email);
    if (!invite) return json({ error: REJECTED.reason }, REJECTED.status);

    const result = await consumeOtp(env.DB, {
      inviteId: invite.id,
      codeHash: await hashOtpCode(invite.id, digits),
      maxAttempts: MAX_OTP_ATTEMPTS,
    });
    if (!result.ok) {
      const outcome = OUTCOMES[result.reason] ?? REJECTED;
      return json({ error: outcome.reason }, outcome.status);
    }

    // The code was right, so mint a session in the invite's credential column. Note this
    // rotates the token WITHOUT touching opened_at: signing back in is not a new open, and
    // decision 23's count must not climb with device count.
    const next = mintToken();
    const maxAge = maxAgeFrom(invite.expires_at);
    const { rotated } = await rotateSession(env.DB, {
      inviteId: invite.id,
      newHash: await hashToken(next),
    });
    // The invite expired or was deleted between the lookup and here. The code is already
    // spent — consumeOtp deleted it — so there is nothing to replay and nothing to hand back.
    if (!rotated || maxAge <= 0) return json({ error: "expired" }, 410);

    return withSession(sessionCookie(next, maxAge), { ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
