// The gate over the compliance passport's two pages: the sign-in and the checklist itself (#68).
//
// The class of failure this file catches is a page that ships GREEN and inert. passport.js
// reaches four elements by id and can see none of them from its own file; login.js reaches
// twelve. Nothing else in the suite looks at either page, so a rename of #items, a dropped
// <script> tag, or a maximum-scale on the viewport would leave the whole suite passing while a
// locum got a heading and nothing else. test/prep-content.test.js and test/prep-shell.test.js
// are the same gate over the portal's other five pages, and this is their third sibling.
//
// Three of these are the accessibility and security posture rather than mere structure:
//   · every field carries the `.input` class AND prep.css raises those fields to 16px. iOS
//     Safari zooms the entire viewport when a focused control computes below 16px, and app.css
//     sizes `.input` at --text-body (14px) — so the class alone does NOT buy the fix, which is
//     why this file asserts the stylesheet rule as well as the markup. That bug survived from
//     #24 to #63 because it is invisible on every desktop browser.
//   · neither viewport may gain maximum-scale or user-scalable=no. That is the tempting fix for
//     the same zoom, and it fails WCAG 1.4.4 by disabling pinch zoom for everyone.
//   · the checklist carries no upload control of any kind. Metadata-only is spike #66's first
//     decision, and a file input added "just for the DBS certificate" is the moment this product
//     takes custody of health documents.
//
// Not to be confused with test/chrome.test.js, which gates where a VALUE may live (colour,
// motion, fonts). This file asserts the markup still honours the contracts two scripts depend
// on, and looks at a style only to insist the passport carries none.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const LOGIN_HTML = read("public/prep/compliance/login.html");
const LOGIN_JS = read("public/prep/compliance/login.js");
const PASSPORT_HTML = read("public/prep/compliance/index.html");
const PASSPORT_JS = read("public/prep/compliance/passport.js");
const PREP_CSS = read("public/prep/prep.css");
const CHROME_TEST = read("test/chrome.test.js");

const PAGES = {
  "public/prep/compliance/login.html": LOGIN_HTML,
  "public/prep/compliance/index.html": PASSPORT_HTML,
};

/** The one opening tag carrying `id="<id>"`. Attributes may wrap across lines; none holds a `>`. */
const tagWithId = (html, tag, id) => {
  const found = html.match(new RegExp(`<${tag}\\b[^>]*\\bid="${id}"[^>]*>`, "s"));
  assert.ok(found, `no <${tag} id="${id}"> in the markup`);
  return found[0];
};

/** Every stylesheet the page links, in link order — which is what decides the cascade here. */
const stylesheetsOf = (html) =>
  [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)].map((m) => m[1]);

/** Every id the page declares. */
const idsOf = (html) => new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));

/** Every literal id both scripts look up through their `$` helper. */
const lookupsIn = (source) => [...source.matchAll(/\$\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]);

test("every element login.js reaches by id exists in login.html", () => {
  // The lookups do NOT go through getElementById directly — login.js defines
  // `var $ = function (id) { return document.getElementById(id); }` and every call site goes
  // through it. Matching /getElementById\("…"\)/ here would find the helper's single call, whose
  // argument is a VARIABLE, extract nothing, and loop over an empty set: green, and checking
  // nothing. test/prep-shell.test.js records the same trap.
  const reached = lookupsIn(LOGIN_JS);
  assert.ok(
    reached.length >= 12,
    `parsed ${reached.length} id lookups out of login.js, expected at least 12 — the helper this ` +
      `regex follows has changed shape, and this gate is now asserting nothing`,
  );

  const declared = idsOf(LOGIN_HTML);
  for (const id of reached) {
    assert.ok(
      declared.has(id),
      `login.js reaches #${id} and login.html no longer declares it. The page throws on load or ` +
        `silently stops responding; class hooks may move in a redesign, ids may not.`,
    );
  }
});

test("every element passport.js reaches by id exists in index.html", () => {
  const reached = lookupsIn(PASSPORT_JS);
  assert.ok(
    reached.length >= 4,
    `parsed ${reached.length} id lookups out of passport.js, expected at least 4 — the helper ` +
      `this regex follows has changed shape, and this gate is now asserting nothing`,
  );

  const declared = idsOf(PASSPORT_HTML);
  for (const id of reached) {
    assert.ok(declared.has(id), `passport.js reaches #${id} and index.html no longer declares it`);
  }
});

test("both pages load the script that renders everything on them", () => {
  // Every assertion in this file can survive a rewrite that drops the script itself: the ids are
  // all still declared, the live regions are all still there, and both pages go completely
  // inert — a heading and nothing else, forever.
  assert.match(
    LOGIN_HTML,
    /<script src="\/prep\/compliance\/login\.js"><\/script>/,
    "login.html no longer loads login.js; the two acts never wire up and the form does nothing",
  );
  assert.match(
    PASSPORT_HTML,
    /<script type="module" src="\/prep\/compliance\/passport\.js"><\/script>/,
    "index.html no longer loads passport.js; the checklist renders a heading and no items",
  );
});

