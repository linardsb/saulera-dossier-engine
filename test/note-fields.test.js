// #18 — the visibility gate's own test suite.
//
// This module is the whole safety property of the feature; the table, the endpoint and the
// checkbox are plumbing around it. So the bias here is `provenance.test.js`': toward the cases
// that would let something through, not the ones that confirm the happy path. Every test in the
// first section is a way a section the recruiter never ticked could reach a candidate.
//
// The subtlest of them is the duplicate-heading pair. A positional `-2` key scheme passes every
// obvious test and still leaks, because deleting the first of two same-named sections hands its
// permission to the survivor. That sequence is written out below as a test rather than trusted
// to a comment.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { fieldKey, parseNoteFields, visibleFields } from "../src/note-fields.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// The only real-shaped note in the repo: an h1, a `**Client:** …` preamble, four `##` sections.
// Every parser decision was made against this file, so it is the fixture rather than a mock.
const REAL_NOTE = readFileSync(join(root, "spike/inputs/client-note.md"), "utf8");

const keysOf = (note) => parseNoteFields(note).map((f) => f.key);

// ── the five ways something could leak ──────────────────────────────────────────────────

test("a note with no headings has no fields, so there is nothing to share", () => {
  const note = "Two stages. First a 30-minute conversation with the Clinical Services Manager.";
  assert.deepEqual(parseNoteFields(note), []);
  assert.deepEqual(visibleFields(note, ["their-process", "section", ""]), []);
  // Empty and whitespace-only notes are the same case at the limit.
  for (const empty of ["", "   \n\n  ", null, undefined]) {
    assert.deepEqual(parseNoteFields(empty), [], `${JSON.stringify(empty)} should have no fields`);
    assert.deepEqual(visibleFields(empty, ["anything"]), []);
  }
});

test("visibleFields with the flag argument omitted returns nothing, not everything", () => {
  // The single most important line in this file. #18's ticket sketches a one-argument
  // `visibleFields(note)`; a consumer that calls it that way must get [], never the note.
  assert.deepEqual(visibleFields(REAL_NOTE), []);
  assert.deepEqual(visibleFields(REAL_NOTE, []), []);
  assert.deepEqual(visibleFields(REAL_NOTE, null), []);
  assert.deepEqual(visibleFields(REAL_NOTE, new Set()), []);
});

test("a stored key whose heading was renamed away is never emitted", () => {
  // The read-side half of R5. The prune in updateClient is the write-side half, and either
  // alone is sufficient — which is why there are both.
  const before = "## Their process\n\nTwo stages.\n\n## Practical\n\nThey move fast.";
  const after = "## How they interview\n\nTwo stages.\n\n## Practical\n\nThey move fast.";
  const stored = ["their-process", "practical"];

  assert.deepEqual(visibleFields(before, stored).map((f) => f.key), ["their-process", "practical"]);

  const kept = visibleFields(after, stored);
  assert.deepEqual(kept.map((f) => f.key), ["practical"], "the renamed section is gone");
  assert.equal(kept[0].text.trim(), "They move fast.", "and the surviving section is unaffected");

  // Re-typing the old heading later must not resurrect the permission on its own. Here it
  // would, because `stored` still holds the key — which is exactly why the store prunes on
  // save. What this asserts is the narrower true thing: nothing outside `stored` is emitted.
  assert.deepEqual(visibleFields(after, []).map((f) => f.key), []);
});

test("text before the first heading belongs to no field, at any level", () => {
  const preamble = "**Client:** Ashdown Park Community Healthcare";
  for (const level of [1, 2, 3, 4, 5, 6]) {
    const note = `${preamble}\n\n${"#".repeat(level)} Their process\n\nTwo stages.`;
    const fields = parseNoteFields(note);
    assert.equal(fields.length, 1, `h${level} should open exactly one field`);
    assert.equal(fields[0].level, level);
    assert.ok(!fields[0].text.includes("Ashdown Park"), "the preamble must not ride into a field");
  }

  // And in the real note, where the preamble sits under the h1 rather than above everything.
  const real = parseNoteFields(REAL_NOTE);
  assert.equal(real[0].heading, "SYNTHETIC — agency's client-knowledge note");
  assert.ok(
    real.slice(1).every((f) => !f.text.includes("**Client:**")),
    "the client line belongs to the h1's section and to no other",
  );
});

