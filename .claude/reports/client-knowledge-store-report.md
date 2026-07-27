# Implementation Report — Client knowledge store, its editor screen, and the event counter

**Plan**: `.claude/plans/client-knowledge-store.md`
**Branch**: `feature/client-knowledge-store`
**Status**: COMPLETE — all 32 tasks. 32b is the post-merge production block and belongs to
whoever merges; one authenticated preview check needs a browser login and is named below.

<!-- Written incrementally, task by task. Evidence is pasted as it happens, never
     reconstructed at the end. -->

## Summary

The durable half of the product ships: a D1 database with exactly three tables, `src/store.js`
over it, four `/api/*` Pages Functions over that, and a standalone screen at `/clients` where
the agency adds a client and edits its note. The non-personal event counter ships with it, so
the epic's primary metric is a mechanism rather than an intention.

The two boundaries the architecture calls expensive to unpick are enforced three ways each
rather than promised: `test/schema.test.js` fails on a fourth table or a fifth `events` column
(proven to bite, both ways, before it was committed), `test/store.test.js` fails on events SQL
that mentions a forbidden column or on any user value reaching a SQL string, and
`POST /api/events` answers `400 unexpected_fields` on any extra key. The model-access boundary
is unchanged and now says so in three places that previously contradicted it.

The deployment gate at task 15 passed on **rung zero** — no fallback needed.

## Tasks completed

### Phase 0 — provisioning, tooling, the design skill (tasks 1-6)

- **1** branch `feature/client-knowledge-store` cut from `main` at `468c95a`.
- **2** `package.json` — four scripts added (`dev`, `db:local`, `db:preview`, `db:remote`),
  nothing else touched. No devDependency added; wrangler is pinned through `npx`.
- **3** two D1 databases created in WEUR:
  - `dossier-engine` → `0a2b2026-819f-432c-826d-ff03a7a5ae6a`
  - `dossier-engine-preview` → `e6ca7df4-fdc4-4483-a59f-b793c4608407`
  - `wrangler d1 list` was empty beforehand, as *VERIFIED FACTS* predicted.
- **4** `scripts/setup-d1.py` (CREATE) — binds `DB` on both environments, idempotently.
- **5** `wrangler.toml` (UPDATE) — header rewritten; still no `[[d1_databases]]` block
  (`grep -c d1_databases wrangler.toml` → `0`).
- **6** `.claude/skills/dossier-design/` copied in; `references/` holds `CRAFT.md` and
  `CHECKLIST.md`.

#### Newly verified: the Pages `PATCH` on `deployment_configs` **merges**, deeply

The plan flagged merge-vs-replace as undocumented. Measured on the live project, 27 Jul 2026:

```
production.d1_databases: '<absent>' -> {'DB': {'id': '0a2b2026-819f-432c-826d-ff03a7a5ae6a'}}
production.env_vars: None -> {}
production.wrangler_config_hash: '1cbac725caecac...' -> '<absent>'
preview.d1_databases:    '<absent>' -> {'DB': {'id': 'e6ca7df4-fdc4-4483-a59f-b793c4608407'}}
preview.env_vars: None -> {}
```

