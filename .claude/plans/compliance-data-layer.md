# Feature: Compliance data layer — candidate, assignment, compliance_item with own retention

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

## Feature Description

The durable data foundation for the Locum fit II epic (#65): a third schema regime beside the
engine's candidate-data ban and the portal's invite cage. Three new D1 tables (`candidate`,
`assignment`, `compliance_item`), a compliance item catalogue seeded from TTR's own checklist,
a store module in the portal store's idiom, and a 12-month-dormancy retention purge that runs
lazily like the portal's. **No UI, no HTTP routes, no auth** — this ticket is migrations +
store + tests only. Metadata-only per spike #66: statuses, reference numbers and expiry dates
rest; document bytes never do.

## User Story

As a recruiter at a locum-heavy agency
I want candidate compliance state (what's missing, what's expiring) and assignment dates stored durably with their own retention rules
So that the passport (#68), extension radar (#69) and expiry radar (#70) have a truthful, privacy-caged foundation to build on

## Problem Statement

The engine's strongest privacy lock — "candidate data is never persisted" — is enforced by
`test/schema.test.js`, which fails any migration adding a candidate table. A compliance
passport needs exactly such a table, long-lived. Spike #66 resolved the tension: a deliberate
third regime, cascade-caged to a `candidate` root, metadata-only, with a 12-month dormancy
purge and delete-now. This ticket implements that decision at the data layer.

## Solution Statement

- Migration `0008_compliance.sql`: `candidate` (cage root), `assignment` (client_id →
  clients, dates, status), `compliance_item` (per-candidate checklist rows), every child
  reaching `candidate` via ON DELETE CASCADE — the invite cage's proven mechanism, new root.
- `src/compliance/catalogue.js`: the item catalogue (keys, plain-language labels, amber
  lead-times) as pure data — thresholds live in the catalogue, not code (architecture doc).
- `src/compliance/store.js`: create/delete candidate (delete-now), create assignment,
  checklist seed + read + state-write, and `purgeDormant` — one `DELETE FROM candidate`, the
  cascade does the rest.
- Lazy purge wired into `functions/prep/_middleware.js` beside the portal's, and appended to
  `scripts/purge.py` (the assurance path, whose docstring promises the two paths cannot drift).
- `test/schema.test.js` grows a `COMPLIANCE_TABLES` regime with exact-column locks and cascade
  assertions; the engine ban-regime stays byte-for-byte untouched. New real-SQLite and fake-d1
  suites mirror `portal-purge.test.js` / `portal-store.test.js`.

## Out of Scope / Non-Goals

- Not included: any UI, HTTP route, or Pages Function beyond the one middleware line (passport
  UI is #68, radar is #69, dashboard is #71).
- Not included: candidate auth / magic-link binding to `candidate` (#68 owns it — architecture
  "Missing pieces").
- Not included: `events.kind` widening (`extension_nudge_sent`, `expiry_nudge_sent`) — that
  belongs to the nudge tickets #69/#70, widened when the writer exists.
- Not included: HCPC Employer Check API integration (non-blocking per spike; the registration
  number rests in `compliance_item.reference` for the `hcpc_registration` row).
- Not included: document storage of any kind — no bytes, no URLs to bytes. R2 vault is the
  future paid milestone with its own spike.
- Not included: expiring/expired state *transitions* (the state-writer sweep is #70's); this
  ticket only makes the vocabulary storable.
- Not changing: the engine's four tables, the portal's seven, the candidate-shaped ban regex,
  the portal purge, or any existing migration (applied migrations are never edited).

## Feature Metadata

**Feature Type**: New Capability (data layer)
**Estimated Complexity**: Medium
**Primary Systems Affected**: `migrations/`, `src/compliance/` (new), `test/schema.test.js`, `functions/prep/_middleware.js`, `scripts/purge.py`
**Dependencies**: none new — vanilla D1/SQLite, node:test, node:sqlite (tests)

## Related Work

**Implements**: [#67](https://github.com/linardsb/saulera-dossier-engine/issues/67) (`Closes #67` in the PR)   ·   **Epic**: #65, architecture inherited from `docs/epics/locum-fit-2.architecture.md` (spike #66's deliverable — storage, retention, schema-regime and commercial calls are DECIDED there, not reopened here)

**Back-references**:

- `docs/epics/locum-fit-2.architecture.md` — every "Key decision" is binding on this plan
- Portal cage precedent: #17 (cascade cage + purge), #20 (store/auth idiom), decision 13 (hard delete, no tombstones)

**Forward-references**:

- #68 (passport UI) consumes `catalogue.js`, `itemsByCandidate`, `setItemState`, delete-now
- #69 (extension radar) consumes `assignment` end dates
- #70 (expiry radar) is the state-writer for `expiring`/`expired`

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `docs/epics/locum-fit-2.architecture.md` (whole file, 91 lines) - Why: the inherited decisions — data model shape (lines 59–64), retention (44–48), schema lockfile plan (55–58)
- `test/schema.test.js` (whole file) - Why: the lockfile you amend. The parser (lines 42–98), the two self-guard tests (106–127), the regimes (137–148), `EXPECTED_COLUMNS` (179–206), `CASCADE_CHAIN` (230–239). The candidate-shaped ban (150–172) must not change.
- `migrations/0002_portal.sql` - Why: the migration idiom to MIRROR — cage comment header, date-format comments, the `interview_at` CHECK rationale (lines 6–11: unparseable date = immortal row), index naming (`invite_by_interview`)
- `src/portal/store.js` (lines 1–130) - Why: module contract (db-first, no HTTP, bound params only — lines 13–15), `purgeExpired` (44–49: no bound values, the boundary is the schema's clock), `deleteInviteByTokenHash` (63–66: idempotent `{ok, deleted}`), `requireFields` (79–86), `createInvite` (116–126)
- `src/portal/store.js` (lines 631–645, `insertVariant`) - Why: the pattern for validating a closed vocabulary in the store BEFORE the insert, so a bad value is the store's 400 and not a raw `ERR_SQLITE_ERROR`
- `test/portal-purge.test.js` (whole file) - Why: the real-SQLite purge suite to MIRROR — populated-DB migration test, scope seeding, exact-boundary assertion, row-for-row survivor checks, CHECK-violation tests
- `test/portal-store.test.js` (lines 1–72) - Why: the fake-d1 suite to MIRROR — "purge deletes from the root alone, names no children", "the retention number is locked, binds nothing"
- `test/helpers/sqlite-d1.js` (whole file) - Why: `openMigrated` (applies ALL migrations — your 0008 rides in automatically), `d1Shape`, `skip`, the PRAGMA foreign_keys gotcha, `at(days)` helper
- `test/helpers/fake-d1.js` - Why: the recording fake for the store-shape suite
- `functions/prep/_middleware.js` (whole file, 31 lines) - Why: where the lazy purge is wired; fail-open try/catch pattern
- `scripts/purge.py` (lines 38–43) - Why: `PURGE_SQL` — "the identical statement the lazy purge runs, so the two paths cannot drift apart"; your dormancy DELETE appends here
- `src/store.js` (just the `StoreError` export) - Why: the error class the compliance store imports, exactly as `src/portal/store.js:17` does
- `migrations/0001_init.sql` (clients table, lines ~24–31) - Why: `assignment.client_id` references `clients(id)` — TEXT PRIMARY KEY

### New Files to Create

- `migrations/0008_compliance.sql` - The three tables + indexes, with the cage/retention header comment
- `src/compliance/catalogue.js` - `COMPLIANCE_CATALOGUE` (8 items), `ITEM_KEYS`, `ITEM_STATUSES` — pure data, no D1, importable browser-side later by #68
- `src/compliance/store.js` - The store module
- `test/compliance-purge.test.js` - Real node:sqlite: cascade, purge boundary, delete-now, CHECK violations, UNIQUE
- `test/compliance-store.test.js` - fake-d1: SQL shapes, locked retention number, catalogue validation, StoreError codes

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- `docs/epics/locum-fit-2.architecture.md` — in-repo; the binding decisions (read fully, it is short)
- `docs/ttr-improvement-dossier.md` §2 (line ~31) and §4-A (lines 56–76) — the checklist source: "HCPC, enhanced DBS, right to work, four immunisation records, indemnity, references, WTR opt-out…"
- No external library docs needed — the stack is plain D1 SQL + node:test. SQLite specifics that matter (datetime() parsing, INTEGER affinity, NULL-CHECK semantics, UNIQUE-index NULLs) are all documented inline in the files above.

### Patterns to Follow

**Store module contract** (`src/portal/store.js:13–15`): every function takes a D1-shaped `db` first; no HTTP, no Response, no env; every user value is a bound parameter; nothing interpolated into SQL — with the one sanctioned exception of SQLite date modifiers assembled from a *validated integer* via `'+' || ? || ' minutes'` (see `issueOtp`).

**Purge shape** (`src/portal/store.js:44–49`):
```js
export async function purgeExpired(db) {
  const result = await db
    .prepare("DELETE FROM invite WHERE datetime(interview_at, '+30 days') <= datetime('now')")
    .run();
  return { purged: result.meta.changes ?? 0 };
}
```
No bound values (the boundary is the schema's clock), deletes from the ROOT only (the cascade owns the children), returns `{purged}` from `meta.changes`.

**Delete-now shape** (`deleteInviteByTokenHash`): idempotent `{ ok: true, deleted: result.meta.changes ?? 0 }` — ok whether or not a row matched.

**Field validation**: local `requireFields` helper throwing `new StoreError("missing_fields", 400, ...)` — copy the 8-line helper from `src/portal/store.js:79–86` (it is module-private there; the portal store itself duplicated it from nothing, so a local copy is the house style, not drift).

**Closed-vocabulary validation in the store** (`insertVariant`, lines 631–645): check the value against the vocabulary and throw the store's own 400 BEFORE the SQL, so callers never see a raw CHECK failure for a predictable input.

**Migration comments**: every table carries a why-comment; date columns get the "datetime() of an unparseable string is NULL → immortal row → CHECK rejects at write time" treatment where the purge depends on them (0002 lines 6–11).

**Naming**: snake_case columns, `TEXT PRIMARY KEY` for ids minted by code (`crypto.randomUUID()` caller-side), `INTEGER PRIMARY KEY` for log-like rows, index names `<table>_by_<column>`.

---

## IMPLEMENTATION PLAN

### Phase 1: Migration (the schema is the contract)

**Tasks:**
- Write `migrations/0008_compliance.sql` — three tables, indexes, cage header comment

### Phase 2: Lockfile amendment

**Depends on:** Phase 1 (the lockfile parses the migration file)

**Tasks:**
- Amend `test/schema.test.js`: third regime, exact columns, cascade chain, new CHECK/UNIQUE tests, three-regime comment block

### Phase 3: Catalogue + store

**Depends on:** Phase 1. **Independent of:** Phase 2 (parallel-safe, but the file set is small — sequential is fine).

**Tasks:**
- `src/compliance/catalogue.js`
- `src/compliance/store.js`

### Phase 4: Lazy purge wiring

**Depends on:** Phase 3

**Tasks:**
- `functions/prep/_middleware.js` — run `purgeDormant` beside `purgeExpired`, fail open
- `scripts/purge.py` — append the identical dormancy statement to `PURGE_SQL`

### Phase 5: Testing & validation

**Tasks:**
- `test/compliance-purge.test.js` (real SQLite), `test/compliance-store.test.js` (fake-d1)
- Full suite + `npm run db:local`

---

## STEP-BY-STEP TASKS

### CREATE migrations/0008_compliance.sql

- **IMPLEMENT**: exactly this schema (shape decided by the architecture doc; columns are this plan's call, locked by the tests you write in the next task):

```sql
-- Compliance cage (#67, epic #65). The THIRD schema regime, decided in the open by spike
-- #66 (docs/epics/locum-fit-2.architecture.md): durable candidate compliance METADATA —
-- statuses, reference numbers, expiry dates — never document bytes. Every row below reaches
-- `candidate` through ON DELETE CASCADE, so one `DELETE FROM candidate` erases the whole
-- cage: that statement IS delete-now, and the 12-month dormancy purge
-- (src/compliance/store.js) is the same statement with the schema's own clock as its WHERE.
-- The engine's "candidate data is transient" ban (§5.6) is untouched — test/schema.test.js
-- proves all three regimes.

-- The cage root: identity + contact, nothing else (minimal-fields posture — even metadata
-- here is health-adjacent under UK GDPR). created_at feeds the dormancy purge for a
-- candidate who never gained an assignment, so it carries the 0002 interview_at treatment:
-- an unparseable date would make the row immortal, and the CHECK moves that failure to
-- write time.
CREATE TABLE candidate (
  id         TEXT PRIMARY KEY,
  full_name  TEXT NOT NULL,
  email      TEXT NOT NULL,
  phone      TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')) CHECK (datetime(created_at) IS NOT NULL)
);

-- One booking of one candidate at one client. Feeds BOTH clocks: the dormancy purge (a
-- candidate whose every assignment ended 12+ months ago) and #69's extension radar
-- (end_date - 14 days). client_id cascades from clients exactly as invite does — deleting
-- a client takes its bookings by the schema, not by a second statement.
CREATE TABLE assignment (
  id           TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidate(id) ON DELETE CASCADE,
  client_id    TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  start_date   TEXT NOT NULL CHECK (datetime(start_date) IS NOT NULL),
  end_date     TEXT CHECK (end_date IS NULL OR datetime(end_date) IS NOT NULL),
  status       TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('booked','active','ended','cancelled')),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX assignment_by_candidate ON assignment (candidate_id);
CREATE INDEX assignment_by_client ON assignment (client_id);

-- One checklist row per candidate per catalogue item. Metadata-only is structural here:
-- {status, reference, expiry_date, checked_at} and NO fifth data column — no url, no blob,
-- no note. item_key's vocabulary lives in src/compliance/catalogue.js (thresholds in the
-- catalogue, not code); the store validates it, deliberately not a CHECK, so adding an item
-- is a catalogue edit and not a migration. status IS a CHECK: five states, closed, exactly
-- like attempt.mode — #70's sweep must not invent a sixth.
CREATE TABLE compliance_item (
  id           INTEGER PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidate(id) ON DELETE CASCADE,
  item_key     TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'missing' CHECK (status IN ('missing','submitted','verified','expiring','expired')),
  reference    TEXT NOT NULL DEFAULT '',
  expiry_date  TEXT CHECK (expiry_date IS NULL OR datetime(expiry_date) IS NOT NULL),
  checked_at   TEXT,
  UNIQUE (candidate_id, item_key)
);
CREATE INDEX item_by_candidate ON compliance_item (candidate_id);
```

- **PATTERN**: `migrations/0002_portal.sql` (header comments, CHECK rationale, index naming)
- **GOTCHA**: the lockfile's parser reads `CREATE TABLE name (` — plain identifiers only, no quotes/backticks, or the self-guard test fails. Table-level `UNIQUE (...)` and `CHECK (...)` are filtered by `columns()` — safe. Do NOT use `CREATE TABLE IF NOT EXISTS` variants with quoting.
- **VALIDATE**: `node --test test/schema.test.js` (fails until the next task — expected red), then `npm run db:local` applies clean
- **SATISFIES**: ticket bullet 1 (migrations)

### UPDATE test/schema.test.js

- **IMPLEMENT**:
  1. Extend the file-header comment: two regimes become three — cite spike #66 and the architecture doc, say the compliance cage is durable candidate data with its own retention, cascade-rooted at `candidate`, and that the ENGINE ban is untouched.
  2. Below `PORTAL_TABLES`, add:
     ```js
     const COMPLIANCE_TABLES = ["assignment", "candidate", "compliance_item"];
     ```
     with a comment: the third regime (#67, spike #66) — durable compliance METADATA caged to `candidate`, 12-month dormancy purge + delete-now; the name `candidate` is legal HERE and still banned in the engine regime below.
  3. Update the exact-tables test: title becomes "…the engine's four, the portal's seven and the compliance cage's three"; expected list is `[...ENGINE_TABLES, ...PORTAL_TABLES, ...COMPLIANCE_TABLES].sort()`.
  4. The "no engine table or column is candidate-shaped" test: **do not touch the assertion**. Its loop already runs over `ENGINE_TABLES` only.
  5. `EXPECTED_COLUMNS` — add (sorted, exact):
     ```js
     candidate: ["created_at", "email", "full_name", "id", "phone"],
     assignment: ["candidate_id", "client_id", "created_at", "end_date", "id", "start_date", "status"],
     compliance_item: ["candidate_id", "checked_at", "expiry_date", "id", "item_key", "reference", "status"],
     ```
     Update the `Object.keys(EXPECTED_COLUMNS)` deepEqual on line ~209 to include `COMPLIANCE_TABLES`. Comment on `compliance_item`: metadata-only is this lock — a document url/blob column is exactly the descope this fails on.
  6. `CASCADE_CHAIN` — add:
     ```js
     candidate: {},            // omit — see GOTCHA
     assignment: { candidate_id: "candidate", client_id: "clients" },
     compliance_item: { candidate_id: "candidate" },
     ```
  7. New test "compliance_item.status is CHECK-typed to the five checklist states" — mirror the `attempt.mode` test (line 269): match `/status\s+TEXT\s+NOT\s+NULL\s+DEFAULT\s+'missing'\s+CHECK/i` on `bodyOf.get("compliance_item")` and assert each of `'missing' 'submitted' 'verified' 'expiring' 'expired'` appears in the body.
  8. New test "assignment.status is CHECK-typed to the four booking states" — same shape, `'booked' 'active' 'ended' 'cancelled'`.
  9. New test "one checklist row per candidate per item — compliance_item (candidate_id, item_key) is UNIQUE" — mirror the `candidate_role.invite_id` UNIQUE test (line 256): `assert.match(bodyOf.get("compliance_item"), /UNIQUE\s*\(\s*candidate_id\s*,\s*item_key\s*\)/i)`.
  10. New test "the compliance cage stores no document bytes — metadata columns only": for each of the three tables, assert no column matches `/blob|bytes|image|photo|document|file|url|evidence/i` — the structural form of spike decision 1.
- **PATTERN**: the existing test bodies in the same file; keep message style (say why, cite the decision)
- **GOTCHA**: `CASCADE_CHAIN` entries with an empty object are pointless — just add `assignment` and `compliance_item` keys; `candidate` is the root and has no FK (like `clients`). Column lists must be **sorted** — the lock compares against `[...(byName.get(table) ?? [])].sort()`.
- **VALIDATE**: `node --test test/schema.test.js` — all green. Then prove the lock still bites: temporarily add `candidate_note TEXT` to `events` in a scratch copy? No — simpler: rely on the untouched ban test (it already has coverage); instead verify red→green by running the test before and after the migration exists.
- **SATISFIES**: ticket bullet 5 (schema-test amendment), epic AC #6

### CREATE src/compliance/catalogue.js

- **IMPLEMENT**: pure data module, no imports:
  ```js
  export const COMPLIANCE_CATALOGUE = [
    { key: "hcpc_registration", label: "HCPC registration", expires: true,  amberDays: 60 },
    { key: "dbs_enhanced",      label: "Enhanced DBS check", expires: true,  amberDays: 60 },
    { key: "right_to_work",     label: "Right to work",      expires: true,  amberDays: 60 },
    { key: "immunisations",     label: "Immunisation record", expires: true, amberDays: 30 },
    { key: "indemnity",         label: "Professional indemnity insurance", expires: true, amberDays: 30 },
    { key: "references",        label: "References",         expires: false, amberDays: null },
    { key: "wtr_choice",        label: "48-hour week choice (working time rules)", expires: false, amberDays: null },
    { key: "fit_to_work",       label: "Fit-to-work check",  expires: true,  amberDays: 30 },
  ];
  export const ITEM_KEYS = COMPLIANCE_CATALOGUE.map((i) => i.key);
  export const ITEM_STATUSES = ["missing", "submitted", "verified", "expiring", "expired"];
  ```
  Header comment: seeded from TTR's own `/compliance` checklist (dossier §2/§4-A); labels are plain first-time-locum language (per the repo's UI-language rule); `amberDays` is where #70's amber window reads from — thresholds live here, not in code (architecture doc); a new checklist item is an edit to this array plus a re-seed, never a migration.
- **PATTERN**: `DIFFICULTY` in `src/portal/store.js:149` — an exported vocabulary map other tickets import rather than reinvent
- **GOTCHA**: own file (not inside store.js) so #68 can import it browser-side without dragging D1 code along. `expires: false` items still get checklist rows — they just never enter `expiring`.
- **VALIDATE**: `node -e "import('./src/compliance/catalogue.js').then(m => console.log(m.ITEM_KEYS.length))"` prints 8
- **SATISFIES**: ticket bullet 2 (catalogue)

### CREATE src/compliance/store.js

- **IMPLEMENT**: mirror `src/portal/store.js`'s contract exactly (db-first, bound params, StoreError). Functions:
  - `createCandidate(db, { id, fullName, email, phone } = {})` — requireFields id/fullName/email; INSERT candidate; then loop `COMPLIANCE_CATALOGUE` inserting one `compliance_item` row per key at DDL defaults (`status` left to its default — binding a column you have no value for is how a default stops being the one place that decides; bind only candidate_id + item_key). Sequential single statements, NOT `db.batch` (fake-d1 cannot drive batch — src/store.js:376–379's argument). Returns `{ ok: true, items: ITEM_KEYS.length }`.
  - `deleteCandidate(db, candidateId)` — `DELETE FROM candidate WHERE id = ?`; returns `{ ok: true, deleted: meta.changes ?? 0 }`, idempotent (the delete-now seam #68 will expose; `deleteInviteByTokenHash`'s shape).
  - `purgeDormant(db)` — the retention rule as ONE statement, no bound values:
    ```sql
    DELETE FROM candidate
     WHERE datetime(created_at, '+12 months') <= datetime('now')
       AND NOT EXISTS (
             SELECT 1 FROM assignment
              WHERE assignment.candidate_id = candidate.id
                AND (assignment.end_date IS NULL
                     OR datetime(assignment.end_date, '+12 months') > datetime('now')))
    ```
    Returns `{ purged: meta.changes ?? 0 }`. Doc comment: dormancy is DATE-driven, deliberately not status-driven — a status column and a date column can disagree, and the purge must answer to the clock alone. An open assignment (end_date NULL) keeps its candidate alive; so does any assignment ended within 12 months; a candidate with no assignments at all purges 12 months after creation. Lazy-run from `functions/prep/_middleware.js`; `scripts/purge.py` is the assurance path.
  - `createAssignment(db, { id, candidateId, clientId, startDate, endDate, status } = {})` — requireFields id/candidateId/clientId/startDate; validate `status` (when given) against the four states, throwing the store's 400 before SQL (insertVariant's move); bind `endDate ?? null`, `status ?? 'booked'`... actually bind status only when provided is messier — always bind `status ?? "booked"` and say why in a comment (the default is duplicated here because the INSERT names the column; keep the two in sync with the DDL). Returns `{ ok: true }`.
  - `setItemState(db, { candidateId, itemKey, status, reference, expiryDate } = {})` — requireFields candidateId/itemKey/status; validate `itemKey` against `ITEM_KEYS` and `status` against `ITEM_STATUSES` (store's 400, not the CHECK's raw error); `UPDATE compliance_item SET status = ?, reference = ?, expiry_date = ?, checked_at = datetime('now') WHERE candidate_id = ? AND item_key = ?` binding `String(reference ?? "")` and `expiryDate ?? null`; return `{ updated: (meta.changes ?? 0) === 1 }` so a caller can 404 an unseeded candidate.
  - `itemsByCandidate(db, candidateId)` — `SELECT item_key, status, reference, expiry_date, checked_at FROM compliance_item WHERE candidate_id = ? ORDER BY item_key`; returns `results ?? []`. Never `SELECT *` (briefJsonByInviteId's discipline). Catalogue display order is the caller's to apply from `COMPLIANCE_CATALOGUE`.
  - Local `requireFields` — copy the 8-line helper verbatim from `src/portal/store.js:79–86`.
  - Header comment mirroring portal store's: this module is the only code that deletes compliance data, and it only deletes whole candidate cages; hard delete, no tombstones; metadata only.
- **IMPORTS**: `import { StoreError } from "../store.js";` and `import { COMPLIANCE_CATALOGUE, ITEM_KEYS, ITEM_STATUSES } from "./catalogue.js";`
- **GOTCHA**: `expiryDate` is a caller value headed for a `datetime()`-guarded column — the CHECK rejects garbage, but reject `undefined`-vs-null confusion by normalising to `?? null`. No transactions on D1 — createCandidate's item loop can half-fail; that leaves a candidate with a short checklist, healed by delete + recreate; acceptable at this layer, noted in the doc comment.
- **VALIDATE**: `node --test test/compliance-store.test.js` (written below; red until then)
- **SATISFIES**: ticket bullets 2–4 (catalogue seed, store, purge)

### UPDATE functions/prep/_middleware.js

- **IMPLEMENT**: import `purgeDormant` from `../../src/compliance/store.js`; inside the existing `if (env.DB)`, add a second awaited fail-open block after the portal purge:
  ```js
  try {
    await purgeDormant(env.DB);
  } catch (err) {
    console.error("compliance purge failed:", err);
  }
  ```
  Extend the header comment: the compliance cage's 12-month dormancy rule (#67) rides the same lazy slot — any portal traffic keeps BOTH retention promises, and each purge fails open independently so one broken cage cannot stop the other's clock.
- **PATTERN**: the existing `purgeExpired` block, same file lines 17–22
- **GOTCHA**: separate try/catch, not shared — a compliance purge failure must not be mistaken for a portal purge failure in logs, and neither may block `next()`.
- **VALIDATE**: `node --test test/prep-middleware.test.js` (existing suite must stay green; extend it only if it locks the middleware's call list — read it first)
- **SATISFIES**: ticket bullet 4 (lazy-run like the portal's)

### UPDATE scripts/purge.py

- **IMPLEMENT**: append the identical dormancy DELETE (byte-identical WHERE to `purgeDormant`'s) plus `SELECT changes() AS purged_candidates;` to `PURGE_SQL`, and update the docstring/echo lines to say both cages purge.
- **PATTERN**: the existing `PURGE_SQL` (lines 40–43) — "the identical statement the lazy purge runs, so the two paths cannot drift apart"
- **GOTCHA**: keep it one `--command` string; wrangler runs multiple statements separated by `;`.
- **VALIDATE**: `python3 -c "import ast; ast.parse(open('scripts/purge.py').read())"` (syntax only — no remote run in this ticket)
- **SATISFIES**: ticket bullet 4 (the assurance path stays honest)

### CREATE test/compliance-purge.test.js

- **IMPLEMENT**: mirror `test/portal-purge.test.js` against real node:sqlite, using the SHARED helper this time (`openMigrated` from `test/helpers/sqlite-d1.js` applies every migration including 0008 — no between-migrations seeding needed here since 0008 creates fresh tables). Tests:
  1. "0008 applies clean after 0001–0007 onto a populated database and the three tables exist" — `openMigrated()` then assert sqlite_master lists all 14 tables.
  2. Seed helper `seedCandidate(db, letter, { createdOffset, assignments })` — a candidate with full checklist (via `createCandidate` through `d1Shape` — seed through the same writer production uses, portal-purge's stated principle) plus assignment rows at given date offsets (use the helper's `at(days)` or `datetime('now', offset)` modifiers).
  3. "purgeDormant takes exactly the dormant cages, including the exact 12-month boundary, row-for-row":
     - A: created −400 days, one assignment ended −13 months → purged
     - D: created −400 days, one assignment ended exactly −12 months → purged (the `<=`/`>` boundary: `datetime(end_date,'+12 months') > now` is false at exactly now)
     - B: created −400 days, assignment ended −2 months → survives
     - C: created −400 days, assignment with end_date NULL (open booking) → survives
     - E: created −13 months, NO assignments → purged
     - F: created −2 months, no assignments → survives
     Assert `{purged: 2 or 3}` exactly (A, D, E = 3), survivors byte-identical across all three compliance tables, engine + portal tables untouched, second pass `{purged: 0}`.
  4. "deleteCandidate drops one whole cage and leaves the rest untouched, idempotently" — mirror the delete-now test including `{ok: true, deleted: 0}` on the second call.
  5. "a sixth compliance_item.status and a fifth assignment.status are constraint violations" — `assert.throws(/CHECK/i)`.
  6. "an unparseable expiry_date, start_date or candidate.created_at is a constraint violation, not an immortal row" — mirror the interview_at test, including the accepted-forms loop.
  7. "a second row for the same candidate and item is a constraint violation" — UNIQUE(candidate_id, item_key), `assert.throws(/UNIQUE/i)`.
  8. "createCandidate seeds the full catalogue" — 8 rows, all status 'missing', keys deepEqual sorted ITEM_KEYS.
- **PATTERN**: `test/portal-purge.test.js` (structure, `{ skip }`, row-for-row assertions), `test/helpers/sqlite-d1.js` (`d1Shape`, `openMigrated`, `at`)
- **GOTCHA**: assignment rows need a client — seed with the helper's default `SEED_CLIENT` ('c-1'). `PRAGMA foreign_keys = ON` comes from the helper. Date offsets in months: SQLite accepts `'-13 months'` modifiers — build dates with `datetime('now', ?)` in seed SQL rather than JS Date math where possible; `at(days)` exists if you need a literal.
- **VALIDATE**: `node --test test/compliance-purge.test.js` under Node ≥ 22.5 (`node -v` first; nvm has v24 per scripts/purge.py)
- **SATISFIES**: ticket bullet 5 (schema tests for new tables and purge), epic AC #5 groundwork

### CREATE test/compliance-store.test.js

- **IMPLEMENT**: mirror `test/portal-store.test.js` against `fakeD1`. Tests:
  1. "purgeDormant deletes from candidate alone — the cascade does the rest": one statement, `/^DELETE FROM candidate\b/i`, and the SQL names no child or foreign table (`compliance_item` appears only via... careful — the NOT EXISTS subquery legitimately names `assignment`. Lock instead: the statement is a single DELETE whose target is `candidate`, and it must NOT name `compliance_item`, `invite`, `clients`, `events`, `agency` — `assignment` is allowed, it is the dormancy clock).
  2. "the retention number is 12 months, compared through datetime(), and binds nothing" — `sql.includes("'+12 months'")`, `args.length === 0`.
  3. "createCandidate writes the candidate then one row per catalogue item" — 1 + 8 calls, every item INSERT binds candidate id + a key from ITEM_KEYS, no status bound.
  4. "setItemState rejects an unknown item_key and an unknown status with the store's 400" — `codeOf` helper pattern, expect `missing_fields` (or a dedicated code — match whatever you threw).
  5. "setItemState updates exactly the five columns and stamps checked_at from SQLite's clock" — SQL match, binds in order.
  6. "deleteCandidate answers ok regardless of matched rows" and binds the id.
  7. "missing required fields are the store's own 400" — loop over each function's requireFields set.
- **PATTERN**: `test/portal-store.test.js` lines 30–72 (`codeOf`, the purge-shape and locked-number tests)
- **VALIDATE**: `node --test test/compliance-store.test.js`
- **SATISFIES**: ticket bullet 3 (store per portal patterns), bullet 5

### Full validation pass

- **VALIDATE**: `npm test` (all suites), then `npm run db:local` (migrations apply against real wrangler D1), then `git diff --stat` sanity (only the files this plan names)

---

## TESTING STRATEGY

### Unit Tests

`test/compliance-store.test.js` on `fakeD1` — proves the statements themselves: purge shape, locked retention number, catalogue-driven seeding, vocabulary validation, StoreError codes. This is the suite that catches the retention number drifting or a SELECT * appearing.

### Integration Tests

`test/compliance-purge.test.js` on node:sqlite — proves behaviour the fake cannot: the cascade chain, the exact 12-month boundary, CHECK and UNIQUE enforcement, idempotent delete-now with honest `deleted` counts. Plus the amended `test/schema.test.js` lockfile, which is the boundary's standing proof.

### Edge Cases

- The exact dormancy boundary (assignment ended exactly 12 months ago → purged, `<=` semantics matching `purgeExpired`'s)
- Candidate with zero assignments (dormant from `created_at`)
- Open assignment (`end_date` NULL) is immortality — must survive any age
- Unparseable dates rejected at write time on all four guarded columns
- Second `compliance_item` row for the same (candidate, item) → UNIQUE violation
- Second purge pass → `{purged: 0}`, no error
- Engine and portal tables byte-untouched by both purge and delete-now

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style

No linter in this repo. `node --check src/compliance/store.js src/compliance/catalogue.js functions/prep/_middleware.js` and `python3 -c "import ast; ast.parse(open('scripts/purge.py').read())"`.

### Level 2: Unit Tests

`node --test test/compliance-store.test.js test/schema.test.js`

### Level 3: Integration Tests

`node --test test/compliance-purge.test.js` (needs Node ≥ 22.5 — `node -v`; use `export PATH="$HOME/.nvm/versions/node/v24.11.0/bin:$PATH"` if the default is v20), then the full `npm test`.

### Level 4: Manual Validation

`npm run db:local` — wrangler applies 0001→0008 against local D1 and 0008 must land clean on a database that already has the prior seven applied.

### Level 5: Additional Validation (Optional)

`wrangler d1 execute` a `createCandidate`-shaped insert locally and eyeball the seeded checklist. Do NOT run `db:preview`/`db:remote` — production migration 0007+0008 sequencing is a deploy-time decision (memory: 0007 must apply to production D1 before next deploy).

---

## ACCEPTANCE CRITERIA

- [ ] Migration 0008 creates `candidate`, `assignment`, `compliance_item` exactly as the spike's shape decisions describe (metadata-only columns, cascade rooted at `candidate`)
- [ ] The catalogue carries TTR's eight checklist items with plain-language labels and amber lead-times
- [ ] `src/compliance/store.js` follows the portal store contract (db-first, bound params, StoreError, root-only deletes)
- [ ] `purgeDormant` implements the 12-month dormancy rule in one unbound statement; wired lazily into `/prep` middleware; mirrored in `scripts/purge.py`
- [ ] `test/schema.test.js` passes with the three-regime lock; the engine candidate-shape ban is textually untouched
- [ ] All validation commands pass with zero regressions; new tests ≥40% of the diff (ticket estimate)
- [ ] No UI, routes, auth, or events widening (out of scope held)

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] Full suite passes under Node 24 (`npm test`)
- [ ] `npm run db:local` applies clean
- [ ] Only planned files changed (`git diff --stat`)
- [ ] Branch check before commit — parallel sessions share this worktree (memory); branch `feat/compliance-data-layer` off `main`, PR body `Closes #67`

---

## OPEN QUESTIONS / ASSUMPTIONS

**Assumptions this plan makes (flag in the PR, none blocking):**

1. **Column-level shapes are this plan's call.** The spike locked the table names and the row concept (`{status, reference, expiry_date, checked_at}` for items); exact candidate/assignment columns (`full_name/email/phone`, `start_date/end_date/status`) are decided here, minimal-fields per the GDPR posture. Adding a column later is a migration + lock change, the sanctioned path.
2. **`assignment.status` vocabulary** = `booked|active|ended|cancelled`. The ticket says "status" without a vocabulary; the purge deliberately ignores it (date-driven) so a wrong guess costs little. #69 may amend in the open.
3. **`wtr_choice` as the key** for "WTR opt-in/out" — named as the candidate's choice rather than `wtr_opt_out`, since either direction is a valid completed state.
4. **Amber lead-times (60/60/60/30/30/30 days)** are placeholder-reasonable, seeded in the catalogue for #70 to consume; the owner/Louis meeting may retune them — that's a one-line catalogue edit.
5. **Dormancy for never-assigned candidates** runs from `created_at` — the spike says "no active assignment for 12 months" and is silent on the zero-assignment case; leaving them immortal would be the wrong default for a privacy cage.
6. **`candidate.email` is not UNIQUE** — #68's auth may want dedupe; deferred to the ticket that owns the login flow.
7. **Framework/audit retention minimums** (architecture open question, Louis meeting) may amend the 12-month rule — the number is locked in one store function + one test + purge.py, a three-line change.

## NOTES (open canvas)

- **Why the catalogue is a JS module and not a fourth table:** the spike locked `COMPLIANCE_TABLES` to exactly three; the architecture says "thresholds live in the catalogue, not code" — meaning not scattered through logic, not "in the database". A pure-data module is browser-importable for #68, diffable in review, and needs no migration per checklist edit. If a fourth (non-candidate-data) table is ever wanted it would sit in the ENGINE regime and trip the candidate-shape regex on nothing — but that's a decision for whoever needs runtime-editable thresholds.
- **Why the purge ignores `assignment.status`:** status is human-maintained, dates are the radar's truth (#69 reads end_date). A candidate whose status says 'active' but whose end_date passed 13 months ago is a stale status, and retention answering to it would let bookkeeping errors extend data retention — the wrong direction to fail.
- **The `NOT EXISTS` subquery in purgeDormant** is a deviation from `purgeExpired`'s single-table WHERE, and the fake-d1 test must allow `assignment` in the SQL while still banning child/foreign table names. This was weighed against two statements (SELECT dormant ids, DELETE IN) — rejected: one statement has no read-then-write window and matches the "one statement, the cascade does the rest" idiom.
- **Middleware placement:** compliance purge rides `/prep/*` traffic even though no compliance UI exists yet — deliberate; the retention promise must not wait for #68 to ship. When #68 adds compliance routes under `/prep`, the same middleware already covers them.
- **Rejected: seeding checklist rows via SQL in the migration** (INSERT per item for existing candidates) — there are no existing candidates, and seeding through `createCandidate` keeps one writer.
- Worktree caution (memory): HEAD currently on `feat/redesign-real-zig`; verify branch before any commit, never `git add -A`.

## AMENDMENTS

