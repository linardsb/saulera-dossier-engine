// #23 — the session engine's store section, on real SQL.
//
// Everything here turns on a CONSTRAINT (the axis CHECK, the FK cascade), a JOIN (the
// ownership check), or `meta.changes` (observeHabit's upsert) — all of which
// test/helpers/fake-d1.js fakes. So this file runs on node:sqlite through
// test/helpers/sqlite-d1.js, seeding a REAL handover through `persistHandover`, the same
// writer production uses.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createInvite,
  persistHandover,
  roleByInviteId,
  competenciesByRole,
  questionsByRole,
  attemptsByRole,
  questionForRole,
  recordAttempt,
  setCompetencyProgress,
  insertVariant,
  observeHabit,
  habitsByRole,
} from "../src/portal/store.js";
import { StoreError } from "../src/store.js";
import { at, d1Shape, openMigrated, skip } from "./helpers/sqlite-d1.js";

const here = dirname(fileURLToPath(import.meta.url));
const PAYLOAD = () => JSON.parse(readFileSync(join(here, "fixtures", "prep-payload.json"), "utf8"));

/** A real invite + handover; returns the ids the engine derives everything from. */
async function seed(d1, inviteId = "inv-1", email = "candidate@example.com") {
  await createInvite(d1, {
    id: inviteId,
    clientId: "c-1",
    email,
    interviewAt: at(7),
    tokenHash: `hash-${inviteId}`,
    expiresAt: at(21),
  });
  const { roleId } = await persistHandover(d1, {
    inviteId,
    jdText: "the brief",
    ethosText: "",
    cvText: "the cv",
    payload: PAYLOAD(),
  });
  return { inviteId, roleId };
}

test("roleByInviteId returns role_id + interview_at and NOTHING privileged", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { inviteId, roleId } = await seed(d1);

  const role = await roleByInviteId(d1, inviteId);
  assert.equal(role.role_id, roleId);
  assert.ok(role.interview_at);
  for (const key of ["cv_text", "jd_text", "ethos_text", "brief_json"]) {
    assert.ok(!(key in role), `${key} must never ride a session read`);
  }
  assert.equal(await roleByInviteId(d1, "no-such-invite"), null);
});

test("questionForRole is the ownership check: another invite's question is null", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  const mine = await seed(d1, "inv-1", "a@example.com");
  const theirs = await seed(d1, "inv-2", "b@example.com");

  const myQuestion = (await questionsByRole(d1, mine.roleId))[0];
  const owned = await questionForRole(d1, { questionId: myQuestion.id, roleId: mine.roleId });
  assert.equal(owned.id, myQuestion.id);
  assert.ok(owned.competency_label, "the label rides along for the model prompts");

  assert.equal(
    await questionForRole(d1, { questionId: myQuestion.id, roleId: theirs.roleId }),
    null,
    "one candidate cannot attempt another invite's questions",
  );
});

test("insertVariant passes the axis CHECK and refuses 'core'/garbage as a 400", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { roleId } = await seed(d1);
  const competency = (await competenciesByRole(d1, roleId))[0];
  const base = (await questionsByRole(d1, roleId)).find((q) => q.competency_id === competency.id);

  const inserted = await insertVariant(d1, {
    competencyId: competency.id,
    text: "And what if the stakeholder had refused?",
    variantOf: base.id,
    axis: "lateral",
    difficulty: "standard",
  });
  assert.match(inserted.id, /#v-/, "cannot collide with the #index core ids");

  const row = db.prepare("SELECT * FROM question WHERE id = ?").get(inserted.id);
  assert.equal(row.axis, "lateral");
  assert.equal(typeof row.difficulty, "number", "through the DIFFICULTY map, not stored as text");
  assert.equal(row.variant_of, base.id);

  for (const axis of ["core", "sideways", "", null]) {
    await assert.rejects(
      () =>
        insertVariant(d1, {
          competencyId: competency.id,
          text: "x",
          variantOf: base.id,
          axis,
          difficulty: "standard",
        }),
      (err) => err instanceof StoreError && err.status === 400,
      `axis ${JSON.stringify(axis)} must be this store's 400, not ERR_SQLITE_ERROR`,
    );
  }
});

