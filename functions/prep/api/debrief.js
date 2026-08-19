// GET  /prep/api/debrief -> 200 { available: false }
//                        -> 200 { available: true, asked, shaky, fix_text, competencies }
// POST /prep/api/debrief    { asked, shaky, fix_text } -> 200 { ok: true }
//
// The candidate's private debrief (#77), SPEC Amendment 1: after the real interview, what they
// were asked, what felt shaky, and one thing to fix. Both methods live in one file because the
// RESOURCE is one thing — the items.js/item.js split next door is resource-shaped (a checklist
// and one item of it), not method-shaped, so it is not the precedent here.
//
// ⚠ CANDIDATE ROUTE — the same posture brief.js states at length: the /prep tree is Access-
// BYPASSED so a candidate who has never heard of Cloudflare Access can reach it at all, and
// `requireSession` on the invite cookie is what stops everyone else. This route is candidate
// CONTENT, so it is deliberately not on `PUBLIC_PREP_PATHS`. functions/prep/_middleware.js has
// already run `purgeExpired` before this handler is reached; a second purge would be a second
// full-table scan per request.
//
// ⚠ IT NEVER CROSSES THE WALL. DECISIONS.md decision 2 stands: nothing a candidate writes here is
// readable by any recruiter surface — no dashboard tile, no aggregation, no export. That is not a
// convention this file follows, it is asserted as a reachability claim in
// test/prep-debrief.test.js: no file under functions/api/ may mention the debrief at all.
//
// ZERO MODEL CALLS, structurally: this file imports no sdk. The ticket's constraint is that the
// competency mapping is DETERMINISTIC — the candidate ticks it — and keeping the import out is
// what makes that un-regressable rather than merely true today (session.js:6-11's argument).
//
// THE GATE IS DAY GRANULARITY, not an instant, and that is what makes "same-day" true. A
// date-only booking is stored `'YYYY-MM-DD 00:00:00'` (toSqliteUtc), so an instant comparison
// would open the debrief at midnight UTC on the morning of the interview — hours before it. Days
// are what `isNotPast` and `isDayBefore` already count, and `daysToInterview <= 0` reads as
// "the interview day has arrived or passed".
//
// THE PROJECTION DISCIPLINE (session.js's argument, restated): the GET response is written as a
// LITERAL. Competencies come back as {id, label} — never `importance`, `stage`, `success_rate`,
// and never the `shaky` flag targeting decorates, which exists to move a queue and not to be
// shown. There is no `saved_at`: nothing renders one, and with no `updated_at` column it would
// report the FIRST save, which is worse than absent.

import {
  roleByInviteId,
  competenciesByRole,
  debriefByRole,
  upsertDebrief,
  setShakyCompetencies,
  shakyCompetencyIds,
  insertAskedQuestion,
} from "../../../src/portal/store.js";
import { requireSession } from "../../../src/prep/session.js";
import { daysToInterview } from "../../../src/prep/targeting.js";
import { json, readJson, sameOrigin, errorResponse } from "../../../src/http.js";

// The whole body vocabulary — anything else is a 400, which is what keeps this endpoint from
// quietly growing fields (turn.js:61-63's rule). Note what is NOT here and could not be: there is
// no `competency_id` at the top level and no `role_id`, because the role is the session's, and no
// status word of any kind, because nothing on this page is anybody else's to write.
const ALLOWED = new Set(["asked", "shaky", "fix_text"]);

// One line is one question they remember. 500 characters is a long question said aloud and
// several times any real one; the cap exists so a paste cannot fill the column, not to edit them.
const LINE_MAX = 500;

// Twenty questions is a long panel interview's worth. Past that the form has stopped being a
// same-day note and the cap is the honest answer rather than a silent truncation.
const MAX_ASKED = 20;

// One thing to fix, with room to say why. 2,000 characters is a couple of paragraphs — past any
// real answer to "one thing", and far short of anything worth storing as a document.
const FIX_MAX = 2_000;

/**
 * `debrief.asked_json` as a list this route can answer with.
 *
 * A corrupt value degrades to an empty list rather than a 502. brief.js answers 502 for its own
 * stored JSON because that payload is a contract ANOTHER module owns (assertBrief) and a
 * mismatch is a deployment fault; this column is written by this route and read by nothing else,
 * and telling a candidate "your notes will not load" over a page that could still take new ones
 * is worse than starting the list empty. The code alone is logged — the value is candidate text.
 *
 * `known` nulls any placement no longer in the role's competency list. A competency can vanish
 * under a re-handover, and a stale id in a picker is a <select> with no matching option — the
 * line silently reads as placed somewhere the candidate cannot see.
 */
