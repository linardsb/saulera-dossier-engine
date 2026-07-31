# PR #44 Review — fix: same-day reminder skip (#39)

**Verdict: APPROVE** — no Critical/High/Medium; two Lows, both small. Validation green (715 pass · 0 fail · 0 skipped under Node 24; the previously-hanging middleware file 2/2 in isolation).

## Issues

### Critical / High / Medium

None found. Specifically verified sound: the all-NULL `sent_at` path excludes safely; the `min(id)`/`max(sent_at)` split cannot mismatch (id only feeds `claimReminder`); no precedence trap in the two-predicate HAVING; every other `createInvite` call site is untouched by the clause (none reach `dueReminders`).

### Low

1. **`max(sent_at)` compares raw TEXT, contradicting the file's own mixed-format invariant** (`src/portal/store.js:663`). The comment eight lines up explains why `interview_at` is wrapped in `date()` — the schema admits both space- and T-form stamps, and raw string comparison misorders them (`'T'` > `' '`). `max()` here picks before normalizing: a T-form older invite plus a space-form re-send today would select the older stamp and mail the back-to-back pair the clause exists to prevent. Latent today (the sole writer stamps space-form), but the clause silently relies on an invariant the file says not to rely on. Fix: `max(datetime(sent_at))`.
2. **The UTC-day seam**: `date('now')` is UTC, so a UK invite sent 00:30 BST on the eve stamps 23:30 UTC yesterday, and the reminder still mails the same (UK) evening. Consistent with the sweep's pre-existing UTC framing; wants a sentence in the comment so "did today already bring an email?" is honest about whose today.

## Strengths

- The third test structurally locks the HAVING-vs-WHERE distinction — the one regression that matters cannot be "simplified" back in without a red test.
- The seed helper keeps every pre-existing assertion meaningful (backdated by default, "sent today" opt-in), and the middleware seed's comment explains the otherwise-baffling backdate including the infinite release-loop it prevents.
- The behavioural cost (eve-created invites are never reminded) is stated plainly at the query, in the RCA, and pinned by a test.

## Recommendation

Approve; apply the two Lows (one function wrap, one sentence).
