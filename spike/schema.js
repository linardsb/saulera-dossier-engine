// The canonical pack + structured claim shape, as a JSON schema for
// output_config.format. Whatever survives the spike becomes the contract in #4.
//
// Every object needs additionalProperties: false, and structured outputs reject
// recursive schemas and numeric/length constraints — keep it flat.

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
    source_type: {
      type: "string",
      enum: ["cv", "client_note", "unverified"],
    },
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
        "What the agency knows about THIS client's process, and how the candidate maps to it. " +
        "This is the part a job board cannot produce. Source from the client note.",
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
  },
  required: [
    "candidate_ref",
    "role_title",
    "headline",
    "evidence",
    "process_fit",
    "gaps",
    "open_questions",
  ],
};

// Every array of claims in the pack, flattened — used by the verifier and renderers.
export function allClaims(pack) {
  return [
    ...pack.evidence.map((c) => ({ ...c, section: "evidence" })),
    ...pack.process_fit.map((c) => ({ ...c, section: "process_fit" })),
    ...pack.gaps.map((c) => ({ ...c, section: "gaps" })),
  ];
}
