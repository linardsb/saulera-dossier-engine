// GET  /prep/api/stories -> 200 { stories, competencies, story_gap, max_stories }
// POST /prep/api/stories    { title, sketch, competency_ids } -> 200 { ok: true, id }
//
// The candidate's storybank (#78), SPEC Amendment 1: a small set of their own real interview
// stories, each written in their own words and ticked against the parts of the job it covers.
//
// TWO FILES, and the split is resource-shaped rather than method-shaped. debrief.js:6-8 argues its
// own single-file shape by pointing next door — "the items.js/item.js split is resource-shaped (a
// checklist and one item of it), not method-shaped, so it is not the precedent here" — and in
// doing so hands this ticket the opposite answer. A storybank IS a checklist and one item of it.
// This file is the COLLECTION: read the whole bank, add one to it. ./story.js is one story.
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
// test/prep-storybank.test.js: no file outside functions/prep/ may reach story content at all.
//
// ZERO MODEL CALLS, structurally: this file imports no sdk and no drill.js. The ticket's whole
// risk surface is a NEGATIVE — "the tool never writes a story" — and a negative is satisfied by
// absence, which rots silently. The absent import is what makes it un-regressable rather than
// merely true today (session.js:6-11's argument), and a test asserts the absence rather than
// trusting this paragraph.
//
// NO AVAILABILITY GATE, and that is the deliberate difference from debrief.js. The debrief is shut
// until the interview day because a debrief before the interview is meaningless. A storybank is
// most useful BEFORE it — the whole point is to have your material ready — so there is no date
// test here, and none should be added by analogy with the file next door.
//
// THE PROJECTION DISCIPLINE (session.js's argument, restated): responses are written as LITERALS,
// never a spread of a store row. Competencies come back as {id, label} — never `importance`,
// `stage`, `success_rate`, and never the `shaky` flag decorated below, which exists to order a
// list and not to be shown. `story_gap` is {id, label} for the same reason: no rank, no position,
// no count of uncovered competencies reaches the browser.

import {
  roleByInviteId,
  competenciesByRole,
  countStoriesByRole,
  storiesByRole,
  storyCompetenciesByRole,
  createStory,
  setStoryCompetencies,
  shakyCompetencyIds,
} from "../../../src/portal/store.js";
import { requireSession } from "../../../src/prep/session.js";
import { rankCompetencies, storyGap } from "../../../src/prep/targeting.js";
import { json, readJson, sameOrigin, errorResponse } from "../../../src/http.js";

// The whole body vocabulary — anything else is a 400, which is what keeps this endpoint from
// quietly growing fields (turn.js:62-64's rule). Note what is NOT here and could not be: there is
// no `id`, because THIS ROUTE CREATES AND NEVER UPDATES — an id in the body is the cross-invite
// write ./story.js and the store's WHERE clauses exist to make impossible, and the honest way to
// keep it out of this file is to refuse the word. There is no `role_id` either: the role is the
// session's.
const ALLOWED = new Set(["title", "sketch", "competency_ids"]);

// SPEC says "a small set". Twelve is generous against a competency list of five or six and still
// small enough that the page is a list rather than a filing system — and the cap is what keeps the
// nudge's prompt bounded BY CONSTRUCTION rather than by a slice somewhere downstream.
export const MAX_STORIES = 12;

// A title is a handle said aloud — "the escalation on nights" — not a paragraph. 120 characters is
// several times any real one, and the cap exists so a paste cannot fill the column.
export const TITLE_MAX = 120;

// FIX_MAX's argument (debrief.js:65-67), on a box that earns it: a couple of paragraphs, past any
// real sketch of a story, and far short of anything worth storing as a document.
export const SKETCH_MAX = 2_000;

