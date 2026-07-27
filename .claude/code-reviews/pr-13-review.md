# Code review — PR #13 · `feature/client-knowledge-store` → `main`

**Recommendation: REQUEST CHANGES.**

No Critical issues. **Six High**, and five of the six cost the agency its note — the one asset
architecture §4 says this product exists to protect. None is hard to fix; the front-end ones
share a single root cause.

**How this review was produced, stated plainly.** The same session wrote this code, so the
fresh-eyes property comes from three independent reviewers dispatched into clean contexts —
one on the store/HTTP/Functions layer, one on the browser surface, one on the scripts, tests
and docs. No `code-reviewer` agent is defined on this machine, so general-purpose agents were
briefed to that standard. **Every High finding below was then re-verified against the source
by hand, and the 360px one was re-measured**, because a review that only relays subagent claims
is not a gate. Two reviewers independently planted the same breach in the schema guard and got
the same silent pass.

Documented deviations in `.claude/reports/client-knowledge-store-report.md` were treated as
intentional decisions, not findings. One is disputed below and labelled as such.

---

## Validation

| Check | Result |
|---|---|
| `npm test` — Node v20.20.2 | **52 / 52 pass** |
| `npm test` — Node v24.11.0 | **52 / 52 pass** |
| Level 1 gates (all nine) | all `ok`, confirmed independently by a second run |
| Live server smoke — 7 routes | all `200`, correct content types |
| End-to-end round trip | create `201` · note byte-exact `'  leading\n\ntrailing  \n'` · event `201` · `packs: 1` visible |
| Deployed preview matches HEAD | `a53ce66` = branch HEAD ✓ |
| Fallback rung claim | rung zero confirmed structurally — `functions/` at repo root, `../../src/` imports intact, no `_routes.json`, no `functions/_lib/` |
| Type-check / lint / build | none in this project **by design** — the plan forbids adding them; the greps are the gate |

**The suite being green is not evidence the boundary holds** — see H4.

---

## High

### H1 · A stale `GET` overwrites a different client's note — `public/clients.js:162-191`

`load(id)` sets `state.selected = id` *before* its fetch, and the `.then` never re-checks it.
Two overlapping loads resolve in arrival order, not click order.

**Failure:** click client A, then client B a moment later. A's response lands second → the
editor shows **A's name and A's note** while `state.selected === B`. Type one word, press
**Save note** → `PUT /api/clients/<B>` carrying A's text. **B's note is destroyed**, and
Decision 5 forbids any browser-side copy, so it is unrecoverable.

**Fix:** capture `var reqId = id`; bail out of both `.then` and `.catch` when
`state.selected !== reqId`.

### H2 · Typing during a save is silently discarded, and `beforeunload` is disarmed — `public/clients.js:203-214, 291-293`

The payload is snapshotted at `:203`; the success handler sets `state.dirty = false`
**unconditionally**. The textarea is never disabled, so keystrokes during the round trip are
real edits that were never sent — and the `input` listener (`if (!state.dirty) markDirty()`)
cannot re-dirty, because `dirty` is still `true` while in flight.

**Failure:** type, click **Save note**, keep typing while it is in flight. Screen reads
"Saved 14:32", `state.dirty === false`, close the tab → **no warning, keystrokes gone.** Direct
failure of the CHECKLIST MUST *"navigating away with unsaved input warns first"*.

**Fix:** `var sent = el.note.value` at send time; on success
`state.dirty = (el.note.value !== sent)` and only show "Saved HH:MM" when they match. Do **not**
fix by disabling the textarea — that trips H-adjacent focus loss (M8).

### H3 · Two of three entry points discard a dirty note with no confirm — `public/clients.js:284, 305-307`

The `window.confirm` guard exists **only** on the row click (`:125`). Both other paths into
`load()` skip it, and `load()` then clears `dirty` and overwrites the textarea from the server.

**Failure 1:** mid-note, type a name in the rail form, click **Add client** → in-progress note
replaced by the new client's empty note. No confirm, no recovery.
**Failure 2:** mid-note, press browser **Back** → same silent replacement. `beforeunload` does
not fire for same-document history navigation, so nothing catches it.

