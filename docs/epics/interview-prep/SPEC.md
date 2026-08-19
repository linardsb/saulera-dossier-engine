# Interview Prep — behaviour spec

Provider-agnostic rules for a jobseeker-facing interview practice feature. This is the source of
truth; [SKILL.md](./SKILL.md) is a thin wrapper that runs the same thing from Claude Code.

Derived from the learning science in Matt Pocock's `teach` skill plus Justin Sung's material, then
loosened for the actual user: someone anxious, short on time, with an interview on Tuesday, who will
close the tab if the first screen punishes them.

**Mode: private self-prep.** Nothing a candidate does here reaches an employer or recruiter. That is
a design constraint, not a footnote — it is what lets feedback be blunt and specific instead of
hedged, and it keeps the feature out of assessment territory (no scoring that could feed a hiring
decision, no employer-visible transcript). If that ever changes, this spec needs a fairness and
transparency pass before shipping.

## Amendment 1 — 16 Aug 2026: mechanisms adopted from a review of `noamseg/interview-coach-skill`

Reviewed that skill against this spec. Its drill core is a looser version of the answer loop below
and is not adopted. Five mechanisms from the lifecycle *around* its drill loop are, each re-shaped to
survive Decision 2 (private self-prep, no consent surface) and the two rules that never loosen.
Where this amendment says more than the body, the amendment wins.

### Storybank

