# Feature: candidate-brief generation seam (blocks, competencies, core question bank)

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

## Feature Description

The one `claude-opus-5` call that runs when a recruiter presses **Send to Candidate**, built as a pure,
CLI-exercisable seam with no UI and no database. Inputs: the client brief (the JD), the candidate's CV
text, the candidate-visible slice of the agency's client-knowledge note, and the interview date. Output:
one JSON payload carrying three things —

1. **Prep-brief blocks** in the declarative component contract `{name, props, children}`, over a closed
   vocabulary: `PrimerCard`, `CompetencyMap`, `PanelBrief`, `StoryBankCard`, `LogisticsRail`. A name
   outside that vocabulary is a validation error.
2. **Competencies**, each carrying a `source_quote` copied verbatim out of the brief, checked literally
   against the brief text by the repo's existing provenance mechanism.
3. **The core question bank**, per competency, each question carrying `axis` and `difficulty`.

The call is prompt-cached on the candidate-visible note slice, which is the one input reused across every
candidate for the same client.

This ticket ships the seam and a script that exercises it end to end. The registry that renders the blocks
is #21; the session engine that varies the questions is #23; the D1 tables that store the payload are #17;
the CTA that fires the call is #22.

## User Story

As a recruiter who has just confirmed an interview date for a candidate I submitted
I want one call to compose a candidate-facing prep brief from the same privileged inputs that powered the pack
So that the candidate gets prep built on what our agency actually knows about this client, not on the public JD

## Problem Statement

