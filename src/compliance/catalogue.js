// The compliance checklist, as data (#67). Seeded from TTR's own `/compliance` page — the
// friction inventory the dossier records at §2 and §4-A: HCPC, enhanced DBS, right to work,
// immunisations, indemnity, references, WTR opt-out. That page today ends in "contact TTR for
// forms"; this array is the same list with a state a candidate and a recruiter can both see.
//
// Pure data, no imports, and deliberately its OWN file rather than a section of store.js — but
// NOT because the browser imports it. It cannot: src/ is not in the Pages build output, so an
// import from public/ would 404 at runtime. #68's passport reads this list through
// GET /prep/compliance/api/items, which joins it server-side, which is why the browser needs no
// copy of it and no drift test to keep one honest.
//
// `amberDays` is the lead-time at which an item stops being fine and starts being a warning —
// the number #70's expiry radar reads. Thresholds live in the catalogue and not in code
// (architecture, "Data model"), which is what makes a retune a one-line diff instead of a
// sweep through logic. `expires: false` items still get a checklist row; they simply never
// enter 'expiring'.
//
// Adding an item is an edit HERE plus a re-seed, never a migration: `compliance_item.item_key`
// carries no CHECK, and src/compliance/store.js validates against ITEM_KEYS instead.
export const COMPLIANCE_CATALOGUE = [
  { key: "hcpc_registration", label: "HCPC registration", expires: true, amberDays: 60 },
  { key: "dbs_enhanced", label: "Enhanced DBS check", expires: true, amberDays: 60 },
  { key: "right_to_work", label: "Right to work", expires: true, amberDays: 60 },
  { key: "immunisations", label: "Immunisation record", expires: true, amberDays: 30 },
  { key: "indemnity", label: "Professional indemnity insurance", expires: true, amberDays: 30 },
  { key: "references", label: "References", expires: false, amberDays: null },
  { key: "wtr_choice", label: "48-hour week choice (working time rules)", expires: false, amberDays: null },
  { key: "fit_to_work", label: "Fit-to-work check", expires: true, amberDays: 30 },
];

/** The keys the store will accept, in catalogue order. */
export const ITEM_KEYS = COMPLIANCE_CATALOGUE.map((item) => item.key);

/**
 * The five states a checklist row can hold, as `compliance_item.status`'s CHECK declares
 * them. Exported so #68's passport and #70's sweep read this list rather than each inventing
 * a sixth state the column would then reject at write time.
 */
export const ITEM_STATUSES = ["missing", "submitted", "verified", "expiring", "expired"];

/**
 * How many days before a booking ends the recruiter is nudged to extend or redeploy (#69).
 *
 * It lives HERE for the same reason `amberDays` does: thresholds live in the catalogue and not
 * in code (architecture, "Data model"), which is what makes a retune a one-line diff rather
 * than a sweep through logic. Beside the array rather than inside it, because a booking has ONE
 * lead time — it is not a per-item value, and there is no checklist row it belongs to.
 *
 * The browser cannot import this (see the header: src/ is not in the Pages build output), so
 * public/assignments.js reads the number off GET /api/assignments rather than carrying a second
 * copy that could drift from the sweep's.
 */
export const EXTENSION_LEAD_DAYS = 14;
