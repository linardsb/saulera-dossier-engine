# Implementation Report — Send to Candidate (#22)

**Plan**: `.claude/plans/send-to-candidate.md`
**Branch**: `feature/send-to-candidate` (off `main` @ `fd1e0b4`)
**Status**: COMPLETE — with one validation step that cannot be run on this machine, named below.

## Summary

The recruiter-side handover, end to end. After a pack is generated, act 4 on the pack screen
takes a confirmed interview date and the candidate's email address, runs #19's one Opus call
behind `POST /api/prep/prepare`, shows the recruiter exactly what is about to leave the
building, and on confirm re-runs the entire contract server-side before writing the invite
scope, minting #20's magic link and emailing it. The candidate's page stops reading a checked-in
fixture and starts reading `GET /prep/api/brief`, a session-gated **projection** that strips the
model's failed guesses, the importance scores and the question bank. The recruiter afterwards
sees two numbers per client on `/counts` and nothing else.

This is where architecture decisions 1, 2 and 3 meet: a brief and not the pack goes to the
candidate; only toggle-gated client knowledge reaches them; only delivery telemetry comes back.

## Tasks completed

**Phase 1 — the pure modules**
- Task 1 → `src/prep/dates.js` (CREATE) — `toSqliteUtc`, `addDays`, `isNotPast`
- Task 2 → `test/prep-dates.test.js` (CREATE) — 9 tests, incl. the dates/tokens pair test
- Task 3 → `src/prep/strike.js` (CREATE) — `strikeCompetencies`, pure
- Task 4 → `test/prep-strike.test.js` (CREATE) — 10 tests, incl. the exhaustive subset sweep
- Task 5 → `src/prep/projection.js` (CREATE) — `candidateProjection`, pure
- Task 6 → `test/prep-projection.test.js` (CREATE) — 12 tests
- Task 7 → `test/helpers/sqlite-d1.js` (CREATE) + `test/prep-auth.test.js`,
  `test/portal-purge.test.js` (UPDATE) — harness extracted, no test-count change

**Phase 2 — the store writers and the mail**
- Task 8 → `src/portal/store.js` (UPDATE) — `persistHandover()`, `DIFFICULTY`
- Task 9 → `src/portal/store.js` (UPDATE) — `briefJsonByInviteId()`
- Task 10 → `test/portal-store.test.js` (UPDATE) — 7 new recorded-SQL tests
- Task 11 → `src/prep/email.js` (UPDATE) — `mailFrom()`, `sendInviteEmail()`, `from` on `sendEmail`
- Task 12 → `test/prep-email.test.js` (UPDATE) — 15 new tests incl. the R8 injection cases

**Phase 3 — the three Functions**
- Task 13 → `functions/api/prep/prepare.js` (CREATE) — recruiter, Access-gated
- Task 14 → `functions/api/prep/send.js` (CREATE) — recruiter, Access-gated, SDK-free
- Task 15 → `functions/prep/api/brief.js` (CREATE) — candidate, session-gated
- Task 16 → `test/prep-send.test.js` (CREATE) — 25 tests against real SQL

**Phase 4 — the recruiter surface**
- Task 17 → `public/index.html` (UPDATE) — act 4, step 4, third nav link
- Task 18 → `public/app.js` (UPDATE) — act 4's wiring
- Task 19 → `public/app.css` (UPDATE) — act 4, the preview, the counts table
- Task 20 → `public/counts.html` + `public/counts.js` (CREATE), `public/clients.html` (UPDATE),
  `test/counts.test.js` (CREATE) — 6 source-scan tests
- Task 21 → `.claude/probes/one-screen.mjs` (UPDATE) — probes 18–23, plus 24–27 added in
  self-review (see "Fixed in self-review" below)

**Phase 5 — the candidate surface**
- Task 22 → `public/prep/brief.js`, `public/prep/index.html` (UPDATE)

**Phase 6 — docs**
- Task 23 → `DEPLOY.md`, `README.md` (UPDATE)

## Tests added

| File | Tests | Result |
|---|---|---|
| `test/prep-dates.test.js` | 9 | pass |
| `test/prep-strike.test.js` | 10 | pass |
| `test/prep-projection.test.js` | 12 | pass |
| `test/prep-send.test.js` | 25 | pass (Node 24; skip on Node 20) |
| `test/counts.test.js` | 6 | pass |
| `test/portal-store.test.js` | +7 | pass |
| `test/prep-email.test.js` | +15 | pass |

**548 total, 0 fail** (baseline before this ticket: 464).

## Validation results

