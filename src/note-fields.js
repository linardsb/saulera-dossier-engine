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

// The two heading shapes this parser does NOT name, and must therefore refuse to swallow.
//
// A markdown heading the parser cannot see does not vanish — it and everything under it ride
// inside the PREVIOUS section's body. Tick that previous section and the unnamed one is shared
// with it, under a name that says nothing about what it contains. That is the leaking
// direction, and it is the opposite of the fenced-code case documented above: a `#` inside a
// fence becomes a field that arrives unticked, which over-hides.
//
// So both are TERMINATORS. They close the current section without opening one, which puts
// their content in no field at all — it cannot be ticked, so it cannot be shared. Naming them
// properly is a bigger change than this gate needs; refusing to misattribute them is not.
//
// SETEXT: `Salary expectations` over `-------`. CommonMark requires the underline to follow
// paragraph content directly, so a blank line before `---` makes it a thematic break and no
// terminator — which is why the caller checks the preceding line rather than this alone.
const SETEXT_UNDERLINE = /^ {0,3}(?:=+|-+)[ \t]*$/;

// INDENTED ATX: 1-3 spaces still make a heading in CommonMark, but `HEADING` is anchored and
// would not match, so `   ## Salary` read as body text.
const INDENTED_HEADING = /^ {1,3}#{1,6}[ \t]+\S/;

/**
 * A heading's key: the stable name a permission is stored under.
 *
 * Lowercased and punctuation-collapsed so that what the recruiter sees in the list and what
 * D1 holds cannot drift apart over a capital letter.
 *
 * TWO PROPERTIES THIS FUNCTION MUST HAVE, both learned the hard way:
 *
 * 1. It slugs over UNICODE letters and numbers, not `[a-z0-9]`. An ASCII-only class strips
 *    every non-Latin script to nothing, so `## Процесс` and `## Зарплата` produced the SAME
 *    key. Rename the first to the second and the prune sees the key as still present, issues
 *    no DELETE, and a section nobody ticked is shared — the exact rename-transfer leak this
 *    module's header claims to have closed, arriving through a door the ASCII tests could not
 *    see. It also cost accuracy on Latin script: `Übersicht` keyed as `bersicht`, `Café` as
 *    `caf`.
 *
 * 2. It returns `null`, not a constant, when nothing survives. The old fallback was the string
 *    `"section"`, which is a REAL KEY: `## ***`, `## 🎉`, `## Процесс` and a literal
 *    `## Section` all collided on it. Returning null routes an unsluggable heading into the
 *    existing unflaggable path, which is the fail-closed answer the rest of this module
 *    already implements — it cannot be ticked, so it cannot be shared.
 *
 * `.normalize("NFC")` is load-bearing rather than decorative: without it `## Café` typed as
 * NFD (`e` + U+0301) keys as `cafe` while the NFC form keys as `café`, and the same visible
 * heading gets two keys depending on which keyboard typed it.
 *
 * Known and accepted: `.slice(0, KEY_MAX)` is its own collision class — two headings sharing
 * their first 80 slug characters get one key, and the transfer above becomes possible again.
 * Neither reviewer could construct a plausible pair (80 characters is a paragraph, not a
 * heading) so it is documented rather than solved. If it ever needs solving, the answer is a
 * short hash suffix on the truncated form, not a longer cap.
 *
 * @param {string} heading
 * @returns {string|null} the slug, or null if the heading has no sluggable characters
 */
export function fieldKey(heading) {
  const slug = String(heading ?? "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, KEY_MAX)
    .replace(/-+$/, ""); // the truncation itself can leave a trailing dash
  return slug || null;
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
    // A heading shape this parser cannot name closes the current section rather than joining
    // it. See SETEXT_UNDERLINE / INDENTED_HEADING above for why the direction matters.
    if (current) {
      const previous = current.lines[current.lines.length - 1];
      const isSetext =
        SETEXT_UNDERLINE.test(line) && previous !== undefined && previous.trim() !== "";
      if (isSetext) {
        // The line above the underline is the setext heading's TEXT, not the previous
        // section's body, so it goes too. Leave it behind and ticking `## Public process`
        // still emits the words "Salary expectations" as if they were part of it.
        current.lines.pop();
        current = null;
        continue;
      }
      if (INDENTED_HEADING.test(line)) {
        current = null;
        continue;
      }
    }

    if (current) current.lines.push(line); // before the first heading, `current` is null: dropped
  }

  // Two passes, because a slug's uniqueness is a property of the whole note and not of the
  // heading in front of you.
  //
  // `slugs` may contain nulls — a heading with no sluggable characters. A Map takes null as a
  // key, so the count works without a special case, and both outcomes land on `key: null`: one
  // such heading is "unique" and yields `slugs[i]`, which IS null, and two of them are
  // duplicates and yield null by the ternary. Unflaggable either way, which is the answer.
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

/**
 * The locum-supply vocabulary (#48, epic #45 slice 4). These are NAMES, not a schema: the
 * note stays one free-text blob and the recruiter still authors every heading. This list
 * exists so the editor can prompt for what locum supply needs recorded, and so #49/#50 can
 * find those sections again whatever exact words the recruiter chose.
 *
 * `heading` is the canonical form the editor inserts; each must survive `fieldKey` (a test
 * pins this). `match` runs against the HEADING TEXT, not the body — recognising a field from
 * its prose would be harvesting, which architecture §6.5 defers.
 *
 * Known and accepted: `portal` alone would also match "candidate portal", but this matcher
 * only ever sees note headings, which the recruiter writes about the client — so the broad
 * word buys synonym coverage ("Portal used") at no real cost. `\bVMS\b` stays word-bounded
 * so a heading merely containing those letters inside a word does not hit.
 */
export const LOCUM_FIELDS = [
  { id: "credentialing", heading: "Credentialing quirks",
    hint: "What this client's compliance sign-off trips over.",
    match: /credential|compliance quirk/i },
  { id: "vms",           heading: "VMS or portal",
    hint: "Which VMS or portal bookings go through, and its quirks.",
    match: /\bVMS\b|portal/i },
  { id: "protocols",     heading: "Protocol expectations",
    hint: "Scanning protocols the department expects a locum to know.",
    match: /protocol/i },
  { id: "site-access",   heading: "Site access and parking",
    hint: "Getting in on day one: badges, parking, who to ask for.",
    match: /site access|parking|getting in(to)?\b/i },
  { id: "extensions",    heading: "Extension habits",
    hint: "How this client extends or ends bookings.",
    match: /extension|extend(s|ing)?\b|rebook/i },
];

/** The canonical locum field a heading names, or null. Pure, never throws.
 *  A heading matching two regexes takes the first — list order is precedence. */
export function locumFieldFor(heading) {
  const text = String(heading ?? "");
  const hit = LOCUM_FIELDS.find((f) => f.match.test(text));
  return hit ? hit.id : null;
}
