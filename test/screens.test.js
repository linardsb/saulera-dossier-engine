// The id contract between each recruiter screen and the script that drives it (#61).
//
// This is a SOURCE SCAN, the same idiom as test/counts.test.js and test/chrome.test.js, and it
// exists because a dropped id is the one breakage on these screens that ships with no error
// anywhere. clients.js resolves every element once into an `el` map at load
// (public/clients.js:96-118); a missing id makes one entry `null` rather than throwing, so the
// page paints, the rail fills, and the failure surfaces much later as a TypeError inside a click
// handler — or never, on a control nobody pressed during testing.
//
// #61 restructures the markup those two files drive. This gate is what makes a restructure a
// mechanical change rather than a careful one.
//
// It reads the source text, not a render: there is no DOM in this suite and adding one to check
// a property of the files themselves would be the wrong trade. What it cannot see is an id
// created in JS rather than written in the page — see the note on the scan below.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

/** Every id `document.getElementById` asks for in a script. */
function requestedIds(source) {
  return [...source.matchAll(/document\.getElementById\(\s*"([^"]+)"/g)].map((m) => m[1]);
}

/** The ids a page actually declares. Matched WITH both quote characters, so `id="locum"` is not
 *  satisfied by `id="locum-list"` — a substring match here would pass the exact restructure this
 *  gate is meant to catch. */
function declares(markup, id) {
  return markup.includes(`id="${id}"`);
}

// Scoped to the recruiter screens on purpose. app.js queries ids that live on /prep pages and on
// 404.html, so widening this scan would fail for reasons that have nothing to do with the pages
// below. #69 registers a third — the bookings screen — and #71 a fourth, the compliance
// dashboard; both resolve their elements the same way and so are gated the same way. Their
// per-row controls are deliberately built with createElement and reached through closures rather
// than by id, which is why this scan sees only each page's own static markup and why that is the
// right amount for it to see. The dashboard declares only two ids for that reason: everything
// per-candidate is a node this file cannot and should not follow.
const SCREENS = [
  ["clients", "public/clients.js", "public/clients.html"],
  ["counts", "public/counts.js", "public/counts.html"],
  ["assignments", "public/assignments.js", "public/assignments.html"],
  ["compliance", "public/compliance.js", "public/compliance.html"],
];

for (const [screen, script, page] of SCREENS) {
  test(`every id ${screen}.js asks for exists in ${screen}.html`, () => {
    const ids = requestedIds(read(script));
    assert.ok(ids.length > 0, `${script} queries no ids at all, so this scan is reading it wrong`);

    const missing = ids.filter((id) => !declares(read(page), id));
    assert.deepEqual(
      missing,
      [],
      `${page} is missing ${missing.map((id) => `id="${id}"`).join(", ")} — ` +
        `${script} resolves each of these to null and fails silently, so put the id back on ` +
        `whichever element now does that job rather than removing the query`,
    );
  });
}
