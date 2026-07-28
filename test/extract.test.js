// public/extract.js — the file readers, adversarially (#8 AC2).
//
// WHY THIS EXISTS. This was the only untested file in the tree, and it is the first thing the
// recruiter's data touches: 563 lines of hand-rolled PDF parsing and ZIP reading, on step one of
// the flow. The failure it must not have is not a crash — it is SILENT GARBLING. A CV that comes
// out as mush still generates a pack; every source_quote then fails the literal check in
// src/provenance.js, the whole pack demotes to unverified, and the recruiter blames the product
// rather than the file. So most of what is asserted below is refusal: that the unreadable is
// reported as unreadable rather than returned as best-effort text.
//
// Same idiom and the same zero dependencies as tokens.test.js and paste.test.js. extract.js is
// not a module — it is an IIFE ending `})(window)`, the way app.js is — so it is loaded by
// evaluating the real file against a `window` that is `globalThis`. That is deliberate: the
// FILE the browser loads is the thing under test, not a copy of it.
//
// ⚠ WHAT THIS FILE CANNOT COVER, AND WHERE IT IS COVERED INSTEAD.
//
//   1. The .docx XML → text mapping. `docxToText` needs DOMParser, NodeFilter and
//      createTreeWalker. `node --test` has no DOM and the plan forbids adding tooling to get one
//      (tokens.test.js says the same). A shim would be testing the shim. The ZIP layer *is*
//      covered here, exactly, by a tripwire — see "the .docx ZIP layer" below. The XML mapping
//      is covered in `.claude/probes/extract-docx.mjs` against real Chrome.
//
//   2. The /Length rule's real habitat. `pdfToText` prefers the dictionary's /Length over
//      scanning for `endstream` because CHROME's DecompressionStream rejects trailing bytes
//      after a deflate stream and NODE's tolerates them (extract.js:406-414). That asymmetry
//      means the bug this rule fixes is INVISIBLE IN NODE — a regression here would still pass
//      this file and still break every PDF in every browser. What is asserted below is the
//      mechanism (the /Length slice is what gets decoded); the consequence is a probe.
//
// Run: npm test          Run the DOM half: node .claude/probes/extract-docx.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/* ── load the file the browser loads ─────────────────────────────────────────────────── */

/**
 * The .docx path's first DOM call, replaced by a recorder that captures what it was handed and
 * then throws. This is NOT a DOM shim: nothing here parses XML or pretends to. It is a tripwire
 * at the boundary, and what it buys is the whole ZIP layer under test with no DOM at all — if
 * `seen.xml` is byte-for-byte the document I zipped, then the central directory was read, the
 * right entry was found, the local header was skipped by the right number of bytes and the
 * payload was inflated correctly. Everything past this line is the probe's job.
 */
let seen = null;
globalThis.DOMParser = class {
  parseFromString(xml, type) {
    seen = { xml, type };
    throw new Error("no-dom-in-node");
  }
};

globalThis.window = globalThis;
new Function(readFileSync(join(root, "public/extract.js"), "utf8"))();
const { extractText, looksLikeText } = globalThis.DossierExtract;

/** Resolves to `{ ok }` or `{ err }` so a rejection is assertable without try/catch per test. */
const run = (file) => extractText(file).then((ok) => ({ ok }), (e) => ({ err: e.reason }));
const pdfFile = (bytes, name = "cv.pdf") => new File([bytes], name, { type: "application/pdf" });
const docxFile = (bytes, name = "cv.docx") => new File([bytes], name);

/* ── bytes ───────────────────────────────────────────────────────────────────────────── */

const enc = (s) => new TextEncoder().encode(s);
const u16 = (n) => new Uint8Array([n & 255, (n >> 8) & 255]);
const u32 = (n) => new Uint8Array([n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255]);

function cat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

const deflate = async (bytes, format) =>
  new Uint8Array(await new Response(
    new Blob([bytes]).stream().pipeThrough(new CompressionStream(format)),
  ).arrayBuffer());

/* ── the sample text ─────────────────────────────────────────────────────────────────── */

// Long enough to clear looksLikeText's floors on purpose: the guard needs 15 words of more than
// two characters, so a "hello world" fixture would come back `unreadable` and every test below
// would be asserting the guard rather than the parser. A real CV line clears it comfortably.
const L1 = "Registered Nurse with eight years across acute medical wards and community settings.";
const L2 = "Led the falls reduction project at Queen Victoria Hospital, cutting incidents overall.";
const ONE_LINE =
  "Registered Nurse with eight years across acute medical wards and community settings, " +
  "leading the falls reduction project at Queen Victoria Hospital today";

