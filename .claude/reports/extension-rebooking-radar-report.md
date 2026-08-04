# Implementation Report — Extension & rebooking radar (#69)

**Plan**: `.claude/plans/extension-rebooking-radar.md`
**Branch**: `feature/extension-rebooking-radar` (based on `feat/compliance-passport`, **not** `main`)
**Status**: COMPLETE

## ⚠ Contingency, surfaced not resolved

Issue #69 still carries the `contingent` label ("Blocked on a discovery signal; do not start
unopened"), and `docs/handover-louis-meeting.md` is a **prep** note — the questions to ask Louis
Groves, written 31 Jul — not a record that the meeting happened. The plan's own header says to
surface that rather than start. It is surfaced here and belongs in the PR body. It was built
anyway because the owner invoked `/piv-implement` on this plan directly, and because #67 and #68
were already built past the same gate.

## Summary

`assignment.end_date` becomes a clock. A new migration adds a set-exactly-once claim column, four
store functions turn it into a radar, a second sweep on the portal's existing lazy slot emails the
recruiter fourteen days before a booking ends, and a new `/assignments` screen (nav label
**"Bookings"**) lists every booking ending-soonest-first with an amber state and controls to extend
or resolve. Pure recruiter-side: nothing under `/prep/*` changes except the middleware's job list,
and no candidate is ever emailed. The POST is also the product's first production path that creates
a `candidate` row — which makes #68's passport usable on a real deployment as a side effect.

## Tasks completed

**Foundation**
- migration `0010_assignment_nudge.sql` → `migrations/0010_assignment_nudge.sql` (CREATE)
- `EXTENSION_LEAD_DAYS = 14` → `src/compliance/catalogue.js` (UPDATE)
- the schema lockfile widened by one column, with the reason → `test/schema.test.js` (UPDATE)

**The store** — `src/compliance/store.js` (UPDATE), new `// ── the extension radar (#69) ──` section
- `dueExtensionNudges(db, leadDays)` — the five-clause predicate, bound modifier, `Number.isInteger` guard
- `claimExtensionNudge(db, id)` — `claimReminder`'s `UPDATE … WHERE … IS NULL` at the booking root
- `listAssignments(db)` — named columns, three-question ordering
- `updateAssignment(db, id, patch)` — the extend/resolve write **and the re-arm**

**The sweep and the email**
- `sendExtensionNudgeEmail` + the three-emails note widened to four → `src/prep/email.js` (UPDATE)
- `sendDueExtensionNudges(env)` → `src/compliance/nudges.js` (CREATE)
- second `waitUntil` registration with its own catch → `functions/prep/_middleware.js` (UPDATE)
- `RECRUITER_EMAIL`, the second-sweep section, two triage rows → `DEPLOY.md` (UPDATE)
- docstring widened to "both sweeps", second assurance query → `scripts/remind.py` (UPDATE)

**The recruiter surface**
- `GET`/`POST /api/assignments` → `functions/api/assignments.js` (CREATE)
- `PUT /api/assignments/:id` → `functions/api/assignments/[id].js` (CREATE)
- `isRealDate` moved out of `item.js` into `src/prep/dates.js` (REFACTOR — removes a copy, adds none)
- `public/assignments.html` (CREATE), `public/assignments.js` (CREATE)
- `.assignments-*` rules → `public/app.css` (UPDATE)
- Bookings nav entry on `index.html`, `clients.html`, `counts.html` (UPDATE)

**The architecture doc**
- `docs/epics/locum-fit-2.architecture.md` (UPDATE) — an inline **AMENDED 3 Aug 2026** block on the
  telemetry decision, recording the `events.kind` divergence and its evidence, and handing #70 the
  finding.

## Tests added

| File | Cases | Result |
|---|---|---|
| `test/extension-radar.test.js` (CREATE) | 20 — the 14/15-day boundary, today vs yesterday, NULL end date, the status inversion, ordering, two-concurrent-claims, the re-arm, extend-inside-the-window, resolve-does-not-re-arm, clearing the end date, the cascade, bail-before-claim ×4 preconditions, the comma'd recipient, one-nudge-per-booking-once | 20 pass |
| `test/assignments.test.js` (CREATE) | 27 — routes on fake-d1 (orphan guard, reuse, vocabularies, rolled dates, 403/503/404), the page/script source scan, **plus five real-SQL end-to-end route tests** | 27 pass |
| `test/compliance-store.test.js` (UPDATE) | +8 — statement shape for all four store functions, bind parity, the projection, the re-arm in SQL, the pre-SQL 400s | 26 pass |
| `test/prep-email.test.js` (UPDATE) | +8 — the fourth email: both names, day-only date, header injection, the cap, escaping, `mailFrom`, no key, tone. The other three unchanged | 40 pass |
| `test/prep-middleware.test.js` (UPDATE) | +1, and the `waitUntil` count 1 → 2 — one unconfigured sweep does not take the other or the response down | 3 pass |
| `test/screens.test.js` (UPDATE) | +1 screen registered | 3 pass |

## Validation results

Run on **Node v24.11.0** (checked, not assumed — the default on this machine is v20.20.2, where
`node:sqlite` is absent and 226 tests skip).

