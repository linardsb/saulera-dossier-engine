# Feature: Redesign foundation — tokens, fonts, and shared chrome (#58)

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

## Feature Description

Ticket #58 is the token layer and shared chrome that every other ticket in epic #57 builds on.
It does three things and deliberately nothing else:

1. **Repalettes `public/tokens.css`** onto the owner's decided zig.ai palette — warm off-white
   ground, grey-green ink, one deep-green accent, three state tints — with every pairing measured
   against the repo's contrast gate before it ships.
2. **Collapses the type stack to one sans + one mono.** `Aspekta 500` is deleted; `Geist`
   (already on disk, 400 + 600, latin subset, OFL) becomes the single sans; `DM Mono` stays.
3. **Restyles the shared components in `public/app.css`** on the new tokens — topbar, buttons,
   inputs/textareas, save-state lines, focus rings, card — and inverts the motion guard from
   "kill transitions under `reduce`" to "define transitions once, inside
   `prefers-reduced-motion: no-preference`". `public/404.html` comes along because it is pure
   chrome.

No layout moves. No page is restructured. The three recruiter screens (`/`, `/clients`,
`/counts`), `404.html` and the four `/prep/*` pages must all still render acceptably on the new
base — that is the whole bar for this ticket. #59–#63 do the layout work on top.

## User Story

As **the recruiter who opens this tool in front of a client**
I want **the tool to look like one considered product rather than engineering scaffolding**
So that **I trust it enough to put a pack it generated in front of a hiring manager.**

Ticket-level, that story lands on the implementer as: *as the agent implementing #59–#63, I want
one measured token set and one shared component grammar to build on, so that six parallel
redesign tickets do not each invent their own colours.*

## Problem Statement

The palette in `tokens.css` is the stackai default — white ground, `#0099ff` blue accent, neutral
greys. The owner has decided a different one (zig.ai: warm off-white, grey-green ink, deep-green
accent, mint/powder/blush tints) and every other ticket in the epic depends on it existing. Three
specific problems:

- **The decided accent cannot carry a label.** `#08906c` measures **4.03:1 against white** and
  **3.19:1 against the decided ink** — both under the 4.5:1 body-text floor. `.btn-primary` puts a
  label directly on `var(--accent)` today. A straight token swap ships an unreadable primary
  button and fails `test/tokens.test.js` on the spot.
- **The type stack is two sans families**, one of which (`Aspekta 500`) ships a single 500 face.
  The epic asks for one sans + one mono.
- **Motion is guarded the wrong way round.** Six `transition:` declarations sit scattered through
  `app.css`, neutralised by a blanket `@media (prefers-reduced-motion: reduce) { * { ...
  !important } }`. That is opt-out: a transition added anywhere is live by default and the guard
  is a `!important` sledgehammer. The epic's AC #6 asks for opt-in, which is also the idiom
  `public/prep/prep.css` already uses and `test/prep-registry.test.js:856-880` already enforces.

## Solution Statement