/* ── a PDF, assembled from objects ───────────────────────────────────────────────────── */

/**
 * Deliberately not a spec-valid PDF: no xref table and no correct trailer, because `pdfToText`
 * does not read one. It scans for `N 0 obj … endobj`, which is what makes it survive the
 * malformed files real writers emit. Building the file the way the parser reads it keeps these
 * fixtures honest about what is actually load-bearing.
 */
function pdf(objects) {
  const parts = [enc("%PDF-1.4\n")];
  objects.forEach((body, i) => {
    parts.push(enc(`${i + 1} 0 obj\n`));
    parts.push(typeof body === "string" ? enc(body) : body);
    parts.push(enc("\nendobj\n"));
  });
  parts.push(enc("trailer << /Root 1 0 R >>\n%%EOF\n"));
  return cat(parts);
}

/** A stream object whose /Length is correct. `extra` lands after the data, before `endstream`. */
function stream(dict, data, extra = new Uint8Array(0)) {
  return cat([enc(`<< ${dict} /Length ${data.length} >>\nstream\n`), data, extra, enc("\nendstream")]);
}

/** The three objects a content stream needs before it will be walked at all. */
const PAGE_OBJECTS = (contents) => [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
  contents,
];

/** A one-object PDF carrying `ops` as an uncompressed content stream. */
const contentPdf = (ops) => pdf(["<< /Type /Catalog >>", stream("", enc(ops))]);

/* ── looksLikeText: the backstop the header calls load-bearing ────────────────────────── */

test("looksLikeText: a real CV line passes", () => {
  assert.equal(looksLikeText(ONE_LINE), true);
});

test("looksLikeText: empty, null and undefined are not text", () => {
  for (const value of ["", "   ", null, undefined, "\n\n\n"]) {
    assert.equal(looksLikeText(value), false, `${JSON.stringify(value)} should not pass`);
  }
});

test("looksLikeText: under 40 characters is refused however clean", () => {
  assert.equal(looksLikeText("Registered Nurse with eight years"), false);
});

test("looksLikeText: fewer than 15 words of more than two characters is refused", () => {
  // 40+ characters and every word a real one — refused on word count alone, which is the signal
  // that catches a PDF where only a header decoded.
  const short = "Registered Nurse acute medical wards community settings today";
  assert.ok(short.length > 40);
  assert.equal(short.split(/\s+/).filter((w) => w.length > 2).length < 15, true);
  assert.equal(looksLikeText(short), false);
});

test("looksLikeText: Identity-H glyph indices read as Latin-1 are refused", () => {
  // The exact garbling the guard exists for: a two-byte-per-glyph string decoded one byte at a
  // time, so every other character is a NUL. Printable-looking in a debugger, mush in a pack.
  const glyphs = [...ONE_LINE].map((c) => " " + c).join("");
  assert.ok(glyphs.length > 40);
  assert.equal(looksLikeText(glyphs), false);
});

test("looksLikeText: printable bytes that spell nothing are refused", () => {
  // The control-character ratio's blind spot, which is why there is a second signal: these are
  // all clean printable ASCII and there are plenty of them.
  const consonants = Array.from({ length: 40 }, (_, i) => `bcdfg${i % 10}hjkl`).join(" ");
  assert.ok(consonants.split(/\s+/).filter((w) => w.length > 2).length >= 15);
  assert.equal(looksLikeText(consonants), false);
});

test("looksLikeText: accented and non-Latin text passes", () => {
  // The clean range runs to U+2FFF on purpose. A Portuguese or Polish CV must not be refused as
  // garbage — that would be a European staffing agency's first upload failing.
  const accented =
    "Enfermeira registada com oito anos em enfermarias médicas agudas e cuidados na comunidade, " +
    "liderando o projeto de redução de quedas no hospital regional hoje";
  assert.equal(looksLikeText(accented), true);
});

/* ── dispatch, and the three documented reason codes ─────────────────────────────────── */

test("a .txt file is read as text, by extension", async () => {
  const { ok } = await run(new File([enc(ONE_LINE)], "brief.txt"));
  assert.deepEqual(ok, { text: ONE_LINE, kind: "text" });
});