```
baseline (before any change) : 928 pass, 0 fail, 0 skipped
final                        : 993 pass, 0 fail, 0 skipped     (+65)
```

⚠ **Both numbers include `test/prep-content.test.js` (9 tests), an untracked file belonging to
another session in this shared worktree.** It is NOT part of this commit. A reviewer running
`npm test` on a clean checkout of this branch should expect **984 pass, 0 fail, 0 skipped** —
verified by running the suite with that file excluded (919 → 984, the same +65).

- `node --check public/assignments.js`, both route files — pass
- `python3 -c "import ast; ast.parse(...)"` on `scripts/remind.py` — pass
- Level 1 metadata-only grep over the whole new surface — **`ok: metadata only`**
- `test/chrome.test.js`, `test/tokens.test.js`, `test/counts.test.js` — 49 pass (no raw hex, no
  unguarded transition, no page-scoped `<style>`, `counts.js` byte-for-byte untouched)
- Node 20 run: 761 pass / 226 skipped / **1 fail — `test/node-version.test.js`, pre-existing and
  by design** (it fails deliberately below Node 22.5 so a skipping run is not read as a pass).

### Manual sweep (Level 4) — 11 of 12 steps run live

`npm run db:local` applied `0010`, then `wrangler pages dev` on port 8790 (8788 was held by
another session's hung `workerd`; see Issues).

| # | Step | Result |
|---|---|---|
| 1 | `/assignments` loads; nav on all four screens, current on this one | ✅ title + 1 link per page |
| 2 | Booking ending in 20 days | ⚠ **API only** — 201, `end_date` 2026-08-23, `status: booked`. The *rendered* row was not seen |
| 3 | Booking ending in 9 days sorts above it, amber, "Ends in 9 days" | ⚠ **API only** — Marcus 2026-08-12 sorts above Priya 2026-08-23 and `lead_days: 14` arrives; the *chip* was not seen |
| 4 | Second booking, same email | ✅ `candidates=2, items=16, bookings=3` — the invariant `items = 8 × candidates` holds |
| 5 | Unknown `client_id` | ✅ **404, counts unchanged** — no orphan candidate, no eight rows |
| 6 | Bad input is 400, never 500 | ✅ rolled date 400, end-before-start 400, stray key 400 |
| 7a | Sweep bails before claiming (no key, no recipient) | ✅ every `nudge_sent_at` still NULL |
| 7b | Live send with real credentials | **skipped — see Issues** |
| 8 | Five more pokes | ✅ still 0 stamped rows |
| 9 | Extend re-arms | ✅ stamp → PUT new end date → `nudge_sent_at` back to NULL |
| 10 | Resolve does not re-arm | ✅ stamp unchanged; row sinks to the bottom of the list |
| 11 | Delete-now takes everything | ✅ 0 orphan assignments, 0 orphan checklist rows |
| 12 | Prep portal untouched | ✅ `/prep/login` 200, `/prep/privacy` 200, `/prep/demo` 302, `/counts` 200 and still shows its two numbers |

Also checked live: PUT unknown id → 404, PUT `status: "extended"` → 400.

## Deviations from the plan

1. **`test/prep-middleware.test.js` gained a third test rather than only a moved count.** The plan
   asked for the independence property to be "asserted"; it is a named test that seeds a due
   booking, runs the middleware with `RECRUITER_EMAIL` absent, and proves both promises resolve,
   the response serves, nothing was claimed, and the reminder still sent.

2. **The new sweep is registered AFTER `sendDueReminders`, deliberately.** That file's first test
   does `await captured[0]` and then asserts `fetchCalls === 1`. Prepending the radar would put a
   promise that bails instantly in that slot and the assertion would stop testing what it says.
   Written into the middleware comment so nobody reorders it.

3. **`test/assignments.test.js` carries five REAL-SQL end-to-end route tests** beyond the plan's
   fake-d1 scope. These make Level 4 steps 4, 5 and 6 durable rather than one-shot, and they close
   a real gap: the fake enforces no constraint, so the orphan guard was only proven there by the
   *absence* of an INSERT. The new block proves the foreign key that guard stands in front of is
   real (with an explicit assertion that fails loudly if `PRAGMA foreign_keys` ever goes off).

4. **The screen's state cell has one case the plan did not name:** an end date already in the past
   on a still-`booked` row. It renders plainly as "End date has passed" and is **not** amber. The
   plan forbids an at-risk flag (#71's), and the plan's "otherwise a plain date" would have shown
   the date twice — the Ends column already has it. Commented in `assignments.js`.

5. **The nudge subject strips CR/LF to a space rather than censoring words.** The R8 test asserts
   `"Bcc: someone@else.example"` survives *as text* on one line. That is `sendInviteEmail`'s exact
   behaviour: the injection is the line break, not the string, and a denylist is the wrong shape
   for a header-safety rule.

6. **The architecture doc amendment was written** (the checklist allowed either that or a PR note).
   It is an inline block on the telemetry decision itself, so a reader of that clause cannot miss
   that the mechanism it names does not exist.

## The one thing not verified: `public/assignments.js` has never executed

Everything below the browser is proven — the API returns the right rows in the right order with
`lead_days`, and every state the screen can show has a store-level test behind it. But the script
itself has never run. `stateOf` (the amber/plain/open/lapsed decision and the day arithmetic),
`controls`, and the chip class composition are covered only by `test/screens.test.js`, which
proves the ids it asks for exist — not that what it renders is right.

That gap is deliberate rather than an omission: `test/screens.test.js` states the house decision
in its own words — *"there is no DOM in this suite and adding one to check a property of the files
themselves would be the wrong trade."* Adding a DOM stub to execute this one IIFE would overturn a
written decision inside a ticket scoped as "extension radar", which is the same argument this
ticket already made about the `events.kind` rebuild.

**So: open `/assignments` once in a browser before merge** with a booking 9 days out and one 20
days out, and confirm the first row reads "Ends in 9 days" on the amber ground and the second does
not. That is a two-minute check and it is the last unproven claim in the ticket.

## Issues encountered

- **Level 4 step 7b (the live send) was not run.** It requires setting a real `RESEND_API_KEY` in
  `.dev.vars` and poking the sweep, which fires an outbound request to Resend carrying a candidate
  name under a credential I would be adding to a config file this worktree shares with other
  sessions. The behaviour it would show is already proven with a stubbed `fetch` in
  `test/extension-radar.test.js` ("a fully configured sweep sends exactly one nudge per due
  booking, once", asserting recipient, the `/assignments` link, the absence of any `/prep/` path,
  and that a second sweep sends nothing). **Worth doing once by hand on the preview deployment
  before merge.**

- **Port 8788 is held by another session's hung `workerd`** (it listens but never answers). The
  sweep ran on 8790 instead. Nothing to fix in this branch; consistent with the shared-worktree
  note in memory.

- The local dev D1 was left empty by step 11's `DELETE FROM candidate`. It held no pre-existing
  candidates (the first count taken was exactly the two this sweep created).

## Two gates moved, three counting the registration — each with a reason

- `test/schema.test.js` — one column added to `assignment`'s lock, with a comment covering why
  `nudge_sent_at` is the only record of a nudge and why it is cleared where `reminder_sent_at`
  never is. `events.kind`'s vocabulary, the exact-tables lock and the ALTER self-guard untouched.
- `test/prep-middleware.test.js` — `waitUntil` count 1 → 2, plus the new independence test.
- `test/screens.test.js` — a third screen registered in `SCREENS`.

## Deploy note for the PR body

**Migration `0010` must be applied to production/preview D1 before the deploy** (`npm run
db:remote` / `npm run db:preview`) — every radar statement names `assignment.nudge_sent_at`. Then
set `RECRUITER_EMAIL` (a plain Variable, not a Secret). Until it is set the radar is a silent
no-op by design and nothing is burned.

## Ready for the next step

**Stage explicitly — never `git add -A`.** This worktree is shared with other sessions, and
`git status` carries six untracked files that belong to them and must NOT be committed:
`.claude/code-reviews/pr-5{1,2,3}-review.md`, `.claude/plans/candidate-portal-content-pages-redesign.md`,
`.claude/reports/candidate-portal-content-pages-redesign-report.md`, `docs/handover-louis-meeting.md`,
and `test/prep-content.test.js`.

This ticket's 28 files (`.claude/` is tracked in this repo, so the plan and this report go in):

```
# modified (18)
DEPLOY.md  docs/epics/locum-fit-2.architecture.md  functions/prep/_middleware.js
functions/prep/compliance/api/item.js  public/app.css  public/clients.html
public/counts.html  public/index.html  scripts/remind.py  src/compliance/catalogue.js
src/compliance/store.js  src/prep/dates.js  src/prep/email.js
test/compliance-store.test.js  test/prep-email.test.js  test/prep-middleware.test.js
test/schema.test.js  test/screens.test.js

# new (10)
migrations/0010_assignment_nudge.sql  src/compliance/nudges.js
functions/api/assignments.js  functions/api/assignments/[id].js
public/assignments.html  public/assignments.js
test/assignments.test.js  test/extension-radar.test.js
.claude/plans/extension-rebooking-radar.md
.claude/reports/extension-rebooking-radar-report.md
```

Re-check `git branch --show-current` immediately before committing — HEAD moves under a shared
worktree.

Then `piv-create-pr` — **the PR base must be `feat/compliance-passport`, not `main`.** #68 is not
merged; its branch IS on the remote (`origin/feat/compliance-passport` at `db1334f`, confirmed), so
the base exists. `piv-create-pr` auto-detects the base via `git symbolic-ref
refs/remotes/origin/HEAD` and will pick `main` without asking, producing a two-ticket diff —
override it. Then `piv-review-pr`.

PR body should carry: `Closes #69`; the contingency note at the top of this report; the migration-
before-deploy note and `RECRUITER_EMAIL`; the three gates that moved with their reasons; the
`events.kind` divergence (and that the architecture doc now records it inline); the browser check
above as the one open item; and that this ticket incidentally makes #68's passport usable on a real
deployment, because recording a booking is now the moment a candidate's compliance file starts
existing.
