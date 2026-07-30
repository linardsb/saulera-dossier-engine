# Code Review — PR #32 · feat: send to candidate (#22)

## Recommendation: **request changes** — 6 High, no Critical

Nothing here is a security hole, a data-loss path on an ordinary run, or a wrong fundamental approach. The
architecture is right, the route split is a real security control, and the validation is genuinely green. What
holds it back is a set of individually small defects that are each one or two lines to fix, plus two coverage
gaps where the thing the PR is proudest of turns out to be unasserted.

> Posted as a comment rather than a formal *Request changes*: GitHub refuses both `--approve` and
> `--request-changes` from the PR author's own account.

**Branch** `feature/send-to-candidate` → `main` · **head** `4e40674` (matches the PR head exactly; reviewed in
place) · 31 files, +5,746 / −122.

Reviewed with fresh eyes — a clean context that did not write this code — plus four independent reviewers over
security, correctness/data-integrity, frontend, and tests/standards. Two notes on the rubric: this repo has no
root `CLAUDE.md`, so the standards used were `README.md`, `DEPLOY.md`,
`docs/epics/candidate-portal.architecture.md` and the file-header conventions the codebase already keeps; and
`.claude/agents/code-reviewer.md` does not exist here, so general-purpose reviewers were briefed against those
same standards. **Every finding below was re-verified against the code before it entered this report**; the
ones marked *PROVEN* were reproduced by running them.

---

## Validation — re-run on this branch head, not quoted from the report

| Level | Command | Result | Matches PR claim |
|---|---|---|---|
| 2 | `npm test` (Node 20.20.2) | 548 tests · **495 pass · 0 fail** · 53 skipped | ✅ exact |
| 2 | `npm test` (Node 24.11.0) | 548 tests · **548 pass · 0 fail** · 0 skipped | ✅ exact |
| 5 | `node .claude/probes/one-screen.mjs` | **27/27 probes pass** | ✅ exact |
| 4 | `npm run dev` + live sweep on `:8788` | `/`, `/clients`, `/counts`, `/prep/`, `/prep/login` → 200 | ✅ |
| 4 | `POST /api/prep/send` with `field_keys` | `400 {"error":"unexpected_fields","fields":["field_keys"]}` | ✅ exact |
| 4 | `GET /prep/api/brief` with no session | `401 {"error":"invalid_token"}` | ✅ exact |
| 4 | `POST /api/prep/prepare`, off-vocabulary body | `400 unexpected_fields`, naming both keys | ✅ |
| 4 | `GET /api/prep/send` (unrouted) | `404` **and the 404 page** — not the recruiter shell | ✅ |
| — | baseline at `fd1e0b4` (Node 20) | 464 tests · 436 pass · 28 skipped | ✅ +84 tests, as claimed |
| 1 | every Level 1 gate from the plan | all `ok` | ✅ |

**Every headline number in the PR body reproduces.** The suite is green and the docs are accurate — DEPLOY.md's
route table matches the files, its five new triage rows match the code's real codes and statuses, and README's
five claims all check out. No stale count, no wrong path.

## Claims independently verified

- **The route split is real, and it is the security control the PR says it is.** `scripts/setup-access.py:106-112`
  puts `Bypass → Everyone` on `{project}.pages.dev/prep` and `*.{project}.pages.dev/prep`, with
  `Allow listed emails` on the bare hostnames. `/api/prep/…` is not under that path and stays gated;
  `/prep/api/…` is public and gates itself in code — confirmed live, `401 invalid_token` with no session. The
  issue's suggested `functions/prep/send.js` really would have been an unauthenticated, link-minting,
  Opus-spending endpoint. **The PR is right to lead with this.**
- **The second model call site is sanctioned, not undocumented.** `docs/epics/candidate-portal.architecture.md:87-95`
  §5 enumerates exactly two call sites and names this one. `prepare.js:15-21` cites it and reconciles §5.6.
- **The harness extraction lost nothing.** `test/prep-auth.test.js` + `test/portal-purge.test.js`: 28/28 at
  `fd1e0b4`, 28/28 at HEAD. Only setup moved; no assertion disappeared. Deviation 1 verified.
- **The four "pass every obvious test while broken" items are genuinely killed** by the new real-SQL file —
  mutation-verified: un-namespacing the competency row id → 4 failures; `axis:'core'` → 16; `ACCESS_DAYS`
  14→30 → 1; deleting the mail rollback → 2.
