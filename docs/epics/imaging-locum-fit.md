# Epic — Imaging-locum fit

*Drafted 31 Jul 2026, ahead of the Louis Groves (TTR Healthcare) meeting. Input doc for `piv-slice-epic`. **Do not slice into GitHub issues until Louis confirms direction in the meeting** — slices 2–5 each carry a go/no-go tied to a specific answer from the room.*

## Intent

The engine's artefacts are shaped for permanent hires: an interview-prep dossier, a competency drill, a panel brief. TTR Healthcare's live desk (checked 31 Jul 2026) is 11 locum imaging postings (MRI/CT radiographers, general/MSK/obstetric sonographers) against 1 permanent physio lead. For a locum imaging booking the client rarely runs a panel interview — the gate is compliance (HCPC, DBS, OH, mandatory training, right-to-work under NHS Employment Check Standards; RM6397 framework audit) plus an informal call. Reshape the engine so its two products — the submission pack and the candidate portal — fit the booking the agency actually makes, while keeping the existing perm flow for the desk that remains.

## Evidence

- ttrhealthcare.com job board 31 Jul 2026: 11 locum imaging vs 1 permanent posting (see `docs/handover-louis-meeting.md`).
- PRD kill condition ("overwhelmingly shift-fill → no buyer") is amber; PRD §9 fallback (compliance chasing, expiry monitoring, dormant re-engagement) likely fits better than the dossier thesis.
- Existing guardrails that survive: no promises of visibility into candidate prep performance; special-category data work is paid, not the free build.

## Constraints

- Perm flow stays working — TTR has at least one perm desk and the PRD's original buyer may still exist elsewhere.
- Candidate data never persisted beyond what the portal schema already allows; compliance/expiry data is special-category-adjacent → slice 5 is paid-work scope, flag on the issue.
- Same deployment, same stack (Pages + Functions + D1). No new services.

## Proposed slices

**Slice 0 — demo reseed (NOT a ticket; do directly on `demo/lewis-showcase` before the meeting).** Replace the nursing brief fixture and D1 demo seed with the two imaging personas in `docs/handover-louis-meeting.md` (Priya Nair, MRI/CT radiographer; Marcus Adeyemi, general/MSK sonographer with a deliberate training-expiry amber). Touches `public/prep/brief.fixture.json`, demo D1 seed, and any perm-nursing vocabulary in visible demo strings.

**Slice 1 — imaging domain vocabulary.** Teach the brief parser and generation prompts the imaging-locum taxonomy: modality (MRI/CT/US), specialism (MSK, obstetric, general), scanner makes, HCPC (not NMC) registration language, locum vs permanent role shape. Touches `src/prompt.js`, `src/generate.js`, brief parsing. *Foundation for everything below.*

**Slice 2 — locum booking pack.** A submission-pack variant for locum roles: compliance status summary, availability window, modality/scanner matrix, rate — optimised for "the client can say yes today", not "the client should interview them". Renders through the existing pack seam. *Go/no-go: Louis confirms clients decide locum submissions on compliance + profile, question 8 in the handover note.*

**Slice 3 — first-day primer and the locum question mix (portal pivot).** For locum bookings the candidate portal serves a first-day primer — site logistics, scanner fleet and protocols, PACS/RIS, who to report to — and a slim question set instead of the full interview drill. The question mix for locum roles: mostly **client-specific** (sourced from the agency's client note — what this manager probes, how the informal call runs), a few **competency** questions pitched at "verify experience, don't teach it" ("which scanners have you run solo?", "why did your last contract end?"), and one or two **screening/logistics** items (availability, rate, compliance status). Never generic clinical coaching — the audience are experts; the portal only tells them what the agency knows that they can't. Questions gain a `type` field (client / competency / screening) alongside the existing axis/difficulty; full drill remains for perm roles. *Go/no-go on the primer-vs-drill balance: question 8 — how formal locum "interviews" actually are.*

**Slice 4 — client-knowledge note, locum fields.** Extend the per-client note fields with what locum supply actually needs recorded: credentialing quirks, VMS/portal used, protocol expectations, site access/parking, extension habits. Feeds slices 2 and 3. *Go/no-go: Louis's answers to leak questions 1, 3, 4.*

**Slice 5 — expiry surfacing (§9 hook, PAID scope).** Surface candidate compliance expiries (DBS, mandatory training, registration) in the recruiter one-screen before they kill a booking. Special-category-adjacent → separate commercial conversation, not the free build. *Go/no-go: leak question 2 lands, and a paid engagement is agreed.*

## Dependency graph

```
Slice 0 (pre-meeting, no issue)
Slice 1 ──► Slice 2
        ├─► Slice 3
        └─► Slice 4 ──► (feeds 2, 3)
Slice 5 (independent; gated on commercial agreement)
```

## Success metric

A locum imaging brief pasted into the one-screen produces a booking pack the recruiter sends without editing, and a portal surface the candidate opens before day one — measured the same way as the PRD's primary metric, substituting "booking confirmed" for "interview secured".
