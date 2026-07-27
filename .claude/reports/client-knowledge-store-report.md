# Implementation Report — Client knowledge store, its editor screen, and the event counter

**Plan**: `.claude/plans/client-knowledge-store.md`
**Branch**: `feature/client-knowledge-store`
**Status**: IN PROGRESS

<!-- Written incrementally, task by task. Evidence is pasted as it happens, never
     reconstructed at the end. -->

## Summary

_(filled at the end)_

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

- **`npm test`** — 52 pass, 0 fail, on **v20.20.2** and **v24.11.0**. (Baseline before this
  ticket was 26, not the 16 the plan predicted; #4's suite had grown.)
- **`node --check`** — clean on all six new/changed JS files.
- **Level 1 greps** — see the end of this report.

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

## Deviations from the plan

_(filled as they happen)_

## Issues encountered

_(filled as they happen)_
