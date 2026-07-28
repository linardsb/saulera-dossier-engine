# Feature: Portal schema, retention purge, and the GDPR surface

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

## Feature Description

The candidate-portal's D1 layer and its entire data lifecycle, as one ticket: a migration adding
the seven portal tables (`invite`, `candidate_role`, `competency`, `question`, `attempt`, `habit`,
`otp`), a lazy purge that hard-deletes every expired invite scope on every portal request plus a
manual purge script for assurance, a delete-now endpoint dropping the same scope immediately, a
plain-language privacy notice page served on the portal, and `invite_sent` / `invite_opened` added
to the existing non-personal event counter — the entire telemetry surface.

This is Wave 1 of epic #16 (no dependencies). #20 (auth), #22 (Send), and #23 (session engine)
all build on these tables.

## User Story

As a candidate invited to the prep portal
I want my data to be held only as long as it helps me prepare, deletable by me at any moment, with a privacy notice I can actually read
So that using the portal never costs me control of my own information

(And as the agency: so the strict-UK-GDPR hard constraint — decision 13 — is met structurally from day one, not retrofitted.)

## Problem Statement

The portal (epic #16) stores candidate personal data at rest for the first time in this product —
JD, CV, ethos text, practice attempts. The engine's founding boundary was "no candidate data at
rest," enforced by `test/schema.test.js`. This ticket must move that boundary **deliberately and
in the open**: candidate data may now rest, but only inside an invite-scoped cage with automatic
30-day post-interview purge, a working delete-now, and a stated GDPR posture. Nothing exists yet:
no tables, no purge, no privacy notice, no invite telemetry.

## Solution Statement

One migration (`migrations/0002_portal.sql`) creates the seven tables exactly per architecture §4,
every child table reaching `invite` through `ON DELETE CASCADE` so the whole scope dies with one
`DELETE FROM invite`. The events counter gains a `kind` column via a single, explicitly
allow-listed `ALTER TABLE ADD COLUMN`. `test/schema.test.js` is restructured from "exactly three
tables" into a full-schema lockfile that parses the new form and locks every table's exact
columns, the `attempt.mode` CHECK, and the cascade chain. A pure `src/portal/store.js` carries
`purgeExpired`, `deleteInviteByTokenHash`, `hashToken`; `functions/prep/_middleware.js` runs the
purge on every `/prep/*` request before serving; `functions/prep/api/delete.js` is the delete-now
endpoint; `public/prep/privacy.html` is the notice; `scripts/purge.py` is the manual assurance
path. A real-SQLite fixture test (`node:sqlite`, skip-guarded on Node 20) proves purge exactness
with mixed-age fixtures.

## Out of Scope / Non-Goals

- Not included: minting invites/tokens, sending email, magic-link login, OTP issuing — #20 and #22 (this ticket only stores their shapes and hashes).
- Not included: any portal UI beyond the static privacy page — the session shell, drill UI, delete **button** are #24 (the endpoint the button will call ships here).
- Not included: writing rows to `competency`/`question`/`attempt`/`habit` — #19 and #23 own the writers; this ticket owns their shapes, constraints, and deletion.
- Not included: the `prep.` subdomain DNS / Pages custom domain (architecture §6 risk; infra, later). Everything here is path-scoped `/prep/*`.
- Not included: Cloudflare Access changes. Access is currently deferred (deployment public, `.claude/verify-deploy.sh` header); when it returns, its scope must exclude `/prep/*` — flagged in NOTES, owned by #20.
- Not changing: `functions/api/events.js` (POST body vocabulary stays `{client_id, duration_ms}`; invite events are recorded server-side via the store, never over HTTP).
- Not changing: `recordEvent`'s SQL — the `kind` column's DDL default makes pack events work untouched.

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: Medium-High (~700–1000 lines incl. tests, per ticket estimate)
**Primary Systems Affected**: D1 schema, `src/store.js`, new `src/portal/`, new `functions/prep/`, `public/`, `scripts/`, test suite
**Dependencies**: none new — zero-dependency `node --test` stays zero-dependency (`node:sqlite` is stdlib, skip-guarded)

## Related Work

**Implements**: [#17](https://github.com/linardsb/saulera-dossier-engine/issues/17) (PR must say `Closes #17`)   ·   **Epic**: [#16](https://github.com/linardsb/saulera-dossier-engine/issues/16) + `docs/epics/candidate-portal.architecture.md` (the 23-decision record — inherited, not re-decided)

**Back-references** (plans this builds on or inherits decisions from):

- `.claude/plans/client-knowledge-store.md` — Why: established the migration style, the store/Function split, the events counter, and the schema-test boundary this ticket moves
- `docs/epics/interview-prep/SPEC.md` — Why: the State section is the contract for the pedagogy tables; the `mode` honesty rule becomes a CHECK constraint here

**Forward-references** (plans that extend or supersede this — append as follow-ups get created):

- (none yet — #20 auth and #22 Send will consume `invite`/`otp`; #19/#23 will write the pedagogy tables)

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `migrations/0001_init.sql` — Why: migration voice and style (why-comments per table, seeded agency row, `events_by_client` index naming), and the exact `events` shape being widened
- `test/schema.test.js` (all 172 lines) — Why: the file this ticket restructures. Its parser (`tables()`, `columns()`), its two self-guard tests, and its own comments inviting a deliberate change ("change this assertion deliberately and say why in the PR") are the contract
- `src/store.js` (lines 1–38, 50–65, 269–334) — Why: module philosophy (pure, D1-shaped `db` first arg, importable by `node --test`), `StoreError` codes/statuses, `listClients`'s events JOIN and `eventCounts`/`recordEvent`/`requireClient` — the three touch points for `kind`
- `src/http.js` — Why: `json`, `readJson`, `sameOrigin`, `errorResponse` — the delete endpoint reuses all four; do not reinvent
- `functions/api/events.js` — Why: the Function-layer pattern to MIRROR for the delete endpoint: `env.DB` guard → `sameOrigin` → `readJson` → ALLOWED-set field check → store call → `errorResponse`
- `test/helpers/fake-d1.js` — Why: the recording fake for SQL-shape assertions (bind/placeholder count check); portal store unit tests use it
- `test/store.test.js` (lines 1–120 for idiom; then the listClients/eventCounts/recordEvent sections) — Why: `codeOf()` helper idiom, recorded-SQL assertion style; the tests whose SQL expectations change with `kind`
- `scripts/dev.py` — Why: the wrangler pin (`wrangler@4.114.0`), `node22_path()`, the D1 name/env-var scheme (`DOSSIER_D1_NAME`, preview/production map), and the note that `d1 execute --remote` resolves by NAME (verified 27 Jul 2026) — `scripts/purge.py` mirrors all of this
- `public/clients.html` — Why: the static-page head pattern (stylesheet links, favicon, semantic structure) `public/prep/privacy.html` mirrors
- `public/_headers` — Why: existing header file the `/prep/*` noindex block is appended to
- `README.md` (lines 30, 108–120) and `DEPLOY.md` (lines 220–235) — Why: doc drift — both state the three-table schema and must be updated with the migration

### New Files to Create

- `migrations/0002_portal.sql` — the seven portal tables + events `kind` column
- `src/portal/store.js` — `hashToken`, `purgeExpired`, `deleteInviteByTokenHash` (pure, D1-shaped db)
- `functions/prep/_middleware.js` — lazy purge on every `/prep/*` request
- `functions/prep/api/delete.js` — POST `/prep/api/delete` delete-now endpoint
- `public/prep/privacy.html` — plain-language privacy notice at `/prep/privacy`
- `scripts/purge.py` — manual purge against preview/production D1
- `docs/epics/interview-prep/data-note.md` — the epic's non-code gate: UK GDPR posture written for the agency (DRAFT for owner sign-off)
- `test/portal-store.test.js` — SQL-shape unit tests for `src/portal/store.js`
- `test/portal-purge.test.js` — real-SQLite mixed-age fixture test (`node:sqlite`, skip-guarded)

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- `docs/epics/candidate-portal.architecture.md` — §4 is the table shapes verbatim (inherited decision — do not redesign); §2 decisions 3, 11, 12, 13, 14, 18, 23; §3 the `mode` honesty rule
- `docs/epics/interview-prep/SPEC.md` — the `State` section: "`mode` is the field that makes the rest honest: a revealed answer must never raise `success_rate`"
- [Cloudflare Pages Functions — Middleware](https://developers.cloudflare.com/pages/functions/middleware/)
  - Specific section: directory-scoped `_middleware.js`
  - Why: confirms `functions/prep/_middleware.js` runs on ALL `/prep/*` requests **including static assets** like `privacy.html`, and `next()` falls through to asset serving
- [SQLite ALTER TABLE](https://www.sqlite.org/lang_altertable.html#altertabaddcol)
  - Specific section: ADD COLUMN restrictions
  - Why: a NOT NULL added column needs a non-NULL default (ours: `'pack_generated'`); CHECK constraints are permitted; PRIMARY KEY/UNIQUE are not
- [Cloudflare D1 — foreign keys](https://developers.cloudflare.com/d1/sql-api/foreign-keys/)
  - Why: D1 enforces `PRAGMA foreign_keys = on` by default (defer_foreign_keys exists) — the cascade design leans on this; `deleteClient`'s cascade already proves it on this deployment. **Gotcha**: plain `node:sqlite` defaults to OFF — the fixture test must set the pragma itself
- [Node.js `node:sqlite`](https://nodejs.org/api/sqlite.html)
  - Why: the fixture test's engine. VERIFIED on this machine (28 Jul 2026): on the default v20.20.2 `import("node:sqlite")` rejects with `ERR_UNKNOWN_BUILTIN_MODULE` (the skip guard fires cleanly); under `~/.nvm/versions/node/v24.11.0/bin` it imports and runs (one harmless ExperimentalWarning on stderr)
- [ICO — right to erasure / privacy notice requirements](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/individual-rights/right-to-erasure/)
  - Why: the privacy page and data note must state lawful basis, retention, and the DSR route in plain language

### Patterns to Follow

**Migration voice** (`migrations/0001_init.sql:1-19`): every table gets a why-comment naming the decision it implements; constraints carry their reasoning. 0002 must read the same way — it is the file a future reviewer reads to learn the retention design.

**Store function shape** (`src/store.js:12-13`): "Every function takes a D1-shaped `db` as its first argument. No HTTP, no Response, no env. Every user value is a bound parameter; nothing is ever interpolated into a SQL string."

**Error vocabulary** (`src/store.js:31-38`): `StoreError(code, status)` with lowercase snake_case codes: `missing_fields` 400, `not_found` 404, `not_migrated` 503. Import `StoreError` from `../store.js` in `src/portal/store.js` — do not fork the class.

**Function-layer shape** (`functions/api/events.js:17-40`):
```js
if (!env.DB) return json({ error: "not_configured" }, 503);
if (!sameOrigin(request)) return json({ error: "cross_origin" }, 403);
// readJson → ALLOWED-set unexpected_fields check → store call → errorResponse(err)
```

**Recorded-SQL test idiom** (`test/store.test.js` + `test/helpers/fake-d1.js`): assert boundary properties against `db.calls[n].sql` / `.args` — e.g. "the purge SQL names only `invite` and binds nothing".

**Test-file voice**: every test file opens with a comment saying what class of failure it exists to catch, and assertions carry failure messages that tell the reader what moved and why it matters.

**UI**: activate the `dossier-design` skill before writing `privacy.html`; read `references/CRAFT.md` before CSS, run `references/CHECKLIST.md` before committing. Reuse `tokens.css` custom properties (no raw hex). Every visible string in plain language for a first-time reader (house rule).

---

## IMPLEMENTATION PLAN

### Phase 1: The migration and the boundary moved in the open

The schema and the lockfile test that governs it, changed together in one reviewable move.

**Tasks:**

- `migrations/0002_portal.sql` — seven tables, cascades, indexes, events `kind`
- `test/schema.test.js` restructured into a full-schema lockfile

### Phase 2: Store layer

**Depends on:** Phase 1 (SQL targets the new shapes)

**Tasks:**

- `src/portal/store.js` — hash, purge, delete-scope
- `src/store.js` — `recordInviteEvent`, kind-filtered `listClients` + `eventCounts`
- Unit tests for both (fake-d1)

### Phase 3: Portal surface

**Depends on:** Phase 2 (middleware/endpoint import the store)

**Tasks:**

- `functions/prep/_middleware.js`, `functions/prep/api/delete.js`
- `public/prep/privacy.html` + `_headers` noindex block

### Phase 4: Assurance — fixture test, manual script, the data note

**Depends on:** Phase 1 only (not Phases 2–3 for the script/note). **Independent of:** Phase 3 — the fixture test, `scripts/purge.py`, and `data-note.md` can be written in parallel with the portal surface.

**Tasks:**

- `test/portal-purge.test.js` — real-SQLite mixed-age fixtures
- `scripts/purge.py` + npm scripts
- `docs/epics/interview-prep/data-note.md` + README/DEPLOY drift fixes

### Phase 5: Full validation

**Tasks:**

- All validation levels below, in order

---

## STEP-BY-STEP TASKS

### CREATE migrations/0002_portal.sql

- **IMPLEMENT**: the seven portal tables exactly per architecture §4, plus the events `kind` column. Full DDL (column order and names are load-bearing — the lockfile test asserts them):

```sql
-- Portal schema (#17). Architecture §4, mirroring SPEC.md's State section, plus the
-- handover/auth layer. The retention design (decision 13): every row below hangs off an
-- invite through ON DELETE CASCADE, so `DELETE FROM invite WHERE <expired>` erases a
-- candidate's entire footprint in one statement. There is no soft delete and no archive.

-- interview_at / expires_at / sent_at / opened_at are SQLite UTC datetime strings
-- ('YYYY-MM-DD HH:MM:SS', the datetime('now') format). #22 writes them; purge compares
-- them through datetime(), which also accepts ISO-8601 'T' forms.

-- status carries no CHECK deliberately: its vocabulary belongs to #20/#22, and a hard
-- delete means there is never a 'deleted' state to represent.
CREATE TABLE invite (
  id           TEXT PRIMARY KEY,
  client_id    TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  email        TEXT NOT NULL,
  interview_at TEXT NOT NULL,
  sent_at      TEXT,
  opened_at    TEXT,
  expires_at   TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'sent'
);
CREATE INDEX invite_by_interview ON invite (interview_at);

-- The handover payload (decision 1, 14): the same privileged inputs that power the pack,
-- carried per-invite so purge and delete-now take the CV with everything else.
CREATE TABLE candidate_role (
  id         TEXT PRIMARY KEY,
  invite_id  TEXT NOT NULL UNIQUE REFERENCES invite(id) ON DELETE CASCADE,
  jd_text    TEXT NOT NULL DEFAULT '',
  ethos_text TEXT NOT NULL DEFAULT '',
  cv_text    TEXT NOT NULL DEFAULT '',
  brief_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE competency (
  id           TEXT PRIMARY KEY,
  role_id      TEXT NOT NULL REFERENCES candidate_role(id) ON DELETE CASCADE,
  label        TEXT NOT NULL,
  source_quote TEXT NOT NULL DEFAULT '',
  importance   INTEGER NOT NULL DEFAULT 0,
  stage        TEXT NOT NULL DEFAULT '',
  success_rate REAL NOT NULL DEFAULT 0
);
CREATE INDEX competency_by_role ON competency (role_id);

CREATE TABLE question (
  id            TEXT PRIMARY KEY,
  competency_id TEXT NOT NULL REFERENCES competency(id) ON DELETE CASCADE,
  text          TEXT NOT NULL,
  variant_of    TEXT REFERENCES question(id) ON DELETE CASCADE,
  axis          TEXT CHECK (axis IN ('lateral','vertical')),
  difficulty    INTEGER
);
CREATE INDEX question_by_competency ON question (competency_id);
CREATE INDEX question_by_variant ON question (variant_of);

-- mode is the field that makes the rest honest (SPEC State): a revealed answer must never
-- count as recall. The CHECK makes that structural — #23 cannot write a fourth mode.
CREATE TABLE attempt (
  id            INTEGER PRIMARY KEY,
  competency_id TEXT NOT NULL REFERENCES competency(id) ON DELETE CASCADE,
  question_id   TEXT NOT NULL REFERENCES question(id) ON DELETE CASCADE,
  mode          TEXT NOT NULL CHECK (mode IN ('recall','nudged','revealed')),
  rating        INTEGER,
  note          TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX attempt_by_competency ON attempt (competency_id);
CREATE INDEX attempt_by_question ON attempt (question_id);

CREATE TABLE habit (
  id             INTEGER PRIMARY KEY,
  role_id        TEXT NOT NULL REFERENCES candidate_role(id) ON DELETE CASCADE,
  label          TEXT NOT NULL,
  evidence_count INTEGER NOT NULL DEFAULT 1,
  first_seen     TEXT NOT NULL DEFAULT (datetime('now')),
  active         INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX habit_by_role ON habit (role_id);

-- Returning login (decision 12). Only the hash rests; #20 mints and checks codes.
CREATE TABLE otp (
  id         INTEGER PRIMARY KEY,
  invite_id  TEXT NOT NULL REFERENCES invite(id) ON DELETE CASCADE,
  code_hash  TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX otp_by_invite ON otp (invite_id);

-- The one deliberate widening of the counter (decision 3, 23): kind distinguishes pack
-- generation from invite delivery telemetry. Still non-personal — no invite id, no email,
-- no behaviour. The CHECK is the whole vocabulary; a fourth kind is a schema change made
-- in the open, exactly like this one.
ALTER TABLE events ADD COLUMN kind TEXT NOT NULL DEFAULT 'pack_generated'
  CHECK (kind IN ('pack_generated', 'invite_sent', 'invite_opened'));
```

- **PATTERN**: `migrations/0001_init.sql` — comment voice, index naming (`events_by_client` → `competency_by_role`)
- **GOTCHA**: SQLite ADD COLUMN forbids PRIMARY KEY/UNIQUE and requires a non-NULL default with NOT NULL — the DDL above satisfies both. Do NOT edit 0001 (applied migrations are never edited — `test/schema.test.js:29-32`).
- **VERIFIED (28 Jul 2026)**: this exact DDL was executed against real SQLite (Node 24 `node:sqlite`, `PRAGMA foreign_keys = ON`, 0001 applied first, `clients`+`events` populated BEFORE the ALTER). All of it holds: applies clean, ALTER backfills `kind = 'pack_generated'` on existing rows, the purge DELETE cascades exactly the expired scopes (including the exact `-30 days` boundary, `<=`), engine tables untouched, delete-by-token_hash idempotent, `mode`/`kind` CHECKs reject bad values. See NOTES → "De-risking spike". Copy the statements verbatim; only the comments are yours to write.
- **VALIDATE**: `npm run db:local` (applies 0001+0002 clean to the local preview D1 — this is AC #1's first proof)
- **SATISFIES**: AC #1 (migration applies clean on the existing D1)

### UPDATE test/schema.test.js

- **IMPLEMENT**: restructure from "exactly three tables" into a full-schema lockfile. Keep the parser, both self-guard tests, and the file's voice. Changes:
  1. **Teach the parser the one new form**: extract every `ALTER TABLE` statement; each MUST match `/ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(\w+)/i` (any other ALTER form fails the test, preserving the old guard); fold the added column into `byName` for its table.
  2. **Replace the ALTER-count-zero test** with: every ALTER is an ADD COLUMN the parser read (same "teach it or fail" message style).
  3. **Split the vocabulary**: `ENGINE_TABLES = ["agency", "clients", "events"]`, `PORTAL_TABLES = ["invite", "candidate_role", "competency", "question", "attempt", "habit", "otp"]`; assert the full table set is exactly their union.
  4. **Scope the candidate-shaped-name rule to ENGINE_TABLES only**, with a comment recording the boundary's deliberate move: portal tables ARE candidate data, governed by decision 13's retention cage (cascade + purge) instead of by absence.
  5. **Lock every table's exact column list** (like the existing events test) — engine three (events now includes `kind`) and portal seven, from the DDL above.
  6. **New portal assertions**:
     - every portal table except `invite` declares `REFERENCES <parent>` with `ON DELETE CASCADE` for each of its FK columns (assert against the parsed table body), so one `DELETE FROM invite` provably takes the whole scope
     - `attempt` body matches `/mode\s+TEXT\s+NOT\s+NULL\s+CHECK/i` and contains `'recall'`, `'nudged'`, `'revealed'` — the SPEC honesty rule as a failing test
     - `events` body/ALTER contains the kind CHECK limited to exactly the three kinds — the telemetry vocabulary is closed
     - `invite` has `token_hash` and no column named `token`; `otp` has `code_hash` and no `code` — no plaintext secrets at rest (implied by exact column locks, but assert the two hash columns by name with a message saying why)
- **PATTERN**: the file's own comment at lines 101-112 invites exactly this: "change this assertion deliberately and say why in the PR"
- **GOTCHA**: comments are stripped before matching (line 38) — the migration's prose comments containing "candidate" are safe. The forbidden regex `\bpack\b|brief` would match `brief_json` and `candidate_role` — that is WHY the rule is scoped to engine tables, not deleted.
- **VALIDATE**: `node --test test/schema.test.js` (all pass; then temporarily add a bogus column to 0002 locally and confirm it FAILS, then revert — the lockfile must be proven live)
- **SATISFIES**: AC #1, AC #4 (no table stores recruiter-visible candidate behaviour — the lockfile is the mechanism)

### UPDATE src/store.js

- **IMPLEMENT**: three surgical changes, nothing else:
  1. `export const INVITE_EVENT_KINDS = ["invite_sent", "invite_opened"];` near `SEND_FORMATS`
  2. `export async function recordInviteEvent(db, { clientId, kind } = {})` — validate `kind` against `INVITE_EVENT_KINDS` (throw `StoreError("missing_fields", 400, ...)` naming the allowed kinds), then `requireClient`, then `INSERT INTO events (client_id, duration_ms, kind) VALUES (?, 0, ?)`. Duration 0: delivery telemetry has no duration; the column stays NOT NULL. Place after `recordEvent` with a comment: this is the entire invite telemetry surface (decision 3) — no invite id, no email, ever.
  3. Filter the pack metric: in `listClients`, change the JOIN to `LEFT JOIN events e ON e.client_id = c.id AND e.kind = 'pack_generated'`; in `eventCounts`, group with conditional counts:
     ```sql
     SELECT client_id,
            COUNT(CASE WHEN kind = 'pack_generated' THEN 1 END) AS packs,
            COUNT(CASE WHEN kind = 'invite_sent'    THEN 1 END) AS invites_sent,
            COUNT(CASE WHEN kind = 'invite_opened'  THEN 1 END) AS invites_opened
       FROM events GROUP BY client_id
     ```
     `total` stays the sum of `packs` only (PRD §7's metric must not inflate).
- **PATTERN**: `recordEvent` (`src/store.js:294-318`) for validation-before-existence-check ordering; `requireClient` is module-private and stays so
- **GOTCHA**: `recordEvent` itself is UNTOUCHED — the DDL default makes existing inserts write `pack_generated`. Do not add `kind` to its SQL or to `functions/api/events.js`'s ALLOWED set.
- **VALIDATE**: `node --test test/store.test.js` (after the next task updates expectations)
- **SATISFIES**: AC #4 (telemetry stays non-personal), ticket scope "the entire telemetry surface"

### UPDATE test/store.test.js

- **IMPLEMENT**: update the recorded-SQL expectations that changed and add invite-event coverage:
  - `listClients` test: assert the recorded SQL contains `e.kind = 'pack_generated'` (the packs metric cannot count invites)
  - `eventCounts` test: new queued row shape `{client_id, packs, invites_sent, invites_opened}`; assert `total` sums `packs` only even when invite counts are non-zero
  - new tests: `recordInviteEvent` rejects unknown/missing kind (`missing_fields`) before touching the db (`db.calls.length === 0`); happy path records `["<client-id>", "invite_sent"]` args and SQL naming exactly `(client_id, duration_ms, kind)`; unknown client → `not_found`
- **PATTERN**: `codeOf()` helper (`test/store.test.js:59-67`); fake-d1 queueing
- **VALIDATE**: `node --test test/store.test.js`
- **SATISFIES**: AC #4

### CREATE src/portal/store.js

- **IMPLEMENT**: pure module, same contract as `src/store.js` (D1-shaped `db`, bound params only, importable by `node --test`). Header comment stating the lifecycle rule: this module is the only code that deletes candidate data, and it only ever deletes whole invite scopes. Exports:
  - `export async function hashToken(token)` — SHA-256 hex via `crypto.subtle.digest` + `TextEncoder` (global in Workers and Node 20+; no imports). Throws `StoreError("missing_fields", 400)` on empty/non-string.
  - `export async function purgeExpired(db)` — exactly one statement, no bound user values:
    `DELETE FROM invite WHERE datetime(interview_at, '+30 days') <= datetime('now')`
    Returns `{ purged: result.meta.changes ?? 0 }`. Comment: cascade does the rest (schema.test.js proves the chain); the index `invite_by_interview` keeps the every-request guard cheap.
  - `export async function deleteInviteByTokenHash(db, tokenHash)` — `DELETE FROM invite WHERE token_hash = ?`; returns `{ ok: true }` regardless of matched rows. Comment why idempotent: after the call the candidate's state is clean either way, and a not-found answer would make the delete button lie to a candidate holding a stale link.
  - `import { StoreError } from "../store.js";`
- **PATTERN**: `src/store.js:1-13` module philosophy; `StoreError` reuse
- **GOTCHA**: `crypto.subtle` is async — `hashToken` is async; the endpoint awaits it. Never store or log the raw token.
- **VALIDATE**: `node --check src/portal/store.js && node --test test/portal-store.test.js` (next task)
- **SATISFIES**: AC #2, AC #3

### CREATE test/portal-store.test.js

- **IMPLEMENT**: fake-d1 SQL-shape tests, bias toward what would let something through:
  - `purgeExpired` SQL names ONLY `invite` (regex: no other table word appears) — deleting children directly would mask a broken cascade; binds nothing (`args.length === 0`); contains `'+30 days'` and `datetime(` (the retention number is load-bearing — a drive-by change to 60 must fail a test)
  - `deleteInviteByTokenHash` binds exactly `[hash]`, SQL targets `token_hash = ?`, returns `{ok:true}` when `meta.changes` is 0 (fake returns changes:1; also assert no throw on empty result path)
  - `hashToken`: known vector (`hashToken("abc")` → `"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"`), rejects `""`/`null` with `missing_fields`, never calls the db
- **PATTERN**: `test/store.test.js` recorded-SQL style + file-header voice
- **VALIDATE**: `node --test test/portal-store.test.js`
- **SATISFIES**: AC #2, AC #3

### CREATE test/portal-purge.test.js

- **IMPLEMENT**: the AC's mixed-age fixture proof, against real SQL. Structure:
  1. `let DatabaseSync; try { ({ DatabaseSync } = await import("node:sqlite")); } catch {}` — every test passes `{ skip: !DatabaseSync && "node:sqlite unavailable (Node < 22.5); run under Node 24 for full coverage" }`
  2. tiny adapter wrapping `DatabaseSync` in the D1 shape (`prepare→bind→run/first/all`, ~20 lines, test-local like fake-d1's spirit); constructor runs `db.exec("PRAGMA foreign_keys = ON")` — SQLite defaults OFF, D1 defaults ON, and without it every cascade assertion silently passes
  3. apply `migrations/0001_init.sql` via `exec`, then INSERT a client and a legacy `events` row, THEN apply `0002_portal.sql` — proving the ALTER lands on a populated table and backfills `kind = 'pack_generated'` (AC #1's second proof)
  4. seed mixed ages: invite A expired (`interview_at = datetime('now','-40 days')`), invite B live (`-5 days`), invite C future (`+7 days`) — each with full scope: candidate_role, 2 competencies, core question + a `variant_of` child, attempts in each mode, habit, otp
  5. `purgeExpired(adapter)` → assert `purged === 1`; every table row count drops by exactly A's share; B and C's rows byte-identical; `clients`, `agency`, `events` untouched (AC #2: "exactly the expired invite scope and nothing else")
  6. `deleteInviteByTokenHash(adapter, hashB)` → B's whole scope gone, C intact, engine tables untouched (AC #3)
  7. honesty rule at the SQL level: inserting `attempt.mode = 'shown'` throws a constraint error; inserting a fourth `events.kind` throws
- **GOTCHA**: `node --test test/*.test.js` does not glob into `test/helpers/` — the adapter may live in the test file or in `test/helpers/`; boundary date rows (`exactly -30 days`) purge (`<=`) — assert it
- **VERIFIED (28 Jul 2026)**: steps 3–7 were executed end-to-end as a spike (see NOTES) — every assertion listed above passed against real SQLite, including the boundary purge (`purged=2` for `-40d` + `-30d`), half/quarter row-count arithmetic across all seven tables, and both constraint throws. The skip guard is proven too: `import("node:sqlite")` rejects with `ERR_UNKNOWN_BUILTIN_MODULE` on the machine's default Node 20.20.2 and imports fine under `~/.nvm/versions/node/v24.11.0/bin`. This test is a transcription job, not a design job.
- **VALIDATE**: `PATH="$HOME/.nvm/versions/node/v24.11.0/bin:$PATH" node --test test/portal-purge.test.js` (runs), and `node --test test/portal-purge.test.js` on v20 (skips cleanly)
- **SATISFIES**: AC #1, AC #2, AC #3

### CREATE functions/prep/_middleware.js

- **IMPLEMENT**:
  ```js
  import { purgeExpired } from "../../src/portal/store.js";

  export async function onRequest(context) {
    const { env, next } = context;
    if (env.DB) {
      try {
        await purgeExpired(env.DB);
      } catch (err) {
        console.error("portal purge failed:", err);
      }
    }
    return next();
  }
  ```
  Header comment: Pages has no cron (architecture §4), so retention runs lazily on every `/prep/*` request — awaited BEFORE `next()`, because an expired invite must not serve one last time at +31 days; the failure path serves anyway because the privacy notice must stay reachable even on a broken deployment, and `scripts/purge.py` is the assurance net.
- **PATTERN**: `functions/api/events.js` env.DB guard idiom; helper logic stays in `src/` because anything under `functions/` is a route (`src/http.js:4-5`)
- **GOTCHA**: directory middleware intercepts static assets under `/prep/*` too — that is the feature (the privacy page hit purges), not a bug. Do NOT create a `public/_routes.json` — none exists and adding one changes function routing globally.
- **VALIDATE**: `node --check functions/prep/_middleware.js`; behaviour proven in Level 4
- **SATISFIES**: AC #2 (lazy purge on every portal request)

### CREATE functions/prep/api/delete.js

- **IMPLEMENT**: `onRequestPost` only, MIRROR of `functions/api/events.js`: `env.DB` 503 guard → `sameOrigin` 403 → `readJson` → `ALLOWED = new Set(["token"])` unexpected-fields 400 → trim token, empty → `missing_fields` 400 → `await deleteInviteByTokenHash(env.DB, await hashToken(token))` → `json({ ok: true })`. Header comment: the day-one delete-now (decision 13); idempotent 200 by design; the raw token is hashed in-memory and never stored or logged.
- **PATTERN**: `functions/api/events.js:17-40` verbatim shape; imports from `../../../src/http.js` and `../../../src/portal/store.js` (three levels — count them)
- **GOTCHA**: no GET handler — a delete reachable by URL-click gets prefetched by mail scanners; POST + sameOrigin only.
- **VALIDATE**: Level 4 curl sweep below
- **SATISFIES**: AC #3

### CREATE public/prep/privacy.html + UPDATE public/_headers

- **IMPLEMENT**: static page at `/prep/privacy` (Pages pretty-URL serves the `.html`). Activate the `dossier-design` skill first; mirror `public/clients.html`'s head (link `../tokens.css`, `../fonts.css`, `../app.css`; favicon). Semantic landmarks (`<main>`, headed sections), keyboard-operable, repo contrast gates. Plain language throughout — a candidate the night before an interview, not a lawyer. Sections, in order:
  1. **What this is** — one paragraph: a private prep space; nothing you do here reaches the recruiter
  2. **Who holds your data** — the recruitment agency that invited you (controller); this portal's operator processes it for them; infrastructure and model subprocessors named (Cloudflare, Anthropic, Resend)
  3. **What we hold and why** — a retention table (`<table>`): the job description · your CV · role context — to build your practice sessions; your practice attempts and ratings — to pick your next question; delivery status (sent/opened) — the ONLY thing your recruiter sees, stated in bold plain words
  4. **Lawful basis** — legitimate interests: helping you prepare for an interview you accepted (DRAFT wording — owner confirms, see Open Questions)
  5. **When it disappears** — automatically 30 days after your interview date, everything, permanently; no archive, no backup copy kept
  6. **Delete it now** — the delete control in your portal removes everything immediately; same scope as the automatic purge
  7. **Your rights** — access, correction, erasure, complaint; route: contact the agency that invited you; escalation: ICO (ico.org.uk)
  Append to `public/_headers` (keep the existing block untouched):
  ```
  /prep/*
    X-Robots-Tag: noindex
  ```
- **PATTERN**: `public/clients.html` head/structure; `dossier-design` `references/CRAFT.md` + `CHECKLIST.md`; no raw hex (tokens only)
- **GOTCHA**: no agency name can be injected into a static page — use "the recruitment agency that invited you", never a placeholder like `{{agency}}`. Do not promise the delete *button* exists today — say "the delete control in your prep portal" (it ships with #24, before any real candidate exists via #22).
- **VALIDATE**: `curl -s http://localhost:8788/prep/privacy | grep -c "30 days"` ≥ 1 (with `npm run dev` running); CHECKLIST.md pass
- **SATISFIES**: ticket scope "plain-language privacy notice page (lawful basis, retention table, DSR route) served on the portal"

### CREATE scripts/purge.py + UPDATE package.json

- **IMPLEMENT**: the manual assurance net. Mirror `scripts/dev.py`'s constants (`WRANGLER = "wrangler@4.114.0"`, `node22_path()`, `DOSSIER_D1_NAME` env scheme, flush=True prints). Usage: `./scripts/purge.py preview|production`. Since `d1 execute --remote` resolves by NAME (dev.py header, verified 27 Jul 2026), no throwaway config is needed:
  ```python
  run(["d1", "execute", name, "--remote", "--command", PURGE_SQL], env)
  ```
  with `PURGE_SQL = "DELETE FROM invite WHERE datetime(interview_at, '+30 days') <= datetime('now'); SELECT changes() AS purged;"` — print wrangler's output so the operator sees the purged count. Docstring: why this exists (Pages has no cron; the lazy purge needs an assurance path that does not depend on traffic — a portal nobody visits still purges on schedule via this script + a calendar reminder).
  Add npm scripts mirroring the db: naming: `"purge:preview": "python3 scripts/purge.py preview"`, `"purge:remote": "python3 scripts/purge.py production"`.
- **PATTERN**: `scripts/dev.py` throughout — do not fork its wrangler pin
- **VERIFIED (28 Jul 2026)**: the two-statement `--command` works under the pinned `wrangler@4.114.0` — `d1 execute DB -c .wrangler/d1-local.toml --local --persist-to .wrangler/state --command "SELECT 1 AS a; SELECT changes() AS purged;"` returned both result sets, `success: true` each. Use `PURGE_SQL` as written; no fallback needed.
- **VALIDATE**: `python3 -m py_compile scripts/purge.py`; `npm run purge:preview` against the preview D1 → exit 0, prints a purged count
- **SATISFIES**: AC #2 ("plus a manual purge script")

### CREATE docs/epics/interview-prep/data-note.md

- **IMPLEMENT**: the epic's non-code gate, drafted for owner sign-off (it "rides with #17's privacy notice but is a written artefact"). Header: **DRAFT — requires owner review before any real candidate touches the pilot; not legal advice.** Contents: parties and roles (agency = controller; deployment operator = processor; Cloudflare/Anthropic/Resend = subprocessors with links to their DPAs); lawful basis analysis (legitimate interests + the balancing sketch); the retention table (same rows as privacy.html, plus the mechanism column: cascade purge at interview+30d, lazy on request + manual script); DSR route (who answers, in what timeframe, how erasure is executed — delete-now or `scripts/purge.py`); what the recruiter can and cannot see (decision 3, verbatim); breach contact line.
- **PATTERN**: `docs/epics/` house style — dated, decision-referenced, plain prose
- **VALIDATE**: file exists, referenced from the PR body; owner sign-off flagged as an unchecked box in the doc itself
- **SATISFIES**: epic #16's non-code gate; decision 13

### UPDATE README.md + DEPLOY.md

- **IMPLEMENT**: fix the drift this migration creates, surgically:
  - `README.md:30` "Three tables in D1" → engine's three plus the portal's seven invite-scoped tables (30-day post-interview purge, delete-now); one sentence, dated 28 Jul 2026, referencing #17
  - `README.md:112-117` (the schema-test description) → now a full-schema lockfile: exact columns per table, the cascade chain, the `mode` CHECK; keep the "no candidate table" sentence but scope it to the engine, with the portal's cage stated beside it
  - `DEPLOY.md:223-231` expected-tables list → add the seven portal tables to the expected `sqlite_master` output
- **GOTCHA**: touch only the drifted lines — both files are long and owned by other tickets' prose
- **VALIDATE**: `grep -n "Three tables" README.md` → no match; `grep -c "invite" DEPLOY.md` ≥ 1
- **SATISFIES**: house rule (the client-knowledge-store report's Level 1 included "doc drift: ok")

---

## TESTING STRATEGY

### Unit Tests

`node --test`, zero dependencies, fake-d1 recorded-SQL assertions — bias toward the cases that would let something through (the suite's stated philosophy). New: `test/portal-store.test.js`; updated: `test/schema.test.js` (now a lockfile), `test/store.test.js` (kind filters + invite events).

### Integration Tests

`test/portal-purge.test.js` on real SQLite (`node:sqlite`, Node 24; skips on 20 with a message naming the remedy). Applies both migrations in order onto a populated database, then proves purge and delete-now exactness with mixed-age fixtures. Endpoint + middleware behaviour integration-tested via the Level 4 curl sweep against `wrangler pages dev` (functions are deliberately not importable into the unit suite — `src/store.js:5-6`).

### Edge Cases

- Invite at exactly `interview_at + 30d` → purged (`<=` boundary)
- ALTER lands on a populated `events` table; legacy rows read `kind = 'pack_generated'`
- `attempt.mode = 'shown'` and a fourth `events.kind` → constraint violations (honesty + closed vocabulary at the SQL level)
- Delete-now with a stale/unknown token → still `{ok:true}` (idempotent, truthful: state is clean)
- Delete-now with extra body fields → 400 `unexpected_fields`; cross-origin POST → 403; empty token → 400
- `question.variant_of` self-reference cascades with its parent question
- Purge with zero expired invites → `{purged: 0}`, no error, portal serves normally
- Middleware with unbound `env.DB` or failing purge → privacy page still serves
- `hashToken("")` → `missing_fields`, no db call

---

## VALIDATION COMMANDS

Execute every command to ensure zero regressions and 100% feature correctness.

### Level 1: Syntax & Style

```bash
for f in src/portal/store.js functions/prep/_middleware.js functions/prep/api/delete.js src/store.js; do node --check "$f" || exit 1; done
python3 -m py_compile scripts/purge.py
grep -rn "console.log\|TODO\|FIXME" src/portal/ functions/prep/ && echo "clean these" || echo ok
grep -n "#[0-9a-fA-F]\{3,6\}" public/prep/privacy.html && echo "raw hex — use tokens" || echo ok
```

### Level 2: Unit Tests

```bash
npm test                                                        # Node 20 (machine default): all pass, portal-purge skips
PATH="$HOME/.nvm/versions/node/v24.11.0/bin:$PATH" npm test     # Node 24: all pass INCLUDING portal-purge fixtures
```

### Level 3: Integration Tests

```bash
npm run db:local        # 0001+0002 apply clean (AC #1)
npx wrangler@4.114.0 d1 execute DB -c .wrangler/d1-local.toml --local --persist-to .wrangler/state \
  --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
# expect: agency, attempt, candidate_role, clients, competency, d1_migrations, events, habit, invite, otp, question (+_cf_KV)
```

### Level 4: Manual Validation

```bash
npm run dev   # serves :8788, keep running
# privacy notice served, plain language, retention stated:
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8788/prep/privacy          # 200
curl -s http://localhost:8788/prep/privacy | grep -i "30 days"                        # retention stated
# delete-now endpoint contract:
curl -s -X POST http://localhost:8788/prep/api/delete -H 'Content-Type: application/json' -d '{"token":"anything"}'      # {"ok":true}
curl -s -X POST http://localhost:8788/prep/api/delete -H 'Content-Type: application/json' -d '{"token":"x","extra":1}'   # 400 unexpected_fields
curl -s -X POST http://localhost:8788/prep/api/delete -H 'Content-Type: application/json' -d 'null'                      # 400 bad_json
# lazy purge fires on a portal request: seed an expired invite, hit any /prep/ route, confirm gone:
npx wrangler@4.114.0 d1 execute DB -c .wrangler/d1-local.toml --local --persist-to .wrangler/state \
  --command "INSERT INTO clients (id,name) VALUES ('c-purge','Purge Test'); INSERT INTO invite (id,client_id,token_hash,email,interview_at,expires_at) VALUES ('i-old','c-purge','h1','x@example.com', datetime('now','-40 days'), datetime('now','-26 days'))"
curl -s -o /dev/null http://localhost:8788/prep/privacy
npx wrangler@4.114.0 d1 execute DB -c .wrangler/d1-local.toml --local --persist-to .wrangler/state \
  --command "SELECT COUNT(*) AS remaining FROM invite"            # 0
```

### Level 5: Additional Validation (Optional)

```bash
# after deploy: DEPLOY.md §6 sweep + the deploy verifier
.claude/verify-deploy.sh
curl -s -o /dev/null -w "%{http_code}\n" https://<project>.pages.dev/prep/privacy     # 200 — candidate-reachable, never Access-gated
npm run purge:preview                                             # manual purge script runs against preview D1
```

---

## ACCEPTANCE CRITERIA

From the ticket, verbatim, plus the plan's own gates:

- [ ] AC #1 — migration applies clean on the existing D1 (`npm run db:local` on a database already carrying 0001 + data; fixture test applies 0001 → seeds → 0002)
- [ ] AC #2 — purge deletes exactly the expired invite scope and nothing else, proven with mixed-age fixtures (expired/live/future invites, full scopes, engine tables untouched)
- [ ] AC #3 — delete-now returns the candidate to a clean state (same scope as purge, immediately, idempotently)
- [ ] AC #4 — no table stores anything recruiter-visible about candidate behaviour (schema lockfile: closed `events.kind` vocabulary, no behaviour columns outside the portal cage; `sent_at`/`opened_at` on `invite` are the entire recruiter-visible surface, per decision 3)
- [ ] `attempt.mode` is CHECK-typed to `recall|nudged|revealed` — a revealed attempt can never count as recall (SPEC honesty rule, structural)
- [ ] Privacy notice at `/prep/privacy`: lawful basis, retention table, DSR route, plain language, noindex
- [ ] `invite_sent`/`invite_opened` recordable via `recordInviteEvent`; pack metric (`packs`, `total`) unaffected by invite events
- [ ] Manual purge script runs against preview and production by name
- [ ] Data note drafted (`docs/epics/interview-prep/data-note.md`), flagged for owner sign-off
- [ ] All validation commands pass on Node 20 AND Node 24; no regressions; README/DEPLOY drift fixed

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] All validation commands executed successfully (Levels 1–4; Level 5 if deploying)
- [ ] Full test suite passes on Node 20 and Node 24
- [ ] Schema lockfile proven live (bogus column fails it, then reverted)
- [ ] Manual testing confirms privacy page, delete endpoint, and lazy purge against `wrangler pages dev`
- [ ] Acceptance criteria all met
- [ ] `dossier-design` CHECKLIST.md run against privacy.html
- [ ] PR body says `Closes #17`, links the data note, and names the deliberate schema-test change and why

---

## OPEN QUESTIONS / ASSUMPTIONS

Every mechanical assumption this plan originally carried has been verified on this machine (28 Jul 2026 — see NOTES → "De-risking spike"). What remains is owner-judgement, none of it blocking implementation:

1. **Lawful basis wording** (owner decision, pilot gate — NOT an implementation risk). The plan drafts legitimate interests (Art 6(1)(f)) for the privacy page and data note; the draft ships regardless, the data note carries an explicit unchecked sign-off box, and the epic already gates the pilot — not this ticket — on that sign-off. Whatever the owner decides changes prose in two files, no code.
2. **`invite.status` vocabulary** — left without a CHECK deliberately (columns locked, values not): #20/#22 own the state machine, and a wrongly-guessed CHECK forces another migration. Assumption recorded in the migration comment. If the reviewer prefers a CHECK now, `('sent','opened','expired')` is the plan's suggestion.
3. **`eventCounts` response shape change** — `per_client` rows gain `invites_sent`/`invites_opened`. No consumer of `GET /api/events` exists in `public/` or `src/` (grepped 28 Jul 2026), so this is safe; flagged in case an external curl/dashboard consumes it.

## NOTES (open canvas)

**De-risking spike (28 Jul 2026, pre-implementation).** Every mechanical risk was executed rather than assumed, on this machine:

| # | What was proven | How |
|---|---|---|
| 1 | The exact 0002 DDL applies clean on a populated database | real SQLite (`node:sqlite`, Node 24), 0001 applied first, `clients` + `events` rows inserted BEFORE 0002 |
| 2 | `ALTER TABLE events ADD COLUMN kind` backfills legacy rows with `'pack_generated'` | same run |
| 3 | The purge statement cascades exactly the expired scopes — `-40d` and the exact `-30d` boundary purge (`<=`), `-5d` and `+7d` survive row-for-row | 4 invites, full 7-table scope each, `PRAGMA foreign_keys = ON` |
| 4 | Engine tables (`agency`, `clients`, `events`) untouched by purge and delete-now | same run |
| 5 | `DELETE FROM invite WHERE token_hash = ?` drops one whole scope; second call → `changes = 0`, no error | same run |
| 6 | `mode` CHECK and `kind` CHECK reject bad values at the SQL level | same run |
| 7 | Skip guard: `import("node:sqlite")` → `ERR_UNKNOWN_BUILTIN_MODULE` on default Node 20.20.2; imports under `~/.nvm/versions/node/v24.11.0/bin` (which exists) | direct import test on both |
| 8 | `crypto.subtle.digest` available on Node 20; `hashToken("abc")` vector confirmed `ba7816bf8f01cfea…` | direct run |
| 9 | Two-statement `--command` incl. `SELECT changes()` works under pinned `wrangler@4.114.0` against the local D1 via the generated `.wrangler/d1-local.toml` | direct run |

The spike script's fixture design (seed function, half/quarter count arithmetic, boundary invite D) is the blueprint for `test/portal-purge.test.js` — the test permanently re-proves in CI what the spike proved once.

**Confidence: 9.5/10** for one-pass implementation. The DDL and every lifecycle behaviour are verified verbatim, not designed on paper; all tooling assumptions are executed facts; the remaining half-point is ordinary implementation friction (the schema.test.js restructure is the one genuinely creative task left, and its target state is specified assertion-by-assertion).

**Why widen `events` instead of a new counter table.** The ticket and architecture §4 both say "the existing non-personal event counter gains `invite_sent`/`invite_opened`" — a second table would re-decide an inherited call. `ALTER TABLE ADD COLUMN` was chosen over a table rebuild because it is the minimal parseable form: the lockfile test learns exactly one new statement shape, and a rebuild would still need `ALTER ... RENAME` anyway. The schema test's own comment (line 104-111) names this exact path as the sanctioned one.

**Why `recordInviteEvent` is separate from `recordEvent`.** Keeping `recordEvent` untouched means `functions/api/events.js` and its locked body vocabulary don't change, the existing insert-SQL test survives, and the HTTP surface cannot be used to write invite telemetry (it's recorded server-side by #22's Send and open handlers, which import the store directly).

**Why per-invite open state is NOT in `events`.** `invite.sent_at`/`opened_at` carry the per-candidate recruiter view (decision 3); `events` rows carry only aggregate counts for the sales claim (decision 23). Keeping invite ids out of `events` is what keeps the counter non-personal after purge — counts survive deletion, identities don't. This asymmetry is deliberate and worth a comment in 0002.

**Purge-before-serve.** The middleware awaits the purge rather than `waitUntil`-ing it: an expired invite must not serve data one last time on the request that should have killed it. Cost is one indexed DELETE per portal request — accepted. If latency ever matters, the concession is `waitUntil`, but that is a behaviour change to make in the open.

**Access re-enablement risk (breadcrumb for #20).** When Cloudflare Access returns for recruiter routes, its application scope must exclude `/prep/*` or candidates hit a corporate login wall. `.claude/verify-deploy.sh` will also need a `/prep/privacy` expects-200 row at that point. Deliberately not touched here (Access is deferred; `setup-access.py` is another ticket's file).

**Sequencing within the ticket.** Phases 1→2→3 are strictly ordered; Phase 4's three artefacts (fixture test, purge.py, data note) only need Phase 1 and can run parallel to Phases 2–3 if two loops are available. Single-agent execution: top to bottom as written.

**Rejected: soft delete / tombstones.** Decision 13 says hard delete; a tombstone is candidate data. `{purged: n}` from `meta.changes` is the only trace, and it's a number.

**Rejected: cron via a Worker.** Architecture §4 already decided lazy purge + manual script for the Pages-has-no-cron problem. A scheduled Worker is real infrastructure for a pilot that doesn't need it; the manual script + a calendar reminder covers the zero-traffic window.

## AMENDMENTS

<!-- Append-only after first approval/execution. Newest at the bottom. -->
