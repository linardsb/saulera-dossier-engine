# Feature: Imaging domain vocabulary for the brief parser and generation prompts

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

## Feature Description

Teach the engine the imaging-locum taxonomy so every downstream slice of epic #45 has the right vocabulary:

- **Modality** (MRI / CT / ultrasound) and **specialism** (MSK, obstetric, general) recognised deterministically from brief text and carried into the generation prompts.
- **Scanner makes** (Siemens, GE, Philips, Canon, …) recognised in briefs and candidate CVs, and surfaced to the model as material evidence rather than trivia.
- **HCPC** (Health and Care Professions Council) registration language — never NMC — wherever the new imaging vocabulary speaks about registration. (There is currently **zero** NMC/HCPC/registration language hardcoded anywhere in `src/`, `functions/`, or `public/` — verified by grep. The HCPC requirement is satisfied entirely by the *new* text this ticket adds.)
- **Role shape**: locum vs permanent detected from the brief and exposed as a flag the pack/portal seams can branch on — carried in the pack itself (`pack.role_shape`), so it survives *both* generation routes (API call and paste round-trip).

## User Story

As a recruiter at an imaging-locum-heavy agency (TTR Healthcare)
I want the engine to understand imaging briefs — modality, specialism, scanners, HCPC, locum vs perm
So that generated packs speak the client's language and downstream slices (#48, #49, #50) can branch on role shape.

## Problem Statement

The engine's vocabulary is shaped for permanent nursing hires. An imaging-locum brief pasted in today produces a pack with no notion of modality, specialism, or scanner fit, and nothing downstream can tell a locum booking from a permanent hire. Slice 1 of epic #45 is the foundation every other slice branches on.

## Solution Statement

1. A new **pure, deterministic** module `src/domain.js` — no model call, no D1, no HTTP (same testability move as `src/note-fields.js`) — that parses brief/CV text into a profile: `{ imaging, role_shape, modalities, specialisms, scanner_makes }`. The detection rules are **fully specified in this plan** (exact regexes, Task 2) — implementation is transcription, not design.
2. `src/prompt.js` gains a `domainBlock(profile)` whose **text is pinned verbatim in this plan** (Task 6): imaging/locum guidance (HCPC language, modality/specialism vocabulary, scanner-make matching, "verify, don't sell" for locum) — and `""` for non-imaging briefs, so **existing perm-nursing prompts stay byte-identical** (the regression pin in `test/prompt.test.js:49` keeps passing untouched).
3. `PACK_SCHEMA` gains a `role_shape` enum (`"locum" | "permanent" | "unknown"`) so the flag rides inside the pack through both `/api/generate` and `/api/verify` — the only carrier both seams share. **Decided, not open** — see the three closed decisions below.
4. `generatePack` returns the deterministic profile as `brief_profile` so callers/tests can assert on it.

### Three decisions this plan closes (previously risks — now resolved with repo evidence)

**D1 — `role_shape` rides in the pack schema, not in HTTP fields.** `/api/verify` never sees the brief (its `ALLOWED` set deliberately excludes it, `functions/api/verify.js:27-30`), so a request/response field cannot reach the verify path. And the HTTP surfaces are *pinned by tests*: `test/seam.test.js:94` asserts `/api/prompt`'s response keys are exactly `["client", "prompt"]`. The pack is the only carrier that crosses both seams; the schema change is the decision.

**D2 — `assertPack` tolerates an ABSENT `role_shape` (present ⇒ must be valid).** Not a courtesy: `spike/pack.json` has no `role_shape` (verified: keys are `candidate_ref, role_title, headline, evidence, process_fit, gaps, open_questions`) and it flows through `test/paste.test.js:164`, `test/seam.test.js` and `test/smoke.test.js`. A strict-required `assertPack` would fail the existing suite. Consumers read `pack.role_shape ?? "unknown"`. This also covers the deploy-window case (a paste from a tab opened before this ships). An absent optional scalar is not invented content — `"unknown"` is the honest reading of "the pack doesn't say" — so `src/paste.js`'s "recover, don't repair" stance is not breached.

