// src/paste.js — the extractor, adversarially (#8 AC7).
//
// Same bias as provenance.test.js: the cases that would let something through, not the ones
// that confirm the happy path. Every case below is a real shape a chat reply takes, and three
// of them (a brace in the trailing prose, a brace inside a source_quote, an escaped backslash
// before a closing quote) are the ones a naive first-brace-to-last-brace scan gets wrong.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { extractPack } from "../src/paste.js";
import { assertPack } from "../src/pack.js";
import { verifyPack } from "../src/provenance.js";
import { StoreError } from "../src/store.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const PACK = { candidate_ref: "A", role_title: "B", headline: "C" };

/** The error code a call throws, or "did not throw". store.test.js's helper. */
function codeOf(fn) {
  try {
    fn();
    return "did not throw";
  } catch (err) {
    assert.ok(err instanceof StoreError, `expected a StoreError, got ${err}`);
    return err.code;
  }
}

// ── the shapes a reply actually arrives in ─────────────────────────────────────────────

test("bare JSON, exactly as pasted", () => {
  assert.deepEqual(extractPack(JSON.stringify(PACK)), PACK);
});

test("bare JSON with surrounding whitespace", () => {
  assert.deepEqual(extractPack("\n\n  " + JSON.stringify(PACK) + "  \n"), PACK);
});

test("a ```json fenced block", () => {
  assert.deepEqual(extractPack("```json\n" + JSON.stringify(PACK, null, 2) + "\n```"), PACK);
});

test("a bare ``` fenced block", () => {
  assert.deepEqual(extractPack("```\n" + JSON.stringify(PACK) + "\n```"), PACK);
});

test("prose before the block", () => {
  const raw = "Here is the submission pack.\n\n```json\n" + JSON.stringify(PACK) + "\n```";
  assert.deepEqual(extractPack(raw), PACK);
});

test("prose after the block", () => {
  const raw = "```json\n" + JSON.stringify(PACK) + "\n```\n\nI flagged two gaps.";
  assert.deepEqual(extractPack(raw), PACK);
});

test("an unfenced object with prose on both sides", () => {
  const raw = "Here is the pack:\n" + JSON.stringify(PACK) + "\nLet me know what you think.";
  assert.deepEqual(extractPack(raw), PACK);
});

// ── the cases a naive scan gets wrong ──────────────────────────────────────────────────

test("trailing prose containing a brace does not extend the object", () => {
  // indexOf("{") … lastIndexOf("}") swallows this and produces invalid JSON. The exact
  // sentence a model writes after a pack.
  const raw =
    JSON.stringify(PACK) + "\n\nLet me know if you'd like {anything} changed.";
  assert.deepEqual(extractPack(raw), PACK);
});

test("a source_quote containing braces does not end the object early", () => {
  const pack = { ...PACK, headline: "Band {6} to {7} progression" };
  const raw = "Here you go:\n" + JSON.stringify(pack) + "\nDone.";
  assert.deepEqual(extractPack(raw), pack);
});

test("a source_quote containing an escaped quote survives", () => {
  const pack = { ...PACK, headline: 'She described it as "the ward round" verbatim' };
  assert.deepEqual(extractPack("prose\n" + JSON.stringify(pack) + "\nprose"), pack);
});

test("a backslash before a closing quote does not swallow the rest of the pack", () => {
  // JSON.stringify writes this as `...path\\` + `"`. A scanner that treats the backslash as
  // escaping the quote stays "inside the string" for the remainder of the document and never
  // closes the object — which reads as a truncated pack and throws on a perfectly good one.
  const pack = { ...PACK, headline: "the rota lives at N:\\\\", role_title: "Ward manager" };
  const raw = "Here:\n" + JSON.stringify(pack) + "\nAnything else? {yes}";
  assert.deepEqual(extractPack(raw), pack);
});

test("two fenced blocks: the first one wins", () => {
  const first = { ...PACK, candidate_ref: "first" };
  const second = { ...PACK, candidate_ref: "second" };
  const raw =
    "```json\n" + JSON.stringify(first) + "\n```\n\nOr with the gap removed:\n\n" +
    "```json\n" + JSON.stringify(second) + "\n```";
  assert.equal(extractPack(raw).candidate_ref, "first");
});

test("a fenced block wrapping prose around the object still yields the object", () => {
  const raw = "```\nHere is the pack:\n" + JSON.stringify(PACK) + "\nThat is everything.\n```";
  assert.deepEqual(extractPack(raw), PACK);
});

// ── the failures, which must be failures ───────────────────────────────────────────────

test("an empty paste is no_pack", () => {
  assert.equal(codeOf(() => extractPack("")), "no_pack");
});

test("whitespace only is no_pack", () => {
  assert.equal(codeOf(() => extractPack("   \n\t  ")), "no_pack");
});

test("null and undefined are no_pack, not a crash", () => {
  assert.equal(codeOf(() => extractPack(null)), "no_pack");
  assert.equal(codeOf(() => extractPack(undefined)), "no_pack");
});

test("prose with no object at all is no_pack", () => {
  const raw = "I can't write this pack without the candidate's registration number.";
  assert.equal(codeOf(() => extractPack(raw)), "no_pack");
});

test("truncated JSON is no_pack, never a repaired pack", () => {
  // The recruiter copied half the reply. Guessing the missing braces would be inventing pack
  // content, which is the one thing this product must not do.
  const raw = '{"candidate_ref": "A", "role_title": "B", "evidence": [{"text": "half a claim"';
  assert.equal(codeOf(() => extractPack(raw)), "no_pack");
});

test("a JSON array is not a pack", () => {
  assert.equal(codeOf(() => extractPack('["not", "a", "pack"]')), "no_pack");
});

test("a JSON string or number is not a pack", () => {
  assert.equal(codeOf(() => extractPack('"just a string"')), "no_pack");
  assert.equal(codeOf(() => extractPack("42")), "no_pack");
});

test("the thrown message contains no part of the pasted text", () => {
  // The paste is candidate data. errorResponse forwards only the code, and this is the belt
  // that keeps the message safe even if that ever changes.
  const secret = "Sister Aoife Brennan, NMC 12A3456B, aoife.brennan@example.nhs.uk";
  try {
    extractPack("Sorry, I could not do this. " + secret);
    assert.fail("should have thrown");
  } catch (err) {
    for (const fragment of ["Aoife", "Brennan", "12A3456B", "example.nhs.uk", secret]) {
      assert.doesNotMatch(err.message, new RegExp(fragment), "the message leaked pasted text");
    }
  }
});

// ── the real thing ─────────────────────────────────────────────────────────────────────

test("a fenced spike/pack.json survives extraction, assertPack and verifyPack", () => {
  // The round trip that matters: the schema we ask for in the prompt is the schema we can
  // parse, check and render. Anything that breaks between prompt.js and here breaks this.
  const raw =
    "Here is the submission pack for this candidate.\n\n```json\n" +
    read("spike/pack.json") +
    "\n```\n\nI marked one claim unverified because I could not find an exact span for it. " +
    "Let me know if you'd like {anything} adjusted.";

  const pack = assertPack(extractPack(raw));
  const { failures } = verifyPack(pack, {
    cv: read("spike/inputs/cv.md"),
    clientNote: read("spike/inputs/client-note.md"),
  });
  assert.deepEqual(failures, [], "the real pack must survive the paste path intact");
});
