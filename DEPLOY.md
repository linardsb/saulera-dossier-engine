# Deploy — saulera dossier engine on Cloudflare Pages

Static `public/` only — no Functions, no build step, no framework, no secrets.

**Push does not currently deploy** — see **Deploying** at the bottom. `git push` then
`./scripts/deploy.py`.

Packs are generated in Claude Code on the subscription, not by this deployment. See **Model
access** under Decisions in `README.md`.

This is written as a checklist because the second agency deployment should not be a memory
test. The reasons matter as much as the clicks — particularly step 3, which looks like
something you could simplify and cannot.

> ## ✅ Access is ON — both hostnames require a one-time PIN
>
> **Done 27 July 2026 (#12).** Two Access applications exist, and both were verified
> returning `302` to `linardsberzins.cloudflareaccess.com`:
>
> ```
> saulera-dossier-engine.pages.dev      → production apex
> *.saulera-dossier-engine.pages.dev    → every preview deploy
> ```
>
> Admitted: `linardsberzins@gmail.com`. Login method: one-time PIN. Session: 24 hours.
>
> **Created with `scripts/setup-access.py`, not by clicking.** Steps 2–4 below are still the
> canonical description of *what* the end state must be and why — read them before changing
> anything — but the script is the faster path and is idempotent. Step 5 is a no-op: there
> are no secrets on this deployment.

---

## 1. Connect the Pages project

dash.cloudflare.com → **Workers & Pages** → **Create application** → **Pages** →
**Connect to Git** → select the repo.

Build settings:

| Setting | Value |
|---|---|
| Framework preset | None |
| Build command | *(leave empty)* |
| Build output directory | `public` |
| Root directory | `/` |

**Save and Deploy.** Record the assigned `<project>.pages.dev` hostname.

**Why `public` and not `/`.** The saulera marketing site publishes from `/` because it has
no dependencies. This repo has `@anthropic-ai/sdk`, so `node_modules/` exists at build
time; a root output directory would push dependency source into the published asset set,
against a Pages cap of 20,000 files. `public/` removes the whole class of problem.

**Why the build command is empty.** There is nothing to build — `public/` is two static
files. Pages still runs an install step because it sees a `package.json`; that is harmless
and produces no output in the published asset set.

**There is no `functions/` directory.** This deployment has no Pages Functions at all — see
**Model access** under Decisions in `README.md`. If one is ever added it belongs at the repo
root, not inside `public/`: Pages resolves it from the project root, and moving it under
`public/` publishes the source as a static file where it never runs.

**The project name is load-bearing in one place.** `wrangler.toml`'s `name` must match the
Pages project exactly or the build fails. Read it off the dashboard rather than assuming.

Smoke test — both must be `200` (or `302` to Access once step 2–3 are done):

```bash
PROJECT=<project>
curl -s -o /dev/null -w '%{http_code}\n' "https://$PROJECT.pages.dev/"            # 200
curl -s -o /dev/null -w '%{http_code}\n' "https://$PROJECT.pages.dev/tokens.css"  # 200
```

**There is no `404.html` in `public/`.** Any unmatched path therefore falls through to
`index.html` at **200**, rather than returning 404. Measured 27 July 2026 — the marketing
site returns 404 for the equivalent request only because it *has* a `404.html`, so do not
generalise from it. #8 wants a `404.html` anyway; adding one changes this behaviour.

---

## 2. Access — the preview application · ✅ DONE 27 Jul 2026

Pages project → **Settings** → **General** → **Enable access policy**.

This creates one Access application covering `*.<project>.pages.dev` — **preview
deployments only**. Do not stop here. Cloudflare's own documentation is explicit that the
toggle "applies only to preview deployments (hash-based URLs), not to your `*.pages.dev`
domain or custom domains." Stopping here leaves production wide open.

---

## 3. Access — the production application · ✅ DONE 27 Jul 2026

Two applications are required. This is the fiddliest part of the deployment and the part
most likely to be "simplified" back into an open production URL.

1. Pages project → **Settings** → the Access policy → **Manage**
2. Zero Trust → **Access** → **Applications** → select this project's application →
   **Configure**
3. Under **Public hostname**, delete the wildcard `*` from the **Subdomain** field → **Save**.
   The application now protects the apex, `<project>.pages.dev`.
4. Back to the Pages project → **Settings** → **General** → re-select **Enable access
   policy**. This recreates the preview application. You now have two.

End state:

```
Application 1  ·  <project>.pages.dev      → production apex
Application 2  ·  *.<project>.pages.dev    → every preview deploy (hashes + branch aliases)
```

On **each** application's policy: action **Allow**, include rule **Emails**, login method
**One-time PIN**, session duration 24 hours.

**Or skip the clicking:** `scripts/setup-access.py` creates both applications and attaches
the policy in one go. It needs a token with **Access: Apps and Policies — Edit** (the
wrangler OAuth token will not work — it carries `pages:write` and no Access scope):

```bash
export CF_API_TOKEN=...   # dash → My Profile → API Tokens → Create Token → Custom token
./scripts/setup-access.py saulera-dossier-engine linardsberzins@gmail.com
```

It skips any domain that already has an application, so re-running is safe.

**Who is admitted** (decided 27 Jul 2026, tracked in #12):

```
linardsberzins@gmail.com
```

Sole user for now. An agency's own addresses are added to *that agency's* deployment when it
onboards — the policy and the emails it lets in are Config, not Engine, so they are never
merged upstream. See **Engine and config** in `README.md`.

**Why two, and not one wildcard.** From the Cloudflare Access docs: *"A wildcard in the
Subdomain field only matches that specific subdomain level. It does not cover the apex
domain."* So `*.<project>.pages.dev` covers every preview and explicitly excludes
`<project>.pages.dev`. Blog posts claiming a single wildcard application protects
production too are wrong. Two applications, or the front door is not a door.

**Why previews matter as much as production.** Preview URLs are permanent once created and
enumerable from the deploy history. On a URL that accepts candidate CVs, an open preview is
the same exposure as an open production, only less visible.

**The one-time PIN email lands in spam.** It comes from a `cloudflareaccess.com` address
and Gmail commonly files it under Spam or Promotions. Check there before concluding the
policy is broken.

**Free-tier ceiling.** Zero Trust free covers up to 50 users and includes one-time PIN
(verified 26 July 2026). The cliff at 51 is sharp — $7/user/month for *all* users, no
partial billing. Irrelevant at 2–10 people; worth knowing before you invite a whole agency.

---

## 4. Verify the door actually closes · ✅ DONE 27 Jul 2026

This is the acceptance test, not the dashboard screenshot. An unauthenticated request to
**either** hostname must be redirected to Cloudflare Access.

Verified 27 July 2026 — both returned `302` to `linardsberzins.cloudflareaccess.com`. Note
production lagged the preview by ~30 seconds while the apex application propagated, which
looks exactly like the step-3 failure below. Re-check before concluding anything.

```bash
PROJECT=<project>
PREVIEW=<hash>.$PROJECT          # a real preview hostname from Pages → Deployments

curl -s -o /dev/null -w 'prod:    %{http_code}  %{redirect_url}\n' "https://$PROJECT.pages.dev/"
curl -s -o /dev/null -w 'preview: %{http_code}  %{redirect_url}\n' "https://$PREVIEW.pages.dev/"
```

Both must be a **302** whose `redirect_url` contains `cloudflareaccess.com`.

A `200` on either is a failure. A `200` on production with a `302` on preview is the
specific failure this whole section exists to prevent — it means step 3 was skipped.

Access applies at the edge and takes a minute or two to propagate. Retry once after 60
seconds before treating a `200` as real.

---

## 5. Secrets · none

**There are no secrets on this deployment.** No Functions, no model call, no
`ANTHROPIC_API_KEY`. Generation happens in Claude Code on the subscription — a Pages Function
cannot use subscription auth (short-lived OAuth token in a local credential file; a Function
has no filesystem and no process to refresh it), and adding a per-token API key is a #6
decision, not an MVP one.

Kept as a numbered stub so the sections above still line up and nobody goes hunting for a
missing step.

---

## 6. Smoke-test checklist

Run these authenticated — Access is on, so an unauthenticated curl only ever sees the login
page and tells you nothing about the site itself. Log in in a browser first.

- [ ] `https://<project>.pages.dev/` renders the placeholder
- [ ] `tokens.css` loads; card renders on the neutral palette, no off-palette colour
- [ ] Mobile: 375px width, no horizontal scroll

Access — re-verify after any change to the applications or the policy:

- [ ] `https://<project>.pages.dev/` in a private window → Access login page
- [ ] Allowed email → PIN arrives (check Spam/Promotions) → placeholder page renders
- [ ] A preview hostname also shows the login page
- [ ] Zero Trust → Applications shows exactly two for this project, both Allow / one-time PIN

---

## Deliberately deferred

- **Custom domain.** `<project>.pages.dev` is enough until an agency is real. Whose domain
  it should be — saulera's or the agency's — is a branding decision, not a DNS one.
- **Cloudflare Access itself** (27 Jul 2026) — steps 2–4, per the banner at the top. Must be
  restored before #6. This is the only deferral on this list with a hard deadline attached.
- **`_headers`.** The marketing site ships security headers; there is no real UI here yet.
  The original reasoning was "Access already fronts everything" — **that no longer holds**,
  so this is now a weaker deferral than it was. Revisit alongside Access, and at #8.
- **Web fonts.** `public/tokens.css` declares `--font-*` with `system-ui` fallbacks; the
  `.woff2` files land with the recruiter screen (#8).
- **An Access service token.** Would make the Function curl-able from CI and is genuinely
  useful once generation latency needs measuring automatically. Raise it at #6 — where it is
  now one of the two acceptable ways to close the gap the banner describes.

**A note for whoever automates this.** Steps 1 and 5 can be driven from the Cloudflare REST
API (`POST /accounts/{id}/pages/projects` accepts a `source` block for the Git connection,
provided Cloudflare's GitHub App can see the repo). Steps 2–4 cannot be driven by the token
`wrangler login` issues — it carries no Zero Trust scope and `/access/apps` returns 403. That
needs a separate API token with *Access: Apps and Policies: Edit*, which is why these were
written as dashboard steps.

---

## Deploying

**Push does not trigger a build on this project.** The Pages config is correct and
Cloudflare can pull the repo on demand; what is broken is the GitHub-side push
notification. Toggling `deployments_enabled` off and on through the API does not restore it
(tried 27 Jul 2026), and re-registering needs Cloudflare's GitHub App authorization flow,
which cannot be driven from a script.

Until the repo is disconnected and reconnected in **Pages → Settings → Builds &
deployments**, this is how a push reaches production:

```bash
git push origin main
./scripts/deploy.py
```

It uses wrangler's stored OAuth token (`pages:write` — no API token needed), waits for the
build to reach a terminal stage, and exits non-zero if it fails. That last part matters: a
failed build leaves the previous deployment serving, which from the outside looks exactly
like success.
