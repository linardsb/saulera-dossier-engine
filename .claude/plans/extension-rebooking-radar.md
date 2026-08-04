# Feature: Extension & rebooking radar — assignment end dates and the 14-day nudge

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

> **CONTINGENCY — read before starting.** Issue #69 carries the `contingent` label and the epic
> states the hypothesis it encodes ("the leak is compliance latency and extension slippage, not
> submission quality") **must be confirmed in the Louis Groves / TTR meeting**. The ticket says so
> in its own words: *"handover doc names extension slippage as a likely leak — confirm framing in
> the Louis meeting before starting."* `docs/handover-louis-meeting.md` is still an untracked local
> note. If that meeting has not happened, this plan is ready but the ticket is not — surface that
> to the owner rather than starting.

## Feature Description

A locum desk loses margin when a contract runs out and nobody noticed in time to extend the
candidate or redeploy them somewhere else. Today nothing in this product knows a booking exists,
let alone when it ends.

This ticket makes the booking a first-class thing the recruiter records — candidate, client, start
date, end date — and turns `assignment.end_date` into a clock. Fourteen days before a booking ends,
the recruiter gets one email: *this contract ends on the 21st — extend or redeploy?* A new
recruiter screen lists every booking, ending-soon first, with an amber state for anything inside
the fourteen-day window and a way to resolve it (push the end date out, or mark it ended).

It is the second half of epic #65's promise and the "milestone B" of the TTR dossier. #67 built the
`assignment` table for exactly this and left it with one writer and no reader; #68 built the
candidate-facing passport onto the same cage. This ticket is the recruiter's half of the booking,
and it is pure recruiter-side — **no candidate UI at all**.

## User Story

As a **recruiter on a locum-heavy desk**
I want to **record when each booking ends and be told two weeks before it does**
So that **I can extend or redeploy the candidate before the contract lapses, instead of finding out
when the client stops paying**

## Problem Statement

`migrations/0008_compliance.sql` created `assignment` with `start_date`, `end_date` and a
`status`. `src/compliance/store.js` has exactly one writer (`createAssignment`) with **no
production caller**, and one reader — `purgeDormant`, which reads the dates only to decide
retention. Nothing lists bookings, nothing computes a deadline, and nothing emails anybody about
one.

Meanwhile the deployment already owns every part needed: a Resend seam that sends, an
at-most-once claim pattern (`reminder_sent_at`) that stops a sweep double-sending, a lazy job slot
that substitutes for the cron Pages does not have, and a recruiter chrome with two screens on it.

## Solution Statement

Four moves, each one an existing pattern at a new root:

1. **A migration** (`0010`) adds `assignment.nudge_sent_at` — a nullable, set-exactly-once stamp,
   `migrations/0006_reminder.sql`'s exact shape and exact argument: *the column IS the
   idempotency*, claimed with `UPDATE … WHERE nudge_sent_at IS NULL`.
2. **Four store functions** in `src/compliance/store.js`: the due query, the atomic claim, the list
   the screen renders, and a two-field update so a nudge can be resolved.
3. **A sweep** (`src/compliance/nudges.js`) modelled line-for-line on `src/prep/reminders.js`,
   riding the same lazy slot in `functions/prep/_middleware.js`, sending a fourth email added to
   `src/prep/email.js`.
4. **A recruiter screen** at `/assignments` (nav label "Bookings") plus `GET`/`POST
   /api/assignments` and `PUT /api/assignments/:id` — the first production path in the product
   that creates a `candidate` row.

## Out of Scope / Non-Goals

- **No candidate-facing surface.** Nothing under `/prep/*` changes except the middleware's job
  list. The candidate is never emailed by this ticket.
- **No compliance state on the bookings screen** — no checklist, no verify action, no at-risk flag.
  That is #71's dashboard, and #70's expiry radar feeds it. This screen shows bookings and dates.
- **No `events` row for the nudge.** See the decision below — `assignment.nudge_sent_at` is the
  whole record, and `events.kind` is **not** widened by this ticket. Deliberate divergence from the
  epic's architecture doc, argued in Open Questions.
- **No new `extended` / `redeployed` assignment status.** `assignment.status`'s CHECK admits
  exactly `booked | active | ended | cancelled` and `ASSIGNMENT_STATUSES` is exported specifically
  so this ticket reads that list rather than inventing a sixth word the column would reject
  (`src/compliance/store.js:21-27`). The ticket's prose states resolved states as
  "extend/redeploy/ended"; those map onto what exists as: **extend** = a new `end_date` (which
  re-arms the radar), **redeploy** = end this booking and record a new one (two actions that
  already exist), **ended** = `status = 'ended'`.
- **No delete of an assignment.** `deleteCandidate` takes the whole cage; a stray booking is
  corrected by editing, not by a delete endpoint nobody asked for.
- **No candidate phone on the form.** `createCandidate` defaults it to `''`; the ticket asks for
  "candidate name as entered".
- **No second nudge, no escalation ladder, no digest.** One email per booking, exactly as decision
  17 gives the portal one reminder.
- **No new `nudge.py` script.** `scripts/remind.py` already pokes `/prep/login`, which runs the
  middleware this sweep joins — its docstring widens instead.
- **Not changing** `test/counts.test.js`'s privacy gate, `public/counts.js`, or any prep-portal
  behaviour lock. The bookings list is a **sibling screen** precisely so that gate stays
  byte-for-byte.

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: Medium–High (four layers; the SQL boundary arithmetic and the sweep's
at-most-once semantics are the parts that bite)
**Primary Systems Affected**: the compliance cage (`src/compliance/*`), the mail seam
(`src/prep/email.js`), the portal's lazy-job middleware, the recruiter chrome (`public/*`), the
`/api` Function tree, the schema lockfile
**Dependencies**: none new. No new npm package, no new external service. Resend and D1 as today.

## Related Work

**Implements**: [#69](https://github.com/linardsb/saulera-dossier-engine/issues/69)   ·
**Epic**: [#65](https://github.com/linardsb/saulera-dossier-engine/issues/65) ·
**Architecture** (inherited, not re-decided): [`docs/epics/locum-fit-2.architecture.md`](../../docs/epics/locum-fit-2.architecture.md)

**Back-references** (plans this builds on or inherits decisions from):

- `migrations/0008_compliance.sql` (#67) — Why: created `assignment`; its header comment already
  names this ticket as the reader of `end_date`.
- `migrations/0006_reminder.sql` + `src/prep/reminders.js` (#25) — Why: the claim-then-send sweep
  this ticket copies wholesale.
- `db1334f` (#68) — Why: the freshest compliance-tree code; route validation shape, the
  `isRealDate` round-trip, the schema-lockfile widening idiom.

**Forward-references**:

- #70 (expiry radar) inherits this ticket's finding that `events.kind` cannot be widened by
  `ADD COLUMN` — `expiry_nudge_sent` hits the identical wall. See Open Questions.
- #71 (recruiter compliance dashboard) inherits the `/assignments` screen and the create-a-candidate
  path this ticket ships. It should extend them, not build a second one.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

**The pattern being copied (read these three first, in this order):**

- `src/prep/reminders.js` (whole file, 65 lines) — Why: **this is the sweep**. Bail-before-claim,
  the sequential loop, at-most-once with no rollback, status-only logging. `src/compliance/nudges.js`
  is this file with a different due query and a different email.
- `src/portal/store.js:707-735` (`dueReminders`, `claimReminder`) — Why: the two store functions the
  radar mirrors. `claimReminder`'s `UPDATE … WHERE … IS NULL` is the atomicity argument verbatim.
- `migrations/0006_reminder.sql` (4 lines) — Why: the migration `0010` is modelled on, comment and
  all ("the column IS the idempotency").

**The cage this writes into:**

- `migrations/0008_compliance.sql:23-43` — Why: `assignment`'s exact DDL. Note `end_date` is
  nullable by design and its CHECK is `end_date IS NULL OR datetime(end_date) IS NOT NULL`.
- `src/compliance/store.js:1-19` (contract header) — Why: **every function takes a D1-shaped `db`
  first; no HTTP, no Response, no env; every user value bound, nothing interpolated.** The new store
  functions must hold that line.
- `src/compliance/store.js:21-28` (`ASSIGNMENT_STATUSES`) — Why: the closed booking vocabulary, and
  its comment names this ticket as the intended reader.
- `src/compliance/store.js:109-154` (`purgeDormant`) — Why: the SQL rigour to match, **and the one
  rule this ticket deliberately inverts** — see Patterns below.
- `src/compliance/store.js:156-183` (`createAssignment`) — Why: the existing writer; `requireFields`
  + `requireOneOf` + bound `status`.
- `src/compliance/store.js:273-283` (`candidateByEmail`) — Why: the create-or-reuse key for the
  first production candidate-create path.
- `src/compliance/store.js:54-91` (`createCandidate`) — Why: it **requires `email`** and it **seeds
  all 8 catalogue rows**. Both matter to the form and to the privacy note.
- `src/compliance/catalogue.js` (39 lines) — Why: "thresholds live in the catalogue, not code" —
  where `EXTENSION_LEAD_DAYS` goes.

**The mail seam:**

- `src/prep/email.js:1-64` (`sendEmail`) — Why: the transport, its 503-without-key posture, and the
  status-only error log.
- `src/prep/email.js:109-170` (the three-emails note + `mailFrom`) — Why: **the note this ticket
  must widen to four**, and the header-injection discipline (`CONTROLS`, `NAME_MAX`) any value
  reaching a header inherits.
- `src/prep/email.js:241-287` (`sendReminderEmail`) — Why: the closest sibling — calm tone, both
  halves carry the URL, `escapeHtml` on every interpolated value, inline styles only.

**The lazy-job slot:**

- `functions/prep/_middleware.js` (whole file, 40 lines) — Why: where the sweep is registered. Note
  the two independent try/catch blocks and their stated reason, and that sends ride `waitUntil`
  while purges are awaited before `next()`.

**Route shape:**

- `functions/api/clients.js` (whole file) — Why: the thin-adapter shape for `/api/*` — binding
  first (503), `sameOrigin` on writes, delegate, `errorResponse`.
- `functions/api/clients/[id].js` — Why: the `[id]` param route pattern for the PUT.
- `functions/api/events.js:14-27` — Why: the `ALLOWED` body-vocabulary set and the
  `unexpected_fields` 400. Every new POST/PUT body uses this.
- `functions/prep/compliance/api/item.js` (whole file, ~120 lines) — Why: **the freshest and closest
  validation model** — `ALLOWED`, `isRealDate`'s round-trip, and the argument for validating at the
  route so a caller-fixable input never becomes a CHECK-driven 500.

**The recruiter chrome:**

- `public/counts.html` (whole file, 61 lines) — Why: the page skeleton to mirror exactly — meta
  robots, the three stylesheet links, the topbar with static `aria-current`, `.page-head`,
  `.save-state` status box, script tag at the foot.
- `public/counts.js` (whole file, 127 lines) — Why: the IIFE + `"use strict"`, the `COPY` object,
  the `api()` helper's content-type check (Access answers an expired session with HTML at 200),
  `createElement` + `textContent` only, `showState`/`clearState`.
- `public/clients.js:90-118` — Why: the `el` id-map-at-load convention that `test/screens.test.js`
  gates.
- `public/tokens.css:67-87` — Why: the measured tint pairings. **`--tint-warn` carries `--danger`
  at 8.01:1 and `--unverified` at 5.59:1** — the amber row needs no new token.
- `public/app.css` (skim `.counts-*`, `.field`, `.input`, `.btn`, `.save-state`, and the motion
  block at the foot) — Why: the classes to reuse and where a transition is allowed to live.

**The gates that will fail if you are careless:**

- `test/schema.test.js:~215-230` (`EXPECTED_COLUMNS.assignment`) — Why: **one line must change**,
  with a reason comment, in the same PR as migration 0010.
- `test/screens.test.js:40-43` (`SCREENS`) — Why: the new screen must be added to the array.
- `test/chrome.test.js:1-80` — Why: **no raw hex** in app.css, **no page-scoped `<style>` block**
  on the new page (the `INLINE_STYLE_PAGES` list is hardcoded and
  `test/compliance-pages.test.js` asserts its contents), transitions only inside the
  `prefers-reduced-motion: no-preference` guard.
- `test/counts.test.js:41-60` — Why: **do not touch `counts.js`**. Its forbidden-word list includes
  `email`, which a bookings list would trip. This is the reason for a sibling screen.
- `test/prep-registry.test.js:905-935` — Why: the tabindex sweep is scoped to `public/prep/` only,
  so a new recruiter page is outside it. Named here so you do not go looking.
- `test/helpers/fake-d1.js:33-48` — Why: **bind parity is enforced** — argument count must equal
  `?` count, or the fake throws.
- `test/helpers/sqlite-d1.js` — Why: `openMigrated`, `d1Shape`, `skip`. Real SQL, Node 24 only.

**Config / docs:**

- `DEPLOY.md` §5b (secrets, ~line 460-540) and the lazy-jobs section (~line 581-600) — Why: the new
  `RECRUITER_EMAIL` var and the sweep both belong there, plus a triage-table row.
- `scripts/remind.py` (49 lines) — Why: the docstring widens to say the poke now drives two sweeps.

### New Files to Create

- `migrations/0010_assignment_nudge.sql` — the set-exactly-once claim column.
- `src/compliance/nudges.js` — the extension-nudge sweep (`sendDueExtensionNudges(env)`).
- `functions/api/assignments.js` — `GET` (list) + `POST` (record a booking).
- `functions/api/assignments/[id].js` — `PUT` (extend / resolve). **PUT, not PATCH** —
  `functions/api/clients/[id].js` uses `onRequestPut` for its partial update and this repo has no
  PATCH handler anywhere.
- `public/assignments.html` — the Bookings screen.
- `public/assignments.js` — its driver.
- `test/extension-radar.test.js` — real-SQL tests for the due predicate, the boundary, the claim,
  and the re-arm.
- `test/assignments.test.js` — route tests (fake-d1) + a source scan of the new page/script.

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [`docs/epics/locum-fit-2.architecture.md`](../../docs/epics/locum-fit-2.architecture.md) —
  sections "Key decisions" → *Retention*, *Data model*, *Boundaries*.
  - Why: these are **inherited, not re-decided**. In particular: telemetry stays in the closed
    `events.kind` vocabulary; emails stay on the Resend seam, idempotent via the
    `reminder_sent_at` / `send_key` patterns; no new external services; thresholds live in the
    catalogue.
- [SQLite — `ALTER TABLE`, "Making Other Kinds Of Table Schema Changes"](https://sqlite.org/lang_altertable.html#otheralter)
  - Specific section: the 12-step procedure.
  - Why: it is the **evidence** for this plan's central divergence — a CHECK constraint cannot be
    altered, so `events.kind` cannot be widened "exactly as #17 widened it". Read it before
    arguing with the Open Question.
- [SQLite — Date And Time Functions](https://sqlite.org/lang_datefunc.html)
  - Specific section: modifiers (`'+N days'`) and `date()` vs `datetime()`.
  - Why: the due predicate compares **days, not instants**, and the `'+' || ? || ' days'`
    bound-modifier idiom is already used at `src/compliance/store.js:331-337`.
- [Resend — Send Email API](https://resend.com/docs/api-reference/emails/send-email)
  - Why: only if `sendEmail`'s contract needs checking. Nothing new is called.

### Patterns to Follow

**The claim column IS the idempotency** (`migrations/0006_reminder.sql`, `claimReminder`):

```js
// src/portal/store.js:726-735 — copy this shape exactly.
export async function claimReminder(db, inviteId) {
  const result = await db
    .prepare(
      `UPDATE invite SET reminder_sent_at = datetime('now')
        WHERE id = ? AND reminder_sent_at IS NULL`,
    )
    .bind(String(inviteId ?? ""))
    .run();
  return (result.meta?.changes ?? 0) === 1;
}
```

There is no read-then-write window to lose. D1 has no transaction; this is what makes "exactly one
nudge" structural rather than hopeful.

**Bail before the claim** (`src/prep/reminders.js:36-40`):

```js
// "A sweep that cannot send must not claim: bailing BEFORE the claim is what keeps a
//  half-configured deployment from burning each invite's one reminder on nothing."
const base = baseUrl(env);
if (!env?.DB || !env?.RESEND_API_KEY || !base) return;
```

The radar adds one more precondition (`RECRUITER_EMAIL`) to the same guard, for the same reason.

**At-most-once, and never rolled back** (`src/prep/reminders.js:11-15, 60-63`): a failed send logs
`err?.code ?? err?.name` and nothing else — never the recipient, never Resend's body — and the
claim stands. This diverges from #22's rollback-on-throw deliberately: there the invite email *is*
the product; here the nudge is a courtesy.

**The store's SQL contract** (`src/compliance/store.js:13-15`): D1-shaped `db` first, every user
value bound, nothing interpolated. Where a numeric modifier is needed, bind it and let SQLite
assemble the string — with an `Number.isInteger` guard, exactly as `issueCandidateOtp` does:

```js
// src/compliance/store.js:331-337
`INSERT INTO candidate_otp (candidate_id, code_hash, expires_at)
 VALUES (?, ?, datetime('now', '+' || ? || ' minutes'))`
```

**Date-shaped input is validated at the route, not left to the CHECK**
(`functions/prep/compliance/api/item.js:36-52`): the regex is not enough — V8 refuses `2026-13-01`
but silently *rolls* `2026-02-30` to 2 March. The round trip is the check. A malformed date reaching
the column's CHECK is an `ERR_SQLITE_ERROR` → 500, and on this deployment a 500 means *deployment
fault*, so a caller-fixable input must never produce one.

**The named-columns rule** (`itemsByCandidate`, `candidateBySessionHash`): never `SELECT *`. The
row's shape is decided in the store, so a column added later reaches a screen only when someone
names it.

**The one rule this ticket deliberately INVERTS.** `purgeDormant` argues at length
(`src/compliance/store.js:129-133`) that dormancy is **date-driven and not status-driven**, because
a stale `status` extending retention would turn a bookkeeping error into a privacy breach. The
radar takes the opposite call and **does** filter on status: nudging about a booking already marked
`cancelled` is noise, and here a stale status costs one wrong email rather than a breach. **Write
that inversion down in the new function's comment**, pointing at `purgeDormant`, or the next reader
will read it as an inconsistency.

**Browser code** (`public/counts.js`): IIFE + `"use strict"`, a `COPY` object holding every visible
string, `createElement` + `textContent` and never `innerHTML`, the `api()` helper's content-type
check, nothing written to browser storage, nothing person-shaped in the URL.

**Plain language for a first-time recruiter** (house rule): the nav label is **"Bookings"**, not
"Assignments". `end_date` renders as "Ends", the amber chip says "Ends in 9 days", the resolved
chip says "Ended". No jargon on the screen; the table name stays in the code.

---

## IMPLEMENTATION PLAN

### Phase 1: Foundation — the column and the threshold

The migration and the one constant. Everything else reads them.

**Tasks:**

- `migrations/0010_assignment_nudge.sql` — `ALTER TABLE assignment ADD COLUMN nudge_sent_at TEXT;`
- `src/compliance/catalogue.js` — export `EXTENSION_LEAD_DAYS = 14`.
- `test/schema.test.js` — widen `EXPECTED_COLUMNS.assignment` by one name, with the reason.

### Phase 2: Core Implementation — the store

**Depends on:** Phase 1 (the column must exist before a statement names it).

Four functions in `src/compliance/store.js`. This is where the design actually lives.

**Tasks:**

- `dueExtensionNudges(db, leadDays)` — the radar's whole predicate.
- `claimExtensionNudge(db, assignmentId)` — `claimReminder` at the new root.
- `listAssignments(db)` — what the screen renders, ending-soon first.
- `updateAssignment(db, id, { endDate, status })` — extend / resolve, **and the re-arm**.

### Phase 3: The sweep and the email

**Depends on:** Phase 2.
**Independent of:** Phase 4 (the screen). These two can run in parallel worktrees once Phase 2 is
merged — they share no file except `DEPLOY.md`.

**Tasks:**

- `sendExtensionNudgeEmail` in `src/prep/email.js`, and widen the three-emails note to four.
- `src/compliance/nudges.js` — `sendDueExtensionNudges(env)`.
- Register it in `functions/prep/_middleware.js` on `waitUntil` with its own try/catch.
- `DEPLOY.md` + `scripts/remind.py` docstring.

### Phase 4: The recruiter surface

**Depends on:** Phase 2.
**Independent of:** Phase 3.

**Tasks:**

- `functions/api/assignments.js` (GET + POST) and `functions/api/assignments/[id].js` (PUT).
- `public/assignments.html`, `public/assignments.js`, `.assignments-*` rules in `public/app.css`.
- The nav entry on all four recruiter pages.

### Phase 5: Testing & Validation

**Depends on:** Phases 3 and 4.

**Tasks:**

- `test/extension-radar.test.js` (real SQL — the boundary arithmetic).
- `test/assignments.test.js` (routes + page source scan).
- Extend `test/compliance-store.test.js`, `test/prep-email.test.js`, `test/screens.test.js`,
  and `test/prep-middleware.test.js` (its `waitUntil` count moves from 1 to 2).
- Full suite, then the manual sweep.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

### Task Format Guidelines

Use information-dense keywords for clarity:

- **CREATE**: New files or components
- **UPDATE**: Modify existing files
- **ADD**: Insert new functionality into existing code
- **REMOVE**: Delete deprecated code
- **REFACTOR**: Restructure without changing behavior
- **MIRROR**: Copy pattern from elsewhere in codebase

---

### CREATE `migrations/0010_assignment_nudge.sql`

- **IMPLEMENT**: One statement — `ALTER TABLE assignment ADD COLUMN nudge_sent_at TEXT;` — with a
  header comment in the house voice covering four things: (a) it is `0006_reminder.sql`'s shape and
  argument, *the column IS the idempotency*, claimed with `UPDATE … WHERE nudge_sent_at IS NULL`;
  (b) nullable with no default, because "never nudged" is the honest state of every existing row
  (0004's note: a nullable TEXT needs no default); (c) it dies with the assignment, which dies with
  the candidate — the cascade already proven in `test/schema.test.js`; (d) **why there is no
  `events` row**: an `events` row would be a second record of the same fact with a *different
  lifetime* — `events` survives the cage's purge deliberately, and a nudge belongs to the booking,
  which does not. Point at this plan's Open Questions for the `events.kind` finding.
- **PATTERN**: `migrations/0006_reminder.sql` (all 4 lines), `migrations/0007_send_key.sql` for the
  comment register.
- **IMPORTS**: none.
- **GOTCHA**: No CHECK on this column. It is only ever written by `datetime('now')` inside the store,
  never by a caller, so there is no unparseable-string failure mode to move to write time — which is
  the exact opposite of `end_date`, and worth one clause of comment. **Do not** try to widen
  `events.kind` here; SQLite has no ALTER CONSTRAINT and the attempt breaks three gates in
  `test/schema.test.js`.
- **VALIDATE**: `node --test test/schema.test.js` — expect exactly ONE failure, `assignment`'s
  column lock. That failure is the proof the migration was seen; the next task fixes it.
- **SATISFIES**: AC #2, AC #7

### UPDATE `test/schema.test.js`

- **IMPLEMENT**: Add `"nudge_sent_at"` to `EXPECTED_COLUMNS.assignment` (keep the list
  alphabetically sorted — the assertion sorts both sides, but the file's convention is sorted
  source). Extend the existing comment above `assignment` with the #69 clause: the set-exactly-once
  claim stamp, `invite.reminder_sent_at`'s shape at the booking root, and that it is the ONLY
  record of a sent nudge because this ticket writes no `events` row.
- **PATTERN**: `EXPECTED_COLUMNS.invite`'s comment, which stacks a `#25 adds…` and a `#34 adds…`
  clause on the same list. Match that register.
- **IMPORTS**: none.
- **GOTCHA**: The lockfile is the product's strongest gate — the file's own header says "change the
  assertion deliberately and say why in the PR". A silent one-word edit is the failure mode. Also:
  **nothing else in this file changes.** `events.kind`'s vocabulary test, the exact-tables lock and
  the ALTER self-guard all stay untouched.
- **VALIDATE**: `node --test test/schema.test.js` → all pass.
- **SATISFIES**: AC #7

### UPDATE `src/compliance/catalogue.js`

- **IMPLEMENT**: Append `export const EXTENSION_LEAD_DAYS = 14;` with a comment: it is the radar's
  threshold and it lives HERE because the architecture doc says thresholds live in the catalogue,
  not in code — the same reason `amberDays` does. Note that it is *not* a per-item value: a booking
  has one lead time, not one per checklist item, so it sits beside the array rather than inside it.
- **PATTERN**: the file's existing `ITEM_KEYS` / `ITEM_STATUSES` exports and the `amberDays`
  rationale in the header.
- **IMPORTS**: none (this file has none, deliberately — keep it that way).
- **GOTCHA**: The browser cannot import `src/`. If the screen needs the number, it comes down the
  wire from the API or is recomputed server-side. The header comment already explains why (`src/` is
  not in the Pages build output) — do not add a second copy in `public/`.
- **VALIDATE**: `node -e "import('./src/compliance/catalogue.js').then(m=>{if(m.EXTENSION_LEAD_DAYS!==14)process.exit(1);console.log('ok')})"`
- **SATISFIES**: AC #2

### ADD `dueExtensionNudges` to `src/compliance/store.js`

- **IMPLEMENT**: The radar's predicate. Place it in a new `// ── the extension radar (#69) ──`
  section after `createAssignment`.

  ```js
  export async function dueExtensionNudges(db, leadDays) {
    if (!Number.isInteger(leadDays) || leadDays <= 0) {
      throw new StoreError("missing_fields", 400, "leadDays: must be a positive integer");
    }
    const { results } = await db
      .prepare(
        `SELECT a.id, a.end_date, a.status,
                candidate.full_name AS candidate_name,
                clients.name        AS client_name
           FROM assignment a
           JOIN candidate ON candidate.id = a.candidate_id
           JOIN clients   ON clients.id   = a.client_id
          WHERE a.end_date IS NOT NULL
            AND a.nudge_sent_at IS NULL
            AND a.status IN ('booked', 'active')
            AND date(a.end_date) >= date('now')
            AND date(a.end_date) <= date('now', '+' || ? || ' days')
          ORDER BY date(a.end_date), a.id`,
      )
      .bind(leadDays)
      .all();
    return results ?? [];
  }
  ```

  The comment must argue five clauses, because each is a decision:
  1. **`end_date IS NOT NULL`** — an open booking has no deadline to warn about. `purgeDormant`
     grants exactly that row its immortality; here it simply has nothing to say.
  2. **`nudge_sent_at IS NULL`** — the claim column, read here and written by the claim. One
     booking, one nudge (decision 17's rule at a new root).
  3. **`status IN ('booked','active')` — the deliberate inversion of `purgeDormant`'s
     date-only rule.** Name that function, quote its reason, and say why this one differs: a stale
     status extending *retention* is a privacy breach; a stale status suppressing a *nudge* costs
     one email. Reference `ASSIGNMENT_STATUSES` in the comment so the literals here are traceable
     to the vocabulary — but keep them as literals in the SQL, because the list is not a bound
     value and must not be interpolated.
  4. **`date()` and not `datetime()`** — day granularity, `isNotPast`'s argument
     (`src/prep/dates.js:120-133`): a contract ending today is still a contract you can act on at
     14:00. UTC throughout, which is SQLite's `now`.
  5. **`>= date('now')`** — a booking whose end date already passed is **not** nudged. The radar's
     promise is fourteen days of warning; "your contract ended yesterday" is a different message
     and a different ticket (#71's at-risk list). State the cost openly: on a deployment with no
     portal traffic for three weeks, a booking can pass its window unnudged and never be emailed —
     the Bookings screen is the backstop, and `scripts/remind.py` is the assurance poke.

- **PATTERN**: `src/portal/store.js:707-718` (`dueReminders`) for shape;
  `src/compliance/store.js:141-154` (`purgeDormant`) for comment density and rigour;
  `src/compliance/store.js:304-338` for the bound-modifier idiom and its `Number.isInteger` guard.
- **IMPORTS**: `StoreError` is already imported at the top of the file. No new import.
- **GOTCHA**: `candidate` and `clients` are table names, and `a` is the assignment alias — do not
  alias `candidate` to `c` and `clients` to `cl`; the explicit names read better and there is
  precedent for neither. **The `?` count must equal the bind count** or `fake-d1` throws. The
  bound modifier is assembled by SQLite from a bound value and never templated into the statement
  text — the guard above is what makes that concatenation produce a modifier SQLite can read rather
  than a silent NULL.
- **VALIDATE**: `node --test test/compliance-store.test.js` (after the store test is written) and
  `node --test test/extension-radar.test.js`.
- **SATISFIES**: AC #2, AC #3

### ADD `claimExtensionNudge` to `src/compliance/store.js`

- **IMPLEMENT**:

  ```js
  export async function claimExtensionNudge(db, assignmentId) {
    const result = await db
      .prepare(
        `UPDATE assignment SET nudge_sent_at = datetime('now')
          WHERE id = ? AND nudge_sent_at IS NULL`,
      )
      .bind(String(assignmentId ?? ""))
      .run();
    return (result.meta?.changes ?? 0) === 1;
  }
  ```

  Comment: `claimReminder`'s move at the booking root — exactly one caller finds the column still
  NULL and the loser sees `changes === 0`; there is no read-then-write window to lose, which is what
  makes "one nudge per booking" structural rather than hopeful on a database with no transaction.
  At-most-once by design: the caller never rolls it back on a failed send.
- **PATTERN**: `src/portal/store.js:720-735` — copy the shape and the argument.
- **IMPORTS**: none new.
- **GOTCHA**: `String(assignmentId ?? "")` is not decoration — an `undefined` bind is a D1 error, and
  the empty string matches nothing, which is the fail-closed answer.
- **VALIDATE**: `node --test test/extension-radar.test.js` (the two-concurrent-claims case).
- **SATISFIES**: AC #2

### ADD `listAssignments` to `src/compliance/store.js`

- **IMPLEMENT**: What the Bookings screen renders. Named columns, never `SELECT *`.

  ```js
  export async function listAssignments(db) {
    const { results } = await db
      .prepare(
        `SELECT a.id, a.start_date, a.end_date, a.status, a.nudge_sent_at,
                candidate.full_name AS candidate_name,
                clients.name        AS client_name
           FROM assignment a
           JOIN candidate ON candidate.id = a.candidate_id
           JOIN clients   ON clients.id   = a.client_id
          ORDER BY CASE WHEN a.status IN ('ended', 'cancelled') THEN 1 ELSE 0 END,
                   a.end_date IS NULL,
                   date(a.end_date),
                   a.start_date`,
      )
      .all();
    return results ?? [];
  }
  ```

  Comment the ordering as three questions in priority order — *is it resolved?* (resolved sinks),
  *does it have an end date?* (open bookings sit below dated ones, because "ending soon first" has
  nothing to say about a booking that never ends), *when does it end?* (soonest first). Note
  explicitly what is NOT selected: no `candidate_id`, no `email`, no compliance state. The screen
  shows bookings; #71 owns the compliance column.
- **PATTERN**: `itemsByCandidate`'s named-columns rule (`src/compliance/store.js:215-235`);
  `listClients` (`src/store.js:61`) for a list endpoint's shape.
- **IMPORTS**: none new.
- **GOTCHA**: `a.end_date IS NULL` in an ORDER BY evaluates to 0/1 in SQLite — 0 (false, i.e. has a
  date) sorts first, which is what is wanted. Do not "fix" it to `IS NOT NULL`.
- **VALIDATE**: `node --test test/extension-radar.test.js` (ordering case with a mixed fixture).
- **SATISFIES**: AC #3

### ADD `updateAssignment` to `src/compliance/store.js`

- **IMPLEMENT**: The resolve/extend write. Two fields, both optional, at least one required.

  ```js
  export async function updateAssignment(db, id, patch = {}) {
    requireFields({ id });
    // updateClient's shape verbatim (src/store.js:192-208): a FIXED allow-list, checked with
    // Object.hasOwn, pushing a literal `column = ?` and its bound value. A caller-supplied key
    // never reaches the SQL string.
    const columns = [];
    const values = [];
    if (Object.hasOwn(patch, "endDate")) {
      columns.push("end_date = ?", "nudge_sent_at = NULL");   // ← the re-arm, same statement
      values.push(patch.endDate ?? null);
    }
    if (Object.hasOwn(patch, "status")) {
      requireOneOf("status", patch.status, ASSIGNMENT_STATUSES);
      columns.push("status = ?");
      values.push(patch.status);
    }
    if (!columns.length) {
      throw new StoreError("missing_fields", 400, "update: nothing to change");
    }
    const result = await db
      .prepare(`UPDATE assignment SET ${columns.join(", ")} WHERE id = ?`)
      .bind(...values, String(id))
      .run();
    return { updated: (result.meta?.changes ?? 0) === 1 };
  }
  ```

  Note `nudge_sent_at = NULL` is pushed as a **literal fragment with no placeholder** — it binds
  nothing, so the `?`-to-bind parity `fake-d1` enforces still holds. Do not "tidy" it into a bound
  `?` with a `null` value; the column is being cleared, not set to a caller's value.

  **THE RE-ARM IS THE POINT OF THIS FUNCTION** and must be commented as such: when `end_date`
  changes, `nudge_sent_at` is set back to NULL in the same statement. Without it, extending a
  booking from September to December leaves the claim standing and the December deadline never
  nudges — the radar would go quiet exactly when it had just been proved useful. A `status` change
  alone does **not** clear it: marking a booking `ended` resolves the nudge, it does not re-arm it.

  Accept the known cost in the comment: extending by four days, still inside the window, re-arms and
  sends a second email. That email is *true* — the booking still ends inside fourteen days and the
  recruiter has a new date — so one rule with no arithmetic beats a cleverer rule with a boundary
  nobody can hold in their head.

  **One more clause, because a reviewer of this repo will stop on it.** Clearing `end_date` (the
  route sends `null` for an empty value) makes the booking open again — and `purgeDormant` grants an
  open booking's candidate indefinite retention (`src/compliance/store.js:123-125`: *"A booking with
  no end is a live one"*). That is inside the designed semantics, but it is now reachable from a
  recruiter control rather than only from a considered `createAssignment` call. Say so here, point
  at `purgeDormant`, and note that the answer is the same one the migration already gave: an open
  booking is a live one, and a live booking's compliance file is not dormant data.

  If both fields arrive, one statement writes both (D1 has no transaction; two statements would be a
  live half-state).
- **PATTERN**: `updateClient` (`src/store.js:192-208` for the allow-list, `253-256` for the
  `columns.join(", ")` UPDATE) — it has already solved this exact shape in this repo;
  `createAssignment` for `requireOneOf` on the status vocabulary.
- **IMPORTS**: none new — `requireFields`, `requireOneOf`, `StoreError` and `ASSIGNMENT_STATUSES`
  are all already in the file.
- **GOTCHA**: **Never build the SET clause from caller-supplied keys.** The file's line-15 contract
  is that nothing is interpolated; a column name cannot be a bound parameter, so every fragment in
  `columns` is a literal written here. `Object.hasOwn` and not a truthiness check: `endDate: null`
  is a meaningful patch (clearing an end date turns a booking open again) and `if (patch.endDate)`
  would silently drop it. `updateClient` does a 404-before-write via `getClient`; this one skips
  that and lets `changes === 0` mean not-found, because there is no second statement whose ordering
  could matter.
- **VALIDATE**: `node --test test/extension-radar.test.js` (the re-arm case: nudge, extend, assert
  the booking is due again).
- **SATISFIES**: AC #4, AC #5

### ADD `sendExtensionNudgeEmail` to `src/prep/email.js`

- **IMPLEMENT**: A new section at the foot, `// ── the extension nudge (#69) ────`, and:

  ```js
  export async function sendExtensionNudgeEmail(
    env, { to, candidateName, clientName, endDate, link } = {},
  ) { /* … */ }
  ```

  Content rules:
  - Subject: `` `Booking ending: ${name} at ${client}` `` — with both values run through the
    `CONTROLS` strip and the `NAME_MAX` slice first, exactly as `sendInviteEmail` does for
    `roleTitle` (`src/prep/email.js:187-196`). A CR or LF in a header field is the injection.
  - Body, plain and calm: *"[Name]'s booking at [Client] ends on [date]. Extend it or redeploy
    them — whichever, it is easier to do now than after it lapses."* plus the link.
  - Date rendered **day-only** via `.slice(0, 10)` — `sendInviteEmail`'s treatment
    (`src/prep/email.js:198-201`) and its reason: a recruiter reading `2026-09-21 00:00:00` learns
    nothing from the zeros.
  - Both `text` and `html`; the text half carries the URL as bare text on its own line so a
    plain-text client can follow it; the html half uses `escapeHtml` on **every** interpolated
    value; inline styles and literal colours only (mail clients strip `<style>` and resolve no
    custom property).
  - `from: mailFrom(env, agencyName)` if an agency name is passed, else the default.

  **Widen the three-emails note** (`src/prep/email.js:109-123`) to four, and state the fourth rule:
  this is the first message addressed to **the agency, not a candidate**. The anti-phishing argument
  that forbids a link in `sendOtpEmail` does not apply — the recipient is an operator-configured
  address and the link points at an Access-gated screen — but the note must say so out loud, and say
  that this message must never be sent to a candidate address, because it names a candidate to a
  third party. Keep the existing sentence that the four are different BY DESIGN and none should be
  harmonised toward another.
- **PATTERN**: `sendReminderEmail` (`src/prep/email.js:254-287`) for tone and structure;
  `sendInviteEmail:187-201` for the header-value hygiene and the date slice.
- **IMPORTS**: none new — `sendEmail`, `mailFrom`, `escapeHtml`, `CONTROLS`, `NAME_MAX` are all in
  the file.
- **GOTCHA**: `escapeHtml` is module-private and defined at line 78 — it is above these functions,
  so it is in scope. The candidate's name is **person data going into an email**: never log it,
  never put it in an error body. `sendEmail` logs the status alone and this adds nothing.
- **VALIDATE**: `node --test test/prep-email.test.js`
- **SATISFIES**: AC #2, AC #6

### CREATE `src/compliance/nudges.js`

- **IMPLEMENT**: `src/prep/reminders.js` with a different due query. Structure:

  ```js
  import { dueExtensionNudges, claimExtensionNudge } from "./store.js";
  import { EXTENSION_LEAD_DAYS } from "./catalogue.js";
  import { getAgency } from "../store.js";
  import { sendExtensionNudgeEmail } from "../prep/email.js";

  function baseUrl(env) { /* reminders.js:22-34 verbatim */ }
  function recipient(env) { /* below */ }

  export async function sendDueExtensionNudges(env) {
    const base = baseUrl(env);
    const to = recipient(env);
    if (!env?.DB || !env?.RESEND_API_KEY || !base || !to) return;

    const due = await dueExtensionNudges(env.DB, EXTENSION_LEAD_DAYS);
    if (due.length === 0) return;
    const agency = await getAgency(env.DB).catch(() => null);

    for (const booking of due) {
      const claimed = await claimExtensionNudge(env.DB, booking.id);
      if (!claimed) continue;
      try {
        await sendExtensionNudgeEmail(env, {
          to,
          agencyName: agency?.name,
          candidateName: booking.candidate_name,
          clientName: booking.client_name,
          endDate: booking.end_date,
          link: `${base}/assignments`,
        });
      } catch (err) {
        console.error("extension nudge send failed:", err?.code ?? err?.name ?? "unknown");
      }
    }
  }
  ```

  `recipient(env)`: read `env.RECRUITER_EMAIL`, trim, and return null unless it is a single address
  — non-empty, contains exactly one `@`, contains **no CR/LF/control character** and **no comma**.
  The comma matters: `to` reaches a mail header, and a comma there is a second recipient the
  operator may not have intended. Fail closed to null, which the guard turns into a silent no-op
  rather than a broken send.

  Header comment must carry, in the house voice: (a) Pages has no cron, so this rides the same lazy
  slot as the reminder sweep; (b) **bail before the claim** — a sweep that cannot send must not
  claim, or a half-configured deployment burns each booking's one nudge on nothing; (c)
  at-most-once by design, the claim is never rolled back, and why that diverges from #22's
  rollback-on-throw; (d) it takes `env` (it orchestrates db + mail + config), which is why it is
  here and not in the store; (e) sequential and not `Promise.all` — the due set is tiny and two
  concurrent *requests* still cannot double-send, because the claim has one winner.
- **PATTERN**: `src/prep/reminders.js` — read it and mirror it, comment structure included.
- **IMPORTS**: exactly the four above.
- **GOTCHA**: `getAgency` lives in `src/store.js` (the engine store), not the compliance one, and it
  is wrapped in `.catch(() => null)` because a missing agency row must not stop the sweep. The link
  is `${base}/assignments` — the recruiter screen, which is Access-gated; it is **not** a `/prep/*`
  path and must not be, or the nudge would point the recruiter at the candidate portal.
- **VALIDATE**: `node --test test/extension-radar.test.js` (the bail-before-claim case: no
  `RECRUITER_EMAIL` → nothing claimed).
- **SATISFIES**: AC #2, AC #6

### UPDATE `functions/prep/_middleware.js`

- **IMPLEMENT**: Add a second `context.waitUntil(...)` for `sendDueExtensionNudges(env)`, with its
  **own** `.catch()` naming the sweep. Extend the header comment with the #69 clause: the extension
  radar joins the same lazy slot for the same reason the compliance purge did in #67 — any portal
  traffic keeps every promise, and it rides `/prep/*` even though the nudge is recruiter-facing,
  because that is where the traffic is and `scripts/remind.py` is the assurance poke for a quiet
  day. Say plainly that the recruiter never visits `/prep/*`, so the radar's liveness depends on
  candidate traffic or the daily poke — an honest cost, not an oversight.
- **PATTERN**: the existing `sendDueReminders` registration, lines 33-37, and the two-catch-blocks
  argument at the top of the file ("two catch blocks mean the log line names which one broke").
- **IMPORTS**: `import { sendDueExtensionNudges } from "../../src/compliance/nudges.js";`
- **GOTCHA**: `waitUntil`, not `await` — the response has no ordering dependency on the sends, and
  the one visitor who trips a due morning must not wait out N Resend calls. Do **not** add a second
  trigger on `/api/assignments`: one lazy slot is one place to reason about, and a recruiter already
  looking at the screen does not need the email at that instant.
- **VALIDATE**: `node --test test/prep-middleware.test.js` — **expect it to FAIL** until the next
  task. That failure is the gate working.
- **SATISFIES**: AC #2

### UPDATE `test/prep-middleware.test.js`

- **IMPLEMENT**: `test/prep-middleware.test.js:53` asserts `captured.length === 1` — "the sweep was
  handed to `waitUntil`". A second sweep makes it **2**, so this gate must move deliberately rather
  than be discovered as a red run. Change the count to 2, rename the assertion message to say
  *both* sweeps were handed over, and extend the file's header comment with the #69 clause: the
  extension radar joins the reminder sweep in the same deferred slot, and both are deferred for the
  same reason — the response has no ordering dependency on either.

  Also assert the property that actually matters and is now testable: with an env that has no
  `RECRUITER_EMAIL`, both promises still resolve and the response still serves — one sweep bailing
  must not take the other down. That is the two-catch-blocks argument at the top of the middleware,
  made measurable.
- **PATTERN**: the file's two existing tests; `test/helpers/sqlite-d1.js`'s `at`, `d1Shape`,
  `openMigrated`, `skip`.
- **IMPORTS**: none new beyond what the file already has.
- **GOTCHA**: This is the **second** gate this ticket moves (the schema lockfile is the first), and
  both belong in the PR body with a reason. `test/smoke.test.js` and `test/seam.test.js` were
  checked and are **not** affected — smoke covers the pack/provenance modules and seam drives the
  two generate Functions directly; neither enumerates `public/` or the `functions/` tree.
- **VALIDATE**: `node --test test/prep-middleware.test.js`
- **SATISFIES**: AC #2, AC #7

### CREATE `functions/api/assignments.js`

- **IMPLEMENT**: Two handlers.

  `onRequestGet` — binding guard (503), `return json({ assignments: await listAssignments(env.DB) })`.

  `onRequestPost` — binding guard, `sameOrigin` guard (403), then:
  - `ALLOWED = new Set(["candidate_name", "candidate_email", "client_id", "start_date", "end_date"])`
    and a 400 `unexpected_fields` for anything else.
  - Validate `start_date` (required) and `end_date` (optional) with the `isRealDate` round-trip.
    Both are stored **date-only** (`YYYY-MM-DD`), which is what `<input type="date">` submits and
    what `compliance_item.expiry_date` already holds — the column's CHECK accepts it and every
    query wraps it in `date()`.
  - If `end_date` is present, refuse an end date before the start date (400) — a booking that ends
    before it begins is a typo, and the radar would either never fire or fire immediately.
  - **`await getClient(env.DB, body.client_id)` — BEFORE the first write.** This is the ordering
    that matters most in the file and it must be commented as such. `assignment.client_id` is
    `NOT NULL REFERENCES clients(id)` and D1 enforces foreign keys, so a stale or typo'd client id
    makes `createAssignment` throw `ERR_SQLITE_ERROR` — **after** `createCandidate` has already run
    and seeded eight `compliance_item` rows. D1 gives this path no transaction, so what is left
    behind is a candidate no booking points at, eight health-adjacent rows nobody asked for, and a
    500 that on this deployment reads as *deployment fault* — polluting the exact signal
    `item.js:47-52` argues must stay clean. `purgeDormant` will not collect that orphan for twelve
    months, because its `created_at` is fresh. `getClient` already throws the store's 404 for an
    unknown id, so this costs one line and one `await`. `updateClient` does the same thing for the
    same reason and says so: *"404 before writing, not after"* (`src/store.js:210`).
  - **Create-or-reuse the candidate**: `candidateByEmail(env.DB, email)` → if a row comes back, use
    its id; otherwise `crypto.randomUUID()` and `createCandidate`. Email is the reuse key because it
    is already the sign-in key (`candidateByEmail`'s comment), and case-insensitivity is that
    function's job, not this route's.
  - `createAssignment(env.DB, { id: crypto.randomUUID(), candidateId, clientId, startDate, endDate })`
    — status omitted so the store's `'booked'` applies.
  - `return json({ assignment: { id, … } }, 201)`.

  The file header must state the thing this route quietly is: **the first production path in the
  product that creates a `candidate` row.** #68 shipped the passport with no such path on purpose
  ("#71 owns both"), and `createAssignment`'s foreign key makes it unavoidable here. Two
  consequences to write down: recording a booking **seeds all eight compliance checklist rows**
  (`createCandidate`'s one-writer design), so a booking is also the moment a candidate's compliance
  file starts existing; and the candidate's email is collected here even though this ticket never
  emails them — it is the reuse key and the passport's sign-in key. The privacy notice #68 extended
  already covers the class; check it still reads true and say so in the PR.
- **PATTERN**: `functions/api/clients.js` (whole file) for the adapter shape;
  `functions/api/events.js:14-27` for `ALLOWED`; `functions/prep/compliance/api/item.js:36-52` for
  `isRealDate` and the argument for validating at the door.
- **IMPORTS**:
  ```js
  import { listAssignments, createAssignment, createCandidate, candidateByEmail }
    from "../../src/compliance/store.js";
  import { getClient } from "../../src/store.js";
  import { EXTENSION_LEAD_DAYS } from "../../src/compliance/catalogue.js";
  import { json, readJson, sameOrigin, errorResponse } from "../../src/http.js";
  ```
  The GET returns `{ assignments, lead_days: EXTENSION_LEAD_DAYS }` — see the `assignments.js`
  task for why the browser must not carry its own copy of the number.
- **GOTCHA**: `functions/` sits at the repo **root**, never under `public/` (DEPLOY.md §1) — a
  `functions/` directory under `public/` publishes the source as a static file where it never runs.
  `crypto.randomUUID()` is global in the Workers runtime and on Node 20/24 (`src/store.js:84`).
  This route is Access-gated by being outside `/prep/*`; the two Access bypass apps cover the portal
  only. `sameOrigin` on the POST is the second lock, not the first.
- **VALIDATE**: `node --test test/assignments.test.js`
- **SATISFIES**: AC #1

### CREATE `functions/api/assignments/[id].js`

- **IMPLEMENT**: `onRequestPut` — binding guard, `sameOrigin` guard,
  `ALLOWED = new Set(["end_date", "status"])`, validate `end_date` with `isRealDate` when present,
  then call `updateAssignment`. `{ updated: false }` → 404. Success → `json({ ok: true })`.

  **Build the patch conditionally**, because the store discriminates with `Object.hasOwn`:

  ```js
  const patch = {};
  if (Object.hasOwn(body, "end_date")) patch.endDate = body.end_date || null;
  if (Object.hasOwn(body, "status"))   patch.status  = body.status;
  const { updated } = await updateAssignment(env.DB, context.params.id, patch);
  ```

  Passing `{ endDate: undefined, status: undefined }` would make **every** call look like a
  two-field patch and clear `nudge_sent_at` on a status-only resolve — the exact bug the re-arm
  rule exists to avoid, arriving through the route instead of the store. `|| null` on `end_date`
  is deliberate: an empty string means the recruiter cleared the date, which reopens the booking.

  Comment the two shapes this endpoint serves in the recruiter's words: **extend** (a new end date,
  which re-arms the radar — say so, and point at `updateAssignment`) and **resolve** (`status`
  moves to `ended` or `cancelled`, which does not).
- **PATTERN**: `functions/api/clients/[id].js` for the `context.params` access and the PUT shape.
- **IMPORTS**: `updateAssignment` from `../../../src/compliance/store.js`; the four `http.js`
  helpers; `isRealDate` (see the next task).
- **GOTCHA**: Three `../` — this file is one directory deeper than `assignments.js`. The status
  vocabulary is checked by the store (`requireOneOf`), so do **not** duplicate the list here; a
  bad value already answers 400 `missing_fields` with the allowed list in the message.
- **VALIDATE**: `node --test test/assignments.test.js`
- **SATISFIES**: AC #4, AC #5

### REFACTOR `isRealDate` out of `functions/prep/compliance/api/item.js` into `src/prep/dates.js`

- **IMPLEMENT**: Move the function (and its comment) to `src/prep/dates.js` as a named export, then
  import it in `item.js` and in both new route files. Three copies of a round-trip date check is
  where one of them quietly loses the round trip.
- **PATTERN**: `src/prep/dates.js` already documents this exact trap at lines 63-70 for
  `interview_at`, which makes it the function's natural home. Cross-tree imports are precedented —
  `src/compliance/store.js` imports from both `../store.js` and `../portal/store.js`.
- **IMPORTS**: `import { isRealDate } from "../../src/prep/dates.js";` (adjust depth per file).
- **GOTCHA**: `src/prep/dates.js`'s header says the module has **no `node:` imports** because it
  runs at the edge — keep that true. Do not rename the function; `item.js`'s comment refers to it by
  name and so may its tests. This is the one adjacent file this ticket touches, and it touches it to
  *remove* a copy, not to add one — say so in the PR.
- **VALIDATE**: `node --test test/prep-dates.test.js test/compliance-passport.test.js` — both must
  still pass unchanged.
- **SATISFIES**: AC #1, AC #4

### CREATE `public/assignments.html`

- **IMPLEMENT**: Mirror `public/counts.html` structurally: `<!doctype html>`, `lang="en-GB"`,
  `charset`, viewport **without** `maximum-scale` or `user-scalable=no`, `robots noindex, nofollow`,
  `<title>Bookings · saulera dossier engine</title>`, favicon, the three stylesheets in order
  (`fonts.css`, `tokens.css`, `app.css`), the topbar with `aria-current="page"` on this screen's
  link, `<main>`, a `.page-head` with `<h1>Bookings</h1>` and a `.page-sub`, then:
  - A "Record a booking" form: candidate name (`.input`), candidate email (`.input`,
    `type="email"`), client (`<select class="select">`, filled from `/api/clients`), start date and
    end date (`type="date"`), and a `.btn .btn-primary` submit. Every control labelled.
  - A `<table class="assignments-table">` with a `<caption>` and headers: Candidate, Client, Starts,
    Ends, State — `<tbody id="assignments-body">`.
  - Two `.save-state` boxes with `role="status"` (one for the form, one for the list) or one shared,
    matching `counts.html`'s single `#counts-state`.

  Copy is written for a first-time recruiter: `.page-sub` says something like *"Every booking you
  have recorded, soonest to end first. We will email you fourteen days before one runs out."*
- **PATTERN**: `public/counts.html` (whole file) — same chrome, same comment register. `.field`,
  `.input`, `.select`, `.btn`, `.save-state` all already exist in `app.css`.
- **IMPORTS**: `<script src="/assignments.js"></script>` at the foot, before `</body>`.
- **GOTCHA**: **No page-scoped `<style>` block.** `test/chrome.test.js`'s `INLINE_STYLE_PAGES` is a
  hardcoded list and `test/compliance-pages.test.js` asserts its contents — adding a sixth entry is
  a gate change for no gain. Put every rule in `app.css`. Every `id` this page declares must match
  what `assignments.js` asks for, or `test/screens.test.js` fails.
- **VALIDATE**: `node --test test/screens.test.js test/chrome.test.js`
- **SATISFIES**: AC #1, AC #3

### CREATE `public/assignments.js`

- **IMPLEMENT**: The IIFE. Structure follows `counts.js` exactly:
  - `"use strict"`, a `COPY` object holding **every** visible string (loading, empty, failed,
    sessionExpired, saved, plus the state labels).
  - An `el` map resolved once at load via `document.getElementById`.
  - The `api(path, options)` helper with the content-type check — Cloudflare Access answers an
    expired session with the sign-in page's HTML at 200, so `res.json()` would throw a parse error
    and the screen would report a generic failure when the fix is "sign in again".
  - `Promise.all([api("/api/clients"), api("/api/assignments")])` on load; fill the `<select>` and
    render the table.
  - Render each row with `createElement` + `textContent`. **Never `innerHTML`.** A candidate name
    and a client name are text somebody typed, never markup.
  - The state cell computes the chip from the row: `ended`/`cancelled` → a muted "Ended" /
    "Cancelled"; an end date within 14 days → `.is-amber` with `"Ends in N days"` (and `"Ends
    today"` at zero); no end date → "Open"; otherwise a plain date. Compute days in **UTC** from the
    `YYYY-MM-DD` strings (`Date.parse(d + "T00:00:00Z")`), for the reason `src/prep/tokens.js:113-119`
    gives — a zone-less parse is local time, and across midnight in BST that is a whole day.
  - Form submit → `POST /api/assignments`, then re-render. Per-row actions → `PUT
    /api/assignments/<id>`: an "Extend" control that takes a new end date, and an "Ended" button.
  - **The lead time comes down the wire — there is no `14` in this file.** `GET /api/assignments`
    returns `lead_days` alongside `assignments`, sourced from `EXTENSION_LEAD_DAYS`. The browser
    cannot import `src/` (not in the Pages build output — `catalogue.js`'s header makes this
    argument), and a literal here would give the amber threshold a second home while the sweep kept
    the first, which is exactly what "thresholds live in the catalogue, not code" exists to
    prevent. Read it once into a module-scoped variable when the list loads.
- **PATTERN**: `public/counts.js` (whole file) for structure and comment register;
  `public/clients.js:90-118` for the `el` map convention.
- **IMPORTS**: none — this is a plain browser script, no modules on this deployment.
- **GOTCHA**: Nothing written to `localStorage`/`sessionStorage`, nothing person-shaped in the URL —
  the same two rules as `app.js`. Do **not** copy `counts.js`'s single-`fetch` assertion mindset
  across: this screen legitimately writes, so it will have GET and POST/PUT through one `api()`
  helper. The new page's source scan (next tasks) asserts *its own* rules, not `counts.js`'s.
- **VALIDATE**: `node --test test/screens.test.js test/assignments.test.js`
- **SATISFIES**: AC #1, AC #3, AC #4

### UPDATE `public/app.css`

- **IMPLEMENT**: The `.assignments-*` rules — table layout matching `.counts-table`, a `.is-amber`
  state chip on `background: var(--tint-warn)` with `color: var(--unverified)` (5.59:1, measured in
  `tokens.css:76`) or `var(--danger)` (8.01:1), a muted resolved chip, and the form layout.
- **PATTERN**: the existing `.counts-*` block; `tokens.css:67-87` for which tint carries which ink.
- **IMPORTS**: none.
- **GOTCHA**: **No raw hex anywhere** — `test/chrome.test.js` fails on one literal colour, and the
  reason is that branding on this product is a swap of `tokens.css`. **Any transition goes in the
  motion block at the foot**, inside the `prefers-reduced-motion: no-preference` guard — #58
  inverted that guard to opt-in, so a stray transition animates for someone who asked for no motion
  and nothing looks different to whoever is testing it. Use the 4px spacing scale (`--space-*`) and
  the type ramp (`--text-*`); nothing below 12px.
- **VALIDATE**: `node --test test/chrome.test.js test/tokens.test.js`
- **SATISFIES**: AC #3, AC #8

### UPDATE the topbar nav on `public/index.html`, `public/clients.html`, `public/counts.html`

- **IMPLEMENT**: Add `<a href="/assignments">Bookings</a>` to `.topbar-nav` on each, between "Prep
  sent" and "Candidate portal ↗". `aria-current="page"` stays static per file — each file knows
  which screen it is, and only `assignments.html` carries it on the new link.
- **PATTERN**: `public/counts.html:19-27`.
- **IMPORTS**: none.
- **GOTCHA**: Four files carry this nav once `assignments.html` exists; a nav that lists four
  screens on one page and three on another is the drift to avoid. No test gates nav consistency —
  check it by eye across all four.
- **VALIDATE**: `grep -c 'href="/assignments"' public/index.html public/clients.html public/counts.html public/assignments.html` → `1` for each.
- **SATISFIES**: AC #3

### UPDATE `DEPLOY.md`

- **IMPLEMENT**: Three edits.
  1. §5b or its neighbour: document `RECRUITER_EMAIL` — what it is (the one address the extension
     radar nudges), that it is a **plain environment variable and not a secret** (it is an address,
     not a credential), that it must be a single address with no comma, and that an unset value
     makes the radar a silent no-op by design rather than a broken send.
  2. The lazy-jobs section (~line 581-600): the extension sweep joins the reminder sweep on
     `/prep/*`, `scripts/remind.py` drives both, and the operator's assurance query is
     `SELECT count(*) FROM assignment WHERE nudge_sent_at IS NOT NULL`.
  3. The triage table: a row for "no extension nudges are arriving" → check `DB`,
     `RESEND_API_KEY`, `PREP_BASE_URL` and `RECRUITER_EMAIL`; the sweep bails **before claiming**
     unless all four are good, so nothing has been burned and it recovers on its own once fixed.
- **PATTERN**: the existing `PREP_BASE_URL` entry (~line 529) and the reminder-sweep paragraph
  (~line 581).
- **IMPORTS**: none.
- **GOTCHA**: Note the **migration** requirement too — production D1 must have `0010` applied before
  the deploy, or every `assignment` statement naming `nudge_sent_at` fails. `npm run db:remote`.
- **VALIDATE**: `grep -n "RECRUITER_EMAIL" DEPLOY.md` → at least two hits.
- **SATISFIES**: AC #6, AC #8

### UPDATE `scripts/remind.py`

- **IMPLEMENT**: Widen the docstring only. It now pokes **two** sweeps: the one reminder and the
  extension radar. Add the second assurance query
  (`SELECT count(*) FROM assignment WHERE nudge_sent_at IS NOT NULL`) beside the existing one, and
  update the one-line summary. **No code change** — `/prep/login` already runs the middleware, so a
  separate `nudge.py` would be duplication with a second thing to remember to run.
- **PATTERN**: the file's existing docstring.
- **IMPORTS**: none.
- **GOTCHA**: `npm run remind:remote` keeps its name. Renaming the script would break a documented
  operator habit for a cosmetic gain.
- **VALIDATE**: `python3 -c "import ast,sys; ast.parse(open('scripts/remind.py').read())"`
- **SATISFIES**: AC #6

### CREATE `test/extension-radar.test.js`

- **IMPLEMENT**: Real SQL through `node:sqlite`. The cases the fake cannot see:
  1. **The 14-day boundary, exactly.** Bookings ending at now+13, now+14, now+15 days: the first two
     are due, the third is not. Dates computed **by SQLite itself**, so fixture arithmetic and query
     arithmetic are the same arithmetic (`test/compliance-purge.test.js` states this rule).
  2. **Today is due**; **yesterday is not** (the `>= date('now')` clause).
  3. **NULL `end_date` is never due**, at any age.
  4. **`cancelled` and `ended` are never due**, even inside the window — the status inversion.
  5. **The claim is atomic**: two `claimExtensionNudge` calls on the same id → `true` then `false`,
     and the booking drops out of `dueExtensionNudges`.
  6. **The re-arm**: nudge a booking, `updateAssignment` with a later `end_date`, assert it is due
     again; then `updateAssignment` with `status: 'ended'` on a nudged booking and assert
     `nudge_sent_at` is **unchanged**.
  7. **Ordering** in `listAssignments`: resolved sinks, open sits below dated, soonest first.
  8. **The cascade still holds**: `deleteCandidate` takes the assignment and its `nudge_sent_at`
     with it (a one-line guard that the new column did not escape the cage).
  9. **Bail before claim**: call `sendDueExtensionNudges` with an env missing `RECRUITER_EMAIL` and
     assert nothing was claimed. Use a stub `fetch`/env, not a real send.
- **PATTERN**: `test/compliance-purge.test.js` (whole file) — `openMigrated`, `d1Shape`, `skip`, the
  SQLite-computed fixture dates, seeding through the production writers.
- **IMPORTS**: `{ d1Shape, openMigrated, skip }` from `./helpers/sqlite-d1.js`; the store functions;
  `EXTENSION_LEAD_DAYS`.
- **GOTCHA**: `node:sqlite` does not exist on Node 20 — every test skips there with the remedy in
  the message, exactly as `compliance-purge.test.js` does. **`PRAGMA foreign_keys`** must be on for
  the cascade case; `test/helpers/sqlite-d1.js` documents why that is non-optional. Seed through
  `createCandidate` / `createAssignment`, not raw INSERTs.
- **VALIDATE**: `node --test test/extension-radar.test.js`
- **SATISFIES**: AC #2, AC #4, AC #5, AC #7

### CREATE `test/assignments.test.js`

- **IMPLEMENT**: Two groups.

  **Routes (fake-d1):** POST rejects an unexpected body key with 400 `unexpected_fields`; POST
  rejects a rolled date (`2026-02-30`) with 400 and writes nothing; POST rejects an end date before
  the start date; **POST with an unknown `client_id` answers 404 and the recorded statement list
  contains no `INSERT` at all** (the orphan-candidate guard — the single most valuable assertion in
  this file); POST reuses an existing candidate rather than creating a second (assert the
  statement list contains no second `INSERT INTO candidate`); POST without `sameOrigin` → 403; GET
  returns `lead_days`; GET
  without `env.DB` → 503; PUT with an unknown id → 404; PUT with a bad status → 400; **PUT carrying
  `status` alone issues a statement that does NOT mention `nudge_sent_at`** (read the recorded SQL
  off `fakeD1().calls` — this is the route-level half of the re-arm rule, and the fake can see it
  exactly because it records the statement text).

  **Source scan (the page and its script):** `assignments.js` uses no `innerHTML`,
  `outerHTML`, `insertAdjacentHTML`, `document.write` or `eval`; reaches no `localStorage` /
  `sessionStorage` / `indexedDB`; requests only `/api/clients` and `/api/assignments` paths;
  `assignments.html` carries the script tag, the robots meta, no `maximum-scale`/`user-scalable=no`
  on the viewport, and **no `<style>` block**; and — the compliance-tree rule restated for a
  recruiter screen — **no `<input type="file">` and no upload control of any kind**, because
  metadata-only is spike #66's first decision and a booking screen is a plausible place for someone
  to add "attach the signed contract".
- **PATTERN**: `test/counts.test.js` for the source-scan idiom and its stated reason (the constraint
  is on what the file may *ask for*, not on what it happens to display);
  `test/compliance-pages.test.js` for the page-contract assertions and the no-upload rule;
  `test/prep-send.test.js` for the route-handler-with-a-fake-context shape.
- **IMPORTS**: `{ fakeD1 }` from `./helpers/fake-d1.js`; the route handlers; `readFileSync`.
- **GOTCHA**: `fake-d1` enforces bind parity — a statement whose `?` count and bind count disagree
  throws, which is a feature. Scope any forbidden-word scan **outside** the `COPY` object, as
  `counts.test.js` does: `COPY` is prose for a recruiter and prose may legitimately contain a word
  the code may not, and a gate that fails on a correct sentence gets deleted.
- **VALIDATE**: `node --test test/assignments.test.js`
- **SATISFIES**: AC #1, AC #3, AC #7, AC #9

### UPDATE `test/compliance-store.test.js`

- **IMPLEMENT**: Fake-d1 statement-shape assertions for the four new store functions: every user
  value is bound and nothing is interpolated; `listAssignments` and `dueExtensionNudges` name their
  columns and select no email and no `candidate_id`; `dueExtensionNudges` throws on a non-integer
  `leadDays` before any SQL runs; `updateAssignment` throws on an unknown status and on an empty
  patch; `updateAssignment` clears `nudge_sent_at` in the same statement that moves `end_date`.
- **PATTERN**: the file's existing per-function blocks.
- **IMPORTS**: the four new store functions.
- **GOTCHA**: This file asserts **statement shape**, not behaviour — the fake runs no SQL, so a `>`
  where `>=` was meant is invisible here. That is `extension-radar.test.js`'s job, and the split is
  deliberate. Do not try to test the boundary here.
- **VALIDATE**: `node --test test/compliance-store.test.js`
- **SATISFIES**: AC #7

### UPDATE `test/prep-email.test.js`

- **IMPLEMENT**: `sendExtensionNudgeEmail` — subject and body carry the candidate and client names;
  the date renders day-only (no `00:00:00`); a CR/LF in either name never reaches the subject; both
  `text` and `html` halves exist and the text half carries the URL as bare text; `escapeHtml` is
  applied (assert `<script>` in a client name comes back escaped); the link is `/assignments` and
  **never** a `/prep/*` path; no raw credential of any kind is logged.
- **PATTERN**: the file's existing `sendReminderEmail` and `sendInviteEmail` blocks, and the
  no-link assertion on `sendOtpEmail` — which stays exactly as it is.
- **IMPORTS**: `sendExtensionNudgeEmail`.
- **GOTCHA**: The existing three-emails assertions must all still pass untouched. If one breaks, the
  fourth email was added by changing a shared helper rather than beside them.
- **VALIDATE**: `node --test test/prep-email.test.js`
- **SATISFIES**: AC #6

### UPDATE `test/screens.test.js`

- **IMPLEMENT**: Add `["assignments", "public/assignments.js", "public/assignments.html"]` to the
  `SCREENS` array. Extend the comment above it: the scan is scoped to recruiter screens because
  `app.js` queries ids that live on `/prep` pages and on `404.html`.
- **PATTERN**: the two entries already there.
- **IMPORTS**: none.
- **GOTCHA**: The test asserts `ids.length > 0` — if `assignments.js` resolves elements some other
  way, this scan reads it wrong and the guard is checking nothing. Use `document.getElementById`, as
  the other two screens do.
- **VALIDATE**: `node --test test/screens.test.js`
- **SATISFIES**: AC #7

### RUN the full validation sweep

- **IMPLEMENT**: Every command in VALIDATION COMMANDS below, in order, on Node 24.
- **PATTERN**: —
- **IMPORTS**: —
- **GOTCHA**: On Node 20 the `node:sqlite` suites skip. A green run on Node 20 is **not** a green
  run — check the version before believing the result (`test/node-version.test.js` exists for
  exactly this).
- **VALIDATE**: `node --version && npm test`
- **SATISFIES**: AC #7, AC #9

---

## TESTING STRATEGY

The house splits tests by **what a given engine can actually see**, and this ticket must respect
that split or it will ship a boundary bug behind a green suite.

### Unit Tests

`node --test`, zero dependencies, `test/*.test.js` (the glob does not descend into `test/helpers/`).

- **`fake-d1` (`test/compliance-store.test.js`, `test/assignments.test.js`)** — records calls,
  **runs no SQL**. It proves: no user value reaches a SQL string, the bind count matches the `?`
  count, the projection names no forbidden column, and validation throws before any statement is
  prepared. It cannot prove a date comparison is right.
- **`node:sqlite` (`test/extension-radar.test.js`)** — real SQL over the real migrations. It proves
  the boundary arithmetic, the cascade, the claim's atomicity and the re-arm. Node 24 only; skips
  with a remedy message on Node 20.
- **Source scans (`test/assignments.test.js`)** — read the file text rather than a render, because
  the constraint is on what a file is *allowed to ask for*, not on what it happens to display today.

### Integration Tests

There is no separate integration runner. The equivalent here is:

- The route handlers driven end-to-end with `fakeD1` and a hand-built `context` (`test/prep-send.test.js`'s
  shape) — request in, `Response` out, status and body asserted.
- `sendDueExtensionNudges` driven with a stub env: assert bail-before-claim with each precondition
  missing in turn, and assert exactly one claim per due booking with a stubbed `fetch`.
- The live sweep against `wrangler pages dev` in Manual Validation below.

### Edge Cases

Every one of these must have a named test:

- End date at exactly **now + 14 days** (due) and **now + 15** (not due) — the `<=` boundary.
- End date **today** (due) and **yesterday** (not due) — the `>=` boundary.
- **`end_date` NULL** — never due, at any age, and sorts below dated bookings on the screen.
- Status **`cancelled`** / **`ended`** inside the window — never due (the inversion).
- **Two concurrent claims** on one booking — one `true`, one `false`.
- **Extend a nudged booking** → due again. **Resolve a nudged booking** → `nudge_sent_at` unchanged.
- **Extend by four days** while still inside the window → due again immediately. Assert it, so the
  accepted cost is a recorded decision rather than a surprise.
- **`2026-02-30`** at both date fields → 400, nothing written (the V8 date-roll trap).
- **End date before start date** → 400.
- **An unknown `client_id`** → 404, and **no `candidate` row and no `compliance_item` rows are
  created**. The orphan-candidate case: without the `getClient` guard this is a 500 plus nine rows
  of health-adjacent data nobody asked for, uncollectable for twelve months.
- **Clearing `end_date` via the PUT** → the booking reads "Open", stops being due, and its candidate
  is held indefinitely by `purgeDormant`. Assert the behaviour so the retention consequence is a
  recorded decision.
- **A second booking for the same candidate email** → reuses the candidate, does **not** re-seed the
  checklist, does not create a second `candidate` row.
- **A candidate name containing `\r\n`** → never reaches a mail header.
- **A candidate name containing `<script>`** → escaped in the html half, rendered as text on the page.
- **Missing `RECRUITER_EMAIL` / `RESEND_API_KEY` / `PREP_BASE_URL` / `DB`** → silent no-op, nothing
  claimed.
- **`RECRUITER_EMAIL` containing a comma** → refused (a second recipient nobody chose).
- **`deleteCandidate`** takes the assignment and its nudge stamp with it.

---

## VALIDATION COMMANDS

Execute every command to ensure zero regressions and 100% feature correctness.

### Level 1: Syntax & Style

There is no linter or formatter in this repo (zero dependencies beyond the Anthropic SDK). The
equivalent gates are structural tests:

```bash
node --version                          # MUST be >= 22.5 (package.json engines); node:sqlite suites skip below 24
node --check public/assignments.js
python3 -c "import ast; ast.parse(open('scripts/remind.py').read())"
node --test test/chrome.test.js         # no raw hex, no unguarded transition, no off-origin font
node --test test/tokens.test.js         # contrast floors on every pairing
node --test test/screens.test.js        # every id the script asks for exists in the page
```

Metadata-only, asserted structurally — the descope this epic exists to prevent:

```bash
grep -rniE "upload|multipart|FormData|<input[^>]*type=[\"']file|document_url|blob" \
  public/assignments.html public/assignments.js functions/api/assignments.js \
  functions/api/assignments/ src/compliance/ migrations/0010_assignment_nudge.sql \
  && echo "FAIL: a document-custody shape appeared" || echo "ok: metadata only"
```

### Level 2: Unit Tests

```bash
node --test test/schema.test.js            # the lockfile — one line moved, deliberately
node --test test/compliance-store.test.js  # statement shape, bind parity, projections
node --test test/assignments.test.js       # routes + page source scan
node --test test/prep-email.test.js        # the fourth email, and the other three unchanged
node --test test/prep-middleware.test.js   # the sweep is registered and fails open
```

### Level 3: Integration Tests

```bash
node --test test/extension-radar.test.js   # real SQL: boundary, cascade, claim, re-arm
npm test                                   # the whole suite — expect >= 928 passing, 0 failing
```

### Level 4: Manual Validation

```bash
npm run db:local            # apply migrations 0001..0010 to the local D1
npm run dev                 # wrangler pages dev
```

Then, in order:

1. **The screen loads.** Open `http://localhost:8788/assignments`. The Bookings nav entry appears on
   all four recruiter screens and is current on this one.
2. **Record a booking** ending in 20 days. It appears in the list, plain state, no amber.
3. **Record a booking** ending in 9 days. It sorts **above** the first and shows amber, "Ends in 9
   days".
4. **Record a second booking for the same candidate email.** Confirm one candidate row and one
   checklist:
   ```bash
   npx wrangler d1 execute dossier-engine --local --command \
     "SELECT (SELECT count(*) FROM candidate) AS candidates, \
             (SELECT count(*) FROM compliance_item) AS items, \
             (SELECT count(*) FROM assignment) AS bookings"
   ```
   Expect `candidates = 1`, `items = 8`, `bookings = 2` after three bookings across two candidates —
   adjust to your fixture, but the invariant is `items = 8 × candidates`.
5. **An unknown client leaves nothing behind.** Note the candidate count, POST a booking with a
   `client_id` that does not exist, expect **404**, then re-count:
   ```bash
   npx wrangler d1 execute dossier-engine --local --command \
     "SELECT (SELECT count(*) FROM candidate) AS candidates, \
             (SELECT count(*) FROM compliance_item) AS items"
   ```
   Both numbers must be **unchanged**. A 500 here, or a candidate count that went up by one, means
   the `getClient` guard is missing or is running after the first write.
6. **Bad input is a 400, never a 500.**
   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:8788/api/assignments \
     -H 'content-type: application/json' -H 'origin: http://localhost:8788' \
     -d '{"candidate_name":"A","candidate_email":"a@b.c","client_id":"<id>","start_date":"2026-09-01","end_date":"2026-02-30"}'
   ```
   Expect `400`. A `500` means the CHECK caught it instead of the route, which on this deployment
   reads as *deployment fault*.
7. **The sweep claims.** With no `RESEND_API_KEY` locally the send cannot happen — which is the
   point of testing the bail:
   ```bash
   curl -s -o /dev/null http://localhost:8788/prep/login
   npx wrangler d1 execute dossier-engine --local --command \
     "SELECT id, end_date, nudge_sent_at FROM assignment"
   ```
   Expect **every `nudge_sent_at` still NULL** — the sweep bailed before claiming because the key
   and `RECRUITER_EMAIL` are unset. That is the guard working. Then set `RESEND_API_KEY`,
   `PREP_BASE_URL` and `RECRUITER_EMAIL` in `.dev.vars`, poke `/prep/login` again, and expect the
   9-day booking (and only it) to gain a stamp.
8. **Idempotency.** Poke `/prep/login` five more times. `nudge_sent_at` does not change and no
   second mail is attempted.
9. **Extend re-arms.** PUT the nudged booking to an end date 40 days out. Confirm `nudge_sent_at`
   is back to NULL and the row is no longer amber. Poke again — it is not due (40 > 14).
10. **Resolve does not re-arm.** PUT another nudged booking to `status: "ended"`. Confirm
   `nudge_sent_at` is unchanged and the row sinks to the bottom of the list.
11. **Delete-now still takes everything.**
    ```bash
    npx wrangler d1 execute dossier-engine --local --command \
      "DELETE FROM candidate; SELECT count(*) AS orphans FROM assignment"
    ```
    Expect `0`.
12. **The prep portal is untouched.** `/prep/demo` still loads, the compliance passport still signs
    in, `/counts` still shows its two numbers.

### Level 5: Additional Validation (Optional)

- `mcp__jcodemunch__get_blast_radius` on `src/compliance/store.js` before merging, to confirm no
  caller outside the compliance tree and the new routes touched these functions.
- `mcp__jcodemunch__find_references` on `sendDueReminders` to confirm the new sweep sits beside it
  in exactly one place.
- `/code-review` on the branch before opening the PR.

---

## ACCEPTANCE CRITERIA

- [ ] **AC #1** — A recruiter can record a booking (candidate name, candidate email, client, start
      date, optional end date) from `/assignments`, and it writes one `assignment` row, reusing an
      existing `candidate` when the email matches and creating one (with its seeded checklist) when
      it does not.
- [ ] **AC #2** — Fourteen days before a booking's end date, exactly one email reaches
      `RECRUITER_EMAIL`, naming the candidate, the client and the end date (day-only), with a link
      to `/assignments`. Epic AC #4.
- [ ] **AC #3** — `/assignments` lists every booking, soonest-to-end first, with resolved bookings
      sunk to the bottom, an amber state inside the fourteen-day window, and "Open" for a booking
      with no end date.
- [ ] **AC #4** — A booking can be extended (a new end date) and the radar **re-arms**: the new
      deadline produces a new nudge.
- [ ] **AC #5** — A booking can be marked ended or cancelled, which stops it nudging and does not
      re-arm it.
- [ ] **AC #6** — The sweep is idempotent (one nudge per booking per deadline) and **bails before
      claiming** when `DB`, `RESEND_API_KEY`, `PREP_BASE_URL` or `RECRUITER_EMAIL` is missing —
      nothing is burned and it recovers by itself once configured. Documented in `DEPLOY.md`.
- [ ] **AC #7** — `npm test` passes on Node 24 with zero failures. Exactly **two** gates moved,
      each with a stated reason: `test/schema.test.js` (one column added to `assignment`'s lock)
      and `test/prep-middleware.test.js` (the `waitUntil` count, 1 → 2). `events.kind`'s
      vocabulary, the exact-tables lock and the ALTER self-guard are untouched.
- [ ] **AC #8** — The screen adds no raw hex, no unguarded transition and no page-scoped `<style>`
      block; every state colour is a measured `tokens.css` pairing.
- [ ] **AC #9** — Epic AC #6 holds: nothing in this ticket touches the pack engine's transience
      guarantee, the prep portal's no-behaviour-telemetry locks, `public/counts.js`, or
      `test/counts.test.js`.
- [ ] **AC #10** — Metadata only, structurally: no file input, no upload endpoint, no column named
      for a document anywhere this ticket touches. The Level 1 grep is clean.

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] All validation commands executed successfully
- [ ] Full test suite passes (unit + integration) on Node 24 — version checked, not assumed
- [ ] Manual sweep (Level 4, all twelve steps) confirms the feature works
- [ ] Acceptance criteria all met
- [ ] Migration `0010` applied locally; **the production/preview D1 deploy note is in the PR body**
- [ ] The `events.kind` divergence from the architecture doc is stated in the PR body, not buried
- [ ] `docs/epics/locum-fit-2.architecture.md` gains a short amendment recording the divergence, or
      the PR explicitly says why it does not
- [ ] PR body links `Closes #69` and names the gates that moved — `schema.test.js` (one column),
      `prep-middleware.test.js` (waitUntil 1 → 2), `screens.test.js` (a third screen registered)
      — with the reason for each

---

## OPEN QUESTIONS / ASSUMPTIONS

**Decided in session (3 Aug 2026), and the reason recorded here so the PR does not have to
re-argue it:**

**`events.kind` is NOT widened by this ticket.** The epic's architecture doc says telemetry is
"widened in the open (`extension_nudge_sent`, `expiry_nudge_sent`) exactly as #17 widened it". That
mechanism does not exist. #17 widened by `ALTER TABLE events ADD COLUMN kind … CHECK (…)`; you
cannot `ADD COLUMN` a second time to change one column's CHECK, and SQLite has no `ALTER
CONSTRAINT`. Widening it needs the 12-step table rebuild — which would break three assertions in
`test/schema.test.js` (the ALTER self-guard, because `RENAME TO` is not `ADD COLUMN`; the
exact-tables lock, because `events_new` is a sixteenth name; and the kind-vocabulary test), turning
the product's strongest safety gate from an accumulative parser into a statement-order simulator,
inside a ticket scoped as "extension radar".

The owner's call: **`assignment.nudge_sent_at` is the whole record of a sent nudge.** The supporting
argument, which is honest rather than merely convenient: an `events` row would be a *second* record
of the same fact with a *different lifetime* — `events` rows are deliberately non-personal so they
survive a purge, while a nudge belongs to a booking that dies with its candidate. Nothing in #69's
acceptance criteria needs a nudge count that outlives the cage.

**Open, and it belongs to #70's planner:** the expiry radar hits the identical wall for
`expiry_nudge_sent`. If the owner wants the vocabulary widened, it deserves its own ticket — a
schema-regime change with the lockfile rewrite as its actual body — not a rider on either radar.

**Assumptions this plan makes:**

1. **The Louis meeting has confirmed the extension-slippage framing.** #69 is `contingent` and the
   ticket says to confirm before starting. If it has not, this plan is ready and the ticket is not.
2. **One recruiter address, from the environment.** `RECRUITER_EMAIL`, not a new `agency` column —
   `agency`'s columns are locked in `test/schema.test.js` and `PREP_BASE_URL` / `PREP_MAIL_FROM` are
   the house pattern for operator configuration. If TTR wants per-consultant routing, that is a
   later decision with a real data model behind it.
3. **The 14-day lead is one number for every booking.** It lives in `catalogue.js` beside
   `amberDays` because the architecture doc puts thresholds there. Per-client lead times are not
   asked for.
4. **Dates are stored date-only** (`YYYY-MM-DD`), matching `compliance_item.expiry_date` and what
   `<input type="date">` submits. `assignment`'s CHECK accepts it and every query wraps it in
   `date()`. This diverges from `invite.interview_at`, which is a full UTC stamp because its
   retention arithmetic needs the seconds — a booking's does not.
5. **The email goes to the agency, and it names a candidate.** That is a recruiter-facing internal
   message, not candidate data leaving the building — but it is why the recipient must be a single
   operator-configured address with no comma in it.
6. **#71 will extend this screen, not replace it.** The compliance column, the verify actions and
   the at-risk flags belong there; leaving room for them is why this screen's projection is bookings
   and dates only.

**Questions that would change the plan if answered differently:**

- *Should a booking whose end date already passed unnudged get a late nudge?* This plan says no —
  it is a different message, and #71's at-risk list is the surface for "ended, unresolved". If the
  owner wants it, the `>= date('now')` clause comes out and the email copy needs a second tense.
- *Should extending inside the window re-nudge immediately?* This plan says yes, because the rule
  with no arithmetic is the one that stays correct. A quiet-period rule is possible and is
  deliberately not built.
- *Does the framework/audit retention question from the architecture doc's Open Questions
  (Magnit et al.) bear on `assignment` rows specifically?* If a framework imposes a minimum
  retention on booking records, the 12-month dormancy purge deletes evidence somebody is obliged to
  keep. Ask Louis; it does not block this ticket, but it could amend `purgeDormant`.

---

## NOTES (open canvas)

### Why a sibling screen and not a column on `/counts`

`test/counts.test.js` asserts that `counts.js` requests **exactly** `/api/clients` and
`/api/events`, issues **exactly one** `fetch`, and names none of a forbidden word list — which
includes `email`. A bookings list shows candidate names, so extending `/counts` means loosening a
privacy gate that exists to make a promise to a clinical staffing client structural. A sibling page
keeps that gate byte-for-byte and costs one file plus one nav entry. The ticket left the choice open
("`/counts` or a sibling list"); the gate decides it.

### Where the email lives — considered and rejected

`src/compliance/email.js` importing `sendEmail`/`mailFrom` from `../prep/email.js` was the
alternative, and it has a real argument: the compliance tree already duplicates the OTP door rather
than reaching into portal internals, so a compliance-owned message is consistent. Rejected because
`src/prep/email.js` currently holds a stronger invariant — *every email this product sends is in
this file, and the note at line 109 explains why each is different*. A fourth message in a second
file breaks that invariant to gain tidiness. The ticket also names `src/prep/email.js` as the seam
explicitly. Cost accepted: the module is prep-named and now carries a non-prep message; one sentence
in the widened note says so.

### Why one lazy slot and not two

A second trigger on `GET /api/assignments` was considered — the recruiter opening the screen would
drive the radar. Rejected: a recruiter already looking at the amber row does not need an email at
that instant, and two trigger sites are two places to keep in step. The honest cost of one slot is
written into the middleware comment: the radar's liveness depends on `/prep/*` traffic or the daily
`remind.py` poke, and a deployment with neither can let a booking pass its window unnudged. The
screen is the backstop, and the screen is always current because it computes state at render time
rather than reading a stamp.

### The re-arm is the non-obvious bug

Everything else in this ticket is a pattern already in the repo. The one thing with no precedent is
that `reminder_sent_at` guards a deadline that **cannot move** — an interview date is set once and
the invite dies after it — while `nudge_sent_at` guards one that **exists to move**. Extending is
the successful outcome of the nudge. If the claim is not cleared when `end_date` changes, the radar
succeeds once per booking ever and goes quiet exactly where it had just proved its value. Any
reviewer who has internalised `claimReminder` will read the clear as a mistake; the comment on
`updateAssignment` has to answer that reading before it is made.

### What this ticket quietly unblocks

#68 shipped the candidate passport behind a `DEMO_MODE` door because nothing created candidates. As
of this ticket, recording a booking creates the candidate and seeds their checklist — so the
passport becomes usable on a real deployment as a side effect. That is a good outcome and it should
be said out loud in the PR, because it also means **recording a booking is the moment a candidate's
health-adjacent compliance file starts existing**. The privacy notice #68 wrote already covers the
class and its retention; re-read it and confirm it still reads true from this new entry point.

### Sequencing note for parallel work

Phases 3 (sweep + email) and 4 (screen + routes) are independent once Phase 2 lands. They share only
`DEPLOY.md`. If the owner wants two worktrees, split there — but Phase 2's store functions must be
merged first, or both branches invent their own.

### Rough shape of the diff

| Area | Files | Lines (est.) |
|---|---|---|
| migration + lockfile | 2 | ~25 |
| store (4 functions) | 1 | ~140 incl. comments |
| sweep + email | 3 | ~160 |
| routes | 3 | ~200 |
| screen (html/js/css/nav) | 6 | ~320 |
| docs + script | 2 | ~40 |
| tests | 6 | ~400 |
| **total** | **23** | **~1,290 (~31% tests)** |

The ticket estimated ~500–800 lines at ~35% tests. This runs over, and the overrun is entirely the
recruiter surface — the ticket's own estimate did not price the create-a-candidate path that
`createAssignment`'s foreign key forces. If the owner wants it back inside the estimate, the cut is
the `PUT` endpoint and its screen controls (extend/resolve), deferring resolution to #71 — at the
cost of an amber row that stays amber forever, which is why this plan keeps it.

---

## CONFIDENCE

**9.5/10** for one-pass success.

What earns it: every layer is a pattern already in this repo, at a named file and line. The one
genuinely new decision (`events.kind`) is resolved before implementation starts. The gates that
would otherwise be discovered by failing — the schema lockfile, `screens.test.js`, `chrome.test.js`,
`counts.test.js`'s forbidden word list, `fake-d1`'s bind parity — are all named with what they will
say.

What holds it back from 10: the `updateAssignment` SET-clause assembly (the one place the "nothing
interpolated" contract needs care rather than copying) and the re-arm's interaction with the sweep
are the two spots where a careful implementer could still ship something subtly wrong. Both have
named tests.

---

## AMENDMENTS

- 2026-08-03 — created. `events.kind` widening resolved in session with the owner: **not** done by
  #69; `assignment.nudge_sent_at` is the sole record of a sent nudge, diverging deliberately from
  `docs/epics/locum-fit-2.architecture.md`'s "widened in the open … exactly as #17 widened it",
  because SQLite has no `ALTER CONSTRAINT` and the rebuild would rewrite `test/schema.test.js`.
