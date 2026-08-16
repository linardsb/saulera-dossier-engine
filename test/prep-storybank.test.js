// #78 — the storybank: the store, the two routes, and the wall.
//
// The class of failure this file catches:
//
//   · a story that OUTLIVES its invite. It is the candidate's own account of things that happened
//     to them in previous jobs, written on the promise that it is deleted with everything else,
//     and a missing cascade would keep it silently. (The row-for-row proof is
//     test/portal-purge.test.js; what is here is the store-level half.)
//   · a SKETCH THAT REACHES A MODEL PROMPT. `sketch` is selected by exactly one store function,
//     read by exactly one route, and the model-facing path goes through `storyTitlesByRole`, whose
//     query has no sketch in it to leak. All three halves are asserted below.
//   · a tick set that does not ROUND TRIP across an edit, so a candidate's own bookkeeping about
//     which parts of the job a story covers quietly resets.
//   · a story from ANOTHER INVITE that a body id can edit or delete. The ownership check lives in
//     the WHERE clause rather than in a preceding SELECT, and this file is what proves it — there
//     is no transaction on D1, so a check in a separate statement is bypassable in a way this is
//     not.
//   · THE WALL (AC5): any path by which recruiter-facing code could reach story content.
//
// Engine: real SQLite via test/helpers/sqlite-d1.js, and every database test carries `{ skip }`.
// test/helpers/fake-d1.js would pass most of the above while the logic was wrong — it returns
// `{changes: 1}` unconditionally and enforces no constraint, and the cross-invite assertions here
// branch on exactly that number: `updated: false` and `deleted: false` are `meta.changes === 0`,
// which the fake cannot produce.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createInvite,
  persistHandover,
  hashToken,
  competenciesByRole,
  storiesByRole,
  storyCompetenciesByRole,
  storyTitlesByRole,
  createStory,
  updateStory,
  setStoryCompetencies,
  deleteStory,
} from "../src/portal/store.js";
import {
  onRequestGet as storiesGet,
  onRequestPost as storiesPost,
} from "../functions/prep/api/stories.js";
import { onRequestPost as storyPost } from "../functions/prep/api/story.js";
import { mintToken, SESSION_COOKIE } from "../src/prep/tokens.js";
import { at, d1Shape, openMigrated, skip } from "./helpers/sqlite-d1.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** A sentinel that exists ONLY in a sketch, so "no sketch reached here" is checkable by substring
 *  rather than by reading a shape and trusting it. */
const SKETCH_SENTINEL = "sentinel-no-model-may-ever-read-this-sketch";

/** Two competencies and one core question each — enough to rank and to tick. Copied from
 *  test/prep-debrief.test.js:61-72 so both siblings drill the same fixture role. */
const PAYLOAD = {
  role_title: "Community Nurse",
  blocks: [],
  competencies: [
    { id: "lone-working", label: "Lone working", importance: 5, source_quote: "q" },
    { id: "stakeholders", label: "Working with stakeholders", importance: 4, source_quote: "q" },
  ],
  questions: [
    { competency_id: "lone-working", text: "A core lone-working question.", axis: "core", difficulty: "standard" },
    { competency_id: "stakeholders", text: "A core stakeholder question.", axis: "core", difficulty: "standard" },
  ],
};

/**
 * A real invite + handover + live session cookie, through production writers — so the ids are the
 * ones production mints (`${roleId}:${slug}`) rather than ids a fixture chose to be convenient.
 */
async function seed(d1, { inviteId = "inv-1", interviewAt = at(7), payload = PAYLOAD } = {}) {
  const token = mintToken();
  await createInvite(d1, {
    id: inviteId,
    clientId: "c-1",
    email: `${inviteId}@example.com`,
    interviewAt,
    tokenHash: await hashToken(token),
    expiresAt: at(21),
  });
  const { roleId } = await persistHandover(d1, { inviteId, jdText: "jd", ethosText: "", cvText: "cv", payload });
  const competencies = await competenciesByRole(d1, roleId);
  return { token, roleId, competencies, ids: competencies.map((c) => c.id) };
}

/* ── the store ─────────────────────────────────────────────────────────────────────────── */

