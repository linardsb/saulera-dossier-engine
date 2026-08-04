// The gate over the candidate portal's two CONTENT pages: the brief a candidate reads, and the
// drill they practise in (#63).
//
// The class of failure this file catches is a redesign that ships GREEN and inert. brief.js
// reaches three elements by id and can see none of them from its own file, and until this file
// existed brief.html had NO test coverage of any kind since #21 — a rewrite could rename #blocks,
// drop the <script> tag, or add maximum-scale=1 to the viewport, and the whole suite would still
// pass while a candidate got a heading and nothing else.
//
// Not a duplicate of prep-session-ui.test.js:799-808, which asserts session.html carries every
// entry of a hand-written SHELL_IDS list. This file parses the ids out of the SCRIPT instead, so
// the two are complementary rather than redundant: theirs catches the mirror rotting, this one
// catches the page rotting away from a script that has moved on.
//
// Three of these are the accessibility posture rather than mere structure:
//   · #answer must keep the textarea class. app.css sizes .textarea at --text-note (16px), and
//     iOS Safari zooms the entire viewport when a focused control computes below 16px. This is
//     invisible on every desktop browser and only ever found by a candidate on a phone — which
//     is exactly how it survived from #24 to #63.
//   · neither viewport may gain maximum-scale or user-scalable=no. That is the tempting fix for
//     the same zoom, and it fails WCAG 1.4.4 by disabling pinch zoom for everyone.
//   · the live regions are the only channel by which a screen-reader user learns their prep is
//     loading, or that feedback on an answer has arrived.
//
// Not to be confused with test/chrome.test.js, which gates where a VALUE may live (colour,
// motion, fonts). This file asserts the markup still honours the contracts two scripts depend on,
// and looks at a style only to insist there is no inline one.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const BRIEF_HTML = read("public/prep/brief.html");
const BRIEF_JS = read("public/prep/brief.js");
const SESSION_HTML = read("public/prep/session.html");
const SESSION_JS = read("public/prep/session.js");

