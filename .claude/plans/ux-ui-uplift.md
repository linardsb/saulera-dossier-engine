# Feature: ux-ui-uplift

The following plan should be complete, but validate documentation and codebase patterns and task
sanity before implementing. Pay special attention to naming of existing tokens and classes.

## Feature Description

Raise both screens (`/` and `/clients`) to the stackai-design visual standard while keeping every
behavioural and accessibility decision the codebase already fought for. The user reports the tool
is hard to use. The grounded audit (screenshots in the scratchpad, `shots/01–09`) says why: the
type tokens have no font files behind them so everything renders as system-ui; every box wears the
same heavy `#595959` border so nothing has hierarchy; the two screens share no navigation; the
three-act flow gives no feedback when an act completes (frozen inputs look editable, the new act
arrives off-screen); file inputs are raw browser chrome; there is no favicon; the provenance
summary — the product's headline number — is a 12px caption; and the mobile rail eats the first
screenful. None of these are logic faults. All of them are fixable in the presentation layer.

Direction: the user directed the `stackai-design` skill. That is compatible with the committed
base — `tokens.css` states its values *are* the stackai defaults — so this work deepens the
existing direction: real Aspekta/Geist/DM Mono files (bundled in the skill), stackai's layered
elevation, its nav grammar, its ghost-button and badge patterns. Where stackai's raw values
conflict with this repo's measured accessibility decisions, the repo wins; see Patterns below.

## User Story

As a recruiter at a small agency
I want the pack tool to read as one coherent, guided workspace
So that I can produce a pack on a busy Thursday without wondering where I am in the flow

## Problem Statement

The screens are functionally complete but visually undifferentiated and unguided: no loaded
fonts, uniform heavy borders, no cross-screen navigation, invisible act transitions, default file
inputs, a buried provenance summary. PRD §6 makes speed and legibility the adoption condition;
the current presentation works against both.

## Solution Statement

A presentation-layer pass governed by stackai-design for aesthetics and dossier-design
(CRAFT.md + CHECKLIST.md) for correctness: ship the fonts the tokens already name, split the
border system into meaningful vs hairline, add stackai's card elevation, add a shared top bar,
make act transitions visible (frozen-input styling, scroll-into-view, numbered act chips), style
the file inputs, elevate the provenance summary, and fix existing copy that violates the house
humanizer rule (em dashes). No flow logic changes, no new storage, no build step.

## Out of Scope / Non-Goals

- Not changing: any API, any flow decision in `app.js`/`clients.js` (stale-response guards,
  clipboard gesture handling, focus management, aria-disabled pattern, beforeunload). JS changes
  are limited to: act scroll-into-view, provenance-summary markup, and act-state classes.
- Not changing: the three-act structure, the rail-first mobile order (picking a client is step
  0), the copy voice (only the em-dash violations).
- Not included: CSP header (its own ticket per `_headers`), a collapsible mobile rail, dark mode
  (stackai lists it; this product has no theme toggle and an agency swap is the theming story),
  scroll-journey/video motion from the stackai marketing site (this is a working tool; CRAFT.md:
  "a working tool wants less motion than a showcase").
- Not included: per-agency branding work. Everything stays custom-property-driven so branding
  remains a tokens.css swap.

## Feature Metadata

**Feature Type**: Enhancement
**Estimated Complexity**: Medium
**Primary Systems Affected**: `public/` only (HTML, CSS, two small JS surfaces), `test/tokens.test.js`
**Dependencies**: Font files bundled at `~/.claude/skills/stackai-design/fonts/` (Aspekta: MIT;
Geist, DM Mono: SIL OFL — all redistributable)

## Related Work

**Implements**: free-form user request (no GitHub issue)   ·   **Epic**: #1 (the engine epic)

**Back-references**:

- `.claude/plans/generation-seam-and-one-screen.md` - built the one screen this restyles
- `.claude/plans/client-knowledge-store.md` - built `/clients` and the component grammar

**Forward-references**: (none yet)

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: READ BEFORE IMPLEMENTING

- `public/tokens.css` - the whole token layer; every change flows through here first
- `public/app.css` - the component grammar; comments carry the contrast measurements that must
  survive (lines 56-72 focus system, 100-129 buttons, 552-576 marks)
- `public/index.html`, `public/clients.html` - both heads change (fonts, favicon, top bar)
- `public/app.js` (lines 260-295 `showAct`/`setPhase`, 781-786 provenance summary) - the only JS
  that changes on `/`
- `public/clients.js` - read for the shared grammar; changes only if the scaffold moves (HTML only)
- `test/tokens.test.js` - the contrast gate; PAIRINGS is an explicit list (line 78), so new
  tokens are NOT auto-tested; extend deliberately
