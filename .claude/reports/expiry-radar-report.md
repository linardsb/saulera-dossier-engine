# Implementation Report — the expiry radar (#70)

**Plan**: `.claude/plans/expiry-radar.md`   **Branch**: `feature/expiry-radar`   **Status**: COMPLETE

## Summary

`compliance_item.expiry_date` has been written since #67 and read by nobody; `public/prep/prep.css`
has shipped the amber and red chips since #68 with a comment saying they cannot render until this
sweep exists. This ticket is that sweep. A lazy job on the `/prep/*` middleware reads every
checklist row carrying a date, compares it against that item type's own `amberDays` from the
catalogue, and moves it to `expiring` or `expired` under a compare-and-swap. Each transition it
wins produces two grouped messages: one per candidate linking into the passport, and one digest
to the recruiter.

It ships **without a migration**. The status transition *is* the claim, so the column that records
the state is the same column that makes the nudge idempotent — `migrations/` and
`test/schema.test.js` are untouched.

The one place this deliberately diverges from #69: **the state sweep is awaited and depends on no
mail configuration; only the mail is deferred and configured.** `compliance_item.status` is what
the passport renders, so a sweep that refused to claim without `RECRUITER_EMAIL` would show a locum
a green "Sent in" chip over a certificate that lapsed in June.

## Tasks completed

| task | file | action |
|---|---|---|
| `EXPIRY_STATES` + derived `MAX_AMBER_DAYS` | `src/compliance/catalogue.js` | UPDATE |
| `dueExpiryItems` — the narrowing query, `days_left` computed by SQLite | `src/compliance/store.js` | ADD |
| `claimItemExpiry` — the compare-and-swap on `(id, status, expiry_date)` | `src/compliance/store.js` | ADD |
| `sweepExpiryStates(db)` + `mailExpiryNudges(env, claimed)` + `targetFor` | `src/compliance/nudges.js` | ADD |
| `sendExpiryNudgeEmail` + `sendExpiryDigestEmail`; the four-emails note becomes six | `src/prep/email.js` | ADD |
| state sweep awaited beside the purges; mail registered third on `waitUntil` | `functions/prep/_middleware.js` | UPDATE |
| one item seeded into the amber window on first click | `functions/prep/compliance/demo.js` | UPDATE |
| triage row, `RECRUITER_EMAIL` correction, the third-sweep subsection, "both sweeps" → three | `DEPLOY.md` | UPDATE |
| docstring: three sweeps, the state-count assurance query and its honest weakness | `scripts/remind.py` | UPDATE |

**No new source file, no new route, no new page, no migration** — as the plan specified.

## Tests added

| file | cases | result |
|---|---|---|
| `test/expiry-radar.test.js` (CREATE) | 31 | pass |
| `test/compliance-store.test.js` | +5 (statement shape) | 31 pass |
| `test/prep-email.test.js` | +13 (the two messages) | 54 pass |
| `test/prep-middleware.test.js` | +1, and the `waitUntil` count 2 → 3 | 4 pass |

The new file mirrors `test/extension-radar.test.js` in full: every fixture date is computed by
SQLite itself, every threshold is read off the catalogue rather than typed, and every test takes
`{ skip }`. It covers the per-item boundary at ±1 day on **both** thresholds in a single sweep
(the assertion a hardcoded 60 would fail), red-before-amber, the five state transitions, the
terminal `expired`, the two catalogue guards, the compare-and-swap's loser, the renewal race, the
grouped sends, every configuration permutation, the cascade, and what `itemsByCandidate` answers
afterwards.

Two assertions are worth naming because they are the ones a reviewer should not let anyone
"simplify":

- **`A STALE DATE LOSES EVEN WHEN THE STATUS IS UNCHANGED`** — the case a status-only guard gets
  wrong. `item.js` always writes `submitted`, so the ordinary renewal is `submitted → submitted`
  with a new date; without `expiry_date` in the WHERE the sweep stamps `expiring` over a date 20
  months out, and it is sticky because the next sweep no longer selects that row.
- **`THE STATE MOVES WITH NO MAIL CONFIGURATION WHATSOEVER`** — the assertion that fails if someone
  harmonises this sweep with `sendDueExtensionNudges`' bail-before-claim rule.

The plan asked for the driver's id type to be **recorded rather than assumed**: `node:sqlite`
returns `compliance_item.id` as a `number` and `days_left` as an exact `number`. Asserted in
`the driver hands integer ids back as numbers`. The `typeof id === "bigint"` branch stays as the
fail-safe, since a throw there would kill the whole sweep rather than one row.