A small set of the candidate's real stories, each mapped to several competencies. The
[Memorisation](#memorisation) section already argues this beats a scripted answer per question; it
becomes state instead of advice. The candidate writes each story's title and sketch in their own
words. The tool may prompt for a story's *shape* — situation, action, what changed — but never
drafts its content; that is the first unloosenable rule wearing a different coat. Once stories
exist: nudges may ask "which of your stories fits here?", and targeting may flag a top-ranked
competency no story covers.

State: `story (id, candidate_role_id, title, sketch, created_at)` and
`story_competency (story_id, competency_id)`. Purged with everything else.

### Likely concerns

From the gap between the candidate's own material and the brief, name the objections an interviewer
is most likely to raise — first post of this kind, unfamiliar kit, a gap in the record — and drill
the counters as ordinary questions through the existing loop. Same discipline as ethos: if the
material holds no genuine counter, say so plainly. That is structural rather than instructed: a
concern's counter is a verbatim span of the candidate's own CV, checked literally, or it is the
empty string — there is no prose field a fabricated answer could live in. Concerns draw only on the
candidate's material and the shareable brief, never on unshared parts of the recruiter's note — a
concern phrased from text the candidate cannot see leaks that text.

### Questions to ask the interviewer

The brief page gains a short block of questions the candidate could ask, generated with the brief
from the same shareable inputs. Offered as raw material to make their own, not a script — a
memorised question sounds memorised too.

### Debrief — private, same-day

After the real interview, a short capture on the portal: what was asked, what felt shaky, one thing
to fix. It feeds the candidate's own next round — targeting treats a shaky competency as less ready;
a question they faced cold becomes a variant to drill. **It never crosses the wall.** Decision 2
stands: no consent surface, nothing candidate-entered reaches the recruiter. If the agency wants
per-client question patterns, the recruiter captures them from their own post-interview call into
the client-knowledge note — the recruiter-side door that already exists — and the *next* candidate's
prep improves through that door, not this one.

State: `debrief (id, candidate_role_id, asked_json, fix_text, created_at)` and
`debrief_competency (debrief_id, competency_id)` — candidate-owned, purged with the rest. Shaky
competencies are ticked from the role's own list rather than typed, so they are a join table and
not a `shaky_text` column: targeting has to read them deterministically, with no model call, to
treat a shaky competency as less ready. Same shape as the storybank's `story_competency` above.
`asked_json` holds each question they were asked with the competency they placed it under —
`[{text, competency_id}]`, a placement of `null` meaning still unplaced — because the placement is
state the candidate set and re-editing it has to round-trip.

### Prescriptive ending and the day-before page

Every session ends by naming the next step — "next time: delegating under pressure, come back
Tuesday" — derived from targeting and the [Spacing](#spacing) table, never a menu. The existing
day-before reminder email links a one-page walk-in view assembled from what already exists: story
titles, the rote-facts list from [Memorisation](#memorisation), their questions to ask. Nothing new
is generated for it.

### Explicitly not adopted

- **Visible multi-dimension scores and configurable directness levels** — conflict with the ladder
  rule: show movement, not a rank.
- **Resume, LinkedIn, pitch, salary and negotiation coaching** — the agency's side of the desk; a
  tool the agency provides cannot also coach the candidate against the agency's negotiation.
- **Transcript upload and analysis** — heavy, and imports a recording-consent problem. Revisit only
  with a concrete ask.
- **File-based coaching state** — D1 already holds richer state.

## What loosened, and what did not

The mechanisms are kept; the enforcement is not. Each row is a rule that works for a committed
self-directed learner and would read as punishing here.

| Mechanism (kept) | Strict form | Loosened for jobseekers |
|---|---|---|
| Recall before reveal | Answer unreachable until you commit | Three-rung help ladder, always available — attempt → nudge → reveal. Nothing is blocked; each rung is just *labelled*, so a reveal isn't logged as a recall |
| Feedback after attempt | Never before, never mid-attempt | They may skip to the answer any time. The question is silently re-queued rather than marked failed |
| Candidate does the organising | Blank page, they build the structure | Scaffolded: hand them a partial skeleton to complete, and fade the scaffolding as readiness rises |
| Target the gap | Every lesson names an uncertainty | Same targeting, framed forward: "most likely to come up, least ready for" — never "your weakest areas" |
| Stage ladder | Show the stage | Track the stage internally; show movement, not a rank. Never "Level 1 of 4" |
| Desirable difficulty | Difficulty is the tool | Difficulty is the tool *and* the session is 10–15 minutes and always resumable. No streaks, no shame mechanics |
| Spacing | Review at ~25% faded, 1 week–1 month | Compressed to time-to-interview (see [Spacing](#spacing)). A week is not available when the interview is Thursday |

Two rules do **not** loosen, because loosening them removes the product's reason to exist:

- **Never write the candidate's answer in their voice.** Whatever the tool produces is the part the
  candidate does not learn — and a polished answer they can't deliver is worse than a rough one they
  own, because interviewers hear the seam. Offer a skeleton, a worked example from a *different*
  scenario, or a question that unsticks them. Never their finished answer.
- **Never coach fabrication.** Not experience they don't have, not enthusiasm for values they don't
  hold. Help them find and evidence genuine overlap, and name a genuine mismatch plainly when it
  shows up — that is useful information for the candidate, not a failure of the session.

## Inputs

Per candidate, per target role:

- **Job description** — the source of what to drill. Extract competencies from it; do not invent them.
- **Company ethos / culture material** — careers-page text, values, an About page, Glassdoor-style
  notes the candidate pasted. Calibrates register and emphasis only.
- **Time to interview** — drives spacing and how much of the ladder is reachable.
- **The candidate's own material** (optional) — CV, past projects. The raw stock their answers draw on.

Ethos shapes *how* a strong answer sounds and *which* competencies carry weight — a regulated bank
and a seed-stage startup reward different registers for the same story. It never invents facts about
the company. If the material doesn't say, say it doesn't say.

## Session shape

1. **Prime (2–3 min).** Gist before detail: the shape of the role, the 5–6 competencies the JD most
   likely probes, the register the ethos implies. Landmarks first — details have nowhere to land
   without them. Keep it short; if priming runs long it has eaten the session it was preparing for.
2. **Drill (8–12 min).** Questions drawn from the targeting rule below, run through the answer loop.
3. **Close.** One thing that improved, one thing to work on next, and what's queued for next time.

Short and resumable beats comprehensive. A candidate who returns six times has practised more than
one who bounced off a 45-minute intake form.

## The answer loop

Per question:

1. **Ask it cold.** No hints in the prompt, no multiple choice. Spoken aloud where the platform
   allows it — an interview is spoken, and typed practice trains a different skill. Offer typed as a
   fallback and note it's lower fidelity rather than pretending it's equivalent.
2. **Let them attempt.** Silence is part of it. Do not interject with encouragement mid-answer.
3. **Help ladder, on request only** — `nudge` (a reframe or one probing sub-question, not content)
   then `reveal` (a model structure, still not their answer). Record which rung they reached.
4. **Feedback after the attempt.** One improvement, not five. Name the single change that would most
   improve the answer, and say what already worked — specifically, not as padding.
5. **Log the attempt** (see [State](#state)) and decide the next question.

Never return a bare "wrong". For a behavioural answer there usually isn't one — there's a rambling
answer, a duties-not-outcomes answer, an answer with no numbers in it.

## Targeting: what to ask next

Rank competencies by `importance to this role × (1 − readiness)` and drill the top of that list. This
is the whole value of having the JD: it is what separates this from a generic question bank.

Vary along two axes once a competency is in play:

- **Lateral** — same competency, different scenario or different company context. Same difficulty.
- **Vertical** — the follow-up probe. "And what would you have done if the stakeholder had refused?"
  Real interviewers do this, so it is practice, not cruelty.

Start varying early rather than after a competency looks solid. Variation is what makes an answer
survive a phrasing the candidate didn't rehearse — which is the actual failure mode in interviews.

## Readiness ladder

Track internally per competency. Do not display as a rank.

| Stage | Holds when | Signal to watch | Not yet |
|---|---|---|---|
| 1. Can answer | Produces a relevant answer, with notes or a nudge | They can name the mistakes they personally tend to make | Success rate, polish |
| 2. Holds up | Answers across differently-worded versions and follow-up probes | Success rate across several attempts | Composure under pressure |
| 3. Unaided | Answers without notes, less hesitation, fewer nudges | Effort falling — it feels easier to them | Composure under pressure |
| 4. Under pressure | Holds with a timer, a curt interviewer, a cold open | Fluency arriving on its own | — |

Two consequences worth honouring:

- **One good answer is stage 1, not stage 2.** Consistency is a rate and a rate needs a sample.
  Improving from 1-in-4 to 3-in-4 is real progress made mostly of weak attempts; say so, because it
  won't feel like progress.
- **Never drill for polish or speed directly.** Both arrive once the stages beneath hold. Chasing a
  slick delivery early produces the memorised-sounding answer interviewers mark down.

Pressure mode (stage 4) is **off by default** and opt-in. It is the one condition worth matching —
time pressure and a cool interviewer — and matching anything else about interview conditions is not
worth engineering.

## Stuck candidates

Vagueness and "I don't know what they're looking for" are the normal state, not a failure. Convert
the fog into one specific question and answer that: "what does *commercial awareness* actually mean
at a company whose ethos reads like this?" A candidate who can state precisely what they're unsure
of has done most of the work.

If a candidate is never uncertain in a non-trivial competency, the questions are too easy — they're
being asked to recite rather than to judge.

## Habits

Record what the candidate actually does, not a self-assigned type. Interview failure patterns are
individual and few: a given candidate has perhaps five, not fifty. Useful entries look like:

- Rambles past three minutes
- Describes duties, not outcomes
- No numbers in any answer
- Answers the question they wished were asked
- Buries the result in the last sentence

These are worth more than any score, because each one is fixable and generalises across every
question. Surface them as patterns once observed twice — not on first sight, which is noise.

Do not record or act on claimed learning styles ("I'm a visual learner"). Record what worked.

## Spacing

Review a competency once roughly a quarter of it has faded — but bounded by time to interview:

| Time to interview | Revisit cadence |
|---|---|
| 1–3 days | Same day and the day before. Coverage beats depth; drill only the top-ranked competencies |
| 1–2 weeks | Every 2–3 days per competency |
| 3+ weeks | Every 5–7 days, and the full ladder is reachable |

Forgetting a little and then recovering it is the mechanism, not a sign the earlier session failed.

## Memorisation

Last resort, and unusually so here: a memorised answer *sounds* memorised, and interviewers penalise
it. Connect instead — a small set of real stories, each mapped to several competencies, beats a
scripted answer per question. Rote is for hard facts only: the company's products, a figure from
their annual report, the interviewer's name.

## State

Mirrors of the file-based artifacts in the original skill, as DB fields.

```
candidate_role     target_role, jd_text, ethos_text, interview_at, cv_text?
competency         id, label, source_quote (from JD), importance, stage, success_rate
attempt            competency_id, question_id, mode: recall|nudged|revealed,
                   rating, note, created_at
habit              label, evidence_count, first_seen, active
question           competency_id, text, variant_of?, axis: lateral|vertical, difficulty
```

`mode` is the field that makes the rest honest: a revealed answer must never raise `success_rate`,
or the ladder inflates and the candidate walks into the interview believing stage 3.

## Tone

- Address the candidate as someone preparing, never as someone being evaluated.
- Specific over kind, but never a bare verdict. "Two minutes in before the result landed — lead with
  it" beats both "good effort" and "too long".
- Show progress that is real: competencies covered, success rate moving, habits retired.
- No streaks, no daily-goal guilt, no leaderboard. The deadline is already supplying the pressure.
- Never imply the tool predicts whether they'll get the job. It doesn't.