test("two identical headings are both unflaggable, whatever is in visibleKeys", () => {
  const note = "## Notes\n\nFirst.\n\n## Notes\n\nSecond.";
  const fields = parseNoteFields(note);

  assert.equal(fields.length, 2, "both sections are still returned — the recruiter can see them");
  assert.deepEqual(fields.map((f) => f.key), [null, null]);
  assert.deepEqual(fields.map((f) => f.text.trim()), ["First.", "Second."]);

  for (const keys of [["notes"], ["notes-2"], ["notes", "notes-2"], ["section"], [null]]) {
    assert.deepEqual(visibleFields(note, keys), [], `${JSON.stringify(keys)} must share nothing`);
  }
});

test("a permission cannot transfer between two same-named sections", () => {
  // R4, written as the sequence that breaks a positional-key scheme.
  const one = "## Notes\n\nPrivate read on the hiring manager.";
  const stored = ["notes"]; // the recruiter ticked the only `## Notes` there was

  assert.deepEqual(visibleFields(one, stored).map((f) => f.key), ["notes"]);

  // A second `## Notes` is added. Under positional keys the first would stay `notes` and stay
  // shared; here both go null, so the tick stops applying to anything the moment it is ambiguous.
  const two = `${one}\n\n## Notes\n\nSomething they would never say to a candidate.`;
  assert.deepEqual(keysOf(two), [null, null]);
  assert.deepEqual(visibleFields(two, stored), []);

  // Now delete the FIRST copy. Under positional keys the survivor inherits `notes` and is
  // shared with nobody having ticked it. Here the survivor is unticked, because a permission
  // for `notes` can only be re-created by the recruiter ticking it again — and the store's
  // prune has already dropped the stored row while the note held two of them.
  const survivor = "## Notes\n\nSomething they would never say to a candidate.";
  assert.deepEqual(keysOf(survivor), ["notes"], "the survivor parses under the plain key again");
  assert.deepEqual(
    visibleFields(survivor, []).map((f) => f.key),
    [],
    "and with the pruned allow-list it is unticked, which is the point of the prune",
  );
});

// ── the parser's own rules ──────────────────────────────────────────────────────────────

test("the real note parses into its h1 and its four sections", () => {
  assert.deepEqual(keysOf(REAL_NOTE), [
    "synthetic-agency-s-client-knowledge-note",
    "their-process",
    "what-they-actually-care-about",
    "why-candidates-have-been-turned-down",
    "practical",
  ]);
  const practical = parseNoteFields(REAL_NOTE).at(-1);
  assert.equal(practical.heading, "Practical");
  assert.equal(practical.level, 2);
  assert.ok(practical.text.includes("offer within a week"), "the last section runs to the end");
  assert.equal(practical.chars, practical.text.trim().length);
});

test("levels 1 to 6 open a field and a seventh hash does not", () => {
  for (const level of [1, 2, 3, 4, 5, 6]) {
    const fields = parseNoteFields(`${"#".repeat(level)} Practical\n\nbody`);
    assert.equal(fields.length, 1);
    assert.equal(fields[0].level, level);
  }
  assert.deepEqual(parseNoteFields("####### seven hashes\n\nbody"), []);
});

test("a hash with no space after it is a hashtag, not a heading", () => {
  assert.deepEqual(parseNoteFields("#hashtag\n\nbody"), []);
  assert.deepEqual(keysOf("#\tTabbed\n\nbody"), ["tabbed"], "a tab is whitespace and does open one");
});

test("closing hashes are part of the syntax, not part of the name", () => {
  assert.deepEqual(keysOf("## Practical ##\n\nbody"), ["practical"]);
  assert.equal(parseNoteFields("## Practical ##")[0].heading, "Practical");
});

test("a setext heading terminates the section instead of riding inside it", () => {
  // A heading this parser cannot NAME must not become a heading it silently SWALLOWS. Before
  // the fix this note parsed to one field, `public-process`, whose text carried the salary
  // lines — so ticking "Public process" shared what the client pays. The recruiter's only
  // signal was a section missing from the list, which reads as "not tickable", not as "folded
  // into a ticked one".
  const note = [
    "## Public process",
    "Blah",
    "",
    "Salary expectations",
    "-------------------",
    "They pay under market.",
  ].join("\n");

  assert.deepEqual(keysOf(note), ["public-process"], "the setext heading is still not named");
  const [visible] = visibleFields(note, ["public-process"]);
  assert.doesNotMatch(visible.text, /under market/, "its CONTENT must not ride along");
  assert.doesNotMatch(
    visible.text,
    /Salary expectations/,
    "and neither must its heading text, which is the line above the underline",
  );
});

