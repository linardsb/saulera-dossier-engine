# Feature: Client-knowledge note — locum supply fields

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

## Feature Description

Extend the per-client knowledge note with the vocabulary locum supply actually needs recorded: **credentialing quirks, VMS/portal used, protocol expectations, site access & parking, extension habits**. The note stays one free-text blob authored via markdown headings (`src/note-fields.js`'s standing rule: "the recruiter authors the structure, we only name it — do not invent fields"). So this slice does three things and no more:

1. **Names** the five locum fields as a canonical, pure vocabulary (`LOCUM_FIELDS` + a heading matcher `locumFieldFor`) in `src/note-fields.js`.
2. **Threads** them to consumers: `clientWithFields` in `src/store.js` gains an additive `locum_fields` readout (present/missing per canonical field), which rides the existing `/api/clients/:id` responses; downstream slices #49/#50 call `locumFieldFor(heading)` server-side against `visibleFields()`/`parseNoteFields()` output.
3. **Surfaces** them in the recruiter note editor: a scaffold prompt line (the existing §5.3 idiom) plus a "For locum supply" checklist that shows which of the five the saved note records, with one-click insert of a missing heading into the textarea.

## User Story

As a recruiter running a locum imaging desk
I want the client note to prompt me for, and keep track of, the locum-supply facts (credentialing quirks, VMS/portal, protocols, site access/parking, extension habits)
So that the locum booking pack (slice 2) and the candidate's first-day primer (slice 3) are built from a note that actually contains what a booking needs.

## Problem Statement

The note editor's scaffold and the engine's vocabulary are shaped for permanent hires (process · panel · what each stage tests · why candidates were turned down). A locum booking is decided on compliance and logistics, not panels. Nothing names the locum facts, so notes don't record them, and slices 2/3 would have nothing to consume.

## Solution Statement

Keep the free-text-blob architecture untouched. Add a canonical five-field locum vocabulary to `src/note-fields.js` (pure, no imports — same discipline as the rest of the module), with a tolerant heading matcher so `## VMS`, `## Portal used` and `## VMS / portal` all resolve to the same canonical field. Annotate the one server serialisation point (`clientWithFields`) with an additive `locum_fields` array — all three API paths (GET, PUT note, PUT visibility) already return through it, so one change threads the readout everywhere. The editor renders the checklist from that server truth (describing the SAVED note, exactly like the visibility list) and lets the recruiter insert a missing heading into the textarea, which marks the note dirty like any other edit.

## Out of Scope / Non-Goals

- **Not included: a rigid schema.** No new D1 columns, no structured fields, no validation that a note "must" contain locum sections. The ticket is explicit: naming and recognising, not schema.
- **Not included: consuming the fields.** The booking pack (#49) and the primer (#50) consume them; this slice only makes them addressable. Do not touch `src/prompt.js`, `src/generate.js`, `src/pack.js`, or anything under `src/prep/`.
- **Not included: role-shape gating of the editor block.** `briefProfile().role_shape` (`src/domain.js:86`) is a property of a *brief*; the note editor has no brief on screen. The checklist is shown for every client, titled so a perm-desk reader can skip it. #49/#50 do the role-shape branching at generation time. (See Open Questions.)
- **Not included: heading auto-harvesting or note rewriting.** The insert action appends a bare `## Heading` line to the textarea; the recruiter writes the body and saves. Architecture §6.5's "ship the editable note" rule stands.
- **Not changing:** the visibility gate semantics (`visibleFields`), the `fields` array's existing shape (additive keys only — `public/app.js` reads `/api/clients/:id` too), the D1 schema, migrations, `functions/api/clients.js` (index route), the perm scaffold line's wording.

## Feature Metadata

**Feature Type**: Enhancement
**Estimated Complexity**: Medium
**Primary Systems Affected**: `src/note-fields.js`, `src/store.js`, `public/clients.js`, `public/clients.html`
**Dependencies**: None new. Depends on #46 only conceptually (the locum role-shape flag exists for consumers); no import from `src/domain.js` is needed here.

## Related Work

**Implements**: [#48 — Client-knowledge note: locum supply fields](https://github.com/linardsb/saulera-dossier-engine/issues/48) · **Epic**: [#45 — Imaging-locum fit](https://github.com/linardsb/saulera-dossier-engine/issues/45) (slice 4; Constraints section inherited: same stack, no new services, perm flow untouched, no candidate data persisted beyond current schema)

**Back-references** (plans this builds on or inherits decisions from):

- `.claude/plans/client-knowledge-store.md` — Why: owns the "one free-text blob, do not invent fields" rule (line ~54) this slice must respect; owns the `/clients` screen idioms.
- `.claude/plans/per-field-candidate-visible-toggle.md` — Why: the visibility list is the pattern for a server-truth readout below Save; `fieldsVersion` recency guard governs every paint this slice adds.
- `.claude/plans/imaging-domain-vocabulary.md` — Why: slice 1 (#46), source of `role_shape` and the pure-module discipline; its Out-of-Scope handed this slice the note vocabulary.

**Forward-references** (plans that extend or supersede this — append as follow-ups get created):

- (none yet — #49 locum booking pack and #50 portal primer will consume `LOCUM_FIELDS` / `locumFieldFor`)

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `src/note-fields.js` (whole file, 214 ln — **read the header comment first**, the ticket says so) — Why: the module being extended. `fieldKey` (lines 91-100) is the slug function the canonical headings must survive; `parseNoteFields` (130-188) is what the checklist's "present" is computed from; the fail-closed philosophy (lines 5-25) is the bar any addition must clear.
- `src/store.js` (lines 300-325 `clientWithFields`, lines 326-390 `setFieldVisibility`) — Why: `clientWithFields` is the single serialisation point — `setFieldVisibility` returns through it (line ~389 `return clientWithFields(db, client.id)`), and `functions/api/clients/[id].js` GET and PUT both call it. One additive key here threads everywhere.
- `functions/api/clients/[id].js` (whole file, 93 ln) — Why: the thin adapter; confirms **no change is needed here** — the response is whatever `clientWithFields` returns.
- `public/clients.js` (lines 32-88 COPY, 419-531 visibility render/paint/repaint, 128-136 state) — Why: the checklist must follow the same three disciplines: strings in `COPY`, `textContent` never `innerHTML`, and the `paintFields`/`fieldsVersion` recency guard (a checklist painted from a stale response is the same bug the comment at 111-127 documents).
- `public/clients.html` (lines 76-106) — Why: the scaffold-line idiom (77-81, "§5.3's four things as prompts rather than fields") and the visibility fieldset (98-106) this slice's block sits between/after.
- `src/domain.js` (lines 1-13, 75-100) — Why: context only — where `role_shape` lives for #49/#50; **do not import it** into note-fields.js (pure-module rule) and do not gate the editor on it.
- `test/note-fields.test.js` (lines 1-60 for the idiom) — Why: the test style to mirror — leak-biased, inline fixtures, `spike/inputs/client-note.md` as the one real-shaped note.
- `test/store.test.js` (lines 339-365, the `clientWithFields` tests) — Why: the pattern for asserting the API shape over a real store.
- `test/counts.test.js` (lines 60-95) — Why: the source-scan gate idiom (readFileSync + assertions over `public/*.html`/`*.js`) — the only way `clients.js` (a non-module IIFE) is testable, per the existing suite.

### New Files to Create

- (none — every change lands in existing files, plus test extensions)

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [Issue #48](https://github.com/linardsb/saulera-dossier-engine/issues/48) — the ticket; its "do not invent fields" constraint is the design boundary.
- [Epic #45](https://github.com/linardsb/saulera-dossier-engine/issues/45) — Intent/Constraints inherited; slice 4 feeds slices 2 and 3.
- `docs/handover-louis-meeting.md` (untracked, repo root) — the locum desk context and personas; useful for choosing hint wording, not load-bearing.
- No external library docs needed: vanilla JS, no framework, no build step, `node --test`.

### Patterns to Follow

**Pure-module discipline** (`src/note-fields.js:14-16`): no imports at all; never throws on arbitrary input (`String(x ?? "")` coercion first, as `fieldKey:92` and `parseNoteFields:133` do).

**Additive API shape** (`src/store.js:311-313`): "`client` keeps exactly its existing shape… a sibling key is additive, a changed `client` is not." New data = new sibling key, existing keys untouched.

**Server truth, recency-guarded paints** (`public/clients.js:494-531`): anything describing the saved note renders only via `paintFields`, whose `fieldsVersion` check decides whether to paint; a losing response re-reads (`repaintFields`). The checklist is part of the same paint, not a second one.

**Strings live in COPY** (`public/clients.js:32-88`): every visible string is a `COPY` member, written for a first-time recruiter, saying what to do next. `textContent` only — headings and hints are rendered as text, never HTML.

**Leak-biased tests** (`test/note-fields.test.js:1-11`): test the ways recognition could misfire (a hospital name matching a field, a fenced heading, unicode) before the happy path.

**Comment idiom**: comments state constraints and decisions, not narration. Match the density of the file being edited (note-fields.js and clients.js are heavily decision-commented; match, don't exceed).

---

## IMPLEMENTATION PLAN

### Phase 1: Vocabulary (the pure module)

`LOCUM_FIELDS` and `locumFieldFor` in `src/note-fields.js`, with tests. Everything else consumes this.

### Phase 2: Threading (store → API)

**Depends on:** Phase 1

`clientWithFields` gains the `locum_fields` sibling key. Because `setFieldVisibility` and both `[id].js` handlers return through it, this is one edit plus tests — no Functions change.

### Phase 3: Surfacing (the editor)

**Depends on:** Phase 2 (renders the API's `locum_fields`)

Scaffold prompt line + "For locum supply" checklist in `public/clients.html` / `public/clients.js`, with insert-a-heading affordance and source-scan tests.

### Phase 4: Validation

Full suite + manual pass against a real note.

---

## STEP-BY-STEP TASKS

### UPDATE `src/note-fields.js` — add `LOCUM_FIELDS` and `locumFieldFor`

- **IMPLEMENT**: Append (below `visibleFields`, keeping the gate code untouched) a canonical vocabulary and matcher:

  ```js
  /**
   * The locum-supply vocabulary (#48, epic #45 slice 4). These are NAMES, not a schema: the
   * note stays one free-text blob and the recruiter still authors every heading. This list
   * exists so the editor can prompt for what locum supply needs recorded, and so #49/#50 can
   * find those sections again whatever exact words the recruiter chose.
   *
   * `heading` is the canonical form the editor inserts; each must survive `fieldKey` (a test
   * pins this). `match` runs against the HEADING TEXT, not the body — recognising a field from
   * its prose would be harvesting, which architecture §6.5 defers.
   */
  export const LOCUM_FIELDS = [
    { id: "credentialing", heading: "Credentialing quirks",
      hint: "What this client's compliance sign-off trips over.",
      match: /credential|compliance quirk/i },
    { id: "vms",           heading: "VMS or portal",
      hint: "Which VMS or portal bookings go through, and its quirks.",
      match: /\bVMS\b|portal/i },
    { id: "protocols",     heading: "Protocol expectations",
      hint: "Scanning protocols the department expects a locum to know.",
      match: /protocol/i },
    { id: "site-access",   heading: "Site access and parking",
      hint: "Getting in on day one: badges, parking, who to ask for.",
      match: /site access|parking|getting in/i },
    { id: "extensions",    heading: "Extension habits",
      hint: "How this client extends or ends bookings.",
      match: /extension|extends|rebook/i },
  ];

  /** The canonical locum field a heading names, or null. Pure, never throws. */
  export function locumFieldFor(heading) {
    const text = String(heading ?? "");
    const hit = LOCUM_FIELDS.find((f) => f.match.test(text));
    return hit ? hit.id : null;
  }
  ```

- **PATTERN**: pure-module discipline `src/note-fields.js:14-16`; coercion idiom `src/note-fields.js:92`.
- **GOTCHA 1**: match against the **heading**, not the section body — body-matching is harvesting (out of scope, §6.5).
- **GOTCHA 2**: keep `\bVMS\b` word-bounded and the others lowercase-tolerant; "portal" must NOT be so broad it matches the *candidate portal* — it runs only on note headings, which the recruiter writes about the client, so `portal` is acceptable there (document as known-and-accepted in a comment).
- **GOTCHA 3**: no import of `domain.js` — this module stays import-free.
- **VALIDATE**: `node --check src/note-fields.js`
- **SATISFIES**: AC "the note parser recognises the new headings as tickable fields" (they are named; tickability is already universal).

### UPDATE `test/note-fields.test.js` — vocabulary tests

- **IMPLEMENT**: a new section `// ── the locum vocabulary (#48) ──`:
  - each `LOCUM_FIELDS[i].heading` yields a non-null `fieldKey`, and the five keys are unique (canonical headings are tickable and cannot collide);
  - `locumFieldFor` recognises the canonical heading AND at least one synonym per field (`"VMS"`, `"Portal used"`, `"Parking"`, `"Credentialing"`, `"Protocols"`, `"Extension habits"`);
  - non-matches stay null: `"Their process"`, `"Why candidates were turned down"`, `"East Grinstead General Hospital"`, `""`, `null`, `undefined` — never throws;
  - recognition composes with the gate: a note containing `## VMS or portal` parses to a field whose `key` is tickable via `visibleFields` exactly like any other heading (no special-casing).
- **PATTERN**: `test/note-fields.test.js:31-48` (inline notes, leak-biased assertions, `assert.deepEqual`).
- **VALIDATE**: `node --test test/note-fields.test.js`
- **SATISFIES**: AC parser recognition; AC "existing notes unaffected" (non-match cases).

### UPDATE `src/store.js` — thread `locum_fields` through `clientWithFields`

- **IMPLEMENT**: import `locumFieldFor, LOCUM_FIELDS` alongside the existing `parseNoteFields` import (line 16). In `clientWithFields` (line 314), after building `fields`, compute:

  ```js
  const present = new Set(
    parseNoteFields(client.note).map((f) => locumFieldFor(f.heading)).filter(Boolean),
  );
  const locum_fields = LOCUM_FIELDS.map(({ id, heading, hint }) => ({
    id, heading, hint, present: present.has(id),
  }));
  return { client, fields, locum_fields };
  ```

  (Reuse the `fields` already parsed if convenient — `fields[i].heading` is available; a second `parseNoteFields` call is also fine, the note is small. Prefer reusing `fields` to avoid the double parse.)
- **PATTERN**: additive sibling key, `src/store.js:311-313`; the `match`/`RegExp` never crosses the wire — only `{id, heading, hint, present}` does.
- **GOTCHA**: `setFieldVisibility` (returns `clientWithFields(db, client.id)` at its tail) and both handlers in `functions/api/clients/[id].js` pick this up automatically — **do not** edit the Functions.
- **VALIDATE**: `node --test test/store.test.js`
- **SATISFIES**: threading to consumers; AC "candidate-visibility gating still routes through visibleFields" (untouched by construction).

### UPDATE `test/store.test.js` — the readout over a real store

- **IMPLEMENT**: alongside the existing `clientWithFields` tests (lines 339-365):
  - a note with `## VMS or portal` and `## Parking` → `locum_fields` has exactly five entries in `LOCUM_FIELDS` order, with `vms` and `site-access` `present: true`, the rest `false`;
  - the existing perm-shaped fixture note → all five `present: false`, and the `fields` array is **byte-identical to before this change** (existing notes unaffected);
  - `setFieldVisibility`'s return value carries `locum_fields` too (same shape as `clientWithFields`).
- **PATTERN**: `test/store.test.js:339-365`.
- **VALIDATE**: `node --test test/store.test.js`
- **SATISFIES**: AC existing-notes-unaffected; threading.

### UPDATE `public/clients.html` — the locum scaffold line and checklist block

- **IMPLEMENT**:
  1. Below the existing `scaffold-line` (line 80-81), a second one, locum-flavoured:
     `<p class="scaffold-line">For locum supply: credentialing quirks · VMS or portal · protocol expectations · site access and parking · extension habits</p>`
  2. After the visibility `</fieldset>` (line 106) and before `.editor-remove` (line 111), a new fieldset mirroring the visibility block's structure:

     ```html
     <fieldset class="visibility locum" id="locum" aria-describedby="locum-hint">
       <legend class="field">For locum supply</legend>
       <p class="field-hint" id="locum-hint">Bookings move faster when the note records these.
         Add a missing one and write what you know, then save.</p>
       <ul class="visibility-list" id="locum-list"></ul>
       <p class="save-state" id="locum-state" role="status"></p>
     </fieldset>
     ```
- **PATTERN**: the visibility fieldset `public/clients.html:98-106` (fieldset + legend + `aria-describedby` hint + list + own live region); scaffold idiom lines 77-81.
- **GOTCHA**: reuse the `visibility-list` / `save-state` classes so no new CSS is required; if any spacing rule is needed, add a minimal `.locum` rule to `public/app.css` only after checking the rendered page (`dossier-design` skill's CHECKLIST.md applies if CSS is written).
- **VALIDATE**: `node --test test/counts.test.js` (nav gate still passes) and the new source-scan test below.
- **SATISFIES**: AC "recruiter-facing note editor surfaces the new fields".

### UPDATE `public/clients.js` — render the checklist from server truth

- **IMPLEMENT**:
  1. `COPY` additions: `locumPresent: "In the note"`, `locumMissing: "Not in the note yet"`, `locumAdd: function (heading) { return "Add ## " + heading + " to the note"; }` (wording final call at implementation, keep the register — plain, action-first).
  2. `el` additions: `locumList`, `locumState` (the `locum-state` region is reserved for future use or messages; empty is fine at first paint).
  3. A `renderLocum(locumFields)` sibling to `renderFields`: for each of the five, an `<li>` with the heading (`textContent`), its hint, and either the present marker or — when missing — a small button (`type="button"`, `data-heading`) that appends `"\n\n## " + heading + "\n"` to `el.note.value`, calls `markDirty()`, and focuses the textarea with the caret at the end. Present/missing is server truth about the SAVED note; inserting only dirties the editor, and `markDirty` already shows `visibilityStale` — the checklist row flips to present only after Save, which is consistent with how the visibility list behaves.
  4. Thread it through the existing paints: `paintFields(fields, seen)` becomes `paintFields(body, seen)` (or gains a third argument — choose whichever keeps the four call sites at lines 341, 400, 525, 583 smallest) and calls `renderLocum(body.locum_fields)` next to `renderFields(body.fields)`. **Every** call site paints both lists from the same response under the same `fieldsVersion` check — the checklist must never paint from a response the visibility list rejected as stale.
  5. One delegated `click` listener on `el.locumList` (mirror of the `change` listener on `el.visibilityList`, line 688-692) — the list is rebuilt on every paint, so per-row listeners would leak.
- **PATTERN**: `renderFields` `public/clients.js:435-492` (rebuild, `textContent`, focus restoration if a button was focused); recency guard 494-509; delegated listener 686-692; COPY register 32-88.
- **GOTCHA 1**: do not touch `state.dirty` beyond `markDirty()` — the insert is an ordinary edit.
- **GOTCHA 2**: no browser storage of any kind, and do not name the storage APIs even in comments — `test/counts.test.js:64`'s grep gate scans this file.
- **GOTCHA 3**: `body.locum_fields` may be `undefined` if a stale server build answers — `renderLocum(list || [])` and render nothing, never throw.
- **VALIDATE**: `node --check public/clients.js` then the source-scan test below.
- **SATISFIES**: AC editor surfacing.

### UPDATE `test/counts.test.js` (or the nearest source-scan home) — gates over the new UI

- **IMPLEMENT**: extend the existing source-scan section with:
  - `public/clients.html` contains `id="locum-list"` and the locum scaffold line's five phrases;
  - `public/clients.js` references `locum_fields` and contains no `innerHTML` (whole-file assertion, matching the existing storage-API gate style);
  - the storage-API gate at `test/counts.test.js:64` still passes unmodified.
- **PATTERN**: `test/counts.test.js:60-95`.
- **VALIDATE**: `node --test test/counts.test.js`
- **SATISFIES**: AC editor surfacing, regression guard.

### Manual pass — the running screen

- **IMPLEMENT**: `npm run dev`, open `/clients`, then: pick a client with the spike-shaped perm note → checklist shows five missing, visibility list unchanged; click "Add" on VMS → heading appears in textarea, state says Unsaved; Save → the VMS row flips to present and its section appears in the visibility list, tickable; delete the heading and Save → row flips back to missing and any tick is pruned (existing prune, observe only).
- **VALIDATE**: eyes on screen; no console errors.
- **SATISFIES**: end-to-end acceptance.

---

## TESTING STRATEGY

### Unit Tests

House style: `node --test`, one test file per src module, inline fixtures, leak-biased. Extended files: `test/note-fields.test.js` (vocabulary + matcher), `test/store.test.js` (readout shape over the real-sqlite store).

### Integration Tests

`test/store.test.js` already drives the real store; the `setFieldVisibility → clientWithFields` return-shape test is the integration seam. `public/clients.js` is a non-module IIFE — behaviour is covered by source-scan gates plus the manual pass, per the established pattern (`test/counts.test.js`).

### Edge Cases

- A heading matching two vocabulary regexes → first match wins (list order is precedence); pin with a test if any two regexes can overlap.
- `## VMS or portal` inside a ``` fence → parses as a field (documented note-fields behaviour) and would read as present; fail-closed direction (over-prompting never happens, over-satisfying is cosmetic) — document, don't solve, matching the module's existing stance.
- Duplicate locum headings (`## Parking` twice) → present is still true; the visibility list already explains untickability; no special handling.
- Unicode/CRLF headings → `locumFieldFor` runs on the raw heading text which `parseNoteFields` has already trimmed; add one CRLF case to the matcher tests.
- Old client with no note (`""`) → five missing, no throw.

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style

```bash
node --check src/note-fields.js && node --check src/store.js && node --check public/clients.js
```

(No linter/formatter/build in this repo — deliberate; do not add one.)

### Level 2: Unit Tests

```bash
node --test test/note-fields.test.js test/store.test.js test/counts.test.js
```

### Level 3: Integration Tests

```bash
npm test   # the whole suite — zero failures; seam/smoke/schema/prep-* untouched proves the blast radius held
```

### Level 4: Manual Validation

```bash
npm run dev   # then the manual pass scripted in STEP-BY-STEP TASKS above, at /clients
```

### Level 5: Additional Validation (Optional)

`rg -n "locum" src/prompt.js src/generate.js src/pack.js src/prep functions/` → only pre-existing hits (slice 1's prompt block); this slice must add none there.

---

## ACCEPTANCE CRITERIA

- [ ] AC1 — `src/note-fields.js` exports `LOCUM_FIELDS` (the five fields) and `locumFieldFor`; canonical headings slug cleanly and are tickable like any heading.
- [ ] AC2 — Candidate-visibility gating still routes through `visibleFields(note, keys)`; the gate's code and tests are unmodified (a bug of omission must hide, never leak).
- [ ] AC3 — `/api/clients/:id` (GET and both PUT paths) carries an additive `locum_fields` readout; `client` and `fields` shapes are byte-identical for existing notes.
- [ ] AC4 — The `/clients` editor surfaces the five fields: scaffold prompt line + present/missing checklist with insert-a-heading.
- [ ] AC5 — Existing notes unaffected: the full suite passes with zero edits to `test/seam.test.js`, `test/smoke.test.js`, `test/schema.test.js`, and the visibility-gate tests.
- [ ] All validation commands pass with zero errors; no browser-storage APIs introduced; no `innerHTML`.

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order, each task's VALIDATE run immediately
- [ ] `npm test` fully green
- [ ] Manual pass on `/clients` done against a real-shaped note
- [ ] No changes outside `src/note-fields.js`, `src/store.js`, `public/clients.html`, `public/clients.js`, `public/app.css` (only if needed), tests
- [ ] Comments match each file's existing density and register
- [ ] PR references `Closes #48`

---

## OPEN QUESTIONS / ASSUMPTIONS

- **A1 — The checklist shows for every client, ungated.** The ticket says slice 1's role-shape flag exists "to know when to surface these fields", but role shape is a brief property and the editor has no brief. Gating would need a per-client role-shape column (schema change — out of scope) or threading the last brief's profile (invented coupling). Decision: surface always, titled "For locum supply" so perm readers skip it; #49/#50 branch on `role_shape` at generation time. **If the intent was per-client gating, that's a schema conversation — flag before implementing.**
- **A2 — Canonical headings and hints wording** is drafted above in the recruiter's plain register; final wording may be adjusted at implementation but the five ids (`credentialing`, `vms`, `protocols`, `site-access`, `extensions`) are the stable contract #49/#50 will import.
- **A3 — Vocabulary lives in `note-fields.js`, not `domain.js`.** The ticket names note-fields.js as the seam; the matcher operates on note headings, which is this module's domain, and it keeps domain.js brief-only. #49/#50 import from both.
- **A4 — No per-field `locum` annotation on the `fields` array.** Nothing consumes it yet; #49/#50 run server-side and can call `locumFieldFor` directly. Adding wire surface with no reader is YAGNI; trivially additive later.

## NOTES (open canvas)

**Why a server-computed checklist instead of a client-side one:** `public/clients.js` cannot import `src/note-fields.js` (no build step; `public/prep/registry.js:41` documents that an import of `../../src/...` 404s at runtime). The alternatives were duplicating the vocabulary in the browser (the registry's `BRIEF_BLOCK_NAMES` precedent — accepted but drift-prone) or threading it through the API the fields already ride. The API already returns `{client, fields}` from a single function on all three paths, so the server-computed readout is both the smaller change and the single-source-of-truth one.

**Why not insert-with-body templates:** inserting `## Credentialing quirks` followed by a scaffold sentence would be the tool writing the note, which drifts toward the harvesting/no-invented-fields line. A bare heading keeps the recruiter as sole author.

**Rejected: making `locumFieldFor` key-based** (matching `fieldKey(heading)` slugs instead of heading text). Slugs collapse punctuation usefully, but synonyms ("VMS", "Portal used") need regexes anyway, and running on the raw heading keeps the matcher independent of the slug function's truncation edge cases.

**Sequencing risk — parallel sessions share this worktree** (memory: HEAD moves under you). Verify the branch before committing; this ticket gets its own branch off `origin/main` — PR #51 (all of #46 including the review fixes) is merged, verified 2 Aug 2026: `git log origin/main..HEAD` is empty on `feat/imaging-domain-vocabulary`.

## AMENDMENTS

- (none yet)
