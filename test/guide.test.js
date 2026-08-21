// The walkthrough layer — a TEMPORARY annotation over the five recruiter screens, and this file
// is its removal contract.
//
// A pill sits beside each step of each screen; pressing one opens a card explaining it. It is
// here while the pilot agency learns the tool and is meant to come down afterwards. The failure
// this file catches is the one a temporary thing actually dies of: a HALF removal. Someone
// deletes public/guide.js, the five <script> tags stay, and every recruiter screen now requests
// a 404 on every load — which nothing else in this suite would notice, because no test sweeps
// public/ for pages generically.
//
// So the touchpoints are asserted TOGETHER. Delete the files and this goes red until the tags go
// too; delete all of them and delete this file, and the suite is green with nothing left behind.
//
// It also pins the three properties that make it safe to layer over live product screens at all:
// the CSS cannot reach the real interface, the JS cannot reach the network or any store, and its
// anchors are selectors those screens actually declare.
//
// SHOWCASE BRANCH ONLY: on demo/louis-showcase the layer also annotates the CANDIDATE portal —
// every page under /prep a person can reach on the demo — because the person browsing it is the
// recruiter learning the product. On those screens the card's eyebrow says whose side the page
// is on ("The candidate's side · step N of M"); the pills wear the one colour both sides share,
// by the owner's decision, and the guide-pill--candidate / guide-card--candidate classes are
// hooks with no rules behind them. On main that is the wrong audience by guide.js's own header,
// so a merge must not carry the prep entries in guide.js's SCREENS, the candidate-side wiring,
// the tags on the prep pages, or their rows in this file's lists.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

/** Every screen the layer is loaded onto. */
const SCREENS = [
  "public/index.html",
  "public/clients.html",
  "public/counts.html",
  "public/assignments.html",
  "public/compliance.html",
  // Demo branch only — candidate pages annotated for the recruiter browsing the showcase.
  "public/prep/stories.html",
  "public/prep/debrief.html",
  "public/prep/brief.html",
  "public/prep/session.html",
  "public/prep/privacy.html",
  "public/prep/compliance/index.html",
  "public/prep/compliance/login.html",
];

/** Demo branch only — screens with no script of their own. privacy.html is static prose on
 *  purpose, so "the walkthrough loads after the screen's own script" has no subject there; the
 *  ordering that still matters is that guide.js sits after the content its anchors point at. */
const STATIC_SCREENS = new Set(["public/prep/privacy.html"]);

const CSS = read("public/guide.css");
const JS = read("public/guide.js");

test("the layer's touchpoints exist together, or the removal was half-finished", () => {
  for (const screen of SCREENS) {
    const html = read(screen);
    for (const [what, tag] of [
      ["stylesheet", '<link rel="stylesheet" href="/guide.css">'],
      ["script", '<script src="/guide.js"></script>'],
    ]) {
      const found = html.split(tag).length - 1;
      assert.equal(
        found,
        1,
        `${screen} carries the walkthrough ${what} ${found} times. If the layer is being ` +
          `removed, take BOTH tags off every page in this list, delete public/guide.css and ` +
          `public/guide.js, and delete this test file — a leftover tag is a 404 on every load ` +
          `of a working screen.`,
      );
    }
  }

  // The separate /guide page this replaced is gone, and no nav still points at it.
  for (const screen of SCREENS) {
    assert.doesNotMatch(read(screen), /href="\/guide"/, `${screen} still links the removed /guide page`);
  }
});

test("the walkthrough loads AFTER the screen it annotates", () => {
  // Both orderings are load-bearing. guide.css must come after app.css or the product's rules
  // would win over the layer's; guide.js must come after the screen's own script or the anchors
  // it looks for may not be in the document yet.
  for (const screen of SCREENS) {
    const html = read(screen);
    assert.ok(
      html.indexOf('href="/guide.css"') > html.indexOf('href="/app.css"'),
      `${screen}: guide.css must be last in the stylesheet chain`,
    );
    // privacy.html has no script at all — every anchor there is static markup, so the order
    // that matters is guide.js after the content itself.
    if (STATIC_SCREENS.has(screen)) {
      assert.ok(
        html.indexOf('src="/guide.js"') > html.indexOf("</main>"),
        `${screen}: guide.js must come after the static content its anchors point at`,
      );
      continue;
    }
    // The prep pages boot with an inline module script or a module src tag rather than a
    // classic src tag; any of the three counts as "the screen's own script" here.
    const ownScript = html.search(
      /<script (?:type="module" )?src="\/(?!guide)[a-z/]+\.js"><\/script>|<script type="module">/,
    );
    assert.ok(ownScript > -1, `${screen} has no screen script of its own`);
    assert.ok(
      html.indexOf('src="/guide.js"') > ownScript,
      `${screen}: guide.js must load after the screen's own script`,
    );
  }
});

test("both files say on their own face that they are temporary", () => {
  // A temporary thing that does not say so becomes permanent. Each file opens with the removal
  // list, and every card the layer draws carries the same standing line.
  assert.match(CSS, /SCHEDULED FOR DELETION/, "guide.css names itself as temporary");
  assert.match(JS, /SCHEDULED FOR DELETION/, "guide.js names itself as temporary");
  assert.match(JS, /temporary, and not part of the tool/, "and every card repeats it to the reader");
});

