/* The candidate's live practice surface (#24): prime → drill → close, over #23's two routes.
 *
 * A page controller in brief.js's idiom, composing registry.js's session components. State
 * comes from the server only: resume is GET /prep/api/session re-served, and nothing is ever
 * written to browser storage of any kind — not to any of the storage APIs, not to a cache. The
 * answer a candidate types lives in the DOM for the life of the turn and reaches exactly one
 * place, the POST body; it never appears in a URL, a log line or an error message. (Written
 * without the storage API names on purpose: the test's scan greps this file for them, and a
 * gate that cries wolf at a comment gets deleted.)
 *
 * MODULE DISCIPLINE: no document reads at module scope, so node --test can import this file
 * with no DOM at all (registry.js:37's reason). session.html boots it with an inline module
 * script; the test suite calls initSession with a document double and the real route handlers
 * behind fetchImpl.
 *
 * THE TWO VOCABULARIES, never crossed (turn.js's rule): a help request carries
 * `rung: "nudge" | "reveal"`; an attempt carries `mode: "recall" | "nudged" | "revealed"`. The
 * registry's onRung callback speaks mode-words ("nudged"/"revealed") because it reports what
 * the candidate REACHED; this file maps them to rung-words for the help POST and keeps the
 * highest rung reached as the eventual attempt's mode.
 *
 * LAZY RUNG FILL, by page-owned writes: HelpLadder renders from props at construction, but rung
 * content here arrives on demand from the turn route. The ladder is rendered with empty props
 * and this file fills the panels the registry built — pending, failed and filled are page
 * states, the same division brief.js draws. Filled content is cached per question so reopening
 * a rung never re-spends a model call.
 */

import { renderBlocks } from "./registry.js";

/** turn.js:61's cap, mirrored so an over-length paste is refused here with honest copy instead
 *  of bouncing off the route's 400 wearing retry advice that can never succeed. */
const ANSWER_MAX = 20_000;

/** Every visible string this file can produce, in one object — brief.js:25's idiom. Written
 *  for a first-time candidate: preparing, never evaluated. */
export const COPY = {
  loading: "Loading your practice…",
  notReady:
    "Your practice is not ready yet. Your recruiter is still putting your prep together, so " +
    "check back later today.",
  failed:
    "We could not load your practice just now. Reload the page, and if it still will not " +
    "load, reply to the email that invited you.",

  primeNote:
    "Leave whenever you need to. This page brings you back to where you stopped.",
  habitsHead: "Worth watching",
  lastImproved: "Last time, this improved: ",
  lastNext: "Next: ",
  doneForNow:
    "That is everything for now. Come back later and this page will pick up where you " +
    "stopped.",

  you: "You",
  movedOn: "You moved on without answering. That is allowed.",
  thinking: "Reading your answer",
  helpPending: "Working it out…",
  helpFailed: "We could not fetch that just now. Close it and open it again to retry.",
  emptyGuard:
    "Type your answer first. If you have opened the structure, you can send without typing " +
    "and move on.",
  tooLongGuard:
    "That answer is longer than we can take — around 20,000 characters is the most. An " +
    "interview answer is a few minutes of speech, so trim it to the part that matters.",
  turnFailed:
    "That did not go through. Your answer is back in the box below, so you can send it again.",
  turnUnclear:
    "We could not read what came back. Reload the page and it will bring you back to the " +
    "right place — your answer is below in case you need it.",
  noFeedback: "Nothing to look at this time. The next question is below.",
  habitLine: "A pattern worth knowing about: ",
  coveredPrefix: "Covered so far: ",

  dayBeforeIntro:
    "Your interview is tomorrow. This is a short run through what you already have — not new " +
    "practice.",
  dayBeforeNote:
    "Keep it brief and stop when the page suggests it. What you have is enough to work from.",

  locumNote:
    "There is no practice drill for this booking. This page is what we know that will help " +
    "you walk in prepared, and it stays here whenever you need it.",
  locumEmpty:
    "We have nothing extra to pass on for this booking yet. If you have a question, reply to " +
    "the email that invited you.",

  closeImproved: "What improved today",
  closeHonest:
    "Rates move over several attempts, and today's attempts are what move them. It will not " +
    "always feel like progress while it happens.",
  closeNext: "Queued for next time",
};

/** An element with its text set — registry.js's own helper, retyped because it is not part of
 *  the registry's export surface and four lines do not earn one. */
