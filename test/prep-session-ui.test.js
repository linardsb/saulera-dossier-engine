// #24 — the drill shell, driven end to end: the REAL route handlers (#23) over real-sqlite D1
// behind initSession's fetchImpl, the document double standing in for the page. This is the
// acceptance's "a full session runs end to end against #23 on fixtures", executed literally.
//
// Groups, in increasing order of how easily they rot:
//
//   1. the full session, end to end on fixtures
//   2. the ladder logs the right mode, and rung content is cached per question
//   3. resume restores the exact position; a gap resets to prime with the last close
//   4. error paths: signed-out, not ready, a failed turn that loses nothing
//   5. edge cases: a degraded mint, an empty revealed attempt, a habit announced once,
//      a dead brief that degrades prime only, a double-clicked send
//   6. the source scans and CSS gates for the three new files
//   7. the no-rank sweep over a whole drilled page, and COPY completeness
//
// WHAT THIS FILE CANNOT CHECK, by design (plan R1 of #21): test/helpers/dom.js does not lay
// out, focus or dispatch. The tests drive the controller's methods and reach handlers via
// node.listeners; visible focus, tab order, rung disclosure semantics from the keyboard and
// reduced motion are the manual pass in real Safari and real Chrome.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { initSession, COPY } from "../public/prep/session.js";
import { onRequestPost as turnRoute } from "../functions/prep/api/turn.js";
import { onRequestGet as sessionRoute } from "../functions/prep/api/session.js";
import { onRequestGet as briefRoute } from "../functions/prep/api/brief.js";
import { createInvite, persistHandover, hashToken } from "../src/portal/store.js";
import { mintToken, SESSION_COOKIE } from "../src/prep/tokens.js";
import { HABIT_LABELS } from "../src/prep/habits.js";
import { at, d1Shape, openMigrated, skip } from "./helpers/sqlite-d1.js";
import { fakeDocument, serialize, textOf, findAll } from "./helpers/dom.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const PAYLOAD = () => JSON.parse(read("test/fixtures/prep-payload.json"));

/** The fixture cut down to ONE competency, so targeting cannot wander mid-test. */
function SINGLE() {
  const payload = PAYLOAD();
  payload.competencies = payload.competencies.filter((c) => c.id === "comp-lone-working");
  payload.questions = payload.questions.filter((q) => q.competency_id === "comp-lone-working");
  payload.blocks = [];
  return payload;
}

/* ── the fake Anthropic client, copied from test/prep-turn.test.js (test files do not import
      each other here) ─────────────────────────────────────────────────────────────────────── */

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

const NUDGE_TEXT = "What changed after you escalated?";
const SKELETON = ["The setting", "What made it hard", "The result"];

