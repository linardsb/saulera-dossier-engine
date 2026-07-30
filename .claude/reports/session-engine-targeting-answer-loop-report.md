# Implementation Report — Session engine: targeting, answer loop, readiness, habits (#23)

**Plan**: `.claude/plans/session-engine-targeting-answer-loop.md`   **Branch**: `feature/session-engine`   **Status**: COMPLETE

## Summary

The server-side pedagogy engine for the candidate prep portal. Three pure modules (`ladder`,
`targeting`, `habits`) hold every SPEC rule and are fixture-tested with zero I/O; a `#23`
section in `src/portal/store.js` adds the D1 reads/writes; `src/prep/drill.js` owns the four
`claude-sonnet-5` call shapes with schemas that make a finished answer unrepresentable; and two
Functions adapt it to HTTP — `GET /prep/api/session` (pure DB, structurally model-free) and
`POST /prep/api/turn`. All state derives from the attempt log (`replayProgress`), so sessions
are resumable with no session table and the stored stage/rate columns are recompute-then-write
caches. Verified live end-to-end against the real API, including a caught-and-fixed plan bug
(see Deviations #1).

## Tasks completed

- Export `toUtcDate` → `src/prep/dates.js` (UPDATE, one word)
- Ladder rules (honesty rule, stage transitions, `replayProgress` fold) → `src/prep/ladder.js` (CREATE)
- Targeting (readiness, ranking, spacing, variant demand, sessions, movement, close, shared `drillState`) → `src/prep/targeting.js` (CREATE)
- Habit vocabulary + surfacing rule + plain-language labels → `src/prep/habits.js` (CREATE)
- `#23` store section (role/competency/question/attempt/habit reads; recordAttempt, setCompetencyProgress, insertVariant, observeHabit) → `src/portal/store.js` (UPDATE, append-only)
- Sonnet call site (SESSION_MODEL/SYSTEM, 4 schemas + assert twins, 4 call functions) → `src/prep/drill.js` (CREATE)
- Session GET (resume point, zero model calls) → `functions/prep/api/session.js` (CREATE)
- Turn POST (attempt + help rungs, pinned execution order) → `functions/prep/api/turn.js` (CREATE)

## Tests added

- `test/prep-ladder.test.js` — 26 tests: honesty rule from both directions, all transitions, fold associativity, all-revealed log
- `test/prep-targeting.test.js` — 21 tests: full ranking order + tie, spacing buckets at 2/7/30/−2 days, never-empty override, variant-demand ladder, 8-variant mint cap, 29/31-minute session split, movement, close payload
- `test/prep-habits.test.js` — 4 tests: threshold 2, inactive hidden, labels plain-language
- `test/prep-session-store.test.js` — 8 tests (node:sqlite): ownership null, axis CHECK → 400 not ERR_SQLITE_ERROR, observeHabit upsert + inactive restart, rating affinity guard, cascade, id tiebreak, no privileged columns
- `test/prep-drill.test.js` — 9 tests: model pinned, both system prompts carry both non-negotiables, closed schemas (no answer-shaped field, reveal = headings, no axis field), assert twins, refusal/truncation/bad-shape register, **no `fallbacks`/`betas` on the request**
- `test/prep-turn.test.js` — 15 tests (node:sqlite + fake client, cookie-authed): honesty end-to-end, recursive leak scan on both routes, keyless session GET, ownership 404, habit announced exactly at 2, mint + reuse without re-mint, mint failure degrades, refusal leaves no state, empty revealed vs empty recall, help rungs write no attempt, vocabulary crossing 400s, 401/403/503 doors, no-handover 404, zero-competency done-state, suggest_close at 6

## Validation results

- **Full suite**: `node --test test/*.test.js` on Node v24.11.0 — **648 pass, 0 fail, 0 skipped** (sqlite tests ran)
- **Leak grep**: no `importance|stage|success_rate|rating|difficulty|axis` in any response literal of the two Functions (remaining hits are store-write arguments); the route tests also deep-scan every response body
- **Live manual pass** (wrangler dev, real D1, real `ANTHROPIC_API_KEY`):
  - unauthenticated GET/POST → 401; keyless POST → 503 `no_model_key`
  - authenticated session GET → 200 projection, zero model calls
  - empty-revealed turn → 200, `feedback: null`, attempt row `rating NULL`, no feedback spend
  - real attempt turn → 200 in ~5s with genuinely specific feedback (model rated it 2, internally only), next question from the cached bank, `note` empty
  - stored `stage`/`success_rate` equal the replay of the log after every turn
  - live `mintVariant` probe → a real lateral variant persisted with `axis='lateral'`

## Deviations from the plan

1. **No `fallbacks`/`FALLBACK_BETA` on the session calls** (plan pinned `betas: [FALLBACK_BETA], fallbacks: "default"`). The live manual pass caught a 400: `'claude-sonnet-5' does not support the fallbacks parameter` — every session call would have failed in production while the fake-client tests stayed green. drill.js now uses the plain `client.messages` namespace with no beta anything; a refusal is answered honestly as `502 model_refused` (already the guard path). A test pins `req.fallbacks === undefined` so the pair cannot be re-added by symmetry with generate.js.
2. **Session GET degrades a `{mint}` demand to the least-recently-attempted question** instead of returning `next_question: null`. The plan forbids model calls on GET but did not say what to serve when targeting demands a mint (e.g. resuming after a mint failure); serving the LRA question keeps the drill alive and the next attempt turn re-demands the mint.
3. **`drillState` composition helper added to `src/prep/targeting.js`** (not in the plan's function list). Both routes need the identical ranking/eligibility/demand/queue walk, helper modules under `functions/` are live endpoints (src/http.js's rule), and duplicating ~40 lines across the two Functions is how they would drift.
4. **`mintVariant` is called without `roleTitle`** (optional in drill.js, included in the prompt when present). Supplying it would mean reading `brief_json` — a recruiter artefact — inside the turn route for one prompt nicety; the leak-surface discipline won.
5. **`questionForRole` also selects `competency_label`** (plan said "the question row only"). Every model prompt needs the label and a second query would re-run the same join.
6. **The fake client is injected via `context.data.client`** in turn.js (`context.data?.client ?? new Anthropic(...)`) so route tests can hand in a fake without stubbing the SDK module. Pages middleware never sets `data.client`, so production always constructs the real client behind the `no_model_key` guard.

## Issues encountered

- The first live smoke ran the plan's original fallbacks pair and surfaced deviation #1 — this is exactly what the Level-4 manual pass exists for; the fix was verified live before completion.
- node:sqlite returns null-prototype rows (`assert.deepEqual` against object literals fails) — tests compare fields individually.
- Smoke-seed cleanup via the sqlite3 CLI needs `PRAGMA foreign_keys=ON` or the cascade silently doesn't run (the same gotcha `test/helpers/sqlite-d1.js` documents); local dev DB was cleaned up correctly.

## Acceptance criteria

All twelve plan ACs verified: honesty rule (unit + route), targeting order on fixtures with
deterministic ties, stage transitions per SPEC's table with stage 4 unreachable, habits at
evidence ≥ 2, both prompts carry the two non-negotiables (one test), schemas structurally
answer-free, keyless session GET, one POST per turn with mode recorded and help rungs writing
no attempt, no score-shaped key in any candidate-bound response, spacing buckets + resumability,
refusal-leaves-no-state / mint-degrades / stored-equals-replayed, `npm test` green (648/0).
