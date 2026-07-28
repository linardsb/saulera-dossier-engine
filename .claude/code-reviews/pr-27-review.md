# Code review — PR #27 · the candidate prep-brief generation seam (#19)

**Branch** `feature/candidate-brief-generation-seam` → `main` · one commit (`9e936d6`) · 18 files, +3,211 / −0
**Reviewed at** `9e936d6`, which matches `origin/feature/candidate-brief-generation-seam`.

## Recommendation

**Approve** — 0 Critical, 0 High, 2 Medium, 5 Low. Nothing here blocks merge. The suite is green, the
commit is scoped correctly, the architecture citations check out verbatim, and the two safety rails the
epic rests on are genuinely structural rather than prompt-deep. This is unusually careful work.

Both Mediums are **contract gaps aimed at #22**, not defects in what ships today: one is a summary
function whose own doc comment points #22 at it as the Send gate while it counts only half of what
`verifyBrief` checks; the other is a runtime check that does not enforce the contract its file says it
enforces. Neither is reachable through today's decoder. Both become reachable the moment #17 persists
`brief_json` and #22 re-verifies a stored payload — the exact route `test/prep-verify.test.js:70-71`
already names. Worth closing before #21/#22 build on them; not worth holding the merge.

*(Posted as a comment rather than a formal approval: `gh` is authenticated as `linardsb`, the PR author,
and GitHub rejects self-approval. A human still makes the call.)*

## Rubric

There is no project `CLAUDE.md` and no `.claude/references/` in this repo, so the bar applied was:

1. the repo's own conventions as embodied in the pre-existing `src/generate.js`, `src/prompt.js`,
   `src/provenance.js`, `src/store.js`, `src/http.js`, `scripts/pack.mjs` — which `src/prep/*`
   deliberately mirrors;
2. the global standards **Simplicity First** and **Surgical Changes**;
3. `docs/epics/candidate-portal.architecture.md` §3, §5 and decisions 2/6/22, which the PR cites;
4. the plan and the implementation report. The report's five documented deviations were read and treated
   as **intentional decisions, not findings** — none is re-litigated below.

### Citations spot-checked, and they hold

- **§3** (`architecture.md:55-65`) — quoted word for word in `src/prep/schema.js:1-4`, including "There
  *is no* component that renders a finished answer in the candidate's voice, and no component that
  renders a score or rank."
- **Decision 6** (`architecture.md:33`) — "core set generated at Send and cached; lateral/vertical
  variants … live in-session." `assertBrief` permitting only `axis: "core"` while the schema keeps the
  full enum is a correct reading, not a liberty.
- **Decision 22** lists ten component names; `BLOCK_NAMES` ships five. **Not a finding** — the plan
  scopes it at lines 15-16 and argues it at line 957. The five omitted names are session-time
  components belonging to #23.
- **Decision 20** (`prep.<deployment-domain>`) is superseded by the owner's same-deployment call. Both
  the PR body and the report record it and correctly leave the doc amendment to #22.
- **Anthropic API surface** verified against current documentation rather than memory — every claim in
  the code's comments holds:
  - `MAX_TOKENS = 48_000` sits well inside Opus 5's **128K** output ceiling, and is above the ~16K
    threshold where streaming is required — which the module does (`client.beta.messages.stream`).
  - `thinking: {type: "adaptive"}` is correct, and thinking **is** on by default on Opus 5 (omitting
    the field runs adaptive; the explicit form is equivalent). `generate.js:86`'s comment is accurate.
  - `output_config.effort` is the right nesting — `effort` is not a top-level parameter.
  - `betas: ["server-side-fallback-2026-07-01"]` with **scalar** `fallbacks: "default"` is the correct
    matched pair. The array form uses the older `-2026-06-01` header, and pairing either header with
    the other form is a 400 — so `generate.js:94-95`'s "matched pair … change neither in isolation"
    warning is exactly right.
  - The **512-token** minimum cacheable prefix quoted for Opus 5 is correct (it is 1024 on Opus 4.8),
    so `generate.js:79-81` and `gen-brief.js:119-120` are both accurate.

  Nothing to flag.

## Validation

| Check | Command | Result |
|---|---|---|
| Test suite | `npm test` | **287 pass, 0 fail, 0 skipped** ✅ — matches the PR's claim exactly |
| Type check | — | n/a — plain ESM, no TypeScript, no typecheck script |
| Lint | — | n/a — no lint script; the plan's Level 1 is `node --check`, clean |
| Build | — | n/a — vanilla static + Pages Functions, no build step |
| Live seam run | `npm run gen:brief` | **not re-run** — real `claude-opus-5` spend. The PR's table (124.2s cold / 94.4s warm, 4,960 cached tokens, 12-of-12 and 10-of-10 quotes verified) is **author-reported evidence**, not independently reproduced. |
| Commit scope | `git show --stat HEAD` | 18 files, all #19's. **Nothing from the concurrent #17 work leaked in** — the path-scoped commit worked. |

