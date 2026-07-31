# Root Cause Analysis: GitHub Issue #39

## Issue Summary

- **GitHub Issue ID**: #39
- **Issue URL**: https://github.com/linardsb/saulera-dossier-engine/issues/39
- **Title**: Reminder sweep: skip invites sent the same day (invite + reminder back to back)
- **Reporter**: linardsb
- **Status**: OPEN, no linked PR — a deferred Low from the PR #38 review

## Assessment

| Metric | Value | Reasoning |
|--------|-------|-----------|
| Severity | Low | Harmless under decision 17 (the issue's own words) — two courteous emails on one evening reads slightly spammy, nothing more |
| Complexity | Low | One HAVING clause in one query; the wrinkle is test seeds, because `createInvite` stamps `sent_at` as *today* — every existing reminder test must backdate to stay meaningful |
| Confidence | High | The query, the sweep, and the tests all read today; the fix is the issue's own suggestion composed with the per-candidate GROUP BY shape it names |

## Problem Description

**Expected Behavior:** A candidate invited on the day-before day gets the invite email only — the "Your interview is tomorrow" reminder is redundant with the email they just received.

**Actual Behavior:** An invite created on the eve of the interview is immediately due (`date(interview_at) = date('now','+1 day')`), so the sweep mails the reminder back to back with the invite.

**Symptoms:**
- Two emails to the same candidate within minutes/hours on the same evening

## Reproduction

**Steps to Reproduce:**
1. Recruiter sends an invite for an interview happening tomorrow
2. Any `/prep/*` request runs the lazy sweep (`functions/prep/_middleware.js` → `sendDueReminders`)
3. `dueReminders` returns the fresh invite; the reminder mails immediately after the invite email

**Reproduction Verified:** Yes by inspection — `createInvite` stamps `sent_at = datetime('now')` (`src/portal/store.js:114-116`) and `dueReminders` filters only on `interview_at` and unreminded (`src/portal/store.js:653-663`); nothing consults `sent_at`.

## Root Cause

### Affected Components

- **Files**: `src/portal/store.js` (`dueReminders`), `test/prep-reminders.test.js` (seeds + new cases)

### Analysis

**Evidence Chain (short — the cause is one missing condition):**
```
WHY invite + reminder back to back?  → an eve-created invite is due immediately
  (evidence: store.js:656-659 — WHERE date(interview_at) = date('now','+1 day') … HAVING max(reminder_sent_at) IS NULL)
ROOT CAUSE: dueReminders never consults sent_at — "was this candidate emailed today?" is
  simply not asked. (evidence: the query has no reference to sent_at)
```

**Why This Occurs:** Original behaviour, disclosed as Low #2 in the PR #38 review and deferred out of that PR deliberately.

### Related Issues

- PR #38 (built the sweep) and its follow-up (per-candidate dedupe: `GROUP BY email / HAVING max(reminder_sent_at) IS NULL`, which the issue says any fix must compose with)

## Impact Assessment

**Scope:** Only invites created on the interview's eve. **Affected Features:** reminder email tone. **Severity Justification:** Low — courtesy polish; no data, no metric, no security. **Data/Security Concerns:** none.

## Proposed Fix

### Fix Strategy

Add one condition to `dueReminders`' HAVING — candidate-granular, matching the GROUP BY shape:

```sql
HAVING max(reminder_sent_at) IS NULL
   AND date(max(sent_at)) < date('now')
```

"The newest invite email this candidate got was before today." Deliberately in the HAVING over the newest row, not a per-row WHERE: if the candidate holds an older invite *and* a re-sent one from today, a row-level filter would leave the older row due and mail the reminder back to back with the re-send — the exact symptom, reintroduced through the side door.

Consequence to state openly: an eve-created invite is never reminded at all (the sweep window is the eve only, and the skip consumes it). That is the intent — the invite email *is* that evening's email — and decision 17's "at most one reminder, ever" is respected in the downward direction it prefers.

### Files to Modify

1. **src/portal/store.js** — the HAVING clause + the doc comment extended in the file's voice.
2. **test/prep-reminders.test.js** — the seed helper must backdate `sent_at` (direct-write idiom, because the production writer stamps *now* — which is precisely the behaviour under test); two new cases: eve-created invite is skipped; older-invite-plus-today's-re-send is skipped as a whole candidate.

### Alternative Approaches

- Row-level `WHERE date(sent_at) != date('now')` (the issue's literal sketch) — leaks the back-to-back through the re-send case above; the issue itself asks for composition with the GROUP BY shape.
- Skipping in the sweep loop (JS) — moves a set-membership decision out of the one query that defines the due set; the store owns due-ness.

### Risks and Considerations

- Existing reminder tests seed through `createInvite`, so every seed is "sent today" — they would all silently turn into skip-cases. The seed helper backdates by default, keeping every existing assertion meaningful; the new tests opt into "sent today" explicitly.
- `max(sent_at)` over NULLs: the writer always stamps `sent_at`, and an all-NULL group yields NULL → not selected → skipped, which is the safe direction for a row that claims to be an invite but was never sent.

### Testing Requirements

**Test Cases Needed:**
1. Eve-created invite (sent today): `dueReminders` excludes it; the sweep mails nothing
2. Invite sent yesterday, interview tomorrow: still due, still mailed (regression pin)
3. Candidate with yesterday's invite + today's re-send: excluded entirely (the HAVING-not-WHERE pin)

**Validation Commands:**
```bash
export PATH="$HOME/.nvm/versions/node/v24.11.0/bin:$PATH"
node --test test/prep-reminders.test.js   # 0 skipped under Node 24
npm test
```

## Implementation Plan

One clause, one comment, seed backdate, three tests. Branch `fix/issue-39-same-day-reminder-skip`; PR says `Closes #39`.

## Next Steps

1. Review this RCA
2. `piv-implement-issue 39` → `piv-create-pr` → `piv-review-pr`
