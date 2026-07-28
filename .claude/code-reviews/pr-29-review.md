# Code review — PR #29: component registry + prep-brief dashboard (#21)

## ✅ Verdict: APPROVE — 0 critical · 0 high · 2 medium · 2 low · 402 tests green

*Posted as a comment rather than as an approving review event: GitHub refuses `--approve` on your
own PR, and the `gh` session is authenticated as the author. The verdict is an approval.*

**Branch** `feature/prep-component-registry` → `main` · 11 files, +3275 / −0 · reviewed at `6f4368d`

Approving with one human-gated precondition (Level 4) and two Medium findings worth folding in
before or alongside #23.

No critical or high issues. Validation is green. The diff does what the PR says it does, and the
central architectural claim — *"there is no component that renders a finished answer or a score"* —
is enforced by the code rather than asserted in prose. I verified that by breaking it.

---

## Validation

| Gate | Result |
|---|---|
| `npm test` (Node v20.20.2) | **402 tests · 397 pass · 0 fail · 5 skipped** |
| `node --test test/prep-registry.test.js` | **42 pass · 0 fail** |
| `node --check` × 3 new JS files | pass |
| `grep` HTML-parsing APIs in `public/prep/` | clean |
| `grep` browser-storage APIs in `public/prep/` | clean |
| Working tree after review | clean, all mutations restored byte-identically |

The 5 skips are #17's pre-existing `node:sqlite` tests (needs Node ≥22.5), unrelated to this
ticket. The PR's Node 24 figure (402/402) was not re-run here.

### The mutation-testing table was spot-checked, not taken on trust

Four ACs rest on tests that assert an **absence**, and the report claims each gate was broken on
purpose. I re-ran three of them independently:

| Mutation applied | Gate | Result | Report claimed |
|---|---|---|---|
| `innerHTML` assignment in `registry.js` | no-injection scan | **red** (7 fail) | 1 fail |
| `ProgressStrip` rendering `"Level 2 of 4"` | rank scan | **red** (1 fail — `not ok 29`) | 1 fail |
| An 11th `REGISTRY` key, `ModelAnswerCard` | export surface | **red** (4 fail) | 3 fail |

Counts differ from the report only because my mutations were cruder than the author's (mine also
broke rendering). The gates are real and load-bearing. `git checkout --` restored each file
byte-identically; `git status` is clean.

---

## Findings

### Medium — one malformed block blanks the page, contradicting the walker's own stated rule

`public/prep/registry.js:530` · `renderBlocks` has no per-block guard around `build(...)`.

`registry.js:25-27` states the design rule explicitly: *"a shape bug in front of a recruiter should
stop a Send, and the same bug in front of a candidate who can fix nothing should degrade the page
rather than blank it."* The walker honours that for an unknown **name** — report, skip, keep going.
It does not honour it for a malformed **prop**.

Confirmed by direct probe: a `PanelBrief` whose `panel` carries a `null` entry throws out of
`renderBlocks` at `registry.js:279` (`Cannot use 'in' operator to search for 'failed_field_key' in
null`). Because `mount.textContent = ""` at `registry.js:575` has already cleared the mount and
earlier blocks have already been appended, the candidate is left with **a half-rendered brief and
the red "We could not load your prep just now" line on screen at the same time** — two
contradictory statements at once, which is worse than either alone.

*Reachability, stated fairly:* on the brief path this is not reachable from a generated payload —
`src/prep/schema.js:99-122` requires every panel entry to be an object with three required strings,
and `assertBrief` runs server-side. It becomes reachable on the session path, which
`registry.js:49-50` says has no schema behind it yet.

**Fix** — the degrade path already exists; route the throw into it:

```js
try {
  parent.appendChild(build(doc, ...));
  rendered += 1;
} catch (err) {
  console.warn(`prep registry: ${name} threw while rendering; skipped`, err);
  skipped.push(text(name));
}
```

### Medium — `children` are dropped silently on nine of the ten constructors

