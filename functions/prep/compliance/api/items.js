// GET /prep/compliance/api/items -> 200 { total, done, awaiting_review, items: [...] }
//
// ⚠ CANDIDATE ROUTE — and the directory is the security decision. functions/prep/* is
// Access-BYPASSED (scripts/setup-access.py), which is what lets a locum who has never heard of
// Cloudflare Access reach it; `requireCandidate` on the compliance cookie is what stops
// everyone else. A file doing this under functions/api/ would be gated against the only person
// who needs it (functions/prep/api/brief.js:6-12).
//
// The checklist a candidate reads (#68): every catalogue item, its live state, and what they
// have already handed over. The join to the catalogue happens HERE and not in the browser —
// src/ is not in the Pages build output, so `import "../../src/compliance/catalogue.js"` from
// public/ 404s at runtime. public/prep/registry.js hit that wall and solved it by RETYPING its
// list in the browser with a drift test; this route takes the other branch because the
// passport's rows are data about the candidate rather than a vocabulary the browser must
// validate against. One fewer copy, one fewer drift test.
//
// IT RETURNS NO IDENTITY. No name, no email, no candidate id, no session stamp. The checklist
// is the answer to "what do I still owe you", and someone reading their own screen does not
// need to be told who they are. `candidateFromRequest` deliberately returns only
// `{candidateId, expiresAt}`, so a greeting would mean widening the session shape to carry
// identity — the exact property src/compliance/session.js exists to keep. What is DELIVERED is
// the guarantee, not what is rendered.
//
// The middleware already ran `purgeDormant` before this handler was reached, so a candidate
// past 12 months of dormancy has no row left to find and no session to read.

import { COMPLIANCE_CATALOGUE } from "../../../../src/compliance/catalogue.js";
import { itemsByCandidate } from "../../../../src/compliance/store.js";
import { requireCandidate } from "../../../../src/compliance/session.js";
import { json, errorResponse } from "../../../../src/http.js";

// What "done" means, said once so nobody has to guess it from the arithmetic.
//
// A candidate has nothing left to do on an item they have handed over, whether or not a
// recruiter has looked at it yet — so `submitted` counts alongside `verified`. The stricter
// reading (verified alone) would tell a locum who has sent everything that they are "0 of 8
// done", and they would conclude the product is broken rather than that the agency is slow.
// `missing`, `expiring` and `expired` are outstanding because each needs an action from them.
//
// `awaiting_review` is surfaced separately so "we have it" and "it has been checked" stay
// tellable apart on the page. Both are one predicate away from changing.
const DONE = new Set(["submitted", "verified"]);
const AWAITING_REVIEW = "submitted";

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!env.DB) return json({ error: "not_configured" }, 503);

  try {
    // No sameOrigin check: this is a GET, and src/http.js:41-43 says the bolt is for mutating
    // methods only.
    const { candidateId } = await requireCandidate(env.DB, request);
    const rows = await itemsByCandidate(env.DB, candidateId);
    const byKey = new Map(rows.map((row) => [row.item_key, row]));

    // The left join runs off the CATALOGUE and never off the rows. A candidate seeded before an
    // item was added has no row for it (src/compliance/catalogue.js:14-16 says that is expected),
    // and iterating the rows would make the new item vanish from the checklist rather than
    // appear on it as something to start. Catalogue order is also the display order — the
    // store's `ORDER BY item_key` is a stable READ order and says so.
    const items = COMPLIANCE_CATALOGUE.map((item) => {
      const row = byKey.get(item.key);
      return {
        item_key: item.key,
        label: item.label,
        expires: item.expires,
        // #70's seam. Nothing here computes an amber window or writes 'expiring'; the threshold
        // is returned so the radar reads the catalogue's number rather than inventing a second.
        amber_days: item.amberDays,
        status: row?.status ?? "missing",
        reference: row?.reference ?? "",
        expiry_date: row?.expiry_date ?? null,
      };
    });

    return json({
      // Never a hardcoded total. The epic's "7 of 12" is illustrative; the catalogue holds what
      // it holds, and adding an item is a catalogue edit rather than a migration.
      total: items.length,
      done: items.filter((item) => DONE.has(item.status)).length,
      awaiting_review: items.filter((item) => item.status === AWAITING_REVIEW).length,
      items,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
