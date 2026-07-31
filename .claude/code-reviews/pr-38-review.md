# Review — PR #38: day-before mode + the one reminder email

Agentic review (fresh-context reviewer agent over the full changed files, plan, and implementation report), validation run locally. The report's documented deviations (`day_before_focus` as a second key, the schema-lock amendment, no `remind:preview` alias, at-most-once posture, no close-heading COPY variant) were treated as intentional decisions and are not flagged.

## Summary

Solid PR. The claim-then-send reminder path is genuinely atomic and race-tested on real sqlite-d1, the day-before derivation agrees between the JS (UTC-calendar `daysToInterview`) and SQL (`date('now','+1 day')`) sides, the reminder email carries no token and reuses the injection-hardened header path, and the "provably shorter" close is asserted through the real routes. No critical or high issues. Four mediums — two are one-line comment/reorder fixes, one is a coverage-shape note, one is a product-granularity question worth an explicit call.

## Issues

### Critical — none

### High — none

### Medium

1. **`src/portal/store.js:634` — `dueReminders`' doc comment claims an index it doesn't use.** It says the comparison "rides `invite_by_interview`", but `date(interview_at) = date('now','+1 day')` wraps the indexed column; `EXPLAIN QUERY PLAN` shows `SCAN invite`. Performance is fine at invite scale — but `purgeExpired` (store.js:37–41) documents the identical pattern as a *deliberate* index-defeating scan. Fix: correct the comment to match purge's honest framing.

2. **`src/prep/reminders.js:42` — `getAgency` runs on every portal request even when nothing is due.** The sweep fires on every `/prep/*` hit (static assets included), so the steady-state no-op path pays two awaited D1 round-trips before `next()`. Fetching `dueReminders` first and calling `getAgency` only when `due.length > 0` halves that with a three-line reorder.

3. **Undocumented deviation: no direct turn-route test for the day-before close threshold.** The plan's task list and Testing Strategy call for extending `test/prep-turn.test.js` (threshold switch with `interviewAt: at(1)` seeding); the file is unchanged and the omission isn't in the report's Deviations section. Behaviour at `functions/prep/api/turn.js:229` *is* exercised indirectly by the UI test's at(1)/at(7) pair through the real `turnRoute`, so this is a coverage-shape gap, not a hole — add the test or record the deviation.

4. **Decision 17 is enforced per-invite, not per-candidate.** `POST /api/prep/send` creates a fresh invite row on every send with no dedupe by email, and the sweep emails every unreminded due row — so a recruiter re-sending a "lost" invite produces two "Your interview is tomorrow" emails to the same candidate on the same evening. Either dedupe the due set by email in `dueReminders`, or document per-invite as the accepted granularity in DEPLOY.md §5b.

### Low

1. **`functions/prep/_middleware.js:22` — the sweep blocks the triggering request.** The purge must be awaited (an expired invite must not serve once more) and must precede the sweep (an expired invite must not be reminded), but the response has no ordering dependency on the *sends* — `context.waitUntil(...)` after the awaited purge would keep the unlucky first visitor's request fast on a morning with N due reminders.

2. **An invite created on the day-before day is immediately due**, so the candidate gets the invite email and the reminder back to back. Harmless under decision 17; skipping rows with `date(sent_at) = date('now')` would read better.

3. **`test/prep-reminders.test.js` seeds with JS `Date.now()` but the window uses SQLite `date('now')`** — a sub-second midnight-UTC crossing can flake once in a very long while. Noted so a future 00:00 CI failure isn't chased as a real bug.

## Validation

| Check | Result |
|---|---|
| `npm test` (Node 20) | **706 tests: 574 pass, 0 fail, 132 graceful node:sqlite skips** |
| `npm test` (Node 24, per report) | 706 pass, 0 fail |
| Migration `0006_reminder.sql` | applies cleanly via `npm run db:local` (per report) |
| Source-scan gates (no-injection, browser-storage, CSS, no-rank) | pass inside the suite |
| Manual browser pass + one real Resend send | pending operator, as noted in the PR |

## Done well

- **The claim is the textbook version of the codebase's own `openInvite` pattern** — `UPDATE … WHERE reminder_sent_at IS NULL` branching on `meta.changes`, race-tested, failure-tested, and never-again-tested on real sqlite-d1, with the at-most-once posture pinned as behaviour rather than a comment.
- **Bail-before-claim** (`src/prep/reminders.js:37-40`) means a half-configured deployment can't burn an invite's single reminder on a send that could never happen — all three bail causes tested with `reminder_sent_at` asserted NULL.
- **Email discipline held on the third builder**: injection-hardened `mailFrom` reused, `escapeHtml` everywhere, no token structurally asserted, and `dueReminders` projection locked to id+email by test.
- **Day-before is derived, never stored**, from the same route `now` the spacing already reads — and the at(1)/at(7) fixture pair makes "provably shorter" a real end-to-end assertion.

## Recommendation

**Approve.** Nothing blocking; validation is green and the implementation matches the plan plus its documented deviations. The four mediums are small and well-scoped — good candidates for a fast follow-up (`piv-fix-review-findings` on this file), with #4 being the one that deserves an explicit product decision rather than a silent default.

— Note: this repo has no `.claude/agents/code-reviewer.md` and no project `CLAUDE.md`; the review used a fresh-context general-purpose agent against the plan, report, and architecture docs.
