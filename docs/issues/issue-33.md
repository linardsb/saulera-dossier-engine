# Root Cause Analysis: GitHub Issue #33

## Issue Summary

- **GitHub Issue ID**: #33
- **Issue URL**: https://github.com/linardsb/saulera-dossier-engine/issues/33
- **Title**: npm test is a false pass on Node 20: 72 real-SQL integrity tests skip silently
- **Reporter**: linardsb
- **Status**: OPEN, no linked PR — fixed together with #36 on one branch (same root-cause surface)

## Assessment

| Metric | Value | Reasoning |
|--------|-------|-----------|
| Severity | High | Every "suite is green" claim on the default toolchain is unverified for the whole real-SQL integrity layer — the exact tests that exist because the fake passes while the logic is wrong |
| Complexity | Low | One new test file; no change to the (correct) skip guard; the CI half is #36's workflow file |
| Confidence | High | Reproduced today: Node 20.20.2 → 712 tests, 574 pass, 0 fail, **138 skipped**, exit 0, no on-screen signal (the skip set has grown from the issue's 72 since filing) |

## Problem Description

**Expected Behavior:** A test run that cannot execute the real-SQL integrity proofs says so loudly — a red suite, not a silent omission.

**Actual Behavior:** `npm test` on Node < 22.5 exits 0 with every `node:sqlite`-backed test skipped. The skip message exists per-test but nothing fails, so the summary reads as a pass.

**Symptoms:**
- Node 20.20.2 (this machine's default): 712 tests · 574 pass · 0 fail · 138 skipped · exit 0
- Node 24.11.0: 718 pass · 0 skipped (with PR #41's additions)
- The silently-dropped set is the expensive one: PRIMARY KEY collisions, CHECK constraints, cascade chains, rollback halves, the visibility gate — everything `test/helpers/fake-d1.js` cannot see because it returns `{ changes: 1 }` unconditionally and enforces nothing.

## Reproduction

**Steps to Reproduce:**
1. `node --version` → v20.20.2 (default toolchain)
2. `npm test`
3. Exit 0; summary shows `skipped 138` in the trailing stats block only — no failure, no warning

**Reproduction Verified:** Yes, today (31 Jul 2026), on origin/main.

## Root Cause

### Affected Components

- **Files**: `test/helpers/sqlite-d1.js` (the skip guard — correct, stays), `package.json` (engines declared, unenforced), no CI workflow (that half is #36)
- **Functions**: the exported `skip` constant (`sqlite-d1.js:41-42`)

### Analysis

**Evidence Chain (5 Whys):**
```
WHY does npm test pass while proving nothing?    → because every node:sqlite test skips on Node < 22.5
  (evidence: test/helpers/sqlite-d1.js:41-42 — `export const skip = !DatabaseSync && "node:sqlite unavailable…"`)
WHY do they skip rather than fail?               → deliberate: the alternative is an unrunnable suite;
  the guard is correct and stays (issue #33's own words)
WHY is the omission invisible?                   → node --test treats skips as passes at exit-code level,
  and nothing else asserts "the environment can run everything"
WHY does nothing assert that?                    → package.json declares engines.node >= 22.5 but nothing
  enforces it: no .npmrc engine-strict, no CI, no runtime check
  (evidence: package.json:6-8; `ls .npmrc .github` → neither exists)
ROOT CAUSE: the suite has no non-skipped test that fails when the running Node cannot satisfy
  engines.node — the declared floor and the executed floor are disconnected.
```

**Why This Occurs:** Long-standing by design — the skip guard shipped with #17/#20 and was always graceful; the falseness of the pass was measured in the PR #32 review (Medium 8) and deferred deliberately because closing it turns default-toolchain `npm test` red, which is a decision, not a slip.

**Code Location:**
```
test/helpers/sqlite-d1.js:41-42
export const skip =
  !DatabaseSync && "node:sqlite unavailable (Node < 22.5); run under Node 24 for full coverage";
```

### Related Issues

- #36 — the CI half (no runner exists to make the full run authoritative); same root cause, fixed on this branch
- PR #32 review Medium 8 — where the measurement came from

## Impact Assessment

**Scope:** Every local run on the default toolchain; every future PR's "suite is green" claim inherits it.

**Affected Features:** None at runtime — this is test-infrastructure honesty, not a product defect.

**Severity Justification:** High despite zero user impact, because it corrupts the signal every other fix in this pass relies on (this session validated PR #41 under Node 24 with an explicit 0-skipped check precisely because of this issue).

**Data/Security Concerns:** None directly; indirectly, integrity-constraint regressions could merge unproven.

## Proposed Fix

### Fix Strategy

The issue's own suggested fix: one **non-skipped** test that fails unless the running Node satisfies `engines.node`, reading the range from `package.json` rather than restating it. The skip guard in `sqlite-d1.js` is untouched. Consequence (named in the issue as the point): `npm test` goes red on this machine until `nvm use 24`, with the remedy in the failure message.

### Files to Modify

1. **test/node-version.test.js** (new) — reads `package.json` `engines.node`, parses the `>=X.Y` floor, asserts `process.versions.node` satisfies it; failure message names the remedy. Not skip-guarded, by definition.

### Alternative Approaches

- `engine-strict=true` in `.npmrc` — fails at install, not at test; a machine with `node_modules` already present still false-passes.
- CI-only enforcement — leaves local runs lying; that half is #36 and lands too, but alone it doesn't fix the reviewer-at-a-laptop case.

### Risks and Considerations

- Default-toolchain `npm test` turns red on this machine — intended and stated in the issue.
- The parser handles the repo's actual range shape (`>=X.Y[.Z]`); it should fail loudly on a shape it cannot parse rather than silently passing.

### Testing Requirements

**Test Cases Needed:**
1. Under Node 24: the new test passes; whole suite green with 0 skipped
2. Under Node 20: the new test FAILS (exit non-zero) with the nvm remedy in the message

**Validation Commands:**
```bash
export PATH="$HOME/.nvm/versions/node/v24.11.0/bin:$PATH" && npm test          # green, 0 skipped
/Users/Berzins/.nvm/versions/node/v20.20.2/bin/node --test test/*.test.js; echo "exit: $?"  # non-zero
```

## Implementation Plan

One branch with #36: add `test/node-version.test.js`, add the CI workflow (#36), validate under both toolchains.

## Next Steps

1. Review this RCA
2. `piv-implement-issue` (joint branch with #36) → PR says `Closes #33, Closes #36`
