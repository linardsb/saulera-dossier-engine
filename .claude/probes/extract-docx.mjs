// Browser probes for public/extract.js — the half test/extract.test.js cannot reach.
//
// WHY THIS EXISTS. Two distinct reasons, and the second is the one that would otherwise ship a
// bug through a green suite.
//
//   1. `docxToText` needs DOMParser, NodeFilter and createTreeWalker. `node --test` has no DOM
//      and the plan forbids adding tooling to get one, so the XML → text mapping — which is
//      what turns a Word CV into the text every source_quote is checked against — has no
//      coverage there at all. It has coverage here.
//
//   2. CHROME'S DecompressionStream IS STRICTER THAN NODE'S. It rejects trailing bytes after
//      the end of a deflate stream; Node tolerates them. extract.js:406-414 records that this
//      already happened once: searching for the `endstream` keyword produced a payload that
//      inflated in Node and threw in every browser, so every stream failed and the PDF came out
//      empty rather than wrong.
//
//      Be precise about the division of labour, because it was overclaimed in the first draft
//      of this header. extract.js has TWO defences: /Length when it is a direct number, and a
//      trailing-byte trim when it is not. `test/extract.test.js` covers the /Length rule fine —
//      removing it fails that suite. What Node CANNOT see is the TRIM path: with an indirect
//      /Length the payload keeps a trailing EOL unless it is trimmed, and Node inflates it
//      anyway. Delete the trim loop and `npm test` stays 58/58 green while every real browser
//      stops reading compressed PDFs. **Probe 11 is the only thing in this repo that catches
//      that**, and it is the reason this file is not optional.
//
// Same shape as one-screen.mjs: real Chrome over CDP, no npm dependency, Node >= 22 for the
// global WebSocket. Not part of `npm test` on purpose — it needs a browser, so it is a thing
// you run, not a gate.
//
//   node --version   # must be >= 22
//   node .claude/probes/extract-docx.mjs

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 8791;
const CDP_PORT = 9336;

const results = [];
function check(id, what, pass, detail) {
  results.push({ id, pass });
  console.log(`${pass ? "  ok  " : "FAIL  "}${id}. ${what}`);
  if (!pass && detail) console.log(`        ${detail}`);
}

/* ── the two long-lived processes ────────────────────────────────────────────────────── */

// One page, loading the real public/extract.js. Nothing else from the app: this probe is about
// the reader, not the screen.
const HARNESS = `<!doctype html><meta charset="utf-8"><title>extract probe</title>
<script src="/extract.js"></script>`;

function serveStatic() {
  const server = createServer((req, res) => {
    const path = req.url.split("?")[0];
    if (path === "/extract.js") {
      res.writeHead(200, { "content-type": "text/javascript" });
      res.end(readFileSync(join(ROOT, "public/extract.js")));
      return;
    }
    res.writeHead(200, { "content-type": "text/html" });
    res.end(HARNESS);
  });
  return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}

async function startChrome() {
  const profile = mkdtempSync(join(tmpdir(), "probe-extract-"));
  const proc = spawn(CHROME, [
    "--headless=new",
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
  ], { stdio: "ignore" });

  for (let i = 0; i < 100; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
      if (res.ok) return { proc, profile };
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Chrome did not open a debugging port");
}

/* ── a minimal CDP client ────────────────────────────────────────────────────────────── */

async function newPage() {
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: "PUT" });
  const target = await res.json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error("could not attach to the page"));
  });

  let id = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      id += 1;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/probe.html` });
  await new Promise((r) => setTimeout(r, 400));

  return {
    async eval(expression) {
      const { result, exceptionDetails } = await send("Runtime.evaluate", {
        expression, awaitPromise: true, returnByValue: true,
      });
      if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? "threw");
      return result.value;
    },
    close: () => fetch(`http://127.0.0.1:${CDP_PORT}/json/close/${target.id}`),
  };
}

/**
 * Run the real extractText over `bytes` inside the page. The bytes cross as base64 because CDP
 * carries JSON; the File is built in the page so the reader sees a genuine browser File.
 */
async function extractIn(page, bytes, name, type = "") {
  const b64 = Buffer.from(bytes).toString("base64");
  return page.eval(`
    (function () {
      var bin = atob(${JSON.stringify(b64)});
      var buf = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      var file = new File([buf], ${JSON.stringify(name)}, { type: ${JSON.stringify(type)} });
      return window.DossierExtract.extractText(file).then(
        function (r) { return { text: r.text, kind: r.kind }; },
        function (e) { return { reason: e.reason }; }
      );
    })()
  `);
}

