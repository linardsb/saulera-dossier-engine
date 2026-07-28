# Implementation Report — component registry + prep-brief dashboard

**Plan**: `.claude/plans/prep-component-registry-and-brief-dashboard.md`
**Branch**: `feature/prep-component-registry` (off `origin/main` @ `7344a6e`)
**Status**: COMPLETE — with the Level 4 browser sweep unrun and handed back (see *Not run*)

## Summary

`public/prep/registry.js` holds ten hand-built DOM constructors, one per name in decision 22's
pilot vocabulary, plus `renderBlocks`, which walks a `{name, props, children}` payload and looks
each name up. A name that is not a key is reported to the console and skipped — nothing injected,
no placeholder. `public/prep/brief.html` + `brief.js` + `prep.css` render a stored payload end to
end in the dossier design system, against `brief.fixture.json`, which is *derived by script* from
#19's own test fixtures rather than hand-written.

Architecture §3's claim ("there is no component that renders a finished answer or a score") is
structural here rather than instructed: no such constructor exists, and a test asserts the key set.

## Tasks completed

| Task | File | |
|---|---|---|
| Branch from `origin/main` | — | see *Deviations* |
| Name lists + module header | `public/prep/registry.js` | CREATE |
| Shared helpers (`el`, `section`, `mark`, `lines`, `labelled`, `text`, `displayQuote`) | `public/prep/registry.js` | — |
| Five brief-time constructors | `public/prep/registry.js` | — |
| Provenance rendering (`provenanceNode`, `panelSourceNode`) | `public/prep/registry.js` | — |
| Five session-time constructors | `public/prep/registry.js` | — |
| `REGISTRY` + `renderBlocks` | `public/prep/registry.js` | — |
| Bounded document double | `test/helpers/dom.js` | CREATE |
| Session specimen props | `test/fixtures/prep-session-blocks.json` | CREATE |
| The stored payload | `public/prep/brief.fixture.json` | CREATE (derived) |
| The dashboard page | `public/prep/brief.html` | CREATE |
| Fetch, states, mount | `public/prep/brief.js` | CREATE |
| Page-scoped rules | `public/prep/prep.css` | CREATE |
| The suite | `test/prep-registry.test.js` | CREATE |
| Registry paragraph | `README.md` | UPDATE |

## Tests added

`test/prep-registry.test.js` — **42 tests, 11 groups**, all passing:

1. Export surface — the ten names written out literally; `BRIEF_BLOCK_NAMES` reconciled against
   `BLOCK_NAMES` from `src/prep/schema.js` (the drift `test/prep-schema.test.js:47-52` predicted);
   no key answer- or score-shaped; and a bare import test so a stray top-level `document` fails by
   name rather than taking the file down.
2. Source scans — nothing parses HTML, nothing reaches browser storage, **comments stripped first**.
3. The stored payload renders: 7 blocks, every `<section>` named by a heading that exists, ids
   unique, every visible prop string present, re-render replaces rather than appends.
4. The five session specimens render; the fixture covers every session name; `HelpLadder.structure`
   is headings.
5. Unknown name skipped at top level **and** nested; dangling `competency_id`; empty `blocks`;
   missing prop; `LogisticsRail` with `when: ""`.
6. Provenance — verified quote shown, unverified mark word shown and not inside a hidden branch,
   failed quote's text absent, `verified` absent treated as unverified, panel `failed_field_key`,
   and no `source_field_key` slug anywhere in the output.
7. Rank scan over the **whole** rendered output of both fixtures; plus importance renders as order
   (priority order asserted to survive) and never as a numeral.
8. HelpLadder — two `<button type=button aria-expanded=false aria-controls>`, panels `hidden`,
   structure as list items, `onRung` fires `"nudged"`/`"revealed"` on open only, closing is not a
   third rung, and a ladder with no `onRung` still toggles.
