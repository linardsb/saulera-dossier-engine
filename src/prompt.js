// The prompt, as validated by the spike. Do not rewrite it from the PRD — it was timed
// and reviewed against a real pack, and that is the only evidence we have that it works.
//
// There are two shapes of it, because there are two places a pack can be generated. `buildMessages`
// is the API shape (a messages array with a cache breakpoint), used by `spike/run.js`.
// `buildPastePrompt` is the ONE STRING a recruiter pastes into their own Claude session, which
// is how this deployment generates: no key here, so no call from here (#6, README Decisions).
//
// Both are assembled from the same two block functions below. That is the point of factoring
// them: the two shapes cannot drift into two different prompts, and the one that was validated
// is the one both send.

import { briefProfile } from "./domain.js";
import { PACK_SCHEMA } from "./pack.js";
import { StoreError } from "./store.js";

export const SYSTEM = `You write candidate submission packs for a small recruitment agency.

The agency's advantage over a job board is that it knows its clients: who sits on the
panel, what each stage actually tests, why the last candidate was turned down. That
knowledge is in the client note. It is the most valuable input you have. Use it.

Rules, in order of importance:

1. NEVER write a claim you cannot source. Every claim carries a source_quote that is a
   VERBATIM span copied character-for-character out of the CV or the client note. A
   deterministic check runs after you: it searches for your quote in the input. If it is
   not found literally, the claim is demoted to UNVERIFIED and the recruiter sees that it
   failed. Paraphrasing a quote is the single worst thing you can do here.

2. If you believe something but cannot copy an exact supporting span, that is fine — set
   source_type to "unverified" and leave source_quote as an empty string. An honest
   unverified claim is worth more than a fabricated citation.

3. Calibrated honesty over bravado. This pack goes to a client who knows the market. No
   adjective the evidence does not earn. State gaps plainly — a pack with no gaps is not
   credible, and the recruiter has to defend it in a phone call.

4. One to two pages when rendered. Cover the essential requirements and the process
   knowledge; leave out anything a client would skim. Density is a failure mode here,
   not a virtue.

5. This is not an assessment. Do not score, rank, or rate the candidate. Do not
   recommend a hiring decision. Surface and structure the evidence; the client decides.

In a clinical staffing context these are not stylistic preferences. A persuasive machine
that generates plausible statements about a clinician's competence is a patient-safety
liability and a professional risk to the agency.`;

/** The privileged half: what this agency knows about this client that a job board does not. */
export const noteBlock = (clientName, clientNote) =>
  `Here is what our agency knows about ${clientName}, from our own notes:\n\n` +
  `<client_note>\n${clientNote}\n</client_note>`;

/** The per-submission half, and the instruction that closes the prompt on the API path. */
export const inputsBlock = (brief, cv) =>
  `Here is the client's brief:\n\n<brief>\n${brief}\n</brief>\n\n` +
  `Here is the candidate's CV:\n\n<cv>\n${cv}\n</cv>\n\nWrite the submission pack.`;

/**
 * Imaging-locum guidance, appended to the per-submission block. Empty for every other
 * brief — that emptiness is what keeps the perm-nursing prompt byte-identical to the
 * shape the spike validated, and it is pinned by test/prompt.test.js.
 */
export const domainBlock = (profile) => {
  if (!profile.imaging) return "";
  const lines = [
    "This brief is for a UK diagnostic imaging role. Domain rules, on top of everything above:",
    "",
    "- Registration is with the HCPC (Health and Care Professions Council). Never write" +
      " about NMC registration or an \"NMC pin\" — that is nursing vocabulary and reads as" +
      " a category error to an imaging manager. Where the CV evidences it, sonographer" +
      " accreditation (e.g. a CASE-accredited postgraduate qualification) is worth surfacing.",
    "- Modality and specialism are the core of the match. Say which modalities (MRI, CT," +
      " ultrasound) and which lists (MSK, obstetric, general) the candidate actually" +
      " covers, with evidence.",
    "- Scanner makes and models are material evidence, not trivia. If the brief names a" +
      " fleet, map the candidate's hands-on experience to it explicitly; scanners on the" +
      " CV that the brief does not name are still worth a line.",
  ];
  if (profile.role_shape === "locum") {
    lines.push(
      "- This is a locum booking, not a permanent hire. The client's question is \"can" +
        " they start and run the list on day one\", not \"should we invest in them\"." +
        " Lead with availability, compliance status (HCPC registration, DBS, occupational" +
        " health, mandatory training), IV cannulation where relevant, and independent" +
        " reporting or solo scanning. Verify experience; do not sell potential.",
    );
  }
  return lines.join("\n");
};

