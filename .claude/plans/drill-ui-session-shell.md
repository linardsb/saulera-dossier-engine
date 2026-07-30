# Feature: Drill UI — session shell, help ladder, feedback, resume (#24)

The following plan should be complete, but validate documentation and codebase patterns and task
sanity before you start implementing. Pay special attention to naming of existing utils, types and
models — import from the right files.

**Branch note first.** #23 (PR 35) is merged on `origin/main` but local `main` is stale, and this
worktree may be shared by parallel sessions ([[parallel-sessions-share-worktree]]). Before any
work: `git fetch origin && git switch -c feature/drill-ui origin/main`, and verify the branch
again before every commit.

## Feature Description

The candidate's live practice surface: `/prep/session`, the fixed prime → drill → close shell
wired to #23's session engine. QuestionCard asked cold; the typed-answer form with the fidelity
caveat surfaced once; HelpLadder's rungs fetched on request only and visually staged; FeedbackNote
rendering the structured feedback; ProgressStrip movement; a habit announced the moment it becomes
a pattern; resumable mid-session via the invite cookie. Request/response only (decision 19) — the
turn round-trip must never read as dead air (optimistic echo of the answer, a typing indicator, a
live-region announcement when feedback lands).

## User Story

As a candidate with an interview coming up
I want to practise answering real questions and get one specific improvement per answer
So that I walk in ready, without ever being scored, ranked, or handed an answer that isn't mine.

## Problem Statement

#23 built the whole engine — targeting, the answer loop, help minting, readiness, habits — but the
only candidate-facing page is the static brief dashboard (#21). There is no page a candidate can
practise on. The two engine routes (`GET /prep/api/session`, `POST /prep/api/turn`) have no caller
outside the test suite.

## Solution Statement

A new page pair `public/prep/session.html` + `session.js` (ES module, same idiom as
`registry.js`: no document reads at module scope, exported `initSession` so `node --test` can
drive it), composing #21's registry components (`QuestionCard`, `HelpLadder`, `FeedbackNote`,
`ProgressStrip`) into a three-act shell, plus a new `public/prep/session.css` for the shell's own
vocabulary (a separate file because `prep.css` sits behind a no-animation test gate and the typing
indicator needs motion). State comes from the server only: resume is `GET /prep/api/session`
re-served, not browser storage — nothing is ever written to browser storage.

## Out of Scope / Non-Goals

- Not included: DayBeforeMode's flow, the reminder email, day-before session (#25 owns those; the
  `DayBeforeMode` constructor stays unused here).
- Not included: streaming/SSE (decision 19 — later polish ticket), voice (decision 5), pressure
  mode (SPEC — post-pilot).
- Not changing: the engine routes (`functions/prep/api/session.js`, `turn.js`) — this ticket is a
  pure consumer. If a UI need seems to require a route change, that's an Open Question, not an edit.
- Not changing: `registry.js`'s constructors. The session page composes them; lazy rung content is
  filled by page-owned DOM writes into the panels the registry built (see NOTES), not by editing
  `HelpLadder`.
- Not building: a session table, a "close" server action, or any persistence of ladder state. The
  engine derives sessions from attempt-gap arithmetic; the UI honours that.

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: High (most of it is craft + wiring, not algorithms)
**Primary Systems Affected**: `public/prep/` (new page), `test/`
**Dependencies**: none new. `@anthropic-ai/sdk` is only ever touched server-side by #23's routes.

## Related Work

**Implements**: GitHub issue #24 (`Closes #24` in the PR) · **Epic**: #16,
`docs/epics/candidate-portal.architecture.md` (decisions 5, 8, 19, 21 govern this ticket)

**Back-references**:
- `.claude/plans/prep-component-registry-and-brief-dashboard.md` — the registry contract, the
  fake-DOM test philosophy (its R1: keyboard/focus are checked by hand, never faked)
- `.claude/plans/session-engine-targeting-answer-loop.md` — the two routes' shapes and invariants