`public/prep/registry.js:547-572` · only `CompetencyMap` calls `ctx.render(ctx.children, …)`
(`registry.js:268`). The other nine take `ctx` and never read `ctx.children`.

Confirmed by probe — a `QuestionCard` carrying one `HelpLadder` child returns:

```
{"rendered":1,"skipped":[],"unresolved":[]}   child rendered? false   warnings: []
```

The child vanished with **no console warning, no `skipped` entry, and `rendered` still counting the
parent**, so `brief.js:76`'s empty state never fires either. That is precisely the failure mode the
walker's one documented rule exists to prevent, arriving through a different door.

Same reachability split as above: `src/prep/schema.js:263-291` rejects `children` on anything but
`CompetencyMap`, so the brief path is safe. But `renderBlocks` is the contract #23/#24/#25 inherit
for the five session names, and there is no `assertBrief` on that path.

**Fix** — one branch in the walker, or a `consumesChildren` flag on the registry entry:

```js
if (name !== "CompetencyMap" && block.children?.length) {
  console.warn(`prep registry: ${name} does not nest; ${block.children.length} child block(s) skipped`);
}
```

### Low — the fabricated quote is never *rendered*, but it is *delivered*

`public/prep/brief.js:58` · `public/prep/brief.fixture.json:120`

The PR's claim is precisely worded and it holds: a failed quote's text never reaches the DOM, and
the test at `test/prep-registry.test.js:396-415` proves it. The reasoning at `registry.js:188-189`
goes further, though — the diagnostic *"stays in the stored payload where #22's send gate and the
recruiter's preview both reach it"* — and this PR's delivery mechanism hands that same payload
straight to the candidate's browser. `failed_quote`, the `importance` numerals, and six `questions`
the page never renders are all one View Source away.

Nothing is at stake today: the fixture is synthetic specimen data (I read it in full — no real
client, candidate or panel member), and `/prep/*` carries `X-Robots-Tag: noindex`. But
`brief.js:35-38` says #22 replaces `SOURCE` with a token-gated endpoint reading
`candidate_role.brief_json`. **If that endpoint returns the stored row verbatim, this becomes a real
leak of model-fabricated text to the candidate.** Worth pinning to the contract now, while it is
being written, rather than rediscovering it in #22.

### Low — the same predicate computed twice, failing in opposite directions

`public/prep/registry.js:279` vs `registry.js:214`. `PanelBrief` computes
`"failed_field_key" in person || !text(person.source_field_key).trim()`; `panelSourceNode`
recomputes it with an `entry &&` guard that fails **open** — a falsy entry would render *"From our
notes on this client"*, captioning a guess as sourced. It is currently unreachable only because
line 279 throws first, which is itself the tell. `provenanceNode:194` documents fail-closed as the
house rule. One helper, failing closed, used by both.

---

## Author-flagged, confirmed — not scored as findings

These are documented in the PR body and the report, so per the review contract they are intentional
decisions rather than defects. Recording that I checked them and agree with the framing:

- **`brief.js` has no test at all** — it touches the document at module scope. This is also why
  findings 1-3 above sit where they do: the error state, the empty state and the malformed-payload
  guard are the three uncovered branches. The author's call to split fetch-and-state out of module
  scope in its own ticket is the right one; a late edit here would be worse.
- **Two AC #5 branches are test-only** (`verified === undefined`, a `PanelBrief` with
  `failed_field_key`). Verified: the derivation genuinely cannot reach them, and both are covered by
  hand-built payloads at `test/prep-registry.test.js:430` and `:444`.
- **Three sections share the heading "A story worth bringing."** A fixed reviewed heading beats a
  model-authored one. Correctly handed to Level 4.
- **The seven deviations in the report** (worktree reuse, 8 helper operations, the `"derived"`
  rename, the raw-px assertion, `.save-state` reuse, closure state, `.wrangler/state` reset) are all
  argued in-file and all defensible. Deviation 3 in particular — noticing that
  `--test-name-pattern="derived"` matched **zero** tests and was therefore passing vacuously — is
  the kind of thing most implementations quietly leave broken.

