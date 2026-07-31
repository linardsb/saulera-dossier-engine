# Feature: OTP reissue cooldown — the counterweight to the Access bypass (#31)

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

> **⚠ THIS PLAN DELIBERATELY DIVERGES FROM THE TICKET'S MECHANISM — read this first.**
> Issue #31 specifies "a Cloudflare rate-limiting rule on `/prep/auth/*` keyed on client IP …
> added to `scripts/setup-access.py`". That rule **cannot be built on this deployment**, and the
> divergence was put to the owner on 31 Jul 2026, who chose the per-invite reissue cooldown
> planned here. The evidence:
>
> - WAF rate-limiting rules live in the `http_ratelimit` phase of a **zone's** ruleset — the API
>   is `/zones/{zone_id}/rulesets/...`. This deployment serves from
>   `saulera-dossier-engine.pages.dev`, a hostname in **Cloudflare's own zone**; the account has
>   no zone to attach a rule to (custom domain is "Deliberately deferred" in `DEPLOY.md`).
> - Account-level rate-limiting rulesets are Enterprise-with-paid-add-on only, and even then
>   deploy only to *your own* Enterprise zones — never pages.dev.
> - Even with a custom domain later, traffic hitting the `pages.dev` hostname **bypasses the
>   zone's WAF entirely**, so the rule would guard the door nobody is forced to use.
> - The Workers rate-limiting binding is not in the Pages Functions supported-bindings list
>   ("Pages Functions only support a subset of all bindings, which are listed on this page").
>
> So the counterweight moves into the one place that sees every request regardless of hostname:
> `issueOtp` itself. The ticket's "no new state" constraint **still holds** — the mint time of a
> live code is derivable as `expires_at − TTL`, so the cooldown needs no new column, no new
> table, and no cleanup.

## Feature Description

