## Review — PR #11 · deploy B: anthropic sdk + nodejs_compat, engine/config split, runbook (#3)

**Recommendation: REQUEST CHANGES.** Two High findings, both one-to-three-line fixes. Neither is a flaw in the
approach — the SDK work is right, and the build independently reproduces green. Both are about the deployment's
*stated* posture drifting from its *actual* posture, in a PR whose whole job is to be the trustworthy record of
that posture.

The short version: `.dev.vars` is not in `.gitignore` on a **public** repo, and this is the PR that makes
`wrangler pages dev` the local loop that creates it. And `README.md` tells every future reader the deployment
sits behind Cloudflare Access, while `DEPLOY.md` — added in the same PR — opens with a banner saying Access is
off and the deployment is public.

Reviewed with fresh eyes: this session did not write the code and had not seen this repo before. As with #10,
the skill's `code-reviewer` agent has no definition at either scope (`.claude/agents/` exists in neither this
repo nor `~/.claude/`), so this is a direct clean-context review rather than a delegated one.

Read against `.claude/plans/deploy-skeleton.md` and `.claude/reports/deploy-skeleton-report.md` (both untracked,
read from disk), plus `README.md`. No `CLAUDE.md` in this repo. Documented deviations 1–6 in the report were
read as intentional decisions and are **not** treated as findings — Deviation 2 in particular (the empirically
corrected 405 → 404) is the kind of thing this process is supposed to produce.

---

### Validation

Run on `feature/deploy-skeleton-b` at `8cac4d6`. Local head matches `origin/feature/deploy-skeleton-b` exactly,
so what was reviewed is what is on the PR. #10 is **MERGED**, so GitHub has retargeted this to `main` and the
diff below is Deploy B only.

| Check | Command | Result |
|---|---|---|
| Unit tests | `npm test` | **11/11**, `# fail 0` — no regression |
| Syntax | `node --check` on `functions/api/health.js` + all `src/` files | clean |
| **Worker bundles with the SDK** | `npx wrangler pages functions build` (wrangler 4.114.0, Node 24.11.0) | **`✨ Compiled Worker successfully`** — independently reproduced |
| Mergeability | `gh pr view 11` | `MERGEABLE` / `CLEAN`, base now `main` |
| CI checks | `gh pr checks 11` | none configured on this repo |
| Lint / type-check | — | none configured (consistent with the repo) |
| Live integration | — | **not run** — needs the Pages project (Task 6, dashboard work) |
| Access verification | — | **not run**, and cannot be — Access is deferred by decision |

The bundle check is worth naming because it is this PR's central claim, and re-running it surfaced the evidence
behind Finding 4:

```
▲ WARNING  The package "node:fs" wasn't found on the file system but is built into node.
  Imported from:
   - @anthropic-ai/sdk/lib/credentials/types.mjs
   - @anthropic-ai/sdk/core/credentials.mjs
   - @anthropic-ai/sdk/lib/credentials/user-oauth.mjs
✨ Compiled Worker successfully
```

That warning is expected here — a bare `pages functions build` does not read `wrangler.toml`'s
`compatibility_flags`, so it warns about exactly the flag the file supplies. It confirms the PR's core
reasoning is correct: the SDK **does** statically import `node:` builtins, so `nodejs_compat` is genuinely
load-bearing rather than cargo-culted. It also shows precisely *where* those imports live, which is what
Finding 4 is about.

---

### Findings

#### High

**1 · `.dev.vars` is not gitignored, on a public repo — `.gitignore:1-3`**

`git check-ignore -v .dev.vars` → not ignored. The repo is public (`isPrivate: false`).

`.dev.vars` is Cloudflare's documented way to bind a secret for `wrangler pages dev`, and **this PR is what
makes that workflow the local loop** — it adds `.wrangler/` to `.gitignore` precisely because `wrangler pages
dev` is now the recommended way to exercise the Function, and the implementation report confirms the key was
bound locally as `sk-ant-localtest` to run the leak scan. The next person to do that with a real key has an
`sk-ant-...` sitting untracked in the repo root of a public repo.

The report notes every commit used explicit paths, never `git add -A`. That is a good habit, and habits are not
the control you want standing between a live Anthropic key and a public repo. The whole reason `ANTHROPIC_API_KEY`
is an encrypted Pages variable is that this key is the one secret in the system.

```gitignore
node_modules/
.DS_Store
.wrangler/
.dev.vars
.dev.vars.*
```

**2 · `README.md:12-13` states a security posture the same PR contradicts**

```
The deploy shell exists. A Cloudflare Pages project serves `public/` behind Cloudflare
Access, and `functions/api/health.js` answers with whether the model key is bound
server-side.
```

Two claims, both untrue as of this commit:

- **"behind Cloudflare Access"** — `DEPLOY.md`, added in this same PR, opens with: *"⚠️ Access is currently OFF —
  this deployment is public. Steps 2, 3 and 4 below are not done, by choice."*
- **"A Cloudflare Pages project serves `public/`"** — no Pages project is connected yet. The report lists Task 6
  as dashboard work not done, with AC2 explicitly open.

`git show --stat 8cac4d6` shows the cause cleanly: the commit that deferred Access touched `DEPLOY.md` and
nothing else. `README.md` was written one commit earlier, at `2c0e3f5`, when Access was still the plan, and did
not get revisited.

This is High rather than cosmetic because of what it composes with. `DEPLOY.md`'s deferral is a *good* decision,
carefully argued, with a hard deadline attached ("restore before #6 merges"). But the README is the file a
future reader — or a future agent picking up #6 — actually opens first, and it tells them the door is shut.
Finding 1 of the PR #10 review already reasoned about that placeholder as being "behind Access". The deferral is
only safe if it is *visible*, and right now the primary onboarding doc hides it.