function fakeClient(overrides = {}) {
  const calls = [];
  const defaults = {
    feedback: FEEDBACK_OK(),
    nudge: wrap({ nudge: NUDGE_TEXT }),
    reveal: wrap({ skeleton: SKELETON }),
    variant: wrap({ text: "And if the family had pushed back?", difficulty: "standard" }),
  };
  return {
    calls,
    kinds: () => calls.map((c) => c.kind),
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
async function seed(
  d1,
  { payload = PAYLOAD(), inviteId = "inv-1", email = "c@example.com", interviewAt = at(7) } = {},
) {
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

/* ── the fetch bridge: (url, opts) -> the real handlers ────────────────────────────────── */

function bridge({ d1, client, token, urls = [], failBrief = false }) {
  const env = { DB: d1, ANTHROPIC_API_KEY: "sk-test" };
  return async (url, opts = {}) => {
    urls.push(String(url));
    const target = new URL(url, "https://engine.pages.dev");
    const request = {
      url: target.href,
      headers: {
        get: (name) => {
          const key = String(name).toLowerCase();
          if (key === "cookie") return token ? `${SESSION_COOKIE}=${token}` : null;
          if (key === "sec-fetch-site") return "same-origin";
          return null;
        },
      },
      json: async () => JSON.parse(opts.body),
    };
    if (target.pathname === "/prep/api/session") return sessionRoute({ request, env });
    if (target.pathname === "/prep/api/brief") {
      if (failBrief) return new Response("boom", { status: 500 });
      return briefRoute({ request, env });
    }
    if (target.pathname === "/prep/api/turn") return turnRoute({ request, env, data: { client } });
    throw new Error(`unexpected fetch: ${url}`);
  };
}

/* ── the shell: session.html's ids, as a document double ───────────────────────────────── */

// Mirrors the markup rather than parsing it (nothing in this suite parses HTML); the id drift
// guard in group 6 is what keeps this mirror honest against the real document.
const SHELL_IDS = [
  "session-state",
  "act-prime",
  "prime-blocks",
  "start",
  "act-drill",
  "drill-log",
  "drill-progress",
  "answer-form",
  "answer",
  "send",
  "close-drill",
  "act-close",
  "close-body",
];

function shell() {
  const base = fakeDocument();
  const index = new Map();
  const doc = {
    createElement: base.createElement,
    createTextNode: base.createTextNode,
    getElementById: (id) => index.get(id) ?? null,
  };
  const make = (tag, id, hidden = false) => {
    const node = base.createElement(tag);
    node.setAttribute("id", id);
    node.hidden = hidden;
    index.set(id, node);
    return node;
  };

  const refs = {
    stateLine: make("p", "session-state"),
    actPrime: make("section", "act-prime", true),
    primeBlocks: make("div", "prime-blocks"),
    startButton: make("button", "start"),
    actDrill: make("section", "act-drill", true),
    log: make("div", "drill-log"),
    progress: make("p", "drill-progress"),
    form: make("form", "answer-form"),
    answer: make("textarea", "answer"),
    send: make("button", "send"),
    closeButton: make("button", "close-drill", true),
    actClose: make("section", "act-close", true),
    closeBody: make("div", "close-body"),
  };
  refs.answer.value = "";

  // Nested the way session.html nests, so serializing `body` walks the whole page.
  const body = base.createElement("div");
  refs.actPrime.appendChild(refs.primeBlocks);
  refs.actPrime.appendChild(refs.startButton);
  refs.form.appendChild(refs.answer);
  refs.form.appendChild(refs.send);
  refs.actDrill.appendChild(refs.log);
  refs.actDrill.appendChild(refs.progress);
  refs.actDrill.appendChild(refs.form);
  refs.actDrill.appendChild(refs.closeButton);
  refs.actClose.appendChild(refs.closeBody);
  body.appendChild(refs.stateLine);
  body.appendChild(refs.actPrime);
  body.appendChild(refs.actDrill);
  body.appendChild(refs.actClose);

  return { doc, body, ...refs };
}

async function boot({ d1, client, token, failBrief = false, navigate } = {}) {
  const s = shell();
  const urls = [];
  const controller = initSession({
    doc: s.doc,
    fetchImpl: bridge({ d1, client, token, urls, failBrief }),
    navigate,
  });
  await controller.ready;
  return { ...s, controller, urls };
}

const attemptModes = (db) =>
  db.prepare("SELECT mode FROM attempt ORDER BY rowid").all().map((row) => row.mode);
const attemptCount = (db) => db.prepare("SELECT COUNT(*) AS n FROM attempt").get().n;

const visibleYouEntries = (log) =>
  findAll(log, (n) => n.classes.includes("log-you") && !n.hidden);

const count = (haystack, needle) => haystack.split(needle).length - 1;

/* ── group 1: the full session, end to end ─────────────────────────────────────────────── */

test("a full session runs end to end against the real routes on fixtures", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { token } = await seed(d1);
  const client = fakeClient();
  const s = await boot({ d1, client, token });
  const { controller } = s;

  // Prime shows: no attempts yet, the borrowed PrimerCard, the resumable note.
  assert.equal(s.actPrime.hidden, false);
  assert.equal(s.actDrill.hidden, true);
  assert.ok(textOf(s.primeBlocks).includes("What this role is really about"), "the PrimerCard");
  assert.ok(textOf(s.primeBlocks).includes(COPY.primeNote));
  assert.deepEqual(client.kinds(), [], "prime spends no model call");

  // Start -> the question asked cold: its text, and nothing the ladder holds.
  s.startButton.listeners.click[0]();
  assert.equal(s.actPrime.hidden, true);
  assert.equal(s.actDrill.hidden, false);
  const firstQuestion = controller.state.currentQuestion;
  assert.ok(firstQuestion?.id, "a question is on deck");
  assert.ok(textOf(s.log).includes(firstQuestion.text));
  assert.ok(!textOf(s.log).includes(NUDGE_TEXT), "no hint before it is asked for");

  // Open the nudge through the ladder's own button, then await the recorded flight.
  const nudgeButton = findAll(controller.state.ladder, (n) => n.classes.includes("help-rung-toggle"))[0];
  nudgeButton.listeners.click[0]();
  await controller.openRung("nudged");
  assert.deepEqual(client.kinds(), ["nudge"], "the help POST carried rung nudge");
  assert.ok(textOf(controller.state.panels.nudge).includes(NUDGE_TEXT), "the panel filled");

  // Attempt -> mode nudged; feedback rendered with worked and the MAPPED improve.
  s.answer.value = "I escalated the wound that was deteriorating and said so in the notes.";
  await controller.submitAttempt();
  assert.deepEqual(attemptModes(db), ["nudged"]);
  const logText = textOf(s.log);
  assert.ok(logText.includes(COPY.you), "the optimistic echo stayed");
  assert.ok(logText.includes("Named the number."), "feedback.worked rendered");
  assert.ok(logText.includes("Lead with the result."), "feedback.improvement rendered as improve");
  assert.ok(textOf(s.progress).includes(COPY.coveredPrefix), "the progress line moved");

  // The next question rendered; five more turns reach the close suggestion.
  assert.ok(controller.state.currentQuestion, "the drill continues");
  assert.notEqual(controller.state.currentQuestion.id, firstQuestion.id);
  for (let i = 0; i < 5; i += 1) {
    assert.ok(controller.state.currentQuestion, `a question is on deck for turn ${i + 2}`);
    s.answer.value = "A concrete answer with a result in it.";
    await controller.submitAttempt();
  }
  assert.equal(s.closeButton.hidden, false, "six turns suggest the close");

  // Close: composed from this session's own turns, an improvement or the honest line.
  s.closeButton.listeners.click[0]();
  assert.equal(s.actClose.hidden, false);
  assert.equal(s.actDrill.hidden, true);
  const closeText = textOf(s.closeBody);
  assert.ok(
    closeText.includes(COPY.closeImproved) || closeText.includes(COPY.closeHonest),
    "the close says something true about movement",
  );
});

/* ── group 2: modes and the rung cache ─────────────────────────────────────────────────── */

test("the ladder logs the right mode: recall, revealed, and the legal empty reveal", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { token } = await seed(d1);
  const client = fakeClient();
  const s = await boot({ d1, client, token });
  const { controller } = s;
  controller.start();

  // Recall: no rung touched.
  s.answer.value = "A recall answer with the result first.";
  await controller.submitAttempt();

  // Revealed, with text: the structure was opened before answering.
  await controller.openRung("revealed");
  assert.ok(textOf(controller.state.panels.reveal).includes(SKELETON[0]), "the skeleton filled");
  s.answer.value = "An answer under the revealed structure.";
  await controller.submitAttempt();

  // Revealed, empty: legal, no feedback invented.
  await controller.openRung("revealed");
  s.answer.value = "";
  await controller.submitAttempt();
  assert.ok(textOf(s.log).includes(COPY.noFeedback), "an empty reveal earns the quiet caption");
  assert.ok(textOf(s.log).includes(COPY.movedOn), "the echo says what happened");

  // Empty WITHOUT the reveal: guarded client-side, nothing sent.
  const before = attemptCount(db);
  s.answer.value = "";
  await controller.submitAttempt();
  assert.equal(attemptCount(db), before, "the guard stopped the empty recall");
  assert.equal(textOf(s.stateLine), COPY.emptyGuard);

  assert.deepEqual(attemptModes(db), ["recall", "revealed", "revealed"]);
});

test("rung content is cached per question: reopening never re-spends a model call", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { token } = await seed(d1);
  const client = fakeClient();
  const s = await boot({ d1, client, token });
  const { controller } = s;
  controller.start();

  const buttons = findAll(controller.state.ladder, (n) => n.classes.includes("help-rung-toggle"));
  buttons[0].listeners.click[0](); // open
  await controller.openRung("nudged");
  buttons[0].listeners.click[0](); // close — not a rung
  buttons[0].listeners.click[0](); // reopen — cached
  await controller.openRung("nudged");
  assert.equal(client.kinds().filter((k) => k === "nudge").length, 1, "one nudge, however often opened");

  // The cache is per QUESTION: the next question's nudge is a fresh call.
  s.answer.value = "An answer.";
  await controller.submitAttempt();
  await controller.openRung("nudged");
  assert.equal(client.kinds().filter((k) => k === "nudge").length, 2);
});