Every finding below was reproduced empirically, not inferred from reading.

## Medium

### M1 — `briefSummary` counts only the competency half, but its comment points #22's send gate at it

`src/prep/verify.js:77-86`

The comment reads *"Counts for the script's output and for #22's send gate."* The function derives
`{sourced, unverified, total}` purely from `payload.competencies`. Panel-source failures — the note half
of §3, the half `verifyBrief` exists to add — contribute nothing.

**Reproduced.** Take the fixture payload, point **both** `blocks[2].props.panel[*].source_field_key` at a
note field the recruiter never shared. `verifyBrief` does its job — blanks both, emits two
`panel_source` failures:

```
clean summary:                    {"sourced":2,"unverified":1,"total":3}
all-panel-hallucinated summary:   {"sourced":2,"unverified":1,"total":3}
dirty failures kinds:             ["competency","panel_source","panel_source"]
```

The summary is byte-identical. A #22 implementer who wires the Send gate to `briefSummary` — as the
comment instructs — ships a button that goes green with every panel attribution hallucinated.
`scripts/gen-brief.js` escapes this only because it gates on `failures.length`, not on `provenance`.

**Fix** — a discriminating question, either answer is fine: add panel counts to `briefSummary`, or cut
"and for #22's send gate" from the comment and state that the gate is `failures`. Deviation 3 already
decided the gate covers both halves, which argues for the former.

### M2 — a wrong-typed block inside `CompetencyMap.children` passes `assertBrief`, and its provenance is never checked

`src/prep/schema.js:254-279` · `src/prep/verify.js:54-72`

`checkBlock` validates that a child's `name` is *in the vocabulary* and rejects a nested
`CompetencyMap` — but never asserts a child **is a `StoryBankCard`**. Only `nested && name === "CompetencyMap"`
throws. Separately, `verifyBrief` maps over top-level `payload.blocks` and returns early on anything
that is not a top-level `PanelBrief`; it never descends into `children`.

**Reproduced.** A `PanelBrief` pushed into `CompetencyMap.children` with
`source_field_key: "NOT-A-KEY"` → `assertBrief` **accepts** it, and `verifyBrief` returns
`failures: ["competency"]` only, no `panel_source`, with the invented key unblanked and unreported.
`PrimerCard` and `LogisticsRail` nest just as freely, `props` unchecked.

**Reachability: nil today.** `BRIEF_SCHEMA` pins `children.items` to `{$ref: "#/$defs/StoryBankCard"}`
with `name` a `const` and `additionalProperties: false`, so the decoder cannot emit this.

**Why fix it anyway.** This is a contract gap, not a hardening gap. `schema.js:15` says "its children are
StoryBankCard leaves" and `:266-267` says "this is the runtime half of that" — the runtime half does not
implement its own stated contract, in a file whose entire argument (`:8-11`) is that *"a rule living only
in the schema is an untested claim about a third party's decoder."* And the payload demonstrably does
not always arrive from the decoder: `test/prep-verify.test.js:70-71` names the other routes itself —
"the script's re-verify path, #22 re-verifying a stored payload." If it ever fires, `PanelBrief` is in
`BLOCK_NAMES`, so #21's registry renders it happily — source attribution and all, with provenance that
was never checked.

**Fix** — one line at `schema.js:274`: `if (nested && b.name !== "StoryBankCard") throw …`, replacing the
CompetencyMap-only guard.

*Same class, same fix:* `verifyBrief:55` skips verification entirely when `props.panel` is not an array,
and `assertBrief` never checks it. Decoder-guaranteed today.

## Low

### L1 — the panel demotion is not idempotent; a second verify pass destroys `failed_field_key`

`src/prep/verify.js:57-69`

`verifyPack` early-returns on `source_type === "unverified"`, so re-verifying a demoted pack is a no-op.
`verifyBrief` has no equivalent: a demoted entry has `source_field_key === ""`, `keys.has("")` is false,
so the second pass re-demotes and overwrites `failed_field_key` with `""`.

**Reproduced:**

```
pass1 failed_field_key: "their-processes"
pass2 failed_field_key: ""
competency failed_quote survives pass2: "the postholder must document every visit before t…"
```

