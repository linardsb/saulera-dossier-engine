# Code review — PR #30 · candidate auth: magic link + email-OTP return (#20)

**Branch** `feature/candidate-auth-magic-link` → `main` · 24 files, +3765 / −39
**Reviewed at** `c8fbe5a` · **Recommendation: APPROVE**, with three Mediums to log and one to
land before #24 builds on the contract.

> **How this review was run.** The skill dispatches a `code-reviewer` agent for the deep pass.
> No such agent exists on this machine (`.claude/agents/` is absent in both the project and
> `~/.claude/`), so the deep pass was done directly in a context that was cleared before the PR
> was fetched and did not write this code — the fresh-eyes condition the skill actually cares
> about. Every changed file was read in full, not just the diff.

---

## Summary

This is two tickets in one PR and the second one is the load-bearing half. The code half is a
magic link whose token **rotates on every exchange**, which is the design idea worth keeping: it
makes *"a reused link is rejected"* and *"`opened_at` is stamped exactly once"* the same
structural fact — one `UPDATE … WHERE token_hash = <old>` — rather than two guards that can
drift apart. `consumeOtp` is the same move applied to the OTP: the cap, the comparison and the
single-use delete live in one function so no route can order them wrong.

**The part that should drive the merge decision is the infrastructure half.** The two Access
bypass applications are already live on production, ahead of this merge. `public/404.html` is
not. Until it ships, Pages' missing-asset fallback serves the **recruiter's tool shell at 200
for any unmatched path under the now-public `/prep/*`** — the file's own header records this
observed live on 28 Jul 2026. Merging is what closes that. It is the strongest argument in the
PR and it is currently buried in a bullet.

The engineering is careful and the reasoning is written down where it will be read. The three
findings below are all consequences of `/prep/*` becoming a **public, unauthenticated surface**
for the first time — the axis this PR changes and the one its own documentation covers least.

---

## Issues

### Medium 1 — `delete.js` lets an ambient cookie silently override an explicit body token

**`functions/prep/api/delete.js:38`**

```js
const token = readCookie(request) || String(body.token ?? "").trim();
```

The `||` short-circuits. If **any** `prep_session` cookie is present, the body token is never
hashed and never consulted — including when the two name different invites.

**Failure scenario.** A candidate holds invite A (clicked, so cookie A is live) and invite B
(emailed, unclicked). They `POST /prep/api/delete {token: "<B's token>"}`. Cookie A is present,
so B's token is discarded, `hashToken(cookieA)` matches **invite A**, and **invite A is deleted**
while invite B survives. The response is `{ok: true}`. The caller named one record and a
different one was destroyed. On a shared or kiosk browser the two invites can belong to two
different people.

