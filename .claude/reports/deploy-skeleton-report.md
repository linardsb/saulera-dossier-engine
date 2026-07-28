# Implementation Report — Deploy skeleton (#3)

**Plan**: `.claude/plans/deploy-skeleton.md`
**Branches**: `feature/deploy-skeleton-a` (Deploy A) → `feature/deploy-skeleton-b` (Deploy B
+ docs), stacked. Two PRs, merged either side of the dashboard work.
**Status**: PARTIAL — all code and docs complete and locally verified; the four Cloudflare
dashboard tasks cannot be performed by an agent and are handed off below.

## Summary

Built the full local half of the deploy shell: a `public/` build output on a CSS-custom-
property token layer, `functions/api/health.js` mirroring the saulera `contact.js` pattern,
the `@anthropic-ai/sdk` dependency with a committed lockfile, a `wrangler.toml` carrying
`nodejs_compat`, and both documentation deliverables.

Tasks 6, 8, 9 and 11 are Cloudflare dashboard work (Pages Git connection, two Access
applications, the encrypted secret). Those cannot be scripted, so AC2, AC4 and AC5 remain
open pending the handoff checklist at the end of this report.

Because the dashboard was unavailable, the code was instead verified against a **real Pages
Functions runtime locally** (`wrangler pages dev`) rather than by reading. That turned out
to be worth more than the plan expected — see Deviation 2, which found a factual error in
the plan's own expected output.

## Tasks completed

| Task | File | Action |
|---|---|---|
| 0 — verify baseline | — | clean, current with origin, 11/11 green |
| 1 — token layer | `public/tokens.css` | CREATE |
| 2 — placeholder page | `public/index.html` | CREATE |
| 3 — health Function | `functions/api/health.js` | CREATE |
| 4 — test script | `package.json` | UPDATE |
| 5 — commit Deploy A | — | commit `b13eb04` |
| 12 — SDK + compat flags | `package.json`, `package-lock.json`, `wrangler.toml`, `functions/api/health.js` | UPDATE / CREATE |
| 13 — commit Deploy B | — | commit `3a14106` |
| 14 — engine/config split | `README.md` | UPDATE |
| 15 — runbook | `DEPLOY.md` | CREATE |
| 16 — commit docs | — | commit `2c0e3f5` |
| — | `.gitignore` | UPDATE (commit `76dbf24`, see Deviation 4) |

**Not done — dashboard only:** Task 6 (connect Pages), 7 (live smoke test), 8 + 9 (two
Access applications), 10 (live curl verification), 11 (the secret), and 16's issue close.

Deploy A and Deploy B remain two separate, independently revertible commits as the plan
requires.

## Tests added

None, per the plan's testing strategy — `health.js` has three branches with no logic worth
isolating, and standing up a Functions runtime in-process for them would assert less than
the live checks do. `test/smoke.test.js` stays the regression guard at 11/11.

Instead, all three branches were exercised against a real local Functions runtime:

| Branch | Command | Result |
|---|---|---|
| No secret bound | `POST /api/health` | `503 {"error":"not_configured"}` ✅ |
| Malformed body | `POST /api/health -d 'not json'` | `400 {"error":"bad_json"}` ✅ |
| Happy path | `POST /api/health -d '{}'` | `200 {"ok":true,"service":"saulera-dossier-engine","key":true,"sdk":true}` ✅ |
| Headers | same | `Content-Type: application/json`, `Cache-Control: no-store` ✅ |
| Static | `GET /`, `GET /tokens.css` | `200`, `200` ✅ |
| **AC5 leak scan** | key bound as `sk-ant-localtest`; grepped `/`, `/tokens.css`, and `/api/health` headers + body | **no `sk-ant` in any client-delivered byte** ✅ |
| **SDK bundling** | wrangler esbuild pass over `functions/` | `✨ Compiled Worker successfully`, and `sdk: true` proves the client **constructs**, not merely imports ✅ |

This also confirmed the plan's own observation that the `bad_json` branch is unreachable
before the secret exists — unconfigured, a malformed body still returns `503`, because the
`not_configured` guard short-circuits first.

## Validation results