**Fix:** move the dirty check into `select()` and into the `popstate` handler (re-push the
current entry if the user declines).

### H4 · The boundary guard is blind on the only path by which the boundary would actually move — `test/schema.test.js:24`

`readFileSync(join(root, "migrations/0001_init.sql"))` — one file, hardcoded. You never edit an
applied migration, so **a new migration file is the only realistic way `events` gets widened**,
and that path has no coverage.

**Two reviewers proved this independently**, each planting the plan's own threat model:

```sql
-- migrations/0002_probe.sql
ALTER TABLE events ADD COLUMN candidate_ref TEXT;
CREATE TABLE candidates (id TEXT PRIMARY KEY, cv TEXT);
```

→ **suite passes 5/5.** Completely invisible. The Level 1 grep
(`grep -ci '^CREATE TABLE' migrations/0001_init.sql`) is hardcoded to the same single file and
also still passes. A control — an unquoted fourth table in `0001` — correctly fails 2 tests, so
the guard does bite for the plain case.

What makes this High rather than a nitpick is that **two durable artefacts assert the opposite**:

- `migrations/0001_init.sql:5-6` — *"There is no candidate table … and test/schema.test.js
  **fails if a later ticket adds one**."*
- `README.md:63-64` — *"parses that file and fails the suite on a fourth table or a fifth
  `events` column."*

Both false for the normal way schema is added. The test's own header names #6 and #8 as the
tickets that will widen `events`.

**Fix:** glob `migrations/*.sql`, sort, concatenate, then parse; change the Level 1 gate to
`migrations/*.sql`. See M5 for the regex holes in the same file — fix together.

### H5 · The docs assert a state of the world that is not true — `DEPLOY.md:204`, `README.md:12-13, 24`

`## 5. D1 … · ✅ DONE 27 Jul 2026` — but that section's own fast path includes
`npm run db:remote`, which the implementation report states has **deliberately not been run**;
`dossier-engine` has no schema. In this repo `✅ DONE <date>` means verified-done (that is how
§§2-4 use it). Same defect in `README.md:24` *"**The client knowledge store is live**"* and
`:12-13` *"Live at … with Pages Functions over a D1 database"* — production still serves the
pre-#5 static deployment.

**Failure:** whoever merges reads `✅ DONE`, skips the migration, runs `./scripts/deploy.py` →
every `/api/*` answers `500`. That is the exact row in **this section's own failure table**
(`DEPLOY.md:264`), against **its own closing warning** (`:266`).

The report's *Not done, and why* is accurate; the problem is that the durable docs contradict
it, and the docs are what the merger reads.

**Fix:** `## 5. D1 … · ⚠️ PARTIAL — bindings done 27 Jul 2026; production migration pending
(32b)`, and make the README's two claims conditional on 32b.

### H6 · 1,338px of horizontal overflow at 360px, from the product's own add-client field — `public/app.css`, `public/clients.js:177`

`clients.html:34` accepts a 120-character name with no whitespace requirement; `clients.js:177`
puts it in the `h2`; `app.css` has **no `overflow-wrap` / `word-break` anywhere**.
`.editor { min-width: 0 }` stops the grid *track* stretching but does nothing about text
overflowing its box.

**Measured on the branch, not argued:**

```
viewport=360  scrollWidth=1698  overflow=1338
```

CHECKLIST MUST: *"responsive to 360px; no horizontal page scroll ever."*

**This corrects a claim in the implementation report and in the PR body.** The report states
360px was measured clean — it was, using the seeded name "Ashdown Park Community Healthcare",
which contains spaces and wraps. The measurement was honest; the conclusion drawn from it was
broader than the evidence. Worth recording *why* the original probe missed it: overflowing text
does not widen its element's border box, so every `getBoundingClientRect()` came back inside
the viewport while `scrollWidth` blew out. The probe was measuring the wrong thing.