test("createStory mints an id, updateStory edits that row, and the ticks survive the edit", { skip }, async () => {
  const d1 = d1Shape(openMigrated());
  const { roleId, ids } = await seed(d1);

  const { id } = await createStory(d1, { roleId, title: "The escalation on nights", sketch: "First draft." });
  assert.ok(id, "the id is minted by the store and never taken from a caller");
  await setStoryCompetencies(d1, { storyId: id, competencyIds: [ids[0], ids[1]] });

  const { updated } = await updateStory(d1, {
    roleId,
    storyId: id,
    title: "The escalation on nights",
    sketch: "A fuller draft, with the number in it.",
  });
  assert.equal(updated, true);

  const rows = await storiesByRole(d1, roleId);
  assert.equal(rows.length, 1, "an edit is a rewrite of one row, never a second row");
  assert.equal(rows[0].id, id);
  assert.equal(rows[0].sketch, "A fuller draft, with the number in it.");
  // The reason update is an UPDATE and not a DELETE-then-INSERT or an upsert on (id): either would
  // cascade the ticks away on a save that never mentioned them.
  assert.deepEqual(
    (await storyCompetenciesByRole(d1, roleId)).map((r) => r.competency_id).sort(),
    [...ids].sort(),
  );
});

test("a blank sketch is legal and a blank title is the store's own 400", { skip }, async () => {
  const d1 = d1Shape(openMigrated());
  const { roleId } = await seed(d1);

  // A title typed and saved with nothing under it is a real half-written state; the page is
  // resumable and this is what resuming looks like in the database.
  const { id } = await createStory(d1, { roleId, title: "The audit nobody wanted", sketch: "" });
  assert.equal((await storiesByRole(d1, roleId))[0].sketch, "");
  assert.ok(id);

  await assert.rejects(
    () => createStory(d1, { roleId, title: "   ", sketch: "x" }),
    /required/,
    "requireFields covers the title and deliberately not the sketch",
  );
});

test("setStoryCompetencies replaces the whole set, and unticking everything really empties it", { skip }, async () => {
  const d1 = d1Shape(openMigrated());
  const { roleId, ids } = await seed(d1);
  const { id } = await createStory(d1, { roleId, title: "A story", sketch: "" });

  await setStoryCompetencies(d1, { storyId: id, competencyIds: [ids[0], ids[1]] });
  assert.equal((await storyCompetenciesByRole(d1, roleId)).length, 2);

  await setStoryCompetencies(d1, { storyId: id, competencyIds: [ids[1]] });
  assert.deepEqual(
    (await storyCompetenciesByRole(d1, roleId)).map((r) => r.competency_id),
    [ids[1]],
    "the newest save is the truth, so a dropped tick is a real erasure",
  );

  await setStoryCompetencies(d1, { storyId: id, competencyIds: [] });
  assert.deepEqual(await storyCompetenciesByRole(d1, roleId), [], "unticking every box empties the set");

  // Two tabs interleaving must not raise a constraint error on the composite key — which would be
  // a 500, and DEPLOY.md's triage table reads a 500 here as "migration 0012 was never applied".
  await setStoryCompetencies(d1, { storyId: id, competencyIds: [ids[0], ids[0]] });
  assert.equal((await storyCompetenciesByRole(d1, roleId)).length, 1, "ON CONFLICT DO NOTHING absorbs the duplicate");
});

test("storyTitlesByRole returns titles in the candidate's own order, and no sketch text", { skip }, async () => {
  const d1 = d1Shape(openMigrated());
  const { roleId } = await seed(d1);

  // WRITTEN IN ONE SECOND, ON PURPOSE — this is the case that found the bug. `created_at` defaults
  // to `datetime('now')`, which is second granularity, so these five tie on it. With `id` as the
  // tiebreak they came back in uuid order: arbitrary, and stable enough that a candidate would
  // find their list permanently shuffled with no way to fix it. This assertion failed on one run
  // and passed on the next, which is exactly what a uuid tiebreak looks like from outside.
  const written = ["First story", "Second story", "Third story", "Fourth story", "Fifth story"];
  for (const title of written) {
    await createStory(d1, { roleId, title, sketch: `${SKETCH_SENTINEL} ${title}` });
  }

  const titles = await storyTitlesByRole(d1, roleId);
  assert.deepEqual(titles, written, "the order the candidate wrote them in, tied on created_at and broken by rowid");
  assert.deepEqual(
    (await storiesByRole(d1, roleId)).map((s) => s.title),
    written,
    "and the editor's own read agrees with it — one order, or a nudge's 'your second story' means nothing",
  );

  // The seam, checked as a value rather than as a shape: if the query ever grew a sketch column,
  // the sentinel would be somewhere in this structure.
  assert.ok(
    !JSON.stringify(titles).includes(SKETCH_SENTINEL),
    "a sketch reached the titles-only read, which is the one query the model-facing path uses",
  );
});

