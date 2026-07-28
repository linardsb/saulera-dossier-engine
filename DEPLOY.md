# Deploy — saulera dossier engine on Cloudflare Pages

`public/` served statically, plus Pages Functions over a D1 database for the client knowledge
store. No build step, no framework, one secret.

**One Function calls a model** (28 Jul 2026 — the owner superseded the no-key decision):
`POST /api/generate`, behind the `ANTHROPIC_API_KEY` secret in section 5b. Every other
Function reads and writes the store or serves the manual seam — see **Model access** under
Decisions in `README.md`. Without the secret the deployment still works end to end through
the recruiter's own Claude session; the Generate button says so and points there.

**Push does not currently deploy** — see **Deploying** at the bottom. `git push` then
`./scripts/deploy.py`.

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
> anything — but the script is the faster path and is idempotent. Step 5b now sets the one
> secret this deployment holds.

---

## 1. Connect the Pages project

dash.cloudflare.com → **Workers & Pages** → **Create application** → **Pages** →
**Connect to Git** → select the repo.

Build settings:

| Setting | Value |
|---|---|
| Framework preset | None |
| Build command | `npm ci` |
| Build output directory | `public` |
| Root directory | `/` |

**Save and Deploy.** Record the assigned `<project>.pages.dev` hostname.

**Why `public` and not `/`.** The saulera marketing site publishes from `/` because it has
no dependencies. This repo has `@anthropic-ai/sdk`, so `node_modules/` exists at build
time; a root output directory would push dependency source into the published asset set,
against a Pages cap of 20,000 files. `public/` removes the whole class of problem.

**Why the build command is `npm ci` and not empty.** `public/` is still static files with
nothing to build — but with **no** build command, Pages **skips the install step entirely**
("No build command specified. Skipping build step."), and the Functions bundler then cannot
resolve `@anthropic-ai/sdk`, which `functions/api/generate.js` imports. That is not a
hypothesis: build `97b7c323` failed exactly this way on 28 Jul 2026, and setting the command
to `npm ci` fixed it in the next build. `npm ci` installs from the lockfile and produces no
output in the published asset set. It stays harmless because wrangler is **not** a
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

**There is no `wrangler.toml`, deliberately (28 Jul 2026).** There used to be one carrying
the project name, `pages_build_output_dir` and the compatibility fields — and its presence
made every CI build treat the FILE as the configuration source and **replace the project's
deployment config with it**, silently wiping the D1 binding that `setup-d1.py` sets (builds
`98b86ef1` and `723453d6` both did this; the symptom is `not_configured` from every `/api/*`
right after a successful deploy). Build output, compatibility date and `nodejs_compat` now
live in the project config next to the bindings, set once per agency through the same API;
local dev passes the same values on the command line in `scripts/dev.py`. Do not reintroduce
the file without also moving the D1 binding into it — which Decision 3 forbids, so: do not
reintroduce the file.

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

## 3b. Access — the candidate-portal bypass · ✅ DONE 28 Jul 2026 (#20)

That 50-user cliff is the whole reason this section exists. An agency invites more candidates
in a quarter than Access bills for, so **architecture decision 12 rules Access out for
candidates** and a rotating invite token is their door instead. Decision 18 then says both
audiences live on one deployment. This is how those two hold together.

**Two more applications, beside the two above — not instead of them:**

| Application | Domain | Policy |
|---|---|---|
| `<project> — portal (prod)` | `<project>.pages.dev/prep` | Bypass → Everyone |
| `<project> — portal (previews)` | `*.<project>.pages.dev/prep` | Bypass → Everyone |

Both levels, for the same reason the gated pair needs two: a wildcard does not cover the apex.
The policy body is `{"decision": "bypass", "include": [{"everyone": {}}]}`, sent inline with
the application. `scripts/setup-access.py` creates all four and is idempotent, so re-running
it prints four `= … already exists` lines and changes nothing.

**Why this works — the precedence rule.** From the Cloudflare Access docs on application
paths: *"When multiple rules are set for a common root path, the more specific rule takes
precedence… no rule is inherited from `dashboard.com/eng`."* So `/prep/*` matches the bypass
application and serves publicly, while `/`, `/clients.html` and `/api/*` still match the
hostname-level application and still redirect to Access.