test("an indented ATX heading terminates the section too", () => {
  // 1-3 spaces still make a heading in CommonMark, but the anchored HEADING regex misses it.
  const note = "## Public process\nBlah\n   ## Salary\nThey pay under market.";
  assert.deepEqual(keysOf(note), ["public-process"]);
  assert.doesNotMatch(visibleFields(note, ["public-process"])[0].text, /under market/);
});

test("a thematic break and a table are body text, not terminators", () => {
  // The terminator must not be so eager that ordinary prose loses its second half. `---` after
  // a BLANK line is a thematic break, and a table's delimiter row has pipes in it.
  const broken = "## Public process\nBlah\n\n---\n\nStill the same section.";
  assert.match(visibleFields(broken, ["public-process"])[0].text, /Still the same section/);

  const table = "## Public process\n| a | b |\n|---|---|\n| 1 | 2 |";
  assert.match(visibleFields(table, ["public-process"])[0].text, /\| 1 \| 2 \|/);
});

test("fieldKey slugs, truncates and returns null rather than a shared fallback", () => {
  assert.equal(fieldKey("Their process"), "their-process");
  assert.equal(fieldKey("Why candidates have been turned down"), "why-candidates-have-been-turned-down");
  assert.equal(fieldKey("  Spaced  &  punctuated!  "), "spaced-punctuated");

  // A heading with nothing sluggable in it has no name, and the answer is null rather than a
  // constant. The constant was `"section"`, which is a real key that four unrelated headings
  // could collide on — see the aliasing test below for what that cost.
  assert.equal(fieldKey("***"), null);
  assert.equal(fieldKey(""), null);
  assert.equal(fieldKey(null), null);
  assert.equal(fieldKey("🎉"), null, "an emoji is neither a letter nor a number");

  const long = fieldKey("a".repeat(200));
  assert.equal(long.length, 80, "keys are capped so they stay keys");
  assert.doesNotMatch(long, /-$/, "and truncation never leaves a trailing dash");
});

test("fieldKey slugs over Unicode letters, not just ASCII", () => {
  // The ASCII-only class stripped these to nothing and every one of them became "section".
  assert.equal(fieldKey("Процесс"), "процесс");
  assert.equal(fieldKey("Зарплата"), "зарплата");
  assert.equal(fieldKey("面接プロセス"), "面接プロセス");
  // And it silently mangled Latin script that happened to carry a diacritic.
  assert.equal(fieldKey("Übersicht"), "übersicht", "not `bersicht`");
  assert.equal(fieldKey("Café"), "café", "not `caf`");
});

test("fieldKey normalises to NFC, so the same heading keys the same from any keyboard", () => {
  // "Café" with a precomposed é (U+00E9) and with e + combining acute (U+0065 U+0301) look
  // identical in the textarea. Without normalisation the second keys as `cafe` — a different
  // permission for a heading the recruiter cannot tell apart.
  const composed = "Café";
  const decomposed = "Café";
  assert.notEqual(composed, decomposed, "the fixture is only meaningful if these differ");
  assert.equal(fieldKey(composed), fieldKey(decomposed));
});

test("distinct headings never share a key — the property a permission transfer needs broken", () => {
  // THE REGRESSION THIS FILE EXISTS FOR. Duplicates WITHIN one note were tested thoroughly;
  // distinct headings colliding ACROSS saves was not, and that is the gap a rename-transfer
  // leak walked through: `## Процесс` and `## Зарплата` both keyed as "section", so replacing
  // the first with the second left the stored permission matching the new heading. The prune
  // saw the key as still present, issued no DELETE, and a section about the client paying
  // under market was shared with nobody having ticked it.
  const distinct = [
    "Their process",
    "Процесс",
    "Зарплата",
    "面接プロセス",
    "Section",
    "Übersicht",
    "Café",
    "Practical",
  ];
  for (let i = 0; i < distinct.length; i += 1) {
    for (let j = i + 1; j < distinct.length; j += 1) {
      assert.notEqual(
        fieldKey(distinct[i]),
        fieldKey(distinct[j]),
        `"${distinct[i]}" and "${distinct[j]}" share a key. A permission stored under one ` +
          `transfers to the other on a rename, and the prune cannot see it happen.`,
      );
    }
  }
});

