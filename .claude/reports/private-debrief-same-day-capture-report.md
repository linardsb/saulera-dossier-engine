# Implementation Report — Private debrief, same-day capture (#77)

**Plan**: `.claude/plans/private-debrief-same-day-capture.md`
**Branch**: `feature/private-debrief`
**Status**: COMPLETE

## Summary

Once a candidate's interview date has passed, `/prep/debrief` offers one short private form: what
they were asked, which competencies felt shaky, and one thing to fix. Each question they place
under a competency becomes a real `question` row with `axis = 'lateral'`, so the existing drill
serves it next session with no new serving path; competencies ticked shaky are dampened by one
readiness rung in `targeting.js`, which lifts them up the queue without showing a number. Both new
tables hang off `candidate_role`, so the 30-day purge and delete-now take them unchanged. Nothing
crosses the wall, and that is asserted as a reachability claim rather than promised.

## Tasks completed

- Branch + migration number confirmed (`0011` free) → `feature/private-debrief`
- The cage → `migrations/0011_debrief.sql` (CREATE)
- Exact-tables and column locks → `test/schema.test.js` (UPDATE)
- Cascade proof, row-for-row → `test/portal-purge.test.js` (UPDATE)
- Five store functions under a `── the private debrief (#77) ──` banner → `src/portal/store.js` (UPDATE)
- Store + route + wall tests → `test/prep-debrief.test.js` (CREATE)
- `SHAKY_DAMPEN`, `readiness({shaky})`, `drillState({shakyIds})` → `src/prep/targeting.js` (UPDATE)
- Three dampening tests → `test/prep-targeting.test.js` (UPDATE)
- GET + POST, gated, ownership-checked, capped → `functions/prep/api/debrief.js` (CREATE)
- `shakyIds` + `debrief_available` → `functions/prep/api/session.js` (UPDATE)
- `shakyIds` → `functions/prep/api/turn.js` (UPDATE)
- `debrief_available` → `functions/prep/api/brief.js` (UPDATE)
- The form page → `public/prep/debrief.html` (CREATE)
- The 16px control floor and the page's own rhythm → `public/prep/prep.css` (UPDATE)
- `initDebrief({doc, fetchImpl, navigate})` + `COPY` → `public/prep/debrief.js` (CREATE)
- Controller + source gates → `test/prep-debrief-ui.test.js` (CREATE)
- The debrief page admitted to the content gate → `test/prep-content.test.js` (UPDATE)
- Entry links → `public/prep/brief.html` · `brief.js` · `session.html` · `session.js` (UPDATE)
- `SHELL_IDS` + shell double → `test/prep-session-ui.test.js` (UPDATE)
- The State line amended, not forked → `docs/epics/interview-prep/SPEC.md` (UPDATE)
- Migration warning, triage row, ticket section → `DEPLOY.md` (UPDATE)
- Full-schema table list → `test/compliance-purge.test.js` (UPDATE)

## Tests added