/* ── group 3: resume ───────────────────────────────────────────────────────────────────── */

test("resume restores the exact position: drill entered directly, same question served", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { token } = await seed(d1);
  const client = fakeClient();

  const first = await boot({ d1, client, token });
  first.controller.start();
  for (let i = 0; i < 2; i += 1) {
    first.answer.value = "An answer with a number in it.";
    await first.controller.submitAttempt();
  }
  const onDeck = first.controller.state.currentQuestion;
  assert.ok(onDeck, "a question was on deck when the tab closed");

  const second = await boot({ d1, client, token });
  assert.equal(second.actPrime.hidden, true, "prime skipped");
  assert.equal(second.actDrill.hidden, false, "landed in the drill");
  assert.equal(second.controller.state.currentQuestion?.id, onDeck.id, "the same question");
});

test("after the session gap, a fresh visit primes again and shows the last close", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { token } = await seed(d1);
  const client = fakeClient();

  const first = await boot({ d1, client, token });
  first.controller.start();
  for (let i = 0; i < 2; i += 1) {
    first.answer.value = "An answer with the result first.";
    await first.controller.submitAttempt();
  }
  // Past the 30-minute boundary, the attempts become a COMPLETED session.
  db.prepare("UPDATE attempt SET created_at = ?").run(at(-40 / 1440));

  const second = await boot({ d1, client, token });
  assert.equal(second.actPrime.hidden, false, "a new session starts at prime");
  assert.equal(second.actDrill.hidden, true);
  assert.ok(textOf(second.primeBlocks).includes(COPY.lastImproved), "the previous close is shown");
});

/* ── group 4: error paths ──────────────────────────────────────────────────────────────── */

test("signed out means the login page, not an error line", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  await seed(d1);
  const navigations = [];
  await boot({ d1, client: fakeClient(), token: "not-a-token", navigate: (url) => navigations.push(url) });
  assert.deepEqual(navigations, ["/prep/login"]);
});

test("an invite with no handover yet is a real state: not ready, not failed", { skip }, async () => {
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

  const s = await boot({ d1, client: fakeClient(), token });
  assert.equal(s.controller.state.phase, "not-ready");
  assert.equal(textOf(s.stateLine), COPY.notReady);
  assert.ok(!s.stateLine.classes.includes("is-error"), "not ready is not an error");
});

