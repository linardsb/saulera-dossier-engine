# CRAFT — numeric rules for every surface

Synthesized from Dammyjay93/interface-design (craft) and vercel-labs/web-interface-guidelines (hue/radius details). All values flow through CSS custom properties — where a number here conflicts with a committed custom property, the property wins; change the property rather than hard-coding.

## Typography

- **Scale from a ratio, then step it.** This is a dense working tool: ~1.2 (minor third). Example at 14px base: caption 12 · body 14 · h4 17 · h3 20 · h2 24 · h1 29. Define the ramp as custom properties once; never a one-off px.
- **Display type is the personality carrier** — here that is the pack preview's heading treatment, not a marketing hero. Balance multi-line headings (`text-wrap: balance`).
- **Body measure 65–75ch.** The pack preview especially: it renders prose a client will read. Never a full-width paragraph.
- **Emphasis = weight or size.** Never gradient text, never colour-only emphasis — provenance marks carry a word or glyph-with-label, not colour alone.
- **Body text ≥14px, prefer 16px for the pack itself.** Nothing visible below 12px, including source quotes and captions.

## Spacing & layout

- **4px grid.** Rhythm between the screen's zones (client picker · inputs · pack preview · knowledge note) must be visibly larger than spacing within them — the state pacing is built from whitespace steps, not dividers.
- **Nested radii: child ≤ parent, concentric.** Pick radii from the custom-property set; no uniform rounding of everything (slop tell).
- **Hairlines for structure only when they encode grouping** the whitespace can't; prefer whitespace first.
- **Grid/flex items holding wide content (pasted CVs, briefs, long quotes, URLs) get `min-width: 0`** and their own `overflow-x: auto` container — real Safari/Chrome blowout trap with wide unbreakable content.

## Colour (60/30/10, through custom properties)

- **~60% dominant neutral surface, ~30% secondary tone, ≤10% accent.** One accent used with intention beats five without thought. Candidate accent budget here: one action colour (Generate / Copy), one provenance-warning treatment for unverified claims. They must not compete.
- **Every colour traces to a semantic custom property** (foreground, surface, border, accent, semantic states). No raw hex in component rules — this is also what makes per-agency branding a variable swap.
- **Contrast: body/placeholder text ≥4.5:1, large text ≥3:1, UI components/borders-that-matter ≥3:1.** Holds under every agency branding — check the swap, not just the default.
- **On coloured/dark surfaces, tint secondary text and borders toward the surface hue** — never a flat gray that fights the surface.

## Motion

A working tool wants less motion than a showcase; what remains must be reasoned.

- **Character rule:** subtle ease-out for entrances · a touch response on things you press · settle (critically damped) for things that arrive. Nothing bounces on page load.
- **Ease-out for everything entering or interactive; never ease-in** — ease-in delays the first frame, the one the user is watching. Reference curve: cubic-bezier(0.23, 1, 0.32, 1), defined once as a custom property.
- **Durations:** micro-interactions 150–300ms; larger transitions 300–500ms. The one authored moment is the generating→review transition — the pack arriving is the payoff, design it.
- **Compositor props only:** animate `transform` and `opacity`. Never `transition: all` — list properties explicitly.
- **Every animation ends at the true at-rest state**; entrances run only under `prefers-reduced-motion: no-preference`; reduced motion renders final states instantly.
- **The generating state is honest.** Elapsed time or staged truthful messages ("reading the brief…") tied to real progress where the Function reports it; never a fake percentage, never an indeterminate spinner as the only signal for a multi-second wait.
- **Never attach entrance animations to nodes rebuilt on every input tick** — they restart and blank. Gate behind a discrete-render class.

## Interactive states (all six, every component)

Design hover · focus-visible · active · disabled · loading · error/empty for every interactive component before calling it done. Also: real content, working controls, responsive composition to 360px (a recruiter will open this on a phone even if the primary surface is a laptop).

- **Hit areas:** effective target ≥44×44px on touch, ≥24px minimum anywhere; if the visible control is smaller, extend with a pseudo-element.
- **Press feedback** on everything pressable — `:active` state that visibly responds.
- **Hover must add contrast or motion, never remove information.** No hover-only content — provenance sources are visible or one designed click away, never hover-gated.
- **Loading/empty:** the empty client list invites adding the first client; a failed generation says what failed and keeps the pasted inputs on screen (they are transient — losing them is the real error state).
