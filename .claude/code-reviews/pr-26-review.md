# PR #26 Review — portal schema, retention purge, delete-now and the GDPR surface

**Verdict: Approve.** No critical or high issues. Validation is green on both Node versions in a clean
worktree of the PR branch. The diff does what the PR says it does, the four documented deviations all
check out as described, and the deliberate schema-test boundary move is executed the way the old test's
own comment asked for. Three findings below (2 medium, 1 low) — none blocks merge; issue 2 is the one
worth fixing soon, ideally while `0002_portal.sql` is still cheap to amend.

Reviewed with fresh eyes in an isolated worktree by a clean-context review agent; every changed
implementation file read in full, claims verified empirically (EXPLAIN QUERY PLAN, seeded malformed
rows, consumer greps). Note: the repo has no `.claude/agents/code-reviewer.md`, so a general-purpose
clean-context agent carried the review rubric from the plan's own Patterns section.

## Issues

### Medium

**1. The purge's stated performance mechanism is false — `invite_by_interview` is never used by the purge.**
`src/portal/store.js:32` (comment; echoed in the plan and report). The docstring says the index "keeps
that every-request guard cheap", but the WHERE clause wraps the column in a function —
`datetime(interview_at, '+30 days') <= datetime('now')` — which defeats the index. Verified:
`EXPLAIN QUERY PLAN` shows `SCAN invite` for the shipped statement, versus a covering-index search for
the equivalent `interview_at <= datetime('now', '-30 days')`. No functional failure at pilot scale, but
the middleware awaits this full-table scan on every `/prep/*` request and the load-bearing justification
in code, plan and report is untrue.
**Fix (minimal):** correct the comment — state the scan is acceptable at this scale, or that the index
serves #22's lookups. **Alternative:** rewrite the predicate to `interview_at <= datetime('now', '-30 days')`
(same `<=` boundary, index-usable) — but that means updating the `'+30 days'` literal locks in
`test/portal-store.test.js`, `scripts/purge.py`'s `PURGE_SQL`, and the data note's boundary sentence together.

**2. An unparseable `interview_at` makes a candidate's entire scope immortal, silently.**
`migrations/0002_portal.sql:18` / `src/portal/store.js:37`. `datetime('not a date')` is NULL;
`NULL <= datetime('now')` is NULL; the row is never deleted and no error is raised, so the fail-open
middleware logs nothing. Verified by seeding: ISO-8601 `'T'`/`'Z'` and date-only forms purge correctly
(the migration comment's claim holds), but a garbage row survives every purge forever. The privacy page's
"deleted automatically 30 days after your interview date" rests on a format invariant nothing enforces at
rest — `interview_at` is `NOT NULL` but format-unconstrained, and its writer (#22) doesn't exist yet.
**Failure scenario:** #22 or a manual insert during pilot support writes a malformed date once; that
candidate's JD, CV and attempts persist indefinitely, breaching the stated GDPR posture with no signal.
**Fix (while 0002 is unmerged/cheap):** add `CHECK (datetime(interview_at) IS NOT NULL)` to `invite` —
the lockfile's parser handles a parenthesised column CHECK. **Alternative:** widen the purge WHERE with
`OR datetime(interview_at) IS NULL` — an undated scope cannot honour retention, so deleting it is the
defensible reading of decision 13.

### Low

**3. Stale contract comment on the events endpoint, created by this PR.**
`functions/api/events.js:2` documents `GET /api/events -> { total, per_client: [{ client_id, packs }] }`,
but `eventCounts` (changed here, `src/store.js:354-370`) now returns per-client rows carrying
`invites_sent`/`invites_opened` too. The shape change is a documented deviation; the endpoint's own
contract line contradicting it is not. **Fix:** one-line comment update.

## Explicitly checked and clean

Migration DDL byte-equivalent to the plan's/architecture §4's shapes · lockfile parser sound against
comma-bearing CHECKs and parenthesised defaults, self-guards fail loudly on unreadable forms ·
`hashToken` correct SHA-256 hex with the `"abc"` vector locked · `delete.js` mirrors `events.js`
guard-for-guard with no token leak path · `purge.py` list-args subprocess, constant SQL, no injection
surface, mirrors `dev.py`'s pin/PATH conventions · `listClients`'s only consumers read `client.packs`,
semantics preserved by the kind filter · privacy.html links/classes/tokens all resolve, no raw hex,
noindex via meta and `_headers`, delete wording uses the plan's sanctioned phrasing · the 30-day `<=`
boundary stated identically in privacy.html, data note, purge SQL and tests.

## Validation

| Check | Result |
|---|---|
| `npm test`, Node 20.20.2 (clean PR worktree) | 249 pass, 0 fail, 4 designed skips (`node:sqlite` fixtures) |
| `npm test`, Node 24.11.0 | 253 pass, 0 fail, 0 skipped — purge fixtures included |
| `node --check` ×4 · `py_compile scripts/purge.py` | pass |
| `console.log`/TODO/FIXME in new code · raw hex in privacy.html | none |

(The PR body's 300/304 counts were recorded in the shared worktree that also carried the candidate-brief
seam's tests; the clean PR branch carries 253. Zero failures in both settings.)

## What's good

- **The schema lockfile is genuinely well-engineered**: a balanced-paren parser whose blind spots are
  themselves failing tests ("teach the parser or fail"), exact sorted column locks per table, the cascade
  chain asserted FK-by-FK, the closed `kind` vocabulary extracted from the ALTER. A drive-by schema
  change has essentially no silent path through it.
- **`test/portal-purge.test.js` proves the thing that matters** against real SQLite with
  `PRAGMA foreign_keys = ON` (the exact D1-vs-SQLite trap, named in the header), applies the ALTER onto a
  populated table, asserts the exact −30d boundary, and demands survivors byte-identical — not just counts.
- **Clean layering under pressure**: the whole delete lifecycle is one pure module importing the shared
  `StoreError`; the raw token exists only in memory between `readJson` and `hashToken`, with an error
  path structurally incapable of echoing it.
- **The GDPR surface is coherent end-to-end**: privacy page, data note, migration comments, purge SQL and
  the `'+30 days'` test lock all state the same boundary, so the retention promise cannot drift without a
  test failing.

## Recommendation

Merge. File issues 1–3 as a small follow-up (or amend 0002 with the `interview_at` CHECK before merge —
cheapest now). A human reviews this review + the code and makes the final call.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01WTLD6GdCcbyWqNwE4tEBtZ
