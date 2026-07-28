# Architecture: submission dossier engine

Intent: [agency-submission-dossier.prd.md](./agency-submission-dossier.prd.md)

*Written 26 July 2026, two days before the East Grinstead discovery visit and two days before the Thursday one-pager the PRD commits to.*

> **How to read this.** The PRD says plainly that nothing in §2 is known yet. So this document is split. §3 to §5 are decided now, because Tuesday cannot move them. §6 is written as named branches with decision rules, because Tuesday decides them and a commitment made today would be rewritten on Wednesday. The job of this doc is to make Thursday fast to write, not to be right about the agency in advance.

---

> ## ⚠️ Amendment, 28 July 2026 — model access, again
>
> **Decision: `POST /api/generate` is restored. The deployment holds one secret, an
> `ANTHROPIC_API_KEY` per agency, and generates packs in the UI. The recruiter's own Claude
> session becomes the fallback route, not the primary one.** This supersedes the 27 July
> amendment below — which itself stands as the correct record of *why* a subscription cannot
> power a Pages Function; that reasoning is unchanged and is exactly why the return is a
> per-token key.
>
> **Why it flipped.** The 27 July amendment said the revisit point was "when an agency
> self-serves — a recruiter hitting a web app that calls the model." Using the built flow made
> the owner that recruiter: the tab trip was the felt cost of every pack even after the UI cut
> it to one paste each way. The trade named in that amendment (~5p, in practice 15–25p per
> pack at Claude Opus 5 rates) was taken deliberately on 28 July, in session, against the
> recorded alternative.
>
> **What survives.** The single-model-call boundary (§5.6): `/api/generate` is the only call
> site. The seam (`/api/prompt` + `/api/verify`) stays live as the fallback — a deployment
> without the key degrades to it in words, not to an error. No candidate data store, Access
> front door, engine/config split: all unchanged. The verifier runs server-side on both routes.
>
> **What narrows.** The §6.4 posture sentence: on the primary route candidate text now
> transits the deployment's Function and Anthropic's API under API-tier terms. The honest
> claim remains "no new store of candidate data, no copy kept after the pack" — re-verify
> API-tier retention terms before wording the data note to an agency.
>
> Applied in the repo: `functions/api/generate.js` + `src/generate.js` restored from
> `3d72737`, `nodejs_compat` back in `wrangler.toml`, secret documented in `DEPLOY.md` §5b,
> README **Decisions → Model access** superseded with the history kept.

---

> ## ⚠️ Amendment, 27 July 2026 — model access
>
> **Decision: packs are generated in Claude Code on the Anthropic subscription. There is no API key, no server-side model call, and no Pages Function.** This supersedes every passage below that describes a key in Pages environment variables or "one Function is the only place a model call happens" — specifically §5.1, §5.2, §5.6 (Secrets), and §6.4.
>
> **Why it is a constraint rather than a preference.** A subscription authenticates Claude Code through a short-lived OAuth token held in a local credential file and refreshed by the CLI. A Pages Function is a V8 isolate: no filesystem, no credential store, no process to run a refresh. There is nowhere for that token to live. Workers AI serves Cloudflare's own models rather than Claude, and AI Gateway is a proxy that still needs a key — so a model call made *from Pages* is API-key-billed by definition. The split is Function vs. a machine with a login, not Cloudflare vs. elsewhere.
>
> **What survives.** §5.6's front door (Cloudflare Access, one-time PIN) is unaffected and is now **done** — two applications, verified. The no-candidate-data-store boundary is unaffected. The engine/config split is unaffected.
>
> **What §5.6's "one Function is the only boundary" argument now rests on.** That sentence was load-bearing for §6.4: it was what let the data posture stay switchable after Thursday. With no Function, the equivalent boundary is Claude Code on a machine you control — which is a *stronger* posture for §6.4, not a weaker one, because no candidate text transits a server at all. §6.4's Thursday task is unchanged in substance but its subject moves from API-tier retention terms to subscription-tier terms. **Re-verify before quoting anything to an agency.**
>
> **When this gets revisited.** Only when an agency self-serves — a recruiter hitting a web app that calls the model. That is #6/#8, and it is the point at which a per-token key becomes the right trade (~5p per pack). Not before.
>
> Applied in the repo: `functions/` deleted, `nodejs_compat` removed, `@anthropic-ai/sdk` moved to devDependencies, README records the decision under **Decisions → Model access**.