The portal's whole differentiator over a B2C prep tool is the privileged client knowledge (architecture §1).
But privileged knowledge reaching a candidate is exactly where this product can hurt someone: a fabricated
"the panel always asks X" is worse than no prep at all, and a block that hands a candidate a finished answer
in their own voice destroys the reason the feature works (SPEC's two non-negotiables). Meanwhile the epic
needs the generated payload to be composable by an agent and renderable by a dumb registry — which means
its shape has to be a *contract*, not prose.

Nothing enforces any of this today. There is no prep prompt, no prep schema, and no way to run the call
without a UI, a database, and a magic link.

## Solution Statement

Mirror the shape that already works for the pack, and enforce the rules structurally rather than by asking
the prompt nicely:

- **`src/prep/schema.js`** — `BRIEF_SCHEMA` for structured outputs (block `name` is a `const` per variant,
  so the decoder cannot mint a name outside the vocabulary) plus `assertBrief()`, a runtime check that
  enforces the same vocabulary independently. `assertBrief` is the enforcement the tests can actually
  reach; the schema is the belt.
- **`src/prep/prompt.js`** — `PREP_SYSTEM` carrying the two non-negotiables and the verbatim-quote rule,
  plus `buildPrepMessages()` with the cache breakpoint on the visible note slice.
- **`src/prep/verify.js`** — competency quotes checked literally against the brief, and note-derived panel
  claims checked against the field keys actually handed in, reusing `quoteAppears` from
  `src/provenance.js`. Demotes and marks a fabricated quote; never throws, never drops.
- **`src/prep/generate.js`** — `generateBrief(client, inputs)`: the call itself, importing `MODEL`,
  `EFFORT` and `FALLBACK_BETA` from `src/generate.js` so there is one definition of each.
- **`scripts/gen-brief.js`** — drives the seam over fixture inputs with a real key, prints the provenance
  summary, and exits non-zero when a quote does not verify.

The safety rules become structure: there is no block variant whose props can carry a finished answer or a
score, and a test walks the schema to prove it — with a coverage guard so an unwalked branch fails rather
than passes silently.

## Out of Scope / Non-Goals

- **Not included: any D1 table, migration, or write.** Architecture §4 lists `candidate_role.brief_json`;
  that is #17's. This ticket's output is a payload returned from a function. A migration here also picks a
  fight with `test/schema.test.js`'s "the schema declares exactly agency, clients and events".
- **Not included: a paste/subscription path.** `src/prompt.js` builds two shapes (API + paste) from shared
  blocks and invites mirroring. Architecture §5 puts the Send call server-side behind the per-agency
  `ANTHROPIC_API_KEY`; the ticket asks for a CLI-exercisable seam. **One shape only.**
- **Not included: lateral/vertical variation or live question generation.** Decision 6 is explicit — this
  call mints the *core* bank; variation is the session engine (#23) on `claude-sonnet-5`.
- **Not included: the per-field visibility toggle itself** (#18). This ticket consumes its already-filtered
  output as a plain object, stubbed in fixtures.
- **Not included: any UI, route, Pages Function, magic link, or email.** No `functions/api/*` file is added.
- **Not included: rendering.** No component registry, no HTML, no text renderer (#21).
- **Not changing:** `src/pack.js`, `src/generate.js` (beyond importing its constants), `src/render/*`,
  `src/store.js`, any existing test, any existing migration. The one exception is a three-line addition to
  `src/provenance.js` (a new export; no existing behaviour changes).

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: Medium–High (the schema shape is the hard part; everything else mirrors an existing file)
**Primary Systems Affected**: `src/prep/` (new), `src/provenance.js` (one new export), `scripts/`, `test/`
**Dependencies**: `@anthropic-ai/sdk` ^0.115.0 (already a dependency). No new packages — `node --test` runs with zero test deps.

## Related Work

**Implements**: [#19](https://github.com/linardsb/saulera-dossier-engine/issues/19) · **Epic**: [#16](https://github.com/linardsb/saulera-dossier-engine/issues/16) — architecture at `docs/epics/candidate-portal.architecture.md` (§3, §5, decisions 1, 6, 8, 15, 22)

**Back-references** (plans this builds on or inherits decisions from):

- `.claude/plans/in-ui-generation.md` — Why: the restored server-side model call this seam mirrors (`src/generate.js`, the single-boundary rule)
- `.claude/plans/generation-seam-and-one-screen.md` — Why: the `/api/prompt` + `/api/verify` seam, deliberately NOT mirrored here (see Non-Goals)
- `.claude/plans/client-knowledge-store.md` — Why: the client note is the cached prefix on both calls
- **`.claude/plans/per-field-candidate-visible-toggle.md` (#18) — Why: it defines `visibleFields()`, this
  ticket's most important input. Its `src/note-fields.js` task is the contract; read it, don't guess it.**
- `.claude/plans/portal-schema-retention-gdpr.md` (#17) — Why: owns `candidate_role.brief_json`, where this
  payload eventually lands. Nothing in this ticket writes it.

**Forward-references** (plans that extend or supersede this):

- (none yet — #21 consumes `BLOCK_NAMES`; #23 consumes the competency + question shape; #17 persists `brief_json`; #22 calls `generateBrief`)

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `src/generate.js` (whole file, 141 lines) - Why: **the file this one mirrors.** `MODEL`, `EFFORT`,
  `FALLBACK_BETA` are imported from here. The `stop_reason` guards (lines 112-118), the parse-then-verify
  order (line 132), and the "verified before it is returned" property are the shape to copy.
- `src/pack.js` (lines 1-6, 32-117) - Why: how a structured-outputs schema is written in this repo. Line
  5-7's comment names the constraints: **recursive schemas rejected, numeric/length constraints rejected,
  every object needs `additionalProperties: false`.** `assertPack` (100-117) is the model for `assertBrief`.
- `src/prompt.js` (lines 16-81, 118-137) - Why: `SYSTEM`'s rule ordering and register; `buildMessages`'
  cache-breakpoint placement (lines 64-81); `cleanInput`/`INPUT_MAX` (118-137) — reuse `cleanInput` for
  brief and CV, do not write a second one.
- `src/provenance.js` (whole file, 87 lines) - Why: `normalise()` (22-30) is the one definition of
  "literal". The comment at 12-20 explains why no fuzzy matching — that reasoning carries to competencies.
- `src/store.js` (lines 26-37) - Why: `StoreError(code, status, message)` is the error vocabulary. Every
  failure this seam raises is a `StoreError`.
- `scripts/pack.mjs` (whole file, 108 lines) - Why: the CLI shape — `arg()` parsing, `process.exit(2)` on
  usage error, the loud provenance/demotion output block (90-106) that `gen-brief.js` mirrors.
- `spike/run.js` (lines 16-46) - Why: the live-call CLI pattern — bare `new Anthropic()` reading
  `ANTHROPIC_API_KEY` from env, `stream()` + `finalMessage()`, `stop_reason` handling.
- `test/generate.test.js` (whole file, 258 lines) - Why: **the test file this one mirrors.**
  `fakeAnthropic()` (63-78) with the `beta.messages.stream` namespace, `ok()` (80-85), `codeOf()` (202-210).
  Copy these helpers; do not import them across test files (the repo keeps them local).
- `test/schema.test.js` (lines 84-112) - Why: **the pattern for a structural guard test.** The two tests
  above the real assertions exist because "a statement the parser cannot read is ABSENT from `byName`, so
  it passes instead of failing it — silence that looks identical to compliance." The schema walker in this
  ticket has the identical failure mode and needs the identical guard.
- `test/prompt.test.js` (lines 1-60) - Why: the regression-pin style — assert properties and exact strings
  of built prompts.
- `docs/epics/candidate-portal.architecture.md` §3 (55-64), §5 (87-95), decisions 1/6/8/15/22 - Why: the
  inherited decisions. §3 is the two enforcement mechanisms; decision 22 is the vocabulary.
- `docs/epics/interview-prep/SPEC.md` — "Inputs" (41-53), "Targeting" (84-95), "Readiness ladder" (98-118),
  "State" (166-180), the two non-negotiables (31-39) - Why: competencies come from the JD *with the quote*;
  the state block is the field vocabulary for `competency` and `question`.
- **`.claude/plans/per-field-candidate-visible-toggle.md` — the `CREATE src/note-fields.js` task** - Why:
  **the producer of this ticket's most important input.** It defines `visibleFields(note, visibleKeys)` and
  the exact field shape `{ key, heading, level, text, chars }`. Read it before writing
  `visibleNoteBlock` — the field names are not the obvious ones and this plan originally guessed them wrong.
- `package.json` - Why: `"test": "node --test test/*.test.js"` — **a single-level glob.** See GOTCHA below.

### New Files to Create

- `src/prep/schema.js` — `BLOCK_NAMES`, `BRIEF_SCHEMA` (structured outputs), `assertBrief()` (runtime enforcement)
- `src/prep/prompt.js` — `PREP_SYSTEM`, `visibleNoteBlock()`, `prepInputsBlock()`, `buildPrepMessages()`
- `src/prep/verify.js` — `verifyBrief()`, `briefSummary()`
- `src/prep/generate.js` — `generateBrief()`, `MAX_TOKENS`
- `scripts/gen-brief.js` — the CLI that drives the seam end to end
- `test/prep-schema.test.js` — vocabulary enforcement + the no-answer/no-score structural guard (with coverage guard)
- `test/prep-prompt.test.js` — prompt properties and cache-breakpoint placement
- `test/prep-verify.test.js` — the literal check, incl. the fabricated-quote case
- `test/prep-generate.test.js` — request shape, breakpoint, verify-before-return, error taxonomy
- `test/collection.test.js` — the guard that every `*.test.js` is actually collected by `npm test`'s glob
- `test/fixtures/prep-brief.md` — fixture JD (the client brief)
- `test/fixtures/prep-cv.md` — fixture CV
- `test/fixtures/prep-visible-fields.json` — the stubbed `visibleFields()` output, in #18's **verified** shape
- `test/fixtures/prep-payload.json` — a valid model payload, used by the schema and verify tests

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [Structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs.md)
  - Specific section: JSON Schema limitations
  - Why: **Recursive schemas are NOT supported.** `anyOf`, `allOf`, `$ref`/`$defs`, `enum`, `const` and
    `additionalProperties: false` ARE. Numeric constraints (`minimum`, `maximum`, `multipleOf`) and string
    constraints (`minLength`, `maxLength`) are NOT. This single fact drives the whole schema design below —
    the block contract is inherently recursive and must be depth-limited by hand.
  - Also: a new schema incurs a one-time compilation cost, then a 24-hour cache. First call is slower.
  - Also: `output_config.format`, never the deprecated top-level `output_format`.
- [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching.md)
  - Specific section: minimum cacheable prefix; verifying cache hits
  - Why: **Claude Opus 5's minimum is 512 tokens** (down from 1024 on Opus 4.8). A thin visible-note slice
    silently does not cache rather than erroring; `usage.cache_read_input_tokens` is the only way to tell.
    Render order is `tools` → `system` → `messages`, so `PREP_SYSTEM` sits inside the cached prefix.
- [Adaptive thinking](https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking.md)
  - Why: thinking is ON BY DEFAULT on `claude-opus-5`, and `max_tokens` caps thinking + response text
    together. `budget_tokens`, `temperature`, `top_p`, `top_k` all return 400.

### Patterns to Follow

**Module comment as the reason, not the summary.** Every `src/*.js` opens with a comment explaining *why
the file exists* and what would go wrong without it, citing the architecture section or decision number.
Match this — e.g. `src/generate.js:1-16`, `src/provenance.js:1-9`. This is the strongest convention in the
repo and a new file without it will read as foreign.

**Error handling — `StoreError`, always:**

```js
import { StoreError } from "../store.js";
if (!inputs.brief.trim()) throw new StoreError("missing_fields", 400, "brief: must not be empty");
```

Codes are lowercase snake_case. Messages **name the field and never carry the value** (`src/prompt.js:126-128`
— candidate text must not reach a log line or an error message).

**Schema style (`src/pack.js`):** plain exported object literals, a small factory for repeated sub-shapes
(`claim()` at `pack.js:10-30`), `description` fields carrying load-bearing instructions, and **every
property listed in `required`** (`pack.js:29`, `pack.js:75-83`). Keep this: no optional properties; absent
values are `""` or `[]`.

**Assertion style (`assertPack`, `pack.js:100-117`):** throw a plain `Error` with a path-shaped message
(`` `brief: blocks[${i}].name is ${name}` ``), not a `StoreError` — it is a shape bug, not an HTTP outcome.
`generateBrief` catches nothing; the caller maps.

**Test style:** `node:test` + `node:assert/strict`, a comment header saying which AC the file defends and
what fails in production if it doesn't, local `fakeAnthropic`/`ok`/`codeOf` helpers, and assertion messages
that explain the consequence rather than restating the assertion.

**Logging:** there is none. No `console.log` in `src/`. Scripts print; modules return.

---

## IMPLEMENTATION PLAN

### Phase 1: The contract

The schema is the load-bearing decision — everything else is shaped by it. Build and test it before any
model call exists.

**Tasks:**

- `src/prep/schema.js`: `BLOCK_NAMES`, the depth-limited `BRIEF_SCHEMA`, `assertBrief()`
- `test/prep-schema.test.js`: vocabulary rejection, the no-answer/no-score walker, and the walker's coverage guard
- `test/fixtures/prep-payload.json`: a valid payload that exercises every block name

### Phase 2: Prompt and provenance

**Depends on:** Phase 1 (the prompt serialises nothing from the schema, but `PREP_SYSTEM`'s rules must
match what the schema permits).
**Independent of:** each other — `src/prep/prompt.js` and `src/prep/verify.js` touch nothing in common and
can be built in parallel.

**Tasks:**

- `src/provenance.js`: add `quoteAppears(quote, source)` (new export; nothing else changes)
- `src/prep/verify.js`: `verifyBrief()`, `briefSummary()`
- `src/prep/prompt.js`: `PREP_SYSTEM` and the three block builders
- Their tests

### Phase 3: The call

**Depends on:** Phases 1 and 2.

**Tasks:**

- `src/prep/generate.js`: `generateBrief()`, `MAX_TOKENS`
- `test/prep-generate.test.js`

### Phase 4: The script and the end-to-end proof

**Depends on:** Phase 3.

**Tasks:**

- `test/fixtures/prep-brief.md`, `prep-cv.md`, `prep-visible-fields.json`
- `scripts/gen-brief.js`
- `"gen:brief"` in `package.json`
- README/DEPLOY note if the runbook needs the new script listed

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

### CREATE `src/prep/schema.js`

- **IMPLEMENT**: The block contract, depth-limited by hand, plus runtime enforcement.

  ```js
  export const BLOCK_NAMES = [
    "PrimerCard", "CompetencyMap", "PanelBrief", "StoryBankCard", "LogisticsRail",
  ];
  ```

  **Shape decision (read this before writing the schema).** `{name, props, children}` is recursive and
  structured outputs reject recursive schemas. Depth-limit it by deciding per block name which one nests:

  - `CompetencyMap` is the **only** block with `children`, and its children are `StoryBankCard` leaves —
    the SPEC's "a small set of real stories, each mapped to several competencies" (SPEC.md:158-163).
  - `PrimerCard`, `PanelBrief`, `StoryBankCard`, `LogisticsRail` are **leaves**: `{name, props}`, no
    `children` key at all. The registry (#21) reads `block.children ?? []`.

  This gives a **5-way `anyOf` at the top level and a single `$ref` at depth 2** — no `anyOf` nesting, no
  cycle, and much less schema-compilation risk than a uniform two-deep union.

  ```js
  const block = (name, props) => ({
    type: "object", additionalProperties: false,
    properties: { name: { type: "string", const: name }, props },
    required: ["name", "props"],
  });
  ```

  Per-block `props` (all properties in `required`; strings, string arrays, and `enum`s only):

  | Block | props |
  |---|---|
  | `PrimerCard` | `role_shape`, `register`, `what_stage_one_tests` (strings) |
  | `CompetencyMap` | `intro`, `competency_ids` (array of string) — plus `children` |
  | `PanelBrief` | `intro`, `panel` (array of `{who, what_they_probe, source_field_key}`) |
  | `StoryBankCard` | `prompt`, `covers_competency_ids` (array of string), `skeleton` (array of string) |
  | `LogisticsRail` | `when`, `format`, `bring`, `note` (strings) |

  **`StoryBankCard.skeleton` is the one prop a careless reader will turn into a finished answer.** Its
  `description` must say so verbatim: a skeleton is *headings the candidate fills in*, never sentences in
  the candidate's voice. This is SPEC's first non-negotiable, and the guard test below defends it.
  (Verified live — see NOTES → "What the probe settled". The description alone produced headings, not
  sentences, on the first attempt. Do not weaken its wording.)

  **`PanelBrief.panel[].source_field_key` is a `key` from `visibleFields()`, not free text.** #18 gives
  every visible field a stable slug (`their-process`, `what-they-actually-care-about`), so a note-derived
  claim can name the field it came from and `verifyBrief` can check that the key was actually in the input.
  That is the provenance mechanism of architecture §3 applied to the note half — the competency quotes
  cover the JD half. Do **not** make this a free-text string; it is checkable and should be checked.

  **Scope reading, stated so #21 does not have to guess.** `PanelBrief` is the *only* block whose props
  carry a source key. That is the narrow reading of §3, which names exactly two surfaces — "the prep brief
  and PanelBrief render only client-note fields flagged candidate-visible" — and it is the reading this
  ticket takes. The cost is real: `PrimerCard.what_stage_one_tests` and `StoryBankCard.prompt` can also be
  note-derived, and their sourcing is unchecked. The containment is that **everything the model saw was
  already filtered** — an unsourceable claim in those props is an accuracy problem, not a leak, because
  nothing candidate-invisible was ever in the context. If a later ticket wants traceability on all five,
  adding `source_field_key` to the other variants is additive and `verifyBrief` already has the loop.

  Top level:

  ```js
  export const BRIEF_SCHEMA = {
    type: "object", additionalProperties: false,
    $defs: { StoryBankCard: block("StoryBankCard", {...}) },
    properties: {
      role_title: { type: "string" },
      blocks: { type: "array", items: { anyOf: [ /* the five variants */ ] } },
      competencies: { type: "array", items: competency },
      questions: { type: "array", items: question },
    },
    required: ["role_title", "blocks", "competencies", "questions"],
  };
  ```

  `competency`: `{ id, label, source_quote, importance }` — `importance` is
  `{ type: "integer", enum: [1,2,3,4,5] }` (**`enum`, not `minimum`/`maximum` — numeric constraints are
  rejected**). `source_quote`'s `description` is the verbatim-quote rule, copied in spirit from
  `pack.js:20-24`, pointing at the **brief** as the only source. No `source_type` field: there is exactly
  one haystack here.

  `question`: `{ competency_id, text, axis, difficulty }` —
  `axis: { enum: ["core", "lateral", "vertical"] }` (SPEC's vocabulary, kept whole so #23 writes into the
  same column) and `difficulty: { enum: ["gentle", "standard", "probing"] }`.

  `assertBrief(payload)` — **this is the enforcement the acceptance criteria actually reach.** There is no
  JSON Schema validator in this repo and none is being added, so `BRIEF_SCHEMA`'s `const`/`enum` are
  enforced by the decoder at runtime and no test can exercise them. `assertBrief` must therefore enforce
  the vocabulary *independently*, not just the shape — exactly the reasoning at `prompt.js:83-90` for why
  `assertPack` exists alongside structured outputs. It must reject:
  - a block `name` not in `BLOCK_NAMES` (top level **and** inside `children`)
  - `children` on any block other than `CompetencyMap`
  - a competency with an empty or missing `source_quote`
  - a question whose `competency_id` matches no competency
  - **any dangling competency reference anywhere** — `CompetencyMap.props.competency_ids` and
    `StoryBankCard.props.covers_competency_ids` must both resolve. A dangling id renders as a hole in #21's
    registry and there is nothing downstream to catch it.
  - **a competency with zero questions.** The ticket says the core bank is minted *per competency*; a
    payload where one competency gets no questions passes a shape check, passes the script's sendable gate,
    and hands #23 a competency it cannot drill.
  - a question whose `axis !== "core"` (this call mints the core bank only — decision 6)
  - a `difficulty` outside the enum
  **`source_field_key` is deliberately NOT checked here** — it is a provenance failure, not a shape bug,
  and provenance failures **demote, they never throw** (`provenance.js:62` — "Demote, don't drop"). A model
  that writes `their-processes` for `their-process` must not kill the whole Send. The check lives in
  `src/prep/verify.js`; see that task.

- **IMPORTS**: none (pure module, same as `src/pack.js`)
- **GOTCHA**: `additionalProperties: false` on **every** object including each `props` and each nested
  panel/skeleton item — the API rejects the schema otherwise. Do not use `minItems`, `maxItems`,
  `minLength`, `pattern`, or `multipleOf` anywhere. Do not write a `$ref` that resolves back to an ancestor.
- **VALIDATE**: `node -e "import('./src/prep/schema.js').then(m=>{JSON.stringify(m.BRIEF_SCHEMA);console.log(m.BLOCK_NAMES.join(','))})"`
- **SATISFIES**: AC #1 (unknown block names rejected), AC #4 (no block carries an answer or a score)

### CREATE `test/fixtures/prep-payload.json`

- **IMPLEMENT**: A valid payload exercising all five block names, a `CompetencyMap` with two
  `StoryBankCard` children, 3 competencies, and 6 questions. Two of the three competency quotes must be
  literal spans of `test/fixtures/prep-brief.md`; **the third must be a paraphrase** — the fabricated-
  citation case the verifier exists for, mirroring `test/generate.test.js:44-48`.
- **PATTERN**: `test/fixtures/pack-sourced.json`, `test/generate.test.js:31-61`
- **GOTCHA**: Write this fixture *and* `prep-brief.md` together — the literal quotes must actually appear
  in the brief, character for character, or every verify test is testing the wrong thing.
- **VALIDATE**: `node -e "JSON.parse(require('fs').readFileSync('test/fixtures/prep-payload.json'))" && echo ok`
- **SATISFIES**: AC #1, AC #2

### CREATE `test/prep-schema.test.js`

- **IMPLEMENT**: Three groups.

  1. **`assertBrief` accepts the fixture and rejects the vocabulary breaches** — one assertion per bullet
     in the `assertBrief` list above. Use the repo's `codeOf`-style helper (`test/generate.test.js:202-210`),
     adapted for plain `Error` messages.

  2. **The structural guard**: walk `BRIEF_SCHEMA` and assert no property name anywhere matches
     `/answer|score|rank|rating|grade|level|readiness|success_rate/i`. Failure message must explain the
     consequence: architecture §3 — "there *is no* component that renders a finished answer in the
     candidate's voice, and no component that renders a score or rank. The locked rules stop being prompt
     instructions and become structural."
     - **`importance` is deliberately NOT in that pattern** — it is importance *of the competency to the
       role*, not a score of the candidate, and it lives on `competencies`, not on a block. Say so in a
       comment so nobody widens the regex and breaks the build.

  3. **The coverage guard — do not skip this.** A recursive walker that misses `$defs`, an `anyOf` branch,
     or `items` makes group 2 pass silently when a `score` prop is added in the unwalked branch. That is
     the exact failure mode `test/schema.test.js:84-112` exists to prevent. Assert:
     - the set of block names the walker visited `deepEqual`s `BLOCK_NAMES` (sorted), and
     - every key of `BRIEF_SCHEMA.$defs` was visited.

     With a message in the register of `schema.test.js:94-98`: a branch the walker could not read is
     invisible to the assertion above, not a failure of it.

- **IMPORTS**: `node:test`, `node:assert/strict`, `node:fs`, `../src/prep/schema.js`
- **GOTCHA**: **`npm test` is `node --test test/*.test.js` — a single-level glob.** A file at
  `test/prep/schema.test.js` will never run and the suite will still pass green. All new tests go directly
  in `test/`. Also: `test/schema.test.js` is already taken (it guards the migrations boundary) — this file
  is `test/prep-schema.test.js`.
- **VALIDATE**: `node --test test/prep-schema.test.js`
- **SATISFIES**: AC #1, AC #4

### CREATE `test/collection.test.js`

- **IMPLEMENT**: The permanent fix for this plan's sharpest trap. `npm test` is
  `node --test test/*.test.js` — a **single-level glob** — so a test file in a subdirectory never runs and
  the suite still reports green. Walk `test/` recursively and assert every `*.test.js` sits directly in
  `test/`, with a failure message that says what silently happened and how to fix it (move the file up, or
  change the glob deliberately and say why in the PR).

  Same species as `test/schema.test.js`'s two guard tests: it defends the *instrument*, not the code, and
  it exists because the failure mode is silence rather than a red test.

- **IMPORTS**: `node:test`, `node:assert/strict`, `node:fs`, `node:path`, `node:url`
- **GOTCHA**: Skip `test/fixtures/` and `test/helpers/` by extension, not by name — the rule is about
  `*.test.js` specifically, and a future `test/helpers/foo.test.js` should fail.
- **VALIDATE**:
  ```bash
  node --test test/collection.test.js          # passes on a clean tree

  # Prove the guard bites: plant a decoy in a subdirectory, expect a FAILING run.
  mkdir -p test/tmp && cp test/collection.test.js test/tmp/decoy.test.js
  if node --test test/collection.test.js >/dev/null 2>&1; then
    echo "BUG: the guard did not fire on a subdirectory test file"
  else
    echo "guard fires correctly"
  fi
  rm -rf test/tmp
  ```
- **SATISFIES**: every AC — this is what makes the other test files count.

### UPDATE `src/provenance.js`

- **IMPLEMENT**: One new export, three lines, below `normalise`:

  ```js
  /** Does `quote` appear literally in `source`? The one definition of "literal", shared with src/prep. */
  export function quoteAppears(quote, source) {
    const needle = normalise(quote);
    return Boolean(needle) && normalise(source).includes(needle);
  }
  ```

- **GOTCHA**: **Do not refactor `verifyPack` to call it.** `test/provenance.test.js` pins that function's
  behaviour as a regression guard and this ticket has no business editing it. Add the export, use it from
  `src/prep`, stop. (A follow-up may collapse the duplication; it is not this ticket's call.)
- **VALIDATE**: `node --test test/provenance.test.js` — must still pass unchanged
- **SATISFIES**: AC #2

### CREATE `src/prep/verify.js`

- **IMPLEMENT**:

  ```js
  export function verifyBrief(payload, { brief, fieldKeys }) // -> { payload, failures }
  export function briefSummary(payload)                      // -> { sourced, unverified, total }
  ```

  Same contract as `verifyPack`: **demote, never drop.** Two checks, both demoting:

  1. **Competency quotes** against the brief. A quote not found literally comes back with
     `verified: false` and `failed_quote` preserving what it thought it was citing
     (`provenance.js:62-69`), plus a `failures[]` entry `{ kind: "competency", index, label, quote, reason }`
     where reason is `"quote not found in the brief"` or `"empty quote"`.
  2. **`PanelBrief.panel[].source_field_key`** against the `key`s actually handed in. An unrecognised key
     is blanked to `""` with `failed_field_key` preserved, and a `failures[]` entry
     `{ kind: "panel_source", block_index, panel_index, key, reason: "field key not in the visible slice" }`.

  **Why this is a demotion and not a throw.** It is the same class of defect as a paraphrased quote — the
  model citing something it cannot stand up — and the repo's answer to that class is uniform: mark it, keep
  it, show the recruiter. A hard throw here would make one hallucinated slug kill a Send the recruiter is
  standing in front of. `assertBrief` handles shape; this handles sourcing; nothing blurs the two.

- **IMPORTS**: `import { quoteAppears } from "../provenance.js";`
- **GOTCHA**: **One haystack only.** `verifyPack` dispatches on `source_type` into `{cv, client_note}`;
  competencies come from the JD and only the JD (SPEC.md:45 — "Extract competencies from it; do not invent
  them"). Do not grow a discriminator this ticket does not need. In particular the CV is *not* a valid
  source for a competency quote — a competency sourced from the candidate's own CV is a category error.
- **VALIDATE**: `node --test test/prep-verify.test.js`
- **SATISFIES**: AC #2

### CREATE `test/prep-verify.test.js`

- **IMPLEMENT**: Over `prep-payload.json` + `prep-brief.md`: the two literal quotes survive with
  `verified: true`; **the paraphrased one is demoted, marked, and still present**; `failures.length === 1`
  with the right reason; an empty quote is its own reason; `briefSummary` counts correctly. Add a
  whitespace/curly-quote case proving `normalise`'s latitude carries (per `provenance.test.js`).
- **PATTERN**: `test/provenance.test.js`, `test/generate.test.js:179-198`
- **VALIDATE**: `node --test test/prep-verify.test.js`
- **SATISFIES**: AC #2

### CREATE `src/prep/prompt.js`

- **IMPLEMENT**: `PREP_SYSTEM` plus three builders, factored the way `src/prompt.js` factors its blocks.

  `PREP_SYSTEM`, rules in order of importance:
  1. **Never write the candidate's answer in their voice.** A skeleton, a worked example from a *different*
     scenario, or a question that unsticks them — never their finished answer. (SPEC.md:33-36.)
  2. **Never coach fabrication.** Help them evidence genuine overlap; name a genuine mismatch plainly.
     (SPEC.md:37-39.)
  3. **Competencies come from the brief, each with a VERBATIM span copied out of it.** A deterministic
     check runs after you and marks a paraphrase as unverified. (Mirror `prompt.js:24-32`'s register.)
  4. **Never score, rank, or rate the candidate, and never predict whether they will get the job.**
     (SPEC.md:188, DECISIONS.md:59.)
  5. Address the candidate as someone preparing, never as someone being evaluated. (SPEC.md:183-187.)
  6. Only what the recruiter marked candidate-visible reaches the candidate — everything you were given is
     already filtered; do not speculate beyond it. If the note does not say, say it does not say.
     (SPEC.md:51-53, decision 2.)

  `visibleNoteBlock(clientName, visibleFields)` — the cached prefix. **`visibleFields` is #18's
  `visibleFields(note, visibleKeys)` return value: `Array<{ key, heading, level, text, chars }>`** — not
  `{label, body}`. Render each as a labelled section inside `<client_knowledge>`, carrying the `key` so the
  model can cite it in `source_field_key`:

  ```
  <field key="their-process" heading="Their process">
  Two stages. First a 30-minute conversation with…
  </field>
  ```

  Deterministic ordering — iterate the array exactly as given; do not sort, dedupe, or re-key. #18 returns
  fields in note order, which is stable across saves; anything derived would make the cached prefix unstable
  and it would silently never cache.

  `prepInputsBlock({ brief, cv, interviewAt })` — the per-candidate half, closing with the instruction to
  compose the brief.

  `buildPrepMessages({ clientName, visibleFields, brief, cv, interviewAt })` — one user message, two text
  blocks, `cache_control: { type: "ephemeral" }` on the **first**. Mirror `prompt.js:64-81` exactly.

- **IMPORTS**: none beyond what the builders need. **Do not import `PACK_SCHEMA` or `OUTPUT_INSTRUCTION`** —
  the schema travels as `output_config.format`, not as text. There is no paste path here (see Non-Goals).
- **GOTCHA**: `cleanInput` and `INPUT_MAX` already exist at `src/prompt.js:121-137` — **import them, do not
  write a second guard.** Importing from `../prompt.js` into `src/prep/` is fine; that module is pure.
- **VALIDATE**: `node --test test/prep-prompt.test.js`
- **SATISFIES**: AC #4 (the prompt half of the two non-negotiables), AC #3

### CREATE `test/prep-prompt.test.js`

- **IMPLEMENT**: The non-negotiables are present in `PREP_SYSTEM` (assert on the *properties* — a regex for
  the never-writes-their-answer rule and the no-score rule — not on the whole prose, so wording can be
  tuned without a false failure). `buildPrepMessages` puts exactly one `cache_control`, on block 0, and
  block 0 contains the visible note but **not** the brief, the CV, or the interview date. Empty
  `visibleFields` produces a well-formed block (see the assumption below — an empty visible slice is legal).
- **PATTERN**: `test/prompt.test.js:47-60`, `test/generate.test.js:152-168`
- **VALIDATE**: `node --test test/prep-prompt.test.js`
- **SATISFIES**: AC #3

### CREATE `src/prep/generate.js`

- **IMPLEMENT**:

  ```js
  import { MODEL, EFFORT, FALLBACK_BETA } from "../generate.js";
  import { BRIEF_SCHEMA, assertBrief } from "./schema.js";
  import { buildPrepMessages, PREP_SYSTEM } from "./prompt.js";
  import { cleanInput } from "../prompt.js";
  import { verifyBrief, briefSummary } from "./verify.js";
  import { StoreError } from "../store.js";

  export const MAX_TOKENS = 48_000;

  export async function generateBrief(client, { clientName, visibleFields, brief, cv, interviewAt } = {})
  ```

  Body, in order: clean inputs → guard → `client.beta.messages.stream({...})` → `finalMessage()` →
  `stop_reason` guards → parse → `verifyBrief(assertBrief(parsed), { brief, fieldKeys })` (where
  `fieldKeys = visibleFields.map((f) => f.key)`) → return
  `{ payload, failures, provenance, duration_ms, usage }`.

  Request parameters, identical in kind to `src/generate.js:88-104`: `model: MODEL`, `max_tokens: MAX_TOKENS`,
  `system: PREP_SYSTEM`, `thinking: { type: "adaptive" }`, `output_config: { effort: EFFORT, format: { type: "json_schema", schema: BRIEF_SCHEMA } }`,
  `betas: [FALLBACK_BETA]`, `fallbacks: "default"`, `messages: buildPrepMessages(inputs)`.

  Error taxonomy, mirroring `generate.js:112-127`: `model_refused` (502), `truncated` (502), `no_brief`
  (502) for both "no text block" and "not valid JSON".

- **IMPORTS**: as above. `@anthropic-ai/sdk` is **not** imported — the client is passed in, so the test can
  hand in a fake (`generate.js:59-61`).
- **GOTCHA**:
  - **`MAX_TOKENS` is sized fresh here, not inherited, and the number is measured.** The pack is "a couple
    of thousand tokens" (`generate.js:28-30`); this payload is blocks + 5–6 competencies with quotes + a
    question bank per competency, and on Opus 5 thinking shares the same cap. A truncation here is a dead
    Send button in front of a recruiter. **Live probe (28 Jul 2026): 1,641 output tokens** for 5 blocks,
    3 competencies and 9 questions at `effort: "low"` over a three-line brief and no CV. A real brief plus
    a CV at `effort: "high"` is several times that, and adaptive thinking is on top. 48k gives roughly an
    order of magnitude of headroom. Assert a floor of 32k in the test; **lower `EFFORT` before lowering
    this**, and after the first Level 4 run record the observed `output_tokens` in AMENDMENTS. If observed
    output ever exceeds ~30% of `MAX_TOKENS`, raise the cap before shipping rather than after a truncation.
  - **An empty visible slice is NOT a refusal.** `generatePack` throws `note_empty` because "the note IS
    the product", but decision 2 makes per-field visibility the recruiter's control — a recruiter who
    shares nothing has made a legitimate choice, and the brief still generates from the JD and the CV.
    Refuse on an empty brief or CV (via `cleanInput`); never on an empty visible slice.
  - `client.beta.messages.stream`, not `client.messages.stream` — the refusal fallback rides the beta
    endpoint (`test/generate.test.js:64-67`).
  - Do not set `temperature`, `top_p`, `top_k`, or `thinking.budget_tokens` — all four are 400s on Opus 5.
  - **`FALLBACK_BETA` and `fallbacks: "default"` are a matched pair.** `src/generate.js:54` pins
    `server-side-fallback-2026-07-01`, which is the header for the **scalar** `"default"` form. Pairing that
    header with the array form (`fallbacks: [{ model: … }]`), or the older `-2026-06-01` header with
    `"default"`, is a 400. Import both from `src/generate.js` and change neither in isolation. (Verified
    live by the probe.)
- **VALIDATE**: `node --test test/prep-generate.test.js`
- **SATISFIES**: AC #1, AC #2, AC #3

### CREATE `test/prep-generate.test.js`

- **IMPLEMENT**: Copy `fakeAnthropic`/`ok`/`codeOf` from `test/generate.test.js` (locally — the repo does
  not share test helpers across files) and assert:
  - request names `claude-opus-5`; no `budget_tokens`/`temperature`/`top_p`/`top_k`/`output_format`
  - `max_tokens === MAX_TOKENS` and `MAX_TOKENS >= 32_000`, with `thinking: { type: "adaptive" }`
  - `output_config.format.schema === BRIEF_SCHEMA` (identity — the schema is `prep/schema.js`'s, not a copy)
  - `fallbacks: "default"` and `betas` includes `FALLBACK_BETA`
  - exactly one cache breakpoint, on block 0, containing the visible note and **not** the brief or CV
  - **the verifier runs before the payload is returned**: the fabricated quote comes back
    `verified: false` with `failed_quote` preserved, and nothing is dropped
  - an unknown block name in the model's output throws (`assertBrief` runs before the payload is returned)
  - `refusal` → `model_refused`; `max_tokens` → `truncated`; non-JSON → `no_brief`
  - empty brief / empty CV / over-long CV are refused **before** the model call (`db.calls.length === 0`)
  - an **empty `visibleFields` array still calls the model** — the deliberate divergence from `note_empty`
  - `duration_ms` is an integer and `usage` passes through
- **PATTERN**: `test/generate.test.js` end to end
- **VALIDATE**: `node --test test/prep-generate.test.js`
- **SATISFIES**: AC #1, AC #2, AC #3, AC #4

### CREATE `test/fixtures/prep-brief.md`, `prep-cv.md`, `prep-visible-fields.json`

- **IMPLEMENT**: Clinical-staffing register matching `spike/inputs/` (Ashdown Park Community Healthcare,
  community nursing). The brief must contain, character for character, the two literal quotes used in
  `prep-payload.json`. `prep-visible-fields.json` is the `visibleFields()` output in **#18's verified
  shape** — `{ key, heading, level, text, chars }`:

  ```json
  [
    {
      "key": "their-process",
      "heading": "Their process",
      "level": 2,
      "text": "Two stages. First a 30-minute conversation with the Clinical Services Manager…",
      "chars": 412
    },
    {
      "key": "what-they-actually-care-about",
      "heading": "What they actually care about",
      "level": 2,
      "text": "The Clinical Services Manager has said twice that clinical skill is the easy part…",
      "chars": 287
    }
  ]
  ```

  **Derive it, don't hand-write it.** Once `src/note-fields.js` exists, generate this fixture by running
  `parseNoteFields` over `spike/inputs/client-note.md` and keeping two sections — then the fixture cannot
  drift from the real parser. Until #18 lands, hand-write it to match the shape above and note in the file
  header that it is a stub of a verified contract.

- **GOTCHA**: Every field `visibleFields` returns has a **non-null `key`** — #18 nulls the key for
  duplicate headings and `visibleFields` skips those. So #19 may rely on `key` being present and unique,
  and `source_field_key` checking is sound. Do not defensively handle `key: null`.
- **GOTCHA**: Keep the visible slice realistic in length — a two-line stub is under Opus 5's 512-token
  cacheable minimum and will silently not cache when the script runs live. The live probe confirmed this
  (`cache_read_input_tokens: 0` on a small prefix). Expected; the script prints it. Do not chase it as a bug.
- **VALIDATE**: `node -e "const f=require('./test/fixtures/prep-visible-fields.json'); console.log(f.every(x=>x.key&&x.heading&&typeof x.text==='string'))"` → `true`
- **SATISFIES**: AC #3

### CREATE `scripts/gen-brief.js`

- **IMPLEMENT**: Mirror `scripts/pack.mjs`'s `arg()` parsing and output block.

  ```
  node scripts/gen-brief.js --brief <brief.md> --cv <cv.md> --fields <visible-fields.json> \
                            --client "<name>" --interview 2026-08-12 [--out out/]
  ```

  Reads the files, constructs `new Anthropic()` (bare — reads `ANTHROPIC_API_KEY` from env, matching
  `spike/run.js:32`), calls `generateBrief`, writes `<out>/brief.json`, and prints:
  - the block names produced, in order, with child counts
  - `competencies: N sourced, M unverified` and the question count per competency
  - `usage.cache_read_input_tokens` (the only way to tell the breakpoint actually cached)
  - `duration_ms`

  **"Sendable" is defined here**, and the script enforces it: `assertBrief` passed, and **every** competency
  quote verified. On any failure, print the loud demotion block in `pack.mjs:97-106`'s register and
  **`process.exit(1)`**. Missing key → a clear message and `process.exit(2)`; missing args → usage and
  `process.exit(2)`.

- **GOTCHA**: `package.json` has `"type": "module"`, so `.js` is ESM — the ticket's `gen-brief.js` name
  works despite `pack.mjs`'s extension. Do not rename `pack.mjs`.
- **VALIDATE**: `node scripts/gen-brief.js` (no args) → prints usage, exits 2. With a key set, the full run
  is Level 4.
- **SATISFIES**: AC #3, AC #2

### UPDATE `package.json`

- **IMPLEMENT**: Add `"gen:brief": "node scripts/gen-brief.js"` beside `"pack"`.
- **GOTCHA**: Do **not** touch `"test"` — the single-level glob is load-bearing for `test/schema.test.js`'s
  assumptions and widening it is not this ticket's change.
- **VALIDATE**: `npm run gen:brief` → usage, exit 2
- **SATISFIES**: AC #3

---

## TESTING STRATEGY

### Unit Tests

`node --test`, zero dependencies, one file per module, all directly in `test/`. The model call is stubbed
by a local `fakeAnthropic` that records the request and returns a canned message — the same reasoning as
`test/generate.test.js:1-11`: what is worth asserting is not what Claude writes but the **request this
module builds and what it does with the answer**.

Coverage target follows the repo's implicit standard — every exported function has at least one test, and
every acceptance criterion has a named test that fails if the criterion is violated.

### Integration Tests

The seam has no HTTP surface in this ticket, so "integration" is the schema-and-verify path over the
fixtures end to end (`assertBrief` → `verifyBrief` → summary), plus the script's own exit codes.
No `fakeD1`, no Function imports — nothing in this ticket touches D1.

### Edge Cases

- Block name outside `BLOCK_NAMES`, at the top level **and** nested in `CompetencyMap.children`
- `children` present on a leaf block
- A competency with an empty `source_quote`
- A competency whose quote is a paraphrase (the fabricated-citation case — must demote, not drop)
- A quote differing only by curly quotes / collapsed whitespace / case (must still verify)
- A question whose `competency_id` matches nothing
- A `CompetencyMap.competency_ids` / `StoryBankCard.covers_competency_ids` entry matching nothing
- A competency with zero questions
- A question with `axis: "lateral"` (rejected — this call mints the core bank only)
- Zero competencies (a brief with nothing extractable) — must not crash the summary or the script
- Empty `visibleFields` — legal, still calls the model
- Empty brief, empty CV, CV over `INPUT_MAX` — refused before the model call
- `stop_reason` of `refusal` and `max_tokens`; a text block that is not JSON; no text block at all

---

## VALIDATION COMMANDS

Execute every command to ensure zero regressions and 100% feature correctness.

### Level 1: Syntax & Style

There is no linter or formatter in this repo. The equivalent gates:

```bash
node --check src/prep/schema.js && node --check src/prep/prompt.js \
  && node --check src/prep/verify.js && node --check src/prep/generate.js \
  && node --check scripts/gen-brief.js
```

```bash
# No candidate text may reach a log line from src/ (generate.js:14-16).
! grep -rn "console\." src/prep/ && echo "clean: src/ never prints"
```

**Deliberately NOT a gate: a text grep for score-shaped words over `src/prep/schema.js`.** That file
legitimately contains the word "score" — in the comment explaining why `importance` is exempt from the
walker's regex — so a grep would fail a correct file. `test/schema.test.js:38` already hit this and solved
it (`sql.replace(/--[^\n]*/g, "")`, because the header comment "legitimately contains the words 'candidate'
and 'pack' while explaining why no such table exists"). Group 2 of `test/prep-schema.test.js` walks the
object rather than the text and has a coverage guard; that is the right instrument.

### Level 2: Unit Tests

```bash
node --test test/collection.test.js test/prep-schema.test.js test/prep-prompt.test.js \
            test/prep-verify.test.js test/prep-generate.test.js
```

### Level 3: Integration Tests (the whole suite — zero regressions)

```bash
npm test
```

Must stay green in particular: `test/schema.test.js` (no fourth table appeared),
`test/provenance.test.js` (the new export changed no behaviour), `test/generate.test.js` and
`test/prompt.test.js` (the pack path is untouched).

```bash
# Prove the new tests are actually being collected — the single-level glob is a real trap.
npm test 2>&1 | grep -c "prep-" 
```

### Level 4: Manual Validation

```bash
export ANTHROPIC_API_KEY=sk-ant-...   # or: source the value from .dev.vars
node scripts/gen-brief.js \
  --brief test/fixtures/prep-brief.md \
  --cv test/fixtures/prep-cv.md \
  --fields test/fixtures/prep-visible-fields.json \
  --client "Ashdown Park Community Healthcare" \
  --interview 2026-08-12 \
  --out /tmp/prep-out
echo "exit: $?"     # 0 = sendable
```

Read the output and confirm by eye:

1. Every block name is in the vocabulary; `CompetencyMap` is the only one with children.
2. Each competency's `source_quote` really is a span of `prep-brief.md`.
3. **No `StoryBankCard.skeleton` entry is a sentence in the candidate's voice** — they are headings the
   candidate fills in. This is the one failure a passing test suite cannot catch, and it is SPEC's first
   non-negotiable. Read every skeleton.
4. `cache_read_input_tokens` — 0 on the first run is expected; run it twice and check the second.

Then prove the check bites, in the register of `npm run spike:tamper`:

```bash
# Paraphrase one quote in the written payload and re-verify — must report the demotion.
node -e "
  const fs=require('fs');const p=JSON.parse(fs.readFileSync('/tmp/prep-out/brief.json'));
  p.competencies[0].source_quote='a paraphrase of whatever it actually said';
  fs.writeFileSync('/tmp/prep-out/tampered.json',JSON.stringify(p,null,2));
"
node --test test/prep-verify.test.js   # the same mechanism, already pinned
```

### Level 5: Additional Validation (Optional)

```bash
# Count tokens on the cached prefix — is the visible slice over Opus 5's 512-token minimum?
# Requires a key; uses messages.count_tokens, never a client-side estimator.
```

---

## ACCEPTANCE CRITERIA

Traced from the ticket's own Acceptance line.

- [ ] **AC #1** — `assertBrief` rejects a block name outside `BLOCK_NAMES` (top level and in `children`),
      and rejects a competency with an empty or missing `source_quote`. Tested, not merely schema-declared.
- [ ] **AC #2** — the provenance check fails a fabricated quote: the paraphrased fixture competency comes
      back demoted and marked, `failures` names it, and nothing is dropped. Tested.
- [ ] **AC #3** — the fixture brief + CV produce a sendable payload end to end from
      `node scripts/gen-brief.js`, exit code 0.
- [ ] **AC #4** — no block type exists that carries a finished candidate answer or a score: enforced by the
      schema walker **and** its coverage guard, so an unwalked branch fails rather than passes.
- [ ] The call names `claude-opus-5` and carries nothing that 400s on it.
- [ ] The cache breakpoint is on the visible note slice, with brief/CV/date after it. Tested.
- [ ] `npm test` passes with zero regressions; the new test files are visibly collected.
- [ ] No migration, no D1 access, no Pages Function, no paste path, no renderer (Non-Goals hold).
- [ ] No candidate text reaches a log line or an error message.

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] All validation commands executed successfully
- [ ] Full test suite passes
- [ ] `node --check` clean on every new file
- [ ] Manual run produced a sendable payload, and every `skeleton` entry was read by a human
- [ ] Acceptance criteria all met
- [ ] Code reviewed for quality and maintainability

---

## OPEN QUESTIONS / ASSUMPTIONS

**Assumptions this plan makes** (each stated so a wrong one is a one-line fix, not a redesign):

1. ~~**`visibleFields()` returns `Array<{ label, body }>`**~~ — **RESOLVED, and the guess was wrong.**
   Checked against `.claude/plans/per-field-candidate-visible-toggle.md` (the #18 plan, written in the same
   session). The real contract is:

   ```js
   parseNoteFields(note)                 // -> [{ key, heading, level, text, chars }]
   visibleFields(note, visibleKeys)      // -> the ticked subset, same shape
   ```

   So it is **`{ key, heading, level, text, chars }`**, not `{label, body}` — `heading` where this plan
   said `label`, `text` where it said `body`, plus a stable slug `key` that turns out to be the useful
   part (it makes `PanelBrief.source_field_key` checkable). Every consumer reference in this plan has been
   corrected. Two further facts inherited rather than assumed:
   - **`visibleFields` takes two arguments.** #22 calls `visibleFields(client.note, keysFromDb)` and passes
     the *result* into `generateBrief`. #19 still receives an already-filtered array — that part held.
   - **Every returned field has a non-null `key`.** #18 nulls the key for duplicate headings and
     `visibleFields` skips those, so #19 need not defend against it.

   A "field" is a markdown heading section of the note (#18's Assumption 1); `clients.note` stays one free
   text blob and does not gain columns.
2. **`CompetencyMap` is the only block that nests, and its children are `StoryBankCard`s.** Everything else
   is a leaf with no `children` key. #21's registry should read `block.children ?? []`. If a second block
   turns out to need children, adding a variant is additive — but the schema must stay non-recursive.
3. **`axis` keeps SPEC's full vocabulary (`core`/`lateral`/`vertical`) in the schema, while `assertBrief`
   permits only `core` on this call.** The column vocabulary then matches what #23 writes, without this
   ticket emitting what decision 6 reserves for the session engine.
4. **An empty visible slice is legal** and does not refuse — the deliberate divergence from
   `generatePack`'s `note_empty` guard. Decision 2 makes visibility the recruiter's control.
5. **`interviewAt` is an ISO date string passed through to the prompt**, not parsed or validated here.
   Whether the CTA can even fire without one is #22's gate (decision 9).
6. **The payload is not persisted by this ticket.** `#17` owns `candidate_role.brief_json`.
7. **The "one Function" comment at `functions/api/generate.js:5-9` is superseded, and #22 will have to say
   so.** That header reads *"Do not add a second call site — the switchability is the whole reason this is
   one Function rather than a helper anyone can reach for."* Portal architecture §5 decides two call sites,
   both server-side behind the same single-boundary rule and the same per-agency key. Nothing is violated
   here — this ticket ships a module, not a Function — but the comment is a live prohibition against #22's
   work and should be amended when #22 lands, not relitigated.

**Question that would change the plan if answered differently:** none blocking. The `visibleFields` shape
(1) is the only cross-ticket coupling, and it is stubbed by design per the ticket's own "Depends on" line.

## NOTES (open canvas)

### Why the schema shape was the whole design problem

`{name, props, children}` is a tree. Anthropic's structured outputs **reject recursive schemas** — a `$ref`
that resolves to an ancestor is not expressible. Three ways out were weighed:

| Option | Cost | Verdict |
|---|---|---|
| Uniform two-deep union: `anyOf` of 5 at both levels, `$defs.LeafBlock` for depth 2 | ~10 variants, a 5-way `anyOf` nested inside a 5-way `anyOf`; unverifiable compilation risk from here | Rejected — more schema than the vocabulary needs |
| **Per-block nesting: only `CompetencyMap` takes `children`, items are a single `$ref` to `StoryBankCard`** | 5 variants + 1 `$def`; one `anyOf` at the top level, a plain `$ref` at depth 2 | **Chosen** |
| One block object with `name: {enum: BLOCK_NAMES}` and a single flat `props` | Loses per-name prop typing; every prop becomes optional-in-spirit while `required` forces it present | Held as the fallback |

The chosen option is also the honest reading of decision 22's vocabulary: `PrimerCard`, `PanelBrief`,
`LogisticsRail` and `StoryBankCard` all read as leaf cards. Only the competency map plausibly groups
anything.

### What the probe settled (28 Jul 2026, live against `claude-opus-5`)

The schema shape was this plan's one claim that could not be settled by reading, so it was probed with a
throwaway script carrying the exact structure above. **It compiled and produced a correct payload on the
first attempt.** Recorded here so nobody re-opens it:

| Question | Answer |
|---|---|
| Does a 5-way `anyOf` of `const`-named variants compile? | **Yes** |
| Does `children: { items: { $ref: "#/$defs/StoryBankCard" } }` compile? | **Yes** — no recursion complaint |
| Does `importance: { type: "integer", enum: [1..5] }` survive? | **Yes** — `enum` is the right instrument where `minimum`/`maximum` are rejected |
| Did the model use the whole vocabulary? | Yes — all five names, `CompetencyMap` with 2 children |
| Was `source_quote` literal? | **Yes** — exact span of the brief, verified by `String.includes` |
| Did `skeleton` come back as headings or sentences? | **Headings** — e.g. `["The setting and who was present", "What made escalation difficult or slow", …]`. The `description` alone was enough; SPEC's first non-negotiable held with no extra prompting |
| Output size | 1,641 output tokens at `effort: "low"` (see `MAX_TOKENS` gotcha) |
| Latency | **36.9s** at `effort: "low"`, three-line brief, no CV, no client note |

**Contingency, now unlikely but kept.** If `BRIEF_SCHEMA` ever fails compilation after growing (more
variants, deeper props), fall back to row three: one block object,
`name: { type: "string", enum: BLOCK_NAMES }`, and a flatter `props`. That loses per-name prop typing but
**keeps the vocabulary enforcement the AC requires**, and `assertBrief` — where the AC is actually
enforced — does not change at all. Note the degradation in the PR; do not silently ship it.

### The latency finding, which is #22's problem and should reach it early

36.9 seconds at **`effort: "low"`** with a three-line brief, no CV, and no client note. The real call is
`effort: "high"` (`generate.js:45`) over a full JD, a CV up to `INPUT_MAX`, and the visible note slice —
plausibly **two to five minutes**.

That is fine for the pack, where architecture §5.2 budgets ten minutes and the recruiter is reviewing
output anyway. It is not obviously fine for **Send to Candidate**, which decision 9 makes a button a
recruiter presses and then waits on, and architecture §6 already names the felt experience as a risk:
*"if a turn's round-trip reads as dead air, perceived quality collapses."*

Nothing for #19 to do — the seam is correct either way, and `EFFORT` is the lever if it needs one
(imported from `src/generate.js`, so lowering it for prep alone means shadowing the import deliberately
and saying why). But **#22 should not discover this while wiring the CTA.** Options it will want to weigh:
fire-and-poll with the invite email sent on completion, an optimistic "we're building it" state, or
accepting the wait with honest progress copy. Worth a comment on #22 now.

### Why `assertBrief` carries the acceptance criteria, not the schema

There is no JSON Schema validator in this repo and this ticket does not add one (`node --test` with zero
deps is a real constraint the repo has chosen deliberately — see `test/schema.test.js`, which hand-writes a
SQL parser rather than take a dependency). So `BRIEF_SCHEMA`'s `const` and `enum` are enforced by
Anthropic's decoder at request time, where no test can reach them.

If the vocabulary rule lived only in the schema, "schema validation rejects unknown block names" would be
an untested claim about a third party's decoder. `assertBrief` enforcing it independently is what makes the
criterion real — the same argument `src/prompt.js:83-90` makes for why `assertPack` and `src/paste.js`
exist alongside structured outputs: *"structured outputs made the schema a constraint the decoder enforced
rather than a request… which is strictly weaker, which is why `assertPack` exists on the way back in."*

### The coverage guard is not optional

`test/schema.test.js` is the best test in this repo, and its lesson is in the two tests *above* its real
assertions: a construct the parser cannot read is **absent from the map, so it passes the assertion
instead of failing it — silence that looks identical to compliance.**

A recursive walk over a nested JSON Schema has exactly that failure mode. Miss `$defs`, miss an `anyOf`
branch, miss `items`, and a `props.model_answer` added in the unwalked branch sails through the test that
exists to defend the epic's hardest non-negotiable. Hence: assert the walker's *coverage* (visited block
names `deepEqual` `BLOCK_NAMES`; every `$defs` key visited) before trusting what it reports.

### Cost, for the record

Decision 6 budgets ~30p for this call and £1–1.75 per candidate course. Opus 5 is $5/$25 per MTok; a
cache read is ~0.1×. The visible slice is the reused prefix — but at Opus 5's 512-token minimum a thin
slice silently will not cache, and `usage.cache_read_input_tokens` is the only signal. That is why the
script prints it, and why the *test* asserts breakpoint placement rather than caching itself (a test cannot
observe a cache).

### What #21, #22 and #23 will want from this

- **#21** imports `BLOCK_NAMES` and builds one registry entry per name; reads `block.children ?? []`.
- **#22** calls `generateBrief` from a Pages Function, maps `StoreError` via `errorResponse`, and persists
  the payload into #17's `candidate_role.brief_json`.
- **#23** reads `competencies` (adding runtime `stage` and `success_rate`, which this call deliberately
  does not mint) and seeds the `question` table from the core bank, then writes `lateral`/`vertical` rows
  into the same `axis` vocabulary.

Keeping the payload a plain object with no D1 dependency is what makes all three straightforward.

## AMENDMENTS

- 2026-07-28 — `visibleFields()` shape corrected from the guessed `{label, body}` to #18's verified
  `{ key, heading, level, text, chars }`, checked against `.claude/plans/per-field-candidate-visible-toggle.md`.
  `PanelBrief.panel[].source` became `source_field_key` and gained an `assertBrief` check, because #18's
  stable slugs make note-derived claims checkable the way JD quotes already are. Fixture renamed
  `prep-visible-note.json` → `prep-visible-fields.json`; script flag `--note` → `--fields`.
- 2026-07-28 — schema shape verified live against `claude-opus-5` (see NOTES → "What the probe settled").
  The 5-way `anyOf` + `$ref` depth-limiting compiles; the flat-block contingency is retained but demoted
  from likely to unlikely. Recorded the measured output size (1,641 tokens at low effort) behind
  `MAX_TOKENS`, and the 36.9s low-effort latency as a finding for #22.
- 2026-07-28 — added `test/collection.test.js`: `npm test`'s single-level glob silently skips any test file
  in a subdirectory, which would have made this ticket's whole suite decorative.
- 2026-07-28 — `source_field_key` moved from `assertBrief` (throws) to `verifyBrief` (demotes). The first
  version made a hallucinated slug kill the whole Send, inverting `provenance.js:62`'s "Demote, don't drop"
  — the rule the rest of this product rests on. `verifyCompetencies`/`competencySummary` renamed
  `verifyBrief`/`briefSummary` now that they cover both halves.
- 2026-07-28 — **Level 4 run recorded, as the `MAX_TOKENS` gotcha requires.** Two live runs against
  `claude-opus-5` at `effort: "high"` over `test/fixtures/prep-brief.md` + `prep-cv.md` + the
  two-field visible slice, both exit 0 and sendable:

  | | run 1 (cold) | run 2 (warm) |
  |---|---|---|
  | `output_tokens` | **8,925** | 7,512 |
  | `duration_ms` | 124.2s | 94.4s |
  | `cache_read_input_tokens` | 0 (4,960 written) | **4,960** |
  | blocks / competencies / questions | 4 / 12 / 19 | 4 / 10 / — |
  | competency quotes verified | 12 of 12 | 10 of 10 |

  8,925 is **18.6% of `MAX_TOKENS`**, under the 30% line the gotcha sets, so 48k stands. The
  visible slice clears Opus 5's 512-token minimum and caches on the second run — the cached prefix
  is 4,960 tokens (`PREP_SYSTEM` + the slice), which is the breakpoint working as designed.
  **124.2s at high effort** against the probe's 36.9s at low: the latency finding for #22 is real
  and is the low end, since these fixtures are shorter than a real JD and CV.
  The model used four of the five block names — no top-level `StoryBankCard`, but 7–8 of them as
  `CompetencyMap` children. The vocabulary is available, not mandatory; nothing is wrong.
- 2026-07-28 — dropped the Level 1 score-word grep over `src/prep/schema.js` (it would fail on the comment
  the plan itself mandates — the same false positive `test/schema.test.js:38` strips comments to avoid);
  the schema walker plus its coverage guard is the correct instrument. Widened `assertBrief` to reject
  dangling competency references and competencies with zero questions.
