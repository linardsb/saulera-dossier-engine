# Implementation Report — Storybank: the candidate's real stories as state

**Plan**: `.claude/plans/storybank-candidate-stories-as-state.md`
**Branch**: `feature/storybank` (off `main`, not off the merged `feature/private-debrief`)
**Status**: COMPLETE

## Summary

The candidate's own interview stories are now state the drill can point at, never content the tool
writes. Two tables inside the portal's existing invite-scoped retention cage (`story`,
`story_competency`, migration `0012`), seven store functions, two candidate routes, one editor page
at `/prep/stories`, one pure targeting helper (`storyGap`), and one conditional block in the nudge
prompt that carries story **titles** and nothing else.

The feature's central claim is a negative — *the tool never writes a story* — so every mechanism
enforcing it is structural rather than behavioural: an absent import, a query with no `sketch`
column in it, and a filesystem reachability scan. `sketch` is selected by exactly one store
function, read by exactly one route, and rendered on exactly one page; `storyTitlesByRole` exists
so the model-facing path has no sketch to leak however it is later rewritten.

## Tasks completed

| Task | File | |
|---|---|---|
| The two tables, inside the portal cage | `migrations/0012_storybank.sql` | CREATE |
| Regime list, table count, exact columns, cascade chain | `test/schema.test.js` | UPDATE |
| Row-for-row cascade proof (2 stories + 2 ticks per invite) | `test/portal-purge.test.js` | UPDATE |
| Third table-list lockfile the plan did not name | `test/compliance-purge.test.js` | UPDATE |
| The `// ── the storybank (#78) ──` section, 7 functions | `src/portal/store.js` | UPDATE |
| `storyGap()` — the pure forward-looking flag | `src/prep/targeting.js` | UPDATE |
| `storyGap` unit tests (5 cases) | `test/prep-targeting.test.js` | UPDATE |
| Collection route: GET the bank, POST a new story | `functions/prep/api/stories.js` | CREATE |
| Item route: `save` \| `delete` one story | `functions/prep/api/story.js` | CREATE |
| Store + routes + **the wall** | `test/prep-storybank.test.js` | CREATE |
| `SESSION_SYSTEM` rule 6; `mintNudge`'s conditional block | `src/prep/drill.js` | UPDATE |
| Rule-6 greps, block present/absent, source grep | `test/prep-drill.test.js` | UPDATE |
| The degrading titles read on the `nudge` rung | `functions/prep/api/turn.js` | UPDATE |
| Prompt assertions + the missing-`0012` degrade case | `test/prep-turn.test.js` | UPDATE |
| The editor's shell (ids only, no copy in markup) | `public/prep/stories.html` | CREATE |
| `initStories({doc, fetchImpl, navigate})` + `COPY` | `public/prep/stories.js` | CREATE |
| `.stories` block beside `.debrief`, tokens only | `public/prep/prep.css` | UPDATE |
| Unconditional entry links (+ the comment saying why) | `public/prep/{brief,session}.html` | UPDATE |
| Page registered in `CONTENT_PAGES` + 4 new gates | `test/prep-content.test.js` | UPDATE |
| The page through the document double | `test/prep-storybank-ui.test.js` | CREATE |
| Section + triage row | `DEPLOY.md` | UPDATE |

## Tests added

**`test/prep-storybank.test.js`** (27) — store: id minting, edit round-trip, blank sketch legal /
blank title refused, whole-set tick replacement, titles-only read, cross-invite update+delete,
cascade on story delete, competency-deleted-under-a-re-handover, invite delete. Routes: the door
(401/403/`unexpected_fields`), 404 with no handover, GET round-trip, `{id,label}`-only
competencies, the gap across three states, a role with zero competencies, every cap, the 13th
story, a foreign `competency_id`, both `story.js` actions, the two vocabularies. The wall: the
matcher's own blind spots, the reachability scan, the sketch seam over `turn.js` and `drill.js`,
"exactly one query selects `sketch`", both routes structurally model-free, engine-store exclusion,
and the caps drift test.

