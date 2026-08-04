// GET  /api/assignments -> { assignments: [{ id, start_date, end_date, status, nudge_sent_at,
//                                            candidate_name, client_name }], lead_days }
// POST /api/assignments { candidate_name, candidate_email, client_id, start_date, end_date? }
//                       -> 201 { assignment }
//
// A thin adapter, the shape functions/api/clients.js sets: parse, guard, delegate, serialise.
//
// WHAT THIS ROUTE QUIETLY IS: the first production path in the product that creates a
// `candidate` row. #68 shipped the compliance passport with no such path on purpose ("#71 owns
// both"), and `assignment.client_id`/`candidate_id` being NOT NULL foreign keys makes it
// unavoidable here — you cannot record a booking without a candidate to hang it off. Two
// consequences that belong in the open rather than in a commit message:
//
//   · Recording a booking SEEDS ALL EIGHT COMPLIANCE CHECKLIST ROWS (`createCandidate` is the
//     one writer that seeds, deliberately). So a booking is also the moment a candidate's
//     health-adjacent compliance file starts existing. The privacy notice #68 wrote covers the
//     class and its retention, and it still reads true from this new entry point.
//   · The candidate's email is collected here even though this ticket never emails a candidate.
//     It is the reuse key — and it is the passport's sign-in key (`candidateByEmail`), which is
//     what makes the passport usable on a real deployment as a side effect of this ticket.
//
// `lead_days` rides the GET so public/assignments.js can colour the amber rows without carrying
// its own copy of the number: the browser cannot import src/ (not in the Pages build output),
// and a literal 14 in the page would give the threshold a second home while the sweep kept the
// first — exactly what "thresholds live in the catalogue, not code" exists to prevent.
//
// `functions/` sits at the repo root, never under `public/` (DEPLOY.md §1). This route is
// Access-gated by being outside /prep/*; the portal's two bypass apps do not reach it, and
// `sameOrigin` on the POST is the second lock rather than the first.

import {
  listAssignments,
  createAssignment,
  createCandidate,
  candidateByEmail,
} from "../../src/compliance/store.js";
import { getClient } from "../../src/store.js";
import { EXTENSION_LEAD_DAYS } from "../../src/compliance/catalogue.js";
import { isRealDate } from "../../src/prep/dates.js";
import { json, readJson, sameOrigin, errorResponse } from "../../src/http.js";

// The whole body vocabulary, /api/events' rule at a second root: a key outside this set answers
// 400 rather than being ignored, so a well-meaning `candidate_nhs_number` added "just for the
// booking form" fails loudly and costs three lines.
const ALLOWED = new Set(["candidate_name", "candidate_email", "client_id", "start_date", "end_date"]);

export async function onRequestGet(context) {
  const { env } = context;

  // Binding first, deliberately. A missing binding is a deployment fault the caller cannot fix,
  // so 503 is the honest answer.
  if (!env.DB) return json({ error: "not_configured" }, 503);

  try {
    return json({ assignments: await listAssignments(env.DB), lead_days: EXTENSION_LEAD_DAYS });
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
    if (unexpected.length) {
      return json({ error: "unexpected_fields", fields: unexpected }, 400);
    }

    const fullName = String(body.candidate_name ?? "").trim();
    if (!fullName) return json({ error: "missing_fields", field: "candidate_name" }, 400);

    const email = String(body.candidate_email ?? "").trim();
    if (!email) return json({ error: "missing_fields", field: "candidate_email" }, 400);

    // Both dates are stored DATE-ONLY ('YYYY-MM-DD') — what <input type="date"> submits, what
    // `compliance_item.expiry_date` already holds, what the column's CHECK accepts, and what
    // every query in the radar wraps in `date()`. Validated HERE and not left to the CHECK: a
    // malformed date reaching the column is an ERR_SQLITE_ERROR and a 500, and on this
    // deployment a 500 means deployment fault, so a caller-fixable input must never produce one.
    const startDate = String(body.start_date ?? "").trim();
    if (!isRealDate(startDate)) return json({ error: "missing_fields", field: "start_date" }, 400);

    const rawEnd = String(body.end_date ?? "").trim();
    const endDate = rawEnd || null;
    if (endDate) {
      if (!isRealDate(endDate)) return json({ error: "missing_fields", field: "end_date" }, 400);
      // A booking that ends before it begins is a typo, and the radar would either never fire
      // (already past) or fire on a deadline nobody means. Date-only strings sort lexically the
      // same way they sort chronologically, which is why this is a string comparison.
      if (endDate < startDate) return json({ error: "missing_fields", field: "end_date" }, 400);
    }

    // THE CLIENT IS RESOLVED BEFORE THE FIRST WRITE, AND THE ORDER IS THIS FILE'S WHOLE POINT.
    // `assignment.client_id` is NOT NULL REFERENCES clients(id) and D1 enforces foreign keys, so
    // a stale or typo'd id makes `createAssignment` throw ERR_SQLITE_ERROR — AFTER
    // `createCandidate` has run and seeded eight compliance_item rows. D1 gives this path no
    // transaction, so what would be left behind is a candidate no booking points at, eight
    // health-adjacent rows nobody asked for, and a 500 that reads as deployment fault; and
    // `purgeDormant` will not collect that orphan for twelve months, because its created_at is
    // fresh. `getClient` throws the store's 404 for an unknown id, so this costs one line and one
    // await. `updateClient` does the same thing for the same reason and says so: "404 before
    // writing, not after" (src/store.js:210).
    const client = await getClient(env.DB, body.client_id);

    // Create-or-reuse. Email is the key because it is already the sign-in key
    // (`candidateByEmail`), and the case-insensitivity is that function's job, not this route's.
    // Reusing rather than re-creating is also what stops a second booking re-seeding a checklist
    // the candidate has already filled in.
    const existing = await candidateByEmail(env.DB, email);
    const candidateId = existing?.id ?? crypto.randomUUID();
    if (!existing) {
      await createCandidate(env.DB, { id: candidateId, fullName, email });
    }

    // `status` omitted so the store's 'booked' applies — one place decides what a new booking
    // opens as, and it is not this route.
    const id = crypto.randomUUID();
    await createAssignment(env.DB, {
      id,
      candidateId,
      clientId: client.id,
      startDate,
      endDate,
    });

    return json(
      {
        assignment: {
          id,
          start_date: startDate,
          end_date: endDate,
          status: "booked",
          nudge_sent_at: null,
          candidate_name: fullName,
          client_name: client.name,
        },
      },
      201,
    );
  } catch (err) {
    return errorResponse(err);
  }
}
