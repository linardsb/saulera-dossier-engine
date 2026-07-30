// Striking a competency out of a prep brief (#22, decision 15: "rendered in the send preview
// so the recruiter can strike one").
//
// Pure, like src/note-fields.js — no D1, no HTTP, no imports at all — so every rule below is
// directly testable and the Function layer only has to decide what an exception means.
//
// THE WHOLE DIFFICULTY IS REFERENTIAL. A competency is not one object; it is an id that four
// other places point at: its own row in `competencies`, every question carrying its
// `competency_id`, every `CompetencyMap.props.competency_ids` entry, and every
// `StoryBankCard.props.covers_competency_ids` entry. `assertBrief`'s `resolve()`
// (src/prep/schema.js:247-252) throws on a reference that names no competency, and it is
// called again on the way out of the strike — so removing the row and leaving a pointer is
// not a cosmetic bug, it is a 400 on the recruiter's Send. src/prep/strike.js's test file
// walks every non-empty subset of the fixture for exactly this reason.
//
// Everything is rebuilt by map/filter and nothing is mutated, for the argument
// src/prep/verify.js:51-53 makes: the caller still holds the payload it passed in — the
// browser posted it and the Function is about to persist the ORIGINAL brief text alongside
// the struck payload — and an in-place edit would quietly make "the input was not modified"
// unprovable.

/**
 * A new payload with `struckIds` and everything referring to them removed.
 *
 * @param payload   a payload that has passed assertBrief()
 * @param struckIds the competency ids the recruiter unticked
 * @returns a new payload that still passes assertBrief()
 * @throws {Error} if every competency was struck — the caller maps this to 400 nothing_to_send
 */
export function strikeCompetencies(payload, struckIds = []) {
  const struck = struckIds instanceof Set ? struckIds : new Set(struckIds ?? []);

  const competencies = (payload?.competencies ?? []).filter((c) => !struck.has(c?.id));

  // Before any of the reference work, because a brief with nothing to drill is not a brief and
  // the caller's answer is a 400 rather than an empty send. A plain Error, not a StoreError:
  // this module has no imports and no opinion about HTTP, matching note-fields.js's posture.
  if (!competencies.length) {
    throw new Error("every competency was struck; there is nothing left to send");
  }

  const questions = (payload?.questions ?? []).filter((q) => !struck.has(q?.competency_id));

  // A block survives if it still points at something. `keep` returns null for a block that has
  // been emptied out, and the nulls are filtered at each level.
  const keep = (block) => {
    if (block?.name === "CompetencyMap") {
      const ids = (block.props?.competency_ids ?? []).filter((id) => !struck.has(id));
      // R5. `resolve()` accepts an EMPTY array, so an emptied map passes assertBrief while
      // rendering a heading with nothing under it — registry.js:264-266 makes exactly this
      // call about an empty row. Drop the block; do not keep it empty.
      //
      // Dropping a CompetencyMap takes its `children` with it, and that is correct rather
      // than incidental: those StoryBankCards were grouped UNDER this map, so the grouping is
      // the thing that just stopped existing. Saying so here because a reviewer reads a
      // silently vanished subtree as an accident.
      if (!ids.length) return null;

      const children = (block.children ?? []).map(keep).filter(Boolean);
      return { ...block, props: { ...block.props, competency_ids: ids }, children };
    }

    if (block?.name === "StoryBankCard") {
      const ids = (block.props?.covers_competency_ids ?? []).filter((id) => !struck.has(id));
      // A story prompt that covers no competency is a prompt with no target — it would ask the
      // candidate to prepare an example for nothing.
      if (!ids.length) return null;
      return { ...block, props: { ...block.props, covers_competency_ids: ids } };
    }

    // PrimerCard, PanelBrief, LogisticsRail and the rest reference no competency, so there is
    // nothing here to prune. Returned as-is rather than shallow-copied: nothing below mutates
    // them, and a copy would only obscure that.
    return block;
  };

  const blocks = (payload?.blocks ?? []).map(keep).filter(Boolean);

  return { ...payload, blocks, competencies, questions };
}
