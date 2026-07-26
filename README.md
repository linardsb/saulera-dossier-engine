# saulera-dossier-engine

Generated, evidence-anchored candidate submission packs for small recruitment agencies.

A recruiter picks a client, pastes the brief and the CV, and gets back a one-to-two page pack
in the format they actually send — with every claim about the candidate carrying its source.
Beside it, an editable note per client holding what the agency knows about that client's
process. **That note is the product. The generation is the cheap part.**

## Status

Scaffolding only. The build starts at #3; see **#1** for the epic, the dependency graph and
the date gates. Nothing here is deployed yet.

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
  SaaS.
