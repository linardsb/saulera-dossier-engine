# Feature: Redesign Client knowledge and Prep sent screens (#61)

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

## Feature Description

The two secondary recruiter screens — `/clients` (the client list and its note editor) and
`/counts` (the prep-sent log) — are restyled and restructured on the design foundation shipped
by #58. Nothing about what either screen *does* changes: the note is still the product, adding
clients and writing notes still happen on `/clients` and nowhere else, and `/counts` still shows
delivery telemetry and nothing about any candidate.

What changes is how both read. `/clients` becomes one measured document column with three named
zones — write the note · what a candidate can see · for locum supply — a note box that grows
with the viewport, and a Save control that stays in reach while you write. The locum checklist
gets the layout it has never had (it shipped in #48 with **no CSS at all**, so its rows render as
run-together inline spans). `/counts` becomes a quiet table whose numbers are the subject: mono
digits, zeros muted so the eye finds the numbers that are not zero, and rows with air in them.

One shared-chrome bug is fixed on the way through, because it is what the `/clients` browser
probe currently fails on: `.topbar-nav` does not wrap, so all three screens scroll horizontally
at 360px. Verified during planning — see **NOTES → The 360px overflow**.

## User Story

As a recruiter filing what I know about a client
I want the note editor to feel like a place to write and the prep-sent page to be readable at a glance
So that keeping the client note current is not the chore that stops me using the tool

## Problem Statement

`/clients` is the screen the product's compounding asset lives on — the client note is what makes
every future pack better — and it currently reads as a form. Concretely:

1. **No hierarchy in the editor column.** The textarea's label, the "What a candidate can see"
   legend and the "For locum supply" legend all render through `.field` (`app.css:226-232`), so a
   new zone looks exactly like another field label. The column is one undifferentiated scroll.
2. **The note box does not scale.** `rows="16"` fixes it at ~400px on a 27" monitor and on a
   laptop alike, and Save sits below it — on a 700px-tall window Save is under the fold before a
   word is typed.
3. **The locum checklist is unstyled.** `grep -n locum public/app.css` returns nothing. Each `<li>`
   holds three `<span>`s and a button with no row layout, so heading, hint and status run
   together on one line and `.visibility-meta`'s `margin-left: auto` does nothing outside a flex
   row.
4. **`/counts` renders its numbers in the UI sans.** The epic decided mono for counts and data;
   the table has `tabular-nums` but the body font, and every zero has the same weight as every
   real number, so nothing scans.
5. **All three screens scroll horizontally at 360px** — the nav does not wrap. Two of the
   eighteen browser probes fail on this today, and have since before #58.

## Solution Statement

Restyle within the existing markup wherever possible, and restructure only where structure is the
problem. Every value already has a token; the two new ones are non-colour (a note height and a
scroll padding) and go in `tokens.css` where values live.

**`/clients`** — the editor column becomes a document column:

- One measure for the whole editor column (`max-width: 75ch`), so the note, the two readouts and
  the delete action share an edge and the column reads as a page rather than a stretched form.
- The note box takes its height from the viewport: `min-height: clamp(400px, 52vh, 640px)`,
  never shorter than today's 16 rows, taller on a big screen, still `resize: vertical`.
- The save row sticks to the bottom of the viewport on desktop, so Save and its live region are
  in view for the whole length of a long note. `scroll-padding-bottom` keeps focus from landing
  under it.
- The two fieldsets that describe the *saved* note move inside one `.note-facts` zone with a
  hairline above it, and their legends take the eyebrow grammar `.rail-head` / `.agency-head`
  already use — so "here is what the note produces" is a zone, not a third field label.
- The locum rows get the row grammar the visibility rows already have: a two-column grid, 44px
  minimum, hairline separators, the status right-aligned and the "Add ##…" button on its own line.

**`/counts`** — the numbers become the subject: `--font-mono` on the body number cells only (DM
Mono ships 400 alone, so the 600 header cells stay sans), zeros muted, rows given `--space-4` of
vertical air, one rule under the head and hairlines between rows.

**Shared chrome** — `.topbar-nav { flex-wrap: wrap }`, one line, which takes the probe suite from
16/18 to 18/18.

## Out of Scope / Non-Goals

- **Not included: a totals row on `/counts`.** `GET /api/events` already returns `total`, and
  summing `invites_sent` client-side would be free — but a headline number the page does not show
  today is new information, and epic #57's non-goals say "no new pages or features — this epic
  restyles and restructures what exists". Rejected deliberately; see NOTES.
- **Not included: a live character counter** in the editor head. Same reason.
- **Not changing: any behaviour in `clients.js`'s async layer.** `renderList`'s focus restoration
  (`focusedId` / `refocus`, `clients.js:206-247`), `renderFields`' equivalent (`449-451`,
  `500`), and the `reqId` / `savingId` / `fieldsVersion` guards (`clients.js:120-145`, `332-338`,
  `369-376`, `576-604`) are the product of two review rounds and eighteen browser probes. A DOM
  restructure is exactly how they get dropped. The only JS edits this plan makes are
  `renderLocum`'s child order and one class name in `counts.js`'s `cell()` call.
- **Not changing: `/` (index.html) or `/prep/*`.** #59 and #62 own those. This ticket touches
  exactly one shared rule (`.topbar-nav`) and says so out loud.
- **Not changing: the API, the store, or any migration.** No server file is touched.
- **Not changing: the wording or timing of the save-state line.** The ticket names save feedback as
  one of the four things in scope, and this plan's answer is placement rather than a new
  treatment: the line moves into a row that stays in view while you write. Be clear about the
  limit — that holds at 860px and up, and below it the state line behaves exactly as it does
  today. A mono timestamp and a distinct saved state were both weighed and rejected (see NOTES);
  if the owner wants save feedback to read louder than "in view", that is a follow-up.
- **Not adding: a README Decisions entry.** The repo's bar for that log is "decisions that would
  otherwise be re-litigated per ticket". Layout choices carrying their own measured comment in
  the CSS meet the repo's dominant convention instead. (`tokens.css` throughout is the model.)
- **Not renaming any element id or any of the six classes the probe suite queries.** See the
  frozen inventory below.

## Feature Metadata

**Feature Type**: Enhancement (redesign of existing screens)
**Estimated Complexity**: Medium
**Primary Systems Affected**: `public/clients.html`, `public/clients.js` (one function),
`public/counts.html` (no change expected), `public/counts.js` (one line), `public/app.css`
(the `/clients` and `/counts` blocks), `public/tokens.css` (two non-colour tokens)
**Dependencies**: None. No new library, no build step, no CDN — epic AC #5.

## Related Work