**Fix:** `overflow-wrap: anywhere` on `#editor-head`. (`.client-name` is already correct —
nowrap + ellipsis.)

---

## Medium

### M1 · A JSON body of literal `null` answers `500` on all four mutating endpoints — `src/http.js:17`

`null` is valid JSON, so `readJson` passes it through, and `= {}` defaults only fire for
`undefined`. Executed against all four handlers: `POST /api/clients`, `PUT /api/clients/:id`,
`PUT /api/agency`, `POST /api/events` → `500 {"error":"internal"}`. Bodies of `[]` and `42`
answer `404` for the same root cause.

On this project **500 means deployment fault** — `DEPLOY.md`'s triage table says so, and a
schemaless production DB is described as making "every `/api/*` answer 500". A caller-fault
body polluting that signal is worth one line. `functions/api/clients/[id].js`'s own header says
*"a bare 500 where the truth is 404 or 400 makes that impossible"*.

**Fix, one place not four:** in `readJson`, after parsing —
`if (!body || typeof body !== "object" || Array.isArray(body)) throw new StoreError("bad_json", 400);`

### M2 · The events path reads the note, and the test that forbids it cannot see the query — `src/store.js:239`, `test/store.test.js:205`

`recordEvent` calls `getClient` purely as an existence check; `getClient` selects the whole row.
Executed SQL for one `POST /api/events`:

```
SELECT id, name, note, created_at, updated_at FROM clients WHERE id = ?
INSERT INTO events (client_id, duration_ms) VALUES (?, ?)
```

The test filters with `/events/i.test(c.sql)`, so that SELECT is excluded **by construction**.
The assertion named *"no events SQL mentions a name, a candidate, a cv or a note"* — R5 layer
two — asserts less than its name claims. Secondary: every recorded pack drags up to
`NOTE_MAX` (100,000 chars) of personal data across the wire to learn a boolean.

**Fix:** `SELECT id FROM clients WHERE id = ?` with `.first("id")`; widen the test's filter to
every call issued during the event path, which also makes the test's name true.

### M3 · List-load and add-client errors are written into a `hidden` subtree — `public/clients.js:138, 271`; `public/clients.html:43, 53`

`#save-state` lives inside `<div id="editor-body" hidden>` and belongs to the note-save
lifecycle, but `refreshList()` and the add-client form write user-facing errors into it.

- **On `/clients` with no `?client`**, a failed list load is **invisible and unannounced** — a
  `role="status"` inside a hidden subtree is not in the accessibility tree. The user sees an
  empty rail and a neutral prompt. (The report's R9 evidence was gathered *with* a client
  selected, which is why this path was not caught.)
- **"Enter a client name."** renders into the same hidden node. `required` on the input means
  the native bubble preempts it for a truly empty field, so the copy-deck string only fires for
  whitespace-only input — and is invisible when it does.

**Fix:** a live region inside the rail for list and add-form errors.

### M4 · A successful save can report "Could not save" — `public/clients.js:138, 205-214`

`refreshList()` swallows its own error rather than propagating. Sequence: dirty cleared →
"Saved 14:32" shown → `refreshList()` fails → `showSaveState("Could not save…", true)`. The
note **was** saved and the screen says it was not, with `state.dirty === false` underneath.

### M5 · `test/schema.test.js:33` — an unparseable `CREATE TABLE` is invisible rather than an error

Any statement the regex cannot match is never added to `found`, so it is **absent from** the
"exactly agency, clients, events" set instead of failing it. Proven to pass: `CREATE TABLE
"candidates" (…)`. The same class: backtick/bracket quoting, `main.candidates`,
`CREATE TEMP TABLE`, `CREATE TABLE … AS SELECT`. Nothing outside a `CREATE TABLE` body is
examined, so `ALTER TABLE events ADD COLUMN role_title TEXT` also passes — and evades the
Level 1 `candidate|resume` grep too, since neither word appears.

**Fix (closes the class, rather than chasing regexes):**
```js
assert.equal(parsed.length, (code.match(/CREATE\s+TABLE/gi) ?? []).length,
  "a CREATE TABLE the parser could not read is invisible, not an error");
assert.equal((code.match(/ALTER\s+TABLE/gi) ?? []).length, 0,
  "schema changes must go through CREATE TABLE, which this file parses");
```