/* ── fixtures ────────────────────────────────────────────────────────────────────────── */

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

async function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data, method = 8 } of entries) {
    const raw = enc(data);
    const payload = method === 8 ? await deflate(raw, "deflate-raw") : raw;
    const nameBytes = enc(name);
    const local = cat([
      u32(0x04034b50), u16(20), u16(0), u16(method), u16(0), u16(0),
      u32(0), u32(payload.length), u32(raw.length),
      u16(nameBytes.length), u16(0), nameBytes, payload,
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
  return cat([...locals, directory, cat([
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(directory.length), u32(offset), u16(0),
  ])]);
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const doc = (body) => `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${body}</w:body></w:document>`;
const para = (runs) => `<w:p>${runs}</w:p>`;
const t = (text) => `<w:r><w:t>${text}</w:t></w:r>`;

const docxOf = (body) => zip([
  { name: "[Content_Types].xml", data: "<Types/>" },
  { name: "word/document.xml", data: doc(body) },
]);

// Long enough to clear looksLikeText, which needs 15 words of more than two characters.
const L1 = "Registered Nurse with eight years across acute medical wards and community settings";
const L2 = "Led the falls reduction project at Queen Victoria Hospital, cutting incidents overall";
const L3 = "Revalidated in March with no restrictions recorded against the register at any point";

/* ── probes ──────────────────────────────────────────────────────────────────────────── */

async function main(page) {
  /* 1 — one line per w:p */
  const r1 = await extractIn(page, await docxOf(para(t(L1)) + para(t(L2)) + para(t(L3))), "cv.docx");
  check("1", "each w:p becomes its own line", r1.text === `${L1}\n${L2}\n${L3}` && r1.kind === "docx",
    `got ${JSON.stringify(r1)}`);

  /* 2 — runs inside one paragraph join with no separator */
  // Word splits a sentence across runs at every formatting change, so a spell-checked CV has
  // them mid-word. Anything inserted between runs would corrupt the text a quote is checked
  // against — this is the .docx equivalent of the PDF kerning case.
  const split = t("Registered Nur") + t("se with eight years across acute medical wards and ") +
    t("community settings across the trust today");
  const r2 = await extractIn(page, await docxOf(para(split)), "cv.docx");
  check("2", "runs within a paragraph join with nothing between them",
    r2.text === "Registered Nurse with eight years across acute medical wards and community settings across the trust today",
    `got ${JSON.stringify(r2)}`);

  /* 3 — w:tab and w:br */
  const withMarks = `<w:r><w:t>${L1}</w:t><w:tab/><w:t>tabbed</w:t><w:br/><w:t>${L2}</w:t></w:r>`;
  const r3 = await extractIn(page, await docxOf(para(withMarks)), "cv.docx");
  check("3", "w:tab becomes a tab and w:br becomes a newline",
    r3.text === `${L1}\ttabbed\n${L2}`, `got ${JSON.stringify(r3)}`);

  /* 4 — a table comes out row by row */
  const cell = (text) => `<w:tc>${para(t(text))}</w:tc>`;
  const table = `<w:tbl><w:tr>${cell(L1)}${cell(L2)}</w:tr><w:tr>${cell(L3)}</w:tr></w:tbl>`;
  const r4 = await extractIn(page, await docxOf(table), "cv.docx");
  check("4", "a skills table's cells all reach the text",
    typeof r4.text === "string" && [L1, L2, L3].every((line) => r4.text.includes(line)),
    `got ${JSON.stringify(r4)}`);

  /* 5 — an empty paragraph does not swallow the lines around it */
  const r5 = await extractIn(page, await docxOf(para(t(L1)) + para("") + para(t(L2))), "cv.docx");
  check("5", "an empty w:p leaves the surrounding lines intact",
    typeof r5.text === "string" && r5.text.includes(L1) && r5.text.includes(L2),
    `got ${JSON.stringify(r5)}`);

  /* 6 — non-w namespaces are ignored */
  // A tracked-change or comment element carries text that is NOT in the document. Pulling it in
  // would put words in the CV that the candidate never wrote, and a quote would then verify
  // against text no human can find in the file.
  const foreign = `<w:p><w:r><w:t>${L1}</w:t></w:r>` +
    `<m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">` +
    `<m:t>NOTINTHECV</m:t></m:oMath></w:p>` + para(t(L2)) + para(t(L3));
  const r6 = await extractIn(page, await docxOf(foreign), "cv.docx");
  check("6", "text outside the wordprocessingml namespace is not pulled in",
    typeof r6.text === "string" && !r6.text.includes("NOTINTHECV"), `got ${JSON.stringify(r6)}`);

  /* 7 — malformed XML is refused, not half-read */
  const broken = await zip([{ name: "word/document.xml", data: `<w:document ${W}><w:body><w:p>` }]);
  const r7 = await extractIn(page, broken, "cv.docx");
  check("7", "a truncated document.xml is refused rather than half-read",
    r7.reason !== undefined && r7.text === undefined, `got ${JSON.stringify(r7)}`);

  /* 8 — the /Length path, against a strict inflater */
  // A /FlateDecode stream with the writer's EOL between the data and `endstream`, and a correct
  // direct /Length. Node's suite proves /Length is what gets sliced; this proves the slice is
  // byte-exact enough for an inflater that will not forgive one spare byte.
  const ops = `BT /F1 12 Tf 72 720 Td (${L1}) Tj 0 -14 Td (${L2}) Tj ET`;
  const z = await deflate(enc(ops), "deflate");
  const flatePdf = (lengthField) => cat([
    enc("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n"),
    enc(`2 0 obj\n<< /Filter /FlateDecode /Length ${lengthField} >>\nstream\n`),
    z,
    enc("\r\nendstream\nendobj\ntrailer << /Root 1 0 R >>\n%%EOF\n"),
  ]);
  const r8 = await extractIn(page, flatePdf(z.length), "cv.pdf", "application/pdf");
  check("8", "a PDF stream with a trailing EOL inflates in Chrome via /Length",
    r8.text === `${L1}\n${L2}`, `got ${JSON.stringify(r8)}`);

  /* 9 — a stored .docx, end to end, in a real browser */
  const r9 = await extractIn(page, await zip([
    { name: "word/document.xml", data: doc(para(t(L1)) + para(t(L2))), method: 0 },
  ]), "cv.docx");
  check("9", "an uncompressed .docx reads end to end in a real browser",
    r9.text === `${L1}\n${L2}`, `got ${JSON.stringify(r9)}`);

  /* 10 — the refusals still refuse with a real DOM present */
  // In `node --test` these all end at a missing DOMParser, so this is the first time they are
  // seen refusing for their own reasons rather than for the absence of a browser.
  const noDoc = await zip([{ name: "word/styles.xml", data: "<styles/>" }]);
  const notZip = enc("this is not a zip and never was, it is just a sentence in a file");
  const empty = await docxOf(para(t("Band 6.")));
  const [a, b, c] = await Promise.all([
    extractIn(page, noDoc, "cv.docx"),
    extractIn(page, notZip, "cv.docx"),
    extractIn(page, empty, "cv.docx"),
  ]);
  check("10", "no word/document.xml, not a ZIP, and too little text all refuse",
    a.text === undefined && b.text === undefined && c.reason === "unreadable",
    `got ${JSON.stringify({ noDoc: a, notZip: b, tooShort: c })}`);

  /* 11 — THE ONE NOTHING ELSE IN THE REPO CATCHES. See the header. */
  // Same stream, but `/Length 9 0 R` — an indirect reference this parser deliberately does not
  // resolve. That drops it onto the trailing-byte trim, and the trim is the only thing standing
  // between Chrome's inflater and the `\r\n` before `endstream`. Node tolerates that EOL, so
  // deleting the trim keeps `npm test` at 58/58 and breaks every compressed PDF in every
  // browser. This is the assertion that fails instead.
  const r11 = await extractIn(page, flatePdf("9 0 R"), "cv.pdf", "application/pdf");
  check("11", "an indirect /Length falls back to the TRIM, and Chrome still inflates it",
    r11.text === `${L1}\n${L2}`,
    `got ${JSON.stringify(r11)} — if this is "unreadable", the trailing-byte trim at ` +
    `extract.js:420-426 regressed and every browser upload of a compressed PDF is broken`);
}

/* ── run ─────────────────────────────────────────────────────────────────────────────── */

const server = await serveStatic();
const chrome = await startChrome();
let page;
try {
  page = await newPage();
  await main(page);
} finally {
  if (page) await page.close().catch(() => {});
  chrome.proc.kill();
  await new Promise((r) => chrome.proc.once("exit", r));
  rmSync(chrome.profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  server.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} probes pass`);
process.exit(failed.length ? 1 : 0);
