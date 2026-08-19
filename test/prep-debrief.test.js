// #77 — the private debrief: the store, the route, and the wall.
//
// The class of failure this file catches:
//
//   · a debrief that OUTLIVES its invite. It is the candidate's account of an interview they have
//     just walked out of, written on the promise that it is deleted with everything else, and a
//     missing cascade would keep it silently. (The row-for-row proof is
//     test/portal-purge.test.js; what is here is the store-level half.)
//   · a re-save that DUPLICATES a question row. The form's ordinary path is being opened again
//     and saved again, so "already added" has to be a primary-key conflict rather than a
//     read-then-write on a database with no transaction.
//   · a placement that does not ROUND TRIP. Moving a line from one competency to another
//     deliberately leaves the first question row standing, so the placement cannot be re-derived
//     from the question ids — the page whose whole promise is "come back and add to this" would
//     prefill the wrong picker.
//   · a tick that DAMPENS NOTHING, because `shakyCompetencyIds` reads the wrong scope.
//   · the WALL: any path by which recruiter-facing code could reach debrief content (AC5).
//
// Engine: real SQLite via test/helpers/sqlite-d1.js, and every database test carries `{ skip }`.
// test/helpers/fake-d1.js would pass all of the above while the logic was wrong — it returns
// `{changes: 1}` unconditionally and enforces no constraint, and every assertion here branches on
// one: the UNIQUE that makes the upsert an upsert, the ON CONFLICT DO NOTHING that makes a re-save
// free, and the cascade.

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
  questionsByRole,
  attemptsByRole,
  debriefByRole,
  upsertDebrief,
  setShakyCompetencies,
  shakyCompetencyIds,
  insertAskedQuestion,
} from "../src/portal/store.js";
import { onRequestGet as debriefGet, onRequestPost as debriefPost } from "../functions/prep/api/debrief.js";
import { onRequestGet as sessionRoute } from "../functions/prep/api/session.js";
import { onRequestGet as briefRoute } from "../functions/prep/api/brief.js";
import { onRequestGet as eventsGet } from "../functions/api/events.js";
import { drillState, MAX_VARIANTS_PER_COMPETENCY } from "../src/prep/targeting.js";
import { mintToken, SESSION_COOKIE } from "../src/prep/tokens.js";
import { at, d1Shape, openMigrated, skip } from "./helpers/sqlite-d1.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Two competencies and one core question each — enough to rank, place and drill.
 *
 *  `axis: "core"` is what assertBrief demands of a stored payload, and this fixture now goes
 *  through /prep/api/brief as well, which is the only route that asserts it. persistHandover
 *  writes NULL into the column regardless (store.js:245-256's note on the CHECK), so the field
 *  changes nothing about what lands in `question` — it makes the fixture a real brief rather
 *  than one that happened never to be read as one. */
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
async function seed(d1, { inviteId = "inv-1", interviewAt = at(-1), payload = PAYLOAD } = {}) {
  const token = mintToken();
  await createInvite(d1, {
    id: inviteId,
    clientId: "c-1",
    email: `${inviteId}@example.com`,
    interviewAt,
    tokenHash: await hashToken(token),
    expiresAt: at(13),
  });
  const { roleId } = await persistHandover(d1, { inviteId, jdText: "jd", ethosText: "", cvText: "cv", payload });
  const competencies = await competenciesByRole(d1, roleId);
  return { token, roleId, competencies, ids: competencies.map((c) => c.id) };
}

/* ── the store ─────────────────────────────────────────────────────────────────────────── */

test("upsertDebrief creates one row, then edits it — same id, ticks intact", { skip }, async () => {
  const d1 = d1Shape(openMigrated());
  const { roleId, ids } = await seed(d1);

  const first = await upsertDebrief(d1, { roleId, asked: [], fixText: "" });
  assert.ok(first.id, "RETURNING id must come back on the INSERT path, or the ticks write against undefined");
  await setShakyCompetencies(d1, { debriefId: first.id, competencyIds: [ids[0]] });

  const second = await upsertDebrief(d1, {
    roleId,
    asked: [{ text: "What went wrong on a lone visit?", competency_id: ids[0] }],
    fixText: "Lead with the result.",
  });
  assert.equal(
    second.id,
    first.id,
    "the conflict path must return the STANDING row's id, not the uuid this call minted and did not use",
  );

  const row = await debriefByRole(d1, roleId);
  assert.equal(row.fix_text, "Lead with the result.");
  assert.deepEqual(JSON.parse(row.asked_json), [
    { text: "What went wrong on a lone visit?", competency_id: ids[0] },
  ]);
  // The reason the upsert is not DELETE-then-INSERT: that would cascade the ticks away on a save
  // that never mentioned them.
  assert.deepEqual(await shakyCompetencyIds(d1, roleId), [ids[0]]);
});

test("asked_json round-trips an unplaced line, and a line MOVED reports its new competency", { skip }, async () => {
  const d1 = d1Shape(openMigrated());
  const { roleId, ids } = await seed(d1);
  const line = "Tell me about a time you disagreed with a consultant.";

  await upsertDebrief(d1, {
    roleId,
    asked: [
      { text: line, competency_id: ids[0] },
      { text: "Why this trust?", competency_id: null },
    ],
    fixText: "",
  });
  await insertAskedQuestion(d1, { competencyId: ids[0], text: line });

  // The move. The first question row deliberately STAYS — deleting it would cascade its attempts
  // away — so two ids now share one digest and neither says which pick is current.
  await upsertDebrief(d1, {
    roleId,
    asked: [
      { text: line, competency_id: ids[1] },
      { text: "Why this trust?", competency_id: null },
    ],
    fixText: "",
  });
  await insertAskedQuestion(d1, { competencyId: ids[1], text: line });

  const asked = JSON.parse((await debriefByRole(d1, roleId)).asked_json);
  assert.equal(asked[0].competency_id, ids[1], "the stored placement is the one the candidate last chose");
  assert.equal(asked[1].competency_id, null, "an unplaced line stays unplaced — null is a real state");

  const questions = await questionsByRole(d1, roleId);
  const asIds = questions.filter((q) => q.text === line).map((q) => q.competency_id).sort();
  assert.deepEqual(asIds, [ids[0], ids[1]].sort(), "the first row stands; both are real questions now");
});

test("setShakyCompetencies replaces the whole set, and the scope is the role", { skip }, async () => {
  const d1 = d1Shape(openMigrated());
  const mine = await seed(d1, { inviteId: "inv-1" });
  const theirs = await seed(d1, { inviteId: "inv-2" });

  const { id } = await upsertDebrief(d1, { roleId: mine.roleId, asked: [], fixText: "" });
  await setShakyCompetencies(d1, { debriefId: id, competencyIds: mine.ids });
  assert.deepEqual(await shakyCompetencyIds(d1, mine.roleId), [...mine.ids].sort());

  // Unticking one is an erasure, not a merge.
  await setShakyCompetencies(d1, { debriefId: id, competencyIds: [mine.ids[1]] });
  assert.deepEqual(await shakyCompetencyIds(d1, mine.roleId), [mine.ids[1]]);

  assert.deepEqual(await shakyCompetencyIds(d1, theirs.roleId), [], "a role with no debrief has no ticks");
});

test("a tick written twice is a no-op, not a 500 an operator reads as a missing migration", { skip }, async () => {
  // #81 M2. With no transaction, two saves interleave as DELETE, DELETE, INSERT c, INSERT c — two
  // tabs, or a client retry, since the page's in-flight guard is per page. A UNIQUE violation on
  // the composite key is not a StoreError, so the route would answer `500 internal`, which is the
  // one signal DEPLOY.md's triage table reads as "migration 0011 was never applied". Passing the
  // pair twice is that second INSERT exactly, and the real engine is what makes it mean anything.
  const d1 = d1Shape(openMigrated());
  const { roleId, ids } = await seed(d1);
  const { id } = await upsertDebrief(d1, { roleId, asked: [], fixText: "" });

  await setShakyCompetencies(d1, { debriefId: id, competencyIds: [ids[0], ids[0], ids[1]] });

  assert.deepEqual(
    await shakyCompetencyIds(d1, roleId),
    [...ids].sort(),
    "and the duplicate leaves one tick, not two rows and not an error",
  );
});

test("insertAskedQuestion is idempotent by construction, and keys on (competency, text)", { skip }, async () => {
  const d1 = d1Shape(openMigrated());
  const { roleId, ids } = await seed(d1);
  const line = "How do you decide a visit is unsafe?";

  const once = await insertAskedQuestion(d1, { competencyId: ids[0], text: line });
  const twice = await insertAskedQuestion(d1, { competencyId: ids[0], text: line });
  assert.equal(once.id, twice.id, "the id is derived from the text, so a re-save re-derives it");
  assert.equal(once.inserted, true);
  assert.equal(twice.inserted, false, "the second save is a no-op — ON CONFLICT DO NOTHING, not a SELECT first");

  await insertAskedQuestion(d1, { competencyId: ids[0], text: "A different question entirely." });
  // The same text under a DIFFERENT competency is a different question row: the competency is in
  // the id, so a candidate who places the same line twice gets it drilled under both.
  await insertAskedQuestion(d1, { competencyId: ids[1], text: line });

  const asked = (await questionsByRole(d1, roleId)).filter((q) => q.id.includes("#asked-"));
  assert.equal(asked.length, 3, "two under the first competency, one under the second");
  for (const q of asked) {
    assert.equal(q.axis, "lateral", "an asked question is served as a stored variant — no new serving path");
    assert.equal(q.variant_of, null, "it is not a variant OF one of ours");
    assert.equal(q.difficulty, null, "NULL difficulty, which targeting reads as standard");
  }
  assert.match(once.id, /#asked-[0-9a-f]{16}$/, "16 hex of the digest — it collides with neither #index nor #v-uuid");
});

test("a line matching an existing question's wording mints no twin row", { skip }, async () => {
  // #84 L5, fixed. Core ids are `${competency}#${index}` and asked ids `${competency}#asked-…`,
  // so re-typing a core question the interviewer really asked collided with nothing and minted a
  // second row — and the drill served the same wording as two questions. The NOT EXISTS guard is
  // what this pins; the same-text-other-competency case in the idempotency test above still
  // inserts, which is the difference between deduping wording and losing a real placement.
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { token, roleId, ids } = await seed(d1);
  const coreText = "A core lone-working question.";
  const before = db.prepare("SELECT COUNT(*) AS n FROM question").get().n;

  const result = await insertAskedQuestion(d1, { competencyId: ids[0], text: coreText });
  assert.equal(result.inserted, false, "the standing core row IS the question; a twin is not minted");

  // And through the route, where the ordinary path arrives.
  await postDebrief(d1, token, { asked: [{ text: coreText, competency_id: ids[0] }] });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM question").get().n, before);

  const rows = (await questionsByRole(d1, roleId)).filter((q) => q.text === coreText);
  assert.equal(rows.length, 1);
  assert.ok(!rows[0].id.includes("#asked-"), "and it is the core row that stands");
});

test("an asked question is what the next session serves for its competency", { skip }, async () => {
  // The AC, asserted THROUGH targeting rather than by reading the row back: "the next session can
  // drill it" is the claim, and nothing in nextQuestion knows this row came from a debrief.
  const d1 = d1Shape(openMigrated());
  const { roleId, ids, competencies } = await seed(d1);
  const line = "Walk me through the last time a family complained.";
  await insertAskedQuestion(d1, { competencyId: ids[0], text: line });

  const questions = await questionsByRole(d1, roleId);
  const attempts = await attemptsByRole(d1, roleId);
  const state = drillState({
    competencies,
    questions,
    attempts,
    interviewAt: at(-1),
    now: new Date(),
    shakyIds: [ids[0]],
  });
  assert.equal(state.target.id, ids[0], "the shaky competency is the one drilled first");
  // No success yet, so targeting offers the easiest unattempted CORE question first — the asked
  // one is the unattempted stored variant waiting behind it, which is the queue this ticket fills.
  const queue = state.questionsBy.get(ids[0]).filter((q) => q.axis === "lateral").map((q) => q.text);
  assert.deepEqual(queue, [line]);
});

/* ── the route, both methods ───────────────────────────────────────────────────────────── */

const headers = (token, extra = {}) => ({
  get: (name) => {
    if (name === "Cookie" && token) return `${SESSION_COOKIE}=${token}`;
    return extra[name] ?? null;
  },
});

const getDebrief = (d1, token) =>
  debriefGet({
    request: { url: "https://engine.pages.dev/prep/api/debrief", headers: headers(token) },
    env: { DB: d1 },
  });

const postDebrief = (d1, token, body, extra = {}) =>
  debriefPost({
    request: {
      url: "https://engine.pages.dev/prep/api/debrief",
      headers: headers(token, extra),
      json: async () => body,
    },
    env: { DB: d1 },
  });

const countQuestions = (db) => db.prepare("SELECT COUNT(*) AS n FROM question").get().n;
const countDebriefs = (db) => db.prepare("SELECT COUNT(*) AS n FROM debrief").get().n;

test("the gate is the interview DAY, in both directions", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);

  const early = await seed(d1, { inviteId: "inv-early", interviewAt: at(3) });
  const before = await getDebrief(d1, early.token);
  assert.equal(before.status, 200, "not yet is a page state, not an error");
  assert.deepEqual(await before.json(), { available: false }, "and nothing else on the wire");
  assert.equal(countDebriefs(db), 0, "a GET creates no row");

  // A POST before it is a caller fault: the page does not offer the form, so this is not the form.
  const rejected = await postDebrief(d1, early.token, { fix_text: "too soon" });
  assert.equal(rejected.status, 403);
  assert.deepEqual(await rejected.json(), { error: "too_early" });
  assert.equal(countDebriefs(db), 0);

  // Day-of counts. A date-only booking is stored 'YYYY-MM-DD 00:00:00', so an instant comparison
  // would have opened this at midnight — and would have kept it shut all of the interview day if
  // the stamp carried a real time. Days are what makes "same-day" true.
  const today = await seed(d1, { inviteId: "inv-today", interviewAt: at(0) });
  assert.equal((await (await getDebrief(d1, today.token)).json()).available, true);

  // #84 L8: at(3)/at(0) never discriminated day from instant — at(0) IS now, so an instant
  // comparison answers it the same way. These two stamps are where the two readings diverge,
  // and at(1) is the ±1 boundary the route header's `<= 0` turns on.
  const dayString = new Date().toISOString().slice(0, 10);
  const lateToday = await seed(d1, { inviteId: "inv-late", interviewAt: `${dayString} 23:59:00` });
  assert.equal(
    (await (await getDebrief(d1, lateToday.token)).json()).available,
    true,
    "a booking later today is still the interview DAY — an instant comparison keeps this shut until tonight",
  );
  const midnightToday = await seed(d1, { inviteId: "inv-midnight", interviewAt: `${dayString} 00:00:00` });
  assert.equal(
    (await (await getDebrief(d1, midnightToday.token)).json()).available,
    true,
    "a date-only booking, stored as midnight, opens on the day",
  );
  const tomorrow = await seed(d1, { inviteId: "inv-tomorrow", interviewAt: at(1) });
  assert.equal(
    (await (await getDebrief(d1, tomorrow.token)).json()).available,
    false,
    "and one day out is still shut — the boundary is exactly the day",
  );
});