- **Level 1 — syntax**: `node --check` clean on `functions/api/health.js` and all 7 `src/`
  files; `package.json` parses; `wrangler.toml` carries all four required keys. PASS
- **Level 2 — unit tests**: `# tests 11 / # pass 11 / # fail 0`. No regression. PASS
- **Level 3 — live integration**: **NOT RUN** — requires the Pages project (Task 6). The
  local runtime battery above is the closest available substitute; it covers every row of
  the plan's integration table except the three Access rows, which are inherently live-only.
- **Level 4 — manual**: **NOT RUN** — requires the Access door and a browser login.
- **Level 5 — local runtime**: PASS (see above). Required Node 22+; the repo's default
  Node is v20.20.2, so this ran on nvm's v24.11.0. `wrangler` was **not** added as a
  dependency — invoked via `npx`, as the plan instructs.
- Per-task validations from the plan: Task 1, 2, 3, 4, 14 and 15 blocks all PASS as written
  (Task 3's re-run after Task 12 is Deviation 1).
- `~/Desktop/saulera` (marketing repo): `git status` clean, untouched.

## Deviations from the plan

**1. Task 3's key-leak grep is stale after Task 12 — assertion widened, code unchanged.**
The check allowlists only `!env.ANTHROPIC_API_KEY` and `Boolean(env.ANTHROPIC_API_KEY)`.
Task 12 then mandates `new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })`, which the
allowlist does not cover, so the Task 3 command fails on the finished file. This is the two
tasks disagreeing, not a defect. Verified both ways: as written it flags line 33; with the
constructor added to the allowlist it passes. `health.js` was **not** altered to satisfy the
older assertion — the key is still only ever guarded or handed to the SDK, never returned.

**2. The plan's expected `405` for `GET /api/health` is wrong. Production Pages returns
`404`.** Checked empirically against `https://saulera.com/api/contact`, which has the
identical shape (only `onRequestPost` exported): it returns **404**, not 405. Pages does not
synthesise a 405 for an unmatched method — the request falls through to static asset
handling. No code change: AC3 requires only `onRequestPost`, and the plan explicitly forbids
adding an `onRequestGet`. **Task 7's method-guard line and the "Method guard | 405" row of
the integration table should read 404.**
Secondary note: locally, `wrangler pages dev` answers unmatched paths with `index.html` at
`200` rather than 404. That is a dev-server fallback artifact, not production behaviour.

**3. Two stacked branches and two PRs, instead of the plan's direct pushes to `main`.** The
plan's Tasks 5, 13 and 16 push straight to `main`, and that is what delivers its two-deploy
isolation: connect Pages while *only* Deploy A is live, so a red build can only be the
dashboard. A single PR for the whole ticket would merge both deploys at once and quietly
lose that. Split to preserve it, per the user's call on 27 July 2026:

```
main
 └── feature/deploy-skeleton-a   b13eb04                      → PR A, base main
      └── feature/deploy-skeleton-b   3a14106 2c0e3f5 76dbf24 → PR B, base branch A
```

Branch A was verified green standalone — no SDK import, no `wrangler.toml`, no lockfile,
`node --check` clean, 11/11, and Task 3's leak grep passes there exactly as written. PR B is
stacked on A, so its diff shows only Deploy B; GitHub retargets it to `main` automatically
once A merges.

Docs sit on branch B, matching the plan's Phase 5 ("write down what actually happened, not
what was planned"). So `DEPLOY.md` is not on `main` while you do the dashboard work — read
it from branch B, which is checked out locally.

**4. Added `.wrangler/` to `.gitignore` (1 line, commit `76dbf24`).** `wrangler pages dev` —
which the plan's own Level 5 recommends — writes a local cache directory. Ignoring it stops
it being committed later. Does not touch `node_modules/` or `.DS_Store`, and
`package-lock.json` is committed as required.

**5. `wrangler.toml`'s `name` is set to `saulera-dossier-engine` from Assumption #2, not
read off the dashboard** as Task 12 instructs, because there is no dashboard access. This is
the one field where the project name is not cosmetic — **a mismatch fails the build.** It is
the first item in the handoff checklist.

**6. `test` placed first in `scripts`** rather than after `spike:tamper`. Cosmetic; it is
the primary command every later ticket needs.

Also noted, no action taken: the `stackai-design` skill contradicts itself on whether
Aspekta or Geist is the body face (the philosophy section and the type-scale table
disagree). Followed the plan's `--font-ui` / `--font-body` mapping. Immaterial until #8
ships the actual font files.

## Issues encountered

- **Node version.** `wrangler@4` requires Node ≥22; the repo's default is v20.20.2. Used
  nvm's v24.11.0 for the dev server only. Nothing in the repo requires Node 22 — `npm test`
  and the SDK import both work on v20.
- **`.claude/` is untracked**, so the repo was not strictly "clean" at Task 0 as that task
  expects. Pre-existing, left alone; every commit used explicit paths, never `git add -A`.
- No blockers in the code. The residual risk is entirely where the plan predicted it: the
  Cloudflare dashboard flows.

---

## Handoff — what only you can do

The code is done. These are the plan's Tasks 6–11 plus the close-out, in order.
`DEPLOY.md` is the full runbook with reasons; this is the short form.

**Do this first — it gates PR B:**

- [ ] **Confirm the Pages project name.** `wrangler.toml` (on branch B) says
      `saulera-dossier-engine`. Whatever the Pages project ends up called, that line must
      match it exactly or the Deploy B build fails. This is the one field where the project
      name is not cosmetic.

**Then, in this order — PR A, dashboard, PR B.** The whole point of the split is that if
Deploy B's build goes red, Deploy A is already live and green, so the failure can only be
npm/bundling. Do not merge PR B early.

1. [ ] **Merge PR A** (`feature/deploy-skeleton-a` → `main`). Public shell, health Function,
       test script. No dependencies, no `wrangler.toml`.
2. [ ] **Task 6** — connect the Pages project. Framework preset None, build command empty,
       output directory `public`, root `/`.
3. [ ] **Task 7** — `POST /api/health` should answer `503 not_configured`. That is correct
       pre-secret and proves the Function is routed rather than 404ing. (A `GET` returns
       **404**, not the 405 the plan predicts — see Deviation 2.)
4. [ ] **Task 8** — Pages → Settings → General → Enable access policy. Previews only.
5. [ ] **Task 9** — the two-application dance: delete the wildcard `*` from the Subdomain
       field to convert that app to the apex, then re-enable the toggle to recreate the
       preview app. Both policies: Allow / Emails / one-time PIN / 24h. **A wildcard does
       not cover the apex — stopping at Task 8 leaves production open.**
6. [ ] **Task 10** — the acceptance test. Production, a preview hostname, and
       `POST /api/health` must all return **302** to `cloudflareaccess.com`. Any `200` is a
       failure. Retry once after 60s for edge propagation.
7. [ ] **Task 11** — `ANTHROPIC_API_KEY` as an encrypted **Secret** (not Text), for
       **Production and Preview**, then redeploy (variables apply from the next deployment —
       a `503` straight after setting the key is that, not a code bug).
8. [ ] **Merge PR B** (`feature/deploy-skeleton-b`, auto-retargeted to `main` once A merged).
       Watch the build log: confirm a dependency-install step lists `@anthropic-ai/sdk`. If
       there is no install step, set the build command to `npm ci` and redeploy.
9. [ ] Logged in through the door, from the devtools console on that origin, confirm
       `{ ok: true, service: "saulera-dossier-engine", key: true, sdk: true }`, that a
       malformed body gives `400`, and that DevTools → Network shows no `sk-ant` anywhere.
10. [ ] **Task 16** — comment on #3 with the live URL and the Task 10 output, then close it.

**If PR B's build goes red**, Deploy A is still live and serving. `sdk: false` means the
import resolved to something unexpected; a `500` means it failed to bundle; check that
Pages → Settings → Functions shows `nodejs_compat` as read-only, sourced from
`wrangler.toml`.

**Open acceptance criteria:** AC2 (Pages project), AC4 (Access), AC5 (the encrypted variable
— though the *never-reaches-the-browser* half is already evidenced locally).
**Met:** AC1, AC3, AC6.
