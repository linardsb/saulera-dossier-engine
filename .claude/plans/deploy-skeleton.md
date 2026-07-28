# Feature: Deploy skeleton — repo scaffold, Pages project, Access door, secrets pattern

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

> **⚠️ The repo already exists and is not empty.** `~/Desktop/saulera-dossier-engine` is a live git repo with 4 commits, a working `src/` (pack contract, provenance verifier, both renderers), a `spike/` harness, and 11 passing tests. This is a **delta plan**, not a greenfield one. Read the "Current state vs. acceptance criteria" table before touching anything.

## Feature Description

Stand up the deployment shell for the submission dossier engine and nothing else: a URL that loads behind a Cloudflare Access door, one Pages Function that answers, the `ANTHROPIC_API_KEY` secret wired server-side, and the engine-vs-config split written down. No product logic, no generation, no UI beyond a placeholder.

This is the **only safe pre-Tuesday build**. Its justification is architecture §6.1's own carry-over list — *"Carried over: the stack, the deploy shape, the Access door, the secrets pattern, the engine-and-config split"* — which is exactly this ticket's scope and nothing more. PRD §4 says of Tuesday: *"Hand-run only… Build nothing."* This ticket is the exception because none of it is wasted on either branch of §6.1. Anything beyond it is.

## User Story

As **saulera, building a tool that will accept a client's candidate CVs**
I want **a deployed URL behind a governance-grade front door with the model key held server-side**
So that **every later ticket has somewhere to land, and nothing about the deploy shape has to be re-litigated after Tuesday's discovery visit**

## Problem Statement

