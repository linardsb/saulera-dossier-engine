# CHECKLIST — run before committing any UI change

MUST/SHOULD/NEVER format (vercel-labs/web-interface-guidelines lineage). A MUST failure blocks the commit.

## Accessibility

- MUST: body/placeholder text contrast ≥4.5:1; large text ≥3:1; meaningful UI components ≥3:1 — under the default theme AND any agency branding swap.
- MUST: complete keyboard path through the whole flow — pick client, paste, generate, review, copy/download, edit the knowledge note — tab order sane, no trap.
- MUST: visible `:focus-visible` state on every interactive element; hover/active/focus states INCREASE contrast, never reduce it.
- MUST: honor `prefers-reduced-motion` — final states render instantly; no entrance runs outside `no-preference`.
- MUST: no information carried by hover only or colour only. Provenance states keep their word ("unverified"), never glyph/colour alone.
- MUST: focus never lands under sticky chrome (`html { scroll-padding-top }` covers deep links and keyboard).
- SHOULD: ARIA sparing and correct (APG patterns); semantic HTML first; the generating state announced to assistive tech (`aria-live="polite"`).
- NEVER: hover-only reveals, colour-only errors, focus outline removal without replacement.

## Motion correctness

- MUST: animate `transform`/`opacity` only; explicit `transition` property lists.
- MUST: every animation ends at the true at-rest state.
- NEVER: `transition: all`. NEVER: ease-in on entrances. NEVER: bounce on page load.
- NEVER: entrance animations on nodes rebuilt every input tick — gate behind a discrete-render class.

## Layout & cross-browser

- MUST: grid/flex items containing wide content (pasted CVs, briefs, long quotes) get `min-width: 0`; wide content scrolls in its own `overflow-x: auto` container (real Safari/Chrome blowout trap).
- MUST: eyeball every new layout in real Safari AND real Chrome — a single bundled engine misses real-engine blowouts.
- MUST: responsive to 360px; no horizontal page scroll ever.
- SHOULD: screenshot iterations served on a fresh port (browser caching trap).

## Data posture & provenance (this product's honesty gate)

- MUST: no candidate material (CV, brief, generated pack) in localStorage, sessionStorage, IndexedDB, cookies, or URLs. Transient means transient — including the browser.
- MUST: navigating away with unsaved pasted input warns first (`beforeunload`); a failed generation keeps the inputs on screen.
- MUST: every rendered claim shows its source type; claims that fail the deterministic quote check render visibly as unverified — never silently passing, never hidden behind hover or a collapsed disclosure.
- MUST: the generating state tells the truth — no fake progress, no invented percentages; if the Function reports nothing, show elapsed time.
- MUST: humanizer pass on all visible copy — no em/en dashes, no "not X but Y", no aphorism headlines, no -ing padding, active voice, plain en-GB words; jargon either replaced or defined inline once.
- SHOULD: the non-personal event counter fires from the success path only (client, timestamp, duration — never names or content).

## Custom-property discipline

- MUST: zero raw hex/px literals in component rules for colour, type, radius, spacing — new values enter the custom-property set first.
- MUST: any new colour pairing gets its contrast checked at definition time, not discovered in review.
- SHOULD: the full property set lives in one file with semantic names (foreground/surface/border/accent/state), so an agency swap is one file.

## Final self-audit (per surface, before calling it done)

Custom interaction present and purposeful · motion reasoned (curve + duration justified) · component built from this product's system, not a pattern library · empty/error/loading states designed · accessibility checks above green · no dropped frames on a low-end throttle. Then the feel bar: decisiveness · instant legibility · unambiguous tactility · state pacing · system consistency · confident close.
