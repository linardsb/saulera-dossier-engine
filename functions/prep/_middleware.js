// The portal's lazy jobs (#17 purge, #25 reminder). Pages has no cron (architecture §4), so
// both run on every /prep/* request — including static assets like the privacy page, which
// is the feature: any portal traffic at all keeps the 30-day rule enforced and delivers due
// reminders, even for candidates who never come back. The purge is awaited BEFORE next(),
// because an expired invite must not serve one last time at +31 days — and before the
// sweep, because an expired invite must not be reminded. The sends themselves ride
// waitUntil: the response has no ordering dependency on them, so the one visitor who
// trips a due morning doesn't wait out N Resend calls. Both fail open — the privacy
// notice must stay reachable even on a broken deployment — and each has a script as its
// assurance net for a portal nobody visits: scripts/purge.py and scripts/remind.py.
//
// #67 adds the compliance cage's 12-month dormancy rule to the same lazy slot, so any portal
// traffic keeps BOTH retention promises. It rides /prep/* before any compliance screen exists
// on purpose: the promise must not wait for #68 to ship, and when #68 puts the passport under
// /prep this middleware already covers it. The two purges fail open independently — one
// broken cage must not stop the other's clock, and two catch blocks mean the log line names
// which one broke.

import { purgeExpired } from "../../src/portal/store.js";
import { purgeDormant } from "../../src/compliance/store.js";
import { sendDueReminders } from "../../src/prep/reminders.js";

export async function onRequest(context) {
  const { env, next } = context;
  if (env.DB) {
    try {
      await purgeExpired(env.DB);
    } catch (err) {
      console.error("portal purge failed:", err);
    }
    try {
      await purgeDormant(env.DB);
    } catch (err) {
      console.error("compliance purge failed:", err);
    }
    context.waitUntil(
      sendDueReminders(env).catch((err) => {
        console.error("reminder sweep failed:", err);
      }),
    );
  }
  return next();
}
