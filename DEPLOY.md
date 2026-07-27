# Deploy — saulera dossier engine on Cloudflare Pages

Static `public/` plus one Pages Function, behind Cloudflare Access. No build step, no
framework. Push to `main` → Cloudflare Pages deploys.

This is written as a checklist because the second agency deployment should not be a memory
test. The reasons matter as much as the clicks — particularly step 3, which looks like
something you could simplify and cannot.

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

**Why the build command is empty.** Pages installs dependencies itself when it sees a
`package.json`, and bundles `functions/` with esbuild including npm imports. If a deploy
log ever shows no install step, set the build command to `npm ci` and redeploy.

**`functions/` stays at the repo root**, not inside `public/`. Pages resolves it from the
project root, separately from the output directory. Moving it under `public/` publishes the
Function source as a static file and it never runs.

**The project name is load-bearing in one place.** `wrangler.toml`'s `name` must match the
Pages project exactly or the build fails. Read it off the dashboard rather than assuming.

Smoke test — before Access is enabled, the Function should answer and say it is
unconfigured. That 503 is the correct pre-secret answer and proves the Function is routed
rather than 404ing:

```bash
PROJECT=<project>
curl -s -o /dev/null -w '%{http_code}\n' "https://$PROJECT.pages.dev/"            # 200
curl -s -X POST "https://$PROJECT.pages.dev/api/health" \
  -H 'content-type: application/json' -d '{}' -w '\n%{http_code}\n'               # {"error":"not_configured"} 503
curl -s -o /dev/null -w '%{http_code}\n' "https://$PROJECT.pages.dev/api/health"  # 405 (GET, no handler)
```

---

## 2. Access — the preview application

Pages project → **Settings** → **General** → **Enable access policy**.

This creates one Access application covering `*.<project>.pages.dev` — **preview
deployments only**. Do not stop here. Cloudflare's own documentation is explicit that the
toggle "applies only to preview deployments (hash-based URLs), not to your `*.pages.dev`
domain or custom domains." Stopping here leaves production wide open.

---

## 3. Access — the production application

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

## 4. Verify the door actually closes

This is the acceptance test, not the dashboard screenshot. An unauthenticated request to
**either** hostname must be redirected to Cloudflare Access.

```bash
PROJECT=<project>
PREVIEW=<hash>.$PROJECT          # a real preview hostname from Pages → Deployments

curl -s -o /dev/null -w 'prod:    %{http_code}  %{redirect_url}\n' "https://$PROJECT.pages.dev/"
curl -s -o /dev/null -w 'preview: %{http_code}  %{redirect_url}\n' "https://$PREVIEW.pages.dev/"
curl -s -o /dev/null -w 'api:     %{http_code}  %{redirect_url}\n' \
  -X POST "https://$PROJECT.pages.dev/api/health" -H 'content-type: application/json' -d '{}'
```

All three must be a **302** whose `redirect_url` contains `cloudflareaccess.com`.

A `200` on any of the three is a failure. A `200` on production with a `302` on preview is
the specific failure this whole section exists to prevent — it means step 3 was skipped.

Access applies at the edge and takes a minute or two to propagate. Retry once after 60
seconds before treating a `200` as real.

---

## 5. The secret

Pages project → **Settings** → **Variables and Secrets** → add `ANTHROPIC_API_KEY`.

- Type **Secret**, not plaintext Text. A plaintext variable stays readable in the dashboard
  afterwards; an encrypted one does not.
- Add it for **Production and Preview**. Production-only means preview deployments answer
  `503 not_configured` — defensible, but decide it rather than discover it when a branch
  needs smoke-testing.
- **Variables apply from the next deployment.** Setting the secret does not affect the
  deployment already running. Trigger a redeploy (Deployments → Retry deployment) or push.
  A `503` immediately after setting the key is this, not a code bug.

`wrangler.toml` does not affect secrets — it is source of truth for `compatibility_date`
and `compatibility_flags` only, and once it exists those fields go read-only in the
dashboard. That is intended: `nodejs_compat` is engine config and belongs in the repo.

Verify from inside the door — log in in a browser, then in the devtools console **on that
origin**, so the Access cookie is sent:

```js
await (await fetch('/api/health', {method:'POST', headers:{'content-type':'application/json'}, body:'{}'})).json()
// { ok: true, service: "saulera-dossier-engine", key: true, sdk: true }

(await fetch('/api/health', {method:'POST', headers:{'content-type':'application/json'}, body:'not json'})).status
// 400
```

Then DevTools → Network → reload → check the document, `tokens.css` and the `/api/health`
response: **no body or header contains `sk-ant`.**

Do this authenticated or not at all. Once Access is on, `curl … | grep sk-ant` only ever
sees Cloudflare's login page, so it passes whether or not the key leaks — false assurance
on the one constraint that has to hold.

---

## 6. Smoke-test checklist

- [ ] `https://<project>.pages.dev/` in a private window → Access login page
- [ ] Allowed email → PIN arrives (check Spam/Promotions) → placeholder page renders
- [ ] `tokens.css` loads; card renders on the neutral palette, no off-palette colour
- [ ] A preview hostname also shows the login page
- [ ] `POST /api/health` authenticated → `{ ok: true, key: true, sdk: true }`
- [ ] `POST /api/health` with a malformed body → `400 bad_json`
- [ ] No `sk-ant` in any response body or header
- [ ] Pages → Deployments → newest build log lists `@anthropic-ai/sdk` in an install step
- [ ] Zero Trust → Applications shows exactly two for this project, both Allow / one-time PIN
- [ ] Mobile: 375px width, no horizontal scroll

---

## Deliberately deferred

- **Custom domain.** `<project>.pages.dev` is enough until an agency is real. Whose domain
  it should be — saulera's or the agency's — is a branding decision, not a DNS one.
- **`_headers`.** The marketing site ships security headers; here Access already fronts
  everything and there is no real UI yet. Worth adding when there is (#8).
- **Web fonts.** `public/tokens.css` declares `--font-*` with `system-ui` fallbacks; the
  `.woff2` files land with the recruiter screen (#8).
- **An Access service token.** Would make the Function curl-able from CI and is genuinely
  useful once generation latency needs measuring automatically. Raise it at #6.