const CONTENT_PAGES = {
  "public/prep/brief.html": BRIEF_HTML,
  "public/prep/session.html": SESSION_HTML,
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

test("every element brief.js reaches by id exists in brief.html", () => {
  // brief.js:43-45 calls document.getElementById("…") three times with LITERAL arguments — no `$`
  // helper, unlike login.js and session.js — so this is the pattern that follows it. The
  // non-empty assertion is what keeps this gate honest if those lookups are ever refactored
  // behind a helper: the loop below would otherwise run over an empty set and pass while
  // checking nothing.
  const reached = [...BRIEF_JS.matchAll(/getElementById\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]);
  assert.ok(
    reached.length >= 3,
    `parsed ${reached.length} id lookups out of brief.js, expected at least 3 — the lookups this ` +
      `regex follows have changed shape, and this gate is now asserting nothing`,
  );

  const declared = idsOf(BRIEF_HTML);
  for (const id of reached) {
    assert.ok(
      declared.has(id),
      `brief.js reaches #${id} and brief.html no longer declares it. The page throws on load or ` +
        `silently stops responding; class hooks may move in a redesign, ids may not.`,
    );
  }
});

test("every element session.js reaches by id exists in session.html", () => {
  // session.js:149 defines `const $ = (id) => doc.getElementById(id)` and all thirteen call sites
  // go through it. Matching /getElementById\("…"\)/ here instead would find the helper's single
  // call, whose argument is a VARIABLE, extract nothing, and loop over an empty set — green, and
  // checking nothing. prep-shell.test.js:57-69 documents the same trap on login.js.
  const reached = [...SESSION_JS.matchAll(/\$\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]);
  assert.ok(
    reached.length >= 13,
    `parsed ${reached.length} id lookups out of session.js, expected at least 13 — the helper ` +
      `this regex follows has changed shape, and this gate is now asserting nothing`,
  );

  const declared = idsOf(SESSION_HTML);
  for (const id of reached) {
    assert.ok(
      declared.has(id),
      `session.js reaches #${id} and session.html no longer declares it. The controller reads it ` +
        `on boot; class hooks may move in a redesign, ids may not.`,
    );
  }
});

test("the answer box keeps the class that stops iOS zooming the page", () => {
  const answer = tagWithId(SESSION_HTML, "textarea", "answer");
  assert.match(
    answer,
    /class="[^"]*\btextarea\b[^"]*"/,
    "#answer lost the textarea class. app.css sizes .textarea at --text-note (16px); without it " +
      "the box renders at the user agent's default size and iOS Safari zooms the whole viewport " +
      "the moment a candidate taps it, on the one surface they type into for ten minutes. This " +
      "is invisible on every desktop browser, which is how it survived from #24 to #63.",
  );
});

test("both state lines are still announced, and the transcript is still a live region", () => {
  assert.match(
    tagWithId(BRIEF_HTML, "p", "brief-state"),
    /role="status"/,
    "#brief-state is no longer announced; it is the only channel telling a screen-reader user " +
      "their prep is loading, is not ready yet, or failed to load",
  );
  assert.match(tagWithId(SESSION_HTML, "p", "session-state"), /role="status"/, "#session-state is no longer announced");

  // app.css:410-416 gives .save-state opacity 0 and only .is-shown reveals it. brief.js:48-52
  // writes both, so renaming this class makes every message on the page silently invisible while
  // the role="status" above still passes.
  for (const [page, html, id] of [
    ["brief.html", BRIEF_HTML, "brief-state"],
    ["session.html", SESSION_HTML, "session-state"],
  ]) {
    assert.match(
      tagWithId(html, "p", id),
      /class="[^"]*\bsave-state\b[^"]*"/,
      `${page}'s #${id} lost the save-state class, so .is-shown no longer reveals it and every ` +
        `message it carries renders at opacity 0`,
    );
  }

  assert.match(
    tagWithId(SESSION_HTML, "div", "drill-log"),
    /aria-live="polite"/,
    "#drill-log lost aria-live, so feedback on an answer arrives silently mid-wait",
  );
});

test("all three acts start hidden and keep the heading a screen reader navigates by", () => {
  for (const id of ["act-prime", "act-drill", "act-close"]) {
    const act = tagWithId(SESSION_HTML, "section", id);
    // Each act is revealed by session.js setting .hidden = false. Ship one without the attribute
    // and every candidate sees all three acts at once on first paint.
    assert.match(act, /\shidden[\s>]/, `#${id} no longer starts hidden`);
    assert.match(
      act,
      new RegExp(`aria-labelledby="${id.replace(/^act-/, "")}-head"`),
      `#${id} lost its accessible name, so it stops being a region in the landmark list`,
    );
  }
});

test("both pages still load the script that renders everything on them", () => {
  // Every assertion above can survive a rewrite that drops the script itself: the ids are all
  // still declared, the live regions are all still there, and both pages go completely inert —
  // a heading, a placeholder title, and nothing else, forever.
  assert.match(
    BRIEF_HTML,
    /<script type="module" src="\/prep\/brief\.js"><\/script>/,
    "brief.html no longer loads brief.js; the page renders a placeholder title and no blocks",
  );
  assert.match(SESSION_HTML, /import \{ initSession \}/, "session.html no longer imports the controller");
  assert.match(SESSION_HTML, /initSession\(\)/, "session.html imports the controller and never calls it");
});

test("both content pages stay out of the index and keep pinch zoom", () => {
  for (const [page, html] of Object.entries(CONTENT_PAGES)) {
    assert.match(
      html,
      /<meta name="robots" content="noindex, nofollow">/,
      `${page} lost its robots meta; the candidate portal is not for the open web`,
    );

    const viewport = html.match(/<meta name="viewport" content="([^"]+)">/);
    assert.ok(viewport, `${page} has no viewport meta and will render at desktop width on a phone`);
    assert.match(viewport[1], /width=device-width/, `${page}'s viewport is not device-width`);
    // The tempting fix for the iOS focus-zoom #63 solved with a 16px control instead.
    assert.doesNotMatch(
      viewport[1],
      /maximum-scale|user-scalable/,
      `${page} disables pinch zoom, which fails WCAG 1.4.4. The iOS zoom on a focused field is ` +
        `fixed by raising the control to 16px (the textarea class on #answer), never here.`,
    );
  }
});

test("both content pages are served by the one stylesheet chain, in order", () => {
  // Order is the assertion, not just membership: session.css deliberately overrides prep.css's
  // .block background for feedback entries, and that override is decided by link order. Swap the
  // last two and the transcript silently loses its tone step.
  const chain = ["/fonts.css", "/tokens.css", "/app.css", "/prep/prep.css"];
  assert.deepEqual(stylesheetsOf(BRIEF_HTML), chain, "brief.html's stylesheet chain or its order");
  assert.deepEqual(
    stylesheetsOf(SESSION_HTML),
    [...chain, "/prep/session.css"],
    "session.html's stylesheet chain or its order — it links the portal's four plus its own, last",
  );
});

test("neither content page carries a page-scoped style block", () => {
  // chrome.test.js:65-100 sweeps four named pages' inline <style> blocks for raw colour and for
  // motion outside the reduced-motion guard, and neither of these pages is on that list. A style
  // block here would therefore be a hole in BOTH gates at once: raw hex and unguarded animation,
  // on the two pages a candidate spends the most time on. Everything belongs in prep.css or
  // session.css, where gates exist.
  for (const [page, html] of Object.entries(CONTENT_PAGES)) {
    assert.doesNotMatch(
      html,
      /<style/,
      `${page} grew an inline style block, which chrome.test.js does not sweep — put the rules in ` +
        `prep.css or session.css, where the colour and motion gates can see them`,
    );
  }
});