test("the count and both state lines are still announced", () => {
  // The only channel by which a screen-reader user learns their checklist loaded, or that a
  // submission landed.
  assert.match(tagWithId(PASSPORT_HTML, "p", "count"), /role="status"/, "#count is no longer announced");
  assert.match(tagWithId(PASSPORT_HTML, "p", "state"), /role="status"/, "#state is no longer announced");
  assert.match(tagWithId(LOGIN_HTML, "p", "email-state"), /role="status"/);
  assert.match(tagWithId(LOGIN_HTML, "p", "code-state"), /role="status"/);

  // app.css gives .save-state opacity 0 and only .is-shown reveals it; passport.js writes both.
  // Renaming this class makes every message on the page silently invisible while the role="status"
  // above still passes.
  assert.match(
    tagWithId(PASSPORT_HTML, "p", "state"),
    /class="[^"]*\bsave-state\b[^"]*"/,
    "#state lost the save-state class, so .is-shown no longer reveals it",
  );

  // passport.js also builds a per-form state line with role="status" for each item, which is how
  // "Saved. Thank you." reaches anyone not watching the page.
  assert.match(PASSPORT_JS, /setAttribute\("role", "status"\)/, "the per-item state line is no longer a live region");
});

test("act 2 starts hidden and both acts keep the heading a screen reader navigates by", () => {
  const act = tagWithId(LOGIN_HTML, "section", "act-code");
  // Revealed by login.js setting .hidden = false. Ship it without the attribute and every
  // candidate sees both acts at once on first paint.
  assert.match(act, /\shidden[\s>]/, "#act-code no longer starts hidden");
  for (const id of ["act-email", "act-code"]) {
    assert.match(
      tagWithId(LOGIN_HTML, "section", id),
      new RegExp(`aria-labelledby="${id}-head"`),
      `#${id} lost its accessible name, so it stops being a region in the landmark list`,
    );
  }
});

test("both pages stay out of the index and keep pinch zoom", () => {
  for (const [page, html] of Object.entries(PAGES)) {
    assert.match(
      html,
      /<meta name="robots" content="noindex, nofollow">/,
      `${page} lost its robots meta; the candidate portal is not for the open web`,
    );

    const viewport = html.match(/<meta name="viewport" content="([^"]+)">/);
    assert.ok(viewport, `${page} has no viewport meta and will render at desktop width on a phone`);
    assert.match(viewport[1], /width=device-width/, `${page}'s viewport is not device-width`);
    assert.doesNotMatch(
      viewport[1],
      /maximum-scale|user-scalable/,
      `${page} disables pinch zoom, which fails WCAG 1.4.4. The iOS zoom on a focused field is ` +
        `fixed by raising the control to 16px in prep.css, never here.`,
    );
  }
});

test("both pages are served by the one stylesheet chain, in order", () => {
  // Order is the assertion, not just membership: prep.css supplements app.css and its compliance
  // section relies on winning the cascade against it. Swap two links and the chips lose their
  // ground while every other test stays green.
  const chain = ["/fonts.css", "/tokens.css", "/app.css", "/prep/prep.css"];
  for (const [page, html] of Object.entries(PAGES)) {
    assert.deepEqual(stylesheetsOf(html), chain, `${page}'s stylesheet chain or its order`);
  }
});

