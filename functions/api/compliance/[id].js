// PUT /api/compliance/:candidateId { item_key, action: "verify" | "reject", reason? }
//                                  -> { ok: true } | { ok: true, emailed: true|false }
//
// The recruiter's two decisions on one checklist item (#71). VERIFY is the first and only write
// of `verified` in this product — the word has been in the column's CHECK since #67 and no code
// path could set it. SEND BACK resets the item to `missing` with its reference and date cleared,
// and emails the candidate the recruiter's one-line reason.
//
// PUT and not PATCH: functions/api/clients/[id].js and functions/api/assignments/[id].js both use
// onRequestPut for a partial update and this repo has no PATCH handler anywhere.
//
// THE ORDER OF THE GUARDS IS THE DESIGN, AND THE REJECT PATH BAILS BEFORE IT WRITES.
//
// #69 bails before claiming because the email is a courtesy and the screen stays true without
// it. #70 claims regardless, because the state IS what the passport renders and refusing to
// claim would mean refusing to know. REJECT IS NEITHER. The state change is visible to the
// candidate — the item resets to "Not sent in" with the reference gone — but its entire CONTENT,
// the reason, exists only in the email: src/compliance/store.js's rejectItem stores no note and
// the ticket adds no column for one. A write with no send therefore leaves a locum staring at an
// item that has silently emptied itself, with no way to learn why, most likely re-submitting the
// identical reference. So this bails like #69: the item stays `submitted`, which is TRUE, and
// the recruiter is told to fix the configuration.
//
// Which is why EVERY precondition for the message is settled above the write, not just the
// configuration: the recipient too. `candidateEmailById` runs before `rejectItem`, so an unknown
// candidate is 404 BEFORE writing (the rule functions/api/assignments.js:98-107 and
// src/store.js:210 both argue for by name) and a blank address is 503 before writing as well.
// Otherwise the same failure is reachable through a second door — the item resets and no email
// is possible. It also narrows what `emailed: false` can mean down to exactly one thing, Resend
// threw, which is what makes the page's copy for that case honest.
//
// A caller-fixable input answers 400 at the door rather than reaching a CHECK, because a 500 on
// this deployment means DEPLOYMENT FAULT (DEPLOY.md §4) and that signal must stay clean.

import { COMPLIANCE_CATALOGUE, ITEM_KEYS } from "../../../src/compliance/catalogue.js";
import { verifyItem, rejectItem, candidateEmailById } from "../../../src/compliance/store.js";
import { getAgency } from "../../../src/store.js";
import { sendRejectionEmail } from "../../../src/prep/email.js";
import { json, readJson, sameOrigin, errorResponse } from "../../../src/http.js";

// The whole body vocabulary. A key outside this set answers 400 rather than being ignored —
// /api/events' rule at a fourth root.
const ALLOWED = new Set(["item_key", "action", "reason"]);

// "One line" is the ticket's word for the reason, and this is the number that makes it one. The
// cap is here rather than in src/prep/email.js because a value capped twice with two different
// numbers is a message truncated at a length nobody chose. Without any cap, a runaway paste
// becomes a Resend rejection (422) that surfaces as `emailed: false` with no way to diagnose it.
const REASON_MAX = 200;

/**
 * src/compliance/nudges.js:65-77's PREP_BASE_URL discipline, written out here rather than
 * imported.
 *
 * Importing it would pull that module's mail layer and `getAgency` into this file through a
 * second path, and this route already reaches both deliberately and narrowly. The house has made
 * this call before and written it down: "two small duplications rather than one shared risk"
 * (functions/prep/auth/verify.js:21-23). If the rule changes, it changes in both — a bare https
 * origin or nothing.
 */
function baseUrl(env) {
  const configured = String(env?.PREP_BASE_URL ?? "").trim();
  if (!configured) return null;
  try {
    const url = new URL(configured);
    if (url.protocol === "https:" && (url.pathname === "/" || !url.pathname) && !url.search && !url.hash) {
      return url.origin;
    }
  } catch {
    // Falls to null: the route refuses rather than mailing a broken link.
  }
  return null;
}

