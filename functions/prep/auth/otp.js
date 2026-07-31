// POST /prep/auth/otp { email } -> 202 { ok: true }
//
// The returning login's first half (#20, decision 12): a candidate who has lost their link
// types the address it was sent to, and gets six digits back.
//
// It answers 202 whether or not that address matches an invite, and that is the whole
// security design of this route. A 404 for an unknown address would turn it into an email
// enumeration oracle pointed at a recruitment agency's candidate list — "is this person
// interviewing?" answered by a status code, for anyone with a word list. Decision 13 exists
// to keep exactly that kind of disclosure from happening, so this endpoint tells the caller
// only that it accepted the request, which is all a real candidate needs to know.
//
// 202 rather than 200 for the same reason: it is honest about what happened. The request was
// accepted; whether an email follows is deliberately not stated.

import { getAgency } from "../../../src/store.js";
import { inviteByEmail, issueOtp } from "../../../src/portal/store.js";
import { hashOtpCode, mintOtpCode } from "../../../src/prep/tokens.js";
import { sendOtpEmail } from "../../../src/prep/email.js";
import { json, readJson, sameOrigin, errorResponse } from "../../../src/http.js";

const ALLOWED = new Set(["email"]);

// Ten minutes: long enough to switch to a mail app, find the message and type six digits;
// short enough that a code left in an unattended inbox is worthless by the time it matters.
// It is one constant and one test away from changing.
export const OTP_TTL_MINUTES = 10;

// One minute: an attacker can rotate the candidate's code at most once per minute, so the
// code in the newest email always survives long enough to type — and every email goes to
// the invite's address, never the requester's. A candidate whose first email went astray
// waits out the same minute for a fresh one. It is one constant and one test away from changing.
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

    const invite = await inviteByEmail(env.DB, email);
    if (invite) {
      const code = mintOtpCode();
      const { issued } = await issueOtp(env.DB, {
        inviteId: invite.id,
        codeHash: await hashOtpCode(invite.id, code),
        ttlMinutes: OTP_TTL_MINUTES,
        cooldownMinutes: OTP_COOLDOWN_MINUTES,
      });
      if (issued) {
        try {
          // The agency's name makes the email recognisable rather than anonymous. Its absence
          // is not worth failing a sign-in over — sendOtpEmail has a neutral fallback.
          const agency = await getAgency(env.DB).catch(() => null);
          await sendOtpEmail(env, { to: invite.email, code, agencyName: agency?.name });
        } catch (err) {
          // A mail failure still answers 202. The candidate's remedy is to try again either
          // way, and the operator's signal is this line plus the status src/prep/email.js
          // already logged — a 500 here would say "that address exists, and our mail is down".
          const reason = err?.code ?? "unknown";
          console.error("otp mail not sent:", reason);
        }
      }
    }

    // The identical answer, on all three branches — no invite, issued, cooling down —
    // deliberately. Do not add a hint.
    return json({ ok: true }, 202);
  } catch (err) {
    return errorResponse(err);
  }
}