test("observeHabit: once -> 1, twice -> 2; an inactive row is not incremented", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { roleId } = await seed(d1);

  assert.deepEqual(await observeHabit(d1, { roleId, label: "rambles" }), { evidenceCount: 1 });
  assert.deepEqual(await observeHabit(d1, { roleId, label: "rambles" }), { evidenceCount: 2 });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM habit").get().n, 1, "an upsert, not a pile");

  // Retired habit: a new observation starts a NEW row at 1 rather than resurrecting it.
  db.prepare("UPDATE habit SET active = 0").run();
  assert.deepEqual(await observeHabit(d1, { roleId, label: "rambles" }), { evidenceCount: 1 });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM habit").get().n, 2);
});

test("recordAttempt guards the rating's affinity and the cascade takes the log", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { inviteId, roleId } = await seed(d1);
  const question = (await questionsByRole(d1, roleId))[0];

  await recordAttempt(d1, {
    competencyId: question.competency_id,
    questionId: question.id,
    mode: "recall",
    rating: 3,
  });
  await recordAttempt(d1, {
    competencyId: question.competency_id,
    questionId: question.id,
    mode: "revealed",
    rating: null,
  });
  await recordAttempt(d1, {
    competencyId: question.competency_id,
    questionId: question.id,
    mode: "nudged",
    rating: "3", // the affinity trap: a string must land as NULL, not as text
  });

  const rows = db.prepare("SELECT rating, typeof(rating) AS t FROM attempt ORDER BY id").all();
  assert.deepEqual(rows.map((r) => r.rating), [3, null, null]);
  assert.equal(rows[0].t, "integer");

  await assert.rejects(
    () => recordAttempt(d1, { competencyId: question.competency_id, questionId: question.id, mode: "nudge" }),
    /constraint/i,
    "the mode CHECK is the backstop — a fourth mode cannot be written",
  );

  db.prepare("DELETE FROM invite WHERE id = ?").run(inviteId);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM attempt").get().n, 0, "the cascade takes attempts");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM habit").get().n, 0);
});

test("attemptsByRole carries the question's axis and orders by created_at then id", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { roleId } = await seed(d1);
  const question = (await questionsByRole(d1, roleId))[0];
  const variant = await insertVariant(d1, {
    competencyId: question.competency_id,
    text: "the same competency, a different scenario",
    variantOf: question.id,
    axis: "lateral",
    difficulty: "standard",
  });

  // Two attempts in the same one-second tick: the id tiebreak keeps the replay deterministic.
  await recordAttempt(d1, { competencyId: question.competency_id, questionId: question.id, mode: "recall", rating: 2 });
  await recordAttempt(d1, { competencyId: question.competency_id, questionId: variant.id, mode: "recall", rating: 4 });

  const log = await attemptsByRole(d1, roleId);
  assert.equal(log.length, 2);
  assert.deepEqual(log.map((a) => a.axis), [null, "lateral"], "core is NULL, the variant carries its axis");
  assert.ok(log[0].id < log[1].id, "id ascending inside a shared created_at second");
});

test("setCompetencyProgress writes both cache columns", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { roleId } = await seed(d1);
  const competency = (await competenciesByRole(d1, roleId))[0];

  await setCompetencyProgress(d1, { competencyId: competency.id, stage: "can_answer", successRate: 0.5 });
  const row = db.prepare("SELECT stage, success_rate FROM competency WHERE id = ?").get(competency.id);
  assert.equal(row.stage, "can_answer");
  assert.equal(row.success_rate, 0.5);
});

test("habitsByRole returns the standing list in first-seen order", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { roleId } = await seed(d1);
  await observeHabit(d1, { roleId, label: "no_numbers" });
  await observeHabit(d1, { roleId, label: "rambles" });
  await observeHabit(d1, { roleId, label: "no_numbers" });

  const rows = await habitsByRole(d1, roleId);
  assert.deepEqual(
    rows.map((r) => [r.label, r.evidence_count]),
    [["no_numbers", 2], ["rambles", 1]],
  );
});
