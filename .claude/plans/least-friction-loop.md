# Feature: least-friction-loop

The following plan should be complete, but validate documentation and codebase patterns and task
sanity before you start implementing. Pay special attention to naming of existing utils and the
probe-pinned strings listed under GOTCHAS.

## Feature Description

The one screen at `/` already keeps the whole loop in the UI — pick a client, paste the brief
and the CV, take the prompt to Claude, bring back the reply, copy the checked pack. What remains
is avoidable friction *around* the one unavoidable trip to the recruiter's own Claude session.
This feature removes every removable click and paste:

1. **Auto-select the only client.** The MVP is literally one client (PRD §6). When the list has
   exactly one and none is selected, select it without a click (and without a history entry).
2. **Focus the brief after picking a client.** The next action is always a paste; put the caret
   where the paste goes.
3. **Drag a file onto the box.** A CV is a `.pdf` or `.docx` essentially always. Dropping it on
   the input column routes through the existing `DossierExtract` path — no picker dialog.
4. **One ⌘V finishes the loop.** In act 2, a paste anywhere on the page fills the reply, and if
   the pasted text carries a pack, the check runs immediately. Today: click into the textarea,
   ⌘V, click "Show the pack" (three actions). After: ⌘V (one action). Context-menu paste fires
   the same `paste` event, so mouse-only recruiters get the same path.
5. **Copy tells the recruiter the loop got shorter.** Act-2 instructions say "press ⌘V anywhere
   on this page" instead of describing the textarea-and-button dance.

What deliberately stays manual: the paste into Claude, the copy of Claude's reply (both live in
another product), and the final "Copy the pack" (reading the marks before sending is the
product's value — auto-copying would design the review step away).

## User Story

As a working owner-recruiter at a small agency
I want the pack loop to cost as few clicks and pastes as possible around the Claude round trip
So that producing a pack stays faster than the email it replaces (PRD §4 guardrail: speed is the
adoption condition).

## Problem Statement

The trip through the recruiter's own Claude session is a settled constraint (27 Jul 2026
amendment; `5e311d1` revert stands). But the current screen charges friction the constraint does
not require: a click to pick the only client, a picker dialog for files, and a
click-paste-click sequence on return from Claude. PRD §6 AC3 names copy-out friction as what
kills adoption in week three.

## Solution Statement

Keep all three acts and every guard (frozen inputs, stale-response checks, one event per pack,
no browser storage). Remove only the actions that carry no information: auto-select a sole
client, focus the paste target, accept dropped files, and treat a paste during the wait as the
intent it obviously is — fill the reply and run the check when the paste contains a pack.

## Out of Scope / Non-Goals

- **No model call from the deployment.** Settled, not reopenable. Nothing here touches
  `functions/`, `src/`, or the seam contracts.
- **No `navigator.clipboard.readText()` "Paste the reply" button.** Rejected: it adds a
  permission prompt (Chromium) or a native confirmation (Safari) — a scarier interaction than
  ⌘V — and the `paste` event already covers context-menu paste. Fewer code paths, no new
  browser-compat matrix.
- **No `claude.ai/new?q=` URL prefill.** Rejected in app.js:513-518 — a prompt is tens of
  thousands of characters and a query string truncates a CV silently.
- **No auto-copy of the finished pack.** "Copy the pack once every claim is checked" is the
  acceptance line; the read-the-marks step is deliberate.
- **No clipboard read on tab focus.** Reading the clipboard without a paste gesture needs a
  permission prompt and reads whatever the recruiter last copied — a privacy smell on a screen
  that promises transience.
- **No browser storage of anything.** The "remember last client" idea is storage; the URL
  (`?client=<uuid>`) already carries selection.
- **Not changing**: `/clients`, `functions/api/*`, `src/*`, `migrations/*`, the three-step map's
  existence, the `#read-pack` button (probes 3, 5, 6, 10 click it), any probe-pinned string.

## Feature Metadata

**Feature Type**: Enhancement
**Estimated Complexity**: Medium
**Primary Systems Affected**: `public/app.js`, `public/index.html`, `public/app.css`,
`.claude/probes/one-screen.mjs`
**Dependencies**: none new (vanilla JS, no build step — #8 AC9 still holds)

## Related Work

**Implements**: free-form request (no GitHub issue)   ·   **Epic**: #1 (dependency graph and
date gates); inherits the 27 Jul 2026 architecture amendment (generation in the recruiter's own
Claude session; no key, no server-side model call)

