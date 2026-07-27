# saulera-dossier-engine

Generated, evidence-anchored candidate submission packs for small recruitment agencies.

A recruiter picks a client, pastes the brief and the CV, and gets back a one-to-two page pack
in the format they actually send — with every claim about the candidate carrying its source.
Beside it, an editable note per client holding what the agency knows about that client's
process. **That note is the product. The generation is the cheap part.**

## Status

The deploy shell is live. A Cloudflare Pages project serves `public/` at
`saulera-dossier-engine.pages.dev`, and `functions/api/health.js` answers with whether the
model key is bound server-side. As of 27 Jul 2026 the secret is not set, so it answers
`503 not_configured` — that is the correct answer, not a bug. `src/` — the pack contract,
the provenance verifier and both renderers — is library code with no route wired to it yet.

> ⚠️ **Cloudflare Access is deliberately not set up** (27 Jul 2026). Production and every
> preview hostname are **public to anyone with the URL**. That is tolerable only while the
> surface is a `noindex` placeholder plus a health check that makes no model call — it must
> be closed before #6, which adds a route that spends Anthropic credits. `DEPLOY.md` opens
> with the full reasoning and is also the restore runbook.

Not built: generation (#6), the client knowledge store (#5), the recruiter screen (#8).
See **#1** for the epic, the dependency graph and the date gates. `DEPLOY.md` is the
runbook for the deployment.

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
  provenance verifier (`provenance.js`), and both renderers (`render/`)
- `functions/` — the server boundary; every model call goes through it, so the key and the
  data posture are decided in one place
- `public/` — including `tokens.css`, the default token layer
- `wrangler.toml` — `nodejs_compat` and the compatibility date are engine facts, not
  dashboard state

**Config — per agency, never merged upstream:**

- the client knowledge notes (the product's compounding asset, and the agency's own data)
- branding, expressed as overrides of the custom properties in `public/tokens.css` — a
  variable swap, never a fork
- the renderer choice, inline or appendix (settled by the spike as an agency-level
  decision, not a per-pack one)
- the Cloudflare Pages project, the Access policy and the emails it lets in
- `ANTHROPIC_API_KEY`, as an encrypted Pages variable

**The mechanic.** One Cloudflare Pages project per agency. Each agency's deployment tracks
this repo as upstream and pulls engine improvements; nothing gets re-patched across N
forks. That is deliberately not multi-tenant SaaS — bespoke-per-agency is the commercial
shape, and one deployment per agency is its technical form. It is also why a later platform
migration would be one engine migration plus a redeploy per agency, not a rewrite each.
