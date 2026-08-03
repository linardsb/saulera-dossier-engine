// POST /prep/compliance/auth/verify { email, code } -> 200 { ok: true } + the compliance cookie
//
// ⚠ CANDIDATE ROUTE — see the header of ./otp.js for why this tree is Access-bypassed and what
// stops everyone else.
//
// The compliance passport's sign-in, second half (#68). It trades six digits for a session
// bound to `candidate`, on its own cookie scoped to /prep/compliance — never the prep portal's
// invite session, which is a different lifetime for a different purpose and lives behind
// `Path=/prep`. src/compliance/tokens.js holds that argument.
//
// An unknown email address answers exactly as a wrong code does, for the reason
// /prep/compliance/auth/otp answers 202 to everything: a different status here would undo the
// enumeration guard one route earlier, since an attacker would simply ask this one instead.

import { hashToken } from "../../../../src/portal/store.js";
import {
  candidateByEmail,
  consumeCandidateOtp,
  rotateCandidateSession,
} from "../../../../src/compliance/store.js";
import { hashOtpCode, maxAgeFrom, mintToken } from "../../../../src/prep/tokens.js";
import { complianceCookie, sessionExpiry } from "../../../../src/compliance/tokens.js";
import { json, readJson, sameOrigin, errorResponse } from "../../../../src/http.js";

const ALLOWED = new Set(["email", "code"]);

// Five guesses. The sixth call is refused without a comparison and the row is deleted — see
// consumeCandidateOtp, which owns that arithmetic so no route can get the order wrong.
export const MAX_OTP_ATTEMPTS = 5;

// json() builds a fixed header set and cannot carry Set-Cookie. Widening it would touch every
// other route that depends on its shape, so the cookie-bearing response is built here, exactly
// as functions/prep/auth/verify.js:21-32 builds its own — two small duplications rather than
// one shared risk.
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
// candidate for that address, a wrong code, a code that was never issued. One answer, one shape.
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

    // Candidates paste what their mail client shows them: '123 456', '123-456', sometimes with
    // a stray space on the end. Stripping to digits accepts all of it.
    const digits = String(body.code ?? "").replace(/\D/g, "");
    // A wrong LENGTH is a typo, not a guess, and must not burn one of the five attempts —
    // otherwise a locum fat-fingering their way through a five-digit paste is locked out of a
    // file nobody attacked. It also costs an attacker nothing to send six digits, so allowing
    // this for free gives away nothing.
    if (digits.length !== 6) return json({ error: REJECTED.reason }, REJECTED.status);

    const candidate = await candidateByEmail(env.DB, email);
    if (!candidate) return json({ error: REJECTED.reason }, REJECTED.status);

    const result = await consumeCandidateOtp(env.DB, {
      candidateId: candidate.id,
      codeHash: await hashOtpCode(candidate.id, digits),
      maxAttempts: MAX_OTP_ATTEMPTS,
    });
    if (!result.ok) {
      const outcome = OUTCOMES[result.reason] ?? REJECTED;
      return json({ error: outcome.reason }, outcome.status);
    }

    // The code was right, so mint a session in the candidate's credential column. This ROTATES
    // it: a second device signing in evicts the first, which is the portal's decision at
    // verify.js:82-84 and the one migrations/0009 was shaped around.
    const next = mintToken();
    const expiresAt = sessionExpiry();
    const { rotated } = await rotateCandidateSession(env.DB, {
      candidateId: candidate.id,
      newHash: await hashToken(next),
      expiresAt,
    });
    // The candidate was deleted between the lookup and here — delete-now on another device, or
    // the dormancy purge that runs on every /prep/* request. The code is already spent —
    // consumeCandidateOtp deleted it — so there is nothing to replay and nothing to hand back.
    if (!rotated) return json({ error: "expired" }, 410);

    return withSession(complianceCookie(next, maxAgeFrom(expiresAt)), { ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
