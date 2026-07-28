# Feature: Candidate auth — magic link + email-OTP return

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

## Feature Description

The candidate's door into the prep portal, and the only thing standing between an invite email and
privileged client knowledge. Three surfaces:

1. **Minting** — a cryptographically random invite token, hashed into `invite.token_hash`. #20 owns
   the mint + the store function; #22 calls it from the Send CTA.
2. **The magic link** — `GET /prep/auth/enter?t=<token>` exchanges the emailed token for an
   HttpOnly session cookie, stamps `opened_at` exactly once, and records `invite_opened`.
3. **The returning login** — the candidate types their email, receives a 6-digit code by Resend,
   and `POST /prep/auth/verify` trades it for the same session cookie. Codes are single-use, short-
   lived, and attempt-capped.

Sessions expire with the invite (`interview_at + 14d`, decision 11). Explicitly **not** Cloudflare
Access — the 50-user cliff makes Access wrong for candidates. Access stays the recruiter door, and
this ticket is what makes those two doors coexist on one hostname.

## User Story

As a candidate who has been invited to prepare for an interview
I want to open one link from my email and land straight in my prep — and get back in with a code if I lose the link
So that the door costs me nothing, while nobody else can walk through it

## Problem Statement

Nothing today distinguishes a candidate from the public. Worse, **Cloudflare Access currently gates
the entire hostname** — verified 28 Jul 2026: `/prep/privacy` and `/prep/api/delete` both 302 to
`linardsberzins.cloudflareaccess.com`. #17 shipped the portal's schema, purge, delete-now and
privacy notice into a wing of the building nobody outside the agency can reach. Meanwhile `invite`
and `otp` hold `token_hash` / `code_hash` columns with no code that writes or checks them.

So there are two problems, and the ticket only names one:
- **the code problem** — no minting, no exchange, no session, no OTP;
- **the infrastructure problem** — one hostname, two audiences, one blanket Access policy.

## Solution Statement

**The infrastructure half** (VERIFIED LIVE, 28 Jul 2026): two path-scoped Cloudflare Access
applications at `saulera-dossier-engine.pages.dev/prep` and `*.saulera-dossier-engine.pages.dev/prep`,
each carrying a single **Bypass → Everyone** policy. Cloudflare resolves the more specific path
first, so `/prep/*` serves publicly while `/`, `/clients.html` and `/api/*` keep redirecting to
Access. Both apps already exist (see NOTES → "Access spike"); this ticket writes them into
`scripts/setup-access.py` so the next agency gets them without clicking, and adds `public/404.html`
so the newly-public `/prep/*` prefix stops falling back to the recruiter's `index.html`.

**The code half**: the invite token **rotates on every exchange**. The emailed token is single-use —
`GET /prep/auth/enter` swaps `invite.token_hash` for the hash of a freshly minted session token and
puts the raw session token in an HttpOnly, `Path=/prep` cookie. A replayed link finds no matching
hash and is rejected, which is what makes "reused tokens rejected" and "`opened_at` set exactly
once" the *same* structural fact rather than two guards. `invite.token_hash` stays the one credential
column — no new table, no divergence from architecture §4. OTP verify rotates the same column
without touching `opened_at`, so a returning login never re-inflates the opened count.

## Out of Scope / Non-Goals

- **Not included: the Send CTA, the invite email, telemetry counts** — #22. This ticket ships
  `mintInviteToken()` + `createInvite(db, …)` + a generic `sendEmail()`; #22 wires the button and
  writes `sendInviteEmail()` beside `sendOtpEmail()`.
- **Not included: any prep content behind the door** — the dashboard is #21, the drill UI #24.
  `public/prep/index.html` here is a deliberately bare signed-in landing whose only job is to prove
  the guard works; #21 replaces it.
