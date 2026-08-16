# Feature: Storybank — the candidate's real stories as state, mapped to competencies

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

## Feature Description

A **storybank**: a small set of the candidate's *own* interview stories, each with a title and a
sketch **written in their own words**, each mapped to one or more of the role's competencies. The
stories become **state the drill can point at** — never content the tool writes.

Three consumers of that state ship with it:

1. **The editor** (`/prep/stories`) — create, edit, delete a story; tick which competencies it
   covers. The editor may show the *shape* prompt (situation → action → what changed) as
   **placeholder guidance only**. Nothing drafts, completes, summarises or improves a sketch.
2. **The nudge** — when stories exist, the first help rung is handed the candidate's story
   **titles** so it may ask *"which of your stories fits here?"*. **Sketches never leave the
   candidate's page** — no route reads the `sketch` column except the editor's own.
3. **Targeting** — a top-ranked competency with **no mapped story** is flagged forward-looking
   ("nothing in your stories covers this yet"), never as a gap score, never as a rank.

## User Story

As a **candidate preparing for a confirmed interview**
I want to **write down my own real stories once and say which parts of the job each one covers**
So that **the practice drill can point me at a story I already own instead of me inventing a new
answer under pressure — and so I can see, before the interview, which part of the job I have no
story for yet.**

## Problem Statement

SPEC's [Memorisation](../../docs/epics/interview-prep/SPEC.md) section argues that *a small set of
real stories mapped to several competencies beats a scripted answer per question* — but today that
argument exists only as **advice**, rendered once into a model-written `StoryBankCard` block on the
brief page. The candidate's actual stories are nowhere in the system:

- The drill cannot point at them, so every question is answered from cold recall.
- Targeting cannot tell a competency the candidate has raw material for from one they do not.
- Nothing survives between sessions, so the same story is re-derived every time.

The trap this ticket must not fall into is the obvious one: making the tool *write* the stories.
That is the first unloosenable rule of the spec, and a storybank is exactly where breaking it would
feel most helpful and be most damaging.

## Solution Statement

