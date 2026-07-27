# Deploy — saulera dossier engine on Cloudflare Pages

`public/` served statically, plus Pages Functions over a D1 database for the client knowledge
store. No build step, no framework, no secrets.

**Nothing here calls a model.** The Functions read and write the store and do nothing else —
see **Model access** and **Pages Functions** under Decisions in `README.md`.

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
> anything — but the script is the faster path and is idempotent. Step 5b is a no-op: there
> are still no secrets on this deployment.

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

**Why the build command is empty.** There is nothing to build — `public/` is static files.
Pages still runs an install step because it sees a `package.json`; that is harmless and
produces no output in the published asset set. It stays harmless because wrangler is **not** a
devDependency: the npm scripts pin it through `npx wrangler@4.114.0`, so the CI install never
pulls platform-specific `workerd` binaries the deployment does not run.

**There is a `functions/` directory, and it lives at the repo root.** Never inside `public/`:
Pages resolves Functions from the project root, and moving it under `public/` publishes the
source as a static file where it never runs. With root directory `/`, a build log for a
correct deployment says so out loud:

```
Found Functions directory at /functions. Uploading.
✨ Compiled Worker successfully
```

Those Functions are storage only. They import from `../../src/`, which the CI build bundles
without any extra configuration and without a `_routes.json` — verified 27 Jul 2026 on a
preview build of #5.

**Node ≥22 for local wrangler use.** The CI build image is **v3**, whose default Node is
22.16.0, so nothing is needed there. Locally, `scripts/dev.py` finds a Node ≥22 for you and
tells you what to export if it cannot. Every command in this file pins the wrangler version,
because bare `npx wrangler` resolves to different versions on different Node versions.

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

## 5. D1 — the client knowledge store · ✅ DONE 27 Jul 2026 (#5)

Both databases created, the `DB` binding set on production and preview, **and both databases
migrated**. Verified the way this file means `✅ DONE` — by asking the database, not by having
run the command:

```
d1 execute dossier-engine --remote "SELECT name FROM sqlite_master WHERE type='table'"
  -> agency · clients · events · d1_migrations · _cf_KV · sqlite_sequence
d1 execute dossier-engine --remote "SELECT id, send_format, renderer FROM agency"
  -> 1 · email_body · appendix          ← the seed row the migration inserts
d1 execute dossier-engine --remote "SELECT COUNT(*) FROM clients"
  -> 0
```

`d1_migrations` is wrangler's own bookkeeping table and `_cf_KV` is Cloudflare's. Neither is
ours, which is why `test/schema.test.js` parses `migrations/*.sql` rather than `sqlite_master`.

**This section was `⚠️ PARTIAL` between 27 Jul and this migration**, because `npm run db:remote`
had deliberately not been run. It is recorded here rather than deleted: a doc that quietly
flips to DONE teaches nobody why the distinction mattered.

**The store is not serving production yet, and that is not §5's doing** — #5 is still an open
PR, so `main` carries no `functions/`. The database is ready for the merge; nothing more is
owed here.

Two databases and one binding name. **Per agency**, because the notes are that agency's own
data: they name real hiring managers and panel members.

### The fast path

```bash
export PATH="$HOME/.nvm/versions/node/v24.11.0/bin:$PATH"   # wrangler needs Node >= 22

# The one per-agency value on this page. Both scripts below read it, and both default to
# `dossier-engine`, which is saulera's own deployment — so for saulera, skip this line. Set it
# and nothing in the repo needs editing: `setup-d1.py` and `dev.py` are engine files, shared by
# every agency, and a name edited into them is the per-agency fork Decision 3 exists to prevent.
# (Set DOSSIER_D1_NAME_PREVIEW too if the preview database is not "<name>-preview".)
export DOSSIER_D1_NAME=dossier-<agency>

npx wrangler@4.114.0 d1 create "$DOSSIER_D1_NAME"
npx wrangler@4.114.0 d1 create "$DOSSIER_D1_NAME-preview"

python3 scripts/setup-d1.py <project>    # binds DB on both environments, idempotently
npm run db:remote                        # migrate production's database
npm run db:preview                       # migrate the preview database
```

`setup-d1.py` is idempotent: run it twice and the second run prints `ok` and changes nothing.
It confirms its own work with a second GET rather than trusting the PATCH.

### What the end state must be

| Where | Setting |
|---|---|
| Pages project → Settings → Bindings → **Production** | `DB` → D1 database `dossier-<agency>` |
| Pages project → Settings → Bindings → **Preview** | `DB` → D1 database `dossier-<agency>-preview` |

**Different databases on the two environments, deliberately.** A preview deploy writing real
client notes is not acceptable. If both point at the same database, that is the bug.

