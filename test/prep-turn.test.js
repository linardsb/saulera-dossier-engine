// #23 — both session-engine routes, end to end: real migrations on node:sqlite, real
// store, cookie-authenticated, fake Anthropic client handed in via context.data.
//
// The fake answers by SCHEMA — it reads the request's output_config.format.schema to
// decide whether it was asked for feedback, a nudge, a reveal or a variant — so the
// tests assert behaviour without depending on call order.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { onRequestPost as turnRoute } from "../functions/prep/api/turn.js";
import { onRequestGet as sessionRoute } from "../functions/prep/api/session.js";
import {
  createInvite,
  persistHandover,
  hashToken,
  questionsByRole,
  createStory,
} from "../src/portal/store.js";
import { mintToken, SESSION_COOKIE } from "../src/prep/tokens.js";
import { HABIT_LABELS } from "../src/prep/habits.js";
import { at, d1Shape, openMigrated, skip } from "./helpers/sqlite-d1.js";

const here = dirname(fileURLToPath(import.meta.url));
const PAYLOAD = () => JSON.parse(readFileSync(join(here, "fixtures", "prep-payload.json"), "utf8"));

/** The fixture cut down to ONE competency and its two ordinary questions, so targeting cannot
 *  wander mid-test and the core bank empties in a known number of turns. #79's concern question
 *  is dropped with the blocks it pairs with: it is an ordinary core row to this loop (that IS
 *  the ticket's claim, asserted at "a concern question drills through the existing loop" below),
 *  so here it would only make the bank one turn deeper. */
function SINGLE() {
  const payload = PAYLOAD();
  payload.competencies = payload.competencies.filter((c) => c.id === "comp-lone-working");
  payload.questions = payload.questions.filter(
    (q) => q.competency_id === "comp-lone-working" && q.type !== "concern",
  );
  payload.blocks = [];
  return payload;
}

const FEEDBACK_OK = (rating = 3, habit = "none") => ({
  stop_reason: "end_turn",
  content: [
    {
      type: "text",
      text: JSON.stringify({ worked: "Named the number.", improvement: "Lead with the result.", rating, habit }),
    },
  ],
});
const wrap = (payload) => ({
  stop_reason: "end_turn",
  content: [{ type: "text", text: JSON.stringify(payload) }],
});

/**
 * A fake @anthropic-ai/sdk client. `overrides` may replace the response per kind
 * (feedback | nudge | reveal | variant) with a message object or a throwing function.
 */
function fakeClient(overrides = {}) {
  const calls = [];
  const defaults = {
    feedback: FEEDBACK_OK(),
    nudge: wrap({ nudge: "What changed after you escalated?" }),
    reveal: wrap({ skeleton: ["The setting", "What made it hard", "The result"] }),
    variant: wrap({ text: "And if the family had pushed back?", difficulty: "standard" }),
  };
  return {
    calls,
    kinds: () => calls.map((c) => c.kind),
    // Plain namespace only — drill.js must not reach for client.beta (sonnet-5
    // rejects the fallbacks beta pair the Opus calls ride).
    messages: {
      stream(request) {
        const props = Object.keys(request.output_config.format.schema.properties);
        const kind = props.includes("habit")
          ? "feedback"
          : props.includes("nudge")
            ? "nudge"
            : props.includes("skeleton")
              ? "reveal"
              : "variant";
        calls.push(Object.assign(request, { kind }));
        const make = overrides[kind] ?? defaults[kind];
        const message = typeof make === "function" ? make(request) : make;
        return { finalMessage: async () => message };
      },
    },
  };
}

/** A real invite + handover + live session cookie, all through production writers. */
async function seed(d1, { payload = PAYLOAD(), inviteId = "inv-1", email = "c@example.com", interviewAt = at(7) } = {}) {
  const token = mintToken();
  await createInvite(d1, {
    id: inviteId,
    clientId: "c-1",
    email,
    interviewAt,
    tokenHash: await hashToken(token),
    expiresAt: at(21),
  });
  const { roleId } = await persistHandover(d1, { inviteId, jdText: "b", ethosText: "", cvText: "c", payload });
  return { token, roleId };
}