- **The browser round-trip's safety argument holds.** Making `verifyBrief` trust an incoming `verified: true`
  fails exactly the test written for it (`test/prep-send.test.js:360`).
- **The 8 documented deviations are all real and match the code**, and are treated here as decisions, not
  findings.

---

## High — 6

### H1 · Duplicate competency ids reach a `UNIQUE` violation and surface as `500 internal`
`src/prep/schema.js:233-243` · `src/portal/store.js:195` — *PROVEN end-to-end, found independently by two reviewers*

`assertBrief` collects competency ids into a `Set` and never rejects duplicates — `ids.add(c.id)` with no
membership test. `persistHandover` then derives `` `${roleId}:${competency.id}` `` against
`competency.id TEXT PRIMARY KEY` and the second insert throws a raw `ERR_SQLITE_ERROR`, not a `StoreError`.

The rollback runs correctly and the data is clean (verified: `invite=0 candidate_role=0 competency=0
question=0 events=0`) — the defect is the classification. The recruiter has just paid for a ~30p Opus call and
gets `{"error":"internal"}`, and `DEPLOY.md:424` reserves that exact status for "the migration did not run", so
the operator is sent to `npm run db:remote` for a model output problem. `BRIEF_SCHEMA` structurally cannot
express uniqueness, which is precisely the gap `assertBrief`'s own header says it exists to close: *"a rule
living only in the schema is an untested claim about a third party's decoder."*

Second symptom, same root: `strikeCompetencies` filters by id (`src/prep/strike.js:33`), so striking one
duplicate silently removes both — and if they were the only two, the send 400s `nothing_to_send` for no visible
reason.

**Fix:** `if (ids.has(c.id)) throw new Error(...)` before `ids.add(c.id)`.

### H2 · The rollback that R9 rests on is both unguarded and untested — and it leaks the CV
`functions/api/prep/send.js:229-232`, `:246-254` — *PROVEN*

Two halves of one weak spot, which is why they are together:

**Unguarded.** `await deleteInviteByTokenHash(env.DB, tokenHash);` sits bare before `throw err`. If the
rollback DELETE itself rejects, `throw err` never runs and the outer catch sees the D1 error instead of the
mail error. Reproduced with a mail 403 plus a failing DELETE: status `500 internal`, and
**`invite=1 candidate_role=1 competency=3 question=6` left behind** — exactly the orphan CV the R9 comment at
`:247-251` says must never exist. The control run with a working rollback gives `502 mail_failed` and all
tables at 0. `sendMessageFor` also falls through to the generic `COPY.sendFailed`, so the recruiter loses the
`mail_failed` wording that tells them the payload is still worth retrying.

**Untested.** The `persistHandover` rollback at `:229-232` has no test at all — deleting that catch entirely
leaves 548/548 green. Its twin, the mail rollback, is well covered; this one is not. So a `persistHandover`
that throws after the role row and some competencies landed (a CHECK, a D1 error, or the
`candidate_role.invite_id` UNIQUE on a retry) leaves the invite plus a partial scope, and nothing fails.

**These are one story, and Low-6 is its third act.** `candidate_role.invite_id UNIQUE` is *the* constraint that
makes `persistHandover` throw on a retry — so it is the most likely trigger of this catch, it is the branch
with no test, and the constraint itself is still covered only by the recording fake. Fix the three together:
assert the UNIQUE in `schema.test.js`, add the rollback test that drives it, and guard the two `await`s.

**Fix:** `try { await deleteInviteByTokenHash(...) } catch (e) { console.error(...) } throw err;` at both
sites, and a test that makes the Nth INSERT throw and asserts every `PORTAL_TABLES` entry is 0.

### H3 · The #18 visibility gate can be replaced with the whole client note, undetected
`functions/api/prep/send.js:218` · `test/helpers/sqlite-d1.js:44-46` — *PROVEN*

Replacing `visibleFields(client.note, fieldKeys).map(...)` with `String(client.note ?? "")` leaves the suite
**green**. The root cause is the fixture: `SEED_CLIENT` inserts only `(id, name)`, so `client.note` is empty in
every send test and `candidate_role.ethos_text` is `""` in all 25 of them. I confirmed no test anywhere asserts
`ethos_text`'s *content* — `test/portal-store.test.js:460` only asserts the SELECT is not too wide.

This is decision 2's entire mechanism. If the gate breaks or is "simplified", the agency's whole private client
note — unticked sections included — is persisted into a row a candidate's session can reach. Nothing fails.