### M6 · The §5 fast path is not runnable by the second agency — `DEPLOY.md:214-219`, `scripts/setup-d1.py:46-49`, `scripts/dev.py:42-45`

The runbook says `d1 create dossier-<agency>`; both scripts **hardcode** `dossier-engine` /
`dossier-engine-preview`, and §5 never says to edit them. Agency #2 gets
`sys.exit("no D1 database named dossier-engine…")`, then the identical failure from
`npm run db:remote`. Plan task 30's VALIDATE: *"every command copy-pasteable, every per-agency
value marked"*.

There is an architectural half. `README.md:136` lists both scripts as **Engine — shared by
every agency**, and `:142-144` says of the databases *"nothing about it is in this repo"*. The
**ids** are not; the **names** are, in two engine files. Onboarding agency #2 therefore means
editing tracked engine files — the "forks an engine file per agency" failure Decision 3 exists
to prevent, reintroduced one layer down.

**Fix:** `os.environ.get("DOSSIER_D1_NAME", "dossier-engine")` (and `…_PREVIEW`) in both
scripts, plus one line in §5.

### M7 · `messageFor` has no case for `not_configured`, which fires on first paint — `public/clients.js:80-87`

Covered: `session_expired`, `too_long`, `not_found`, `missing_fields`. Uncovered and **very
reachable**: `not_configured` (503) is the plan's own R1 failure — a missing `DB` binding — and
it fires on load before the user does anything. The screen then says *"Could not save. Your
text is still here. Try again."* when nothing was being saved and there is no text. Same
save-specific fallback lands in `load()`'s and `loadAgency()`'s catches.

**Fix:** add a `not_configured` message and a read-path default that is not save copy.

### M8 · Disabling the focused button drops focus to `<body>` — `public/clients.js:197, 276`

A keyboard user presses Enter on **Save note**; `disabled = true` moves focus to the document
body in every engine, and re-enabling does not return it. Their place in the tab order is lost
on every save, and the "Saving…" label change is never announced. Same on **Add client**.
Related: rebuilding the list (`:100`) destroys the focused row, so keyboard selection also drops
focus to `<body>`.

**Fix:** `aria-disabled` + an early return, or restore focus in the final `.then`; reconcile
list rows in place or restore focus to the row matching `state.selected`.

### M9 · A save resolving after a client switch reports against the wrong client — `public/clients.js:205-220`

`save()` closes over nothing. Switch client while a PUT is in flight → on success, B's editor
reads "Saved 14:32" although B was never saved; on failure, `state.dirty = true` is set for
**B**, which has no unsaved edits, so `beforeunload` warns spuriously thereafter.

**Fix:** capture `var savingId = state.selected`; no-op both handlers when it no longer matches.

### M10 · Touch targets below CRAFT's floor, and the comment asserts a check that did not happen — `public/app.css:93-94, 335-342`

The comment reads *"44px on touch"* but `--space-8` is **32px**, and the button's real height is
**39px**. The radio labels are `display: flex` with no padding or min-height → ~21px, below the
≥24px minimum anywhere. Either fix the value or fix the comment.

### M11 · `scripts/deploy.py:121` — the no-argument path's output did change

*Documented as deviation 6, and I disagree with the framing:* the deviation justifies the change
for branch builds but does not acknowledge it also altered the **no-argument** path, which the
docstring at `:19` promises *"behaves exactly as it always did"*. `d.get('url')` returns a
per-deployment hash hostname for production builds too, so `./scripts/deploy.py` at 32b prints
a hash hostname instead of the production apex the runbook then asks you to curl. Not exposure
— the `*.pages.dev` Access application covers hash hostnames — but confusion at exactly the
step where R1 closes on production.

Everything else about the no-arg path is genuinely unchanged: `sys.argv[2]` defaults to `main`,
the `git rev-parse` is byte-identical, the POST still sends `branch: "main"`.

