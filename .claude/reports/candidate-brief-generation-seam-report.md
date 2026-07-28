# Implementation Report — candidate-brief generation seam (#19)

**Plan**: `.claude/plans/candidate-brief-generation-seam.md`
**Branch**: `feature/candidate-brief-generation-seam`
**Status**: COMPLETE

## Summary

The one `claude-opus-5` call that runs at **Send to Candidate**, built as a pure, CLI-exercisable
seam with no UI, no route and no database. `src/prep/` holds the block contract (`schema.js`), the
prompt with its cache breakpoint on the candidate-visible note slice (`prompt.js`), the
demote-never-drop provenance check (`verify.js`) and the call itself (`generate.js`);
`scripts/gen-brief.js` drives it end to end with a real key. Two live runs against `claude-opus-5`
produced sendable payloads — 12 of 12 and 10 of 10 competency quotes verified literally against the
brief, exit code 0 both times.

## Tasks completed

| Task | Path | |
|---|---|---|
| Fixture brief (the JD) | `test/fixtures/prep-brief.md` | CREATE |
| Fixture CV | `test/fixtures/prep-cv.md` | CREATE |
| Fixture visible slice | `test/fixtures/prep-visible-fields.json` | CREATE |
| Fixture model payload | `test/fixtures/prep-payload.json` | CREATE |
| `BLOCK_NAMES`, `BRIEF_SCHEMA`, `assertBrief()` | `src/prep/schema.js` | CREATE |
| Vocabulary + no-answer/no-score walker + coverage guard | `test/prep-schema.test.js` | CREATE |
| The single-level-glob guard | `test/collection.test.js` | CREATE |
| `quoteAppears()` — one new export, nothing else touched | `src/provenance.js` | UPDATE |
| `verifyBrief()`, `briefSummary()` | `src/prep/verify.js` | CREATE |
| The literal check, incl. the fabricated-quote case | `test/prep-verify.test.js` | CREATE |
| `PREP_SYSTEM`, `visibleNoteBlock()`, `prepInputsBlock()`, `buildPrepMessages()` | `src/prep/prompt.js` | CREATE |
| Prompt properties and breakpoint placement | `test/prep-prompt.test.js` | CREATE |
| `generateBrief()`, `MAX_TOKENS` | `src/prep/generate.js` | CREATE |
| Request shape, breakpoint, verify-before-return, error taxonomy | `test/prep-generate.test.js` | CREATE |
| The CLI, and where "sendable" is defined | `scripts/gen-brief.js` | CREATE |
| `"gen:brief"` script | `package.json` | UPDATE |
| Level 4 measurements | `.claude/plans/candidate-brief-generation-seam.md` (AMENDMENTS) | UPDATE |

## Tests added

**51 new tests, all passing**, in five files directly in `test/` (the glob is single-level):

- `test/prep-schema.test.js` — **14**. Vocabulary rejection at the top level *and* inside
  `children`; `children` on a leaf; empty/missing `source_quote`; dangling competency references in
  all three places they can appear; a competency with zero questions; a non-`core` axis; a bad
  difficulty; and `source_field_key` explicitly *not* throwing. Then the schema walker asserting no
  property is answer- or score-shaped, plus **three coverage guards** on the walker itself.