Related and stated separately because it is the same empty fixture, not independent evidence: replacing
`listVisibleKeys(env.DB, client.id)` at `:144` with `[]` also survives. `verifyBrief`'s field-key logic **is**
properly unit-tested with a non-empty list, so R4 is proven at the unit layer and unproven at the integration
layer — the only R4 test in `prep-send.test.js` (`:324`) proves the *body vocabulary*, not that the server
reads real keys.

**Fix (closes both):** seed `c-1` with a note and two fields, one ticked and one not. Assert `ethos_text`
carries the ticked heading and text and *not* the unticked section's; and that a `source_field_key` naming the
ticked key verifies while the unticked one demotes.

### H4 · "Start again" mid-request leaves the response live, and it poisons the next candidate
`public/app.js:467-505` — *verified: `resetToInputs` is the one reset path that never bumps `state.reqId`*

`state.reqId` is incremented at `:620`, `:699`, `:833`, `:903`, `:1258`, `:1469` — every load and every
request — but **not** in `resetToInputs`. Neither Start again button is guarded by `state.busy`, and both are
on screen throughout phase "pack". So `mine()` stays true across a reset.

Press "Send it", then "Start again" while it is in flight: the success handler lands *after* the reset and sets
`state.sendDone = true`, `readOnly` on both fields and `setBusy(el.prepareSend, true)` (`:1491-1497`). The
recruiter generates the next candidate's pack and act 4 comes back with a locked CTA, frozen fields and a stale
*"Sent to &lt;previous address&gt;"*. **They cannot send prep for this candidate at all**, and nothing on screen
says that pressing Start again a second time is the way out.

The prepare variant is the same shape as the bug the PR says it fixed in `prepareSend`'s catch: `renderPreview`
lands after the reset, sets `state.sendPrepared`, unhides the preview inside a now-hidden act 4, and
`beforeunload` starts warning about a brief the recruiter cannot see.

**Fix:** one line — `state.reqId += 1;` at the top of `resetToInputs`.

### H5 · The interview date stays editable after the preview, and edits are silently discarded
`public/app.js:1482`, `:1495-1496` — *verified: `readOnly` is set only in the success handler*

`confirmSend` posts `interview_at: state.sendPrepared.interview_at` — the stamp normalised at prepare time.
`el.interviewDate.readOnly = true` happens only at `:1495`, *after* a successful send, so while a preview is
open the field is fully live and `updateSendGate` keeps re-running on every keystroke.

The client moves the interview from Wed 12 Aug to Wed 19 Aug. The recruiter edits the field — which visibly
accepts it — and presses "Send it". The candidate's email and portal both say 12 Aug, and the portal expires 14
days from the wrong date. Nothing ever says the edit was ignored. The two gates also disagree: a past date
locks `#prepare-send` via `updateSendGate` but leaves `#confirm-send` untouched, because `updateConfirmGate`
(`:1418-1428`) never consults the date at all — a greyed-out "Send to candidate" beside a live "Send it" that
sends the stale stamp.

Probe 20 asserts `body.interview_at === "2099-08-12 00:00:00"` and reads like date coverage, but it never
touches the field after preparing.

**Fix:** route an edit to `#interview-date` through `cancelSend`'s clearing path, or set `readOnly = true`
whenever `state.sendPrepared` is non-null.

### H6 · `interview_at` has no upper bound, so the 30-day purge silently never fires
`functions/api/prep/prepare.js:59-62` · `functions/api/prep/send.js:118` · `src/prep/dates.js:92-96`

Both routes check only `isNotPast`. `public/index.html`'s `<input type="date">` carries no `max`, and
`updateSendGate` checks only `date >= todayLocal()`. Nothing caps the far end.

`purgeExpired` (`src/portal/store.js:44-49`) deletes on `datetime(interview_at,'+30 days') <= datetime('now')`.
A one-character year typo — `2226-08-12` for `2026-08-12` — yields `0` forever: the candidate's `cv_text`,
`jd_text`, `ethos_text` and email address sit in D1 for two centuries, and the magic link stays live just as
long. Meanwhile `src/prep/email.js:204` tells that candidate, in writing, *"Everything here is deleted 30 days
after your interview."* Decision 13 gates the pilot on exactly this promise, and the failure is silent — it
surfaces at audit, not in a test.