The competency half is unaffected (`source_quote` is preserved, so `failed_quote` survives). What is lost
is precisely the diagnostic the comment at `:46-47` calls the reason a bad brief is diagnosable — on
exactly the re-verify path M2 also lands on.

**Fix**: skip anything already carrying `failed_field_key`, mirroring `verifyPack`.

### L2 — a missing `--brief` or `--cv` file exits 1, colliding with the script's own "not sendable" signal

`scripts/gen-brief.js:73-86`

`read(briefPath)` / `read(cvPath)` are evaluated *inside* the try, so an `ENOENT` is caught by the
`catch (err)` whose `err.code` branch was written for `StoreError`:

```
$ node scripts/gen-brief.js --brief /nonexistent/brief.md …
generation failed (ENOENT): ENOENT: no such file or directory, open '/nonexistent/brief.md'
EXIT=1
```

Exit 1 is this script's contract for "a claim did not verify"; every other input error exits 2 (lines 51,
59, 70). `scripts/pack.mjs:58-59` reads its inputs outside the try, so this diverges from the mirror — in
the safer direction, hence Low. **Fix**: hoist the two reads above the `try`.

### L3 — the script writes candidate-derived output into the repo root by default, and it is not gitignored

`scripts/gen-brief.js:43,90-92`

`--out` defaults to `"."`, so a bare `npm run gen:brief` writes `brief.json` — the full prep brief,
derived from a real CV, a real client brief and the client's privileged visible slice — into the repo
root. `.gitignore` covers only `node_modules/`, `.DS_Store`, `.wrangler/`, `.dev.vars`, `.dev.vars.*`.

`src/prep/generate.js:14-16` opens with *"⚠ Stateless with respect to candidates … written nowhere."*
That holds for the module, and the script is a dev-time exerciser — but the report itself warns this
working tree is shared with a concurrent session and that `git add -A` would sweep files in. For
contrast, `scripts/pack.mjs:43` derives its default from the input file's directory rather than the repo
root. **Fix**: default `--out` to `out/`, and add `out/` and `brief.json` to `.gitignore`.

### L4 — `visibleNoteBlock` interpolates headings into XML attributes without escaping

`src/prep/prompt.js:80-82`

`heading="${f.heading}"` is unescaped. Client-note headings are recruiter-written markdown H2s, so a
quotation mark is ordinary. **Reproduced:**

```
<field key="what-they-say" heading="What they mean by "autonomy"">
```

Not a security boundary — the note is the agency's own text — but it malforms the **cached prefix**, the
one block that has to stay byte-stable and well-formed across every candidate for that client.
`test/prep-prompt.test.js:108-109` asserts the attribute is present but never exercises a quote in a
heading. **Fix**: escape `"` in `heading`, and add a fixture heading that contains one.

### L5 — `effort` is the one request parameter left unpinned

`test/prep-generate.test.js:108`

`assert.ok(config.effort, …)` asserts truthiness only. Every other parameter in that file is pinned to an
imported constant or an exact value — and `effort` is the one with a direct latency and cost
consequence, called "the lever before the pack shrinks" at `src/generate.js:39-45`. A silent change to
`"low"` passes. **Fix**: import `EFFORT` alongside `MODEL` and `FALLBACK_BETA` from the same module and
assert equality.

## What's genuinely good

- **The safety rails are structural, and the tests were checked for whether they actually bite.**
  `test/prep-schema.test.js`'s three-group structure is the strongest thing in this diff: group 2 walks
  `BRIEF_SCHEMA` for answer/score-shaped property names, and **group 3 guards the walker itself** —
  every block variant reached, every `$defs` entry entered, more than 25 properties found. The
  degenerate pass (a walker returning `[]` satisfies "no property is answer-shaped" perfectly) is
  explicitly closed at lines 235-243. Verified independently by running the walker standalone: it does
  traverse `$defs`, reaches `$defs.StoryBankCard`, and reads 45 property names against its own floor.
- **No tautological assertions found.** `assert.equal(assertBrief(p), p)` is a return-identity check with
  the rejection cases carrying the weight, and every rejection test mutates a fixture the first test
  proves valid.
- **Enforcing the vocabulary twice is the right call, for the reason given** — the schema `const` is
  enforced by a third party's decoder where no test can reach it. Consistent with `assertPack`, not novel.
- **`test/collection.test.js` guards the instrument.** `npm test` is a single-level glob, so a test file
  one directory down never runs and the suite still reports green. Catching a failure mode whose
  signature is *silence* is worth more than most assertions in the diff.