- `.claude/probes/one-screen.mjs`, `.claude/probes/clients-screen.mjs` - behaviour probes; they
  select by `#id` and `.client-row`, so keep every existing id and that class name
- `/private/tmp/claude-501/-Users-Berzins-Desktop-saulera-dossier-engine/22cd25c5-6c4c-496e-8a18-6bd4901553bb/scratchpad/audit-shots.mjs`
  - the screenshot audit harness; re-run for before/after

### New Files to Create

- `public/fonts/Aspekta500-500.woff2`, `public/fonts/Geist-Regular.ttf`,
  `public/fonts/Geist-SemiBold.ttf`, `public/fonts/DMMono-Regular.ttf` - copied from the skill
  bundle
- `public/fonts.css` - the @font-face layer, linked before tokens.css
- `public/favicon.svg` - neutral mark, engine-side

### Relevant Documentation

- stackai-design skill (loaded this session): nav pattern, ghost button, badge, elevation
  Section 6, fonts bundle
- `.claude/skills/dossier-design/references/CRAFT.md` - numeric floors
- `.claude/skills/dossier-design/references/CHECKLIST.md` - the pre-commit gate; run it last

### Patterns to Follow

**Where stackai and this repo conflict, the repo's measured values win** (the tokens test
enforces most of these mechanically):

| stackai says | repo does | keep |
|---|---|---|
| `--text-muted: #8c8c8c` | `#6b6b6b` (4.89:1 on surface; README Decision) | repo |
| success `#22c55e` / warning `#c68a0b` | provenance triad `#166534/#8a5300/#9f1239` | repo |
| btn hover `opacity: .9` | border-draw hover (hover must not remove contrast) | repo |
| `transition: all` | explicit property lists (CHECKLIST NEVER) | repo |
| focus via bare outline | two-ring focus (accent + text-primary hairline) | repo |
| radius scale up to 447px | `--radius: 9px` everywhere | repo |

**Token discipline**: zero raw hex/px in `app.css`; new values enter `tokens.css` first.
**Copy**: en-GB, no em/en dashes, no "not X but Y", a control says what it does.
**JS idiom**: ES5-style vanilla, `textContent` never innerHTML-style assignment, COPY object for
all strings.

---

## IMPLEMENTATION PLAN

Single phase, ordered tasks; each is independently verifiable. Tokens first because everything
resolves through them; screenshots last because they verify the whole.

---

## STEP-BY-STEP TASKS

### CREATE public/fonts.css + public/fonts/ (the type actually arrives)

- **IMPLEMENT**: copy `Aspekta500-500.woff2`, `Geist-Regular.ttf`, `Geist-SemiBold.ttf`,
  `DMMono-Regular.ttf` from `~/.claude/skills/stackai-design/fonts/`. Check sizes first
  (`du -h`); if any single file exceeds ~400KB, drop Geist-SemiBold and let 600-weight
  synthesise. Four `@font-face` rules, `font-display: swap`, same-origin `/fonts/...` URLs
  (no CSP in `_headers`, so nothing blocks). Link `fonts.css` before `tokens.css` in BOTH
  html heads. Do not touch the `--font-*` tokens: they already name these families.
- **GOTCHA**: `test/tokens.test.js` reads only `tokens.css`, so a separate file cannot upset it.
- **VALIDATE**: `ls -la public/fonts/ && npm test`
- **SATISFIES**: AC1

### UPDATE public/tokens.css (hairline + elevation tokens)

- **IMPLEMENT**: add `--border-hairline: #e3e3e3;` (decorative card edges and the top bar rule;
  comment: decorative only, never the sole boundary of a meaningful control — inputs keep
  `--border`) and `--shadow-card: 0 1px 1px #0000000a, 0 4px 6px #1d1d1d05, 0 20px 60px
  #1d1d1d0a, 0 2px 4px #0000000a;` (stackai Section 6 soft layered card shadow).
- **UPDATE** `test/tokens.test.js`: add a test asserting `--border-hairline` exists and that it
  is NOT in PAIRINGS territory — i.e. a comment-backed test that `--border` (the meaningful
  boundary token) still clears 3:1 is already present; new test just asserts the hairline token
  is declared, so an agency swap that deletes it fails loudly.
- **GOTCHA**: do NOT add the hairline to PAIRINGS: it is decorative and would fail the 3.0
  floor by design. The shadow token contains alpha hex — the parser only matches whole-value
  `#hex;` declarations, so a multi-part shadow value is invisible to it. Good.