On reachability, precisely: the typed value stays visible in the date input while the recruiter works, so the
typo is not invisible — but I checked, and **it is never restated in the confirmation preview**
(`COPY.sendPreviewLede` does not carry the date, and `renderPreview` never prints it). So the one screen built
to show the recruiter exactly what is about to happen is silent about the field that governs how long the
candidate's CV is kept, and after the send nothing surfaces it again.

**Fix:** bound the date server-side in `dates.js` alongside `isNotPast` (e.g. reject beyond ~24 months), and add
`max` to the date input.

---

## Medium — 10

1. **`verifyBrief`'s idempotence guard is skippable.** `src/prep/verify.js:63` short-circuits on *key
   presence* — `if ("failed_field_key" in entry) return entry;` — so `{"failed_field_key": null}`, legal JSON
   that survives `readJson` and `assertBrief`, returns before the D1 allow-list is consulted. A forged
   `source_field_key` naming a hidden note section then verifies with zero failures and is persisted into
   `brief_json`. Impact is bounded and I am **not** claiming a live leak: `panelUnsourced` keys on the same
   presence test, so the entry still renders wearing the Unverified mark, and only the key *name* travels, never
   the hidden text. But it contradicts the guarantee `send.js:141-145` advertises, and `verify.js:88` names #23
   as a future consumer of stored payloads. *Fix:* short-circuit on the shape `verifyBrief` itself produces, or
   strip `failed_field_key` from incoming panel entries before verifying.
2. **The route that *persists* `brief`/`cv` bounds neither; the route that only shows them bounds both.**
   `cleanInput` (≤100,000 chars, non-empty) runs inside `src/prep/generate.js:61-62`, reached from
   `prepare.js:73` — but `functions/api/prep/send.js:222-228` binds `body.brief`/`body.cv` straight through
   `String(x ?? "")`. *PROVEN:* a send with a 601,938-char brief and a 900,000-char CV returns **201** and
   writes both in full; `cv: {secret:"obj"}` stores the literal `"[object Object]"`. Past D1's 2 MB limit this
   becomes another `500 internal` where a 400 belongs. `src/prep/prompt.js:15` states the "runs exactly once"
   invariant that this sidesteps. *Fix:* `cleanInput` both in `send.js`.
3. **`toSqliteUtc` silently rolls an out-of-range day forward, against its own written promise.**
   `src/prep/dates.js:52-54` says it *"Throws rather than defaulting. A silently-substituted date would write an
   invite whose retention window is not the one the recruiter agreed to."* V8 rejects a bad month but rolls a bad
   day. *PROVEN through the full route:* posting `2027-02-31` returns **201** storing `2027-03-03`; the
   candidate's email prints the substituted day and both windows shift. (`2026-13-01`, `2026-00-10`, `2026-01-32`
   correctly throw.) *Fix:* assert `format(date).slice(0,10) === raw` after parsing.
4. **The affinity trap closed for `difficulty` is left open on the adjacent bind.** `src/portal/store.js:210`
   binds `Number.isFinite(importance) ? importance : 0`, and `assertBrief` never checks `importance` — its
   `enum:[1..5]` lives only at the decoder, which the browser round-trip bypasses. *PROVEN via `typeof()`:*
   `2.5` stores as **real**, `1e21` as **real**, `"3"` as **`0`** — a lost score. Same trap `store.js:143-146`
   describes in its own words one function above. *Fix:* `Number.isInteger(v) && v >= 1 && v <= 5 ? v : 0`.
5. **`assertBrief` throws a plain `Error` inside `generateBrief`** (`src/prep/generate.js:126`) while every
   other model failure there is a 502 `StoreError`. It is also the *likeliest* — it enforces the per-competency
   question rule, the `axis` rule and reference resolution that `BRIEF_SCHEMA` cannot. A schema-valid payload
   whose 6th competency has no questions gives the recruiter `500 internal`. *Fix:* wrap as
   `StoreError("bad_brief", 502, …)`.
6. **AC #2's data-minimisation on the recruiter side has no assertion of any kind.**
   `functions/api/prep/prepare.js:92`'s `slice.map(({key, heading, chars}) => …)` is the only thing keeping the
   client's note *text* out of the recruiter's browser. No test imports the file (confirmed: the one hit in
   `test/` is the comment saying it deliberately does not), the probes stub the route with a canned body, and
   the curl sweep only exercises the past-date 400. Adding `text` to the projection would pass everything —
   the identical rule on the candidate side got a whole test file. Not among the 8 documented deviations.
