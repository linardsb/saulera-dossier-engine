# Feature: Locum booking pack — compliance-first submission variant

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

## Feature Description

A submission-pack **variant for locum roles**, optimised for "the client can say yes today", not "the client should interview them". The pack gains three locum-only sections — a compliance status summary (the NHS Employment Check Standards gate: HCPC, DBS, occupational health, mandatory training, right-to-work), an availability-and-rate block, and a modality/scanner matrix — generated through the existing single schema and rendered through the existing `src/pack.js` + `src/render/` seam. Perm packs are byte-identical to today's output.

## User Story

As a recruiter running a locum imaging desk
I want a submission pack that leads with compliance status, availability, rate and the modality/scanner match
So that the client can confirm the booking today from the pack alone, instead of scheduling an interview the locum process doesn't have.

## Problem Statement

The pack's current shape (headline → evidence against the brief → process fit → gaps) is an *interview-selling* document. For a locum imaging booking the client's gate is compliance plus "can they run the list on day one" — the current pack buries exactly the facts that decide a booking, and the recruiter edits it by hand before sending. Epic #45's success metric is a locum brief producing a pack the recruiter sends **without editing**.

## Solution Statement

Extend the one canonical pack contract with three locum sections (empty for perm roles), teach the locum branch of the existing `domainBlock` prompt to fill them, and render them — when non-empty — at the top of the existing renderers. No second schema, no second prompt, no parallel render path. The provenance mechanism (verbatim-quote claims, `verifyPack` demotion, visible `[UNVERIFIED]` markers, sources footer) covers the new sections exactly as it covers the old ones.

## Out of Scope / Non-Goals