test("the passport carries no page-scoped style block, and the sign-in carries exactly one", () => {
  // chrome.test.js sweeps only the pages named in its hardcoded INLINE_STYLE_PAGES list, so a
  // style block on an unlisted page is a hole in BOTH gates at once: raw hex and unguarded
  // animation.
  assert.doesNotMatch(
    PASSPORT_HTML,
    /<style/,
    "index.html grew an inline style block, which chrome.test.js does not sweep — put the rules " +
      "in prep.css, where the colour and motion gates can see them",
  );

  const blocks = [...LOGIN_HTML.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
  assert.equal(blocks.length, 1, "login.html carries exactly one page-scoped block");
  const rules = [...blocks[0].replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim());
  assert.deepEqual(
    rules,
    [".sr-only"],
    "the sign-in page's block holds `.sr-only` and nothing else. That rule cannot live in " +
      "prep.css — its 1px insets are a clipping trick and that file's token gate rejects a raw " +
      "length — but every other rule can, and must.",
  );
});

test("chrome.test.js's hardcoded INLINE_STYLE_PAGES names the sign-in page", () => {
  // The one place in this ticket where forgetting a line makes a gate LIE rather than fail: the
  // list is hardcoded, so an unlisted page with a style block is swept by nothing and reports
  // green. This assertion is what keeps the list and the pages in step.
  assert.match(
    CHROME_TEST,
    /"public\/prep\/compliance\/login\.html"/,
    "public/prep/compliance/login.html carries a <style> block and is missing from " +
      "test/chrome.test.js's INLINE_STYLE_PAGES, so its raw colour and motion are ungated",
  );
});

test("every field carries .input, and prep.css raises those fields above the iOS zoom floor", () => {
  for (const [page, html] of Object.entries(PAGES)) {
    const inputs = [...html.matchAll(/<input\b[^>]*>/g)].map((m) => m[0]);
    for (const input of inputs) {
      assert.match(input, /class="[^"]*\binput\b[^"]*"/, `${page} has an <input> without the input class`);
    }
  }
  // passport.js builds its fields at runtime, so the markup sweep above cannot see them.
  assert.match(PASSPORT_JS, /el\("input", "input"\)/, "passport.js builds a field without the input class");

  // And the class is only half of it: app.css sizes .input at --text-body (14px), which is BELOW
  // the 16px floor iOS Safari zooms under. The fix is this rule, and without it every assertion
  // above passes while a locum's first tap jumps the page under their thumb.
  const css = PREP_CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(
    css,
    /\.passport \.input,\s*\.passport-signin \.input\s*\{\s*font-size:\s*var\(--text-note\)/,
    "prep.css no longer raises the compliance pages' fields to --text-note (16px), so iOS Safari " +
      "zooms the whole viewport the moment one is focused",
  );
});

test("nothing on either page writes to browser storage", () => {
  // CHECKLIST's data-posture MUST, and public/app.js:15-22's first decision: transient has to
  // include the browser or the sentence is not true. Compliance state is health-adjacent.
  for (const [name, source] of [["login.js", LOGIN_JS], ["passport.js", PASSPORT_JS]]) {
    assert.doesNotMatch(
      source,
      /localStorage|sessionStorage|indexedDB|document\.cookie/,
      `${name} touches browser storage`,
    );
  }
});

test("neither script parses HTML", () => {
  // A reference number is text a stranger typed into a phone, and it comes back out of our own
  // API — the value most likely to be trusted by accident.
  for (const [name, source] of [["login.js", LOGIN_JS], ["passport.js", PASSPORT_JS]]) {
    assert.doesNotMatch(
      source,
      /innerHTML|outerHTML|insertAdjacentHTML|document\.write|createContextualFragment/,
      `${name} builds markup from a string; createElement and text nodes only`,
    );
  }
});

test("the passport accepts no document, structurally", () => {
  // Spike #66's first decision, held at the surface a candidate actually touches. A file input
  // added "just for the DBS certificate" is the moment this product takes custody of health
  // documents, and that is a DPIA and a paid milestone, not a drive-by control.
  for (const [name, source] of Object.entries({ ...PAGES, "passport.js": PASSPORT_JS, "login.js": LOGIN_JS })) {
    assert.doesNotMatch(
      source,
      /type="file"|type: "file"|FormData|multipart/,
      `${name} accepts a document. The compliance epic is metadata-only — a typed reference and ` +
        `a date. Bytes need their own spike, their own retention and a commercial agreement.`,
    );
  }
});

test("the delete control is a button, never a link, and confirms before it fires", () => {
  const button = tagWithId(PASSPORT_HTML, "button", "delete");
  assert.match(button, /type="button"/, "#delete must not be a submit button inside some future form");
  // A delete reachable by URL-click gets prefetched by mail scanners and by browsers, which is
  // why the route behind it is POST-only.
  assert.doesNotMatch(
    PASSPORT_HTML,
    /<a[^>]*href="[^"]*delete/,
    "the delete control became a link; the route is POST-only for a reason",
  );
  assert.doesNotMatch(PASSPORT_HTML, /<form/, "a form on this page would submit by GET on Enter");
  assert.match(PASSPORT_JS, /window\.confirm\(/, "delete-now fires without asking");
  // The body matters: a bodyless POST makes readJson throw bad_json 400 before the route's empty
  // field vocabulary is consulted, so the button would fail on the happy path with a 400 that
  // reads like a server fault.
  assert.match(PASSPORT_JS, /body: JSON\.stringify\(\{\}\)/, "the delete POST must carry an empty JSON object");
});

test("the sign-in page never reflects its query string into the DOM", () => {
  // The ?e= value is a KEY into the COPY table, never a string that is rendered. This is the one
  // page on the deployment a stranger can be sent a crafted URL for.
  assert.match(LOGIN_JS, /COPY\[reason\]/, "the notice is filled from the COPY table by key");
  assert.doesNotMatch(
    LOGIN_JS,
    /textContent\s*=\s*reason\b/,
    "the ?e= value is being written to the page; it is a key, not a message",
  );
});

test("the scans are reading something, not an empty string", () => {
  // A guard on the guard: a path typo would make every assertion above pass vacuously.
  assert.match(LOGIN_JS, /form-email/);
  assert.match(PASSPORT_JS, /prep\/compliance\/api\/items/);
  assert.match(PASSPORT_HTML, /class="passport"/);
  assert.match(PREP_CSS, /\.mark-submitted/);
});
