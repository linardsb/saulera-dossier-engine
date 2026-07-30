# Feature: Session engine — targeting, answer loop turns, readiness, habits (#23)

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

## Feature Description

The server-side pedagogy engine for the candidate prep portal: given the cached core question
bank (#19) and the portal schema (#17), run the drill. Targeting picks the next question by
`importance × (1 − readiness)`; each turn runs attempt → optional nudge → optional reveal with
`mode` recorded; feedback per turn comes from `claude-sonnet-5` (one improvement + one thing that
worked); lateral/vertical variants are minted live when the ladder demands (decision 6); readiness
stages move per SPEC's ladder table; habits surface only on second observation; spacing compresses
by time-to-interview; the session closes with one-improved / one-next / what's-queued. Sessions
are resumable because all state derives from D1 — there is no session table.

Request/response only (decision 19), one POST per turn. Cached core questions return without a
model call (the latency constraint in the ticket).

## User Story

As a candidate preparing for a confirmed interview
I want short drills that ask me the questions I'm least ready for and give me one specific improvement per answer
So that my answers survive phrasings I didn't rehearse, without ever being handed an answer to memorise

## Problem Statement

#17 built the tables and #19 minted the bank, but nothing yet decides what to ask, records what
happened, or moves a competency up the ladder. Without this engine, #24's drill UI has no server
to talk to and the portal is a static brief page.

## Solution Statement

Three pure modules (`targeting`, `ladder`, `habits`) hold every rule the SPEC states, tested on
fixtures with zero I/O. A `#23` section in `src/portal/store.js` adds the D1 reads/writes in the
file's established style. One importable model-call module (`src/prep/drill.js`, mirroring
`src/prep/generate.js`) owns the three sonnet call shapes — feedback, help rung, variant — each
with a structured-output schema whose shape makes "a finished answer" unrepresentable. Two
Functions adapt it to HTTP: `GET /prep/api/session` (pure DB, no model call) and
`POST /prep/api/turn`.

## Out of Scope / Non-Goals