test("a .md and a .markdown file are read as text", async () => {
  for (const name of ["brief.md", "brief.markdown"]) {
    const { ok } = await run(new File([enc(ONE_LINE)], name));
    assert.equal(ok.kind, "text", `${name} should read as text`);
  }
});

test("a text/* MIME type is read as text whatever the extension", async () => {
  const { ok } = await run(new File([enc(ONE_LINE)], "brief.weird", { type: "text/plain" }));
  assert.equal(ok.kind, "text");
});

test("text is returned verbatim — no trimming, no unwrapping", async () => {
  // The text path must not touch the bytes. src/provenance.js checks quotes literally, so a
  // reader that helpfully normalised whitespace would break quotes that were fine on arrival.
  const messy = `  ${L1}\n\n\n   ${L2}  \n`;
  const { ok } = await run(new File([enc(messy)], "brief.txt"));
  assert.equal(ok.text, messy);
});

test("a short text file is NOT put through looksLikeText", async () => {
  // The guard is for the parsers. A recruiter pasting a two-line brief as .txt is not an error,
  // and refusing it would be the reader inventing a rule the product does not have.
  const { ok } = await run(new File([enc("Band 6.")], "brief.txt"));
  assert.deepEqual(ok, { text: "Band 6.", kind: "text" });
});

test("an unsupported type reports `unsupported`, not `failed`", async () => {
  for (const name of ["cv.rtf", "cv.pages", "cv.jpg", "cv"]) {
    const { err } = await run(new File([enc(ONE_LINE)], name));
    assert.equal(err, "unsupported", `${name} should be unsupported`);
  }
});

test("the reason code is always one of the three the header documents", async () => {
  // The caller turns `.reason` into the sentence the recruiter reads (app.js), so a fourth code
  // would render as no sentence at all.
  const cases = [
    new File([enc(ONE_LINE)], "cv.rtf"),
    pdfFile(enc("%PDF-1.4 nothing here")),
    docxFile(enc("not a zip")),
    pdfFile(contentPdf("BT /F1 12 Tf (short) Tj ET")),
  ];
  for (const file of cases) {
    const { err } = await run(file);
    assert.ok(["unsupported", "unreadable", "failed"].includes(err), `unexpected reason ${err}`);
  }
});

test("a .pdf is recognised by extension even with no MIME type", async () => {
  const { ok } = await run(new File([contentPdf(`BT /F1 12 Tf 72 720 Td (${ONE_LINE}) Tj ET`)], "cv.pdf"));
  assert.equal(ok.kind, "pdf");
});

/* ── .pdf: content ───────────────────────────────────────────────────────────────────── */

test("an uncompressed content stream reads back exactly", async () => {
  const { ok } = await run(pdfFile(contentPdf(`BT /F1 12 Tf 72 720 Td (${ONE_LINE}) Tj ET`)));
  assert.equal(ok.text, ONE_LINE);
  assert.equal(ok.kind, "pdf");
});

test("a /FlateDecode content stream is inflated", async () => {
  const z = await deflate(enc(`BT /F1 12 Tf 72 720 Td (${ONE_LINE}) Tj ET`), "deflate");
  const { ok } = await run(pdfFile(pdf(["<< /Type /Catalog >>", stream("/Filter /FlateDecode", z)])));
  assert.equal(ok.text, ONE_LINE);
});

test("a raw-deflate stream is inflated too, since producers disagree about the wrapper", async () => {
  const z = await deflate(enc(`BT /F1 12 Tf 72 720 Td (${ONE_LINE}) Tj ET`), "deflate-raw");
  const { ok } = await run(pdfFile(pdf(["<< /Type /Catalog >>", stream("/Filter /FlateDecode", z)])));
  assert.equal(ok.text, ONE_LINE);
});

test("a move to a new baseline starts a new line", async () => {
  const { ok } = await run(pdfFile(contentPdf(
    `BT /F1 12 Tf 72 720 Td (${L1}) Tj 0 -14 Td (${L2}) Tj ET`)));
  assert.equal(ok.text, `${L1}\n${L2}`);
});

test("text on the same baseline is not broken", async () => {
  // Two shows at the same y are one line. A break here would put a newline into the middle of a
  // sentence and make a quote spanning it unmatchable.
  const { ok } = await run(pdfFile(contentPdf(
    `BT /F1 12 Tf 72 720 Td (${L1}) Tj (${L2}) Tj ET`)));
  assert.equal(ok.text, `${L1}${L2}`);
});