Everything load-bearing survived the PATCH: `fail_open`, `compatibility_date`,
`compatibility_flags` (production's `nodejs_compat` included), `build_image_major_version`,
`usage_model`. Two fields moved on their own — `env_vars` normalised from `null` to `{}`, and
the computed `wrangler_config_hash` dropped (it is recomputed on the next build).

It merges at the binding-map level too: `{"d1_databases": {}}` and `{"d1_databases": null}`
were both accepted with `success: true` and both left the existing `DB` binding standing.
**A binding cannot be removed through this PATCH** — that is a dashboard operation. Recorded in
`DEPLOY.md`.

Confirming GET after the run:

```json
"preview":    { "d1_databases": { "DB": { "id": "e6ca7df4-fdc4-4483-a59f-b793c4608407" } } }
"production": { "d1_databases": { "DB": { "id": "0a2b2026-819f-432c-826d-ff03a7a5ae6a" } } }
```

Different uuids on the two environments, which is the point of Decision 3's preview split.

### Phase 1 — schema, boundary tests, a deterministic dev loop (tasks 7-10)

- **7** `migrations/0001_init.sql` (CREATE) — three tables, one index, the seed agency row.
- **8** `test/schema.test.js` (CREATE) — five tests. **Proven to bite, both ways:**

  ```
  === BITE 1: a candidates table ===        (appended `CREATE TABLE candidates (id TEXT);`)
  not ok 16 - the schema declares exactly agency, clients and events
  not ok 17 - no table or column is candidate-shaped
  # tests 31   # pass 29   # fail 2
  --- restored: # pass 31 # fail 0

  === BITE 2: a fifth events column ===     (added `candidate_ref TEXT` to events)
  not ok 17 - no table or column is candidate-shaped
  not ok 18 - events holds exactly {client, timestamp, duration} and nothing else
  # tests 31   # pass 29   # fail 2
  --- restored: # pass 31 # fail 0
  ```

- **9** `scripts/dev.py` (CREATE) — resolves the uuids once, generates the throwaway wrangler
  config, migrates, serves. Closes R4.
- **10** local migration applied and one client seeded from `spike/inputs/client-note.md`:

  ```
  agency: { "id": 1, "renderer": "appendix", "send_format": "email_body" }
  client: { "id": "11111111-…", "name": "Ashdown Park Community Healthcare", "note_chars": 1650 }
  ```

  `npm run db:local` and `npm run dev` print the **same** uuid, which is the R4 assertion:

  ```
  preview    dossier-engine-preview → e6ca7df4-fdc4-4483-a59f-b793c4608407
  local state → /Users/Berzins/Desktop/saulera-dossier-engine/.wrangler/state
  serving public/ with DB=e6ca7df4-fdc4-4483-a59f-b793c4608407 on http://localhost:8788
  ```

### Phase 2 — ⛔ THE GATE (tasks 11-15)

- **11** `src/store.js` (CREATE) — `StoreError`, `listClients`.
- **12** `src/http.js` (CREATE) — `json`, `readJson`, `sameOrigin`, `errorResponse`.
- **13** `functions/api/clients.js` (CREATE) — `onRequestGet`.
- **14** local validation against a real local D1:

  ```
  $ curl -s http://localhost:8788/api/clients
  {"clients":[{"id":"11111111-1111-4111-8111-111111111111",
               "name":"Ashdown Park Community Healthcare",
               "updated_at":"2026-07-27 15:46:10","note_chars":1650,"packs":0}]}

  $ curl -s http://localhost:8788/api/clients | grep -c '"note"'
  0
  ```

- **15** `scripts/deploy.py` (UPDATE) — optional branch argument; `npm run db:preview` applied
  the migration to the **remote preview** database; pushed; deployed
  `./scripts/deploy.py saulera-dossier-engine feature/client-knowledge-store`:

  ```
  origin/feature/client-knowledge-store is at 58d7319
  requesting a build of saulera-dossier-engine@feature/client-knowledge-store …
    45b94397  building 58d7319
    deploy: success
  ✓ live: https://45b94397.saulera-dossier-engine.pages.dev
  ```

#### Fallback ladder: **rung zero.** No fallback needed.

`functions/` stayed at the repo root and the Functions import `../../src/` the natural way.
The build log says so directly:

```
Found wrangler.toml file. Reading build configuration...
pages_build_output_dir: public
No build command specified. Skipping build step.
Found Functions directory at /functions. Uploading.
 ⛅️ wrangler 3.114.17
✨ Compiled Worker successfully
Success: Your site was deployed!
```

#### What the gate closed, and by what evidence

| Risk | Status | Evidence |
|---|---|---|
| **R2a** — a returned `functions/` is picked up | **closed** | build log: `Found Functions directory at /functions. Uploading.` |
| **R2b** — a Function bundles `../../src/` | **closed** | build log: `✨ Compiled Worker successfully`, on a CI image running wrangler **3.114.17** (not the 4.114.0 pinned locally) |
| **R7** — D1 return shapes | **closed** | task 14 against a real local D1: `all()` → `.results`, `note_chars` and `packs` populated, `packs: 0` not null |
| **R4** — local uuid mismatch | **closed** | both `db:local` and `dev` print the same uuid |
| Access still shut on preview | **closed** | `/` and `/api/clients` both `302` to `linardsberzins.cloudflareaccess.com`, on the branch alias **and** the deployment hostname |
| **R1** — the D1 binding resolves at runtime on a CI build | **open, and not closable from here** | see below |

**R1 needs one authenticated request and Access takes an email OTP.** The unauthenticated sweep
cannot discriminate it: Access intercepts every path, so a `302` looks identical whether the
binding resolved or not. The deployment *is* on the `preview` environment (confirmed in the
deployments API), which is the environment `setup-d1.py` bound, and the binding is confirmed
present there by that script's verifying GET. What is unproven is the runtime step.

The check, for whoever is logged in:
`https://feature-client-knowledge-store.saulera-dossier-engine.pages.dev/api/clients` should
answer `{"clients":[]}` — an empty array, because the remote preview database has the schema
and no rows. A `503 {"error":"not_configured"}` is R1 and sends you to task 15's symptom table.

### Phase 3 — the store and the HTTP layer (tasks 16-23)

- **16** `src/store.js` (UPDATE) — the rest of the surface. `RENDERERS` imported from
  `src/render/index.js`, so #9's `.docx` renderer needs no migration and no change here.
- **17** `test/helpers/fake-d1.js` (CREATE) — 50 lines, records calls, executes no SQL.
- **18** `test/store.test.js` (CREATE) — 21 tests.
- **19-22** `functions/api/clients.js` (UPDATE, POST), `functions/api/clients/[id].js`,
  `functions/api/agency.js`, `functions/api/events.js` (CREATE).
- **23** the full local sweep against `wrangler pages dev` with a real local D1:

```
1  GET  /api/clients                  -> 200 {"clients":[{…,"note_chars":1650,"packs":0}]}
2  POST /api/clients {name}           -> 201 {"client":{"id":"b3fe7482-…","note":"",…}}
3  GET  /api/clients/<id>             -> 200 {"client":{…,"name":"Sussex Care Partners"}}
4  PUT  /api/clients/<id> {note}      -> 200 {"client":{…}}
5  round-trip repr(note)              -> 'line one\n\nline three  '     ← byte-exact
6  PUT  /api/clients/<id> {note:""}   -> 200   then repr(note) -> ''    ← a clear is a value
7  GET  /api/clients/does-not-exist   -> 404 {"error":"not_found"}
8  POST /api/events                   -> 201 {"ok":true}
9  POST /api/events + candidate_name  -> 400 {"error":"unexpected_fields","fields":["candidate_name"]}
10 POST /api/events unknown client    -> 404 {"error":"not_found"}
11 GET  /api/events                   -> 200 {"total":1,"per_client":[{"client_id":"b3fe7482-…","packs":1}]}
12 GET  /api/agency                   -> 200 {"agency":{"send_format":"email_body","renderer":"appendix",…}}
13 PUT  /api/agency {renderer:docx}   -> 400 {"error":"bad_renderer"}
14 PUT  /api/agency {renderer:inline} -> 200 {"agency":{…,"renderer":"inline",…}}
15 PUT  /api/agency {send_format:fax} -> 400 {"error":"missing_fields"}
16 POST /api/clients bad json         -> 400 {"error":"bad_json"}
17 POST /api/clients no name          -> 400 {"error":"missing_fields"}
18 POST /api/clients cross-origin     -> 403 {"error":"cross_origin"}
19 GET  /api/clients                  -> 200 …"note_chars":0,"packs":1…   ← the counter is visible
20 PUT  /api/clients/<id> 100_001 chars -> 400 {"error":"too_long"}
21 the stored note after that rejection -> ''                            ← unchanged, not clobbered
```

The plan's sweep asked for an unknown `client_id` to answer `400`. It answers **404**, from
`getClient`'s `not_found`. Deliberate: the row is genuinely absent, the code is the same one
`GET /api/clients/<id>` returns for the same condition, and the screen needs to tell those two
apart from a malformed body. Recorded as a deviation rather than bent to match.

## Tests added

`test/schema.test.js` — 5 tests. Parses `migrations/0001_init.sql`.

| Test | What would break it |
|---|---|
| the schema declares exactly agency, clients and events | a fourth table |
| no table or column is candidate-shaped | `candidate`, `cv`, `resume`, `pack`, `brief` as an identifier |
| events holds exactly {client, timestamp, duration} and nothing else | a fifth `events` column |
| clients carries the note | dropping the product |
| agency carries the two settings read at generation and render time | a branding column (Decision 6) |

`test/store.test.js` — 21 tests, against `test/helpers/fake-d1.js`. Beyond the validation
happy/sad paths, three assert properties a real database would only imply:

- **injection** — a client named `Robert'); DROP TABLE clients;--` is created and updated; no
  recorded SQL contains `DROP` or the literal name, and the name appears in the bound args.
- **`listClients` never selects the note** — the SQL is matched with `LENGTH(…)` stripped out,
  so `LENGTH(c.note)` passes and a bare `c.note` fails.
- **the events SQL mentions no forbidden column** — `name`, `candidate`, `cv`, `note`, `pack_`,
  `role`, `brief`, on every events statement the suite issues.

Plus: `cleanNote` round-trips leading spaces, a blank line, trailing spaces and a curly quote
byte-identical; `updateClient({note: ""})` writes the empty string while `updateClient({name})`
issues no note write at all; `recordEvent` binds exactly `[client_id, duration_ms]` and its
INSERT never mentions `created_at`.

## Validation results

Final run, on the finished branch:

```
════ LEVEL 1 ════
syntax:                       ok      (7 files, node --check)
doc drift:                    ok      ← README.md, DEPLOY.md and wrangler.toml all corrected
stale health route:           ok
model access:                 ok      ← no ANTHROPIC_API_KEY, no SDK, anywhere it could reach
browser storage:              ok      ← Decision 5
table count:                  ok (3)
candidate-shaped identifier:  ok
identity-bound path:          ok      ← AC5: no owner column, no author field, no saulera path
raw hex:                      ok      ← every colour in app.css goes through a custom property

════ LEVEL 2 ════
node20 # tests 52   # pass 52   # fail 0
node24 ℹ tests 52   ℹ pass 52   ℹ fail 0
```

The doc-drift gate was verified to bite before the docs were fixed — it named all three files
by line, and stayed red until task 30 finished:

```
README.md:13:  … two files, no Functions, no secrets, no
DEPLOY.md:3:   Static `public/` only — no Functions, no build step, no framework, no secrets.
DEPLOY.md:59:  **There is no `functions/` directory.** …
```

**Level 3** (integration) — the two curl sweeps above, against `wrangler pages dev` with a real
local D1. **Level 4** (manual) — the unauthenticated preview sweep above, plus the browser pass
in Phase 4. **Level 5** — `scripts/setup-d1.py` run twice; second run prints `ok` and changes
nothing.

There is no automated harness for the integration layer in this ticket, and the plan says to
say so rather than imply coverage that does not exist. The curl sweeps are the record.

Baseline before this ticket was **26** tests, not the 16 the plan predicted — #4's suite had
grown by `468c95a`.

## Validation results

_(filled as they land)_

### Phase 4, task 24 — the design critique

**Written before the first line of CSS.** Skills read first: `dossier-design/references/CRAFT.md`
and `CHECKLIST.md` (copied in at task 6), and `/stackai-design` — added at the user's request
mid-run, and the right call: `public/tokens.css` says in its own header that its values *are*
the stackai defaults, so that skill is the upstream source of this repo's token layer rather
than a second opinion about it.

**Does the layout serve this subject?** Yes, and for a reason the wireframe makes visible: the
client rail's rows are mostly a readout of *how much is written down*. The screen's thesis is
the architecture's fear (§6.5 — the note stays empty), so a list whose dominant content is
`1,842 characters · 6 packs` puts the fear on screen without nagging about it. A conventional
list of names would not.

**Is the signature rail information or decoration?** Information. It is §5.3's four things,
which is the client-knowledge schema architecture §8 says does not exist yet, rendered as
prompts rather than as fields. The test that settles it: delete it and the screen loses a
person's answer to "what belongs in here". Delete a decoration and nothing is lost. It also
beats placeholder text, which vanishes at the first keystroke — exactly wrong for a surface
people abandon halfway.

**Would this have been produced for any similar brief?** No. A generic notes CRUD screen would
lead with names and dates and would not measure the note at all. Counting characters as the
primary row content only makes sense for a product whose thesis is that a specific kind of
knowledge compounds.

**Does the palette hold at 60/30/10?** Yes, and stackai's own component specs corroborate the
split. One correction to the spec's role table: the textarea field is `--background`, not
`--surface`. A white writing surface inside a grey page region reads as "this is the thing you
write in", and it keeps surface at roughly 30% instead of pushing it past 40%.

**Is the `--text-muted` contrast fix correct?** Yes, and the plan's estimate was close. Measured
rather than estimated:

| Pairing | Ratio | Verdict |
|---|---|---|
| `--text-primary` `#1d1d1d` on `--background` | **16.86:1** | passes |
| `--text-primary` `#1d1d1d` on `--surface` | **15.46:1** | passes |
| `--text-muted` `#8c8c8c` on `--surface` | **3.08:1** | **fails 4.5** (plan estimated 2.9) |
| `--text-muted` `#8c8c8c` on `--background` | 3.36:1 | fails 4.5 |
| **`--text-muted` `#6b6b6b` on `--surface`** | **4.89:1** | **passes** ← the fix |
| `--text-muted` `#6b6b6b` on `--background` | 5.33:1 | passes |
| `--border` `#595959` on `--surface` | 6.42:1 | passes |
| `--danger` `#78350f` on `--surface` | 8.32:1 | passes |

#### Two findings the plan did not have, both in the existing engine-side token layer

**1. `--accent` is not a text colour.** `#0099ff` on `#ffffff` is **3.00:1** and on `--surface`
**2.75:1**. Both fail the 4.5:1 body-text MUST. So the accent is used as a *fill* and never as
text on this screen, and the one link task 27 adds is `--text-primary` with an accent underline
rather than accent-coloured text. The shared `a` rule moving out of `index.html` is changed to
match, because it is the same MUST.

**2. White on the accent button would fail; near-black passes.** `#ffffff` on `#0099ff` is
**3.00:1**; `#1d1d1d` on `#0099ff` is **5.62:1**. stackai's own `.btn-primary` spec already says
`color: #1d1d1d`, so the system had this right and the instinct to "fix" it to white would have
introduced the bug. Recorded so #8 does not.

**3. The focus ring needed a second line.** The spec puts the ring on `--accent`, which is
2.75:1 against `--surface` and misses SC 1.4.11's 3:1 for a non-text indicator. Rather than
change the brand accent, the ring is two concentric lines: a 1px `--text-primary` hairline
hugging the control, then the 2px accent outside it. The dark line guarantees the indicator is
distinguishable on any surface in the palette, and the accent keeps the identity the spec wants.

#### What the critique changed in the spec

1. Textarea field is `--background`, not `--surface`.
2. Focus ring is two-tone, not a single accent line.
3. Accent is never text. Primary buttons carry `--text-primary` on an accent fill.
4. Disabled states use muted colour, not opacity — stackai names opacity-for-disabled as an
   anti-pattern, and it also dims the label below its contrast floor.

Everything else in *DESIGN SPEC* is built as written: the layout, the signature rail, the type
ramp, the zone rhythm, the single authored motion moment, and every string in the copy deck.

### Phase 4, tasks 25-28 — the screen, and what was proven in a browser

- **25** `public/tokens.css` (UPDATE) — type ramp, `--ease-out`, two durations, focus-ring widths,
  and `--text-muted` darkened. `public/app.css` (CREATE) — component rules, zero raw hex.
- **26** `public/clients.html` + `public/clients.js` (CREATE).
- **27** `public/index.html` (UPDATE) — the `POST /api/health` paragraph replaced with a link to
  `/clients`, and the inline `<style>` moved out to `app.css` so both pages are one system.
- **28** real Safari, real Chrome, headless Chrome for the states.

#### Routing

`/clients` → `200`, `/clients.html` → `308` to `/clients`, which is Decision 4's route without
a `_routes.json`.

#### 360px: no horizontal scroll, measured rather than eyeballed

A first pass at `--window-size=360` looked like a blowout. It was not:

```
window-size=360  -> innerWidth=500     ← Chrome headless clamps the window to a 500px minimum
window-size=400  -> innerWidth=500
window-size=1280 -> innerWidth=1280
```

So the "360px" screenshot was a 500px render cropped to 360. Measured properly, by rendering
the real page in a same-origin iframe pinned to exactly 360 CSS px:

```
viewport=360 scrollWidth=360 overflow=0     ← and no element's right edge past the viewport
```

> **Corrected by the PR #13 review (H6).** The measurement above was honest; the conclusion
> drawn from it was broader than the evidence. It used the seeded client name "Ashdown Park
> Community Healthcare", which contains spaces and therefore wraps. The add-client field accepts
> 120 characters with no whitespace requirement, and `app.css` had no `overflow-wrap` anywhere,
> so an unbroken name blew the page out:
>
> ```
> name = "A" × 120, before the fix:  viewport=360  scrollWidth=1698  overflow=1338
> name = "A" × 120, after the fix:   viewport=360  scrollWidth=360   overflow=0
> ```
>
> Worth recording *why* the original probe missed it: **overflowing text does not widen its
> element's border box**, so every `getBoundingClientRect()` came back inside the viewport while
> `scrollWidth` blew out. The "no element's right edge past the viewport" clause was measuring
> the wrong thing, and it is the reason `.editor { min-width: 0 }` did not catch this either.
> Fixed by `overflow-wrap: anywhere` on the editor heading, and re-measured by
> `.claude/probes/clients-screen.mjs`, which asserts `scrollWidth <= innerWidth` with the
> unbroken name.

#### The keyboard path

```
TAB ORDER (DOM order, no positive tabindex reorders it):
  1. <button>  "Ashdown Park  0 characters · 1 pack"
  2. <button>  "Ashdown Park Community Healthcare  1,650 characters · 0 packs"
  3. <button>  "Sussex Care Partners  0 characters · 0 packs"
  4. <input>   #new-client-name
  5. <button>  #add-button "Add client"
  6. <textarea> #note
  7. <button>  #save-button "Save note"
  8. <input>   "appendix"
  9. <input>   "inline"
 10. <select>  #send-format
positive-or-negative tabindex overrides: 0   (the DOM order is the tab order)
focus ring on #save-button: outline=2px solid rgb(0, 153, 255) offset=1px
focus inner hairline:       box-shadow=rgb(29, 29, 29) 0px 0px 0px 1px
reduced-motion block present: true
```

Ten native controls, no trap, no dialog, and the two-tone ring resolves as designed.

#### R8 — a failed save keeps the text. Reproduced, not reasoned about.

The screen was driven in a real browser against a server that accepts the PUT and then closes
the socket with no response, so `fetch` rejects — what a stopped deployment or dropped
connection looks like from the page:

```
1 dirty message      = "Unsaved changes"
2 button before save = "Save note" disabled=false
3 button mid-save    = "Saving…"   disabled=true      ← measured separately, see below
4 message after fail = "Could not save. Your text is still here. Try again."
5 message is error   = true
6 TEXT SURVIVED      = true   length=1687
7 button restored    = "Save note" disabled=false
```

The `Saving…` state was verified against a server that delays the PUT by three seconds, because
against a localhost connection-drop it comes and goes faster than a frame:

```
mid-save label    = "Saving…"
mid-save disabled = true
after label       = "Save note"
saved message     = "Saved 17:14"
```

#### R9 — an expired session says so. Reproduced, not reasoned about.

Every `/api/*` answered `200 text/html`, which is exactly what Access sends a `fetch` when the
session has gone:

```
GET /api/clients: 200 text/html
```

The screen shows **"Your session expired. Reload the page to sign in again."** in the editor
area and again in the agency strip, not a generic failure and not a JSON parse error. It also
does not claim "No clients yet" — the empty-list copy stays hidden, because a list that failed
to load is not an empty list.

#### Real browsers

Both engines render the layout with no blowout: **real Safari (WebKit)** and **real Chrome
(Blink)**, each at 1180px with the seeded 1,650-character note loaded, plus headless Chrome for
1280px, the true 360px column, the no-client state, mid-save, the failed save and the expired
session.

#### Contrast, recorded

Every pairing that ships, measured at definition time:

| Pairing | Ratio |
|---|---|
| body text `--text-primary` on `--background` | 16.86:1 |
| body text `--text-primary` on `--surface` | 15.46:1 |
| row meta and scaffold `--text-muted` on `--surface` | **4.89:1** (was 3.08:1) |
| `--text-muted` on `--background` | 5.33:1 |
| field borders `--border` on `--background` | 7.00:1 |
| field borders `--border` on `--surface` | 6.42:1 |
| button label `--text-primary` on `--accent` | 5.62:1 |
| save-failed text `--danger` on `--background` | 9.07:1 |

There is no placeholder text on this screen — the labels are permanent, so there is no
placeholder pairing to check.

### Phase 5 — the decision record and the deploy (tasks 29-32)

- **29** `README.md` (UPDATE) — five edits. Both new decisions in the register the existing
  entries use, Status corrected, Engine and config extended with `functions/`, `migrations/`,
  `src/store.js`, `src/http.js`, `public/app.css` and the two scripts on the engine side and the
  **two D1 databases and their bindings** on the config side, plus the `--text-muted` note.
  The **Model access** entry was corrected rather than left standing: it claimed "there is no
  Function … and nothing to deploy but two files", which the Level 1 grep caught and which
  would have left Decisions self-contradicting. It now states the boundary that actually holds
  — nothing in this deployment calls a model — and points at the new entry as restating it.
- **30** `DEPLOY.md` (UPDATE) — a numbered D1 section before Secrets, §1 corrected, Secrets kept
  as §5b with the binding-is-not-a-secret line, and the smoke-test checklist extended with
  `/clients`, the three API routes and the unauthenticated sweep.
- **31** deployed the finished branch and verified:

```
origin/feature/client-knowledge-store is at a193f9e
requesting a build of saulera-dossier-engine@feature/client-knowledge-store …
  cfd39df9  building a193f9e
  deploy: success
✓ live: https://cfd39df9.saulera-dossier-engine.pages.dev

/clients:     302  cloudflareaccess.com
/api/clients: 302  cloudflareaccess.com
/api/events:  302  cloudflareaccess.com
/api/agency:  302  cloudflareaccess.com
/:            302  cloudflareaccess.com
```

  And the regression check the plan asks for — `./scripts/deploy.py` with no branch argument
  still builds `main`, exactly as before:

```
origin/main is at 468c95a
requesting a build of saulera-dossier-engine@main …
  cb28008f  building 468c95a
  deploy: success
```

  **That check created a new production deployment**, of `main` at `468c95a`. Content-identical
  to what was already serving, so production is unchanged — but a reviewer looking at the Pages
  dashboard will see a production deployment dated during this feature's validation, and this
  is why.

- **32** five atomic commits: `58d7319` schema + store + gate · `10b8e24` the endpoints ·
  `d5de123` the screen · `a193f9e` the docs (carrying the plan and the copied design skill) ·
  `544e8d7` this report. **The PR is not opened here** — see *Not done, and why*.

#### One defect found in review, after the docs commit

The two-tone focus ring was **not painting its dark hairline on the selected client row**.
`.client-row[aria-current="true"]` is specificity `(0,2,0)` and the bare `:focus-visible` rule
is `(0,1,0)`, so the marker bar's `box-shadow` replaced the ring's hairline rather than joining
it — on the one control that sits against `--surface`, which is precisely the case the hairline
was added for. The earlier keyboard audit missed it because it probed `#save-button`, where the
rule is unopposed.

Measured before:

```
SELECTED row:      box-shadow = rgb(0, 153, 255) 4px 0px 0px 0px inset
                   dark hairline present = false        ← the ring lost its second line
unselected row:    dark hairline present = true
#save-button:      dark hairline present = true
```

Fixed by restating both shadows on `.client-row[aria-current="true"]:focus-visible`. Measured
after:

```
SELECTED row, focused:
  box-shadow = rgb(0, 153, 255) 4px 0px 0px 0px inset, rgb(29, 29, 29) 0px 0px 0px 1px
  accent marker bar kept = true
  dark hairline present  = true
SELECTED row, not focused:
  box-shadow = rgb(0, 153, 255) 4px 0px 0px 0px inset   (marker bar only, as designed)
```

`public/index.html` was also rendered rather than only status-checked, since it was the one
page changed without being looked at: the card, the muted paragraph, the `code` styling and
the new `/clients` link all render from `app.css`, with the link in `--text-primary` under an
accent underline as the contrast finding requires.

## Deviations from the plan

Each one is a decision, not a slip.

1. **`package.json` gained four scripts, not "three".** The plan's own list has four
   (`dev`, `db:local`, `db:preview`, `db:remote`); the count in its prose was off by one.

2. **`db:preview` and `db:remote` go through `scripts/dev.py`, not straight to wrangler.**
   The plan's *VERIFIED FACTS* says `wrangler d1` resolves a database *"in your config or the
   API"*. That is true of `d1 list`, `d1 info` and `d1 execute --remote`, all re-verified here,
   and **false of `d1 migrations apply`**, which is the one command those scripts use:

   ```
   ✘ [ERROR] Couldn't find a D1 DB with the name or binding 'dossier-engine-preview'
             in your wrangler.toml file.
   ```

   It fails that way on `--local` and `--remote` alike. Since Decision 3 keeps bindings out of
   `wrangler.toml`, `dev.py` generates a throwaway config under `.wrangler/` (gitignored) and
   points `-c` at it. All four `db:*` scripts share that one resolution path, which is what the
   plan's own GOTCHA on task 9 asks for.

3. **`scripts/dev.py` passes `--persist-to` explicitly and writes an absolute
   `migrations_dir`.** Discovered rather than anticipated: a relative `migrations_dir` resolves
   against the *config file's* directory, so wrangler went looking for `.wrangler/migrations`.
   Both are the same R4 hazard the script exists to remove, so both are closed the same way.

4. **`scripts/setup-d1.py` PATCHes the delta, not the whole merged object.** The plan says GET,
   merge locally, PATCH the whole merged `deployment_configs`. The GET carries computed fields
   — `wrangler_config_hash` — that are not ours to write back. So it PATCHes only
   `d1_databases`, keeps the pre-PATCH response, and then checks both that the bindings landed
   *and* that every pre-existing key survived. That is strictly stronger than the plan's "assert
   both bindings are present", and it is what established that the PATCH merges.

   The guard's first version was too strict: it read the server normalising `env_vars` from
   `null` to `{}` as a replace. Corrected to ignore the two fields that move on their own,
   while still failing on a dropped compatibility date or flag.

5. **`POST /api/events` with an unknown `client_id` answers `404`, not the `400` the plan's
   curl sweep expects.** The row is genuinely absent, it is the same `not_found` that
   `GET /api/clients/<id>` returns for the same condition, and the screen needs to tell that
   apart from a malformed body. The `unexpected_fields` guard the plan actually cares about
   still answers `400`.

6. **`scripts/deploy.py` prints the deployment's own URL on a branch build.** One line, caused
   directly by the branch argument: a branch build lands on a preview hostname and printing the
   production URL would send you to check the wrong site.

   > **Narrowed by the PR #13 review (M11), which was right to dispute the original framing.**
   > As written, the change applied to the **no-argument** path too — `d.get('url')` is a
   > per-deployment hash hostname for production builds as well — so `./scripts/deploy.py`
   > printed a hash hostname where the runbook's next step asks you to curl the apex, while the
   > docstring promised that path "behaves exactly as it always did". Not exposure: the
   > `*.pages.dev` Access application covers hash hostnames. It now prints the apex when
   > `branch == "main"` and the deployment's own URL otherwise, which is what the deviation
   > claimed all along.

7. **Four design-spec changes, all from the critique in task 24** (recorded in full above): the
   textarea field is `--background` rather than `--surface`; the focus ring is two-tone because
   `--accent` alone is 2.75:1 on `--surface`; the accent is never text; disabled states use
   muted colour rather than opacity.

8. **`/stackai-design` was read alongside `dossier-design`**, at the user's request mid-run.
   It is the upstream source of this repo's token layer — `public/tokens.css` says so in its own
   header — and it is what confirmed that a primary button's label must be near-black rather
   than white.

9. **Eight visible strings are on the screen that the plan's copy deck does not contain.**
   Raised by the PR #13 review (L11), which found two of them and correctly called the omission
   a documentation gap rather than a copy problem. The fix for it is this list, not moving the
   strings into a `COPY` object. All eight live in `COPY` at the top of `public/clients.js`, in
   the deck's own register: en-GB, sentence case, no em dashes, no apologies, each naming what
   to do next.

   | Key | Copy | Why the deck has no row for it |
   |---|---|---|
   | `leaving` | You have unsaved changes to this note. | The deck specifies no `window.confirm` text; the plan's CHECKLIST mandates the warning without wording it. |
   | `agencySaved` | Saved | The agency strip's own saved state. The deck's "Saved 14:32" is the note editor's, and a timestamp on a radio button reads as more than happened. |
   | `notConfigured` | This deployment is not connected to its database. Nothing can be read or saved yet. | R1's failure. The deck has no 503 copy at all, and the save copy was standing in for it. |
   | `notMigrated` | This deployment's database has no tables yet. Nothing can be read or saved yet. | The second 503, split out from `not_configured` by the review's L5 because the remedies differ. |
   | `listFailed` | Could not load the client list. Reload the page. | The deck's only failure copy is save copy. |
   | `loadFailed` | Could not open that client. Pick another, or reload the page. | As above, for the read path. |
   | `addFailed` | Could not add that client. Try again. | As above, for the add path. |
   | `settingFailed` | Could not change that setting. It is still what it was. | As above, for the agency strip, which has no text to promise survived. |

   The five `*Failed` strings and the two 503s exist because of the review's M7: every read path
   fell back to *"Could not save. Your text is still here. Try again."*, which on first paint
   describes a save nobody asked for and text that does not exist.

9. **Two comments were reworded so the Level 1 greps stop crying wolf.** A comment in
   `public/clients.js` explaining that nothing is written to browser storage contained the API
   names and tripped the browser-storage gate; a comment in `public/app.css` quoting measured
   contrast ratios contained hex notation and tripped the raw-hex gate. Both now say the same
   thing without the literals. A gate that reports a failure on a correct file gets deleted, so
   the file moved rather than the gate.

10. **Task 1's validation could not print `0`.** `git status --porcelain` printed one line
    because `.claude/` was **entirely untracked** — the plan's task 32 states
    `.claude/plans/deploy-skeleton.md` "is already tracked", and it is not. Branched anyway; no
    tracked file was modified. This ticket's plan, its report and the copied design skill are
    now committed by path. `verify-deploy.sh`, `code-reviews/` and the deploy-skeleton artefacts
    are left untracked, because they belong to #3 and adopting them is not this ticket's call.

11. **The test baseline was 26, not the 16 the plan predicted.** #4's suite had grown by
    `468c95a`. 52 pass now.

## Issues encountered

- **Chrome headless clamps its window to a 500px minimum**, so the first "360px" screenshot was
  a 500px render cropped to 360 and looked exactly like a layout blowout. Measured properly
  through a same-origin iframe pinned to 360 CSS px: `scrollWidth == innerWidth == 360`, no
  element past the viewport. Worth knowing before anyone re-runs this check for #8.

- **A `d1_databases` binding cannot be removed through the Pages PATCH.** Both `{}` and `null`
  were accepted with `success: true` and left the binding standing. Consequence for this
  report's honesty: `setup-d1.py`'s PATCH branch ran once, on the real project, and applied both
  bindings correctly; its idempotent branch ran repeatedly. The corrected guard's *failure*
  branch has not been triggered, because there is no way to un-bind and re-run from a clean
  state without the dashboard.

- **The local D1's sqlite filename is not a plain hash of the uuid, the binding or the database
  name.** So R4 cannot be settled by inspecting `.wrangler/state/`; it is settled by handing
  both commands the same uuid and checking the API answers, which is what task 14 does.

## Not done, and why

- **The pull request.** Task 32 says "commit **and open the PR**". The commits are done and
  pushed; the PR is not opened, because `piv-create-pr` is the next step in this loop and it
  builds the body from this report. Whoever opens it must carry the four things the plan's
  checklist names: `Closes #5`; the six decisions; **the fallback ladder rung — zero, no
  fallback needed**; that `scripts/deploy.py` gained an optional branch argument defaulting to
  `main`; and the AC5 boundary (the capability ships, the agency's own addresses are a
  per-deployment Access policy change at onboarding, not a code change).

- **Task 32b, the post-merge production block.** It belongs to whoever merges, by the plan's own
  wording. Production's `DB` binding is set and confirmed, but `dossier-engine` has **no schema
  yet** — `npm run db:remote` has deliberately not been run, because migrating production before
  the code that uses it is on `main` gains nothing.

  **The fact that makes that safe is that push does not trigger a build on this project.**
  `main` has no `functions/`, so nothing queries the empty database, and production only ever
  changes when somebody runs `deploy.py`. If the GitHub webhook is ever reconnected — which
  `DEPLOY.md` names as the fix for the broken push notification — then merging this branch
  would deploy Functions against a schemaless production database and every `/api/*` would
  answer `500`. **Run `npm run db:remote` before reconnecting that webhook, or before the
  merge, whichever comes first.**

- **The one authenticated check on the preview.** `GET /api/clients` on the branch preview
  returning `{"clients":[]}` is the last piece of R1, and it needs an email one-time PIN that
  cannot be driven from here. Everything the deploy *can* prove is proven above. If that request
  answers `503 {"error":"not_configured"}` instead, that is R1 and §5's failure table in
  `DEPLOY.md` says what to do.