There is working engine code (`src/`) and a validated prompt, but nowhere to run it. Every downstream ticket (#4 pack contract, #5 client store, #6 generation Function, #7 renderers, #8 the one screen) assumes a Pages project, a Function boundary, and a secret that never reaches the browser. Without those, #6 in particular cannot even measure generation latency — the one spike deliverable that was deferred for exactly this reason.

There is also a date gate. The discovery visit is **Tuesday 28 July 2026**; the Thursday-30-July one-pager follows. Anything built before Tuesday that Tuesday could invalidate is waste. The deploy shell is the only layer §6.1 guarantees survives either branch.

## Solution Statement

Ship the shell in two independently-verifiable deploys:

1. **Deploy A — the door.** Add a `public/` build output with a placeholder page, `functions/api/health.js` mirroring the saulera Function pattern, connect a Cloudflare Pages project to the repo, enforce Cloudflare Access (email one-time PIN) on **both** the production hostname and the preview wildcard, and set `ANTHROPIC_API_KEY` as an encrypted Pages variable. Verify with `curl` that unauthenticated requests get bounced to `cloudflareaccess.com`.
2. **Deploy B — the SDK path.** Install `@anthropic-ai/sdk`, add a version-controlled `wrangler.toml` carrying `nodejs_compat`, and have `health.js` import the SDK without ever calling it. This proves the npm-dependency bundling pipeline works **now**, so #6 does not discover a bundling problem on the day it needs a latency number.

Splitting into two deploys isolates the two risks (Pages connection vs. dependency bundling) so a failure in either is diagnosable in isolation.

---

## DEPLOYMENT PLATFORM — decided: Cloudflare Pages

**Settled 27 July 2026. Architecture §5.2 stands. Execute the plan exactly as written below — no fork, no decision left for the implementing agent.**

This section exists because the question was genuinely reopened and the answer is not self-evident. It records why Pages won so it is not re-litigated at #6 or #8, and names the conditions under which it *should* be revisited.

### Why it was reopened

Cloudflare's guidance for new projects has moved since §5.2 was written:

> If you are starting a new project, use Workers instead of Pages. Pages continues to work, but new features and optimizations are focused on Workers. […] Cloudflare Pages will continue to be supported, but, going forward, **all of our investment, optimizations, and feature work will be dedicated to improving Workers.**

And §5.2's rejection was of a *different* option than the one now on the table. It rejected *"a Worker with a separate front end"* — a Worker plus a separately-hosted frontend. **Workers Static Assets** is not that: it is one Worker serving static files *and* running server code, i.e. exactly the shape Pages provides. It does not appear to have been considered.

There is also one genuine surprise in Workers' favour, worth recording because it is counter-intuitive: **Access is simpler there.** The fiddliest, most error-prone part of this plan — the two-application toggle → reconfigure → re-toggle dance in Tasks 8–9, which exists solely because a wildcard subdomain does not cover the apex — **does not exist on Workers.** One click covers production *and* preview URLs, via a shared *"Cloudflare Workers Preview URLs"* policy plus a per-Worker `<name> - Production` policy ([changelog, Dec 2025](https://developers.cloudflare.com/changelog/post/2025-12-03-reusable-access-policies/)).

### Why Pages won anyway

**1. The deadline is unconditional; the compounding benefit is not.** The PRD and architecture are explicit that this is exploration — *"written to be falsified on Tuesday, not defended"* — and §6.1 says that if the thesis dies, §4 and §5 get **re-derived rather than adapted**. Every Workers advantage is conditional on this product surviving to a second agency. §5.2's *"nothing new to learn under time pressure"* is true today regardless of what Tuesday says.

**2. The lock-in argument was wrong, and it was the strongest Workers argument.** An earlier draft of this section claimed a later platform migration costs *"one per agency plus the upstream."* **That is incorrect.** §5.1's model is *engine tracked upstream, config per agency* — precisely so engine changes propagate on a pull. A platform migration is therefore **one engine migration**, picked up by each agency on a pull plus a redeploy (a dashboard action, not code). The lock-in is far weaker than claimed, and once that falls the Workers case reduces to "Cloudflare's roadmap points there" — real, but not urgent.

**3. Access on Pages is known-good; on Workers it is inferred.** The workers.dev docs say to *"validate the Access JWT in your Worker script using the audience (`aud`) tag and JWKs URL provided."* Read literally that is **auth code**, which AC4 forbids outright (*"no auth code written"*). Read in context it is almost certainly standard defence-in-depth advice Cloudflare gives for *all* Access-protected origins — guarding against reaching an origin directly and bypassing Cloudflare, which a Worker has no way to do since it only ever executes on Cloudflare's edge. **That reasoning is probably right and it is still only reasoning.** On a URL that accepts candidate CVs, the day before a client meeting, documented-and-already-working beats probably-fine.

**4. AC3 names the Pages API verbatim.** It specifies `onRequestPost(context)`. Choosing Workers means adapting a written acceptance criterion on day one and hand-rolling routing that Pages provides free.

**5. The Workers-only features are not needed.** Pages Functions support KV / D1 / R2 bindings, so #5's event counter (client, timestamp, duration — non-personal, tiny) is fine on Pages. **Cron Triggers are genuinely Workers-only**, and nothing in #4–#9 needs them.

### What this costs, stated plainly

Being on a platform Cloudflare will not add features to. For this product that is close to free — it needs one Function boundary and some static files, and Pages is **not deprecated**: the migration guide treats it as actively supported, and it will keep receiving security patches and support. The concrete price paid is the two-application Access dance, which is the fiddliest thing in this plan.

### Revisit if — and only if

Do not reopen this on general principle. Reopen if one of these becomes true:

- A **Cron Trigger** is needed (the one capability Pages genuinely lacks and Workers has).
- **Durable Objects** become necessary — Pages can *bind* to them but cannot define the classes.
- A second agency is real **and** the deploy shape is causing friction, i.e. the compounding argument stops being hypothetical.
- Cloudflare announces a Pages **end-of-life date**, as opposed to the current "no new investment."

Migration when that day comes: one engine migration, not N. `functions/api/*.js` become routes in a single `fetch` handler; `public/` becomes `assets.directory`; the two Access applications collapse to one toggle. **Keep Task 10's curl verification exactly as written whatever the platform** — verify production *and* a preview URL. The verification is the acceptance criterion; the setup is just plumbing.

---

## Out of Scope / Non-Goals

Bounded hard by architecture §6.1. This ticket ships foundations that survive Tuesday; it ships nothing that Tuesday could invalidate.

- **Not included: any model call.** `health.js` imports the SDK; it never constructs a client or calls `/v1/messages`. Generation is #6.
- **Not included: the pack contract, verifier hardening, or renderers as HTTP surfaces.** `src/` stays exactly as it is — library code with no route wired to it. #4 and #7 own those.
- **Not included: the client knowledge store, its editor, or the event counter.** That is #5, and it is Tuesday-contingent (architecture §6.5 says ship the note, but only after seeing the day).
- **Not included: the one screen.** #8 owns the recruiter UI. This ticket ships a static placeholder, not a product surface.
- **Not included: a custom domain.** `<project>.pages.dev` is sufficient for a pre-Tuesday shell and avoids DNS work that Tuesday might redirect. Add a domain when an agency is real.
- **Not included: an identity provider.** §5.6 is explicit — email one-time PIN, "no identity provider to integrate, no code to write."
- **Not included: a `.docx` renderer** (#9, contingent on Tuesday saying attachment) or any ATS integration.
- **Not included: web fonts.** The design token layer defines `--font-*` tokens; the actual `.woff2` files are deferred to #8. See Open Questions.
- **Not changing:** the saulera marketing repo. §5.1 rules out a path on `saulera.com` — routing candidate CVs through the marketing domain is "the wrong thing to have to explain to a trust." Nothing in this plan touches `~/Desktop/saulera`.
- **Not changing:** `src/`, `spike/`, or `test/`. They are already committed and green (11/11). Leave them alone.

## Feature Metadata

**Feature Type**: New Capability (infrastructure foundation)
**Estimated Complexity**: Low–Medium. The code is small; the risk is concentrated in two Cloudflare dashboard flows (Pages Git connection, Access two-application setup) that cannot be scripted and must be verified empirically.
**Primary Systems Affected**: New Cloudflare Pages project · Cloudflare Zero Trust (Access) · `saulera-dossier-engine` repo
**Dependencies**: `@anthropic-ai/sdk@^0.115.0` (the single, deliberate divergence from saulera's zero-dependency habit, per §5.2) · Cloudflare account (already holds the `saulera` Pages project and the `saulera.com` zone) · GitHub repo `linardsb/saulera-dossier-engine` (exists, `origin/main` current)

## Related Work

**Implements**: [#3 — Deploy skeleton](https://github.com/linardsb/saulera-dossier-engine/issues/3) · **Epic**: [#1 — Submission dossier engine](https://github.com/linardsb/saulera-dossier-engine/issues/1)

Architecture and PRD are **private and not in this repo** (`products/` is gitignored in the saulera repo):
- PRD: `/Users/Berzins/Desktop/saulera/products/agency-submission-dossier/agency-submission-dossier.prd.md`
- Architecture: `/Users/Berzins/Desktop/saulera/products/agency-submission-dossier/agency-submission-dossier.architecture.md`

The architecture decisions this ticket inherits (§5.1, §5.2, §5.6, §6.1) are inlined in CONTEXT REFERENCES below, so this plan is executable without the docs to hand.

**Back-references** (work this builds on):

- [#2 — Spike](https://github.com/linardsb/saulera-dossier-engine/issues/2) (closed) — settled §7's decision rules: build B as specced, appendix rendering as default, density holds. Produced `src/` and `spike/`. Left **generation latency unmeasured** and routed it to #6, because it needs an API key and a deployed Function — i.e. it needs this ticket.
- `~/Desktop/saulera/functions/api/contact.js` — the Function shape being mirrored, shipped and working in production.
- `~/Desktop/saulera/DEPLOY.md` — the Pages connection runbook that worked for the marketing site.

**Forward-references** (plans that extend this):

- #6 (Generation Function) — inherits the Function boundary, the secret, and the proven SDK bundling path. Runs `spike/run.js`'s measurement server-side.
- #5, #7, #8 — inherit the Pages project, the Access door, and the design token layer.

---

## CONTEXT REFERENCES

### Relevant Codebase Files — IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

**From the saulera marketing repo (`~/Desktop/saulera`) — the pattern source, do not modify:**

- `functions/api/contact.js` (90 lines, read all of it) — **the exact shape AC #3 names.** Note the six things being mirrored: (1) a leading comment block naming the route, its contract, and which Pages secret it needs and where to set it; (2) `export async function onRequestPost(context)`; (3) `const { request, env } = context;` destructure; (4) `if (!env.X) return json({ error: "not_configured" }, 503);` **as the first statement in the handler**; (5) `try { p = await request.json(); } catch { return json({ error: "bad_json" }, 400); }`; (6) a module-local `json(obj, status = 200)` helper at the bottom returning `Content-Type: application/json` + `Cache-Control: no-store`.
- `functions/api/book.js` (lines 1–30) — confirms the same `onRequestPost` + `not_configured` + `bad_json` sequence. Two files, one pattern; follow it.
- `functions/api/slots.js` (lines 1–20) — the `onRequestGet` variant of the same shape. Read it only to confirm you are correctly choosing `onRequestPost` for health, per AC #3.
- `DEPLOY.md` (section 3, "Connect Cloudflare Pages") — the dashboard runbook that worked. Reuse the flow; the build settings differ (see GOTCHA in the task).
- `_headers` (16 lines) — the security-header convention. **Not being copied in this ticket** (see NOTES), read for context only.

**From this repo (`~/Desktop/saulera-dossier-engine`) — existing, do not modify:**

- `README.md` (all 60 lines) — you are **appending** a section, not rewriting. Read "Decisions" and "Standing constraints" first; AC #6's engine/config split must not contradict or duplicate the existing *"One deployment per agency. Engine tracked upstream, config per client. Not multi-tenant SaaS."* line under Standing constraints. Expand it into a real section; leave the one-liner or fold it in, but do not leave two half-statements.
- `package.json` (11 lines) — `type: "module"`, `private: true`, two `spike:*` scripts, **no `dependencies` key and no `test` script.** You are adding both.
- `.gitignore` (2 lines: `node_modules/`, `.DS_Store`) — already correct for this ticket. **Do not add `package-lock.json`** — Pages needs the lockfile committed for a reproducible install.
- `test/smoke.test.js` (11 tests, all passing as of this plan) — your regression baseline. Run it before and after; the count must stay 11/11.
- `spike/run.js` (60 lines) — read it to see exactly how #6 will use the SDK: `client.messages.stream({ model: "claude-opus-5", max_tokens: 32000, system: SYSTEM, output_config: { effort, format }, messages })`. This is *why* the SDK must be proven to bundle now.
- `src/pack.js`, `src/provenance.js`, `src/render/index.js` — untouched by this ticket. Do not import them from `functions/`.

### New Files to Create

- `public/index.html` — placeholder page, the "URL that loads behind the Access door"
- `public/tokens.css` — stackai-design token layer as CSS custom properties (the durable design artifact; #8 inherits it)
- `functions/api/health.js` — the one Function that answers
- `wrangler.toml` — `pages_build_output_dir`, `compatibility_date`, `nodejs_compat` (added in Deploy B only)
- `package-lock.json` — generated by `npm install`, **must be committed**
- `DEPLOY.md` — the Cloudflare runbook for this repo (Pages settings, Access two-app setup, secrets), so a second agency deployment is a checklist not a memory test

### Relevant Documentation — YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [Cloudflare Pages — Known issues](https://developers.cloudflare.com/pages/platform/known-issues/)
  - Section: enabling Access for the `*.pages.dev` domain **and** preview deployments
  - Why: **This is the load-bearing document for AC #4.** It is the only place that spells out the two-application dance. Read it before touching Zero Trust.
- [Cloudflare Pages — Preview deployments](https://developers.cloudflare.com/pages/configuration/preview-deployments/)
  - Section: restricting access; branch-alias and commit-hash hostnames
  - Why: confirms the built-in toggle covers **preview deployments only** — *"This restriction applies only to preview deployments (hash-based URLs), not to your `*.pages.dev` domain or custom domains."* This is exactly the gap AC #4 calls out.
- [Cloudflare One — Application paths (wildcards)](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/)
  - Section: wildcard rules
  - Why: **kills the obvious shortcut.** Quote: *"A wildcard in the Subdomain field only matches that specific subdomain level. It does not cover the apex domain."* So one app on `*.<project>.pages.dev` does **not** protect `<project>.pages.dev`. Two applications are required. Blog posts claiming otherwise are wrong.
- [Cloudflare Pages — Functions configuration (wrangler)](https://developers.cloudflare.com/pages/functions/wrangler-configuration/)
  - Section: minimal config, inheritable keys
  - Why: `pages_build_output_dir` is **required**; `compatibility_date` and `compatibility_flags` are inheritable and apply to preview + production unless overridden. **Also the gotcha:** once the file exists it is the source of truth and *"you can not edit the same fields in the dashboard."*
- [Cloudflare Workers — Node.js compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/)
  - Section: `nodejs_compat` flag
  - Why: requires `compatibility_date` **≥ 2024-09-23** to also enable `nodejs_compat_v2`. An older date silently gives you the weaker v1 polyfill set.
- [`@anthropic-ai/sdk` on npm](https://www.npmjs.com/package/@anthropic-ai/sdk)
  - Current version at time of writing: **0.115.0**. Cloudflare Workers is a listed supported runtime.
- [claude-api skill — TypeScript/JS reference](#) (loaded in-session)
  - Why: confirms `claude-opus-5` is the model id, `output_config.format` (not the deprecated `output_format`), and that streaming is required for the `max_tokens: 32000` `spike/run.js` uses. Relevant to #6, not to this ticket's code — but it is why the SDK must bundle.

### Patterns to Follow

**Function shape (mirror `contact.js` exactly).** Structure, comment style, and error vocabulary:

```js
// POST /api/health   { }  →  { ok: true, ... }
// <what it does, in one or two lines>
//
// Needs one Pages secret (Dashboard → Workers & Pages → <project> → Settings → Variables):
//   ANTHROPIC_API_KEY — an Anthropic API key (sk-ant-...). Never reaches the browser.

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.ANTHROPIC_API_KEY) {
    return json({ error: "not_configured" }, 503);
  }

  let p;
  try {
    p = await request.json();
  } catch {
    return json({ error: "bad_json" }, 400);
  }

  // ...

  return json({ ok: true }, 200);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
```

**Error vocabulary — reuse these exact strings, do not invent new ones:** `not_configured` (503), `bad_json` (400), `missing_fields` (400), `upstream_unreachable` (502), `send_failed` (502). Health only needs the first two.

**Comment voice.** The existing Functions explain *why*, and name the operational fact a future reader needs (which secret, set where, what breaks without it). Match that. Do not write `// destructure env from context`.

**Naming.** Files kebab-case, JS identifiers camelCase, module-local helpers unexported at the bottom of the file. `src/` uses named exports (`assertPack`, `verifyPack`, `provenanceSummary`) — Functions do not export anything but their `onRequest*` handlers plus module-local helpers.

**Design tokens (stackai-design).** Every colour, size, radius, and font goes through a CSS custom property — this is a standing repo decision (README: *"Every colour, type and radius value goes through CSS custom properties from day one, so an agency's branding is a variable swap and never a fork"*), and stackai-design supplies the concrete default values:

```css
:root {
  /* colour */
  --background:   #ffffff;
  --surface:      #f5f5f5;
  --text-primary: #1d1d1d;
  --text-muted:   #8c8c8c;
  --accent:       #0099ff;
  --border:       #595959;
  --success:      #22c55e;
  --warning:      #c68a0b;
  --danger:       #78350f;

  /* type — font files deferred to #8; tokens exist now so that is a one-file change */
  --font-ui:   "Aspekta 500", system-ui, -apple-system, sans-serif;
  --font-body: "Geist", system-ui, -apple-system, sans-serif;
  --font-mono: "DM Mono", ui-monospace, SFMono-Regular, monospace;

  /* provenance status — the product's core UX distinction, tokenised now so #8
     inherits it rather than inventing colours at the point of building the screen.
     See "UX foundation for #8" in NOTES for why these three exist. */
  --verified:   var(--success);
  --unverified: var(--warning);
  --failed:     var(--danger);

  /* 4px grid */
  --space-1: 4px;  --space-2: 8px;  --space-3: 12px; --space-4: 16px;
  --space-6: 24px; --space-8: 32px; --space-12: 48px;

  --radius: 9px;
  --max-width: 1024px;
}
```

Rules from the skill that bind here: **4px grid — every dimension is a multiple of 4.** Default radius `9px`. Container max-width `1024px`, centred. `#0099ff` is the only pop of colour, reserved for CTAs / links / focus rings. **No blur or backdrop-blur.** **No invented hex values.** Focus states use `outline`, not `box-shadow`. Always include `@media (prefers-reduced-motion: reduce)`.

**Prose voice.** `README.md` and `spike/README.md` set it: plain sentences, decisions stated with their reason and date, no marketing register. Match it in the README and DEPLOY.md additions.

---

## IMPLEMENTATION PLAN

Phases run top to bottom. Phases 1–3 are one deploy; Phase 4 is a second, separate deploy. The split is deliberate — see Solution Statement.

### Phase 1: Local scaffold (Deploy A code)

Everything that can be written and verified without touching Cloudflare.

**Tasks:**
- Create `public/` as the build output directory, containing `index.html` and `tokens.css`
- Create `functions/api/health.js` mirroring `contact.js`, **without** the SDK import
- Add a `test` script to `package.json`
- Commit and push

### Phase 2: Cloudflare Pages project

**Depends on:** Phase 1 (there must be something on `origin/main` to deploy)

**Tasks:**
- Connect a Pages project to the GitHub repo, build command empty, output directory `public`, root directory `/`
- Confirm the first deploy succeeds and the placeholder page renders
- Confirm `POST /api/health` returns `503 not_configured` (the secret is not set yet — this is the correct pre-secret answer and proves the Function is live)

### Phase 3: Access door + secret

**Depends on:** Phase 2 (there must be a deployment to protect)

**Independent of:** each other — the Access setup and the secret can be done in either order, but **verify Access before adding the secret** so you are never briefly serving an unprotected URL that holds a key.

**Tasks:**
- Enable the built-in Pages access policy (covers preview deployments)
- Convert that application to cover the production apex, then re-enable the built-in toggle to recreate the preview application — two applications, per the Known Issues runbook
- Set both policies to Allow / one-time PIN with an email include rule
- Verify with `curl` that both production and a preview hostname bounce to `cloudflareaccess.com`
- Add `ANTHROPIC_API_KEY` as an **encrypted** variable for Production **and** Preview
- Redeploy, log in through the door, confirm `POST /api/health` now returns `200 { ok: true }`

### Phase 4: SDK path (Deploy B)

**Depends on:** Phase 3 (a green Deploy A is the baseline that makes a Deploy B failure diagnosable)

**Tasks:**
- `npm install @anthropic-ai/sdk`, commit `package.json` + `package-lock.json`
- Add `wrangler.toml` with `pages_build_output_dir`, a `compatibility_date` ≥ 2024-09-23, and `nodejs_compat`
- Add the SDK import to `health.js` and report a boolean, never the key
- Push, confirm the build installs the dependency and the Function still answers

### Phase 5: Documentation

**Depends on:** Phases 2–4 (write down what actually happened, not what was planned)

**Tasks:**
- `README.md` — the engine vs. config split (AC #6)
- `DEPLOY.md` — the Cloudflare runbook, including the Access two-application dance and the exact `curl` verification commands

### Phase 6: Close out

**Tasks:**
- Run the full validation battery
- Comment on #3 with the live URLs and verification output; close it

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

### Current state vs. acceptance criteria — read this first

| AC | State | What is actually left |
|---|---|---|
| 1 — `package.json` + `@anthropic-ai/sdk` | **Partial** | `package.json` exists and is correct. No `dependencies` key, no lockfile, no `node_modules`. Install the SDK. |
| 2 — Pages project connected | **Not started** | Dashboard flow; the Git-connected Pages project cannot be created from the CLI. |
| 3 — `functions/api/health.js` | **Not started** | No `functions/` directory in this repo at all. |
| 4 — Access, production **and** previews | **Not started** | Needs **two** Access applications. See the wildcard/apex gotcha. |
| 5 — `ANTHROPIC_API_KEY` server-side | **Not started** | Encrypted Pages variable, Production **and** Preview. |
| 6 — README records engine/config split | **Partial** | README has a one-line *"One deployment per agency"* under Standing constraints. Needs the actual split written out. |

### Task Format Guidelines

- **CREATE**: New files or components · **UPDATE**: Modify existing files · **ADD**: Insert new functionality · **MIRROR**: Copy pattern from elsewhere in codebase · **CONFIGURE**: Cloudflare dashboard work (not code)

---

### 0. VERIFY baseline before changing anything

- **IMPLEMENT**: Confirm the repo is clean, current with origin, and the tests pass. You need a known-green starting point or a later failure is unattributable.
- **VALIDATE**:
  ```bash
  cd ~/Desktop/saulera-dossier-engine && \
    git status --porcelain && \
    git fetch origin && git status -sb | head -1 && \
    node --test test/ 2>&1 | grep -E '^# (pass|fail)'
  ```
  Expect: no output from `git status --porcelain`, branch `## main...origin/main` with no ahead/behind, `# pass 11` and `# fail 0`.
- **GOTCHA**: If anything is dirty or ahead/behind, stop and resolve it. Do not build a deploy on top of uncommitted state.
- **SATISFIES**: prerequisite for all

---

### 1. CREATE `public/tokens.css`

- **IMPLEMENT**: The stackai-design token layer as CSS custom properties on `:root`. Colour, type, 4px spacing scale, radius, container width — exactly the block in "Patterns to Follow" above. Add a short comment at the top saying these are the **default** tokens and that per-agency branding is a variable override, never a fork.
- **PATTERN**: The token names and values come from the `stackai-design` skill (Color System, Typography, Spacing & Layout sections). The custom-property-only discipline comes from `README.md` → Decisions → "Visual base". The three `--verified` / `--unverified` / `--failed` aliases exist because provenance status is this product's core UX distinction — see "UX foundation for #8" in NOTES. Defining them now costs three lines and stops #8 inventing status colours at the point of building the screen.
- **IMPORTS**: none (plain CSS, no build step)
- **GOTCHA**: Do **not** add `@font-face` rules or font files in this ticket — the `--font-*` tokens fall back to `system-ui` for now and #8 adds the `.woff2` files. Do **not** invent hex values outside the stackai palette. Do **not** use any dimension that is not a multiple of 4px.
- **VALIDATE**: Assert the invariant the repo actually depends on — *every colour is a custom property, and no literal hex appears outside `:root`* — rather than pinning the stackai palette itself. Pinning the nine hexes would turn a per-ticket instruction into a permanent constraint on a repo whose stated property is "branding is a variable swap, never a fork."
  ```bash
  cd ~/Desktop/saulera-dossier-engine && \
    grep -c -- '--' public/tokens.css && \
    awk '/^:root/{inroot=1} inroot&&/}/{inroot=0;next} !inroot && /#[0-9a-fA-F]{3,6}/{print FILENAME":"NR": "$0; found=1} END{exit found}' public/tokens.css && \
    echo "tokens ok — every colour is a custom property, no literal hex outside :root"
  ```
- **SATISFIES**: enables AC #2 (something to serve); lays the #8 foundation the design direction requires

---

### 2. CREATE `public/index.html`

- **IMPLEMENT**: A single self-contained placeholder page. Links `tokens.css`. States what this deployment is (the saulera submission dossier engine), that it is behind Cloudflare Access, and that no product surface exists yet. Centred card, `max-width: var(--max-width)`, `border-radius: var(--radius)`, `border: 1px solid var(--border)`, `background: var(--surface)`. Include `<meta name="robots" content="noindex, nofollow">`.
- **PATTERN**: stackai-design Card pattern (`background: #f5f5f5; border: 1px solid #595959; border-radius: 9px; padding: 16px`) — but every value referenced through the token, never the literal.
- **IMPORTS**: `<link rel="stylesheet" href="/tokens.css">`
- **GOTCHA**: Keep it genuinely minimal — this is a placeholder, not the screen. #8 owns the real UI. Include the reduced-motion guard even though there is no motion yet, so the habit is in the file from day one:
  ```css
  @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; } }
  ```
- **VALIDATE**:
  ```bash
  cd ~/Desktop/saulera-dossier-engine && \
    grep -q 'tokens.css' public/index.html && \
    grep -q 'noindex' public/index.html && \
    ! grep -nE 'style="[^"]*#[0-9a-fA-F]{3,6}' public/index.html && \
    echo "index ok — token-driven, noindex set"
  ```
- **SATISFIES**: AC #2, AC #4 (there must be a page to put behind the door)

---

### 3. CREATE `functions/api/health.js` (no SDK yet)

- **IMPLEMENT**: `export async function onRequestPost(context)` mirroring `contact.js`. In order: destructure `{ request, env }`; return `json({ error: "not_configured" }, 503)` if `!env.ANTHROPIC_API_KEY`; parse the body in `try/catch` returning `bad_json` 400; return `json({ ok: true, service: "saulera-dossier-engine", key: true }, 200)`. Module-local `json()` helper at the bottom. Leading comment block naming the route, the secret, and where to set it.
- **PATTERN**: `~/Desktop/saulera/functions/api/contact.js` — read the whole file first, then mirror lines 14–30 and 84–90 structurally.
- **IMPORTS**: none in this task (the SDK import lands in Task 12)
- **GOTCHA — the key must never leave the server.** Report `key: true` (a boolean derived from presence), never the value, never a prefix, never a length. AC #5 is a hard constraint and there is no reason to leak a hint.
- **GOTCHA — POST, not GET.** AC #3 names `onRequestPost` explicitly. With only `onRequestPost` exported, Pages answers a GET with 405 automatically, exactly as `contact.js` does. Do not add an `onRequestGet` convenience handler.
- **GOTCHA — `functions/` lives at the repo root, not inside `public/`.** Pages resolves the Functions directory from the project root, separately from the build output directory. Putting it in `public/` publishes your Function source as a static asset and it will not run.
- **VALIDATE**:
  ```bash
  cd ~/Desktop/saulera-dossier-engine && \
    node --check functions/api/health.js && \
    grep -q 'onRequestPost' functions/api/health.js && \
    grep -q 'not_configured' functions/api/health.js && \
    grep -q 'bad_json' functions/api/health.js && \
    grep -q 'no-store' functions/api/health.js && \
    ! grep -nE 'env\.ANTHROPIC_API_KEY' functions/api/health.js | grep -vE '!env\.ANTHROPIC_API_KEY|Boolean\(env\.ANTHROPIC_API_KEY\)' && \
    echo "health.js ok — pattern matched, key never returned"
  ```
- **SATISFIES**: AC #3, and the server-side half of AC #5

---

### 4. UPDATE `package.json` — add a `test` script

- **IMPLEMENT**: Add `"test": "node --test test/"` to `scripts`, beside the existing `spike` and `spike:tamper`.
- **PATTERN**: existing `scripts` block; keep key alignment consistent with the file's current style.
- **GOTCHA**: This is a deliberate one-line addition beyond the literal AC. Justification: every later ticket needs a regression command, `test/smoke.test.js` already exists and passes, and you are editing this file anyway for the dependency. It adds no dependency and changes no behaviour. If a reviewer objects, it is trivially revertible.
- **VALIDATE**: `cd ~/Desktop/saulera-dossier-engine && npm test 2>&1 | grep -E '^# (pass|fail)'` → `# pass 11`, `# fail 0`
- **SATISFIES**: AC #1 (partial — the file edit), plus the validation story for every later ticket

---

### 5. COMMIT and push Deploy A code

- **IMPLEMENT**: One commit: `deploy: public shell, health function, test script`.
- **VALIDATE**:
  ```bash
  cd ~/Desktop/saulera-dossier-engine && \
    git add public functions package.json && git status --short && \
    git commit -m "deploy: public shell, health function, test script" && \
    git push origin main && git status -sb | head -1
  ```
- **GOTCHA**: `git add` the specific paths, not `-A`. Nothing else should be in this commit.
- **SATISFIES**: prerequisite for AC #2

---

### 6. CONFIGURE Cloudflare Pages project

- **IMPLEMENT**: dash.cloudflare.com → **Workers & Pages** → **Create application** → **Pages** → **Connect to Git** → select `saulera-dossier-engine`. Build settings:
  - Framework preset: **None**
  - Build command: *(leave empty)*
  - Build output directory: **`public`**
  - Root directory: **`/`**

  Then **Save and Deploy**. Record the assigned `<project>.pages.dev` hostname.
- **PATTERN**: `~/Desktop/saulera/DEPLOY.md` §3 — same flow, different build settings.
- **GOTCHA — output directory is `public`, not `/`.** saulera uses `/` because it has no dependencies. This repo will have `node_modules/` after Task 11, and a root output directory would put `node_modules` inside the published asset set (Pages caps at 20,000 files). `public/` sidesteps it entirely and is the conventional Pages shape. This divergence from saulera is caused by the SDK dependency, which §5.1 already names as the deliberate divergence.
- **GOTCHA — leave the build command empty.** Pages auto-installs dependencies when it detects a `package.json`, and bundles `functions/` with esbuild including npm imports. You do not need `npm ci` as a build command. If Task 13's deploy log shows no install step, *then* set the build command to `npm ci` and redeploy.
- **VALIDATE**:
  ```bash
  PROJECT=<project>   # e.g. saulera-dossier-engine
  curl -s -o /dev/null -w '%{http_code}\n' "https://$PROJECT.pages.dev/"
  ```
  Expect `200` (the door is not up yet — that is Task 8).
- **SATISFIES**: AC #2

---

### 7. VERIFY the Function is live and correctly unconfigured

- **IMPLEMENT**: Confirm `POST /api/health` answers. The secret is not set yet, so `503 not_configured` is the **correct and expected** answer — it proves the Function executed rather than 404'd.
- **VALIDATE**:
  ```bash
  curl -s -X POST "https://$PROJECT.pages.dev/api/health" \
    -H 'content-type: application/json' -d '{}' -w '\n%{http_code}\n'
  ```
  Expect body `{"error":"not_configured"}` and status `503`.

  Also confirm the method guard:
  ```bash
  curl -s -o /dev/null -w '%{http_code}\n' "https://$PROJECT.pages.dev/api/health"   # expect 405
  ```
- **GOTCHA**: A `404` here means the Function was not picked up — check that `functions/` is at the repo root and that the root directory setting is `/`. A `200` here means the secret is already set from somewhere; investigate before proceeding.
- **SATISFIES**: AC #3

---

### ~~8. CONFIGURE Cloudflare Access — preview application~~ — DEFERRED 27 Jul 2026

> **Parked. The deployment is deliberately public.** See the "Access deferred" amendment at
> the bottom of this file for the decision, its expiry condition, and what has to happen
> before #6. Task 8 and Task 9 below are left intact rather than deleted, because they are
> the runbook for turning the door back on.

- **IMPLEMENT**: Pages project → **Settings** → **General** → **Enable access policy**. This creates one Access application covering `*.<project>.pages.dev` — i.e. **preview deployments only**.
- **PATTERN**: [Pages Known issues](https://developers.cloudflare.com/pages/platform/known-issues/) → enabling Access for `*.pages.dev` and previews.
- **GOTCHA**: Do not stop here. Per the Preview deployments doc, this toggle *"applies only to preview deployments (hash-based URLs), not to your `*.pages.dev` domain or custom domains."* Stopping here leaves production wide open — the exact failure AC #4 was written to prevent.
- **VALIDATE**: deferred to Task 10 (verify both hostnames together, once both applications exist)
- **SATISFIES**: AC #4 (partial)

---

### ~~9. CONFIGURE Cloudflare Access — production application~~ — DEFERRED 27 Jul 2026

- **IMPLEMENT**: Follow the Known Issues runbook exactly:
  1. Pages project → **Settings** → the Access policy → **Manage**
  2. Zero Trust → **Access** → **Applications** → select the application for this project → **Configure**
  3. Under **Public hostname**, **delete the wildcard `*` from the Subdomain field** → **Save**. The application now protects the apex `<project>.pages.dev`.
  4. Return to the Pages project → **Settings** → **General** → **re-select Enable access policy**. This recreates the preview application. You now have **two** applications.

  On **each** application's policy: Action **Allow**, include rule **Emails** (`linardsberzins@gmail.com`, plus any other address that must get in), login method **One-time PIN**, session duration 24 hours.
- **PATTERN**: same doc as Task 8.
- **GOTCHA — a wildcard does not cover the apex.** From the Cloudflare Access docs: *"A wildcard in the Subdomain field only matches that specific subdomain level. It does not cover the apex domain."* `*.example.com` covers `alpha.example.com` and `beta.example.com` and explicitly excludes `example.com`. Blog posts claiming a single wildcard app protects production too are wrong. **Two applications, or the front door is not a door.**
- **GOTCHA — the one-time PIN mail lands in spam.** It is sent from a `cloudflareaccess.com` address and Gmail commonly files it under Spam or Promotions. Check there before concluding the policy is broken.
- **GOTCHA — free tier ceiling.** Zero Trust free covers up to **50 users** and includes one-time PIN (verified 26 July 2026, per §5.6). The cliff at 51 is sharp: $7/user/month for *all* users, no partial billing. Irrelevant at 2–10 people; note it in DEPLOY.md so it is not a surprise later.
- **VALIDATE**: Task 10
- **SATISFIES**: AC #4

---

### ~~10. VERIFY the door actually closes — both hostnames~~ — DEFERRED 27 Jul 2026

> Nothing to verify while Tasks 8–9 are parked. `.claude/verify-deploy.sh` runs the
> pre-Access half (Task 7) and reports the Access rows as SKIPPED. When the door goes back
> on, that same script becomes this task's acceptance test with no edit.

- **IMPLEMENT**: This is the real test of AC #4. An unauthenticated request to **either** hostname must be redirected to Cloudflare Access, not served.
- **VALIDATE**:
  ```bash
  # Production apex
  curl -s -o /dev/null -w 'prod:    %{http_code}  %{redirect_url}\n' "https://$PROJECT.pages.dev/"

  # A preview deployment (get a real hash URL from the Pages dashboard → Deployments)
  PREVIEW=<hash>.$PROJECT.pages.dev
  curl -s -o /dev/null -w 'preview: %{http_code}  %{redirect_url}\n' "https://$PREVIEW/"

  # The Function must be behind the door too
  curl -s -o /dev/null -w 'api:     %{http_code}  %{redirect_url}\n' \
    -X POST "https://$PROJECT.pages.dev/api/health" -H 'content-type: application/json' -d '{}'
  ```
  Expect all three: a **302** whose redirect URL contains `cloudflareaccess.com`.

  **A `200` on any of the three is a failure.** A `200` on production with a `302` on preview is the specific failure AC #4 names — you stopped at Task 8.
- **GOTCHA**: Access is applied at the edge and can take a minute or two to propagate. Retry once after 60s before treating a `200` as a real failure.
- **SATISFIES**: AC #4 — this is its acceptance test

---

### 11. CONFIGURE `ANTHROPIC_API_KEY`

- **IMPLEMENT**: Pages project → **Settings** → **Variables and Secrets** → add `ANTHROPIC_API_KEY`, type **Secret** (encrypted), value the `sk-ant-...` key. **Add it for Production and for Preview.** Redeploy so the variable is picked up.
- **PATTERN**: §5.6 — *"The API key lives in Pages environment variables and never reaches the browser, exactly as `CAL_API_KEY` and `RESEND_API_KEY` do today."*
- **GOTCHA — Pages variables are per-environment.** Setting only Production means preview deployments answer `503 not_configured`. That is arguably correct behaviour, but decide it deliberately: set both, so a preview branch can be smoke-tested end-to-end when #6 lands.
- **GOTCHA — variables apply from the next deployment.** Setting the secret does not retroactively affect the running deployment. Trigger a redeploy (Deployments → **Retry deployment**, or just let Task 13's push do it).
- **GOTCHA — choose Secret, not plaintext Text.** A plaintext variable is readable in the dashboard afterwards; an encrypted one is not.
- **VALIDATE**: Log in through the Access door in a browser, then from the devtools console **on that origin** (so the Access cookie is sent):
  ```js
  await (await fetch('/api/health', {method:'POST', headers:{'content-type':'application/json'}, body:'{}'})).json()
  // expect: { ok: true, service: "saulera-dossier-engine", key: true }
  ```
  **Do not "verify no leak" with `curl … | grep sk-ant`.** Once Access is enabled that curl returns Cloudflare's login HTML, not your site, so it returns 0 whether or not the key leaks — false assurance on the one AC that is a hard constraint. The leak check must be **authenticated**: see Level 4 step 4, which is the AC #5 evidence.
- **SATISFIES**: AC #5 (server-side reachability half; the never-reaches-browser half is evidenced in Level 4 step 4)

---

### 12. ADD `@anthropic-ai/sdk` and prove it bundles (Deploy B)

- **IMPLEMENT**:
  1. `npm install @anthropic-ai/sdk` (expect `^0.115.0`)
  2. **Read the actual Pages project name off the dashboard**, then CREATE `wrangler.toml` at the repo root:
     ```toml
     name = "<exact project name from the Pages dashboard>"
     pages_build_output_dir = "./public"
     compatibility_date = "2026-07-27"
     compatibility_flags = ["nodejs_compat"]
     ```
  3. UPDATE `functions/api/health.js`: add `import Anthropic from "@anthropic-ai/sdk";` at the top. In the handler, **construct a client and discard it**, then report a boolean:
     ```js
     let sdk = false;
     try {
       // Constructed and discarded — this exercises the SDK's init path (which is what
       // actually needs nodejs_compat) without a single network call. See GOTCHA below.
       new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
       sdk = true;
     } catch {
       sdk = false;
     }
     ```
     Add `sdk` to the success payload. **Never call the API. Never return anything derived from the key beyond a boolean.**
- **PATTERN**: `spike/run.js` lines 12 and 29 — `import Anthropic from "@anthropic-ai/sdk";` then `const client = new Anthropic();` is exactly what #6 will do. This task proves both survive the Pages build.
- **IMPORTS**: `@anthropic-ai/sdk` (default export `Anthropic`)
- **GOTCHA — import alone does not prove enough.** A bare import that never touches the class can resolve fine without exercising the paths that actually need `nodejs_compat`; `sdk: true` and a green build would still leave #6 to hit a runtime failure. **Constructing** covers materially more of the init path at zero network cost and zero scope change. If construction throws where the import did not, you have found the problem today rather than on the day you need a latency number.
- **GOTCHA — `name` is the one place the project name is not cosmetic.** Assumption #2 says the project name is cosmetic; that holds everywhere except this field. If the dashboard project ended up named anything other than what you expected, `name` here must match it. **Read it off the dashboard — do not type it from memory.**
- **GOTCHA — `compatibility_date` must be ≥ 2024-09-23** or you get `nodejs_compat` v1 rather than v2 and lose the fuller polyfill set. Use today's date.
- **GOTCHA — the config file becomes the source of truth.** Once `wrangler.toml` exists, the matching fields *"can not be edited in the dashboard"* — they go read-only. That is the intent (nodejs_compat is *engine* config and belongs in the repo, not in per-agency dashboard state), but know it before you are surprised by a greyed-out field. **Secrets are unaffected** — `ANTHROPIC_API_KEY` stays a dashboard/encrypted variable.
- **GOTCHA — commit `package-lock.json`.** `.gitignore` currently has only `node_modules/` and `.DS_Store`, which is correct. Do not add the lockfile to it; Pages needs it for a reproducible install.
- **VALIDATE** (local, before pushing):
  ```bash
  cd ~/Desktop/saulera-dossier-engine && \
    node -e "import('@anthropic-ai/sdk').then(m => console.log('sdk', typeof m.default))" && \
    node --check functions/api/health.js && \
    node -e "console.log(require('./package.json').dependencies)" && \
    test -f package-lock.json && echo "lockfile present" && \
    npm test 2>&1 | grep -E '^# (pass|fail)'
  ```
  Expect `sdk function`, no syntax error, a `dependencies` object containing `@anthropic-ai/sdk`, `lockfile present`, `# pass 11` / `# fail 0`.
- **SATISFIES**: AC #1, and de-risks #6

---

### 13. COMMIT, push, and verify Deploy B end-to-end

- **IMPLEMENT**: Commit `deploy: anthropic sdk + nodejs_compat, proven through the health function`. Push. Watch the Pages build log.
- **VALIDATE**:
  ```bash
  cd ~/Desktop/saulera-dossier-engine && \
    git add package.json package-lock.json wrangler.toml functions/api/health.js && \
    git commit -m "deploy: anthropic sdk + nodejs_compat, proven through the health function" && \
    git push origin main
  ```
  Then in the Pages dashboard → Deployments → the new build's log: **confirm a dependency-install step ran and lists `@anthropic-ai/sdk`.**

  Then, logged in through the door, from the devtools console on that origin:
  ```js
  await (await fetch('/api/health', {method:'POST', headers:{'content-type':'application/json'}, body:'{}'})).json()
  // expect: { ok: true, service: "saulera-dossier-engine", key: true, sdk: true }
  ```
- **GOTCHA**: If the build log shows **no** install step, set the Pages build command to `npm ci` and redeploy. If the Function now 500s where it previously 200'd, the SDK import is the cause — check that `nodejs_compat` is actually applied (Pages → Settings → Functions → Compatibility flags should now show it as read-only, sourced from `wrangler.toml`).
- **GOTCHA**: `sdk: false` in the response means the import resolved to something unexpected. `500` means it failed to bundle. Both are Deploy-B-only failures — Deploy A is still green and revertible with `git revert`.
- **SATISFIES**: AC #1, AC #3, AC #5

---

### 14. UPDATE `README.md` — the engine vs. config split

- **IMPLEMENT**: Add a `## Engine and config` section. It must record three things concretely, not abstractly:
  - **What is engine** (tracked upstream, shared by every agency): `src/` (pack contract, provenance verifier, renderers), `functions/`, `public/` including the default token layer, `wrangler.toml`, the prompt and schema.
  - **What is config** (per agency, never merged upstream): client knowledge notes, branding as CSS custom property overrides, the renderer choice (inline vs. appendix — settled by the spike as an Agency-config decision, not a per-pack one), the Pages project, the Access policy and its allowed emails, and the `ANTHROPIC_API_KEY`.
  - **The mechanic**: one Cloudflare Pages project per agency; each agency's deployment tracks this repo as upstream and pulls engine improvements, rather than being re-patched in N forks. Explicitly not multi-tenant SaaS — bespoke-per-agency is the commercial shape (PRD §8) and one deployment per agency is its technical form.
- **PATTERN**: `README.md`'s existing "Decisions" section — plain sentences, decision plus reason, dated where a date matters.
- **GOTCHA**: The README already says *"One deployment per agency. Engine tracked upstream, config per client. Not multi-tenant SaaS."* under Standing constraints. **Do not leave two competing half-statements.** Either fold that line into the new section or leave it as the one-line summary and make the new section unmistakably the expansion. Read the file before writing.
- **GOTCHA**: Also update the **Status** section — it currently says *"Scaffolding only. The build starts at #3… Nothing here is deployed yet."* After this ticket that is false. Say what is deployed and what is not.
- **VALIDATE**:
  ```bash
  cd ~/Desktop/saulera-dossier-engine && \
    grep -qi 'engine and config' README.md && \
    grep -qi 'pages project per agency' README.md && \
    ! grep -q 'Nothing here is deployed yet' README.md && \
    echo "README ok"
  ```
- **SATISFIES**: AC #6

---

### 15. CREATE `DEPLOY.md` — the runbook

- **IMPLEMENT**: The Cloudflare runbook for this repo, so the second agency deployment is a checklist rather than a memory test. Sections: Pages project settings (with the `public` output-directory reason); the **Access two-application** setup written out step by step, including the wildcard-does-not-cover-apex reason; the `curl` verification block from Task 10 verbatim; secrets (both environments, Secret not Text, applies from next deploy); the Zero Trust free-tier 50-user ceiling and the sharp cliff at 51; and what is deliberately deferred (custom domain, `_headers`, web fonts).
- **PATTERN**: `~/Desktop/saulera/DEPLOY.md` — numbered steps, a smoke-test checklist at the end, the same plain voice.
- **GOTCHA**: Write down the **reasons**, not just the clicks. The next reader (possibly you in three months, possibly a second agency setup) needs to know *why* there are two Access applications, or they will "simplify" it back to one and reopen production.
- **VALIDATE**:
  ```bash
  cd ~/Desktop/saulera-dossier-engine && \
    grep -qi 'two.*application' DEPLOY.md && \
    grep -q 'cloudflareaccess.com' DEPLOY.md && \
    grep -qi 'apex' DEPLOY.md && \
    echo "DEPLOY.md ok"
  ```
- **SATISFIES**: AC #4, AC #6 (operational half)

---

### 16. COMMIT docs and close the ticket

- **IMPLEMENT**: Commit `docs: engine/config split + cloudflare runbook`. Push. Comment on #3 with the production URL, the `curl` verification output from Task 10, and the health response from Task 13. Close the issue.
- **VALIDATE**:
  ```bash
  cd ~/Desktop/saulera-dossier-engine && \
    git add README.md DEPLOY.md && \
    git commit -m "docs: engine/config split + cloudflare runbook" && \
    git push origin main && \
    gh issue view 3 --repo linardsb/saulera-dossier-engine --json state
  ```
- **SATISFIES**: all

---

## TESTING STRATEGY

This ticket is mostly infrastructure. The honest position: **most of it cannot be unit tested, and pretending otherwise produces tests that assert nothing.** The real acceptance tests are the `curl` checks against the live deployment. Weight the effort there.

### Unit Tests

The project uses `node:test` + `node:assert/strict` (see `test/smoke.test.js`). No new unit tests are required by this ticket:

- `health.js` has no branching logic worth isolating beyond what the live `curl` checks already cover (`503` unconfigured, `400` bad JSON, `200` configured), and testing it locally would require standing up a Pages Functions runtime for a handler with three branches.
- `public/*` is static.
- `src/` is untouched — its 11 existing tests are the regression guard, and **`# pass 11 / # fail 0` must hold at every commit.**

If you want local Function coverage anyway, `npx wrangler pages dev public` serves `functions/` locally — but treat that as an optional convenience, not a required task, and do not add `wrangler` as a dependency for it.

### Integration Tests

The `curl` battery in Tasks 7, 10, 11, and 13 **is** the integration test suite:

| What it proves | Command | Expected |
|---|---|---|
| Static site deploys | `curl -o /dev/null -w '%{http_code}' /` | 200 pre-Access, 302 post-Access |
| Function is routed | `curl -X POST /api/health` (pre-secret) | 503 `not_configured` |
| Method guard | `curl /api/health` (GET) | 405 |
| Access covers production | `curl -o /dev/null -w '%{redirect_url}' /` | contains `cloudflareaccess.com` |
| Access covers previews | same against `<hash>.<project>.pages.dev` | contains `cloudflareaccess.com` |
| Access covers the API | same against `/api/health` | contains `cloudflareaccess.com` |
| Secret is readable server-side | authenticated fetch | `{ ok: true, key: true }` |
| Malformed body rejected | **authenticated** fetch, `body: 'not json'` | 400 `bad_json` |
| Secret never client-side | **authenticated** DevTools Network scan for `sk-ant` | no match in any response |
| SDK constructs | authenticated fetch after Deploy B | `sdk: true` |

**Two rows above say "authenticated" in bold because the unauthenticated versions are worthless.** After Access is enabled, an anonymous request never reaches the app: a `grep sk-ant` against the login page passes trivially, and a malformed-body POST is redirected before the handler runs. Both AC #3's validation branch and AC #5's leak constraint can *only* be evidenced from inside the door.

### Edge Cases

- **Preview hostname left open** — the headline AC #4 failure. Tested explicitly in Task 10. If you only ever test production you will not catch it.
- **Secret set for Production only** — preview Functions return `503 not_configured`. Correct-looking but a trap when #6 wants to smoke-test a branch. Set both.
- **Secret set but deployment not refreshed** — variables apply from the next deployment. A `503` immediately after setting the key is this, not a code bug.
- **`node_modules` published as static assets** — prevented by `public/` as the output directory. If you ever change the output directory to `/`, this comes back.
- **Access propagation lag** — a `200` within ~60s of enabling a policy may be stale edge state. Retry once before diagnosing.
- **PIN email in spam** — Gmail files `cloudflareaccess.com` mail under Spam/Promotions. Not a policy failure.
- **SDK import breaks the build** — isolated to Deploy B by design; Deploy A stays green and `git revert` is a clean rollback.
- **`bad_json` path** — `curl -X POST /api/health -d 'not json'` must return 400, not 500.

---

## VALIDATION COMMANDS

Execute every command to ensure zero regressions and 100% feature correctness.

### Level 1: Syntax & Style

No linter or formatter is configured in this repo (deliberately — it is dependency-free apart from the SDK). Use Node's own parser:

```bash
cd ~/Desktop/saulera-dossier-engine
node --check functions/api/health.js
for f in src/*.js src/render/*.js; do node --check "$f" || echo "FAIL $f"; done
node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('package.json parses')"
```

### Level 2: Unit Tests

```bash
cd ~/Desktop/saulera-dossier-engine
npm test 2>&1 | grep -E '^# (tests|pass|fail)'
# expect: # tests 11 / # pass 11 / # fail 0
```

### Level 3: Integration Tests

```bash
PROJECT=<project>            # the assigned pages.dev project name
PREVIEW=<hash>.$PROJECT      # a real preview hostname from Deployments

# Access closes both doors — the AC #4 test
curl -s -o /dev/null -w 'prod:    %{http_code} %{redirect_url}\n' "https://$PROJECT.pages.dev/"
curl -s -o /dev/null -w 'preview: %{http_code} %{redirect_url}\n' "https://$PREVIEW.pages.dev/"
curl -s -o /dev/null -w 'api:     %{http_code} %{redirect_url}\n' \
  -X POST "https://$PROJECT.pages.dev/api/health" -H 'content-type: application/json' -d '{}'
# all three: 302, redirect_url contains cloudflareaccess.com
```

> **There is deliberately no `curl … | grep sk-ant` here.** Once Access is enabled, an unauthenticated curl returns Cloudflare's login HTML rather than your site, so that grep returns 0 whether or not the key leaks — it would be false assurance on a hard constraint. **The AC #5 leak evidence is Level 4 step 4** (authenticated Network tab), and **the AC #3 `bad_json` evidence is Level 4 step 6** — neither branch is reachable unauthenticated, so neither can be asserted from this level.

### Level 4: Manual Validation

1. Open `https://<project>.pages.dev/` in a private window → Cloudflare Access login page appears.
2. Enter the allowed email → PIN arrives (check Spam/Promotions) → enter it → the placeholder page renders.
3. Placeholder renders on the stackai token layer: white background, grey-bordered card, 9px radius, no off-palette colour.
4. **AC #5 leak evidence — this is the only valid check, and it must be authenticated.** DevTools → Network → reload → select each response (document, `tokens.css`, and the `/api/health` response) → confirm **no response body or header contains `sk-ant`**. Confirm `tokens.css` loads. An unauthenticated `curl | grep` cannot substitute for this: post-Access it only ever sees the login page.
5. DevTools console, same origin — the happy path:
   ```js
   await (await fetch('/api/health', {method:'POST', headers:{'content-type':'application/json'}, body:'{}'})).json()
   // { ok: true, service: "saulera-dossier-engine", key: true, sdk: true }
   ```
6. **AC #3 `bad_json` evidence — same console, malformed body.** This branch is unreachable everywhere else in the plan: pre-secret it is short-circuited by the `not_configured` guard, and post-secret Access blocks curl. Without this step, "validated JSON POST" is asserted by code reading alone.
   ```js
   (await fetch('/api/health', {method:'POST', headers:{'content-type':'application/json'}, body:'not json'})).status
   // 400
   ```
7. Repeat step 1 against a **preview** hostname → the login page appears there too.
8. Pages → Deployments → newest build log → a dependency-install step lists `@anthropic-ai/sdk`.
9. Zero Trust → Access → Applications → exactly **two** applications for this project: one apex, one wildcard. Both Allow / one-time PIN.
10. Mobile: 375px width, no horizontal scroll on the placeholder.

### Level 5: Additional Validation (Optional)

```bash
# Local Functions runtime, if you want it — do NOT add wrangler as a dependency
npx wrangler pages dev public
curl -s -X POST localhost:8788/api/health -H 'content-type: application/json' -d '{}'
# expect 503 not_configured locally (no secret bound)
```

---

## ACCEPTANCE CRITERIA

Mapped 1:1 to issue #3.

- [ ] **AC1** — `package.json` carries `@anthropic-ai/sdk` in `dependencies`; `package-lock.json` is committed; the SDK resolves locally (`node -e "import('@anthropic-ai/sdk')..."`)
- [ ] **AC2** — a Cloudflare Pages project is Git-connected to `linardsb/saulera-dossier-engine` and deploys on push to `main`
- [ ] **AC3** — `functions/api/health.js` returns JSON via `onRequestPost`, destructures `env` from `context`, returns `503 not_configured` when the secret is absent, validates the JSON body, and uses a module-local `json()` helper — mirroring `contact.js`. **The `400 bad_json` branch is evidenced by Level 4 step 6 (authenticated), not by code reading.**
- [ ] ~~**AC4** — Cloudflare Access with **email one-time PIN** is enforced. **Verified on both the production hostname and a preview hostname** by a 302 to `cloudflareaccess.com`. No identity provider, no auth code written.~~ **DEFERRED 27 Jul 2026 — the deployment is public by decision.** Not met, not attempted, and not counted against this ticket. Becomes a hard blocker at #6; see the amendment.
- [ ] **AC5** — `ANTHROPIC_API_KEY` is an encrypted Pages variable (Production **and** Preview), reachable from the Function, and **never** present in any client-delivered asset or response body. **Evidenced by Level 4 step 4 (authenticated DevTools Network scan) — an unauthenticated `curl | grep` does not count.**
- [ ] **AC6** — `README.md` records the engine vs. config split: engine tracked upstream, config per agency, one Pages project per agency
- [ ] All validation commands pass with zero errors
- [ ] `npm test` remains 11/11 — no regression in `src/`
- [ ] `DEPLOY.md` documents the runbook including the two-application Access setup and its reason
- [ ] Nothing outside §6.1's carry-over list was built

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] All validation commands executed successfully
- [ ] Full test suite passes (11/11)
- [ ] `node --check` clean on every changed `.js`
- [ ] Manual testing confirms the door closes on production **and** previews
- [ ] Acceptance criteria all met
- [ ] Deploy A and Deploy B are separate commits, each independently revertible
- [ ] Issue #3 commented with live URLs + verification output, then closed
- [ ] `~/Desktop/saulera` (the marketing repo) is untouched — `git status` there is clean

---

## OPEN QUESTIONS / ASSUMPTIONS

**Assumptions this plan makes:**

1. **The Cloudflare account already in use for `saulera.com` is the right one** for this project too. Separate deployments, shared account. §5.1 rules out a *path on saulera.com*, not a shared Cloudflare account.
2. **The Pages project name will be `saulera-dossier-engine`.** Cosmetic everywhere except `wrangler.toml`'s `name` field, which must match the real project exactly — read it off the dashboard in Task 12 rather than typing it from memory. Keep `$PROJECT` consistent in the curl blocks.
3. **An Anthropic API key exists** and can be pasted into the dashboard. If not, Tasks 11 and 13 stall at `503 not_configured` — which is still a valid Deploy A completion; AC #5 just stays open until the key exists.
4. **`main` is the production branch.** Every other branch produces a preview deployment, which is why AC #4's preview coverage matters.
5. **stackai-design supersedes "neutral" as the default token set** — see below.

**Questions that would change the plan if answered differently:**

0. **~~Pages or Workers?~~ CLOSED — Pages.** Settled 27 July 2026; architecture §5.2 stands. Reasoning and the revisit-if conditions are in the DEPLOYMENT PLATFORM section above. **Not a decision for the implementing agent — execute the plan as written.**

1. **stackai-design vs. the recorded "neutral" decision.** `README.md` records: *"Visual base: neutral, not the saulera Sunrise palette… A recruiter forwarding a pack to a trust should be presenting their own firm."* The instruction to use stackai-design is compatible rather than contradictory — stackai's palette *is* neutral (white / light grey / near-black with a single `#0099ff` accent), and delivering it through CSS custom properties keeps the "branding is a variable swap, never a fork" property intact. **Assumption: stackai-design becomes the concrete default token set; the neutral principle stands.** If the intent was instead to make this *look like stackai as a brand*, say so — that changes #8 materially and the README decision needs rewriting rather than refining.
2. **Web fonts now or at #8?** This plan defers the Aspekta/Geist `.woff2` files to #8 and ships `--font-*` tokens with `system-ui` fallbacks. Rationale: fonts are ~100KB of assets for a placeholder page only you will see, and §6.1 caps this ticket's scope. Adding them is one task if you want the placeholder to look right today.
3. **Should `health.js` touch the SDK at all?** A strict reading of AC #3 does not require it. The plan does it anyway (Task 12) because an installed-but-unimported dependency is never bundled, so #6 would discover any bundling problem on the day it needs a latency number — and because a bare import that never touches the class may not exercise the init paths that actually need `nodejs_compat`, the plan constructs and discards a client. Cost: five lines, zero network calls. If a reviewer considers this over-reach, drop the construct-and-discard and the `sdk` field — AC #1 is still satisfied by the install alone, and #6 inherits the risk.
4. **Service token for CLI smoke tests?** Verifying the Function past the Access door currently requires a browser login. An Access **service token** would make `POST /api/health` curl-able from CI and would be genuinely useful for #6's latency measurement. Deliberately deferred as scope. Raise it when #6 needs automation.
5. **`_headers` for the dossier engine?** saulera ships security headers (`X-Frame-Options`, `Referrer-Policy`, etc.). Not included here — Access already fronts everything and the ticket scope is tight. Worth adding when a real UI exists at #8.
6. **Custom domain?** Deferred. `<project>.pages.dev` is enough pre-Tuesday. When an agency is real, a domain decision is also a *branding* decision (whose domain — saulera's or the agency's?) and that is a Tuesday-informed call.

---

## NOTES (open canvas)

### Why two deploys instead of one

Two risks, two failure modes, one change each:

| Deploy | Risk | If it fails |
|---|---|---|
| A | Pages Git connection, build settings, Functions routing, Access configuration | Nothing about npm is involved; debug the dashboard |
| B | npm install in the build, esbuild bundling of the SDK, `nodejs_compat` | Deploy A is still green and live; `git revert` is clean |

Shipping both at once means a red build could be either, and on a Monday before a Tuesday visit that is the wrong kind of afternoon.

### Why `public/` and not the repo root

saulera publishes from `/` because it has zero dependencies — nothing hostile ends up in the asset set. This repo will have `node_modules/` after Task 12, and Pages caps a deployment at 20,000 files. Publishing from root risks either blowing that cap or shipping dependency source as static assets.

`public/` costs one directory and removes the class of problem. `functions/` stays at the repo root because Pages resolves it from the project root independently of the output directory. The divergence from saulera traces to the SDK dependency, which §5.2 already names as *"the one place the new repo diverges from saulera's zero-dependency habit, and it is a deliberate divergence."*

### The Access shape, spelled out

Two applications, because Cloudflare's wildcard semantics require it:

```
Application 1  ·  <project>.pages.dev          → production apex
Application 2  ·  *.<project>.pages.dev        → every preview deploy (hashes + branch aliases)
```

Both: Action **Allow**, include **Emails**, login method **One-time PIN**, 24h session.

The tempting shortcut — one app on `*.<project>.pages.dev` — leaves production open, because a wildcard subdomain does not match the apex. At least one widely-linked blog post claims otherwise; the Cloudflare docs are explicit that it is wrong. The `curl` check in Task 10 exists precisely because this is the kind of misconfiguration that looks fine in the dashboard.

Preview coverage is not paranoia. Preview URLs are **permanent** once created and are enumerable in the deploy history. On a URL that accepts CVs, an open preview is the same exposure as an open production, just less visible.

### What this ticket buys #6

#6 needs three things this ticket delivers and one it does not:

- ✅ a Function boundary (the single place every model call goes, per §5.6 — the boundary that keeps §6.4's data posture switchable after Thursday)
- ✅ `ANTHROPIC_API_KEY` reachable server-side
- ✅ a proven npm bundling path for `@anthropic-ai/sdk`, exercised as far as client construction (Task 12's whole purpose)
- ❌ automated CLI access past the Access door — see Open Question 4

`spike/run.js` is written and ready. It streams with `max_tokens: 32000` at `effort: "high"` against `claude-opus-5`, with a comment noting that `max_tokens` caps thinking *and* response text together. That is #6's starting point, not this ticket's.

### UX foundation for #8 — what #3 lays, what #8 owns

Source: `~/Desktop/Linards_current/UX_UI_docs/Making AI-Powered Apps Your Users Don't Hate.txt` (talk transcript, Cat / Progress Software). Its five pillars are **trust, clarity, control, transparency, meaningful benefit**, and the trust material maps onto this product almost line for line.

**#3 ships a placeholder page. None of the below is built here.** It is recorded now because #8 is where it becomes load-bearing, and because the token layer written in Task 1 is the one piece of it that has to exist from day one.

The talk's central claim about AI output is the dossier engine's entire thesis:

> "If the output can't be cited and trusted, then it's just not going to be used."

That is architecture §5.4 stated as a UX finding rather than an engineering one. Two lines are worth carrying verbatim into #8:

> "Trust but verify… they'll be able to trust the content, even if they don't choose to check every source every time."

> "[Users] need to manually verify rather than having to review everything as though it was AI generated, if that's not truly necessary."

**That second line is the design brief for the whole screen.** The provenance verifier already produces exactly this separation — every claim is either matched to a literal span or demoted to `unverified`. So the recruiter's job is *not* "re-read the pack suspiciously"; it is "check the two flagged claims." That is the difference between review-to-sendable inside the ten minutes (PRD §6 condition 2) and outside it. The mechanism exists; **#8's job is to make the separation legible at a glance**, and the failure mode is a screen that makes a recruiter re-read everything anyway.

Mapping the five pillars onto what already exists:

| Pillar | Already mechanised | #8's job |
|---|---|---|
| **Trust** | literal-quote check; `unverified` demotion (§5.4) | make verified vs unverified visible without reading — hence the `--verified` / `--unverified` / `--failed` tokens in Task 1 |
| **Transparency** | `failed_quote` is preserved on demotion, so a bad pack stays diagnosable (`test/smoke.test.js`) | surface *what the model thought it was citing*, not just that it failed |
| **Clarity** | appendix rendering settled as default by the spike | one copy action, not a menu — a per-submission chooser is friction where adoption dies in week three |
| **Control** | renderer choice is Agency config, not per-pack | recruiter edits before sending; never auto-send |
| **Meaningful benefit** | the client-knowledge note is the compounding asset | make filling the note feel like a by-product of work already happening (§6.5) |

Two things the talk recommends that this product should **not** adopt uncritically:

- *"Mark any AI generated content as AI generated."* The pack is a document a recruiter sends **as their own** to a client. A visible "AI generated" badge on the outgoing artefact would be actively wrong — it is the recruiter's submission, and §5.4's guarantee is about sourcing, not authorship. The marking belongs in the **review UI**, and must not survive into the rendered pack. The spike already settled the adjacent question (provenance goes to an appendix, not inline) for the same reason: it read as a compliance form otherwise.
- *Git-style version history.* The talk itself calls this "probably more than you will need." Architecture §9 already decided: ship strict, no pack history, treat it as a paid follow-on.

**Deliberately not used:** `UX_UI_docs/Agentic_ui.txt` (A2UI / CopilotKit / React component contracts) — wrong shape. This repo is vanilla static with no framework and no build step, and the dossier engine is not an agentic UI: it is paste-two-documents-get-one-document. `ux-factory/__UX_UI_Research.md` is a personal career operating model (Shape Up / Hooked / research / design systems) rather than product research; its Layer B (behaviour design) is worth revisiting at **#5**, where "does the note actually get filled in week one" is the open question that decides the thesis.

### The scope pressure, named

The strongest force acting on this ticket is the temptation to build slightly more — a real screen, a generation route, the client note — because the engine code already exists in `src/` and it would only take an hour. §6.1 is the answer, and it is worth re-reading before starting:

> Carried over: the stack, the deploy shape, the Access door, the secrets pattern, the engine-and-config split. Not carried over: almost everything above them.

If Tuesday says locum shift-fill rather than permanent placement, everything above that line gets re-derived rather than adapted. An hour spent on the screen today is an hour that may be worth nothing on Wednesday. An hour spent on the door is worth the same on both branches.

### Confidence

**9.5/10** for one-pass success on the code.

What is certain: the Function pattern is copied from two working production files; the tests are already green; the SDK version and import shape are verified; the Access requirement is verified against Cloudflare's own docs including the wildcard/apex rule and the two-application runbook.

The residual 0.5 is entirely in the dashboard flows — Cloudflare's Zero Trust UI has moved more than once, and the Known Issues runbook describes a slightly awkward toggle-configure-retoggle dance that may not match the current UI verbatim. **The mitigation is the `curl` check in Task 10**: whatever the UI looks like, the pass condition is unambiguous and machine-checkable — a 302 to `cloudflareaccess.com` on both hostnames, or the door is not closed.

---

## AMENDMENTS

<!-- Append-only. Newest at the bottom. Leave empty until this plan has been executed. -->

### 27 July 2026 — `GET /api/health` returns **404**, not 405

Task 7's method-guard check and the "Method guard" row of the integration table both expect
`405`. That is wrong. Verified empirically against `https://saulera.com/api/contact`, which
has the identical shape (only `onRequestPost` exported): production Pages returns **404**.
Pages does not synthesise a 405 for an unmatched method — the request falls through to
static asset handling.

No code change follows from this. AC #3 requires only `onRequestPost`, and Task 3's second
GOTCHA still stands: do not add an `onRequestGet`. Read those two `405`s as `404`.

Separately, `wrangler pages dev` answers *any* unmatched path with `index.html` at `200`
rather than 404. That is a dev-server fallback artifact, not production behaviour — do not
diagnose against it.

### 27 July 2026 — correction to the above: this project returns **200**, not 404

Measured against the real deployment once Task 6 was done:
`GET https://saulera-dossier-engine.pages.dev/api/health` → **`200 text/html`**, serving
`index.html`.

The 404 finding above is correct *for saulera.com* and does not generalise. saulera.com has a
`404.html` at its root, so an unmatched path renders it with a 404. This project's `public/`
holds only `index.html` and `tokens.css`, so Pages' asset fallback serves `index.html` at
200. The `wrangler pages dev` behaviour dismissed above as "a dev-server fallback artifact"
turns out to be exactly what production does here — it was right for the wrong reason.

Read all three predictions (405 → 404 → 200) as: **the method guard is not a guard.** Only
`onRequestPost` is exported, so Pages never rejects a GET; it just stops treating the path as
a Function.

The trap this creates is worth naming, because "health" is precisely the path an uptime
monitor GETs: a GET returns `200` with an HTML body, which reads as healthy while proving
nothing. `POST` is the only meaningful check. Cheapest fix if that matters is a
`public/404.html` (#8 will want one anyway), which restores the 404 without touching
`health.js` or adding an `onRequestGet` — still forbidden by Task 3.

### 27 July 2026 — Access deferred; the deployment is public by decision

**Decided by the user, 27 July 2026.** Tasks 8, 9 and 10 are parked and AC4 is not met.
`https://saulera-dossier-engine.pages.dev` and every preview hostname serve to anyone. No
Access application was ever created — the two the plan calls for do not exist, so there is
nothing to undo if this is reversed.

**Why it is safe today.** The whole surface is a `noindex` placeholder plus
`POST /api/health`, and `health.js` makes no model call. With no secret bound it answers
`503`; with one bound it answers `{ ok: true, key: true }`. The worst an anonymous caller
learns is whether a key is configured. No candidate data can reach it, because no route
accepts any.

**Why it stops being safe at #6.** #6 adds a route that actually calls the model. A public
deployment with `ANTHROPIC_API_KEY` bound is then a world-callable endpoint spending the
account's Anthropic credits, and — once the recruiter screen exists — a world-writable path
for pasted CVs, which the "no candidate data store" constraint is written to prevent.

**So the ordering constraint has changed.** The plan sequenced Access before the secret
(Task 11) so no unprotected URL ever held a key. With Access parked, the real gate moves:

- **Task 11 (bind the secret) is still fine** — `health.js` cannot spend anything.
- **#6 must not merge onto a public deployment.** Restore Tasks 8–9, or issue an Access
  service token, before the first route that calls the model.

**To reverse:** Tasks 8, 9 and 10 are left intact above, and `DEPLOY.md` (branch B) carries
the full runbook with reasons. `.claude/verify-deploy.sh` needs no edit — it detects Access
by redirect target and switches to the AC4 acceptance test automatically once a door exists.

**Note on tooling:** creating the applications from an agent needs a Cloudflare API token
with *Access: Apps and Policies: Edit*. The wrangler OAuth token has no Zero Trust scope —
`/access/apps` returns 403 — which is why this was a dashboard task in the first place.

### 27 July 2026 — Task 3's key-leak grep goes stale at Task 12

Task 3's allowlist covers only `!env.ANTHROPIC_API_KEY` and `Boolean(env.ANTHROPIC_API_KEY)`.
Task 12 then mandates `new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })`, which the
allowlist does not cover — so re-running the Task 3 command against the finished file flags
line 33 and fails. The two tasks disagree; the file is correct.

Add the constructor to the allowlist when re-running it post-Task-12. **Do not edit
`health.js` to satisfy the older assertion.** The invariant that matters — the key is only
ever guarded or handed to the SDK, never returned — holds either way.