**`test/prep-debrief.test.js`** — 19 tests, all on real SQLite via `test/helpers/sqlite-d1.js`.
Store: upsert creates then edits one row and keeps its id (including that `RETURNING id` on the
DO UPDATE path returns the *standing* row's id); a re-save keeps the ticks; `asked_json`
round-trips a `null` placement and a moved line reports its new competency; ticks replace
wholesale and are role-scoped; `insertAskedQuestion` is idempotent and keys on (competency, text);
an asked question is what `drillState` serves. Route: the day gate in both directions; 401 / 403
cross-origin / 400 `unexpected_fields`; a competency from another role is 404 with nothing
written; each cap answers for its own field; a partial save is legal and a later save adds to it;
two identical saves create one question row (and so does one with a stray space); a moved line
round-trips; a corrupt `asked_json` degrades to an empty list; a vanished competency comes back
unplaced. AC2's second clause: a tick reorders `drillState` between two competencies made
identical to the ranking, while `/prep/api/session`'s competency literals stay byte-identical and
carry exactly `{covered, id, label, moved}` — asserted as the key set, not as a substring scan.
The accepted mint-cap interaction: eight asked questions reach
`MAX_VARIANTS_PER_COMPETENCY`, and the competency re-serves instead of minting. Wall: the
`functions/` reachability scan with its self-guard, the one-module SQL claim, and the
`/api/events` sentinel.

**`test/prep-debrief-ui.test.js`** — 16 tests against `test/helpers/dom.js`. The three open states;
prefill and pre-ticks; three lines render three distinctly-labelled pickers; **a pick survives an
edit to the line above it**; save posts exactly the current state then re-fetches; a failed save
keeps every typed word; 401 navigates; 404 is a state and not a failure; the source gates (no HTML
parsing, no browser storage, no candidate text in a URL, no model call); the no-rank sweep; COPY
completeness.

**`test/prep-targeting.test.js`** — 3 added: a tick moves the target between two otherwise
identical competencies (and unticking moves it back), `readiness` clamps at 0, and
`confidenceQuestion` inherits the dampening.

## Validation results

| Gate | Result |
|---|---|
| `npm test` (Node v24.11.0) | **1157 pass, 0 fail, 0 skipped** (baseline before this work: 1116) |
| `npm run db:local` | `0011_debrief.sql ✅` — 4 commands, applied to a real D1 |
| Live smoke (`npm run dev`) | see below |
| Wall test fails when broken | verified — a `debrief` reference added to `functions/api/events.js` fails it by name; reverted |

Live smoke against `wrangler pages dev` with a seeded past-interview invite:

- `/prep/debrief` 200 HTML · `/prep/debrief.js` 200 · `/prep/api/debrief` 401 with no cookie
- GET → `{available:true}`, labels and ids only; POST trims `"  A lone visit…  "` on the way in
- GET again round-trips both lines including the `competency_id: null` one
- `/prep/api/session` returns `next_question: {id: "smoke-role:lone#asked-9c4643cbb46dcf5d", …}` —
  **the placed line is what the next session serves**, and `debrief_available: true`
- An identical re-save adds no question row; moving the line adds one under the new competency and
  the GET reports the new placement; unticking clears the shaky set
- A future-interview invite: `available:false` on GET, `403 too_early` on POST, and
  `debrief_available:false` on both `/prep/api/brief` and `/prep/api/session`
- `/api/events` carries no candidate word
- `POST /prep/api/delete` → `/prep/api/debrief` 401 and both tables at zero rows

Smoke fixtures were removed from the local D1 afterwards; the dev server is stopped.

**Not run:** the phone/390px viewport check (plan Level 4's last box) and the real-Safari keyboard
pass. Those need a device and are the manual sweep the UI test file's header says it cannot
answer. Everything they check is structural here — `.textarea` on both boxes and the 16px floor on
`.select` are both gated by `test/prep-content.test.js` and `test/prep-registry.test.js`.

## Deviations from the plan

1. **`test/portal-purge.test.js`'s local `openMigrated` now applies every migration, not just
   0001 and 0002.** The plan's task 4 said to add the debrief tables to `PORTAL_TABLES` and seed
   them, but that file builds its own database from two named files — so the fixture failed with
   `no such table: debrief`, which reads exactly like the cascade bug the file exists to catch.
   It now applies `files[0]`, seeds `events` between, then loops the rest in sorted order — which
   is the argument `test/helpers/sqlite-d1.js:110-116` already makes in the repo's voice, and
   makes the next caged table free. Consequence: the first test's expected table list grew to the
   full 17-table schema. Its actual claim (the ALTER backfills `kind` on existing rows) is intact.

2. **`test/compliance-purge.test.js` needed the two tables too** — not in the plan. It uses the
   *shared* `openMigrated` and asserts the full `sqlite_master` list, so any new table fails it by
   construction. Two entries added with a comment saying why they are listed in a compliance file
   (the assertion is "what SQLite ended up with", not "what this regime owns").

3. **`debrief.js`'s 401 path returns a `BOUNCED` sentinel rather than brief.js's never-resolving
   promise.** This controller exposes `ready`, which the suite awaits; a chain that never settles
   hangs the run instead of failing it (it did, once). Every caller checks the sentinel and says
   nothing, which is the property the never-resolving promise was buying — no error line flashing
   over a page that is already leaving — reached without the deadlock. Stated in the comment.

4. **The route trims each asked line once, at the top of the POST**, and that trimmed value is
   what goes into `asked_json`, the cap check, and the SHA-256 the question id derives from. The
   plan implied the trim but did not pin the three to one value; storing untrimmed while hashing
   trimmed would mint a duplicate question row for every re-save whose line gained a space. There
   is an assertion for it (`" How do you decide…​ "` on the third save adds no row).

5. **`test/prep-content.test.js` gained an explicit stylesheet-chain assertion for debrief.html.**
   Adding the page to `CONTENT_PAGES` buys the robots, viewport and no-inline-style loops, but the
   chain test names `BRIEF_HTML` and `SESSION_HTML` directly — so membership alone would have
   asserted nothing there. Three test names/messages that said "both content pages" were corrected
   to "every"/"all three".

6. **The DEPLOY.md triage row is not the one the plan drafted.** The plan said a 500 from
   `/prep/api/debrief` "on a deployment where `/prep/api/session` is healthy" means 0011 is
   missing. That state cannot occur: `session.js` and `turn.js` both read `shakyCompetencyIds`
   now, so a missing 0011 takes the drill down too. The row names `/prep/api/brief` as the one
   that stays up, which is what tells it apart from a broken `DB` binding. The ⚠ migration line
   says the same thing explicitly, because it is the easy thing to miss.

7. **The debrief page's labels and captions are written by the controller from `COPY`, not by the
   markup.** The plan asked for both ("every visible string in one exported COPY object" *and* a
   markup structure); one of them had to own each string. COPY owns them all, so the tone rules
   are reviewed in one place — at the cost that debrief.html without its script is a page of empty
   labels. `test/prep-content.test.js` gates the script tag and says so.

8. **`test/schema.test.js`'s regime list is not `PORTAL_TABLES` sorted inline.** The array is now
   multi-line with the regime argument above it (why the debrief joins the portal's cage and not
   the compliance one), mirroring the `COMPLIANCE_TABLES` comment block the plan pointed at.

9. **`debrief.js` answers a 404 with the "not ready yet" register, which the plan did not spell
   out for this page.** The plan's Error register section named the distinction for the *route*
   (a page state, not an error) and the page inherited only the too-early half. A handover that
   was never written now gets brief.js's copy in the same section rather than "something went
   wrong". Nearly unreachable — neither entry link is shown without a handover — so it only bites
   a typed URL, but the register is the plan's and the fix is one branch.

## Issues encountered

- **Node on PATH is v20.20.2**, below the `>=22.5` `package.json` declares. Every `node:sqlite`
  test *skips silently* there, so a run reports green while asserting nothing. Every command in
  this report was run with `PATH="$HOME/.nvm/versions/node/v24.11.0/bin:$PATH"`, and each result
  was read off the `skipped 0` line rather than the exit code. Anyone re-running this needs the
  same shell.
- The plan's SPEC.md line numbers (61–62) were stale because Amendment 1 is uncommitted in this
  shared worktree; the State line was located by its text instead. Amendment 1 was present and
  is carried on this branch, as task 20 intended.
- Six untracked files from other sessions are in the tree (`.claude/code-reviews/pr-51..53`, two
  plans, one report). They are **not** part of this work — stage by explicit path, never `-A`.
- **The AC2 projection test needed its fixture fixed before it could mean anything.** The first
  version ticked a competency sitting at readiness 0, where `SHAKY_DAMPEN` clamps and nothing
  moves; it failed honestly and the fixture now sets both competencies to the same importance and
  an identical non-zero cached stage/rate. Worth knowing generally: **the dampening does nothing
  to a competency the candidate has never practised**, because readiness cannot say "less ready
  than not started". That is correct — such a competency already ranks at the top — but it means
  the tick only reorders competencies that have been drilled.
- **`functions/prep/demo.js` needs no change** (checked, since production is currently the demo).
  It is a sign-in door only: it re-mints `inv-demo`'s token and redirects. It calls no
  `drillState`, seeds nothing, and reads no table this ticket touched. Whether the demo shows the
  "How did the interview go?" link is decided entirely by the seeded invite's `interview_at` — a
  data question for whoever runs the demo, not a code one.