**Fix:** print the apex when `branch == "main"`, or narrow the compatibility sentence.

---

## Low

- **L1** `src/store.js:240` — `duration_ms` has no upper bound. `Number.isInteger(1e21)` is
  true; executed, it lands as `real` in an `INTEGER` column (SQLite affinity) and
  `SUM(duration_ms)` across the table becomes permanently `1.79e308`. One bad event poisons the
  metric this ticket exists to create. Add `<= Number.MAX_SAFE_INTEGER` at minimum.
- **L2** `src/store.js:207` — `updateAgency` silently truncates `name` to 120 chars while
  `cleanName` throws `too_long` for the same concept. Two validation vocabularies in one module.
- **L3** `src/store.js:239-242` — `recordEvent` checks the client before the duration, so a
  request with both wrong reports `not_found` and hides the malformed field.
- **L4** `src/http.js` has **zero test coverage**. `sameOrigin` is the CSRF bolt behind
  Decision 2, is a pure function with no D1 dependency, and is the cheapest thing here to test.
  (Verified correct by hand across seven header combinations.)
- **L5** `src/store.js:197` — `not_configured`/503 means two different faults with two different
  remedies (missing binding vs missing agency row); `DEPLOY.md:261` maps it to the binding one.
  A distinct `not_migrated` would fix the triage.
- **L6** `test/helpers/fake-d1.js:24-49` — the fake never relates bound args to the statement's
  `?` placeholders, so a mismatched bind passes every test and fails in production.
- **L7** `test/store.test.js:205` — the forbidden-column loop has no non-empty guard. Not
  vacuous today (confirmed: 2 matching calls), but a table rename would silently disarm AC4's
  strongest assertion.
- **L8** `scripts/dev.py:102-120` — the generated TOML does not escape `ROOT`; a checkout path
  containing `"` or `\` produces a wrangler parse error naming the generated file, not the cause.
  `json.dumps(path)` fixes it.
- **L9** `README.md:71-73` — *"the amendment **above** forbids"* points the wrong way and
  contradicts `:51`'s correct *"see the entry below"*. This is the one place plan task 29's
  VALIDATE says to read end to end.
- **L10** `DEPLOY.md:309` — *"**placeholder page** renders"* is stale; the item four lines above
  was updated and this one was not.
- **L11** `public/clients.js:254, 36` — the agency strip's **"Saved"** and `COPY.leaving` are
  visible copy not in the plan's copy deck and not in the deviations list. Both reasonable;
  both undocumented.
- **L12** `public/clients.html:40, 45` — `aria-labelledby="editor-head"` points at an `h2` that
  is empty until a client resolves, so the section has no accessible name on load.

---

## Checked hard, and clean

Absences are results too. All executed or read in full, not assumed:

- **No XSS.** Every DOM write is `textContent`, including the error paths. No `innerHTML`, no
  `insertAdjacentHTML`, no template-literal-into-DOM anywhere.
- **Data posture holds.** No local/session storage, cookies or IndexedDB. `pushState` and every
  fetch carry ids only; `document.title` is static. Decision 5 intact.
- **No SQL injection is reachable.** `updateClient`/`updateAgency` push string *literals* from
  fixed `if` branches; `Object.hasOwn` is only ever a presence test on a hardcoded key. No
  caller-supplied key can reach a SQL string on any constructed input.
- **`listClients` never selects the bare `note`**, and the test strips `LENGTH(...)` before
  asserting — the correct way to write that assertion.
- **`cleanNote` does not mutate.** Byte-identical across leading spaces, blank lines, trailing
  spaces and a curly quote — correct, since `src/provenance.js` matches verbatim spans later.
- **`POST /api/events` cannot orphan a row.** `getClient` throws first and the FK rejects
  independently; no delete path exists, so no race window.
- **The `unexpected_fields` guard** correctly rejects `candidate_name` **and** `__proto__`
  (`JSON.parse` makes it an own enumerable key). Bypassed by non-object bodies (M1), but nothing
  can be written through the bypass — the INSERT is a fixed two-column statement.
- **D1 API usage is correct throughout** — `.all()` → `{results}` with `?? []`, `.first()` as
  row-or-null, `.run()` never read for rows, every call awaited.
- **`sameOrigin` is applied to exactly the four mutating handlers and no GET**, and is correct
  across seven header combinations.
- **Motion rules clean** — no `transition: all`, no ease-in on entrances, no animation on
  rebuilt nodes, reduced-motion block present.
- **`errorResponse` leaks nothing**; `params.id` coercion is sound.
- **Scripts**: no third-party imports, no unused imports; `--migrate-remote` parsing, Node
  discovery and `os.execvpe` all correct; `setup-d1.py`'s idempotence, delta PATCH and survival
  check all sound, and `IGNORED_ON_COMPARE` does not hide a genuine replace.
- **`package.json`** added four script lines and nothing else; `test` left exactly as `055ef72`
  fixed it; no `engines` field. `wrangler.toml` gained no `[[d1_databases]]`.
- **`test/helpers/fake-d1.js` is correctly not collected** as a test by the glob.
- **No undocumented divergence from the plan** in the store/HTTP/Functions layer.

---

## Done well

1. **Errors carry their HTTP shape.** `StoreError(code, status)` means `errorResponse` maps
   rather than guesses — which is why every handler is four lines, and why R8's "precise enough
   for the screen to keep the text" is met everywhere except M1's `null` hole.
2. **Security properties are asserted where they are actually visible.** The injection test runs
   `Robert'); DROP TABLE clients;--` through create *and* update, then asserts against the
   **recorded SQL**. Asserting on a query result would have proved nothing.
