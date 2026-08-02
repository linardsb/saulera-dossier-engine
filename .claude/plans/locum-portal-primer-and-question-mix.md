# Feature: Portal pivot — first-day primer and the locum question mix

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

## Feature Description

For **locum** bookings the candidate portal serves a **first-day primer** (site logistics, scanner fleet and protocols, PACS/RIS, who to report to — sourced from the client-knowledge note's candidate-visible fields) plus a **slim question set** (mostly `client` questions from the agency's note, a few `competency` questions pitched at "verify experience, don't teach it", one or two `screening` items) **instead of the full interview drill**. Perm roles keep the existing drill untouched. Questions gain a `type` field (`client` / `competency` / `screening`) alongside the existing axis/difficulty.

Never generic clinical coaching — the audience are experts; the portal only tells them what the agency knows that they can't.

## User Story

As a locum imaging candidate who has just been booked,
I want the prep portal to tell me what I actually need for day one — how to get in, what kit and protocols the department runs, who to report to, and what the manager's informal call will probe —
So that I walk in prepared with the agency's client knowledge, without being coached on clinical work I already master.

## Problem Statement

The portal was built for permanent hires: a competency drill against a panel interview. For a locum booking there usually is no panel — the gate is compliance plus an informal call, and the candidate's real need is first-day logistics and the client's quirks. Serving an expert radiographer a clinical practice drill is patronising and wrong-shaped (confirmed by Louis, handover question 8).

## Solution Statement

Thread a deterministic `engagement` flag (from `briefProfile()` in `src/domain.js`, slice 1's work) into the prep pipeline; extend the closed block vocabulary with one new brief block, `FirstDayPrimer`, whose items carry `source_field_key` provenance exactly as `PanelBrief.panel[]` does; add a `type` enum to questions (schema-required, assert-tolerant-on-absence — #49's A3 precedent); widen `candidateProjection` deliberately so a locum brief carries `engagement` and a `{text, type}`-only question list; and branch `renderPrime` in the session page the same way the day-before mode already does — compose the primer surface client-side and never enter the drill. Zero changes to the session/turn endpoints and zero D1 migrations.

## Out of Scope / Non-Goals