test("the door: no session, a cross-origin post, and a body that grew a field", { skip }, async () => {
  const d1 = d1Shape(openMigrated());
  const { token } = await seed(d1);

  assert.equal((await getDebrief(d1, null)).status, 401, "no cookie is nobody");
  assert.equal((await postDebrief(d1, null, {})).status, 401);

  const cross = await postDebrief(d1, token, {}, { "Sec-Fetch-Site": "cross-site" });
  assert.equal(cross.status, 403);
  assert.deepEqual(await cross.json(), { error: "cross_origin" });

  const grown = await postDebrief(d1, token, { fix_text: "ok", status: "verified" });
  assert.equal(grown.status, 400, "a status word is not this endpoint's to write, or anyone's");
  assert.deepEqual(await grown.json(), { error: "unexpected_fields", fields: ["status"] });
});

test("a competency from another candidate's role is not found, and nothing is written", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  const mine = await seed(d1, { inviteId: "inv-1" });
  const theirs = await seed(d1, { inviteId: "inv-2" });

  const viaShaky = await postDebrief(d1, mine.token, { shaky: [theirs.ids[0]] });
  assert.equal(viaShaky.status, 404);
  const viaPlacement = await postDebrief(d1, mine.token, {
    asked: [{ text: "Whose question is this?", competency_id: theirs.ids[0] }],
  });
  assert.equal(viaPlacement.status, 404);

  assert.equal(countDebriefs(db), 0, "the check runs before the first write, not after it");
});