test("a story id from another invite updates nothing and deletes nothing", { skip }, async () => {
  // THE CROSS-INVITE WRITE TEST, and the reason the store has createStory + updateStory instead of
  // one `INSERT … ON CONFLICT (id) DO UPDATE`: that upsert's conflict target would be an id from
  // the REQUEST BODY, and the only guard would be a membership check in a separate statement on a
  // database with no transaction. Here the guard is the WHERE clause, so there is no ordering for
  // a race to exploit — and `meta.changes === 0` is what reports the miss.
  const db = openMigrated();
  const d1 = d1Shape(db);
  const mine = await seed(d1, { inviteId: "inv-1" });
  const theirs = await seed(d1, { inviteId: "inv-2" });

  const ours = await createStory(d1, { roleId: mine.roleId, title: "Mine", sketch: "my words" });
  const yours = await createStory(d1, { roleId: theirs.roleId, title: "Theirs", sketch: SKETCH_SENTINEL });
  await setStoryCompetencies(d1, { storyId: yours.id, competencyIds: [theirs.ids[0]] });

  const before = db.prepare("SELECT * FROM story ORDER BY id").all();

  assert.deepEqual(
    await updateStory(d1, { roleId: mine.roleId, storyId: yours.id, title: "Stolen", sketch: "overwritten" }),
    { updated: false },
    "a foreign id must match no row, so the route answers 404 having written nothing",
  );
  assert.deepEqual(
    await deleteStory(d1, { roleId: mine.roleId, storyId: yours.id }),
    { deleted: false },
  );

  assert.deepEqual(
    db.prepare("SELECT * FROM story ORDER BY id").all(),
    before,
    "both rows byte-identical: the cross-invite write touched nothing at all",
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM story_competency WHERE story_id = ?").get(yours.id).n,
    1,
    "and their ticks are untouched too",
  );

  // The right owner still works — otherwise the assertions above would pass on a store that
  // refuses everything.
  assert.deepEqual(await deleteStory(d1, { roleId: mine.roleId, storyId: ours.id }), { deleted: true });
});

test("deleting a story takes its ticks by cascade, and never a second statement", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { roleId, ids } = await seed(d1);

  const keep = await createStory(d1, { roleId, title: "Keep", sketch: "" });
  const drop = await createStory(d1, { roleId, title: "Drop", sketch: "" });
  await setStoryCompetencies(d1, { storyId: keep.id, competencyIds: [ids[0]] });
  await setStoryCompetencies(d1, { storyId: drop.id, competencyIds: [ids[0], ids[1]] });

  assert.deepEqual(await deleteStory(d1, { roleId, storyId: drop.id }), { deleted: true });
  assert.deepEqual((await storiesByRole(d1, roleId)).map((s) => s.title), ["Keep"]);
  assert.deepEqual(
    (await storyCompetenciesByRole(d1, roleId)).map((r) => r.story_id),
    [keep.id],
    "the deleted story's two ticks went with it — 0012's ON DELETE CASCADE, not a second DELETE",
  );
});

test("a competency deleted under a re-handover takes its ticks and leaves the story standing", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { roleId, ids } = await seed(d1);

  const { id } = await createStory(d1, { roleId, title: "A story", sketch: "words" });
  await setStoryCompetencies(d1, { storyId: id, competencyIds: [ids[0], ids[1]] });

  db.prepare("DELETE FROM competency WHERE id = ?").run(ids[0]);

  assert.deepEqual(
    (await storyCompetenciesByRole(d1, roleId)).map((r) => r.competency_id),
    [ids[1]],
    "the dangling tick would otherwise keep reading as 'a story covers this' for a competency nobody can see",
  );
  assert.equal((await storiesByRole(d1, roleId)).length, 1, "the candidate's own words survive it");
});

test("deleting the invite erases both storybank tables", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { roleId, ids } = await seed(d1, { inviteId: "inv-1" });
  const { id } = await createStory(d1, { roleId, title: "A story", sketch: SKETCH_SENTINEL });
  await setStoryCompetencies(d1, { storyId: id, competencyIds: [ids[0]] });

  db.prepare("DELETE FROM invite WHERE id = 'inv-1'").run();

  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM story").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM story_competency").get().n, 0);
});

/* ── the routes ────────────────────────────────────────────────────────────────────────── */

