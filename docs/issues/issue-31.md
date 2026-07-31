# Root Cause Analysis: GitHub Issue #31

## Issue Summary

- **GitHub Issue ID**: #31
- **Issue URL**: https://github.com/linardsb/saulera-dossier-engine/issues/31
- **Title**: Rate-limit /prep/auth/* at the edge — the counterweight to the Access bypass
- **Reporter**: linardsb
- **Status**: OPEN, no linked PR, no prior comments

## Assessment

| Metric | Value | Reasoning |
|--------|-------|-----------|
| Severity | High | Live exposure: `/prep/*` is public (the #20 Access bypass apps), so anyone with a candidate's email can deny the only recovery path and drive unbounded Resend spend; no workaround short of re-gating the portal |
| Complexity | Low | Two source files (`src/portal/store.js`, `functions/prep/auth/otp.js`), two test files, one doc; single caller of `issueOtp`; no new state, no migration |
| Confidence | High | Every claim verified against current code at exact lines; an owner-approved implementation plan exists (`.claude/plans/otp-reissue-cooldown.md`, 31 Jul 2026) and its file references drift-checked clean today |

## Problem Description

Making `/prep/*` public (issue #20's Access bypass) left `POST /prep/auth/otp` unauthenticated and unthrottled.

**Expected Behavior:** An attacker who knows a candidate's email cannot deny the candidate the OTP recovery path, and cannot drive unbounded outbound email.

**Actual Behavior:** Every request to `/prep/auth/otp` rotates the invite's one live code and sends one email. A loop of requests destroys the code the candidate is reading off their phone faster than they can type it — and the magic link is single-use, so the OTP is the **only** way back in.

**Symptoms:**
- Lockout of the recovery path: repeated rotation invalidates each code before it can be typed
- Unbounded Resend calls to the candidate's address (spend + deliverability reputation)
- The 5-guess `attempts` cap resets on every re-issue (fresh row defaults `attempts = 0`), so the cap is per-code, not per-invite

## Reproduction

**Steps to Reproduce:**
1. Know a candidate's invite email address
2. `POST /prep/auth/otp {"email": "<address>"}` in a loop (public, same-origin only)
3. Each call runs `DELETE FROM otp WHERE invite_id = ?` then inserts a fresh code and sends a fresh email — the candidate's current code dies mid-typing every time

**Reproduction Verified:** Yes, by code inspection — `issueOtp` unconditionally opens with the DELETE (`src/portal/store.js:388`), and the route calls it plus `sendOtpEmail` on every request for a known address (`functions/prep/auth/otp.js:49–67`). The behaviour is also pinned by the existing test "requesting a second code kills the first" (`test/prep-auth.test.js:304`).

## Root Cause

### Affected Components

- **Files**: `src/portal/store.js` (issueOtp, lines 375–401), `functions/prep/auth/otp.js` (route, whole file), `DEPLOY.md` §3b (lines 258–291, the wrong-premise record)
- **Functions**: `issueOtp` (the unconditional DELETE-then-INSERT), `onRequestPost` (unconditional send)
- **Dependencies**: none external; Resend is the amplified cost

### Analysis

**Evidence Chain (5 Whys):**
```
WHY can a stranger lock a candidate out?
  → because every POST /prep/auth/otp rotates the live code
    (evidence: store.js:388 — `DELETE FROM otp WHERE invite_id = ?` runs unconditionally)
WHY does every request reach that DELETE?
  → because the route has no throttle and no auth — it mints and issues on every known-address hit
    (evidence: otp.js:49–55 — `if (invite) { … issueOtp(…) }`, nothing between)
WHY is there no throttle?
  → because the #20 plan declined rate limiting: "one-live-code-per-invite gives the same
    protection with no new state" — which bounds codes valid at once, not codes issued
    (evidence: DEPLOY.md:278–282 — recorded as "That premise is wrong")
WHY not fix it at the edge as the issue proposes?
  → because WAF rate-limiting rules are zone-scoped (`http_ratelimit` phase) and this
    deployment serves from pages.dev — the account has no zone; account-level rulesets are
    Enterprise-own-zones-only; the Workers rate-limiting binding is not in the Pages
    Functions supported-bindings list; and even with a future custom domain, pages.dev
    traffic bypasses zone WAF entirely
    (evidence: .claude/plans/otp-reissue-cooldown.md divergence note, put to the owner 31 Jul 2026)
ROOT CAUSE: issueOtp has no notion of "a fresh code already exists" — the fixable thing is a
  per-invite reissue cooldown inside issueOtp, derived from existing state
  (mint time = expires_at − TTL, so no new column, honouring the ticket's no-new-state constraint)
```

**Why This Occurs:** The rate-limit design was the DELETE itself (one live code per invite), which caps concurrency of valid codes but not the issue rate — the actual attack surface once the endpoint went public.

**Code Location:**
```
src/portal/store.js:383-401
  await db.prepare("DELETE FROM otp WHERE invite_id = ?").bind(inviteId).run();  // unconditional
functions/prep/auth/otp.js:49-67
  if (invite) { … issueOtp(…); … sendOtpEmail(…) }                              // every request
```

### Related Issues

- Deferred from PR #30's review (Mediums 2 and 3); the documentation halves landed in PR #30 (`DEPLOY.md` §3b)
- #20 built the endpoint and the Access bypass; `migrations/0004_otp_attempts.sql` added the (narrower-than-intended) attempts cap

## Impact Assessment

**Scope:** Every invited candidate on the live deployment; `/prep/*` is world-readable now (bypass apps live since 28 Jul 2026).

**Affected Features:** Candidate returning login (OTP recovery path); Resend account spend/reputation.

**Severity Justification:** High, not Critical — no data disclosure or corruption (the 202-for-every-address anti-enumeration contract holds); the harm is denial of the recovery path plus bounded-only-by-Resend mail spend, ahead of a pilot with real candidates.

**Data/Security Concerns:** No enumeration or data exposure. The issue's second bullet (publicly triggerable `purgeExpired` sweep) is documented in DEPLOY.md as "Accepted, not overlooked" and stays out of scope — it has no per-invite handle and the edge rule that would have covered it is the thing that cannot be built.

## Proposed Fix

### Fix Strategy

Per the owner-approved plan (`.claude/plans/otp-reissue-cooldown.md`): a **per-invite reissue cooldown inside `issueOtp`**. While a live code minted less than `OTP_COOLDOWN_MINUTES` (= 1) ago exists, a repeat request answers the same `202 { ok: true }` but neither rotates the code nor sends mail (`{ ok: true, issued: false }`). Mint time is derivable (`expires_at − TTL`), so: no new column, no new table, no cleanup, no new services — the limiter lives in the existing Pages Functions seam.

This kills the lockout (the candidate always has a ≥1-minute-stable code), bounds mail to one send per invite per minute, and stops `attempts` resetting on demand.

### Files to Modify

1. **src/portal/store.js** — `issueOtp` gains optional `cooldownMinutes` (integer, `0 ≤ v < ttlMinutes`, default 0 = today's behaviour); freshness check before the DELETE; returns `{ ok, issued }`.
2. **functions/prep/auth/otp.js** — `OTP_COOLDOWN_MINUTES = 1` beside `OTP_TTL_MINUTES`; the mail block gated on `issued`; the 202 stays unconditional on all three branches.
3. **test/portal-store.test.js** — validation loop for bad cooldowns (fake-d1); return-shape update.
4. **test/prep-auth.test.js** — four real-SQLite behaviour tests (rotation blocked / stale rotates / attempts preserved / cooldown-0 compatibility), all `{ skip }`-guarded.
5. **DEPLOY.md** — §3b's "not yet applied" paragraph rewritten to record what was applied and why the edge rule is unbuildable; §6 smoke line added.

### Alternative Approaches

Edge WAF rule (unbuildable: no zone), service-bound Worker with rate-limit binding (second deploy target for a threat the cooldown kills), D1 IP counter (exactly the new-state-plus-cleanup the ticket ruled out), Turnstile (abuse brake, not a limiter). All parked in the plan's NOTES for the custom-domain day.

### Risks and Considerations

- The cooling-down branch skips the Resend fetch, so it answers faster — but the existing code already answers faster for unknown addresses; the enumeration contract (body/status) stays uniform.
- Total long-horizon guess budget is not bounded (~5/min); #31 itself says brute force is not the worry (Resend exhausts first, every rotation emails the candidate).
- `issued: false` coalesces an honest candidate's immediate re-request for up to 1 minute — accepted, the newest email in their inbox is always the live code.

### Testing Requirements

**Test Cases Needed:**
1. Cooldown blocks rotation: second issue within the window returns `issued: false`, original hash stands and still verifies
2. Stale code rotates: backdated past the cooldown, reissue returns `issued: true` with the new hash
3. Cooldown preserves the guess budget: `attempts` unchanged by a coalesced reissue
4. Cooldown 0 / omitted reproduces today's behaviour exactly; invalid values refused `missing_fields`

**Validation Commands:**
```bash
export PATH="$HOME/.nvm/versions/node/v24.11.0/bin:$PATH"   # node:sqlite needs ≥ 22.5
node --check src/portal/store.js && node --check functions/prep/auth/otp.js
node --test test/portal-store.test.js
node --test test/prep-auth.test.js    # must show 0 skipped under Node 24
npm test
```

## Implementation Plan

Execute `.claude/plans/otp-reissue-cooldown.md` verbatim — it is the full task-by-task plan, drift-checked against the codebase on 31 Jul 2026 (all line references current). Branch from `origin/main`; PR says `Closes #31` and names the mechanism divergence up front.

## Next Steps

1. Review this RCA document
2. Run `piv-implement-issue` for #31
3. `piv-create-pr`, then `piv-review-pr`