---

## 1. Problem and goals

The agency's real advantage is knowledge of its clients' hiring processes, and that knowledge lands nowhere. Every decision below is judged against one question from §5 of the PRD: does it get a consultant from "client sent a brief" to "sendable submission pack" faster than writing the paragraph from memory, and visibly better? The §4 guardrail is the hard constraint. If the pack is better but slower, the bet has failed regardless of conversion, so speed is an architectural requirement rather than a performance goal.

Two acceptance conditions from §6 do most of the constraining, and they pull against each other:

- **Condition 1, the recruiter produces it.** No IT function, no platform migration, decides and buys in the same conversation.
- **Condition 3, it lands where their work already happens,** with the explicit warning that copy-out-and-reformat is what kills it in week three.

---

## 2. What is decided now, and what Tuesday decides

| Decided now (Tuesday cannot move it) | Tuesday decides (written as a branch in §6) |
|---|---|
| Packaging and deployment shape | Whether the dossier product exists at all, or §9's fallback |
| Where client knowledge lives, and that it is stored from day one | Which renderer the pack ships through (email body, attachment, ATS field) |
| That candidate data is never persisted | Whether packaging drops to option A |
| How the provenance rule is enforced | The data posture claim made to the agency |
| The stack, the model, and the generation boundary | How knowledge capture becomes a habit rather than a chore |

---

## 3. Approaches considered

**A. Configured Claude Project (or ChatGPT Project).** Client knowledge as project files and instructions. The recruiter pastes the brief and CV into a chat window, reads the pack, copies it into the email.

*For:* ships in hours, zero code, genuinely a two-way door, nothing to maintain. *Against:* it needs a paid AI seat in the agency's name, which is a cost and an admin ask on a free build. It puts a chat UI into a workflow that currently has none, and a junior consultant on a busy Thursday is the person most likely to abandon it. The sourcing rule in §8 is only as strong as the instructions, with no enforcement. It cannot produce a formatted attachment, so if their send is a Word document rather than an email body it fails condition 3 outright. The data story is a consumer chat plan rather than API terms, which is the weaker of the two if the agency is NHS-facing.

**B. One-screen web tool on Cloudflare Pages plus a Function.** Pick client, paste brief and CV, get the pack rendered in their send format with one copy or one download. Client knowledge stored per client and editable in the same screen.

*For:* satisfies condition 1 without asking them to buy or learn anything (it is a URL), and satisfies condition 3 properly because the output can be shaped to whatever they actually send. The sourcing rule becomes code rather than a polite instruction, which is the difference between a promise and a claim you can make to a client. The data relationship stays with saulera, which is a stronger and more honest posture for a clinical staffing context. ~~The API key stays with saulera too… `functions/api/*.js` is exactly this pattern (server-side key, validated JSON POST, secrets in the Pages dashboard).~~ **Superseded 27 Jul 2026 — see the Amendment at the top:** there is no key and no Function. The "it is the stack already shipped on" argument still holds for Pages itself, just not for the Function pattern. *Against:* it is roughly three days of build committed before Tuesday has validated the thesis, and it is a second repo and deploy target to keep alive.

**C. Not software: a one-page pack template plus a per-client knowledge sheet and a five-minute post-interview capture habit.** Zero build, and it tests the load-bearing assumption in §2 harder and faster than anything else, because if their client knowledge is thin the sheet comes back empty in week one.

*For:* free, immediate, no commitment. *Against:* writing a one to two page pack by hand from a template is slower than the paragraph it replaces, so it fails §4's guardrail by construction. It is a discovery instrument and an input layer, not the MVP.