9. The shipped fixture deep-equals *and* is byte-identical to `verifyBrief(assertBrief(…))`; the
   demotion (`sourced: 2, unverified: 1`) is asserted as intentional.
10. `prep.css` — no raw hex, no raw px in declarations, no `:focus` rule, nothing that animates, no
    selector restated from `app.css` (139 vs 24, zero overlap), no positive `tabindex` in `public/prep/`.
11. Guarding the guard — the serializer reached the nested `StoryBankCard` (its prompt, its last
    skeleton item, its generated landmark id, and that it is *inside* its map rather than a
    sibling), and the serializer carries attributes and class names.

**Mutation-tested.** Each of the five load-bearing gates was broken on purpose and confirmed red,
then restored byte-identically: an 11th answer-shaped registry key (3 fail), an HTML-parsing
assignment in `registry.js` (1 fail), `ProgressStrip` rendering "Level 2 of 4" (1 fail), a
hand-repaired `verified: false` in the fixture (2 fail), a raw hex in `prep.css` (1 fail).

## Validation results

| Gate | Result |
|---|---|
| `node --check` × 4 new JS files | pass |
| Module loads under Node, no DOM | pass — 10 registry keys |
| `grep` browser-storage APIs in `public/prep/*.js` | clean |
| `grep` HTML-parsing APIs in `public/prep/*.js` | clean |
| `node --test test/prep-registry.test.js` | **42 pass, 0 fail** |
| `npm test` on **Node v20.20.2** | **402 tests, 397 pass, 0 fail, 5 skipped** |
| `npm test` on **Node v24.11.0** | **402 tests, 402 pass, 0 fail, 0 skipped** |
| Level 3 `--test-name-pattern="derived"` | 1 pass (see *Deviations* — it matched 0 as written) |
| `test/tokens.test.js` | unchanged and green — no new colour was needed |
| Served by `wrangler pages dev` | `/prep/brief` 200, all four assets 200 with correct MIME, `X-Robots-Tag: noindex` present |

The 5 skips on Node 20 are #17's pre-existing `node:sqlite` tests (needs ≥22.5), not this ticket.

**Risk tripwires**: R1 helper 127 lines / 8 operations (see *Deviations*) · R5 session constructors
11, 47, 6, 13, 10 lines — `HelpLadder` is the plan's named exception · R6 `prep.css` 175 lines,
zero selectors shared with `app.css` · R7 group 9 green.

**CHECKLIST pass** (`dossier-design`): contrast — no new colour, `tokens.test.js` green. No hover-only
or colour-only information: every provenance state carries its word. Reduced motion — `prep.css`
contains no `transition`, `animation` or `@keyframes` at all. Wide content — `.prep-provenance`,
`.prep-dl` and `.brief` carry `min-width: 0`, the first two also `overflow-x: auto`, and every prose
class carries `overflow-wrap: anywhere`. Custom-property discipline — zero raw hex, zero raw px in
declarations. Data posture — no storage of any kind, nothing candidate-shaped in the URL. Humanizer
— zero em/en dashes and zero "not X but Y" across all three sets of visible copy; every visible
string lives in a `COPY` object. **Keyboard, focus and cross-browser rows are unrun** — see below.

## Deviations from the plan

1. **Worked in the existing worktree, not a fresh one.** Phase 0 says take a new worktree. This
   session's working directory is already a linked worktree whose branch (`#18`) was merged into
   `origin/main` at `7344a6e`, the tree was clean, and no other worktree held the new branch — so
   `git checkout -b feature/prep-component-registry origin/main` reaches the same base with no
   `node_modules` symlink to wire. R4's tripwire was checked directly: `src/prep/` lists all four
   files and `npm test` was green before any new file existed.

