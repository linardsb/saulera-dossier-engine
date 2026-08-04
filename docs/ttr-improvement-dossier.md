# TTR Healthcare — improvement dossier for the Louis meeting

Thinking-out-loud material for the meeting with Louis Groves. Companion to
`docs/handover-louis-meeting.md` (which holds the personas and "find the leak"
questions). Nothing here is committed product direction — the winners become a
new epic after the meeting.

## 1. Who TTR actually is (researched 3 Aug 2026)

- **Trust Talented Recruitment Ltd**, Companies House 15865177, incorporated
  30 July 2024 — a ~2-year-old, two-founder boutique (Louis Groves + Callam
  Walters, 2–10 employees, 2,773 LinkedIn followers). Registered in Loughton,
  Essex; Louis is personally based in East Grinstead.
- **Live board: 12 jobs — 11 locum imaging, 1 permanent physio.** Modalities:
  sonography/ultrasound (6, incl. MSK and obstetric), MRI (4), CT (2).
  Effectively a locum imaging specialist, confirming the handover doc's read.
- Genuinely national (Scotland to Devon), including a mobile imaging service
  client in Scotland. "National Framework agency"; a LinkedIn post celebrates
  passing a **Magnit audit**, so at least some supply runs through Magnit's
  vendor-neutral programme.
- They recruit at the modality-and-kit level: Siemens 3T, IV cannulation cert,
  PVG, DQASS/FMF for obstetric, minimum 3 years UK experience.
- Tone: challenger, anti-corporate, "straight talking", transparency as a value.

## 2. Where their candidate journey leaks (their own site as evidence)

