// #7 AC6 — snapshot tests over pack fixtures, including a pack containing unverified claims.
//
// The renderers are pure functions over the pack contract from #4: no model call, no
// persistence, no network. That makes them the cheapest thing in the repo to pin exactly, and
// the most valuable to pin, because AC4 — *"unverified claims render visibly as unverified,
// never dropped, never rendered indistinguishably from sourced claims"* — is a property of the
// output text and nowhere else.
//
// Snapshots are hand-rolled rather than `t.assert.snapshot`, which does not exist on Node
// v20.20.2 — this machine's default, and a version the suite has to keep passing on. Regenerate
// deliberately:
//
//   UPDATE_SNAPSHOTS=1 npm test
//
// Review the diff when you do. A snapshot that changes because the copy improved is a good
// diff; one that changes because a claim stopped being marked UNVERIFIED is the bug this file
// exists to catch, and the assertions below fail on it independently of the snapshot so it
// cannot be waved through by regenerating.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { RENDERERS, DEFAULT_RENDERER, render } from "../src/render/index.js";
import { allClaims, assertPack } from "../src/pack.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "fixtures");
const UPDATE = process.env.UPDATE_SNAPSHOTS === "1";

const load = (name) => assertPack(JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf8")));

const SOURCED = load("pack-sourced");
const UNVERIFIED_PACK = load("pack-unverified");
const LOCUM_PACK = load("pack-locum");

function snapshot(name, actual) {
  const file = join(FIXTURES, `${name}.snap`);
  if (UPDATE || !existsSync(file)) {
    mkdirSync(FIXTURES, { recursive: true });
    writeFileSync(file, actual);
    return;
  }
  assert.equal(
    actual,
    readFileSync(file, "utf8"),
    `${name} changed. If that was deliberate: UPDATE_SNAPSHOTS=1 npm test, then read the diff.`,
  );
}

/* ── the snapshots ─────────────────────────────────────────────────────────────────────── */

for (const id of Object.keys(RENDERERS)) {
  for (const [fixture, pack] of [
    ["sourced", SOURCED],
    ["unverified", UNVERIFIED_PACK],
    ["locum", LOCUM_PACK],
  ]) {
    test(`${id} renders ${fixture} to a stable text body`, () => {
      snapshot(`${fixture}.${id}.text`, RENDERERS[id].render(pack).text);
    });
    test(`${id} renders ${fixture} to a stable html body`, () => {
      snapshot(`${fixture}.${id}.html`, RENDERERS[id].render(pack).html);
    });
  }
}

/* ── AC4: unverified is visible, and never dropped ─────────────────────────────────────── */

test("every claim reaches the output, verified or not", () => {
  // "Never dropped" is the half of AC4 that a marker check alone does not cover: a renderer
  // that silently skipped unsourced claims would still mark every claim it printed.
  for (const id of Object.keys(RENDERERS)) {
    for (const pack of [UNVERIFIED_PACK, LOCUM_PACK]) {
      const { text, html } = RENDERERS[id].render(pack);
      for (const claim of allClaims(pack)) {
        assert.ok(text.includes(claim.text.slice(0, 40)), `${id} text dropped: ${claim.text}`);
        // The HTML path escapes, so compare against a span with no metacharacters in it.
        const plain = claim.text.split("&")[0].slice(0, 30);
        assert.ok(html.includes(plain), `${id} html dropped: ${claim.text}`);
      }
    }
  }
});

test("an unverified claim is marked, and a sourced one is not", () => {
  for (const id of Object.keys(RENDERERS)) {
    const unver = RENDERERS[id].render(UNVERIFIED_PACK);
    const sourced = RENDERERS[id].render(SOURCED);

    const unverifiedCount = allClaims(UNVERIFIED_PACK)
      .filter((c) => c.source_type === "unverified").length;
    assert.equal(
      unver.text.match(/\[UNVERIFIED\]/g)?.length ?? 0,
      unverifiedCount,
      `${id}: every unverified claim carries the marker, and only those`,
    );
    assert.ok(unver.html.includes("[UNVERIFIED]"), `${id}: html marks it too`);

    // The pack where everything is sourced must carry no marker at all — otherwise the marker
    // says nothing.
    assert.doesNotMatch(sourced.text, /UNVERIFIED\]/, `${id}: a fully sourced pack is unmarked`);
    assert.doesNotMatch(sourced.html, /\[UNVERIFIED\]/, `${id}: same in html`);
  }
});

