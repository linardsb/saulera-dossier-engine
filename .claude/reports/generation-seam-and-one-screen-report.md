# Implementation Report — the generation seam and the one screen (#6 + #8)

**Plan**: `.claude/plans/generation-seam-and-one-screen.md`
**Branch**: `feature/generation-and-screen`
**Status**: **PARTIAL** — everything mechanical is built and green. Three checks need a human
and were not run: the timed walkthrough through a real Claude session, the real-Safari pass, and
the keyboard-only run. See **Not run** below for the exact commands.

## Summary

Built the generation seam as two Functions either side of the recruiter's own Claude session,
and the one screen at `/` that makes them a single flow. `POST /api/prompt` loads the client
note and assembles SYSTEM + note + brief + CV + the pack schema into one copyable string.
`POST /api/verify` takes the pasted reply back, recovers the pack object from it, checks every
claim's quote literally against the CV and the note, renders through #7's renderers and records
the event. **No model call, no API key, no runtime SDK and no `nodejs_compat` were added** — the
reverted design (`3d72737` / `5e311d1`) stays reverted, and `@anthropic-ai/sdk` remains a
devDependency used only by `spike/run.js`.

Also fixed the palette bug that would have made the product's central marking illegible:
`--verified` and `--unverified` were aliases of colours measuring 2.28:1 and 2.98:1.

## Tasks completed

| Task | File | |
|---|---|---|
| Provenance tokens redefined against measured contrast | `public/tokens.css` | UPDATE |
| Contrast gate over the whole palette | `test/tokens.test.js` | CREATE |
| Blocks factored, `buildPastePrompt`, `INPUT_MAX`, `cleanInput` | `src/prompt.js` | UPDATE |
| Pack extractor for a pasted chat reply | `src/paste.js` | CREATE |
| Paste-prompt builder tests, incl. the `buildMessages` regression pin | `test/prompt.test.js` | CREATE |
| Extractor tests, adversarial | `test/paste.test.js` | CREATE |
| `POST /api/prompt` | `functions/api/prompt.js` | CREATE |
| `POST /api/verify` | `functions/api/verify.js` | CREATE |
| Both Functions driven end to end with `fakeD1` | `test/seam.test.js` | CREATE |
| The one screen's markup | `public/index.html` | UPDATE (replaced the shell) |
| Act, claim, mark and pack components | `public/app.css` | UPDATE (appended) |
| The screen's behaviour | `public/app.js` | CREATE |
| Nine browser probes | `.claude/probes/one-screen.mjs` | CREATE |
| Three response headers | `public/_headers` | CREATE |
| Status, Model access, palette entry, engine list | `README.md` | UPDATE |
| §5b, §6 smoke checklist, three deferrals re-scoped | `DEPLOY.md` | UPDATE |
| The latency row replaced by the round trip | `spike/README.md` | UPDATE |

## Tests added

`npm test` is **219 passing, 0 failing on Node v20.20.2 and v24.11.0** at head. It was **161** when
this report was written: the 83 already in the suite plus the 78 in the four files below. The
remaining 58 are `test/extract.test.js`, added in a later commit to give `public/extract.js`
coverage. The existing test files are untouched and all still pass.

> This line first read "161 passing … (was 140 before)". 140 was wrong at every reading: the suite
> was 65 at the branch point and 83 immediately before this ticket, once `test/render.test.js`
> landed with #7. These are counted per file, not recalled.

- **`test/tokens.test.js`** — 17 tests. Parses `tokens.css`, computes WCAG relative luminance,
  asserts a floor for every pairing that renders, and requires the provenance three to be
  literal hex rather than aliases.
- **`test/paste.test.js`** — 22 tests. Bare / fenced / bare-fenced / prose-wrapped JSON; trailing
  prose containing `}`; a quote containing braces, an escaped `"` and a `\\` before a quote; two
  fenced blocks; empty, whitespace, `null`, prose-only and truncated input; array/string/number
  rejected; the thrown message proven to carry no part of the input; and the real
  `spike/pack.json` surviving extract → `assertPack` → `verifyPack` with zero failures.
