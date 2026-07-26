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

## Standing constraints

- **No candidate data store.** Candidate, CV and pack are transient — passed in, used, written
  nowhere. Including logs and browser storage. This is the one boundary that is expensive to
  unpick.
- **Nothing unsourced reaches a client.** Claims carry a verbatim source quote, checked
  literally against the input. Anything that fails renders as visibly unverified.
- **One deployment per agency.** Engine tracked upstream, config per client. Not multi-tenant
  SaaS.
