// POST /api/prep/prepare { client_id, brief, cv, interview_at }
//   -> 200 { payload, provenance, failures, interview_at, visible_fields, duration_ms }
//
// Step one of the two-step Send (#22). Decision 15 requires the recruiter to see the extracted
// competencies before anything is sent, and those competencies do not exist until the model
// call has run — so the call happens here, and NOTHING ELSE DOES.
//
// PERSISTS NOTHING. MINTS NO TOKEN. EMAILS NOBODY. RECORDS NO EVENT. A prepare the recruiter
// looks at and abandons must leave no trace: `createInvite`'s comment (src/portal/store.js:108)
// says there is deliberately no draft state, and a draft would be candidate data — a CV —
// persisted for a send that may never happen, inside a retention regime keyed on an interview
// date that may never arrive. The browser holds the payload in memory and posts it back to
// /api/prep/send, which re-verifies everything from scratch.
//
// ⚠ THIS IS THE SECOND MODEL CALL SITE, and functions/api/generate.js:4-8 says not to add one.
// The exemption is architecture §5, which names exactly two: "at Send (claude-opus-5)" and "in
// session (claude-sonnet-5)". This is the first of those two. §5.6's switchability argument
// still holds because this is still one Function, behind the same per-deployment
// ANTHROPIC_API_KEY, at a boundary the data posture can be changed at — which is what that
// rule was protecting, rather than the literal count of files. A third call site that is not
// in §5 is still wrong.
//
// ⚠ RECRUITER ROUTE. It lives under functions/api/ because that tree is behind Cloudflare
// Access. scripts/setup-access.py:110-111 puts `Bypass → Everyone` on <project>.pages.dev/prep,
// so the same file at functions/prep/prepare.js would be an UNAUTHENTICATED endpoint that
// spends ~30p of Opus per request to anyone who guesses the path. The directory is the
// security decision here, not a filing one.

import Anthropic from "@anthropic-ai/sdk";

import { generateBrief } from "../../../src/prep/generate.js";
import { MAX_MONTHS_AHEAD, isNotPast, isWithinHorizon, toSqliteUtc } from "../../../src/prep/dates.js";
import { visibleFields } from "../../../src/note-fields.js";
import { getClient, listVisibleKeys, StoreError } from "../../../src/store.js";
import { json, readJson, sameOrigin, errorResponse } from "../../../src/http.js";

// The whole body vocabulary, guarded as /api/generate guards its own. `field_keys` is the key
// a well-meaning change would add here "so the client does not have to look them up twice" —
// answering 400 is what stops the visibility gate becoming a browser-supplied suggestion.
const ALLOWED = new Set(["client_id", "brief", "cv", "interview_at"]);

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.DB) return json({ error: "not_configured" }, 503);
  if (!env.ANTHROPIC_API_KEY) return json({ error: "no_model_key" }, 503);
  if (!sameOrigin(request)) return json({ error: "cross_origin" }, 403);

  try {
    const body = await readJson(request);
    const unexpected = Object.keys(body).filter((key) => !ALLOWED.has(key));
    if (unexpected.length) {
      return json({ error: "unexpected_fields", fields: unexpected }, 400);
    }

    // AC #1's SERVER HALF. The CTA being locked in the browser is a courtesy; this is the
    // enforcement, and it runs before the model call so a mistyped year costs nothing.
    // Decision 9: the CTA unlocks when an interview date exists.
    const interviewAt = toSqliteUtc(body.interview_at);
    if (!isNotPast(interviewAt)) {
      throw new StoreError("interview_past", 400, "interview_at: that date has already passed");
    }
    // And the far end, refused HERE too rather than only at Send — the whole reason this check
    // runs before the model call is that a mistyped year should cost nothing.
    if (!isWithinHorizon(interviewAt)) {
      throw new StoreError(
        "interview_too_far",
        400,
        `interview_at: that date is more than ${MAX_MONTHS_AHEAD} months away — check the year`,
      );
    }

    // 404 before the model call, not after — an unknown client id should cost nothing
    // (functions/api/generate.js:49).
    const client = await getClient(env.DB, body.client_id);

    // THE GATE (#18). The client's note appears exactly here, as this call's first argument,
    // and nowhere else in this file — src/note-fields.js:5-12 states the rule and a Level 1
    // grep enforces it. `slice` is what generation sees; the note never travels further.
    const slice = visibleFields(client.note, await listVisibleKeys(env.DB, client.id));

    const result = await generateBrief(new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }), {
      clientName: client.name,
      visibleFields: slice,
      brief: body.brief,
      cv: body.cv,
      interviewAt,
    });

    return json({
      payload: result.payload,
      provenance: result.provenance,
      failures: result.failures,
      // Normalised, so the browser posts back the same stamp the server already accepted
      // rather than re-deriving one from a date input in the recruiter's local zone.
      interview_at: interviewAt,
      // HEADINGS AND COUNTS, NEVER THE SECTION TEXT. The recruiter is one link away from the
      // note on /clients, and a second copy of business-context personal data on a second
      // screen widens where it appears for one click of convenience. src/store.js:301-306
      // makes this argument about its own list and explicitly leaves the decision here.
      visible_fields: slice.map(({ key, heading, chars }) => ({ key, heading, chars })),
      duration_ms: result.duration_ms,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