**Back-references**:

- `.claude/plans/generation-seam-and-one-screen.md` - the seam and the three acts this shaves
- `.claude/plans/ux-ui-uplift.md` - the visual standard and copy voice this must keep

**Forward-references**: (none yet)

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `public/app.js` (whole file, 945 lines) - the screen being changed. Load-bearing:
  - lines 1-40: the six decisions (no storage, gesture-preserving clipboard, frozen inputs,
    stale-response guards, single clock stop) — every addition must honour them
  - lines 156-166: `state` shape; 262-309: `showAct`/`setPhase`; 336-354: `resetToInputs`
  - lines 368-416: `renderList` (auto-select hooks in around here); 431-451: `select`/`load`
  - lines 493-604: `copyPrompt`/`enterWaiting` (the freeze); 608-669: `readPack` (the guards a
    paste-triggered call inherits for free)
  - lines 876-902: `readFileInto` (the function drag-and-drop refactors to share)
  - lines 904-945: wiring, `popstate`, `beforeunload`
- `public/index.html` (lines 30-43 steps map; 73-112 act 1; 114-142 act 2) - copy and structure
- `public/app.css` (lines 219-245 `.textarea`; 577-615 `.input-col`/`.file-*`) - where the
  drag-over state lands
- `public/extract.js` (lines 1-27 header) - `window.DossierExtract.extractText(file)` contract:
  resolves `{ text }`, rejects `{ reason: "unsupported" | "unreadable" | ... }`
- `src/pack.js` (lines 32-84) - `role_title` is a required pack field → the paste sniff key
- `src/paste.js` (whole file) - the server-side extractor; the frontend sniff must NOT
  duplicate it, only decide whether to auto-run
- `.claude/probes/one-screen.mjs` (whole file) - the probe harness new probes extend:
  `openScreen`, `baseRoutes`, `READ`, `primeInputs`, `LIST`, `PACK`, `VERIFIED`, and probe 1's
  comment on why sequencing is scheduled in-page
- `.claude/skills/dossier-design/references/CRAFT.md` - READ BEFORE WRITING CSS
- `.claude/skills/dossier-design/references/CHECKLIST.md` - RUN BEFORE COMMITTING

### New Files to Create

(none — all changes land in existing files)

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- README.md → **Decisions → Model access** - why the Claude trip is unavoidable; do not design
  around it
