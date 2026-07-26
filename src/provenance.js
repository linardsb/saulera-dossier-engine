// The provenance rule, enforced in code (architecture §5.4).
//
// PRD §8 says the pack never writes claims it cannot source, and §7 makes zero unsourced
// claims a weekly quality gate. A prompt asking nicely is not enforcement. This module is
// the enforcement: a deterministic check that each `cv` / `client_note` quote appears
// literally in the corresponding input. No model call, no judgment, no network.
//
// It fails closed. There is no code path where a failed check renders as a sourced claim.

import { CLAIM_SECTIONS } from "./pack.js";

/**
 * The only latitude taken: whitespace runs collapse, curly quotes and dashes fold to
 * ASCII, and comparison is case-insensitive. Everything else must match
 * character-for-character.
 *
 * Deliberately no fuzzy, stemmed, or semantic matching. The entire value of this check is
 * that it involves no judgment — the moment it starts deciding whether two spans "mean
 * the same thing", it is a second opinion rather than a verification, and the claim in
 * the room ("nothing in this pack is unsourced") stops being true.
 */
export function normalise(s) {
  return String(s ?? "")
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * @param pack   a pack that has passed assertPack()
 * @param inputs { cv, clientNote } — the exact text handed to generation
 * @returns { pack, failures } — pack with every claim's source status resolved
 */
export function verifyPack(pack, { cv, clientNote }) {
  const haystacks = {
    cv: normalise(cv),
    client_note: normalise(clientNote),
  };

  const failures = [];

  const check = (claim, section, index) => {
    if (claim.source_type === "unverified") return claim;

    const haystack = haystacks[claim.source_type];
    const needle = normalise(claim.source_quote);

    if (needle && haystack.includes(needle)) return claim;

    failures.push({
      section,
      index,
      claimed_source: claim.source_type,
      text: claim.text,
      quote: claim.source_quote,
      reason: needle ? "quote not found in source" : "empty quote",
    });

    // Demote, don't drop. The recruiter sees the claim AND sees that we could not stand
    // it up — that is the §8 behaviour. `failed_quote` preserves what the model thought
    // it was citing, which is what makes a bad pack diagnosable.
    return {
      ...claim,
      source_type: "unverified",
      failed_quote: claim.source_quote,
    };
  };

  const verified = { ...pack };
  for (const section of CLAIM_SECTIONS) {
    verified[section] = pack[section].map((c, i) => check(c, section, i));
  }

  return { pack: verified, failures };
}

/** Counts for the UI and for §7's weekly evidence spot-check. */
export function provenanceSummary(pack) {
  const counts = { cv: 0, client_note: 0, unverified: 0 };
  for (const section of CLAIM_SECTIONS) {
    for (const c of pack[section]) counts[c.source_type]++;
  }
  return { ...counts, total: counts.cv + counts.client_note + counts.unverified };
}
