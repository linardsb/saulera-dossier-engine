// The worked-example layer's contract — SHOWCASE BRANCH ONLY (demo/lewis-showcase).
//
// public/example.js is demo chrome: one button that fills the two input boxes with an invented
// brief and CV so the Louis walkthrough can go straight to Generate. This file pins the three
// properties that make that safe to layer over the live screen, in test/guide.test.js's exact
// spirit: the touchpoints exist together or the removal was half-finished, the script cannot
// reach the network or any store, and everything it touches is markup the screen really
// declares. A merge to main must not carry public/example.js, its two touchpoints in
// public/index.html, or this file.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const HTML = read("public/index.html");
const JS = read("public/example.js");

test("the example's touchpoints exist together, or the removal was half-finished", () => {
  for (const [what, marker] of [
    ["script tag", '<script src="/example.js"></script>'],
    ["button", 'id="load-example"'],
  ]) {
    const found = HTML.split(marker).length - 1;
    assert.equal(
      found,
      1,
      `public/index.html carries the worked example's ${what} ${found} times. If the layer ` +
        `is being removed, take the button block AND the script tag out, delete ` +
        `public/example.js, and delete this test file — a leftover tag is a 404 on every ` +
        `load of the one screen the demo opens on.`,
    );
  }
});

test("example.js reaches no network, no store, and no HTML sink", () => {
  // guide.test.js's list, held to for the same reason: this file rides on a screen that
  // handles candidate data, so the safest demo layer is one that provably cannot learn
  // anything or write anything durable. The fixtures are inline constants, which is also
  // what keeps app.js's own fetch discipline undisturbed.
  for (const forbidden of [
    "fetch(",
    "XMLHttpRequest",
    "localStorage",
    "sessionStorage",
    "indexedDB",
    "document.cookie",
    "innerHTML",
    "outerHTML",
    "insertAdjacentHTML",
  ]) {
    assert.ok(!JS.includes(forbidden), `example.js must not contain ${forbidden}`);
  }
});

test("everything example.js touches is markup the screen declares", () => {
  // screens.test.js's contract, applied by hand since index.html is outside its SCREENS
  // list: a dropped id resolves to null and the button dies silently.
  for (const id of [...JS.matchAll(/document\.getElementById\(\s*"([^"]+)"/g)].map((m) => m[1])) {
    assert.ok(HTML.includes(`id="${id}"`), `index.html no longer declares id="${id}"`);
  }
  // The rail row it clicks is built by app.js's renderList; the class and the data-id
  // wiring living there is what makes `.client-row[data-id=…]` a selector with a referent.
  const app = read("public/app.js");
  assert.ok(app.includes('"client-row"'), "app.js no longer builds .client-row rows");
  assert.ok(app.includes("row.dataset.id"), "app.js no longer stamps data-id on rail rows");
});

test("the fixtures fit the pipeline they are fed into", () => {
  const brief = JS.match(/var BRIEF = \[([\s\S]*?)\]\.join\("\\n"\)/);
  const cv = JS.match(/var CV = \[([\s\S]*?)\]\.join\("\\n"\)/);
  assert.ok(brief && cv, "example.js no longer holds BRIEF and CV as joined line arrays");

  // The bound is src/prompt.js's INPUT_MAX. Under it with room to spare, over the floor
  // that makes the pack's competency extraction worth watching: an example brief a pack
  // cannot chew on demos nothing.
  const briefLength = brief[1].length;
  const cvLength = cv[1].length;
  assert.ok(briefLength > 1200 && briefLength < 4000, `brief source is ${briefLength} chars`);
  assert.ok(cvLength > 1600 && cvLength < 5000, `cv source is ${cvLength} chars`);

  // The example belongs to the seeded Manchester client — scripts/seed-lewis-demo-notes.sql
  // wrote the note whose sections the pack's "Our note" marks point at.
  assert.ok(
    JS.includes('var CLIENT_ID = "client-manchester-msk"'),
    "the example no longer names the seeded Manchester client",
  );

  // The house rule the branch's copy sweep enforced: no em or en dashes in anything a
  // person READS. Scoped to the two fixtures, because that is what reaches the screen \u2014
  // the file's comments keep the repo's own comment style.
  assert.ok(
    !/[\u2013\u2014]/.test(brief[1] + cv[1]),
    "a fixture carries an em or en dash",
  );
});
