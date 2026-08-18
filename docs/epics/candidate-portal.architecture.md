# Architecture: candidate interview-prep portal

Intent: [agency-submission-dossier.prd.md §10](./agency-submission-dossier.prd.md) — the named
destination. Behaviour spec: [interview-prep/SPEC.md](./interview-prep/SPEC.md) (the contract) and
[interview-prep/DECISIONS.md](./interview-prep/DECISIONS.md) (private self-prep locked; the tool
never writes the candidate's answer; never coaches fabrication).

*Written 28 July 2026 from an interactive decision session with the owner. Status: **portal is now
the build priority**, as a **free pilot at the one agency**, while the engine's three-week adoption
window runs in parallel.*

---

## 1. What this is

A candidate-facing interview-preparation portal on a subdomain of the per-agency deployment.
The recruiter, having generated a submission pack, presses **Send to Candidate** once an interview
is confirmed; the candidate receives a magic-link email, lands on an agency-branded prep surface,
and works through short resumable sessions (prime → drill → close) built from the same privileged
inputs that power the pack — the client brief, their CV, and the visibility-gated slice of the
agency's client-knowledge note.

The differentiator over every B2C prep tool (Final Round, Yoodli, ChatGPT Voice): the privileged
client knowledge. The candidate with a chatbot has the public JD; this has who sits on the panel
and what stage two actually tests. The Quantum dossier is the existence proof.

## 2. Decision record (28 Jul 2026, owner session)

| # | Decision | Choice |
|---|---|---|
| 1 | What transfers on Send | A **candidate-facing prep brief** derived from the same three inputs. The client pack is never shown to the candidate. |
| 2 | Client-knowledge control | **Per-field candidate-visible toggle** on the client note, enforced in code (same move as provenance). |
| 3 | Recruiter visibility | **Sent + opened only.** Delivery telemetry, never behaviour. Nothing a candidate *does* reaches the recruiter (DECISIONS.md lock upheld). |
| 4 | Commercial | **Free pilot at the East Grinstead agency**; afterwards a **separate paid follow-on engagement** per agency (engine keeps the £4,500 anchor). |
| 5 | Voice | **Typed-only pilot** with the fidelity caveat surfaced, per spec. Voice is the first follow-on. |
| 6 | Question bank | **Hybrid**: core set generated at Send and cached; lateral/vertical variants + feedback generated live in-session. ~£1–1.75 model spend per candidate course. |
| 7 | Sequencing | **Portal leads now.** Engine's three-week test continues in parallel. |
| 8 | Session surface | **Fixed shell + agent-filled declarative blocks** (A2UI *pattern*, not stack — vanilla JS component registry, no React/CopilotKit). Prep-brief dashboard is agent-composed from the block contract. |
| 9 | CTA timing | **Interview-confirmed only** — the CTA unlocks when an interview date exists. |
| 10 | Invite email | **Portal domain via Resend** (the pattern saulera already ships). Agency name in display name and body. No DNS asks of the agency. |
| 11 | Access lifetime | **Active until interview +14 days** (covers second stages). |
| 12 | Candidate auth | **Magic link + email-OTP return.** Tokens in D1. **Not Cloudflare Access** — the 50-user cliff makes Access wrong for a candidate flow; Access remains the recruiter door. |
| 13 | Retention | **Auto-purge 30 days after `interview_at` + a working delete-now button from day one. Strict UK GDPR compliance is a hard constraint** (lawful basis stated, privacy notice, data-subject rights honoured). |
| 14 | CV in portal | **Carried in the handover payload**, same purge and delete scope. |
| 15 | Competencies | **Auto-extracted at Send, each with its JD quote; rendered in the send preview so the recruiter can strike one.** |
| 16 | Ethos material | **Recruiter supplies at Send** (client note fields gated by the visibility toggle + anything pasted). Candidate may add their own. No scraping. |
| 17 | Nudging | **Exactly one reminder**: "your interview is tomorrow — your day-before session is ready." No streaks, no guilt mechanics, nothing else. |
| 18 | Repo shape | **Same repo, same per-agency deployment.** Candidate routes token-gated; recruiter routes stay behind Access. Shared D1. |
| 19 | Streaming | **Request/response only** in the pilot. SSE is a later polish ticket. |
| 20 | Candidate URL | **`prep.<deployment-domain>`** — a subdomain the deployment already controls. |
| 21 | Accessibility | **Semantic landmarks, full keyboard operability, the repo's contrast gates, visible focus.** Pressure mode (with timing accommodations) is post-pilot. |
| 22 | Component vocabulary | Core: PrimerCard, CompetencyMap, QuestionCard, HelpLadder, FeedbackNote, ProgressStrip. **Pilot also ships: PanelBrief, StoryBankCard, LogisticsRail, DayBeforeMode.** |
| 23 | Agency sales claim | **Process claim + counts**: "every candidate we submit gets our prep portal," evidenced by invite sent/opened counts. Never a claim about a candidate. |

## 3. The two enforcement mechanisms

**Provenance, again.** The prep brief and PanelBrief render only client-note fields flagged
candidate-visible; competencies carry their verbatim JD quote, checked literally against the input
(reuse `src/provenance.js`). Unverifiable material renders as unverified, exactly as in the pack.

**The component vocabulary is the safety rail.** There *is no* component that renders a finished
answer in the candidate's voice, and no component that renders a score or rank. `HelpLadder` has
exactly three rungs and logs which was reached (`mode: recall|nudged|revealed`); a revealed answer
can never raise `success_rate` (SPEC's honesty rule). `ProgressStrip` shows movement, never a level.
The locked rules stop being prompt instructions and become structural.

## 4. Data model (D1, new tables)

Per SPEC's state section, plus the handover/auth layer:

```
invite          id, client_id, token_hash, email, interview_at, sent_at, opened_at,
                expires_at (interview_at + 14d), status
candidate_role  invite_id, jd_text, ethos_text, cv_text, brief_json (the composed blocks)
competency      role_id, label, source_quote, importance, stage, success_rate
question        competency_id, text, variant_of?, axis, difficulty        -- core bank cached at Send
attempt         competency_id, question_id, mode, rating, note, created_at
habit           role_id, label, evidence_count, first_seen, active
otp             invite_id, code_hash, expires_at                          -- returning login
```

Purge: everything under an invite hard-deletes at `interview_at + 30d`. Pages has no cron, so purge
runs **lazily on every portal request** (cheap `DELETE WHERE` guard) plus a manual script for
assurance. The delete-now endpoint drops the same scope immediately. The existing non-personal
event counter gains `invite_sent` / `invite_opened` events — that is the whole telemetry surface.

## 5. Model calls

Two call sites, both server-side behind the existing single-boundary rule and the per-agency
`ANTHROPIC_API_KEY` (28 Jul amendment):

- **At Send** (`claude-opus-5`): compose the prep brief blocks, extract competencies with quotes,
  mint the core question bank. **Two calls** (18 Aug amendment, #79), prompt-cached on the client
  note. ~30p for the first; the second is a fraction of it — a smaller `max_tokens`, and it READS
  the prefix the first call wrote rather than writing a second one.

  *Why two, since "one call" was the decision.* Not a design choice. `BRIEF_SCHEMA` had reached
  Claude Opus 5's structured-outputs grammar ceiling, and under `thinking: {type: "adaptive"}` —
  the mode this product sends — a **sixth block variant is a `400 "The compiled grammar is too
  large"`**, i.e. a dead Send button. #50 shipped one and every prep Send 400'd for weeks. So
  three of the eight block names are minted by a second, small call and folded in before
  `assertBrief` runs; everything downstream sees one ordinary payload. The measurements are at
  `src/prep/schema.js`'s `CALL_ONE_BLOCK_NAMES`, and `test/live/prep-schema-fits.test.js`
  (`npm run test:live`, needs a key) is the gate that re-measures them.

  *Open, and not yet measured:* the two calls send different `output_config.format.schema`. Whether
  that invalidates a message-tier cache entry is documented nowhere either way, so "the second call
  reads the first call's cache" is reasoned, not observed. `usage.cache_read_input_tokens` on the
  second call of a real run settles it. Worst case is a cost regression against this paragraph.
- **In session** (`claude-sonnet-5`): feedback on an attempt, lateral/vertical variants, nudges.
  Request/response, one POST per turn. Instant core questions come from the cached bank.

## 6. Missing pieces / risks

- **The data note** — UK GDPR posture written for the agency before any real candidate touches the
  pilot: lawful basis, processor roles, retention table, DSR route. Gate on it. (Decision 13.)
- **`prep.` subdomain** — one DNS record + Pages custom domain on the deployment domain; verify
  the token gate keeps candidate routes and Access-gated recruiter routes cleanly apart on one
  project.
- **Deliverability** — Resend from the portal domain to arbitrary candidate inboxes; SPF/DKIM on
  the sending domain before the pilot, or invites land in spam and decision 3's `opened` reads
  falsely low.
- **The felt experience** — Quantum's interviewer/you chat feel is the bar for the drill UI even
  without streaming; if a turn's round-trip reads as dead air, perceived quality collapses.