- **`test/prompt.test.js`** — 18 tests. Pins both `buildMessages` content blocks byte-for-byte
  and the `cache_control` marker; asserts the paste prompt carries SYSTEM verbatim, the note
  before the brief and CV, the whole serialised schema including the verbatim-quote rule; and
  `cleanInput`'s boundaries including exactly `INPUT_MAX`.
- **`test/seam.test.js`** — 21 tests. Both Functions imported and driven with `fakeD1`. Covers
  the happy paths, `not_configured`, `cross_origin`, `bad_json`, `unexpected_fields`,
  `not_found`, `note_empty`, `missing_fields`, `too_long`, `no_pack`, `bad_pack` (400, not 500),
  `not_migrated`, a `recordEvent` failure still returning 201 with `event_recorded: false`, the
  events SQL mentioning no forbidden column, and an edited note demoting fail-closed.

### Two assertions were verified by breaking the code on purpose

Both gates were confirmed to fail before being trusted:

1. Re-aliasing `--verified` to `--success` in `tokens.css` → 4 failures. Restored → 17 pass.
2. Changing `render(verified.pack, …)` to `render(pack, …)` in `functions/api/verify.js` →
   `test/seam.test.js` failure. **The first version of that assertion did not catch it.** It
   read `assert.match(body.text, /UNVERIFIED/)`, and the spike pack already contains one
   honestly-unverified claim, so the regex matched whether the verified or the pasted pack was
   rendered. It now compares the marker count against a clean-pack baseline and asserts the
   citation count drops by one. Re-tested: the bug now fails the suite.

## Validation results

**Level 1** — all clean: no browser storage in `public/`, no `console.` in `src/` or
`functions/`, no DOM injection in `app.js`, no raw hex in component CSS, no `transition: all`,
no positive `tabindex`, no runtime SDK / key / `nodejs_compat`, `@anthropic-ai/sdk` in
`devDependencies` only, and `node --check` passes on every JS file.

**Levels 2 and 3** — 219/219 on Node v20 and v24.

**Level 5, browser probes** — `10/10 pass` (`node .claude/probes/one-screen.mjs`, needs Node ≥ 22),
plus `11/11` on `node .claude/probes/extract-docx.mjs`.

> **Corrected after review of PR #14.** This section first recorded 161 tests and 10/10 probes and
> then went stale by two commits. Worse, probe 1 was red at head for a reason that had nothing to
> do with the code it guards: it issued the client switch as a separate CDP call *after* the click,
> and `copyPrompt()` opens a real tab to claude.ai inside that click, so the round trip outlasted
> the stubbed 500ms response and the switch landed too late to race it. The probe then read the
> reset screen and reported a stale write. The switch is now scheduled from inside the page and
> the probe asserts that it landed mid-flight, so it fails loudly rather than silently testing
> nothing. The guard in `app.js:520-531` was correct throughout and is unchanged.

1. `/api/prompt` landing after a client switch copies nothing, starts no clock, stays in act 1
2. `/api/verify` landing after a client switch renders no pack
3. A failed `/api/verify` keeps the pasted reply and the frozen inputs
4. `note_empty` renders its own copy plus a link to `/clients?client=<id>`
5. A demoted claim renders "Quote not found", shows the failed quote, and is still in the DOM
6. No horizontal scroll at 360px with a 120-character name and 400-character unbroken lines
7. The clock is stopped on every exit from the wait — 3 ticks in 3.2s after three waits, not 9
8. *(added)* The prompt reaches the clipboard after the round trip, and so does the pack
9. *(added)* A refused clipboard shows the prompt to copy by hand and stays in act 1
10. *(added)* The switch-client confirm names a deep-linked client, and pressing "Read the pack"
    a second time issues no second `/api/verify`

**Level 4, against a real `wrangler pages dev` with real D1** — `python3 scripts/dev.py`, all
verified by curl and by driving real headless Chrome against it:

- `/` serves three acts; `_headers` applied (`x-content-type-options`, `referrer-policy`,
  `x-frame-options` all present on the response)
