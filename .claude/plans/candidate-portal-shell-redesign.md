# Feature: Candidate portal shell — shared styles, login, landing, privacy (#62)

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

## Feature Description

Ticket #62 brings the three **shell** pages of the candidate portal onto the design system #58
landed, and redesigns them phones-first:

- `public/prep/login.html` — the magic-link/OTP sign-in. A candidate's very first impression of
  the whole product, opened on a phone from an email.
- `public/prep/index.html` — the landing pad at `/prep/`. A junction that asks the server whether
  there is a session and redirects. It lives about 200ms and must paint instantly.
- `public/prep/privacy.html` — "your data on this portal". The reassurance page, and the longest
  read on the candidate side.

They are the three `/prep/*` pages that **do not link `public/prep/prep.css`** — `brief.html` and
`session.html` do (`brief.html:12`, `session.html:12-13`). Each shell page instead carries its own
page-scoped `<style>` block. That split is what makes the portal read as two half-systems, and it
is the thing this ticket closes.

Three things happen:

1. **`login.html` and `privacy.html` start linking `/prep/prep.css`**, so the whole portal is
   served by one stylesheet chain and `.prep-footer` stops being a thing only two of five pages
   have. `index.html` deliberately does not (see Solution Statement).
2. **All three pages are redesigned for a phone**: single column, 44px targets, a 16px input so
   iOS does not zoom on focus, buttons that fill the column under 600px, and a retention table
   that scrolls inside its own box rather than crushing to three unreadable columns.
3. **Two static gates are added** — one over the shell pages' contract with `login.js` and the
   redirect script, one closing the hole where a page-scoped `<style>` block can animate outside
   the reduced-motion guard.

No behaviour changes. `login.js` and the redirect script keep their logic; the ticket says
"restyle and restructure layout, do not re-litigate the flow" and PR #50's copy and flow
decisions are three days old.

## User Story

As **a candidate who has just been invited to an interview**
I want **the prep portal to open on my phone looking calm, legible and obviously legitimate**
So that **I trust it enough to sign in and use it, rather than closing the tab because it looks
like a form somebody half-built.**

Ticket-level, that lands on the implementer as: *as the agent implementing #63, I want the shell
pages already on `prep.css` with the portal's shared vocabulary in one place, so the content pages
extend a system rather than inventing a second one.*

## Problem Statement

`#58` repaletted `tokens.css` and restyled `app.css`, and the three shell pages inherited that for
free — they were never broken. Four specific problems remain, all of them #62's:

- **The portal is two half-systems.** `brief.html` and `session.html` link `prep.css` and end in a
  `.prep-footer`; `login.html`, `index.html` and `privacy.html` do not. `login.html` re-declares
  `.act + .act { margin-top: var(--space-12) }` in its inline block (`login.html:37`), which
  `app.css:585` already says verbatim — a fork of a shared rule, decided by link order rather than
  by anyone's intent.
- **The pages are laptop-shaped on a phone-first surface.** The two `.input` fields on
  `login.html` inherit `font-size: var(--text-body)` (14px, `app.css:242-245`). **iOS Safari zooms
  the viewport whenever a focused input is under 16px** — so the sign-in page's first interaction
  is the page jumping and the candidate scrolling back. The submit buttons sit at their natural
  width in a 52ch column. The privacy retention table is three prose columns inside a
  `overflow-x: auto` wrapper with no `min-width`, so at 360px it crushes rather than scrolls.
- **Two silent font bugs.** `privacy.html:35` and `prep.css:96` both ask for `font-weight: 500`.
  Geist ships 400 and 600 only, and CSS font-matching resolves a request between 400 and 500
  **downward** — so both render at regular weight while claiming to be medium. `fonts.css:15-18`
  documents this as "a silent bug rather than a rounding choice"; these are the last two.
- **A redesign of this markup is unguarded.** `login.js` reaches twelve elements by
  `getElementById` (`login.js:62-73`) and `index.html`'s script depends on one fetch path and two
  `location.replace` branches. Nothing asserts any of it. "Fully redesign the three shell pages"
  is exactly the change that drops `autocomplete="one-time-code"` or renames `#sent-note` and
  ships green.

## Solution Statement

**Link `prep.css` from `login.html` and `privacy.html`; keep a page-scoped `<style>` block on all
three.** The inline block holds only what is singular to that page — login's code field, privacy's
retention table, index's junction column. Everything with a second consumer moves to `prep.css`.
`index.html` stays on three stylesheets on purpose: it is a redirect junction that uses `.topbar`,
`.page-head` and `.page-sub` (all `app.css`) and nothing from `prep.css`, and a fourth blocking
stylesheet on the shortest-lived page in the product works against the ticket's "instant paint".

Keeping a `<style>` block on each page is also what keeps `test/chrome.test.js:38-43` honest with
no edit: its `INLINE_STYLE_PAGES` sweep asserts each listed page *has* a block, and the block is
where a raw hex would hide.

**Redesign each page around what it is for:**

- **login** — two acts, paced by whitespace, one signature element: the six-digit code field, mono
  and tracked, scaled up for a phone. The `?e=` notice becomes the palette's `--tint-info` panel,
  which is the decided "info" tint and currently has no consumer. The `.footnote` becomes the
  portal's shared `.prep-footer`, so every page in the portal ends the same way.
- **index** — a quiet junction. The heading stops shouting at `--text-h2` for 200ms, and a
  `<noscript>` gives a candidate with JavaScript off a link out instead of a page that says
  "Checking your sign-in…" forever.
- **privacy** — the retention table keeps its table semantics and takes `.counts-table`'s
  treatment from `app.css:975-989` (hairline under the head, no rule between rows), with a
  `min-width` in `rem` so it scrolls inside `.table-scroll` on a phone rather than crushing. A
  `.prep-footer` gives the page a way back to the prep, which it does not have today.

**Add two gates**, in the house idiom (#58 added `chrome.test.js` for exactly this class of
failure):

