// The provenance rule as a mechanism rather than a promise (architecture §5.4).
//
// A deterministic check that each `cv` / `client_note` quote appears literally in the
// corresponding input. No second model call, no judgment. Anything that fails is
// re-typed `unverified` — there is no path where a failed check renders as sourced.

// Normalisation is the only latitude taken: whitespace runs collapse, curly quotes and
// dashes fold to ASCII, and comparison is case-insensitive. Everything else must match
// character-for-character. Deliberately no fuzzy or semantic matching — the point of
// this check is that it involves no judgment.
function normalise(s) {
  return s
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function verifyPack(pack, { cv, clientNote }) {
  const haystacks = {
    cv: normalise(cv),
    client_note: normalise(clientNote),
  };

  const failures = [];

  const check = (claim, section, index) => {
    if (claim.source_type === "unverified") return claim;

    const haystack = haystacks[claim.source_type];
    const needle = normalise(claim.source_quote || "");

    if (needle && haystack.includes(needle)) return claim;

    failures.push({
      section,
      index,
      claimed_source: claim.source_type,
      text: claim.text,
      quote: claim.source_quote,
      reason: needle ? "quote not found in source" : "empty quote",
    });

    // Fail closed: demote to unverified, keep the claim visible, keep the quote so a
    // human can see what the model thought it was citing.
    return { ...claim, source_type: "unverified", failed_quote: claim.source_quote };
  };

  const verified = {
    ...pack,
    evidence: pack.evidence.map((c, i) => check(c, "evidence", i)),
    process_fit: pack.process_fit.map((c, i) => check(c, "process_fit", i)),
    gaps: pack.gaps.map((c, i) => check(c, "gaps", i)),
  };

  return { pack: verified, failures };
}
