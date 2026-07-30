# Feature: Send to Candidate — CTA, interview date, invite email, telemetry counts

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

> **Start from `main`.** This worktree may be sitting on an older feature branch — `git log --oneline -1`
> and check that `src/portal/store.js`, `src/note-fields.js` and `functions/prep/auth/` exist before you
> begin. Everything this ticket builds on (#17, #18, #19, #20, #21) is merged on `main`; nothing is on a
> branch. `git switch main && git pull` first, then branch. Memory note: parallel sessions share this
> worktree, so verify the branch again immediately before any commit or PR.

## Feature Description

The recruiter-side handover, end to end. After a submission pack has been generated on `/`, the recruiter
enters the confirmed interview date and the candidate's email address, presses **Send to Candidate**,
reads a preview of what is about to leave the building, strikes anything they disagree with, and
confirms. On confirm the deployment runs #19's one Opus call, persists the result inside #17's
invite-scoped cage, mints #20's magic-link token, and emails the candidate an invite from the agency's
name. The recruiter afterwards sees two numbers per client — invites sent and invites opened — and
nothing else, ever.

This is the seam where architecture decisions 1, 2 and 3 meet: **a brief, not the pack** goes to the
candidate; **only toggle-gated** client knowledge reaches them; and **only delivery telemetry** comes
back.

It also closes the last two open ends left by the tickets before it: `public/prep/brief.js` stops reading
a static fixture and starts reading a token-gated endpoint, and `/prep/` stops being a dead end that says
"your prep brief will appear here".

## User Story

As a recruiter at the agency
I want to send a confirmed candidate their interview prep with one button, after seeing exactly what
they will receive
So that every candidate we submit gets the prep portal, and I never accidentally hand one of them the
private things I wrote about the client.

## Problem Statement

Five tickets have shipped the parts and nothing connects them. #19 generates a prep brief but only from a
CLI script. #17 has seven tables holding no rows. #20's magic link works but nothing mints an invite.
#21's dashboard renders a hand-derived fixture. #18's toggle stores permissions no candidate-facing code
reads. The product's whole claim — "every candidate we submit gets our prep portal" (decision 23) — has
no button behind it and no number evidencing it.

There is also a live safety gap. The prep brief is generated from privileged inputs, and the one control
that stops the agency's private read on a client reaching the person it is about is a filter somebody has
to remember to call. Until a send path exists, nothing exercises it.

## Solution Statement

A **two-step Send**, because decision 15 requires the recruiter to see the extracted competencies before
anything is sent, and the competencies do not exist until the model call has run:

1. **Prepare** (`POST /api/prep/prepare`) — runs `generateBrief` and returns the payload, the provenance
   summary and the list of client-note sections that will travel. Persists nothing, emails nobody, mints
   no token. The browser holds the payload in memory (never in browser storage — the house rule).
2. **Confirm** (`POST /api/prep/send`) — the browser posts the payload back with the struck competency
   ids. The server re-runs the full contract (`assertBrief` → strike → `assertBrief` → `verifyBrief`
   against `listVisibleKeys` read **server-side**), refuses anything unverified, then writes the invite,
   the role, the competencies and the questions, sends the email, and records `invite_sent` last.

Plus a **candidate-visible projection endpoint** (`GET /prep/api/brief`), session-gated, returning blocks
and competencies with `failed_quote`, `importance` and `questions` stripped — and a small **counts page**
that reads only the two existing aggregate endpoints.

## Out of Scope / Non-Goals

- **Not included: the session engine and the drill UI** (#23, #24). This ticket mints the core question
  bank into `question` rows and never asks one.
- **Not included: the reminder email** (#25, decision 17). Exactly one reminder is a later ticket; this
  one sends exactly one invite.
- **Not included: an "ethos paste box."** Decision 16 says the recruiter supplies ethos material at Send
  as "client note fields gated by the visibility toggle **+ anything pasted**". The toggle half ships
  here; the paste box does not. `candidate_role.ethos_text` is written from the visible slice so #23 has
  something to read. See Open Questions.
- **Not included: sub-section redaction of the client note.** `visibleFields` returns whole sections, by
  design (#18's own note on the ticket). A ticked section travels whole.
- **Not included: a new migration.** `migrations/0002_portal.sql` already declares every table and column
  this ticket writes. `test/schema.test.js` locks the exact table list and the exact columns; reaching
  for an eighth portal table or a ninth `invite` column fails the suite, correctly.
- **Not included: SSE / streaming** (decision 19), voice (decision 5), pressure mode (decision 21).
- **Not changing: the `prep.` subdomain.** Superseded — the portal ships on this deployment
  (memory: "Portal hosted on the same deployment"). Links are minted against `PREP_BASE_URL` or the
  request origin, not a subdomain.
- **Not changing: `/api/generate`, `/api/prompt`, `/api/verify`, or acts 1–3 of the pack screen.** The
  Send surface is a new act 4 that appears once a pack exists.
- **Not changing: the OTP email's deliberate absence of a link.** See "Two emails, two rules" below.

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: High
**Primary Systems Affected**: recruiter UI (`public/index.html`, `public/app.js`), two new recruiter
Functions under `/api/prep/`, one new candidate Function under `/prep/api/`, `src/prep/*` (three new pure
modules + email), `src/portal/store.js` (the handover writers), a new counts screen
**Dependencies**: none new. `@anthropic-ai/sdk` (already), Resend by `fetch` (already), `node --test`
with zero test dependencies (a hard constraint of this repo)

## Related Work

**Implements**: [#22](https://github.com/linardsb/saulera-dossier-engine/issues/22)   ·
**Epic**: [#16](https://github.com/linardsb/saulera-dossier-engine/issues/16) —
`docs/epics/candidate-portal.architecture.md` (decisions 1, 2, 3, 6, 9, 10, 11, 12, 13, 14, 15, 16, 18,
20, 22, 23; §3, §4, §5)

**Back-references** (plans this builds on and inherits decisions from):

- `.claude/plans/portal-schema-retention-gdpr.md` (#17) — Why: every table this ticket writes, the
  cascade that makes purge one statement, and the `events.kind` vocabulary.
- `.claude/plans/per-field-candidate-visible-toggle.md` (#18) — Why: `visibleFields` is the gate this
  ticket has to call, and the ticket comment on #22 is #18's handover of its largest residual risk.
- `.claude/plans/candidate-brief-generation-seam.md` (#19) — Why: `generateBrief`, `assertBrief`,
  `verifyBrief`, `briefSummary` and what "sendable" means.
- `.claude/plans/candidate-auth-magic-link-otp.md` (#20) — Why: `createInvite`, token minting, the cookie,
  the mail transport, and the Access split this ticket must not break.
- `.claude/plans/prep-component-registry-and-brief-dashboard.md` (#21) — Why: what the candidate page
  needs out of a payload, and the deferred projection contract.
- `.claude/code-reviews/pr-29-review.md` (Low finding 3) — Why: deferred to this ticket by name.

**Forward-references**:

- (none yet — #23 and #24 will read the `competency` / `question` rows this ticket writes)

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `docs/epics/candidate-portal.architecture.md` (whole file, 108 lines) — Why: the decision table is the
  contract. Decisions 9, 15, 3, 23 are this ticket's acceptance criteria in prose.
- `src/prep/generate.js` (whole file, 138 lines) — Why: `generateBrief(client, {clientName, visibleFields,
  brief, cv, interviewAt})` is what the prepare endpoint wraps. Its guard order and its return shape
  (`{payload, failures, provenance, duration_ms, usage}`) are what you adapt.
- `src/prep/schema.js` lines 225-323 (`assertBrief`) — Why: the exact reference-resolution rules that
  striking a competency must not break. `resolve()` at :247 and the "no questions" loop at :317.
- `src/prep/verify.js` (whole file, 120 lines) — Why: `verifyBrief`'s idempotence, and the instruction at
  :100 addressed to this ticket by name: *"#22 calling this on a stored payload must run `assertBrief`
  first, as generate.js does."*
- `src/note-fields.js` lines 190-214 (`visibleFields`) — Why: the gate. Read the module header; it is
  addressed to this ticket.
- `src/portal/store.js` (whole file, 292 lines) — Why: `createInvite` (:110) is the writer to reuse,
  `deleteInviteByTokenHash` (:63) is the rollback, and the file's house rules (bound parameters only, no
  HTTP, no env) govern every function you add to it.
- `src/store.js` lines 274-324 (`listVisibleKeys`, `clientWithFields`) and 494-540 (`recordInviteEvent`,
  `eventCounts`) — Why: the permission read and the whole telemetry surface.
- `src/prep/email.js` (whole file, 98 lines) — Why: `sendEmail`'s missing-key posture, the private
  `escapeHtml`, and `sendOtpEmail`'s deliberate absence of a link.
- `src/prep/tokens.js` lines 22-29 (`mintToken`), 109-126 (`maxAgeFrom`) — Why: the token, and the UTC
  parsing rule your date helper must repeat.
- `functions/prep/auth/enter.js` (whole file, 96 lines) — Why: the link this ticket emails is the one this
  route consumes. The `?t=` parameter name and the redirect vocabulary are fixed here.
- `functions/api/generate.js` (whole file, 98 lines) — Why: the Function spine — guard order (`env.DB`
  → key → `sameOrigin`), `ALLOWED` body vocabulary, `errorResponse`, and the "one model call boundary"
  rule you are about to add a second call site to. Read the header before deciding that is fine.
- `functions/prep/api/delete.js` (whole file, 81 lines) — Why: the shape of a candidate-side Function
  under `/prep/`, including the `Set-Cookie` build-by-hand pattern.
- `functions/api/clients/[id].js` lines 44-79 — Why: a nested Function directory under `functions/api/`,
  which is what proves `functions/api/prep/send.js` resolves to `/api/prep/send`.
- `public/index.html` lines 163-180 (act 3) — Why: where act 4 goes, and the markup grammar it must match.
- `public/app.js` lines 179-192 (`state`), 306-341 (`setPhase`), 655-662 (`enterWaiting`), 694-764
  (`generate`) — Why: the six documented behaviours, the single-clock invariant, and the frozen-input
  rule act 4 depends on. **Read the file header (lines 1-42) in full.**
- `public/clients.js` lines 419-600 (the visibility list, `paintFields`, `toggleField`) — Why: the
  ticked-list grammar and the request-ordering discipline the preview list mirrors.
- `public/prep/registry.js` lines 197-232 (`provenanceNode`, `panelUnsourced`) and 535-600
  (`renderBlocks`) — Why: exactly which payload fields the candidate page reads, which is what the
  projection may not strip.
- `public/prep/brief.js` lines 35-38 — Why: the `SOURCE` constant this ticket replaces, with a comment
  naming this ticket.
- `test/prep-auth.test.js` lines 40-100 — Why: the `node:sqlite` harness (`d1Shape`, `openMigrated`,
  `at`) you will extract and reuse.
- `test/helpers/fake-d1.js` (whole file) — Why: what it can and cannot prove. It returns
  `{changes: 1}` unconditionally and enforces no constraints.
- `test/schema.test.js` lines 100-140 — Why: the exact-tables lock, so you know a migration is not an
  option.
- `scripts/setup-access.py` lines 1-35, 91-160 — Why: **the two Bypass → Everyone applications on
  `<project>.pages.dev/prep`**. This is the fact that moves the send endpoint.
- `DEPLOY.md` §5b (lines ~417-475) — Why: the secrets section you extend with `PREP_BASE_URL`, and the
  posture ("until the secret is set, nothing is broken") your fallback must match.
- `.claude/probes/one-screen.mjs` (whole file) — Why: the CDP harness that can prove the CTA is locked.
- `.claude/skills/dossier-design/references/CRAFT.md` and `CHECKLIST.md` — Why: house UI gates. Read
  CRAFT before writing CSS; run CHECKLIST before committing.

### New Files to Create

- `src/prep/dates.js` — the two date rules: normalise an interview date to SQLite's UTC form, and add
  days to it without the local-time drift `tokens.js:120` documents.
- `src/prep/strike.js` — `strikeCompetencies(payload, ids)`, pure: drops competencies, their questions,
  and every reference to them, so the result still passes `assertBrief`.
- `src/prep/projection.js` — `candidateProjection(payload)`, pure: what a candidate's browser is allowed
  to receive.
- `functions/api/prep/prepare.js` — `POST /api/prep/prepare` (recruiter, Access-gated).
- `functions/api/prep/send.js` — `POST /api/prep/send` (recruiter, Access-gated).
- `functions/prep/api/brief.js` — `GET /prep/api/brief` (candidate, session-gated).
- `public/counts.html` + `public/counts.js` — the process-claim numbers (decision 23).
- `test/helpers/sqlite-d1.js` — the `node:sqlite` D1 adapter, extracted from `test/prep-auth.test.js`.
- `test/prep-dates.test.js`, `test/prep-strike.test.js`, `test/prep-projection.test.js` — the pure
  modules.
- `test/prep-send.test.js` — the confirm path against real SQL: the PK collision, the strike, the
  rollback, the gates.

### Files to Update

- `src/prep/email.js` — add `mailFrom()` and `sendInviteEmail()`; add an optional `from` to `sendEmail`.
- `src/portal/store.js` — add `persistHandover()` and `briefJsonByInviteId()`.
- `public/index.html` — act 4, and a third nav link.
- `public/clients.html` — a third nav link.
- `public/app.js` — act 4's wiring.
- `public/app.css` — act 4 and the counts table.
- `public/prep/brief.js` — `SOURCE` becomes the endpoint; a 401 bounces to `/prep/login`.
- `public/prep/index.html` — a signed-in candidate goes to `/prep/brief` instead of reading a placeholder.
- `test/prep-auth.test.js`, `test/portal-purge.test.js` — import the extracted harness.
- `test/prep-email.test.js` — the invite email's own group.
- `test/portal-store.test.js` — recorded-SQL assertions for the two new writers.
- `DEPLOY.md`, `README.md` — the new variable, the new routes, the new triage rows.

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [Cloudflare Pages Functions — routing](https://developers.cloudflare.com/pages/functions/routing/)
  - Specific section: *Functions directory structure* — nested directories map to nested paths.
  - Why: it is what makes `functions/api/prep/send.js` → `/api/prep/send` true, and it is the fact this
    ticket's whole security shape rests on.
- [Cloudflare Access — application paths & precedence](https://developers.cloudflare.com/cloudflare-one/policies/access/app-paths/)
  - Specific section: *"When multiple rules are set for a common root path, the more specific rule takes
    precedence"*
  - Why: `/prep/*` is Bypass → Everyone on this deployment. Everything else on the hostname is gated. The
    send endpoint's directory is therefore a security decision, not a filing decision.
- [Resend — Send Email API](https://resend.com/docs/api-reference/emails/send-email)
  - Specific section: the `from` field's `Name <address>` form.
  - Why: decision 10 puts the agency's name in the display name, and the display name is a mail header.
- [RFC 5322 §3.2.4 — quoted strings](https://datatracker.ietf.org/doc/html/rfc5322#section-3.2.4)
  - Why: an agency name can legally contain a comma, a full stop or a quote. Unquoted, those break the
    header; unsanitised, a newline injects one.
- [SQLite — date and time functions](https://www.sqlite.org/lang_datefunc.html)
  - Specific section: *Time Values* and the `'+N days'` modifier.
  - Why: `invite.interview_at` carries `CHECK (datetime(interview_at) IS NOT NULL)` and the purge compares
    through `datetime()`. Your stamps have to be readable by it.
- [Anthropic — structured outputs](https://docs.claude.com/en/docs/build-with-claude/structured-outputs)
  - Why: only if `generateBrief` misbehaves. #19 owns this call; you are wrapping it, not changing it.

### Patterns to Follow

**The route split — the one rule this ticket cannot get wrong:**

```
functions/api/prep/*      RECRUITER. Behind Cloudflare Access. Mints invites, spends model credit.
functions/prep/api/*      CANDIDATE. Access-BYPASSED. Must call requireSession() itself.
```

`scripts/setup-access.py:110-111` creates two `Bypass → Everyone` applications on
`<project>.pages.dev/prep` and `*.<project>.pages.dev/prep`. **A file at `functions/prep/send.js` would
be an unauthenticated endpoint that mints magic links and spends ~30p of Opus per request.** The issue's
"files touched" line names that path; it is an estimate written before #20 created the bypass apps, and
it is wrong. Say so in the PR body.

**The Function spine** (`functions/api/generate.js:32-48`, unchanged):

```js
export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.DB) return json({ error: "not_configured" }, 503);
  if (!env.ANTHROPIC_API_KEY) return json({ error: "no_model_key" }, 503);
  if (!sameOrigin(request)) return json({ error: "cross_origin" }, 403);
  try {
    const body = await readJson(request);
    const unexpected = Object.keys(body).filter((key) => !ALLOWED.has(key));
    if (unexpected.length) return json({ error: "unexpected_fields", fields: unexpected }, 400);
    /* … */
  } catch (err) {
    return errorResponse(err);
  }
}
```

**The gate call, written out so it cannot drift** (#18's ticket comment: `.note` may appear only as this
call's first argument):

```js
import { getClient, listVisibleKeys } from "../../../src/store.js";
import { visibleFields } from "../../../src/note-fields.js";

const client = await getClient(env.DB, body.client_id);
const slice  = visibleFields(client.note, await listVisibleKeys(env.DB, client.id));
// `slice` is what generation and verification see. `client.note` appears nowhere else.
```

**Store functions** (`src/portal/store.js` header): every function takes a D1-shaped `db` first, no HTTP,
no `Response`, no `env`, every user value a bound parameter, nothing interpolated into SQL.

**Errors**: `throw new StoreError(code, status, message)` from `src/store.js`; the Function layer maps it
through `errorResponse`. Codes are lowercase snake_case.

**Client-side request ordering** (`public/app.js:717`, `clients.js:504`): capture a request id before the
fetch and bail rather than write when the screen has moved on.

```js
state.reqId += 1;
var reqId = state.reqId;
var mine = function () { return state.reqId === reqId && state.selected === clientId; };
```

**Every visible string in one `COPY` object**, in plain first-time-recruiter language
(`public/app.js:47`, house rule + memory note).

**DOM building**: `document.createElement` + `textContent` only. Never an HTML-parsing assignment —
`public/app.js:870` and `registry.js` both say why, and the Level 1 grep gate enforces it.

**Test register**: `node --test`, zero dependencies. `test/helpers/fake-d1.js` for "what SQL was built";
`node:sqlite` for "what the database actually did"; `test/helpers/dom.js` for structure. Never stretch one
to do another's job — `test/prep-registry.test.js:22-27` and `fake-d1.js:3-5` both make that argument.

---

## IMPLEMENTATION PLAN

> **Read NOTES → "Risk register" before task 1.** Nine things in this ticket pass every obvious test while
> broken. Each is closed by a named task and a named assertion; the table says which, so nothing on that
> list can be quietly descoped.

### Phase 1: The pure modules

Three small modules with no D1, no HTTP and no env, so every rule in them is directly testable — the same
argument `src/note-fields.js` and `src/prep/verify.js` make about themselves.

**Tasks:**

- `src/prep/dates.js`: the interview date's SQLite form, `+14 days` for `expires_at`, and a not-in-the-past
  check.
- `src/prep/strike.js`: remove competencies and everything that references them.
- `src/prep/projection.js`: the candidate-visible slice of a stored payload.
- Extract `test/helpers/sqlite-d1.js` from `test/prep-auth.test.js`.

### Phase 2: The store writers and the mail

**Depends on:** Phase 1 (`dates.js` for the stamps).
**Independent of:** Phase 3 — these can be built and tested in parallel with the Functions.

**Tasks:**

- `persistHandover()` and `briefJsonByInviteId()` in `src/portal/store.js`.
- `mailFrom()` and `sendInviteEmail()` in `src/prep/email.js`; `from` override on `sendEmail`.

### Phase 3: The three Functions

**Depends on:** Phases 1 and 2.

**Tasks:**

- `POST /api/prep/prepare` — generate, verify, return. Persist nothing.
- `POST /api/prep/send` — re-verify, persist, mint, mail, count.
- `GET /prep/api/brief` — session-gated projection.

### Phase 4: The recruiter surface

**Depends on:** Phase 3 (the endpoints it calls).

**Tasks:**

- Act 4 in `public/index.html` + `public/app.js` + `public/app.css`.
- The counts page, and the third nav link on all three screens.

### Phase 5: The candidate surface

**Depends on:** Phase 3 (`/prep/api/brief`).
**Independent of:** Phase 4.

**Tasks:**

- `public/prep/brief.js` reads the endpoint; a 401 bounces to `/prep/login`.
- `public/prep/index.html` forwards a signed-in candidate to `/prep/brief`.

### Phase 6: Tests, docs and the manual sweep

**Depends on:** everything above.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

### Task Format Guidelines

- **CREATE**: New files or components · **UPDATE**: Modify existing files · **ADD**: Insert new
  functionality · **REMOVE**: Delete deprecated code · **REFACTOR**: Restructure without changing
  behaviour · **MIRROR**: Copy pattern from elsewhere in codebase

---

### 1. CREATE `src/prep/dates.js`

- **IMPLEMENT**:
  - `export function toSqliteUtc(value)` — accepts `'YYYY-MM-DD'` (what `<input type="date">` gives) or a
    full `'YYYY-MM-DD HH:MM:SS'` / ISO string; returns `'YYYY-MM-DD HH:MM:SS'`. A date-only value becomes
    midnight UTC. Throws `StoreError("missing_fields", 400, "interview_at: …")` on anything unparseable —
    the schema's `CHECK (datetime(interview_at) IS NOT NULL)` would otherwise reject it at the database
    with a 500.
  - `export function addDays(stamp, days)` — same format in and out.
  - `export function isNotPast(stamp, now = new Date())` — true when the stamp's **day** is today or
    later. Day granularity, not instant: an interview at 09:00 today must still be sendable at 14:00.
- **PATTERN**: `src/prep/tokens.js:120-126` — the `T`/`Z` rule. `Date.parse` reads a space-separated
  string as LOCAL time; in British Summer Time that is an hour of drift in whichever direction hurts.
  Replace the space with `T`, append `Z` unless already zoned, then parse.
- **IMPORTS**: `import { StoreError } from "../store.js";`
- **GOTCHA**: do not reach for `node:` anything. This module is imported by a Function and runs at the
  edge. `Date` is all you need.
- **VALIDATE**: `node --check src/prep/dates.js`
- **SATISFIES**: AC #1 (a date is what unlocks the CTA), AC #7 (the invite dies with the retention rule)

### 2. CREATE `test/prep-dates.test.js`

- **IMPLEMENT**:
  - `toSqliteUtc("2026-08-12")` → `"2026-08-12 00:00:00"`.
  - `toSqliteUtc` accepts what it produces (idempotent) and accepts an ISO `…T09:30:00Z`.
  - `toSqliteUtc("not a date")` and `toSqliteUtc("")` throw `StoreError` with status 400.
  - `addDays("2026-08-12 00:00:00", 14)` → `"2026-08-26 00:00:00"`; and a month boundary
    (`"2026-08-25"` + 14 → `"2026-09-08 00:00:00"`).
  - **The pair test**: `maxAgeFrom(addDays(toSqliteUtc(today), 14))` is within a second of
    `14 * 86400`. This is what pins `dates.js` and `tokens.js` to one reading of a timestamp — two
    readings that disagree by an hour is the exact bug `maxAgeFrom` exists to prevent.
  - `isNotPast` for yesterday (false), today (true), tomorrow (true), with an injected `now`.
- **PATTERN**: `test/prep-tokens.test.js` — an explicit `now` rather than the wall clock.
- **VALIDATE**: `node --test test/prep-dates.test.js`
- **SATISFIES**: AC #1, AC #7

### 3. CREATE `src/prep/strike.js`

- **IMPLEMENT**: `export function strikeCompetencies(payload, struckIds)` returning a NEW payload
  (structural clone-by-map, never mutation — `verify.js:51-53` makes this argument):
  1. `competencies` — drop every entry whose `id` is struck.
  2. `questions` — drop every entry whose `competency_id` is struck.
  3. `blocks` — walk top level and `CompetencyMap.children`, and for each block:
     - `CompetencyMap`: filter `props.competency_ids`. **If it empties, drop the block.**
     - `StoryBankCard`: filter `props.covers_competency_ids`. **If it empties, drop the card** — a story
       prompt covering no competency is a prompt with no target.
     - every other block: unchanged.
  4. Throw a plain `Error` if the result would have zero competencies. The caller turns that into a
     400; a prep brief with nothing to drill is not a prep brief.
- **PATTERN**: `src/prep/schema.js:247-252` (`resolve`) is what your output has to satisfy — a
  `competency_ids` entry that names no competency throws. `verify.js`'s clone-down-the-tree is the shape
  to copy.
- **IMPORTS**: none. Pure, like `src/note-fields.js`.
- **GOTCHA — R5**: `resolve()` accepts an EMPTY array, so an emptied `CompetencyMap` passes `assertBrief` while
  rendering a heading with nothing under it — `registry.js:264-266` makes exactly this call about an
  empty row. Drop the block; do not keep it empty.
- **GOTCHA**: dropping a `CompetencyMap` drops its `children` with it. That is correct — those
  StoryBankCards were grouped under it — but say so in a comment, because it is the kind of thing a
  reviewer reads as an accident.
- **VALIDATE**: `node --check src/prep/strike.js`
- **SATISFIES**: AC #3

### 4. CREATE `test/prep-strike.test.js`

- **IMPLEMENT**, over `test/fixtures/prep-payload.json` (the real #19 output):
  - Striking one competency: it is gone from `competencies`, its questions are gone from `questions`, its
    id appears in no `competency_ids` or `covers_competency_ids`, and `assertBrief(result)` does not throw.
  - **The exhaustive one**: for every non-empty subset of the fixture's competencies (or, if the fixture
    has more than ~6, every single-strike and every strike-down-to-one chain), `assertBrief` does not
    throw. This is the assertion that catches a dangling reference nobody thought of.
  - Striking every competency throws.
  - Striking an id that is not in the payload is a no-op, not an error (the browser may post a stale id
    after a re-prepare).
  - The input payload is not mutated (`assert.deepEqual(payload, structuredClone(before))`).
  - A `CompetencyMap` whose ids all strike is dropped, and its `children` go with it.
- **PATTERN**: `test/prep-schema.test.js:28` — a deep copy per test so a mutation case cannot leak.
- **VALIDATE**: `node --test test/prep-strike.test.js`
- **SATISFIES**: AC #3

### 5. CREATE `src/prep/projection.js`

- **IMPLEMENT** (**R6**): `export function candidateProjection(payload)` → `{ role_title, blocks, competencies }`:
  - `competencies`: keep `id`, `label`, `source_quote`, `verified`. **Drop `importance`** (a numeral is a
    score whatever it measures — `registry.js:230-238`) and **drop `failed_quote`** (a sentence the model
    invented; a candidate's next move after reading a quote is to prepare against it).
  - **Drop `questions` entirely.** The brief page never renders them; #23 will serve them from its own
    session endpoint.
  - `blocks`: pass through, except each `PanelBrief.props.panel[]` entry — **keep the `failed_field_key`
    KEY but blank its VALUE**. `registry.js:226-230` reads `"failed_field_key" in entry` to decide the
    unverified mark, so removing the key would silently mark every guessed panel row as sourced (fail
    open). Blanking the value drops the slug the model invented while the mark stays honest.
  - Walk `CompetencyMap.children` too — a `PanelBrief` cannot legally nest there (`assertBrief:263`), but
    the walk is one line and a projection that only handles the top level is the same hole `briefSummary`
    documents at `verify.js:97-100`.
- **PATTERN**: `src/prep/verify.js` — map, never mutate.
- **GOTCHA**: `verified` must survive. `registry.js:195-196`: *"`verified` absent means the payload never
  went through verifyBrief, so it is treated as unverified"* — dropping it would mark a perfectly sourced
  brief unverified for every candidate.
- **VALIDATE**: `node --check src/prep/projection.js`
- **SATISFIES**: AC #6 (the deferred PR #29 contract line)

### 6. CREATE `test/prep-projection.test.js`

- **IMPLEMENT**, over `public/prep/brief.fixture.json` and a payload deliberately demoted by
  `verifyBrief`:
  - **The test the ticket asked for by name**: `JSON.stringify(candidateProjection(payload))` contains
    the substring `failed_quote` nowhere. Fails if the projection ever regresses to a passthrough.
  - The same grep for `importance` and for `questions`.
  - The demoted competency's invented quote text appears nowhere in the serialised output.
  - `verified: false` survives, and `renderBlocks(projection, mount, {doc})` still renders the unverified
    mark — import `renderBlocks` from `public/prep/registry.js` and `fakeDocument` from
    `test/helpers/dom.js`, as `test/prep-registry.test.js` does.
  - A demoted `PanelBrief` entry still renders as unsourced after projection (this is the fail-open trap;
    assert the caption, not just the absence of a key).
  - The projection is a valid input to `renderBlocks` with a non-zero `rendered` count.
- **VALIDATE**: `node --test test/prep-projection.test.js`
- **SATISFIES**: AC #6

### 7. REFACTOR `test/helpers/sqlite-d1.js` out of `test/prep-auth.test.js`

- **IMPLEMENT**: export `openMigrated(seedSql?)`, `d1Shape(db)`, `at(days)` and the `skip` string, moved
  verbatim from `test/prep-auth.test.js:44-100`. Keep the header comment explaining the `PRAGMA
  foreign_keys = ON` gotcha and the Node-version skip — that reasoning is the file's value.
- **UPDATE** `test/prep-auth.test.js` and `test/portal-purge.test.js` to import from it. Behaviour must
  not change: run both files before and after and confirm the same test count and the same result.
- **GOTCHA**: `test/*.test.js` does not glob into `test/helpers/`, so this is never collected as a suite —
  the same note both existing helpers carry.
- **GOTCHA**: `openMigrated` currently seeds one hard-coded client. Make the seed a parameter with the
  existing string as the default so neither caller changes behaviour.
- **VALIDATE**: `npm test` under Node 24 — same pass count as before the refactor.
- **SATISFIES**: AC #3, AC #4 (the harness they are proved on)

### 8. ADD `persistHandover()` to `src/portal/store.js`

- **IMPLEMENT**:

  ```js
  export async function persistHandover(db, { inviteId, jdText, ethosText, cvText, payload } = {}) {
    // candidate_role, then competencies, then questions. Sequential single statements, never D1's
    // batch API — test/helpers/fake-d1.js does not implement it (store.js:376-379).
  }
  ```

  - `candidate_role.id` = `crypto.randomUUID()`. `invite_id` is `UNIQUE`, so a second call for one invite
    fails loudly, which is right.
  - **R2 — `competency.id` = `` `${roleId}:${payload.id}` ``.** `competency.id` is `TEXT PRIMARY KEY` and the
    payload's ids are model-chosen slugs like `stakeholder-management` — the SECOND candidate for the
    same client collides. Namespacing on the role id makes the row id unique per invite and derivable by
    #23. `roleId` is a UUID and contains no colon, so the join is unambiguous.
  - `question.id` = `` `${competencyRowId}#${index}` `` over that competency's questions.
  - `competency.importance` ← `payload.competencies[i].importance`; `stage` ← `''`; `success_rate` ← `0`
    (the DDL defaults, written explicitly is fine either way — prefer letting the defaults apply and
    binding only the columns you own).
  - `question.axis` ← `null`, **not `'core'`**. The column carries
    `CHECK (axis IN ('lateral','vertical'))` and `'core'` is not in it — the schema deliberately reserves
    that column for #23's variants, and the core bank is the rows with a NULL axis and no `variant_of`.
    NULL is storable because `NULL IN (…)` evaluates to NULL and **a CHECK that evaluates to NULL is not
    a violation** — write that parenthetical in the comment, or the next reader assumes you got lucky and
    "fixes" it to `'core'`, which fails at insert on the recruiter's first Send.
  - `question.difficulty` — the payload's is a string (`gentle|standard|probing`); the column is
    `INTEGER`. Map `gentle→1, standard→2, probing→3` in one small exported constant so #23 reads the same
    map. **The map is not tidiness.** SQLite type affinity does not reject a string in an INTEGER column
    — it stores `'standard'` as text, silently, and nothing fails until #23 runs `ORDER BY difficulty`
    and gets a text sort over a column every reader believes is numeric. Same class of trap as
    `mintOtpCode`'s note about `Number('000123')`; comment it the same way.
- **PATTERN**: `src/store.js:382-387` — a `for` loop of single bound statements.
- **GOTCHA**: no transaction is available. If this throws part-way, the caller deletes the invite and the
  cascade removes everything written so far. That is why the invite is written FIRST.
- **VALIDATE**: `node --check src/portal/store.js`
- **SATISFIES**: AC #3, AC #4

### 9. ADD `briefJsonByInviteId()` to `src/portal/store.js`

- **IMPLEMENT**:

  ```js
  export async function briefJsonByInviteId(db, inviteId) {
    return db.prepare("SELECT brief_json FROM candidate_role WHERE invite_id = ?")
             .bind(String(inviteId ?? "")).first("brief_json");
  }
  ```

- **GOTCHA**: **one column, and never `SELECT *`.** `cv_text`, `jd_text` and `ethos_text` live in the
  same row and have no business in a response headed for a browser. This is `listVisibleKeys`'s stated
  discipline (`src/store.js:283-289`) applied to the portal's most sensitive row.
- **VALIDATE**: `node --check src/portal/store.js`
- **SATISFIES**: AC #6

### 10. UPDATE `test/portal-store.test.js` — the two new writers

- **IMPLEMENT** with `fakeD1`:
  - `persistHandover` issues one `INSERT INTO candidate_role`, N `INSERT INTO competency` and M
    `INSERT INTO question`, in that order, with every value bound and nothing interpolated (assert no
    call's `sql` contains a value from the payload).
  - `briefJsonByInviteId`'s SQL selects `brief_json` and mentions no other column —
    `assert.doesNotMatch(sql, /cv_text|jd_text|ethos_text|\*/)`.
- **PATTERN**: the existing file's SQL-shape assertions.
- **VALIDATE**: `node --test test/portal-store.test.js`
- **SATISFIES**: AC #4, AC #6

### 11. ADD `mailFrom()` and `sendInviteEmail()` to `src/prep/email.js`

- **IMPLEMENT**:

  ```js
  /** `"<Agency> interview prep <prep@saulera.com>"` — decision 10 puts the agency in the display name. */
  export function mailFrom(env, agencyName) { /* … */ }
  ```

  **R8 lives in this function.** The agency name is agency-authored text going into a mail header.

  - Take the address from `env.PREP_MAIL_FROM || MAIL_FROM_DEFAULT`: if it matches `/<([^>]+)>\s*$/` use
    that capture, else use the whole trimmed string.
  - Sanitise the agency name: **strip CR and LF first** (header injection), then strip `<`, `>` and any
    C0 control, then cap at `NAME_MAX` (120). If nothing survives, return the configured string unchanged
    — a nameless agency gets today's behaviour rather than a broken header.
  - Wrap the surviving name in an RFC 5322 quoted-string: escape `\` and `"`, then wrap in `"`. Quoting
    unconditionally is cheaper than deciding whether a comma or a full stop made it necessary.
  - Result: `"Ashdown Recruitment" <prep@saulera.com>`.
  - `sendEmail(env, { to, subject, text, html, from })` — add `from` to the destructure and use
    `from || env.PREP_MAIL_FROM || MAIL_FROM_DEFAULT`. Two words; every existing caller is unchanged and
    `test/prep-email.test.js`'s default assertions still pass.
  - `sendInviteEmail(env, { to, agencyName, roleTitle, interviewAt, link })`:
    - subject: `Your interview prep for <role title>` (fall back to `Your interview prep` if the title is
      blank).
    - **text half**: the greeting, one sentence saying what this is, **the URL on its own line as bare
      text**, the date, the retention sentence ("everything is deleted 30 days after your interview, and
      there is a delete-now button on the page"), and one line on what to do if the link stops working
      ("go to `<base>/prep/login` and ask for a code"). AC: it must read sanely in a plain-text client —
      the URL must be plain text, not only an `<a>` href.
    - **html half**: the same content, one `<a>` on the link, `escapeHtml` on the agency name, the role
      title and anything else interpolated. Inline styles and literal colours only — mail clients strip
      `<style>` and resolve no custom property (`email.js:85-88`).
    - delegates to `sendEmail` with `from: mailFrom(env, agencyName)`.
- **PATTERN**: `sendOtpEmail` — the exact structure, minus the no-link rule.
- **GOTCHA — two emails, two rules, on purpose.** `sendOtpEmail` deliberately carries **no** link, and
  `test/prep-email.test.js` asserts that absence for a stated anti-phishing reason. This email's link is
  its whole mechanism. Write a comment above `sendInviteEmail` saying the two are different by design, so
  nobody "harmonises" them in either direction.
- **GOTCHA**: never log the token, the link or the recipient. `email.js:47-52` logs the status only.
- **VALIDATE**: `node --check src/prep/email.js && node --test test/prep-email.test.js`
- **SATISFIES**: AC #5

### 12. UPDATE `test/prep-email.test.js` — the invite email's group

- **IMPLEMENT**:
  - `mailFrom({}, "Ashdown Recruitment")` → `'"Ashdown Recruitment" <prep@saulera.com>'`.
  - **Header injection**: `mailFrom({}, "Evil\r\nBcc: x@y.z")` yields a single-line value containing no
    `\r`, no `\n` and no second header.
  - `mailFrom({}, 'A "quoted" name')` escapes the inner quotes.
  - `mailFrom({}, "")` and `mailFrom({}, "   ")` → `MAIL_FROM_DEFAULT` unchanged.
  - `mailFrom({ PREP_MAIL_FROM: "prep@agency.co.uk" }, "X")` (no angle brackets) →
    `'"X" <prep@agency.co.uk>'`.
  - `sendInviteEmail` posts both `text` and `html`; the **text** half contains the raw link URL as a
    standalone substring; the **html** half contains it inside an `href`.
  - The agency name is escaped in the html half (`<script>` in the name does not survive as markup).
  - With no `RESEND_API_KEY` it throws `not_configured` **before** any fetch (assert `calls.length === 0`,
    the same assertion the file already makes for `sendEmail`).
- **PATTERN**: the file's own `withFetch` recorder, and its `finally` restore.
- **VALIDATE**: `node --test test/prep-email.test.js`
- **SATISFIES**: AC #5

### 13. CREATE `functions/api/prep/prepare.js` — `POST /api/prep/prepare`

- **IMPLEMENT**:
  - `ALLOWED = new Set(["client_id", "brief", "cv", "interview_at"])`.
  - Guards in the spine's order: `env.DB` → `env.ANTHROPIC_API_KEY` (`no_model_key`) → `sameOrigin`.
  - `toSqliteUtc(body.interview_at)` and refuse a past date (`StoreError("interview_past", 400, …)`).
    **This is AC #1's server half**: the CTA being locked in the browser is a courtesy; this is the
    enforcement.
  - `const client = await getClient(env.DB, body.client_id)` → 404 before the model call, as
    `generate.js:50` does.
  - `const slice = visibleFields(client.note, await listVisibleKeys(env.DB, client.id))`.
  - `generateBrief(new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }), { clientName: client.name,
    visibleFields: slice, brief: body.brief, cv: body.cv, interviewAt })`.
  - Respond 200 with `{ payload, provenance, failures, interview_at, visible_fields, duration_ms }`,
    where `visible_fields` is `slice.map(({ key, heading, chars }) => ({ key, heading, chars }))` —
    **headings and counts, never the section text.** The recruiter is one link away from the note on
    `/clients`; a second copy of business-context personal data on a second screen buys nothing
    (`src/store.js:301-306` makes this argument and explicitly leaves the decision to this ticket).
  - **Persist nothing. Mint nothing. Email nobody.** Say so in the file header.
- **PATTERN**: `functions/api/generate.js` end to end.
- **GOTCHA**: this is a **second model call site**, and `generate.js`'s header says not to add one. The
  reason it is allowed: architecture §5 names exactly two — "at Send (`claude-opus-5`)" and "in session
  (`claude-sonnet-5`)". This is the first of those two, and §5.6's switchability argument still holds
  because it still runs behind the same per-deployment key in a Function. **Write that justification in
  the file header**, or a reviewer is right to reject it.
- **GOTCHA**: no event is recorded here. A prepare that the recruiter abandons is not an invite.
- **VALIDATE**: `node --check functions/api/prep/prepare.js`
- **SATISFIES**: AC #1, AC #2

### 14. CREATE `functions/api/prep/send.js` — `POST /api/prep/send`

- **IMPLEMENT** — the order below is the contract; do not reorder it:

  ```
  1  guards: env.DB → env.ANTHROPIC_API_KEY not needed → sameOrigin
  2  ALLOWED = { client_id, email, interview_at, brief, cv, payload, strike }
  3  interviewAt = toSqliteUtc(body.interview_at); refuse if past
  4  email: trim, non-empty, contains exactly one "@" with something either side  → missing_fields
  4b strike: absent, or an array of strings no longer than payload.competencies    → missing_fields
       (the same spirit as VISIBILITY_KEYS_MAX — one request may not ask for unbounded work)
  5  client   = await getClient(env.DB, body.client_id)                            → 404
  6  fieldKeys = await listVisibleKeys(env.DB, client.id)      ← SERVER-SIDE, never from the browser
  7  assertBrief(body.payload)                                  → bad_brief 400
  8  struck   = strikeCompetencies(body.payload, body.strike ?? [])
  9  assertBrief(struck)                                        → bad_brief 400  (belt and braces)
  10 { payload, failures } = verifyBrief(struck, { brief: body.brief, fieldKeys })
  11 if (payload.competencies.some(c => !c.verified)) → 400 { error: "not_sendable", failures }
  12 token = mintToken(); hash = await hashToken(token)
  13 await createInvite(db, { id, clientId, email, interviewAt, tokenHash: hash,
                              expiresAt: addDays(interviewAt, 14) })
  14 try { await persistHandover(db, { inviteId: id, jdText: body.brief, ethosText, cvText: body.cv,
                                       payload }) }
       catch → await deleteInviteByTokenHash(db, hash); rethrow
  15 try { await sendInviteEmail(env, { to: email, agencyName: agency?.name,
                                        roleTitle: payload.role_title, interviewAt,
                                        link: `${base}/prep/auth/enter?t=${token}` }) }
       catch → await deleteInviteByTokenHash(db, hash); map to the mail code
  16 await recordInviteEvent(db, { clientId: client.id, kind: "invite_sent" })   ← LAST
  17 201 { ok: true, sent_at, competencies: payload.competencies.map(c => c.id), event_recorded }
  ```

  - `base` = `env.PREP_BASE_URL` if it is set AND parses as an `https:` URL with no path, query or hash;
    otherwise `new URL(request.url).origin`. A malformed override mints links nobody notices until a
    candidate clicks one, so validate it and fall back rather than concatenating blindly.
  - `agency` = `await getAgency(env.DB).catch(() => null)` — `functions/prep/auth/otp.js:59` makes
    exactly this call and states the reason: the agency's name makes the email recognisable, and its
    absence is not worth failing a send over. `mailFrom` already falls back on a blank name.
  - `ethosText` = the visible slice rendered as text: for each field,
    `` `## ${heading}\n${text}` `` joined by a blank line, from
    `visibleFields(client.note, fieldKeys)`. Decision 16's toggle half. Comment that the paste half is
    deferred.
  - **`invite_sent` is recorded LAST, after the send succeeded.** A rolled-back send that already counted
    inflates decision 23's sales claim, which is the one number the epic sells on. A failure here is
    reported (`event_recorded: false`) and never costs the send — the same trade `generate.js:70-81`
    makes.
  - **The response carries no token and no invite id.** Nothing on the recruiter's screen needs either,
    and a token in a JSON body is a token in a browser's network log.
  - Error codes to surface distinctly, because DEPLOY.md's triage table keys off them:
    `not_configured` (503, no DB), `interview_past` (400), `bad_brief` (400), `not_sendable` (400, with
    `failures`), `nothing_to_send` (400, every competency struck), `not_configured` from
    `sendInviteEmail` (503, no `RESEND_API_KEY`), `mail_failed` (502, Resend rejected — usually an
    unverified sending domain).
- **PATTERN**: `functions/api/generate.js` for the spine; `functions/prep/auth/enter.js:80-90` for the
  "telemetry must never cost the user the thing they came for" catch.
- **GOTCHA — R4**: step 6 is the one that matters. **A browser-supplied `fieldKeys` list would let a
  demoted panel claim re-verify itself**, and decision 2's entire mechanism would be a suggestion.
- **GOTCHA — R9**: steps 14–16 are the failure ordering. Roll back by the hash you already hold, and
  record `invite_sent` **last**. Both are load-bearing; see the diagram in NOTES.
- **GOTCHA**: step 14 persists `body.brief` as `jd_text` — **the same string used as `verifyBrief`'s
  haystack in step 10**. The row and the verified `brief_json` must not be able to disagree. The browser
  posts `state.sent.brief`, never the live textarea, for the same reason `readPack()` posts the frozen CV
  (`public/app.js:796-798`).
- **GOTCHA**: `createInvite` stamps `sent_at` at insert and opens `status` at `'sent'`. There is no draft
  state, deliberately (`store.js:103-109`) — which is exactly why prepare persists nothing.
- **GOTCHA — this file must not import `@anthropic-ai/sdk`.** It has no reason to: the payload arrives in
  the body. Keeping the import out is what makes it importable into `node --test` (task 16), so a
  well-meaning "regenerate if the payload looks stale" branch would cost this ticket its only real-SQL
  integration test. A Level 1 grep enforces it.
- **GOTCHA — R7, the double send.** There is deliberately **no server-side idempotency key**. A second
  Send to the same address is sometimes exactly what the recruiter wants (the date moved, the note
  changed, the CV was updated), and refusing it is a product decision this ticket was not asked to make.
  `inviteByEmail` already handles a candidate holding several live invites by returning the newest
  (`store.js:196-206`). The guard is client-side and terminal — see task 18 — mirroring `readPack`'s
  "one event per pack" guard, which is this repo's own answer to the identical problem.
- **VALIDATE**: `node --check functions/api/prep/send.js`
- **SATISFIES**: AC #1, AC #2, AC #3, AC #5, AC #7

### 15. CREATE `functions/prep/api/brief.js` — `GET /prep/api/brief`

- **IMPLEMENT**:
  - `if (!env.DB) return json({ error: "not_configured" }, 503);`
  - `const session = await requireSession(env.DB, request);` — throws 401, mapped by `errorResponse`.
    **No `sameOrigin` check**: this is a GET, and `src/http.js:41-43` says the bolt is for mutating
    methods only.
  - `const raw = await briefJsonByInviteId(env.DB, session.inviteId);` — `404 { error: "not_found" }` if
    null or blank (a role that has not been written yet).
  - `JSON.parse` → `assertBrief` → `candidateProjection` → `json(projection)`.
  - If `assertBrief` throws, answer `502 { error: "bad_brief" }` and `console.error` the code only. A
    stored payload that no longer satisfies the contract is a deployment fault, not the candidate's.
- **PATTERN**: `functions/prep/api/delete.js` for the shape; `functions/prep/auth/session.js` for the
  "answer honestly, leak nothing" register.
- **GOTCHA — R1**: this file **must** live under `functions/prep/` — that tree is Access-bypassed, which
  is what lets a candidate reach it, and `requireSession` is what stops everyone else. Inverting the two
  directories inverts the security in both directions at once.
- **GOTCHA**: `functions/prep/_middleware.js` already runs `purgeExpired` on every `/prep/*` request, so
  an expired invite's row is gone before this handler runs. Nothing extra to do; do not add a second
  purge.
- **VALIDATE**: `node --check functions/prep/api/brief.js`
- **SATISFIES**: AC #6

### 16. CREATE `test/prep-send.test.js` — the confirm path against real SQL

- **IMPLEMENT** using `test/helpers/sqlite-d1.js`, calling the store functions directly (not over HTTP)
  and the two Functions with a hand-built `context`:
  - **R2, the PK collision.** Two Sends for the SAME client with the SAME payload both persist. Assert
    two `invite` rows, two `candidate_role` rows, and `2 × N` `competency` rows with distinct ids.
    *This is the test `fakeD1` cannot give you — it returns `{changes: 1}` and enforces no constraint.*
  - **R3, the column vocabularies.** Every written `question` row has `axis IS NULL` and a `difficulty`
    that is a **number** — `typeof row.difficulty === "number"`, not merely truthy. An INTEGER-affinity
    column accepts `'standard'` silently, so asserting the value without asserting the type is the same
    blind spot in a different place.
  - **Striking persists the strike.** Send with `strike: [id]` → that competency has no row, its
    questions have no rows, and `brief_json` parsed back contains neither the competency nor any
    reference to it.
  - **The cascade still holds.** `DELETE FROM invite` after a send removes every row this ticket wrote —
    run `purgeExpired` on a back-dated invite and assert zero rows in all seven tables.
  - **`invite_sent` counts once**, and `eventCounts()` reports it under the right client.
  - **Rollback.** Stub `globalThis.fetch` to answer 403 (Resend's unverified-domain answer); the send
    fails, and afterwards there is **no** `invite` row, **no** `candidate_role` row and **no**
    `invite_sent` event. Restore fetch in a `finally` (`prep-email.test.js:8-9` — an escaped stub poisons
    every later file in the process).
  - **The gates**: a past `interview_at` is refused before any model call or write; an unverified
    competency is refused (`not_sendable`); every competency struck is refused; a browser-supplied
    `field_keys` key in the body is refused by `unexpected_fields`.
  - **`expires_at` is `interview_at + 14 days`** on the written row (decision 11).
  - **The candidate endpoint end to end**: after a send, `GET /prep/api/brief` with the session cookie
    minted by exchanging the token through `enter.js` returns a body whose serialisation contains
    `failed_quote` nowhere.
- **PATTERN**: `test/prep-auth.test.js` — a fake `Request` built from a `headers.get` shim; a fake
  `context` of `{ request, env: { DB: d1Shape(db), … } }`.
- **GOTCHA — import `send.js`, and do NOT import `prepare.js`.** `prepare.js` imports
  `@anthropic-ai/sdk` at module scope, so importing it into `node --test` pulls the SDK into the test
  process. `test/prep-auth.test.js`'s precedent only ever imports `functions/prep/api/delete.js`, which
  has no SDK import, so this is untested ground and it is the one place this task could stall.
  `send.js` needs no SDK import — that is what makes it testable, and it is where every constraint this
  file cares about lives. **`prepare.js` is covered by the Level 4 curl sweep and the browser probe**,
  which is the honest instrument for a route whose whole body is one model call.
- **GOTCHA**: `generateBrief` must not be called from this file. Feed the fixture payload in as if the
  prepare step had returned it; the model call is #19's tested territory.
- **VALIDATE**: `PATH="$HOME/.nvm/versions/node/v24.11.0/bin:$PATH" node --test test/prep-send.test.js`
- **SATISFIES**: AC #1, AC #2, AC #3, AC #4, AC #6, AC #7

### 17. UPDATE `public/index.html` — act 4 and the third nav link

- **IMPLEMENT**:
  - Third link in `.topbar-nav`: `<a href="/counts">Prep sent</a>`.
  - Add `<li>` step 4 to `.steps`: `Send the candidate their prep once the interview is booked`.
  - A new `<section class="act" id="act-send" aria-labelledby="send-head" hidden>` after `#act-pack`:
    - `<h2 class="act-head" id="send-head"><span class="act-num" aria-hidden="true">4</span>Send the
      candidate their prep</h2>`
    - `<p class="act-note">` explaining, in plain language, that this sends the candidate a private prep
      page built from the brief, their CV and the parts of your client note you ticked as shareable —
      never the pack.
    - `<label class="field" for="interview-date">When is the interview?</label>` +
      `<input class="input" type="date" id="interview-date">`
    - `<label class="field" for="candidate-email">The candidate's email address</label>` +
      `<input class="input" type="email" id="candidate-email" autocomplete="off">`
    - `<div class="act-row">` with `<button class="btn btn-primary" id="prepare-send"
      aria-disabled="true">Send to candidate</button>` and `<span class="save-state" id="send-state"
      role="status">` and `<span class="elapsed" id="send-elapsed" aria-hidden="true">`.
    - A hidden `<div class="send-preview" id="send-preview" hidden>` containing: a `<p class="act-note">`
      lede, `<ul class="strike-list" id="strike-list">` (the competencies), a
      `<fieldset class="visibility">`-grammar block listing the note sections that will travel with a
      `<a>` to `/clients?client=…` reading **Read the note**, and an `.act-row` with
      `<button class="btn btn-primary" id="confirm-send">Send it</button>` and
      `<button class="btn" id="cancel-send">Not yet</button>`.
- **PATTERN**: act 3's markup exactly — `.act`, `.act-head`, `.act-num`, `.act-row`, `.save-state
  role="status"`, `.elapsed aria-hidden`.
- **GOTCHA**: `aria-disabled`, never `disabled`. Setting `disabled` on the focused button moves focus to
  `<body>` in every engine and does not give it back (`app.js:277-280`).
- **VALIDATE**: `node .claude/probes/one-screen.mjs` (after task 21) and a real-browser pass.
- **SATISFIES**: AC #1, AC #2

### 18. UPDATE `public/app.js` — act 4's wiring

- **IMPLEMENT**:
  - Extend `COPY` with every new string. Plain first-time-recruiter language; no jargon, no
    "token"/"invite"/"payload".
  - Extend `el` with the new nodes; extend `state` with `sendPrepared` (the payload, in memory only),
    `sendStruck` (a `Set` of ids), `sendDone` (the terminal flag — R7), `sendStartedAt`, `sendTick`.
  - `showAct(el.actSend, next === "pack")` inside `setPhase`, so act 4 appears exactly when a pack does
    and disappears on Start again.
  - `updateSendGate()` — sets `aria-disabled` on `#prepare-send` unless a date is present, is not in the
    past, and the email field holds something with an `@`. Called on `input` from both fields and from
    `setPhase`. **AC #1's browser half.**
  - `prepareSend()` — the `reqId`/`mine()` guard, `startSendClock()`, `POST /api/prep/prepare` with
    `{ client_id, brief: state.sent.brief, cv: state.sent.cv, interview_at }`, then render the preview.
    Never `el.brief.value`.
  - `renderPreview(body)` — one `<li>` per competency, built with `createElement` + `textContent`:
    a checkbox (`dataset.id`), the label in `.claim-text`, the sourced/unverified `.mark`, the
    quote in `.claim-source` via the existing `displayQuote()`. Below it, the note sections as
    `heading · N characters`, and the "Read the note" link. Unchecking a box adds the id to
    `state.sendStruck`; if the last box is unchecked, `#confirm-send` goes `aria-disabled`.
    **An unverified competency arrives UNTICKED**, seeded into `state.sendStruck`, with one line above
    the list saying why ("one line could not be found in the brief, so it is not being sent — tick it
    back on if you want it"). The reason is mechanical, not cosmetic: the server refuses a send that
    includes one (step 11), so ticked is a default that cannot be confirmed, and a default that cannot be
    confirmed is a dead end with an error message instead of a control.
  - `confirmSend()` — `POST /api/prep/send` with `{ client_id, email, interview_at, brief, cv, payload,
    strike: [...state.sendStruck] }`. On success: collapse the preview, show a plain confirmation naming
    the address, and **enter a terminal state** — `state.sendDone = true`, `#confirm-send` and
    `#prepare-send` both `aria-disabled`, the two inputs `readOnly`. The only way to send again is
    **Start again**, which clears everything. **On failure: keep `state.sendPrepared`, `state.sendStruck`
    and the preview exactly as they are**, so a mail outage costs a retry and not another two-minute,
    ~30p model call. Say both in comments.
  - **R7, the double send.** `if (state.busy) return;` guards both buttons — that closes the double-click.
    Copy `readPack`'s comment register (`app.js:770-777`): *pressing this again would send a SECOND invite
    and record a SECOND `invite_sent` — one candidate, two counts, and decision 23's number is the thing
    the epic sells on.*
  - **`state.sendDone` IS SET ONLY IN THE SUCCESS HANDLER, NEVER IN THE CATCH.** R7 and R9 pull in
    opposite directions here and the obvious implementation gets it wrong. `confirmSend`'s catch cannot
    tell a `502 mail_failed` from a network timeout, so setting `sendDone` anywhere in the error path
    kills the mail-failure retry — which is the entire point of keeping the payload, and costs the
    recruiter another two minutes and ~30p. Success sets it; failure leaves it false and leaves the
    preview live. Write both halves as a comment; this is the one line in act 4 that a tidy-up will
    break.
  - **R7's residual, which the client guard does NOT close**: a request that times out in the browser but
    succeeded on the server leaves `sendDone` false, so a retry sends a genuine second invite. There is no
    cheap client-side answer — the server-side `409 already_sent` in Open Questions is the answer, and it
    is deliberately not built here. Say so in the comment rather than implying the guard is complete.
  - `sendMessageFor(err)` — a dedicated mapper (act 3's `generateMessageFor` is the pattern): distinct
    copy for `no_model_key`, `interview_past`, `not_sendable` (name the competencies that failed and
    suggest striking them or regenerating the pack), `nothing_to_send`, `not_configured` from the mail
    path ("this deployment cannot send email yet — ask whoever set it up"), `mail_failed` ("the email
    was not accepted. Nothing was sent and nothing was saved. Try again."), `too_long`, `not_found`.
  - `startSendClock()` / `stopSendClock()` over `#send-elapsed`.
  - `resetToInputs()` — clear `sendPrepared`, `sendStruck`, `sendDone`, the two inputs, the preview, thaw
    the inputs, and stop the send clock. It is already the single reset path; do not add a second.
  - `beforeunload` — the dirty check must include the date field, the email field, **and
    `state.sendPrepared`**. A prepared-but-unsent payload is the most expensive thing on the screen: two
    minutes and ~30p, unrecoverable on reload because nothing is written to browser storage. It is worth
    more than the pasted CV the guard was originally written for.
  - `COPY.leavingClient` — extend the wording so it covers a prepared send, not only a part-built pack.
    `select()` and `popstate` both confirm whenever `state.phase !== "inputs"`, and phase `pack` is where
    act 4 lives, so the confirm already fires; it just describes the wrong thing. Route-neutral wording,
    as the existing function already is.
- **PATTERN**: `generate()` at `app.js:694` is the closest analogue; copy its structure.
- **GOTCHA — the second clock.** `setPhase` is documented as *"the only place the clock is stopped"*
  (`app.js:306-311`), and act 4's wait is a different wait with a different lifetime. Give it its own
  interval and its own two functions, and **write a comment saying why it is separate** — undocumented, a
  reviewer reads it as exactly the bug `setPhase` exists to prevent.
- **GOTCHA**: nothing goes into browser storage, and nothing candidate-shaped goes in the URL. The
  candidate's email address lives in a DOM value and in `state`, and nowhere else.
- **GOTCHA**: the payload round-trips through `state.sendPrepared` in memory. Do not stringify it into a
  hidden input, a data attribute or the URL.
- **VALIDATE**: `node --check public/app.js` and the Level 1 greps.
- **SATISFIES**: AC #1, AC #2, AC #3

### 19. UPDATE `public/app.css` — act 4 and the preview

- **IMPLEMENT**: `.send-preview`, `.strike-list` (mirroring `.visibility-list`'s row grammar at
  `app.css:432-486`), and any spacing act 4 needs. Reuse `.claim`, `.claim-head`, `.claim-text`,
  `.claim-source`, `.mark`, `.mark-unverified` verbatim — the preview rows ARE provenance rows, and
  reusing them is what makes the two screens read as one system.
- **PATTERN**: read `.claude/skills/dossier-design/references/CRAFT.md` before writing a single
  declaration. Custom properties from `public/tokens.css` only — **no raw hex**, which the Level 1 grep
  enforces.
- **VALIDATE**: `grep -n "#[0-9a-fA-F]\{3,6\}" public/app.css` finds nothing new.
- **SATISFIES**: AC #2

### 20. CREATE `public/counts.html` + `public/counts.js`; UPDATE the two nav bars

- **IMPLEMENT**:
  - `counts.html`: the shared topbar with three links and `aria-current="page"` on this one; a
    `.page-head` whose sub-line states the claim plainly — *"How many candidates we sent prep to, and how
    many opened it. Nothing about what any candidate did."*; a `<table>` of `Client · Packs · Prep sent ·
    Prep opened`; a `role="status"` line.
  - `counts.js`: `Promise.all([api("/api/clients"), api("/api/events")])`, join on `client_id`, render
    with `createElement` + `textContent`. Clients with no invites show `0`, not a blank.
  - Add the third nav link to `public/index.html` and `public/clients.html` — both carry a static
    two-link nav that has to grow to three.
- **PATTERN**: `public/clients.js`'s `api()` helper (the content-type check that catches an expired
  Access session answering HTML at 200) — copy it, as `app.js:212` already does.
- **GOTCHA — AC #4's "zero per-candidate behaviour" has to be checkable.** This file reads exactly two
  endpoints and neither can return an invite id, an email or an attempt: `eventCounts` selects
  `client_id` and three `COUNT()`s (`src/store.js:524-534`), and `listClients` selects no portal column at
  all. **Add a source-scan test** asserting `counts.js` contains no fetch to any path other than
  `/api/clients` and `/api/events`, and mentions none of `attempt|habit|invite_id|email`.
- **RESOLVED, not assumed**: `/counts` needs no routing configuration. The repo has no
  `public/_redirects`, no `_routes.json` and no wrangler routing config — Pages' built-in HTML handling
  is what already serves `clients.html` at `/clients`, and DEPLOY.md's post-deploy checklist confirms
  `/clients` loads live. `counts.html` at `/counts` is the identical mechanism. The Level 4 curl is
  confirmation, not discovery. **Link to `/counts`, not `/counts.html`**, matching the two existing nav
  links.
- **VALIDATE**: `node --check public/counts.js`; the curl sweep in Level 4.
- **SATISFIES**: AC #4

### 21. UPDATE `.claude/probes/one-screen.mjs` — the CTA-lock probes

- **IMPLEMENT** three probes in the file's existing style (real Chrome over CDP, `window.fetch` stubbed
  before `app.js` runs):
  1. Reach phase `pack` with a stubbed `/api/generate` response, then click `#prepare-send` with the date
     field empty. **Assert zero fetches to `/api/prep/prepare` were issued** and that the state line says
     what is missing. This is AC #1 "provably locked", measured rather than asserted in prose.
  2. Fill the date and the email → the button loses `aria-disabled`; clear the date → it comes back.
  3. Prepare returns a two-competency payload; untick one; confirm; **assert the `/api/prep/send` body's
     `strike` array holds exactly the unticked id** and that `payload` is the one prepare returned.
  4. **R7**: after a successful confirm, click `#confirm-send` twice more — **assert exactly one
     `/api/prep/send` request was issued in total**. This is the counted-twice bug, measured.
  5. **The kept payload**: make `/api/prep/send` answer `502 mail_failed`, then click confirm again —
     assert the second request carries the **same** `payload` and that no `/api/prep/prepare` request was
     issued in between. A mail outage must not cost a second model call.
  6. Prepare returns a payload with one unverified competency — assert its checkbox arrives **unticked**
     and its id is in the `strike` array of the send that follows.
- **GOTCHA**: this file is deliberately **not** part of `npm test` (its own header says so). It is a
  Level 4 step, not a gate.
- **VALIDATE**: `node .claude/probes/one-screen.mjs`
- **SATISFIES**: AC #1, AC #3

### 22. UPDATE `public/prep/brief.js` and `public/prep/index.html`

- **IMPLEMENT**:
  - `brief.js`: `const SOURCE = "/prep/api/brief";` and delete the comment naming this ticket. Add
    `credentials: "same-origin"` is unnecessary (same-origin is the default) but **do** handle the
    statuses: `401` → `window.location.replace("/prep/login")`; `404` → the existing `COPY.empty`
    ("your prep is not ready yet"); anything else → `COPY.failed`.
  - `prep/index.html`: in the signed-in branch, `window.location.replace("/prep/brief")` instead of
    setting placeholder text. Keep the signed-out bounce exactly as it is — its comment says that is the
    one thing that must survive a rewrite.
- **GOTCHA**: `enter.js` redirects to `/prep/` and must keep doing so. Do not change the magic link's
  landing path; change what `/prep/` does when it gets there.
- **VALIDATE**: `node --check public/prep/brief.js`; the Level 4 browser pass.
- **SATISFIES**: AC #5, AC #6

### 23. UPDATE `DEPLOY.md` and `README.md`

- **IMPLEMENT**:
  - `DEPLOY.md` §5b: a `PREP_BASE_URL` paragraph — a plain **Variable**, not a Secret; the exact origin
    with no trailing slash and no path; what it is for (the magic link in the invite email); and the
    fallback ("unset, the link is built from the origin the recruiter's browser used, which is right on
    production and wrong on a preview deployment"). Match the section's established posture: *until it is
    set, nothing is broken.*
  - `DEPLOY.md` route table: add `/api/prep/prepare` and `/api/prep/send` to the **302 → Access** rows and
    `/prep/api/brief` to the served-directly rows — **and add a line saying the recruiter/candidate
    directory split is what makes that true**, with the file paths. This is the fact the next ticket will
    otherwise get wrong.
  - `DEPLOY.md` triage table: `400 not_sendable`, `400 interview_past`, `502 mail_failed` (→ verify the
    sending domain in Resend; §5b), `503 not_configured` from `/api/prep/send` (→ `RESEND_API_KEY`).
  - `README.md`: a **Send to Candidate** paragraph in the Status section, in the register of the existing
    ones, and update the `/prep/brief` paragraph which currently says it renders the fixture "until #22".
- **VALIDATE**: `grep -n "PREP_BASE_URL" DEPLOY.md` and read the section back.
- **SATISFIES**: AC #5, AC #8

### 24. Final sweep

- **IMPLEMENT**: run every command in VALIDATION COMMANDS, then the CHECKLIST from
  `.claude/skills/dossier-design/references/CHECKLIST.md` against act 4 and the counts page.
- **VALIDATE**: all of Level 1–4 green.
- **SATISFIES**: all

---

## TESTING STRATEGY

### Unit Tests

`node --test`, zero dependencies, three instruments used for what each can honestly prove:

- **Pure modules** (`prep-dates`, `prep-strike`, `prep-projection`) — direct calls, real fixtures
  (`test/fixtures/prep-payload.json`, `public/prep/brief.fixture.json`, `spike/inputs/client-note.md`).
  Bias toward the cases that would let something through, not the happy path — `test/note-fields.test.js`
  states that bias and it is the right one here too.
- **Recorded SQL** (`fakeD1`, in `test/portal-store.test.js`) — that no user value reaches a SQL string,
  and that `briefJsonByInviteId` selects one column.
- **Real SQL** (`node:sqlite`, in `test/prep-send.test.js`) — everything that turns on a constraint or a
  `meta.changes`: the PK collision, the cascade, the rollback, `expires_at`. These **pass under `fakeD1`
  while broken**, which is why they live in their own file.
- **Stubbed transport** (`test/prep-email.test.js`) — header injection, the link's presence in both
  halves, and the guard-before-fetch.

### Integration Tests

`test/prep-send.test.js` drives the two Functions with a hand-built `context` over a real migrated
database — request in, rows out — including the end-to-end path: send → exchange the token through
`enter.js` → `GET /prep/api/brief` with the resulting cookie → assert the projection.

### Edge Cases

- Two Sends for the same client (the PK collision — the ordinary second candidate).
- Two Sends to the same email address (`inviteByEmail` returns the newest; the OTP path must still work).
- Every competency struck → refused.
- A `CompetencyMap` whose competencies all strike → dropped, children with it.
- Interview date yesterday → refused. Interview date today → allowed.
- Client note with nothing ticked → generation still runs (`generate.js:66-70` — a recruiter who has
  shared nothing has made a legitimate choice), the preview says "nothing from your note will be shared",
  and `PanelBrief` claims all demote to unsourced.
- Client note ticked but with a duplicate heading → `visibleFields` skips it; the preview must not imply
  it travels.
- `RESEND_API_KEY` unset → `not_configured`, nothing persisted, nothing counted.
- Resend answers 403 (unverified domain — the most likely first failure) → rollback, and the recruiter
  can retry without regenerating.
- A payload posted to `/api/prep/send` that was never prepared (hand-rolled) → `assertBrief` or
  `verifyBrief` refuses it.
- A payload posted with `verified: true` hand-set on a competency whose quote is not in the brief →
  demoted and refused. `verifyBrief` recomputes `verified` on every pass; it never reads the incoming one.
- Confirm clicked twice, and confirm clicked again after a `mail_failed` → exactly one invite either way,
  and the second click on the failure path reuses the payload rather than regenerating.
- A competency unticked on the client note between prepare and confirm → the panel claim that cited it
  demotes to unsourced at confirm and renders with the Unverified mark. Fail-closed, no error.
- Every competency arrives unverified → all pre-unticked → `#confirm-send` is `aria-disabled` and the
  copy says the brief could not be sourced, rather than offering a send the server would refuse.
- Session-less `GET /prep/api/brief` → 401 → the page bounces to `/prep/login`.
- An invite whose interview was 31 days ago → `_middleware.js` purges it, and `/prep/api/brief` answers
  401 (no session) rather than 404.

---

## VALIDATION COMMANDS

Execute every command to ensure zero regressions and 100% feature correctness.

### Level 1: Syntax & Style

```bash
for f in src/prep/dates.js src/prep/strike.js src/prep/projection.js src/prep/email.js \
         src/portal/store.js functions/api/prep/prepare.js functions/api/prep/send.js \
         functions/prep/api/brief.js public/app.js public/counts.js public/prep/brief.js; do
  node --check "$f" || exit 1
done

# no debris
grep -rn "TODO\|FIXME\|console.log" src/prep/ src/portal/ functions/api/prep/ functions/prep/ \
  public/counts.js && echo "clean these" || echo ok

# the credential must never reach a log line.
# `sed` strips the `path:line:` prefix grep -rn adds, because otherwise the FILE NAME is matched
# too: src/prep/email.js:60 logs `response.status` and nothing else, and tripped this gate on the
# word "email" in its own path. A gate that cries wolf gets deleted, so it reads the line.
grep -rn "console\.\(log\|error\|warn\)" src/prep/ functions/api/prep/ functions/prep/ \
  | sed 's/^[^:]*:[0-9]*://' \
  | grep -i "token\|code\|cookie\|link\|email" && echo "LEAK" || echo ok

# nothing parses HTML anywhere on the client
grep -n "innerHTML\|outerHTML\|insertAdjacentHTML\|document.write" \
  public/app.js public/counts.js public/prep/brief.js && echo "HTML SINK" || echo ok

# nothing reaches browser storage
grep -n "localStorage\|sessionStorage\|indexedDB\|document\.cookie" \
  public/app.js public/counts.js public/prep/brief.js && echo "STORAGE" || echo ok

# raw hex instead of tokens
grep -n "#[0-9a-fA-F]\{3,6\}" public/app.css public/counts.html && echo "use tokens" || echo ok

# R1 — THE ROUTE SPLIT. A recruiter endpoint under /prep/ is an unauthenticated endpoint.
ls functions/prep/ | grep -v "^api$\|^auth$\|^_middleware.js$" && echo "UNGATED RECRUITER ROUTE" || echo ok
grep -rln "generateBrief\|createInvite\|sendInviteEmail" functions/prep/ && echo "MINTING UNDER /prep" || echo ok

# every candidate route calls the guard itself — the middleware deliberately does not (session.js:1-11)
for f in functions/prep/api/*.js; do
  grep -q "requireSession\|readCookie" "$f" || echo "UNGUARDED CANDIDATE ROUTE: $f"
done

# send.js must stay SDK-free, or task 16's integration test cannot import it
grep -n "@anthropic-ai/sdk" functions/api/prep/send.js && echo "SDK IN send.js — see task 16" || echo ok

# the gate: `.note` may appear only as visibleFields' first argument
grep -rn "\.note" functions/api/prep/ | grep -v "visibleFields(client.note" && echo "CHECK THESE" || echo ok
```

### Level 2: Unit Tests

```bash
npm test                                                     # Node 20: all pass, sqlite files skip
PATH="$HOME/.nvm/versions/node/v24.11.0/bin:$PATH" npm test  # Node 24: all pass INCLUDING prep-send
```

Expect: every existing test still green (the `sqlite-d1.js` extraction must change no count), plus the
five new files.

### Level 3: Integration Tests

```bash
npm run db:local
npx wrangler@4.114.0 d1 execute DB -c .wrangler/d1-local.toml --local --persist-to .wrangler/state \
  --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
# expect the same eleven tables as before — this ticket adds NO migration
```

### Level 4: Manual Validation

```bash
npm run dev   # :8788, keep running

# 1. the counts page is served and reads only the two aggregate endpoints
curl -s -o /dev/null -w 'counts: %{http_code}\n' http://127.0.0.1:8788/counts

# 2. the CTA's server half: a past date is refused before anything is written
curl -s -X POST http://127.0.0.1:8788/api/prep/prepare -H 'content-type: application/json' \
  -d '{"client_id":"c-1","brief":"x","cv":"y","interview_at":"2020-01-01"}'   # 400 interview_past

# 3. the body vocabulary is closed
curl -s -X POST http://127.0.0.1:8788/api/prep/send -H 'content-type: application/json' \
  -d '{"client_id":"c-1","field_keys":["x"]}'                                  # 400 unexpected_fields

# 4. the candidate endpoint refuses a session-less caller
curl -s -o /dev/null -w 'brief no-session: %{http_code}\n' http://127.0.0.1:8788/prep/api/brief  # 401

# 5. a real send, end to end (needs ANTHROPIC_API_KEY and RESEND_API_KEY in .dev.vars, a verified
#    sending domain, and a client with a note and at least one ticked section). Use YOUR OWN address.
#    Then: read the email in a plain-text client (Gmail "show original" / `mail`), click the link,
#    confirm you land on /prep/brief with the blocks rendered, and View Source the response of
#    /prep/api/brief — `failed_quote`, `importance` and `questions` must all be absent.

# 6. the counts move by exactly one
curl -s http://127.0.0.1:8788/api/events | python3 -m json.tool
```

Then, in a real browser (Safari and Chrome, per the repo's manual sweep):

- Act 4 appears only after a pack, and **Send to candidate** carries `aria-disabled` until both fields
  are filled. Clicking it while locked does nothing and says why.
- The preview lists every competency with its quote and its mark, and lists the note sections by heading
  and character count — **no note text on this screen**.
- Unticking a competency and confirming sends without it, and the confirmation names the address.
- Tab order through act 4 is sane, focus is visible, and the preview's checkboxes operate from the
  keyboard. (`test/helpers/dom.js:6-10` — a fake DOM cannot answer this and must not pretend to.)
- Reload mid-preview loses it and warns first (`beforeunload`).

### Level 5: Additional Validation (Optional)

```bash
node .claude/probes/one-screen.mjs        # the CTA-lock probes; needs Chrome and Node >= 22
bash .claude/verify-deploy.sh             # after deploying: the Access pair still holds
```

---

## ACCEPTANCE CRITERIA

Numbered so every task above traces to one.

- [ ] **AC #1 — the CTA is provably locked without a date.** `/api/prep/prepare` and `/api/prep/send`
      both refuse a missing or past `interview_at` with `400` before any model call or write
      (`test/prep-send.test.js`), and the browser probe shows a click with an empty date issuing zero
      requests (`.claude/probes/one-screen.mjs`).
- [ ] **AC #2 — the preview shows only `candidate_visible` fields.** The prepare response's
      `visible_fields` is derived solely from `visibleFields(client.note, listVisibleKeys(...))`, carries
      headings and counts and no section text, and the screen renders nothing else from the note.
- [ ] **AC #3 — striking a competency removes it and its questions from what persists.** After a send
      with a strike, neither the competency nor its questions have rows, `brief_json` holds no reference
      to it, and `assertBrief` still passes on the stored payload.
- [ ] **AC #4 — the counts page shows sent/opened per client with zero per-candidate behaviour.**
      `/counts` reads only `/api/clients` and `/api/events`; a source-scan test proves it names no
      per-candidate table or field; `invite_sent` is recorded exactly once per successful send, and
      **the probe shows that repeated confirm clicks issue exactly one request** (R7).
- [ ] **AC #9 — every risk-register row is closed by its named assertion.** Walk the table in NOTES and
      tick each row against the test that proves it. A row with no green assertion behind it is an open
      risk wearing a plan's clothes.
- [ ] **AC #5 — the email contains the magic link and renders sanely in a plain-text client.** The text
      half carries the URL as bare text on its own line; the html half carries it in an `href`; the
      agency name is in the display name and the body, escaped in the html and header-safe in the `from`.
- [ ] **AC #6 — the candidate receives a projection, not the stored row.** `GET /prep/api/brief` is
      session-gated and its serialised body contains `failed_quote`, `importance` and `questions`
      nowhere, while still rendering correctly through `renderBlocks`.
- [ ] **AC #7 — the invite lives and dies by the retention rule.** `expires_at = interview_at + 14 days`
      (decision 11); the existing purge removes the whole scope at `interview_at + 30 days` (decision 13)
      with no change to `purgeExpired`.
- [ ] **AC #8 — recruiter routes stay Access-gated and candidate routes never are.** No file under
      `functions/prep/` mints an invite, sends mail or calls a model; the Level 1 route-split greps pass;
      `.claude/verify-deploy.sh` still shows the pair after deploy.
- [ ] All validation commands pass with zero errors (Node 20 and Node 24).
- [ ] No regressions: every pre-existing test still passes, and the `sqlite-d1.js` extraction changes no
      test count.
- [ ] Code follows project conventions — `COPY` objects, `createElement`/`textContent`, bound parameters,
      `StoreError`, no browser storage, no candidate data in a URL.
- [ ] `DEPLOY.md` documents `PREP_BASE_URL`, the three new routes and the new triage codes; `README.md`
      records the feature and stops saying `/prep/brief` renders a fixture.
- [ ] The dossier-design CHECKLIST passes on act 4 and the counts page.

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] All validation commands executed successfully, under Node 20 **and** Node 24
- [ ] Full test suite passes (unit + integration)
- [ ] No linting or syntax errors; every Level 1 grep gate returns `ok`
- [ ] Manual testing confirms the feature — including **one real send to a real inbox**, read in a
      plain-text client
- [ ] **Every row of NOTES → Risk register walked, and the named assertion is green for each**
- [ ] Acceptance criteria all met
- [ ] Code reviewed for quality and maintainability
- [ ] Branch verified immediately before commit (parallel sessions share this worktree)
- [ ] PR body names the route-split correction against the issue's file estimate

---

## OPEN QUESTIONS / ASSUMPTIONS

**Assumptions this plan makes.** None of them block; each is the reading a careful colleague would take.

1. **The Send surface belongs on the pack screen, after a pack exists.** Architecture §1: *"The
   recruiter, having generated a submission pack, presses Send to Candidate once an interview is
   confirmed."* So act 4 is visible in phase `pack` only, and it reuses the frozen `state.sent`.
2. **Two steps, not one.** Decision 15 requires the recruiter to see the competencies before sending, and
   they do not exist before the model call. Prepare → preview → confirm is the only ordering that
   satisfies it without persisting a draft.
3. **The payload round-trips through the browser's memory.** See Notes for why that is safe enough here
   and what makes it so.
4. **`ethos_text` is written from the visible slice; there is no paste box.** Decision 16 names two
   sources and this ships one. Flagged rather than silently dropped.
5. **The preview lists note headings and character counts, not the section text.** `src/store.js:301-306`
   explicitly leaves this decision to this ticket. Rationale: the recruiter ticked those sections on
   `/clients` with the note in front of them, and putting business-context personal data on a second
   screen widens where it appears for one click of convenience. The screen links to the note instead.
   **If the owner would rather see the text at the point of sending, this is a small change** — the
   prepare endpoint returns `slice` with `text` included and the preview renders it.
6. **`question.axis` is NULL for the core bank.** The column's CHECK admits only `lateral|vertical`, and
   #19's schema calls the same field `'core'`. NULL is the only value the database accepts, and the core
   bank is the rows with a NULL axis and no `variant_of`. **If #23 needs `'core'` to be storable, that is
   a migration and a schema-test change made in the open** — not something to paper over here.
7. **`PREP_BASE_URL` falls back to the request origin.** Matches the repo's "until the secret is set,
   nothing is broken" posture. On production the two agree.

**Questions for the owner. None of these blocks execution — build exactly as specified above and raise
them in the PR.** Each is a judgement this plan has already made; the alternative is recorded so the call
can be reversed cheaply rather than rediscovered.

- **Should the counts page be its own screen, or a line on the clients rail?** The AC says "counts page",
  and decision 23 wants somewhere to point at when selling the process claim, so this plan builds the
  page. A rail line would be ~15 lines instead of ~120 but has nowhere to state the claim.
  *Reversing it:* delete `counts.html`/`counts.js` and the third nav link, and extend `rowMeta` in
  `public/app.js` and `public/clients.js`.
- **Should a send be blocked when a `PanelBrief` claim is unsourced?** This plan blocks only on an
  unverified **competency** (the JD half), matching `scripts/gen-brief.js`'s definition of "sendable" and
  `briefSummary`'s note that the panel counts are additive. An unsourced panel claim renders to the
  candidate wearing an Unverified mark, which is the demote-don't-drop rule working as designed.
  *Reversing it:* one added condition at step 11 of task 14, reading `provenance.panel_unsourced`.
- **Should a second Send to the same address for the same client be refused?** This plan does not refuse
  it (task 14's R7 gotcha gives the reasoning: a resend is sometimes what the recruiter wants, and
  refusing is a product decision this ticket was not asked to make). The cost is that `invites_sent` can
  exceed the number of candidates, which makes decision 23's ratio read low rather than high. The
  client-side terminal state stops the accidental case; only the deliberate case gets through.
  *Reversing it:* `inviteByEmail` at step 5 of task 14 already does the lookup — a live row becomes
  `409 already_sent`, and the screen points a candidate who lost their link at `/prep/login`.

---

## NOTES (open canvas)

### Risk register — the nine that pass while broken

Every row is a failure that a reasonable implementation reaches and a reasonable test suite misses. None
is open: each names the task that closes it and the assertion that proves it. If a task below gets cut,
its row is what you are cutting.

| # | The failure | Why it survives testing | Closed by | Proved by |
|---|---|---|---|---|
| R1 | A recruiter endpoint under `functions/prep/` is **unauthenticated** — anyone can mint magic links and spend Opus credit | Every test passes; Access is configuration, not code, and lives in `scripts/setup-access.py` | Tasks 13–15: `functions/api/prep/*` recruiter, `functions/prep/api/*` candidate | Level 1 route-split greps + `.claude/verify-deploy.sh` |
| R2 | **`competency.id` PK collision** on the second candidate for a client | `fakeD1` returns `{changes: 1}` and enforces no constraint | Task 8: `` `${roleId}:${payloadId}` `` | Task 16, "two Sends for the same client", on `node:sqlite` |
| R3 | `question.axis = 'core'` **fails the CHECK** at insert; `difficulty: 'standard'` is **silently stored as text** in an INTEGER column | The payload is valid per #19's schema; the mismatch only appears at the database, and affinity never errors | Task 8: axis `null`, difficulty mapped 1/2/3 | Task 16 asserts the written rows' types and values |
| R4 | A browser-supplied field-key list lets a **demoted panel claim re-verify itself** | The request looks well-formed; `verifyBrief` does exactly what it is told | Task 14 step 6: `listVisibleKeys` read server-side | Task 16: a `field_keys` body key answers `unexpected_fields` |
| R5 | Striking a competency leaves a **dangling reference** and `assertBrief` throws at send | One-strike happy-path tests pass; the break needs a specific block shape | Task 3: prune `competency_ids`, `covers_competency_ids`, drop emptied blocks | Task 4's exhaustive subset test |
| R6 | The candidate's browser receives **`failed_quote`, `importance` and `questions`** — one View Source away | The page renders correctly; not-rendering is not not-delivering | Task 5: `candidateProjection` | Task 6's serialise-and-grep, named by the issue |
| R7 | A **double-click or a retry sends twice** — two invites, two emails, two `invite_sent` events for one candidate, and decision 23's number is wrong | Nothing errors; both sends are individually valid | Task 18: `state.busy` + a terminal `sendDone` set **only on success** | Probes 4–5, and the `readPack` precedent it mirrors |
| R8 | The **agency name injects a mail header**, or `mailFrom` breaks on a comma | The happy-path name has neither | Task 11: strip CR/LF, then RFC 5322 quote | Task 12's injection case |
| R9 | A **mail failure leaves orphan candidate data**, or an already-counted rollback inflates the sales claim | Resend is stubbed green in every unit test | Task 14 steps 14–16: rollback by hash, `invite_sent` last | Task 16's 403 rollback case |

**R7 is the one row that is not fully green, and it says so on purpose.** The client guard closes the
double-click and leaves one case open: a request that times out in the browser but succeeded on the
server. `sendDone` is false, the recruiter retries, and a genuine second invite goes out. There is no
cheap client-side answer; the server-side `409 already_sent` in Open Questions is the answer and is
deliberately not built here. R7 and R9 also pull against each other — see task 18's `sendDone` rule,
which is the single line in act 4 most likely to be broken by a tidy-up.

Two more that are **resolved, not open**, and recorded so nobody re-opens them:

- **`/counts` resolves without configuration.** There is no `public/_redirects`, no `_routes.json` and no
  wrangler routing config in the repo; Pages' built-in HTML handling is what already serves
  `clients.html` at `/clients`, which DEPLOY.md's verification checklist (line ~489) confirms works live.
  `counts.html` at `/counts` is the identical mechanism. The Level 4 curl is confirmation, not discovery.
- **The confirm body cannot be too large.** `cleanInput` caps the brief and the CV at `INPUT_MAX`
  (100,000 characters each), and a payload is ~20 KB, so the worst case is ~220 KB against a Workers
  request-body limit measured in megabytes.

### The one fact that reshapes the ticket

The issue's *Files touched* line says `functions/prep/send.js`. That path was written before #20 created
the Access bypass applications. `scripts/setup-access.py:110-111` and DEPLOY.md's verified route table
both confirm: **`<project>.pages.dev/prep` and `*.<project>.pages.dev/prep` carry `Bypass → Everyone`.**
A Send endpoint in that tree is an unauthenticated endpoint that mints magic links and spends Opus
credit, reachable by anyone who guesses the path.

So the directories carry the security:

| Path | Directory | Door |
|---|---|---|
| `/api/prep/prepare`, `/api/prep/send` | `functions/api/prep/` | Cloudflare Access (recruiter) |
| `/prep/api/brief` | `functions/prep/api/` | `requireSession` on the invite cookie (candidate) |

Two Level 1 greps enforce it, and DEPLOY.md's route table records it, because the next ticket that adds a
portal endpoint will otherwise get this wrong by copying the nearest neighbour.

### Why the payload goes through the browser, and why that is safe enough

The confirm step trusts the browser for the payload and the brief text. The alternatives were worse:

| Option | Why not |
|---|---|
| Regenerate at confirm | A second ~30p Opus call and another two minutes, and the competencies could differ from the ones the recruiter just struck — the preview would be describing something else. |
| Persist a draft at prepare | `createInvite`'s comment: *"there is no draft state"*. A draft is candidate data (the CV) persisted for a send that may never happen, inside a retention regime keyed on an interview date. |
| Server-side session cache | Pages Functions are stateless. There is nowhere to put it that is not D1, which is the option above. |

What makes the round trip acceptable is the **re-verification**, which is not a formality:

- `assertBrief` runs on what arrived, before and after the strike.
- `verifyBrief` re-runs the literal quote check against the posted brief text, and **the field keys come
  from `listVisibleKeys` server-side** — the browser cannot vouch for a panel claim.
- The brief text that was verified is the brief text that is persisted, so `candidate_role.jd_text` and
  `brief_json` cannot disagree.
- An unverified competency refuses the send outright.

And the threat model: the recruiter is behind Cloudflare Access, so the adversary here is a **bug**, not a
person. The engine keeps no candidate data of its own, so there was never a server-side copy to compare
against. Say this in the PR rather than leaving a reviewer to find it.

**Three properties of `verifyBrief` are doing real work on this path, and none of them is obvious:**

1. **`verified` is recomputed from `source_quote` on every pass** (`verify.js:34`) — it is never read
   from the incoming object. So a payload arriving from a browser with `verified: true` hand-set on a
   fabricated competency is re-checked and demoted, and the send is refused. This is what makes the round
   trip safe rather than merely conventional. It is also fragile: an "optimisation" that skipped
   re-verification for already-verified competencies would silently remove the whole guarantee.
2. **The panel half IS idempotent** (`verify.js:63`, keyed on `"failed_field_key" in entry`), and that is
   correct here for a reason the file could not have known. The payload posted at confirm has already
   been through `verifyBrief` once at prepare. Without idempotence, the second pass would overwrite
   `failed_field_key` with the blank `source_field_key` the first pass wrote, destroying the diagnostic
   on exactly the path that needs it. `verify.js:58-63` predicted this path by name.
3. **The client note may change between prepare and confirm** — the recruiter has `/clients` open in
   another tab and unticks a section. Confirm reads `listVisibleKeys` fresh, so a panel claim that was
   sourced at prepare demotes to unsourced and renders to the candidate wearing an Unverified mark.
   That is fail-closed and requires no extra code; it is worth a comment so a reviewer does not read it
   as a race nobody thought about.

### The failure ordering, and what it costs

```
invite row ──► role + competencies + questions ──► email ──► invite_sent event
     │                    │                          │
     └────────────────────┴──── on throw: DELETE FROM invite (cascade takes the rest)
                                                     │
                                        on throw: same, and the browser KEEPS the payload
```

`invite_sent` is last on purpose. The count is decision 23's evidence for the sentence the agency sells
on — *"every candidate we submit gets our prep portal"* — and a rolled-back send that already counted
makes that sentence false in the one direction nobody would check.

Keeping the payload in browser memory across a failure is the difference between a DNS problem costing a
retry and costing another two-minute, ~30p model call. It is one line in the error path and it will be
deleted by accident if it is not commented.

### The PK collision, written out because it is the subtlest thing here

`competency.id` is `TEXT PRIMARY KEY`. The payload's competency ids are model-chosen slugs. The *first*
candidate for a client works. The *second* candidate for the same client, with a similar brief, produces
`stakeholder-management` again — and the insert fails on a constraint, in production, on the recruiter's
second-ever Send.

`fakeD1` returns `{changes: 1}` unconditionally and enforces nothing, so a test suite built on it passes
while this is broken. That is why `test/prep-send.test.js` uses `node:sqlite` with
`PRAGMA foreign_keys = ON` — the same reasoning `test/prep-auth.test.js:1-21` and
`test/portal-purge.test.js:1-13` both give, now needed a third time, which is why the harness moves to
`test/helpers/`.

`` `${roleId}:${payloadId}` `` is namespaced by a UUID that contains no colon, so it is unique per invite
and mechanically derivable by #23 from `candidate_role.id` and the payload it reads.

### Two emails, two rules

`sendOtpEmail` carries no link, deliberately, and `test/prep-email.test.js` asserts that absence: *"an
email that delivers a sign-in code AND a clickable button teaches candidates that a message asking them to
click is normal — which is the exact lesson a phishing email needs them to have learned."*

The invite email's link is its entire mechanism. The two are different **by design**, and the difference
has to be written down in `email.js` or someone will harmonise them — in either direction, and both
directions break something.

### What this ticket closes for other people

- `public/prep/brief.js:35-38` — the comment naming #22 goes away with the fixture.
- `public/prep/index.html` — stops being a dead end that says "your prep brief will appear here".
- `.claude/code-reviews/pr-29-review.md` Low finding 3 — discharged by the projection endpoint and its
  test.
- #18's largest residual risk (its ticket comment on #22) — this is the first candidate-facing code that
  reads a client note, and it reads it through `visibleFields` and nowhere else.
- The epic's checkbox for #22, and the dependency edge into #23 (which now has `competency` and
  `question` rows to drill).

### Sequencing note for parallel work

Phases 1–3 are the whole risk. Phase 4 (recruiter UI) and Phase 5 (candidate page) touch disjoint files
and can run in separate worktrees once the endpoints exist and their response shapes are fixed. Phase 6's
docs can be written alongside either. Nothing here needs `worktree-create` unless you want it — the
sequential path is about a day.

## AMENDMENTS

<!-- Append-only. Newest at the bottom. Each entry: ISO date — what changed and why. -->

- 2026-07-30 — hardened for execution before any code was written. Added the **risk register** (nine
  failures that pass while broken, each bound to a task and an assertion) and made it a completion-checklist
  item, so no row can be descoped silently. Closed the three that were still soft: **R7, the double send**
  (client `state.busy` + a terminal `sendDone` state mirroring `readPack`'s one-event-per-pack guard, plus
  two probes; deliberately no server-side idempotency, with the reasoning and the reversal recorded),
  **unverified competencies arriving pre-unticked** (ticked was a default the server refuses, so it was a
  dead end wearing a control), and the **prepared-payload-in-`beforeunload`** gap (two minutes and ~30p,
  unrecoverable on reload). Strengthened R3's reasoning — SQLite affinity stores `'standard'` in an INTEGER
  column silently, so the difficulty map is correctness, not tidiness, and the test asserts `typeof`.
  Constrained `send.js` to stay SDK-free with a grep gate, which is what keeps task 16's integration test
  importable. Resolved two items from evidence rather than leaving them to discovery: `/counts` needs no
  routing config (no `_redirects`/`_routes.json` in the repo; Pages' HTML handling already serves
  `/clients`), and the confirm body cannot exceed ~220 KB (`cleanInput` caps both inputs at 100,000
  characters). Wrote down the three `verifyBrief` properties the round trip depends on — chiefly that
  `verified` is recomputed from `source_quote` on every pass and never read from the incoming object, which
  is the single line that makes posting a payload from a browser safe. Marked all three Open Questions
  non-blocking and gave each its reversal.
- 2026-07-30 — reconciled R7 against R9, which contradicted each other as first written. `confirmSend`'s
  catch cannot distinguish a `502 mail_failed` from a network timeout, so a `sendDone` set in the error
  path would have killed the mail-failure retry — the entire reason R9 keeps the payload. Rule stated
  explicitly: **`sendDone` is set only in the success handler.** R7's remaining case (a request that timed
  out in the browser but succeeded on the server) is now recorded as a **named residual** on its register
  row rather than left reading green, with the `409 already_sent` Open Question named as its answer.