- `test/prep-shell.test.js` — the contract between the three pages' markup and the two scripts
  that drive them: every element `login.js` looks up resolves to an `id` in `login.html` (through
  the `$()` helper, **not** through a literal `getElementById` — see Task 9's gotcha); the phone
  input attributes survive; the live regions survive; the scripts are still loaded; `index.html`
  still fetches `/prep/auth/session` and fails closed to `/prep/login` on both branches; all three
  keep `<meta name="robots">`.
- An extra assertion in `test/chrome.test.js` — run the same brace-counting guard-strip it already
  runs over `app.css` (`chrome.test.js:45-71`) across the four page-scoped `<style>` blocks, so
  motion added to an inline block is a failure. That hole is real today and epic AC #6 depends on
  it not being.

## Out of Scope / Non-Goals

- **Not included: any token value change.** `tokens.css` is #58's file, #59 runs in a parallel
  worktree and owns the type ramp, and #58's plan explicitly deferred a bigger display step.
  zig.ai's "big type" is the cue that will tempt an implementer into `--text-h1`. **Touch no token
  values in this ticket.** One comment-only edit is authorised (Task 8) and nothing else. If a
  value is genuinely missing, it goes in Open Questions, not into `tokens.css`.
- **Not included: `public/prep/brief.html`, `session.html`, `brief.js`, `session.js`,
  `session.css`, `registry.js`.** Those are #63. The one exception is the `font-weight: 500` fix
  in `prep.css:96`, which is this ticket's file and visibly affects #63's pages — see the GOTCHA on
  Task 3.
- **Not included: any change to the sign-in flow, the OTP contract, the session check, or the
  redirect targets.** PR #50 decided those three days ago. `login.js`'s handlers, the `?e=` key
  table, the 202/401/410/429/503 mapping and `index.html`'s two `location.replace` branches are
  behaviour, and behaviour is frozen.
- **Not included: rewording `COPY.sent` or `COPY.notConfigured` in `login.js`.** Both are
  load-bearing rather than draft copy: `sent` is deliberately non-committal because saying "no
  invite for that address" would undo the enumeration guard in `functions/prep/auth/otp.js` from
  the client side (`login.js:17-22`), and `notConfigured` exists so a missing D1 binding does not
  blame the candidate's code (`login.js:53-57`). Tone work is welcome on every other visible
  string.
- **Not included: a slow/timeout state on `index.html`.** The fetch has no timeout today; adding
  one is new behaviour, and this ticket restyles. The `<noscript>` fallback IS in scope because it
  is markup with no flow of its own. See NOTES.
- **Not included: `public/404.html`**, the three recruiter screens, `app.css`, or anything under
  `functions/` or `src/`. No generation, storage or API surface is involved (epic non-goal #1).
- **Not changing: `login.js`'s or `index.html`'s script logic.** Class hooks may move; **ids may
  not**, and neither may the two `data-tone` values the state lines are styled by.

## Feature Metadata

**Feature Type**: Enhancement (a redesign of existing surfaces; no behaviour changes)
**Estimated Complexity**: Medium — no algorithmic risk, but the markup being redesigned is the
contract two scripts depend on, and the phones-first ACs have no automated path.
**Primary Systems Affected**: `public/prep/login.html`, `public/prep/index.html`,
`public/prep/privacy.html`, `public/prep/prep.css`, `test/prep-shell.test.js` (new),
`test/chrome.test.js`
**Dependencies**: None new. No build step, no framework, no package, no CDN request (epic AC #5).

## Related Work

**Implements**: [#62](https://github.com/linardsb/saulera-dossier-engine/issues/62)   ·
**Epic**: [#57](https://github.com/linardsb/saulera-dossier-engine/issues/57) — the "Decided
palette" and "Decided typography" tables in the epic body are the source of truth. There is no
separate `engineering-plan.md`; the epic issue *is* the architecture record.

**Back-references** (plans this builds on or inherits decisions from):

- `.claude/plans/redesign-foundation-tokens-fonts-chrome.md` — Why: #58, the ticket this one
  depends on. It decided the palette, `--accent-strong` vs `--accent`, the one-sans stack, the
  600-not-500 rule, and inverted motion to opt-in. All inherited, none reopened.
- `.claude/plans/candidate-auth-magic-link-otp.md` — Why: #20 built `login.html` and `login.js`.
  Its four numbered decisions (nothing in browser storage, `?e=` never reflected into the DOM,
  act 1 says the same thing either way, a failed verify keeps the code on screen) are the
  behaviour this redesign must not disturb.
- `.claude/plans/prep-component-registry-and-brief-dashboard.md` — Why: #21 created `prep.css` and
  its "supplements app.css, never restates it" contract, plus the `.prep-footer` and `.block`
  grammar the shell pages are joining.
- `.claude/plans/portal-schema-retention-gdpr.md` — Why: #17 wrote `privacy.html`'s retention
  table and the 30-day rule the copy states. The facts in that table are load-bearing.

**Forward-references** (plans that extend or supersede this — append as follow-ups get created):

- #63 (candidate portal content pages: brief and session) — depends on this ticket; inherits
  `prep.css` as edited here, including the `.btn-block` utility and the 600-weight fix.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `public/prep/login.html` (all 154 lines) — Why: the page being redesigned. Lines 12-85 are the
  inline block; 46-55 is the `.code-input` signature element; 87-154 is the markup contract with
  `login.js`.
- `public/prep/index.html` (all 68 lines) — Why: the junction. Lines 19-29 are the comment that
  states what must survive any rewrite; 43-66 is the script, which is frozen.
- `public/prep/privacy.html` (all 139 lines) — Why: the reassurance page. Lines 12-37 are the
  inline block (the `500` is at 35, the raw `1px` at 29); 76-101 is the retention table.
- `public/prep/login.js` (lines 1-110) — Why: the four numbered decisions in the header are the
  behaviour contract, and lines 62-73 are the twelve ids the markup must keep supplying.
- `public/prep/prep.css` (all 238 lines) — Why: the file being extended. Header 1-18 states the
  "supplements app.css, never restates it" contract; `.prep-footer` at 221-226 is what the shell
  pages are adopting; the `500` to fix is at 96; the narrow-screen block is 234-238.
- `public/prep/brief.html` (all 52 lines) — Why: the page-shape pattern to mirror. Stylesheet link
  order at 9-12, topbar at 18-22, `.prep-footer` at 43-45.
- `public/app.css` — Why: everything the shell pages inherit and must not restate.
  `:focus-visible` 74-83 (the one focus rule for the whole deployment) · `.topbar` 89-109 ·
  `.btn` 154-222 (including the `aria-disabled` styling `login.js` depends on) · `.field` /
  `.input` 226-257 · `.page-head` / `.page-sub` 266-267 · `.act + .act` **585** (the rule
  `login.html:37` duplicates) · `.save-state` 410-417 (**read the GOTCHA on Task 5**) ·
  `.counts-table` 953-1001 (the table treatment privacy's is mirroring) · the motion block
  1036-1051.
- `public/tokens.css` — Why: the token set, and the contrast numbers already measured. Read the
  `--tint-info` comment at 68-79 before styling the notice: **`--text-muted` is 3.75:1 on
  `--tint-info` and under the floor**; `--text-primary` is 8.21:1 and is what a chip or panel on
  that tint must carry. `--hairline` is at 55, `--tap-target` at 141, `--text-note` at 106.
- `test/chrome.test.js` (all 129 lines) — Why: the gate being extended. `INLINE_STYLE_PAGES` at
  38-43 lists the four pages; the brace-counting guard-strip at 49-64 is the loop Task 12 reuses.
- `test/prep-registry.test.js` (lines 758-830) — Why: the three gates over `prep.css`. **A raw
  `\d+px` anywhere in a declaration fails** (765-772); `:focus` in any form fails (773-777); any
  animation outside the `no-preference` guard fails (778-797); **any selector `app.css` already
  owns fails** (799-818).
- `public/fonts.css` (lines 14-18) — Why: the 500-is-a-silent-bug rule, in the file that owns it.
- `.claude/skills/dossier-design/references/CRAFT.md` and `CHECKLIST.md` — Why: the numeric craft
  rules and the pre-commit correctness gate. Both are short; read both.

### New Files to Create

- `test/prep-shell.test.js` — the static gate over the three shell pages' contract with `login.js`
  and the redirect script.

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [MDN: CSS font matching algorithm](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_fonts/Fundamental_text_and_font_styling#font_weight)
  - Specific section: font-weight matching
  - Why: the reason `font-weight: 500` renders at 400 with a 400/600 family, which is Task 3.
- [WebKit: `text-size-adjust` and the 16px input zoom](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/Introduction/Introduction.html)
  - Specific behaviour: iOS Safari zooms the viewport when a focused form control's computed
    `font-size` is below 16px, on a page with `width=device-width` and no `maximum-scale`
  - Why: Task 6. Raising the field to `var(--text-note)` (16px) is the fix; adding
    `maximum-scale=1` to the viewport meta is **not** — it disables pinch zoom and fails
    WCAG 1.4.4.
- [MDN: `autocomplete="one-time-code"`](https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes/autocomplete#one-time-code)
  - Why: this attribute plus `inputmode="numeric"` is what makes a phone offer the code straight
    from the notification. Losing it in a markup rewrite breaks the phone path silently — which is
    why Task 10 asserts it.
- [MDN: `<table>` and `display` — the accessibility consequence](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/table#accessibility)
  - Why: the reason the retention table is NOT restacked with `display: block` at 360px. See NOTES.
- Epic [#57](https://github.com/linardsb/saulera-dossier-engine/issues/57) — the decided palette
  and typography tables. Inherited, not re-decided.

### Patterns to Follow

**Stylesheet link order (the whole chain, in this order):** `brief.html:9-12`

```html
<link rel="stylesheet" href="/fonts.css">
<link rel="stylesheet" href="/tokens.css">
<link rel="stylesheet" href="/app.css">
<link rel="stylesheet" href="/prep/prep.css">
```

The page-scoped `<style>` block comes after all four, so it wins by order rather than by
specificity. `index.html` keeps the first three only.

**`prep.css` supplements, never restates:** `prep.css:1-18`. Every rule added there must use a
selector `app.css` does not own — `test/prep-registry.test.js:799-818` compares the two selector
sets and fails on any overlap. Compound selectors (`.signin .input`) and new class names
(`.btn-block`) are both safe; a bare `.btn` or `.act + .act` is not.

**Token discipline in `prep.css`:** no raw hex, no raw `\d+px` inside a declaration
(`prep-registry.test.js:765-772`). Media-query preludes are exempt, which is why the existing
`@media (max-width: 600px)` at `prep.css:234` is legal.

**The narrow-screen block:** `prep.css:234-238` already exists at `max-width: 600px`, matching
`app.css:842`'s claim-stacking breakpoint. Add to it rather than opening a second query.

**Card grammar for a panel:** `prep.css:53-60` (`.block`) — background, `var(--hairline) solid`,
`var(--radius)`, `var(--shadow-card)`. The login notice takes the same grammar on the info tint.

**Table treatment:** `app.css:975-989` (`.counts-table`) — `text-align: left`, `font-weight: 600`
on the head, one `var(--border)` hairline under `thead`, `--border-hairline` between body rows,
padding on the 4px grid. The retention table mirrors it so the two tables in the deployment read
as one system.

**Uppercase micro-label:** `prep.css:133-141` (`.prep-label`) — `--font-ui`, `--text-caption`,
`letter-spacing: 0.08em`, `text-transform: uppercase`, `--text-muted`.

**A state line the script writes:** `login.html:61-68` + `login.js:76-80`. `textContent` only,
never markup; the tone is a `data-tone` attribute, not a class. **Keep both.**

**Test file shape:** `test/chrome.test.js:21-33` — `node:test`, `node:assert/strict`,
`readFileSync`, a `root` resolved from `import.meta.url`, a `read()` helper, zero dependencies.
`test/prep-shell.test.js` copies that preamble exactly.

---

## IMPLEMENTATION PLAN

### Phase 1: Foundation — the shared stylesheet

Get `prep.css` correct and linked before any page is redesigned against it, so the three pages are
edited once rather than twice.

**Tasks:**

- Fix the two `font-weight: 500` bugs.
- Add the one genuinely shared rule the shell pages need — `.btn-block` — to `prep.css`.
- Link `prep.css` from `login.html` and `privacy.html`.

### Phase 2: The three pages

**Depends on:** Phase 1 (each page is redesigned against the shared file's final shape).

The three pages are **independent of each other** — nothing one does constrains another, so they
can be done in any order, or in parallel if the loop is split.

**Tasks:**

- Redesign `login.html` — the two acts, the code field, the notice, the footer, the 16px fix.
- Redesign `index.html` — the quiet junction and the `<noscript>` fallback.
- Redesign `privacy.html` — the section rhythm, the retention table, the footer.

### Phase 3: The gates

**Depends on:** Phase 2 (the assertions describe the markup that now exists).
**Independent of:** nothing — this is the last phase.

**Tasks:**

- Create `test/prep-shell.test.js`.
- Extend `test/chrome.test.js` with the inline-block motion guard.
- Verify every new assertion fails when violated (the house standard set by #58).

### Phase 4: Manual validation

**Depends on:** Phase 3.

AC #4 ("comfortable at 360px, no horizontal scroll") and the contrast/tone criteria have **no
automated path** — `node --test` has no DOM and #58 forbade adding tooling to get one. Phase 4 is
where they are actually checked, in real Safari and real Chrome.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently
testable.

**Before task 1, set the Node version for the whole session.** The repo requires `>=22.5`
(`package.json` engines) and `test/node-version.test.js` fails loudly under anything lower. The
shell default here is v20.20.2, under which the suite reports **1 fail and 152 skips**. Under
v24.11.0 the baseline is **802 pass, 0 fail, 0 skipped**. Every `VALIDATE` below assumes:

```bash
export PATH="$HOME/.nvm/versions/node/v24.11.0/bin:$PATH" && node --version   # must print v24.x
```

### Task 1 · UPDATE `public/prep/prep.css` — fix the two silent 500 weights

- **IMPLEMENT**: change `font-weight: 500` at `prep.css:96` (`.block-head`) to `600`. Extend the
  rule's existing comment with one line: Geist ships 400 and 600, and a 500 request resolves
  downward, so this rendered at regular weight while claiming to be medium.
- **PATTERN**: `app.css:31-35` — the same fix, with the reasoning already written out.
- **IMPORTS**: none.
- **GOTCHA**: this is the one edit in the ticket that **visibly changes #63's pages** — every
  `.block-head` on `brief.html` and `session.html` gets heavier. That is the correct rendering of
  what the file already asks for, not a redesign of those pages. Say so in the PR body so it does
  not read as scope creep.
- **VALIDATE**: `export PATH="$HOME/.nvm/versions/node/v24.11.0/bin:$PATH" && grep -rn "font-weight: *500" public/prep/prep.css | wc -l | grep -qx 0 && node --test test/prep-registry.test.js`
- **SATISFIES**: AC #1 (one token set, honoured rather than merely referenced).

### Task 2 · UPDATE `public/prep/prep.css` — add the one shared shell rule

- **IMPLEMENT**: one addition, with a comment in the file's voice explaining why it exists:
  `.btn-block { width: 100% }` **inside the existing `@media (max-width: 600px)` block at
  `prep.css:234-238`**. A full-width action under 600px is the phones-first target; at desktop
  width a 52ch-wide button reads as a mistake, which is why it is not unconditional. It goes in
  the shared file rather than in login's block because #63's pages plausibly want it — the brief's
  "Practise for it" call to action is the same kind of control on the same kind of screen.
- **PATTERN**: the narrow-screen block at `prep.css:234-238` for where the utility goes.
- **DECIDED, do not relitigate**: the login notice panel (`.notice`) stays in
  **`login.html`'s inline block**, not here. It has exactly one consumer — privacy does not need
  it and index does not link `prep.css` — and `prep.css:14-17` says a rule that exists to style
  one block is how this file starts becoming a second `app.css`. `background: var(--tint-info)`
  is a token reference, so it clears `chrome.test.js`'s inline-hex gate without trouble.
  It is specified in Task 5.
- **IMPORTS**: none.
- **GOTCHA**: three gates in `test/prep-registry.test.js` fire on this file. **No raw hex. No
  `\d+px` inside a declaration** — `width: 100%` is fine, `padding: 16px` is not. **No selector
  `app.css` already owns** — `.btn-block` is new, and never a bare `.btn`.
- **VALIDATE**: `export PATH="$HOME/.nvm/versions/node/v24.11.0/bin:$PATH" && node --test test/prep-registry.test.js`
- **SATISFIES**: AC #1, AC #2.

### Task 3 · UPDATE `public/prep/login.html` + `public/prep/privacy.html` — link `prep.css`

- **IMPLEMENT**: add `<link rel="stylesheet" href="/prep/prep.css">` after the `app.css` link on
  both pages, keeping the page's own `<style>` block last.
- **PATTERN**: `brief.html:9-12` — the exact four-link order.
- **IMPORTS**: none.
- **GOTCHA**: do **not** add it to `index.html`. That page uses nothing from `prep.css` and a
  fourth blocking stylesheet on a 200ms redirect junction is the opposite of the ticket's
  "instant paint".
- **VALIDATE**: `grep -L 'prep/prep.css' public/prep/*.html` → must print `public/prep/index.html`
  and nothing else. (`grep -c` on a file with zero matches exits 1 and reads as a failed
  validation, which is why this is the `-L` form.)
- **SATISFIES**: AC #1.

### Task 4 · UPDATE `public/prep/login.html` — the markup

- **IMPLEMENT**: redesign the body, phones-first, keeping every id and every input attribute:
  - Keep `<header class="topbar">` with the portal name, unchanged (`login.html:89-95`).
  - Keep the `.page-head` shape: `<h1>` plus `.page-sub`. Copy stays calm and human; the current
    "Sign in to your prep" / "Your prep is private to you. Signing in keeps it that way." already
    is, so change it only if you can do better in the same register.
  - Keep `<div class="notice" id="notice">` and its `<p id="notice-text">` as they are. The class
    name stays (nothing else in the deployment owns `.notice`); only its rule changes, in Task 5.
    **`id="notice"` and `id="notice-text"` are both reached by `login.js:62-63, 105-109`.**
  - Keep both `<section class="act">` elements, both `.sr-only` headings, both
    `aria-labelledby` links, and `hidden` on `#act-code`.
  - Add `class="btn btn-primary btn-block"` to `#send` and `#verify`.
  - Keep both state lines exactly as they are: `<p class="state" id="email-state" role="status"
    aria-live="polite">` and the `#code-state` twin.
  - Replace the `<p class="footnote">` with `<footer class="prep-footer"><p>…</p></footer>`
    **outside `<main>`**, mirroring `brief.html:43-45`. Keep the copy ("Not sure why you are here?
    Read what we hold about you and how to delete it") and the `/prep/privacy` href.
- **PATTERN**: `brief.html:16-45` for the page shape; `login.html:110-143` for the act structure
  that is being kept.
- **IMPORTS**: none.
- **GOTCHA (the one most likely to ship broken)**: **do not rename `.state` to `.save-state`** in
  the name of system consistency. `app.css:410-416` gives `.save-state { opacity: 0 }` and only
  `.is-shown` reveals it; `login.js:76-80` sets `textContent` and `data-tone` and nothing else. The
  swap makes **every sign-in error message silently invisible** and no test would catch it before
  Task 10 exists.
- **GOTCHA**: `autocomplete="one-time-code"`, `inputmode="numeric"` and `maxlength="7"` on `#code`,
  and `type="email"` / `inputmode="email"` / `autocomplete="email"` / `spellcheck="false"` on
  `#email`, **are the phones-first requirement**. `maxlength="7"` is deliberate: it lets a pasted
  `123 456` survive long enough for `login.js:162` to strip it.
- **VALIDATE**: `export PATH="$HOME/.nvm/versions/node/v24.11.0/bin:$PATH" && node -e 'const h=require("fs").readFileSync("public/prep/login.html","utf8"); for (const id of ["notice","notice-text","act-code","sent-note","form-email","form-code","email","code","send","verify","email-state","code-state"]) if (!h.includes(`id="${id}"`)) throw new Error("lost id: "+id); console.log("all 12 ids present")'`
- **SATISFIES**: ticket AC #2 (the phone attributes and the block buttons), AC #4 (tone), epic
  AC #3 (both live regions and both `aria-labelledby` links survive).

### Task 5 · UPDATE `public/prep/login.html` — the page-scoped `<style>` block

- **IMPLEMENT**: rewrite the inline block to hold only what is singular to this page:
  - `.signin { max-width: 52ch; }` and the `--text-note` prose size (kept).
  - **`.signin .input { font-size: var(--text-note); }`** — the iOS zoom fix. A compound selector,
    so it is legal in an inline block and would also be legal in `prep.css`; it lives here because
    login is the only portal page with a `class="input"` field.
  - `.sr-only` — **kept here, not moved to `prep.css`**, because its `1px` / `-1px` values would
    fail `prep-registry.test.js`'s raw-px gate. Inline blocks have no px gate.
  - `.code-input` — the signature element. Keep the mono family, the `0.4em` tracking, the `ch`
    width and the centring (`login.html:46-55`); this is where the page's boldness is spent, so
    scale it up for a phone rather than inventing a second bold thing.
  - `.act-lede`, `.actions` — kept.
  - `.notice` — **restyled onto the info tint**, and it stays in this block (Task 2's DECIDED
    note). `background: var(--tint-info)`, `color: var(--text-primary)`,
    `border-radius: var(--radius)`, `padding: var(--space-4)`, `margin: 0 0 var(--space-8)`.
    **No border**: `--border` is 2.53:1 on `--tint-info` and would be a boundary under the 3:1
    non-text floor, and the panel carries a full sentence so it needs no edge to be found.
    **Never `--text-muted` on this tint** — 3.75:1, under the body-text floor (`tokens.css:68-79`).
  - `.notice p { margin: 0 }` — kept.
  - `.state` + `.state[data-tone="error"]` — kept verbatim, including `min-height`, which is what
    stops the layout jumping when a message arrives.
  - **DELETE `.act + .act`** (`login.html:37`). `app.css:585` already says it verbatim, and a rule
    stated in two files is decided by link order rather than by intent.
  - **KEEP `.act[hidden] { display: none }`** (`login.html:38`). It is a no-op today —
    `app.css:590-592` gives `.act` an `opacity` and never a `display`, so the user agent's
    `[hidden]` is unopposed — but it is the same defensive guard `prep.css:217` and `app.css:461`
    both carry, and both of those exist because the bug shipped once. House style keeps it.
  - **DELETE `.footnote`** — replaced by `prep.css`'s `.prep-footer`.
- **PATTERN**: `login.html:12-85` — the block being rewritten, comments and all. Keep the comment
  density; this repo explains why a rule exists, not what it does.
- **IMPORTS**: none.
- **GOTCHA**: if the redesign makes `.act` a flex or grid container, `.act[hidden]` stops being a
  no-op and becomes load-bearing — an author `display` beats the user agent's `[hidden]` at any
  specificity, which `prep.css:213-217` and `app.css:457-461` both record as a bug already shipped
  once. Act 2 is `hidden` until a code is asked for, so getting this wrong shows both acts at
  once.
- **GOTCHA**: no raw hex in this block — `test/chrome.test.js:85-99` fails on one.
- **VALIDATE**: `export PATH="$HOME/.nvm/versions/node/v24.11.0/bin:$PATH" && node --test test/chrome.test.js`
- **SATISFIES**: AC #1, AC #2 (the 16px fix and the 52ch column), AC #3.

### Task 6 · UPDATE `public/prep/index.html` — the quiet junction

- **IMPLEMENT**:
  - Keep the `<script>` at `index.html:43-66` **byte-identical**, including both
    `window.location.replace` branches, the `.catch` that fails closed, and the comment block at
    19-29 that says why.
  - Restyle the head so a 200ms page does not shout: keep the `<h1>` (a page needs one) but let
    the inline block bring it to `--text-h3` and `--text-muted`, so the junction reads as a
    breath rather than a destination.
  - Add a `<noscript>` inside `<main>`: one sentence and a link to `/prep/login`. Without it, a
    candidate with JavaScript off sits on "Checking your sign-in…" forever.
  - Copy: the current "Checking your sign-in… / One moment." is fine in register. If you change
    it, keep it under six words and in the same voice.
- **PATTERN**: `brief.html:26-35` for the `.page-head` shape.
- **IMPORTS**: none.
- **GOTCHA**: this page must **not** link `prep.css` (Task 3's gotcha), and must keep
  `<meta name="robots" content="noindex, nofollow">` and its `<style>` block — `chrome.test.js:40`
  asserts the block exists.
- **GOTCHA**: no timeout, no retry, no progress indicator. Adding one is new behaviour and this
  ticket restyles. See NOTES.
- **VALIDATE**: `export PATH="$HOME/.nvm/versions/node/v24.11.0/bin:$PATH" && node --test test/chrome.test.js && grep -c 'location.replace("/prep/login")' public/prep/index.html` → expect `2`
- **SATISFIES**: AC #2, AC #4, epic AC #3 (the `<noscript>` path).

### Task 7 · UPDATE `public/prep/privacy.html` — the page

- **IMPLEMENT**:
  - Keep every `<section aria-labelledby>` and every `<h2 id>` — the seven sections and their ids
    are the page's landmark structure.
  - **Do not change a single retention fact.** The three rows, the 30-day rule, the named
    processors, the lawful basis and the ICO link are all from #17 and are legally load-bearing.
    Tone work here is spacing and hierarchy, not rewriting what the page promises.
  - Restyle the section rhythm so seven blocks of prose read as seven places rather than one
    scroll: the step between sections must be visibly larger than the spacing inside them
    (CRAFT's rule), built from whitespace and not from rules.
  - Retention table: keep `<table>`, `<thead>`, `<th scope="col">` exactly as they are. In the
    inline block, mirror `app.css:975-989` — left-aligned, `font-weight: 600` on the head (**not
    500**, Task 1's rule), one `var(--border)` hairline under `thead`, `var(--border-hairline)`
    between body rows, `var(--hairline)` for the width rather than a raw `1px`. Add
    `min-width: 34rem` to `.retention` so it scrolls inside `.table-scroll` at 360px rather than
    crushing to three unreadable columns.
  - Add `<footer class="prep-footer">` outside `<main>` with a link back to `/prep/` — the page is
    a dead end today.
- **PATTERN**: `app.css:953-1001` (`.counts` / `.counts-table`) for the table; `brief.html:43-45`
  for the footer.
- **IMPORTS**: none.
- **GOTCHA**: the `<table>` keeps table semantics at every width. Do **not** restack it with
  `display: block` at 360px — that strips the table's implicit ARIA roles and a screen-reader user
  loses the row/column association, which fails epic AC #3 ("at least as good as today"). The
  internal scroller is the honest answer and is the pattern `.counts` already uses. Reasoning is
  in NOTES.
- **GOTCHA**: no raw hex in the block, and fix the raw `1px` at line 29 while you are in there.
- **VALIDATE**: `export PATH="$HOME/.nvm/versions/node/v24.11.0/bin:$PATH" && node --test test/chrome.test.js && grep -c 'font-weight: *500' public/prep/privacy.html` → expect `0`
- **SATISFIES**: AC #1, AC #2 (the scrolling table), epic AC #3 (table semantics kept).

### Task 8 · UPDATE `public/tokens.css` — one comment, no values

- **IMPLEMENT**: `tokens.css:77-79` says `--tint-info` "has NO consumer yet … the first consumer is
  #60". `login.html`'s `.notice` panel is now the first consumer. Update that sentence to name it
  and to record
  that the panel carries `--text-primary` (8.21:1) rather than `--text-muted` (3.75:1, under the
  floor), and no border (`--border` is 2.53:1 on the tint).
- **PATTERN**: the file's existing voice — every token comment carries its measured ratios.
- **IMPORTS**: none.
- **GOTCHA**: **comment only.** Not one token value moves in this ticket. `tokens.test.js` measures
  values, so a green suite is necessary but not sufficient — check the diff is comment-only.
- **VALIDATE**: `export PATH="$HOME/.nvm/versions/node/v24.11.0/bin:$PATH" && node --test test/tokens.test.js && git diff --stat public/tokens.css`
- **SATISFIES**: AC #1.

### Task 9 · CREATE `test/prep-shell.test.js` — the markup contract

- **IMPLEMENT**: a zero-dependency static gate over the three shell pages. Assert, at minimum:
  1. **Every element `login.js` looks up resolves to an `id="…"` in `login.html`.** Parse the ids
     out of the script rather than hard-coding the list, so the gate follows the script if it
     grows. **The lookups do not go through `getElementById` directly** — `login.js:60` defines
     `var $ = function (id) { return document.getElementById(id); }` and all twelve call sites
     (`login.js:62-73`) are `$("notice")`, `$("act-code")` and so on. So the pattern to match is
     the helper call, `/\$\(\s*["']([^"']+)["']\s*\)/g`, and the single literal
     `getElementById(id)` in the helper itself takes a **variable** and must be ignored.
     **Assert the parsed set is non-empty first** (`assert.ok(ids.length >= 12, …)`), in the idiom
     of `prep-registry.test.js:816` and `chrome.test.js:104`, so that a later refactor of `$`
     cannot silently disarm the gate.
  2. `#code` carries `autocomplete="one-time-code"`, `inputmode="numeric"` and `maxlength="7"`;
     `#email` carries `type="email"`, `inputmode="email"` and `autocomplete="email"`.
  3. Both state lines keep `role="status"` and `aria-live="polite"`; `#act-code` and `#notice`
     keep the `hidden` attribute in the source.
  4. `login.html`'s inline block still styles `[data-tone="error"]` — the tone contract
     `login.js:78` writes to.
  5. `index.html` still fetches `/prep/auth/session` and still contains **two**
     `location.replace("/prep/login")` calls (the `!body.ok` branch and the `.catch`) plus the one
     to `/prep/brief`.
  6. All three pages carry `<meta name="robots" content="noindex, nofollow">` and
     `<meta name="viewport" content="width=device-width, initial-scale=1">` with **no
     `maximum-scale` and no `user-scalable=no`** (WCAG 1.4.4).
  7. `login.html` and `privacy.html` link all four stylesheets in order; `index.html` links the
     first three and not `prep.css`.
  8. **The scripts are still loaded at all.** Every id can survive a rewrite that drops
     `<script src="/prep/login.js"></script>` — the page goes inert and assertions 1-7 all pass.
     Assert `login.html` references `/prep/login.js`, and that `index.html` still contains its
     inline `fetch("/prep/auth/session")`.
- **PATTERN**: `test/chrome.test.js:21-43` for the preamble and the swept-list idiom;
  `test/prep-registry.test.js:820-830` for the "read every file in `public/prep`" loop.
- **IMPORTS**: `node:test`, `node:assert/strict`, `readFileSync` from `node:fs`,
  `join`/`dirname` from `node:path`, `fileURLToPath` from `node:url`.
- **GOTCHA**: write the header comment in the house style — **what class of failure this file
  catches, and why it ships green without it**. `chrome.test.js:1-19` is the model. A test file in
  this repo that only says what it asserts is under-written.
- **GOTCHA**: do not write assertion 1 against `getElementById("…")`. There is exactly one
  `getElementById` call in `login.js` and its argument is a variable, so that regex matches once,
  extracts nothing, and the test loops over an empty set — **green, and checking nothing**. It is
  the gate the whole "fully redesign the markup" instruction rests on, so the non-empty assertion
  is not optional.
- **VALIDATE**: `export PATH="$HOME/.nvm/versions/node/v24.11.0/bin:$PATH" && node --test test/prep-shell.test.js`
- **SATISFIES**: AC #2 (the phone attributes), epic AC #3, and the "keep their hooks stable"
  instruction in the ticket's per-ticket context.

### Task 10 · UPDATE `test/chrome.test.js` — close the inline-motion hole

- **IMPLEMENT**: add one test that runs the brace-counting `prefers-reduced-motion: no-preference`
  strip (`chrome.test.js:49-64`, already written) over each page-scoped `<style>` block in
  `INLINE_STYLE_PAGES`, then asserts no `transition`, `animation` or `@keyframes` survives.
  Extract the strip into a small helper so the existing `app.css` test and the new one share it
  rather than duplicating the loop a third time.
- **PATTERN**: `chrome.test.js:45-71` (the loop) and `85-99` (the per-page inline-block sweep) —
  this test is the two of them crossed.
- **IMPORTS**: none new.
- **GOTCHA**: `prep-registry.test.js:778-797` runs the same loop over `prep.css`. Three copies of
  a brace counter in the repo is two too many, but do **not** refactor `prep-registry.test.js` in
  this ticket — it is a #63-adjacent file and the duplication is pre-existing. Extract within
  `chrome.test.js` only.
- **VALIDATE**: `export PATH="$HOME/.nvm/versions/node/v24.11.0/bin:$PATH" && node --test test/chrome.test.js`
- **SATISFIES**: epic AC #6.

### Task 11 · VERIFY every new assertion fails when violated

- **IMPLEMENT**: for each new assertion in Tasks 9 and 10, break the thing it guards, run the file,
  confirm it fails with a message that names the problem, then revert. At minimum: rename one id in
  `login.html`; drop `autocomplete="one-time-code"`; delete one `location.replace("/prep/login")`;
  add `transition: opacity 200ms` to `privacy.html`'s inline block outside any guard.
- **PATTERN**: #58's commit message records this as the house standard ("every new assertion was
  verified to fail when violated").
- **IMPORTS**: none.
- **GOTCHA**: `git diff` must be clean of these probes before Task 12. Check.
- **VALIDATE**: `export PATH="$HOME/.nvm/versions/node/v24.11.0/bin:$PATH" && git status --porcelain && node --test test/*.test.js 2>&1 | tail -8`
- **SATISFIES**: the completion checklist's "each task validation passed immediately".

### Task 12 · UPDATE `README.md` — record the decision

- **IMPLEMENT**: one entry at the top of the Decisions section, in the file's existing voice: the
  portal shell now links `prep.css`, `--tint-info` has its first consumer, the 16px input rule and
  why it is not a viewport-meta fix, and the retention table's scroll-not-restack call.
- **PATTERN**: `README.md:99-115` — the #58 entry, which is the shape and length to match.
- **IMPORTS**: none.
- **GOTCHA**: append at the top, do not rewrite the #58 entry below it.
- **VALIDATE**: `git diff --stat README.md`
- **SATISFIES**: the epic's "one considered product" record-keeping; documentation criterion.

### Task 13 · Full suite and manual pass

- **IMPLEMENT**: run the whole suite, then work the Level 4 list below in real Safari and real
  Chrome at 360px.
- **VALIDATE**: `export PATH="$HOME/.nvm/versions/node/v24.11.0/bin:$PATH" && node --test test/*.test.js 2>&1 | tail -8` → **802 baseline + the new assertions, 0 fail, 0 skipped**
- **SATISFIES**: all.

---

## TESTING STRATEGY

The project's framework is `node --test` with zero dependencies, parsing files rather than
rendering them (`test/tokens.test.js:9-13` states the doctrine and the reason: there is no DOM and
the plan forbids adding tooling to get one). Every test below follows that.

### Unit Tests

Not applicable in the usual sense — this ticket adds no functions. The equivalent is the static
structural gate: `test/prep-shell.test.js` (new, Task 9) and the extension to `test/chrome.test.js`
(Task 10).

### Integration Tests

`test/prep-shell.test.js` **is** the integration test: it asserts the contract between two
artefacts that are edited independently and cannot see each other — `login.js`'s twelve
`getElementById` calls and `login.html`'s ids. That coupling is invisible to every other test in
the suite.

### Edge Cases

Each must be exercised in Phase 4 (browser) or asserted in Phase 3 (static):

| Case | Where it is covered |
|---|---|
| A candidate lands on `/prep/login` clean | manual |
| …on `?e=invalid` and `?e=expired` (the notice panel renders) | manual |
| …with a crafted `?e=<script>` (nothing is reflected) | `login.js:14-16` behaviour, unchanged; confirm manually |
| Act 2 revealed after a 202, focus lands in `#code` | manual |
| An error tone on either state line (`data-tone="error"`) | static (Task 9.4) + manual |
| The 6-digit field at 360px — does the box fit the column | manual |
| Focusing `#email` on iOS — **no viewport zoom** | manual, real iOS Safari or the simulator |
| The retention table at 360px — scrolls inside its box, page does not | manual |
| JavaScript off on `/prep/` — the `<noscript>` link is reachable | manual |
| `prefers-reduced-motion: reduce` on all three pages | manual + static (Task 10) |
| A 120-character unbroken word in any heading | none of these pages render model output; N/A |

---

## VALIDATION COMMANDS

Execute every command to ensure zero regressions and 100% feature correctness.

**Every command below assumes Node 22.5+.** Prefix each shell with:
`export PATH="$HOME/.nvm/versions/node/v24.11.0/bin:$PATH"`

### Level 1: Syntax & Style

```bash
# No raw colour anywhere outside tokens.css, no motion outside the guard, fonts on-origin.
node --test test/chrome.test.js

# prep.css: no raw hex, no raw px, no :focus, no selector app.css already owns.
node --test test/prep-registry.test.js

# No 500 weight survives anywhere in the portal.
grep -rn "font-weight: *500" public/ ; test $? -eq 1

# No raw px left in the two inline blocks that had one (sr-only's 1px is expected and legal).
grep -n "[0-9]px" public/prep/privacy.html public/prep/index.html ; test $? -eq 1
```

### Level 2: Unit Tests

```bash
node --test test/prep-shell.test.js
node --test test/tokens.test.js
```

### Level 3: Integration Tests

```bash
node --test test/*.test.js 2>&1 | tail -8
# Expect: pass 802 + new, fail 0, skipped 0. Anything skipped means the Node version is wrong.
```

### Level 4: Manual Validation

The ACs that no static test can reach. `/prep/login` and `/prep/privacy` are static pages and need
only the dev server; `/prep/` needs the session round trip, so it needs D1 up.

```bash
npm run dev            # migrates local D1, then serves on http://localhost:8788
```

Then, **in real Safari and real Chrome, at a 360px viewport** (CHECKLIST: a bundled engine misses
real-engine blowouts):

1. `http://localhost:8788/prep/login` — the clean state. No horizontal page scroll at 360px.
   Both buttons fill the column and measure ≥44px tall.
2. Focus the email field **on iOS Safari or the iOS simulator**. The viewport must not zoom. This
   is the one check that cannot be done on a desktop browser's responsive mode.
3. `?e=invalid` then `?e=expired` — the notice panel renders on `--tint-info`, the text is
   `--text-primary`, and it reads as information rather than an alarm.
4. Submit an empty email — the state line goes `--danger` and the layout does not jump (the
   `min-height` reservation).
5. Submit a real address against local D1 — act 2 reveals, focus lands in `#code`, and the
   six-digit field is the largest thing on the page.
6. Tab the whole page. Every stop shows the two-line focus ring from `app.css:74-83`, and the
   order is head → notice → act 1 → act 2 → footer.
7. `http://localhost:8788/prep/privacy` — seven sections read as seven places. The retention table
   scrolls **inside its box**; the page does not scroll sideways. Check both engines: this is the
   classic blowout.
8. `http://localhost:8788/prep/` — the junction paints something calm before it redirects. Then
   disable JavaScript and reload: the `<noscript>` link to `/prep/login` is visible and works.
9. Turn on **Reduce Motion** at the OS level and reload all three. Nothing animates; every element
   renders at its final state immediately.
10. Run `.claude/skills/dossier-design/references/CHECKLIST.md` end to end. The Accessibility and
    Layout sections are the ones with teeth here.

### Level 5: Additional Validation (Optional)

```bash
# Screenshots on a fresh port each iteration (CHECKLIST's browser-caching trap).
python3 -m http.server 8899 --directory public   # static-only; the /prep/auth routes will 404
```

Chrome DevTools MCP (`web-perf` skill) can measure first paint on `/prep/login` if the "instant
paint" claim needs a number rather than an impression. Not required to close the ticket.

---

## ACCEPTANCE CRITERIA

Mapped to the ticket's four criteria and the epic's six.

- [ ] **AC #1 — one token set, no forked palette.** `login.html` and `privacy.html` link
      `/prep/prep.css`; no page-scoped block declares a colour (`chrome.test.js`); no raw hex or px
      in `prep.css` (`prep-registry.test.js`); `tokens.css` values are unchanged.
- [ ] **AC #2 — comfortable at 360px, no horizontal scroll.** Verified in real Safari and real
      Chrome on all three pages, including the retention table, which scrolls inside its own box.
- [ ] **AC #3 — contrast gates and reduced motion respected.** `tokens.test.js` green; the notice
      carries `--text-primary` on `--tint-info` (8.21:1) and never `--text-muted` (3.75:1); no
      motion outside the `no-preference` guard, now asserted for inline blocks too.
- [ ] **AC #4 — calm, human tone.** Every visible string passes the humanizer rules in
      `CHECKLIST.md`: no em/en dashes, no "not X but Y", active voice, plain en-GB.
      `COPY.sent` and `COPY.notConfigured` in `login.js` are unchanged.
- [ ] **Epic AC #3 — keyboard and screen-reader behaviour at least as good as today.** Both live
      regions survive, `aria-labelledby` on both acts survives, the retention table keeps table
      semantics at every width, no positive `tabindex` (already gated by
      `prep-registry.test.js:820-830`), and focus order is verified by hand.
- [ ] **Epic AC #5 — no build step, no framework, no CDN request.** Nothing added to
      `package.json`; `fonts.css` untouched and still gated by `chrome.test.js:101-129`.
- [ ] **Behaviour is unchanged.** `login.js` is not edited. `index.html`'s script is byte-identical.
      All twelve ids resolve.
- [ ] Full suite: 802 baseline + new assertions, **0 fail, 0 skipped**, under Node 22.5+.
- [ ] `README.md` carries the decision entry.

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] All validation commands executed successfully
- [ ] Full test suite passes (802 + new, 0 fail, **0 skipped** — a skip means the wrong Node)
- [ ] Every new assertion verified to fail when violated, and the probes reverted
- [ ] Manual pass done in real Safari **and** real Chrome at 360px, including the iOS zoom check
- [ ] `CHECKLIST.md` run end to end
- [ ] Acceptance criteria all met
- [ ] `git diff public/tokens.css` is comment-only
- [ ] PR body flags the `prep.css:96` weight fix as visibly affecting #63's pages

---

## OPEN QUESTIONS / ASSUMPTIONS

**Assumptions this plan makes:**

1. **#58 is merged and is the base.** Confirmed: `64f551e` on `main`, and this branch is
   `feature/redesign-foundation`. **Branch from an up-to-date `main`** before starting — repo
   memory records that parallel sessions share this worktree and HEAD moves underneath you, so
   verify the branch before every commit.
2. **The token layer needs no porting.** The ticket says "port the new tokens into `prep.css` (or
   import the shared tokens file)". #58 already did that: `prep.css` resolves every value through a
   custom property and `prep-registry.test.js:765-772` enforces it. The remaining work is linking
   the file from the shell pages, which is what Task 3 does.
3. **`--tint-info` may take its first consumer here** rather than waiting for #60.
   `tokens.css:77-79` calls #60 "the first consumer", but that is a note about sequencing and not a
   reservation, and a dead-link notice is literally what the "info" tint is named for. Cheap to
   revert to `--surface` if the owner disagrees — one declaration.
4. **The retention table scrolls rather than restacks at 360px.** The alternative fails epic AC #3.
   Reasoning in NOTES.
5. **Tone work is copy polish, not a copy rewrite.** PR #50 shipped this copy three days ago and
   the ticket says do not re-litigate the flow.

**Questions that would change the plan if answered differently:**

- **Should the login page carry the agency's name rather than "Interview prep"?** Today all five
  portal pages say "Interview prep" in the topbar. A candidate arriving from an email may not
  connect that to the agency that invited them, which is a trust problem on the exact page where
  trust matters most. **This plan does not change it** — the agency name is not available to a
  static page and plumbing it through is a Function change, which is out of scope for a restyle.
  Flagging it as a real gap for the owner and a candidate for its own ticket.
- **Is `index.html` allowed a designed slow state?** The fetch has no timeout, so a hung request
  leaves a candidate on "Checking your sign-in…" indefinitely. This plan adds only `<noscript>`,
  because a timeout is behaviour. If the owner wants the slow state, it is three lines and belongs
  in this ticket rather than a new one.

---

## NOTES (open canvas)

### Why the retention table scrolls instead of restacking

The standard responsive-table pattern sets `display: block` on `tr`/`td` under a breakpoint and
labels each cell with a `::before` from `data-label`. It looks better at 360px. It also **strips
the table's implicit ARIA roles** — a `td` with `display: block` is no longer a `cell` in the
accessibility tree, so a screen-reader user loses the row/column association that is the whole
point of a three-column "what · why · when deleted" grid. Epic AC #3 says keyboard and
screen-reader behaviour must be at least as good as today, and today it is a real table.

The alternatives were:

| Option | Phone legibility | SR semantics | System consistency | Verdict |
|---|---|---|---|---|
| Restack with `display: block` | best | **broken** | new pattern | rejected on AC #3 |
| Restack + explicit ARIA roles | best | restored, fragile | new pattern | rejected: a hand-maintained role map on a legal page is a liability |
| Scroll inside `.table-scroll` (+ `min-width`) | acceptable | unchanged | matches `.counts` | **chosen** |
| Replace the table with three cards | good | fine | loses the comparison | rejected: the columns are the content |

CRAFT explicitly licenses the chosen one: "wide content scrolls in its own `overflow-x: auto`
container". AC #4 forbids horizontal **page** scroll, which an internal scroller does not cause.
`app.css:953-956` already does this for the counts table, so the portal and the recruiter side end
up with one table grammar rather than two.

### Why `index.html` does not get `prep.css`

Four blocking stylesheets on a page that exists for one round trip is a real cost on a phone: the
candidate sees nothing until all four resolve, and then the page redirects. The page's entire
vocabulary — `.topbar`, `.page-head`, `.page-sub` — is `app.css`'s. Linking `prep.css` there would
buy consistency-on-paper and pay for it in the one metric the ticket names ("instant paint"). It
keeps its own `<style>` block, so `chrome.test.js`'s sweep list needs no edit and the page is still
gated against a raw colour.

### The iOS zoom fix, and the fix that would have been wrong

Two ways to stop iOS Safari zooming when a 14px input takes focus:

1. `font-size: 16px` on the control. Costs nothing, changes only that page.
2. `maximum-scale=1, user-scalable=no` on the viewport meta. **Fails WCAG 1.4.4 (Resize Text)** by
   disabling pinch zoom for everyone, on the candidate surface, on a page a nervous person is
   reading on a phone.

Option 1, via `.signin .input { font-size: var(--text-note) }`. Task 9's assertion 6 exists to stop
anyone reaching for option 2 later.

`app.css:248-249` already sets `.textarea` to `--text-note`, so the recruiter side's big field is
safe. **`session.html:53` is a bare `<textarea id="answer">` with no class**, so it inherits the
user agent's size and has the same trap. That is #63's page and #63's fix — noting it here so the
next ticket does not have to rediscover it.

### What is actually shared, and why `prep.css` gains so little

Auditing the three inline blocks, almost nothing has a second consumer. `.sr-only` is login-only
today (and cannot move without hitting the px gate). `.code-input`, `.notice`, `.retention` and the
junction column are singular by definition. `.state` is login-only — `brief.html:34` and
`session.html:31` use `app.css`'s `.save-state`, which is a different component with a different
reveal contract.

So `prep.css` gains **one rule and a weight fix**, and the real win of linking it is
`.prep-footer`: every page in the portal now ends the same way, and the two pages that were dead
ends stop being dead ends. That is a small diff for a structural gain, and it is the right size —
a rule that exists to style one block is the sign this file has started becoming a second
`app.css` (`prep.css:14-17`). Resist the urge to move `.notice` or `.code-input` there to make the
Phase 1 diff feel more substantial; that is the exact failure mode the file's header warns about.

### Sequencing and parallelism

Phase 2's three pages are genuinely independent: separate files, no shared selectors after Phase 1.
If this is split across parallel loops, Phase 1 must land first and be committed, or three
worktrees each edit `prep.css` and the merge is a conflict for no gain. Given the whole ticket is
~500-900 lines, one loop is almost certainly right.

Within the epic, this ticket is wave 2 and runs alongside #59 and #61. **The shared risk is
`tokens.css`** — #59 owns the type ramp and will change values there. This plan touches one comment
in that file (Task 8). If #59 lands first and the comment block has moved, re-read before editing;
do not force the diff.

### Copy register, for the strings that are in scope

The candidate is nervous and this is not their tool. Two rules beyond the humanizer list:

- **Never imply they did something wrong.** "That link has already been used, or it is not valid
  any more" is right. "Invalid link" is not.
- **Say what happens next in the same sentence as the problem.** Every error state on the sign-in
  page already does this. Keep it.

## AMENDMENTS

<!-- Append-only. Newest at the bottom. Leave empty until this plan has been executed. -->
