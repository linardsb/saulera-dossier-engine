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
//
// #69's extension radar joins the same lazy slot for the same reason, and its own catch block
// for the same reason again: one sweep bailing on a missing RECRUITER_EMAIL must not take the
// reminder down with it. Say the cost plainly rather than leave it to be discovered — the
// RECRUITER never visits /prep/*, so this radar's liveness depends entirely on candidate
// traffic or scripts/remind.py's daily poke. That is an accepted trade, not an oversight: one
// lazy slot is one place to reason about, a recruiter already looking at an amber row does not
// need an email at that instant, and public/assignments.js computes its amber state at render
// time so the screen is current whether or not a nudge ever went out.
//
// #70's expiry radar puts one job in EACH tier, which is new here, and the split is the whole
// reason: its state half is a PURGE in this file's taxonomy rather than a send. It decides what
// the next handler renders — `compliance_item.status` is what /prep/compliance draws, and there
// is no render-time computation to fall back on the way the bookings screen has one — so a
// deferred version would show a locum a green "Sent in" chip over a certificate that lapsed in
// June, for one request longer. That is the same argument the two purges are awaited for. Its
// mail half is an ordinary send and rides waitUntil with the other two.

import { purgeExpired } from "../../src/portal/store.js";
import { purgeDormant } from "../../src/compliance/store.js";
import { sendDueReminders } from "../../src/prep/reminders.js";
import {
  mailExpiryNudges,
  sendDueExtensionNudges,
  sweepExpiryStates,
} from "../../src/compliance/nudges.js";

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
    // AWAITED, and it is the only mail-adjacent job on this seam that is. #70's state half is a
    // purge in this file's taxonomy rather than a send: `compliance_item.status` is what
    // /prep/compliance renders, and the purges are awaited for exactly this reason — an expired
    // invite must not serve one last time, and a lapsed certificate must not render as "Sent
    // in" one last time. It runs AFTER both purges so a candidate the dormancy rule just erased
    // has no rows left to sweep. Its own catch block, third of three: one broken clock must not
    // stop the others.
    let expiryChanges = [];
    try {
      expiryChanges = await sweepExpiryStates(env.DB);
    } catch (err) {
      console.error("expiry sweep failed:", err);
    }
    context.waitUntil(
      sendDueReminders(env).catch((err) => {
        console.error("reminder sweep failed:", err);
      }),
    );
    // waitUntil and not await, the same argument as above: the response has no ordering
    // dependency on the sends, so the one visitor who trips a due morning must not wait out N
    // Resend calls. Registered AFTER the reminder deliberately — test/prep-middleware.test.js
    // awaits captured[0] to prove the reminder actually sent, and prepending this would put a
    // sweep that bails instantly in that slot.
    context.waitUntil(
      sendDueExtensionNudges(env).catch((err) => {
        console.error("extension nudge sweep failed:", err);
      }),
    );
    // THIRD, and deferred like the other two: the response has no ordering dependency on the
    // sends. Registered after the extension nudge for test/prep-middleware.test.js's stated
    // reason — captured[0] must stay the reminder, whose send that file awaits to prove the
    // deferred slot really delivers. It takes what the awaited half won rather than re-reading
    // the database: after a successful claim there is nothing left to find.
    context.waitUntil(
      mailExpiryNudges(env, expiryChanges).catch((err) => {
        console.error("expiry nudge sweep failed:", err);
      }),
    );
  }
  return next();
}