**Forward-references**:
- (#25 will reuse this shell for the day-before session)

---

## CONTEXT REFERENCES

### Relevant Codebase Files — READ THESE BEFORE IMPLEMENTING

- `functions/prep/api/session.js` (whole file, 123 lines) — Why: the resume contract. Response:
  `{ competencies: [{id,label,covered,moved}], next_question: {id,text}|null, habits: [string],
  last_close: {improved:{id,label}|null, next:{id,label}|null, queued:[string]}|null,
  turns_this_session: number, suggest_close: bool }`. 404 = handover not written ("not ready"),
  401 = no session.
- `functions/prep/api/turn.js` (whole file, 223 lines) — Why: the turn contract and its exact
  validation. `{action:"help", question_id, rung:"nudge"|"reveal"}` → `{nudge}` or `{skeleton}`.
  `{action:"attempt", question_id, mode:"recall"|"nudged"|"revealed", answer_text}` →
  `{ feedback:{worked,improvement}|null, habit:string|null, next_question:{id,text}|null,
  competency:{id,label,moved}, turns_this_session, suggest_close }`. Empty `answer_text` is legal
  ONLY with `mode:"revealed"`. Extra body fields are a 400. POST needs same-origin (browser fetch
  passes automatically). `rung` and `mode` are different vocabularies — never send both.
- `public/prep/registry.js` (lines 44–60, 97–116, 371–510, 552–632) — Why: the four components
  this page composes; `renderBlocks(payload, mount, {doc, onRung})` and its return; `HelpLadder`'s
  panels get ids `${blockId}-nudge` / `${blockId}-structure` and `onRung("nudged"|"revealed")`
  fires on the way open only. `FeedbackNote` props are `{worked, improve}` — note the turn route
  says `improvement`; the page maps it.
- `public/prep/brief.js` (whole file, 102 lines) — Why: the page-controller idiom to mirror —
  COPY object, `showState`/`clearState` on `.save-state`, the 401→`location.replace("/prep/login")`
  never-settling promise, 404 as a real state, text-only DOM writes.
- `public/prep/brief.html` (whole file) — Why: the document skeleton to mirror — head order
  `fonts.css → tokens.css → app.css → prep.css`, topbar, `.page-head`, `role="status"` state line,
  privacy footer, module script.
- `public/prep/prep.css` (whole file, 175 lines) — Why: the vocabulary already available
  (`.block`, `.prep-lede/-body/-label/-caption/-list`, `.help-rung`, `.help-panel[hidden]`), and
  the header contract: supplement `app.css`, never restate it.
- `src/prep/session.js` — Why: `requireSession` semantics; the page never sees the cookie
  (HttpOnly) so signed-in state is learned only from the API's status code.
- `src/http.js` (lines 17–56) — Why: `readJson` rejects non-object bodies; `sameOrigin` logic;
  error body shape `{error: code}`.
- `test/prep-turn.test.js` (lines 1–120) — Why: THE integration harness to reuse — `openMigrated`
  real-sqlite D1, `createInvite`/`persistHandover`, `mintToken`+`SESSION_COOKIE` cookie auth,
  `fakeClient` answering by schema, `at()` for timestamps.
- `test/prep-registry.test.js` (lines 1–60, 140–200, 760–830) — Why: the fake-DOM render pattern,
  the source-scan gates (no HTML parsing, no browser-storage names **even in comments** — the
  scans strip comments, but brief.js's header shows the convention: describe the rule without
  naming the APIs), the prep.css gates to mirror for session.css, the positive-tabindex scan that
  already covers every file in `public/prep/` including the new ones.
- `test/helpers/dom.js` (whole file, 127 lines) — Why: what the fake DOM can and cannot do.
  `node.listeners.click[0]()` is the sanctioned way to reach a handler; no dispatch, no focus, no
  layout. A test needing more is checked by hand instead (plan R1 of #21).
- `docs/epics/interview-prep/SPEC.md` — Why: session shape (lines 55–64), answer loop (66–81,
  incl. the typed-fidelity caveat), tone (182–188), "no streaks" and never-a-rank rules.
- `docs/epics/candidate-portal.architecture.md` (§2 decisions 5, 8, 19, 21; §3; §6 last bullet) —
  Why: the inherited calls this plan does not reopen, and "the felt experience" risk this ticket
  exists to retire.
- `.claude/skills/dossier-design/references/CRAFT.md` and `CHECKLIST.md` — Why: read CRAFT before
  writing session.css; run CHECKLIST before committing. Contrast gates live in
  `test/tokens.test.js` and hold automatically if every colour resolves through `tokens.css`.

### New Files to Create

- `public/prep/session.html` — the shell document (three acts, answer form, state line)
- `public/prep/session.js` — ES module page controller; exports `initSession`, `COPY`
- `public/prep/session.css` — shell-only vocabulary incl. the typing indicator (the ONE animated
  thing; app.css:1005's global reduced-motion guard neutralises it for free)
- `test/prep-session-ui.test.js` — fake-DOM + real-routes integration suite

### Files to Update

- `public/prep/brief.html` — one static link into the session ("Practise for it" — an `<a>` in the
  page head area, styled with existing classes). Without it the new page is unreachable.
- `test/prep-registry.test.js` — nothing structural; its tabindex scan already covers new files.

### Patterns to Follow

**COPY object** — every visible string in one `const COPY = {...}` at the top (registry.js:67,
brief.js:25, login.js). Write for a first-time candidate, en-GB, the SPEC's tone: preparing, never
evaluated. No exclamation marks, no streak language.

**Text-only DOM** — `createElement` + text nodes / `textContent` only. The scans fail the build on
`innerHTML|outerHTML|insertAdjacentHTML|document.write|createContextualFragment`.

**No browser storage, nothing candidate-shaped in the URL** — brief.js decisions 1–2. The scans
grep for the API names; keep them out of comments too (describe, don't name — brief.js:9–14).

**Module discipline** — no document reads at module scope (registry.js:37's reason: `node --test`
imports with no DOM). `session.html` boots it with an inline module script:
`import { initSession } from "/prep/session.js"; initSession();`

**State line** — `.save-state` + `role="status"`, `showState/clearState` per brief.js:47–57.

**Error → person mapping** — 401 → `location.replace("/prep/login")`; 404 → "not ready yet" copy;
anything else → the failed copy with reload advice (brief.js:61–102).

**CSS** — every colour/size through a `tokens.css` custom property; no `:focus` rules (app.css owns
the one focus rule); no selector app.css or prep.css already declares; wide content scrolls in its
own box (`min-width:0`, `overflow-wrap:anywhere` — prep.css shows every case).

---

## IMPLEMENTATION PLAN

### Phase 1: The shell document and static skeleton

`session.html`: mirror brief.html's head and chrome. `<main class="session">` holds three
`<section>` landmarks — `#act-prime`, `#act-drill`, `#act-close` — each `aria-labelledby` its own
heading, each `hidden` until its act (the `[hidden]{display:none}` guard from prep.css:155 must be
mirrored in session.css for any panel given its own display). The drill act contains: `#drill-log`
(an `aria-live="polite"` region the question/feedback/habit blocks append into), the answer form
(`<form id="answer-form">` with a labelled `<textarea>`, a submit `<button class="btn">`, and the
fidelity caveat as a `.prep-caption` — static in the markup, which is what "surfaced once" means
operationally), and a close button that stays hidden until `suggest_close`.

### Phase 2: The controller — load, resume, prime

`session.js`: `initSession({ doc, fetchImpl } = {})` resolves defaults
(`globalThis.document`/`fetch`), fetches `GET /prep/api/session` and `GET /prep/api/brief` in
parallel (brief only feeds prime; its failure degrades prime, never the drill). Routing on the
session payload:
- 401 → login redirect (brief.js's never-settling pattern)
- 404 → "not ready yet" state, stop
- `turns_this_session > 0` → **resume**: skip prime, enter drill directly with `next_question`
  ("land where you left")
- else → **prime** (2–3 min, SPEC): render the brief's `PrimerCard` block only (filter
  `payload.blocks` by name, hand to `renderBlocks`), then a `ProgressStrip` composed from session
  data (`covered`/`moved` labels; queued from `last_close.queued`), the standing habit lines, and —
  if `last_close` — the previous close ("Last time: <improved.label> improved. Next:
  <next.label>."). A "Start" button moves to drill. If `next_question` is null and no mint is
  possible (engine returned null), show an honest done-for-now state instead of the form.

`initSession` returns a controller object `{ state, start, openRung, submitAttempt, closeSession }`
— the DOM handlers delegate to these; the test suite calls them (and reaches handlers via
`node.listeners`) because the fake DOM does not dispatch.

### Phase 3: The drill loop

**Ask cold**: render `QuestionCard` via `renderBlocks` with props `{question: next_question.text}`
(no label/difficulty on the session GET's projection — the card renders question-only, which IS
cold). Track `currentQuestion = {id, text}` and `highestRung = "recall"` (reset per question).

**HelpLadder, on request only**: render `HelpLadder` with empty props and an `onRung` callback.
On first open of a rung for the current question: write the "thinking" placeholder into the panel
(`doc.getElementById(`${blockId}-nudge`)` / `-structure` — the walker's generated ids), POST
`{action:"help", question_id, rung}` (`"nudged"`→`"nudge"`, `"revealed"`→`"reveal"`), then fill the
panel with page-owned text nodes (nudge: one `.prep-body` paragraph; structure: `li`s appended into
the panel's existing `ul`). Cache per question so reopening never re-spends a model call. Update
`highestRung` (`revealed` outranks `nudged`). On fetch failure: panel shows the retry copy; rung
stays reopenable.

**Attempt**: on submit — client-side guard: empty text allowed only when `highestRung ===
"revealed"` (mirror of turn.js:92). Optimistic UI, in order: append the candidate's answer as a
"you" entry in the log (text node; it lives in the DOM only), clear + disable the form, show the
typing indicator (`role="status"` text + animated dots). POST
`{action:"attempt", question_id, mode: highestRung, answer_text}`. On response: remove indicator;
render `FeedbackNote` via registry with `{worked: feedback.worked, improve: feedback.improvement}`
(the key mapping!) — or, for a null feedback (empty revealed attempt), a quiet caption instead;
if `habit` non-null, one `.prep-caption` line ("A pattern worth knowing about: <habit>"); update the
progress rail from `competency.moved`; render the next `QuestionCard` from `next_question` (null →
the done-for-now close nudge); reveal the close button when `suggest_close`. Move focus to the new
feedback section heading (`tabindex="-1"` on it — the scan only forbids positive values). On error:
re-enable the form **with the typed answer restored** (login.js note 4's principle), state-line
error copy; the server guarantees nothing double-counted, so plain retry is safe.

### Phase 4: Close

**Independent of:** Phase 3's model-call paths (composable from data already in hand).

There is no close action server-side — the engine derives sessions from the 30-minute gap. The
close act is composed client-side from this session's own turn responses: one thing that improved
(first competency whose `moved` came back true; else the honest "rates move over several attempts —
today's attempts are what move them" line per SPEC's "say so, because it won't feel like progress"),
what's next (the last `next_question`'s text as "queued for next time"), the standing habits, and a
link back to `/prep/brief`. The authoritative `closePayload` is what the NEXT visit's prime shows
via `last_close`. No timer anywhere; the resumable line ("Leave any time — this page brings you
back to where you stopped") is the shape's surface.

### Phase 5: session.css + the brief link

The shell vocabulary: act spacing (reuse `.block` rhythm), the you/interviewer log entries
(distinguish by indent + `.prep-label` speaker line, never colour alone), the answer form, the
typing indicator (three dots, `@keyframes` opacity pulse — the one animation, neutralised by
app.css:1005 under reduced motion; the indicator also always carries its text so motion is never
the only signal). Every value through tokens. Then the one-line link in brief.html.

### Phase 6: Tests

See TESTING STRATEGY. The integration suite wires `initSession`'s `fetchImpl` to the REAL route
handlers over real-sqlite D1 with the fake Anthropic client — the acceptance's "full session runs
end to end against #23 on fixtures", executed literally.

---

## STEP-BY-STEP TASKS

### CREATE public/prep/session.html

- **IMPLEMENT**: shell per Phase 1. `lang="en-GB"`, `noindex`, the four-stylesheet head plus
  `/prep/session.css`, topbar, page-head with `role="status"` state line, three hidden act
  sections, drill log region, answer form with static fidelity caveat, hidden close button,
  privacy footer, inline module boot script.
- **PATTERN**: `public/prep/brief.html` (whole file)
- **GOTCHA**: no positive tabindex anywhere (scanned); the caveat is in the markup so it appears
  exactly once and no JS decides when.
- **VALIDATE**: `node --test test/prep-session-ui.test.js` (shell assertions, once tests exist);
  interim: `python3 -c "import pathlib;print('ok' if 'session.css' in pathlib.Path('public/prep/session.html').read_text() else 'missing')"`
- **SATISFIES**: keyboard-only pass groundwork, fidelity caveat AC

### CREATE public/prep/session.js

- **IMPLEMENT**: Phases 2–4 in one module. Exports: `COPY`, `initSession`. No module-scope
  document reads. All fetches through the injected `fetchImpl`; all DOM through the injected
  `doc`. Registry components via `renderBlocks` with `{doc, onRung}`; page-owned writes only for
  rung fill, the you-entry, the habit line, and state copy.
- **PATTERN**: `public/prep/brief.js` (controller idiom), `public/prep/registry.js` (module
  discipline, `el`-style helpers), `functions/prep/api/turn.js` (the exact request vocabulary)
- **IMPORTS**: `import { renderBlocks } from "./registry.js";` — nothing else
- **GOTCHA**: `feedback.improvement` → prop `improve`. `rung` vs `mode` never cross. Empty answer
  only when revealed. Never place `answer_text` in a URL, a log line, or an error message. No
  browser-storage API names even in comments.
- **VALIDATE**: `node --test test/prep-session-ui.test.js`
- **SATISFIES**: full-session AC, resume AC, ladder-mode AC, no-dead-air requirement

### CREATE public/prep/session.css

- **IMPLEMENT**: Phase 5 vocabulary. Header comment stating its relationship to prep.css and why
  it exists as a separate file (the animation gate).
- **PATTERN**: `public/prep/prep.css` (header contract, tokens discipline, the `[hidden]` guard)
- **GOTCHA**: no `:focus`, no raw hex/px in declarations, no selector app.css/prep.css declares,
  `overflow-wrap:anywhere` on anything model text reaches.
- **VALIDATE**: `node --test test/prep-session-ui.test.js` (the mirrored CSS gates below)
- **SATISFIES**: contrast-gates AC (via tokens), Quantum-feel staging

### UPDATE public/prep/brief.html

- **IMPLEMENT**: one `<a class="btn" href="/prep/session">` with candidate-plain copy ("Practise
  for it") in the page head region.
- **GOTCHA**: an `<a>`, not a `<button>` — it navigates. Surgical: nothing else in the file moves.
- **VALIDATE**: `rg -c "prep/session" public/prep/brief.html` → 1
- **SATISFIES**: reachability of the whole feature

### CREATE test/prep-session-ui.test.js

- **IMPLEMENT**: the groups in TESTING STRATEGY. Build the `fetchImpl` bridge: a function mapping
  `(url, opts)` → construct a `Request` with the session cookie → dispatch to the imported
  `onRequestGet`/`onRequestPost` handlers with `{env, data:{client: fakeClient()}}` → return the
  `Response`. Reuse `openMigrated`, `createInvite`, `persistHandover`, `mintToken`, `at` from the
  existing helpers; reuse `fakeClient` (copy the ~40-line factory from prep-turn.test.js rather
  than exporting it — test files don't import each other here).
- **PATTERN**: `test/prep-turn.test.js` (harness), `test/prep-registry.test.js` (fake-DOM renders,
  source scans, CSS gates)
- **GOTCHA**: the fake DOM does not dispatch — drive the controller's methods and reach handlers
  via `node.listeners.click[0]()`. Do NOT extend helpers/dom.js (its header forbids a ninth
  capability); anything needing real focus/keyboard is the manual pass.
- **VALIDATE**: `node --test test/prep-session-ui.test.js`
- **SATISFIES**: every automatable AC

### RUN the full gate

- **VALIDATE**: `npm test` — zero failures, including the existing registry scans (tabindex scan
  now also covers the three new files) and tokens contrast gate.

---

## TESTING STRATEGY

### Integration (the core suite, real routes + fake DOM)

1. **Full session end to end on fixtures**: seed invite + handover from `prep-payload.json`;
   `initSession` → prime shows (no attempts yet); `start` → question rendered cold (no hint text
   in the card); open nudge → turn route received `{action:"help",rung:"nudge"}`, panel filled;
   submit attempt → route received `mode:"nudged"`; feedback rendered with `worked` and the
   mapped `improve`; next question rendered; after 6 turns `suggest_close` reveals the close
   button; `closeSession` → close act shows an improvement or the honest line.
2. **Ladder logs the right mode**: recall path (no rung → `mode:"recall"`), nudge path, reveal
   path (`mode:"revealed"`), reveal-then-empty-submit path (empty legal), and reveal content
   cached (second open of the same rung on the same question makes no second help call —
   `fakeClient.kinds()` counts).
3. **Resume restores exact position**: run two turns; new `initSession` over the same DB (same
   cookie) → drill entered directly, same `next_question.id` served, prime skipped.
4. **Resume after a gap**: seed attempts at `at(-40min)` → fresh init shows prime with
   `last_close` rendered.
5. **Error paths**: 401 → login redirect recorded; 404 → not-ready copy; turn 502 → form
   re-enabled with the typed answer intact, no you-entry duplication on retry.

### Unit / scan groups (same file)

- Source scans on session.js + session.html: no HTML parsing, no browser-storage names, nothing
  candidate-shaped in URLs (no `answer_text` outside the POST body).
- session.css gates mirrored from prep-registry.test.js:765–799: no raw hex/px, no `:focus`, no
  `transition: all`, no selector clash against app.css AND prep.css. (Animation is permitted in
  THIS file only for the typing indicator — assert exactly one `@keyframes`.)
- No-rank sweep: serialize a full drilled page; assert no `stage`, `success_rate`, `importance`,
  `difficulty`, `rating`, no `%`, no "Level", no "N of M" (registry test group 7's grammar).
- COPY completeness: every state the controller can enter has a non-empty string.

### Edge Cases

- `next_question: null` mid-drill (mint degraded) → done-for-now state, no dead form.
- `feedback: null` (empty revealed attempt) → quiet caption, no invented praise.
- `habit` announced exactly when non-null — and only rendered once.
- Brief fetch fails but session succeeds → prime degrades (no PrimerCard), drill unaffected.
- Double-click submit → button disabled during flight (assert via recorded property).

### Manual (cannot be faked — plan R1)

Keyboard-only full session in real Chrome + Safari (`npm run dev`, seed via existing scripts or
fixtures): tab order, visible focus, rung disclosure semantics, focus move to feedback, reduced
motion (macOS setting) stills the indicator. 360px-width pass.

---

## VALIDATION COMMANDS

### Level 1: Syntax & scans
- `node --check public/prep/session.js`
- `node --test test/prep-session-ui.test.js` (contains the scans)

### Level 2: Unit + integration
- `npm test`

### Level 3: Full suite / regressions
- `npm test` again on a clean tree after all edits; `git status` shows only the planned files.

### Level 4: Manual
- `npm run dev` → sign in via a seeded invite (see `test/prep-auth.test.js` / `scripts/dev.py`
  seams) → run one full session keyboard-only; close tab mid-session; reopen via the same link →
  same question.

---

## ACCEPTANCE CRITERIA

- [ ] A full session runs end to end against #23's routes on fixtures (integration test 1)
- [ ] Ladder rungs log the right `mode` — recall / nudged / revealed (test 2)
- [ ] No path shows a score, rank, or a finished answer (no-rank sweep + registry's structural rail)
- [ ] Resume restores exact position (tests 3–4)
- [ ] Fidelity caveat surfaced once; practise-aloud encouraged (markup assertion)
- [ ] Turn round-trip never reads as dead air: optimistic echo + typing indicator + live region
- [ ] Keyboard-only pass of a whole session (manual, both browsers)
- [ ] Contrast gates hold (`test/tokens.test.js` green; every colour via tokens)
- [ ] No browser storage, nothing candidate-shaped in URLs, text-only DOM (scans)
- [ ] `npm test` fully green; no edits outside the five planned files

## COMPLETION CHECKLIST

- [ ] All tasks completed in order, each validation run immediately
- [ ] `references/CHECKLIST.md` (dossier-design) run before commit
- [ ] Manual keyboard + reduced-motion + 360px passes done and noted in the PR body
- [ ] Branch is `feature/drill-ui` off `origin/main`, PR says `Closes #24`

---

## OPEN QUESTIONS / ASSUMPTIONS

- **Close is composed client-side** from the session's own turn responses; the engine has no close
  action and `closePayload` only becomes derivable after the 30-minute gap (served as `last_close`
  on the next visit's prime). This plan treats that as the design, not a workaround. If the owner
  wants a server-authored close at the moment of closing, that's an engine change → out of scope
  here.
- **Prime borrows the brief's `PrimerCard`** via `GET /prep/api/brief` (already projected, no model
  call). Assumed acceptable double-fetch; degrade path covered.
- **Ladder state is not persisted**: resume mid-question resets `highestRung` to recall. SPEC only
  records mode on the attempt, so this is spec-consistent; noting it because "exact position"
  could be read more strictly.
- **`session.css` as a separate file** is this plan's call, to leave prep.css's no-animation gate
  untouched. If review prefers amending the gate instead, that's a one-line swap.

## NOTES (open canvas)

**Why lazy rung fill by page-owned writes, not a registry change**: `HelpLadder` renders from
props at construction; content here arrives on demand from POST /prep/api/turn. Options weighed:
(a) re-render the ladder block after fetch — loses open state, re-fires nothing, clunky; (b) add a
fetcher prop to the constructor — puts network I/O inside the safety-rail file that currently has
none and is imported DOM-less by tests; (c) render with empty props, use `onRung` + the walker's
deterministic panel ids to fill panels with text nodes from the page. (c) keeps the registry pure
and the page owns exactly the states the registry doesn't (pending/failed/filled) — the same
division brief.js already draws. The "visually staged like the Quantum reveals" requirement is
satisfied by the existing disclosure pattern plus the pending → filled progression.

**The mode mapping table** (one source of truth in session.js):
rung opened `nudge` panel → highestRung `nudged`; rung opened `structure` panel (onRung says
`"revealed"`) → `revealed`; POST help uses `{rung: "nudge"|"reveal"}`, POST attempt uses
`{mode: highestRung}`. turn.js 400s any crossing, so a wiring mistake fails loudly in the
integration tests.

**Dead-air budget**: Sonnet feedback turns run ~2–5s. The sequence you-echo → indicator →
live-region announcement is the whole answer; no spinner-only states (indicator always carries
text), no progress percentages (would read as scoring the answer).

**Timestamps in tests**: `at()` from helpers/sqlite-d1.js backdates attempts — needed for the
30-minute-gap resume case; never `Date.now()` arithmetic inline (prep-turn.test.js shows the idiom).

## AMENDMENTS

(none yet)
