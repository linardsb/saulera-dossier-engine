// The gate over the candidate portal's four CONTENT pages: the brief a candidate reads, the
// drill they practise in (#63), the debrief they write after the interview (#77), and the
// storybank they fill in before it (#78).
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
const DEBRIEF_HTML = read("public/prep/debrief.html");
const DEBRIEF_JS = read("public/prep/debrief.js");
const STORIES_HTML = read("public/prep/stories.html");
const STORIES_JS = read("public/prep/stories.js");

const CONTENT_PAGES = {
  "public/prep/brief.html": BRIEF_HTML,
  "public/prep/session.html": SESSION_HTML,
  "public/prep/debrief.html": DEBRIEF_HTML,
  // #78. Adding the page here alone brings the robots-meta, viewport, pinch-zoom and
  // no-inline-<style> gates; the chain assertion is named separately below, for the reason
  // that test's own comment gives.
  "public/prep/stories.html": STORIES_HTML,
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

test("every element debrief.js reaches by id exists in debrief.html", () => {
  // debrief.js defines `const $ = (id) => doc.getElementById(id)` and every call site goes
  // through it, the way session.js does — NOT literal getElementById calls like brief.js. So this
  // follows the `$("…")` shape rather than the getElementById one; matching the latter here would
  // find the helper's single call, whose argument is a VARIABLE, extract nothing, and loop over
  // an empty set. The non-empty assertion is what turns that into a failure instead of silence.
  const reached = [...DEBRIEF_JS.matchAll(/\$\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]);
  // An is-the-scan-alive check, nothing more: it exists so the loop below can never pass over an
  // empty set. Deliberately about half the real call-site count (#88) — a floor at the exact
  // count made removing any one `$()` call fail a gate that was never about `$()` counts.
  assert.ok(
    reached.length >= 9,
    `parsed ${reached.length} id lookups out of debrief.js, expected at least 9 — the helper ` +
      `this regex follows has changed shape, and this gate is now asserting nothing`,
  );

  const declared = idsOf(DEBRIEF_HTML);
  for (const id of reached) {
    assert.ok(
      declared.has(id),
      `debrief.js reaches #${id} and debrief.html no longer declares it. The controller reads it ` +
        `on boot; class hooks may move in a redesign, ids may not.`,
    );
  }
});

test("every element stories.js reaches by id exists in stories.html", () => {
  // #78. Same `$("…")` helper shape as session.js and debrief.js, so the same regex follows it —
  // matching getElementById here would find the helper's single call, whose argument is a
  // VARIABLE, extract nothing, and loop over an empty set.
  //
  // The floor is an is-the-scan-alive check, nothing more: it exists so the loop below can never
  // pass over an empty set. Deliberately about half the real call-site count (#88) — the floor
  // used to sit at the exact count, so removing any one `$()` call failed a gate that was never
  // about `$()` counts.
  const reached = [...STORIES_JS.matchAll(/\$\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]);
  assert.ok(
    reached.length >= 10,
    `parsed ${reached.length} id lookups out of stories.js, expected at least 10 — the helper ` +
      `this regex follows has changed shape, and this gate is now asserting nothing`,
  );

  const declared = idsOf(STORIES_HTML);
  for (const id of reached) {
    assert.ok(
      declared.has(id),
      `stories.js reaches #${id} and stories.html no longer declares it. The controller reads it ` +
        `on boot; class hooks may move in a redesign, ids may not.`,
    );
  }
});

test("both of the storybank's boxes keep the class that stops iOS zooming the page", () => {
  // The same rule the debrief's two boxes carry, on the page a candidate types the MOST into: a
  // sketch is paragraphs, and the title sits directly above it so both are tapped in one breath.
  // prep.css raises `.stories .input` and `.stories .textarea` to --text-note (16px); without the
  // class neither resolves and iOS Safari zooms the whole viewport.
  assert.match(
    tagWithId(STORIES_HTML, "input", "title"),
    /class="[^"]*\binput\b[^"]*"/,
    "stories.html's #title lost the input class, so the 16px floor no longer applies to it",
  );
  assert.match(
    tagWithId(STORIES_HTML, "textarea", "sketch"),
    /class="[^"]*\btextarea\b[^"]*"/,
    "stories.html's #sketch lost the textarea class",
  );
});

test("the storybank's state line is still announced, and all three sections start hidden", () => {
  assert.match(
    tagWithId(STORIES_HTML, "p", "stories-state"),
    /role="status"/,
    "#stories-state is no longer announced; it is the only channel telling a screen-reader user " +
      "their story saved, failed to save, or was deleted",
  );
  assert.match(
    tagWithId(STORIES_HTML, "p", "stories-state"),
    /class="[^"]*\bsave-state\b[^"]*"/,
    "#stories-state lost the save-state class, so .is-shown no longer reveals it and every " +
      "message it carries renders at opacity 0",
  );
  // Ship any of the three without the attribute and the page opens showing an empty editor over a
  // "not ready yet" notice over a list that has not loaded.
  for (const id of ["unavailable", "storybank", "editor"]) {
    assert.match(tagWithId(STORIES_HTML, "section", id), /\shidden[\s>]/, `#${id} no longer starts hidden`);
  }
  // The gap line is the one element hidden as an ATTRIBUTE on a <p>: it is absent rather than
  // blank when every part of the job is covered, so the space above the list closes up.
  assert.match(tagWithId(STORIES_HTML, "p", "story-gap"), /\shidden[\s>]/, "#story-gap no longer starts hidden");
});

test("the storybank links are offered unconditionally, from both pages", () => {
  // #78's deliberate difference from #77, gated so nobody "fixes" it by analogy with the hidden
  // debrief CTA one line above each of them. A storybank is written BEFORE the interview, so
  // gating it on `debrief_available` would hide the feature from every candidate who still has
  // one to prepare for — which is all of them, at the only time it helps.
  for (const [file, html, id] of [
    ["brief.html", BRIEF_HTML, "stories-cta"],
    ["session.html", SESSION_HTML, "session-stories-cta"],
  ]) {
    const cta = tagWithId(html, "p", id);
    assert.doesNotMatch(
      cta,
      /\shidden[\s>]/,
      `${file}'s #${id} starts hidden. Nothing unhides it — no route flag carries a storybank ` +
        `state — so the page would offer no way to reach /prep/stories at all.`,
    );
    assert.match(html, new RegExp(`id="${id}"[^>]*>\\s*<a[^>]*href="/prep/stories"`), `${file} links /prep/stories`);
  }
});

test("both of the debrief's boxes keep the class that stops iOS zooming the page", () => {
  // The same rule #answer carries below, on the page most likely to be filled in on a phone: this
  // one is typed into standing outside a building, minutes after the interview.
  for (const id of ["asked", "fix"]) {
    assert.match(
      tagWithId(DEBRIEF_HTML, "textarea", id),
      /class="[^"]*\btextarea\b[^"]*"/,
      `debrief.html's #${id} lost the textarea class. app.css sizes .textarea at --text-note ` +
        `(16px); without it iOS Safari zooms the whole viewport the moment it is tapped.`,
    );
  }
});

test("the debrief's state line is still announced, and both sections start hidden", () => {
  assert.match(
    tagWithId(DEBRIEF_HTML, "p", "debrief-state"),
    /role="status"/,
    "#debrief-state is no longer announced; it is the only channel telling a screen-reader user " +
      "their debrief saved, or failed to",
  );
  assert.match(
    tagWithId(DEBRIEF_HTML, "p", "debrief-state"),
    /class="[^"]*\bsave-state\b[^"]*"/,
    "#debrief-state lost the save-state class, so .is-shown no longer reveals it and every " +
      "message it carries renders at opacity 0",
  );
  // Ship either without the attribute and a candidate sees "this opens after your interview"
  // sitting above the very form it says is not open yet.
  for (const id of ["unavailable", "debrief-form"]) {
    assert.match(tagWithId(DEBRIEF_HTML, "section", id), /\shidden[\s>]/, `#${id} no longer starts hidden`);
  }
});

test("both entry links start hidden and are unhidden only by the route's own flag", () => {
  // #81 M3, the brief page's half. `public/prep/brief.js` reads `document` at module scope, so
  // unlike session.js and debrief.js there is no controller a test can drive with a double —
  // which is exactly why the one line that opens this link had nothing gating it. A source
  // assertion is what this page can honestly carry.
  //
  // Both halves matter and they fail differently: drop the `hidden` attribute and every candidate
  // is offered a debrief before their interview, on a page that will only refuse the form; drop
  // the unhide and the feature has no entry point at all from either page.
  for (const [file, html, id] of [
    ["brief.html", BRIEF_HTML, "debrief-cta"],
    ["session.html", SESSION_HTML, "session-debrief-cta"],
  ]) {
    assert.match(
      tagWithId(html, "p", id),
      /\shidden[\s>]/,
      `${file}'s #${id} no longer starts hidden — the debrief link would be offered before the interview`,
    );
  }
  assert.match(
    BRIEF_JS,
    /if\s*\(\s*payload\.debrief_available\s*===\s*true\s*\)\s*debriefCta\.hidden\s*=\s*false/,
    "brief.js no longer unhides the debrief link on the route's flag — either the link is gone " +
      "or it is now opened on something other than /prep/api/brief's own `debrief_available`",
  );
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

test("all three pages still load the script that renders everything on them", () => {
  // Every assertion above can survive a rewrite that drops the script itself: the ids are all
  // still declared, the live regions are all still there, and the pages go completely inert —
  // a heading, a placeholder title, and nothing else, forever.
  assert.match(
    BRIEF_HTML,
    /<script type="module" src="\/prep\/brief\.js"><\/script>/,
    "brief.html no longer loads brief.js; the page renders a placeholder title and no blocks",
  );
  assert.match(SESSION_HTML, /import \{ initSession \}/, "session.html no longer imports the controller");
  assert.match(SESSION_HTML, /initSession\(\)/, "session.html imports the controller and never calls it");
  // The debrief's markup carries NO copy of its own — every label and caption is written by the
  // controller from COPY — so a dropped script here is a page of empty labels rather than a page
  // with a heading. It is the most inert of the three without its script.
  assert.match(DEBRIEF_HTML, /import \{ initDebrief \}/, "debrief.html no longer imports the controller");
  assert.match(DEBRIEF_HTML, /initDebrief\(\)/, "debrief.html imports the controller and never calls it");
  // #78. stories.html carries no copy of its own either — every label, caption and button word is
  // written by the controller from COPY — so a dropped script is a page of empty labels and an
  // "Add a story" button with no text in it.
  assert.match(STORIES_HTML, /import \{ initStories \}/, "stories.html no longer imports the controller");
  assert.match(STORIES_HTML, /initStories\(\)/, "stories.html imports the controller and never calls it");
});

test("every content page stays out of the index and keeps pinch zoom", () => {
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

test("every content page is served by the one stylesheet chain, in order", () => {
  // Order is the assertion, not just membership: session.css deliberately overrides prep.css's
  // .block background for feedback entries, and that override is decided by link order. Swap the
  // last two and the transcript silently loses its tone step.
  //
  // Named page by page rather than looped over CONTENT_PAGES, because session.html links a fifth
  // sheet the other two do not — a loop would have to encode that exception anyway, and would
  // silently stop asserting order for any page added to the map without a chain of its own.
  const chain = ["/fonts.css", "/tokens.css", "/app.css", "/prep/prep.css"];
  assert.deepEqual(stylesheetsOf(BRIEF_HTML), chain, "brief.html's stylesheet chain or its order");
  assert.deepEqual(
    stylesheetsOf(SESSION_HTML),
    [...chain, "/prep/session.css"],
    "session.html's stylesheet chain or its order — it links the portal's four plus its own, last",
  );
  assert.deepEqual(
    stylesheetsOf(DEBRIEF_HTML),
    chain,
    "debrief.html's stylesheet chain or its order — the portal's four and no fifth: the 16px " +
      "floor its pickers need lives in prep.css, where the colour and size gates can see it",
  );
  assert.deepEqual(
    stylesheetsOf(STORIES_HTML),
    chain,
    "stories.html's stylesheet chain or its order — the portal's four and no fifth, for the same " +
      "reason: the 16px floor its title field and sketch box need lives in prep.css",
  );
});

test("no content page carries a page-scoped style block", () => {
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
