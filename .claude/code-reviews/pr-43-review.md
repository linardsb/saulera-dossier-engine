# PR #43 Review — fix: send idempotency, 409 already_sent (#34)

**Verdict: APPROVE with fixes** — no Critical/High; one Medium residual that needs disclosure + a log line before merge; validation green (718 pass · 0 fail · 0 skipped under Node 24).

## Issues

### Critical / High

None found.

### Medium

1. **Standing-key false-success lockout** (`functions/api/prep/send.js:324-327`, `rollbackInvite:152-159`, copy at `public/app.js:205-207`). The 409's soundness rests on "a rolled-back send frees its key". Two paths break that: (a) the rollback DELETE itself fails — swallowed by design — leaving row + key standing for a send whose email never went out; (b) the isolate dies between the invite INSERT and the mail send, so no rollback is attempted. The retry then gets `409 already_sent` and the recruiter reads "your earlier try went through" — false, and the candidate silently gets no link. Pre-PR these failures self-healed (the retry minted a fresh invite). Low probability, wrong direction, and disclosed nowhere. Required: written disclosure at the swallow site and the 409 branch, a `console.error` in the 409 branch so a lockout is diagnosable from logs, and the recovery path ("Start again" → fresh prepare → fresh key) named in the copy's comment.

### Low

2. **UNIQUE detection is unpinned string-matching** (`send.js:323-324`). Verified: node:sqlite says `UNIQUE constraint failed: invite.send_key`; real D1 wraps as `D1_ERROR: UNIQUE constraint failed: invite.send_key: SQLITE_CONSTRAINT` — both match. A regex miss degrades to 500 (never re-inflates the count — the index enforces regardless). Wants a comment naming the D1 shape it was checked against.
3. **The `/send_key/` half of the regex is untested** — a refactor to `/UNIQUE/i` alone would pass the suite while mislabeling other constraint trips as `already_sent`. Add a faultyD1 test: a token_hash-shaped UNIQUE error with a key set must surface as 500, not 409.
4. **`state.sendKey` outlives `sendPrepared` on "Not yet"** (`dropPreparedSend`), contradicting its own lifecycle comment. Harmless today (renderPreview re-mints unconditionally); one line aligns it.

## Strengths

- The enforcement is the index, not the code: even with a regex miss, browser bug or curl, a duplicate key can never produce a second invite, email or count. Behaviour tests run on real SQLite for exactly that reason and pin all four behaviours (409 shape + no-mail + count honesty · rollback frees the key · new key sails · key-less degrades to today).
- The browser lifecycle is tight: minted in one place, cleared on settle and client switch, and `already_sent` shares the success path's terminal shape via `settleSent`, so the two cannot drift.
- Backward compatibility is deliberate at every layer and tested — a mid-deploy mixed fleet degrades to exactly today's behaviour.

## Validation

| Check | Result |
|---|---|
| `npm test` (Node 24.11.0) | 718 pass · 0 fail · 0 skipped |
| `node --check` (send.js, store.js, app.js) | clean |
| Schema-lock test updated in the same PR | yes, as its own failure message demands |

## Recommendation

Approve after the Medium's disclosure + log line and the two test/comment Lows land.
