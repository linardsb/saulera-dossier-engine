# Root Cause Analysis: GitHub Issue #34

## Issue Summary

- **GitHub Issue ID**: #34
- **Issue URL**: https://github.com/linardsb/saulera-dossier-engine/issues/34
- **Title**: R7: a timed-out send that actually succeeded inflates invite_sent — needs 409 already_sent
- **Reporter**: linardsb
- **Status**: OPEN, no linked PR, no prior comments

## Assessment

| Metric | Value | Reasoning |
|--------|-------|-----------|
| Severity | Medium | No data loss or security exposure — but the inflated number is `invite_sent`, decision 23's evidence for the sentence the pilot is measured on, inflating in the one direction nobody would check |
| Complexity | Medium | One migration (column + UNIQUE index), the store INSERT, the route's error mapping, the browser's key mint + 409-as-success handling, real-SQLite tests — five files across schema/server/client |
| Confidence | High | The residual is disclosed in the code itself (`public/app.js:1554-1570` names `409 already_sent` as the answer); every claim verified at file:line today; the rollback mechanics that make the fix exact are already tested |

## Problem Description

**Expected Behavior:** A browser retry of a send that already succeeded server-side does not mint a second invite or record a second `invite_sent` — it answers `409 already_sent`, which the browser reads as success (the candidate has their link).

**Actual Behavior:** The client's `sendDone` guard is set only on success — deliberately, because the catch cannot tell a `502 mail_failed` from a network timeout. So a timed-out-but-succeeded send leaves `sendDone` false, and the retry runs the whole route again: fresh `crypto.randomUUID()`, fresh token, fresh invite row, second email with a second live magic link, second `invite_sent` event.

**Symptoms:**
- One candidate, two invite rows, two `invite_sent` events (the metric inflates)
- Two emails with two live magic links (confusing, not harmful — `inviteByEmail` returns the newest)

## Reproduction

**Steps to Reproduce:**
1. Recruiter confirms a send; the server completes all four steps (invite → handover → email → count)
2. The response is lost (network timeout in the browser) — `sendDone` stays false, the payload stays frozen for retry (`public/app.js:1627-1633` keeps it deliberately)
3. Recruiter clicks send again → `functions/api/prep/send.js` mints a structurally distinct second invite (`:280-283`) and counts a second `invite_sent` (`:351-361`)

**Reproduction Verified:** Yes by code inspection — nothing in the route is keyed on anything stable across retries; `createInvite` is a plain INSERT with no uniqueness beyond `token_hash` (fresh every call) (`src/portal/store.js:110-120`, `migrations/0002_portal.sql:16-27`).

## Root Cause

### Affected Components

- **Files**: `functions/api/prep/send.js`, `src/portal/store.js` (`createInvite`), `public/app.js` (`confirmSend` + prepared payload), `migrations/` (invite table), `test/prep-send.test.js`
- **Dependencies**: none external

### Analysis

**Evidence Chain (5 Whys):**
```
WHY two invite_sent rows for one candidate?    → the retry is a full second send
  (evidence: send.js:280-283 — fresh randomUUID + mintToken every call; store.js:110-120 — plain INSERT)
WHY does the client retry a succeeded send?    → sendDone is set ONLY on success, deliberately —
  the catch cannot tell 502 mail_failed from a network timeout, and killing the retry would cost
  a real ~30p model call on every mail outage
  (evidence: app.js:1559-1563 — "SUCCESS SETS IT, FAILURE LEAVES IT FALSE")
WHY can't the server tell a retry from a re-send? → no request carries anything stable across
  retries; the only uniqueness is token_hash (fresh per call) and candidate_role.invite_id
  (unique only within one invite id)
  (evidence: migrations/0002_portal.sql:16-27 — no constraint on client/email/interview)
WHY is that not trivially fixable with a natural key? → a second send to the same
  (client, email, interview_at) is sometimes exactly what the recruiter wants (date moved, note
  changed, CV updated); #22 deliberately declined to make that product decision by accident
  (evidence: issue #34's own design section)
ROOT CAUSE: the send has no idempotency key — nothing distinguishes "the same prepared payload,
  retried" from "a new deliberate send", so the server must treat every request as new.
  (evidence: app.js:1554-1570 — the disclosure naming "a server-side 409 already_sent" as the answer)
```

**Why This Occurs:** Not a regression — #22 disclosed it as a residual in the open and deliberately did not build the server half; the PR #32 review re-raised it as the one residual contradicting that PR's own invariant (the count only ever deflates).

**Code Location:**
```
public/app.js:1554-1558
 * THE RESIDUAL THE GUARD DOES NOT CLOSE: a request that times out in this browser but
 * succeeded on the server leaves sendDone false, so a retry sends a genuine second invite.
 * There is no cheap client-side answer — a server-side `409 already_sent` is the answer and
 * is deliberately not built in this ticket.
```

