# Implementation Report — in-ui-generation

**Plan**: `.claude/plans/in-ui-generation.md`   **Branch**: `feature/ux-ui-uplift`   **Status**: COMPLETE (one manual step open: the key)

## Summary

In-UI generation is restored, superseding the no-key decision by explicit owner choice made in
this session. `POST /api/generate` (revived from `3d72737`, adapted) calls Claude Opus 5 with
structured outputs, runs the literal-quote verifier server-side, renders with the agency's
renderer and answers in exactly `/api/verify`'s shape. The screen gains a primary **Generate
the pack** button and a generating mode in act 2 (honest elapsed clock, no invented progress);
the Claude-tab seam remains fully working as the visible secondary route, and every model-side
failure names it as the remedy. A deployment with no key set degrades to the seam in words,
never to a blank failure.

## Tasks completed

- `src/generate.js` (RESTORE+ADAPT) — dedup to `src/prompt.js` imports; beta stream with
  `fallbacks: "default"` + `server-side-fallback-2026-07-01` (Opus 5 refusal false-positive
  insurance, per claude-api skill guidance); stop_reason guarded before parse
- `functions/api/generate.js` (RESTORE+ADAPT) — `DB`/`ANTHROPIC_API_KEY`/same-origin guards,
  404-before-call, render(agency.renderer), server-side duration into the event counter,
  verify-shaped 201
- `wrangler.toml` (UPDATE) — `nodejs_compat` back, comment rewritten
- `package.json` / lockfile (UPDATE) — `@anthropic-ai/sdk` devDependencies → dependencies
- `public/index.html` (UPDATE) — Generate primary + ghost fallback button, act-2 two-mode
  section, steps map and page-sub copy
- `public/app.js` (UPDATE) — phase `"generating"`, `state.route`, `generate()` with the same
  freeze/stale/busy guards as both existing flows, `generateMessageFor`, header rewrite
- `public/app.css` (UPDATE) — `.generating-only`/`.manual-only` mode rules, tokens only
- `.claude/probes/one-screen.mjs` (UPDATE) — probes 15–17; probes 1–14 unmodified
- `test/generate.test.js` (RESTORE+ADAPT) — beta-namespace fake, fallback opt-in test added
- `DEPLOY.md` (UPDATE) — §5b rewritten to "one secret" with setup steps and the degrade-to-seam
  property; three new triage rows; smoke-test items
- `README.md` (UPDATE) — Decisions → Model access superseded with history kept; Status updated
- Architecture doc (Desktop) — 28 Jul 2026 amendment added above the 27 Jul one
- Memory — `dossier-no-api-key.md` rewritten to record the reversal; index line updated

## Tests added

`test/generate.test.js`: 13 tests (request shape incl. everything that 400s on Opus 5,
max_tokens headroom, fallback opt-in, cache breakpoint on the note, verifier-demotes-not-drops,
refusal/truncation/no-pack errors, note/input refusals before the call, server-side duration).
Probes 15 (generate end-to-end: one POST, frozen inputs, zero /api/verify calls, pack copied),
16 (no_model_key → act 1, inputs kept and thawed, manual route still works), 17 (client switch
mid-generate renders nothing).

## Validation results

- Level 1 greps: all clean · Unit: 236/236 · Probes: one-screen 17/17, clients-screen 11/11
- `wrangler pages functions build`: compiles; the nodejs_compat warning is the standalone
  build not reading wrangler.toml (flag is set for real deploys — same finding as `3d72737`)
- Not run (needs the key): a live generation. Until the secret exists, `/api/generate` answers
  `no_model_key` by design.

## Deviations from the plan

1. `fallbacks: "default"` uses the plain-JS passthrough of the SDK (0.115.0 typings may lag
   the July beta; the body field passes through regardless). Flagged for a version bump later.
2. `COPY.leavingClient` wording became route-neutral ("Switching client abandons it.") —
   probe 10 pins only the client name, verified green.

## Issues encountered

None beyond the above. The one open step is the owner's: create the key in the Anthropic
Console and run `npx wrangler pages secret put ANTHROPIC_API_KEY --project-name
saulera-dossier-engine` (DEPLOY.md §5b), plus `.dev.vars` for local dev.
