# Implementation Report — Candidate portal shell (#62)

**Plan**: `.claude/plans/candidate-portal-shell-redesign.md`
**Branch**: `feature/candidate-portal-shell-redesign` (from `origin/main` @ `b4d89b3`)
**Status**: PARTIAL — every automated task and gate is complete and green. Level 4 (real Safari,
real Chrome at 360px, the iOS focus-zoom check, CHECKLIST end to end) needs a human and has not
been run. See "NOT done" at the foot.

## Summary

The three shell pages of the candidate portal — sign-in, the `/prep/` junction and the privacy
page — are redesigned phones-first and brought onto the design system #58 landed. `login.html`
and `privacy.html` now link `prep.css`, so the whole portal is served by one stylesheet chain and
every page ends in the same `.prep-footer`; the `/prep/` junction deliberately does not, because
it exists for one round trip. Two static gates were added: `test/prep-shell.test.js` over the
markup contract two scripts depend on, and an extension to `test/chrome.test.js` closing the hole
where a page-scoped `<style>` block could animate outside the reduced-motion guard. No behaviour
changed: `login.js` is untouched and `index.html`'s script is byte-identical.

## Tasks completed

- Task 1 — the two silent `500` weights → `600` · `public/prep/prep.css` (UPDATE),
  `public/prep/privacy.html` (UPDATE, folded into Task 7)
- Task 2 — `.btn-block` in the existing narrow-screen block · `public/prep/prep.css` (UPDATE)
- Task 3 — link `/prep/prep.css` · `login.html`, `privacy.html` (UPDATE)
- Task 4 + 5 — markup and page-scoped block · `public/prep/login.html` (UPDATE)
- Task 6 — the quiet junction and the `<noscript>` · `public/prep/index.html` (UPDATE)
- Task 7 — section rhythm, retention table, footer · `public/prep/privacy.html` (UPDATE)
- Task 8 — `--tint-info`'s first consumer, comment only · `public/tokens.css` (UPDATE)
- Task 9 — the markup contract gate · `test/prep-shell.test.js` (CREATE)
- Task 10 — the inline-block motion guard · `test/chrome.test.js` (UPDATE)
- Task 11 — 18 probes, each verified to fail with its own named assertion, all reverted
- Task 12 — the decision entry · `README.md` (UPDATE)
- Task 13 — full suite

## Tests added

`test/prep-shell.test.js` (new, 7 tests):

1. every id `login.js` reaches resolves in `login.html` — parsed through the `$()` helper, with a
   `>= 12` non-empty guard first so a refactor of `$` cannot silently disarm the gate
2. the phone attributes on `#code` (`one-time-code`, `numeric`, `maxlength="7"`) and `#email`
3. both state lines keep `role="status"` + `aria-live="polite"`; `#act-code` and `#notice` keep
   `hidden`; both acts keep `aria-labelledby`
4. `login.html` still styles `[data-tone="error"]` — the attribute `login.js:78` writes, not a class
5. the junction still fetches `/prep/auth/session`, keeps **both** fail-closed
   `location.replace("/prep/login")` branches and the `/prep/brief` one, and still loads `login.js`
6. all three keep the robots meta and a viewport with no `maximum-scale` / `user-scalable`
7. the stylesheet chain and its order on all three pages

`test/chrome.test.js` (+1 test): the brace-counting reduced-motion strip now also runs over every
page-scoped `<style>` block. The strip and the inline-block extractor were pulled into shared
helpers (`stripMotionGuards`, `inlineBlocksOf`) used by all four tests in the file.

**Task 11 probe results — 18/18 caught**, each by the intended assertion. Verified messages:

| probe | assertion that fired |
|---|---|
| drop `autocomplete="one-time-code"` | `#code lost the one-time-code autofill hint` |
| refactor `$()` so the regex extracts nothing | `parsed 0 id lookups out of login.js, expected at least 12 …` |
| delete one fail-closed branch | `the junction must bounce to /prep/login on BOTH …` |
| add `maximum-scale=1` | `… disables pinch zoom, which fails WCAG 1.4.4 …` |
| animate an inline block | `… animates outside a prefers-reduced-motion: no-preference guard` |

Also caught: renaming an id, `maxlength` 7→6, dropping `inputmode`, `role="status"`, `hidden`,
`aria-labelledby`, the `<script>` tag, the session fetch, the robots meta; restyling the tone as a
class; linking `prep.css` from the junction; unlinking it from privacy.

## Validation results

Under Node **v24.11.0** (the shell default v20.20.2 fails `node-version.test.js` and skips 152).

| Level | Command | Result |
|---|---|---|
| 1 | `node --test test/chrome.test.js` | **6 pass, 0 fail** |
| 1 | `node --test test/prep-registry.test.js` | **48 pass, 0 fail** |
| 1 | `grep -rn "font-weight: *500" public/` | **no match** |
| 1 | `grep -n "[0-9]px" privacy.html index.html` | **no match** |
| 2 | `node --test prep-shell.test.js tokens.test.js` | **42 pass, 0 fail** |
| 3 | `node --test test/*.test.js` | **833 pass, 0 fail, 0 skipped** |
| — | `git diff public/tokens.css` | **comment-only, verified by eye on the diff** |
| — | static serve smoke test | all 3 pages + all 4 stylesheets **200** |

