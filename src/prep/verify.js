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

/** Counts for the script's output and for #22's send gate. */
export function briefSummary(payload) {
  const competencies = payload.competencies ?? [];
  const sourced = competencies.filter((c) => c.verified).length;
  return {
    sourced,
    unverified: competencies.length - sourced,
    total: competencies.length,
  };
}