**Implements**: [#61](https://github.com/linardsb/saulera-dossier-engine/issues/61) ·
**Epic**: [#57](https://github.com/linardsb/saulera-dossier-engine/issues/57) (the `## Direction`
and `## Acceptance criteria` sections are inherited, not re-decided)

**Back-references** (plans this builds on or inherits decisions from):

- `.claude/plans/redesign-foundation-tokens-fonts-chrome.md` — Why: #58 is this ticket's `Depends
  on`. The palette, the type ramp, the one-sans-one-mono decision, the opt-in motion guard and
  `test/chrome.test.js` all come from there and are **not** reopened here.
- `.claude/plans/client-knowledge-store.md` — Why: built `/clients`; its decisions 1–4 (no browser
  storage, id-not-name in the URL, a failed save keeps the text, every response checked against
  its request) are the behaviour this redesign must not disturb.
- `.claude/plans/per-field-candidate-visible-toggle.md` — Why: built the visibility list and the
  `.visibility-*` row grammar this plan extends to the locum rows.
- `.claude/plans/client-note-locum-fields.md` — Why: built the locum checklist (#48) whose
  missing CSS this ticket supplies.

**Forward-references** (plans that extend or supersede this — append as follow-ups get created):

- (none yet)

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `public/clients.html` (whole file, 172 lines) — Why: the screen being restructured. Every
  comment in it states why an element is where it is; two of those reasons are load-bearing and
  survive this ticket (the scaffold line stays *above* the box so it is visible while writing,
  `clients.html:77-79`; the delete block stays far from Save, `clients.html:122-124`).
- `public/app.css` (lines 264-572) — Why: the `/clients` blocks — layout, rail, editor, note
  scaffold, visibility list, agency strip. This is the range this ticket rewrites.
- `public/app.css` (lines 949-1003) — Why: the `/counts` table block, the second range.
- `public/app.css` (lines 1005-1015) — Why: the `@media (max-width: 859px)` mobile-density block,
  where any mobile override belongs.
- `public/app.css` (lines 1017-1051) — Why: the motion block. **Every** transition in the file
  lives here and `test/chrome.test.js` fails the build if one is declared anywhere else.
- `public/app.css` (lines 111-138) — Why: `.topbar-nav`, the one shared rule this ticket changes.
- `public/tokens.css` (lines 101-155) — Why: the type ramp, the 4px grid, `--tap-target`,
  `--hairline`, motion and focus tokens. The two new tokens go here, in this file's comment style.
- `public/clients.js` (lines 511-559) — Why: `renderLocum`, the one function this plan edits.
  Note the focus-restoration block at 514-520 — it stays.
- `public/clients.js` (lines 194-248) — Why: `rowMeta` and `renderList`; read for the row DOM the
  rail CSS styles, and for the focus restoration not to break.
- `public/clients.js` (lines 438-501) — Why: `renderFields` builds `label > input + .visibility-name
  + .visibility-meta`. The locum rows must end up reading as the same component.
- `public/counts.js` (lines 74-104) — Why: `cell()` and `render()`; one line changes.
- `public/counts.html` (lines 41-56) — Why: the table markup. Expected to need no change.
- `test/counts.test.js` (whole file, 118 lines) — Why: **the gate most likely to be tripped by
  this ticket.** It asserts prose, not just structure. See the frozen inventory below.
- `test/chrome.test.js` (lines 45-99) — Why: no raw hex in `app.css`, no motion outside the guard.
- `test/tokens.test.js` (lines 22-32, 80-96) — Why: the shape a token gate takes, and the fact
  that it reads **hex** tokens only — so the two new non-colour tokens need no gate change.
- `.claude/probes/clients-screen.mjs` (lines 566-614 and 975-1030) — Why: probes H6, M10 and V18t
  measure rendered geometry on `/clients` — 44px rows, metas inside a 360px viewport, no page
  scroll. They are the only thing that can catch a layout regression here, and they are **not**
  part of `npm test`.
- `.claude/skills/dossier-design/references/CRAFT.md` — Why: the numeric rules (65-75ch measure,
  4px rhythm, hairlines only where they encode grouping, 44px hit areas).
- `.claude/skills/dossier-design/references/CHECKLIST.md` — Why: run it before committing; the
  MUSTs on contrast, keyboard path, reduced motion, 360px and custom-property discipline.

### New Files to Create

- `test/screens.test.js` — the id-contract gate: every `document.getElementById("x")` in
  `clients.js` / `counts.js` has a matching `id="x"` in the page that loads it. Written **first**,
  before any markup moves.

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [MDN — `position: sticky`](https://developer.mozilla.org/en-US/docs/Web/CSS/position#sticky)
  - Specific section: "Sticky positioning" — the containing-block and scrolling-ancestor rules.
  - Why: the save row's stickiness dies silently if any ancestor gains `overflow` other than
    `visible`. `.editor`, `.workspace`, `main` and `body` are all clear today; do not add one.
- [MDN — `scroll-padding`](https://developer.mozilla.org/en-US/docs/Web/CSS/scroll-padding)
  - Specific section: the `scroll-padding-bottom` longhand.
  - Why: focus scrolled to a checkbox below the sticky row would land under it. CHECKLIST.md
    names the top-side version of this trap; this is its bottom-side twin.
- [MDN — `clamp()`](https://developer.mozilla.org/en-US/docs/Web/CSS/clamp)
  - Why: the note height. `clamp(400px, 52vh, 640px)` — the floor is what keeps a short window
    no worse than today.
- [MDN — CSS font matching, `font-weight`](https://developer.mozilla.org/en-US/docs/Web/CSS/font-weight#fallback_weights)
  - Why: DM Mono ships **400 only** (`fonts.css:36-42`, one file on disk). A 600 request against
    it triggers synthetic bold, not a real face — which is why mono is scoped to the *body* number
    cells and never to `thead th`.

### The frozen inventory — strings, ids and selectors that MUST survive verbatim

The ticket's third AC is "plain language on every changed string". These strings are asserted
elsewhere: **keep them verbatim, or change them and update the assertion in the same task.** An
implementation agent that rewrites a sentence for plainness and ships red is the likeliest
failure mode on this ticket.

| What | Where asserted | Note |
|---|---|---|
| `"how many opened it"` and `"Nothing about what any candidate did."` | `test/counts.test.js:77-78` | in `counts.html`'s `.page-sub`, matched on whitespace-collapsed markup |
| `credentialing quirks` · `VMS or portal` · `protocol expectations` · `site access and parking` · `extension habits` | `test/counts.test.js:89-97` | the second `.scaffold-line` in `clients.html:80-82`; each phrase matched individually, so re-flowing or re-punctuating between them is fine |
| `id="locum-list"` | `test/counts.test.js:87` | |
| `href="/"`, `href="/clients"`, `href="/counts"` in all three pages; **never** `href="/counts.html"` | `test/counts.test.js:119-132` | |
| `locum_fields` in `clients.js` | `test/counts.test.js:101` | |
| `(el.note.value ? "\n\n" : "")` literal in `clients.js` | `test/counts.test.js:113-116` | the heading-insert separator |
| `"not connected to its database"` (`clients.js:49`) | `.claude/probes/clients-screen.mjs` probe M7 | |
| exactly `api("/api/clients")` and `api("/api/events")`, exactly one `fetch(` in `counts.js` | `test/counts.test.js:29-40` | |

**Word bans, whole-file (comments included):**

- `counts.js`, everywhere except inside the `COPY` object: none of
  `attempt`, `habit`, `invite_id`, `email`, `competency`, `question`, `brief_json`
  (case-insensitive, `test/counts.test.js:47-64`). A new comment saying "the question this page
  answers" fails the suite.
- `counts.js`, whole file: none of `innerHTML`, `outerHTML`, `insertAdjacentHTML`,
  `document.write`, `localStorage`, `sessionStorage`, `indexedDB`, `document.cookie` — plain
  `includes`, so even a comment mentioning one fails.
- `clients.js`, whole file: none of `.innerHTML`, `.outerHTML`, `.insertAdjacentHTML`,
  `document.write` (dotted form) or the four storage APIs.
- `app.css`: no raw hex outside comments; no `transition` / `animation` / `@keyframes` outside the
  `prefers-reduced-motion: no-preference` block (`test/chrome.test.js`).

**Element ids that must exist after the restructure.** Queried by `getElementById` in `clients.js`
(`clients.js:96-118`) and by the probe: `client-list`, `rail-empty`, `rail-state`, `add-form`,
`new-client-name`, `add-button`, `editor-empty`, `editor-body`, `editor-head`, `note`,
`save-button`, `delete-button`, `save-state`, `agency-state`, `send-format`, `visibility-list`,
`visibility-empty`, `visibility-state`, `locum-list`, `locum-state` — plus `counts-body` and
`counts-state` in `counts.js`. Referenced by ARIA rather than by script, and equally required:
`visibility` / `locum` (the fieldsets), `visibility-hint` / `locum-hint` (`aria-describedby`),
`rail-head` (`aria-labelledby`), `agency-head`, `counts-table`. `test/screens.test.js` covers the
first group; the second group is on you and on the manual pass.

**Class names the probe queries by selector** — do not rename: `.client-row` (with `data-id`),
`.visibility-name`, `.visibility-meta`, `.radio-row label`, and the structure
`#visibility-list li > label > input[data-key]`.

### app.css ownership — which lines this ticket may touch

`#59` (Submission pack flow) and `#62` (portal shell) run in **parallel worktrees on this same
file**. Stay inside these ranges so the merge is a diff, not a rewrite:

| Range | Owner | This ticket |
|---|---|---|
| 1-263 (reset, type, focus, topbar, card, buttons, fields) | #58, shared | **one line only**: `.topbar-nav { flex-wrap: wrap }` |
| 264-303 (layout, `.workspace`, `.editor`) | shared rail grammar | may edit `.editor`; leave `.workspace` alone |
| 305-387 (the rail) | shared with `/` | **prefer no change**; the ticket says the two lists must keep reading as the same thing, and they already do |
| 389-507 (editor, scaffold, visibility) | this ticket | free — but new visibility rules go under an `.editor` or `.note-facts` ancestor, because the bare `.visibility*` rules are also act 4's on `/` (`index.html:218-221`) |
| 509-571 (agency strip) | this ticket | free |
| 573-948 (the acts, the pack, act 4) | **#59** | **do not touch** |
| 949-1003 (counts) | this ticket | free |
| 1005-1015 (mobile density) | shared | additive only |
| 1017-1051 (motion) | shared | additive only, and any new transition MUST go here |

### Patterns to Follow

**Measured numbers live beside the value, in the file.** The repo's strongest convention. Every
new rule carries the measurement that decided it:

```css
/* Off the 4px grid deliberately: CRAFT.md's hit-area floor is 44px on touch, and that is not
   a spacing decision that should move when the grid does. --space-8 is 32px and was standing
   in for it, which put every button under the floor. */
--tap-target: 44px;
```
`tokens.css:139-141`. Write yours the same way, with the numbers from this plan's tasks.

**A value goes in `tokens.css`, a rule in `app.css`.** No exceptions — `test/chrome.test.js`
enforces it for colour and the file's own header states it for everything else
(`app.css:1-9`).

**Scope a shared component's variant by ancestor, never by editing the bare rule.** The file
already does this:

```css
.agency .select { max-width: 280px; }
```
`app.css:571`. Your visibility/locum rules take the same shape: `.note-facts .visibility …`.

**Reuse the eyebrow heading rather than declaring a third copy.** `.rail-head` (`app.css:316-323`)
and `.agency-head` (`app.css:518-525`) are identical apart from their bottom margin: uppercase,
`--text-caption`, `0.08em` tracking, muted, `var(--font-ui)`. Add `.zone-head` to one of those
selector lists and give it only the margin it needs; do not paste a third copy of the five shared
declarations.

**Build DOM with `createElement` + `textContent`, always.** `clients.js:216-244` and
`counts.js:74-79`. Every string rendered on these screens is agency-authored and never markup.

**Focus survives a rebuild.** Any function that clears and rebuilds a list first records what
`document.activeElement` was and refocuses its replacement afterwards — `clients.js:203-210`,
`449-451`/`500`, `514-520`/`558`. If you touch `renderLocum`, that block stays exactly as it is.

**A gate parses the file rather than a rendered page.** Zero dependencies, `node --test`, no DOM:

```js
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
```
`test/chrome.test.js:27-28`. `test/screens.test.js` follows exactly this shape.

**A test name states the invariant and the assertion message states the fix.**
`test/tokens.test.js:94-96` is the model.

**British English in prose, American in CSS identifiers.** Comments say "colour"; the property is
`color`.

**Copy register** (dossier-design SKILL.md, and every string already on these screens): no em or
en dashes in visible copy, no "not X but Y", no aphorisms, no -ing padding, active voice, plain
en-GB words, a control says exactly what it does, an error says what to do next, an empty state
is an invitation.

---

## IMPLEMENTATION PLAN

### Phase 1: Gates first

Write the id-contract gate before any markup moves, and fix the shared-chrome bug that is
currently failing two probes. After this phase the suite is 803+ green and the probe is **18/18**
— which is the baseline every later phase is measured against.

**Tasks:** create `test/screens.test.js`; `.topbar-nav { flex-wrap: wrap }`; record the probe
baseline.

### Phase 2: The token layer

**Depends on:** Phase 1 (nothing structural, but keep the commits readable).

Two non-colour tokens: the note's viewport-scaled height and the sticky row's scroll padding.
`test/tokens.test.js` reads hex tokens only, so no gate change is needed — state that in the
comment so the next reader does not go looking for one.

### Phase 3: `/clients` — structure

**Depends on:** Phase 2.

One wrapper element and two legend class swaps in `clients.html`. Every id, every frozen string
and every comment's reasoning survives.

### Phase 4: `/clients` — the CSS

**Depends on:** Phase 3.

The editor column's measure, the note height, the sticky save row, the zone heads, the
`.note-facts` hairline, the visibility row separators, and the locum block that has never existed.

### Phase 5: `/counts`

**Independent of:** Phases 3 and 4 — different files, different CSS block. Can be done first or in
parallel if you are splitting the work.

Mono body numerals, muted zeros, air in the rows.

### Phase 6: Validation

**Depends on:** everything above.

Full suite, the browser probe at 18/18, the manual pass (three widths, reduced motion, a full
keyboard path), and the CHECKLIST.md run.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

Every validation command below assumes:

```bash
NODE=~/.nvm/versions/node/v24.11.0/bin/node   # the ambient shell is Node 20.20.2; see VALIDATION
```

### Task Format Guidelines

Use information-dense keywords for clarity:

- **CREATE**: New files or components
- **UPDATE**: Modify existing files
- **ADD**: Insert new functionality into existing code
- **REMOVE**: Delete deprecated code
- **REFACTOR**: Restructure without changing behavior
- **MIRROR**: Copy pattern from elsewhere in codebase

---

### 1. CREATE `test/screens.test.js` — the id contract, before anything moves

- **IMPLEMENT**: A source-scan gate asserting that every `document.getElementById("x")` in
  `public/clients.js` has a matching `id="x"` in `public/clients.html`, and the same for
  `counts.js` / `counts.html`. Two tests, one per screen, each listing the missing ids in its
  failure message. Header comment states why: this ticket restructures the markup those files
  drive, and a dropped id is a screen that half-works with no error anywhere — `clients.js`'s
  `el` map (`clients.js:96-118`) resolves to `null` and the failure surfaces later as a
  `TypeError` in a click handler, or not at all.
- **PATTERN**: `test/chrome.test.js:21-33` for the imports and the `read` helper;
  `test/counts.test.js:26-27` for reading two files side by side; `test/tokens.test.js:94-96` for
  the message style.
- **IMPORTS**: `node:test`, `node:assert/strict`, `node:fs`, `node:path`, `node:url` only. No
  dependency — this repo's suite has none.
- **GOTCHA**: Match `id="x"` with the quote characters included, so a substring of a longer id
  cannot satisfy it (`id="locum"` must not be satisfied by `id="locum-list"`). Scope the scan to
  `clients` and `counts` only: `app.js` also queries ids that live on `/prep` pages, so widening
  it would fail for reasons that are not this ticket's.
- **VALIDATE**: `$NODE --test test/screens.test.js` → passes against the **current, unmodified**
  markup. If it fails now, the test is wrong, not the markup.
- **SATISFIES**: guards AC #1 and every later task in Phases 3-5.

### 2. UPDATE `public/app.css` — `.topbar-nav` wraps

- **IMPLEMENT**: Add `flex-wrap: wrap;` to `.topbar-nav` (`app.css:111-114`), with a comment
  recording the measurement: at a 360px viewport the four links measure 359px against a 328px
  content box (body padding is `--space-4` a side), so the nav overflowed the page by 15px on all
  three screens. `.topbar-inner` already wraps; the nav itself did not.
- **PATTERN**: `.topbar-inner` (`app.css:95-103`) already carries `flex-wrap: wrap` — this is the
  same fix one level down.
- **GOTCHA**: This is the **one** rule this ticket touches above line 264, and `#59` and `#62` are
  on the same file. Keep it to the single declaration and the comment. Say so in the PR body.
- **VALIDATE**:
  ```bash
  $NODE .claude/probes/clients-screen.mjs   # → 18/18 (baseline today is 16/18; H6 and V18t fail)
  ```
- **SATISFIES**: epic AC #3 (keyboard/screen-reader behaviour at least as good) and CHECKLIST's
  "MUST: responsive to 360px; no horizontal page scroll ever".

### 3. UPDATE `public/tokens.css` — the two non-colour tokens

- **IMPLEMENT**: In the layout section beside `--tap-target` (`tokens.css:131-141`):
  ```css
  /* The note box's height, taken from the viewport rather than from a row count. The floor is
     what `rows="16"` already renders — 16 rows at --text-note (16px) and line-height 1.5 is
     384px of text plus padding, so a window shorter than 770px is no worse than today and a
     tall one gets a real writing surface. The ceiling stops the box outgrowing the reader on a
     27" monitor. Nothing measures this: it is a comfort judgment, stated so it can be argued
     with. */
  --note-height: clamp(400px, 52vh, 640px);

  /* The sticky save row's own height, reserved as scroll padding so a control focused below it
     is not scrolled underneath it. --tap-target (44) + --space-3 above and below (12 + 12) +
     the hairline (1) = 69px, rounded up to the next 4px step. CHECKLIST.md names the top-side
     version of this trap (scroll-padding-top under sticky chrome); this is the bottom-side
     twin. Keep the two in step: change the save row's padding and this moves with it. */
  --sticky-save: 72px;
  ```
- **PATTERN**: `tokens.css:139-141` — the comment carries the arithmetic, the token carries the
  value.
- **GOTCHA**: `test/tokens.test.js` reads `--name: #hex;` declarations only (`tokens.test.js:24-32`),
  so neither token needs a gate entry. Write that in the comment so nobody adds a meaningless one.
  Use `vh`, not `dvh`: a dynamic viewport unit re-lays-out the note box as a phone's URL bar
  hides, which is motion nobody asked for.
- **VALIDATE**: `$NODE --test test/tokens.test.js test/chrome.test.js` → still green.
- **SATISFIES**: AC #1 (tokens only), AC #2 (the mechanism for editor comfort).

### 4. UPDATE `public/clients.html` — the `.note-facts` zone and the zone heads

- **IMPLEMENT**: Three edits, no id touched, no frozen string touched:
  1. Wrap the two fieldsets (`clients.html:100-120`, `#visibility` and `#locum`) in a single
     `<div class="note-facts">`. Add a comment saying what the wrapper is for: both fieldsets
     describe the **saved** note, and one hairline above the pair is the grouping whitespace
     alone cannot encode (CRAFT.md's licence for a rule).
  2. Change both `<legend class="field">` to `<legend class="zone-head">` — text unchanged
     ("What a candidate can see", "For locum supply").
  3. Leave everything else exactly as it is: both `.scaffold-line` paragraphs stay above the
     textarea (`clients.html:77-82` explains why, and the second one carries five frozen
     phrases), `rows="16"` stays on the textarea as the height floor for a browser that cannot
     resolve `clamp()`, the delete block stays where it is.
- **PATTERN**: the existing comment style in this file — every element that is somewhere
  non-obvious says why in an HTML comment.
- **GOTCHA**: `aria-describedby="visibility-hint"` / `"locum-hint"` are on the `<fieldset>`s and
  must stay there — a screen reader in forms mode announces only the legend beside each checkbox,
  which is why the hint is wired that way (`clients.html:96-99`). The wrapper is a plain `<div>`
  with no ARIA: two `<fieldset>`s inside a `<div>` keep their own groups.
- **VALIDATE**:
  ```bash
  $NODE --test test/screens.test.js test/counts.test.js
  grep -c 'class="field"' public/clients.html     # → 4 (was 6): the two legends are now zone-head
  ```
- **SATISFIES**: AC #1 (hierarchy), ticket scope "hierarchy".

### 5. UPDATE `public/app.css` — the editor column

- **IMPLEMENT**: In the `── the editor ──` block (`app.css:389-432`):
  ```css
  /* One measure for the whole column, so the note, the two readouts below it and the delete
     action share an edge and the column reads as a document rather than a stretched form.
     Measured: at --max-width (1024px) minus the 280px rail and the --space-8 gap the column is
     712px, which at --text-note is about 89 characters — past CRAFT.md's 65-75ch ceiling. 75ch
     lands at about 656px here. min-width: 0 above it stays: it is what stops a grid item being
     sized by its widest child. */
  .editor { max-width: 75ch; }

  /* Height from the viewport, not from the row count. See --note-height. resize: vertical is
     inherited from .textarea and stays — a recruiter with a very long note can still drag. */
  .editor .textarea { min-height: var(--note-height); }
  ```
  And in the same block, the sticky save row — desktop only:
  ```css
  @media (min-width: 860px) {
    /* Save and its live region stay in view for the whole length of a long note. Sticky rather
       than fixed so it releases at the end of the editor and never covers the delete action.
       Not applied under 860px: there the row wraps to two lines and would eat a third of a
       phone screen for a control that is one short scroll away anyway. */
    .editor .save-row {
      position: sticky;
      bottom: 0;
      background: var(--background);
      padding: var(--space-3) 0;
      border-top: var(--hairline) solid var(--border-hairline);
    }
    /* So a checkbox focused below the row is not scrolled under it. */
    html { scroll-padding-bottom: var(--sticky-save); }
  }
  ```
  Then the zone: `.note-facts` gets `margin-top: var(--space-12)`, `padding-top: var(--space-6)`
  and `border-top: var(--hairline) solid var(--border-hairline)`; `.note-facts .visibility`
  resets the bare rule's `margin-top: var(--space-12)` to `var(--space-8)` and to `0` for the
  first one. Add `.zone-head` to the existing `.rail-head, .agency-head` eyebrow rule and give it
  `margin-bottom: var(--space-2)`.
- **PATTERN**: `.agency .select` (`app.css:571`) for ancestor-scoped variants;
  `.rail-head` (`app.css:316-323`) for the eyebrow; `.agency` (`app.css:513-516`) for a zone with
  a rule above it.
- **IMPORTS**: none (CSS).
- **GOTCHA**:
  - `position: sticky` dies silently if any ancestor gets `overflow` other than `visible`. The
    chain is `#editor-body` → `.editor` → `.workspace` → `main` → `body`; all clear today. Do not
    add an `overflow` to any of them in this ticket.
  - `.save-row` is `/clients`-only (verified: `index.html` uses `.act-row`), but scope it under
    `.editor` anyway — cheap, and it survives someone reusing the class.
  - `.visibility` bare rules are act 4's too (`index.html:218-221`). Every visibility change in
    this ticket goes under `.note-facts` or `.editor`.
  - No `transition` in any of these rules. If you want the sticky row to fade its border in, it
    goes in the motion block at the foot of the file or `test/chrome.test.js` fails.
- **VALIDATE**:
  ```bash
  $NODE --test test/chrome.test.js
  $NODE .claude/probes/clients-screen.mjs        # still 18/18
  npm run dev                                    # then the manual checks in Level 4
  ```
- **SATISFIES**: AC #2 (note editor comfortable at real note lengths), AC #1, ticket scope
  "hierarchy, editing comfort, save feedback".

### 6. UPDATE `public/app.css` — the two readout lists

- **IMPLEMENT**: Under `.note-facts`, give both lists the same row grammar:
  - One separator rule for **both** lists, deliberately — they are the same component and both
    `<ul>`s carry `.visibility-list`, so a selector that hit only one would be the accident:
    ```css
    /* A long list of sections scans as rows rather than as a block. Both readouts take it: they
       are one component, and a separator on one list and not the other would read as a
       difference that means something. */
    .note-facts .visibility-list li + li {
      border-top: var(--hairline) solid var(--border-hairline);
    }
    ```
    Visibility rows otherwise keep exactly what they have — 44px minimum, right-aligned meta.
  - The locum block, which has no CSS at all today:
    ```css
    /* The locum checklist (#48) shipped with no rules, so its three spans ran together inline
       and .visibility-meta's `margin-left: auto` did nothing outside a flex row. Same component
       as the visibility rows above it, one column wider: the heading and the status on the
       first line, the hint under them, the "Add ## …" button on its own line at the end. */
    .note-facts .locum .visibility-list li {
      display: grid;
      grid-template-columns: 1fr auto;
      align-items: center;
      gap: var(--space-1) var(--space-3);
      min-height: var(--tap-target);
      padding: var(--space-2) 0;
    }
    ```
    with the hint span spanning both columns on row 2 (`grid-column: 1 / -1`) and its
    `margin-left` reset to `0` and `text-align: left` — the bare `.visibility-meta` pushes right,
    which is correct for a status and wrong for a hint. The button gets `justify-self: start`:
    a grid item fills its cell by default, so without it the "Add ## …" button stretches to the
    full column width and reads as a page-wide bar.
- **PATTERN**: `.visibility-list label` (`app.css:467-474`) — the row that already solved the
  44px floor and the long-heading wrap. Mirror its `min-width: 0` discipline.
- **GOTCHA**: This needs `renderLocum`'s children in grid order (task 7). Do the CSS and the JS in
  one commit or the intermediate state renders wrong.
  `.visibility-name` keeps `overflow-wrap: anywhere` — probe V18t drives a 120-character unbroken
  heading through this row at 360px and asserts nothing leaves the viewport.
- **VALIDATE**:
  ```bash
  $NODE .claude/probes/clients-screen.mjs    # V18t and M10 are the ones this can break
  ```
  Plus the manual check: `/clients` with a client whose note is missing three of the five locum
  headings — every row 44px, the status right-aligned, the button reachable.
- **SATISFIES**: AC #1, ticket scope "the shareable-field ticks that feed the candidate send".

### 7. UPDATE `public/clients.js` — `renderLocum`'s child order

- **IMPLEMENT**: In `renderLocum` (`clients.js:511-559`), append the children in the order the
  grid reads: `name`, `status`, `hint`, then the optional button. Give the hint span a second
  class so the CSS can tell the two metas apart — `meta.className = "visibility-meta
  locum-detail"` — and leave the status span as a bare `.visibility-meta`. Nothing else in the
  function changes. (`locum-detail`, not `locum-hint`: `id="locum-hint"` is already the
  fieldset's `aria-describedby` paragraph, and two different things under one name is not
  something this repo does.)
- **PATTERN**: `renderFields` (`clients.js:461-498`) builds its row the same way, appending in
  render order.
- **IMPORTS**: none.
- **GOTCHA**:
  - The focus-restoration block (`clients.js:514-520` and the `if (refocus) refocus.focus();` at
    558) stays exactly as it is. It is what stops a repaint dropping a keyboard user to `<body>`.
  - `field.hint` is server text (`src/note-fields.js`); do not rewrite it here.
  - Do not touch `paintFields`' version guard (`576-582`) — `renderLocum` is called from inside it.
  - `clients.js` must keep containing the literal `locum_fields` and
    `(el.note.value ? "\n\n" : "")` (`test/counts.test.js`).
- **VALIDATE**:
  ```bash
  $NODE --test test/counts.test.js
  $NODE .claude/probes/clients-screen.mjs    # 18/18
  ```
- **SATISFIES**: AC #1, and the row layout task 6 draws.

### 8. UPDATE `public/counts.js` — mark the zeros

- **IMPLEMENT**: In `render()` (`counts.js:88-99`), pass a second class on a zero cell so the CSS
  can quiet it: build the class as `"counts-number"` plus `" is-zero"` when the value is 0. Keep
  the comment at `94-96` — the zero is deliberate and the reason is load-bearing — and extend it
  with one sentence: the zero is still printed in full, only quieted, because "we know: the
  answer is none" is exactly what a blank cell would fail to say.
- **PATTERN**: `counts.js:74-79`'s `cell(tag, text, className)` already takes a class; this is one
  argument, not a new helper.
- **IMPORTS**: none.
- **GOTCHA**: **The forbidden-word scan covers everything outside `COPY`, comments included.**
  Do not write `attempt`, `habit`, `invite_id`, `email`, `competency`, `question` or `brief_json`
  anywhere in your new code or comments. "the number is none" is safe; "the question this answers"
  is not.
- **VALIDATE**:
  ```bash
  $NODE --test test/counts.test.js test/screens.test.js
  ```
- **SATISFIES**: AC #1, ticket scope "the prep-sent log made scannable".

### 9. UPDATE `public/app.css` — the counts table

- **IMPLEMENT**: In the `── the counts page ──` block (`app.css:949-1003`):
  ```css
  /* Mono for the numbers, which is the epic's rule for counts and data — and scoped to the body
     cells on purpose. DM Mono ships 400 only (fonts.css), and `.counts-table thead th` is 600:
     a 600 request against a single-weight family gets synthetic bold, not a real face. The
     header labels are words anyway, and words stay in the UI sans. */
  .counts-table tbody .counts-number { font-family: var(--font-mono); }

  /* A zero is printed in full and then quieted, so the eye lands on the numbers that are not
     zero. The digit still carries the information; the colour only ranks it. --text-muted is
     5.65:1 on --background, so this is a legible value and not a decorative grey. */
  .counts-number.is-zero { color: var(--text-muted); }
  ```
  Plus: raise the body cells' vertical padding from `--space-3` to `--space-4` (rows get air),
  keep the single `--border` rule under the head and the `--border-hairline` between rows, and add
  `white-space: nowrap` to `.counts-number` so a number column never wraps mid-figure.
- **PATTERN**: `app.css:995-1001` — the existing `.counts-number` rule and its comment.
- **GOTCHA**:
  - `.counts-number` is on the `<th scope="col">` header cells too (`counts.html:47-49`), which is
    why the mono rule is scoped `tbody`. Check the rendered header is still the sans 600.
  - `tabular-nums` stays even though DM Mono is fixed-width: it costs nothing and it is what keeps
    the fallback stack (`ui-monospace`, then a proportional last resort) aligned.
  - `.counts { max-width: 65ch; overflow-x: auto; }` stays — CRAFT's rule for wide content, and a
    four-column table with agency-authored names is the case it names.
- **VALIDATE**:
  ```bash
  $NODE --test test/chrome.test.js       # no raw hex, no stray transition
  npm run dev                            # then /counts: mono digits, header still sans-bold
  ```
- **SATISFIES**: AC #1, ticket scope "mono numerals, quiet table".

### 10. Copy pass on every changed string

- **IMPLEMENT**: Read every visible string on both screens against the register rules (SKILL.md,
  and CHECKLIST's "humanizer pass on all visible copy"). Change only what is genuinely unclear to
  a first-time recruiter, and for each change check the frozen inventory first. Expect this task
  to change **few or no** strings: both screens were written to this register already. If a
  frozen string must change, change its assertion in the same commit and say so in the PR body.
- **PATTERN**: `clients.js:32-94`'s `COPY` object — every string says what to do next, and the
  comments record why each one is worded as it is.
- **GOTCHA**: The two `.scaffold-line` paragraphs carry five frozen phrases; the `/counts`
  `.page-sub` carries two frozen sentences. Both are also the clearest copy on the screens — the
  right answer here is almost certainly "no change".
- **VALIDATE**:
  ```bash
  $NODE --test test/counts.test.js
  grep -n "—\|–" public/clients.html public/counts.html   # → no em or en dash in visible copy
  ```
- **SATISFIES**: AC #3 (plain language on every changed string).

### 11. Full validation and the manual pass

- **IMPLEMENT**: Run every command in **VALIDATION COMMANDS** below, then walk CHECKLIST.md end to
  end. Write the report to `.claude/reports/redesign-clients-and-counts-screens-report.md`
  following the shape of the existing reports in that directory.
- **VALIDATE**: all of Level 1-4 green; probe **18/18**; suite **802 baseline + new tests, 0 fail,
  0 skipped**.
- **SATISFIES**: every AC.

---

## TESTING STRATEGY

This repo's suite is `node --test` with no DOM and no dependencies, and the plan (like #58's)
does not add tooling to get one. So the split is: **file-parsing gates in `test/`** for anything
that is a property of the source text, and **the browser probe** for anything that is a property
of rendered geometry.

### Unit Tests

`test/screens.test.js` (new) — the id contract between each page and its script. Two tests:

- every `getElementById` in `clients.js` resolves to an `id=` in `clients.html`
- every `getElementById` in `counts.js` resolves to an `id=` in `counts.html`

Failure message lists the missing ids. Written before any markup moves, and must pass against the
current markup on the first run.

Existing suites that must stay green and are the real gates on this work:

- `test/counts.test.js` — the frozen prose, the two endpoints, the sinks, the nav, the locum
  scaffold phrases.
- `test/chrome.test.js` — no raw hex in `app.css`, no motion outside the guard.
- `test/tokens.test.js` — unchanged; the two new tokens are not colours.

### Integration Tests

`.claude/probes/clients-screen.mjs` — real Chrome over CDP with `window.fetch` stubbed. **Not part
of `npm test`; run it explicitly.** It is the only thing that measures the rendered screen, and
three of its eighteen probes are geometry:

| Probe | What it measures | Why this ticket can break it |
|---|---|---|
| H6 | no page scroll at 360px with a 120-character unbroken client name | any new fixed or wide element |
| M10 | `#save-button`, `#add-button`, `.radio-row label` all ≥44px | the save row's new padding |
| V18t | a 120-char heading and a 90-char reason stay inside 360px; every `#visibility-list label` ≥44px | the row-grammar changes in task 6 |

**Baseline measured during planning (2 Aug 2026): 16/18.** H6 and V18t fail on `main`, and on
`bb4cea4` before it — a pre-existing `.topbar-nav` overflow, not a #58 regression. Task 2 fixes
it; **the target for this ticket is 18/18** and that is an acceptance criterion.

### Edge Cases

- A client whose name is 120 characters with no spaces (probe H6's case) — the rail clips it, the
  editor head wraps it, neither scrolls the page.
- A note of 20,000+ characters — the box scrolls internally, the sticky Save stays put, the page
  does not grow a second scrollbar.
- A note with 15+ `##` headings — the visibility list's new separators at length; every row still
  44px.
- Two sections with the same heading — the row is listed, disabled, and its 90-character reason
  right-aligns inside 360px (probe V18t).
- All five locum headings missing — five rows each with an "Add ## …" button; the grid still reads
  as rows on a phone.
- A client with zero packs and zero sends on `/counts` — three muted zeros, and the empty-state
  line under the table.
- An agency with 40 clients on `/counts` — the table scrolls inside `.counts`, not the page.
- Reduced motion on — nothing on either screen animates; the save-state line appears instantly at
  full opacity.
- A 700px-tall laptop window — the note box is 400px (the clamp floor), Save is stuck to the
  bottom and visible without scrolling.

---

## VALIDATION COMMANDS

Execute every command to ensure zero regressions and 100% feature correctness.

**Node version, first.** The ambient shell is Node 20.20.2; `engines.node` is `>=22.5`. Under
Node 20 the suite reports 1 failure (`test/node-version.test.js`) and **160 skips** — a false
pass, not a partial one. Every command below uses the Node 24 on this machine:

```bash
NODE=~/.nvm/versions/node/v24.11.0/bin/node
$NODE --version    # → v24.11.0
```

### Level 1: Syntax & Style

The repo has no linter and no formatter — the tests are the style gates. These are the direct
checks:

```bash
# no stray motion. (The raw-hex check is test/chrome.test.js's — it strips comments first,
# which a grep cannot do, and this file's comments quote hex on purpose.)
grep -c "transition:" public/app.css                                         # → 6, all in the guard
grep -n "transition\|animation\|@keyframes" public/app.css | tail -8         # → all after the guard opens

# the locum block now exists
grep -c "locum" public/app.css                                               # → > 0 (was 0)

# nothing asks for a weight neither family ships
! grep -n "font-weight: 500" public/app.css

# mono is scoped to the body cells
grep -n "font-mono" public/app.css | grep counts                             # → tbody only

# the frozen inventory, spot-checked
grep -c 'id="' public/clients.html                                           # → unchanged count
grep -n "how many opened it" public/counts.html
grep -n "Nothing about what any candidate did." public/counts.html
grep -n "extension habits" public/clients.html
! grep -n 'href="/counts.html"' public/*.html

# no em or en dash in VISIBLE copy. Comments are stripped first and that is not a loophole:
# both files' comments use em dashes throughout (clients.html has two today) and comments are
# not visible copy. Same idiom as test/chrome.test.js:30.
python3 - <<'PY'
import re
for p in ("public/clients.html", "public/counts.html"):
    s = re.sub(r"<!--[\s\S]*?-->", "", open(p).read())
    hits = [l.strip() for l in s.splitlines() if "—" in l or "–" in l]
    print(p, "OK" if not hits else hits)
PY
```

### Level 2: Unit Tests

```bash
$NODE --test test/screens.test.js test/counts.test.js test/chrome.test.js test/tokens.test.js
```

### Level 3: Integration Tests

```bash
$NODE --test test/*.test.js                    # → 802 baseline + the new tests, 0 fail, 0 skipped
$NODE .claude/probes/clients-screen.mjs        # → 18/18 (baseline before task 2 is 16/18)
```

The probe needs Chrome at `/Applications/Google Chrome.app` and Node ≥22. It is **not** optional
on this ticket: it is the only gate that measures the rendered screen, and this ticket restructures
the screen it measures.

### Level 4: Manual Validation

```bash
npm run dev     # scripts/dev.py — wrangler pages dev on :8788, migrates the local D1 first
```

| Route / state | What specifically to look at |
|---|---|
| `/clients`, no client selected | The rail, the empty editor line, `Pack settings` at the foot. Nothing shifted from the redesign |
| `/clients?client=…`, short note | Three zones read as three zones: write the note · what a candidate can see · for locum supply. The eyebrow heads are uppercase caption, not field labels |
| `/clients`, a 4,000-character note | The box is viewport-tall, Save is stuck to the bottom and its state line beside it. Scroll to the delete button — the sticky row releases and never covers it |
| `/clients`, a note missing 3 locum headings | Rows read as rows: heading and status on line one, hint under, button after. Every row ≥44px |
| `/clients`, keyboard only | Tab from the note through Save, into the checkboxes, to Delete. **No focused control lands under the sticky row.** Focus rings visible on every stop |
| `/clients` at 390px | One column; no sticky row (under the 860px breakpoint); no horizontal scroll |
| `/counts` | Body numbers in mono, header labels in the sans at 600, zeros quieter than real numbers, rows with air, one rule under the head |
| `/counts`, 0 clients | The empty-state line reads as an invitation and the table head still makes sense |
| `/` | **Unchanged except the nav wrapping at 360px.** If anything else on `/` moved, a shared rule was edited that should not have been |

Then with **Reduce motion ON** (System Settings → Accessibility → Display): save a note on
`/clients` and confirm the state line appears instantly at full opacity, and that hovering a
button neither lifts nor shadows.

Widths to check on both screens: **1440 · 900 · 390**. The breakpoint is 860px.

### Level 5: Additional Validation (Optional)

- A browser's accessibility inspector on `/clients` — computed contrast on the muted zeros and on
  the eyebrow heads against `--surface`, which the token gate measures as values but not as a
  rendered composite.
- `jcodemunch` `get_blast_radius` on `public/app.css` to confirm no rule outside the ranges in the
  ownership table moved.
- Real Safari as well as Chrome for the sticky row and the `clamp()` height (CHECKLIST: "MUST:
  eyeball every new layout in real Safari AND real Chrome").

---

## ACCEPTANCE CRITERIA

Ticket #61's three, plus the epic clauses they inherit:

- [ ] **AC #1 — Tokens only, contrast gates pass, live regions preserved** (epic AC #1, #3).
      → tasks 3, 5, 6, 9. Gated by `test/chrome.test.js` (no raw hex, no stray motion) and
      `test/tokens.test.js`. Live regions: `#rail-state`, `#save-state`, `#visibility-state`,
      `#locum-state`, `#agency-state`, `#counts-state` all keep `role="status"` and stay outside
      any hidden subtree — asserted by `test/screens.test.js` for existence and by probes M3, M4,
      M7 and V18f for behaviour.
- [ ] **AC #2 — The note editor is comfortable at real note lengths; long notes do not fight the
      layout.** → tasks 3, 5. Measured, not asserted, at two window sizes with a 4,000-character
      note, because the two mechanisms bite at different ones:
      - **1440×1000** (the mechanism's case): the note box is ~520px, up from ~400 today — at
        least 20 lines visible — **and** Save plus its state line are on screen without scrolling.
        Both fail today.
      - **1280×700** (the floor's case): `clamp()` resolves to its 400px floor, which is exactly
        what `rows="16"` renders, so the box is deliberately **no worse and no better** than
        today; the whole win here is that Save and its live region stay in view. The height
        mechanism only does work above roughly a 770px-tall window, and that is intended — a
        short window should not get a shorter note box than it has now.
- [ ] **AC #3 — Plain language on every changed string.** → task 10, with the frozen inventory as
      the guard rail. Any frozen string that does change takes its assertion with it in the same
      commit.
- [ ] The `/clients` browser probe reports **18/18** (baseline 16/18).
- [ ] `$NODE --test test/*.test.js` → 802 baseline + the new tests, **0 fail, 0 skipped**.
- [ ] No horizontal page scroll at 360px on `/`, `/clients` or `/counts`.
- [ ] The single-source-of-truth rule holds: adding a client and writing a note still happen on
      `/clients` and nowhere else.
- [ ] `/` renders identically except for the nav wrapping at 360px.
- [ ] `.claude/skills/dossier-design/references/CHECKLIST.md` run end to end, MUSTs green.

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] All validation commands executed successfully
- [ ] Full test suite passes (802 + new, 0 fail, 0 skipped) on Node 24
- [ ] `.claude/probes/clients-screen.mjs` reports 18/18
- [ ] No linting or type checking errors (n/a — the tests are the gates)
- [ ] Manual testing confirms the feature at 1440, 900 and 390, with reduced motion on and off
- [ ] Acceptance criteria all met
- [ ] Code reviewed for quality and maintainability
- [ ] Report written to `.claude/reports/redesign-clients-and-counts-screens-report.md`

---

## OPEN QUESTIONS / ASSUMPTIONS

**Assumptions this plan makes:**

1. **#58 is the baseline.** It is merged on `feature/redesign-foundation` as `64f551e`; branch
   this ticket from there (or from `main` once #58 lands there).
2. **The rail's shared grammar does not change.** The ticket says the two client lists must keep
   reading as the same thing, and today they already do — `/` and `/clients` render the identical
   `.rail` component. The cheapest way to keep that true while #59 works in parallel is to leave
   the rail rules alone. If the implementer finds a rail change they cannot avoid, make it minimal
   and in place (no reordering, no renames) so the merge with #59 is a small conflict.
3. **The sticky save row is desktop-only** (≥860px). On a phone it would wrap to two lines and eat
   a third of the screen.
4. **No new colour is needed**, so `test/tokens.test.js` is untouched. If the implementation
   discovers it wants one (say, a quieter hairline for the new row separators), the token goes in
   `tokens.css` **and** into `tokens.test.js`'s `PAIRINGS` in the same commit — that is #58's
   rule, inherited.
5. **`counts.html` needs no change.** The zero class is applied in `counts.js`; the markup is
   already semantic (`<caption>`, `scope="col"`, `scope="row"`).

**Questions that would change the plan if answered differently:**

1. **Does #59 want the `.topbar-nav` fix instead?** It is shared chrome and one line. This plan
   takes it because two `/clients` probes currently fail on it, and a ticket that cannot reach
   18/18 has no clean gate. Coordinate in the PR body: if #59 has already fixed it in its
   worktree, drop task 2 and keep the probe assertion.
2. **Should the sticky save row ship at all?** It is the one mechanism here with a real failure
   mode (a Safari sticky quirk, or a focused control landing under it). If it misbehaves, drop to
   a non-sticky save row, keep the viewport-scaled box, record it in AMENDMENTS, and re-measure
   AC #2 — the box alone gets most of the way there.
3. **Is a totals row on `/counts` wanted after all?** Rejected here against epic #57's "no new
   features" non-goal, but the data is already fetched (`GET /api/events` returns `total`). If the
   owner wants it, it is a separate small ticket, not a scope stretch on this one.

---

## NOTES (open canvas)

### The 360px overflow — measured, diagnosed and fixed during planning

The probe suite reports **16/18 on `main` today**, and did so on `bb4cea4` before #58 as well, so
this is not a foundation regression. Both failures are the same fact: `document.documentElement.
scrollWidth` is 375 against a 360px viewport on `/clients`.

Walking every element wider than the viewport in headless Chrome found exactly two, and the second
is inside the first:

```
{ tag: "NAV", cls: "topbar-nav", w: 359, left: 16, right: 375 }
{ tag: "A",   cls: "",           w:  89, left: 286, right: 375 }   // "Candidate portal ↗"
```

`.topbar-inner` wraps, so the nav already drops to its own line; the nav itself does not wrap, so
its four links measure 359px against a 328px content box. Adding `flex-wrap: wrap` to
`.topbar-nav` and re-running the suite against a copy of `public/` gives:

```
PASS  H6   no horizontal page scroll at 360px with a 120-character unbroken client name
PASS  V18t a 120-char unbroken heading and a 90-char reason stay inside 360px, rows keep 44px
offenders: []   docSW: 360
```

Verified, not predicted. That is why task 2 is a one-line task with a hard number attached.

### The concept, in one sentence and one sketch

*The note is the document; everything else on the screen is apparatus.*

```
┌ topbar (nav now wraps at 360) ───────────────────────────────┐
│ Dossier engine      Submission pack · Client knowledge · …   │
└──────────────────────────────────────────────────────────────┘
  Client knowledge
  Write down how each client hires. Every pack for that client…

  ┌ CLIENTS ─────┐   St Mary's Imaging
  │ ▍St Mary's   │   ─────────────────────────────────────────── 75ch
  │  Note: 1,842 │   What we know about how they hire
  │  Kings Coll. │   Their process · who sits on the panel · …
  │  No note yet │   ┌───────────────────────────────────────┐
  │              │   │                                       │
  │ Client name  │   │   the note — clamp(400px, 52vh, 640)  │
  │ [__________] │   │                                       │
  │ [Add client] │   └───────────────────────────────────────┘
  └──────────────┘   ┌ sticky, desktop ──────────────────────┐
                     │ [Save note]      Saved 14:32          │
                     └───────────────────────────────────────┘
                     ───────────────────────────── .note-facts
                     WHAT A CANDIDATE CAN SEE
                     Nothing in this note reaches a candidate…
                     ☐ Their process              412 characters
                     ☑ Practical details          188 characters
                     ─────────────────────────────
                     FOR LOCUM SUPPLY
                     Credentialing quirks             In the note
                     VMS or portal            Not in the note yet
                       which portal, and who grants access
                       [Add ## VMS or portal to the note]

                     [Delete this client]
  ────────────────────────────────────────────────────────────
  PACK SETTINGS
```

Critique of the concept, per SKILL.md's two-pass rule — *would I have produced this for any
similar brief?* Partly, and the parts that are generic are deliberate: a measured column and a
sticky action bar are ordinary because they are correct. What is specific to this product is the
zone split. The note is one thing a person writes and **two** things the system reads from it —
what a candidate may see, and whether the five locum facts are recorded. Making those two readouts
one named zone below the writing surface, rather than two more form fields, is the screen stating
what this note is *for*. That is the same move the pack view makes with provenance, one screen down.

### Why the two readouts are not tabs, an accordion, or a right-hand column

- **Tabs / accordion** hide one readout behind a click. Both describe the saved note and both
  answer "is this note doing its job" — the answer to which should not need a click. CHECKLIST is
  explicit that provenance-shaped information is visible or one designed click away, never hidden.
- **A right-hand column** needs width the page does not have: `--max-width` is 1024px, the rail
  takes 280 and a third column would leave the note under 400px. Widening `--max-width` is a
  foundation change and belongs to #58, not here.
- **Below the note, in one zone**: costs one wrapper `<div>` and one hairline, and keeps the
  reading order a screen reader already gets right.

### Alternatives weighed and rejected

| Considered | Rejected because |
|---|---|
| `field-sizing: content` on the textarea (auto-grow, no JS) | Engine support is not universal enough to be the mechanism, and the fallback is the `rows` attribute — which is exactly what the `clamp()` min-height already improves on. Revisit when it is baseline |
| A JS auto-grow handler on `input` | Adds a resize on every keystroke to a file whose async behaviour is under eighteen probes. The comfort win over a viewport-scaled box is small |
| Sticky **rail** on desktop | The rail is not what you need while writing, and `.rail` is shared with `/` — a behaviour change to #59's screen for no benefit on this one |
| Mono for the saved-at timestamp in `.save-state` | The same element carries "Unsaved changes" and error text; mono for all of it is wrong, and splitting the string into a span costs JS for a small typographic win |
| A `<tfoot>` totals row on `/counts` | New information, and epic #57's non-goals forbid new features in the redesign. Noted in Out of Scope |
| Zebra striping the counts table | Would need a tint; `--tint-info` has no consumer by design (it is #60's), and `--text-muted` is 3.75:1 on it, under the floor. Hairlines and air do the same job with tokens that already exist |
| A README Decisions entry | The bar for that log is "decisions that would otherwise be re-litigated". Layout choices carrying their own measured comment meet the repo's dominant convention instead |

### Sequencing note for the parallel wave

Epic #57 runs #59, #61 and #62 in parallel after #58. All three touch `public/app.css`. The
ownership table under **CONTEXT REFERENCES** is what keeps that a three-way merge of disjoint
ranges. Two rules to hold to:

1. Do not reorder or reformat any block you are not changing. A whitespace-only diff in #59's
   range turns a clean merge into a conflict.
2. The one shared edit (`.topbar-nav`) goes in its own commit with its own message, so it can be
   dropped in a rebase if #59 got there first.

### What #60 inherits from this ticket

Nothing structural — #60 restyles act 3 on `/`, a different range of `app.css`. But the row
grammar this ticket settles (`grid`, 44px floor, hairline separators, a status right-aligned in
its own column) is the shape #60's claim rows will want, and `--tint-info` is still waiting for
its first consumer there.

---

## Confidence

**9.5/10** for one-pass success.

What earns it: every gate that can fail was read and run during planning (the suite at 802/802,
the probe at 16/18 with both failures diagnosed to a single rule and the fix verified against a
copy of `public/`); the frozen strings are enumerated with their assertion sites; the app.css
ownership split is stated as line ranges; and the one behavioural risk (the sticky row) has a
named fallback.

The half point: the sticky save row's interaction with focus scrolling is the only thing here that
cannot be settled by a file-parsing gate, and `--sticky-save` is a hand-computed number that will
drift if the row's padding changes. The manual keyboard pass in Level 4 is what catches it.

## AMENDMENTS

<!-- Append-only. Newest at the bottom. Leave empty until the plan is executed. -->
