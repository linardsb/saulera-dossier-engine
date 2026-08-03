// PUT /api/assignments/:id { end_date?, status? } -> { ok: true }
//
// The two shapes this endpoint serves, in the recruiter's own words:
//
//   EXTEND   a new end date. This RE-ARMS the radar — `updateAssignment` clears `nudge_sent_at`
//            in the same statement, so the new deadline produces a new nudge. That is the point
//            of the whole ticket: extending is the successful outcome of the first nudge, and a
//            radar that fires once per booking ever would go quiet exactly where it had just
//            proved its value. Read that function's comment before changing anything here.
//   RESOLVE  `status` moves to `ended` or `cancelled`. This does NOT re-arm: marking a booking
//            ended settles the nudge rather than re-asking the question.
//
// Clearing the end date (an empty value) is a third, quieter shape: it reopens the booking, and
// an open booking's candidate is held indefinitely by `purgeDormant`. That is inside the designed
// semantics — "a booking with no end is a live one" — and `updateAssignment` says so at length.
//
// PUT and not PATCH: functions/api/clients/[id].js uses onRequestPut for its partial update and
// this repo has no PATCH handler anywhere.

import { updateAssignment } from "../../../src/compliance/store.js";
import { isRealDate } from "../../../src/prep/dates.js";
import { json, readJson, sameOrigin, errorResponse } from "../../../src/http.js";

const ALLOWED = new Set(["end_date", "status"]);

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

    // THE PATCH IS BUILT CONDITIONALLY, because the store discriminates with `Object.hasOwn`.
    // Passing `{ endDate: undefined, status: undefined }` would make EVERY call look like a
    // two-field patch and clear `nudge_sent_at` on a status-only resolve — the exact bug the
    // re-arm rule exists to avoid, arriving through the route instead of the store.
    const patch = {};
    if (Object.hasOwn(body, "end_date")) {
      const raw = String(body.end_date ?? "").trim();
      // `|| null` is deliberate: an empty value means the recruiter cleared the date, which
      // reopens the booking. A non-empty one is round-tripped, for the same reason the POST
      // does it — a malformed date reaching the column's CHECK is a 500, and a 500 on this
      // deployment means deployment fault.
      if (raw && !isRealDate(raw)) return json({ error: "missing_fields", field: "end_date" }, 400);
      patch.endDate = raw || null;
    }
    // The status vocabulary is checked by the store (`requireOneOf` against
    // ASSIGNMENT_STATUSES), so it is deliberately NOT duplicated here: a bad value already
    // answers 400 `missing_fields` with the allowed list in the message.
    if (Object.hasOwn(body, "status")) patch.status = body.status;

    const { updated } = await updateAssignment(env.DB, String(params.id), patch);
    // No row matched. `updateAssignment` issues one statement and does no 404-before-write, so
    // `changes === 0` carries not-found on its own.
    if (!updated) return json({ error: "not_found" }, 404);

    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