test("a heading with no sluggable characters is unflaggable, not shared under a fallback", () => {
  const note = "## 🎉\n\nThey pay under market.";
  const [field] = parseNoteFields(note);
  assert.equal(field.key, null, "no key means no checkbox and no way to tick it");
  assert.equal(field.heading, "🎉", "it is still listed — the recruiter can see it in the note");
  assert.deepEqual(visibleFields(note, ["section"]), [], "the old fallback key shares nothing");
  assert.deepEqual(visibleFields(note, [null]), [], "and neither does null itself");
});

test("a heading longer than the key cap still round-trips through visibleFields", () => {
  const heading = `Why candidates ${"and hiring managers ".repeat(8)}have been turned down`;
  const note = `## ${heading}\n\nGovernance blocked it.`;
  const [field] = parseNoteFields(note);
  assert.equal(field.heading, heading, "the heading itself is never truncated, only the key");
  assert.equal(field.key.length, 80);
  assert.deepEqual(visibleFields(note, [field.key]).map((f) => f.heading), [heading]);
});

test("two punctuation-only headings are both unflaggable, and share no key to collide on", () => {
  // Each is independently unsluggable, so each is null on its own account — they no longer
  // meet on a fallback string first. The outcome is the same and the reason is better: there
  // is no key here for a permission to be stored under at all.
  const note = "## ***\n\nfirst\n\n## ---\n\nsecond";
  assert.deepEqual(keysOf(note), [null, null]);
  assert.deepEqual(visibleFields(note, ["section"]), []);
  assert.deepEqual(visibleFields(note, ["", "-", "null"]), []);
});

test("headings that differ only by case are duplicates, because the list cannot tell them apart", () => {
  const note = "## Their process\n\nfirst\n\n## Their Process\n\nsecond";
  assert.deepEqual(keysOf(note), [null, null]);
  assert.deepEqual(visibleFields(note, ["their-process"]), []);
});

test("CRLF input yields the same keys and the same bodies as LF", () => {
  // A note pasted out of Word. Without the \r?\n split every slug gains a trailing dash and
  // matches no stored key — the permissions would silently stop applying.
  const lf = parseNoteFields(REAL_NOTE);
  const crlf = parseNoteFields(REAL_NOTE.replace(/\n/g, "\r\n"));
  assert.deepEqual(crlf.map((f) => f.key), lf.map((f) => f.key));
  assert.deepEqual(crlf.map((f) => f.heading), lf.map((f) => f.heading));
  assert.deepEqual(
    crlf.map((f) => f.text.replace(/\r/g, "")),
    lf.map((f) => f.text),
  );
});

test("a heading on the very last line is a field with an empty body", () => {
  const fields = parseNoteFields("## Their process\n\nTwo stages.\n## Practical");
  assert.equal(fields.length, 2);
  assert.equal(fields[1].heading, "Practical");
  assert.equal(fields[1].text, "");
  assert.equal(fields[1].chars, 0);
});

test("visibleFields keeps the note's order and the full field shape #19 reads", () => {
  // #19 (candidate-brief generation) consumes `level` and `text` off these objects and keys
  // its PanelBrief citations on `key`. Dropping either from the return shape breaks it.
  const kept = visibleFields(REAL_NOTE, ["practical", "their-process"]);
  assert.deepEqual(kept.map((f) => f.key), ["their-process", "practical"], "note order, not key order");
  for (const field of kept) {
    assert.deepEqual(Object.keys(field).sort(), ["chars", "heading", "key", "level", "text"]);
    assert.equal(typeof field.text, "string");
    assert.equal(typeof field.level, "number");
  }
});

test("visibleFields accepts a Set as readily as an array", () => {
  const asArray = visibleFields(REAL_NOTE, ["practical"]);
  const asSet = visibleFields(REAL_NOTE, new Set(["practical"]));
  assert.deepEqual(asSet, asArray);
});

test("the module never throws on content, however strange the note", () => {
  // A parser that threw would turn an odd heading into a 500 on the save path for the
  // product's compounding asset.
  for (const note of ["#", "###### ", "## \n## \n", " ## x", "```\n# fenced\n```", 42, {}]) {
    assert.doesNotThrow(() => parseNoteFields(note), `parseNoteFields threw on ${JSON.stringify(note)}`);
    assert.doesNotThrow(() => visibleFields(note, ["x"]), `visibleFields threw on ${JSON.stringify(note)}`);
  }
  // Documented, not solved: a heading inside a fence becomes a field. It is fail-closed —
  // it arrives unticked — so it leaks nothing, and real notes are prose.
  assert.deepEqual(keysOf("```\n# fenced\n```"), ["fenced"]);
});