test("a failed turn loses nothing: answer restored, echo withdrawn, retry counts once", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { token } = await seed(d1);
  let feedbackCalls = 0;
  const client = fakeClient({
    feedback: () => {
      feedbackCalls += 1;
      if (feedbackCalls === 1) throw new Error("boom");
      return FEEDBACK_OK();
    },
  });
  const s = await boot({ d1, client, token });
  const { controller } = s;
  controller.start();

  const typed = "The answer I typed and must not lose.";
  s.answer.value = typed;
  await controller.submitAttempt();
  assert.equal(s.answer.value, typed, "the typed answer is back in the box");
  assert.equal(s.send.attrs["aria-disabled"], "false", "the form is usable again");
  assert.equal(textOf(s.stateLine), COPY.turnFailed);
  assert.equal(visibleYouEntries(s.log).length, 0, "the optimistic echo was withdrawn");
  assert.equal(attemptCount(db), 0, "the failed turn left no state server-side");

  await controller.submitAttempt();
  assert.equal(visibleYouEntries(s.log).length, 1, "no duplicated echo on the retry");
  assert.equal(attemptCount(db), 1);
});

/* ── group 5: edge cases ───────────────────────────────────────────────────────────────── */

test("a degraded mint mid-drill lands on done-for-now, never a dead form", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { token } = await seed(d1, { payload: SINGLE() });
  const client = fakeClient({
    variant: () => {
      throw new Error("boom");
    },
  });
  const s = await boot({ d1, client, token });
  const { controller } = s;
  controller.start();

  for (let i = 0; i < 5 && controller.state.currentQuestion; i += 1) {
    s.answer.value = "A strong answer, so the bank runs dry.";
    await controller.submitAttempt();
  }
  assert.equal(controller.state.phase, "done");
  assert.equal(s.form.hidden, true, "no dead form");
  assert.ok(textOf(s.log).includes(COPY.doneForNow));
  assert.equal(s.closeButton.hidden, false, "the close is still offered");
});

test("a habit is announced the turn it becomes a pattern, and rendered exactly once", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { token } = await seed(d1);
  const client = fakeClient({ feedback: FEEDBACK_OK(2, "rambles") });
  const s = await boot({ d1, client, token });
  const { controller } = s;
  controller.start();

  for (let i = 0; i < 3; i += 1) {
    s.answer.value = "An answer that rambles on and on.";
    await controller.submitAttempt();
  }
  const logText = textOf(s.log);
  assert.equal(count(logText, COPY.habitLine), 1, "announced at 2, silent at 1 and 3");
  assert.ok(logText.includes(HABIT_LABELS.rambles));
});

test("a dead brief degrades prime and leaves the drill untouched", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { token } = await seed(d1);
  const client = fakeClient();
  const s = await boot({ d1, client, token, failBrief: true });
  const { controller } = s;

  assert.equal(s.actPrime.hidden, false, "prime still shows");
  assert.ok(!textOf(s.primeBlocks).includes("What this role is really about"), "no PrimerCard");
  assert.ok(textOf(s.primeBlocks).includes(COPY.primeNote), "the rest of prime stands");

  controller.start();
  s.answer.value = "An answer.";
  await controller.submitAttempt();
  assert.equal(attemptCount(db), 1, "the drill works without the brief");
});

test("a double-clicked send spends one turn, and the button says so while in flight", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { token } = await seed(d1);
  const client = fakeClient();
  const s = await boot({ d1, client, token });
  const { controller } = s;
  controller.start();

  s.answer.value = "An answer clicked twice.";
  const inFlight = controller.submitAttempt();
  assert.equal(s.send.attrs["aria-disabled"], "true", "disabled for the flight");
  const second = controller.submitAttempt();
  await Promise.all([inFlight, second]);
  assert.equal(attemptCount(db), 1, "one attempt, however many clicks");
  assert.equal(visibleYouEntries(s.log).length, 1);
});

/* ── group 5b: day-before mode (#25) ───────────────────────────────────────────────────── */

test("day-before prime: LogisticsRail first, then DayBeforeMode, and no PrimerCard", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { token } = await seed(d1, { interviewAt: at(1) });
  const s = await boot({ d1, client: fakeClient(), token });

  assert.equal(s.controller.state.dayBefore, true, "the GET's flag reached the controller");
  const primeText = textOf(s.primeBlocks);
  const logisticsAt = primeText.indexOf("The practical details");
  const dayBeforeAt = primeText.indexOf("The day before");
  assert.ok(logisticsAt >= 0, "the LogisticsRail rendered");
  assert.ok(dayBeforeAt >= 0, "the DayBeforeMode rendered");
  assert.ok(logisticsAt < dayBeforeAt, "the practical details come first");
  assert.ok(!primeText.includes("What this role is really about"), "no PrimerCard — a run-through, not re-priming");
  assert.ok(!primeText.includes(COPY.primeNote), "no ProgressStrip either");
  assert.ok(primeText.includes(COPY.dayBeforeIntro));
  assert.ok(primeText.includes(COPY.dayBeforeNote));
});

test("day-before focus lists the top-ranked competency labels, in rank order", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { token } = await seed(d1, { interviewAt: at(1) });
  const s = await boot({ d1, client: fakeClient(), token });

  const focus = s.controller.state.session.day_before_focus;
  assert.equal(focus[0], "Working autonomously on a rural caseload", "importance 5 ranks first");
  assert.equal(focus.length, 3);
  assert.ok(textOf(s.primeBlocks).includes(focus[0]), "the labels render under the focus head");
});