const headers = (token, extra = {}) => ({
  get: (name) => {
    if (name === "Cookie" && token) return `${SESSION_COOKIE}=${token}`;
    return extra[name] ?? null;
  },
});

const getStories = (d1, token) =>
  storiesGet({
    request: { url: "https://engine.pages.dev/prep/api/stories", headers: headers(token) },
    env: { DB: d1 },
  });

const postStories = (d1, token, body, extra = {}) =>
  storiesPost({
    request: {
      url: "https://engine.pages.dev/prep/api/stories",
      headers: headers(token, extra),
      json: async () => body,
    },
    env: { DB: d1 },
  });

const postStory = (d1, token, body, extra = {}) =>
  storyPost({
    request: {
      url: "https://engine.pages.dev/prep/api/story",
      headers: headers(token, extra),
      json: async () => body,
    },
    env: { DB: d1 },
  });

const countStories = (db) => db.prepare("SELECT COUNT(*) AS n FROM story").get().n;

test("the door: no session, a cross-origin post, and a body that grew a field", { skip }, async () => {
  const d1 = d1Shape(openMigrated());
  const { token } = await seed(d1);

  assert.equal((await getStories(d1, null)).status, 401, "no cookie is nobody");
  assert.equal((await postStories(d1, null, { title: "x" })).status, 401);
  assert.equal((await postStory(d1, null, { action: "delete", id: "x" })).status, 401);

  const cross = await postStories(d1, token, { title: "x" }, { "Sec-Fetch-Site": "cross-site" });
  assert.equal(cross.status, 403);
  assert.deepEqual(await cross.json(), { error: "cross_origin" });

  const grown = await postStories(d1, token, { title: "x", status: "verified" });
  assert.equal(grown.status, 400, "a status word is not this endpoint's to write, or anyone's");
  assert.deepEqual(await grown.json(), { error: "unexpected_fields", fields: ["status"] });

  // The collection route creates and NEVER updates, so it does not know the word `id` at all —
  // which is how a cross-invite write is kept out of this file rather than guarded inside it.
  const withId = await postStories(d1, token, { title: "x", id: "someone-elses-story" });
  assert.deepEqual(await withId.json(), { error: "unexpected_fields", fields: ["id"] });
});

test("a GET with no handover written is 404, which is a page state and not a failure", { skip }, async () => {
  const d1 = d1Shape(openMigrated());
  const token = mintToken();
  await createInvite(d1, {
    id: "inv-bare",
    clientId: "c-1",
    email: "bare@example.com",
    interviewAt: at(7),
    tokenHash: await hashToken(token),
    expiresAt: at(21),
  });
  assert.equal((await getStories(d1, token)).status, 404);
});

test("the GET round-trips a story the POST created, with its ticks", { skip }, async () => {
  const d1 = d1Shape(openMigrated());
  const { token, ids } = await seed(d1);

  const created = await postStories(d1, token, {
    title: "The escalation on nights",
    sketch: `${SKETCH_SENTINEL} — the family refused the plan at 2am.`,
    competency_ids: [ids[0]],
  });
  assert.equal(created.status, 200);
  const { ok, id } = await created.json();
  assert.equal(ok, true);
  assert.ok(id, "the new id comes back so the page need not guess which re-fetched row it wrote");

  const payload = await (await getStories(d1, token)).json();
  assert.equal(payload.stories.length, 1);
  assert.equal(payload.stories[0].id, id);
  assert.equal(payload.stories[0].title, "The escalation on nights");
  assert.match(payload.stories[0].sketch, /the family refused the plan/, "the editor's own read carries the sketch");
  assert.deepEqual(payload.stories[0].competency_ids, [ids[0]]);
  assert.equal(payload.max_stories, 12, "the real limit travels, so the page's refusal copy cannot drift from it");
});

test("the GET's competencies carry an id and a label and nothing else", { skip }, async () => {
  // `importance`, `stage` and `success_rate` are all on the row the store hands back, and `shaky`
  // is decorated onto it before ranking. None of them is the candidate's to see: SPEC's ladder
  // rule is "show movement, not a rank", and a readiness on this page is a rank with a new name.
  const d1 = d1Shape(openMigrated());
  const { token } = await seed(d1);

  const payload = await (await getStories(d1, token)).json();
  assert.equal(payload.competencies.length, 2);
  for (const c of payload.competencies) {
    assert.deepEqual(Object.keys(c).sort(), ["id", "label"]);
  }
});

