// The candidate prep-brief contract (#19). Portal architecture §3: "The component vocabulary
// is the safety rail. There *is no* component that renders a finished answer in the candidate's
// voice, and no component that renders a score or rank. The locked rules stop being prompt
// instructions and become structural."
//
// That sentence is only true if the vocabulary is closed, so this file closes it twice. The
// schema pins each block's `name` to a `const`, which the decoder enforces at request time.
// `assertBrief` enforces the same vocabulary again on the way back in, because there is no
// JSON Schema validator in this repo (`node --test` with zero dependencies is a deliberate
// constraint) and a rule living only in the schema is an untested claim about a third party's
// decoder. Same argument `src/prompt.js:83-90` makes for why `assertPack` exists.
//
// Structured outputs reject recursive schemas and numeric/length constraints, and every object
// needs additionalProperties: false. `{name, props, children}` is a tree, so it is depth-limited
// by hand below: only CompetencyMap nests, and its children are StoryBankCard leaves.

/**
 * The closed vocabulary (decision 22). #21's registry builds one entry per name; a name outside
 * this list is a validation error, not a block that renders as nothing.
 */
export const BLOCK_NAMES = [
  "PrimerCard",
  "CompetencyMap",
  "PanelBrief",
  "StoryBankCard",
  "LogisticsRail",
  "FirstDayPrimer",
];

const str = (description) => ({ type: "string", description });
const strings = (description) => ({
  type: "array",
  description,
  items: { type: "string" },
});

/** One block variant: `name` pinned to a const, so the decoder cannot mint a sixth name. */
const block = (name, props, extra = {}) => ({
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string", const: name },
    props: { type: "object", additionalProperties: false, ...props },
    ...extra,
  },
  required: ["name", "props", ...Object.keys(extra)],
});

const properties = (props) => ({ properties: props, required: Object.keys(props) });

const StoryBankCard = block(
  "StoryBankCard",
  properties({
    prompt: str(
      "The situation to find a real story for, in one line. A prompt, not a question to answer here.",
    ),
    covers_competency_ids: strings(
      "The competency ids this one story can be told against. SPEC's memorisation rule: a small " +
        "set of real stories mapped to several competencies beats a scripted answer per question.",
    ),
    skeleton: strings(
      "HEADINGS THE CANDIDATE FILLS IN — never sentences in the candidate's voice, and never a " +
        "finished answer. Each entry names a part of the story they have to supply themselves " +
        '("What made escalation difficult"), and must not contain the answer to it. A polished ' +
        "answer the candidate cannot deliver is worse than a rough one they own, because " +
        "interviewers hear the seam.",
    ),
  }),
);