test("provably shorter: three turns suggest the close at at(1), and do not at at(7)", { skip }, async () => {
  for (const [interviewAt, hiddenAfterThree] of [[at(1), false], [at(7), true]]) {
    const db = openMigrated();
    const d1 = d1Shape(db);
    const { token } = await seed(d1, { interviewAt });
    const s = await boot({ d1, client: fakeClient(), token });
    s.controller.start();
    for (let i = 0; i < 3; i += 1) {
      s.answer.value = "An answer, toward the day-before threshold.";
      await s.controller.submitAttempt();
    }
    assert.equal(
      s.closeButton.hidden,
      hiddenAfterThree,
      `after 3 turns, closeButton.hidden should be ${hiddenAfterThree} with the interview at ${interviewAt}`,
    );
  }
});

test("the day-before close has no 'queued for next time' — there is no next time", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { token } = await seed(d1, { interviewAt: at(1) });
  const s = await boot({ d1, client: fakeClient(), token });
  const { controller } = s;
  controller.start();

  for (let i = 0; i < 3; i += 1) {
    s.answer.value = "An answer with the result first.";
    await controller.submitAttempt();
  }
  assert.ok(controller.state.currentQuestion, "a question is on deck — the section WOULD render normally");
  controller.closeSession();
  const closeText = textOf(s.closeBody);
  assert.ok(!closeText.includes(COPY.closeNext), "no queued section the day before");
  assert.ok(
    closeText.includes(COPY.closeImproved) || closeText.includes(COPY.closeHonest),
    "the close still says something true about movement",
  );
});

test("day-of gets the day-before shape; two days out does not", { skip }, async () => {
  for (const [interviewAt, expected] of [[at(0), true], [at(2), false]]) {
    const db = openMigrated();
    const d1 = d1Shape(db);
    const { token } = await seed(d1, { interviewAt });
    const s = await boot({ d1, client: fakeClient(), token });
    assert.equal(s.controller.state.dayBefore, expected, `day_before at ${interviewAt}`);
    assert.equal(
      textOf(s.primeBlocks).includes("The day before"),
      expected,
      `the prime branch at ${interviewAt}`,
    );
  }
});

/* ── group 5c: the locum branch (#50) ──────────────────────────────────────────────────── */

/** The fixture as a stored LOCUM handover: the server-stamped flag, question types, and a
 *  FirstDayPrimer block — the payload send.js would persist for a locum booking. */
function LOCUM_PAYLOAD() {
  const payload = PAYLOAD();
  payload.engagement = "locum";
  payload.questions.forEach((q, i) => {
    q.type = ["client", "competency", "screening"][i % 3];
  });
  payload.blocks.push({
    name: "FirstDayPrimer",
    props: {
      intro: "What we know that will help on day one.",
      items: [
        { topic: "Who to report to", detail: "The Clinical Services Manager.", source_field_key: "their-process" },
      ],
    },
  });
  return payload;
}

test("a locum handover renders the primer and the grouped list, and never enters the drill", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { token } = await seed(d1, { payload: LOCUM_PAYLOAD() });
  const client = fakeClient();
  const s = await boot({ d1, client, token });
  const { controller } = s;

  assert.equal(controller.state.engagement, "locum", "the brief's flag reached the controller");
  assert.equal(controller.state.phase, "done", "nothing further is on offer");
  assert.equal(s.actPrime.hidden, false);
  assert.equal(s.actDrill.hidden, true, "the drill is never entered");
  assert.equal(s.startButton.hidden, true, "no Start button");
  assert.deepEqual(client.kinds(), [], "the locum surface spends no model call");

  const primeText = textOf(s.primeBlocks);
  assert.ok(primeText.includes("Your first day"), "the FirstDayPrimer rendered");
  assert.ok(primeText.includes("The Clinical Services Manager."), "with its detail");
  assert.ok(primeText.includes("The practical details"), "the LogisticsRail rendered");
  assert.ok(primeText.includes("What you may be asked"), "the LocumQuestions block rendered");
  assert.ok(primeText.includes("What this manager tends to ask"), "grouped: client");
  assert.ok(primeText.includes("Expect to be asked about your experience"), "grouped: competency");
  assert.ok(primeText.includes("Have ready"), "grouped: screening");
  assert.ok(primeText.includes(COPY.locumNote), "the honest one-liner renders");

  // The perm prime's furniture stays out: no re-priming card, no progress, no resumable note.
  assert.ok(!primeText.includes("What this role is really about"), "no PrimerCard");
  assert.ok(!primeText.includes(COPY.primeNote), "no ProgressStrip");

  // Every question in the stored payload reaches the page — {text, type} through the
  // projection, grouped by type on the page.
  for (const question of LOCUM_PAYLOAD().questions) {
    assert.ok(primeText.includes(question.text), `question missing: ${question.text.slice(0, 40)}…`);
  }
});

test("day-before plus locum takes the locum branch — site access IS the day-before content", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { token } = await seed(d1, { payload: LOCUM_PAYLOAD(), interviewAt: at(1) });
  const s = await boot({ d1, client: fakeClient(), token });

  assert.equal(s.controller.state.dayBefore, true, "the GET still says day-before");
  const primeText = textOf(s.primeBlocks);
  assert.ok(primeText.includes("Your first day"), "the locum branch won");
  assert.ok(!primeText.includes(COPY.dayBeforeIntro), "the day-before branch did not render");
});