const headers = (token, extra = {}) => ({
  get: (name) => {
    if (name === "Cookie" && token) return `${SESSION_COOKIE}=${token}`;
    return extra[name] ?? null;
  },
});

const ENV = (d1) => ({ DB: d1, ANTHROPIC_API_KEY: "sk-test" });

const postTurn = (d1, client, body, token, extraHeaders = {}) =>
  turnRoute({
    request: {
      url: "https://engine.pages.dev/prep/api/turn",
      headers: headers(token, extraHeaders),
      json: async () => body,
    },
    env: ENV(d1),
    data: { client },
  });

const getSession = (d1, token, env = { DB: d1 }) =>
  sessionRoute({
    request: { url: "https://engine.pages.dev/prep/api/session", headers: headers(token) },
    env,
  });

const attemptBody = (questionId, over = {}) => ({
  action: "attempt",
  question_id: questionId,
  mode: "recall",
  answer_text: "I once had to escalate a wound that was deteriorating…",
  ...over,
});

/** The leak scan: no forbidden key anywhere in a candidate-bound body. */
function assertNoKeys(value, keys, where = "body") {
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoKeys(v, keys, `${where}[${i}]`));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      assert.ok(!keys.includes(k), `${where}.${k} must never reach a candidate`);
      assertNoKeys(v, keys, `${where}.${k}`);
    }
  }
}
const FORBIDDEN = ["success_rate", "stage", "importance", "rating", "difficulty", "axis", "variant_of"];

const competencyRow = (db, id) => db.prepare("SELECT * FROM competency WHERE id = ?").get(id);
const attemptCount = (db) => db.prepare("SELECT COUNT(*) AS n FROM attempt").get().n;

/* ── the honesty rule, end to end ──────────────────────────────────────────────────────── */

test("two revealed rating-4 attempts move nothing; one recall success moves everything", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { token, roleId } = await seed(d1);
  const question = (await questionsByRole(d1, roleId))[0];
  const client = fakeClient({ feedback: FEEDBACK_OK(4) });

  for (let i = 0; i < 2; i++) {
    const response = await postTurn(d1, client, attemptBody(question.id, { mode: "revealed" }), token);
    assert.equal(response.status, 200);
  }
  let row = competencyRow(db, question.competency_id);
  assert.equal(row.success_rate, 0, "a revealed attempt can NEVER raise the rate");
  assert.equal(row.stage, "", "nor the stage");

  const response = await postTurn(d1, client, attemptBody(question.id, { mode: "recall" }), token);
  assert.equal(response.status, 200);
  row = competencyRow(db, question.competency_id);
  assert.ok(row.success_rate > 0);
  assert.equal(row.stage, "can_answer");
  assert.equal((await response.json()).competency.moved, true);
});

/* ── the leak scan ─────────────────────────────────────────────────────────────────────── */

test("no turn response and no session GET carries a score-shaped key anywhere", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { token, roleId } = await seed(d1);
  const question = (await questionsByRole(d1, roleId))[0];
  const client = fakeClient({ feedback: FEEDBACK_OK(4, "rambles") });

  const turn = await postTurn(d1, client, attemptBody(question.id), token);
  assert.equal(turn.status, 200);
  assertNoKeys(await turn.json(), FORBIDDEN, "turn");

  const session = await getSession(d1, token);
  assert.equal(session.status, 200);
  const body = await session.json();
  assertNoKeys(body, FORBIDDEN, "session");
  assert.ok(body.next_question, "and there is still a drill to run");
});

/* ── the latency AC: session GET is model-free ─────────────────────────────────────────── */

