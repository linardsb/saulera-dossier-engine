# Implementation Report — Imaging domain vocabulary

**Plan**: `.claude/plans/imaging-domain-vocabulary.md`   **Branch**: `feat/imaging-domain-vocabulary`   **Status**: COMPLETE

## Summary

The engine now reads imaging briefs deterministically: a new pure module `src/domain.js` parses brief/CV text into `{ imaging, role_shape, modalities, specialisms, scanner_makes }`, the generation prompts gain an imaging/locum guidance block (HCPC-never-NMC, modality/specialism vocabulary, scanner-make matching, "verify, don't sell" for locum) in both shapes, `PACK_SCHEMA` carries a `role_shape` enum so the flag survives both generation routes, and `generatePack` returns the profile as `brief_profile`. Perm-nursing prompts are byte-identical to `main` except the schema's new property (verified by diff).

## Tasks completed

- Task 1: branch `feat/imaging-domain-vocabulary` off `origin/main` (two untracked files identical to main removed to allow the switch)
- Task 2: `src/domain.js` (CREATE) — `briefProfile`, `ROLE_SHAPES`, regexes transcribed from the plan
- Task 3: `test/domain.test.js` (CREATE) — 9 tests covering all 8 planned cases
- Task 4: `src/pack.js` (UPDATE) — `role_shape` enum property + required, tolerant-absence check in `assertPack`, `ROLE_SHAPES` re-export
- Task 5: `test/paste.test.js` (UPDATE) — role_shape round-trip + wrong-case rejection
- Task 6: `src/prompt.js` (UPDATE) — `domainBlock` (verbatim from plan), wired into `buildMessages` (second content item) and `buildPastePrompt` (between note and inputs)
- Task 7: `test/prompt.test.js` (UPDATE) — 5 imaging-block tests; existing regression pins untouched (additions only, `git diff` confirms)
- Task 8: `src/generate.js` (UPDATE) — `brief_profile` on the result
- Task 9: `test/generate.test.js` (UPDATE) — domain-block-in-request + profile-on-result tests
- Task 10: adapters checked read-only — `functions/api/{prompt,generate,verify}.js` need no edits; the generate adapter serialises explicit fields only, so `brief_profile` never reaches HTTP (D1 holds)

## Tests added

- `test/domain.test.js` — 9 tests: Priya persona, Marcus persona, nursing negative, "General Hospital" guard + permanent, CV-only scanner makes, locum-beats-permanent (D3), null-safety, GE/sonograph case pins, ROLE_SHAPES contract
- `test/prompt.test.js` — 5 tests: HCPC/never-NMC in paste prompt, cache-prefix pin (domain in content[1], note block bare), locum bullet on/off by role shape, empty block for nursing, cannot-drift across shapes
- `test/paste.test.js` — 2 tests: role_shape survives extraction; wrong-case `"Locum"` throws naming the field
- `test/generate.test.js` — 2 tests: domain block after the cached note in the built request; `brief_profile` on the result for imaging and nursing

All pass.

## Validation results

- `node --check` on all four touched src files — pass
- `npm test` under Node 24.11.0 — **747 pass, 0 fail, 0 skipped**
- Under the shell's default Node 20 the suite reports 1 fail — that is `test/node-version.test.js` enforcing `engines.node >=22.5` (pre-existing, environmental, unrelated)
- Level-4 manual: imaging paste prompt eyeballed — domain block after the note, before the brief, locum bullet present
- Level-4 diff: nursing paste prompt this branch vs `origin/main` — identical except the schema JSON's `role_shape` property (the exact expected diff)

## Deviations from the plan

- **Branch creation**: `git switch` was blocked by two untracked files (`.claude/plans/otp-reissue-cooldown.md`, `docs/epics/imaging-locum-fit.md`) that another session had already committed to `main`. Verified both byte-identical to `origin/main` and removed the local copies. No content lost.
- Everything else is a straight transcription of the plan, including the pinned `domainBlock` text and the regex spec verbatim.

## Issues encountered

None beyond the Node-version environmental note above; run the suite under Node ≥22.5 (`nvm use 24`).