test("a locum invite with a stray attempt row still lands on the primer, never the drill", { skip }, async () => {
  // The resume guard predates #50 and routes turns_this_session > 0 into enterDrill(). The UI
  // never offers a locum candidate the drill, so an attempt row here is an anomaly — but if one
  // exists (the turn endpoint is technically reachable, plan A3), the locum surface must win.
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { roleId, token } = await seed(d1, { payload: LOCUM_PAYLOAD() });
  const competencyRowId = `${roleId}:comp-lone-working`;
  db.prepare("INSERT INTO attempt (competency_id, question_id, mode) VALUES (?, ?, 'recall')").run(
    competencyRowId,
    `${competencyRowId}#0`,
  );

  const s = await boot({ d1, client: fakeClient(), token });
  assert.equal(s.actDrill.hidden, true, "the stray attempt did not open the drill");
  assert.ok(textOf(s.primeBlocks).includes("Your first day"), "the locum prime rendered");
});

test("a perm handover is untouched by #50: the same prime, the same drill entry", { skip }, async () => {
  // The pin the plan asks for: the perm path renders exactly the furniture it always did, and
  // Start still enters the drill.
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { token } = await seed(d1);
  const s = await boot({ d1, client: fakeClient(), token });

  assert.equal(s.controller.state.engagement, "other", "a pre-#50 payload reads as other");
  const primeText = textOf(s.primeBlocks);
  assert.ok(primeText.includes("What this role is really about"), "the PrimerCard stands");
  assert.ok(primeText.includes(COPY.primeNote), "the ProgressStrip stands");
  assert.ok(!primeText.includes("Your first day"), "no locum furniture");
  assert.ok(!primeText.includes(COPY.locumNote));
  assert.equal(s.startButton.hidden, false, "Start is on offer");

  s.controller.start();
  assert.equal(s.actDrill.hidden, false, "and it still enters the drill");
});

/* ── group 6: the source scans and CSS gates ───────────────────────────────────────────── */

/** Comments stripped before matching — the files describe the forbidden APIs in prose on
 *  purpose (brief.js:9-14's convention), and a scan that read comments would be satisfiable by
 *  rewording one. */
const withoutComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
const withoutHtmlComments = (source) => source.replace(/<!--[\s\S]*?-->/g, "");

const SESSION_JS = withoutComments(read("public/prep/session.js"));
const SESSION_HTML = withoutHtmlComments(read("public/prep/session.html"));
const SESSION_CSS = read("public/prep/session.css").replace(/\/\*[\s\S]*?\*\//g, "");

test("the scans are reading something, not an empty string", () => {
  assert.match(SESSION_JS, /initSession/);
  assert.match(SESSION_HTML, /act-drill/);
  assert.match(SESSION_CSS, /typing-dot/);
});

test("importing the module under Node is itself the assertion", () => {
  assert.equal(typeof initSession, "function");
  assert.equal(typeof globalThis.document, "undefined", "this suite runs with no DOM, on purpose");
});

test("neither the page nor its markup parses HTML or reaches browser storage", () => {
  for (const source of [SESSION_JS, SESSION_HTML]) {
    assert.doesNotMatch(
      source,
      /innerHTML|outerHTML|insertAdjacentHTML|document\.write|createContextualFragment/,
      "model output reaches this page; it is built with createElement and text nodes only",
    );
    assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|document\.cookie/);
  }
});

test("the answer travels in POST bodies only, never in a URL", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { token } = await seed(d1);
  const client = fakeClient();
  const s = await boot({ d1, client, token });
  s.controller.start();
  const marker = "a-string-that-must-never-reach-a-url";
  s.answer.value = marker;
  await s.controller.submitAttempt();
  for (const url of s.urls) {
    assert.ok(!url.includes(marker), `the answer leaked into ${url}`);
    assert.match(url, /^\/prep\/api\/(session|brief|turn)$/, `an unexpected URL shape: ${url}`);
  }
});

test("session.html carries every id the controller reads, and the caveat exactly once", () => {
  for (const id of SHELL_IDS) {
    assert.ok(SESSION_HTML.includes(`id="${id}"`), `session.html lost #${id}`);
  }
  assert.equal(
    count(SESSION_HTML, "Say your answer out loud first"),
    1,
    "the fidelity caveat is surfaced exactly once, from the markup",
  );
});