3. **Absent-vs-empty is right and pinned.** `Object.hasOwn` throughout, with tests proving
   `{note: ""}` binds `""` and a name-only update emits no `note` write. On the surface that
   *is* the product, this is the bug that would have hurt most.
4. **`api()` checks the content type, not just `res.ok`** — Access answering a fetch with
   sign-in HTML at 200 is exactly what a normal `res.ok` check misses, fixed in the one place
   all six call sites pass through.
5. **The plan's PATTERN note pointed at template literals for markup; the implementation went
   the other way** — `createElement` + `textContent` everywhere, including paths that only carry
   constants. Deviating in the safe direction on the one file that renders agency-authored text.
6. **`getAgency` refuses to paper over a broken deployment**, with a test asserting no
   `INSERT INTO agency` is ever issued. Inserting the missing row was the tempting, wrong fix.
7. **`cleanRenderer` reads `RENDERERS` rather than a literal set**, so #9's `.docx` renderer
   needs no change to the store or the test.
8. **`setup-d1.py`'s delta PATCH plus survival check** is strictly stronger than the plan asked
   for, and is what actually established that the Pages PATCH merges.
9. **`scripts/dev.py`'s single resolution path** with `--persist-to` and an absolute
   `migrations_dir` both explicit rather than agreeing by accident; the `flush=True` reasoning
   about `execvpe` discarding buffered stdout is the difference between R4 being closed and
   merely looking closed.

---

## One structural note for #8

The focus hairline rides on `box-shadow` (`app.css:71`) — a property components legitimately
use. That is precisely why it broke on `.client-row[aria-current]` and needed the restatement at
`:225-228`. **The next focusable component that sets `box-shadow` kills the ring again,
silently.** Not a defect in this PR; a trap worth designing out before #8 adds components.

---

## Recommendation

**Request changes.** Fix H1-H3 together — they share one root cause (state mutated at
request-initiation time, with the dirty guard bolted to one of three entry points) and fixing
them individually will reintroduce each other. H4 and H5 are each a few lines. H6 is one CSS
declaration.

Then re-run `npm test` on both Node versions, re-measure 360px **with a long unbroken client
name**, and re-deploy the preview.

Nothing here suggests the approach is wrong. The store, the schema, the boundary guards at the
endpoint layer and the deployment work are sound; the defects are concentrated in async
sequencing on one file and in two documentation claims that outran the facts.