test("the story gap names the top-ranked competency no story covers, and nothing numeric", { skip }, async () => {
  const d1 = d1Shape(openMigrated());
  const { token, ids } = await seed(d1);

  // Nothing written yet: the honest first prompt is the competency most likely to come up.
  const empty = await (await getStories(d1, token)).json();
  assert.deepEqual(Object.keys(empty.story_gap).sort(), ["id", "label"], "no rank, no position, no count");
  const topRanked = empty.story_gap.id;
  const other = ids.find((id) => id !== topRanked);

  await postStories(d1, token, { title: "Covers the top one", sketch: "", competency_ids: [topRanked] });
  const partial = await (await getStories(d1, token)).json();
  assert.equal(partial.story_gap.id, other, "the covered one is skipped and the next one named");

  await postStories(d1, token, { title: "Covers the other", sketch: "", competency_ids: [other] });
  const covered = await (await getStories(d1, token)).json();
  assert.equal(covered.story_gap, null, "with every part of the job covered there is nothing to flag");
});

test("a role with no competencies still serves a page, and a title-only story still saves", { skip }, async () => {
  // A handover that wrote none is a real state, and the page must render rather than 500 — the
  // edge where "no stories means flag the top-ranked one" and "an empty list flags nothing" meet.
  const d1 = d1Shape(openMigrated());
  const { token } = await seed(d1, {
    inviteId: "inv-bare-role",
    payload: { role_title: "Community Nurse", blocks: [], competencies: [], questions: [] },
  });

  const before = await (await getStories(d1, token)).json();
  assert.deepEqual(before.competencies, []);
  assert.equal(before.story_gap, null);

  assert.equal((await postStories(d1, token, { title: "A story with nowhere to file it" })).status, 200);
  const after = await (await getStories(d1, token)).json();
  assert.equal(after.stories.length, 1);
  assert.deepEqual(after.stories[0].competency_ids, []);
});

test("the caps answer 400, each for its own field, and nothing is written", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { token } = await seed(d1);

  const blank = await postStories(d1, token, { title: "   ", sketch: "x" });
  assert.equal(blank.status, 400);
  assert.deepEqual(await blank.json(), { error: "missing_fields", field: "title" });

  const longTitle = await postStories(d1, token, { title: "x".repeat(121) });
  assert.deepEqual(await longTitle.json(), { error: "too_long", field: "title" });

  const longSketch = await postStories(d1, token, { title: "ok", sketch: "x".repeat(2001) });
  assert.deepEqual(await longSketch.json(), { error: "too_long", field: "sketch" });

  assert.equal(countStories(db), 0, "the caps run before the first write, not after it");

  // A blank sketch is legal, and this is the assertion that keeps it that way.
  assert.equal((await postStories(d1, token, { title: "Title only" })).status, 200);
});

test("a competency_ids list longer than the role's own is refused by both routes", { skip }, async () => {
  // The cheap bound that stops a body carrying ten thousand ids through the ownership loop before
  // any of them is rejected. It sits BEFORE that loop on purpose, so the cost of refusing is one
  // comparison rather than one Set lookup per entry.
  //
  // Duplicates are what make this a length check rather than a count of distinct ids: the store
  // writes `[...new Set(covers)]`, so a repeated id is harmless, and a body long enough to matter
  // is refused here whether its entries repeat or not.
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { token, ids } = await seed(d1); // two competencies
  const tooMany = [...ids, ids[0]]; // three entries against a role that has two

  const onCreate = await postStories(d1, token, { title: "A story", competency_ids: tooMany });
  assert.equal(onCreate.status, 400);
  assert.deepEqual(await onCreate.json(), { error: "too_long", field: "competency_ids" });
  assert.equal(countStories(db), 0, "and it runs before the write");

  const { id } = await (await postStories(d1, token, { title: "A story" })).json();
  const onSave = await postStory(d1, token, { action: "save", id, title: "A story", competency_ids: tooMany });
  assert.equal(onSave.status, 400);
  assert.deepEqual(await onSave.json(), { error: "too_long", field: "competency_ids" });

  // A legal list that happens to repeat an id still saves, and saves it once.
  const dup = await postStory(d1, token, { action: "save", id, title: "A story", competency_ids: [ids[0], ids[0]] });
  assert.equal(dup.status, 200);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM story_competency WHERE story_id = ?").get(id).n, 1);
});

