// The candidate-visibility gate on the client-knowledge note (#18). Architecture
// docs/epics/candidate-portal.architecture.md decision 2: "per-field candidate-visible toggle
// on the client note, enforced in code (same move as provenance)".
//
// THE RULE, ADDRESSED TO WHOEVER WRITES THE NEXT CANDIDATE-FACING FEATURE (#19, #22):
// candidate-facing code calls `visibleFields(note, keys)`. It does not read `client.note`.
// The only place `.note` may appear in candidate-facing code is as this call's first argument.
// The reason is the direction a bug points: read the note directly and forgetting the filter
// leaks the agency's private read on a client to the person it is about — a note that records
// "Nov 2025: good community experience but was vague about documentation. Governance blocked
// it." Route through here and forgetting the second argument returns [], which hides a fact
// instead. A bug of omission must hide, never leak.
//
// This is the same enforcement move as src/provenance.js: the rule stops being a prompt
// instruction and becomes a function you have to go through. It is pure — no D1, no HTTP, no
// imports at all — so it is testable in `node --test` and importable from anywhere.
//
// The unit is the note's OWN markdown headings. .claude/plans/client-knowledge-store.md:54
// ("the note is one free-text blob… do not invent fields") still stands: the recruiter authors
// the structure, we only name it. Anything the recruiter did not put a heading on cannot be
// ticked, and therefore cannot be shared.
//
// Known and accepted: a `# heading` inside a ``` fence parses as a field. That is fail-closed
// (it arrives unticked, so it leaks nothing) and real notes are prose, so it is documented
// rather than solved.

/** How long a key may get. Long enough to stay readable, short enough to stay a key. */
const KEY_MAX = 80;

// ATX headings only. Capture 1 is the hashes (1-6, so `####### seven` is not a heading);
// capture 2 is the text. The `[ \t]+` after the hashes is what keeps `#hashtag` out. The
// trailing `#*` absorbs CommonMark's optional closing sequence (`## Practical ##`).
const HEADING = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/;

/**
 * A heading's key: the stable name a permission is stored under.
 *
 * Lowercased and punctuation-collapsed so that what the recruiter sees in the list and what
 * D1 holds cannot drift apart over a capital letter. A heading of pure punctuation slugs to
 * nothing and falls back to `section` — every field needs a name, and an empty string is not
 * one.
 *
 * @param {string} heading
 * @returns {string} the slug
 */
export function fieldKey(heading) {
  const slug = String(heading ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, KEY_MAX)
    .replace(/-+$/, ""); // the truncation itself can leave a trailing dash
  return slug || "section";
}

/**
 * Split a note into its heading-delimited fields.
 *
 * A field opens at a heading line and runs to the line before the next heading, or to the end
 * of the note. Text BEFORE the first heading is in no field: spike/inputs/client-note.md opens
 * with an h1 and a `**Client:** …` line, and a preamble has no name to tick, so it can never be
 * ticked and can never be shared. That is the fail-closed answer, not an omission.
 *
 * A heading whose slug is not unique within the note gets `key: null` and is not flaggable.
 * This is deliberately NOT the obvious answer, which is a positional `-2`/`-3` suffix — and
 * that one leaks. Tick `## Notes` (`notes`), add a second `## Notes` (`notes-2`), then delete
 * the first and save: the survivor now parses as `notes`, whose stored permission survives the
 * prune because that key still exists, and a section nobody ever ticked is shared. Neither the
 * prune nor the read-side intersect catches it, because both key on the string. So: no
 * positional keys anywhere, and the ambiguous key never exists to transfer. The duplicates are
 * still RETURNED — the recruiter can see them in the textarea, so the list has to explain why
 * they cannot be ticked rather than silently drop them.
 *
 * Note the collision is on the SLUG, so `## Their process` and `## Their Process` are
 * duplicates of each other. That is the right answer: they are indistinguishable to the
 * recruiter reading the list.
 *
 * It never throws. A note is whatever the agency typed, and a parser that threw would turn a
 * weird heading into a 500 on the save path for the product's compounding asset.
 *
 * @param {string} note
 * @returns {Array<{ key: string|null, heading: string, level: number, text: string, chars: number }>}
 */
export function parseNoteFields(note) {
  // Split on /\r?\n/, not /\n/: a note pasted out of Word arrives with CRLF, and a trailing
  // \r would ride into every heading and slug to `their-process-`, matching no stored key.
  const lines = String(note ?? "").split(/\r?\n/);

  const fields = [];
  let current = null;
  for (const line of lines) {
    const match = HEADING.exec(line);
    if (match) {
      current = { heading: match[2].trim(), level: match[1].length, lines: [] };
      fields.push(current);
      continue;
    }
    if (current) current.lines.push(line); // before the first heading, `current` is null: dropped
  }

  // Two passes, because a slug's uniqueness is a property of the whole note and not of the
  // heading in front of you.
  const slugs = fields.map((f) => fieldKey(f.heading));
  const seen = new Map();
  for (const slug of slugs) seen.set(slug, (seen.get(slug) ?? 0) + 1);

  return fields.map((field, i) => {
    const text = field.lines.join("\n");
    return {
      key: seen.get(slugs[i]) === 1 ? slugs[i] : null,
      heading: field.heading,
      level: field.level,
      text,
      chars: text.trim().length,
    };
  });
}

/**
 * The gate. The fields of `note` that the recruiter ticked, and nothing else.
 *
 * `visibleKeys` defaults to an empty array, so a caller that forgets the second argument gets
 * `[]` rather than the note — the whole point of the module in one line.
 *
 * It starts from the PARSED FIELDS and keeps the ones whose key was ticked. Never the other
 * direction: iterating `visibleKeys` and looking up a field would let a stored key whose
 * heading was renamed away come back the moment its old name is typed again. Starting from the
 * note means a key with no matching heading simply vanishes.
 *
 * Every field it returns has a non-null `key` — duplicate-headed sections are skipped, since
 * they are unflaggable by construction. #19 and #22 may therefore rely on `key` being present
 * and unique across the returned array.
 *
 * @param {string} note
 * @param {Iterable<string>} [visibleKeys] the keys stored in note_visibility for this client
 * @returns {Array<{ key: string, heading: string, level: number, text: string, chars: number }>}
 */
export function visibleFields(note, visibleKeys = []) {
  // Accept an array or a Set; normalise to a Set so a long allow-list does not turn this into
  // a quadratic scan.
  const allowed = visibleKeys instanceof Set ? visibleKeys : new Set(visibleKeys ?? []);
  return parseNoteFields(note).filter((field) => field.key !== null && allowed.has(field.key));
}
