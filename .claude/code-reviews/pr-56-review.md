# PR #56 Review — feat: the locum portal pivot — first-day primer and the slim question mix

**Recommendation: APPROVE.** No Critical or High issues. The seven key invariants the PR claims all hold on inspection, the documented deviations match the implementation report, and validation is fully green.

## Validation

| Check | Result |
|---|---|
| Full suite (`npm test`, Node 24.11.0 — matches CI) | **802 pass / 0 fail / 0 skipped** |
| Diff to `/prep/api/session`, `/prep/api/turn`, `drill.js`, `targeting.js` | none (verified via `git diff main...HEAD`) |
| D1 migrations | none added |
| XSS surface in new registry constructors | clean — DOM built via `el()`/`createTextNode` only; no `innerHTML` in `public/prep` (grep + the suite's own source-scan gate) |
| `client.note` reads candidate-side | none — the only read remains send.js's recruiter-side `visibleFields()` filter seam |

## Invariants verified

1. **Prompt-cache prefix byte-identical between locum and perm** — the locum paragraph is appended only inside the post-breakpoint content block (`src/prep/prompt.js:113–118`); `PREP_SYSTEM` and `visibleNoteBlock` are unchanged, and a test pins `locum[0].text === perm[0].text` with `cache_control` present. (The perm call's *post*-breakpoint block gained the one-line "not a locum booking" rule — cache-safe and required by the now-mandatory `type` field.)
2. **`engagement` is server truth** — `functions/api/prep/send.js:296` recomputes `briefProfile(...).role_shape` from cleaned inputs after `verifyBrief` and re-stamps at `persistHandover` (line 375); a forged browser flag is overwritten, proven over real SQLite.
3. **Locum questions project as exactly `{text, type}`** — `src/prep/projection.js:108–113`; no `id`/`axis`/`difficulty` on the wire; perm/unknown carry no `questions` key. Tests assert key *sets*, not mere presence.
4. **Locum branch wins over day-before, hides Start, never enters the drill** — branch ordering in `public/prep/session.js:291–320` plus the resume-guard exclusion at line 275; the stray-attempt-row case is integration-tested over real route handlers + real SQLite.
5. **Primer items demote-not-drop, idempotently** — shared `demote` helper (`src/prep/verify.js:67–74`) carries the panel's idempotency guard verbatim; re-verify preserves `failed_field_key` without re-reporting.
6. **`assertBrief` tolerates pre-#50 payloads** — absent `type`/primer read cleanly (#49 A3), while `BRIEF_SCHEMA` requires `type` for new generations.
7. **Documented deviations** (degraded-perm fallback on locum brief-fetch failure, two amended deep-equal assertions, `gen-brief.js` output) — all three checked against the code and match the implementation report; intentional, not flagged.

## Issues

### Low (non-blocking, defensive polish only)

1. `public/prep/session.js:299–303` — locum grouping pushes `String(question?.text ?? "")` unconditionally, so an empty-text question would render a blank `<li>` and count toward group non-emptiness. Unreachable through a valid payload (`assertBrief` requires non-empty `q.text`); optionally skip falsy texts before pushing.
2. `src/prep/projection.js:109–112` — `text: q?.text` omits the key when `text` is `undefined`, so the `{text, type}` shape is only guaranteed for asserted payloads. Same unreachability; `String(q?.text ?? "")` would make the shape unconditional. Cosmetic.

### Observations (accepted residuals, no action needed)

- `/prep/api/turn` remains technically reachable for a locum invite via hand-crafted POST (questions are still persisted); the UI never offers it and drill guardrails hold — plan A3's explicitly accepted residual.
- The "perm path pinned" test is a behavioral landmark pin, not a literal byte snapshot; adequate given the perm code path is unchanged apart from the inert `engagement !== "locum"` guard.
- A pre-#50 stored handover for a locum-worded brief keeps the perm drill (absent flag → `"unknown"`), which is #46 D2's tolerance rule working as designed.

## Done well

- The `demote` extraction is the right altitude — one helper, two call sites, the forgery-shape comment moved intact, with an explicit note not to abstract further.
- The send.js re-stamp sits after the not_sendable gate and immediately before `persistHandover`, on the same cleaned strings persisted as `jd_text` — the stored row is self-consistent by construction, and the forged-flag test proves it over real SQL.
- The cache-breakpoint byte-identity test turns the prompt-caching economics into an enforced contract instead of a comment.
- The whole-wire `!JSON.stringify(...).includes("a-hidden-key")` assertion is a strong data-exposure check.
- The stray-attempt-row end-to-end test covers exactly the interaction (old resume guard vs. new locum branch) a reviewer would worry about.

---
_Agentic review (piv-review-pr, fresh-context reviewer). A human makes the final merge call._
