# Implementation Report — Day-before mode + the one reminder email

**Plan**: `.claude/plans/day-before-mode-and-reminder.md`   **Branch**: `feature/day-before-mode-and-reminder`   **Status**: COMPLETE

## Summary

The compressed day-before experience (#25): when the interview is tomorrow or today, the session
becomes a run-through — LogisticsRail + DayBeforeMode prime, a confidence rep opening on the
candidate's strongest covered competency, the close suggested at 3 turns instead of 6, and no
"queued for next time" in the close. Alongside it, decision 17's single reminder email
("Your interview is tomorrow"), triggered by a lazy sweep in the portal middleware, made
exactly-once by an atomic claim on a new nullable `invite.reminder_sent_at` column, with
`scripts/remind.py` as the zero-traffic-day assurance poke.

## Tasks completed

- Engine: `DAY_BEFORE_CLOSE_TURNS`, `isDayBefore`, `confidenceQuestion` → `src/prep/targeting.js` (UPDATE)
- Engine tests: truth table, pin, confidence-rep selection/fallback/revealed-exclusion → `test/prep-targeting.test.js` (UPDATE)
- Session GET: derives `day_before`, confidence rep first on a fresh day-before session, switched close threshold, `day_before` + `day_before_focus` in the response literal → `functions/prep/api/session.js` (UPDATE)
- Turn route: same derived flag switches `suggest_close` → `functions/prep/api/turn.js` (UPDATE)
- Drill UI: day-before prime branch (LogisticsRail first, DayBeforeMode client-built, no PrimerCard/progress/habits), shortened close, `COPY.dayBeforeIntro/-Note` → `public/prep/session.js` (UPDATE)
- UI tests: day-before group (prime order, focus labels, at(1)/at(7) shorter pair, no queued close, day-of in / at(2) out) → `test/prep-session-ui.test.js` (UPDATE)
- Migration: nullable `reminder_sent_at` on `invite` → `migrations/0006_reminder.sql` (CREATE)
- Store: `dueReminders` (id+email only), `claimReminder` (atomic, `meta.changes`) → `src/portal/store.js` (UPDATE)
- Email: `sendReminderEmail`, two-emails note amended to three → `src/prep/email.js` (UPDATE)
- Sweep: `sendDueReminders` — bail-before-claim, claim-then-send, at-most-once → `src/prep/reminders.js` (CREATE)
- Middleware: sweep beside the purge, purge first, both fail-open → `functions/prep/_middleware.js` (UPDATE)
- Poke script + `remind:remote` alias → `scripts/remind.py` (CREATE), `package.json` (UPDATE)
- Sweep tests on real sqlite-d1 → `test/prep-reminders.test.js` (CREATE)
- Email tests: reminder group → `test/prep-email.test.js` (UPDATE)
- Docs: trigger story, limitation, at-most-once posture, assurance query → `DEPLOY.md` §5b (UPDATE)
- Schema lock: `reminder_sent_at` added to the invite column list with the reason stated → `test/schema.test.js` (UPDATE)

## Tests added

- `test/prep-targeting.test.js` — 6 new: `isDayBefore` truth table (−1/0/1/2/3), `DAY_BEFORE_CLOSE_TURNS` pinned at 3 and `< SUGGEST_CLOSE_TURNS`, confidence rep picks highest-readiness-with-success, serves least-recently-attempted within it, null with no success, ignores revealed "successes". All pass.
- `test/prep-session-ui.test.js` — 5 new: prime order (LogisticsRail before DayBeforeMode, no PrimerCard/ProgressStrip), focus in rank order, the at(1)/at(7) provably-shorter pair at 3 turns, no "queued for next time" in the day-before close, day-of gets the branch / at(2) does not. All pass; the existing no-rank and COPY-completeness sweeps cover the new strings automatically.
- `test/prep-reminders.test.js` — 8 new (real sqlite-d1, stubbed fetch): sends exactly once across two sweeps; due window strictly `days === 1`; claim race one winner; failed send claims anyway (at-most-once pinned); unconfigured bails before claiming (missing key / missing base / non-https base); never-opened invite gets the one reminder and the next day nothing; `dueReminders` selects id+email only; tone gate (no `!`, no streak, exact subject).
- `test/prep-email.test.js` — 6 new for `sendReminderEmail`: endpoint + bearer + exact subject; link bare in text and anchored in html; no token-shaped `t=` anywhere; agency name via `mailFrom` with fallback; missing-key guard makes zero fetch calls; tone in both halves.

## Validation results

- `npm test` under Node 24.11.0: **706 pass, 0 fail, 0 skipped**
- `npm test` under Node 20.20.2: **574 pass, 0 fail, 132 skipped** (graceful node:sqlite skip, as designed)
- `npm run db:local`: migration `0006_reminder.sql` applies cleanly through wrangler
- `python3 scripts/remind.py https://example.invalid`: exits 1 with a clear unreachable message
- Source-scan gates (no-injection, browser-storage, CSS discipline, no-rank sweep) run inside the suite and pass over the changed files.

## Deviations from the plan

- **`day_before_focus` is a second response key, not a reorder of `competencies`.** The plan
  anticipated this: the route's `competencies` array is store order (`ORDER BY id`), not rank
  order, so per the plan's own instruction the focus labels are projected server-side in rank
  order — as an explicit `day_before_focus` key in the hand-written literal (empty array outside
  day-before), rather than by reordering `competencies`, whose order the prime's covered-list
  already depends on.
- **`test/schema.test.js` updated** (not in the plan's task list): the file locks every table's
  exact column list, so adding `reminder_sent_at` required amending the lock in the same PR —
  which is exactly what that test's failure message instructs.
- **No `remind:preview` alias**: the plan made it conditional on a preview URL variable existing
  in package.json; none does, so only `remind:remote` (reads `PREP_BASE_URL`) was added.
- **No day-before close-heading COPY variant**: the plan offered one "if the copy needs it"; the
  existing `closeImproved`/`closeHonest` strings read correctly for a run-through, so none was added.

## Issues encountered

None beyond the schema-lock failure noted above, which was the intended behaviour of that gate.
Manual browser validation against a preview deploy (day-before prime rendering, one real
reminder landing via Resend) remains for the operator — everything automatable is green.
