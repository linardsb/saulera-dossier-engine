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

import { purgeExpired } from "../../src/portal/store.js";
import { sendDueReminders } from "../../src/prep/reminders.js";

export async function onRequest(context) {
  const { env, next } = context;
  if (env.DB) {
    try {
      await purgeExpired(env.DB);
    } catch (err) {
      console.error("portal purge failed:", err);
    }
    context.waitUntil(
      sendDueReminders(env).catch((err) => {
        console.error("reminder sweep failed:", err);
      }),
    );
  }
  return next();
}