test("session GET succeeds with NO model key and no client anywhere in scope", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { token } = await seed(d1);

  // env deliberately lacks ANTHROPIC_API_KEY; if session.js ever constructed a client
  // or read the key this would 503. The route imports neither the sdk nor drill.js.
  const response = await getSession(d1, token, { DB: d1 });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(body.next_question.id.endsWith("#0"), "the easiest core question, from the cache");
  assert.equal(body.turns_this_session, 0);
  assert.equal(body.suggest_close, false);
  assert.equal(body.last_close, null);
  const src = readFileSync(join(here, "..", "functions", "prep", "api", "session.js"), "utf8");
  assert.ok(
    !/from\s+["'][^"']*(@anthropic-ai\/sdk|drill\.js)["']/.test(src),
    "structurally model-free: no sdk import, no drill.js import",
  );
});

/* ── ownership ─────────────────────────────────────────────────────────────────────────── */

test("attempting another invite's question answers 404", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  const mine = await seed(d1, { inviteId: "inv-1", email: "a@example.com" });
  const theirs = await seed(d1, { inviteId: "inv-2", email: "b@example.com" });
  const theirQuestion = (await questionsByRole(d1, theirs.roleId))[0];

  const response = await postTurn(d1, fakeClient(), attemptBody(theirQuestion.id), mine.token);
  assert.equal(response.status, 404);
  assert.equal(attemptCount(db), 0, "nothing was recorded against anyone");
});

/* ── habits: announced exactly once ────────────────────────────────────────────────────── */

test("a habit is silent at 1, announced at exactly 2, and standing on GET thereafter", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { token, roleId } = await seed(d1);
  const question = (await questionsByRole(d1, roleId))[0];
  const client = fakeClient({ feedback: FEEDBACK_OK(2, "rambles") });

  const first = await (await postTurn(d1, client, attemptBody(question.id), token)).json();
  assert.equal(first.habit, null, "first sight is noise");

  const second = await (await postTurn(d1, client, attemptBody(question.id), token)).json();
  assert.equal(second.habit, HABIT_LABELS.rambles, "the observation that made it a pattern");

  const third = await (await postTurn(d1, client, attemptBody(question.id), token)).json();
  assert.equal(third.habit, null, "announcing every turn would be nagging");

  const session = await (await getSession(d1, token)).json();
  assert.deepEqual(session.habits, [HABIT_LABELS.rambles], "the standing list lives on GET");
});

/* ── variant minting ───────────────────────────────────────────────────────────────────── */

test("core bank exhausted with successes -> the next turn mints a lateral variant", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { token, roleId } = await seed(d1, { payload: SINGLE() });
  const questions = await questionsByRole(d1, roleId);
  assert.equal(questions.length, 2, "the single-competency fixture");
  const client = fakeClient({ feedback: FEEDBACK_OK(4) });

  // First success: core #0 attempted. Targeting then serves the remaining core question
  // (an unattempted variant beats remaining core only once a success exists — but with a
  // success it prefers variants, of which there are none, so it MINTS on this turn).
  const first = await (await postTurn(d1, client, attemptBody(questions[0].id), token)).json();
  const second = await (await postTurn(d1, client, attemptBody(questions[1].id), token)).json();

  assert.ok(client.kinds().includes("variant"), "the fake saw a variant request");
  const mintedResponse = [first, second].find((r) => r.next_question?.id.includes("#v-"));
  assert.ok(mintedResponse, "a minted variant came back as next_question");

  const stored = db.prepare("SELECT * FROM question WHERE axis IS NOT NULL").all();
  assert.equal(stored.length >= 1, true);
  assert.equal(stored[0].axis, "lateral");
  assert.equal(typeof stored[0].difficulty, "number");
  assert.ok(stored[0].variant_of, "variant_of points at the question succeeded on");

  // Re-serve, no second mint: the stored variant is now the unattempted next question.
  const before = client.kinds().filter((k) => k === "variant").length;
  const session = await (await getSession(d1, token)).json();
  assert.equal(session.next_question.id, stored[0].id, "served from the cache, no model call");
  assert.equal(client.kinds().filter((k) => k === "variant").length, before);
});

