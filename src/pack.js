// The canonical pack contract (#4). One structured pack out of generation; rendering to
// a target is a separate, dumb step (architecture §5.5).
//
// The shape here is what the spike validated — do not redesign it from the PRD.
// Structured outputs reject recursive schemas and numeric/length constraints, and every
// object needs additionalProperties: false.

import { ROLE_SHAPES } from "./domain.js";

export const SOURCE_TYPES = ["cv", "client_note", "unverified"];

// Re-exported so render code (#49) can take the role-shape contract from the pack contract
// rather than reaching into the parser.
export { ROLE_SHAPES };

const claim = (extra = {}) => ({
  type: "object",
  additionalProperties: false,
  properties: {
    text: {
      type: "string",
      description:
        "The claim, as it should read to the client. One sentence. Never overclaim.",
    },
    source_quote: {
      type: "string",
      description:
        "A VERBATIM span copied character-for-character from the CV or the client note. " +
        "Do not paraphrase, summarise, or tidy it. If you cannot copy an exact span that " +
        "supports the claim, set source_type to 'unverified' and put an empty string here.",
    },
    source_type: { type: "string", enum: SOURCE_TYPES },
    ...extra,
  },
  required: ["text", "source_quote", "source_type", ...Object.keys(extra)],
});

export const PACK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    candidate_ref: { type: "string" },
    role_title: { type: "string" },
    headline: {
      type: "string",
      description:
        "One sentence a consultant would put at the top of the email. Why this candidate " +
        "for this client. No adjectives that aren't earned by the evidence.",
    },
    evidence: {
      type: "array",
      description:
        "Each essential requirement in the brief, mapped to the candidate's actual evidence.",
      items: claim({
        requirement: {
          type: "string",
          description: "The requirement from the brief this addresses.",
        },
      }),
    },
    process_fit: {
      type: "array",
      description:
        "What the agency knows about THIS client's process, and how the candidate maps to " +
        "it. This is the part a job board cannot produce. Source from the client note.",
      items: claim(),
    },
    gaps: {
      type: "array",
      description:
        "Where the candidate does not meet the brief, stated plainly. A pack with no gaps " +
        "is not credible.",
      items: claim(),
    },
    open_questions: {
      type: "array",
      description: "What the recruiter should confirm before sending. Plain strings.",
      items: { type: "string" },
    },
    role_shape: {
      type: "string",
      enum: ROLE_SHAPES,
      description:
        "'locum' if the brief is temporary/agency cover, 'permanent' for a substantive post, " +
        "'unknown' only if the brief genuinely does not say. Read it from the brief.",
    },
  },
  required: [
    "candidate_ref",
    "role_title",
    "headline",
    "evidence",
    "process_fit",
    "gaps",
    "open_questions",
    "role_shape",
  ],
};

export const CLAIM_SECTIONS = ["evidence", "process_fit", "gaps"];

/** Every claim in the pack, flattened, tagged with the section it came from. */
export function allClaims(pack) {
  return CLAIM_SECTIONS.flatMap((section) =>
    (pack[section] ?? []).map((c, index) => ({ ...c, section, index })),
  );
}

/**
 * Shape check for anything claiming to be a pack. Structured outputs make malformed
 * output unlikely rather than impossible, and everything downstream indexes into these
 * arrays — fail here with a readable message rather than on `.map of undefined`.
 */
export function assertPack(pack) {
  if (!pack || typeof pack !== "object") throw new Error("pack: not an object");
  for (const field of ["candidate_ref", "role_title", "headline"]) {
    if (typeof pack[field] !== "string") throw new Error(`pack: ${field} must be a string`);
  }
  for (const section of CLAIM_SECTIONS) {
    if (!Array.isArray(pack[section])) throw new Error(`pack: ${section} must be an array`);
    for (const [i, c] of pack[section].entries()) {
      if (typeof c?.text !== "string") throw new Error(`pack: ${section}[${i}].text`);
      if (typeof c?.source_quote !== "string")
        throw new Error(`pack: ${section}[${i}].source_quote`);
      if (!SOURCE_TYPES.includes(c?.source_type))
        throw new Error(`pack: ${section}[${i}].source_type is ${c?.source_type}`);
    }
  }
  if (!Array.isArray(pack.open_questions)) throw new Error("pack: open_questions");
  // Tolerant on absence, strict on presence: packs generated before role_shape shipped (the
  // spike pack, a paste from a tab opened pre-deploy) still verify; consumers read
  // `pack.role_shape ?? "unknown"`.
  if (pack.role_shape !== undefined && !ROLE_SHAPES.includes(pack.role_shape)) {
    throw new Error(`pack: role_shape is ${pack.role_shape}`);
  }
  return pack;
}