**Recommendation: B, with C as its input layer and A as a same-day fallback.** C is not an alternative to B, it is the thing B reads from, and it is what the Thursday one-pager describes. A stays on the shelf for the case where Tuesday shows they already live inside ChatGPT or Copilot and would rather not learn a new URL.

---

## 4. Recommended approach

One screen, one deployment per agency, behind an email-code door.

The recruiter picks a client from a short list, pastes or uploads the brief and the CV, and gets back a one to two page pack rendered in the format they actually send, with every claim about the candidate carrying its source. Beside that, an editable note per client holding what the agency knows about that client's process: who sits on the panel, what each stage tests, why the last candidate was turned down. That note is the product. The generation is the cheap part.

**The sequence, against the PRD's own timeline:**

1. **Tuesday.** Hand-run only, sanctioned by §6 condition 1. Take the redacted Quantum dossier as the credential. Build nothing.
2. **Thursday.** The one-pager describes the pack and the client-knowledge sheet, which is approach C. It commits to the sheet regardless of which branch Tuesday selected, because every branch needs it.
3. **Then.** Build B, roughly three days, mostly assembly on a known stack.
4. **Three weeks.** Watch whether they keep using it. §7's primary metric is a count, and a count needs no personal data.

**Why the knowledge note is the architecture, not a feature.** If the note is a file only saulera can edit, condition 1 holds for producing packs but not for keeping them good, and the knowledge stops compounding the moment the engagement ends. That defeats the thesis in §3, which is explicitly about knowledge that compounds. So the note is stored, owned and edited by the agency from day one. The version that actually earns adoption is capture as a by-product: the recruiter pastes the client's reply or the rejection reason, and the tool proposes what to file against that client. That needs the store either way, which is why the store is the decision and the harvesting is what gets earned in week two.

---

## 5. Key decisions

### 5.1 Deployment and repo shape

Its own repo, one Cloudflare Pages project per agency, engine tracked upstream and config per client. This mirrors the split already written down for the client second brain, in `client-starter/README.md` (the gitignored per-client delivery template sitting inside the saulera repo): engine improvements reach every client on a pull instead of being re-patched in N forks. It also matches §8's refusal of multi-tenant SaaS, since bespoke-per-agency is the commercial shape and one deployment per agency is its technical form.

Ruled out: a path on saulera.com. It would route a client's candidate CVs through the marketing domain, which is the wrong thing to have to explain to a trust, and it would share one deployment across agencies.

Consequence worth naming: saulera's repo is deliberately build-free (`DEPLOY.md`: "Static site. No build step."). A separate repo can carry a `package.json` without touching that.

### 5.2 Stack and libraries

| Choice | Why | Considered instead |
|---|---|---|
| Cloudflare Pages (static) | The stack already shipped on. Nothing to build, nothing to learn under time pressure. **Amended 27 Jul 2026: no Pages Functions** — see the Amendment at the top; generation runs in Claude Code, not on Pages. | A Worker with a separate front end, or a Node host. Both are more moving parts for no gain at this size. |
| ~~`@anthropic-ai/sdk` (on Workers)~~ | **Superseded 27 Jul 2026.** The SDK is no longer a runtime dependency — nothing calls the model from the deployment. It remains a devDependency for the local spike only. The provenance schema is still the load-bearing part; it is now validated in `src/` and exercised from Claude Code. | — |
| `claude-opus-5` | The generation is short and the judgment is the hard part: mapping a candidate's real evidence against a specific brief, and refusing to overclaim. Cost is not a constraint here (see below), so this is a quality choice rather than a cost one. | Sonnet 5, materially cheaper. Worth an A/B once the pack shape is stable, but not worth risking the §8 evidence rule on during the three-week adoption window. |
| Structured outputs (`output_config.format` with a JSON schema) | This is what turns §8's promise into a mechanism. See 5.4. | Free-text output plus prompt instructions. That is option A's weakness, and the reason B exists. |
| Prompt caching on the client-knowledge note | The note is reused across every pack for the same client. Opus 5's minimum cacheable prefix is 512 tokens, low enough that a real note qualifies. | Nothing. It is close to free to add. |