| Best practice (trend research) | TTR today |
|---|---|
| Golden hour: contact within 15–30 min | Generic Wix form, no stated response time, office closed 17:30–08:30 and weekends |
| Mobile-first / WhatsApp messaging | Phone + email only; no WhatsApp, no chat, anywhere |
| Digital compliance portal, photo uploads | `/compliance` is a checklist page ending in "contact TTR for forms" — fully manual, email-based |
| Hyper-transparent briefs: rate + IR35 up front | Rates absent from list page, buried in detail copy; IR35 never stated (only "PAYE / direct engagement") |
| One-click apply | Same multi-field Wix form per job, required CV upload, hand-made job pages (duplicate/typo'd slugs) |
| Segmented modality talent pools | No visible ATS/CRM front end; no external job-board footprint (nothing on Indeed/Reed/Totaljobs) |

The striking thing: their **values page promises transparency and "keeping you
in the loop"** while the mechanics deliver neither. That gap is the pitch — we
make the tooling match the brand they already claim.

## 3. What our product does today, and where it stops

The engine turns client knowledge into evidence-anchored submission packs, then
sends candidates an interview-prep portal (magic link + OTP, brief + drill,
sent/opened telemetry only). It deliberately persists no candidate data on the
engine side, purges the portal invite scope at interview + 30 days, and never
shows the recruiter what a candidate did.

It **ends at interview prep**. No compliance tracking, no scheduling or
extension tracking, no post-interview outcome capture, no intake/talent pool,
no client-side delivery. And per the handover doc, the submission-pack thesis
itself fits a perm desk — which TTR barely has (1 of 12 roles). For a
locum-heavy agency, packs are largely displaced by framework portals (Magnit).

## 4. Improvement ideas, ranked by fit

### A. Compliance passport (the big one)

Locums re-register with agencies constantly; the checklist on TTR's own site is
the friction inventory (HCPC, enhanced DBS, right to work, four immunisation
records, indemnity, references, WTR opt-out…). Build the candidate-side
compliance portal on the rails we already have:

- Same magic-link + OTP auth, same phone-first design as `/prep/*`.
- Checklist tracker: photo-upload each document from a phone, live "7 of 12
  complete" state, e-sign the TTR forms that today require an email exchange.
- **Expiry radar**: mandatory-training and registration expiry dates tracked,
  automated nudge to candidate *and* recruiter before a booking dies (the
  handover doc's demo persona already carries a deliberate amber expiry flag —
  this makes that demo land).
- **Concurrent vetting**: compliance chase starts at submission, not at offer —
  the single biggest time-to-start lever in the trend research.
- HCPC has a public register lookup; an automated re-check (registration valid,
  no fitness-to-practise flags) is a cheap, high-credibility touch.

⚠️ Architecture tension, must be surfaced honestly in the epic: the engine's
core privacy lock is "candidate data is never persisted". A compliance vault is
the *opposite* — long-lived, sensitive documents. It needs its own data class,
own retention rules, and a deliberate architecture amendment; it cannot sneak
in through the portal's invite scope.

### B. Extension & rebooking radar

Locum margin lives in extensions. Track assignment end dates; 14 days out,
nudge the recruiter: "Priya's Cardiff contract ends on the 21st — extend or
redeploy?" This is the internal, honest version of the "intent to move
predictor" from the research — no scraping, just dates TTR already knows.
Small build (it's the `events`/counts pattern applied to contracts), big
revenue story.

### C. Transparent job-brief generator ("brief-out")

The engine already writes evidence-anchored prose. Point it the other way:
paste a client booking, get a candidate-facing brief that leads with the
things the research says candidates decide on — exact rate, payment model /
IR35 status, scanner make and model, shift pattern, location, start date.
Sendable by WhatsApp/SMS as one tight message. Directly monetises TTR's
kit-level specificity (they already write "Siemens 3T" into specs) and fixes
their rate-transparency inconsistency.

### D. Post-interview / post-placement outcome capture

Today "why past candidates were rejected" only enters the client knowledge
note if a recruiter retypes it. Add a one-tap outcome prompt when an interview
date passes (placed / rejected / no-show + one-line reason) that appends to
the client note. Closes the loop that makes every future pack and prep brief
smarter, and it's recruiter-entered client intel, so it respects the privacy
locks. Also gives the PRD's CV-to-interview metric a home in-product instead
of "ask the agency weekly".

### E. Golden-hour intake

Replace-or-front TTR's registration form: instant acknowledgment with a stated
response promise, a WhatsApp deep link, and modality/kit tagging at intake
(MSK vs obstetric, Siemens vs GE, cannulation cert y/n) so the talent pool is
segmented from day one. This is more "service we could host for them" than
core engine — flag as a possible separate surface.

### F. Day-one readiness brief (prep portal, locum flavour)

Most locum bookings have no interview — so today's portal never fires for 11
of their 12 roles. Reuse the entire brief/registry machinery for an
**assignment brief**: site logistics, parking, scanner kit primer, local
protocol quirks, first-day contacts, from the client knowledge note's
candidate-visible fields. Turns the portal from perm-only into something that
touches every booking, and attacks first-day drop-out.

### G. Smaller / outside-the-box sparks

- **Referral links**: portal-issued personal referral links with a transparent
  bonus (£250–£500 after first 100 hours, per the research) — locum imaging is
  a small community that trusts peer recommendation.
- **WhatsApp as a channel** for OTP, reminders, and compliance nudges — the
  audience is in dark scanning rooms, not on email.
- **"Ghost-busting"**: if a candidate stalls on compliance, auto-flag and
  surface the runner-up — needs a talent pool first, so sequenced after E.
- Skip "just-in-time knowledge cards" for recruiters: a two-founder specialist
  shop doesn't need modality cheat sheets; that idea is for generalist desks.

## 5. Suggested shape for the meeting

1. **Lead with the leak questions** from the handover doc — but with a
   hypothesis now: the leak is compliance latency and extension slippage, not
   submission quality.
2. **Demo order**: pack + prep portal as the credibility piece (show craft),
   then pivot to the amber-expiry persona and sketch A + B as "what we'd build
   for a board that's 11/12 locum".
3. **Mirror their own values page back at them**: "straight talking,
   transparent, keeping people in the loop — your Wix forms can't deliver
   that; this can."
4. One epic, not five: A (compliance passport) with B (extension radar) as its
   second milestone is the coherent locum story. C/D/F are follow-ons; E/G are
   parked sparks.
