# Root Cause Analysis: GitHub Issue #36

## Issue Summary

- **GitHub Issue ID**: #36
- **Issue URL**: https://github.com/linardsb/saulera-dossier-engine/issues/36
- **Title**: CI: run the test suite on a runner with Node ≥ 22.5
- **Reporter**: linardsb
- **Status**: OPEN, no linked PR — fixed together with #33 on one branch (same root-cause surface)

## Assessment

| Metric | Value | Reasoning |
|--------|-------|-----------|
| Severity | Medium | No CI exists at all, so nothing green-lights PRs falsely — but nothing green-lights them at all; the risk is a future runner on old Node inheriting #33's false pass |
| Complexity | Low | One workflow file; the repo has no build step, no lint, no external test services |
| Confidence | High | `ls .github` → does not exist; `package.json` engines verified; the skip mechanics are #33's, reproduced today |

## Problem Description

**Expected Behavior:** An authoritative test run exists per PR, on a Node that has `node:sqlite`, and a run that skipped anything is a failed run.

**Actual Behavior:** The repo has no CI workflow. `engines.node >= 22.5` is declared and unenforced (no `.npmrc`, no workflow), so the authority for "the suite is green" is whoever's laptop ran it last, on whatever Node that laptop had.

**Symptoms:**
- `.github/` does not exist in the repo
- Every PR to date was validated manually (the PIV loop's validation steps), with the Node-version caveat handled by hand

## Reproduction

**Steps to Reproduce:**
1. `ls .github` → no such directory
2. Open any PR → no checks run

**Reproduction Verified:** Yes, today (31 Jul 2026).

## Root Cause

### Affected Components

- **Files**: none — the root cause is an absence: no `.github/workflows/*.yml`
- **Dependencies**: GitHub Actions (free for public/private repos at this scale)

### Analysis

**Evidence Chain (short — the cause is an absence, not a defect):**
```
WHY can a CI runner go green while proving nothing?  → there is no CI runner at all
  (evidence: .github/ absent)
WHY would one on old Node false-pass if added naively? → #33's mechanism: node:sqlite tests
  skip gracefully below 22.5 and node --test exits 0 on skips
  (evidence: test/helpers/sqlite-d1.js:41-42)
ROOT CAUSE: no workflow pins the Node version or refuses a run with skips —
  the "full run as authority" half of the #33/#36 pair.
```

**Why This Occurs:** The repo predates any team; CI was simply never adopted. Deferred from the PR #35 review (finding L6).

### Related Issues

- #33 — the local half (loud failure on the laptop); this branch fixes both

## Impact Assessment

**Scope:** Every future PR. **Affected Features:** none at runtime. **Severity Justification:** Medium — preventive infrastructure; the local half (#33) carries the live risk today. **Data/Security Concerns:** none.

## Proposed Fix

### Fix Strategy

A minimal GitHub Actions workflow: checkout → setup-node on Node 24 → `npm ci` → `npm test`, then **fail if the run skipped anything** by parsing the reporter's `skipped` count. With #33's version-gate test in the suite, an old-Node runner fails twice over (the gate test reddens, and any skips redden) — belt and braces in both directions.

### Files to Modify

1. **.github/workflows/test.yml** (new) — on `push` to main and on `pull_request`; Node 24; `npm ci`; run the suite teeing output; extract the final `skipped N` from the summary and exit non-zero unless N = 0.

### Alternative Approaches

- Trusting #33's gate test alone (no skip-count check): covers the Node-version cause but not a future `{ skip }` accidentally left on a test unconditionally. The count check is one grep and closes that too.
- `engine-strict` in CI `.npmrc`: install-time only; weaker signal than a red test run.

### Risks and Considerations

- The skip-count parse must match `node --test`'s summary in CI (TAP `# skipped N` when not a TTY, `ℹ skipped N` under the spec reporter) — match both shapes.
- Workflow YAML cannot be validated end-to-end locally; first real proof is this PR's own checks tab. That is acceptable — the PR carrying the workflow is the test.

### Testing Requirements

**Test Cases Needed:**
1. This PR's own CI run: green, and the log shows `skipped 0` gate passing
2. Local suite under Node 24: green, 0 skipped (unchanged)

**Validation Commands:**
```bash
export PATH="$HOME/.nvm/versions/node/v24.11.0/bin:$PATH" && npm test
gh pr checks <PR#>   # after push — the workflow's first live run
```

## Implementation Plan

One branch with #33: `test/node-version.test.js` (#33) + `.github/workflows/test.yml` (#36).

## Next Steps

1. Review this RCA
2. `piv-implement-issue` (joint branch with #33) → PR says `Closes #33, Closes #36`