`POST /prep/auth/otp` is public (the #20 Access bypass) and every call rotates the invite's
one live code (`issueOtp` opens with `DELETE FROM otp WHERE invite_id = ?`). Anyone who knows a
candidate's email can request codes in a loop, destroying the code the candidate is reading off
their phone faster than they can type it — a denial of the *only* recovery path, since the
magic link is single-use. Each call also sends one unbounded outbound email via Resend.

The fix: a **per-invite reissue cooldown** inside `issueOtp`. While a live code minted less
than `OTP_COOLDOWN_MINUTES` ago exists, a repeat request answers the same `202` but neither
rotates the code nor sends mail. Consequences:

- **Lockout dies.** An attacker can force at most one rotation per cooldown window, so the
  candidate always has a ≥ 1-minute-stable code — plenty to type six digits. And every code
  email goes to the *invite's* address, never the requester's, so the newest email in the
  candidate's inbox is always the live code.
- **Mail spend is bounded** to at most one Resend call per invite per cooldown window, instead
  of one per request.
- **The guess-budget reset narrows.** `attempts` no longer resets on demand — a fresh row (and
  fresh 5-guess budget) is obtainable at most once per cooldown window, and only by also
  alerting the candidate with a new email.

## User Story

As a candidate who has lost my invite link
I want the sign-in code in my inbox to stay valid long enough to type
So that a stranger who knows my email address cannot lock me out of my own interview prep

## Problem Statement

The Access bypass (#20) removed the only authentication in front of `/prep/auth/otp`. The
plan that shipped it declined rate limiting on the stated grounds that one-live-code-per-invite
"gives the same protection with no new state" — a premise `DEPLOY.md` §3b now records as
wrong: it bounds how many codes are *valid at once*, not how many are *issued*, and each issue
resets the 5-guess attempts cap. PR #30 shipped the documentation halves; this is the fix.

## Solution Statement

Teach `issueOtp` a `cooldownMinutes` option: before the DELETE, check for a live row minted
within the cooldown (`datetime('now') < datetime(expires_at, '-' || (ttl − cooldown) || ' minutes')`
— no new column, freshness implies liveness because cooldown < TTL). If one exists, return
`{ ok: true, issued: false }` untouched; the route then skips the email. The endpoint's
observable answer stays the identical `202 { ok: true }` on every branch — the
anti-enumeration design of the route is untouched.

`scripts/setup-access.py` is deliberately **not** changed (nothing edge-side is buildable);
`DEPLOY.md` §3b's "counterweight, not yet applied" paragraph is rewritten to record what was
actually applied and why the edge rule is impossible, so the next reader does not re-attempt it.

## Out of Scope / Non-Goals

- **Not building**: any Cloudflare edge rule, custom domain, service-bound rate-limit Worker,
  or Turnstile. The owner picked the cooldown; the alternatives are recorded in NOTES for the
  day a custom domain exists.
- **Not changing**: the publicly-triggerable retention sweep (`_middleware.js` → `purgeExpired`),
  the issue's second bullet. It has no per-invite handle to hang a cooldown on, `DEPLOY.md`
  already records it as "Accepted, not overlooked" at invite-count scale, and the edge rule
  that would have covered it is the thing that cannot be built. It stays accepted; the §3b
  rewrite keeps saying so.
- **Not changing**: the `202`-for-every-address answer, the 10-minute TTL, the 5-attempt cap,
  `consumeOtp`, or anything in `verify.js` / `enter.js` / `session.js`.
- **Not adding**: per-IP anything. No column, no KV, no new state — the constraint the ticket
  cared about, honoured by derivation instead of by the edge.

## Feature Metadata

**Feature Type**: Enhancement (security hardening)
**Estimated Complexity**: Low
**Primary Systems Affected**: `src/portal/store.js` (`issueOtp`), `functions/prep/auth/otp.js`, `DEPLOY.md` §3b/§6
**Dependencies**: none new (node:sqlite test helper already in repo)

## Related Work

**Implements**: [#31](https://github.com/linardsb/saulera-dossier-engine/issues/31) — PR must say `Closes #31`   ·   **Epic**: none (deferred from the PR #30 review; Mediums 2 and 3)

**Back-references** (plans this builds on or inherits decisions from):

- `.claude/plans/candidate-auth-magic-link-otp.md` — Why: #20 built `issueOtp`, the attempts cap, and the anti-enumeration `202`; this plan amends its rate-limiting call
- `DEPLOY.md` §3b — Why: the live record of what the bypass exposed; this plan changes its last paragraph from "not yet applied" to applied-differently

**Forward-references** (plans that extend or supersede this — append as follow-ups get created):

- (none yet — a custom-domain plan would reopen the edge-rule option, see NOTES)

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `src/portal/store.js` (lines 383–401) — `issueOtp`: the DELETE-then-INSERT this plan gates. Note the bound-modifier idiom (`'+' || ? || ' minutes'`) and the `Number.isInteger` guard that makes it safe — the cooldown validation MUST mirror both.
- `src/portal/store.js` (lines 404–460) — `consumeOtp`: the house style for "one decision, in one place, with the reasoning in the comment". The cooldown check gets the same treatment.
- `functions/prep/auth/otp.js` (whole file, 75 lines) — the route. `OTP_TTL_MINUTES` at line 27 is the pattern for `OTP_COOLDOWN_MINUTES`; lines 49–68 are the branch the `issued` flag gates. The comments at lines 6–14 and 70 are the anti-enumeration contract the change must not break.
- `test/prep-auth.test.js` (lines 1–60 for the harness rationale; 229–333 for the OTP behaviour tests) — the real-SQLite suite where the behaviour tests go. Line 291–301 shows the backdating idiom (`INSERT ... datetime('now','-1 minute')` written directly, "because issueOtp cannot mint one already dead"); lines 305–321 ("the DELETE before the INSERT is not decoration") is the reissue-invalidates test the cooldown tests sit beside.
- `test/portal-store.test.js` (lines 239–263) — the fake-d1 tests for `issueOtp`: recorded-SQL shape and the refuses-bad-TTL loop the cooldown validation test mirrors.
- `test/helpers/sqlite-d1.js` (lines 1–50) — `openMigrated`, `d1Shape`, `skip`, and WHY behaviour tests must run here and not on fake-d1 (it returns `{ changes: 1 }` unconditionally).
- `DEPLOY.md` (lines 258–291) — §3b's "What else went public" bullets and the "counterweight, not yet applied" paragraph this plan rewrites; (line 649) the §6 smoke line "Six wrong codes…" the new smoke line lands beside.
- `scripts/setup-access.py` (lines 1–43, docstring) — read to confirm nothing here changes; the plan's divergence note is the reason why.

### New Files to Create

- (none — this is deliberate; the change is two source files, two test files, one doc)

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [WAF rate limiting rules — availability & scope](https://developers.cloudflare.com/waf/rate-limiting-rules/)
  - Why: the evidence for the divergence note in DEPLOY.md — rules are zone-phase (`http_ratelimit`) only. Do not paraphrase it into "Cloudflare can't rate limit" — the precise claim is *no zone, no rule*.
- [Pages Functions bindings](https://developers.cloudflare.com/pages/functions/bindings/)
  - Why: "Pages Functions only support a subset of all bindings" — the rate-limiting binding is absent; cite if the DEPLOY.md note mentions the Worker alternative.
- SQLite [`datetime()` modifiers](https://sqlite.org/lang_datefunc.html)
  - Why: the freshness predicate uses a negative bound modifier (`'-' || ? || ' minutes'`); same family as the existing bound `'+'` idiom at store.js:396.

### Patterns to Follow

**One decision, one place, reasoning in a comment** (store.js `consumeOtp`, lines 404–414): the cooldown check lives inside `issueOtp` with a comment explaining the derivation (`minted_at = expires_at − TTL`, freshness ⇒ liveness) and what attack it kills, in the file's voice.

**Bound SQL modifiers, guarded by `Number.isInteger`** (store.js:385–398):

```js
if (!Number.isInteger(ttlMinutes) || ttlMinutes <= 0) {
  throw new StoreError("missing_fields", 400, "ttlMinutes: must be a positive integer");
}
```

**Route constants exported beside their reasoning** (otp.js:24–27): `OTP_COOLDOWN_MINUTES` goes directly under `OTP_TTL_MINUTES` with the same style of two-line why-this-number comment.

**Identical answers on every branch** (otp.js:70–71): "The identical answer, on both branches, deliberately. Do not add a hint." The cooldown adds a third branch; it answers the same `202 { ok: true }`.

**Two test files, two jobs**: recorded-SQL/validation on fake-d1 in `portal-store.test.js`; anything branching on real rows in `prep-auth.test.js` under `{ skip }` — the split both files open by explaining.

---

## IMPLEMENTATION PLAN

### Phase 1: Core Implementation

**Tasks:**

- Add the cooldown gate to `issueOtp` (store layer, where per-invite OTP semantics already live)
- Thread the `issued` flag through the route and gate the email on it

### Phase 2: Testing

**Depends on:** Phase 1

**Tasks:**

- Validation tests on fake-d1; behaviour tests on real SQLite (rotation blocked, rotation resumes, attempts preserved, default-0 compatibility)

### Phase 3: Documentation

**Independent of:** Phase 2 (can be written alongside)

**Tasks:**

- Rewrite DEPLOY.md §3b's counterweight paragraph; add the §6 smoke line
- Comment on issue #31 recording the mechanism change and why

---

## STEP-BY-STEP TASKS

### UPDATE `src/portal/store.js` — teach `issueOtp` the cooldown

- **IMPLEMENT**: Extend the signature to `issueOtp(db, { inviteId, codeHash, ttlMinutes, cooldownMinutes } = {})`. Validate: `cooldownMinutes` is optional; when present it must be an integer with `0 <= cooldownMinutes < ttlMinutes`, else `throw new StoreError("missing_fields", 400, "cooldownMinutes: must be an integer >= 0 and < ttlMinutes")`. Default to `0` (today's behaviour, exactly). When `cooldownMinutes > 0`, BEFORE the existing DELETE run:
  ```js
  const fresh = await db
    .prepare(
      `SELECT 1 AS fresh FROM otp
        WHERE invite_id = ?
          AND datetime('now') < datetime(expires_at, '-' || ? || ' minutes')`,
    )
    .bind(inviteId, ttlMinutes - cooldownMinutes)
    .first();
  if (fresh) return { ok: true, issued: false };
  ```
  and change both terminal returns to `{ ok: true, issued: true }`. Add a comment in the file's voice: the mint time is `expires_at − TTL`, so "minted within the cooldown" is `now < expires_at − (TTL − cooldown)`; freshness implies liveness because cooldown < TTL; the row this leaves standing is the code the candidate is currently typing, which is the point.
- **PATTERN**: guard idiom store.js:385–387; bound modifier store.js:389–398; check-then-act shape `consumeOtp` store.js:415+. Match `.first()` usage to how the file reads single rows elsewhere (check `inviteByEmail` in the same file and mirror it).
- **IMPORTS**: none new — `StoreError` is already in scope in this file.
- **GOTCHA**: bind `ttlMinutes - cooldownMinutes` as ONE precomputed integer — do not do arithmetic in SQL with two placeholders. Do not add a liveness (`expires_at` vs now) clause to the freshness query; it is implied and an extra clause invites the off-by-one the file warns about. Do not touch the DELETE — it still runs on every *actual* issue, unconditionally.
- **VALIDATE**: `export PATH="$HOME/.nvm/versions/node/v24.11.0/bin:$PATH" && npm test 2>&1 | tail -5` — existing suite still green (default `0` keeps every current caller's behaviour; the changed return shape is additive).
- **SATISFIES**: AC #1, AC #3, AC #5

### UPDATE `functions/prep/auth/otp.js` — the constant, and the email gate

- **IMPLEMENT**: Under `OTP_TTL_MINUTES` (line 27), add:
  ```js
  // One minute: an attacker can rotate the candidate's code at most once per minute, so the
  // code in the newest email always survives long enough to type — and every email goes to
  // the invite's address, never the requester's. A candidate whose first email went astray
  // waits out the same minute for a fresh one. It is one constant and one test away from changing.
  export const OTP_COOLDOWN_MINUTES = 1;
  ```
  Pass `cooldownMinutes: OTP_COOLDOWN_MINUTES` in the `issueOtp` call, capture its return, and wrap the entire try/catch mail block (lines 56–67, agency lookup included) in `if (issued)`. The final `return json({ ok: true }, 202)` stays outside and unconditional — extend the line-70 comment: the identical answer now covers three branches (no invite / issued / cooling down), deliberately.
- **PATTERN**: constant + comment style otp.js:24–27; the existing call shape otp.js:51–55.
- **IMPORTS**: none new.
- **GOTCHA**: the code and hash are minted before `issueOtp` runs (lines 50–51); that stays — a wasted `mintOtpCode()` on the cooldown branch is cheaper than restructuring, and moving the mint after the store call would change nothing observable. Do NOT move the agency lookup outside the `if (issued)` — it exists only to address the email.
- **VALIDATE**: `export PATH="$HOME/.nvm/versions/node/v24.11.0/bin:$PATH" && npm test 2>&1 | tail -5`
- **SATISFIES**: AC #2, AC #4

### UPDATE `test/portal-store.test.js` — validation on fake-d1

- **IMPLEMENT**: Beside the "refuses a TTL" loop (line 256), add `test("issueOtp refuses a cooldown that is negative, fractional, or >= the TTL", ...)`: for each of `-1`, `1.5`, `10`, `11` (with `ttlMinutes: 10`), assert `codeOf(...)` is `missing_fields`, mirroring lines 256–263 exactly. In the existing line-239 test ("clears the old code…"), update the return-shape assertion if it uses `deepEqual` — the result now carries `issued: true`.
- **PATTERN**: test/portal-store.test.js:256–263 verbatim shape (`codeOf`, the `bad` loop).
- **GOTCHA**: `cooldownMinutes: 0` and omitting it entirely must both be accepted — include one positive call proving each. No freshness-behaviour tests here: fake-d1 has no rows, so a behaviour test would pass while wrong (the file's own opening comment says why).
- **VALIDATE**: `export PATH="$HOME/.nvm/versions/node/v24.11.0/bin:$PATH" && node --test test/portal-store.test.js 2>&1 | tail -3`
- **SATISFIES**: AC #5

### UPDATE `test/prep-auth.test.js` — behaviour on real SQLite

- **IMPLEMENT**: Four tests beside the reissue-invalidates test (line 305), all `{ skip }`, all through `d1Shape`/`seed`:
  1. **Cooling down blocks rotation**: `issueOtp` with `cooldownMinutes: 1`, capture the row's `code_hash`; call again with a different hash → returns `{ ok: true, issued: false }`, and `otpRows(db, "inv-L")` still has exactly one row with the ORIGINAL hash. The first code still verifies: `consumeOtp` with it succeeds.
  2. **A stale code rotates**: issue, then backdate the mint past the cooldown with `db.prepare("UPDATE otp SET expires_at = datetime('now', '+8 minutes') WHERE invite_id = 'inv-L'").run()` (TTL 10, so minted 2 minutes ago > 1-minute cooldown — the direct-write idiom of line 293, because issueOtp cannot mint a stale one); reissue → `issued: true`, row carries the NEW hash.
  3. **Cooling down preserves the guess budget**: issue with cooldown, burn 2 wrong guesses (attempts = 2, per the line-248 pattern), reissue within cooldown → `issued: false` and `attempts` still 2 — "requesting a new code no longer resets the counter", the sentence #31 exists to make true.
  4. **Cooldown 0 keeps the lockout semantics** (compatibility): two `issueOtp` calls with `cooldownMinutes: 0` → second returns `issued: true` and the first code no longer verifies — i.e. the line-305 test's world, opted into explicitly.
- **PATTERN**: prep-auth.test.js:305–321 (reissue), :291–301 (direct-write backdating), :246–260 (attempts counting), `otpRows` helper line 42.
- **GOTCHA**: backdate by shrinking `expires_at`, never by sleeping. Keep every new test under `{ skip }` or Node 20 CI breaks. Hash inputs must use the real `hashOtpCode(inviteId, code)` — the hash is invite-scoped (see the line-329 cross-invite test).
- **VALIDATE**: `export PATH="$HOME/.nvm/versions/node/v24.11.0/bin:$PATH" && node --test test/prep-auth.test.js 2>&1 | tail -3`
- **SATISFIES**: AC #1, AC #3, AC #5

### UPDATE `DEPLOY.md` — §3b tells the truth again, §6 gets its smoke line

- **IMPLEMENT**: (a) Rewrite the "**The counterweight, not yet applied:**" paragraph (lines 284–287): the edge rule was investigated and is unbuildable — rate-limiting rules are zone-scoped (`http_ratelimit` phase), this account has no zone, account-level rulesets are Enterprise-and-own-zones-only, and even with a custom domain the `pages.dev` hostname bypasses zone WAF; so the applied counterweight (31 Jul 2026, #31) is a 1-minute per-invite reissue cooldown inside `issueOtp` — no new column (mint time is `expires_at − TTL`), no cleanup, and `setup-access.py` unchanged because there is nothing edge-side to create. Keep the file's voice; keep the warning that the *purge* bullet remains accepted-not-mitigated. (b) Update the OTP bullet (lines 270–282): the loop attack now buys at most one rotation per minute and one email per minute, both to the candidate's own address. Do not delete the wrong-premise paragraph — it is the record of why; append what changed instead. (c) In §6 after the "Six wrong codes" line (649), add: `- [ ] Two code requests within a minute: both answer 202, one email arrives — the second request neither rotates the code nor sends`.
- **PATTERN**: §3b's own append-don't-erase style (see how lines 271–282 preserve the wrong premise as a warning); §5b's "Superseded … by the owner" framing for recording a reversed decision.
- **GOTCHA**: DEPLOY.md is the operator's document — write for the person deciding whether to re-attempt the edge rule, and make "do not re-attempt without a custom domain, and even then the pages.dev hostname bypasses it" impossible to miss.
- **VALIDATE**: `grep -c "cooldown" /Users/Berzins/Desktop/saulera-dossier-engine/DEPLOY.md` returns ≥ 2, and `grep -n "not yet applied" DEPLOY.md` returns nothing.
- **SATISFIES**: AC #6

### ADD a comment to issue #31 recording the divergence

- **IMPLEMENT**: `gh issue comment 31 --body "..."` — three short paragraphs: (1) the edge rule is unbuildable on pages.dev (zone-scoped rules, no zone in the account, Enterprise-only account rulesets, pages.dev bypasses zone WAF even with a custom domain later); (2) owner chose the per-invite reissue cooldown on 31 Jul 2026 — what it does and that "no new state" survives via `expires_at − TTL`; (3) what it deliberately does not cover (the purge-trigger bullet stays accepted; per-IP limiting waits for a custom domain).
- **GOTCHA**: comment, do not close — the PR's `Closes #31` does that on merge.
- **VALIDATE**: `gh issue view 31 --json comments --jq '.comments | length'` returns ≥ 1
- **SATISFIES**: traceability for AC #6

---

## TESTING STRATEGY

### Unit Tests

Validation (bad `cooldownMinutes`) on fake-d1 in `portal-store.test.js`, matching the recorded-SQL file's existing `issueOtp` block. Node's built-in runner (`node --test`), `assert/strict`, no new dependencies.

### Integration Tests

The four behaviour tests in `prep-auth.test.js` run the real migrations on `node:sqlite` through `d1Shape` — the same harness that proves the attempts cap and single-use today. They ARE the integration layer for this repo (no live-server test exists for auth, deliberately: the mail transport is stubbed by design, per DEPLOY.md §5b).

### Edge Cases

- Reissue at exactly the cooldown boundary: predicate is strict `<`, so a code minted exactly `cooldownMinutes` ago rotates — covered implicitly by test 2's 2-minute backdating; do not write a flaky exact-boundary test.
- Expired-but-recent row impossible: cooldown < TTL is enforced by validation, so freshness ⇒ liveness — the validation tests are the guard.
- `cooldownMinutes` omitted (all pre-existing callers): behaviour byte-identical to today — the untouched existing suite is the proof.
- Cross-invite isolation: the freshness query is keyed `invite_id = ?`; the existing cross-invite hash test (prep-auth.test.js:325) plus test 1 keep it honest.

---

## VALIDATION COMMANDS

Execute every command to ensure zero regressions and 100% feature correctness.

Node ≥ 22.5 is required for the behaviour tests (`node:sqlite`): `export PATH="$HOME/.nvm/versions/node/v24.11.0/bin:$PATH"` first, or they silently skip and prove nothing.

### Level 1: Syntax & Style

No linter is configured in this repo (no eslint/prettier config — do not add one). Syntax gate:

```bash
node --check src/portal/store.js && node --check functions/prep/auth/otp.js
```

### Level 2: Unit Tests

```bash
node --test test/portal-store.test.js
```

### Level 3: Integration Tests

```bash
node --test test/prep-auth.test.js     # must show 0 skipped under Node 24
npm test                               # the whole suite, zero regressions
```

### Level 4: Manual Validation

```bash
npm run dev   # scripts/dev.py — local wrangler with migrated local D1
# seed an invite via the recruiter flow or directly, then:
curl -s -X POST localhost:8788/prep/auth/otp -H 'Content-Type: application/json' \
  -H 'Origin: http://localhost:8788' -d '{"email":"<invite email>"}'   # 202
# repeat immediately — still 202, but the deployment log shows no second send attempt
# (locally there is no RESEND_API_KEY, so the signal is issueOtp's branch, visible in the log line ordering)
```

On the live deployment after deploy: the §6 smoke line — two requests inside a minute, both `202`, exactly one email.

### Level 5: Additional Validation (Optional)

`bash .claude/verify-deploy.sh saulera-dossier-engine` after deploy — the two-door contract is untouched by this change and must still hold.

---

## ACCEPTANCE CRITERIA

- [ ] **AC #1** — While a live code is < 1 minute old, `issueOtp` with the cooldown neither deletes nor replaces it, and returns `{ ok: true, issued: false }` (the lockout attack buys nothing).
- [ ] **AC #2** — The route sends no email on the cooling-down branch, and the HTTP answer is the identical `202 { ok: true }` on all three branches — no new enumeration signal.
- [ ] **AC #3** — A repeat request within the cooldown does not reset `attempts` — the 5-guess budget is per-invite-per-window, not per-request.
- [ ] **AC #4** — A candidate legitimately re-requesting waits at most 1 minute for a fresh code (#31's threshold requirement: two or three honest requests are never *refused*, they are answered and at worst coalesced).
- [ ] **AC #5** — `cooldownMinutes` omitted or `0` reproduces today's behaviour exactly; invalid values are refused with `missing_fields`; full suite green with zero regressions.
- [ ] **AC #6** — DEPLOY.md §3b no longer says "not yet applied"; it records what was applied, why the edge rule is unbuildable, and that the purge bullet remains accepted; §6 carries the smoke line; issue #31 carries the divergence comment.

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] `npm test` fully green under Node 24 (0 skips in the two touched files)
- [ ] `node --check` clean on both changed source files
- [ ] Manual two-requests-one-email check done (locally at minimum)
- [ ] All six ACs met
- [ ] PR body says `Closes #31` and names the mechanism divergence up front

## OPEN QUESTIONS / ASSUMPTIONS

- **Cooldown length = 1 minute** (assumption, tuned for the stated threat). The attack was "faster than a person can type six digits"; one stable minute defeats it, and one minute is the worst honest-candidate wait. #31 asked for the threshold to be decided "against real pilot traffic" — there is no pilot traffic yet, so 1 minute ships as the constant (`OTP_COOLDOWN_MINUTES`, one test away from changing) and the pilot can tune it. If the owner wants a longer mail-spend bound (e.g. 2–5 min), it is a one-line change; nothing in this plan assumes 1 specifically except the DEPLOY.md smoke wording.
- **The mechanism divergence itself**: resolved — put to the owner 31 Jul 2026, cooldown chosen over service-bound Worker, both, and custom-domain-plus-rule.
- **Assumption**: no other caller of `issueOtp` exists beyond the route and tests (verified by grep at planning time; re-verify with `grep -rn "issueOtp" src functions` before implementing).

## NOTES (open canvas)

**Alternatives weighed and parked** (for the future custom-domain day):

| Option | Why not now |
|---|---|
| Custom domain + zone WAF rule | Domain deliberately deferred (branding decision, per DEPLOY.md); pages.dev hostname bypasses zone WAF anyway, so it protects only after every link in every sent email points at the domain |
| Service-bound Worker w/ rate-limit binding | Real per-IP limiting, but a second deploy target + per-env bindings for a threat the cooldown already kills; revisit if `/prep/auth/verify` guessing ever becomes the concern (it has the attempts cap) |
| D1-based IP counter | Exactly the "new state + cleanup" the ticket ruled out |
| Turnstile on the login form | Abuse brake, not a limiter; UX cost on the candidate's recovery path |

**Why the cooldown lives in the store, not the route**: `consumeOtp` set the precedent — "the whole verify decision, in one place so no route can get the order wrong". The issue half now gets the same property; a future second caller (if one ever exists) inherits the protection instead of reimplementing it.

**The timing side-channel, considered**: the cooling-down branch skips the Resend fetch, so it answers faster than the issuing branch. This distinguishes "invite exists and recently requested" from other states — but the *existing* code already answers faster for unknown addresses (no mail call), and DEPLOY.md's enumeration contract is about the response body/status, which stays uniform. No regression; noted so a reviewer doesn't rediscover it as new.

**What the fix does NOT bound**: total guesses over a long horizon (5 per minute ≈ 7,200/day against a 10⁶ space ≈ coin-flip in ~70 days of sustained, candidate-visible spam). #31 itself says brute force is not the worry (Resend exhausts first, and every rotation emails the candidate); recorded here so nobody mistakes the cooldown for a brute-force answer.

## AMENDMENTS

<!-- Append-only after first approval/execution. Newest at the bottom. -->