test("the caps answer 400, each for its own field", { skip }, async () => {
  const d1 = d1Shape(openMigrated());
  const { token } = await seed(d1);

  const longLine = await postDebrief(d1, token, { asked: [{ text: "x".repeat(501), competency_id: null }] });
  assert.equal(longLine.status, 400);
  assert.deepEqual(await longLine.json(), { error: "too_long", field: "asked" });

  const manyLines = await postDebrief(d1, token, {
    asked: Array.from({ length: 21 }, (_, i) => ({ text: `Q ${i}`, competency_id: null })),
  });
  assert.deepEqual(await manyLines.json(), { error: "too_long", field: "asked" });

  const longFix = await postDebrief(d1, token, { fix_text: "x".repeat(2001) });
  assert.deepEqual(await longFix.json(), { error: "too_long", field: "fix_text" });

  const notAList = await postDebrief(d1, token, { asked: "one per line" });
  assert.deepEqual(await notAList.json(), { error: "missing_fields", field: "asked" });
});

test("the shaky and fix_text shapes, and a malformed asked entry, each answer their own 400", { skip }, async () => {
  // #84 L9 — the failing side of every shape guard the caps test does not reach. Each guard
  // exists so the page's "try again in a moment" copy is never shown for a body that can never
  // succeed; delete any one of them and the route 500s (or worse, half-writes) instead.
  const d1 = d1Shape(openMigrated());
  const { token } = await seed(d1);

  const shakyNotList = await postDebrief(d1, token, { shaky: "lone-working" });
  assert.equal(shakyNotList.status, 400);
  assert.deepEqual(await shakyNotList.json(), { error: "missing_fields", field: "shaky" });

  const fixNotString = await postDebrief(d1, token, { fix_text: 42 });
  assert.equal(fixNotString.status, 400);
  assert.deepEqual(await fixNotString.json(), { error: "missing_fields", field: "fix_text" });

  for (const entry of [null, ["a", "list"], { text: 42 }, "a bare string"]) {
    const res = await postDebrief(d1, token, { asked: [entry] });
    assert.equal(res.status, 400, `${JSON.stringify(entry)} is not a line`);
    assert.deepEqual(await res.json(), { error: "missing_fields", field: "asked" });
  }
});