- **Not changing**: the perm drill — targeting, ladder, drill.js, `/prep/api/session`, `/prep/api/turn` are untouched. `src/prep/drill.js` and `src/prep/targeting.js` need **no edits** (the ticket's file estimate listed drill.js; investigation shows the locum path never drills, so the mix is a generation + projection concern, not a selection one).
- **Not included**: a D1 `question.type` column / migration 0008. `brief_json` persists the full questions (including `type`) for free; the D1 `question` table only feeds the drill, which locum candidates never enter. If a future ticket gives locums an interactive session, migrate then (follow the `axis` TEXT+CHECK precedent, not the `difficulty` integer-map one).
- **Not included**: any recruiter-side readout of candidate prep activity (surviving guardrail: no promises of visibility into candidate prep performance).
- **Not included**: changes to the pack (#49 shipped), the note editor (#48 shipped), or the demo fixture `public/prep/brief.fixture.json` (demo branch's concern).
- **Not changing**: HTTP body vocabularies. No new keys in prepare/send `ALLOWED` sets (D1 precedent from #46: the flag rides on payloads, never in body fields).

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: High
**Primary Systems Affected**: prep schema/prompt/generate/verify/projection, send route, portal registry + session page
**Dependencies**: none new — zero-dependency repo (`node --test`, no lint/typecheck)

## Related Work

**Implements**: [#50](https://github.com/linardsb/saulera-dossier-engine/issues/50) — PR closes with `Closes #50`   ·   **Epic**: #45 (Imaging-locum fit), slice 3. Architecture inherited from the epic + prior slice plans; do not re-decide role-shape detection, tolerance rules, or the closed-vocabulary mechanism.

**Back-references** (plans this builds on or inherits decisions from):

- `.claude/plans/imaging-domain-vocabulary.md` (#46) — Why: `briefProfile`/`role_shape` is the deterministic flag; D1 "no new HTTP body fields", D2 "absent flag reads `?? "unknown"`" are inherited here as-is.
- `.claude/plans/client-note-locum-fields.md` (#48) — Why: the note fields (`protocols`, `site-access`, …) the primer consumes; its A4 anticipated a server-side consumer.
- `.claude/plans/locum-booking-pack.md` (#49) — Why: sibling slice; A3's "required in schema, tolerant in assert" is the pattern `question.type` follows; A4's content-driven gating shapes the primer's degrade path.
- `.claude/plans/prep-component-registry-and-brief-dashboard.md` (#21) — Why: the closed-vocabulary mechanism being deliberately extended.
- `.claude/plans/day-before-mode-and-reminder.md` (#25) — Why: `renderPrime`'s day-before branch is the exact template for the locum branch.

**Forward-references** (plans that extend or supersede this — append as follow-ups get created):

- (none yet)

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `src/prep/schema.js` (whole file, esp. lines 21-27, 37-46, 128-137, 164-181, 225-334) — Why: `BLOCK_NAMES`, the `block()` helper, the `question` shape, and `assertBrief` — every extension lands here first. Note the file header: the vocabulary is closed **twice** (schema + assert).
- `src/prep/prompt.js` (whole file) — Why: `PREP_SYSTEM` sits **inside** the cached prefix; `prepInputsBlock` (lines 92-96) sits **after** the breakpoint — the locum instruction block must go there or the client-note cache dies. Never read `client.note` here.
- `src/prep/generate.js` (lines 52-99, 141-152) — Why: `generateBrief`'s input handling (`cleanInput` runs exactly once, line 61-62) and the return shape the `engagement` stamp joins.
- `src/prep/verify.js` (whole file) — Why: the `PanelBrief` demote-don't-drop walk (lines 54-86) including the **idempotency guard at line 71** — `FirstDayPrimer.items[]` mirrors it exactly; `briefSummary` (lines 110-128) gets additive primer counts the way panel counts were added.
- `src/prep/projection.js` (whole file) — Why: the projection discipline being deliberately widened; the header's `questions` rationale (lines 21-22) must be amended, not silently contradicted. `projectPanelEntry` (lines 30-38) is the pattern for projecting primer items.
- `src/domain.js` (lines 12-13, 49-58, 78-100) — Why: `briefProfile(brief, cv).role_shape` is the flag; **no edits here** — import only. ⚠ Name collision: `PrimerCard.props.role_shape` (schema.js:74) is free prose, NOT this enum — which is why the prep-side flag is named `engagement`.
- `functions/api/prep/send.js` (lines 59-68, 240-290, 353-369) — Why: where the server-truth `engagement` stamp lands (after `verifyBrief`, before `persistHandover`). ⚠ This file must not import the Anthropic SDK; `briefProfile` is pure and safe.
- `functions/api/prep/prepare.js` (lines 40, 82-103) — Why: **no edits** — the stamp arrives inside `result.payload` from `generateBrief`; confirm nothing here strips it.
- `functions/prep/api/brief.js` (whole file, ~40 lines) — Why: serves `candidateProjection(assertBrief(brief_json))`; **no edits expected** — the widening happens inside the projection. Confirm.
- `public/prep/registry.js` (lines 27-64, 67-116, 218-268, 501-533, 556-636) — Why: `BRIEF_BLOCK_NAMES` / `SESSION_BLOCK_NAMES`, `COPY`, the `PanelBrief` constructor's unsourced-mark rendering (~lines 218-268), `DayBeforeMode` (line 501) as the session-block pattern, `REGISTRY` (line 522), `renderBlocks`. `createElement` + text nodes ONLY — a source scan fails the build on innerHTML.
- `public/prep/session.js` (lines 137-350, esp. 268-335) — Why: `renderPrime`'s day-before branch (lines 275-296) is the template: cherry-pick blocks from the brief payload, compose a session-side block, short-circuit the drill. `COPY` object at lines 37-86. `load()` at 201-266 shows where the brief payload lands.
- `src/portal/store.js` (lines 163-263) — Why: `persistHandover` — **no edits** (no migration; `brief_json` line 181 persists the stamped payload wholesale; the question INSERT deliberately ignores `type`).
- `functions/prep/api/session.js` (whole file) — Why: to confirm the **no-edit** claim — the locum branch is client-side; this endpoint stays byte-identical.
- `src/note-fields.js` (lines 1-26, 209-255) — Why: THE RULE at the top (candidate-facing reads go through `visibleFields()` only) — this ticket adds no new note reads, and must not; `LOCUM_FIELDS` ids (`protocols`, `site-access`) name what the primer feeds on.
- `test/prep-schema.test.js` — Why: where `assertBrief` rules are pinned; new `type` and `FirstDayPrimer` rules get tests here.
- `test/prep-registry.test.js` (lines 86-120, ~298) — Why: asserts `Object.keys(REGISTRY)` equals "decision 22's ten names" AND `BRIEF_BLOCK_NAMES === BLOCK_NAMES` (deep-equal against schema). Both assertions FAIL on any addition — amend them **deliberately**, updating the count and the comment.
- `test/fixtures/prep-session-blocks.json` — Why: the contract fixture for session-only block names; `LocumQuestions` must be added.
- `test/prep-projection.test.js`, `test/prep-verify.test.js`, `test/prep-generate.test.js`, `test/prep-send.test.js`, `test/prep-session-ui.test.js` — Why: the suites each task below extends; read each file's header for its house style before adding cases (e.g. prep-session-ui drives real route handlers over real-SQLite D1 through `initSession`'s `fetchImpl`).
- `test/prompt.test.js` and/or `test/prep-*.test.js` covering `buildPrepMessages` — Why: cache-breakpoint stability assertions live there; the locum block must be proven to sit AFTER the breakpoint.

### New Files to Create

- (none — every change lands in existing files; new test cases go in the existing suites)

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- `docs/epics/` candidate-portal architecture — §3 (provenance is structural), §5 (exactly two model-call sites — this ticket adds none)
- GitHub issue #50 (the ticket) and #45 (the epic) — acceptance criteria quoted throughout this plan
- [Anthropic structured outputs](https://docs.anthropic.com/en/docs/build-with-claude/structured-outputs) — Why: `BRIEF_SCHEMA` constraints (no numeric bounds, `additionalProperties: false` everywhere, enum not min/max); the new `type` enum and `FirstDayPrimer` block must respect them. schema.js's own header (lines 12-15) summarises the rules.
- [Prompt caching](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching) — Why: the breakpoint sits on the visible-note block; anything per-candidate (the engagement branch) must render after it.

### Patterns to Follow

**"Required in schema, tolerant in assert" (#49 A3)** — new fields are `required` in the JSON schema (the decoder enforces on fresh calls) but `assertBrief` tolerates **absence** on stored/round-tripped payloads while rejecting **invalid present values**:

```js
// assertBrief, question loop — mirror the difficulty check at schema.js:319-321
if (q.type !== undefined && !["client", "competency", "screening"].includes(q.type)) {
  throw new Error(`brief: questions[${i}].type is ${q.type}`);
}
```

**Tolerant flag reads (#46 D2)** — consumers read `payload.engagement ?? "unknown"`, and `"unknown"` behaves as perm. Old stored briefs never break.

**Demote, don't drop (verify.js)** — a primer item whose `source_field_key` is not in the D1-sourced key set is blanked and marked, never removed; the idempotency guard (`entry.source_field_key === "" && "failed_field_key" in entry`) must be copied verbatim or re-verification out of storage destroys the diagnostic (verify.js:57-71 explains why).

**Server truth over browser round trip (send.js R4)** — `engagement` is stamped in `generateBrief` for the preview, then **recomputed from the cleaned brief/cv and re-stamped in send.js**; whatever the browser posted is overwritten.

**Session-side block composition (session.js:275-296)** — the locum surface is composed in `renderPrime` from the brief payload plus a session-only block, exactly as `DayBeforeMode` is. Session-only blocks live in `SESSION_BLOCK_NAMES`, need no schema entry, and are pinned by `test/fixtures/prep-session-blocks.json`.

**Every visible string in COPY, textContent only** — both `session.js` and `registry.js` keep all copy in their `COPY` objects; constructors use `el()`/`createElement` + text nodes. Write strings in plain language for a first-time reader.

**Error register** — `assertBrief` throws plain `Error` with path-shaped messages; HTTP translation to `StoreError` happens at the call sites that already do it (generate.js:134-139, send.js:250-254). Do not add new translations.

---

## IMPLEMENTATION PLAN

### Phase 1: Contract — schema, vocabulary, verification

The closed vocabulary opens here, deliberately, in both places at once (schema + assert), plus the provenance walk for the new block.

**Tasks:** `question.type` enum; `FirstDayPrimer` in `BLOCK_NAMES` + `BLOCKS`; `assertBrief` extensions; `verifyBrief` + `briefSummary` primer halves.

### Phase 2: Generation — engagement flag and the locum prompt

**Depends on:** Phase 1 (the schema must accept what the prompt asks for)

**Tasks:** `briefProfile` computed inside `generateBrief`; locum instruction block appended in `prepInputsBlock` (after the cache breakpoint); `engagement` stamped on the returned payload; send.js recomputes and re-stamps before `persistHandover`.

### Phase 3: Delivery — projection and the portal surface

**Depends on:** Phases 1-2 (the projection carries what generation now produces)

**Tasks:** `candidateProjection` widened (`engagement` always; `{text, type}` questions when locum); `FirstDayPrimer` constructor in `BRIEF_BLOCK_NAMES`; `LocumQuestions` session block; `renderPrime` locum branch.

### Phase 4: Testing & Validation

Interleaved per task below (each task lands with its tests), then the full suite + the registry parity amendments.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

### UPDATE `src/prep/schema.js` — question `type`

- **IMPLEMENT**: Add to the `question` object (after `difficulty`, ~line 178): `type: { type: "string", enum: ["client", "competency", "screening"], description: ... }`. Description must carry the semantics (the schema is the model's instruction surface — see how `axis` at 172-177 does it): `client` = what THIS manager/client probes, sourced from the client knowledge; `competency` = verify experience, don't teach it; `screening` = availability, rate, compliance logistics. State that permanent-role briefs use `"competency"` throughout. Add `"type"` to the question's `required` array (structured outputs require every property listed).
- **IMPLEMENT**: In `assertBrief`'s question loop (after the difficulty check at line 319-321): reject a **present** `type` outside the enum; tolerate `undefined` (stored pre-#50 payloads re-run `assertBrief` on every brief read — `functions/prep/api/brief.js` — and must not start failing).
- **PATTERN**: schema.js:178 (`difficulty` enum), schema.js:319-321 (assert check), #49's A3 tolerance rule.
- **GOTCHA**: do NOT mirror `axis`'s hard requirement (line 316-318) — that one is strict because it was born strict; `type` arrives on a contract with live stored payloads.
- **VALIDATE**: `node --test test/prep-schema.test.js` — add cases: valid types pass; `type: "clinical"` throws naming the path; absent `type` passes.
- **SATISFIES**: AC "questions gain a `type` field… with `assertBrief` enforcing the new `type` enum".

### UPDATE `src/prep/schema.js` — `FirstDayPrimer` block

- **IMPLEMENT**: Append `"FirstDayPrimer"` to `BLOCK_NAMES` (line 21-27) and add to `BLOCKS` via the `block()` helper: props `intro` (str — one or two sentences; where the material is silent, say so) and `items` (array of `{ topic, detail, source_field_key }`, all three required, `additionalProperties: false`). `topic` = the practical subject in the candidate's language ("Getting in", "Scanners and protocols", "PACS/RIS", "Who to report to"); `detail` = what the agency actually knows; `source_field_key` = copy the PanelBrief description at lines 114-118 near-verbatim (the deterministic check wording is load-bearing — it is what makes the model copy keys exactly).
- **IMPLEMENT**: In `assertBrief`'s `checkBlock`, add the array guard mirroring PanelBrief's (line 288-290): `if (b.name === "FirstDayPrimer" && !Array.isArray(b.props.items)) throw ...`. No `children` handling needed — the existing `b.name !== "CompetencyMap"` branch (293-298) already forbids nesting.
- **PATTERN**: `PanelBrief` block def (schema.js:99-124) — same shape, same provenance mechanism.
- **GOTCHA**: `BLOCK_NAMES` order feeds `anyOf` (line 194); append at the end. The block does NOT go in `$defs` (only `StoryBankCard` nests).
- **VALIDATE**: `node --test test/prep-schema.test.js` — a brief with a valid `FirstDayPrimer` passes; `items: "x"` throws; a `FirstDayPrimer` nested in `CompetencyMap.children` throws via the existing leaf rule.
- **SATISFIES**: AC "the closed block vocabulary… is extended deliberately".

### UPDATE `src/prep/verify.js` — primer provenance

- **IMPLEMENT**: In `verifyBrief`'s block walk (lines 54-86), handle `FirstDayPrimer` alongside `PanelBrief`: map `props.items`, keep the **exact** idempotency guard (`entry.source_field_key === "" && "failed_field_key" in entry`), demote unknown keys to `{ ...entry, source_field_key: "", failed_field_key: entry.source_field_key }`, push failures as `kind: "primer_source"` with `block_index` / `item_index` / `key` / `reason`. Clone, never mutate (the file header's rule).
- **IMPLEMENT**: In `briefSummary` (lines 110-128), add additive counts `primer_sourced` / `primer_unsourced` / `primer_total`, computed off the payload's demotion markers exactly as `panel_*` are (line 114-118) — never off `failures` (the comment at 100-103 explains why).
- **PATTERN**: verify.js:54-86 and 114-126, structurally copied for a second block name. Consider extracting the shared per-entry demotion into one local helper if it stays readable; do not abstract beyond the two call sites.
- **GOTCHA**: the send gate (send.js:284-289) blocks only on unverified **competencies** — primer demotions must NOT block a send; they render marked. Do not touch the gate.
- **VALIDATE**: `node --test test/prep-verify.test.js` — primer item with a hidden/unknown key demotes and reports; re-verifying the demoted payload emits no new failure and preserves `failed_field_key`; summary counts are additive and pre-#50 payloads yield `primer_total: 0`.
- **SATISFIES**: AC "candidate-facing reads of the client note go through `visibleFields()` only" — provenance keeps the model honest about which visible field each primer claim came from.

### UPDATE `src/prep/prompt.js` — the locum instruction block

- **IMPLEMENT**: Give `prepInputsBlock` an `engagement` param and append a locum-only instruction paragraph **after** the brief/CV/date and before "Compose the candidate's prep brief." — i.e. strictly after the cache breakpoint. For `engagement === "locum"`: this is a locum booking, usually no panel — an informal call at most; compose a `FirstDayPrimer` from the client knowledge (logistics, scanners/protocols, PACS/RIS, who to report to) and OMIT the block entirely if the client knowledge has nothing practical (an empty block is worse than an absent one — schema.js:193's own words); the question bank is slim — mostly `type: "client"`, a few `type: "competency"` phrased to verify experience ("which scanners have you run solo?"), one or two `type: "screening"`; never clinical coaching — the reader is an expert. For anything else (`permanent`/`unknown`): one line — every question is `type: "competency"`; do not emit `FirstDayPrimer`. Thread `engagement` through `buildPrepMessages`.
- **PATTERN**: `src/prompt.js:81+` (`domainBlock` branching on the profile) for the shape; prompt.js:99-102 for why per-candidate text sits in the second content block.
- **GOTCHA**: `PREP_SYSTEM` is inside the cached prefix — it may gain **static** text only (unconditional; e.g. nothing). Prefer leaving it untouched: the enum descriptions in the schema plus the inputs-block paragraph carry the instruction. NEVER interpolate `engagement` into `visibleNoteBlock` or `PREP_SYSTEM`.
- **VALIDATE**: `node --test test/prompt.test.js test/prep-generate.test.js` — add: the first content block (the cached one) is byte-identical between a locum and a perm call for the same client; the locum call's second block mentions the primer/mix; the perm call's does not.
- **SATISFIES**: AC "a locum booking renders the primer surface and the slim mix" (generation half) and "never generic clinical coaching".

### UPDATE `src/prep/generate.js` — compute and stamp `engagement`

- **IMPLEMENT**: `import { briefProfile } from "../domain.js"`. After `inputs` is built (line 64), compute `const engagement = briefProfile(inputs.brief, inputs.cv).role_shape;` (cleaned inputs — the same strings the model sees). Pass `engagement` into `buildPrepMessages`. In the return (line 146-152), stamp it onto the verified payload: `payload: { ...payload, engagement }`.
- **PATTERN**: `src/generate.js:83` computes the profile the same way for the pack call. The stamp goes on the **verified** payload so `verifyBrief`'s rebuild cannot drop it.
- **GOTCHA**: `engagement` is server-stamped, NOT in `BRIEF_SCHEMA` — the model never produces it (and `additionalProperties: false` would reject it if it tried; that is correct). `assertBrief` ignores unknown top-level keys, so stored payloads carrying it re-assert cleanly.
- **VALIDATE**: `node --test test/prep-generate.test.js` — with the fake SDK client: a locum-worded brief yields `payload.engagement === "locum"`; a per-annum brief yields `"permanent"`; a neutral one `"unknown"`.
- **SATISFIES**: the flag every downstream branch reads; keeps HTTP surfaces unchanged (#46 D1).

### UPDATE `functions/api/prep/send.js` — re-stamp server truth

- **IMPLEMENT**: `import { briefProfile } from "../../../src/domain.js"`. After `verifyBrief` (line 282) and before `persistHandover` (line 363): `const engagement = briefProfile(brief, cv).role_shape;` (the **cleaned** `brief`/`cv` from lines 211-212 — the same haystack discipline the verify comment at 272-275 describes), then pass `{ ...payload, engagement }` as `persistHandover`'s `payload`. Whatever `engagement` the browser posted inside `body.payload` is thereby overwritten.
- **PATTERN**: R4 (line 242-246) — server-derived values beat browser-posted ones; `strikeCompetencies`/`verifyBrief` rebuild the payload, which is exactly why the stamp happens last.
- **GOTCHA**: no `ALLOWED` change — `engagement` rides inside `payload`, which is already allowed. Do not import the Anthropic SDK (file header, line 12-18); `briefProfile` is pure.
- **VALIDATE**: `node --test test/prep-send.test.js` — over real-SQLite D1: send a payload whose posted `engagement` lies (`"permanent"` on a locum-worded brief); the stored `brief_json` reads `"locum"`. A payload with no `engagement` at all sends fine (stamped fresh).
- **SATISFIES**: the stored flag the candidate routes serve is deterministic server truth.

### UPDATE `src/prep/projection.js` — deliberate widening

- **IMPLEMENT**: In `candidateProjection`: (1) always include `engagement: payload?.engagement ?? "unknown"`; (2) when — and only when — that value is `"locum"`, include `questions: (payload?.questions ?? []).map((q) => ({ text: q?.text, type: q?.type ?? "competency" }))`. Perm/unknown payloads keep `questions` **absent** (the existing rule at lines 82-83).
- **IMPLEMENT**: Amend the header comment's `questions` entry (lines 21-22): the rationale ("#23 serves them where an attempt can be recorded") still holds for perm; the locum list is served here precisely because locum candidates record no attempts — `{text, type}` only, no `id`, no `competency_id`, no `difficulty`, no `axis` (each of those names is a score or a handle the candidate has no use for).
- **PATTERN**: the header's own discipline — every kept/dropped field is argued in place.
- **GOTCHA**: no `id` means the locum list can never be POSTed against — that is the design, not an omission. `type` defaults `"competency"` because pre-#50 payloads can't be locum (no `engagement`) — the default is belt-and-braces, not a live path.
- **VALIDATE**: `node --test test/prep-projection.test.js` — locum payload → questions present, each entry exactly `{text, type}` (assert key sets, the suite's habit); perm payload → `"questions" in result === false`; absent engagement → `"unknown"`.
- **SATISFIES**: AC "a perm role renders the existing drill untouched" (delivery half) + the primer page's data supply.

### UPDATE `public/prep/registry.js` — two constructors

- **IMPLEMENT**: (1) `FirstDayPrimer(doc, props, ctx, id)` in the **brief** family: heading from `COPY`, optional intro paragraph, then one entry per `props.items[]` — topic as a label, detail as body text, and the sourced/unsourced mark following the `PanelBrief` constructor's exact logic (`"failed_field_key" in entry` first, then the key check — read the panel constructor at ~lines 218-268 and mirror its mark rendering and its refusal to print the failed key). Add `"FirstDayPrimer"` to `BRIEF_BLOCK_NAMES` (line 44-50) and `REGISTRY` (line 522+). (2) `LocumQuestions(doc, props, ctx, id)` in the **session** family (pattern: `DayBeforeMode`, line 501): props `{ client: string[], competency: string[], screening: string[] }` — up to three groups, each a `COPY` heading plus a plain list; skip empty groups. Add to `SESSION_BLOCK_NAMES` (line 54-60) and `REGISTRY`.
- **IMPLEMENT**: `COPY` entries (line 67+), plain language: e.g. `firstDayHead: "Your first day"`, `locumClientHead: "What this manager tends to ask"`, `locumCompetencyHead: "Expect to be asked about your experience"`, `locumScreeningHead: "Have ready"`, plus the unsourced mark string if the panel one isn't reusable.
- **PATTERN**: constructors are `createElement` + text nodes only; headings from `COPY`, never from model output; unknown-name handling is already `renderBlocks`'s (warn-and-skip).
- **GOTCHA**: three test contracts break on this and must be amended deliberately: the REGISTRY count assertion and the `BRIEF_BLOCK_NAMES === BLOCK_NAMES` deep-equal (`test/prep-registry.test.js:86-120` — update "ten names" to twelve, and the comment), and `test/fixtures/prep-session-blocks.json` (add `LocumQuestions`; asserted at ~line 298). The parity test imports the schema's `BLOCK_NAMES` — Phase 1's append keeps them equal only once the registry side lands too.
- **VALIDATE**: `node --test test/prep-registry.test.js` — parity + count pass; `FirstDayPrimer` renders items with marks (sourced and demoted fixtures); `LocumQuestions` renders groups, skips empty ones, and never prints a type slug raw.
- **SATISFIES**: AC "a locum booking renders the primer surface" (render half); the structural safety rail stays (no constructor renders answers or scores).

### UPDATE `public/prep/session.js` — the locum branch

- **IMPLEMENT**: In `load()` (~line 248-255), after the brief JSON lands, set `state.engagement = brief?.engagement === "locum" ? "locum" : "other"` (add `engagement: "other"` to the state literal, line 157-172). In `renderPrime` (line 268), add the locum branch **before** the `state.dayBefore` branch (for a locum, site access IS the day-before content): compose `blocks = []` — cherry-pick `FirstDayPrimer` from `brief.blocks` (the day-before branch's exact cherry-pick move, line 277-278), then `LogisticsRail` if present, then push `{ name: "LocumQuestions", props: { client, competency, screening } }` grouped from `brief.questions ?? []` by `type`. `renderBlocks(...)` into `primeMount`, set `state.phase = "done"`, `startButton.hidden = true`, show `actPrime`. No drill entry, no ProgressStrip, no habits, no last-close.
- **IMPLEMENT**: Resume guard: the `payload.turns_this_session > 0 → enterDrill()` path (line 260-262) predates this branch; a locum invite has no attempts (the UI never offers the drill), so the guard is naturally inert — leave it, but add `state.engagement === "locum"` to the `renderPrime` routing so a locum never lands in `enterDrill()` even if an attempt row somehow exists. New `COPY` strings for anything visible (e.g. a one-line intro under the primer, and a graceful line when the brief fetch failed and there is nothing to show — the existing `COPY.failed` covers the total-failure case).
- **PATTERN**: session.js:275-296 (the day-before branch) — this is a third sibling of that branch, same composition idiom.
- **GOTCHA**: the brief fetch failing degrades prime only (line 203) — for locum, a null brief means no primer AND no questions; render the failed state rather than an empty page. No browser storage, nothing candidate-shaped in URLs, no document reads at module scope (drill-ui plan rules).
- **VALIDATE**: `node --test test/prep-session-ui.test.js` — over real route handlers + real-SQLite D1: a locum handover (stored `brief_json.engagement === "locum"`, questions with types) renders the primer blocks and the grouped list, Start hidden, drill never entered; a perm handover renders the existing prime byte-for-byte (snapshot the perm path BEFORE these edits if the suite doesn't already pin it); day-before + locum takes the locum branch.
- **SATISFIES**: AC "a locum booking renders the primer surface and the slim mix; a perm role renders the existing drill untouched".

### UPDATE `public/prep/session.css` — only if needed

- **IMPLEMENT**: Reuse existing classes (`block`, `prep-list`, `prep-label`, `prep-caption`) first; add rules only if the primer genuinely needs them. Every value through a `tokens.css` custom property; no `:focus` rules; nothing sets `display` on `[hidden]` nodes; `prep.css` stays animation-free (the gate).
- **VALIDATE**: `npm test` (the CSS gates are test-enforced).
- **SATISFIES**: house style; likely a no-op task.

### Final sweep

- **IMPLEMENT**: Re-read the ticket's acceptance list against the diff; run the whole suite; grep for accidental `client.note` reads in anything candidate-facing (`grep -rn "\.note" src/prep functions/prep public/prep`) — this ticket must add none.
- **VALIDATE**: `npm test` — zero failures, zero skips (CI fails on skips).

---

## TESTING STRATEGY

### Unit Tests

`node:test` + `node:assert/strict`, zero dependencies, flat `test/*.test.js`. Every task above lands with cases in the suite that already owns the module (schema → `prep-schema`, verify → `prep-verify`, prompt/generate → `prompt` / `prep-generate` with the fake SDK client asserting on the built request, projection → `prep-projection`, registry → `prep-registry` with the document double, send → `prep-send` over `test/helpers/sqlite-d1.js`).

### Integration Tests

`test/prep-session-ui.test.js` is the integration seam: real route handlers over real-SQLite D1 driven through `initSession({doc, fetchImpl})`. Add one locum end-to-end (send → session page renders primer + list) and pin the perm path unchanged.

### Edge Cases

- Stored pre-#50 `brief_json` (no `engagement`, questions without `type`): every read path (brief route's `assertBrief`, projection, registry) behaves exactly as before — perm surface, no throw.
- Locum brief, recruiter shared **nothing** (empty visible slice): generation still runs (generate.js:66-70's rule); the prompt says omit the primer; the page shows the question list alone.
- Locum brief where the model emitted a primer item citing a hidden field: demoted, renders marked, send NOT blocked.
- `engagement: "unknown"` (neither vocabulary matched): perm path everywhere — fail toward existing behavior.
- Day-before + locum: locum branch wins.
- Browser posts a forged `engagement` or forged `type` values at send: engagement overwritten server-side; a bad `type` is caught by `assertBrief` at send (line 250-254) as a 400.
- Locum brief payload fetch fails on the session page: failed state, not a blank prime.

---

## VALIDATION COMMANDS

Execute every command to ensure zero regressions and 100% feature correctness.

### Level 1: Syntax & Style

There is no linter or typechecker (deliberate). The repo's source-scan gates run inside the test suite (no innerHTML, no SDK import in send.js, CSS gates), so Level 1 is:

```bash
node --check src/prep/schema.js src/prep/prompt.js src/prep/generate.js src/prep/verify.js src/prep/projection.js functions/api/prep/send.js
grep -rn "\.note" src/prep public/prep functions/prep   # must show no new client.note reads
```

### Level 2: Unit Tests

```bash
node --test test/prep-schema.test.js test/prep-verify.test.js test/prep-generate.test.js test/prompt.test.js test/prep-projection.test.js test/prep-registry.test.js
```

### Level 3: Integration Tests

```bash
node --test test/prep-send.test.js test/prep-session-ui.test.js
npm test   # the whole suite; CI also fails on any skip
```

### Level 4: Manual Validation

Optional but worth one pass: `scripts/gen-brief.js` (the CLI harness around `generateBrief`) against a locum-worded fixture brief with `ANTHROPIC_API_KEY` set — eyeball that the payload carries `engagement: "locum"`, a `FirstDayPrimer`, and a question mix weighted `client` > `competency` > `screening`. Check the script's usage header first; it predates `engagement` and may need its output print extended (fine — it is an operator script, not a route).

### Level 5: Additional Validation (Optional)

`npx wrangler pages dev` with a seeded local D1, send a locum invite end-to-end, open the magic link, confirm the primer page in a real browser (the DOM double cannot check focus/layout — prep-session-ui's own header says so).

---

## ACCEPTANCE CRITERIA

- [ ] A locum booking renders the first-day primer surface and the slim question mix (client/competency/screening, grouped) on the candidate session page; the drill is never entered.
- [ ] A perm role renders the existing drill flow byte-for-byte untouched (session-ui pins it).
- [ ] `BLOCK_NAMES` extended deliberately with `FirstDayPrimer`; registry parity/count tests amended, not deleted.
- [ ] `assertBrief` enforces the `type` enum (invalid values throw; absence tolerated on stored payloads).
- [ ] All candidate-facing note content flows through `visibleFields()` only — no new `client.note` reads; primer items carry checked `source_field_key` provenance, demoted not dropped.
- [ ] No promises of visibility into candidate prep performance anywhere in new copy or data flows.
- [ ] `engagement` is deterministic server truth (browser-posted values overwritten at send); absent flag reads `"unknown"` and behaves as perm.
- [ ] `npm test` passes with zero failures and zero skips; no regressions.

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] All validation commands executed successfully
- [ ] Full test suite passes
- [ ] Manual/CLI check confirms a locum payload's shape (if a key is available)
- [ ] Acceptance criteria all met
- [ ] PR body links `Closes #50`

---

## OPEN QUESTIONS / ASSUMPTIONS

- **A1 — no interactive drill for locum (the plan's biggest call).** The ticket says "a slim question set **instead of the full interview drill**" and "the portal only tells them what the agency knows that they can't" — read here as a *readable* list, not a slimmer practice loop. Consequence: no `type` column in D1, no targeting/drill changes, no attempt recording for locums. If Louis expected locum candidates to practise answers interactively, this plan under-builds — flag before execution if in doubt. (The fallback design is known: migration 0008 `type TEXT CHECK`, type-aware `nextQuestion` in targeting.js, and prompt branches in drill.js for questions with no drillable competency — all deliberately out of scope now.)
- **A2 — `engagement`, not `role_shape`, as the payload key.** Avoids colliding with `PrimerCard.props.role_shape` (free prose, schema.js:74). The enum values are `briefProfile`'s own.
- **A3 — locum branch beats day-before.** For a booking, "how do I get in tomorrow" IS the day-before content. The `/prep/api/turn` endpoint remains technically reachable for a locum invite (harmless — all guardrails hold); the UI simply never calls it.
- **A4 — screening questions still carry a `competency_id`.** Keeping the question shape uniform preserves `assertBrief`'s reference invariants and the persist path; the model ties each to the nearest competency. The locum surface never shows competency labels, so the attachment is invisible.
- **A5 — `questions` in the projection only when locum.** Perm exposure would leak the bank ahead of the drill; the conditional is the rule, not an optimisation.

## NOTES (open canvas)

**Why the flag is computed twice (generate.js and send.js) rather than passed through**: the browser round trip between prepare and send is untrusted by design (send.js's header). `briefProfile` is pure and cheap; recomputing from the cleaned brief/cv makes the stored value a function of stored inputs, so the row can never disagree with its own `jd_text`. Same-function determinism is the consistency mechanism — no schema field, no body field, no trust.

**Why the primer is a brief block, not session-side composition**: DayBeforeMode composes from COPY + labels the client already has; the primer's *content* (which scanner fleet, who to report to) only exists in the model's read of the visible note fields, so it must be minted at the Opus call and travel in `brief_json`. The question *list* is the opposite case — pure data already in the payload — hence a session-side block.

**Rejected: asking the model for `engagement`.** A model-classified flag would need schema plumbing, could disagree with the pack's `role_shape` for the same brief, and buys nothing over the deterministic read that already exists (#46 built it precisely so downstream slices could branch without a model call).

**Rejected: widening `/prep/api/session` for locum.** It would touch the endpoint whose header boasts "zero model calls, structurally" and whose response literal is a leak-prevention discipline; the brief endpoint + projection already carry everything the surface needs, and the perm-untouched guarantee is strongest when the perm-serving endpoint has a zero-line diff.

**Sequencing risk**: the registry parity test (`BRIEF_BLOCK_NAMES` deep-equals schema `BLOCK_NAMES`) fails between the schema task and the registry task. Fine within one branch — just don't stop mid-way expecting green; run the schema suite file-scoped until the registry task lands.

**Copy register**: all new candidate-visible strings in the two COPY objects, plain first-time-reader language, no scores, no verdicts, no "you're ready".

## AMENDMENTS

<!-- append-only; newest at the bottom -->
