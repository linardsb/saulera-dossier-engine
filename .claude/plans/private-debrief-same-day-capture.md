# Feature: Private debrief — same-day capture that feeds the candidate's next round

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

**Closes #77.** Part of epic **#76** (SPEC Amendment 1). Wave 1, no dependencies.

## Feature Description

Once a candidate's interview date has passed, the prep portal offers one short, private form: what
they were asked, which competencies felt shaky, and one thing to fix next time. Three things happen
with it, all inside the candidate's own cage:

1. Each question they were actually asked can be **assigned to a competency**, which turns it into a
   real `question` row the drill serves next — the highest-fidelity practice material in the
   product, because a real interviewer wrote it.
2. Competencies ticked **shaky** are treated as **less ready** by `targeting.js`, so the next
   session drills them sooner. No number is shown; the effect is invisible and is meant to be.
3. The "one thing to fix" is theirs to re-read before the next round.

It **never crosses the wall.** Decision 2 (`docs/epics/interview-prep/DECISIONS.md`) stands: no
consent surface, no recruiter view, no export. AC5 makes that structural with a test rather than a
promise.

## User Story

As a candidate who has just walked out of an interview
I want to write down what I was asked and what felt shaky, privately
So that my next round practises the questions I actually met, without anyone at the agency seeing
what I got wrong.

## Problem Statement

The portal's state stops at the interview. Everything it knows about a candidate's readiness is
derived from questions **we** generated from the JD — never from the interview that actually
happened. A candidate with a second stage on Friday re-drills a model's guesses while the real
questions, which they remember for about a day, evaporate. And the competency they fluffed is ranked
by our stale cache as though it went fine, because a competency they never practised badly here
still reads "not yet started".

## Solution Statement

One form, gated on `interview_at` having passed, writing to a small candidate-owned cage:

- `debrief` (one row per `candidate_role`, upserted) holds the asked lines verbatim — each with the
  competency the candidate placed it under — and the one fix.
- `debrief_competency` holds the shaky ticks — a join table, not a text column, because AC2 needs a
  **deterministic** mapping with no model call.
- Each **assigned** asked line becomes a `question` row under its competency with `axis = 'lateral'`,
  so the existing targeting rules serve it as an unattempted variant on the next session. No new
  serving path, no new drill code.
- `readiness()` in `src/prep/targeting.js` gains one dampening term for shaky competencies. Ranking
  is `importance × (1 − readiness)`, so a dampened readiness lifts the competency up the queue.
- Everything cascades from `candidate_role` → `invite`, so the 30-day purge and delete-now take it
  with the rest, unchanged.

## Out of Scope / Non-Goals

- **Not included:** any recruiter-facing surface for debrief content — no dashboard tile, no
  "questions this client asks" aggregation, no export. The agency's route to client question
  patterns is the client-knowledge note, written by the recruiter from their own post-interview
  call (SPEC Amendment 1, "Debrief — private, same-day").
- **Not included:** any model call. The constraint is explicit in the ticket: v1 is a deterministic
  mapping the candidate makes by ticking. No summarising the debrief, no inferring the competency
  from the question text, no drafting the "one thing to fix".
- **Not included:** a second debrief per role. One row per `candidate_role`, upserted. A candidate
  with two interview stages edits the same row (decision 11 keeps access to interview + 14 days).
- **Not included:** a drillable "general queue" for **unassigned** lines. Owner's call (see Open
  Questions Q1): an unassigned line stays visible on the debrief page with its picker open, and
  becomes drillable the moment it is assigned. No synthetic bucket competency is created.
- **Not changing:** the answer loop, the ladder transitions (`src/prep/ladder.js`), the help rungs,
  the habits vocabulary, `attempt.note` staying `''`, or the projection discipline on
  `/prep/api/session`.
- **Not changing:** `#78`'s storybank tables, or `targeting.js` beyond `readiness()` and one new
  optional `drillState` input. Both tickets touch this file — keep the diff small.

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: Medium–High (one migration, one route, one page, and a ranking rule the
whole drill reads)
**Primary Systems Affected**: portal D1 schema · `src/portal/store.js` · `src/prep/targeting.js` ·
`functions/prep/api/{debrief,session,turn,brief}.js` · `public/prep/` (new page + two links)
**Dependencies**: none new. No npm package, no model SDK, no environment variable.

## Related Work