test("exactly at each cap the route accepts — its boundary and the page's must agree", { skip }, async () => {
  // #84 L9's tail: 501/21/2001 pin only the refusing side, so a `>` typed as `>=` here would
  // refuse the exact twenty-line panel interview MAX_ASKED was chosen to hold, while the page's
  // own at-the-cap test (which never reaches the route) stayed green.
  const d1 = d1Shape(openMigrated());
  const { token } = await seed(d1);

  const res = await postDebrief(d1, token, {
    asked: Array.from({ length: 20 }, (_, i) =>
      i === 0 ? { text: "x".repeat(500), competency_id: null } : { text: `Question ${i}?`, competency_id: null },
    ),
    fix_text: "y".repeat(2000),
  });
  assert.equal(res.status, 200);

  const payload = await (await getDebrief(d1, token)).json();
  assert.equal(payload.asked.length, 20);
  assert.equal(payload.fix_text.length, 2000);
});

test("a tick said twice is one tick, not a refused save", { skip }, async () => {
  // #84 L4, fixed: the cap counted rawShaky BEFORE the dedupe, so [id, id, other] on a
  // two-competency role answered 400 too_long though every id was valid. Unreachable from the
  // page (state.shaky is a Set) — real for any other caller of the API.
  const d1 = d1Shape(openMigrated());
  const { token, roleId, ids } = await seed(d1);

  const res = await postDebrief(d1, token, { shaky: [ids[0], ids[0], ids[1]] });
  assert.equal(res.status, 200);
  assert.deepEqual(await shakyCompetencyIds(d1, roleId), [...ids].sort(), "deduped, not doubled");
});