test("T* and ' move down by the leading", async () => {
  const { ok } = await run(pdfFile(contentPdf(
    `BT /F1 12 Tf 14 TL 72 720 Td (${L1}) Tj T* (${L2}) Tj ET`)));
  assert.equal(ok.text, `${L1}\n${L2}`);
});

test("TJ: a large negative kern becomes the space it stands for", async () => {
  const a = "Registered Nurse with eight years across acute medical wards and";
  const b = "community settings across the trust today";
  const { ok } = await run(pdfFile(contentPdf(
    `BT /F1 12 Tf 72 720 Td [(${a})-300(${b})] TJ ET`)));
  assert.equal(ok.text, `${a} ${b}`);
});

test("TJ: a small kern is letter-spacing and adds nothing", async () => {
  const a = "Registered Nurse with eight years across acute medical wards and comm";
  const b = "unity settings across the trust today";
  const { ok } = await run(pdfFile(contentPdf(
    `BT /F1 12 Tf 72 720 Td [(${a})-40(${b})] TJ ET`)));
  assert.equal(ok.text, `${a}${b}`);
});

test("a string literal's escapes are decoded, including octal", async () => {
  const { ok } = await run(pdfFile(contentPdf(
    `BT /F1 12 Tf 72 720 Td (Registered\\040Nurse with eight years across acute medical wards ` +
    `and community settings, leading falls reduction at Queen\\tVictoria today) Tj ET`)));
  assert.match(ok.text, /^Registered Nurse with eight/);
  assert.match(ok.text, /Queen\tVictoria today$/);
});

test("balanced parentheses inside a literal survive", async () => {
  const withParens =
    "Registered Nurse (RN) with eight years across acute medical wards and community " +
    "settings, leading falls reduction at Queen Victoria today";
  const { ok } = await run(pdfFile(contentPdf(`BT /F1 12 Tf 72 720 Td (${withParens}) Tj ET`)));
  assert.equal(ok.text, withParens);
});

test("an escaped closing paren does not end the literal early", async () => {
  const { ok } = await run(pdfFile(contentPdf(
    `BT /F1 12 Tf 72 720 Td (Registered Nurse \\(RN\\) with eight years across acute medical ` +
    `wards and community settings, leading falls reduction at Queen Victoria today) Tj ET`)));
  assert.match(ok.text, /Nurse \(RN\) with eight years/);
  assert.match(ok.text, /Queen Victoria today$/);
});

test("a hex string is read as bytes", async () => {
  const hex = [...ONE_LINE].map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
  const { ok } = await run(pdfFile(contentPdf(`BT /F1 12 Tf 72 720 Td <${hex}> Tj ET`)));
  assert.equal(ok.text, ONE_LINE);
});

/* ── .pdf: the /Length rule (see the header — Node cannot see its consequence) ────────── */

test("/Length decides the payload, not the distance to `endstream`", async () => {
  // The decisive shape: bytes that are valid content operators sit between the end of the real
  // stream and the `endstream` keyword. Honouring /Length excludes them; scanning for the
  // keyword would show them. Uncompressed on purpose, so the assertion reads the bytes directly
  // rather than depending on how tolerant an inflater is.
  const ops = `BT /F1 12 Tf 72 720 Td (${ONE_LINE}) Tj ET`;
  const bytes = pdf([
    "<< /Type /Catalog >>",
    stream("", enc(ops), enc(` BT (GARBAGEMARKER) Tj ET `)),
  ]);
  const { ok } = await run(pdfFile(bytes));
  assert.equal(ok.text, ONE_LINE);
  assert.doesNotMatch(ok.text, /GARBAGEMARKER/);
});

test("an indirect /Length falls back to trimming, and still reads", async () => {
  // `/Length 9 0 R` needs a lookup this parser does not do, so the regex refuses to match it and
  // the trailing-EOL trim covers the case. Without the negative lookahead it would match "9".
  const ops = `BT /F1 12 Tf 72 720 Td (${ONE_LINE}) Tj ET`;
  const bytes = pdf([
    "<< /Type /Catalog >>",
    cat([enc("<< /Length 9 0 R >>\nstream\n"), enc(ops), enc("\nendstream")]),
  ]);
  const { ok } = await run(pdfFile(bytes));
  assert.equal(ok.text, ONE_LINE);
});