The weaker case is also live: rotation now makes *stale-but-present* cookies ordinary (a second
sign-in from another device rotates the first device's cookie out). A stale cookie matches no
row, nothing is deleted, and the route still answers `{ok: true}` + `Set-Cookie: …Max-Age=0`.
A GDPR erasure endpoint reports success having run no statement.

The route **cannot currently detect either case**: `deleteInviteByTokenHash`
(`src/portal/store.js:57`) returns a bare `{ok: true}` and discards `meta.changes`.

**Fix** — start at the store: return `{ok: true, deleted: result.meta.changes ?? 0}`. Then in the
route, if the cookie deleted nothing and a body token was supplied, try the body token before
answering. The `{ok: true}` idempotence #17 chose is worth keeping; silently preferring an
unrelated ambient credential over an explicit one is not.

**Honest caveat:** there is no production caller today — #24 ships the button. That is the
argument for fixing it *now*, while the contract is being written, rather than after #24 inherits it.

---

### Medium 2 — the OTP attempt cap is per-code, not per-invite, and nothing bounds code requests

**`functions/prep/auth/otp.js`** · **`src/portal/store.js:228`**

`migrations/0004_otp_attempts.sql` exists, in its own words, because *"without a cap, the
returning-login endpoint is a free oracle."* But `issueOtp` opens with
`DELETE FROM otp WHERE invite_id = ?` and inserts a fresh row — and `attempts` defaults to `0`.
So **requesting a new code resets the counter.** The cap is five guesses *per code*, not five per
invite, and `POST /prep/auth/otp` is unauthenticated with no throttle in front of it.

The plan's rejected-alternatives section (line ~1009) turns this down on the stated grounds that
one-live-code-per-invite *"gives the same protection with no new state."* That equivalence does
not hold. It bounds how many codes are **valid at once**; it bounds neither how many are
**issued** nor how many total guesses are available.

**Lead consequence — denial of the recovery path.** The magic link is single-use by design, so
the OTP is the *only* way back in. An attacker who knows a candidate's email address can request
a code in a loop; each request `DELETE`s the code the candidate is currently reading off their
phone. They can invalidate it faster than a person can type six digits, and the candidate is
locked out of their prep with no other door. Secondary: unbounded outbound mail to that address
(cost, deliverability reputation) and an unbounded guess budget of 5-per-email-sent.

Brute force alone is not the worry — ~139k cycles for a coin-flip against a fresh random code
means the Resend account dies first. The lockout is the real one.

**Fix that honours the plan's own "no new state" constraint:** a Cloudflare rate-limiting rule on
`/prep/auth/otp` (and `/prep/auth/verify`) keyed on client IP. No column, no cleanup, no code —
it belongs in `scripts/setup-access.py` and `DEPLOY.md` §3b beside the bypass apps it is the
counterweight to. This is flagged not because rate limiting is missing (a documented decision)
but because the **premise the decision rests on is incorrect**.

---

### Medium 3 — an undocumented exposure change: the lazy purge is now unauthenticated

**`functions/prep/_middleware.js:14`**

```js
await purgeExpired(env.DB);
```

`purgeExpired` is a deliberate **full-table-scan `DELETE`** — its own docstring says the
`datetime(interview_at, …)` wrapper defeats the `invite_by_interview` index on purpose. The
middleware runs it, awaited, before `next()`, on **every** `/prep/*` request.

Until this PR, the whole hostname was behind Access, so only the authenticated owner could reach
that path. The bypass applications remove the only authentication standing in front of a
DB-mutating code path, and `/prep/login` and `/prep/privacy` are now public assets that anyone can
request in a loop.

At invite-count scale with Cloudflare in front, the practical harm is small. The finding is that
**this is not written down anywhere** — not in the plan's non-goals, not in the report's ten
documented deviations, not in `DEPLOY.md` §3b, which otherwise covers the bypass thoroughly. The
same edge rate-limiting rule from Medium 2 covers it; at minimum §3b should say that making
`/prep/*` public also made the retention sweep publicly triggerable, and that this was considered.

---

### Low 1 — the default toolchain skips the tests that prove the auth logic

`test/prep-auth.test.js` needs `node:sqlite` (Node ≥ 22.5). This machine's default is Node
20.20.2, where `npm test` reports **390 pass, 23 skip, 0 fail** — green, having never executed
the 18 behavioural tests that are the only ones proving reuse, expiry, once-only stamping and the
OTP cap against real SQL. The file's own header explains why those cannot run under `fake-d1`.

There is no CI (`.github/` does not exist), so nothing is silently passing in a pipeline, and the
skip message carries its remedy. But `package.json` has no `engines` field, so the toolchain that
runs the real gate is a convention rather than a stated requirement. Adding
`"engines": {"node": ">=22.5"}` costs one line.

### Low 2 — rejection-sampling comment is off by ~3×

**`src/prep/tokens.js:36`** — *"the cost of one extra draw in ~1,400."* The reject window is
2³² − 4,294,000,000 = 967,296, so the redraw rate is 967,296 / 4,294,967,296 ≈ **1 in 4,440**.
The logic and the constant are correct; only the figure in the prose is wrong. Flagged because
this codebase treats its comments as load-bearing.

---

## Validation

Run against the PR head in its worktree; the merge row was run in a throwaway worktree that has
been removed.

| Gate | Command | Result |
|---|---|---|
| Tests, Node 24 | `nvm exec 24 npm test` | **413 pass, 0 fail, 0 skip** ✅ |
| Tests, Node 20 (default) | `npm test` | **390 pass, 0 fail, 23 skip** ✅ (see Low 1) |
| **Merge with current `main`** | `git merge --no-commit --no-ff origin/main` | **clean, zero conflicts** ✅ |
| **Merged tree, Node 24** | `npm test` on the merged tree | **459 pass, 0 fail** ✅ |
| JS syntax | `node --check` × 10 changed files | pass ✅ |
| Python syntax | `python3 -m py_compile scripts/setup-access.py` | pass ✅ |
| Shell syntax | `bash -n .claude/verify-deploy.sh` | pass ✅ |
| Type-check / lint / build | — | **none exist in this repo** (no tsconfig, no linter, no build step) — not skipped, absent |
| Level 5 post-deploy | `.claude/verify-deploy.sh` | **not run** — needs `main` deployed |

The PR body's `459/459` merge claim is **independently verified**, not taken on trust.

---

## What is good

- **Rotation as the unifying idea.** Collapsing two guards that could disagree into one `UPDATE`
  whose `WHERE` is the atomicity boundary is the right shape, and the race comment at
  `store.js:142` shows it was reasoned about rather than stumbled into.
- **`consumeOtp` owns the whole decision.** Cap before comparison, increment only on mismatch,
  single-use as a `DELETE` rather than a flag — *"a flag can be checked in the wrong order and a
  missing row cannot"* is the sentence that makes this reviewable.
- **`test/prep-auth.test.js` exists because of a named failure mode.** The header lists the four
  behaviours that branch on `meta.changes` and would pass under `fake-d1`'s hard-coded
  `{changes: 1}` while broken. That is a test file that knows what it is for.
- **The OTP hash preimage is invite-bound.** `hashOtpCode(inviteId, code)` turns a 10⁶ space from
  a precomputable lookup table into something useless without the row it came from.
- **The code is a string, and a test enforces it.** `'000123'` vs `123` is exactly the tidy-up a
  future editor would make; `mintOtpCode`'s comment names the 1,000× consequence.
- **The enumeration guard is consistent end to end** — `202` on both branches of
  `/prep/auth/otp`, the same `401 invalid_code` for an unknown address and a wrong code in
  `verify.js`, and `login.js` copy written not to imply a match from the client side either.
- **The OTP email carries no link,** deliberately, with a test asserting no `http` substring in
  either part. Refusing to teach the habit phishing depends on is a real call, not a nicety.
- **`public/404.html` reasons about itself.** A file whose comment explains it is security
  infrastructure rather than polish is a file that survives the next tidy-up.
- **The wrong-length code costs no attempt,** in both the page and the route — a candidate
  fat-fingering a paste is not an attacker, and the code says so.
- **`maxAgeFrom` names the SQLite/`Date.parse` timezone trap** and fails closed on an
  unparseable value, and `sessionFromRequest` reuses it rather than re-parsing.
- **`setup-access.py` stayed idempotent** across the change from two apps to four, and the
  delete-on-no-policy check was widened to cover the bypass pair — where a bare app is *worse*
  than useless, not merely useless.

## Documented deviations — verified, not flagged

The report's ten deviations were read against the diff. All are intentional and correctly
described. Two worth confirming explicitly for the human reader:

- **Prefetch by corporate mail scanners burns the single-use link.** Named and accepted in the
  plan (§"Prefetch — named, not engineered around"): the recovery path is one email away, the
  metric distortion is uniform, and the interstitial is the known fix if the pilot shows
  `opened` at ~100%. Not a defect. Worth watching in the pilot.
- **`requireSession` and `PUBLIC_PREP_PATHS` have no production caller.** Forward work for
  #21/#24, and the report is explicit that `PUBLIC_PREP_PATHS` is documentation that will **not**
  catch a future `/prep` route which forgets its guard. Correct as written; #21 should decide
  whether to make it a real check.

---

## Recommendation

**Approve.** Three Mediums and clean validation do not meet the request-changes bar, the merge is
verified clean and green against current `main`, and the PR closes a live exposure — the Access
bypass apps are already in production while `public/404.html`, the thing that stops Pages serving
the recruiter's shell at `/prep/<anything>`, is only in this branch. Merging promptly is the
safer move.

**Before merge — restated, because approving must not imply these are done:**

1. **Do one live Resend send.** The transport is proven only against a stub. If `saulera.com` is
   not a verified sending domain, every send answers 403 **while this entire suite stays green**.
   That is DNS, not code — `DEPLOY.md` §5b says so at the point the key is set.
2. **Level 5 (post-deploy) has not run.** The live deployment predates #26–#29, so
   `.claude/verify-deploy.sh` should run after this merge deploys, not before.

**After merge, in priority order:**

1. **Medium 1 (`delete.js` credential precedence) before #24.** It is the contract #24's button
   will be built on, and it is a ~10-line fix while nothing depends on it.
2. **Medium 2 + 3 together** — one Cloudflare rate-limiting rule on `/prep/*` covers both, written
   into `scripts/setup-access.py` and `DEPLOY.md` §3b beside the bypass apps.
3. Low 1 and Low 2 whenever the files are next touched.

Next step if these are actioned: `piv-fix-review-findings` on this report, then re-validate.