**The binding is not in `wrangler.toml`, and must not be put there.** A `database_id` is
per-agency config and `wrangler.toml` is engine, tracked upstream and pulled by every agency —
an id in it forks an engine file per agency and conflicts on every pull. There is a one-way
door in it too: once a field lives in that file Cloudflare stops allowing it to be edited in
the dashboard.

### Things measured on 27 Jul 2026, so you do not have to rediscover them

- **`PATCH /pages/projects/{project}` merges `deployment_configs`; it does not replace.** The
  compatibility date, the compatibility flags and the build image version all survived a PATCH
  that carried only `d1_databases`. Two fields move on their own: `env_vars` normalises from
  `null` to `{}`, and the computed `wrangler_config_hash` disappears and is recomputed on the
  next build.
- **A binding cannot be removed through that PATCH.** Both `{"d1_databases": {}}` and
  `{"d1_databases": null}` were accepted with `success: true` and left the existing binding
  standing. Removing one is a dashboard operation.
- **`wrangler d1 migrations apply` will not resolve a database by name.** `d1 list`, `d1 info`
  and `d1 execute --remote` all resolve against the account API; `migrations apply` insists on
  a config entry, on `--local` and `--remote` alike. That is why the four `db:*` npm scripts go
  through `scripts/dev.py`, which generates a throwaway config under `.wrangler/` (gitignored)
  rather than putting a binding in the tracked one.

### When it goes wrong, and what each symptom means

| Symptom | Cause | Fix |
|---|---|---|
| `503 {"error":"not_configured"}` from any `/api/*` | the `DB` binding did not resolve | re-run `scripts/setup-d1.py` and read its confirming GET; if it reports the binding present and the deployment still answers 503, bind it in the dashboard under Settings → Bindings and redeploy |
| `503 {"error":"not_migrated"}` from any `/api/*` | the binding resolved, but that database has no tables | `npm run db:remote` for production, `npm run db:preview` for previews. They are separate databases and separate operations, and both have been run |
| `200` returning the `index.html` shell instead of JSON | `functions/` was not picked up | confirm it is at the repo root and the project root directory is `/`; the build log should say `Found Functions directory at /functions` |
| the build fails with a module error | a Function could not bundle its `../../src/` imports | move the shared modules to `functions/_lib/` and re-point the imports; the tests can import from anywhere |
| `500 {"error":"internal"}` on a route that used to work | the migration did not run against this environment's database | `npm run db:remote` for production, `npm run db:preview` for previews. They are separate databases and separate operations |

**Migrate before deploying**, or the first request hits a database with no tables.

---

## 5b. Secrets · none

**There are still no secrets on this deployment.** No model call, no `ANTHROPIC_API_KEY`, no
runtime SDK. Generation happens in Claude Code on the subscription — a Pages Function cannot
use subscription auth (short-lived OAuth token in a local credential file; a Function has no
filesystem and no process to refresh it), and adding a per-token API key is a #6 decision, not
an MVP one.

The deployment does now have a **binding**, added in section 5. A binding is not a secret: it
is a reference to a resource in the same account, it carries no credential, and it is set as
project configuration rather than as an encrypted variable.

---

## 6. Smoke-test checklist

Run these authenticated — Access is on, so an unauthenticated curl only ever sees the login
page and tells you nothing about the site itself. Log in in a browser first.

- [ ] `https://<project>.pages.dev/` renders the shell and links to `/clients`
- [ ] `tokens.css` and `app.css` load; card renders on the neutral palette, no off-palette colour
- [ ] `/clients` loads, a client can be added, and a note saves and survives a reload
- [ ] `/api/clients`, `/api/events` and `/api/agency` all return JSON, not a `503`
- [ ] Mobile: 375px width, no horizontal scroll

Unauthenticated, the only thing any of these tells you is that the door is shut — Access
intercepts every path, so all four answer `302` whether the deployment is healthy or broken:

```bash
P=https://<project>.pages.dev
for u in /clients /api/clients /api/events /api/agency; do
  curl -s -o /dev/null -w "$u: %{http_code} %{redirect_url}\n" "$P$u"
done
# all four: 302 to cloudflareaccess.com. A 200 on any /api/* is a failure — the API is public.
```

Access — re-verify after any change to the applications or the policy:

- [ ] `https://<project>.pages.dev/` in a private window → Access login page
- [ ] Allowed email → PIN arrives (check Spam/Promotions) → the site renders
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
API, and step 5 already is, by `scripts/setup-d1.py`. For step 1,
`POST /accounts/{id}/pages/projects` accepts a `source` block for the Git connection, provided
Cloudflare's GitHub App can see the repo. Steps 2–4 cannot be driven by the token
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