| Level | Command | Result |
|---|---|---|
| 1 | `node --check` × 11 files | all parse |
| 1 | debris / HTML-sink / browser-storage / raw-hex greps | all `ok` |
| 1 | R1 route-split greps, candidate-guard loop, SDK-free, `.note` gate | all `ok` |
| 2 | `npm test` (Node 20.20.2) | 548 tests, 495 pass, **0 fail**, 53 skipped |
| 2 | `npm test` (Node 24.11.0) | 548 tests, **548 pass, 0 fail**, 0 skipped |
| 3 | `npm run db:local` + table list | **11 application tables**, unchanged — no migration added |
| 4 | `curl /counts` | 200 (Pages' built-in HTML handling; no routing config needed) |
| 4 | `curl POST /api/prep/prepare` with a 2020 date | `400 {"error":"interview_past"}` |
| 4 | `curl POST /api/prep/send` with `field_keys` | `400 {"error":"unexpected_fields","fields":["field_keys"]}` |
| 4 | `curl GET /prep/api/brief` with no session | `401 {"error":"invalid_token"}` |
| 5 | `node .claude/probes/one-screen.mjs` | **27/27 probes pass** (17 pre-existing + 10 new) |

The Node 20 skip count rises from 28 to 53 because `test/prep-send.test.js` needs `node:sqlite`.
Under Node 24 nothing skips.

## Risk register — every row walked

| # | Closed by | Proved by | Green |
|---|---|---|---|
| R1 recruiter endpoint unauthenticated | route split, `functions/api/prep/` vs `functions/prep/api/` | Level 1 greps + DEPLOY.md route table | ✅ |
| R2 `competency.id` PK collision | `` `${roleId}:${payloadId}` `` | `prep-send.test.js` "two sends for the SAME client" on real SQL | ✅ |
| R3 `axis='core'` CHECK / `difficulty` affinity | axis `null`, `DIFFICULTY` map | `prep-send.test.js` asserts `typeof difficulty === "number"` | ✅ |
| R4 browser-supplied field keys | `listVisibleKeys` read server-side | `field_keys` → `unexpected_fields` (test + live curl) | ✅ |
| R5 dangling reference after a strike | prune ids, drop emptied blocks | `prep-strike.test.js` exhaustive subset sweep | ✅ |
| R6 `failed_quote`/`importance`/`questions` delivered | `candidateProjection` | serialise-and-grep, plus end-to-end over the wire | ✅ |
| R7 double send | `state.busy` + terminal `sendDone` set only on success | probes 21 and 22 | ✅ (residual named below) |
| R8 mail-header injection | strip CR/LF, then RFC 5322 quote | `prep-email.test.js` injection cases | ✅ |
| R9 orphan data / inflated count | rollback by hash, `invite_sent` last | `prep-send.test.js` 403 rollback case | ✅ |

**R7's residual is open and documented, as the plan intended**: a request that times out in the
browser but succeeded on the server leaves `sendDone` false, so a retry sends a genuine second
invite. The `409 already_sent` answer is deliberately not built here. It is written down in
`confirmSend`'s comment rather than implied away.

## Deviations from the plan

All deliberate; each is an intentional decision, not an oversight.

1. **`test/portal-purge.test.js` keeps its own `openMigrated`.** The plan said both callers
   import the extracted one. That file seeds *between* `0001` and `0002` because the ALTER
   landing on a populated `events` table is one of the things its AC #1 asserts; sharing the
   helper would have deleted an assertion rather than reused a fixture. It imports `d1Shape`
   and `skip`, and a comment says why `openMigrated` stayed. Test count unchanged.

2. **Task 2's pair test injects `now`.** As written the formula
   (`maxAgeFrom(addDays(toSqliteUtc(today), 14))`) uses the default `now = new Date()`, which
   compares midnight-plus-14-days against the current instant and is off by however much of
   today has elapsed. `now` is derived from the stamp instead. Same property pinned.

3. **`candidateProjection` also blanks `source_quote` on an unverified competency.** The plan's
   field list said to drop `failed_quote`. But `verifyBrief` demotes by *adding* `failed_quote`
   and *leaving* `source_quote` in place (`verify.js:48`), so both hold the same invented
   sentence — dropping one ships it under the other name. The plan's own task-6 test ("the
   demoted competency's invented quote appears nowhere") requires this, so the code follows the
   test rather than the field list. `registry.js` never prints a quote for an unverified
   competency, so nothing is lost.

4. **`sent_at` in the send response is the send moment, not `interview_at`.** The plan's shape
   listed `sent_at` without saying what it holds; returning the interview date under that name
   would be wrong. The row's own `sent_at` is `datetime('now')` inside `createInvite` and is not
   read back — one SELECT for a value the screen only prints.

5. **The strike-length bound is only enforced when `payload.competencies` is an array.** Plan
   step 4b checks it before `assertBrief`. Unconditionally, a malformed payload reports a
   confusing `missing_fields` about the strike list; now `bad_brief` names the real problem.

6. **The unverified-competency lede does not invite ticking the line back on.** The plan's copy
   said "tick it back on if you want it", but step 11 refuses any send containing one — that is
   the same dead-end-wearing-a-control the plan argues against two sentences earlier. The
   pre-untick is kept; the invitation is dropped.

7. **Two markup class names differ from the plan's sketch**, to reuse the existing vocabulary:
   the note-section rows use `.visibility-name` / `.visibility-meta` (the same two classes
   `/clients` uses for the same two facts) rather than new parallel names.

8. **Three code comments are worded around the Level 1 greps.** Comments naming
   `@anthropic-ai/sdk`, `client.note`, and the per-candidate field names tripped the gates that
   scan those files. Following `public/app.js:19-20`'s stated precedent, the comments were
   reworded rather than the gates loosened, each with a note saying why.

## Fixed in self-review (after the first pass was already green)

A review pass over the finished branch found one real defect and three gaps where new code was
shipping unexecuted. All are fixed and covered.

1. **DEFECT — the state line outlived its situation.** `updateConfirmGate` only ever *set*
   "everything is unticked". Untick every competency and the warning appeared with confirm
   locked; tick one back and confirm unlocked while the warning **stayed on screen**, so the
   page contradicted itself. A recruiter hits this the first time they change their mind.
   Fixed with an explicit `announce` parameter: the checkbox handler and `renderPreview` own
   the line, and `confirmSend`'s tail deliberately does not — clearing there would wipe the
   mail-failure message that tells the recruiter their payload is still worth retrying (R9).
   **Probe 27** is the regression, and probe 22 was re-run to confirm the R9 message survives.

2. **`public/counts.js` had never been executed anywhere.** `test/counts.test.js` is a source
   scan and the curl only proved the HTML returns 200 — so a whole recruiter screen was
   shipping unverified against its own AC ("clients with no invites show `0`, not a blank").
   **Probe 24** now renders it against stubbed endpoints and asserts the zeros. Also removed an
   unused `el.table` and fixed the success path to clear `is-shown` rather than only
   `textContent`, which left an empty padded box after a load.

3. **`public/prep/brief.js`'s 401 and 404 branches had never been executed.** The integration
   test drives the *server* route; nothing drove the client's response handling. **Probes 25
   and 26** cover the bounce to `/prep/login` and the "not ready yet" state.

4. **A failed counter rendered the success sentence in error styling.** Act 3's precedent is a
   dedicated message (`packReady` vs `eventFailed`); a red "Sent to X…" told the recruiter
   nothing. Added `COPY.sendDoneUncounted`, which names the counter explicitly — `invite_sent`
   is the number decision 23 sells on, so a silently uncounted send is worth its own sentence.

5. **Two brittle gates de-brittled.** `test/counts.test.js` matched the claim sentence with an
   exact-indentation string (any reflow would break it) — now whitespace-collapsed; and its
   forbidden-word scan grepped the whole file for `email`, which would fail the day someone
   wrote "they will get an email" into `COPY` — now scoped to outside the `COPY` object, since
   the constraint is on what the code reads, not on what the prose says.

6. **A failed re-prepare left a stale payload in memory**, so `beforeunload` warned about
   something the recruiter could no longer see or send. `prepareSend`'s catch now clears
   `sendPrepared`/`sendStruck`, matching `cancelSend`.

Also removed a dead `link` variable left in `test/prep-send.test.js`'s `send()` helper.

## Issues encountered

- **The worktree started on #19's branch**, as the plan warned. Local `main` was 20 commits
  behind and the pull was blocked by three untracked files already tracked on `main` (identical
  but for a trailing newline). Backed them up to the scratchpad, removed, pulled, branched.
- **`test/fixtures/prep-payload.json` is deliberately a one-demoted-competency specimen** — its
  third competency cites a sentence `prep-brief.md` does not contain, which is what
  `brief.fixture.json` exists to render. It can never pass the send route. `prep-send.test.js`
  replaces that one quote with a real one and says so, and uses the **unedited** fixture to
  prove the `not_sendable` refusal.
- **`src/prep/email.js` briefly contained literal NUL/US/DEL bytes** from a control-character
  class written raw; replaced with `\u` escapes. The file had become "binary" to grep.

## NOT DONE — one item, and it needs a key this machine does not have

**One real send to a real inbox, read in a plain-text client** (Level 4 step 5, and a
COMPLETION CHECKLIST line). `.dev.vars` holds `ANTHROPIC_API_KEY` but no `RESEND_API_KEY`, and
the send also needs a verified sending domain in Resend. Everything around it is proved —
`prep-email.test.js` asserts the bare URL stands alone on its own line in the text half and sits
in an `href` in the html half, and `prep-send.test.js` drives the real route with the transport
stubbed — but **the unit tests stub the transport by design and pass whether or not Resend would
accept a single message**, which is DEPLOY.md §5b's own warning. This must be done once against
a real inbox before the pilot.

Also outstanding by nature, not by omission: the **real-browser sweep in Safari and Chrome** for
tab order, visible focus and keyboard operation of the preview checkboxes. The probes drive
headless Chrome and `test/helpers/dom.js` explicitly cannot answer those.

## For the PR body

- **The issue's "files touched" line names `functions/prep/send.js`. That path is wrong**, and
  it matters: `scripts/setup-access.py:110-111` creates two `Bypass → Everyone` applications on
  `<project>.pages.dev/prep`, so a Send endpoint in that tree would be unauthenticated — minting
  magic links and spending ~30p of Opus per request for anyone who guessed the path. The
  estimate predates #20 creating those apps. The recruiter routes are at `functions/api/prep/`.
- `/api/prep/prepare` is a **second model call site**, which `functions/api/generate.js`'s header
  forbids. The exemption is architecture §5, which names exactly two calls; this is the first.
  The justification is written in the file header.
- The payload round-trips through the browser. Why that is safe enough — chiefly that
  `verifyBrief` recomputes `verified` from `source_quote` on every pass and never reads the
  incoming flag — is in `send.js`'s header.

## Ready for the next step

All validations pass except the one named above. Next: `piv-commit`, then `piv-create-pr`, then
`piv-review-pr`. **Verify the branch immediately before committing** — parallel sessions share
this worktree.

---

## Addendum — the two review rounds (30 Jul 2026)

The body above describes the branch at `4e40674` and is left as written. Two commits landed on it since;
every number below supersedes its counterpart above.

**`7235d68` — the round-1 fixes.** PR #32's first review found 6 High · 10 Medium · 6 Low. Twenty were
fixed, each with a test that dies when its fix is reverted (all nine mutations tried killed at least one
test); two were deferred behind open issues — #33 (Node 20's false pass in CI) and #34 (R7's inflated
`invite_sent` residual). New tests: `assertBrief` duplicate-id refusal, the guarded `rollbackInvite` with
a faulty-D1 drive of `persistHandover`, the seeded-note visibility gate, the 24-month `interview_at`
horizon in both routes, and probes 28–34.

