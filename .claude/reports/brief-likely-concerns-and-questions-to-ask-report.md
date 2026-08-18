# Implementation Report — likely concerns + questions to ask the interviewer (#79)

**Plan**: `.claude/plans/brief-likely-concerns-and-questions-to-ask.md`
**Branch**: `feature/brief-likely-concerns-and-questions-to-ask`
**Status**: **COMPLETE**, and it carries a production hotfix it did not set out to carry.

*Corrected 18 Aug 2026, from the PR #89 review (F18).* The line here previously read "Two commits:
the outage fix first, so it can be cherry-picked to `main` ahead of the feature." **The branch does
not have that shape.** There is one substantive commit (`724f0e2`) plus a `.gitignore` chore, so
the outage fix cannot be picked — it would have to be split out, and the intermediate commit would
drop the locum first-day primer, shipping a regression to tidy history. The PR body says this
plainly; it was this report that was stale.

Verified end to end against the live API (observed, 18 Aug 2026):

- **permanent brief** — 12 competencies all sourced, 4 panel claims sourced, `concerns: 5
  evidenced, 0 unsourced, 2 with nothing in the CV to meet it — 7 total`, 9 questions to ask,
  every concern question `probing`. Exit 0, "sendable".
- **locum booking** — `FirstDayPrimer` arrives from the second call with 4 items, 0 unsourced;
  all four question types present; concerns `1 evidenced, 0 unsourced, 4 with nothing in the CV`.
- **AC4 confirmed on real output**: the model left concerns empty rather than inventing a
  counter ("there is nothing anywhere in your CV about delivering IVs at home" → empty quote),
  and **every quote it did give was literally in the CV** — `0 unsourced` on all three runs.

