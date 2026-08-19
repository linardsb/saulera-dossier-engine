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
// TWO HAYSTACKS, and which one a claim is checked against is decided by the BLOCK, never by a
// field on the claim — verifyPack dispatches on `source_type`, and there is still no such
// discriminator here. A competency is what the ROLE demands, so it comes from the brief and only
// the brief (SPEC.md:45 — "Extract competencies from it; do not invent them"), and a competency
// sourced from the candidate's own CV is a category error rather than a looser check. #79's
// `LikelyConcerns.concerns[].evidence_quote` is the mirror of that: it is what the CANDIDATE has,
// so it can only come from their own material, and a span found in the brief instead is the same
// category error running the other way. One block discriminates them, and it is named here so the
// next reader does not re-open the question.

import { quoteAppears } from "../provenance.js";

/**
 * @param payload  a payload that has passed assertBrief()
 * @param inputs   { brief, cv, fieldKeys } — the exact brief and CV text handed to generation,
 *                 and the `key` of every field in the candidate-visible slice
 * @returns { payload, failures } — every competency's, panel claim's and concern's source resolved
 */
export function verifyBrief(payload, { brief, cv, fieldKeys } = {}) {
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

  // One demotion for both note-derived blocks (the panel's claims and #50's primer items — the
  // same {source_field_key} shape at both call sites; do not abstract past the two).
  //
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
  const demote = (entry, failure) => {
    if (entry.source_field_key === "" && "failed_field_key" in entry) return entry;
    if (keys.has(entry.source_field_key)) return entry;

    failures.push({ ...failure, key: entry.source_field_key, reason: "field key not in the visible slice" });

    return { ...entry, source_field_key: "", failed_field_key: entry.source_field_key };
  };

  /**
   * A concern's evidence (#79), checked against the CANDIDATE'S CV.
   *
   * THE EMPTY QUOTE IS NOT A FAILURE. SPEC Amendment 1: "if the material holds no genuine
   * counter, say so plainly." An empty `evidence_quote` IS that plain statement, so it returns
   * untouched and the page's own words (registry COPY) say what it means. `quoteAppears`
   * returns false for an empty needle (src/provenance.js:37-39), so without this branch every
   * honest gap would be recorded as a hallucination.
   *
   * That one branch also carries the idempotency the panel demotion needs two clauses for: a
   * demoted concern's quote is already blank, so a re-verified payload returns here before the
   * haystack is consulted and `failed_evidence_quote` survives intact. A forged
   * `{evidence_quote: "x", failed_evidence_quote: null}` arriving from the browser is NOT blank
   * and is therefore still checked, which is the guarantee :60-66 argues for.
   */
  const demoteConcern = (entry, failure) => {
    if (!String(entry?.evidence_quote ?? "").trim()) return entry;
    if (quoteAppears(entry.evidence_quote, cv)) return entry;

    failures.push({ ...failure, quote: entry.evidence_quote, reason: "quote not found in the CV" });

    return { ...entry, evidence_quote: "", failed_evidence_quote: entry.evidence_quote };
  };

  // Cloned the whole way down rather than mutated in place: the panel claim sits three levels
  // deep (blocks[i].props.panel[j]), and an in-place blank would alter the parsed object the
  // caller still holds, quietly making "nothing was dropped" unprovable.
  const blocks = (payload.blocks ?? []).map((block, blockIndex) => {
    if (block.name === "PanelBrief" && Array.isArray(block.props?.panel)) {
      const panel = block.props.panel.map((entry, panelIndex) =>
        demote(entry, { kind: "panel_source", block_index: blockIndex, panel_index: panelIndex }),
      );
      return { ...block, props: { ...block.props, panel } };
    }

    if (block.name === "FirstDayPrimer" && Array.isArray(block.props?.items)) {
      const items = block.props.items.map((entry, itemIndex) =>
        demote(entry, { kind: "primer_source", block_index: blockIndex, item_index: itemIndex }),
      );
      return { ...block, props: { ...block.props, items } };
    }

    if (block.name === "LikelyConcerns" && Array.isArray(block.props?.concerns)) {
      const concerns = block.props.concerns.map((entry, concernIndex) =>
        demoteConcern(entry, {
          kind: "concern_source",
          block_index: blockIndex,
          concern_index: concernIndex,
        }),
      );
      return { ...block, props: { ...block.props, concerns } };
    }

    return block;
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

  // #50's primer items, counted the same way and additive for the same reason the panel counts
  // were: a caller reading only the earlier halves is unaffected, and pre-#50 payloads read 0.
  const primer = (payload.blocks ?? []).flatMap((b) =>
    b?.name === "FirstDayPrimer" && Array.isArray(b.props?.items) ? b.props.items : [],
  );
  const primerUnsourced = primer.filter((e) => "failed_field_key" in e).length;

  // #79's concerns, counted the same way and additive for the same reason — but in THREE parts
  // rather than two, because a concern has an outcome the panel and primer halves do not: the
  // honest gap. A blank quote with no marker is the model correctly declining to invent a
  // counter, and folding it into `concern_sourced` would print "3 evidenced" over a brief where
  // one concern has nothing behind it — the one number on this line worth reading.
  //
  //   sourced + unsourced + no_material === total, always.
  const concerns = (payload.blocks ?? []).flatMap((b) =>
    b?.name === "LikelyConcerns" && Array.isArray(b.props?.concerns) ? b.props.concerns : [],
  );
  const concernUnsourced = concerns.filter((e) => "failed_evidence_quote" in e).length;
  const concernNoMaterial = concerns.filter(
    (e) => !("failed_evidence_quote" in e) && !String(e?.evidence_quote ?? "").trim(),
  ).length;

  return {
    sourced,
    unverified: competencies.length - sourced,
    total: competencies.length,
    panel_sourced: panel.length - panelUnsourced,
    panel_unsourced: panelUnsourced,
    panel_total: panel.length,
    primer_sourced: primer.length - primerUnsourced,
    primer_unsourced: primerUnsourced,
    primer_total: primer.length,
    concern_sourced: concerns.length - concernUnsourced - concernNoMaterial,
    concern_unsourced: concernUnsourced,
    concern_no_material: concernNoMaterial,
    concern_total: concerns.length,
  };
}
