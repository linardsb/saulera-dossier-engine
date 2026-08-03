# Feature: the expiry radar — amber/red windows, candidate and recruiter nudges

The following plan should be complete, but its important that you validate documentation and
codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files
etc.

## Feature Description

`compliance_item` has held four facts since #67 — a status word, a reference number, an expiry
date, and when it was last touched — and until now nothing has ever read the date. #68 built the
door a candidate uses to write it; `public/prep/prep.css:440-444` even ships the amber and red
chips with a comment saying they **cannot render in that ticket** because nothing writes those two
statuses.

This ticket is what writes them. A lazy sweep, on the same seam as the portal purge and the
extension radar, reads every checklist row that carries a date, compares it against that item
type's own lead time from the catalogue, and moves it to `expiring` or `expired`. Each transition
it wins produces two messages: one to the candidate ("your DBS runs out — send us the new one")
linking into the passport, and one line in a single digest to the recruiter.

The whole ticket ships **without a migration**. The status transition *is* the claim: an item goes
`verified → expiring` exactly once, under a compare-and-swap that only one sweep can win, so the
column that records the state is the same column that makes the nudge idempotent. There is no new
stamp to add, no lockfile to change, and `test/schema.test.js` is untouched.

## User Story

As a **locum radiographer registered with a small agency**
I want to **be told before my DBS, my immunisations or my registration runs out, and be able to
update it from my phone**
So that **a booking is never refused because a certificate lapsed while nobody was watching**

And, on the other side of the same sweep:

As a **recruiter on a locum-heavy desk**
I want **one email listing whose paperwork just went amber or red**
So that **I chase the two that matter this week instead of discovering an expiry when the client
turns the candidate away**

## Problem Statement

The dossier's research on TTR (`docs/ttr-improvement-dossier.md` §2, §4-A) records that the agency
has **no expiry tracking at all** — compliance is "contact TTR for forms", and expiry dates are
discovered when a booking is refused. `docs/handover-louis-meeting.md:47` makes it the second
question to ask Louis: *"When did an expired DBS/training cert last cost you a booking, and how did
you find out?"*