**Round 3's four findings, fixed here.** The follow-up review (0 Critical · 0 High · 1 Medium · 3 Low,
recommendation approve) produced this commit:

- `maxLocal()` → `maxUtc()`: the picker's far end is now computed with `setUTCMonth(+24)`, the exact
  arithmetic `isWithinHorizon` uses, so browser and server can no longer disagree by a day across the
  UTC boundary (and a Feb 29 no longer yields an invalid `max`). **Probe 35** opens the screen in
  Pacific/Kiritimati (UTC+14) and Etc/GMT+12 and asserts the input's `max` equals the server horizon in
  both — at any real instant at least one of those zones is on a different calendar day than UTC, which
  is what makes the old arithmetic fail it deterministically (mutation-checked: reverting to local
  arithmetic fails probe 35).
- `503 no_base_url` now has recruiter-facing copy (`sendNoBaseUrl`) instead of falling through to the
  generic "Could not send that" — a misconfigured deployment no longer reads as a transient failure.
  **Probe 36** stubs the 503 and asserts the sentence names the missing setting and says nothing was
  sent (mutation-checked: removing the `sendMessageFor` case fails probe 36).
- The overclaiming comment in `test/prep-generate.test.js` no longer says the wrapped message reaches
  the recruiter's screen; `errorResponse` sends the browser only the code — the sentence reaches the log.
- The stale numbers in this report and the PR body are corrected by this addendum and a PR-body edit.

### Validation at this head

| Level | Command | Result |
|---|---|---|
| 1 | every gate from the plan | all `ok` |
| 2 | `npm test` (Node 24.11.0) | **577 tests, 577 pass, 0 fail**, 0 skipped |
| 2 | `npm test` (Node 20.20.2) | 577 tests, 505 pass, **0 fail**, 72 skipped |
| 3 | table list | 11 application tables, unchanged |
| 4 | live curl sweep (`/counts`, past date, `field_keys`, no session) | 200 · `interview_past` · `unexpected_fields` · 401 |
| 5 | `node .claude/probes/one-screen.mjs` (Node 24) | **36/36 probes pass** |

**+113 tests over the `fd1e0b4` baseline of 464.** Node 20's skips are 72 because the sqlite-backed
files need `node:sqlite`; under Node 24 nothing skips.

Still outstanding before the pilot, unchanged: one live Resend send read in a plain-text client, and the
real-browser Safari/Chrome keyboard sweep.
