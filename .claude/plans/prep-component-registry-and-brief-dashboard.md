# Feature: component registry + prep-brief dashboard (fixed shell, agent blocks)

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

## Feature Description

The candidate's landing surface, and the renderer underneath it.

Two things ship together because neither is testable without the other:

1. **A component registry** — `public/prep/registry.js`, a vanilla ES module mapping a block `name` to
   a hand-built DOM constructor, one entry per name in the pilot vocabulary (decision 22):
   `PrimerCard`, `CompetencyMap`, `QuestionCard`, `HelpLadder`, `FeedbackNote`, `ProgressStrip`,
   `PanelBrief`, `StoryBankCard`, `LogisticsRail`, `DayBeforeMode`. Plus `renderBlocks(payload, mount, ctx)`,
   which walks `{name, props, children}` and calls the constructors. A name that is not in the registry is
   reported to the console and skipped — never injected, never rendered as raw markup.
2. **The prep-brief dashboard** — `public/prep/brief.html` + `brief.js` + `prep.css`, which fetches a
   stored `brief_json` payload and renders it end to end in the dossier design system.

This is the A2UI *pattern* and not the A2UI *stack*: a JSON contract in, developer-owned components out,
with the frontend owning every pixel (`docs/epics/agentic-ui-research-notes.txt`). No React, no
CopilotKit, no build step. The registry is what makes architecture §3's claim structurally true rather
than a prompt instruction — there is no constructor that can render a finished answer in the candidate's
voice, and none that can render a score or a rank, because no such constructor exists.

Five of the ten names (`PrimerCard`, `CompetencyMap`, `PanelBrief`, `StoryBankCard`, `LogisticsRail`) are
already contracted by #19's `BRIEF_SCHEMA` and arrive in the brief payload. The other five
(`QuestionCard`, `HelpLadder`, `FeedbackNote`, `ProgressStrip`, `DayBeforeMode`) are session-time blocks
that #23/#24/#25 will emit; their props contracts are **decided here**, with specimen fixtures, so those
tickets inherit a file rather than a memory.

## User Story

As a candidate who has just been invited to prepare for an interview
I want one screen that tells me what this role is really testing, who I am likely to meet, and which of my own stories to bring
So that I walk in prepared on what this agency actually knows about the client, not on the public job ad

## Problem Statement

#19 produces a validated JSON payload and nothing renders it. The payload is deliberately declarative —
`{name, props, children}` over a closed vocabulary — because the alternative (a model emitting HTML) is
the open-ended generative UI the research notes call out as a security and brand problem, and because a
closed vocabulary is the only version of "no component can render a finished answer" that a test can
reach.

But a declarative contract with no renderer is half a mechanism. Right now the safety rail exists on the
way *out* of the model (`assertBrief`) and nowhere on the way *into* the page. And the candidate's first
screen is where the pilot is won or lost: it is the first thing they see after clicking a magic link, and
if it reads as a wall of generated text rather than as something built for them, nothing downstream
recovers it.

## Solution Statement

A registry object keyed by block name, one hand-built constructor per name, each producing DOM nodes
through `document.createElement` and `textContent` only — the rule `public/app.js:869` already states for
model output. `renderBlocks` walks the payload, looks each name up, and calls the constructor; a miss is a
`console.warn` and a skip, reported back in the return value so the caller can show an honest empty state.

The dashboard is a static page in the shape `public/prep/privacy.html` already established: same head,
same stylesheet chain, same candidate-facing topbar with no recruiter navigation. It fetches
`public/prep/brief.fixture.json` — a payload derived from #19's own test fixture through `verifyBrief`,
so the screen is exercised against real contract output rather than against something hand-written to
render well.

Provenance renders on the candidate's screen the way it renders on the recruiter's: the word, never
colour alone, never behind a hover. With one deliberate difference, argued in NOTES: a **failed** quote's
text is never shown to a candidate.

## Out of Scope / Non-Goals

