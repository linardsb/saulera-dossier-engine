# Submission dossier engine

*A product saulera sells to owner-operator recruitment agencies. Written 26 July 2026, ahead of a discovery visit to a medical staffing agency in East Grinstead on Tuesday 28 July 2026.*

> **Status: exploration.** Almost everything in §2 is an assumption, and each one carries the question that tests it. This document is written to be falsified on Tuesday, not defended.
>
> **Scope note.** This PRD covers the near-term engine only. The candidate-facing learning portal is named as the destination in §10 and inherits an existing behaviour spec. It is not specced here.
>
> **Not a saulera website change.** Nothing here touches the marketing site.

---

## 1. Problem statement

**Who.** The owner-operator of a small recruitment agency: two to ten people, generalist or single-vertical, placing into roles that involve a real interview.

**The problem.** An agency's genuine advantage over a job board is that it knows its clients. It knows who sits on the panel, what the second stage actually tests, which answers landed last time, why the last candidate got turned down. That knowledge arrives constantly and lands nowhere. It lives in the consultants' heads and in scattered email threads, so it dies with staff turnover and is unavailable to the person writing tonight's submission.

**The cost of not solving it.** Every candidate submission is rebuilt from scratch and its quality varies with whoever writes it and how late it is. The agency's real differentiator is invisible to the client receiving the CV and invisible to the candidate walking into the room. In a market where clients increasingly challenge fees, "we know this client" is the only defensible answer, and right now it cannot be evidenced.

*Reframe check: more than one solution fits this problem (a structured CRM field, a consultant checklist, a knowledge base, a generated pack, a candidate portal). That is deliberate.*

---

## 2. Evidence

### Observed and verifiable

