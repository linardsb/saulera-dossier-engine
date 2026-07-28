// The instrument, not the code. `npm test` is `node --test test/*.test.js` — a SINGLE-LEVEL
// glob — so a test file in a subdirectory is never run and the suite still reports green.
//
// Same species as test/schema.test.js's two guard tests: it defends the thing the other
// assertions are made with, and it exists because the failure mode is silence rather than a red
// test. A whole ticket's suite can sit in test/prep/ passing nothing at all, and the only signal
// is a subtest count nobody reads.
//
// If a subdirectory layout is genuinely wanted, that is a decision to make in the open: widen
// the glob in package.json and change this test deliberately, saying why in the PR.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));

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

test("every test file sits directly in test/, where npm test's glob can see it", () => {
  const nested = testFiles(testDir).filter((f) => f.includes("/"));

  assert.deepEqual(
    nested,
    [],
    `${nested.join(", ")} will never run. package.json's "test" script is ` +
      "`node --test test/*.test.js`, a single-level glob: a test file one directory down is " +
      "silently skipped and the suite still passes green, which is worse than a failing test " +
      "because nothing says so. Move it up into test/ (the repo's convention is a `-` prefix, " +
      "e.g. test/prep-schema.test.js), or widen the glob deliberately and say why in the PR.",
  );
});
