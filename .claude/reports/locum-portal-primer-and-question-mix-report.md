# Implementation Report — Portal pivot: first-day primer and the locum question mix

**Plan**: `.claude/plans/locum-portal-primer-and-question-mix.md`   **Branch**: `feature/locum-portal-primer-and-question-mix`   **Status**: COMPLETE

## Summary

Locum bookings now serve a first-day primer plus a readable, grouped question list instead of the
interview drill; perm roles are byte-untouched. The deterministic `engagement` flag (from
`briefProfile`) is stamped in `generateBrief`, recomputed and re-stamped server-side at send, and
carried by a deliberately widened `candidateProjection`. Questions gained a `type` enum
(`client`/`competency`/`screening`) — required in the schema, tolerant of absence in `assertBrief`
(#49 A3). The closed block vocabulary was opened deliberately in both places at once:
`FirstDayPrimer` (brief side, with `source_field_key` provenance mirroring `PanelBrief`) and
`LocumQuestions` (session side). Zero D1 migrations, zero changes to `/prep/api/session`,
`/prep/api/turn`, `drill.js`, `targeting.js`, and no new HTTP body fields.

## Tasks completed

- `question.type` enum + `FirstDayPrimer` block + both `assertBrief` guards → `src/prep/schema.js` (UPDATE)
- Primer provenance walk (shared `demote` helper, idempotency guard verbatim) + additive `primer_*` summary counts → `src/prep/verify.js` (UPDATE)
- Engagement-branched locum instruction paragraph, strictly after the cache breakpoint; `PREP_SYSTEM` untouched → `src/prep/prompt.js` (UPDATE)
- `engagement` computed from cleaned inputs, threaded to the prompt, stamped on the verified payload → `src/prep/generate.js` (UPDATE)
- Server-truth re-stamp after `verifyBrief`, before `persistHandover` → `functions/api/prep/send.js` (UPDATE)
- `engagement` always projected; `{text, type}` questions when — and only when — locum; demoted primer items projected like panel entries → `src/prep/projection.js` (UPDATE)
- `FirstDayPrimer` + `LocumQuestions` constructors, name lists, COPY (plain-language headings; reuses the panel's single unsourced predicate) → `public/prep/registry.js` (UPDATE)
- Locum branch in `renderPrime` (wins over day-before), `state.engagement`, resume-guard exclusion, honest empty line → `public/prep/session.js` (UPDATE)
- Operator script prints `engagement`, primer counts and the per-type question mix → `scripts/gen-brief.js` (UPDATE)
- `public/prep/session.css`: **no-op** — the constructors reuse existing classes only, as the plan predicted.

## Tests added

- `test/prep-schema.test.js` — type enum (valid/invalid/absent); `FirstDayPrimer` valid + non-array `items`; nested-in-children rejection covered by the existing all-names loop. 19 pass.
- `test/prep-verify.test.js` — primer demotion reported with block/item/key; idempotent re-verify preserves `failed_field_key`; additive counts; pre-#50 payloads read `primer_total: 0`. 19 pass.
- `test/prep-prompt.test.js` — cached first block byte-identical locum vs perm; locum branch content; perm/unknown/absent all take the one-line rule; `PREP_SYSTEM` engagement-free. 15 pass.
- `test/prep-generate.test.js` — locum/permanent/unknown briefs stamp the right flag and the prompt sees it. 16 pass.
- `test/prep-projection.test.js` — locum questions exactly `{text, type}` (key sets); perm/unknown carry no `questions` key; type default; hidden-slug blanking on primer items. 16 pass.
- `test/prep-registry.test.js` — twelve-name registry + parity amended; `FirstDayPrimer` marks (sourced/demoted, one predicate); `LocumQuestions` groups, empty-group skip, no raw slug. 48 pass.
- `test/fixtures/prep-session-blocks.json` — `LocumQuestions` specimen added.
- `test/prep-send.test.js` — forged `engagement` overwritten (locum-worded brief wins); absent flag stamped fresh; `type` rides `brief_json` while the `question` table stays type-free; forged `type` is a 400. 49 pass.
- `test/prep-session-ui.test.js` — locum end-to-end over real routes + real-SQLite D1 (primer, logistics, grouped list, Start hidden, no drill, no model call); day-before + locum takes the locum branch; stray attempt row never opens the drill; perm path pinned. 39 pass.

## Validation results

- `node --check` over all eight changed source files: pass.
- `grep -rn "\.note" src/prep public/prep functions/prep`: no new `client.note` reads (matches are pre-existing comments and `props.note` renders).
- Full suite: **802 tests, 802 pass, 0 fail, 0 skipped** (Node 24.11.0 — Node 20 skips the real-SQLite suites by design, so validation ran under 24, matching CI).

## Deviations from the plan

- **Locum brief-fetch failure falls to the perm-degraded prime, not a bespoke failed state.** The
  `engagement` flag only exists inside the brief payload, so when that fetch fails the page cannot
  know the booking is locum; it reads `"other"` and takes the existing degraded perm prime — the
  plan's own "fail toward existing behaviour" rule (#46 D2). The empty-page risk the plan's gotcha
  targets is closed the reachable way: a locum brief that composes zero blocks renders
  `COPY.locumEmpty` rather than a blank prime, and the total-failure case still gets `COPY.failed`.
- **`test/prep-generate.test.js` and `test/prep-verify.test.js` deep-equal summaries were amended**
  to include the additive `primer_*` keys — required by the plan's own summary task, noted here
  because they are edits to pre-existing assertions.
- **`scripts/gen-brief.js` output was extended** (engagement line, primer counts, per-type question
  mix) — the plan flagged this as optional/likely; it is an operator script, not a route.
- **Live Level 4/5 (real API call, wrangler dev) not run** — no `ANTHROPIC_API_KEY` in this
  session; the plan marks both optional.

## Issues encountered

None. The registry parity test failed mid-branch between the schema task and the registry task,
exactly as the plan's sequencing-risk note predicted; it went green once the registry side landed.