**Verified live on this deployment, 28 Jul 2026** (propagation was immediate):

| Path | Result |
|---|---|
| `/prep/privacy`, `/prep/login` | **200, served directly** |
| `/` , `/clients.html`, `/api/events` | 302 → `cloudflareaccess.com` |
| `/prepx`, `/prep-secret`, `/preparation` | **302 → Access** |

That third row is the one worth keeping: the bypass matches the `/prep` **path segment**, not
the string prefix, so no sibling route leaks out with the portal. (`/Prep/privacy` also
bypasses — matching is case-insensitive. Nothing sensitive lives at a case-variant path.)

```bash
P=https://<project>.pages.dev
curl -s -o /dev/null -w 'portal:  %{http_code}\n' "$P/prep/privacy"    # 200
curl -s -o /dev/null -w 'clients: %{http_code}\n' "$P/clients.html"    # 302
```

Both halves have to hold at once, which is why `.claude/verify-deploy.sh` asserts the pair
rather than either alone. Everything 302 means every candidate is locked out; everything 200
means the recruiter's tool is published.

⚠ **`public/404.html` is load-bearing here.** With no 404 page Pages falls back to
`index.html` at status 200 for any unmatched path. While the whole hostname sat behind Access
that cost nothing. The moment `/prep/*` became public, that fallback served the recruiter's
tool shell to anyone requesting `/prep/anything` — observed live before the file shipped. Do
not delete it.

⚠ **What else went public with the pages.** The bypass removes the only authentication that
stood in front of `/prep/*`, and two things behind it write to the database. Both were
reachable before only by the authenticated owner. Neither is a defect in the routes; both are
consequences of this section, so they are recorded here rather than in the code:

- **The retention sweep is now publicly triggerable.** `functions/prep/_middleware.js` awaits
  `purgeExpired` before `next()` on **every** `/prep/*` request, static assets included —
  that is decision 13's design, because Pages has no cron. `purgeExpired` is a deliberate
  full-table-scan `DELETE`: its `datetime(interview_at, '+30 days')` wrapper defeats the
  `invite_by_interview` index on purpose. Anyone can now request `/prep/privacy` in a loop and
  drive that scan. At invite-count scale with Cloudflare in front this is cheap, and the
  alternative — gating the sweep — would break the lazy-purge design. Accepted, not overlooked.
- **`POST /prep/auth/otp` is unauthenticated and unthrottled, and each call destroys the
  candidate's live code.** `issueOtp` opens with `DELETE FROM otp WHERE invite_id = ?`, so
  someone who knows a candidate's email address can request codes in a loop and invalidate
  each one faster than a person can type six digits. The magic link is single-use by design,
  so the OTP is the **only** way back in: this is a lockout of the recovery path, not a brute
  force. Brute force is not the worry — ~139k requests for a coin-flip against a fresh random
  code exhausts the Resend account long first.

  The plan turned down rate limiting on the grounds that one-live-code-per-invite *"gives the
  same protection with no new state."* **That premise is wrong** and should not be reused: it
  bounds how many codes are *valid at once*; it bounds neither how many are *issued* nor the
  total guess budget. `attempts` defaults to 0 on the fresh row, so requesting a new code
  resets the counter — the cap is five guesses **per code**, not five per invite.

**The counterweight, not yet applied:** one Cloudflare rate-limiting rule on `/prep/auth/*`
keyed on client IP covers both bullets, and belongs beside the bypass apps in
`scripts/setup-access.py`. No column, no cleanup, no code. Tracked as its own change — do not
assume it is live because this section describes it.

⚠ **Do not re-toggle** Pages → Settings → General → *Enable access policy*. The two gated
applications are untouched by any of this; the bypass pair is added beside them.

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

