// The contrast gate over public/tokens.css (#8).
//
// CHECKLIST.md: "any new colour pairing gets its contrast checked at definition time, not
// discovered in review." The provenance marks are the reason this file exists. --verified and
// --unverified shipped in #3 as aliases of --success (2.28:1) and --warning (2.98:1), both far
// under the 4.5:1 body-text floor, and nobody caught it for two tickets — because a number in a
// comment is not a gate. This is the gate.
//
// It parses the FILE rather than a rendered page, in the idiom of schema.test.js: the same move
// applied to the palette, and the same zero dependencies. `node --test` has no DOM and the plan
// forbids adding tooling to get one, but a hex pair needs no DOM to measure.
//
// Branding is a swap of this file (README, Decisions), so an agency that overrides a colour
// runs this suite and finds out before a recruiter does.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(root, "public/tokens.css"), "utf8");

/** Every `--name: #hex;` declaration in the file. `var()` aliases are deliberately not resolved
 *  — see the last test, which requires the provenance three to be literals. */
function hexTokens(source) {
  const found = new Map();
  const re = /--([\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g;
  for (let m = re.exec(source); m; m = re.exec(source)) found.set(m[1], m[2].toLowerCase());
  return found;
}

const TOKENS = hexTokens(css);

/** #abc and #aabbcc, to three channels. Alpha is not handled: a token with alpha has no single
 *  contrast ratio, so it would need a compositing step this gate deliberately does not have. */
function channels(hex) {
  assert.ok(/^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(hex), `${hex} is not an opaque 3 or 6 digit hex`);
  const full = hex.length === 4 ? hex.slice(1).split("").map((c) => c + c).join("") : hex.slice(1);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

/**
 * WCAG 2.x relative luminance.
 *
 * The sRGB transfer function is piecewise and the threshold is 0.04045 on the ENCODED value.
 * Getting that branch wrong shifts every dark colour by enough to pass a pairing that fails —
 * which on this file is the whole point, since the marks are the darkest values in the palette.
 */
function luminance(hex) {
  const [r, g, b] = channels(hex).map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/** A token by name, failing loudly rather than measuring `undefined` if it was renamed away. */
function token(name) {
  const value = TOKENS.get(name);
  assert.ok(value, `--${name} is not a literal hex in tokens.css — this gate cannot measure it`);
  return value;
}

// The three surfaces anything on this deployment renders on. Every pairing below is checked
// against ALL THREE, because which one a component sits on is a layout decision that moves.
// --surface-signature joined the list in #58: it is the mint-tinted ground under the portal's
// first block (prep.css:69-74), so text renders on it as much as on the other two, and it was
// previously asserted only by a comment in tokens.css.
const SURFACES = ["background", "surface", "surface-signature"];

// [token, floor, why]. The floor is 4.5 wherever the token colours TEXT, which is every
// provenance mark: the mark carries the word "Unverified", and a word is text. --border takes
// 3.0, the non-text floor, because it encodes grouping rather than saying anything.
const PAIRINGS = [
  ["text-primary", 4.5, "body text"],
  ["text-muted", 4.5, "row meta and captions"],
  ["verified", 4.5, "the mark reads 'CV' or 'Our note'"],
  ["unverified", 4.5, "the mark reads 'Unverified'"],
  ["failed", 4.5, "the mark reads 'Quote not found'"],
  ["danger", 4.5, "the state line's error text"],
  ["border", 3.0, "a border that encodes grouping"],
  ["accent", 3.0, "a focus ring, an underline and a marker bar — never text"],
];

for (const [name, floor, why] of PAIRINGS) {
  for (const surface of SURFACES) {
    test(`--${name} on --${surface} clears ${floor}:1 (${why})`, () => {
      const measured = contrast(token(name), token(surface));
      assert.ok(
        measured >= floor,
        `--${name} (${token(name)}) on --${surface} (${token(surface)}) measures ` +
          `${measured.toFixed(2)}:1, under the ${floor}:1 floor. Darken the token rather than ` +
          `lowering this number: ${why}.`,
      );
    });
  }
}

// The three tints are BACKGROUNDS a chip renders on, and they are deliberately NOT in SURFACES.
// Putting them there would check every token against every tint and fail immediately on two
// pairings that never render: --text-muted is 3.75:1 on --tint-info and --border is 2.53:1 on it.
// This table asserts what actually goes on a tint instead. The constraint #60 inherits when it
// builds the chips: a chip on the powder tint carries --text-primary (8.21:1) or its own mark
// colour, never --text-muted. Muted is fine on mint (4.59:1) and blush (5.18:1), but the rule is
// simpler than the exceptions. No assertion here says muted FAILS — an agency darkening it must
// not break this suite.
const TINTS = [
  ["tint-verified", ["text-primary", "verified"]],
  ["tint-info", ["text-primary"]],
  ["tint-warn", ["text-primary", "unverified", "failed", "danger"]],
  // The journey-guide pills (recruiter blue, candidate orange) carry ink only, same rule.
  ["tint-guide-recruiter", ["text-primary"]],
  ["tint-guide-candidate", ["text-primary"]],
];

for (const [tint, marks] of TINTS) {
  for (const name of marks) {
    test(`--${name} on --${tint} clears 4.5:1 (a chip's word on its own ground)`, () => {
      const measured = contrast(token(name), token(tint));
      assert.ok(
        measured >= 4.5,
        `--${name} (${token(name)}) on --${tint} (${token(tint)}) measures ` +
          `${measured.toFixed(2)}:1, under the 4.5:1 floor. A chip carries a WORD, so its colour ` +
          `is text: darken the mark or lighten the tint rather than lowering this number.`,
      );
    });
  }
}

test("--on-accent on --accent-strong clears 4.5:1, which is .btn-primary's label", () => {
  // The PAIR changed in #58, and why it changed is the whole argument for --accent-strong. This
  // asserted --text-primary on --accent back when --accent was stackai's #0099ff. The owner's
  // decided accent #08906c measures 4.03:1 with white and 3.19:1 with the ink — both under the
  // body-text floor — and .btn-primary puts a label directly on the fill. #58's AC2 says the
  // gates win over a raw reference value, so the fill became the accent DARKENED
  // (--accent-strong, 5.04:1 with white) and the label became --on-accent. The floor did not
  // move; the token did. If an agency swaps either, this is the assertion that catches it.
  const measured = contrast(token("on-accent"), token("accent-strong"));
  assert.ok(
    measured >= 4.5,
    `--on-accent on --accent-strong measures ${measured.toFixed(2)}:1. A button label is body text.`,
  );
});

test("the provenance three are literal hex, not var() aliases", () => {
  // The bug this file was written for. `--verified: var(--success)` reads as a definition and
  // measures as whatever --success happens to be, so the floor above can be satisfied by a
  // token nobody checked. Requiring a literal keeps the value and its measurement in one place.
  for (const name of ["verified", "unverified", "failed"]) {
    const declaration = new RegExp(`--${name}\\s*:\\s*([^;]+);`).exec(css);
    assert.ok(declaration, `--${name} is not declared in tokens.css`);
    assert.doesNotMatch(
      declaration[1],
      /var\(/,
      `--${name} is an alias. Aliasing it re-opens the exact hole this gate closed: the alias ` +
        `target can drift under the floor without any pairing here changing. Give it its own hex.`,
    );
  }
});

test("--border-hairline exists, and --border keeps the 3:1 job it delegates", () => {
  // The hairline is decorative by contract (tokens.css comment): card edges whose grouping the
  // surface change already carries. It is deliberately NOT in PAIRINGS — it would fail the 3.0
  // floor by design — but it must exist as a literal, so an agency swap that deletes it fails
  // here rather than as an invisible card edge, and --border must stay the token meaningful
  // boundaries use (its own PAIRINGS entry above enforces the floor).
  assert.ok(TOKENS.has("border-hairline"), "--border-hairline is not a literal hex in tokens.css");
});

test("the palette is measurable: every colour token this gate reads is opaque hex", () => {
  // A guard on the guard, in schema.test.js's idiom. A token written as `rgb(...)`, `hsl(...)`
  // or an 8-digit hex is ABSENT from TOKENS, so `token()` throws rather than the pairing
  // silently passing — but only if something asks for it. This asserts the parser saw them all.
  for (const [name] of PAIRINGS) {
    assert.ok(TOKENS.has(name), `--${name} is not in a form this gate can measure`);
  }
  for (const surface of SURFACES) {
    assert.ok(TOKENS.has(surface), `--${surface} is not in a form this gate can measure`);
  }
  for (const [tint, marks] of TINTS) {
    assert.ok(TOKENS.has(tint), `--${tint} is not in a form this gate can measure`);
    for (const name of marks) {
      assert.ok(TOKENS.has(name), `--${name} is not in a form this gate can measure`);
    }
  }
  for (const name of ["accent-strong", "on-accent"]) {
    assert.ok(TOKENS.has(name), `--${name} is not in a form this gate can measure`);
  }
});
