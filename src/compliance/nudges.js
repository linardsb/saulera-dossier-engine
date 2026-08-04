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
//
// #70 ADDS A SECOND RADAR TO THIS FILE, AND IT IS DELIBERATELY SPLIT IN TWO.
//
// `sendDueExtensionNudges` below takes `env` and refuses to claim anything unless it can also
// send: it bails on a missing RECRUITER_EMAIL. That is right there, because the claim guards a
// courtesy email and public/assignments.js computes the amber row at render time, so the screen
// stays true whatever the mail configuration is.
//
// The expiry radar cannot inherit that rule, because for it the claim IS the product state.
// `compliance_item.status` is what the passport renders — a deployment with no RECRUITER_EMAIL
// that refused to claim would leave a candidate looking at a green "Sent in" chip over a
// certificate that lapsed in June, which is the exact failure this epic exists to prevent.
//
// So: `sweepExpiryStates(db)` takes the DATABASE and nothing else, and always runs. Its cost,
// stated rather than discovered: on a deployment with no mail configured the states move and no
// email is ever sent for those transitions — and because the transition is the claim, they will
// not be sent later either. The screen is right and the nudge is lost. `mailExpiryNudges(env,
// claimed)` is the half that needs configuration, and it takes what the first half won rather
// than re-reading the database, because after a successful claim there is nothing left to find.
//
// AT-MOST-ONCE, WITH ONE HONEST DIFFERENCE FROM #69. There the claim column recorded that a
// nudge was SENT. Here the status records that the item CHANGED STATE, so a failed send leaves
// the state moved with no message behind it and nothing to retry from. That is the same trade
// #25 and #69 already took — a courtesy outranked by "exactly once" — but the operator's
// assurance query is a count of states, not of sends, and DEPLOY.md says so.

import {
  claimItemExpiry,
  claimExtensionNudge,
  dueExpiryItems,
  dueExtensionNudges,
} from "./store.js";
import {
  CATALOGUE_BY_KEY,
  EXTENSION_LEAD_DAYS,
  MAX_AMBER_DAYS,
  targetFor,
} from "./catalogue.js";
import { getAgency } from "../store.js";
import {
  sendExpiryDigestEmail,
  sendExpiryNudgeEmail,
  sendExtensionNudgeEmail,
} from "../prep/email.js";

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

// ── the expiry radar (#70) ─────────────────────────────────────────────────────────────

// `CATALOGUE_BY_KEY` and `targetFor` were written here in #70 and MOVED to ./catalogue.js in
// #71, imported above. The rule now has two callers asking at two different moments — this sweep
// WRITES the state, and functions/api/compliance.js computes it at render time because nothing
// sweeps when a recruiter opens their dashboard — and two homes for "is this red" would be two
// answers about the same certificate. The catalogue is the home because a route can import it
// without dragging this module's mail layer along.

/**
 * Move every checklist row that has crossed a line, and report what moved.
 *
 * Takes `db` and not `env` — see the header. This half must run on any deployment that has a
 * database at all.
 *
 * The catalogue guard skips three classes of row the SQL cannot: an item_key retired from the
 * catalogue (its rows survive; catalogue.js:18-19 says adding an item is an edit, and removing
 * one leaves rows behind), an item marked `expires: false` that somehow holds a date, and a
 * malformed amberDays. Each is a row we decline to reason about rather than one we guess at.
 *
 * `target === row.status` is the ordinary case, not an error: the query narrows to the WIDEST
 * amber window, so a 30-day item sitting 45 days out comes back and is left alone, and a row
 * already `expiring` and still inside its window comes back every sweep and is left alone every
 * time. That is what makes the claim below fire exactly once per crossing.
 *
 * Sequential, `sendDueExtensionNudges`' reason: the due set is tiny and a Promise.all would
 * race the claims for no gain. Two concurrent REQUESTS still cannot double-claim — the
 * compare-and-swap has one winner per row.
 */