const BLOCKS = {
  PrimerCard: block(
    "PrimerCard",
    properties({
      role_shape: str("The shape of the role in two or three sentences. Landmarks before detail."),
      register: str("The register the brief implies — how a strong answer sounds here."),
      what_stage_one_tests: str(
        "What the first stage is actually testing. If the material does not say, say it does not say.",
      ),
    }),
  ),

  CompetencyMap: block(
    "CompetencyMap",
    properties({
      intro: str("One or two sentences introducing what this role keeps returning to."),
      competency_ids: strings("The ids of the competencies this map covers, in priority order."),
    }),
    {
      // The only nesting in the contract. A single $ref to a leaf def — not a cycle — because
      // structured outputs reject a $ref that resolves back to an ancestor.
      children: {
        type: "array",
        description: "StoryBankCard blocks grouped under this map.",
        items: { $ref: "#/$defs/StoryBankCard" },
      },
    },
  ),

  PanelBrief: block(
    "PanelBrief",
    properties({
      intro: str("One or two sentences on who the candidate is likely to meet."),
      panel: {
        type: "array",
        description:
          "Who is on the panel and what each is listening for. Everything here comes from the " +
          "client knowledge you were given — never from guesswork about the organisation.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            who: str("The person or role, as the client knowledge names them."),
            what_they_probe: str("What this person is listening for."),
            source_field_key: str(
              "The `key` attribute of the <field> in the client knowledge this came from, copied " +
                "exactly. A deterministic check runs after you: a key that was not in the input is " +
                "blanked and reported as unsourced.",
            ),
          },
          required: ["who", "what_they_probe", "source_field_key"],
        },
      },
    }),
  ),

  StoryBankCard,

  LogisticsRail: block(
    "LogisticsRail",
    properties({
      when: str("When and where, as far as the material says. Empty string if it does not."),
      format: str("The format of the stage, as far as the material says."),
      bring: str("What to have with them."),
      note: str("Anything else practical. Say plainly where the material is silent."),
    }),
  ),

  // #50: the locum booking's first-day surface. Same provenance mechanism as PanelBrief —
  // every item names the client-knowledge field it came from, and the same deterministic
  // check demotes an item whose key was not in the input.
  FirstDayPrimer: block(
    "FirstDayPrimer",
    properties({
      intro: str(
        "One or two sentences on what this covers. Where the material is silent, say so.",
      ),
      items: {
        type: "array",
        description:
          "The practical facts the candidate needs for day one, each from the client knowledge " +
          "you were given — never from guesswork about the organisation. Emit this block only " +
          "for a locum booking, and only when the client knowledge holds something practical.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            topic: str(
              'The practical subject, in the candidate\'s language — "Getting in", "Scanners ' +
                'and protocols", "PACS and RIS", "Who to report to".',
            ),
            detail: str("What the agency actually knows about this, plainly stated."),
            source_field_key: str(
              "The `key` attribute of the <field> in the client knowledge this came from, copied " +
                "exactly. A deterministic check runs after you: a key that was not in the input is " +
                "blanked and reported as unsourced.",
            ),
          },
          required: ["topic", "detail", "source_field_key"],
        },
      },
    }),
  ),
};

const competency = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: str("A stable slug for this competency, referenced by questions and blocks."),
    label: str("The competency in the candidate's language, not the JD's boilerplate."),
    source_quote: str(
      "A VERBATIM span copied character-for-character out of the CLIENT BRIEF. Do not paraphrase, " +
        "summarise, or tidy it, and do not quote the CV — competencies come from the brief and " +
        "only the brief. A deterministic check runs after you: it searches for your quote in the " +
        "brief. If it is not found literally, the competency is marked unverified and the " +
        "recruiter sees that it failed.",
    ),
    // enum, not minimum/maximum — numeric constraints are rejected by structured outputs.
    importance: {
      type: "integer",
      enum: [1, 2, 3, 4, 5],
      description:
        "How much weight the BRIEF puts on this competency, 1-5. This is about the role, never " +
        "about the candidate.",
    },
  },
  required: ["id", "label", "source_quote", "importance"],
};

const question = {
  type: "object",
  additionalProperties: false,
  properties: {
    competency_id: str("The id of the competency this question drills."),
    text: str("The question, as an interviewer would actually ask it."),
    // SPEC's full vocabulary is kept in the schema so #23's session engine writes lateral and
    // vertical rows into the same column. assertBrief permits only "core" on THIS call
    // (decision 6): variation is the session engine's job, on claude-sonnet-5.
    axis: {
      type: "string",
      enum: ["core", "lateral", "vertical"],
      description: 'Always "core" on this call. Variants are generated later, in session.',
    },
    difficulty: { type: "string", enum: ["gentle", "standard", "probing"] },
    // #50: what a question is FOR, orthogonal to axis/difficulty. Required in the schema so
    // fresh calls always carry it; assertBrief tolerates absence, because stored pre-#50
    // payloads re-assert on every brief read and must not start failing.
    type: {
      type: "string",
      enum: ["client", "competency", "screening"],
      description:
        '"client" = what THIS manager or client tends to probe, sourced from the client ' +
        'knowledge. "competency" = verify the candidate\'s experience — never teach it. ' +
        '"screening" = availability, rate, compliance logistics. Permanent-role briefs use ' +
        '"competency" throughout.',
    },
  },
  required: ["competency_id", "text", "axis", "difficulty", "type"],
};

