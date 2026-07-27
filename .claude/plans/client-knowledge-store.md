# Feature: Client knowledge store, its editor screen, and the event counter

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

> **⚠️ Read this box before anything else.**
>
> 1. **The repo is `~/Desktop/saulera-dossier-engine`, not `~/Desktop/saulera`.** The issue lives in `linardsb/saulera-dossier-engine`. The saulera marketing site is a *reference* for the Function pattern only. Nothing in this ticket touches it.
> 2. **`functions/` was deleted on 27 Jul 2026 and this ticket brings it back.** #3's amendment forbids a **model call** from Pages, not Functions as such. See *Decision 2*. `README.md`, `DEPLOY.md` and `wrangler.toml` all currently say "no Functions", and all three have UPDATE tasks with a grep gate in *Level 1* that fails while the stale strings survive.
> 3. **Cloudflare Access is ON** (#12, closed 27 Jul 2026), 24-hour session, only `linardsberzins@gmail.com` admitted. Every validation curl against production sees a `302` and nothing else. Manual validation happens in a browser, logged in.
> 4. **Six decisions are made in this plan and are not open.** AC6 asks for one of them; the other five would otherwise be guessed silently. Read *DECISIONS* before writing code.
> 5. **Task 15 is a hard gate.** It deploys a three-file vertical slice and proves the three deployment unknowns before the bulk of the code exists. Do not build Phases 3 to 5 until it passes. See *RISK REGISTER*.
> 6. **Date gate.** The epic gates Wave 1 (#4, #5) on the Tuesday 28 July discovery visit, and on the locum-shift-fill branch #4 to #9 get closed. #4 was already built ahead of it, so that call is already being made. This does not change the plan; it means do not be surprised if the ticket is closed rather than merged.

## Feature Description

Ship the durable half of the product: storage for the agency's client knowledge notes, the screen where the agency reads and edits them, and the non-personal event counter that makes the epic's primary metric a number rather than a memory.

Architecture §4 is blunt about why this is the ticket that matters: *"That note is the product. The generation is the cheap part."* A note only saulera can edit satisfies condition 1 for producing packs but not for keeping them good, and the knowledge stops compounding the moment the engagement ends. So the note is stored, owned and **edited by the agency** from day one.

This is a vertical slice, not a persistence layer. The store and its editor land together so the client note is usable on day one even if generation (#6) slips.

## User Story

As **the owner-operator of a small recruitment agency**
I want **to write down what I know about a client's hiring process and edit it whenever I learn something new**
So that **that knowledge compounds into an asset I own, instead of living in my head and leaving with the engagement**

## Problem Statement

The agency's real advantage is knowledge of its clients' hiring processes, and that knowledge lands nowhere. There is a validated pack contract and a working provenance verifier (#4, closed), and `src/prompt.js` already takes a `clientNote` argument. There is nowhere for that note to come from and no way for the agency to write one.

Two consequences, both load-bearing:

- **#6 cannot be built.** `buildMessages({ brief, cv, clientNote, clientName })` needs a store to read from.
- **The epic's primary metric has no mechanism.** PRD §7's *"count of packs generated vs submissions made"* is the wrong-condition test for the whole three-week adoption window. The ticket names it explicitly as *"the first thing that gets silently descoped."*

## Solution Statement

A D1 database with three tables, a thin HTTP layer over it in returned Pages Functions, and one standalone screen at `/clients` where the agency adds a client and edits its note.

Store logic lives in `src/store.js` as functions taking a D1-shaped `db`, so it is testable under the repo's existing zero-dependency idiom (`node --test`, `node:test`, `node:assert/strict`). `functions/api/*.js` are thin adapters that parse, guard, delegate and serialise, mirroring the Function pattern already proven in the saulera repo.

The schema is a single reviewable file, `migrations/0001_init.sql`, and `test/schema.test.js` parses it to assert two things that prose cannot enforce: **there is no candidate, CV or pack table**, and **`events` holds exactly `{client, timestamp, duration}`**. That converts AC3 and AC4 from commitments into a failing test if #6 or #8 tries to widen them.

**The build order is deliberately front-loaded on deployment risk.** Everything Cloudflare could refuse to do — resolve a D1 binding on a CI build, pick up a returned `functions/` directory, bundle a Function that imports from `src/` — is proven by a three-file deploy at task 15, before the screen or the rest of the store exists.

## Out of Scope / Non-Goals

- **Not included: harvesting.** Architecture §6.5 is explicit. *"Rule: ship the editable note. Build the harvesting only after seeing whether the note gets filled at all in week one."* No pasted-reply parsing, no "propose what to file", no suggestions of any kind.
- **Not included: generation.** No model call, no `ANTHROPIC_API_KEY`, no `@anthropic-ai/sdk` in a Function. #3's amendment stands unchanged. This ticket adds Functions for **storage only**.
- **Not included: the one screen.** #8 owns `public/index.html`, the brief/CV paste surface and the pack preview. This ticket ships a *separate* screen at `/clients`. See *Decision 4*.
- **Not included: structured note fields.** The note is one free-text blob, per §5.3. Architecture §8 names the client-knowledge schema as a missing piece whose input is Tuesday's answer to question 9. Do not invent fields.
- **Not included: recording submissions made.** PRD §7 measures that by *"Ask the agency, weekly."* The counter counts packs generated. Do not add a submissions column.
- **Not included: deleting clients, note version history, multi-user attribution, an audit log.** Pack history is a deliberately deferred open question (architecture §9, decision: ship strict).
- **Not included: `public/_routes.json`.** Pages generates the Function routing table from the `functions/` directory automatically. Only add one if task 15's fallback ladder requires it.
- **Not included: a linter, a formatter, a bundler, or a build step.** `build_command` is empty on this project and stays empty.
- **Not changing:** `src/pack.js`, `src/provenance.js`, `src/prompt.js`, `src/render/*`, `spike/*`, `test/provenance.test.js`, `test/smoke.test.js`. All of #4 stays exactly as it is.
- **Not changing:** the Access configuration or `scripts/setup-access.py`.
- **One small change to `scripts/deploy.py`**, and only this: an **optional** branch argument, defaulting to `main` so every existing invocation behaves identically. It is needed because the script currently hardcodes the branch it builds, which would make task 15's gate report a false failure. See task 15.

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: Medium-High (the code is routine; the decisions, the deployment unknowns and three stale artefacts are where it goes wrong)
**Primary Systems Affected**: Cloudflare D1 (new), Cloudflare Pages Functions (returned), `src/` library, `public/` UI, `README.md`, `DEPLOY.md`, `wrangler.toml`
**Dependencies**: Cloudflare D1. No new npm dependencies, no new runtime dependencies, no secrets.

## Related Work

**Implements**: [#5](https://github.com/linardsb/saulera-dossier-engine/issues/5) · **Epic**: [#1](https://github.com/linardsb/saulera-dossier-engine/issues/1) · **Architecture**: `~/Desktop/saulera/products/agency-submission-dossier/agency-submission-dossier.architecture.md` (private, not in this repo)

**Back-references** (plans this builds on or inherits decisions from):

- `.claude/plans/deploy-skeleton.md` — Why: #3. The Pages project, the Access door, the engine/config split, and the `functions/`-at-repo-root rule all come from there. Its *DEPLOYMENT PLATFORM — decided: Cloudflare Pages* section is inherited, not reopened.
- Epic #1 §"Standing constraints on every ticket" — Why: the no-candidate-data-store boundary is restated in #5, #6 and #8; this ticket is where it becomes a schema.

**Forward-references** (plans that extend or supersede this):

- #6 (generation) reads the note through `getClient` and writes one row through `recordEvent`. Keep both signatures stable.
- #8 (the one screen) absorbs this screen's markup, tokens and component grammar into `index.html`. Build for absorption, not for reuse-as-a-component.

---

## VERIFIED FACTS

Read against the live account and this machine on **27 July 2026**. These replace things an implementer would otherwise guess or discover late.

| Fact | Value | Why it matters |
|---|---|---|
| Pages build image | **v3 on both production and preview** | v3's default Node is **22.16.0** (v2's is 18.17.1). The CI image would satisfy wrangler ≥4.114 if a devDependency ever became necessary. It is not necessary here (task 2). |
| `build_config.root_dir` | `""` (i.e. `/`) | `functions/` at the **repo root** will be found. This is the precondition behind `DEPLOY.md` §1's rule. |
| `build_config.build_command` | `""` | There is no build step, and this ticket does not add one. |
| `deployment_configs.{production,preview}.d1_databases` | present in the schema, currently `null` | `scripts/setup-d1.py`'s merge target is confirmed and the key name is `d1_databases`. Nothing is bound today. |
| `deployment_configs.*.compatibility_date` | `2026-07-27`, matching `wrangler.toml` | No compatibility work needed for D1. |
| `crypto.randomUUID()` | works on Node **v20.20.2 and v24.11.0** | `newClientId()` needs no polyfill and no import, in tests or in the Workers runtime. |
| `wrangler d1` name resolution | resolves *"in your config **or the API**"* | Confirmed from the actual error text. D1 tooling works with **no** binding in `wrangler.toml`, which is what makes *Decision 3* free rather than a trade. |
| `wrangler d1 list` | empty | Clean slate. If it is not empty when you run it, stop and find out what else is using the account. |
| Bare `npx wrangler` | **4.86.0** under Node 20, **4.114.0** under Node 24 | Two different tools depending on the shell. Every command in this plan pins the version. |
| `scripts/deploy.py` | **hardcodes `form={"branch": "main"}`** at line 92; its only argument is the project name | Running it from a feature branch builds `main`, which has no `functions/`. The gate would then report the R2a symptom for a reason that is not R2a, and the script's own `origin/main` mismatch warning would stay silent because it compares against `origin/main` and finds them equal. Task 15 fixes this with an optional branch argument. |
| Word-boundary `\b` in grep | works on this machine's grep; BSD's `[[:<:]]` does **not** | The Level 1 gates use the bracket-class form, which was tested and works, so no gate can silently report `ok` because its regex never matched. |

**Still not verified, and gated rather than assumed:** whether a Pages CI build bundles a Function that imports from `../../src/`. Cloudflare's routing documentation does not cover module organisation at all. Task 15 proves it in a three-file deploy and carries a fallback ladder. See *RISK REGISTER*.

---

## RISK REGISTER

Every risk this plan started with, and the mechanism that closes it. A risk with only a note against it is not closed, so each row names a task.

| # | Risk | Mechanism | Task |
|---|---|---|---|
| R1 | The D1 binding does not resolve on a CI-triggered build, and the symptom is a clean `503` that reads like a code bug. | **Front-loaded gate.** A three-file vertical slice deploys to a **branch preview** and is verified *before* the rest exists, with a symptom table and a fallback. That proves the mechanism on the preview environment; production's binding is confirmed by `setup-d1.py`'s verifying GET and exercised for real in **32b**. Partly mooted by *Decision 3*: the binding is project-level config set through the Pages API, the long-established path, not the ambiguous `wrangler.toml` one. | **15, 32b** |
| R1b | `scripts/deploy.py` hardcodes `branch: "main"`, so running the gate from a feature branch builds code without `functions/` and reports R2a's symptom for the wrong reason. | An optional branch argument, defaulting to `main` so nothing existing changes, plus a `db:preview` script so the gate migrates the database a branch deploy actually binds. Both named in the task's GOTCHAs with the exact false symptom spelled out. | **2, 15, 31** |
| R2 | A returned `functions/` directory is not picked up, or a Function importing `../../src/` fails to bundle. Undocumented, and it would invalidate the store architecture. | Same gate, same deploy. The probe Function deliberately imports from `src/`, so one deploy tests routing **and** cross-directory bundling. Three-rung fallback ladder, all build-free. | **15** |
| R3 | `README.md`, `DEPLOY.md` and `wrangler.toml` keep claiming there are no Functions, so #6 and #8 inherit the contradiction. | **Grep gate in Level 1 validation**, run on every validation pass rather than only at the doc tasks. Validation is not green while a stale string survives. | **5, 29, 30** + Level 1 |
| R4 | The local D1 that `pages dev` opens is keyed differently from the one the migration was applied to, so `db:local` appears to succeed and the API sees no tables. | **`scripts/dev.py`** resolves the database uuid once, applies the migration against that uuid, and launches `pages dev` with the same uuid, printing it on both paths. The trap is removed, not documented. | **9** |
| R5 | The event counter is silently widened by #6 or #8 — a `candidate_ref` column added "just for debugging" breaches the one expensive-to-unpick boundary. | Three layers: `test/schema.test.js` fails on a fifth `events` column or any candidate-shaped table; `test/store.test.js` asserts no events SQL mentions a forbidden column; `POST /api/events` returns `400 unexpected_fields` on any extra key. Plus a Level 1 grep. | **8, 18, 22** |
| R6 | The screen is the half where judgement is open, so "follow the design skill" gets skipped or reinvented as the generic version. | The **DESIGN SPEC** section fixes palette roles, the type ramp with values, the layout as an ASCII wireframe, the signature element and the full copy deck. Task 24 critiques a specified design instead of filling a blank page. The skill is copied into this repo so it activates. | **6, 24, 25, 26, 28** |
| R7 | D1 return shapes (`all().results`, `first()` returning `null`) are assumed wrongly and every query is subtly broken. | Exercised for real at the gate, on the smallest possible query, before nineteen more are written. | **15** |
| R8 | A failed save loses the agency's in-progress edits to the product's compounding asset. | Specified behaviour, specified copy, and a deliberate proof: stop the dev server mid-edit, press save, confirm the text survives. | **26, 28** |
| R9 | An expired Access session returns HTML to a `fetch`, `res.json()` throws, and the UI reports a generic failure when the fix is "sign in again". | Every fetch checks `res.ok` **and** content type before parsing, with its own message. Proven deliberately, not reasoned about. | **26, 28** |
| R10 | Adding wrangler to `devDependencies` changes the CI install path for local-dev convenience. | Not added; pinned through `npx` in the npm scripts. The build image is now known to be v3 / Node 22.16.0, so this is a free choice for a lean CI install rather than a forced one. | **2** |

**Not an implementation risk, and deliberately not treated as one:** the Tuesday 28 July gate. It decides whether the ticket survives, not whether the implementation succeeds. No mechanism exists for it in code.

---

## DECISIONS

Six calls, made here so the implementing agent does not guess and #6/#8 do not re-litigate. AC6 asks for the first one in writing; the rest are the ones that would otherwise be silently defaulted.

### Decision 1 — Storage backend: **D1**. (AC6)

Both KV and D1 handle a few packs a week from a two-to-ten-person agency, so throughput does not decide it. Two things do:

1. **AC3 is auditable with D1 and opaque with KV.** *"There is no candidate table"* is a cross-cutting constraint restated in three tickets and is the strongest sentence the product says out loud. With D1 there is one file, `migrations/0001_init.sql`, that can be pointed at, reviewed and tested. KV namespaces have no schema to show. That turns the promise into a reviewable artefact and into a test.
2. **The editor needs read-after-write.** KV is eventually consistent. An agency saving a note, reloading and seeing its old text would land that weakness on the exact surface that *is* the product. D1 is strongly consistent against its primary.

Secondary: the counter is `SELECT client_id, COUNT(*) ... GROUP BY client_id`, which in KV would be a key-space scan with `list()` and per-event keys.

**Ruled out.** KV, for the two reasons above. R2 storage, wrong shape for small structured records. Durable Objects, a coordination primitive for a problem with no concurrent writers.

**Cost.** D1 is on the Workers free plan: 10 databases, 500 MB per database, 5 GB per account (verified 27 Jul 2026 against the D1 limits page). Do not write daily-quota numbers into the record; they were not verified and the reasoning does not need them.

### Decision 2 — Pages Functions return, for **storage only**.

#3's amendment reads as "no Functions", and its *reasoning* is narrower than its wording: a subscription authenticates Claude Code through a short-lived OAuth token in a local credential file, and a V8 isolate has no filesystem and no process to refresh it. **A D1 binding is not a secret and needs no filesystem.** So the amendment forbids a *model call* from Pages, which this ticket does not add.

AC1, AC2, AC4 and AC5 are unsatisfiable without a server-side store, because AC5 requires the agency to edit the note in the tool rather than saulera editing a file.

The boundary that survives, and must be restated rather than quietly dropped: **no model call from the deployment, no `ANTHROPIC_API_KEY`, no `@anthropic-ai/sdk` at runtime.** Generation stays in Claude Code on the subscription until an agency self-serves, which is #6's decision.

`DEPLOY.md`'s note that `functions/` belongs at the **repo root and never under `public/`** stops being hypothetical and becomes load-bearing. *VERIFIED FACTS* confirms `root_dir` is `/`, so the root is the right place.

### Decision 3 — The D1 binding is configured **per deployment**, not in `wrangler.toml`.

`README.md`'s *Engine and config* section puts `wrangler.toml` on the **engine** side, tracked upstream and shared by every agency. A `database_id` is per-agency **config**. Putting it in `wrangler.toml` forks an engine file per agency and creates a merge conflict on every pull, which is exactly what the split exists to prevent.

So: two D1 databases, bound as `DB` on the Pages project's production and preview environments through the Pages API (or the dashboard), with `wrangler.toml` carrying a comment explaining the absence.

Two things make this free rather than a trade. `wrangler d1` resolves a database **by name against the account API**, verified above, so no tooling breaks. And project-level bindings are applied to every deployment regardless of how the build was triggered, which sidesteps the fact that Cloudflare's own two documentation pages disagree about whether a git-connected CI build reads `wrangler.toml` bindings.

**Preview gets its own database.** A preview deploy writing real client notes is not acceptable, and the notes name real hiring managers.

### Decision 4 — This ticket ships a **standalone** editor at `/clients`, not the one screen.

The ticket says *"a vertical slice… usable on day one even if generation slips"*. The `dossier-design` skill says the note is editable *"on the same screen"* as generation. Those conflict, and the plain reading of #5 wins: #8 is the integration slice and owns `index.html`.

Build the editor from the same token layer and the same component grammar (button, field, card, heading) so #8 **absorbs** it rather than rewriting it. Route: `/clients`. Pages serves `public/clients.html` there and 308-redirects `/clients.html` to it.

### Decision 5 — No browser storage of the note. Client **ids** in URLs, never names.

The no-candidate-data rule does not literally cover the client note, but §5.3 flags the note as personal data: it names hiring managers and panel members. Keeping the browser-side rule one sentence rather than two is worth more than a draft-recovery feature.

So: no `localStorage`, no `sessionStorage`, no cookies, no `IndexedDB`. A dirty textarea warns on `beforeunload`, which `CHECKLIST.md` already mandates for pasted input. Client ids are UUIDs and appear in `?client=<uuid>`; a client **name** in a URL leaks into browser history and referrers.

### Decision 6 — Branding stays in `tokens.css`; the agency row holds `send_format` and `renderer`.

AC2 lists branding as agency configuration, and `README.md` puts branding in `public/tokens.css` as custom-property overrides. Both are right, and the resolution is mechanical: branding must apply **before first paint** and cannot wait on a `fetch`, so it belongs in CSS. The agency row holds the two things read at generation and render time. Do not add branding columns.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

All paths are relative to `~/Desktop/saulera-dossier-engine` unless marked otherwise.

- `README.md` (whole file, ~120 lines) — Why: **Decisions** and **Engine and config** are the two sections AC6 writes into and Decision 2 corrects. The engine/config split governs Decision 3.
- `DEPLOY.md` (§1 "Connect the Pages project", §5 "Secrets", and "Deploying" at the bottom) — Why: §1 says *"There is no `functions/` directory"* and gives the rule that `functions/` goes at the repo root, never under `public/`. §5 says there are no secrets. The bottom section says push does not deploy.
- `wrangler.toml` (all 9 lines) — Why: the file Decision 3 deliberately does **not** put a binding in. Its header comment claims "no Functions" and must change.
- `src/render/index.js` (lines 11-26) — Why: `RENDERERS` is the single source of truth for valid `agency.renderer` values. Import it in `src/store.js` rather than hard-coding `'appendix' | 'inline'`, so #9's `.docx` renderer needs no migration.
- `src/pack.js` (lines 96-117, `assertPack`) — Why: the house validation idiom. Throw with a readable message naming the field, not a generic error. Mirror this in `src/store.js`.
- `test/smoke.test.js` (lines 1-25) — Why: the exact test-file idiom. `node:test` + `node:assert/strict`, `readFileSync` for fixtures, resolve the repo root from `import.meta.url`. Zero test dependencies.
- `test/provenance.test.js` (lines 1-45) — Why: the adversarial-test posture and the fixture-builder pattern (`packWith`, `claim(over = {})`). `test/store.test.js` should read like this.
- `public/index.html` (whole file, ~95 lines) — Why: the current token usage, the inline-`<style>` convention, and the stale paragraph advertising `POST /api/health`, deleted in `3a003ac`. This ticket is the one that gives the deployment a real surface, so fix that paragraph deliberately.
- `public/tokens.css` (whole file) — Why: every colour, space, radius and font the screen may use, and the naming convention any new property must follow.
- `spike/inputs/client-note.md` — Why: **what a real note looks like.** Markdown, headed sections, roughly 1.8 KB. Used as the local seed row and as a length fixture. It tells you the textarea is the primary surface and needs real height.
- `scripts/setup-access.py` (whole file) — Why: the pattern `scripts/setup-d1.py` copies. Token from wrangler's config, `call()` helper, idempotent-by-skipping.
- `scripts/deploy.py` (docstring and `main()`) — Why: **push does not deploy on this project.** Also the source of `DEFAULT_ACCOUNT` and the API-call idiom.
- `~/Desktop/saulera/functions/api/contact.js` (whole file, ~110 lines) — Why: **the Function pattern to mirror.** `onRequestPost(context)`, `const { request, env } = context`, guard first, `try { await request.json() } catch { return json({error:"bad_json"}, 400) }`, `String(x || "").trim().slice(0, N)`, and a local `json(obj, status, cache)` helper defaulting to `no-store`.
- `~/Desktop/saulera/functions/api/slots.js` (lines 10-14, 52-58) — Why: the `onRequestGet` shape and the same `json()` helper.
- `~/Desktop/saulera/site.js` (lines 1-70) — Why: the vanilla-JS idiom the ticket asks for. IIFE, `const` config objects at the top, template literals for markup, no framework, no build step.

### Do NOT read these as guidance (known stale)

- `.claude/verify-deploy.sh` — written for #3's `/api/health` Function and an Access-deferred world. Both are gone. Do not extend it; do not run it as a gate.
- Architecture §5.1, §5.2, §5.6 (Secrets), §6.4 — struck through in the doc itself by the 27 Jul amendment at the top. Read the amendment, not the struck prose.
- The `dossier-design` skill's *"Open design decisions"* section — the visual base **is** decided (neutral, not Sunrise). Do not reopen it.

### New Files to Create

- `migrations/0001_init.sql` — the whole schema, and the artefact AC3 and AC6 point at. Single source of truth; there is no separate `schema.sql` to drift from it.
- `src/store.js` — store logic and validation as functions taking a D1-shaped `db`. No HTTP, no `Response`.
- `src/http.js` — the shared `json()` helper, `readJson()`, `sameOrigin()`, `errorResponse()`. Lives in `src/` so it is never routed as an endpoint.
- `functions/api/clients.js` — `onRequestGet` (list), `onRequestPost` (create).
- `functions/api/clients/[id].js` — `onRequestGet` (read one), `onRequestPut` (update name and note).
- `functions/api/agency.js` — `onRequestGet`, `onRequestPut`.
- `functions/api/events.js` — `onRequestPost` (record one), `onRequestGet` (counts per client plus total).
- `public/clients.html` — the editor screen.
- `public/app.css` — component rules, built entirely from `tokens.css` properties. Shared forward with #8.
- `public/clients.js` — the screen's behaviour, vanilla, no build.
- `test/schema.test.js` — parses `migrations/0001_init.sql`.
- `test/store.test.js` — store logic and validation against a hand-rolled fake D1.
- `test/helpers/fake-d1.js` — ~40 lines. Records `prepare`/`bind`/`first`/`all`/`run` calls and returns canned rows. **Does not execute SQL.**
- `scripts/setup-d1.py` — binds `DB` on both Pages environments, idempotently, and confirms by re-reading.
- `scripts/dev.py` — resolves the preview database uuid, applies the migration locally against it, and launches `pages dev` with the same uuid. Closes R4.

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [D1 Workers Binding API — prepared statements](https://developers.cloudflare.com/d1/worker-api/prepared-statements/)
  - Sections: `prepare()`, `bind()`, `first()`, `all()`, `run()`, `batch()`
  - Why: the exact return shapes. `all()` returns `{ results, success, meta }` and the rows are under `.results`; `first()` returns the row object or `null`; `first("col")` returns a scalar. Getting this wrong is R7.
- [Pages Functions — bindings](https://developers.cloudflare.com/pages/functions/bindings/#d1-databases)
  - Why: `context.env.DB` access, and `wrangler pages dev <dir> --d1 BINDING=ID` for local development with local persistence.
- [D1 — local development](https://developers.cloudflare.com/d1/best-practices/local-development/)
  - Why: `--local` state lives under `.wrangler/state/v3/d1/`, already gitignored. Local and remote migrations are separate operations.
- [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
  - Why: `wrangler d1 migrations apply <DB> --local|--remote`, and the fact that it creates a `d1_migrations` bookkeeping table. See the GOTCHA on task 8.
- [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
  - Why: verified 27 Jul 2026 — free plan 10 databases, 500 MB per database, 5 GB per account; max string/BLOB/row 2 MB; max SQL statement 100 KB; max bound parameters per query 100; 50 queries per invocation on free. The 100 KB statement cap does **not** cap the note, because bound parameters travel outside the statement text. `NOTE_MAX` is a product judgement, not a platform limit.
- [Pages project API — edit](https://developers.cloudflare.com/api/resources/pages/subresources/projects/methods/edit/)
  - Why: the binding shape for `scripts/setup-d1.py`: `{"deployment_configs": {"production": {"d1_databases": {"DB": {"id": "<uuid>"}}}}}`. Whether PATCH merges or replaces `deployment_configs` is **not documented**, so GET, merge locally, PATCH, then GET again to confirm.
- [Pages build image](https://developers.cloudflare.com/pages/configuration/build-image/)
  - Why: v3 defaults to Node 22.16.0, v2 to 18.17.1, and the v3 system does **not** read `package.json` → `engines`. This project is on v3 (see *VERIFIED FACTS*).
- `.claude/skills/dossier-design/references/CRAFT.md` (after task 6 copies it) — read **before writing any CSS**.
- `.claude/skills/dossier-design/references/CHECKLIST.md` — run **before committing** any UI change.

### Patterns to Follow

**Function shape** (from `~/Desktop/saulera/functions/api/contact.js`) — guard the binding, then same-origin on mutations, then the body, then the fields:

```js
export async function onRequestPost(context) {
  const { request, env } = context;

  // Binding first, deliberately. A missing binding is a deployment fault the caller cannot
  // fix, so 503 is the honest answer. This is not the bug 7df2125 fixed: there the *body*
  // had to come before a secret check, because a malformed body is the caller's fault.
  if (!env.DB) return json({ error: "not_configured" }, 503);
  if (!sameOrigin(request)) return json({ error: "cross_origin" }, 403);

  let p;
  try { p = await request.json(); } catch { return json({ error: "bad_json" }, 400); }
  // ...
}
```

**Error vocabulary.** Lowercase snake_case codes in `{ error: "..." }`, matching the saulera Functions: `bad_json`, `missing_fields`, `not_configured`. Add only what is needed: `not_found` (404), `too_long` (400), `cross_origin` (403), `bad_renderer` (400), `unexpected_fields` (400).

**Validation idiom** (from `src/pack.js:96`) — throw with the field named:

```js
if (typeof pack[field] !== "string") throw new Error(`pack: ${field} must be a string`);
```

**Every SQL value is a bound parameter.** No template-literal interpolation of user input into SQL, ever. `test/store.test.js` asserts this directly, because it is a security property and not a style preference.

**Comment register.** Comments here explain *why the code is shaped this way*, usually citing a ticket or an architecture section, written as prose sentences. See the header of `src/render/index.js` or `test/provenance.test.js`.

**Visible copy.** en-GB, sentence case, no em dashes, no en dashes, no "not X but Y", active voice. A control says what it does: **Add client**, **Save note**, never **Submit**. An error says what went wrong and how to fix it, without apologising. The full copy deck is fixed in *DESIGN SPEC* — use those strings.

---

## DESIGN SPEC

This section exists to close R6. The `dossier-design` skill mandates a two-pass method, and a plan that says "follow the skill" leaves the whole visual judgement open at the point where an implementing agent is least likely to spend effort. So the design is **specified here** and task 24's job is to critique and confirm it, not to invent it. Deviate only with a reason written into the completion report.

### The subject, and what the design has to say

The note is the product. The screen's thesis is therefore *how much is written down*, per client, and one calm surface large enough to write real prose in. The failure mode the architecture actually fears (§6.5) is the note staying empty, so the screen's job is to make "what belongs in here" obvious without nagging.

### Signature element — the note scaffold rail

One bold move, spent once. Beside the textarea sits a short static rail listing the four things a client note holds, taken from §5.3's own words:

- Their process and stages
- Who sits on the panel
- What each stage tests
- Why candidates were turned down

It is **information, not decoration**: it is the client-knowledge schema the architecture says does not exist yet, rendered as prompts rather than as fields. It stays visible while writing, unlike placeholder text, which vanishes at the first keystroke and is exactly the wrong behaviour for a surface people abandon. It does not collapse, animate or count anything.

This is the answer to *"would I have produced this for any similar brief?"* — no. It only makes sense for a product whose thesis is that a specific kind of knowledge compounds.

### Layout

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Client knowledge                                                            │
│  Notes on how each client hires. Read on every pack.                         │
├────────────────────────────┬─────────────────────────────────────────────────┤
│ CLIENTS                    │  Ashdown Park Community Healthcare              │
│                            │                                                 │
│ ▸ Ashdown Park Comm…       │  What we know about how they hire               │
│   1,842 characters · 6 pk  │  ┌───────────────────────────────────────────┐  │
│                            │  │ ## Their process                          │  │
│   Sussex Care Partners     │  │                                           │  │
│   0 characters · 0 packs   │  │ Two stages. First a 30-minute…            │  │
│                            │  │                                           │  │
│  ─────────────────────     │  │                    (65–75ch measure,      │  │
│  Client name               │  │                     ~24 rows, resizable)  │  │
│  [                    ]    │  │                                           │  │
│  [ Add client ]            │  └───────────────────────────────────────────┘  │
│                            │                                                 │
│                            │  [ Save note ]   Saved 14:32                    │
│                            │                                                 │
│                            │  WHAT BELONGS IN A NOTE      ← signature rail   │
│                            │  Their process and stages                       │
│                            │  Who sits on the panel                          │
│                            │  What each stage tests                          │
│                            │  Why candidates were turned down                │
├────────────────────────────┴─────────────────────────────────────────────────┤
│  THIS DEPLOYMENT   Sources in packs: (•) In an appendix ( ) Beside each claim │
│                    How packs are sent: [ Email body ▾ ]                      │
└──────────────────────────────────────────────────────────────────────────────┘
```

One sentence of prose: a narrow client rail whose rows are mostly a readout of how much is written down, beside one wide calm writing surface with its scaffold underneath, and the deployment's own configuration parked at the bottom where it is found once and then ignored.

**Breakpoints.** Two columns above 860px (rail `280px`, editor `1fr`). Below that, single column: heading, client list, add-client form, editor, scaffold, agency strip. The scaffold sits below the textarea in both layouts; it is a rail by position, not by orientation. Down to 360px with no horizontal page scroll.

**Zone rhythm.** `--space-12` (48px) between the three zones (heading, rail/editor, agency strip), `--space-4` (16px) within a zone, `--space-2` between a label and its control. The pacing is whitespace, not dividers. One hairline: above the agency strip, because whitespace alone cannot say "this is configuration, not content".

### Palette roles (60/30/10 through existing tokens)

| Role | Token | Share |
|---|---|---|
| Page | `--background` `#ffffff` | ~60% |
| Client rail, textarea field, agency strip | `--surface` `#f5f5f5` | ~30% |
| Primary action (**Save note**, **Add client**), focus ring, selected-row marker | `--accent` `#0099ff` | ≤10% |
| Body and note text | `--text-primary` `#1d1d1d` | — |
| Row meta, scaffold items, saved-state line | `--text-muted` (see below) | — |
| Hairline above the agency strip, field borders | `--border` `#595959` | — |

**Do not spend `--warning` / `--unverified` here.** Those are reserved for #8's provenance marks and must not be trained as "something needs attention" on a save button. Save failure uses `--danger` for its text only.

**Contrast checked at definition time, not in review.** `--text-muted` `#8c8c8c` on `--surface` `#f5f5f5` is roughly **2.9:1**, which **fails** the 4.5:1 body-text MUST — and row meta and scaffold items both sit on `--surface`. So **darken the token** to `#6b6b6b` or darker (~4.6:1 on `#f5f5f5`), rather than working around it per-component. That fixes it for #8 too. Recheck the pairing after changing it, and note it in the completion report and the README, because it edits an engine-side token every agency inherits.

### Type ramp

A ~1.2 ratio from a 14px UI base, with the note itself at 16px because it is prose a person writes and rereads (`CRAFT.md`: prefer 16px for the pack; the note is the same kind of text). Add to `tokens.css`:

```css
--text-caption: 12px;   /* row meta, scaffold items */
--text-body:    14px;   /* UI chrome, labels, buttons */
--text-note:    16px;   /* the textarea and any rendered note prose */
--text-h4:      17px;
--text-h3:      20px;   /* the selected client's name */
--text-h2:      24px;   /* page h1, matching index.html's existing 24px */
```

Nothing below 12px anywhere. Emphasis is weight or size, never colour alone. `text-wrap: balance` on the heading.

### Motion

One authored moment: the saved-state line fading in over **200ms** on `opacity` only, with `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`. Everything else is a `150ms` `opacity`/`transform` response on press and hover. No entrance animation on the client list, because it rebuilds on every save. Under `prefers-reduced-motion: reduce`, final states render instantly, which the existing block in `index.html` already handles.

### Copy deck — use these strings verbatim

| Where | Copy |
|---|---|
| Page heading | Client knowledge |
| Page sub | Notes on how each client hires. Read on every pack. |
| Rail heading | Clients |
| Empty list | No clients yet. Add the first one, then write down what you know about how they hire. |
| Add-client label / button | Client name · **Add client** |
| Row meta | 1,842 characters · 6 packs |
| No client selected | Pick a client to read or edit its note. |
| Textarea label | What we know about how they hire |
| Save button | **Save note** · while saving: **Saving…** |
| Saved states | Saved 14:32 · Not saved yet · Unsaved changes |
| Save failed | Could not save. Your text is still here. Try again. |
| Session expired | Your session expired. Reload the page to sign in again. |
| Note too long | That note is longer than 100,000 characters. Shorten it and save again. Your text is still here. |
| Name missing | Enter a client name. |
| Unknown client in URL | That client does not exist. Pick one from the list. |
| Scaffold heading | What belongs in a note |
| Scaffold items | Their process and stages · Who sits on the panel · What each stage tests · Why candidates were turned down |
| Agency strip heading | This deployment |
| Renderer control | Sources in packs · In an appendix · Beside each claim |
| Send format control | How packs are sent · Email body · Attachment · ATS field |

No em dashes, no en dashes, no apologies, no exclamation marks. Every error names what to do next, and two of them explicitly promise the text survived, because that is the thing a person is afraid of at that moment.

---

## IMPLEMENTATION PLAN

Phases run top to bottom. Phase 2 is a gate: nothing after it is worth building until it passes.

### Phase 0: Provisioning, tooling, and the design skill (tasks 1-6)

**Independent of:** everything below, except that Phase 1's migration needs the databases to exist.

Nothing here writes product code. It exists because two of its steps get skipped and then cost an hour each.

### Phase 1: Schema, the boundary tests, and a deterministic dev loop (tasks 7-10)

**Depends on:** Phase 0.

The schema comes first because AC3 and AC4 are the criteria most likely to erode, and a test written now fails later if #6 or #8 widens them. `scripts/dev.py` lands here rather than later because every subsequent task uses it.

### Phase 2: ⛔ THE GATE — a three-file vertical slice, deployed and verified (tasks 11-15)

**Depends on:** Phase 1.

Closes R1, R2 and R7 in one deploy: the binding resolves, a returned `functions/` directory is picked up, a Function importing `../../src/` bundles, and D1's real return shapes are exercised. The code written here is real and kept; it is the first slice of the feature, not a spike.

**Do not proceed to Phase 3 until task 15 passes.**

### Phase 3: Complete the store and the HTTP layer (tasks 16-23)

**Depends on:** Phase 2 (the gate).

### Phase 4: The editor screen (tasks 24-28)

**Depends on:** Phase 3.

Run the two-pass method against *DESIGN SPEC*: critique the specified design first, then build, then critique with screenshots in real Safari **and** Chrome.

### Phase 5: Documents, deploy, and the decision record (tasks 29-32)

**Depends on:** Phases 1-4.

AC6 lives here, and so does the correction of three artefacts that currently contradict the code.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

Run every wrangler command under Node ≥22 (this machine's default `node` is v20.20.2):

```bash
export PATH="$HOME/.nvm/versions/node/v24.11.0/bin:$PATH"   # or: nvm use 24
```

And pin the version on every invocation — `npx wrangler@4.114.0 …`, never bare `npx wrangler`. Bare `npx` resolved to a cached 4.86.0 under Node 20 and to 4.114.0 under Node 24 on this machine, which is two different tools depending on which shell you are in.

### 1. CREATE branch

- **IMPLEMENT**: `git checkout -b feature/client-knowledge-store` from a clean `main`.
- **PATTERN**: #3 used `feature/deploy-skeleton-a` and `-b`.
- **GOTCHA**: `main` is clean as of `468c95a`. Confirm before branching — anything uncommitted belongs to someone else's work.
- **VALIDATE**: `git status --porcelain | wc -l` prints `0`; `git branch --show-current` prints `feature/client-knowledge-store`.
- **SATISFIES**: process.

### 2. UPDATE `package.json` — scripts only. **Do not add wrangler as a dependency.**

- **IMPLEMENT**: add three scripts. Change nothing else: no new `devDependencies`, no `engines` field.
  - `"dev": "python3 scripts/dev.py"`
  - `"db:local": "python3 scripts/dev.py --migrate-only"`
  - `"db:preview": "npx wrangler@4.114.0 d1 migrations apply dossier-engine-preview --remote"`
  - `"db:remote": "npx wrangler@4.114.0 d1 migrations apply dossier-engine --remote"`

  `db:preview` and `db:remote` are separate on purpose: the gate at task 15 migrates the **preview** database because a branch deploy binds `deployment_configs.preview`, and production is migrated only in task 32's post-merge block. Conflating them produces a failure that looks like an unresolved binding.
- **PATTERN**: `package.json` already keeps `test`, `spike`, `spike:tamper`. Same terse style, no comments.
- **GOTCHA**: `scripts/dev.py` does not exist until task 9. Nothing invokes it before task 10, so declaring the script now is harmless, but `npm run dev` typed between here and task 9 reports a missing file. That is the expected state, not a broken setup.
- **GOTCHA — why wrangler is pinned in scripts and not installed.** The Pages CI build runs `npm install` because it sees `package.json`. wrangler pulls platform-specific `workerd` binaries the deployment never runs. The build image is v3 (Node 22.16.0), so a devDependency *would* work — this is a free choice for a lean CI install, not a forced one. Record it that way if asked.
- **GOTCHA**: do **not** add `"engines": { "node": ">=22" }`. Cloudflare's v3 build system does not read `package.json` → `engines`, so it protects nothing in CI, and it does not stop a Node-20 `npm test` either. It would read as a guarantee that is not there. The Node requirement belongs in `DEPLOY.md` prose.
- **GOTCHA**: leave `"test": "node --test test/*.test.js"` exactly as it is. `055ef72` fixed it because `node --test test/` resolves the directory as a module on Node ≥22 and dies before reading a single test. Do not "tidy" it back.
- **GOTCHA**: the suite must keep passing on v20.20.2 **and** v24.11.0 — that is why `test/helpers/fake-d1.js` is hand-rolled rather than using `node:sqlite`, which does not exist on v20.
- **VALIDATE**: `git diff package.json` shows three added script lines and nothing else; `npm test` still reports 16 passing.
- **SATISFIES**: tooling for AC1-AC6. Closes R10.

### 3. CREATE the two D1 databases

- **IMPLEMENT**:
  ```bash
  npx wrangler@4.114.0 d1 create dossier-engine
  npx wrangler@4.114.0 d1 create dossier-engine-preview
  ```
- **PATTERN**: per-agency naming is `dossier-<agency>` and `dossier-<agency>-preview`. This first deployment is saulera's own, hence the plain names.
- **GOTCHA**: needs a logged-in wrangler. `scripts/deploy.py` reads `~/.wrangler/config/default.toml` for an OAuth token; if `d1 create` reports a permissions error, run `npx wrangler@4.114.0 login` again so the token carries `d1:write`.
- **GOTCHA**: `wrangler d1 list` was empty on 27 Jul 2026. If it is not empty when you run it, stop and find out what else is using the account before creating anything.
- **GOTCHA**: a database uuid is not a credential — the *binding* is what grants access — but there is no reason to commit one. Let `setup-d1.py` and `dev.py` resolve ids by name.
- **VALIDATE**: `npx wrangler@4.114.0 d1 list` shows both; `npx wrangler@4.114.0 d1 info dossier-engine` returns without error.
- **SATISFIES**: AC6.

### 4. CREATE `scripts/setup-d1.py`

- **IMPLEMENT**: Python 3, no third-party imports. Resolve both database ids by name through `GET /accounts/{a}/d1/database`, `GET` the Pages project, merge `{"d1_databases": {"DB": {"id": <uuid>}}}` into `deployment_configs.production` (production db) and `deployment_configs.preview` (preview db), `PATCH` the merged object, then **`GET` again and assert both bindings are present**. Idempotent: if both are already correct, print `ok` and change nothing.
- **PATTERN**: `scripts/setup-access.py` and `scripts/deploy.py` — same `API_ROOT`, same `DEFAULT_ACCOUNT = "fc9a7b58725102d7d44da605e562d92c"`, same `call(method, path, token, payload)`, same wrangler-token reader, same idempotence-by-skipping. `ea0e085` rewrote `setup-access` in Python because *"the shell version could half-create an app"* — same reasoning, so Python.
- **IMPORTS**: `json`, `os`, `re`, `sys`, `urllib.request`, `urllib.error`.
- **GOTCHA**: **whether PATCH merges or replaces `deployment_configs` is not documented.** GET first, merge locally, PATCH the whole merged object, then GET to confirm. A silent replace would otherwise drop the project's other deployment config.
- **GOTCHA**: `deployment_configs.{production,preview}.d1_databases` exists in the response schema and is currently `null` on both (verified 27 Jul 2026). A `null` is the expected starting state, not an error.
- **GOTCHA**: the wrangler OAuth token carries `pages:write`, which is enough. `setup-access.py` needed a separate `CF_API_TOKEN` only because Access is a different scope. Do not copy that requirement across.
- **VALIDATE**: run it twice. The second run prints `ok`, reports no change, and its confirming GET shows `d1_databases.DB` on both environments with **different** uuids.
- **SATISFIES**: AC6, Decision 3. Reduces R1.

### 5. UPDATE `wrangler.toml`

- **IMPLEMENT**: rewrite the header comment. It currently says *"Static site only — no Functions, no runtime dependencies."* That is now false. Say: Functions exist for storage only; there is still no model call and no secret; and the D1 binding is deliberately configured per deployment rather than here, because a `database_id` is per-agency config and this file is engine. Do **not** add a `[[d1_databases]]` block.
- **PATTERN**: the existing comment block's register — a reason per line, load-bearing fact last (`name` must match the Pages project or the build fails).
- **GOTCHA**: leave `name` and `pages_build_output_dir` untouched. `pages_build_output_dir` is required for a Pages wrangler config.
- **GOTCHA**: note in the comment that once a field lives in this file Cloudflare stops allowing it to be edited in the dashboard. That is the trap that would make Decision 3 expensive to reverse, and it belongs next to the decision.
- **VALIDATE**: `grep -c d1_databases wrangler.toml` prints `0`; the Level 1 doc-drift grep passes for this file.
- **SATISFIES**: Decision 3. Part of R3.

### 6. COPY the `dossier-design` skill into this repo

- **IMPLEMENT**: copy `~/Desktop/saulera/products/agency-submission-dossier/.claude/skills/dossier-design/` to `.claude/skills/dossier-design/` here, so it activates in this repo. Then **read `references/CRAFT.md` end to end before writing any CSS.**
- **PATTERN**: #3's comment on the issue says to copy or symlink it. Copy, not symlink: the source lives under a gitignored `products/` directory in another repo, and a symlink into a gitignored path is a broken reference for anyone else.
- **GOTCHA**: the skill's *"Open design decisions"* section says the visual base is undecided. **It is decided** — neutral, not saulera Sunrise, recorded in `README.md` under Decisions and in #5's second comment. Do not reopen it.
- **VALIDATE**: `ls .claude/skills/dossier-design/references/` lists `CRAFT.md` and `CHECKLIST.md`.
- **SATISFIES**: AC5 quality. Part of R6.

### 7. CREATE `migrations/0001_init.sql`

- **IMPLEMENT**: three tables, one index, the seed agency row. The absence of a fourth table is the point of the file, so say so in a comment.

  ```sql
  -- Schema for the submission dossier engine (#5).
  --
  -- Architecture §5.3: four entities, and the interesting thing about them is which ones
  -- persist. Two do. Candidate, CV and Pack are transient — passed in, used, never written
  -- down. There is no candidate table, no cv table and no pack table, and test/schema.test.js
  -- fails if a later ticket adds one. §5.6 calls that "the one boundary that is expensive to
  -- unpick".

  -- Agency: one per deployment. Configuration, not data. Branding is NOT here; it lives in
  -- public/tokens.css because it has to apply before first paint (plan Decision 6).
  CREATE TABLE agency (
    id          INTEGER PRIMARY KEY CHECK (id = 1),
    name        TEXT NOT NULL DEFAULT '',
    send_format TEXT NOT NULL DEFAULT 'email_body',
    renderer    TEXT NOT NULL DEFAULT 'appendix',
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  INSERT INTO agency (id) VALUES (1);

  -- Client: the durable asset. Name plus one free-text knowledge note — process, stages,
  -- panel roles, standards, past rejection reasons. Owned and edited by the agency (§4).
  -- The note is business-context personal data: it names hiring managers and panel members.
  CREATE TABLE clients (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    note       TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- The non-personal event counter: client, timestamp, duration. Nothing else, ever.
  -- Sole mechanism behind the epic's primary metric (PRD §7, packs generated versus
  -- submissions made). No names, no CV content, no pack content.
  CREATE TABLE events (
    id          INTEGER PRIMARY KEY,
    client_id   TEXT    NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    duration_ms INTEGER NOT NULL
  );

  CREATE INDEX events_by_client ON events (client_id);
  ```
- **PATTERN**: the comment register of `src/pack.js`'s header — cite the section, say why the shape is what it is.
- **GOTCHA**: **no `CHECK` constraint on `renderer`.** #9 adds a `.docx` renderer and a CHECK would need a migration to accept it. Validate in `src/store.js` against `RENDERERS` imported from `src/render/index.js`, so the valid set has one definition.
- **GOTCHA**: `id INTEGER PRIMARY KEY` is a rowid alias, so `events.id` autoincrements without the keyword. `AUTOINCREMENT` adds a bookkeeping table for no benefit.
- **GOTCHA**: `ON DELETE CASCADE` fires only when foreign keys are enforced. D1 enforces them by default and rejects a violating insert, which is what we want: an event for an unknown client is a bug, not a row.
- **GOTCHA**: timestamps are `TEXT` from `datetime('now')`, UTC `YYYY-MM-DD HH:MM:SS`. Do not mix `CURRENT_TIMESTAMP` in one place with `datetime('now')` in another.
- **VALIDATE**: applied by task 10; the file itself is validated by task 8.
- **SATISFIES**: AC1, AC2, AC3, AC4.

### 8. CREATE `test/schema.test.js`

- **IMPLEMENT**: read `migrations/0001_init.sql` as text and assert:
  1. The set of `CREATE TABLE` names is exactly `{agency, clients, events}`.
  2. No table or column identifier matches `/candidate|^cv$|resume|\bpack\b|brief/i`. The failure message names the offender and restates why the boundary exists in one line.
  3. `events`' columns are exactly `{id, client_id, created_at, duration_ms}`. A fifth column fails.
  4. `clients` has `note`; `agency` has `renderer` and `send_format`.
- **PATTERN**: `test/provenance.test.js`'s header explains *why the file exists* before any test runs. Write the same kind of header: this file exists because AC4 is the first thing that gets silently descoped, and because *"there is no candidate table"* is said out loud to a clinical staffing client.
- **IMPORTS**: `node:test`, `node:assert/strict`, `node:fs`, `node:path`, `node:url`. Resolve the repo root exactly as `test/smoke.test.js` does at lines 15-17.
- **GOTCHA**: parse the **file**, not the live database. `wrangler d1 migrations apply` creates a `d1_migrations` bookkeeping table, so a `sqlite_master` query legitimately returns a fourth table and a database-based "exactly three" assertion would fail for the wrong reason.
- **GOTCHA**: strip `--` comment lines before matching, or the word "pack" inside the header comment fails the suite. Match identifiers, not free text, so `send_format` is not mistaken for anything.
- **VALIDATE**: `npm test` passes. **Then prove it bites**: temporarily append `CREATE TABLE candidates (id TEXT);`, confirm `npm test` fails, remove it, confirm it passes. Do the same with a fifth `events` column. Record both in the completion report.
- **SATISFIES**: AC3, AC4. Closes R5 layer one.

### 9. CREATE `scripts/dev.py`

- **IMPLEMENT**: one command that makes the local loop deterministic.
  1. Resolve the **uuid** of `dossier-engine-preview` (via `wrangler d1 info --json`, or the account API like `setup-d1.py` does).
  2. Apply `migrations/` to the local database for that uuid: `wrangler d1 migrations apply <uuid> --local`.
  3. Unless `--migrate-only`, exec `wrangler pages dev public --d1 DB=<uuid>`.

  Print the uuid it resolved on both paths, so a mismatch is visible rather than mysterious.
- **PATTERN**: `scripts/deploy.py` — a docstring explaining *why the script exists* before the code, `subprocess.run` for wrangler, `sys.exit` with a readable message.
- **IMPORTS**: `json`, `os`, `subprocess`, `sys`.
- **GOTCHA — this is the whole reason the script exists (R4).** `wrangler pages dev --d1 BINDING=VALUE` keys its local SQLite file by `VALUE` **verbatim**, while `wrangler d1 migrations apply <name> --local` resolves `<name>` to the real uuid and keys its file by that. Pass a *name* to one and a *uuid* to the other and they open different local databases: the migration reports success and the API sees no tables. Passing the same uuid to both removes the class of problem. Say this in the docstring.
- **GOTCHA**: pass the wrangler version pin through, and require Node ≥22 in the subprocess environment. If no Node ≥22 is found, fail with the `PATH` export line rather than running and producing a confusing wrangler error.
- **GOTCHA**: `--migrate-only` exists so `npm run db:local` and `npm run dev` share one resolution path. Do not let them diverge into two implementations.
- **VALIDATE**: `npm run db:local` prints a uuid and applies the migration. `npm run dev` prints the **same** uuid and serves on `http://localhost:8788`.
- **SATISFIES**: tooling. Closes R4.

### 10. APPLY the local migration and seed one client

- **IMPLEMENT**: `npm run db:local`, then insert one client locally using `spike/inputs/client-note.md` as its note, so the screen is developed against a note of realistic length and shape rather than "hello".
- **PATTERN**: `test/smoke.test.js` already uses `spike/inputs/*` as the realistic fixture set.
- **GOTCHA**: local only. **Do not** add a seed to the migration. Production client data is the agency's, entered by the agency.
- **GOTCHA**: the fixture is headed `SYNTHETIC`. Keep that word in it so nobody mistakes it for a real client.
- **GOTCHA**: local and remote are separate databases. Applying locally does nothing to production, and vice versa.
- **VALIDATE**: `npx wrangler@4.114.0 d1 execute dossier-engine-preview --local --command "SELECT id, renderer FROM agency"` returns one row with `appendix`; a second query shows the client with a note of roughly 1,800 characters.
- **SATISFIES**: AC2, AC6, development.

---

### ⛔ PHASE 2 — THE GATE. Tasks 11 to 15 prove the deployment before the feature is built.

### 11. CREATE `src/store.js` — the minimum the gate needs

- **IMPLEMENT**: only what a `GET /api/clients` needs, and nothing more:
  ```js
  export class StoreError extends Error { constructor(code, status, message) { ... } }  // code + status
  export async function listClients(db)   // [{ id, name, updated_at, note_chars, packs }]
  ```
  `listClients` selects `id`, `name`, `updated_at`, `LENGTH(note) AS note_chars`, and a `COUNT` of events per client. One statement with a `LEFT JOIN` and a `GROUP BY`, ordered by `name`.
- **PATTERN**: `src/pack.js`'s module header for the comment register.
- **GOTCHA**: **`listClients` must not select `note`.** It returns `LENGTH(note) AS note_chars` instead. The list is the navigation and empty-state surface; shipping every note in it makes the payload grow without limit and puts personal data on a screen that does not need it.
- **GOTCHA (R7)**: `all()` returns `{ results, success, meta }` — the rows are `.results`. `first()` returns the row or `null`. `run()` returns metadata, not rows. This task is deliberately the first place that assumption meets a real database.
- **GOTCHA**: a client with no events must come back with `packs: 0`, not `null`. `COALESCE`, or count in the join.
- **VALIDATE**: `node -e "import('./src/store.js').then(m => console.log(Object.keys(m).sort().join(' ')))"` lists `StoreError listClients`.
- **SATISFIES**: AC1.

### 12. CREATE `src/http.js`

- **IMPLEMENT**:
  ```js
  export function json(obj, status = 200, cache = "no-store")
  export async function readJson(request)      // throws StoreError("bad_json", 400)
  export function sameOrigin(request)
  export function errorResponse(err)           // StoreError -> json({error: code}, status); else 500 {error:"internal"}
  ```
  The guard:
  ```js
  export function sameOrigin(request) {
    const site = request.headers.get("Sec-Fetch-Site");
    if (site) return site === "same-origin";      // every current browser sends this
    const origin = request.headers.get("Origin");
    if (!origin) return true;                     // curl and local scripts have no Origin
    return origin === new URL(request.url).origin;
  }
  ```
- **PATTERN**: copy `json()` from `~/Desktop/saulera/functions/api/contact.js` verbatim, including the `no-store` default. Do not invent a second JSON-response shape in this codebase.
- **IMPORTS**: `StoreError` from `./store.js`.
- **GOTCHA — why the guard exists.** Access is the door and it authenticates with a cookie. This is the bolt: a cross-site POST riding the reader's Access cookie is cheaper to rule out here than to reason about Cloudflare's cookie attributes. Apply it to **mutating methods only** (POST, PUT). Applying it to GET breaks authenticated curl and every debugging session.
- **GOTCHA**: do **not** hard-require `Cf-Access-Authenticated-User-Email`. That header is absent under `wrangler pages dev`, so requiring it makes local development impossible and the tests pass only in production. If you log it, log its presence, never the address.
- **GOTCHA**: `src/http.js` lives in `src/` on purpose. Anything under `functions/` is a route; a helper there would be a live endpoint.
- **VALIDATE**: `node -e "import('./src/http.js').then(m => console.log(Object.keys(m).sort().join(' ')))"` lists all four.
- **SATISFIES**: AC1, AC5 (safe editing).

### 13. CREATE `functions/api/clients.js` — `onRequestGet` only

- **IMPLEMENT**: guard `env.DB`, call `listClients`, return `{ clients: [...] }`. Wrap in `try`/`catch` returning `errorResponse(err)`. **No POST yet** — task 19 adds it.
- **PATTERN**: `~/Desktop/saulera/functions/api/slots.js` for the `onRequestGet` shape.
- **IMPORTS**: `../../src/store.js`, `../../src/http.js`. **These relative imports out of `functions/` are the thing task 15 is testing (R2).** Write them the natural way and let the gate tell you.
- **GOTCHA**: `functions/` sits at the **repo root**, never under `public/`. `DEPLOY.md` §1 says why: Pages resolves Functions from the project root, and a `functions/` directory under `public/` publishes the source as a static file where it never runs. `root_dir` is confirmed as `/`.
- **VALIDATE**: locally, task 14.
- **SATISFIES**: AC1.

### 14. VALIDATE the slice locally

- **IMPLEMENT**: `npm run dev`, then:
  ```bash
  curl -s http://localhost:8788/api/clients
  ```
- **GOTCHA**: expect the seeded client with `note_chars` around 1800 and `packs: 0`. An empty array means `dev.py` and the migration disagreed about the database — that is R4, and `dev.py` printed the uuids so you can see it. Re-read them.
- **GOTCHA**: a `503 not_configured` locally means the `--d1` flag did not reach wrangler. A `200` returning HTML means the route was not matched and the static fallback served `index.html`, because `public/` has no `404.html`.
- **VALIDATE**: the JSON above, with `note` absent from every row: `curl -s http://localhost:8788/api/clients | grep -c '"note"'` prints `0`.
- **SATISFIES**: AC1, AC3 (the list carries no note).

### 15. ⛔ GATE — deploy the slice to a branch preview and verify all three unknowns

The gate runs against a **preview deployment of this branch**, not production. That is what keeps it front-loaded: production only ever updates when someone runs `deploy.py` against `main`, which by definition is after the PR merges, and a gate that runs after the merge is not a gate.

- **IMPLEMENT**, in this order:
  1. **UPDATE `scripts/deploy.py`** to take an optional branch: `branch = sys.argv[2] if len(sys.argv) > 2 else "main"`, pass it in the `form={"branch": branch}` payload, and compare the built commit against `origin/<branch>` rather than always `origin/main`. Update the docstring's usage line. **Default to `main` so every existing invocation behaves identically.**
  2. `npm run db:preview` — apply the migration to the **remote preview** database, `dossier-engine-preview`. A branch deploy uses `deployment_configs.preview`, so this is the database it will bind, not production's.
  3. Commit, `git push -u origin feature/client-knowledge-store`, then `./scripts/deploy.py saulera-dossier-engine feature/client-knowledge-store`.
  4. Read the preview hostname off the deploy output or Pages → Deployments. A branch alias also exists, with the slash sanitised: `feature-client-knowledge-store.saulera-dossier-engine.pages.dev`.
  5. Verify, logged in through Access in a browser, that `GET /api/clients` on that hostname returns `{"clients":[]}` — an empty array, because the remote preview database has the schema and no client rows.
- **PATTERN**: **push does not deploy on this project.** `DEPLOY.md` and `deploy.py`'s docstring both say so: the GitHub-side push notification is broken and re-registering it needs an interactive OAuth flow. So `git push` then `deploy.py`, always.
- **GOTCHA — why the branch argument is not optional work.** `deploy.py` line 92 hardcodes `form={"branch": "main"}`. Run it unchanged from this branch and it builds `main`, which has no `functions/` directory, so `/api/clients` returns the `index.html` shell at `200`. That is *exactly* the R2a symptom in the table below, and an implementer would spend an hour chasing a routing problem that does not exist. The script's own mismatch warning will not save you: it compares the built commit against `origin/main`, and they match.
- **GOTCHA**: apply the **preview** remote migration before the deploy, not the production one. Migrating `dossier-engine` here would leave the preview database empty and produce a third failure mode that looks like the other two.
- **GOTCHA**: the preview hostname is behind Access too — #12 created a second application for `*.saulera-dossier-engine.pages.dev` precisely because a wildcard does not cover the apex. So the unauthenticated `302` assertion holds on preview exactly as on production.
- **GOTCHA**: **what this gate does and does not prove about R1.** It proves the mechanism: a project-level D1 binding reaches a CI-triggered build, and `context.env.DB` resolves. It proves that on the **preview** environment. Production's binding is a separate entry in `deployment_configs`, set by `setup-d1.py` in the same run and confirmed by its verifying GET, and exercised for real by the post-merge block in task 32. That is the honest split, and it is why task 32 keeps the fallback ladder available.
- **GOTCHA — what each possible failure means, because they look alike:**

  | Symptom | Cause | Fix |
  |---|---|---|
  | `503 {"error":"not_configured"}` | the `DB` binding did not resolve (**R1**) | re-run `scripts/setup-d1.py` and check its confirming GET; if it reports the binding present and the deploy still 503s, bind it in the dashboard under Settings → Bindings and redeploy |
  | `200` returning the `index.html` shell | `functions/` was not picked up (**R2a**) | confirm `functions/` is at the repo root and the project root directory is `/`; check the build log for a Functions step |
  | the build fails, or a `500` with a module error | the Function could not bundle its `../../src/` imports (**R2b**) | fallback ladder below |
  | rows come back but fields are `undefined` | D1 return shapes (**R7**) | `all().results`, not `all()` |

- **GOTCHA — the R2b fallback ladder**, in order, all build-free:
  1. Move the shared modules to `functions/_lib/store.js` and `functions/_lib/http.js`, and have the tests import from there (a test file can import from anywhere). Underscore-prefixed paths are conventionally not routed; if one does route, it exports no `onRequest*` handler and so is not a valid endpoint anyway.
  2. If that also routes or fails, add `public/_routes.json` excluding `/api/_lib/*`.
  3. Last resort, inline the store into each Function and keep `src/store.js` as the tested copy. Ugly, and only if 1 and 2 both fail.

  **Record which rung you landed on in the completion report** — #6 and #8 need to know, and every later `IMPORTS` line in this plan assumes rung zero.
- **GOTCHA**: Access applies at the edge and takes a minute or two to propagate. Retry once after 60 seconds before treating a `200` as real.
- **VALIDATE**:
  ```bash
  PREVIEW=feature-client-knowledge-store.saulera-dossier-engine.pages.dev
  curl -s -o /dev/null -w 'api: %{http_code} %{redirect_url}\n' "https://$PREVIEW/api/clients"
  # 302 -> cloudflareaccess.com
  ```
  Then, logged in via the browser: `GET /api/clients` on the preview hostname returns `{"clients":[]}`. **A `200` on the unauthenticated curl is a failure** — it would mean the API surface is public. Also confirm `./scripts/deploy.py` with no branch argument still builds `main`, so nothing existing regressed.
- **SATISFIES**: AC1, AC6. **Closes R2 and R7, and R1's mechanism; R1 on production closes at task 32.**

---

### 16. UPDATE `src/store.js` — the rest of the surface

- **IMPLEMENT**:
  ```js
  export const NAME_MAX = 120;
  export const NOTE_MAX = 100_000;
  export const SEND_FORMATS = ["email_body", "attachment", "ats_field"];

  export function newClientId()          // crypto.randomUUID()
  export function cleanName(raw)          // trim; missing_fields if empty; too_long past NAME_MAX
  export function cleanNote(raw)          // "" for null/undefined; too_long past NOTE_MAX; never trims interior
  export function cleanRenderer(raw)      // must be a key of RENDERERS, else bad_renderer
  export function cleanSendFormat(raw)    // must be in SEND_FORMATS, else missing_fields

  export async function getClient(db, id)                       // full row incl. note; throws not_found
  export async function createClient(db, { name, note })
  export async function updateClient(db, id, { name, note })    // partial: either or both
  export async function getAgency(db)
  export async function updateAgency(db, patch)                 // partial
  export async function recordEvent(db, { clientId, durationMs })
  export async function eventCounts(db)                         // { total, per_client: [...] }
  ```
- **IMPORTS**: `import { RENDERERS } from "./render/index.js";` — the single source of truth for valid renderer ids. Nothing else. `crypto.randomUUID()` is global on Node v20, v24 and in the Workers runtime (verified), so no import.
- **GOTCHA**: `updateClient` is a partial update, and `note: ""` is a legitimate value meaning "the agency cleared the note". Distinguish absent from empty with `Object.hasOwn(patch, "note")`, never with `if (patch.note)`. Getting this wrong silently discards a deliberate clear.
- **GOTCHA**: `cleanNote` must not trim, collapse or normalise the interior of the note. It is markdown the agency wrote, and `src/provenance.js` will later match verbatim quotes against it. `normalise()` in the verifier handles whitespace at comparison time; the store must not pre-mangle the source.
- **GOTCHA**: set `updated_at = datetime('now')` explicitly in every `UPDATE`. A column default applies only on `INSERT`.
- **GOTCHA**: build any partial `SET` clause from a fixed allow-list of column names and bind the values. Never interpolate a caller-supplied key into SQL.
- **VALIDATE**: task 18.
- **SATISFIES**: AC1, AC2, AC4, AC5.

### 17. CREATE `test/helpers/fake-d1.js`

- **IMPLEMENT**: a fake exposing D1's surface — `prepare(sql)` returning `{ bind(...args), first(col?), all(), run() }` — recording every `{ sql, args }` and returning queued canned results. About 40 lines.
- **PATTERN**: `test/provenance.test.js`'s fixture builders (`packWith`, `claim(over = {})`) — small, obvious, no cleverness.
- **GOTCHA**: **it does not execute SQL, and the tests must not pretend otherwise.** Real SQL is exercised by `wrangler d1 execute --local`, by task 14, and by task 23. Do not reach for `node:sqlite` to make it real: it does not exist on Node v20.20.2, this machine's default, and the suite must pass on both v20 and v24.
- **GOTCHA**: `bind()` returns the statement so calls chain. Model that, or every store call throws on `.first of undefined`.
- **VALIDATE**: used by task 18.
- **SATISFIES**: test coverage for AC1-AC5.

### 18. CREATE `test/store.test.js`

- **IMPLEMENT**: cover at minimum:
  - `cleanName`: empty and whitespace-only throw `missing_fields`; `NAME_MAX + 1` throws `too_long`; interior spaces survive.
  - `cleanNote`: `null`/`undefined` become `""`; `NOTE_MAX + 1` throws `too_long`; **a note with leading spaces, trailing newlines and blank lines round-trips byte-identical.**
  - `cleanRenderer`: `"appendix"` and `"inline"` pass because they are `RENDERERS` keys; `"docx"` throws today and will pass the day #9 adds it, with no change to this test.
  - `newClientId`: matches a UUID pattern; two calls differ.
  - `updateClient` with `{ note: "" }` issues an UPDATE setting `note` to `""`; with `{}` it issues no note write at all.
  - **Injection guard**: create and update a client named `Robert'); DROP TABLE clients;--`, then assert no recorded `sql` contains `DROP` or the literal name, and the name appears in the bound `args`.
  - `listClients` selects `LENGTH(note)` and **never** the bare `note` column.
  - `recordEvent` binds exactly the client id and the duration, and **no recorded events SQL contains `name`, `candidate`, `cv` or `note`.**
  - `eventCounts` returns `{ total, per_client }` with `total` derived from the canned rows.
- **PATTERN**: `test/provenance.test.js`'s adversarial posture and its `// ── section ──` dividers. Bias toward cases that would let something through.
- **GOTCHA**: `test/*.test.js` does not glob into `test/helpers/`, so the helper is never collected as a test. Keep it named `fake-d1.js`.
- **GOTCHA**: assert on `err.code` (`"too_long"`), not on message text. The HTTP layer maps codes; a message assertion breaks on a copy edit.
- **VALIDATE**: `npm test` green on v20.20.2 **and** v24.11.0.
- **SATISFIES**: AC1-AC5. Closes R5 layer two.

### 19. UPDATE `functions/api/clients.js` — add `onRequestPost`

- **IMPLEMENT**: read `{ name, note }`, create, return `{ client }` at `201`.
- **PATTERN**: the Function shape above. Guard order: binding, same-origin, body, fields.
- **VALIDATE**: task 23.
- **SATISFIES**: AC1, AC5.

### 20. CREATE `functions/api/clients/[id].js`

- **IMPLEMENT**: `onRequestGet` returns `{ client }` including the note, `404 not_found` for an unknown id. `onRequestPut` applies a partial update of `name` and `note` and returns the updated `{ client }`.
- **PATTERN**: Pages dynamic segments are `[id].js`; the value arrives as `context.params.id`.
- **IMPORTS**: `../../../src/store.js`, `../../../src/http.js` — **three** levels up from `functions/api/clients/`. (Or the task-15 fallback path, if the gate landed on a lower rung.)
- **GOTCHA**: coerce with `String(context.params.id)` before it reaches SQL. `params` values are arrays for `[[catchall]]` routes and it costs nothing to be certain.
- **GOTCHA**: PUT is the save path for the product's compounding asset. Every failure must be precise enough for the screen to keep the text and say what to do (R8). Never a bare `500` where `404` or `400` is the truth.
- **VALIDATE**: task 23, including the unknown-id 404 and a byte-exact note round-trip.
- **SATISFIES**: AC1, AC5.

### 21. CREATE `functions/api/agency.js`

- **IMPLEMENT**: `onRequestGet` returns `{ agency }`. `onRequestPut` applies a partial update of `name`, `send_format`, `renderer`, validating through `cleanRenderer` and `cleanSendFormat`.
- **GOTCHA**: there is exactly one agency row and no create path. If the row is missing, that is a migration that did not run, so return `503 not_configured` rather than inserting one. Silently creating it hides a broken deployment.
- **GOTCHA**: no branding fields (Decision 6).
- **VALIDATE**: task 23, including a rejected `renderer: "docx"`.
- **SATISFIES**: AC2.

### 22. CREATE `functions/api/events.js`

- **IMPLEMENT**: `onRequestPost` reads `{ client_id, duration_ms }`, validates that the client exists and that `duration_ms` is a non-negative integer, inserts one row, returns `{ ok: true }` at `201`. `onRequestGet` returns `{ total, per_client }`.
- **GOTCHA — the boundary guard.** **Reject any extra key in the body.** If the caller sends `candidate_name`, answer `400 unexpected_fields` rather than ignoring it. #6 is the caller and this is the only place a well-meaning change could start writing candidate data. Failing loudly is the mechanism that stops it and it costs three lines.
- **GOTCHA**: the timestamp is set by the **database**, not the caller. A caller that can set the time can rewrite the metric.
- **GOTCHA**: `duration_ms` is generation duration in milliseconds, produced by #6. This ticket ships the mechanism and the count so the metric exists before there is anything to count. See *OPEN QUESTIONS* on whether that is the right measurement.
- **VALIDATE**: task 23.
- **SATISFIES**: AC4. Closes R5 layer three.

### 23. VALIDATE the whole API locally

- **IMPLEMENT**: `npm run dev`, then the full sweep:
  ```bash
  BASE=http://localhost:8788
  curl -s $BASE/api/clients
  curl -s -X POST $BASE/api/clients -H 'content-type: application/json' -d '{"name":"Ashdown Park"}'
  curl -s $BASE/api/clients/<id>
  curl -s -X PUT $BASE/api/clients/<id> -H 'content-type: application/json' \
       --data-binary '{"note":"line one\n\nline three  "}'
  curl -s $BASE/api/clients/<id> | python3 -c 'import json,sys; print(repr(json.load(sys.stdin)["client"]["note"]))'
  curl -s -X PUT $BASE/api/clients/<id> -H 'content-type: application/json' -d '{"note":""}'
  curl -s $BASE/api/clients/does-not-exist
  curl -s -X POST $BASE/api/events -H 'content-type: application/json' -d '{"client_id":"<id>","duration_ms":8200}'
  curl -s -X POST $BASE/api/events -H 'content-type: application/json' -d '{"client_id":"<id>","duration_ms":1,"candidate_name":"X"}'
  curl -s -X POST $BASE/api/events -H 'content-type: application/json' -d '{"client_id":"nope","duration_ms":1}'
  curl -s $BASE/api/events
  curl -s -X PUT $BASE/api/agency -H 'content-type: application/json' -d '{"renderer":"docx"}'
  curl -s -X PUT $BASE/api/agency -H 'content-type: application/json' -d '{"renderer":"inline"}'
  ```
- **GOTCHA**: the note round-trip is the assertion that matters most. `repr()` must show `'line one\n\nline three  '` with the blank line and trailing spaces intact. Anything trimmed means `cleanNote` is mangling the verifier's source text.
- **GOTCHA**: the `candidate_name` request must be `400`. A `201` means task 22's guard is missing and the boundary is open.
- **GOTCHA**: `renderer: "docx"` must be `400` today; `"inline"` must be `200`.
- **VALIDATE**: every call returns the status described. Paste the outputs into the completion report.
- **SATISFIES**: AC1, AC2, AC3, AC4, AC5.

### 24. CRITIQUE the design spec, then commit to it

- **IMPLEMENT**: read *DESIGN SPEC* and `CRAFT.md`, then write the critique pass the skill mandates. Answer, in writing: does the layout serve *this* subject; is the signature rail information rather than decoration; would this have been produced for any similar brief; does the palette hold at 60/30/10; is the `--text-muted` contrast fix correct. Revise the spec where the critique lands, and record what changed.
- **PATTERN**: the skill's two-pass method. Pass one is plan-then-critique, and this task is pass one with the plan already written.
- **GOTCHA**: the anti-slop list: no cream-plus-serif-plus-terracotta, no near-black with a single acid accent, no purple gradients, no gradient text, no uniform rounded corners, no centred everything.
- **GOTCHA**: the accent budget is one action colour. `--warning` / `--unverified` are reserved for #8's provenance marks. Do not train them as "attention" on a save button.
- **VALIDATE**: the critique exists in writing before the first line of CSS, and is pasted into the completion report.
- **SATISFIES**: AC5. Part of R6.

### 25. UPDATE `public/tokens.css` and CREATE `public/app.css`

- **IMPLEMENT**: add to `tokens.css` the type ramp, `--ease-out`, two durations and a focus-ring width from *DESIGN SPEC*, and **darken `--text-muted`** to a value clearing 4.5:1 on `--surface` (`#6b6b6b` or darker). Then write `app.css`: component rules built only from custom properties.

  Move the shared parts of `index.html`'s inline `<style>` (`box-sizing`, body, `.card`, headings, the reduced-motion block) into `app.css` and have `index.html` link it, so #8 inherits one system rather than two.
- **GOTCHA**: **zero raw hex or px literals for colour, type, radius or spacing in component rules.** `1px` hairlines and `100%` are fine. This is what makes per-agency branding a variable swap.
- **GOTCHA**: `--text-muted` is engine-side and #8 will inherit the new value. Note the change in the completion report and in the `README.md` edit, because it is a token change made for a contrast MUST rather than a preference.
- **GOTCHA**: the textarea's container gets `min-width: 0` and wide content scrolls in its own `overflow-x: auto`. This is the real Safari and Chrome blowout trap `CRAFT.md` names, and a pasted note will contain long unbreakable lines.
- **GOTCHA**: animate `transform` and `opacity` only, list transition properties explicitly, never `transition: all`, never ease-in on an entrance.
- **VALIDATE**: `grep -nE '#[0-9a-fA-F]{3,6}' public/app.css` returns nothing. Contrast checked and recorded for body text, muted text on `--surface`, placeholder text and field borders.
- **SATISFIES**: AC5. Part of R6.

### 26. CREATE `public/clients.html` and `public/clients.js`

- **IMPLEMENT**: the screen from *DESIGN SPEC*, with the copy deck's exact strings. Behaviour:
  - Selected client is `?client=<uuid>` so reload and the back button both work. **Ids only, never names.**
  - Every `fetch` checks `res.ok` **and** the content type before parsing. A non-JSON response means the Access session expired: show *"Your session expired. Reload the page to sign in again."* (**R9**).
  - **A failed save keeps the text on screen** and leaves the editor dirty (**R8**). Never clear, never navigate away, never replace the textarea with an error.
  - `beforeunload` warns while the textarea is dirty.
  - All six interactive states on every control: hover, focus-visible, active, disabled, loading, error.
  - The saving state is honest: the button reads **Saving…** and disables. No fake progress, no spinner standing in for a wait.
  - The agency strip writes to `PUT /api/agency` on change and reports failure the same way as the note.
- **PATTERN**: `~/Desktop/saulera/site.js` for the vanilla idiom — IIFE, `const` config at the top, template literals for markup, no framework, no build. `public/index.html` for the document head, including `<meta name="robots" content="noindex, nofollow">`.
- **GOTCHA**: **no `localStorage`, `sessionStorage`, cookies or `IndexedDB`** (Decision 5). Grepped in Level 1.
- **GOTCHA**: `textContent`, never `innerHTML`, for anything holding a client name or a note. The note is agency-authored text and this is the only screen that renders it.
- **GOTCHA**: do not attach entrance animations to nodes rebuilt on every keystroke — they restart and blank. Gate behind a discrete-render class.
- **GOTCHA**: announce saving and saved states with `aria-live="polite"`.
- **GOTCHA**: no autosave-on-keystroke. An explicit **Save note** is one clear act, and autosave against a single-writer D1 row invites a write per keystroke for no benefit.
- **VALIDATE**: full keyboard path with no trap — add a client, select it, edit, save, switch renderer. Then task 28.
- **SATISFIES**: AC1, AC2, AC4, AC5.

### 27. UPDATE `public/index.html`

- **IMPLEMENT**: replace the paragraph advertising `POST /api/health`, deleted in `3a003ac`, with one sentence pointing at `/clients`, and link `app.css`.
- **GOTCHA**: do not build #8's screen here. One sentence and a link.
- **GOTCHA**: `public/` has no `404.html`, so unmatched paths fall through to `index.html` at `200`. Do not add one — `DEPLOY.md` records that #8 wants it, and adding it here changes documented behaviour outside this ticket's scope.
- **VALIDATE**: `grep -c api/health public/index.html` prints `0`; `/` and `/clients` both load locally.
- **SATISFIES**: AC5 discoverability.

### 28. VALIDATE in real browsers, and prove the two failure paths

- **IMPLEMENT**: run `CHECKLIST.md` end to end. Serve on a **fresh port** and screenshot in real Safari **and** real Chrome: the empty state, the list with two clients, the editor with the full synthetic note, mid-save, a failed save with the text intact, the session-expired message, and 360px.
- **GOTCHA**: browser caching is aggressive. A fresh port per iteration, or you review the previous version's CSS.
- **GOTCHA (R8)**: prove the failed save deliberately. Stop `wrangler pages dev` mid-edit, press **Save note**, confirm the text is still on screen and the message is the copy deck's.
- **GOTCHA (R9)**: prove the expired session deliberately. Point the screen at a route returning HTML rather than JSON and confirm the message names the session, not a generic failure.
- **VALIDATE**: every MUST in `CHECKLIST.md` green; contrast numbers recorded; keyboard path complete; `prefers-reduced-motion` honoured; no horizontal page scroll at 360px.
- **SATISFIES**: AC5. Closes R6, R8, R9.

### 29. UPDATE `README.md` — the decision record

- **IMPLEMENT**: five edits.
  1. **Decisions**, new entry: *"Storage: Cloudflare D1, not KV. (27 Jul 2026, #5.)"* Reasoning from Decision 1 in the register of the existing entries — auditable schema, read-after-write on the surface that is the product, the counter as a `GROUP BY`. Point at `migrations/0001_init.sql` as the artefact. No unverified daily quotas.
  2. **Decisions**, new entry: *"Pages Functions return, for storage only. (27 Jul 2026, #5.)"* State that #3's amendment forbids a model call from Pages, that a D1 binding is not a secret, that there is still no `ANTHROPIC_API_KEY` and no runtime SDK, and why the binding is configured per deployment rather than in `wrangler.toml`.
  3. **Status**: it says *"two files, no Functions, no secrets, no build step"* and lists the client knowledge store as not built. Correct both. Keep "no secrets" and "no build step" — both still true.
  4. **Engine and config**: add `functions/`, `src/store.js`, `src/http.js`, `migrations/`, `public/app.css`, `scripts/setup-d1.py` and `scripts/dev.py` to the engine list. Add the **D1 databases and their bindings** to the config list, beside the Pages project and the Access policy, and say the client notes live in that agency's own database.
  5. One line noting `--text-muted` was darkened for a contrast MUST, since it is an engine-side token every agency inherits.
- **PATTERN**: the existing Decisions entries — bold one-line claim, date, then reasoning as prose that closes the question.
- **GOTCHA**: write these so they read as **the boundary holding**, not as the amendment reversing. A reader landing on Decisions in three weeks must come away certain there is still no model call from Pages.
- **VALIDATE**: the Level 1 doc-drift grep passes. Read Decisions end to end: the model-access entry and the new Functions entry must not contradict each other.
- **SATISFIES**: **AC6.** Part of R3.

### 30. UPDATE `DEPLOY.md` — the runbook

- **IMPLEMENT**:
  - A new numbered **D1** section before Secrets: create the two databases, bind `DB` on both environments, apply the migration remotely, with `scripts/setup-d1.py` as the fast idempotent path and the dashboard steps as the canonical description of the end state. Mirror how §2 to §4 handle Access. Include task 15's failure table — a `503` meaning an unresolved binding is the thing a second deployment will hit.
  - §1: replace *"There is no `functions/` directory"* with the fact that there is one, at the repo root, for storage only, and keep the reason it must never sit under `public/`. Keep §1's claim that the install step is harmless and say why it stays true: wrangler is pinned in the npm scripts through `npx` and is deliberately not a devDependency. Record Node ≥22 for local wrangler use, and that the build image is v3 (Node 22.16.0).
  - §5 **Secrets · none**: keep the section and the claim. Add one line: the deployment now has a D1 binding, and a binding is not a secret.
  - The smoke-test checklist: add `/clients` and the API routes, noting that Access means an unauthenticated curl only ever proves the door is shut.
- **PATTERN**: `DEPLOY.md`'s own voice — a checklist where the reasons matter as much as the clicks, with `⚠️` and `✅ DONE <date>` markers.
- **GOTCHA**: the audience is the second agency deployment. Someone with no context must be able to create a database, bind it and migrate it without reading this plan.
- **GOTCHA**: do not touch the Access sections. They are verified and dated.
- **VALIDATE**: the Level 1 doc-drift grep passes. Read the D1 section as if deploying for a new agency: every command copy-pasteable, every per-agency value marked.
- **SATISFIES**: AC6. Closes R3.

### 31. DEPLOY the finished feature to the branch preview and verify

- **IMPLEMENT**: commit, `git push`, then the **same mechanism as the gate**: `./scripts/deploy.py saulera-dossier-engine feature/client-knowledge-store`. Then verify on the preview hostname.
- **GOTCHA**: use the branch argument, not a bare `./scripts/deploy.py`. A bare call builds `main`, which does not have this feature, and every check below would pass or fail on the wrong code. This is the same trap as task 15.
- **GOTCHA**: `npm run db:preview` was already run at task 15 and `wrangler d1 migrations apply` is idempotent, so re-running it is safe and worth doing to confirm nothing new is pending.
- **GOTCHA**: Access takes a minute or two to propagate. Retry once after 60 seconds before treating a `200` as real.
- **VALIDATE**:
  ```bash
  P=https://feature-client-knowledge-store.saulera-dossier-engine.pages.dev
  for u in /clients /api/clients /api/events /api/agency; do
    curl -s -o /dev/null -w "$u: %{http_code} %{redirect_url}\n" "$P$u"
  done
  ```
  All four must be `302` to `cloudflareaccess.com`. **A `200` on any `/api/*` is a failure.** Then, logged in through a browser: `/clients` loads, a client can be added, a note saves and survives a reload byte-identical, and the renderer choice persists.
- **SATISFIES**: AC1, AC2, AC4, AC5, AC6.

### 32. COMMIT and open the PR

- **IMPLEMENT**: atomic commits with conventional tags. Suggested split: `feat: d1 schema, store and the deployment gate` · `feat: functions/api for clients, agency, events` · `feat: the client note editor screen` · `docs: storage decision + the runbook`. The docs commit includes **this plan file and `.claude/skills/dossier-design/`** — `.claude/plans/deploy-skeleton.md` is already tracked, so this one belongs in git too.
- **PATTERN**: this repo's log — a one-line imperative subject, then prose explaining *why*, then the `Co-Authored-By` and `Claude-Session` trailers.
- **GOTCHA**: the PR body must carry `Closes #5`, name the six decisions, name which rung of task 15's fallback ladder the deployment landed on, note that `deploy.py` gained an optional branch argument, and name the AC5 boundary (capability shipped; agency emails added at onboarding), so the reviewer checks the decisions rather than only the diff.
- **VALIDATE**: `npm test` passes on the branch; `git log --oneline main..HEAD` reads as a story.
- **SATISFIES**: process.

#### 32b. POST-MERGE — production. Run this after the PR is merged, not before.

Production only ever updates when `deploy.py` builds `main`, and push-triggered builds are broken, so this is a deliberate manual step and it belongs to whoever merges.

```bash
export PATH="$HOME/.nvm/versions/node/v24.11.0/bin:$PATH"
git checkout main && git pull
npm run db:remote                 # migrate the PRODUCTION database, dossier-engine
./scripts/deploy.py               # no branch argument: builds main, as it always did

P=https://saulera-dossier-engine.pages.dev
for u in /clients /api/clients /api/events /api/agency; do
  curl -s -o /dev/null -w "$u: %{http_code} %{redirect_url}\n" "$P$u"
done
```

- **GOTCHA**: migrate before deploying, or the first production request hits a database with no tables.
- **GOTCHA**: this is where **R1 closes on production**. A `503 {"error":"not_configured"}` here means the production `DB` binding did not resolve even though `setup-d1.py` reported it — re-run the script, check its verifying GET, and fall back to the dashboard under Settings → Bindings. Task 15's symptom table applies unchanged.
- **VALIDATE**: all four routes `302` to `cloudflareaccess.com`; then, logged in, `/clients` loads and a note saves and survives a reload.

---

## TESTING STRATEGY

Node's built-in test runner, `node --test test/*.test.js`, with `node:test` and `node:assert/strict`. **Zero test dependencies, and it stays that way.** No Vitest, no `@cloudflare/vitest-pool-workers`, no `node:sqlite`.

### Unit Tests

`test/store.test.js` covers validation, id generation, partial-update semantics, and the SQL each store function issues. The fake D1 records calls rather than executing SQL, which makes three properties directly assertable that a real database would only imply:

- No user value ever reaches the SQL string. The injection test asserts on the recorded SQL, not on a query result.
- `listClients` never selects the `note` column.
- The events insert touches no column outside the four allowed ones.

### Schema Tests

`test/schema.test.js` parses `migrations/0001_init.sql`. It is the mechanism that keeps AC3 and AC4 from eroding: adding a `candidates` table or a fifth `events` column fails the suite. Task 8 requires proving it bites, both ways, and recording the proof.

### Integration Tests

`wrangler pages dev` with a real local D1, driven by tasks 14 and 23. This is where D1's return shapes, the dynamic route parameter, and the note's byte-exact round-trip are actually exercised. Plus the production gate at task 15, which is the only place the CI build path itself gets tested.

There is no automated harness for this layer in this ticket. Saying so is better than implying coverage that does not exist; the curl sweeps are recorded in the completion report instead.

### Manual and Visual

`CHECKLIST.md` in real Safari and real Chrome (task 28), including deliberate reproduction of the failed-save and expired-session paths, then the authenticated production pass (task 31).

### Edge Cases

- A note of `NOTE_MAX + 1` characters. Rejected as `too_long`, and **the screen keeps the text**.
- A note cleared to `""` deliberately. Saved as empty, not ignored as falsy.
- A note whose leading spaces, trailing spaces, blank lines and curly quotes must survive byte-for-byte, because `src/provenance.js` matches verbatim quotes against it later.
- A client name of `Robert'); DROP TABLE clients;--`. Stored and displayed literally, never parsed.
- A duplicate client name. Allowed — two clients can share a name and the id is the identity.
- An unknown client id in `?client=`. The screen says so and offers the list, rather than rendering an empty editor that looks saveable.
- A client with zero events. `packs: 0`, not `null`.
- `POST /api/events` with an unknown `client_id`. `400`, not a silent orphan row.
- `POST /api/events` carrying `candidate_name`. `400`. This is the boundary test.
- An expired Access session mid-edit. The message names the session and the text stays.
- `wrangler pages dev` stopped mid-edit. Save fails, text stays, message actionable.
- A missing `DB` binding. `503 not_configured`, which is the exact signature of task 15's R1.
- 360px viewport with a 1,800-character note. No horizontal page scroll.

---

## VALIDATION COMMANDS

Execute every command to ensure zero regressions and 100% feature correctness. Run wrangler commands under Node ≥22.

### Level 1: Syntax, style, and the drift gates

There is no linter and no formatter in this repo. Do not add one. These greps are the gate instead, and four of them close R3, R5, Decision 2 and Decision 5 mechanically.

```bash
cd ~/Desktop/saulera-dossier-engine

# Syntax
for f in functions/api/clients.js "functions/api/clients/[id].js" functions/api/agency.js \
         functions/api/events.js src/store.js src/http.js public/clients.js; do
  node --check "$f" || echo "FAIL $f"
done

# R3 — doc drift. Any hit is a failure: these three artefacts must stop claiming no Functions.
# Single-quoted deliberately: double quotes would let the backticks run as command substitution.
# Verified 27 Jul 2026 that this hits all three files as they stand today, so the gate bites.
grep -nE 'no Functions|no `functions/` directory|Static site only' \
  README.md DEPLOY.md wrangler.toml && echo 'FAIL doc drift' || echo 'ok'

# Stale route from #3's deleted Function. Today only public/index.html hits; README.md and
# DEPLOY.md are already clean and stay in the list as a reintroduction gate.
grep -n "api/health" README.md DEPLOY.md public/index.html && echo 'FAIL stale health route' || echo 'ok'

# Decision 2 — no model access crossed the boundary.
grep -rn "ANTHROPIC_API_KEY\|@anthropic-ai/sdk" functions/ src/store.js src/http.js public/ \
  && echo 'FAIL model access' || echo 'ok'

# Decision 5 — no browser storage of the note.
grep -nE 'localStorage|sessionStorage|indexedDB|document\.cookie' public/clients.js \
  && echo 'FAIL browser storage' || echo 'ok'

# R5 — the schema still has exactly three tables and no candidate-shaped identifier.
# [[:space:]] rather than \s: portable across BSD grep on macOS and GNU grep.
test "$(grep -ci '^CREATE TABLE' migrations/0001_init.sql)" = 3 || echo 'FAIL table count'
grep -invE '^[[:space:]]*--' migrations/0001_init.sql | grep -inE 'candidate|resume' \
  && echo 'FAIL candidate-shaped identifier' || echo 'ok'

# AC5 — there is provably no per-identity or ownership path through the store or the screen,
# which is what "editable by the agency, not only by saulera" means in code. Deliberately does
# NOT grep for the word "saulera": comments legitimately cite it and a gate that cries wolf
# gets deleted.
# The word-boundary form is bracketed rather than \b: both were tested on this machine and
# work, but \b is a GNU-ism and BSD's [[:<:]] does NOT work here, so the portable form wins.
grep -rniE 'linardsberzins|owner_email|owner_id|created_by|(^|[^a-z_])author([^a-z_]|$)' \
  src/store.js src/http.js functions/ public/clients.js \
  && echo 'FAIL identity-bound path' || echo 'ok'

# Custom-property discipline.
grep -nE '#[0-9a-fA-F]{3,6}' public/app.css && echo 'FAIL raw hex' || echo 'ok'
```

### Level 2: Unit Tests

```bash
npm test                    # existing 16 plus the new ones
nvm use 20 && npm test      # must pass on v20.20.2, this machine's default node
nvm use 24 && npm test      # and on v24.11.0, which wrangler needs
```

### Level 3: Integration Tests

```bash
export PATH="$HOME/.nvm/versions/node/v24.11.0/bin:$PATH"
npm run db:local            # prints the resolved uuid
npm run dev                 # prints the SAME uuid, serves http://localhost:8788
# then the curl sweeps from tasks 14 and 23, in a second terminal
```

### Level 4: Manual Validation

During the ticket this runs against the **branch preview** hostname; after the merge, 32b runs the identical check against production. Both are behind Access (#12 created an application for the apex and one for the preview wildcard), so the assertion is the same on either.

```bash
# Unauthenticated: the only thing either hostname will tell you is that the door is shut.
P=https://feature-client-knowledge-store.saulera-dossier-engine.pages.dev   # 32b: the apex
for u in /clients /api/clients /api/events /api/agency; do
  curl -s -o /dev/null -w "$u: %{http_code} %{redirect_url}\n" "$P$u"
done
# All four: 302 to cloudflareaccess.com. A 200 on any /api/* is a failure.
```

Then, logged in through Access in a browser:

1. `/clients` loads. The empty state invites adding the first client.
2. Add a client. It appears with 0 characters and 0 packs.
3. Paste the synthetic note, **Save note**, reload. The note is byte-identical.
4. Clear the note, save, reload. It stays empty.
5. Switch the renderer to inline, reload. It persists.
6. Full keyboard path with no trap; every focused control shows a visible ring.
7. 360px width, no horizontal scroll.
8. Real Safari and real Chrome, both.

### Level 5: Additional Validation (Optional)

Swap `dossier-engine` for `dossier-engine-preview` while the work is still on the branch — production has no schema until 32b.

```bash
# The database has exactly the expected tables plus d1_migrations.
npx wrangler@4.114.0 d1 execute dossier-engine --remote \
  --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"

# The counter holds nothing personal.
npx wrangler@4.114.0 d1 execute dossier-engine --remote --command "PRAGMA table_info(events)"

# The bindings are where setup-d1.py put them.
python3 scripts/setup-d1.py    # second run: prints ok, changes nothing, confirms by GET
```

Do **not** run `.claude/verify-deploy.sh`. It was written for #3's deleted `/api/health` Function and an Access-deferred deployment. It will report confusing results and neither is a real failure.

---

## ACCEPTANCE CRITERIA

Mapped to the issue's own numbering.

- [ ] **AC1 — Client.** Name plus a free-text knowledge note, stored, editable in the tool, owned by the agency. `clients` table; `/clients` screen adds and edits; note round-trips byte-identical.
- [ ] **AC2 — Agency.** One row per deployment holding `send_format` and `renderer`, editable from the agency strip. Branding is `public/tokens.css` by Decision 6, recorded in the README.
- [ ] **AC3 — There is no candidate table.** `migrations/0001_init.sql` has three tables and none is candidate-shaped. `test/schema.test.js` fails if that changes, and it has been proven to fail. No candidate material in browser storage or URLs. `POST /api/events` rejects unexpected fields.
- [ ] **AC4 — The event counter records `{client, timestamp, duration}` and nothing else.** `events` has exactly `{id, client_id, created_at, duration_ms}`, asserted in the schema test and in the store test's SQL assertions, with the `unexpected_fields` guard at the endpoint. `GET /api/events` counts them and the screen shows the count per client, so the metric is visible rather than latent.
- [ ] **AC5 — The note is editable by the agency, not only by saulera.** A deployed screen behind Access where the agency reads, edits and saves. `CHECKLIST.md` MUSTs green.
  > **What this ticket can and cannot prove, stated rather than left for a reviewer to find.** The Access policy admits exactly one email, `linardsberzins@gmail.com` (#12), so every validation pass here is saulera editing the note. **The capability ships here; admitting the agency's own addresses is a per-deployment Access policy change at onboarding, not a code change** — `DEPLOY.md` §3 already puts the policy and the emails it lets in on the Config side, never merged upstream. The Level 1 grep proves there is no saulera-specific path, no owner column and no author field, which is the strongest available evidence short of a second admitted email. This repo's precedent (#3 striking and splitting ACs rather than hiding them) says name the boundary rather than tick it silently.
- [ ] **AC6 — The storage backend is decided and the reasoning is in the README.** D1, with the reasoning from Decision 1, plus the Functions-return decision and the per-deployment binding.
- [ ] All validation commands pass with zero errors, on Node v20 and v24.
- [ ] No regressions: `test/provenance.test.js` and `test/smoke.test.js` pass unchanged, and #4's `src/` is untouched apart from the two new files.
- [ ] `README.md`, `DEPLOY.md` and `wrangler.toml` no longer claim the deployment has no Functions, proven by the Level 1 grep.
- [ ] Deployed, verified, and `/clients` plus every `/api/*` route answer `302` to Access when unauthenticated.

---

## COMPLETION CHECKLIST

- [ ] All 32 tasks completed in order, plus 32b after the merge
- [ ] Each task's validation ran immediately, not batched at the end
- [ ] **Task 15's gate passed on a branch preview, and the report names which rung of the fallback ladder the deployment landed on**
- [ ] `scripts/deploy.py` takes an optional branch and still builds `main` when called with no branch argument
- [ ] Tasks 15 and 31 deployed with the branch argument, and migrated `dossier-engine-preview`, not production
- [ ] `npm test` green on v20.20.2 and v24.11.0
- [ ] Schema test proven to bite, both ways (a `candidates` table and a fifth `events` column each fail the suite)
- [ ] Every Level 1 grep gate reports `ok`
- [ ] `npm run db:local` and `npm run dev` printed the same uuid
- [ ] Both curl sweeps (tasks 14, 23) recorded in the completion report
- [ ] The design critique written **before** any CSS and pasted into the report
- [ ] Contrast numbers recorded, including the darkened `--text-muted` on `--surface`
- [ ] `CHECKLIST.md` run, every MUST green, screenshots from real Safari and real Chrome
- [ ] Failed-save and expired-session paths reproduced deliberately, not reasoned about
- [ ] Unauthenticated `/clients` and all three `/api/*` routes `302` to Access, on the preview hostname and again on the apex in 32b
- [ ] Authenticated pass: add a client, save a note, reload, note byte-identical, renderer persists
- [ ] **32b run after the merge**: production database migrated, `main` deployed, production verified
- [ ] `README.md` records both decisions and Decisions reads without self-contradiction
- [ ] `DEPLOY.md` has a D1 section a stranger could follow for a second agency
- [ ] This plan file and the copied design skill are committed
- [ ] PR carries `Closes #5`, the six decisions, the fallback rung, and the AC5 boundary

---

## OPEN QUESTIONS / ASSUMPTIONS

**Assumptions this plan makes.** All six are stated in *DECISIONS* with reasoning, and any can be overridden before execution:

1. D1 over KV (AC6). Reasoning is auditability and read-after-write, not throughput.
2. `functions/` returns for storage only. The alternative satisfies neither AC1 nor AC5.
3. The D1 binding is per-deployment config, not a `wrangler.toml` line.
4. This ticket ships a standalone `/clients`, and #8 absorbs it.
5. No browser storage; client ids in URLs, never names.
6. Branding stays in `tokens.css`; the agency row holds `send_format` and `renderer` only.

**Would change the plan if answered differently:**

- **`duration_ms` semantics.** Assumed to be generation wall-clock in milliseconds, produced by #6. If the intended measurement is the recruiter's whole review-to-sendable time — the number PRD §4's ten-minute guardrail actually cares about — then #8 produces it, not #6, and the column means something different. **Worth settling before #6 starts**, because the metric is the thing this ticket exists to make real. Either way the schema is unchanged, so this is a semantics question, not a migration.
- **`NOTE_MAX = 100_000` characters** is a product judgement, not a platform limit (D1 allows 2 MB per string). Roughly 15,000 words. If the intended use is a rolling interview log rather than a process description, it may want to be higher.
- **Should the agency strip ship here at all?** AC2 requires the Agency entity to exist and be configuration; it does not obviously require a UI. Editing `renderer` is a one-line write and #7 will want it, so it is cheap here and awkward later. If it should wait for #8, cut task 21's `onRequestPut` and the strip, and keep the table and `getAgency`.

**Flagged, not blocking:**

- **AC5 is satisfied as a capability, not demonstrated with an agency user.** Access admits one email; adding the agency's own is a Config-side policy change at onboarding. The Level 1 grep is the available proof. See the note under AC5.
- **The Tuesday 28 July gate.** The epic gates Wave 1 on the discovery visit and says the locum branch closes #4 to #9. #4 was built ahead of it, so that call is already being made. Planning is cheap and reversible, and this is not an implementation risk.
- **Architecture §5.3's personal-data flag needs to reach the agency in words, not just in a doc.** The note names hiring managers and panel members. The commitment that holds is narrower than PRD §8's: *no new store of candidate data.* That wording belongs in the Thursday one-pager, not here, but this ticket is what makes it true.
- **An Access service token** would let the production API be curl-tested unauthenticated-but-authorised. Not needed here; worth knowing when #6 wants an automated production smoke test.

## NOTES (open canvas)

**Why the gate at task 15 is the structural change that makes this plan safe.** Everything Cloudflare could refuse to do sits in one place and is tested by three files: does a project-level D1 binding reach a CI-triggered build, does a returned `functions/` directory get picked up, does a Function bundle an import from `../../src/`. None is provable by reading, one is not documented at all, and all three would otherwise be discovered after the store, four endpoints and a screen were written. Discovering an architecture problem in a three-file diff costs twenty minutes. Discovering it at the end costs the ticket. The code the gate writes is real and kept.

**Why the schema test is the most valuable 40 lines here.** The ticket says the counter *"is the first thing that gets silently descoped."* It is right, and the reason is structural rather than careless: #6 is about generation and #8 is about a screen, and in both, `events` is a side concern someone will widen "just to make debugging easier". A `candidate_ref` column would be added by a well-meaning agent in thirty seconds and would breach the one boundary the architecture calls expensive to unpick. Prose cannot stop that. A failing test can. Same logic makes the `unexpected_fields` guard worth three lines: it is the runtime half of the same mechanism, and the Level 1 grep is the third.

**Why `src/store.js` and not SQL inside the Functions.** Three reasons, in order of weight. The repo's test runner is `node --test` with zero dependencies, and a Function cannot be imported into that runner while a pure module can. #6 will call the store directly from Claude Code rather than over HTTP, since generation runs on a machine with a login and not on Pages. And the SQL assertions (no `note` in the list query, no extra columns on the events insert) are only expressible if the SQL lives somewhere importable.

**Alternative considered and rejected: notes as markdown files in the repo, edited by saulera.** Zero infrastructure, versioned by git, ships in an hour. Rejected because architecture §4 rules on it directly: *"If the note is a file only saulera can edit, condition 1 holds for producing packs but not for keeping them good, and the knowledge stops compounding the moment the engagement ends. That defeats the thesis in §3."* AC5 exists to close this door and calls it load-bearing. Recorded because it is the shape this ticket will collapse into under time pressure.

**Alternative considered and rejected: a `_middleware.js` binding guard.** Pages supports a middleware Function that could check `env.DB` once for every route. Premature at four endpoints, and it would add a second place to look when a route misbehaves. Revisit if #6 and #8 push the endpoint count past about eight.

**On the KV counterargument, honestly stated.** KV is simpler: one binding, no migrations, no SQL. If the store were only the note, KV would be defensible and D1's ceremony would be hard to justify. The counter is what tips it. `{client, timestamp, duration}` per event in KV means either one key per event and a `list()` scan to count, or a single mutable counter key that loses the timestamps and therefore the ability to say *when* packs were generated — which is precisely what a three-week adoption window measures. Plus the audit argument, which is worth more here than convenience.

**Why the design is specified rather than delegated.** The `dossier-design` skill's two-pass method is good and the plan keeps it, but "plan before code" with nothing written is where an implementing agent produces the generic version: a centred card, a rounded everything, a spinner. So the palette roles, type ramp, wireframe, signature element and every string are fixed above, and task 24's job is to attack that specification rather than fill a blank page. The one genuine design finding already surfaced from doing it: `--text-muted` at `#8c8c8c` on `--surface` at `#f5f5f5` is roughly 2.9:1 and fails the contrast MUST — a bug in the existing engine-side token layer that would otherwise have shipped into #8 too.

**Sequencing note for anyone running this in parallel.** Phases 3 and 4 could be split across two worktrees against the API surface fixed in tasks 19-22. The honest recommendation is not to. Four endpoints, maybe twenty minutes of wall-clock saved, and the screen is the half where the design pass matters most and where an integration surprise is most expensive. Sequential.

## AMENDMENTS

<!-- Append-only. Newest at the bottom. Leave empty until the plan has been executed. -->
