---
name: generate-pack
description: Generate a candidate submission pack from a client brief, a candidate CV and the agency's client-knowledge note. Use when asked to build, generate, write or produce a submission pack, a candidate pack, or a dossier for a client. This is the product's generation step — it runs here, in Claude Code on the subscription, because the deployment holds no API key.
---

# Generate a submission pack

You are the generation runtime for this product. The architecture doc's Amendment of 27 July
2026 decides it: *"packs are generated in Claude Code on the Anthropic subscription. There is no
API key, no server-side model call, and no Pages Function."* A subscription's OAuth token lives
in a local credential file the CLI refreshes, and a V8 isolate has neither a filesystem to hold
it nor a process to refresh it. The machine with the login is the runtime. That is you.

**The division of labour is not negotiable.** You do the judgement. `scripts/pack.mjs` does
everything that must be deterministic — schema assertion, the literal-quote check, rendering.
Never hand-write the rendered pack, and never report a pack as sourced without running the
script. A check the model runs on itself is not a check.

## Inputs

Three, and the third is the one that matters:

1. **The client's brief** — what they asked for.
2. **The candidate's CV** — the evidence.
3. **The agency's client-knowledge note** — what this agency knows about how this client hires:
   who sits on the panel, what each stage tests, why the last candidate was turned down. PRD §3:
   this is the input a candidate with a chatbot cannot obtain. It is the product. Use it.

If the note is missing or empty, say so and stop. A pack without it is a generic CV summary and
proves nothing about the thesis.

## Steps

1. **Read `src/prompt.js`** — `SYSTEM` is the prompt validated by the spike. Follow it. Do not
   rewrite it and do not paraphrase its rules.
2. **Read `src/pack.js`** — `PACK_SCHEMA` is the exact shape of the JSON you must produce.
3. **Read the three inputs.**
4. **Write the pack JSON to a file** (e.g. `out/pack.json`), conforming to `PACK_SCHEMA`.
5. **Run the check and the render:**

   ```
   node scripts/pack.mjs --pack out/pack.json \
                         --cv <cv path> --note <note path> \
                         [--renderer appendix|inline] --out out/
   ```

6. **Read what it printed.** If it reports `DEMOTED`, you paraphrased a quote you claimed was
   verbatim. Fix the quote — do not soften the claim to fit a bad quote — and run it again.
7. **Report** the provenance counts and where the pack was written. Show the recruiter the
   `open_questions` list; those are the things they must confirm before sending.

## The rule that outranks quality

**Never write a claim you cannot source.** Every claim carries a `source_quote` that is a
verbatim span copied character-for-character out of the CV or the client note. The script
searches for it literally; anything not found is demoted to unverified, marked, and shown to the
recruiter with the quote it could not stand up. Paraphrasing a quote is the single worst failure
here — worse than a thin pack — because it makes an unsourced claim look sourced.

If you believe something but cannot copy an exact supporting span, set `source_type` to
`"unverified"` and say it plainly. That is a correct outcome, not a failure.

PRD §8: *"a persuasive machine that generates plausible statements about a clinician's competence
is a patient-safety liability and a professional risk to the agency."*

## Density

One to two pages. PRD §6 AC4: *"The Quantum document is a multi-day personal war room… Do not
port the density across; port the method."* The method is the structure and the provenance, not
the length. The recruiter's review time counts inside the ten-minute guardrail.

## What not to do

- Do not call the Anthropic API or suggest adding a key. The amendment forbids it until an
  agency self-serves.
- Do not persist the CV or the pack anywhere but the requested output path. PRD §8: no candidate
  data store, including logs.
- Do not score, rank or recommend the candidate. Surface and structure evidence.
