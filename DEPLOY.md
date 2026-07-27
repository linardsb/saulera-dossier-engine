# Deploy — saulera dossier engine on Cloudflare Pages

Static `public/` plus one Pages Function. No build step, no framework. Push to `main` →
Cloudflare Pages deploys.

This is written as a checklist because the second agency deployment should not be a memory
test. The reasons matter as much as the clicks — particularly step 3, which looks like
something you could simplify and cannot.

> ## ⚠️ Access is currently OFF — this deployment is public
>
> **Decided 27 July 2026.** Steps **2, 3 and 4** below are **not done**, by choice. No Access
> application exists. `https://saulera-dossier-engine.pages.dev` and every preview hostname
> serve to anyone who has the URL.
>
> **Why that is tolerable today.** The whole surface is a `noindex` placeholder plus
> `POST /api/health`, and `health.js` makes no model call. The most an anonymous caller
> learns is whether a key is bound.
>
> **Why it stops being tolerable at #6.** #6 adds a route that actually calls the model. A
> public deployment with `ANTHROPIC_API_KEY` bound is then a world-callable endpoint spending
> the account's Anthropic credits — and once #8 ships the recruiter screen, a public path for
> pasted CVs, which the "no candidate data store" constraint exists to prevent.
>
> **So: restore steps 2–4 (or issue an Access service token) before #6 merges.** They are
> left written out below rather than deleted, because they are that restore runbook. Step 5
> (the secret) is safe to do now — `health.js` cannot spend anything.

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

Smoke test — before the secret is set, the Function should answer and say it is
unconfigured. That 503 is the correct pre-secret answer and proves the Function is routed
rather than 404ing:

```bash
PROJECT=<project>
curl -s -o /dev/null -w '%{http_code}\n' "https://$PROJECT.pages.dev/"            # 200
curl -s -X POST "https://$PROJECT.pages.dev/api/health" \
  -H 'content-type: application/json' -d '{}' -w '\n%{http_code}\n'               # {"error":"not_configured"} 503
curl -s -o /dev/null -w '%{http_code}\n' "https://$PROJECT.pages.dev/api/health"  # 200 — see below
```

**There is no method guard, and the last line is the proof.** Only `onRequestPost` is
exported, so Pages does not reject a `GET` — it stops treating the path as a Function and
falls through to static assets. With no `404.html` in `public/`, the fallback serves
`index.html` at **200**. (Measured 27 July 2026. The marketing site returns 404 for the
equivalent request only because it *has* a `404.html`; do not generalise from it.)

The trap: `health` is exactly the path an uptime monitor would `GET`, and a `GET` returns
`200` with an HTML body — reads as healthy, proves nothing. **`POST` is the only meaningful
check.** If that matters, add a `public/404.html` (#8 wants one anyway) rather than an
`onRequestGet`.

---

## 2. Access — the preview application · ⚠️ NOT DONE (deferred 27 Jul 2026)

Pages project → **Settings** → **General** → **Enable access policy**.

This creates one Access application covering `*.<project>.pages.dev` — **preview
deployments only**. Do not stop here. Cloudflare's own documentation is explicit that the
toggle "applies only to preview deployments (hash-based URLs), not to your `*.pages.dev`
domain or custom domains." Stopping here leaves production wide open.

---

## 3. Access — the production application · ⚠️ NOT DONE (deferred 27 Jul 2026)

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

## 4. Verify the door actually closes · ⚠️ NOT DONE (deferred 27 Jul 2026)

Nothing to verify while steps 2–3 are parked — today all three of these return `200` and
that is the expected result. This becomes the acceptance test the moment a door exists.

This is that acceptance test, not the dashboard screenshot. An unauthenticated request to
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

## 5. The secret · safe to do now

Pages project → **Settings** → **Variables and Secrets** → add `ANTHROPIC_API_KEY`.

> The original ordering put this *after* Access, so no unprotected URL ever held a key. With
> Access deferred that ordering no longer applies here: `health.js` makes no model call, so a
> bound key cannot be spent through it. **The gate moved to #6** — see the banner at the top.

`wrangler pages secret put ANTHROPIC_API_KEY --project-name=<project>` also works and keeps
the value off your screen, but it has **no environment flag** — it sets Production only. Use
the dashboard when you need both.

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

**While Access is off**, plain curl reaches the real deployment, so the whole check is one
command and the leak scan is genuinely meaningful:

```bash
PROJECT=<project>
curl -s -X POST "https://$PROJECT.pages.dev/api/health" \
  -H 'content-type: application/json' -d '{}'          # { ok: true, ..., key: true, sdk: true }
curl -s -o /dev/null -w '%{http_code}\n' -X POST "https://$PROJECT.pages.dev/api/health" \
  -H 'content-type: application/json' -d 'not json'    # 400
curl -s -D- "https://$PROJECT.pages.dev/" "https://$PROJECT.pages.dev/tokens.css" | grep -c 'sk-ant'   # 0
```

**When Access is back on, that last line becomes worthless and must not be trusted** — an
unauthenticated curl then only ever sees Cloudflare's login page, so the grep returns 0
whether or not the key leaks. False assurance on the one constraint that has to hold. Post-
Access the check is authenticated only: log in in a browser, then in the devtools console
**on that origin**, so the Access cookie is sent:

```js
await (await fetch('/api/health', {method:'POST', headers:{'content-type':'application/json'}, body:'{}'})).json()
// { ok: true, service: "saulera-dossier-engine", key: true, sdk: true }

(await fetch('/api/health', {method:'POST', headers:{'content-type':'application/json'}, body:'not json'})).status
// 400
```

Then DevTools → Network → reload → check the document, `tokens.css` and the `/api/health`
response: **no body or header contains `sk-ant`.**

---

## 6. Smoke-test checklist

Applies now:

- [ ] `https://<project>.pages.dev/` renders the placeholder
- [ ] `tokens.css` loads; card renders on the neutral palette, no off-palette colour
- [ ] `POST /api/health` → `{ ok: true, key: true, sdk: true }`
- [ ] `POST /api/health` with a malformed body → `400 bad_json`
- [ ] No `sk-ant` in any response body or header
- [ ] Pages → Deployments → newest build log lists `@anthropic-ai/sdk` in an install step
- [ ] Mobile: 375px width, no horizontal scroll

⚠️ Applies only once Access is restored (steps 2–4) — **all of these currently fail by
design**, and every one of them must pass before #6 merges:

- [ ] `https://<project>.pages.dev/` in a private window → Access login page
- [ ] Allowed email → PIN arrives (check Spam/Promotions) → placeholder page renders
- [ ] A preview hostname also shows the login page
- [ ] Zero Trust → Applications shows exactly two for this project, both Allow / one-time PIN
- [ ] The two `POST /api/health` rows above re-verified **authenticated**, from the browser
      console on that origin — not from curl

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