test("guide.css cannot reach the product screens it layers over", () => {
  // THE ONE WAY THIS COULD BREAK A WORKING SCREEN. It loads after app.css on five live pages, so
  // an unscoped `button`, `p` or `h2` rule here would restyle the real interface — the topbar,
  // the forms, the tables. Scoping is asserted rather than trusted.
  const selectors = CSS
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("}")
    .map((block) => block.slice(0, block.indexOf("{")).trim())
    .filter((selector) => selector && !selector.startsWith("@") && !selector.startsWith("--"));

  assert.ok(selectors.length > 0, "no selectors parsed out of guide.css — this scan is reading it wrong");
  for (const selector of selectors) {
    for (const part of selector.split(",").map((s) => s.trim()).filter(Boolean)) {
      assert.ok(
        part.startsWith(".guide"),
        `guide.css declares \`${part}\`, which is unscoped and would restyle the real interface`,
      );
    }
  }
});

test("guide.js reaches no network, no store, and no HTML sink", () => {
  // It annotates five screens that handle candidate names, CVs and compliance records. The layer
  // is prose and must stay prose: it reads location.pathname and nothing else.
  //
  // COMMENTS ARE STRIPPED FIRST, and that is not a loophole — it is the same rule
  // test/counts.test.js states for its own scan, one layer down. This file's comments ARGUE
  // about `fetch(` and `innerHTML`: they name what the code deliberately does not do, and the
  // arguments are the most useful thing in it. A scan that failed on the sentence explaining why
  // a sink is absent is a scan that gets deleted, and deleting it would cost the real check.
  const code = JS.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  for (const forbidden of ["fetch(", "XMLHttpRequest", "localStorage", "sessionStorage", "indexedDB", "document.cookie"]) {
    assert.ok(!code.includes(forbidden), `guide.js reaches ${forbidden}`);
  }
  for (const sink of ["innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval("]) {
    assert.ok(!code.includes(sink), `guide.js uses ${sink} — the layer builds nodes, it does not parse markup`);
  }

  // Two guards against the strip above hiding a real hit: the code half must still be most of
  // the file, and the parser that stands in for a sink must still be there.
  assert.ok(code.length > 2000, "the comment strip ate the code — this scan would pass vacuously");
  assert.match(code, /createTextNode/, "the <ui> marks are turned into text nodes, not markup");
});

test("every anchor the layer points at actually exists on that screen", () => {
  // A pill whose anchor has been renamed silently disappears — guide.js skips a missing target
  // on purpose, so a working screen never fails to paint because of a temporary file. That is
  // the right runtime behaviour and exactly why it needs a test: the failure is invisible.
  const pages = {
    "/": "public/index.html",
    "/clients": "public/clients.html",
    "/counts": "public/counts.html",
    "/assignments": "public/assignments.html",
    "/compliance": "public/compliance.html",
    // Demo branch only — see the header.
    "/prep/stories": "public/prep/stories.html",
    "/prep/debrief": "public/prep/debrief.html",
    "/prep/brief": "public/prep/brief.html",
    "/prep/session": "public/prep/session.html",
    "/prep/privacy": "public/prep/privacy.html",
    "/prep/compliance": "public/prep/compliance/index.html",
    "/prep/compliance/login": "public/prep/compliance/login.html",
  };

  const anchors = [...JS.matchAll(/anchor:\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(anchors.length >= 10, `only ${anchors.length} anchors parsed — this scan is reading guide.js wrong`);

  // Each SCREENS entry is a `"path": [` block; slice the file per screen so an anchor is checked
  // against the page it is actually declared for.
  for (const [path, page] of Object.entries(pages)) {
    const start = JS.indexOf(`"${path}": [`);
    assert.ok(start > -1, `guide.js declares no steps for ${path}`);
    const rest = JS.slice(start + path.length + 5);
    const end = rest.search(/\n {4}"\/|\n {2}};/);
    const block = rest.slice(0, end === -1 ? undefined : end);

    const html = read(page);
    const declared = [...block.matchAll(/anchor:\s*"([^"]+)"/g)].map((m) => m[1]);
    assert.ok(declared.length > 0, `no anchors found in ${path}'s block`);

    for (const anchor of declared) {
      const present = anchor.startsWith("#")
        ? html.includes(`id="${anchor.slice(1)}"`)
        : html.includes(`class="${anchor.slice(1)}"`) || html.includes(`${anchor.slice(1)} `);
      assert.ok(present, `${page} declares no ${anchor}, so that pill would silently never appear`);
    }
  }
});

test("the layer adds no upload control and names no real person", () => {
  // Metadata-only is the epic's first decision, and a walkthrough is a plausible place for a
  // helpful "attach an example" to appear. It is also prose on screens that show candidate
  // names, so its examples stay shaped like labels rather than like records.
  assert.doesNotMatch(JS, /type="file"|FormData|multipart|enctype/i, "an upload control appeared");
  assert.doesNotMatch(JS, /@[a-z0-9.-]+\.(com|co\.uk|example|org|net)\b/i, "an email address in the copy");
});
