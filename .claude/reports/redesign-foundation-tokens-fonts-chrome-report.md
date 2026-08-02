# Implementation Report — Redesign foundation: tokens, fonts, and shared chrome (#58)

**Plan**: `.claude/plans/redesign-foundation-tokens-fonts-chrome.md`
**Branch**: `feature/redesign-foundation` (off `origin/main`, per the plan's checklist)
**Status**: COMPLETE — code and gates. Three visual/behavioural checks need a human at a browser;
they are named under *Outstanding* below and were never runnable from here.

## Summary

Repalettes `public/tokens.css` onto the owner's decided zig.ai colours, collapses the type stack
to one sans (Geist) plus one mono (DM Mono), and restyles the shared chrome in `public/app.css`
on the result. Motion is inverted from opt-out (a blanket `prefers-reduced-motion: reduce`
override with `!important`) to opt-in: six transitions now live in one `no-preference` block at
the foot of the file, held by a new `test/chrome.test.js`. No layout moved, no markup changed, no
JavaScript or `src/` module touched.

The palette gained two tokens the decided set did not supply: `--accent-strong` and `--on-accent`.
The decided `--accent` `#08906c` measures 4.03:1 with white and 3.19:1 with the ink, both under
the 4.5:1 body-text floor, and `.btn-primary` puts a label directly on it — so the fill is the
accent darkened to the minimum value that clears the floor (5.04:1), and `--accent` keeps the
owner's hex at all six sites where it is decorative and legal.

## Tasks completed

| # | Task | File | Action |
|---|---|---|---|
| 1 | Extend the contrast gate before the palette moved | `test/tokens.test.js` | UPDATE |
| 2 | The palette | `public/tokens.css` | UPDATE |
| 3 | Delete the third font family | `public/fonts/Aspekta500.woff2` | DELETE |
| 3 | Licence paragraph + `@font-face` | `public/fonts.css` | UPDATE |
| 4 | Headings 500 → 600, type comment | `public/app.css` | UPDATE |
| 5 | `.btn-primary` onto `--accent-strong` | `public/app.css` | UPDATE |
| 6 | Stale contrast numbers in comments | `public/app.css` | UPDATE |
| 7 | Invert the motion guard | `public/app.css` | REFACTOR |
| 7* | Guard the portal's typing indicator (**deviation**) | `public/prep/session.css` | UPDATE |
| 7* | Assert that guard (**deviation**) | `test/prep-session-ui.test.js` | UPDATE |
| 8 | The chrome gate | `test/chrome.test.js` | CREATE |
| 9 | Verify `404.html` on the new base | — | NO CHANGE NEEDED |
| 10 | Decisions log | `README.md` | UPDATE |

## Tests added

**`test/chrome.test.js`** (new, 5 tests) — every transition in `app.css` sits behind the
reduced-motion guard; `app.css` declares no colour of its own; no page-scoped `<style>` block
declares one either (all four); `fonts.css` requests nothing off-origin; every font file
`fonts.css` names is actually on disk.

**`test/tokens.test.js`** (+17 tests) — `SURFACES` gained `surface-signature`, so every pairing is
now measured against three grounds rather than two. `PAIRINGS` gained `--accent` at the 3.0
non-text floor. A new `TINTS` table measures what actually renders on each tint. The
`--text-primary`-on-`--accent` test was replaced by `--on-accent` on `--accent-strong`.

**`test/prep-session-ui.test.js`** (+1 test) — the portal's one animation must sit inside a
`no-preference` block. See *Deviations*.

**Every new assertion was verified to bite**, by temporarily violating it and confirming a red:

| Violation injected | Result |
|---|---|
| `.card { transition: all 1s; }` in `app.css` | fail 1 ✓ |
| Raw hex in `app.css` | fail 1 ✓ |
| Raw hex in `404.html`'s `<style>` | fail 1 ✓ |
| `fonts.css` src → `https://fonts.gstatic.com/…` | fail 2 ✓ |
| `session.css` guard unwrapped | fail 1 ✓ |

All reverted; tree confirmed clean afterwards.

## Validation results

**Full suite, Node 24.11.0: 802 pass, 0 fail, 0 skipped.**

The plan's stated baseline of "802 on `main`" was measured on the `feature/locum-portal-…`
branch, which carries unmerged tests. The true `origin/main` baseline, measured in an isolated
worktree with `node_modules` linked, is **779 pass / 0 fail**. 779 + 23 new = 802, and the 23
reconciles exactly against the three test files above (17 + 5 + 1).

Level 1 checks, all passing: `transition:` count 6 · no `font-weight: 500` in `app.css` · no
`aspekta` anywhere in `public/` · 3 font files · 3 `@font-face` rules · 6 `var(--accent)` uses,
none of them `.btn-primary`.

Routes, against the running dev server (all as expected): `/` `/clients` `/counts` `/prep/`
`/prep/login` `/prep/privacy` `/prep/brief` → 200; `/does-not-exist` → **404**;
`/fonts/Aspekta500.woff2` → **404**; the other three woff2 → 200.

**Every contrast number in the diff was independently recomputed** against the repo's own WCAG
implementation rather than copied from the plan — all 18 rows of the plan's Phase 1 table
matched exactly, including the two tint exclusions (`--text-muted` 3.75:1 and `--border` 2.53:1
on `--tint-info`) and the superseded `#166534` figures now cited in `tokens.css` (6.87 / 6.26).

## Deviations from the plan

**1. `public/prep/session.css` and `test/prep-session-ui.test.js` were edited. The plan said they
would not be, and its stated reason for that was factually wrong.**

Plan task 7's gotcha claims deleting the blanket `reduce` block is safe because "both
[`prep.css` and `session.css`] already self-guard … That is a verified fact, not an assumption."
It is not a fact for `session.css`. That file animates `.typing-dot` with
`animation-iteration-count: infinite`, unguarded; its own header said so out loud — *"app.css's
reduced-motion guard neutralises the one animation here for free"* — and
`prep-session-ui.test.js` asserts only that there is exactly one `@keyframes`, never where it
sits. Deleting the blanket block would have left an infinite animation running for a user who
asked for no motion, **and the suite would have stayed green.**

Fixed by wrapping the animation in its own `no-preference` block (prep.css's idiom), correcting
the header sentence, and extending the existing motion test with the brace-counting guard check
so the invariant is gated rather than assumed. `display: inline-block` stays outside the guard —
the dots must hold their layout whether or not they animate.

This is not the restyle the non-goal forbids. It preserves today's reduced-motion behaviour
exactly, which epic AC #3 requires stay at least as good.

**2. Aspekta is not named in the shipped CSS.** The plan's task 3 asked for the Aspekta prose to
be replaced, while its Level 1 check demands `! grep -rniq aspekta public/`. A licence paragraph
naming a font that is no longer on disk is actively misleading to anyone auditing licences, so
the historical record went to the README Decisions entry and the shipped comments state the
constraint without naming the dead family.

**3. Two comment-wording choices made to keep the plan's own validation commands honest**, with
no change of meaning: `app.css`'s focus comment says "which the blue it replaced did not" rather
than citing the old `2.75:1` (the plan's grep forbids that string while its gotcha asks for the
conclusion change to be explicit — this satisfies both), and the motion block says "six
transition declarations" rather than "six `transition:` declarations" so
`grep -c "transition:"` returns 6 rather than 7.

**4. `test/chrome.test.js` has five tests, not the three the plan specified.** The hex check is
split across `app.css` and the inline `<style>` blocks because they read differently and a
combined failure would not say which file was at fault; and a fifth asserts every font file named
actually exists on disk, which is the check that ties the `@font-face` deletion to the file
deletion. A `@font-face` pointing at a missing file fails silently.

## Issues encountered

**`public/404.html` serves its own security rationale to every client — pre-existing, not fixed
here.** The HTML comment explaining why the file exists is served verbatim on every 404 and
names `/prep/*` as "publicly reachable by design" and describes "the RECRUITER's tool shell".
The file's own contract two lines below says "no hint of what else is on this hostname". Left
alone deliberately: #58 did not cause it, the diff does not touch that file, and that comment is
currently the **only** written record of why the file exists — the README has nothing on #20, so
trimming it invites someone to delete the file and re-open the real hole (`index.html` served at
200 for `/prep/anything`). Low severity, since `/prep/` already answers 200 to anyone who asks.
The safe fix is to move the rationale into the README first, then leave a minimal non-leaking
comment. Worth its own issue; not filed.

**Known cosmetic deferrals to #62**, both rendering at 400 instead of 500 once the single-500-face
family is gone: `public/prep/privacy.html:35` (`.retention th`) and `public/prep/prep.css:96`.
The plan named only the first.

**`public/prep/prep.css:8` now carries a stale reference** — it lists "the reduced-motion guard
at app.css:866-870" among what it inherits. No behavioural consequence (prep.css self-guards and
its test proves it), but #62 will read it. Left alone per the non-goal.

**The dev server on :8788 belongs to another session** sharing this worktree. It serves the
current `public/`, which is how the route checks above were run; no second server was started.

## Outstanding — needs a human at a browser

There is no browser tool in this environment, so the following could not be run and are **not**
claimed as passing. The plan's own Confidence section anticipated this ("the half-point off is
the manual pass").

1. **AC #5's "renders acceptably"** across all eight pages — the whole visual judgement.
2. **The reduced-motion behavioural check.** With *Reduce motion* ON, reveal act 2 on `/` and save
   a note on `/clients`: both must appear **instantly and fully opaque**. An element stranded at
   `opacity: 0` is the one failure mode this inversion could introduce. The static analysis says
   it cannot happen — nothing in the repo waits on `transitionend`/`animationend` (re-verified),
   and `showAct` uses a double `requestAnimationFrame` — but that is reasoning, not observation.
3. **The 390px resize pass** on `/` and `/clients`.
