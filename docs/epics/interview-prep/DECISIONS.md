# Interview prep — decisions locked, for PRD handover

Two decisions were put to the product owner and answered before the behaviour spec was written.
They are load-bearing: both change product shape, not wording. Recorded here so the PRD inherits
them rather than re-litigating them.

Date: 2026-07-26. Spec they produced: [SPEC.md](./SPEC.md). Runnable wrapper: [SKILL.md](./SKILL.md).

---

## Decision 1 — Packaging: spec plus a thin skill

**Question.** How should the pedagogy land so it's usable in the recruitment portal — as a
provider-agnostic behaviour spec the portal's LLM calls follow, as a Claude Code skill the team runs
to curate prep packs, or both?

**Chosen: both.** `SPEC.md` is the source of truth; `SKILL.md` is a thin wrapper over it.

**Why it matters.** The two paths need different things. Jobseeker-facing means no filesystem, many
concurrent candidates, and session state in the portal's database. Internal curation means one
operator producing content to publish. Writing only the spec would have left nothing runnable today;
writing only the skill would have baked in filesystem assumptions the portal can't honour.

**Consequences for the PRD.**

- `SPEC.md` is implementation-independent and is the contract. If portal behaviour and spec diverge,
  the spec is wrong or the spec changes — not a silent fork.
- The state model in SPEC.md is given as DB tables (`competency`, `attempt`, `habit`, `question`).
  Those are the real schema requirement; the skill's markdown files are the same model flattened for
  single-user local use.
- The skill is user-invoked (`disable-model-invocation: true`), so it never fires on its own. Flip
  that only if an agent needs to reach it autonomously.
- No provider is assumed. Nothing in the spec depends on a particular model or vendor.

---

## Decision 2 — Results are private to the candidate

**Question.** Do a candidate's quiz results or scores ever reach the employer or recruiter — never,
always, or optionally by candidate choice?

**Chosen: never. Private self-prep only.**

**Why it matters.** This is the decision with the longest shadow. Because nothing is at stake for the
candidate, feedback can be blunt and specific rather than hedged, which is most of what makes
practice useful. It also keeps the feature out of assessment territory: no scoring that could feed a
hiring decision, no employer-visible transcript, no consent surface, and no adverse inference to
design against.

**Consequences for the PRD.**

- **Not an assessment product.** No employer-facing view, no exportable score, no "verified" badge.
  Adding any of those later is a different product and needs a fairness, transparency, and bias pass
  before it ships — including how a low score could be misread as a signal about a candidate.
- Feedback copy can be direct ("two minutes in before the result landed") rather than softened.
- Data handling is simpler: the candidate's attempts are theirs. Retention and deletion should follow
  from that, and the JD and ethos text they paste is their own prep material, not employer-endorsed
  content.
- **Claim discipline.** The product must not imply it predicts interview outcomes. It doesn't.

---

## Open questions the PRD still needs to answer

Not decided, and deliberately left out of the spec because they are product calls rather than
pedagogy:

1. **Voice input.** The spec says interview answers are spoken and typed practice is lower fidelity.
   Whether v1 ships speech capture, or ships typed-only with that caveat surfaced, is unresolved and
   materially affects how much of the value lands.
2. **Where competencies come from.** The spec requires extracting them from the JD with the quote
   they came from. Automatic extraction, operator-curated per role, or candidate-confirmed — each has
   different accuracy and different effort per role.
3. **Question bank origin.** Generated per candidate, drawn from a curated bank per competency, or a
   hybrid. Affects cost per session and how well the lateral/vertical variation works.
4. **Ethos material sourcing.** Candidate pastes it, portal scrapes the careers page, or employers
   supply it. Scraping and employer-supplied both introduce a relationship the "private self-prep"
   decision was chosen to avoid — worth checking that it stays clean.
5. **Session length and cadence enforcement.** The spec argues for 10–15 minutes, resumable, with no
   streaks or guilt mechanics. Whether the product nudges at all, and how, is a growth decision that
   can quietly undo the tone rules.
6. **Free vs paid boundary**, if any. Nothing in the spec assumes one.
7. **Accessibility.** Typed fallback is specified; screen-reader behaviour, timing accommodations in
   pressure mode, and the opt-in default are not.

## Two rules that should survive the PRD

Flagged because they are the easiest things to trade away under product pressure, and trading them
away removes the reason the feature works:

- **The tool never writes the candidate's answer in their voice.** Whatever it produces is the part
  the candidate does not learn, and a polished answer they can't deliver is worse than a rough one
  they own — interviewers hear the seam. Skeletons, worked examples from other scenarios, and
  unsticking questions are fine.
- **The tool never coaches fabrication** — not experience they lack, not enthusiasm for values they
  don't hold. It helps them evidence genuine overlap and names a genuine mismatch plainly.