test("session.css carries no raw colour and no raw size", () => {
  assert.doesNotMatch(SESSION_CSS, /#[0-9a-fA-F]{3,8}\b/, "a raw hex belongs in tokens.css");
  const declarations = SESSION_CSS.replace(/@media[^{]*/g, "@media ");
  assert.doesNotMatch(declarations, /\d+px/, "a raw px belongs in tokens.css");
});

test("session.css keeps app.css's focus rule, and animates exactly one thing", () => {
  assert.doesNotMatch(SESSION_CSS, /outline\s*:\s*none/);
  assert.doesNotMatch(SESSION_CSS, /:focus/, "app.css owns the one focus rule for everything");
  assert.doesNotMatch(SESSION_CSS, /transition/, "nothing here transitions");
  // The one divergence from prep.css's gate, and this file's whole reason to exist: the typing
  // indicator. One @keyframes, no more.
  assert.equal(count(SESSION_CSS, "@keyframes"), 1, "exactly one animation: the typing indicator");
});

test("session.css restates no selector app.css or prep.css already owns", () => {
  const selectorsOf = (source) => {
    const found = new Set();
    for (const m of source.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(^|\}|\{)([^{}]*?)\s*\{/g)) {
      for (const part of m[2].split(",")) {
        const selector = part.trim();
        if (selector && !selector.startsWith("@")) found.add(selector);
      }
    }
    return found;
  };
  const taken = new Set([...selectorsOf(read("public/app.css")), ...selectorsOf(read("public/prep/prep.css"))]);
  const mine = selectorsOf(SESSION_CSS);
  assert.ok(mine.size > 0, "no selectors parsed out of session.css");
  const clashes = [...mine].filter((s) => taken.has(s) && !/^\d/.test(s));
  assert.deepEqual(clashes, [], `session.css restates: ${clashes.join(", ")}`);
});

/* ── group 7: the no-rank sweep and COPY completeness ──────────────────────────────────── */

test("a whole drilled page carries no score, rank, level, percentage or N-of-M", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { token } = await seed(d1);
  const client = fakeClient({ feedback: FEEDBACK_OK(2, "rambles") });
  const s = await boot({ d1, client, token });
  const { controller } = s;
  controller.start();
  await controller.openRung("nudged");
  for (let i = 0; i < 2; i += 1) {
    s.answer.value = "An answer to drill the page into a full state.";
    await controller.submitAttempt();
  }
  controller.closeSession();

  const html = serialize(s.body);
  const RANK_PATTERNS = [
    [/aria-valuenow/i, "a numeric value exposed to assistive technology"],
    [/progressbar/i, "a progressbar role"],
    [/<progress/i, "a progress element"],
    [/%/, "a percentage"],
    [/level|of \d/i, "a level, or an N-of-M"],
    [/\b\d\s*\/\s*5\b/, "an importance numeral"],
    // Key-shaped tokens only: "stage" and "rating" are legitimate English in a primer's prose,
    // and the route-level leak scan (prep-turn.test.js) already guards the keys structurally.
    [/success_rate|variant_of|failed_quote/i, "a score-shaped key"],
  ];
  for (const [pattern, why] of RANK_PATTERNS) {
    assert.doesNotMatch(html, pattern, `the drilled page carries ${why}`);
  }
});

test("every state the controller can enter has a non-empty string behind it", () => {
  for (const [key, value] of Object.entries(COPY)) {
    assert.equal(typeof value, "string", `COPY.${key} is not a string`);
    assert.ok(value.trim().length > 0, `COPY.${key} is empty`);
  }
});

/* ── group 8: the pr-37 review's findings — one test per fix, plus the unreached guards ── */

/** boot(), with a hand between the controller and the bridge — for the tests that need one
 *  response sabotaged while everything else stays real. */
async function bootIntercepted({ d1, client, token, intercept, navigate }) {
  const s = shell();
  const urls = [];
  const base = bridge({ d1, client, token, urls });
  const controller = initSession({
    doc: s.doc,
    fetchImpl: (url, opts) => intercept(base, url, opts),
    navigate,
  });
  await controller.ready;
  return { ...s, controller, urls };
}

test("M1: a drilled page holds no duplicate ids, and every aria-labelledby resolves to exactly one heading", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { token } = await seed(d1);
  const client = fakeClient();
  const s = await boot({ d1, client, token });
  const { controller } = s;
  controller.start();
  await controller.openRung("nudged");
  for (let i = 0; i < 2; i += 1) {
    s.answer.value = "An answer, so the transcript accumulates rendered entries.";
    await controller.submitAttempt();
  }

  // The hidden prime, two answered questions, two feedback notes and the live ladder are all
  // in the tree at once — exactly the state where restarted ids used to collide.
  const ids = findAll(s.body, (n) => n.attrs.id !== undefined).map((n) => n.attrs.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepEqual(dupes, [], `duplicate ids in the document: ${dupes.join(", ")}`);
  assert.ok(ids.some((id) => id.startsWith("prime-")), "prime rendered under its own prefix");
  assert.ok(ids.filter((id) => id.startsWith("entry-")).length >= 3, "each log entry got its own prefix");

  for (const node of findAll(s.body, (n) => n.attrs["aria-labelledby"] !== undefined)) {
    const target = node.attrs["aria-labelledby"];
    assert.equal(ids.filter((id) => id === target).length, 1, `${target} must name exactly one heading`);
  }
});

test("L1: resume at suggest-close turns lands in drill with the close already on offer", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { token } = await seed(d1);
  const client = fakeClient();

  const first = await boot({ d1, client, token });
  first.controller.start();
  for (let i = 0; i < 6; i += 1) {
    first.answer.value = "An answer, toward the close suggestion.";
    await first.controller.submitAttempt();
  }
  assert.equal(first.closeButton.hidden, false, "six turns earned the close");

  const second = await boot({ d1, client, token });
  assert.equal(second.actDrill.hidden, false, "landed in the drill");
  assert.equal(second.closeButton.hidden, false, "the GET's suggest_close is honoured on resume");
});