test("a /Length longer than the stream falls back rather than overrunning", async () => {
  const ops = `BT /F1 12 Tf 72 720 Td (${ONE_LINE}) Tj ET`;
  const bytes = pdf([
    "<< /Type /Catalog >>",
    cat([enc(`<< /Length 999999 >>\nstream\n`), enc(ops), enc("\nendstream")]),
  ]);
  const { ok } = await run(pdfFile(bytes));
  assert.equal(ok.text, ONE_LINE);
});

/* ── .pdf: fonts and /ToUnicode ──────────────────────────────────────────────────────── */

/** Each character as a two-byte code, the way an Identity-H font addresses its glyphs. */
const twoByteHex = (text) =>
  [...text].map((c) => c.charCodeAt(0).toString(16).padStart(4, "0")).join("");

/** A PDF whose one content stream shows `text` through a font with the given CMap source. */
function cmapPdf(text, cmapSource, { twoByte = true, fontDict = "/Type /Font /ToUnicode 6 0 R" } = {}) {
  const shown = twoByte
    ? twoByteHex(text)
    : [...text].map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
  return pdf([
    ...PAGE_OBJECTS(stream("", enc(`BT /F1 12 Tf 72 720 Td <${shown}> Tj ET`))),
    `<< ${fontDict} >>`,
    stream("", enc(cmapSource)),
  ]);
}

const IDENTITY_CMAP =
  "begincmap\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n" +
  "1 beginbfrange\n<0020> <007E> <0020>\nendbfrange\nendcmap";

test("a two-byte /ToUnicode CMap decodes the shown string", async () => {
  const { ok } = await run(pdfFile(cmapPdf(ONE_LINE, IDENTITY_CMAP)));
  assert.equal(ok.text, ONE_LINE);
});

test("without the CMap the same file is refused — the map is what makes it readable", async () => {
  // The negative control for the test above. Two-byte codes read one byte at a time are exactly
  // the NUL-interleaved mush looksLikeText exists to catch, so this must be `unreadable` and
  // never text. If this ever returns `ok`, the guard has stopped working.
  const { err } = await run(pdfFile(cmapPdf(ONE_LINE, "begincmap\nendcmap", { fontDict: "/Type /Font" })));
  assert.equal(err, "unreadable");
});

test("a bfchar CMap remaps individual codes", async () => {
  const source =
    "begincmap\n1 begincodespacerange\n<00> <FF>\nendcodespacerange\n" +
    "2 beginbfchar\n<41> <0042>\n<42> <0043>\nendbfchar\nendcmap";
  const { ok } = await run(pdfFile(cmapPdf(`AB${ONE_LINE.slice(2)}`, source, { twoByte: false })));
  assert.equal(ok.text, `BC${ONE_LINE.slice(2)}`);
});

test("a bfrange with an array of destinations maps each code in turn", async () => {
  const source =
    "begincmap\n1 begincodespacerange\n<00> <FF>\nendcodespacerange\n" +
    "1 beginbfrange\n<41> <42> [<0058> <0059>]\nendbfrange\nendcmap";
  const { ok } = await run(pdfFile(cmapPdf(`AB${ONE_LINE.slice(2)}`, source, { twoByte: false })));
  assert.equal(ok.text, `XY${ONE_LINE.slice(2)}`);
});

test("a font with no /ToUnicode is left alone rather than mangled", async () => {
  // A simple font's codes are Latin-1 already. Inventing a mapping would corrupt a file that
  // was fine.
  const bytes = pdf([
    ...PAGE_OBJECTS(stream("", enc(`BT /F1 12 Tf 72 720 Td (${ONE_LINE}) Tj ET`))),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ]);
  const { ok } = await run(pdfFile(bytes));
  assert.equal(ok.text, ONE_LINE);
});

/* ── .pdf: unwrap, which is a provenance requirement rather than tidying ─────────────── */

test("a line the layout broke mid-sentence is rejoined", async () => {
  // The case the header names: "…no conditions or / restrictions." across two lines. The model
  // quotes what it is given and src/provenance.js searches literally, so the break must go.
  const head = "Registered Nurse with eight years across acute medical wards and no conditions or";
  const tail = "restrictions on practice recorded at any point during that period today";
  const { ok } = await run(pdfFile(contentPdf(
    `BT /F1 12 Tf 72 720 Td (${head}) Tj 0 -14 Td (${tail}) Tj ET`)));
  assert.equal(ok.text, `${head} ${tail}`);
});