**`test/prep-storybank-ui.test.js`** (27) — open states; list rendering incl. the two
no-covers cases; per-story `aria-label`s; **story B not inheriting story A's ticks**; new-vs-edit
routing and body shape; save-then-refetch; **a failed save keeping every word**; **`sentSnapshot`
keeping text typed mid-flight** and its converse; the delete two-step and its disarm cases; caps
refused in-page with the route's own `max_stories`; the gap line carrying no digit; and the source
gates (no browser storage, no HTML-parsing assignment, only two endpoints + the bounce, the shape
prompt is a static string, no model).

Plus 5 `storyGap` cases, 5 in `prep-drill`, 4 in `prep-turn`, 4 in `prep-content`.

Two added in review (see deviations 9 and 10): the `competency_ids` length cap on both routes with
its duplicate-id companion, and the page's save-time story-cap re-check driven through the
re-fetch window that makes it reachable.

## Validation results

Run under **Node v24.11.0** (`~/.nvm/versions/node/v24.11.0/bin/node`) — the repo's `engines`
field requires `>=22.5` and the machine default is v20.20.2, where every `node:sqlite` test carries
`{ skip }` and would report green while executing nothing.

- **`npm test`: 1241 tests, 1241 pass, 0 fail, 0 skipped.** Baseline on `main` before any change
  was 1170 / 0 / 0, so this adds 71 tests and regresses nothing.
- `node --check` clean on all 9 touched `.js` files.
- All 12 migrations apply clean standalone to a fresh SQLite with `foreign_keys=ON`; 19 tables.
- Level 5 by hand: the wall grep and the `turn.js` sketch-seam grep both print nothing.
- Untouched siblings still green: `prep-debrief` 23, `prep-debrief-ui` 22, `chrome` 6,
  `prep-registry` 48.

**Not done: Level 4 manual validation.** No local `wrangler dev` run, no real-iPhone Safari sweep
(tap-to-zoom, ≥44px targets), no keyboard pass. `test/helpers/dom.js` explicitly cannot answer any
of those — its own header says so — so they remain outstanding and are listed in the plan's Level 4.

## Deviations from the plan

1. **`ORDER BY created_at, rowid`, not `created_at, id`.** The plan specified `id` as the tiebreak.
   That is a bug: `created_at` defaults to `datetime('now')` (second granularity) and the ids are
   uuids, so two stories saved in the same second came back in an arbitrary — and permanently
   stable — order, leaving the candidate's list shuffled with no way to fix it. It surfaced as a
   test that passed on one run and failed the next. `rowid` is SQLite's own insertion counter, so a
   tie falls back to the order the rows were actually written. Argued in `storiesByRole`'s JSDoc;
   pinned by a five-story same-second test.

2. **`test/compliance-purge.test.js:97` also had to move.** The plan named `schema.test.js` and
   `portal-purge.test.js` as the table-list lockfiles; there is a third, asserting what a real
   SQLite ends up with after every migration. Found by the full suite, not by the per-task
   validations.

3. **`prompt.js` → `drill.js`.** The ticket's Seams line names the wrong module for the turn
   prompt. `src/prep/prompt.js` is the brief-generation prompt (one Opus call at Send, before any
   story exists); the turn prompt is `src/prep/drill.js`. Implemented against `drill.js`, as the
   plan's Open Question 1 resolved. SPEC Amendment 1 names no file, so no spec amendment is needed.

4. **`rankCompetencies` directly rather than `drillState`** in the stories GET (the plan offered
   both and recommended this). `drillState` would pull the whole question bank and attempt log to
   build a queue for a page that drills nothing. `shaky` is still decorated the way
   `drillState:353-362` does it, because it lowers `readiness` and so changes the RANK.
   `last_attempt_at` is deliberately *not* decorated — see deviation 8 for what that does and does
   not mean.