test("a mint failure degrades to next_question: null — never a 502 on a paid turn", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { token, roleId } = await seed(d1, { payload: SINGLE() });
  const questions = await questionsByRole(d1, roleId);
  const client = fakeClient({
    feedback: FEEDBACK_OK(4),
    variant: () => {
      throw new Error("boom");
    },
  });

  await postTurn(d1, client, attemptBody(questions[0].id), token);
  const response = await postTurn(d1, client, attemptBody(questions[1].id), token);
  assert.equal(response.status, 200, "the attempt is already safe; the mint was garnish");
  const body = await response.json();
  assert.ok(body.feedback, "the feedback was already paid for");
  const minted = [body].filter((b) => b.next_question?.id.includes("#v-"));
  assert.equal(minted.length, 0);
  assert.equal(attemptCount(db), 2, "both attempt rows exist");

  // Deviation #2, the follow-up: the GET degrades the still-standing {mint} demand to
  // the least-recently-attempted question — a mint failure must never dead-end the
  // drill with next_question: null, and the degrade costs no model call.
  const variantCalls = client.kinds().filter((k) => k === "variant").length;
  const session = await (await getSession(d1, token)).json();
  assert.equal(session.next_question?.id, questions[0].id, "the least-recently-attempted question");
  assert.equal(client.kinds().filter((k) => k === "variant").length, variantCalls, "no new mint");
});

/* ── failure semantics ─────────────────────────────────────────────────────────────────── */

test("a refusal on the feedback call leaves NO state", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { token, roleId } = await seed(d1);
  const question = (await questionsByRole(d1, roleId))[0];
  const client = fakeClient({ feedback: { stop_reason: "refusal", content: [] } });

  const response = await postTurn(d1, client, attemptBody(question.id), token);
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error, "model_refused");
  assert.equal(attemptCount(db), 0, "the call precedes every write — retrying cannot double-count");
});

test("empty answer_text: legal on revealed (no model call, rating NULL), 400 on recall", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { token, roleId } = await seed(d1);
  const question = (await questionsByRole(d1, roleId))[0];
  const client = fakeClient();

  const revealed = await postTurn(d1, client, attemptBody(question.id, { mode: "revealed", answer_text: "" }), token);
  assert.equal(revealed.status, 200);
  const body = await revealed.json();
  assert.equal(body.feedback, null, "no answer, no feedback — and no unearned encouragement");
  assert.ok(body.next_question, "the drill moves on");
  assert.equal(client.kinds().filter((k) => k === "feedback").length, 0, "the model was never asked");
  const [row] = db.prepare("SELECT mode, rating FROM attempt").all();
  assert.equal(row.mode, "revealed");
  assert.equal(row.rating, null);

  const recall = await postTurn(d1, client, attemptBody(question.id, { answer_text: "   " }), token);
  assert.equal(recall.status, 400);
});

test("a 20,001-character answer is too_long — no model call, no write; the cap itself is legal", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { token, roleId } = await seed(d1);
  const question = (await questionsByRole(d1, roleId))[0];
  const client = fakeClient();

  const over = await postTurn(d1, client, attemptBody(question.id, { answer_text: "a".repeat(20_001) }), token);
  assert.equal(over.status, 400);
  assert.equal((await over.json()).error, "too_long");
  assert.equal(client.calls.length, 0, "a caller fault costs no model spend");
  assert.equal(attemptCount(db), 0, "and no write");

  const atCap = await postTurn(d1, client, attemptBody(question.id, { answer_text: "a".repeat(20_000) }), token);
  assert.equal(atCap.status, 200, "20,000 exactly is inside the cap");
});

/* ── the help rungs ────────────────────────────────────────────────────────────────────── */

test("help/nudge returns a nudge and writes no attempt row", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { token, roleId } = await seed(d1);
  const question = (await questionsByRole(d1, roleId))[0];
  const client = fakeClient();

  const response = await postTurn(d1, client, { action: "help", question_id: question.id, rung: "nudge" }, token);
  assert.equal(response.status, 200);
  assert.ok((await response.json()).nudge);
  assert.equal(attemptCount(db), 0, "the rung is not the attempt");

  const reveal = await postTurn(d1, client, { action: "help", question_id: question.id, rung: "reveal" }, token);
  assert.ok(Array.isArray((await reveal.json()).skeleton), "a reveal is structurally headings");
  assert.equal(attemptCount(db), 0);
});

