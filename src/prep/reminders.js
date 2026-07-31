// The one-reminder sweep (#25, decision 17): every invite whose interview is tomorrow and
// unreminded gets its single email, claimed atomically first so two concurrent sweeps
// cannot double-send. Pages has no cron, so functions/prep/_middleware.js runs this lazily
// on every /prep/* request — any portal traffic at all delivers due reminders, including
// for candidates who never signed in — and scripts/remind.py is the assurance poke for a
// zero-traffic day.
//
// This module takes `env` (it orchestrates db + mail + config), unlike store functions —
// which is why it lives in src/prep/ and not in the store.
//
// AT-MOST-ONCE, BY DESIGN. The claim is never rolled back on a send failure: decision 17's
// "exactly one reminder" outranks delivery, and a rollback-and-retry could double-send when
// Resend accepted but the response read failed. A failed send is logged (status only, never
// the recipient) and that reminder is simply skipped. This knowingly diverges from #22's
// rollback-on-throw — there the invite email IS the product; here the reminder is a courtesy.

import { dueReminders, claimReminder } from "../portal/store.js";
import { getAgency } from "../store.js";
import { sendReminderEmail } from "./email.js";

/** send.js's PREP_BASE_URL discipline, mirrored: a bare https origin or nothing. */
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

export async function sendDueReminders(env) {
  // A sweep that cannot send must not claim: bailing BEFORE the claim is what keeps a
  // half-configured deployment from burning each invite's one reminder on nothing.
  const base = baseUrl(env);
  if (!env?.DB || !env?.RESEND_API_KEY || !base) return;

  // Due first, agency only if anything is: the sweep rides every /prep/* request, so the
  // steady-state quiet day must cost one D1 round-trip, not two.
  const due = await dueReminders(env.DB);
  if (due.length === 0) return;
  const agency = await getAgency(env.DB).catch(() => null);

  // Sequential on purpose: the due set is tiny, and a Promise.all would race the claims
  // for no gain. Two concurrent REQUESTS still cannot double-send — the claim has one
  // winner per invite, and the loser's claimReminder returns false.
  for (const invite of due) {
    const claimed = await claimReminder(env.DB, invite.id);
    if (!claimed) continue;
    try {
      await sendReminderEmail(env, {
        to: invite.email,
        agencyName: agency?.name,
        link: `${base}/prep/login`,
      });
    } catch (err) {
      // Claimed and NOT rolled back — see the header. Status only, never the recipient.
      console.error("reminder send failed:", err?.code ?? err?.name ?? "unknown");
    }
  }
}
