# Code Review — PR #32 · round 2, after the fix commit

**Branch** `feature/send-to-candidate` → `main` · **head** `7235d68` (matches the PR head exactly; reviewed in
place) · 40 files, **+7,306 / −131**.

Round 1 reviewed `4e40674` and found **6 High · 10 Medium · 6 Low**; that report is at
`.claude/code-reviews/pr-32-review.md` and is left in place. `7235d68` is the fix commit — **+1,661 / −110
across 24 files**, itself unreviewed code. This round does two things: **verifies the fixes actually hold**, and
**reviews the fix commit as new code**.

The fix commit makes one claim that decides this review: *"Each fix carries a test that DIES when the fix is
reverted."* A green suite cannot establish that — round 1's most damaging findings were tests that could not
fail. So the fixes were **mutation-tested**, not read.

> Recommendation posted as a comment: GitHub refuses both `--approve` and `--request-changes` from the PR
> author's own account.

---

## Validation — re-run on this head, not quoted

| Level | Command | Result | PR body claims |
|---|---|---|---|
| 2 | `npm test` (Node 24.11.0) | **577 tests · 577 pass · 0 fail · 0 skipped** | 548 — **stale** |
| 2 | `npm test` (Node 20.20.2, machine default) | **577 · 505 pass · 0 fail · 72 skipped** | 548 / 53 skipped — **stale** |
| 5 | `node .claude/probes/one-screen.mjs` (Node 24) | **34/34 probes pass** | 27/27 — **stale** |
| — | baseline `fd1e0b4` (Node 24, isolated worktree) | 464 · 464 pass · 0 skipped | → **+113 new tests**, not 84 |
| 3 | `npm run db:local` | `No migrations to apply`; **11 application tables** + `d1_migrations` | ✅ "adds no migration" |
| 1 | Level 1 gates from the plan | **all `ok` except the R1 route-split gate** — see M-A | claims "every Level 1 gate ok" |
| 4 | live sweep on `:8788` | all as documented — table below | ✅ |

Live sweep (only requests refused **before** any write — no real send was performed):

| Request | Response |
|---|---|
| `GET /`, `/clients`, `/counts`, `/prep/`, `/prep/login`, `/prep/brief`, `/prep/privacy` | `200` |
| `GET /prep/api/brief`, no session | `401 {"error":"invalid_token"}` |
| `POST /api/prep/send` `{field_keys}` | `400 {"error":"unexpected_fields","fields":["field_keys"]}` |
| `POST /api/prep/prepare` `interview_at: 2020-01-01` | `400 {"error":"interview_past"}` |
| `POST /api/prep/prepare` `interview_at: 2226-01-01` | `400 {"error":"interview_too_far"}` — **H6 fix, live** |
| `POST /api/prep/prepare` `interview_at: 2027-02-31` | `400 {"error":"missing_fields"}` — **M3 fix, live** (no longer a 201 storing 3 March) |
| `POST /api/prep/send`, `Origin: https://evil.example` | `403 {"error":"cross_origin"}` — **M7 fix, live** |
| `POST /api/prep/prepare`, cross-origin | `403 {"error":"cross_origin"}` — **M7 fix, live** |
| `GET /api/prep/send` (POST-only) | `404` |

**Every headline number in the PR body is now stale** (see M-B). The numbers in the fix commit's own message
(577, 34/34) are the correct ones — they just never reached the PR body or the implementation report.

---

## Fixes independently confirmed (read + run, not taken on trust)

- **H2's rollback guard is real, and placed better than the commit message describes.** The guard is not wrapped
  at the two call sites — it is *inside* `rollbackInvite` (`functions/api/prep/send.js:151-158`), which catches,
  logs `prep/send: invite rollback failed; candidate data may be orphaned` and swallows. So `rollbackInvite`
  cannot throw, and both call sites (`:325`, `:347`) reach their `throw err`. A failing DELETE can no longer
  replace `502 mail_failed` with a database error.
- **`PREP_BASE_URL` is handled correctly, which was the open question the fix round created.** The `503
  no_base_url` at `send.js:278` is explicitly *"THE LAST GATE BEFORE ANYTHING IS MINTED OR WRITTEN"* — after
  every `400`, before `mintToken()` and `createInvite`. So an unset variable costs nothing, writes nothing,
  counts nothing, and the send is safe to retry. `DEPLOY.md:433` carries a triage row saying exactly that.
  This is the good version of this fix, not the dangerous one.
- **H3's visibility gate is falsifiable now, and fixed the right way.** Rather than change `SEED_CLIENT` —
  which 25 tests depend on — the fix adds a second seed `SEED_CLIENT_WITH_NOTE` with a real note and a real
  allow-list, plus two dedicated tests (`test/prep-send.test.js:215`+) asserting the ticked heading *and* text
  travel while the unticked heading *and* text do not. The comment at `:211-213` is honest that the other 25
  remain trivially satisfied and says why these two exist.
- **M3's round-trip assertion is sound.** `src/prep/dates.js:72` asserts `stamp.slice(0, raw.length) === raw`,
  only for the zone-less forms, correctly exempting a value that carries an offset and is *entitled* to land on
  a different UTC day.
- **L1 is fixed and the copy covers the case the server actually produces.** `sendMessageFor`
  (`public/app.js:1273-1274`) now names `missing_fields` and `bad_brief`. This matters more than it looks:
  `toSqliteUtc` reuses `missing_fields` for an unparseable date, and the mapped copy — *"The email address or
  the interview date was not accepted. Check them both and try again."* — is accurate for both causes.
- **The deferrals are real, not rhetorical.** Issue **#33** (Node 20 false pass) and issue **#34** (R7's
  inflated `invite_sent`) both exist and are **OPEN**.
- **The route split itself is still correct**, independent of its broken gate: `functions/prep/` contains only
  `api`, `auth`, `_middleware.js`; no file under it references `generateBrief`, `createInvite` or
  `sendInviteEmail`; every `functions/prep/api/*.js` self-guards.
- **Level 1's other gates all pass, positive-controlled.** The HTML-sink, browser-storage and credential-leak
  greps use *unanchored* alternation, which BSD grep handles correctly — verified by feeding each one a file
  that violates it and confirming it fires.

---