**Cost sanity check.** A pack is roughly 5 to 10k tokens in (brief, CV, client note) and a couple of thousand out, plus thinking. At Opus 5 rates ($5 per MTok in, $25 out) that is on the order of 10 to 30p per pack. At a few packs a week it is not a line item, and it should not be allowed to drive the model choice.

**One sizing note, and it touches the guardrail.** Thinking is on by default on Opus 5, and `max_tokens` caps thinking plus response text together. Size `max_tokens` with headroom or the pack truncates mid-page. The consequence for §4 is that the ten minutes is partly a latency budget and not only a review-time budget: adaptive thinking over a 10k-token input at default effort is not instant. Time the generation as well as the review in the spike (§7), and if latency is eating the budget, effort is the lever before the pack shrinks.

### 5.3 Data model, at shape level

Four entities, and the interesting thing about them is which ones persist.

- **Agency.** One per deployment. Configuration, not data: send format, branding, the renderer in use.
- **Client.** The durable asset. Name, plus a free-text knowledge note (process, stages, panel roles, standards, past rejection reasons). Stored, editable in the tool, owned by the agency. This is what compounds and what the £4,500 build is actually selling.
- **Candidate and CV.** Transient. Passed in, used to generate, never written down. There is no candidate table.
- **Pack.** Transient. Rendered, handed over, not stored.

Plus a **non-personal event counter**: client, timestamp, duration. No names, no CV content. This exists solely so §7's primary metric (packs generated versus submissions made) is a number rather than a memory.

**Flag, and it belongs in the doc rather than in a footnote.** Client process knowledge names hiring managers and panel members. That is personal data, ordinary rather than special-category, and §8's "no candidate data store" does not cover it. The commitment that holds is narrower and should be stated to the agency in those words: no new store of *candidate* data. The client note is a business-context record of named individuals, held by the agency, on the agency's instruction.

### 5.4 The provenance rule, enforced in code

§8 says the pack never writes claims it cannot source, and §7 makes zero unsourced claims a weekly quality gate. A prompt asking nicely is not enforcement, so:

- The model emits claims as structured items, each carrying a verbatim source quote and a source type: `cv`, `client_note`, or `unverified`.
- A deterministic check confirms each `cv` or `client_note` quote appears literally in the corresponding input. No second model call, no judgment involved.
- Anything that fails the check renders as visibly unverified rather than silently passing, and is left for the recruiter to confirm.

This is the strongest thing you get to say in the room, and it is worth saying as a property of the tool rather than as a promise about care: nothing in this pack is unsourced, and the ones we could not source are marked. In a clinical staffing context that is not a stylistic preference, per §8.

### 5.5 Canonical pack, then renderers

Generation produces one structured pack. Rendering to a target is a separate, dumb step. Tuesday's answer about email body versus Word attachment versus ATS field then becomes a renderer swap rather than a rewrite, which is the whole reason to separate them before knowing the answer.

### 5.6 Boundaries and contracts

- **Front door.** Cloudflare Access with email one-time PIN. No identity provider to integrate, no code to write, and it reads as governance rather than as a password sent over text. This matters because the URL accepts CVs. Verified 26 July 2026: the Zero Trust free tier is a permanent plan covering up to 50 users and includes Access policies with one-time PIN. A two-to-ten person agency sits well inside it. The cliff is sharp rather than gradual, though: at 51 users it becomes $7 per user per month for *all* users, with no partial billing. Irrelevant at this size, relevant if this ever ships to an agency with 50-plus staff logins.
- ~~**Secrets.** The API key lives in Pages environment variables and never reaches the browser, exactly as `CAL_API_KEY` and `RESEND_API_KEY` do today. Every model call goes through one Function, which is also the boundary that lets the data posture in §6.4 stay switchable.~~
  **Superseded 27 Jul 2026 — see the Amendment at the top.** There is no key and no Function. The deployment holds no secrets at all. The boundary that keeps §6.4 switchable is now Claude Code on a machine with a login, which is a stronger posture than a server-side Function, not a weaker one — no candidate text transits a server.