- `test/prep-verify.test.js` — **11**. Both literal quotes survive (one of them crossing a line
  wrap, which exercises `normalise`'s latitude in the real path); the paraphrase is demoted, marked
  and still present; empty quote is its own reason; a one-word near-miss still fails; the panel
  half against the field keys; empty slice demotes rather than throws; no mutation of the caller's
  object; the summary, including the zero-competency case.
- `test/prep-prompt.test.js` — **11**. Each rule asserted as a property, not as prose; exactly one
  `cache_control`, on block 0, containing the slice and *not* the brief, CV or date; field keys
  present so a claim is checkable; order preserved; empty slice well-formed.
- `test/prep-generate.test.js` — **14**. Request shape (`claude-opus-5`, no `budget_tokens` /
  `temperature` / `top_p` / `top_k` / `output_format`, `MAX_TOKENS >= 32_000`, adaptive thinking,
  schema identity, matched `fallbacks`/`betas` pair); the breakpoint; both checks running before
  the payload is returned; the four not-a-brief errors; inputs refused before the call; the
  empty-slice divergence; duration and usage; no candidate text in an error message.
- `test/collection.test.js` — **1**. Every `*.test.js` sits directly in `test/`.

**Both guards were proved to bite, not just to pass:**

| Probe | Expected | Result |
|---|---|---|
| Plant `readiness_score` inside the `$defs.StoryBankCard` branch | group 2 fails | `not ok 10 - no property in the contract is answer-shaped or score-shaped` |
| Add a sixth variant in a branch the walker cannot read | the coverage guard fails | `not ok 12 - the walker reached every block variant in the vocabulary` |
| Plant `test/tmp/decoy.test.js` | the collection guard fails | `guard fires correctly` |

## Validation results

**Level 1 — syntax and style.** `node --check` clean on all five new source files.
`grep -rn "console\." src/prep/` → no matches; modules return, scripts print.

**Level 2 — the new unit tests.** 51 tests, **51 pass, 0 fail**.

**Level 3 — the whole suite.** `npm test` → **304 tests, 300 pass, 0 fail, 4 skipped.**
`test/provenance.test.js` passes unchanged (15/15) after the new export.
The 4 skips are `node:sqlite unavailable (Node < 22.5)` in the concurrent #17 work, not mine.
New tests visibly collected: `every test file sits directly in test/` is `ok 1`, `a paraphrased
quote is demoted, marked, and still there` is `ok 153`, and so on through the glob.

**Level 4 — the live run, `node scripts/gen-brief.js` against `claude-opus-5`.**

| | run 1 (cold) | run 2 (warm) |
|---|---|---|
| exit code | **0 — sendable** | **0 — sendable** |
| competency quotes verified | 12 of 12 | 10 of 10 |
| `output_tokens` | 8,925 (**18.6% of `MAX_TOKENS`**) | 7,512 |
| `cache_read_input_tokens` | 0 (4,960 written) | **4,960** |
| duration | 124.2s | 94.4s |

The four eyeball checks the plan requires:

1. **Vocabulary and nesting** — four of the five names used, `CompetencyMap` the only one with
   children (7–8 `StoryBankCard`s under it). The model did not emit a top-level `StoryBankCard`;
   the vocabulary is available, not mandatory.
2. **Quotes** — 12/12 and 10/10 verified literally, deterministically.
3. **Every `skeleton` entry read by a human.** All 8 cards, ~60 entries. Every one is a heading the
   candidate fills in; none is a sentence in their voice and none contains an answer. SPEC's first
   non-negotiable held with no prompting beyond the schema `description`. Two entries sit near the
   line and are worth naming: one quotes the brief back with strategic framing ("this is the
   concern behind the question… let the examples carry that, rather than the claim") and one
   references the note field key inline. Both direct *what to prepare*, neither supplies content —
   on the right side, but the boundary #21 will render against.
4. **Cache** — 0 read cold, 4,960 read warm. The slice clears Opus 5's 512-token minimum.

**The tamper proof.** Paraphrasing a quote in the real payload and re-verifying: the competency
came back `verified: false`, `failed_quote` preserved verbatim, `failures[0].reason` = `"quote not
found in the brief"`, and **all 12 competencies still present**. Demoted, marked, not dropped.

## Deviations from the plan

1. **Task order — the fixture brief was hoisted from Phase 4 to first.** The plan puts
   `prep-payload.json` in Phase 1 and `prep-brief.md` in Phase 4, but the payload's own GOTCHA
   requires them written together and `test/prep-verify.test.js` (Phase 2) reads both. No design
   change; the order was unbuildable as listed.

2. **`test/fixtures/prep-visible-fields.json` was derived, not hand-written.** The plan says to
   hand-write it until #18 lands. Instead it was generated by running #18's *specified* parser
   rules (`/^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/`, slug the heading, `chars = text.trim().length`)
   over `spike/inputs/client-note.md` — the file the #18 plan says the parser was designed against.
   So `chars` is exact and re-deriving it once `src/note-fields.js` exists should produce no diff.
   The plan also asks for a "stub of a verified contract" note in the file header; JSON has no
   comments and adding a `_note` key would pollute the array, so the provenance is recorded here
   and in the test file headers instead.

3. **`scripts/gen-brief.js` exits 1 on a `panel_source` failure too, not only a competency quote.**
   The plan defines sendable as "`assertBrief` passed, and every competency quote verified", then
   says "on any failure … `process.exit(1)`". The stricter reading was taken: a panel claim
   attributing something to a note field the recruiter never shared is the same class of defect —
   a claim the model cannot stand up, rendered to a candidate as provenance. Both live runs exit 0,
   so this did not cost AC #3. If #22 wants a softer gate it should say so explicitly.

4. **No README or DEPLOY entry.** The plan makes this conditional ("if the runbook needs the new
   script listed"). Neither file lists `npm run pack` or any generation script — DEPLOY is a
   deployment runbook (bindings, D1, migrations) and `gen:brief` is a dev-time seam exerciser with
   no deployment step. Both files are also being edited concurrently by the #17 work (below), so
   touching them would risk a conflict for no gain.

5. **`src/prep/prompt.js` imports nothing.** The plan's GOTCHA says to import `cleanInput`/
   `INPUT_MAX` rather than write a second guard. The guard runs exactly once, in `generateBrief`,
   mirroring `generatePack` — so `cleanInput` is imported *there*, and the prompt builders take
   already-clean strings the way `src/prompt.js`'s do. Importing `INPUT_MAX` into the prompt module
   without using it would have been the second definition the GOTCHA warns against.

Everything else is as specified. All Non-Goals hold: no migration, no D1 access, no Pages Function,
no paste path, no renderer. `src/pack.js`, `src/generate.js`, `src/render/*` and every existing test
are untouched; `src/provenance.js` gained one export and `verifyPack` was not refactored to use it.

## Issues encountered

**Another session is writing to this working tree concurrently — nothing here is committed yet.**
At the start of this run `git status` showed 4 untracked entries. It now also shows #17's portal
work in progress: modified `DEPLOY.md`, `README.md`, `public/_headers`, `src/store.js`,
`test/schema.test.js`, `test/store.test.js`, and new `functions/prep/`, `public/prep/`,
`src/portal/`, `scripts/purge.py`, `test/portal-*.test.js`, `migrations/0002_portal.sql`.
`package.json` now carries both my `gen:brief` line and their `purge:*` lines.

Consequences worth knowing before `piv-commit`:

- **The commit must be scoped by path.** `git add -A` would sweep #17's in-progress work into this
  PR. The files belonging to this ticket are: `src/prep/`, `scripts/gen-brief.js`,
  `test/prep-*.test.js`, `test/collection.test.js`, `test/fixtures/prep-*`, `src/provenance.js`,
  `.claude/plans/candidate-brief-generation-seam.md` and this report.

- **`package.json` is the one file both tickets edited**, so it cannot be staged whole: it now
  carries `gen:brief` (mine) *and* `purge:preview` / `purge:remote` (#17's), and committing it as-is
  would ship two npm scripts pointing at `scripts/purge.py`, which is not in this PR. `git add -p`
  is interactive and unavailable in this harness. These three commands stage **only** the
  `gen:brief` line and leave the working tree untouched — verified during this run:

  ```bash
  git cat-file -p HEAD:package.json | python3 -c "
  import sys; s = sys.stdin.read()
  s = s.replace('\"pack\": \"node scripts/pack.mjs\",',
                '\"pack\": \"node scripts/pack.mjs\",\n    \"gen:brief\": \"node scripts/gen-brief.js\",')
  sys.stdout.write(s)" > /tmp/package.gen-brief-only.json
  SHA=$(git hash-object -w /tmp/package.gen-brief-only.json)
  git update-index --cacheinfo 100644,$SHA,package.json
  ```

  Then commit with explicit paths (never `-a`, never `-A`), and check `git diff --cached
  package.json` shows exactly one added line before doing so. If `piv-commit` cannot be held to
  explicit paths, the fallback is to leave `package.json` out of this commit entirely and add
  `gen:brief` in a follow-up once #17 lands — `scripts/gen-brief.js` runs directly either way.
- **The baseline moved mid-run.** Before their edits, `npm test` was 236 tests / 3 fail — all three
  in `test/schema.test.js`, failing on `migrations/0002_portal.sql`. Their update to that file
  resolved all three. The suite is green now for a reason that is theirs, not mine; the honest
  statement is that **this ticket introduced zero failures**, not that it turned the suite green.

**Live-call cost.** Two real `claude-opus-5` calls were made against the key in `.dev.vars`, as
Level 4 requires. Roughly 5k input + 8.9k output and 5k input + 7.5k output at $5/$25 per MTok —
about 50p in total.

**Hosting decision taken mid-ticket, recorded for #21 and #22.** The owner decided during this run:
*"for this MVP we can host the candidate prep portal on the same host and locally as well."* That
supersedes portal architecture **decision 20**, which currently reads `prep.<deployment-domain>` —
the portal ships on the existing Pages deployment and runs locally, with no subdomain to provision.
Nothing in #19 changes: this ticket ships a module, not a route, a host or a URL. It is recorded
here rather than in the architecture doc for the same reason the plan records the superseded
`functions/api/generate.js:5-9` comment — amending the doc is the call of the ticket that acts on
it, which is **#22**. #21 and #22 should not rediscover this while wiring the portal.

## Ready for the next step

All tasks complete, all validation commands run, all four acceptance criteria met — AC #3 verified
by a real run rather than asserted. Next: `piv-commit` (scoped by path, per the note above), then
`piv-create-pr`, then `piv-review-pr`.