test("the two vocabularies never cross: rung on an attempt, mode on a help, both 400", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { token, roleId } = await seed(d1);
  const question = (await questionsByRole(d1, roleId))[0];
  const client = fakeClient();

  for (const body of [
    { action: "help", question_id: question.id, rung: "attempt" },
    { action: "help", question_id: question.id, rung: "nudge", mode: "nudged" },
    attemptBody(question.id, { rung: "nudge" }),
    attemptBody(question.id, { mode: "nudge" }), // the fourth mode the CHECK also refuses
    attemptBody(question.id, { surprise: true }),
    { action: "sing", question_id: question.id },
  ]) {
    const response = await postTurn(d1, client, body, token);
    assert.equal(response.status, 400, JSON.stringify(body));
  }
  assert.equal(client.calls.length, 0, "caller faults cost no model spend");
  assert.equal(attemptCount(db), 0);
});

/* ── the doors ─────────────────────────────────────────────────────────────────────────── */

test("no cookie is 401, cross-origin is 403, missing key is 503 — in that order of doors", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { token, roleId } = await seed(d1);
  const question = (await questionsByRole(d1, roleId))[0];
  const client = fakeClient();

  const anonymous = await postTurn(d1, client, attemptBody(question.id), null);
  assert.equal(anonymous.status, 401);

  const cross = await postTurn(d1, client, attemptBody(question.id), token, { "Sec-Fetch-Site": "cross-site" });
  assert.equal(cross.status, 403);

  const keyless = await turnRoute({
    request: {
      url: "https://engine.pages.dev/prep/api/turn",
      headers: headers(token),
      json: async () => attemptBody(question.id),
    },
    env: { DB: d1 },
    data: { client },
  });
  assert.equal(keyless.status, 503);
  assert.equal((await keyless.json()).error, "no_model_key");

  const sessionless = await getSession(d1, null);
  assert.equal(sessionless.status, 401);
  assert.equal(client.calls.length, 0);
  assert.equal(attemptCount(db), 0);
});

test("a session whose handover was never written answers 404 on both routes", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  const token = mintToken();
  await createInvite(d1, {
    id: "inv-bare",
    clientId: "c-1",
    email: "c@example.com",
    interviewAt: at(7),
    tokenHash: await hashToken(token),
    expiresAt: at(21),
  });

  assert.equal((await getSession(d1, token)).status, 404);
  const turn = await postTurn(d1, fakeClient(), attemptBody("any#0"), token);
  assert.equal(turn.status, 404);
});

test("zero competencies (all struck before Send) is a 200 done-state, not an error", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  const empty = PAYLOAD();
  empty.competencies = [];
  empty.questions = [];
  empty.blocks = [];
  const { token } = await seed(d1, { payload: empty });

  const response = await getSession(d1, token);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.next_question, null);
  assert.deepEqual(body.competencies, []);
});

/* ── the session boundary and last_close ───────────────────────────────────────────────── */