// ⚠ A finding from mutation-testing this file, recorded here rather than silently worked around.
// `unwrap`'s bullet guard — `!/^\s*([-•*•]|\d+[.)])\s/.test(line)` — is UNREACHABLE. Deleting it
// makes no test below fail, and cannot: the guard only fires on a line whose first character is
// whitespace, `-`, `•`, `*` or a digit, and the `/^[a-z(]/` test on the same expression already
// requires that character to be a lowercase letter or `(`. The two sets are disjoint, so the
// lowercase rule alone is what protects every bullet. The guard is harmless belt-and-braces and
// is left alone; the tests below pin the BEHAVIOUR (bullets are never merged), which is what
// matters, and deliberately do not claim to cover that expression.

test("two dash bullets are never merged, even when the second starts lowercase", async () => {
  // The conservative half, and the one that matters more: merging two bullets invents a claim
  // spanning both, which is worse than leaving a break in.
  const one = "- Registered Nurse with eight years across acute medical wards and no settings";
  const two = "- community falls reduction lead at Queen Victoria Hospital, thirty percent today";
  const { ok } = await run(pdfFile(contentPdf(
    `BT /F1 12 Tf 72 720 Td (${one}) Tj 0 -14 Td (${two}) Tj ET`)));
  assert.equal(ok.text, `${one}\n${two}`);
});

test("two round bullets are never merged either", async () => {
  // U+2022 has to arrive as one character to exercise the `•` branch of the guard, and a PDF
  // simple font cannot carry it — written into a content stream directly it is three UTF-8
  // bytes and comes back as `â€¢`. So this goes through a two-byte font, which is also how a
  // real Word-exported CV carries its bullets.
  const one = "• Registered Nurse with eight years across acute medical wards and no settings";
  const two = "• community falls reduction lead at Queen Victoria Hospital, thirty percent today";
  const cmap = IDENTITY_CMAP.replace("endcmap", "1 beginbfchar\n<2022> <2022>\nendbfchar\nendcmap");
  const bytes = pdf([
    ...PAGE_OBJECTS(stream("", enc(
      `BT /F1 12 Tf 72 720 Td <${twoByteHex(one)}> Tj 0 -14 Td <${twoByteHex(two)}> Tj ET`))),
    "<< /Type /Font /ToUnicode 6 0 R >>",
    stream("", enc(cmap)),
  ]);
  const { ok } = await run(pdfFile(bytes));
  assert.equal(ok.text, `${one}\n${two}`);
});

test("a line ending in a full stop is never joined to the next", async () => {
  const { ok } = await run(pdfFile(contentPdf(
    `BT /F1 12 Tf 72 720 Td (${L1}) Tj 0 -14 Td (leading falls reduction at Queen Victoria today) Tj ET`)));
  assert.equal(ok.text.split("\n").length, 2);
});

test("a numbered list item is not joined to the line above", async () => {
  const head = "Registered Nurse with eight years across acute medical wards and community";
  const item = "1. settings across the trust, leading falls reduction at Queen Victoria today";
  const { ok } = await run(pdfFile(contentPdf(
    `BT /F1 12 Tf 72 720 Td (${head}) Tj 0 -14 Td (${item}) Tj ET`)));
  assert.equal(ok.text, `${head}\n${item}`);
});

test("a `1)` list item is not joined either — its paren is escaped, as a writer escapes it", async () => {
  // Worth its own case because `1)` inside a literal is the shape that closes the string early
  // if a writer forgets the backslash. Escaped, it must reach `unwrap` intact and be protected.
  const head = "Registered Nurse with eight years across acute medical wards and community";
  const item = "1) settings across the trust, leading falls reduction at Queen Victoria today";
  const { ok } = await run(pdfFile(contentPdf(
    `BT /F1 12 Tf 72 720 Td (${head}) Tj 0 -14 Td (1\\) ${item.slice(3)}) Tj ET`)));
  assert.equal(ok.text, `${head}\n${item}`);
});

test("a hyphen at the break is joined without adding a space", async () => {
  const head = "Registered Nurse with eight years across acute medical wards and community-";
  const tail = "based settings, leading falls reduction at Queen Victoria Hospital today";
  const { ok } = await run(pdfFile(contentPdf(
    `BT /F1 12 Tf 72 720 Td (${head}) Tj 0 -14 Td (${tail}) Tj ET`)));
  assert.equal(ok.text, `${head}${tail}`);
});

/* ── .pdf: refusal ───────────────────────────────────────────────────────────────────── */