- **Not included: the delete *button***. #17 shipped the endpoint, #24 ships the button. This ticket
  only teaches `functions/prep/api/delete.js` to read the session cookie (see Task 12 — without it
  rotation silently breaks #17's endpoint).
- **Not included: the `prep.` subdomain** (architecture decision 20). The portal ships path-scoped on
  the existing deployment; the path-bypass verification below is what makes that viable.
- **Not changing: `invite.status`'s lack of a CHECK.** SQLite cannot add a CHECK by `ALTER`. #20
  writes `'sent'` → `'opened'`; #17's Open Question 2 stays open.
- **Not changing: the recruiter's Access posture.** The two existing apps are untouched; the bypass
  apps are added beside them. Do **not** re-toggle Pages → Settings → General → *Enable access policy*.

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: High (ticket estimates ~500–800 lines; the Access script, `404.html` and
doc drift push the real figure to ~900–1200 incl. tests)
**Primary Systems Affected**: Cloudflare Access config, `functions/prep/auth/*`, `src/prep/`,
`src/portal/store.js`, D1 (`otp` widening), `public/prep/`, `scripts/setup-access.py`, test suite
**Dependencies**: Resend (HTTP only — no SDK; the suite stays zero-dependency). New secret
`RESEND_API_KEY`; new plain var `PREP_MAIL_FROM`.

## Related Work

**Implements**: [#20](https://github.com/linardsb/saulera-dossier-engine/issues/20) (PR must say
`Closes #20`)  ·  **Epic**: [#16](https://github.com/linardsb/saulera-dossier-engine/issues/16) +
`docs/epics/candidate-portal.architecture.md` (23-decision record — inherited, not re-decided)

**Back-references**:

- `.claude/plans/portal-schema-retention-gdpr.md` (#17) — Why: ships `invite`/`otp`, `hashToken`,
  the `/prep/*` middleware and the delete endpoint this ticket extends. Its NOTES → "Access
  re-enablement risk" hands this ticket the bypass problem by name.
- `.claude/plans/candidate-brief-generation-seam.md` (#19) — Why: the `src/prep/` module idiom.
- `docs/epics/candidate-portal.architecture.md` — Why: decisions 10 (Resend), 11 (interview+14d),
  12 (magic link + OTP, not Access), 18 (token-gated candidate routes beside Access-gated recruiter
  routes), 20 (superseded — path-scoped, see NOTES).

**Forward-references**:

- #22 consumes `mintInviteToken` / `createInvite` / `sendEmail`; #21 and #24 consume `requireSession`.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

Read these from **`origin/main`** — the portal work landed there in PRs #26/#27/#28.

- `src/portal/store.js` (all 55 lines) — Why: **reuse `hashToken`, do not re-implement it.** The
  module header states the contract every function added here must keep: D1-shaped `db` first,
  bound parameters only, no HTTP/Response/env. This is where every new SQL statement goes.
- `functions/prep/api/delete.js` (all 37 lines) — Why: the exact Function shape to mirror, and the
  file Task 12 modifies. Its header comment ("POST only, no GET handler: a delete reachable by
  URL-click gets prefetched by mail scanners") is the house's prior reasoning about mail scanners —
  the magic link inherits that concern (see NOTES → "Prefetch").
- `functions/prep/_middleware.js` (all 20 lines) — Why: runs on **every** `/prep/*` request
  including static assets. This is precisely why the session guard must NOT live here.
- `src/http.js` (all 59 lines) — Why: `json`, `readJson`, `sameOrigin`, `errorResponse`. `json()`
  builds a `Response` with a fixed header set and **cannot attach `Set-Cookie`** — Task 4 adds a
  sibling helper rather than editing it.
- `migrations/0002_portal.sql` (lines 16–27 `invite`, 86–93 `otp`, 95–102 `events.kind`) — Why: the
  exact columns this ticket writes. Note the comment at 13–15: "`status` carries no CHECK
  deliberately: its vocabulary belongs to #20/#22" and at 86: "#20 mints and checks codes."
- `test/schema.test.js` (lines 86–135 the ALTER parser, 137–138 the table lists, 179–218
  `EXPECTED_COLUMNS`, 276–287 the hashes-only test) — Why: a lockfile. Task 2's `ALTER` must be
  added to `EXPECTED_COLUMNS.otp` in the same commit or the suite fails.
- `src/store.js` (lines 12–13 contract, 30–33 `INVITE_EVENT_KINDS`, 42–49 `StoreError`, 503–522
  `recordInviteEvent`) — Why: `recordInviteEvent(db, {clientId, kind})` already exists — call it,
  don't write it. `StoreError(code, status, message)` is the shared error vocabulary.
- `test/portal-purge.test.js` (all 238 lines) — Why: **the pattern for every behavioural test in
  this ticket.** Its `node:sqlite` skip guard, its D1-shaped adapter, and its `PRAGMA foreign_keys = ON`
  are copied, not redesigned. See "the fake-d1 trap" in TESTING STRATEGY.
- `test/portal-store.test.js` (all 98 lines) — Why: recorded-SQL assertion idiom against `fakeD1`,
  and the `codeOf()` helper.
- `test/helpers/fake-d1.js` (lines 29–58) — Why: **`run()` always returns `{meta:{changes:1}}`.**
  Every `changes`-branching assertion in this ticket is invisible to it.
- `scripts/setup-access.py` (all 129 lines) — Why: Task 1 extends `targets` (line 75). Its dedup key
  is `a.get("domain")` (line 73), which already handles path-scoped entries; its inline-policy safety
  check (lines 112–117) must cover the bypass apps too.
- `public/prep/privacy.html` (lines 1–48) — Why: the candidate-facing page head + topbar pattern the
  login page mirrors. Tokens only, no raw hex.
- `public/clients.js` — Why: the fetch/error-rendering idiom `public/prep/login.js` follows.
- `.claude/verify-deploy.sh` (lines 5–16 stale header, 88–110 post-Access branch) — Why: Task 13.
  Its header still claims "ACCESS IS DEFERRED"; #17's plan explicitly left the fix to #20.
- `DEPLOY.md` (§3 lines 125–188 Access, §5b lines 328–362 secrets, §6 lines 363–406 smoke sweep) —
  Why: three sections drift with this ticket.

### New Files to Create

- `migrations/0004_otp_attempts.sql` — `otp.attempts` (the attempt cap needs somewhere to count)
- `src/prep/tokens.js` — pure minting + cookie serialisation + `hashOtpCode`
- `src/prep/session.js` — `sessionFromRequest`, `requireSession` (the per-route guard)
- `src/prep/email.js` — the Resend transport (`sendEmail`, `sendOtpEmail`)
- `functions/prep/auth/enter.js` — `GET /prep/auth/enter?t=…` magic-link exchange
- `functions/prep/auth/otp.js` — `POST /prep/auth/otp` request a code
- `functions/prep/auth/verify.js` — `POST /prep/auth/verify` trade code for session
- `functions/prep/auth/session.js` — `GET /prep/auth/session` current state
- `public/prep/login.html` + `public/prep/login.js` — the minimal login page
- `public/prep/index.html` — bare signed-in landing (#21 replaces)
- `public/404.html` — stops the asset fallback serving `index.html` under the public `/prep/*`
- `test/prep-tokens.test.js` — pure minting/cookie/hash unit tests
- `test/prep-auth.test.js` — **real-SQLite** behavioural tests (expiry, forgery, reuse, once-only, OTP cap)
- `test/prep-email.test.js` — Resend payload + `not_configured` path, `globalThis.fetch` stubbed

> **Naming trap**: `test/tokens.test.js` already exists and is the **CSS contrast gate** over
> `public/tokens.css`. Do not touch it. The new file is `test/prep-tokens.test.js`.

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [Cloudflare Access — Application paths](https://developers.cloudflare.com/cloudflare-one/policies/access/app-paths/)
  - Section: precedence. *"When multiple rules are set for a common root path, the more specific
    rule takes precedence… no rule is inherited from `dashboard.com/eng`."*
  - Why: the whole basis of the bypass. **Already verified live on this deployment** — see NOTES.
- [Cloudflare Access — Policy actions (Bypass)](https://developers.cloudflare.com/cloudflare-one/policies/access/#bypass)
  - Why: `decision: "bypass"` + `include: [{"everyone": {}}]` is the policy shape used.
- [Resend — Send email](https://resend.com/docs/api-reference/emails/send-email)
  - Why: `POST https://api.resend.com/emails`, `Authorization: Bearer re_…`, body
    `{from, to, subject, html, text, reply_to}`. Success `200 {"id": "..."}`.
- [Resend — Errors](https://resend.com/docs/api-reference/errors)
  - Why: **403 = unverified sending domain** (the single most likely first failure), 422 invalid
    fields, 429 rate/quota. Log the status; never surface Resend's message to the candidate.
- [MDN — Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie)
  - Why: `SameSite=Lax` is required (not `Strict`) — the cookie is set on a top-level GET navigation
    from an email client, and `Strict` would be dropped on that cross-site navigation.
- [Cloudflare Pages — Not Found (404) handling](https://developers.cloudflare.com/pages/configuration/serving-pages/#not-found-behavior)
  - Why: with no `public/404.html`, unmatched paths fall through to `index.html` at **200**.

### Patterns to Follow

**Store contract** (`src/portal/store.js:7-10`): *"every function takes a D1-shaped `db` as its
first argument. No HTTP, no Response, no env. Every user value is a bound parameter; nothing is ever
interpolated into a SQL string."*

**Function layer** (`functions/prep/api/delete.js:16-36`) — copy this spine exactly:
```js
if (!env.DB) return json({ error: "not_configured" }, 503);
if (!sameOrigin(request)) return json({ error: "cross_origin" }, 403);   // mutating methods only
const body = await readJson(request);
const unexpected = Object.keys(body ?? {}).filter((k) => !ALLOWED.has(k));
if (unexpected.length) return json({ error: "unexpected_fields", fields: unexpected }, 400);
// … store call … catch (err) { return errorResponse(err); }
```

**The `ALLOWED` set** is not decoration. Every mutating endpoint in this repo declares its whole
body vocabulary and 400s on anything else. Three new endpoints, three `ALLOWED` sets.

**Error vocabulary** (`src/store.js:42-49`): `StoreError(code, status, message)`, lowercase
snake_case. Reuse `missing_fields` 400, `not_found` 404, `not_configured` 503. New codes this
ticket introduces: `invalid_token` 401, `expired` 410, `too_many_attempts` 429.

**Test-file voice**: every test file opens with a comment naming the class of failure it exists to
catch; assertions carry messages that say what moved and why it matters.

**UI**: activate the `dossier-design` skill before writing the login page; `references/CRAFT.md`
before CSS, `references/CHECKLIST.md` before committing. Tokens only, no raw hex. Every visible
string in plain language — this reader is a nervous candidate the night before an interview.

---

## IMPLEMENTATION PLAN

### Phase 0: Branch from `origin/main`

**Depends on:** nothing. Do this first or Phase 3 has no `invite` table to talk to.

The working copy's current branch (`feature/candidate-brief-generation-seam`) predates
`migrations/0002_portal.sql`. Parallel sessions share this worktree — use a linked worktree, and
never `git add -A` (other sessions leave untracked files under `.claude/`).

### Phase 1: The door in the wall (Access + the fallback)

**Independent of:** Phases 2–5. Infrastructure and config only — can run in parallel with the code.

Bypass apps written into `setup-access.py`; `public/404.html`; `verify-deploy.sh` rows.

### Phase 2: Schema + pure modules

**Depends on:** Phase 0.

`migrations/0004_otp_attempts.sql` + the `schema.test.js` lock, then `src/prep/tokens.js` — pure,
no D1, fully unit-testable.

### Phase 3: Store layer

**Depends on:** Phase 2 (statements target the widened `otp`).

Six functions appended to `src/portal/store.js`, plus `src/prep/session.js`.

### Phase 4: Transport

**Depends on:** Phase 2 only. **Independent of:** Phase 3 — `src/prep/email.js` touches no D1.

### Phase 5: Routes and the login page

**Depends on:** Phases 3 and 4.

### Phase 6: Validation, docs, deploy sweep

**Depends on:** everything.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom.

### 0. SETUP the branch

- **IMPLEMENT**: `git fetch origin && git worktree add ../saulera-prep-auth -b feature/candidate-auth-magic-link origin/main`, then work there. Confirm `migrations/0002_portal.sql` and `src/portal/store.js` are present before writing a line.
- **GOTCHA**: parallel sessions move HEAD in the primary worktree. Verify the branch before every commit; stage named paths, never `-A`.
- **VALIDATE**: `git branch --show-current` → `feature/candidate-auth-magic-link`; `ls migrations/` shows `0001`, `0002`, `0003`; `npm test` green **before** any edit.
- **SATISFIES**: prerequisite for all.

### 1. UPDATE scripts/setup-access.py

- **IMPLEMENT**: teach it the candidate-portal bypass. Extend `targets` (line 75) from a 2-tuple list to a 3-tuple carrying the policy, so one loop creates all four apps:
  ```python
  ALLOW = lambda emails: {"name": "Allow listed emails", "decision": "allow",
                          "include": [{"email": {"email": e}} for e in emails]}
  # The candidate portal is deliberately public: decision 12 rules Access out for candidates
  # (the 50-user cliff), and #20's rotating token is the door instead. Access resolves the
  # more specific path first, so these two carve /prep/* out of the two apps above while
  # /, /clients.html and /api/* stay gated. Both levels, for the same reason the pair above
  # exists: a wildcard does not cover the apex.
  BYPASS = {"name": "Public — candidate portal", "decision": "bypass",
            "include": [{"everyone": {}}]}

  targets = [
      (f"{project} — production",        f"{project}.pages.dev",          ALLOW(emails)),
      (f"{project} — previews",          f"*.{project}.pages.dev",        ALLOW(emails)),
      (f"{project} — portal (prod)",     f"{project}.pages.dev/prep",     BYPASS),
      (f"{project} — portal (previews)", f"*.{project}.pages.dev/prep",   BYPASS),
  ]
  ```
  **The loop body changes with it** — `targets` is unpacked at line 81 and builds `"policies"` from
  `emails` inline at lines 99–105. Both must move, or the first run throws `ValueError: too many
  values to unpack`:
  ```python
  for name, domain, policy in targets:      # was: for name, domain in targets
      ...
      payload = { ..., "policies": [policy] }   # was: the inline ALLOW dict built from `emails`
  ```
  Keep the existing dedup (`existing` is keyed on `domain`, which already holds the path form), the
  inline-policy send, and the delete-on-no-policy safety check — a bypass app created without its
  policy enforces *Allow-nothing*, i.e. it would lock candidates out silently. Extend the closing
  verification print with a `/prep/privacy` expects-200 line.
- **PATTERN**: the file's own docstring explains why two apps and not one wildcard; extend that
  comment rather than replacing it.
- **GOTCHA**: **both bypass apps already exist on this account** (created 28 Jul 2026 — ids
  `5bcf50b3…` prod, `eec1c174…` previews). Re-running prints `= … already exists (2 policies)`. Do
  NOT delete and recreate to "test" the script; assert idempotency on the existing pair instead.
- **VALIDATE**:
  ```bash
  python3 -m py_compile scripts/setup-access.py
  CF_API_TOKEN=$(cat ~/.cf-access-token) ./scripts/setup-access.py saulera-dossier-engine linardsberzins@gmail.com
  # expect four "= … already exists" lines, exit 0, nothing created
  ```
- **SATISFIES**: AC #4

### 2. CREATE migrations/0004_otp_attempts.sql + UPDATE test/schema.test.js

- **IMPLEMENT**: the attempt cap needs a counter, and `otp` has none.
  ```sql
  -- The OTP attempt cap (#20). A 6-digit code is 10^6 wide: without a cap, a returning-login
  -- endpoint is a free oracle. The counter lives on the row rather than in a rate limiter
  -- because the row already dies with its invite (0002's cascade) and with its own TTL, so
  -- the cap needs no storage of its own and no cleanup. #20's verify deletes the row on
  -- success and on cap-out; there is no state to leak.
  ALTER TABLE otp ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
  ```
  Then in `test/schema.test.js`, add `"attempts"` to `EXPECTED_COLUMNS.otp`. Nothing else changes —
  the parser already reads `ALTER TABLE <t> ADD COLUMN <c>` as its one sanctioned form (line 122
  names `events.kind` as the precedent).
- **GOTCHA**: SQLite cannot add a CHECK by `ALTER`, so do not try to close `invite.status` here —
  it needs a table rebuild, and #17 left that question open deliberately. `NOT NULL` + a non-NULL
  default is required and satisfied.
- **VALIDATE**: `npm run db:local` applies clean; `node --test test/schema.test.js` green. Then
  temporarily drop `"attempts"` from `EXPECTED_COLUMNS` and confirm it **fails** — the lockfile must
  be proven live — then restore.
- **SATISFIES**: AC #2

### 3. CREATE src/prep/tokens.js

- **IMPLEMENT**: pure, no D1, no env, no `Response`. Header comment: the raw token exists in exactly
  two places — the candidate's email/cookie and this function's return value; everywhere else it is
  a hash.
  - `export const TOKEN_BYTES = 32;` — 256 bits. A guessing attack against `token_hash` is not the
    threat model at this size; the emailed link and the cookie are.
  - `export function mintToken()` → 43-char base64url from `crypto.getRandomValues(new Uint8Array(32))`.
    (VERIFIED on Node v20.20.2: `btoa(String.fromCharCode(...b))` + `+/→-_` + strip `=`.)
  - `export function mintOtpCode()` → six digits, **rejection-sampled** to kill modulo bias: draw a
    `Uint32Array(1)`, redraw while `n >= 4_294_000_000`, then `String(n % 1e6).padStart(6, "0")`.
    Leading zeros are significant — it is a string, never a number.
  - `export async function hashOtpCode(inviteId, code)` → `hashToken(`${inviteId}:${code}`)`,
    importing `hashToken` from `../portal/store.js`. Comment why the invite id is in the preimage:
    six digits is a 10^6 space, so an unsalted digest is a lookup table; binding to the invite id
    means a stolen `code_hash` is useless without the row it came from, and two invites holding the
    same six digits never collide.
  - `export const SESSION_COOKIE = "prep_session";`
  - `export function sessionCookie(token, maxAgeSeconds)` →
    `` `${SESSION_COOKIE}=${token}; Max-Age=${n}; Path=/prep; HttpOnly; Secure; SameSite=Lax` ``.
    Comment each attribute: `Path=/prep` because one hostname serves two audiences and the candidate's
    credential must never ride a recruiter request; `SameSite=Lax` because `Strict` is dropped on the
    top-level navigation *from the email client*, which is the only way this cookie is ever first set;
    `HttpOnly` because no candidate-facing script has any reason to read it.
  - `export function clearCookie()` → the same string with `Max-Age=0` and an empty value.
  - `export function readCookie(request, name = SESSION_COOKIE)` → parse the `Cookie` header, return
    the value or `null`. Split on `;`, trim, then split on the **first** `=` only — this function
    parses every cookie on the request, not just ours (Task 12 calls it on the delete endpoint), and
    any one of them may carry `=` inside its value.
  - `export function maxAgeFrom(expiresAt, now = new Date())` → whole seconds until `expires_at`,
    floored at 0. `expires_at` is a SQLite UTC string (`'YYYY-MM-DD HH:MM:SS'`) — **append `"Z"`
    after replacing the space with `"T"`** before `Date.parse`, or the browser reads it as local
    time and the cookie outlives or undercuts the session by an hour in BST.
- **GOTCHA**: no `node:crypto` import — `crypto` is global in Workers and on Node 20+, and importing
  the Node module would break the Function at the edge.
- **VALIDATE**: `node --check src/prep/tokens.js && node --test test/prep-tokens.test.js` (Task 4)
- **SATISFIES**: AC #1, AC #2

### 4. CREATE test/prep-tokens.test.js

- **IMPLEMENT**: the class of failure this catches — a credential that looks random and is not, and
  a cookie whose attributes quietly loosen.
  - `mintToken()` returns 43 base64url chars, matches `/^[A-Za-z0-9_-]{43}$/`, and 1000 draws are
    1000 distinct values.
  - `mintOtpCode()` matches `/^\d{6}$/` across 1000 draws; at least one draw in 1000 starts with `0`
    (the string-not-number guard — this fails loudly if someone "tidies" it into an integer).
  - `hashOtpCode("inv-1", "000123") !== hashOtpCode("inv-2", "000123")` — the invite binding.
  - `hashOtpCode` equals the known SHA-256 of the literal preimage, so the format cannot drift
    silently (compute the expected value once with `hashToken("inv-1:000123")` and assert equality —
    the point is that the preimage shape is pinned, not the digest constant).
  - `sessionCookie("abc", 60)` contains **all** of `HttpOnly`, `Secure`, `SameSite=Lax`,
    `Path=/prep`, `Max-Age=60`, and does **not** contain `Domain=` (a `Domain` attribute would widen
    the cookie to sibling hosts).
  - `readCookie` finds the value among several cookies, tolerates spaces, returns `null` when absent
    and when the header is missing entirely.
  - `maxAgeFrom` on a SQLite-format string one hour ahead → `3600 ± 2`; on a past string → `0`.
    **Assert this with an explicit UTC `now`**, not the wall clock.
- **VALIDATE**: `node --test test/prep-tokens.test.js`
- **SATISFIES**: AC #1, AC #2

### 5. UPDATE src/portal/store.js — the auth statements

- **IMPLEMENT**: append six functions below the existing three. Keep the module's contract and its
  comment voice. Every one binds its values.
  - `export async function createInvite(db, { id, clientId, email, interviewAt, tokenHash, expiresAt })`
    — one INSERT into `invite`; `sent_at = datetime('now')`, `status = 'sent'`. Validate all six with
    `StoreError("missing_fields", 400, …)`. **#22 is the caller**; it lives here so #20's tests can
    seed real rows and #22 inherits a tested writer.
  - `export async function inviteByTokenHash(db, tokenHash)` — `SELECT id, client_id, email,
    interview_at, opened_at, expires_at, status FROM invite WHERE token_hash = ?`. **Never selects
    `token_hash`** — nothing downstream needs it and a hash in a log is a hash in a log. Returns the
    row or `null`.
    **Do NOT add a `datetime(expires_at)` guard to this SELECT.** It returns expired rows on
    purpose, and the caller decides what that means: `enter.js` needs the expired row to tell
    *expired* (→ `?e=expired`) apart from *forged or reused* (→ `?e=invalid`), because `openInvite`
    collapses both into `changes === 0` and cannot distinguish them. `sessionFromRequest` (Task 6)
    applies its own expiry check for the same reason — one SELECT, two policies, each stated where
    it applies.
  - `export async function openInvite(db, { oldHash, newHash })` — the exchange, as one statement:
    ```sql
    UPDATE invite
       SET token_hash = ?,
           status     = 'opened',
           opened_at  = COALESCE(opened_at, datetime('now'))
     WHERE token_hash = ?
       AND datetime('now') <= datetime(expires_at)
    ```
    Returns `{ rotated: result.meta.changes === 1 }`. The old hash in the `WHERE` is the atomicity
    guard: two simultaneous clicks both match, exactly one updates, the loser sees `changes === 0`.
    Comment the load-bearing idea: **rotation is what makes single-use and `opened_at`-once the same
    fact.** The row the caller read *before* this statement carries the `opened_at` that decides
    whether to record `invite_opened`.
  - `export async function rotateSession(db, { inviteId, newHash })` — `UPDATE invite SET token_hash = ?
    WHERE id = ? AND datetime('now') <= datetime(expires_at)`. Used by OTP verify. **Deliberately
    does not touch `opened_at` or `status`** — a returning login is not a new open, and decision 23's
    sales claim must not inflate every time a candidate signs back in.
  - `export async function inviteByEmail(db, email)` — `SELECT id, client_id, email, expires_at FROM
    invite WHERE lower(email) = lower(?) AND datetime('now') <= datetime(expires_at) ORDER BY sent_at
    DESC LIMIT 1`. Case-insensitive because a candidate retypes their address by hand. `LIMIT 1`
    because a candidate may hold several live invites and the newest is the one they mean.
  - `export async function issueOtp(db, { inviteId, codeHash, ttlMinutes })` — `DELETE FROM otp WHERE
    invite_id = ?` then `INSERT INTO otp (invite_id, code_hash, expires_at) VALUES (?, ?,
    datetime('now', '+' || ? || ' minutes'))`. One live code per invite: requesting a new code
    invalidates the old one, which is both the least surprising behaviour and a free cap on how many
    codes can be outstanding.
  - `export async function consumeOtp(db, { inviteId, codeHash, maxAttempts })` — the whole verify
    decision, so no route can get the order wrong:
    1. `SELECT id, code_hash, attempts, datetime('now') <= datetime(expires_at) AS live FROM otp
       WHERE invite_id = ? ORDER BY id DESC LIMIT 1`
    2. no row, or `live` is 0 → `{ ok: false, reason: "expired" }`
    3. `attempts >= maxAttempts` → `DELETE` the row, `{ ok: false, reason: "too_many_attempts" }`
    4. hash mismatch → `UPDATE otp SET attempts = attempts + 1 WHERE id = ?`,
       `{ ok: false, reason: "invalid_code" }`
    5. match → `DELETE FROM otp WHERE id = ?`, `{ ok: true }` — **single-use is the delete**

    **Pin the arithmetic, it is the thing most likely to get "fixed" into an off-by-one.** The cap
    check at step 3 runs *before* the comparison and only step 4 increments. With `maxAttempts: 5`
    that means five wrong guesses are each answered `invalid_code` (leaving `attempts === 5`), and
    the **sixth** call is refused at step 3 without comparing anything — cap reached, row deleted.
    Five guesses allowed, and the sixth is the one that 429s. `test/prep-auth.test.js` and Level 4
    step 6 both assert exactly that shape.
    Compare the two hex digests with `timingSafeEqual` semantics; a plain `===` on a 64-char hex
    string of a *hash* leaks nothing useful, but write a tiny constant-time `equalHex(a, b)` helper
    anyway and say in the comment that it costs one loop and removes the argument.
- **PATTERN**: existing `purgeExpired` / `deleteInviteByTokenHash` in the same file.
- **GOTCHA**: `datetime('now', '+' || ? || ' minutes')` — the modifier is built by SQLite from a
  *bound* value; do not template the number into the SQL string. Validate `ttlMinutes` is a positive
  integer before binding.
- **VALIDATE**: `node --check src/portal/store.js && node --test test/portal-store.test.js`
- **SATISFIES**: AC #1, AC #2, AC #3

### 6. CREATE src/prep/session.js

- **IMPLEMENT**: the per-route guard. Header comment: this is deliberately **not** middleware —
  `functions/prep/_middleware.js` runs on every `/prep/*` request including `privacy.html` and the
  login page, and enforcing a session there would lock a candidate out of the two pages that exist
  to let them in.
  - `export const PUBLIC_PREP_PATHS` — the explicit allow-list, as documentation and as a thing a
    test can read: `/prep/privacy`, `/prep/login`, `/prep/auth/enter`, `/prep/auth/otp`,
    `/prep/auth/verify`.
  - `export async function sessionFromRequest(db, request)` → read `SESSION_COOKIE`; `null` if
    absent; `hashToken` it; `inviteByTokenHash`; `null` if no row or `expires_at` has passed.
    Returns `{ inviteId, clientId, expiresAt }` — **never the token or the hash**.
  - `export async function requireSession(db, request)` → the above, or `throw new
    StoreError("invalid_token", 401)`. Routes call this and let `errorResponse` map it.
- **GOTCHA**: `errorResponse` maps any `StoreError` by its own `status`, so `invalid_token`/401 needs
  no change to `src/http.js`.
- **VALIDATE**: `node --check src/prep/session.js`; behaviour in Task 11.
- **SATISFIES**: AC #4

### 7. CREATE src/prep/email.js

- **IMPLEMENT**: the Resend transport, by `fetch` — no SDK, the suite stays zero-dependency.
  - `export const MAIL_FROM_DEFAULT = "Interview prep <prep@saulera.com>";` — operator-controlled
    domain (owner decision, 28 Jul 2026). `pages.dev` cannot carry SPF/DKIM, so the sender can never
    be the deployment host. `env.PREP_MAIL_FROM` overrides.
  - `export async function sendEmail(env, { to, subject, text, html })` — `POST
    https://api.resend.com/emails`, `Authorization: Bearer ${env.RESEND_API_KEY}`,
    `Content-Type: application/json`. Missing key → `throw new StoreError("not_configured", 503)`,
    mirroring `/api/generate`'s posture: without the secret nothing is broken, one route answers 503.
    Non-2xx → log `status` **only** (`console.error("resend:", res.status)`) and throw
    `StoreError("mail_failed", 502)`. Never log the body: it echoes the recipient address.
  - `export async function sendOtpEmail(env, { to, code, agencyName })` — subject
    `"Your interview-prep sign-in code"`; body in plain language naming the agency, the six digits,
    and the ten-minute expiry; both `text` and `html` (a text-only send scores worse in spam
    filters). No link in this email — a code email that also carries a link teaches candidates to
    click, which is the phishing lesson we do not want to teach.
- **PATTERN**: `functions/api/generate.js`'s missing-secret posture.
- **GOTCHA**: Resend answers **403 for an unverified sending domain** — the single most likely first
  failure. The 502 must not leak that to the candidate, but the deployment log must carry the status.
- **VALIDATE**: `node --check src/prep/email.js && node --test test/prep-email.test.js` (Task 8)
- **SATISFIES**: AC #2

### 8. CREATE test/prep-email.test.js

- **IMPLEMENT**: stub `globalThis.fetch`, restore it in a `finally` (an escaped stub poisons every
  later test file in the same process).
  - no `RESEND_API_KEY` → `StoreError` code `not_configured`, status 503, **and `fetch` was never
    called** (asserting the call count is what proves the guard is before the request, not after).
  - happy path → URL is exactly `https://api.resend.com/emails`; method POST; `Authorization` header
    is `Bearer <key>`; parsed body carries `from`/`to`/`subject` and **both** `text` and `html`.
  - `sendOtpEmail` body contains the six digits and the agency name, and contains **no `http`
    substring** — the no-link rule, as a test.
  - `403` from Resend → `StoreError` `mail_failed` 502; assert the thrown message does not contain
    the recipient address.
- **VALIDATE**: `node --test test/prep-email.test.js`
- **SATISFIES**: AC #2

### 9. CREATE functions/prep/auth/enter.js

- **IMPLEMENT**: `GET /prep/auth/enter?t=<token>` — the magic link. `onRequestGet` only.
  1. `if (!env.DB) return json({ error: "not_configured" }, 503);`
  2. `const raw = new URL(request.url).searchParams.get("t") ?? ""` — empty → redirect to
     `/prep/login?e=invalid`
  3. `const hash = await hashToken(raw)` (wrap: a non-string throws `missing_fields`)
  4. `const invite = await inviteByTokenHash(env.DB, hash)` — `null` → `/prep/login?e=invalid`
  5. expired → `/prep/login?e=expired`
  6. `const wasUnopened = invite.opened_at === null` — capture **before** the update
  7. `const next = mintToken(); const { rotated } = await openInvite(env.DB, { oldHash: hash, newHash: await hashToken(next) })`
     — `rotated === false` → `/prep/login?e=invalid` (lost the race, or expired between read and write)
  8. `if (wasUnopened) await recordInviteEvent(env.DB, { clientId: invite.client_id, kind: "invite_opened" })`
     — wrapped in try/catch: a telemetry failure must never cost a candidate their session.
  9. `302` to `/prep/` with
     `Set-Cookie: sessionCookie(next, maxAgeFrom(invite.expires_at))`
- **PATTERN**: `functions/prep/api/delete.js` for the env guard and the `errorResponse` catch.
- **GOTCHA**: **no `sameOrigin` check here** — this is a top-level navigation from a mail client,
  which is by definition cross-site, and `sameOrigin()` is documented for mutating methods only.
  A GET that mutates is the deliberate exception this route makes; it is safe because the token
  *is* the authorisation and there is no ambient credential to ride.
- **GOTCHA**: redirect to a **relative** path. An absolute URL built from `request.url` inherits
  whatever `Host` the edge saw.
- **GOTCHA**: `json()` cannot carry `Set-Cookie` — build the `Response` directly here:
  `new Response(null, { status: 302, headers: { Location: "/prep/", "Set-Cookie": …, "Cache-Control": "no-store" } })`.
- **VALIDATE**: Level 4 sweep
- **SATISFIES**: AC #1, AC #3

### 10. CREATE functions/prep/auth/otp.js, verify.js, session.js

- **IMPLEMENT**: three routes, each on the `delete.js` spine.

  **`POST /prep/auth/otp`** — `ALLOWED = new Set(["email"])`. Look up `inviteByEmail`. **Answer
  `202 {ok: true}` whether or not a match exists** — a different answer turns this into an email-
  enumeration oracle against a recruitment agency's candidate list, which is exactly the kind of
  disclosure decision 13 exists to prevent. On a match: `mintOtpCode()`, `issueOtp(…, {ttlMinutes: 10})`,
  `sendOtpEmail`. Wrap the send so a mail failure still answers 202 but logs — the candidate retries
  and the operator sees the status.

  **`POST /prep/auth/verify`** — `ALLOWED = new Set(["email", "code"])`. `inviteByEmail` → no match
  answers the same shape as a wrong code (`401 {error: "invalid_code"}` — same reason as above).
  `consumeOtp(db, { inviteId, codeHash: await hashOtpCode(inviteId, code), maxAttempts: 5 })`. Map:
  `expired` → 410, `too_many_attempts` → 429, `invalid_code` → 401. On `ok`: `mintToken()`,
  `rotateSession`, `200 {ok: true}` **with the `Set-Cookie` header**. Normalise the code with
  `String(code).replace(/\D/g, "")` before hashing — candidates paste `123 456`. Reject anything
  that is not exactly six digits after normalising, **without** counting it as an attempt (a typo of
  the wrong length is not a guess).

  **`GET /prep/auth/session`** — `sessionFromRequest`; `200 {ok: true, expires_at}` or
  `200 {ok: false}`. Deliberately 200 in both cases: the login page asks "am I already in?" and a
  401 in the console on every first visit trains everyone to ignore 401s. Never returns the invite
  id or the client id.
- **GOTCHA**: `sameOrigin` on all three POSTs (`session.js` is a GET — no check, per `src/http.js:41-42`).
- **GOTCHA**: `Set-Cookie` again — `verify.js` must build its own `Response`. Factor the two
  cookie-bearing responses into one small local helper or accept the duplication; do **not** widen
  `json()` in `src/http.js`, which four other routes depend on.
- **VALIDATE**: Level 4 sweep
- **SATISFIES**: AC #2, AC #3

### 11. CREATE test/prep-auth.test.js

- **IMPLEMENT**: **real SQLite, not `fakeD1`.** Mirror `test/portal-purge.test.js` exactly: the
  `node:sqlite` skip guard, the D1-shaped adapter, `PRAGMA foreign_keys = ON`, migrations applied in
  order. Every assertion below branches on `meta.changes` or on real row state, and `fakeD1.run()`
  hard-codes `changes: 1` — under the fake all of them pass while the logic is wrong.

  Seed one client and three invites: **L** live (`interview_at` +7d, `expires_at` +21d), **X**
  expired (`expires_at` −1d), **O** already opened.
  - **forged** — `inviteByTokenHash(db, await hashToken("not-a-real-token"))` → `null`
  - **expired** — `openInvite` against X's hash → `{rotated: false}`, and X's `token_hash` is
    unchanged (an expired invite must not be consumed by the attempt)
  - **valid** — `openInvite` against L → `{rotated: true}`; L's `token_hash` is now the new hash;
    `opened_at` is non-null; `status` is `'opened'`
  - **reused** — `openInvite` with L's *old* hash again → `{rotated: false}`. This is the AC's
    "reused tokens rejected", and it holds structurally rather than by a flag
  - **once-only** — capture `opened_at` after the first exchange, `rotateSession` twice more, assert
    `opened_at` is byte-identical and `status` never leaves `'opened'`
  - **rotateSession does not re-open** — against O: `opened_at` unchanged
  - **OTP happy path** — `issueOtp` then `consumeOtp` with the right hash → `{ok: true}`, and the
    `otp` row count for that invite is **0** (single-use is the delete)
  - **OTP wrong code** — `attempts` increments by exactly 1 per wrong call; the row survives
  - **OTP cap** — 5 wrong calls then a 6th → `too_many_attempts`, row deleted; a subsequent call
    with the *correct* code → `expired` (there is nothing left to verify against)
  - **OTP expiry** — insert a row with `expires_at = datetime('now','-1 minute')` → `expired` even
    with the right hash
  - **OTP reissue** — `issueOtp` twice; exactly one row remains and the **first** code no longer
    verifies
  - **purge still owns the scope** — `purgeExpired` after seeding a −40d invite with an `otp` row
    takes the otp row with it (the cascade must survive the `ALTER`)
- **GOTCHA**: `node --test test/*.test.js` does not glob `test/helpers/`, so the adapter may be
  imported from there or redeclared locally — follow whatever `portal-purge.test.js` did.
- **VALIDATE**: `PATH="$HOME/.nvm/versions/node/v24.11.0/bin:$PATH" node --test test/prep-auth.test.js`
  runs; plain `node --test` on v20.20.2 skips cleanly.
- **SATISFIES**: AC #1, AC #2, AC #3

### 12. UPDATE functions/prep/api/delete.js

- **IMPLEMENT**: teach it the cookie. **Without this, rotation silently breaks #17's endpoint** —
  the raw token in the emailed link dies at first click, and the live credential afterwards lives in
  an HttpOnly cookie that #24's button cannot read from JS.
  Order: cookie first, body token as fallback.
  ```js
  const cookieToken = readCookie(request);
  const bodyToken = String(body.token ?? "").trim();
  const token = cookieToken || bodyToken;
  if (!token) return json({ error: "missing_fields" }, 400);
  ```
  Keep `ALLOWED = new Set(["token"])` and the idempotent `{ok: true}`. On success also send
  `clearCookie()` — a candidate who just erased everything must not keep a session pointing at a
  deleted invite.
- **GOTCHA**: `token` stops being a *required* body field, so an empty `{}` body is now valid when a
  cookie is present. #17's existing test asserting 400 on an empty body must gain a "and no cookie"
  clause rather than being deleted — say so in the PR.
- **VALIDATE**: `node --test test/portal-store.test.js`; Level 4 sweep
- **SATISFIES**: AC #4 (and keeps #17's AC #3 true)

### 13. CREATE public/prep/login.html + login.js + index.html + public/404.html

- **IMPLEMENT**: activate `dossier-design` first; `references/CRAFT.md` before any CSS.

  **`login.html`** — mirror `privacy.html`'s head, topbar and token usage. Two `<form>`s, the second
  hidden until a code has been sent, both keyboard-operable with visible focus and `<label>`s:
  1. email → `POST /prep/auth/otp`
  2. six-digit code → `POST /prep/auth/verify` → on `{ok:true}` `location.href = "/prep/"`
  Plain language throughout — this is a nervous candidate, not an engineer. Copy sketch:
  *"Enter the email address your invite was sent to and we'll send you a 6-digit code."* /
  *"We've sent a code to that address if it matches an invite. It expires in 10 minutes."* (note the
  wording carries the no-enumeration promise honestly). Render `?e=invalid` as *"That link has
  already been used, or it isn't valid any more. Enter your email and we'll send you a code."* and
  `?e=expired` as *"That link has expired. Your prep is available until 14 days after your
  interview."* Use `<input inputmode="numeric" autocomplete="one-time-code" maxlength="6">` so
  phones offer the code from the notification.

  **`index.html`** — the bare signed-in landing. On load, `GET /prep/auth/session`; `{ok:false}` →
  redirect to `/prep/login`. Otherwise one line: *"You're signed in. Your prep brief will appear
  here."* A comment at the top saying #21 replaces this file.

  **`public/404.html`** — **security-relevant, not cosmetic.** With no 404 page, Pages falls back to
  `index.html` at 200 for any unmatched path; now that `/prep/*` is public, that fallback serves the
  **recruiter's tool shell** to anyone who requests `/prep/anything` (VERIFIED live 28 Jul 2026 —
  `/prep/` returned `<title>Submission pack · saulera dossier engine</title>`). A minimal page in
  the repo's tokens, no navigation, no product name beyond the favicon.
- **GOTCHA**: adding `404.html` changes `GET /api/health` from 200 to 404 — Task 14 updates
  `verify-deploy.sh`, whose own comment (lines 78–81) already calls the 200 an artefact of having no
  404 page.
- **VALIDATE**: `curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8788/prep/login` → 200;
  `grep -n "#[0-9a-fA-F]\{3,6\}" public/prep/login.html public/404.html` → no match;
  `dossier-design` `CHECKLIST.md` pass.
- **SATISFIES**: AC #4

### 14. UPDATE .claude/verify-deploy.sh + DEPLOY.md

- **IMPLEMENT**:
  - `verify-deploy.sh`: delete the stale "ACCESS IS DEFERRED (27 Jul 2026)" header block — Access has
    been on since #12 and the script has been silently running its post-Access branch. In that
    branch add three rows: `/prep/privacy` → **200**, `/prep/login` → **200**, and `/clients.html` →
    **302 to cloudflareaccess.com**. That trio is the ticket's fourth AC as an executable test: the
    candidate door open, the recruiter door shut, on one hostname. Change the `/api/health`
    expectation to 404.
  - `DEPLOY.md` §3: append **§3b — the candidate-portal bypass**, with the two app domains, the
    bypass policy shape, the "more specific path wins" rule and its source, and the verification
    curl pair. State plainly that this is what makes decision 12 (not Access, for candidates) and
    decision 18 (both audiences, one deployment) hold together.
  - `DEPLOY.md` §5b: retitle from "Secrets · one, `ANTHROPIC_API_KEY`" to two, and document
    `RESEND_API_KEY` (+ the optional `PREP_MAIL_FROM` var, and that its domain must be verified in
    Resend or every send answers 403).
  - `DEPLOY.md` §6: add the `/prep/*`-is-200 rows to the smoke sweep, beside the existing "a 200 on
    any `/api/*` is a failure" line.
- **VALIDATE**: `bash -n .claude/verify-deploy.sh`; `.claude/verify-deploy.sh saulera-dossier-engine`
  → PASS after deploy.
- **SATISFIES**: AC #4

---

## TESTING STRATEGY

### The `fake-d1` trap — read this before writing a test

`test/helpers/fake-d1.js` `run()` returns `{ success: true, meta: { changes: 1 } }` **unconditionally**.
Four of this ticket's behaviours branch on exactly that value:

| Behaviour | The branch | Under `fakeD1` |
|---|---|---|
| reused token rejected | `openInvite` → `changes === 0` | always 1 → **passes while broken** |
| expired token rejected | same statement, `datetime` guard | always 1 → **passes while broken** |
| `opened_at` set once | `COALESCE` + pre-read | no real row → **unobservable** |
| OTP single-use / cap | `attempts` increments, row deleted | no real row → **unobservable** |

So: `fakeD1` for **SQL-shape** assertions only (which table, which columns, what is bound).
Everything behavioural goes in `test/prep-auth.test.js` against real SQLite, exactly as #17 split
`portal-store.test.js` from `portal-purge.test.js`.

### Unit Tests

`node --test`, zero dependencies. `test/prep-tokens.test.js` (pure), `test/prep-email.test.js`
(`globalThis.fetch` stubbed, restored in `finally`), plus SQL-shape additions to
`test/portal-store.test.js` for the six new statements — assert each binds its values and that
`inviteByTokenHash` never selects `token_hash`.

### Integration Tests

`test/prep-auth.test.js` on real SQLite (skip-guarded on Node 20). Route behaviour is proven by the
Level 4 curl sweep — Functions are deliberately not importable into `node --test` (`src/store.js:5-6`).

### Edge Cases

- Magic link clicked twice (second → `?e=invalid`); two clicks racing (exactly one rotates)
- Link for an invite purged between email and click → `?e=invalid`, no 500
- Link at exactly `expires_at` → rejected (`<=` means still live one second earlier)
- `?t=` absent, empty, non-ASCII, 10 KB long
- OTP requested for an unknown email → still 202, no row written, no mail sent
- OTP requested twice → one row; the first code no longer verifies
- Code entered as `123 456` / `123-456` → normalised and accepted; `12345` → rejected **without**
  burning an attempt
- 6 wrong codes → 429 and the row is gone; the correct code afterwards → 410
- Cookie present but the invite was deleted by delete-now → `requireSession` throws `invalid_token`
- Cookie present but expired → same; the login page's `?e=` is not involved (no redirect loop)
- `RESEND_API_KEY` unset → `/prep/auth/otp` still 202, log carries `not_configured`
- `/prep/privacy` and `/prep/login` reachable with **no** cookie (the public allow-list)
- `/clients.html` and `/api/events` still 302 to Access with a valid prep cookie present

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style

```bash
for f in src/prep/tokens.js src/prep/session.js src/prep/email.js src/portal/store.js \
         functions/prep/auth/enter.js functions/prep/auth/otp.js functions/prep/auth/verify.js \
         functions/prep/auth/session.js functions/prep/api/delete.js; do node --check "$f" || exit 1; done
python3 -m py_compile scripts/setup-access.py
bash -n .claude/verify-deploy.sh
grep -rn "console.log\|TODO\|FIXME" src/prep/ functions/prep/ && echo "clean these" || echo ok
grep -n "#[0-9a-fA-F]\{3,6\}" public/prep/login.html public/prep/index.html public/404.html && echo "raw hex — use tokens" || echo ok
# the raw credential must never reach a log line:
grep -rn "console\.\(log\|error\|warn\)" src/prep/ functions/prep/ | grep -i "token\|code\|cookie" && echo "LEAK" || echo ok
```

### Level 2: Unit Tests

```bash
npm test                                                     # Node 20: all pass, prep-auth skips
PATH="$HOME/.nvm/versions/node/v24.11.0/bin:$PATH" npm test  # Node 24: all pass INCLUDING prep-auth
```

### Level 3: Integration

```bash
npm run db:local
npx wrangler@4.114.0 d1 execute DB -c .wrangler/d1-local.toml --local --persist-to .wrangler/state \
  --command "PRAGMA table_info(otp)"        # expect id, invite_id, code_hash, expires_at, attempts
```

### Level 4: Manual Validation

```bash
npm run dev    # :8788, keep running
# seed a live invite whose raw token is "T0":
H=$(node -e 'crypto.subtle.digest("SHA-256", new TextEncoder().encode("T0")).then(d => process.stdout.write([...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join("")))')
npx wrangler@4.114.0 d1 execute DB -c .wrangler/d1-local.toml --local --persist-to .wrangler/state \
  --command "INSERT INTO clients (id,name) VALUES ('c-auth','Auth Test');
             INSERT INTO invite (id,client_id,token_hash,email,interview_at,sent_at,expires_at)
             VALUES ('i-1','c-auth','$H','cand@example.com', datetime('now','+7 days'),
                     datetime('now'), datetime('now','+21 days'))"

# 1. the exchange: 302 to /prep/, and a cookie with every attribute
curl -s -i "http://localhost:8788/prep/auth/enter?t=T0" | grep -iE "^(HTTP|location|set-cookie)"
#    expect: 302 · Location: /prep/ · Set-Cookie: prep_session=…; Path=/prep; HttpOnly; Secure; SameSite=Lax

# 2. reuse: the same link again is dead
curl -s -o /dev/null -w '%{redirect_url}\n' "http://localhost:8788/prep/auth/enter?t=T0"   # /prep/login?e=invalid

# 3. forged
curl -s -o /dev/null -w '%{redirect_url}\n' "http://localhost:8788/prep/auth/enter?t=nope" # /prep/login?e=invalid

# 4. opened_at stamped exactly once, status opened, token rotated
npx wrangler@4.114.0 d1 execute DB -c .wrangler/d1-local.toml --local --persist-to .wrangler/state \
  --command "SELECT opened_at, status, token_hash = '$H' AS still_old FROM invite WHERE id='i-1'"
#    expect: a timestamp · opened · still_old = 0

# 5. no enumeration — identical answer for a real and a fake address
for E in cand@example.com nobody@example.com; do
  curl -s -o /dev/null -w "$E %{http_code}\n" -X POST http://localhost:8788/prep/auth/otp \
    -H 'content-type: application/json' -d "{\"email\":\"$E\"}"; done      # both 202

# 6. attempt cap
for i in 1 2 3 4 5 6; do curl -s -o /dev/null -w "try$i %{http_code}\n" -X POST \
  http://localhost:8788/prep/auth/verify -H 'content-type: application/json' \
  -d '{"email":"cand@example.com","code":"000000"}'; done                  # 401×5 then 429

# 7. the public allow-list needs no cookie
for P in /prep/privacy /prep/login; do curl -s -o /dev/null -w "$P %{http_code}\n" "http://localhost:8788$P"; done
```

### Level 5: Post-deploy — the fourth AC as one command

```bash
.claude/verify-deploy.sh saulera-dossier-engine <preview-host>
# candidate door open:
curl -s -o /dev/null -w '/prep/privacy  %{http_code}\n' https://saulera-dossier-engine.pages.dev/prep/privacy   # 200
curl -s -o /dev/null -w '/prep/login    %{http_code}\n' https://saulera-dossier-engine.pages.dev/prep/login     # 200
# recruiter door shut:
for P in / /clients.html /api/events; do
  curl -s -o /dev/null -w "$P %{http_code} %{redirect_url}\n" "https://saulera-dossier-engine.pages.dev$P"; done # 302 → cloudflareaccess.com
# the fallback no longer leaks the recruiter shell:
curl -s -o /dev/null -w '/prep/nonsense %{http_code}\n' https://saulera-dossier-engine.pages.dev/prep/nonsense   # 404
# the bypass boundary does not over-reach:
for P in /prepx /prep-secret /preparation; do
  curl -s -o /dev/null -w "$P %{http_code}\n" "https://saulera-dossier-engine.pages.dev$P"; done                 # 302 (gated)
```

---

## ACCEPTANCE CRITERIA

From the ticket, verbatim, plus the plan's own gates:

- [ ] **AC #1** — expired, forged and reused tokens are rejected, **tested**
      (`test/prep-auth.test.js`, real SQLite; reuse holds structurally via rotation)
- [ ] **AC #2** — OTP is single-use, with a short TTL (10 min) and an attempt cap (5)
- [ ] **AC #3** — `opened_at` is set exactly once, and `invite_opened` is recorded exactly once
- [ ] **AC #4** — recruiter routes remain Access-gated and candidate routes never are, proven by
      `.claude/verify-deploy.sh` against the live deployment
- [ ] Sessions expire with the invite (`interview_at + 14d`); the cookie's `Max-Age` derives from
      `expires_at`, computed as UTC
- [ ] Cookie is `HttpOnly; Secure; SameSite=Lax; Path=/prep` with no `Domain`
- [ ] `POST /prep/auth/otp` cannot be used to enumerate candidate email addresses
- [ ] No raw token or code is ever written to a log, a SQL string, or a response body
- [ ] `functions/prep/api/delete.js` still works after rotation (cookie path)
- [ ] `/prep/*` no longer falls back to the recruiter's `index.html`
- [ ] `setup-access.py` reproduces all four applications idempotently for the next agency
- [ ] All validation commands pass on Node 20 and Node 24; no regressions; DEPLOY.md drift fixed

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order; each task's validation run immediately
- [ ] Levels 1–4 pass locally; Level 5 pass against the deployment
- [ ] Full suite green on Node 20 (prep-auth skips) and Node 24 (prep-auth runs)
- [ ] Schema lockfile proven live (drop `attempts` from `EXPECTED_COLUMNS` → fails → restore)
- [ ] `dossier-design` `CHECKLIST.md` run against `login.html`, `index.html`, `404.html`
- [ ] Acceptance criteria all met
- [ ] PR body says `Closes #20`, names the two new Access applications by id, and calls out the
      `delete.js` contract change and the `/api/health` 200→404 change

---

## OPEN QUESTIONS / ASSUMPTIONS

The two questions that would have changed the plan were put to the owner on 28 Jul 2026 and
answered: **create the bypass apps and verify** (done — see NOTES), and **send from `saulera.com`**.
What remains:

1. **`saulera.com` must be a verified sending domain in Resend.** Not checkable from here (no key in
   this environment). If it is not verified, every send answers **403** and the OTP path is dead
   while every test still passes — the transport is stubbed in unit tests by design. **Do one live
   send before calling the ticket done.** If the domain is unverified, that is a DNS task, not a
   code task, and the rest of the ticket ships around it.
2. **Assumption: the magic link is single-use.** The AC says "expired/forged/**reused** tokens
   rejected", and rotation is the mechanism. The cost: a candidate who opens the link on their phone
   and then wants their laptop must use the OTP path. That is not a workaround — it is why decision
   12 pairs the link *with* an email-OTP return, and the two halves only make sense together. If the
   owner would rather the link stay live for 14 days, that is a one-line change (drop the rotation
   from `openInvite`) and a weaker AC — flag it before implementing, not after.
3. **Assumption: `main` will be deployed before Level 5 runs.** The live deployment predates
   PRs #26–28 (verified: `/prep/privacy` currently serves the recruiter shell). Level 5's numbers
   are only meaningful after a deploy.
4. **`invite.status` stays uncontrolled** (#17's Open Question 2). SQLite cannot add a CHECK by
   `ALTER`. #20 writes `'sent'` and `'opened'`; a table rebuild to close the vocabulary is a
   separate, deliberate migration if anyone wants one.
5. **OTP TTL 10 minutes and cap 5** are the plan's choices, not the ticket's — the ticket says
   "short TTL and attempt cap" without numbers. Both are constants at the top of their modules so
   they are one edit and one test away from changing.

## NOTES (open canvas)

### Access spike — VERIFIED LIVE, 28 Jul 2026

Every claim below was executed against the real deployment, not read in a doc.

**Before.** All four probes 302 to `linardsberzins.cloudflareaccess.com`:
`/`, `/api/events`, `/prep/privacy`, `POST /prep/api/delete`. Two Access applications existed —
`saulera-dossier-engine.pages.dev` (`ee572581…`) and `*.saulera-dossier-engine.pages.dev`
(`a1e0a9e2…`), each with one `allow` policy at precedence 1.

**The change.** Two applications created via `POST /accounts/<acct>/access/apps`, policy sent inline:

```json
{ "name": "saulera-dossier-engine — candidate portal (<domain>)",
  "domain": "<domain>", "type": "self_hosted",
  "session_duration": "24h", "app_launcher_visible": false,
  "policies": [{ "name": "Public — candidate portal",
                 "decision": "bypass", "include": [{ "everyone": {} }] }] }
```

with `<domain>` = `saulera-dossier-engine.pages.dev/prep` (id `5bcf50b3…`) and
`*.saulera-dossier-engine.pages.dev/prep` (id `eec1c174…`). Both returned `success: true` with the
policy attached at precedence 1.

**After** (propagation was immediate — no wait needed):

| Path | Result |
|---|---|
| `/prep/privacy` | **200, served directly** |
| `/prep`, `/prep/` | 200 |
| `/` | 302 → Access |
| `/api/events` | 302 → Access |
| `/clients.html` | 302 → Access |
| `/prepx`, `/prep-secret`, `/preparation` | **302 → Access** |

The last row is the one worth keeping: the bypass matches the `/prep` **path segment**, not the
string prefix, so no sibling route leaks. `/Prep/privacy` also bypassed — matching is
case-insensitive. Harmless (nothing sensitive lives at a case-variant path), noted for completeness.

**What the spike also found, which nobody was looking for.** `/prep/privacy` answered 200 while
serving `<title>Submission pack · saulera dossier engine</title>` — the **recruiter's** `index.html`.
Two facts fell out at once: `origin/main` has not been deployed since PRs #26–28 merged, and there
is no `public/404.html`, so Pages falls back to `index.html` at 200 for anything unmatched. Before
this ticket that fallback sat behind Access and cost nothing. Now `/prep/*` is public, so it serves
the recruiter tool's shell to the world. No client data moves — `/api/*` is still gated — but the
shell should not be public, and that is why `public/404.html` is a task in this ticket and not a
tidy-up in the next one.

### Why rotation, and not a session table

Three options were weighed:

| | Long-lived bearer | **Rotation** | Separate session table |
|---|---|---|---|
| Satisfies "reused rejected" | no | **yes** | yes |
| `opened_at` exactly once | needs a second guard | **falls out for free** | needs a second guard |
| Changes architecture §4's model | no | **no** | yes — a new table |
| 14-day credential sitting in an inbox | yes | **no** | no |
| Cost | — | **OTP becomes load-bearing** | a migration + a purge scope |

Rotation wins on every row except the last, and the last is not a cost — decision 12 *already*
bought the OTP path. It also explains the decision: if the link stayed live for 14 days, an
email-OTP return would be redundant. The two halves of decision 12 only cohere if the link is
single-use.

### Prefetch — named, not engineered around

Corporate mail scanners GET links in email. One that follows the magic link consumes it *and*
stamps `opened_at`, which both locks the candidate out of the one-click path **and** inflates
decision 23's sales claim ("invites opened") with a robot's click. `functions/prep/api/delete.js`
already reasons about this — its header says a delete reachable by URL-click gets prefetched.

An interstitial ("press to open your prep") would defeat it, at the cost of the click the repo's
least-friction ethos spent a whole ticket removing. The judgement here: **accept it, name it**. The
recovery path already exists and is one email away, and the metric distortion is bounded and
uniform. If the pilot shows `opened` running suspiciously at 100%, the interstitial is the fix and
it is a small one.

### Why the guard is per-route

`functions/prep/_middleware.js` runs on **every** `/prep/*` request, static assets included — that
is #17's feature (any traffic enforces retention). Putting the session check there would gate
`/prep/privacy` (which UK GDPR requires be readable) and `/prep/login` (which is how you get a
session at all). `PUBLIC_PREP_PATHS` in `src/prep/session.js` is that list written down where a test
can read it, rather than living in whoever-last-touched-the-middleware's head.

### Rejected

- **Cloudflare Access for candidates** — decision 12 already rejected it (50-user cliff). Restated
  because the bypass apps make it look tantalisingly close to free.
- **JWT / stateless signed cookie** — no new secret to manage and no new table, but revocation stops
  working, and delete-now must revoke. The DB round-trip is one indexed lookup on a portal with
  invite-count traffic.
- **A `session` table** — the honest shape if sessions ever need to be per-device. Today one
  credential column does the job and §4 is inherited, not re-decided.
- **Rate-limiting OTP requests by a counter column** — one-live-code-per-invite (`DELETE` then
  `INSERT`) gives the same protection with no new state.
- **Logging the OTP in dev so it can be tested locally** — a code in a log is a code in a log, and
  the habit outlives the ticket. Local verification reads the D1 row's presence, and the code path
  is proven by `test/prep-email.test.js`'s stubbed transport.

### Confidence: 9.5/10

The one assumption that could have sunk the ticket — that path-scoped Access bypass works on a
Pages-managed hostname — is executed fact with app ids, not a doc quotation. The crypto primitives
are verified on this machine's default Node 20. The remaining half-point is the Resend domain
(Open Question 1), which is DNS rather than code, and the login page, which is the one genuinely
creative task left.

## AMENDMENTS

<!-- Append-only after first approval/execution. Newest at the bottom. -->
