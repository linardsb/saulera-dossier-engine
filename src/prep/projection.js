// What a candidate's browser is allowed to receive (#22, R6). Pure — no D1, no HTTP, no env.
//
// The stored `candidate_role.brief_json` is the RECRUITER's artefact: it carries the model's
// failed guesses so a bad brief stays diagnosable, and an importance score so #23 can order a
// session. Serving that row to the candidate is one View Source away from handing them both.
// Not-rendering is not not-delivering — public/prep/registry.js is careful never to PRINT
// `failed_quote`, and that is exactly the kind of care that a response body walks straight
// past. This module is the delivery-side half of that rule.
//
// Three things are removed and one is deliberately kept:
//
//   importance     a numeral is a score whatever it measures (registry.js:230-238 is the same
//                  argument about panels). Decision 3 says nothing a candidate DOES reaches
//                  the recruiter; a rank on what they must prepare is the mirror of that, and
//                  the component vocabulary already refuses to render one.
//   the quote on   verifyBrief demotes by adding `failed_quote` and LEAVING `source_quote`
//   an unverified  in place (verify.js:48), so the two hold the same invented sentence.
//   competency     Dropping only `failed_quote` would ship it anyway under the other name.
//                  A candidate's next move after reading a quote is to prepare against it, so
//                  a sentence the model invented is the one thing worth carrying out of here.
//   questions      the brief page never renders them, and #23 will serve them from its own
//                  session endpoint where an attempt can be recorded against one.
//
//   verified       KEPT, and it must survive. registry.js:195-196: "`verified` absent means
//                  the payload never went through verifyBrief, so it is treated as
//                  unverified" — dropping it would mark a perfectly sourced brief unverified
//                  for every candidate, which is fail-closed but wrong.

/** A panel entry with the model's invented slug blanked, and the demotion marker intact. */
function projectPanelEntry(entry) {
  if (!entry || typeof entry !== "object" || !("failed_field_key" in entry)) return entry;
  // The KEY stays and only the VALUE goes. `panelUnsourced` (registry.js:226-230) reads
  // `"failed_field_key" in entry` first, so removing the key would lean the whole decision on
  // its second clause — and a decision resting on one clause instead of two is one edit away
  // from marking a guessed row "From our notes on this client". Blanking drops the slug the
  // model invented while the mark stays honest.
  return { ...entry, failed_field_key: "" };
}

/** One block, projected. Recurses into `CompetencyMap.children`. */
function projectBlock(block) {
  if (!block || typeof block !== "object") return block;

  if (block.name === "PanelBrief" && Array.isArray(block.props?.panel)) {
    return { ...block, props: { ...block.props, panel: block.props.panel.map(projectPanelEntry) } };
  }

  // A PanelBrief cannot legally nest here — assertBrief:263 rejects anything but a
  // StoryBankCard leaf in `children` — so this branch is unreachable through a valid payload.
  // It is one line, and a projection that only handled the top level would be the same hole
  // briefSummary documents at verify.js:97-100: the guard and the walk are a pair, and
  // relying on the guard alone means the projection silently stops being complete the day
  // that guard is loosened.
  if (Array.isArray(block.children) && block.children.length) {
    return { ...block, children: block.children.map(projectBlock) };
  }

  return block;
}

/**
 * The candidate-visible slice of a stored payload.
 *
 * @param payload a payload that has passed assertBrief()
 * @returns `{ role_title, blocks, competencies }` — a valid input to renderBlocks, and nothing
 *          the candidate is not entitled to.
 */
export function candidateProjection(payload) {
  const competencies = (payload?.competencies ?? []).map((c) => {
    const verified = c?.verified === true;
    return {
      id: c?.id,
      label: c?.label,
      // Only a quote we could actually find in the brief. See the header: on an unverified
      // competency `source_quote` IS the failed quote, under a name that sounds trustworthy.
      source_quote: verified ? c.source_quote : "",
      verified,
    };
  });

  // `questions` is absent rather than empty: an empty array reads as "there are none", and
  // there are plenty — they are simply not this endpoint's to serve.
  return {
    role_title: payload?.role_title,
    blocks: (payload?.blocks ?? []).map(projectBlock),
    competencies,
  };
}
