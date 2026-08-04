# Feature: the recruiter compliance dashboard (#71)

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

> **READ THIS FIRST — the branch is not `main`.** `origin/main` is at the #67 merge. #68 and #69
> live only on `feature/extension-rebooking-radar`; **#70 is uncommitted on `feature/expiry-radar`,
> which is the branch you are standing on.** See "Prerequisite: commit #70" under STEP-BY-STEP
> TASKS before you do anything else. Every `git diff main …` gate in this plan is written against
> **the branch point**, not `main`, for the reason `.claude/reports/expiry-radar-report.md`
> Deviation 2 records.

## Feature Description

The last surface in epic #65's milestone 1: a recruiter-side screen at `/compliance` that answers
"what does each candidate still owe us, and what is about to kill a booking" — without opening a
single email thread.

Today the agency's only compliance signals are the two the expiry radar sends: a per-candidate
nudge and a digest that names items and carries **no link at all**, because
`DEPLOY.md` §5 says there is no recruiter compliance surface until this ticket. Meanwhile
`compliance_item` has held a five-state chase vocabulary since #67 (`missing`, `submitted`,
`verified`, `expiring`, `expired`), and `verified` has never been written by anything — no code
path in the product can set it. The recruiter's half of concurrent vetting is missing entirely.

This ticket ships three things:

1. **A per-candidate list** — every candidate the agency has recorded, each with completeness
   ("5 of 8 verified"), how many items are waiting on the recruiter, and how many are at risk of
   expiry. Sorted so the worst is first: most expired, then most expiring, then most missing.
2. **The verify action** — the recruiter marks a submitted item verified. This is the first and
   only writer of `verified` in the product, and it is the human step in concurrent vetting.
3. **The reject action** — the recruiter sends the item back with a one-line reason, which emails
   the candidate. The item returns to `missing` with its reference and date cleared, so the
   checklist tells the truth: nothing valid is on file.

## User Story

As a **recruiter at a locum-heavy agency**
I want to **see every candidate's compliance state on one screen, and tick off or send back each
document as it arrives**
So that **I stop losing bookings to a certificate nobody chased, and I stop reconstructing chase
state from my inbox**

## Problem Statement

A locum booking dies when a document is missing or lapsed, and today the agency finds out from the
client. The engine already knows: `compliance_item` holds the state, `expiry_date` holds the
deadline, and #70's sweep moves rows to `expiring`/`expired`. None of it is visible to the person
who can act on it. Worse, `verified` — the whole point of vetting — is a status no code path can
write, so the difference between "they sent something" and "someone checked it" exists in the
schema and nowhere else.

## Solution Statement

One Access-gated screen (`/compliance`), one read route and one write route, three new store
functions, one new email. No migration, no new page-scoped CSS block, no new external service.

Two design calls carry the ticket, and both have a failure written out in the code they guard:

- **Risk is computed at render time from `expiry_date`, never read off `status`.** The sweep runs
  only on the `/prep/*` middleware, so a recruiter opening this screen triggers nothing. On a
  deployment with no candidate traffic for a fortnight, a certificate that lapsed last week still
  reads `submitted` in the column — and the screen whose whole promise is "at-risk flags without
  chasing email" would under-report exactly when it matters. `public/assignments.js` is immune to
  the same failure precisely because `stateOf()` computes from dates, and this screen takes that
  rule. `status` still supplies the **chase** state (not sent in / waiting for you / verified);
  the **risk** state is derived. They are rendered as two separate chips because they are two
  separate facts, and a stale column plus a fresh date is not a contradiction — it is
  "waiting for you" beside "ran out four days ago", which is true and is the row the recruiter
  most needs to see.
- **Verify and reject are compare-and-swaps on `status = 'submitted'`, and they do not go through
  `setItemState`.** `setItemState` writes `reference` and `expiry_date` unconditionally, so a
  verify routed through it would wipe the very number and date the recruiter just checked. Two
  narrow functions instead, each touching only what it means to.

## Out of Scope / Non-Goals

- **No booking or client column on this screen.** "Booking-blocking" invites it, and
  `listAssignments` deliberately excludes compliance state in the other direction
  (`src/compliance/store.js:278-280`). Keeping both projections narrow is what makes each a
  decision rather than a default. Defer to a later ticket if the owner asks for it.
- **No recruiter-side delete-now.** `deleteCandidate` exists and its docstring anticipates a
  recruiter caller, but a destructive control is not in this ticket's scope.
- **No candidate creation on this screen.** `POST /api/assignments` is the one production path
  that creates a `candidate` (and seeds the checklist), and it stays the only one.
- **No pagination, no search, no filter.** The pilot agency is two founders. The bound is stated
  in the route's header and in Open Questions: one GET returns `8 × candidates` rows.
- **No document upload of any kind.** Metadata-only is spike #66's first decision. The gate that
  enforces it is a test in this ticket, mirroring `test/assignments.test.js:327`.
- **No migration and no `test/schema.test.js` edit.** Structural: a Level 1 gate asserts the diff
  over `migrations/` and that file is empty.
- **No change to `functions/prep/compliance/api/items.js` or `public/prep/compliance/passport.js`.**
  #70's report flagged that a candidate's "done" count *falls* when an item ambers and called this
  ticket its natural home. It is carried into Open Questions as an owner decision, not folded in —
  it is a change to the candidate's screen, and this ticket is the recruiter's.
- **The reject reason is not stored.** No column, no migration, no free-text recruiter note about
  a candidate's health-adjacent document at rest. It exists in the email only. The cost is stated
  in Open Questions.
- **No prep-portal behaviour telemetry, ever.** Epic AC #5. A forbidden-word gate mirroring
  `test/counts.test.js:41` enforces it.

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: Medium-High (three new store statements with CAS semantics, one new
recruiter screen, one new email, one API contract — but no migration and no new infrastructure)
**Primary Systems Affected**: `src/compliance/store.js`, `src/compliance/catalogue.js`,
`src/prep/email.js`, `functions/api/compliance*`, `public/compliance.*`, `public/app.css`, the
shared topbar on four existing pages
**Dependencies**: none new. Vanilla static + Pages Functions + D1 + Resend, as today.

## Related Work

