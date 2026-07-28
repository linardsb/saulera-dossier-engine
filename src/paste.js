// Getting a pack object back out of whatever the recruiter pasted (#8).
//
// The API path had structured outputs, so the reply WAS the object. The paste path does not:
// the recruiter copies a chat reply, which may carry a sentence before the JSON, a sentence
// after it, a fenced block, two fenced blocks, or nothing useful at all.
//
// This module recovers an object from that. It does not repair one. That distinction is
// src/provenance.js's stance applied here: the value of the check downstream is that it
// involves no judgment, and a module that "fixed" a truncated pack by guessing the missing
// braces would be inventing pack content — the one thing this product must never do. Three
// deterministic attempts, then an honest failure.

import { StoreError } from "./store.js";

/**
 * The span of the first balanced `{…}` in the string, string-aware.
 *
 * The naive version of this — indexOf("{") to lastIndexOf("}") — looks like it works and is
 * wrong in two ordinary cases: a model that writes "let me know if you'd like {anything}
 * changed" after the block takes the scan past the end of the object, and a `source_quote`
 * containing a brace ends it early. Quotes are copied VERBATIM out of a CV, so a brace inside
 * one is not exotic.
 *
 * So depth is only counted outside string literals, and inside one a backslash escapes the
 * next character — which is what keeps `\\"` (an escaped backslash, then a real closing quote)
 * from reading as an escaped quote and swallowing the rest of the pack.
 */
function balancedSpan(raw, from) {
  const start = raw.indexOf("{", from);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < raw.length; i += 1) {
    const ch = raw[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return null; // ran off the end: a truncated object, which is a no_pack and not a repair job
}

/** The body of the first ```json (or bare ```) fenced block, or null. */
function firstFencedBlock(raw) {
  // The first block wins. A reply that shows the schema back before answering puts the pack
  // second, but a reply that answers and then explains puts it first, and the second is the
  // common shape. Ambiguity here is resolved by assertPack rather than by cleverness.
  const match = /```(?:json)?\s*\n([\s\S]*?)```/i.exec(raw);
  return match ? match[1] : null;
}

function tryParse(candidate) {
  if (typeof candidate !== "string" || !candidate.trim()) return null;
  try {
    const value = JSON.parse(candidate);
    // `"a"`, `42` and `[…]` are all valid JSON and none of them is a pack. Rejecting them here
    // means assertPack's message can be about a pack's fields rather than about its type.
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * A pack object out of a pasted chat reply.
 *
 * @throws StoreError("no_pack", 400) when there is no object in it.
 *
 * 400 and not 502. On the API path a malformed reply was the model's fault and 5xx was right.
 * Here the recruiter pasted the wrong thing, which is a caller fault with a caller remedy
 * ("copy the whole reply") — and DEPLOY.md's triage table reads 5xx as a DEPLOYMENT fault, so
 * answering 500 here would send someone to check the bindings over a bad paste.
 */
export function extractPack(raw) {
  const text = String(raw ?? "");

  const attempts = [
    text.trim(), // the clean case: the recruiter copied only the block's contents
    firstFencedBlock(text), // the ordinary case: prose, a fenced block, more prose
    balancedSpan(text, 0), // the awkward case: prose and an unfenced object
  ];

  for (const candidate of attempts) {
    const parsed = tryParse(candidate);
    if (parsed) return parsed;
  }

  // A fenced block whose contents did not parse is still the best clue about where the pack is:
  // a model that wrapped its prose INSIDE the fence puts the object one level in.
  const fenced = firstFencedBlock(text);
  if (fenced) {
    const parsed = tryParse(balancedSpan(fenced, 0));
    if (parsed) return parsed;
  }

  // The message carries no part of the input, and must not start to. This is a paste of a
  // candidate's CV-derived pack, `errorResponse` is the only thing between it and the wire, and
  // it forwards `code` alone precisely so a message here can never leak (#6 AC9).
  throw new StoreError("no_pack", 400, "paste: no JSON object found in the pasted reply");
}
