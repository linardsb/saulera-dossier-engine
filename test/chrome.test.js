// The gate over the shared chrome: public/app.css and public/fonts.css (#58).
//
// The class of failure this file catches is the kind that ships GREEN. All three invariants
// below are conventions the files already keep, and none of them was measurable before:
//
//   1. A transition added to a rule in app.css rather than to the motion block at its foot.
//      #58 inverted the reduced-motion guard from opt-out (a blanket `reduce` override with
//      !important) to opt-in. Under opt-out a stray transition merely animated; under opt-in it
//      animates for a user who asked for no motion, and nothing renders differently for anyone
//      testing it. This is the test that makes the inversion hold.
//   2. A raw hex in app.css or in one of the four page-scoped <style> blocks. Branding on this
//      product is a swap of tokens.css, so one literal colour anywhere else is a value an agency
//      cannot override and will not find.
//   3. An off-origin font request. This page accepts CVs; a third-party host in the waterfall is
//      a thing to have to explain to a trust.
//
// Not to be confused with test/tokens.test.js, which measures colour PAIRINGS in tokens.css for
// contrast. This file asserts structure and never measures a ratio: it is about where a value is
// allowed to live, not about what the value is.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "");

const APP_CSS = read("public/app.css");
const FONTS_CSS = read("public/fonts.css");

// Every page-scoped <style> block on the deployment. Swept rather than assumed: these four are
// the only HTML files under public/ that carry one, and the sweep that established that is the
// same one that proved none of them animates.
const INLINE_STYLE_PAGES = [
  "public/404.html",
  "public/prep/index.html",
  "public/prep/login.html",
  "public/prep/privacy.html",
];

test("every transition in app.css sits behind the reduced-motion guard", () => {
  // Strip each `prefers-reduced-motion: no-preference` block by counting braces, then assert
  // nothing animating survives. The loop is prep-registry.test.js:780-795 verbatim — a regex
  // cannot match nested braces, and app.css's guard block nests one level.
  let outsideGuard = stripComments(APP_CSS);
  for (
    let at = outsideGuard.search(/@media[^{]*prefers-reduced-motion:\s*no-preference/);
    at !== -1;
    at = outsideGuard.search(/@media[^{]*prefers-reduced-motion:\s*no-preference/)
  ) {
    let depth = 0;
    let end = outsideGuard.indexOf("{", at);
    do {
      const ch = outsideGuard[end];
      if (ch === "{") depth += 1;
      if (ch === "}") depth -= 1;
      end += 1;
    } while (depth > 0 && end < outsideGuard.length);
    outsideGuard = outsideGuard.slice(0, at) + outsideGuard.slice(end);
  }
  assert.doesNotMatch(
    outsideGuard,
    /transition|animation|@keyframes/,
    "motion in app.css is opt-in: move this into the `prefers-reduced-motion: no-preference` " +
      "block at the foot of the file rather than declaring it on the rule",
  );
});

test("app.css declares no colour of its own", () => {
  // Comments are stripped FIRST and that is not incidental: this file's comments quote hex
  // values as part of their reasoning (tokens.css:19-22 sets the house precedent) and always
  // will. Note the strip removes comment SPANS, so a trailing comment on a declaration line goes
  // with them — which is the intended filter, not a gap.
  assert.doesNotMatch(
    stripComments(APP_CSS),
    /#[0-9a-fA-F]{3,8}\b/,
    "a raw colour belongs in tokens.css, where an agency's branding swap can reach it",
  );
});

test("no page-scoped <style> block declares a colour either", () => {
  // The second half of #58 AC1. "Every colour is in tokens.css" is only true if no inline block
  // sneaks one in, and an inline block is exactly where one would: it is the furthest a value
  // can get from this repo's token discipline while still rendering.
  for (const page of INLINE_STYLE_PAGES) {
    const html = read(page);
    const blocks = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
    assert.ok(blocks.length > 0, `${page} was in this list because it has a <style> block`);
    assert.doesNotMatch(
      stripComments(blocks.join("\n")),
      /#[0-9a-fA-F]{3,8}\b/,
      `${page}'s <style> block declares a raw colour; it belongs in tokens.css`,
    );
  }
});

test("fonts.css requests nothing off-origin", () => {
  const declarations = stripComments(FONTS_CSS);
  const sources = [...declarations.matchAll(/src\s*:\s*url\(\s*["']?([^"')]+)/g)].map((m) => m[1]);
  assert.ok(sources.length > 0, "no @font-face src parsed out of fonts.css");
  for (const src of sources) {
    assert.match(
      src,
      /^\/fonts\/[^/]+\.woff2$/,
      `${src} is not a root-relative /fonts/*.woff2 path. The fonts are self-hosted so that no ` +
        `request leaves the origin: this deployment accepts CVs.`,
    );
  }
  assert.doesNotMatch(declarations, /https?:|\/\/[a-z]/i, "an off-origin URL in fonts.css");
  assert.doesNotMatch(declarations, /@import/, "@import fetches a second stylesheet, off-origin");
});

test("every font file fonts.css names is actually on disk", () => {
  // A @font-face pointing at a deleted file fails silently: the browser falls back down the
  // stack and the page merely looks slightly wrong. #58 deleted one woff2, so this is the check
  // that the deletion and the rule were the same edit.
  const declarations = stripComments(FONTS_CSS);
  const sources = [...declarations.matchAll(/src\s*:\s*url\(\s*["']?([^"')]+)/g)].map((m) => m[1]);
  for (const src of sources) {
    assert.doesNotThrow(
      () => readFileSync(join(root, "public", src)),
      `fonts.css names ${src}, which is not in public/fonts/`,
    );
  }
});