The product now stores the dates (#67) and lets a candidate write them (#68) — but nothing reads
them. A locum can hand over an immunisation record expiring in three weeks, see a green
"Sent in" chip, and hear nothing until the booking dies. That is worse than not asking: the screen
currently implies someone is watching.

## Solution Statement

Three moving parts, each one a shape this repo already has:

1. **A per-item-type window, read from the catalogue.** `COMPLIANCE_CATALOGUE` already carries
   `amberDays` per item (60 for registration/DBS/right-to-work, 30 for immunisations/indemnity/
   fit-to-work) and `catalogue.js:12-16` already says the number exists for this ticket. The sweep
   reads it; nothing hardcodes a threshold.

2. **A compare-and-swap on `status`, which is the idempotency.** `UPDATE compliance_item SET
   status = ? WHERE id = ? AND status = ?`, binding the status the due query *observed*. Exactly
   one caller finds the row still in its old state, exactly as `claimReminder` and
   `claimExtensionNudge` do — with no new column, because the state the sweep writes is the record
   that it fired.

3. **Two emails on the Resend seam, both grouped.** The candidate gets one message listing every
   item of theirs that changed in this sweep, linking to `/prep/compliance/login`. The recruiter
   gets one digest listing every transition across every candidate. An item can produce at most two
   candidate emails in its whole life per expiry date — one at amber, one at red — which is the
   frequency cap, structurally rather than by a counter.

**The state sweep is awaited; only the mail is deferred.** This is the one place this ticket
deliberately diverges from #69's shape, and the reason is in §"Patterns to Follow" below: for the
extension radar the claim guarded a courtesy email and `public/assignments.js` computed amber at
render time, so the screen stayed true whatever the mail configuration was. Here the claim **is**
the product state the passport renders. Gating it on `RECRUITER_EMAIL` — which is what a naive copy
of `sendDueExtensionNudges` would do — would mean a deployment without a recruiter address never
shows a candidate that their certificate lapsed.

## Out of Scope / Non-Goals

- **No recruiter screen.** #71 owns the compliance dashboard, the verify actions and the at-risk
  list. This ticket's only recruiter surface is the digest email, and it deliberately carries **no
  link** — there is nothing to link to yet, and `/assignments` shows bookings and dates with no
  compliance state on purpose (`src/compliance/store.js`, `listAssignments`).
- **No HCPC API integration.** See Open Questions: spike #66 resolved the conditional to *in,
  non-blocking* — the Employer Check API has been applied for and not granted. The interim
  one-click Multiple Registrant Search is a recruiter control and #71 owns the only screen it can
  live on. Nothing about that is descoped by this plan; it is blocked on an external grant and on a
  surface that does not exist yet.
- **No migration, and no `events` row.** Inherited from the architecture doc's 3 Aug amendment; the
  full argument is in Open Questions. `test/schema.test.js` is not edited by this ticket, and that
  is a property to assert in the PR rather than a coincidence.
- **No new catalogue item.** `mandatory_training` is not added — see Open Questions for the
  pre-costed one-line diff if the owner wants it.
- **No document custody.** Metadata-only holds. Nothing here accepts, stores, links to or mentions
  a file.
- **Not changing** the passport's UI, `functions/prep/compliance/api/items.js`, the two purges, the
  reminder sweep, or the extension radar. The passport already renders all five states; this ticket
  makes two of them reachable.
- **No re-nudge for an item that sits amber for weeks.** One message per state change. Decision 17's
  ethos: a courtesy, not a campaign.

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: Medium
**Primary Systems Affected**: `src/compliance/` (store + sweep), `src/prep/email.js`,
`functions/prep/_middleware.js`, the DEMO_MODE seed, DEPLOY.md, `scripts/remind.py`
**Dependencies**: none new. Resend (existing seam), D1, `node:sqlite` for the arithmetic tests.

## Related Work

**Implements**: [#70](https://github.com/linardsb/saulera-dossier-engine/issues/70) ·
**Epic**: [#65](https://github.com/linardsb/saulera-dossier-engine/issues/65) ·
**Architecture**: [`docs/epics/locum-fit-2.architecture.md`](../../docs/epics/locum-fit-2.architecture.md)
(spike #66's deliverable — read the "Data model" bullet and its 3 Aug amendment before starting)

**Back-references** (plans this builds on and inherits decisions from):

- `.claude/plans/compliance-data-layer.md` (#67) — Why: the cage, the catalogue, `setItemState`,
  the five-state vocabulary and the CHECK that closes it.
- `.claude/plans/candidate-compliance-passport.md` (#68) — Why: the candidate door, the items API
  that already returns `amber_days` as this ticket's seam, and the chip CSS that ships unrenderable
  waiting for this sweep.
- `.claude/plans/extension-rebooking-radar.md` (#69) — Why: **the closest precedent in the repo.**
  The claim-then-send shape, the `recipient()` validator, the lazy-slot argument, and the
  `events.kind` wall this ticket inherits. Read its Open Questions section in full.
- `.claude/plans/day-before-mode-and-reminder.md` (#25) — Why: `sendDueReminders` is the original
  at-most-once sweep and `src/compliance/nudges.js` is its restatement.

**Forward-references**:

- #71 (recruiter compliance dashboard) — will add the at-risk list, the verify action, and the link
  this ticket's digest deliberately does not carry. It will also be where the HCPC manual-search
  control lands.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

**The three files you will spend the most time in:**

- `src/compliance/store.js` (whole file, 624 lines) — Why: the two new statements go in it, and its
  header states the contract every function obeys (D1-shaped `db` first, no HTTP, no env, nothing
  interpolated into SQL). Read `dueExtensionNudges` (lines 192-247) and `claimExtensionNudge`
  (249-271) closely — the new pair is those two at a different root. `setItemState` (374-402) is
  what the sweep must **not** call, and why.
- `src/compliance/nudges.js` (whole file, 107 lines) — Why: the sweep's two new functions live
  **here**, not in a new file. `baseUrl()` and `recipient()` are private to this module and
  `recipient()` is the validator that stops a comma in `RECRUITER_EMAIL` from adding a second
  recipient to a message naming candidates. Copying it would be the `equalHex` mistake
  (`store.js:444-445`), not the sanctioned OTP duplication.
- `src/prep/email.js` (whole file, 366 lines) — Why: the two new senders go here, and the
  "FOUR EMAILS, FOUR RULES, ON PURPOSE" block (lines 109-137) is the contract they join. It becomes
  six. `sendExtensionNudgeEmail` (327-366) is the template for header safety on an
  agency-authored name; `sendReminderEmail` (268-301) is the template for a plain portal-entry link
  with no token.

**The data and the vocabulary:**

- `src/compliance/catalogue.js` (whole file, 53 lines) — Why: `amberDays` is this ticket's input and
  lines 12-16 were written for it. `ITEM_STATUSES` (39) is the closed five. `EXTENSION_LEAD_DAYS`
  (53) shows where a derived threshold belongs and why the browser cannot import this file.
- `migrations/0008_compliance.sql` — Why: `compliance_item`'s exact shape, including the
  `CHECK (status IN (...))` that would reject a sixth state at write time, and the
  `CHECK (expiry_date IS NULL OR datetime(expiry_date) IS NOT NULL)` that guarantees every non-null
  date is one SQLite can compare.
- `migrations/0010_assignment_nudge.sql` — Why: read the "AND NO `events` ROW FOR A SENT NUDGE"
  paragraph. That argument is inherited verbatim by this ticket.

**The seam this rides:**

- `functions/prep/_middleware.js` (whole file, 63 lines) — Why: the lazy-jobs slot, and the header
  states exactly which jobs are awaited and which ride `waitUntil`, with the reason for each. This
  ticket adds one of each.
- `src/prep/reminders.js` (whole file, 65 lines) — Why: the original at-most-once sweep, and the
  "a sweep that cannot send must not claim" rule this ticket **deliberately applies only to the
  mail half**.
- `scripts/remind.py` (whole file) — Why: the assurance poke. One GET drives every sweep on the
  slot; its docstring is the operator's record of what runs, and this ticket makes it three.

**The surfaces that already understand the two new states:**

- `public/prep/prep.css` lines 425-444 — Why: `.mark-expiring` and `.mark-expired` already exist
  with a comment saying they cannot render until this sweep. **Do not add CSS.** Delete nothing.
- `public/prep/compliance/passport.js` lines 52-67 — Why: `COPY.chip` and `COPY.meaning` already
  carry both states in plain language ("Expiring" / "This runs out soon — send us the new one").
  **Do not add copy.** The page is already correct; the sweep makes it true.
- `functions/prep/compliance/api/items.js` lines 62-75 — Why: it already returns `amber_days` with
  the comment "#70's seam. Nothing here computes an amber window or writes 'expiring'". **This
  route is not edited.** It passes `status` straight through, so a swept row renders itself.
- `functions/prep/compliance/api/item.js` lines 22-25 and 63-80 — Why: **the re-arm already
  exists.** Re-submitting an item writes `submitted` with a fresh date, so a renewal automatically
  drops out of `expiring` and back into the pool. This is the counterpart of `updateAssignment`'s
  clear, and it needs no code in this ticket — only a test that proves it.

**The tests to mirror:**

- `test/extension-radar.test.js` (whole file, 311 lines) — Why: **the template for the new test
  file.** Every fixture date is computed by SQLite itself; the header (lines 1-19) says why, and it
  matters more here than there. The `sweep()` helper (253-267) stubs `fetch` and reports what was
  sent; copy its shape.
- `test/compliance-store.test.js` lines 443-561 — Why: the statement-level half. `fakeD1` runs no
  SQL and always returns `changes: 1`, so it can prove what is bound and what is projected and
  **cannot** prove the compare-and-swap. Both halves are needed.
- `test/prep-middleware.test.js` (whole file, 138 lines) — Why: its header explains why the radar is
  registered second and `captured[0]` is still the reminder. The mail half of this ticket goes
  third for the same reason.
- `test/helpers/sqlite-d1.js` — Why: `openMigrated()`, `d1Shape()`, `skip`, and the
  `PRAGMA foreign_keys = ON` gotcha that makes the cascade assertion mean anything.
- `test/helpers/fake-d1.js` lines 33-45 — Why: bind-parity is enforced. A statement that gains or
  loses a `?` fails loudly, which is why literal SQL fragments carrying no placeholder are safe and
  a templated value is not.

**Documentation to update:**

- `DEPLOY.md` lines 449-453 (the triage table), 573-595 (`RECRUITER_EMAIL`), 625-655 (the extension
  nudge section) — Why: this ticket adds a third sweep to the same slot and one triage row, and it
  must amend the `RECRUITER_EMAIL` section to say that **state transitions do not depend on it**.

### New Files to Create

- `test/expiry-radar.test.js` — the arithmetic, the compare-and-swap and the two grouped sends,
  against real SQLite. `test/extension-radar.test.js`'s counterpart.

That is the whole list. **No new source file, no new route, no new page, no migration.**

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [SQLite date and time functions](https://www.sqlite.org/lang_datefunc.html)
  - Specific sections: `date()`, `julianday()`, and the modifier syntax `'+N days'`
  - Why: the whole radar is one comparison. `julianday(date(a)) - julianday(date(b))` between two
    date-only values is an **exact** integer (both operands land on the same half-day offset), which
    is what lets the query hand JavaScript a `days_left` integer instead of making JavaScript do
    date arithmetic on a second clock.
- [SQLite `UPDATE`](https://www.sqlite.org/lang_update.html) and
  [`changes()`](https://www.sqlite.org/lang_corefunc.html#changes)
  - Why: the compare-and-swap's whole correctness is that `changes` is 0 for the loser. D1 surfaces
    it as `result.meta.changes`.
- [Cloudflare Pages Functions — `context.waitUntil`](https://developers.cloudflare.com/pages/functions/api-reference/#eventcontext)
  - Why: the mail half rides it; the state half must not. Work registered with `waitUntil` may
    outlive the response, which is exactly wrong for state the next request renders.
- [Resend — send an email](https://resend.com/docs/api-reference/emails/send-email)
  - Why: `sendEmail` is already the only caller; the two new senders go through it and add nothing
    to its error posture.
- `docs/epics/locum-fit-2.architecture.md` — "Data model (shape level)" bullet **and its AMENDED
  block** — Why: the amendment is addressed to this ticket by name.

### Patterns to Follow

**Every threshold comes from the catalogue, never from code.**

```js
// src/compliance/catalogue.js — the existing precedent, for the booking lead time:
export const EXTENSION_LEAD_DAYS = 14;
```

This ticket adds a **derived** one beside it. Derived, not typed:

```js
export const MAX_AMBER_DAYS = Math.max(...COMPLIANCE_CATALOGUE.map((item) => item.amberDays ?? 0));
```

Writing `60` there instead would mean retuning any item to 90 days silently drops it out of the
sweep's narrowing window — the exact failure "thresholds live in the catalogue, not code" exists to
prevent, and it would fail *silently*, which is worse.

**The store's contract (`src/compliance/store.js:13-15`):**

> Every function takes a D1-shaped `db` as its first argument. No HTTP, no Response, no env. Every
> user value is a bound parameter; nothing is ever interpolated into a SQL string.

A status list written as a literal in the SQL text is fine and has precedent
(`dueExtensionNudges`' `status IN ('booked','active')`, defended at line 209-210: "a status list is
not a bound value and must not be interpolated into SQL"). Building that list from a JS array is
not.

**A number that is ours is still bound (`dueExtensionNudges`, lines 222-227):**

```js
if (!Number.isInteger(leadDays) || leadDays <= 0) {
  throw new StoreError("missing_fields", 400, "leadDays: must be a positive integer");
}
// ... AND date(a.end_date) <= date('now', '+' || ? || ' days')
```

The guard is not decoration: without it SQLite builds a modifier it cannot read and the comparison
silently yields NULL — a sweep that finds nothing and reports success.

**The claim, three times over in this repo:**

```js
// src/portal/store.js — claimReminder
// src/compliance/store.js:262-271 — claimExtensionNudge
UPDATE assignment SET nudge_sent_at = datetime('now') WHERE id = ? AND nudge_sent_at IS NULL
```

The new one is the same move with the guard on a *value* rather than on NULL, and **the value must
be the one the due query observed**:

```js
UPDATE compliance_item SET status = ? WHERE id = ? AND status = ?
```

This is the single most likely thing for a reviewer to "tidy" into
`WHERE id = ? AND status IN ('submitted','verified')`. Do not let them: the narrow guard is what
makes a renewal landing between the read and the write win. The candidate re-submits, `setItemState`
writes `submitted` with a new date, the sweep's `changes` comes back 0 and it correctly does
nothing — where the broadened version would stamp an amber flag over a certificate that was just
renewed.

**At-most-once, never rolled back (`src/compliance/nudges.js:18-23`):**

> The claim is never rolled back on a send failure: "exactly one nudge" outranks delivery, and a
> rollback-and-retry could double-send when Resend accepted but the response read failed. A failed
> send is logged (status only, never the recipient, never the candidate's name) and that booking is
> simply skipped.

Inherited unchanged, with one honest difference stated in the header of the new code: for #69 the
claim column recorded *that a nudge was sent*. Here the status records *that the item changed
state*, and a failed send leaves the state moved with no email behind it. The operator assurance
query is therefore a count of states, not of sends.

**The lazy slot's two tiers (`functions/prep/_middleware.js:1-10`):**

> The purge is awaited BEFORE next(), because an expired invite must not serve one last time at
> +31 days [...] The sends themselves ride waitUntil: the response has no ordering dependency on
> them.

Apply that rule as written rather than by analogy with #69: the expiry **state** sweep is a purge in
this taxonomy (it decides what the next handler renders), and the expiry **mail** is a send.

**Header safety on any value reaching a subject line (`sendExtensionNudgeEmail`, lines 331-336):**

```js
const header = (value) =>
  String(value ?? "").replace(CONTROLS, " ").trim().slice(0, NAME_MAX).trim();
```

Catalogue labels are ours and safe; `candidate.full_name` is agency-entered and takes this
treatment.

**Text nodes and escaped HTML, never markup (`escapeHtml`, line 78):** both halves of every message.

**Every visible string in one place.** `email.js` inlines its copy per sender; the passport uses a
`COPY` object. Follow the file you are in.

---

## IMPLEMENTATION PLAN

### Phase 1: Foundation — the derived threshold and the sweep's vocabulary

One line of data and one exported constant, so nothing downstream types a number.

**Tasks:**

- Derive `MAX_AMBER_DAYS` from `COMPLIANCE_CATALOGUE` in `src/compliance/catalogue.js`.
- Export `EXPIRY_STATES` — the two states this sweep is allowed to write — beside `ITEM_STATUSES`,
  so the store can refuse `verified` structurally rather than by convention.

### Phase 2: Core Implementation — the two statements

**Depends on:** Phase 1 (the store validates `to` against `EXPIRY_STATES`).

**Tasks:**

- `dueExpiryItems(db, maxAmberDays)` — every checklist row carrying a date inside the widest window
  or already past it, with the candidate's name and address joined on, and **`days_left` computed by
  SQLite** so no JavaScript ever compares two clocks.
- `claimItemExpiry(db, { id, from, to })` — the compare-and-swap.

### Phase 3: The sweep and the two emails

**Depends on:** Phase 2.

**Tasks:**

- `sweepExpiryStates(db)` in `src/compliance/nudges.js` — decides the target state per row from the
  catalogue, claims each transition, returns what it won. **Takes `db`, not `env`**: it is the half
  that must run on a deployment with no mail configuration at all.
- `mailExpiryNudges(env, claimed)` in the same file — groups by candidate, sends, and sends the
  digest. Two independent config guards, because the two messages have independent configuration.
- `sendExpiryNudgeEmail` and `sendExpiryDigestEmail` in `src/prep/email.js`; the four-emails note
  becomes six.

### Phase 4: Integration — the lazy slot and the demo

**Depends on:** Phase 3.
**Independent of:** Phase 5's docs tasks (they can be written in parallel).

**Tasks:**

- `functions/prep/_middleware.js`: await the state sweep beside the purges, register the mail third
  on `waitUntil`.
- `functions/prep/compliance/demo.js`: seed one item into the amber window so the demo persona's
  flag is real.

### Phase 5: Documentation and the assurance path

**Tasks:**

- `DEPLOY.md`: the third sweep, a triage row, and the correction to the `RECRUITER_EMAIL` section.
- `scripts/remind.py`: the docstring now describes three sweeps and carries the state-count
  assurance query.

### Phase 6: Testing & Validation

**Tasks:**

- `test/expiry-radar.test.js` (new) — the arithmetic and the claim against real SQLite.
- `test/compliance-store.test.js` — the two new statements against the recording fake.
- `test/prep-email.test.js` — the two new messages.
- `test/prep-middleware.test.js` — the awaited half is awaited, the deferred half is deferred.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently
testable.

### Task Format Guidelines

- **CREATE**: New files or components
- **UPDATE**: Modify existing files
- **ADD**: Insert new functionality into existing code
- **MIRROR**: Copy pattern from elsewhere in codebase

---

### UPDATE `src/compliance/catalogue.js`

- **IMPLEMENT**: Two exports at the foot of the file, after `EXTENSION_LEAD_DAYS`.

  ```js
  /**
   * The two states the expiry sweep is allowed to write (#70).
   *
   * A subset of ITEM_STATUSES rather than a second list: `missing` is the candidate's starting
   * state, `submitted` is theirs to write and `verified` is the recruiter's (#71). A sweep that
   * could write `verified` would let a clock mark a document as checked, which is the one thing
   * in this epic that has to mean a person looked. src/compliance/store.js validates against
   * this, so that is structural rather than a convention.
   */
  export const EXPIRY_STATES = ["expiring", "expired"];

  /**
   * The widest amber window any item declares — the sweep's narrowing bound.
   *
   * DERIVED, never typed. A literal 60 here would mean retuning `hcpc_registration` to 90 days
   * silently drops it out of the query's window and the radar goes quiet for that item with no
   * error anywhere: exactly the failure "thresholds live in the catalogue, not code"
   * (architecture, "Data model") exists to prevent. `?? 0` covers the `expires: false` rows,
   * whose amberDays is null.
   */
  export const MAX_AMBER_DAYS = Math.max(...COMPLIANCE_CATALOGUE.map((item) => item.amberDays ?? 0));
  ```

- **PATTERN**: `src/compliance/catalogue.js:41-53` (`EXTENSION_LEAD_DAYS` — a threshold beside the
  array rather than inside it, with the reason written down).
- **IMPORTS**: none — this file has no imports by design (line 6).
- **GOTCHA**: `Math.max()` of an empty array is `-Infinity`. The catalogue is never empty and the
  test below asserts `MAX_AMBER_DAYS` is a positive integer, which catches it if it ever is.
- **VALIDATE**: `node -e "import('./src/compliance/catalogue.js').then(m => console.log(m.MAX_AMBER_DAYS, m.EXPIRY_STATES))"` → prints `60 [ 'expiring', 'expired' ]`
- **SATISFIES**: AC #1 (thresholds come from the catalogue), AC #7 (no new state can be written).

---

### ADD `dueExpiryItems` to `src/compliance/store.js`

- **IMPLEMENT**: A new section after the extension radar's four functions and before the "the cage's
  own door (#68)" block, opened with the same banner comment style:

  ```js
  // ── the expiry radar (#70) ─────────────────────────────────────────────────────────────
  //
  // `compliance_item.expiry_date` was written by #67 and read by nobody: the passport renders it
  // as a line of text and public/prep/prep.css ships the amber and red chips with a comment
  // saying they cannot render until this sweep exists. These two functions are the sweep's whole
  // database half.

  /**
   * Every checklist row that carries a date worth looking at, with the arithmetic already done.
   *
   * Five clauses and one computed column, and each is a decision:
   *
   *   1. `expiry_date IS NOT NULL` — an item with no date has no deadline. Non-expiring items
   *      (`references`, `wtr_choice`) can never gain one: functions/prep/compliance/api/item.js
   *      answers 400 for a date on an item the catalogue marks `expires: false`.
   *   2. `status IN ('submitted','verified','expiring')` — the three states a transition can
   *      start from. `missing` carries no date, and `expired` is terminal: an item cannot get
   *      more expired, and re-entering the pool is what a renewal does by writing `submitted`.
   *      The literals are written out here rather than interpolated from ITEM_STATUSES for
   *      `dueExtensionNudges`' reason (line 209-210): a status list is not a bound value.
   *   3. `date(expiry_date) <= date('now', '+' || ? || ' days')` with MAX_AMBER_DAYS bound —
   *      the WIDEST window any item declares, not each item's own. Per-item thresholds cannot be
   *      one comparison (they differ by item_key), and a CASE built from the catalogue array
   *      would be a string-built statement at the centre of this file's no-interpolation rule.
   *      So SQL narrows to a small candidate set and the caller applies the per-item number.
   *      Everything this over-selects is discarded by `targetFor` returning null.
   *   4. `date()` and not `datetime()` — DAY granularity, `isNotPast`'s argument
   *      (src/prep/dates.js): a certificate valid to the 3rd is valid all day on the 3rd.
   *   5. The JOIN reaches `candidate` for two columns this store has been careful never to
   *      project together before. `candidateBySessionHash` takes two and no third; this takes
   *      the name because the recruiter's digest names who to chase, and the address because
   *      the candidate's own nudge has to reach them. Both are needed by the caller and neither
   *      is ever logged — src/compliance/nudges.js logs a status code and nothing else.
   *
   * `days_left` IS THE POINT OF THIS QUERY. The amber/red decision needs today's date, and
   * computing it in JavaScript would compare SQLite's clock (the WHERE) against V8's (the
   * decision) — the ±1-day flip near midnight UTC that test/extension-radar.test.js's header
   * calls "worse than no test". Both operands are date-only, so their julianday difference is an
   * exact integer and the CAST truncates nothing. Negative means lapsed; 0 means today.
   *
   * `maxAmberDays` is ours and never a caller's, and it is still bound rather than templated —
   * `dueExtensionNudges`' idiom, Number.isInteger guard included, because that guard is what
   * makes SQLite's `'+' || ? || ' days'` produce a modifier it can read rather than a silent
   * NULL.
   */
  export async function dueExpiryItems(db, maxAmberDays) {
    if (!Number.isInteger(maxAmberDays) || maxAmberDays <= 0) {
      throw new StoreError("missing_fields", 400, "maxAmberDays: must be a positive integer");
    }
    const { results } = await db
      .prepare(
        `SELECT i.id, i.candidate_id, i.item_key, i.status, i.expiry_date,
                CAST(julianday(date(i.expiry_date)) - julianday(date('now')) AS INTEGER) AS days_left,
                candidate.full_name AS candidate_name,
                candidate.email     AS candidate_email
           FROM compliance_item i
           JOIN candidate ON candidate.id = i.candidate_id
          WHERE i.expiry_date IS NOT NULL
            AND i.status IN ('submitted', 'verified', 'expiring')
            AND date(i.expiry_date) <= date('now', '+' || ? || ' days')
          ORDER BY date(i.expiry_date), i.candidate_id, i.item_key`,
      )
      .bind(maxAmberDays)
      .all();
    return results ?? [];
  }
  ```

- **PATTERN**: `src/compliance/store.js:225-247` (`dueExtensionNudges`) — same shape, same guard,
  same named-columns-never-`SELECT *` discipline, same ordered result.
- **IMPORTS**: none new — `StoreError` is already imported at line 17.
- **GOTCHA**: the `ORDER BY` is `date(expiry_date)` first, so one candidate's items may be
  non-adjacent in the result. The caller groups with a `Map`, which preserves insertion order, so
  each candidate's own list stays soonest-first. Do not "fix" the ordering to candidate-first: the
  digest reads best in deadline order and the grouping does not need adjacency.
- **VALIDATE**: `node --test test/compliance-store.test.js`
- **SATISFIES**: AC #1.

---

### ADD `claimItemExpiry` to `src/compliance/store.js`

- **IMPLEMENT**: Directly after `dueExpiryItems`:

  ```js
  /**
   * Claim one item's state change. `claimExtensionNudge`'s move with the guard on VALUES rather
   * than on NULL, and the whole reason this ticket needs no migration: the status the sweep
   * writes IS the record that it fired, so there is no second stamp to add and no lockfile to
   * change.
   *
   * THE WHERE CARRIES BOTH OBSERVED VALUES, AND THE DATE IS THE LOAD-BEARING ONE. The obvious
   * guard is `WHERE id = ? AND status = ?`, and it is not enough — because
   * functions/prep/compliance/api/item.js ALWAYS writes `submitted`, so the ordinary renewal is
   * `submitted → submitted` with a new date and a status-only guard matches it:
   *
   *     sweep reads   {id: 5, status: 'submitted', expiry_date: '2026-09-01', days_left: 29}
   *     candidate renews          status='submitted', expiry_date='2028-01-01'
   *     status-only CAS matches → status='expiring' over a date two years out
   *
   * The card would then read "Expiring · This runs out soon · Runs out 1 January 2028", the
   * candidate's email would name a date no longer in the database, and it would be STICKY: the
   * next sweep does not select that row at all (2028 is outside every window), so nothing heals
   * it short of another manual re-submit. The window is not incidental either — the middleware
   * runs this sweep on every /prep/* request including prep.css and passport.js, so a candidate
   * sitting on the passport has sweeps in flight while their renewal POST is being handled.
   *
   * Binding `expiry_date` closes it, because A RENEWAL ALWAYS WRITES A NEW DATE — that is what
   * makes it a renewal. A re-submit that only corrects a typo'd reference number keeps the same
   * date and the claim still wins, which is right: nothing about the deadline changed.
   *
   * The other tempting tidy-up is `WHERE id = ? AND status IN ('submitted','verified')`. Same
   * failure, wider: it would stamp an amber flag over a certificate renewed thirty seconds ago.
   * There is no transaction on D1; this pair of bound values is what makes "one nudge per state
   * change" structural rather than hopeful.
   *
   * `to` is checked against EXPIRY_STATES and not ITEM_STATUSES: a sweep that could write
   * `verified` would let a clock mark a document as checked.
   *
   * IT DOES NOT STAMP `checked_at`, deliberately. That column means "when did a person last
   * touch this" — `setItemState` stamps it for the candidate's submit and for #71's verify — and
   * overwriting it with the moment a sweep read a date would destroy the one fact the recruiter
   * dashboard wants. The sweep's answer is fully derivable from `status` and `expiry_date`
   * already, so it needs no stamp of its own.
   *
   * The id guard fails closed for the same reason claimExtensionNudge's `String(id ?? "")` does:
   * an `undefined` bind is a D1 error. `compliance_item.id` is an INTEGER PRIMARY KEY rather
   * than a text id, and the bigint branch is there because a SQLite driver may hand an integer
   * column back as one — see the GOTCHA on this task.
   */
  export async function claimItemExpiry(db, { id, from, to, expiryDate } = {}) {
    const rowId = typeof id === "bigint" ? Number(id) : id;
    if (!Number.isInteger(rowId)) {
      throw new StoreError("missing_fields", 400, "id: must be an integer");
    }
    requireFields({ expiryDate });
    requireOneOf("from", from, ITEM_STATUSES);
    requireOneOf("to", to, EXPIRY_STATES);
    const result = await db
      .prepare("UPDATE compliance_item SET status = ? WHERE id = ? AND status = ? AND expiry_date = ?")
      .bind(to, rowId, from, expiryDate)
      .run();
    return (result.meta?.changes ?? 0) === 1;
  }
  ```

- **PATTERN**: `src/compliance/store.js:262-271` (`claimExtensionNudge`) and `requireOneOf`
  (48-52).
- **IMPORTS**: widen the existing catalogue import at line 19 to
  `import { COMPLIANCE_CATALOGUE, EXPIRY_STATES, ITEM_KEYS, ITEM_STATUSES } from "./catalogue.js";`
- **GOTCHA**: two of them.
  1. `result.meta?.changes` with the optional chain, matching `claimExtensionNudge`. `setItemState`
     uses `result.meta.changes` without it; both work against D1 and the fake — follow the claim's
     form, since this is a claim.
  2. **Confirm the type of `row.id` under Node 24 before trusting the guard.** `Number.isInteger`
     is stricter than any existing store guard (`claimExtensionNudge` takes `String(id ?? "")`),
     and `test/helpers/sqlite-d1.js` wraps `run()`'s `changes` in an explicit `Number()` — a hint
     that integer columns do not always arrive as `number` through that path. The `typeof id ===
     "bigint"` branch covers it; if `.all()` turns out to return plain numbers on both D1 and
     `node:sqlite`, the branch is harmless and stays as the fail-safe. Add
     `assert.equal(typeof rows[0].id, "number")` to `test/expiry-radar.test.js` so the answer is
     recorded rather than assumed. A guard that throws here kills the whole sweep, not one row.
- **VALIDATE**: `node --test test/compliance-store.test.js test/expiry-radar.test.js`
- **SATISFIES**: AC #2, AC #3, AC #7.

---

### ADD `sendExpiryNudgeEmail` to `src/prep/email.js`

- **IMPLEMENT**: A new section at the foot of the file, and **first** amend the four-emails note.

  The block at lines 109-137 currently opens "FOUR EMAILS, FOUR RULES, ON PURPOSE" and closes "The
  four are different BY DESIGN." Both become six, and two sentences are added inside it:

  > The fifth and sixth are the expiry pair (#70). The candidate's nudge takes the REMINDER's rule,
  > not the OTP's: a plain portal-entry link to the compliance sign-in page and never a token,
  > because no raw token exists to send and minting one would rotate `session_hash` under a live
  > session. It carries no reference number — the candidate typed it and does not need it read back
  > to them in a message that could sit in an inbox for years. The recruiter's digest takes the
  > extension nudge's rule (it names candidates to a third party, so its recipient is validated as a
  > single operator-configured address in src/compliance/nudges.js) with one difference: it carries
  > NO LINK AT ALL, because there is no recruiter compliance surface until #71 and `/assignments`
  > deliberately shows no compliance state.

  Then:

  ```js
  // ── the expiry pair (#70) ──────────────────────────────────────────────────────────────

  /**
   * The candidate's nudge: these things we hold for you are running out.
   *
   * ONE MESSAGE PER SWEEP, not one per item. `items` is every checklist row of theirs that
   * changed state in this sweep, so a locum whose DBS and immunisations lapse the same week gets
   * one email and not two. The cap is structural rather than counted: an item can only change
   * state twice per expiry date (amber, then red), and a renewal is what re-arms it.
   *
   * The link is the compliance sign-in page and never a token — sendReminderEmail's rule, for
   * its reason. `/prep/compliance/login`, not `/prep/login`: the two portals have independent
   * cookies and a candidate sent to the wrong door would sign in to the wrong product.
   *
   * NO REFERENCE NUMBER anywhere in either half. It is theirs, they typed it, and the message
   * has to say what to renew rather than read their own paperwork back to them.
   *
   * The subject's tense turns on the worst state in the batch, which is the one distinction the
   * whole ticket is about: "has run out" and "runs out soon" are different problems and an inbox
   * preview is the first surface either one reaches. Per-item tense lives on each line below.
   *
   * Dates render as the stored `YYYY-MM-DD` — sendInviteEmail's `.slice(0, 10)` discipline. The
   * passport renders prose dates through its own readableDate; an email has no Intl guarantee
   * worth a second copy of that function, and an ISO date is unambiguous on the one message
   * where a day either way matters.
   *
   * Decision 17's tone rule holds: calm, no deadline pressure, no exclamation mark, no streak
   * language, nothing that implies a consequence we cannot know.
   */
  export async function sendExpiryNudgeEmail(env, { to, agencyName, items = [], link } = {}) {
    const agency = String(agencyName || "").trim() || "your recruitment agency";
    const url = String(link ?? "");
    const anyExpired = items.some((item) => item.status === "expired");

    // Labels come from the catalogue and are ours, but they reach a body a mail client renders,
    // so they take the same escape every other value in this file does.
    const line = (item) =>
      `${item.label} — ${item.status === "expired" ? "ran out" : "runs out"} ` +
      `${String(item.expiryDate ?? "").slice(0, 10)}`;

    const subject = anyExpired
      ? "Something we hold for you has run out"
      : "Something we hold for you runs out soon";

    const text = [
      "Hello,",
      "",
      `${agency} keeps a short list of the things they need on file before you can be booked.`,
      "These need your attention:",
      "",
      ...items.map((item) => `  ${line(item)}`),
      "",
      `Send the new one to ${agency} the way you always have. Then open your checklist and`,
      "update the reference number and the date:",
      "",
      url,
      "",
      "We do not store your documents — only the reference number and the date it runs out.",
    ].join("\n");

    const html = [
      `<p>Hello,</p>`,
      `<p>${escapeHtml(agency)} keeps a short list of the things they need on file before you can`,
      `be booked. These need your attention:</p>`,
      `<ul>`,
      ...items.map((item) => `<li>${escapeHtml(line(item))}</li>`),
      `</ul>`,
      `<p>Send the new one to ${escapeHtml(agency)} the way you always have. Then open your`,
      `checklist and update the reference number and the date.</p>`,
      `<p style="margin:24px 0"><a href="${escapeHtml(url)}">Open your checklist</a></p>`,
      `<p style="color:#666666;font-size:13px">We do not store your documents — only the`,
      `reference number and the date it runs out.</p>`,
    ].join("\n");

    return sendEmail(env, { to, subject, text, html, from: mailFrom(env, agencyName) });
  }
  ```

- **PATTERN**: `sendReminderEmail` (268-301) for the link rule and the `mailFrom` display name;
  `sendInviteEmail` (196-253) for the `.slice(0, 10)` date and the bare-URL-in-the-text-half rule.
- **IMPORTS**: none new. `escapeHtml`, `mailFrom`, `sendEmail` are all in this file.
- **GOTCHA**: the text half must carry the URL as **bare text on its own line** — a plain-text
  client shows exactly what the text half says, and a link that exists only as an `<a>` href is one
  that reader cannot follow (`sendInviteEmail`'s note at 188-191). `test/prep-email.test.js` asserts
  this for the invite; assert it here too.
- **VALIDATE**: `node --test test/prep-email.test.js`
- **SATISFIES**: AC #4.

---

### ADD `sendExpiryDigestEmail` to `src/prep/email.js`

- **IMPLEMENT**: Directly after the candidate's nudge:

  ```js
  /**
   * The recruiter's digest: everything that changed state in this sweep, in one message.
   *
   * THE SECOND MESSAGE IN THIS FILE ADDRESSED TO THE AGENCY, and the one that names the most
   * people at once. sendExtensionNudgeEmail names one candidate; this names N. Its recipient is
   * validated as a single operator-configured address in src/compliance/nudges.js BEFORE the
   * sweep sends anything, and the comma check matters more here for the same reason it mattered
   * there, multiplied.
   *
   * IT CARRIES NO LINK, deliberately, and that is not an omission to be tidied up. There is no
   * recruiter compliance surface until #71: `/assignments` shows bookings and dates and
   * deliberately projects no compliance state (src/compliance/store.js, listAssignments), so a
   * link to it would point at a screen that cannot show what this email is about. #71 adds the
   * link when it adds the screen. This is also why the digest states the facts in full rather
   * than teasing them — it has to be readable as the whole answer.
   *
   * It says nothing about whether the candidates were emailed. They usually were, and the
   * sentence would still be a claim this function cannot check: the candidate half runs under its
   * own configuration guard and its own try/catch, and a digest asserting a send that failed is
   * worse than a digest that stays quiet about it.
   *
   * `candidateName` is agency-entered text reaching a mail body; it takes sendExtensionNudgeEmail's
   * CONTROLS strip and NAME_MAX cap for that function's reason. The subject carries a COUNT and
   * no name — an inbox preview naming a locum's compliance problem on a shared desk is a
   * disclosure nobody chose.
   */
  export async function sendExpiryDigestEmail(env, { to, agencyName, rows = [] } = {}) {
    const header = (value) =>
      String(value ?? "").replace(CONTROLS, " ").trim().slice(0, NAME_MAX).trim();

    const line = (row) =>
      `${header(row.candidateName) || "A candidate"} — ${row.label} — ` +
      `${row.status === "expired" ? "ran out" : "runs out"} ` +
      `${String(row.expiryDate ?? "").slice(0, 10)}`;

    const subject = `Compliance expiries — ${rows.length} to chase`;

    const text = [
      "Hello,",
      "",
      "These compliance items have just changed state:",
      "",
      ...rows.map((row) => `  ${line(row)}`),
    ].join("\n");

    const html = [
      `<p>Hello,</p>`,
      `<p>These compliance items have just changed state:</p>`,
      `<ul>`,
      ...rows.map((row) => `<li>${escapeHtml(line(row))}</li>`),
      `</ul>`,
    ].join("\n");

    return sendEmail(env, { to, subject, text, html, from: mailFrom(env, agencyName) });
  }
  ```

- **PATTERN**: `sendExtensionNudgeEmail` (327-366) verbatim for the `header` helper and the
  `mailFrom` call.
- **IMPORTS**: none new. `CONTROLS` (line 143) and `NAME_MAX` (140) are module constants.
- **GOTCHA**: do not add a link "for convenience". `test/prep-email.test.js` must assert its
  absence, exactly as it asserts the absence of a link in the OTP mail — otherwise someone adds one
  pointing at `/prep/*` and sends the recruiter to a candidate's door.
- **VALIDATE**: `node --test test/prep-email.test.js`
- **SATISFIES**: AC #5.

---

### ADD `sweepExpiryStates` and `mailExpiryNudges` to `src/compliance/nudges.js`

- **IMPLEMENT**: Extend the module header first — it currently describes one sweep and must
  describe the split — then add both functions at the foot.

  Header addition:

  ```js
  // #70 ADDS A SECOND RADAR TO THIS FILE, AND IT IS DELIBERATELY SPLIT IN TWO.
  //
  // `sendDueExtensionNudges` above takes `env` and refuses to claim anything unless it can also
  // send: line 76 bails on a missing RECRUITER_EMAIL. That is right there, because the claim
  // guards a courtesy email and public/assignments.js computes the amber row at render time, so
  // the screen stays true whatever the mail configuration is.
  //
  // The expiry radar cannot inherit that rule, because for it the claim IS the product state.
  // `compliance_item.status` is what the passport renders — a deployment with no RECRUITER_EMAIL
  // that refused to claim would leave a candidate looking at a green "Sent in" chip over a
  // certificate that lapsed in June, which is the exact failure this epic exists to prevent.
  //
  // So: `sweepExpiryStates(db)` takes the DATABASE and nothing else, and always runs. Its cost,
  // stated rather than discovered: on a deployment with no mail configured the states move and no
  // email is ever sent for those transitions — and because the transition is the claim, they will
  // not be sent later either. The screen is right and the nudge is lost. `mailExpiryNudges(env,
  // claimed)` is the half that needs configuration, and it takes what the first half won rather
  // than re-reading the database, because after a successful claim there is nothing left to find.
  //
  // AT-MOST-ONCE, WITH ONE HONEST DIFFERENCE FROM #69. There the claim column recorded that a
  // nudge was SENT. Here the status records that the item CHANGED STATE, so a failed send leaves
  // the state moved with no message behind it and nothing to retry from. That is the same trade
  // #25 and #69 already took — a courtesy outranked by "exactly once" — but the operator's
  // assurance query is a count of states, not of sends, and DEPLOY.md says so.
  ```

  Then:

  ```js
  /** The catalogue as a lookup, built once: the sweep asks it per row. */
  const CATALOGUE_BY_KEY = new Map(COMPLIANCE_CATALOGUE.map((item) => [item.key, item]));

  /**
   * Amber, red, or leave it alone — the whole radar rule, in three lines.
   *
   * RED IS TESTED FIRST. An item whose date passed a fortnight ago satisfies "inside the amber
   * window" too (every negative number is <= amberDays), and answering `expiring` for it would
   * tell a candidate their lapsed DBS "runs out soon". Order is the fix; there is no second
   * condition to get wrong.
   *
   * `daysLeft === 0` — it runs out TODAY — is amber and not red, `isNotPast`'s argument
   * (src/prep/dates.js): a certificate valid to the 3rd is valid all day on the 3rd.
   *
   * `daysLeft` is computed by SQLITE, never here. See dueExpiryItems for why that matters.
   */
  function targetFor(daysLeft, amberDays) {
    if (daysLeft < 0) return "expired";
    if (daysLeft <= amberDays) return "expiring";
    return null;
  }

  /**
   * Move every checklist row that has crossed a line, and report what moved.
   *
   * Takes `db` and not `env` — see the header. This half must run on any deployment that has a
   * database at all.
   *
   * The catalogue guard skips three classes of row the SQL cannot: an item_key retired from the
   * catalogue (its rows survive; catalogue.js:18-19 says adding an item is an edit, and removing
   * one leaves rows behind), an item marked `expires: false` that somehow holds a date, and a
   * malformed amberDays. Each is a row we decline to reason about rather than one we guess at.
   *
   * `target === row.status` is the ordinary case, not an error: the query narrows to the WIDEST
   * amber window, so a 30-day item sitting 45 days out comes back and is left alone, and a row
   * already `expiring` and still inside its window comes back every sweep and is left alone every
   * time. That is what makes the claim below fire exactly once per crossing.
   *
   * Sequential, `sendDueExtensionNudges`' reason: the due set is tiny and a Promise.all would
   * race the claims for no gain. Two concurrent REQUESTS still cannot double-claim — the
   * compare-and-swap has one winner per row.
   */
  export async function sweepExpiryStates(db) {
    if (!db) return [];
    const rows = await dueExpiryItems(db, MAX_AMBER_DAYS);
    const claimed = [];
    for (const row of rows) {
      const entry = CATALOGUE_BY_KEY.get(row.item_key);
      if (!entry?.expires || !Number.isInteger(entry.amberDays)) continue;

      const target = targetFor(row.days_left, entry.amberDays);
      if (!target || target === row.status) continue;

      // Both observed values travel back into the WHERE. Passing `row.expiry_date` is not
      // bookkeeping — it is what makes a renewal that keeps the status (`submitted → submitted`
      // with a new date, which is the ORDINARY renewal) invalidate this claim. See
      // claimItemExpiry's comment for the failure it closes.
      const won = await claimItemExpiry(db, {
        id: row.id,
        from: row.status,
        to: target,
        expiryDate: row.expiry_date,
      });
      if (!won) continue; // a renewal landed between the read and the write, and it wins

      claimed.push({
        candidateId: row.candidate_id,
        candidateName: row.candidate_name,
        candidateEmail: row.candidate_email,
        label: entry.label,
        expiryDate: row.expiry_date,
        status: target,
      });
    }
    return claimed;
  }

  /**
   * The two messages, from what the sweep just won.
   *
   * TWO INDEPENDENT CONFIGURATION GUARDS, because these are two independent messages with two
   * independent requirements. The candidate's nudge needs a base URL (it carries a link); the
   * recruiter's digest needs a validated recipient (it carries none). A deployment with
   * PREP_BASE_URL and no RECRUITER_EMAIL should still tell the candidates — refusing both because
   * one is unset is the coupling `sendDueExtensionNudges` could afford and this cannot.
   *
   * Nothing is rolled back on a failure and nothing is retried: the states are already claimed,
   * and the header says why. Each send has its own try/catch, so one candidate's bad address does
   * not cost the rest of the batch its message.
   *
   * `getAgency` is fetched once, after the guards, and only if there is something to send —
   * `sendDueExtensionNudges`' "due first, agency only if anything is" rule.
   */
  export async function mailExpiryNudges(env, claimed = []) {
    if (!Array.isArray(claimed) || claimed.length === 0) return;
    if (!env?.RESEND_API_KEY) return;

    const base = baseUrl(env);
    const to = recipient(env);
    if (!base && !to) return;

    const agency = await getAgency(env.DB).catch(() => null);

    if (base) {
      // Grouped by candidate: one message listing everything of theirs that moved, never one per
      // item. A Map keeps insertion order, so each candidate's list stays in the query's
      // soonest-first order even though the rows arrive interleaved across candidates.
      const byCandidate = new Map();
      for (const row of claimed) {
        if (!row.candidateEmail) continue;
        if (!byCandidate.has(row.candidateId)) byCandidate.set(row.candidateId, []);
        byCandidate.get(row.candidateId).push(row);
      }
      for (const items of byCandidate.values()) {
        try {
          await sendExpiryNudgeEmail(env, {
            to: items[0].candidateEmail,
            agencyName: agency?.name,
            items,
            // The candidate's own door, and the COMPLIANCE one: the two portals hold independent
            // cookies and /prep/login would sign them in to the interview-prep product.
            link: `${base}/prep/compliance/login`,
          });
        } catch (err) {
          // Status only: never the recipient, never the candidate's name, never the item.
          console.error("expiry nudge send failed:", err?.code ?? err?.name ?? "unknown");
        }
      }
    }

    if (to) {
      try {
        await sendExpiryDigestEmail(env, { to, agencyName: agency?.name, rows: claimed });
      } catch (err) {
        console.error("expiry digest send failed:", err?.code ?? err?.name ?? "unknown");
      }
    }
  }
  ```

- **PATTERN**: `sendDueExtensionNudges` (69-107) for the guard-then-claim-then-send shape and the
  status-only logging.
- **IMPORTS**: widen the three existing import lines:
  ```js
  import { claimItemExpiry, dueExpiryItems, dueExtensionNudges, claimExtensionNudge } from "./store.js";
  import { COMPLIANCE_CATALOGUE, EXTENSION_LEAD_DAYS, MAX_AMBER_DAYS } from "./catalogue.js";
  import { sendExtensionNudgeEmail, sendExpiryDigestEmail, sendExpiryNudgeEmail } from "../prep/email.js";
  ```
- **GOTCHA**: do **not** create `src/compliance/expiry.js` (the ticket's file estimate names it).
  `baseUrl()` and `recipient()` are private to `nudges.js`, and `recipient()`'s comma check is the
  one guard standing between a misconfigured address and a message naming N candidates. Copying it
  into a second file is the `equalHex` mistake this repo already wrote down
  (`src/compliance/store.js:444-445`): a second copy of a security check is a second place for
  someone to simplify it away. The module is "the compliance nudges"; two radars is what it is now.
- **VALIDATE**: `node --test test/expiry-radar.test.js`
- **SATISFIES**: AC #2, AC #4, AC #5, AC #6.

---

### UPDATE `functions/prep/_middleware.js`

- **IMPLEMENT**: the state sweep awaited beside the purges, the mail registered third.

  ```js
  import { sweepExpiryStates, mailExpiryNudges, sendDueExtensionNudges } from "../../src/compliance/nudges.js";
  ```

  ```js
  export async function onRequest(context) {
    const { env, next } = context;
    if (env.DB) {
      try {
        await purgeExpired(env.DB);
      } catch (err) {
        console.error("portal purge failed:", err);
      }
      try {
        await purgeDormant(env.DB);
      } catch (err) {
        console.error("compliance purge failed:", err);
      }
      // AWAITED, and it is the only mail-adjacent job on this seam that is. #70's state half is a
      // purge in this file's taxonomy rather than a send: `compliance_item.status` is what
      // /prep/compliance renders, and the purges are awaited for exactly this reason — an expired
      // invite must not serve one last time, and a lapsed certificate must not render as "Sent
      // in" one last time. It runs AFTER both purges so a candidate the dormancy rule just erased
      // has no rows left to sweep. Its own catch block, third of three: one broken clock must not
      // stop the others.
      let expiryChanges = [];
      try {
        expiryChanges = await sweepExpiryStates(env.DB);
      } catch (err) {
        console.error("expiry sweep failed:", err);
      }
      context.waitUntil(
        sendDueReminders(env).catch((err) => {
          console.error("reminder sweep failed:", err);
        }),
      );
      context.waitUntil(
        sendDueExtensionNudges(env).catch((err) => {
          console.error("extension nudge sweep failed:", err);
        }),
      );
      // THIRD, and deferred like the other two: the response has no ordering dependency on the
      // sends. Registered after the extension nudge for test/prep-middleware.test.js's stated
      // reason — captured[0] must stay the reminder, whose send that file awaits to prove the
      // deferred slot really delivers. It takes what the awaited half won rather than re-reading
      // the database: after a successful claim there is nothing left to find.
      context.waitUntil(
        mailExpiryNudges(env, expiryChanges).catch((err) => {
          console.error("expiry nudge sweep failed:", err);
        }),
      );
    }
    return next();
  }
  ```

  Extend the file header with a paragraph in its existing voice, saying that #70 puts one job in
  **each** tier and why the state half is the first mail-adjacent job here to be awaited.

- **PATTERN**: the file as it stands — three awaited jobs each with its own catch, three deferred
  jobs each with its own catch.
- **IMPORTS**: as above.
- **GOTCHA**: `expiryChanges` must be declared with `let` **outside** the try, and default to `[]`.
  Declaring it inside would put the `waitUntil` out of scope; leaving it `undefined` on a throw
  would reach `mailExpiryNudges` and hit its `Array.isArray` guard — which is a correct fail-safe,
  but the `[]` default is the honest expression of "nothing moved".
- **VALIDATE**: `node --test test/prep-middleware.test.js`
- **SATISFIES**: AC #6, AC #8.

---

### UPDATE `functions/prep/compliance/demo.js`

- **IMPLEMENT**: after the `createCandidate` seed, and **only** on first seed, put one item into the
  amber window so the demo has something to show.

  ```js
  import { createCandidate, rotateCandidateSession, setItemState } from "../../../src/compliance/store.js";
  ```

  ```js
  if (!existing) {
    await createCandidate(env.DB, DEMO_CANDIDATE);
    // ONE ITEM, DELIBERATELY IN THE AMBER WINDOW. docs/handover-louis-meeting.md:67 gives the demo
    // persona a training expiry "on purpose — the demo point: the engine surfaces the expiry
    // before the client does", and until #70 there was nothing to surface it with. 25 days against
    // immunisations' 30-day amberDays puts it inside the window with five days of margin, so the
    // demo does not turn on the hour it is run.
    //
    // The DATE COMES FROM SQLITE, not from JS: the sweep compares against date('now') and a
    // fixture built on V8's clock is the ±1-day flip test/extension-radar.test.js's header calls
    // worse than no test.
    //
    // Seeded only on FIRST click, so re-opening the demo does not reset an item the sweep has
    // already ambered. And note the ordering: _middleware.js runs before this handler, so the
    // sweep that ambers this row is the one on the NEXT request — the redirect to
    // /prep/compliance/ — not this one.
    const expiryDate = await env.DB.prepare("SELECT date('now', '+25 days') AS d").first("d");
    await setItemState(env.DB, {
      candidateId: DEMO_CANDIDATE.id,
      itemKey: "immunisations",
      status: "submitted",
      reference: "IMM-2024-118",
      expiryDate,
    });
  }
  ```

- **PATTERN**: the file's existing `createCandidate` call and its "checked rather than
  attempted-and-swallowed" comment.
- **IMPORTS**: as above.
- **GOTCHA**: `immunisations` is `expires: true, amberDays: 30` in the catalogue — check that before
  writing the 25, and if the catalogue has been retuned, pick a value comfortably inside the new
  window. Do **not** compute the date in JavaScript.
- **VALIDATE**: with `DEMO_MODE=1` in `.dev.vars`, `npm run dev`, then open
  `http://localhost:8788/prep/compliance/demo`, then reload `/prep/compliance/` once. The
  Immunisation record card shows the amber "Expiring" chip and "This runs out soon — send us the
  new one."
- **SATISFIES**: AC #8, AC #9.

---

### CREATE `test/expiry-radar.test.js`

- **IMPLEMENT**: the arithmetic and the claim against real SQLite. Mirror
  `test/extension-radar.test.js`'s structure and header exactly, including the "every fixture date
  is computed by SQLite itself" rule and the `{ skip }` on every test.

  Helpers to build first:

  ```js
  const dayOffset = (db, days) =>
    db.prepare(`SELECT date('now', '${days >= 0 ? "+" : "-"}${Math.abs(days)} days') AS d`).get().d;

  /** One candidate with a full checklist, then one item given a state and a date. */
  async function seedItem(d1, db, { candidate = "cand-1", itemKey, status, expiryDays }) { ... }

  const statusOf = (db, candidate, itemKey) =>
    db.prepare("SELECT status FROM compliance_item WHERE candidate_id = ? AND item_key = ?")
      .get(candidate, itemKey).status;
  ```

  The cases, each named for the rule it proves:

  **The boundary — per item type, which is the whole point.**
  - `hcpc_registration` (amberDays 60) at 61 days is untouched; at 60 days it is `expiring`.
  - `immunisations` (amberDays 30) at 31 days is untouched; at 30 days it is `expiring`. **Run both
    in one sweep** — this is the assertion that proves the threshold is per item type and not one
    number: a sweep using 60 for everything would amber the immunisation at 45.
  - At 0 days (runs out today) it is `expiring`, not `expired`.
  - At −1 day it is `expired`.
  - A `verified` item lapsed 90 days ago goes to `expired` and never to `expiring` — the red-first
    ordering.

  **The states the sweep may start from and write.**
  - `submitted` → `expiring`; `verified` → `expiring`; `expiring` → `expired`.
  - `missing` is never touched (it holds no date).
  - `expired` is terminal: a second sweep claims nothing.
  - A non-expiring item (`references`) is never touched even if a row is forced to hold a date
    directly through SQL — the catalogue guard, not the SQL, is what stops it.

  **The claim.**
  - Two sweeps in a row: the first claims, the second claims nothing (`claimed.length === 0`).
  - `claimItemExpiry` returns `true` once and `false` for the same `(id, from, expiryDate)` twice.
  - A stale `from` loses: seed `verified`, claim with `from: "submitted"`, assert `false` and that
    the row still says `verified`.
  - **A stale `expiryDate` loses even when the status is unchanged — the case a status-only guard
    would get wrong, and the reason this test exists.** Seed `submitted` at +29 days and read the
    row. Call `setItemState(..., status: "submitted", expiryDate: <+600 days>)` — the ordinary
    renewal, which does *not* change the status. Then call `claimItemExpiry` with the **stale**
    `(from: "submitted", expiryDate: <+29 days>)` and assert it returns `false`, that the row
    still reads `submitted`, and that its `expiry_date` is still the +600-day one. Without the
    date in the WHERE this passes 1 change and leaves `expiring` standing over a 2028 date, and
    nothing ever heals it because the next sweep does not select that row at all.
  - `assert.equal(typeof rows[0].id, "number")` on a `dueExpiryItems` result — recording what the
    driver actually returns, so `claimItemExpiry`'s integer guard is verified rather than assumed.
  - `claimItemExpiry` refuses `to: "verified"` with the store's 400, and refuses a blank
    `expiryDate`.

  **The renewal, which is the re-arm.**
  - Sweep an item to `expiring`. Call `setItemState(..., status: "submitted", expiryDate: +200
    days)` — the passport's write. Assert the next sweep claims nothing (200 days is outside every
    window) and the status is `submitted`. Then move the date to +10 days and assert the sweep
    ambers it again. This is `updateAssignment`'s re-arm without any new code, and the test is what
    records that.

  **The grouping and the two sends** — with `fetch` stubbed, copying
  `test/extension-radar.test.js:253-267`'s `sweep()` helper:
  - Two candidates, three items crossing in one sweep → **three** sends: two candidate emails and
    one digest. Assert the digest's body names both candidates and the candidate emails name only
    their own items.
  - The candidate email's text contains `/prep/compliance/login` and does **not** contain the
    reference number.
  - The digest contains no `http` URL at all.
  - **The state moves with no mail configuration whatsoever.** `sweepExpiryStates(d1)` with no
    `env` in sight, then assert the status changed. This is the assertion that would fail if
    someone "harmonises" this sweep with `sendDueExtensionNudges`' bail-before-claim rule, and it
    is the single most important test in the file.
  - `PREP_BASE_URL` set and `RECRUITER_EMAIL` missing → candidate emails send, no digest.
  - `RECRUITER_EMAIL` set and `PREP_BASE_URL` missing → digest sends, no candidate email.
  - A `RECRUITER_EMAIL` with a comma → no digest (and the candidate emails still go).
  - A send that throws does not stop the batch, and does not roll the state back.

  **The cage still owns everything.**
  - Sweep an item to `expiring`, `deleteCandidate`, assert `compliance_item` is empty.

  **What the passport reads.**
  - After a sweep, `itemsByCandidate` returns `expiring` for that row — the one assertion that
    connects this ticket to the chip CSS that has been waiting since #68.

- **PATTERN**: `test/extension-radar.test.js` in full.
- **IMPORTS**: `{ d1Shape, openMigrated, skip }` from `./helpers/sqlite-d1.js`; the catalogue's
  `COMPLIANCE_CATALOGUE` / `MAX_AMBER_DAYS`; the store's new pair plus `createCandidate`,
  `setItemState`, `itemsByCandidate`, `deleteCandidate`; `sweepExpiryStates` and `mailExpiryNudges`.
- **GOTCHA**: `openMigrated()` seeds `clients` but not `candidate` — seed candidates through
  `createCandidate` so the checklist arrives through its one writer. And **every** test takes
  `{ skip }`: `node:sqlite` does not exist on Node 20 and the suite must stay green there.
- **VALIDATE**: `node --test test/expiry-radar.test.js` (under Node ≥ 22.5 — otherwise every test
  skips and proves nothing)
- **SATISFIES**: AC #1, #2, #3, #4, #5, #6, #8.

---

### UPDATE `test/compliance-store.test.js`

- **IMPLEMENT**: a new section, `// ── the expiry radar's two statements (#70) ──`, after the
  extension radar's block at line 443. The recording fake proves what real SQLite cannot show
  cheaply: what is bound, what is projected, and what is refused before any SQL runs.

  - `dueExpiryItems` binds the lead time and interpolates nothing — assert `call.args` is
    `[MAX_AMBER_DAYS]` and that the SQL contains no digits from the catalogue's thresholds.
  - Its projection names its columns and never `SELECT *`; assert `days_left` is computed in SQL
    (`/julianday/` in the statement) — this is what proves the arithmetic did not migrate to JS.
  - It refuses a non-integer `maxAmberDays` **before** any SQL runs (`db.calls.length === 0`).
  - `claimItemExpiry` is one UPDATE binding exactly `[to, id, from, expiryDate]`, with **both**
    `status = ?` and `expiry_date = ?` in the WHERE — assert both are present and that the WHERE
    contains **no** `IN (`. This is the "do not tidy this" guard made executable, and the
    `expiry_date = ?` half is the one that must not be dropped as redundant.
  - Its SET clause names `status` and nothing else — assert `checked_at` and `reference` do not
    appear after `SET`. (`expiry_date` appears in the WHERE, so match on the SET clause, not on
    the whole statement.)
  - It refuses `to: "verified"`, `to: "missing"`, an unknown `from`, a blank `expiryDate` and a
    non-integer id with `missing_fields`, each before any SQL runs.

- **PATTERN**: lines 443-561 of the same file.
- **IMPORTS**: add `claimItemExpiry`, `dueExpiryItems` to the store import; add `EXPIRY_STATES`,
  `MAX_AMBER_DAYS` to the catalogue import.
- **GOTCHA**: `fakeD1` enforces bind parity, so a statement that gains or loses a `?` throws here
  with a clear message. It always returns `changes: 1`, so **do not** try to assert the
  compare-and-swap's loser in this file — that belongs in `test/expiry-radar.test.js`.
- **VALIDATE**: `node --test test/compliance-store.test.js`
- **SATISFIES**: AC #1, AC #7.

---

### UPDATE `test/prep-email.test.js`

- **IMPLEMENT**: a section for each new sender.

  `sendExpiryNudgeEmail`:
  - The text half carries the URL as bare text on its own line (the invite's rule).
  - The link is `/prep/compliance/login` and **not** `/prep/login` — assert both.
  - No token-shaped path: assert the body does not match `/prep/auth/enter`.
  - The reference number never appears: pass an item with a reference alongside and assert its
    absence in both halves.
  - The subject says "has run out" when any item is `expired` and "runs out soon" when none is.
  - A batch of three items produces three lines in the text half.
  - The agency name reaches `mailFrom` (assert the `from` field is the quoted display name) and is
    escaped in the HTML half.

  `sendExpiryDigestEmail`:
  - **No link anywhere** — assert neither half matches `https?://`. This is the assertion that
    keeps a future "convenience" link out.
  - The subject carries the count and no candidate name.
  - A candidate name containing `\r\n` is stripped (header safety), and a >120-character name is
    capped.
  - Both candidates in a two-row digest appear.

- **PATTERN**: the file's existing `sendExtensionNudgeEmail` and `sendOtpEmail` sections — the OTP
  one already asserts an *absence* for a stated reason, which is the shape to copy.
- **IMPORTS**: add the two senders.
- **GOTCHA**: `sendEmail` throws `not_configured` without `RESEND_API_KEY`; the existing tests stub
  `globalThis.fetch` and pass a key. Follow whatever helper that file already has rather than
  inventing a second.
- **VALIDATE**: `node --test test/prep-email.test.js`
- **SATISFIES**: AC #4, AC #5.

---

### UPDATE `test/prep-middleware.test.js`

- **IMPLEMENT**: three additions, and one header note in the file's existing voice.

  - The `waitUntil` count moves from 2 to 3. Update the existing assertion **in this PR** rather
    than leaving it as a red run someone discovers — the file's header already says that is the
    rule.
  - **The state sweep IS awaited**: mirror the existing "the purge IS awaited" test. Seed a
    candidate with an item expiring yesterday, call `onRequest` with `next` asserting the status is
    already `expired` when it runs, and pass **no mail configuration at all** — proving both that
    it is awaited and that it does not depend on mail config.
  - `captured[0]` is still the reminder: keep the existing assertion and add one that the third
    captured promise settles without throwing when nothing is due.

- **PATTERN**: the file's three existing tests.
- **IMPORTS**: add `setItemState` from the compliance store.
- **GOTCHA**: the existing first test's release loop spins until a send starts. The new expiry mail
  will not send in that test (no `RECRUITER_EMAIL`, and the expiry set is empty), so it cannot
  interfere — but seed no expiring items into that test's database, or the `fetch` stub will count
  a second call and the assertion on `fetchCalls` will move.
- **VALIDATE**: `node --test test/prep-middleware.test.js`
- **SATISFIES**: AC #6, AC #8.

---

### UPDATE `DEPLOY.md`

- **IMPLEMENT**: four edits.

  1. **Triage table** (near line 452), one new row:

     | symptom | cause | fix |
     |---|---|---|
     | items are turning amber/red on the passport but no expiry emails arrive | `RESEND_API_KEY`, `PREP_BASE_URL` or `RECRUITER_EMAIL` is missing or malformed | set them (section 5b) and redeploy. **Unlike the extension radar, the state transitions have already happened and will not be re-sent** — the status change is the claim. Check `SELECT status, count(*) FROM compliance_item GROUP BY status`. Newly-crossing items will nudge normally once the config is right |

  2. **`RECRUITER_EMAIL` section** (573-595): add a paragraph correcting the inherited reading —
     the extension radar bails before claiming without it, but **#70's state sweep does not**.
     Compliance states move on a deployment with no recruiter address; only the digest is lost.

  3. **A new subsection** after "The extension nudge (#69)": *"The expiry radar (#70) — the third
     sweep, and the one that is half-awaited"*. Cover: what it does; the two tiers and why; the
     two independent config guards; the assurance query
     `SELECT status, count(*) FROM compliance_item GROUP BY status`; and the honest statement that
     the count reports **states, not sends** — the one place this radar's assurance is weaker than
     #69's, and why (the transition is the claim).

  4. Anywhere the deploy doc says "both sweeps", make it three.

- **PATTERN**: the existing extension-nudge section (625-655) — same headings, same at-most-once
  paragraph, same wrangler command block.
- **GOTCHA**: do not add a "migration 0011" row to the triage table. There is no migration; a row
  implying one would send an operator looking for a schema problem that does not exist.
- **VALIDATE**: `grep -n "0011" DEPLOY.md` → no matches; `grep -c "expiry" DEPLOY.md` → non-zero
- **SATISFIES**: AC #10.

---

### UPDATE `scripts/remind.py`

- **IMPLEMENT**: docstring only — no code change. One GET already drives every sweep on the slot.
  - Title line: "so ALL THREE lazy sweeps run (#25, #69, #70)".
  - Add the third to the bulleted list: *the expiry radar (#70) — "your DBS runs out soon", once
    per state change, to the candidate and in the recruiter's digest*.
  - Add the third assurance query:
    ```
    npx wrangler d1 execute dossier-engine --remote \
      --command "SELECT status, count(*) FROM compliance_item GROUP BY status"
    ```
    with the honest note that this counts **states rather than sends** — the transition is the
    claim, so an item in `expiring` is one that was nudged *or* one whose nudge failed, and the two
    are not tellable apart by design.
  - Note that the expiry radar is the one sweep on this slot whose **state** half does not depend on
    this poke at all when there is candidate traffic — but whose **mail** half does, exactly as the
    other two do.
- **PATTERN**: the file's existing docstring.
- **VALIDATE**: `python3 -c "import ast,sys; ast.parse(open('scripts/remind.py').read())"` and
  `./scripts/remind.py` with no argument → prints the usage line
- **SATISFIES**: AC #10.

---

## TESTING STRATEGY

The suite is `node --test test/*.test.js` — zero dependencies, `node:assert/strict`. The split
between the two database helpers is the design, not an accident, and this ticket needs both.

### Unit Tests — the statements (`test/helpers/fake-d1.js`)

`fakeD1` records SQL and enforces bind parity; it runs nothing. It proves:

- what is **bound** (nothing interpolated, the threshold is `MAX_AMBER_DAYS` and not a literal),
- what is **projected** (named columns, `days_left` computed by `julianday` in SQL),
- what is **refused before any SQL runs** (a non-integer bound, `to: "verified"`, an unknown
  `from`),
- what the WHERE **does not** contain (no `IN (` in the compare-and-swap).

It cannot prove the compare-and-swap, because `run()` returns `changes: 1` unconditionally.

### Integration Tests — the arithmetic (`test/helpers/sqlite-d1.js`)

`openMigrated()` applies every migration in wrangler's order into an in-memory SQLite with
`PRAGMA foreign_keys = ON`. This proves everything the fake cannot:

- the per-item boundary, at ±1 day on both thresholds in a single sweep,
- red-before-amber for an item lapsed months ago,
- the compare-and-swap's loser,
- the renewal race,
- the cascade taking swept rows with the candidate,
- the two grouped sends, with `fetch` stubbed.

**Every fixture date must be computed by SQLite** (`SELECT date('now','+N days')`), never by
`at()` or `Date`. A ±30-day boundary computed on one clock and compared on another flips near
midnight UTC, and a test that fails once a day at 00:00 is worse than no test.

**Every test takes `{ skip }`.** `node:sqlite` needs Node ≥ 22.5; the suite stays green on Node 20
with the remedy in the skip message, and CI/Node 24 proves the rest. Run the suite under Node 24
before claiming this ticket is done — a green run on Node 20 has proved nothing about this ticket.

### Edge Cases

| case | expected | where |
|---|---|---|
| item expires **today** | `expiring`, never `expired` | expiry-radar |
| item expired **yesterday** | `expired` | expiry-radar |
| item at exactly `amberDays` | `expiring` (inclusive far edge) | expiry-radar |
| item at `amberDays + 1` | untouched | expiry-radar |
| 30-day item at 45 days, swept alongside a 60-day item | untouched — proves the per-item threshold | expiry-radar |
| `verified` item lapsed 90 days ago | `expired` directly, never via `expiring` | expiry-radar |
| already `expired` | terminal, claims nothing on any later sweep | expiry-radar |
| `missing` item (no date) | never selected | expiry-radar |
| non-expiring item forced to hold a date via raw SQL | skipped by the catalogue guard | expiry-radar |
| `item_key` not in the catalogue | skipped, not thrown | expiry-radar |
| renewal between the read and the write, **status unchanged** (`submitted → submitted`, new date) | claim returns false, row keeps the renewal — the case a status-only guard gets wrong | expiry-radar |
| renewal between the read and the write, status changed (`expiring → submitted`) | claim returns false | expiry-radar |
| re-submit correcting only the reference, same date | claim still wins — nothing about the deadline changed | expiry-radar |
| renewal after an amber | back to `submitted`, re-ambers on the new date | expiry-radar |
| two candidates, three crossings, one sweep | 2 candidate emails + 1 digest | expiry-radar |
| **no mail configuration at all** | states still move | expiry-radar + middleware |
| `PREP_BASE_URL` only | candidate emails, no digest | expiry-radar |
| `RECRUITER_EMAIL` only | digest, no candidate emails | expiry-radar |
| `RECRUITER_EMAIL` with a comma | nothing to the recruiter; candidates still nudged | expiry-radar |
| one send throws | the batch continues; no state is rolled back | expiry-radar |
| candidate deleted after a sweep | every swept row goes with the cage | expiry-radar |
| empty claim set | `mailExpiryNudges` returns without touching `getAgency` | expiry-radar |

---

## VALIDATION COMMANDS

Execute every command to ensure zero regressions and 100% feature correctness.

### Level 0: the right Node

```bash
node --version   # must be >= 22.5 — under Node 20 every SQLite test SKIPS and proves nothing
```

### Level 1: the boundaries this product does not cross

```bash
# METADATA-ONLY: no document custody in the LINES THIS PR ADDS.
#
# Scoped to the diff and to CODE lines, and it matches mechanisms rather than words. A
# word-matching gate over the tree fails on prose that exists precisely to defend this boundary
# — src/compliance/store.js:9-11 ("never a document, never a URL to one"),
# functions/prep/compliance/api/item.js:8-13, and `image/svg+xml` in every favicon link. That is
# the "gate that cries wolf gets deleted" failure item.js:11-13 warns about, verified here rather
# than discovered later.
git diff main -- src/ functions/ public/ | grep '^+' | grep -v '^+\s*[/*#]' \
  | grep -niE "formdata|multipart|arraybuffer|\.r2\b|env\.BUCKET|type=[\"']file[\"']"
# expect: no lines (exit 1). Verified clean against this branch while planning.

# NO MIGRATION, and the lockfile untouched.
git diff --name-only main -- migrations/ test/schema.test.js
# expect: no output

# THE EVENTS VOCABULARY IS NOT WIDENED.
grep -rn "expiry_nudge_sent\|extension_nudge_sent" src/ functions/ migrations/
# expect: no output

# THE SWEEP NEVER WRITES A HUMAN'S WORD.
grep -n '"verified"' src/compliance/nudges.js
# expect: no output — only EXPIRY_STATES may be written, and it holds two states

# THE CLAIM'S WHERE CARRIES BOTH OBSERVED VALUES. Both tidy-ups this plan forbids, greppable.
grep -n "UPDATE compliance_item SET status" src/compliance/store.js
# expect: exactly ONE line, and it must contain BOTH `status = ?` AND `expiry_date = ?`,
# and must NOT contain `IN (`. Dropping the date guard is the bug in the plan's own first
# draft — see claimItemExpiry's comment for the 2028-date failure it closes.

# NO SECOND COPY of the recipient validator.
grep -rln "includes(\",\")" src/
# expect: exactly src/compliance/nudges.js
```

### Level 2: Unit tests

```bash
node --test test/compliance-store.test.js
node --test test/prep-email.test.js
node --test test/prep-middleware.test.js
```

### Level 3: Integration tests

```bash
node --test test/expiry-radar.test.js
node --test test/compliance-purge.test.js test/compliance-passport.test.js test/extension-radar.test.js
npm test   # the whole suite — zero failures, and note the skip count is 0 under Node 24
```

### Level 4: Manual validation

```bash
# .dev.vars needs DEMO_MODE=1
npm run dev
```

1. Open `http://localhost:8788/prep/compliance/demo` → redirects to the passport, signed in.
2. Reload `/prep/compliance/` once (the demo request's middleware ran *before* the seed).
3. **The Immunisation record card shows the amber "Expiring" chip** and the line "This runs out
   soon — send us the new one." `.mark-expiring` renders for the first time since #68 shipped it.
4. Submit a new reference and a date 18 months out on that card → the chip returns to "Sent in"
   and stays there through a reload (the renewal re-armed it, and the new date is outside every
   window).
5. Force a red: `npx wrangler d1 execute dossier-engine --local --command "UPDATE compliance_item
   SET expiry_date = date('now','-3 days') WHERE candidate_id='cand-demo' AND
   item_key='immunisations'"`, reload twice → "Out of date", `.mark-expired`.
6. Confirm the count line moves as expected — an `expiring` item is **not** counted as done
   (`items.js`'s `DONE` set is `submitted|verified`), so "3 of 8 done" drops to "2 of 8 done" when
   an item ambers. **Check this is the intended reading before shipping** (see Open Questions).
7. No `RESEND_API_KEY` locally, so nothing is sent and nothing errors — the state half is the half
   that runs.

### Level 5: Additional validation

```bash
# The passport's own contract still holds end-to-end.
node --test test/compliance-pages.test.js test/compliance-auth.test.js

# The lockfile and the two other regimes, explicitly.
node --test test/schema.test.js
```

---

## ACCEPTANCE CRITERIA

- [ ] **AC #1** — An expiring item moves to `expiring` when its expiry date falls inside **its own**
      catalogue `amberDays` window, and to `expired` the day after its date. Both thresholds come
      from `COMPLIANCE_CATALOGUE`; no number appears in code.
- [ ] **AC #2** — Each crossing produces **at most one** candidate email and **at most one** digest
      line, ever, for a given expiry date. Two sweeps in a row send once.
- [ ] **AC #3** — A renewal through the passport re-arms both: the item returns to `submitted` with
      the new date and crosses again on the new deadline. A renewal landing mid-sweep wins the race.
- [ ] **AC #4** — The candidate's email links to `/prep/compliance/login`, carries no token and no
      reference number, groups every item that crossed in one sweep into one message, and reads in
      decision 17's tone.
- [ ] **AC #5** — The recruiter's digest goes to a single validated `RECRUITER_EMAIL`, names the
      candidates and items, and carries no link.
- [ ] **AC #6** — **State transitions happen on a deployment with no mail configuration at all.**
      Only the messages depend on `RESEND_API_KEY` / `PREP_BASE_URL` / `RECRUITER_EMAIL`, and the
      two messages' guards are independent of one another.
- [ ] **AC #7** — No migration. `test/schema.test.js` and `migrations/` are untouched by this PR,
      `events.kind` is not widened, and no sixth `compliance_item.status` value exists.
- [ ] **AC #8** — The passport renders the amber and red chips that have shipped unrenderable since
      #68, with no change to `prep.css`, `passport.js` or `items.js`.
- [ ] **AC #9** — The DEMO_MODE seed produces a candidate with one item in the amber window, so the
      handover doc's demo point is demonstrable.
- [ ] **AC #10** — `DEPLOY.md` and `scripts/remind.py` describe three sweeps, and both state plainly
      that this radar's assurance query counts **states, not sends**.
- [ ] All validation commands pass with zero errors, under Node ≥ 22.5.
- [ ] No regressions: `npm test` is green, with the same skip count as `main` under the same Node.

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] All validation commands executed successfully (Levels 0–5)
- [ ] Full test suite passes under Node 24, not only Node 20
- [ ] `git diff --stat main -- migrations/ test/schema.test.js` is empty
- [ ] Manual demo walked end to end: amber chip, red chip, renewal
- [ ] Acceptance criteria all met
- [ ] The PR body names the two decisions a reviewer will want to argue with: the narrow
      compare-and-swap guard, and the awaited state sweep
- [ ] An implementation report is written to `.claude/reports/expiry-radar-report.md`

---

## OPEN QUESTIONS / ASSUMPTIONS

### Resolved before this plan was written

**1. `events.kind` is NOT widened, and the ticket's own scope line is superseded.** Issue #70 says
"Nudge sends recorded in `events` grain only." The architecture doc's 3 Aug amendment — made by the
owner during #69, and addressed to this ticket by name — says the opposite:

> **#70 inherits the identical wall** for `expiry_nudge_sent`. If the vocabulary is to be widened,
> that deserves its own ticket — a schema-regime change with the lockfile rewrite as its actual
> body — not a rider on either radar.

The wall: #17 widened `events.kind` with `ALTER TABLE events ADD COLUMN kind … CHECK (…)`; you
cannot `ADD COLUMN` a second time to change one column's CHECK, and SQLite has no `ALTER
CONSTRAINT`. A second widening needs the 12-step table rebuild, which breaks three assertions in
`test/schema.test.js`.

This plan takes the amendment as decided. It lands better here than it did in #69: because the
status transition *is* the claim, there is genuinely no second fact to record. **The honest cost,
stated plainly:** there is no record anywhere that an email was *sent* — only that the item changed
state. If the owner later wants sent-counts that survive the cage's purge, that is the separate
`events` ticket the amendment describes.

**2. HCPC auto-check is resolved, not descoped.** The ticket says "if #66 ruled it in". #66 ruled it
*in, non-blocking*: apply for the HCPC Employer Check API now, and until it is granted, store the
registration number (done — `hcpc_registration.reference`) and give the recruiter a one-click
Multiple Registrant Search. So there are two halves, and neither is buildable in this ticket: the
API integration is blocked on an external grant, and the manual-search control is a **recruiter**
control with no recruiter screen to live on until #71. When access arrives it slots in as a third
`compliance_item` state-writer beside `setItemState` and `claimItemExpiry` — the seam this ticket
builds is exactly the one it will use.

**3. `mandatory_training` is not added to the catalogue.** The ticket's parenthetical "(registration,
mandatory training, immunisations)" mirrors epic AC #2's phrasing about *classes* of expiring item,
not a completeness instruction — and the catalogue is #67's shipped deliverable, seeded deliberately
from TTR's own `/compliance` page. Adding an item TTR does not list is a product decision, and it
moves every live candidate's denominator ("3 of 8" → "3 of 9"). **Pre-costed if the owner wants it:**
one line in `src/compliance/catalogue.js`
(`{ key: "mandatory_training", label: "Mandatory training", expires: true, amberDays: 60 }`) plus
`8` → `ITEM_KEYS.length` at `test/assignments.test.js:86`, `:370` and `:379`. No migration either
way — `compliance_item.item_key` carries no CHECK by design. The demo's amber flag rides
`immunisations` instead, which demonstrates the identical point.

### Assumptions this plan makes

1. **The Louis meeting has confirmed the compliance-latency framing.** #70 is `contingent`. If the
   meeting has not happened or landed elsewhere, this plan is ready and the ticket is not.
2. **#68 and #69 are merged and applied.** This branch is `feature/extension-rebooking-radar` at
   `095e665`; migration 0010 must be applied to any environment this is tested against.
3. **The catalogue's current thresholds are right.** 60 days for registration/DBS/right-to-work and
   30 for immunisations/indemnity/fit-to-work is #67's call. Retuning is a one-line diff by design
   and needs no code change here — that is what `MAX_AMBER_DAYS` being derived buys.
4. **One recruiter address, from the environment.** `RECRUITER_EMAIL`, unchanged from #69. Per-
   consultant routing is a later decision with a real data model behind it.
5. **Dates are date-only** (`YYYY-MM-DD`), which is what `<input type="date">` submits and what
   `compliance_item.expiry_date`'s CHECK accepts. Every comparison wraps in `date()`.
6. **The candidate's email address is current.** There is no bounce handling and no verification;
   a stale address means a lost nudge, and the passport is the backstop. Consistent with the whole
   portal.
7. **`paid-scope` is lifted.** The architecture doc's commercial-line decision moves `paid-scope` to
   the future R2 vault milestone; the label on #70 is stale. Worth clearing on the issue.

### Questions that would change the plan if answered differently

- ***Should an `expiring` item still count as "done" on the passport?*** Today it does not:
  `items.js`'s `DONE` set is `submitted|verified`, so ambering an item drops the count from "3 of 8"
  to "2 of 8". That is defensible — an expiring certificate needs an action from the candidate,
  which is `DONE`'s stated test — but it means a locum watches their score go **down** without
  doing anything wrong, which is exactly the "score" reading `passport.js:42-45` says to avoid.
  This plan **does not change it** (that is `items.js`, and #68's decision). Flag it to the owner:
  the alternative is a third count on the API (`at_risk`) and a line under the count, which is #71's
  natural home anyway.
- ***Should an item that has sat amber for six weeks be nudged again?*** This plan says no — one
  message per state change, decision 17's ethos. A weekly re-nudge would need a stamp, a migration
  and a lockfile change, and it is a nag mechanic the ticket explicitly rules out.
- ***Should dates in the emails read as prose ("2 September 2026") rather than ISO?*** This plan
  keeps `.slice(0, 10)`, matching every other message in `email.js`. The passport went to the
  trouble of `readableDate` for the same audience; if the owner wants the same in the mail, it is a
  ~10-line helper in `email.js` and two tests. Deliberately not built rather than overlooked.
- ***Should the digest tell the recruiter the candidate was emailed?*** This plan says no: the
  candidate half runs under its own configuration guard and its own try/catch, so the sentence
  would sometimes be false. If the owner wants it, `mailExpiryNudges` has to report per-candidate
  outcomes and the digest has to send *after* them — a real ordering constraint, cheap but not free.
- ***Does the framework/audit retention question (Magnit et al., architecture Open Questions) bear
  on expired items?*** If a framework requires proof that an expiry was flagged, the transition
  needs an auditable record and the `events` ticket becomes real. Ask Louis; it does not block this.

---

## NOTES (open canvas)

### Why this ticket has no migration, and why that is the headline

Every previous nudge in this repo needed a column: `invite.reminder_sent_at` (0006),
`invite.send_key` (0007), `assignment.nudge_sent_at` (0010). Each one exists because the fact "we
sent this" had nowhere else to live — an invite's `status` says nothing about whether a reminder
went out, and a booking's `end_date` says nothing about whether anyone was warned.

Here the fact and the state are the same fact. "This item has crossed into amber" *is* the thing
worth recording, it is *already* a column, and it is *already* the thing the passport renders. A
`compliance_item.nudge_sent_at` would be a second record of the same event, and it would be worse
than redundant — with no transaction on D1, writing the status and the stamp as two statements
creates a live half-state where an item is amber with an unclaimed nudge, and the amber→red
transition would need a second rule to clear it. One column, one claim, one rule.

The cost is real and is stated in three places (the module header, DEPLOY.md, `remind.py`): the
assurance query counts states, not sends. An item in `expiring` is one that was nudged **or** one
whose nudge failed, and nothing distinguishes them. For a courtesy message that is the same trade
#25 and #69 already made; the difference is only that here it is not observable after the fact.

### The alternative designs, and why each was rejected

| approach | why not |
|---|---|
| `compliance_item.nudge_sent_at` (migration 0011) | Two writes with no transaction → a live half-state. Needs a clearing rule for amber→red on top of the renewal rule. Changes the lockfile for a fact the status already carries. |
| A compare-and-swap on `(id, status)` alone | **This plan's own first draft, and it was wrong.** `item.js` always writes `submitted`, so the ordinary renewal is `submitted → submitted` with a new date and a status-only guard matches it — stamping `expiring` over a date two years out, emailing the candidate a date no longer in the database, and sticking there because the next sweep no longer selects that row. Binding `expiry_date` too is the fix; a renewal always writes a new date, which is what makes it a renewal. |
| A `CASE item_key WHEN … THEN ?` built from the catalogue | Puts a string-built statement at the centre of a file whose contract (line 15) is that nothing is interpolated. One query per item type is the alternative and costs 8 round trips on every `/prep/*` request. |
| Computing amber/red in JavaScript from `Date.now()` | Two clocks. `test/extension-radar.test.js`'s header calls a boundary computed on one and compared on another "worse than no test", and it would fail once a day at 00:00 UTC. `days_left` from `julianday` is one clock. |
| Deriving `expiring`/`expired` at render time in the passport instead of storing it | Two sources of truth for the same word, and it leaves the recruiter's #71 dashboard with nothing to query. The status column already exists and its CHECK already admits both states — the schema decided this in #67. |
| A separate `src/compliance/expiry.js` (as the ticket's file estimate suggests) | `recipient()` and `baseUrl()` are private to `nudges.js`, and `recipient()` is a security check. A second copy is the `equalHex` mistake the store already wrote down. The module is the compliance nudges; two radars is what it is. |
| Both halves deferred on `waitUntil` (a straight copy of #69) | The passport would render one request behind, over the one screen whose whole purpose is telling someone the truth about what is outstanding. |
| Both halves awaited | Every `/prep/*` request, including static assets, would wait out N Resend calls — exactly what the middleware header says not to do. |

### The one inversion of #69, drawn out

#69's `sendDueExtensionNudges` bails before claiming when `RECRUITER_EMAIL` is missing, and its own
comment explains why that is right: "a sweep that cannot send must not claim [...] a half-configured
deployment [must not burn] each booking's one nudge on nothing." The screen stayed correct
regardless, because `public/assignments.js` computes amber at render time from `end_date`.

Copying that rule here would invert its intent. There is no render-time computation on the
passport — `status` is what it draws — so refusing to claim would mean refusing to *know*. A
deployment with a database, a Resend key and no recruiter address would show a locum a green
"Sent in" chip over a certificate that lapsed in June. The rule that transfers is the *principle*
("do not burn an irrecoverable claim on a message you cannot send"), and applying it correctly
means splitting the claim from the send — which is what this plan does.

An implementer who has just read #69 will find `sweepExpiryStates(db)`'s missing `env` parameter
odd. The module header is written for that reader specifically.

### Data flow

```
GET /prep/anything
   │
   ├─ await purgeExpired(DB)          #17  portal cage
   ├─ await purgeDormant(DB)          #67  compliance cage
   ├─ await sweepExpiryStates(DB)     #70  ← NEW, awaited: it decides what next() renders
   │     │
   │     ├─ dueExpiryItems(db, MAX_AMBER_DAYS)
   │     │     SELECT … CAST(julianday(date(expiry_date)) - julianday(date('now')) AS INTEGER) AS days_left
   │     │     WHERE expiry_date IS NOT NULL
   │     │       AND status IN ('submitted','verified','expiring')
   │     │       AND date(expiry_date) <= date('now','+'||?||' days')
   │     │
   │     └─ per row:  entry = CATALOGUE_BY_KEY.get(item_key)
   │                  target = days_left < 0        ? 'expired'
   │                         : days_left <= amberDays ? 'expiring'
   │                         : null
   │                  claimItemExpiry({id, from: row.status, to: target,
   │                                   expiryDate: row.expiry_date})       ← CAS, one winner
   │                     UPDATE compliance_item SET status = ?
   │                      WHERE id = ? AND status = ? AND expiry_date = ?
   │                                     └── both observed values: a renewal always writes a
   │                                         new date, so it invalidates the claim even when
   │                                         the status is unchanged (submitted → submitted)
   │                     └─ won → push {candidateId, name, email, label, expiryDate, status}
   │
   ├─ waitUntil sendDueReminders(env)          #25
   ├─ waitUntil sendDueExtensionNudges(env)    #69
   └─ waitUntil mailExpiryNudges(env, claimed) #70  ← NEW, third
         ├─ group by candidateId → one sendExpiryNudgeEmail each   (needs PREP_BASE_URL)
         └─ all rows            → one sendExpiryDigestEmail        (needs RECRUITER_EMAIL)
   │
   └─ next()   →  /prep/compliance/ renders `expiring` / `expired` with CSS shipped in #68
```

### The renewal loop, which is the product

```
missing  ──candidate submits, +18 months──▶  submitted
                                                │
                                     (17 months pass)
                                                │
                                    sweep, days_left = 30 ≤ 30
                                                ▼
                                            expiring  ──▶ candidate email + digest line
                                                │
                        ┌───────────────────────┴───────────────────────┐
              candidate renews                                    nobody acts
       setItemState(submitted, new date)                     sweep, days_left = −1
                        │                                              ▼
                        ▼                                          expired  ──▶ second email
                    submitted                                          │
                (out of every window)                        candidate renews eventually
                                                                       ▼
                                                                   submitted
```

The renewal edge needs **no code in this ticket** — `functions/prep/compliance/api/item.js` already
writes `submitted` with a fresh date, and its header already says re-submitting an already-verified
item deliberately sets it back. What this ticket adds is a test that records the loop, so a future
change to that route cannot break the radar silently.

### The two numeric claims, verified while writing this plan

Run rather than assumed, so the implementer does not have to re-derive them:

```
$ python3 -c "import sqlite3; ..."   # the julianday difference, at every boundary that matters
+60 days → days_left  60      +30 days → days_left  30      +0 days  → days_left   0
+61 days → days_left  61      +31 days → days_left  31      -1 days  → days_left  -1
+365 days → days_left 365                                   -90 days → days_left -90
```

Exact integers, negatives included — the `CAST` truncates nothing, because both operands are
date-only and land on the same half-day offset.

```
$ node -e "Math.max(...COMPLIANCE_CATALOGUE.map(i => i.amberDays ?? 0))"
60
```

**This machine runs Node v20.20.2**, so `node:sqlite` is absent and `test/expiry-radar.test.js`
will skip in full locally. Level 0 is not boilerplate: get onto Node ≥ 22.5 before believing a
green run.

### Sequencing note for a parallel session

Phases 1–3 are one linear chain (catalogue → store → sweep → email). Phase 5's documentation tasks
(`DEPLOY.md`, `scripts/remind.py`) depend on nothing but the decisions in this plan and can be
written at any point — they are the obvious candidate if two loops are running. Phase 4's two tasks
are independent of each other. Everything in Phase 6 depends on the phase it tests.

Branch from `main` after #69 is merged, not from `feature/extension-rebooking-radar` — and check
the branch before committing, because parallel sessions share this worktree and HEAD moves.

---

## AMENDMENTS

<!-- Append-only. Newest at the bottom. Leave empty until this plan has been executed. -->
