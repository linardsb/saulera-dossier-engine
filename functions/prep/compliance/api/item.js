// POST /prep/compliance/api/item { item_key, reference, expiry_date? } -> 200 { ok: true }
//
// ⚠ CANDIDATE ROUTE — see ./items.js for why this tree is Access-bypassed and what stops
// everyone else.
//
// One checklist item, handed over from a phone (#68). METADATA ONLY: a typed reference number
// and a date. Nothing in this ticket accepts a document — no photo, no PDF, no link to one —
// because spike #66 decided no document byte rests on our infrastructure
// (docs/epics/locum-fit-2.architecture.md, "Storage: metadata-only"). Documents keep moving
// over the agency's existing channels. R2 custody is a later milestone with its own spike, its
// own retention and a commercial agreement first. (Written without the upload API names on
// purpose: the plan's Level 1 gate greps this tree for them, and a gate that cries wolf at a
// comment gets deleted.)
//
// THE STATUS IS NOT IN THE BODY VOCABULARY, and that is this route's security decision.
// `setItemState` accepts all five of ITEM_STATUSES (src/compliance/store.js), so a `status` key
// here would let a candidate write themselves `verified` — which is the recruiter's word and
// #71's write — or `expired`, which is #70's sweep. `ALLOWED` therefore holds three keys and
// none of them is `status`, and `"submitted"` is a literal below. A body carrying `status`
// answers 400 `unexpected_fields` and writes nothing.
//
// RE-SUBMITTING AN ALREADY-VERIFIED ITEM SETS IT BACK TO `submitted`, deliberately. A new
// reference number is a new claim and nobody has checked it; leaving the old `verified` chip
// standing over a number nobody has seen is the failure this whole epic exists to prevent.
// It looks like a bug and is not one — do not "fix" it.

import { COMPLIANCE_CATALOGUE, ITEM_KEYS } from "../../../../src/compliance/catalogue.js";
import { setItemState } from "../../../../src/compliance/store.js";
import { requireCandidate } from "../../../../src/compliance/session.js";
import { json, readJson, sameOrigin, errorResponse } from "../../../../src/http.js";

const ALLOWED = new Set(["item_key", "reference", "expiry_date"]);

/** Exactly what `<input type="date">` submits, whatever locale it displays in. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Is this a real calendar day, and not merely a well-shaped string?
 *
 * The regex alone is not enough. V8 refuses a bad month (`2026-13-01` does not parse) but
 * silently ROLLS a bad day: `Date.parse('2026-02-30')` lands on 2 March. Without the round trip
 * this route would answer 200 to a date the candidate did not choose, and #70's radar would
 * later chase the wrong one. src/prep/dates.js:63-70 records the same trap on `interview_at`.
 *
 * Parsed as UTC — `${raw}T00:00:00Z` — for the reason src/prep/tokens.js:113-119 gives: a
 * space- or zone-less string is read as LOCAL time, and in British Summer Time that is an hour
 * of drift, which across midnight is a whole day.
 */
function isRealDate(raw) {
  if (!DATE_ONLY.test(raw)) return false;
  const ms = Date.parse(`${raw}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === raw;
}

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

    const { candidateId } = await requireCandidate(env.DB, request);

    // The key is checked against the catalogue HERE rather than left to the store's throw, so an
    // unknown item is a 400 the page can act on rather than an error the caller cannot read.
    const itemKey = String(body.item_key ?? "").trim();
    if (!ITEM_KEYS.includes(itemKey)) return json({ error: "missing_fields", field: "item_key" }, 400);

    // Free text a stranger typed. It is BOUND by the store, rendered as a text node by the
    // page, and never logged — the three places it could otherwise become something else.
    const reference = String(body.reference ?? "").trim();
    if (!reference) return json({ error: "missing_fields", field: "reference" }, 400);

    // The expiry rule is the catalogue's, per item, and it is enforced in both directions.
    const item = COMPLIANCE_CATALOGUE.find((entry) => entry.key === itemKey);
    const expiryDate = String(body.expiry_date ?? "").trim();

    if (item.expires) {
      // An expiring item with no date is invisible to the radar this epic exists to build
      // (#70): it can never enter 'expiring', so it silently becomes the booking that fails.
      if (!expiryDate) return json({ error: "missing_fields", field: "expiry_date" }, 400);
      // The store binds `expiryDate` straight through and `compliance_item.expiry_date` carries
      // `CHECK (datetime(expiry_date) IS NOT NULL)` — so a malformed string would be an
      // ERR_SQLITE_ERROR and a 500, which on this deployment means "deployment fault"
      // (DEPLOY.md's triage table). A caller-fixable input must not pollute that signal.
      if (!isRealDate(expiryDate)) return json({ error: "missing_fields", field: "expiry_date" }, 400);
    } else if (expiryDate) {
      // References and the WTR choice do not expire. Accepting a date for them would put a
      // number in a column #70 reads as a deadline for something that has none.
      return json({ error: "unexpected_fields", fields: ["expiry_date"] }, 400);
    }

    const { updated } = await setItemState(env.DB, {
      candidateId,
      itemKey,
      status: "submitted",
      reference,
      expiryDate: item.expires ? expiryDate : null,
    });
    // No row matched: the candidate's checklist was never seeded, or the item was added to the
    // catalogue after they were. Either way there is nothing to update and saying so is honest —
    // `createCandidate` is the one writer that seeds, and a silent success would hide a gap.
    if (!updated) return json({ error: "not_found" }, 404);

    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
