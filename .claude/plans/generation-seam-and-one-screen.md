# Feature: the generation seam and the one screen (#6 + #8)

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

> **Read this first.** Ticket #6 as written specifies a server-side model call through
> `@anthropic-ai/sdk`. **That implementation was built (`3d72737`) and reverted (`5e311d1`),
> and the revert stands.** The user reconfirmed on 27 Jul 2026: *"ignore API, its
> subscription."* This plan implements #6 and #8 together under the subscription decision.
> Section **AC disposition** below says exactly which acceptance criteria survive, which
> change shape, and which are void — those issues need amending, and that is the user's call.

## Feature Description

One screen at `/` where a recruiter picks a client, pastes or uploads the brief and the CV,
copies a fully assembled prompt into their own Claude session, pastes the reply back, and gets
a verified, rendered, sendable pack with every claim carrying its source and every unsourced
claim visibly marked.

The model call happens in the recruiter's Claude session, not in this deployment. What this
deployment owns is the two halves either side of it: **assembling the prompt** (which needs the
client knowledge note, and the note is the product) and **verifying and rendering the reply**
(which is where the sourcing promise becomes a mechanism). Those two halves are the seam, and
the screen is the thing that makes them one flow.

## User Story

As a **working owner-recruiter at a small agency**
I want to **turn a brief, a CV and what I already know about this client into a sendable
submission pack in one place**
So that **more of my candidates reach interview without me writing a bespoke pitch from memory
every time, and it takes less than the email it replaces**

## Problem Statement