**Implements**: [#71](https://github.com/linardsb/saulera-dossier-engine/issues/71)   ·
**Epic**: [#65](https://github.com/linardsb/saulera-dossier-engine/issues/65) ·
architecture `docs/epics/locum-fit-2.architecture.md` (spike #66's deliverable — inherited, not
re-decided)

**Back-references** (plans this builds on or inherits decisions from):

- `.claude/plans/compliance-data-layer.md` (#67) — Why: the schema regime, the cage root, the
  five-state vocabulary this screen renders.
- `.claude/plans/candidate-compliance-passport.md` (#68) — Why: the candidate's half of every
  action here; `items.js`'s catalogue-driven left join is the pattern the GET route mirrors.
- `.claude/plans/extension-rebooking-radar.md` (#69) — Why: `/assignments` is the template for
  this screen in every respect — route pair, page/script split, chip grammar, test shape.
- `.claude/plans/expiry-radar.md` (#70) — Why: `targetFor` and the amber/red rule move out of
  `nudges.js` in this ticket; the digest gains the link that file's DEPLOY.md note promised.

**Forward-references**:

- (none yet — the R2 document vault milestone is the natural successor and gets its own spike)

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

**The template — read these three first, in this order. This ticket is `/assignments` again at a
different root.**

- `public/assignments.js` (whole file, 343 lines) - Why: the exact shape `public/compliance.js`
  takes. The `COPY` object rule, the `api()` helper's content-type check for an expired Access
  session, `createElement`/`textContent` only, `showState`/`clearState`, the render-time state
  computation in `stateOf()` (lines 152-171), and `daysUntil()`'s UTC parse (lines 137-150) which
  this ticket does NOT need but must not be re-invented.
- `functions/api/assignments.js` (lines 1-60) - Why: the GET adapter's shape — binding check first
  (503), delegate, serialise. And the header's argument for why a threshold rides the wire.
- `functions/api/assignments/[id].js` (whole file, 67 lines) - Why: the PUT adapter — `ALLOWED`
  vocabulary set, `sameOrigin` bolt, `Object.hasOwn` patch building, 404 from `changes === 0`.

**The data layer you are extending.**

- `src/compliance/store.js` (lines 1-20) - Why: the module contract. Every function takes a
  D1-shaped `db` first; no HTTP, no Response, no env; **nothing is ever interpolated into a SQL
  string.** Your three new functions live under a new `#71` section at the foot.
- `src/compliance/store.js:389-402` (`setItemState`) - Why: **the trap.** It writes `reference`
  and `expiry_date` unconditionally. A verify routed through it wipes the number and the date the
  recruiter just checked. This is why Task 3 adds two narrow functions instead.
- `src/compliance/store.js:471-491` (`dueExpiryItems`) - Why: the projection your new
  `listComplianceState` mirrors, and the `days_left` argument verbatim — the arithmetic is done by
  **SQLite**, never in JavaScript, because comparing SQLite's clock against V8's is the ±1-day
  flip near midnight UTC.
- `src/compliance/store.js:538-551` (`claimItemExpiry`) - Why: the compare-and-swap idiom your
  verify and reject take, and the worked failure explaining why a narrow `WHERE` is not
  over-specification.
- `src/compliance/store.js:291-307` (`listAssignments`) - Why: named columns, never `SELECT *`,
  and the note that this screen owns the checklist column while that one deliberately does not.
- `src/compliance/catalogue.js` (whole file, 75 lines) - Why: `COMPLIANCE_CATALOGUE`, `ITEM_KEYS`,
  `ITEM_STATUSES`, `MAX_AMBER_DAYS`. Thresholds live here and not in code. `targetFor` joins it in
  Task 1.

**The rule you are relocating.**

- `src/compliance/nudges.js:143-165` - Why: `CATALOGUE_BY_KEY` and `targetFor` — the whole amber/
  red rule in three lines, currently private to that file. Read the "RED IS TESTED FIRST" comment
  before moving it; the ordering is the correctness.
- `src/compliance/nudges.js:222-282` (`mailExpiryNudges`) - Why: the two independent configuration
  guards. Task 9's digest link must not couple them.

**The candidate's half, which decides several shapes here.**

- `functions/prep/compliance/api/items.js` (whole file, 88 lines) - Why: the **catalogue-driven
  left join** your GET route mirrors exactly (lines 62-75) — iterate `COMPLIANCE_CATALOGUE`, not
  the rows, so an item added after a candidate was seeded appears as something to start rather
  than vanishing. Also the `DONE`/`AWAITING_REVIEW` predicates, and why the recruiter's
  completeness count is a *different* question (see Task 5).
- `functions/prep/compliance/api/item.js` (whole file, 98 lines) - Why: the candidate's write. Its
  header states that `status` is deliberately outside the body vocabulary because `verified` is
  "#71's write" — this ticket is that write. Also the `expiry_date`-on-a-non-expiring-item 400,
  the pattern for Task 6's reason-on-a-verify refusal.

**Email.**

- `src/prep/email.js:151-205` - Why: `NAME_MAX`, `CONTROLS`, `mailFrom`, `escapeHtml`. Every value
  reaching a header takes the CONTROLS strip then the cap.
- `src/prep/email.js:338-377` (`sendExtensionNudgeEmail`) - Why: the closest template for a new
  message — the text/html pair, inline styles and literal colours (mail clients resolve no custom
  property), `sendEmail` at the foot.
- `src/prep/email.js:408-478` (`sendExpiryNudgeEmail`) - Why: the tone rule, the "no reference
  number read back at them" rule, and the compliance-door link (`/prep/compliance/login`, never
  `/prep/login`).
- `src/prep/email.js:484-514` (`sendExpiryDigestEmail`) - Why: Task 9 edits this. Note the subject
  carries a COUNT and no name, deliberately.

**Chrome and styling.**

- `public/assignments.html` (whole file, 102 lines) - Why: the page skeleton — head block,
  stylesheet chain (`fonts.css` → `tokens.css` → `app.css`), the topbar, `.page-head`, the table,
  the `save-state` line, the script tag at the foot.
- `public/app.css:1349-1469` - Why: the `.assignments-*` block. Your `.compliance-*` block sits
  directly beneath it and reuses `--tint-warn` / `--unverified` / `--text-muted`, adding **no new
  token**. Read the chip comment at 1427-1436: the colour ranks, it never says it on its own.
- `public/index.html:17-32`, `public/clients.html`, `public/counts.html` - Why: the topbar markup
  is duplicated per page (static `aria-current`, because each file knows which screen it is). All
  four gain the new nav entry.

**Plumbing.**

- `src/http.js` — `json`, `readJson`, `sameOrigin`, `errorResponse`. `sameOrigin` is for mutating
  methods only (src/http.js:41-43).
- `functions/prep/_middleware.js` (whole file) - Why: read it to understand what does **not**
  happen when a recruiter loads `/compliance` — no sweep, which is the entire reason for the
  render-time risk rule.
- `scripts/setup-access.py:14-32` - Why: the Access bypass is scoped to the `/prep` path
  **segment**. `/compliance` and `/api/compliance` are Access-gated by default. Verified: `/prepx`
  and `/preparation` both 302. Do not add a bypass.

**Tests — the three shapes to mirror.**

- `test/assignments.test.js` (whole file, 497 lines) - Why: **the structural template for
  `test/compliance-dashboard.test.js`.** Three blocks: routes against the recording fake (statement
  order and which statements never ran), a source scan over the page and its script, and a
  `{ skip }` block against real migrated SQLite for anything the fake cannot see.
- `test/counts.test.js:41-58` - Why: the forbidden-word gate scoped **outside** the `COPY` object,
  and the stated reason — prose for a recruiter may legitimately contain a word the code must not.
- `test/compliance-store.test.js:587-700` - Why: the `#70` section. Your `#71` section goes at the
  foot in the same style. **Do not add your new functions to the projection loop at line 485-502**
  — it asserts `doesNotMatch(projection, /candidate_id/)`, which `listComplianceState` must
  deliberately violate (the browser needs the id to address a write). Assert its projection inside
  your own section where the reason can sit beside it. That is #70's Deviation 4 verbatim.
- `test/expiry-radar.test.js` - Why: every fixture date is computed by SQLite itself, every
  threshold is read off the catalogue rather than typed, every real-SQLite test takes `{ skip }`.
- `test/helpers/sqlite-d1.js` — `openMigrated()`, `d1Shape(db)`, `skip`, `SEED_CLIENT`, `at()`.
- `test/helpers/fake-d1.js` — `fakeD1([queued])`, `db.calls[].sql`, `db.calls[].values`.
- `test/screens.test.js:44-48` - Why: the `SCREENS` array gains a fourth entry.
- `test/chrome.test.js:68-78` - Why: `INLINE_STYLE_PAGES` is **hardcoded**. Your page must carry
  no `<style>` block, and a test must assert that (as `test/assignments.test.js:323` does).

### New Files to Create

- `public/compliance.html` — the dashboard page. Topbar, page head, one card per candidate.
- `public/compliance.js` — its script. One `COPY` object, `api()`/`send()` helpers, render.
- `functions/api/compliance.js` — `GET /api/compliance`.
- `functions/api/compliance/[id].js` — `PUT /api/compliance/:candidateId`.
- `test/compliance-dashboard.test.js` — routes, source scan, real-SQLite block.

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- `docs/epics/locum-fit-2.architecture.md` — the whole file (111 lines).
  - Sections: "Storage: metadata-only", "Key decisions", and the **AMENDED 3 Aug 2026** block.
  - Why: metadata-only is not negotiable at this layer, and the amendment tells you that
    **`events.kind` cannot be widened** — this ticket writes no `events` row, exactly as #69 and
    #70 write none. If you find yourself reaching for `verify_recorded` as an event kind, stop:
    that needs its own ticket with the `test/schema.test.js` lockfile rewrite as its body.
- `DEPLOY.md` §5 (search for "Compliance expiries" and the paragraph at ~line 727)
  - Section: the expiry radar's operator notes.
  - Why: it states "there is no recruiter compliance surface until #71". Task 9 makes that
    sentence false and Task 12 rewrites it.
- `DEPLOY.md` §4 triage table (search for `/api/assignments`)
  - Why: the row-per-symptom format your new route's triage row takes. A `500` from this
    deployment means **deployment fault**, which is why every caller-fixable input must answer
    400 at the door rather than reaching a CHECK.
- `docs/epics/locum-fit-2.architecture.md` "Retention" + `src/compliance/store.js:141-154`
  - Why: nothing on this screen may extend a candidate's retention or create a row that outlives
    the cage. It reads and it writes `compliance_item`; it creates nothing.

No external library documentation is needed. This ticket adds no dependency, and the Resend seam
is already wrapped by `sendEmail`.

### Patterns to Follow

**The store's contract** (`src/compliance/store.js:13-15`):

```js
// Same contract as src/store.js and src/portal/store.js: every function takes a D1-shaped
// `db` as its first argument. No HTTP, no Response, no env. Every user value is a bound
// parameter; nothing is ever interpolated into a SQL string.
```

A status list is **not** a bound value and is therefore written out as literals in the SQL rather
than interpolated from `ITEM_STATUSES` — `dueExtensionNudges` (line 209-210) and `dueExpiryItems`
(line 444-446) both say so. Follow that.

**The compare-and-swap** (`src/compliance/store.js:262-271`):

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

D1 has no transaction. One statement whose `WHERE` carries the observed state is what makes
"exactly one winner" structural rather than hopeful. `String(x ?? "")` is not decoration — an
`undefined` bind is a D1 error, and the empty string matches nothing, which is the fail-closed
answer.

**The route adapter** (`functions/api/assignments/[id].js:24-37`):

```js
const ALLOWED = new Set(["end_date", "status"]);

export async function onRequestPut(context) {
  const { request, env, params } = context;

  if (!env.DB) return json({ error: "not_configured" }, 503);
  if (!sameOrigin(request)) return json({ error: "cross_origin" }, 403);

  try {
    const body = await readJson(request);
    const unexpected = Object.keys(body ?? {}).filter((key) => !ALLOWED.has(key));
    if (unexpected.length) {
      return json({ error: "unexpected_fields", fields: unexpected }, 400);
    }
```

Binding check **first** (a missing binding is a deployment fault the caller cannot fix, so 503 is
honest), then the origin bolt, then the closed body vocabulary. A key outside the set answers 400
rather than being ignored.

**The browser script** (`public/assignments.js:28-31, 96-105`):

```js
(function () {
  "use strict";

  var COPY = { … };   // every visible string, in one object
```

ES5-flavoured IIFE, `var`, function expressions. Every visible string in `COPY` (a test enforces
it). Every node built with `createElement` + `textContent` — a candidate name is text somebody
typed, never markup. No `localStorage`, no `sessionStorage`, no `document.cookie`, no `innerHTML`.
One `fetch(`, inside the `api()` helper, and its content-type check is load-bearing: Cloudflare
Access answers an expired session with the sign-in page's HTML at **200**, so `res.json()` throws
and the screen would report a generic failure when the fix is "sign in again".

**The comment voice.** This repo writes the *argument*, not the mechanics. Every non-obvious
decision carries the failure it prevents, and several carry a "do not tidy this into X" warning
with the bug X reintroduces. Match that density — it is the house style, not decoration.

**The copy voice.** Written for a first-time reader. No code words on screen: the table is
`assignment` in the code and the screen says "Bookings". Here, `compliance_item.status` holds
`submitted`, and the screen says "Waiting for you".

---

## IMPLEMENTATION PLAN

### Phase 0: Prerequisite — land #70

**Depends on:** nothing. Must complete before any other phase.

#70's implementation is complete and validated but **uncommitted** on the branch you are on.
Commit it and branch off it, or every dependency of this ticket disappears.

### Phase 1: Foundation — the shared rule

**Independent of:** Phase 2's route/page work, but every later phase imports from it.

`targetFor` moves from `src/compliance/nudges.js` (where it is private) to
`src/compliance/catalogue.js` (which already owns `MAX_AMBER_DAYS` and every threshold). One home
for the amber/red rule, so the sweep and the dashboard cannot disagree about what red means.

### Phase 2: The data layer

**Depends on:** Phase 1 (nothing hard, but keep the ordering so the catalogue is settled first).

Three new statements in `src/compliance/store.js`, under a `#71` section at the foot:
`listComplianceState`, `verifyItem`, `rejectItem`.

### Phase 3: The email

**Depends on:** nothing in Phases 1-2. **Independent of:** Phase 2 — this phase and Phase 2 could
run in parallel worktrees, though the ticket is small enough that it is not worth the setup.

`sendRejectionEmail` in `src/prep/email.js`.

### Phase 4: The routes

**Depends on:** Phases 1, 2, 3.

`functions/api/compliance.js` (GET) and `functions/api/compliance/[id].js` (PUT).

### Phase 5: The screen

**Depends on:** Phase 4 (the page consumes the API contract).

`public/compliance.html`, `public/compliance.js`, the `.compliance-*` block in `public/app.css`,
and the nav entry on all five recruiter pages.

### Phase 6: The digest link

**Depends on:** Phase 5 (the surface the link points at must exist).

`sendExpiryDigestEmail` gains a conditional link, and `DEPLOY.md`'s "no recruiter compliance
surface until #71" paragraph is rewritten.

### Phase 7: Testing & validation

**Depends on:** all of the above.

`test/compliance-dashboard.test.js` (new), plus sections added to `test/compliance-store.test.js`
and `test/prep-email.test.js`, plus one line in `test/screens.test.js`.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

### Prerequisite: commit #70 and branch from it

- **IMPLEMENT**: `#70`'s work is complete (`.claude/reports/expiry-radar-report.md` says so) and
  uncommitted. Run the `piv-commit` skill to land it on `feature/expiry-radar`, then cut this
  ticket's branch from that tip:
  ```bash
  git rev-parse --abbrev-ref HEAD        # expect: feature/expiry-radar
  git status --short                     # expect: #70's files, uncommitted
  # → run piv-commit, then:
  git checkout -b feature/compliance-dashboard
  git rev-parse HEAD > /dev/null && git log --oneline -1     # RECORD THIS SHA
  ```
- **GOTCHA**: **Do not branch from `main`.** `origin/main` is at `66950c7` (#67). #68/#69 are on
  `feature/extension-rebooking-radar` and #70 is the commit you just made. Branching from `main`
  silently drops all four dependencies and nothing in this plan will resolve.
- **GOTCHA**: Memory records that parallel sessions share this worktree — HEAD can move under you.
  Verify the branch immediately before every commit and never `git add -A`.
- **VALIDATE**:
  ```bash
  BASE=$(git rev-parse HEAD)   # export this; every Level 1 gate below uses it
  echo "branch point: $BASE"
  git status --short           # expect: clean (bar untracked .claude/ artefacts)
  ~/.nvm/versions/node/v24.11.0/bin/node --test test/*.test.js 2>&1 | tail -5   # RECORD the baseline pass count
  ```
- **SATISFIES**: the precondition for every AC.

---

### UPDATE `src/compliance/catalogue.js`

- **IMPLEMENT**: Move `targetFor` here from `src/compliance/nudges.js:161-165`, exported, and add
  `CATALOGUE_BY_KEY` beside it (currently `nudges.js:146`). Keep the "RED IS TESTED FIRST" comment
  **verbatim** — the ordering is the correctness and the comment is what stops it being "tidied".
  Add a sentence recording why it moved: the sweep writes the state and the dashboard *computes*
  it at render time, and two homes for the amber/red rule is two answers to "is this red".
- **PATTERN**: `MAX_AMBER_DAYS` (`src/compliance/catalogue.js:66-75`) — derived, never typed,
  living beside the thresholds it derives from.
- **IMPORTS**: none. Update the file header's "Pure data, no imports" claim — it is still true
  (`targetFor` and the Map are pure), but the header says "Pure data" and now the file holds two
  small pure *functions*; amend that sentence rather than leaving it wrong.
- **GOTCHA**: `targetFor` must keep taking `(daysLeft, amberDays)` and returning
  `"expired" | "expiring" | null`. Do not change the signature to take a row — `nudges.js` calls it
  with SQLite-computed `days_left`, and the dashboard route will call it with the same.
- **GOTCHA**: `daysLeft === 0` is **amber, not red** (`isNotPast`'s argument: a certificate valid
  to the 3rd is valid all day on the 3rd). Do not "fix" the `<` to `<=`.
- **VALIDATE**: `~/.nvm/versions/node/v24.11.0/bin/node --test test/expiry-radar.test.js`
- **SATISFIES**: AC #2 (the risk rule has one home).

### UPDATE `src/compliance/nudges.js`

- **IMPLEMENT**: Delete the local `CATALOGUE_BY_KEY` and `targetFor`; import both from
  `./catalogue.js`. Leave a one-line note at the old site saying where the rule went and why (the
  dashboard computes risk at render time and must read the same function).
- **PATTERN**: the existing import block at `src/compliance/nudges.js:56`.
- **GOTCHA**: `sweepExpiryStates` is the only caller. Its behaviour must not change at all — this
  is a pure relocation. If any test in `test/expiry-radar.test.js` fails after this, the move was
  not pure.
- **VALIDATE**:
  ```bash
  ~/.nvm/versions/node/v24.11.0/bin/node --test test/expiry-radar.test.js test/prep-middleware.test.js
  grep -n "function targetFor" src/compliance/nudges.js   # expect: no match
  ```
- **SATISFIES**: AC #2.

---

### ADD `listComplianceState` to `src/compliance/store.js`

- **IMPLEMENT**: Open a new `── the recruiter dashboard (#71) ─` section at the foot of the file
  (after the `#68` door block), and add the read:

  ```sql
  SELECT i.candidate_id, candidate.full_name AS candidate_name,
         i.item_key, i.status, i.reference, i.expiry_date, i.checked_at,
         CASE WHEN i.expiry_date IS NULL THEN NULL
              ELSE CAST(julianday(date(i.expiry_date)) - julianday(date('now')) AS INTEGER)
         END AS days_left
    FROM compliance_item i
    JOIN candidate ON candidate.id = i.candidate_id
   ORDER BY candidate.full_name, candidate.id, i.item_key
  ```

  Write the decision comment above it covering, at minimum:
  1. **`days_left` is computed by SQLite, never in JavaScript** — `dueExpiryItems`' argument
     verbatim (`src/compliance/store.js:460-464`). The dashboard's risk decision must use the same
     clock as the sweep's, or the two surfaces disagree by a day near midnight UTC.
  2. **The `CASE` guard.** Unlike `dueExpiryItems` this selects rows with a NULL `expiry_date`
     (every `missing` item, and both non-expiring items), and `julianday(NULL)` is NULL — the CASE
     makes the null explicit rather than incidental, so a reader knows a null `days_left` means
     "no deadline" and not "arithmetic failed".
  3. **`candidate_id` IS projected, and this is the one store read that returns it.**
     `listAssignments` and `dueExtensionNudges` both refuse it and
     `test/compliance-store.test.js:485-502` asserts that for the radar's statements. The reason it
     is right here: this list is the address book for a **write** — the dashboard's PUT is
     `/api/compliance/:candidateId`, and a screen that cannot name the row it is acting on cannot
     act. Say so, and say what is still refused.
  4. **No `email`.** The reject email's address is fetched server-side by the write route, one
     column at a time (`candidateEmailById` below). A dashboard that received addresses would be
     one careless template from putting one in a log line.
  5. **The bound, stated.** This returns `8 × candidates` rows in one call with no pagination. At
     the pilot's scale that is tens of rows; the day it is not, the fix is a per-candidate
     expansion, not a `LIMIT` bolted here.
  6. **`ORDER BY candidate.full_name, candidate.id`** — the name for a stable human order, the id
     to break a tie between two candidates with the same name, and `item_key` last. The **display**
     order is the catalogue's and is applied by the caller (`items.js`'s rule), exactly as
     `itemsByCandidate` says.
- **PATTERN**: `dueExpiryItems` (`src/compliance/store.js:471-491`) — named columns, comment-per-
  clause, and the `days_left` CAST.
- **IMPORTS**: none new.
- **GOTCHA**: no bound parameters at all here, and that is correct — there is no caller value in
  this statement. Do not add a `LIMIT ?` "for later".
- **VALIDATE**: covered by the tests in the testing tasks; for now
  `~/.nvm/versions/node/v24.11.0/bin/node --check src/compliance/store.js`
- **SATISFIES**: AC #1, AC #2.

### ADD `verifyItem` and `rejectItem` to `src/compliance/store.js`

- **IMPLEMENT**: Two compare-and-swaps in the same `#71` section:

  ```js
  // verifyItem
  `UPDATE compliance_item
      SET status = 'verified', checked_at = datetime('now')
    WHERE candidate_id = ? AND item_key = ? AND status = 'submitted'`

  // rejectItem
  `UPDATE compliance_item
      SET status = 'missing', reference = '', expiry_date = NULL, checked_at = datetime('now')
    WHERE candidate_id = ? AND item_key = ? AND status = 'submitted'`
  ```

  Both return `{ updated: (result.meta?.changes ?? 0) === 1 }`. Both validate `itemKey` against
  `ITEM_KEYS` with `requireOneOf` and `candidateId` with `requireFields`, before any SQL.

  The comment must carry **four** arguments, because each is a tidy-up a reviewer will propose:

  1. **WHY NOT `setItemState`.** It writes `reference = ?` and `expiry_date = ?` unconditionally
     (line 396). Routing verify through it means passing the values back in, and the route does not
     have them — so they arrive as `""` and `null`, and **verifying a document wipes the reference
     number and the expiry date that made it verifiable.** The item then has no date, drops out of
     `dueExpiryItems` (`WHERE expiry_date IS NOT NULL`), and never expires again. That is a silent,
     permanent hole in the radar, opened by the action whose whole point is diligence.
  2. **WHY `AND status = 'submitted'` — the CAS, not a filter.** Three failures at once. It stops
     verifying an item nobody submitted (a `missing` item ticked green is a lie about a document
     that does not exist). It stops the **re-nudge loop**: `dueExpiryItems` selects `verified`
     (line 484) and `claimItemExpiry` accepts `from = 'verified'`, so verifying an item already at
     `expiring` would set it back to `verified`, and the very next sweep would re-amber it and send
     the candidate a **second** email for the same expiry date — breaking the "one message per
     state change" promise `DEPLOY.md` makes. And it makes the action idempotent-safe: a
     double-click's second request finds `verified`, matches nothing, and answers not-found rather
     than re-stamping `checked_at`.
  3. **WHY reject clears `expiry_date`.** A rejected item has no valid document behind it, so it
     has no deadline. Clearing the date drops the row out of `dueExpiryItems` — otherwise a
     rejected certificate would keep generating expiry nudges about a document the recruiter has
     just refused. The reference is cleared for the same reason: it is the number they typed for a
     document that is not accepted, and leaving it standing invites the candidate to re-submit the
     identical value.
  4. **WHY `checked_at` IS stamped here, and why `claimItemExpiry` refuses to.** That column means
     "when did a **person** last touch this" — `claimItemExpiry`'s comment (line 526-531) says so
     and declines to stamp it. Verify and reject are both a person, so both stamp it. The two
     functions are opposite for the same reason.

  Also state the consequence in the open: **an item that ambers while awaiting review has no
  verify action.** The CAS refuses it, and the recruiter can only wait for a re-submit. That is the
  correct trade against the re-nudge loop and it is carried in Open Questions, not hidden.
- **PATTERN**: `claimItemExpiry` (`src/compliance/store.js:538-551`) for the CAS shape and the
  "the tidy-up this forbids" comment style; `setItemState` (line 389-402) for the validation
  preamble.
- **IMPORTS**: `ITEM_KEYS` is already imported at line 19.
- **GOTCHA**: `'verified'`, `'submitted'` and `'missing'` are written as **literals in the SQL**,
  not interpolated from `ITEM_STATUSES` — the file's rule (line 209-210, 444-446): a status list is
  not a bound value.
- **GOTCHA**: `candidateId` and `itemKey` are bound. Never templated.
- **VALIDATE**:
  ```bash
  ~/.nvm/versions/node/v24.11.0/bin/node --check src/compliance/store.js
  grep -c "UPDATE compliance_item" src/compliance/store.js   # expect: 3 (setItemState, claimItemExpiry, + your two = 4 lines; confirm each is intentional)
  ```
- **SATISFIES**: AC #3, AC #4.

### ADD `candidateEmailById` to `src/compliance/store.js`

- **IMPLEMENT**: `SELECT email FROM candidate WHERE id = ?`, bound with `String(id ?? "")`,
  returning `.first()`. One column and no second.
- **PATTERN**: `candidateBySessionHash` (`src/compliance/store.js:746-751`) — "TWO COLUMNS AND NO
  THIRD"; here it is one, because the rejection email needs an address and nothing else.
- **GOTCHA**: the rejection email does **not** greet the candidate by name — `sendExpiryNudgeEmail`
  uses none either, and a name selected "in case" is how a projection widens without a decision.
  Do not add `full_name`.
- **VALIDATE**: `~/.nvm/versions/node/v24.11.0/bin/node --check src/compliance/store.js`
- **SATISFIES**: AC #4.

---

### ADD `sendRejectionEmail` to `src/prep/email.js`

- **IMPLEMENT**: A new `── the rejection (#71) ──` section at the foot.
  Signature: `sendRejectionEmail(env, { to, agencyName, label, reason, link } = {})`.

  - **Subject carries the item label and NOT the reason.** `sendExpiryDigestEmail`'s argument
    applies exactly (`src/prep/email.js:481-483`): an inbox preview naming a locum's compliance
    problem on a shared desk is a disclosure nobody chose. Something like
    `` `${label}: we need a new one` ``.
  - `label` reaches a header, so it takes the `CONTROLS` strip then the `NAME_MAX` cap
    (`sendExtensionNudgeEmail`'s `header()` helper, line 342-347). It is ours — it comes from the
    catalogue — but the treatment is the file's rule for anything reaching a header, and a
    catalogue edit is one careless paste from a newline.
  - `reason` goes in the **body only**. Strip `CONTROLS` (a "one-line reason" with a newline in it
    is not one line) and `escapeHtml` in the html half. The route caps its length; do not cap it
    twice with a different number.
  - The link is `/prep/compliance/login` — the **compliance** door, never `/prep/login`. The two
    portals hold independent cookies and a candidate sent to the wrong one signs in to the wrong
    product (`sendExpiryNudgeEmail`'s note, line 389-391).
  - Decision 17's tone rule: calm, no deadline pressure, no exclamation mark, nothing implying a
    consequence we cannot know. The message says what is needed and where to put it.
  - No reference number anywhere — the item was just cleared, and reading their own paperwork back
    to them is what `sendExpiryNudgeEmail` refuses (line 393-395).
  - Inline styles and literal colours in the html half, `sendOtpEmail`'s note: mail clients strip
    `<style>` blocks and resolve no custom property, so `tokens.css` cannot reach here.
  - Return `sendEmail(env, { to, subject, text, html, from: mailFrom(env, agencyName) })`.
- **PATTERN**: `sendExtensionNudgeEmail` (`src/prep/email.js:338-377`) for the whole shape.
- **IMPORTS**: none new — `CONTROLS`, `NAME_MAX`, `escapeHtml`, `mailFrom`, `sendEmail` are all in
  this file.
- **GOTCHA**: there is a "four emails" note near the top of the file that #70 updated to six. This
  makes it **seven**. Update it, and say what the new one is for.
- **VALIDATE**: `~/.nvm/versions/node/v24.11.0/bin/node --test test/prep-email.test.js`
- **SATISFIES**: AC #4.

---

### CREATE `functions/api/compliance.js`

- **IMPLEMENT**: `GET /api/compliance` → 200
  ```
  { candidates: [ { id, full_name, total, verified, awaiting_review, at_risk, missing,
                    items: [ { item_key, label, expires, amber_days, status, reference,
                               expiry_date, days_left, risk } ] } ] }
  ```
  - Binding check first → 503 `not_configured`. No `sameOrigin` (GET; `src/http.js:41-43`).
  - Call `listComplianceState(env.DB)`, group rows by `candidate_id` into a `Map` (insertion order
    preserves the SQL's name ordering).
  - Build each candidate's `items` by mapping **`COMPLIANCE_CATALOGUE`**, not the rows — `items.js`
    lines 62-75 verbatim, and for its stated reason: a candidate seeded before an item was added
    has no row for it, and iterating rows would make the new item vanish from the checklist rather
    than appear as something to start. Catalogue order is the display order.
  - `risk = targetFor(days_left, amber_days)` when the item `expires` and has a `days_left`,
    otherwise `null`. **This is the render-time computation.** Write the comment: the sweep runs
    only on `/prep/*`, a recruiter's request triggers none, so a screen reading `status` alone
    under-reports exactly on the deployment where nobody has visited the portal — the failure
    `/assignments` avoids by computing `stateOf()` from dates.
  - The four counts, each defined in a comment because each answers a different question:
    - `verified` — the recruiter's **completeness**. Deliberately NOT `items.js`'s `DONE`
      (`submitted|verified`). The candidate's screen counts what *they* have finished; the
      recruiter's counts what *has been checked*, because verifying is the recruiter's job and the
      gap between the two numbers is the work on their desk. Say this, and point at `items.js:32-43`
      so nobody "harmonises" them.
    - `awaiting_review` — `status === 'submitted'`. Same predicate as `items.js`, same name.
    - `at_risk` — items whose **computed** `risk` is non-null. From the date, never the column.
    - `missing` — `status === 'missing'`.
  - **Sort at-risk first**, server-side, so the contract is the ordering and the browser only
    renders: expired count desc → expiring count desc → missing count desc → `full_name` asc.
    Compute expired/expiring counts from `risk`, not `status`.
  - **No email in the response.** A comment saying so, because the store now has a function that
    returns one and the two files sit next to each other.
- **PATTERN**: `functions/api/assignments.js:47-59` for the GET adapter;
  `functions/prep/compliance/api/items.js:62-84` for the catalogue join and the counts.
- **IMPORTS**:
  ```js
  import { COMPLIANCE_CATALOGUE, targetFor } from "../../src/compliance/catalogue.js";
  import { listComplianceState } from "../../src/compliance/store.js";
  import { json, errorResponse } from "../../src/http.js";
  ```
- **GOTCHA**: **do not import `src/compliance/nudges.js`.** It pulls `src/prep/email.js` and
  `getAgency` into a route that sends no mail. `targetFor` lives in the catalogue for this reason.
- **GOTCHA**: `functions/` sits at the repo root, never under `public/` (DEPLOY.md §1). This route
  is Access-gated **by being outside `/prep/*`** — do not add a bypass, and do not put it under
  `functions/prep/`.
- **VALIDATE**: `~/.nvm/versions/node/v24.11.0/bin/node --check functions/api/compliance.js`
- **SATISFIES**: AC #1, AC #2, AC #5.

### CREATE `functions/api/compliance/[id].js`

- **IMPLEMENT**: `PUT /api/compliance/:candidateId`, body
  `{ item_key, action: "verify" | "reject", reason? }`.

  Order of operations, and each step's reason in the comment:
  1. `if (!env.DB) return json({ error: "not_configured" }, 503)`
  2. `if (!sameOrigin(request)) return json({ error: "cross_origin" }, 403)`
  3. `ALLOWED = new Set(["item_key", "action", "reason"])`; anything else → 400
     `unexpected_fields`.
  4. `item_key` checked against `ITEM_KEYS` here → 400 `missing_fields` (so an unknown item is an
     answer the page can act on rather than an error the caller cannot read — `item.js:53-56`).
  5. `action` must be exactly `"verify"` or `"reject"` → 400 `missing_fields`.
  6. **`reason` on a verify is a 400 `unexpected_fields`**, not a silently ignored key. Mirror
     `item.js:76-80`'s treatment of `expiry_date` on a non-expiring item — a body carrying a field
     the action has no use for is a caller who believes something the route is not doing.
  7. **On reject: `reason` is required, non-blank, and capped** (`REASON_MAX = 200`, a module
     constant with a comment: "one line" is the ticket's word, and a cap keeps a runaway value out
     of a Resend rejection nobody can diagnose). Over the cap → 400 `missing_fields`.
  8. **On reject: EVERY precondition for the message is checked BEFORE the write — configuration
     AND recipient.** `RESEND_API_KEY` or a valid `PREP_BASE_URL` absent → 503
     `mail_not_configured`. And `candidateEmailById(env.DB, params.id)` is read **here**, above the
     write, not after it: a candidate id matching nothing → 404 **before writing** (the rule
     `functions/api/assignments.js:98-107` and `src/store.js:210` both argue for by name — "404
     before writing, not after"), and a candidate row with a blank address → 503
     `mail_not_configured` too. Otherwise the bail is reachable through a second door: the item
     resets and no email is possible, which is the exact failure the guard exists to prevent.
     Folding the address into the guard also narrows what `emailed: false` can mean down to one
     thing — Resend threw — which is what makes the page's copy for it honest.
     The argument, which belongs in the header because `src/compliance/nudges.js:25-48` makes a
     whole case out of the opposite precedents:

     > #69 bails before claiming because the email is a courtesy and the screen stays true without
     > it. #70 claims regardless because the state *is* what the passport renders. **Reject is
     > neither.** The state change is visible to the candidate — the item resets to `missing` with
     > its reference cleared — but its *entire content*, the reason, exists only in the email. A
     > write with no send leaves a locum staring at a reset item with no way to learn why, most
     > likely re-submitting the identical reference. So this bails like #69: the item stays
     > `submitted`, which is true, and the recruiter is told to fix the configuration.

  9. The write: `verifyItem` or `rejectItem`. `updated === false` → 409 `not_submitted` with a
     message the page can render. **Not 404** — the candidate and the item almost certainly exist;
     what failed is the state guard, and a recruiter told "not found" would reload and see the row
     still there. (If you prefer 404 for consistency with the other routes, that is defensible —
     but then the page's copy must not say "not found", because it would be wrong. 409 is the
     recommendation.)
  10. On a successful reject, send to the address read in step 8. **The send is after the write**,
      because the CAS is the authority on whether the reject applies — emailing first would mean
      emailing about a reject that then does not happen.
  11. **Report the send outcome**: `{ ok: true, emailed: true|false }`. A send that throws is
      caught, logged **status only** (never the recipient, never the item — `nudges.js:268-271`'s
      rule), and answered `emailed: false` so the page can tell the recruiter to phone them. After
      step 8, `emailed: false` means exactly one thing — Resend threw — because configuration and
      recipient were both settled before anything was written. The write is **not** rolled back:
      the item genuinely is reset, and a rollback would be a second write racing the candidate's
      own.
- **PATTERN**: `functions/api/assignments/[id].js` (the whole file) for the adapter;
  `functions/prep/compliance/api/item.js:63-80` for the per-action field rules;
  `src/compliance/nudges.js:64-77` for `PREP_BASE_URL`'s validation discipline — **reuse it by
  reading how `baseUrl()` works and writing the equivalent inline**, or export `baseUrl` from
  `nudges.js`; do NOT import `nudges.js` wholesale into this route for the reason above. Simplest
  correct move: a small local `baseUrl(env)` in this file with a comment pointing at
  `nudges.js:64-77` as its source, mirroring how the repo already accepts "two small duplications
  rather than one shared risk" (`functions/prep/auth/verify.js:21-23`).
- **IMPORTS**:
  ```js
  import { COMPLIANCE_CATALOGUE, ITEM_KEYS } from "../../../src/compliance/catalogue.js";
  import { verifyItem, rejectItem, candidateEmailById } from "../../../src/compliance/store.js";
  import { getAgency } from "../../../src/store.js";
  import { sendRejectionEmail } from "../../../src/prep/email.js";
  import { json, readJson, sameOrigin, errorResponse } from "../../../src/http.js";
  ```
- **GOTCHA**: the item's display **label** for the email comes from `COMPLIANCE_CATALOGUE`, never
  from the raw `item_key` — the candidate must not read `dbs_enhanced` in an email.
- **GOTCHA**: `getAgency(env.DB).catch(() => null)` — the same degradation `nudges.js:116` takes.
  A missing agency row must not fail the reject; the email falls back to "your recruitment agency".
- **GOTCHA**: PUT and not PATCH — `functions/api/clients/[id].js` and
  `functions/api/assignments/[id].js` both use `onRequestPut` and this repo has no PATCH handler.
- **VALIDATE**: `~/.nvm/versions/node/v24.11.0/bin/node --check "functions/api/compliance/[id].js"`
- **SATISFIES**: AC #3, AC #4.

---

### CREATE `public/compliance.html`

- **IMPLEMENT**: Mirror `public/assignments.html`'s skeleton exactly:
  - `<html lang="en-GB">`, `<meta name="robots" content="noindex, nofollow">`, viewport with **no**
    `maximum-scale` and **no** `user-scalable=no` (WCAG 1.4.4).
  - Stylesheet chain in order: `/fonts.css`, `/tokens.css`, `/app.css`. **No `<style>` block** —
    `test/chrome.test.js`'s `INLINE_STYLE_PAGES` is hardcoded and a page-scoped block would be
    silently ungated in both directions.
  - The topbar with the **new five-screen nav** and `aria-current="page"` on `/compliance`.
  - `.page-head` with `<h1>Compliance</h1>` and a `page-sub` that states the promise and its bound
    in one breath, in a recruiter's words — what this screen shows, and that it holds no documents.
  - One list container (`id="compliance-list"`) plus a `save-state` line (`id="list-state"`,
    `role="status"`). Everything per-candidate is built in JS.
  - `<script src="/compliance.js"></script>` at the foot.
- **PATTERN**: `public/assignments.html` lines 1-39 and 95-102.
- **GOTCHA**: the nav label is **"Compliance"** — the word recruiters and TTR's own site use. Do
  not invent a plainer synonym; unlike `assignment`, this one is not a code word.
- **GOTCHA**: every id this page declares must match every id `compliance.js` asks for.
  `test/screens.test.js` gates it, and a dropped id makes an `el` entry `null` that fails silently
  much later inside a click handler.
- **VALIDATE**: `grep -c "<style" public/compliance.html` → 0
- **SATISFIES**: AC #1, AC #6.

### CREATE `public/compliance.js`

- **IMPLEMENT**: `public/assignments.js`'s structure, adapted.
  - IIFE + `"use strict"`, `var`, function expressions.
  - **One `COPY` object holding every visible string.** A test enforces it.
  - `api()` with the content-type check (the expired-Access-session trap) and `send()` for the PUT.
    **Exactly one `fetch(`.**
  - `showState` / `clearState` including the `is-shown` class (emptying `textContent` alone leaves
    a shown box occupying its own padding).
  - Render: one card per candidate. Head line = name + the counts sentence
    (`"5 of 8 verified · 2 waiting for you · 1 at risk"` — build from COPY functions, and omit the
    clauses that are zero so a clean candidate reads as clean). Then one row per item: the label,
    the reference, the date, a **chase chip** and, when `risk` is non-null, a **risk chip**.
  - Chase chip words, mapped from `status` — none of the five column words appears raw:
    `missing` → "Not sent in", `submitted` → "Waiting for you", `verified` → "Verified",
    `expiring` → "Running out", `expired` → "Ran out".
  - Risk chip from `risk` + `days_left`: `"Runs out in N days"` / `"Runs out today"` /
    `"Ran out N days ago"`. Amber for `expiring`, red for `expired`.
  - **Actions on `status === "submitted"` only**, matching the CAS. Two buttons — "Verify" and
    "Send back" — plus a text input for the reason, revealed by / required for "Send back".
    Every control carries an `aria-label` naming the candidate and the item
    (`assignments.js:186-207`'s pattern) — "Verify" alone is meaningless to a screen reader
    reading a page with forty of them.
  - `emailed: false` in a reject's response gets its own COPY line telling the recruiter the item
    was reset but the email did not go — call them. A `mail_not_configured` 503 gets a different
    one: nothing was changed.
  - After any successful write, re-`load()` so the counts and the sort are recomputed server-side.
  - Empty state: no candidates yet → point at the Bookings screen, since recording a booking is
    what creates a candidate.
- **PATTERN**: `public/assignments.js` in full.
- **GOTCHA**: **no threshold literal in this file.** `amber_days` and `days_left` both arrive on
  the wire, and `risk` is already decided server-side. A `60` or a `30` written here would give the
  catalogue's thresholds a second home — the drift `test/assignments.test.js:309` exists to stop,
  and a sibling test will check for it.
- **GOTCHA**: **no `innerHTML`/`outerHTML`/`insertAdjacentHTML`/`document.write`/`eval(`**, and no
  `localStorage`/`sessionStorage`/`indexedDB`/`document.cookie`. A candidate name and a reference
  number are text somebody typed.
- **GOTCHA**: **no upload control of any kind** — no `type="file"`, no `FormData`, no `multipart`,
  no `enctype`. Metadata-only is spike #66's first decision and this screen is the most plausible
  place in the product for someone to add "attach the DBS certificate".
- **GOTCHA**: nothing candidate-shaped in the URL. The candidate id travels in the **path of the
  PUT** (which is a request, not a location) and never in `window.location`.
- **VALIDATE**: `~/.nvm/versions/node/v24.11.0/bin/node --check public/compliance.js`
- **SATISFIES**: AC #1, AC #3, AC #5, AC #6.

### ADD the `.compliance-*` block to `public/app.css`

- **IMPLEMENT**: A new section directly beneath the `#69` bookings block (which ends at line 1469).
  A card list rather than a table: each candidate is a heading plus rows of items, and eight items
  per candidate in a six-column table would be unreadable.
  - Reuse `--tint-warn` + `--unverified` for amber (5.59:1, measured at `tokens.css:76`) and
    `--tint-*` + `--failed` for red — check `tokens.css`'s measured pairings and use a pair that is
    already gated by `test/tokens.test.js`. **Add no new token.**
  - `--text-muted` for verified/quiet states (holds the 4.5:1 body floor).
  - Dates take `--font-mono` + `font-variant-numeric: tabular-nums` + `white-space: nowrap`
    (`.assignments-date-cell`'s rule: two dates are read by comparing them, and that only works if
    the digits line up).
  - The container scrolls inside its own box rather than widening the page.
  - Reference numbers and candidate names take `overflow-wrap: anywhere`.
- **PATTERN**: `public/app.css:1349-1469`.
- **GOTCHA**: **no raw hex anywhere.** `test/chrome.test.js:107` fails on `#[0-9a-fA-F]{3,8}`
  outside a comment. Branding on this product is a swap of `tokens.css`.
- **GOTCHA**: **no `transition`, `animation` or `@keyframes` outside the
  `prefers-reduced-motion: no-preference` block at the foot of the file.** `#58` inverted the guard
  to opt-in, so a stray transition animates *for* the user who asked for no motion and nothing
  renders differently for anyone testing it. `test/chrome.test.js:80` is the gate.
- **GOTCHA**: the chip always carries the **word**; the colour ranks it and never says it alone.
- **VALIDATE**: `~/.nvm/versions/node/v24.11.0/bin/node --test test/chrome.test.js test/tokens.test.js`
- **SATISFIES**: AC #6.

### UPDATE the topbar on `public/index.html`, `public/clients.html`, `public/counts.html`, `public/assignments.html`

- **IMPLEMENT**: Add `<a href="/compliance">Compliance</a>` to each `.topbar-nav`, positioned
  after `Bookings` and before the `Candidate portal ↗` demo link (which is showcase-only and stays
  last). `aria-current="page"` only on `public/compliance.html`.
- **PATTERN**: `public/index.html:20-31`.
- **GOTCHA**: the nav is duplicated per page on purpose — static `aria-current`, because each file
  knows which screen it is. Do not "fix" it into a shared partial; there is no build step.
- **GOTCHA**: this makes six nav entries. Check the bar at 375px width in the Level 4 sweep — if it
  wraps badly, the fix is a CSS wrap rule in `.topbar-nav`, not dropping an entry.
- **VALIDATE**:
  ```bash
  grep -c 'href="/compliance"' public/index.html public/clients.html public/counts.html public/assignments.html public/compliance.html   # expect 1 each
  ~/.nvm/versions/node/v24.11.0/bin/node --test test/assignments.test.js test/counts.test.js
  ```
- **SATISFIES**: AC #1.

---

### UPDATE `src/prep/email.js` — the digest gains a link

- **IMPLEMENT**: `sendExpiryDigestEmail` takes an optional `link`. When present, append the
  paragraph/line pointing at the recruiter's own compliance screen. When absent, the message is
  byte-identical to today's.
- **PATTERN**: `sendExtensionNudgeEmail`'s link paragraph (`src/prep/email.js:373`).
- **IMPLEMENT (caller)**: in `src/compliance/nudges.js`'s `mailExpiryNudges`, pass
  `link: base ? `${base}/compliance` : undefined`. **Do not add `base` to the digest's guard.**
  That function's comment (lines 224-229) argues at length for two *independent* configuration
  guards — the candidate's nudge needs a base URL, the digest needs a recipient — and coupling
  them would mean a deployment with `RECRUITER_EMAIL` and no `PREP_BASE_URL` stops receiving the
  digest it receives today. The link is an enrichment, not a precondition. Extend that comment to
  say so.
- **GOTCHA**: `/compliance`, never a `/prep/*` path — that would point the recruiter at the
  candidate's door. `test/prep-email.test.js` already asserts this rule for the extension nudge;
  add the sibling assertion.
- **VALIDATE**: `~/.nvm/versions/node/v24.11.0/bin/node --test test/prep-email.test.js test/expiry-radar.test.js`
- **SATISFIES**: AC #4 (the recruiter reaches the surface from the message that told them to).

### UPDATE `DEPLOY.md`

- **IMPLEMENT**: four edits.
  1. The paragraph at ~line 727 — "there is no recruiter compliance surface until #71, and
     `/assignments` deliberately shows no compliance state" — is now half false. Rewrite: the
     digest links to `/compliance` when `PREP_BASE_URL` is set, and `/assignments` still shows no
     compliance state (that part stays true and stays deliberate).
  2. A §4 triage row for the new routes, in the existing format. The most useful one:
     `503 {"error":"mail_not_configured"}` from `PUT /api/compliance/:id` on a reject →
     `RESEND_API_KEY` or `PREP_BASE_URL` is unset in this environment → set it; **nothing was
     written**, the item is still awaiting review.
  3. A note that `/compliance` is Access-gated by being outside `/prep/*` and needs **no** new
     bypass app — `scripts/setup-access.py` is unchanged by this ticket.
  4. A §6 smoke-test line for the new screen.
- **GOTCHA**: **no migration number appears anywhere in these edits.** This ticket adds none.
- **VALIDATE**: `grep -c "0011" DEPLOY.md` → 0
- **SATISFIES**: AC #7, AC #8.

---

### CREATE `test/compliance-dashboard.test.js`

- **IMPLEMENT**: Three blocks, `test/assignments.test.js`'s structure, with a header explaining
  what each engine can and cannot see.

  **Block 1 — the routes, against `fakeD1` (statement order, and which statements never ran):**
  - GET without a binding → 503.
  - GET groups rows by candidate and applies **catalogue order**, not row order.
  - GET's statement selects **no `email`** and no `SELECT *`; it **does** select `candidate_id`
    (assert both, with the reason in the message).
  - PUT: a key outside `{item_key, action, reason}` → 400, `db.calls.length === 0`.
  - PUT: an unknown `item_key` → 400 before any statement.
  - PUT: an unknown `action` → 400 before any statement.
  - PUT: `reason` on a **verify** → 400 `unexpected_fields`.
  - PUT: a reject with no reason → 400; with a reason over `REASON_MAX` → 400.
  - **PUT: a reject with no `RESEND_API_KEY` → 503 and NO `UPDATE` was ever prepared.** This is the
    bail-before-write rule, and it is the single most valuable assertion in the file — without it,
    a half-configured deployment resets a locum's item and never tells them why. Assert on the
    absence of an `UPDATE` rather than on `db.calls.length === 0`: step 8 legitimately issues the
    `candidateEmailById` SELECT, so a zero-statement assertion would fail for the wrong reason.
  - **PUT: a reject for an unknown candidate id → 404, and no `UPDATE` was prepared.** The
    404-before-write rule.
  - **PUT: a reject where the candidate row has a blank `email` → 503 `mail_not_configured`, and no
    `UPDATE` was prepared.** The second door into the same failure, closed.
  - PUT: cross-origin → 403 and nothing written; no binding → 503.
  - **PUT verify: the statement is a single `UPDATE compliance_item` whose text contains
    `status = 'verified'` and `AND status = 'submitted'` and does NOT contain `reference` or
    `expiry_date`.** The regression this catches is someone routing verify through `setItemState`
    and wiping the number and the date.

  **Block 2 — the source scan over the page and its script:**
  - `compliance.js` asks for `/api/compliance` and nothing else (mirror
    `test/assignments.test.js:289`).
  - Exactly one `fetch(`.
  - **AC #5 forbidden-word gate**, scoped outside `COPY` (mirror `test/counts.test.js:41-58` and
    reuse its `copyStart`/`copyEnd` slice trick). Prep-portal behaviour telemetry never reaches a
    recruiter compliance surface. **Two corrections to that file's list, and both matter:**
    - `test/counts.test.js` matches with `new RegExp(forbidden, "i")` — a **substring** match with
      no word boundary. So the bare word `turn` is unusable: `turn` ⊂ `return`, and the gate would
      fail on the first run against any JavaScript ever written. Use these eight, each of which is
      a real identifier in `src/`, `functions/` or `migrations/` (verified by grep — do not add a
      ninth without checking it exists and is not a substring of a common word):
      `competency`, `habit`, `attempt`, `brief_json`, `invite_id`, `opened_at`, `drill`, `ladder`.
      They cover the practice-session surface and the invite's delivery telemetry, which is the
      whole of what epic AC #5 locks out. If you prefer bare words, anchor each with `\b` and say
      in the comment that you diverged from the source file deliberately.
    - **`email` is deliberately NOT in this screen's list**, unlike `counts.js`'s. The reject
      response carries `{ emailed: true|false }` and the page renders a line about it, so the word
      legitimately appears in this file's code. The no-address guarantee is enforced where it is
      actually enforceable — in the store's projection, asserted in `test/compliance-store.test.js`
      — not by a word scan over the browser. Write that reason into the test's comment, or the
      next person will "restore" the missing entry.
  - No HTML sinks, no browser storage.
  - **No upload control of any kind** in either file (`type="file"|FormData|multipart|enctype`).
  - No threshold literal: the script must read `amber_days`/`risk` off the wire. A
    `doesNotMatch(code, /\b(30|60)\b/)` outside `COPY` is the intent, but **check it against your
    finished file before asserting it absolutely** — if a legitimate hit appears (a length, an
    index), narrow the assertion to `amberDays`/`amber_days` literals rather than deleting the
    check.
  - Every visible string lives in `COPY`.
  - The page carries the chrome contract: the script tag, the robots meta, no `maximum-scale`, **no
    `<style>` block**, `aria-current` on its own nav entry.
  - Every one of the five recruiter pages links `/compliance` exactly once.

  **Block 3 — real SQLite, `{ skip }` (everything the fake cannot see):**
  - `openMigrated()` + `d1Shape(db)`; seed a client, then drive `POST /api/assignments` to create
    the candidate and its eight items (the one production path that seeds).
  - **Every fixture date is computed by SQLite** (`db.prepare("SELECT date('now','+N days') AS d")`),
    and **every threshold is read off `COMPLIANCE_CATALOGUE`**, never typed — `test/expiry-radar.test.js`'s
    rule, and the reason the ±1-day boundary tests mean anything.
  - The render-time risk: submit an item with a date inside its own `amberDays` window **without
    running any sweep**, then GET — `risk` is `"expiring"` while `status` is still `"submitted"`.
    **This is the staleness fix, asserted.** Repeat with a past date → `risk === "expired"`.
  - The ±1-day boundary on `targetFor` through the route, for **two items with different
    `amberDays`** in one GET (the assertion a hardcoded threshold would fail).
  - Verify: a `submitted` item → 200, `status === 'verified'`, and **`reference` and `expiry_date`
    are unchanged** (read them before and after).
  - Verify twice: the second → 409, `checked_at` unchanged from the first.
  - Verify a `missing` item → 409, nothing written.
  - **Verify an `expiring` item → 409** — the re-nudge loop refusal. Comment it as a deliberate
    product hole (Open Question 1), so nobody "fixes" the CAS.
  - Reject: → 200, `status === 'missing'`, `reference === ''`, `expiry_date === null`, and the row
    **no longer appears in `dueExpiryItems(db, MAX_AMBER_DAYS)`**.
  - The sort: three candidates — one with an expired item, one with an expiring item, one clean —
    come back in that order from the GET.
  - The counts: `verified`, `awaiting_review`, `at_risk`, `missing` against a hand-built fixture.
  - The cascade still holds: `DELETE FROM candidate` empties everything.
- **PATTERN**: `test/assignments.test.js` (structure), `test/expiry-radar.test.js` (fixture
  discipline), `test/counts.test.js` (the forbidden-word scan).
- **IMPORTS**: `fakeD1`, `d1Shape`/`openMigrated`/`skip`/`SEED_CLIENT`, the two route modules, the
  assignments POST route (to seed), `COMPLIANCE_CATALOGUE`/`MAX_AMBER_DAYS`, `dueExpiryItems`.
- **GOTCHA**: every real-SQLite test takes `{ skip }` as its second argument — `node:sqlite` needs
  Node ≥ 22.5 and the suite must stay green on Node 20.
- **VALIDATE**: `~/.nvm/versions/node/v24.11.0/bin/node --test test/compliance-dashboard.test.js`
- **SATISFIES**: every AC.

### UPDATE `test/compliance-store.test.js`

- **IMPLEMENT**: A new `── the dashboard's three statements (#71) ─` section at the foot, covering
  statement **shape** against the fake: `listComplianceState`'s projection (named columns, no
  `SELECT *`, **no `email`**, and `candidate_id` present **with the reason in the assertion
  message**); `verifyItem`/`rejectItem`'s single `UPDATE` each, the `AND status = 'submitted'`
  guard, the columns each touches and — for verify — the columns it must **not**; the store's own
  400s firing before any SQL.
- **PATTERN**: the `#70` section at lines 587-700.
- **GOTCHA**: **do not add the new functions to the projection loop at lines 485-502.** It asserts
  `doesNotMatch(projection, /candidate_id/)`, which `listComplianceState` deliberately violates.
  This is #70's Deviation 4 repeating — assert inside your own section, where the reason can sit
  beside it.
- **VALIDATE**: `~/.nvm/versions/node/v24.11.0/bin/node --test test/compliance-store.test.js`
- **SATISFIES**: AC #7.

### UPDATE `test/prep-email.test.js`

- **IMPLEMENT**: A `#71` section: `sendRejectionEmail`'s subject carries the **item label and not
  the reason**; the reason appears in both the text and html halves; a reason containing markup is
  escaped in the html half; a label containing a CR cannot open a second header and a runaway one
  is capped; the link is `/prep/compliance/login` and never `/prep/login`; with no `RESEND_API_KEY`
  it makes zero fetch calls; the `From` carries the agency name through `mailFrom`.
  Plus: the digest **with** a link contains `/compliance` and **without** one is unchanged.
- **PATTERN**: the existing digest tests at lines 645-730.
- **VALIDATE**: `~/.nvm/versions/node/v24.11.0/bin/node --test test/prep-email.test.js`
- **SATISFIES**: AC #4.

### UPDATE `test/screens.test.js`

- **IMPLEMENT**: Add `["compliance", "public/compliance.js", "public/compliance.html"]` to
  `SCREENS` (line 44-48) and extend the comment above it to name the fourth screen.
- **VALIDATE**: `~/.nvm/versions/node/v24.11.0/bin/node --test test/screens.test.js`
- **SATISFIES**: AC #6.

---

## TESTING STRATEGY

The framework is `node:test` + `node:assert/strict`, run by `npm test`
(`node --test test/*.test.js`). No runner config, no mocking library. Three engines, and choosing
the right one per assertion is the whole discipline of this suite:

| engine | what it proves | what it CANNOT prove |
|---|---|---|
| `fakeD1` (`test/helpers/fake-d1.js`) | the ORDER of statements, which statements never ran, the exact SQL text, the bound values | anything about results — it runs no SQL and enforces no constraint. It would pass a `>` where the rule means `>=` |
| `openMigrated` + `d1Shape` (`test/helpers/sqlite-d1.js`) | real SQL against the real migrations with `PRAGMA foreign_keys` ON — boundaries, CAS winners and losers, the cascade | needs Node ≥ 22.5, so every test takes `{ skip }` |
| source scan (`readFileSync`) | what a file is ALLOWED TO ASK FOR — a property of the text, not of any render | what it renders. There is no DOM in this suite |

### Unit Tests

`test/compliance-store.test.js` (extended) — statement shape only, against the fake. The three new
statements' text, their bound values, their guards, and their store-level 400s firing before any
SQL.

`test/prep-email.test.js` (extended) — the new message's headers, escaping, link and configuration
behaviour, against the fetch capture that file already uses.

### Integration Tests

`test/compliance-dashboard.test.js` Block 3 — the routes driven end-to-end against real migrated
SQLite. Seed through `POST /api/assignments` (the only path that creates a candidate), submit
through the candidate's own `POST /prep/compliance/api/item` where a realistic fixture helps, then
drive the dashboard's GET and PUT.

The two integration assertions that must not be simplified away, named here so a reviewer knows
they are load-bearing:

1. **Risk is fresh without a sweep.** Submit an item dated inside its amber window, run no sweep,
   GET → `risk === "expiring"` while `status === "submitted"`. This is the difference between a
   dashboard and a stale cache.
2. **Verify preserves `reference` and `expiry_date`.** Read both before, verify, read both after.
   This is the `setItemState` trap, made permanent.

### Edge Cases

- An item whose `amberDays` differs from another's, both in one GET, each at its own ±1-day
  boundary — the assertion a hardcoded 30 or 60 would fail.
- `days_left === 0` → amber, not red.
- A non-expiring item (`references`, `wtr_choice`) with a NULL `expiry_date` → `days_left` null,
  `risk` null, never counted in `at_risk`.
- An `item_key` retired from the catalogue whose rows survive → the row does not appear (the GET
  iterates the catalogue), and the count arithmetic still balances.
- A candidate seeded before an item was added to the catalogue → the new item appears as
  "Not sent in", not missing from the list.
- A candidate with zero items (impossible via `createCandidate`, reachable by hand) → renders as a
  card with a zero count rather than throwing.
- Two candidates with the same `full_name` → stable order via the `candidate.id` tiebreak.
- Verify/reject on a `verified`, `missing`, `expiring` or `expired` item → 409, nothing written.
- Reject with a 200-character reason (at the cap) → accepted; 201 → 400.
- Reject where the send throws → 200 `{ ok: true, emailed: false }`, item still reset, log carries
  a status code and nothing else.
- Reject with no mail configuration → 503, **item unchanged**.
- Reject for an unknown candidate id → 404, **before** any `UPDATE`.
- Reject where the candidate's `email` is blank → 503, **item unchanged**.
- A reference number containing `<script>` → rendered as text on the page, escaped in the email.
- An empty database → GET returns `{ candidates: [] }`, the page shows its empty state.

---

## VALIDATION COMMANDS

Execute every command to ensure zero regressions and 100% feature correctness.

> **Node version.** `package.json` requires `>=22.5` (`node:sqlite`). The local default is
> v20.20.2, where the whole real-SQLite layer skips. **Node 24 is the run that counts:**
> ```bash
> NODE=~/.nvm/versions/node/v24.11.0/bin/node
> $NODE --version    # expect v24.x
> ```
> Under Node 20, `test/node-version.test.js` fails **by design** (#33's gate — `node --test` exits
> 0 on skips, so a Node-20 run would otherwise read as a pass while `node:sqlite` went unproven).
> That is not a regression.

### Level 0: baseline

```bash
BASE=<the branch-point SHA recorded in the prerequisite task>
$NODE --test test/*.test.js 2>&1 | tail -6      # record pass/fail/skipped BEFORE any change
```

### Level 1: the boundaries (each of these is an acceptance criterion, not a lint)

```bash
# 1. NO MIGRATION AND NO LOCKFILE CHANGE. Structural, not a convention.
git diff --name-only $BASE -- migrations/ test/schema.test.js        # expect: empty

# 2. NO events.kind WIDENING — the architecture amendment forbids it.
grep -rn "verify_recorded\|reject_recorded\|expiry_nudge_sent\|extension_nudge_sent" src/ functions/ migrations/   # expect: no matches

# 3. METADATA ONLY — no document custody, anywhere in the diff's code lines.
git diff $BASE -- src/ functions/ public/ | grep '^+' | grep -iE "multipart|FormData|enctype|type=\"file\"|R2|presign"   # expect: no matches

# 4. THE THRESHOLD HAS ONE HOME.
grep -nE "\b(30|60)\b" public/compliance.js                          # expect: no match outside COPY (inspect any hit)
grep -c "amberDays" public/compliance.js                             # expect: 0

# 5. THE DASHBOARD DOES NOT DRAG THE MAIL LAYER INTO A READ ROUTE.
grep -n "nudges.js" functions/api/compliance.js                      # expect: no match

# 6. NO EMAIL IN THE DASHBOARD'S PROJECTION. Reads the function BODY, not the file.
awk '/export async function listComplianceState/,/^}/' src/compliance/store.js | grep -c email   # expect: 0

# 7. VERIFY DOES NOT GO THROUGH setItemState.
grep -n "setItemState" "functions/api/compliance/[id].js"            # expect: no match

# 8. NO RAW COLOUR AND NO PAGE-SCOPED STYLE.
grep -c "<style" public/compliance.html                              # expect: 0
git diff $BASE -- public/app.css | grep '^+' | grep -E "#[0-9a-fA-F]{3,8}\b"   # expect: no match outside a comment

# 9. NO NEW ACCESS BYPASS.
git diff --name-only $BASE -- scripts/setup-access.py                # expect: empty

# 10. NO MIGRATION NUMBER IN THE DEPLOY DOC EDITS.
grep -c "0011" DEPLOY.md                                             # expect: 0
```

> **Why `$BASE` and not `main`.** `origin/main` is at #67, so `git diff main -- migrations/` lists
> #68's, #69's and #70's migrations (0008, 0009, 0010) and reads as a gate failure that has nothing
> to do with this ticket. `.claude/reports/expiry-radar-report.md` Deviation 2 made the identical
> substitution. Once #68–#70 merge, the literal `main` form becomes correct again.

### Level 2: Unit tests

```bash
$NODE --test test/compliance-store.test.js
$NODE --test test/prep-email.test.js
$NODE --test test/compliance-dashboard.test.js
$NODE --test test/screens.test.js test/chrome.test.js test/tokens.test.js
```

### Level 3: Integration / regression

```bash
# The dependency chain this ticket sits on top of — none of it may move.
$NODE --test test/expiry-radar.test.js test/extension-radar.test.js \
             test/compliance-passport.test.js test/compliance-purge.test.js \
             test/compliance-auth.test.js test/compliance-pages.test.js \
             test/assignments.test.js test/counts.test.js \
             test/prep-middleware.test.js test/schema.test.js

# The whole suite. Compare against the Level 0 baseline: pass count up, FAIL 0, SKIP unchanged.
$NODE --test test/*.test.js 2>&1 | tail -6
```

### Level 4: Manual validation

```bash
npm run db:local      # migrate the local D1
npm run dev           # scripts/dev.py — wrangler pages dev
```

If `wrangler` is not in `node_modules` (it was not for #70), walk it programmatically instead:
drive the real handlers against `openMigrated()` in a scratch script, and record in the report that
the browser paint was not verified.

1. `/compliance` loads Access-gated, renders the topbar with **Compliance** current, and shows the
   empty state on a fresh database.
2. Record a booking on `/assignments` → reload `/compliance` → the candidate appears with
   "0 of 8 verified" and 8 "Not sent in".
3. Open `/prep/demo`, sign in to the compliance passport, submit an item with a date **far** in the
   future → `/compliance` shows "Waiting for you", no risk chip, `awaiting_review: 1`.
4. **Verify** it → the chip becomes "Verified", the count rises, and the reference and the date are
   **still on screen**. (The `setItemState` trap, checked by eye.)
5. Submit a second item with a date **inside** its `amberDays` window. Reload `/compliance`
   **without touching `/prep/*` again** → the risk chip reads "Runs out in N days" even though the
   sweep has not run. (The staleness fix, checked by eye.)
6. **Send back** a submitted item with a one-line reason → the item returns to "Not sent in", the
   reference and date are gone, and the candidate's inbox has the message. Check the subject
   carries the item name and **not** the reason.
7. With `RESEND_API_KEY` unset, attempt a send-back → the page says nothing was changed, and the
   item is **still** "Waiting for you".
8. Attempt to verify an item that has gone amber → the page reports it cannot be verified now.
9. Three candidates with different problems → the worst sorts first.
10. **375px width**: no horizontal scroll, the nav wraps rather than overflowing, every chip legible,
    every button's tap target ≥ 44px.
11. Tab through one candidate card: every control reachable, every `aria-label` names the candidate
    and the item.

### Level 5: Additional validation

```bash
# Every visible string is in COPY, and the page/script id contract holds — both are tests, but run
# them last as the "did I leave a stray literal" sweep.
$NODE --test test/compliance-dashboard.test.js test/screens.test.js

# The two Python assurance scripts still parse (this ticket does not change them, so this is a
# no-regression check only).
python3 -c "import ast;[ast.parse(open(f).read()) for f in ['scripts/purge.py','scripts/remind.py','scripts/setup-access.py']]"
```

---

## ACCEPTANCE CRITERIA

Traced from the ticket and epic #65's AC #3.

- [ ] **AC #1 — The list.** `/compliance` is an Access-gated recruiter screen, a topbar sibling of
      Submission pack / Client knowledge / Prep sent / Bookings, showing every candidate with
      completeness ("N of 8 verified"), how many items await review, and how many are at risk.
- [ ] **AC #2 — At-risk flags are computed, not cached.** An item whose `expiry_date` has passed or
      is inside its own catalogue `amberDays` window shows as at-risk **even when no sweep has run
      since**, and the amber/red rule has exactly one home (`targetFor` in `catalogue.js`).
- [ ] **AC #3 — Verify.** A recruiter marks a `submitted` item verified. It is the first and only
      writer of `verified` in the product. `reference` and `expiry_date` are unchanged; `checked_at`
      is stamped; any other starting state is refused.
- [ ] **AC #4 — Reject.** A recruiter sends an item back with a one-line reason. The item returns
      to `missing` with reference and date cleared, the candidate is emailed the reason, and a
      deployment that cannot send — for **any** reason: no API key, no base URL, no recipient
      address, unknown candidate — **refuses the write rather than resetting silently**.
- [ ] **AC #5 — The privacy lock holds.** No prep-portal behaviour telemetry appears anywhere on
      this screen or in its routes; a forbidden-word gate over `public/compliance.js` enforces it;
      no `email` is in the dashboard's projection; no upload control exists in either file.
- [ ] **AC #6 — The screen meets the house craft bar.** No page-scoped `<style>`, no raw hex, no
      motion outside the reduced-motion guard, every visible string in `COPY`, every node built
      with `createElement`/`textContent`, no browser storage, no HTML sink, and the page/script id
      contract gated by `test/screens.test.js`.
- [ ] **AC #7 — No schema change.** `git diff $BASE -- migrations/ test/schema.test.js` is empty,
      and no `events.kind` value is introduced.
- [ ] **AC #8 — Operator docs are current.** `DEPLOY.md` no longer claims there is no recruiter
      compliance surface, carries a triage row for the new routes, and notes that no new Access
      bypass is needed.
- [ ] **AC #9 — No regressions.** The full suite under Node ≥ 22.5 passes with 0 failures and the
      same skip count as the recorded Level 0 baseline.

---

## COMPLETION CHECKLIST

- [ ] #70 committed and this branch cut from its tip; `$BASE` recorded
- [ ] Level 0 baseline pass/fail/skip counts recorded before any change
- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] All ten Level 1 boundary gates clean, run against `$BASE`
- [ ] Levels 2 and 3 green; full suite compared against baseline
- [ ] Level 4 walked (browser or programmatically — record which, and what was left unverified)
- [ ] Acceptance criteria all met
- [ ] The two decisions a reviewer will argue with are stated in the PR body: the CAS on
      `status = 'submitted'` (and the amber-while-awaiting-review hole it creates), and the
      bail-before-write on reject
- [ ] Open Questions 1 and 3 put to the owner rather than decided silently
- [ ] Implementation report written to `.claude/reports/recruiter-compliance-dashboard-report.md`

---

## OPEN QUESTIONS / ASSUMPTIONS

**Questions for the owner — put these to them; do not decide them silently.**

1. **An item that ambers while awaiting review cannot be verified.** The CAS guards on
   `status = 'submitted'`, and an item that crosses into `expiring` while sitting on the
   recruiter's desk falls out of that guard. With `amberDays` of 30–60, a locum submitting a
   certificate two months out hits this routinely. The alternative — allowing verify from
   `expiring` — reintroduces a re-nudge loop (`dueExpiryItems` selects `verified`, so the next
   sweep re-ambers and sends a **second** email for the same expiry date, breaking the
   one-message-per-state-change promise `DEPLOY.md` makes). Mitigation already in this plan: the
   row still *renders* correctly, showing both the chase state and the real risk. **Is
   "wait for a re-submit" acceptable, or does this need a third path (e.g. verify-and-suppress)?**
   That third path is a ticket, not a rider.

   **The second cost, and the one that will land harder with the owner: the completeness headline
   decays and the recruiter cannot restore it.** A fully-verified candidate drifts from "8 of 8
   verified" to "6 of 8" as items amber — the sweep moves `verified` → `expiring`, and the CAS
   refuses verify from `expiring`, so the only path back is the candidate re-submitting. That is
   Open Question 3's complaint (a count falling for something nobody did wrong) mirrored onto the
   recruiter's screen, by the same mechanism. It does **not** change this design — the risk chips
   still tell the truth, which is the whole point of computing risk rather than reading it — but
   put both costs to the owner together, because the pair is what makes this a real question
   rather than an implementation note.
2. **The rejection reason is not stored.** It exists in the email only — no column, no migration,
   no `test/schema.test.js` change, and no free-text recruiter note about a candidate's
   health-adjacent document at rest. The cost: the candidate's passport shows the item back at
   "Not sent in" with no reason on the screen, so a locum who deletes the email has no way to
   recover it. Storing it means a migration and a lockfile change and a new personal-data field —
   which the architecture doc's minimal-fields posture argues against. **Assumed: not stored.**
   Flag it; do not build the column speculatively.
3. **#70's flagged issue, inherited.** A candidate's passport count *falls* when an item ambers
   (`items.js`'s `DONE` set is `submitted|verified`, and `expiring` is in neither), so a locum
   watches their score drop without doing anything wrong. #70's report called this ticket its
   natural home. It is deliberately **not** in scope here — it is a change to the candidate's
   screen, and this ticket is the recruiter's. **Does the owner want an `at_risk` count added to
   `GET /prep/compliance/api/items` and a line under the passport's count?** If yes, it is a small
   follow-up ticket.
4. **409 vs 404 for a failed CAS.** This plan recommends 409 `not_submitted`, because the row
   exists and it is the *state* that refused — telling a recruiter "not found" about a row they can
   see is misleading. Every other route in the repo answers 404 from `changes === 0`. If house
   consistency is preferred over accuracy, switch it and change the page's copy to match.

**Assumptions this plan makes.**

- **The Louis Groves meeting confirmed the leak.** Every ticket past the spike is labelled
  `contingent` on it. If it did not, stop and re-scope before implementing.
- **`paid-scope` is lifted.** The architecture doc records the owner's call: "the whole metadata
  epic ships in the free pilot… Labels on #68/#70/#71 lifted accordingly." The `paid-scope` label
  still shows on the epic's ticket list; the architecture doc is newer and wins.
- The pilot's scale makes one unpaginated GET correct. Stated in the route's header so the day it
  stops being true is a decision rather than a discovery.
- The recruiter's "complete" is `verified` and the candidate's is `submitted|verified`. Two
  different questions, two different counts, deliberately not harmonised.
- `compliance_item.id` is not needed by the dashboard — verify and reject address the row by
  `(candidate_id, item_key)`, which is the pair the schema makes UNIQUE and the pair a URL can
  carry without exposing a sequence.

---

## NOTES (open canvas)

### The one thing that makes this ticket different from #69 and #70

Both radars are **lazy jobs on candidate traffic**. This is a **synchronous screen with a human in
front of it**. That single difference decides three things in this plan, and it is worth holding
in mind while implementing, because every instinct carried over from the last two tickets pulls
the wrong way:

| | #69 / #70 | #71 |
|---|---|---|
| when it runs | whenever a candidate happens to hit `/prep/*` | when a recruiter opens the page |
| can it trust `status`? | yes — it *writes* it | **no** — nothing has swept since, so it computes from `expiry_date` |
| mail failure | log it, move on; the screen stays true | tell the recruiter, because the reason existed only in the mail |
| claim semantics | at-most-once, never rolled back | CAS as a **state guard**, and its loser is a user-visible answer |

### Rejected alternatives

**Extending `/counts` or `/assignments` instead of a new screen.** `test/counts.test.js` asserts
that `counts.js` requests exactly two paths and names none of a forbidden word list — a privacy
gate that makes a promise to a clinical staffing client structural. Compliance state is
per-candidate, so extending it means loosening the gate. `public/assignments.js:2-8` made the same
call for the same reason and it holds a second time. A sibling page costs one file and one nav
entry.

**Reading `status` and letting the sweep be the only writer of risk.** Simplest, and wrong for the
reason in the table above. The tell is that `/assignments` — a screen with a `nudge_sent_at` column
it *could* read — deliberately computes from dates instead, and its comment says why.

**A `compliance_note` column for the rejection reason.** A migration, a `test/schema.test.js`
lockfile change, and a durable free-text field describing a candidate's health-adjacent document.
The architecture doc's posture is "minimal fields"; this is the opposite. Deferred to Open
Question 2 rather than built.

**Sorting in the browser.** The at-risk ordering *is* the ticket's third bullet ("a booking-blocking
red item is unmissable"), so it belongs in the contract rather than in a render function that a
later change could quietly reorder. Server-side, tested.

**One route with a `status` field instead of an `action` field.** `reject` maps to status
`missing`, which is not guessable from the wire, and the reason field only makes sense for one of
the two. `action` names what the recruiter did; `status` would name a side effect.

### Data flow, end to end

```
recruiter opens /compliance
  └─ GET /api/compliance
       └─ listComplianceState(db)            one statement, 8 × candidates rows, days_left from SQLite
       └─ group by candidate_id (Map, insertion order = SQL's name order)
       └─ per candidate: map COMPLIANCE_CATALOGUE  ← never the rows
            └─ risk = targetFor(days_left, amberDays)      ← the render-time computation
       └─ counts: verified / awaiting_review / at_risk / missing
       └─ sort: expired desc → expiring desc → missing desc → name
  └─ render: one card per candidate, two chips per item

recruiter presses Verify
  └─ PUT /api/compliance/:candidateId { item_key, action: "verify" }
       └─ verifyItem(db, …)     CAS on status='submitted'; reference and expiry_date untouched
       └─ 200 { ok: true }  |  409 not_submitted
  └─ re-load()

recruiter presses Send back
  └─ PUT /api/compliance/:candidateId { item_key, action: "reject", reason }
       └─ guard: RESEND_API_KEY + PREP_BASE_URL       →  503, NOTHING WRITTEN
       └─ candidateEmailById(db, id)   one column     →  404 (no row) / 503 (blank), NOTHING WRITTEN
       └─ rejectItem(db, …)     CAS; status='missing', reference='', expiry_date=NULL
       └─ sendRejectionEmail(…)   label in the subject, reason in the body only
       └─ 200 { ok: true, emailed: true|false }   ← false now means exactly one thing: Resend threw
  └─ re-load()
```

### Sequencing / merge risk

This PR stacks on #70's, which stacks on #69's, which stacks on #68's — and **none of the four is
on `main`**. Four unmerged PRs in a chain is the real risk in this ticket, larger than anything in
the code. Two consequences to carry into the PR body:

- Merge order is #68 → #69 → #70 → #71. A reviewer who checks out this branch and diffs against
  `main` will see four tickets' worth of change.
- If the owner merges #68–#70 while this is in flight, rebase rather than merge, so the stack stays
  linear and the Level 1 gates keep pointing at a single branch point.

Memory also records that parallel sessions share this worktree and HEAD moves underneath you.
Verify the branch immediately before every commit, and never `git add -A`.

---

## AMENDMENTS

<!-- Append-only. Newest at the bottom. Empty at creation. -->