test("an encrypted PDF is `unreadable`, not `failed`", async () => {
  // The distinction is the sentence the recruiter reads. "Unreadable, paste instead" is
  // actionable; "failed" reads as the product being broken.
  const bytes = pdf([
    "<< /Type /Catalog /Encrypt 9 0 R >>",
    stream("", enc(`BT /F1 12 Tf 72 720 Td (${ONE_LINE}) Tj ET`)),
  ]);
  assert.equal((await run(pdfFile(bytes))).err, "unreadable");
});

test("a scanned PDF — an image and no text operators — is `unreadable`", async () => {
  const bytes = pdf([
    "<< /Type /Catalog >>",
    stream("/Subtype /Image /XObject /Image", new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])),
  ]);
  assert.equal((await run(pdfFile(bytes))).err, "unreadable");
});

test("a PDF with a header and nothing else is `unreadable`", async () => {
  assert.equal((await run(pdfFile(enc("%PDF-1.4\n%%EOF\n")))).err, "unreadable");
});

test("a truncated PDF — no `endstream` — does not hang or throw past the reader", async () => {
  const bytes = cat([enc("%PDF-1.4\n1 0 obj\n<< /Length 40 >>\nstream\nBT (Registered Nurse) Tj")]);
  const { err, ok } = await run(pdfFile(bytes));
  assert.equal(ok, undefined);
  assert.ok(["unreadable", "failed"].includes(err));
});

test("a PDF whose text decodes to too little is refused rather than returned short", async () => {
  // The half-read case, and the one silent garbling would look like: something came out, but
  // not enough of the CV to generate against.
  const { err } = await run(pdfFile(contentPdf("BT /F1 12 Tf 72 720 Td (Band 6 Nurse) Tj ET")));
  assert.equal(err, "unreadable");
});

test("a file with a .pdf name that is not a PDF is refused", async () => {
  assert.equal((await run(pdfFile(enc(ONE_LINE), "cv.pdf"))).err, "unreadable");
});

/* ── the .docx ZIP layer, via the tripwire ───────────────────────────────────────────── */

/** A ZIP built the way a .docx is: entries, then the central directory, then the EOCD. */
async function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const { name, data, method = 8, dataDescriptor = false } of entries) {
    const raw = enc(data);
    const payload = method === 8 ? await deflate(raw, "deflate-raw") : raw;
    const nameBytes = enc(name);
    // With a data descriptor the writer streams the entry and does not know the sizes when it
    // emits the local header, so it writes zeros there, sets flag bit 3, and repeats the real
    // values after the payload. The central directory always carries the true ones. Word does
    // this. A reader trusting the local header gets nothing.
    const local = cat([
      u32(0x04034b50), u16(20), u16(dataDescriptor ? 0x08 : 0), u16(method), u16(0), u16(0),
      dataDescriptor ? u32(0) : u32(0),
      dataDescriptor ? u32(0) : u32(payload.length),
      dataDescriptor ? u32(0) : u32(raw.length),
      u16(nameBytes.length), u16(0), nameBytes, payload,
      ...(dataDescriptor
        ? [cat([u32(0x08074b50), u32(0), u32(payload.length), u32(raw.length)])]
        : []),
    ]);
    centrals.push(cat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(method), u16(0), u16(0),
      u32(0), u32(payload.length), u32(raw.length),
      u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBytes,
    ]));
    locals.push(local);
    offset += local.length;
  }

  const directory = cat(centrals);
  return cat([
    ...locals,
    directory,
    cat([u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
         u32(directory.length), u32(offset), u16(0)]),
  ]);
}

const DOCUMENT_XML =
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  `<w:body><w:p><w:r><w:t>${L1}</w:t></w:r></w:p></w:body></w:document>`;

test("a deflated word/document.xml is delivered to the XML parser byte-for-byte", async () => {
  seen = null;
  const bytes = await zip([
    { name: "[Content_Types].xml", data: "<Types/>" },
    { name: "word/document.xml", data: DOCUMENT_XML },
  ]);
  await run(docxFile(bytes));
  assert.equal(seen?.xml, DOCUMENT_XML);
  assert.equal(seen?.type, "application/xml");
});

test("a stored (uncompressed) word/document.xml is delivered too", async () => {
  seen = null;
  const bytes = await zip([{ name: "word/document.xml", data: DOCUMENT_XML, method: 0 }]);
  await run(docxFile(bytes));
  assert.equal(seen?.xml, DOCUMENT_XML);
});