---

## What is good

- **The safety rail is structural, and the tests prove the absence rather than assert it.** Group 1
  writes out decision 22's ten names literally instead of deriving them from the exported arrays, so
  adding a name to both the array and the registry still fails. My 11th-key mutation went red on
  three separate assertions.
- **`BRIEF_BLOCK_NAMES` is retyped and then reconciled** (`test/prep-registry.test.js:114`). The
  registry cannot import `src/prep/schema.js` — Pages serves `public/` only — so the duplication is
  forced. Catching the drift in the one place that can load both, with the failure message
  explaining what breaks, is the correct handling of an unavoidable duplication.
- **Group 11 guards the guard.** Groups 3-7 all rest on "this string is / is not in the serialized
  output," and a serializer that stopped at depth 1 would make every absence assertion pass for the
  wrong reason. Testing the test helper's own reach is a discipline most suites skip.
- **The fixture is derived by script and asserted byte-identical** to `verifyBrief(assertBrief(…))`,
  and it deliberately ships a demotion (`sourced: 2, unverified: 1`) so the unverified path is
  demonstrated in the default state rather than only under test.
- **The candidate/recruiter provenance split is genuinely well reasoned.** Showing the recruiter a
  failed quote and showing the candidate only the mark, because their next moves differ, is a real
  product judgment argued in the right place (`registry.js:180-193`).
- **Prototype pollution is handled** — `Object.prototype.hasOwnProperty.call(REGISTRY, name)` at
  `registry.js:550` means a block named `toString` or `constructor` resolves to nothing.
- **No HTML-parsing API anywhere**, verified independently of the suite's own grep. Every node is
  `createElement` + `createTextNode`.
- **`prep.css` genuinely supplements rather than restates** — the selector-collision test is a real
  parser, and the author found and fixed a bug in it (at-rule preludes) when its own test went red.
- **`.help-panel[hidden] { display: none }`** written *before* the bug rather than after, citing the
  place in `app.css` where it was hit the first time.

---

## The one precondition a human has to clear

**Level 4 — the real-browser sweep — was not run, and AC #7's keyboard and focus half is
unevidenced.** The plan lists it as item 6 on the "never cut" list. The author recorded this rather
than skipping it, which is the right handling, but no agent can certify it and neither can this
review. The fake DOM deliberately does not lay out, compute style, move focus or dispatch events —
`test/helpers/dom.js:3-9` argues that stretching it far enough to "prove" keyboard operability would
hand the ticket a green tick on the one criterion it cannot reach. That argument is correct, and it
is exactly why this has to happen in a browser.

```bash
npm run dev        # then open http://localhost:8788/prep/brief
```

Needed in **real Safari and real Chrome** before merge:

1. Tab order and visible focus, especially the two `HelpLadder` rungs.
2. The screen-reader landmark list (and confirm the three identical "A story worth bringing" region
   names are tolerable).
3. 360px with no horizontal page scroll.
4. Break `SOURCE` to a 404 and confirm the error line reads plainly — this is the untested branch.

---

## Recommendation

**Approve.** No critical or high issues; 402 tests green; the diff matches its stated intent; the
absence-based gates hold under mutation. The two Medium findings are unreachable on the only wired
path today and are cheap to fix — either in a follow-up commit here or as the first task of #23,
which is where they become reachable. The Low finding on payload delivery is best resolved as an
explicit line in #22's endpoint contract: **strip `failed_quote` server-side before it reaches a
candidate's browser.**

Merge once a human has run the Level 4 sweep.

---

*Reviewed with fresh context (no `code-reviewer` agent is defined in this repo — `.claude/agents/`
does not exist; the review was done directly in a cleared session that did not write this code).
Claims were verified by re-running the suite, applying and reverting three mutations, and probing
the walker directly, rather than by reading the report.*