test("backdated sessions: last_close is the last COMPLETED session, idle and live", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { token, roleId } = await seed(d1, { payload: SINGLE() });
  const questions = await questionsByRole(d1, roleId);
  const lone = { id: questions[0].competency_id, label: "Working autonomously on a rural caseload" };
  const struggling = fakeClient({ feedback: FEEDBACK_OK(2) });
  const strong = fakeClient({ feedback: FEEDBACK_OK(4) });

  // Three real turns through the route, then backdate the log into two sessions split
  // by > 30 minutes: A = two failures ~2 h ago, B = one success 60 min ago (a stage
  // rise, '' -> can_answer, so B's close has an `improved`).
  await postTurn(d1, struggling, attemptBody(questions[0].id), token);
  await postTurn(d1, struggling, attemptBody(questions[0].id), token);
  await postTurn(d1, strong, attemptBody(questions[0].id), token);
  const minutesAgo = [120, 119, 60];
  db.prepare("SELECT id FROM attempt ORDER BY id").all().forEach((row, i) => {
    db.prepare("UPDATE attempt SET created_at = ? WHERE id = ?").run(at(-minutesAgo[i] / 1440), row.id);
  });

  // 60 idle minutes: nothing is live, so B is the last completed session and closes.
  const idle = await (await getSession(d1, token)).json();
  assert.equal(idle.turns_this_session, 0, "no live session, no turns");
  assert.equal(idle.suggest_close, false);
  assert.deepEqual(idle.last_close.improved, lone, "B's stage rise, judged against all of A");
  assert.deepEqual(idle.last_close.next, lone);
  assert.ok(idle.last_close.queued.every((q) => typeof q === "string"), "queued is plain text");
  assert.equal(idle.competencies[0].moved, true, "moved is scoped to B, the latest session");

  // One fresh attempt opens session C: B stays the last COMPLETED close (now bounded
  // by C's start, not by 'now'), and the turn counter is C's alone.
  await postTurn(d1, struggling, attemptBody(questions[0].id), token);
  const live = await (await getSession(d1, token)).json();
  assert.equal(live.turns_this_session, 1, "only session C's turns count");
  assert.deepEqual(live.last_close.improved, lone, "still session B's close");
});

/* ── suggest_close ─────────────────────────────────────────────────────────────────────── */

test("suggest_close flips on the 6th attempt-turn of the session; nothing is blocked", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { token, roleId } = await seed(d1);
  const question = (await questionsByRole(d1, roleId))[0];
  const client = fakeClient({ feedback: FEEDBACK_OK(2) });

  let body;
  for (let turn = 1; turn <= 7; turn++) {
    body = await (await postTurn(d1, client, attemptBody(question.id), token)).json();
    assert.equal(body.turns_this_session, turn);
    assert.equal(body.suggest_close, turn >= 6, `turn ${turn}`);
  }
  assert.ok(body.next_question !== undefined, "the 7th turn was served — the UI decides, not us");
});

test("day-before shortens the close: suggest_close flips on the 3rd turn at at(1)", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { token, roleId } = await seed(d1, { interviewAt: at(1) });
  const question = (await questionsByRole(d1, roleId))[0];
  const client = fakeClient({ feedback: FEEDBACK_OK(2) });

  let body;
  for (let turn = 1; turn <= 4; turn++) {
    body = await (await postTurn(d1, client, attemptBody(question.id), token)).json();
    assert.equal(body.turns_this_session, turn);
    assert.equal(body.suggest_close, turn >= 3, `turn ${turn}: the day-before threshold is 3, not 6`);
  }
  assert.ok(body.next_question !== undefined, "the 4th turn was still served — suggest, never block");
});

/* ── the storybank seam (#78) ──────────────────────────────────────────────────────────── */

const SKETCH_SENTINEL = "sentinel-no-model-may-ever-read-this-sketch";

/** Two stories on the role, written through the production writers the editor's route uses. */
async function seedStories(d1, roleId) {
  const first = await createStory(d1, {
    roleId,
    title: "The escalation on nights",
    sketch: `${SKETCH_SENTINEL} — the family refused the plan at 2am.`,
  });
  await createStory(d1, {
    roleId,
    title: "The audit nobody wanted",
    sketch: `${SKETCH_SENTINEL} — I found the gap in the records.`,
  });
  return first;
}

