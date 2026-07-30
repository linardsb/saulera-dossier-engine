# Code Review — PR #32 · round 2 verification, completed

## Recommendation: **approve** — 0 Critical · 0 High · 1 Medium · 3 Low

**Branch** `feature/send-to-candidate` → `main` · **head** `7235d68` (matches the PR head exactly; reviewed in
place) · 40 files, +7,306 / −131. Round 1 (posted 30 Jul, head `4e40674`) found **6 High · 10 Medium · 6 Low**
and requested changes. `7235d68` is the fix commit — +1,661 / −110 across 24 files, itself unreviewed code
until now. A partial round-2 draft exists at `.claude/code-reviews/pr-32-review-round2.md`; it was abandoned
mid-write and never posted. This review supersedes it and was produced fresh: the fixes were **mutation-tested,
not read**, and the fix commit was reviewed as new code by an independent context.

> Posted as a comment: GitHub refuses both `--approve` and `--request-changes` from the PR author's own account.

---

## Validation — re-run on this head, not quoted

| Level | Command | Result | PR body claims |
|---|---|---|---|
| 2 | `npm test` (Node 24.11.0) | **577 tests · 577 pass · 0 fail · 0 skipped** | 548 — **stale** (see M1) |
| 2 | `npm test` (Node 20.20.2, machine default) | 577 · 505 pass · **0 fail** · 72 skipped | 548 / 53 skipped — **stale** |
| 5 | `node .claude/probes/one-screen.mjs` (Node 24) | **34/34 probes pass** | 27/27 — **stale** |
| 1 | every Level 1 gate from the plan | **all `ok`** | ✅ |
| — | vs baseline `fd1e0b4` (464 tests) | **+113 new tests** | "+84" — stale |

The fix commit's own numbers (577 · 34/34 · +113) are the correct ones; they never reached the PR body.

A note on the abandoned round-2 draft: it reported the R1 route-split gate failing. **Not reproduced.** Both R1
gates pass as written from the repo root, and the gate is falsifiable — the identical grep pointed at
`functions/api/` fires on both new routes. The invariant is intact by direct inspection: `functions/prep/`
holds only session-guarded candidate routes and auth; the likely cause of the draft's failure was environment
(an aliased `ls`, or wrong cwd), not the repo.

## The six High findings — all VERIFIED-FIXED by mutation

Each fix was reverted in place and the suite re-run; every mutation killed at least one test. Tree restored
clean afterwards.

| Round 1 | Fix | Dies under mutation |
|---|---|---|
| H1 dup competency ids → `500 internal` | `assertBrief` rejects duplicates (`src/prep/schema.js:249`) | `prep-schema.test.js:124` + route-level `prep-send.test.js:283` (400 `bad_brief`, all 7 tables at 0) |
| H2 unguarded/untested rollback | `rollbackInvite()` guards the DELETE (`functions/api/prep/send.js:151-158`); both call sites reach `throw err` | `prep-send.test.js:660-719` — incl. a faulty-D1 test driving the previously-untested `persistHandover` path, asserting 507 survives and every portal table ends at 0 |
| H3 visibility gate untestable (empty seed note) | `SEED_CLIENT_WITH_NOTE` + ticked/unticked assertions (`test/helpers/sqlite-d1.js:49-72`, `prep-send.test.js:215,234`) | both round-1 mutations (`String(client.note)`, `listVisibleKeys→[]`) now fail |
| H4 `resetToInputs` never bumped `reqId` | `state.reqId += 1` first line (`public/app.js:489`) | probe 28 (mid-flight Start again; 33/34 without the fix) |
| H5 date edits silently discarded | edit drops the prepared preview (`interviewDateChanged` → `dropPreparedSend`) | probe 29 (preview closes; "Send it" posts 0 sends) |
| H6 no upper bound on `interview_at` | `isWithinHorizon` / `MAX_MONTHS_AHEAD = 24` in both routes + `max` on the input | `prep-dates.test.js:121` (exact boundary day), `prep-send.test.js:452`, `prep-prepare.test.js`, probe 30 |

## The Medium/Low findings — 14 of 16 FIXED, 2 deferred behind open issues

M1–M7, M9, M10 and L1–L6 are all present, correct, and carry falsifiable tests — spot-mutations on M1
(idempotence guard now shape-based; the `failed_field_key: null` forgery demotes), M4 (importance
integer-clamped, `typeof()`-asserted against real SQL) and L3 (magic link built **only** from `PREP_BASE_URL`;
unset → `503 no_base_url` **before** any mint or write, all tables asserted empty) each killed their test.
M8 (Node 20 false pass) is **issue #33, OPEN** — owner's call, a workflow decision. R7's inflated
`invite_sent` residual is **issue #34, OPEN**. Both deferrals are real, not rhetorical.