### Related Issues

- #22 (built the send + the client guard, disclosed the residual) · PR #32 review (re-raised it) · `migrations/0006_reminder.sql` (the repo's column-as-idempotency precedent: "this column IS the idempotency")

## Impact Assessment

**Scope:** Every send whose response is lost; frequency scales with real-world network flakiness at pilot time.

**Affected Features:** The `invite_sent` count (the pilot's deliverable metric); candidate inboxes (duplicate emails).

**Severity Justification:** Medium — no harm to data or candidates, but the metric is the thing the pilot is measured on, and it inflates in the direction nobody checks.

**Data/Security Concerns:** Two live magic links exist instead of one (both single-use, both the candidate's own — no new exposure class).

## Proposed Fix

### Fix Strategy

The issue's shape (1), the one it says "looks right": an **idempotency key**, minted by the browser once per *prepared payload* and posted with the send.

- **Schema** (`migrations/0007_send_key.sql`): `ALTER TABLE invite ADD COLUMN send_key TEXT;` + `CREATE UNIQUE INDEX invite_send_key ON invite (send_key);` (SQLite UNIQUE indexes admit any number of NULLs, so existing rows and key-less callers are untouched — the 0006 "column IS the idempotency" precedent).
- **Store**: `createInvite` gains optional `sendKey`, bound into the INSERT (NULL when absent).
- **Route**: accept `send_key` (optional, non-blank string, capped length). The invite INSERT is already the FIRST write, so the UNIQUE index does the discrimination *exactly*: a retry of a fully-succeeded send trips it → answer `409 already_sent`, nothing written, nothing sent, nothing counted. A retry of a rolled-back send finds the key free (the rollback deleted the row) → proceeds normally. The re-send question answers itself: a *deliberate* re-send is a new prepared payload, which carries a new key.
- **Browser**: mint `crypto.randomUUID()` into the prepared payload; post it; treat `409 already_sent` as success (set `sendDone`, show the sent copy) — the candidate does have their link.

### Files to Modify

1. **migrations/0007_send_key.sql** (new) — the column + partial-free UNIQUE index.
2. **src/portal/store.js** — `createInvite` binds `send_key`.
3. **functions/api/prep/send.js** — `send_key` in `ALLOWED` + validation; catch the UNIQUE failure on `invite.send_key` around `createInvite` → `409 already_sent`.
4. **public/app.js** — key minted with the prepared payload; posted; `already_sent` handled as success in `confirmSend`; a `sendMessageFor` branch never fires for it (handled before the generic error path).
5. **test/prep-send.test.js** — behaviour tests (below). **test/portal-store.test.js** — recorded-SQL update for `createInvite`.

### Alternative Approaches

- **Natural-key refusal** on `(client_id, email, interview_at)` — makes the deferred product decision by accident; a moved note/CV re-send would be refused. Rejected by the issue itself.
- **Time-boxed duplicate refusal** — "cheaper, and it guesses" (the issue's words).

### Risks and Considerations

- Concurrent same-key requests: the second hits the UNIQUE index → 409 while the first is still in flight; if the first *then* rolls back, the recruiter saw "sent" for a send that failed. Vanishingly narrow (same key = same browser = sequential clicks behind `state.busy`), and the failure direction is a missing send the recruiter can redo — noted, accepted.
- Old cached browsers post without `send_key` → NULL column, today's behaviour, no idempotency — degraded gracefully, not broken.
- The UNIQUE-violation detection must match only `invite.send_key`, not other constraint failures (which must keep their existing surfacing).

### Testing Requirements

**Test Cases Needed:**
1. Same key, second send after full success → `409 { error: "already_sent" }`, one invite row, one `invite_sent` event, one mail call
2. Same key after a mail-failure rollback → the retry SUCCEEDS (the rollback freed the key) — the property that makes this exact, not a guess
3. Different keys, same candidate → both persist (the deliberate re-send, unchanged — the existing R2 two-sends test keeps passing)
4. No key at all → today's behaviour end-to-end
5. Recorded-SQL: `createInvite` binds `send_key`, NULL when absent

**Validation Commands:**
```bash
export PATH="$HOME/.nvm/versions/node/v24.11.0/bin:$PATH"
node --check functions/api/prep/send.js && node --check src/portal/store.js && node --check public/app.js
node --test test/prep-send.test.js     # 0 skipped under Node 24
npm test
```

## Implementation Plan

Migration → store → route → browser → tests → validate. Branch `fix/issue-34-send-idempotency`; PR says `Closes #34`.

## Next Steps

1. Review this RCA
2. `piv-implement-issue 34` → `piv-create-pr` → `piv-review-pr`
