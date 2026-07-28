# Data note — the candidate portal's UK GDPR posture

**DRAFT — requires owner review before any real candidate touches the pilot; not legal advice.**

- [ ] Owner sign-off (blocks the pilot, per epic #16's non-code gate — not #17's merge)

Written 28 July 2026 for #17, implementing architecture decision 13: *auto-purge 30 days
after `interview_at`, a working delete-now from day one, strict UK GDPR compliance as a hard
constraint*. This note is the written artefact behind `public/prep/privacy.html`; the two
must say the same thing, and a change to either is a change to both.

## Parties and roles

| Party | Role | Terms |
|---|---|---|
| The recruitment agency running the deployment | **Controller** — decides why candidate data is processed | Engagement agreement (per agency) |
| The deployment operator (saulera) | **Processor** — runs the portal on the agency's behalf | Same engagement agreement |
| Cloudflare (Pages, D1) | Subprocessor — hosting and storage | [Cloudflare DPA](https://www.cloudflare.com/cloudflare-customer-dpa/) |
| Anthropic (Claude API) | Subprocessor — generates prep briefs, questions, feedback | [Anthropic DPA](https://www.anthropic.com/legal/commercial-terms) (API tier: no training on inputs/outputs) |
| Resend | Subprocessor — delivers the invite email | [Resend DPA](https://resend.com/legal/dpa) |

## Lawful basis (drafted for the owner to confirm)

**Legitimate interests, Article 6(1)(f).** The balancing sketch:

- *Purpose*: helping a candidate prepare for an interview they have accepted, arranged by
  the agency that invited them. The interest is real, shared by candidate and agency, and
  stated to the candidate in plain words on the privacy page.
- *Necessity*: the portal cannot build practice sessions without the JD, the CV and the
  role context; it cannot pick the next question without the attempt history. Nothing held
  goes beyond that (the schema lockfile in `test/schema.test.js` is the enforcement).
- *Balance*: the candidate accepted the interview and chooses whether to use the portal at
  all; nothing they do in it reaches the recruiter (decision 3); everything is deleted on a
  30-day clock they are told about, and they hold a delete-now control that works from day
  one. The intrusion is small, transparent and reversible by the candidate at any moment.

Consent was considered and rejected as the basis: the candidate's use of the portal is
voluntary either way, and consent as a *basis* would make the 30-day retention of the JD
and CV depend on a checkbox rather than on the stated, bounded purpose. If the owner
prefers consent, the change is prose in this note and the privacy page, not code.

## What is held, why, and how it dies

Same rows as the privacy page, plus the mechanism:

| Data | Why | Retention | Mechanism |
|---|---|---|---|
| JD, role context, CV (`candidate_role`) | Build the practice sessions | Interview + 30 days | `ON DELETE CASCADE` from `invite`; purge is one `DELETE FROM invite` |
| Attempts, ratings, notes (`attempt`, `competency`, `habit`, `question`) | Pick the next question, show progress | Interview + 30 days | Same cascade |
| Invite row: email, token hash, sent/opened (`invite`, `otp`) | Deliver access; recruiter delivery status | Interview + 30 days | The purge's own target row |
| Delivery counts (`events.kind` = `invite_sent` / `invite_opened`) | Aggregate counts for the agency's process claim (decision 23) | Kept | Non-personal by construction: no invite id, no email, ever — counts survive purge, identities do not |

The purge runs lazily on every `/prep/*` request (`functions/prep/_middleware.js`), and
`scripts/purge.py` is the assurance path for a portal with no traffic: run on a calendar
reminder against preview and production. The boundary is `datetime(interview_at, '+30
days') <= datetime('now')` — day 30 exactly is purged. There is no soft delete, no archive
and no backup copy of purged rows; `test/portal-purge.test.js` proves scope exactness on
every CI run.

## Data subject requests

- **Route**: the candidate contacts the agency that invited them (stated on the privacy
  page); the agency forwards anything it cannot answer to the operator.
- **Timeframe**: one calendar month, per UK GDPR Article 12(3).
- **Erasure**: the candidate's own delete-now control (`POST /prep/api/delete`) executes it
  immediately, or the operator runs `scripts/purge.py` / a targeted `DELETE FROM invite`
  for a named invite. Either way the cascade removes the whole scope in one statement.
- **Access / correction**: the operator reads the invite's scope from D1 and the agency
  answers; correction of JD/CV text is a re-send (#22's surface), not an edit in place.

## What the recruiter can and cannot see

Decision 3, verbatim: **"Sent + opened only. Delivery telemetry, never behaviour. Nothing a
candidate *does* reaches the recruiter."** Structurally: `invite.sent_at` / `opened_at` are
the entire recruiter-visible surface; no query in the recruiter's screens touches the
portal's pedagogy tables, and the events counter carries no invite id or email that could
link a count back to a person.

## Breach contact

The operator notifies the agency without undue delay on becoming aware of a personal data
breach affecting portal data; the agency, as controller, assesses ICO notification under
the 72-hour rule. Contact line: the agency's engagement contact, plus
`linardsberzins@gmail.com` for the operator.