test("a nudge carries the candidate's story titles and none of their words", { skip }, async () => {
  const d1 = d1Shape(openMigrated());
  const { token, roleId } = await seed(d1);
  const question = (await questionsByRole(d1, roleId))[0];
  await seedStories(d1, roleId);
  const client = fakeClient();

  const response = await postTurn(d1, client, { action: "help", question_id: question.id, rung: "nudge" }, token);
  assert.equal(response.status, 200);
  assert.ok((await response.json()).nudge, "the response shape is unchanged: still one string");

  const prompt = client.calls[0].messages[0].content;
  assert.match(prompt, /The escalation on nights/, "the titles travel so the nudge can point at one");
  assert.match(prompt, /The audit nobody wanted/);
  assert.ok(
    !prompt.includes(SKETCH_SENTINEL),
    "the candidate's own words reached a model prompt — the one thing this seam exists to prevent",
  );
});

test("the reveal rung is handed no story titles at all", { skip }, async () => {
  // A skeleton of headings is already the structural answer; titles beside it would push the model
  // toward "use your story about X", which is content rather than structure.
  const d1 = d1Shape(openMigrated());
  const { token, roleId } = await seed(d1);
  const question = (await questionsByRole(d1, roleId))[0];
  await seedStories(d1, roleId);
  const client = fakeClient();

  await postTurn(d1, client, { action: "help", question_id: question.id, rung: "reveal" }, token);
  const prompt = client.calls[0].messages[0].content;
  assert.doesNotMatch(prompt, /story_titles/);
  assert.doesNotMatch(prompt, /The escalation on nights/);
});

test("a candidate with no storybank gets a nudge prompt with no story block in it", { skip }, async () => {
  const d1 = d1Shape(openMigrated());
  const { token, roleId } = await seed(d1);
  const question = (await questionsByRole(d1, roleId))[0];
  const client = fakeClient();

  await postTurn(d1, client, { action: "help", question_id: question.id, rung: "nudge" }, token);
  assert.doesNotMatch(client.calls[0].messages[0].content, /story_titles/, "empty means absent, not an empty block");
});

test("with migration 0012 unapplied the drill still works — the nudge just carries no titles", { skip }, async () => {
  // DEPLOY.md's triage row, asserted rather than promised, and the deliberate OPPOSITE of #77's
  // posture: the shaky read is unwrapped and takes the drill down, because a ticked competency
  // changes what is DRILLED. A story title only decorates a nudge, so taking a paid turn down for
  // it would be the worse trade. The loud signal for a missing 0012 is /prep/api/stories itself.
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { token, roleId } = await seed(d1);
  const question = (await questionsByRole(d1, roleId))[0];
  db.exec("DROP TABLE story_competency; DROP TABLE story;");
  const client = fakeClient();

  const response = await postTurn(d1, client, { action: "help", question_id: question.id, rung: "nudge" }, token);
  assert.equal(response.status, 200, "the drill does not go down when the storybank's table is missing");
  assert.ok((await response.json()).nudge, "and the candidate still gets their nudge");
  assert.doesNotMatch(client.calls[0].messages[0].content, /story_titles/);
});

test("a BUG in the story read is not swallowed as though it were a missing migration", { skip }, async () => {
  /* The catch above is scoped to "0012 is unapplied", and it used to catch everything. A TypeError
     from a rename was therefore absorbed identically to a missing table — story titles disabled
     forever, behind one log line reading "turn: story titles unavailable: unknown", with the drill
     answering 200 the whole time. `err?.code ?? err?.name` produced that "unknown" for every D1
     error too, because D1 raises plain Errors with neither field, so the line could not tell an
     operator apart the two states it exists to distinguish.

     A programmer error belongs in the outer handler where a real bug belongs. A missing table does
     not. */
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { token, roleId } = await seed(d1);
  const question = (await questionsByRole(d1, roleId))[0];

  // A rename, as the runtime sees one: the read throws a TypeError rather than a database error.
  const broken = {
    prepare(sql) {
      if (/FROM story\b/i.test(sql)) throw new TypeError("db.prepare(...).bind(...).al is not a function");
      return d1.prepare(sql);
    },
  };

  const response = await postTurn(broken, fakeClient(), { action: "help", question_id: question.id, rung: "nudge" }, token);
  assert.notEqual(response.status, 200, "a 200 here is the bug hiding — it must surface, not decorate nothing");
});