- **The one boundary that is expensive to unpick,** per §6's door check: no candidate data store. Honoured by 5.3, and it is why the free build declines the compliance work in §8 rather than negotiating about it.
- **What the free build does not touch.** No ATS integration, no compliance documents, no special-category data. Those are paid, scoped follow-ons.

### 5.7 Other calls worth recording

- **Build it, do not spike it.** §6 calls this a two-way door and the door check is right. A generated document slotting into an existing email workflow is abandonable at zero cost to the agency. Nothing is migrated and no system is replaced. The one spike worth running is about the guardrail, not the architecture (§7).
- **Hand-running is Tuesday only.** After Thursday, if it only works when saulera runs it, the three-week test measures availability rather than the product. That is condition 1 and it is not negotiable down.

---

## 6. Tuesday-contingent branches

Each has a decision rule so Wednesday is a tick rather than a rethink.

### 6.1 Which product exists at all

**Rule.** If revenue is meaningfully permanent placement or any interview-bearing work, the dossier engine as specced above proceeds. If it is overwhelmingly locum shift-fill, do not rescue it. Go to §9 of the PRD: scope compliance chasing and expiry monitoring as *paid* work, and find a PII-light slice for the free build. Dormant candidate re-engagement and availability broadcasting are both named there.

**What carries over on this branch, and what does not.** Carried over: the stack, the deploy shape, the Access door, the secrets pattern, the engine-and-config split. Not carried over: almost everything above them. Those fallbacks are outbound-messaging products needing a candidate list, a send mechanism and deliverability, none of which the paste-two-documents-get-one-document shape provides. So B is a cheap bet in the sense that its foundations are reusable, not in the sense that the product survives. If the thesis dies on Tuesday, §4 and §5 get re-derived rather than adapted.

**Signal.** Question 1 of the discovery script, corroborated by question 3.

### 6.2 Where the pack lands

**Rule.** Email body means a plain-text and light-HTML renderer with one copy action. A formatted attachment means a `.docx` renderer, which kills approach A entirely and adds perhaps half a day to B. An ATS field means measure the field's constraints before promising anything.

**Signal.** §11's first product question, and more reliably the observation instructions in the script: what they alt-tab between, and every copy-paste between two systems.

### 6.3 Whether to drop to approach A

**Rule.** Drop to A only if two things hold together: they already pay for and habitually use an AI seat, and their send is an email body rather than an attachment. If either fails, B. A junior consultant producing the pack is on its own a reason to stay with B.

**Signal.** Question 11 and question 13. Question 13 is the sharpest one in the script for this branch, because a tool that got sold and never used tells you what shape of thing they abandon.

### 6.4 The data posture

Deferred to Thursday by explicit decision, and the architecture is built so both branches stay reachable. ~~One Function is the only place a model call happens~~ — **superseded 27 Jul 2026:** there is no Function; generation happens in Claude Code on a machine with a login. Generation remains stateless with respect to candidates, so either posture is still honourable without a rewrite, and the boundary is now tighter: no candidate text reaches a server at all.

**One thing the amendment changes about the Thursday task below.** It was written against API-tier commercial terms. Subscription-tier traffic is governed by different terms, so the verification is the same job against a different document. Do not carry an API-tier answer across.

**What has to be settled before the pack is described to them.** §6 of the PRD says "no data leaves their control by design." That is not true of any LLM-generated pack, and the honest version is narrower: no new store of candidate data is created, and saulera keeps no copy after the pack is produced. That much is a property of the build and can be said today. Anything stronger, in particular any claim about provider-side retention or training, depends on current commercial terms for API-tier traffic and is **not** verified here. Verifying it is a named Thursday task, and it gates the wording of the data note rather than the build.

**Rule.** If they are NHS-framework-facing, the posture needs to be written down as a one-page note the agency can hand to a trust, and that note is worth something commercially rather than being overhead. If they are purely private-sector, a paragraph in the handover suffices. If they will not accept candidate CVs leaving their tenancy at all, the branch is bring-your-own-key, which is heavier setup and costs the ability to fix anything without their credentials.