Two new tables inside the portal's existing invite-scoped retention cage
(`story`, `story_competency` — SPEC Amendment 1's own shape, migration `0012`), five store
functions in `src/portal/store.js`, two candidate routes under `functions/prep/api/`, one new
page under `public/prep/`, one pure targeting helper, and one conditional block in the nudge
prompt.

The design is held together by three structural claims, each asserted by a test rather than
promised by a comment:

- **The tool never writes a story.** `functions/prep/api/stories.js` and
  `functions/prep/api/story.js` import no SDK and no `drill.js` — the same structural argument
  `functions/prep/api/debrief.js:22-24` makes. `SESSION_SYSTEM` gains one rule saying so.
- **A sketch never reaches a model or a recruiter.** The store exposes
  `storyTitlesByRole(db, roleId)` which **selects `title` only** — that is the one function
  `turn.js` may import. `sketch` is selected by exactly one function
  (`storiesByRole`) read by exactly one route (the editor's GET).
- **Nothing crosses the wall.** A reachability scan (`#77`'s idiom, `test/prep-debrief.test.js:643`)
  fails if any file under `functions/` outside `functions/prep/` can reach story content at all.

## Out of Scope / Non-Goals

- **Not included: any generated story content.** No "suggest a story", no sketch autocomplete, no
  summarisation of a sketch, no rewriting into STAR. The shape prompt is a **static placeholder
  string** in `public/prep/stories.js` COPY. (Breaking this is the ticket.)
- **Not included: the story gap on the session page or in the close.** The flag is computed in
  `src/prep/targeting.js` (which is what "targeting flags…" means) and surfaced on
  `/prep/api/stories` GET only. Ticket **#80** (prescriptive session ending + day-before walk-in
  page) already `depends on #78` and owns the session close and the walk-in view — it is the right
  place for a second surface. Two surfaces here means two COPY entries, two render paths and two
  response shapes locked for one acceptance criterion.
- **Not included: stories reaching the brief-generation prompt** (`src/prep/prompt.js`). That prompt
  runs once, server-side, at Send — before the candidate has ever seen the portal. There are no
  stories to send.
- **Not changing: the model-written `StoryBankCard` brief block** (`src/prep/schema.js:51-66`,
  `public/prep/registry.js:334`, `src/prep/strike.js:63`). See "The name collision" below — it is a
  *different thing with a confusingly similar name* and this ticket must not merge, rename or feed
  it.
- **Not changing: `attempt`, `competency`, `question`, the ladder, or the help-rung vocabulary.**
  A story is not an attempt and does not move the ladder.
- **Not included: reordering, tagging, search, or archive of stories.** A capped flat list.

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: Medium–High (~900–1,300 lines incl. tests; six seams, one migration)
**Primary Systems Affected**: D1 schema · `src/portal/store.js` · `src/prep/targeting.js` ·
`src/prep/drill.js` · `functions/prep/api/{stories,story,turn}.js` · `public/prep/stories.{html,js}` ·
`public/prep/prep.css` · four test lockfiles · `DEPLOY.md`
**Dependencies**: none new. No new npm package, no new secret, no new Access application.

## Related Work

**Implements**: [#78](https://github.com/linardsb/saulera-dossier-engine/issues/78)   ·
**Epic**: [#76](https://github.com/linardsb/saulera-dossier-engine/issues/76) — intent
`docs/epics/interview-prep/SPEC.md` **Amendment 1 § Storybank**; architecture
`docs/epics/candidate-portal.architecture.md`; locked constraints
`docs/epics/interview-prep/DECISIONS.md`.

**Back-references** (plans/PRs this builds on and inherits decisions from):

- **PR #77 — the private debrief** (merged, commit `9c0204e`; fixes in `7057b2a`, `5756169`). This
  is the ticket's twin and the single most important thing to read. It established: the migration's
  regime argument, the `X_competency` join-table shape, `upsert + DELETE-then-INSERT` in the store,
  the candidate-route posture, the save-then-re-fetch page controller, the `sentSnapshot`
  race guard, the reachability wall test, and the DEPLOY.md triage row. **Mirror it, do not
  re-invent it.**
- **#67/#68 (compliance passport)** — `functions/prep/compliance/api/items.js` + `item.js` is the
  **resource-shaped** collection/item route split this ticket copies (a checklist and one item of
  it ≡ a storybank and one story of it). `debrief.js:6-8` explicitly names it as the precedent for
  *when* to split.
- **#23 (the drill)** — `src/prep/targeting.js`, `src/prep/drill.js`, `functions/prep/api/turn.js`.

**Forward-references**:

- **#80** — prescriptive session ending + day-before walk-in page. It reads story **titles** for
  the walk-in view and is the right home for a second surface of the story gap. `storyTitlesByRole`
  and `storyGap` are written here for it.

---

## CONTEXT REFERENCES

### Relevant Codebase Files — IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

**The twin ticket — read all five, front to back, first:**

- `migrations/0011_debrief.sql` (all 62 lines) — Why: the migration this one is a sibling of. Every
  paragraph of its header has an analogue here: which regime the tables join and why, why the
  mapping is a join table and not a column, why there is no `updated_at`, the INTEGER-affinity trap.
- `src/portal/store.js` **lines 748-902** (`// ── the private debrief (#77) ──` to EOF) — Why: the
  exact section shape, comment register and SQL idioms to mirror. Note `upsertDebrief`'s
  `RETURNING id` on the conflict path (`:790`) and `setShakyCompetencies`'s
  DELETE-then-INSERT + `ON CONFLICT DO NOTHING` (`:828`) with its stated non-closure.
- `functions/prep/api/debrief.js` (all 232 lines) — Why: the candidate-route template. `ALLOWED`
  vocabulary (`:55`), per-field caps each with its own answer (`:59-67`), the **ownership check
  before any write** (`:185-196`), writes in dependency order with the recovery story stated
  (`:198-224`), the response written as a **literal** never a spread.
- `public/prep/debrief.js` (all 477 lines) — Why: the page-controller template. Module discipline
  (no `document` at module scope), `COPY` object, `el()` helper, `$()` id helper, save-then-refetch,
  `sentSnapshot` (`:198`, `:304`) which is the fix from `7057b2a` — **a storybank sketch is a longer
  thing to lose than a debrief line, so this guard is more load-bearing here, not less.**
- `test/prep-debrief.test.js` **lines 600-762** — Why: the wall. Copy the scan, the comment
  stripper (`:630`), the self-guards (`:653-658`) and the "structurally model-free" test (`:707`).

**The seams this ticket plugs into:**

- `src/prep/targeting.js` **lines 1-16, 22-44, 339-379** — Why: the header states the purity
  contract (no D1, no HTTP, no `node:` imports); `SHAKY_DAMPEN`/`readiness` show how #77 threaded a
  new per-row fact through `drillState`'s **one decoration pass** (`:353-362`); `drillState`'s
  JSDoc is the contract to extend.
- `src/prep/drill.js` **lines 38-68 (`SESSION_SYSTEM`), 105-115 (`NUDGE_SCHEMA`), 260-269
  (`mintNudge`)** — Why: **this is the turn prompt**, not `src/prep/prompt.js` (see Open Questions).
  `mintNudge` is the function that gains the conditional story-titles block.
- `functions/prep/api/turn.js` **lines 119-131 (the help rungs), 183-192 (`shakyIds` read)** —
  Why: the two edits land here; `:187-190` is the precedent comment for reading portal state at the
  point of use rather than at the top of the handler.
- `functions/prep/compliance/api/items.js` **lines 1-30** and `item.js` **lines 1-40** — Why: the
  collection/item route split, and how a candidate write route validates a body key against a known
  set before writing.
- `functions/prep/api/delete.js` **lines 1-7, 36-54** — Why: **the house pattern for a destructive
  candidate action is `POST` with a body, never `onRequestDelete`.** Follow it.
- `src/http.js` (all 59 lines) — Why: `json`, `readJson` (rejects `null`/array bodies with 400
  `bad_json`), `sameOrigin` (mutating methods only), `errorResponse`.
- `src/prep/session.js` — Why: `requireSession(db, request)`, the only door on a candidate route.

**The locks this ticket must move (each is a deliberate, argued edit — never a loosening):**

- `test/schema.test.js` **lines 146-194 (regime lists), 225-296 (`EXPECTED_COLUMNS`), 329-350
  (`CASCADE_CHAIN`)** — Why: exact-table and exact-column lockfile parsed out of `migrations/*.sql`.
- `test/portal-purge.test.js` **lines 37-62 (`PORTAL_TABLES`, `SCOPE_KEY`), 88-133 (`seedInvite`),
  133-141 (`ORDER_BY`), ~156** — Why: the row-for-row cascade proof on real SQLite.
- `test/prep-content.test.js` **lines 38-49 (`CONTENT_PAGES`), 110-131 (the id-drift gate),
  133-144 (the iOS 16px gate), 250-266 (script present), 268-310 (robots/viewport/stylesheet
  chain)** — Why: the redesign-ships-green-and-inert gate. A new content page must join it.
- `DEPLOY.md` **lines ~455-465 (triage table), ~770-800 (the #77 section)** — Why: the operator's
  migration story.

**The name collision — read before writing any comment or test matcher:**

- `src/prep/schema.js` **lines 25, 51-66, 94-95, 318-334** · `public/prep/registry.js`
  **lines 49, 88-91, 327-355** · `src/prep/strike.js` **lines 10, 54-66** — Why: `StoryBankCard` is
  a **model-written brief block** (`prompt` + `covers_competency_ids` + `skeleton`) that already
  carries a competency mapping. The new `story` table is **candidate-written content the tool must
  never write** — semantically the opposite thing under a near-identical name. Consequences:
  (a) the migration header and the store section must name the collision so no future reader merges
  them; (b) the wall test's matcher must use **word boundaries** (`/\bstor(y|ies)\b/i`), which does
  **not** match `StoryBankCard`, and must still self-guard that it sees the real story route.

### New Files to Create

- `migrations/0012_storybank.sql` — `story` + `story_competency`, inside the portal cage.
- `functions/prep/api/stories.js` — `GET` the whole storybank (stories + competencies + the story
  gap) and `POST` a new story.
- `functions/prep/api/story.js` — `POST { action: "save" | "delete", … }` for one story.
- `public/prep/stories.html` — the editor's shell (ids only; every visible string comes from COPY).
- `public/prep/stories.js` — the page controller, `initStories({doc, fetchImpl, navigate})` + `COPY`.
- `test/prep-storybank.test.js` — store + routes + targeting + **the wall**.
- `test/prep-storybank-ui.test.js` — the page controller through `test/helpers/dom.js`.

### Relevant Documentation — YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- `docs/epics/interview-prep/SPEC.md` **§ Amendment 1 → "Storybank"** (lines 23-34) and
  **§ Memorisation** (lines 230-235) and **§ Targeting** (lines 155-167)
  - Why: the amendment *is* the requirement. It names the state shape verbatim
    (`story (id, candidate_role_id, title, sketch, created_at)`,
    `story_competency (story_id, competency_id)`) — implement that shape, do not improve it.
  - Line 65 is load-bearing: the debrief's join table was chosen *because* it is
    "the same shape SPEC Amendment 1 already chose for the storybank's `story_competency`".
- `docs/epics/interview-prep/SPEC.md` **lines 103-111** — the two rules that never loosen. Rule 1
  is this ticket's whole risk surface.
- `docs/epics/interview-prep/DECISIONS.md` **Decision 2** (lines 37-59) — private self-prep, never
  crosses the wall. AC5 is this decision made structural.
- `docs/epics/candidate-portal.architecture.md` **decision 13** (retention) and **decision 22**
  (component vocabulary — where `StoryBankCard` is listed).
- [Cloudflare Pages Functions — routing](https://developers.cloudflare.com/pages/functions/routing/)
  - Specific section: file-based routing. `functions/prep/api/stories.js` → `/prep/api/stories`;
    `public/prep/stories.html` → `/prep/stories`. No registration step exists.
  - Why: confirms no router file needs editing, and that a helper module under `functions/` would
    become a live endpoint (`src/http.js:4-5` states this rule).
- [D1 — foreign keys](https://developers.cloudflare.com/d1/sql-api/foreign-keys/)
  - Specific section: `PRAGMA foreign_keys` is **ON** by default on D1 and **OFF** on plain
    SQLite — `test/helpers/sqlite-d1.js:119` is why every cascade test is honest.
  - Why: the whole retention cage rests on `ON DELETE CASCADE`.
- [Anthropic — structured outputs (`output_config.format`)](https://docs.claude.com/en/docs/build-with-claude/structured-outputs)
  - Why: only if `NUDGE_SCHEMA` is touched. **It should not be** — see Task 9.

### Patterns to Follow

**Comment register.** This codebase's defining property: **every non-obvious line carries the
argument for why it is that way, and names the failure it prevents.** A plain implementation with
thin comments is a *failed* implementation here. Read `migrations/0011_debrief.sql` and match its
density. State what a decision does **not** close, in the open (`store.js:818-822` is the model).

**Migration header shape** (`migrations/0011_debrief.sql:1-30`):

```sql
-- #78 (epic #76): the storybank. SPEC Amendment 1, "Storybank".
--
-- It joins the PORTAL regime and no other: every row hangs off `candidate_role` … [why]
--
-- WHY THE MAPPING IS A JOIN TABLE … [why]
-- WHY THIS IS NOT THE `StoryBankCard` BLOCK … [the collision, named]
```

**Store section shape** (`src/portal/store.js:748-756`): a `// ── the storybank (#78) ──` banner
with the regime argument, then functions each carrying a JSDoc that argues its SQL.

**Route header shape** (`functions/prep/api/debrief.js:1-36`): the method/response contract on line
one, then `⚠ CANDIDATE ROUTE`, then the wall claim, then "ZERO MODEL CALLS, structurally", then the
projection discipline.

**Body vocabulary** (`debrief.js:51-55`, `turn.js:62-64`, `delete.js:31-34`):

```js
const ALLOWED = new Set(["action", "id", "title", "sketch", "competency_ids"]);
const unexpected = Object.keys(body ?? {}).filter((key) => !ALLOWED.has(key));
if (unexpected.length) return json({ error: "unexpected_fields", fields: unexpected }, 400);
```

**Ownership check before any write** (`debrief.js:185-196`): every id-shaped value in the body is
checked against **this role's** rows and a miss is `404`, never a silent skip. Nothing is written
before it passes.

**Response literals, never a spread** (`session.js:17-21`, `debrief.js:32-36`): build the object
field by field. A store row spread into a response ships a column nobody meant to send.

**Error handling** (`src/store.js`'s `StoreError` + `errorResponse`): caller faults are 400/403/404
with a code; a `StoreError` carries its own status; anything else is `500 internal`, which on this
deployment reads as "deployment fault" per DEPLOY.md's triage table — **so a caller-fixable input
must never reach it.**

**Logging** (`turn.js:216`, `debrief.js:223`): log **the error code alone**, never a message that
could quote candidate text. `console.error("stories: …:", err?.code ?? err?.name ?? "unknown")`.

**Page controller** (`public/prep/debrief.js`): `COPY` object exported; `el(doc, tag, className,
content)` helper; `$ = (id) => doc.getElementById(id)`; no `document` at module scope; text nodes
only, never `innerHTML`; nothing in browser storage; nothing candidate-shaped in a URL;
`aria-disabled` not `disabled` on the in-flight button.

**Test skipping** (`test/helpers/sqlite-d1.js:41`): every real-SQLite test carries `{ skip }` so the
suite stays green on Node 20.

---

## IMPLEMENTATION PLAN

### Phase 1: Foundation — schema and store

The two tables, the locks that describe them, and the five store functions. Everything above this
line is unblocked by it and nothing else is.

**Tasks:** migration `0012`; `test/schema.test.js` locks; `test/portal-purge.test.js` cascade proof;
the `// ── the storybank (#78) ──` section in `src/portal/store.js`.

### Phase 2: The pure decision — targeting

**Depends on:** nothing (pure module, no D1). **Independent of:** Phase 1 — can run in parallel in a
second worktree if desired; it takes ids, not rows.

**Tasks:** `storyGap()` in `src/prep/targeting.js` + its unit tests.

### Phase 3: The routes

**Depends on:** Phase 1 (the store functions) and Phase 2 (`storyGap`).

**Tasks:** `functions/prep/api/stories.js`, `functions/prep/api/story.js`, and the wall tests that
govern them.

### Phase 4: The nudge seam

**Depends on:** Phase 1 (`storyTitlesByRole`). **Independent of:** Phase 3.

**Tasks:** `SESSION_SYSTEM` rule 6; `mintNudge`'s conditional block; `turn.js`'s degrading read;
`test/prep-drill.test.js` + `test/prep-turn.test.js` additions.

### Phase 5: The page

**Depends on:** Phase 3 (the routes it calls).

**Tasks:** `public/prep/stories.html`, `public/prep/stories.js`, `prep.css` additions, the two entry
links, `test/prep-content.test.js` and `test/prep-storybank-ui.test.js`.

### Phase 6: Docs and validation

**Depends on:** everything.

**Tasks:** `DEPLOY.md` section + triage row; full suite; manual sweep.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

### Task Format Guidelines

- **CREATE** / **UPDATE** / **ADD** / **REMOVE** / **REFACTOR** / **MIRROR**

---

### CREATE `migrations/0012_storybank.sql`

- **IMPLEMENT**: two tables, mirroring SPEC Amendment 1's stated shape exactly.

  ```sql
  CREATE TABLE story (
    id                TEXT PRIMARY KEY,
    candidate_role_id TEXT NOT NULL REFERENCES candidate_role(id) ON DELETE CASCADE,
    title             TEXT NOT NULL,
    sketch            TEXT NOT NULL DEFAULT '',
    created_at        TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX story_by_role ON story (candidate_role_id);

  CREATE TABLE story_competency (
    story_id      TEXT NOT NULL REFERENCES story(id) ON DELETE CASCADE,
    competency_id TEXT NOT NULL REFERENCES competency(id) ON DELETE CASCADE,
    PRIMARY KEY (story_id, competency_id)
  );
  CREATE INDEX story_competency_by_competency ON story_competency (competency_id);
  ```

  With a header that argues, in `0011_debrief.sql`'s register:
  - **Which regime, and why.** Both hang off `candidate_role` → `invite`, so decision 13's two
    erasures take them in one statement. No separate retention rule, no tombstone.
  - **Why `candidate_role_id` is NOT UNIQUE here** — the one deliberate divergence from `debrief`.
    A role has *many* stories; the debrief has exactly one row because it is one note, this is a
    collection. That is why there is a `story_by_role` index and why the routes are
    collection/item shaped rather than an upsert.
  - **Why the mapping is a join table** — SPEC line 65 already decided it, and targeting must read
    "does a story cover this competency" **deterministically, with no model call**.
  - **Why the composite primary key** — the pair IS the fact; it is what lets the store's INSERT
    carry `ON CONFLICT DO NOTHING` so two saves interleaving cannot raise a constraint error
    (`0011_debrief.sql:49-56`).
  - **Both parents cascade** — a story's ticks die with the story, and a competency that vanishes
    under a re-handover takes its ticks rather than leaving a dangling row that would make a
    covered competency look uncovered.
  - **THE NAME COLLISION, named.** `StoryBankCard` (`src/prep/schema.js:51`) is a *model-written*
    brief block. This table is *candidate-written content the tool must never write*. They are not
    the same thing and must never be merged; a future reader who conflates them will feed a sketch
    to the model.
  - **No `updated_at`** — nothing renders one and `test/schema.test.js` locks columns exactly.
  - **Nothing here is numeric**, which keeps the INTEGER-affinity trap (`store.js:144-155`) out of
    reach — deliberate, not incidental.
- **PATTERN**: `migrations/0011_debrief.sql` (whole file).
- **IMPORTS**: n/a (SQL).
- **GOTCHA**: **0011 is taken** by the merged debrief (`9c0204e`). The epic's coordination note
  ("first merged takes 0011") is already resolved — this is 0012, no rebase needed. · Applied
  migrations are **never edited**; a new table arrives in a new file. · `test/schema.test.js:43`
  concatenates *every* `.sql` file in sorted order, so the number decides apply order.
- **VALIDATE**: `node --test test/schema.test.js` (fails until the next task — expected) and
  `python3 -c "import sqlite3;d=sqlite3.connect(':memory:');[d.executescript(open(f).read()) for f in sorted(__import__('glob').glob('migrations/*.sql'))];print('applies clean')"`
- **SATISFIES**: AC #1 (state), AC #4 (purge — structurally).

---

### UPDATE `test/schema.test.js`

- **IMPLEMENT**: four edits, each with the argument written in the comment (this file is a
  lockfile — an edit here is a decision made in the open):
  1. `PORTAL_TABLES` (`:156`) gains `"story"` and `"story_competency"` (alphabetical), with a
     comment in `:146-155`'s register: they join the **portal** regime because they hang off
     `candidate_role`, not the compliance cage's 12-month one — a candidate's own stories must die
     with the invite the privacy page promised they would.
  2. The test name at `:183` and its message: "the portal's **nine**" → "**eleven**"; "an
     **eighteenth** table" → "a **twentieth** table".
  3. `EXPECTED_COLUMNS` (`:225`) gains, with `:248-259`'s comment density:
     ```js
     story: ["candidate_role_id", "created_at", "id", "sketch", "title"],
     story_competency: ["competency_id", "story_id"],
     ```
     Note in the comment: **no `updated_at`**, **no `order`/`position`** (a flat capped list), and
     **`sketch` is the one column in the portal cage that no other route may select** — that
     property is asserted in `test/prep-storybank.test.js`, named here so a future column rename
     reads why.
  4. `CASCADE_CHAIN` (`:329`) gains:
     ```js
     story: { candidate_role_id: "candidate_role" },
     story_competency: { story_id: "story", competency_id: "competency" },
     ```
- **PATTERN**: the `debrief` entries added by #77 at `:154`, `:248-259`, `:338-343`.
- **IMPORTS**: none.
- **GOTCHA**: `columns()` (`:69`) filters `PRIMARY`/`UNIQUE` as table-level keywords, so the
  composite PK is invisible to the column lock — if you want it asserted, add a `bodyOf`-based test
  like `:368` does for `candidate_role.invite_id`. · The candidate-shaped regex at `:202`
  (`/candidate|^cv$|resume|\bpack\b|brief/i`) runs over **engine** tables only — `story.
  candidate_role_id` is fine.
- **VALIDATE**: `node --test test/schema.test.js`
- **SATISFIES**: AC #1, AC #4.

---

### UPDATE `test/portal-purge.test.js`

- **IMPLEMENT**: prove the cascade row-for-row on real SQLite.
  1. `PORTAL_TABLES` (`:37`) gains `"story"`, `"story_competency"`.
  2. `SCOPE_KEY` (`:52`) gains `story: (r) => r.candidate_role_id` and
     `story_competency: (r) => r.story_id` — fixture ids must therefore embed the invite letter
     (`story-A-1`), so `inviteOf`'s `.split("-")[1]` keeps working. **Check it**: `"story-A-1".
     split("-")[1] === "A"` ✓.
  3. `seedInvite` (`:88`) gains **two** stories: one mapped to both competencies, one mapped to
     none (an unmapped story is a real state the candidate leaves behind — it must cascade too),
     plus the `story_competency` rows. Update the doc-comment's row arithmetic
     `1+1+2+2+3+1+1+1+2` → `+2+2`.
  4. `ORDER_BY` (`:137`) gains `story_competency: "story_id, competency_id"` with `:133-136`'s
     argument restated: no `id` column, and SQLite's implicit rowid is not stable across a
     re-insert.
  5. The table list at `:156` gains both names.
- **PATTERN**: the `#77` additions at `:60-61`, `:118-130`, `:137`.
- **IMPORTS**: none new.
- **GOTCHA**: the fixture story ids must **embed the invite letter** (`story-A-1`, `story-A-2`) and
  must not be uuids — `inviteOf` is `SCOPE_KEY[table](row).split("-")[1]`, so a uuid gives `undefined`
  and the scope assertions compare nothing. The `story_competency` rows key off `story_id`, so they
  inherit the letter for free. · this file has its **own** `openMigrated` (`:78`) that applies `0001`, seeds
  `clients`+`events`, then applies the rest by **enumeration** — it already picks up `0012` for
  free. Do not hardcode a filename. · `{ skip }` on every test.
- **VALIDATE**: `node --test test/portal-purge.test.js`
- **SATISFIES**: AC #4.

---

### ADD the storybank section to `src/portal/store.js`

- **IMPLEMENT**: append a `// ── the storybank (#78) ──` banner section after the debrief section
  (EOF), with the regime + wall argument in `:748-755`'s register, then five functions:

  ```js
  /** Every story on this role, newest last, WITH sketches — the editor's read and the only one. */
  export async function storiesByRole(db, roleId)
  //  SELECT id, title, sketch, created_at FROM story WHERE candidate_role_id = ? ORDER BY created_at, id

  /** Every (story_id, competency_id) pair on this role — the editor's ticks and targeting's cover set. */
  export async function storyCompetenciesByRole(db, roleId)
  //  SELECT sc.story_id, sc.competency_id FROM story_competency sc
  //    JOIN story s ON s.id = sc.story_id
  //   WHERE s.candidate_role_id = ? ORDER BY sc.story_id, sc.competency_id

  /** The TITLES only. The one function a model-facing caller may import. */
  export async function storyTitlesByRole(db, roleId)
  //  SELECT title FROM story WHERE candidate_role_id = ? ORDER BY created_at, id
  //  → returns string[]

  /** A new story. The id is MINTED HERE and never taken from a caller. */
  export async function createStory(db, { roleId, title, sketch })
  //  INSERT INTO story (id, candidate_role_id, title, sketch) VALUES (?, ?, ?, ?)  → { id }

  /** Edit one story, ROLE-SCOPED IN THE SQL so a foreign id updates nothing. */
  export async function updateStory(db, { roleId, storyId, title, sketch })
  //  UPDATE story SET title = ?, sketch = ? WHERE id = ? AND candidate_role_id = ?
  //  → { updated: changes === 1 }

  /** Replace one story's whole tick set — setShakyCompetencies's idiom, story-scoped. */
  export async function setStoryCompetencies(db, { storyId, competencyIds })

  /** Delete one story, scoped to the role so a foreign id deletes nothing. */
  export async function deleteStory(db, { roleId, storyId })
  //  DELETE FROM story WHERE id = ? AND candidate_role_id = ?  → { deleted: changes === 1 }
  ```

  **Why create and update are two functions and not one upsert** — the single most important
  decision in this section, and the one place this ticket deliberately diverges from `upsertDebrief`
  (`store.js:790`). A `saveStory` shaped as `INSERT … ON CONFLICT (id) DO UPDATE` would take the
  **id from the request body** as its conflict target. A body id belonging to another invite then
  either **overwrites that candidate's story** or inserts a row under this role carrying a foreign
  id — and the only thing standing between those and a real caller would be a membership check the
  route runs in a *separate statement on a database with no transaction*. The debrief has no such
  exposure because its conflict target is `candidate_role_id`, which comes from the **session**, not
  the body. Splitting the two puts the ownership check **inside the WHERE clause**, where no
  ordering, no race and no future refactor of the route can bypass it. `deleteStory` already had
  this shape; `updateStory` matches it.

  Each carries a JSDoc that argues its SQL. The four that matter most:
  - **`storyTitlesByRole`** — the JSDoc must say, in bold terms, *why it exists as a separate
    function*: `sketch` is the candidate's own words and **must never reach a model prompt or a
    log line**. A caller reaching for `storiesByRole` in a model-facing path is the leak; this
    function has no `sketch` to leak. `test/prep-storybank.test.js` asserts the SQL selects only
    `title`, and asserts `turn.js` imports this one and not the other.
  - **`createStory` / `updateStory`** — see the boxed argument above. `createStory` mints the id
    with `crypto.randomUUID()` and takes none from a caller; `updateStory` carries
    `AND candidate_role_id = ?` and returns `{updated}` so the route answers `404` on `false`.
    Neither is an upsert, and the JSDoc must say why in those terms — a future reader who
    "simplifies" them back into one `ON CONFLICT (id)` statement re-opens a cross-invite write.
  - **`setStoryCompetencies`** — DELETE-then-INSERT with `ON CONFLICT DO NOTHING`, and the same
    honest non-closure `:818-822` states: a failure between the two leaves the set **empty, not
    stale**; the page re-fetches and re-ticking is one tap per box.
  - **`deleteStory`** — the `AND candidate_role_id = ?` is the ownership check **in the SQL**, so a
    story id from another invite deletes nothing and the route answers 404 on `deleted === false`.
    `story_competency` goes with it by cascade — never a second DELETE.
- **PATTERN**: `src/portal/store.js:748-902` verbatim in shape. `requireFields` (`:79`) for
  non-empty guards.
- **IMPORTS**: none new (`StoreError` already imported at `:17`).
- **GOTCHA**: **never `SELECT *`** (`:271-280`'s discipline). · No D1 `batch` — the test fake
  cannot drive it (`:498-502`). · Every value is a **bound parameter**; nothing interpolated. ·
  `requireFields` rejects blanks, so `sketch` (legitimately `''`) must **not** be in its argument
  object — only `roleId` and `title`.
- **VALIDATE**: `node --test test/prep-storybank.test.js` (store half — written in the next task)
- **SATISFIES**: AC #1, AC #2 (the titles-only seam), AC #5.

---

### CREATE `test/prep-storybank.test.js` — the store half

- **IMPLEMENT**: a header in `test/prep-debrief.test.js:1-24`'s register naming the classes of
  failure this file catches:
  - a story that **outlives its invite**;
  - a sketch that **reaches a model prompt** (the titles-only seam);
  - a tick set that **does not round-trip** across an edit;
  - a story from another invite that a body id can **edit or delete**;
  - **the wall** (AC5).

  Then, using `openMigrated()` + `d1Shape()` + `seed()` (copy `prep-debrief.test.js:76-89`'s seeder
  verbatim — it goes through production writers so ids are the real `${roleId}:${slug}` shape):
  - `createStory` mints an id; `updateStory` edits that same row and the ticks survive the edit.
  - **`updateStory` and `deleteStory` with a story id belonging to a *second* seeded invite return
    `{updated: false}` / `{deleted: false}` and leave BOTH rows byte-identical.** This is the
    cross-invite write test; seed two invites for it.
  - `setStoryCompetencies` replaces the whole set; unticking everything really empties it.
  - `storyTitlesByRole` returns titles in `created_at, id` order and **its result contains no
    sketch text** — assert with a sentinel string that exists only in the sketch.
  - `deleteStory` for a story under a **different** role returns `{deleted: false}` and deletes
    nothing; the right one deletes it **and** its `story_competency` rows (cascade).
  - deleting the invite erases both tables (the store-level half of AC4).
  - a competency deleted out from under a story removes only the tick.
- **PATTERN**: `test/prep-debrief.test.js:92-160`.
- **IMPORTS**: `{ at, d1Shape, openMigrated, skip } from "./helpers/sqlite-d1.js"`; the store
  functions; `mintToken, SESSION_COOKIE` from `src/prep/tokens.js`.
- **GOTCHA**: `{ skip }` on **every** database test. · `test/helpers/fake-d1.js` returns
  `{changes: 1}` unconditionally and enforces nothing — every assertion here branches on a real
  constraint, so it must be real SQLite (`fake-d1.js:3-5`).
- **VALIDATE**: `node --test test/prep-storybank.test.js`
- **SATISFIES**: AC #1, AC #4.

---

### ADD `storyGap()` to `src/prep/targeting.js`

- **IMPLEMENT**: one exported pure function, placed next to `drillState` at the foot of the file:

  ```js
  /**
   * SPEC Amendment 1: "targeting may flag a top-ranked competency no story covers."
   *
   * The highest-ranked competency with NO story mapped to it, or null. Rank order is
   * rankCompetencies' own, so this is the same list targeting would drill from — which is what
   * makes the flag forward-looking ("this is coming up and you have no raw material") rather
   * than a gap score. NOTHING NUMERIC LEAVES: {id, label}, never a rank, a position, a count of
   * uncovered competencies, or a readiness. The page writes the sentence.
   *
   * `coveredIds` is the set of competency ids with at least one story — the store's
   * story_competency rows, deduped by the caller.
   */
  export function storyGap({ ranked, coveredIds = [] }) {
    const covered = new Set(coveredIds);
    const found = (ranked ?? []).find((c) => !covered.has(c.id));
    return found ? { id: found.id, label: found.label } : null;
  }
  ```
- **PATTERN**: `closePayload`'s `asLabel` (`:273`) — "everything candidate-bound here is
  `{id, label}` or text — never a stage, a rate, or an importance".
- **IMPORTS**: none (pure, and the header's contract forbids D1/HTTP/`node:`).
- **GOTCHA**: **do not** return a list, a count, or "3 of 5 covered" — that is a gap **score**, which
  AC3 forbids and which SPEC's ladder rule ("show movement, not a rank") forbids twice. · With **no
  stories at all**, this returns the top-ranked competency, which is correct: the honest first
  prompt on an empty storybank. · With every competency covered it returns `null`.
- **VALIDATE**: `node --test test/prep-targeting.test.js`
- **SATISFIES**: AC #3.

---

### ADD `storyGap` tests to `test/prep-targeting.test.js`

- **IMPLEMENT**: four cases — empty cover set returns `ranked[0]`; a fully-covered list returns
  `null`; the gap skips covered competencies and picks the highest-ranked uncovered one; the
  return carries **only** `id` and `label` (`assert.deepEqual(Object.keys(gap).sort(), ["id",
  "label"])` — the assertion that stops a rank leaking later).
- **PATTERN**: the existing ranking tests in that file.
- **IMPORTS**: `storyGap` from `../src/prep/targeting.js`.
- **GOTCHA**: no `{ skip }` — this module is pure, no SQLite.
- **VALIDATE**: `node --test test/prep-targeting.test.js`
- **SATISFIES**: AC #3.

---

### CREATE `functions/prep/api/stories.js`

- **IMPLEMENT**:

  ```
  GET  /prep/api/stories -> 200 { stories: [{id, title, sketch, competency_ids}],
                                  competencies: [{id, label}],
                                  story_gap: {id, label} | null,
                                  max_stories: 12 }
  POST /prep/api/stories { title, sketch, competency_ids } -> 200 { ok: true, id }
  ```

  - Header in `debrief.js:1-36`'s shape: the contract, `⚠ CANDIDATE ROUTE` (Access-bypassed tree,
    `requireSession` is the door, middleware already purged), **⚠ IT NEVER CROSSES THE WALL**
    (decision 2, asserted as reachability in `test/prep-storybank.test.js`), **ZERO MODEL CALLS,
    structurally** (this file imports no SDK — that is what makes "the tool never writes a story"
    un-regressable rather than merely true today), and the projection discipline (competencies come
    back as `{id, label}` — never `importance`, `stage`, `success_rate`).
  - **No availability gate.** Unlike the debrief there is no date test: a storybank is most useful
    *before* the interview. Say so in the header so nobody adds one by analogy.
  - GET: `requireSession` → `roleByInviteId` (404 if no handover) → `competenciesByRole`,
    `storiesByRole`, `storyCompetenciesByRole` → `drillState({competencies, questions: [],
    attempts: [], interviewAt: role.interview_at})` **or**, better and cheaper,
    `rankCompetencies` + `shakyCompetencyIds` + the stored `stage`/`success_rate` the rows already
    carry. **Choose `rankCompetencies` directly** — `drillState` would pull the whole question and
    attempt log for a page that drills nothing. Decorate with `shaky` the same way `drillState`
    does (`:353-362`), because a shaky competency ranks differently and the gap must agree with
    what the drill will actually serve. Then `storyGap({ranked, coveredIds})`.
  - POST: `sameOrigin` → `ALLOWED = new Set(["title", "sketch", "competency_ids"])` → caps → session
    → role → `storiesByRole` length check against `MAX_STORIES` → ownership check on every
    `competency_ids` entry against this role's list (404 on a miss) → `createStory` →
    `setStoryCompetencies`. Writes in dependency order with the recovery story stated: a crash
    between them leaves the story saved and its ticks missing, which the next save fixes.
    **This route creates and never updates**: it accepts no `id` at all, which is why `ALLOWED`
    has three keys and none of them is one.
  - Caps, each its own answer, each with the reasoning in the comment:
    `MAX_STORIES = 12` (SPEC: "a small set"), `TITLE_MAX = 120` (a title said aloud, not a
    paragraph), `SKETCH_MAX = 2_000` (`FIX_MAX`'s argument: a couple of paragraphs, past any real
    sketch, far short of a document). A blank `title` is `400 missing_fields`; a blank `sketch` is
    **legal** (a title-only story is a real half-written state, and the page is resumable).
- **PATTERN**: `functions/prep/api/debrief.js` (whole file);
  `functions/prep/compliance/api/items.js:44-80` for the collection GET.
- **IMPORTS**:
  ```js
  import { roleByInviteId, competenciesByRole, storiesByRole, storyCompetenciesByRole,
           createStory, setStoryCompetencies, shakyCompetencyIds } from "../../../src/portal/store.js";
  import { requireSession } from "../../../src/prep/session.js";
  import { rankCompetencies, storyGap } from "../../../src/prep/targeting.js";
  import { json, readJson, sameOrigin, errorResponse } from "../../../src/http.js";
  ```
- **GOTCHA**: **no `sameOrigin` on the GET** (`src/http.js:41-43`). · The response must be a
  **literal** — never spread a store row. · `MAX_STORIES` is returned so the page names the real
  limit in its refusal copy rather than mirroring a constant that can drift (`debrief.js:45-52`
  chose mirroring; returning it is strictly better and worth the one field — state the choice in
  the comment). · Do **not** import `@anthropic-ai/sdk` or `drill.js`; a test asserts it.
- **VALIDATE**: `node --test test/prep-storybank.test.js`
- **SATISFIES**: AC #1, AC #3, AC #5.

---

### CREATE `functions/prep/api/story.js`

- **IMPLEMENT**:

  ```
  POST /prep/api/story { action: "save",   id, title, sketch, competency_ids } -> 200 { ok: true, id }
  POST /prep/api/story { action: "delete", id }                                -> 200 { ok: true }
  ```

  - `ALLOWED = new Set(["action", "id", "title", "sketch", "competency_ids"])`, and **the two
    vocabularies never cross** — on `action: "delete"`, any of `title`/`sketch`/`competency_ids`
    present is `400 unexpected_fields`. That is `turn.js:86-100`'s rule, and the header should cite
    it: a field carrying two meanings is how a delete quietly becomes a save.
  - `POST`, never `onRequestDelete`: `functions/prep/api/delete.js:6-7` is the house pattern — a
    destructive action reachable by URL-click gets prefetched by mail scanners, and the whole
    portal's mutation surface is POST-with-a-body.
  - **Ownership lives in the SQL, not in a preceding statement.** Both writes are role-scoped:
    `updateStory` and `deleteStory` carry `AND candidate_role_id = ?` and report
    `{updated}`/`{deleted}`; `false` → `404 not_found`, and **nothing was written**. Do not
    reintroduce a read-then-write membership check — there is no transaction on D1, and a check in a
    separate statement is bypassable in a way a WHERE clause is not. This is the security-relevant
    property of the file, and the header should say so.
  - The tick set is still replaced after a successful `updateStory` — and **only** after: an update
    that matched no row must not go on to write ticks against a story id this candidate does not own.
  - Same caps as `stories.js`. Import them from one place or restate them with a comment saying
    which file owns them — do not silently duplicate three numbers.
- **PATTERN**: `functions/prep/compliance/api/item.js` (the item half of the split);
  `functions/prep/api/turn.js:86-103` (two vocabularies, one POST).
- **IMPORTS**: `updateStory`, `deleteStory`, `setStoryCompetencies`, `competenciesByRole`,
  `roleByInviteId`, `requireSession`, the `src/http.js` four. **Not** `createStory` (creation is the
  collection route's), and **not** `rankCompetencies`/`storyGap` (this route returns no gap — the
  page re-fetches the collection after every write, `passport.js`'s rule).
- **GOTCHA**: `readJson` already rejects `null`/array bodies with `400 bad_json`
  (`src/http.js:24-33`) — do not re-guard. · Answer `{ok: true}` and nothing else on delete; the
  page re-fetches.
- **VALIDATE**: `node --test test/prep-storybank.test.js`
- **SATISFIES**: AC #1.

---

### ADD the route + wall tests to `test/prep-storybank.test.js`

- **IMPLEMENT**:
  - **Route behaviour**: GET with no session → 401; GET with no handover → 404; GET returns
    `{id, label}` competencies with **no** `importance`/`stage`/`success_rate`
    (`assert.deepEqual(Object.keys(c).sort(), ["id","label"])`); POST creates and the GET
    round-trips it; POST a 13th story → `400 too_long`; POST with a `competency_ids` entry from
    another invite → `404`; POST `{status: "x"}` → `400 unexpected_fields`; `story.js` delete of a
    foreign id → `404` and the row survives; `action: "delete"` with a `title` → `400`.
  - **The gap**: seed two competencies, map a story to the top-ranked one, assert `story_gap` names
    the other; map both, assert `null`.
  - **THE WALL (AC5)** — copy `test/prep-debrief.test.js:600-733` and adapt:
    ```js
    const STORY_STORE_FNS = ["storiesByRole", "storyCompetenciesByRole", "storyTitlesByRole",
                             "createStory", "updateStory", "setStoryCompetencies", "deleteStory"];
    // Word boundaries: /\bstor(y|ies)\b/i does NOT match `StoryBankCard`, which is the
    // model-written brief block and a legitimate mention. Verify that with a unit assertion so
    // the matcher's own blind spot is a failure and not silence.
    ```
    - self-guard: the scan matched **something**, and it can see `functions/prep/api/stories.js`;
    - assert the matcher does **not** flag the string `"StoryBankCard"` (the collision, made a test);
    - `outside = mentions.filter(p => !p.startsWith("functions/prep/"))` must be `[]`;
    - **the sketch seam**: `functions/prep/api/turn.js` must not contain `sketch` or
      `storiesByRole`, and **must** contain `storyTitlesByRole` — the reachability form of "sketches
      do not leave the candidate's page";
    - **the store SQL**: `storyTitlesByRole`'s source selects `title` and does not mention `sketch`;
    - **structurally model-free**: neither `stories.js` nor `story.js` matches
      `/from\s+["'][^"']*(@anthropic-ai\/sdk|drill\.js)["']/` (`prep-debrief.test.js:707`);
    - `src/store.js` (the recruiter/engine store) mentions no story function.
- **PATTERN**: `test/prep-debrief.test.js:600-762`.
- **IMPORTS**: `readdirSync, readFileSync` from `node:fs`; the two route modules.
- **GOTCHA**: the comment stripper must strip **block** comments and **line-leading** `//` only —
  stripping a mid-line `//` would cut string literals and hide a real reference
  (`prep-debrief.test.js:607-613`). · Every scan needs its self-guard, or it passes vacuously.
- **VALIDATE**: `node --test test/prep-storybank.test.js`
- **SATISFIES**: AC #5.

---

### UPDATE `src/prep/drill.js` — the rule and the conditional block

- **IMPLEMENT**: two edits.
  1. `SESSION_SYSTEM` gains **rule 6**, worded so the grep tests can pin it:
     ```
     6. The candidate's stories are theirs. You may be shown the TITLES of stories they have
        written down, so you can ask which one fits — you have not read them. Never write,
        complete, summarise, improve or guess at a story's content, and never suggest a story
        they have not told you they have.
     ```
     Add a comment above `SESSION_SYSTEM` noting that this rule is rule 1 wearing a different coat
     (SPEC Amendment 1's own phrasing) and that `test/prep-drill.test.js` greps for it.
  2. `mintNudge(client, { question, competencyLabel, storyTitles = [] })` — the block is
     **conditional and absent entirely when the set is empty**:
     ```js
     const stories = storyTitles.length
       ? `\nThe candidate has written down these stories of their own, by title only:\n` +
         `<story_titles>\n${storyTitles.map((t) => `- ${t}`).join("\n")}\n</story_titles>\n` +
         `You may point at one and ask whether it fits here. You have the titles and nothing ` +
         `else — never describe, summarise or extend what is in one.\n`
       : "";
     ```
     Slotted between the question and the closing instruction. `NUDGE_SCHEMA` and `assertNudge` are
     **unchanged**: a nudge is still one content-free string, and the structural safety rail
     (`drill.js:15-19`) already makes "a finished answer" unrepresentable.
- **PATTERN**: `engagementBlock` in `src/prep/prompt.js:96-110` — a conditional block, rendered per
  call, never folded into the cached system prompt.
- **IMPORTS**: none new.
- **GOTCHA**: **empty must mean absent**, not an empty `<story_titles>` block — otherwise every
  existing nudge's prompt changes shape and `test/prep-drill.test.js`'s greps shift under a feature
  nobody enabled. · Cap the list before it reaches here (the route caps at `MAX_STORIES = 12`, so
  the prompt is bounded by construction — say so in the comment). · **Titles only.** If you find
  yourself passing a story object, stop: the seam is `storyTitlesByRole`, which has no sketch to
  pass.
- **VALIDATE**: `node --test test/prep-drill.test.js`
- **SATISFIES**: AC #2.

---

### UPDATE `test/prep-drill.test.js`

- **IMPLEMENT**: three assertions.
  - `SESSION_SYSTEM` matches `/stories are theirs/` and `/never write, complete, summarise/i` — the
    prompt-level rule AC2 asks for.
  - `mintNudge` with `storyTitles: ["The escalation on nights"]` puts the **title** in the prompt
    and the words "titles and nothing else"; with `storyTitles: []` the prompt contains
    **no** `story_titles` substring at all.
  - A sentinel sketch string handed nowhere near this function never appears — i.e. assert
    `mintNudge`'s signature takes `storyTitles` and there is no `sketch` identifier anywhere in
    `src/prep/drill.js` (a source grep, `prep-debrief.test.js:707`'s idiom).
- **PATTERN**: `test/prep-drill.test.js:102-134`.
- **IMPORTS**: none new.
- **GOTCHA**: the existing loop at `:102` greps **both** `SESSION_SYSTEM` and `PREP_SYSTEM` for
  rules 1–2 — do **not** add rule 6 to `PREP_SYSTEM` (there are no stories at Send time) and do not
  extend that loop.
- **VALIDATE**: `node --test test/prep-drill.test.js`
- **SATISFIES**: AC #2.

---

### UPDATE `functions/prep/api/turn.js` — the degrading read

- **IMPLEMENT**: in the `action === "help"` branch (`:123-131`), read the titles **only for the
  nudge rung** and degrade on failure:

  ```js
  if (body.rung === "nudge") {
    // The candidate's own story titles (#78), so the nudge may ask which of them fits. TITLES
    // ONLY — `storyTitlesByRole` selects no sketch, which is what makes "sketches do not leave
    // the candidate's page" a property of the query rather than a promise about this file.
    //
    // WRAPPED, and the trade is stated rather than left to be discovered. #77's shaky read is
    // deliberately unwrapped and takes the whole drill down when 0011 is unapplied (DEPLOY.md's
    // triage row) — because a ticked competency changes what is DRILLED. A story title only
    // changes what a nudge may point at, and a nudge without them is an ordinary good nudge. The
    // loud signal for a missing 0012 is /prep/api/stories, which is the feature's own route and
    // 500s plainly. Taking the drill down for an optional prompt line would be the worse trade.
    let storyTitles = [];
    try {
      storyTitles = await storyTitlesByRole(env.DB, role.role_id);
    } catch (err) {
      console.error("turn: story titles unavailable:", err?.code ?? err?.name ?? "unknown");
    }
    const { nudge } = await mintNudge(client, { ...inputs, storyTitles });
    return json({ nudge });
  }
  ```
- **PATTERN**: the degrade-never-discard block at `turn.js:213-218` and `debrief.js:218-224`; the
  read-at-point-of-use comment at `turn.js:187-190`.
- **IMPORTS**: add `storyTitlesByRole` to the existing `src/portal/store.js` import list (`:36-47`).
  **Do not import `storiesByRole`** — a test forbids it.
- **GOTCHA**: the `reveal` rung gets **nothing** — a skeleton of headings is already the structural
  answer and story titles there would push it toward "use your story about X", which is content. ·
  The response shape is unchanged: `{ nudge }`, still one string.
- **VALIDATE**: `node --test test/prep-turn.test.js && node --test test/prep-storybank.test.js`
- **SATISFIES**: AC #2.

---

### ADD a turn-route test to `test/prep-turn.test.js`

- **IMPLEMENT**: with a fake Anthropic client capturing the prompt (that file's existing pattern):
  a `help`/`nudge` turn on a role with two stories puts both **titles** in the prompt and **no**
  sketch text (sentinel); the same turn on a role with no stories contains no `story_titles`; and —
  the DEPLOY-behaviour assertion — a turn against a database where `story` does not exist still
  answers `200` with a nudge.
- **PATTERN**: the existing help-rung tests in `test/prep-turn.test.js`.
- **IMPORTS**: none new.
- **GOTCHA**: `{ skip }` on the SQLite-backed ones. · For the missing-table case, `DROP TABLE
  story_competency; DROP TABLE story;` after `openMigrated()` is the cheapest honest setup.
- **VALIDATE**: `node --test test/prep-turn.test.js`
- **SATISFIES**: AC #2.

---

### CREATE `public/prep/stories.html`

- **IMPLEMENT**: `debrief.html`'s skeleton exactly — `<!doctype html>`, `lang="en-GB"`,
  `<meta name="robots" content="noindex, nofollow">`, `<meta name="viewport"
  content="width=device-width, initial-scale=1">` (**no** `maximum-scale`, **no**
  `user-scalable`), the **four-sheet chain in order** `/fonts.css`, `/tokens.css`, `/app.css`,
  `/prep/prep.css` and **no fifth**, the candidate `topbar`, the `prep-footer` privacy link, and a
  module script that imports `initStories` and calls it.

  Ids (every one reached by `$()` in the controller; **no copy in the markup** — the controller
  writes every visible string):
  `stories-state` (`<p class="save-state" role="status">`), `private-note`, `unavailable`,
  `unavailable-note`, `story-gap`, `stories-list`, `editor`, `title-label`, `title` (an
  `<input class="input">`), `title-caption`, `sketch-label`, `sketch` (a
  **`<textarea class="textarea">`** — the 16px iOS floor), `sketch-caption`, `covers-label`,
  `covers-caption`, `covers-list`, `save`, `cancel`, `add-story`.
- **PATTERN**: `public/prep/debrief.html` (all 94 lines).
- **IMPORTS**: n/a.
- **GOTCHA**: **no inline `<style>` block** — `chrome.test.js` does not sweep this page and
  `prep-content.test.js:312` fails on one. · The `textarea` class on `#sketch` is **load-bearing**,
  not decorative (iOS Safari zooms the viewport on a focused control under 16px) and is gated. ·
  Both sections start `hidden`.
- **VALIDATE**: `node --test test/prep-content.test.js`
- **SATISFIES**: AC #1.

---

### CREATE `public/prep/stories.js`

- **IMPLEMENT**: `initStories({ doc, fetchImpl, navigate })` returning `{ state, save, remove,
  render, ready }`, plus an exported `COPY`. Mirror `public/prep/debrief.js` decision for decision,
  and carry its four-point header (nothing in browser storage; nothing candidate-shaped in a URL;
  text nodes only; module discipline) plus a fifth specific to this page:

  > **THE SHAPE PROMPT IS A STATIC STRING AND NOTHING ELSE.** `COPY.sketchCaption` names situation,
  > action and what changed. No request is made to fill the box, no suggestion is offered, nothing
  > is completed. This page is where the spec's first unloosenable rule would be most tempting to
  > break, and the absence of any fetch other than the two below is what keeps it.

  Behaviour:
  - `load()` → `GET /prep/api/stories`; 401 → `bounce()` to `/prep/login` via `location.replace`;
    404 → `nothingYet(COPY.notReady)`; else render.
  - The list: one row per story — title (text node), the covered competency labels joined, an
    **Edit** and a **Delete** button. Delete asks for confirmation **in the page** (a two-step
    button: "Delete" → "Really delete?"), never `window.confirm` (the document double cannot
    dispatch, and `confirm` is untestable here).
  - The editor: title input, sketch textarea, one checkbox per competency. **Save** POSTs to
    `/prep/api/stories` (new) or `/prep/api/story` with `action: "save"` (existing), then
    **re-fetches** — `passport.js`'s rule.
  - `sentSnapshot` (`debrief.js:198`, `:304`): what the editor held when the POST left. Anything
    edited during the round trip is kept over the re-fetched row. **This matters more here than on
    the debrief** — a sketch is paragraphs, not a line.
  - **An uncovered story says so.** A story with no ticks — either never mapped, or mapped only to
    competencies a re-handover deleted (the cascade takes the ticks, `0012`'s second edge) — renders
    a plain line: `COPY.noCovers` = *"This story is not linked to any part of the job yet."* Without
    it the row shows a title and an unexplained blank, and the candidate cannot tell "I haven't done
    it" from "something removed it". Same class of state, same remedy, as the stale-placement branch
    at `debrief.js:317-327`.
  - The gap line: `story_gap` non-null → `COPY.gap(label)`, a forward-looking sentence
    (`"Nothing in your stories covers X yet — it is one of the things most likely to come up."`).
    **Never a count, never "0 of 5 covered", never the word gap or weakness in the copy.**
  - Caps refused **in the page** with copy that names the real limit
    (`debrief.js:45-52`/`:414-421`'s argument: a 400 dressed in retry advice is a dead end, and
    nothing is in browser storage to reload from). Use `max_stories` from the payload.
- **PATTERN**: `public/prep/debrief.js` (whole file).
- **IMPORTS**: none (no module imports at all; `COPY` and helpers are local).
- **GOTCHA**: no `document` read at module scope. · `aria-disabled`, never `disabled`, on the
  in-flight button (`debrief.js:178-184` — `disabled` on the focused button drops focus to `<body>`
  and never gives it back). · Every checkbox needs an `id`+`for` pair and every picker/button an
  `aria-label` that names **which story** it acts on (`COPY.placeFor`'s argument at
  `debrief.js:78-81`: five identical "Delete" buttons are unnavigable). · A failed save leaves the
  boxes **untouched**.
- **VALIDATE**: `node --test test/prep-storybank-ui.test.js`
- **SATISFIES**: AC #1, AC #3.

---

### UPDATE `public/prep/prep.css`

- **IMPLEMENT**: a `.stories` block beside `.debrief` (`prep.css:50-91`), reusing
  `.prep-label`/`.prep-caption`/`.prep-body`/`.btn` and adding only what is genuinely new:
  `.stories` (page width), `.stories .input, .stories .textarea { font-size: var(--text-note); }`
  (the 16px floor), `.story-row`, `.story-row-title`, `.story-row-covers`, `.story-tick`,
  `.story-tick-label`, `.story-gap`.
- **PATTERN**: `.debrief` / `.debrief-line` / `.debrief-tick` at `prep.css:50-91`.
- **IMPORTS**: n/a.
- **GOTCHA**: **tokens only, no raw colour values** — `test/chrome.test.js` sweeps this file for
  raw hex and for motion outside the reduced-motion guard. · Spacing comes from `--space-*`. ·
  Tap targets ≥ 44px on the tick rows and the delete buttons (manual sweep — the DOM double cannot
  measure).
- **VALIDATE**: `node --test test/chrome.test.js`
- **SATISFIES**: AC #1.

---

### ADD the entry links to `public/prep/brief.html` and `public/prep/session.html`

- **IMPLEMENT**: a `<p class="brief-cta" id="stories-cta"><a class="btn btn-block"
  href="/prep/stories">Your stories</a></p>` on both pages, beside the existing debrief CTAs
  (`brief.html`'s `#debrief-cta`, `session.html:36`'s `#session-debrief-cta`).
- **PATTERN**: `public/prep/session.html:33-36`.
- **IMPORTS**: n/a.
- **GOTCHA**: **NOT hidden, and no flag.** The debrief CTA starts `hidden` and is unhidden by
  `debrief_available` because a debrief before the interview is meaningless. A storybank is most
  useful **before** it, so the link is unconditional — which means no `brief.js`/`session.js`
  change at all. Write a comment on both saying exactly that, or the next reader "fixes" it by
  analogy with the line above it. · Give the two ids **different** names (`stories-cta` /
  `session-stories-cta`) if `prep-content.test.js`'s id assertions need to tell them apart.
- **VALIDATE**: `node --test test/prep-content.test.js`
- **SATISFIES**: AC #1.

---

### UPDATE `test/prep-content.test.js`

- **IMPLEMENT**:
  1. `read("public/prep/stories.html")` / `.js` and add the page to `CONTENT_PAGES` (`:45`) — that
     alone brings robots-meta, viewport, the exact four-sheet chain, and the no-inline-`<style>`
     gates.
  2. A `$("…")`-shape id-drift test mirroring `:110-131` with its own non-empty self-guard
     (`>= 18`, or whatever the controller actually reaches — count it, do not guess).
  3. The **iOS 16px gate** on `#sketch` (and `#title`), mirroring `:133-144`: a sketch box is typed
     into at length, so this is the same failure on a longer surface.
  4. The state-line test: `#stories-state` carries `role="status"` and the `save-state` class; both
     sections start `hidden`.
  5. Script present: `stories.html` matches `/import \{ initStories \}/` and `/initStories\(\)/`.
  6. The stylesheet-chain assertion for `stories.html` — the portal's four, no fifth (mirroring
     `:305-309`'s wording).
- **PATTERN**: the `#77` additions throughout that file.
- **IMPORTS**: none new.
- **GOTCHA**: the file's whole argument is that a gate over an **empty set passes while checking
  nothing** — every new scan needs its `assert.ok(reached.length >= N)` self-guard. **`N` is decided
  by `stories.js`, which is why this task comes after it in the order above**: count the real
  `$("…")` call sites and use that number. Guessing produces an off-by-N failure that reads exactly
  like a real one.
- **VALIDATE**: `node --test test/prep-content.test.js`
- **SATISFIES**: AC #1.

---

### CREATE `test/prep-storybank-ui.test.js`

- **IMPLEMENT**: `test/prep-debrief-ui.test.js`'s shape — a `SHELL_IDS` mirror of `stories.html`, a
  `shell()` factory over `fakeDocument()`, and tests for the failures that are green-and-wrong:
  - a **failed save does not clear the sketch box** (the one failure this page cannot afford);
  - a **save that lands while the candidate is still typing does not overwrite** what they typed
    (`sentSnapshot`);
  - **nothing reaches browser storage or a URL** — grep the source for `localStorage`,
    `sessionStorage`, `indexedDB`, `document.cookie`, `caches`, and for a query string carrying a
    title or sketch;
  - **no HTML-parsing assignment** — grep for `innerHTML`, `outerHTML`, `insertAdjacentHTML`;
  - **no model call from the page** — grep for any fetch target other than `/prep/api/stories` and
    `/prep/api/story`; assert `COPY.sketchCaption` is a **static string**;
  - the cap refusals fire in the page with the limit named;
  - editing story B does not carry story A's ticks into the editor;
  - the gap line renders the label and **no number**.
- **PATTERN**: `test/prep-debrief-ui.test.js:1-60` and its body.
- **IMPORTS**: `{ initStories, COPY } from "../public/prep/stories.js"`;
  `{ fakeDocument, serialize, textOf, findAll } from "./helpers/dom.js"`.
- **GOTCHA**: the DOM double records listeners and never dispatches — reach a handler via
  `node.listeners.click[0]()`. · It does not lay out, focus or compute style: tap-target size and
  keyboard operability are the **manual sweep**, not a test (`test/helpers/dom.js:6-10`). · Do not
  grow the helper for this ticket.
- **VALIDATE**: `node --test test/prep-storybank-ui.test.js`
- **SATISFIES**: AC #1, AC #2 (the page half), AC #3.

---

### UPDATE `DEPLOY.md`

- **IMPLEMENT**: two edits, in the register of the `#77` section (~lines 770-800).
  1. A new section **"The storybank (#78) — a page, and one thing to apply first"**: what
     `/prep/stories` is; that it is offered from the brief and the practice shell and is
     **not** date-gated (unlike the debrief) because stories are written before the interview;
     ⚠ **migration `0012` must be applied first** (`npm run db:remote` / `npm run db:preview`);
     nothing new to configure — no secret, no Access application, no model call on the storybank's
     own routes; the wall claim and the test that asserts it; retention unchanged because both
     tables hang off `candidate_role`.
  2. A **triage-table row** (~line 460, beside the 0011 row) stating the *precise* blast radius:
     `500 {"error":"internal"}` from `/prep/api/stories` **while `/prep/api/session`,
     `/prep/api/turn` and `/prep/api/debrief` stay healthy` → migration `0012` unapplied.
     **Say explicitly that this differs from the 0011 row**: the drill does **not** go down, because
     `turn.js`'s story-title read degrades — nudges simply stop offering story titles, silently and
     by design.
- **PATTERN**: the `#77` section and the 0011 triage row.
- **IMPORTS**: n/a.
- **GOTCHA**: the triage table's value is that a symptom maps to exactly one cause — write the row
  so the *combination* (stories 500 + drill healthy) is the discriminator.
- **SATISFIES**: operational readiness.

---

## TESTING STRATEGY

Framework: **`node --test`** over `test/*.test.js`, `node:assert/strict`. No test runner config, no
mocking library. Two engines: `test/helpers/fake-d1.js` (records SQL, enforces nothing) and
`test/helpers/sqlite-d1.js` (real `node:sqlite`, `PRAGMA foreign_keys = ON`, every migration
applied in wrangler's order). **Every assertion that branches on a constraint, a cascade or
`meta.changes` must use the real engine and carry `{ skip }`.**

### Unit Tests

- `src/prep/targeting.js` — `storyGap` (pure, no skip): empty cover set, full cover, partial, and
  the key-shape assertion that stops a rank leaking.
- `src/prep/drill.js` — `SESSION_SYSTEM` rule 6 greps; `mintNudge`'s conditional block present and
  absent; the source grep proving `sketch` appears nowhere in the module.
- `src/portal/store.js` — the six storybank functions on real SQLite.

### Integration Tests

- `functions/prep/api/stories.js` + `story.js` driven as handlers with a real migrated D1 and a
  real session cookie minted through `createInvite` + `persistHandover` (the seeder in
  `test/prep-debrief.test.js:76-89`).
- `functions/prep/api/turn.js` `help`/`nudge` with a fake Anthropic client, asserting the prompt.
- `test/portal-purge.test.js` — the row-for-row cascade proof across the whole invite scope.
- `test/prep-content.test.js` — the markup contract for the new page.
- **The wall** — a filesystem reachability scan over every `.js` under `functions/`.

### Edge Cases

Each of these must have a named test:

| Case | Expected |
|---|---|
| No stories at all | GET returns `stories: []`, `story_gap` = the top-ranked competency |
| Every competency covered | `story_gap: null` |
| A role with **zero** competencies (a handover that wrote none) | the page still renders and a title-only story still saves; `story_gap: null` |
| Title blank / whitespace only | `400 missing_fields` |
| Sketch blank | **legal** — a title-only story is a real half-written state |
| Title > 120 / sketch > 2,000 chars | `400 too_long`, refused in the page first with the limit named |
| 13th story | `400 too_long`, refused in the page first |
| `competency_ids` holding an id from another invite | `404 not_found`, nothing written |
| `story.js` save/delete with an id from another invite | `404 not_found`, **both** rows byte-identical, and no ticks written |
| A story whose every mapped competency vanished under a re-handover | the story survives with no covers; the page says so in plain words, and `storyGap` may now flag a competency the candidate has material for — correct, and the copy is what makes it legible |
| `action: "delete"` carrying `title` | `400 unexpected_fields` |
| Body is `null` / `[]` / `42` | `400 bad_json` (`src/http.js` already) |
| Cross-origin POST | `403 cross_origin` |
| No session cookie | `401` (page bounces to `/prep/login` via `replace`) |
| Handover not written | `404` → "your prep is not ready yet", never an error line |
| Two tabs saving ticks concurrently | no constraint error (`ON CONFLICT DO NOTHING`); worst case the set is momentarily empty and the next save restores it |
| A failed save | boxes untouched, state line names the failure |
| A save landing while the candidate types | typed text survives (`sentSnapshot`) |
| Purge / delete-now | stories and mappings gone, row for row |
| Migration 0012 unapplied | `/prep/api/stories` 500s; **the drill still works**, nudges just carry no titles |
| A competency deleted under a re-handover | its ticks go with it; the story survives |

---

## VALIDATION COMMANDS

Execute every command to ensure zero regressions and 100% feature correctness.

### Level 1: Syntax & Style

There is no linter or formatter in this repo (`package.json` has `test` and scripts only). The
equivalents:

```bash
node --check functions/prep/api/stories.js
node --check functions/prep/api/story.js
node --check public/prep/stories.js
node --check src/portal/store.js
node --check src/prep/targeting.js
node --check src/prep/drill.js
node --check functions/prep/api/turn.js
```

The migration applies clean, standalone:

```bash
python3 - <<'PY'
import sqlite3, glob
db = sqlite3.connect(":memory:"); db.execute("PRAGMA foreign_keys=ON")
for f in sorted(glob.glob("migrations/*.sql")): db.executescript(open(f).read())
print(sorted(r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")))
PY
```

### Level 2: Unit Tests

```bash
node --test test/schema.test.js
node --test test/prep-targeting.test.js
node --test test/prep-drill.test.js
node --test test/prep-storybank.test.js
```

### Level 3: Integration Tests

```bash
node --test test/portal-purge.test.js
node --test test/prep-turn.test.js
node --test test/prep-content.test.js
node --test test/prep-storybank-ui.test.js
node --test test/prep-debrief.test.js   # the sibling wall must still pass unchanged
npm test                                 # the whole suite — zero regressions
```

Confirm the SQLite-backed half actually ran (not skipped):

```bash
node --version   # must be >= 22.5 for node:sqlite; the suite skips silently below it
```

### Level 4: Manual Validation

```bash
npm run db:local     # apply 0012 to the local D1
npm run dev          # scripts/dev.py — wrangler pages dev
```

Then, signed in as a seeded candidate (`/prep/demo` on a DEMO_MODE deployment, or a real invite):

1. `/prep/stories` → add a story, tick two competencies, save. Reload: it round-trips.
2. Edit the sketch, save, reload. Delete one story: it and its ticks are gone; the other survives.
3. The gap line names a competency with no story and **no number** anywhere on the page.
4. `/prep/session` → ask for a **nudge**. It may reference a story **title**; it must never contain
   a sentence from a sketch.
5. `/prep/delete` (delete-now) → re-open `/prep/stories` → bounced to login; the rows are gone
   (`wrangler d1 execute … "SELECT COUNT(*) FROM story"`).
6. **On a real iPhone in Safari**: tapping `#sketch` and `#title` must **not** zoom the viewport;
   pinch zoom still works; the tick rows and delete buttons are ≥ 44px. (`test/helpers/dom.js`
   cannot answer any of these — this is the sweep.)
7. Keyboard only: tab to each story's Edit and Delete and confirm each announces **which** story.

### Level 5: Additional Validation (Optional)

```bash
# The wall, by hand — must print nothing.
grep -rlE "\bstor(y|ies)\b" functions/ | grep -v "^functions/prep/"
# The sketch seam, by hand — must print nothing.
grep -n "sketch\|storiesByRole" functions/prep/api/turn.js
```

---

## ACCEPTANCE CRITERIA

Traced to the ticket's own five:

- [ ] **AC1 — CRUD.** `/prep/stories` creates, edits and deletes a story (title + sketch) and
      maps/unmaps it to the role's competencies. The editor shows the shape prompt (situation,
      action, what changed) as **static placeholder guidance**. The tool never generates or
      completes sketch text: `SESSION_SYSTEM` rule 6 states it, `test/prep-drill.test.js` greps
      for it, and `test/prep-storybank.test.js` asserts both routes import no SDK and no `drill.js`.
- [ ] **AC2 — Session integration.** When stories exist, the `nudge` rung's prompt carries their
      **titles** and may ask which fits. Absent entirely when there are none. `sketch` is selected
      by exactly one store function, read by exactly one route, and appears nowhere in
      `src/prep/drill.js` or `functions/prep/api/turn.js` — asserted.
- [ ] **AC3 — Targeting flag.** `storyGap()` in `src/prep/targeting.js` returns the highest-ranked
      competency with no mapped story as `{id, label}`; `/prep/api/stories` returns it; the page
      renders a forward-looking sentence. **No score, no rank, no count** reaches the browser.
- [ ] **AC4 — Purge.** Both tables cascade from `candidate_role`; the 30-day purge and delete-now
      take them in the one `DELETE FROM invite` they already issue. Proven row for row in
      `test/portal-purge.test.js` and locked in `test/schema.test.js`.
- [ ] **AC5 — No recruiter-facing endpoint returns story content.** A reachability scan over every
      `.js` under `functions/` fails if any file outside `functions/prep/` can reach story content,
      with its own self-guards and a case proving the matcher does not confuse `StoryBankCard`.
- [ ] All validation commands pass with zero errors; `npm test` is green with no skipped
      SQLite tests on Node ≥ 22.5.
- [ ] Code follows project conventions: every non-obvious decision carries its argument, and every
      trade states what it does **not** close.
- [ ] `DEPLOY.md` carries the section and the triage row.
- [ ] No regressions: `test/prep-debrief.test.js`, `test/prep-turn.test.js`,
      `test/prep-session-ui.test.js`, `test/chrome.test.js` unchanged and green.

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] All validation commands executed successfully
- [ ] Full test suite passes (`npm test`) on Node ≥ 22.5
- [ ] `node --check` clean on every touched `.js`
- [ ] Manual sweep done in real iOS Safari (zoom, tap targets) and by keyboard
- [ ] Acceptance criteria all met
- [ ] `DEPLOY.md` updated; migration applied to preview before the deploy
- [ ] PR body carries `Closes #78`, notes the ticket's `prompt.js` → `drill.js` correction, and
      states that `0012` must be applied first

---

## OPEN QUESTIONS / ASSUMPTIONS

**Resolved by evidence, stated so nobody re-litigates them mid-implementation:**

1. **The ticket's Seams line names the wrong file for the turn prompt.** It says story titles enter
   `src/prep/prompt.js`. That module is the **brief-generation** prompt (`PREP_SYSTEM`,
   `buildPrepMessages`) — one server-side Opus call at Send, before the candidate has ever opened
   the portal, when no stories exist. The **turn** prompt is `src/prep/drill.js`
   (`SESSION_SYSTEM`, `mintNudge`), called from `functions/prep/api/turn.js:123-131`. This plan
   targets `drill.js`. **SPEC Amendment 1's Storybank text names no file, so no spec amendment is
   needed** — only the ticket's Seams line is wrong. Note it in the PR body.
2. **Migration number: `0012`.** The epic's coordination note ("first merged takes 0011") is
   already settled — `migrations/0011_debrief.sql` shipped with #77 (`9c0204e`). No rebase.
3. **`StoryBankCard` is a different thing.** Model-written brief block vs candidate-written state.
   Not merged, not renamed, not fed. Named in the migration header, the store section, and a test.
4. **The story gap surfaces on `/prep/api/stories` only.** Computed in targeting (which is what
   "targeting flags…" means); the session-side surfacing belongs to **#80**, which already depends
   on this ticket and owns the prescriptive ending.
5. **Missing `0012` degrades the drill rather than taking it down** — the opposite of `0011`'s
   posture, deliberately, because a story title only decorates a nudge while a shaky tick changes
   what is drilled. The loud signal is `/prep/api/stories` itself.

**Assumptions a reviewer may want to overturn (each is cheap to change, none blocks a start):**

6. **Caps: 12 stories, 120-char titles, 2,000-char sketches.** SPEC says "a small set"; twelve is
   generous for a competency list of five or six. If the owner wants a different number, it is one
   constant in `stories.js` returned to the page as `max_stories`.
7. **The nudge gets every story title on the role, not just those mapped to the competency being
   drilled.** Rationale: the mapping is the candidate's own bookkeeping and may be incomplete or
   wrong, and the nudge's job is to **point**, not to assert a fit. Passing only the mapped ones
   would make the nudge nearly say "use story X", which drifts toward supplying content. Cheap to
   narrow later — the seam is one store function.
8. **A title-only story is legal.** The page is resumable and a candidate who types a title and
   walks away has recorded something real. If the owner wants a sketch required, it is one guard.
9. **Delete uses a two-step in-page button, not `window.confirm`.** The DOM double cannot dispatch,
   and `confirm` is untestable here.

**The one genuine risk, stated plainly:** the ticket's most valuable acceptance criterion (AC1's
"the tool never writes sketch text") is a **negative** — it is satisfied by absence. Absence rots
silently. Every mechanism in this plan that enforces it is therefore structural (an absent import,
a query with no `sketch` column, a scan over the filesystem) rather than behavioural, because a
behavioural test can only prove the model did not do it *this time*.

## NOTES (open canvas)

### Why the route is split into two files

`functions/prep/api/debrief.js:6-8` argues its own single-file shape and, in doing so, hands this
ticket the opposite answer: *"the items.js/item.js split next door is resource-shaped (a checklist
and one item of it), not method-shaped, so it is not the precedent here."* A storybank is exactly a
checklist and one item of it. Two files, and the argument is already written.

The alternative considered and rejected: **one route, whole-set replace** (`POST { stories: [...] }`,
the debrief's idiom). It is simpler on the wire and needs no per-story ownership check. It was
rejected because a whole-set replace on this data means **DELETE-then-INSERT over the candidate's
sketches** — the exact hazard `store.js:818-822` states it accepts for a set of ticks (small,
re-tickable in one tap per box) applied to paragraphs of prose that cannot be re-typed. The failure
mode is "a dropped connection between two statements loses everything the candidate wrote", and
commit `7057b2a` ("never lose a word the candidate typed") is this codebase's recorded position on
that trade.

### Why `rankCompetencies` and not `drillState` in the stories route

`drillState` pulls the whole question bank and the entire attempt log to produce a queue, a demand
and a session split — none of which a page that drills nothing needs. `rankCompetencies` over
`competenciesByRole`'s rows, decorated with `shakyCompetencyIds` the way `drillState:353-362` does
it, produces the same rank order for the gap at a fraction of the reads. **Decorate with `shaky`
anyway** — a gap that disagrees with what the drill will actually serve next is a gap pointing at
the wrong competency.

### Data flow

```
                        public/prep/stories.js  ──GET──▶  /prep/api/stories
                              │                                │
                              │                    competenciesByRole ─┐
                              │                    storiesByRole ──────┤ (sketch: this read ONLY)
                              │                    storyCompetenciesByRole
                              │                    shakyCompetencyIds ─┤
                              │                                        ▼
                              │                        rankCompetencies → storyGap → {id,label}
                              │
                              └──POST──▶ /prep/api/stories (new) · /prep/api/story (save|delete)
                                             │
                          createStory (mints the id) · updateStory · deleteStory
                          (both role-scoped IN THE SQL) · setStoryCompetencies

  public/prep/session.js ──POST {action:"help", rung:"nudge"}──▶ /prep/api/turn
                                             │
                                    storyTitlesByRole  ── TITLES ONLY, wrapped, degrades
                                             ▼
                                    mintNudge(… storyTitles) → SESSION_SYSTEM rule 6
                                             ▼
                                       { nudge: "…" }        ← still one content-free string

  DELETE FROM invite ──cascade──▶ candidate_role ──▶ story ──▶ story_competency
                                                └──▶ competency ──▶ story_competency
```

### Sequencing and parallelism

Phase 2 (`storyGap`) is pure and touches one file — it can run in a parallel worktree with Phase 1.
Phase 4 (the nudge seam) needs only `storyTitlesByRole` from Phase 1 and is independent of Phase 3,
so a second agent could take it while the routes are written. Everything else is sequential.

⚠ Per the repo's own memory: **parallel sessions share this worktree and HEAD moves under you** —
verify the branch before any commit or PR, prefer a linked worktree, and never `git add -A`.

### Suggested branch and PR

`feature/storybank` off `main` (not off `feature/private-debrief` — #77 is merged). PR body:
`Closes #78`, `Part of #76`, the migration warning, and the `prompt.js` → `drill.js` correction.

## AMENDMENTS

<!-- Append-only. Newest at the bottom. Leave empty at creation. -->