- **Demote-never-drop is implemented as immutably as it is described.** `verifyBrief` clones all the way
  down, and `test/prep-verify.test.js:147-156` pins it at the three-levels-deep panel entry where
  in-place mutation would have been easiest.
- **The error taxonomy is right and ordered right.** `stop_reason` is checked *before* the text is parsed,
  so a truncation surfaces as `truncated` rather than a half-written brief. Shape bugs throw plain
  `Error`s, provenance failures demote, and `messageOf` at `prep-schema.test.js:36` actively asserts a
  shape bug is *not* a `StoreError`.
- **Privacy holds under an empirical check.** Zero `console.*` in `src/prep/`; `assertBrief`'s throw sites
  carry block names, competency ids, `axis`, `difficulty` — never `source_quote`, never CV text. The
  module has no `clientNote` parameter and no path to one. A plain `Error` escaping to HTTP is already
  handled: `src/http.js:56-58` answers `{error:"internal"}`, 500, leaking nothing.
- **The `note_empty` divergence is reasoned, not inherited** — `generate.js:66-71` argues from decision 2
  rather than copying `generatePack`, and `prep-generate.test.js:239-251` pins the divergence with the
  reasoning attached.
- **Genuinely surgical.** `src/provenance.js` gained exactly one export; `verifyPack` was correctly left
  alone, and `quoteAppears` was verified semantically identical to the inline check it mirrors, so the
  "one definition of literal" claim holds despite the deliberate non-refactor. All Non-Goals hold.
- **Fixtures are properly synthetic, including the CV.** Both `prep-brief.md` and `prep-cv.md` carry an
  explicit `# SYNTHETIC` marker and a "no real client, candidate, or trust" line — checked directly,
  because a CV is the most sensitive artifact this product touches and the one file where a real
  person's document could plausibly have been committed by accident.
- **The one non-negotiable a test suite cannot check holds on the material available.** SPEC's first
  rule is that no `skeleton` entry may be a sentence in the candidate's voice. The PR reports a human
  read ~60 entries across the two live runs — which cannot be re-verified here. But the **fixture**
  payload's entries can be, and were: all 12, across 3 `StoryBankCard`s, are headings the candidate
  fills in ("What you weighed before you acted", "What you changed when it did not respond"). None is
  a sentence in their voice; none contains an answer. That matters beyond the fixture — these are the
  entries `prep-schema.test.js` and `prep-verify.test.js` assert against, so a bad one would teach the
  wrong shape to #21 and to every future test written against it.

## Considered and rejected

- *`BLOCK_NAMES` (5) vs decision 22 (10)* — scoped and argued in the plan at lines 15-16 and 957.
- *`assertBrief` never validates `props` contents* — real (a `PrimerCard` with `props: {}` passes), but
  props shape is decoder-enforced and the AC `assertBrief` exists to enforce is the vocabulary plus the
  provenance-critical fields. Widening it is scope, not a defect.
- *`keys.has(undefined)` on a malformed field* — needs a #18 contract violation the decoder cannot
  produce; a guard would be error handling for an impossible scenario and would contradict the
  deliberate comment at `generate.js:58-60`.
- *The no-answer/no-score rail is prompt-enforced for free-text props* — true, but the PR concedes it
  explicitly at `prep-prompt.test.js:52-53`. Honest framing, not an overclaim.
- *`assertBrief` error messages embed model-generated strings* — model slugs, not candidate text, and
  `errorResponse` refuses to leak any message body.
- *Comment density* — the repo's established house style; see `src/generate.js`.
- *`verifyPack` not refactored onto `quoteAppears`* — deliberate, pinned by `test/provenance.test.js`,
  called out as a plan GOTCHA.

## The two forward-looking notes in the PR body

Both are correctly filed as *not this PR's problem*, and both deserve the next ticket's attention:

- **Latency.** ~124s at `effort: "high"` on fixtures *shorter* than a real JD and CV — so that is the low
  end. Architecture §6 already names dead air as a risk. #22 should decide the interaction pattern before
  wiring the CTA rather than discovering this during it.
- **The strict send gate.** `gen-brief.js` exits 1 on a `panel_source` failure, not only a competency
  quote (documented deviation 3). Defensible, and #22 owns whether the real gate stays this strict — see
  M1, which is the same question from the other end.

---

*Review method: fresh context, not the session that wrote the code. Deep pass dispatched to a review
agent — note that `.claude/agents/code-reviewer.md` does not exist in this repo, so a `general-purpose`
agent was used with the rubric above. Findings from both passes were reproduced independently before
being reported.*