test("L2: a 200 whose body will not read gets the reload copy, not an invitation to double-send", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { token } = await seed(d1);
  let sabotaged = false;
  const s = await bootIntercepted({
    d1,
    client: fakeClient(),
    token,
    intercept: (base, url, opts) => {
      if (!sabotaged && String(url) === "/prep/api/turn") {
        sabotaged = true;
        return Promise.resolve(new Response("not json", { status: 200 }));
      }
      return base(url, opts);
    },
  });
  const { controller } = s;
  controller.start();

  const typed = "An answer whose outcome went missing mid-body.";
  s.answer.value = typed;
  await controller.submitAttempt();
  assert.equal(textOf(s.stateLine), COPY.turnUnclear, "the ok-but-unreadable case gets its own copy");
  assert.notEqual(textOf(s.stateLine), COPY.turnFailed);
  assert.equal(s.answer.value, typed, "the typed answer is still theirs");
  assert.equal(visibleYouEntries(s.log).length, 0, "the echo was withdrawn");
});

test("L3: an over-length answer is refused client-side with honest copy, nothing sent", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { token } = await seed(d1);
  const s = await boot({ d1, client: fakeClient(), token });
  const { controller } = s;
  controller.start();

  const huge = "x".repeat(20_001);
  s.answer.value = huge;
  await controller.submitAttempt();
  assert.equal(attemptCount(db), 0, "nothing reached the route");
  assert.equal(textOf(s.stateLine), COPY.tooLongGuard);
  assert.equal(s.answer.value, huge, "the paste is untouched, ready to trim");
  assert.equal(visibleYouEntries(s.log).length, 0, "no echo for a refused send");
});

test("L4: a close during an in-flight attempt stands — the late outcome paints nothing", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { token } = await seed(d1);
  const s = await boot({ d1, client: fakeClient(), token });
  const { controller } = s;
  controller.start();

  s.answer.value = "An answer overtaken by the wrap-up.";
  const flight = controller.submitAttempt();
  controller.closeSession();
  const closeText = textOf(s.closeBody);
  await flight;

  assert.equal(controller.state.phase, "closed", "the late outcome did not reopen the drill");
  assert.equal(s.actClose.hidden, false);
  assert.equal(textOf(s.closeBody), closeText, "the composed close is untouched");
  assert.equal(findAll(s.log, (n) => n.classes.includes("log-feedback")).length, 0, "no feedback painted behind it");
  assert.equal(textOf(s.stateLine), "", "no error line over the close");
  assert.equal(attemptCount(db), 1, "the attempt itself still landed server-side");
});

test("L5: a failed help fetch shows the retry copy, inflates no mode, and a reopen retries", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { token } = await seed(d1);
  let nudgeCalls = 0;
  const client = fakeClient({
    nudge: () => {
      nudgeCalls += 1;
      if (nudgeCalls === 1) throw new Error("boom");
      return wrap({ nudge: NUDGE_TEXT });
    },
  });
  const s = await boot({ d1, client, token });
  const { controller } = s;
  controller.start();

  await controller.openRung("nudged");
  assert.equal(textOf(controller.state.helpStates.nudge), COPY.helpFailed);
  assert.equal(controller.state.highestRung, "recall", "a failed fetch reaches no rung");
  assert.equal(controller.state.help.nudge, "idle", "the cache holds nothing to poison");

  await controller.openRung("nudged");
  assert.equal(nudgeCalls, 2, "the reopen retried");
  assert.ok(textOf(controller.state.panels.nudge).includes(NUDGE_TEXT), "and filled the panel");
  assert.equal(controller.state.highestRung, "nudged", "the rung counts once its content arrived");
});

test("L5: a 401 arriving mid-drill from the turn route means the login page, for help and attempt alike", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { token } = await seed(d1);
  let dead = false;
  const navigations = [];
  const s = await bootIntercepted({
    d1,
    client: fakeClient(),
    token,
    navigate: (url) => navigations.push(url),
    intercept: (base, url, opts) => {
      if (dead && String(url) === "/prep/api/turn") {
        return Promise.resolve(new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }));
      }
      return base(url, opts);
    },
  });
  const { controller } = s;
  controller.start();
  dead = true; // the session dies AFTER load: exactly the mid-drill case

  await controller.openRung("nudged");
  assert.deepEqual(navigations, ["/prep/login"], "a dead session's help lands on login");

  navigations.length = 0;
  s.answer.value = "An answer sent on a dead session.";
  await controller.submitAttempt();
  assert.deepEqual(navigations, ["/prep/login"], "a dead session's attempt lands on login");
  assert.equal(attemptCount(db), 0);
});

test("L5: a rung response landing after the drill moved on fills nothing and inflates nothing", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  const { token } = await seed(d1);
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const client = fakeClient({ nudge: () => gate });
  const s = await boot({ d1, client, token });
  const { controller } = s;
  controller.start();

  const flight = controller.openRung("nudged"); // in flight, gated
  s.answer.value = "An answer sent before the nudge ever arrived.";
  await controller.submitAttempt(); // the drill moves to the next question
  release(wrap({ nudge: NUDGE_TEXT }));
  await flight;

  assert.deepEqual(attemptModes(db), ["recall"], "the stale nudge inflated no mode");
  assert.equal(controller.state.highestRung, "recall");
  assert.equal(controller.state.help.nudge, "idle", "the new question's cache is untouched");
  assert.ok(!textOf(controller.state.panels.nudge).includes(NUDGE_TEXT), "the new panel stayed empty");
});