**Signal.** Question 2, plus whatever they say unprompted about procurement or governance.

### 6.5 How capture becomes a habit rather than a chore

This is §11's hardest product question and the one most likely to decide week three. Two shapes, and the second is earned rather than assumed.

**Start:** an editable note per client, and one ritual borrowed from question 10 of the script. After every interview, three lines: what they asked, how it went, why the outcome. **Earn:** the tool reads a pasted client reply or rejection email and proposes what to file, so capture is a by-product of work already happening rather than a separate task.

**Rule.** Ship the editable note. Build the harvesting only after seeing whether the note gets filled at all in week one. If it stays empty, the thesis is failing at input stage, which §6 says is exactly what you want the MVP to reveal.

---

## 7. Spike, and its decision rule

One spike, and it targets the guardrail rather than the architecture, because the architecture is a two-way door and the guardrail is what kills the product.

> **Question.** Can a pack of usable quality be produced and reviewed to sendable inside ten minutes, and does the provenance requirement survive contact with something a client will actually read?
>
> **Spike.** Take a synthetic medical brief and CV, or the Quantum inputs. Generate a one to two page pack with the structured-claims schema and the literal-quote check from 5.4. Time the review to sendable, honestly, including the corrections. Timebox 90 minutes, private, before or shortly after Tuesday. Not a Tuesday prop: the PRD's close is deliberately "I'll come back Thursday," and turning up with a second artefact undercuts it.
>
> **Decision rule.** If review to sendable needs more than about five minutes of human correction, the density is wrong and the pack shrinks before any UI gets built, because the recruiter's review time is inside the ten minutes. If the evidence-anchored output reads like a compliance form rather than a submission, provenance moves to a footer or appendix and stays out of the body. If both hold, build B as specced.

Two things deliberately not spiked. The generation quality itself, because the Quantum dossier is already the existence proof (§2) and a spike would re-prove it. The deployment shape, because it is reversible at near-zero cost.

---

## 8. Missing pieces

What the recommended approach depends on and does not yet exist:

- **The pack itself.** A one to two page design that ports the Quantum *method* without the density, per §6 condition 4. This is the actual creative work and it is not a coding task.
- **The client-knowledge schema.** What fields a recruiter will genuinely fill in, as opposed to what would be nice to have. Tuesday's answer to question 9 is the input.
- **A CV-to-interview baseline.** §7 notes a two-partner agency may have none. If they cannot state a ratio, capturing one becomes the first piece of work and is worth doing for its own sake.
- **The data note**, if NHS-facing. See 6.4.
- **Their send format.** Everything downstream of §5.5 waits on it.

---

## 9. Open questions, deliberately deferred

- **Data posture.** Branch 6.4. Settled Thursday, once client mix is known and current provider terms are verified.
- **Pack history.** The strict reading of §8 means no history, no regenerate, and the weekly evidence spot-check happens live. A recruiter will ask for history in week one. Decision: ship strict, treat history as a paid follow-on with proper scoping. Settled by whether they ask, and how hard.
- **Second-agency reuse.** §11 asks how much is genuinely reusable versus rebuilt per vertical. The engine-and-config split in 5.1 is the bet; it is not evidence. Settled by the second agency, not by argument.
- **Whether the knowledge note survives being a chore.** Branch 6.5. Settled by whether it is filled in week one.
- **Whether the evidence rule survives a recruiter who wants the pack more flattering.** §11 raises it and I have no way to settle it before it happens. Worth knowing in advance that this is the thing most likely to be traded away under pressure, and that trading it away removes the reason the pack is worth sending.
- **The candidate portal (§10).** Not specced here, inherits `SPEC.md` and `DECISIONS.md`. The one thing that must not be promised on Tuesday: visibility into candidate performance. `DECISIONS.md` locks private self-prep, so it is easy to offer in the room and impossible to deliver without breaking the thing that makes it work.
