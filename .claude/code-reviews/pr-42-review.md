# PR #42 Review — fix: Node-version gate, both halves (#33, #36)

**Verdict: APPROVE** — no Critical, High or Medium issues; validation proven in both directions and the workflow's first live run is green.

## Validation

| Check | Result |
|---|---|
| Node 24.11.0 local | 713 pass · 0 fail · 0 skipped · exit 0 |
| Node 20.20.2 local | exit 1, the only failure the new gate, remedy in the message (was: 574 pass · 138 skipped · exit 0, silent) |
| CI (the PR's own run — the workflow's first live execution) | **pass**, 7s |
| sed skip-extraction against real Node 20 TAP output | `skipped=138` extracted; per-test `# SKIP` annotations and subtest lines verified non-matching |

## Issues

### Critical / High / Medium

None found.

### Low

1. **Workflow has no `permissions` block** (`.github/workflows/test.yml`). `npm ci` runs dependency lifecycle scripts with the default `GITHUB_TOKEN`; on repos with write-default tokens that's an unnecessary grant. `permissions: contents: read` is a one-line hardening.
2. **Pre-release Node strings fail the gate spuriously** (`test/node-version.test.js:32`). `Number("0-nightly…")` → NaN → reported below the floor. Fail-closed and exotic-toolchain-only, but `parseInt` reads the numeric prefix and removes the confusion.
3. **`2>&1` merges stderr into the parsed stream** (`.github/workflows/test.yml:25`). A future stderr diagnostic ending `skipped N` could win `tail -1` under nondeterministic pipe interleaving. The summary is stdout; dropping the merge removes the fragility (stderr still reaches the CI log directly).

## Strengths

- Single source of truth: the gate reads `engines.node` from package.json; an unparseable range fails loudly instead of being guessed at.
- Fail-closed throughout: unparseable range → assert; empty extraction → explicit "unknown number" failure. Both halves err red — correct for a gate whose purpose is refusing silent green.
- Belt-and-braces layering: the version test catches the old-Node cause on laptops; the CI skip-count gate catches any skip whatever its cause. Each covers the other's blind spot, and the comments explain the reporter-format subtlety for the next reader.

## Recommendation

Approve; apply the three Lows (three small lines) before merge.
