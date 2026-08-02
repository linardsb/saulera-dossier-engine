// The gate over the candidate portal's three SHELL pages: login, the /prep/ junction, and the
// privacy page (#62).
//
// The class of failure this file catches is a redesign that ships GREEN and inert. login.js
// reaches twelve elements by id and can see none of them from its own file; index.html's whole
// reason to exist is one fetch and three redirects written inline. Nothing in the suite asserted
// any of that before this file, so "fully redesign the three shell pages" — which is exactly what
// #62 asked for — could rename #sent-note, drop autocomplete="one-time-code", lose a
// location.replace branch, or delete the <script> tag outright, and every other test would still
// pass. The pages would render beautifully and do nothing.
//
// Three of these are not merely structural, they are the security and accessibility posture:
//   · index.html must fail CLOSED. Both the "not signed in" branch and the network-error branch
//     redirect to /prep/login, and a rewrite that keeps only one turns a failed session check
//     into a candidate sitting on a page that never moves.
//   · the viewport meta must never gain maximum-scale or user-scalable=no. That is the tempting
//     fix for the iOS zoom this ticket solved with a 16px control instead, and it fails
//     WCAG 1.4.4 by disabling pinch zoom for everyone.
//   · both state lines are live regions. They are the only channel by which a screen-reader user
//     learns a code was sent or a sign-in failed.
//
// Not to be confused with test/chrome.test.js, which gates where a VALUE may live (colour, motion,
// fonts). This file asserts that the markup still honours the contracts two scripts depend on, and
// never looks at a style.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const LOGIN_HTML = read("public/prep/login.html");
const LOGIN_JS = read("public/prep/login.js");
const INDEX_HTML = read("public/prep/index.html");
const PRIVACY_HTML = read("public/prep/privacy.html");

