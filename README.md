# saulera-dossier-engine

Generated, evidence-anchored candidate submission packs for small recruitment agencies.

A recruiter picks a client, pastes the brief and the CV, and gets back a one-to-two page pack
in the format they actually send — with every claim about the candidate carrying its source.
Beside it, an editable note per client holding what the agency knows about that client's
process. **That note is the product. The generation is the cheap part.**

## Status

Live at **https://saulera-dossier-engine.pages.dev** — a Cloudflare Pages site serving
`public/`. Still no build step; one secret since 28 Jul 2026 (`ANTHROPIC_API_KEY`, see
**Model access** under Decisions and `DEPLOY.md` §5b).

The Pages Functions and the D1 schema for the client knowledge store are **live**: #5 merged
on 27 July 2026, which put `functions/` on `main`. Both D1 databases are created, bound and
migrated — production verified by `d1 execute dossier-engine --remote`, which returns `agency`,
`clients` and `events` with the seed agency row and zero clients. See `DEPLOY.md` §5.

`src/` — the pack contract, the provenance verifier, both renderers and the store — is library
code. It is no longer only driven by hand: `/` is the tool that drives it. See **Model access**
under Decisions.

**Behind Cloudflare Access** (27 Jul 2026, #12). Production and every preview hostname
require an email one-time PIN; only `linardsberzins@gmail.com` is admitted. Two Access
applications, because a wildcard does not cover the apex — `scripts/setup-access.py`
creates both. Verified: both hostnames answer `302` to `cloudflareaccess.com`.

**The client knowledge store is built** (27 Jul 2026, #5). Three engine tables in D1, four
`/api/*` routes over them, and a screen at **`/clients`** where the agency adds a client and
edits its note. Since 28 Jul 2026 (#17) the schema also carries the candidate portal's seven
invite-scoped tables, hard-deleted whole 30 days after the interview by an automatic purge
and a delete-now endpoint. The non-personal event counter ships with it, so the epic's primary metric is a number
rather than a memory. Its D1 databases are created, bound and migrated on both environments,
and it went live when #5 merged, because that is what put `functions/` on `main`.

**The tool is at `/`** (27 Jul 2026, #6 and #8; primary route superseded 28 Jul 2026). One
screen: pick a client, paste, open or drop the brief and the CV, press **Generate the pack**,
and read a pack where every claim carries its source — the model call now happens in
`POST /api/generate`, on this deployment. The seam routes (`POST /api/prompt` and
`POST /api/verify`) remain as the fallback: copy the prompt, run it in your own Claude
session, paste the reply back. See **Model access** under Decisions for the full history.

Every claim passes a deterministic literal-quote check before the recruiter sees it. Anything
that fails is demoted, marked with the word, shown with the quote it could not stand up, and
**never dropped**. `test/seam.test.js` proves that over the real spike fixtures rather than
asserting it in prose.

**The candidate sees their prep at `/prep/brief`** (28 Jul 2026, #21). The prep brief is a
`{name, props, children}` payload over a closed vocabulary of ten block names (#19), and
`public/prep/registry.js` holds one hand-built constructor per name. A name the registry does not
have is reported to the console and skipped, never injected and never rendered as markup, which
is what makes "no component renders a finished answer or a score" a fact about the code rather
than an instruction in a prompt — see §3 of `docs/epics/candidate-portal.architecture.md`. The
screen now reads `GET /prep/api/brief`, session-gated on the invite cookie, which serves a
**projection** of the stored payload rather than the row itself: the model's failed guesses,
the importance scores and the question bank never leave the server, so "the candidate does not
see them" is a fact about the response and not about the rendering
(`src/prep/projection.js`, `test/prep-projection.test.js`).

**Send to Candidate closes the loop** (30 Jul 2026, #22). Once a pack exists and an interview
is booked, act 4 on the pack screen takes the date and the candidate's email address and sends
them their own prep. It is deliberately two steps, because decision 15 requires the recruiter
to see the extracted competencies before anything goes — `POST /api/prep/prepare` runs the one
Opus call and returns a preview that persists nothing, and `POST /api/prep/send` re-runs the
whole contract on what comes back, writes the invite scope, mints the magic link and emails it.
Three things make the round trip safe rather than merely conventional: `verifyBrief` recomputes
`verified` from the quote on every pass and never reads the incoming flag, the candidate-visible
field keys are read from the database and never from the browser, and an unverified competency
refuses the send outright. `invite_sent` is recorded **last**, after the email succeeded, and a
mail failure rolls the whole scope back — so the counts on `/counts` cannot overstate what was
actually delivered, which is the one number decision 23's sales claim rests on.

The recruiter's whole view of the portal is those two numbers per client, sent and opened
(`/counts`). Nothing a candidate does ever reaches them, and `test/counts.test.js` scans the
page's source to keep that true rather than trusting it.

See **#1** for the epic, the dependency graph and the date gates. `DEPLOY.md` is the runbook for
the deployment.

## Where the specs live

Both documents are private and **not in this repo** (`products/` is gitignored in the saulera
repo). Read them from disk:

- **PRD (intent):** `~/Desktop/saulera/products/agency-submission-dossier/agency-submission-dossier.prd.md`
- **Architecture (the how):** `~/Desktop/saulera/products/agency-submission-dossier/agency-submission-dossier.architecture.md`

Every ticket inlines the architecture decisions it depends on, so a loop can pick one up
without the doc to hand.

## Decisions

Recorded here so they don't get re-litigated per ticket. The architecture doc is the
source for everything decided before the build; this covers what was decided during it.

**The transcript is not the brief, and a card that is always tinted says nothing.** (2 Aug 2026,
#63, epic #57.) `prep.css` tinted "the first block" with the signature surface and its comment
claimed one per page by construction. `:first-of-type` matches the first sibling of an element's
own type among its *own* siblings, and blocks are rendered into more than one parent: the drill
builds a fresh wrapper div per turn, so every question card and every feedback note was
first-of-type inside its own wrapper, and `CompetencyMap` nests its children inside its own body,
so a nested card was tinted on the brief too. A ten-turn practice session was a page of
alternating tinted cards. The rule is now scoped by a child combinator to the two mounts that
always meant it — `#blocks` and `#prime-blocks` — and the drill says who is speaking with an
accent edge on the interviewer's cards and a tone step on the feedback, which costs no width on a
page whose prose column is 296px. A descendant combinator would not have been enough; the nested
card is a descendant of the brief as well.

*The answer box was never a `.textarea`.* The one control a candidate types into for ten minutes
carried no class at all, so `app.css`'s field rules never reached it: it rendered in the user
agent's monospace at about 13px, and iOS Safari zooms the viewport whenever a focused control
computes below 16px. The same bug #62 fixed on sign-in, still live on the page that matters more,
and invisible on every desktop browser — which is how it survived from #24. One attribute fixes
it, and `test/prep-content.test.js` now holds it there.

*`min-height` does not apply to an inline element.* `app.css` holds CRAFT's 44px tap floor with
`min-height` on `.btn`, which lands on every `<button>` in the deployment and had never landed on
an `<a class="btn">` — CSS 2.1 §10.7 exempts non-replaced inline elements. There are exactly two
such anchors, both in the candidate portal, both on the phone surface, both rendering at about
39px: they were the only controls in the product under the floor. `display: inline-flex` in
`prep.css` is what makes the floor apply. If a recruiter screen ever grows an anchor-button, the
rule should move to `app.css` and this one be deleted.

**The candidate portal is one system, and it is designed for a phone.** (2 Aug 2026, #62, epic
#57.) The portal used to be two half-systems: `brief.html` and `session.html` linked
`public/prep/prep.css` and ended in a shared footer, while the three shell pages — sign-in, the
`/prep/` junction and the privacy page — carried their own page-scoped styles and ended in
nothing. `login.html` even re-declared a rule `app.css` already owned, so which one won was
decided by link order rather than by anyone. Sign-in and privacy now link `prep.css` too, and
every page in the portal ends the same way. Each page keeps a `<style>` block for what is
genuinely singular to it, which is most of what was there: auditing the three found almost
nothing with a second consumer, so the shared file gained one utility and the real win is the
footer.

*The junction is the deliberate exception.* `/prep/index.html` still links three stylesheets and
not `prep.css`. Its whole vocabulary is `app.css`'s, it exists for one round trip, and a fourth
blocking stylesheet would be paid for in the only thing that page is judged on.

*The iOS zoom, and the fix that would have been wrong.* Safari on iOS zooms the viewport whenever
a focused form control computes below 16px, and the sign-in fields inherited the 14px UI step — so
a candidate's first interaction with the product was the page jumping under their thumb. The fix
is raising the control to 16px. The other fix, `maximum-scale=1` on the viewport meta, stops the
zoom by disabling pinch zoom for everyone and fails WCAG 1.4.4; `test/prep-shell.test.js` asserts
no shell page ever acquires it.

*The retention table scrolls, it does not restack.* The standard responsive-table pattern sets
`display: block` on the cells under a breakpoint. It looks better at 360px and it strips the
table's implicit ARIA roles, so a screen-reader user loses the row and column association that is
the entire content of a "what · why · when deleted" grid on a page about data rights. It scrolls
inside its own box instead, which is what `.counts-table` already does.

`--tint-info` also took its first consumer here (the notice a dead magic link lands on) at
`--text-primary` and with no border, both forced by the contrast measurements in `tokens.css`. Two
`font-weight: 500` declarations were the last in the repo and are now 600 — including one in
`prep.css`, which visibly weights the block headings on the two candidate pages #63 owns. That is
the file's existing intent finally rendering, not a restyle of those pages.
**The build-a-pack flow is laid out as numbered sections in big type, and the corner radius is
settled at 9px.** (2 Aug 2026, #59, the first layout ticket of epic #57.) #58 landed the token
layer and moved no layout, so every screen was rendering the new palette on the old hierarchy.
This is the layout half, on `public/index.html`, `public/app.css` and two additive tokens.

*Type and rhythm.* The page title takes a new **`--text-display` (35px)** — the ramp's next ~1.2
step above `--text-h1`'s 29px, and the step #58's Out of Scope reserved for this ticket by name.
It was `--text-h2` (24px), four points above a subheading, which is not a ramp. The rhythm
between zones takes a new **`--space-16` (64px)**, the 4px grid's next step: `--space-12` had
been serving as both the largest gap and a common one, so "generous" was not expressible. Both
tokens are non-colour, so no contrast gate moves and `test/tokens.test.js` needed no edit.

*The acts became sections rather than labels.* `.act-head` was 12px uppercase tracked muted —
the same treatment as `.rail-head`, which labels a *sidebar*. The three things a recruiter does
on this screen were set more faintly than the hint text under a file picker. It is now
`--text-h3` sentence case in the ink, with the numeral chip grown from 20px to 24px beside it.
**The act heads and `.rail-head` are therefore no longer one grammar**, reversing #8's decision
on purpose: the rail is chrome (a label over a list picked from once) and the acts are the work.
No hairline was added between acts — `app.css` records that the pacing is whitespace rather than
dividers, and at 64px it still is.

*`--radius` stays 9px*, which **closes #58's open question 5**. The two references disagree —
zig.ai soft, forcanopy tighter — and the epic gives zig.ai the *feel* of this flow while giving
forcanopy only the *pattern language of the pack view*. Soft is right for the surfaces #59 owns.
If #60 needs a tighter corner for the Canopy claim chips it adds a `--radius-sm` rather than
moving this one, which sits on the card, the rail, the pack, every input and every button.

*The `h1` change is shared chrome, deliberately.* `h1` is a bare element selector, so `/clients`,
`/counts` and `404.html` inherit the 35px title — epic AC1's "one token set drives both surfaces"
working as intended, and #61 inherits rather than re-decides it. The portal's two role-title
pages already override `h1` in `prep.css`; the three that do not (`/prep/`, `/prep/login`,
`/prep/privacy`) inherit it and are #62's to tune. A phone step-down to `--text-h1` sits in the
mobile-density block.

*`public/app.js` was not touched — not one line.* Every `getElementById` and the one
`closest(".input-col")` call still resolves: the two markup edits (a `.step-label` span per step,
a `.field-pair` wrapper around act 4's date and email) only wrap existing elements, so DOM order
and therefore tab order are unchanged. The ticket allowed "keep hooks stable **or** update in
lockstep"; keeping them stable is the half that cannot regress, and it is what let this run in a
parallel worktree beside #61 and #62.

**The palette is owner-decided from zig.ai, not the stackai default. One sans, one mono. Motion
is opt-in.** (2 Aug 2026, #58, the foundation ticket of epic #57.) Three changes to the design
base, all in `public/tokens.css`, `public/fonts.css` and `public/app.css`; no markup, no
JavaScript, no layout.

*Colour.* The ground is a warm off-white `#fdfafa`, the ink a grey-green `#2e3332`, the accent a
deep green `#08906c`, plus three state tints. This replaces stackai's white / grey / `#0099ff`.
It is still a **neutral** base and not saulera's Sunrise brand, so the "Visual base: neutral"
decision below is untouched — this is a warmer neutral, chosen by the owner, not a brand.

*The accent split, which is the one place a decided value lost to a gate.* `--accent` `#08906c`
measures **4.03:1 with white** and **3.19:1 with the ink** — both under the 4.5:1 body-text
floor — and `.btn-primary` puts a label directly on its fill. #58's AC2 says the gates win over a
raw reference value, so the palette gained **`--accent-strong` `#087e60`** (white on it is
**5.04:1**, the minimum darkening that clears the floor) for that one fill, and `--on-accent` for
the label. `--accent` keeps the owner's decided hex and is now **decorative only**: the focus
ring, two underlines, the `.client-row` marker bar and the dragover edge, all non-text uses at
the 3:1 floor, which it clears at 3.88 / 3.53 / 3.63 on the three grounds. It is 2.57:1 on
`--tint-info`, which is why the focus ring keeps a `--text-primary` hairline inside it.

*Type.* Consolidated to **Geist + DM Mono**. The third family the stackai reference brought with
it is deleted — the epic asks for one sans, and Geist was already on disk with two real weights.
Geist ships 400 and 600 and **nothing may ask for 500**: CSS font-matching resolves a desired
weight between 400 and 500 *downward*, so a 500 heading renders at regular weight rather than
snapping up to the 600 sitting right there. Headings are 600.

*Motion.* Inverted from opt-out to **opt-in**. `app.css` used to scatter six transitions through
its rules and neutralise them with a blanket `prefers-reduced-motion: reduce` override using
`!important`; they now live in one `prefers-reduced-motion: no-preference` block at the foot of
the file, which is the idiom `prep.css` already used. `test/chrome.test.js` is the new gate:
a transition added to a rule is now a test failure rather than a live animation nobody chose.
It also gates that `app.css` and the four page-scoped `<style>` blocks declare no raw colour, and
that `fonts.css` requests nothing off-origin.

One thing that inversion caught: `public/prep/session.css`'s typing indicator is an *infinite*
animation that was relying on the deleted blanket block, and no test covered it — deleting the
block would have left it pulsing for a user who asked for no motion, silently. It now carries its
own `no-preference` guard, and `test/prep-session-ui.test.js` asserts it.

**Model access: `POST /api/generate` on this deployment, behind a per-deployment API key.
The recruiter's own Claude session is the fallback route.** (28 Jul 2026, owner decision,
superseding the whole entry below.) The tab trip was designed honestly and it was still the
part of the loop the owner felt every time, so the trade was re-taken with eyes open: one
`ANTHROPIC_API_KEY` Pages secret per agency deployment, ~15–25p per pack at Claude Opus 5
rates, a key to issue and rotate — bought back as one click from inputs to verified pack.
`3d72737` was restored on top of the seam rather than instead of it: the seam stays fully
working (a deployment with no key answers `no_model_key` in words and the screen points at
the manual buttons), the single-model-call-boundary rule from architecture §5.6 stands, and
the verifier runs server-side on both routes. The data-posture sentence narrows accordingly:
candidate text now transits this deployment's Function and Anthropic's API under API-tier
terms for the primary route; still no store, still no copy kept after the pack is produced.

The paragraphs below are the 27 Jul decision this supersedes, kept because its reasoning
still governs the fallback route and the key's handling:

**Model access (superseded): the recruiter's own Claude session. No API key, no model call
from Pages.** (27 Jul 2026, #6 and #8.)

A Pages Function *cannot* use the subscription: subscription auth is a short-lived OAuth
token in a local credential file that the CLI refreshes, and a Function has no filesystem and
no process to refresh it. So a model call from Pages means a per-token API key.

**This was built the other way first, and reverted.** `3d72737` added `POST /api/generate`
calling `claude-opus-5` through `@anthropic-ai/sdk`; `5e311d1` reverted it. The revert stood
until 28 Jul 2026, when the owner — not a ticket — reopened it after using the flow; that is
the supersession above, and `3d72737` is what came back.

What replaced it is a **seam in two halves, either side of the recruiter's own Claude session**:
`POST /api/prompt` assembles the client note, the brief, the CV and the pack schema into one
copyable string, and `POST /api/verify` takes the pasted reply back, checks every quote against
the actual source text, renders it and records the event. Say plainly what that costs and what
it buys. It costs the recruiter one trip to their own Claude session, in the middle of the flow,
which the screen designs for rather than hides. It buys a deployment with no key to issue, no
key to rotate and no per-agency model billing, on a product whose commercial shape is one
bespoke deployment per agency. `@anthropic-ai/sdk` stays a devDependency and `spike/run.js`
still runs the API path with a key, so that door is shut rather than bricked up.

**On the data posture, this is the whole claim and nothing broader.** No new store of candidate
data is created, and this deployment keeps no copy after the pack is produced. What changed is
where the model call happens: it now runs in the recruiter's own Claude session rather than from
Pages. Nothing is claimed here about provider-side retention in either arrangement.

**Storage: Cloudflare D1, not KV.** (27 Jul 2026, #5.) Both handle a few packs a week from a
two-to-ten-person agency, so throughput does not decide it. Two things do. First, *"there is no
candidate table"* is the strongest sentence this product says out loud, and it is said to a
clinical staffing client — with D1 there is a reviewable `migrations/` directory that can be
pointed at and tested, where a KV namespace has no schema to show. That sentence is scoped to
the **engine** since #17 (28 Jul 2026): the pack pipeline still writes no candidate data
anywhere, while the prep portal's seven tables hold candidate data deliberately, inside an
invite-scoped cage — every row cascades from `invite`, purged whole 30 days after the
interview, deletable now by the candidate. `test/schema.test.js` is the lockfile for both
regimes: it parses every migration — not just the first, because a later migration is how a
schema actually widens — and fails the suite on any table's columns moving, a missing
`ON DELETE CASCADE`, the `attempt.mode` honesty CHECK loosening, a widened `events.kind`
vocabulary, or a `CREATE TABLE`/`ALTER TABLE` written in a form its parser cannot read.
Second, the
editor needs read-after-write: KV is eventually consistent, and an agency saving a note,
reloading and seeing its old text would land that weakness on the exact surface that *is* the
product. The counter settles what is left — `SELECT client_id, COUNT(*) … GROUP BY client_id`
against a key-space scan. D1 is on the Workers free plan: 10 databases, 500 MB each, 5 GB per
account.

**Pages Functions return — for storage, and for the two halves of the seam. Never for a model
call.** (27 Jul 2026, #5, amended by #6 and #8.) **The model-access boundary above is
unchanged**: there is still no model call from this deployment, no `ANTHROPIC_API_KEY` and no
runtime SDK. What that decision forbids is a *model call* from Pages, and its reasoning is about
a credential a V8 isolate cannot refresh. A D1 binding is not a secret and needs no filesystem,
so it does not touch that argument. Without a server-side store there is nowhere for the note to
live and no way for the agency rather than saulera to edit it, which is the whole point of #5.

#6 and #8 added two more Functions, and neither is storage: `/api/prompt` assembles a string and
`/api/verify` checks and renders a pasted one. They are Functions rather than client-side
JavaScript because `wrangler.toml` serves only `public/`, so a browser cannot import `src/` —
and the alternatives were copying the verifier and the renderers into `public/` (two copies of
the one module whose whole value is being the single deterministic check) or adding a bundler,
which #8 AC9 forbids. A Function is the only shape that keeps one verifier, no build step, and
`src/` where the tests can reach it.

The binding is configured **per deployment** through the Pages API by `scripts/setup-d1.py`,
not in `wrangler.toml`. A `database_id` is per-agency config and `wrangler.toml` is engine —
tracked upstream and pulled by every agency — so an id in it forks an engine file per agency
and conflicts on every pull. Production and preview get different databases: a preview deploy
writing real client notes is not acceptable, and the notes name real hiring managers.

**`--text-muted` was darkened from `#8c8c8c` to `#6b6b6b`.** (27 Jul 2026, #5.) Not a
preference. The old value measures 3.08:1 on `--surface` and fails the 4.5:1 body-text
contrast floor, and row meta and the note scaffold both sit on `--surface`. The new value is
4.89:1 there and 5.33:1 on `--background`. This is an engine-side token, so every agency
inherits the fix.

*The reasoning above stands; the two numbers it closed with do not.* It ended by noting that
`--accent` was 3.00:1 on white and that a button label on it must therefore be `--text-primary`
(5.62:1). **Both halves were superseded by #58** (entry at the top): the palette is no longer
stackai's, `--text-muted` is now `#5c6764` (5.65 / 5.15 / 5.29 on the three grounds), and a
primary button's label is now `--on-accent` on `--accent-strong` at 5.04:1. What survives
unchanged is the rule that produced them — a colour carrying a word is text and takes the 4.5:1
floor, and `test/tokens.test.js` is what enforces it rather than a number in a comment.

**The provenance tokens are text colours held to 4.5:1.** (27 Jul 2026, #8.) Same shape of fix
as `--text-muted` above, on the tokens that matter most. `--verified` and `--unverified` shipped
in #3 as aliases of `--success` (#22c55e) and `--warning` (#c68a0b), which measure **2.28:1** and
**2.98:1** on `--background`. Whether a claim is sourced is this product's core distinction and
the mark carries the word "Unverified", so these are body text and take the 4.5:1 floor rather
than the 3:1 a decorative state colour could take. They are `#0b5c46` (7.68:1 / 7.00:1 / 7.20:1
on `--background` / `--surface` / `--surface-signature`), `#8a5300` (6.10:1 / 5.55:1 / 5.71:1)
and `#9f1239` (7.72:1 / 7.03:1 / 7.23:1) — the last two unchanged since #8 and re-measured
against #58's palette, the first moved from `#166534` by #58. That move was **not** gate-forced:
the old value cleared every floor. It moved so the "sourced" green sits inside the accent's hue
family rather than beside it, which is a judgment and cheap to revert.
`--success` and `--warning` are gone rather than left orphaned; nothing else referenced them.
`test/tokens.test.js` measures every pairing in `tokens.css` and fails the suite under the
floor, including for an agency that swaps a colour.

**Provenance placement: appendix by default; both renderings ship.** (26 Jul 2026, spike
#2.) Body reads as prose, sources numbered in a footer. Inline sourcing ships as a second
implementation of the same renderer interface. Which one an agency gets is Agency config,
not a per-pack choice by the recruiter — one copy action, not a menu.

**Visual base: neutral, not the saulera Sunrise palette.** (26 Jul 2026.) The
`dossier-design` skill flagged this as undecided. Neutral wins because this is one
deployment per agency with the engine tracked upstream, and the tool sits inside the
agency's own client relationship, not saulera's. A recruiter forwarding a pack to a trust
should be presenting their own firm. Every colour, type and radius value goes through CSS
custom properties from day one, so an agency's branding is a variable swap and never a
fork.

**Density: current pack structure holds.** (26 Jul 2026, spike #2.) Approved unedited, so
review-to-sendable was reading time. Re-time this on the first real pack in week one — the
spike was synthetic and self-reviewed.

**A candidate sees nothing from the client note unless a recruiter ticks it.** (28 Jul 2026,
#18.) A *section* is one of the note's own markdown headings — the recruiter writes
`## Their process` and that becomes a thing that can be shared; nothing else in this ticket
invents fields. Permission is stored as presence: a row in `note_visibility` (a client id and
a heading slug, no note text) means shared, and no row means hidden, so an empty table is the
fail-closed default for every note already written. Rename a heading and its permission is
dropped, and retyping the old name later does not bring it back. Two sections with the same
name are both unshareable, because a permission that could belong to either could transfer
between them. The gate is `visibleFields()` in `src/note-fields.js`: candidate-facing code
calls it and never reads `client.note`, so forgetting the filter hides a fact rather than
leaking one. The submission pack is unaffected — it still reads the whole note, because the
client is who the note is about.

## Standing constraints

- **No candidate data store.** Candidate, CV and pack are transient — passed in, used, written
  nowhere. Including logs and browser storage. This is the one boundary that is expensive to
  unpick.
- **Nothing unsourced reaches a client.** Claims carry a verbatim source quote, checked
  literally against the input. Anything that fails renders as visibly unverified.
- **One deployment per agency.** Engine tracked upstream, config per client. Not multi-tenant
  SaaS. Spelled out in **Engine and config** below.

## Engine and config

The line between the two is what makes one deployment per agency cheap rather than a fork
per agency. Everything on the engine side is written once here and picked up by every
agency on a pull. Everything on the config side is that agency's own and is never merged
back up.

**Engine — tracked upstream, shared by every agency:**

- `src/` — the pack contract and schema (`pack.js`), the prompt and the paste-prompt builder
  (`prompt.js`), the extractor that recovers a pack from a pasted reply (`paste.js`), the
  provenance verifier (`provenance.js`), both renderers (`render/`), the client knowledge
  store (`store.js`) and the HTTP helpers its endpoints share (`http.js`)
- `functions/api/` — the thin adapters. Storage, plus the two halves of the generation seam:
  `prompt.js` builds the string the recruiter pastes into their own Claude session and
  `verify.js` checks and renders what comes back — **neither of those two calls a model**.
  Architecture §5 names exactly **two** call sites in this deployment and both live here:
  `generate.js` (the pack) and `prep/prepare.js` (the prep brief). A third would be wrong
- `migrations/` — the schema, one reviewable file
- `public/` — the one screen (`index.html`, `app.js`), the note editor (`clients.html`,
  `clients.js`), `tokens.css`, the default token layer, `app.css`, the components built from
  it, and `_headers`
- `scripts/setup-d1.py` and `scripts/dev.py` — binding the databases and the local dev loop.
  There is deliberately no `wrangler.toml` (28 Jul 2026): with one present the CI build
  replaces the project's deployment config with the file's contents and wipes the D1 binding
  on every deploy. Compatibility date and `nodejs_compat` live in the project config, set the
  same way the bindings are; `DEPLOY.md` §1 records the incident

**Config — per agency, never merged upstream:**

- the client knowledge notes (the product's compounding asset, and the agency's own data)
- **the two D1 databases and their `DB` bindings** — one for production, one for preview. That
  agency's notes live in that agency's own database, and nothing about it is in this repo:
  `scripts/setup-d1.py` resolves the ids by name and binds them per deployment
- branding, expressed as overrides of the custom properties in `public/tokens.css` — a
  variable swap, never a fork
- the renderer choice, inline or appendix (settled by the spike as an agency-level
  decision, not a per-pack one)
- the Cloudflare Pages project, the Access policy and the emails it lets in

**The mechanic.** One Cloudflare Pages project per agency. Each agency's deployment tracks
this repo as upstream and pulls engine improvements; nothing gets re-patched across N
forks. That is deliberately not multi-tenant SaaS — bespoke-per-agency is the commercial
shape, and one deployment per agency is its technical form. It is also why a later platform
migration would be one engine migration plus a redeploy per agency, not a rewrite each.