- **VALIDATE**: `npm test`
- **SATISFIES**: AC2

### UPDATE both HTML heads (favicon + fonts link)

- **IMPLEMENT**: `<link rel="icon" href="/favicon.svg" type="image/svg+xml">` and the fonts.css
  link in `index.html` and `clients.html`. CREATE `public/favicon.svg`: minimal mark, a 9px-radius
  `#0099ff` rounded square with three near-black `#1d1d1d` horizontal bars (a dossier), no text.
- **VALIDATE**: `grep -c 'favicon\|fonts.css' public/index.html public/clients.html` (expect 2 each)
- **SATISFIES**: AC3

### ADD the shared top bar to both screens

- **IMPLEMENT**: in both HTML files, before `<main>`:
  `<header class="topbar"><span class="topbar-brand">Dossier engine</span><nav class="topbar-nav" aria-label="Screens"><a href="/" >Submission pack</a><a href="/clients">Client knowledge</a></nav></header>`
  with `aria-current="page"` on the active link (static per file — no JS). CSS in `app.css`:
  flex row, `max-width: var(--max-width)` inner alignment matching `main`, hairline bottom
  border, links `--font-ui` at `--text-body`, min 44px hit area via padding, inactive
  `--text-muted` hover to `--text-primary` (adds contrast), active `--text-primary` plus 2px
  `--accent` underline (word + weight + underline, never colour alone). Brand text muted,
  non-link.
- **GOTCHA**: `/clients` currently has NO route back to `/` at all — this is the fix. Keep the
  rail's "Write client notes" link on `/`; it deep-links with `?client=`.
- **VALIDATE**: re-run audit script; both screens show the bar; keyboard-tab order starts with it
- **SATISFIES**: AC4

### UPDATE app.css component pass (borders, elevation, buttons, file inputs)

