// #23 — habits surface only as patterns (SPEC: "once observed twice — not on first
// sight, which is noise").

import { test } from "node:test";
import assert from "node:assert/strict";

import { HABITS, HABIT_LABELS, PATTERN_THRESHOLD, surfacedHabits } from "../src/prep/habits.js";

test("evidence_count 1 is noise, 2 is a pattern", () => {
  assert.deepEqual(surfacedHabits([{ label: "rambles", evidence_count: 1, active: 1 }]), []);
  assert.equal(
    surfacedHabits([{ label: "rambles", evidence_count: 2, active: 1 }]).length,
    1,
  );
  assert.equal(PATTERN_THRESHOLD, 2);
});

test("an inactive habit stays hidden whatever its count — retired habits are progress", () => {
  assert.deepEqual(
    surfacedHabits([{ label: "no_numbers", evidence_count: 5, active: 0 }]),
    [],
  );
});

test("every enum member has a plain-language label, and no label is the slug", () => {
  assert.equal(HABITS.length, 5, "SPEC's five, exactly");
  for (const habit of HABITS) {
    const label = HABIT_LABELS[habit];
    assert.equal(typeof label, "string");
    assert.ok(label.length > 10, `${habit}: a label a first-time reader can act on`);
    assert.ok(!label.includes("_"), `${habit}: the slug must not leak into the label`);
  }
});

test("the vocabulary is closed — no 'none' in the stored set", () => {
  // 'none' is the feedback schema's escape hatch, never a row.
  assert.ok(!HABITS.includes("none"));
});