Rewrite `public/tokens.css` on the decided palette, adding exactly two tokens the decided set does
not supply and the gates require: **`--accent-strong`** (the accent darkened until a white label
clears 4.5:1) and **`--on-accent`** (that label's colour). `--accent` keeps the owner's decided
`#08906c` and becomes decorative-only — focus ring, underlines, the marker bar, the dragover edge
— every one of which is a 3:1 non-text use it clears.

Extend `test/tokens.test.js` with the new pairings — the three tints as surfaces, `--accent` at
the 3:1 floor, and `--on-accent` on `--accent-strong` replacing the old
`--text-primary`-on-`--accent` assertion — so the palette is measured, not asserted in a comment.

Delete `Aspekta500.woff2` and its `@font-face`; point `--font-ui` and `--font-body` at `Geist`.
Set headings to `font-weight: 600`, because Geist ships 400 and 600 and CSS font-matching resolves
a request for 500 **downward to 400** — leaving headings at 500 silently renders them at regular
weight.

Move all six `transition:` declarations in `app.css` into one
`@media (prefers-reduced-motion: no-preference)` block at the foot of the file, delete the
`reduce` block, and add `test/chrome.test.js` to hold that shape — mirroring the guard
`prep-registry.test.js` already runs over `prep.css`.

## Out of Scope / Non-Goals

- **Not included: any layout change.** No grid, spacing rhythm, page structure, act ordering or
  component arrangement moves. Ticket AC #5 is explicit: "no layout work yet." Defer to #59/#60/#61.
- **Not included: the type ramp.** `--text-caption` … `--text-h1` keep their current values. A
  bigger display step is #59's call once it knows what it is setting.
- **Not included: `--radius`, `--max-width`, the 4px space scale, `--tap-target`, the motion
  durations/curve.** None is a decided value in the epic; leaving them alone keeps the diff to
  what the ticket names.
- **Not included: the Canopy-style claim chips.** This ticket ships the three tint tokens and
  proves they are contrast-safe. #60 builds the chips.
- **Not included: restyling `public/prep/prep.css` or `public/prep/session.css`**, or the
  page-scoped `<style>` blocks in `prep/login.html` / `prep/privacy.html` / `prep/index.html`.
  Those are #62's files. This ticket only has to leave them rendering acceptably.
- **Not changing: any HTML structure, class name, ARIA attribute, live region or focus order.**
  Epic AC #3 requires keyboard/screen-reader behaviour stays at least as good as today; the
  cheapest way to guarantee that is to touch no markup except `404.html`'s stylesheet-only
  restyle (which needs no markup change at all).
- **Not changing: `public/app.js`, `clients.js`, `counts.js`, or any `src/` module.** No
  generation, storage or API surface is involved (epic non-goal #1).

## Feature Metadata

**Feature Type**: Refactor (a design-system foundation swap; no behaviour changes)
**Estimated Complexity**: Medium — low algorithmic risk, high blast radius. Every page on the
deployment links `tokens.css` and `app.css`.
**Primary Systems Affected**: `public/tokens.css`, `public/fonts.css`, `public/fonts/`,
`public/app.css` (shared sections only), `public/404.html`, `test/tokens.test.js`, `README.md`
**Dependencies**: None new. No build step, no framework, no package (epic AC #5).

## Related Work

**Implements**: [#58](https://github.com/linardsb/saulera-dossier-engine/issues/58)   ·
**Epic**: [#57](https://github.com/linardsb/saulera-dossier-engine/issues/57) — the "Decided
palette" and "Decided typography" tables in the epic body are the source of truth. There is no
separate `engineering-plan.md` for this epic; the epic issue *is* the architecture record.

**Back-references** (plans this builds on or inherits decisions from):

- `.claude/plans/ux-ui-uplift.md` — Why: the plan that created `tokens.css`, `app.css`'s component
  grammar and `test/tokens.test.js`. Its "branding is a variable swap, never a fork" rule is what
  makes this ticket a one-file palette change rather than a sweep through markup.
- `.claude/plans/prep-component-registry-and-brief-dashboard.md` — Why: established the
  `prefers-reduced-motion: no-preference` guard idiom in `prep.css` and the test that enforces it.
  This ticket ports that idiom to `app.css`.

**Forward-references** (plans that extend or supersede this — append as follow-ups get created):

- #59 (pack flow, acts 1/2/4), #61 (client knowledge + prep sent), #62 (portal shell) all start
  after this lands. #60 and #63 follow them. Two things this ticket hands them are recorded under
  **NOTES → What #60 inherits**.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `public/tokens.css` (whole file, 104 lines) — Why: the file being rewritten. Read the header
  comment and every inline rationale first: this repo records *measured numbers* next to colour
  decisions, and that convention has to survive the rewrite. Note lines 19-22, 62-79 and 96-102 in
  particular — each explains a value you are about to replace, and the reasoning usually still
  applies to the replacement.
- `test/tokens.test.js` (whole file, 147 lines) — Why: the contrast gate you must extend. The
  `hexTokens` parser (lines 27-32) only sees `--name: #hex;` — a token written `rgb()`, `hsl()`,
  8-digit hex or `var(...)` is invisible to it. The `PAIRINGS` table (lines 78-86) and `SURFACES`
  (line 73) are the two lists you edit.
- `public/app.css` lines 1-27 — Why: `body` sets `--font-body`, `--background`, `--text-primary`.
- `public/app.css` lines 29-68 — Why: the type section. `h1`/`h2` carry `font-weight: 500`, and
  the comment at 31-33 explains why (Aspekta's single face) — that reason dies with Aspekta.
  Line 62-63's comment states `--accent` is 3.00:1 and therefore never text; the number changes,
  the rule survives.
- `public/app.css` lines 70-78 — Why: the ONE `:focus-visible` rule for the entire deployment.
  The inner `--text-primary` hairline is what keeps the ring visible where `--accent` alone is
  weak; with the new palette that is still true (`--accent` is 2.57:1 on the powder tint). Do not
  remove it.
- `public/app.css` lines 80-134 — Why: the topbar. `.topbar-nav a` holds one of the six
  transitions (line 123).
- `public/app.css` lines 136-217 — Why: card + buttons. Line 179 `.btn-primary { background:
  var(--accent) }` with `color: var(--text-primary)` is **the one text-bearing accent use in the
  codebase** and the reason `--accent-strong` / `--on-accent` exist. Lines 163-165 hold the
  `.btn` transition.
- `public/app.css` lines 219-257 — Why: fields. `.input`/`.select`/`.textarea` and the
  `[readonly]` surface tone.
- `public/app.css` lines 396-415 — Why: `.save-row` / `.save-state`, one of the two `--duration-2`
  transitions (line 409).
- `public/app.css` lines 583-591 — Why: `.act` / `.act.is-entering`, the other `--duration-2`
  transition (line 588).
- `public/app.css` lines 330-353, 694-711 — Why: the remaining two transitions (`.client-row`
  line 336, `.file-input::file-selector-button` line 699) and two decorative `--accent` uses
  (the `aria-current` marker bar at 344/351, the dragover border at 708).
- `public/app.css` lines 1002-1018 — Why: the mobile-density block and the
  `@media (prefers-reduced-motion: reduce)` block you are deleting.
- `public/fonts.css` (whole file, 46 lines) — Why: four `@font-face` rules and the licence
  paragraph. You delete one rule and rewrite the paragraph.
- `public/404.html` (whole file, 38 lines) — Why: pure chrome, `.page-head` / `.page-sub` only.
  **Read the comment at lines 19-28 before touching it** — this file exists for a security reason
  (#20), not a cosmetic one, and must keep: no navigation, no product name, no hint of what else
  is on the hostname.
- `public/prep/prep.css` lines 1-20 and 60-80 — Why: the "supplements app.css, never restates it"
  contract, and the only external consumers of `--surface-signature` / `--border-signature` /
  `--accent`. Read it so you know what your token changes do to the portal. **Do not edit it.**
- `test/prep-registry.test.js` lines 844-901 — Why: **the pattern you are mirroring.** Lines
  856-880 are the reduced-motion guard test (strip every `no-preference` block, then assert
  nothing animating remains); lines 882-901 are the selector-clash test that asserts `prep.css`
  restates no selector `app.css` owns — a live tripwire on any selector you add to `app.css`.
- `test/prep-session-ui.test.js` lines 805-840 — Why: the same two guards over `session.css`.
- `README.md` lines 186-200 — Why: the Decisions log entries this ticket falsifies. The
  `--text-muted` entry ends "…`--accent` is 3.00:1 on white, so it is a fill and never a text
  colour, and a button label on it must be `--text-primary` (5.62:1)" — after this ticket both
  halves are wrong. The provenance entry cites `--verified: #166534` and its measured ratios.
- `public/app.js` lines 408-426 — Why: `showAct` reveals an act with a **double `requestAnimation
  Frame`**, not `transitionend`. Read it so you can confirm for yourself that moving `.act`'s
  transition behind `no-preference` cannot strand an element at `opacity: 0`.

### New Files to Create

- `test/chrome.test.js` — the gate over the shared chrome files. Three concerns: (a) every
  `transition` / `animation` / `@keyframes` in `app.css` sits inside a
  `prefers-reduced-motion: no-preference` block; (b) `app.css` contains no raw hex (true today,
  unlocked); (c) `fonts.css` requests nothing off-origin, which is epic AC #5's "no CDN request"
  turned into a gate.

No other new files. `public/fonts/Aspekta500.woff2` is **deleted**.

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [WCAG 2.2 SC 1.4.3 Contrast (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
  - Specific section: the 4.5:1 normal-text threshold and what counts as "text"
  - Why: the floor `test/tokens.test.js` enforces. A button label and a provenance mark are both
    text; a focus ring and a marker bar are not.
- [WCAG 2.2 SC 1.4.11 Non-text Contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)
  - Specific section: 3:1 for user-interface components and graphical objects
  - Why: the floor `--border` and (now) `--accent` are held to.
- [CSS Fonts Module Level 4 — font matching algorithm, §5.2 `font-weight`](https://www.w3.org/TR/css-fonts-4/#font-style-matching)
  - Specific section: "If the desired weight is inclusively between 400 and 500 … weights less
    than the target weight are checked in descending order"
  - Why: **the single most likely silent bug in this ticket.** Geist ships 400 and 600. A request
    for `font-weight: 500` resolves to **400**, not 600. Every heading in `app.css` asks for 500
    today because Aspekta only had a 500 face.
- [MDN — `prefers-reduced-motion`](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion)
  - Specific section: the `no-preference` value and why it is not simply the negation of `reduce`
  - Why: `no-preference` is false on a UA that reports no preference *support*. Under this
    ticket's structure that means **no transition at all** — every element renders at its final
    state immediately. That is the right outcome *here specifically*, because nothing in this repo
    waits on `transitionend` (see task 7's grep). It is not a general principle; a file that ever
    does gate visibility on a transition completing would break under the same condition.
- [MDN — `@font-face` / `font-display: swap`](https://developer.mozilla.org/en-US/docs/Web/CSS/@font-face/font-display)
  - Why: the existing files use `swap`; keep it. Epic AC: nothing that delays first paint.

### Patterns to Follow

**Measured numbers live beside the value, in the file.** This is the repo's strongest convention
and `tokens.css` is where it is densest. Every colour decision carries its ratio:

```css
/* Darkened from stackai's #8c8c8c for a contrast MUST, not a preference (#5). #8c8c8c on
   --surface measures 3.08:1 and row meta and the note scaffold both sit on --surface, so it
   failed the 4.5:1 body-text floor. #6b6b6b is 4.89:1 on --surface and 5.33:1 on
   --background. This is engine-side, so #8 inherits the fix. */
--text-muted:   #6b6b6b;
```
`tokens.css:19-23`. Every token you change gets the same treatment, with the numbers from the
table under **IMPLEMENTATION PLAN → Phase 1**.

**The reduced-motion guard, opt-in.** `prep.css` already does what AC #6 asks for. Mirror its
shape — one `@media` block, everything inside it, nothing animating outside:

```css
@media (prefers-reduced-motion: no-preference) {
  .block { animation: block-in var(--duration-2) var(--ease-out) both; }
}
```
`public/prep/prep.css` (search `no-preference`).

**A gate parses the file rather than a rendered page.** Zero dependencies, `node --test`, no DOM.
`test/tokens.test.js:16-32` and `test/prep-registry.test.js:844-880`. `test/chrome.test.js`
follows the same shape — read the file, strip comments, assert on the text:

```js
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
```

**Strip the guarded blocks, then assert nothing remains.** The exact brace-counting loop to reuse
lives at `test/prep-registry.test.js:863-879`. Copy it; do not invent a regex that "should"
match nested braces.

**A test name states the invariant, and the assertion message states the fix.**

```js
`--${name} (${token(name)}) on --${surface} (${token(surface)}) measures ` +
  `${measured.toFixed(2)}:1, under the ${floor}:1 floor. Darken the token rather than ` +
  `lowering this number: ${why}.`
```
`test/tokens.test.js:94-96`.

**Naming: tokens are named for their ROLE, never their colour.** `--verified`, not `--green`.
`--surface`, not `--grey`. That is what makes an agency's branding a value swap. The three new
tints follow it: `--tint-verified` / `--tint-info` / `--tint-warn`, **not** `--mint` / `--powder`
/ `--blush`. Kebab-case throughout; the file uses no other convention.

**British English in prose, American in CSS identifiers.** Comments say "colour"; the property is
`color`. `tokens.css` line 15 (`/* colour */`) over `--background`.

---

## IMPLEMENTATION PLAN

Phases run top to bottom.

### Phase 1: The token layer

Rewrite `public/tokens.css` and extend `test/tokens.test.js` together — the gate is what proves
the palette, so they land in one step, gate first if you prefer (it will fail red, then green).

**Every value below is already measured.** Do not re-derive them; do verify them by running the
gate.

| Token | Old | **New** | Measured (on `--background` / `--surface` / `--surface-signature`) |
|---|---|---|---|
| `--background` | `#ffffff` | **`#fdfafa`** | the ground |
| `--surface` | `#f5f5f5` | **`#f4efee`** | one warm step down; 1.10:1 from the ground |
| `--text-primary` | `#1d1d1d` | **`#2e3332`** | 12.37 / 11.27 / 11.59 |
| `--text-muted` | `#6b6b6b` | **`#5c6764`** | 5.65 / 5.15 / 5.29 |
| `--accent` | `#0099ff` | **`#08906c`** | 3.88 / 3.53 / 3.63 — **3:1 floor, decorative only** |
| `--accent-strong` | *(new)* | **`#087e60`** | white label on it: **5.04** |
| `--on-accent` | *(new)* | **`#ffffff`** | the label colour on `--accent-strong` |
| `--border` | `#595959` | **`#78827f`** | 3.82 / 3.48 / 3.58 — 3:1 floor |
| `--border-hairline` | `#e3e3e3` | **`#e7e1e0`** | 1.25:1, decorative by contract (was 1.28) |
| `--danger` | `#78350f` | **unchanged** | 8.74 / 7.96 / 8.19 |
| `--verified` | `#166534` | **`#0b5c46`** | 7.68 / 7.00 / 7.20 — moved into the accent's hue |
| `--unverified` | `#8a5300` | **unchanged** | 6.10 / 5.55 / 5.71 |
| `--failed` | `#9f1239` | **unchanged** | 7.72 / 7.03 / 7.23 |
| `--tint-verified` | *(new)* | **`#c4ece1`** | ink 10.05, `--verified` 6.24 |
| `--tint-info` | *(new)* | **`#b0d4e8`** | ink 8.21 |
| `--tint-warn` | *(new)* | **`#fbeeec`** | ink 11.34, `--unverified` 5.59, `--failed` 7.08, `--danger` 8.01 |
| `--surface-signature` | `#eaf5ff` | **`#eaf6f1`** | retinted blue → mint; column above holds |
| `--border-signature` | `#cbe2f3` | **`#cfe7dd`** | decorative edge, 1.18:1 on its own ground |
| `--shadow-card` | alphas on `#1d1d1d` | alphas on **`#2e3332`** | not a pairing |

Unchanged and not to be touched: the `--text-*` ramp, `--space-*`, `--radius`, `--max-width`,
`--tap-target`, `--ease-out`, `--duration-*`, `--focus-width`, `--focus-inner`, `--hairline`.

`--font-ui` and `--font-body` both become `"Geist", system-ui, -apple-system, sans-serif`.
**Keep both token names.** They have 14 + 3 call sites across `app.css` and `prep.css`, and
`prep.css` belongs to #62 — collapsing to one name is a cross-ticket edit for no functional gain.
Say so in the comment so it does not read as an oversight.

**Tasks:**

- Rewrite the `tokens.css` header comment: the palette is now owner-decided from zig.ai
  (epic #57), not the stackai default, and the fonts are on disk.
- Replace every colour value per the table, each with its measured ratios inline.
- Add `--accent-strong`, `--on-accent`, and the three `--tint-*` tokens.
- Extend `test/tokens.test.js`: add `--accent` to `PAIRINGS` at the 3.0 floor; add
  `surface-signature` to `SURFACES`; add a `TINTS` table asserting ink and each mark on the tint
  it renders on; replace the `--text-primary` on `--accent` test with `--on-accent` on
  `--accent-strong`.

### Phase 2: The type stack

**Depends on:** Phase 1 (`--font-ui` / `--font-body` must already point at Geist).

**Tasks:**

- Delete `public/fonts/Aspekta500.woff2` and its `@font-face` rule.
- Rewrite the `fonts.css` licence paragraph for three files instead of four.
- Change every `font-weight: 500` in `app.css` to `600` — the font-matching gotcha above.

### Phase 3: Shared chrome on the new tokens

**Depends on:** Phases 1–2.

**Tasks:**

- `.btn-primary`: `background: var(--accent-strong)`, `color: var(--on-accent)`; rewrite its
  comment with the new numbers. `:hover` keeps drawing the border in rather than darkening the
  fill (the existing reason still holds — hover must never remove contrast).
- Audit the other seven `var(--accent)` uses. **All seven are already confirmed decorative** (see
  NOTES → *The accent audit*) — this is a re-verify, not a redesign.
- Update the stale contrast numbers in `app.css`'s comments (lines 62-63, 75-77, 160-161,
  177-178, 190-192, 196-197).
- `404.html`: no markup change needed. Verify it renders on the new base and its inline `<style>`
  still uses tokens only.

### Phase 4: The motion inversion

**Depends on:** Phase 3 (do it last — it moves declarations you were reading in place).
**Independent of:** Phase 1's palette work, in principle. Not worth parallelising: same file.

**Tasks:**

- Remove the six `transition:` declarations from their rules.
- Add one `@media (prefers-reduced-motion: no-preference)` block at the foot of `app.css`,
  after the mobile-density block, restating those six selectors with their transitions.
- Delete the `@media (prefers-reduced-motion: reduce)` block.
- Add `test/chrome.test.js`.

### Phase 5: The record

**Depends on:** Phases 1–4.

**Tasks:**

- Update `README.md`'s Decisions log: the two entries this ticket falsifies, plus a new entry for
  the palette swap and the `--accent` / `--accent-strong` split.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

> **Before you start — the validation command.** The ambient shell runs **Node 20.20.2**, which is
> below `engines.node` (`>=22.5`). Under it, `npm test` reports **1 failure and 160 skips** —
> `test/node-version.test.js` failing is a *pre-existing* condition of the shell, not something
> you caused. Use Node 24 for every validation in this plan:
>
> ```bash
> ~/.nvm/versions/node/v24.11.0/bin/node --test test/*.test.js
> ```
>
> Verified baseline on `main` at plan time: **802 pass, 0 fail, 0 skipped.**

### Task Format Guidelines

Use information-dense keywords for clarity:

- **CREATE**: New files or components
- **UPDATE**: Modify existing files
- **ADD**: Insert new functionality into existing code
- **REMOVE**: Delete deprecated code
- **REFACTOR**: Restructure without changing behavior
- **MIRROR**: Copy pattern from elsewhere in codebase

---

### 1. UPDATE `test/tokens.test.js` — extend the gate before the palette moves

- **IMPLEMENT**: Four edits, all inside the existing structure.
  1. `SURFACES` (line 73) becomes `["background", "surface", "surface-signature"]`. Update the
     comment above it: there are now three grounds text renders on, and the signature one is
     mint-tinted.
  2. `PAIRINGS` (lines 78-86) gains one row: `["accent", 3.0, "a focus ring, an underline and a
     marker bar — never text"]`.
  3. Replace the test at lines 102-110 (`--text-primary on --accent`) with one asserting
     `--on-accent` on `--accent-strong` clears 4.5. Its comment must say *why the pair changed*:
     the decided `--accent` `#08906c` measures 4.03:1 against white and 3.19:1 against the ink, so
     the button fill is a darkened sibling of the accent and the floor did not move.
  4. Add a `TINTS` block after `PAIRINGS`: for each of `tint-verified`, `tint-info`, `tint-warn`,
     assert `--text-primary` clears 4.5 on it; plus `--verified` on `--tint-verified`, and
     `--unverified`, `--failed`, `--danger` on `--tint-warn`.
- **PATTERN**: The `for (const [name, floor, why] of PAIRINGS)` loop at `test/tokens.test.js:88-100`
  — same shape, same message style, for the tint table.
- **IMPORTS**: None new. The file already has `test`, `assert`, `readFileSync`, `join`, `dirname`,
  `fileURLToPath`.
- **GOTCHA**: `--text-muted` is deliberately **absent** from the tint table. It measures **3.75:1
  on `--tint-info`** and would fail. Write that number into a comment beside the table — this is
  a real constraint #60 inherits (a chip on the powder tint carries ink, never muted text), and a
  silent omission would read as an oversight. Do **not** add an assertion that muted *fails*; an
  agency darkening it must not break the suite.
- **GOTCHA**: `hexTokens` (lines 27-32) only matches `--name: #hex;`. Any token you later write as
  `rgb()`/`hsl()`/8-digit hex becomes invisible to the gate and `token()` throws — which is the
  intended behaviour, but know it before you debug it.
- **VALIDATE**: `~/.nvm/versions/node/v24.11.0/bin/node --test test/tokens.test.js` — expect
  **failures** at this point (the new pairings measure the *old* palette). Confirm the failures
  are the ones you expect, then move on.
- **SATISFIES**: AC #2 (contrast gates), and it is the instrument for AC #1.

### 2. UPDATE `public/tokens.css` — the palette

- **IMPLEMENT**: Replace every colour per the Phase 1 table. Rewrite the file header: this palette
  is owner-decided from zig.ai for epic #57, not the stackai default; the fonts named by
  `--font-*` are now on disk. Each changed token carries its measured ratios inline, in the
  existing house style. Specifically:
  - `--accent: #08906c` — comment must say it is **decorative only**: focus ring, link and
    `aria-current` underlines, the `.client-row` marker bar, the dragover edge. 3.88 / 3.53 / 3.63
    against the three grounds, all clearing the 3:1 non-text floor; **2.57:1 on `--tint-info`**,
    which is why `:focus-visible`'s inner `--text-primary` hairline stays.
  - `--accent-strong: #087e60` — the accent darkened until a white label clears the body-text
    floor (5.04:1). The decided `#08906c` measures 4.03:1 with white and 3.19:1 with the ink;
    ticket AC #3 says the gates win over raw reference values, and this is the minimum darkening
    that satisfies it. Used for `.btn-primary`'s fill and nothing else.
  - `--on-accent: #ffffff` — exists so `app.css` needs no raw hex.
  - `--verified: #0b5c46` — note this one is **not** gate-forced: the old `#166534` clears every
    floor (6.87 / 6.26). It moves so the "sourced" green sits in the accent's hue family rather
    than beside it. Say that in the comment, honestly.
  - `--tint-*` — named by role, not colour. Note they are backgrounds, that #60 builds the chips
    on them, and that a chip carries ink or its own mark colour, never `--text-muted`.
    `--tint-info` in particular has **no consumer yet** — say so in the comment ("defined here
    because #58 owns the token layer; first consumer is #60") so a reviewer reads it as a
    deliberate hand-off rather than dead weight.
  - `--surface-signature` / `--border-signature` — retinted blue → mint. Note that `prep.css`
    consumes them and that #60 may replace the pair wholesale with the Canopy pattern.
- **PATTERN**: `tokens.css:19-23` (the `--text-muted` entry) is the exact register to write in.
- **IMPORTS**: n/a.
- **GOTCHA**: `--shadow-card` (lines 45-46) hard-codes `#1d1d1d` in two of its four alpha layers —
  the *old* ink. Move both to `#2e3332`. The gate ignores 8-digit hex, so nothing will catch this
  for you.
- **GOTCHA**: `--font-ui` and `--font-body` both become Geist. Keep **both names** and say why in
  the comment (14 + 3 call sites, and `prep.css` is #62's file). Delete `"Aspekta 500"` from the
  `--font-ui` stack.
- **GOTCHA**: Do not touch `--text-*` sizes, `--space-*`, `--radius`, `--max-width`,
  `--tap-target`, `--hairline`, `--ease-out`, `--duration-*`, `--focus-*`. Ticket AC #5 says no
  layout work.
- **VALIDATE**: `~/.nvm/versions/node/v24.11.0/bin/node --test test/tokens.test.js` → **all green.**
- **SATISFIES**: AC #1 (every colour in `tokens.css`), AC #2 (gates pass).

### 3. REMOVE `public/fonts/Aspekta500.woff2` and UPDATE `public/fonts.css`

- **IMPLEMENT**: `git rm public/fonts/Aspekta500.woff2`. Delete the `@font-face` block at
  `fonts.css:16-22`. Rewrite the header comment for three files: Geist (Vercel, SIL OFL, latin
  subset, 400 + 600) as the one sans, DM Mono (Colophon, SIL OFL) as the one mono, both from
  Google Fonts' hosted woff2. Delete the Aspekta paragraph and the sentence at lines 11-14 about
  Aspekta's single 500 face — replace it with the real constraint: **Geist ships 400 and 600, so
  headings ask for 600; a request for 500 would resolve down to 400 under the CSS font-matching
  algorithm and render headings at regular weight.**
- **PATTERN**: The existing licence paragraph at `fonts.css:1-14` — sources, licences, and the
  date they were checked.
- **GOTCHA**: `font-display: swap` stays on all three. Do not add `preload` links — that is a
  performance change nobody asked for and it competes with first paint.
- **GOTCHA**: Three files remain (`Geist-Regular.woff2`, `Geist-SemiBold.woff2`,
  `DMMono-Regular.woff2`). Confirm with `ls public/fonts/` — a stray fourth file means the delete
  did not stage.
- **VALIDATE**: `ls public/fonts/ && grep -c "@font-face" public/fonts.css` → three files, `3`.
  Then `! grep -qi aspekta public/fonts.css public/tokens.css public/app.css && echo "no aspekta"`.
- **SATISFIES**: AC #3 (fonts self-hosted, subsetted woff2, no CDN).

### 4. UPDATE `public/app.css` — headings to 600, and the type comment

- **IMPLEMENT**: `h1` (line 37) and `h2` (line 46) go from `font-weight: 500` to `600`. Rewrite
  the comment at lines 31-33: it currently explains 500 by Aspekta's single face. The new reason
  for 600 is the font-matching fallback — Geist has no 500, and a request for it resolves
  **downward** to 400, which would render every heading at body weight.
- **PATTERN**: `.claim-requirement` (line 802) and `.client-name` (line 366) already use
  `font-weight: 600` against Geist. This makes the whole file consistent on one bold.
- **GOTCHA**: `grep -n "font-weight: 500" public/app.css` first — take *all* of them, not just
  `h1`/`h2`. Also check `public/prep/privacy.html`'s inline `<style>` (`.retention th` uses 500);
  **leave it alone** — that page is #62's, and 400 there is a cosmetic regression the portal
  ticket will fix, not a correctness one. Note it in the PR body.
- **VALIDATE**: `! grep -n "font-weight: 500" public/app.css && echo "no 500 left in app.css"`
- **SATISFIES**: AC #3, and AC #5 (the screens still render acceptably).

### 5. UPDATE `public/app.css` — `.btn-primary` onto `--accent-strong`

- **IMPLEMENT**: At lines 176-182, `background: var(--accent-strong)` and
  `color: var(--on-accent)`. Rewrite the comment at 177-178: white on the accent-strong fill is
  5.04:1; the decided `--accent` itself is 4.03:1 with white and 3.19:1 with the ink, so the fill
  is the accent darkened rather than the accent itself. Leave `border-color: transparent`.
- **PATTERN**: The comment it replaces (`app.css:177-178`) — same shape, new numbers.
- **GOTCHA**: `.btn-primary:hover` (line 193) sets `border-color: var(--text-primary)`. Its
  comment claims hover would take the label "from 5.62:1 to about 4.4:1" — that number is the old
  palette's. Update it or generalise the sentence; the *rule* (hover draws the border in, never
  darkens the fill, because hover must not remove contrast) still stands.
- **GOTCHA**: `.btn[disabled]` / `[aria-disabled="true"]` (lines 202-208) override `background`
  and `color`, so they already neutralise the primary fill. Verify a disabled primary button still
  reads as disabled on the new palette — `--text-muted` on `--surface` is 5.15:1, so it does.
- **VALIDATE**:
  ```bash
  ~/.nvm/versions/node/v24.11.0/bin/node --test test/tokens.test.js   # green
  grep -n "var(--accent)" public/app.css        # → exactly 6 hits (~66, ~73, ~131, ~344, ~351, ~708)
  ! grep -q "5\.62:1" public/app.css            # the old button ratio, twice, both in this task's comments
  ```
  `.btn-primary` must no longer appear in the `var(--accent)` list. `5.62:1` occurs **twice** in
  the file today (lines 178 and 191) and both are yours — this grep is the check that you got
  both, not just the first.
- **SATISFIES**: AC #2, AC #5.

### 6. UPDATE `public/app.css` — the stale contrast numbers in comments

- **IMPLEMENT**: Three comments outside `.btn-primary` cite measurements from the old palette.
  Correct each:
  - line 62-63 (`a`): "`--accent` measures 3.00:1 on `--background`" → **3.88:1**. The conclusion
    is unchanged — still under 4.5, so link text stays `--text-primary` and the accent carries the
    underline.
  - lines 75-77 (`:focus-visible`): "`--accent` is 2.75:1 against `--surface`" → **3.53:1**, which
    now clears the 3:1 non-text floor on its own. **Keep the inner hairline anyway** and say why:
    `--accent` is 2.57:1 on `--tint-info`, and #60 puts focusable controls on the tints.
  - lines 705-706 (`.is-dragover`): "`--accent` as a border is a fill use, never text" — still
    true; add the measured 3.53:1 on `--surface` so it is a number rather than an assertion.

  Leave alone: lines 160-161 (`.btn` min-height, no ratio) and 196-197 (disabled buttons, no
  ratio). Lines 177-178 and 190-192 belong to task 5 and are already done.
- **PATTERN**: Every comment in this file states a measured ratio, not a claim. Keep that.
- **GOTCHA**: This is comment-only. Do not let it turn into a restyle. If a comment's *conclusion*
  changes (as at line 75), say so explicitly rather than quietly editing the number.
- **VALIDATE**: `! grep -q "3\.00:1\|2\.75:1" public/app.css` — no output. Note this grep still
  fails after task 5 alone (line 62's `3.00:1` survives it), so it is a real gate on *this* task
  rather than one task 5 already satisfied.
- **SATISFIES**: AC #2 (the file's own record of why it passes stays true).

### 7. REFACTOR `public/app.css` — invert the motion guard

- **IMPLEMENT**: Two moves.
  1. Delete the `transition:` declaration from each of the six rules: `.topbar-nav a` (line 123),
     `.btn` (lines 163-165), `.client-row` (line 336), `.save-state` (line 409), `.act` (line 588),
     `.file-input::file-selector-button` (line 699).
  2. Delete the `@media (prefers-reduced-motion: reduce)` block (lines 1016-1018) and put in its
     place one `@media (prefers-reduced-motion: no-preference)` block restating those six
     selectors with their transitions, under a `── motion, defined once ──` section rule in the
     file's existing comment style:

  ```css
  @media (prefers-reduced-motion: no-preference) {
    .topbar-nav a { transition: color var(--duration-1) var(--ease-out); }
    .btn {
      transition: border-color var(--duration-1) var(--ease-out),
                  transform var(--duration-1) var(--ease-out),
                  box-shadow var(--duration-1) var(--ease-out);
    }
    .client-row { transition: background-color var(--duration-1) var(--ease-out); }
    .file-input::file-selector-button { transition: border-color var(--duration-1) var(--ease-out); }
    .save-state { transition: opacity var(--duration-2) var(--ease-out); }
    .act { transition: opacity var(--duration-2) var(--ease-out); }
  }
  ```
  The block comment must say what changed and why: opt-in rather than opt-out, so a transition
  added anywhere else is a test failure rather than a live animation. On the `no-preference`
  edge, write the specific fact rather than the folklore: **a UA that reports no preference
  support matches nothing here and gets no transition, so every element renders at its final
  state immediately — safe because nothing in this repo waits on `transitionend`.** Do not write
  "fails safe" unqualified; #59 and #62 will copy this comment.
- **PATTERN**: `public/prep/prep.css`'s `no-preference` block — the idiom this ports to `app.css`.
- **GOTCHA — the one that could break behaviour**: this is only safe because **no JavaScript in
  this repo waits on `transitionend` or `animationend`**. Verified at plan time:
  `grep -rn "transitionend\|animationend\|getComputedStyle" public/*.js public/prep/*.js` returns
  nothing. `showAct` (`app.js:410-426`) uses a double `requestAnimationFrame`; `showState`
  (`app.js:380-391`) just toggles classes. **Re-run that grep** before you delete anything — if it
  ever returns a hit, stop and reconsider.
- **GOTCHA**: The `reduce` block's `*, *::before, *::after { … !important }` is broader than the
  six transitions — it also neutralises `prep.css` and `session.css`. Deleting it is still correct
  because **both of those files already self-guard**: `prep-registry.test.js:856-880` and
  `prep-session-ui.test.js:816` assert every animation in them sits inside a `no-preference`
  block. That is a verified fact, not an assumption — but confirm it by running those two files.
- **GOTCHA**: The new block restates selectors `app.css` already declares. That is fine for
  `prep-registry.test.js:882`'s clash test (it builds a `Set` from each file and intersects
  across *files*), but run it early rather than at the end.
- **VALIDATE**:
  ```bash
  grep -c "transition:" public/app.css                       # → 6, all inside the guard
  ~/.nvm/versions/node/v24.11.0/bin/node --test test/prep-registry.test.js test/prep-session-ui.test.js
  ```
- **SATISFIES**: AC #4 (base transitions defined once, wrapped in `no-preference`).

### 8. CREATE `test/chrome.test.js` — the gate that holds tasks 3 and 7

- **IMPLEMENT**: Three tests over `public/app.css` and `public/fonts.css`.
  1. *"every transition in app.css sits behind the reduced-motion guard"* — strip each
     `@media … prefers-reduced-motion: no-preference` block by brace counting, then assert the
     remainder matches no `transition|animation|@keyframes`.
  2. *"no colour is declared outside tokens.css"* — for `public/app.css` **and the four
     page-scoped `<style>` blocks** (`404.html`, `prep/index.html`, `prep/login.html`,
     `prep/privacy.html`): strip comments, then
     `assert.doesNotMatch(declarations, /#[0-9a-fA-F]{3,8}\b/)`. Both halves of ticket AC #1 need
     this — the `app.css` half *and* "every colour in `tokens.css`", which is only true if no
     inline block sneaks one in. Same read, same regex, four extra paths; extract the `<style>`
     bodies with `[...html.matchAll(/<style>([\s\S]*?)<\/style>/g)]`.
  3. *"fonts.css requests nothing off-origin"* — assert every `src: url(...)` is a root-relative
     `/fonts/…` path and the file matches no `http`, `//` protocol-relative URL or `@import`. This
     is epic AC #5's "no CDN request" as a gate.
  File header comment: what class of failure each test catches, in the register of
  `test/tokens.test.js:1-14` — and a line distinguishing this file from `tokens.test.js` (colour
  pairings) the way `prep-tokens.test.js:8-9` distinguishes itself.
- **PATTERN**: **Copy the brace-counting loop verbatim from `test/prep-registry.test.js:863-879`.**
  Do not write a new regex for nested braces. Comment-stripping idiom:
  `source.replace(/\/\*[\s\S]*?\*\//g, "")` (`prep-registry.test.js:887`).
- **IMPORTS**:
  ```js
  import { test } from "node:test";
  import assert from "node:assert/strict";
  import { readFileSync } from "node:fs";
  import { join, dirname } from "node:path";
  import { fileURLToPath } from "node:url";
  ```
- **GOTCHA**: Strip comments **before** the hex assertion — `app.css`'s comments quote hex values
  (`#8c8c8c`, `#0099ff`) as part of their reasoning and always will. Note that comment-*span*
  stripping (`/\/\*[\s\S]*?\*\//g`) is not the same filter as "skip lines beginning with a comment
  marker": it also removes trailing comments on declaration lines. **Run the exact assertion
  before you write the test**, so a day-one red does not read as your own breakage:
  ```bash
  node -e 'const s=require("fs").readFileSync("public/app.css","utf8").replace(/\/\*[\s\S]*?\*\//g,"");
  console.log(s.match(/#[0-9a-fA-F]{3,8}\b/g)||"clean")'
  ```
  Verified at plan time: `app.css` **clean**, and all four `<style>` blocks **clean**.
- **GOTCHA**: Do **not** add a "no raw px" assertion. `app.css` legitimately carries `1px` borders
  and `text-decoration-thickness: 2px`. That rule belongs to `prep.css`/`session.css`, which
  supplement rather than define.
- **VALIDATE**: `~/.nvm/versions/node/v24.11.0/bin/node --test test/chrome.test.js` → green. Then
  sanity-check the guard test actually bites: temporarily add `.card { transition: all 1s; }` at
  the top of `app.css`, confirm the test **fails**, remove it.
- **SATISFIES**: AC #1, AC #3, AC #4 — turns three conventions into gates.

### 9. UPDATE `public/404.html` — verify on the new base

- **IMPLEMENT**: Most likely **no change**. It links `fonts.css` → `tokens.css` → `app.css` and
  uses `.page-head` / `.page-sub` plus two token-only inline rules. Confirm it renders correctly
  and that the inline `<style>` still resolves through tokens. Only touch it if something is
  actually wrong.
- **PATTERN**: Its own comment at lines 19-28.
- **GOTCHA**: **Read that comment before editing.** This file is security-relevant (#20): without
  it, Cloudflare Pages serves `index.html` at status 200 for any unmatched path, which would hand
  the recruiter's tool shell to anyone requesting `/prep/anything`. It must keep no navigation, no
  product name, and no hint of what else is on the hostname. Do not "improve" it by adding a link
  home.
- **VALIDATE**: `npm run dev`, open `http://localhost:8788/does-not-exist`, confirm **404** status
  and the restyled page. `curl -s -o /dev/null -w "%{http_code}" http://localhost:8788/nope` → `404`.
- **SATISFIES**: AC #5.

### 10. UPDATE `README.md` — the Decisions log

- **IMPLEMENT**: Two corrections and one new entry, in the log's existing voice (dated, ticket-
  numbered, with measured numbers).
  - The `--text-muted` entry (~line 186) closes with "`--accent` is 3.00:1 on white, so it is a
    fill and never a text colour, and a button label on it must be `--text-primary` (5.62:1)".
    Both halves are now wrong. Follow the file's own convention for superseded decisions — keep
    the entry, mark what supersedes it (the "Model access" entry at line 95 is the worked example).
  - The provenance entry (~line 191) cites `--verified: #166534` and its ratios. Update to
    `#0b5c46` (7.68 / 7.00) and note the other two are unchanged and still measured.
  - **New entry**, dated 2 Aug 2026, #58: the palette is now owner-decided from zig.ai for epic
    #57 and no longer the stackai default; `--accent` `#08906c` is decorative-only at the 3:1
    floor; `--accent-strong` `#087e60` exists because a white label on the decided accent is
    4.03:1 and ticket AC #3 says the gates win over raw reference values; the type stack
    consolidated to Geist + DM Mono; motion is opt-in behind `no-preference`, gated by
    `test/chrome.test.js`.
- **PATTERN**: `README.md:95-110` — how this log supersedes rather than deletes.
- **GOTCHA**: The "Visual base: neutral, not the saulera Sunrise palette" entry (~line 207) is
  **still true** and must not be touched. The new palette is a zig.ai-derived neutral-warm one,
  not saulera's Sunrise brand, and the "one deployment per agency, branding is a variable swap"
  reasoning is untouched by this ticket.
- **VALIDATE**: `grep -n "3.00:1\|5.62:1\|#166534" README.md` → no output outside a clearly
  marked superseded block.
- **SATISFIES**: AC #2 — the repo's record of why the palette passes stays true.

### 11. Full validation and manual pass

- **IMPLEMENT**: Run everything in **VALIDATION COMMANDS** below, including the manual pass over
  all eight pages.
- **VALIDATE**: `~/.nvm/versions/node/v24.11.0/bin/node --test test/*.test.js` → **802 + your new
  tests, 0 fail, 0 skipped.**
- **SATISFIES**: AC #5 and the completion checklist.

---

## TESTING STRATEGY

The project's framework is **`node --test`, zero dependencies, no DOM** (`package.json`:
`"test": "node --test test/*.test.js"`). Gates here parse source files rather than render pages —
`test/tokens.test.js:8-11` states that constraint explicitly and the plan does not relax it.

### Unit Tests

- **`test/tokens.test.js` (extended)** — every colour pairing in the new palette, measured. Three
  surfaces × seven text/border tokens, plus the tint table, plus the button pair. Fixtures are the
  file itself; assertions are WCAG ratios computed in-file.
- **`test/chrome.test.js` (new)** — three structural assertions over `app.css` and `fonts.css`:
  motion is guarded, no raw hex, no off-origin font request.

### Integration Tests

There is no browser harness and this ticket does not add one (epic AC #5 forbids a build step).
The integration surface is covered by two existing suites that must stay green, because they
assert cross-file invariants this ticket's edits could break:

- **`test/prep-registry.test.js`** — `prep.css` restates no selector `app.css` owns; every
  animation in `prep.css` is guarded.
- **`test/prep-session-ui.test.js`** — the same over `session.css`.

Run those two **immediately after task 7**, not at the end.

### Edge Cases

- **A heading rendered at 400 instead of 600.** The CSS font-matching fallback. Caught by eye in
  the manual pass, and by `! grep "font-weight: 500" public/app.css`.
- **A disabled primary button.** `[disabled]` overrides both `background` and `color`, so
  `--accent-strong` must not leak through. `--text-muted` on `--surface` is 5.15:1.
- **Focus ring on a tinted ground.** `--accent` is 2.57:1 on `--tint-info`. The inner
  `--text-primary` hairline is what keeps the indicator visible. Verify by tabbing to a control
  inside act 3.
- **Focus ring on the selected client row.** `app.css:350-353` restates both shadows because the
  marker bar would otherwise win over the focus hairline. Verify by tabbing through `/clients`.
- **Reduced motion actually on.** Toggle macOS *System Settings → Accessibility → Display → Reduce
  motion*, then reveal an act and trigger a save. Both must appear **instantly and completely** —
  an element stuck at `opacity: 0` is the failure mode this inversion could introduce.
- **A very long client name / competency label.** `overflow-wrap: anywhere` rules are unaffected by
  a palette change, but the font swap changes metrics. Spot-check `/clients` with a long name.
- **The `/prep/*` pages.** They link `tokens.css` and `app.css` and this ticket changes their base
  out from under #62. They must still render acceptably — especially `prep.css`'s
  `.block:first-of-type`, which composes `--surface-signature`, `--border-signature` and
  `--accent` and is the one place all three retinted tokens meet.

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

The repo has no linter and no formatter (no eslint/prettier config, no lint script) — the style
gates are the tests themselves. These are the direct checks:

```bash
grep -c "transition:" public/app.css          # → 6, and all six inside the no-preference block
! grep -n "font-weight: 500" public/app.css   # → no output
! grep -rniq aspekta public/                  # → no output
ls public/fonts/                              # → exactly 3 .woff2 files
grep -c "@font-face" public/fonts.css         # → 3
grep -n "var(--accent)" public/app.css        # → exactly 6, none of them .btn-primary
```

### Level 2: Unit Tests

```bash
$NODE --test test/tokens.test.js test/chrome.test.js
```

### Level 3: Integration Tests

```bash
$NODE --test test/prep-registry.test.js test/prep-session-ui.test.js   # the cross-file tripwires
$NODE --test test/*.test.js                                            # the whole suite
```

Expected: **802 baseline + the new tests, 0 fail, 0 skipped.**

### Level 4: Manual Validation

```bash
npm run dev     # scripts/dev.py — wrangler pages dev on :8788, migrates the local D1 first
```

Walk all eight pages. On each, check: nothing illegible, no blue left anywhere, headings look
bold, focus rings visible on every control you can tab to.

| Route | What specifically to look at |
|---|---|
| `/` | The three act chips; a primary button (green fill, white label, legible); paste a brief + CV and reveal act 2; the elapsed counter in mono |
| `/clients` | The rail; a selected row's green marker bar **and** bold name; tab to it and confirm the focus ring survives the bar; save a note and watch the state line fade in |
| `/counts` | The table hairlines against the warm ground; tabular figures still aligned |
| `/does-not-exist` | **Status 404** (`curl -s -o /dev/null -w "%{http_code}" http://localhost:8788/nope`), restyled, still no navigation and no product name |
| `/prep/` | Renders acceptably on the new base |
| `/prep/login` | The six-digit code field (mono, tracked); the `.notice` panel on `--surface` |
| `/prep/privacy` | The retention table; `.retention th` will render at 400 not 500 — **expected**, #62's to fix |
| `/prep/brief` | `.block:first-of-type` — the one place `--surface-signature`, `--border-signature` and `--accent` all meet |

Then, with **Reduce motion ON** (System Settings → Accessibility → Display):

- Reveal act 2 on `/` → appears instantly, fully opaque. Not stuck invisible.
- Save a note on `/clients` → the state line appears instantly, fully opaque.
- Hover a button → no lift, no shadow, and the label stays legible.

And a resize check at 390px width on `/` and `/clients` (the mobile-density breakpoint is 859px).

### Level 5: Additional Validation (Optional)

- `jcodemunch` `get_changed_symbols` / `get_blast_radius` on `public/tokens.css` to confirm no
  consumer was missed.
- Any browser's accessibility inspector on `/` and `/clients` to spot-check computed contrast
  against the numbers in the Phase 1 table — the gate measures the *tokens*, not the rendered
  composite, so this is the one check it cannot do for you.

---

## ACCEPTANCE CRITERIA

Ticket #58's five, mapped to the tasks that satisfy them:

- [ ] **AC #1 — Every colour in `tokens.css`; `app.css` references tokens only** (epic AC #1).
      → tasks 2, 8. **Both** clauses gated by `test/chrome.test.js`'s no-raw-hex assertion, which
      covers `app.css` *and* the four page-scoped `<style>` blocks — the second clause is only
      true if no inline block declares a colour either.
- [ ] **AC #2 — All token pairs pass the repo's contrast gates; gates win over raw reference
      values** (epic AC #3). → tasks 1, 2, 5, 6, 10. Gated by the extended `test/tokens.test.js`.
      The `--accent` / `--accent-strong` split is this criterion being exercised, not bypassed.
- [ ] **AC #3 — Fonts self-hosted, subsetted woff2, no CDN request** (epic AC #5). → tasks 3, 4.
      Gated by `test/chrome.test.js`'s off-origin assertion.
- [ ] **AC #4 — Base transitions defined once, wrapped in
      `@media (prefers-reduced-motion: no-preference)`** (epic AC #6). → tasks 7, 8. Gated by
      `test/chrome.test.js`'s guard test.
- [ ] **AC #5 — All three recruiter screens still render acceptably on the new base (no layout
      work yet).** → task 11's manual pass. Extended in this plan to `404.html` and the four
      `/prep/*` pages, which link the same base.

Plus the standing bar:

- [ ] All validation commands pass with zero errors under Node 24
- [ ] Full suite green: 802 baseline + new tests, 0 fail, **0 skipped**
- [ ] No regressions in existing functionality (no JS, no `src/`, no markup touched)
- [ ] Keyboard and screen-reader behaviour unchanged — no markup, ARIA, live region or focus
      order edited (epic AC #3)
- [ ] `README.md` Decisions log updated and internally consistent
- [ ] Every changed colour carries its measured ratio in a comment, in the house style

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] All validation commands executed successfully
- [ ] Full test suite passes under Node 24 (0 fail, 0 skipped)
- [ ] `test/chrome.test.js`'s guard test verified to actually bite (temporary `transition: all`
      makes it fail)
- [ ] Manual pass over all eight pages, plus the reduce-motion pass and the 390px pass
- [ ] `404.html` still returns status 404 and still leaks nothing
- [ ] Acceptance criteria all met
- [ ] `git status` shows only these, and nothing else — **anything else is scope creep**:
      ```
      M  public/tokens.css      M  README.md             ??  test/chrome.test.js
      M  public/fonts.css       M  test/tokens.test.js
      M  public/app.css         D  public/fonts/Aspekta500.woff2
      M  public/404.html   (only if task 9 actually found something to fix)
      ```
- [ ] Branch is `feature/redesign-foundation` (or similar) off `main`, **not** the current
      `feature/locum-portal-primer-and-question-mix`
- [ ] PR body links `Closes #58` and notes the two known cosmetic deferrals (`prep/privacy.html`'s
      `font-weight: 500`, and the portal generally, both #62's)

---

## OPEN QUESTIONS / ASSUMPTIONS

**Decided during planning, not open** — recorded so they are not re-litigated:

1. **`--accent` cannot carry a label, so the palette gains `--accent-strong` + `--on-accent`.**
   The decided `#08906c` measures **4.03:1 against white** and **3.19:1 against the decided ink
   `#2e3332`** — both under the 4.5:1 body-text floor, and `.btn-primary` puts a label directly on
   it. Ticket AC #2 says "gates win over raw reference values", which pre-authorises exactly this.
   `#087e60` is the *minimum* darkening that clears the floor with a white label (5.04:1), and
   `--accent` keeps the owner's decided hex for all seven decorative uses. The alternative —
   darkening `--accent` itself to `#087e60` everywhere — is simpler by one token but discards the
   decided value at every use, including the six where it is perfectly legal. **If the owner would
   rather have one token than two, that is a one-line change and no other task moves.**

2. **Fonts: consolidate on Geist rather than fetch a new family.** Owner-chosen during planning
   (2 Aug 2026). Aspekta is deleted; Geist (400 + 600, latin subset, OFL, already on disk) is the
   one sans; DM Mono stays. The epic's phrasing was "current fonts are replaced" — this is a
   consolidation, and the owner took it with that trade-off stated.

3. **`--verified` moves from `#166534` to `#0b5c46` even though the old value passes.** Not
   gate-forced — a hue-harmony judgment, so the "sourced" green sits in the accent's family rather
   than beside it. Cheap to revert if the owner dislikes it: one token, no other change.

4. **The type ramp, `--radius`, `--max-width` and the space scale do not move.** Ticket AC #5 says
   no layout work. The epic's "big type" direction is real but belongs to #59, which will know
   what it is sizing.

**Genuinely open, and none of them block:**

5. **Does `--radius: 9px` survive the redesign?** The epic decides a palette and a type direction
   but says nothing about corner radius, and the two references disagree (zig.ai is soft;
   forcanopy is tighter). Left alone here; #59 or #60 should decide it once, in `tokens.css`.

6. **Is a `--tint-info` text token needed?** Nothing uses the powder tint yet. `--text-primary` is
   8.21:1 on it, which covers a chip. If #60 wants a coloured word on powder, `#134e63` measures
   5.84:1 and is the value to reach for — but adding it now would ship an unused token.

7. **`prep/privacy.html`'s `.retention th { font-weight: 500 }` will render at 400** after the
   Aspekta removal. Cosmetic, one page, and that page is #62's. Flagged in the PR rather than
   fixed here, to keep the ticket boundary clean.

**Assumptions this plan makes:**

- Node 24.11.0 at `~/.nvm/versions/node/v24.11.0/bin/node` remains available. If not, any Node
  ≥22.5 works; the point is not to validate under the ambient Node 20.
- `npm run dev` (wrangler pages dev + local D1 migration) works in the implementer's environment.
  If it does not, the manual pass can be done against static files, but the 404 status check
  needs the real Pages runtime.
- The current branch `feature/locum-portal-primer-and-question-mix` is unrelated work. **Branch
  from `main`.** Repo memory notes parallel sessions share this worktree and HEAD moves
  underneath — verify the branch before committing, and never `git add -A`.

---

## NOTES (open canvas)

### The accent audit — all eight `var(--accent)` uses, classified

This is the audit that decided the two-token shape. Exactly one use is text-bearing.

| # | Site | Use | Text? | Floor | New measurement |
|---|---|---|---|---|---|
| 1 | `app.css:66` | `a { text-decoration-color }` | no | decorative | — |
| 2 | `app.css:73` | `:focus-visible { outline }` | no | 3:1 | 3.88 / 3.53 ✓ |
| 3 | `app.css:131` | `.topbar-nav a[aria-current]` underline | no | decorative | — |
| 4 | **`app.css:179`** | **`.btn-primary { background }`** | **YES** | **4.5:1** | **fails → `--accent-strong`** |
| 5 | `app.css:344` | `.client-row[aria-current]` marker bar | no | 3:1 | 3.53 on `--surface` ✓ |
| 6 | `app.css:351` | same bar, restated with the focus ring | no | 3:1 | ✓ |
| 7 | `app.css:708` | `.is-dragover .textarea { border-color }` | no | 3:1 | 3.53 ✓ |
| 8 | `prep.css:71` | `.block:first-of-type { border-left }` | no | decorative | — |

Sites 5 and 7 are the interesting ones: both are the boundary of a *control state*, so they take
the 3:1 non-text floor rather than decorative licence — and both clear it. Neither is colour-alone
(the selected row is also bold; the dragover column also has a label saying "drop one on the box").

### Why the motion inversion is safe — the check that decided it

```
$ grep -rn "transitionend\|animationend\|getComputedStyle" public/*.js public/prep/*.js
(no output)
```

Nothing waits for a transition to end. `showAct` (`app.js:410-426`) uses a double
`requestAnimationFrame` and removes `.is-entering` unconditionally; `showState` (`app.js:380-391`)
and its four siblings in `clients.js` / `counts.js` / `prep/session.js` / `prep/brief.js` just
toggle `.is-shown`. Under reduced motion the final state renders instantly — which is the required
behaviour, and is what `app.js:417-419`'s comment already claims.

The `reduce` block being broader than app.css's six transitions is the other thing worth being
sure about. It is safe to delete because `prep.css` and `session.css` both self-guard, and both
have a *test* saying so (`prep-registry.test.js:879`, `prep-session-ui.test.js:816`). Nothing else
on the deployment animates: the four page-scoped `<style>` blocks in `404.html`,
`prep/index.html`, `prep/login.html` and `prep/privacy.html` contain no `transition`, `animation`
or `@keyframes` (checked at plan time).

### What #60 inherits from this ticket

Two constraints that came out of the contrast work and belong in #60's plan:

- **`--text-muted` is 3.75:1 on `--tint-info`** — under the 4.5:1 floor. A chip on the powder tint
  carries `--text-primary` (8.21:1) or its own mark colour, never muted text. The same token is
  fine on mint (4.59:1) and blush (5.18:1), but the rule is simpler than the exceptions.
- **`--border` is 2.53:1 on `--tint-info`** — under the 3:1 non-text floor. A bordered chip on
  powder needs a darker edge, *or* the border must be genuinely decorative because the chip also
  carries a word. The latter is this product's existing pattern (`app.css:814-824`: "Three
  signals, never colour alone") and is the cheaper answer.

Also: `--surface-signature` / `--border-signature` are retinted here rather than removed, so the
portal does not ship a blue card on a green page in the window between #58 and #62. #60 may
replace them wholesale with the Canopy chip pattern — that is expected, not a conflict.

### Alternatives weighed and rejected

| Option | Why not |
|---|---|
| Darken `--accent` itself to `#087e60`, one token | Simpler by one token, but discards the owner's decided hex at all six sites where it is legal. Kept as a one-line fallback in Open Questions #1. |
| Make `.btn-primary` an ink fill (`--text-primary` + white) | 12.84:1, trivially safe — but the epic calls the accent "the only pop" and an ink-filled primary removes it from the busiest control on the page. |
| Collapse `--font-ui` / `--font-body` into one `--font-sans` | Honest naming, but 17 call sites across two files, one of which (`prep.css`) is #62's. A cross-ticket edit for zero functional gain. |
| Add the three tints to `SURFACES` in the gate | Would auto-check every token against every tint — and immediately fail on `--text-muted` × powder (3.75) and `--border` × powder (2.53), neither of which is a real pairing. A separate `TINTS` table asserts what actually renders. |
| Ship a `--text-display` step for #59's big type | YAGNI. #59 adds it when it knows the size. |
| Add `<link rel="preload">` for the fonts | A performance change nobody asked for, competing with first paint. Epic AC: nothing that delays first paint. |

### Sequencing note

#58 is the only ticket in wave 1 and everything else waits on it, so the cost of getting the
tokens wrong is six tickets rebuilt on a bad base. That is the argument for extending the gate
(task 1) **before** touching the palette (task 2): the gate failing red on the old palette is the
proof it is measuring the right thing.

---

## Confidence

**9.5 / 10** for one-pass success. Every colour value in this plan has been computed against the
repo's own WCAG implementation and verified as ALL GREEN against the exact pairings the extended
gate will assert; the baseline suite is confirmed at 802/802 under Node 24; the two behavioural
risks (the font-weight fallback, the motion inversion) were each checked empirically rather than
reasoned about. The half-point off is the manual pass: eight pages judged by eye against
"renders acceptably", which no gate can settle.

---

## AMENDMENTS

<!-- Append-only. Newest at the bottom. -->