## Validation results

**Level 0** — Node v24.11.0 (via `~/.nvm/versions/node/v24.11.0/bin/node`). The local default is
v20.20.2, where `node:sqlite` is absent.

**Level 1 — the boundaries** (all clean; see Deviations for the baseline substitution):

- metadata-only grep over the diff's code lines → no matches
- `git diff --name-only 095e665 -- migrations/ test/schema.test.js` → empty
- `expiry_nudge_sent|extension_nudge_sent` in `src/ functions/ migrations/` → no matches
- `grep '"verified"' src/compliance/nudges.js` → no matches
- `grep "UPDATE compliance_item SET status" src/compliance/store.js` → **exactly one line**,
  carrying both `status = ?` and `expiry_date = ?`, and no `IN (`
- `grep -rln 'includes(",")' src/` → `src/compliance/nudges.js` only
- `grep -c "0011" DEPLOY.md` → 0

**Levels 2, 3, 5** — every named file passes: `compliance-store` 31, `prep-email` 54,
`prep-middleware` 4, `expiry-radar` 31, `compliance-purge` 8, `compliance-passport` 18,
`extension-radar` 20, `compliance-pages` 16, `compliance-auth` 20, `schema` 17.

**Full suite under Node 24: 1044 pass, 0 fail, 0 skipped.** Recorded baseline on the branch point
before any change: **993 pass, 0 fail, 0 skipped**. +51 tests, no regressions, skip count unchanged.

**Under Node 20 the skip count rises by exactly 32, which is the designed behaviour and not a
regression.** 231 → 263. Those 32 are the 31 tests in `test/expiry-radar.test.js` plus the one new
test in `test/prep-middleware.test.js`, all of which carry `{ skip }` from
`test/helpers/sqlite-d1.js` because `node:sqlite` needs Node ≥ 22.5. The other 19 new tests
(`compliance-store`, `prep-email`) run on the recording fake and pass on both Nodes. AC #11 reads
"the same skip count as `main` under the same Node" — under Node 24, where this ticket is
measured, it is 0 before and 0 after.

`scripts/remind.py` parses under `ast.parse` and prints its usage line with no argument.

**Level 4 — walked programmatically rather than in a browser.** See Deviations.

## Deviations from the plan

1. **The branch is `feature/expiry-radar`, cut from `095e665`, not from `main`.** The plan's
   sequencing note says to branch from `main` after #69 merges. #69 is *not* on `main` and has no
   open PR — `origin/main` is at the #67 merge (`66950c7`), and #68 + #69 live only on
   `feature/extension-rebooking-radar`. Branching from `main` would have dropped both dependencies.
   This PR therefore stacks on #69 and should merge after it.

2. **Level 1's gates were run against `095e665`, not `main`, and the report's commands say so.**
   Because #68 and #69 are not on `main`, `git diff main -- migrations/` lists *their* migrations
   (0009, 0010) — which reads as an AC #7 failure that has nothing to do with this ticket. The
   branch point is the honest baseline. A reviewer re-running the plan's literal `git diff main`
   commands will see those two files and should substitute `095e665`. Once #69 merges, the plan's
   original commands become correct again.

3. **Level 4 was walked programmatically, not through a browser.** `wrangler` is not installed in
   `node_modules` and `npm run dev` would fetch it. Instead the real handlers were driven against a
   real migrated SQLite: `demo.js` → `_middleware.js` → `api/items.js` → `api/item.js`. The whole
   loop is confirmed — seed lands at `submitted`, the *next* request's middleware ambers it,
   `/prep/compliance/api/items` answers `status: "expiring"` with `amber_days: 30`, a renewal 18
   months out returns it to `submitted` and it stays there through another sweep, forcing the date
   into the past turns it `expired`, and re-opening the demo does not reset a swept item. What was
   **not** verified is the browser actually painting `.mark-expiring` / `.mark-expired` — that CSS
   shipped in #68 and this ticket does not touch it, but it is the one step of Level 4 left for a
   human at a browser.

4. **`dueExpiryItems` is not added to the existing projection loop** in
   `test/compliance-store.test.js`. That loop asserts `doesNotMatch(projection, /\bemail\b/)`,
   `doesNotMatch(projection, /candidate_id/)` and `doesNotMatch(sql, /compliance_item/)` — all three
   of which `dueExpiryItems` deliberately violates, and clause 5 of its own comment defends
   projecting the name and the address together. Its projection is asserted inside the new `#70`
   section instead, where the reason can be stated beside it.

