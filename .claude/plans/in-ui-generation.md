# Feature: in-ui-generation

## Feature Description

Restore in-UI pack generation. The owner has explicitly superseded the no-API-key decision
(28 Jul 2026, this session): the recruiter clicks **Generate the pack** and the pack appears in
the page — no trip to a Claude tab in the primary flow. `POST /api/generate` returns, backed by
an `ANTHROPIC_API_KEY` Pages secret. The manual seam (`/api/prompt` + `/api/verify` + the
Claude-tab round trip) stays fully working as the visible fallback: a secondary button in act 1,
and the recovery path named in every model-side error message.

## User Story

As a working owner-recruiter
I want the pack generated inside the tool with one click
So that the loop has no application switch at all.

## Problem Statement

The tab trip was the price of "no key". The owner has looked at the flow and decided the key is
the better trade (~15–25p per pack at this volume). The reverted `3d72737` already built the
call correctly for Claude Opus 5; the current codebase has since grown the seam, the renderers
behind `/api/verify`, and the one screen — the restore must fit those.

## Solution Statement

Revive `src/generate.js` + `functions/api/generate.js` + `test/generate.test.js` from `3d72737`,
adapted: dedupe `cleanInput`/`INPUT_MAX` (now exported by `src/prompt.js`), render server-side so
the response shape matches `/api/verify` exactly (`{pack, provenance, failures, renderer, text,
html, event_recorded}` — the UI then treats both routes identically), and add the Opus 5
recommended refusal fallback (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`,
via `client.beta.messages.stream`). UI: "Generate the pack" primary + "Copy the prompt and open
Claude" secondary in act 1; act 2 gains a generating mode (same section, `is-generating` class,
same honest elapsed clock, manual-only nodes hidden); act 3 unchanged for both routes.

## Out of Scope / Non-Goals

- Not removing the seam or its Functions — it is the fallback and the probes' manual path.
- Not streaming partial packs to the browser; one request, honest elapsed clock (CRAFT motion
  rules: no fake progress).
- No per-recruiter keys, no BYO-key config; one secret per deployment.
- Not changing `/clients`, `src/provenance.js`, renderers, store, migrations.

## Feature Metadata

**Feature Type**: New Capability (restore + adapt)  ·  **Complexity**: High
**Systems**: `src/generate.js`, `functions/api/generate.js`, `wrangler.toml`, `package.json`,
`public/index.html`, `public/app.js`, `public/app.css`, `test/generate.test.js`,
`.claude/probes/one-screen.mjs`, `DEPLOY.md`, `README.md`
**Dependencies**: `@anthropic-ai/sdk` moves devDependencies → dependencies; `nodejs_compat`
returns to `wrangler.toml`; `ANTHROPIC_API_KEY` as a Pages secret (user creates the key).

## Related Work

**Back-references**: `.claude/plans/least-friction-loop.md` (paste-anywhere stays, manual-mode
only), `.claude/plans/generation-seam-and-one-screen.md` (the seam being demoted to fallback),
commit `3d72737` (the source of the restored module), `5e311d1` (the revert being superseded).

---

## CONTEXT REFERENCES (read before implementing)

- `git show 3d72737:src/generate.js` — the module to restore; correct per current claude-api
  skill except: local `cleanInput`/`INPUT_MAX` now dedupe to `src/prompt.js` imports; add
  `betas`/`fallbacks` and move to `client.beta.messages.stream`
- `git show 3d72737:functions/api/generate.js` — adapter to restore; add `getAgency` + `render`
  so the response mirrors `functions/api/verify.js:90-101`
- `git show 3d72737:test/generate.test.js` — restore; fake moves to `beta.messages.stream`; add
  assertions for `fallbacks: "default"` + beta header; keep every 400-param assertion
- `src/prompt.js:16-81,121-137` — `SYSTEM`, `buildMessages` (cache breakpoint on the note),
  `cleanInput`, `INPUT_MAX`
- `functions/api/verify.js` — response shape + agency renderer + event pattern to mirror
- `public/app.js` — phase machine (`setPhase`), guards (`mine()`, `state.busy`), freeze
  semantics, `renderPack` (route-agnostic already: takes the verify-shaped body)
- claude-api skill (loaded this session): Opus 5 thinking on by default; `max_tokens` caps
  thinking+text (32k stands); no sampling params; `output_config.format`; `fallbacks: "default"`
  recommended; check `stop_reason` before `content`

## Patterns to Follow

- Thin adapter / testable module split (store.js precedent)
- `ALLOWED` body vocabulary; `errorResponse` forwards code only; no candidate text in messages
- UI: `COPY` strings, `textContent` only, aria-disabled busy pattern, one clock stop in
  `setPhase`, stale-response guards on every landing response

---

## IMPLEMENTATION PLAN / TASKS

1. **RESTORE+ADAPT `src/generate.js`** — imports from `./prompt.js`; beta stream with
   `betas: ["server-side-fallback-2026-07-01"]`, `fallbacks: "default"`; keep
   MODEL/MAX_TOKENS/EFFORT and all guards. VALIDATE: new unit tests.
2. **RESTORE+ADAPT `functions/api/generate.js`** — env guards (`DB`, `ANTHROPIC_API_KEY`,
   sameOrigin), 404-before-call, generate → render(agency.renderer) → recordEvent(server
   duration) → verify-shaped 201. VALIDATE: `test/seam.test.js` still green; new adapter smoke
   via fake-d1 if cheap.
3. **UPDATE `wrangler.toml`** (`nodejs_compat` + comment), **`package.json`** (dependency).
4. **UPDATE `public/index.html`** — act-1 row: Generate primary, copy-prompt secondary;
   `manual-only` classes on act-2 manual nodes; `generating-only` note; heading word span;
   steps map + page-sub copy for the new primary flow.
5. **UPDATE `public/app.js`** — phase `"generating"`; `generate()` handler (validate → freeze →
   POST → renderPack → phase "pack"); failure → phase "inputs", unfreeze, message naming the
   fallback button; `setPhase` shows act-waiting for generating too and toggles
   `is-generating` + heading word; new COPY entries (no em dashes).
6. **UPDATE `public/app.css`** — `.manual-only`/`.generating-only` visibility under
   `.is-generating`; read CRAFT.md rules already loaded.
7. **UPDATE `.claude/probes/one-screen.mjs`** — probes 15 (generate success end-to-end,
   0 verify calls, pack copied), 16 (503 no_model_key → act 1, message, manual path still
   works), 17 (client switch mid-generate → nothing renders). Probes 1–14 unmodified.
8. **RESTORE+ADAPT `test/generate.test.js`**.
9. **DOCS**: DEPLOY.md (secret setup + `.dev.vars` local dev + triage rows no_model_key /
   model_refused / truncated), README (dated supersession under Decisions → Model access,
   Status paragraph), Desktop architecture doc (28 Jul 2026 amendment under the 27 Jul one),
   memory `dossier-no-api-key.md` rewrite.

## VALIDATION COMMANDS

- Level 1: the five greps from least-friction-loop (hex / transition-all / em-dash / storage /
  innerHTML)
- Level 2: `npm test` — 223 existing + restored generate suite, all green
- Level 3: `~/.nvm/versions/node/v24.11.0/bin/node .claude/probes/one-screen.mjs` → 17/17;
  clients-screen → 11/11
- Level 4 (manual, needs the key): `wrangler pages dev` with `.dev.vars`, generate one real pack

## ACCEPTANCE CRITERIA

- [ ] One click on Generate produces a rendered, verified pack in act 3 with zero copy/paste
- [ ] `/api/generate` response shape is byte-compatible with `/api/verify`'s
- [ ] The manual Claude-tab flow works unchanged as the visible secondary path
- [ ] No candidate data persisted or logged; event counter unchanged (one event per pack)
- [ ] Request carries nothing that 400s on Claude Opus 5; refusal fallback enabled
- [ ] All tests + probes green; docs and decision records updated

## OPEN QUESTIONS / ASSUMPTIONS

- The user creates the API key and runs `wrangler pages secret put ANTHROPIC_API_KEY`
  (documented in DEPLOY.md); until then the deployment answers 503 `no_model_key` and the
  screen points to the manual path — the tool never breaks.
- `fallbacks: "default"` included per claude-api skill guidance (told the user in-session);
  drop if they object.

## AMENDMENTS

(none yet)