- Not included: the drill UI (#24 renders what this serves), day-before mode (#25), streaming/SSE (decision 19 — later polish), voice (decision 5).
- Not included: pressure mode / stage 4 transitions — post-pilot (decision 21). The ladder tops out at stage 3 (`unaided`); stage 4 exists in the vocabulary but nothing writes it.
- Not changing: `functions/prep/_middleware.js` (purge stays unguarded), `src/prep/session.js` (the auth guard is #20's, we only call it), `persistHandover`, migrations (0002 already fits — no schema change).
- Not shown to the candidate, ever: `importance`, `success_rate`, `stage`, `rating` (no score/rank — architecture §3). Responses carry movement, never a level.

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: High
**Primary Systems Affected**: `src/prep/*` (new pure modules + model calls), `src/portal/store.js` (#23 section), `functions/prep/api/*` (two new candidate routes), tests
**Dependencies**: `@anthropic-ai/sdk` (already a dependency); `claude-sonnet-5` via `ANTHROPIC_API_KEY`

## Related Work

**Implements**: [#23](https://github.com/linardsb/saulera-dossier-engine/issues/23) · **Epic**: #16 → `docs/epics/candidate-portal.architecture.md` (decisions 3, 6, 19, 21 inherited, not re-decided)

**Back-references** (plans this builds on or inherits decisions from):

- `.claude/plans/portal-schema-retention-gdpr.md` — #17's tables; every row hangs off an invite via CASCADE
- `.claude/plans/candidate-brief-generation-seam.md` — #19's bank: `axis` NULL = core rows, `difficulty` stored via the `DIFFICULTY` map
- `.claude/plans/candidate-auth-magic-link-otp.md` — `requireSession` is the door on both new routes
- `.claude/plans/send-to-candidate.md` — `persistHandover`'s row-id scheme (`${roleId}:${slug}`, `#${index}`) that this engine reads back

**Forward-references**: #24 (drill UI consumes both endpoints), #25 (day-before mode reuses targeting + spacing)

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `docs/epics/interview-prep/SPEC.md` — **the contract; divergence is a bug in this ticket.** Sections: Session shape, The answer loop, Targeting, Readiness ladder, Habits, Spacing, State, Tone.
- `docs/epics/candidate-portal.architecture.md` (§3 enforcement mechanisms, §5 model calls, decisions 3/6/19/21)
- `migrations/0002_portal.sql` — the tables. Note: `attempt.mode` CHECK (`recall|nudged|revealed`), `question.axis` CHECK (`lateral|vertical` — **NULL means core**), `competency.stage` TEXT DEFAULT `''`, `competency.success_rate` REAL DEFAULT 0, `habit.evidence_count` DEFAULT 1.
- `src/portal/store.js` (whole file) — the store style: `db` first arg, bound params only, section headers per ticket, `requireFields`, `DIFFICULTY` map (lines 143), `persistHandover`'s id scheme (line 195: `${roleId}:${competency.id}`; line 245: `#${index}`), `briefJsonByInviteId`'s "one column, never SELECT *" discipline (lines 259–274).
- `src/prep/session.js` — `requireSession(db, request)` / `sessionFromRequest`; returns `{inviteId, clientId, expiresAt}`. Both new routes call it (NOT middleware — the file's header explains).
- `functions/prep/api/brief.js` — the candidate GET route pattern to MIRROR: env.DB guard → requireSession → store read → projection → `errorResponse`. No `sameOrigin` on GET (its lines 34–36).
- `functions/prep/api/delete.js` — the candidate POST route pattern to MIRROR: `sameOrigin` bolt, `readJson`, `ALLOWED` field-set 400 on unexpected keys.
- `src/prep/generate.js` — the model-call module pattern to MIRROR exactly: importable (not a Function), client passed in, `stream → finalMessage`, stop_reason guards (`refusal`/`max_tokens` → `StoreError` 502), parse → assert → return. Note it imports `MODEL, EFFORT, FALLBACK_BETA` from `src/generate.js` — **this ticket does NOT**: session calls are `claude-sonnet-5` (architecture §5), a new constant in the new module.
- `src/generate.js` (lines 23–54) — `FALLBACK_BETA` and the `betas`/`fallbacks: "default"` matched pair; the thinking/max_tokens interplay comments.
- `src/prep/prompt.js` — `PREP_SYSTEM` shows exactly how the two non-negotiables are worded (rules 1 and 2). The session system prompt restates them; a test greps both prompts for the same phrases.
- `src/prep/schema.js` — schema-building style (`str`, `additionalProperties: false`, enum-not-minimum because structured outputs reject numeric constraints), and the `assertX` twin-enforcement argument (header lines 1–15). Every new schema gets an `assert` twin.
- `src/prep/projection.js` — the delivery-side censoring pattern: what the browser receives is a projection, never the stored row. The turn/session responses follow the same rule for `importance`/`stage`/`success_rate`/`rating`.
- `src/prep/dates.js` — the RULE that matters: SQLite stamps are UTC with a space separator, `Date.parse` reads them as local. `toUtcDate` gets exported (its own one-word task) so targeting imports the one reading rather than copying it.
- `src/http.js` — `json`, `readJson`, `sameOrigin`, `errorResponse`; `StoreError` carries its own status.
- `functions/api/prep/prepare.js` (lines 29, 46, 82) — Anthropic client construction at the route: `new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })`, and the `no_model_key` 503 guard.
- `test/helpers/sqlite-d1.js` — `openMigrated`, `d1Shape`, `skip`, `SEED_CLIENT`, `at(days)`. All store tests that branch on constraints or `meta.changes` run here, not on fake-d1 (its header lists exactly why).
- `test/helpers/fake-d1.js` — for recorded-SQL assertions only.
- `test/prep-generate.test.js` — the fake-Anthropic-client test pattern (hand in a fake, assert the request built).
- `test/prep-send.test.js` — seeding a real handover through `persistHandover` on node:sqlite; the fixtures this ticket's store tests reuse.

### New Files to Create

- `src/prep/targeting.js` — pure: readiness, competency ranking, spacing eligibility, next-question choice, variant demand
- `src/prep/ladder.js` — pure: stage vocabulary, success_rate computation (honesty rule lives here), stage transitions
- `src/prep/habits.js` — pure: the closed habit vocabulary + surfacing rule (evidence_count ≥ 2)
- `src/prep/drill.js` — the sonnet call site: `SESSION_MODEL`, `SESSION_SYSTEM`, three call functions + three schemas + three asserts
- `functions/prep/api/session.js` — GET: session state, queue, progress-as-movement, close summary. Zero model calls.
- `functions/prep/api/turn.js` — POST: attempt & help-rung turns
- `test/prep-targeting.test.js`, `test/prep-ladder.test.js`, `test/prep-habits.test.js`, `test/prep-drill.test.js`, `test/prep-session-store.test.js` (store section, node:sqlite), `test/prep-turn.test.js` (route-level, node:sqlite + fake client)

### Modified Files

- `src/portal/store.js` — append a `── the session engine (#23) ──` section (functions listed in Tasks). Touch nothing above it.
- `src/prep/dates.js` — one-word change: `export` on the existing `toUtcDate` (targeting imports the one reading of a SQLite stamp instead of copying it).

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- `docs/epics/interview-prep/SPEC.md` — every rule below traces to a section of it; read it whole before Task 1.
- No external docs needed beyond what the codebase already encodes: the structured-outputs constraints (no numeric min/max, `additionalProperties: false`, no recursion) are documented in `src/prep/schema.js`'s header, and the sdk call shape in `src/prep/generate.js`. If in doubt about `claude-sonnet-5` behaviour, load the `claude-api` skill — do not guess from memory.

### Patterns to Follow

**Store functions** (`src/portal/store.js` style):
```js
export async function recordAttempt(db, { competencyId, questionId, mode, rating, note } = {}) {
  requireFields({ competencyId, questionId, mode });
  await db.prepare(`INSERT INTO attempt (...) VALUES (?, ?, ?, ?, ?)`).bind(...).run();
}
```
Every user value bound, never interpolated; `db` first; no HTTP, no env.

**Model-call module** (`src/prep/generate.js` shape): client passed in; `client.beta.messages.stream({...}); await stream.finalMessage()`; guard `stop_reason === "refusal"` → `StoreError("model_refused", 502)`, `"max_tokens"` → `StoreError("truncated", 502)`; find text block; `JSON.parse` → `StoreError` on failure; `assertX` wrapped into `StoreError("bad_*", 502)`.

**Schemas**: `additionalProperties: false` everywhere, enums not numeric constraints, `str(description)` helper style, `assert` twin that re-enforces the vocabulary at runtime.

**Routes**: `brief.js` for GET (no sameOrigin), `delete.js` for POST (sameOrigin + ALLOWED field set). Both: `if (!env.DB) return json({ error: "not_configured" }, 503);` and `requireSession` per-route, never in middleware.

**Error register**: caller faults 400, no session 401, model faults 502, missing config 503. `StoreError(code, status, message)`; `errorResponse` maps it.

---

## THE PINNED RULES (the design decisions this plan makes)

SPEC's ladder and spacing are qualitative; an engine needs numbers. These are the constants this
plan pins — each lives in ONE pure module, exported, and fixture-tested. Changing one later is a
one-line diff plus its test. Flagged in Open Questions; do not silently re-derive them.

**Stage vocabulary** (`ladder.js`): `competency.stage` TEXT holds `'' | 'can_answer' | 'holds_up' | 'unaided' | 'under_pressure'`. `''` (the DDL default #22 left) = not yet stage 1. `STAGES = ['', 'can_answer', 'holds_up', 'unaided', 'under_pressure']`; `stageNumber(stage)` → 0–4. Nothing in the pilot writes `under_pressure` (decision 21).

**Rating** (set by the sonnet feedback call, structured enum): `1 | 2 | 3 | 4` (1 = no relevant answer, 2 = relevant but duties-not-outcomes/rambling, 3 = solid, 4 = strong). **Success = rating ≥ 3.** Rating is internal — never in a candidate-bound response.

**The honesty rule** (`ladder.js`, the ticket's headline test): `successRate(attempts)` counts ONLY `mode ∈ {recall, nudged}` attempts. `revealed` attempts are excluded from both numerator and denominator — a revealed attempt can never raise `success_rate`, whatever its rating; excluding them from successes only would make reveals LOWER the rate, which punishes using the ladder and is not the rule. (The row still exists: SPEC's re-queue rule, and the ladder's "fewer nudges" signal.)

**Progress is a pure fold, stored columns are a cache** (`ladder.js` — `replayProgress(attempts)`): fold `nextStage` + `successRate` attempt-by-attempt over the ordered log, returning `{stage, successRate}` — and, given any prefix of the log, the stage/rate *as of that point*. This is the load-bearing design move: `competency.stage`/`success_rate` are recompute-then-write caches for targeting's reads, the attempt log is the only source of truth, and **`moved` becomes derivable anywhere** by replaying the log up to the session boundary and comparing (`fold(before-session) vs fold(all)`). Without this, "moved this session" would need timestamped stage history the schema doesn't have. It also makes concurrent turns converge: two double-submitted POSTs each replay the full log, so the second write is correct whatever order D1 serialised the inserts in — no locking needed, and a comment in turn.js says so.

**Stage transitions** (`ladder.js` — `nextStage({ stage, attempts })`, attempts newest-last; monotonic, one step per turn, never down):
- `'' → can_answer`: any non-revealed attempt with rating ≥ 3 (a nudged success counts — SPEC: "with notes or a nudge").
- `can_answer → holds_up`: ≥ 4 non-revealed attempts total, `success_rate ≥ 0.6`, and ≥ 1 successful non-revealed attempt on a variant question (`axis` lateral or vertical) — SPEC: "differently-worded versions and follow-up probes; a rate needs a sample". One good answer stays stage 1 by construction.
- `holds_up → unaided`: the last 3 non-revealed attempts are all `mode: 'recall'` and successful — SPEC: "without notes, fewer nudges".
- `unaided → under_pressure`: never in this ticket.

**Readiness** (`targeting.js`): `readiness = (stageNumber(stage) + clamp(success_rate, 0, 1)) / 5` → [0, 1]. Rank competencies by `importance × (1 − readiness)` descending; ties broken by `importance` desc, then id asc (deterministic for fixtures).

**Spacing** (`targeting.js`): time-to-interview in whole UTC days (`interview_at` parsed via `toUtcDate`, exported from `src/prep/dates.js` — see its task; never a second reading of the stamp format). Buckets → per-competency cooldown since its last non-revealed attempt: ≤ 3 days → 0 days cooldown **and** only the top ⌈half⌉ of ranked competencies are eligible (coverage beats depth, top-ranked only); 4–14 days → 2-day cooldown; ≥ 15 days → 5-day cooldown. **Negative days is the ≤ 3 bucket too**: decision 11 keeps access open until interview +14d precisely for second stages, so post-interview drilling is a real state, not an error. A cooled-down competency is skipped in ranking **unless every competency is cooling** — then the top-ranked one is served anyway (a session must never be empty while questions exist).

**Variant demand** (`targeting.js` — "start varying early"): within the chosen competency, next question =
1. If the competency has NO non-revealed success yet → the lowest-difficulty unattempted core question (`axis IS NULL`), by `difficulty` asc then id asc. Unattempted = no attempt rows by this role.
2. Else → an unattempted stored variant if one exists (lateral before vertical, difficulty asc);
3. Else → **mint** one (the only model call for question supply): `'lateral'` if the competency has no lateral variant success yet, `'vertical'` otherwise. `variant_of` = the question the candidate last succeeded on for that competency (fallback: its first core question). **Mint cap**: at `MAX_VARIANTS_PER_COMPETENCY = 8` stored variants, stop minting and re-serve the least-recently-attempted question instead — decision 6's cost envelope must not be breachable by one determined candidate drilling one competency all day.
4. Core questions exhausted + a variant already pending unattempted → serve it (case 2 covers this).

**Turn execution order & failure semantics** (`turn.js` — there is NO transaction on D1/Pages, so the order IS the recovery story):
1. Everything that can 4xx happens before anything spends or writes: body vocabulary → mode vocabulary → length cap → `requireSession` → `questionForRole` ownership. A caller fault costs nothing.
2. The feedback model call runs BEFORE any DB write. A refusal/truncation 502s a turn that left no state — the candidate retries and nothing double-counts.
3. Then the writes, in dependency order: `recordAttempt` → replay → `setCompetencyProgress` → `observeHabit`. Each later write is derivable from the log, so a crash between them leaves a stale *cache*, not wrong *truth* — the next turn's replay heals it. A comment in turn.js states this invariant; it is why recompute-then-write is not optional.
4. Variant minting is LAST and degrades, never kills: if `mintVariant`/`insertVariant` throws, catch it, log the code only, and respond with the recorded feedback and `next_question: null` — the attempt is already safe, the feedback is already paid for, and the next session GET simply re-demands the mint. A 502 here would throw away a successful turn over its optional garnish.

**Session boundary & close** (derived, no table): attempts with a gap > 30 minutes belong to different sessions. A session's close payload (SPEC Session shape 3): `improved` = a competency whose stage rose or success_rate rose during the session (first by stage-rise, else biggest rate rise, else null), `next` = current top of the ranked list, `queued` = the next 3 question texts the targeting would serve. The turn response sets `suggest_close: true` from the 6th attempt-turn of the current session (≈ 8–12 min of drilling); nothing is blocked — the UI decides.

**Habit vocabulary** (`habits.js`, closed — SPEC's five): `rambles | duties_not_outcomes | no_numbers | answers_wrong_question | buries_result`, plus `none`. The feedback schema's `habit` field is this enum; an observation upserts the habit row (`evidence_count + 1` on label match, insert at 1 otherwise). `surfacedHabits(rows)` returns only `active` rows with `evidence_count ≥ 2` — first sight is noise, second is a pattern. **Announcement vs standing list**: the turn response announces a habit only when this observation made `evidence_count` exactly 2 (the moment it becomes a pattern — announcing on every ≥ 2 turn is nagging, which is the guilt-mechanics register decision 17 forbids); session GET carries the full standing list.

**Revealed with nothing to say**: `answer_text` is required non-empty for `recall`/`nudged`; for `revealed` it MAY be empty — "I revealed and moved on" is a real state. An empty revealed attempt SKIPS the feedback call entirely (there is no answer to give feedback on; inventing encouragement about a non-attempt is exactly the unearned feedback SPEC's tone rules refuse — and it saves the model spend), records the attempt with `rating: null`, and returns `feedback: null` with the next question.

**What the candidate's browser receives** (both routes; projection.js's discipline): competency objects carry `{id, label, covered, moved}` where `covered` = has ≥ 1 attempt and `moved` = stage or rate rose in the latest session — never `importance`, `stage`, `success_rate`, `rating`, or a queue position. Question objects carry `{id, text}` — never `difficulty`, `axis`, `variant_of` (an axis label is a difficulty hint; a difficulty number is a score).

---

## IMPLEMENTATION PLAN

### Phase 1: Pure rules (targeting, ladder, habits)

Zero-I/O modules holding every pinned rule, fixture-tested. This phase needs no D1 and no SDK.

### Phase 2: Store section

**Depends on:** nothing in Phase 1 (parallel-safe), but tests reuse Phase 1's fixtures — run it second.

The `#23` section of `src/portal/store.js`: reads and writes, proven on node:sqlite against the real schema (the axis CHECK, ownership joins, cascade).

### Phase 3: The sonnet call site

**Independent of:** Phase 2. Schemas + asserts + three call functions on a fake client.

### Phase 4: The two Functions

**Depends on:** Phases 1–3. Wire everything; route-level tests on node:sqlite + fake client.

### Phase 5: Validation sweep

Full suite, lint-by-convention (no linter in repo — `node --test` is the gate), manual curl pass.

---

## STEP-BY-STEP TASKS

### UPDATE src/prep/dates.js

- **IMPLEMENT**: add `export` to the existing `toUtcDate` function — nothing else changes. The header already names it "maxAgeFrom's rule written once more"; targeting needs the same one reading of a SQLite stamp, and a private copy in a second module is exactly the drift `test/prep-dates.test.js` exists to prevent.
- **VALIDATE**: `node --test test/prep-dates.test.js` (unchanged tests still green)
- **SATISFIES**: ticket "spacing compressed by time-to-interview" (its date arithmetic)

### CREATE src/prep/ladder.js

- **IMPLEMENT**: `STAGES`, `stageNumber(stage)`, `SUCCESS_RATING = 3`, `successRate(attempts)` (the honesty rule — filters `mode !== 'revealed'` before any counting), `isSuccess(attempt)` (rating ≥ SUCCESS_RATING, non-revealed), `nextStage({ stage, attempts })` per the pinned transitions, and **`replayProgress(attempts)`** — the pure fold (pinned rules above): walks the ordered log applying `nextStage` after each attempt, returns `{stage, successRate}`; callable on any prefix, which is how `moved` is computed everywhere. Attempts are plain objects `{mode, rating, axis, created_at}` (axis of the question attempted, `null` for core) — the store shapes them; this module never sees D1. Header comment: cite SPEC "Readiness ladder", the honesty sentence from SPEC "State", the cache-vs-truth invariant, and note stage 4 is post-pilot (decision 21).
- **PATTERN**: pure-module style of `src/prep/dates.js` (no `node:` imports — runs at the edge).
- **IMPORTS**: none.
- **GOTCHA**: `revealed` attempts must not appear in the denominator either — excluding them only from successes would make reveals LOWER the rate, which punishes using the ladder and is not the rule. Transitions are monotonic and single-step: one turn can never jump `'' → holds_up`.
- **VALIDATE**: `node --test test/prep-ladder.test.js`
- **SATISFIES**: AC "the honesty rule test", AC "stage transitions match SPEC's table"

### CREATE test/prep-ladder.test.js

- **IMPLEMENT**: the honesty rule pinned from both directions: (a) a `revealed` rating-4 attempt appended to any history leaves `successRate` exactly unchanged; (b) the same attempt as `recall` raises it. Transition fixtures per pinned rule: one nudged success → `can_answer`; 4 attempts at 3-of-4 success incl. one lateral success → `holds_up`; 3-of-4 with NO variant success → stays `can_answer`; 3 trailing recall successes → `unaided`; nothing reaches `under_pressure`; one good answer alone ≠ `holds_up`. `replayProgress`: full-log fold equals fold-of-prefix continued (associativity of the cache invariant); a prefix/full comparison detects a stage rise mid-log; an all-revealed log replays to `{'', 0}`.
- **PATTERN**: `test/prep-dates.test.js` table-driven style.
- **VALIDATE**: `node --test test/prep-ladder.test.js`
- **SATISFIES**: AC #1 (honesty), AC #3 (transitions)

### CREATE src/prep/targeting.js

- **IMPLEMENT**: `readiness({ stage, success_rate })`; `rankCompetencies(competencies)` (pinned formula + deterministic ties); `daysToInterview(interviewAt, now)` via `toUtcDate` imported from `./dates.js` (whole-UTC-day diff; may be negative — see pinned spacing rule); `eligible(competencies, { daysToInterview, now })` applying the spacing cooldowns with the never-empty override; `nextQuestion({ competency, questions, attempts })` returning `{ question }` or `{ mint: { axis, variantOf } }` per the pinned variant-demand ladder including `MAX_VARIANTS_PER_COMPETENCY`; `sessionsOf(attempts)` (30-min-gap split); `movement(competencyAttempts, sessionStart)` — `replayProgress` on the pre-session prefix vs the whole log, returns `'up' | null` (the ONE definition of `moved`, used by both routes); `closePayload({ competencies, sessionAttempts, ranked, queued })`.
- **PATTERN**: pure like `dates.js`; JSDoc register of the existing prep modules.
- **IMPORTS**: `toUtcDate` from `./dates.js`; `replayProgress` from `./ladder.js`. Nothing else (takes plain rows; `DIFFICULTY` numbers arrive already-numeric from the store).
- **GOTCHA**: `question.difficulty` is INTEGER in D1 (store's `DIFFICULTY` map) — sort numerically, and treat NULL difficulty as 2 (standard). `axis IS NULL` marks core rows (store.js's R3 comment) — never test `axis === 'core'`. Ranking reads the STORED `success_rate`/`stage` (targeting's cache); `movement` replays the log (the truth) — the split is the cache-vs-truth invariant, name it in the header.
- **VALIDATE**: `node --test test/prep-targeting.test.js`
- **SATISFIES**: AC "targeting order proven on fixtures", ticket "spacing compressed by time-to-interview", "session close payload"

### CREATE test/prep-targeting.test.js

- **IMPLEMENT**: fixture set of 4 competencies with distinct `importance × (1 − readiness)` products proving the full order, including a tie broken by importance; spacing: same fixtures at 2 / 7 / 30 days to interview flip eligibility per bucket, and at −2 days (post-interview, second stage) behave as the ≤ 3 bucket; the never-empty override; `nextQuestion` walking core-by-difficulty → stored variant → `{mint}`, and at 8 stored variants returning the least-recently-attempted question instead of `{mint}`; `sessionsOf` splitting on a 31-minute gap and not on 29; `movement` up on a stage rise and null on a flat session; close payload picks the stage-riser as `improved`.
- **VALIDATE**: `node --test test/prep-targeting.test.js`
- **SATISFIES**: AC #2 (targeting order on fixtures)

### CREATE src/prep/habits.js

- **IMPLEMENT**: `HABITS = ['rambles','duties_not_outcomes','no_numbers','answers_wrong_question','buries_result']`; `HABIT_LABELS` map to candidate-facing plain-language strings (memory: every visible string written for a first-time reader — e.g. `duties_not_outcomes` → "Describing duties, not outcomes"); `surfacedHabits(rows)` (active && evidence_count ≥ 2). Header: SPEC "Habits" — patterns once observed twice; never record claimed learning styles.
- **VALIDATE**: `node --test test/prep-habits.test.js`
- **SATISFIES**: AC "habit appears only at evidence_count ≥ 2"

### CREATE test/prep-habits.test.js

- **IMPLEMENT**: evidence_count 1 → not surfaced; 2 → surfaced; inactive at 5 → not surfaced; every enum member has a plain-language label.
- **VALIDATE**: `node --test test/prep-habits.test.js`
- **SATISFIES**: AC #4

### UPDATE src/portal/store.js (append the #23 section)

- **IMPLEMENT**: after the #22 section, `// ── the session engine (#23) ──` with:
  - `roleByInviteId(db, inviteId)` → `SELECT candidate_role.id AS role_id, invite.interview_at FROM candidate_role JOIN invite ... WHERE invite_id = ?` — the two values the engine needs, and NEVER `cv_text`/`ethos_text`/`jd_text` (the `briefJsonByInviteId` discipline).
  - `competenciesByRole(db, roleId)` → `id, label, importance, stage, success_rate` ordered by id.
  - `questionsByRole(db, roleId)` → question rows joined through competency (`q.id, q.competency_id, q.text, q.axis, q.difficulty, q.variant_of`), ordered by competency_id, difficulty, id.
  - `attemptsByRole(db, roleId)` → attempt rows joined through competency, plus the attempted question's `axis` (`LEFT JOIN question`), ordered by `created_at, id` (id tiebreak: `created_at` has 1-second resolution and two turns can land in one tick).
  - `questionForRole(db, { questionId, roleId })` → the question row only if its competency belongs to this role, else null — **the ownership check**; turn.js answers 404 on null so one candidate cannot attempt (or enumerate) another invite's questions.
  - `recordAttempt(db, { competencyId, questionId, mode, rating, note })` — `competencyId` is ALWAYS the one from `questionForRole`'s row, never a client-supplied value (turn.js's body has no competency field at all — an attempt filed under the wrong competency corrupts the replay silently); rating bound as `Number.isInteger(...) && 1–4 ? rating : null` (the INTEGER-affinity trap the file already documents twice); note defaults `''`.
  - `setCompetencyProgress(db, { competencyId, stage, successRate })` — UPDATE both columns.
  - `insertVariant(db, { competencyId, text, variantOf, axis, difficulty })` — id = `` `${competencyId}#v-${crypto.randomUUID()}` `` (cannot collide with `#${index}` core ids and is unique across re-mints, unlike a count-derived suffix); `axis` must be `'lateral' | 'vertical'` — throw `StoreError("missing_fields", 400)` on anything else BEFORE the insert, so the CHECK never fires as a raw 500; difficulty through the existing `DIFFICULTY` map. Returns the inserted row `{id, text}`.
  - `observeHabit(db, { roleId, label })` — `UPDATE habit SET evidence_count = evidence_count + 1 WHERE role_id = ? AND label = ? AND active = 1`; if `changes === 0`, INSERT at the DDL default 1. Returns `{ evidenceCount }` (read back after write).
  - `habitsByRole(db, roleId)`.
- **PATTERN**: the file's own sections; `requireFields`; comments in its register.
- **GOTCHA**: no D1 batch (fake-d1 can't drive it — the file says so at line 152). `attempt.rating` NULL is legal and meaningful (a revealed turn may store the rating for diagnostics — but see turn.js task: we store it; the honesty rule lives in `successRate`'s mode filter, not in nulling data).
- **VALIDATE**: `node --test test/prep-session-store.test.js`
- **SATISFIES**: ticket "state lives in #17's tables"

### CREATE test/prep-session-store.test.js

- **IMPLEMENT**: node:sqlite (`openMigrated`, `d1Shape`, `skip` — mirror `test/prep-send.test.js`'s seeding: a real invite + `persistHandover` with a small payload). Prove: `questionForRole` returns null for a question under a different invite's role; `insertVariant` writes a row passing the axis CHECK and rejects `'core'`/garbage axis with a 400 StoreError (not ERR_SQLITE_ERROR); `observeHabit` twice → evidence_count 2, once → 1; `recordAttempt` + cascade (delete the invite, attempts gone); `attemptsByRole` carries the question's axis; `roleByInviteId` returns only role_id + interview_at (assert no cv_text key).
- **VALIDATE**: `node --test test/prep-session-store.test.js` (skips gracefully under Node < 22.5)
- **SATISFIES**: schema-fit; ownership; AC #4's persistence half

### CREATE src/prep/drill.js

- **IMPLEMENT**: the in-session model call site (architecture §5, second bullet).
  - `export const SESSION_MODEL = "claude-sonnet-5";` — deliberately NOT `MODEL` from `src/generate.js` (that is the Opus Send call); a header comment says so.
  - `export const SESSION_MAX_TOKENS = 8_000;` and `export const SESSION_EFFORT = "low";` — a turn is one paragraph of feedback, and latency is the felt-experience risk (§6); the Send call's 48k/"high" reasoning does not transfer.
  - `export const SESSION_SYSTEM` — carries the two non-negotiables VERBATIM in the register of `PREP_SYSTEM` rules 1–2 ("NEVER write the candidate's answer in their voice", "NEVER coach fabrication"), plus: no score/rank/verdict ever (rule 4's register), one improvement not five, specific-over-kind tone, "the rating you return is internal to the engine and never shown", habit = only what they actually did, from the fixed list, `none` when unsure.
  - `FEEDBACK_SCHEMA`: `{ worked: str, improvement: str, rating: {enum:[1,2,3,4]}, habit: {enum:[...HABITS,'none']} }`, `additionalProperties: false`, all required. Descriptions state the constraints ("what already worked, specifically, one or two sentences — never a rewritten answer"). **There is no field an answer could travel in** — that is the "structured so the UI cannot receive a finished answer" mechanism, same move as the closed block vocabulary.
  - `NUDGE_SCHEMA`: `{ nudge: str }` — "a reframe or ONE probing sub-question; content-free: it must not contain material the answer would".
  - `REVEAL_SCHEMA`: `{ skeleton: strings }` — headings the candidate fills in, EXACTLY the StoryBankCard skeleton contract (`src/prep/schema.js:60–66`), never sentences in their voice. A reveal is structurally a list of headings — prose is unrepresentable.
  - `VARIANT_SCHEMA`: `{ text: str, difficulty: {enum:['gentle','standard','probing']} }` (axis is the CALLER's decision from targeting — do not let the model pick it).
  - `assertFeedback / assertNudge / assertReveal / assertVariant` — runtime twins (vocabulary re-enforced; non-empty strings; skeleton entries 1–8; the assert-twin argument from schema.js's header).
  - Four exported functions, each mirroring `generateBrief`'s guard order (client passed in; stream; refusal → `StoreError("model_refused", 502)`; max_tokens → `StoreError("truncated", 502)`; no text → 502; parse → assert → `StoreError("bad_turn", 502)` on shape): `feedbackOnAttempt(client, { question, answerText, mode, competencyLabel })`, `mintNudge(client, { question, competencyLabel })`, `mintReveal(client, { question, competencyLabel })`, `mintVariant(client, { axis, baseQuestion, competencyLabel, roleTitle })`. Messages are plain single-user-turn, NO `cache_control` (each turn's content is unique; there is no reusable prefix worth a breakpoint) and NO reading of client-note material (the session engine never touches `ethos_text` — the brief already consumed it; keeping it out keeps the seam clean). `thinking: { type: "adaptive" }`, `betas: [FALLBACK_BETA]`, `fallbacks: "default"` — import `FALLBACK_BETA` (only) from `../generate.js`.
  - Stateless header ⚠ in the register of generate.js's: the answer text lives for the life of the call and is written nowhere except `attempt.note` — see turn.js task — and never a log line.
- **GOTCHA**: `output_config.format`, never `output_format`. Enum not min/max. The variant prompt must include the base question and forbid re-asking it verbatim (lateral = same competency, different scenario; vertical = the follow-up probe — quote SPEC's axis definitions in the prompt text).
- **VALIDATE**: `node --test test/prep-drill.test.js`
- **SATISFIES**: AC "every model prompt carries the two non-negotiables", AC "feedback output is structured so the UI cannot receive a finished answer", ticket "feedback per turn via claude-sonnet-5", "lateral/vertical variants generated live"

### CREATE test/prep-drill.test.js

- **IMPLEMENT**: fake-client pattern from `test/prep-generate.test.js`. Assert: model is `claude-sonnet-5` on all four calls; `SESSION_SYSTEM` contains both non-negotiable phrases (string-contains on "candidate's answer in their voice" and "coach fabrication") — and so does `PREP_SYSTEM` (one test pinning BOTH prompts, the AC's "every model prompt"); FEEDBACK_SCHEMA has `additionalProperties: false` and exactly the four keys (no answer-shaped field); reveal schema is headings-only; refusal → `model_refused` 502; truncation → `truncated`; a feedback payload with a fifth field / out-of-enum habit fails `assertFeedback`; variant call's request carries the caller's axis in the prompt and the schema has no axis field.
- **VALIDATE**: `node --test test/prep-drill.test.js`
- **SATISFIES**: AC #5 (both halves)

### CREATE functions/prep/api/session.js

- **IMPLEMENT**: `GET /prep/api/session` → 200. Mirror `brief.js` exactly (env.DB 503 guard → `requireSession` → reads → projection → `errorResponse`; no sameOrigin on GET). Load `roleByInviteId` (404 `not_found` if no handover yet — brief.js's "real state" register), competencies, questions, attempts, habits. Compute: ranked+eligible list via targeting; the next question; sessions via `sessionsOf`; close payload of the LAST COMPLETED session (null if none); `suggest_close` state of the current one. Respond with the candidate projection only:
  ```
  { competencies: [{id,label,covered,moved}], next_question: {id,text} | null,
    habits: [plain-language strings, evidence≥2 only], last_close: {...} | null,
    turns_this_session: n, suggest_close: bool }
  ```
  **Zero model calls, zero `ANTHROPIC_API_KEY` reads** — this is the "cached core questions return without a model call" AC made structural: the file must not import the sdk or drill.js.
- **GOTCHA**: `moved` comes from targeting's `movement()` (replay-based — the stored stage columns cannot answer "moved this session" on their own), scoped to the latest session's attempts, not all-time. Zero competencies (recruiter struck them all before Send) → `next_question: null`, empty lists, 200 — a done-state, not an error. Never serialise stage/success_rate/importance/difficulty/axis — write the response object literally, no spreads of store rows (projection.js's argument: a spread is one refactor away from a leak).
- **VALIDATE**: `node --test test/prep-turn.test.js` (shared route-test file covers both routes)
- **SATISFIES**: ticket "sessions resumable", "session close payload", latency AC

### CREATE functions/prep/api/turn.js

- **IMPLEMENT**: `POST /prep/api/turn`, in the pinned execution order (see "Turn execution order & failure semantics" above — the order IS the recovery story, restate it in the file header). Guards, all before any spend or write: env.DB 503 → `sameOrigin` 403 → `readJson` → ALLOWED-keys 400 → action/mode/rung vocabulary 400 → `answer_text` length cap (verify `cleanInput` in `src/prompt.js` first — reuse its cap if the shape fits, else a local ~20_000-char guard → 400 `too_long`) → `requireSession` 401 → `if (!env.ANTHROPIC_API_KEY) return json({ error: "no_model_key" }, 503)` (prepare.js's guard) → `questionForRole` ownership (404 on null). Body vocabulary (`ALLOWED = new Set(["action","question_id","mode","rung","answer_text"])` — `rung` and `mode` are DIFFERENT words on purpose: a rung is a help step, a mode is what the attempt turned out to be, and one field carrying both meanings is how a `'nudge'` ends up in the mode CHECK):
  - `{action: 'help', question_id, rung: 'nudge'|'reveal'}` → `mintNudge`/`mintReveal` → `{ nudge }` or `{ skeleton }`. **No attempt row** — the help rung is not the attempt; the client reports the rung reached in the eventual attempt's `mode` (SPEC records which rung was REACHED, and the attempt is the unit of record; the DB CHECK on `attempt.mode` is the backstop the architecture names).
  - `{action: 'attempt', question_id, mode: 'recall'|'nudged'|'revealed', answer_text}` → per the pinned rules: empty `answer_text` is a 400 for `recall`/`nudged`, legal for `revealed` (skips the feedback call, `rating: null`, `feedback: null` in the response). Otherwise `feedbackOnAttempt` FIRST (a refusal 502s a turn that left no state) → `recordAttempt` with the competency id FROM THE QUESTION ROW and `note: ''` (**the answer text is NOT persisted** — decision 13's minimisation posture: feedback already extracted its value, and a stored transcript is candidate data with no reader) → `replayProgress(attemptsByRole …)` → `setCompetencyProgress` → `observeHabit` when habit ≠ 'none' → next question via targeting, where `{mint}` triggers `mintVariant` + `insertVariant` inside a try/catch that DEGRADES to `next_question: null` (pinned rule 4 — never 502 a turn whose attempt is already safe) → respond:
  ```
  { feedback: { worked, improvement } | null,
    habit: plain-language | null (only when this observation made evidence_count exactly 2),
    next_question: {id,text} | null, competency: {id,label,moved}, turns_this_session, suggest_close }
  ```
  - Anything else → 400 `unexpected_fields` / `missing_fields`.
- **GOTCHA**: ratings/stages never in the response; `moved` comes from targeting's `movement()` helper, the same definition session.js uses. `answer_text` never in an error message or log (generate.js's ⚠ register — say it in the header). A non-empty `revealed` attempt still gets feedback and a stored rating; honesty is enforced by `successRate`'s mode filter, not by nulling data. Double-submit needs no lock: both requests replay the full log (the cache-vs-truth invariant — comment it).
- **VALIDATE**: `node --test test/prep-turn.test.js`
- **SATISFIES**: ticket "one POST per turn", "attempt → nudge → reveal with mode recorded", AC #1 end-to-end

### CREATE test/prep-turn.test.js

- **IMPLEMENT**: node:sqlite + fake Anthropic client, seeding through `createInvite` + `persistHandover` (prep-send.test.js's fixtures), cookie via the same token/hash helpers prep-auth tests use. Route-level proofs:
  - **The honesty rule end-to-end**: two `revealed` attempts with fake-client rating 4 → competency `success_rate` still 0 and stage still `''`; then one `recall` rating-4 attempt → rate rises, stage `can_answer`.
  - Turn responses and session GET carry NO `success_rate`/`stage`/`importance`/`rating`/`difficulty` keys anywhere in the JSON (deep-scan the parsed body).
  - Session GET succeeds with `env` lacking `ANTHROPIC_API_KEY` and a fake client that throws if constructed (the no-model-call latency AC).
  - Ownership: attempting a second invite's question_id → 404.
  - Habit: first observation absent from response, second observation surfaces the plain-language label.
  - Variant minting: exhaust a competency's core questions with successes → next turn's fake client receives a variant request and the response's next_question is the minted row, persisted with `axis='lateral'`.
  - **Mint failure degrades**: fake client throws on the variant call only → turn still 200 with feedback and `next_question: null`, and the attempt row exists.
  - **Refusal leaves no state**: fake client refuses the feedback call → 502 `model_refused`, zero attempt rows.
  - Empty `answer_text` on `revealed` → 200, `feedback: null`, no feedback model call, attempt row with rating NULL; empty on `recall` → 400.
  - Help rung: `action:'help', rung:'nudge'` returns a nudge and writes no attempt row; `rung:'attempt'` / `mode:'nudge'` → 400 (the two vocabularies don't cross).
  - Habit announced only on the turn where evidence_count hits exactly 2 (turn 1: silent; turn 2: announced; turn 3: silent in turn response, present in session GET).
  - 401 with no cookie; 403 cross-origin POST; 400 on a fourth mode / unexpected field.
  - Use a shared recursive `assertNoKeys(body, ['success_rate','stage','importance','rating','difficulty','axis','variant_of'])` helper for the leak scans.
- **VALIDATE**: `node --test test/prep-turn.test.js`
- **SATISFIES**: every AC end-to-end

### UPDATE docs — none required

`docs/epics/candidate-portal.architecture.md` already states §5's session call; SPEC is the contract and is not edited by implementation tickets. If any pinned constant proves to diverge from SPEC during implementation, STOP — that is a bug in this ticket by the ticket's own words, not a doc edit.

---

## TESTING STRATEGY

### Unit Tests

`node --test`, zero dependencies (repo constraint). Pure modules (`ladder`, `targeting`, `habits`) get exhaustive fixture tables — they hold ALL pedagogy rules, so they carry most assertions. `drill.js` on the fake-client pattern: request shape, schemas, asserts, failure register.

### Integration Tests

node:sqlite (`test/helpers/sqlite-d1.js`) for everything that branches on constraints, joins, or `meta.changes` — the fake passes where the logic is wrong (its header's warning). Route tests drive the real store + real migrations + fake model client, cookie-authenticated, and are the end-to-end proof of each AC.

### Edge Cases

- Revealed attempt with the highest rating → rate unchanged (both unit and route level)
- All competencies cooling down → top-ranked served anyway (never-empty)
- Core bank exhausted → variant demanded exactly once, reused on next turn without a second mint
- Variant cap reached (8 stored) → least-recently-attempted question re-served, no mint
- Mint failure after a successful attempt → 200 with feedback, `next_question: null` (degrade, never discard a paid turn)
- Model refusal on the feedback call → 502 `model_refused`, no attempt row written (the call precedes every write)
- Empty `answer_text`: legal on `revealed` (no feedback call, rating NULL), 400 on `recall`/`nudged`
- Two attempts in the same 1-second tick → deterministic order via id tiebreak; double-submit converges via full-log replay
- Interview 2 days out → only top-half competencies eligible; interview 2 days AGO (second stage, inside +14d access) → same bucket, still drillable
- No handover row yet → 404 `not_found`, not a 500; zero competencies → 200 done-state
- Body of literal `null` / unknown fields / a fourth `mode` value / `rung` on an attempt → 400 before any model spend

## VALIDATION COMMANDS

### Level 1: Syntax & Style

No linter in repo; the gate is the suite. `node --version` must be ≥ 22.5 locally (else sqlite tests skip and prove nothing — the helper says so).

### Level 2: Unit Tests

```
node --test test/prep-ladder.test.js test/prep-targeting.test.js test/prep-habits.test.js test/prep-drill.test.js
```

### Level 3: Integration Tests

```
node --test test/prep-session-store.test.js test/prep-turn.test.js
npm test   # the whole suite — zero regressions, especially prep-send / portal-store / prep-auth
```

### Level 4: Manual Validation

```
npm run db:local && npm run dev
# seed an invite via the recruiter Send flow (or test seed), sign in via magic link, then:
curl -b cookies.txt http://localhost:8788/prep/api/session          # 200, next_question, no model call
curl -b cookies.txt -H 'Content-Type: application/json' \
  -d '{"action":"attempt","question_id":"<id>","mode":"recall","answer_text":"..."}' \
  -X POST http://localhost:8788/prep/api/turn                        # 200, feedback, next_question
```
Confirm a `revealed` turn, then GET session: the competency shows `covered` but not `moved`.

### Level 5: Additional Validation (Optional)

`/piv-validate` before commit; grep the two new Functions for `success_rate|importance|stage` appearing in any response literal (should be none).

---

## ACCEPTANCE CRITERIA

- [ ] Honesty rule: a `revealed` attempt can never raise `success_rate` — unit test AND route-level test
- [ ] Targeting order `importance × (1 − readiness)` proven on fixtures, ties deterministic
- [ ] Stage transitions match SPEC's ladder table (fixtures per row; stage 4 unreachable in pilot)
- [ ] Habit surfaces only at `evidence_count ≥ 2`
- [ ] `SESSION_SYSTEM` and `PREP_SYSTEM` both carry the two non-negotiables, pinned by one test
- [ ] Feedback/nudge/reveal schemas structurally cannot carry a finished answer (closed fields; reveal = headings only)
- [ ] Cached core questions served with zero model calls (session GET works keyless)
- [ ] One POST per turn; `mode` recorded on every attempt; help rungs write no attempt
- [ ] No candidate-bound response contains `importance`, `stage`, `success_rate`, `rating`, `difficulty`, or `axis`
- [ ] Spacing buckets per SPEC's table; sessions resumable (state fully derived from D1)
- [ ] Failure semantics: refusal leaves no state; mint failure degrades to `next_question: null`; stored stage/rate always equal `replayProgress` of the log
- [ ] `npm test` green with zero regressions

## COMPLETION CHECKLIST

- [ ] All tasks completed in order, each validation run immediately
- [ ] Full suite green on Node ≥ 22.5 (sqlite tests ran, not skipped)
- [ ] Manual curl pass confirms both routes
- [ ] No store row spread into a response object anywhere
- [ ] Branch `feature/session-engine` (worktree memory: verify branch before commit — HEAD moves under parallel sessions), PR body `Closes #23`

## OPEN QUESTIONS / ASSUMPTIONS

1. **Pinned thresholds** (success = rating ≥ 3; holds_up at ≥ 4 attempts & rate ≥ 0.6 & one variant success; unaided at 3 trailing recall successes; 30-min session gap; 6-turn suggest_close; top-half eligibility at ≤ 3 days; 8-variant mint cap). SPEC is qualitative here; these are engineering choices made to be falsifiable and one-line-changeable — each is an exported constant with a test. If any reads as SPEC divergence during review, it goes back to the owner rather than being silently retuned.
2. **Answer text not persisted** (`attempt.note` stays `''`). SPEC's state table has `note`; this plan reads that as engine annotation, not transcript, on decision 13's minimisation posture. If #24 wants "show my past answers", that is a scope change with a retention consequence — flag, don't add.
3. **Help rungs are model calls per press** (nudge/reveal not cached). At sonnet pricing and pilot scale this is inside decision 6's £1–1.75 envelope; if cost pressure appears, cache reveals per question in the `question` row later.
4. **`rating` on non-empty revealed attempts is stored** (excluded from the rate by the mode filter, kept for diagnostics); an EMPTY revealed attempt stores NULL and skips the feedback call. The mode filter is the single enforcement point either way, and the honesty test pins it.
5. **Replay cost**: `replayProgress` runs over one competency's attempts per turn (tens of rows at pilot scale — a candidate produces ~6 attempts per 10-minute session). If a pathological log ever mattered, the stored columns are already the read cache; no premature optimisation.

## NOTES (open canvas)

- **Why three pure modules instead of logic in the Function**: the same argument the repo makes for `src/generate.js` vs its Function — a Function can't be imported into `node --test`, and every AC here is a rule assertion. The Functions end up thin adapters (~150 lines each) over ~450 lines of tested rules.
- **Why no session table**: resumability falls out of deriving everything from the attempt log; a session row would be a second source of truth that can disagree with it, and it would be one more thing the purge has to take. The 30-min gap heuristic is a projection, not state.
- **Why the fold (`replayProgress`) is the spine**: it solves four problems with one mechanism — `moved` without stage-history columns, crash recovery between untransacted writes (stale cache heals on next replay), double-submit convergence without locks, and a testable invariant (`stored == replayed`) that any future bug in the write path violates loudly. The cost is re-deriving per turn, which at ~6 attempts/session is nothing.
- **Why variants persist in `question`**: decision 6 says "generated live", but a minted variant is a question like any other — storing it makes the next serve free (the latency constraint), makes `variant_of` meaningful, and dies in the same cascade. `assertBrief` keeps `lateral|vertical` out of the SEND call; the CHECK keeps `'core'` out of the column; the two constraints meet exactly as 0002's comments predicted.
- **Rejected: one combined feedback+next-question model call.** Feedback needs the model; next-question is deterministic from the bank (and must be, for the latency AC). Combining them would put targeting in the model's hands, which is the one thing the JD-derived ranking exists to prevent.
- **Latency picture per attempt-turn**: 1 sonnet call (feedback), +1 only when a variant is minted. Help rungs: 1 small call each. GET session: 0. That is the §6 "dead air" budget honoured as far as request/response allows; SSE stays #19's later polish.
- **Leak surface checked**: store reads never select `cv_text`/`ethos_text`; drill.js prompts carry only question text, competency label, role title, answer text; responses are hand-built literals. The projection discipline is stated in three places (projection.js, brief.js, this plan) — keep it stated in the two new Functions' headers too.

## AMENDMENTS

