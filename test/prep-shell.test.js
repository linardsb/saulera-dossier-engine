// The gate over the candidate portal's shell pages — SHOWCASE VARIANT (#62, adapted).
//
// On main this file also holds the contract between login.html's markup and login.js's twelve
// getElementById lookups. The showcase branch deletes both of those files: there is no candidate
// sign-in here, because a demo should not ask the person being shown the product to hold a
// six-digit code. What remains is the junction and the privacy page, and the assertions below are
// the ones from main that still have a subject.
//
// The class of failure this file catches is unchanged: a redesign that ships GREEN and inert.
// index.html's whole reason to exist is one fetch and three redirects written inline, and nothing
// else in the suite asserts any of it.
//
// Two of these are the showcase's posture rather than main's:
//   · the junction must still fail CLOSED, but on this branch "closed" means /prep/demo — the
//     route that mints the seeded demo session — rather than a sign-in page that no longer
//     exists. A rewrite that points either branch at /prep/login lands on a redirect Function
//     and still works, but the extra hop is not the intent and the assertion says so.
//   · the sign-in must STAY gone. Restoring login.html without restoring login.js, or vice
//     versa, is a half-merge from main that renders a form which cannot submit.
//
// Not to be confused with test/chrome.test.js, which gates where a VALUE may live. This file
// asserts structure and never looks at a style.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const INDEX_HTML = read("public/prep/index.html");
const PRIVACY_HTML = read("public/prep/privacy.html");

const SHELL_PAGES = {
  "public/prep/index.html": INDEX_HTML,
  "public/prep/privacy.html": PRIVACY_HTML,
};

/** Every stylesheet the page links, in link order — which is what decides the cascade here. */
const stylesheetsOf = (html) =>
  [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)].map((m) => m[1]);

test("the candidate sign-in stays removed, and the path still resolves", () => {
  // Both halves or neither. login.html without login.js is a form that cannot submit; login.js
  // without login.html throws on every lookup. A half-finished merge from main gives one of them.
  assert.equal(existsSync(join(root, "public/prep/login.html")), false, "login.html is back");
  assert.equal(existsSync(join(root, "public/prep/login.js")), false, "login.js is back");

  // Nothing on the page links to /prep/login any more, but brief.js and session.js still bounce
  // there on a 401 and an old invite email may carry it, so the path must not 404 mid-demo.
  assert.ok(
    existsSync(join(root, "functions/prep/login.js")),
    "with login.html deleted, /prep/login needs the redirect Function or it 404s — and " +
      "public/prep/brief.js and session.js both send a 401 there",
  );
  assert.match(read("functions/prep/login.js"), /Location: "\/prep\/"/, "the redirect target moved");
});

test("the junction still asks the server and still fails closed", () => {
  assert.match(INDEX_HTML, /fetch\("\/prep\/auth\/session"/, "the session check is gone");

  // Two, not one: the !body.ok branch and the .catch. A failed check is not a session, and on
  // this branch both hand off to the route that mints the demo session.
  const bounces = [...INDEX_HTML.matchAll(/location\.replace\("\/prep\/demo"\)/g)];
  assert.equal(
    bounces.length,
    2,
    "the junction must bounce to /prep/demo on BOTH the signed-out branch and the network-error " +
      "catch; with one of them gone a visitor to the showcase lands on a page that never moves",
  );
  assert.match(INDEX_HTML, /location\.replace\("\/prep\/brief"\)/, "the signed-in branch is gone");

  // /prep/demo is the only way into a session on this branch, so it has to still be there.
  assert.ok(
    existsSync(join(root, "functions/prep/demo.js")),
    "the junction hands off to /prep/demo and nothing else mints a session on this branch",
  );
});

test("both shell pages stay out of the index and keep pinch zoom", () => {
  for (const [page, html] of Object.entries(SHELL_PAGES)) {
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
      `${page} disables pinch zoom, which fails WCAG 1.4.4`,
    );
  }
});

test("the portal shell is served by one stylesheet chain", () => {
  // privacy joined prep.css in #62, which is what gives every page in the portal the same footer.
  // index deliberately did not: its whole vocabulary is app.css's, and a fourth blocking
  // stylesheet on a page that exists for one round trip delays the only thing it does.
  const chain = ["/fonts.css", "/tokens.css", "/app.css", "/prep/prep.css"];
  // SHOWCASE BRANCH ONLY: privacy.html carries the temporary walkthrough layer
  // (public/guide.css) LAST in its chain, because on this demo the person reading the candidate
  // portal is the recruiter learning the product. The four-sheet product chain and its order are
  // still pinned exactly; guide.css cannot reach the page's own rules — every selector in it is
  // scoped under `.guide`, which test/guide.test.js asserts rather than trusts. On main the
  // walkthrough must not be on a candidate page, and this expectation goes back to `chain` alone.
  // The junction is deliberately NOT annotated: it replaces itself within one round trip, so a
  // pill there would never be read.
  assert.deepEqual(
    stylesheetsOf(PRIVACY_HTML),
    [...chain, "/guide.css"],
    "privacy.html's stylesheet chain or its order — the portal's four, then the demo walkthrough last",
  );
  assert.deepEqual(
    stylesheetsOf(INDEX_HTML),
    chain.slice(0, 3),
    "the /prep/ junction links three stylesheets and not prep.css",
  );
});
