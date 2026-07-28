// The lazy purge (#17, decision 13). Pages has no cron (architecture §4), so retention runs
// on every /prep/* request — including static assets like the privacy page, which is the
// feature: any portal traffic at all keeps the 30-day rule enforced. Awaited BEFORE next(),
// because an expired invite must not serve one last time at +31 days. The failure path
// serves anyway: the privacy notice must stay reachable even on a broken deployment, and
// scripts/purge.py is the assurance net for a portal nobody visits.

import { purgeExpired } from "../../src/portal/store.js";

export async function onRequest(context) {
  const { env, next } = context;
  if (env.DB) {
    try {
      await purgeExpired(env.DB);
    } catch (err) {
      console.error("portal purge failed:", err);
    }
  }
  return next();
}