One honest limitation: `gen-brief.js` prints `usage` from the FIRST call only, so the second
call's cache read is not surfaced live. That the second call is *built* to read the cache is
asserted structurally (its cached content block is byte-identical to the first's).

## ⚠ Found on the way, and fixed here: `/api/prep/prepare` was broken on main

**Not caused by #79.** The prep-brief model call on `main`, unmodified, with its own prompt and
its own parameters, returns:

> `400 The compiled grammar is too large, which would cause performance issues.`

Measured (observed, 18 Aug 2026, `main`'s `src/prep/schema.js` and `src/prep/prompt.js` verbatim):

| Request | Result |
|---|---|
| main's schema + main's prompt, `thinking: adaptive`, 48k — **exactly what production sends** | **400 grammar too large** |
| the same, `thinking: disabled` | OK, 5,096 output tokens |
| the same, `thinking: adaptive`, `effort: "low"` | 400 grammar too large |
| the same, `thinking: adaptive`, **five** block branches instead of six | OK, 10,060 output tokens |

**`thinking: { type: "adaptive" }` lowers the structured-outputs grammar ceiling**, and under it the
limit is **five** block variants. Production has six. The sixth is `FirstDayPrimer`, added by
**b4a06df — #50, the locum portal pivot**. Every measurement in this report that used
`thinking: disabled` (including this ticket's own guard-test probes) passed at six branches, which
is why the ceiling looked like it was exactly at six rather than one below it.

So the recruiter's Prepare/Send button has been dead since #50 shipped, and nothing caught it: every
test in the suite drives `generateBrief` with a fake client, so the request is asserted and never
sent. `thinking: adaptive` itself has been on this call since #19 (9e936d6) — it is the *branch
count* that crossed the line, not the thinking mode.

`thinking: { type: "enabled", budget_tokens: N }` is not an escape: Opus 5 rejects that parameter
shape outright (400 on `thinking.type.enabled`).

**The fix, shipped as commit 1 of this branch:** `FirstDayPrimer` moves onto #79's second call,
taking call one to five branches. It is the right one to move — locum-only, and the branch that
crossed the line. Its provenance is untouched: every item still carries `source_field_key` and
still demotes through the same check, because which call fetched an item is not something
`verifyBrief` can see. Its locum/perm branch moved from `engagementBlock` to `concernsTaskBlock`,
staying per-candidate and staying after the cache breakpoint.

**A correction to my own earlier measurements in this report.** The first version of the guard
test probed with `thinking: { type: "disabled" }` and passed while production was 400ing — the
same blind spot that let #50 through. It now probes at production parameters, and re-measuring
changed one conclusion: **it is total grammar, not branch count.** A sixth branch as cheap as
`PrimerCard` compiles fine; `FirstDayPrimer` — an array of three-field objects — does not. "Five"
is this schema's number, not a documented API limit. The guard reproduces #50's actual branch
rather than a cheap proxy, and is red without the fix (verified).

## Measurement log — how the ceiling was characterised

Kept because the negative results are what rule out the cheaper fixes, and the next person to hit
this should not have to re-buy them.

> **Read the correction above first.** Every row in this first table was measured with
> `thinking: { type: "disabled" }`, before it was known that the thinking mode moves the ceiling.
> The row marked "ACCEPTED" is therefore **not** what production runs — production sends
> `adaptive`, and the same schema 400s under it. The rows that ruled things OUT are unaffected: a
> variant that fails on the easier setting cannot pass on the harder one.

| Variant (all at `thinking: disabled`) | Result |
|---|---|
| 6 block branches, full descriptions | ACCEPTED — *but 400s at `adaptive`; see the correction* |
| 6 branches + one flat `string[]` top-level property | 400 grammar too large |
| 7 branches, the 7th as small as a block can be | 400 grammar too large |
| 8 branches with **every description stripped** (4,761 B vs the 9,375 B that passes) | 400 grammar too large |
| 8 branches with the fallback chain removed | 400 grammar too large |
| cheap shrinks (`importance` a plain integer, `axis` a `const`, question enums collapsed) + one array | 400 grammar too large |

What this rules out, with evidence:

- **It is not description size.** The stripped 8-branch schema is half the bytes of the passing one
  and still fails. `schema.js`'s descriptions are free.
- **It is not the fallback chain.** Removing `betas`/`fallbacks` changes nothing; it is Opus 5's own limit.
- **It is not fixable by trimming enums.** Collapsing every enum on `question` and `competency` buys
  nothing measurable.
- **Nothing fits.** Not two blocks, not one block, not a single top-level array of strings.

Three encodings were tested as ways out:

| Option | Result |
|---|---|
| **A** — flatten `blocks` to one object with a `name` enum + one merged `props`, per-name shape moved to `assertBrief` | merged props **all required**: ACCEPTED, but that forces every block to emit every prop, so it is unshippable. In the form it would actually ship (props optional): **400 "Schema is too complex"** — a different limit. **Dead.** |
| **B** — drop `CompetencyMap.children` (the only nesting) to free room for both surfaces in the one call | ACCEPTED. Costs the StoryBankCard grouping — a shipped feature with its own strike logic. |
| **C** — a second, small model call carrying only the two new surfaces, folded into `blocks` before `assertBrief` | ACCEPTED. Costs one extra call per Send; the cached prefix is reused, so its input is mostly a cache read. Changes architecture decision 5's "one call". |

**C shipped.** The standing risk that went with it — no test could see the ceiling — is closed by
`test/live/prep-schema-fits.test.js`, which probes both schemas at production parameters and reproduces
#50's branch to prove the limit is still where it was. Out of `npm test`'s glob (PR #89 review
F1: a key-gated file inside it made CI's no-skips rule red on every PR), with its own
`npm run test:live` — and it FAILS rather than skips without a key, so the command can never
report success over an unprobed ceiling.

**Still worth knowing for #80:** the first call has room for five block variants of the shapes it
currently carries, and no more. A sixth surface goes on the second call, or it does not ship.

## Summary

Two new block variants (`LikelyConcerns`, `QuestionsToAsk`) in the closed component vocabulary, a
fourth `question.type` (`"concern"`), and a second haystack in the provenance verifier. A concern
carries a verbatim span of the **candidate's CV** or the empty string — there is no prose counter
prop, so the structure itself cannot hold a fabricated answer to an objection. `verifyBrief` now
takes `cv` and blanks any span it cannot find literally. Concern counters ride `brief_json` as
ordinary `axis`-NULL questions, so they drill through the existing loop with zero queue code.

## Tasks completed

- BLOCK_NAMES → eight; the two block defs with prop descriptions as prompt text → `src/prep/schema.js` (UPDATE)
- `question.type` enum gains `"concern"`; `assertBrief` widens → `src/prep/schema.js` (UPDATE)
- `assertBrief` learns both blocks: array guards, reference resolution, the concern↔question pairing rule → `src/prep/schema.js` (UPDATE)
- CV haystack + `demoteConcern` + the "TWO HAYSTACKS" header amendment → `src/prep/verify.js` (UPDATE)
- `briefSummary` gains `concern_sourced` / `concern_unsourced` / `concern_no_material` / `concern_total` → `src/prep/verify.js` (UPDATE)
- `verifyBrief(…, { cv: inputs.cv })` → `src/prep/generate.js` (UPDATE)
- `verifyBrief(…, { cv })` on the re-verify; send gate deliberately unchanged → `functions/api/prep/send.js` (UPDATE)
- `PREP_SYSTEM` rules 7 and 8 (unconditional); both `engagementBlock` branches widened; the second call's `concernsTaskBlock`, which took the primer's locum branch over from `engagementBlock` → `src/prep/prompt.js` (UPDATE)
- `CALL_ONE_BLOCK_NAMES` (five) split from `BLOCK_NAMES` (eight), `CONCERNS_SCHEMA`, `foldConcerns` → `src/prep/schema.js` (UPDATE)
- `generateConcerns` — the second call, degrading rather than throwing — and `CONCERNS_MAX_TOKENS` → `src/prep/generate.js` (UPDATE)
- the live ceiling gate, at production parameters → `test/live/prep-schema-fits.test.js` (CREATE)
- `keep()` prunes `LikelyConcerns`, drops an emptied block → `src/prep/strike.js` (UPDATE)
- `projectConcern` blanks `failed_evidence_quote` → `src/prep/projection.js` (UPDATE)
- `COPY` (5 strings), both constructors, `BRIEF_BLOCK_NAMES`, `REGISTRY` (14 keys), `LocumQuestions`' fourth group → `public/prep/registry.js` (UPDATE)
- the locum prime's fourth group, with a `hasOwnProperty` normaliser → `public/prep/session.js` (UPDATE)
- both blocks, two concern questions, `type` on all eight questions → `test/fixtures/prep-payload.json` (UPDATE)
- regenerated by script from the source fixture → `public/prep/brief.fixture.json` (UPDATE)
- concern counts + a `switch (f.kind)` failure printer → `scripts/gen-brief.js` (UPDATE)
- one sentence recording the CV-span mechanism → `docs/epics/interview-prep/SPEC.md` (UPDATE)

One new file (the ceiling gate). No migration. `public/app.js` untouched (`git diff` confirms).

## Tests added

44 new tests: 40 across eight existing files in each file's own group idiom, plus the four-test
ceiling gate in its own new file.

- `test/live/prep-schema-fits.test.js` (+5, key-gated, `npm run test:live`) — both schemas compile at **production
  parameters**; `generateBrief` still sends the thinking mode this gate probes (read off the
  source, not trusted to a comment); and #50's own `FirstDayPrimer` branch, put back, still 400s.
- `test/prep-generate.test.js` (+4 more) — the split itself: the first call's `anyOf` names none
  of the three moved blocks; the second call carries `CONCERNS_SCHEMA` at `CONCERNS_MAX_TOKENS`;
  its cached content block is byte-identical to the first's; it is handed the competency ids. Plus
  five degrade cases (throw, refusal, truncation, bad JSON, no text) each leaving a usable brief
  with a recorded `concerns_call` failure — and no candidate text in that failure entry.
- `test/prep-prompt.test.js` (+1, 1 rewritten) — the first call no longer names `FirstDayPrimer`
  at all; `concernsTaskBlock` carries the primer instruction and only on the locum branch.

- **the pre-#79 regression, both halves** — `prep-schema.test.js`: a payload with neither new block
  and no `type` on any question still asserts (every stored brief re-asserts on every candidate page
  load, `functions/prep/api/brief.js:49`, where a throw is a 502 the candidate cannot act on).
  `prep-registry.test.js`: the same payload renders with `skipped: []`, `unresolved: []` and no
  console warning. After the fixture change nothing in the repo had that shape any more, so both
  specimens are made deliberately.
- `test/prep-schema.test.js` (+7) — eight names all with defs; a dangling `competency_id`; non-array
  `concerns` / `questions`; neither block nests (top level and inside `children`); a concern with no
  paired `type: "concern"` question; a concern question tagged under the *wrong* competency.
- `test/prep-verify.test.js` (+11) — a verbatim CV span survives unmarked; **an empty
  `evidence_quote` is untouched and emits no failure** (the AC4 case); a span not in the CV is
  blanked, marked and reported; re-verify is idempotent and re-reports nothing; a forged
  `failed_evidence_quote: null` is still checked; **the two haystacks do not cross** (a CV span fails
  as a competency source, a brief span fails as a counter); whitespace latitude; an absent `cv`
  fails closed; the three-way counts partition the total; a demoted payload still asserts.
- `test/prep-generate.test.js` (+2) — **AC3's leak proof**: a note with one ticked and one unticked
  section through the real `visibleFields` gate, asserted on the whole serialised request; plus the
  structural half (no `.note` read in `prompt.js`, and `buildPrepMessages`' parameter list is exactly
  the **seven** — the six the plan named plus `task`, which is the AC3 deviation recorded under
  "Divergences" below. This line read "exactly the six" and was wrong; the test asserts seven.)
- `test/prep-registry.test.js` (+6) — a concern with a quote renders the quote and the caption; a
  concern with none renders `COPY.concernsNoMaterial`, no quote element and **no Unverified pill**; a
  demoted concern's `failed_evidence_quote` never reaches the HTML; `QuestionsToAsk` renders its list
  and note; `LocumQuestions`' fourth group renders and is skipped when empty.
- `test/prep-strike.test.js` (+3, and `referencedIds` extended) — striking a competency removes its
  concern and its concern question; striking every referenced competency drops the block;
  `QuestionsToAsk` survives untouched.
- `test/prep-send.test.js` (+2) — a demoted concern quote is **still sendable** (201, gate is
  competency-only) with the diagnostic kept in the stored artefact; concern questions land as
  `axis`-NULL rows and the `question` table still has no `type` column.
- `test/prep-targeting.test.js` (+2) — **a concern counter is not the first question served** on a
  fresh log, plus the failure it guards (the same bank pitched gentle opens on the counter); and the
  fixture's own concern questions are pinned `probing`.

## Validation results

Node **v24.11.0** (Level 0 — on the shell default v20.20.2 the send-path tests skip silently).

- `npm test` → **tests 1319 · pass 1319 · fail 0 · skipped 0** (observed, after the PR #89 review
  fixes). Baseline before this work was 1265 · 0 · 0. It was 1309 · 1305 · 0 · **4 skipped** until
  F1 moved the key-gated ceiling gate out of the glob — those 4 skips were what made CI red.
- `npm run test:live` with the key from `.dev.vars` → **5 pass · 0 fail · 0 skipped** (observed).
  `BRIEF_SCHEMA` and `CONCERNS_SCHEMA` both compile at production parameters, and #50's sixth
  branch still returns "the compiled grammar is too large" — now asserted on the error MESSAGE,
  so a 401 or a 429 can no longer satisfy it (F6).
- Level 1 `node --check` over all nine changed JS files → clean (observed).
- Level 4 fixture regeneration → `concern_sourced: 1, concern_unsourced: 0, concern_no_material: 1,
  concern_total: 2` (observed). `concern_unsourced: 0` is the plan's gate.
- Level 4 render read-out (headless, fixture through `candidateProjection` → `renderBlocks`) →
  9 blocks rendered, 0 skipped; both new blocks read correctly and the no-material case shows the
  reviewed sentence (observed).
- Level 4 `node scripts/gen-brief.js` with no args → `exit=2` with the usage block (observed).
- Level 5 `grep -rn "LikelyConcerns\|evidence_quote" functions/api/ public/app.js` → no hits
  (observed). No recruiter route learns about concerns.
- The four new `briefSummary` counters are inert on the recruiter's screen: `renderPreview`
  (`public/app.js:1434`) reads `body.payload.competencies` and never `body.provenance` (observed —
  the `provenance` reads at `:1149-1161` are the *pack*'s summary, a different object).

## Deviations from the plan

1. **`briefSummary` counts three ways, not two.** The plan's formula was
   `concern_sourced = total - unsourced`, with `concern_no_material` added alongside as a fourth,
   overlapping number (its own Q1/Task-5 gotcha flags the problem). That would print
   "3 evidenced" over a brief where one concern has nothing behind it. Implemented instead as a
   partition: `sourced + unsourced + no_material === total`, asserted. All four names are new, so no
   caller is affected. This answers **Q1** as yes, in the stronger form.

2. **`demoteConcern` has one guard, not two.** The plan's second clause
   (`evidence_quote === "" && "failed_evidence_quote" in entry`) is unreachable — the first guard
   (`!trim()`) already returns for a blank quote. Behaviour is identical: idempotency holds through
   the blank branch, and a forged `failed_evidence_quote: null` on a *non-blank* quote still falls
   through and is checked (test proves it). Transcribing the dead clause with a comment claiming a
   two-clause check would have been a false comment.

3. **Three existing string-scan assertions narrowed** — `test/prep-projection.test.js:100` and
   `test/prep-send.test.js:1080` both scanned the wire for the *word* `"questions"` to prove the
   question bank does not reach a candidate. `QuestionsToAsk` carries a prop of that name (questions
   the candidate *asks*, which the endpoint does serve), so the word no longer distinguishes the two.
   Both now assert the absent top-level key plus every bank question's *text* — which is the sharper
   half, and catches a passthrough under a renamed key that the word scan never did.

4. **Four existing tests re-specimened rather than left to break.** Each retyped the fixture's
   questions wholesale and would now wipe the concern tags: `prep-send.test.js:279`,
   `prep-session-ui.test.js`'s `LOCUM_PAYLOAD`, `prep-schema.test.js`'s enum test, and
   `prep-turn.test.js`'s `SINGLE()`. Each now preserves `type: "concern"`, with a comment saying why.
   `prep-projection.test.js`'s "a locum question without a type defaults to competency" now *strips*
   the types: #79 typed every fixture question, so the pre-#50 specimen the test needed had to be
   made rather than found.

5. **`docs/epics/interview-prep/SPEC.md` gained one sentence** (Task 21's conditional branch). The
   CV-span mechanism is a stronger guarantee than "say so plainly" and the spec now records it.

Everything the plan marked **DO NOT** was honoured except one, and the exception is stated above
rather than buried: no D1 migration, no `public/app.js` change, no widening of the send gate,
`MAX_TOKENS` unchanged. **A new file WAS added** — `test/live/prep-schema-fits.test.js`, the ceiling
gate, without which the outage this branch fixes would have gone back out undetected. (F18: this
line previously claimed "no new file" while the file list two sections up said "One new file".)

6. **AC3 dropped from a structural guarantee to a conventional one** (F12), and the plan's wording
   is what makes that a deviation rather than a detail. Task 8: *"`visibleNoteBlock` and
   `prepInputsBlock` gain **no new parameter**. That is what makes AC3 provable: there is no channel
   into the prompt other than `{clientName, visibleFields, brief, cv, interviewAt, engagement}`."*
   Both gained a `task` parameter. AC3 still holds — the sole caller passes `concernsTaskBlock(...)`,
   a module-owned constructor, and the only interpolated data is call one's own competency labels,
   never note text — but the guarantee moved from *no channel exists* to *no caller currently uses
   the channel*, which is the thing the plan's gotcha existed to prevent. Accepted; recorded here so
   it is not rediscovered as a surprise.

## Issues encountered

- **The blocker above**, found by the live-key run the owner authorised. It is exactly the question
  the plan said a test could not answer ("does a five-way `anyOf` of const-named variants compile"),
  and the answer for eight is no. The plan's Solution Statement item 1 — "two new block variants in
  the closed component vocabulary" — is not expressible against this API.

- **The plan weighed and rejected a top-level `concerns[]` array** ("would need its own projection,
  its own strike pruning, its own registry path"). That rejection assumed adding block variants was
  free. It is not free; it is impossible. The argument should be re-run knowing that.

- **`schema.js:13-15` is wrong on one point.** The header records that structured outputs need
  `additionalProperties: false` everywhere — true — but the codebase also behaves as though every
  property must be `required` (the `properties()` helper sets `required: Object.keys(props)`).
  Optional properties are accepted (probed). They are, however, *expensive*: making the merged
  props object optional is what produced "Schema is too complex" in option A. Worth recording either
  way, since the next person will reach for optionality.

- **Deploy note (from the plan's Rollout):** unchanged and still true once a fork is chosen — no
  migration, no config, no secret; `PREP_SYSTEM` changed, so the first Send per client after deploy
  reads a cold cache.

- **The plan's Solution Statement item 1 could not be built as written.** "Two new block variants
  in the closed component vocabulary" is not expressible against this API — nor was the sixth that
  already shipped. The vocabulary is still eight names and the registry still holds fourteen
  constructors; what changed is that three of the eight are minted by a second call and folded
  into `blocks` before `assertBrief`, so nothing downstream of that line knows there was a split.

- **The plan weighed and rejected a top-level `concerns[]` array** ("would need its own
  projection, its own strike pruning, its own registry path"). That rejection assumed adding block
  variants was free. It was not free; it was impossible. The shape shipped here keeps the plan's
  goal — everything renders through `renderBlocks` and prunes through `strikeCompetencies` — by
  folding rather than by adding a parallel path, which is the outcome that rejection wanted.

- **`schema.js:13-15` is wrong on one point.** It records that structured outputs need
  `additionalProperties: false` — true — but the codebase also behaves as though every property
  must be `required` (`properties()` sets `required: Object.keys(props)`). Optional properties are
  accepted. They are, however, expensive: making a merged props object optional is what produced
  "Schema is too complex". Worth recording, since the next person will reach for optionality.

- **Deploy note:** no migration, no config, no secret. `PREP_SYSTEM` changed, so the first Send
  per client after deploy reads a cold cache. Every Send costs one extra model call now — the
  price of the split, and of the outage fix.
