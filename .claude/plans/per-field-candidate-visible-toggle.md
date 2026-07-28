# Feature: per-field candidate-visible toggle on the client-knowledge note

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

## Feature Description

The client-knowledge note is the product's compounding asset and it is also the most dangerous
text in the deployment. It names hiring managers, records why real named candidates were turned
down, and carries the agency's private read on a client. The candidate portal (epic #16) is about
to consume the same note. Nothing in it may reach a candidate by default.

This ticket adds the control that makes that safe: the recruiter marks **sections of the note**
as shareable, one by one, in the editor they already use. A section is shareable only if it was
ticked. Everything else — including every word written before this ticket shipped, and every
section written after it — is hidden. The gate is a helper, `visibleFields()`, that consumers
(#19's brief generation, #22's Send) call instead of reading `client.note`. A consumer that
forgets to call it gets nothing, not everything.

It is the same enforcement move as `src/provenance.js`: the rule stops being a prompt instruction
and becomes a function you have to route through.

## User Story

As a recruiter who keeps private notes about how a client hires
I want to tick which parts of a note a candidate is allowed to see
So that the prep portal can use my client knowledge without ever leaking the parts I would never
say to a candidate's face

## Problem Statement

The note is one free-text blob and every consumer reads it whole. `src/prompt.js:50`'s
`noteBlock()` sends the entire note into the model call. That is correct for the submission pack —
the client reads it, and the client is who the note is about. It is catastrophic for the candidate
portal, where the same blob contains "Nov 2025: good community experience but was vague about
documentation. Governance blocked it."

There is currently no unit smaller than "the note" that anything can be said about, so there is
nothing for a candidate-facing consumer to ask for except all of it or none of it.

## Solution Statement

1. **Fields are the note's own markdown headings.** A line starting with `#`…`######` opens a
   section; the section runs to the next heading or the end. `spike/inputs/client-note.md` — the
   only real-shaped note in the repo — is already written this way (`## Their process`,
   `## Why candidates have been turned down`), as is the fixture in `test/store.test.js:47`. The
   recruiter authors the structure; we invent no fields (see Assumption 1).
2. **A new pure module, `src/note-fields.js`**, parses a note into fields and exports
   `visibleFields(note, visibleKeys)`, which returns only the flagged ones. No D1, no HTTP, no
   imports beyond nothing — testable in `node --test` like `src/provenance.js`.
3. **A new table, `note_visibility(client_id, field_key, created_at)`, is an allow-list.** A row
   present means shared. No row means hidden. There is no `visible` boolean to get the wrong way
   round, and a fresh deployment starts with an empty table, which is the fail-closed default for
   every existing note for free.
4. **Three guards make the allow-list honest.** A visibility write for a key that is not currently
   a heading in that note is rejected (`unknown_field`). A note save prunes rows whose heading no
   longer exists — so renaming a section and later re-typing the old name cannot silently resurrect
   a flag nobody re-ticked. And a heading text that appears twice in one note is **not flaggable at
   all**, because any scheme that gives two same-named sections distinct keys lets a permission
   transfer from the ticked one to the unticked one when the first is deleted.
5. **The editor grows one fieldset**, listing the saved note's sections with a checkbox each,
   auto-saving per toggle in the idiom of the agency strip (`public/clients.js:362`).

## Out of Scope / Non-Goals

- **Not included: consuming the flag.** Nothing renders, generates or sends the visible slice.
  #19 (candidate-brief generation) and #22 (Send to Candidate) are the consumers; this ticket only
  has to make `visibleFields()` exist, be correct, and be the only way through. The submission
  pack keeps reading `client.note` whole, unchanged.
- **Not included: structured note fields.** `.claude/plans/client-knowledge-store.md:54` says "the
  note is one free-text blob… do not invent fields", and that stands. We do not split the note
  into columns, add named fields, or change `clients.note`. Headings are the recruiter's
  structure, not ours.
- **Not changing: the pack pipeline.** `src/prompt.js`, `src/generate.js`, `src/provenance.js`,
  `src/pack.js`, `public/app.js` and `functions/api/{generate,prompt}.js` are untouched. If a task
  makes you want to edit one of them, the design has drifted — stop.
- **Not included: the portal's tables.** `invite`, `candidate_role`, `competency` etc. are #17.
  This ticket adds exactly one table.
- **Not included: fenced-code awareness in the parser.** A `# heading` inside a ``` fence becomes
  a field. It is fail-closed (unticked, so it leaks nothing) and real notes are prose. Documented,
  not solved.
- **Not included: a "preview what the candidate sees" surface.** That belongs with the send
  preview in #22, where there is something to preview.

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: Medium
**Primary Systems Affected**: `src/store.js`, `functions/api/clients/[id].js`, `public/clients.{html,js}`, `public/app.css`, `migrations/`, `test/schema.test.js`
**Dependencies**: none — no new npm packages, no new tooling. `node --test`, vanilla JS, D1.

## Related Work

**Implements**: [#18](https://github.com/linardsb/saulera-dossier-engine/issues/18) — the PR closes it.
**Epic**: [#16](https://github.com/linardsb/saulera-dossier-engine/issues/16) · architecture
[docs/epics/candidate-portal.architecture.md](../../docs/epics/candidate-portal.architecture.md)
decision 2 and §3, inherited not re-decided.

**Back-references**:

- `.claude/plans/client-knowledge-store.md` — Why: #5 built the store, the schema, the editor and
  the two guard tests this ticket has to extend. Its non-goal at line 54 ("do not invent fields")
  is the reason fields are headings and not columns. Its **PATTERNS** and **DESIGN SPEC** sections
  are the house idiom for everything below.
- `.claude/plans/ux-ui-uplift.md` — Why: the current token layer, component grammar and the
  validation-command shape the editor screen is held to.

**Forward-references**:

- #19 — candidate-brief generation. Calls `visibleFields()`; never `client.note`.
- #22 — Send to Candidate. Same.
- #17 — portal schema. **Collides with this ticket in `test/schema.test.js` and on the migration
  number** — see RISK REGISTER R3, closed by Tasks 1, 5 and 17.

---

## RISK REGISTER

Every risk this plan started with, and the mechanism that closes it. A risk with only a note against
it is not closed, so each row names a task.

| # | Risk | Mechanism | Task |
|---|---|---|---|
| R1 | **Assumption 1 is wrong** — "per-field" meant fixed named fields, not heading sections. The plan is then the wrong shape, the ticket is much larger, and the mistake is discovered after a migration has been applied to a real D1. | **Front-loaded gate.** Task 1 writes no code: it re-reads the ticket against the four pieces of evidence, and stops rather than proceeding on a contradiction. The gate sits *before* the migration and *after* nothing, because the pure parser is free to rewrite and an applied migration is not. The seam is also cheap to move: only `src/note-fields.js` and the editor would change — the store, the API and the table survive either reading. | **1** |
| R2 | **A consumer bypasses the gate.** #19 or #22 reads `client.note` directly and the whole ticket becomes decorative. No test here can fail on code that does not exist. | Three written mechanisms, since no executable one exists yet: the module header addresses the next implementer directly; #19 and #22 get a comment carrying the signature, the fail-closed default and the rule stated in words (deliberately not a grep — the obvious one fires on the compliant call); README records the rule. Named as this ticket's largest residual and handed to the tickets that *can* close it. | **17**, 16 |
| R3 | **#17 lands first and the merge resolves by taking one side** — either the portal tables or `note_visibility` vanish from `test/schema.test.js`'s expected array, and the guard silently stops guarding one of them. Same hazard on the migration filename. | Task 1 checks `ls migrations/` and the live array *before* writing either, and renumbers rather than colliding. Task 5's instruction is "add one name to what is there", never "replace with these four". Task 17 comments the number and the line on #17. The PR body states it. | **1, 5, 17** |
| R4 | **A permission transfers between two same-named sections.** Tick `## Notes` (`notes`), add a second `## Notes` (`notes-2`), delete the first — the survivor parses as `notes` and inherits a tick nobody gave it. Neither the prune nor the read-side filter catches it: both key on the string. | **No positional keys anywhere.** A heading whose slug is not unique gets `key: null` and is unflaggable; the ambiguous key never exists to transfer. Two tests (the pair at Task 3), an edge case, a UI row that says why it cannot be ticked, and a manual step that performs the exact sequence. | **2, 3, 13, 14** + Level 4 |
| R5 | **Key resurrection.** A heading is renamed while its permission is stored; months later the old name is typed again and the section is already shared, with nobody having ticked it. | Three independent layers, deliberately: the write side rejects a key that is not a current heading (`unknown_field`); a note save prunes stored keys the note no longer contains; and `visibleFields` intersects at read time, so even an orphan row emits nothing. Any one of the three is sufficient; all three are cheap. | **2, 7, 8** |
| R6 | **The prune breaks the save path.** `DELETE … WHERE field_key NOT IN (?, ?, …)` binds one parameter per parsed heading against D1's per-query parameter cap, so a heavily-headed note makes saving the note fail — on the recruiter's own text, on the product's compounding asset. | The `NOT IN` shape is rejected in the plan, with the reason written into the task as a GOTCHA so it is not reinvented. The prune diffs in JavaScript against `listVisibleKeys` and deletes one bound key at a time: bounded by stored permissions (few, recruiter-created), not by heading count. Side effect worth having — **zero dynamic SQL on that path**. Level 1 greps for the banned shape. | **8** + Level 1 |
| R7 | **A toggle response lands under the wrong client** and writes a permission to a different client's note. This screen has shipped this bug class before — it is decision #4 of `public/clients.js`'s header comment. | `savingId` captured before the request and checked in every continuation, per-key re-entrancy guard, and re-render from server truth rather than from the checkbox. Measured rather than reasoned about: a new case in the Chrome/CDP probe drives the exact interleaving. | **13, 15** |
| R8 | **The guard test is weakened rather than strengthened** — an implementer meets `test/schema.test.js`, takes the quick path, and deletes an assertion or reaches for `ALTER TABLE`. | Task 5 specifies exactly two edits and names the four assertions that must not be touched. It *adds* a positive assertion pinning `note_visibility` to three columns, so the file is stricter afterwards than before. Its VALIDATE step requires proving the guard still bites by temporarily adding a column. Level 1 greps for `ALTER TABLE` on every pass. | **5** + Level 1 |
| R9 | **Fixture drift reads as a store bug.** Adding the prune makes `updateClient` issue extra statements, so *pre-existing* `fakeD1` fixtures run out of queued results and existing tests fail. The tempting fix is to "simplify" the store. | Called out in Task 8's GOTCHA in those words, and Task 10 updates the pre-existing fixtures in the same pass. `fakeD1`'s `bind()` placeholder check is the second signal — it fails loudly rather than passing wrongly. | **8, 10** |
| R10 | **The toggle joins the note's dirty state**, so either a toggle is silently lost on navigate-away or `beforeunload` warns about a change that was saved the moment it was made. | The toggle mirrors `saveAgency` (auto-save, own live region, revert from server truth), never `save`. Stated as a rule in Task 13 and as a GOTCHA in both directions: a toggle must not set `state.dirty`, and must not clear it. | **13** |
| R11 | **The list describes the saved note**, so a heading typed but not yet saved has no row — which reads as a bug, or worse, as "this section is already handled". | Specified behaviour with its own copy string (`visibilityStale`, "Save the note to update this list."), written into the live region the moment the note goes dirty. Fail-closed underneath regardless: an unsaved heading has no key, so nothing can be flagged against it. | **12, 13** |
| R12 | **Personal data spreads while adding a permissions surface** — the note reaching a navigation payload, or section bodies riding on the wire twice. | `listVisibleKeys` selects one column and never joins to `clients`. The `fields` array carries heading, key, character count and the flag — **never the section text**, since the recruiter is reading it in the textarea two inches above. `listClients` is untouched and its existing "never selects note" assertion still runs. | **6, 9, 10** |
| R13 | **The cascade does not fire** and permission rows outlive their client. | The FK mirrors `events.client_id` exactly, including `ON DELETE CASCADE`, so it either works for both or is already broken for the metric. Proven against a real local D1 in Level 4 step 6 rather than assumed from the DDL. | **4** + Level 4 |
| R14 | **The design skill is skipped** and the fieldset arrives as generic checkboxes with a raw hex and a hover-only affordance. | CRAFT.md is a precondition inside the CSS task, not a reference at the top of the plan; the component is specified down to which existing rules it inherits (`.radio-row label` already solves the 44px tap target). CHECKLIST.md is a completion-checklist item. Level 1 greps for raw hex and `transition: all`. | **14** + Level 1, Level 5 |
| R15 | **The copy is written for the author, not the reader.** "Field visibility" and "candidate_visible" are the tool's words, not a first-time recruiter's. | Every visible string is fixed in Task 13's copy deck, in a `COPY` object at the top of the file per house rule, and each one says what to do next. The DB keeps the mechanism's name; the human never sees it. | **13** |

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `src/store.js` (whole file, 335 lines) — Why: every convention this ticket extends. `StoreError`
  (line 31), the bound-parameter rule in the header comment, the fixed column allow-list in
  `updateClient` (lines 179-201), 404-before-write (line 195), and `requireClient` (line 281) which
  exists precisely so a non-note path never drags the note across the wire.
- `migrations/0001_init.sql` (whole file, 43 lines) — Why: the comment register for a migration,
  and the `ON DELETE CASCADE` pattern on `events.client_id` that `note_visibility` copies.
- `test/schema.test.js` (whole file, 172 lines) — Why: **the tightest constraint in this ticket.**
  It asserts exactly three tables (line 116), bans `ALTER TABLE` outright (line 101), and fails any
  table or column matching `/candidate|^cv$|resume|\bpack\b|brief/i` (line 125). Read lines 101-141
  before writing the migration. Its own comment at 105-111 says a genuine schema change is "a
  decision to make in the open" — this is that decision.
- `test/store.test.js` (lines 1-60 for the header and fixtures; then the sections for
  `updateClient` and `recordEvent`) — Why: the SQL-shape assertion idiom. Three properties are
  asserted against recorded SQL rather than results: no user value in the SQL string, the list
  query never selects the note, the events insert touches nothing extra. Yours is a fourth of the
  same kind.
- `test/helpers/fake-d1.js` (whole file, 62 lines) — Why: what the fake can and cannot do. It has
  **no `batch()`** — do not write store code that calls it. `bind()` throws if the argument count
  and the `?` count disagree, which is a real gate on any statement you build dynamically.
- `functions/api/clients/[id].js` (whole file, 59 lines) — Why: the endpoint you extend. Note the
  order — binding, then `sameOrigin`, then body, then the explicit two-key allow-list at lines
  39-40, and the comment above it explaining why extra keys are ignored rather than rejected.
- `src/http.js` (whole file, 59 lines) — Why: `readJson` already rejects `null`/array/scalar bodies
  as `bad_json`; `errorResponse` maps `StoreError.code`/`.status` and turns anything else into a
  500. You add no error handling in the Function beyond `try`/`catch`.
- `public/clients.js` (whole file, 501 lines) — Why: **read the 27-line header comment first.** All
  four numbered decisions bear on this ticket, and #4 (every response checked against the request
  that asked for it) is the exact bug class a per-row toggle reintroduces. Then read `saveAgency`
  (362-382), which is the pattern to mirror: auto-save, own live region, re-read server truth on
  failure. Do **not** mirror `save` (299-343) — the toggle must not join `state.dirty`.
