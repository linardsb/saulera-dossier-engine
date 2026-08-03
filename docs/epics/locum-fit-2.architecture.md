# Architecture — Locum fit II: compliance passport + extension radar

Intent: epic [#65](https://github.com/linardsb/saulera-dossier-engine/issues/65) ·
source research: [`../ttr-improvement-dossier.md`](../ttr-improvement-dossier.md) ·
spike: [#66](https://github.com/linardsb/saulera-dossier-engine/issues/66) (this doc is its deliverable, decided with the owner 3 Aug 2026)

## Problem & goals

A locum-heavy agency (TTR: 11 of 12 live roles are locum imaging) loses bookings to compliance
latency and margin to extension slippage. The product must know, for every candidate, *what is
missing and what is about to expire* — and nudge before either kills a booking — without
weakening the pack engine's "brief/CV/pack are transient" guarantee or the prep portal's
no-behaviour-telemetry locks.

## Approaches considered

1. **Metadata-only tracking** *(chosen)* — store statuses, reference numbers and expiry dates;
   never the documents. Documents keep moving over the agency's existing channels. Delivers the
   expiry radar, the recruiter dashboard and the demo entirely inside the free pilot, with no
   special-category *document* custody.
2. **R2 document vault from day one** — phone-photo uploads into a private bucket. The better
   candidate experience, but takes custody of health documents (DPIA, encryption posture, access
   logging) before any commercial agreement exists. Deferred, not rejected: it is the natural
   milestone-2 paid feature.
3. **Buy an e-vault** (Credentially, uCheck…) — least liability, but per-seat cost on a
   two-founder agency and it surrenders the differentiating surface. Rejected for now.

## Recommended approach

Milestone 1 is metadata-only, built as a **third schema regime** beside the engine's ban-regime
and the portal's invite cage: durable candidate compliance data, cascade-caged to a `candidate`
root with its own retention. The candidate passport reuses the `/prep` rails (magic link + OTP,
phone-first, zig tokens); the recruiter surfaces reuse the Access-gated chrome. The extension
radar is the same pattern applied to `assignment` end dates.

## Key decisions

- **Storage: metadata-only (owner call).** No document bytes on our infrastructure in this epic.
  A `compliance_item` row is `{status, reference, expiry_date, checked_at}` — never an image.
  Honest caveat, recorded in the open: even metadata (immunisation status, DBS state) is health
  data under UK GDPR. Posture: minimal fields, lawful basis stated, privacy notice extended,
  candidate delete-now from day one — same rigour as portal decision 13, lighter artefacts than
  document custody would demand.
- **Retention: 12-month dormancy purge (owner call).** The compliance cage auto-purges when a
  candidate has had no active assignment for 12 months (a lapsed locum needs re-verification
  anyway), lazy-run like the portal purge (Pages has no cron). Candidate-visible delete-now from
  day one. One `DELETE FROM candidate` erases the whole cage via ON DELETE CASCADE — the invite
  cage's proven mechanism, new root.
- **Commercial line: the whole metadata epic ships in the free pilot (owner call, against the
  earlier ticket labelling).** `paid-scope` moves to where custody begins: the future R2 vault
  milestone (uploads, evidence views). Labels on #68/#70/#71 lifted accordingly.
- **HCPC: in, non-blocking (owner call).** Apply for the HCPC Employer Check API now; until
  granted, store the registration number and give the recruiter a one-click Multiple Registrant
  Search flow. API integration slots in as a `compliance_item` state-writer when access arrives.
- **Schema lockfile: third regime.** `test/schema.test.js` gains `COMPLIANCE_TABLES`
  (`candidate`, `assignment`, `compliance_item`) with exact-column locks and a cascade chain
  bottoming out at `candidate`. The engine's candidate-shaped ban stays byte-for-byte untouched;
  the portal cage is unchanged. The two-regime comment block becomes three, saying why.
- **Data model (shape level).** `candidate` (identity + contact, the cage root) ← `assignment`
  (client_id → clients, dates, status; feeds both dormancy purge and extension radar) and
  ← `compliance_item` (item_key from a catalogue seeded off TTR's own checklist, status ∈
  missing/submitted/verified/expiring/expired, expiry_date). Thresholds live in the catalogue,
  not code. Telemetry stays in the closed `events.kind` vocabulary, widened in the open
  (`extension_nudge_sent`, `expiry_nudge_sent`) exactly as #17 widened it.

  > **AMENDED 3 Aug 2026 by #69 (owner call).** The widening clause above is **not implemented,
  > and the mechanism it names does not exist.** #17 widened `events.kind` with `ALTER TABLE
  > events ADD COLUMN kind … CHECK (…)`; you cannot `ADD COLUMN` a second time to change one
  > column's CHECK, and SQLite has no `ALTER CONSTRAINT`. Widening it needs the 12-step table
  > rebuild, which would break three assertions in `test/schema.test.js` (the ALTER self-guard,
  > because `RENAME TO` is not `ADD COLUMN`; the exact-tables lock, because `events_new` is a
  > sixteenth name; and the kind-vocabulary test) — turning the product's strongest safety gate
  > from an accumulative parser into a statement-order simulator, inside a ticket scoped as
  > "extension radar".
  >
  > So **`assignment.nudge_sent_at` (migration 0010) is the sole record of a sent nudge**, and
  > #69 writes no `events` row. The supporting argument is honest rather than merely convenient:
  > an `events` row would be a *second* record of the same fact with a *different lifetime* —
  > `events` rows are deliberately non-personal so they survive the cage's purge, while a nudge
  > belongs to a booking that dies with its candidate. Nothing in #69's acceptance criteria
  > needs a nudge count that outlives the cage.
  >
  > **#70 inherits the identical wall** for `expiry_nudge_sent`. If the vocabulary is to be
  > widened, that deserves its own ticket — a schema-regime change with the lockfile rewrite as
  > its actual body — not a rider on either radar.
- **Boundaries.** Candidate auth reuses the magic-link + OTP pattern but binds to `candidate`,
  not the 30-day invite. Emails stay on the Resend seam, idempotent via the `reminder_sent_at` /
  `send_key` patterns. No new external services beyond the (pending) HCPC API. Prep-portal
  behaviour telemetry never appears on any recruiter compliance surface.
- **Stack: no additions.** Vanilla static + Pages Functions + D1, as today. Metadata-only is
  what makes "no R2, no new infra" true.

## Missing pieces

- The compliance item **catalogue** (keys, display names in plain first-time-locum language,
  amber lead-times per item type) — seeded from TTR's `/compliance` checklist.
- A `candidate`-rooted auth session distinct from the invite-scoped one.
- The privacy-notice extension covering the compliance data class + its lawful basis statement.
- HCPC Employer Check API access (requested; not blocking).

## Spikes & experiments

None remaining — this doc closes spike #66. The R2 vault gets its own spike when the paid
milestone is real (custody posture, DPIA, upload UX).

## Open questions

- **Framework/audit retention obligations** (Magnit et al.) may impose minimums that interact
  with the 12-month dormancy purge — ask Louis; amend the retention decision here if so.
- Whether `assignment` should eventually feed the pack engine's client note ("candidate placed
  here before") — deferred; touches the engine boundary and deserves its own decision.
