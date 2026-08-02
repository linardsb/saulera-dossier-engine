# Feature: Redesign the Submission pack flow — acts 1, 2 and 4 (#59)

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

## Feature Description

Ticket #59 is the first **layout** ticket of epic #57. #58 landed the token layer (the zig.ai
palette, Geist + DM Mono, opt-in motion) but explicitly moved no layout: `AC #5 — no layout work
yet`. Every page therefore renders in new colours on the *old* hierarchy — 24px page headings,
12px uppercase act labels, 48px rhythm, a wrapping steps row. The result is a recoloured
scaffold, not the "generous, numbered-section feel" the epic decided.

This ticket re-lays out the build-a-pack journey on `public/index.html`:

1. **A display type step.** `--text-display: 35px` is added to the ramp and the page `h1` takes it.
   This is the token #58's Out of Scope hands forward by name ("a bigger display step is #59's
   call once it knows what it is setting").
2. **The acts become numbered sections rather than labelled strips.** `.act-head` stops being a
   12px uppercase tracked muted label and becomes a 20px sentence-case ink heading beside a larger
   numeral chip. This is the single change that carries "numbered sections".
3. **The rhythm opens up.** `--space-16: 64px` is added — the 4px-grid step above the current
   `--space-12` — and separates the acts and the page head from the work.
4. **The steps map becomes a real four-column band** instead of a wrapping inline row of chips.
5. **Act 1, act 2 and act 4 get their internal hierarchy fixed**: the two input labels are
   promoted to the size of the work they name, act 2's honest clock becomes the thing you can
   actually read across a room, act 4's two short fields pair into one row.
6. **The act entrance gains a subtle rise**, inside the existing `no-preference` block.

Act 3's internals (`.pack`, `.claim*`, `.mark*`, `.pack-*`) are **#60's** and are not touched.

## User Story

As **the recruiter building a submission pack with a client's name on it**
I want **the screen to read as a considered, paced document rather than a dense form**
So that **I can tell at a glance where I am in the journey, and I am not embarrassed to have the
tool open in front of the hiring manager.**

## Problem Statement

Four specific problems, each measurable against the current file:

- **The act headings are quieter than the body text they introduce.** `.act-head`
  (`app.css:598-609`) is `--text-caption` (12px), `text-transform: uppercase`, `letter-spacing:
  0.08em`, `color: var(--text-muted)` — the same treatment as `.rail-head`, which labels a
  *sidebar*. The three things a recruiter is actually doing on this page are labelled more
  faintly than the hint text under a file picker. There is no hierarchy to read.
- **The page head is the same size as a section heading elsewhere.** `h1` is `--text-h2` (24px);
  `h2` is `--text-h3` (20px). A four-point gap between the page's title and a subheading is not a
  ramp, and the epic's decided direction is explicitly "big type".