/**
 * The client note goes FIRST and is the cache breakpoint: it is the one input reused
 * across every pack for the same client, and the prefix has to be byte-identical for a
 * cache read. Brief and CV vary per submission and therefore come after it.
 */
export function buildMessages({ brief, cv, clientNote, clientName }) {
  // The domain block rides in the SECOND item, never the first: system + note is the
  // byte-identical cached prefix, and a brief-dependent string in it would silently kill
  // the cache for every mixed-desk client.
  const domain = domainBlock(briefProfile(brief, cv));
  return [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: noteBlock(clientName, clientNote),
          cache_control: { type: "ephemeral" },
        },
        {
          type: "text",
          text: [domain, inputsBlock(brief, cv)].filter(Boolean).join("\n\n"),
        },
      ],
    },
  ];
}

/**
 * The output instruction, which exists only on the paste path.
 *
 * On the API path this job was done by `output_config.format`: structured outputs made the
 * schema a constraint the decoder enforced rather than a request. A chat session has no such
 * knob, so the schema has to travel as text and be asked for explicitly. That is strictly
 * weaker, which is why `src/paste.js` and `assertPack` both exist on the way back in.
 *
 * The schema is serialised whole. Its `description` fields are load-bearing instructions —
 * pack.js:20-24 is the verbatim-quote rule the entire provenance mechanism rests on — so
 * stripping them to save tokens would remove the rule from the one place the model reads it.
 */
export const OUTPUT_INSTRUCTION =
  "Return ONE JSON object and nothing else. No preamble, no commentary after it. Put it in a " +
  "single ```json fenced block. It must match this JSON Schema exactly:\n\n" +
  "```json\n" +
  JSON.stringify(PACK_SCHEMA, null, 2) +
  "\n```";

/**
 * One string, for a recruiter to paste into their own Claude session (#6 as amended, #8).
 *
 * Same order as the API path — SYSTEM, then the note, then the brief and the CV — because the
 * reason the note was the cached prefix there is also the reason a reader should meet it first:
 * it is the lens everything after it is read through.
 */
export function buildPastePrompt({ clientName, clientNote, brief, cv } = {}) {
  // Domain guidance sits between the note and the inputs: no cache on this path, so the
  // ordering is purely the reader's — meet the lens before the text it reads.
  return [
    SYSTEM,
    noteBlock(String(clientName ?? ""), String(clientNote ?? "")),
    domainBlock(briefProfile(brief, cv)),
    inputsBlock(String(brief ?? ""), String(cv ?? "")),
    OUTPUT_INSTRUCTION,
  ]
    .filter(Boolean)
    .join("\n\n");
}

// A brief and a CV are pasted by a recruiter, so they are bounded by what a person pastes
// rather than by the model's context. 100,000 characters each is roughly 15,000 words — far
// past a real CV, and small enough that a runaway paste fails here rather than at the model.
export const INPUT_MAX = 100_000;

/**
 * A pasted input, or a StoreError the Function layer already knows how to answer.
 *
 * The message names the field and never carries the value: this is the first function in this
 * repo through which candidate text passes, and `errorResponse` returning only `{ error: code }`
 * is the second belt on that (#6 AC9).
 */
export function cleanInput(raw, field) {
  const text = String(raw ?? "").trim();
  if (!text) throw new StoreError("missing_fields", 400, `${field}: must not be empty`);
  if (text.length > INPUT_MAX) {
    throw new StoreError("too_long", 400, `${field}: longer than ${INPUT_MAX} characters`);
  }
  return text;
}