**Implements**: [#77](https://github.com/linardsb/saulera-dossier-engine/issues/77) ·
**Epic**: [#76](https://github.com/linardsb/saulera-dossier-engine/issues/76) — architecture inherited
from `docs/epics/candidate-portal.architecture.md` and locked by
`docs/epics/interview-prep/DECISIONS.md`. Intent: `docs/epics/interview-prep/SPEC.md` Amendment 1.

**Back-references** (plans this builds on or inherits decisions from):

- `.claude/plans/portal-schema-retention-gdpr.md` — the cascade + 30-day purge cage every new table
  must hang off (decision 13).
- `.claude/plans/session-engine-targeting-answer-loop.md` — `targeting.js` / `ladder.js`, the
  cache-vs-truth split, and the question-id conventions this ticket extends.
- `.claude/plans/drill-ui-session-shell.md` — the injectable page-controller idiom
  (`initSession({doc, fetchImpl, navigate})`) the new page mirrors.
- `.claude/plans/candidate-compliance-passport.md` — the closest precedent for a candidate-owned
  form: route posture, `.input`/16px rule, re-fetch-after-save.

**Forward-references** (plans that extend or supersede this — append as follow-ups get created):

- (none yet) — #78 (storybank) collides on the migration number and touches `targeting.js`; see
  Open Questions Q3.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `docs/epics/interview-prep/SPEC.md` (lines 16–62, and 149–167 "Targeting", 231–246 "State",
  247–255 "Tone") - Why: the amendment is the contract; the Tone rules govern every visible string.
- `docs/epics/interview-prep/DECISIONS.md` (lines 37–60) - Why: Decision 2 is the wall AC5 tests.
- `migrations/0002_portal.sql` (whole file) - Why: the cage every new table joins — `candidate_role`,
  `competency`, `question`, `attempt`, and the `ON DELETE CASCADE` chain the purge depends on. Note
  `question.competency_id` is **NOT NULL** and `axis` carries `CHECK (axis IN ('lateral','vertical'))`.
- `migrations/0010_assignment_nudge.sql` (whole file, 20 lines) - Why: the house style for a
  migration comment — it argues the decision, not the syntax. Match this density.
- `src/portal/store.js` (lines 1–16 the contract, 155–269 `persistHandover` for the id conventions
  and the INTEGER-affinity trap, 495–520 the session-engine header, 597–651 `recordAttempt` /
  `setCompetencyProgress` / `insertVariant`, 653–674 `observeHabit`'s single-statement upsert) - Why:
  every new store fn mirrors these — bound parameters only, D1-shaped `db` first, no batch API.
- `src/prep/targeting.js` (lines 20–39 `readiness` + `rankCompetencies`, 275–294
  `confidenceQuestion`, 296–343 `drillState`) - Why: the two functions this ticket changes and the
  one composition both routes share.
- `src/prep/ladder.js` (lines 1–17 header, 63–84 `nextStage`) - Why: the cache-vs-truth invariant,
  and why a `shaky` flag must NOT live on the `competency` row next to `stage`/`success_rate`.
- `functions/prep/api/session.js` (whole file, 150 lines) - Why: the projection discipline
  (response written as a literal), `drillState` wiring, and the day-before derivation this route's
  gate mirrors.
- `functions/prep/api/turn.js` (lines 1–33 header, 61–102 the body-vocabulary guard, 113–116 the
  ownership check, 149–181 the write order) - Why: the route posture the debrief route copies
  wholesale — `ALLOWED` set, `sameOrigin`, caps, ownership, hand-built literal responses.
- `functions/prep/compliance/api/item.js` (whole file, 98 lines) - Why: the closest shape to this
  route: a candidate-owned form POST, with the argument for why a status word is *not* in the body
  vocabulary. Same reasoning applies to anything recruiter-owned.
- `functions/prep/api/brief.js` (lines 1–27) - Why: the ⚠ CANDIDATE ROUTE posture and the
  Access-bypass explanation the new route's header must restate.
- `src/prep/session.js` (whole file, 80 lines) - Why: `requireSession`, and `PUBLIC_PREP_PATHS` —
  the debrief route is candidate content, so it does **not** join that list.
- `src/prep/dates.js` (lines 53–66 `toUtcDate`, 153–168 `isNotPast`) - Why: the day-granularity rule
  and the one-reading-of-a-timestamp discipline the gate must follow.
- `src/http.js` (whole file, 59 lines) - Why: `json`, `readJson`, `sameOrigin`, `errorResponse`.
- `public/prep/session.js` (lines 1–180) - Why: the injectable controller idiom, the `COPY` object,
  and the no-browser-storage comment style the new page repeats.
- `public/prep/compliance/passport.js` (lines 1–140) - Why: a form page end to end — `COPY`,
  `showState`/`clearState`, `busy()` via `aria-disabled`, re-fetch after save.
- `public/prep/brief.html` (whole file) and `public/prep/session.html` (whole file) - Why: the two
  pages that gain a link, and the markup contract `test/prep-content.test.js` gates.
- `test/portal-purge.test.js` (lines 37–99) - Why: `PORTAL_TABLES`, `SCOPE_KEY`, `seedInvite` — all
  three need the new tables, and this is AC4's named pattern.
- `test/schema.test.js` (lines 140–175 the regime lists and the exact-tables lock, 200–220
  `EXPECTED_COLUMNS`) - Why: adding a table without editing this file fails the suite; adding one
  *and* editing it carelessly deletes the guard.
- `test/prep-content.test.js` (lines 1–70) - Why: the content-page gate the new page joins.
- `test/prep-session-ui.test.js` (lines 153–167 `SHELL_IDS`, 771–808) - Why: the hand-written id
  mirror and the browser-storage gate; both move when `session.html` gains an id.
- `test/helpers/sqlite-d1.js` (lines 1–40) and `test/helpers/dom.js` (lines 1–40) - Why: real SQL
  for the store/cascade assertions, and the document double for the page controller. `skip` is
  mandatory on every `node:sqlite` test.
- `test/prep-targeting.test.js` (read the first 60 lines for the fixture idiom) - Why: explicit
  `now`, no wall clock; the dampening tests go here.
- `DEPLOY.md` (lines 605–615 for the migration warning shape, 750–765 for a per-ticket section) -
  Why: a new migration needs its ⚠ line, or the next deploy 500s on a missing table.

### New Files to Create

- `migrations/0011_debrief.sql` — the `debrief` and `debrief_competency` tables (renumber if #78
  merges first).
- `functions/prep/api/debrief.js` — `GET` (form state) and `POST` (upsert) for the candidate's own
  debrief.
- `public/prep/debrief.html` — the form page (served at `/prep/debrief`).
- `public/prep/debrief.js` — the page controller, exporting `initDebrief({doc, fetchImpl, navigate})`.
- `test/prep-debrief.test.js` — store + route + the AC5 wall scan.
- `test/prep-debrief-ui.test.js` — the page controller against `test/helpers/dom.js`, plus the
  markup/storage gates for the new page.

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [SQLite UPSERT — `ON CONFLICT DO UPDATE`](https://www.sqlite.org/lang_upsert.html)
  - Specific section: "Parsing Ambiguity" and the `excluded.` pseudo-table.
  - Why: `upsertDebrief` and `insertAskedQuestion` both use it; `excluded.column` is how the update
    half reads the values the insert half tried to write. D1 is SQLite 3.4x, so `RETURNING` is
    available — `observeHabit` (`src/portal/store.js:662`) already relies on both.
- [SQLite — `CREATE TABLE`, table-level PRIMARY KEY](https://www.sqlite.org/lang_createtable.html#the_primary_key)
  - Specific section: composite primary keys and `ON DELETE CASCADE`.
  - Why: `debrief_competency` is a composite-key join table, and `test/schema.test.js`'s column
    parser only ignores table-level constraints beginning `PRIMARY`, `FOREIGN`, `UNIQUE`, `CHECK`,
    `CONSTRAINT` — anything else is parsed as a column name and fails the exact-columns lock.
- [SQLite — datatypes and type affinity](https://www.sqlite.org/datatype3.html#type_affinity)
  - Why: the trap `src/portal/store.js:155` documents. Nothing numeric is written by this ticket,
    which is itself worth one line in the migration comment.
- [Cloudflare Pages Functions — routing](https://developers.cloudflare.com/pages/functions/routing/)
  - Specific section: file-based routing and `_middleware.js`.
  - Why: `functions/prep/api/debrief.js` becomes `/prep/api/debrief` with no registration step, and
    `public/prep/debrief.html` is served at `/prep/debrief`. Both inherit
    `functions/prep/_middleware.js`'s purge, so the route needs no purge of its own.
- [MDN — `<select>` accessibility / labelling](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/select)
  - Why: every per-line picker needs a programmatic label; the visible line text is not one.

### Patterns to Follow

**Store contract** (`src/portal/store.js:12-15`) — every function takes a D1-shaped `db` first, no
HTTP, no `Response`, no `env`; every user value is a bound parameter; nothing is interpolated into
SQL. No `db.batch()` (the test fake cannot drive it — `src/store.js:376-379`).

**Question id conventions** (`src/portal/store.js:207`, `:642`) — core questions are
`${competencyRowId}#${index}`, minted variants `${competencyId}#v-${uuid}`. This ticket adds
`${competencyId}#asked-${digest16}`, which can collide with neither.

**Route posture** (`functions/prep/api/turn.js:61-102`, `functions/prep/compliance/api/item.js:36-80`):

```js
const ALLOWED = new Set(["asked", "shaky", "fix_text"]);   // the whole body vocabulary
if (!env.DB) return json({ error: "not_configured" }, 503);
if (!sameOrigin(request)) return json({ error: "cross_origin" }, 403);   // mutating methods only
const body = await readJson(request);
const unexpected = Object.keys(body ?? {}).filter((k) => !ALLOWED.has(k));
if (unexpected.length) return json({ error: "unexpected_fields", fields: unexpected }, 400);
const session = await requireSession(env.DB, request);
```

**The ownership check** (`src/portal/store.js:575-585`, applied at `functions/prep/api/turn.js:115`) —
anything id-shaped in a body is checked against **this role** before it is written, and a miss is
`404 not_found`, never a silent skip.

**Projection discipline** (`functions/prep/api/session.js:17-21`) — responses are written as
literals; no store row is ever spread into one. `importance`, `stage`, `success_rate`, `difficulty`,
`axis` and `rating` never leave the server. The debrief GET returns `{id, label}` competencies and
the candidate's own text — nothing else.

**Error register** (`functions/prep/api/brief.js:40-44`) — a state that is not a failure gets a page
state, not an error. "Your interview has not happened yet" is a state (`{available: false}`, 200);
a POST before the interview is a caller fault (`403 too_early`).

**Page controller** (`public/prep/session.js:132-150`) — no document reads at module scope; export
`initDebrief({doc, fetchImpl, navigate})` so `node --test` can drive it with `test/helpers/dom.js`.
Every visible string in one exported `COPY` object.

**Browser storage** (`public/prep/brief.js:8-14`) — nothing is written to storage of any kind, and
the comment says so **without naming the APIs**, because the test greps the file for those names.

**Test style** — a header that names the class of failure the file catches, `{ skip }` on every
`node:sqlite` test, and a self-guard on any test that scans files (`test/schema.test.js:114-135`,
`test/prep-content.test.js:63-68`) so a scan that finds nothing fails instead of passing.

---

## IMPLEMENTATION PLAN

### Phase 1: The cage

The tables, the store functions, and the two test files that lock the retention promise. Nothing
candidate-visible yet, and the suite is green at the end of it.

**Tasks:**

- `migrations/0011_debrief.sql`, with a comment that argues the two decisions (join table over
  `shaky_text`; no `updated_at`).
- `test/schema.test.js` and `test/portal-purge.test.js` updated — the exact-tables lock and the
  cascade proof.
- Five store functions in `src/portal/store.js`, under a new `── the debrief (#77) ──` banner.

### Phase 2: The ranking rule

**Depends on:** Phase 1 (needs `shakyCompetencyIds`).
**Independent of:** Phase 4 — the page can be built against the route while these tests are written.

**Tasks:**

- `readiness()` gains the dampening term; `drillState()` gains an optional `shakyIds`.
- `functions/prep/api/session.js` and `functions/prep/api/turn.js` pass it.
- `test/prep-targeting.test.js` proves rank order moves, and that `confidenceQuestion` inherits it.

### Phase 3: The route

**Depends on:** Phases 1–2.

**Tasks:**

- `functions/prep/api/debrief.js` — GET and POST, gated on `interview_at`, ownership-checked, capped.
- `debrief_available` added to `/prep/api/session` and `/prep/api/brief`.

### Phase 4: The page

**Depends on:** Phase 3 for the contract only — the markup and controller can be written in parallel
with it if the response shape below is treated as fixed.

**Tasks:**

- `public/prep/debrief.html` + `public/prep/debrief.js`, prep.css additions for the 16px controls.
- The two entry links (`brief.html`, `session.html`) and their controllers.
- `test/prep-content.test.js`, `test/prep-session-ui.test.js` updated.

### Phase 5: The wall, the spec, and the deploy note

**Depends on:** Phases 1–4.

**Tasks:**

- AC5's reachability scan.
- `docs/epics/interview-prep/SPEC.md` amended so spec and code do not fork (Decision 1).
- `DEPLOY.md` gains the migration warning and a ticket section.
- Full validation, `npm run db:local`, manual sweep.

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

### 1. UPDATE the working tree — branch, and confirm the migration number

- **IMPLEMENT**: `git status` first. This worktree is shared by parallel sessions and
  `docs/epics/interview-prep/SPEC.md` currently carries **uncommitted** Amendment 1 changes — do not
  discard them, and do not `git add -A`. Branch with `git checkout -b feature/private-debrief`, then
  `ls migrations` and take the next free number. `0011` is expected; if #78 (storybank) merged
  first, this becomes `0012` and every reference below moves with it.
- **PATTERN**: recent branches — `feature/compliance-dashboard`, `chore/land-63-content-gate`.
- **GOTCHA**: an applied migration is never edited (`test/schema.test.js:41-45`). Getting the number
  right before writing is cheaper than a rebase after.
- **VALIDATE**: `git branch --show-current && ls migrations | tail -3 && git status --short`
- **SATISFIES**: groundwork for every AC.

### 2. CREATE `migrations/0011_debrief.sql`

- **IMPLEMENT**:

```sql
-- #77 (epic #76): the private debrief. SPEC Amendment 1, "Debrief — private, same-day".
--
-- It joins the PORTAL regime and no other: every row hangs off `candidate_role`, which hangs off
-- `invite`, so decision 13's two erasures — the 30-day purge and delete-now — take a debrief with
-- everything else in one statement. There is no separate retention rule to remember and no
-- tombstone, because a tombstone is candidate data (src/portal/store.js:1-6).
--
-- ONE ROW PER ROLE, not one per interview. `candidate_role_id` is UNIQUE and the route upserts, so
-- "resumable, partial save, re-editable" is one row rewritten rather than a history to reconcile.
-- Decision 11 keeps the portal open to interview + 14 days for second stages; the candidate edits
-- the same row.
--
-- WHY `shaky` IS A JOIN TABLE AND NOT THE SPEC'S `shaky_text` COLUMN. The spec's State line named
-- one, and this migration deliberately does not write it — SPEC.md is amended in the same PR
-- rather than forked (DECISIONS.md decision 1: if behaviour and spec diverge, one of them changes,
-- never silently). The reason is the ticket's own constraint: targeting must treat a shaky
-- competency as less ready with NO MODEL CALL, and a line of prose cannot be read that way. The
-- candidate ticks competencies from the role's own list, so the tick IS a foreign key. It is also
-- the shape SPEC Amendment 1 already chose for the storybank's `story_competency`, one ticket over.
--
-- AND WHY THE FLAG IS NOT A COLUMN ON `competency`. That table's two mutable columns are
-- recompute-then-write CACHES of the attempt log (src/prep/ladder.js:6-11,
-- src/portal/store.js:615-618). A third mutable column that is NOT derivable from the log would
-- make every future reader learn an exemption to the one invariant the drill leans on.
--
-- No `updated_at`: nothing renders it, and test/schema.test.js locks columns exactly, so a column
-- with no reader is churn that a later ticket has to argue its way past.
CREATE TABLE debrief (
  id                TEXT PRIMARY KEY,
  candidate_role_id TEXT NOT NULL UNIQUE REFERENCES candidate_role(id) ON DELETE CASCADE,
  -- The candidate's own words, verbatim, plus where they put each one:
  -- `[{"text": "…", "competency_id": "…" | null}]`. JSON in a TEXT column is
  -- `candidate_role.brief_json`'s precedent, one table over, and it is here for the reason that
  -- one is: the ROUND TRIP is the feature. A line's placement is state the candidate set, so it
  -- has to be stored, not re-derived — re-deriving it from the `question` rows this form creates
  -- cannot answer "which competency did they pick LAST" after a line is moved, because a moved
  -- line deliberately leaves its first question row standing (deleting a question cascades its
  -- attempts away, migrations/0002_portal.sql) and `question` carries no stamp to order them by.
  -- The form would then prefill the wrong pick on the one page whose whole promise is "come back
  -- and add to this".
  asked_json        TEXT NOT NULL DEFAULT '[]',
  fix_text          TEXT NOT NULL DEFAULT '',
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The ticks. Composite primary key rather than a surrogate id: the pair IS the fact, and a
-- duplicate tick is not a second fact. The route replaces the whole set per save (the store's
-- DELETE-then-INSERT, issueOtp's idiom), so there is no partial-update ordering to get wrong.
-- Both parents cascade: the debrief dies with the role, and a competency that somehow goes takes
-- its ticks rather than leaving a dangling one that would dampen nothing.
CREATE TABLE debrief_competency (
  debrief_id    TEXT NOT NULL REFERENCES debrief(id) ON DELETE CASCADE,
  competency_id TEXT NOT NULL REFERENCES competency(id) ON DELETE CASCADE,
  PRIMARY KEY (debrief_id, competency_id)
);
CREATE INDEX debrief_competency_by_competency ON debrief_competency (competency_id);
```

- **PATTERN**: `migrations/0010_assignment_nudge.sql` (argue the decision, not the syntax);
  `migrations/0002_portal.sql` for the cascade style.
- **GOTCHA**: no `IF NOT EXISTS`, no `ALTER` — `test/schema.test.js` parses both forms and only
  sanctions plain `CREATE TABLE` and `ALTER TABLE … ADD COLUMN`.
- **VALIDATE**: `npm run db:local` (the DDL applies against a real database), then
  `node --test test/schema.test.js` after task 3 (the tables and their columns are what this file
  declares).
- **SATISFIES**: AC #1, AC #2, AC #3, AC #4.

### 3. UPDATE `test/schema.test.js` — admit the two tables into the portal regime

- **IMPLEMENT**: add `"debrief"` and `"debrief_competency"` to `PORTAL_TABLES` (keep it sorted);
  add both to `EXPECTED_COLUMNS`:
  `debrief: ["asked_json", "candidate_role_id", "created_at", "fix_text", "id"]` and
  `debrief_competency: ["competency_id", "debrief_id"]`, each with a comment saying what the table
  is and why it holds no fourth column. Update the **test name** ("the portal's seven" → "the
  portal's nine") and the **assertion message** ("a sixteenth table" → "an eighteenth table"), and
  extend the message's regime sentence so the debrief's cage is named.
- **PATTERN**: the existing `COMPLIANCE_TABLES` comment block (`test/schema.test.js:155-170`) is the
  model — it explains why `candidate_otp` joins one regime and not the other. Write the same for
  `debrief`: it hangs off `candidate_role`, so the 30-day invite purge governs it, not the
  compliance cage's 12-month one.
- **GOTCHA**: the engine regime's `forbidden` regex includes `brief` — `debrief` matches it. That is
  correct and must stay: it is the guard that fires if anyone files these under `ENGINE_TABLES`.
- **VALIDATE**: `node --test test/schema.test.js`
- **SATISFIES**: AC #4 (and the boundary decision behind AC #5).

### 4. UPDATE `test/portal-purge.test.js` — prove the cascade takes the debrief

- **IMPLEMENT**: add `"debrief"` and `"debrief_competency"` to `PORTAL_TABLES`; add to `SCOPE_KEY`
  `debrief: (r) => r.candidate_role_id` and `debrief_competency: (r) => r.debrief_id`; in
  `seedInvite`, insert one debrief per invite with id `deb-${letter}` against `role-${letter}`
  (`asked_json` a two-entry array, one placed and one `null`; `fix_text` a sentence) and two
  `debrief_competency` rows against
  `comp-${letter}-1` and `comp-${letter}-2`. Update the per-invite row-count comment in
  `seedInvite`'s docstring (`1+1+2+2+3+1+1` → `+1+2`).
- **PATTERN**: `inviteOf` reads the letter from `SCOPE_KEY(row).split("-")[1]`, so `role-A` and
  `deb-A` both resolve to `A` — the fixture ids must keep that shape.
- **GOTCHA**: `debrief_competency` has no `id` column and `rowsOf` orders by `id`. SQLite gives a
  `WITHOUT ROWID`-less table an implicit `rowid`, so `ORDER BY id` **fails** here. Either give
  `rowsOf` a per-table order key, or order that one table by `debrief_id, competency_id`. Decide it
  once, in a comment — this is the single most likely place this task goes red for a reason that
  looks like the cascade.
- **VALIDATE**: `node --test test/portal-purge.test.js` (Node ≥ 22.5, else every test skips and
  proves nothing — check the output says `pass 5`, not `skipped 5`).
- **SATISFIES**: AC #4.

### 5. ADD the debrief store functions to `src/portal/store.js`

- **IMPLEMENT**: a new banner `// ── the private debrief (#77) ─────` at the end of the file, then:

```js
/** The candidate's debrief for a role, or null. Raw columns — the route parses `asked_json`, the
 *  way brief.js parses `brief_json`, because a store that parsed it would have to decide what a
 *  corrupt row means and that decision belongs to the caller. */
export async function debriefByRole(db, roleId) { /* SELECT id, asked_json, fix_text, created_at
    FROM debrief WHERE candidate_role_id = ? */ }

/** Write the debrief, whether or not one stands, and return the id the row now has.
 *  `asked` is an ARRAY and this function stringifies it (persistHandover's treatment of
 *  brief_json) — one JSON.stringify in the codebase, not one per caller.
 *  ON CONFLICT on the UNIQUE candidate_role_id, so the id is minted once and every later save
 *  edits the same row — the ticks hanging off it survive a re-save, which they would not if this
 *  were DELETE-then-INSERT. RETURNING id (observeHabit's idiom) so the caller needs no re-read. */
export async function upsertDebrief(db, { roleId, asked, fixText } = {}) { /* requireFields({roleId});
    INSERT INTO debrief (id, candidate_role_id, asked_json, fix_text) VALUES (?, ?, ?, ?)
    ON CONFLICT (candidate_role_id) DO UPDATE SET asked_json = excluded.asked_json,
      fix_text = excluded.fix_text RETURNING id */ }

/** Replace the whole tick set. DELETE then INSERT — issueOtp's idiom (store.js:435): the newest
 *  save is the truth, and a set replaced wholesale has no half-state to reconcile. Callers pass
 *  ids ALREADY checked against the role. */
export async function setShakyCompetencies(db, { debriefId, competencyIds } = {}) { /* … */ }

/** The competency ids this role's candidate called shaky — targeting's only read of the debrief.
 *  Returns a plain array of ids; the caller makes the Set. */
export async function shakyCompetencyIds(db, roleId) { /* SELECT dc.competency_id FROM
    debrief_competency dc JOIN debrief d ON d.id = dc.debrief_id
    WHERE d.candidate_role_id = ? ORDER BY dc.competency_id */ }

/** A question the candidate was really asked, filed under the competency THEY assigned it to.
 *
 *  THE ID IS DERIVED FROM THE TEXT, and that is the whole idempotency: `${competencyId}#asked-`
 *  plus the first 16 hex of the text's SHA-256 (hashToken, this file's own helper). Re-saving the
 *  same form re-derives the same id and ON CONFLICT DO NOTHING makes the second save a no-op — by
 *  construction, not by a read-then-write race on a route whose ordinary path is re-saving.
 *  It can collide with neither `#${index}` core ids nor `#v-${uuid}` variants.
 *
 *  It is an INSERT key and nothing else. Never read a line's current placement back off these ids:
 *  a line moved between competencies leaves its first row standing, so two ids share one digest
 *  and `question` has no stamp to order them by. The placement lives in `debrief.asked_json`, which
 *  is why that column is JSON.
 *
 *  axis = 'lateral', variant_of = NULL. Lateral because targeting reads a non-null axis as "a
 *  stored variant" and serves unattempted ones before it mints (targeting.js:146-150) — which is
 *  exactly what a real question deserves, and it needs no new serving path. NULL variant_of
 *  because this question is not a variant OF one of ours; the column is nullable and nothing
 *  branches on it (only turn.js:193 looks one up by id, and a mint never names an asked row).
 *  difficulty NULL, which targeting reads as standard (targeting.js:102). */
export async function insertAskedQuestion(db, { competencyId, text } = {}) { /* … returns {id, inserted} */ }
```

- **PATTERN**: `insertVariant` (`src/portal/store.js:637-651`) for shape; `observeHabit` (`:662`) for
  the single-statement upsert with `RETURNING`; `hashToken` (`:25`) is already exported here.
- **IMPORTS**: none new — `StoreError` and `hashToken` are in-file.
- **GOTCHA**: `hashToken` throws `missing_fields` on an empty string, so the route must reject blank
  lines before calling. And `requireFields` rejects blank strings — `asked` (`[]`) and `fixText`
  (`''`) are legitimately empty on a partial save, so validate only `roleId` there.
- **VALIDATE**: `node --test test/portal-store.test.js test/schema.test.js` (no new assertions yet —
  this proves nothing regressed and the module still parses).
- **SATISFIES**: AC #1, AC #2, AC #3.

### 6. CREATE `test/prep-debrief.test.js` — the store half

- **IMPLEMENT**: header naming the class of failure (a debrief that outlives its invite; a re-save
  that duplicates a question row; a tick that dampens nothing). Drive **real SQL** via
  `test/helpers/sqlite-d1.js` (`openMigrated`, `d1Shape`, `skip`) — the upsert, the `ON CONFLICT DO
  NOTHING` and the cascade all branch on constraints `test/helpers/fake-d1.js` fakes. Assert:
  upsert creates then edits one row and keeps its id; a re-save keeps the ticks hanging off it;
  `asked_json` round-trips an array containing a `null` placement, and a line MOVED from one
  competency to another comes back reporting the NEW one (the round trip AC1 turns on);
  ticks replace wholesale; `shakyCompetencyIds`
  is scoped to the role and returns nothing for a role with no debrief; `insertAskedQuestion` is
  idempotent across two identical saves and creates two rows for two different texts; the same text
  assigned to two different competencies makes two rows (different ids); an asked question is
  returned by `questionsByRole` with `axis === 'lateral'`.
- **PATTERN**: `test/prep-send.test.js` for the sqlite-backed store test; `{ skip }` on every test.
- **VALIDATE**: `node --test test/prep-debrief.test.js`
- **SATISFIES**: AC #1, AC #3.

### 7. UPDATE `src/prep/targeting.js` — dampen readiness for a shaky competency

- **IMPLEMENT**:

```js
/**
 * How far a shaky competency is pushed back down the ladder: one rung of readiness's own
 * five-point denominator (#77). SPEC Amendment 1 — "targeting treats a shaky competency as less
 * ready" — and the unit is chosen so the effect is legible rather than tuned: a competency the
 * candidate says went badly ranks as though it were a stage lower, which is what they just told
 * us. Subtractive and clamped at 0, not multiplicative: at stage 0 there is nothing to multiply.
 */
export const SHAKY_DAMPEN = 0.2;

export function readiness({ stage, success_rate, shaky }) {
  const raw = (stageNumber(stage) + clamp(success_rate, 0, 1)) / 5;
  return shaky ? Math.max(0, raw - SHAKY_DAMPEN) : raw;
}
```

  Then `drillState({ …, shakyIds = [] })`: build `const shaky = new Set(shakyIds)` and mark each row
  in the map that already attaches `last_attempt_at` —
  `{...c, shaky: shaky.has(c.id), last_attempt_at: …}`. Nothing else in the file changes:
  `rankCompetencies` and `confidenceQuestion` both call `readiness` and inherit it.
- **PATTERN**: `drillState` already decorates rows before ranking (`targeting.js:324-326`) — extend
  that one expression, do not add a second pass.
- **GOTCHA**: the flag must **not** reach a response. `session.js` builds its competency literals by
  hand (`:129-134`), so it cannot leak by accident — keep it that way, and do not add `shaky` to
  `competenciesByRole`'s SELECT.
- **VALIDATE**: `node --test test/prep-targeting.test.js`
- **SATISFIES**: AC #2.

### 8. UPDATE `test/prep-targeting.test.js` — prove the dampening moves the queue

- **IMPLEMENT**: three tests. (a) two competencies with equal importance and equal cached
  stage/rate, one ticked shaky → `drillState().target` is the shaky one, and the un-ticked one is
  target when the tick is removed. (b) `readiness` is clamped: a stage-`''`, rate-0, shaky
  competency reads 0, never negative. (c) `confidenceQuestion` inherits it — with two competencies
  that each hold a success, the shaky one is **not** the day-before confidence pick.
- **PATTERN**: this file's fixture idiom — explicit `now`, no wall clock (`test/prep-targeting.test.js:3`).
- **VALIDATE**: `node --test test/prep-targeting.test.js`
- **SATISFIES**: AC #2.

### 9. CREATE `functions/prep/api/debrief.js`

- **IMPLEMENT**: one file, both handlers (the resource is one thing; the items.js/item.js split next
  door is resource-shaped, not method-shaped — say so in the header so a reviewer does not ask).

  Header must carry: the ⚠ CANDIDATE ROUTE posture (brief.js:13-20 restated); the wall sentence
  (nothing here is readable by any recruiter surface — Decision 2); and the gate's day-granularity
  reason.

  `onRequestGet`:
  1. `if (!env.DB) return json({ error: "not_configured" }, 503)`; `requireSession`;
     `roleByInviteId` → `404 not_found` if absent.
  2. `const days = daysToInterview(role.interview_at, now)` — **available iff `days <= 0`**. Comment
     why: `interview_at` for a date-only booking is stored `'YYYY-MM-DD 00:00:00'`
     (`toSqliteUtc`), so an instant comparison would open the debrief at midnight on the interview
     day. Day granularity is the same rule `isNotPast` and `isDayBefore` already use, and it is what
     makes "same-day" true.
  3. Not available → `json({ available: false })`, 200. No interview date in the body: the page has
     nothing to do with it, and it is one field fewer on the wire.
  4. Available → read `debriefByRole`, `shakyCompetencyIds`, `competenciesByRole`. Parse
     `asked_json` inside a `try` and treat a corrupt value as an empty list, logging the code alone
     (brief.js:46-56's register, minus the 502: a debrief this route wrote is not a contract another
     module owns, and answering "your notes will not load" over a page that could still take new
     ones is worse than starting the list empty). Keep only entries whose `text` is a non-blank
     string, and null any `competency_id` no longer in this role's competency list — a competency
     can vanish under a re-handover, and a stale id in a picker is a select with no matching option.
  5. Respond as a literal:
     `{ available: true, asked: [{text, competency_id}], shaky: [ids], fix_text,
        competencies: [{id, label}] }` — `competency_id` is `null` for an unplaced line (that list
     **is** the general queue). Labels and ids only; never `importance`, `stage` or `success_rate`.
     No `saved_at`: nothing renders it, and with no `updated_at` column it would report the FIRST
     save, which is worse than absent.

  `onRequestPost`:
  1. `not_configured` → `sameOrigin` → `readJson` → `ALLOWED = new Set(["asked","shaky","fix_text"])`
     → `unexpected_fields`.
  2. `requireSession` → `roleByInviteId` → 404.
  3. Gate: `daysToInterview(...) > 0` → `json({ error: "too_early" }, 403)`.
  4. Shape and caps, each its own `400 missing_fields` / `too_long`:
     `asked` an array (default `[]`) of at most `MAX_ASKED = 20` objects `{text, competency_id}`,
     each `text` a non-blank string ≤ `LINE_MAX = 500`; `shaky` an array of at most the role's
     competency count; `fix_text` a string ≤ `FIX_MAX = 2_000`. Caps are constants at the top of the
     file with turn.js:66-68's one-line justification each.
  5. **Ownership**: every non-null `competency_id` and every `shaky` id must be in
     `competenciesByRole(role.role_id)`'s ids — a miss is `404 not_found` (turn.js's register: a
     competency under someone else's invite is not found, never a silent skip).
  6. Writes, in dependency order, each derivable from the one before:
     `upsertDebrief` (the normalised `asked` array; `fix_text`) → `setShakyCompetencies` →
     `insertAskedQuestion` per **placed** line. Creating question rows is **last** and its failure
     must not discard the saved text — wrap that loop and, on error, log the code alone
     (`turn.js:210`) and still answer 200. State in the header that a re-save re-derives the same
     ids, so the retry is free.
  7. `return json({ ok: true })`. The page re-fetches (passport.js's rule) rather than patching, so
     nothing else needs to come back — and a count the page never reads is a field to maintain for
     no reader.
- **IMPORTS**: `roleByInviteId, competenciesByRole, debriefByRole, upsertDebrief,
  setShakyCompetencies, shakyCompetencyIds, insertAskedQuestion` from
  `../../../src/portal/store.js`; `requireSession` from `../../../src/prep/session.js`;
  `daysToInterview` from `../../../src/prep/targeting.js`; `json, readJson, sameOrigin, errorResponse`
  from `../../../src/http.js`. **No `@anthropic-ai/sdk`** — the ticket's constraint is no model call,
  and keeping the import out is what makes that un-regressable (session.js:6-11's argument).
- **GOTCHA**: the route must **not** join `PUBLIC_PREP_PATHS` — it holds candidate content. And no
  purge call: `functions/prep/_middleware.js` already ran one.
- **VALIDATE**: `node --test test/prep-debrief.test.js`
- **SATISFIES**: AC #1, AC #3, AC #6.

### 10. UPDATE `test/prep-debrief.test.js` — the route half

- **IMPLEMENT**: drive both handlers directly with a `context` double over `d1Shape(openMigrated())`
  (seed an invite + role + competencies + a session cookie the way `test/prep-session-ui.test.js`'s
  `seed`/`boot` helpers do). Assert: GET before the interview → `{available:false}` and **no** debrief
  row is created; GET on the interview day (days === 0) → available; POST before → 403 `too_early`;
  POST with an unknown key → 400 `unexpected_fields`; POST cross-origin → 403; POST with no session →
  401; a `competency_id` from another role → 404 and **nothing written**; over-cap lines/`fix_text` →
  400; a partial save (only `fix_text`) succeeds and a later save adds the lines without losing it;
  two identical saves create the question row **once** (`questionsByRole` count is stable); an
  assigned line appears as the next question for its competency through `drillState`; an unassigned
  line comes back with `competency_id: null` and creates no question row; **a line moved from one
  competency to another comes back on the next GET reporting the new one** (the failure the
  `asked_json` column exists to prevent — see task 2's comment); a corrupt `asked_json`, written
  straight into the row by the test, degrades to an empty list rather than a 500.
- **PATTERN**: `test/prep-turn.test.js` for driving a `/prep` POST route with a session cookie.
- **VALIDATE**: `node --test test/prep-debrief.test.js`
- **SATISFIES**: AC #1, AC #3, AC #6.

### 11. UPDATE `functions/prep/api/session.js` and `functions/prep/api/turn.js` — feed targeting the ticks

- **IMPLEMENT**: in both routes, `const shakyIds = await shakyCompetencyIds(env.DB, role.role_id);`
  and pass `shakyIds` into `drillState({...})`. In `session.js` also add
  `debrief_available: daysToInterview(role.interview_at, now) <= 0` to the response literal — the
  route already computes `daysToInterview` for `dayBefore`, so reuse that value rather than calling
  twice. `turn.js` needs no new response field.
- **PATTERN**: the store reads already sit in one block at the top of each handler.
- **GOTCHA**: `turn.js` calls `drillState` **after** the writes (`:186`); the shaky read can sit with
  the other reads at the top, but if it does, note that a debrief saved mid-turn is picked up on the
  next turn — same staleness the competency cache already has, and harmless.
- **VALIDATE**: `node --test test/prep-turn.test.js test/prep-session-store.test.js` plus the whole
  suite later.
- **SATISFIES**: AC #2, AC #1 (the link's gate).

### 12. UPDATE `functions/prep/api/brief.js` — one boolean for the entry link

- **IMPLEMENT**: add `roleByInviteId` (one extra SELECT) and return
  `json({ ...candidateProjection(payload), debrief_available })`. Comment the spread: it spreads the
  **projection**, which is this codebase's own literal, never a store row — the discipline that file
  states is about store rows (`brief.js:58-60`). If the role row is missing but the brief is present
  (not a state that occurs today), default the flag to `false` — fail closed.
- **PATTERN**: `functions/prep/api/session.js:70` for the derivation.
- **VALIDATE**: `node --test test/prep-content.test.js test/prep-registry.test.js`
- **SATISFIES**: AC #1.

### 13. CREATE `public/prep/debrief.html`

- **IMPLEMENT**: mirror `session.html`'s skeleton exactly — same four stylesheet links in the same
  order (`/fonts.css`, `/tokens.css`, `/app.css`, `/prep/prep.css`), `<meta name="robots"
  content="noindex, nofollow">`, the viewport with **no** `maximum-scale`, the candidate topbar, the
  `prep-footer` privacy link, and an inline module script that imports and calls `initDebrief()`.
  **No inline `<style>` block** (that keeps the page off `test/chrome.test.js`'s inline-style list).

  Structure: `<main class="debrief">` with `page-head` (h1 + `page-sub` + `<p class="save-state"
  id="debrief-state" role="status">`), then a form section holding, in order:
  `#asked` (textarea, class `textarea`), `#asked-lines` (the mount the controller fills with one
  row + `<select class="select">` per line), `#shaky-list` (the mount for one checkbox per
  competency), `#fix` (textarea, class `textarea`), `#save` (button), and `#unavailable` (a hidden
  section carrying the "this opens after your interview" copy).
- **PATTERN**: `public/prep/session.html` for the shell; `public/prep/compliance/index.html` for a
  form page's field rhythm.
- **GOTCHA**: `class="textarea"` on both textareas is load-bearing — app.css sizes `.textarea` at
  `--text-note` (16px) and iOS Safari zooms the viewport on any focused control under 16px
  (`session.html:53-58`). `.select` and any `.input` need the same treatment added to prep.css in
  the next task.
- **VALIDATE**: `node --test test/prep-content.test.js` (after task 17 registers the page).
- **SATISFIES**: AC #1, AC #6.

### 14. UPDATE `public/prep/prep.css` — the 16px floor for this page's controls

- **IMPLEMENT**: alongside the `.passport .input` rule (`prep.css:387-388`), add
  `.debrief { max-width: 60ch; }` and `.debrief .select, .debrief .input { font-size: var(--text-note); }`
  with a one-line comment pointing at the iOS zoom reason. Tokens only.
- **GOTCHA**: `test/prep-registry.test.js` runs a colour/motion gate over prep.css — **no raw hex,
  no raw px**. Use `var(--…)` for every value, and check `test/chrome.test.js`'s rules before adding
  anything with a transition.
- **VALIDATE**: `node --test test/prep-registry.test.js test/chrome.test.js test/tokens.test.js`
- **SATISFIES**: AC #6 (and the accessibility posture the sibling gates enforce).

### 15. CREATE `public/prep/debrief.js`

- **IMPLEMENT**: `export function initDebrief({doc, fetchImpl, navigate} = {})`, module-scope
  document reads forbidden (`session.js:11-14`). Export a `COPY` object holding **every** visible
  string, written for a first-time candidate — no scores, no ranks, no "assessment" vocabulary:

```js
export const COPY = {
  loading: "Loading…",
  tooEarly:
    "This page opens after your interview. Come back once you have been, and you can note down " +
    "what you were asked while it is fresh.",
  failed:
    "We could not load this just now. Reload the page, and if it still will not load, reply to " +
    "the email that invited you.",
  askedLabel: "What were you asked?",
  askedCaption:
    "One question per line, as close to their words as you remember. Half-remembered is fine.",
  placeLabel: "Put each question with the part of the job it was about",
  placeCaption:
    "This is how a question comes back to you next time you practise. Leave any of them on " +
    "“Not sure yet” and it stays on this page until you do.",
  unplaced: "Not sure yet",
  shakyLabel: "Anything that felt shaky?",
  shakyCaption:
    "Tick whatever you would want another go at. Nothing here is a mark, and nobody sees it.",
  fixLabel: "One thing to do differently next time",
  fixCaption: "One is enough. It is easier to change one thing than five.",
  save: "Save this",
  saving: "Saving…",
  saved: "Saved. You can come back and add to this whenever you like.",
  saveFailed: "Could not save that just now. Try again in a moment. Your words are still below.",
  privateNote: "This page is yours. Your recruiter never sees any of it.",
};
```

  Behaviour: fetch `/prep/api/debrief` → 401 navigates to `/prep/login` (`brief.js:63-72`'s
  never-resolving promise); `{available:false}` shows `#unavailable` and hides the form;
  `{available:true}` fills both textareas, renders one labelled `<select>` per non-blank line of the
  asked box (re-rendered on `input`/`change` of the textarea, preserving each surviving line's
  current pick by text), renders one checkbox per competency, and wires `#save` to POST the whole
  form state (`{asked:[{text, competency_id}], shaky:[ids], fix_text}`) then **re-fetch**.
  `aria-disabled` on the button while in flight (`passport.js:116-122`), never `disabled`.
  Text nodes only — `createElement`/`createTextNode`, never an HTML-parsing assignment.
- **GOTCHA**: repeat the no-browser-storage comment **without naming the APIs**
  (`brief.js:8-14`) — the test greps this file for those names and a comment that trips it gets the
  gate deleted.
- **VALIDATE**: `node --test test/prep-debrief-ui.test.js`
- **SATISFIES**: AC #1, AC #3, AC #6.

### 16. CREATE `test/prep-debrief-ui.test.js`

- **IMPLEMENT**: drive `initDebrief` with `test/helpers/dom.js` and a `fetchImpl` double. Assert:
  the too-early payload renders `COPY.tooEarly` and no form controls; an available payload prefills
  both textareas and pre-ticks the shaky boxes; typing three lines renders three selects, each
  carrying every competency label plus `COPY.unplaced`; save POSTs exactly the current state to
  `/prep/api/debrief` and re-fetches; a failed save shows `COPY.saveFailed` and **keeps the typed
  text**; 401 navigates to `/prep/login`. Then the source gates, mirroring
  `test/prep-session-ui.test.js:771-781`: no `innerHTML|outerHTML|insertAdjacentHTML|document.write|
  createContextualFragment` and no `localStorage|sessionStorage|indexedDB|document.cookie` in either
  `debrief.js` or `debrief.html`; and no candidate text reaches a URL (the `marker` test at
  `:783-796` is the pattern).
- **PATTERN**: `test/prep-session-ui.test.js` end to end.
- **VALIDATE**: `node --test test/prep-debrief-ui.test.js`
- **SATISFIES**: AC #6, and the privacy posture behind AC #5.

### 17. UPDATE `test/prep-content.test.js` — admit the debrief page to the content gate

- **IMPLEMENT**: read `public/prep/debrief.html` / `public/prep/debrief.js`, add the page to
  `CONTENT_PAGES` (which buys the viewport, stylesheet-order and no-inline-style assertions), and
  extend the "every element the script reaches by id exists in the markup" test to cover
  `debrief.js`'s `$`-helper lookups — note in a comment that this file uses a `$` helper like
  session.js, not literal `getElementById` calls like brief.js, so the regex differs. Keep the
  `reached.length >=` self-guard so the loop cannot pass over an empty set.
- **VALIDATE**: `node --test test/prep-content.test.js`
- **SATISFIES**: AC #6.

### 18. UPDATE `public/prep/brief.html` + `brief.js` and `public/prep/session.html` + `session.js` — the two entry links

- **IMPLEMENT**: in `brief.html`, next to `.brief-cta`, add
  `<p class="brief-cta" id="debrief-cta" hidden><a class="btn btn-block" href="/prep/debrief">How did the interview go?</a></p>`;
  in `brief.js`, unhide it when `payload.debrief_available`. In `session.html`, add the same link
  with a distinct id inside the `page-head` (so it is reachable from the session shell whichever act
  is showing), and unhide it in `session.js` when the GET payload's `debrief_available` is true —
  add the id to `SHELL_IDS` in `test/prep-session-ui.test.js:153` and a line to `state` if the
  controller needs the flag.
- **PATTERN**: `brief.html:33`'s CTA; `session.js`'s `$(id)` lookups and `state` object.
- **GOTCHA**: `test/prep-content.test.js` derives brief.js's reached ids from **literal**
  `getElementById` calls — adding a fourth keeps that gate honest, so use a literal there too.
  Link copy is plain and non-evaluative: "How did the interview go?", never "Debrief" (a word no
  first-time candidate uses about themselves).
- **VALIDATE**: `node --test test/prep-content.test.js test/prep-session-ui.test.js`
- **SATISFIES**: AC #1, AC #6.

### 19. ADD the wall test (AC #5) to `test/prep-debrief.test.js`

- **IMPLEMENT**: a clearly-headed section, written as a **reachability** claim rather than a
  spelling one:
  1. Walk `functions/` recursively (`test/collection.test.js:22`'s `readdirSync(withFileTypes)`
     idiom). For each `.js` file, strip comments, and collect the ones whose source mentions any of
     the debrief store fn names or the identifier `debrief`.
  2. Assert every collected path starts with `functions/prep/` — i.e. no file under `functions/api/`
     can reach debrief content at all.
  3. **Self-guard**: assert the collected set is non-empty and contains
     `functions/prep/api/debrief.js`, so a scan that silently matches nothing fails instead of
     passing (`test/schema.test.js:114-135`'s argument).
  4. Assert `src/store.js` — the recruiter/engine store — contains no `debrief` SQL, and that
     `src/portal/store.js` is the only module that does.
  5. One behavioural proof: seed a debrief whose `fix_text` is a distinctive sentinel, drive
     `functions/api/events.js` (the only recruiter route that touches invite-scoped tables — it
     counts and nothing more; `test/counts.test.js` is the driving pattern) and assert the sentinel
     appears nowhere in the response body.
- **GOTCHA**: strip comments before matching, or this file's own header sinks it
  (`test/schema.test.js:50-52`'s reason).
- **VALIDATE**: `node --test test/prep-debrief.test.js`
- **SATISFIES**: AC #5.

### 20. UPDATE `docs/epics/interview-prep/SPEC.md` — amend the State line rather than fork it

- **IMPLEMENT**: replace lines 61–62 (the `debrief (candidate_role_id, asked_text, shaky_text,
  fix_text, created_at)` sentence) with:

```markdown
State: `debrief (id, candidate_role_id, asked_json, fix_text, created_at)` and
`debrief_competency (debrief_id, competency_id)` — candidate-owned, purged with the rest. Shaky
competencies are ticked from the role's own list rather than typed, so they are a join table and
not a `shaky_text` column: targeting has to read them deterministically, with no model call, to
treat a shaky competency as less ready. Same shape as the storybank's `story_competency` above.
`asked_json` holds each question they were asked with the competency they placed it under —
`[{text, competency_id}]`, a placement of `null` meaning still unplaced — because the placement is
state the candidate set and re-editing it has to round-trip.
```

- **PATTERN**: DECISIONS.md decision 1 — "If portal behaviour and spec diverge, the spec is wrong or
  the spec changes — not a silent fork."
- **GOTCHA**: Amendment 1 is currently **uncommitted** in this shared worktree. Confirm it is still
  present before editing, and include both the amendment and this edit in the branch (or coordinate
  with whoever holds it) — do not stage the whole tree.
- **VALIDATE**: `git diff docs/epics/interview-prep/SPEC.md`
- **SATISFIES**: the epic's inheritance rule; unblocks AC #2's justification.

### 21. UPDATE `DEPLOY.md` — the migration warning and the ticket section

- **IMPLEMENT**: a short section in the ticket sequence (mirror the `#69`/`#71` sections' shape)
  saying: ⚠ **Migration `0011` must be applied to this environment's D1 before the deploy**
  (`npm run db:remote` for production, `npm run db:preview` for previews) — it creates `debrief` and
  `debrief_competency`, and `/prep/api/debrief` names both. Add the triage-table row: a 500 from
  `/prep/api/debrief` on a deployment where `/prep/api/session` is healthy means 0011 has not been
  applied. Note explicitly: **no new secret, no new Access application, no model call** — the route
  works on a deployment with no `ANTHROPIC_API_KEY`.
- **VALIDATE**: `grep -n "0011" DEPLOY.md`
- **SATISFIES**: deployability; AC #6's "no model call" claim made operational.

### 22. Full validation and the manual sweep

- **IMPLEMENT**: run the whole suite, apply the migration locally, and walk the page in a real
  browser (see VALIDATION COMMANDS Level 4).
- **VALIDATE**: `npm test && npm run db:local && npm run dev`
- **SATISFIES**: every AC.

---

## TESTING STRATEGY

The suite is `node --test test/*.test.js` — a **single-level glob**, so every new file sits directly
in `test/` with a `prep-` prefix (`test/collection.test.js` fails otherwise).

### Unit Tests

- **`src/prep/targeting.js`** (`test/prep-targeting.test.js`): pure, fixture-driven, explicit `now`.
  Dampening changes rank order; readiness clamps at 0; `confidenceQuestion` inherits.
- **`src/portal/store.js`** (`test/prep-debrief.test.js`): **real SQLite** via
  `test/helpers/sqlite-d1.js`, because every assertion worth making here branches on a constraint —
  the `UNIQUE` that makes the upsert an upsert, the `ON CONFLICT DO NOTHING` that makes a re-save
  free, and the cascade. `test/helpers/fake-d1.js` returns `{changes: 1}` unconditionally and would
  pass all of it while the logic was wrong. Every such test carries `{ skip }`.
- **`public/prep/debrief.js`** (`test/prep-debrief-ui.test.js`): the document double, plus the
  source gates (no HTML parsing, no browser storage, no candidate text in a URL).

### Integration Tests

- **The route, both methods** (`test/prep-debrief.test.js`): handlers imported and driven directly
  with a `context` double over a migrated SQLite database — `test/prep-turn.test.js`'s pattern. The
  gate, the body vocabulary, the caps, the ownership check, idempotent re-save, and the
  partial-save round trip.
- **The seam that matters** (`test/prep-debrief.test.js`): a line assigned to a competency is the
  question `drillState` serves for it on the next session — asserted through `drillState`, not by
  reading the row back, because "the next session can drill it" is the AC.
- **Retention** (`test/portal-purge.test.js`): both tables in the cascade proof and the purge
  boundary, row-for-row.
- **The wall** (`test/prep-debrief.test.js`): the reachability scan plus the `/api/events` sentinel.

### Edge Cases

- Interview **today** (`days === 0`) — available. Interview tomorrow — not. Interview 20 days past —
  still available (decision 11 keeps the invite alive to +14; beyond that the invite is gone and the
  route 401s, which is the right answer).
- `interview_at` stored as `'YYYY-MM-DD 00:00:00'` from a date-only booking — must not open at
  midnight UTC on the interview day via an instant comparison.
- A save with **every field empty** — legal (partial save), writes one row with two empty strings,
  no questions, no ticks.
- The same asked line saved **twice** — one question row. The same line assigned to a **different**
  competency on a later save — a second row under the new competency; the first stays (it may
  already carry attempts, and deleting a question cascades its attempts away —
  `migrations/0002_portal.sql`'s `attempt.question_id … ON DELETE CASCADE`. Never delete a question
  row from this route.)
- A line that is only whitespace, or 500+ characters. A body with 100 lines.
- A `competency_id` belonging to another candidate's role → 404, nothing written.
- A tick on a competency, then the competency ranks first, then the candidate drills it to success —
  the tick persists and keeps dampening (documented in Open Questions Q2).
- Eight asked questions under one competency → `MAX_VARIANTS_PER_COMPETENCY` is reached and the
  competency stops minting variants, re-serving instead. Correct, and worth an assertion so nobody
  reads it as a bug later.
- A candidate with **no** competencies (a handover that wrote none) — the picker is empty, saving
  text still works.

---

## VALIDATION COMMANDS

Execute every command to ensure zero regressions and 100% feature correctness.

### Level 1: Syntax & Style

There is no linter and no formatter in this repo — the gates are tests. Run the structural ones:

```bash
node --test test/collection.test.js test/schema.test.js test/chrome.test.js test/tokens.test.js
```

### Level 2: Unit Tests

```bash
node --test test/prep-targeting.test.js test/prep-debrief.test.js test/prep-debrief-ui.test.js
```

### Level 3: Integration Tests

```bash
node --test test/portal-purge.test.js test/prep-content.test.js test/prep-session-ui.test.js \
            test/prep-turn.test.js test/prep-session-store.test.js test/counts.test.js
npm test
```

Node ≥ 22.5 is required or every `node:sqlite` test **skips** and proves nothing — check the summary
line reports passes, not skips (`node --version`; `package.json` engines says `>=22.5`).

### Level 4: Manual Validation

```bash
npm run db:local     # applies 0011 to the local D1
npm run dev          # scripts/dev.py — wrangler pages dev
```

Then, against a seeded invite whose `interview_at` is in the past:

- [ ] `/prep/brief` shows the "How did the interview go?" link; an invite whose interview is in the
      future does **not**.
- [ ] `/prep/debrief` before the interview shows the "opens after your interview" copy and no form.
- [ ] Type three questions, place two, tick two competencies, write one fix, save → "Saved."
- [ ] Reload → everything comes back, including which line is still unplaced.
- [ ] `/prep/session` serves one of the placed questions.
- [ ] Save again unchanged → no duplicate question appears in the drill.
- [ ] `curl -s localhost:8788/api/events | grep -i "<the fix_text sentinel>"` → no match.
- [ ] `POST /prep/api/delete` → `/prep/debrief` 401s and the rows are gone
      (`select count(*) from debrief`).
- [ ] On a phone or a 390px viewport: no zoom on focusing the textarea or the picker; pinch zoom
      still works.

### Level 5: Additional Validation (Optional)

```bash
python3 scripts/purge.py preview     # the assurance path, if a preview deployment is up
```

---

## ACCEPTANCE CRITERIA

Ticket #77's six, restated as checks:

- [ ] **AC1** — The debrief form is reachable from the brief page and the session shell **only**
      after `interview_at` (day granularity), saving is resumable with partial saves allowed, and
      re-editing works.
- [ ] **AC2** — Competencies ticked shaky are treated as less ready by `targeting.js` ranking; the
      effect is on the queue only, and no score, rank or stage is displayed anywhere.
- [ ] **AC3** — Each assigned line of "what was asked" becomes a `question` row for that role, which
      the next session drills; unassigned lines stay in the queue on the debrief page with the
      picker open (owner's call — see Open Questions Q1).
- [ ] **AC4** — The purge and delete-now take the debrief rows with the rest of the candidate's
      data, proven in `test/portal-purge.test.js`'s row-for-row pattern.
- [ ] **AC5** — A test asserts no recruiter-facing endpoint under `functions/api/**` can reach
      debrief content, with a self-guard so the scan cannot pass vacuously.
- [ ] **AC6** — Every visible string is plain first-time-candidate language; no scores, no ranks, no
      "assessment" vocabulary.

And the standing gates:

- [ ] All validation commands pass with zero errors
- [ ] `npm test` is green on Node ≥ 22.5 with no unexpected skips
- [ ] Code follows project conventions and patterns (store contract, projection discipline, route
      posture, COPY object)
- [ ] No regressions in existing functionality
- [ ] `SPEC.md` and `DEPLOY.md` updated
- [ ] No model call, no new secret, no new dependency

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] All validation commands executed successfully
- [ ] Full test suite passes (unit + integration)
- [ ] Manual testing confirms the feature works, including the phone viewport check
- [ ] Acceptance criteria all met
- [ ] The wall test fails if `functions/api/` ever imports a debrief store fn (verify by breaking it
      on purpose once, then reverting)
- [ ] Code reviewed for quality and maintainability

---

## OPEN QUESTIONS / ASSUMPTIONS

**Q1 — AC3's "general queue" is not implementable as literally written. Answered by the owner.**
`question.competency_id` is `NOT NULL` and every read path (`questionsByRole`, `attemptsByRole`,
`questionForRole`) joins `competency`, so a question with no competency is invisible to the engine
even after a table rebuild. Making an unassigned line drillable therefore requires **inventing** a
bucket competency, which SPEC "Inputs" forbids ("extract them from the JD; do not invent them") and
which would then appear in `rankCompetencies`, `day_before_focus`, `closePayload.next`, the covered
list, and the ladder — where a stage over a mixed bucket means nothing. **Owner's call (16 Aug
2026): the queue lives on the debrief page.** An unassigned line stays in `debrief.asked_json` with
a `null` placement,
renders with its picker open, and becomes drillable the moment it is assigned. If this is ever
revisited, the alternative is one synthetic competency per role at `${roleId}:asked-general`,
importance 3, created lazily on the first unassigned line.

**Q2 — A shaky tick does not decay.** Once ticked, a competency is dampened for the life of the
invite, even after the candidate drills it up two stages. Bounded by retention (interview + 30 days)
and by the candidate's own ability to untick it, so v1 leaves it. A decay rule ("stop dampening once
the competency has risen a stage since the debrief") is a follow-up if the pilot shows the queue
getting stuck.

**Q3 — Migration number collision with #78.** The epic says tickets 1 and 2 each add a migration and
the first merged takes `0011`. Task 1 re-checks `ls migrations`. If #78 lands first this becomes
`0012`, and #78 will also have touched `targeting.js` — rebase, keep both changes to `readiness()`
composable (one dampening term, one story-coverage flag; they must not fight over the same
expression).

**Q4 — `SPEC.md` Amendment 1 is uncommitted in this shared worktree** (memory: parallel sessions
share it). Confirm it is present before task 20's edit, and never `git add -A`.

**Assumptions this plan makes:**

1. "Re-editable same day" is a capability, not a restriction — **owner-confirmed**: no cutoff; the
   debrief stays editable while the invite lives.
2. The gate is day granularity (`daysToInterview <= 0`), matching `isNotPast` and `isDayBefore`.
3. One debrief per `candidate_role`, upserted.
4. `SHAKY_DAMPEN = 0.2` (one rung of readiness's own five-point denominator). If the pilot shows it
   too weak or too strong, it is one constant with one test.
5. Asked questions count toward `MAX_VARIANTS_PER_COMPETENCY` (8). Accepted, and arguably right: a
   competency holding eight real interview questions has no need of minted ones.
6. `debrief_available` on two responses is not candidate data worth withholding — it is derived from
   a date the candidate already knows.

## NOTES (open canvas)

**Why an asked question is `axis: 'lateral'`.** The alternative was a new axis word, which is a
`CHECK` constraint change and a 12-step table rebuild in SQLite. Lateral is also *true* in SPEC's
own vocabulary — "same competency, different scenario or different company context, same
difficulty" is precisely what a real interviewer's version of a competency question is. The
consequence to keep in view: `nextStage`'s `can_answer → holds_up` transition requires a successful
non-revealed attempt on a **variant**, and an asked question now qualifies. That is right — a real
question is the strongest evidence that an answer survives a phrasing the candidate did not
rehearse — but it means the ladder can move faster after a debrief. Worth one sentence in the store
comment so nobody reads it as an accident.

**Why the derived id and not a dedupe SELECT.** The route's ordinary path is re-saving, so an
existence check would be a read-then-write on the hot path, on a database with no transaction. A
content-derived id turns "already added" into a primary-key conflict, which SQLite resolves for us —
the same move `openInvite` makes with the old hash in its `WHERE`, and `observeHabit` makes with its
upsert. The 16-hex prefix is 64 bits; the collision domain is one competency's asked lines, so a
collision is not a plausible event, and its effect would be a line silently not added rather than
anything corrupt.

**And why the placement is stored rather than derived from those ids.** The first draft of this plan
read each line's current competency back by testing `${c.id}#asked-${digest}` across the role. It
cannot work: a candidate who moves a line from Stakeholders to Communication leaves the first
question row standing (deleting it would cascade its attempts away), so two ids match one digest and
`question` carries no `created_at` to break the tie — the form would prefill the wrong pick on the
page whose whole promise is "come back and add to this". `asked_json` stores what they chose.
`brief_json` on the neighbouring table is the same call for the same reason.

**Ordering of the writes.** `upsertDebrief` → `setShakyCompetencies` → question rows. No
transaction exists, so the order is the recovery story (turn.js's header): a crash after the first
leaves the candidate's words saved and their ticks missing, which the next save fixes; a crash after
the second leaves a question row uncreated, which the next save fixes for free because the id is
derived. Nothing is left wrong, only incomplete — the same property the drill's write order buys.

**Response shape, fixed early so the page and the route can be built in parallel:**

```jsonc
// GET /prep/api/debrief
{ "available": false }
{ "available": true,
  "asked": [{ "text": "Tell me about a time you…", "competency_id": "<role>:stakeholders" },
            { "text": "Why this trust?",           "competency_id": null }],
  "shaky": ["<role>:stakeholders"],
  "fix_text": "Lead with the result.",
  "competencies": [{ "id": "<role>:stakeholders", "label": "Working with stakeholders" }] }

// POST /prep/api/debrief  { asked, shaky, fix_text }  ->  { "ok": true }
```

**What this ticket deliberately does not build, though it would be cheap:** a "questions you were
asked" block on the brief page, an email nudge on the evening of the interview, and any surfacing of
the debrief inside the session's prime act. Each is a separate decision about the portal's register
(decision 17's "no nagging"), and #80 owns the session's ending.

## AMENDMENTS

<!-- Append-only. Newest at the bottom. -->
