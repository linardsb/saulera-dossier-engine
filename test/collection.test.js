// The instrument, not the code. `node --test test/*.test.js` is a SINGLE-LEVEL glob — `*` does
// not cross a `/` — so a test file in a subdirectory that no script names is never run and the
// suite still reports green.
//
// Same species as test/schema.test.js's two guard tests: it defends the thing the other
// assertions are made with, and it exists because the failure mode is silence rather than a red
// test. A whole ticket's suite can sit in test/prep/ passing nothing at all, and the only signal
// is a subtest count nobody reads.
//
// THE RULE IS "SOME SCRIPT RUNS IT", NOT "IT LIVES IN test/". Widened for #89: the live grammar
// gate needs a real API key and costs a request per test, so it cannot be in `npm test` — CI
// refuses any run that skipped anything (#33), which made a key-gated file inside the glob turn
// every PR red, including the one that introduced it. It moved to test/live/ with its own
// `npm run test:live`, which is what makes "not part of npm test's contract" true in the WIRING
// rather than only in a header comment.
//
// So the covered directories are DERIVED from package.json's scripts rather than restated here —
// test/node-version.test.js reads engines.node the same way, for the same reason: one authority,
// not two. Add a subdirectory without a script that names it and this still fails.
//
// What it deliberately does NOT promise: that CI runs every script. `.github/workflows/test.yml`
// runs `npm test` alone, so anything outside the top level runs only when a human types its
// command. That is a real gap and it is the price of the key; it belongs in a PR description,
// not hidden behind a green tick.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(testDir, "..", "package.json"), "utf8"));

/**
 * Every directory some `node --test <dir>/*.test.js` script covers, relative to test/ — "" for
 * test/ itself. Read off the scripts, so this gate cannot drift from what actually runs.
 */
function coveredDirs() {
  const dirs = new Set();
  for (const script of Object.values(pkg.scripts ?? {})) {
    for (const [, glob] of String(script).matchAll(/node --test (\S+)\/\*\.test\.js/g)) {
      dirs.add(relative(testDir, join(testDir, "..", glob)));
    }
  }
  return dirs;
}

/** Every `*.test.js` under test/, at any depth, relative to test/. */
function testFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return testFiles(full);
    // By extension, not by directory name: test/fixtures/ and test/helpers/ are skipped because
    // nothing in them ends in .test.js, and a future test/helpers/foo.test.js SHOULD fail here.
    return entry.name.endsWith(".test.js") ? [relative(testDir, full)] : [];
  });
}

test("every test file is in a directory some npm script actually runs", () => {
  const covered = coveredDirs();
  const orphans = testFiles(testDir).filter((f) => {
    const dir = dirname(f);
    return !covered.has(dir === "." ? "" : dir);
  });

  assert.deepEqual(
    orphans,
    [],
    `${orphans.join(", ")} will never run. Every \`node --test\` glob in package.json is ` +
      "single-level — `*` does not cross a `/` — so a test file in a directory no script names " +
      "is silently skipped while the suite still passes green, which is worse than a failing " +
      "test because nothing says so. Move it up into test/ (the repo's convention is a `-` " +
      "prefix, e.g. test/prep-schema.test.js), or add a script that globs its directory and say " +
      "in the PR why it cannot be part of `npm test` — CI runs `npm test` and nothing else, so " +
      "a second script is a gate a human has to remember.",
  );
});

test("every directory a script globs actually has tests in it", () => {
  // The other side, and the reason it is worth a second assertion: the guard above is satisfied
  // by ADDING a script, so a script naming an empty or deleted directory would quietly widen
  // what passes while covering nothing. `test:live` pointing at a directory that no longer
  // exists is a gate that reports success over zero tests — #33's failure mode wearing the
  // costume of a fix for it.
  const dirs = [...new Set(testFiles(testDir).map((f) => (dirname(f) === "." ? "" : dirname(f))))];
  for (const covered of coveredDirs()) {
    assert.ok(
      dirs.includes(covered),
      `a package.json script globs test/${covered}/*.test.js, and there are no test files ` +
        "there. It reports success over nothing. Delete the script, or put the tests back.",
    );
  }
});
