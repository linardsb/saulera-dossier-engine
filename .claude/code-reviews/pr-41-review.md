# PR #41 Review — fix: OTP reissue cooldown (#31)

**Verdict: APPROVE** — no Critical or High issues; validation green; the change matches the PR's stated intent and the owner-approved plan's mechanism divergence.

## Validation

| Check | Result |
|---|---|
| `npm test` (Node 24.11.0) | 717 pass · 0 fail · **0 skipped** — the real-SQL integrity tests executed (per #33's caveat) |
| `node --check` on both changed source files | clean |
| `grep "not yet applied" DEPLOY.md` | gone — §3b records the applied counterweight |

## Issues

### Critical / High

None found.

### Medium

1. **test-coverage — the route's `issued` gate and the three-branch 202 contract are pinned nowhere** (`functions/prep/auth/otp.js:63,81`). No test invokes `onRequestPost`; all new tests pin `issueOtp` at the store layer. A later edit could drop `cooldownMinutes` from the call (re-opening the lockout) or move the `202` inside `if (issued)` (breaking anti-enumeration) and the suite stays green. The route was untested before this PR too — but before it had one branch, not three.

### Low

2. **correctness — the freshness predicate assumes the standing row was minted with the caller's current TTL** (`src/portal/store.js:406-408`). If `OTP_TTL_MINUTES` changes between deploys, rows spanning the deploy get a skewed cooldown window for up to one TTL (never a security break — a fresh-but-dead row is structurally impossible). The comment states the derivation without recording this assumption, while the constant's own comment invites the change that violates it.
3. **concurrency — the cooldown is a read-then-act, unlike every other guard in the file** (`src/portal/store.js:402-411`). Parallel requests at a window boundary can each see no fresh row and all rotate/send — a burst per window instead of exactly one. Goals survive in practice; but the file's house style is to say when a race was weighed and accepted, and this one doesn't.

## Strengths

- The predicate's arithmetic is right and fail-safe under drift: the freshness bound is strictly earlier than `expires_at`, so freshness ⇒ liveness holds structurally; the modifier is bound, never templated, matching the existing idiom; `datetime('now')` is UTC in both node:sqlite and D1.
- Validation ordering is destructive-op-safe and pinned: a bad cooldown throws before any statement runs, and the test asserts `db.calls.length === 0` — a bad value cannot delete the code the candidate holds.
- Behaviour tests manipulate time by shrinking `expires_at`, never by sleeping — deterministic, a full minute of margin at the boundary, and consistent with the file's backdating idiom; the four tests cover every store-provable acceptance criterion including default-0 compatibility.

## Recommendation

Approve. Fix the Medium (a route-level test pinning the email gate + the uniform 202) and the two Lows (two comments recording the accepted assumptions) before merge — all three are small and none changes the mechanism.