Baseline before this ticket was **825**, so the suite gained **8** assertions. (The plan quoted
802; it was written before later tests landed — see Deviations.)

## Deviations from the plan

1. **`.code-input` is scoped as `.signin .code-input`, not `.code-input`.** As written, the plan
   would have broken the page's signature element. Task 5 adds `.signin .input { font-size:
   var(--text-note) }` (0,2,0) and keeps `.code-input` (0,1,0) on a `<input class="input
   code-input">` inside `<main class="signin">`. Specificity beats source order, so the six-digit
   field would have resolved to 16px instead of its intended display size, taking its `em`-based
   `width: calc(7.4em + …)` down with it. Scoping the signature rule to match specificity and win
   on order is the fix. No test renders CSS, so nothing in the suite would have caught this.

2. **The code field is `--text-h1`, up from `--text-h2`.** The plan says "scale it up for a phone"
   and Level 4 check 5 says it must be "the largest thing on the page"; the `<h1>` is `--text-h2`,
   so at the old size they tied. `--text-h1` is the existing ramp's top step already used by
   `prep.css` — a token reference, not a token change.

3. **A `.signin-footer` modifier was added to `login.html`'s block.** `.prep-footer` caps at 72ch
   for the content pages; the sign-in column is 52ch and both centre on the same axis, so the
   shared cap would have hung the footer line out past the left edge of the form. A page-scoped
   modifier class rather than a restatement of `.prep-footer`. Not in the plan — found by
   reasoning about the two `max-width`s before the browser pass.

4. **Baseline is 825, not the plan's 802**, and the prep.css gates are at
   `prep-registry.test.js:842-902`, not `758-830`. Both plan references were stale. Nothing
   depended on either number.

5. **`privacy.html`'s table head is `--text-body` on primary ink**, not the muted colour it had.
   That is what `app.css`'s `.counts-table thead th` does (600 weight, no colour override), and
   Task 7 asks the two tables to read as one system. Body cells stay at `--text-note`.

6. **`index.html` also got `.prep .page-head { margin-bottom: var(--space-6) }`.** `app.css`
   reserves `--space-12` under a page head for content the junction never has.

7. **Task 1's second `500` (privacy.html:35) was fixed inside Task 7's rewrite** rather than as a
   separate edit — same file, one write.

8. **`login.html`'s `.actions` margin went `--space-4` → `--space-6`.** With the buttons now
   full-width under 600px the control is a much larger block, and the old gap left it crowding the
   field above it. Cosmetic, and on the 4px grid.

## Issues encountered

- **`public/404.html` is in `INLINE_STYLE_PAGES`** and the plan puts it out of scope, so the new
  motion gate would have failed on a file I was told not to touch. Checked before building it: the
  file has no motion at all, so it passes unchanged and the sweep did not need narrowing.
  Narrowing it would have defeated epic AC #6.
- **The Task 11 probes could not use `git checkout` to revert** — the three pages are tracked and
  modified, so that would have reverted them to `origin/main` and deleted this ticket's work. The
  harness backs up to the scratchpad and restores from there. Residue was checked afterwards
  (`git status` + a grep for every probe string) and the tree is clean.
- **A parallel session is working in this worktree** (`.claude/plans/redesign-clients-and-counts-screens.md`
  appeared untracked mid-run). Repo memory warns HEAD moves underneath; the branch was verified
  before every step and nothing outside this ticket's files was staged or written.

## NOT done — Level 4 needs a human

Every automated level passes. The plan's Level 4 has **no automated path** and I have no browser
in this environment, so these are open and the ticket should not be called closed without them:

1. `/prep/login` and `/prep/privacy` at **360px in real Safari and real Chrome** — no horizontal
   page scroll; the retention table scrolls *inside* its box (the classic cross-engine blowout).
2. **Focusing `#email` on real iOS Safari or the simulator** — the viewport must not zoom. This is
   the one check a desktop responsive mode cannot make, and it is the ticket's headline fix.
3. `?e=invalid` / `?e=expired` — the notice reads as information rather than an alarm on the info
   tint. Worth an eye: `--tint-info` is a powder blue in a warm-green palette, and this is its
   first consumer anywhere in the product.
4. The full tab order, both buttons ≥44px, act 2 revealing with focus landing in `#code`
   (needs `npm run dev` for local D1), the `<noscript>` path with JavaScript off, and Reduce Motion
   on all three.
5. `CHECKLIST.md` end to end.

## For the PR body

The `prep.css:96` weight fix **visibly changes #63's pages** — every `.block-head` on
`brief.html` and `session.html` renders heavier. That is the file's existing intent finally
rendering (Geist has no 500, so the request resolved down to 400), not a restyle of those pages.
