# Handover — workflow-deck questions & Louis (TTR Healthcare) prep

*Written 31 Jul 2026, end of a session that prepped discovery questions for the meeting with Louis. Not committed anywhere; local working note.*

## What this session did

1. **Extracted the discovery questions** from `docs/epics/agency-submission-dossier.prd.md` and reframed them for the meeting's actual purpose: scoping TTR's workflow to cut costs and save time (not just validating the dossier thesis).
2. **Added the questions to the footer of the workflow deck** at https://saulera-workflow-deck.pages.dev/ — three columns under the heading "Scoping the workflow — what we'll map together, to cut costs and save time."
3. **Identified the prospect and agency** from ttrhealthcare.com and LinkedIn (details below), saved to auto-memory.

## The deck: current state and how to update it

- Live: https://saulera-workflow-deck.pages.dev/ (Cloudflare Pages project `saulera-workflow-deck`, separate from the dossier-engine project).
- Same page mirrored as a Claude artifact: https://claude.ai/code/artifact/290ed592-f8dd-432b-8e53-45ddb9bb62be — keep both in sync; latest version label `drop-cv-question`.
- **Source is NOT in the repo.** It was recovered by `curl`ing the live page into a session scratchpad (now gone with that session). To edit from a new session: `curl -s https://saulera-workflow-deck.pages.dev/ -o index.html`, edit, then `npx wrangler pages deploy <dir> --project-name saulera-workflow-deck --branch main` (deploy dir must contain only `index.html`), and republish the artifact passing the URL above as `url`.

### Footer question set as deployed

**Map the day** — one placement end to end, brief→CVs (who/how long), shift-fill vs permanent split.
**Find the leak** (expanded on request) — post-offer drop-off; weekly resented work; time spent chasing documents/referees/timesheets; what gets retyped; expiry dates (DBS/registration/training) only discovered when a booking is refused; whether interview failures get written down; software bought but never used.
**Put numbers on it** — registered vs actually working; what they know about clients' processes that candidates don't, and where it lives. *(The "of ten CVs, how many get interviews" question was removed as redundant on request — but it is still the baseline for the PRD's primary success metric, so ask it in the room if the dossier build proceeds.)*

## Who you're meeting

- **Louis Groves** (linkedin.com/in/louis-groves-b9a227190), co-founder/director, **TTR Healthcare / Trust Talented Recruitment Ltd** (ttrhealthcare.com). Based East Grinstead — this IS the agency the PRD's discovery visit targeted. Late twenties; the candidate-attraction half (12K LinkedIn followers, posts imaging roles constantly — his feed may be their biggest sourcing channel).
- **Callam Walters**, the other co-founder, holds ~10 years perm+locum recruitment experience — likely the one with workflow/CRM detail. Resolve "who decides and buys" early.

## What the public footprint says (checked 31 Jul 2026)

- Vertical: AHP-HSS, medical-imaging heavy (CT/MRI radiographers, sonographers, echocardiographers, physios). NHS + private; they cite NHS backlog-reduction contracts → framework supply (RM6281→RM6397) and NHS Employment Check Standards (HCPC, DBS, OH, mandatory training) apply.
- Job board: **11 locum vs 1 permanent** posting. The PRD's kill condition ("overwhelmingly shift-fill → no buyer") is flashing amber. Not conclusive — imaging locum contracts are longer bookings, and the board may not reflect revenue — so the perm/locum revenue split is question #1.
- Website exists, carries live vacancies, has candidate registration → PRD assumption 6 validated.
- Two-founder boutique, office listed Loughton, Essex. Matches the PRD target-user profile.

## Implications / likely direction

- Walk in expecting the **§9 fallback** (compliance pack chasing, expiry monitoring, dormant-candidate re-engagement) to fit better than the dossier thesis; the dossier engine likely only serves whatever permanent desk exists.
- Sonographers/radiographers are scarce-supply → candidate attraction/retention arguments (the §10 portal sale) will land; Louis already markets on "serve the candidate well."
- Extra question worth asking (not on the deck): how much candidate flow comes via Louis's LinkedIn vs website vs job boards. Also: "do these twelve postings reflect your actual live desk?"
- PRD guardrails that survive any pivot: don't promise visibility into candidate prep performance; the fallback touches special-category data so it's paid work, not the free build.

## Adjusted "find the leak" questions (31 Jul, post job-board research)

The deployed deck questions stand, but knowing the board is 11 locum imaging roles + 1 perm physio, ask the leak questions in this sharpened order:

1. **Compliance lag** — "From a candidate saying yes to a shift/contract, how long until they're compliant and booked — and who does the chasing?" (HCPC, DBS, OH, mandatory training, right-to-work; NHS Employment Check Standards apply on framework work.)
2. **Expiry kills** — "When did an expired DBS/training cert last cost you a booking, and how did you find out?" (Their answer sizes the §9 fallback.)
3. **Framework retyping** — "On RM6397 work, what do you retype into the framework portal or a trust's VMS that already lives in your CRM?"
4. **Extensions, not placements** — "What share of locum revenue is extensions/rebookings, and who tracks that a contract is ending in 3 weeks?" (Locum margin lives in extensions; a missed end-date is a silent leak.)
5. **Timesheets** — "Hours per week chasing timesheets and authorisations?"
6. **Sourcing concentration** — "What % of candidate flow is Louis's LinkedIn vs website vs job boards — and what happens to registrants who never work?" (Dormant-pool re-engagement is the other §9 arm.)
7. **The perm question** — "Is the one perm physio posting representative — do you *want* to grow a perm desk?" (The dossier thesis only lives there. If no: pivot the pitch to the locum artefacts below.)
8. **Locum 'interview' reality** — "For a locum imaging booking, does the client interview at all — or is it a compliance check plus an informal call?" (Decides whether the prep portal pivots from interview drill to first-day primer.)

## Two demo candidates (personas for reseeding the showcase)

Built to cover the widest slice of the live board. Fictional; seed into the demo D1 + brief fixture.

**1. Priya Nair — Locum MRI & CT Radiographer** (targets the East Sussex MRI role — 20 min from East Grinstead; also submittable to Devon, Hampshire, Scotland = 4 of 11 postings)
- HCPC-registered Diagnostic Radiographer, 8 years; last 3 as rotational MRI/CT locum across NHS trusts and InHealth mobile units.
- Siemens (Aera, Vida) and GE MRI; Canon CT. IV cannulation certified; MRI safety training current.
- Compliance pack green: DBS on the Update Service, OH clearance and mandatory training in date — *the demo point: the pack renders her bookable today.*

**2. Marcus Adeyemi — Locum General & MSK Sonographer** (submittable to Peterborough, Cambridge, Manchester, Kent, East Midlands = 5 of 11 postings)
- HCPC-registered (radiography route), CASE-accredited PgDip Medical Ultrasound; 6 years scanning.
- General abdominal, small parts, and MSK lists (shoulder/knee injections support experience); reports independently.
- One amber flag on purpose: mandatory training expires in 5 weeks — *the demo point: the engine surfaces the expiry before the client does.*

## Memory files touched this session

- Created `lewis-is-louis-groves-ttr.md` (+ MEMORY.md index line) — the identification above.
- Pre-existing and still current: `workflow-deck-pages-project.md`, `lewis-demo-preview-deployment.md` (demo at demo-lewis-showcase.saulera-dossier-engine.pages.dev, DEMO_MODE=1, tear down after the demo).