test("the right entry is found when it is not the first in the archive", async () => {
  // The reason the reader walks the central directory rather than scanning for local headers:
  // the offsets have to be right, and a real .docx has document.xml several entries in.
  seen = null;
  const bytes = await zip([
    { name: "[Content_Types].xml", data: "<Types/>" },
    { name: "_rels/.rels", data: "<Relationships/>" },
    { name: "word/_rels/document.xml.rels", data: "<Relationships/>" },
    { name: "word/document.xml", data: DOCUMENT_XML },
    { name: "word/styles.xml", data: "<styles/>" },
  ]);
  await run(docxFile(bytes));
  assert.equal(seen?.xml, DOCUMENT_XML);
});

test("an entry with a data descriptor reads — the local header's sizes are zero", async () => {
  // The exact reason unzipEntry walks the central directory rather than the local headers, and
  // the case Word actually produces. A reader trusting the local header takes a zero-length
  // slice here and the whole .docx comes back empty.
  seen = null;
  const bytes = await zip([
    { name: "[Content_Types].xml", data: "<Types/>", dataDescriptor: true },
    { name: "word/document.xml", data: DOCUMENT_XML, dataDescriptor: true },
  ]);
  await run(docxFile(bytes));
  assert.equal(seen?.xml, DOCUMENT_XML);
});

test("mixed stored and deflated entries do not shift the offsets", async () => {
  seen = null;
  const bytes = await zip([
    { name: "[Content_Types].xml", data: "<Types/>", method: 0 },
    { name: "_rels/.rels", data: "<Relationships/>", method: 8 },
    { name: "word/document.xml", data: DOCUMENT_XML, method: 8 },
  ]);
  await run(docxFile(bytes));
  assert.equal(seen?.xml, DOCUMENT_XML);
});

test("an archive with no word/document.xml never reaches the XML parser", async () => {
  seen = null;
  const bytes = await zip([{ name: "word/styles.xml", data: "<styles/>" }]);
  const { err } = await run(docxFile(bytes));
  assert.equal(seen, null);
  assert.equal(err, "failed");
});

test("an unsupported compression method is refused, not decoded wrongly", async () => {
  seen = null;
  const bytes = await zip([{ name: "word/document.xml", data: DOCUMENT_XML, method: 0 }]);
  // Patch the central directory's method field to 12 (bzip2), which this reader does not do.
  let central = -1;
  for (let i = 0; i < bytes.length - 4; i += 1) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x01 && bytes[i + 3] === 0x02) {
      central = i;
      break;
    }
  }
  assert.ok(central > 0, "no central directory header in the fixture");
  new DataView(bytes.buffer).setUint16(central + 10, 12, true);

  const { err } = await run(docxFile(bytes));
  assert.equal(seen, null);
  assert.equal(err, "failed");
});

test("a .docx that is not a ZIP is refused", async () => {
  seen = null;
  const { err } = await run(docxFile(enc(ONE_LINE)));
  assert.equal(seen, null);
  assert.equal(err, "failed");
});

test("a .docx MIME type with no .docx extension is still read as a .docx", async () => {
  seen = null;
  const bytes = await zip([{ name: "word/document.xml", data: DOCUMENT_XML }]);
  await run(new File([bytes], "cv", {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  }));
  assert.equal(seen?.xml, DOCUMENT_XML);
});

test("no reader ever returns text it could not read — the whole point of the file", async () => {
  // One assertion over every refusal shape at once. `ok` must be undefined for all of them:
  // best-effort mush reaching a pack is the failure this file exists to prevent.
  const refusals = [
    pdfFile(enc("%PDF-1.4\n%%EOF\n")),
    pdfFile(contentPdf("BT /F1 12 Tf (Band 6) Tj ET")),
    pdfFile(pdf(["<< /Encrypt 9 0 R >>", stream("", enc(`BT (${ONE_LINE}) Tj ET`))])),
    pdfFile(cmapPdf(ONE_LINE, "begincmap\nendcmap", { fontDict: "/Type /Font" })),
    docxFile(enc("not a zip at all")),
    docxFile(await zip([{ name: "word/styles.xml", data: "<styles/>" }])),
    new File([enc(ONE_LINE)], "cv.rtf"),
  ];
  for (const file of refusals) {
    const { ok, err } = await run(file);
    assert.equal(ok, undefined, `${file.name} returned text it should have refused`);
    assert.ok(err, `${file.name} produced no reason code`);
  }
});