- **IMPLEMENT**:
  - `.rail`, `.pack`: add `border: 1px solid var(--border-hairline)` and
    `box-shadow: var(--shadow-card)` — the two card surfaces gain stackai elevation; inputs and
    textareas keep `--border` (meaningful boundary, 3:1 floor).
  - `.btn` (secondary): add `border-color: var(--border); background: var(--background)` so
    "Start again" reads pressable (stackai ghost pattern); hover draws `--text-primary` border,
    matching the primary's grammar.
  - File inputs: style `::file-selector-button` as the ghost button (font-ui, --text-body,
    padding --space-2/--space-4, radius, `--border` border, background --background, min-height
    calc fits row); input text stays muted. Explicit `transition: border-color` only.
  - `.textarea::placeholder, .input::placeholder { color: var(--text-muted); }` (4.5:1 held).
  - `.textarea[readonly] { background: var(--surface); }` — the frozen state becomes visible
    (act 4's freeze currently looks editable).
- **GOTCHA**: keep `.btn[aria-disabled]` rules intact; keep the two-shadow focus rules intact
  (`.client-row[aria-current="true"]:focus-visible` restates both shadows — do not collapse it).
- **VALIDATE**: `npm test` then re-run audit script and eyeball 01/02
- **SATISFIES**: AC5

### UPDATE act headers to numbered chips + placeholders (guidance into the empty state)

- **IMPLEMENT**: in `index.html`, act heads become
  `<h2 class="act-head" id="inputs-head"><span class="act-num" aria-hidden="true">1</span>The inputs</h2>`
  (number is decorative now — chip carries it visually; heading text keeps meaning without it;
  same for acts 2 and 3, and drop the "1. " from the text). CSS `.act-num`: inline-flex 20px
  square (space-5 = 20px: add `--space-5: 20px` to the grid), radius --radius, background
  --surface, hairline border, --font-mono --text-caption, centred, margin-right --space-2.
  Add placeholders: brief "Paste the client's brief here, or open a file below." / CV "Paste the
  candidate's CV here, or open a file below." / reply "Paste the whole reply, including the JSON
  block."
- **GOTCHA**: probes select `#inputs-head`? They select by element ids that stay; verify with
  `grep -o 'act-head\|inputs-head' .claude/probes/one-screen.mjs`. The accessible name of each
  section changes ("1. The inputs" → "The inputs") — acceptable; aria-labelledby still resolves.
- **VALIDATE**: `node --test test/*.test.js` + audit script
- **SATISFIES**: AC6

### UPDATE public/app.js (scroll the arriving act into view; richer summary)

- **IMPLEMENT**:
  1. In `setPhase`, after the `showAct` calls: when `next` is `"waiting"` or `"pack"`, scroll the
     act into view — `var target = next === "waiting" ? el.actWaiting : el.actPack;`
     `target.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });`
     Never on `"inputs"` (load path).
  2. `renderPack`: build the provenance summary as two coloured spans via createElement +
     textContent (never markup strings): `N sourced` gets class `summary-sourced`
     (colour `--verified`, weight 600), `M unverified` gets `summary-unverified` (colour
     `--unverified`, weight 600) when M > 0, muted when 0. Keep the " · " separator as a text
     node. CSS: `.pack-summary { font-size: var(--text-body); }`.
- **GOTCHA**: `el.copyPack.focus()` already runs after `setPhase("pack")` — scrollIntoView must
  come from setPhase before that focus lands; focus then keeps the position (same element region).
  Do not touch the elapsed clock or the busy lifecycle.
- **VALIDATE**: `node .claude/probes/one-screen.mjs` with nvm node ≥22 (all probes still pass)
- **SATISFIES**: AC7

### UPDATE clients.html (scaffold visible while writing)

- **IMPLEMENT**: move the scaffold block from below the save row to between the note label and
  the textarea, as one muted caption line (keeps every word, drops the list chrome):
  `<p class="scaffold-line">Their process and stages · who sits on the panel · what each stage tests · why candidates were turned down</p>`
  CSS: --text-caption, --text-muted, margin-bottom --space-2. Reduce note rows 24 → 16.
- **GOTCHA**: the scaffold's own comment states its purpose is staying visible while writing;
  below a 24-row box it never was. This fulfils the stated intent — note it in the commit.
  `clients.js` never references `.scaffold*`, so no JS change.
- **VALIDATE**: `node .claude/probes/clients-screen.mjs` (probe asserts by ids; scaffold has none)
- **SATISFIES**: AC8

### UPDATE visible copy: remove em dashes (house humanizer rule, CHECKLIST MUST)

- **IMPLEMENT**: sweep user-visible strings only (HTML text + COPY objects):
  - `index.html` file labels: "Or open a file — PDF, Word, or text" → "Or open a file: PDF,
    Word, or text" (×2); act-note: "…in the other tab — paste it there (⌘V)." → "…in the other
    tab. Paste it there (⌘V)."
  - `app.js` COPY.fileUnreadable: "…that file — it is most likely…" → "…that file. It is most
    likely…"
  - grep for the remaining: `grep -n '—' public/index.html public/clients.html` and inspect
    every COPY string; comments are exempt (not user-visible).
- **VALIDATE**: `grep -n '—' public/*.html | grep -v '<!--'` returns nothing user-visible
- **SATISFIES**: AC9

### UPDATE mobile density (<860px)

- **IMPLEMENT**: in the existing pattern of the 860px media queries, add a max-width companion:
  rail padding `--space-3`, `.client-row` margin-bottom 0, body padding-top `--space-4` (topbar
  provides the top rhythm now). Confirm 360px: no horizontal scroll
  (`document.scrollingElement.scrollWidth <= 360` via the audit script at width 360).
- **VALIDATE**: audit script run at 360px added; assert scrollWidth
- **SATISFIES**: AC10

### Re-audit and gate

- **IMPLEMENT**: re-run the full validation levels below; re-run
  `audit-shots.mjs` (fresh port per dossier-design), read every screenshot, run the CHECKLIST.md
  self-audit per surface; fix what fails and re-shoot.
- **VALIDATE**: everything below
- **SATISFIES**: all

---

## TESTING STRATEGY

### Unit Tests

`npm test` (129+ tests across 10 files) must stay green untouched except `tokens.test.js`, which
gains the hairline-token assertion. No new unit surface: the changes are presentation.

### Integration Tests

The two browser probes are the behavioural gate: they drive the real flows over CDP and assert
async sequencing, clipboard, focus. Run both with nvm node ≥22. They must pass unmodified —
that is the proof the restyle changed no behaviour.

### Edge Cases

- Clipboard-refused path still shows the fallback textarea (probe covers it).
- readonly textareas (frozen act 1) remain selectable and now look frozen.
- Reduced motion: scrollIntoView uses `auto`; entrance opacity already gated.
- 120-char unbroken client name still clipped in rail, wrapped in editor head.
- Agency token swap: tokens test still gates every measured pairing.

## VALIDATION COMMANDS

### Level 1: Syntax & Style

```bash
grep -nE '#[0-9a-fA-F]{3,8}' public/app.css              # expect: no raw hex outside tokens.css
grep -n 'transition: all' public/*.css                    # expect: nothing
grep -n '—' public/index.html public/clients.html         # expect: comments only
```

### Level 2: Unit Tests

```bash
npm test
```

### Level 3: Integration Tests

```bash
export PATH="$HOME/.nvm/versions/node/v24.11.0/bin:$PATH"
node .claude/probes/one-screen.mjs
node .claude/probes/clients-screen.mjs
```

### Level 4: Manual Validation

```bash
node /private/tmp/claude-501/-Users-Berzins-Desktop-saulera-dossier-engine/22cd25c5-6c4c-496e-8a18-6bd4901553bb/scratchpad/audit-shots.mjs
# then Read every shot: type is Aspekta/Geist, cards have elevation, topbar on both screens,
# act chips render, frozen inputs grey, provenance summary coloured, 360px no h-scroll
```

Safari: not automatable here; the layout changes reuse the already-verified min-width:0 pattern
and add no new grid — flag the Safari eyeball as the one open manual step in the report.

### Level 5: Additional Validation

CHECKLIST.md self-audit, section by section, in the final report.

## ACCEPTANCE CRITERIA

- [ ] AC1: Aspekta 500 / Geist / DM Mono load as real files; no request leaves the origin
- [ ] AC2: hairline + shadow tokens exist; tokens gate extended and green
- [ ] AC3: favicon on both screens
- [ ] AC4: shared top bar on both screens; active state not colour-alone; 44px hit areas
- [ ] AC5: rail + pack carry card elevation; secondary buttons and file inputs read pressable;
      frozen inputs visibly frozen; placeholders present with 4.5:1
- [ ] AC6: acts numbered as chips; headings still labelled sections
- [ ] AC7: entering act 2/3 scrolls into view (reduced-motion honoured); provenance summary
      coloured word+number, body size
- [ ] AC8: note scaffold visible while writing; note rows 16
- [ ] AC9: zero em/en dashes in user-visible copy
- [ ] AC10: 360px renders with no horizontal scroll; rail compact
- [ ] All probes pass unmodified; npm test green; no raw hex/px added to app.css

## COMPLETION CHECKLIST

- [ ] All tasks completed in order, each validated immediately
- [ ] Full suite + both probes green
- [ ] Before/after screenshots read and criticised (two-pass rule)
- [ ] CHECKLIST.md pass written into the report
- [ ] Safari eyeball flagged as the open manual step

## OPEN QUESTIONS / ASSUMPTIONS

- Assumption: shipping engine-default fonts does not violate the per-agency branding split —
  the tokens stay overridable and the files are engine assets. tokens.css itself planned for
  this ("shipping them later is a one-file change").
- Assumption: "Dossier engine" as the topbar wordmark is acceptable engine-side text (the title
  tag already names it). An agency rename is a one-line HTML config edit.
- Assumption: TTF sizes are acceptable for a Pages deploy (checked at copy time; woff2 preferred
  where bundled).

## NOTES (open canvas)

Rejected alternatives: card-wrapping each act (fights the whitespace pacing the acts were built
on — dossier-design: rhythm from whitespace, not dividers); a step-progress header duplicating
the act numbers (decoration encoding nothing new); collapsible mobile rail (JS complexity against
Simplicity First for an unproven need); moving the model wait into a modal (act 2 must stay a
first-class designed state, architecture amendment).

Why the audit screenshots are trustworthy: they were produced by the same stub technique the
repo's own probes use, with realistic fixture data from `test/fixtures/pack-sourced.json`
extended with an unverified and a failed claim so all four mark states render.

## AMENDMENTS

- 2026-07-28 — The stackai-design skill's "bundled fonts" do not exist on disk (the skill is a
  single SKILL.md). Fonts were instead downloaded once from the sources the skill documents
  (Aspekta from Framer's CDN; Geist and DM Mono from Google's gstatic, both weights at v5) and
  committed under `public/fonts/` — 59KB total, all woff2, licences unchanged (MIT/OFL).
- 2026-07-28 — Scope additions from live user feedback during implementation, all shipped in
  this pass: (1) the `/clients` settings strip reworked for plain language ("Pack settings",
  per-control `.field-hint` lines, ATS spelled out, honest note that send_format does not change
  the pack yet); (2) client deletion — `deleteClient` in the store, `DELETE /api/clients/:id`,
  a named+priced confirm and a danger button in the editor, three new store tests (events go by
  the schema's existing ON DELETE CASCADE); (3) an explanation layer — rail hint explaining what
  notes are for, "No note yet" row meta, outcome-stating page subtitles; (4) a full plain-language
  copy pass under the humanizer/no-ai-slop skills ("Show the pack", "code block" not "JSON
  block", setup faults say "ask whoever set it up"; probe-pinned phrases kept verbatim); (5) a
  three-step journey map in the `/` page header using the act-chip grammar, so the flow is
  visible before it starts.