function askedFrom(raw, known) {
  let parsed;
  try {
    parsed = JSON.parse(String(raw ?? "[]"));
  } catch (err) {
    console.error("debrief: stored asked_json did not parse:", err?.name ?? "unknown");
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((entry) => entry && typeof entry.text === "string" && entry.text.trim())
    .map((entry) => ({
      text: entry.text,
      competency_id: known.has(entry.competency_id) ? entry.competency_id : null,
    }));
}

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!env.DB) return json({ error: "not_configured" }, 503);

  try {
    // No sameOrigin on a GET (src/http.js:41-43): the bolt is for mutating methods only.
    const session = await requireSession(env.DB, request);

    const role = await roleByInviteId(env.DB, session.inviteId);
    // A real state, not an error: the invite exists and the handover has not been written.
    if (!role) return json({ error: "not_found" }, 404);

    // Not a failure, so not an error (brief.js's register): "your interview has not happened yet"
    // is a PAGE state. The interview date is deliberately not in the body — the page has nothing
    // to do with it, and it is one field fewer on the wire.
    if (daysToInterview(role.interview_at, new Date()) > 0) return json({ available: false });

    const competencies = await competenciesByRole(env.DB, role.role_id);
    const known = new Set(competencies.map((c) => c.id));
    const row = await debriefByRole(env.DB, role.role_id);
    const shaky = await shakyCompetencyIds(env.DB, role.role_id);

    return json({
      available: true,
      // `competency_id: null` is an unplaced line, and that list IS the general queue: it stays
      // on this page with its picker open and becomes drillable the moment it is placed.
      asked: row ? askedFrom(row.asked_json, known) : [],
      shaky,
      fix_text: row ? String(row.fix_text ?? "") : "",
      competencies: competencies.map((c) => ({ id: c.id, label: c.label })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.DB) return json({ error: "not_configured" }, 503);
  if (!sameOrigin(request)) return json({ error: "cross_origin" }, 403);

  try {
    const body = await readJson(request);
    const unexpected = Object.keys(body ?? {}).filter((key) => !ALLOWED.has(key));
    if (unexpected.length) return json({ error: "unexpected_fields", fields: unexpected }, 400);

    const session = await requireSession(env.DB, request);
    const role = await roleByInviteId(env.DB, session.inviteId);
    if (!role) return json({ error: "not_found" }, 404);

    // A GET before the interview is a page state; a POST before it is a caller fault. The page
    // does not offer the form at all, so anything arriving here early is not the form.
    if (daysToInterview(role.interview_at, new Date()) > 0) return json({ error: "too_early" }, 403);

    // ── shape and caps, each its own answer ─────────────────────────────────────────────
    const rawAsked = body.asked ?? [];
    if (!Array.isArray(rawAsked)) return json({ error: "missing_fields", field: "asked" }, 400);
    if (rawAsked.length > MAX_ASKED) return json({ error: "too_long", field: "asked" }, 400);

    const rawShaky = body.shaky ?? [];
    if (!Array.isArray(rawShaky)) return json({ error: "missing_fields", field: "shaky" }, 400);

    const fixText = body.fix_text ?? "";
    if (typeof fixText !== "string") return json({ error: "missing_fields", field: "fix_text" }, 400);
    if (fixText.length > FIX_MAX) return json({ error: "too_long", field: "fix_text" }, 400);

    // TRIMMED ONCE, HERE, and the trimmed value is the only one that goes anywhere after this.
    // `insertAskedQuestion` derives a question's id from the SHA-256 of its text, so storing the
    // untrimmed string while hashing the trimmed one (or the reverse) would mint a second row
    // for every re-save whose line gained a trailing space — the exact duplication the derived
    // id exists to make impossible.
    const asked = [];
    for (const entry of rawAsked) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return json({ error: "missing_fields", field: "asked" }, 400);
      }
      if (typeof entry.text !== "string") return json({ error: "missing_fields", field: "asked" }, 400);
      const text = entry.text.trim();
      if (!text) continue; // a blank line is not a question; dropping it is what the page means
      if (text.length > LINE_MAX) return json({ error: "too_long", field: "asked" }, 400);
      const competencyId = entry.competency_id == null ? null : String(entry.competency_id);
      asked.push({ text, competency_id: competencyId });
    }

    // ── the ownership check ─────────────────────────────────────────────────────────────
    // Anything id-shaped in the body is checked against THIS role before it is written, and a
    // miss is 404, never a silent skip (turn.js's register): a competency under someone else's
    // invite is not found. Nothing is written before this passes.
    const competencies = await competenciesByRole(env.DB, role.role_id);
    const known = new Set(competencies.map((c) => c.id));
    // Deduped BEFORE the cap (#84 L4): the cap means "more ticks than this role has boxes", and
    // [id, id] is one tick said twice, not two. Counting the raw list answered 400 too_long for
    // a body every id of which was valid.
    const shaky = [...new Set(rawShaky.map((id) => String(id)))];
    if (shaky.length > competencies.length) return json({ error: "too_long", field: "shaky" }, 400);

    for (const id of [...shaky, ...asked.map((a) => a.competency_id)]) {
      if (id !== null && !known.has(id)) return json({ error: "not_found" }, 404);
    }

    // ── the writes, in dependency order ─────────────────────────────────────────────────
    // No transaction exists, so the order IS the recovery story (turn.js's header): a crash after
    // the first leaves their words saved and their ticks missing, which the next save fixes; a
    // crash after the second leaves a question row uncreated, which the next save fixes FOR FREE
    // because the id is derived from the text.
    //
    // The words are never left wrong, only unfinished. The TICKS have one narrower exposure and
    // it is stated rather than glossed: `setShakyCompetencies` deletes the set before it writes
    // the new one, so a failure between the two clears ticks that were already saved. They come
    // back with the next save of a page the candidate is looking at, and the store's header
    // argues why closing that window is not worth its own branch.
    const { id: debriefId } = await upsertDebrief(env.DB, { roleId: role.role_id, asked, fixText });
    await setShakyCompetencies(env.DB, { debriefId, competencyIds: shaky });

    try {
      for (const line of asked) {
        if (line.competency_id) {
          await insertAskedQuestion(env.DB, { competencyId: line.competency_id, text: line.text });
        }
      }
    } catch (err) {
      // Degrade, never discard the saved text (turn.js:207-212's move). The candidate's words are
      // already in the row; a question row that failed to appear costs them the practice, not the
      // note, and the retry is free because a re-save re-derives the same ids. The code alone is
      // logged — a message could quote what they typed.
      console.error("debrief: asked question insert failed:", err?.code ?? err?.name ?? "unknown");
    }

    // Nothing else comes back. The page re-fetches rather than patching (passport.js's rule), so
    // a count here would be a field to maintain for no reader.
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
