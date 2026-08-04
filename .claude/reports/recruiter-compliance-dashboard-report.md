# Implementation Report — the recruiter compliance dashboard (#71)

**Plan**: `.claude/plans/recruiter-compliance-dashboard.md`
**Branch**: `feature/compliance-dashboard` (cut from `69cf5ca`, the #70 commit)
**Status**: COMPLETE

## Summary

`/compliance` is the recruiter's half of concurrent vetting and the last surface in epic #65's
milestone 1: every candidate on one screen with their whole checklist, worst first. Two controls
per submitted item — **Verify**, which is the first and only write of `verified` in the product,
and **Send back**, which resets the item to `missing` with its reference and date cleared and
emails the candidate a one-line reason.

Two decisions carry the ticket, and both have their failure written out in the code that guards
them. **Risk is computed at render time from `expiry_date` and never read off `status`**: the
sweep fires only on `/prep/*`, so a recruiter opening this screen triggers nothing, and a
deployment with no candidate traffic for a fortnight would otherwise under-report exactly when it
matters. **Verify and reject are compare-and-swaps on `status = 'submitted'` and do not go
through `setItemState`**, which writes `reference` and `expiry_date` unconditionally — a verify
routed through it would wipe the number and the date that made the document verifiable.

No migration, no new dependency, no new Access application, no new design token.

## Tasks completed

| task | file | action |
|---|---|---|
| `CATALOGUE_BY_KEY` + `targetFor` relocated, header amended | `src/compliance/catalogue.js` | UPDATE |
| the locals deleted, both imported, a note left at the old site | `src/compliance/nudges.js` | UPDATE |
| `listComplianceState`, `verifyItem`, `rejectItem`, `candidateEmailById` under a `#71` section | `src/compliance/store.js` | UPDATE |
| `sendRejectionEmail`; the digest's optional `link`; the six-emails note becomes seven | `src/prep/email.js` | UPDATE |
| `mailExpiryNudges` passes `link` without coupling the two guards | `src/compliance/nudges.js` | UPDATE |
| `GET /api/compliance` — catalogue join, render-time risk, four counts, server-side sort | `functions/api/compliance.js` | CREATE |
| `PUT /api/compliance/:candidateId` — the guard ladder and the bail-before-write | `functions/api/compliance/[id].js` | CREATE |
| the page: topbar, page head, one container, one status line | `public/compliance.html` | CREATE |
| the script: one `COPY`, one `fetch`, two chips per row, controls on submitted only | `public/compliance.js` | CREATE |
| the `.compliance-*` block, directly beneath #69's | `public/app.css` | UPDATE |
| the nav entry, five recruiter pages | `public/{index,clients,counts,assignments}.html` | UPDATE |
| the digest paragraph rewritten, a `#71` subsection, two triage rows, a smoke-test line | `DEPLOY.md` | UPDATE |

## Tests added

| file | cases | result |
|---|---|---|
| `test/compliance-dashboard.test.js` (CREATE) | 45 | pass |
| `test/compliance-store.test.js` | +7 (`#71` statement shapes) | 38 pass |
| `test/prep-email.test.js` | +11 (the rejection, and the digest's link) | 65 pass |
| `test/expiry-radar.test.js` | +1, and one rewritten (the digest's link) | 32 pass |
| `test/screens.test.js` | +1 screen | 4 pass |

The new file mirrors `test/assignments.test.js` in structure and `test/expiry-radar.test.js` in
fixture discipline: every date is computed by SQLite itself, every threshold is read off
`COMPLIANCE_CATALOGUE`, and every real-SQLite test takes `{ skip }`.

Five assertions are load-bearing and should not be simplified away:

- **`RISK IS FRESH WITH NO SWEEP HAVING RUN`** — an item submitted inside its own amber window,
  read back through the GET with nothing having touched `/prep/*`, answers `risk: "expiring"`
  while `status` is still `"submitted"`. This is the difference between a dashboard and a stale
  cache, and it is asserted twice: once against the fake (the mapping) and once against real
  SQLite (the arithmetic).
- **`VERIFY LEAVES THE REFERENCE AND THE DATE STANDING`** — read both before, verify, read both
  after. The `setItemState` trap, made permanent.
- **`A REJECT ON A DEPLOYMENT THAT CANNOT SEND WRITES NOTHING`** — four configuration
  permutations, each asserting the ABSENCE of an `UPDATE` rather than a zero statement count,
  because the address lookup legitimately runs first.
- **the ±1-day boundary for two items with DIFFERENT windows in one GET** — the assertion a
  hardcoded 30 or 60 would fail. `daysLeft === 0` is amber, not red.
- **verify refused from all four other states**, with `expiring` commented as a deliberate
  product hole rather than a bug, so nobody "fixes" the CAS.

## Validation results

Node v24.11.0 via `~/.nvm/versions/node/v24.11.0/bin/node`. The local default is v20.20.2, where
`node:sqlite` is absent.

**Level 0 baseline**, recorded on the branch point before any change: **1044 pass, 0 fail,
0 skipped**. (This includes the 9 tests in the untracked `test/prep-content.test.js`, which
belongs to another ticket and sits in the working tree; it is not touched by this branch.)

**Level 1 — all ten boundary gates clean**, run against `$BASE = 69cf5ca`:

1. `git diff --name-only $BASE -- migrations/ test/schema.test.js` → empty
2. `verify_recorded|reject_recorded|expiry_nudge_sent|extension_nudge_sent` in `src/ functions/ migrations/` → no matches
3. metadata-only grep over the diff's added lines → no matches
4. `\b(30|60)\b` in `public/compliance.js` → no match; `amberDays` → 0
5. `nudges.js` in `functions/api/compliance.js` → one match, and it is the comment saying the
   import is deliberately absent (the awk output was read, not just counted)
6. `awk '/export async function listComplianceState/,/^}/' … | grep -c email` → 0, and the awk
   range was inspected to confirm it spans the whole function rather than closing early
7. `setItemState` in the write route → no match
8. `<style` in `public/compliance.html` → 0; no raw hex in the `app.css` diff
9. `scripts/setup-access.py` → unchanged
10. `0011` in `DEPLOY.md` → 0

**Levels 2, 3, 5 — every named file green**: `compliance-dashboard` 45, `compliance-store` 38,
`prep-email` 65, `expiry-radar` 32, `extension-radar` 20, `compliance-passport` 18,
`compliance-purge` 8, `compliance-auth` 20, `compliance-pages` 16, `assignments` 27, `counts` 8,
`prep-middleware` 4, `schema` 17, `screens` 4, `chrome` 6, `tokens` 35.

**Full suite under Node 24: 1109 pass, 0 fail, 0 skipped.** +65 tests against the baseline, no
regressions, skip count unchanged.

Under Node 20 the suite is 832 pass / 1 fail / 276 skipped. The one failure is
`test/node-version.test.js`, #33's deliberate gate (`node --test` exits 0 on skips, so a Node-20
run would otherwise read as a pass while the whole `node:sqlite` layer went unproven); it is
untouched by this branch. `.claude/reports/expiry-radar-report.md` recorded 263 skipped at the
branch point, and the 13 added here are accounted for exactly: 12 `{ skip }` tests in Block 3 plus
the one new `{ skip }` test in `test/expiry-radar.test.js`. **Node 24 is the run that counts**, and
there it is 0 before and 0 after.

`scripts/purge.py`, `scripts/remind.py` and `scripts/setup-access.py` all parse under `ast.parse`
(no-regression check only — this ticket changes none of them).

**Level 4 — walked programmatically, not through a browser.** See Deviation 7. Steps 1–9 were
driven against real migrated SQLite through the real handlers, including the candidate's own
`POST /prep/compliance/api/item` with a real minted session cookie:

```
1. empty database → { candidates: [] } → the page shows its empty state
2. booking recorded → "Priya Nair" · 0 of 8 verified · 8 not sent in
3. candidate submitted Enhanced DBS check (2027-09-07) → "Waiting for you", no risk chip, awaiting_review 1
4. verified → "Verified", 1 of 8, reference "DBS-0099-2026" and date 2027-09-07 STILL on screen
5. no sweep ran, yet Immunisation record reads risk="expiring" (27 days) while status is still "submitted"
6. sent back → "Not sent in", reference and date gone. Subject: "Immunisation record: we need a new one"
7. RESEND_API_KEY unset → 503 mail_not_configured, and Right to work is STILL "Waiting for you"
8. verify on an ambered item → 409 not_submitted
9. sort → Cara Red (1 at risk) · Priya Nair (0 at risk) · Anna Clean (0 at risk)
```

**Steps 10 and 11 were not verified visually** and are the part of Level 4 left for a human. One
half of step 10 was closed statically instead of deferred: the plan flagged that a sixth nav entry
could overflow at 375px, and `.topbar-nav` already declares `flex-wrap: wrap` (`public/app.css`
:126-130), so the bar wraps rather than scrolling the page sideways. No CSS change was needed.
What remains unconfirmed by eye is the wrapped bar's appearance, the card's own layout at 375px,
and tab order through a candidate card.

## Deviations from the plan

1. **`listComplianceState` drives from `candidate` and LEFT JOINs the items**, where the plan's
   SQL was `FROM compliance_item i JOIN candidate`. The plan is internally inconsistent here: its
   own edge-case list requires "a candidate with zero items … renders as a card with a zero count
   rather than throwing", and an inner join makes that candidate disappear entirely. AC #1 says
   "every candidate the agency has recorded", and a candidate silently vanishing is the exact
   failure this screen exists to prevent. The LEFT JOIN also matches what
   `functions/prep/compliance/api/items.js` already shows the candidate for the same state, so the
   two screens agree. `candidate.id AS candidate_id` follows from it — on the row with no item,
   the item's copy of the id is null. Argued in the function's own comment; asserted in both test
   files.

2. **`$BASE` is `69cf5ca` (the #70 commit), not `main`.** `origin/main` is at the #67 merge, and
   #68/#69/#70 are unmerged, so `git diff main -- migrations/` lists three tickets' migrations and
   reads as an AC #7 failure that has nothing to do with this one. This is what the plan itself
   instructs, repeating `.claude/reports/expiry-radar-report.md` Deviation 2. Once #68–#70 merge,
   the literal `main` form becomes correct again.

3. **Block 1's route tests were written immediately after the routes**, not in Phase 7 with the
   rest. The 400/403/404/409/503 ladder is where this ticket's decisions live and it is cheap to
   assert against the fake; settling it before `public/compliance.js`'s error copy was written
   meant the copy was written once. Ordering only — the same tests, in the same file.

4. **The reject reason input is always present on a submitted row**, rather than "revealed by"
   the Send back button. Controls only appear on `submitted` items (a small subset of any card),
   so the noise is bounded, and a disclosure toggle is state to get wrong for no gain. Send back
   still requires it and says which box in a sentence before any round trip.

5. **`test/expiry-radar.test.js`'s "the digest carries no link at all" was rewritten, and
   `test/prep-email.test.js`'s equivalent renamed.** That assertion encoded #70's "there is no
   recruiter compliance surface until #71", which this ticket makes false — it is a behaviour
   change, not a regression. Both files now assert the pair that replaces it: the digest links
   `/compliance` when a base URL is configured, and is byte-identical to #70's message when it is
   not. The rule that did NOT change is asserted alongside: never a `/prep/*` path.

6. **The verify response is `{ ok: true }` and only reject carries `emailed`.** The plan's step 11
   reads as though both do; its own data-flow diagram shows the split. Verify sends no mail, so an
   `emailed` key on it would be a field with no meaning.

7. **Level 4 was walked programmatically.** `wrangler` is not installed in `node_modules` and
   `npm run dev` would fetch it — the same substitution #70's report recorded, for the same
   reason.

8. **The plan's `db.calls[].values` is `db.calls[].args`** in `test/helpers/fake-d1.js`. Used the
   real name.

9. **The GET computes `_expired`/`_expiring` per candidate and strips them from the response.**
   The sort needs the split; the screen does not, and shipping two more counts nobody renders
   would widen the contract by accident. A test asserts the response's key set exactly, so they
   cannot leak back in.

## Issues encountered

- **A test bug worth recording, because the assertion it broke is the ticket's most valuable
  one.** `anyUpdate` was first written as `/UPDATE/i.test(sql)`, and `getAgency` selects
  `updated_at` — so an unanchored match counted a read as a write and every bail-before-write
  assertion would have passed for the wrong reason. It is anchored now (`/^\s*UPDATE\b/i`) with
  the trap named in a comment beside it.

- **The GET's first draft omitted `items` from the candidate object.** Caught by Block 1 on its
  first run, which is the argument for having written Block 1 before the page.

- **For the owner, not a bug — the completeness headline decays and the recruiter cannot restore
  it.** A fully-verified candidate drifts from "8 of 8 verified" to "6 of 8" as items amber: the
  sweep moves `verified` → `expiring`, and the CAS refuses verify from `expiring`, so the only
  path back is the candidate re-submitting. This is Open Question 1's second cost and it is real
  on a two-founder pilot with 30–60 day windows. The risk chips still tell the truth throughout,
  which is the whole point of computing risk rather than reading it — but the number at the top of
  the card is not a number the recruiter can act on.

- The plan's other Open Questions are unchanged and still open — see below.

## The decisions a reviewer will want to argue with

Named here because the plan's completion checklist asks for them in the PR body.

1. **The compare-and-swap on `status = 'submitted'`, and the hole it creates.** An item that
   ambers while it sits on the recruiter's desk cannot be verified; only a re-submit clears it.
   Broadening the guard to accept `expiring` reopens the re-nudge loop — `dueExpiryItems` selects
   `verified` and `claimItemExpiry` accepts `from = 'verified'`, so the next sweep would re-amber
   the row and send the candidate a **second** email for the same expiry date, breaking the "one
   message per state change" promise `DEPLOY.md` makes. The trade is stated in `verifyItem`'s
   comment, asserted in `test/compliance-dashboard.test.js`, and carried to the owner below.

2. **Reject bails before writing; verify does not.** #69 bails before claiming because the email
   is a courtesy; #70 claims regardless because the state *is* what the passport renders. Reject
   is neither: the state change is visible to the candidate but its entire content — the reason —
   exists only in the email, so a write with no send leaves a locum staring at an item that has
   emptied itself. Every precondition is therefore settled above the write, **including the
   recipient**, which also narrows `emailed: false` to exactly one meaning (Resend threw) and is
   what makes the page's copy for it honest.

3. **409, not 404, from a failed CAS.** Every other route in the repo answers 404 from
   `changes === 0`. Here the row exists and it is the *state* that refused; a recruiter told "not
   found" would reload and see it still sitting there. The plan recommended 409 and Open Question
   4 is settled at it.

## Open Questions for the owner — put, not decided

1. **An item that ambers while awaiting review cannot be verified**, and the completeness
   headline decays with it (see Issues). Is "wait for a re-submit" acceptable, or does this need a
   third path — verify-and-suppress? That third path is a ticket, not a rider.
2. **The rejection reason is not stored** — no column, no migration, no durable free-text note
   about a candidate's health-adjacent document. The cost: a locum who deletes the email cannot
   recover why. **Assumed: not stored.** Flagged, not built.
3. **#70's flagged issue, inherited and deliberately out of scope**: a candidate's passport count
   *falls* when an item ambers, because `items.js`'s `DONE` set is `submitted|verified`. Does the
   owner want an `at_risk` count added to `GET /prep/compliance/api/items` and a line under the
   passport's count? That is the candidate's screen; this ticket is the recruiter's.

## Sequencing

This PR stacks on #70's, which stacks on #69's, which stacks on #68's, and **none of the four is
on `main`**. Merge order is #68 → #69 → #70 → #71. A reviewer who checks this branch out and diffs
against `main` will see four tickets' worth of change; diff against `69cf5ca` instead. If #68–#70
merge while this is in flight, rebase rather than merge so the stack stays linear and the Level 1
gates keep pointing at a single branch point.

## Ready for the next step

All plan tasks are complete and every validation command passes under Node ≥ 22.5. Next is
`piv-commit`, then `piv-create-pr` (this report fills the PR body), then `piv-review-pr`.