test("the thirteenth story is refused, and the twelve already saved are untouched", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { token } = await seed(d1);

  for (let n = 0; n < 12; n += 1) {
    assert.equal((await postStories(d1, token, { title: `Story ${n}` })).status, 200);
  }
  const refused = await postStories(d1, token, { title: "One too many" });
  assert.equal(refused.status, 400);
  assert.deepEqual(await refused.json(), { error: "too_long", field: "stories" });
  assert.equal(countStories(db), 12);
});

test("a competency from another candidate's role is not found, and nothing is written", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  const mine = await seed(d1, { inviteId: "inv-1" });
  const theirs = await seed(d1, { inviteId: "inv-2" });

  const refused = await postStories(d1, mine.token, {
    title: "Whose competency is this?",
    competency_ids: [theirs.ids[0]],
  });
  assert.equal(refused.status, 404);
  assert.equal(countStories(db), 0, "the ownership check runs before the first write");
});

test("story.js saves an edit, and the two vocabularies never cross", { skip }, async () => {
  const d1 = d1Shape(openMigrated());
  const { token, ids } = await seed(d1);
  const { id } = await (await postStories(d1, token, { title: "First", sketch: "one" })).json();

  const saved = await postStory(d1, token, {
    action: "save",
    id,
    title: "Second",
    sketch: "two",
    competency_ids: [ids[1]],
  });
  assert.equal(saved.status, 200);
  const after = await (await getStories(d1, token)).json();
  assert.equal(after.stories[0].title, "Second");
  assert.equal(after.stories[0].sketch, "two");
  assert.deepEqual(after.stories[0].competency_ids, [ids[1]]);

  // A field carrying two meanings is how a delete quietly becomes a save (turn.js:86-100's rule).
  const crossed = await postStory(d1, token, { action: "delete", id, title: "Second" });
  assert.equal(crossed.status, 400);
  assert.deepEqual(await crossed.json(), { error: "unexpected_fields", fields: ["title"] });

  const noAction = await postStory(d1, token, { id });
  assert.equal(noAction.status, 400);
  const noId = await postStory(d1, token, { action: "delete" });
  assert.deepEqual(await noId.json(), { error: "missing_fields", field: "id" });
});

test("story.js deletes one story, and a foreign id is 404 with the row still standing", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  const mine = await seed(d1, { inviteId: "inv-1" });
  const theirs = await seed(d1, { inviteId: "inv-2" });

  const ours = await (await postStories(d1, mine.token, { title: "Mine", sketch: "my words" })).json();
  const yours = await (await postStories(d1, theirs.token, { title: "Theirs", sketch: SKETCH_SENTINEL })).json();

  const stolen = await postStory(d1, mine.token, { action: "delete", id: yours.id });
  assert.equal(stolen.status, 404);
  assert.equal(countStories(db), 2, "the foreign delete matched no row and removed nothing");

  // The same for a save, and the ticks must not be written either — `setStoryCompetencies` takes
  // no role, so reaching it past a failed update would write into another invite's story.
  const overwrite = await postStory(d1, mine.token, {
    action: "save",
    id: yours.id,
    title: "Stolen",
    sketch: "overwritten",
    competency_ids: [mine.ids[0]],
  });
  assert.equal(overwrite.status, 404);
  assert.equal(
    db.prepare("SELECT title, sketch FROM story WHERE id = ?").get(yours.id).sketch,
    SKETCH_SENTINEL,
    "their words are byte-identical",
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM story_competency WHERE story_id = ?").get(yours.id).n,
    0,
    "and no tick was written against a story this candidate does not own",
  );

  assert.equal((await postStory(d1, mine.token, { action: "delete", id: ours.id })).status, 200);
  assert.equal(countStories(db), 1);
});

/* ── AC5: the wall ─────────────────────────────────────────────────────────────────────── */
//
// DECISIONS.md decision 2, made structural — test/prep-debrief.test.js:601-613's idiom, and its
// argument restated because it is the reason these scans are trustworthy: "no recruiter sees this"
// is a sentence on a page a candidate reads before they type, and a sentence is not a mechanism.
// The claim below is a REACHABILITY one: there is no path from any recruiter-facing endpoint to
// story content, because no such file mentions it at all.
//
// The scan strips BLOCK comments and LINE-LEADING `//` comments before matching. Line-leading
// rather than any `//`, deliberately: stripping from a `//` anywhere on a line would also cut
// everything after a `//` inside a string literal, and a real reference hiding behind one would
// then be invisible — silence that looks identical to compliance.

