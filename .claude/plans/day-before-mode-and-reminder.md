# Feature: Day-before mode + the one reminder email

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

## Feature Description

The compressed "it's tomorrow" experience for the candidate prep portal. When the interview is
tomorrow (or today), the session becomes a short run-through instead of a full drill: the prime
opens with the `DayBeforeMode` block and the `LogisticsRail` up front, the first rep is a
**confidence rep** (a question on the candidate's strongest covered competency, so the session opens
on solid ground), targeting stays top-ranked-only (the ≤3-day spacing row that already exists in the
engine), the close is suggested after fewer turns, and the close itself is shortened (no "queued for
next time" — there is no next time).

Alongside it, the **single reminder email** of architecture decision 17: "your interview is tomorrow
— your day-before session is ready", sent **exactly once per invite**. Cloudflare Pages has no cron,
so the trigger is a lazy sweep on portal traffic (the same pattern as the retention purge in
`functions/prep/_middleware.js`), with a manual "poke" script as the assurance path for days with no
portal traffic at all. No other nudge exists, ever.

## User Story

As a candidate whose interview is tomorrow
I want a short, calm run-through of what I already have — plus the practical details — and one
reminder that it exists
So that I walk in tomorrow with coverage and composure, not a guilt-driven cram session.

## Problem Statement

The session engine (#23) and drill UI (#24) always run the full 10–15-minute session regardless of
how close the interview is. The SPEC's Spacing table (SPEC.md:152) says at 1–3 days "coverage beats
depth; drill only the top-ranked competencies" — the *targeting* half of that already exists in
`eligible()` (targeting.js:77–92), but nothing changes the session's *shape*: same close threshold,
same prime, same close payload, no logistics surfaced, and the `DayBeforeMode` block built in #21
sits dormant (registry.js:494–499 explicitly hands #25 the "WHEN this appears" decision). And
decision 17's one permitted reminder has no trigger mechanism at all.

## Solution Statement

Derive day-before entirely — no stored mode, no schema change to the session. `daysToInterview()`
(targeting.js:47–52) already computes whole-UTC days; day-before is `days === 0 || days === 1`.
Project one boolean, `day_before`, from the session GET route to the browser; the UI's existing
`load()` routing fork (session.js:249–257) grows one branch that composes `DayBeforeMode` +
`LogisticsRail` into the prime and shortens the close. The engine adds a `DAY_BEFORE_CLOSE_TURNS`
constant (following the exported-pinned-constant convention) and a confidence-rep pick for the
session's first turn.

The reminder rides the existing lazy-trigger precedent: `_middleware.js` already runs
`purgeExpired` on every `/prep/*` request; a `sendDueReminders` sweep runs beside it. Idempotency is
the codebase's own claim-UPDATE pattern (`openInvite`, store.js:313–327): a new nullable
`invite.reminder_sent_at` column, claimed atomically with
`UPDATE ... WHERE reminder_sent_at IS NULL` and mailed only when `meta.changes === 1`. The claim is
**at-most-once by design** — no rollback on send failure, because decision 17's "exactly one"
outranks delivery guarantees (a rollback+retry could double-send if Resend accepted but the response
read failed). The manual fallback is a poke script: one HTTP GET at the deployment triggers the same
middleware sweep — one code path, zero duplication.

## Out of Scope / Non-Goals

- **No other nudge, ever** (decision 17). No follow-up if the reminder is unopened, no day-of email,
  no streaks. A candidate who never opens anything gets exactly this one email and nothing more.
- **No stored session mode.** Sessions remain a pure projection of the attempt log
  (`sessionsOf`, 30-minute gap). Day-before is derived per-request.
- **No recruiter-visible reminder telemetry.** `sent_at`/`opened_at` stay the entire recruiter
  surface (decision 3). No new `events.kind`, no reminder count on the dashboard.
- **No cron.** Pages has none; we document the lazy-trigger limitation like the purge does
  (DEPLOY.md:265). Not building a Worker/Queue for this.
- **No tokenized link in the reminder.** The reminder links to the portal entry page; returning
  candidates sign in via the existing email-OTP flow (#20). No new magic-link minting.
- **Not changing** normal-mode targeting, the answer loop, the help ladder, or `closePayload`'s
  shape for normal sessions.
- **No timezone modelling.** "Tomorrow" is UTC-calendar, same as `daysToInterview` everywhere else
  (targeting.js:55–57 documents the approximation). Documented, not solved.

## Feature Metadata

**Feature Type**: New Capability (composed from existing seams)
**Estimated Complexity**: Medium
**Primary Systems Affected**: session engine (`src/prep/targeting.js`), both session routes, drill
UI (`public/prep/session.js`), email seam (`src/prep/email.js`), portal store, portal middleware,
migrations, scripts
**Dependencies**: none new — Resend via existing `sendEmail`, D1 via existing store conventions

## Related Work

**Implements**: [#25 — Day-before mode + the one reminder email](https://github.com/linardsb/saulera-dossier-engine/issues/25)   ·   **Epic**: #16 / `docs/epics/candidate-portal.architecture.md` (decisions 17, 22 inherited)

**Back-references** (plans this builds on or inherits decisions from):

- `.claude/plans/session-engine-targeting-answer-loop.md` — #23; owns `drillState`, the spacing
  rows, `SUGGEST_CLOSE_TURNS`, and records "#25 (day-before mode reuses targeting + spacing)" as the
  intended seam (line 68). Pinned-constant convention (exported, one-line-changeable, each tested).
- `.claude/plans/drill-ui-session-shell.md` — #24; its Non-Goals (lines 47–48) reserve the
  DayBeforeMode flow, the reminder, and the day-before session for this ticket.
- `.claude/plans/prep-component-registry-and-brief-dashboard.md` — #21; built the dormant
  `DayBeforeMode` and live `LogisticsRail` blocks.
- `.claude/plans/send-to-candidate.md` — #22; `sendInviteEmail`, `mailFrom`, `PREP_BASE_URL`-only
  link origin, the send-order/rollback reasoning this plan deliberately diverges from (see NOTES).
- `.claude/plans/candidate-auth-magic-link-otp.md` — #20; created `src/prep/email.js`, the
  "fake-d1 trap" testing rule.

**Forward-references**: (none yet)

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `src/prep/targeting.js` (whole file, ~300 lines) — Why: THE seam. `daysToInterview` (47–52),
  `cooldownDays` (59–63), `eligible` (77–92, the ≤3-day top-half pool already implements "coverage
  beats depth"), `SESSION_GAP_MINUTES` (170), `sessionsOf` (176–188), `closePayload` (222–252),
  `SUGGEST_CLOSE_TURNS = 6` (255), `drillState` (271–304), `rankCompetencies`/`readiness` (23–39).
- `functions/prep/api/session.js` (lines 55–125) — Why: the GET route whose response literal gains
  `day_before`; header (16–20) insists the response stays a hand-written literal, never a spread.
- `functions/prep/api/turn.js` (lines 49, 179, 210–220) — Why: imports `SUGGEST_CLOSE_TURNS`,
  computes `suggest_close` identically; must switch on day-before the same way.
- `public/prep/session.js` (whole file, 611 lines) — Why: `COPY` (37–80, exported), `load()` routing
  fork (249–257), `renderPrime` (260–301, the PrimerCard filter-by-name trick at 265 to copy for
  LogisticsRail), `closeSession` (572–596), `entry-${entrySeq++}` idPrefix discipline, phase list
  (152).
- `public/prep/registry.js` — Why: `DayBeforeMode` (494–510, props `{intro, focus?, note}`,
  "PROVISIONAL until #25 settles it"), `LogisticsRail` (349–367, props `{when, format, bring,
  note}`), `renderBlocks` (556–636), `SESSION_BLOCK_NAMES` (54–60), `COPY.dayBeforeHead/-Focus`
  (114–115).
- `functions/prep/_middleware.js` (whole file, ~20 lines) — Why: the lazy-trigger precedent to
  extend — awaited, try/caught, fail-open, fires on every `/prep/*` request including static assets
  and unauthenticated traffic (exactly right: the sweep is global, not per-candidate).
- `src/portal/store.js` — Why: `openInvite` (302–327) is the atomic claim-UPDATE template
  (`meta.changes`, "no read-then-write window"); `roleByInviteId` (463–472); house rule "every
  function takes a D1-shaped `db` as its first argument. No HTTP, no Response, no env" (13–15).
- `src/prep/email.js` (whole file) — Why: `sendEmail` signature (29), `mailFrom` (145),
  `sendInviteEmail` as the template for a third builder (178–235), the two-emails-two-rules note
  (109–119) that MUST be amended to cover three, `escapeHtml` (78), inline-styles rationale (94–97).
- `src/prep/dates.js` — Why: `toUtcDate` (33–39) is THE parse — never `Date.parse` a SQLite stamp
  directly (BST drift, lines 5–11); `toSqliteUtc`.
- `migrations/0002_portal.sql` (lines 6–27) — Why: invite table, date-format contract, the
  `invite_by_interview` index the sweep query will use.
- `migrations/0004_otp_attempts.sql` (lines 8–10) — Why: the ALTER TABLE precedent; nullable TEXT
  needs no default.
- `scripts/purge.py` (whole file, short) — Why: the manual-fallback convention — docstring stating
  the no-cron limitation, pinned `WRANGLER` version, env-var naming, npm aliases.
- `functions/api/prep/send.js` (lines 91–104, 285–293, 333) — Why: `baseUrl()` from `PREP_BASE_URL`
  only (never `request.url`), `getAgency(env.DB).catch(() => null)` best-effort agency name.
- `docs/epics/interview-prep/SPEC.md` (lines 146–156 Spacing, 181–189 Tone) — Why: the behaviour
  contract the copy must pass.
- `docs/epics/candidate-portal.architecture.md` (lines 27–53 decisions, esp. 17 and 22) — Why:
  inherited decisions.

### New Files to Create

- `migrations/0006_reminder.sql` — nullable `reminder_sent_at` on `invite`
- `src/prep/reminders.js` — the sweep: query due invites, claim, send (pure-ish; takes `env`)
- `scripts/remind.py` — the poke script (one GET at the deployment; mirrors purge.py's conventions)
- `test/prep-reminders.test.js` — sweep + idempotency on real sqlite-d1

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

No external library docs needed — Resend is already wrapped (`src/prep/email.js`), D1 via existing
store conventions, zero new dependencies. The governing documents are in-repo:

- `docs/epics/interview-prep/SPEC.md#spacing` (line 146) — the 1–3-day row this implements
- `docs/epics/interview-prep/SPEC.md#tone` (line 181) — the no-guilt rules the reminder copy and
  day-before COPY must pass: preparing-never-evaluated, no streaks/daily-goal guilt, never imply the
  tool predicts the outcome
- `docs/epics/candidate-portal.architecture.md` §2 decisions 17 (exactly one reminder) and 22
  (DayBeforeMode/LogisticsRail ship in the pilot vocabulary)
- `DEPLOY.md` §5b (~lines 442–523) — the env-var/secret documentation the reminder section extends;
  line 265 "Pages has no cron" is the limitation-statement precedent

### Patterns to Follow

**Pinned engine constants** (targeting.js:255):
```js
export const SUGGEST_CLOSE_TURNS = 6;
```
Exported, one-line-changeable, each with a test. `DAY_BEFORE_CLOSE_TURNS` follows this exactly.

**Atomic claim (the idempotency template)** — store.js:313–327:
```js
UPDATE invite SET token_hash = ?, status = 'opened', opened_at = COALESCE(opened_at, datetime('now'))
 WHERE token_hash = ? AND datetime('now') <= datetime(expires_at)
```
"Exactly one UPDATE finds the old hash still there, and the loser sees changes === 0. There is no
read-then-write window to lose." The reminder claim is the same move:
`UPDATE invite SET reminder_sent_at = datetime('now') WHERE id = ? AND reminder_sent_at IS NULL`,
send mail only when `meta.changes === 1`.

**Lazy trigger, fail-open** — functions/prep/_middleware.js:10–20:
```js
if (env.DB) {
  try { await purgeExpired(env.DB); }
  catch (err) { console.error("portal purge failed:", err); }
}
return next();
```

**Response stays a hand-written literal** — functions/prep/api/session.js:16–20 header. Add
`day_before` as one explicit key, never a spread.

**Block composition by name-filter** — public/prep/session.js:265 (PrimerCard):
```js
const blocks = (brief?.blocks ?? []).filter((b) => b?.name === "PrimerCard");
```
LogisticsRail into the day-before prime uses the same trick on the already-fetched brief payload.

**COPY discipline** — one `const COPY = {...}` per file, every visible string, en-GB, written for a
first-time candidate, no exclamation marks, no streak language. The session-ui test asserts COPY
completeness (every reachable state has a non-empty string).

**Email builders** — inline `text`/`html` string arrays joined with `\n`, inline styles, `escapeHtml`
for interpolations, `mailFrom(env, agencyName)` for the from header, never log the recipient or
Resend's response body.

**Store functions** — `db` first argument, no env/Response; anything branching on `meta.changes`
must be tested on `sqlite-d1`, never `fake-d1` (the fake returns `{changes: 1}` unconditionally —
the "fake-d1 trap", candidate-auth plan line 713).

---

## IMPLEMENTATION PLAN

### Phase 1: Engine — day-before derivation, confidence rep, close threshold

Pure-module work in `src/prep/targeting.js`. No schema change: day-before is derived from
`interview_at` the routes already load.

### Phase 2: Routes — project `day_before`, switch the close threshold

**Depends on:** Phase 1

Both routes gain the same two-line change: derive day-before from the state, use the day-before
close threshold, and (session GET only) project `day_before` into the response literal.

### Phase 3: Drill UI — the day-before branch

**Depends on:** Phase 2 (needs `day_before` in the GET payload)

`public/prep/session.js`: day-before prime (DayBeforeMode + LogisticsRail up front), shortened
close, COPY additions. Registry blocks are used as-is; no registry change.

### Phase 4: The reminder — migration, sweep, email, middleware, script, docs

**Independent of:** Phases 1–3 (shares only `daysToInterview`'s date discipline; touches disjoint
files). Can be built in parallel with the UI work.

Migration, `sendReminderEmail` builder, `src/prep/reminders.js` sweep, middleware hook,
`scripts/remind.py`, DEPLOY.md.

### Phase 5: Validation

**Depends on:** all above. Full suite + manual pass.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

### UPDATE `src/prep/targeting.js`

- **IMPLEMENT**: three additions, following the file's pinned-constant + pure-function style:
  1. `export const DAY_BEFORE_CLOSE_TURNS = 3;` with a comment tying it to SPEC's "coverage beats
     depth" (half the normal 6 — a day-before session is a run-through, not a drill).
  2. `export function isDayBefore(days) { return days === 0 || days === 1; }` — day-of counts
     (opening the portal interview morning must not start a full session); negative days
     (post-interview drilling, decision 11) do not.
  3. `export function confidenceQuestion({ ranked, questionsBy, attemptsBy })` — the confidence
     rep: among competencies with at least one *successful* attempt (use the existing success
     notion: non-revealed `rating >= 3` — import/reuse `isSuccess` from `./ladder.js` if exported,
     else replicate its exact predicate), pick the one with the HIGHEST readiness (inverting the
     normal least-ready targeting), and within it the least-recently-attempted question
     (`leastRecentlyAttempted` already exists — check its export; session.js route imports it).
     Return `null` when no competency qualifies (no prior success) — caller falls back to normal
     targeting. Do NOT change `drillState`'s selection; the route composes.
- **PATTERN**: targeting.js:255 (pinned constant), targeting.js:23–39 (readiness/ranking),
  targeting.js:135–167 (`nextQuestion`'s tie-breaking style)
- **IMPORTS**: whatever `isSuccess`/`leastRecentlyAttempted` need — verify their current export
  sites before writing (ladder.js:29–34; `leastRecentlyAttempted` is imported by
  functions/prep/api/session.js, find its home)
- **GOTCHA**: `daysToInterview` may be negative; `isDayBefore` must be false for negatives.
  Readiness reads the STORED stage/rate cache (the cache-vs-truth split, targeting.js:7–11) — that
  is correct here; do not replay logs for the pick.
- **VALIDATE**: `node --test test/prep-targeting.test.js`
- **SATISFIES**: AC "day-before session provably shorter and top-competency-only" (the engine half)

### UPDATE `test/prep-targeting.test.js`

- **IMPLEMENT**: extend the spacing group (lines 88–123 test at 2/−2/7/30 days) with:
  `isDayBefore` truth table (−1→false, 0→true, 1→true, 2→false, 3→false — note days 2–3 keep the
  top-half pool via `eligible` but do NOT get day-before UI); `DAY_BEFORE_CLOSE_TURNS < SUGGEST_CLOSE_TURNS`
  pinned; `confidenceQuestion` picks highest-readiness-with-success, returns null with no
  successes, ignores revealed-mode "successes".
- **PATTERN**: prep-targeting.test.js:24–28 (`NOW`/`stamp` helpers), 41–49 (hand-computed fixtures)
- **VALIDATE**: `node --test test/prep-targeting.test.js`
- **SATISFIES**: AC #1 (fixtures prove the shape)

### UPDATE `functions/prep/api/session.js`

- **IMPLEMENT**: derive `const days = daysToInterview(role.interview_at, now)` and
  `const dayBefore = isDayBefore(days)`. When `dayBefore` and the current session has no attempts
  yet (`!current`), try `confidenceQuestion(...)` first and fall back to the existing
  `state.demand` path unchanged. Switch the threshold:
  `const closeTurns = dayBefore ? DAY_BEFORE_CLOSE_TURNS : SUGGEST_CLOSE_TURNS;` used in
  `suggest_close`. Add `day_before: dayBefore` to the response literal (one explicit key).
- **PATTERN**: session.js:100–120 (the response literal), header 16–20 (literal, never spread)
- **IMPORTS**: add `isDayBefore, DAY_BEFORE_CLOSE_TURNS, confidenceQuestion, daysToInterview` to the
  existing targeting import
- **GOTCHA**: `daysToInterview` is already exported and takes `(interviewAt, now)` — pass the
  route's existing `now`, never a fresh `new Date()` elsewhere in the handler.
- **VALIDATE**: `node --test test/prep-session-store.test.js test/prep-session-ui.test.js`
- **SATISFIES**: AC #1 (server projection)

### UPDATE `functions/prep/api/turn.js`

- **IMPLEMENT**: same two lines — derive `dayBefore` from `role.interview_at` + the route's `now`,
  and use `dayBefore ? DAY_BEFORE_CLOSE_TURNS : SUGGEST_CLOSE_TURNS` in its `suggest_close`
  (turn.js:218). Do NOT project `day_before` from this route unless the UI needs it (it doesn't —
  the flag is fixed at session load; a session cannot cross the boundary mid-drill in any way that
  matters).
- **PATTERN**: turn.js:210–220
- **VALIDATE**: `node --test test/prep-turn.test.js`
- **SATISFIES**: AC #1 (shorter provable through the turn loop too)

### UPDATE `public/prep/session.js`

- **IMPLEMENT**: the day-before branch, three pieces:
  1. **COPY additions** (exported COPY, session.js:37–80): `dayBeforeIntro` ("Your interview is
     tomorrow. This is a short run through what you already have — not new practice."),
     `dayBeforeNote` (one practical, calm line), a day-before variant of the close heading if the
     copy needs it. Every string en-GB, no exclamation marks, no streak/guilt language; mirror the
     tone of the fixture specimen at test/fixtures/prep-session-blocks.json:42–52.
  2. **Prime branch**: in `load()`'s routing fork (249–257) and `renderPrime` (260–301): when
     `payload.day_before`, compose into `#prime-blocks`, in order: (a) `LogisticsRail` up front —
     filter the already-fetched brief's blocks for `name === "LogisticsRail"` (same trick as
     PrimerCard at 265) and render it FIRST; if the brief has none, skip silently (the block's own
     empty-value copy handles partial data, but an absent block renders nothing); (b) a
     `DayBeforeMode` block built client-side:
     `{ name: "DayBeforeMode", props: { intro: COPY.dayBeforeIntro, focus: <top competency labels>, note: COPY.dayBeforeNote } }`
     where focus = the first 3 `payload.competencies` labels (the GET route returns them; verify
     ordering — if the route's `competencies` array is not ranked order, project labels in ranked
     order server-side instead and note it in the response literal); (c) the normal PrimerCard
     filter DOES NOT run in day-before (run-through, not re-priming) — but keep habits + `last_close`
     lines out too; the day-before prime is exactly LogisticsRail + DayBeforeMode + the start
     button. Track `state.dayBefore = payload.day_before` on the controller state.
  3. **Shortened close**: in `closeSession()` (572–596): when `state.dayBefore`, render "What
     improved today" (or the honest `closeHonest` line) and the habits-worth-watching section, but
     SKIP the "Queued for next time" section entirely — there is no next time. Keep the phase
     machinery, the `closed` in-flight guard (468), and `entry-${entrySeq++}` idPrefix discipline
     untouched.
- **PATTERN**: session.js:260–301 (renderPrime composition), 265 (filter-by-name), 572–596
  (closeSession), registry.js:494–510 (DayBeforeMode props contract — `intro` and `note` required,
  `focus` optional, pinned by test/prep-registry.test.js:203,211)
- **GOTCHA**: `renderBlocks` needs a fresh `idPrefix` per render (session.js already does
  `entry-${entrySeq++}`); reuse that. Do not touch `public/prep/registry.js` — the blocks render
  from props as-built. If the DayBeforeMode props contract must change, the registry doc comment
  requires amending `test/fixtures/prep-session-blocks.json` — it should NOT need to change.
- **VALIDATE**: `node --test test/prep-session-ui.test.js test/prep-registry.test.js`
- **SATISFIES**: AC #1 (the compressed experience), decision 22

### UPDATE `test/prep-session-ui.test.js`

- **IMPLEMENT**: a day-before group using the existing harness (real routes over sqlite-d1,
  `at(days)` for dates): seed an invite with `interviewAt: at(1)`; assert (a) the prime renders
  LogisticsRail before DayBeforeMode and no PrimerCard; (b) `focus` lists top competency labels;
  (c) after `DAY_BEFORE_CLOSE_TURNS` attempt-turns, `suggest_close` is true (and with `at(7)` it is
  not — the "provably shorter" fixture pair); (d) the close contains no "Queued for next time"
  section; (e) day-of (`at(0)`) also gets the branch; `at(2)` does not; (f) new COPY strings pass
  the existing no-rank sweep and COPY-completeness checks (they run automatically — just ensure the
  new states are reachable in the harness).
- **PATTERN**: prep-session-ui.test.js structure — `shell()`, `bridge()`, `fakeClient`,
  `bootIntercepted`; `at()` from test/helpers/sqlite-d1.js
- **GOTCHA**: test files don't import each other — copy the per-file helpers as the file already
  does. Node < 22.5 must `skip` gracefully (the helper handles it).
- **VALIDATE**: `node --test test/prep-session-ui.test.js`
- **SATISFIES**: AC #1, AC #3 (tone gates run over the new copy)

### CREATE `migrations/0006_reminder.sql`

- **IMPLEMENT**:
  ```sql
  -- #25: the one reminder (architecture decision 17). Nullable set-exactly-once stamp;
  -- the claim is UPDATE ... WHERE reminder_sent_at IS NULL, so this column IS the idempotency.
  ALTER TABLE invite ADD COLUMN reminder_sent_at TEXT;
  ```
- **PATTERN**: migrations/0004_otp_attempts.sql (ALTER precedent); header-comment style of 0002
- **GOTCHA**: nullable TEXT — no default needed (SQLite's NOT-NULL-needs-default trap, 0004:8–10).
  Column cascades away with the invite row; no purge change needed.
- **VALIDATE**: `npm run db:local` then `node --test test/portal-store.test.js` (openMigrated
  applies every migration — any test on sqlite-d1 proves the migration parses)
- **SATISFIES**: AC #2 (the idempotency substrate)

### UPDATE `src/portal/store.js`

- **IMPLEMENT**: two functions, `db` first, no env/Response:
  1. `dueReminders(db)` — invites whose interview is tomorrow (UTC calendar) and unreminded:
     ```sql
     SELECT id, email FROM invite
      WHERE reminder_sent_at IS NULL
        AND date(interview_at) = date('now', '+1 day')
     ```
     (uses the existing `invite_by_interview` index; `date()` parses both the space and 'T' stamp
     forms the schema admits).
  2. `claimReminder(db, inviteId)` — the atomic claim; returns boolean:
     ```sql
     UPDATE invite SET reminder_sent_at = datetime('now')
      WHERE id = ? AND reminder_sent_at IS NULL
     ```
     `return result.meta.changes === 1;`
- **PATTERN**: store.js:302–327 (`openInvite` — the claim comment style is worth mirroring)
- **GOTCHA**: no `status` filter needed — expiry is interview_at+14d so day-before invites are live
  by construction, and deleted invites have no rows. Never SELECT more than id+email (data
  minimisation; the email builder needs nothing else — role_title lives only inside brief_json and
  is deliberately not parsed here).
- **VALIDATE**: `node --test test/prep-reminders.test.js` (written below) — MUST run on sqlite-d1,
  never fake-d1 (`claimReminder` branches on `meta.changes`)
- **SATISFIES**: AC #2

### UPDATE `src/prep/email.js`

- **IMPLEMENT**: `export async function sendReminderEmail(env, { to, agencyName, link } = {})` —
  subject `"Your interview is tomorrow"`; body (text + html halves, same inline style as
  `sendInviteEmail`): one calm paragraph — the interview is tomorrow, the day-before session is
  ready, it is a short run through what they already have; the link as an anchor in html and bare
  text in the text half (the invite-email convention); signed off with the agency name via
  `mailFrom(env, agencyName)`. NO deadline pressure, no "don't forget", no exclamation marks, no
  streak language, never implies the tool predicts the outcome (SPEC Tone, 181–189). **Amend the
  two-emails-two-rules note (email.js:109–119) to cover three emails**: invite = tokenized link;
  OTP = no link ever; reminder = plain portal-entry link, never a token.
- **PATTERN**: email.js:178–235 (`sendInviteEmail`), 145 (`mailFrom`), 78 (`escapeHtml`)
- **GOTCHA**: the reminder link is `${base}/prep/login` (or the portal entry route #20 ships —
  verify the actual login path in `functions/prep/auth/` before hardcoding), NOT a magic link — no
  token exists to send, and minting one would rotate `token_hash` under a live session.
- **VALIDATE**: `node --test test/prep-email.test.js`
- **SATISFIES**: AC #2, AC #3 (copy)

### CREATE `src/prep/reminders.js`

- **IMPLEMENT**: the sweep the middleware calls:
  ```js
  export async function sendDueReminders(env) { ... }
  ```
  Steps: bail silently unless `env.DB && env.RESEND_API_KEY && env.PREP_BASE_URL` (a sweep that
  cannot send must not claim); `getAgency(env.DB).catch(() => null)` for the display name (the
  send.js:333 precedent); `dueReminders(env.DB)`; for each: `claimReminder` first, and ONLY on
  `true` call `sendReminderEmail` inside its own try/catch — a send failure is logged
  (`console.error("reminder send failed:", err)` — status only, NEVER the recipient) and NOT
  rolled back (at-most-once; see NOTES). Process invites sequentially (the due set is tiny; no
  Promise.all races against the claim).
- **PATTERN**: functions/prep/_middleware.js (fail-open posture), send.js:91–104 (`baseUrl` from
  `PREP_BASE_URL` only — reuse or mirror its trailing-slash handling)
- **IMPORTS**: `dueReminders, claimReminder, getAgency` from `../portal/store.js`;
  `sendReminderEmail` from `./email.js`
- **GOTCHA**: this module takes `env` (it orchestrates db + mail + config), unlike store functions —
  that is why it lives in `src/prep/`, not in the store. Two concurrent requests both sweeping: the
  claim makes exactly one winner per invite; the loser's `claimReminder` returns false and it skips.
- **VALIDATE**: `node --test test/prep-reminders.test.js`
- **SATISFIES**: AC #2, AC #4

### UPDATE `functions/prep/_middleware.js`

- **IMPLEMENT**: beside the purge, same shape:
  ```js
  try { await sendDueReminders(env); }
  catch (err) { console.error("reminder sweep failed:", err); }
  ```
  inside the existing `if (env.DB)` guard, after `purgeExpired` (purge first: an expired invite
  must not be reminded — moot for day-before dates, but the ordering costs nothing and reads
  right). Update the file's header comment: the middleware now carries BOTH lazy jobs, both
  fail-open, both backstopped by a script.
- **PATTERN**: the file itself (10–20)
- **GOTCHA**: this fires on every `/prep/*` request including static assets and unauthenticated
  traffic — that is the feature (any portal traffic at all delivers due reminders, including for
  candidates who never signed in). Keep it awaited like the purge.
- **VALIDATE**: `node --test test/portal-purge.test.js test/prep-reminders.test.js`
- **SATISFIES**: AC #2, AC #4 ("trigger on portal request")

### CREATE `scripts/remind.py`

- **IMPLEMENT**: the assurance poke. Docstring stating the limitation exactly as purge.py does:
  Pages has no cron; the reminder sweep runs lazily on portal traffic; on a zero-traffic day nobody
  is swept, so run this on a calendar reminder each morning. The script itself: read the portal
  base URL from `PREP_BASE_URL` (or first argv), make ONE `GET {base}/prep/login` (any `/prep/*`
  route triggers the middleware; login is unauthenticated and cheap), print the HTTP status, exit
  non-zero on failure. Use only the Python stdlib (`urllib.request`) — no dependencies, matching
  the scripts convention. Add npm aliases `"remind:remote"` (and `"remind:preview"` if a preview
  URL var exists — check package.json's purge aliases for the naming) to package.json.
- **PATTERN**: scripts/purge.py (docstring + env-var conventions), package.json purge aliases
- **GOTCHA**: unlike purge.py this is NOT a d1-execute script — the sweep must send mail, which
  only the deployed Function can do (secrets live there). The poke reuses the one code path instead
  of reimplementing claim+send in Python. It cannot print a count (the middleware is silent by
  design); the docstring says so — the operator's assurance is the claim column, checkable with
  `npx wrangler d1 execute ... --command "SELECT count(*) FROM invite WHERE reminder_sent_at IS NOT NULL"`
  (include that line in the docstring).
- **VALIDATE**: `python3 scripts/remind.py https://example.invalid` exits non-zero with a clear
  message (offline check); full check is the manual validation level.
- **SATISFIES**: AC #4 ("manual script fallback for candidates who never return, documented
  limitation")

### CREATE `test/prep-reminders.test.js`

- **IMPLEMENT**: on real sqlite-d1 (`openMigrated`, `d1Shape`, `at`, `skip`), fetch stubbed with
  the `withFetch` recorder pattern from prep-email.test.js:
  1. **Sends exactly once**: seed an invite with `interviewAt: at(1)`; run `sendDueReminders(env)`
     twice → exactly ONE Resend call; `reminder_sent_at` set.
  2. **Due-window correctness**: invites at `at(0)`, `at(2)`, `at(-1)` → zero sends (only `at(1)`
     is "tomorrow").
  3. **Claim race**: two interleaved sweeps over one due invite (call `claimReminder` directly from
     both "sides") → one true, one false.
  4. **Send failure claims anyway**: Resend responds 500 → `reminder_sent_at` still set, no throw
     escapes, exactly one fetch attempt across two sweeps (at-most-once pinned as behaviour).
  5. **Unconfigured**: no `RESEND_API_KEY` → zero fetch calls AND zero claims (`reminder_sent_at`
     stays NULL — the bail-before-claim guard).
  6. **No further email, ever**: after the reminder is sent, a sweep on the same invite the next
     day (interview now `at(0)`) sends nothing — decision 17 pinned. Also: an invite that was never
     opened (`opened_at IS NULL`) still gets the one reminder and nothing else.
  7. **Copy tone**: capture the sent body; assert no `!`, no "streak", subject exact.
- **PATTERN**: test/prep-send.test.js (route-level env shape `{ DB, RESEND_API_KEY, PREP_BASE_URL }`),
  test/prep-email.test.js:24–36 (`withFetch`), test/helpers/sqlite-d1.js (`at`, seeds)
- **GOTCHA**: `dueReminders`' SQL uses `date('now','+1 day')` — SQLite's own clock, which in tests
  is real UTC now; seed with `at(1)` (also relative to now) so they agree. Do not try to inject
  `now` into the SQL.
- **VALIDATE**: `node --test test/prep-reminders.test.js`
- **SATISFIES**: AC #2, AC #4 — the idempotency acceptance is proven here

### UPDATE `test/prep-email.test.js`

- **IMPLEMENT**: a `sendReminderEmail` group mirroring the invite-email tests: endpoint + bearer
  asserted; subject "Your interview is tomorrow"; link present as bare text in the text half and
  anchor in html; NO token-shaped query param (`t=`) anywhere; agency name flows through `mailFrom`;
  missing-key guard makes zero fetch calls; no exclamation mark in either half.
- **PATTERN**: the file's existing invite/OTP groups
- **VALIDATE**: `node --test test/prep-email.test.js`
- **SATISFIES**: AC #2, AC #3

### UPDATE `DEPLOY.md`

- **IMPLEMENT**: in §5b (or beside the purge documentation at ~line 265): the reminder's trigger
  story — lazy sweep on portal traffic, `scripts/remind.py` as the calendar-reminder assurance
  path, the documented limitation (a candidate is only reminded if ANY portal traffic occurs on the
  day before their interview, or the operator runs the poke), the at-most-once posture (a Resend
  outage during the one attempt means that reminder is skipped, not retried — deliberate, decision
  17), and the assurance query from the remind.py docstring. Add any new npm aliases to the
  commands table.
- **PATTERN**: DEPLOY.md's existing purge + triage-table sections (~420–440)
- **VALIDATE**: reread against `scripts/remind.py`'s docstring — the two must agree
- **SATISFIES**: AC #4 ("documented limitation")

---

## TESTING STRATEGY

### Unit Tests

- `test/prep-targeting.test.js` — `isDayBefore` truth table, `DAY_BEFORE_CLOSE_TURNS` pin,
  `confidenceQuestion` selection/fallback/revealed-exclusion, all with the file's explicit-`NOW`
  fixture style.
- `test/prep-email.test.js` — `sendReminderEmail` content, link discipline, tone absences,
  unconfigured guard.

### Integration Tests

- `test/prep-reminders.test.js` — the sweep end-to-end on real sqlite-d1 with stubbed fetch: exactly
  once, due window, claim race, at-most-once on failure, bail-before-claim, never-again.
- `test/prep-session-ui.test.js` — the day-before session through the real routes: `at(1)` vs
  `at(7)` fixture pair proving shorter (`suggest_close` at 3 vs 6) and top-competency-only focus;
  prime composition order; shortened close; day-of inclusion; `at(2)` exclusion.
- `test/prep-turn.test.js` — `suggest_close` threshold switches with `interviewAt: at(1)` seeding.

### Edge Cases

- `interview_at` in the past (negative days) → normal mode, no reminder.
- Day-of (`days === 0`) → day-before UI, but NO reminder (the email is strictly "tomorrow").
- Brief with no LogisticsRail block → day-before prime renders DayBeforeMode alone.
- No competency with a prior success → `confidenceQuestion` null, normal targeting serves.
- Two concurrent portal requests during the sweep → one send (claim race).
- Resend 500 on the one attempt → claimed, skipped, logged status-only.
- `RESEND_API_KEY`/`PREP_BASE_URL` unset (local dev) → sweep bails, no claim, portal serves fine.
- Candidate who never opened the invite → gets the one reminder, then nothing ever again.
- ISO-'T' `interview_at` form → `date()` in the sweep SQL and `toUtcDate` in the engine both parse.

---

## VALIDATION COMMANDS

Execute every command to ensure zero regressions and 100% feature correctness.

### Level 1: Syntax & Style

No lint/typecheck scripts exist in this repo. The source-scan gates live INSIDE the test suite
(no-injection, browser-storage, CSS discipline, positive-tabindex over every `public/prep/` file —
new files are swept automatically).

### Level 2: Unit Tests

```bash
node --test test/prep-targeting.test.js test/prep-email.test.js
```

### Level 3: Integration Tests

```bash
node --test test/prep-reminders.test.js test/prep-session-ui.test.js test/prep-turn.test.js test/prep-registry.test.js
npm test   # the full suite — must be green on Node >= 22.5
```

### Level 4: Manual Validation

```bash
npm run db:local                          # migration 0006 applies cleanly
python3 scripts/remind.py <preview-url>   # poke returns 200 against a preview deploy
```
Then in a browser against local/preview: seed an invite with interview_at tomorrow, open the portal
→ day-before prime shows LogisticsRail then DayBeforeMode, three attempt-turns surface the close
button, the close has no "queued" section. Check the reminder landed once (Resend dashboard or the
assurance query) and that re-poking sends nothing.

### Level 5: Additional Validation (Optional)

`.claude/verify-deploy.sh` if deploying; dossier-design `references/CHECKLIST.md` pass over the new
UI states before commit (house rule).

---

## ACCEPTANCE CRITERIA

From the ticket, made concrete:

- [ ] **Provably shorter + top-competency-only on fixtures**: `at(1)` vs `at(7)` seed pair —
      `suggest_close` true at `DAY_BEFORE_CLOSE_TURNS` (3) vs `SUGGEST_CLOSE_TURNS` (6); `focus`
      lists only top-ranked labels; `eligible`'s top-half pool governs targeting (already true at
      ≤3 days — pinned by test, not reimplemented).
- [ ] **Email sends exactly once (idempotency tested)**: double-sweep test, claim-race test,
      at-most-once-on-failure test, all on real sqlite-d1.
- [ ] **Copy passes the no-guilt tone rules**: no exclamation marks, no streak/guilt language, no
      outcome prediction — asserted for the email body; the UI's new COPY passes the existing
      no-rank and completeness sweeps.
- [ ] **A candidate who never opens gets no further email**: never-opened invite receives the one
      reminder and nothing after; next-day sweep sends nothing (test 6 in prep-reminders).
- [ ] LogisticsRail renders up front in the day-before prime; DayBeforeMode props honour the pinned
      contract (`intro`, `note` required, `focus` optional) — no registry or fixture change.
- [ ] Full suite green (`npm test`) on Node 20 and 24 paths (sqlite tests skip gracefully below
      22.5); no regressions.
- [ ] DEPLOY.md documents the trigger, the poke script, and the limitation.

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] All validation commands executed successfully
- [ ] Full test suite passes
- [ ] Manual testing confirms the day-before flow and single reminder
- [ ] Acceptance criteria all met
- [ ] Code reviewed for quality and maintainability

---

## OPEN QUESTIONS / ASSUMPTIONS

Assumptions this plan makes (each is a defensible default; flag on review if any should change):

1. **"Confidence rep" is defined here, not inherited** — the term appears nowhere in code, SPEC, or
   prior plans. Chosen reading: the day-before session's FIRST rep targets the candidate's
   strongest competency that has at least one prior success (highest readiness), so the session
   opens on solid ground; everything after uses normal ≤3-day targeting. If the owner meant
   something else (e.g. a rep with no rating recorded), the seam (`confidenceQuestion`, composed in
   the route) localises the change.
2. **Day-of counts as day-before** (`days === 0 || days === 1`) for the SESSION shape; the EMAIL
   fires strictly at `days === 1`. Opening the portal interview morning should not start a full
   drill.
3. **At-most-once, not at-least-once**: a send failure after the claim is logged and never retried.
   Decision 17's "exactly one reminder" outranks delivery — a rollback-and-retry could double-send
   when Resend accepted but the response read failed. Diverges knowingly from #22's
   rollback-on-throw (there, the invite email IS the product; here, the reminder is a courtesy).
4. **The reminder links to the portal entry page, not a magic link** — no token exists to send
   (only its hash is stored), and minting one would rotate `token_hash` under a live session.
   Returning candidates use the OTP flow (#20). Verify the exact login path before hardcoding.
5. **"Tomorrow" is UTC-calendar** (`date('now','+1 day')` / `daysToInterview === 1`), consistent
   with the engine's existing approximation (targeting.js:55–57). A UK candidate around midnight
   BST may be off by one; documented, not solved (the pilot is UK-only; UTC vs BST skews by one
   hour, not one day, for any interview_at set at a date granularity).
6. **The fallback script is a poke, not a reimplementation** — one GET reuses the middleware's
   claim+send path instead of duplicating it in Python (which would need the Resend secret locally
   and a second copy of the idempotency logic to keep honest).
7. **No new telemetry event** — decision 3 caps the recruiter surface at sent + opened; the ticket
   asks for none.

None of these block execution; #1 and #3 are the two worth a maintainer's glance before merge.

## NOTES (open canvas)

**Why derive rather than store the mode.** Sessions are already a pure projection of the attempt
log (30-minute gap); a stored mode would be the first denormalisation of that model and would need
its own truth-maintenance (what if the date moves?). Deriving from `interview_at` per request keeps
the engine's cache-vs-truth split intact and makes the feature testable with nothing but a seeded
date.

**Why the sweep is global, not per-candidate.** The ticket says "trigger on portal request when
`interview_at` is tomorrow and not yet sent" — ANY request. Tying it to the candidate's own
authenticated request would defeat the point (the reminder exists precisely for candidates who
haven't come back). The middleware fires on unauthenticated traffic too, so one recruiter checking
the dashboard, one candidate on any invite, or the morning poke each deliver every due reminder.

**The trigger-mechanism decision (the ticket's one real design question).** Options weighed:
(a) middleware sweep + poke script — chosen: one code path, precedented by the purge, zero infra;
(b) hook at Send-time scheduling — impossible, nothing executes later on Pages;
(c) a separate Worker with cron triggers — real infra, new deploy surface, against decision 18's
same-repo-same-deployment shape, overkill for one email;
(d) Resend's scheduled-send API (`scheduled_at`) — genuinely tempting (schedule at Send-time,
cancel on delete), but it moves decision 17's enforcement OUTSIDE the system of record: a
rescheduled interview or a delete-now would need a remembered Resend id and a remote cancel that
can fail invisibly, and GDPR's delete-now must not depend on a third party honouring a cancel.
The claim column keeps "exactly once" enforceable in our own DB.

**Sequencing.** Phase 4 (reminder) is fully independent of Phases 1–3 (session shape) — disjoint
files, no shared state beyond the migration. A two-track implementation (or two commits) is natural:
`feat: day-before session` and `feat: the one reminder`. Both land under one PR for the ticket.

**Copy sketch for the reminder** (to be finalised against SPEC Tone in the email task):
subject: `Your interview is tomorrow`
body: "Your interview for the role at <agency's client — omit; we don't parse brief_json> is
tomorrow. Your day-before session is ready — a short run through what you already have, and the
practical details for the day. — <Agency>" — with the portal link. Note: keep it role-agnostic;
the invite email already named the role, and fetching role_title here would mean parsing
`brief_json` in a sweep.

**One deliberate non-reuse.** `isWithinHorizon`/`isNotPast` in dates.js are Send-time validators;
the sweep uses SQL's `date()` window instead of loading all invites into JS — the
`invite_by_interview` index exists for exactly this query shape.

## AMENDMENTS