- `POST /api/prompt` → 200, keys exactly `["client","prompt"]`, 11,200-character prompt carrying
  the note and the schema, and **no note field anywhere else in the body**
- `POST /api/verify` over a realistic paste (prose + fenced block + trailing prose containing
  `{anything}`) → 201, `{cv: 9, client_note: 4, unverified: 1, total: 14}`, zero failures,
  4,467 characters of text and 6,549 of html
- A tampered quote → total still 14, unverified 1 → 2, `failed_quote` preserved, UNVERIFIED
  count in the copied text 2 → 3, and the failed quote absent from the SOURCES appendix
- Whitespace-only note → `note_empty`; garbage paste → 400 `no_pack`; bad `source_type` → 400
  `bad_pack` (not 500); `GET /api/events` shows the event with its round-trip duration
- The screen boots against the real server in headless Chrome: rail populated from D1, 44px tap
  target, labels on both textareas, four live regions, no console errors, and
  `scrollWidth === innerWidth` at 360px, 390px and 1440px
- `node spike/local.js` still passes all 14 claims, unchanged

## Deviations from the plan

1. **`/api/verify` also runs `cleanInput(body.cv, "cv")`.** The plan passed `body.cv` straight
   to `verifyPack`. An empty or missing CV would then have returned 201 with every CV-sourced
   claim silently demoted — a pack that looks bad for a reason that is not the model's fault.
   It now answers 400 `missing_fields`, which the screen already had copy for. Trimming is safe:
   `normalise()` in `provenance.js` trims and collapses whitespace before comparing anyway.

2. **The clipboard write is a promise-valued `ClipboardItem`, not a post-await `writeText`.**
   The plan's act 1 step 3 said to call `writeText` "on success, synchronously in the same
   handler", which is self-contradictory — "on success" is after an awaited POST. The fetch is
   now started in the click handler and its promise is passed as the item's value, so the write
   is issued while the gesture is live. Verified working in real Chrome by probe 8. The
   readonly-textarea fallback the plan asked for is kept and is verified by probe 9.

3. **That promise rejects if the recruiter switches client mid-flight.** A promise-valued write
   is committed at click time, so without this the clipboard would end up holding the previous
   client's prompt with nothing on screen saying so, one paste away from the wrong trust.
   Probe 1 covers it — though only since the review of PR #14, which found that the probe's own
   timing had stopped putting the switch inside the flight window. See the correction above.

4. **A failed claim renders its quote once, not twice.** Caught by looking at a screenshot, not
   by a test. `verifyPack` demotes by copying `source_quote` into `failed_quote` and leaving
   `source_quote` in place, so rendering both printed the same sentence twice — once styled as
   evidence and once as the thing that is not evidence.

5. **Act 1 does not collapse when frozen.** The plan's design critique asked me to try it and
   to keep it expanded if collapsing costs the recruiter the ability to re-read what they pasted
   while checking the pack. It does: checking a claim against the CV is the review task. All
   three acts stay on the page; focus moves to **Copy the pack** on success, which scrolls the
   pack into view.

6. **Three probes added beyond the plan's seven.** Probe 1 passes both when the stale write is
   correctly withheld *and* when the clipboard never works at all. Probe 8 is the negative
   control that tells those apart; probe 9 covers the refusal path; probe 10 covers 10a and 10b
   below. A third way for probe 1 to be uninformative surfaced in review — the switch arriving
   after the response, so the race is never run — and that one it now asserts against itself
   rather than relying on another probe to catch.

