# Implementation Report — Portal schema, retention purge, and the GDPR surface

**Plan**: `.claude/plans/portal-schema-retention-gdpr.md`   **Branch**: `feature/portal-schema-retention-gdpr`   **Status**: COMPLETE

## Summary

The candidate portal's entire data lifecycle, as one ticket (#17, Wave 1 of epic #16): a
migration adding the seven invite-scoped portal tables plus the `events.kind` column,
`test/schema.test.js` restructured into a full-schema lockfile, a pure portal store
(`hashToken` / `purgeExpired` / `deleteInviteByTokenHash`), a lazy purge on every `/prep/*`
request, the delete-now endpoint, a plain-language privacy page, a manual purge script, and
the GDPR data note drafted for owner sign-off. Purge and delete-now exactness are proven
against real SQLite with mixed-age fixtures, and the lazy purge was proven live against
`wrangler pages dev`.

## Tasks completed

- Seven portal tables + `events.kind` → `migrations/0002_portal.sql` (CREATE)
- Full-schema lockfile (exact columns per table, cascade chain, `mode` CHECK, closed `kind` vocabulary, hash-only secrets, ADD-COLUMN-only ALTER parsing) → `test/schema.test.js` (UPDATE)
- `INVITE_EVENT_KINDS`, `recordInviteEvent`, kind-filtered `listClients` JOIN, conditional-count `eventCounts` (`total` sums packs only) → `src/store.js` (UPDATE)
- Updated SQL expectations + invite-event coverage → `test/store.test.js` (UPDATE)
- Pure portal store, only code that deletes candidate data, whole scopes only → `src/portal/store.js` (CREATE)
- Recorded-SQL shape tests (purge names `invite` alone, binds nothing, 30-day literal locked; delete idempotent; SHA-256 vector) → `test/portal-store.test.js` (CREATE)
- Real-SQLite mixed-age fixture proof (`node:sqlite`, skip-guarded on Node 20) → `test/portal-purge.test.js` (CREATE)
- Lazy purge middleware, awaited before serve, fail-open for the privacy page → `functions/prep/_middleware.js` (CREATE)
- POST-only delete-now endpoint mirroring `/api/events`'s shape → `functions/prep/api/delete.js` (CREATE)
- Privacy notice (controller/processor/subprocessors, retention table, lawful basis, DSR route; `dossier-design` tokens, no raw hex) → `public/prep/privacy.html` (CREATE)
- `/prep/*` noindex block → `public/_headers` (UPDATE)
- Manual assurance purge (same statement as the lazy purge + `SELECT changes()`) → `scripts/purge.py` (CREATE) with `purge:preview` / `purge:remote` → `package.json` (UPDATE)
- UK GDPR data note, DRAFT with unchecked owner sign-off box → `docs/epics/interview-prep/data-note.md` (CREATE)
- Doc drift ("Three tables", schema-test description, expected `sqlite_master` list) → `README.md`, `DEPLOY.md` (UPDATE)

## Tests added

- `test/schema.test.js` — 11 tests (restructured lockfile; proven live: a bogus `invite` column failed the suite, then reverted)
- `test/store.test.js` — 30 tests (3 new for `recordInviteEvent`; JOIN/count expectations updated)
- `test/portal-store.test.js` — 6 tests (purge/delete/hash SQL shapes)
- `test/portal-purge.test.js` — 4 tests (migration onto a populated DB with `kind` backfill; purge exactness incl. the exact `-30d` boundary, `purged === 2`, survivors byte-identical; delete-now scope + idempotency; `mode`/`kind` CHECK violations). Skips cleanly on Node 20 with the remedy named.

## Validation results

- **Level 1**: `node --check` ×4 pass · `py_compile` pass · no `console.log`/TODO/FIXME in new code · no raw hex in privacy.html · doc-drift greps pass
- **Level 2**: Node 20: **300 pass, 0 fail, 4 skipped** (portal-purge, by design) · Node 24: **304 pass, 0 fail, 0 skipped**
- **Level 3**: `npm run db:local` applied 0001+0002 clean; `sqlite_master` lists all 10 tables (engine 3 + portal 7)
- **Level 4** (against `wrangler pages dev` on :8788): `/prep/privacy` 200 with "30 days" ×4 · delete-now `{"ok":true}` / `unexpected_fields` 400 / `bad_json` 400 / `missing_fields` 400 / `cross_origin` 403 · GET on the delete route serves only the static app shell (no deletion reachable by URL) · **lazy purge live**: seeded expired invite → one portal request → `remaining: 0` (test rows cleaned up after)
- **Level 5 (pre-deploy parts)**: `npm run db:preview` applied 0002 to the remote preview D1 · `npm run purge:preview` resolved the DB by name, exit 0, printed `"purged": 0`

## Deviations from the plan

1. **`test/store.test.js`'s event-path forbidden-word test** (`\bpack_` regex) would have failed on `eventCounts`'s legitimate `'pack_generated'` literal. The closed kind vocabulary is stripped before matching (with a comment); everything outside those three literals still fails on sight. The test also now covers `recordInviteEvent`'s calls.
2. **Fixture count**: the purge test seeds four invites (adding `D` at exactly `-30 days`) rather than the three in plan step 4, following the plan's own GOTCHA/spike (`purged === 2`, boundary asserted).
3. **`invite.client_id → clients` cascade** is asserted in the lockfile alongside the plan's child-chain list (the DDL declares it; deleting a client must take its invites).
4. **Level 4 server**: a `wrangler pages dev` instance from a parallel session already held :8788 and hot-reloaded the new functions; the sweep ran against it (same command, same D1 state) rather than a fresh `npm run dev`.

## Issues encountered

- **The working tree is shared with another ticket in progress** (the candidate-brief seam: `src/prep/`, modified `src/provenance.js`, `scripts/gen-brief.js`, `test/prep-*.test.js`, `test/collection.test.js`, `test/fixtures/prep-*`, and the `gen:brief` line in `package.json`). Those files are **not** #17's and must not be swept into its commit — `package.json` in particular needs a partial stage (only the two `purge:*` lines are #17's). `scripts/__pycache__/` is a byproduct, not for commit. Full suite green with both work streams present, on both Node versions.
- Open questions from the plan stand as designed: lawful-basis wording ships as DRAFT (data note carries the sign-off box; pilot, not merge, gates on it); `invite.status` deliberately un-CHECKed; `eventCounts` per-client rows gained `invites_sent`/`invites_opened` (no known consumer).

## PR notes (for piv-create-pr)

Body must say `Closes #17`, link `docs/epics/interview-prep/data-note.md`, and name the
deliberate schema-test change: the "exactly three tables" boundary became a two-regime
lockfile because #17 moves the no-candidate-data-at-rest boundary deliberately — candidate
data now rests only inside the invite-scoped cascade cage with a 30-day purge and delete-now,
exactly as decision 13 requires.