**D3 — locum beats permanent when both indicator classes hit.** Locum briefs routinely dangle "possibility of a permanent contract"; a permanent brief that says "locum" is the rarer shape. Pinned by one test (Task 3, case 6); flipping it later is a one-line change plus that test.

## Out of Scope / Non-Goals

- **Not** rendering `role_shape` or any imaging fields in `src/render/*` — the locum booking pack variant is slice 2 (#49). Renderers read explicit fields only (`pack.role_title`, etc. — verified), so a new scalar on the pack is inert there.
- **Not** touching the prep/portal modules (`src/prep/*`, `functions/api/prep/*`) — the portal pivot is slice 3 (#50). It will import `src/domain.js` when it needs the flag; it has the brief directly.
- **Not** adding `brief_profile` to any HTTP response (decision D1; `test/seam.test.js:94` would fail, and vocabulary nothing reads is what the repo's guards exist to stop).
- **Not** touching `spike/schema.js` or `spike/pack.json` — the spike is a frozen historical artifact (the evidence the prompt was validated against); its schema diverging from `PACK_SCHEMA` by the new field is expected and harmless.
- **Not** touching `test/schema.test.js` — that file is the **D1 migration lockfile** (it parses `migrations/*.sql`), not pack-schema tests, and this ticket adds no migration.
- **Not** changing the demo fixtures/seed — slice 0 was done directly on `demo/louis-showcase`.
- **Not** persisting anything new. The profile lives for the life of a request. Guardrail: no candidate data persisted beyond the current schema.
- **Not** mapping scanner *model* names (Aera, Vida, Aquilion…) to makes — makes only. Models can be a follow-up if slice 2 needs a matrix.

## Feature Metadata

**Feature Type**: Enhancement
**Estimated Complexity**: Medium
**Primary Systems Affected**: brief/prompt pipeline (`src/domain.js` new, `src/prompt.js`, `src/pack.js`, `src/generate.js`), tests
**Dependencies**: none new (pure JS, node:test)

## Related Work

**Implements**: [#46](https://github.com/linardsb/saulera-dossier-engine/issues/46) · **Epic**: [#45](https://github.com/linardsb/saulera-dossier-engine/issues/45) + `docs/epics/imaging-locum-fit.md` (Constraints inherited: perm flow stays working; no new persistence; same stack)

**Back-references**:

- `.claude/plans/generation-seam-and-one-screen.md` — Why: owns the `/api/prompt` + `/api/verify` seam shape this plugs into
- `.claude/plans/in-ui-generation.md` — Why: the restored `/api/generate` boundary and its "identical response" rule

**Forward-references** (branch on this work):

- #48 client-knowledge locum fields · #49 locum booking pack (branches on `pack.role_shape`) · #50 portal pivot (imports `src/domain.js`)

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `src/prompt.js` (whole file, 137 ln) — Why: the two prompt shapes built from shared blocks; `domainBlock` must join that pattern. The cache breakpoint note at lines 59-63 is the constraint that decides *where* the block goes (see NOTES).
- `src/pack.js` (lines 8-117) — Why: `PACK_SCHEMA` style (`additionalProperties: false`, everything `required`, load-bearing `description` fields), `assertPack` strictness, `SOURCE_TYPES` as the enum precedent to mirror for `ROLE_SHAPES`.
- `src/generate.js` (lines 62-141) — Why: `generatePack` result shape you're adding `brief_profile` to; the stateless-with-respect-to-candidates rule (lines 14-16) applies to the profile too.
- `src/note-fields.js` (lines 1-30, 91-100) — Why: the house pattern for a pure, dependency-free text parser with documented known-and-accepted edge cases. `src/domain.js` should read like it.
- `test/prompt.test.js` (whole file) — Why: the **regression pin** (lines 49-75) that must keep passing UNCHANGED for the nursing `INPUTS` — that is the executable form of the epic's "perm flow stays working" constraint. Also the house test idiom (inline INPUTS, `codeOf`, property-not-prose assertions).
- `test/generate.test.js` (lines 1-120) — Why: the fake-client pattern for asserting the built request; note the canned `PACK` has **no** `role_shape` — it must keep passing (decision D2). No exhaustive `deepEqual` pins the whole result object (verified — only `provenance` at line 197), so adding `brief_profile` breaks nothing.
- `test/paste.test.js` (lines 160-180) — Why: where `assertPack` is exercised against `spike/pack.json`; the new `role_shape` validity tests live HERE (there is no pack-schema test file — `test/schema.test.js` is the migrations lockfile).
- `functions/api/prompt.js`, `functions/api/generate.js`, `functions/api/verify.js` — Why: read-only mirror check. **No changes** — `buildPastePrompt` and `generatePack` compute the profile internally, so the adapters stay untouched (smaller diff than the ticket's estimate; `test/seam.test.js:94` enforces it).
- `docs/handover-louis-meeting.md` (lines 55-68) — Why: the Priya Nair / Marcus Adeyemi personas the acceptance criterion names; lift test-fixture brief/CV text from their vocabulary (HCPC, Siemens Aera/Vida, GE MRI, Canon CT, CASE-accredited, MSK/general lists, IV cannulation).

### New Files to Create

- `src/domain.js` — deterministic imaging-locum taxonomy parser (pure, importable everywhere)
- `test/domain.test.js` — unit tests for the parser

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- Epic `docs/epics/imaging-locum-fit.md` — Intent + Constraints sections (inherited, not re-decided)
- String `enum` in `PACK_SCHEMA` is safe for structured outputs — proven in-repo by `source_type` (`src/pack.js:26`); the rejected shapes are recursive schemas and numeric/length constraints (`src/pack.js:5-6`). No external reading required.

### Patterns to Follow

**Pure-module discipline** (`src/note-fields.js:13-16`): no imports beyond what's needed (`domain.js` needs zero), testable in `node --test`, documented known-and-accepted false positives instead of cleverness.

**Enum precedent** (`src/pack.js:8`): `export const SOURCE_TYPES = [...]` → mirror as `export const ROLE_SHAPES = ["locum", "permanent", "unknown"]`.

**Block-function prompt assembly** (`src/prompt.js:49-57`): exported const arrow functions returning strings; both prompt shapes assemble from the same blocks so they cannot drift — `domainBlock` must be used by BOTH `buildMessages` and `buildPastePrompt`.

**Error/message hygiene**: nothing in this ticket throws new errors except the `assertPack` enum check, whose message names the field and the bad VALUE of `role_shape` only (mirroring `src/pack.js:112`) — never brief or CV text (stateless rule, `src/generate.js:14-16`).

**Comment register**: comments explain constraints and failure directions, not what the next line does. Match it.

---

## IMPLEMENTATION PLAN

### Phase 0: Branch

The shared-worktree hazard, handled first (Task 1).

### Phase 1: The parser (`src/domain.js`)

Foundation — everything else consumes the profile.

### Phase 2: Schema (`src/pack.js`)

**Independent of:** Phase 1 except the one-line `ROLE_SHAPES` import — run in order.

### Phase 3: Prompts (`src/prompt.js`) and generation (`src/generate.js`)

**Depends on:** Phases 1 & 2.

### Phase 4: Tests & validation

Written alongside each phase (house style is test-per-module); listed as tasks under each file below.

---

## STEP-BY-STEP TASKS

### Task 1 — CREATE branch `feat/imaging-domain-vocabulary` off `main`

- **IMPLEMENT**: the worktree currently sits on `demo/louis-showcase` and is **shared between parallel sessions** (HEAD can move under you). Branch off up-to-date `main`, and re-verify the branch before every commit.
- **VALIDATE**: `git fetch origin && git switch -c feat/imaging-domain-vocabulary origin/main && git branch --show-current` → prints `feat/imaging-domain-vocabulary`
- **SATISFIES**: epic constraint "perm flow stays working" (demo branch stays demo); PR hygiene

### Task 2 — CREATE `src/domain.js`

- **IMPLEMENT**: `export const ROLE_SHAPES = ["locum", "permanent", "unknown"];` (single source of truth — `pack.js` imports it) and one exported function:

  ```js
  /** @returns {{ imaging: boolean, role_shape: "locum"|"permanent"|"unknown",
   *              modalities: string[], specialisms: string[], scanner_makes: string[] }} */
  export function briefProfile(brief, cv = "")
  ```

  Never throws; `String(x ?? "")` both inputs (same stance as `parseNoteFields`, `src/note-fields.js:124-126`). Modality/specialism/role-shape scan the **brief only**; scanner makes scan **brief + CV**. The exact detection rules — transcribe these, don't redesign them:

  ```js
  // Modalities (brief only). CT is case-sensitive: lowercase "ct" is not an English word,
  // and case-insensitive \bct\b would still be safe — uppercase-only just documents intent.
  const MODALITIES = [
    ["mri",        /\bMRI\b|magnetic resonance/i],
    ["ct",         /\bCT\b/],
    ["ct",         /computed tomography/i],
    ["ultrasound", /ultrasound|ultrasonograph|sonograph/i],
    // "US" as an abbreviation, case-sensitive. Known and accepted: "US" the country matches
    // too; these are UK-domestic clinical briefs, so it is documented rather than solved.
    ["ultrasound", /\bU\/?S\b/],
  ];

  // Specialisms (brief only). "general" is guarded to an imaging noun within the same
  // clause, because "East Grinstead General Hospital" must NOT read as a specialism.
  const SPECIALISMS = [
    ["msk",       /\bMSK\b|musculoskeletal/i],
    ["obstetric", /obstetric|antenatal|f(?:o)?etal (?:anomaly|medicine|scan)/i],
    ["general",   /\bgeneral\b[^.\n]{0,40}(?:sonograph|ultrasound|abdominal|scan|list)/i],
    ["general",   /(?:sonograph\w*|ultrasound|abdominal)[^.\n]{0,40}\bgeneral\b/i],
    ["general",   /\bgeneral\b\s*(?:&|and)\s*msk/i],
  ];

  // Scanner makes (brief + CV), lowercase slugs. GE is case-sensitive: "ge" is a syllable
  // in half the dictionary.
  const SCANNER_MAKES = [
    ["siemens",  /\bsiemens\b/i],   ["philips", /\bphilips\b/i],
    ["canon",    /\bcanon\b/i],     ["toshiba", /\btoshiba\b/i],
    ["hitachi",  /\bhitachi\b/i],   ["fujifilm", /fujifilm|\bfuji\b/i],
    ["esaote",   /\besaote\b/i],    ["samsung", /\bsamsung\b/i],
    ["mindray",  /\bmindray\b/i],   ["ge",      /\bGE\b/],
  ];

  // Role shape (brief only). Locum wins when both classes hit — locum briefs routinely
  // dangle "possibility of a permanent contract" (decision D3).
  const LOCUM = [
    /\blocums?\b/i, /\bIR35\b/, /\bday rate\b/i,
    /£\s?\d+[^.\n]{0,15}per (?:day|hour)/i, /\btemp(?:orary)? cover\b/i,
  ];
  const PERMANENT = [
    /\bpermanent\b/i, /\bperm\b/i, /\bsubstantive\b/i,
    /per annum|\bp\.a\.\b|annual salary/i,
  ];

  // imaging: any modality or specialism hit, or an imaging-department term in the brief.
  const IMAGING_CONTEXT = /radiograph|sonograph|imaging department|\bPACS\b|\bRIS\b/i;
  ```

  Assembly: dedupe hits into ordered arrays (`[...new Set(...)]` keyed by slug, in list order); `role_shape` = locum if any `LOCUM` hits, else permanent if any `PERMANENT` hits, else `"unknown"`; `imaging` = `modalities.length > 0 || specialisms.length > 0 || IMAGING_CONTEXT.test(brief)`.
- **PATTERN**: `src/note-fields.js:27-54` (named regex consts with a comment each, known-and-accepted cases documented)
- **IMPORTS**: none — the module must stay dependency-free so `src/prep/*` (slice 3) and Functions can both import it
- **GOTCHA**: export `briefProfile` and `ROLE_SHAPES` only — no per-category regex exports, so downstream slices branch on the profile rather than re-running fragments
- **VALIDATE**: `node --check src/domain.js && node --test test/domain.test.js`
- **SATISFIES**: AC "a locum imaging brief parses with modality, specialism, and role-shape populated"

### Task 3 — CREATE `test/domain.test.js`

- **IMPLEMENT**: pin the personas and the guard rails. Minimum cases: (1) a Priya-style brief ("Locum MRI/CT Radiographer… Siemens Aera and Vida, GE MRI, Canon CT… HCPC… day rate") → `imaging: true`, `role_shape: "locum"`, modalities `["mri","ct"]`, scanner makes include `siemens`, `ge`, `canon`; (2) a Marcus-style brief ("Locum General & MSK Sonographer… general abdominal lists…") → ultrasound + `msk` + `general`; (3) the existing nursing brief from `test/prompt.test.js:32` ("Band 6 community nurse. Must hold a current NMC pin.") → `imaging: false`, `role_shape: "unknown"`, all arrays empty; (4) "East Grinstead General Hospital, permanent Band 7 MRI radiographer, salary per annum" → `general` NOT in specialisms, `role_shape: "permanent"`; (5) scanner makes found in the CV when absent from the brief; (6) locum beats permanent when both appear (pins D3); (7) null/empty/undefined inputs → the unknown/empty profile, no throw; (8) `"ge west"` lowercase and `"the surgeon"` do NOT hit `ge`/ultrasound (case-sensitivity pins).
- **PATTERN**: `test/prompt.test.js` (inline fixture strings, one property per test)
- **VALIDATE**: `node --test test/domain.test.js`
- **SATISFIES**: AC persona parse + AC "existing perm-nursing briefs still parse"

### Task 4 — UPDATE `src/pack.js`

- **IMPLEMENT**: `import { ROLE_SHAPES } from "./domain.js";` and re-export it (`export { ROLE_SHAPES };` — slice-2 render code will want it from the pack contract). Add to `PACK_SCHEMA.properties`:

  ```js
  role_shape: {
    type: "string",
    enum: ROLE_SHAPES,
    description:
      "'locum' if the brief is temporary/agency cover, 'permanent' for a substantive post, " +
      "'unknown' only if the brief genuinely does not say. Read it from the brief.",
  },
  ```

  and add `"role_shape"` to `required` (house style: every property required — `src/pack.js:75-84`; the model therefore always emits it). In `assertPack`, add — **tolerant on absence, strict on presence** (decision D2):

  ```js
  if (pack.role_shape !== undefined && !ROLE_SHAPES.includes(pack.role_shape)) {
    throw new Error(`pack: role_shape is ${pack.role_shape}`);
  }
  ```

- **PATTERN**: `SOURCE_TYPES` at `src/pack.js:8` and its enum usage at line 26; message style at line 112
- **GOTCHA**: a scalar enum is ALL slice 1 ships — do NOT add modalities/scanners to the pack (they inform the prompt; they are not pack content). Do not touch `spike/schema.js`.
- **VALIDATE**: `node --test test/paste.test.js test/generate.test.js test/smoke.test.js test/seam.test.js` — all green with zero edits to them proves D2 (the spike pack and the canned test PACK both lack `role_shape`)
- **SATISFIES**: AC "role-shape… exposed as a flag the pack/portal seams can branch on"

### Task 5 — UPDATE `test/paste.test.js`

- **IMPLEMENT**: append two tests next to the existing `assertPack` round-trip (line 164): (1) a pack with `role_shape: "locum"` extracts and passes `assertPack` with the field intact; (2) `role_shape: "Locum"` (wrong case, the shape a chat session produces when it improvises) throws with a message matching `/role_shape/`. A comment on the absence-tolerance already proven by the untouched spike-pack test: name the deploy-window case it protects.
- **PATTERN**: `test/paste.test.js:164-180`
- **VALIDATE**: `node --test test/paste.test.js`
- **SATISFIES**: AC flag exposure; perm-flow safety

### Task 6 — UPDATE `src/prompt.js`

- **IMPLEMENT**: `import { briefProfile } from "./domain.js";`. Add the block function — **this text verbatim** (it was drafted against the SYSTEM register and the personas; do not re-draft it during implementation):

  ```js
  /**
   * Imaging-locum guidance, appended to the per-submission block. Empty for every other
   * brief — that emptiness is what keeps the perm-nursing prompt byte-identical to the
   * shape the spike validated, and it is pinned by test/prompt.test.js.
   */
  export const domainBlock = (profile) => {
    if (!profile.imaging) return "";
    const lines = [
      "This brief is for a UK diagnostic imaging role. Domain rules, on top of everything above:",
      "",
      "- Registration is with the HCPC (Health and Care Professions Council). Never write" +
        " about NMC registration or an \"NMC pin\" — that is nursing vocabulary and reads as" +
        " a category error to an imaging manager. Where the CV evidences it, sonographer" +
        " accreditation (e.g. a CASE-accredited postgraduate qualification) is worth surfacing.",
      "- Modality and specialism are the core of the match. Say which modalities (MRI, CT," +
        " ultrasound) and which lists (MSK, obstetric, general) the candidate actually" +
        " covers, with evidence.",
      "- Scanner makes and models are material evidence, not trivia. If the brief names a" +
        " fleet, map the candidate's hands-on experience to it explicitly; scanners on the" +
        " CV that the brief does not name are still worth a line.",
    ];
    if (profile.role_shape === "locum") {
      lines.push(
        "- This is a locum booking, not a permanent hire. The client's question is \"can" +
          " they start and run the list on day one\", not \"should we invest in them\"." +
          " Lead with availability, compliance status (HCPC registration, DBS, occupational" +
          " health, mandatory training), IV cannulation where relevant, and independent" +
          " reporting or solo scanning. Verify experience; do not sell potential.",
      );
    }
    return lines.join("\n");
  };
  ```

  Wire it into **both shapes** so they cannot drift (`src/prompt.js:9-11`): in `buildMessages`, `const domain = domainBlock(briefProfile(brief, cv));` and the SECOND content item's text becomes `[domain, inputsBlock(brief, cv)].filter(Boolean).join("\n\n")`; in `buildPastePrompt`, insert `domainBlock(briefProfile(brief, cv))` between the note block and the inputs block and `.filter(Boolean)` the array before joining. Signatures unchanged; `inputsBlock` itself unchanged.
- **PATTERN**: block functions at `src/prompt.js:49-57`; assembly at 64-81 and 109-116
- **GOTCHA (load-bearing)**: the block goes in the **second** content item / after the note block — NEVER into `SYSTEM` or the note block. System + note is the byte-identical cached prefix (`src/generate.js:80-87`); a brief-dependent string in it would silently kill the cache for every mixed-desk client. Task 7 pins this.
- **VALIDATE**: `node --test test/prompt.test.js`
- **SATISFIES**: AC "generation prompts speak HCPC/imaging vocabulary"; AC "perm briefs generate unchanged"

### Task 7 — UPDATE `test/prompt.test.js`

- **IMPLEMENT**: the existing regression-pin tests for the nursing `INPUTS` stay **character-for-character untouched** — them passing IS the perm-flow acceptance criterion. Add a new section (`// ── the imaging domain block ──`) with an inline `IMAGING_INPUTS` (Priya-style locum MRI/CT brief + CV, HCPC/Siemens/GE/Canon vocabulary). Assert: (1) `buildPastePrompt(IMAGING_INPUTS)` contains "HCPC" and the never-NMC instruction; (2) `buildMessages(IMAGING_INPUTS)` puts the domain text in `content[1]` while `content[0].text` equals `noteBlock(...)` exactly and still carries the `cache_control` breakpoint (the cache-prefix pin); (3) the locum bullet appears for the locum brief and NOT for a permanent imaging brief; (4) `domainBlock(briefProfile(INPUTS.brief, INPUTS.cv))` is `""` for the nursing inputs; (5) both shapes carry the same domain text (extend the existing cannot-drift test's approach).
- **PATTERN**: existing pins at `test/prompt.test.js:49-82`
- **VALIDATE**: `node --test test/prompt.test.js`
- **SATISFIES**: AC prompts + AC perm-unchanged

### Task 8 — UPDATE `src/generate.js`

- **IMPLEMENT**: `import { briefProfile } from "./domain.js";`. After `inputs` is built, `const profile = briefProfile(inputs.brief, inputs.cv);` and add `brief_profile: profile` to the returned object. `buildMessages` computes its own profile internally — do not thread it through (keeping `buildMessages`'s signature stable is worth the duplicate cheap parse).
- **GOTCHA**: the profile derives from candidate text — it must never reach a log line or an error message (stateless rule, `src/generate.js:14-16`). Returning it from the function is fine; no Function adapter serialises it (D1).
- **VALIDATE**: `node --test test/generate.test.js`
- **SATISFIES**: AC "carried through generation"

### Task 9 — UPDATE `test/generate.test.js`

- **IMPLEMENT**: two additions using the existing fake-client: (1) with an imaging locum brief, the built request's `messages[0].content[1].text` contains "HCPC" and `content[0]` is still the bare note block carrying the cache breakpoint; (2) the result carries `brief_profile.role_shape === "locum"` for that brief, and for the existing nursing `INPUTS` the result's `brief_profile.imaging` is `false` while the request text contains no "HCPC". (Safe to add fields to the result: nothing `deepEqual`s the whole result object — verified, only `provenance` at line 197.)
- **PATTERN**: request-shape assertions in `test/generate.test.js` (fake records the request)
- **VALIDATE**: `node --test test/generate.test.js`
- **SATISFIES**: AC carried-through + perm-unchanged

### Task 10 — CHECK (no edit) `functions/api/prompt.js`, `functions/api/generate.js`, `functions/api/verify.js`

- **IMPLEMENT**: read all three after the src changes and confirm nothing needs touching: the adapters call `buildPastePrompt`/`generatePack`, which now do the domain work internally, and neither request nor response shape changes (`test/seam.test.js:94` enforces `/api/prompt`'s). If you find yourself editing these files, stop and re-read Out of Scope.
- **VALIDATE**: `npm test` — the full suite, zero failures
- **SATISFIES**: AC perm-flow + epic constraint "same seams"

---

## TESTING STRATEGY

### Unit Tests

`node --test` per module (house style: one test file per src module, inline fixtures, assert properties not prose). New: `test/domain.test.js`. Extended: `test/prompt.test.js`, `test/paste.test.js`, `test/generate.test.js`.

### Integration Tests

The existing seam/http/smoke tests run **unchanged** — they are the regression net for the untouched adapters, and (via the spike pack having no `role_shape`) the proof of decision D2.

### Edge Cases

All pinned by named tasks above: locum-vs-permanent conflict (D3), "General Hospital" ≠ specialism, `GE`/`US` case-sensitivity, absent `role_shape` in a pasted pack (D2), wrong-case `role_shape` from an improvising chat session, null/empty briefs.

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style

No linter is configured (verified: no eslint/prettier in `package.json`). `node --check src/domain.js src/prompt.js src/pack.js src/generate.js`; match surrounding style by eye.

### Level 2: Unit Tests

```bash
node --test test/domain.test.js test/prompt.test.js test/paste.test.js test/generate.test.js
```

### Level 3: Integration Tests

```bash
npm test          # the whole suite — must be zero failures, with seam/smoke/schema untouched
```

### Level 4: Manual Validation

```bash
node -e '
import("./src/prompt.js").then(({ buildPastePrompt }) => {
  console.log(buildPastePrompt({
    clientName: "East Sussex Imaging",
    clientNote: "## Their process\nInformal call with the modality lead.",
    brief: "Locum MRI/CT Radiographer, Siemens Aera and Vida plus Canon CT. HCPC required. Day rate DOE.",
    cv: "HCPC-registered Diagnostic Radiographer, 8 years. Siemens and GE MRI; Canon CT. IV cannulation certified.",
  }));
});'
```

Eyeball: HCPC/never-NMC guidance present, after the client note, before the schema; locum bullet present. Then the perm-flow diff — run the same with the nursing inputs from `test/prompt.test.js:29-34`, once on this branch and once on `main` (`git stash` or a second worktree), and `diff` the outputs: they must be identical **except** the schema JSON's new `role_shape` property.

Optionally `npm run dev` and paste the Priya persona through the one-screen prompt flow.

---

## ACCEPTANCE CRITERIA

- [ ] AC1 — A Priya-style locum imaging brief yields `briefProfile` with modalities, specialism, scanner makes, and `role_shape: "locum"` populated (issue AC, sentence 1).
- [ ] AC2 — Generation prompts for imaging briefs carry HCPC/imaging vocabulary in both shapes; the locum bullet only for locum role shape (issue AC, sentence 2).
- [ ] AC3 — The nursing regression pins in `test/prompt.test.js` pass without edits; nursing prompt output differs from `main` only by the schema's `role_shape` addition (issue AC, sentence 3 / epic constraint).
- [ ] AC4 — `pack.role_shape` travels through both `/api/generate` and `/api/verify` with unchanged adapters; a pack without it still verifies (D2).
- [ ] AC5 — `npm test` fully green with `test/seam.test.js`, `test/smoke.test.js`, `test/schema.test.js` untouched; no new persistence, no new endpoints, no candidate text in any error message.

---

## COMPLETION CHECKLIST

- [ ] Task 1 branch created off `main`; `git branch --show-current` re-checked before each commit
- [ ] All tasks completed in order, each validation run immediately
- [ ] `npm test` green
- [ ] Manual Level-4 diff for the nursing brief done and clean
- [ ] Regression-pin tests untouched (git diff shows no edits inside `test/prompt.test.js`'s existing tests)
- [ ] PR links `Closes #46`

---

## OPEN QUESTIONS / ASSUMPTIONS

None blocking. The three formerly open calls are closed as decisions D1-D3 in the Solution Statement, each with repo evidence and a pinning test; reversing any of them later is a small, localised change. Remaining assumption: the regex vocabulary lists are a starting taxonomy — extending them (new scanner make, new locum indicator) is a one-line-plus-one-test change and needs no re-architecture.

## NOTES (open canvas)

**Why not put the domain block in SYSTEM?** SYSTEM + client note is the cached prefix on the API path (`src/generate.js:80-87`); a brief-dependent SYSTEM would fork the prefix per submission and cache nothing for mixed desks. The second content item already varies per submission, so the block is free there. On the paste path there is no cache; the block sits between note and inputs purely so the reader meets the lens before the text — same argument the file already makes for note ordering.

**Why deterministic parsing AND a model-set schema field?** Two different jobs. The deterministic profile decides *whether the prompt gets the imaging block* (and gives downstream code a flag with no model in the loop). The schema field is how the flag survives the paste round-trip, where the server only ever sees CV + pasted pack. The prompt's domain block plus the enum description align the model's answer with the deterministic read; they can disagree only when the brief is genuinely ambiguous, and `"unknown"` is in the enum precisely for that.

**Rejected: `brief_profile` in `/api/prompt`'s HTTP response.** `test/seam.test.js:94` pins the response keys, and the repo's standing argument (`functions/api/prompt.js:24-26`) is that vocabulary that exists "just in case" is what the guards exist to stop. Slice 2/3 add it where and if they need it.

**Rejected: scanner model→make mapping table** (Aera/Vida→Siemens etc.). The AC needs makes recognised; the personas name makes explicitly. A model table is slice-2 material if the modality/scanner matrix wants it.

**Ticket size note**: the issue estimated ~500-800 lines across five files incl. tests; this plan lands nearer the low end and touches only four src files (the two Function adapters intentionally unmodified). Task 10 exists so that discrepancy is verified rather than assumed.

**File-name trap for the implementer**: `test/schema.test.js` sounds like pack-schema tests; it is the D1 **migrations** lockfile and must not be touched (this ticket has no migration). Pack-shape assertions live in `test/paste.test.js`.

## AMENDMENTS

- 2026-07-31 — Pre-approval revision: closed the three open risks as decisions D1-D3 with repo evidence (seam key-pin at `test/seam.test.js:94`; `spike/pack.json` lacking `role_shape` proves tolerant absence against the existing suite); pinned the exact `domainBlock` text and the full `src/domain.js` regex spec so implementation is transcription; corrected the pack-shape test location from `test/schema.test.js` (actually the migrations lockfile) to `test/paste.test.js`; added the branch task for the shared worktree. Confidence 9 → 9.5.