5. **Caps: `stories.js` owns them, `story.js` retypes two with a drift test.** The plan said
   "import from one place or restate with a comment". A shared helper under `functions/` is
   impossible (`src/http.js:4-5` — it would become a live endpoint), so this takes the repo's
   settled answer to that exact constraint (`public/prep/registry.js` retypes the compliance
   catalogue for the same reason): retype, and gate the drift. `MAX_STORIES` is *not* retyped — the
   item route creates nothing — and the page gets the real number from the payload rather than
   mirroring it.

6. **No outer-catch log line in either route.** The plan suggested one. `turn.js:216` and
   `debrief.js:223` log inside *degrading* branches — a swallowed failure that would otherwise be
   invisible. Neither storybank write degrades, so a log in the outer catch would emit a line for
   every routine 401/404 and add noise around the one signal DEPLOY.md's triage table reads.
   Stated in the code at both catch sites.

7. **Comments written around the gates that grep for them.** The plan's own suggested `turn.js`
   comment contained the literal word the plan's own Level 5 grep forbids. Both are handled the way
   `debrief.js:14` and `item.js` already do it — the names are left unwritten and the comment says
   why — *and* the test strips comments first, so neither the automated gate nor the hand-grep can
   be tripped by accurate prose. Same fix applied to the caps drift test after it failed on
   `story.js`'s own header.

8. **The story gap is rank order, and the comments claiming otherwise were corrected.** The first
   draft's comments said the `shaky` decoration made the gap "agree with what the drill will
   actually serve next". That is false: `drillState` serves `eligible(ranked, …)[0]`, and
   `eligible` keeps only the top half within three days of the interview and drops anything inside
   its cooldown, so `ranked[0]` and the next drilled competency routinely differ. The BEHAVIOUR is
   right — SPEC Amendment 1 says "a **top-ranked** competency no story covers", and a gap that went
   quiet during a cooldown would hide itself for exactly the days before the interview when there
   is still time to act. The claim was what was wrong. Both `storyGap`'s JSDoc and `rankedFor`'s in
   `stories.js` now say it is rank order, say explicitly that it does not apply `eligible`'s
   filtering, and re-argue the `shaky` decoration on its real grounds (it changes `readiness`, so
   it changes the rank itself — nothing to do with the queue). No code changed.

9. **The `competency_ids` length cap now has a test on both routes.** It was the one 400 branch in
   either route with no case behind it. The new test also pins the duplicate-id behaviour the cap
   interacts with: a repeated id inside the bound is legal and the store writes it once
   (`[...new Set(...)]`), so this is a length check rather than a count of distinct ids.

10. **The page's save-time story-cap re-check was kept, and is now tested.** `openEditor` refuses to
    open a form that cannot be submitted and `save` refuses to send — neither covers the other, and
    the window between them is reachable: the editor stays open across a re-fetch (a delete on
    another row triggers one), so a second tab filling the last slot lands the page there with a
    composed story and no room for it. Driven directly in the UI test rather than deleted.

11. **`test/schema.test.js:179` left alone.** It says "the portal's seven" in a #68 comment written
   when the portal had seven tables; #77 took it to nine without updating it and this ticket takes
   it to eleven. Correcting it is not this ticket's change and the repo declined it once already —
   flagged here rather than silently touched.

## Issues encountered

- **Node 20 is the machine default and would have hidden the entire store and route half.** Every
  `node:sqlite` test carries `{ skip }`; on v20.20.2 the suite reports green having executed none
  of them. All results above are from v24.11.0. Anyone re-running this must do the same.
- The wall regex `/\bstor(y|ies)\b/i` misses `storiesByRole` **and** `story_competency` (`_` and a
  following letter are word characters), as well as correctly missing `StoryBankCard`. Either
  clause alone is a hole, so both are kept and a unit test pins all three blind spots so neither
  can be "simplified" away.
- The delete two-step handler had to `return` its promise so the suite can await it — the document
  double records listeners without dispatching, so a handler that fires and forgets is untestable.

## Ready for the next step

`piv-commit`, then `piv-create-pr`. PR body should carry `Closes #78`, `Part of #76`, the
`prompt.js` → `drill.js` correction, and ⚠ **`0012` must be applied before the deploy** (it does
not take the drill down — see the DEPLOY.md triage row).
