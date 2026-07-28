# Code review — PR #14, re-review after the fixes for review 1

**Recommendation: approve.** Review 1's three findings are resolved. Four issues were found in the
fixes themselves; all four are fixed in `f1a7c40` and re-verified.

Scope of this pass: commits `b242bcb` and `9bd8711`, plus a re-check of review 1's findings. The
production diff was already approved in review 1 and is **unchanged** — `git diff 2fb5b3e..HEAD --
public/ functions/` is empty.

## Review 1's findings

| # | Finding | Status |
|---|---|---|
| 1 (High) | Probe 1 no longer exercises its race; gate red at head | **Resolved** — 10/10, and mutation-proven to still catch a broken guard |
| 2 (High) | PR body asserts a defect that does not exist | **Resolved** — replaced with a Correction section; the phantom also retracted on issue #8, where it was still live |
| 3 (Low) | Implementation report stale | **Resolved** — validation section corrected, deviations 3 and 6 updated |

## Issues found in the fixes

### High — 1. Probe 1 could go green with the race never run — *fixed*

`.claude/probes/one-screen.mjs`. Nothing asserted that `/api/prompt` ever *resolved*. A response
still in flight at `READ` time produces `switchedInFlight=true`, `clipboard.length===0`,
`elapsed===""`, `briefReadOnly===false` — identical to a correctly withheld write. Demonstrated
against unmodified `public/app.js` by raising the route delay past the settle window: **PASS with
the guard never exercised.** The worst-observed real margin was ~350ms against response-timer
jitter reaching 885ms, so this was one throttling bucket from a silent green — on the probe that
guards the wrong client's knowledge note reaching the clipboard.

**Fix:** `READ` now reports `copyBusy` (`#copy-prompt[aria-disabled]`), cleared in the copy
chain's final `.then()` regardless of `mine()`. Probe 1 asserts `copyBusy === null`, i.e. the
response landed and was dealt with.

### Medium — 2. `switchedInFlight` certified the moment, not the switch — *fixed*

The flag was assigned *before* `.click()`. A switch that silently no-ops (selector drift, an
early-returning `select()`, an unbound listener) left it `true`, the exception died unobserved in
the timer callback, and probe 1 failed reporting the switch landed in flight when it never landed
— pointing the next reader at `app.js:526`, the exact misdiagnosis review 1 existed to correct.
Demonstrated by making `select()` a no-op on switch-away.

**Fix:** `r.url.includes(B)` added to the check, as probe 2 already does.

### Low — 3. The fix's own comment stated a mechanism measurement contradicts — *fixed*

The comment and commit message claimed `window.open` stalls the main thread and that the switch
timer "is overdue when the click's stall ends". Measured: `window.open` returns in **10–13ms**;
the page is never stalled. The ~544ms is only the CDP `Runtime.evaluate` *reply*. The conclusion
held, but for a different and stronger reason: both timers live in the page, the switch's due time
(registration + 60ms) is always earlier than the response's (a strictly later registration +
500ms), and Chrome fires expired timers in due-time order — so the switch precedes the response
under any throttling. That matters, because `window.open` backgrounds the page and Chrome then
clamps timers to ~1s buckets; both fired up to a second late in 11 samples, switch first 11/11.

Worth fixing precisely because review 1's entire High finding was a wrong mechanism baked into
prose. **Fix:** comment rewritten to the measured mechanism and the ordering argument.

### Low — 4. Two document discrepancies — *fixed*

- **PR body still said "(was 140)"** — the exact figure the report had just retracted, leaving two
  documents on one PR contradicting each other. 140 matches no commit: 65 at the merge-base, 83
  after #7, 161 at the report, 219 at head. Now reads "65 at the merge-base with `main`, so this
  PR adds 154".
- **Report's task table said "Nine browser probes"**; there are ten, contradicting its own
  deviation 6, its Level 5 line and its own numbered list. Pre-existing, not introduced by the
  corrections. Now "Ten".

## Validation

| Gate | Result |
|---|---|
| `npm test` (Node v20.20.2) | **219/219** |
| `npm test` (Node v24.11.0) | **219/219** |
| `node .claude/probes/one-screen.mjs` | **10/10**, all three preconditions true |
| `node .claude/probes/extract-docx.mjs` | **11/11** |
| `npm run spike` / `spike:tamper` | **PASS** / **PASS** (exit 0, exactly 1 demotion) |
| `node --check`, every JS file | clean |
| type-check / lint | none in this project by design (zero runtime deps, no build step) |

**Mutation evidence — the probe has real diagnostic power, it is not merely green:**

- stale check removed from `app.js:526` → probe 1 **fails**, `clipboard writes=1 ["THE PROMPT FOR A"]`
- switch-away made a no-op → probe 1 **fails**, and now says `switch took=false`
- route delay past the settle window → probe 1 **fails**, and now says `response landed=false`

Every number in the report and PR body was re-derived per file rather than taken on trust: 83 + 78
= 161 at the time of writing, + 58 = 219 at head. All correct.

## What's good

- The fix chosen (schedule from inside the page) is the right one, is genuinely probe-local, and
  is robust for a better reason than was originally recorded.
- Making the precondition an assertion was the correct read of the defect class — findings 1 and 2
  are that the instinct was applied one statement too early, not that it was wrong.
- `"any of the three false = this probe tested nothing"` tells the next reader how to interpret a
  red without opening the file.
- `public/` and `functions/` untouched throughout. The correction was carried in documents and one
  probe, which is exactly where the defect was.

## Residual — still needs a human

Unchanged: the timed walkthrough through a real Claude session (#8 AC8 — still the number the
ticket exists to produce), real Safari, keyboard-only, a paste into a real email client and ATS
field, and the stale-write guard against a **real system clipboard** under a rejecting item.

## Note on cost

This re-review was run with two parallel deep-review agents for a 45-line probe change plus two
markdown edits — disproportionate to the surface, and worth scoping to a single focused pass next
time. The findings were real; the spend to get them was not proportionate.