Since `0002_portal.sql` (#17, 28 Jul 2026) the expected table list also carries the portal's
seven: `attempt` · `candidate_role` · `competency` · `habit` · `invite` · `otp` · `question`.
A database showing only the three engine tables has not had 0002 applied — run the migrate
command below again.

`0003_note_visibility.sql` (#18) adds one more engine table, `note_visibility`. It is the
candidate-visibility allow-list on the client note: presence is permission, so an empty table
is the correct and fail-closed state for a database that has just been migrated. Seeing zero
rows there is not a sign the migration half-ran.

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
| `503 {"error":"not_configured"}` from any `/api/*` | the `DB` binding did not resolve | re-run `scripts/setup-d1.py` and read its confirming GET, then redeploy — bindings apply to the NEXT deployment; if it reports the binding present and the deployment still answers 503, bind it in the dashboard under Settings → Bindings and redeploy |
| `not_configured` appearing right AFTER a successful deploy | a `wrangler.toml` with `pages_build_output_dir` is back in the repo, and the build replaced the project config with the file's (which carries no binding) | delete the file (see section 1), re-run `scripts/setup-d1.py`, redeploy |
| `503 {"error":"not_migrated"}` from any `/api/*` | the binding resolved, but that database has no tables | `npm run db:remote` for production, `npm run db:preview` for previews. They are separate databases and separate operations, and both have been run |
| `200` returning `index.html` instead of JSON | `functions/` was not picked up | confirm it is at the repo root and the project root directory is `/`; the build log should say `Found Functions directory at /functions` |
| the build fails with a module error | a Function could not bundle its `../../src/` imports | move the shared modules to `functions/_lib/` and re-point the imports; the tests can import from anywhere |
| `500 {"error":"internal"}` on a route that used to work | the migration did not run against this environment's database | `npm run db:remote` for production, `npm run db:preview` for previews. They are separate databases and separate operations |
| `503 {"error":"no_model_key"}` from `/api/generate` only | the `ANTHROPIC_API_KEY` secret is not set in this environment | section 5b. Production and preview are set separately. The manual route works meanwhile |
| `502 {"error":"model_refused"}` from `/api/generate` | the model (and its fallback) declined the request | read the inputs for anything that reads as a security or medical-research document rather than a brief and a CV; the manual route will show Claude's own explanation |
| `502 {"error":"truncated"}` or `502 {"error":"no_pack"}` from `/api/generate` | the model's answer was cut off or was not a pack | retry once; if it repeats, generate through the manual route and keep the reply for diagnosis |

**Migrate before deploying**, or the first request hits a database with no tables.

---

## 5b. Secrets · two, `ANTHROPIC_API_KEY` and `RESEND_API_KEY`

**Superseded 28 Jul 2026 by the owner: the model call from Pages is back.** This section used
to end "if it ever comes back, this section is the one that changes, and it changes to say
there IS a secret" — this is that change. `3d72737` was restored on top of the seam;
`POST /api/generate` is the only Function that reads the key, and it remains the single
model-call boundary (architecture §5.6).

Why a key and not the subscription, still: a Pages Function cannot use subscription auth
(short-lived OAuth token in a local credential file; a Function has no filesystem and no
process to refresh it). A model call from Pages is API-key-billed by definition — roughly
15–25p per pack at Claude Opus 5 rates, a few pounds a month at this volume.

**Set it, per environment:**

1. Create the key at `console.anthropic.com` → API keys. One key per agency deployment, named
   after the Pages project, so a leak is revocable without touching any other deployment.
2. `npx wrangler pages secret put ANTHROPIC_API_KEY --project-name saulera-dossier-engine`
   (paste the key when prompted). Or dashboard: the Pages project → Settings → Variables and
   secrets → Add → type **Secret**, name `ANTHROPIC_API_KEY`, both environments.
3. Local dev: put `ANTHROPIC_API_KEY=sk-ant-...` in `.dev.vars` at the repo root (gitignored —
   verify with `git check-ignore .dev.vars` before writing the key into it).

**Until the secret is set, nothing is broken.** `/api/generate` answers
`503 {"error":"no_model_key"}`, the screen says so in words and points at the manual route,
and packs still get made through the recruiter's own Claude session. That is also the
fallback if the key is ever revoked in an incident: delete the secret, redeploy nothing,
the tool degrades to the seam instead of going down.

The deployment also has a **binding**, added in section 5. A binding is not a secret: it
is a reference to a resource in the same account, it carries no credential, and it is set as
project configuration rather than as an encrypted variable.

### `RESEND_API_KEY` — the candidate's sign-in code (#20, decision 10)

The prep portal emails a 6-digit code to a candidate who has lost their invite link. That is
the only mail this deployment sends today; `src/prep/email.js` is the only code that sends it,
by `fetch` to `https://api.resend.com/emails` with no SDK.

1. Create the key at `resend.com` → API Keys, with **Sending access** only.
2. `npx wrangler pages secret put RESEND_API_KEY --project-name saulera-dossier-engine`,
   both environments. Local dev: add it to `.dev.vars` beside the model key.
3. Optional plain variable **`PREP_MAIL_FROM`** (Settings → Variables and secrets → type
   *Variable*, not Secret) to send under the agency's own name. Default:
   `Interview prep <prep@saulera.com>`.

⚠ **The sending domain must be verified in Resend, or every send answers 403.** This is the
single most likely first failure and it is a DNS job, not a code one: add Resend's SPF and
DKIM records to whichever domain `PREP_MAIL_FROM` uses. It can never be `pages.dev` — that
domain cannot carry SPF or DKIM, so mail from it is unauthenticated.

**Until the secret is set, nothing is broken and nothing is loud.** `POST /prep/auth/otp`
still answers `202`, deliberately: that endpoint answers the same thing for every address so
it cannot be used to enumerate an agency's candidate list, and a missing mail key must not
become the one input that changes the answer. The signal is in the deployment log
(`not_configured`, then `resend send failed with status …`), not in the response. So after
setting the key, **do one real send** before believing the path works — the unit tests stub
the transport by design and pass whether or not Resend would accept a single message.

The magic link still works with no mail key at all: #22 sends the invite, and this key is only
the returning-login path.

---

## 6. Smoke-test checklist

Run these authenticated — Access is on, so an unauthenticated curl only ever sees the login
page and tells you nothing about the site itself. Log in in a browser first.

- [ ] `https://<project>.pages.dev/` renders the one screen: a client rail and three numbered
      acts. It is no longer a deployment shell
- [ ] `tokens.css` and `app.css` load; the neutral palette renders, no off-palette colour
- [ ] `/clients` loads, a client can be added, and a note saves and survives a reload
- [ ] `/api/clients`, `/api/events` and `/api/agency` all return JSON, not a `503`
- [ ] On `/`: a client can be picked, and **Generate the pack** produces a rendered pack with
      the provenance summary, without leaving the page (needs the 5b secret; without it the
      button must answer with the no-model-key message, not a blank failure)
- [ ] Still on `/`: **Or copy the prompt and open Claude** puts a prompt on the clipboard
      and freezes the brief and the CV
- [ ] Pasting a real Claude reply and pressing **Read the pack** renders a pack where every
      claim carries a source word, and anything unverified says so
- [ ] **Copy the pack** pastes into an email client with formatting, and into a plain text
      field without markup
- [ ] `curl -s $P/api/events` shows the event landed, with the round-trip `duration_ms`
- [ ] A client whose note is empty answers `note_empty` and offers a link to `/clients`
- [ ] `curl -sI $P/ | grep -i x-content-type-options` returns the header from `public/_headers`
- [ ] Mobile: 375px width, no horizontal scroll, through all three acts

Unauthenticated, the only thing any of these tells you is that the door is shut — Access
intercepts every path, so all four answer `302` whether the deployment is healthy or broken:

```bash
P=https://<project>.pages.dev
for u in /clients /api/clients /api/events /api/agency; do
  curl -s -o /dev/null -w "$u: %{http_code} %{redirect_url}\n" "$P$u"
done
# all four: 302 to cloudflareaccess.com. A 200 on any /api/* is a failure — the API is public.
```

The candidate portal is the mirror image: `/prep/*` must answer **200 unauthenticated**, and
a `302` there is the failure. Both halves at once are #20's AC4 (section 3b):

```bash
P=https://<project>.pages.dev
for u in /prep/privacy /prep/login; do
  curl -s -o /dev/null -w "$u: %{http_code}\n" "$P$u"; done   # both 200, no redirect
curl -s -o /dev/null -w "/prep/nonsense: %{http_code}\n" "$P/prep/nonsense"   # 404, not 200
for u in /prepx /prep-secret /preparation; do
  curl -s -o /dev/null -w "$u: %{http_code}\n" "$P$u"; done   # all 302 — the segment, not the prefix
```

`.claude/verify-deploy.sh <project> <preview-host>` runs the whole pair and exits non-zero on
either half.

Portal, unauthenticated (no Access login, no cookie):

- [ ] `/prep/privacy` renders the retention notice, styled, at 200
- [ ] `/prep/login` renders the sign-in page at 200
- [ ] `/prep/nonsense` renders the plain 404 page, and **not** the recruiter's tool shell
- [ ] `/prep/` with no cookie lands on `/prep/login` **in a browser**. Note this bounce is
      client-side: the session cookie is `HttpOnly`, so the page has to ask
      `/prep/auth/session` and redirect from JS. A `curl` sees `200` and the bare landing
      markup, which is not a failure — that page holds no candidate data, and #21 is where
      content behind the door starts calling `requireSession` server-side
- [ ] A magic link signs in and lands on `/prep/`; the **same link a second time** goes to
      `/prep/login?e=invalid`
- [ ] `POST /prep/auth/otp` answers `202` for a real address **and** an invented one, with an
      identical body — a difference here is an email-enumeration hole
- [ ] The code email arrives, carries six digits, and contains **no link** (needs 5b's
      `RESEND_API_KEY` and a verified sending domain)
- [ ] Six wrong codes: five answer `401`, the sixth `429`

Access — re-verify after any change to the applications or the policy:

- [ ] `https://<project>.pages.dev/` in a private window → Access login page
- [ ] Allowed email → PIN arrives (check Spam/Promotions) → the site renders
- [ ] A preview hostname also shows the login page
- [ ] Zero Trust → Applications shows exactly **four** for this project: two Allow /
      one-time PIN at the hostnames, and two Bypass / Everyone at the `/prep` paths (3b)

---

## Deliberately deferred

- **Custom domain.** `<project>.pages.dev` is enough until an agency is real. Whose domain
  it should be — saulera's or the agency's — is a branding decision, not a DNS one.
- **Cloudflare Access itself: done** (27 Jul 2026, #12). This entry used to defer steps 2–4 with
  the only hard deadline on this list attached to it. Both applications exist and both hostnames
  were verified; the banner at the top of this file is the record. Kept as a line so the one
  deferral that carried a deadline is visibly discharged rather than quietly gone — and it is
  load-bearing now in a way it was not when it was written, because since 28 July this
  deployment holds a key. Access is what stands between `/api/generate` and the world.
- **`_headers`: partly done** (27 Jul 2026, #8). `public/_headers` now sets
  `X-Content-Type-Options`, `Referrer-Policy` and `X-Frame-Options` on `/*`. **What remains is
  a Content-Security-Policy**, which is the one worth having on a screen that renders model
  output and also the one that breaks a deployment in a way nobody notices until a recruiter
  cannot copy a pack. It needs its own ticket and its own smoke pass.
- **Web fonts: done** (28 Jul 2026, `95566b2`). Deferred twice before that, most recently on the
  grounds that there were no font files in the repo and that "Aspekta 500" and "Geist" each
  needed a licensing decision. The decision was made rather than dodged — Aspekta is MIT, Geist
  and DM Mono are SIL OFL, all redistributable — and four `.woff2` files now ship self-hosted
  from `public/fonts/` behind `public/fonts.css`, so no request leaves the origin. The entry's
  own prediction held: the `--font-*` tokens already existed, and shipping them was a one-file
  change. Fonts stay branding-adjacent, so an agency swap is still a `tokens.css` edit.
- **An Access service token, re-scoped** (27 Jul 2026, #8). It would still make the Functions
  curl-able from CI. The original reason — measuring generation latency automatically — is
  gone: there is no model call on this deployment to time. What is measured now is the
  browser-side round trip, recorded per pack in `events.duration_ms` and readable at
  `GET /api/events`, which needs no service token. Keep it as a CI convenience, not a metric
  dependency.

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
