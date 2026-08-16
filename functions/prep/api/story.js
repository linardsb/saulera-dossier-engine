// POST /prep/api/story { action: "save",   id, title, sketch, competency_ids } -> 200 { ok: true, id }
// POST /prep/api/story { action: "delete", id }                                -> 200 { ok: true }
//
// ONE story of the candidate's storybank (#78) — the item half of the collection/item split
// ./stories.js's header argues, after functions/prep/compliance/api/item.js next door.
//
// ⚠ CANDIDATE ROUTE — see ./stories.js for why this tree is Access-bypassed, what stops everyone
// else, why it never crosses the wall, and why it imports no sdk and no drill.js. Every one of
// those claims holds here identically and is asserted over both files at once.
//
// POST, NEVER `onRequestDelete`, and functions/prep/api/delete.js:6-7 is the house pattern rather
// than a preference: a destructive action reachable by URL-click gets prefetched by mail scanners
// and link previewers, and the whole portal's mutation surface is POST-with-a-body. A story is
// paragraphs the candidate typed and cannot re-type, so this is the surface where that matters.
//
// THE TWO VOCABULARIES NEVER CROSS. On `action: "delete"`, any of `title`/`sketch`/
// `competency_ids` present is a 400 — turn.js:86-100's rule, and the reason it is worth the four
// extra lines: a field carrying two meanings is how a delete quietly becomes a save, or a save a
// delete. The words are separate here for the same reason `rung` and `mode` are separate there.
//
// OWNERSHIP LIVES IN THE SQL, NOT IN A PRECEDING STATEMENT, and this is the security-relevant
// property of the file. Both writes are role-scoped inside their own WHERE clause — `updateStory`
// and `deleteStory` carry `AND candidate_role_id = ?` and report `{updated}`/`{deleted}` — so a
// story id from another invite matches no row, changes nothing, and is answered 404. Do NOT
// reintroduce a read-then-write membership check: there is no transaction on D1, and a check in a
// separate statement is bypassable in a way a WHERE clause is not. src/portal/store.js's
// createStory JSDoc carries the long form of this argument.

import {
  roleByInviteId,
  competenciesByRole,
  updateStory,
  deleteStory,
  setStoryCompetencies,
} from "../../../src/portal/store.js";
import { requireSession } from "../../../src/prep/session.js";
import { json, readJson, sameOrigin, errorResponse } from "../../../src/http.js";

// The whole body vocabulary across BOTH actions. Which subset each action may carry is enforced
// below — this set only decides what the endpoint has heard of at all.
const ALLOWED = new Set(["action", "id", "title", "sketch", "competency_ids"]);

// Only the fields a save may carry; the delete branch refuses every one of them by name.
const SAVE_ONLY = ["title", "sketch", "competency_ids"];