- [MDN: ClipboardEvent.clipboardData](https://developer.mozilla.org/en-US/docs/Web/API/ClipboardEvent/clipboardData)
  - `paste` events expose text with **no permission prompt** — the whole reason the paste-anywhere
    path beats a readText button
- [MDN: HTML Drag and Drop, file drop](https://developer.mozilla.org/en-US/docs/Web/API/HTML_Drag_and_Drop_API/File_drag_and_drop)
  - `dragover` must `preventDefault()` for a drop to be allowed; files arrive on
    `event.dataTransfer.files`

### Patterns to Follow

**Vanilla IIFE, `var`, no modules** — app.js:42-43. New code matches (`function` declarations,
`var`, no arrow functions, no `let/const` in public/).

**All user-visible strings live in `COPY`** — app.js:45-123. New/changed copy goes there or in
index.html; plain language for a first-time recruiter; **no em dashes in visible copy** (Level 1
gate); probe-pinned strings verbatim.

**`textContent`, never an HTML-parsing assignment** — app.js:396-400. Applies to anything new
that renders text.

**Guarded async: `state.busy` + `mine()`** — app.js:524-526, 624-627. The paste-triggered check
calls `readPack()` itself so it inherits these guards; do not build a second verify path.

**Error surfaces named per act** — `showState(el.waitingState, ...)` etc.; reuse, don't add new
status nodes.

**CSS through tokens only** — no raw hex in app.css (Level 1 gate); new state styles use
`var(--...)` from `public/tokens.css`.

---

## IMPLEMENTATION PLAN

### Phase 1: Behaviour (public/app.js + index.html)

Auto-select, focus-on-pick, drag-and-drop, paste-to-continue, copy updates.

### Phase 2: Presentation (public/app.css)

**Depends on:** Phase 1 (the class names it styles). Read CRAFT.md first.

### Phase 3: Probes (.claude/probes/one-screen.mjs)

**Depends on:** Phases 1-2. Four new probes; existing ten must stay green unmodified.

### Phase 4: Validation

Level 1 greps, `npm test`, both probe files, manual dev-server walk, CHECKLIST.md pass.

---

## STEP-BY-STEP TASKS

### UPDATE public/app.js — auto-select the only client

- **IMPLEMENT**: in `refreshList()`'s success path (or a small helper it calls after
  `renderList`), when `body.clients.length === 1 && state.selected === null`, adopt that client:
  set the URL with **`history.replaceState`** (never `pushState` — no history entry for a choice
  the recruiter didn't make), then call `load(client.id, client.name)`. Guard against loops:
  `load()` calls `refreshList()` again, but on re-entry `state.selected` is set, so the branch
  must not fire. Do NOT route through `select()` (it early-returns on same id but would
  `pushState` and could `confirm` — wrong on the load path).
- **PATTERN**: URL handling mirrors `select()` app.js:435-438; `load()` app.js:442-451.
- **GOTCHA**: only an id in the URL, never a name (decision 2, app.js:20). Probe 6 uses a
  one-client list then clicks the row — `select()` returns early on same id, harmless.
- **VALIDATE**: `node .claude/probes/one-screen.mjs` (probe 11 added later asserts this; probes
  1-10 stay green now)
- **SATISFIES**: AC #1

### UPDATE public/app.js — focus the brief on a click-selection

- **IMPLEMENT**: in `select()`, after `load(id, name)` resolves, focus `el.brief`
  (`load` returns `refreshList()`'s promise — chain on it: the focus must land after
  `renderList`'s row-refocus so it wins). Click path only — not on deep-link load, not on
  popstate, not on auto-select.
- **PATTERN**: `focus({ preventScroll: true })` usage app.js:654 — plain `.focus()` is fine
  here (act 1 is at the top).
- **VALIDATE**: manual: `python3 scripts/dev.py`, click a client, caret is in the brief box
- **SATISFIES**: AC #2

### UPDATE public/app.js — accept dropped files on both input columns

- **IMPLEMENT**:
  1. REFACTOR `readFileInto(input, textarea, stateNode)` → extract its body into
     `readFile(file, textarea, stateNode)` taking a `File`; `readFileInto` becomes a thin
     wrapper that pulls `input.files[0]`, clears `input.value`, and delegates.
  2. ADD a `wireDrop(col, textarea, stateNode)` helper wired to both `.input-col` elements
     (give the two columns ids `brief-col` / `cv-col` in index.html, or select via
     `closest`/`parentElement` from the textareas):
     - `dragover`: if a file is being dragged (`event.dataTransfer.types` includes `"Files"`)
       and `state.phase === "inputs"` and the textarea is not readOnly → `preventDefault()` and
       add class `is-dragover` to the column.
     - `dragleave` / `drop`: remove `is-dragover`.
     - `drop`: if `event.dataTransfer.files[0]` exists (same guards) → `preventDefault()` and
       call `readFile(file, textarea, stateNode)`. When there are no files, do nothing — the
       browser's native text-drop into the textarea proceeds.
- **PATTERN**: `readFileInto` app.js:876-902 (error copy: `fileNotText`/`fileUnreadable`/
  `fileFailed`/`fileReading` all reused unchanged; `INPUT_MAX` pre-check kept).
- **GOTCHA**: dropping a file on a page normally NAVIGATES to it — the `preventDefault` on both
  `dragover` and `drop` is the fix, but only claim the event when files are present so text
  selection drag-drop keeps working. Never touch `window` level handlers (a stray drop outside
  the columns should keep its native behaviour — the beforeunload guard already protects the
  pasted text).
- **VALIDATE**: probe 14 (added later); manual: drop a `.txt` and a `.pdf` on each box
- **SATISFIES**: AC #3

### UPDATE public/app.js — paste anywhere during the wait finishes the loop

- **IMPLEMENT**: a document-level `"paste"` listener:
  ```js
  document.addEventListener("paste", function (event) {
    if (state.phase !== "waiting") return;
    var data = event.clipboardData;
    var text = data ? data.getData("text/plain") : "";
    if (!text || !text.trim()) return;
    event.preventDefault();                  // no double insert when the target is #reply
    el.reply.value = text;
    if (text.indexOf('"role_title"') !== -1) readPack();
  });
  ```
  The sniff is deliberately dumb: `"role_title"` is a required pack field (src/pack.js:75-84),
  quoted exactly like that in any JSON reply. A false negative leaves the filled textarea and
  the button (today's path); a false positive runs the same check the button runs and shows the
  same server-side `no_pack`/`bad_pack` message. The server stays the only judge of what a pack
  is (src/paste.js does the real extraction) — the frontend only decides whether to press the
  button for the recruiter.
- **PATTERN**: `readPack` app.js:608-669 already guards `state.busy`, `state.sent`, and
  `state.phase !== "waiting"` — call it, do not fork it. One event per pack stays a property of
  `readPack`, not a promise repeated here.
- **GOTCHA**: phase `"pack"` keeps act 2 visible — the `waiting` check means a paste over a
  finished pack does nothing (a different pack means Start again, same as the button; probe 10's
  one-event line). Paste into the readonly brief/cv during the wait would natively do nothing;
  this handler routes it to the reply, which is what the recruiter meant.
- **VALIDATE**: probes 12 and 13 (added later)
- **SATISFIES**: AC #4

### UPDATE public/index.html + public/app.js — copy that names the shorter loop

- **IMPLEMENT**:
  - Act-2 note (index.html:127-131): "The prompt is on your clipboard and Claude is open in the
    other tab. Paste it there (⌘V). When it answers, copy the whole reply, come back, and press
    ⌘V anywhere on this page. The pack is checked the moment it lands." Keep the
    "Open Claude again" link exactly as is.
  - `COPY.promptCopied` (app.js:48-49): "Copied, and Claude is open in the other tab. Paste it
    there. When it answers, copy the whole reply and press ⌘V back on this page."
  - `COPY.promptCopiedNoTab` (app.js:52): same shape without the tab claim.
  - File labels (index.html:82, 93): "Or open a file, or drop one on the box: PDF, Word, or text"
  - Reply placeholder stays ("Paste the whole reply, including the JSON block.") — it is the
    fallback path's instruction and still true.
- **PATTERN**: voice per ux-ui-uplift copy pass — short sentences, no em dashes, every string
  written for a first-time recruiter.
- **GOTCHA**: probe-pinned strings that must survive byte-for-byte: "not connected to its
  database" (COPY.notConfigured), "does not look like a pack" (COPY.noPack), "no note for this
  client yet" (COPY.noteEmpty), "Copied" prefix in pack-copy state, the confirm text from
  `COPY.leavingClient`. None of them are being edited — keep it that way.
- **VALIDATE**: `grep -n '—' public/index.html` → comments only;
  `node .claude/probes/one-screen.mjs` probes 3, 4, 10 still green
- **SATISFIES**: AC #5

### UPDATE public/app.css — the drag-over state

- **IMPLEMENT**: after reading CRAFT.md: a `.input-col.is-dragover .textarea` rule — border
  swaps to `var(--accent)` and background to `var(--surface)`. Colour is not the only signal:
  the state is entered by the recruiter's own drag (direct manipulation feedback), and the file
  labels already say "drop one on the box" in words.
- **PATTERN**: `.textarea[readonly] { background: var(--surface); }` app.css:245 — same
  altitude, token-only.
- **GOTCHA**: no raw hex, no `transition: all` (Level 1 gates). `--accent` is a fill colour
  and never a text colour (README Decisions) — a border is a fill-adjacent use, fine at 3:1
  decorative; do not put text in accent.
- **VALIDATE**: `grep -nE '#[0-9a-fA-F]{3,8}' public/app.css` → nothing;
  `grep -n 'transition: all' public/*.css` → nothing
- **SATISFIES**: AC #3

### UPDATE .claude/probes/one-screen.mjs — four new probes

- **IMPLEMENT** (mirror the existing probe idiom exactly — `openScreen`, `SETTLE`, `READ`,
  `check`, close the page):
  - **probe 11 — auto-select**: `openScreen` with a one-client list (reuse probe 6's shape).
    Assert: `?client=<A>` in `r.url` WITHOUT any row click, the row carries `aria-current`,
    `r.confirms === 0`, and history length did not grow (evaluate `history.length` before/after
    is unreliable in CDP — instead assert `replaceState` semantics by checking `history.state`
    carries the client while a single Back exits: simplest honest check is `r.url` +
    `confirms === 0` + rail row `aria-current="true"`). Then FILL inputs and CLICK copy-prompt →
    `/api/prompt` succeeds (proves selection is real, not cosmetic).
  - **probe 12 — paste finishes the loop**: two-client list, `primeInputs`, CLICK copy-prompt,
    SETTLE, then dispatch in-page:
    ```js
    var dt = new DataTransfer();
    dt.setData("text/plain", '```json\n{"role_title":"x"}\n```');
    document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
    ```
    Assert: reply textarea holds the text, exactly ONE `/api/verify` call, pack rendered
    (`packHidden === false`), and the frozen CV was what got sent (parse
    `calls` for the verify body's `cv` field — same assertion probe 8 makes for the clipboard).
  - **probe 13 — a paste that is not a pack does not fire the check**: same setup, paste
    `"here is the reply so far"`. Assert: reply filled, ZERO `/api/verify` calls, still in
    act 2 (`waitingHidden === false`, `packHidden === true`).
  - **probe 14 — a dropped file lands in the textarea**: `openScreen`, click row A, dispatch
    in-page on the CV column:
    ```js
    var f = new File(["Registered nurse. NMC registration current to Mar 2027. " +
                      "Community caseload experience across Sussex."], "cv.txt",
                     { type: "text/plain" });
    var dt = new DataTransfer(); dt.items.add(f);
    var col = document.getElementById("cv").closest(".input-col");
    col.dispatchEvent(new DragEvent("dragover", { dataTransfer: dt, bubbles: true,
                                                  cancelable: true }));
    col.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true,
                                              cancelable: true }));
    ```
    (file body > 40 chars — `looksLikeText` rejects shorter). SETTLE(400), assert the CV
    textarea contains "NMC registration current" and no error state shown.
  - Register all four in the run loop (line 756-758).
- **PATTERN**: probe 6 for single-client route shaping; probe 8 for asserting call bodies;
  probe 1's header comment for why sequencing is scheduled in-page.
- **GOTCHA**: `ClipboardEvent` with `clipboardData` in the init dict works in Chrome (the only
  probe browser). Do not modify probes 1-10 — if one goes red, the CODE is wrong, not the probe.
- **VALIDATE**: `node .claude/probes/one-screen.mjs` → 14/14
- **SATISFIES**: AC #6

---

## TESTING STRATEGY

### Unit Tests

`public/app.js` is a browser IIFE with no module seam — by repo convention it is tested by CDP
probes, not `node --test` (one-screen.mjs:1-18 records why). No `src/` or `functions/` code
changes, so the 223 existing unit tests must pass unchanged; no new unit tests are added.

### Integration Tests

The probe file IS the integration suite: 10 existing + 4 new = 14, real Chrome over CDP,
fetch/clipboard stubbed before app.js runs.

### Edge Cases

- Paste while `state.busy` (verify in flight): `readPack()` early-returns; the reply textarea
  updates to the newer paste — acceptable, the in-flight check still sends the frozen inputs.
- Paste in phase `"pack"`: ignored (one event per pack).
- Paste with files on the clipboard but no text (screenshot): `getData("text/plain")` is empty →
  handler returns, nothing breaks.
- Drop of dragged TEXT (not a file): handler ignores it; native textarea drop behaviour intact.
- Drop while inputs are frozen (act 2/3): guarded out — the frozen CV must stay what the model
  read (decision 4, app.js:27-31).
- Auto-select with `?client=<other-uuid>` deep link and a one-client list: deep link wins —
  `state.selected` is already set when the list lands, branch does not fire... **verify order**:
  `load()` runs `resetToInputs` then `refreshList` — selected is set before the list resolves. ✓
- Two clients, one deleted on /clients leaving one: next full load of `/` auto-selects — fine.

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style

```bash
grep -nE '#[0-9a-fA-F]{3,8}' public/app.css               # expect: nothing (tokens only)
grep -n 'transition: all' public/*.css                     # expect: nothing
grep -n '—' public/index.html                              # expect: HTML comments only
grep -nE 'localStorage|sessionStorage|indexedDB|document\.cookie' public/app.js   # expect: nothing
grep -n 'innerHTML' public/app.js                          # expect: nothing
```

### Level 2: Unit Tests

```bash
npm test                                                   # expect: 223/223 pass, no new failures
```

### Level 3: Integration Tests

```bash
node .claude/probes/one-screen.mjs                         # expect: 14/14
node .claude/probes/clients-screen.mjs                     # expect: 11/11 (untouched screen stays green)
```

### Level 4: Manual Validation

```bash
python3 scripts/dev.py    # then in the browser:
```

1. One client in the local DB → open `/` → it is already selected, caret lands in brief after a
   click on the row of a second client (add one on /clients to test the two-client path).
2. Drag a real `.pdf` CV onto the CV box → text appears; drag a `.docx` → text appears; drag a
   scanned PDF → "most likely a scan" message.
3. Full loop: copy prompt → real Claude session → copy reply → return → single ⌘V with focus
   NOWHERE (click the page background first) → pack renders without touching the textarea or
   the button.
4. Paste garbage during the wait → textarea fills, nothing fires, button still works.
5. 360 px viewport: no horizontal scroll through the whole flow (probe 6 also gates this).

### Level 5: Additional Validation

Run `.claude/skills/dossier-design/references/CHECKLIST.md` top to bottom before committing.

---

## ACCEPTANCE CRITERIA

- [ ] AC #1: with exactly one client and no deep link, the client is selected on load with no
      click, no confirm, and no new history entry
- [ ] AC #2: clicking a client row lands the caret in the brief textarea
- [ ] AC #3: a `.pdf`/`.docx`/`.txt` dropped on either input column fills its textarea through
      the existing extract path, with the existing error copy on unreadable files; a visible
      drag-over state exists and uses tokens only
- [ ] AC #4: during act 2, one paste anywhere on the page fills the reply and, when the text
      contains a pack, runs the check with no further clicks; a non-pack paste fills the reply
      and fires nothing
- [ ] AC #5: act-2 copy tells the recruiter "press ⌘V anywhere on this page"; no em dashes; all
      probe-pinned strings byte-identical
- [ ] AC #6: probes 1-10 pass unmodified; new probes 11-14 pass; 223 unit tests pass
- [ ] No new storage, no candidate data in URLs, no changes under `functions/`, `src/`,
      `migrations/`

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Level 1-3 commands all clean (14/14, 11/11, 223/223)
- [ ] Manual loop walked once against real Claude
- [ ] CHECKLIST.md pass done
- [ ] Copy read once aloud as a first-time recruiter

## OPEN QUESTIONS / ASSUMPTIONS

- **Assumption**: `"role_title"` as the auto-run sniff key. Every real pack reply carries it
  quoted; the server remains the only authority on pack-ness. If a future schema rename occurs,
  the cost is one extra button click, not a wrong answer.
- **Assumption**: auto-running the check on paste is wanted, not just filling the textarea. The
  check is read-only over the pasted reply and its failure modes are the same messages the
  button shows; the recruiter loses nothing.
- **Assumption**: focus-to-brief on row click does not need a keyboard-trap review — it moves
  focus forward to the next task, matching WAI-ARIA guidance on activation moving focus to the
  result of the action.
- **Question (non-blocking)**: should the steps map (index.html:38-42) reword step 2 to mention
  the single ⌘V? Left as-is: the map describes the journey, the act teaches the gesture at the
  moment it is needed. Revisit if week-one feedback shows recruiters re-reading the map.

## NOTES (open canvas)

Rejected alternatives, for the record:

| Idea | Why not |
|---|---|
| `POST /api/generate` restored | Settled decision (5e311d1 revert stands; amendment 27 Jul 2026) |
| `claude.ai/new?q=<prompt>` prefill | URL length truncates a CV silently (app.js:513-518) |
| "Paste the reply" button via readText() | Permission prompt scarier than ⌘V; paste event covers context-menu paste already |
| Clipboard sniff on tab focus | Permission prompt + reads whatever was last copied; privacy smell |
| Auto-copy pack after verify | Deletes the review step that is the product's promise |
| Remember last client | Storage of any kind is barred on this screen; URL already does it |

The deepest cut available without the API key is the return path: the recruiter's hands are
already on ⌘C in Claude; ⌘Tab, ⌘V is muscle memory. One paste = pack is the ceiling of
UI-only friction removal, and this plan reaches it.

## AMENDMENTS

(none yet)