| What | Where it comes from |
|---|---|
| A researched, role-specific prep dossier materially outperforms generic preparation, and its strongest inputs are **privileged**: the client's own internal interview process document, the hiring manager's identity and function, what each stage is designed to test. | The Quantum dossier in this operator's own files. Built for a real three-stage process; the process document was shared by the client's recruiter, not published anywhere. Candidate advanced through the stages. |
| The same artefact instinctively separates sourced fact from inference (a "provenance note" marking which claims came from the company site vs trade press, and an explicit "calibrated honesty over bravado" rule). | Same document, §1. The evidence-anchoring rule in §8 is not a new constraint; it is already how this thing was built. |
| Small agencies face enterprise technology problems with no IT function, tight budgets, and rising pressure to modernise without adding admin burden. | [Bullhorn UK](https://www.bullhorn.com/uk/blog/how-small-recruitment-agencies-build-a-tech-stack-that-actually-works/), [Simplicity](https://www.simplicityinbusiness.co.uk/uk-recruitment-market-2026-agency-owners/) |
| UK clients in 2026 are better informed about recruitment and more willing to challenge fees, squeezing margins. | [Simplicity](https://www.simplicityinbusiness.co.uk/uk-recruitment-market-2026-agency-owners/) |

### Medical staffing context (relevant if this agency is NHS-facing)

| What | Where it comes from |
|---|---|
| Trusts must procure agency staff through NHS England approved frameworks. RM6397 is set to replace RM6281 (clinical) and RM6277 (non-clinical), with a stronger emphasis on governance and supply-chain control. Off-framework supply is a procurement governance risk for the trust. | [NHS England](https://www.england.nhs.uk/reducing-expenditure-on-nhs-agency-staff-rules-and-price-caps/agency-rules-list-of-approved-framework-agreements-for-all-staff/), [CCS RM6281](https://www.crowncommercial.gov.uk/agreements/RM6281), [Thornton & Lowe](https://thorntonandlowe.com/rm6397-explained/) |
| Hiring power consolidated into Integrated Care Boards following mergers in April 2026, ending trust-by-trust silos. | [Bluestones Medical](https://bluestonesmedical.co.uk/why-the-agency-you-register-with-matters-more-than-ever-in-2026/) |
| Trusts were required to remove agency use for band 2 and 3 roles by end of January 2026, with an executive-approved "break glass" exception. Price caps have applied since 2015. | [NHS England](https://www.england.nhs.uk/reducing-expenditure-on-nhs-agency-staff-rules-and-price-caps/) |
| The crackdown has not reliably delivered savings. REC analysis (January 2026) found bank spend exceeded agency cost overall between 2020 and 2025. | [Recruiter](https://www.recruiter.co.uk/news/2026/05/foi-data-shows-crackdown-agency-use-nhs-fails-cut-costs), [Personnel Today](https://www.personneltoday.com/hr/rec-says-bank-staff-at-nhs-as-expensive-as-agency-workers/) |
| NHS Employment Check Standards apply to agency workers, and the **agency** must satisfy them: identity, right to work, DBS, professional registration (NMC/GMC/HCPC), occupational health, mandatory training, and employment history with no unexplained gaps over three months. | [NHS Employers](https://www.nhsemployers.org/articles/background-information-employment-checks-standards) |
| The window between offer acceptance and first shift is where most onboarding time sits and where most candidates drop out. Compliance emails candidates, candidates chase referees, and expiring documents typically go untracked. Agencies automating this report large reductions in drop-out. | [Credentially](https://www.credentially.io/blogs/healthcare-staff-onboarding-uk-cut-dropout-and-fill-vacancies-faster), [TalentPathway](https://www.talentpathway.com/nurse-onboarding-in-prn-staffing-pain-points-process-and-how-to-reduce-time-to-clear) |

### Assumptions, each with the question that tests it

Nothing below is known. These are the Tuesday agenda.

- [ ] **This agency places into roles with interviews.** *Validate via: "Roughly what split of your revenue is locum shift-fill versus permanent placement?"* If the answer is overwhelmingly shift-fill, this product has no buyer here. See §9.
- [ ] **They hold client process knowledge they do not systematise.** *Validate via: "What do you know about your clients' interview processes that the candidates don't? Where does that live?"* This is the load-bearing one. If the answer is "nothing much", the thesis is wrong.
- [ ] **Submission quality is a live constraint, not a solved one.** *Validate via: "Of ten CVs you send a client, how many come back with an interview? Has that changed?"*
- [ ] **Writing submissions is felt as a burden.** *Validate via: "Walk me through what happens between a client sending a brief and you sending CVs. Who does it, how long does it take?"*
- [ ] **They lose candidates at post-offer compliance.** *Validate via: "Between a candidate saying yes and working their first shift, how many fall away?"*
- [ ] **They have somewhere for a candidate-facing tool to live.** *Validate via: "Do you have a site? Does it carry live vacancies? Where do candidates actually come from?"*
- [ ] **They are NHS-framework, private-sector, or both.** *Validate via: "Who are your clients: trusts, private hospitals, care homes, dental, GP?"* Changes the compliance burden and how much of the product is regulated.

---

## 3. Thesis

**Why this.** A recruiter's privileged client knowledge is the one input a candidate with a chatbot cannot obtain, and the one input that makes a prepared submission or a prepared candidate genuinely better rather than merely longer. That knowledge already exists inside the agency. It is simply not captured, so it cannot compound and it cannot be sold.

The Quantum dossier is the existence proof. What made it work was not clever prose. It was the client's own interview process document, knowing who each interviewer was and what their stage tested, and mapping the candidate's real evidence against the actual brief. A recruiter has exactly that material sitting in their inbox for every client they place into, and throws it away after each placement.

**Why now.** Producing a research-grade, evidence-mapped dossier used to cost hours of senior consultant time, which is precisely why nobody did it for a £6k placement fee. That cost has collapsed. What has not collapsed is the cost of obtaining the privileged inputs, which is why the advantage sits with the agency and not with the candidate or with a generic AI tool.

**Why it beats the cope.** Today a consultant pastes a CV into an email with a paragraph of context, written from memory, quality varying with the hour. The alternative is not "no tool". The alternative is that paragraph. The bet is that a pack built from what the agency already knows about that specific client converts better than a paragraph written from memory, and takes less time.

**The switch test.** This only earns adoption if the pack is faster to produce than the paragraph *and* visibly better. If it is better but slower, consultants will abandon it inside a fortnight under deadline pressure. Speed is not a nice-to-have here, it is the adoption condition.

---

## 4. Hypothesis

> We believe that **turning an agency's existing client knowledge into a generated, evidence-anchored submission pack** will cause **consultants at a small agency** to **use it for real client submissions in place of writing a bespoke email**, resulting in **more of their submitted candidates being invited to interview**.
>
> We will know we are **RIGHT** if, within **three weeks of handover**, packs are being generated for the majority of live submissions without prompting, and CV-to-interview conversion has moved in the right direction.
>
> We will know we are **WRONG** if, within **three weeks**, consultants have quietly gone back to pasting a CV into an email. Adoption decay is the signal. It is behavioural, immediate, and cannot be talked around in a meeting.
>
> **Guardrail:** if producing a pack takes longer than writing the email it replaces, the bet has failed even if conversion improves, because it will not survive a busy week.

---

## 5. Target user and JTBD

**Primary user.** A working owner-recruiter at a two-to-ten person agency. Bills as well as runs the business. Has no IT function and no appetite for a platform migration. Decides and buys in the same conversation.

**Trigger.** A client sends a brief, or a candidate is ready to submit against a role. This happens several times a week and is currently a from-scratch task each time.

**Job to be done.**
> When I'm about to put a candidate in front of a client I know well, I want everything I already know about that client's process and standards to shape the submission automatically, so that more of my candidates reach interview without me writing a bespoke pitch every time.

**Secondary user (destination only, see §10).** The agency's candidate, preparing for an interview the agency arranged.

**Non-users.** Explicitly not built for:
- **Large agencies** with an enterprise ATS and in-house development. They will build it or buy it from a funded vendor.
- **In-house and corporate talent teams.** No client to submit to, so no submission pack exists.
- **Candidates directly (B2C).** Low willingness to pay, no repeat purchase, competing against free chatbots. The agency is the buyer, always.
- **Pure high-volume temp desks** where a placement is a shift booking and no interview happens. Different problem, different product, see §9.

---

## 6. MVP

**The thinnest line that proves or kills the hypothesis end to end:**

For **one** client of the agency, generate a submission pack from three inputs (the client's brief, the candidate's CV, and whatever the agency already knows about that client's process), in the format the agency actually sends today. Put it in front of real client submissions for three weeks. Watch whether they keep using it.

That is the whole MVP. Not a portal, not multi-client, not integrated with anything.

**Why this is the thinnest line.** It exercises the entire thesis: privileged knowledge in, evidence-anchored pack out, real client on the receiving end, adoption observable within the window. If the agency's client knowledge turns out to be thin, this fails at input stage in week one, which is exactly what you want it to do.

**Acceptance conditions.** Without these the MVP is built to fail its own guardrail in §4, because a dossier of the Quantum document's density takes hours to produce by hand:

1. **The recruiter produces the pack, not me.** If it only works when I run it, the three-week adoption test measures my availability rather than the product. Hand-running is acceptable for the Tuesday prop only.
2. **Under ten minutes from inputs to sendable pack**, including the recruiter's review. The email it replaces takes a few minutes, so a large multiple of that will not survive a busy Thursday whatever the conversion data says.
3. **Output lands where their work already happens.** If it has to be copied out of one tool and reformatted into another, that friction is the thing that kills it in week three.
4. **Density is calibrated down.** The Quantum document is a multi-day personal war room. A submission pack a client will read is one to two pages. Do not port the density across; port the method.

**The commercial wrapper.** This is the "first build, no fee" opener. It is built and handed over regardless of whether anything is bought afterwards, per the standing offer. The specific leak it addresses is chosen on Tuesday after seeing their day, not pre-committed. The paid follow-on anchors at the existing agentic engagement price of £4,500, sold as a bespoke build per agency rather than as a subscription.

**Door check.** Two-way door. A generated document that slots into an existing email workflow can be abandoned at zero cost to the agency. Nothing is migrated, no system is replaced, no data leaves their control by design. Build it rather than spike it. The one-way door is anything that ingests candidate compliance documents (special-category personal data), which is why that is out of scope for the free build.

---

## 7. Success metrics

| Metric | Target | How measured |
|---|---|---|
| **Sustained use** (primary, the wrong-condition test) | Packs generated for the majority of live submissions in week 3, unprompted | Count of packs generated vs submissions made. Ask the agency, weekly. |
| **CV-to-interview conversion** (primary outcome) | Directional improvement against their stated baseline | Their own record of submissions and interview invitations. Baseline captured Tuesday, before anything is built. |
| **Time per submission** (guardrail) | No worse than the email it replaces | Timed on a handful of real submissions, before and after. |
| **Evidence integrity** (quality gate) | Zero unsourced claims about a candidate reaching a client | I spot-check a sample of packs weekly for the three weeks. Every claim traces to a line in the CV or the agency's notes, or is flagged unverified. After that it reverts to the §8 rule and the agency owns it. |

**Deliberately not metrics:** placements, fee revenue, client satisfaction scores. All too lagging or too noisy to read at this size within 90 days. They are the reason for doing it, not the way to tell whether it worked.

**Note on baselines.** A two-partner agency may have no baseline at all. If they cannot state a CV-to-interview ratio on Tuesday, capturing one becomes the first piece of work, and it is worth doing for its own sake.

---

## 8. Non-goals

- **Not an ATS or CRM.** It works alongside whatever they use. Replacing their system is not on the table and never will be at this price.
- **Not a compliance system, in v1.** Handling DBS, right-to-work, and professional registration means special-category personal data under UK GDPR. That is not something to take on unpaid in the opening build, whatever the pain turns out to be. It is a legitimate paid follow-on with proper scoping.
- **Not a candidate data store.** Personal data stays inside the agency's existing systems. No new repository of candidate information is created by the free build.
- **Not an assessment tool.** No scoring of candidates, no readiness badge, no ranking that could feed a hiring decision. This is inherited from the interview-prep decisions and applies to the whole product line.
- **Never writes claims it cannot source.** The pack surfaces and structures evidence. Anything not traceable to the CV or the agency's own notes is flagged as unverified and left for the recruiter to confirm. In a clinical staffing context this is not a stylistic preference: a persuasive machine that generates plausible statements about a clinician's competence is a patient-safety liability and a professional risk to the agency. It is also the strongest thing to say to a client: nothing in this pack is unsourced.
- **Not a job board and not a website rebuild**, unless discovery shows the website is the actual bottleneck, in which case that is a different sale.
- **Not multi-tenant SaaS.** Sold as a bespoke build per agency. No support desk, no billing system, no platform to maintain while runway is tight.
- **No auto-rejection of candidates.** Consistent with what the saulera site already commits to publicly.

---

## 9. If Tuesday kills the thesis

If the agency turns out to be pure locum shift-fill, there is no interview, no submission pack, and no buyer for anything in §6. Do not try to rescue it. The fallback, which the market evidence in §2 supports more strongly than it supports the main thesis:

**Compliance pack chasing and expiry monitoring.** The gap between a candidate accepting and working their first shift is where medical staffing loses people and revenue. Documents are chased by email, referees are chased by candidates, and expiring DBS checks, registrations and mandatory training go untracked until a booking is refused.

This is a better-evidenced problem than the dossier thesis. It is not the opener because it touches special-category data and belongs in a paid, properly scoped engagement rather than a free build. If discovery points here, the right move is to scope it as paid work and find a smaller, PII-light slice for the free build (dormant candidate re-engagement and availability broadcasting are both candidates).

---

## 10. Where this goes: the candidate learning portal

The destination, named but not specced here. A candidate-facing preparation tool on the agency's own subdomain, so that candidates the agency represents arrive at interview genuinely prepared for that specific client's process.

The behaviour is already specified and does not need reinventing:

- **[`SPEC.md`](/Users/Berzins/Desktop/AI/SKILLS/interview-prep/SPEC.md)** is the source of truth. Provider-agnostic pedagogy derived from the `teach` skill and Justin Sung's material, loosened for an anxious jobseeker with an interview on Tuesday: three-rung help ladder (attempt, nudge, reveal), competencies extracted from the job description with the quote they came from, targeting by `importance × (1 − readiness)`, lateral and vertical variation, a four-stage internal readiness ladder never shown as a rank, spacing compressed to time-to-interview, 10 to 15 minute resumable sessions with no streak mechanics.
- **[`DECISIONS.md`](/Users/Berzins/Desktop/AI/SKILLS/interview-prep/DECISIONS.md)** locks two things this PRD inherits rather than re-opens.
- **[`SKILL.md`](/Users/Berzins/Desktop/AI/SKILLS/interview-prep/SKILL.md)** is the runnable wrapper, usable today for internal curation.

### The inherited decision that conflicts with the buyer, and must be said out loud

`DECISIONS.md` locks **private self-prep: nothing a candidate does ever reaches the employer or the recruiter.** That is the right call. It is what allows feedback to be blunt rather than hedged, and it keeps the product out of assessment territory.

It also means **the agency pays for a portal it can see nothing inside.** There is no readiness dashboard, no candidate scoreboard, no "who's ready" view. Ever.

The consequence is that the portal cannot be sold on visibility. It has to be sold on candidate attraction and retention, which in medical staffing is the stronger argument anyway: clinicians register with several agencies and go with whoever serves them best, so the agency that helps them win the job earns the relationship. In a market where candidates are the scarce side, that is worth more than a dashboard.

**Practical consequence for Tuesday: do not promise him visibility into candidate performance.** It is easy to offer in the room and impossible to deliver without breaking the thing that makes it work.

The two rules that must survive into any build: the tool never writes the candidate's answer in their voice, and it never coaches fabrication. Both are load-bearing, and both are the first things to get traded away under product pressure.

---

## 11. Open questions

### About this agency (resolve Tuesday)
- [ ] Revenue split: locum shift-fill vs permanent placement?
- [ ] Client mix: NHS trusts on framework, private hospitals, care homes, dental, GP?
- [ ] Does a website exist, and does it carry live vacancies?
- [ ] What is the current stack: ATS or CRM, job board, timesheets, compliance tooling?
- [ ] What is the CV-to-interview baseline, and do they track it at all?
- [ ] Where does client process knowledge currently live, if anywhere?
- [ ] Who actually decides and buys: him, his partner, or both together?

### About the product
- [ ] What format do their submissions take today, and does the pack have to fit inside an email body rather than an attachment?
- [ ] How does client process knowledge get captured over time without becoming a data-entry chore that consultants skip?
- [ ] Does the evidence-anchoring rule survive contact with a recruiter who wants the pack to be more flattering?
- [ ] What happens on the second agency: how much is genuinely reusable versus rebuilt per client vertical?

### Inherited from the interview-prep handover (destination stage, not v1)
Carried forward verbatim from `DECISIONS.md` so they are not lost:
- [ ] **Voice input.** Interview answers are spoken. Does v1 ship speech capture, or typed-only with the fidelity caveat surfaced?
- [ ] **Where competencies come from:** automatic extraction from the JD, operator-curated per role, or candidate-confirmed?
- [ ] **Question bank origin:** generated per candidate, curated per competency, or hybrid? Affects cost per session and how well lateral/vertical variation works.
- [ ] **Ethos material sourcing.** Candidate pastes it, portal scrapes the careers page, or employers supply it. The latter two create exactly the employer relationship that "private self-prep" was chosen to avoid.
- [ ] **Session cadence nudging.** Whether the product nudges at all, and how, without undoing the no-guilt tone rules.
- [ ] **Free vs paid boundary** for candidates, if any.
- [ ] **Accessibility.** Screen-reader behaviour, timing accommodations in pressure mode, opt-in defaults.

---

## Appendix A: Tuesday discovery script

The PRD is the frame. These are the deliverable. Ask them as a curious visitor, not as a consultant running a diagnostic.

**Understand the business (decides which product exists)**
1. Roughly what split of revenue is locum shift-fill versus permanent placement?
2. Who are your clients: trusts on framework, private hospitals, care homes, dental, GP?
3. Walk me through one placement end to end, from the brief landing to their first day.

**Find the leak**
4. What happens between a client sending a brief and you sending CVs? Who does it, how long does it take?
5. Of ten CVs you send a client, how many come back with an interview?
6. Between a candidate saying yes and working their first shift, how many fall away? What holds it up?
7. How many people are registered with you versus actually working right now?
8. What do the two of you do every week that you resent doing?

**The moat question (ask it properly, it is the thesis)**
9. What do you know about your clients' interview processes that the candidates don't? Where does that live?
10. When one of your candidates fails an interview, do you find out why? Does it get written down anywhere?

**Constraints**
11. What are you running: ATS or CRM, job board, timesheets, compliance?
12. Do you have a site? Does it carry live vacancies? Where do candidates actually come from?
13. Has anyone sold you software that didn't get used? What went wrong with it?

**Observe rather than ask**
- What they alt-tab between, and how often.
- Every copy-paste between two systems. Count them.
- What gets retyped that already exists somewhere.
- Which parts of the day they apologise for.

**How to close.** Not with a pitch. "There's one thing here I could build for you for nothing, and I'd rather build it than talk about it. Let me think about which one, and I'll come back to you Thursday with a single page." Then leave.

**What to take.** The redacted Quantum dossier. One artefact, real, with a real outcome behind it. It is the credential, not the proposal.

### The redaction pass (about an hour, do it Monday)

You are showing this to a recruiter. A recruiter is precisely the person who will notice if you hand round another company's hiring material, so the redaction is part of the demonstration, not admin before it. Out before it leaves the house:

- **The Google Drive link to the client's internal "Interview Process FULL" document.** The sharpest item by some distance. Showing a recruiter a document you obtained through another recruiter's process, still linked and live, signals exactly the wrong thing about how you handle client material. Remove the link. You can still describe what having it was worth, and that is the whole point you are making.
- **Every named individual:** the talent acquisition contact, the CTO, the three other leadership names, the final-round interviewers. Replace with roles. "The hiring manager, who I knew was the person I'd report to" carries the argument perfectly well.
- **The company name and the former trading name.** Call it "a performance marketing company". If he asks, tell him.
- **Salary, and the redundancy.** Neither adds anything to the point and both change how he reads you in a business conversation.
- **Reported revenue, EBITDA, headcount, Glassdoor rating, the office address.**

Keep: your own employment history and client names, the structure of the document, the provenance notes, the Braze-to-SFMC mapping, the drills. The structure is the argument. What you want him looking at is the shape of the thing and where its inputs came from, not who it was about.

---

## Architecture

Architecture: [agency-submission-dossier.architecture.md](./agency-submission-dossier.architecture.md)

**Where that session started, and where it landed.** The §6 acceptance conditions (recruiter produces it, under ten minutes, lands where their work already happens) did most of the constraining, and the opening question was whether the MVP is software at all:

> **Is the MVP software at all?** A configured Claude Project holding the agency's client knowledge, or a skill, may satisfy every acceptance condition in days rather than weeks, as a genuine two-way door. A built web app is weeks and locks in before the thesis is validated.

The answer is that conditions 1 and 3 pull against each other, and a chat Project loses on condition 3 for any agency whose send is a formatted attachment. The decision is a one-screen web tool on the stack already shipped on, roughly three days rather than weeks, with the Claude Project retained as a same-day fallback under a stated decision rule. The template plus client-knowledge sheet is not the alternative to it, it is its input layer and the Thursday one-pager. See §3 to §5 of the architecture doc.

The other call that cannot be deferred is **where candidate personal data goes**. §8 says no new candidate data store is created, and the architecture honours that literally: the tool holds client knowledge and is stateless with respect to candidates, with a non-personal event counter so §7's primary metric still works. Note that §6's phrase "no data leaves their control by design" is broader than what any LLM-generated pack can support. The narrower and honest claim is the one above. The full posture is deferred to Thursday as a named branch, and the generation sits behind a single boundary so both branches stay reachable.
