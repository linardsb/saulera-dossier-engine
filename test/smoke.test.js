// Smoke coverage for the modules ported out of the spike. Not #4's full test suite —
// that ticket owns the edge cases (whitespace variants, near-miss quotes, hallucinated
// spans). This exists so the ported code is known to run against real model output.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { assertPack, allClaims } from "../src/pack.js";
import { verifyPack, provenanceSummary, normalise } from "../src/provenance.js";
import { render, RENDERERS, DEFAULT_RENDERER } from "../src/render/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const rawPack = JSON.parse(read("spike/pack.json"));
const cv = read("spike/inputs/cv.md");
const clientNote = read("spike/inputs/client-note.md");

test("the spike pack satisfies the contract", () => {
  assert.doesNotThrow(() => assertPack(rawPack));
  assert.equal(allClaims(rawPack).length, 14);
});

test("assertPack rejects a bad source_type rather than letting it render", () => {
  const bad = structuredClone(rawPack);
  bad.evidence[0].source_type = "probably";
  assert.throws(() => assertPack(bad), /source_type is probably/);
});

test("every claim in the spike pack verifies against a literal span", () => {
  const { failures } = verifyPack(rawPack, { cv, clientNote });
  assert.deepEqual(failures, []);
});

test("a paraphrased quote is demoted, not passed", () => {
  const tampered = structuredClone(rawPack);
  tampered.evidence[0].source_quote = "registration is current and valid";

  const { pack, failures } = verifyPack(tampered, { cv, clientNote });
  assert.equal(failures.length, 1);
  assert.equal(failures[0].reason, "quote not found in source");
  assert.equal(pack.evidence[0].source_type, "unverified");
  // What the model thought it was citing survives, so a bad pack stays diagnosable.
  assert.equal(pack.evidence[0].failed_quote, "registration is current and valid");
});

test("an empty quote claiming a source is a failure, not a pass", () => {
  const empty = structuredClone(rawPack);
  empty.evidence[0].source_quote = "";
  const { failures } = verifyPack(empty, { cv, clientNote });
  assert.equal(failures[0].reason, "empty quote");
});

test("a claim quoting the wrong document fails", () => {
  const crossed = structuredClone(rawPack);
  // A real CV span, but attributed to the client note.
  crossed.evidence[0].source_type = "client_note";
  const { failures } = verifyPack(crossed, { cv, clientNote });
  assert.equal(failures.length, 1);
});

test("normalisation spans line breaks and curly quotes but not different words", () => {
  assert.equal(normalise("a\n  b"), "a b");
  assert.equal(normalise("the trust’s"), "the trust's");
  assert.notEqual(normalise("registration current"), normalise("registration is current"));
});

test("both renderers produce text and html, and mark unverified claims", () => {
  const { pack } = verifyPack(rawPack, { cv, clientNote });
  for (const id of Object.keys(RENDERERS)) {
    const { text, html } = render(pack, id);
    assert.match(text, /UNVERIFIED/, `${id} text must mark unverified claims`);
    assert.match(html, /UNVERIFIED/, `${id} html must mark unverified claims`);
    assert.doesNotMatch(text, /\n\s*\n\s*\n/, `${id} has a triple blank line`);
  }
});

test("a quote spanning a line break in the source renders collapsed", () => {
  // This span sits across two lines in cv.md, with the file's own indentation. It is
  // stored verbatim so the verifier can match it, so the renderer has to collapse it.
  // Compared after normalisation, so ordinary line-wrapping doesn't affect the result.
  const spanning = rawPack.evidence.find((c) => c.source_quote.includes("\n"));
  assert.ok(spanning, "fixture should contain a quote that spans a line break");

  const { pack } = verifyPack(rawPack, { cv, clientNote });
  for (const id of Object.keys(RENDERERS)) {
    const { text, html } = render(pack, id);
    assert.ok(
      normalise(text).includes(normalise(spanning.source_quote)),
      `${id} text mangled a quote that spans a line break`,
    );
    assert.ok(
      normalise(html).includes(normalise(spanning.source_quote)),
      `${id} html mangled a quote that spans a line break`,
    );
  }
});

test("the appendix renderer numbers sources and resolves every citation", () => {
  const { pack } = verifyPack(rawPack, { cv, clientNote });
  const { text } = render(pack, "appendix");
  const cited = [...text.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
  const highest = Math.max(...cited);
  const { cv: a, client_note: b } = provenanceSummary(pack);
  assert.equal(highest, a + b, "every sourced claim should have a numbered entry");
});

test("appendix is the default and keeps provenance out of the body", () => {
  assert.equal(DEFAULT_RENDERER, "appendix");
  const { pack } = verifyPack(rawPack, { cv, clientNote });
  const body = render(pack, "appendix").text.split("SOURCES")[0];
  assert.doesNotMatch(body, /Source: "/, "appendix body must not carry inline sources");
  assert.match(render(pack, "inline").text, /Source: "/);
});