/**
 * The role's competencies in the order targeting would drill them, decorated with the candidate's
 * own shaky ticks exactly as `drillState` does it (targeting.js:353-362).
 *
 * WHY `rankCompetencies` DIRECTLY AND NOT `drillState`: drillState pulls the whole question bank
 * and the entire attempt log to build a queue, a demand and a session split, and this page drills
 * nothing — it would be several reads for a list this route only needs the ORDER of.
 *
 * Decorating with `shaky` is still not optional, and the reason is about the RANK rather than the
 * queue: a shaky tick lowers `readiness`, so an undecorated list ranks a competency the candidate
 * has just said went badly as though it had not.
 *
 * `last_attempt_at` is deliberately NOT decorated — it feeds `eligible()`, which this route does
 * not call, and which the gap deliberately does not apply. `storyGap`'s JSDoc argues that at
 * length: the flag is SPEC's "a top-ranked competency no story covers", not "the next competency
 * the drill will serve", and a gap that went quiet during a cooldown would hide itself for exactly
 * the days before the interview when there is still time to act. Adding an attempts read here to
 * "complete" the decoration would buy a queue nobody wants and cost the read this avoids.
 */
function rankedFor(competencies, shakyIds) {
  const shaky = new Set(shakyIds);
  return rankCompetencies(competencies.map((c) => ({ ...c, shaky: shaky.has(c.id) })));
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

    const competencies = await competenciesByRole(env.DB, role.role_id);
    const stories = await storiesByRole(env.DB, role.role_id);
    const pairs = await storyCompetenciesByRole(env.DB, role.role_id);
    const shakyIds = await shakyCompetencyIds(env.DB, role.role_id);

    /* One pass over the pairs, keyed both ways: per story for the editor's ticks, and as a flat
       cover set for the gap. Two walks over the same rows would be two chances to disagree.

       A TICK ONLY COUNTS AS COVER IF THERE IS A STORY BEHIND IT. The two sets diverge here, and
       deliberately: the EDITOR shows every tick the candidate set, because it is their bookkeeping
       and a half-written story is a real state this page is built to resume. The GAP does not,
       because it is a claim about raw material — the copy says "nothing in your stories covers X",
       and a checkbox is not a story. A blank sketch is legal, and ticks are capped only by count,
       so one story titled "x" with an empty sketch and every box ticked used to silence the flag
       for that role permanently. The feature's only output, switched off by its own bookkeeping.

       The candidate is not told off for it: the flag simply comes back until they write something,
       which is exactly what the flag is for. */
    const withSketch = new Set(
      stories.filter((s) => String(s.sketch ?? "").trim().length > 0).map((s) => s.id),
    );
    const byStory = new Map();
    const covered = new Set();
    for (const pair of pairs) {
      if (!byStory.has(pair.story_id)) byStory.set(pair.story_id, []);
      byStory.get(pair.story_id).push(pair.competency_id);
      if (withSketch.has(pair.story_id)) covered.add(pair.competency_id);
    }

    return json({
      stories: stories.map((story) => ({
        id: story.id,
        title: story.title,
        // The one place a sketch is served, to the one person who wrote it. Every other reader in
        // the system goes through `storyTitlesByRole`, which has no sketch to hand out.
        sketch: story.sketch,
        competency_ids: byStory.get(story.id) ?? [],
      })),
      competencies: competencies.map((c) => ({ id: c.id, label: c.label })),
      story_gap: storyGap({
        ranked: rankedFor(competencies, shakyIds),
        coveredIds: [...covered],
      }),
      // RETURNED rather than mirrored in the page. debrief.js's page retypes the route's caps with
      // a comment and a drift risk; handing the real number down means the refusal copy names the
      // limit that is actually enforced, and a change here cannot leave the page telling a
      // candidate to trim to a number nobody checks. Worth the one field.
      max_stories: MAX_STORIES,
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

    // ── shape and caps, each its own answer ─────────────────────────────────────────────
    //
    // `typeof` on every field, never `String(…)`. Coercing meant `{"title":{}}` stored the string
    // "[object Object]" and `["a","b"]` stored "a,b" — a 200 for a body that was never a story,
    // and a row the candidate cannot account for. ./story.js checks the same three the same way.
    if (typeof body.title !== "string") return json({ error: "missing_fields", field: "title" }, 400);
    const title = body.title.trim();
    if (!title) return json({ error: "missing_fields", field: "title" }, 400);
    if (title.length > TITLE_MAX) return json({ error: "too_long", field: "title" }, 400);

    // A blank sketch is LEGAL and this is the line that says so: a title typed and saved is a real
    // half-written state, and the page is resumable. Absent is a different thing from blank, and
    // is refused — see ./story.js, where defaulting it silently erased stored paragraphs.
    if (typeof body.sketch !== "string") return json({ error: "missing_fields", field: "sketch" }, 400);
    const sketch = body.sketch;
    if (sketch.length > SKETCH_MAX) return json({ error: "too_long", field: "sketch" }, 400);

    if (!Array.isArray(body.competency_ids)) {
      return json({ error: "missing_fields", field: "competency_ids" }, 400);
    }
    const rawCovers = body.competency_ids;

    /* COUNT, not the rows. This used to call `storiesByRole` — the one query that selects
       `sketch` — purely to take `.length`, which put ~24KB of the most personal text in the
       product on the WRITE path for no reader, and made store.js's "exactly one route calls it"
       untrue at handler granularity. The narrower query is both the cheaper and the honest one. */
    const existing = await countStoriesByRole(env.DB, role.role_id);
    if (existing >= MAX_STORIES) return json({ error: "too_long", field: "stories" }, 400);

    // ── the ownership check ─────────────────────────────────────────────────────────────
    // Anything id-shaped in the body is checked against THIS role before it is written, and a miss
    // is 404, never a silent skip (turn.js's register): a competency under someone else's invite
    // is not found. Nothing is written before this passes.
    const competencies = await competenciesByRole(env.DB, role.role_id);
    const known = new Set(competencies.map((c) => c.id));
    if (rawCovers.length > competencies.length) {
      return json({ error: "too_long", field: "competency_ids" }, 400);
    }
    const covers = rawCovers.map((id) => String(id));
    for (const id of covers) {
      if (!known.has(id)) return json({ error: "not_found" }, 404);
    }

    // ── the writes, in dependency order ─────────────────────────────────────────────────
    // No transaction exists, so the order IS the recovery story (turn.js's header): a crash
    // between them leaves the STORY saved and its ticks missing, which the next save fixes with
    // one tap per box. The other order would leave ticks pointing at no story, and the candidate's
    // words — the thing that cannot be re-typed — are what the first write secures.
    const { id } = await createStory(env.DB, { roleId: role.role_id, title, sketch });

    /* DEGRADE WITH THE ID IN HAND — debrief.js:212-224's move, and the comment above used to claim
       a repair this path could not actually reach. It said the next save fixes a missing tick set
       "with one tap per box", which presumes a caller that KNOWS the story's id. On a 500 the id
       never left this function: the page keeps `editingId === null`, so a retry POSTs to the
       collection route again and the candidate ends up with two identical stories — one tick-less,
       one cap slot burned — where they made one.

       So the ticks degrade and the story does not. The words are secured, the id comes back, and
       `covers_saved: false` says plainly which half is missing. The log line is the one this
       route's outer catch deliberately does not emit: a swallowed failure that is invisible
       otherwise, which is exactly the case its own header reserves logging for. */
    let coversSaved = true;
    try {
      // `ok: false` is the store's claim (#87) finding no story row — reachable here only if
      // delete-now or the purge erased this invite between the INSERT above and now. Nothing was
      // written, so the response says so rather than reporting ticks a vanished story cannot carry.
      const { ok } = await setStoryCompetencies(env.DB, { storyId: id, competencyIds: [...new Set(covers)] });
      coversSaved = ok;
    } catch (err) {
      coversSaved = false;
      console.error("prep stories: story saved, ticks did not", err?.message ?? err);
    }

    // The id comes back so the page can open the new story for editing without guessing which of
    // the re-fetched rows is the one it just wrote. Nothing else: the page re-fetches rather than
    // patching (passport.js's rule).
    return json({ ok: true, id, covers_saved: coversSaved });
  } catch (err) {
    // No log line here, deliberately, and the reason is worth stating because the sibling routes
    // both have one. turn.js:216 and debrief.js:223 log inside a DEGRADING branch — a failure they
    // swallow and carry on from, which would otherwise be invisible. Neither of this route's two
    // writes degrades: the candidate's words are the point, so a failure is answered rather than
    // absorbed. Logging in the outer catch would instead emit a line for every routine 401 and
    // 404, which is noise around the one signal an operator reads (DEPLOY.md's triage table).
    return errorResponse(err);
  }
}
