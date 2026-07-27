---
name: dossier-design
description: House frontend-design skill for the agency-submission-dossier engine. Activate when building or reviewing ANY UI for this product — the one-screen tool, the client-knowledge note editor, pack rendering, loading/provenance states. Combines direction (Anthropic frontend-design lineage), numeric craft rules (references/CRAFT.md), and a correctness checklist (references/CHECKLIST.md) with this product's decided constraints — speed as the adoption condition, provenance rendered visibly, candidate data never persisted. Read references/CRAFT.md before writing CSS; run references/CHECKLIST.md before committing.
---

# Dossier design — the tool must earn the next use

You are designing a working tool for a recruiter on a busy Thursday: pick a client, paste a brief and a CV, get a sendable pack. The bar is not spectacle; it is that the pack is faster to produce than the paragraph it replaces, and visibly better (PRD §4, the switch test). A junior consultant under deadline pressure is the person most likely to abandon it — design for that person.

Governing docs: `agency-submission-dossier.prd.md` (problem, hypothesis, §4 speed guardrail, §8 boundaries) and `agency-submission-dossier.architecture.md` (stack, data posture, provenance mechanism, §6 branches). If a design choice would contradict either, stop and flag it.

## Hard constraints (never trade away)

- **One screen.** Pick client · paste brief + CV · generate · review · copy or download. The client-knowledge note is editable on the same screen — the note is the product; generation is the cheap part (architecture §4).
- **Speed is the adoption condition, not a performance goal.** Generation takes real seconds (Opus 5 with thinking over a 10k-token input — architecture §5.2). The UI owns that wait: a designed generating state that tells the truth about progress, never a frozen button or a fake percentage. Everything before and after the wait must be near-instant.
- **Provenance is a rendered surface, not a footnote.** Every claim in the pack carries its source (`cv`, `client_note`, or `unverified`). Anything unverified renders visibly marked for the recruiter to confirm — never silently passing, never hidden in a tooltip (architecture §5.4). This is the strongest claim the product makes; the UI is where it becomes checkable.
- **Candidate data is transient.** CV and brief content is never persisted — which includes the browser: no localStorage/sessionStorage drafts of candidate material, no candidate content in URLs. Losing a paste on refresh is a designed moment (warn before unload), not a reason to cache.
- **Per-agency branding is configuration.** One deployment per agency, engine tracked upstream (architecture §5.1). All colour, type, and radius flows through CSS custom properties from day one, so an agency's branding is a variable swap, never a fork. No raw hex in component rules.
- **Copy.** Humanizer rules: no em/en dashes in visible copy, no "not X but Y", no aphorisms, no -ing padding, plain words, active voice. A control says exactly what it does ("Generate pack", never "Submit"); errors say what went wrong and how to fix it, without apologising; an empty state is an invitation to act. Register is en-GB, professional, calm — the reader may be showing this screen to an NHS trust.

## Direction (a tool with a point of view, not a template)

Deliberate, opinionated choices justified by THIS subject: evidence-anchored packs built from privileged client knowledge.

- **The screen states the thesis.** The most characteristic thing in this product's world is a claim sitting beside its verbatim source. Let that pairing carry the visual identity — the pack preview with its provenance marks is the signature surface.
- **One signature element per surface.** Spend all boldness in one place (the pack render and its provenance marks); keep the input side quiet and disciplined.
- **Structure is information.** The pack's sections, the source types, the verified/unverified split — these are genuinely ordered and genuinely mean something, so labels and grouping encode them. Decorative numbering and dividers that encode nothing do not ship.
- **Anti-slop calibration.** Actively avoid the generic AI looks: cream + serif + terracotta; near-black + single acid accent; purple gradients; gradient text; uniform rounded corners; excessive centered layouts; decoration without information.
- **Two-pass process.** (1) Plan before code: palette roles, type roles, layout concept (one-sentence prose + ASCII wireframe), and the signature element — then critique the plan: "would I have produced this for any similar brief?" If yes, revise before building. (2) Build, then critique with screenshots (serve on a fresh port each iteration — browser caching is aggressive), in real Safari AND Chrome.
- **The feel bar:** decisiveness (one idea per state, stated plainly) · instant legibility (a first-time consultant knows what to do in a second) · unambiguous tactility (everything clickable announces itself) · state pacing (idle → generating → review reads as distinct acts) · system consistency (one button/heading/card grammar everywhere) · a confident close (the copy/download moment is one action, not a pile of options).

## Open design decisions (flag, don't assume)

The visual base is not decided in the architecture doc. The saulera design system (Sunrise palette, the `saulera-design` skill) is available as a starting register since this is a saulera product, but the agency-branding requirement may pull toward a more neutral base. Raise it before committing a palette.

## Craft numbers

Read `references/CRAFT.md` before writing CSS: type scale and measure, spacing rhythm, the 60/30/10 colour discipline through custom properties, motion curves and durations, state coverage, hit areas.

## Correctness gate

Run `references/CHECKLIST.md` before committing any UI change: accessibility MUSTs (contrast numbers, keyboard paths, reduced motion), motion-correctness rules (compositor props only, no transition:all), cross-browser layout traps, and this product's data-posture and provenance MUSTs.

## Lineage (who these rules come from)

Anthropic frontend-design lineage (two-pass, anti-slop, signature element) · Dammyjay93/interface-design and vercel-labs/web-interface-guidelines (craft numbers, checklist format) · the ux-factory portfolio-design skill, ported 26 July 2026 and retuned to this product's PRD + architecture.
