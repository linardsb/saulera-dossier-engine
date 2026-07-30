# PR #35 Review — Session engine: targeting, the answer loop, readiness and habits (#23)

**Verdict: Approve.** No Critical or High issues. The core logic (fold/replay consistency, the honesty rule, write ordering, ownership checks, leak projection discipline) is correct and unusually well defended by tests. The two Medium findings are test-coverage gaps around already-correct code, suitable for a fast follow-up — nothing blocks merge.

## Validation

| Check | Result |
|---|---|
| `node --test test/*.test.js` (Node 24.11.0) | **648 pass, 0 fail, 0 skipped** |
| Same suite on Node 20 | 553 pass, 0 fail, 95 skipped (`node:sqlite` needs ≥ 22.5 — see Low #6) |
| Claude API usage (`claude-sonnet-5`) | Correct: plain non-beta `messages.stream`, adaptive thinking, `output_config.{effort, format}` structured outputs, no sampling params, no `budget_tokens`, no prefill, no `fallbacks` (documented deviation #1, verified live and regression-pinned) |
| Security | Both routes behind `requireSession`; turn route adds same-origin + closed body vocabulary; `questionForRole` is a real ownership join answered with 404; all SQL bound; recursive route-test scan proves no `importance/stage/success_rate/rating/difficulty/axis/variant_of` in candidate-bound bodies |

The six deviations documented in `.claude/reports/session-engine-targeting-answer-loop-report.md` were treated as intentional decisions and are not findings.

## Issues

### Medium

**M1 — `functions/prep/api/session.js:63-105`: session-boundary and `last_close` arithmetic untested at route level.**
The trickiest code in the GET route — `currentIsLive`, `completed = sessions.slice(0,-1)`, `after = sessions[completed.length]`, and the `lastClose` window — is exercised by zero tests; every route test observes `last_close: null` on a live session. The current indexing traces correct by hand; the risk is regression, not present-day breakage. *Fix:* a route test seeding backdated `created_at` attempts (two sessions split by > 30 min), asserting `last_close.improved/next/queued` and `turns_this_session: 0`, plus the live-session variant.

**M2 — `functions/prep/api/session.js:98-105`: documented deviation #2 (GET degrades a `{mint}` demand to the least-recently-attempted question) has no test.**
The mint-failure route test (`test/prep-turn.test.js:290`) stops after the POST and never issues the follow-up GET. A regression could return `next_question: null` exactly for the candidate who just hit a mint failure, dead-ending the drill UI. *Fix:* extend that test with a `getSession` call asserting `next_question` is a real least-recently-attempted question and the fake client saw no new variant call.

### Low

**L1 — `src/portal/store.js:611-629` (`observeHabit`): non-atomic upsert with no unique backstop can double-count evidence.**
UPDATE-then-INSERT with no `UNIQUE(role_id, label)` in `migrations/0002_portal.sql`; two concurrent double-submitted turns can both insert an active row for one label, after which every later observation increments both. Low stakes (single candidate, needs a race) and habits are outside the log-replay invariant, so it does not self-heal. *Fix:* partial unique index `ON habit (role_id, label) WHERE active = 1` + `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`, or document the accepted race.

**L2 — `src/prep/targeting.js:54-59, 73-88`: cooldown comment says "whole days" but the check is wall-clock milliseconds.**
At 7 days out, a competency attempted 47.9 hours ago is still "cooling" though two calendar days have passed. Behavior is defensible; make the comment match the code, or floor both sides to UTC days like `daysToInterview` does.

**L3 — `src/prep/targeting.js:218-248` (`closePayload`): the biggest-rate-rise fallback branch is untested.**
Fixtures cover the stage-riser and the flat session; nothing exercises "no stage rise, pick the biggest rate riser," so `bestRateRise` selection (including the strict `> 0` guard) is unproven.

**L4 — `functions/prep/api/turn.js:61, 90`: the `too_long` 400 (`ANSWER_MAX = 20_000`) has no test.**
A one-line test with a 20,001-char `answer_text` would pin the cap and its costs-nothing ordering (no model call, no write).

**L5 — Informational: variant ids leak "minted-ness."**
`insertVariant` ids are `${competencyId}#v-<uuid>` (`src/portal/store.js:595`) and ride out in `next_question.id`, so the client can tell a minted variant from a core question — though not its axis or difficulty, which is what the projection rule actually forbids. Acceptable as-is; noted so it's a decision, not an accident.

**L6 — Environment: CI should pin Node ≥ 22.5.**
On Node < 22.5 all 23 `node:sqlite` tests skip (with a clear message) — including the headline honesty-rule route test. The skip is graceful, but a CI runner on old Node would silently stop proving the store/route half.

## Done well

- **`replayProgress` as the single source of truth** (`src/prep/ladder.js:93-101`): one pure fold buys `moved` without stage-history columns, crash recovery between untransacted D1 writes, and double-submit convergence — with the fold's prefix-continuation invariant pinned directly in tests.
- **Turn execution order is the recovery story, and the code matches it exactly**: every 4xx before any spend, the feedback call before any write (a refusal leaves zero rows — proven at `test/prep-turn.test.js:314`), writes in dependency order, mint last inside a degrade-only catch.
- **The honesty rule lives in one place and is tested from both directions** — the mode filter in `successRate` hits denominator and numerator, with symmetric unit fixtures and an end-to-end route test against the real schema.
- **Leak discipline is structural, not aspirational**: hand-built response literals, a recursive deep-scan over both routes' JSON, and `session.js` proven model-free by a source-level import assertion.
- **The live smoke pass caught a real production-killer** (`claude-sonnet-5` rejecting the `fallbacks` param) that fake-client tests could never see, and the fix is pinned with `req.fallbacks === undefined` assertions so the regression cannot silently return.

## Recommendation

**Approve.** Suggested follow-up (non-blocking): the two Medium test additions (M1, M2), the `habit` unique index (L1), and a CI Node-version pin (L6).