## The fix commit as new code

An independent review of `7235d68` itself found **no Critical, High or Medium** issues. The areas given special
scrutiny hold: the `sameOrigin` guard cannot wrongly 403 a legitimate deployment (no-header curl passes by
design, Access-fronted browser traffic is same-origin); the 24-month bound is correct at the boundary
(`setUTCMonth(+24)` cannot overflow, and the boundary day is pinned both ways); the reqId/preview-invalidation
state logic is sound and every in-flight handler is `mine()`-guarded; no new test is a tautology — several pin
the counter-case (same-origin 201 beside cross-site 403, leap day accepted beside Feb 31 refused).

---

## Findings

### Medium — 1

**M1 · The PR body and the implementation report still carry pre-fix numbers.** The body says 548 tests /
495 pass on Node 20 / 27/27 probes / +84 new tests; reality at this head is **577 / 505 / 34/34 / +113**.
`.claude/reports/send-to-candidate-report.md` was last touched at `4e40674` and still describes probes 18–27.
The PR body is the record a future reader trusts about what was merged — the repo's own standard is that a
stale claim gets corrected, and every number in it is currently checkable and wrong. *Fix:* update the body's
validation table and add a line noting the fix commit; refresh or addend the report.

### Low — 3

- **Browser and server disagree about the date horizon by up to a day.** `maxLocal()` (`public/app.js`) uses
  the local calendar +2 years; the server compares UTC +24 months. A recruiter east of UTC picking the exact
  max the picker allows can get a server `interview_too_far` the browser said was fine — handled gracefully by
  dedicated copy, so cosmetic. (Also: `maxLocal()` computed on Feb 29 yields an invalid `max` for a non-leap
  target year; browsers ignore an invalid max, server still enforces.)
- **The new `503 no_base_url` has no UI copy.** `sendMessageFor` names `missing_fields`, `bad_brief` and
  `interview_too_far`, but this commit's own new reachable status falls through to the generic "Could not
  send…" — a misconfigured deployment reads as a transient failure to the recruiter. DEPLOY.md's triage row
  covers the operator; one string would cover the recruiter.
- **One overclaiming test comment**: `test/prep-generate.test.js` says the preserved error message reaches
  "the recruiter's screen"; `errorResponse` returns `{error: code}` only — the message reaches logs and tests.
  The assertion is meaningful; the prose is wrong about where the message goes.

Pre-existing, noted not counted: DEPLOY.md's door table omits `/prep/api/delete` (from `2cdcf57`, before this PR).

---

## What's genuinely good

- **"Each fix carries a test that DIES when the fix is reverted" is true.** Every mutation tried — nine of
  them, across both agents — killed at least one test or probe. Round 1's most damaging findings were tests
  that could not fail; that class is closed, including the four unfalsifiable proofs the review led with.
- **`rollbackInvite` is the right pattern**: the second failure is logged and never allowed to mask the first,
  and the orphan trade-off is *tested* (`prep-send.test.js:698` asserts the orphan row remains and the log
  fires), not just commented.
- **L3 got the good version of the fix**: no fallback to `request.url` at all, validation of the variable's
  shape, the 503 thrown as the last gate before anything is minted or written — so an unset variable costs
  nothing and the send is safe to retry. DEPLOY.md carries the requirement and the triage row.
- **File headers were updated honestly** where the fix changed an invariant — `generate.js`'s "only call site"
  rule now names the sanctioned second; no header left stating something the code no longer does.
- **The credential-leak gate that cried wolf was fixed**, not silenced — a `sed` strips the `path:line:` prefix
  so the filename can no longer trip its own grep.

## Before merging — unchanged from the PR's own list

Both remain right and remain outstanding: **one live Resend send read in a plain-text client** (`.dev.vars`
has no `RESEND_API_KEY`; the transport is stubbed by design in every test), and the **real-browser
Safari/Chrome sweep** for tab order, focus and keyboard operation of the preview checkboxes. Neither blocks
approval of the code; both block the pilot.

## Summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 1 (stale PR body / report) |
| Low | 3 |

Validation all green (577/577 · 34/34 · gates `ok` · Node 20 0-fail). Round 1's twenty-two findings: 20 fixed
with falsifiable tests, 2 deferred behind open issues #33/#34. **This is a merge** — update the PR body's
numbers on the way in, do the live Resend send before the pilot.