The PR body says this PR gives the README "a Status section that is no longer false." It replaced one false
statement with a different one.

Suggested rewrite:

```markdown
## Status

Code-complete, not yet deployed. `public/` and `functions/api/health.js` are ready for a
Cloudflare Pages project that has not been connected yet; `DEPLOY.md` is the runbook.
`src/` — the pack contract, the provenance verifier and both renderers — is library code
with no route wired to it yet.

⚠️ **Cloudflare Access is deliberately not set up** (27 Jul 2026). When this is deployed it
will be public. That is tolerable only while the surface is a `noindex` placeholder plus a
health check that makes no model call — it must be closed before #6. See the banner in
`DEPLOY.md`.
```

#### Medium

**3 · `health.js:39` — `ok: true` is returned even when `sdk: false`**

```js
return json({ ok: true, service: SERVICE, key: true, sdk }, 200);
```

`ok` is hardcoded true, so the response is `200 {ok: true, ..., sdk: false}` when the one thing this PR exists
to prove has failed. The file's own header says the endpoint "answers whether this deployment is wired up," and
the report's troubleshooting section says `sdk: false` is *the* signal for a bundling failure — but anything
keying on the top-level `ok` reads green while that is happening.

`DEPLOY.md` already warns that `GET /api/health` returns a 200 HTML body and so "reads as healthy, proves
nothing." This is the same trap one level in: a `POST` that reads as healthy and proves less than it appears to.

Either `ok: sdk` (if `ok` means "fully wired"), or leave it and say in the header comment that `ok` covers
routing and key-binding only, and that `sdk` must be read separately. The first is one word and matches what
the comment already claims.

**4 · `health.js:33` — the `sdk` probe skips the code that needs `nodejs_compat`**

```js
new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
```

The comment justifies this as: *"a bare import can resolve without ever touching the paths that need
nodejs_compat."* The reasoning is sound, but the build output above shows the `node:fs` / `node:path` imports
come from `lib/credentials/*` and `core/credentials.mjs` — the credential-resolution chain. Passing `apiKey`
explicitly is exactly what makes that chain unnecessary, so the probe takes the one path that avoids the
modules whose presence motivates the flag.

This is not an argument for removing it — construction is still a cheaper, earlier signal than nothing, the
flag is still required for the bundle to be valid, and `messages.create()` in #6 goes through `fetch` rather
than the credential chain anyway. It is an argument that the probe de-risks less than the PR body claims
("proves the client **constructs**, not merely imports" — true, but construction is close to field assignment
here). Worth scoping the claim in the comment so #6 does not inherit false confidence, and worth remembering
that the first real `messages.create()` remains the actual test.

#### Low

**5 · `health.js:35-37` — the bare `catch` discards the only diagnostic**

```js
} catch {
  sdk = false;
}
```

`sdk: false` arrives with no reason attached, and the report's failure guidance ("`sdk: false` means the import
resolved to something unexpected") is hard to act on without the error. A `console.error` writes to the Pages
log, visible via `wrangler tail`, without touching the response body — so it costs nothing against the
never-leak-the-key constraint, and Anthropic's constructor errors do not echo the key.

```js
} catch (err) {
  console.error("SDK construction failed:", err?.message);
  sdk = false;
}
```

---

### What's good

Genuinely strong work, and most of it is in the reasoning rather than the code:

- **The two-deploy split** (Deviation 3) preserves the plan's isolation property that a single PR would have
  silently destroyed. The rationale — if B goes red, A is already live, so the cause can only be npm/bundling —
  is exactly right, and it is why this review can be confident the build claim means something.
- **Deviation 2** corrected the *plan* from live evidence: `GET /api/health` returns 404, not the 405 the plan
  predicted, verified against `saulera.com/api/contact`. Finding a factual error in your own plan and recording
  it rather than quietly coding around it is the behaviour worth keeping.
- **`DEPLOY.md` step 3** documents the two-Access-application trap with the Cloudflare doc quote showing a
  wildcard does not cover the apex. That is a real trap that a reasonable person simplifies straight into an
  open production URL.
- **The Access deferral banner** states the decision, the date, why it is tolerable now, exactly when it stops
  being tolerable, and what to do about it. Finding 2 is not a criticism of this — it is that this quality of
  disclosure exists in one file and not the other.
- **The leak scan is honest about its own limits** — noting that once Access is on, an unauthenticated curl
  grepping for `sk-ant` returns 0 whether or not the key leaks, and switching to an authenticated check. That is
  a subtle false-assurance trap, caught.
- **The engine/config split** (AC6) is the clearest statement of the commercial shape I have seen in this repo,
  and correctly places `wrangler.toml` on the engine side.
- **The lockfile is committed deliberately**, with the reasoning recorded, rather than by accident.
- **The `name` risk is flagged in the PR body itself** rather than left for a reviewer to find.

---

### Recommendation

**Request changes** — Findings 1 and 2, both small:

1. Add `.dev.vars` (and `.dev.vars.*`) to `.gitignore`. One line, and the one with real downside.
2. Rewrite `README.md`'s Status so it matches `DEPLOY.md`'s banner — no Access, no Pages project yet.

Findings 3 and 4 are worth folding in while the file is open; 5 is optional. None of them change the approach,
and the dashboard sequencing in the PR body and handoff checklist should proceed as written.

One process note, unrelated to the code: this review is posted as a **comment**, not a formal request-changes.
GitHub does not allow approving or requesting changes on your own pull request, and the authenticated account
(`linardsb`) is the PR author. Treat the recommendation above as the verdict; the merge decision is yours.