- `public/clients.html` (lines 66-95) — Why: the editor section you add the fieldset to, and
  `lines 104-133` for the fieldset/legend/hint grammar (`.radio-group`, `.field`, `.field-hint`,
  `role="status"`) you reuse.
- `public/app.css` (lines 207-246 fields, 418-480 the agency strip, esp. `.radio-group` 462 and
  `.radio-row label` 473 with its min-height comment) — Why: the checkbox row you add is the
  `.radio-row label` pattern; the 44px tap-target floor is already solved there.
- `spike/inputs/client-note.md` (whole file, ~40 lines) — Why: **what a real note actually looks
  like.** Four `##` sections, an h1, and a `**Client:** …` preamble before the first heading. Every
  parser decision below was made against this file; use it as a test fixture.
- `docs/epics/candidate-portal.architecture.md` (§2 decision 2, §3 "The two enforcement
  mechanisms") — Why: the inherited decision. "Enforced in code (same move as provenance)" is the
  design brief for `visibleFields()`.
- `.claude/skills/dossier-design/references/CRAFT.md` — Why: mandatory before writing CSS.
- `.claude/skills/dossier-design/references/CHECKLIST.md` — Why: mandatory before committing UI.

### New Files to Create

- `src/note-fields.js` — parse a note into heading-delimited fields; `visibleFields()`.
- `migrations/0002_note_visibility.sql` — the allow-list table.
- `test/note-fields.test.js` — the parser and the fail-closed properties.

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [SQLite `INSERT OR IGNORE`](https://www.sqlite.org/lang_insert.html) — section: the `OR IGNORE`
  conflict clause. Why: the "tick" write is an insert that must be a no-op on an existing row,
  without an `ON CONFLICT … DO UPDATE` clause you would then have to reason about.
- [SQLite foreign keys](https://www.sqlite.org/foreignkeys.html#fk_actions) — section: `ON DELETE
  CASCADE`. Why: deleting a client must take its visibility rows with it, by the schema and not by
  a second statement in `deleteClient` — the same choice `events` already made.
- [D1 Workers Binding API](https://developers.cloudflare.com/d1/worker-api/prepared-statements/) —
  section: prepared statements and `.run()`/`.all()` return shapes. Why: `all()` returns
  `{ results }` and the store's existing `results ?? []` idiom depends on it. Foreign-key
  enforcement is on by default in D1, which is what makes the cascade real.
- [MDN: `<input type="checkbox">`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input/checkbox)
  — section: `indeterminate` and labelling. Why: native checkbox, native label, no custom switch —
  the repo styles no form control it does not have to (`public/app.css:462`).
- [WAI-ARIA: `role="status"`](https://www.w3.org/TR/wai-aria-1.2/#status) — Why: the toggle's
  save-state line is a third live region on this screen, and `clients.js:198-204` records the bug
  that comes from writing into the wrong one.

### Patterns to Follow

**Comment register.** Prose sentences explaining *why the code is shaped this way*, citing a
ticket or an architecture section. Every file in `src/` opens with one. See `src/store.js:1-13`.
This ticket's headline comment is the fail-closed argument: a bug of omission must hide a fact,
never leak one.

**Validation, from `src/store.js`:**

```js
export function cleanNote(raw) {
  if (raw === null || raw === undefined) return "";
  const note = String(raw);
  if (note.length > NOTE_MAX) {
    throw new StoreError("too_long", 400, `note: longer than ${NOTE_MAX} characters`);
  }
  return note;
}
```

Throw a `StoreError` with the field named, a snake_case `code`, and the HTTP status already
decided. The Function layer maps, it does not guess.

**Never interpolate a user value into SQL** (`src/store.js:13`). The one dynamic-SQL construction
in the file is `updateClient`'s, and it builds the string from a **fixed allow-list of column
names** while every value is bound. Your prune statement builds a `?` list from a count — the
count is derived from parsed headings, never from a request body, and every key is bound.

**Narrower query on a non-note path** (`src/store.js:281`, `requireClient`): the visibility read
selects `field_key` and nothing else. It must never join to `clients.note`.

**Function shape** (`functions/api/clients/[id].js:28-46`): binding → `sameOrigin` → `readJson` →
explicit key allow-list → delegate → `json()`. `try`/`catch` ending in `errorResponse(err)`.

**Browser idiom** (`public/clients.js`): ES5-flavoured vanilla, `var`, `function`, no build step,
`textContent` never `innerHTML`, nothing written to browser storage of any kind, and every async
response checked against the request that asked for it before it writes anything.

**Copy** (`public/clients.js:32-70`): every visible string in a `COPY` object at the top of the
file, written for a first-time recruiter — no jargon, and an error says what to do next and what
is still safe.

---

## IMPLEMENTATION PLAN

### Phase 0: The gate

**Blocks:** Phase 2 onward. Phase 1 may proceed alongside it — a pure module is free to rewrite.

Two things are cheap to correct before the migration and expensive after it: whether "field" means
what this plan says (R1), and whether #17 already took the `0002` number and the schema-test array
(R3). Task 1 checks both and writes nothing.

**Tasks:**

- Task 1: re-read the ticket against Assumption 1; `ls migrations/`; read the live expected-table
  array; read the real note fixtures.

### Phase 1: The pure core

The parser and the helper, with nothing above them. It is the only part of this ticket with
interesting logic, it needs no database and no browser, and every safety property of the feature
is a property of this module.

**Tasks:**

- `src/note-fields.js`: parse, key, and filter.
- `test/note-fields.test.js`: the fail-closed cases first.

### Phase 2: Persistence

**Depends on:** Phase 1 (the store validates keys against parsed fields).

**Tasks:**

- The migration and the deliberate `test/schema.test.js` amendment.
- Store functions: read the allow-list, write one entry, prune on note save.
- `test/store.test.js` additions.

### Phase 3: The API

**Depends on:** Phase 2.

**Tasks:**

- `GET /api/clients/:id` gains a `fields` array alongside `client`.
- `PUT /api/clients/:id` gains a `visibility` patch key.

### Phase 4: The editor

**Depends on:** Phase 3 (it renders what the API returns).

**Tasks:**

- `public/clients.html`: the fieldset.
- `public/clients.js`: render, toggle, auto-save, guards, copy.
- `public/app.css`: the component, from CRAFT.md.

### Phase 5: Validation and hand-off

**Depends on:** Phase 4 for the probe; **independent of it** for the hand-off (Task 17 needs only
the module signature, which exists at the end of Phase 1 — it can be written any time after that,
and it is the mechanism for the one risk this ticket cannot close in code).

**Tasks:**

- The probe case, README, and the seam comments on #17/#19/#22.
- Level 1 greps, `npm test`, both probes, the manual sweep against `wrangler pages dev`.
- CHECKLIST.md self-audit.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

### Task 1 — GATE: confirm the reading and the migration number

**This task writes no product code, and Tasks 4 onward do not start until it passes.** It exists
because two things in this plan are cheap to correct now and expensive to correct after the
migration lands. See *RISK REGISTER* R1 and R3.

- **IMPLEMENT**, in order:
  1. **Re-read the ticket and Assumption 1.** `gh issue view 18`. Confirm that "per-field" means
     heading sections of the note, against the four pieces of evidence in OPEN QUESTIONS. If
     anything in the issue, its comments, or `docs/epics/` contradicts it — in particular a named
     list of note fields anywhere — **stop and raise it**; the plan is the wrong shape and the
     ticket is substantially larger.
  2. **Check the migration number against reality**: `ls migrations/`. If #17 has already landed a
     `0002_*.sql`, this ticket's file becomes the next free number. Renumber the filename in Task 4
     and in the VALIDATION COMMANDS; do not merge two migrations into one file.
  3. **Check `test/schema.test.js`'s expected-table array against reality**: if #17 landed first, the
     array already has portal tables in it — Task 5 **adds one name to what is there**, and never
     replaces the array with the four names written in this plan.
- **PATTERN**: `.claude/plans/client-knowledge-store.md`'s Task 15 — a front-loaded gate that
  proves the assumptions the rest of the plan rests on before the rest of the plan exists.
- **GOTCHA**: Phases 1 and 2 are *not* equally reversible. `src/note-fields.js` is a pure module
  that can be rewritten for nothing; a migration applied to a production D1 cannot be un-applied.
  That asymmetry is why the gate sits here and not after the parser.
- **VALIDATE**: `gh issue view 18 && ls migrations/ && grep -n 'agency", "clients", "events' test/schema.test.js`
  — and a written line in the completion report saying the reading was confirmed and against what.
- **SATISFIES**: every AC, by making sure they are the right ACs.

### Task 2 — CREATE `src/note-fields.js`

- **READ FIRST**: `spike/inputs/client-note.md` and the note fixture at `test/store.test.js:47`.
  Write the parser against real text, not against the bullets below.
- **IMPLEMENT**: a dependency-free module with exactly three exports.

  ```js
  export function fieldKey(heading)          // -> slug, or "" if the heading slugs to nothing
  export function parseNoteFields(note)      // -> [{ key, heading, level, text, chars }]
                                             //    key is null for a heading that is not unique
  export function visibleFields(note, visibleKeys)  // -> the subset that was ticked
  ```

  Rules, all of them decisions rather than details — put each one in a comment with its reason:

  - A **field opens** at a line matching `/^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/` (ATX heading,
    optional closing hashes) and runs to the line before the next such line, or the end of the
    note. `heading` is capture 2 trimmed; `level` is capture 1's length; `text` is the body
    **excluding** the heading line; `chars` is `text.trim().length`.
  - **Anything before the first heading is not a field.** `spike/inputs/client-note.md` opens with
    an h1 and a `**Client:** …` line; a preamble has no name to tick, so it can never be ticked,
    so it can never be shared. That is the fail-closed answer, not an omission.
  - **`key` is a slug of the heading**: lowercase, `[^a-z0-9]+` → `-`, leading/trailing `-`
    stripped, truncated to 80 characters. An empty slug (a heading of only punctuation) falls back
    to `section`.
  - **A heading text that occurs more than once in a note yields `key: null` and is not
    flaggable.** This is the fail-closed answer to duplicates, and it is *not* the obvious one — a
    positional `-2`/`-3` suffix leaks. Two `## Notes` sections, the first ticked (`notes`) and the
    second not (`notes-2`); delete the first and save; the survivor now parses as `notes`, whose
    permission survives the prune because that key still exists — and a section nobody ever ticked
    is shared. Neither the prune nor the read-side intersect catches it, because both key on the
    string. So: no positional keys anywhere. `parseNoteFields` still *returns* the duplicates (the
    UI has to explain them), with `key: null`; `visibleFields` skips any field whose key is null.
    Implement as two passes: slug every heading, count the slugs, then null any slug seen more than
    once. Note that this collides on the **slug**, so `## Their process` and `## Their Process`
    are duplicates of each other — which is the right answer, since they are indistinguishable to
    the recruiter reading the list.
  - **`visibleFields(note, visibleKeys)` starts from the parsed fields and keeps only those whose
    key is in `visibleKeys`.** `visibleKeys` defaults to an empty array, so a caller that forgets
    the second argument gets `[]`. Accept an array or a `Set`; normalise to a `Set` internally.
    Never the other direction — never iterate the keys and look up fields — because a key with no
    matching heading must vanish, not appear.
- **PATTERN**: `src/provenance.js` — a pure module whose whole job is one deterministic check, with
  a header comment saying what it is enforcing and why prose could not.
- **IMPORTS**: none. This module imports nothing and is imported by `src/store.js` and later by
  #19/#22.
- **GOTCHA**: do not import `StoreError` here. This module never throws on content — a note is
  whatever the agency typed, and a parser that throws turns a weird heading into a 500 on the save
  path. It returns `[]` for an empty or headingless note.
- **GOTCHA**: `\r\n`. Split on `/\r?\n/`, or a Windows-pasted note yields headings with a trailing
  `\r` and slugs like `their-process-` that never match a stored key.
- **VALIDATE**:
  ```bash
  node --input-type=module -e "
    import { readFileSync } from 'node:fs';
    const { parseNoteFields } = await import('./src/note-fields.js');
    console.log(parseNoteFields(readFileSync('spike/inputs/client-note.md','utf8')).map(f => f.key));
  "
  ```
  → expect `their-process`, `what-they-actually-care-about`,
  `why-candidates-have-been-turned-down`, `practical` (the `# SYNTHETIC — agency's
  client-knowledge note` h1 is the first heading, so it is a field too). `package.json` is
  `"type": "module"` — `require()` inside `node -e` throws. Confirm the real output and keep the
  assertion honest rather than adjusting the parser to match this bullet.
- **SATISFIES**: AC #3, AC #4.

### Task 3 — CREATE `test/note-fields.test.js`

- **IMPLEMENT**: the parser's behaviour and, first, the four properties that would let something
  through:

  1. a note with no headings → `parseNoteFields` returns `[]` and `visibleFields` returns `[]`;
  2. `visibleFields(note)` with the second argument omitted → `[]`;
  3. a key in `visibleKeys` with no matching heading (the renamed-heading case) → not emitted, and
     the still-present sections are unaffected;
  4. text before the first heading is in no field's `text` at any level of nesting.

  Then the **duplicate-heading pair**, which is the fifth leak-shaped property and the subtlest:

  5. two identical headings → both fields carry `key: null`, and `visibleFields` never emits
     either, whatever is in `visibleKeys`;
  6. the transfer case, written as a sequence: a note with one `## Notes` whose key is ticked, then
     a second `## Notes` added — the first section's key must **not** stay flagged, and after the
     duplicate is later removed the survivor must come back unticked. Assert on keys only; the
     store test covers the persistence half.

  Then: level captured for `#`…`######`; `####### seven hashes` is not a heading; a `#hashtag`
  with no space is not a heading; punctuation-only heading falls back to `section`; two
  punctuation-only headings collide on `section` and are therefore both null-keyed; `\r\n` input
  yields the same keys as `\n`; a heading at the very last line yields a field with empty `text`.
- **PATTERN**: `test/provenance.test.js` — its stated bias is "toward the cases that would let
  something through, not the ones that confirm the happy path". Same header, same bias. Use
  `spike/inputs/client-note.md` as one realistic fixture, read with `node:fs` the way
  `test/schema.test.js:19-24` does.
- **IMPORTS**: `node:test`, `node:assert/strict`, `node:fs`, `node:path`, `node:url`,
  `../src/note-fields.js`.
- **GOTCHA**: `npm test` globs `test/*.test.js` only — the file must sit directly in `test/`.
- **VALIDATE**: `npm test -- --test-name-pattern="." 2>&1 | tail -5` and specifically
  `node --test test/note-fields.test.js`
- **SATISFIES**: AC #4, AC #7.

### Task 4 — CREATE `migrations/0002_note_visibility.sql`

- **IMPLEMENT**: one table, `CREATE TABLE` only.

  ```sql
  CREATE TABLE note_visibility (
    client_id  TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    field_key  TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (client_id, field_key)
  );
  ```

  The header comment carries the three decisions: **presence is permission** (a row means shared;
  there is no boolean to invert, and an empty table is the fail-closed default for every note that
  already exists); the cascade matches `events`, so deleting a client takes its permissions with
  it; and the table holds **no candidate data and no note text** — a client id and a heading slug,
  which is why it does not move the §5.6 boundary.
- **PATTERN**: `migrations/0001_init.sql` — its header cites the architecture section and says what
  is deliberately absent. Mirror the tone.
- **GOTCHA**: **no `ALTER TABLE`, anywhere.** `test/schema.test.js:101` fails the suite on any
  occurrence, and the comment there explains why a `CREATE TABLE`-only rule is what keeps the guard
  honest. This is also why the flag is a new table and not a column on `clients`: adding a column
  needs a table rebuild, and a rebuild needs `ALTER … RENAME`.
- **GOTCHA**: no identifier may match `/candidate|^cv$|resume|\bpack\b|brief/i`
  (`test/schema.test.js:125`) — which rules out a column literally named `candidate_visible`. The
  DB names the mechanism (`note_visibility`, `field_key`); the **API JSON key stays
  `candidate_visible`**, because that test parses migration SQL only and the ticket's vocabulary is
  worth keeping where a reader meets it.
- **VALIDATE**: `npm run db:local` then
  `npx wrangler d1 execute --local --persist-to .wrangler/state -c .wrangler/dev.toml DB --command "PRAGMA table_info(note_visibility)"`
  — if the generated-config path differs, get it from `scripts/dev.py`'s printed output rather than
  guessing.
- **SATISFIES**: AC #2, AC #6.

### Task 5 — UPDATE `test/schema.test.js`

- **IMPLEMENT**: two edits and nothing else.

  1. The expected-table assertion (line 116) becomes
     `["agency", "clients", "events", "note_visibility"]`, with the message extended to say **why**
     the fourth table exists: #18, the candidate-visibility allow-list, holding a client id and a
     heading slug — no candidate data, no note text, so the §5.6 boundary has not moved.
  2. A **new** assertion in the idiom of the `events` one:
     `note_visibility holds exactly {client_id, field_key, created_at} and nothing else`, with a
     message saying a fourth column — a note excerpt "for debugging", a candidate email — is
     exactly the descope it exists to fail on.
- **PATTERN**: the `events` test at lines 145-153, verbatim in shape.
- **GOTCHA**: **do not touch** the `ALTER TABLE` ban, the candidate-shaped-name test, the
  events-columns assertion, or the `clients.note` assertion. This edit widens the expected set by
  exactly one name and adds a guard; it removes nothing. The file's comment at 105-111 asks for the
  reasoning in the PR — put it there too.
- **GOTCHA**: this is the file #17 (portal schema) also has to edit. Whoever lands second rebases
  the array rather than replacing it. Say so in the PR body.
- **VALIDATE**: `node --test test/schema.test.js` → all tests pass, and temporarily adding a
  `note_excerpt TEXT` column to the migration makes exactly one of them fail (revert it).
- **SATISFIES**: AC #2, AC #6.

### Task 6 — UPDATE `src/store.js` — the visibility read

- **IMPLEMENT**: `listVisibleKeys(db, clientId)` → `string[]`.

  ```js
  const { results } = await db
    .prepare("SELECT field_key FROM note_visibility WHERE client_id = ? ORDER BY field_key")
    .bind(String(clientId ?? ""))
    .all();
  return (results ?? []).map((row) => row.field_key);
  ```

  Comment it the way `requireClient` (line 281) is commented: this path deliberately selects one
  column and never joins to `clients`, so a permissions read never carries the note.
- **PATTERN**: `eventCounts` (line 321) for the `all()` / `results ?? []` shape.
- **IMPORTS**: add `import { parseNoteFields } from "./note-fields.js";` at the top of the file,
  beside the existing `RENDERERS` import.
- **GOTCHA**: no `JOIN`. `test/store.test.js` asserts the list query never selects `note`; the same
  reasoning applies here and the next task adds the assertion.
- **VALIDATE**: `node --test test/store.test.js`
- **SATISFIES**: AC #2.

### Task 7 — UPDATE `src/store.js` — the visibility write

- **IMPLEMENT**: `setFieldVisibility(db, id, patch)`, where `patch` is `{ [field_key]: boolean }`.

  - `export const VISIBILITY_KEYS_MAX = 50;` — a bound on one request. The editor sends one key per
    toggle; a note of 100,000 characters could in principle hold thousands of headings, and this
    function loops one statement per key. Throw `StoreError("too_long", 400, …)` past the cap.
  - Every value must be a real boolean → otherwise `StoreError("missing_fields", 400,
    "visibility: <key> must be true or false")`. `"false"` is a string and is truthy; a coerced
    truthy value on this path is a leak.
  - `const client = await getClient(db, id);` — 404 before writing, exactly as `updateClient` does
    (line 195). This is the one place the note is legitimately read on a visibility path, because
    the keys are validated against it.
  - Build `const known = new Set(parseNoteFields(client.note).map((f) => f.key).filter(Boolean));`
    — `filter(Boolean)` drops the null keys of duplicate headings, so a duplicated section cannot be
    flagged at all. **Any key not in `known` throws `StoreError("unknown_field", 400, …)`.** Reason, in a comment: an allow-list
    entry for a heading that does not exist is a permission waiting for a name. Write `## Salary`
    six months later and it would already be shared, with nobody having ticked it.
  - Then, per key: `true` →
    `INSERT OR IGNORE INTO note_visibility (client_id, field_key) VALUES (?, ?)`;
    `false` → `DELETE FROM note_visibility WHERE client_id = ? AND field_key = ?`.
    Sequential `await …run()`. **Do not use `db.batch()`** — `test/helpers/fake-d1.js` does not
    implement it.
  - Return `clientWithFields(db, client.id)` (next task).
- **PATTERN**: `updateClient` (179-201) for the 404-before-write and the fixed-shape SQL;
  `recordEvent` (294) for validating the scalar before the existence check, so a request that gets
  both wrong reports the malformed field rather than hiding it behind a 404.
- **GOTCHA**: `Object.hasOwn`/`Object.entries` over the patch, never `for…in` — a body of
  `{"__proto__": true}` reaches here as parsed JSON, and `Object.entries` sees only own keys. The
  `known` check would reject it anyway; belt and braces on the one function whose whole job is a
  permission.
- **VALIDATE**: `node --test test/store.test.js`
- **SATISFIES**: AC #1, AC #2, AC #5.

### Task 8 — UPDATE `src/store.js` — prune on note save

- **IMPLEMENT**: inside `updateClient`, when and only when `Object.hasOwn(patch, "note")`, after
  the `UPDATE clients …` statement. **Diff in JavaScript, delete one key at a time** — no
  `NOT IN (…)` list:

  ```js
  const kept = new Set(parseNoteFields(cleanedNote).map((f) => f.key).filter(Boolean));
  const stale = (await listVisibleKeys(db, client.id)).filter((key) => !kept.has(key));
  for (const key of stale) {
    await db
      .prepare("DELETE FROM note_visibility WHERE client_id = ? AND field_key = ?")
      .bind(client.id, key)
      .run();
  }
  ```

  Comment: a heading that no longer exists must not keep its permission, or renaming a section and
  later retyping the old name re-shares it silently. Clearing the note clears every permission,
  which is the same rule at its limit.
- **PATTERN**: `requireClient` / `eventCounts` — fixed statements, every value bound. This path has
  **no dynamic SQL at all**, which is a stronger property than `updateClient`'s allow-list
  construction and worth saying in the PR.
- **GOTCHA**: the obvious `DELETE … WHERE field_key NOT IN (?, ?, …)` was rejected on purpose.
  It binds one parameter per parsed heading, and parsing is uncapped — D1 caps bound parameters
  per query (check the current number in the
  [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) before ever reaching for that
  shape). A note with enough headings would fail the **save path for the product's compounding
  asset**, on the recruiter's own text. The diff above is bounded by stored permissions, which are
  few and recruiter-created, instead.
- **GOTCHA**: reuse the already-cleaned note (the value pushed into `values` for the `note = ?`
  column), not `patch.note`. They differ whenever `cleanNote` normalises anything, and drifting
  from the stored text would prune against a note that was never saved.
- **GOTCHA**: this issues one extra `SELECT` and N `DELETE`s on the note-save path, so the
  **pre-existing** `updateClient` fixtures in `test/store.test.js` will run out of queued results
  and fail. That is fixture drift, not a store bug — add results to the fixtures, do not "fix" the
  store.
- **VALIDATE**: `node --test test/store.test.js`
- **SATISFIES**: AC #5.

### Task 9 — UPDATE `src/store.js` — the composed read

- **IMPLEMENT**: `clientWithFields(db, id)` → `{ client, fields }`, where `fields` is
  `parseNoteFields(client.note)` mapped to
  `{ key, heading, chars, candidate_visible }` — `candidate_visible` being
  `key !== null && visibleKeys.includes(key)`. A duplicate heading's field keeps its `key: null`
  and travels to the UI, which has to explain it rather than silently drop a section the recruiter
  can see in the textarea.

  The section **body text is deliberately not returned**: the recruiter is looking at the note in
  the textarea two inches above, and a second copy of the same personal data on the wire is payload
  for nothing. `chars` gives the row its "how much is in here" line, in the idiom of
  `rowMeta` (`public/clients.js:139`).
- **PATTERN**: `getClient` (152) — one function, one return shape, throws rather than returning
  null.
- **GOTCHA**: `client` keeps **exactly** its current shape (`id, name, note, created_at,
  updated_at`). `public/app.js` reads this endpoint too; adding a sibling key is additive, changing
  `client` is not.
- **VALIDATE**: `node --test test/store.test.js`
- **SATISFIES**: AC #2.

### Task 10 — UPDATE `test/store.test.js`

- **IMPLEMENT**: a new section, mirroring the existing ones:

  - `listVisibleKeys` selects `field_key` only, mentions neither `note` nor a `JOIN`, and binds the
    client id rather than interpolating it;
  - `setFieldVisibility` with `true` records an `INSERT OR IGNORE` and with `false` a `DELETE`,
    each with the id and the key **bound** — assert no recorded `sql` string contains the key text;
  - an unknown key throws `unknown_field` and records **no write statement at all** (assert the
    recorded call count);
  - a non-boolean value (`"true"`, `1`, `null`) throws `missing_fields` before any write;
  - more than `VISIBILITY_KEYS_MAX` keys throws `too_long`;
  - a client id that does not exist throws `not_found` and records no write;
  - `updateClient` with a note prunes: given stored keys `[a, b]` and a saved note containing only
    `a`, exactly one `DELETE … field_key = ?` is recorded, bound to `b`; with `note: ""` both are
    deleted; with a note whose headings all survive, **no** delete is recorded;
  - `updateClient` with only a `name` records neither the visibility `SELECT` nor a delete
    (pruning is a note-save behaviour);
  - a section duplicated by a note save drops its stored permission, because the key it was stored
    under is no longer produced by the parser;
  - the existing "list query never selects note" assertion still passes unchanged.

  **And, in the same pass**: the *pre-existing* `updateClient` fixtures. Task 8 makes that function
  issue a `SELECT` and possibly deletes it did not issue before, so those `fakeD1([...])` arrays
  need extra queued results. Adding them is the fix; changing the store is not (R9).
- **PATTERN**: the file's own `codeOf()` helper (line ~58) for asserting error codes, and the
  recorded-SQL assertions in the header comment's list of three.
- **GOTCHA**: `fakeD1(queued)` answers `prepare()` calls in order — a store function that now issues
  more statements needs more queued results, and an under-queued fake returns `undefined` and fails
  in a way that looks like a store bug. Count the statements per path before writing the fixture.
- **VALIDATE**: `npm test`
- **SATISFIES**: AC #1, AC #4, AC #5, AC #7.

### Task 11 — UPDATE `functions/api/clients/[id].js`

- **IMPLEMENT**:

  - `onRequestGet` returns `json(await clientWithFields(env.DB, String(params.id)))` — i.e.
    `{ client, fields }`. The `client` key and its contents are unchanged, so `public/app.js` and
    the existing `load()` in `clients.js` keep working untouched.
  - `onRequestPut` gains a third branch on the allow-list at lines 39-40:
    `if (Object.hasOwn(body, "visibility")) …`. Rules:
    - `visibility` must be a plain object (not null, not an array) → else `bad_json`-style
      `StoreError("missing_fields", 400, "visibility: must be an object of field keys")`.
    - If `visibility` is present it is handled by `setFieldVisibility`; if `name`/`note` are present
      they go to `updateClient` as now. Both in one request is allowed — run `updateClient` **first**
      (so the note and therefore the valid key set is current), then `setFieldVisibility`. The
      editor never sends both, but the ordering rule is one line and the other order is a silent
      `unknown_field` on a legitimate request.
    - The response is always `clientWithFields(...)`, so a caller always gets back the truth it can
      re-render from.
  - Update the file's top-of-file route comment to document the new response shape and the new
    body key.
- **PATTERN**: the existing explicit allow-list and its comment at lines 37-40 — extend the comment
  rather than replacing it, and keep "anything else in the body is ignored rather than rejected".
- **IMPORTS**: add `clientWithFields, setFieldVisibility` to the existing `src/store.js` import.
- **GOTCHA**: `sameOrigin` already guards PUT. Do not add a second check, and do not add one to
  GET — `src/http.js:41-43` says why.
- **VALIDATE**: with `npm run dev` running:
  ```bash
  ID=$(curl -s localhost:8788/api/clients | python3 -c 'import sys,json;print(json.load(sys.stdin)["clients"][0]["id"])')
  curl -s "localhost:8788/api/clients/$ID" | python3 -m json.tool | head -30
  curl -s -X PUT "localhost:8788/api/clients/$ID" -H 'content-type: application/json' \
    -d '{"visibility":{"their-process":true}}' | python3 -m json.tool
  curl -s -X PUT "localhost:8788/api/clients/$ID" -H 'content-type: application/json' \
    -d '{"visibility":{"no-such-heading":true}}'   # expect {"error":"unknown_field"} 400
  ```
- **SATISFIES**: AC #1, AC #2.

### Task 12 — UPDATE `public/clients.html`

- **IMPLEMENT**: a fieldset inside `#editor-body`, **after** `.save-row` and **before**
  `.editor-remove`:

  ```html
  <fieldset class="visibility" id="visibility">
    <legend class="field">What a candidate can see</legend>
    <p class="field-hint">Nothing in this note reaches a candidate unless you tick it here.
      Tick only what would help someone get ready for the interview — never anything you would
      not say to their face.</p>
    <p class="visibility-empty" id="visibility-empty" hidden></p>
    <ul class="visibility-list" id="visibility-list"></ul>
    <p class="save-state" id="visibility-state" role="status"></p>
  </fieldset>
  ```

  Each row, built in JS: `<li><label><input type="checkbox" data-key="…"> <span
  class="visibility-name">Their process</span> <span class="visibility-meta">412
  characters</span></label></li>`.
- **PATTERN**: the agency strip (lines 104-133): `fieldset` + `legend class="field"` +
  `p class="field-hint"` + controls + a `role="status"` line. The `.radio-group` reset
  (`app.css:462`) already removes the browser's fieldset chrome.
- **GOTCHA**: the fieldset lives inside `#editor-body`, which is `hidden` until a client is
  selected. That is correct here — like `#save-state`, it has no meaning without a client — and it
  is why its live region must not be used for list-level failures (`clients.js:198-204`).
- **GOTCHA**: placement is a decision, not a default. It sits **below** Save because it describes
  the saved note, and **above** the delete block so the two most opposite actions on the screen stay
  non-adjacent (`clients.html:88-90`).
- **VALIDATE**: `grep -n 'visibility' public/clients.html` and open `/clients` in the browser —
  the fieldset renders with its hint even before JS fills the list.
- **SATISFIES**: AC #1.

### Task 13 — UPDATE `public/clients.js`

- **IMPLEMENT**: read the file's 27-line header first; all four numbered decisions apply.

  - **COPY additions** (in the `COPY` object, first-time-recruiter language):
    - `visibilityEmpty`: "This note has no sections yet. Start a line with ## and a section name — like ## Their process — then save the note. You can choose what a candidate sees, section by section."
    - `visibilityStale`: "Save the note to update this list."
    - `visibilityDuplicate`: "Two sections have this name, so neither can be shared. Give them different names and save."
    - `visibilitySaved`: "Saved"
    - `visibilityFailed`: "Could not change that. It is still what it was."
  - **`el` additions**: `visibilityList`, `visibilityEmpty`, `visibilityState`.
  - **`renderFields(fields)`**: rebuild the list with `textContent` only; `checkbox.checked =
    field.candidate_visible`; `data-key` carries the key; the meta span reads
    `field.chars.toLocaleString("en-GB") + " characters"` (singular "character" at 1, matching
    `rowMeta`). A field with `key === null` renders with the checkbox `disabled` and
    `COPY.visibilityDuplicate` as its meta text instead of the character count — the section is
    visible in the list because it is visible in the textarea, and saying why it cannot be ticked
    beats it silently missing. Empty `fields` → show `#visibility-empty` with `visibilityEmpty` and
    hide the list.
    Preserve keyboard focus across the rebuild the way `renderList` does (lines 148-156) — the same
    bug applies.
  - **`load()`**: call `renderFields(body.fields)` inside the existing `if (state.selected !==
    reqId) return;` guard, and clear the visibility state line.
  - **`toggleField(key, wanted)`**: mirrors `saveAgency` (362-382), not `save`.
    - Capture `var savingId = state.selected;` before the request; bail in every `.then` if
      `state.selected !== savingId`. This is the header's decision #4, and a toggle is the easiest
      place in the file to reintroduce it: a response applied under the wrong id writes a
      permission to a different client's note.
    - Guard re-entrancy per key (a small `state.togglingKeys` object or a `pending` flag on the
      row), so a double-click does not race two writes for the same key.
    - PUT `{ visibility: { [key]: wanted } }`; on success re-render from `body.fields` (server
      truth, not the checkbox) and write `visibilitySaved`; on failure **put the checkbox back**,
      write `messageFor(err, COPY.visibilityFailed)` with `is-error`, and re-render from a fresh
      `load()`-style read so the screen never shows a permission that was not stored.
  - **Dirty-note interaction**: the list describes the **saved** note. When `state.dirty` becomes
    true, write `visibilityStale` into `#visibility-state` (not an error). Toggling is still
    allowed — the keys it sends are the saved note's keys, which are exactly what the server will
    validate against. Do **not** fold toggles into `state.dirty` or the `beforeunload` warning: a
    toggle is saved the moment it is made, so warning about it would be a lie.
  - **Wiring**: one delegated `change` listener on `#visibility-list`, not one per row — the list is
    rebuilt on every save.
- **PATTERN**: `saveAgency` (362-382) end to end: optimistic control, own live region, and
  `loadAgency()` on failure to put the control back to what the deployment actually holds.
- **GOTCHA**: `state.dirty` must not be set by a toggle, and a toggle must not clear it.
- **GOTCHA**: the duplicate row uses real `disabled`, not `aria-disabled`. The house rule at
  `clients.js:230` is about a **transient busy state on a focused control** — setting `disabled`
  there drops focus to `<body>` mid-action. This is a static "there is nothing to press here"
  state, and its reason is in the row's own text.
- **GOTCHA**: nothing to browser storage — decision #1 of the header comment. The checkbox state
  lives in the DOM and in D1, nowhere else.
- **GOTCHA**: `textContent`, never `innerHTML`. Headings are agency-authored text and this is the
  one place they are rendered.
- **VALIDATE**: `node .claude/probes/clients-screen.mjs` (after the probe task below), and manually:
  tick a box, reload the page, the tick survives; rename the heading in the note, save, the row is
  gone and the tick did not move to another section.
- **SATISFIES**: AC #1, AC #5.

### Task 14 — UPDATE `public/app.css`

- **IMPLEMENT**: **read `.claude/skills/dossier-design/references/CRAFT.md` before writing a line.**
  Then a `/* ── the visibility list ── */` section near the editor rules (after `.editor-remove`,
  before the agency strip):

  - `.visibility` — fieldset reset identical to `.radio-group` (`border: 0; margin: 0; padding: 0`),
    `margin-top: var(--space-12)` so it reads as its own zone rather than part of the save row.
  - `.visibility-list` — list reset, `display: flex; flex-direction: column; gap: var(--space-2)`.
  - `.visibility-list label` — the `.radio-row label` pattern including its `min-height` (the 44px
    tap-target floor is already solved there; do not re-solve it), `gap: var(--space-2)`,
    `align-items: baseline`, `min-width: 0` on the name span so a long heading wraps rather than
    blowing the grid out (CRAFT: wide-content trap).
  - `.visibility-name` — `overflow-wrap: anywhere`, the same reasoning as `.editor-head h2`
    (`app.css:377-382`).
  - `.visibility-meta` — `color: var(--text-muted)`, `font-size: var(--text-caption)` — nothing
    below 12px.
  - `.visibility-empty` — `color: var(--text-muted)`, matching `.rail-empty`.
- **PATTERN**: `.radio-group` / `.radio-row label` (`app.css:462-478`) — native controls, unstyled
  input, all the work in the label.
- **GOTCHA**: **no raw hex.** Every colour through a custom property; the Level 1 grep fails on a
  hex in `app.css`. No `transition: all`. No new colour pairing — if you reach for one, it needs a
  contrast check in `test/tokens.test.js` first, which is a signal the design drifted.
- **GOTCHA**: state the six interactive states for the row (hover/focus-visible/active/disabled/
  loading/error) — most are inherited from the global focus rule (`app.css:70`) and the native
  checkbox; the only new one is the row's disabled-while-saving read, and `aria-disabled` is the
  house answer (`clients.js:230`), never `disabled`.
- **VALIDATE**: `grep -nE '#[0-9a-fA-F]{3,8}' public/app.css` → nothing;
  `grep -n 'transition: all' public/*.css` → nothing; `npm test` (the tokens gate).
- **SATISFIES**: AC #1, AC #8.

### Task 15 — UPDATE `.claude/probes/clients-screen.mjs`

- **IMPLEMENT**: one added case, in the file's existing style — stub `fetch`, control response
  order, assert the DOM. **The race**: select client A, click a toggle, select client B before the
  PUT resolves, then resolve it. Assert that B's visibility list is unchanged and that no request
  carrying A's key was applied to B's rows.
- **PATTERN**: the file's existing sequencing cases — its header explains why this class of bug is
  measured in a browser and not reasoned about in prose.
- **GOTCHA**: not part of `npm test` by design; it needs Chrome and Node ≥ 22.
- **VALIDATE**: `node .claude/probes/clients-screen.mjs` → all cases pass.
- **SATISFIES**: AC #5, AC #7.

### Task 16 — UPDATE `README.md`

- **IMPLEMENT**: one paragraph under the existing Decisions material: what a "section" is (a `##`
  heading in the note), that nothing is shared unless ticked, that renaming a heading drops its
  permission, and that the allow-list table holds only a client id and a heading slug. Two or three
  sentences, in the file's register.
- **PATTERN**: the existing Decisions entries — a decision, then the reason, in prose.
- **GOTCHA**: do not document the portal itself here; #17/#19/#22 own that.
- **VALIDATE**: `grep -n 'section' README.md | head`
- **SATISFIES**: AC #9.

### Task 17 — HAND OFF the seam to #19 and #22

The largest residual risk in this ticket is not in this ticket: a consumer that reads `client.note`
instead of calling `visibleFields()` bypasses everything above, and no test here can fail on code
that does not exist yet. This task is the mechanism that carries the rule forward in writing rather
than in hope. See *RISK REGISTER* R2.

- **IMPLEMENT**:
  1. `src/note-fields.js`'s header comment states the rule in one paragraph addressed to the next
     implementer: **candidate-facing code calls `visibleFields(note, keys)` and never reads
     `client.note`**, because a bug of omission must hide a fact rather than leak one.
  2. Comment on **#19** and **#22** with the seam: the module path, the exported signature, the
     shape it returns, and the fail-closed default — stated as a rule, in words:
     *candidate-facing code imports `visibleFields` from `src/note-fields.js`; the only place
     `.note` appears in it is as that call's first argument.* **Do not hand them a grep.** The
     obvious one (`grep '\.note'`) fires on the compliant call itself, and `public/clients.js:11`
     records this repo's view of a gate that cries wolf: it gets deleted.
  3. Comment on **#17** naming the migration number this ticket used and the `test/schema.test.js`
     line it touched, so the second ticket to land rebases rather than replaces.
- **PATTERN**: the epic issue #16's own "Non-negotiables carried from the spec" — the rules travel
  as written statements attached to the tickets that must honour them.
- **GOTCHA**: this is not optional documentation polish. It is the only mechanism this plan has for
  R2, and R2 is the risk that would make the whole ticket decorative.
- **VALIDATE**: `gh issue view 19 --comments | tail -20` and `gh issue view 22 --comments | tail -20`
  show the seam; `head -30 src/note-fields.js` states the rule.
- **SATISFIES**: AC #3, AC #10.

---

## TESTING STRATEGY

`node --test` with zero dependencies, a hand-rolled D1 fake, and file-parsing guard tests — the
repo's three existing kinds, no fourth.

### Unit Tests

- **`test/note-fields.test.js`** (new) — the parser and, first, the four leak-shaped properties.
  This is where the feature's correctness actually lives; the rest is plumbing.
- **`test/store.test.js`** (extended) — SQL shape and validation: what is bound, what is never
  interpolated, what writes happen and what writes do **not** happen on a rejected request.
- **`test/schema.test.js`** (extended) — the table exists, holds three columns, and cannot grow a
  fourth without failing the suite.

### Integration Tests

- `.claude/probes/clients-screen.mjs` — real Chrome over CDP, stubbed `fetch`, response ordering
  under the tester's control. One added case for the toggle race.
- The curl sweep in the `[id].js` task, against `npm run dev` with a real local D1: round-trip,
  unknown key, cascade on delete.

### Edge Cases

That must be covered:

- a note with no headings at all → no fields, nothing shareable;
- a note that is empty, or cleared to `""` → every permission dropped;
- two identical headings in one note → neither is flaggable, and a `visibility` write naming that
  slug is rejected;
- a ticked section duplicated, then the **first copy deleted** → the survivor is unticked. This is
  the case the positional-key design got wrong, and it is the reason there are no positional keys;
- a heading renamed after being ticked → permission gone, and re-typing the old name later does
  **not** restore it;
- a `visibility` body key that is not a current heading → 400, no write;
- a `visibility` value of `"false"`, `0`, `null`, `undefined` → 400, no write;
- `{"__proto__": true}` as the visibility patch → rejected, no prototype touched;
- a client deleted while a toggle is in flight → the cascade removes the rows, the screen reports
  the deletion, and no orphan permission survives;
- a toggle in flight when the recruiter selects another client → nothing written to the new client;
- `\r\n` line endings from a note pasted out of Word;
- a heading longer than 80 characters → key truncated, still round-trips;
- 360px viewport → the row wraps, no horizontal page scroll.

---

## VALIDATION COMMANDS

Execute every command to ensure zero regressions and 100% feature correctness.

### Level 1: Syntax & Style

```bash
grep -nE '#[0-9a-fA-F]{3,8}' public/app.css                    # expect: nothing (no raw hex)
grep -n 'transition: all' public/*.css                          # expect: nothing
grep -nE 'localStorage|sessionStorage|indexedDB|document\.cookie' public/clients.js   # expect: nothing
grep -nE 'ALTER[[:space:]]+TABLE' migrations/*.sql              # expect: nothing
grep -niE 'candidate|resume|\bbrief\b' migrations/0002_note_visibility.sql   # expect: comments only
grep -n 'innerHTML' public/clients.js                           # expect: nothing
grep -n 'batch(' src/store.js                                   # expect: nothing (the fake has none)
grep -n 'NOT IN' src/store.js                                   # expect: nothing (R6 — bound-parameter cap)
grep -nE 'import |prepare\(|db\.' src/note-fields.js            # expect: nothing (the module is pure)
```

### Level 2: Unit Tests

```bash
npm test
node --test test/note-fields.test.js
node --test test/schema.test.js
node --test test/store.test.js
```

### Level 3: Integration Tests

```bash
export PATH="$HOME/.nvm/versions/node/v24.11.0/bin:$PATH"
node .claude/probes/clients-screen.mjs
node .claude/probes/one-screen.mjs        # regression: the pack screen still reads /api/clients/:id
```

### Level 4: Manual Validation

```bash
npm run db:local        # applies 0002
npm run dev             # serves :8788 against the same local D1
```

Then, in the browser at `http://localhost:8788/clients`:

1. Paste `spike/inputs/client-note.md` into a client's note, save → four-plus rows appear, **all
   unticked**.
2. Tick "Their process" → "Saved"; reload → still ticked.
3. Rename that heading in the note, save → the row is gone, the new row is unticked, and the old
   permission did not migrate.
4. Duplicate a ticked section's heading verbatim, save → both rows read "Two sections have this
   name…", neither is tickable, and the permission is gone from `note_visibility`. Delete the first
   copy, save → the survivor comes back **unticked**.
5. Clear the note entirely, save → the list is empty and `SELECT * FROM note_visibility` for that
   client returns nothing.
6. Delete the client → its `note_visibility` rows are gone (cascade).
7. `curl` the unknown-key and non-boolean cases from the `[id].js` task → 400 with the right codes.
8. Resize to 360px → no horizontal page scroll; tab through the list → visible focus on every row.

### Level 5: Additional Validation

`.claude/skills/dossier-design/references/CHECKLIST.md`, section by section, written into the
completion report. The Data-posture section is the one that matters most here.

---

## ACCEPTANCE CRITERIA

- [ ] **AC #1** — A recruiter can tick and untick visibility per section in `public/clients.html`,
      in the dossier-design system's patterns, with every string written for a first-time recruiter.
- [ ] **AC #2** — The flag round-trips through the API: `GET /api/clients/:id` returns
      `fields[].candidate_visible`, `PUT` with a `visibility` patch persists it, and a reload shows
      what was stored.
- [ ] **AC #3** — `visibleFields()` exists in `src/note-fields.js`, returns only flagged fields, and
      is a pure function importable without D1.
- [ ] **AC #4** — `visibleFields()` is unit-tested, including with the flag argument omitted.
- [ ] **AC #5** — **Fail closed, five ways**: every existing note starts fully hidden; a new section
      starts hidden; a key with no matching heading is never emitted and never written; a renamed
      heading loses its permission and cannot regain it by having its old name retyped; two
      same-named sections are both unflaggable, so a permission can never transfer between them.
- [ ] **AC #6** — The schema gains exactly one table, holding a client id, a heading slug and a
      timestamp. `test/schema.test.js` fails if a fourth column appears, and every existing
      boundary assertion in it still passes unchanged.
- [ ] **AC #7** — All validation commands pass with zero errors, including the browser probe.
- [ ] **AC #8** — No regression on the pack screen, the pack pipeline or the submission flow: no
      file listed under Non-Goals was edited.
- [ ] **AC #9** — README records what a section is and the fail-closed rule.
- [ ] **AC #10** — The seam is handed forward in writing: `src/note-fields.js`'s header states the
      rule for candidate-facing code, and #19, #22 and #17 each carry a comment with what they need
      (the signature and the rule; the migration number and the schema-test line).

---

## COMPLETION CHECKLIST

- [ ] Task 1's gate passed and its finding written into the report (reading confirmed; migration
      number and schema-test array checked against what is actually on `main`)
- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] All validation commands executed successfully
- [ ] Full test suite passes (`npm test`) plus both probes
- [ ] Manual sweep in the browser confirms the seven Level-4 steps
- [ ] Acceptance criteria all met
- [ ] CHECKLIST.md self-audit written into the completion report
- [ ] PR body states the `test/schema.test.js` reasoning the file's own comment (lines 105-111)
      demands, and flags the #17 rebase
- [ ] Every RISK REGISTER row's mechanism is actually in the diff — not just in this file
- [ ] The seam comments are posted on #19, #22 and #17
- [ ] PR closes #18

---

## OPEN QUESTIONS / ASSUMPTIONS

**Assumption 1 (the load-bearing one): a "field" is a markdown heading section of the note, not a
structured column.** The ticket does not define it and neither does the architecture. Evidence for
this reading:

- the ticket says the toggle is set "in **the existing** note editor" and that this is
  "**renderer-agnostic** — this ticket changes the recruiter tool only". Splitting the note into
  named columns would force edits in `src/prompt.js:50`, `src/provenance.js:40`, `src/generate.js:75`
  and `public/app.js:394` — none of which is the recruiter tool, and all of which are the pack;
- the ticket says the default for "every **existing** and new field" is hidden. Structured columns
  have no existing fields; heading sections do — every note already written has them;
- `.claude/plans/client-knowledge-store.md:54` is an explicit prior non-goal: "structured note
  fields… do not invent fields";
- `spike/inputs/client-note.md` and the fixture at `test/store.test.js:47` are both already written
  as `##` sections.

If the owner intended fixed named fields, this plan is the wrong shape and the ticket is
substantially larger. **Cheap to veto now, expensive later** — which is why it is not left as a
question. **Task 1 is the gate** (R1): it re-checks the reading before any irreversible step, and
the two irreversible steps (the migration, the API contract) both sit behind it. Note also that the
blast radius of being wrong is smaller than it looks: the table, the store functions, the endpoint
and the editor's auto-save all survive either reading. Only `src/note-fields.js` and the row
rendering would be rewritten.

**Assumption 2: the helper is `visibleFields(note, visibleKeys)`, not `visibleFields(note)`.** The
ticket sketches a one-argument signature; the permissions live in D1, not in the note text, so the
function needs both. The AC is behavioural — returns only flagged fields, fails closed — and both
signatures satisfy it. The omitted-argument case returns `[]`, so the sketched call is still safe.

**Assumption 3: the DB names the mechanism, the API keeps the ticket's word.** `test/schema.test.js:125`
fails any identifier matching `/candidate|…/i`, so the column cannot be `candidate_visible`. The
JSON key is, because that test reads migration SQL only and the vocabulary is worth keeping where a
human meets it.

**Assumption 4: presence-is-permission beats a boolean column.** An allow-list table has no state to
invert and no default to get wrong; an empty table *is* the fail-closed default. The cost is that
"explicitly hidden" and "never touched" are indistinguishable, which nothing in the epic needs.

**Assumption 5: a heading that is not unique is not flaggable.** The alternative — positional
`-2`/`-3` keys — leaks (R4). Nothing in the epic needs two same-named sections, and the recruiter
cannot tell them apart in the list either, so the constraint is honest rather than arbitrary.

**Question 1 — closed by Task 1, recorded here because it recurs.** #17 and #18 both edit
`test/schema.test.js`'s expected-table list and both add a migration; this plan claims
`0002_note_visibility.sql`. The mechanism is R3: Task 1 checks `ls migrations/` and the live array
before writing either, Task 5 adds a name rather than replacing the array, and Task 17 posts the
number and the line on #17. The standing rule for whoever sequences wave 1: **never let this merge
resolve by taking one side.**

**Question 2 (genuinely open, deferrable to #22):** should a section's *body* travel in the API response so a send
preview can show exactly what a candidate would receive? This plan says no — the recruiter is
reading the note two inches above the list, and a second copy of the same personal data on the wire
buys nothing here. #22 has a real preview surface and can add it there.

## NOTES (open canvas)

### Why a new table rather than a column on `clients`

`test/schema.test.js:101` bans `ALTER TABLE` outright, and the SQLite way to add a column without
one is a table rebuild — which needs `ALTER … RENAME TO` and would also, in passing, put a second
table name in the parser's map and fail the exactly-three assertion anyway. There is no clever path
around the guard. Given that any persistence at all requires a deliberate, argued edit to that file,
the question becomes which shape is worth the edit, and the allow-list table wins: it is the only
option where the storage layout itself encodes the safety property.

Worth being explicit that this is the second time this file has been the deciding constraint on a
design. That is the file working as intended.

### The three ways a permission could leak, and where each is stopped

| Leak | Stopped by |
|---|---|
| Consumer reads `client.note` and forgets the filter | `visibleFields()` is the seam. No test here can fail on code that does not exist, so Task 17 carries the rule forward in writing — module header, README, and a comment on #19/#22 with the signature and the grep for them to adopt. This is R2, this ticket's largest residual, and the honest statement is that it is *handed off* rather than closed. |
| A key outlives its heading and later matches a new one | Prune on note save, **and** the read-side intersect in `visibleFields`. Two independent mechanisms, deliberately. |
| A permission transfers between two same-named sections when one is deleted | Duplicate headings are null-keyed and unflaggable, so the ambiguous key never exists to transfer. |
| A toggle response lands under the wrong client | `savingId` guard in `clients.js`, plus the browser probe case. This is a bug this screen has actually shipped before. |

The middle row is the one that would never have been found by testing the happy path, and it is why
the fail-closed cases are written first.

### What this deliberately does not solve

`visibleFields()` returns sections. It does not redact *within* a section — a section titled "Their
process" that happens to name a rejected candidate in its third paragraph is shared whole if it is
ticked. The mitigation is the copy ("never anything you would not say to their face") and the fact
that the recruiter is reading the exact text they are ticking. Sub-section redaction would need a
different unit of storage and a different UI, and it is not what decision 2 asked for.

### Rollout

Additive throughout. The migration creates an empty table, so a deployment that has run `0002` but
not shipped the UI behaves exactly as before: every note fully hidden, which is the state the
product wants anyway until #19 and #22 exist to read it.

## AMENDMENTS

<!-- newest at the bottom -->
