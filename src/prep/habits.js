// The habit vocabulary, closed (#23). SPEC "Habits": record what the candidate actually
// does, not a self-assigned type — the failure patterns are individual and few, and each
// one is fixable and generalises across every question. Surface a pattern once observed
// TWICE: first sight is noise. Never record or act on claimed learning styles.
//
// Pure like src/prep/dates.js: no D1, no HTTP, no `node:` imports.

/** SPEC's five, verbatim as column values. The feedback schema's enum is built from this. */
export const HABITS = [
  "rambles",
  "duties_not_outcomes",
  "no_numbers",
  "answers_wrong_question",
  "buries_result",
];

/**
 * Candidate-facing plain language, written for a first-time reader — the slug never
 * reaches a browser.
 */
export const HABIT_LABELS = {
  rambles: "Running long — the answer keeps going past its point",
  duties_not_outcomes: "Describing duties, not outcomes",
  no_numbers: "No numbers in the answer",
  answers_wrong_question: "Answering a different question than the one asked",
  buries_result: "Leaving the result until the last sentence",
};

/** The threshold at which one observation becomes a pattern. */
export const PATTERN_THRESHOLD = 2;

/**
 * The habits worth showing: active rows observed at least twice. Takes habit rows as the
 * store returns them (`{label, evidence_count, active}`; `active` is SQLite's 0/1).
 */
export function surfacedHabits(rows) {
  return (rows ?? []).filter((r) => r.active && r.evidence_count >= PATTERN_THRESHOLD);
}