- **Not included: any network call to a model.** The dashboard renders a stored payload. The session
  engine (#23) and the drill UI (#24) own every live call.
- **Not included: auth.** #20 owns the magic link and the token gate. `brief.js` fetches a static fixture
  path held in one constant, with a comment naming the endpoint that replaces it.
- **Not included: persistence of anything.** `HelpLadder` exposes an `onRung` hook and calls it; it writes
  no `attempt` row and touches no storage. `mode: recall|nudged|revealed` logging is #23's.
- **Not included: the session shell** (prime → drill → close), resume, targeting, readiness, habits, the
  day-before *flow*. `DayBeforeMode` here is a block that renders from props; #25 owns when it appears.
- **Not included: streaming or staged reveals.** Decision 19 is request/response for the pilot, and the
  Quantum interviewer/you bubbles are #24's drill surface. **Nothing in this ticket animates.**
- **Not changing: `src/prep/*`.** The schema, prompt, verifier and generator are #19's and land unmodified.
  If the registry needs a schema change, that is an Open Question, not an edit.
- **Not changing: `public/app.js`, `public/app.css`, `public/index.html`, `public/clients.*`.** The
  recruiter screens are a different audience and a different door. `prep.css` *supplements* `app.css`.
- **Not included: pressure mode, timing accommodations** (decision 21 defers them post-pilot).

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: Medium-High (breadth: ten components; the risk is scope, not difficulty)
**Primary Systems Affected**: `public/prep/` (new renderer + new page), `test/` (new suite + new helper)
**Dependencies**: none new. Zero runtime dependencies is a repo constraint — `node --test`, no linter,
no bundler, no DOM library.

## Related Work

**Implements**: [#21](https://github.com/linardsb/saulera-dossier-engine/issues/21) · **Epic**:
[#16](https://github.com/linardsb/saulera-dossier-engine/issues/16), architecture
`docs/epics/candidate-portal.architecture.md` (§3, decisions 8, 21, 22)

**Back-references**:

- `.claude/plans/candidate-brief-generation-seam.md` (#19) — Why: the payload this renders. Its
  `BLOCK_NAMES`, `assertBrief` and `verifyBrief` are the contract; do not re-decide them.
- `.claude/plans/portal-schema-retention-gdpr.md` (#17) — Why: `candidate_role.brief_json` is the column
  this page will eventually read from, and `functions/prep/_middleware.js` runs on every request to this
  page.
- `.claude/plans/per-field-candidate-visible-toggle.md` (#18) — Why: `source_field_key` on `PanelBrief`
  entries is that ticket's stable slug; the verifier already resolved it before this renderer sees it.
- `.claude/plans/ux-ui-uplift.md` (#8) — Why: `tokens.css`, `app.css` and `test/tokens.test.js` are that
  ticket's; this one adds no colour to them.

**Forward-references**:

- #23 (session engine) — inherits the `QuestionCard` / `FeedbackNote` / `ProgressStrip` props contracts
  and `test/fixtures/prep-session-blocks.json`.
- #24 (drill UI) — imports `REGISTRY` and `renderBlocks` from this module; owns the session shell.
- #25 (day-before mode) — inherits the `DayBeforeMode` props contract.
- #22 (Send to Candidate) — replaces the fixture path in `brief.js` with the token-gated endpoint.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `src/prep/schema.js` (whole file, 325 lines) — Why: **the contract**. `BLOCK_NAMES` at :21-27 is the
  brief-time half of the vocabulary; the `BLOCKS` map at :70-137 is the exact props shape of each of the
  five, including which nests; `assertBrief` at :225-324 is what already ran server-side, so the renderer
  does not repeat it.
- `src/prep/verify.js` (whole file, 121 lines) — Why: what the payload looks like **after** verification,
  which is what gets stored and therefore what gets rendered. `verified: true|false`, `failed_quote`,
  blanked `source_field_key` + `failed_field_key` (:33-78). `briefSummary` (:102-120) is the counts shape.
- `public/app.js` (lines 831-980) — Why: **the pattern this registry mirrors**. `displayQuote` (:835-837),
  `markFor` (:841-848), `claimNode` (:850-902), `sectionNode` (:904-916), `renderPack` (:918-979). Note
  :869-870 — `textContent`, never an HTML-parsing assignment, because this is model output.
- `public/app.js` (lines 44-60) — Why: the `COPY` object idiom. Every visible string lives in one object
  at the top of the file, which is what makes the humanizer pass a single-file review.
- `public/prep/privacy.html` (whole file, 140 lines) — Why: **the page shape to copy exactly**.
  `lang="en-GB"`, `noindex, nofollow`, the `/fonts.css` → `/tokens.css` → `/app.css` chain, the
  page-scoped `<style>` block with its "tokens only" comment (:12-37), the candidate topbar with no
  recruiter nav (:41-47), `.page-head` + `.page-sub`, and `<section aria-labelledby="...">` (:57-62).
- `public/tokens.css` (whole file, 93 lines) — Why: every value comes from here. Type ramp :47-53,
  provenance colours + their measured ratios :56-68, spacing :71, `--tap-target` :80, focus :91-92.
- `public/app.css` (lines 1-9, 62-77, 726-870) — Why: the header states the no-raw-values rule; :71-77 is
  the ONE focus rule for everything (do not write a second); :805-821 are the `.mark` classes and
  :828-844 the `.claim-unverified` / `.claim-failed` treatments this page reuses; :866-870 is a global
  reduced-motion kill switch that `prep.css` inherits for free.
- `test/tokens.test.js` (whole file) — Why: the contrast gate. `PAIRINGS` at :75-87 is the list any new
  colour must join. The file-parsing idiom (:23-33) is the model for `prep.css`'s discipline test.
- `test/prep-schema.test.js` (lines 1-60) — Why: the test-file header idiom, and :47-52 carries a warning
  written *for this ticket*: "#21 builds its registry from `BLOCK_NAMES`, so a sixth name renders as
  nothing at all rather than as an error." Task 4 closes that.
- `test/helpers/fake-d1.js` (lines 1-30) — Why: the precedent for a hand-rolled test double, and its
  header states the discipline — it does not pretend to be the real thing. `test/*.test.js` does not glob
  into `test/helpers/`, so a helper is never collected as a suite.
- `test/prep-verify.test.js` (lines 1-30, 160-170) — Why: :9 records that in `test/fixtures/prep-payload.json`
  two competency quotes are literal spans of `prep-brief.md` **and the third is a paraphrase**, and
  :163-167 pins the resulting counts. That third competency is why the shipped fixture renders a
  demotion by construction. Do not "fix" it.
- `test/fixtures/prep-payload.json` — Why: the source payload. `test/fixtures/prep-brief.md` and
  `test/fixtures/prep-visible-fields.json` are the verification inputs.
- `functions/prep/_middleware.js` — Why: `purgeExpired` runs on **every** `/prep/*` request including
  static assets, so `brief.html` and the fixture trip it. Guarded on `env.DB`. A console line in dev is
  that middleware working, not a bug in the new page.
- `public/_headers` — Why: `/prep/*` already carries `X-Robots-Tag: noindex`. No change needed.
- `.claude/skills/dossier-design/references/CRAFT.md` — Why: the numeric rules. Read before writing CSS.
- `.claude/skills/dossier-design/references/CHECKLIST.md` — Why: the MUST/SHOULD/NEVER gate. Run before
  commit.
- `docs/epics/candidate-portal.architecture.md` (§3, decisions 21, 22) and
  `docs/epics/interview-prep/SPEC.md` (the answer loop :66-81, readiness ladder :97-118, habits :130-144,
  tone :181-189) — Why: the session components' props are derived line by line from these.

### New Files to Create

- `public/prep/registry.js` — the component registry and `renderBlocks`. ES module.
- `public/prep/brief.html` — the dashboard page.
- `public/prep/brief.js` — fetch the payload, mount it, own the loading/empty/error states. ES module.
- `public/prep/prep.css` — page-scoped rules for the portal surface. Supplements `app.css`.
- `public/prep/brief.fixture.json` — the stored `brief_json` this page renders until #22 wires the real one.
- `test/helpers/dom.js` — a minimal document double. Bounded; see the TESTING STRATEGY table.
- `test/fixtures/prep-session-blocks.json` — specimen props for the five session-time blocks.
- `test/prep-registry.test.js` — the suite.

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

External reading is thin on purpose: the whole point of the A2UI *pattern* over the A2UI *stack* is that
no library is involved. What matters is platform behaviour.

- [MDN — JavaScript modules, `<script type="module">`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules#applying_the_module_to_your_html)
  - Specific section: applying the module to your HTML.
  - Why: modules are deferred by default and run in strict mode; relative specifiers need the `./` prefix
    and the full `.js` extension in the browser. This is why `registry.js` can be imported by `node --test`
    with no build step.
- [MDN — `Node.textContent`](https://developer.mozilla.org/en-US/docs/Web/API/Node/textContent#differences_from_innerhtml)
  - Specific section: differences from innerHTML.
  - Why: the security argument the no-injection test enforces, stated by the platform.
- [WAI-ARIA APG — Disclosure pattern](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/)
  - Specific section: keyboard interaction and `aria-expanded`.
  - Why: `HelpLadder`'s two rungs are disclosures. A native `<button>` with `aria-expanded` needs no key
    handlers at all, which is the whole reason to use one.
- [WAI-ARIA APG — `region` / landmark usage](https://www.w3.org/WAI/ARIA/apg/practices/landmark-regions/)
  - Specific section: when a `<section>` becomes a landmark.
  - Why: a `<section>` gains the `region` role only once it has an accessible name — which is exactly
    what `aria-labelledby` gives it, and what "semantic landmarks" in decision 21 means here.
- [MDN — `<progress>` and `role="progressbar"`](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Roles/progressbar_role)
  - Why: read it in order to **not** use it. See the `ProgressStrip` gotcha.

### Patterns to Follow

**Module format.** `src/**` is ESM (`"type": "module"`). `public/**` currently is not — `app.js` and
`extract.js` are classic scripts with an IIFE and a `window.DossierExtract` global, and say so. **This
ticket diverges, for one reason: the AC requires asserting the registry's export surface in a test, and
an IIFE has no export surface.** `<script type="module">` needs no build step and no polyfill. State the
divergence in `registry.js`'s header comment the way `extract.js:25` states its own idiom.

**File headers.** Every file in this repo opens with a comment explaining why it exists and which decision
it implements, in prose. Match the density — see `src/prep/schema.js:1-15` or `public/app.js:1-42`.

**DOM construction, from `public/app.js:850-902`:**

```js
function claimNode(claim) {
  var block = document.createElement("div");
  block.className = "claim";
  if (mark.cls === "mark-failed") block.classList.add("claim-failed");
  // textContent, never an HTML-parsing assignment. This is model output rendered into the page.
  text.appendChild(document.createTextNode(String(claim.text || "")));
  ...
  return block;
}
```

Every constructor in the registry has this shape: build, fill with `textContent` / `createTextNode`,
return the node. It never touches the document outside its own subtree, and it never returns a string.

**Copy, from `public/app.js:47`:** one `COPY` object at the top of the file holds every visible string.

**Page-scoped CSS, from `public/prep/privacy.html:12-37`:** a `<style>` block for rules that belong to one
page, tokens only, with the reason in a comment. `prep.css` exists because the portal has more than one
page coming (#24, #25) and the block rules are shared; anything that is genuinely `brief.html`-only can
stay in the page.

**Provenance marks, from `public/app.css:805-821` and `public/app.js:841-848`:** the mark carries a WORD.
Reuse the existing `.mark`, `.mark-unverified` classes rather than inventing a parallel set.

**Test headers and grouping, from `test/prep-schema.test.js:1-15`:** the header states what each group
proves and in what order of fragility. Groups are separated by `/* ── group N ── */` rules.

**Guarding the guard, from `test/tokens.test.js:110-140` and `test/prep-schema.test.js`:** where a test
walks a structure, a further test asserts the walker actually reached the thing. A branch the walker
cannot read is invisible rather than failing.

**Naming a forbidden API, from `public/app.js:19-21`:** *"Written without the API names on purpose: the
Level 1 gate greps this file for them, and a gate that cries wolf at a comment gets deleted."* This repo
has hit the collision twice — `app.js` solved it by convention, and
`.claude/plans/candidate-brief-generation-seam.md`'s AMENDMENTS records a Level 1 grep being **dropped**
because it fired on the comment the plan itself mandated. Both resolutions are in play here and each gate
below says which one it uses:

- **In prose and comments inside `public/prep/*.js`: describe the API, never name it.** Write "never an
  HTML-parsing assignment" (`app.js:869`'s exact phrasing) rather than the property name; write "no
  browser storage of any kind" rather than the four API names. This is what keeps the Level 1 shell
  one-liners honest, since a shell grep cannot strip comments cheaply.
- **In tests: strip comments before matching**, as `test/schema.test.js:38` does. Groups 2 and 10 do the
  scanning that actually gates the commit, and they must not be satisfiable by rewording a comment.

---

## IMPLEMENTATION PLAN

### Phase 0: Branch from the right base

**Local `main` is stale** — it sits at `5a7f754`, before #17/#18/#19 landed. `origin/main` is at `7344a6e`
and has `src/prep/*` and `public/prep/privacy.html`. Verify rather than assume, then branch off
`origin/main`. Do the work in a **new worktree**: the current one is on #18's already-merged branch, and
memory records that parallel sessions move HEAD under you.

### Phase 1: The registry

The whole of `public/prep/registry.js`, all ten constructors plus `renderBlocks`. It has no dependencies
and nothing depends on it yet, so it is built and tested before a page exists to host it.

**Tasks:** the name lists; the shared helpers (`el`, `section`, `mark`, `list`); the five brief-time
constructors; the five session-time constructors; `renderBlocks`.

### Phase 2: The test harness

**Depends on:** Phase 1 (the harness is shaped by exactly which operations the constructors call).

**Tasks:** `test/helpers/dom.js`; `test/fixtures/prep-session-blocks.json`; `test/prep-registry.test.js`.

### Phase 3: The dashboard page

**Depends on:** Phase 1. **Independent of:** Phase 2 — the suite and the page can be built in parallel by
two agents if that is useful; they touch disjoint files and meet only at `npm test`.

**Tasks:** derive `brief.fixture.json`; `brief.html`; `brief.js`; `prep.css`.

### Phase 4: Gates

**Depends on:** Phases 2 and 3.

**Tasks:** the CSS-discipline and no-injection source tests; the fixture-derivation test; the full
CHECKLIST pass; Level 4 manual sweep in real Safari and real Chrome at 360px and with the keyboard only.

---

## RISKS AND THEIR SCOPED FIXES

Read this before executing. Each risk below has a fix that is deliberately **bounded**: the "Bound" line
is what the fix must not grow into, because every one of these mitigations is the kind that quietly
doubles a ticket if left open-ended. The "Tripwire" line is how you find out the fix failed, and the
"Owner" is the task that carries it — the fix is not a separate work item.

### R1 — The fake DOM grows into a browser

**Goes wrong:** a helper stretched far enough to "prove" keyboard operability or focus order hands this
ticket a green tick on the one AC it cannot actually check. `test/helpers/fake-d1.js:3-5` warns against
exactly this shape of self-deception.

**Scoped fix:** the mechanism table in TESTING STRATEGY assigns every AC to a mechanism before a test is
written. `test/helpers/dom.js` implements six operations — `createElement`, `createTextNode`,
`appendChild`, `setAttribute`, `className`/`classList.add`, `textContent` — plus `serialize`, `textOf`,
`findAll` for reading.

**Bound:** no event dispatch, no focus model, no layout, no `getComputedStyle`, no selector engine, no
`ownerDocument` graph. `HelpLadder`'s rung test calls the handler directly rather than simulating a click.
Target ~110 lines; at 200 the helper has already become the thing it was avoiding.

**Tripwire:** a test that cannot be written without a seventh operation. That test belongs in Level 4 —
move it, do not extend the helper.

**Owner:** `CREATE test/helpers/dom.js`.

### R2 — A rank reaches the candidate's screen while passing review

**Goes wrong:** `role="progressbar"`/`aria-valuenow` on `ProgressStrip` reads as correct semantics and
exposes a numeric rank to assistive technology; `competency.importance` (1–5) is a second numeric field
that renders as a score whatever it measures. Both violate decision 22 and SPEC:99 invisibly to a visual
review.

**Scoped fix:** two GOTCHAs in the constructor tasks (importance renders as **order only**), and test
group 7 runs its scan over the **whole** rendered output of both fixtures rather than over one component.

**Bound:** the scan is a fixed regex list — `aria-valuenow`, `progressbar`, `<progress`, `%`,
`/level|of \d/i`, a bare `n/5`. It is not a semantic review of the copy, and it does not grow into one; the
copy is the humanizer pass's job at Level 5.

**Tripwire:** group 7 red, or any numeral in the rendered output that is not part of a competency label.

**Owner:** the two constructor tasks and `CREATE test/prep-registry.test.js` group 7.

### R3 — A gate fires on the comment the plan itself mandated

**Goes wrong:** the Level 1 greps hit the explanatory headers this plan requires, and the implementer
weakens the gate rather than the comment. This repo has hit it twice already — `public/app.js:19-21`
solved it by convention, and `.claude/plans/candidate-brief-generation-seam.md`'s AMENDMENTS records a
Level 1 grep being dropped for it.

**Scoped fix:** one resolution per gate, already written into Patterns to Follow and Level 1. Shell gates
rely on the "describe the API, never name it" convention inside `public/prep/*.js`; test gates strip
comments before matching, as `test/schema.test.js:36-39` does. The raw-hex gate is a test only.

**Bound:** comment-stripping is two regexes over the file text. No parser, no AST, no build step.

**Tripwire:** a gate going red on a line that is only a comment. If that happens, fix the comment's
phrasing or move the gate into a comment-stripping test — never loosen the pattern.

**Owner:** Level 1, and test groups 2 and 10.

### R4 — The work starts on the wrong base

**Goes wrong:** local `main` is stale at `5a7f754` with no `src/prep/` at all, so every import in the new
suite fails with `ERR_MODULE_NOT_FOUND` and the cause is not obvious from the error.

**Scoped fix:** Phase 0 branches from `origin/main` after `git fetch`, with a verification command that
lists `src/prep/` before any code is written.

**Bound:** one fetch, one worktree, one branch. No rebasing of other branches, no merging, no touching the
shared stash stack.

**Tripwire:** `ls src/prep` is empty, or `npm test` fails before a single new file exists.

**Owner:** `UPDATE the working tree`.

### R5 — Ten components is breadth, and five of them have no schema behind them

**Goes wrong:** the five session-time constructors are the largest uncontracted surface in this ticket.
Nothing fails today if their props are over-designed, and #23/#24/#25 then inherit chrome they did not
ask for — or diverge from it, which is worse, because the fixture stops describing anything real.

**Scoped fix — this one is an actual scope cut, not just a check.** Each session-time constructor renders
the **minimum that proves the contract**: the props, in semantic markup, under the shared block heading.
No session chrome, no empty states, no counters, no icons, no per-component layout beyond the shared
`.block` rules. Each carries a doc comment marking its props **provisional until #23/#24/#25**, naming
which ticket settles it and pointing at `test/fixtures/prep-session-blocks.json` as the artifact to amend.

**Bound:** roughly 25–40 lines per session constructor, against the brief-time ones which carry the real
rendering weight. `HelpLadder` is the single exception and the only interactive component in the ticket:
two native disclosures, nothing else. If a session constructor wants a prop that is not in the specimen
fixture, that is an amendment to this plan, not an addition to the file.

**Tripwire:** a session constructor exceeding ~40 lines, or a `prep.css` rule that exists only to style
one session block.

**Owner:** `ADD the five session-time constructors`.

### R6 — `prep.css` becomes a second `app.css`

**Goes wrong:** the portal surface is new, so every component looks like it needs a rule, and the file
ends up restating buttons, fields, marks and focus that `app.css` already ships and that the page already
links.

**Scoped fix:** `prep.css` supplements and never restates. Its header names what already exists upstream.
It holds the page measure, `.block` / `.block-head`, the per-component rules, `.help-panel[hidden]`, and
the 360px pass.

**Bound:** no rule whose selector is already in `app.css`, no new colour without a `tokens.css` entry and
a `PAIRINGS` row in the same commit, nothing that animates. Target ~200 lines.

**Tripwire:** a selector that exists in both files, or a raw hex or px surviving test group 10.

**Owner:** `CREATE public/prep/prep.css`.

### R7 — The demo fixture drifts from #19's contract

**Goes wrong:** `public/prep/brief.fixture.json` is hand-edited to render better, and the page then
demonstrates a payload the generator cannot produce.

**Scoped fix:** test group 9 asserts the shipped file deep-equals `verifyBrief(assertBrief(payload), …)`
over #19's own fixtures. Derivation is done by script, never by hand.

**Bound:** the test compares two objects. It does not re-implement verification and does not assert
anything about content.

**Tripwire:** group 9 red — which means either the fixture was edited or `src/prep/` changed under it.
Both are worth stopping for.

**Owner:** `CREATE public/prep/brief.fixture.json` and test group 9.

### Stop rule — what gets cut first if this runs long

In order. Everything above the line can be dropped to a follow-up without breaking an AC; nothing below
it can be dropped at all.

1. `DayBeforeMode`'s specimen richness — one specimen block, minimum props.
2. The `README.md` paragraph (AC #8's other half still holds via the tests).
3. Level 5's optional passes, recorded as not-run rather than silently skipped.
4. `prep.css`'s 360px refinements beyond "no horizontal scroll".

— never cut —

5. The export-surface test, the no-injection scan, the rank scan, the fixture-derivation test. These four
   are the ACs that make the vocabulary a safety rail rather than a claim; a ticket that ships the
   components without them has shipped the opposite of what it was for.
6. The Level 4 keyboard and focus sweep. No test in this plan covers it, by design (R1), so skipping it
   leaves AC #7 unevidenced.

If a cut is taken, record it in AMENDMENTS with the reason — a silent cut reads as coverage.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

### UPDATE the working tree — branch from `origin/main`

- **IMPLEMENT**: `git fetch origin`, confirm `git ls-tree --name-only origin/main src/prep/` lists
  `generate.js prompt.js schema.js verify.js`, then create a worktree on a fresh branch off `origin/main`:
  `git worktree add ../saulera-worktrees/prep-component-registry -b feature/prep-component-registry origin/main`.
  Work there. `node_modules` is a symlink in the sibling worktrees; mirror that.
- **PATTERN**: `git worktree list` shows the existing three.
- **GOTCHA**: branching from local `main` gives you a tree with no `src/prep/` at all and every import in
  the new suite fails with `ERR_MODULE_NOT_FOUND`. Never bare `git stash` in a shared stack (see memory).
- **VALIDATE**: `git log --oneline -1 && ls src/prep && npm test`
- **SATISFIES**: precondition for every AC.

### CREATE `public/prep/registry.js` — the name lists and the module header

- **IMPLEMENT**: The header comment: what this is (decision 8's declarative blocks, the A2UI pattern not
  stack), why it is an ES module when `public/app.js` is not (the export-surface AC), and the one rule the
  walker applies (unknown name → warn and skip; nesting and shape are `assertBrief`'s job, server-side).
  Then two exported arrays and the frozen registry key order:

  ```js
  /** The five #19 emits. Retyped rather than imported: `src/` is not served to the browser
   *  (Pages' build output is `public/`), so an import of ../../src/prep/schema.js would 404 at
   *  runtime. test/prep-registry.test.js imports BOTH and asserts they match, which is where the
   *  drift is actually caught — test/prep-schema.test.js:47-52 predicted this exact hole. */
  export const BRIEF_BLOCK_NAMES = ["PrimerCard", "CompetencyMap", "PanelBrief", "StoryBankCard", "LogisticsRail"];

  /** The five the session emits (#23/#24/#25). No schema behind them yet; this file is the contract. */
  export const SESSION_BLOCK_NAMES = ["QuestionCard", "HelpLadder", "FeedbackNote", "ProgressStrip", "DayBeforeMode"];
  ```

- **PATTERN**: `src/prep/schema.js:17-27` for the doc-comment register.
- **IMPORTS**: none. This module imports nothing — that is what makes it loadable by both a browser and
  `node --test`.
- **GOTCHA**: **no top-level reference to `document`, `window` or `fetch`.** A bare `const doc = document`
  at module scope throws on import under Node and takes the whole suite with it. Every document access
  happens inside a function, through the `doc` passed down.
- **VALIDATE**: `node --check public/prep/registry.js && node -e "import('./public/prep/registry.js').then(m=>console.log(Object.keys(m)))"`
- **SATISFIES**: AC #2 (export surface), AC #6 (registry importable by a test).

### ADD the shared helpers to `public/prep/registry.js`

- **IMPLEMENT**: Four small helpers every constructor uses, all taking `doc` as their first argument:
  - `el(doc, tag, className, text)` → an element, `textContent` set when `text` is given.
  - `section(doc, id, title, className)` → `<section class aria-labelledby=id-head>` containing
    `<h2 id=id-head class="block-head">title</h2>`. Returns `{ node, body }` so callers append into `body`.
  - `mark(doc, word, cls)` → `<span class="mark mark-…">word</span>`, mirroring `app.js:872-874`.
  - `lines(doc, items, className)` → `<ul>` of `<li>`, each `textContent` only.
  - `text(value)` → `String(value ?? "")`, and `displayQuote(value)` copied in spirit from
    `app.js:835-837` (whitespace collapsed **for display only**).
- **PATTERN**: `public/app.js:850-916`.
- **GOTCHA**: ids must be unique across a page that renders N blocks. `section()` takes an id the walker
  generates as `block-${index}` / `block-${index}-${childIndex}`, never a slug from model output.
- **VALIDATE**: `node --check public/prep/registry.js`
- **SATISFIES**: AC #1 (semantic landmarks), AC #3.

### ADD the five brief-time constructors to `public/prep/registry.js`

- **IMPLEMENT**: One function per name, signature `(doc, props, ctx, id) => Element`. `ctx` carries
  `{ competencies: Map<string, competency>, onRung }`.
  - **`PrimerCard`** — props `{role_shape, register, what_stage_one_tests}`. Three labelled paragraphs
    under one heading. Landmarks first, per SPEC's prime step.
  - **`CompetencyMap`** — props `{intro, competency_ids}` + `children`. Renders the intro, then one entry
    per id resolved through `ctx.competencies`: the `label`, and its provenance line — see the provenance
    task below. Then renders `children` through the same walker, so a `StoryBankCard` nested here is
    identical to one at the top level.
  - **`PanelBrief`** — props `{intro, panel[]}`, each entry `{who, what_they_probe, source_field_key}`.
    Renders `who` + `what_they_probe`; an entry carrying `failed_field_key` (or an empty
    `source_field_key`) gets the unverified mark instead of a source line.
  - **`StoryBankCard`** — props `{prompt, covers_competency_ids, skeleton[]}`. The `prompt`, the resolved
    competency labels it covers, and `skeleton` as a `<ul>` of **headings the candidate fills in**. Copy
    around it must say that: this is the shape of a story to find, not a story.
  - **`LogisticsRail`** — props `{when, format, bring, note}`. A definition list. An empty string means
    the material did not say, and renders as the honest line rather than as a blank row.
- **PATTERN**: `src/prep/schema.js:50-137` is the props contract, field by field, with the model-facing
  descriptions that explain what each field *is*. `public/app.js:850-902` is the construction pattern.
- **GOTCHA**: `StoryBankCard.skeleton` is headings, never sentences — `schema.js:61-66` spells out why. If
  the constructor's copy frames them as "your answer", it has broken the non-negotiable in the renderer
  even though the payload is clean.
- **GOTCHA — `importance` renders as ORDER ONLY.** Every resolved competency carries `importance: 1-5`, and
  `schema.js:156-158` permits it because it is "about the role, never about the candidate" — unlike a
  readiness level. But a numeral, a meter, a bar or a row of stars on the candidate's first screen reads as
  a score no matter what it measures, and `schema.js:86` already documents `competency_ids` as being "in
  priority order", so the ordering carries the weight for free. Render no numeral and no meter for it. The
  rank scan in test group 7 covers the whole rendered output for exactly this reason, not just
  `ProgressStrip`.
- **GOTCHA**: a `competency_id` that resolves to nothing is skipped with a `console.warn` and counted in
  the return value — the same policy as an unknown block name, not a second policy. `assertBrief` makes
  this unreachable server-side; the renderer is defensive by AC, so it is defensive symmetrically.
- **VALIDATE**: `node --check public/prep/registry.js`
- **SATISFIES**: AC #1, AC #6.

### ADD the provenance rendering to `public/prep/registry.js`

- **IMPLEMENT**: One helper, `provenanceNode(doc, competency)`:
  - `verified === true` → the quote, `displayQuote`d, in `.claim-source` with a caption naming the source
    in the candidate's words ("From the client's brief").
  - `verified === false` → the `.mark.mark-unverified` word and a plain-language line. **Never renders
    `failed_quote`.**
  - `verified === undefined` (an unverified-shaped payload that never went through `verifyBrief`) → treat
    as unverified. Fail closed.
  And the panel equivalent for `{source_field_key, failed_field_key}`.
- **PATTERN**: `public/app.js:841-848` (`markFor`) and `:880-899` (the failed-quote branch). `app.css:805-844`
  for the classes.
- **GOTCHA**: **the deliberate divergence from the recruiter screen.** `app.js:894-899` prints "Not found
  in the source: …" because a recruiter's next move is to check it. A candidate's next move would be to
  prepare against a sentence that is not in the brief — carrying our mistake into the room. The mark
  tells them the claim is our reading; the fabricated text stays off the screen. A test asserts the
  failed quote's text is absent from the rendered output.
- **GOTCHA**: the word, never colour alone (CHECKLIST MUST), never behind a hover or a collapsed
  disclosure (CHECKLIST MUST).
- **VALIDATE**: `node --check public/prep/registry.js`
- **SATISFIES**: AC #5.

### ADD the five session-time constructors to `public/prep/registry.js`

- **IMPLEMENT**: Same signature, and the **minimum that proves the contract** — see R5. Props in semantic
  markup under the shared block heading; no session chrome, no empty states, no counters, no icons, no
  per-component layout beyond the shared `.block` rules. Roughly 25–40 lines each, `HelpLadder` excepted.
  These props contracts are **decided here** — write the reasoning into the doc comment above each,
  because #23/#24/#25 inherit them, and mark each set **provisional** in that comment, naming the ticket
  that settles it and pointing at `test/fixtures/prep-session-blocks.json` as the artifact to amend:
  - **`QuestionCard`** — `{question, competency_label, difficulty}`. The question as an interviewer would
    ask it, a quiet caption naming the competency and the difficulty. `difficulty` describes the
    *question*; nothing here describes the candidate.
  - **`HelpLadder`** — `{nudge: string, structure: string[]}`. Two disclosures over the silent first
    rung (the attempt). `structure` is **an array of headings, exactly like `StoryBankCard.skeleton`** —
    a model structure the candidate fills in, per SPEC:74-75, and a shape that cannot hold a finished
    answer even if a future prompt tries. Native `<button aria-expanded>` + a hidden panel; on click,
    toggle and call `ctx.onRung?.("nudged"|"revealed")`. Persists nothing.
  - **`FeedbackNote`** — `{worked: string, improve: string}`. **Singular by construction**: SPEC:76-77 says
    one improvement, not five, and an array would structurally permit what the spec forbids.
  - **`ProgressStrip`** — `{covered: string[], queued: string[], note: string}`. Which competencies have
    been covered, which are queued, and one line of movement. SPEC:186 sanctions "competencies covered";
    SPEC:27 and architecture §3 forbid a level.
  - **`DayBeforeMode`** — `{intro: string, focus: string[], note: string}`. What to run through tomorrow
    and the one practical line. #25 decides when it appears.
- **PATTERN**: `src/prep/schema.js`'s `block()` doc-comments — say what the field is *for*, not just its
  type.
- **GOTCHA — the one that looks compliant and is not**: `ProgressStrip` must not use `<progress>`,
  `role="progressbar"`, `aria-valuenow`, a percentage, a meter, or "N of M". Reaching for a progressbar
  role to satisfy "semantic landmarks" exposes a numeric rank to assistive technology — the exact thing
  decision 22 and SPEC:99 forbid, hidden from a visual review. Movement is text.
- **GOTCHA**: `HelpLadder`'s panels start hidden with the `hidden` attribute. `app.css` has no
  `.help-panel { display: … }` author rule, so the UA's `[hidden] { display: none }` applies —
  but if `prep.css` gives the panel `display: flex`, the author rule wins and the panel is never hidden.
  `app.css:441-445` records this exact bug on `.visibility-list`. Use the same fix.
- **GOTCHA**: a prop these constructors want that is not in `test/fixtures/prep-session-blocks.json` is an
  amendment to this plan, not an addition to the file. The fixture and the constructors move together or
  the artifact #23 inherits stops describing anything real (R5).
- **VALIDATE**: `node --check public/prep/registry.js` — then check the bound:
  `awk '/^(function|const) (QuestionCard|FeedbackNote|ProgressStrip|DayBeforeMode)/,/^}/' public/prep/registry.js | wc -l`
- **SATISFIES**: AC #2, AC #4.

### ADD `renderBlocks` and the frozen `REGISTRY` to `public/prep/registry.js`

- **IMPLEMENT**:

  ```js
  export const REGISTRY = Object.freeze({ PrimerCard, CompetencyMap, PanelBrief, StoryBankCard,
    LogisticsRail, QuestionCard, HelpLadder, FeedbackNote, ProgressStrip, DayBeforeMode });

  /** Walk `{name, props, children}` and mount it. Returns what it did, so the caller can show an
   *  honest empty state rather than a blank page. */
  export function renderBlocks(payload, mount, ctx = {}) { … }
  ```
  - `doc = ctx.doc ?? globalThis.document`.
  - Build `competencies` once: a `Map` from `payload.competencies`, or pass through a `Map` if `ctx`
    already has one.
  - Walk `payload.blocks`; per block, look up `REGISTRY[block.name]`. A miss →
    `console.warn("prep registry: no component named " + name + "; skipped")`, push the name onto
    `skipped`, and **continue** — nothing is injected and no placeholder is rendered.
  - `children` recurse through the same lookup (`CompetencyMap` calls the walker for its own children).
  - Return `{ rendered, skipped, unresolved }` — counts and the offending names.
- **PATTERN**: `src/prep/schema.js:254-295` (`checkBlock`) walks the same tree server-side; mirror its
  traversal so the two read as one system.
- **GOTCHA**: `Object.freeze` is not a security boundary, it is a statement. The AC ("enforced by what
  exists") is satisfied by the *absence* of an answer-rendering constructor, and the test asserts the
  key set.
- **GOTCHA**: `mount.textContent = ""` before rendering, so a re-render replaces rather than appends.
- **VALIDATE**: `node --check public/prep/registry.js && node -e "import('./public/prep/registry.js').then(m=>{if(Object.keys(m.REGISTRY).length!==10)throw new Error('expected 10');console.log('ok')})"`
- **SATISFIES**: AC #2, AC #3, AC #6.

### CREATE `test/helpers/dom.js` — the bounded document double

- **IMPLEMENT**: `export function fakeDocument()` returning `{ createElement, createTextNode }`. An element
  carries `{ tag, attrs, classes, children }` and supports exactly what the registry calls:
  `appendChild`, `setAttribute`, `className` (setter), `classList.add`, and `textContent` as an accessor
  pair — the setter replaces children with one text node, the getter concatenates descendant text, as the
  real DOM does. Plus three module-level read helpers for assertions: `serialize(node)` (an HTML-shaped
  string), `textOf(node)`, `findAll(node, predicate)`.
- **IMPLEMENT**: `serialize` **must include attribute values and class names**, not only tags and text.
  Test groups 5 and 6 both rest on "this string appears nowhere in the output" — the unknown block name,
  and the failed quote's text. A serializer that drops attributes lets either of them slip through a
  `title`, an `aria-label` or a `data-*` and the two load-bearing assertions pass while the page leaks.
- **PATTERN**: `test/helpers/fake-d1.js:1-12` — including its honesty. Open with the same kind of header:
  this is not a browser, and the tests must not pretend otherwise.
- **GOTCHA**: **do not grow it.** The six operations above plus the serializer are the whole budget. A
  test that needs a seventh capability — layout, focus management, event dispatch, `getComputedStyle` —
  is testing something that belongs in Level 4 manual validation. A fake DOM rich enough to "prove"
  keyboard operability is a browser, and a fake green there is worse than no test.
- **GOTCHA**: `test/*.test.js` does not glob into `test/helpers/`, so this is never collected as a suite
  (`fake-d1.js:12` records the same).
- **VALIDATE**: `node --check test/helpers/dom.js && npm test`
- **SATISFIES**: enables AC #1, #3, #4, #5, #6.

### CREATE `test/fixtures/prep-session-blocks.json`

- **IMPLEMENT**: An array of five blocks in `{name, props}` form, one specimen per session-time name, with
  real copy in the product's voice (not `"foo"`). This file is the artifact #23/#24/#25 inherit.
- **PATTERN**: `test/fixtures/prep-payload.json` — real, plausible content from the same nursing scenario,
  so the two fixtures read as one candidate's course.
- **GOTCHA**: `HelpLadder.structure` must be headings. If the specimen contains a finished sentence in a
  candidate's voice, the fixture teaches #23 the wrong contract.
- **VALIDATE**: `node -e "JSON.parse(require('fs').readFileSync('test/fixtures/prep-session-blocks.json'))"`
- **SATISFIES**: AC #2, AC #4.

### CREATE `public/prep/brief.fixture.json` — the stored payload

- **IMPLEMENT**: Run `test/fixtures/prep-payload.json` through `assertBrief` then `verifyBrief` with
  `brief = test/fixtures/prep-brief.md` and `fieldKeys = test/fixtures/prep-visible-fields.json`'s keys,
  and write the resulting `payload` as pretty-printed JSON with a trailing newline. Do the derivation with
  a throwaway script; do not hand-write it.
- **PATTERN**: `scripts/gen-brief.js:111-113` writes the payload the same way.
- **GOTCHA**: **the output is deliberately not clean.** Verified against the real inputs it comes back
  `sourced: 2, unverified: 1` — `comp-documentation`'s quote is a paraphrase, recorded as intentional at
  `test/prep-verify.test.js:9`. That is the correct fixture to ship: the demo screen exercises the
  unverified path in its default state, which is the only way CHECKLIST's "unverified claims render
  visibly" MUST is shipped on evidence rather than on faith. Do not repair the quote.
- **GOTCHA**: it is synthetic content about a fictional nurse and a fictional client — safe to serve
  publicly. Do not replace it with anything derived from a real candidate.
- **VALIDATE**: `node -e "const p=JSON.parse(require('fs').readFileSync('public/prep/brief.fixture.json'));console.log(p.competencies.map(c=>c.id+'='+c.verified).join(' '))"`
  → expect `comp-lone-working=true comp-wound-management=true comp-documentation=false`
- **SATISFIES**: AC #5, AC #6.

### CREATE `public/prep/brief.html`

- **IMPLEMENT**: Copy `public/prep/privacy.html`'s head **exactly** — `lang="en-GB"`, `charset`, viewport,
  `noindex, nofollow`, favicon, then `/fonts.css` → `/tokens.css` → `/app.css` → `/prep/prep.css`. Same
  candidate topbar (brand only, no recruiter nav). `<main class="brief">` containing a `.page-head` with
  the role title placeholder and a one-line sub, a `role="status"` state line for loading/error, and an
  empty `<div id="blocks">` mount. `<script type="module" src="/prep/brief.js"></script>` at the end. A
  link to `/prep/privacy` in the footer region.
- **PATTERN**: `public/prep/privacy.html:1-56`.
- **GOTCHA**: `type="module"` is required, and module scripts are deferred — no `DOMContentLoaded` wrapper
  needed, and one is misleading.
- **GOTCHA**: the role title comes from the payload, so the `<h1>` starts with honest placeholder copy
  ("Your interview prep") and is filled in by `brief.js` with `textContent`.
- **VALIDATE**: served at `http://localhost:8788/prep/brief` and `/prep/brief.html` (Level 4).
- **SATISFIES**: AC #1, AC #6.

### CREATE `public/prep/brief.js`

- **IMPLEMENT**: An ES module. One `COPY` object at the top. One constant naming the data source:

  ```js
  /** #22 replaces this with the token-gated endpoint that reads candidate_role.brief_json.
   *  Until #20's auth lands there is nothing to gate on, and a page that renders a stored
   *  payload is exactly what the ticket asks for. */
  const SOURCE = "/prep/brief.fixture.json";
  ```
  `fetch` it, check `res.ok`, parse, check `Array.isArray(payload.blocks)`, set the `<h1>` from
  `role_title`, call `renderBlocks(payload, mount)`, then act on the return: zero rendered → the empty
  state; `skipped.length` → nothing visible changes (the console already carried it), because a candidate
  cannot act on "your portal is older than your brief". Network or parse failure → the error line, in
  plain language, with what to do next.
- **PATTERN**: `public/app.js:212-279` for `api`/`messageFor`/`showState`/`clearState`, and the
  `role="status"` state line at `index.html:108`.
- **GOTCHA**: **no storage of any kind** — CHECKLIST MUST, and `public/app.js:15-22`'s first decision. Not
  `localStorage`, not `sessionStorage`, not a cookie, not IndexedDB, not a cache. The grep gate in Level 1
  checks for the names.
- **GOTCHA**: nothing candidate-shaped in the URL (`public/app.js:24`).
- **VALIDATE**: `node --check public/prep/brief.js` and the Level 4 sweep.
- **SATISFIES**: AC #3, AC #6.

### CREATE `public/prep/prep.css`

- **IMPLEMENT**: Rules for the block components only, ~200 lines (R6). Open with a header stating that it
  **supplements** `app.css` and never restates it: `.topbar`, `.card`, `.btn`, `.mark*`, `.claim-source`,
  the single `:focus-visible` rule, the reduced-motion guard and the type/colour base all already live
  there and are linked before this file. Add: `.brief` (measure capped at 72ch as `privacy.html:15` does),
  `.block` + `.block-head`, the per-component classes, `.help-panel[hidden]`, the `LogisticsRail`
  definition list, and the responsive pass to 360px. A rule that exists only to style one session block is
  the tripwire — those five render on the shared `.block` rules alone.
- **PATTERN**: `public/app.css:1-9` for the header, `public/prep/privacy.html:12-37` for the
  tokens-only discipline, `public/app.css:859-865` for a `max-width` pass that trims padding rather than
  restructuring.
- **GOTCHA**: **zero raw hex, zero raw px** for colour/type/radius/spacing — test group 10 enforces it over
  the comment-stripped file, so citing a measured ratio in a comment (as `tokens.css:19-22` does) is
  allowed and citing one in a declaration is not. Prefer reusing an existing token to adding one; if a
  colour genuinely must be added it goes into `public/tokens.css` **and** `test/tokens.test.js`'s
  `PAIRINGS` in the same commit, which is what the contrast-gates AC means operationally.
- **GOTCHA**: do not write a second focus rule. `app.css:71-77` is the one rule for everything, and a
  component-level `outline` will fight it. Never `outline: none`.
- **GOTCHA**: `min-width: 0` plus an `overflow-x: auto` container on anything holding a long quote or an
  unbroken string — CRAFT's Safari/Chrome blowout trap. `LogisticsRail` and `.claim-source` are the two
  candidates here.
- **GOTCHA**: nothing animates in this ticket. `app.css:866-870` already zeroes durations under
  `prefers-reduced-motion: reduce`, so the MUST is inherited; do not add an entrance to re-open it.
- **VALIDATE**: `npm test` (tokens gate) plus the new CSS-discipline test.
- **SATISFIES**: AC #1, AC #7.

### CREATE `test/prep-registry.test.js`

- **IMPLEMENT**: Groups, in increasing order of how easily they rot, with a header saying so:
  1. **Export surface** — `Object.keys(REGISTRY).sort()` equals `BRIEF_BLOCK_NAMES ∪ SESSION_BLOCK_NAMES`
     sorted, equals the ten names of decision 22 written out literally in the test. And: the registry's
     `BRIEF_BLOCK_NAMES` equals `BLOCK_NAMES` imported from `../src/prep/schema.js` — the drift
     `test/prep-schema.test.js:47-52` predicted. And: no key matches `/answer|score|rank|level|grade|rating/i`.
  2. **No injection** — read `public/prep/registry.js` as text, **strip comments first**
     (`/\/\*[\s\S]*?\*\//g` then `/\/\/[^\n]*/g`), then assert no
     `innerHTML|outerHTML|insertAdjacentHTML|document\.write|createContextualFragment`. Same
     parse-the-file idiom as `test/tokens.test.js:23`, same comment-stripping reason as
     `test/schema.test.js:36-39`. Scan `brief.js` for the browser-storage APIs the same way.
  3. **Renders the real payload** — `renderBlocks(brief.fixture.json, mount, {doc})` with the fake
     document. Every block produced a `<section>` with an `aria-labelledby` pointing at a heading that
     exists; `rendered` equals the block count; `skipped` is empty; every prop string appears in the
     serialized output.
  4. **Renders the session specimens** — the same, over `test/fixtures/prep-session-blocks.json`.
  5. **Unknown name** — a block named `ModelAnswerCard` is skipped, reported in `skipped`, and the string
     `ModelAnswerCard` appears nowhere in the output. A dangling `competency_id` is reported the same way
     and renders no empty row.
  6. **Provenance** — the verified competency's quote appears; the unverified one's mark word appears; the
     value of `failed_quote` appears **nowhere** in the output.
  7. **Nothing carries a rank** — run the scan over the **whole** rendered output of both fixtures, not
     just `ProgressStrip`: no `aria-valuenow`, no `progressbar`, no `<progress`, no `%`, no
     `/level|of \d/i`, and no bare `importance` numeral or `n/5` from `CompetencyMap`. Widened past the
     one component because `competency.importance` is the second numeric field that could reach the page
     and only one of the two is obvious.
  8. **HelpLadder** — rungs are `<button>` with `aria-expanded="false"`, panels carry `hidden`,
     `structure` renders as list items, and `onRung` fires with `"nudged"` / `"revealed"` when a rung's
     handler is invoked.
  9. **The fixture is derived, not drawn** — `public/prep/brief.fixture.json` deep-equals
     `verifyBrief(assertBrief(prep-payload.json), {brief, fieldKeys}).payload`.
  10. **CSS discipline** — with `/\*…\*/` comments stripped first, `prep.css` contains no raw hex, no
      `outline: none` and no `transition: all`; and no `tabindex` above 0 exists anywhere in
      `public/prep/`. Comments are stripped because `tokens.css:19-22` sets the house precedent of citing
      measured hex values in prose while explaining a contrast decision, and `prep.css` will want to do
      the same.
  11. **Guarding the guard** — the serializer actually reached the nested `StoryBankCard` under
      `CompetencyMap` (a positive assertion that the deepest node is present), so groups 3-7 are not
      quietly measuring a truncated tree.
- **PATTERN**: `test/prep-schema.test.js:1-60` for the header, groups and `messageOf` helper;
  `test/tokens.test.js` for file-parsing assertions.
- **IMPORTS**: `node:test`, `node:assert/strict`, `node:fs`, `node:path`, `node:url`;
  `../public/prep/registry.js`; `../src/prep/schema.js`; `../src/prep/verify.js`; `./helpers/dom.js`.
- **GOTCHA**: this machine's default Node is **v20.20.2** and the suite must also pass on v24
  (`test/helpers/fake-d1.js:9-11`). `structuredClone` is fine on both; `node:sqlite` is not — do not reach
  for it.
- **GOTCHA**: importing `public/prep/registry.js` under Node is itself an assertion. Keep one test that
  does nothing but import the module, so a stray top-level `document` fails loudly and by name rather
  than taking the whole file down with a confusing stack.
- **VALIDATE**: `node --test test/prep-registry.test.js`
- **SATISFIES**: AC #1 through AC #7.

### UPDATE `README.md`

- **IMPLEMENT**: A short paragraph in the portal section: the block vocabulary is ten names, the registry
  is `public/prep/registry.js`, an unknown name is skipped rather than rendered, and the dashboard renders
  a fixture until #22 wires the endpoint. Two or three sentences, matching the file's existing register.
- **PATTERN**: the existing portal/#17 paragraphs in `README.md`.
- **GOTCHA**: do not restate the architecture doc. Link it.
- **VALIDATE**: `grep -n "registry" README.md`
- **SATISFIES**: AC #8.

---

## TESTING STRATEGY

Every acceptance criterion is assigned to a mechanism before a test is written. This table is the
contract with the fake DOM: anything not in the "fake DOM" rows does not get a fake-DOM test.

| Acceptance criterion | Mechanism |
|---|---|
| Every component renders from fixture props | fake DOM + serializer (`test/prep-registry.test.js` groups 3-4) |
| Semantic landmarks | fake DOM: `<section>` + `aria-labelledby` → an `<h2>` that exists |
| Registry cannot render an answer or a score | `deepEqual` over `Object.keys(REGISTRY)` — no DOM (group 1) |
| Never injects | source scan for `innerHTML` and friends — no DOM (group 2) |
| Works against #19's fixture payload | fake DOM over `brief.fixture.json` + the derivation test (groups 3, 9) |
| ProgressStrip shows movement, never a rank | assertions over rendered text + source scan (group 7) |
| Repo contrast gates | **the existing `test/tokens.test.js`**, unchanged if no colour is added; a new colour adds a `PAIRINGS` row |
| Full keyboard operability, visible focus | **Level 4 manual**, plus source assertions that nothing removes the outline and no positive `tabindex` exists (group 10) |

### Unit Tests

`node --test test/*.test.js`, zero dependencies, one new file. Fixtures are read from disk and
`structuredClone`d per test so a mutation case cannot leak into the next — `test/prep-schema.test.js:28`.

### Integration Tests

The nearest thing this repo has is the fixture-derivation test (group 9): it runs #19's real `assertBrief`
and `verifyBrief` over #19's real inputs and asserts the file this page ships is exactly that output. That
is what makes "works against #19's fixture payload" a fact rather than a claim, and it fails the day
either side drifts.

### Edge Cases

- A block name outside the vocabulary, at the top level **and** nested in `children`.
- A `competency_id` that resolves to nothing.
- A competency with `verified: false` (the shipped fixture has one) and one with `verified` absent.
- A `PanelBrief` entry carrying `failed_field_key` with a blanked `source_field_key`.
- `LogisticsRail` with `when: ""` — the material did not say.
- An empty `blocks` array → the empty state, not a blank page.
- `props` missing a field the constructor reads → renders without it rather than throwing.
- A `role_title` or a prop string long enough to need `overflow-wrap` (`app.css:377-382` hit this).
- A 360px viewport.

---

## VALIDATION COMMANDS

Execute every command to ensure zero regressions and 100% feature correctness.

### Level 1: Syntax & Style

There is no linter or formatter in this repo. The equivalent gates:

```bash
node --check public/prep/registry.js \
  && node --check public/prep/brief.js \
  && node --check test/helpers/dom.js \
  && node --check test/prep-registry.test.js

# the module actually loads under Node — the ESM decision's own gate
node -e "import('./public/prep/registry.js').then(m => console.log(Object.keys(m.REGISTRY).length))"

# CHECKLIST's data-posture MUST: transient means transient, including the browser.
# Stays honest only because comments in public/prep/*.js describe these APIs without naming
# them — public/app.js:19-21's convention. Test group 2 is the version that strips comments.
! grep -nE "localStorage|sessionStorage|indexedDB|document\.cookie" public/prep/*.js

# the injection gate, same convention: the header says "no HTML-parsing assignment", not the
# property name (public/app.js:869).
! grep -nE "innerHTML|outerHTML|insertAdjacentHTML|document\.write" public/prep/*.js
```

The raw-hex gate is deliberately **not** a shell grep. `prep.css` will cite measured hex values in its
comments the way `tokens.css:19-22` does, a shell one-liner cannot strip CSS comments cheaply, and this
repo has already dropped one Level 1 grep that fired on a mandated comment
(`.claude/plans/candidate-brief-generation-seam.md`, AMENDMENTS). It lives in test group 10, which strips
comments before matching.

### Level 2: Unit Tests

```bash
node --test test/prep-registry.test.js
npm test                                  # the whole suite, no regressions
```

### Level 3: Integration Tests

```bash
# the derivation this page's fixture depends on, run in isolation
node --test --test-name-pattern="derived" test/prep-registry.test.js
```

### Level 4: Manual Validation

```bash
npm run dev                               # wrangler pages dev on :8788, migrations first
open http://localhost:8788/prep/brief
```

Then, in **real Safari and real Chrome** (CHECKLIST MUST — one bundled engine misses real blowouts):

1. The page renders every block in the fixture, in order, with no console errors.
2. **The unverified competency (`comp-documentation`) shows its mark word on screen**, not hidden behind
   a hover or a disclosure, and the paraphrased quote text is nowhere on the page.
3. Tab from the top: focus is visible on every stop, order follows the reading order, no trap, focus never
   lands under the topbar. `HelpLadder`'s rungs open and close with Enter and Space.
4. A screen reader's landmark list shows one banner, one main, and one region per block, each named by its
   heading (VoiceOver rotor on macOS is enough).
5. Narrow to 360px: no horizontal page scroll; long quotes and the logistics rail scroll inside their own
   containers.
6. Add a block named `ModelAnswerCard` to the fixture, reload: the console warns, nothing renders for it,
   and the string appears nowhere on the page. Revert.
7. Break `SOURCE` to a 404 path, reload: the error line is in plain language and says what to do. Revert.
8. Set `prefers-reduced-motion: reduce`: the page is identical, because nothing animates.

### Level 5: Additional Validation (Optional)

- Run the `dossier-design` skill's `references/CHECKLIST.md` top to bottom as a written pass and record
  the result in the PR body.
- Run the `humanizer` skill over `registry.js`'s and `brief.js`'s `COPY` objects and `brief.html`'s prose:
  no em dashes, no "not X but Y", active voice, plain en-GB, jargon defined once.

---

## ACCEPTANCE CRITERIA

- [ ] **AC #1** — Every one of the ten components renders from fixture props, inside a `<section>` with an
      `aria-labelledby` naming a heading that exists.
- [ ] **AC #2** — `Object.keys(REGISTRY)` is exactly the ten names of decision 22, asserted in a test; the
      five brief-time names equal `BLOCK_NAMES` imported from `src/prep/schema.js`; no key is
      answer-shaped or score-shaped.
- [ ] **AC #3** — `renderBlocks` skips an unknown name with a console warning and reports it in the return
      value; the unknown name's text appears nowhere in the output, and no markup is injected.
- [ ] **AC #4** — Nothing renders a rank: no `aria-valuenow`, no progressbar role, no percentage, no
      "N of M" from `ProgressStrip`, and no `importance` numeral or meter from `CompetencyMap` (priority
      renders as order). `FeedbackNote` carries one improvement by construction. `HelpLadder.structure` is
      headings, never prose.
- [ ] **AC #5** — Provenance renders honestly: a verified competency shows its quote, an unverified one
      shows the word, and a failed quote's text is never shown to the candidate.
- [ ] **AC #6** — The dashboard renders `public/prep/brief.fixture.json` end to end, and that file is
      proven equal to `verifyBrief`'s output over #19's own fixtures.
- [ ] **AC #7** — Repo contrast gates pass (`test/tokens.test.js` green; any new colour has a `PAIRINGS`
      row); focus is visible on every interactive element; the full flow is keyboard-operable; no raw hex
      or px in `prep.css`.
- [ ] **AC #8** — `npm test` passes with zero regressions on Node 20 and Node 24; README records the
      registry.
- [ ] No candidate material reaches `localStorage`, `sessionStorage`, IndexedDB, cookies or the URL.
- [ ] `src/prep/*`, `public/app.*`, `public/index.html` and `public/clients.*` are untouched.

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] All validation commands executed successfully
- [ ] Full test suite passes (`npm test`) on Node 20 and Node 24
- [ ] `node --check` clean on every new JS file
- [ ] Manual sweep done in real Safari **and** real Chrome, including 360px and keyboard-only
- [ ] `dossier-design` CHECKLIST.md run, result recorded
- [ ] Humanizer pass on every visible string
- [ ] Acceptance criteria all met
- [ ] Every risk's tripwire checked: R1 (helper under ~110 lines, six operations), R5 (session
      constructors under ~40 lines each), R6 (`prep.css` restates no `app.css` selector), R7 (group 9 green)
- [ ] Any cut taken from the stop rule is recorded in AMENDMENTS with its reason — a silent cut reads as
      coverage
- [ ] Code reviewed for quality and maintainability

---

## OPEN QUESTIONS / ASSUMPTIONS

**Assumptions this plan makes:**

1. **The registry ships all ten names**, including the five with no schema behind them. The ticket says
   "the full pilot vocabulary" and lists ten, and decision 22 names ten. The cost is that five props
   contracts are invented here; the mitigation is that they are written down as fixtures #23/#24/#25
   inherit, rather than as prose.
2. **The dashboard renders a static fixture.** #20's auth and #22's endpoint do not exist, and #21 does
   not depend on them. One constant names the source so the swap is one line.
3. **`public/prep/registry.js` is an ES module** while `public/app.js` is not. Justified by the AC that
   requires asserting an export surface. No build step is introduced.
4. **No new colour tokens.** If implementation finds one is genuinely needed, it goes into `tokens.css`
   plus a `PAIRINGS` row in the same commit — not into `prep.css`.
5. **The shipped fixture carries one unverified competency**, because #19's fixture pair was built that
   way deliberately. Verified against the real files: `sourced: 2, unverified: 1`.

**Questions that would change the plan if answered differently:**

- **Does a candidate see an unverified competency at all, or is it dropped?** This plan renders it with an
  honest mark, following architecture §3's "demote, don't drop" and CHECKLIST's MUST. The alternative —
  hiding anything unsourced from the candidate — is defensible but contradicts §3 and would need an
  architecture amendment. Flagged rather than silently chosen.
- **Should `HelpLadder` be interactive in this ticket, given #24 owns the drill UI?** This plan says yes:
  a ladder that renders both rungs open at once *is* a reveal, which destroys the rung distinction the
  whole mechanism rests on. The interaction is two native disclosures and no more.
- **Do the five session-block props survive contact with #23?** They are derived from SPEC line by line,
  but #23 writes the prompt that must fill them. If it needs a sixth field, that is an amendment to this
  file, not a silent divergence.

---

## NOTES (open canvas)

### Why the throw/warn split is not an inconsistency

`assertBrief` throws on an unknown block name; `renderBlocks` warns and skips. A reviewer may read that as
two answers to one question. It is the repo's existing philosophy applied twice: `src/prep/schema.js:212-224`
argues that shape bugs throw and `src/prep/verify.js:10-14` argues that provenance failures demote, and the
line between them is *who is standing in front of the failure*. Server-side, at Send, a recruiter is there
and a hard stop is correct. Client-side, in front of a candidate who cannot fix anything, a page that
throws is a blank page. So the renderer degrades and says so where an engineer can hear it.

The renderer also applies exactly **one** rule, not several: unknown name → warn and skip. It does not
re-litigate nesting (a `PanelBrief` inside `children` renders, because `assertBrief` already refused to
let one through), and it does not re-check props. Adding a second policy here would duplicate the schema
in a file that cannot import it, which is the drift the fixture-derivation test exists to prevent.

### Why the failed quote does not reach the candidate

This is the one place the candidate's screen deliberately shows *less* than the recruiter's.
`public/app.js:894-899` prints "Not found in the source: …" so a recruiter can diagnose a bad pack; their
next action is to check the brief. A candidate's next action after reading a quote is to prepare against
it. Printing a sentence the model invented, on a screen whose entire value proposition is "this is what
the client actually said", would hand them our error to carry into the room. The mark stays — they are
told the claim is our reading rather than a quote — and the fabricated text does not render. The
diagnostic is not lost: it is in the stored payload, where #22's send gate and the recruiter's preview
can both reach it.

### Why the demo fixture is the messy one

The instinct is to ship a clean fixture so the demo screen looks good. Running the derivation says
otherwise: `comp-documentation`'s quote is a paraphrase and comes back `verified: false`. Shipping that is
better on three counts. It exercises the demotion path in the default state, so CHECKLIST's "unverified
claims render visibly" MUST is shipped on evidence rather than on faith. It is byte-derivable from #19's
own fixtures, so the two cannot drift. And it is honest about what a real payload looks like — `verifyBrief`
exists precisely because models paraphrase.

The one thing it is not is *sendable*: `scripts/gen-brief.js:15-18` exits non-zero on any demotion, and
#22 will gate on the same. That is a gate on **sending**, not on **rendering** — `src/prep/verify.js:90-95`
already discusses a payload re-verified out of storage, so a stored payload with a demotion is a state the
system can reach and the renderer has to handle it.

### The fake DOM is the risk in this plan

`test/helpers/fake-d1.js` opens by warning against exactly this: "it does NOT run SQL, and the tests must
not pretend otherwise." That helper works because what it asserts is structural — which columns a query
touches, not what the database returns. The same discipline applies here, and the failure mode is worse:
a fake DOM stretched far enough to "prove" keyboard operability would hand this ticket a green tick on
the one AC it cannot actually check. The mechanism table in TESTING STRATEGY is the bound, and the six
operations in `test/helpers/dom.js` are the budget. If a test wants a seventh, the honest answer is a
Level 4 step. R1 restates that as a bound and a tripwire the implementer can act on mid-task; this
paragraph is why it is worth having one.

### Alternatives weighed

| Option | Verdict |
|---|---|
| Classic script + `window.PrepRegistry` global, matching `app.js` | Rejected. The AC requires asserting the export surface, and an IIFE has none. Testing it would mean reading the file and `eval`ing it against a fake global — more machinery than the module it is avoiding. |
| Import `BLOCK_NAMES` from `src/prep/schema.js` into the registry | Impossible. Pages serves `public/` only; the import 404s in the browser. Retyped in the module, reconciled in the test, which can import both. |
| Ship only the five block names #19 emits, defer the rest to #23/#24 | Rejected. The ticket says "full pilot vocabulary" and enumerates ten. Deferring also defers the AC that the vocabulary *is* the safety rail — a five-name registry proves nothing about the components that will render session output. |
| A `<template>`-based renderer instead of constructors | Rejected. Templates move markup into HTML where the "no finished answer" rule stops being enforceable by reading the module's exports. |
| Add a JSON-schema validator or a DOM library to test properly | Rejected. Zero dependencies is a standing repo constraint, restated in `src/prep/schema.js:9-10`. |
| Hand-write `brief.fixture.json` | Rejected. It would drift from #19 silently, which is the exact failure the derivation test catches. |

### Sequencing note

Phase 1 (registry) gates everything. Phases 2 (tests) and 3 (page) are genuinely independent — disjoint
files, meeting only at `npm test` — so they are the pair to run in parallel if two agents are available.
Phase 4's gates need both.

### Operational notes

- `functions/prep/_middleware.js` runs `purgeExpired` on every `/prep/*` request, including
  `brief.html` and the fixture JSON. It is guarded on `env.DB`, so a local run without a database is a
  no-op and a console line there is the middleware working as designed.
- Local `main` is stale at `5a7f754`. `origin/main` at `7344a6e` has everything. Branch from the remote.
- The current worktree is on `feature/per-field-candidate-visible-toggle`, which is already merged. Do
  not implement here; take a fresh worktree.

## AMENDMENTS

<!-- newest at the bottom; leave empty until this plan has been executed -->
