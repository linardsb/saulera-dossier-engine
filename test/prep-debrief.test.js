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
import { onRequestGet as eventsGet } from "../functions/api/events.js";
import { drillState, MAX_VARIANTS_PER_COMPETENCY } from "../src/prep/targeting.js";
import { mintToken, SESSION_COOKIE } from "../src/prep/tokens.js";
import { at, d1Shape, openMigrated, skip } from "./helpers/sqlite-d1.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Two competencies and one core question each — enough to rank, place and drill. */
const PAYLOAD = {
  role_title: "Community Nurse",
  blocks: [],
  competencies: [
    { id: "lone-working", label: "Lone working", importance: 5, source_quote: "q" },
    { id: "stakeholders", label: "Working with stakeholders", importance: 4, source_quote: "q" },
  ],
  questions: [
    { competency_id: "lone-working", text: "A core lone-working question.", difficulty: "standard" },
    { competency_id: "stakeholders", text: "A core stakeholder question.", difficulty: "standard" },
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

/* ── the accepted interaction with the mint cap ────────────────────────────────────────── */

test("eight asked questions reach the mint cap, and the competency re-serves instead", { skip }, async () => {
  // Documented, not a bug (plan Assumption 5): asked questions are stored variants, so they count
  // toward decision 6's cost envelope. A competency holding eight questions a real interviewer
  // wrote has no need of minted ones — but a future reader finding `{mint}` gone would file it,
  // so it is asserted here with the reason attached.
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

  assert.equal(state.demand.mint, undefined, "at the cap a competency stops minting — decision 6's envelope");
  assert.ok(state.demand.question, "and re-serves the least recently attempted instead of going empty");
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

  const body = await (await eventsGet({ env: { DB: d1 } })).text();
  assert.ok(!body.includes(SENTINEL), `the debrief reached the recruiter's counter: ${body}`);
  assert.match(body, /per_client/, "and the counter did answer, so this is not passing on an empty body");
});
