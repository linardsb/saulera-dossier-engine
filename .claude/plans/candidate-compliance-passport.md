# Feature: Candidate compliance passport — phone-first checklist and metadata capture

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

## Feature Description

The candidate-facing half of the compliance passport (#68, epic #65): a phone-first checklist at
`/prep/compliance` where a locum signs in with a six-digit code, sees every compliance item the
agency needs with its live state, and hands over the **reference number and expiry date** for each
outstanding one. It sits on the existing `/prep` rails — same OTP door pattern, same zig tokens,
same Access-bypassed tree — but binds to the durable `candidate` record from #67 rather than the
30-day invite scope, because a compliance file outlives any one interview.

**Metadata only.** Per spike #66 (`docs/epics/locum-fit-2.architecture.md`, "Storage:
metadata-only") this ticket captures a typed reference and a date. No photo, no PDF, no upload, no
URL to one. The issue comment on #68 says this explicitly and lifts the `paid-scope` label:

> Per the #66 architecture decision (metadata-only, free pilot): `paid-scope` lifted — this
> ticket's capture step is typed reference + expiry date, not document upload. Upload/custody
> becomes the future R2 milestone.

The ticket body's "photo/PDF upload from a phone (storage per the spike decision) **or**, in
metadata-only fallback, typed reference + expiry date" is resolved by that comment: the fallback
branch is the one that ships.

## User Story

As a locum radiographer registering with an agency
I want to see exactly which compliance items are outstanding and hand over each one's reference
number and expiry date from my phone
So that my file is complete before a booking needs it, instead of dying in an email thread that
starts with "contact us for the forms"

## Problem Statement

TTR's compliance journey today ends at "contact TTR for forms": manual, email-based, no state a
candidate can see, no expiry tracking. Bookings die on an expired training certificate nobody was
watching. #67 built the durable data layer — `candidate`, `assignment`, `compliance_item`, an item
catalogue and a 12-month dormancy purge — but **nothing writes to it and no human can see it**.
There is no door: `createCandidate` has no caller, `setItemState` has no caller, and the portal's
only session is bound to `invite`, which expires 30 days after an interview that a locum booking
usually never has.

## Solution Statement

- **A candidate-rooted session.** Migration `0009` adds `session_hash` / `session_expires_at` to
  `candidate` (the `invite.token_hash` pattern, one credential column on the cage root) and a
  `candidate_otp` child table cascading from `candidate` (the `otp` table's exact shape, new
  parent). Store functions mirror `issueOtp` / `consumeOtp` / `rotateSession` / `inviteByEmail`.
- **The OTP door, duplicated not generalised.** `POST /prep/compliance/auth/otp` and
  `/verify` mirror `functions/prep/auth/{otp,verify}.js` line for line — the uniform 202, the
  five-attempt cap, the digits-only strip, the identical failure copy. `sendOtpEmail` is reused
  **verbatim**: no fourth email is added to `src/prep/email.js`.
- **A separate cookie.** `src/compliance/tokens.js` exports `COMPLIANCE_COOKIE = "compliance_session"`
  scoped `Path=/prep/compliance`, so the compliance credential never rides a request to
  `/prep/brief` and the prep cookie never reaches the passport. The generic primitives
  (`mintToken`, `mintOtpCode`, `hashOtpCode`, `readCookie`, `maxAgeFrom`) are imported from
  `src/prep/tokens.js`, not re-implemented.
- **Two read/write routes.** `GET /prep/compliance/api/items` returns the checklist joined with
  the catalogue **server-side** (label, expires, amber days) so the browser needs no copy of
  `src/compliance/catalogue.js`. `POST /prep/compliance/api/item` writes one item and narrows the
  status vocabulary to `submitted` — a candidate can never write `verified` (that is #71's) or
  `expiring`/`expired` (that is #70's sweep).
- **Delete-now, day one.** `POST /prep/compliance/api/delete` calls `deleteCandidate`, which is one
  `DELETE FROM candidate` and the cascade. The architecture doc requires this: "Candidate-visible
  delete-now from day one."
- **Two pages,** `public/prep/compliance/login.html` + `.js` and `index.html` + `passport.js`,
  linking `fonts.css → tokens.css → app.css → prep.css`. The passport carries no page-scoped style
  at all; the login page carries one block holding `.sr-only` alone, because its `1px` values
  cannot pass prep.css's px gate — the same split `login.html` already made and documented. Status
  chips are `.mark` plus five new modifiers whose colour/tint pairings are already asserted by
  `test/tokens.test.js`.
- **The schema lockfile is amended in the open** — `COMPLIANCE_TABLES` gains `candidate_otp`,
  `EXPECTED_COLUMNS.candidate` gains the two session columns, `CASCADE_CHAIN` gains the new edge,
  and the "only hashes rest" test is extended to the new credential columns.

## Out of Scope / Non-Goals

- **Not included: document upload of any kind.** No photo, no PDF, no R2, no `document_url`
  column, no `<input type="file">`. `test/schema.test.js:417` fails on a column named for a file,
  and that test is the decision, not an obstacle. R2 custody is the future paid milestone with its
  own spike.
- **Not included: a recruiter surface.** No candidate list, no verify button, no at-risk flags,
  no `POST /api/compliance/invite`. Epic AC #3 and #71 own all of it. Consequence, stated out
  loud: **this ticket ships no production path that creates a `candidate` row** — see Open
  Questions Q1 and the `DEMO_MODE` door below.
- **Not included: a magic-link door** (`/prep/compliance/auth/enter`). A magic link needs a fourth
  email and a recruiter action to send it; both belong with the ticket that mints candidate links.
  The OTP pair is the whole door here, and it is the door the ticket's own security model already
  proves.
- **Not included: expiry state transitions.** Nothing in this ticket writes `expiring` or
  `expired`, and nothing computes an amber window. `amberDays` is *returned* by the items route so
  #70 has its seam, and the passport renders whatever status the row already holds.
- **Not included: nudges or emails to the candidate beyond the sign-in code.** #70 owns nudges.
- **Not included: HCPC API integration.** The registration number rests in the
  `hcpc_registration` row's `reference`, exactly as #67's plan said.
- **Not included: assignments.** `createAssignment` gains no caller here; #69 owns it.
- **Not changing:** the prep portal's invite session, `SESSION_COOKIE`, `sessionCookie()`,
  `clearCookie()`, `src/prep/session.js`'s `sessionFromRequest`/`requireSession`, the three
  existing emails, the engine's four tables, the candidate-shaped ban regex, or any applied
  migration.

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: High (auth + schema + two routes + two pages + five test suites)
**Primary Systems Affected**: `migrations/`, `src/compliance/`, `functions/prep/compliance/` (new tree), `public/prep/compliance/` (new tree), `public/prep/prep.css`, `test/schema.test.js`
**Dependencies**: none new. Vanilla D1 + Pages Functions + `node --test`, exactly as today.

## Related Work

**Implements**: [#68](https://github.com/linardsb/saulera-dossier-engine/issues/68) (`Closes #68` in the PR)   ·   **Epic**: [#65](https://github.com/linardsb/saulera-dossier-engine/issues/65), architecture inherited from [`docs/epics/locum-fit-2.architecture.md`](../../docs/epics/locum-fit-2.architecture.md) (spike #66's deliverable — storage, retention, schema-regime, commercial and HCPC calls are **DECIDED there and not reopened here**)

**Back-references**:

- `.claude/plans/compliance-data-layer.md` — #67, the data layer this consumes. Its "Forward-references" name this ticket as the consumer of `catalogue.js`, `itemsByCandidate`, `setItemState` and delete-now.
- `.claude/plans/candidate-auth-magic-link-otp.md` — #20, the auth pattern being mirrored (magic link + OTP, cookie attributes, the enumeration guard).
- `.claude/plans/portal-schema-retention-gdpr.md` — #17, decision 13's cage/purge/delete-now, which spike #66 inherits at a new root.
- `.claude/plans/candidate-portal-shell-redesign.md` / `candidate-portal-content-pages-redesign.md` — #62/#63, the zig token chrome and the markup-gate idiom the new pages must satisfy.

**Forward-references**:

- #70 (expiry radar) is the state-writer for `expiring`/`expired` and consumes the `amber_days` this ticket's items route returns.
- #71 (recruiter dashboard) owns candidate creation, the `verified` write and any invite email.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

**The inherited decisions**

- `docs/epics/locum-fit-2.architecture.md` (whole file, 91 lines) — Why: binding. Storage
  metadata-only (38–43), retention + candidate delete-now (44–48), `paid-scope` lifted (49–51),
  data model shape (59–64), "candidate auth reuses the magic-link + OTP pattern but binds to
  `candidate`" (65–68), and "Missing pieces" (72–78) which names the two things this ticket
  supplies: the `candidate`-rooted session and the catalogue's use.
- `.claude/plans/compliance-data-layer.md` — Why: #67's decisions, especially why the checklist is
  seeded by `createCandidate` and not by the migration.

**The data layer this consumes**

- `src/compliance/store.js` (whole file, 235 lines) — Why: the module you extend. `requireFields`
  (30–37) and `requireOneOf` (47–51) are the validators to reuse; `createCandidate` (73–90) seeds
  the checklist; `deleteCandidate` (103–106) is delete-now and returns `{ok, deleted}`;
  `setItemState` (199–212) is the write, and note it validates the key and status but **not** the
  date — the route must; `itemsByCandidate` (223–234) is the read.
- `src/compliance/catalogue.js` (whole file, 37 lines) — Why: `COMPLIANCE_CATALOGUE` (17–26, eight
  items with `label`/`expires`/`amberDays`), `ITEM_KEYS`, `ITEM_STATUSES`. **Its header at lines
  6–7 claims the passport imports it into the browser — that claim is wrong and this ticket
  corrects it** (see Task 12 and the NOTES section).
- `migrations/0008_compliance.sql` (whole file, 62 lines) — Why: the migration idiom to mirror,
  the cage header comment, the date CHECKs, index naming (`item_by_candidate`).

**The auth pattern to mirror (read all four before writing a line of auth)**

- `src/portal/store.js` lines 295–303 (`inviteByTokenHash`), 343–353 (`rotateSession` — the
  `datetime('now') <= expires_at` guard in the UPDATE), 368–379 (`inviteByEmail` — case-insensitive,
  expiry filtered in the SELECT *because* the route answers uniformly), 395–450 (`issueOtp` — the
  DELETE-before-INSERT rate limit and the cooldown derivation), 456–500 (`consumeOtp` — the
  attempts arithmetic, why no-row and expired are the same answer).
- `src/prep/tokens.js` (whole file, 127 lines) — Why: `mintToken` (23–29), `mintOtpCode` (44–51,
  rejection-sampled, a STRING), `hashOtpCode` (60–62, the id is in the preimage), `sessionCookie`
  (81–83, every attribute's reason — `Path`, `HttpOnly`, `Secure`, `SameSite=Lax`), `readCookie`
  (98–107, splits on the first `=` only), `maxAgeFrom` (120–126, the UTC `Z` rule).
- `functions/prep/auth/otp.js` (whole file, 85 lines) — Why: the route to mirror. The uniform 202
  (1–13), `OTP_TTL_MINUTES` = 10 (27), `OTP_COOLDOWN_MINUTES` = 1 (33), the `ALLOWED` set (22), the
  empty-field exception (50–52), the swallowed mail failure (69–75).
- `functions/prep/auth/verify.js` (whole file, 98 lines) — Why: `MAX_OTP_ATTEMPTS` = 5 (19),
  `withSession` (24–32, why `json()` cannot carry `Set-Cookie`), the digits strip and the
  wrong-length free pass (61–66), `OUTCOMES` (36–41), the rotate-then-answer order (84–94).
- `src/prep/session.js` (whole file, 70 lines) — Why: `PUBLIC_PREP_PATHS` (26–32, the list to
  extend), `sessionFromRequest` (47–60, the shape to mirror — no token, no hash in the return),
  `requireSession` (66–70), and the header's argument (1–11) for why this is per-route and not
  middleware.

**The route and page patterns**

- `functions/prep/api/brief.js` (whole file, 65 lines) — Why: the ⚠ CANDIDATE ROUTE header and the
  directory-is-the-security-decision argument (6–12); why a GET skips `sameOrigin` (34–36); the
  `requireSession` call site.
- `functions/prep/api/delete.js` (whole file, 81 lines) — Why: the delete route to mirror —
  `sameOrigin` on POST, the `ALLOWED` vocabulary, the idempotent `{ok, deleted}`, and the
  `Set-Cookie` clear on the way out (63–77).
- `functions/prep/demo.js` (whole file, 39 lines) — Why: the `DEMO_MODE` shortcut to mirror,
  including the 404-when-ungated line and the "Delete after the demo" note.
- `src/http.js` (whole file, 59 lines) — Why: `json` (9–14), `readJson` (17–34, why non-object JSON
  is a 400), `sameOrigin` (44–50, mutating methods only), `errorResponse` (56–59).
- `src/prep/email.js` lines 81–108 (`sendOtpEmail`) and 109–125 — Why: reuse `sendOtpEmail`
  verbatim, and read 109–125 for why **no fourth email** may be added here.
- `public/prep/login.html` + `public/prep/login.js` (both whole) — Why: the two-act sign-in to
  mirror — the `.sr-only` act headings, `.act[hidden]` guard, `.code-input` treatment, the
  `data-tone` state line, `aria-disabled` rather than `disabled` (login.js 82–88), the four
  decisions in login.js's header (1–26).
- `public/prep/brief.html` + `public/prep/brief.js` (both whole) — Why: the content-page shape —
  the stylesheet chain, the `role="status"` state line, the 401 → `location.replace("/prep/login")`
  bounce (brief.js 63–72), the COPY-object idiom, "nothing is written to browser storage" (1–20).
- `public/prep/prep.css` lines 1–20 (the header's supplement-never-restate contract) and the class
  vocabulary it already owns: `.prep-label`, `.prep-caption`, `.prep-list`, `.prep-field`,
  `.prep-footer`, `.prep-lede`, `.block`, `.block-head`.
- `public/app.css` lines 1093–1130 — Why: `.mark` is the chip atom ("FOUR signals, never colour
  alone: the WORD, the colour, the tint, the shape") and 1118–1122 are its existing modifiers.
  Also `.field` (242), `.input` (250), `.textarea` (252), `.btn` (170), `.save-state` (499).
- `public/tokens.css` lines 66–90 — Why: the three tints and the exact contrast constraint —
  `--text-muted` is 3.75:1 on `--tint-info` and **must not** be used on a chip.

**The gates you must satisfy (read before writing tests)**

- `test/schema.test.js` (whole file, 453 lines) — Why: the lockfile you amend in five places. The
  ALTER parser (100–107, `ADD COLUMN` is the one sanctioned form), the self-guard tests (115–136),
  `COMPLIANCE_TABLES` (155) and its test title (157), `EXPECTED_COLUMNS.candidate` (228),
  `CASCADE_CHAIN` (271–282), "only hashes rest" (343–353), the no-document-bytes regex (417–434).
  **The engine ban regime (146, 168–190) must not change.**
- `test/prep-auth.test.js` (whole file) — Why: the real-SQL auth suite to mirror; its header
  (1–22) lists precisely which behaviours the recording fake cannot see.
- `test/compliance-store.test.js` and `test/compliance-purge.test.js` — Why: the two-suite split
  (recorded SQL vs real SQLite) for the compliance regime.
- `test/prep-content.test.js` (untracked, from #63) — Why: the markup gate to mirror for the new
  pages — ids parsed out of the script, no `maximum-scale`, the 16px iOS-zoom rule, live regions.
- `test/prep-registry.test.js` lines 182 (browser-storage grep) and 845–901 (prep.css gates: no raw
  hex, no raw size, no restatement of an app.css selector, motion behind the guard).
- `test/chrome.test.js` lines 66–74 — Why: `INLINE_STYLE_PAGES` is a hardcoded list; a new page
  with a `<style>` block that is not added to it is silently ungated. **Avoid the problem: carry no
  inline style.**
- `test/tokens.test.js` lines 81–132 — Why: `PAIRINGS` and `TINTS`. Every chip colour this ticket
  uses is already in `TINTS` and needs no new assertion and no new token.
- `test/helpers/sqlite-d1.js` (whole file) — Why: `openMigrated` applies **all** migrations so
  0009 rides in automatically; `d1Shape`, `at(days)`, and `skip` for Node 20.
- `test/helpers/fake-d1.js` (whole file) — Why: the recording fake, and note its bind/placeholder
  count check.

### New Files to Create

| Path | What |
|---|---|
| `migrations/0009_compliance_session.sql` | Two `ALTER TABLE candidate ADD COLUMN`s + `candidate_otp` |
| `src/compliance/tokens.js` | `COMPLIANCE_COOKIE`, `complianceCookie()`, `clearComplianceCookie()`, `SESSION_DAYS` |
| `src/compliance/session.js` | `candidateFromRequest()`, `requireCandidate()` |
| `functions/prep/compliance/auth/otp.js` | `POST` → 202, uniform |
| `functions/prep/compliance/auth/verify.js` | `POST` → 200 + cookie |
| `functions/prep/compliance/api/items.js` | `GET` → checklist + catalogue join + counts |
| `functions/prep/compliance/api/item.js` | `POST` → one item, status narrowed to `submitted` |
| `functions/prep/compliance/api/delete.js` | `POST` → delete-now + clear cookie |
| `functions/prep/compliance/demo.js` | `DEMO_MODE`-gated door (mirrors `functions/prep/demo.js`) |
| `public/prep/compliance/login.html` | Two-act sign-in markup |
| `public/prep/compliance/login.js` | Two-act sign-in behaviour |
| `public/prep/compliance/index.html` | The passport markup |
| `public/prep/compliance/passport.js` | The passport behaviour |
| `test/compliance-auth.test.js` | Real SQLite: OTP cap, expiry, rotation, session read |
| `test/compliance-passport.test.js` | fake-d1 + route-level: status narrowing, date validation, projection |
| `test/compliance-pages.test.js` | Markup gate over the two new pages |

Files **modified**: `src/compliance/store.js`, `src/compliance/catalogue.js` (header comment only),
`src/prep/session.js` (`PUBLIC_PREP_PATHS`), `public/prep/prep.css`, `public/prep/privacy.html`,
`test/schema.test.js`, `test/compliance-store.test.js`, `test/compliance-purge.test.js`.

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

All in-repo — this ticket adds no dependency and needs no external API.

- `docs/epics/locum-fit-2.architecture.md` — the binding decisions (read fully; 91 lines).
- `docs/ttr-improvement-dossier.md` §4-A — the compliance friction inventory the copy answers to.
- `DEPLOY.md` — the migration-apply order for preview/production (`npm run db:preview`,
  `npm run db:remote`) and the 500-means-deployment-fault triage table the route statuses honour.
- [MDN: `<input type="date">`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input/date#value)
  — value is always `YYYY-MM-DD` regardless of the locale shown. Why: that is exactly the format
  `datetime()` accepts, so the route's validator can be one regex plus one `Date` round-trip.
- [MDN: Set-Cookie `Path`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie#pathpath-value)
  — a cookie with `Path=/prep/compliance` is sent for that prefix and its subpaths only. Why: this
  is what keeps the compliance credential off `/prep/brief`.
- No SDK, no framework, no CDN. `test/node-version.test.js` and the zero-dependency `node --test`
  posture are constraints, not preferences.

### Patterns to Follow

**Store module contract** (`src/compliance/store.js:13–15`) — every function takes a D1-shaped `db`
first; no HTTP, no `Response`, no `env`; every user value is a **bound parameter**, never
interpolated:

```js
export async function candidateByEmail(db, email) {
  return db
    .prepare("SELECT id, email FROM candidate WHERE lower(email) = lower(?)")
    .bind(String(email ?? ""))
    .first();
}
```

**Closed vocabularies validated before the SQL** (`src/compliance/store.js:47–51`) — a predictable
bad input answers the store's 400, never a raw `ERR_SQLITE_ERROR` from a CHECK.

**Route spine** — every route in this repo has the same five opening moves:

```js
export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.DB) return json({ error: "not_configured" }, 503);
  if (!sameOrigin(request)) return json({ error: "cross_origin" }, 403);   // mutating methods only
  try {
    const body = await readJson(request);
    const unexpected = Object.keys(body ?? {}).filter((key) => !ALLOWED.has(key));
    if (unexpected.length) return json({ error: "unexpected_fields", fields: unexpected }, 400);
    // …
  } catch (err) {
    return errorResponse(err);
  }
}
```

**Every visible string in one `COPY` object** (`public/app.js:47`'s idiom, held by `brief.js:25`,
`login.js:31`, `registry.js:70`). Written for a first-time locum, not a recruiter: no "vetting",
no "compliance pack", no internal slug on screen.

**Text nodes, never an HTML-parsing assignment** (`registry.js:33–37`) — `createElement` +
`createTextNode` for everything, including values that came back from our own API.

**`aria-disabled`, not `disabled`, on a busy button** (`login.js:82–88`) — `disabled` on the focused
button drops focus to `<body>` and never gives it back.

**The chip grammar** (`app.css:1093`) — a chip is a **WORD** wearing a colour, never a colour alone.

**Comment density.** This codebase explains *why* at the top of every file and beside every
non-obvious line. A new file with a one-line header will read as foreign. Match the neighbours.

---

## IMPLEMENTATION PLAN

### Phase 1: The candidate-rooted session (schema + store + tokens)

Migration 0009, the schema lockfile amendments, the store's five new functions, and
`src/compliance/tokens.js` / `src/compliance/session.js`. Nothing renders yet; `npm test` is green
at the end of this phase and the lockfile tests are the proof.

### Phase 2: The OTP door

**Depends on:** Phase 1.

`functions/prep/compliance/auth/{otp,verify}.js`, `PUBLIC_PREP_PATHS`, and the real-SQL auth suite.
At the end of this phase a candidate row that exists can be signed into with curl.

### Phase 3: The API surface

**Depends on:** Phase 1 (session) — **Independent of:** Phase 2 (the routes need
`requireCandidate`, not the OTP pair). If parallelising, Phases 2 and 3 are the split.

`items.js` (read + catalogue join + counts), `item.js` (the narrowed write + date validation),
`delete.js` (delete-now), and the `DEMO_MODE` door.

### Phase 4: The two pages

**Depends on:** Phases 2 and 3.

`login.html`/`.js`, `index.html`/`passport.js`, the `prep.css` compliance section with the five chip
modifiers, and the privacy-notice extension.

### Phase 5: Gates and validation

**Depends on:** Phase 4.

The markup gate suite, the full `npm test` sweep, and the manual pass against
`wrangler pages dev` on a phone-width viewport.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

### 0. VERIFY the base you are cutting from

- **IMPLEMENT**: before branching, confirm #67 is actually under you and that nobody else has
  claimed the next migration number. Parallel sessions share this worktree and HEAD moves.
  ```bash
  git log --oneline -1                                    # expect 8e583a7 or a descendant of it
  ls migrations/                                          # 0008_compliance.sql present, no 0009
  git worktree list                                       # no sibling worktree on a compliance branch
  test -f src/compliance/store.js && test -f src/compliance/catalogue.js
  ```
- **GOTCHA**: if a sibling session has taken `0009`, take the next free number — applied migrations
  are never renumbered and wrangler applies in filename order.
- **VALIDATE**: `git switch -c feat/compliance-passport && npm test`  (green before you start)
- **SATISFIES**: prerequisite for everything

### 1. CREATE `migrations/0009_compliance_session.sql`

- **IMPLEMENT**: Two `ALTER TABLE candidate ADD COLUMN` statements and one `CREATE TABLE`:
  ```sql
  ALTER TABLE candidate ADD COLUMN session_hash TEXT;
  ALTER TABLE candidate ADD COLUMN session_expires_at TEXT CHECK (session_expires_at IS NULL OR datetime(session_expires_at) IS NOT NULL);

  CREATE TABLE candidate_otp (
    id           INTEGER PRIMARY KEY,
    candidate_id TEXT NOT NULL REFERENCES candidate(id) ON DELETE CASCADE,
    code_hash    TEXT NOT NULL,
    expires_at   TEXT NOT NULL CHECK (datetime(expires_at) IS NOT NULL),
    attempts     INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX otp_by_candidate ON candidate_otp (candidate_id);
  ```
  Header comment in `0008_compliance.sql`'s voice: why the credential is a column on the cage root
  and not a session table (one device, mirroring `invite.token_hash` — a second device signing in
  rotates the first out, which is `verify.js:82–84`'s decision restated); why the OTP is a child
  table (the attempts counter rides the row it caps and dies with it, `otp`'s design); why both
  columns are nullable (a candidate who has never signed in is the honest default and `ADD COLUMN`
  on a populated table cannot be `NOT NULL` without a default).
- **PATTERN**: `migrations/0008_compliance.sql:15–21` (the date CHECK rationale),
  `migrations/0002_portal.sql` (the `otp` table).
- **GOTCHA**: `ADD COLUMN` is the **one** ALTER form `test/schema.test.js:100–107` can parse —
  `RENAME`, `DROP COLUMN` and multi-column ALTERs are invisible to every assertion and fail the
  self-guard at :126. Never edit an applied migration; 0008 is applied.
- **GOTCHA**: no column name may match `/blob|bytes|image|photo|document|file|url|evidence/i`
  (`test/schema.test.js:423`). The names above are clear.
- **VERIFIED, do not re-litigate**: `ALTER TABLE … ADD COLUMN … CHECK (…)` is accepted by SQLite
  3.43.2 **and** the CHECK is enforced on subsequent writes (`'not-a-date'` → `CHECK constraint
  failed`, `'2026-09-01 10:00:00'` → accepted). Checked empirically 3 Aug 2026 while writing this
  plan. The restrictions that would bite — `PRIMARY KEY`, `UNIQUE`, `NOT NULL` without a default, a
  parenthesised default — are all avoided above, which is why both columns are nullable.
- **VALIDATE**: `npm run db:local && npx wrangler d1 execute dossier-engine --local --command "PRAGMA table_info(candidate_otp)"`
- **SATISFIES**: AC #1 (foundation)

### 2. UPDATE `test/schema.test.js` — five amendments, each with its reason said out loud

- **IMPLEMENT**:
  1. `COMPLIANCE_TABLES` (:155) → `["assignment", "candidate", "candidate_otp", "compliance_item"]`,
     with a sentence on why the OTP table joins the compliance regime rather than the portal's.
  2. The test title at :157 → "…and the compliance cage's four"; same for the assertion message
     at :161–164 ("a sixteenth table").
  3. `EXPECTED_COLUMNS.candidate` (:228) → gains `session_expires_at`, `session_hash` (the list is
     **sorted**), plus `candidate_otp: ["attempts", "candidate_id", "code_hash", "expires_at", "id"]`
     with `otp`'s comment (:220–223) restated for the new parent: still no `code` column, still no
     email — the candidate the row hangs off owns the identity.
  4. `CASCADE_CHAIN` (:271) → `candidate_otp: { candidate_id: "candidate" }`.
  5. "only hashes rest" (:343–353) → assert `candidate` includes `session_hash` and **not**
     `session_token`/`session`, and `candidate_otp` includes `code_hash` and not `code`.
- **GOTCHA**: **Do not loosen an assertion to make it pass.** The exact-tables test failing is this
  file working. Every edit above is a deliberate widening with a reason; anything else is the
  boundary moving without a decision (:161).
- **GOTCHA**: the engine ban regime (:146, :168–190) and the portal's seven (:147) are untouched.
- **VALIDATE**: `node --test test/schema.test.js`
- **SATISFIES**: AC #7

### 3. CREATE `src/compliance/tokens.js`

- **IMPLEMENT**:
  ```js
  export const COMPLIANCE_COOKIE = "compliance_session";
  export const SESSION_DAYS = 14;
  export function complianceCookie(token, maxAgeSeconds) { … Path=/prep/compliance … }
  export function clearComplianceCookie() { … Max-Age=0, attributes identical … }
  export function sessionExpiry(now = new Date()) { /* SQLite 'YYYY-MM-DD HH:MM:SS' UTC, now + SESSION_DAYS */ }
  ```
  Re-export nothing; import `mintToken`, `mintOtpCode`, `hashOtpCode`, `readCookie`, `maxAgeFrom`
  from `../prep/tokens.js` at the call sites. Header comment: why a **second** cookie rather than
  widening `sessionCookie()` (`verify.js:21–23`'s "two small duplications rather than one shared
  risk"), and why `Path=/prep/compliance` — the compliance credential must never ride a request to
  `/prep/brief`, exactly as `Path=/prep` keeps the prep credential off `/api/*`.
- **IMPLEMENT — the TTL, and say why in the comment**: `SESSION_DAYS = 14`. The architecture doc
  does not decide this number and the portal's answer (`maxAgeFrom(invite.expires_at)`) does not
  transfer: a compliance file has no interview to end at. Fourteen days is long enough that a locum
  chasing a certificate over a fortnight is not re-authenticating mid-task, and short enough that a
  lost phone loses access inside a window this product already accepts for the prep cookie. Write
  it as one constant with the `OTP_TTL_MINUTES` comment idiom (`otp.js:25–27`): *one constant and
  one test away from changing.*
- **GOTCHA**: `SameSite=Lax` and not `Strict` — even with no magic link today, `Lax` is what keeps
  a future emailed link working, and `Strict` would be a silent trap for whoever adds it.
  `HttpOnly`, `Secure`, no `Domain` — the reasons at `tokens.js:64–80` all still hold.
- **GOTCHA**: `sessionExpiry` must emit **UTC** in SQLite's format. Reuse `toSqliteUtc`/`addDays`
  from `src/prep/dates.js` rather than hand-rolling — `dates.js:79–85` explains why `setDate` is
  wrong across a BST boundary.
- **VALIDATE**: `node --test test/compliance-auth.test.js` (after Task 9)
- **SATISFIES**: AC #2

### 4. UPDATE `src/compliance/store.js` — the five session functions

- **IMPLEMENT**, appended in the existing file's voice, each with a header comment:
  - `candidateByEmail(db, email)` — `lower(email) = lower(?)`, `SELECT id, email`. **No expiry
    filter** (unlike `inviteByEmail`) because a compliance record has no expiry; the dormancy purge
    is what removes rows. `ORDER BY created_at DESC LIMIT 1` for the same reason `inviteByEmail`
    takes the newest.
  - `issueCandidateOtp(db, { candidateId, codeHash, ttlMinutes, cooldownMinutes })` — MIRROR
    `src/portal/store.js:395–450` exactly, `otp`→`candidate_otp`, `invite_id`→`candidate_id`.
    Keep the DELETE-before-INSERT and the cooldown derivation and its comment.
  - `consumeCandidateOtp(db, { candidateId, codeHash, maxAttempts })` — MIRROR
    `src/portal/store.js:456–500` exactly. Keep "no row and expired are the same answer".
  - `rotateCandidateSession(db, { candidateId, newHash, expiresAt })` — one UPDATE setting both
    columns, `WHERE id = ?`. Unlike `rotateSession` there is no `expires_at` guard in the WHERE
    (the row has no lifetime of its own); returns `{ rotated: changes === 1 }`.
  - `candidateBySessionHash(db, sessionHash)` — `SELECT id, session_expires_at FROM candidate
    WHERE session_hash = ?`. Two columns and no third: nothing downstream renders a name or an
    email (Task 10), and a column selected "in case someone needs it" is how a projection widens
    without a decision. Named columns, never `SELECT *` (the file's rule at
    :218–221). Expiry is **not** filtered in the SELECT — the caller applies the policy, exactly as
    `inviteByTokenHash` does and for the reason `src/prep/session.js:39–42` gives.
- **PATTERN**: duplicate, do not generalise. `src/portal/store.js`'s OTP functions are proven
  security code bound to `invite`; parameterising the table name would put a `?`-less string into a
  SQL builder, which this file's contract (:15) forbids outright. Say that in the comment.
- **GOTCHA**: `requireFields` (:30) on every id/hash argument, and the same `StoreError` import.
- **VALIDATE**: `node --test test/compliance-store.test.js`
- **SATISFIES**: AC #2

### 5. CREATE `src/compliance/session.js`

- **IMPLEMENT**: `candidateFromRequest(db, request)` → `{ candidateId, expiresAt }` or `null`, and
  `requireCandidate(db, request)` throwing `new StoreError("invalid_token", 401, …)`. MIRROR
  `src/prep/session.js:47–70` including the "returns no token and no hash" property. Read the
  cookie with `readCookie(request, COMPLIANCE_COOKIE)`, expire with
  `maxAgeFrom(row.session_expires_at) <= 0` (fail closed on an unparseable stamp).
- **GOTCHA**: this file must **not** import `src/prep/session.js` — two independent guards over two
  independent cookies. A candidate holding both cookies is normal and neither guard may see the
  other's.
- **VALIDATE**: `node --test test/compliance-auth.test.js` (after Task 9)
- **SATISFIES**: AC #2

### 6. UPDATE `src/prep/session.js` — extend `PUBLIC_PREP_PATHS`

- **IMPLEMENT**: add `/prep/compliance/login`, `/prep/compliance/auth/otp`,
  `/prep/compliance/auth/verify` to the list at :26–32, each with its one-line reason in the
  existing docblock's format.
- **GOTCHA**: this list is **documentation with no consumer today** (grep confirms: no test and no
  route reads it). Update it anyway — the docblock promises "a reader and a test can both see it",
  and a stale list is worse than none. Do not add a consumer in this ticket.
- **VALIDATE**: `npm test` (nothing should change) + `grep -n "compliance" src/prep/session.js`
- **SATISFIES**: AC #2

### 7. CREATE `functions/prep/compliance/auth/otp.js`

- **IMPLEMENT**: `POST { email }` → **202 `{ok: true}` on every branch**. MIRROR
  `functions/prep/auth/otp.js` whole: the `ALLOWED` set, the `!email` 400 exception, the constants
  `OTP_TTL_MINUTES = 10` and `OTP_COOLDOWN_MINUTES = 1` (exported, as there), `sendOtpEmail` reused
  verbatim, the mail failure swallowed to a `console.error`.
- **IMPORTS**: `getAgency` from `../../../../src/store.js`, `candidateByEmail`/`issueCandidateOtp`
  from `../../../../src/compliance/store.js`, `hashOtpCode`/`mintOtpCode` from
  `../../../../src/prep/tokens.js`, `sendOtpEmail` from `../../../../src/prep/email.js`,
  `json`/`readJson`/`sameOrigin`/`errorResponse` from `../../../../src/http.js`.
- **GOTCHA**: **four** `../`, not three — this tree is one level deeper than `functions/prep/auth/`.
- **GOTCHA**: the uniform 202 matters *more* here than on the prep route. This endpoint answers
  "is this person on an agency's compliance list", and a 404 for an unknown address would be a
  health-adjacent enumeration oracle. Carry `otp.js:5–14`'s comment across and sharpen it.
- **GOTCHA**: ⚠ CANDIDATE ROUTE header. `functions/prep/*` is Access-**bypassed**
  (`scripts/setup-access.py`), which is what lets a candidate reach it; `requireCandidate` is what
  stops everyone else. A file under `functions/api/` would be the opposite mistake
  (`brief.js:6–12`).
- **VALIDATE**: `node --test test/compliance-auth.test.js`
- **SATISFIES**: AC #2

### 8. CREATE `functions/prep/compliance/auth/verify.js`

- **IMPLEMENT**: `POST { email, code }` → 200 `{ok: true}` + `Set-Cookie`. MIRROR
  `functions/prep/auth/verify.js` whole: `MAX_OTP_ATTEMPTS = 5`, the local `withSession` helper,
  the digits strip, the wrong-length free pass, the `OUTCOMES` map (401 / 410 / 429), and the
  unknown-email-answers-as-wrong-code rule. Then: `mintToken()`, `sessionExpiry()`,
  `rotateCandidateSession()`, and `complianceCookie(next, maxAgeFrom(expiresAt))`.
- **GOTCHA**: rotate **before** answering, and if `rotated` is false answer 410 — the code is
  already spent by `consumeCandidateOtp`, so there is nothing to replay (`verify.js:90–92`).
- **GOTCHA**: `json()` cannot carry `Set-Cookie`; build the response by hand (`verify.js:21–32`).
- **VALIDATE**: `node --test test/compliance-auth.test.js`
- **SATISFIES**: AC #2

### 9. CREATE `test/compliance-auth.test.js`

- **IMPLEMENT**: real `node:sqlite` via `test/helpers/sqlite-d1.js`, MIRRORING
  `test/prep-auth.test.js`'s structure and its header (which behaviours the recording fake cannot
  see). Cover:
  - a code is single-use — a second `consumeCandidateOtp` with the right hash fails
  - the five-attempt cap deletes the row and answers `too_many_attempts`
  - an expired code and a never-issued code answer identically (`expired`)
  - `issueCandidateOtp` twice inside the cooldown leaves the first row standing (`issued: false`)
  - `rotateCandidateSession` then `candidateFromRequest` returns the candidate; a stale cookie
    returns `null`; a session past `session_expires_at` returns `null`
  - a second sign-in rotates the first device out (the old cookie stops working)
  - **the cascade**: `DELETE FROM candidate` removes its `candidate_otp` rows (`PRAGMA
    foreign_keys` is on inside `openMigrated`)
  - **`purgeDormant` takes the OTP rows with it** — the new table joins an existing retention
    promise and nothing else asserts that
  - route-level: `otpRoute` answers 202 for an unknown address *and* a known one, and
    `verifyRoute` answers 401 for a wrong code with no distinguishing body
- **GOTCHA**: pass `{ skip }` from the helper — Node 20 has no `node:sqlite` and the suite must
  stay green there.
- **VALIDATE**: `node --test test/compliance-auth.test.js`
- **SATISFIES**: AC #2, AC #7

### 10. CREATE `functions/prep/compliance/api/items.js`

- **IMPLEMENT**: `GET` → 200
  ```json
  { "total": 8, "done": 3, "awaiting_review": 1,
    "items": [ { "item_key": "hcpc_registration", "label": "HCPC registration",
                 "expires": true, "amber_days": 60,
                 "status": "verified", "reference": "RA12345", "expiry_date": "2027-03-01" } ] }
  ```
  `requireCandidate` → `itemsByCandidate` → join to `COMPLIANCE_CATALOGUE` **server-side**, emitting
  in catalogue order (not the store's `ORDER BY item_key`, which is a stable read order, not a
  display order — `store.js:220–221` says the caller applies display order).
- **IMPLEMENT — the counting rule, stated so nobody guesses it**:
  - `done` = items whose status is `submitted` **or** `verified` — the candidate has nothing left to
    do on them. `missing`, `expiring` and `expired` are outstanding, because each needs an action
    from the candidate.
  - `awaiting_review` = status `submitted` alone, which is what makes "verified vs awaiting review"
    visible (ticket scope, bullet 4).
  - `total` = `COMPLIANCE_CATALOGUE.length`. **The epic's "7 of 12" is illustrative**: the catalogue
    holds eight items today (`catalogue.js:17–26`). Never hardcode a total and never pad the
    catalogue to reach one.
- **GOTCHA**: a catalogue item with no row (a candidate seeded before an item was added —
  `catalogue.js:14–16` says this is expected) renders as `missing` with an empty reference. Do the
  left-join in JS off `COMPLIANCE_CATALOGUE`, not off the rows, or new items vanish.
- **GOTCHA**: no `sameOrigin` on a GET (`brief.js:34–36`).
- **GOTCHA — return no identity at all.** No name, no email, no id, no session stamp: the checklist
  is the answer to "what do I still owe you", and a candidate reading their own screen does not
  need to be told who they are. `candidateFromRequest` deliberately returns only
  `{candidateId, expiresAt}` (Task 5, mirroring `src/prep/session.js:44–46`), so a greeting would
  mean widening the session shape to carry identity — the exact property that file exists to keep.
  `brief.js`'s projection discipline: what is DELIVERED is the guarantee.
- **VALIDATE**: `node --test test/compliance-passport.test.js`
- **SATISFIES**: AC #1, AC #3

### 11. CREATE `functions/prep/compliance/api/item.js`

- **IMPLEMENT**: `POST { item_key, reference, expiry_date? }` → 200 `{ok: true}`.
  `sameOrigin` → `requireCandidate` → validate → `setItemState(db, { candidateId, itemKey,
  status: "submitted", reference, expiryDate })` → 404 `not_found` when `updated` is false.
- **IMPLEMENT — the status narrowing, which is the security decision of this route**: the status is
  **not** in the body vocabulary. `ALLOWED = new Set(["item_key", "reference", "expiry_date"])`, and
  `"submitted"` is a literal in this file. `setItemState` accepts all five of `ITEM_STATUSES`
  (`store.js:201`), so without this narrowing a candidate could `POST` themselves `verified` —
  which is #71's recruiter write — or `expired`, which is #70's sweep. Say exactly that in the
  header comment.
- **IMPLEMENT — date validation, because the store does not do it**: `setItemState` binds
  `expiryDate` straight through (`store.js:209`) and `compliance_item.expiry_date` carries
  `CHECK (… datetime(expiry_date) IS NOT NULL)` — so a bad string is an `ERR_SQLITE_ERROR` and a
  **500**, which on this deployment means "deployment fault" (DEPLOY.md's triage table). Validate
  here: `/^\d{4}-\d{2}-\d{2}$/` plus a `Date` round-trip that rejects `2026-02-30`, else 400
  `missing_fields`.
- **IMPLEMENT — the expiry rule, per catalogue**: look the item up in `COMPLIANCE_CATALOGUE`.
  - `expires: true` → `expiry_date` is **required**; absent → 400. An expiring item with no date is
    invisible to the radar this whole epic exists to build (#70).
  - `expires: false` (`references`, `wtr_choice`) → `expiry_date` present → 400 `unexpected_fields`;
    write `null`.
- **GOTCHA**: an unknown `item_key` must be a **400 from the route** (check against `ITEM_KEYS`
  before calling), not a store throw the caller cannot read.
- **GOTCHA**: re-submitting an already-`verified` item sets it back to `submitted`. That is correct
  and deliberate — a new reference number has not been checked by anyone — and it must be said in
  the header comment or someone will "fix" it.
- **GOTCHA**: `reference` is free text a candidate typed. It is bound (`store.js:209`) and rendered
  as a text node, and it is never logged.
- **VALIDATE**: `node --test test/compliance-passport.test.js`
- **SATISFIES**: AC #4, AC #5

### 12. CREATE `functions/prep/compliance/api/delete.js` + UPDATE `src/compliance/catalogue.js` header

- **IMPLEMENT (delete)**: `POST {}` → 200 `{ok: true, deleted}` + `Set-Cookie: clearComplianceCookie()`.
  `sameOrigin` → `requireCandidate` → `deleteCandidate(db, candidateId)`. MIRROR
  `functions/prep/api/delete.js`, minus the body-token branch: there is no emailed compliance token,
  so the cookie is the only credential and `ALLOWED` is empty (any key → 400). Keep the idempotent
  200 and the reported `deleted`, and keep the POST-only rule with its reason (a delete reachable by
  URL-click gets prefetched by mail scanners).
- **IMPLEMENT (catalogue header)**: `src/compliance/catalogue.js:6–7` says "the passport UI (#68)
  imports it into the browser, and it must not drag D1 code along to do it." **That is not what
  happened** — `src/` is not served (`registry.js:40–44`: Pages builds `public/`, so the import
  would 404 at runtime). Correct those two lines to say the passport reads the catalogue through
  `GET /prep/compliance/api/items`, which joins it server-side, and that this is why the browser
  needs no copy. Two lines, nothing else in the file changes.
- **GOTCHA**: this is the architecture doc's "candidate delete-now from day one" — not optional
  polish. It is the lawful-basis posture for a special-category surface.
- **VALIDATE**: `node --test test/compliance-passport.test.js`
- **SATISFIES**: AC #6

### 13. CREATE `functions/prep/compliance/demo.js`

- **IMPLEMENT**: MIRROR `functions/prep/demo.js` exactly, including its header's warning and
  "Delete after the demo": 404 unless `env.DEMO_MODE === "1"`, then `createCandidate` if the demo
  candidate does not exist (so the checklist seeds through its one writer — `store.js:56–58`), mint
  a token, `rotateCandidateSession`, 302 to `/prep/compliance/` with the cookie.
- **GOTCHA**: `createCandidate` throws on a duplicate id (the PRIMARY KEY). Check for the row first
  and create only when absent; do not swallow the error blindly.
- **GOTCHA**: this route is the **only** path in the ticket that creates a `candidate` row, and it
  is gated. Say in the header that production candidate creation is #71's, and that an ungated
  version of this file on a tree that is Access-bypassed would be a sign-in-as-anyone button on the
  open internet.
- **VALIDATE**: `DEMO_MODE=1` in `.dev.vars`, then `curl -si localhost:8788/prep/compliance/demo | head -5`
- **SATISFIES**: AC #8 (manual validation is possible at all)

### 14. CREATE `test/compliance-passport.test.js`

- **IMPLEMENT**: the route suite — `fakeD1` for shape assertions, real SQLite where behaviour
  branches on `meta.changes`. Cover, at minimum:
  - **`POST /api/item` cannot write `verified`** — a body carrying `status` answers 400
    `unexpected_fields`, and the SQL the store built binds `'submitted'`. This is the ticket's
    single most important test.
  - an unknown `item_key` → 400, never a 500
  - `2026-02-30`, `01/03/2026`, `"soon"` and `""` → 400; `2027-03-01` → written
  - an `expires: true` item with no date → 400; an `expires: false` item **with** a date → 400
  - `GET /api/items` returns every catalogue item even when a row is missing, in catalogue order,
    and returns **no** email / id / session field
  - the counting rule: `done` counts `submitted` + `verified`; `awaiting_review` counts `submitted`
  - every route answers 401 with no cookie and 401 with a stale cookie
  - `POST /api/delete` is idempotent and clears the cookie
- **VALIDATE**: `node --test test/compliance-passport.test.js`
- **SATISFIES**: AC #4, AC #5, AC #7

### 15. UPDATE `public/prep/prep.css` — the compliance section

- **IMPLEMENT**: one commented section at the foot of the file:
  - `.passport { max-width: 60ch; }` — a checklist is scanned, not read as prose, so it takes a
    tighter measure than `.brief`'s 72ch.
  - `.passport-count` — the "3 of 8 done" line, the largest thing on the page after the h1.
  - `.item` / `.item-head` / `.item-meta` — the per-item row.
  - the sign-in page's token-valued rules, copied from `login.html`'s block with their comments:
    `.act[hidden]` (the display guard that has already shipped as a bug twice — `prep.css:217`,
    `app.css:461`), `.act-lede`, `.state` + `.state[data-tone="error"]`, `.notice`, `.code-input`.
    Every one of these resolves through a custom property or `em`/`calc`, so the px gate passes.
    **`.sr-only` does not come here** — see the gotcha below.
  - the five chip modifiers, extending `app.css`'s `.mark`:
    ```css
    .mark-missing   { color: var(--text-primary); background: var(--tint-info); }
    .mark-submitted { color: var(--text-primary); background: var(--tint-info); }
    .mark-verified  { color: var(--verified);     background: var(--tint-verified); }
    .mark-expiring  { color: var(--unverified);   background: var(--tint-warn); }
    .mark-expired   { color: var(--danger);       background: var(--tint-warn); }
    ```
- **GOTCHA**: every pairing above is **already** in `test/tokens.test.js`'s `TINTS` table (:114–118)
  and clears 4.5:1. No new token, no new assertion. `--text-muted` on `--tint-info` is 3.75:1 and
  must never appear on a chip (`tokens.css:70–74`).
- **GOTCHA**: `missing` and `submitted` share a tint and are told apart by their **word** — that is
  the chip grammar (`app.css:1093`), not a shortcut.
- **GOTCHA**: `.mark-expiring` and `.mark-expired` **cannot render in this ticket** — nothing writes
  those statuses until #70's sweep. Ship them anyway (the store's five-state vocabulary is the
  contract, `catalogue.js:31–36`) and say so in the comment, or a reviewer reads them as dead CSS
  and deletes them.
- **GOTCHA — what may NOT move here**: `.sr-only` needs `width: 1px; height: 1px; margin: -1px`,
  and the gate at `test/prep-registry.test.js:852` is `assert.doesNotMatch(declarations, /\d+px/)`.
  Raw px in this file fails, full stop — which is exactly why `login.html:31` keeps that rule in a
  page-scoped block and says so in its own comment. Everything else from that page
  (`.act[hidden]`, `.state`, `.notice`, `.code-input`, `.act-lede`) is token-valued or `em`/`calc`
  and belongs here. See Task 16.
- **GOTCHA**: `test/prep-registry.test.js:848` fails on a raw hex or a raw size in this file, and
  :882 fails on any selector `app.css` already owns. `.mark-*` modifiers are free (verified by
  grep); a bare `.mark` rule here would fail.
- **GOTCHA**: any animation goes inside the `prefers-reduced-motion: no-preference` guard, or the
  same suite fails.
- **VALIDATE**: `node --test test/prep-registry.test.js test/tokens.test.js test/chrome.test.js`
- **SATISFIES**: AC #3

### 16. CREATE `public/prep/compliance/login.html` + `login.js`

- **IMPLEMENT**: MIRROR `public/prep/login.html` / `login.js` — two acts, `.sr-only` headings, the
  `.code-input`, `data-tone` state lines, `aria-disabled` busy states, the `?e=` COPY-key rule
  (never reflect the query string into the DOM). Posts to `/prep/compliance/auth/{otp,verify}`,
  then `window.location.href = "/prep/compliance/"`.
- **IMPLEMENT — copy for a first-time locum**, not a recruiter: "Sign in to your compliance
  checklist" / "Enter the email address the agency has for you and we will send you a 6-digit code.
  We will not send you a link to click." Keep the deliberately non-committal sent message
  (`login.js:41–42`) — the server answers uniformly and the page must not undo it.
- **IMPLEMENT — the stylesheet split, which is forced and not a preference**: link
  `fonts.css → tokens.css → app.css → prep.css`, and carry **one** page-scoped `<style>` block
  holding `.sr-only` and nothing else. `.sr-only` is `width: 1px; height: 1px; margin: -1px`, and
  `test/prep-registry.test.js:852` fails prep.css on any `\d+px` — so this rule cannot live there.
  `login.html:29–33` already made this call and wrote down the reason ("raw lengths, which that
  file's token gate rejects… they are a clipping trick, not a design value"); copy the rule and the
  comment. Everything else (`.act[hidden]`, `.act-lede`, `.state`, `.notice`, `.code-input`) is
  token-valued or `em`/`calc` and goes in prep.css (Task 15).
- **GOTCHA**: **add `"public/prep/compliance/login.html"` to `INLINE_STYLE_PAGES` at
  `test/chrome.test.js:68` in the same commit.** That list is hardcoded; a page with a `<style>`
  block missing from it is silently ungated for raw hex and for motion outside the reduced-motion
  guard. This is the one place in the ticket where forgetting a line makes a gate lie.
- **GOTCHA**: nothing may touch `localStorage`, `sessionStorage`, `indexedDB` or `document.cookie` —
  `test/prep-registry.test.js:182` greps for the names, so do not write them in a comment either
  (`brief.js:12–14` explains the dodge).
- **GOTCHA**: `<meta name="viewport" content="width=device-width, initial-scale=1">` with **no**
  `maximum-scale` and no `user-scalable=no` (WCAG 1.4.4), and `<meta name="robots" content="noindex, nofollow">`.
- **VALIDATE**: `node --test test/compliance-pages.test.js`
- **SATISFIES**: AC #2, AC #3

### 17. CREATE `public/prep/compliance/index.html` + `passport.js`

- **IMPLEMENT (markup)**: topbar (`Compliance checklist`), `<main class="passport">` with a
  `.page-head` (h1 + `.page-sub`), a `<p class="passport-count" id="count" role="status">`, a
  `<div id="items">`, a `<p class="save-state" id="state" role="status">`, and a footer linking
  `/prep/privacy` and holding the delete-now control.
- **IMPLEMENT (script)**: fetch `/prep/compliance/api/items`; **401 → `window.location.replace("/prep/compliance/login")`**
  returning a never-settling promise (`brief.js:63–72`). Render one row per item: the label, the
  status chip, the reference and expiry when held, and — for an outstanding item — a small inline
  form (`.field` label + `.input` for the reference, `.input type="date"` for the expiry when
  `expires`, a `.btn`). On submit: `POST /prep/compliance/api/item`, then re-render from the
  response of a fresh `GET` so the count and the chip can never disagree with the server.
- **IMPLEMENT (copy)**: one `COPY` object. Plain language for someone who has never used the word
  "compliance" about themselves: "3 of 8 done" · "We have this — the agency is checking it" ·
  "Not started" · "Expires soon — send us the new one" · "Out of date". A caption under the form:
  "We do not store your documents. Send those to the agency the way you always have — here we keep
  only the reference number and the date it runs out."
- **IMPLEMENT (delete-now)**: a `.btn-danger` in the footer with a `window.confirm` and honest copy
  about what it erases, posting to `/prep/compliance/api/delete`, then replacing to the login page.
- **GOTCHA**: the delete fetch must send `body: JSON.stringify({})` with
  `"content-type": "application/json"`. A bodyless POST makes `readJson` throw `bad_json` 400
  (`src/http.js:17–34`) **before** the empty `ALLOWED` set is ever consulted, so the button would
  fail on the happy path with an error that looks like a server fault.
- **GOTCHA**: `createElement` + `createTextNode` only. A reference number is text a stranger typed.
- **GOTCHA**: the `.input` class is what holds the 16px floor that stops iOS Safari zooming the
  whole viewport on focus (`test/prep-content.test.js`'s header names this exact bug surviving from
  #24 to #63). Every field on this page carries it.
- **GOTCHA**: `role="status"` on both the count and the state line — that is the only channel by
  which a screen-reader user learns their submission landed.
- **GOTCHA**: no browser storage, no candidate-shaped value in the URL (`brief.js:16`).
- **VALIDATE**: `node --test test/compliance-pages.test.js`
- **SATISFIES**: AC #1, AC #3, AC #4, AC #6

### 18. CREATE `test/compliance-pages.test.js`

- **IMPLEMENT**: MIRROR `test/prep-content.test.js` — parse the ids out of each script and assert
  the markup declares them, plus:
  - the stylesheet chain, in order, on both pages
  - **no `<style>` block on the passport page**, and the login page's block contains `.sr-only`
    and nothing else — plus an assertion that `test/chrome.test.js`'s `INLINE_STYLE_PAGES` names
    `public/prep/compliance/login.html`, so the one hardcoded list in the repo cannot silently fall
    out of step with the pages that need it
  - no `maximum-scale` / `user-scalable=no` in either viewport
  - the `noindex` meta on both
  - `role="status"` on the count and state lines
  - every `<input>` carries `class="input"` (the 16px iOS rule)
  - no `localStorage|sessionStorage|indexedDB|document\.cookie` in either script
  - the delete control is a `<button>` inside a form posting nothing by GET
- **VALIDATE**: `node --test test/compliance-pages.test.js`
- **SATISFIES**: AC #3, AC #7

### 19. UPDATE `public/prep/privacy.html` — the compliance data class

- **IMPLEMENT**: a section in the notice's existing voice covering: what the compliance checklist
  holds (a status, a reference number, a date — **and never a document**), why we hold it (to keep
  a booking from failing on a lapsed certificate), how long (12 months after the last assignment
  ends, then it is deleted automatically), and the delete-now link. Match the existing sections'
  heading level and tone.
- **GOTCHA**: the architecture doc calls this out under "Missing pieces" as a required artefact:
  "the privacy-notice extension covering the compliance data class + its lawful basis statement".
  A special-category surface with no notice is the one thing here that is a compliance problem
  rather than a product one.
- **GOTCHA**: `privacy.html` is in `chrome.test.js:68`'s `INLINE_STYLE_PAGES`. Add copy, not
  animation.
- **VALIDATE**: `node --test test/chrome.test.js` + read the rendered page at `/prep/privacy`
- **SATISFIES**: AC #6

### 20. UPDATE the two existing compliance suites for the new table

- **IMPLEMENT**: `test/compliance-store.test.js` gains fake-d1 shape tests for the five new store
  functions (the OTP DELETE-before-INSERT, the rotate binding both columns, `candidateByEmail`
  binding rather than interpolating). `test/compliance-purge.test.js` gains one assertion that
  `purgeDormant` takes `candidate_otp` rows with the cage (real SQLite, cascade).
- **VALIDATE**: `npm test`
- **SATISFIES**: AC #7

---

## TESTING STRATEGY

The repo's split is the strategy, and it is not negotiable: **`fakeD1` proves the SQL you built;
`node:sqlite` proves the behaviour that branches on a constraint or on `meta.changes`.**
`test/helpers/fake-d1.js` returns `{changes: 1}` unconditionally, so every attempt-cap, every
single-use rule and every cascade passes under it while the logic is wrong
(`test/prep-auth.test.js:1–22` lists the four that did).

### Unit Tests

- `test/compliance-store.test.js` (extended) — SQL shapes under `fakeD1`: bound parameters only,
  the DELETE-before-INSERT, no child table named in a statement the cascade owns.
- `test/compliance-pages.test.js` (new) — markup contracts, parsed from source. No DOM needed.
- `test/schema.test.js` (extended) — the lockfile. Runs over the migration **files**, not a live DB.

### Integration Tests

- `test/compliance-auth.test.js` (new) — real SQLite through `openMigrated`: OTP single-use, the
  five-attempt cap, cooldown coalescing, session rotation evicting the first device, expiry,
  cascade, and `purgeDormant` taking the OTP rows.
- `test/compliance-passport.test.js` (new) — the routes end to end against real SQL: the status
  narrowing, date validation, the catalogue join, the 401s, idempotent delete.

### Edge Cases

- A candidate whose checklist predates a catalogue addition → the new item renders `missing`.
- `2026-02-30` (well-formed, not a date) and `01/03/2026` (a date, wrong format) → 400 each.
- An `expires: false` item sent with an expiry → 400. An `expires: true` item sent without → 400.
- A body carrying `status: "verified"` → 400 `unexpected_fields`, and no write.
- Two sign-ins from two phones → the first cookie stops working.
- A cookie whose candidate was deleted by delete-now or the purge → 401, not 500.
- An unparseable `session_expires_at` → treated as expired (fail closed).
- `POST /api/item` twice with the same values → idempotent 200.
- A candidate holding **both** the prep and compliance cookies → each guard sees only its own.
- Six digits pasted as `123 456` → accepted; five digits → 400 without burning an attempt.

---

## VALIDATION COMMANDS

Execute every command to ensure zero regressions and 100% feature correctness.

### Level 1: Syntax & Style

```bash
node --check src/compliance/tokens.js src/compliance/session.js src/compliance/store.js
for f in functions/prep/compliance/auth/*.js functions/prep/compliance/api/*.js functions/prep/compliance/demo.js; do node --check "$f"; done
node --check public/prep/compliance/login.js public/prep/compliance/passport.js

# No browser storage anywhere in the new pages (the grep test/prep-registry.test.js:182 runs)
! grep -rn "localStorage\|sessionStorage\|indexedDB\|document\.cookie" public/prep/compliance/

# No raw hex outside tokens.css
! grep -nE "#[0-9a-fA-F]{3,8}\b" public/prep/compliance/*.html

# No inline style block on the passport page (the login page carries exactly one, for .sr-only,
# and is registered in test/chrome.test.js's INLINE_STYLE_PAGES)
! grep -n "<style" public/prep/compliance/index.html
grep -n "compliance/login.html" test/chrome.test.js

# Metadata-only, structurally: no upload control anywhere in the ticket
! grep -rn "type=\"file\"\|FormData\|multipart" public/prep/compliance/ functions/prep/compliance/
```

### Level 2: Unit Tests

```bash
node --test test/schema.test.js
node --test test/compliance-store.test.js
node --test test/compliance-pages.test.js
node --test test/tokens.test.js test/chrome.test.js test/prep-registry.test.js
```

### Level 3: Integration Tests

```bash
node --test test/compliance-auth.test.js test/compliance-passport.test.js test/compliance-purge.test.js
npm test      # the whole suite — zero regressions in the portal's or the engine's
```

> On Node 20 the `node:sqlite` suites **skip** with a remedy in the message. Run the full sweep on
> Node ≥ 22.5 (`npm test` under nvm's newest) before calling this done, or the integration tests
> proved nothing.

### Level 4: Manual Validation

```bash
npm run db:local                  # applies 0009
echo 'DEMO_MODE = "1"' >> .dev.vars
npm run dev                       # wrangler pages dev on :8788

curl -si localhost:8788/prep/compliance/demo | head -5              # 302 + Set-Cookie, Path=/prep/compliance
curl -s  localhost:8788/prep/compliance/api/items -b "compliance_session=<token>" | head -40
curl -si localhost:8788/prep/compliance/api/items | head -3          # 401 with no cookie
curl -si -X POST localhost:8788/prep/compliance/api/item \
     -H 'content-type: application/json' -b "compliance_session=<token>" \
     -d '{"item_key":"hcpc_registration","reference":"RA12345","expiry_date":"2027-03-01"}'
curl -si -X POST localhost:8788/prep/compliance/api/item \
     -H 'content-type: application/json' -b "compliance_session=<token>" \
     -d '{"item_key":"hcpc_registration","status":"verified","reference":"x"}'   # expect 400
curl -si -X POST localhost:8788/prep/compliance/auth/otp \
     -H 'content-type: application/json' -d '{"email":"nobody@example.com"}'     # expect 202
```

In a browser at **390 × 844** (iPhone 14 width — the phone-first claim is the ticket's):

1. `/prep/compliance/` with no cookie → bounces to the login page.
2. Sign in with the code printed to the `wrangler` console by the mail seam.
3. The count reads "0 of 8 done"; every chip reads "Not started".
4. Submit HCPC with a reference and a date → chip becomes "We have this…", count → "1 of 8 done".
5. Tab through the page with a keyboard: the focus ring is visible on every control, and no button
   loses focus when it goes busy.
6. Zoom to 200% — nothing is cut off, and pinch-zoom works.
7. Delete-now → confirm → the page bounces to login and a re-sign-in finds no candidate.

### Level 5: Additional Validation (Optional)

- `.claude/verify-deploy.sh` after a preview deploy.
- `npm run db:preview` then repeat the curl sweep against the preview URL — the Access bypass on
  `/prep/*` is what makes `/prep/compliance/*` reachable, and it is worth proving once.
- The `dossier-design` skill's `references/CHECKLIST.md` over the two new pages before committing.

---

## ACCEPTANCE CRITERIA

- [ ] **AC #1** — A signed-in candidate sees every catalogue item with its live status and a
      headline count computed from the catalogue (never a hardcoded total), on a 390px viewport.
- [ ] **AC #2** — A candidate signs in with email + six-digit code against a session bound to
      `candidate`, on its own cookie scoped to `/prep/compliance`, with the prep portal's invite
      session untouched and unreachable from it.
- [ ] **AC #3** — Per-item status chips use only existing `tokens.css` values, carry a **word** as
      well as a colour, and clear 4.5:1 on their tint; every visible string is written for a
      first-time locum.
- [ ] **AC #4** — A candidate can submit a reference number and an expiry date for any outstanding
      item and see the chip and the count change.
- [ ] **AC #5** — A candidate cannot write `verified`, `expiring` or `expired` by any route, and a
      malformed date answers 400 rather than 500.
- [ ] **AC #6** — Delete-now erases the whole cage with one statement and clears the session; the
      privacy notice describes the compliance data class, its purpose and its retention.
- [ ] **AC #7** — `npm test` passes on Node ≥ 22.5 with no assertion loosened; the schema lockfile's
      widenings are deliberate and commented, and the engine ban regime is byte-for-byte unchanged.
- [ ] **AC #8** — Nothing in the ticket accepts, stores or references a document: no file input, no
      `FormData`, no column matching `/blob|bytes|image|photo|document|file|url|evidence/i`.
- [ ] No regression in the prep portal: `/prep/brief`, `/prep/session` and `/prep/login` behave
      exactly as before, and neither cookie is visible to the other's routes.

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] All validation commands executed successfully — including the Level 1 greps
- [ ] Full test suite passes on Node ≥ 22.5 (not just Node 20, where the SQLite suites skip)
- [ ] Manual pass done at 390px, with a keyboard, and at 200% zoom
- [ ] Every schema-lockfile edit carries its reason in a comment
- [ ] `src/compliance/catalogue.js`'s browser-import claim corrected
- [ ] Privacy notice extended
- [ ] New files match the neighbours' comment density
- [ ] `test/chrome.test.js`'s `INLINE_STYLE_PAGES` names the new login page
- [ ] PR body says `Closes #68` and names the three calls this plan made that the ticket or the
      architecture doc left open, so whoever closes #68 sees them rather than finding them later:
      1. **OTP only, no magic link.** The ticket says "magic-link + OTP"; a link with nothing to
         mint it would be dead code, and the minting path is #71's. Non-Goals and Q1 carry it.
      2. **A 14-day session TTL** — the one number the architecture doc does not decide (Q2).
      3. **`done` counts `submitted` + `verified`**, with `awaiting_review` surfaced separately (Q3).

---

## OPEN QUESTIONS / ASSUMPTIONS

**Assumptions this plan makes:**

1. **The metadata-only comment on #68 governs, not the ticket body.** The body offers "photo/PDF
   upload … or, in metadata-only fallback, typed reference + expiry date"; the owner's comment
   resolves it to the fallback and lifts `paid-scope`. Everything here follows the comment.
2. **The epic is still contingent on the Louis Groves meeting.** #65 labels everything past the
   spike `contingent` until that meeting confirms the compliance/extension leak. This plan assumes
   the go-ahead has been given or is imminent. If the meeting has not happened, that is a reason to
   hold the ticket, not to change the plan.
3. **`/prep/compliance` is the path.** The ticket says "(or sibling path per the spike)" and the
   spike does not name one. A subdirectory under the Access-bypassed `/prep` tree inherits the
   bypass, the `X-Robots-Tag: noindex` rule and the lazy purge with no config change.
4. **One device at a time.** A second sign-in rotates the first out, which is `verify.js:82–84`'s
   decision for the portal. Nothing in the architecture argues for concurrent devices on a
   phone-first surface. If it turns out to matter, that is a `candidate_session` table, and a
   decision to make in the open.
5. **The eight-item catalogue is right for the pilot.** The epic's "7 of 12" is illustrative; the
   catalogue seeded from TTR's own page holds eight (`catalogue.js:17–26`). Adding items is a
   catalogue edit and a re-seed, not a migration.

**Questions that would change the plan if answered differently:**

- **Q1 — Who creates a `candidate` row in production?** This ticket ships no path but the
  `DEMO_MODE` door, because a recruiter surface is #71 and a magic-link email would be a fourth
  email (`src/prep/email.js:109–125` argues against harmonising the three). If the Louis demo needs
  real candidates before #71 lands, the smallest honest addition is an Access-gated
  `POST /api/compliance/candidates` under `functions/api/` — **not** under `functions/prep/`, which
  is bypassed — plus the fourth email, decided in the open. Flagging rather than building it.
- **Q2 — Is 14 days the right session TTL?** The architecture doc does not decide it and the
  portal's answer does not transfer. 14 days is this plan's call, written as one constant with its
  reasoning. If the owner wants tighter for special-category data, it is a one-line change and one
  test.
- **Q3 — Does `done` mean "verified" or "the candidate has done their part"?** This plan counts
  `submitted` + `verified` as done and surfaces `awaiting_review` separately, because a candidate
  who has handed everything over and reads "0 of 8 done" will conclude the product is broken. If
  the owner wants the stricter reading, it is one predicate in `items.js`.
- **Q4 — Framework/audit retention minimums.** The architecture doc's own open question (Magnit et
  al. may impose minimums that fight the 12-month dormancy purge) is unresolved. It does not block
  this ticket — nothing here changes retention — but the privacy copy written in Task 19 will need
  amending if the answer comes back differently.

---

## NOTES (open canvas)

### Why the auth is duplicated rather than generalised

The tempting refactor is to parameterise `issueOtp` / `consumeOtp` over a table name and a parent
column, and serve both regimes from one implementation. It was rejected for three reasons:

1. `src/compliance/store.js:15` states the contract — *"nothing is ever interpolated into a SQL
   string."* A table name cannot be a bound parameter. The generalised version would put a
   string-built statement at the centre of the product's credential path.
2. The two are **not** the same function. `inviteByEmail` filters expiry in the SELECT because an
   invite dies; `candidateByEmail` must not, because a compliance record does not. `rotateSession`
   guards on `expires_at` in the WHERE; `rotateCandidateSession` has no such column to guard on.
   A shared implementation would need two flags on day one.
3. The house has already made this call and written down why: *"json() builds a fixed header set
   and cannot carry Set-Cookie. Widening it would touch the four other routes that depend on its
   shape, so the cookie-bearing response is built here and in enter.js — two small duplications
   rather than one shared risk"* (`verify.js:21–23`).

The cost is real — a fix to the cooldown derivation now has two homes — and the mitigation is a
comment in each pointing at the other, which is the same mitigation `withSession` uses.

### The two cookies, and why the paths matter

```
prep_session         Path=/prep              → sent to /prep/brief, /prep/session, /prep/compliance/*
compliance_session   Path=/prep/compliance   → sent to /prep/compliance/* only
```

The prep cookie reaching compliance routes is harmless: `requireCandidate` reads
`compliance_session` by name and `readCookie` splits on the first `=` only, so a neighbour cookie is
never mistaken for ours (`tokens.js:93–97`). The reverse — a compliance credential riding a request
to `/prep/brief` — is what the narrower path prevents, and it is why the path is not simply `/prep`.

### Why the catalogue join is server-side

`catalogue.js`'s header says the passport imports it into the browser. It cannot: `src/` is not in
the Pages build output, so `import "../../src/compliance/catalogue.js"` from `public/` 404s at
runtime. `registry.js:40–44` hit this exact wall and solved it by **retyping** the list in the
browser file with `test/prep-registry.test.js` asserting the two match.

This ticket takes the other branch — the API returns the label and the thresholds — because the
passport's rows are *data about the candidate*, not a vocabulary the browser must validate against.
The registry retyped its list because the walker needs the names before any fetch; the passport
needs nothing before its fetch. One fewer copy, one fewer drift test, and it is why Task 12 fixes
the misleading comment rather than leaving a trap for the next reader.

### Sequencing and risk

| Risk | Mitigation |
|---|---|
| The schema lockfile fails and gets loosened instead of amended | Task 2 is explicit about all five edits and says out loud that a red lockfile is the file working |
| The date validation gap becomes a 500 in front of a candidate | Task 11 owns it; `store.js:209` is the evidence it is not handled below |
| A candidate writes `verified` | The status is not in the body vocabulary at all, and the test for it is named the ticket's most important |
| Nobody can demo it | Task 13's `DEMO_MODE` door, mirroring an existing gated file |
| The login page's `<style>` block is ungated because `INLINE_STYLE_PAGES` is hardcoded | Task 16's gotcha adds the page to the list, and Task 18 asserts the list names it |
| Phases 2 and 3 conflict in parallel worktrees | They touch disjoint files; only `src/compliance/store.js` (Phase 1) is shared, and it lands first |

### What this ticket deliberately leaves half-built, and why that is right

There is no way for a recruiter to see any of this, and no way in production to create a candidate.
That reads like an incomplete feature and is actually the epic's own slicing: #71 is the recruiter
side and it depends on #68 and #70. Building a thin recruiter route here would put a fourth email
and a candidate-creation surface into a ticket whose acceptance criteria never mention either, and
would pre-empt a decision (#71's) about what a recruiter sees. The `DEMO_MODE` door is the smallest
thing that makes the candidate side demoable to Louis without pretending to be the recruiter side.

## AMENDMENTS

<!-- newest at the bottom; leave empty until this plan has been executed -->