5. **Small comment-text edits where the plan's literal text would have been wrong in place.** The
   `nudges.js` header says `sendDueExtensionNudges` is "below" rather than "above" (the header sits
   at the top of the file), and cites the bail on `RECRUITER_EMAIL` without a line number. The
   `demo.js` comment cites `docs/handover-louis-meeting.md` without a line number, since that file
   is untracked and moving.

6. **One test assertion was written differently from the plan's sketch.** The "three items produce
   three lines" check counts the *indented* item lines rather than lines matching `runs out` — the
   candidate email's closing sentence ("...and the date it runs out") also matches that phrase.
   Caught by the test failing on its first run.

## Issues encountered

- **`test/node-version.test.js` fails under Node 20, and that is by design, not a regression.** It
  is #33's deliberate gate: `node --test` exits 0 on skips, so a Node-20 run would otherwise read
  as a pass while the whole `node:sqlite` layer went unproven. It is untouched by this branch
  (`git diff --name-only 095e665 -- test/node-version.test.js` is empty). Under Node 20 the suite
  is 780 pass / 1 fail / 263 skipped; under Node 24 it is 1044 / 0 / 0. **Node 24 is the run that
  counts.**

- **For the owner, not a bug — the passport count goes DOWN when an item ambers.** Confirmed
  empirically: the demo persona reads `1 of 8 done` before the sweep and `0 of 8 done` after it,
  because `items.js`'s `DONE` set is `submitted|verified`. That is defensible (an expiring
  certificate needs an action from the candidate, which is `DONE`'s stated test) but it means a
  locum watches their score fall without doing anything wrong — the "score" reading
  `passport.js` explicitly says to avoid. This plan deliberately does not change it: that is
  `items.js`, and #68's decision. The alternative is a third count (`at_risk`) on the API and a line
  under it, which is #71's natural home. **Flagged for a decision rather than silently changed.**

- The plan's other Open Questions are unchanged and still open: no re-nudge for an item sitting
  amber for weeks (decision 17's ethos), ISO rather than prose dates in the mail, and whether the
  digest should claim the candidates were emailed (it does not, because it cannot check).

Two things checked on the way past, both clean and recorded so a reviewer does not have to re-derive
them:

- **`mailExpiryNudges` guards on `RESEND_API_KEY`, `baseUrl` and `recipient` but never on `DB`**,
  and it calls `getAgency(env.DB)`. It cannot be reached without one: the middleware's whole block
  sits inside `if (env.DB)`, and `claimed` can only be non-empty if `sweepExpiryStates(env.DB)` just
  ran against that database. If it somehow were, `getAgency`'s throw is already caught and the mail
  degrades to "your recruitment agency" rather than failing.
- **`claimItemExpiry` compares `expiry_date` as a raw string**, and the column's CHECK
  (`datetime(expiry_date) IS NOT NULL`) would admit `2026-09-01 00:00:00` as well as `2026-09-01`.
  It cannot arrive in that form: `isRealDate` gates on a `YYYY-MM-DD`-only regex before the route
  writes, and `dueExpiryItems` selects `i.expiry_date` raw rather than through `date()`, so the
  round-trip is byte-identical. The comparison is exact either way — same string out, same string
  back in — but it is legible only because the date-only rule holds upstream.

## The two decisions a reviewer will want to argue with

Named here because the plan's completion checklist asks for them in the PR body:

1. **The narrow compare-and-swap guard.** `WHERE id = ? AND status = ? AND expiry_date = ?` looks
   over-specified and invites two tidy-ups: dropping the date as redundant, or broadening to
   `status IN ('submitted','verified')`. Both reintroduce the same bug — stamping an amber flag over
   a certificate that was just renewed, stickily. `claimItemExpiry`'s comment carries the worked
   failure and `test/expiry-radar.test.js` proves it.

2. **The awaited state sweep.** An implementer who has just read #69 will find
   `sweepExpiryStates(db)`'s missing `env` parameter odd, and will be tempted to harmonise it with
   `sendDueExtensionNudges`' bail-before-claim rule. That rule is right for #69 because
   `public/assignments.js` computes amber at render time; here `status` *is* what the passport
   draws, so refusing to claim would mean refusing to know. The `nudges.js` header is written for
   that reader specifically.

## Ready for the next step

All plan tasks are complete and every validation command passes under Node ≥ 22.5. Nothing is
committed yet — next is `piv-commit`, then `piv-create-pr` (this report fills the PR body), then
`piv-review-pr`.