const STORY_STORE_FNS = [
  "storiesByRole",
  "storyCompetenciesByRole",
  "storyTitlesByRole",
  "createStory",
  "updateStory",
  "setStoryCompetencies",
  "deleteStory",
];

// THE NAME COLLISION, and why the word matcher needs word boundaries. `StoryBankCard`
// (src/prep/schema.js:51) is a MODEL-WRITTEN brief block that already carries a competency
// mapping; the `story` table is CANDIDATE-WRITTEN content the tool must never write. A recruiter
// route legitimately mentioning the block must not fail this wall, so the matcher is
// `/\bstor(y|ies)\b/i` — which does not match `StoryBankCard`.
//
// That boundary cuts BOTH ways and the store-function clause is not decoration: `\b` treats a
// letter and an underscore as word characters, so this regex ALSO misses `storiesByRole` and
// `story_competency`. Either clause alone is a hole. The unit test below pins both blind spots so
// neither can be "simplified" away by someone who reads only one of them.
const STORY_WORD = /\bstor(y|ies)\b/i;

const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/[^\n]*$/gm, " ");

/** Every `.js` file under `functions/`, repo-relative, at any depth. */
function functionFiles(dir = "functions", found = []) {
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) functionFiles(path, found);
    else if (entry.name.endsWith(".js")) found.push(path);
  }
  return found;
}

test("the wall's matcher knows exactly what it does and does not catch", () => {
  // Written as a unit assertion rather than left as a comment, because both blind spots are the
  // kind a future reader "fixes" in the direction that silently opens the wall.
  assert.equal(STORY_WORD.test("StoryBankCard"), false, "the model-written brief block is a legitimate mention");
  assert.equal(STORY_WORD.test("storiesByRole"), false, "which is why STORY_STORE_FNS is the other clause");
  assert.equal(STORY_WORD.test("story_competency"), false, "an underscore is a word character");
  assert.equal(STORY_WORD.test("a story the candidate wrote"), true, "and it does catch the prose form");
  assert.equal(STORY_WORD.test("your stories"), true);
});

test("no endpoint outside functions/prep/ can reach story content at all", () => {
  const all = functionFiles();
  assert.ok(all.length >= 15, `walked ${all.length} route files, expected at least 15 — the walk is broken`);

  const mentions = all.filter((path) => {
    const code = stripComments(readFileSync(join(root, path), "utf8"));
    return STORY_WORD.test(code) || STORY_STORE_FNS.some((fn) => code.includes(fn));
  });

  // The self-guard, and it is the whole reason this test is trustworthy: a scan that matched
  // NOTHING would pass the assertion below vacuously, and would keep passing after someone renamed
  // the store functions out from under it.
  assert.ok(mentions.length > 0, "the scan matched no file at all — it is asserting nothing");
  for (const route of ["functions/prep/api/stories.js", "functions/prep/api/story.js"]) {
    assert.ok(mentions.includes(route), `the scan cannot see ${route}, which IS the storybank; the matcher has drifted`);
  }

  const outside = mentions.filter((path) => !path.startsWith("functions/prep/"));
  assert.deepEqual(
    outside,
    [],
    `${outside.join(", ")} can reach story content. Decision 2: nothing a candidate enters ` +
      `crosses to the recruiter — no dashboard tile, no "stories this candidate has" aggregation, ` +
      `no export. A storybank is their own account of their own working life, written for a ` +
      `drill, and the agency has no claim on it whatsoever.`,
  );
});

test("sketches do not leave the candidate's page, as a property of turn.js's imports", () => {
  // AC2's reachability form. The nudge is handed TITLES, and the seam that makes that structural
  // rather than careful is that `storyTitlesByRole`'s query has no such column to hand over.
  const turn = stripComments(readFileSync(join(root, "functions/prep/api/turn.js"), "utf8"));
  assert.match(turn, /storyTitlesByRole/, "the scan is reading the real route, not an empty string");
  assert.ok(
    !turn.includes("storiesByRole"),
    "turn.js imports the read that carries the candidate's own words. It must import the " +
      "titles-only one — that query is the mechanism, and this file is the model-facing path.",
  );
  assert.ok(
    !/\bsketch\b/i.test(turn),
    "the word appears in turn.js outside a comment, which means a value is being handled there",
  );

  const drill = stripComments(readFileSync(join(root, "src/prep/drill.js"), "utf8"));
  assert.ok(!/\bsketch\b/i.test(drill), "src/prep/drill.js builds every model prompt; it must never see one");
});