test("a failed question insert never fails the save that succeeded", { skip }, async () => {
  // #84 L9 — the degrade path. The words are already in the row when the inserts run, so a
  // throw here must cost the candidate the practice, never the note: remove the route's catch
  // and this answers 500 over a save that worked.
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { token, roleId, ids } = await seed(d1);
  db.exec("DROP TABLE question");

  const res = await postDebrief(d1, token, {
    asked: [{ text: "A question the store cannot file.", competency_id: ids[0] }],
    fix_text: "Still saved.",
  });
  assert.equal(res.status, 200, "the save succeeded before the insert failed, and the answer says so");
  assert.deepEqual(await res.json(), { ok: true });

  const row = await debriefByRole(d1, roleId);
  assert.match(row.asked_json, /cannot file/, "the words are in the row");
  assert.equal(row.fix_text, "Still saved.");
});

test("a stored asked_json that is valid JSON but not a list degrades to empty, like corrupt JSON", { skip }, async () => {
  // #84 L9 — askedFrom's OTHER degrade branch: the parse succeeds and the shape is wrong.
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { token, roleId } = await seed(d1);

  await postDebrief(d1, token, { fix_text: "Still readable." });
  db.prepare("UPDATE debrief SET asked_json = ? WHERE candidate_role_id = ?").run('{"asked": true}', roleId);

  const res = await getDebrief(d1, token);
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.deepEqual(payload.asked, []);
  assert.equal(payload.fix_text, "Still readable.");
});

test("a partial save is legal, and a later save adds to it without losing it", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { token, ids } = await seed(d1);

  // Everything empty is a real save: the form is resumable, so "I only got as far as one line"
  // has to be storable.
  assert.equal((await postDebrief(d1, token, {})).status, 200);
  assert.equal(countDebriefs(db), 1);

  assert.equal((await postDebrief(d1, token, { fix_text: "Lead with the result." })).status, 200);
  let payload = await (await getDebrief(d1, token)).json();
  assert.deepEqual(payload.asked, []);
  assert.equal(payload.fix_text, "Lead with the result.");

  assert.equal(
    (await postDebrief(d1, token, {
      asked: [
        { text: "  A lone visit that went wrong.  ", competency_id: ids[0] },
        { text: "Why this trust?", competency_id: null },
        { text: "   ", competency_id: null },
      ],
      shaky: [ids[1]],
      fix_text: "Lead with the result.",
    })).status,
    200,
  );

  payload = await (await getDebrief(d1, token)).json();
  assert.deepEqual(payload.asked, [
    { text: "A lone visit that went wrong.", competency_id: ids[0] },
    { text: "Why this trust?", competency_id: null },
  ], "trimmed once at the door, and a blank line is not a question");
  assert.deepEqual(payload.shaky, [ids[1]]);
  assert.equal(payload.fix_text, "Lead with the result.", "the earlier save is not lost");
  assert.deepEqual(
    payload.competencies.map((c) => Object.keys(c).sort()),
    [["id", "label"], ["id", "label"]],
    "labels and ids only — never importance, stage or success_rate",
  );
  assert.equal(countDebriefs(db), 1, "one row per role, upserted");
});

test("two identical saves create the question row once; an unplaced line creates none", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { token, roleId, ids } = await seed(d1);
  const base = countQuestions(db); // the two core questions the handover wrote

  const body = {
    asked: [
      { text: "How do you decide a visit is unsafe?", competency_id: ids[0] },
      { text: "Why this trust?", competency_id: null },
    ],
  };
  await postDebrief(d1, token, body);
  assert.equal(countQuestions(db), base + 1, "the placed line becomes a question; the unplaced one does not");

  await postDebrief(d1, token, body);
  assert.equal(countQuestions(db), base + 1, "the id is derived from the text — a re-save is a no-op");

  // And a stray space on the re-save is still the same line, because the route trims before it
  // hashes. This is the assertion that fails if the trim and the hash ever read different values.
  await postDebrief(d1, token, {
    asked: [{ text: " How do you decide a visit is unsafe? ", competency_id: ids[0] }],
  });
  assert.equal(countQuestions(db), base + 1);

  const asked = (await questionsByRole(d1, roleId)).filter((q) => q.id.includes("#asked-"));
  assert.equal(asked.length, 1);
  assert.equal(asked[0].axis, "lateral");
});

test("a line moved to another competency comes back reporting the new one", { skip }, async () => {
  // The round trip AC1 turns on, through the route this time. It is the failure the `asked_json`
  // column exists to prevent: both question rows stand, so nothing in `question` can answer
  // "which competency did they pick LAST".
  const d1 = d1Shape(openMigrated());
  const { token, ids } = await seed(d1);
  const line = "Tell me about a time you disagreed with a consultant.";

  await postDebrief(d1, token, { asked: [{ text: line, competency_id: ids[0] }] });
  await postDebrief(d1, token, { asked: [{ text: line, competency_id: ids[1] }] });

  const payload = await (await getDebrief(d1, token)).json();
  assert.deepEqual(payload.asked, [{ text: line, competency_id: ids[1] }]);
});