7. **Four guards are unexecuted by the suite** — each *PROVEN* by deleting it and staying green:
   `sameOrigin` on both new routes (every test uses `headers: {get: () => null}`, the curl path it allows by
   design); both strike guards at `send.js:127-136` (so `strike: {}` → `new Set({})` TypeError → 500 where a 400
   is intended); and the `event_recorded: false` branch at `:261-266` — the UI ships a dedicated
   `COPY.sendDoneUncounted` for a response no server test ever emits.
8. **A green `npm test` on this machine is a false pass.** `node --version` here is **v20.20.2**;
   `npm test` exits 0 with 53 skipped. `package.json:6` declares `engines.node >= 22.5`, but there is no
   `.npmrc`, no `engine-strict`, and no CI workflow. The skip guard itself is *correct* — it skips exactly when
   `node:sqlite` is unavailable — but nothing makes the omission visible, and this PR is what moved the
   real-SQL integrity proofs behind it (skips 28 → 53). A reviewer running `npm test` sees 548 tests and 0
   failures with R2, R3, R9, the cascade and the 14-day window all silently dropped. *Fix:* one non-skipped
   test that fails unless the running Node satisfies the engine.
9. **The preview badge reuses act 3's pack vocabulary, which has no right value for a prep competency.**
   `public/app.js:1346-1347` labels every verified competency `COPY.marks.client_note` — *"Our note"* — but a
   competency's `verified` flag is computed against the cleaned **brief** (`send.js:180`,
   `src/prep/generate.js:125-127`), and the schema tells the model to quote the client brief and not the CV. The
   lede two elements up already says *"Anything ticked below was found in the brief."* Not rated higher because
   the enum (`cv` / `client_note` / `unverified` / `failed`) is act 3's, where a pack claim genuinely can come
   from either source: there is no correct value to pick here, every competency gets the same badge, so it
   discriminates nothing and the recruiter cannot act wrongly on it. Two divergences from act 3's grammar ride
   along: the verified branch sets a bare `"mark"` with no colour modifier, so it inherits `--text-primary`
   instead of `--verified`; and the unverified row never gets `claim-unverified`, losing the left border
   `app.css:802-804` calls the third of the three signals. No probe reads a mark inside `#strike-list`.
   *Fix:* a `COPY.marks.brief = "Brief"` string, a `.mark-brief` rule, and the missing class.
10. **Frontend, six smaller defects** — all verified: focus lands on the irreversible "Send it" with
   `preventScroll` and no scroll, so a recruiter who scrolled up and presses Space sends the email before seeing
   a competency (`app.js:1403`); the all-unverified preview shows two contradictory sentences at once, one of
   which blames the recruiter for unticking nothing (`:1367-1372` + `:1426`); a zero-competency preview locks
   the button and says nothing at all (`:1426`); "Send to candidate" stays live over an open preview and
   silently re-runs the ~30p model call (`:1246`); `cancelSend` early-returns on `state.busy` with no
   `aria-disabled` and no message, so "Not yet" does visibly nothing mid-send (`:1523`); and the "Unverified"
   mark sits outside the `<label>`, so a screen-reader user hears the checkbox without the reason it arrived
   unticked (`:1318-1352`).

---

## Low — 6

- **`sendMessageFor` has no case for `missing_fields` or `bad_brief`** (`public/app.js:1218-1236`), so a
  malformed email that clears the browser's `indexOf("@") > 0` gate but fails the server's `cleanEmail` is
  reported as *"Paste the brief and the CV before you copy the prompt."* — in act 4, where both are frozen,
  filled and visible. This is the exact hazard `messageFor`'s own doc-comment names.
- **`functions/api/generate.js:4-8` is now false and was not updated.** It still reads *"The one place in this
  deployment where a model call happens"* / *"Do not add a second call site."* `prepare.js:15-21` correctly
  claims the §5 exemption, but the next reader greps for the rule and finds a flat contradiction. One line
  pointing at §5 closes it.
- **The emailed magic link is built from `request.url`** when `PREP_BASE_URL` is unset
  (`functions/api/prep/send.js:87`), while the sibling `functions/prep/auth/enter.js:30-31` refuses exactly that
  — *"an absolute URL would inherit whatever Host the edge saw, which is a header an attacker controls."* Not
  traceable end to end (Cloudflare routes on Host, and the route is Access-gated plus `sameOrigin`-bolted), but
  the consequence here is strictly worse than the one the sibling refused. Answering 503 when it is absent would
  be cheaper than the argument.