test("the sketch column is selected by exactly one store function", () => {
  // The narrowest and most load-bearing claim in the file. Two functions selecting it would be two
  // callers to audit forever; one is a fact a reader can check in a minute.
  const store = stripComments(readFileSync(join(root, "src/portal/store.js"), "utf8"));
  const selects = [...store.matchAll(/SELECT[\s\S]*?FROM\s+story\b/gi)].map((m) => m[0]);
  assert.ok(selects.length >= 2, `found ${selects.length} reads of the story table, expected the editor's and the titles-only one`);
  assert.equal(
    selects.filter((sql) => /\bsketch\b/i.test(sql)).length,
    1,
    "exactly one query may select `sketch`, and it is storiesByRole — the editor's own read",
  );

  const titlesOnly = store.match(/storyTitlesByRole[\s\S]*?\.all\(\)/);
  assert.ok(titlesOnly, "storyTitlesByRole has moved and this assertion is now reading nothing");
  assert.ok(!/\bsketch\b/i.test(titlesOnly[0]), "the titles-only read grew a sketch column");
});

test("both routes are structurally model-free, which is what makes AC1 hold", () => {
  // AC1's most valuable claim is a NEGATIVE — "the tool never writes a story" — and a negative is
  // satisfied by absence, which rots silently. A behavioural test could only prove the model did
  // not do it this time; an absent import is checkable forever.
  for (const path of ["functions/prep/api/stories.js", "functions/prep/api/story.js"]) {
    const src = readFileSync(join(root, path), "utf8");
    assert.match(src, /onRequestPost/, `the scan is reading ${path}, not an empty string`);
    assert.ok(
      !/from\s+["'][^"']*(@anthropic-ai\/sdk|drill\.js)["']/.test(src),
      `${path} imports a model. Nothing may draft, complete, summarise or improve a sketch — ` +
        `SPEC's first unloosenable rule, on the surface where breaking it would feel most helpful.`,
    );
  }
});

test("the storybank's SQL lives in exactly one module, and it is not the recruiter's store", () => {
  const engineStore = stripComments(readFileSync(join(root, "src/store.js"), "utf8"));
  for (const fn of STORY_STORE_FNS) {
    assert.ok(
      !engineStore.includes(fn),
      `${fn} in src/store.js. That is the ENGINE and recruiter store, and a story statement there ` +
        `is a query one refactor away from a recruiter response, whatever the caller intended.`,
    );
  }
  assert.ok(
    !/\bstor(y|ies)\b/i.test(engineStore) || !/FROM\s+story\b/i.test(engineStore),
    "src/store.js reads the story table directly",
  );

  const portalStore = stripComments(readFileSync(join(root, "src/portal/store.js"), "utf8"));
  for (const fn of STORY_STORE_FNS) {
    assert.ok(portalStore.includes(fn), `${fn} must live in src/portal/store.js — the one module that may`);
  }
});

test("the two caps story.js retypes still match the file that owns them", () => {
  // src/http.js:4-5 rules out a shared helper under functions/, so the numbers are retyped rather
  // than imported and this is the drift test that makes that honest — public/prep/registry.js's
  // settled answer to the same constraint, applied at the same distance.
  const capOf = (source, name) => {
    const found = source.match(new RegExp(`${name}\\s*=\\s*([0-9_]+)`));
    assert.ok(found, `${name} is no longer declared where this gate looks for it`);
    return Number(found[1].replace(/_/g, ""));
  };
  // Comments stripped FIRST, and this file learned that the hard way: story.js's own header
  // explains why it does not carry a story-count cap, and the sentence naturally contains the
  // constant's name. A gate that reads a file's prose as if it were its code fails on an accurate
  // comment — which is how gates get deleted rather than fixed (debrief.js:14's note).
  const collection = stripComments(readFileSync(join(root, "functions/prep/api/stories.js"), "utf8"));
  const item = stripComments(readFileSync(join(root, "functions/prep/api/story.js"), "utf8"));

  for (const name of ["TITLE_MAX", "SKETCH_MAX"]) {
    assert.equal(
      capOf(item, name),
      capOf(collection, name),
      `${name} drifted. stories.js owns it; a story that saves on one route and is refused by the ` +
        `other is a dead end for a candidate with nothing in browser storage to reload from.`,
    );
  }
  assert.ok(
    !/MAX_STORIES/.test(item),
    "story.js has grown a story-count cap. It creates nothing, so the count is not its business.",
  );
});
