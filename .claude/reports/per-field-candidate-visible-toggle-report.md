# Implementation Report — per-field candidate-visible toggle on the client-knowledge note

**Plan**: `.claude/plans/per-field-candidate-visible-toggle.md`
**Branch**: `feature/per-field-candidate-visible-toggle` (worktree at
`/Users/Berzins/Desktop/saulera-worktrees/per-field-candidate-visible-toggle`)
**Closes**: #18 · **Epic**: #16
**Status**: COMPLETE

## Summary

A recruiter can now tick, section by section, which parts of a client-knowledge note a candidate
may see. A section is one of the note's own markdown headings, so the recruiter authors the
structure and this ticket invents no fields. Permission is stored as presence — a row in the new
`note_visibility` table means shared, no row means hidden — which makes an empty table the
fail-closed default for every note already written. The gate is `visibleFields(note, keys)` in a
new pure module `src/note-fields.js`; consumers (#19, #22) call it instead of reading
`client.note`, and calling it with the second argument omitted returns `[]` rather than the note.

Nothing consumes the flag yet, by design. The submission pack still reads the whole note,
unchanged.

## Task 1 — the gate, and what it found

**The reading is confirmed.** "Per-field" means heading sections of the note, not fixed named
columns. Checked against four sources:

- `gh issue view 18` — names no list of note fields anywhere, says the toggle is set "in **the
  existing** note editor" and is "renderer-agnostic", and says the default applies to "every
  **existing** and new field". Structured columns have no existing fields; heading sections do.
- `docs/epics/candidate-portal.architecture.md:32,57` — decision 2 and "the prep brief and
  PanelBrief render only client-note fields flagged candidate-visible". No field list.
- `.claude/plans/client-knowledge-store.md:54` — the standing non-goal, "do not invent fields".
- `.claude/plans/candidate-brief-generation-seam.md:903-919` — **independent corroboration**:
  #19's plan records having verified this exact signature and having had its own earlier
  `{label, body}` guess corrected to `visibleFields(note, visibleKeys) → Array<{key, heading,
  level, text, chars}>`. The shape shipped here matches that record exactly, and
  `test/note-fields.test.js` pins it.

**The migration number and the schema-test array — and a blocker found first.** The working
directory `/Users/Berzins/Desktop/saulera-dossier-engine` was being actively edited by another
session while this ticket started: over ~90 seconds it gained modifications to `src/store.js`,
`test/schema.test.js` and `test/store.test.js`, plus `migrations/0002_portal.sql`,
`src/portal/`, `test/portal-store.test.js` and three fixtures — #17 and #19 in flight, with
`npm test` failing 1/240. Building #18 there would have entangled three tickets into one diff.

Per your decision, the work was done in an isolated git worktree branched from `main`, which is
the exact tree the plan was written against: `migrations/` holds only `0001_init.sql`,
`test/schema.test.js` is the 171-line three-table version, and `npm test` is green at 236/236.
Also per your decision, this ticket takes **`0002`**, and Task 5 edits main's three-name array.
Task 17 has posted the collision note on #17.

## Tasks completed

| # | Task | File | |
|---|---|---|---|
| 1 | GATE — reading, migration number, schema array | — | verified |
| 2 | the pure parser and the gate | `src/note-fields.js` | CREATE |
| 3 | the fail-closed properties first | `test/note-fields.test.js` | CREATE |
| 4 | the allow-list table | `migrations/0003_note_visibility.sql` | CREATE |
| 5 | the deliberate boundary amendment | `test/schema.test.js` | UPDATE |
| 6 | `listVisibleKeys` | `src/store.js` | UPDATE |
| 7 | `setFieldVisibility` + `VISIBILITY_KEYS_MAX` | `src/store.js` | UPDATE |
| 8 | prune on note save | `src/store.js` | UPDATE |
| 9 | `clientWithFields` | `src/store.js` | UPDATE |
| 10 | the SQL-shape section + fixture drift | `test/store.test.js` | UPDATE |
| 11 | `fields` on GET, `visibility` on PUT | `functions/api/clients/[id].js` | UPDATE |
| 12 | the fieldset | `public/clients.html` | UPDATE |
| 13 | render, toggle, auto-save, guards, copy | `public/clients.js` | UPDATE |
| 14 | the component, from CRAFT.md | `public/app.css` | UPDATE |
| 15 | the toggle-race case (+3 more) | `.claude/probes/clients-screen.mjs` | UPDATE |
| 16 | what a section is, and the rule | `README.md` | UPDATE |
| 17 | the seam, in writing, to #19/#22/#17 | GitHub + module header | posted |

880 insertions, 23 deletions across 9 files plus 3 new ones.

## Tests added

**`test/note-fields.test.js`** (new, 19 tests, all passing). The five leak-shaped properties
first: no headings → nothing shareable; the second argument omitted → `[]`; a renamed heading's
key never emitted; preamble text in no field at any level; two identical headings both
`key: null` and unshareable whatever is in `visibleKeys`; and the transfer sequence written out
as a test (tick `## Notes`, duplicate it, delete the first copy, assert the survivor is
unticked). Then the parser's rules: levels 1-6, seven hashes is not a heading, `#hashtag` is
not, closing hashes, the 80-char key cap with no trailing dash, case-only duplicates, CRLF, a
heading on the last line, and that the module never throws on any input.

**`test/store.test.js`** (+18 tests). `listVisibleKeys` selects one column with no JOIN and no
`note`; insert/delete shapes with the key **bound and absent from every SQL string**; an unknown
key throws `unknown_field` **and records no write**; one bad key rejects the whole request; a
duplicated heading is unflaggable through the store too; every non-boolean value rejected before
anything is read; over-cap → `too_long`; `__proto__` rejected with no write and no prototype
touched; unknown client → `not_found` with no write; `clientWithFields` returns no section
bodies; and five prune cases (exactly the stale key, clearing drops all, all-surviving deletes
nothing, duplication drops the key, name-only touches nothing).

**`test/schema.test.js`** (+1 test, 1 amended). Exactly the two edits Task 5 allows.

**`.claude/probes/clients-screen.mjs`** (+4 cases). `V18` drives the R7 race in a real browser —
select A, tick a section, select B, then let A's PUT resolve — and asserts B's rows are untouched
and nothing is ticked. **`V18s`** is the second half of R7 and the one that found a real bug (see
Deviations 8): it leaves A's toggle in flight, switches to a client whose note has a section with
the **same heading slug**, clicks it, and asserts the server was actually told. `V18d` asserts a
duplicated heading is listed, disabled, and says why. `V18t` measures the 44px floor and 360px
overflow on the new row.

`V18s` was verified to bite: reverting the guard to the slug alone makes it fail (14/15), and
restoring the fix makes it pass (15/15).

## Validation results

| Level | Result |
|---|---|
| **1 — greps** | All 9 clean: no raw hex in `app.css`, no `transition: all`, no browser storage in `clients.js`, no `ALTER TABLE` in migrations, no `batch(`, no `NOT IN` in `store.js`, `note-fields.js` provably pure (no `import`/`prepare(`/`db.`), nothing candidate-shaped outside comments in the migration. |
| **2 — unit** | `npm test` **275 pass / 0 fail** (baseline on `main` was 236). `note-fields` 19/19, `schema` 8/8, `store` 46/46, `tokens` green. |
| **3 — probes** | `clients-screen.mjs` **15/15** (11 pre-existing + 4 new). `one-screen.mjs` **17/17** — no regression on the pack screen. |
| **4 — manual, real D1** | All 8 steps below. |
| **5 — CHECKLIST.md** | Below. One MUST unverified, named. |

### Level 4, against `wrangler pages dev` + a real local D1

1. Real note pasted and saved → five rows (four `##` sections plus the h1), **all unticked**. ✓
2. Tick "Practical" in a real browser → live region reads "Saved"; reload → still ticked; the
   note's own save-state was **not** touched, so `state.dirty` did not leak (R10). ✓
3. Rename a ticked heading and save → the row is gone, the new row is unticked, and **retyping
   the old name later does not restore the tick**. ✓
4. Duplicate a ticked section → both rows read "Two sections have this name…", neither is
   tickable, a `visibility` write naming that slug is rejected `unknown_field`, and the stored
   row is pruned. Delete the first copy and save → **the survivor comes back unticked** (the
   case a positional-key design gets wrong). ✓
5. Clear the note entirely → the list is empty and `SELECT * FROM note_visibility` returns
   nothing for that client. ✓
6. **Cascade proven twice, not assumed from the DDL**: directly in SQLite (1 row → 0 after
   `DELETE FROM clients`) and through `DELETE /api/clients/:id` (1 → 0). ✓
7. The rejection sweep, all 400 with the right code and **no write**: unknown heading
   (`unknown_field`), `"false"` / `1` / `0` / `null` (`missing_fields`), `__proto__`
   (`unknown_field`), `visibility` as an array or `null` (`missing_fields`), an empty
   `visibility` object (`missing_fields`), an unknown client (404 `not_found`). An empty body
   still returns `missing_fields`, exactly as before this ticket. ✓
8. 360px → no horizontal page scroll (`scrollWidth` 360 = `innerWidth` 360), row height 44px,
   visible focus on every row from the global `:focus-visible` rule. ✓

Also verified live: typing a new heading writes "Save the note to update this list." into the
visibility live region (R11), and saving makes the new section appear **unticked**. Toggling
*while* the note is dirty keeps the stale message on screen, stores the toggle, and leaves the
note's own "Unsaved changes" untouched.

### Level 5 — CHECKLIST.md self-audit

- **Accessibility** — no new colour pairing (only `--text-muted`, already gated by
  `test/tokens.test.js`); native checkbox and native `<label>`, so the keyboard path is free and
  the global `:focus-visible` rule applies; no motion added, so `prefers-reduced-motion` is
  moot; **no information carried by colour or hover** — the reason a duplicated row cannot be
  ticked is in the row's own text; focus is preserved across the list rebuild the way
  `renderList` does. `role="status"` on a third live region, separate from the note's and the
  rail's (`clients.js:198-204` records why that separation matters).
- **Motion** — none added. No `transition: all` anywhere.
- **Layout** — `min-width: 0` on the row and the name span; `overflow-wrap: anywhere` on the
  heading, the same reasoning as `.editor-head h2`; 360px verified with no page scroll.
  **MUST NOT MET: real Safari was not checked** — only real Chrome over CDP. The exposure is
  narrow and named: `.visibility-list label:has(input:disabled)` uses `:has()` (Safari 15.4+,
  and it degrades to an un-muted row whose text still explains itself), and everything else is
  the `.radio-row label` flex pattern already shipping on this screen. Worth an eyeball before
  merge.
- **Data posture** — nothing written to browser storage (grep clean); the API carries
  `{key, heading, chars, candidate_visible}` and **never the section body**, so the note's
  personal data does not ride the wire twice; `note_visibility` holds a client id and a heading
  slug and is locked to three columns by the schema test; `listClients` is untouched and its
  "never selects note" assertion still passes; `listVisibleKeys` never joins to `clients`.
- **Copy** — every visible string is in the `COPY` object, written for a first-time recruiter,
  with no em/en dashes, no jargon, and each one saying what to do next. The database keeps the
  mechanism's name (`note_visibility`, `field_key`); the recruiter never meets either word.
- **Custom properties** — zero px and zero hex literals in the new rules.

## Deviations from the plan

1. **Built in a git worktree off `main`, not in the primary working directory.** Forced by the
   concurrent session described under Task 1. No code consequence — the branch is a normal
   branch in the same repository.
2. **Task 5 added one assertion, not two.** The plan's two edits shipped exactly as specified.
   A third assertion (a `ON DELETE CASCADE` regex on `note_visibility`'s DDL) was written and
   then **reverted**: `main`'s `schema.test.js` has no `bodyOf` map, so it would have meant
   adding parser machinery to a file Task 5 scopes to two edits and R8 warns about touching
   loosely. The cascade is proven at Level 4 step 6 against a real database instead, which is
   what R13 asked for and is stronger than a regex on DDL.
3. **`setFieldVisibility({})` throws `missing_fields` rather than being a no-op.** The plan is
   silent; `updateClient` sets the house precedent ("nothing to change is an error, not a silent
   no-op") and this is the identical situation.
4. **`PUT` ordering restructured to preserve an existing 400.** The plan's "run `updateClient`
   first, then `setFieldVisibility`" is implemented, but guarded: a body with no `visibility`
   key still calls `updateClient` unconditionally, so `PUT {}` returns `missing_fields` exactly
   as it did before this ticket. Written the plan's literal way, an empty body would have
   silently become a 200.
5. **`.visibility-list label` uses `align-items: center`, not the specified `baseline`.**
   Measured, not reasoned: with a 44px row and a heading that wraps at 360px, baseline dropped
   the checkbox to the bottom of a two-line row. `center` is also what `.radio-row label` — the
   pattern the plan says to mirror — already uses. Screenshots before and after.
6. **Four probe cases, not one**, plus `fields` added to the probe's base fixtures so the stub
   matches the real API shape.
7. **The re-entrancy guard is keyed on client id + heading slug, not on the slug alone.** The
   plan says "guard re-entrancy per key"; taken literally that is a bug, found in review and
   fixed. A heading slug is not unique across clients — `## Their process` is this screen's own
   worked example, in both the scaffold line and the empty-state copy. With a slug-only guard: A's
   toggle is slow and still in flight, the recruiter switches to B and clicks B's same-named
   section, the native checkbox flips before `change` fires, the guard returns early so **no
   request is sent and nothing is put back**, and A's answer then bails on `savingId` without
   re-rendering B. B is left showing a permission that was never stored, until a reload. It does
   not self-heal the way a same-client double-click does. Probe `V18s` now drives exactly that
   sequence and fails without the fix.
8. **A successful toggle no longer overwrites the stale-list message.** Both write to the same
   live region, so toggling while the note was dirty replaced "Save the note to update this
   list" with "Saved" — clobbering R11's own mechanism with the less important of the two true
   statements. The success branch now keeps the stale message while `state.dirty`.
9. **Three of my own comments were reworded** so they stop tripping the plan's own Level 1
   greps (`NOT IN`, `batch(`, `ALTER TABLE` appeared in comments explaining why those shapes
   were rejected). The repo's stated view — `clients.js:11` — is that a gate which cries wolf
   gets deleted, so the gates were kept clean and the reasoning kept, reworded.

## Issues encountered

- **The primary working directory is being edited by another session.** Documented above. Its
  copy of `test/store.test.js` currently fails on "no SQL on the whole event path mentions a
  name, a candidate, a cv or a note", because #17's `eventCounts` rewrite puts `pack_generated`
  into the statement text. That is #17's to resolve; this branch is green. Flagged on #17.
- **Port 8788 is held by that session's dev server.** This ticket's server ran on 8790 and the
  probes on 8791/8792 via a temporary copy in the scratchpad. **The committed probe file's
  `PORT` constant is unchanged at 8788** — only the run was redirected, so the diff carries no
  unrelated edit. Re-running `node .claude/probes/clients-screen.mjs` normally needs 8788 free.
- **`npx wrangler d1 execute --local` crashes on this machine** with `table _cf_ALARM has 3
  columns but 2 values were supplied` — a wrangler/workerd version fault, unrelated to this
  change. The migration itself applies cleanly (`0003_note_visibility.sql ✅`), and the table was
  inspected with `sqlite3` against the D1 file directly instead.
- **The plan's Level 1 `grep -n 'innerHTML' public/clients.js` expects nothing but already
  matched on `main`** — there is one pre-existing comment saying "textContent, never innerHTML".
  The gate's intent (no `innerHTML` *assignment*) holds; my new code adds a second comment in
  the same house idiom.

## Risk register — where each mechanism landed in the diff

| R | Closed by |
|---|---|
| R1 | Task 1 above, with a fourth source of corroboration the plan did not have (#19's own resolved question). |
| R2 | **Handed off, not closed** — the honest statement. `src/note-fields.js:5-13` states the rule to the next implementer; #19 and #22 carry a comment with the signature, the fail-closed default and the rule in words (deliberately no grep); README records it. |
| R3 | Worktree off `main`; `0002` taken; Task 5 added one name; #17 commented with the number and the assertions. |
| R4 | No positional keys anywhere. `parseNoteFields` nulls non-unique slugs; two unit tests, one store test, one probe case, and Level 4 step 4 all drive the transfer sequence. |
| R5 | Three layers, all present: `unknown_field` on write, the prune on note save, and the read-side intersect in `visibleFields`. Level 4 step 3 proves the composite. |
| R6 | The prune diffs in JavaScript and deletes one bound key at a time. `src/store.js` has **zero dynamic SQL on that path**, and the Level 1 grep for the rejected shape is clean. |
| R7 | `savingId` captured before the request and checked in every continuation, a re-entrancy guard keyed on **client id + slug**, re-render from server truth. Probes `V18` and `V18s` measure both interleavings — a stale answer landing under a new client, and a new client's toggle being swallowed by a stale one. The slug-only guard the plan's wording implies was found to be a real leak-shaped bug and is fixed (Deviation 7). |
| R8 | `schema.test.js` is **stricter** after this ticket than before: nothing removed, one name added, one column lock added. Proven to still bite by temporarily adding `note_excerpt TEXT` (exactly one test failed) and reverting. |
| R9 | The pre-existing `updateClient` fixtures were re-queued in the same pass, with a comment saying why. No store code was "simplified" to suit a fixture. |
| R10 | A toggle never sets or clears `state.dirty`. Verified live in step 2. |
| R11 | `visibilityStale` written into the visibility live region the moment the note goes dirty. Verified live. |
| R12 | `listVisibleKeys` selects one column and never joins; `fields` carries no section text; `listClients` untouched. |
| R13 | Cascade proven against a real D1, twice. |
| R14 | CRAFT.md read before the CSS; the row inherits `.radio-row label`'s solved 44px floor; Level 1 greps clean; CHECKLIST audited above with the one gap named. |
| R15 | Every visible string in `COPY`, first-time-recruiter language, mechanism names kept in the database only. |

## Acceptance criteria

All ten met. AC #7 with the one caveat named under Level 5 (real Safari not eyeballed).

## For the PR body

- State the `test/schema.test.js` reasoning the file's own comment (lines 105-111) demands: the
  fourth table is #18's candidate-visibility allow-list, holding a client id and a heading slug
  from the agency's own note; no candidate data, no note text, so §5.6's boundary has not moved.
  Presence is permission, so an empty table is the fail-closed default for every existing note.
- Flag the #17 rebase on both the migration number and the expected-table array: **add a name,
  never replace the array**.
- Note that the prune path has zero dynamic SQL, which is a stronger property than
  `updateClient`'s allow-list construction.
- Closes #18.