test("a corrupt asked_json degrades to an empty list rather than a 500", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { token, roleId } = await seed(d1);

  await postDebrief(d1, token, { fix_text: "Still readable." });
  db.prepare("UPDATE debrief SET asked_json = ? WHERE candidate_role_id = ?").run("{not json", roleId);

  const res = await getDebrief(d1, token);
  assert.equal(res.status, 200, "a page that could still take new notes must not answer 'it will not load'");
  const payload = await res.json();
  assert.deepEqual(payload.asked, []);
  assert.equal(payload.fix_text, "Still readable.", "the rest of the row is still theirs");
});

test("a placement whose competency has vanished comes back unplaced, not dangling", { skip }, async () => {
  // A re-handover can replace a role's competencies. A stale id in the payload would render as a
  // <select> with no matching option — the line silently reading as placed somewhere invisible.
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { token, roleId, ids } = await seed(d1);

  await postDebrief(d1, token, { asked: [{ text: "A question about lone working.", competency_id: ids[0] }] });
  db.prepare("DELETE FROM competency WHERE id = ?").run(ids[0]);

  const payload = await (await getDebrief(d1, token)).json();
  assert.deepEqual(payload.asked, [{ text: "A question about lone working.", competency_id: null }]);
  assert.deepEqual(await shakyCompetencyIds(d1, roleId), [], "and the competency took its ticks with it");
});

/* ── AC2: the dampening moves a queue and is shown nowhere ─────────────────────────────── */

test("a tick reorders the drill and reaches no field of the session response", { skip }, async () => {
  // The other half of AC2, and the half the wall test below cannot see: the flag must not reach
  // the CANDIDATE'S own response either. `drillState` decorates every ranked row with `shaky`,
  // and `state.ranked` feeds both `closePayload` and `day_before_focus` — each projects safely
  // today, and nothing said so until this test. Asserted as the exact KEY SET rather than by
  // grepping for the word: a substring scan passes on a field named anything else.
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { token, roleId, ids } = await seed(d1, { interviewAt: at(-1) });

  // Both competencies made IDENTICAL to the ranking — same importance, same cached stage and
  // rate — so the only thing that can separate them is the tick. They must also sit off the
  // bottom of the ladder, or the dampening clamps at 0 and moves nothing: a competency the
  // candidate has never practised is already as un-ready as readiness can say.
  db.prepare("UPDATE competency SET importance = 4, stage = 'can_answer', success_rate = 0.5 WHERE role_id = ?")
    .run(roleId);

  const before = await (await sessionRoute({
    request: { url: "https://engine.pages.dev/prep/api/session", headers: headers(token) },
    env: { DB: d1 },
  })).json();
  assert.equal(before.competencies.length, 2);

  const plain = await competenciesByRole(d1, roleId);
  const fixture = { questions: [], attempts: [], interviewAt: at(-1), now: new Date() };
  const untouched = drillState({ competencies: plain, ...fixture }).ranked.map((c) => c.id);
  assert.deepEqual(untouched, [...ids], "with no tick, the id tiebreak decides");

  await postDebrief(d1, token, { shaky: [untouched[1]] });
  const damped = drillState({
    competencies: plain, ...fixture, shakyIds: await shakyCompetencyIds(d1, roleId),
  }).ranked.map((c) => c.id);
  assert.deepEqual(damped, [untouched[1], untouched[0]], "the tick is what moved the queue");

  const after = await (await sessionRoute({
    request: { url: "https://engine.pages.dev/prep/api/session", headers: headers(token) },
    env: { DB: d1 },
  })).json();
  assert.deepEqual(
    after.competencies.map((c) => Object.keys(c).sort()),
    [["covered", "id", "label", "moved"], ["covered", "id", "label", "moved"]],
    "four fields and no fifth: `shaky` is a ranking input, never a thing a candidate is shown",
  );
  assert.deepEqual(after.competencies, before.competencies, "and the tick changed nothing visible at all");
  assert.equal(after.debrief_available, true);
  assert.ok(!Object.keys(after).includes("shaky"), "nor does it appear at the top level");
});

/* ── the entry point ───────────────────────────────────────────────────────────────────── */

test("both routes carry debrief_available, and it turns over on the interview day", { skip }, async () => {
  // #81 M3. The flag is the WHOLE entry point — no link is offered without it, from either page.
  // Before this, one assertion in the suite covered the chain, so the `false` branch and the
  // brief route's half could both be deleted and every test would stay green while the feature
  // had no way in. Both routes, both directions, one test.
  const d1 = d1Shape(openMigrated());
  const early = await seed(d1, { inviteId: "inv-early", interviewAt: at(3) });
  const now = await seed(d1, { inviteId: "inv-now", interviewAt: at(0) });

  const ask = (route, path, token) =>
    route({
      request: { url: `https://engine.pages.dev/prep/api/${path}`, headers: headers(token) },
      env: { DB: d1 },
    }).then((res) => res.json());

  for (const [path, route] of [["brief", briefRoute], ["session", sessionRoute]]) {
    assert.equal(
      (await ask(route, path, early.token)).debrief_available,
      false,
      `/prep/api/${path}: no link before the interview — the page would only refuse the form`,
    );
    assert.equal(
      (await ask(route, path, now.token)).debrief_available,
      true,
      `/prep/api/${path}: offered on the day, the same gate the debrief route itself applies`,
    );
  }
});