export const BRIEF_SCHEMA = {
  type: "object",
  additionalProperties: false,
  $defs: { StoryBankCard },
  properties: {
    role_title: str("The role as the brief titles it."),
    blocks: {
      type: "array",
      description:
        "The prep brief, as blocks the portal renders. Use the vocabulary as it fits the material; " +
        "an empty block is worse than an absent one.",
      items: { anyOf: BLOCK_NAMES.map((name) => BLOCKS[name]) },
    },
    competencies: {
      type: "array",
      description:
        "The competencies the brief probes, each carrying its verbatim span of the brief. Extract " +
        "them from the brief; do not invent them.",
      items: competency,
    },
    questions: {
      type: "array",
      description: "The core question bank. At least one question per competency.",
      items: question,
    },
  },
  required: ["role_title", "blocks", "competencies", "questions"],
};

/**
 * Shape check for anything claiming to be a prep brief.
 *
 * This — not BRIEF_SCHEMA — is where #19's acceptance criteria are actually enforced, because
 * the schema's `const` and `enum` are enforced by Anthropic's decoder at request time where no
 * test can reach them. It throws a plain Error with a path-shaped message, in the register of
 * `assertPack`: a shape bug, not an HTTP outcome.
 *
 * `source_field_key` is deliberately NOT checked here. That is a provenance failure, and
 * provenance failures demote rather than throw (`provenance.js:62`) — a model that writes
 * `their-processes` for `their-process` must not kill a Send the recruiter is standing in front
 * of. It is checked in `src/prep/verify.js`.
 */
