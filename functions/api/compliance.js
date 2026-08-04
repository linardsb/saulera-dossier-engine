// GET /api/compliance -> { candidates: [{ id, full_name, total, verified, awaiting_review,
//                                          at_risk, missing,
//                                          items: [{ item_key, label, expires, amber_days,
//                                                    status, reference, expiry_date, days_left,
//                                                    risk }] }] }
//
// The recruiter's half of concurrent vetting (#71): what does each candidate still owe us, and
// what is about to kill a booking. A thin adapter, the shape functions/api/assignments.js sets:
// guard, delegate, group, serialise.
//
// RISK IS COMPUTED HERE, AT RENDER TIME, AND IS NEVER READ OFF `status`. This is the one
// decision in the ticket that a reader coming from #69 and #70 will find strange, so it is
// stated first. Both radars are lazy jobs on CANDIDATE traffic: `sweepExpiryStates` runs on the
// /prep/* middleware and nowhere else, so a recruiter opening this screen triggers no sweep at
// all. On a deployment where nobody has visited the portal for a fortnight, a certificate that
// lapsed last week still reads `submitted` in the column — and a dashboard whose entire promise
// is "at-risk flags without chasing an email thread" would under-report exactly on the
// deployment where it matters most. public/assignments.js is immune to the identical failure
// precisely because `stateOf()` computes from the date rather than from `nudge_sent_at`, and its
// comment says so. This route takes that rule.
//
// So each item carries TWO facts and they are two different questions:
//   · `status`  the CHASE state — not sent in / waiting for you / verified. Written by people
//               and by the sweep, and possibly stale.
//   · `risk`    the RISK state — computed from `expiry_date` against the catalogue's per-item
//               amberDays, every single time this route answers.
// A stale column beside a fresh date is not a contradiction to be resolved. "Waiting for you"
// next to "ran out four days ago" is TRUE, and it is precisely the row the recruiter most needs
// to see.
//
// `targetFor` is imported from the CATALOGUE and not from src/compliance/nudges.js, where #70
// wrote it. Two reasons: that module pulls src/prep/email.js and getAgency into a route that
// sends no mail, and the amber/red rule having one home is what stops the sweep and this screen
// disagreeing about what red means.
//
// NO EMAIL IS IN THIS RESPONSE, and the store's projection is where that is enforced
// (`listComplianceState` names every column it returns). It is worth saying out loud here
// because the very next function in that file returns an address — `candidateEmailById`, which
// the WRITE route reads server-side for the rejection message. This screen never sees one.
//
// `functions/` sits at the repo root, never under `public/` (DEPLOY.md §1). This route is
// Access-gated by being OUTSIDE /prep/*: scripts/setup-access.py scopes the two bypass apps to
// the /prep path segment, so /api/compliance is gated by default and needs no new bypass app.

import { COMPLIANCE_CATALOGUE, targetFor } from "../../src/compliance/catalogue.js";
import { listComplianceState } from "../../src/compliance/store.js";
import { json, errorResponse } from "../../src/http.js";