- **The mail subject is not control-stripped** (`src/prep/email.js:192`) though `mailFrom` at `:152-157` strips,
  caps and quotes the same class of value — inconsistent application of the PR's own R8 discipline, on an
  unbounded browser-supplied `role_title`.
- **Two dead branches and one dead string:** `functions/prep/api/brief.js:55`'s `bad_brief` 502 never executes
  (changing it to `json({}, 200)` stays green, so a corrupt stored payload would ship an empty 200 to the
  candidate); `COPY.leavingPrepared` (`public/app.js:205`) is referenced nowhere and cannot be shown, because
  `beforeunload` sets `returnValue = ""`; `COPY.sendNoteLink` is likewise unused, the text being hardcoded at
  `index.html:218`.
- **`candidate_role.invite_id UNIQUE` is the one integrity claim still covered only by the recording fake.**
  `test/schema.test.js:76` filters the keyword out of its column parse, and no test calls `persistHandover`
  twice for one invite. It is also the state H2 can produce, followed by a retry.

**One Level 1 gate cries wolf, pre-existing:** the token-leak grep flags `src/prep/email.js:60` because the
*filename* contains "email" — the line logs `response.status` only. Identical at base, so not this PR's doing,
but the repo's own rule is that a gate crying wolf gets fixed.

---

## What's genuinely good

This is unusually careful work, and several things are above the bar for the codebase:

- **The route-split reasoning is the best thing in the PR.** Catching that the issue's own "files touched" line
  would have produced an unauthenticated Opus-spending endpoint — and then writing it into DEPLOY.md's route
  table and two greps so the next ticket cannot repeat it — is exactly right.
- **Failure ordering is right where it counts.** Every 400 gate runs before `createInvite`, and `invite_sent` is
  genuinely last, so the count can only ever be *deflated* — the direction the comment argues for.
- **The `NULL` axis bet is correct, and was checked rather than assumed:** `axis = NULL` is accepted against the
  real CHECK, `axis = 'core'` is rejected. So is `${roleId}:${competency.id}` collision-freedom across clients
  and candidates, and the cascade the rollback depends on.
- **`strikeCompetencies` is referentially complete** — there are exactly four id sites in `schema.js` and it
  prunes all four, drops emptied blocks, and does not mutate the caller's object. There is no fifth site.
- **`candidateProjection` is properly pinned**, and the `source_quote`-is-the-failed-quote trap (deviation 3) is
  a subtle catch that the plan's own field list would have missed.
- **Injection and data posture are clean on the frontend:** zero HTML sinks across the whole diff, every node
  built with `createElement` + `textContent`, no storage API of any kind, nothing candidate-shaped in a URL, and
  the note preview showing headings and counts only.
- **`src/prep/dates.js` is the best-tested new module** — both BST mutations die, and the cross-module pair test
  against `maxAgeFrom` catches an hour of drift neither module's own tests could see.
- **The self-review found a real defect and three unexecuted paths, and said so.** Probes 24–27 exist because of
  it. That is the habit worth keeping.
- **The PR body's disclosures are honest and load-bearing** — the Resend live send, the Safari/Chrome sweep and
  R7's residual are all correctly named as outstanding rather than implied away.

## On the disclosed residuals

Not counted as findings, but two are worth a follow-up issue rather than a comment:

- **R7 is the one residual that contradicts an invariant of this same PR.** The failure ordering exists so a
  rolled-back send cannot count — *"false in the one direction nobody would check"*. R7's retry path produces a
  second invite **and** a second `invite_sent`, inflating the count in exactly that direction. The code says
  this out loud at `public/app.js:1436-1450` and names `409 already_sent` as the answer. Worth an issue before
  the pilot, not just a comment.
- **The live Resend send** remains the right blocker to keep. The unit tests stub the transport by design.

---

## Summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 6 |
| Medium | 10 |
| Low | 6 |

Validation: **all green** (548/548 Node 24 · 27/27 probes · Level 1 gates `ok` · live sweep clean).

Most of the High list is one or two lines each — `state.reqId += 1` in `resetToInputs`, a `try/catch` around the
two rollback `await`s, a uniqueness check in `assertBrief`, a `max` on the date input, and invalidating the
preview when the date changes. The two that are real work are **H3** (seed the fixture note so the visibility
gate is actually asserted rather than trivially satisfied) and **H2**'s missing rollback test. Fix those and
this is a merge.
