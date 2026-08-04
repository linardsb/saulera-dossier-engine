// POST /prep/compliance/auth/otp { email } -> 202 { ok: true }
//
// ⚠ CANDIDATE ROUTE. It lives under functions/prep/ and that is the security decision, not an
// accident of filing: /prep/* is Access-BYPASSED (scripts/setup-access.py), which is what lets
// a locum with no Cloudflare account reach it at all. `requireCandidate` is what stops everyone
// else. A file doing this under functions/api/ would be the opposite mistake — gated against
// the only person who needs it (functions/prep/api/brief.js:6-12).
//
// The compliance passport's sign-in, first half (#68): a locum types the address the agency
// holds for them and gets six digits back. It mirrors functions/prep/auth/otp.js line for line
// — the same TTL, the same cooldown, the same uniform answer — and binds to `candidate` rather
// than to `invite`, because a compliance file outlives any one interview.
//
// IT ANSWERS 202 ON EVERY BRANCH, and that matters MORE here than on the prep route. This
// endpoint's question is "is this person on an agency's compliance list", and a 404 for an
// unknown address would answer "is this person registered as a locum with this agency, and
// therefore being vetted" — health-adjacent, for anyone with a word list. The uniform answer is
// the whole security design; do not add a hint to any branch.
//
// 202 rather than 200 for the same reason: it is honest about what happened. The request was
// accepted; whether an email follows is deliberately not stated.

import { getAgency } from "../../../../src/store.js";
import { candidateByEmail, issueCandidateOtp } from "../../../../src/compliance/store.js";
import { hashOtpCode, mintOtpCode } from "../../../../src/prep/tokens.js";
import { sendOtpEmail } from "../../../../src/prep/email.js";
import { json, readJson, sameOrigin, errorResponse } from "../../../../src/http.js";

const ALLOWED = new Set(["email"]);

// Ten minutes: long enough to switch to a mail app, find the message and type six digits;
// short enough that a code left in an unattended inbox is worthless by the time it matters.
// The portal's number, deliberately — one behaviour for a candidate who meets both doors. It
// is one constant and one test away from changing.
export const OTP_TTL_MINUTES = 10;

// One minute: an attacker can rotate the candidate's code at most once per minute, so the code
// in the newest email always survives long enough to type — and every email goes to the
// candidate's own address, never the requester's.
export const OTP_COOLDOWN_MINUTES = 1;

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
    // The one thing that is NOT hidden behind the uniform answer: an empty field. A candidate
    // who submitted nothing has a problem they can fix, and no address was disclosed by
    // saying so.
    if (!email) return json({ error: "missing_fields" }, 400);

    const candidate = await candidateByEmail(env.DB, email);
    if (candidate) {
      const code = mintOtpCode();
      const { issued } = await issueCandidateOtp(env.DB, {
        candidateId: candidate.id,
        // `hashOtpCode`'s first argument is whatever id the code was issued against — it is the
        // SALT, not specifically an invite id (src/prep/tokens.js:53-59). Passing the candidate
        // id is what keeps a `code_hash` in this cage useless without the row it came from.
        codeHash: await hashOtpCode(candidate.id, code),
        ttlMinutes: OTP_TTL_MINUTES,
        cooldownMinutes: OTP_COOLDOWN_MINUTES,
      });
      if (issued) {
        try {
          // The agency's name makes the email recognisable rather than anonymous. Its absence
          // is not worth failing a sign-in over — sendOtpEmail has a neutral fallback.
          const agency = await getAgency(env.DB).catch(() => null);
          await sendOtpEmail(env, { to: candidate.email, code, agencyName: agency?.name });
        } catch (err) {
          // A mail failure still answers 202. The candidate's remedy is to try again either
          // way, and the operator's signal is this line plus the status src/prep/email.js
          // already logged — a 500 here would say "that address exists, and our mail is down".
          const reason = err?.code ?? "unknown";
          console.error("compliance otp mail not sent:", reason);
        }
      }
    }

    // The identical answer, on all three branches — no candidate, issued, cooling down —
    // deliberately. Do not add a hint.
    return json({ ok: true }, 202);
  } catch (err) {
    return errorResponse(err);
  }
}