export async function onRequestGet(context) {
  const { env } = context;

  // Binding first, deliberately. A missing binding is a deployment fault the caller cannot fix,
  // so 503 is the honest answer.
  if (!env.DB) return json({ error: "not_configured" }, 503);

  try {
    // ONE STATEMENT, `8 × candidates` ROWS, NO PAGINATION. The pilot agency is two founders and
    // that is tens of rows; the bound is stated in listComplianceState's comment so the day it
    // stops being true is a decision rather than a discovery.
    const rows = await listComplianceState(env.DB);

    // A Map keeps insertion order, so the statement's `ORDER BY candidate.full_name` survives
    // the grouping and the sort below starts from a stable list rather than an arbitrary one.
    const byCandidate = new Map();
    for (const row of rows) {
      if (!byCandidate.has(row.candidate_id)) {
        byCandidate.set(row.candidate_id, { name: row.candidate_name, rows: [] });
      }
      // A candidate with no checklist rows arrives as one row with a null item_key (the LEFT
      // JOIN). They get a card with eight untouched items rather than vanishing from the screen.
      if (row.item_key) byCandidate.get(row.candidate_id).rows.push(row);
    }

    const candidates = [...byCandidate.entries()].map(([id, group]) => {
      const byKey = new Map(group.rows.map((row) => [row.item_key, row]));

      // THE LEFT JOIN RUNS OFF THE CATALOGUE AND NEVER OFF THE ROWS —
      // functions/prep/compliance/api/items.js:57-61 verbatim, and for its stated reason: a
      // candidate seeded before an item was added to the catalogue has no row for it, and
      // iterating the rows would make that item VANISH from the checklist rather than appear on
      // it as something to start. Catalogue order is also the display order; the store's ORDER BY
      // is a stable read order and says so. The mirror case falls out of the same rule — an
      // item_key retired from the catalogue whose rows survive simply does not appear.
      const items = COMPLIANCE_CATALOGUE.map((item) => {
        const row = byKey.get(item.key);
        const daysLeft = row?.days_left ?? null;
        return {
          item_key: item.key,
          label: item.label,
          expires: item.expires,
          // The threshold rides the wire so the browser holds no copy of it — the rule
          // `lead_days` follows on /api/assignments, and the reason a literal 30 or 60 in
          // public/compliance.js would be a second home for a catalogue number.
          amber_days: item.amberDays,
          status: row?.status ?? "missing",
          reference: row?.reference ?? "",
          expiry_date: row?.expiry_date ?? null,
          days_left: daysLeft,
          // The render-time computation. `expires: false` items can hold no deadline and never
          // carry a risk; an expiring item with no date yet has nothing to compute from.
          risk: item.expires && daysLeft !== null ? targetFor(daysLeft, item.amberDays) : null,
        };
      });

      return {
        id,
        full_name: group.name,
        items,
        // Never a hardcoded total: the catalogue holds what it holds (items.js's rule).
        total: items.length,
        // COMPLETENESS, THE RECRUITER'S VERSION, AND IT IS DELIBERATELY NOT items.js's `DONE`.
        // That set is `submitted|verified` because a candidate has nothing left to do on an item
        // they have handed over. This one counts `verified` alone, because verifying is the
        // RECRUITER's job and the gap between the two numbers is precisely the work sitting on
        // their desk. Two different questions, two different counts, not to be harmonised —
        // see functions/prep/compliance/api/items.js:32-43 before changing either.
        verified: items.filter((item) => item.status === "verified").length,
        // Same predicate and the same name as the candidate's screen, so "we have it" and "it
        // has been checked" stay tellable apart on both.
        awaiting_review: items.filter((item) => item.status === "submitted").length,
        // From the COMPUTED risk, never from the column. See the header.
        at_risk: items.filter((item) => item.risk !== null).length,
        missing: items.filter((item) => item.status === "missing").length,
        // Not in the response: the sort below needs the split, the screen does not.
        _expired: items.filter((item) => item.risk === "expired").length,
        _expiring: items.filter((item) => item.risk === "expiring").length,
      };
    });

    // THE AT-RISK ORDERING IS PART OF THE CONTRACT, NOT A RENDER DETAIL. "A booking-blocking red
    // item is unmissable" is the ticket's third bullet, so it is decided here and tested here
    // rather than in a browser function a later change could quietly reorder. Worst first:
    // most expired, then most expiring, then most missing, then the name for a stable tail.
    // Both risk counts come from `risk` and not from `status`, for the header's reason.
    candidates.sort(
      (a, b) =>
        b._expired - a._expired ||
        b._expiring - a._expiring ||
        b.missing - a.missing ||
        String(a.full_name).localeCompare(String(b.full_name)),
    );

    return json({
      candidates: candidates.map(({ _expired, _expiring, ...candidate }) => candidate),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