- **Not included: expiry surfacing** (DBS/training expiry warnings) — that is #47, PAID scope, gated on a commercial agreement.
- **Not included: portal changes** — the first-day primer and question mix are #50 (independent, runs in parallel).
- **Not included: persisting compliance data.** The pack is generated and rendered per-request; candidate data is never written to D1 or logs (repo-wide guardrail — see the ⚠ headers in `src/generate.js` and `functions/api/generate.js`).
- **Not changing: the perm pack's rendered output.** Existing snapshot files under `test/fixtures/*.snap` must not change. If a diff appears there, the implementation is wrong.
- **Not changing: the byte-identical prompt blocks** pinned by `test/prompt.test.js` (`noteBlock`, `inputsBlock`, `SYSTEM`, the cache breakpoint). The schema text inside `OUTPUT_INSTRUCTION` *will* grow for every brief — that is accepted and precedented (#46 grew it with `role_shape`).
- **Not changing: `/api/verify`'s body vocabulary.** The brief stays out of it; see the "brief is not a source type" design decision in NOTES.
- **Not adding: a "brief" source type.** See NOTES — this is the load-bearing sourcing decision of this plan.
- **Not adding: any UI change.** The one-screen displays the `text`/`html` the API returns; `public/counts.js` reads the `provenanceSummary` shape, which does not change.

## Feature Metadata

**Feature Type**: Enhancement
**Estimated Complexity**: Medium
**Primary Systems Affected**: `src/pack.js`, `src/provenance.js`, `src/prompt.js`, `src/render/appendix.js`, `src/render/inline.js`, tests
**Dependencies**: none new — pure JS, `node --test`

## Related Work

**Implements**: [#49 Locum booking pack](https://github.com/linardsb/saulera-dossier-engine/issues/49) — close with `Closes #49`   ·   **Epic**: #45 (Imaging-locum fit, slice 2). Epic constraints inherited: perm flow stays working; candidate data never persisted; same deployment/stack; no new services.

**Back-references** (plans this builds on or inherits decisions from):

- `.claude/plans/imaging-domain-vocabulary.md` (#46) — Why: created `briefProfile`, `role_shape` on the pack contract (tolerant-on-absence pattern at `src/pack.js:130-135`), and the `domainBlock` seam this plan extends. Its decision that render code takes role shape **from the pack, not the parser** (`src/pack.js:12-14`) is inherited.
- `.claude/plans/client-note-locum-fields.md` (#48, merged as PR #52) — Why: its A2/A4 decisions promise this ticket `LOCUM_FIELDS`/`locumFieldFor` in `src/note-fields.js`, and its A1 decision assigns **role-shape branching at generation time to this ticket**. This plan consumes the note fields via static prompt wording (see NOTES), so `locumFieldFor` is not imported — record why in the PR if a reviewer asks.
- `.claude/plans/generation-seam-and-one-screen.md` — Why: the verify/generate response-shape parity both API adapters preserve.

**Forward-references**:

- (none yet — #50 is a sibling, not a dependent)

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `src/pack.js` (whole file, 137 ln) - Why: the contract being extended. The `claim(extra)` factory (lines 16-36) is how the new sections get their label fields; the `role_shape` tolerance comment (lines 130-135) is the pattern the new sections' `assertPack` handling MIRRORS.
- `src/provenance.js` (whole file, 98 ln) - Why: `verifyPack` (line 47) and `provenanceSummary` (line 91) iterate `CLAIM_SECTIONS` and index `pack[section]` **without a guard** — both must gain `?? []` when the section list grows to include sections old packs lack.
- `src/prompt.js` (lines 60-91 `domainBlock`; 133-138 `OUTPUT_INSTRUCTION`) - Why: the locum bullet at lines 81-89 is where the new generation instructions go. The emptiness-for-nursing contract (lines 62-64) must survive.
- `src/domain.js` (lines 12-13, 78-100) - Why: `ROLE_SHAPES` and `briefProfile` — context only; nothing here changes.
- `src/render/appendix.js` (whole file) - Why: the default renderer. `collect()`/`tag()` (lines 10-22) is the citation machinery the new sections reuse; `section()` in `toHtml` shows the empty-section-skip idiom.
- `src/render/inline.js` (whole file) - Why: the second renderer, same changes.
- `src/render/text.js` - Why: `wrap`, `mark`, `quote`, `escapeHtml`, `UNVERIFIED` — use these, do not reimplement.
- `src/generate.js` (lines 95-148) - Why: nothing changes here, but confirm: `PACK_SCHEMA` rides `output_config.format` directly, so the schema change reaches the API path with zero edits.
- `src/note-fields.js` (lines 231-255) - Why: `LOCUM_FIELDS` — the five canonical note fields (`credentialing`, `vms`, `protocols`, `site-access`, `extensions`) whose *content* the prompt tells the model to surface. Read to get the vocabulary right in the prompt wording.
- `test/prompt.test.js` (whole file) - Why: the regression pins you must not break, and the imaging-block test pattern (lines 150-201) the new prompt tests MIRROR.
- `test/render.test.js` (whole file) - Why: the snapshot harness (`snapshot()`, `UPDATE_SNAPSHOTS=1`), and every property test that will automatically cover the new sections once `allClaims` includes them.
- `test/paste.test.js` (lines 181-208) - Why: the role_shape tolerance-round-trip tests the new sections' tests MIRROR.
- `test/generate.test.js` (lines 1-60 for `fakeAnthropic`/`ok()` helpers; 178-210) - Why: the fake-client pattern if a generate-path assertion is added.
- `test/fixtures/pack-sourced.json`, `test/fixtures/pack-unverified.json` - Why: fixture shape to copy for the new `pack-locum.json`.
- `functions/api/generate.js` + `functions/api/verify.js` - Why: confirm no changes needed — both call `render(result.pack, agency.renderer)` and return the same shape.

### New Files to Create

- `test/fixtures/pack-locum.json` - a locum pack fixture: `role_shape: "locum"`, populated `compliance` / `booking` / `modality_matrix` (mix of cv / client_note / unverified source types), populated evidence/gaps, an availability open question.
- `test/fixtures/locum.appendix.text.snap`, `locum.appendix.html.snap`, `locum.inline.text.snap`, `locum.inline.html.snap` - generated by the harness on first run; **read them** before committing.

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- `docs/epics/` architecture §5.4 (provenance enforced in code) and §5.5 (generation/render split) — Why: the two rules this feature must not bend.
- [NHS Employment Check Standards](https://www.nhsemployers.org/publications/employment-checks-standards) — Why: the six check names the `compliance` section's `check` field should use in prompt wording: identity, right to work, DBS, professional registration (HCPC), employment history/references, occupational health. The ticket names HCPC, DBS, OH, mandatory training, right-to-work — use the ticket's five; mandatory training rides the framework (RM6397) audit requirement.
- No new libraries. No external API docs needed — the schema change flows through the existing `output_config.format` and `OUTPUT_INSTRUCTION` seams.

### Patterns to Follow

**Tolerant on absence, strict on presence** (`src/pack.js:130-135`) — the exact pattern for the three new sections in `assertPack`:

```js
// Tolerant on absence, strict on presence: packs generated before role_shape shipped (the
// spike pack, a paste from a tab opened pre-deploy) still verify; consumers read
// `pack.role_shape ?? "unknown"`.
if (pack.role_shape !== undefined && !ROLE_SHAPES.includes(pack.role_shape)) {
```

**Claim factory with a label field** (`src/pack.js:54-59`) — `evidence` items carry a brief-derived `requirement` label plus a sourced claim. The three new sections use the same factory:

```js
items: claim({
  requirement: { type: "string", description: "The requirement from the brief this addresses." },
}),
```

**Empty section renders no heading** (`src/render/appendix.js:40-48`, pinned by `test/render.test.js:171-182`):

```js
if (pack.process_fit.length) {
  L.push("", "WHAT WE KNOW ABOUT YOUR PROCESS", "");
  ...
```

**Schema constraints** (`src/pack.js:4-6`): structured outputs reject recursive schemas and numeric/length constraints; every object needs `additionalProperties: false`; every property is listed in `required`. Descriptions are load-bearing instructions (`src/prompt.js:130-132`) — write them as instructions to the model, not documentation.

**Prompt register**: read the existing `domainBlock` bullets before writing new ones — short, imperative, addressed to the model, with the *why* in-line ("reads as a category error to an imaging manager").

---

## IMPLEMENTATION PLAN

### Phase 1: Contract (`src/pack.js` + `src/provenance.js`)

The three sections enter the schema and the enforcement machinery. Everything downstream keys off this.

### Phase 2: Prompt (`src/prompt.js`)

**Depends on:** Phase 1 (descriptions live in the schema; the bullet references the sections by name)

### Phase 3: Render (`src/render/appendix.js`, `src/render/inline.js`)

**Depends on:** Phase 1 only. **Independent of:** Phase 2 — could be built in parallel, but the diff is small enough that sequential is simpler.

### Phase 4: Tests & fixtures

Interleaved in practice — each task below carries its own test work; the fixture/snapshot task runs after Phase 3.

---

## STEP-BY-STEP TASKS

### UPDATE `src/pack.js` — the three locum sections on the contract

- **IMPLEMENT**: Add to `PACK_SCHEMA.properties`, after `open_questions` and before `role_shape`:
  - `compliance`: array, `items: claim({ check: { type: "string", description: "Which check this is: HCPC registration, DBS, occupational health, mandatory training, or right to work." } })`. Array description: instruct — locum bookings only; one item per check the evidence speaks to; where the CV or note is silent on a check, either omit it or carry it unverified and raise it in open_questions; for a permanent role return an empty array.
  - `booking`: array, `items: claim({ item: { type: "string", description: "What this line is: Availability, Rate, or an engagement term such as IR35 status." } })`. Description: locum bookings only; availability window and rate as the client needs them to say yes; empty array for a permanent role.
  - `modality_matrix`: array, `items: claim({ row: { type: "string", description: "The modality, list or scanner this row covers, e.g. 'MRI — Siemens Aera'." } })`. Description: locum bookings only; map the brief's modalities/lists/fleet to the candidate's hands-on evidence, one row each; scanners on the CV the brief does not name still earn a row; empty array for a permanent role.
  - Add all three to `PACK_SCHEMA.required` (structured-outputs convention — every property required).
- **IMPLEMENT**: `export const LOCUM_SECTIONS = ["compliance", "booking", "modality_matrix"];` next to `CLAIM_SECTIONS`. Update `allClaims` to flat-map over `[...CLAIM_SECTIONS, ...LOCUM_SECTIONS]` (its `?? []` guard already tolerates absence).
- **IMPLEMENT**: In `assertPack`, validate the three sections **tolerant on absence, strict on presence** (mirror role_shape, `src/pack.js:130-135`): for each of `LOCUM_SECTIONS`, if `pack[section] !== undefined` it must be an array and each item passes the same text/source_quote/source_type checks the `CLAIM_SECTIONS` loop applies. Factor the per-claim check out of the existing loop rather than duplicating it.
- **GOTCHA**: Do NOT add the sections to `CLAIM_SECTIONS` — that would make them hard-required in `assertPack` and break `spike/pack.json`, `test/fixtures/pack-*.json`, and any pack pasted from a pre-deploy tab.
- **GOTCHA**: No `minItems`/`maxItems` anywhere — structured outputs reject numeric constraints (`src/pack.js:5`).
- **VALIDATE**: `node --test test/paste.test.js test/render.test.js` (existing fixtures still pass `assertPack`)
- **SATISFIES**: AC "renders through src/pack.js … without a parallel render path"; AC "perm brief still produces the existing dossier pack"

### UPDATE `src/provenance.js` — verify and count the new sections

- **IMPLEMENT**: In `verifyPack` and `provenanceSummary`, iterate `[...CLAIM_SECTIONS, ...LOCUM_SECTIONS]` and guard with `pack[section] ?? []` (both currently index unguarded — `src/provenance.js:83-85, 93-95`). In `verifyPack`, only set `verified[section]` when the section is present, so a legacy pack round-trips without gaining empty arrays it never had.
- **IMPORTS**: `import { CLAIM_SECTIONS, LOCUM_SECTIONS } from "./pack.js";`
- **GOTCHA**: The demote-don't-drop behaviour must apply identically — a fabricated compliance quote comes back `source_type: "unverified"` with `failed_quote`, never dropped. Nothing else in the function changes.
- **VALIDATE**: `node --test test/provenance.test.js test/generate.test.js`
- **SATISFIES**: AC "provenance stays visible (product rule)"

### ADD tests to `test/paste.test.js` (or a new describe block in it) — contract round trip

- **IMPLEMENT**: Mirror the role_shape block at lines 181-208: (1) a pack carrying populated locum sections survives `extractPack` + `assertPack` intact; (2) a malformed item (`compliance: [{ text: 1 }]`) is rejected naming the section; (3) the legacy `FULL_PACK` without the sections still passes (absence tolerance).
- **PATTERN**: `test/paste.test.js:197-208`
- **VALIDATE**: `node --test test/paste.test.js`
- **SATISFIES**: AC "perm brief still produces the existing dossier pack" (legacy tolerance)

### ADD tests to `test/provenance.test.js` — enforcement covers the new sections

- **IMPLEMENT**: (1) a `compliance` claim whose quote is not in the CV is demoted with `failed_quote` preserved and a failure row naming `section: "compliance"`; (2) `provenanceSummary` counts claims in all three new sections; (3) a pack without the sections verifies and counts as before.
- **PATTERN**: existing demotion tests in `test/provenance.test.js`
- **VALIDATE**: `node --test test/provenance.test.js`
- **SATISFIES**: AC provenance

### UPDATE `src/prompt.js` — the booking-pack generation instructions

- **IMPLEMENT**: Inside the existing `if (profile.role_shape === "locum")` branch of `domainBlock` (line 81), extend the pushed guidance (amend the existing bullet and/or add bullets) to instruct:
  - Fill `compliance`, `booking` and `modality_matrix` — this pack's job is to let the client confirm the booking today; those three sections are what they read first.
  - Compliance claims follow the same verbatim-quote rule as everything else; where the CV/note does not evidence a check, carry it unverified and put the chase in `open_questions` — an honest "DBS status unconfirmed" is the pack working, not failing.
  - The brief's own asks (rate offered, start date wanted) belong in the `item`/`row`/`check` labels; claim text states the *candidate's* side and must be sourced from the CV or the note (the brief is not a source).
  - Where our note records credentialing quirks or the VMS/portal bookings go through, surface them (in `compliance` or `process_fit`) — that is agency knowledge a job board cannot produce. If the note doesn't record them, say nothing about them.
- **GOTCHA**: Touch ONLY the locum branch. The perm-imaging block and the nursing emptiness are pinned by `test/prompt.test.js:181-195`. No signature change — the note is not a `domainBlock` input (static wording covers the degrade-gracefully requirement; see NOTES).
- **VALIDATE**: `node --test test/prompt.test.js`
- **SATISFIES**: AC "a brief flagged locum … produces the booking-pack variant"; ticket "consumes slice 4's client-note fields … degrade gracefully"

### ADD tests to `test/prompt.test.js` — the locum instructions travel, and only for locum

- **IMPLEMENT**: Using the existing `IMAGING_INPUTS` (a locum brief): the paste prompt and `buildMessages` second block name the three sections and the note-fields instruction; the permanent-imaging domain block does not; the nursing prompt still has an empty domain block (existing test must keep passing untouched); both shapes carry the same locum text (mirror the drift test at line 197).
- **PATTERN**: `test/prompt.test.js:163-201`
- **VALIDATE**: `node --test test/prompt.test.js`

### UPDATE `src/render/appendix.js` — booking sections in the default rendering

- **IMPLEMENT**: In `toText`: after the headline and BEFORE "AGAINST THE BRIEF", render each new section when non-empty, using the existing `tag(c)` citation machinery:
  - `COMPLIANCE AT A GLANCE` — `• ${c.check}: ${c.text}${tag(c)}` per item
  - `AVAILABILITY AND RATE` — `• ${c.item}: ${c.text}${tag(c)}` per item (from `pack.booking`)
  - `MODALITY AND SCANNER MATRIX` — `• ${c.row}: ${c.text}${tag(c)}` per item
  Title line: `LOCUM BOOKING — ${pack.role_title}` when `(pack.role_shape ?? "unknown") === "locum"`, else the existing `SUBMISSION PACK — …`. Guard every section read with `pack.compliance ?? []` etc. (legacy packs lack the keys).
  In `toHtml`: same three sections through the existing `section()`/`claimLi()` helpers with the label-prefix form used by `evidence` (`claimLi(c, `<strong>${e(c.check)}:</strong> `)`), same position, same title branch.
- **PATTERN**: `src/render/appendix.js:37-53` (text sections), `99-105` (html sections)
- **GOTCHA**: `collect()`'s citation numbers follow **render order** — booking sections render first, so their sources number first. That is correct; do not renumber. GOTCHA 2: never render a heading for an empty/absent section (pinned pattern, `test/render.test.js:171`). GOTCHA 3: existing snapshots must not change — the fixtures have no locum sections and `role_shape` absent/perm.
- **VALIDATE**: `node --test test/render.test.js` (existing snapshots untouched)
- **SATISFIES**: AC booking-pack variant; AC perm unchanged; AC no parallel render path

### UPDATE `src/render/inline.js` — same sections, inline sourcing

- **IMPLEMENT**: Same three sections, same position and title branch, in this renderer's idiom: `wrap` the labelled claim with `mark(c)`, then the `src(c)` source line (text); `claim(c, prefix)` items through `section()` (html).
- **PATTERN**: `src/render/inline.js:23-29` (evidence's label-then-claim-then-source shape)
- **VALIDATE**: `node --test test/render.test.js`

### CREATE `test/fixtures/pack-locum.json` + ADD render tests

- **IMPLEMENT**: A realistic locum pack (Priya-Nair-flavoured MRI/CT radiographer is the house demo persona): `role_shape: "locum"`; 4-5 `compliance` items (mix: HCPC sourced from cv, DBS unverified, one credentialing quirk sourced from client_note); 2 `booking` items; 2-3 `modality_matrix` rows; 2-3 `evidence` items; 1 gap; an availability-confirmation open question. Then in `test/render.test.js`:
  - Add the fixture to the snapshot loop (extend the `[fixture, pack]` array with `["locum", LOCUM_PACK]`) — 4 new snapshots.
  - Property tests: title reads `LOCUM BOOKING` for the locum fixture and `SUBMISSION PACK` for the perm ones; `COMPLIANCE AT A GLANCE` appears before `AGAINST THE BRIEF`; each unverified compliance item carries `[UNVERIFIED]` and no citation/source line; the three headings are absent from both perm fixtures' output; page budget (`≤110` lines) holds for the locum fixture.
  - The existing property tests (`every claim reaches the output`, marker counts, citation contiguity) cover the new sections automatically once `allClaims` includes them and the fixture is added to those loops where they iterate fixtures — extend the loops that hardcode `SOURCED`/`UNVERIFIED_PACK` where it strengthens coverage (at minimum the every-claim-reaches-output test).
- **GOTCHA**: Run once to generate snapshots, then **read all four snapshot files** and check them against the acceptance ("a client could say yes today from this") before committing. A snapshot you didn't read is not a review.
- **VALIDATE**: `node --test test/render.test.js && git diff --stat test/fixtures/` (only NEW files; zero modified `.snap`)
- **SATISFIES**: AC booking-pack variant; AC perm unchanged; AC provenance visible

### UPDATE `test/generate.test.js` — the schema on the wire (small)

- **IMPLEMENT**: The existing assertion `config.format.schema === PACK_SCHEMA` (line 124) already proves the new sections reach the API path. Add one assertion to the imaging test (line 187): the request's second block names the three sections for the locum brief.
- **VALIDATE**: `node --test test/generate.test.js`

### UPDATE `.claude/plans/client-note-locum-fields.md` — forward-reference

- **IMPLEMENT**: Under its Forward-references, add `- .claude/plans/locum-booking-pack.md — #49 consumes the note vocabulary via prompt wording (static instruction; locumFieldFor not imported — see that plan's NOTES).` Append an AMENDMENTS line dated today.
- **VALIDATE**: `git diff .claude/plans/client-note-locum-fields.md`

---

## TESTING STRATEGY

### Unit Tests

`node --test` only, no framework. Every changed module already has a sibling test file — extend those, create none. The load-bearing properties: absence tolerance (legacy packs verify), strict presence (malformed locum items rejected by name), demotion coverage (a bad compliance quote demotes, never drops), prompt gating (locum instructions appear for locum imaging briefs only), render gating (headings only when non-empty; perm snapshots byte-identical).

### Integration Tests

The round trip is the integration: `buildPastePrompt` → a hand-built model reply carrying locum sections → `extractPack` → `assertPack` → `verifyPack` → `render`. The generate-path equivalent runs through `fakeAnthropic` in `test/generate.test.js`.

### Edge Cases

- Legacy pack (no locum sections, no role_shape) through `assertPack`, `verifyPack`, `provenanceSummary`, both renderers — unchanged output.
- Locum pack with ALL locum sections empty arrays (model judged perm-shaped despite the flag) — no empty headings, still titled LOCUM BOOKING (role_shape drives the title, content drives the sections).
- Perm pack that carries populated locum sections (model disobeyed) — sections render (never drop content), title stays SUBMISSION PACK.
- Unverified compliance claim — `[UNVERIFIED]`, no citation number, no source line, counted in `provenanceSummary`.
- `role_shape: "unknown"` — perm rendering (the safe default).

## VALIDATION COMMANDS

### Level 1: Syntax & Style

No linter is configured. `node --check src/pack.js src/provenance.js src/prompt.js src/render/appendix.js src/render/inline.js`

### Level 2: Unit Tests

`npm test` — the full suite (`node --test test/*.test.js`), zero failures, zero skips.

### Level 3: Integration Tests

Covered inside the suite (round-trip + fakeAnthropic tests above). Additionally: `git diff --name-only test/fixtures/` shows only ADDED files.

### Level 4: Manual Validation

`node -e "import('./src/render/index.js').then(async ({render}) => { const p = JSON.parse((await import('node:fs')).readFileSync('test/fixtures/pack-locum.json','utf8')); console.log(render(p).text) })"` — read the output as Louis would: can the client say yes from it?

### Level 5: Additional Validation (Optional)

`npm run dev` and paste the demo imaging brief/CV through the one-screen against a local D1 — only if the session has the environment for it; the suite is the gate.

## ACCEPTANCE CRITERIA

- [ ] A brief flagged locum (via `role_shape` on the pack) produces the booking-pack variant: compliance summary, availability/rate, modality/scanner matrix rendered first, titled LOCUM BOOKING.
- [ ] A perm brief produces the existing dossier pack — existing `.snap` files byte-identical, nursing prompt's domain block still empty.
- [ ] The variant renders through `src/pack.js` + `src/render/` — no new renderer, no new render entry point, `RENDERERS` unchanged.
- [ ] Provenance visible: locum-section claims carry citations/sources or `[UNVERIFIED]`; `verifyPack` demotes across all sections; `provenanceSummary` counts them.
- [ ] Legacy packs (pre-#46 and pre-#49) still pass `assertPack` and render unchanged.
- [ ] No candidate data persisted beyond the current schema (no store/migration/Function changes at all).
- [ ] `npm test` passes with zero regressions.

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] `npm test` green
- [ ] All four new snapshots read by a human eye (or this agent, carefully) against the "say yes today" bar
- [ ] `git diff` shows no modified existing snapshots
- [ ] PR body links `Closes #49`
- [ ] Branch cut from up-to-date `main` (PR #52 merged 2026-08-02 — `git fetch origin && git switch -c feat/locum-booking-pack origin/main`); this worktree is shared between sessions — verify `git branch --show-current` before every commit

## OPEN QUESTIONS / ASSUMPTIONS

- **A1 — Section vocabulary is `compliance` / `booking` / `modality_matrix`** with label fields `check` / `item` / `row`. The ids are the stable contract; rendered headings (`COMPLIANCE AT A GLANCE`, `AVAILABILITY AND RATE`, `MODALITY AND SCANNER MATRIX`) may be re-worded at implementation, ideally sanity-checked against the recruiter register (memory: every visible string written for a first-time recruiter).
- **A2 — The locum title changes to `LOCUM BOOKING — {role_title}`.** The ticket asks for a variant "optimised for the client can say yes today"; a pack that announces itself as a booking, not a submission-for-consideration, is part of that. If the owner prefers one unvarying title, it is a one-line revert.
- **A3 — All three sections are `required` in `PACK_SCHEMA`** (empty arrays for perm), per the schema's own convention that everything is required. `assertPack` stays tolerant on absence for legacy packs. If structured outputs on the live key rejects the grown schema for any reason, the fallback is dropping them from `required` — flag it in the PR if taken.
- **A4 — Renderer gating is content-driven, not flag-driven**: sections render when non-empty; only the title reads `role_shape`. This is what makes "no parallel render path" true rather than approximately true.
- **A5 — The note's locum fields are consumed via static prompt wording**, not by importing `locumFieldFor` and varying the prompt on note content. The full note is already in the prompt; detection would add a signature change and a note-dependent prompt for zero information the model doesn't have. #48's plan (A4) anticipated server-side `locumFieldFor` use — record the divergence in that plan's forward-reference (last task) and in the PR.

## NOTES (open canvas)

**The sourcing decision this plan turns on: the brief is not a source type.** `verifyPack` haystacks are `cv` and `client_note` only, and `/api/verify` deliberately excludes the brief from its body (`functions/api/verify.js` ALLOWED comment). The booking pack's most-wanted facts — rate, availability — usually live in the *brief* (the client's ask) or in the recruiter's head (the candidate's answer). Three options were weighed:

1. **Add a `brief` source type** — touches the verify contract, the `/api/verify` body vocabulary, the screen's input-freezing, and the paste path's round trip. Rejected: large blast radius for a fact the client already knows (their own rate), and it half-breaks the seam's "brief is not a source" invariant.
2. **Make availability/rate plain strings** outside the claim/provenance machinery — rejected: it creates the first pack content invisible to `verifyPack`, which is exactly the erosion §5.4 exists to stop.
3. **Chosen: labels carry the ask, claims carry the evidence.** The brief-derived ask lives in the unverified-by-design label field (`check`/`item`/`row` — same standing as `evidence[].requirement`, which has never been verified text); the claim text states the candidate's side and is sourced from CV/note or honestly `[UNVERIFIED]` + an open question ("confirm availability for the 1 Sep start"). An unverified availability line with a chase in open_questions is the product telling the truth, and mirrors how the existing pack already treats everything it cannot source.

**Citation ordering side effect**: because booking sections render before evidence, a locum pack's `[1]` is now a compliance source. `collect()` numbers in render order, and the contiguity test (`test/render.test.js:119`) verifies order-agnostically. No action, just awareness.

**Why not gate rendering on `brief_profile.role_shape`?** The render step often runs where no brief exists (the verify path receives only cv + pack_text). The pack's own `role_shape` is the contract (`src/pack.js:12-14` says #49 should read it from the pack), and generation is where brief → pack.role_shape resolution already happens (model-read, schema-constrained, regex-crosschecked by `brief_profile` in the response for the UI).

**Size check**: schema +~45 ln, provenance +~10, prompt +~15, renderers +~60, tests+fixtures +~350-450. Lands inside the ticket's 600-1200 estimate with room.

**Sequencing risk — none external**: #50 is independent (parallel-safe); nothing else touches these files on open branches (no open PRs as of 2026-08-02).

## AMENDMENTS

- 2026-08-02 — Executed on `feat/locum-booking-pack`; report at `.claude/reports/locum-booking-pack-report.md`. One deviation beyond A5: the nursing-prompt test's whole-prompt `/HCPC/` pin was scoped to the text before `OUTPUT_INSTRUCTION`, since the grown schema (accepted, Out-of-Scope) now names HCPC in the compliance description.