10. **Three defects found in review after the first green run, all fixed and now covered by
    probe 10 or by the README itself:**
    - **(a) The switch-client confirm did not name a deep-linked client.** `state.clientName`
      was only set from a row click, so arriving at `/?client=<id>` or via Back left it empty
      and the confirm fell back to its unnamed wording — in exactly the bookmark case it was
      written for. `renderList` now sets it whenever it renders the selected row, which covers
      every path into `load()`.
    - **(b) A second press of "Read the pack" recorded a second event.** Act 2 stays visible in
      phase `pack`, so the button was still live; pressing it re-POSTed with
      `Date.now() - state.startedAt` still measured from the original copy-prompt — one pack,
      two events, the second carrying a span that included the first attempt. **Decision
      recorded rather than papered over: a re-read is not a new pack.** `readPack` now returns
      unless the phase is `waiting`, and `setPhase` marks the button `aria-disabled` in phase
      `pack` so it says so rather than only refusing. A genuinely different pack means Start
      again, which keeps the brief and the CV and costs one more click.
    - **(c) A README Decisions heading had become false.** "Pages Functions return, for storage
      only" stopped being true the moment `/api/prompt` and `/api/verify` existed. That section
      opens *"Recorded here so they don't get re-litigated per ticket"*, so a stale heading
      there is the worst place for one. It now says storage **and** the two halves of the seam,
      never a model call, and records why they are Functions rather than client-side JavaScript.

7. **Below 600px the provenance mark sits under the claim rather than beside it.** "Quote not
   found" is ~120px of unbreakable text; beside a claim in a 282px-wide pack it left the claim
   about twenty characters a line. DOM order is unchanged, so reading order is unchanged.

8. **Three of the plan's Level 1 greps were sharpened, because as written they fire on
   comments.** This repo's own convention (`clients.js:11-12`) is that a gate which cries wolf
   at a comment gets deleted, so:
   - `app.js` never spells the DOM-injection property name, matching how `clients.js` avoids
     spelling the storage APIs. The plan's grep now passes as written.
   - `--success` / `--warning`: the plan asked for a comment naming the old values *and* a grep
     that the comment trips. The gate run is now `var(--success)` usage plus any redeclaration.
   - `anthropic|ANTHROPIC_API_KEY`: `wrangler.toml:2` is a pre-existing comment asserting there
     is no key. Comment lines are excluded rather than that line being edited.

9. **`tokens.css` and `DEPLOY.md` no longer point web fonts at #8** (plan Open Question 3), and
   the DEPLOY.md Access-service-token deferral is re-scoped, since there is no model latency on
   this deployment left to measure automatically.

## Not run — these need you

Everything below needs a human, a stopwatch, or a browser I cannot drive. **Nothing here is
reported as passing, and no round-trip number is recorded, because none was measured.**

| Check | Command / how |
|---|---|
| **The timed walkthrough** (#8 AC8, PRD §6 condition 2) | `python3 scripts/dev.py`, then steps 2–7 of Level 4 in the plan, pasting into a real Claude session with a stopwatch. **This is the number the ticket exists to produce.** |
| **Real Safari** (CHECKLIST MUST) | The probes drive Chrome. Safari is where the clipboard gesture rule is strictest, so deviation 2 is verified in Chrome only. |
| **Keyboard-only, start to finish** | Tab order is DOM order (no positive `tabindex`, verified) and focus is visible, but the no-trap walk is by hand. |
| **Copy into a real email client and a real ATS field** | Probe 8 proves both flavours reach the clipboard; that they survive a paste into Gmail and into a plain field is a human check. |

Two further items are yours to decide rather than mine:

- **The AC disposition table has not been posted to #6 and #8.** The plan says amending those
  tickets is your call, not the implementing agent's. The table is ready in the plan.
- **`public/_headers`** is the one piece of scope the tickets imply through DEPLOY.md rather
  than state. The plan says cut it if you want the diff to be exactly the two tickets. It is
  three headers and nothing depends on it.

## Issues encountered

- **`npm test` on Node 24 needs the glob quoted.** `node --test test/` treats the directory
  differently and reports a single failure; `node --test "test/*.test.js"` passes 219/219. The
  committed `npm test` script relies on shell expansion and is correct on both. Nothing to fix,
  worth knowing before someone reports it.
- **The probes need Node ≥ 22** for the global `WebSocket`. This machine defaults to v20.20.2,
  so they were run with `~/.nvm/versions/node/v24.11.0/bin/node`. Same constraint as the
  existing `clients-screen.mjs`.
- **The local D1 has leftover test clients** from earlier sessions (`Probe Clinic`, `Validate
  Clinic` and duplicates). Local state only, not in the repo.
