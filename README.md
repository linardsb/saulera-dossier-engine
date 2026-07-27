# saulera-dossier-engine

Generated, evidence-anchored candidate submission packs for small recruitment agencies.

A recruiter picks a client, pastes the brief and the CV, and gets back a one-to-two page pack
in the format they actually send — with every claim about the candidate carrying its source.
Beside it, an editable note per client holding what the agency knows about that client's
process. **That note is the product. The generation is the cheap part.**

## Status

Live at **https://saulera-dossier-engine.pages.dev** — a Cloudflare Pages site serving
`public/`. Still no secrets and no build step.

The Pages Functions and the D1 schema for the client knowledge store are **written and merged
but not yet serving**: production's database has no tables, because `npm run db:remote` has
deliberately not been run. Until it is, `/clients` and every `/api/*` route answer `503`. See
`DEPLOY.md` §5, which is the runbook for finishing it.

`src/` — the pack contract, the provenance verifier, both renderers and the store — is library
code, driven from Claude Code to generate packs by hand. See **Model access** under Decisions.

**Behind Cloudflare Access** (27 Jul 2026, #12). Production and every preview hostname
require an email one-time PIN; only `linardsberzins@gmail.com` is admitted. Two Access
applications, because a wildcard does not cover the apex — `scripts/setup-access.py`
creates both. Verified: both hostnames answer `302` to `cloudflareaccess.com`.

**The client knowledge store is built** (27 Jul 2026, #5). Three tables in D1, four `/api/*`
routes over them, and a screen at **`/clients`** where the agency adds a client and edits its
note. The non-personal event counter ships with it, so the epic's primary metric is a number
rather than a memory. **It goes live the moment the production migration runs** — one command,
`npm run db:remote`, and until then the routes answer `503 not_migrated`.

Not built: generation (#6), the recruiter screen (#8). See **#1** for the epic, the dependency
graph and the date gates. `DEPLOY.md` is the runbook for the deployment.

## Where the specs live

Both documents are private and **not in this repo** (`products/` is gitignored in the saulera
repo). Read them from disk:

- **PRD (intent):** `~/Desktop/saulera/products/agency-submission-dossier/agency-submission-dossier.prd.md`
- **Architecture (the how):** `~/Desktop/saulera/products/agency-submission-dossier/agency-submission-dossier.architecture.md`

Every ticket inlines the architecture decisions it depends on, so a loop can pick one up
without the doc to hand.

## Decisions

Recorded here so they don't get re-litigated per ticket. The architecture doc is the
source for everything decided before the build; this covers what was decided during it.

**Model access: Claude Code on the subscription. No API key, no server.** (27 Jul 2026.)
Packs are generated in Claude Code using `src/`, by hand, and sent. **Nothing in this
deployment calls a model.** There is no `ANTHROPIC_API_KEY` and no runtime SDK, and that has
not changed since #5 added Functions for storage — see the entry below, which restates the
same boundary rather than relaxing it.

A Pages Function *cannot* use the subscription: subscription auth is a short-lived OAuth
token in a local credential file that the CLI refreshes, and a Function has no filesystem and
no process to refresh it. So a model call from Pages means a per-token API key. That trade is
only worth making once an agency is self-serving — which is #6, and is not an MVP problem.

**Storage: Cloudflare D1, not KV.** (27 Jul 2026, #5.) Both handle a few packs a week from a
two-to-ten-person agency, so throughput does not decide it. Two things do. First, *"there is no
candidate table"* is the strongest sentence this product says out loud, and it is said to a
clinical staffing client — with D1 there is one reviewable file, `migrations/0001_init.sql`,
that can be pointed at and tested, where a KV namespace has no schema to show. `test/schema.test.js`
parses every file in `migrations/` — not just the first, because a later migration is how a
schema actually widens — and fails the suite on a fourth table, a fifth `events` column, any
`ALTER TABLE`, or a `CREATE TABLE` written in a form its parser cannot read. Second, the
editor needs read-after-write: KV is eventually consistent, and an agency saving a note,
reloading and seeing its old text would land that weakness on the exact surface that *is* the
product. The counter settles what is left — `SELECT client_id, COUNT(*) … GROUP BY client_id`
against a key-space scan. D1 is on the Workers free plan: 10 databases, 500 MB each, 5 GB per
account.

**Pages Functions return, for storage only.** (27 Jul 2026, #5.) **The model-access boundary
above is unchanged**: there is still no model call from this deployment, no
`ANTHROPIC_API_KEY`, and no runtime SDK. What the amendment above forbids is a *model call*
from Pages, and its reasoning is about a credential a V8 isolate cannot refresh. A D1 binding
is not a secret and needs no filesystem, so it does not touch that argument. Without a
server-side store there is nowhere for the note to live and no way for the agency rather than
saulera to edit it, which is the whole point of the ticket.

The binding is configured **per deployment** through the Pages API by `scripts/setup-d1.py`,
not in `wrangler.toml`. A `database_id` is per-agency config and `wrangler.toml` is engine —
tracked upstream and pulled by every agency — so an id in it forks an engine file per agency
and conflicts on every pull. Production and preview get different databases: a preview deploy
writing real client notes is not acceptable, and the notes name real hiring managers.

**`--text-muted` was darkened from `#8c8c8c` to `#6b6b6b`.** (27 Jul 2026, #5.) Not a
preference. The old value measures 3.08:1 on `--surface` and fails the 4.5:1 body-text
contrast floor, and row meta and the note scaffold both sit on `--surface`. The new value is
4.89:1 there and 5.33:1 on `--background`. This is an engine-side token, so every agency
inherits the fix. Two related facts worth knowing before using the palette: `--accent` is
3.00:1 on white, so it is a fill and never a text colour, and a button label on it must be
`--text-primary` (5.62:1) rather than white (3.00:1).

**Provenance placement: appendix by default; both renderings ship.** (26 Jul 2026, spike
#2.) Body reads as prose, sources numbered in a footer. Inline sourcing ships as a second
implementation of the same renderer interface. Which one an agency gets is Agency config,
not a per-pack choice by the recruiter — one copy action, not a menu.

**Visual base: neutral, not the saulera Sunrise palette.** (26 Jul 2026.) The
`dossier-design` skill flagged this as undecided. Neutral wins because this is one
deployment per agency with the engine tracked upstream, and the tool sits inside the
agency's own client relationship, not saulera's. A recruiter forwarding a pack to a trust
should be presenting their own firm. Every colour, type and radius value goes through CSS
custom properties from day one, so an agency's branding is a variable swap and never a
fork.

**Density: current pack structure holds.** (26 Jul 2026, spike #2.) Approved unedited, so
review-to-sendable was reading time. Re-time this on the first real pack in week one — the
spike was synthetic and self-reviewed.

## Standing constraints

- **No candidate data store.** Candidate, CV and pack are transient — passed in, used, written
  nowhere. Including logs and browser storage. This is the one boundary that is expensive to
  unpick.
- **Nothing unsourced reaches a client.** Claims carry a verbatim source quote, checked
  literally against the input. Anything that fails renders as visibly unverified.
- **One deployment per agency.** Engine tracked upstream, config per client. Not multi-tenant
  SaaS. Spelled out in **Engine and config** below.

## Engine and config

The line between the two is what makes one deployment per agency cheap rather than a fork
per agency. Everything on the engine side is written once here and picked up by every
agency on a pull. Everything on the config side is that agency's own and is never merged
back up.

**Engine — tracked upstream, shared by every agency:**

- `src/` — the pack contract and schema (`pack.js`), the prompt (`prompt.js`), the
  provenance verifier (`provenance.js`), both renderers (`render/`), the client knowledge
  store (`store.js`) and the HTTP helpers its endpoints share (`http.js`)
- `functions/api/` — the thin adapters over the store. Storage only; no model call
- `migrations/` — the schema, one reviewable file
- `public/` — including `tokens.css`, the default token layer, and `app.css`, the components
  built from it
- `scripts/setup-d1.py` and `scripts/dev.py` — binding the databases and the local dev loop
- `wrangler.toml` — the Pages project name and compatibility date

**Config — per agency, never merged upstream:**

- the client knowledge notes (the product's compounding asset, and the agency's own data)
- **the two D1 databases and their `DB` bindings** — one for production, one for preview. That
  agency's notes live in that agency's own database, and nothing about it is in this repo:
  `scripts/setup-d1.py` resolves the ids by name and binds them per deployment
- branding, expressed as overrides of the custom properties in `public/tokens.css` — a
  variable swap, never a fork
- the renderer choice, inline or appendix (settled by the spike as an agency-level
  decision, not a per-pack one)
- the Cloudflare Pages project, the Access policy and the emails it lets in

**The mechanic.** One Cloudflare Pages project per agency. Each agency's deployment tracks
this repo as upstream and pulls engine improvements; nothing gets re-patched across N
forks. That is deliberately not multi-tenant SaaS — bespoke-per-agency is the commercial
shape, and one deployment per agency is its technical form. It is also why a later platform
migration would be one engine migration plus a redeploy per agency, not a rewrite each.