export async function onRequestPut(context) {
  const { request, env, params } = context;

  if (!env.DB) return json({ error: "not_configured" }, 503);
  if (!sameOrigin(request)) return json({ error: "cross_origin" }, 403);

  try {
    const body = await readJson(request);
    const unexpected = Object.keys(body ?? {}).filter((key) => !ALLOWED.has(key));
    if (unexpected.length) {
      return json({ error: "unexpected_fields", fields: unexpected }, 400);
    }

    // Checked against the catalogue HERE rather than left to the store's throw, so an unknown
    // item is a 400 the page can act on rather than an error the caller cannot read
    // (functions/prep/compliance/api/item.js:53-56).
    const itemKey = String(body.item_key ?? "").trim();
    if (!ITEM_KEYS.includes(itemKey)) return json({ error: "missing_fields", field: "item_key" }, 400);

    // `action` and not `status`: `reject` maps to the status `missing`, which is not guessable
    // from the wire, and the reason field only makes sense for one of the two. The word names
    // what the recruiter did; a status would name a side effect.
    const action = String(body.action ?? "").trim();
    if (action !== "verify" && action !== "reject") {
      return json({ error: "missing_fields", field: "action" }, 400);
    }

    // A REASON ON A VERIFY IS A 400, NOT A SILENTLY IGNORED KEY. item.js:76-80's treatment of a
    // date on a non-expiring item, for its reason: a body carrying a field the action has no use
    // for is a caller who believes something this route is not doing.
    if (action === "verify" && Object.hasOwn(body, "reason")) {
      return json({ error: "unexpected_fields", fields: ["reason"] }, 400);
    }

    if (action === "verify") {
      const { updated } = await verifyItem(env.DB, { candidateId: String(params.id), itemKey });
      // 409 AND NOT 404, which is this route's one divergence from the house pattern. The
      // candidate and the item almost certainly exist; what refused is the compare-and-swap's
      // state guard — the item is not `submitted`. A recruiter told "not found" would reload and
      // see the row still sitting there. The most common cause is not an error at all: the item
      // ambered while it sat on their desk, and src/compliance/store.js's verifyItem carries the
      // argument for why that is refused rather than allowed.
      if (!updated) return json({ error: "not_submitted" }, 409);
      return json({ ok: true });
    }

    // ── reject: everything the message needs, settled before anything is written ──────────

    const reason = String(body.reason ?? "").trim();
    if (!reason || reason.length > REASON_MAX) {
      return json({ error: "missing_fields", field: "reason" }, 400);
    }

    const base = baseUrl(env);
    if (!env.RESEND_API_KEY || !base) return json({ error: "mail_not_configured" }, 503);

    // The address, one column and no second (src/compliance/store.js, candidateEmailById). Read
    // ABOVE the write: an unknown candidate is a 404 before writing, and a blank address is the
    // same refusal as a missing API key because the outcome is identical — no message can be
    // sent, so nothing may be reset.
    const candidate = await candidateEmailById(env.DB, params.id);
    if (!candidate) return json({ error: "not_found" }, 404);
    const to = String(candidate.email ?? "").trim();
    if (!to) return json({ error: "mail_not_configured" }, 503);

    const { updated } = await rejectItem(env.DB, { candidateId: String(params.id), itemKey });
    if (!updated) return json({ error: "not_submitted" }, 409);

    // The DISPLAY label, from the catalogue and never the raw key: a candidate must not read
    // `dbs_enhanced` in an email.
    const label = COMPLIANCE_CATALOGUE.find((entry) => entry.key === itemKey)?.label ?? "";
    // The same degradation src/compliance/nudges.js:116 takes — a missing agency row must not
    // fail the reject; the message falls back to "your recruitment agency".
    const agency = await getAgency(env.DB).catch(() => null);

    let emailed = true;
    try {
      await sendRejectionEmail(env, {
        to,
        agencyName: agency?.name,
        label,
        reason,
        // The candidate's own door, and the COMPLIANCE one: the two portals hold independent
        // cookies and /prep/login would sign them in to the interview-prep product.
        link: `${base}/prep/compliance/login`,
      });
    } catch (err) {
      // Status only: never the recipient, never the item, never the reason
      // (src/compliance/nudges.js:268-271's rule).
      console.error("rejection send failed:", err?.code ?? err?.name ?? "unknown");
      emailed = false;
    }

    // THE WRITE IS NOT ROLLED BACK. The item genuinely is reset — the compare-and-swap won — and
    // a rollback would be a second write racing the candidate's own re-submit. After the guards
    // above, `emailed: false` means exactly one thing: Resend threw. The page tells the recruiter
    // to phone them, which is honest because there is nothing else it could mean.
    return json({ ok: true, emailed });
  } catch (err) {
    return errorResponse(err);
  }
}