/* ── the interaction with the mint cap ─────────────────────────────────────────────────── */

test("asked questions do not use up the competency's mint budget", { skip }, async () => {
  // #81 M1, end to end, and the reversal of what plan Assumption 5 accepted. Asked questions are
  // SERVED like stored variants — that is deliberate and needs no new path — but counting them
  // against decision 6's cost envelope is a different claim. They cost nothing to obtain, nothing
  // deletes them, and the id is content-derived, so eight typo-fix re-saves reach the same
  // ceiling. Left uncounted, one debrief could stop a competency minting for good — and it would
  // be the competency the candidate ticked shaky, which SHAKY_DAMPEN puts at the front.
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { token, roleId, ids } = await seed(d1);

  await postDebrief(d1, token, {
    asked: Array.from({ length: MAX_VARIANTS_PER_COMPETENCY }, (_, i) => ({
      text: `A question they really asked, number ${i}.`,
      competency_id: ids[0],
    })),
  });

  const mine = (await questionsByRole(d1, roleId)).filter((q) => q.competency_id === ids[0]);
  assert.equal(
    mine.filter((q) => q.axis === "lateral").length,
    MAX_VARIANTS_PER_COMPETENCY,
    "one save can reach the cap — MAX_ASKED is 20",
  );

  // Every one of them attempted successfully, so there is nothing unattempted left to serve and
  // targeting would ordinarily demand a mint.
  for (const q of mine) {
    db.prepare("INSERT INTO attempt (competency_id, question_id, mode, rating) VALUES (?, ?, 'recall', 3)")
      .run(ids[0], q.id);
  }
  const attempts = await attemptsByRole(d1, roleId);
  const state = drillState({
    competencies: (await competenciesByRole(d1, roleId)).filter((c) => c.id === ids[0]),
    questions: mine,
    attempts: attempts.filter((a) => a.competency_id === ids[0]),
    interviewAt: at(-1),
    now: new Date(),
  });

  assert.ok(
    state.demand.mint,
    "eight questions from one interview must not exhaust the competency's minting",
  );
  assert.equal(
    mine.filter((q) => q.variant_of != null).length,
    0,
    "and none of them is a minted variant — `variant_of` is what the cap actually counts",
  );
});

/* ── AC5: the wall ─────────────────────────────────────────────────────────────────────── */
//
// DECISIONS.md decision 2, made structural. "No recruiter sees this" is a sentence on the page a
// candidate reads before they type, and a sentence is not a mechanism — so the claim below is a
// REACHABILITY one: there is no path from any recruiter-facing endpoint to debrief content,
// because no such file mentions it at all.
//
// The scan strips BLOCK comments and LINE-LEADING `//` comments before matching. Line-leading
// rather than any `//`, deliberately: stripping from a `//` anywhere on a line would also cut
// everything after a `//` inside a string literal, and a real reference hiding behind one would
// then be invisible — silence that looks identical to compliance, which is the failure
// test/schema.test.js:109-135 exists to name. A trailing comment mentioning the debrief under
// functions/api/ therefore still fails this test. That is the safe direction.

const DEBRIEF_STORE_FNS = [
  "debriefByRole",
  "upsertDebrief",
  "setShakyCompetencies",
  "shakyCompetencyIds",
  "insertAskedQuestion",
];

// #81 M5. THE OTHER PLACE THE CANDIDATE'S WORDS LIVE, and the word "debrief" appears nowhere near
// it: `insertAskedQuestion` writes what a real interviewer asked into the SHARED `question` table,
// beside our own minted ones. A future `functions/api/clients/[id]/questions.js` importing
// `questionsByRole` would match neither `/\bdebrief/i` nor any name in the list above — green,
// while a recruiter dashboard renders questions a candidate typed under "your recruiter never
// sees any of it". These are the only three readers of that table (store.js:534,553,575).
const QUESTION_READ_FNS = ["questionsByRole", "attemptsByRole", "questionForRole"];

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

test("no endpoint outside functions/prep/ can reach debrief content at all", () => {
  const all = functionFiles();
  assert.ok(all.length >= 15, `walked ${all.length} route files, expected at least 15 — the walk is broken`);

  const mentions = all.filter((path) => {
    const code = stripComments(readFileSync(join(root, path), "utf8"));
    return /\bdebrief/i.test(code) || DEBRIEF_STORE_FNS.some((fn) => code.includes(fn));
  });

  // The self-guard, and it is the whole reason this test is trustworthy: a scan that matched
  // NOTHING would pass the assertion below vacuously, and would keep passing after someone
  // renamed the store functions out from under it.
  assert.ok(mentions.length > 0, "the scan matched no file at all — it is asserting nothing");
  assert.ok(
    mentions.includes("functions/prep/api/debrief.js"),
    "the scan cannot see the one route that IS the debrief; the matcher has drifted",
  );

  const outside = mentions.filter((path) => !path.startsWith("functions/prep/"));
  assert.deepEqual(
    outside,
    [],
    `${outside.join(", ")} can reach debrief content. Decision 2: nothing a candidate enters ` +
      `crosses to the recruiter — no dashboard tile, no "questions this client asks" ` +
      `aggregation, no export. The agency's route to client question patterns is the ` +
      `client-knowledge note, written by the recruiter from their own post-interview call.`,
  );
});