const SHELL_PAGES = {
  "public/prep/login.html": LOGIN_HTML,
  "public/prep/index.html": INDEX_HTML,
  "public/prep/privacy.html": PRIVACY_HTML,
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

test("every element login.js reaches by id exists in login.html", () => {
  // The lookups do NOT go through getElementById directly: login.js:60 defines
  // `var $ = function (id) { return document.getElementById(id); }` and all twelve call sites are
  // $("notice"), $("act-code") and so on. Matching /getElementById\("…"\)/ instead would find the
  // helper's single call, whose argument is a VARIABLE, extract nothing, and loop over an empty
  // set — green, and checking nothing. The non-empty assertion below is what keeps that from
  // happening again if `$` is ever refactored.
  const reached = [...LOGIN_JS.matchAll(/\$\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]);
  assert.ok(
    reached.length >= 12,
    `parsed ${reached.length} id lookups out of login.js, expected at least 12 — the helper this ` +
      `regex follows has changed shape, and this gate is now asserting nothing`,
  );

  const declared = new Set([...LOGIN_HTML.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  for (const id of reached) {
    assert.ok(
      declared.has(id),
      `login.js reaches #${id} and login.html no longer declares it. The page will throw on load ` +
        `or silently stop responding; class hooks may move in a redesign, ids may not.`,
    );
  }
});

test("the phone input attributes survive on both fields", () => {
  // inputmode + autocomplete together are what make a phone offer the code straight from the
  // notification, and the email keyboard appear instead of the alphabetic one. Every one of these
  // is invisible on a desktop browser, so losing one in a rewrite is only ever found by a
  // candidate on a phone.
  const code = tagWithId(LOGIN_HTML, "input", "code");
  assert.match(code, /autocomplete="one-time-code"/, "#code lost the one-time-code autofill hint");
  assert.match(code, /inputmode="numeric"/, "#code lost the numeric keypad");
  // 7 rather than 6 on purpose: a candidate pastes what their mail client shows them, which is
  // sometimes '123 456', and login.js:162 strips it to digits. A maxlength of 6 truncates the
  // paste to '123 45' before the script ever sees it.
  assert.match(code, /maxlength="7"/, "#code's maxlength must stay 7 so a pasted '123 456' fits");

  const email = tagWithId(LOGIN_HTML, "input", "email");
  assert.match(email, /type="email"/, "#email lost its type");
  assert.match(email, /inputmode="email"/, "#email lost the email keyboard");
  assert.match(email, /autocomplete="email"/, "#email lost the address autofill hint");
});

test("both state lines are still live regions, and both hidden elements start hidden", () => {
  for (const id of ["email-state", "code-state"]) {
    const line = tagWithId(LOGIN_HTML, "p", id);
    assert.match(line, /role="status"/, `#${id} is no longer announced`);
    assert.match(line, /aria-live="polite"/, `#${id} lost aria-live`);
  }

  // Act 2 is revealed by login.js setting .hidden = false, and the notice by the ?e= branch. If
  // either ships without the attribute, every candidate sees a stray empty panel and both acts at
  // once on first paint.
  assert.match(tagWithId(LOGIN_HTML, "section", "act-code"), /\shidden[\s>]/, "#act-code starts open");
  assert.match(tagWithId(LOGIN_HTML, "div", "notice"), /\shidden[\s>]/, "#notice starts open");

  // Both acts keep the heading link a screen reader navigates the page by.
  for (const id of ["act-email", "act-code"]) {
    assert.match(
      tagWithId(LOGIN_HTML, "section", id),
      new RegExp(`aria-labelledby="${id}-head"`),
      `#${id} lost its accessible name`,
    );
  }
});

test("login.html still styles the tone attribute login.js writes", () => {
  // say() sets data-tone="error" and nothing else — not a class. A redesign that restyles the
  // state line as `.state.is-error` to match app.css's .save-state would leave every sign-in
  // error rendering in the muted body colour, which reads as ordinary status text.
  assert.match(
    LOGIN_HTML,
    /\[data-tone="error"\]/,
    "login.js:78 sets data-tone on the state line; the page must style it, and never a class",
  );
});

test("the /prep/ junction still asks the server and still fails closed", () => {
  assert.match(INDEX_HTML, /fetch\("\/prep\/auth\/session"/, "the session check is gone");

  // Two, not one: the !body.ok branch and the .catch. A failed check is not a session.
  const bounces = [...INDEX_HTML.matchAll(/location\.replace\("\/prep\/login"\)/g)];
  assert.equal(
    bounces.length,
    2,
    "the junction must bounce to /prep/login on BOTH the signed-out branch and the network-error " +
      "catch; with one of them gone a failed session check strands the candidate here",
  );
  assert.match(INDEX_HTML, /location\.replace\("\/prep\/brief"\)/, "the signed-in branch is gone");

  // Every id can survive a rewrite that drops the script itself, and the page then goes inert
  // while every other assertion here still passes.
  assert.match(LOGIN_HTML, /<script src="\/prep\/login\.js"><\/script>/, "login.js is not loaded");
});

test("all three shell pages stay out of the index and keep pinch zoom", () => {
  for (const [page, html] of Object.entries(SHELL_PAGES)) {
    assert.match(
      html,
      /<meta name="robots" content="noindex, nofollow">/,
      `${page} lost its robots meta; the candidate portal is not for the open web`,
    );

    const viewport = html.match(/<meta name="viewport" content="([^"]+)">/);
    assert.ok(viewport, `${page} has no viewport meta and will render at desktop width on a phone`);
    assert.match(viewport[1], /width=device-width/, `${page}'s viewport is not device-width`);
    // The tempting fix for the iOS focus-zoom this ticket solved with a 16px control instead.
    assert.doesNotMatch(
      viewport[1],
      /maximum-scale|user-scalable/,
      `${page} disables pinch zoom, which fails WCAG 1.4.4. The iOS zoom on a focused field is ` +
        `fixed by raising the control to 16px (login.html's .signin .input), never here.`,
    );
  }
});

test("the portal shell is served by one stylesheet chain", () => {
  // login and privacy joined prep.css in #62, which is what gives every page in the portal the
  // same footer. index deliberately did not: its whole vocabulary is app.css's, and a fourth
  // blocking stylesheet on a page that exists for one round trip delays the only thing it does.
  const chain = ["/fonts.css", "/tokens.css", "/app.css", "/prep/prep.css"];
  assert.deepEqual(stylesheetsOf(LOGIN_HTML), chain, "login.html's stylesheet chain or its order");
  assert.deepEqual(stylesheetsOf(PRIVACY_HTML), chain, "privacy.html's stylesheet chain or its order");
  assert.deepEqual(
    stylesheetsOf(INDEX_HTML),
    chain.slice(0, 3),
    "the /prep/ junction links three stylesheets and not prep.css — it uses nothing from that " +
      "file, and the cost of a fourth blocking request lands on the page with the least time",
  );
});
