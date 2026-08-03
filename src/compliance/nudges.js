// The extension radar's sweep (#69, epic #65's milestone B): every booking ending inside the
// next EXTENSION_LEAD_DAYS days and unnudged gets its single email to the recruiter, claimed
// atomically first so two concurrent sweeps cannot double-send. src/prep/reminders.js with a
// different due query and a different recipient — read that file first; the arguments below are
// its arguments at a new root.
//
// Pages has no cron (architecture §4), so functions/prep/_middleware.js runs this lazily on
// every /prep/* request. It rides the CANDIDATE portal's traffic even though the nudge is
// recruiter-facing, because that is where the traffic is — and the honest cost is that the
// recruiter never visits /prep/*, so on a deployment with no candidate traffic the radar's only
// liveness is scripts/remind.py's daily poke. The Bookings screen is the backstop: it computes
// amber at render time rather than reading a stamp, so it is current even when no nudge ever
// went out.
//
// This module takes `env` (it orchestrates db + mail + config), unlike store functions — which
// is why it lives here and not in ./store.js.
//
// AT-MOST-ONCE, BY DESIGN. The claim is never rolled back on a send failure: "exactly one
// nudge" outranks delivery, and a rollback-and-retry could double-send when Resend accepted but
// the response read failed. A failed send is logged (status only, never the recipient, never the
// candidate's name) and that booking is simply skipped. Same knowing divergence from #22's
// rollback-on-throw that reminders.js records — there the invite email IS the product; here the
// nudge is a courtesy, and the screen still shows the amber row.

import { dueExtensionNudges, claimExtensionNudge } from "./store.js";
import { EXTENSION_LEAD_DAYS } from "./catalogue.js";
import { getAgency } from "../store.js";
import { sendExtensionNudgeEmail } from "../prep/email.js";

/** send.js's PREP_BASE_URL discipline, mirrored from reminders.js: a bare https origin or nothing. */
function baseUrl(env) {
  const configured = String(env?.PREP_BASE_URL ?? "").trim();
  if (!configured) return null;
  try {
    const url = new URL(configured);
    if (url.protocol === "https:" && (url.pathname === "/" || !url.pathname) && !url.search && !url.hash) {
      return url.origin;
    }
  } catch {
    // Falls to null: the sweep bails rather than mailing a broken link.
  }
  return null;
}

/**
 * The one address this radar mails, or null.
 *
 * A single address, and the checks are the mail-header ones `mailFrom` makes for a display
 * name. THE COMMA MATTERS MOST: `to` reaches a header, and a comma there is a second recipient
 * the operator may not have intended — on a message that names a candidate to a third party.
 * Control characters are the injection, closed for the same reason.
 *
 * Fails closed to null, which the guard below turns into a silent no-op rather than a broken
 * send: a misconfigured address must not burn each booking's one nudge.
 */
function recipient(env) {
  const address = String(env?.RECRUITER_EMAIL ?? "").trim();
  if (!address) return null;
  // Every C0 control, DEL, and the space — `mailFrom`'s CONTROLS class widened by one, because
  // after the trim above a space can only be an internal one and an address has none.
  if (/[\u0000-\u0020\u007f]/.test(address)) return null;
  if (address.includes(",")) return null;
  if (address.split("@").length !== 2) return null;
  const [local, domain] = address.split("@");
  if (!local || !domain) return null;
  return address;
}

export async function sendDueExtensionNudges(env) {
  // A sweep that cannot send must not claim: bailing BEFORE the claim is what keeps a
  // half-configured deployment from burning each booking's one nudge on nothing. Four
  // preconditions rather than reminders.js's three — the recipient is the fourth, and it is
  // configuration exactly as PREP_BASE_URL is.
  const base = baseUrl(env);
  const to = recipient(env);
  if (!env?.DB || !env?.RESEND_API_KEY || !base || !to) return;

  // Due first, agency only if anything is: the sweep rides every /prep/* request, so the
  // steady-state quiet day must cost one D1 round-trip, not two.
  const due = await dueExtensionNudges(env.DB, EXTENSION_LEAD_DAYS);
  if (due.length === 0) return;
  const agency = await getAgency(env.DB).catch(() => null);

  // Sequential on purpose: the due set is tiny, and a Promise.all would race the claims for no
  // gain. Two concurrent REQUESTS still cannot double-send — the claim has one winner per
  // booking, and the loser's claimExtensionNudge returns false.
  for (const booking of due) {
    const claimed = await claimExtensionNudge(env.DB, booking.id);
    if (!claimed) continue;
    try {
      await sendExtensionNudgeEmail(env, {
        to,
        agencyName: agency?.name,
        candidateName: booking.candidate_name,
        clientName: booking.client_name,
        endDate: booking.end_date,
        // The recruiter's own screen, which is Access-gated by being outside /prep/*. Never a
        // portal path: that would point the recruiter at the candidate's door.
        link: `${base}/assignments`,
      });
    } catch (err) {
      // Claimed and NOT rolled back — see the header. Status only: never the recipient, never
      // the candidate's name.
      console.error("extension nudge send failed:", err?.code ?? err?.name ?? "unknown");
    }
  }
}