export async function sweepExpiryStates(db) {
  if (!db) return [];
  const rows = await dueExpiryItems(db, MAX_AMBER_DAYS);
  const claimed = [];
  for (const row of rows) {
    const entry = CATALOGUE_BY_KEY.get(row.item_key);
    if (!entry?.expires || !Number.isInteger(entry.amberDays)) continue;

    const target = targetFor(row.days_left, entry.amberDays);
    if (!target || target === row.status) continue;

    // Both observed values travel back into the WHERE. Passing `row.expiry_date` is not
    // bookkeeping — it is what makes a renewal that keeps the status (`submitted → submitted`
    // with a new date, which is the ORDINARY renewal) invalidate this claim. See
    // claimItemExpiry's comment for the failure it closes.
    const won = await claimItemExpiry(db, {
      id: row.id,
      from: row.status,
      to: target,
      expiryDate: row.expiry_date,
    });
    if (!won) continue; // a renewal landed between the read and the write, and it wins

    claimed.push({
      candidateId: row.candidate_id,
      candidateName: row.candidate_name,
      candidateEmail: row.candidate_email,
      label: entry.label,
      expiryDate: row.expiry_date,
      status: target,
    });
  }
  return claimed;
}

/**
 * The two messages, from what the sweep just won.
 *
 * TWO INDEPENDENT CONFIGURATION GUARDS, because these are two independent messages with two
 * independent requirements. The candidate's nudge needs a base URL (it carries a link); the
 * recruiter's digest needs a validated recipient. A deployment with PREP_BASE_URL and no
 * RECRUITER_EMAIL should still tell the candidates — refusing both because one is unset is the
 * coupling `sendDueExtensionNudges` could afford and this cannot.
 *
 * #71 GAVE THE DIGEST A LINK AND DID NOT COUPLE THE GUARDS. `/compliance` now exists, so the
 * digest points at it when `base` is available — but the base URL is passed as an ENRICHMENT and
 * is NOT added to the digest's guard. Adding it would mean a deployment carrying RECRUITER_EMAIL
 * and no PREP_BASE_URL stops receiving the digest it receives today, which is a regression
 * dressed as a feature. Without a base the message is byte-identical to #70's, and
 * sendExpiryDigestEmail's own comment says so from the other side.
 *
 * Nothing is rolled back on a failure and nothing is retried: the states are already claimed,
 * and the header says why. Each send has its own try/catch, so one candidate's bad address does
 * not cost the rest of the batch its message.
 *
 * `getAgency` is fetched once, after the guards, and only if there is something to send —
 * `sendDueExtensionNudges`' "due first, agency only if anything is" rule.
 */
export async function mailExpiryNudges(env, claimed = []) {
  if (!Array.isArray(claimed) || claimed.length === 0) return;
  if (!env?.RESEND_API_KEY) return;

  const base = baseUrl(env);
  const to = recipient(env);
  if (!base && !to) return;

  const agency = await getAgency(env.DB).catch(() => null);

  if (base) {
    // Grouped by candidate: one message listing everything of theirs that moved, never one per
    // item. A Map keeps insertion order, so each candidate's list stays in the query's
    // soonest-first order even though the rows arrive interleaved across candidates.
    const byCandidate = new Map();
    for (const row of claimed) {
      if (!row.candidateEmail) continue;
      if (!byCandidate.has(row.candidateId)) byCandidate.set(row.candidateId, []);
      byCandidate.get(row.candidateId).push(row);
    }
    for (const items of byCandidate.values()) {
      try {
        await sendExpiryNudgeEmail(env, {
          to: items[0].candidateEmail,
          agencyName: agency?.name,
          items,
          // The candidate's own door, and the COMPLIANCE one: the two portals hold independent
          // cookies and /prep/login would sign them in to the interview-prep product.
          link: `${base}/prep/compliance/login`,
        });
      } catch (err) {
        // Status only: never the recipient, never the candidate's name, never the item.
        console.error("expiry nudge send failed:", err?.code ?? err?.name ?? "unknown");
      }
    }
  }

  if (to) {
    try {
      await sendExpiryDigestEmail(env, {
        to,
        agencyName: agency?.name,
        rows: claimed,
        // The recruiter's own compliance screen, Access-gated by being outside /prep/*. Never a
        // portal path: that would point the recruiter at the candidate's door. `undefined` when
        // there is no base URL, which is the enrichment rule above — not a precondition.
        link: base ? `${base}/compliance` : undefined,
      });
    } catch (err) {
      console.error("expiry digest send failed:", err?.code ?? err?.name ?? "unknown");
    }
  }
}
