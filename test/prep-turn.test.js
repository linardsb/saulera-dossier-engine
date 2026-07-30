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
} from "../src/portal/store.js";
import { mintToken, SESSION_COOKIE } from "../src/prep/tokens.js";
import { HABIT_LABELS } from "../src/prep/habits.js";
import { at, d1Shape, openMigrated, skip } from "./helpers/sqlite-d1.js";

const here = dirname(fileURLToPath(import.meta.url));
const PAYLOAD = () => JSON.parse(readFileSync(join(here, "fixtures", "prep-payload.json"), "utf8"));

/** The fixture cut down to ONE competency, so targeting cannot wander mid-test. */
function SINGLE() {
  const payload = PAYLOAD();
  payload.competencies = payload.competencies.filter((c) => c.id === "comp-lone-working");
  payload.questions = payload.questions.filter((q) => q.competency_id === "comp-lone-working");
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