function el(doc, tag, className, content) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.appendChild(doc.createTextNode(String(content ?? "")));
  return node;
}

/**
 * Every element under `root` carrying `name` as a class, in document order.
 *
 * Deliberately not an id lookup: the ids the walker generates are unique per render only
 * because every renderBlocks call here seeds its own idPrefix, and the double's
 * getElementById only knows the shell's ids anyway. Walking the entry just rendered cannot
 * miss and depends on neither.
 * Works over both the real DOM and the test double: `children` is elements-only in a browser,
 * and the double's text nodes fall out on having no `className` and no `children` of their own.
 */
function findByClass(root, name, found = []) {
  for (const child of root.children ?? []) {
    if (typeof child.className === "string" && child.className.split(/\s+/).includes(name)) {
      found.push(child);
    }
    findByClass(child, name, found);
  }
  return found;
}

/** Take a node out of play. The test double records structure and cannot detach, so `hidden`
 *  carries the state there; in a browser the node leaves the document and its ids with it. */
function discard(node) {
  if (!node) return;
  if (typeof node.remove === "function") node.remove();
  node.hidden = true;
}

/**
 * The page controller.
 *
 * `doc` and `fetchImpl` default to the real document and fetch; `navigate` defaults to a
 * location replace (brief.js:67's reasoning — a candidate whose session has gone is a person
 * in front of a browser, and `replace` keeps the dead page out of Back's reach). All three are
 * injectable because the suite drives this module with no browser at all.
 *
 * Returns `{ state, start, openRung, submitAttempt, closeSession, ready }` — the DOM handlers
 * delegate to these, and the tests call them directly because the document double records
 * listeners without dispatching. `ready` settles when the initial load has routed.
 */