2. **`test/helpers/dom.js` implements 8 operations, not R1's 6.** Both additions are bookkeeping,
   not browser, and are argued in the file's header: `addEventListener` **records** the handler and
   never dispatches (every `public/*.js` uses it and none uses a handler property; the rung test
   invokes the recorded function directly), and `hidden` is a plain property `serialize` reads
   (it is what `clients.js` sets and what `app.css:441-445` matches on). No event object, no
   bubbling, no default action, no focus, no layout. 127 lines against the 200-line tripwire.

3. **Renamed group 9's test to contain "derived".** The plan's own Level 3 command
   (`--test-name-pattern="derived"`) matched **zero** tests as the test was first named — a
   documented validation command that passes vacuously. Renamed so it matches exactly 1.

4. **Added a raw-px assertion that group 10 does not specify.** AC #7 says "no raw hex **or px** in
   `prep.css`" while group 10 as written checks only hex. The assertion exempts `@media` preludes,
   since a breakpoint is px by nature and is not a component value.

5. **The state line reuses `app.css`'s `.save-state`, which carries an opacity transition.**
   `prep.css` itself contains no transition at all, and `app.css:866-870` zeroes durations under
   `prefers-reduced-motion`. Reusing the house state-line grammar seemed better than a near-copy
   under a new name, which is what R6 exists to prevent.

6. **`HelpLadder` tracks its open state in a closure** rather than reading `aria-expanded` back off
   the button. One place holds the state, and the two things that must agree — what assistive
   technology is told and whether the panel is hidden — are written from it together.

7. **Reset `.wrangler/state`** to get the dev server up: the local D1 ledger was stale from an
   earlier session (`note_visibility already exists`). The directory is worktree-local, gitignored
   and rebuilt by the migrations. Served on **port 8790** because another session holds 8788.

Nothing outside the plan's scope was touched: `src/prep/*`, `public/app.*`, `public/index.html`,
`public/clients.*`, `public/tokens.css` and `test/tokens.test.js` are all unmodified.

## Issues encountered

- **My first CSS-selector parser had a real bug**, caught by its own test going red: the capture
  class excluded `@` on the first character only, so it spanned into `@media` preludes and reported
  a false collision. Fixed to skip at-rule preludes explicitly. Verified afterwards that it still
  reaches rules *inside* media queries, so the collision check is not blind where it matters.

- **Two AC #5 branches cannot be reached from the shipped fixture** and are covered by hand-built
  payloads in the suite instead: `verified === undefined` (`verifyBrief` stamps every competency)
  and a `PanelBrief` entry with `failed_field_key` (the derivation returns `panel_unsourced: 0`).
  The demo screen therefore demonstrates the unverified **competency** path only; the panel half of
  AC #5 is proven by test, not by the shipped screen.

- **Three sections share the heading "A story worth bringing"** in the shipped fixture, because it
  carries three `StoryBankCard`s. Each is a correctly named landmark, but a screen reader's region
  list will show three identical names. Left as-is (the heading is fixed, reviewed copy and the
  payload genuinely has three stories) and flagged for Level 4 step 4.

## Not run — needs a real browser

There is no browser automation in this session, so **Level 4 was not completed**. It is item 6 on
the plan's "never cut" list, so this is recorded rather than skipped. What *was* verified: the page
and all four assets serve with correct status and MIME, the served `registry.js` is byte-identical
to disk, and the served fixture fetched over HTTP renders 7 sections with the unverified mark
present and the fabricated quote absent.

Still needed, in **real Safari and real Chrome**:

```bash
npm run dev        # then open http://localhost:8788/prep/brief
```

- Steps 3, 4, 5 — tab order and visible focus, the screen-reader landmark list, and 360px with no
  horizontal scroll. AC #7's keyboard and focus half is **unevidenced** until step 3 is run.
- Step 7 — break `SOURCE` to a 404 and confirm the error line reads plainly. The code path is not
  exercised by any test, because `brief.js` touches the document at module scope.
- Steps 1, 2, 6, 8 — proven structurally by tests and by the served-bytes render, but not yet seen
  in a real engine.
