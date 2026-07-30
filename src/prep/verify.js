// The provenance rule, applied to the candidate brief (#19). Portal architecture §3:
// "competencies carry their verbatim JD quote, checked literally against the input (reuse
// src/provenance.js). Unverifiable material renders as unverified, exactly as in the pack."
//
// Two halves of §3, two checks here. The JD half is the competency quote, checked literally
// against the brief. The note half is `PanelBrief.panel[].source_field_key`, checked against the
// field keys actually handed in — #18 gives every candidate-visible field a stable slug, which
// is what makes a note-derived claim checkable the way a quoted one already is.
//
// Both DEMOTE. Neither throws and neither drops. That is not a softness — it is the same rule
// the rest of this product rests on (provenance.js:62, "Demote, don't drop"): the recruiter sees
// the claim AND sees that we could not stand it up. A hard throw on a hallucinated slug would
// make one bad character kill a Send a recruiter is standing in front of, and a silently removed
// claim is the failure mode they cannot see. Shape bugs are `assertBrief`'s; nothing blurs the two.
//
// ONE HAYSTACK. verifyPack dispatches on source_type into { cv, client_note }; there is no such
// discriminator here, deliberately. Competencies come from the brief and only the brief
// (SPEC.md:45 — "Extract competencies from it; do not invent them"), and a competency sourced
// from the candidate's own CV is a category error rather than a looser check.

import { quoteAppears } from "../provenance.js";

/**
 * @param payload  a payload that has passed assertBrief()
 * @param inputs   { brief, fieldKeys } — the exact brief text handed to generation, and the
 *                 `key` of every field in the candidate-visible slice
 * @returns { payload, failures } — every competency's and every panel claim's source resolved
 */
export function verifyBrief(payload, { brief, fieldKeys } = {}) {
  const keys = new Set(fieldKeys ?? []);
  const failures = [];

  const competencies = (payload.competencies ?? []).map((c, index) => {
    if (quoteAppears(c.source_quote, brief)) return { ...c, verified: true };

    failures.push({
      kind: "competency",
      index,
      label: c.label,
      quote: c.source_quote,
      reason: String(c.source_quote ?? "").trim()
        ? "quote not found in the brief"
        : "empty quote",
    });

    // failed_quote preserves what the model thought it was citing, which is what makes a bad
    // brief diagnosable rather than merely wrong.
    return { ...c, verified: false, failed_quote: c.source_quote };
  });

  // Cloned the whole way down rather than mutated in place: the panel claim sits three levels
  // deep (blocks[i].props.panel[j]), and an in-place blank would alter the parsed object the
  // caller still holds, quietly making "nothing was dropped" unprovable.
  const blocks = (payload.blocks ?? []).map((block, blockIndex) => {
    if (block.name !== "PanelBrief" || !Array.isArray(block.props?.panel)) return block;

    const panel = block.props.panel.map((entry, panelIndex) => {
      // Idempotent, the way verifyPack is (provenance.js:55, `source_type === "unverified"`).
      // A demoted entry carries source_field_key: "", which `keys` never holds — so without this
      // a second pass re-demotes it and overwrites failed_field_key with the blank, destroying
      // the diagnostic on exactly the path that needs it most: a payload re-verified out of
      // storage, where the original key is the only record of what the model claimed.
      //
      // The test is the SHAPE this function produces, not the mere presence of the key. Key
      // presence alone is forgeable: `{"failed_field_key": null}` is legal JSON that survives
      // readJson and assertBrief, so a payload arriving from the browser could carry a
      // `source_field_key` naming a HIDDEN note section and return here before the D1 allow-list
      // was ever consulted. A genuine demotion always blanks the key first, so requiring both is
      // what keeps the guarantee functions/api/prep/send.js advertises — the keys come from the
      // database — true of the round trip and not only of the first pass.
      if (entry.source_field_key === "" && "failed_field_key" in entry) return entry;
      if (keys.has(entry.source_field_key)) return entry;

      failures.push({
        kind: "panel_source",
        block_index: blockIndex,
        panel_index: panelIndex,
        key: entry.source_field_key,
        reason: "field key not in the visible slice",
      });

      return { ...entry, source_field_key: "", failed_field_key: entry.source_field_key };
    });

    return { ...block, props: { ...block.props, panel } };
  });

  return { payload: { ...payload, blocks, competencies }, failures };
}

/**
 * Counts for the script's output and for #22's send gate — BOTH halves of §3, which is what
 * makes it usable as that gate. Counting only competencies would let a brief with every panel
 * attribution hallucinated summarise byte-identically to a clean one, and a Send button wired to
 * it would go green on the failure this whole mechanism exists to catch.
 *
 * `sourced`/`unverified`/`total` keep meaning competencies; the panel counts are additive, so a
 * caller reading only the JD half is unaffected.
 *
 * These are read out of the PAYLOAD rather than off `failures` deliberately. The panel demotion
 * above is idempotent, so re-verifying a stored payload emits no `panel_source` failure at all
 * while the competency half still re-fails — on that path `failures` is a complete gate for the
 * JD half and an empty one for the note half, and the payload is the only thing that still knows.
 *
 * TOP-LEVEL BLOCKS ONLY, and that is complete only because `assertBrief` rejects a `PanelBrief`
 * nested in `CompetencyMap.children` — the two are a pair. Drop that guard and a panel smuggled
 * into `children` goes uncounted here as well as unverified above, which is the same hole in both
 * halves. #22 calling this on a stored payload must run `assertBrief` first, as generate.js does.
 */
export function briefSummary(payload) {
  const competencies = payload.competencies ?? [];
  const sourced = competencies.filter((c) => c.verified).length;

  const panel = (payload.blocks ?? []).flatMap((b) =>
    b?.name === "PanelBrief" && Array.isArray(b.props?.panel) ? b.props.panel : [],
  );
  // The demotion marker, not the blanked key: it is what survives a second pass.
  const panelUnsourced = panel.filter((e) => "failed_field_key" in e).length;

  return {
    sourced,
    unverified: competencies.length - sourced,
    total: competencies.length,
    panel_sourced: panel.length - panelUnsourced,
    panel_unsourced: panelUnsourced,
    panel_total: panel.length,
  };
}