export function initSession({ doc, fetchImpl, navigate } = {}) {
  doc = doc ?? globalThis.document;
  const fetchFn = fetchImpl ?? ((...args) => globalThis.fetch(...args));
  const go = navigate ?? ((url) => globalThis.location.replace(url));

  const $ = (id) => doc.getElementById(id);
  const stateLine = $("session-state");
  const actPrime = $("act-prime");
  const primeMount = $("prime-blocks");
  const startButton = $("start");
  const actDrill = $("act-drill");
  const drillLog = $("drill-log");
  const progressLine = $("drill-progress");
  const form = $("answer-form");
  const answerBox = $("answer");
  const sendButton = $("send");
  const closeButton = $("close-drill");
  const actClose = $("act-close");
  const closeMount = $("close-body");

  const state = {
    phase: "loading", // loading | prime | drill | done | closed | not-ready | failed
    session: null, // the GET payload, as served
    currentQuestion: null, // {id, text}
    highestRung: "recall", // the eventual attempt's mode; reset per question
    help: { nudge: "idle", reveal: "idle" }, // idle | done — the per-question cache
    helpFlights: { nudge: null, reveal: null }, // in-flight promises, so a reopen never doubles
    panels: { nudge: null, reveal: null }, // the registry-built panels of the CURRENT ladder
    helpStates: { nudge: null, reveal: null }, // the page-owned pending/failed line per panel
    ladder: null, // the current HelpLadder section, discarded once its attempt lands
    covered: [], // competency labels, in order of first cover
    moved: [], // labels whose rate moved this session
    habits: [], // standing habits plus any announced this session
    inFlight: false, // one attempt at a time
    dayBefore: false, // the GET's day_before flag, fixed at load (#25)
    engagement: "other", // "locum" | "other" — the brief payload's flag, fixed at load (#50)
  };

  // Seeds each renderBlocks call's ids. The transcript accumulates entries and the hidden prime
  // keeps its own, so every render needs ids of its own or aria-labelledby resolves to the
  // first duplicate in the document — usually a heading the candidate cannot even see.
  let entrySeq = 0;
  const nextIdPrefix = () => `entry-${entrySeq++}`;

  /** The state line, in app.js's grammar. Assigned as a whole class string rather than
   *  toggled, so the document double's minimal class support can carry it. */
  function showState(message, isError) {
    stateLine.textContent = message;
    stateLine.className = `save-state is-shown${isError ? " is-error" : ""}`;
  }

  function clearState() {
    stateLine.textContent = "";
    stateLine.className = "save-state";
  }

  const postTurn = (body) =>
    fetchFn("/prep/api/turn", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    });

  /* ── load, resume, prime ─────────────────────────────────────────────────────────────── */

  async function load() {
    showState(COPY.loading, false);
    // The brief only feeds prime; its failure degrades prime and never touches the drill.
    const [sessionRes, briefRes] = await Promise.allSettled([
      fetchFn("/prep/api/session", { headers: { accept: "application/json" } }),
      fetchFn("/prep/api/brief", { headers: { accept: "application/json" } }),
    ]);

    if (sessionRes.status === "rejected") {
      state.phase = "failed";
      showState(COPY.failed, true);
      return;
    }
    const res = sessionRes.value;
    if (res.status === 401) {
      // The login page can explain itself; an error line on a page they cannot use cannot.
      go("/prep/login");
      return;
    }
    if (res.status === 404) {
      // A real state, not a failure: the handover has not been written yet.
      state.phase = "not-ready";
      showState(COPY.notReady, false);
      return;
    }
    let payload = null;
    if (res.ok) {
      try {
        payload = await res.json();
      } catch {
        payload = null;
      }
    }
    if (!payload || !Array.isArray(payload.competencies)) {
      state.phase = "failed";
      showState(COPY.failed, true);
      return;
    }

    state.session = payload;
    state.dayBefore = payload.day_before === true;
    state.habits = (Array.isArray(payload.habits) ? payload.habits : []).map(String);
    for (const competency of payload.competencies) {
      if (competency.covered) state.covered.push(String(competency.label));
      if (competency.moved) state.moved.push(String(competency.label));
    }

    let brief = null;
    if (briefRes.status === "fulfilled" && briefRes.value.ok) {
      try {
        brief = await briefRes.value.json();
      } catch {
        brief = null;
      }
    }

    // #50: a locum booking never drills. A brief that failed to load reads as "other" — the
    // fail-toward-existing-behaviour direction (#46 D2), since without the payload there is no
    // primer and no question list to compose anyway.
    state.engagement = brief?.engagement === "locum" ? "locum" : "other";

    clearState();
    // Resume: attempts under the gap mean this session is still live — land where they left,
    // with the close on offer if this session's turns had already earned it. A locum invite
    // never routes here even if an attempt row somehow exists: the UI never offers the drill,
    // so the guard would land them in a surface this booking does not have.
    if (payload.turns_this_session > 0 && state.engagement !== "locum") {
      enterDrill();
      if (payload.suggest_close) closeButton.hidden = false;
    } else {
      renderPrime(brief);
    }
  }

  function renderPrime(brief) {
    state.phase = "prime";
    const payload = state.session;

    // The locum prime (#50) is the whole visit, and it wins over day-before: for a booking,
    // "how do I get in tomorrow" IS the day-before content. Composed like the day-before
    // branch below — cherry-picked brief blocks plus a session-only block — and it never
    // enters the drill: no Start, no ProgressStrip, no habits, no last close.
    if (state.engagement === "locum") {
      const blocks = [];
      const primer = (brief?.blocks ?? []).find((b) => b && b.name === "FirstDayPrimer");
      if (primer) blocks.push({ name: "FirstDayPrimer", props: primer.props });
      const logistics = (brief?.blocks ?? []).find((b) => b && b.name === "LogisticsRail");
      if (logistics) blocks.push({ name: "LogisticsRail", props: logistics.props });

      const groups = { client: [], competency: [], screening: [] };
      for (const question of Array.isArray(brief?.questions) ? brief.questions : []) {
        const type = question?.type === "client" || question?.type === "screening"
          ? question.type
          : "competency";
        groups[type].push(String(question?.text ?? ""));
      }
      if (groups.client.length || groups.competency.length || groups.screening.length) {
        blocks.push({ name: "LocumQuestions", props: groups });
      }

      renderBlocks({ blocks, competencies: [] }, primeMount, { doc, idPrefix: "prime" });
      // An honest line either way: what this page is when it holds something, and that there
      // is nothing yet when it does not — never a blank prime.
      primeMount.appendChild(
        el(doc, "p", "prep-caption", blocks.length ? COPY.locumNote : COPY.locumEmpty),
      );

      state.phase = "done";
      startButton.hidden = true;
      actPrime.hidden = false;
      return;
    }

    // The day-before prime (#25) is a run-through's, not a drill's: the practical details
    // first, then the day-before block, then the start button — no PrimerCard (no
    // re-priming the day before), no progress, no habits, no last close.
    if (state.dayBefore) {
      const blocks = [];
      const logistics = (brief?.blocks ?? []).find((b) => b && b.name === "LogisticsRail");
      if (logistics) blocks.push({ name: "LogisticsRail", props: logistics.props });
      blocks.push({
        name: "DayBeforeMode",
        props: {
          intro: COPY.dayBeforeIntro,
          focus: (Array.isArray(payload.day_before_focus) ? payload.day_before_focus : []).map(String),
          note: COPY.dayBeforeNote,
        },
      });
      renderBlocks({ blocks, competencies: [] }, primeMount, { doc, idPrefix: "prime" });

      if (!payload.next_question) {
        state.phase = "done";
        startButton.hidden = true;
        primeMount.appendChild(el(doc, "p", "prep-caption", COPY.doneForNow));
      }
      actPrime.hidden = false;
      return;
    }

    const blocks = [];
    const primer = (brief?.blocks ?? []).find((b) => b && b.name === "PrimerCard");
    if (primer) blocks.push({ name: "PrimerCard", props: primer.props });
    blocks.push({
      name: "ProgressStrip",
      props: {
        covered: state.covered,
        queued: (payload.last_close?.queued ?? []).map(String),
        note: COPY.primeNote,
      },
    });
    renderBlocks({ blocks, competencies: [] }, primeMount, { doc, idPrefix: "prime" });

    if (state.habits.length) {
      primeMount.appendChild(el(doc, "p", "prep-label", COPY.habitsHead));
      const list = el(doc, "ul", "prep-list");
      for (const habit of state.habits) list.appendChild(el(doc, "li", null, habit));
      primeMount.appendChild(list);
    }

    const lastClose = payload.last_close;
    if (lastClose && (lastClose.improved || lastClose.next)) {
      let line = "";
      if (lastClose.improved) line += `${COPY.lastImproved}${lastClose.improved.label}. `;
      if (lastClose.next) line += `${COPY.lastNext}${lastClose.next.label}.`;
      primeMount.appendChild(el(doc, "p", "prep-caption", line.trim()));
    }

    if (!payload.next_question) {
      // The engine has nothing to serve and nothing to mint: say so instead of offering a
      // Start that leads to a dead form.
      state.phase = "done";
      startButton.hidden = true;
      primeMount.appendChild(el(doc, "p", "prep-caption", COPY.doneForNow));
    }

    actPrime.hidden = false;
  }

  function start() {
    if (state.phase !== "prime") return;
    actPrime.hidden = true;
    enterDrill();
  }

  function enterDrill() {
    state.phase = "drill";
    actDrill.hidden = false;
    updateProgress();
    const next = state.session.next_question;
    if (next) renderQuestion(next);
    else doneForNow();
  }

  /* ── the drill loop ──────────────────────────────────────────────────────────────────── */

  /** Ask cold: the card renders the question and nothing else — no label, no difficulty, no
   *  hint. The ladder renders empty beside it and waits to be asked. */
  function renderQuestion(question) {
    state.currentQuestion = { id: String(question.id), text: String(question.text) };
    state.highestRung = "recall";
    state.help = { nudge: "idle", reveal: "idle" };
    state.helpFlights = { nudge: null, reveal: null };

    const entry = el(doc, "div", "log-entry log-interviewer");
    renderBlocks(
      {
        blocks: [
          { name: "QuestionCard", props: { question: state.currentQuestion.text } },
          { name: "HelpLadder", props: {} },
        ],
        competencies: [],
      },
      entry,
      { doc, onRung: (rung) => openRung(rung), idPrefix: nextIdPrefix() },
    );

    // The registry appends the nudge rung first and the structure rung second; the panels
    // arrive in that order. Each gets a page-owned status line for pending/failed copy.
    const panels = findByClass(entry, "help-panel");
    state.panels = { nudge: panels[0] ?? null, reveal: panels[1] ?? null };
    state.helpStates = { nudge: null, reveal: null };
    for (const kind of ["nudge", "reveal"]) {
      const panel = state.panels[kind];
      if (!panel) continue;
      const status = el(doc, "p", "prep-caption help-state");
      status.setAttribute("role", "status");
      panel.appendChild(status);
      state.helpStates[kind] = status;
    }
    state.ladder = findByClass(entry, "block")[1] ?? null;

    drillLog.appendChild(entry);
  }

  /**
   * A rung opened. `rungName` is the registry's mode-word ("nudged" | "revealed"); the POST
   * speaks rung-words. Returns the in-flight promise so a re-open joins rather than doubles,
   * and so the tests can await the fill.
   */
  function openRung(rungName) {
    const kind = rungName === "revealed" ? "reveal" : "nudge";
    if (!state.currentQuestion) return Promise.resolve();
    if (state.helpFlights[kind]) return state.helpFlights[kind];
    if (state.help[kind] === "done") return Promise.resolve();
    const flight = fetchHelp(kind).finally(() => {
      state.helpFlights[kind] = null;
    });
    state.helpFlights[kind] = flight;
    return flight;
  }

  async function fetchHelp(kind) {
    const question = state.currentQuestion;
    const panel = state.panels[kind];
    const status = state.helpStates[kind];
    if (!panel || !status) return;

    status.textContent = COPY.helpPending;
    try {
      const res = await postTurn({ action: "help", question_id: question.id, rung: kind });
      if (res.status === 401) {
        go("/prep/login");
        return;
      }
      if (!res.ok) throw new Error(`help: ${res.status}`);
      const body = await res.json();
      // The drill moved on while this was in flight: the panel this would fill is spent.
      if (state.currentQuestion?.id !== question.id) return;

      status.textContent = "";
      if (kind === "nudge") {
        panel.appendChild(el(doc, "p", "prep-body", body.nudge));
      } else {
        const list = findByClass(panel, "prep-list")[0];
        for (const item of Array.isArray(body.skeleton) ? body.skeleton : []) {
          list.appendChild(el(doc, "li", null, item));
        }
      }
      state.help[kind] = "done";
      // The rung was REACHED only once its content arrived; a failed fetch showed nothing
      // and honestly changes no mode. `revealed` outranks `nudged`.
      if (kind === "reveal") state.highestRung = "revealed";
      else if (state.highestRung !== "revealed") state.highestRung = "nudged";
    } catch {
      if (state.currentQuestion?.id === question.id) status.textContent = COPY.helpFailed;
    }
  }

  async function submitAttempt() {
    if (state.inFlight || !state.currentQuestion) return;
    const answerText = String(answerBox.value ?? "");
    // The mirror of the server's rule: empty is legal only on a revealed turn.
    if (!answerText.trim() && state.highestRung !== "revealed") {
      showState(COPY.emptyGuard, true);
      if (typeof answerBox.focus === "function") answerBox.focus();
      return;
    }
    // The mirror of turn.js's other rule: over the cap, the server would 400 whatever we said.
    if (answerText.length > ANSWER_MAX) {
      showState(COPY.tooLongGuard, true);
      if (typeof answerBox.focus === "function") answerBox.focus();
      return;
    }

    clearState();
    state.inFlight = true;
    sendButton.setAttribute("aria-disabled", "true");

    // The optimistic echo: the answer as a "you" entry, in the DOM only, withdrawn if the
    // turn fails. Then the indicator — words first, dots beside them.
    const you = el(doc, "div", "log-entry log-you");
    you.appendChild(el(doc, "p", "prep-label", COPY.you));
    if (answerText.trim()) you.appendChild(el(doc, "p", "prep-body", answerText));
    else you.appendChild(el(doc, "p", "prep-caption", COPY.movedOn));
    drillLog.appendChild(you);
    answerBox.value = "";

    const typing = el(doc, "p", "typing prep-caption");
    typing.setAttribute("role", "status");
    typing.appendChild(doc.createTextNode(COPY.thinking));
    for (let i = 0; i < 3; i += 1) typing.appendChild(el(doc, "span", "typing-dot", "."));
    drillLog.appendChild(typing);

    let res = null;
    try {
      res = await postTurn({
        action: "attempt",
        question_id: state.currentQuestion.id,
        mode: state.highestRung,
        answer_text: answerText,
      });
    } catch {
      res = null;
    }

    discard(typing);
    state.inFlight = false;
    sendButton.setAttribute("aria-disabled", "false");

    // "Wrap up" was clicked while this was in flight: the close is composed and on screen, and
    // a late outcome painting over it — a next question, an error line — would reopen a drill
    // the candidate has left. The attempt itself already landed server-side, and the next
    // visit's prime (the authoritative close) will count it.
    if (state.phase === "closed") return;

    if (res && res.status === 401) {
      go("/prep/login");
      return;
    }

    let body = null;
    if (res && res.ok) {
      try {
        body = await res.json();
      } catch {
        body = null;
      }
    }
    if (!body) {
      // The no-state guarantee holds for non-2xx only: a failed turn left nothing behind, so
      // a plain retry is safe. A 2xx whose body would not read is different — the server may
      // already hold the attempt, so the copy sends them through a reload (resume re-serves
      // the true position) rather than inviting a second, double-counted send. Either way the
      // echo is withdrawn and the typed answer goes back where it was (login.js note 4).
      discard(you);
      answerBox.value = answerText;
      showState(res && res.ok ? COPY.turnUnclear : COPY.turnFailed, true);
      return;
    }

    // The ladder was this question's; the transcript keeps the question, the answer and the
    // feedback.
    discard(state.ladder);
    state.ladder = null;

    renderOutcome(body);
  }

  function renderOutcome(body) {
    if (body.feedback) {
      const entry = el(doc, "div", "log-entry log-feedback");
      renderBlocks(
        {
          blocks: [
            {
              name: "FeedbackNote",
              // The key mapping: the route says `improvement`, the component takes `improve`.
              props: { worked: body.feedback.worked, improve: body.feedback.improvement },
            },
          ],
          competencies: [],
        },
        entry,
        { doc, idPrefix: nextIdPrefix() },
      );
      drillLog.appendChild(entry);
      // Move focus to the feedback heading. Negative tabindex only: focusable, never in the
      // tab order.
      const head = findByClass(entry, "block-head")[0];
      if (head) {
        head.setAttribute("tabindex", "-1");
        if (typeof head.focus === "function") head.focus();
      }
    } else {
      // An empty revealed attempt earns no invented praise: a quiet line, and on.
      drillLog.appendChild(el(doc, "p", "prep-caption", COPY.noFeedback));
    }

    if (body.habit) {
      drillLog.appendChild(el(doc, "p", "prep-caption", `${COPY.habitLine}${body.habit}`));
      state.habits.push(String(body.habit));
    }

    const competency = body.competency ?? {};
    const label = String(competency.label ?? "");
    if (label && !state.covered.includes(label)) state.covered.push(label);
    if (competency.moved && label && !state.moved.includes(label)) state.moved.push(label);
    updateProgress();

    if (body.suggest_close) closeButton.hidden = false;

    if (body.next_question) renderQuestion(body.next_question);
    else doneForNow();
  }

  /** Names only, never a count of names: a tally reads as a score. */
  function updateProgress() {
    progressLine.textContent = state.covered.length
      ? `${COPY.coveredPrefix}${state.covered.join(", ")}`
      : "";
  }

  function doneForNow() {
    state.phase = "done";
    state.currentQuestion = null;
    form.hidden = true;
    drillLog.appendChild(el(doc, "p", "prep-caption", COPY.doneForNow));
    closeButton.hidden = false;
  }

  /* ── close ───────────────────────────────────────────────────────────────────────────── */

  /**
   * Composed client-side from this session's own turns: the engine has no close action — it
   * derives sessions from the attempt gap, and the authoritative close payload is what the
   * NEXT visit's prime shows as `last_close`. No timer anywhere.
   */
  function closeSession() {
    state.phase = "closed";
    actDrill.hidden = true;

    closeMount.textContent = "";
    if (state.moved.length) {
      closeMount.appendChild(el(doc, "p", "prep-label", COPY.closeImproved));
      closeMount.appendChild(el(doc, "p", "prep-body", state.moved.join(", ")));
    } else {
      // SPEC's "say so, because it won't feel like progress": the honest line, not silence.
      closeMount.appendChild(el(doc, "p", "prep-body", COPY.closeHonest));
    }
    // No "queued for next time" the day before — there is no next time (#25).
    if (state.currentQuestion && !state.dayBefore) {
      closeMount.appendChild(el(doc, "p", "prep-label", COPY.closeNext));
      closeMount.appendChild(el(doc, "p", "prep-body", state.currentQuestion.text));
    }
    if (state.habits.length) {
      closeMount.appendChild(el(doc, "p", "prep-label", COPY.habitsHead));
      const list = el(doc, "ul", "prep-list");
      for (const habit of state.habits) list.appendChild(el(doc, "li", null, habit));
      closeMount.appendChild(list);
    }

    actClose.hidden = false;
  }

  /* ── wiring ──────────────────────────────────────────────────────────────────────────── */

  startButton.addEventListener("click", () => start());
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submitAttempt();
  });
  closeButton.addEventListener("click", () => closeSession());

  const controller = { state, start, openRung, submitAttempt, closeSession };
  controller.ready = load();
  return controller;
}