export function assertBrief(brief) {
  if (!brief || typeof brief !== "object") throw new Error("brief: not an object");
  if (typeof brief.role_title !== "string") throw new Error("brief: role_title must be a string");

  for (const field of ["blocks", "competencies", "questions"]) {
    if (!Array.isArray(brief[field])) throw new Error(`brief: ${field} must be an array`);
  }

  const ids = new Set();
  for (const [i, c] of brief.competencies.entries()) {
    if (typeof c?.id !== "string" || !c.id) throw new Error(`brief: competencies[${i}].id`);
    if (typeof c?.label !== "string") throw new Error(`brief: competencies[${i}].label`);
    // An empty quote is a competency with no provenance at all, which is the one thing the
    // brief half of architecture §3 rests on. AC #1.
    if (typeof c?.source_quote !== "string" || !c.source_quote.trim()) {
      throw new Error(`brief: competencies[${i}].source_quote is empty`);
    }
    // Uniqueness is a rule BRIEF_SCHEMA structurally cannot express, which is precisely the gap
    // this file's header says assertBrief exists to close. Two competencies sharing a slug reach
    // `competency.id TEXT PRIMARY KEY` through `${roleId}:${competency.id}`
    // (src/portal/store.js:195) and the second INSERT throws a raw ERR_SQLITE_ERROR — a `500
    // internal` DEPLOY.md reserves for "the migration did not run", after the recruiter has
    // already paid for the model call. It also makes the strike lie: `strikeCompetencies` filters
    // by id (src/prep/strike.js:33), so unticking one duplicate silently removes both.
    if (ids.has(c.id)) {
      throw new Error(`brief: competencies[${i}].id is ${c.id}, which is already taken`);
    }
    ids.add(c.id);
  }

  // A dangling id renders as a hole in #21's registry and there is nothing downstream to catch
  // it, so every reference to a competency is resolved here, wherever it appears.
  const resolve = (where, list) => {
    if (!Array.isArray(list)) throw new Error(`brief: ${where} must be an array`);
    for (const [i, id] of list.entries()) {
      if (!ids.has(id)) throw new Error(`brief: ${where}[${i}] is ${id}, which is no competency`);
    }
  };

  const checkBlock = (b, where, nested) => {
    if (!b || typeof b !== "object") throw new Error(`brief: ${where} is not an object`);
    if (!BLOCK_NAMES.includes(b.name)) {
      throw new Error(`brief: ${where}.name is ${b.name}, which is not in the vocabulary`);
    }
    // A child is a StoryBankCard leaf — `children.items` is a single $ref to that def and the
    // comment at :15 says so. This is the runtime half of that claim, and it has to sit HERE
    // rather than beside the nesting rule below: every other block carries no `children`, so a
    // nested PanelBrief returns at the "does not nest" branch and never reaches a later guard.
    if (nested && b.name !== "StoryBankCard") {
      throw new Error(
        `brief: ${where} is a ${b.name} nested inside children, where only StoryBankCard leaves live`,
      );
    }
    if (!b.props || typeof b.props !== "object") throw new Error(`brief: ${where}.props`);
    if (b.name === "CompetencyMap") {
      resolve(`${where}.props.competency_ids`, b.props.competency_ids);
    }
    if (b.name === "StoryBankCard") {
      resolve(`${where}.props.covers_competency_ids`, b.props.covers_competency_ids);
    }
    // Not props validation in general (that is the decoder's, and widening it here would be
    // scope): `verifyBrief` reaches the note half of §3 through this exact array, and skips the
    // check silently when it is not one. A skipped provenance check is the failure nobody sees.
    if (b.name === "PanelBrief" && !Array.isArray(b.props.panel)) {
      throw new Error(`brief: ${where}.props.panel must be an array`);
    }
    // The same reasoning for the primer half: verifyBrief reaches the note half of §3 through
    // this array too, and skips silently when it is not one.
    if (b.name === "FirstDayPrimer" && !Array.isArray(b.props.items)) {
      throw new Error(`brief: ${where}.props.items must be an array`);
    }
    // Only CompetencyMap nests, and only one level deep — the schema is non-recursive by
    // construction and this is the runtime half of that.
    if (b.name !== "CompetencyMap") {
      if (b.children !== undefined) {
        throw new Error(`brief: ${where}.children on a ${b.name}, which does not nest`);
      }
      return;
    }
    if (!Array.isArray(b.children)) throw new Error(`brief: ${where}.children must be an array`);
    for (const [i, child] of b.children.entries()) {
      checkBlock(child, `${where}.children[${i}]`, true);
    }
  };

  for (const [i, b] of brief.blocks.entries()) checkBlock(b, `blocks[${i}]`, false);

  const asked = new Set();
  for (const [i, q] of brief.questions.entries()) {
    if (typeof q?.text !== "string" || !q.text) throw new Error(`brief: questions[${i}].text`);
    if (!ids.has(q?.competency_id)) {
      throw new Error(
        `brief: questions[${i}].competency_id is ${q?.competency_id}, which is no competency`,
      );
    }
    // Decision 6: this call mints the CORE bank. lateral/vertical are #23's, on claude-sonnet-5.
    if (q.axis !== "core") {
      throw new Error(`brief: questions[${i}].axis is ${q.axis}; this call mints the core bank`);
    }
    if (!["gentle", "standard", "probing"].includes(q.difficulty)) {
      throw new Error(`brief: questions[${i}].difficulty is ${q.difficulty}`);
    }
    // #49's A3 rule, not axis's hard requirement: `type` arrived on a contract with live stored
    // payloads, so absence is tolerated and only a present-but-invalid value throws.
    if (q.type !== undefined && !["client", "competency", "screening"].includes(q.type)) {
      throw new Error(`brief: questions[${i}].type is ${q.type}`);
    }
    asked.add(q.competency_id);
  }

  // A competency with no questions passes every shape check and hands #23 something it cannot
  // drill. The bank is minted per competency or it is not minted.
  for (const [i, c] of brief.competencies.entries()) {
    if (!asked.has(c.id)) {
      throw new Error(`brief: competencies[${i}] (${c.id}) has no questions`);
    }
  }

  return brief;
}