- **The steps map reads as a paragraph, not a map.** `.steps` (`app.css:271-286`) is
  `display: flex; flex-wrap: wrap` with `gap: var(--space-2) var(--space-6)` over four full
  sentences. At 1024px the four steps wrap into two ragged lines and the numbers stop being
  scannable — the one job the map has (`index.html:39-43`: "the whole journey, visible before any
  of it happens").
- **The rhythm tops out at 48px.** `--space-12` separates the acts *and* the page head *and* the
  `.visibility` fieldset *and* `.editor-remove`. When the largest available step is also the
  third-largest in use, "generous" is not expressible.

## Solution Statement

Two additive tokens and a set of scoped restyles. No structural rewrite.

`--text-display: 35px` (the ramp's next 1.2 step above `--text-h1: 29px`) and `--space-16: 64px`
(the 4px grid's next step above 48) are added to `tokens.css`. Neither is a colour, so
`test/tokens.test.js` is untouched.

`.act-head` is rewritten as a real section heading — `--text-h3`, weight 600, `--text-primary`,
sentence case — and `.act-num` grows from 20px to 24px so the numeral holds its own beside it.
That pair *is* the "numbered sections" of the decided direction; nothing else in the file needs
to change for it to read.

`.steps` becomes a four-column grid at ≥860px, each step a number over its label, collapsing to
number-beside-label rows on a phone. `.page-head` and `.act + .act` take `--space-16`.

Act 1's two input labels get a scoped promotion (`.input-pair .field` → `--text-h4`,
`--text-primary`); act 2's clock gets one (`.act-head-row .elapsed` → `--text-h3`); act 4's date
and email pair into a `.field-pair` row.

The act entrance gains `transform: translateY(var(--space-2))` alongside its existing opacity
fade — compositor-only, added to the transition already inside the `no-preference` block at
`app.css:1036`, so `test/chrome.test.js` stays green by construction.

**`public/app.js` is not touched.** Every id and every class hook it reads survives verbatim.

## Out of Scope / Non-Goals

- **Not changing: the four-act sequence, `setPhase`'s phase model, or either generate route.**
  The ticket permits a restructure ("the four-act structure may be restructured where a clearly
  better pattern exists"). This plan **declines that licence** — the reasoning is in
  **OPEN QUESTIONS / ASSUMPTIONS #1**, and it is a decision, not an oversight.
- **Not changing: `public/app.js`.** Not one line. The ticket says "keep hooks stable or update in
  lockstep"; keeping them stable is the half that cannot regress. A live progress marker on the
  steps map was designed and rejected — see **NOTES → The steps map as a live progress
  indicator**.
- **Not included: act 3's internals.** `.pack`, `.pack-*`, `.claim*`, `.mark*`, `.summary-*`,
  `.renderer-note` and the `@media (max-width: 600px)` block at `app.css:842-845` are **#60's**.
  This ticket restyles the container the pack sits in (`.stage`, `.act`, `.act-head`,
  `.act-head-row`, `.act-row`) and act 3 inherits those — which is intended, and is why #60
  depends on #59.
- **Not included: `/clients`' own components.** `.editor*`, `.scaffold-line`, `.agency*`,
  `.radio-*`, `.visibility-empty`, `.save-row`, `.counts*` are **#61's**. See
  **NOTES → The app.css ownership split** — this is a live merge hazard, because #59 and #61 run
  in parallel worktrees on the same file.
- **Not included: `public/prep/*`.** #62's.
- **Not included: any colour change.** The palette is decided and measured (#58). No token in
  `tokens.css` changes value; two non-colour tokens are added.
- **Not included: a fluid/`clamp()` type scale.** The repo has no fluid type anywhere. A
  `max-width: 859px` override is the idiom already in the file.
- **Not changing: `--max-width: 1024px`, `--tap-target`, `--ease-out`, `--duration-*`,
  `--focus-*`, or any existing `--space-*` / `--text-*` value.**
- **Not changing: the topbar.** `test/counts.test.js:119-131` asserts all three screens carry the
  same three-link nav. It is shared chrome and #58 just restyled it.

## Feature Metadata

**Feature Type**: Enhancement (a layout and hierarchy redesign; no behaviour changes)
**Estimated Complexity**: Medium — no algorithmic risk and no JS, but the diff lands in a file
three parallel tickets are editing, and half of it is shared chrome other pages inherit.
**Primary Systems Affected**: `public/index.html`, `public/app.css`, `public/tokens.css`
(two additive tokens), `README.md`
**Dependencies**: None new. No build step, no framework, no CDN, no package (epic AC #5).

## Related Work

**Implements**: [#59](https://github.com/linardsb/saulera-dossier-engine/issues/59)   ·
**Epic**: [#57](https://github.com/linardsb/saulera-dossier-engine/issues/57) — the epic issue
*is* the architecture record; there is no separate `engineering-plan.md`. Its "Direction",
"Decided palette" and "Decided typography" blocks are inherited, not re-decided.

**Back-references** (plans this builds on or inherits decisions from):

- `.claude/plans/redesign-foundation-tokens-fonts-chrome.md` — Why: **the direct dependency
  (#58).** Read its *Open Questions 5 and 6* and its *NOTES → What #60 inherits* before starting.
  This plan closes its open question 5 (`--radius`) and spends the `--text-display` step its Out
  of Scope reserved for #59.
- `.claude/plans/ux-ui-uplift.md` — Why: the plan that created `tokens.css` and `app.css`'s
  component grammar, and the "branding is a variable swap, never a fork" rule that keeps every
  value in this ticket a token.
- `.claude/plans/least-friction-loop.md` / `.claude/plans/in-ui-generation.md` — Why: the two
  plans that built the four acts and act 2's two modes. The *reasons* recorded in
  `index.html`'s comments come from these; the ticket says those decisions survive the redesign.
- `.claude/plans/send-to-candidate.md` — Why: act 4's date gate and the two-step preview
  (architecture decisions 9 and 15). This plan restyles that act and changes none of it.

**Forward-references** (plans that extend or supersede this — append as follow-ups get created):

- #60 (act 3 as a Canopy-style provenance page) depends on this and inherits the act shell.
- #61 (`/clients`, `/counts`) and #62 (portal shell) run in parallel and inherit the shared-chrome
  half of this diff — see **NOTES → The app.css ownership split**.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `public/index.html` (whole file, 240 lines) — Why: the markup being re-laid-out. **Read every
  comment before editing.** The ticket is explicit that these decisions survive: the steps map's
  purpose (39-43), the rail's no-add-client rule (54-56), the two-routes-primary-first row
  (107-110), the clipboard fallback (117-119), act 2's two modes (126-130), the per-second clock
  being `aria-hidden` (134-136), the repeated Claude link (148-150), and act 4's date gate
  (186-191). If your change makes one of those comments false, the comment must change with it
  and the PR must say so.
- `public/app.css` lines 264-303 — Why: **`.page-head` (266), `.page-sub` (267), `.steps`
  (271-286), `.workspace` (288-299)** — three of the four are shared with `clients.html` and
  `counts.html`. This is the shared-chrome half of the ticket.
- `public/app.css` lines 573-654 — Why: **the act shell, the heart of this ticket.** `.stage`
  (579), `.act + .act` (585), `.act` / `.act.is-entering` (590-594), `.act-head` (598-609),
  `.act-num` (614-627), `.act-head-row` (629-638), `.act-note` (640-645), `.act-row` (647-653).
  Note the comment at 583-584: *"There is not one rule between these three sections"* — the
  pacing is whitespace by decision, and this plan keeps that.
- `public/app.css` lines 596-597 — Why: the comment that ties `.act-head` to `.rail-head` as "one
  grammar". **This plan breaks that pairing on purpose** and the comment must be rewritten, not
  deleted. The argument is in Task 4.
- `public/app.css` lines 655-715 — Why: act 1. `.input-pair` (657-664), `.input-col` (667),
  `.file-row` (669), `.file-label` (671-677), `.file-input` (683-704), `.input-col.is-dragover`
  (710-713), `.fallback` (715).
- `public/app.css` lines 717-734 — Why: act 2. The mode rules `#act-waiting .generating-only` /
  `.is-generating` (722-724) — **`display`, not `visibility`, and the comment says why**; and
  `.elapsed` (729-734), which act 4 also uses for `#send-elapsed`.
- `public/app.css` lines 873-947 — Why: act 4. `.send-preview` (878), `.strike-*` (884-911),
  `.send-fields` (913-915), `.send-legend` (917-921), `.send-fields-note` (923-928),
  `.send-field-row` (933-940), and the `#interview-date, #candidate-email { max-width: 32ch }`
  rule at 944-947 that Task 8 replaces.
- `public/app.css` lines 434-507 — Why: `.visibility` and `.visibility-list` are **shared**: act 4
  uses them for the send-fields block (`index.html:218-223`) and `/clients` uses them for the
  per-section toggle. Touching either is a #61 collision. Read 456-461 in particular: the
  `[hidden]` override exists because an author `display: flex` beats the UA's `[hidden]`.
- `public/app.css` lines 1005-1015 — Why: the `@media (max-width: 859px)` mobile-density block.
  Every new spacing value this ticket adds needs its phone counterpart here.
- `public/app.css` lines 1017-1051 — Why: **the motion block, and the only place a `transition`
  may be declared.** Read the whole comment: it states the `no-preference` edge precisely and says
  #59 will copy it. `.act`'s transition is at 1050.
- `public/app.css` lines 72-83 — Why: the ONE `:focus-visible` rule for the deployment. Nothing in
  this ticket may add a second. Any element whose size or padding you change is an element whose
  focus ring you have just resized.
- `public/tokens.css` lines 101-110 — Why: the type ramp and its comment (a ~1.2 step from a 14px
  UI base). Task 1 adds one step to it and the comment's arithmetic must stay true.
- `public/tokens.css` lines 131-141 — Why: the 4px grid and `--tap-target`. Task 1 adds
  `--space-16`. Note 138-141: `--tap-target` is deliberately off-grid; do not "tidy" it.
- `public/tokens.css` lines 135-136 — Why: `--radius: 9px` / `--max-width`. #58's open question 5
  asks #59 or #60 to decide the radius once. Task 1 decides it (keep 9px) in a comment.
- `public/app.js` lines 237-281 — Why: **the element map. Every id in it must survive your
  markup edit.** This is the list to diff against.
- `public/app.js` lines 410-426 (`showAct`) — Why: the entrance mechanism — `hidden = false`, then
  `.is-entering` removed after a double `requestAnimationFrame`. Task 9 adds a transform to that
  entrance; read this to confirm for yourself nothing waits on `transitionend`.
- `public/app.js` lines 434-469 (`setPhase`) — Why: the phase model this plan deliberately does
  not touch. It shows/hides five sections by id, drives the clock, `updateSendGate`,
  `setBusy(el.readPack)` and `scrollIntoView`. Read it so you understand what a restructure would
  have cost.
- `public/app.js` lines 1777-1800 (`wireDrop`) — Why: it calls `el.brief.closest(".input-col")`.
  **`.input-col` is a JS hook, not just a style hook.** If your markup moves the textarea out of
  its `.input-col`, drag-and-drop silently dies with no error.
- `public/clients.html` and `public/counts.html` — Why: the two other consumers of `.page-head`,
  `.page-sub`, `.workspace`, `.rail*`, `.visibility*`, `h1`. Open them after every shared-chrome
  edit. You are not restyling them, but you are changing what they inherit.
- `test/chrome.test.js` (whole file, 130 lines) — Why: **the gate that bites hardest here.**
  Test 1 (line 45): every `transition`/`animation`/`@keyframes` must sit inside the
  `no-preference` block. Test 2 (line 73): no raw hex in `app.css`. Test 3 (line 85): no raw hex
  in any page-scoped `<style>` block.
- `test/counts.test.js` lines 119-131 — Why: `index.html` must keep `href="/"`, `href="/clients"`
  and `href="/counts"`, and must not use `href="/counts.html"`. A topbar edit trips this.
- `test/prep-registry.test.js` lines 799-819 — Why: the selector-clash tripwire. It parses every
  selector string out of `app.css` and `prep.css` and asserts the intersection is empty. **Every
  new selector you add to `app.css` is a candidate collision.** Verified at plan time: `prep.css`
  owns `.brief`, `.brief .page-head`, `.brief .page-head h1`, `.session .page-head h1`,
  `.brief-cta`, `.block*`, `.help-*`, `.prep-*`, `.session` — none of this plan's new selectors
  collide, but run it early anyway.
- `.claude/skills/dossier-design/references/CRAFT.md` — Why: the numeric craft rules this repo
  builds to. Sections that bind this ticket directly: **Typography** (the 1.2 ramp and its exact
  values — `--text-display` must be the next step, not a round number), **Spacing & layout**
  ("rhythm between zones must be visibly larger than spacing within them"; `min-width: 0` on
  anything holding pasted prose), **Motion** (compositor props only, ease-out, never
  `transition: all`), **Interactive states** (all six, ≥44px touch targets, responsive to 360px).
- `.claude/skills/dossier-design/references/CHECKLIST.md` — Why: run it before committing. The
  skill's own instruction.

### New Files to Create

**None.** This ticket adds no file and deletes no file. If you find yourself creating a
stylesheet, stop — `app.css` is the one component file and `prep.css`'s header states the
"supplements, never restates" contract that makes a second file a clash.

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [MDN — CSS grid `grid-template-columns` / `repeat()`](https://developer.mozilla.org/en-US/docs/Web/CSS/grid-template-columns)
  - Specific section: `repeat()` with `1fr` tracks
  - Why: Task 5 turns `.steps` into a four-column band. `repeat(4, 1fr)` gives equal columns
    regardless of label length, which is what makes the numbers scannable down a row.
- [MDN — `prefers-reduced-motion`](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion)
  - Specific section: the `no-preference` value
  - Why: `no-preference` is **not** the negation of `reduce`. A UA reporting no support for the
    preference matches neither and gets no transition at all — every element renders at its final
    state instantly. `app.css:1027-1034` already states this precisely; your new transform must
    be safe under it (it is: `showAct` removes `.is-entering` unconditionally).
- [MDN — `transform` creates a containing block](https://developer.mozilla.org/en-US/docs/Web/CSS/transform#specifications)
  - Specific section: "a value other than `none` establishes a containing block for
    `position: fixed` and `position: absolute` descendants"
  - Why: Task 9 puts a transform on `.act.is-entering`. Verified at plan time: nothing inside any
    act is `position: fixed` or `position: absolute`, so this is inert — but know the rule before
    you add a positioned child later.
- [WCAG 2.2 SC 1.4.10 Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html)
  - Specific section: content at 320 CSS px without two-dimensional scrolling
  - Why: the responsive half of the ticket. `.steps` as a four-column grid must collapse, and a
    35px `h1` must not force horizontal scroll at 360px.
- [WCAG 2.2 SC 1.4.12 Text Spacing](https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html)
  - Why: the act headings lose `letter-spacing: 0.08em` in this ticket. Losing tracking is always
    safe; adding it is what this criterion constrains.
- [CSS Fonts Module Level 4 — font matching, §5.2 `font-weight`](https://www.w3.org/TR/css-fonts-4/#font-style-matching)
  - Specific section: "If the desired weight is inclusively between 400 and 500 … weights less
    than the target weight are checked in descending order"
  - Why: **the repeat gotcha from #58.** Geist ships 400 and 600 only. Any `font-weight: 500` you
    write renders at **400**. `tokens.css:95-96` records this; `app.css` has zero 500s left and
    must keep it that way.

### Patterns to Follow

**Every value is a token. There is no raw literal in `app.css`.** This is the file's opening
claim (`app.css:1-9`) and `test/chrome.test.js:73` gates the colour half of it. If a number you
want does not exist as a token, **add the token** — that is Task 1's whole job:

```css
.act-head {
  font-size: var(--text-h3);
  margin: 0 0 var(--space-6);
}
```

**A comment states the measured reason, not the intent.** The house register, from
`app.css:393-397`:

```css
/* A client name is agency-authored, capped at 120 characters, and need contain no spaces at
   all. Overflowing text does not widen its own border box, so `.editor { min-width: 0 }` above
   does not catch this and neither does any measurement of element geometry — only the page's
   scrollWidth shows it. Measured before this rule: a 120-character unbroken name scrolled the
   page 1,338px at a 360px viewport. */
```
Every rule you change gets one of these, and **if you reverse a decision the file already
records, say so in the comment rather than quietly deleting the old one.** Task 4 does exactly
this to `app.css:596-597`.

**Mobile-first base, `min-width: 860px` for the two-column shape.** Three existing blocks follow
it (`app.css:294`, `548`, `662`), with `max-width: 859px` at 1010 for density trims. Do not
introduce a fourth breakpoint value.

```css
.input-pair { display: grid; gap: var(--space-6); }
@media (min-width: 860px) { .input-pair { grid-template-columns: 1fr 1fr; } }
```

**Transitions live in exactly one place** — the block at `app.css:1036`. Never on the rule:

```css
@media (prefers-reduced-motion: no-preference) {
  .act { transition: opacity var(--duration-2) var(--ease-out); }
}
```

**Section rules use the box-drawing comment banner**, padded to the same column:

```css
/* ── act 1: the inputs ─────────────────────────────────────────────────────────────────── */
```

**Naming: classes describe the ROLE in this product's vocabulary**, kebab-case, prefixed by their
zone — `.act-head`, `.act-num`, `.send-preview`, `.strike-label`. Not `.h-lg`, not `.mt-16`.
There is not one utility class in this file and this ticket adds none.

**British English in prose, American in CSS identifiers.** Comments say "colour"; the property is
`color`.

---

## IMPLEMENTATION PLAN

Phases run **top to bottom by default**.

### Phase 1: The two tokens

`tokens.css` gains `--text-display` and `--space-16`, and records the `--radius` decision #58
handed forward. Nothing consumes them yet, so this phase is inert and independently verifiable:
the full suite must still be green after it.

**Tasks:**

- Add `--text-display: 35px` to the type ramp with its arithmetic in the comment.
- Add `--space-16: 64px` to the 4px grid.
- Close #58's open question 5 in a comment on `--radius`.

### Phase 2: Shared chrome — the page head and the workspace

**Depends on:** Phase 1.

The half of the diff `/clients` and `/counts` inherit. Done second and on its own so that if the
owner wants it scoped back to `/`, it is one commit to revert rather than a thread through the
act work.

**Tasks:**

- `h1` takes `--text-display`.
- `.page-head` takes `--space-16`.
- `.workspace` column gap opens at ≥860px.
- Their `max-width: 859px` counterparts.

### Phase 3: The act shell — numbered sections

**Depends on:** Phase 2 (the page head sets the top of the ramp the act heads sit under).

The change that carries the epic's decided direction. `.act-head` becomes a heading; `.act-num`
grows to match; the rhythm between acts opens to `--space-16`.

**Tasks:**

- Rewrite `.act-head` and the comment that ties it to `.rail-head`.
- Grow `.act-num`.
- `.act + .act` takes `--space-16`.
- `.act-head-row` alignment for the new heading size.

### Phase 4: The steps map

**Depends on:** Phase 3 (the map must read as a quieter echo of the act heads, so those exist
first).
**Independent of:** Phases 5-7 — different selectors, different markup block. Not worth
parallelising: same two files.

**Tasks:**

- Add `.step-label` spans in `index.html`.
- `.steps` becomes a four-column band at ≥860px, rows on a phone.

### Phase 5: Act 1 — the inputs

**Depends on:** Phase 3.

**Tasks:**

- Promote the two input labels.
- Open the space between the pair and the action row.

### Phase 6: Act 2 — the wait

**Depends on:** Phase 3.

**Tasks:**

- The clock becomes readable at a glance.
- The generating note takes reading size.

### Phase 7: Act 4 — send to candidate

**Depends on:** Phase 3.

**Tasks:**

- Pair the date and email fields into one row.
- Open the preview zone's rhythm.

### Phase 8: Motion

**Depends on:** Phases 3-7 (it animates elements those phases resize).

**Tasks:**

- Add the rise to `.act.is-entering` and `transform` to its transition inside the guard.

### Phase 9: The record and the pass

**Depends on:** Phases 1-8.

**Tasks:**

- `README.md` Decisions entry.
- Full suite, the eight-page manual pass, the reduced-motion pass, the 360px pass.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

> **Before you start — the validation command.** The ambient shell runs **Node 20.20.2**, below
> `engines.node` (`>=22.5`). Under it the suite reports a `test/node-version.test.js` failure and
> ~160 skips — a *pre-existing shell condition*, not something you caused. Use Node 24:
>
> ```bash
> NODE=~/.nvm/versions/node/v24.11.0/bin/node
> $NODE --test test/*.test.js
> ```
>
> **Baseline verified on this worktree at plan time (2 Aug 2026, HEAD `64f551e`):
> 802 pass, 0 fail, 0 skipped.** No task in this plan adds or removes a test, so 802/0/0 is the
> expected result after every single task below. A different number means you broke something.

> **Before you start — the branch.** Repo memory: parallel sessions share this worktree and HEAD
> moves underneath you. The current branch is `feature/redesign-foundation` (#58's, already
> merged as `64f551e`). **Branch from `main`**, verify with `git branch --show-current` before
> every commit, and never `git add -A` — there are four untracked files in the tree that are not
> yours (`.claude/code-reviews/pr-5{1,2,3}-review.md`, `docs/handover-louis-meeting.md`).

### Task Format Guidelines

Use information-dense keywords for clarity:

- **CREATE**: New files or components
- **UPDATE**: Modify existing files
- **ADD**: Insert new functionality into existing code
- **REMOVE**: Delete deprecated code
- **REFACTOR**: Restructure without changing behavior
- **MIRROR**: Copy pattern from elsewhere in codebase

---

### 1. UPDATE `public/tokens.css` — the display step, the rhythm step, and the radius decision

- **IMPLEMENT**: Three edits, all additive. No existing value changes.
  1. **`--text-display: 35px`**, added to the type ramp **above** `--text-h1` (`tokens.css:110`),
     so the ramp reads bottom-up as it does today. The comment must carry the arithmetic: the
     ramp is a ~1.2 step from a 14px UI base, `--text-h1` is 29px, and 29 × 1.2 = 34.8 → **35**.
     Say what it is for: the page `h1` on every recruiter screen, which was `--text-h2` (24px) —
     the epic's decided "big type", and the step #58's Out of Scope reserved for this ticket by
     name.
  2. **`--space-16: 64px`**, added to the 4px grid at `tokens.css:132-133`. The comment says what
     it is for: the rhythm **between** the acts and under the page head, one step above the
     `--space-12` that previously had to serve as both the largest gap and a common one. Cite
     CRAFT.md's rule — rhythm between zones must be visibly larger than spacing within them — and
     note that 48px was doing both jobs.
  3. **`--radius: 9px` — a comment only, no value change.** #58's open question 5 asks #59 or #60
     to decide the corner radius once, because the two references disagree (zig.ai soft,
     forcanopy tighter). **Decided: 9px stays.** The reason, written into the file: the epic
     assigns zig.ai the *feel* of this flow and forcanopy only the *pattern language of the pack
     view*, so a soft radius is the correct answer for the surfaces #59 owns; 9px is already
     that. If #60 needs a tighter corner for the Canopy claim chips it should add a `--radius-sm`
     rather than move this one, because this one is on the card, the rail, the pack, every input
     and every button.
- **PATTERN**: `tokens.css:101-110` (the ramp and its comment) and `tokens.css:131-141` (the grid,
  and `--tap-target`'s "off the 4px grid deliberately" note) are the exact register.
- **IMPORTS**: n/a.
- **GOTCHA**: Neither new token is a colour, so `test/tokens.test.js` needs **no edit**. Its
  `PAIRINGS` / `SURFACES` / `TINTS` tables are explicit lists and its "the palette is measurable"
  test (line 174) only iterates those — it does not sweep the file. Confirm this by running the
  file; do not "helpfully" add the new tokens to a table, because a size is not a contrast pair
  and the gate would throw on a non-hex value.
- **GOTCHA**: Do **not** touch `--text-h1` … `--text-caption`, `--space-1` … `--space-12`,
  `--max-width`, `--tap-target`, or any colour. Every one of them is measured or decided
  elsewhere and this ticket's licence is additive.
- **GOTCHA**: `--tap-target: 44px` sits *below* the grid with a comment saying it is off-grid on
  purpose. Put `--space-16` with the other `--space-*` values, above that comment, or the comment
  stops pointing at what it describes.
- **VALIDATE**:
  ```bash
  $NODE --test test/tokens.test.js test/chrome.test.js   # green, unchanged
  grep -n "text-display\|space-16" public/tokens.css     # → 2 definitions
  $NODE --test test/*.test.js                            # → 802 pass, 0 fail, 0 skipped
  ```
- **SATISFIES**: AC #1 (new type/spacing come from tokens, not literals). Closes #58's OQ5.

### 2. UPDATE `public/app.css` — `h1` takes the display step

- **IMPLEMENT**: At `app.css:36-43`, `h1 { font-size: var(--text-display) }` and add
  `letter-spacing: -0.02em`. Keep `font-family`, `font-weight: 600`, `line-height: 1.2`,
  `margin`, `text-wrap: balance` exactly as they are.

  Rewrite the comment above the type section (`app.css:31-35`) to add the second fact: the
  weight-600 reasoning stays verbatim (it is #58's and still true), and a sentence is added
  saying the page title now takes the ramp's top step, that this is **shared chrome every
  recruiter screen inherits** (`/`, `/clients`, `/counts`, `404.html`), and that
  `prep/prep.css:37-42` already overrides `h1` to `--text-h1` on the two portal pages that carry
  a role title, so the portal is unaffected there.
- **PATTERN**: `prep.css:34-42` sets `letter-spacing: -0.02em` on its own top-step heading with
  the comment "still the ramp, never a one-off size". Same tightening, same reason: optical
  tracking correction at display size.
- **GOTCHA — the blast radius is four pages, and it is deliberate.** `h1` is a bare element
  selector. `/clients` ("Client knowledge"), `/counts` ("Prep sent") and `404.html` all get a
  35px heading from this one line. That is the epic's AC #1 ("one token set drives both
  surfaces") working as intended, and #61 inherits rather than fights it. **It is also the one
  edit in this plan an owner might want scoped back** — the one-line alternative is in
  OPEN QUESTIONS #3. Note it in the PR body either way.
- **GOTCHA**: `prep/index.html`, `prep/login.html` and `prep/privacy.html` do **not** override
  `h1` and will also render at 35px. On a phone (the portal's assumed context, epic AC #4) that
  is acceptable-to-good, not a regression — but look at all three in the manual pass and say so
  in the PR. They are #62's to tune.
- **GOTCHA**: Do not touch `h2` (`app.css:45-52`). `.pack-role` (`app.css:769`) and the act
  headings are the two things that would move, and both belong to a later task or another ticket.
- **VALIDATE**:
  ```bash
  grep -n "text-display" public/app.css      # → exactly 1 hit, in the h1 rule
  $NODE --test test/chrome.test.js           # no raw hex introduced
  $NODE --test test/*.test.js                # → 802 / 0 / 0
  ```
- **SATISFIES**: AC #1 (tokens only), and the epic's "big type" direction.

### 3. UPDATE `public/app.css` — the page head and workspace rhythm

- **IMPLEMENT**: Two rules in the layout section (`app.css:264-303`).
  1. `.page-head { margin-bottom: var(--space-16); }` — was `--space-12`.
  2. `.workspace`: keep `display: grid; gap: var(--space-8)` as the base (phone: the rail sits
     above the work and 32px is already a zone break there), and inside the existing
     `@media (min-width: 860px)` block at line 294 add `gap: var(--space-12);` beside the
     `grid-template-columns` it already sets. A 48px gutter between the rail and the stage is
     what makes the two read as chrome-and-work rather than two columns of a table.
  3. In the `@media (max-width: 859px)` block (`app.css:1010-1015`), the existing
     `.page-head { margin-bottom: var(--space-8); }` line **already handles the phone case** —
     verify it is still there and still correct after edit 1. Do not duplicate it.
- **PATTERN**: The mobile-density block's own comment (`app.css:1007-1009`): "every wasted pixel
  in it pushes the inputs further off the first screen". Any desktop generosity you add needs its
  counterpart there, and this is why.
- **GOTCHA**: `.page-head` and `.workspace` are **shared with `clients.html`**, and `.page-head`
  with `counts.html` and `404.html` too. `/clients` has the same rail-plus-work shape, so the
  48px gutter is right there as well — but open it and check rather than assuming.
- **GOTCHA**: `prep.css:32` sets `.brief .page-head { margin-bottom: var(--space-12) }` and
  `prep.css:236` overrides it at its own breakpoint. Those are descendant selectors, so they win
  on the portal and **no clash is introduced** — `test/prep-registry.test.js:799` compares
  selector strings, and `.brief .page-head` ≠ `.page-head`. Run it anyway.
- **VALIDATE**:
  ```bash
  $NODE --test test/prep-registry.test.js test/prep-session-ui.test.js   # the clash tripwires
  grep -n "space-16" public/app.css                                      # → 1 hit so far
  $NODE --test test/*.test.js                                            # → 802 / 0 / 0
  ```
- **SATISFIES**: AC "generous whitespace" (epic Direction), AC #1.

### 4. UPDATE `public/app.css` — `.act-head` becomes a numbered section heading

- **IMPLEMENT**: **The central change of this ticket.** Rewrite `.act-head` (`app.css:598-609`):

  ```css
  .act-head {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    font-family: var(--font-ui);
    font-size: var(--text-h3);
    font-weight: 600;
    color: var(--text-primary);
    margin: 0 0 var(--space-6);
  }
  ```
  `text-transform: uppercase` and `letter-spacing: 0.08em` are **removed**; `font-size` goes
  `--text-caption` → `--text-h3`; `color` goes `--text-muted` → `--text-primary`; `gap` goes
  `--space-2` → `--space-3` (the numeral grows in Task 5); `margin-bottom` goes `--space-4` →
  `--space-6`.

  **Rewrite the comment at `app.css:596-597`**, which currently reads *"Same treatment as
  .rail-head, deliberately: the act numbering and the rail label are one grammar, not two."*
  That pairing is **reversed here, on purpose**, and the new comment must say so and why:

  > The act heads and `.rail-head` were one grammar (#8) — both small, tracked, uppercase and
  > muted. #59 splits them, because they are not the same kind of thing. The rail is chrome: a
  > label over a list the recruiter picks from once. The acts are the work, and the epic's
  > decided direction is numbered sections in big type. A section heading that is quieter than
  > the hint text under a file picker is not a hierarchy. `.rail-head` keeps the small tracked
  > label treatment — it is still a label — and `.act-head` takes the ramp's `--text-h3` in
  > sentence case with the numeral beside it.

- **PATTERN**: `.pack-section-head` (`app.css:782-789`) and `.rail-head` (`app.css:316-323`) are
  the two rules keeping the small-tracked-label grammar. **Leave both alone** — `.pack-section-head`
  is act 3's and belongs to #60; `.rail-head` is the grammar this task deliberately splits from.
- **GOTCHA**: `.act-num` (`app.css:625`) carries `letter-spacing: 0;` **solely to cancel the
  0.08em it used to inherit from `.act-head`**. Once the tracking is gone that line is inert. Task
  5 removes it — do not remove it here, and do not leave it silently: it is Task 5's first bullet.
- **GOTCHA**: `.act-head-row .act-head { margin-bottom: 0 }` (`app.css:638`) still applies and is
  still correct — acts 2 and 3 put the heading in a row with the clock/summary. Verify it after
  the size change; `.act-head-row` uses `align-items: baseline`, and a 20px heading beside a 14px
  clock on a shared baseline is right, which is why Task 7 raises the clock rather than switching
  to `center`.
- **GOTCHA**: `.act-head` is index-only — `clients.html` and `counts.html` do not use it (verified
  at plan time by sweeping `class="..."` across all three files). This edit has no blast radius.
- **GOTCHA**: The four `<h2 class="act-head">` elements are the `aria-labelledby` targets for
  their sections (`index.html:80-81`, `131-133`, `170-172`, `192-193`). **Do not change the
  element, the id, or the text.** Restyling a heading does not touch the accessible name; moving
  one does.
- **VALIDATE**:
  ```bash
  grep -n "text-transform: uppercase" public/app.css
  # → 4 hits, and .act-head is NOT among them: .rail-head, .agency-head,
  #   .pack-section-head, .mark
  $NODE --test test/prep-registry.test.js   # no new selector clash
  $NODE --test test/*.test.js               # → 802 / 0 / 0
  ```
- **SATISFIES**: The epic's decided "numbered sections" direction; ticket AC "hierarchy".

### 5. UPDATE `public/app.css` — `.act-num` grows to hold its own

- **IMPLEMENT**: In `.act-num` (`app.css:614-627`):
  - `width` / `height`: `var(--space-5)` (20px) → `var(--space-6)` (24px). A 20px chip beside a
    20px heading reads as a bullet; 24px reads as a numeral.
  - **Remove `letter-spacing: 0;`** (line 625) and its now-false reason. It existed only to
    cancel `.act-head`'s 0.08em, which Task 4 deleted. Leaving it is a dead declaration whose
    comment lies.
  - **Add `flex-shrink: 0;`**. The chip is a flex item in two containers now — `.act-head` (row)
    and `.steps li`, which Task 6 makes a row on a phone — and a flex item's default
    `flex-shrink: 1` lets a fixed `width` be squashed by a long sibling on the main axis. At
    360px, "Send the candidate their prep once the interview is booked" beside a 24px chip is
    exactly that case. `.strike-box` (`app.css:903`) and `.visibility-list input[type="checkbox"]`
    (`app.css:477`) both carry this line for the identical reason — mirror their comment.
  - Keep `font-family: var(--font-mono)`, `font-size: var(--text-caption)`,
    `background: var(--surface)`, `border: 1px solid var(--border-hairline)`,
    `border-radius: var(--radius)`, `color: var(--text-primary)` unchanged. 12px mono centred in
    a 24px box is comfortable; 14px is not.
  - Extend the comment (`app.css:611-613`) with the one fact that constrains any future edit:
    **this class is used in two places** — the steps map (`index.html:45-48`) and the four act
    headings — and that is deliberate (`index.html:41-42`: "Same chip grammar as the acts, so the
    map and the flow read as one thing"). It stays one class. Task 6 sizes its *context*, never
    the chip.
- **PATTERN**: `--radius: 9px` on a 24px box is a child-radius-under-parent-radius case
  (CRAFT: "Nested radii: child ≤ parent, concentric"). It equals the card's radius, which at this
  size reads as a squircle rather than a pill — correct, and the reason not to reach for
  `border-radius: 50%`.
- **GOTCHA**: The chip is `aria-hidden="true"` in every one of its eight uses. Growing it changes
  nothing for a screen reader and must not tempt you to un-hide it — the heading names the act;
  the number is visual rhythm (`index.html:41-42`, `app.css:611-613`).
- **GOTCHA**: 24px is below CRAFT's 24px minimum-anywhere hit area — which is fine, because
  **this is not an interactive element.** Do not add padding "for the tap target".
- **VALIDATE**:
  ```bash
  ! grep -n "letter-spacing: 0;" public/app.css && echo "the dead declaration is gone"
  grep -c "act-num" public/index.html          # → 8 (4 map chips + 4 act headings)
  $NODE --test test/*.test.js                  # → 802 / 0 / 0
  ```
- **SATISFIES**: The "numbered sections" direction.

### 6. UPDATE `public/app.css` and `public/index.html` — the acts' rhythm, and the steps map as a band

- **IMPLEMENT**: Two files.

  **`public/app.css`:**
  - `.act + .act { margin-top: var(--space-16); }` (was `--space-12`, line 585). Update the
    comment at 583-584: the rhythm between acts is now `--space-16` and within them `--space-4`
    to `--space-6`, "so the pacing of the flow is whitespace rather than dividers" — **and the
    claim that follows it, "There is not one rule between these three sections", stays true.**
    This ticket adds no hairline between acts. Say so explicitly, because "numbered sections" is
    exactly the phrase that invites one, and whitespace at 64px does the job the epic asked for.
  - Rewrite `.steps` (`app.css:271-286`):

    ```css
    .steps {
      list-style: none;
      display: grid;
      gap: var(--space-4);
      margin: var(--space-6) 0 0;
      padding: 0;
      font-size: var(--text-body);
      color: var(--text-muted);
    }

    .steps li {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      min-width: 0;
    }

    @media (min-width: 860px) {
      .steps {
        grid-template-columns: repeat(4, 1fr);
        gap: var(--space-6);
      }
      .steps li {
        flex-direction: column;
        align-items: start;
        gap: var(--space-2);
      }
    }
    ```
    Comment it: the map's job is the whole journey visible before any of it happens
    (`index.html:39-43`), and a wrapping inline row stopped doing that — at 1024px four full
    sentences wrapped into two ragged lines and the numerals stopped being scannable. Four equal
    columns with the numeral over its label is the same information as a band you read across.
    On a phone it is four rows, numeral beside label, because vertical space is the scarce thing
    there (`app.css:1007-1009`).
  - `.step-label { min-width: 0; }` — the label may be a long sentence in a 1fr track.

  **`public/index.html`:** wrap each step's text in `<span class="step-label">`:

  ```html
  <li><span class="act-num" aria-hidden="true">1</span><span class="step-label">Pick a client and add the brief and the CV</span></li>
  ```
  …for all four `<li>`s (lines 45-48). **The text is unchanged, the `<ol>` is unchanged, the
  `aria-label="How this works"` is unchanged, and `aria-hidden` on the numeral is unchanged.**

  **Write the two spans adjacent, with no newline or space between them**, exactly as above.
  The separation between the numeral and the label is `gap: var(--space-2)` on `.steps li`, not a
  text node. A newline between the spans (the natural way to format this) puts whitespace into a
  flex container, which becomes an anonymous flex item and adds an unwanted third track in the
  column direction at ≥860px.
- **PATTERN**: The `min-width: 0` discipline — `.stage` (579), `.input-col` (667), `.editor`
  (303), `.rail` (312) all carry it with the same reason. CRAFT: grid/flex items holding wide
  content get `min-width: 0`.
- **GOTCHA — why the span is not optional.** With `flex-direction: column`, a bare text node
  beside the `<span class="act-num">` becomes an **anonymous flex item**. It lays out correctly,
  but it cannot be selected, so it can carry no `min-width: 0` and nothing later can style it.
  A 1fr grid track with an unstyleable child holding a full sentence is a blowout waiting for the
  first long label. The span costs one element and makes the item addressable.
- **GOTCHA**: `.steps` has no JS hook. Verified at plan time:
  `grep -n 'steps"\|step-label\|\.steps' public/app.js` returns nothing. (A bare `grep "steps"`
  returns **two hits at lines 1185 and 1396 — both the English word inside comments about act
  4's two-step send**, not selectors. Do not read those as hooks.) This markup edit is safe.
  **Run the narrow grep** rather than trusting this line.
- **GOTCHA**: Do **not** add `aria-current` to a step. It is designed and rejected — the reason
  (act 4 has no phase of its own, so step 4 could never become current and would sit permanently
  unmarked beside a progressing 1-2-3) is in **NOTES → The steps map as a live progress
  indicator**. It would also require touching `setPhase`, which this plan does not.
- **GOTCHA**: `.steps` is index-only. No blast radius.
- **VALIDATE**:
  ```bash
  grep -c "step-label" public/index.html    # → 4
  grep -c 'class="act-num"' public/index.html   # → 8, unchanged
  grep -n "steps" public/app.js             # → no output
  $NODE --test test/counts.test.js          # the nav-link gate over index.html
  $NODE --test test/*.test.js               # → 802 / 0 / 0
  ```
- **SATISFIES**: The epic's "generous whitespace" and "numbered sections"; ticket AC "layout,
  density and responsive behaviour".

### 7. UPDATE `public/app.css` — act 1's labels and act 2's clock

- **IMPLEMENT**: Three scoped rules. All three are deliberately **descendant-scoped** rather than
  edits to the shared base class, because `.field` and `.elapsed` each have a second consumer.

  **Act 1** — in the act 1 section (after `.input-col`, `app.css:667`):
  ```css
  /* The two boxes are the work of this screen, so their labels take the ramp step above the
     chrome around them and the ink rather than the muted grey. Scoped to .input-pair and not
     applied to .field itself: .field also labels act 2's reply box, act 4's two fields and
     every control on /clients, where 14px muted is correct — those are form labels, and these
     two name the material the pack is built from. */
  .input-pair .field {
    font-size: var(--text-h4);
    color: var(--text-primary);
    margin-bottom: var(--space-3);
  }
  ```
  and open the gap between the pair and the action row by giving `.act-row` inside act 1 the
  larger step — **no**, `.act-row` is shared by all four acts. Instead:
  ```css
  .input-pair { margin-bottom: var(--space-8); }
  ```
  added to the existing `.input-pair` rule (line 657-660), so the two-route button row sits in
  its own zone rather than crowding the boxes. `.act-row`'s own `margin-top: var(--space-4)`
  stays.

  **Expect 32px, not 48px, and do not "fix" it.** `.act` is a plain block box, so `.input-pair`'s
  32px bottom margin and `.act-row`'s 16px top margin are adjacent sibling margins and
  **collapse to `max(32, 16) = 32px`.** The gap doubles from today's 16px, which is the intent;
  it does not sum. Put that sentence in the comment, because measuring 32px while picturing 48px
  is exactly how a correct rule gets "corrected".

  **Act 2** — in the act 2 section (after `.elapsed`, `app.css:734`):
  ```css
  /* The clock in act 2's head row is the only thing on screen that changes for a minute or two,
     and the recruiter is watching it from wherever they have put the laptop. It takes the same
     ramp step as the heading beside it. Scoped to .act-head-row because .elapsed is also
     #send-elapsed in act 4's .act-row, where the send takes seconds and a 20px counter beside
     two buttons would shout. .act-head-row aligns on baseline, so a 20px clock beside a 20px
     heading now shares one. */
  .act-head-row .elapsed { font-size: var(--text-h3); }

  /* The one thing a recruiter reads while waiting, so it takes reading size rather than chrome
     size — the same 16px the pack itself uses, for the same reason (CRAFT: prefer 16px for
     prose a person actually reads). */
  #act-waiting .act-note.generating-only { font-size: var(--text-note); }
  ```
- **PATTERN**: `#act-waiting .generating-only` / `#act-waiting.is-generating .generating-only`
  (`app.css:722-724`) is the file's existing id-scoped act-2 idiom. Follow it — do not invent a
  new class for a rule that only ever applies inside one section.
- **GOTCHA**: `.act-head-row` uses `align-items: baseline` (`app.css:631`). At 20px both sides it
  is right. **Check act 3's head row too** (`index.html:171-174`), where `.pack-summary` sits at
  `--text-body` beside the now-20px `.act-head` — a 14px summary on a shared baseline with a 20px
  heading is fine and is act 3's own to tune in #60, but look at it before you call this done.
- **GOTCHA**: `.act-note` has `max-width: 60ch` (`app.css:644`). At `--text-note` (16px) that
  measure grows in px but stays 60 characters, which is inside CRAFT's 65-75ch band. Do not add a
  second max-width.
- **GOTCHA**: `.field` is used **11 times across the three screens**. The scoped selector is the
  point. If you find yourself editing `.field` itself, you are about to restyle every label on
  `/clients` from a ticket that does not own that screen.
- **VALIDATE**:
  ```bash
  grep -n "^\.field {" -A6 public/app.css   # unchanged: --text-body, --text-muted
  $NODE --test test/prep-registry.test.js   # .input-pair .field / .act-head-row .elapsed are new
  $NODE --test test/*.test.js               # → 802 / 0 / 0
  ```
- **SATISFIES**: Ticket AC "hierarchy and density"; CRAFT typography.

### 8. UPDATE `public/index.html` and `public/app.css` — act 4's field pair

- **IMPLEMENT**: Both files.

  **`public/index.html`** — wrap the two label/input pairs at lines 199-203 in one row:
  ```html
  <div class="field-pair">
    <div class="field-col">
      <label class="field" for="interview-date">When is the interview?</label>
      <input class="input" type="date" id="interview-date" name="interview-date">
    </div>
    <div class="field-col">
      <label class="field" for="candidate-email">The candidate's email address</label>
      <input class="input" type="email" id="candidate-email" name="candidate-email" autocomplete="off">
    </div>
  </div>
  ```
  **The two ids, the two `for=` attributes, the `type`s, the `name`s and `autocomplete="off"` are
  unchanged.** The DOM order is unchanged, so the tab order is unchanged.

  **`public/app.css`** — in the act 4 section, **replacing** the `#interview-date,
  #candidate-email { max-width: 32ch }` rule at 944-947:
  ```css
  /* A date and an email address are both short, and two full-width inputs stacked over a 65ch
     measure read as a form that has not been thought about. They are one question — when, and
     to whom — so they sit as one row on a desktop and stack on a phone. This replaces the
     32ch cap the two ids carried: the column now bounds them, so the cap is the grid's job. */
  .field-pair {
    display: grid;
    gap: var(--space-6);
    margin-bottom: var(--space-6);
  }

  .field-col { min-width: 0; }

  @media (min-width: 860px) {
    .field-pair { grid-template-columns: 1fr 1fr; max-width: 60ch; }
  }
  ```
  Also open the preview zone: `.send-preview { margin-top: var(--space-16); }` (was
  `--space-8`, line 878). Its comment already argues the zone-break reasoning — update the
  token it names.
- **PATTERN**: `.input-pair` / `.input-col` (`app.css:657-667`) is the identical shape for act 1.
  `.field-pair` / `.field-col` is that pattern applied to short fields, and the names say so.
- **GOTCHA — the JS reads these two ids.** `el.interviewDate` and `el.candidateEmail`
  (`app.js:269-270`), `updateSendGate`, `interviewDateChanged`, the `readOnly` freeze in
  `resetToInputs` (`app.js:533-536`) and `el.interviewDate.max = maxUtc()` (`app.js:1878`) all
  reach them **by id**, never by ancestor. Wrapping them in two divs is invisible to all of it.
  Confirm with `grep -n "interview-date\|candidate-email\|interviewDate\|candidateEmail"
  public/app.js` and read every hit before you edit.
- **GOTCHA**: `max-width: 60ch` sits on `.field-pair` at ≥860px, not on the inputs. Without it the
  pair stretches the full stage width and a date picker 500px wide is worse than the stacked
  version you replaced. With it, each column is ~30ch — close to the 32ch the ids carried, which
  is why that cap is safe to remove rather than merely relocated.
- **GOTCHA**: Do **not** put the two inputs in a `<fieldset>`. Act 4 already has one
  (`#send-fields`, `index.html:218`) with its own `<legend>`, and a second fieldset around two
  fields that are not a group of related choices adds a landmark for nothing.
- **VALIDATE**:
  ```bash
  grep -n 'id="interview-date"\|id="candidate-email"' public/index.html   # → both still present
  ! grep -n "#interview-date," public/app.css && echo "the id-scoped cap is gone"
  grep -c "field-col" public/index.html                                   # → 2
  $NODE --test test/*.test.js                                             # → 802 / 0 / 0
  ```
  Then in the browser: tab from the date field → the email field → **Send to candidate**. The
  order must be exactly that.
- **SATISFIES**: Ticket AC "layout and density"; act 4 in scope.

### 9. UPDATE `public/app.css` — the act entrance gains a rise

- **IMPLEMENT**: Two edits, in two places.
  1. `.act.is-entering` (`app.css:594`):
     ```css
     .act.is-entering { opacity: 0; transform: translateY(var(--space-2)); }
     ```
  2. Inside the `no-preference` block (`app.css:1050`), extend the existing `.act` transition:
     ```css
     .act {
       transition: opacity var(--duration-2) var(--ease-out),
                   transform var(--duration-2) var(--ease-out);
     }
     ```
  Update the comment at `app.css:587-589`: the entrance is now opacity **and an 8px rise**, both
  compositor properties, and the rise is what makes an act read as *arriving* rather than
  *appearing*. The existing reasoning — gated behind a class rather than sitting on the element,
  because CHECKLIST forbids an entrance on anything rebuilt per render — stays verbatim.
- **PATTERN**: The motion block's own header comment (`app.css:1019-1034`) — read it in full. It
  states the `no-preference` edge precisely and says *"#59 and #62 will copy this comment"*. You
  are #59. Add to the block; do not restate its reasoning and do not weaken it.
- **GOTCHA — the property, not `all`.** CRAFT forbids `transition: all` and the two properties
  are listed explicitly, matching `.btn`'s three-property list at `app.css:1040-1042`.
- **GOTCHA — this must stay inside the guard.** `test/chrome.test.js:45` strips the
  `no-preference` block by brace counting and asserts nothing matching
  `/transition|animation|@keyframes/` survives. A `transition` written on `.act` itself is a
  **hard test failure**, which is exactly what #58 built that gate for.
- **GOTCHA — `transform` establishes a containing block.** A non-`none` transform makes the
  element a containing block for `position: fixed` and `position: absolute` descendants, for the
  ~200ms the class is on. Verified at plan time: `grep -n "position:" public/app.css` returns
  **zero hits in the whole file** — nothing on this deployment is positioned, let alone inside an
  act — so this is inert. Re-run it; if #60 later adds an absolutely-positioned chip inside act 3,
  this is the rule that explains the surprise.
- **GOTCHA — nothing waits on `transitionend`.** `showAct` (`app.js:410-426`) removes
  `.is-entering` after a double `requestAnimationFrame`, unconditionally. Under reduced motion —
  or under a UA that reports no preference support and therefore matches neither media query —
  the element renders at its final state instantly, which is the required behaviour. **Re-run
  #58's check** rather than trusting this paragraph:
  ```bash
  grep -rn "transitionend\|animationend\|getComputedStyle" public/*.js public/prep/*.js
  ```
  If it ever returns a hit, stop and reconsider.
- **GOTCHA**: `setPhase` calls `scrollIntoView` synchronously right after `showAct`
  (`app.js:460-468`). At that instant the arriving act is translated 8px down, so the scroll
  target is 8px off. It settles as the transition runs. This is a known, acceptable 8px — do not
  "fix" it with a `setTimeout`.
- **VALIDATE**:
  ```bash
  grep -c "transition:" public/app.css        # → 6, unchanged (this task edits one, adds none)
  $NODE --test test/chrome.test.js            # the guard test
  # then prove the gate bites: temporarily add `.act { transition: all 1s; }` near the top of
  # app.css, confirm test/chrome.test.js FAILS, remove it.
  $NODE --test test/*.test.js                 # → 802 / 0 / 0
  ```
- **SATISFIES**: Ticket AC #2 ("act reveals get subtle motion behind prefers-reduced-motion");
  epic AC #6.

### 10. UPDATE `public/app.css` — the phone counterparts

- **IMPLEMENT**: In the `@media (max-width: 859px)` block (`app.css:1010-1015`), add the trims the
  new desktop generosity needs. The block's existing four lines stay.
  ```css
  @media (max-width: 859px) {
    .rail { padding: var(--space-3); }
    .client-row { margin-bottom: 0; }
    .topbar { margin-bottom: var(--space-6); }
    .page-head { margin-bottom: var(--space-8); }
    /* 64px between acts is right on a desktop, where an act is one screenful. On a phone it is
       most of a viewport of nothing, and the mobile-density argument above applies: every wasted
       pixel pushes the work further off the first screen. --space-12 is the step that reads as a
       zone break at this width. */
    .act + .act { margin-top: var(--space-12); }
    .send-preview { margin-top: var(--space-12); }
    /* The page title at the ramp's top step is a display size, and 35px over a 360px viewport
       takes three lines for "Submission pack" plus its subtitle before any work is visible. */
    h1 { font-size: var(--text-h1); }
  }
  ```
- **PATTERN**: The block's own comment at `app.css:1007-1009` — it already states the principle
  and cites a measurement. Extend that reasoning; do not restate it.
- **GOTCHA**: `h1` here is the **shared** element selector again, so `/clients`, `/counts` and
  `404.html` get the same phone step-down. That is correct and consistent — but it means this one
  rule is the thing to look at first if #61 reports a heading problem.
- **GOTCHA**: `.steps` needs **no** entry here. Its base (mobile-first) shape already is the phone
  layout; the four-column band lives in the `min-width: 860px` block. Verify by resizing rather
  than by adding a rule you do not need.
- **GOTCHA**: This block is `max-width: 859px` and the two-column blocks are `min-width: 860px` —
  the pair is exhaustive and non-overlapping. **Do not introduce a third breakpoint.** The only
  other one in the file is `max-width: 600px` at line 842, and it is act 3's (`#60`'s).
- **VALIDATE**:
  ```bash
  grep -n "@media" public/app.css
  # → exactly 6: 3× min-width:860, 1× max-width:600, 1× max-width:859, 1× no-preference
  $NODE --test test/*.test.js    # → 802 / 0 / 0
  ```
  Then at 390px and at 360px in the browser: no horizontal scroll on `/`, `/clients`, `/counts`.
- **SATISFIES**: Ticket AC "responsive behaviour"; WCAG 1.4.10 Reflow.

### 11. UPDATE `README.md` — the Decisions log

- **IMPLEMENT**: One new entry in the Decisions log (the `#58` entry is at ~line 98 and is the
  worked example of the format — dated, ticket-numbered, with the reasoning not just the change).
  Dated **2 Aug 2026, #59**. It must record, in the log's voice:
  - The pack flow is laid out on the epic's decided direction: the page title takes a new
    `--text-display` (35px, the ramp's next 1.2 step), the acts are numbered sections in
    `--text-h3` sentence case rather than 12px uppercase labels, and the rhythm between them is a
    new `--space-16` (64px).
  - **`--radius: 9px` is decided and stays** — zig.ai sets the feel of this flow, forcanopy only
    the pack view's pattern language, so soft is right here. #60 adds a `--radius-sm` if the
    claim chips need one rather than moving this. (This closes #58's open question 5, which asked
    #59 or #60 to settle it once.)
  - The `h1` change is **shared chrome**: `/clients`, `/counts` and `404.html` inherit it, and the
    portal's two role-title pages already override `h1` in `prep.css`.
  - The act heads and `.rail-head` are **no longer one grammar** — and why.
  - `public/app.js` was not touched: every id and class hook survives verbatim.
- **PATTERN**: `README.md:95-110` — how this log supersedes rather than deletes. If the #58 entry
  or any earlier one makes a claim this ticket falsifies, mark it superseded in place.
- **GOTCHA**: Check whether any existing entry states the type ramp's top step or the act-head
  treatment. `grep -n "text-h2\|act-head\|uppercase" README.md` before writing — an entry that
  contradicts this one is worse than no entry.
- **GOTCHA**: The "Visual base: neutral, not the saulera Sunrise palette" entry and the
  "one deployment per agency" reasoning are **untouched** by this ticket. Do not edit them.
- **VALIDATE**: `grep -n "#59" README.md` → the new entry. Read the two entries either side of it
  and confirm the log still reads as one voice.
- **SATISFIES**: The repo's record stays true; closes #58's OQ5.

### 12. Full validation and the manual pass

- **IMPLEMENT**: Run everything in **VALIDATION COMMANDS** below, including the eight-page manual
  pass, the reduced-motion pass and the 360px pass.
- **VALIDATE**: `$NODE --test test/*.test.js` → **802 pass, 0 fail, 0 skipped.**
- **SATISFIES**: Every AC, and the completion checklist.

---

## TESTING STRATEGY

The project's framework is **`node --test`, zero dependencies, no DOM**
(`package.json`: `"test": "node --test test/*.test.js"`). There is no browser harness and this
ticket **adds none** — epic AC #5 forbids a build step, and a headless-browser dependency is
exactly that. Gates here parse source files; anything a parse cannot settle is settled by the
manual pass, which is why that pass is specified as concretely as it is below.

**This ticket adds no test.** That is deliberate and worth stating rather than leaving as a gap:
the three invariants a layout change could break are already gated, by tests #58 built for
precisely this ticket to run against.

### Unit Tests

- **`test/chrome.test.js` (existing, unchanged)** — the primary gate. Test 1 catches a
  `transition` written on a rule instead of inside the `no-preference` block, which is the single
  most likely mistake in Task 9. Test 2 catches a raw hex, which is the most likely mistake
  anywhere else.
- **`test/tokens.test.js` (existing, unchanged)** — must stay green after Task 1 proves the two
  new tokens are invisible to it. No colour moves in this ticket, so a failure here means you
  edited a colour you should not have.
- **`test/counts.test.js` (existing, unchanged)** — lines 119-131 assert `index.html` still
  carries the three-link nav. The one test that reads this ticket's markup.

### Integration Tests

Two cross-file tripwires that this ticket's new selectors could trip. **Run them immediately
after Tasks 3, 6, 7 and 8** — the four tasks that add a selector — rather than at the end:

- **`test/prep-registry.test.js:799`** — `prep.css` restates no selector `app.css` owns. New
  selectors introduced by this plan: `.step-label`, `.field-pair`, `.field-col`,
  `.input-pair .field`, `.act-head-row .elapsed`, `#act-waiting .act-note.generating-only`.
  Verified at plan time against `prep.css`'s selector set — no collision — but the check is
  cheap and the failure mode (two rules fighting, resolved by link order rather than intent) is
  not.
- **`test/prep-session-ui.test.js:748`** — the same over `session.css`, plus `session.css` must
  animate only behind the guard now that `app.css` carries no blanket `reduce` override.

### Edge Cases

- **A 35px `h1` at 360px.** "Submission pack" fits; "Client knowledge" is the longer one. Task 10
  steps it down to `--text-h1`. Check `/clients` and `/counts`, not just `/`.
- **The steps map with four full sentences in four 1fr tracks.** The longest is *"Send the
  candidate their prep once the interview is booked"* (48 characters). At 1024px each track is
  ~230px, so it wraps to three lines and the four columns end up different heights. That is
  expected and fine — `align-items: start` is what keeps the numerals on one line across the band.
  **Look at it. If it reads badly, shorten the labels rather than un-gridding the map** — the
  strings are #59's to change ("every changed string readable by a first-time recruiter") and the
  shorter forms are in NOTES.
- **A long client name in the rail at the new 48px gutter.** `.client-name` clips with an ellipsis
  (`app.css:359-368`); the rail is still 280px. Unchanged, but the gutter change is next to it.
- **The act entrance under reduced motion.** Reveal act 2 with *Reduce motion* on: it must appear
  **instantly, fully opaque and unshifted**. An element stuck at `opacity: 0` or offset 8px is
  the failure mode Task 9 could introduce.
- **Act 2's two modes at the new sizes.** Both must be checked: the API route (`is-generating` —
  the note and the big clock, no reply box) and the Claude-tab route (the reply box, the Claude
  link, the same clock). The ticket requires **both routes stay equally reachable**; the visual
  check is that neither mode looks like the broken half of the other.
- **Act 4's field pair at exactly 860px.** The grid flips there. Confirm nothing overlaps at the
  boundary in either direction.
- **Act 3 inheriting the new act shell.** `#60` has not run yet, so act 3 renders its old pack
  markup under a 20px heading, a 24px numeral and 64px of space above it. It must still look
  deliberate rather than half-migrated — generate a pack and look at it.
- **The focus ring on everything that changed size.** `:focus-visible` is one rule
  (`app.css:74-83`) and it follows the element's box. Tab through act 1 → act 4 and confirm the
  ring is visible and correctly sized on the two file inputs, the two paired fields and every
  button.
- **A `<style>`-free page inheriting the `h1` change.** `404.html` has an inline `<style>` block
  that `test/chrome.test.js:85` reads. Confirm it still declares no colour and that the page
  still returns **status 404** and still leaks no navigation or product name (#20 — read
  `404.html:19-28` before looking at it).

---

## VALIDATION COMMANDS

Execute every command to ensure zero regressions and 100% feature correctness.

**Node version, first.** The ambient shell is Node 20.20.2; `engines.node` is `>=22.5`. Under
Node 20 the suite reports 1 failure and ~160 skips — a false pass, not a partial one.

```bash
NODE=~/.nvm/versions/node/v24.11.0/bin/node
$NODE --version    # → v24.11.0
```

### Level 1: Syntax & Style

The repo has no linter and no formatter (no eslint/prettier config, no lint script) — the tests
are the style gates. These are the direct structural checks:

```bash
grep -c "transition:" public/app.css              # → 6, all inside the no-preference block
grep -n "@media" public/app.css                   # → 6: 3× min-860, 1× max-600, 1× max-859, 1× no-preference
! grep -n "font-weight: 500" public/app.css       # → no output (Geist has no 500 face)
grep -n "text-display\|space-16" public/tokens.css  # → the two new definitions
grep -n "text-display" public/app.css             # → exactly 1, the h1 rule
grep -c "step-label" public/index.html            # → 4
grep -c 'class="act-num"' public/index.html       # → 8, unchanged
git diff --stat public/app.js                     # → EMPTY. app.js is not touched.
```

The last one is the ticket's own constraint made checkable: "keep hooks stable or update in
lockstep" — this plan keeps them stable, so any diff in `app.js` is scope creep.

Every id `app.js` reads must still exist. This is the check that a markup edit did not silently
break the wiring:

```bash
for id in client-list rail-empty rail-state act-inputs brief cv brief-file cv-file generate \
  copy-prompt inputs-state prompt-fallback prompt-text act-waiting waiting-word elapsed reply \
  read-pack waiting-state start-again act-pack provenance-summary pack-body copy-pack \
  renderer-note pack-state start-again-2 act-send interview-date candidate-email prepare-send \
  send-state send-elapsed send-preview send-preview-lede strike-list send-fields-note \
  send-fields-list send-note-link confirm-send cancel-send; do
  grep -q "id=\"$id\"" public/index.html || echo "MISSING: $id"
done
echo "id sweep done"
```

Expected: no `MISSING` lines. The list is complete and is `app.js:237-281` verbatim.
`#send-fields` (`index.html:218`) is **deliberately absent**: verified at plan time that `app.js`
reads only `send-fields-note` and `send-fields-list`, never the fieldset itself, so it is a style
hook and not a wiring hook. Task 8 does not touch it.

### Level 2: Unit Tests

```bash
$NODE --test test/chrome.test.js test/tokens.test.js test/counts.test.js
```

### Level 3: Integration Tests

```bash
$NODE --test test/prep-registry.test.js test/prep-session-ui.test.js   # the cross-file tripwires
$NODE --test test/*.test.js                                            # the whole suite
```

Expected: **802 pass, 0 fail, 0 skipped** — the verified baseline, unchanged. This ticket adds no
test, so the number must not move.

### Level 4: Manual Validation

```bash
npm run dev     # scripts/dev.py — wrangler pages dev on :8788, migrates the local D1 first
```

| Route | What specifically to look at |
|---|---|
| `/` | The 35px title over the four-column steps band. Act 1's heading reads as a heading. Paste a brief + CV, press **Generate the pack** → act 2 rises in, the clock is large and monospaced. Press **Or copy the prompt** → act 2's manual mode: reply box, Claude link, same clock. Reach act 3 → the old pack under the new act shell. Act 4 → the date and email side by side, then the preview zone 64px below. |
| `/clients` | Inherits the 35px `h1`, the 64px `.page-head` gap and the 48px workspace gutter. It must look **better**, not merely different — this is #61's screen and you have changed its chrome. |
| `/counts` | The 35px `h1` over the table. Tabular figures still aligned. |
| `/does-not-exist` | `curl -s -o /dev/null -w "%{http_code}" http://localhost:8788/nope` → **404**. Then look at it: still no navigation, no product name, no hint of what else is on the hostname (#20). Its `<h1>Page not found</h1>` sits in a `.notfound { max-width: 52ch }` main and now renders at 35px — check it at 360px too, where Task 10 steps it back to 29px. |
| `/prep/` · `/prep/login` · `/prep/privacy` | The 35px `h1` reaches these three (they do not override it). Acceptable on a phone width, and noted in the PR as #62's to tune. |
| `/prep/brief` | `prep.css:37-42` overrides `h1` to `--text-h1` here — confirm the role title did **not** change. If it did, your `h1` edit was more specific than you thought. |

Then, with **Reduce motion ON** (System Settings → Accessibility → Display → Reduce motion):

- Reveal act 2 on `/` → appears **instantly, fully opaque, not offset**.
- Reveal act 3 and act 4 → same.
- Save nothing, hover a button → no lift, no shadow, label still legible.

Then the width pass, at **390px and 360px**, on `/`, `/clients` and `/counts`:

- No horizontal scroll on any of them (`document.documentElement.scrollWidth` ≤ the viewport).
- The steps map is four rows, numeral beside label.
- Act 1's two boxes are stacked, act 4's two fields are stacked.
- The `h1` has stepped down to 29px.

And the keyboard pass on `/`:

- Tab from the topbar → the rail → act 1's two textareas and file inputs → **Generate** →
  **Or copy the prompt**. Focus ring visible and correctly sized on every stop.
- With a pack on screen, tab into act 4: date → email → **Send to candidate**. That exact order.

### Level 5: Additional Validation (Optional)

- `jcodemunch` `get_blast_radius` on `public/app.css` to confirm no consumer of a changed
  selector was missed.
- Any browser's accessibility inspector on `/`: confirm the four act sections still expose their
  headings as accessible names (`aria-labelledby` → the four `<h2 class="act-head">`), and that
  the `<ol aria-label="How this works">` still reads as a four-item list.
- Run `.claude/skills/dossier-design/references/CHECKLIST.md` before committing — the skill's own
  instruction, and the only pass that checks all six interactive states.

---

## ACCEPTANCE CRITERIA

Ticket #59's four, mapped to the tasks that satisfy them:

- [ ] **AC #1 — New tokens/type only, no hard-coded colours** (epic AC #1). → Tasks 1, 2, 3, 6,
      7, 8, 10. Gated by `test/chrome.test.js:73` (no raw hex in `app.css`) and `:85` (none in a
      page-scoped `<style>` block). No colour token changes value in this ticket; two non-colour
      tokens are added.
- [ ] **AC #2 — Act reveals get subtle motion behind `prefers-reduced-motion`** (epic AC #6). →
      Task 9. Gated by `test/chrome.test.js:45`, and verified by hand with Reduce motion on.
- [ ] **AC #3 — Live regions, `aria-current`, focus order preserved or improved** (epic AC #3). →
      Tasks 6, 8, and the Level 1 id sweep. Concretely: the five `role="status"` regions
      (`#rail-state`, `#inputs-state`, `#waiting-state`, `#pack-state`, `#send-state`) keep their
      elements and their positions inside the acts that own them (`index.html:72-74` explains why
      each act owns one rather than sharing); the topbar's static `aria-current="page"` is
      untouched; DOM order is unchanged everywhere, so tab order is unchanged; no `aria-hidden`
      moves; the four `aria-labelledby` targets keep their ids and their text.
- [ ] **AC #4 — Every changed string readable by a first-time recruiter.** → **No visible string
      changes in this plan.** The steps map keeps its four sentences verbatim; the act headings,
      button labels and notes are untouched. If the manual pass makes you shorten a step label,
      the shorter forms in NOTES are pre-written to this bar and the change must be called out in
      the PR body.
- [ ] **Both generate routes stay equally reachable** (ticket scope, explicit). → Task 7 and the
      manual pass. **Generate the pack** (primary) and **Or copy the prompt and open Claude**
      (ghost) stay side by side in the same `.act-row`, in that order, both at full size, neither
      behind a disclosure. `app.js` is untouched, so neither route's wiring can have moved.

Plus the standing bar:

- [ ] All validation commands pass with zero errors under Node 24
- [ ] Full suite green: **802 pass, 0 fail, 0 skipped** — unchanged, because no test is added
- [ ] No regressions: `git diff --stat public/app.js` is empty; every id in the Level 1 sweep
      still resolves
- [ ] `README.md` Decisions log updated and internally consistent
- [ ] Every changed rule carries its reason in a comment, in the house style; every comment this
      ticket falsifies is rewritten rather than deleted

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] All validation commands executed successfully
- [ ] Full test suite passes under Node 24 (802 / 0 / 0)
- [ ] `test/chrome.test.js`'s guard test verified to actually bite (a temporary
      `.act { transition: all 1s }` near the top of `app.css` makes it fail; removed)
- [ ] Manual pass over all eight pages, plus the reduced-motion pass, the 360/390px pass and the
      keyboard pass
- [ ] `404.html` still returns status 404 and still leaks nothing
- [ ] Both generate routes exercised end to end on the running dev server
- [ ] Acceptance criteria all met
- [ ] `git status` shows only these, and nothing else — **anything else is scope creep**:
      ```
      M  public/tokens.css     M  public/index.html
      M  public/app.css        M  README.md
      ```
      The four untracked files already in the tree (`.claude/code-reviews/pr-5{1,2,3}-review.md`,
      `docs/handover-louis-meeting.md`) are **not yours** — do not stage them, and never
      `git add -A`.
- [ ] Branch is off `main` (e.g. `feature/redesign-pack-flow`), **not** the current
      `feature/redesign-foundation`. Verify with `git branch --show-current` immediately before
      committing — parallel sessions share this worktree and HEAD moves underneath you.
- [ ] PR body links `Closes #59`, names the shared-chrome edits `/clients`, `/counts` and the
      three un-overridden portal pages inherit, and states that `app.js` was not touched.

---

## OPEN QUESTIONS / ASSUMPTIONS

**Decided during planning, not open** — recorded so they are not re-litigated:

1. **Relayout, not restructure. The four acts survive.** The ticket permits a restructure ("the
   four-act structure may be restructured where a clearly better pattern exists") and this plan
   **declines it**, for three reasons.
   - `setPhase` (`app.js:434-469`) is one function that shows five sections by id and drives the
     clock, `updateSendGate`, `setBusy(el.readPack)` and `scrollIntoView`. The file's header
     comment enumerates six behaviours that are "decisions rather than implementation details",
     and three of them (the clipboard-in-the-same-task rule, the frozen inputs, the one place the
     clock is stopped) live in or around that function. A restructure rewrites it.
   - Epic non-goal #1 is "no changes to generation logic". Merging acts would touch route
     selection (`state.route === "api"`), which is that logic's UI contract.
   - Epic AC #3 requires accessibility at least as good as today. Each act is a labelled section
     owning its own `role="status"` — `index.html:72-74` records that a `role="status"` inside a
     hidden subtree is not in the accessibility tree, which is *why* they are not shared. A
     restructure risks collapsing that silently.

   No clearly better pattern was found that would pay for that. **The gap the ticket is really
   pointing at is hierarchy, not structure** — and hierarchy is what Tasks 2-7 fix. If the owner
   disagrees, the restructure is a separate ticket with its own `setPhase` plan, not an amendment
   to this one.

2. **`public/app.js` is not touched at all.** The ticket allows "keep hooks stable **or** update
   in lockstep"; this plan takes the first branch. Every markup edit is a wrapper or a span
   around existing elements, so every `getElementById` and the one `closest(".input-col")` call
   still resolves. `git diff --stat public/app.js` being empty is the Level 1 check.

3. **`--radius: 9px` is decided and stays** — closing #58's open question 5. zig.ai sets the feel
   of this flow; forcanopy sets only the pack view's pattern language. #60 adds `--radius-sm` if
   the claim chips need a tighter corner, rather than moving the token that sits on the card, the
   rail, the pack, every input and every button.

**Genuinely open, and none of them blocks:**

4. **`--text-display: 35px` — is one step enough?** The ramp's next step above 29px is 34.8 → 35,
   and this plan takes the disciplined value rather than a round 40 or 42. **If the owner reads
   35px as timid**, the next 1.2 step is **42px** and it is a one-token change with one
   consequence: Task 10's phone step-down should then go to `--text-h2` (24px) rather than
   `--text-h1`. Nothing else moves. Worth asking after the first look at the running page.

5. **The `h1` change is shared chrome — should it be scoped to `/` instead?** As planned, all
   three recruiter screens, `404.html` and three portal pages inherit a 35px page title. That is
   the epic's AC #1 ("one token set drives both surfaces") working as intended, and #61/#62
   inherit rather than fight it. **The scoped alternative is one line** — move the size from `h1`
   to a `.stage`-adjacent or body-class selector — but it buys a page that does not match the two
   beside it. Flagged rather than hedged: this plan takes the shared version.

6. **Should the four step labels be shortened?** They are kept verbatim (AC #4 is about strings
   that *change*). Four full sentences in four 1fr tracks wrap to two or three lines each. If
   the band reads heavy, the pre-written shorter forms are in NOTES — but shortening loses
   explanation the map exists to provide, so look before cutting.

7. **Does act 3 look right under the new shell before #60 runs?** It will render its old pack
   markup under a 20px sentence-case heading and 64px of space. Expected to look deliberate; if
   it looks half-migrated, that is #60's cue and not a reason to hold this ticket.

**Assumptions this plan makes:**

- **Baseline: 802 pass / 0 fail / 0 skipped**, verified on this worktree at HEAD `64f551e` on
  2 Aug 2026 under Node 24.11.0. Every task's validation asserts that same number.
- Node 24.11.0 at `~/.nvm/versions/node/v24.11.0/bin/node` remains available. Any Node ≥22.5
  works; the point is not to validate under the ambient Node 20.
- `npm run dev` (`scripts/dev.py` → wrangler pages dev + local D1 migration) works in the
  implementer's environment. If it does not, the visual pass can run against static files, but
  the 404-status check needs the real Pages runtime.
- #58 is merged (`64f551e`) and `main` carries it. This ticket's `Depends on: #58` is satisfied.
- No zig.ai stylesheet analysis is recorded in the repo — verified by grep. The epic's palette
  table and the phrases "big type", "generous whitespace", "numbered sections" are the whole
  brief, and this plan translates them into the specific numbers above rather than pretending to
  a source it does not have. **Every one of those numbers is arguable and cheap to change; none
  of them is structural.**

---

## NOTES (open canvas)

### The app.css ownership split — the real merge hazard

The epic runs **#59, #61 and #62 in parallel worktrees**. #59 and #61 both edit `public/app.css`.
This is the map of who owns what, derived by sweeping `class="..."` across the three HTML files:

| Section | Lines | Used by | Owner |
|---|---|---|---|
| body, type, focus, topbar, card, buttons, fields | 11-262 | all screens | **shared** — #58 restyled it; #59 touches only `h1` |
| `.page-head` `.page-sub` `.steps` `.workspace` | 264-303 | `/`, `/clients`, `/counts` | **#59** (`.steps` is index-only) |
| the client rail `.rail*` `.client-*` | 305-388 | `/`, `/clients` | **shared** — #59 changes nothing in it |
| `.editor*` `.save-row` `.scaffold-line` | 389-432 | `/clients` | **#61** |
| `.visibility*` | 434-507 | `/clients` **and act 4** | **#61** — #59 changes nothing in it |
| `.agency*` `.radio-*` | 509-571 | `/clients` | **#61** |
| the act shell `.stage` `.act*` | 573-654 | `/` | **#59** |
| act 1 · act 2 | 655-734 | `/` | **#59** |
| act 3 `.pack*` `.claim*` `.mark*` | 736-871 | `/` | **#60** |
| act 4 `.send-*` `.strike-*` | 873-947 | `/` | **#59** |
| `.counts*` | 949-1003 | `/counts` | **#61** |
| mobile density | 1005-1015 | all | **shared** — both #59 and #61 will add lines here |
| the motion block | 1017-1051 | all | **shared** — both will add lines here |

**Two collision points, both real:** the `max-width: 859px` block and the `no-preference` block,
because both are single blocks at the foot of the file that every ticket appends to. Whoever
merges second gets a conflict in exactly those two places, and it will be a trivial
both-sides-keep resolution. Worth saying out loud in the PR so the second merger expects it.

**One shared-chrome edit #61 inherits rather than fights**: `h1` at `--text-display`,
`.page-head` at `--space-16`, `.workspace` gutter at `--space-12`. #61 should not re-decide them;
if it wants different values, that is a conversation, not a second edit.

### The steps map as a live progress indicator — designed and rejected

The obvious improvement: mark the current step with `aria-current="step"` as the flow advances,
turning a static map into a progress indicator. Rejected, for a specific reason rather than
timidity:

`setPhase` has three phases — `inputs`, `waiting`/`generating`, `pack`. Act 4 has **no phase of
its own**: it appears with the pack (`app.js:450`, `showAct(el.actSend, next === "pack")`) and is
gated by a date, not by a phase. So the mapping is 1→`inputs`, 2→`waiting`, 3→`pack`, and **step
4 could never become current**. A four-step map where the fourth step is permanently unmarked
beside a progressing 1-2-3 reads as broken, not as optional.

The fixes all cost more than the feature: give act 4 a phase (touches `setPhase`, `resetToInputs`
and `updateSendGate`), or drop step 4 from the map (loses the one place the recruiter learns that
sending prep exists before they have a pack), or mark 3 and 4 together (`aria-current` is
single-valued, so that means a class, which means colour-only state).

It also costs the "no `app.js` diff" property that makes this ticket safe to run in parallel with
#61. **If it is wanted, it is a follow-up ticket that starts by giving act 4 a phase.**

### Shorter step labels, if the band reads heavy

Pre-written to AC #4's bar (a first-time recruiter, no jargon, no abbreviation):

| # | Current | Shorter |
|---|---|---|
| 1 | Pick a client and add the brief and the CV | Add the brief and the CV |
| 2 | Generate the pack and wait a minute or two | Generate the pack |
| 3 | Copy the pack once every claim is checked | Check it and copy it |
| 4 | Send the candidate their prep once the interview is booked | Send the candidate their prep |

The current forms carry the *conditions* (when the interview is booked; once every claim is
checked) and the shorter ones drop them. That is a real loss for a first-time reader, which is
why this is a fallback rather than the plan. **Do not do both** — shortening and gridding
together over-corrects and leaves the map saying less than it did.

### Alternatives weighed and rejected

| Option | Why not |
|---|---|
| A hairline rule above each act, zig-style | `app.css:583-584` records a decision: "the pacing of the flow is whitespace rather than dividers. There is not one rule between these three sections." CRAFT agrees — hairlines only where they encode grouping whitespace cannot. At `--space-16` (64px) the whitespace does it. Reversing a recorded decision needs a better reason than "the reference has one". |
| A hanging numeral in a left gutter (the strongest zig signature) | Needs either a markup wrapper per act or absolute positioning with negative margins, and the negative-margin version breaks inside the `.workspace` grid at the 860px boundary. The flex-row chip gets ~80% of the read for ~10% of the risk. |
| A large ghosted numeral (`--text-display`, `--border-hairline`) behind each act head | Handsome, and wrong for a working tool: it spends the page's boldest gesture on navigation furniture. CRAFT puts the display treatment on the pack, and `app.css:791-792` already says "All of this screen's boldness is spent here" about the claim/quote pairing. |
| Collapse the client rail once a pack is generating | A genuine density win — the rail is dead weight from act 2 onward — but it is a behaviour change requiring `setPhase` to drive it, and epic non-goal #2 is "no new features". |
| Change `h1` only on `/` via a body class | Buys one page that does not match the two beside it and adds a class whose only job is to scope a font size. Epic AC #1 asks for one token set across both surfaces. Kept as a one-line fallback in Open Questions #5. |
| `clamp()` for fluid display type | No fluid type exists anywhere in the repo. Two fixed steps at one existing breakpoint is the file's idiom and is one line shorter. |
| Add a `--text-display` **and** a `--space-16` **and** a `--radius-sm` now | The third has no consumer in this ticket. #58's own plan named shipping an unused token as the thing to avoid (its OQ6). #60 adds it when it knows the chip's corner. |
| Add a browser-based visual regression test | Epic AC #5 forbids a build step, and a headless browser is a dependency, a binary and a CI story this repo has deliberately never had. |

### Why this diff is smaller than the ticket estimates

The ticket estimates ~800-1400 lines across three files. This plan lands closer to **~120 lines
changed across four files**, and the difference is entirely Open Question #1: the estimate
assumes a restructure of the four acts and a matching `app.js` rewrite. Choosing relayout removes
both. If the reviewer expects the larger number, that gap is the explanation and it belongs in
the PR body — a small diff here is the plan working, not the ticket being under-delivered.

### The sequencing argument for doing the tokens first

Tasks 1 is inert — two tokens nothing consumes — and its validation is "the full suite is still
802/0/0". That makes it a free proof that the token layer accepts an addition without disturbing
`test/tokens.test.js`'s explicit tables, before any layout depends on it. It is the same argument
#58's plan made for extending its gate before moving its palette: establish the instrument, then
use it.

---

## Confidence

**9.5 / 10** for one-pass success.

What earns it: the baseline is verified on this worktree today (802/0/0 under Node 24.11.0, HEAD
`64f551e`), not quoted from the previous plan; every gate that could bite has been read in full
and each new selector checked against `prep.css`'s actual selector set; the class-and-id surface
was swept across all three HTML files so the shared-chrome blast radius is enumerated rather than
estimated; `app.js` is untouched by construction, which removes the entire class of
"markup moved and the wiring silently died" failures; and the two behavioural risks (the transform
containing block, the `no-preference` edge) were each checked against the file rather than
reasoned about.

The half-point off is the same one #58 paid and for the same reason: this is a visual redesign
whose acceptance is "does it read as considered", judged by eye on eight pages. No gate settles
that, and two of the numbers (`--text-display`, and whether the step labels survive gridding) may
want one round of adjustment after the first look at the running page. Both are single-value
changes with no structural consequence — which is why the risk is a half-point and not two.

---

## AMENDMENTS

<!-- Append-only. Newest at the bottom. -->