The agency's privileged client knowledge is written down (#5 shipped the store and its editor)
and the mechanism that turns it into a sourced pack exists as library code (#4, #7). But there
is no way for the recruiter to run it. Today a pack requires saulera to be in the room driving
`src/` from a Claude Code session by hand, which makes PRD §6 acceptance condition 1 fail by
construction: *"If it only works when I run it, the three-week adoption test measures my
availability rather than the product."*

The obvious fix — a Pages Function that calls the model — was built and reverted. A Pages
Function cannot use subscription auth (short-lived OAuth token in a local credential file; a V8
isolate has no filesystem and no process to refresh it), so a model call from Pages requires a
per-token API key, and the standing decision is that there is no key on this deployment.

## Solution Statement

Split the generation boundary in two around the recruiter's own Claude session.

```
       ┌──────────────── this deployment ────────────────┐
       │                                                 │
  [1]  │  POST /api/prompt  {client_id, brief, cv}       │
       │    loads the client note from D1 (#5)           │
       │    assembles SYSTEM + note + brief + CV +       │
       │    PACK_SCHEMA (#4) into ONE copyable string    │
       │                                                 │
       └────────────────────┬────────────────────────────┘
                            │ recruiter copies, pastes into
                            │ their own Claude, copies the reply
       ┌────────────────────▼────────────────────────────┐
  [2]  │  POST /api/verify  {client_id, cv, pack_text,   │
       │                     duration_ms}                │
       │    extractPack  -> assertPack (#4)              │
       │    -> verifyPack against the CV and the note    │
       │    -> render through #7's RENDERERS             │
       │    -> recordEvent (#5)                          │
       └─────────────────────────────────────────────────┘
```

No key, no SDK at runtime, no `nodejs_compat`, no model call from Pages. Every claim still
passes the deterministic literal-quote check before the recruiter sees it, and anything that
fails is demoted and rendered visibly unverified — the property that makes *"nothing in this
pack is unsourced"* true rather than promised.

## Out of Scope / Non-Goals

- **Not included: any model call from this deployment.** No `ANTHROPIC_API_KEY`, no runtime
  SDK, no `nodejs_compat`. `@anthropic-ai/sdk` stays a **devDependency** (`spike/run.js` is
  the API path and stays where it is). Do not restore `src/generate.js` or
  `functions/api/generate.js`.
- **Not included: pack history, or a regenerate button.** Architecture §9: *"ship strict,
  treat history as a paid follow-on."* A recruiter will ask for it in week one. Still no.
- **Not included: PDF or .docx input parsing.** Upload reads plain text only (`.txt`, `.md`).
  Anything else means a dependency and a build step, which #8 AC9 forbids. See Open Questions.
- **Not rebuilding the note editor.** #5's `/clients` screen already exists. The one screen
  **links** to it (`/clients?client=<id>`). #8: *"link to it, do not rebuild it."*
- **Not changing:** `src/pack.js`, `src/provenance.js`, `src/render/*`, `src/store.js`,
  `src/http.js`, `migrations/`, the four existing `functions/api/` routes, `public/clients.*`.
  All are shipped and reviewed. This ticket consumes them.
- **Not included: a Content-Security-Policy.** `public/_headers` gets the three cheap headers
  (see Phase 5); a CSP on the ticket that has to work on Tuesday is a needless risk. Follow-up.
- **Not included: web fonts.** Re-deferred with a reason — see Open Questions.

## Feature Metadata

**Feature Type**: New Capability (the integration slice)
**Estimated Complexity**: High — two new Functions, one new screen, a palette correctness fix,
and a reinterpretation of two tickets' acceptance criteria.
**Primary Systems Affected**: `functions/api/`, `src/prompt.js`, `public/` (the whole screen),
`test/`
**Dependencies**: none new. Zero runtime dependencies is preserved.

## Related Work

**Implements**: [#8](https://github.com/linardsb/saulera-dossier-engine/issues/8) and
[#6](https://github.com/linardsb/saulera-dossier-engine/issues/6) · **Epic**:
[#1](https://github.com/linardsb/saulera-dossier-engine/issues/1)
(architecture doc at `~/Desktop/saulera/products/agency-submission-dossier/agency-submission-dossier.architecture.md`,
not in this repo)

**Back-references**:

- `.claude/plans/client-knowledge-store.md` — Why: the store, the four `/api/*` routes, the
  `json()`/`readJson()`/`sameOrigin()`/`errorResponse()` shape, and `public/clients.js`'s async
  guards are all mirrored here.
- `.claude/plans/deploy-skeleton.md` — Why: the engine/config split and the Pages layout rules
  this screen has to live inside.
- Commit `5e311d1` (the revert) — Why: it is the decision record this plan implements.

**Forward-references**:

- (none yet) — #9 (`.docx` renderer) plugs into `RENDERERS` and needs no change here.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `src/prompt.js` (all 59 lines) — Why: `SYSTEM` is the prompt validated by the spike. **Do not
  rewrite it.** `buildMessages` (lines 42-59) holds the block wording you will factor out.
- `src/pack.js` (lines 32-84 `PACK_SCHEMA`, lines 100-117 `assertPack`) — Why: the schema goes
  into the pasted prompt as text, and `assertPack` guards the paste coming back.
- `src/provenance.js` (lines 37-78 `verifyPack`, lines 81-87 `provenanceSummary`) — Why: the
  seam's whole reason to exist. Note it takes `{ cv, clientNote }` only — **the brief is not a
  haystack**, so `/api/verify` never needs the brief.
- `src/render/index.js` (all 33 lines) — Why: `render(pack, rendererId)` and `RENDERERS`; the
  renderer id comes from `GET /api/agency`, never from a menu on the screen.
- `src/store.js` (lines 152-159 `getClient`, 209-225 `getAgency`, 279-303 `recordEvent`,
  31-38 `StoreError`) — Why: everything the two Functions call.
- `src/http.js` (all 59 lines) — Why: `json()`, `readJson()`, `sameOrigin()`, `errorResponse()`.
  The new Functions use all four, unchanged.
- `functions/api/events.js` (all 52 lines) — Why: **the template for both new Functions.** The
  `ALLOWED` set guard (lines 12-14, 27-31) is the pattern for a body vocabulary that must not
  quietly widen. Copy its shape exactly.
- `functions/api/clients/[id].js` — Why: the `getClient` + partial-update adapter shape.
- `public/clients.js` (all 446 lines) — Why: **the idiom for `app.js`.** In particular: the
  `api()` helper and its content-type check for an expired Access session (lines 90-101), the
  `messageFor()` fallback pattern (lines 110-120), `setBusy()` using `aria-disabled` rather than
  `disabled` (lines 215-218), the request-id guards on `load`/`save` (lines 258, 264, 290, 307),
  and the `beforeunload` guard (lines 438-442). `var`, IIFE, `"use strict"`, `.then()` chains —
  no `async/await`, no `const`/`let`. Match it.
- `public/app.css` (all 374 lines) — Why: the component grammar (`.btn`, `.field`, `.input`,
  `.textarea`, `.card`, `.client-row`, `.save-state`, `.rail`) that this screen extends. Its
  header comment says #8 absorbs it, *"written as a shared component grammar … so that
  absorption is a move rather than a rewrite."*
- `public/tokens.css` (all 71 lines) — Why: every value. Lines 42-46 reserve the provenance
  tokens and say *"#8 makes them legible"* — that is a task here.
- `public/clients.html` (all 111 lines) — Why: the markup idiom, the `role="status"` live
  regions, and the rail/editor grid this screen mirrors.
- `test/store.test.js` (lines 1-60) and `test/helpers/fake-d1.js` (all 63 lines) — Why: the test
  idiom and the D1 fake. `fakeD1([...])` queues one result per `prepare()`, **in call order** —
  get the order wrong and the assertions pass against the wrong row.
- `test/smoke.test.js` (all 117 lines) — Why: how the spike fixtures (`spike/pack.json`,
  `spike/inputs/cv.md`, `spike/inputs/client-note.md`) are used as real model output.
- `test/schema.test.js` — Why: the precedent for a test that **parses a repo file and asserts a
  property of it**. `test/tokens.test.js` is the same move applied to the palette.
- `.claude/probes/clients-screen.mjs` (read the header, lines 1-40) — Why: the browser-probe
  pattern. `node --test` has no DOM, and this screen has the same response-ordering hazards.
- `.claude/skills/dossier-design/SKILL.md`, `references/CRAFT.md`, `references/CHECKLIST.md` —
  Why: **mandatory.** CRAFT before any CSS, CHECKLIST before committing.
- `README.md` lines 50-118 (Decisions) and 119-165 (Standing constraints, Engine and config).
- `DEPLOY.md` lines 302-372 (§5b Secrets · none, §6 smoke checklist, Deliberately deferred).

### New Files to Create

- `src/paste.js` — extract a pack object from whatever the recruiter pasted back
- `functions/api/prompt.js` — `POST /api/prompt`, the outbound half of the seam
- `functions/api/verify.js` — `POST /api/verify`, the inbound half
- `public/app.js` — the one screen's behaviour
- `public/_headers` — three cheap response headers (Phase 5)
- `test/paste.test.js` — the extractor's adversarial suite
- `test/prompt.test.js` — the paste-prompt builder
- `test/seam.test.js` — both Functions driven directly with `fakeD1`
- `test/tokens.test.js` — the contrast gate over `public/tokens.css`
- `.claude/probes/one-screen.mjs` — browser probe for the screen's async sequencing

### Files to Update

- `src/prompt.js` — factor the blocks, add `buildPastePrompt`, `INPUT_MAX`, `cleanInput`
- `public/tokens.css` — legible provenance tokens
- `public/index.html` — becomes the one screen
- `public/app.css` — the new components
- `README.md`, `DEPLOY.md`, `spike/README.md` — the decisions and the runbook

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [MDN — `ClipboardItem`](https://developer.mozilla.org/en-US/docs/Web/API/ClipboardItem)
  - Specific section: the constructor, and `navigator.clipboard.write()`
  - Why: the one copy action must put **both** `text/html` and `text/plain` on the clipboard so
    a paste into Gmail or Outlook keeps the formatting and a paste into an ATS field does not.
- [MDN — `Clipboard.write()` § Security considerations](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/write#security_considerations)
  - Why: transient user activation. In Safari the `ClipboardItem` must be constructed
    **synchronously inside the click handler** — an `await` before it loses the gesture and the
    write silently rejects. Keep the payload in state and build the item synchronously.
- [MDN — `FileReader.readAsText()`](https://developer.mozilla.org/en-US/docs/Web/API/FileReader/readAsText)
  - Why: the upload half of #8 AC2.
- [MDN — `beforeunload`](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event)
  - Why: `event.preventDefault()` **and** `event.returnValue = ""` — both, as `clients.js:440`
    already does. Only fires on document unload; same-document history needs `popstate` too.
- [Cloudflare Pages — Functions routing](https://developers.cloudflare.com/pages/functions/routing/)
  - Why: `functions/` at the repo root, never under `public/`. `functions/api/verify.js`
    exports `onRequestPost`.
- [Cloudflare Pages — `_headers`](https://developers.cloudflare.com/pages/configuration/headers/)
  - Why: Phase 5's file format.
- [WCAG 2.2 — Contrast (Minimum) 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
  - Why: the 4.5:1 body-text floor `test/tokens.test.js` enforces.

### Patterns to Follow

**Function adapter shape** — `functions/api/events.js:16-46`, verbatim structure:

```js
export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.DB) return json({ error: "not_configured" }, 503);
  if (!sameOrigin(request)) return json({ error: "cross_origin" }, 403);

  try {
    const body = await readJson(request);
    const unexpected = Object.keys(body ?? {}).filter((key) => !ALLOWED.has(key));
    if (unexpected.length) {
      return json({ error: "unexpected_fields", fields: unexpected }, 400);
    }
    // … delegate to src/ …
  } catch (err) {
    return errorResponse(err);
  }
}
```

**Error vocabulary** — lowercase snake_case codes on a `StoreError` carrying its own status
(`src/store.js:31-38`). `errorResponse` returns `{ error: code }` and **never the message**, so
a message may name a field but must never carry candidate content.

**Front-end idiom** — `public/clients.js`. ES5 style inside an IIFE, a `COPY` object holding
every visible string, an `el` map resolved once, `.then()` chains, and a request-id guard on
anything that writes to the screen after a round trip:

```js
var reqId = id;
return api("/api/…").then(function (body) {
  if (state.selected !== reqId) return;   // a later click already owns the screen
  // … write to the DOM …
});
```

**CSS discipline** — `public/app.css` header: *"Every colour, size, radius, spacing and duration
below resolves through a custom property in tokens.css. There is no raw hex and no one-off type
or spacing literal."* Explicit `transition` property lists, never `transition: all`.

**Comment register** — this repo's comments say *why a decision was made and what breaks
without it*, often naming the bug that motivated it. Match that. Do not narrate what the code
does.

---

## IMPLEMENTATION PLAN

### Phase 1: The palette correctness fix

**Independent of:** Phases 2 and 3. Can be done first, last, or in parallel.

`--verified` and `--unverified` are currently aliases of `--success` (#22c55e) and `--warning`
(#c68a0b). Measured: **2.28:1** and **2.98:1** on `--background`. CHECKLIST.md makes 4.5:1 a
MUST for text and *"any new colour pairing gets its contrast checked at definition time."* The
provenance mark is the product's most load-bearing piece of text. Fix the tokens before any
component uses them, and add the gate that keeps them fixed.

**Tasks:** redefine the three provenance tokens with measured ratios recorded in the comment;
drop the two orphaned tokens; add `test/tokens.test.js`.

### Phase 2: The seam

**Independent of:** Phase 1.

Two Functions and two small pure modules. Everything here is testable with `node --test` —
including the Functions themselves, which **can** be imported and driven with `fakeD1`
(verified 27 Jul 2026 against `functions/api/agency.js`).

**Tasks:** factor `src/prompt.js`'s blocks and add `buildPastePrompt` + input validation; write
`src/paste.js`; write both Functions; write three test files.

### Phase 3: The screen

**Depends on:** Phase 2 (the screen is a client of both routes) and Phase 1 (it renders the
provenance tokens).

Design plan first — the `dossier-design` skill mandates plan-then-critique before code. The plan
is in **NOTES → Design plan** below; read it, critique it against *"would I have produced this
for any similar brief?"*, revise if yes, then build.

**Tasks:** `public/index.html`, `public/app.css` additions, `public/app.js`.

### Phase 4: Proving it

**Depends on:** Phase 3.

`node --test` has no DOM and this screen's real hazards are async sequencing — which response
lands first, what the screen does with a response that arrived after the recruiter moved on.
Reasoning about that in prose is what let the #5 bugs ship. Measure it in a browser probe
instead, and then walk the flow by hand against the ten-minute guardrail.

### Phase 5: The record

**Depends on:** Phase 4 (do not write "done" before it is).

README Decisions, DEPLOY.md smoke checklist and deferral list, `spike/README.md`'s pending
latency row, and `public/_headers`.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently
testable.

### UPDATE `public/tokens.css`

- **IMPLEMENT**: Replace lines 42-46 (the provenance block) and remove `--success` and
  `--warning` from lines 22-23. New block:

  ```css
  /* provenance status. Whether a claim is sourced is this product's core distinction, so these
     are text colours and are held to the 4.5:1 body-text floor rather than to the 3:1 a
     decorative state colour could take — the mark carries the WORD ("Unverified"), and a word
     is text. Measured on --background / --surface, the two surfaces they render on:
       --verified   7.13:1 / 6.54:1
       --unverified 6.33:1 / 5.81:1
       --failed     8.02:1 / 7.35:1
     They replace aliases of --success (#22c55e, 2.28:1) and --warning (#c68a0b, 2.98:1), which
     both failed the floor. Those two tokens are gone rather than left orphaned: nothing else
     referenced them. test/tokens.test.js is the gate that keeps these numbers true.
     --failed is its own red rather than var(--danger) so it separates from --unverified at
     12px; --danger stays the state-line error colour. */
  --verified:   #166534;
  --unverified: #8a5300;
  --failed:     #9f1239;
  ```
- **PATTERN**: `public/tokens.css:15-19` — the `--text-muted` precedent: the measured numbers
  live in the comment beside the value.
- **GOTCHA**: `--success` / `--warning` are referenced *only* by these aliases (verified by
  grep across `public/`, `src/`, `functions/`). Removing them breaks nothing. Do not remove
  `--danger` — `app.css:296` uses it.
- **VALIDATE**: `grep -rn -- "--success\|--warning" public/ src/ functions/ | grep -v "^public/tokens.css:2[23]:"` returns nothing
- **SATISFIES**: #8 AC4 (the marks have to be legible to be a marking)

### CREATE `test/tokens.test.js`

- **IMPLEMENT**: Parse `public/tokens.css` for `--name: #hex;` declarations, compute WCAG 2.x
  relative luminance and contrast, and assert a floor for every pairing that actually renders:

  | Foreground | Background | Floor | Why |
  |---|---|---|---|
  | `--text-primary` | `--background`, `--surface` | 4.5 | body text |
  | `--text-muted` | `--background`, `--surface` | 4.5 | row meta, captions |
  | `--verified`, `--unverified`, `--failed`, `--danger` | `--background`, `--surface` | 4.5 | the marks are words |
  | `--text-primary` | `--accent` | 4.5 | `.btn-primary`'s label |
  | `--border` | `--background`, `--surface` | 3.0 | a border that encodes grouping |

  Also assert that every `--verified` / `--unverified` / `--failed` value is a literal hex and
  not a `var()` alias, so a future edit cannot re-alias its way under the floor.
- **PATTERN**: `test/schema.test.js` — a test that parses a repo file and asserts a property of
  it, rather than testing a function. Same idea, same zero dependencies.
- **IMPORTS**: `node:test`, `node:assert/strict`, `node:fs`, `node:path`, `node:url`. Nothing
  else — `node --test` runs with no dependencies and must pass on Node v20 as well as v24.
- **GOTCHA**: the sRGB transfer function is piecewise: `s <= 0.04045 ? s/12.92 :
  ((s+0.055)/1.055)**2.4`. Getting the threshold branch wrong shifts every dark colour and the
  gate passes things it should fail.
- **VALIDATE**: `node --test test/tokens.test.js`
- **SATISFIES**: CHECKLIST.md's *"any new colour pairing gets its contrast checked at definition
  time, not discovered in review"*

### UPDATE `src/prompt.js`

- **IMPLEMENT**: three things, in this order.

  1. Factor the two block strings out of `buildMessages` so the API shape and the paste shape
     cannot drift:

     ```js
     export const noteBlock = (clientName, clientNote) =>
       `Here is what our agency knows about ${clientName}, from our own notes:\n\n` +
       `<client_note>\n${clientNote}\n</client_note>`;

     export const inputsBlock = (brief, cv) =>
       `Here is the client's brief:\n\n<brief>\n${brief}\n</brief>\n\n` +
       `Here is the candidate's CV:\n\n<cv>\n${cv}\n</cv>\n\nWrite the submission pack.`;
     ```

     Rewrite `buildMessages` to use them. **Its output must be byte-identical to today's** —
     that is what the test asserts.

  2. Add `buildPastePrompt`, the one string a recruiter pastes into their own Claude session:

     ```js
     export function buildPastePrompt({ clientName, clientNote, brief, cv }) { … }
     ```

     Order: `SYSTEM`, blank line, `noteBlock(...)`, blank line, `inputsBlock(...)`, blank line,
     then the output instruction. The instruction has to do the job `output_config.format` did
     on the API path, so it must be explicit:

     ```
     Return ONE JSON object and nothing else — no preamble, no commentary after it. Put it in
     a single ```json fenced block. It must match this JSON Schema exactly:

     <the schema>
     ```

     Serialise with `JSON.stringify(PACK_SCHEMA, null, 2)`. The schema's `description` fields
     are load-bearing instructions (`pack.js:20-24` is the verbatim-quote rule) — do not strip
     them to save tokens.

  3. Move input validation here from the reverted `src/generate.js` (`git show
     3d72737:src/generate.js`, lines 44-56 — read it, the reasoning in its comments is sound):

     ```js
     export const INPUT_MAX = 100_000;
     export function cleanInput(raw, field) { … }   // throws StoreError missing_fields / too_long
     ```
- **PATTERN**: the reverted `src/generate.js` for `cleanInput`; `src/store.js:78-119` for the
  `StoreError(code, status, "field: what is wrong")` message shape.
- **IMPORTS**: add `import { PACK_SCHEMA } from "./pack.js";` and
  `import { StoreError } from "./store.js";`
- **GOTCHA**: `SYSTEM` was validated against a real pack under timing (#2). **Do not edit a
  word of it.** The only new prose in this file is the output instruction, which exists because
  a chat session has no `output_config`.
- **GOTCHA**: `buildMessages` stays. It is unused today, and the revert message deliberately
  kept the API door open (*"the API door is still there when an agency is self-serving enough
  to want it"*). Do not delete it and do not add `cache_control` anywhere new.
- **VALIDATE**: `node --test test/prompt.test.js`
- **SATISFIES**: #6 AC2 (the note is loaded and used), #6 AC3-as-amended (the schema reaches the
  model as text rather than as `output_config.format`)

### CREATE `test/prompt.test.js`

- **IMPLEMENT**: assert the properties that matter, not the prose.
  - `buildMessages` output is unchanged by the refactor — pin the exact strings of both content
    blocks and the `cache_control` marker on the first one.
  - `buildPastePrompt` contains `SYSTEM` verbatim, the client name, the note, the brief and the
    CV, and the serialised schema.
  - The note appears **before** the brief and the CV in the string (the reason the API path
    cached it is also the reason a reader should meet it first).
  - The prompt asks for one JSON object in a fenced block.
  - `cleanInput` rejects `""`, `"   "`, `null`, `undefined` with `missing_fields`, and a
    `INPUT_MAX + 1` string with `too_long`; accepts exactly `INPUT_MAX` and trims.
  - **Round trip:** `extractPack(fencedJson(somePack))` from `src/paste.js` returns a value that
    `assertPack` accepts — i.e. the schema you ask for is the schema you can parse.
- **PATTERN**: `test/store.test.js`'s `codeOf()` helper (lines ~55-60) for asserting error codes.
- **VALIDATE**: `node --test test/prompt.test.js`
- **SATISFIES**: #6 AC3-as-amended

### CREATE `src/paste.js`

- **IMPLEMENT**: `export function extractPack(raw)` — takes whatever the recruiter pasted,
  returns a parsed object, throws `StoreError("no_pack", 400, …)` when there is no object in it.

  Try in order:
  1. `JSON.parse(raw.trim())` — the clean case.
  2. The contents of the first ` ```json ` or bare ` ``` ` fenced block.
  3. A **brace-matched scan** from the first `{`: walk the string tracking depth, and while
     inside a JSON string literal ignore braces and honour `\` escapes. Parse the balanced span.

  Nothing fuzzy beyond that. If none of the three parses, throw.
- **PATTERN**: `src/provenance.js`'s stance — a deterministic check with no judgment in it. The
  same discipline applies here: this recovers a JSON object from a chat reply, it does not
  repair malformed JSON.
- **IMPORTS**: `import { StoreError } from "./store.js";`
- **GOTCHA**: a naive `raw.indexOf("{")` … `raw.lastIndexOf("}")` looks like it works and breaks
  the moment the model writes a closing brace in the prose after the block, or a `}` inside a
  quoted `source_quote`. The string-aware scan is the point of this module.
- **GOTCHA**: `400`, not `502`. On the API path a malformed reply was a model fault; here the
  recruiter pasted the wrong thing, which is a caller fault with a caller remedy. DEPLOY.md's
  triage table reads 5xx as *deployment* fault — do not pollute that signal.
- **GOTCHA**: never put the pasted text into the thrown message. It is candidate data.
- **VALIDATE**: `node --test test/paste.test.js`
- **SATISFIES**: #8 AC7 (honest failure states)

### CREATE `test/paste.test.js`

- **IMPLEMENT**: adversarial, in the bias of `test/provenance.test.js` — the cases that would
  let something through, not the happy path.
  - bare JSON; ` ```json ` fenced; bare ` ``` ` fenced; leading prose; trailing prose
  - trailing prose that contains `}` ("…let me know if you'd like {anything} changed")
  - a `source_quote` containing `{`, `}`, an escaped `\"`, and a `\\` before a quote
  - two fenced blocks — the first one wins
  - empty string, whitespace, prose with no object at all, truncated JSON → `no_pack`, and the
    thrown message contains none of the input
  - the real thing: `extractPack` over a fenced `spike/pack.json` survives `assertPack` and
    `verifyPack` against `spike/inputs/*.md` with zero failures
- **VALIDATE**: `node --test test/paste.test.js`
- **SATISFIES**: #8 AC7

### CREATE `functions/api/prompt.js`

- **IMPLEMENT**:

  ```
  POST /api/prompt { client_id, brief, cv } -> 200 { prompt, client: { id, name } }
  ```

  In order: `!env.DB` → 503 `not_configured`; `!sameOrigin` → 403 `cross_origin`; `readJson`;
  `ALLOWED = new Set(["client_id", "brief", "cv"])` → 400 `unexpected_fields`;
  `getClient(env.DB, body.client_id)` → 404 `not_found`; **empty note → 400 `note_empty`**;
  `cleanInput` both inputs; `buildPastePrompt` → `json({ prompt, client: { id, name } })`.

  Return only `id` and `name` from the client row — **never the note**. The screen has no use
  for it, and `store.js:44-48` already makes that argument about the list query.
- **PATTERN**: `functions/api/events.js` structure verbatim; the `not_found`-before-work ordering
  from the reverted `functions/api/generate.js` (*"404 before the model call, not after"*).
- **IMPORTS**: `{ getClient } from "../../src/store.js"`,
  `{ buildPastePrompt, cleanInput } from "../../src/prompt.js"`,
  `{ json, readJson, sameOrigin, errorResponse } from "../../src/http.js"`
- **GOTCHA**: the empty-note refusal is a product decision, not a validation nicety. A client
  with no note is a real state, and the note is the one thing the pack has that a job board does
  not — generating without it produces a pack whose whole premise is missing. Refuse, and let
  the screen send the recruiter to `/clients?client=<id>`. Check `String(note ?? "").trim()`,
  so a note of only whitespace is also empty.
- **GOTCHA**: this Function receives a CV. It is held for the life of the request and written
  nowhere — not to D1, not to a `console.log`, not into an error message. Put that sentence in
  the file header, as `functions/api/events.js:12-14` does for its own boundary.
- **VALIDATE**: `node --test test/seam.test.js`
- **SATISFIES**: #6 AC1-as-amended, AC2, AC9

### CREATE `functions/api/verify.js`

- **IMPLEMENT**:

  ```
  POST /api/verify { client_id, cv, pack_text, duration_ms }
    -> 201 { pack, provenance, failures, renderer, text, html, event_recorded }
  ```

  In order: `!env.DB` → 503; `!sameOrigin` → 403; `readJson`;
  `ALLOWED = new Set(["client_id", "cv", "pack_text", "duration_ms"])`;
  `getClient` → the note for the haystack; `getAgency` → `renderer`;
  `extractPack(body.pack_text)`; `assertPack`, wrapped so its plain `Error` becomes
  `StoreError("bad_pack", 400, err.message)`; `verifyPack(pack, { cv: body.cv, clientNote:
  client.note })`; `render(pack, agency.renderer)`; `recordEvent` inside its own try/catch
  setting `event_recorded`; `json({...}, 201)`.
- **PATTERN**: the reverted `functions/api/generate.js` (`git show
  3d72737:functions/api/generate.js`) — its `event_recorded` reasoning is right and transfers
  unchanged: *"The pack is the product and the recruiter has waited minutes for it — losing it
  to a failed COUNT insert is indefensible."*
- **IMPORTS**: `{ getClient, getAgency, recordEvent } from "../../src/store.js"`,
  `{ extractPack } from "../../src/paste.js"`, `{ assertPack } from "../../src/pack.js"`,
  `{ verifyPack, provenanceSummary } from "../../src/provenance.js"`,
  `{ render } from "../../src/render/index.js"`,
  `{ json, readJson, sameOrigin, errorResponse } from "../../src/http.js"`,
  `{ StoreError } from "../../src/store.js"`
- **GOTCHA**: `verifyPack` takes `{ cv, clientNote }` and **not the brief** — the brief is not a
  source type (`pack.js:8`). Do not accept a `brief` field here; a body vocabulary that grows
  "just in case" is the thing `ALLOWED` exists to stop.
- **GOTCHA**: the `cv` sent here **must be the exact text that went into the prompt**, not the
  live textarea value. The screen enforces that by freezing the inputs when the prompt is
  copied (see `app.js` below). If they differ, claims demote — the check fails closed, which is
  correct, but the recruiter sees a pack that looks worse than it is.
- **GOTCHA**: `assertPack` throws a plain `Error`, and `errorResponse` maps anything that is not
  a `StoreError` to `500`. Without the wrap, a malformed paste reads as a deployment fault.
  Wrap it. `errorResponse` returns only `{ error: code }`, so `assertPack`'s message (which
  names a field, e.g. `pack: evidence[0].source_type is probably`) never reaches the wire —
  keep it that way, and let the screen supply the human copy.
- **GOTCHA**: `duration_ms` is measured by the browser (see the honesty note in NOTES). Do not
  invent a server-side measurement around a call that no longer happens here.
- **VALIDATE**: `node --test test/seam.test.js`
- **SATISFIES**: #6 AC1-as-amended, AC2, AC6, AC7-as-amended, AC8-as-amended, AC9; #8 AC3, AC4

### CREATE `test/seam.test.js`

- **IMPLEMENT**: import both Functions and drive them directly with a fake context
  `{ request: new Request(url, {...}), env: { DB: fakeD1([...]) } }`. **This works** — verified
  27 Jul 2026: `Request`, `Response` and `crypto.randomUUID` are Node globals, and the Functions
  are plain ES modules. (`src/store.js:5-7` says a Function cannot be imported into `node
  --test`; that claim is wrong. Leave the comment alone — it is not this ticket's to fix — but
  do not let it stop you writing this file.)

  Cover:
  - `/api/prompt`: happy path returns a prompt containing the note and the CV; **the response
    body never contains the note under any key other than inside `prompt`** — assert
    `body.client.note === undefined`; `no DB` → 503 `not_configured`; cross-origin → 403;
    `{}` and `null` bodies → 400 `bad_json`; an extra key → 400 `unexpected_fields`; unknown
    client → 404; whitespace-only note → 400 `note_empty`; empty brief → 400 `missing_fields`;
    over-long CV → 400 `too_long`.
  - `/api/verify`: happy path over `spike/pack.json` fenced, against `spike/inputs/*.md` →
    201, `failures` empty, `provenance.total === 14`, `text` and `html` both non-empty,
    `renderer` is the agency row's; a **tampered quote** comes back `source_type:
    "unverified"` with `failed_quote` set and is **still present in the pack** (never dropped);
    garbage `pack_text` → 400 `no_pack`; a pack with a bad `source_type` → 400 `bad_pack` and
    **not** 500; a `recordEvent` failure still returns 201 with `event_recorded: false`; the
    `INSERT INTO events` statement's recorded SQL mentions no column outside `client_id` and
    `duration_ms`.
- **PATTERN**: `test/store.test.js` for `fakeD1` queueing and SQL assertions; `test/smoke.test.js`
  for reading the spike fixtures.
- **GOTCHA**: `fakeD1` queues **one result per `prepare()` call, in order**. `/api/verify` calls
  `getClient` (1), `getAgency` (2), then `recordEvent` → `requireClient` (3) + `INSERT` (4).
  Queue four. Get this wrong and the agency row answers as the client row and the test passes
  for the wrong reason.
- **GOTCHA**: `sameOrigin` reads `Sec-Fetch-Site`, then `Origin`. A `new Request(...)` with
  neither passes (`http.js:47` — *"curl and local scripts have no Origin"*). To test the 403
  branch you must set `Sec-Fetch-Site: cross-site` explicitly.
- **VALIDATE**: `npm test`
- **SATISFIES**: #6 AC6 (proven, not asserted in prose)

### UPDATE `public/index.html`

- **IMPLEMENT**: replace the deployment shell with the one screen. `lang="en-GB"` (as
  `clients.html` has, and `index.html` currently does not). Structure, matching the ASCII
  wireframe in NOTES:

  - `.page-head` — `<h1>Submission pack</h1>` + a one-line sub.
  - `.workspace` grid: `.rail` (clients) + `.stage` (the three acts).
  - **Rail**: `#client-list`, `#rail-empty`, `#rail-state` (`role="status"`), and a link to
    `/clients` ("Write client notes"). No add-client form — that lives on `/clients`.
  - **Act 1 `#act-inputs`**: two labelled `<textarea>` (`#brief`, `#cv`), each with a
    `<input type="file">` beside it; `#copy-prompt` (`.btn .btn-primary`, label "Copy the
    prompt"); `#inputs-state` (`role="status"`).
  - **Act 2 `#act-waiting`** (`hidden`): the instruction, `#elapsed` (`aria-hidden="true"`), a
    `<textarea id="reply">` for the pasted reply, `#read-pack` ("Read the pack"),
    `#waiting-state` (`role="status"`), and `#start-again` (`.btn`, "Start again").
  - **Act 3 `#act-pack`** (`hidden`): `#provenance-summary`, `#pack-body`, `#copy-pack`
    ("Copy the pack"), `#renderer-note`, `#pack-state` (`role="status"`), `#start-again-2`.
  - `<script src="/app.js"></script>` last, no `defer` needed (it is last in `<body>`, matching
    `clients.html:109`).
- **PATTERN**: `public/clients.html` — every idiom, including the comment above `#rail-state`
  explaining why each act owns its own live region (a `role="status"` inside a `hidden` subtree
  is not in the accessibility tree, so a shared one would go silent).
- **GOTCHA**: three `role="status"` regions, one per act, for exactly that reason. Do not
  centralise them.
- **GOTCHA**: `<label for>` on every control. `#brief` and `#cv` are the two controls a recruiter
  uses under time pressure; a placeholder is not a label.
- **VALIDATE**: `python3 scripts/dev.py` then `curl -s localhost:8788/ | grep -c 'id="act-'` → 3
- **SATISFIES**: #8 AC1, AC2, AC9

### UPDATE `public/app.css`

- **IMPLEMENT**: append new component rules. Do not touch the existing ones — the header comment
  says this file was written so #8's absorption is *"a move rather than a rewrite"*, and it is.
  New rules, all through custom properties:
  - `.stage { min-width: 0 }` — the grid column holding pasted CVs. The Safari/Chrome blowout
    trap CRAFT.md names; `.editor` already does this at line 183.
  - `.act` — the three zones. Rhythm **between** acts (`--space-12`) visibly larger than within
    them (`--space-4`), so the pacing is whitespace and not dividers.
  - `.act-head` — reuse the `.rail-head` treatment (caption, uppercase, `0.08em`, `--text-muted`)
    so the numbering grammar is one system.
  - `.input-pair` — grid, `1fr 1fr` above 860px, one column below.
  - `.file-row` — the upload control and its hint.
  - `.elapsed` — `--font-mono`, `--text-body`, `--text-muted`, `font-variant-numeric:
    tabular-nums` so the seconds do not jitter the layout.
  - `.pack` — the preview surface: `--surface`, `--radius`, `--space-6`, `max-width: 68ch`
    (CRAFT's 65-75ch measure), `font-size: var(--text-note)`.
  - `.claim`, `.claim-text`, `.claim-source` — the signature element. `.claim-source` is
    `--text-caption`… **no**: CRAFT says nothing visible below 12px and prefers 16px for the
    pack; use `--text-body` for the quote and `--text-caption` only for the mark.
  - `.mark`, `.mark-cv`, `.mark-note`, `.mark-unverified`, `.mark-failed` — the provenance mark.
    Colour from `--verified` / `--unverified` / `--failed`, **plus** the word, **plus** a left
    border on the claim for the two unverified states. Three signals, none of them colour alone.
  - `.pack-summary` — "12 sourced · 2 unverified".
  - `@media (min-width: 860px)` for the workspace split, mirroring line 174.
- **PATTERN**: `public/app.css` throughout. Explicit `transition` property lists (line 96-97),
  `:active { transform: translateY(1px) }` for press feedback, `--tap-target` min-height on
  anything pressable.
- **GOTCHA**: zero raw hex, zero one-off px. If you need a value that is not a token, add the
  token to `tokens.css` first and give it a measured contrast comment if it is a colour.
- **GOTCHA**: no `transition: all`, no entrance animation on `#pack-body` — it is rebuilt
  wholesale, and CHECKLIST forbids entrances on nodes rebuilt per render. The one authored
  moment is the act transition; `opacity` only, `--duration-2`, `--ease-out`.
- **GOTCHA**: the existing `@media (prefers-reduced-motion: reduce)` block at line 372 is the
  last rule in the file. Keep it last.
- **VALIDATE**: `grep -nE '#[0-9a-fA-F]{3,8}\b' public/app.css` returns nothing;
  `grep -n 'transition: *all' public/app.css` returns nothing
- **SATISFIES**: #8 AC4, AC9

### CREATE `public/app.js`

- **IMPLEMENT**: the screen. Structure, in `clients.js`'s idiom (IIFE, `"use strict"`, `var`,
  `.then()` chains, a `COPY` object, an `el` map):

  **State machine.** `state.phase` is one of `"inputs"` | `"waiting"` | `"pack"`.

  ```
  inputs  --[Copy the prompt succeeds]-->  waiting  --[Read the pack succeeds]-->  pack
     ^                                        |                                     |
     └────────────[Start again]───────────────┴─────────────────────────────────────┘
  ```

  `state = { selected, phase, sent: null, startedAt: null, tick: null, clipboard: null,
  reqId: 0 }`.

  **Act 1 → 2, `#copy-prompt`:**
  1. Guard: a client selected, brief and CV both non-empty. Otherwise message and focus the
     offender.
  2. `POST /api/prompt { client_id, brief, cv }`, guarded by a captured `reqId` and
     `state.selected`.
  3. On success, **synchronously in the same handler**, `navigator.clipboard.writeText(prompt)`.
     If that rejects (permission, insecure context), stay in `inputs`, show the prompt in a
     `readonly` textarea the recruiter can select manually, and say so.
  4. Snapshot `state.sent = { brief: brief, cv: cv }`, set both textareas `readonly`, start the
     clock (`state.startedAt = Date.now()`, `setInterval` at 1000ms updating `#elapsed`), move
     to `waiting`.

  **Act 2 → 3, `#read-pack`:**
  1. `POST /api/verify { client_id, cv: state.sent.cv, pack_text: reply, duration_ms:
     Date.now() - state.startedAt }`.
  2. On success: stop the clock, build the preview from `body.pack`, stash
     `state.clipboard = { text: body.text, html: body.html }`, move to `pack`.
  3. On failure: stay in `waiting`, keep the pasted reply on screen, message from `messageFor`.

  **The copy action, `#copy-pack`:** build the `ClipboardItem` **synchronously** from
  `state.clipboard` inside the click handler — no `await` before it, or Safari loses the
  gesture. Two flavours, `text/html` and `text/plain`. Fall back to
  `navigator.clipboard.writeText(state.clipboard.text)` if `window.ClipboardItem` is undefined.

  **The preview, `renderPack(pack, provenance)`:** build the DOM with `createElement` and
  `textContent`, **never `innerHTML`** — same rule as `clients.js:156`. For each claim in
  `evidence` (with its `requirement`), `process_fit` and `gaps`:
  - `.claim-text` — `claim.text`
  - `.mark` — the word: `cv` → "CV", `client_note` → "Our note", `unverified` with no
    `failed_quote` → "Unverified", `unverified` **with** `failed_quote` → "Quote not found"
  - `.claim-source` — the quote, whitespace-collapsed for display only
    (`String(q).replace(/\s+/g, " ").trim()`, mirroring `src/render/text.js:33`). For a failed
    claim, show `failed_quote` under the "Quote not found" mark, so a bad pack is diagnosable.
  - `open_questions` as a plain list under "Before you send this".

  **Error codes → copy** (`messageFor`, extending `clients.js:110-120`):

  | code | copy |
  |---|---|
  | `session_expired` | "Your session expired. Reload the page to sign in again." |
  | `not_configured` | "This deployment is not connected to its database. Nothing can be read or saved yet." |
  | `not_migrated` | "This deployment's database has no tables yet." |
  | `note_empty` | "There is no note for this client yet. Write down how they hire, then come back." + a link to `/clients?client=<id>` |
  | `not_found` | "That client does not exist. Pick one from the list." |
  | `missing_fields` | "Paste the brief and the CV before you copy the prompt." |
  | `too_long` | "That is longer than 100,000 characters. Shorten it and try again. Your text is still here." |
  | `no_pack` | "That does not look like a pack. Copy the whole of Claude's reply, including the JSON block, and paste it again." |
  | `bad_pack` | "Claude's reply is missing something the pack needs. Ask it to try again, then paste the new reply." |
  | anything else | per-act fallback, never the save copy |

  **Guards, all of them load-bearing:**
  - **Client change while past `inputs`** → `window.confirm` naming the client the pack was
    built for, then reset to `inputs` and clear the reply and the pack. The brief and the CV
    stay — losing a paste is the real error state.
  - **Request-id guard** on both round trips (`clients.js:264, 307`). A response that arrives
    after the recruiter switched client must write nothing.
  - **`beforeunload`** when brief, CV or reply is non-empty, or a pack is on screen. Both
    `preventDefault()` and `returnValue = ""`.
  - **`popstate`** — the client id travels as `?client=<uuid>`, id only, never a name
    (`clients.js:231-237`). `beforeunload` does not fire for same-document history.
  - **`setBusy`** via `aria-disabled`, never `disabled` (`clients.js:215-218`).

  **Upload:** `FileReader.readAsText`. Accept `text/*`, `.txt`, `.md`. Anything else → "This
  reads plain text only. Open the file and paste the text instead." Over `INPUT_MAX` after
  reading → the `too_long` copy.
- **PATTERN**: `public/clients.js` end to end. Read all 446 lines before writing a line of this.
- **GOTCHA**: **nothing goes into browser storage.** No `localStorage`, no `sessionStorage`, no
  `indexedDB`, no `document.cookie`. Note `clients.js:11-12`: it deliberately avoids writing
  those API names even in comments, because the Level 1 grep gate greps this file for them.
  Do the same.
- **GOTCHA**: no candidate content in the URL. Only `?client=<uuid>`.
- **GOTCHA**: `#elapsed` is `aria-hidden="true"` and updates every second. A per-second live
  region is a screen-reader denial of service. The **phase change** is what gets announced,
  once, through the act's `role="status"`.
- **GOTCHA**: the elapsed clock is honest — real seconds since the prompt was copied. No fake
  percentage, no indeterminate spinner as the only signal (CHECKLIST MUST).
- **GOTCHA**: freeze the inputs on entering `waiting`. The `cv` sent to `/api/verify` must be
  the text the model actually saw, or the verifier compares against the wrong haystack.
- **GOTCHA**: **`clearInterval(state.tick)` and `state.tick = null` on every exit from
  `waiting`** — success, client switch, Start again, **and the `/api/verify` failure path**.
  Three of the four are easy to forget and only one is obvious. Two live intervals double the
  tick rate on `#elapsed`, and a stale one keeps `state.startedAt` arithmetic alive across a
  reset, so the next pack records a duration that includes the abandoned attempt. Clear it in
  one place — a `stopClock()` the transition calls — rather than at four call sites.
- **VALIDATE**: `grep -nE 'localStorage|sessionStorage|indexedDB|document\.cookie|innerHTML' public/app.js` returns nothing
- **SATISFIES**: #8 AC1, AC2, AC3, AC4, AC5, AC6-as-amended, AC7, AC9

### CREATE `.claude/probes/one-screen.mjs`

- **IMPLEMENT**: mirror `.claude/probes/clients-screen.mjs` — spawn Chrome over CDP, serve
  `public/`, stub `window.fetch` before `app.js` runs so **response order is controllable**.
  Probes:
  1. `/api/prompt` resolves **after** the recruiter switched client → nothing is copied, the
     screen stays in `inputs`, and the clock does not start.
  2. `/api/verify` resolves after a client switch → no pack is rendered under the wrong client.
  3. A failed `/api/verify` keeps the pasted reply and the frozen inputs on screen.
  4. `note_empty` renders its own copy with the `/clients` link, not the generic failure.
  5. A pack with one demoted claim renders the "Quote not found" mark and the `failed_quote`,
     and the claim is **present** in the DOM (never dropped).
  6. At a 360px viewport, `document.documentElement.scrollWidth <= innerWidth` with a
     120-character unbroken client name and a pasted CV line of 400 characters with no spaces.
  7. **The clock is stopped on every exit from `waiting`.** Copy the prompt, press Start again,
     copy the prompt a second time, then count `#elapsed` updates over three seconds — three,
     not six. The same after a failed `/api/verify` followed by Start again.
- **PATTERN**: `.claude/probes/clients-screen.mjs` — read its header and its harness. Node >= 22
  (global `WebSocket`), Chrome already on the machine, no npm dependency, **not** part of
  `npm test`.
- **VALIDATE**: `node .claude/probes/one-screen.mjs`
- **SATISFIES**: #8 AC4, AC7

### UPDATE `README.md`

- **IMPLEMENT**: three edits.
  1. **Status** (lines 10-37): generation and the screen are built; `/` is the tool.
  2. **Decisions**: rewrite the "Model access" entry to record what happened — the Function was
     built, reverted, and replaced by the two-route seam; and *why* (a Pages Function cannot
     refresh a subscription OAuth token, so a model call from Pages needs a per-token key, and
     there is no key). Say plainly what the seam costs: the recruiter makes one trip to their
     own Claude session. Say what it buys: no key and no per-agency billing.

     **On the data posture, write exactly the narrow claim and nothing broader.** #6 gates this
     wording: *"Anything stronger about provider-side retention is unverified and must not be
     claimed."* The posture is **not** "unchanged" — under the reverted design candidate text
     transited an API call this deployment configured; under the seam it transits the
     **recruiter's own Claude account**, a different arrangement whose retention and training
     defaults nobody here has verified. Write:

     > No new store of candidate data is created, and this deployment keeps no copy after the
     > pack is produced. What changed is where the model call happens: it now runs in the
     > recruiter's own Claude session rather than from Pages. Nothing is claimed here about
     > provider-side retention in either arrangement.

     Add the palette entry for the provenance tokens, in the shape of the existing
     `--text-muted` entry.
  3. **Engine and config**: add `functions/api/prompt.js`, `functions/api/verify.js`,
     `src/paste.js`, `public/app.js`, `public/index.html`, `public/_headers` to the engine list.
- **GOTCHA**: README's Decisions section opens *"Recorded here so they don't get re-litigated
  per ticket."* Write the entry so the next reader does not re-open it.
- **VALIDATE**: `grep -n "ANTHROPIC_API_KEY" README.md` — every hit still says there isn't one
- **SATISFIES**: the epic's record-keeping habit

### UPDATE `DEPLOY.md`

- **IMPLEMENT**:
  - §6 smoke checklist: `/` renders the one screen, not the shell. Add: a client can be picked,
    a prompt copied, a pasted pack verified and rendered, and the pack copied.
  - §5b stays "none" — restate that the seam did not add a secret.
  - Deferred list: **web fonts** re-deferred with the reason (Open Questions below); `_headers`
    marked partly done with CSP named as the remainder; the **Access service token** entry
    re-scoped — there is no Function-side model latency to measure automatically any more.
- **VALIDATE**: `grep -n "shell" DEPLOY.md` — no stale claim that `/` is a shell
- **SATISFIES**: the runbook stays true

### UPDATE `spike/README.md`

- **IMPLEMENT**: the "Still to record — the two numbers" table's *Generation latency* row says
  *"(pending — needs run.js and a key) … Deferred to #6."* That number is no longer coming.
  Replace it with what is actually measured: the **round trip**, copy-prompt to pack-on-screen,
  recorded per pack in `events.duration_ms` and readable at `GET /api/events`. Keep `run.js` and
  its row's history intact — the API path still exists as a door, it is just not this
  deployment's path.
- **VALIDATE**: `grep -n "Deferred to #6" spike/README.md` returns nothing
- **SATISFIES**: #6 AC8-as-amended

### CREATE `public/_headers`

- **IMPLEMENT**: three headers on `/*`: `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`. No CSP — see
  Non-Goals.
- **PATTERN**: DEPLOY.md's deferral entry names #8 as the revisit point.
- **GOTCHA**: this file is the one piece of scope the tickets imply through DEPLOY.md rather
  than state. **Cut it if you want the diff to be exactly the two tickets** — nothing else
  depends on it.
- **VALIDATE**: `curl -sI localhost:8788/ | grep -i x-content-type-options`
- **SATISFIES**: DEPLOY.md's `_headers` deferral

---

## TESTING STRATEGY

`node --test` with zero dependencies, on Node v20 (this machine's default) and v24. Plus a
browser probe that is run, not gated.

### Unit Tests

- `test/prompt.test.js` — the paste-prompt builder and input validation. Pins that the refactor
  left `buildMessages` byte-identical.
- `test/paste.test.js` — the extractor, adversarially. The bias of `test/provenance.test.js`:
  the cases that would let something through.
- `test/tokens.test.js` — the contrast gate over `public/tokens.css`.

### Integration Tests

- `test/seam.test.js` — both Functions driven directly with `fakeD1`, from HTTP body to rendered
  pack, over the real spike fixtures. This is where #6 AC6 becomes a proven property: a tampered
  quote comes back demoted, marked, and **present**.
- `npm test` — the whole suite, including the six existing files, unchanged.

### Manual / browser

- `node .claude/probes/one-screen.mjs` — the seven async and layout probes.
- `python3 scripts/dev.py` and the walkthrough in Level 4 below.

### Edge Cases

- Reply pasted with prose before and after the fenced JSON, including a `}` in the trailing
  prose.
- A `source_quote` containing `{`, `}`, `\"` and `\\`.
- Two fenced blocks in one reply.
- Client switched mid-flight on both round trips.
- Client note edited in `/clients` between prompt and verify → claims demote. Fail-closed, never
  a false pass. Correct behaviour; assert it.
- Client with a whitespace-only note.
- A 120-character unbroken client name at 360px (the exact bug `app.css:272-277` records).
- A pasted CV line of 400 characters with no spaces.
- `navigator.clipboard` unavailable (insecure context) — the manual-select fallback.
- `recordEvent` fails → 201 with `event_recorded: false`, pack intact.
- Access session expires mid-flow → HTML at 200 → the `session_expired` branch.

---

## VALIDATION COMMANDS

Execute every command to ensure zero regressions and 100% feature correctness.

### Level 1: Syntax & Style

```sh
# Data posture — the browser is as much a store as a database here.
grep -rnE 'localStorage|sessionStorage|indexedDB|document\.cookie' public/ && echo FAIL || echo ok

# "Written nowhere, and that includes logs" (#6 AC9). functions/api/prompt.js and
# functions/api/verify.js are the first two files in this repo to hold a CV server-side, and
# every other cross-cutting constraint here has a mechanical gate — this one had none. Verified
# clean 27 Jul 2026, so it passes on day one and bites the day someone debugs a paste failure
# with a console.log(body.cv).
grep -rn 'console\.' src/ functions/ && echo FAIL || echo ok

# No DOM injection of model output.
grep -n 'innerHTML' public/app.js && echo FAIL || echo ok

# Custom-property discipline: no raw hex outside tokens.css.
grep -rnE '#[0-9a-fA-F]{3,8}\b' public/app.css public/index.html && echo FAIL || echo ok

# Motion correctness.
grep -rn 'transition: *all' public/ && echo FAIL || echo ok

# The revert must stay reverted.
grep -rn 'anthropic\|nodejs_compat\|ANTHROPIC_API_KEY' src/ functions/ public/ wrangler.toml && echo FAIL || echo ok
grep -n '"@anthropic-ai/sdk"' package.json   # must be under devDependencies only

# Every function file parses.
for f in src/*.js src/render/*.js functions/api/*.js functions/api/clients/*.js public/*.js; do
  node --check "$f" || echo "FAIL $f"
done
```

### Level 2: Unit Tests

```sh
npm test                                   # node --test test/*.test.js
node --test test/paste.test.js test/prompt.test.js test/tokens.test.js
```

### Level 3: Integration Tests

```sh
node --test test/seam.test.js
npm test                                   # nothing existing regressed
```

### Level 4: Manual Validation

```sh
python3 scripts/dev.py                     # migrates the local D1, serves on :8788
```

Then, in a browser at `http://localhost:8788/`:

1. Add a client at `/clients` and paste `spike/inputs/client-note.md` into its note. Save.
2. Back at `/`, pick that client. Paste `spike/inputs/brief.md` and `spike/inputs/cv.md`.
3. **Copy the prompt.** Confirm the inputs freeze and the clock starts.
4. Paste the prompt into a Claude session. Paste the whole reply back. **Read the pack.**
5. Confirm: every claim carries a mark; any unverified claim carries the **word**; the summary
   counts agree with the marks.
6. **Copy the pack.** Paste into an email client — formatting survives. Paste into a plain text
   field — the appendix rendering survives.
7. **Time steps 2 to 6 with a stopwatch.** This is #8 AC8 and PRD §6 condition 2. Record the
   number in the implementation report. If it is over ten minutes, say so plainly — §5.2's lever
   is effort before the pack shrinks, and the density question does not reopen.
8. `curl -s localhost:8788/api/events` → the event landed, `duration_ms` is the round trip.
9. Repeat with a client whose note is empty → the `note_empty` copy and the `/clients` link.
10. Paste a reply with one quote paraphrased → the claim renders "Quote not found", shows the
    failed quote, and is still there.
11. At 360px: no horizontal scroll anywhere in the flow.
12. Keyboard only, no mouse, start to finish: pick client, paste, copy prompt, paste reply, read
    pack, copy pack. Tab order sane, focus visible at every stop, no trap.
13. **Both real Safari and real Chrome** (CHECKLIST MUST — a single bundled engine misses real
    blowouts). Serve on a fresh port per iteration; browser caching is aggressive.

### Level 5: Additional Validation

```sh
node .claude/probes/one-screen.mjs         # the seven async and layout probes (needs Node >= 22)
node spike/local.js                        # the mechanism still runs unchanged end to end
./scripts/deploy.py                        # only when everything above is green
```

---

## ACCEPTANCE CRITERIA

### AC disposition — read this before implementing

The subscription decision voids four of #6's criteria and changes the shape of four more.
**These issues need amending; that is the user's call, not the implementing agent's.** Do not
silently implement against the amended reading without the tracking issue saying so.

**#6 — Generation Function: the single model-call boundary**

| AC | Disposition |
|---|---|
| 1. `POST /api/generate`, #3's Function shape | **Changed** — two routes, `/api/prompt` and `/api/verify`, both in #3's shape (`not_configured` 503, `bad_json` 400, the local `json()` helper) |
| 2. Loads the client note from #5's store | **Satisfied** — both routes |
| 3. Calls `claude-opus-5` via `@anthropic-ai/sdk` with #4's schema | **Void.** The schema travels **in the prompt text** so the recruiter's own session honours it |
| 4. Prompt caching on the client note | **Void** — no API call to cache. The note still goes first in the prompt |
| 5. `max_tokens` sized with headroom | **Void** — the recruiter's session owns its own limits |
| 6. Verifier runs before returning; unverified marked, never dropped | **Satisfied** — `/api/verify`, proven in `test/seam.test.js` |
| 7. One event `{client, timestamp, duration}`, duration server-side | **Changed** — timestamp is still the database's; **duration is browser-measured round trip**, because the model call is no longer inside this system |
| 8. Records generation latency so the guardrail stays measurable | **Changed** — what is recorded is copy-prompt to pack-on-screen, which is a *better* guardrail number than model latency and a *different* one. Say which, everywhere it is reported |
| 9. Stateless with respect to candidates | **Satisfied** |

**#8 — The one screen**

| AC | Disposition |
|---|---|
| 1. Pick a client from a short list | **Satisfied** |
| 2. Paste or upload the brief and the CV | **Satisfied**, upload limited to plain text — see Open Questions |
| 3. Generate calls `/api/generate` and renders through #7 | **Changed** — `/api/prompt` then `/api/verify`; rendering is #7's `RENDERERS`, unchanged |
| 4. Unverified claims visibly marked in the UI | **Satisfied** |
| 5. One copy action on the rendered pack | **Satisfied** |
| 6. Loading state that survives a real generation | **Changed** — the wait now happens outside the app, so the screen owns a designed *waiting* act with a real elapsed clock rather than a designed *generating* state |
| 7. Honest failure states | **Satisfied**, with "no key configured" replaced by `note_empty`, `not_configured`, `not_migrated`, `no_pack`, `bad_pack` |
| 8. End to end under ten minutes | **Satisfied and now measured** — the clock is the measurement |
| 9. Vanilla, no framework, no build step | **Satisfied** — still zero runtime dependencies |

### Criteria for this plan's execution

- [ ] `/` is the one screen: pick a client, paste or upload a brief and a CV, copy a prompt,
      paste a reply, read a verified pack, copy it
- [ ] Every claim in the preview carries a source **word**; unverified claims are visibly marked
      and **present**, never dropped and never silently promoted
- [ ] The pack the recruiter copies is #7's renderer output, both `text/html` and `text/plain`
- [ ] One event per pack, with a round-trip duration and no candidate data
- [ ] No browser storage of any kind, no candidate content in any URL, no candidate text in any
      error message or log
- [ ] No `ANTHROPIC_API_KEY`, no runtime SDK, no `nodejs_compat`, no model call from Pages
- [ ] `--verified`, `--unverified` and `--failed` all measure ≥ 4.5:1 on both surfaces, gated by
      `test/tokens.test.js`
- [ ] `npm test` passes on Node v20 and v24, with the six existing test files unchanged
- [ ] The browser probe passes all seven checks
- [ ] The timed walkthrough is recorded, honestly, whatever the number
- [ ] CHECKLIST.md run in full, in real Safari and real Chrome
- [ ] README, DEPLOY.md and `spike/README.md` say what is true

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] All validation commands executed successfully
- [ ] Full test suite passes (unit + seam)
- [ ] No linting or syntax errors (`node --check` over every file)
- [ ] Manual walkthrough confirms the flow, in both engines, keyboard-only once
- [ ] `references/CHECKLIST.md` run line by line
- [ ] Acceptance criteria all met, and the AC disposition table reflected back to #6 and #8
- [ ] Code reviewed for quality and maintainability

---

## OPEN QUESTIONS / ASSUMPTIONS

**Assumptions this plan makes:**

1. **The recruiter has a Claude session.** The whole seam depends on it. Claude Code on the
   subscription is what saulera uses; the recruiter will more likely use claude.ai. Either
   works — the prompt is plain text and the reply is a fenced JSON block.
2. **`duration_ms` from the browser is acceptable.** `store.js:279` warns *"a caller who can set
   the time can rewrite the metric"* — which is why the **timestamp** stays the database's. The
   duration cannot be server-measured any more. It is the agency's own adoption metric and they
   have no incentive to game it. Recorded here so it is a known property rather than a
   discovered one.
3. **The screen preview and the clipboard payload are different renderings of the same pack.**
   The preview is for checking (marks, source quotes, keyboard-reachable). The clipboard is for
   sending (#7's `appendix` or `inline`, per `GET /api/agency`). A `#renderer-note` line tells
   the recruiter which they are copying.

**Questions that would change the plan if answered differently:**

1. **Upload is plain text only.** A real CV is a `.pdf` or `.docx`. Parsing either means a
   dependency and a build step, which #8 AC9 forbids. So in practice "upload" covers `.txt` and
   `.md` and the recruiter pastes everything else. **This is friction on the exact path the
   ten-minute guardrail measures.** Flagged rather than solved. If the timed walkthrough blows
   the budget on copy-paste out of a PDF, that is the finding, and the fix is a scoped follow-up
   ticket, not a build step smuggled into this one.
2. **The `dossier-design` skill and #8 disagree about the note.** The skill's hard constraints
   say *"The client-knowledge note is editable on the same screen."* #8 says *"The note editor
   already exists from #5 — link to it, do not rebuild it."* **This plan follows the ticket**
   (link out) because it is the later and more specific instruction, and because a second
   editor for the product's compounding asset is two save paths to one row. If the Tuesday
   walkthrough shows the round trip to `/clients` breaking the flow, revisit.
3. **Web fonts, re-deferred.** `tokens.css:8` and DEPLOY.md both name #8 as where the `.woff2`
   files land. Not shipping them: there are no font files in the repo, "Aspekta 500" and "Geist"
   need licensing decisions, and the fallback (`system-ui`) renders correctly and costs nothing
   against the guardrail. Fonts are also branding-adjacent, and branding is per-agency config.
   **Update the `tokens.css` comment and the DEPLOY.md entry so neither still points at #8.**
4. **`bad_pack` copy assumes the recruiter can ask Claude to retry.** They can. But if the model
   reliably returns a shape `assertPack` rejects, that is a prompt problem, not a UI one, and it
   would show up as a pattern in week one.
5. **The client note can change between prompt and verify.** The verifier reads it fresh, so an
   edited note demotes claims that were sourced against the old text. Fail-closed and correct,
   but worth knowing before someone reports it as a bug.

---

## NOTES (open canvas)

### Why not just restore the reverted Function

It exists, it was reviewed, and restoring it is one `git revert` away. Three durable artifacts
say no, and they are this project's explicit anti-relitigation devices:

- `5e311d1` is the head of this branch, and its message prescribes the replacement shape:
  *"#8 becomes the seam between them: the screen builds the prompt with one copy action, the
  recruiter runs it in Claude, and the screen verifies and renders what comes back."*
- README **Decisions** — *"Model access: Claude Code on the subscription. No API key, no
  server"* — under a heading that opens *"Recorded here so they don't get re-litigated per
  ticket."*
- DEPLOY.md §5b — *"There are still no secrets on this deployment."*

And the user reconfirmed it directly on 27 Jul 2026. The API path is not deleted; `spike/run.js`
is still there and `@anthropic-ai/sdk` is still a devDependency. The door stays shut, not
bricked up.

### Why the seam is a Function and not client-side JavaScript

Checked, not assumed. `wrangler.toml` sets `pages_build_output_dir = "./public"`, so only
`public/` is served as static assets. Verified against a live `wrangler pages dev` on
27 Jul 2026:

```
/src/provenance.js   ->  200 text/html   (the SPA fallback, i.e. index.html)
/src/render/index.js ->  200 text/html
```

A browser cannot `import` `src/`. The alternatives were: copy the verifier and the renderers
into `public/` (two copies of the one module whose whole value is that it is the single
deterministic check — the worst possible thing to duplicate), or add a bundler (a build step,
which #8 AC9 forbids). A Function is the only shape that keeps one verifier, no build step, and
`src/` where the tests can reach it.

Bonus, verified the same day: **Pages Functions can be imported into `node --test`.**

```
$ node -e "import('./functions/api/agency.js').then(...)"
status 200 {"agency":{...}}
```

`Request`, `Response` and `crypto.randomUUID` are Node globals and the Functions are plain ES
modules. That is what makes `test/seam.test.js` possible, and it means the seam is covered end
to end by the zero-dependency suite rather than only by curl.

### Design plan (the `dossier-design` skill's pass 1 — critique this before writing CSS)

**Layout concept, in one sentence.** A quiet two-column workspace, its right column moving down
through three plainly-numbered acts, where all the visual weight is spent on the third — a claim
sitting beside the verbatim line it came from.

**Palette roles.** `--background` is the page (~60%). `--surface` is the rail and the pack
preview (~30%) — the two zones that are *content* rather than *chrome*. `--accent` (≤10%) is
spent on exactly two controls: **Copy the prompt** and **Copy the pack**. Nothing else on the
screen is accent-filled. `--verified` / `--unverified` / `--failed` are text colours on the
marks, never fills, and each is redundant with a word.

**Type roles.** `--text-h2` for the page title. `--text-caption` uppercase-tracked for the act
heads and the rail head (the existing `.rail-head` grammar — one system, not two). `--text-note`
(16px) for the pack body, because it is prose a client will read. `--text-body` for the source
quotes and all chrome. `--text-caption` only for marks and row meta. Measure on the pack capped
at 68ch.

**Signature element.** The claim block: the claim in 16px, the source quote directly beneath it
in `--text-body` and `--text-muted`, and the mark carrying its word. Sourced claims are quiet.
Unverified claims take a 3px left border in `--unverified` and the word "Unverified". Failed
claims take `--failed`, the words "Quote not found", **and** the quote the model thought it was
citing — which is what makes a bad pack diagnosable rather than merely rejected. Three signals,
never colour alone.

**Wireframe.**

```
┌──────────────────────────────────────────────────────────────────────┐
│  Submission pack                                                     │
│  Pick a client, paste the brief and the CV.                          │
├────────────────┬─────────────────────────────────────────────────────┤
│ CLIENTS        │  ① THE INPUTS                                       │
│ ▸ Ashdown Park │  ┌────────────────────┐ ┌────────────────────┐      │
│   1,842 chars  │  │ The brief          │ │ The CV             │      │
│   6 packs      │  │ [textarea        ] │ │ [textarea        ] │      │
│                │  │ [Choose a file]    │ │ [Choose a file]    │      │
│   Weald Clinic │  └────────────────────┘ └────────────────────┘      │
│   No note yet  │  [ Copy the prompt ]                                │
│                │                                                     │
│ Write client   │  ② IN CLAUDE                            01:12       │
│ notes →        │  Paste the prompt into Claude. When it answers,     │
│                │  copy the whole reply and paste it here.            │
│                │  ┌───────────────────────────────────────────┐      │
│                │  │ [textarea: the reply]                     │      │
│                │  └───────────────────────────────────────────┘      │
│                │  [ Read the pack ]        Start again               │
│                │                                                     │
│                │  ③ THE PACK              12 sourced · 2 unverified  │
│                │  ┌───────────────────────────────────────────┐      │
│                │  │ Registered nurse, NMC pin current         │      │
│                │  │   "NMC registration current to Mar 2027"  │  CV  │
│                │  │                                           │      │
│                │  │ │ Has led a ward handover            Unverified │
│                │  └───────────────────────────────────────────┘      │
│                │  [ Copy the pack ]   Sources go in an appendix      │
└────────────────┴─────────────────────────────────────────────────────┘
```

**Critique pass — "would I have produced this for any similar brief?"** Partly, and that is
deliberate: the rail-plus-work-column is `/clients`'s layout, and reusing it is system
consistency rather than laziness. What is specific to *this* brief is the third act. A generic
"AI tool" would render the output as a blob and put a copy button under it. This one renders the
output as a **list of claims each pinned to a quoted line of evidence**, with the failures
diagnosable rather than hidden. That pairing is the product's thesis, and it is the only place
boldness is spent. The numbered acts earn their numbering because they are genuinely sequential
and the middle one happens in another application — a recruiter needs to know they have left and
must come back. Keep. Before building, one revision to consider: whether act ① should collapse
to a summary line once frozen, so act ③ sits higher on the page. Try it; if it costs the
recruiter the ability to re-read what they pasted while checking the pack, do not.

### The honest name for the number

Under the API path, `duration_ms` was model latency measured around one call. It is not that any
more, and the plan must not let the old label ride:

- **What is measured:** the recruiter presses "Copy the prompt", goes to Claude, comes back,
  presses "Read the pack". That span.
- **What it includes:** the trip to Claude, the model's thinking, and the paste back.
- **What it excludes:** typing or uploading the inputs, and reading the finished pack.
- **Why it is the better number anyway:** PRD §6 condition 2 is *"under ten minutes from inputs
  to sendable pack, including the recruiter's review."* Model latency was only ever a component
  of that. The round trip is most of it, and it is the part that varies.

Report it as "round trip", never as "generation latency", in `spike/README.md`, in the
implementation report, and anywhere the metric is surfaced.

### What could go wrong, ranked

1. **The recruiter pastes the reply without the JSON block** (they copy the prose Claude wrote
   around it, or only part). `extractPack` handles fences and surrounding prose; it cannot
   handle a truncated object. The `no_pack` copy has to name the fix precisely: *"Copy the whole
   of Claude's reply, including the JSON block."*
2. **The round trip blows the ten minutes** because the CV lives in a PDF. See Open Questions 1.
   Measure it before deciding anything.
3. **A `ClipboardItem` write silently fails in Safari** because something awaited before it.
   Build the item synchronously in the handler. This is the single most likely functional bug in
   `app.js`.
4. **A response lands after the recruiter switched client.** Exactly the class of bug that
   produced five High findings in the PR #13 review. The request-id guard and the probe both
   exist for it.
5. **Someone "helpfully" adds a candidate name to the event body** so the counter is more
   useful. `ALLOWED` in `functions/api/events.js` answers 400 rather than ignoring it; keep the
   same guard on both new routes.

### Sequencing note

Phases 1 and 2 are independent and could run in parallel worktrees. In practice they are both
small and Phase 3 depends on both, so the parallelism buys little — run them in order and keep
one branch. `feature/generation-and-screen` is already the branch, already carries the revert,
and is the right place for all of this.

## AMENDMENTS

<!-- Append-only. Newest at the bottom. Leave empty until this plan has been executed. -->
