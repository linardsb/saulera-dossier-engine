// #33 — the loud half of the Node-version gate. The skip guard in test/helpers/sqlite-d1.js
// is correct and stays: on Node < 22.5 the real-SQL integrity tests cannot run, and an
// unrunnable suite would be worse. What must not stay is the silence — `node --test` exits 0
// on skips, so `npm test` on the default toolchain read as a pass while the whole
// node:sqlite layer went unproven (measured in the PR #32 review: 505 pass, 72 skipped,
// exit 0; 138 skipped by the time this landed). This file is the consequence made visible:
// one non-skipped test that reddens the run instead.
//
// It reads the floor from package.json's engines.node rather than restating it — one
// authority, not two. The CI half of the same rule is .github/workflows/test.yml (#36).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const pkg = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8"),
);

test("the running Node satisfies engines.node, or this suite is not measuring what it says", () => {
  const range = String(pkg.engines?.node ?? "");
  // The repo's range is a plain ">=X.Y" and nothing fancier. If it ever becomes a shape this
  // cannot read, fail loudly rather than guess — a gate that guesses is the silence again.
  const floor = range.match(/^>=\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
  assert.ok(floor, `engines.node ${JSON.stringify(range)} is not a plain >= floor; update this gate with it`);

  const need = [Number(floor[1]), Number(floor[2] ?? 0), Number(floor[3] ?? 0)];
  const have = process.versions.node.split(".").map(Number);
  const satisfied =
    have[0] !== need[0] ? have[0] > need[0] : have[1] !== need[1] ? have[1] > need[1] : have[2] >= need[2];

  assert.ok(
    satisfied,
    `Node ${process.versions.node} is below engines.node "${range}": the real-SQL integrity ` +
      `tests are skipping, so this run proves less than it says — a false pass, not a partial ` +
      `one. Run under a newer Node (e.g. \`nvm use 24\`) for the full suite.`,
  );
});