test("an unverified claim never carries a citation or a source line", () => {
  // The failure that matters is not a missing marker, it is a fabricated citation: an
  // unsourced claim rendered with a [3] next to it reads exactly like a sourced one.
  const appendix = RENDERERS.appendix.render(UNVERIFIED_PACK).text;
  const [body, sourcesBlock = ""] = appendix.split("SOURCES");
  const citations = body.match(/\[(\d+)\]/g) ?? [];
  const listed = sourcesBlock.match(/^\[(\d+)\]/gm) ?? [];
  assert.equal(citations.length, listed.length, "every citation in the body resolves to a source");

  const inline = RENDERERS.inline.render(UNVERIFIED_PACK).text;
  for (const line of inline.split("\n")) {
    if (line.includes("[UNVERIFIED]")) {
      assert.doesNotMatch(line, /Source:/, "an unverified claim must not show a source line");
    }
  }
});

test("appendix citations are contiguous from 1 and resolve to the footer", () => {
  const { text } = RENDERERS.appendix.render(SOURCED);
  const [body, footer] = text.split("SOURCES");
  const cited = [...body.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
  const listed = [...footer.matchAll(/^\[(\d+)\]/gm)].map((m) => Number(m[1]));

  assert.deepEqual(cited, listed, "citation order is the footer's order");
  assert.deepEqual(cited, cited.map((_, i) => i + 1), "numbered 1..n with no gaps");
  assert.equal(
    cited.length,
    allClaims(SOURCED).filter((c) => c.source_type !== "unverified").length,
    "one citation per sourced claim",
  );
});

/* ── the properties that are not about sourcing ────────────────────────────────────────── */

test("html output escapes everything a pack could carry", () => {
  // candidate_ref in the fixture contains a <script> tag, because a pack is model output over
  // an agency-supplied CV and neither is trusted markup.
  for (const id of Object.keys(RENDERERS)) {
    const { html } = RENDERERS[id].render(UNVERIFIED_PACK);
    assert.doesNotMatch(html, /<script/i, `${id} rendered a raw script tag`);
    assert.ok(html.includes("&lt;script&gt;"), `${id} should escape it, not strip it`);
    assert.ok(html.includes("&amp;"), `${id} should escape bare ampersands`);
  }
});

test("a verbatim quote is collapsed for display and left alone in the pack", () => {
  // src/render/text.js: quotes are stored verbatim so provenance can match them, and carry the
  // source document's own line breaks. Collapsing them for DISPLAY only is load-bearing —
  // getting it backwards silently breaks the verifier.
  const multiline = UNVERIFIED_PACK.evidence[0];
  assert.ok(multiline.source_quote.includes("\n"), "fixture should hold a multi-line quote");

  const { text } = RENDERERS.inline.render(UNVERIFIED_PACK);
  assert.doesNotMatch(text, /Ward 12 \(General Surgery\), 2020-2026\n\s+Staff Nurse/, "collapsed");
  assert.equal(
    UNVERIFIED_PACK.evidence[0].source_quote,
    multiline.source_quote,
    "rendering must not mutate the pack it was given",
  );
});

test("a rendered pack stays inside one to two pages", () => {
  // PRD §6 condition 4: "Do not port the density across; port the method." ~50 lines a page.
  for (const id of Object.keys(RENDERERS)) {
    const lines = RENDERERS[id].render(SOURCED).text.split("\n").length;
    assert.ok(lines <= 110, `${id} rendered ${lines} lines, which is past two pages`);
  }
});

test("empty optional sections render no empty headings", () => {
  const bare = assertPack({
    ...SOURCED, process_fit: [], gaps: [], open_questions: [],
  });
  for (const id of Object.keys(RENDERERS)) {
    const { text } = RENDERERS[id].render(bare);
    assert.doesNotMatch(text, /WHAT WE KNOW ABOUT YOUR PROCESS/);
    assert.doesNotMatch(text, /WHERE THEY DON'T MEET THE BRIEF/);
    assert.doesNotMatch(text, /FOR THE RECRUITER TO CONFIRM/);
    assert.ok(text.includes("AGAINST THE BRIEF"), `${id} keeps the section that always exists`);
  }
});

/* ── the locum booking variant (#49) ───────────────────────────────────────────────────── */

const LOCUM_HEADINGS = [
  "COMPLIANCE AT A GLANCE",
  "AVAILABILITY AND RATE",
  "MODALITY AND SCANNER MATRIX",
];

test("the locum pack is titled LOCUM BOOKING and the perm packs are not", () => {
  for (const id of Object.keys(RENDERERS)) {
    assert.match(RENDERERS[id].render(LOCUM_PACK).text, /^LOCUM BOOKING — /, id);
    for (const pack of [SOURCED, UNVERIFIED_PACK]) {
      assert.match(RENDERERS[id].render(pack).text, /^SUBMISSION PACK — /, id);
    }
  }
});

test("the booking sections lead: compliance renders before the brief evidence", () => {
  for (const id of Object.keys(RENDERERS)) {
    const { text } = RENDERERS[id].render(LOCUM_PACK);
    for (const heading of LOCUM_HEADINGS) {
      assert.ok(text.includes(heading), `${id} is missing ${heading}`);
      assert.ok(
        text.indexOf(heading) < text.indexOf("AGAINST THE BRIEF"),
        `${id}: ${heading} must render before AGAINST THE BRIEF`,
      );
    }
  }
});

test("an unverified compliance item is marked and carries no citation or source line", () => {
  const appendix = RENDERERS.appendix.render(LOCUM_PACK).text;
  const dbs = appendix.split("\n").find((l) => l.includes("DBS status not evidenced"));
  assert.ok(dbs.includes("[UNVERIFIED]"), "the marker is on the compliance line");
  assert.doesNotMatch(dbs, /\[\d+\]/, "no citation number on an unverified check");

  const inline = RENDERERS.inline.render(LOCUM_PACK).text;
  const lines = inline.split("\n");
  const at = lines.findIndex((l) => l.includes("DBS status not evidenced"));
  assert.doesNotMatch(lines[at + 1] ?? "", /Source:/, "no source line under it");
});

test("the perm fixtures render none of the locum headings", () => {
  for (const id of Object.keys(RENDERERS)) {
    for (const pack of [SOURCED, UNVERIFIED_PACK]) {
      const { text } = RENDERERS[id].render(pack);
      for (const heading of LOCUM_HEADINGS) {
        assert.ok(!text.includes(heading), `${id} rendered ${heading} for a perm pack`);
      }
    }
  }
});

test("empty locum sections render no headings, but the title still reads the flag", () => {
  // The model judged the content perm-shaped despite the locum flag: role_shape drives the
  // title, content drives the sections.
  const bare = assertPack({
    ...LOCUM_PACK, compliance: [], booking: [], modality_matrix: [],
  });
  for (const id of Object.keys(RENDERERS)) {
    const { text } = RENDERERS[id].render(bare);
    assert.match(text, /^LOCUM BOOKING — /);
    for (const heading of LOCUM_HEADINGS) assert.ok(!text.includes(heading), id);
  }
});

test("a perm pack that carries locum sections still renders them — never drop content", () => {
  const disobedient = assertPack({ ...LOCUM_PACK, role_shape: "permanent" });
  for (const id of Object.keys(RENDERERS)) {
    const { text } = RENDERERS[id].render(disobedient);
    assert.match(text, /^SUBMISSION PACK — /);
    for (const heading of LOCUM_HEADINGS) assert.ok(text.includes(heading), id);
  }
});

test("the locum pack stays inside the page budget", () => {
  for (const id of Object.keys(RENDERERS)) {
    const lines = RENDERERS[id].render(LOCUM_PACK).text.split("\n").length;
    assert.ok(lines <= 110, `${id} rendered ${lines} lines, which is past two pages`);
  }
});

/* ── the interface itself (AC1) ────────────────────────────────────────────────────────── */

test("render() falls back to the default rather than throwing on an unknown id", () => {
  assert.equal(DEFAULT_RENDERER, "appendix", "the default a consultant gets without choosing");
  assert.equal(render(SOURCED, "docx").text, render(SOURCED, DEFAULT_RENDERER).text);
  assert.equal(render(SOURCED).text, render(SOURCED, "appendix").text);
});

test("every renderer returns both a text and an html body", () => {
  // §6.2's email-body branch needs both, and #8 copies one of them.
  for (const [id, renderer] of Object.entries(RENDERERS)) {
    const out = renderer.render(SOURCED);
    assert.equal(typeof out.text, "string", `${id}.text`);
    assert.equal(typeof out.html, "string", `${id}.html`);
    assert.ok(out.text.length > 200 && out.html.length > 200, `${id} produced a stub`);
    assert.equal(renderer.id, id, "the id in the record matches its key — store.js binds on it");
    assert.ok(renderer.label && renderer.description, `${id} needs UI copy for #8`);
  }
});