test("no recruiter route reads the question table, where the asked lines also live", () => {
  // The test above cannot see this breach: it matches the word "debrief" and five store names,
  // and a route reading `question` carries none of them. Same wall, second door.
  const all = functionFiles();
  const readers = all.filter((path) => {
    const code = stripComments(readFileSync(join(root, path), "utf8"));
    // The store functions AND raw SQL. Only the first is how the table is reached today, but a
    // gate that catches only imports would let a route with its own `SELECT text FROM question`
    // through while this test's name promised otherwise.
    return (
      QUESTION_READ_FNS.some((fn) => code.includes(fn)) ||
      /\b(?:from|into|update|join)\s+question\b/i.test(code)
    );
  });

  assert.ok(
    readers.includes("functions/prep/api/session.js") && readers.includes("functions/prep/api/turn.js"),
    "the scan cannot see the two candidate routes that DO read questions; the names have drifted",
  );

  const recruiter = readers.filter((path) => path.startsWith("functions/api/"));
  assert.deepEqual(
    recruiter,
    [],
    `${recruiter.join(", ")} reads the question table. Since #77 those rows are not all ours: ` +
      `insertAskedQuestion writes what a real interviewer asked, in the candidate's own words, ` +
      `under the promise that no recruiter sees it. If a recruiter surface genuinely needs ` +
      `question METADATA — a count, a competency id, a difficulty — add a store function that ` +
      `projects those columns and never selects \`text\`, and name it here.`,
  );
});

test("the route is structurally model-free, which is what makes the ticket's constraint hold", () => {
  // #81 M6. The page's half is gated in test/prep-debrief-ui.test.js:492; the ROUTE — the file
  // whose own header calls the absent import "what makes that un-regressable rather than merely
  // true today" — had nothing. prep-turn.test.js:216 is the one-line precedent.
  //
  // The constraint is the spec's first unloosenable rule: the competency a question belongs under
  // is the CANDIDATE'S pick from a list. Nothing infers it from the text, nothing summarises the
  // debrief, nothing drafts the "one thing to fix". An import is how that stops being true.
  const src = readFileSync(join(root, "functions/prep/api/debrief.js"), "utf8");
  assert.match(src, /onRequestPost/, "the scan is reading the route, not an empty string");
  assert.ok(
    !/from\s+["'][^"']*(@anthropic-ai\/sdk|drill\.js)["']/.test(src),
    "structurally model-free: no sdk import, no drill.js import",
  );
});

test("the debrief's SQL lives in exactly one module, and it is not the recruiter's store", () => {
  const engineStore = readFileSync(join(root, "src/store.js"), "utf8");
  assert.doesNotMatch(
    stripComments(engineStore),
    /debrief/i,
    "src/store.js is the ENGINE and recruiter store. A debrief statement here is a query one " +
      "refactor away from a recruiter response, whatever the caller intended.",
  );
  const portalStore = stripComments(readFileSync(join(root, "src/portal/store.js"), "utf8"));
  for (const fn of DEBRIEF_STORE_FNS) {
    assert.ok(portalStore.includes(fn), `${fn} must live in src/portal/store.js — the one module that may`);
  }
});

test("the recruiter's counter cannot carry a word the candidate wrote", { skip }, async () => {
  // The behavioural half of the claim above. /api/events is the only recruiter route that touches
  // invite-scoped tables at all — it counts, and counting is the entire widening decision 3
  // sanctioned. A sentinel in the one free-text column proves the count is a count.
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { token, ids } = await seed(d1);
  const SENTINEL = "sentinel-nothing-here-may-ever-cross-the-wall";

  await postDebrief(d1, token, {
    asked: [{ text: `${SENTINEL} asked line`, competency_id: ids[0] }],
    shaky: [ids[0]],
    fix_text: SENTINEL,
  });
  db.prepare("INSERT INTO events (client_id, duration_ms) VALUES ('c-1', 8200)").run();

  // The premise the two scans above rest on, checked rather than assumed: the candidate's words
  // are in TWO tables, and only one of them has "debrief" in its name. If this ever stops being
  // true the `question`-table gate is guarding an empty room and should say so here first.
  const inQuestions = db
    .prepare("SELECT COUNT(*) AS n FROM question WHERE text LIKE ?")
    .get(`%${SENTINEL}%`).n;
  assert.equal(inQuestions, 1, "an asked line is stored in the shared question table, verbatim");

  const body = await (await eventsGet({ env: { DB: d1 } })).text();
  assert.ok(!body.includes(SENTINEL), `the debrief reached the recruiter's counter: ${body}`);
  assert.match(body, /per_client/, "and the counter did answer, so this is not passing on an empty body");
});
