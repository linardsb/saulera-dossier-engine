# Implementation Report — Compliance data layer (candidate, assignment, compliance_item)

**Plan**: `.claude/plans/compliance-data-layer.md`   **Branch**: `feat/compliance-data-layer`   **Status**: COMPLETE

Closes #67 · epic #65 · architecture `docs/epics/locum-fit-2.architecture.md` (spike #66)

## Summary

The third schema regime, at the data layer only. Migration 0008 adds `candidate`,
`assignment` and `compliance_item`, every child reaching `candidate` through ON DELETE
CASCADE — the invite cage's proven mechanism with a new root. `src/compliance/catalogue.js`
carries TTR's eight-item checklist as pure data (labels + amber lead-times); `src/compliance/
store.js` seeds, reads and writes it, deletes whole cages, and implements the 12-month
dormancy purge as one unbound statement. The purge runs lazily from `/prep` middleware beside
the portal's and is mirrored in `scripts/purge.py`. `test/schema.test.js` now locks three
regimes; the engine's candidate-shaped ban is byte-for-byte untouched. No UI, no routes, no
auth, no `events.kind` widening.

## Tasks completed

- Migration, three tables + three indexes → `migrations/0008_compliance.sql` (CREATE)
- Lockfile third regime: `COMPLIANCE_TABLES`, exact columns, cascade chain, four new
  structural tests → `test/schema.test.js` (UPDATE)
- Checklist catalogue (8 items, `ITEM_KEYS`, `ITEM_STATUSES`) → `src/compliance/catalogue.js` (CREATE)
- Store: `createCandidate`, `deleteCandidate`, `purgeDormant`, `createAssignment`,
  `setItemState`, `itemsByCandidate`, `ASSIGNMENT_STATUSES` → `src/compliance/store.js` (CREATE)
- Lazy purge, second fail-open block → `functions/prep/_middleware.js` (UPDATE)
- Assurance path, second DELETE + count → `scripts/purge.py` (UPDATE)
- Real-SQLite lifecycle suite → `test/compliance-purge.test.js` (CREATE)
- Recording-fake SQL-shape suite → `test/compliance-store.test.js` (CREATE)

## Tests added

`test/compliance-purge.test.js` — 7 tests on `node:sqlite` (skip on Node 20, as the house
helper does): 0008 applies clean after 0001–0007 and all 14 tables exist; `createCandidate`
seeds the whole catalogue at the DDL's own defaults; the dormancy boundary row-for-row
(A lapsed 13 months, D at exactly 12 months, E never booked → purged; B ended 2 months ago,
C open booking, F created 2 months ago → survive; engine and portal rows untouched; second
pass `{purged: 0}`); `deleteCandidate` idempotent with an honest `deleted: 0`; a sixth item
status and a fifth booking status are CHECK violations; unparseable `created_at`, `start_date`
and `expiry_date` are constraint violations with the four accepted forms still writing; a
second row for one (candidate, item) is a UNIQUE violation.

`test/compliance-store.test.js` — 10 tests on `fakeD1`: the purge is one `DELETE FROM
candidate` naming no child table (and legitimately naming `assignment`, the clock); the
retention number is 12 months twice over and binds nothing; the catalogue seed binds two
columns and no third; both vocabularies rejected before the SQL with the store's 400, and
every legal value accepted; `setItemState`'s bind order and `datetime('now')` stamp;
`createAssignment`'s NULL end_date and 'booked' default; `deleteCandidate`'s bind;
`itemsByCandidate` never `SELECT *`; missing required fields never reach the database.

`test/schema.test.js` — 4 new tests (17 total, was 13): `compliance_item.status` CHECK-typed
to five states, `assignment.status` to four, `UNIQUE (candidate_id, item_key)`, and "the
compliance cage stores no document bytes" — no column in the three tables may match
`/blob|bytes|image|photo|document|file|url|evidence/i`, the structural form of spike #66's
metadata-only decision.

**Mutation-checked** (the tests bite, not just pass): flipping the boundary `>` to `>=` fails
the row-for-row purge test; drifting `'+12 months'` to `'+24 months'` fails both the purge
test and the locked-number test. Reverted after each.

## Validation results

| Level | Command | Result |
|---|---|---|
| 1 | `node --check` on the three JS files | pass |
| 1 | `python3 -c "ast.parse(open('scripts/purge.py')…)"` | pass |
| 2 | `node --test test/compliance-store.test.js test/schema.test.js` | 27 pass, 0 fail |
| 3 | `node --test test/compliance-purge.test.js` (Node 24.11.0) | 7 pass, 0 fail |
| 3 | `npm test` under Node 24 | **865 pass, 0 fail, 0 skipped** |
| 3 | `npm test` under default Node 20 | 697 pass, 167 skipped, 1 fail — `node-version.test.js`, **pre-existing** (verified by stashing this branch's changes; it asserts the running Node satisfies `engines.node >= 22.5`) |
| 4 | `npm run db:local` | 0008 applied ✅ onto a database already carrying 0001–0007, 7 commands executed |
| 5 | `wrangler d1 execute --local` round-trip | a seeded row reads back `{status: 'missing', reference: '', expiry_date: null, checked_at: null}`; `DELETE FROM candidate` left 0 assignments and 0 items — the cascade holds on real D1, not only node:sqlite. Probe rows removed. |
| 5 | `scripts/purge.py`'s `PURGE_SQL`, executed | statement-by-statement against a seeded in-memory DB (scratch script, not committed): all four statements parse and run, `changes()` after an intervening `SELECT` does still report the preceding `DELETE`, and the resulting database is **row-for-row identical across all seven tables** to one purged by `purgeExpired` + `purgeDormant`. Counts agree: `{purged_invites: 1, purged_candidates: 3}`. |

`git diff --stat`: only the eight files this plan names. Tests are ~742 of ~1108 added lines
(67%), against the ticket's ≥40% estimate.

## Deviations from the plan

1. **`ASSIGNMENT_STATUSES` is exported from `src/compliance/store.js`, not the catalogue.**
   The plan listed the catalogue's exports as exactly three and the catalogue is about
   *compliance items*; a booking vocabulary there would be a second subject in a file #68
   imports browser-side. It sits beside `DIFFICULTY`'s precedent in the portal store instead,
   exported for #69 to read rather than reinvent.
2. **A shared `requireOneOf(field, value, allowed)` helper** rather than two inline checks.
   Three call sites (assignment status, item key, item status) with identical shape; it keeps
   `insertVariant`'s behaviour exactly — the store's 400 raised *before* the SQL — and its
   error code, `missing_fields`, so route error-mapping stays one branch. (`missing_fields`
   for a bad enum reads oddly; it is the existing house code for this case and inventing a new
   one before any route handles it would be the drift.)
3. **`scripts/purge.py`'s first count is renamed `purged` → `purged_invites`.** Two counts in
   one command need two names. Nothing in the repo consumes the alias (grepped).
4. **The purge SQL in `purge.py` is not byte-identical to `purgeDormant`'s** — the JS is an
   indented template literal, the Python a concatenated one-line string. Equivalence was
   *verified*, not asserted: executing the extracted `PURGE_SQL` against a seeded database
   leaves it row-for-row identical, across all seven tables, to one purged by the two store
   functions (see Validation, Level 5). Nothing enforces this mechanically at commit time — as
   is already true of the portal purge — so a cross-language drift test remains available as
   future scope.
5. **`assignment.start_date` and `end_date` carry the `datetime()` CHECK**, which the plan's
   DDL had but its prose only justified for `candidate.created_at`. Same argument: `end_date`
   is a purge clock, and an unparseable one makes an immortal cage.
6. **`itemsByCandidate` normalises its id** with `String(candidateId ?? "")`, matching
   `briefJsonByInviteId` — the precedent its doc comment cites — and the rest of this store's
   caller-value discipline. `deleteCandidate` binds raw, matching *its* precedent
   (`deleteInviteByTokenHash`) exactly.
7. **`test/prep-middleware.test.js` was not extended.** Read first, as instructed — it asserts
   ordering and `waitUntil`, not a call list, so the new block needed no change there. It
   exercises `purgeDormant` for real now (its `openMigrated` applies 0008) and passes.

## Issues encountered

- **Fixture date arithmetic.** The exact-12-month boundary case is only meaningful if the
  fixture's month arithmetic is SQLite's. JS `Date` math lands a day out across a leap year,
  which would make case D pass or fail for the wrong reason. The seed helper asks SQLite for
  its own dates (`SELECT datetime('now', ?)`) and binds the result through `createAssignment`,
  so the writer stays the production one.
- **`created_at` cannot be seeded through the writer**, deliberately — the DDL default is the
  dormancy clock's only source. The fixture reaches past `createCandidate` with a plain
  `UPDATE` to age a row, and says why in a comment.
- **Branch.** The worktree was on `feat/redesign-real-zig` (parallel-session memory). Tracked
  tree was clean, so `feat/compliance-data-layer` was cut from `main` (up to date with
  `origin/main`); the redesign branch keeps its commits untouched. **Nothing is committed
  yet** — `piv-commit` is next, and `git add -A` must not be used (untracked docs and other
  sessions' plan/report files are present).

## Notes for the reviewer

- The `NOT EXISTS` subquery is a deliberate departure from `purgeExpired`'s single-table
  WHERE: `assignment` is the dormancy clock, not a child being swept. Two statements
  (SELECT ids, DELETE IN) were rejected — one statement has no read-then-write window.
- The purge answers to dates and never to `assignment.status`. Case A's fixture has a booking
  that still says `'active'` thirteen months after it ended, and it purges: a stale status
  must not be able to extend how long health-adjacent data is held.
- Deploy note (standing memory): migration 0007 must reach production D1 before the next
  deploy; 0008 sequences after it. No remote migration was run from this ticket.