// ./stories.js OWNS THESE TWO NUMBERS. They are retyped rather than imported, and the reason is
// structural rather than stylistic: src/http.js:4-5 says anything under functions/ is a route, so
// there is no helper module to put a shared constant in, and importing a constant across two live
// endpoints couples one route's module graph to another's for two integers.
//
// Retyped-with-a-drift-test is this codebase's settled answer to exactly that (public/prep/
// registry.js retypes the compliance catalogue in the browser for the same reason and is gated the
// same way) — test/prep-storybank.test.js parses both files and fails if these numbers stop
// matching stories.js's. MAX_STORIES is deliberately absent: this route creates nothing, so a
// story count is not its business to check or to know.
const TITLE_MAX = 120;
const SKETCH_MAX = 2_000;

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.DB) return json({ error: "not_configured" }, 503);
  if (!sameOrigin(request)) return json({ error: "cross_origin" }, 403);

  try {
    // `readJson` already rejects `null`, `[]` and `42` with 400 bad_json (src/http.js:24-33), so
    // there is nothing to re-guard here.
    const body = await readJson(request);
    const unexpected = Object.keys(body).filter((key) => !ALLOWED.has(key));
    if (unexpected.length) return json({ error: "unexpected_fields", fields: unexpected }, 400);

    const action = body.action;
    if (action !== "save" && action !== "delete") return json({ error: "missing_fields" }, 400);

    // The id is the ONLY id-shaped value this route accepts, and it is never trusted — it is
    // handed to a WHERE clause that scopes it to this session's role.
    const storyId = String(body.id ?? "");
    if (!storyId) return json({ error: "missing_fields", field: "id" }, 400);

    const session = await requireSession(env.DB, request);
    const role = await roleByInviteId(env.DB, session.inviteId);
    if (!role) return json({ error: "not_found" }, 404);

    // ── delete: the narrow vocabulary, and nothing written before it is checked ─────────
    if (action === "delete") {
      const crossed = SAVE_ONLY.filter((key) => body[key] !== undefined);
      if (crossed.length) return json({ error: "unexpected_fields", fields: crossed }, 400);

      const { deleted } = await deleteStory(env.DB, { roleId: role.role_id, storyId });
      // `false` means the WHERE clause matched nothing: no such story, or one under another
      // invite. Both are "not found" to this caller, and neither wrote anything. Answering 404
      // rather than 200 is also what stops this endpoint being an oracle for whether a given id
      // exists somewhere else in the database.
      if (!deleted) return json({ error: "not_found" }, 404);

      // Nothing else comes back. The page re-fetches the collection (passport.js's rule), so a
      // count or a remaining-stories number here would be a field to maintain for no reader.
      return json({ ok: true });
    }

    // ── save: the same caps stories.js applies, for the same reasons ────────────────────
    const title = String(body.title ?? "").trim();
    if (!title) return json({ error: "missing_fields", field: "title" }, 400);
    if (title.length > TITLE_MAX) return json({ error: "too_long", field: "title" }, 400);

    // Blank is legal — a title-only story is a real half-written state, and an edit that clears
    // the sketch box is a real erasure the candidate meant.
    const sketch = body.sketch ?? "";
    if (typeof sketch !== "string") return json({ error: "missing_fields", field: "sketch" }, 400);
    if (sketch.length > SKETCH_MAX) return json({ error: "too_long", field: "sketch" }, 400);

    const rawCovers = body.competency_ids ?? [];
    if (!Array.isArray(rawCovers)) {
      return json({ error: "missing_fields", field: "competency_ids" }, 400);
    }

    // The ownership check on the OTHER id-shaped values, before any write: a competency under
    // someone else's invite is not found (stories.js's register, and debrief.js:185-196's).
    const competencies = await competenciesByRole(env.DB, role.role_id);
    const known = new Set(competencies.map((c) => c.id));
    if (rawCovers.length > competencies.length) {
      return json({ error: "too_long", field: "competency_ids" }, 400);
    }
    const covers = rawCovers.map((id) => String(id));
    for (const id of covers) {
      if (!known.has(id)) return json({ error: "not_found" }, 404);
    }

    const { updated } = await updateStory(env.DB, { roleId: role.role_id, storyId, title, sketch });
    if (!updated) return json({ error: "not_found" }, 404);

    // ONLY after a matched update. An update that matched no row must not go on to write ticks
    // against a story id this candidate does not own — `setStoryCompetencies` is story-scoped and
    // takes no role, deliberately (its caller has already proved ownership), so reaching it on the
    // 404 path would write into another invite's story. The early return above is what stops that,
    // and it is the reason the two writes are not reordered for symmetry with stories.js.
    await setStoryCompetencies(env.DB, { storyId, competencyIds: [...new Set(covers)] });

    return json({ ok: true, id: storyId });
  } catch (err) {
    // No log line, for the reason ./stories.js states at its own catch: neither write here
    // degrades, so there is no swallowed failure to make visible.
    return errorResponse(err);
  }
}
