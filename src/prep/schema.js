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
  "LikelyConcerns",
  "QuestionsToAsk",
];

/**
 * THE FIVE THIS CALL'S DECODER MAY BE ASKED FOR. Five, not eight, and the gap is a live bug's
 * scar tissue.
 *
 * READ THIS BEFORE ADDING A BLOCK VARIANT. `CALL_ONE_BLOCK_NAMES` is DERIVED below, so there is
 * no "here" to avoid: a name added to `BLOCK_NAMES` alone falls straight through the filter into
 * this call's `anyOf` as a SIXTH branch, which is the outage. Adding it to
 * `SECOND_CALL_BLOCK_NAMES` as well is what makes it safe — that is the list that subtracts.
 *
 * MEASURED 18 Aug 2026 against the live API, at the parameters this product actually sends:
 *
 *   five branches,  thinking: adaptive ....... OK
 *   SIX branches,   thinking: adaptive ....... 400 "The compiled grammar is too large"
 *   six branches,   thinking: disabled ....... OK
 *
 * `thinking: { type: "adaptive" }` LOWERS the structured-outputs grammar ceiling, and under it
 * the limit is five block variants. That is the whole mechanism, and it is worth stating twice
 * because the middle line was true in production for weeks: #50 added `FirstDayPrimer` as a
 * sixth branch (b4a06df) and every prep Send 400'd from that commit until this one. Nothing
 * caught it — the suite drives generateBrief with a fake client, so the request was asserted and
 * never sent. test/live/prep-schema-fits.test.js is the gate that would have, and it probes at
 * these parameters for exactly this reason. It is NOT in `npm test` — it costs a live request —
 * so after touching this file, run `ANTHROPIC_API_KEY=... npm run test:live`.
 *
 * `effort` does not move the ceiling. `thinking: {type: "enabled", budget_tokens: N}` is not an
 * escape hatch: Opus 5 rejects that parameter shape outright.
 *
 * So three of the eight names are minted by a SECOND, small call (CONCERNS_SCHEMA below) and
 * folded into `blocks` by generate.js before `assertBrief` runs — #79's two, plus
 * `FirstDayPrimer`, which is the right one to move because it is emitted for locum bookings
 * only and it is the branch that crossed the line. Everything from `assertBrief` onward — the
 * verifier, the strike, the projection, the registry — sees one ordinary payload and knows
 * nothing about the split.
 *
 * BLOCK_NAMES stays the whole vocabulary of eight, because the vocabulary is what the registry
 * and `assertBrief` close over. This list means something different: what one decoder can be
 * asked for in one request.
 */
const SECOND_CALL_BLOCK_NAMES = ["FirstDayPrimer", "LikelyConcerns", "QuestionsToAsk"];
const CALL_ONE_BLOCK_NAMES = BLOCK_NAMES.filter((n) => !SECOND_CALL_BLOCK_NAMES.includes(n));

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

  // #79: the objections an interviewer is likeliest to raise, and what in the candidate's own
  // record answers each one. There is deliberately NO prose "counter" prop — the evidence is a
  // verbatim span of the CV or it is the empty string, so the structure itself cannot hold a
  // fabricated answer to an objection. Rule 2 (never coach fabrication) made structural rather
  // than instructed, in the place where its failure would do the most damage.
  LikelyConcerns: block(
    "LikelyConcerns",
    properties({
      intro: str(
        "One or two sentences on what this covers: the objections this interviewer is most " +
          "likely to raise. Never a reassurance and never a prediction.",
      ),
      concerns: {
        type: "array",
        description:
          "The objections most likely to be raised, derived ONLY from the gap between the " +
          "CANDIDATE'S CV and the CLIENT BRIEF, plus the client knowledge you were given. " +
          "Never from anything else you believe about this employer.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            concern: str(
              "The objection as an interviewer would actually put it, in one sentence. An " +
                "objection about the record, never about the person.",
            ),
            competency_id: str(
              "The id of the competency this concern sits under. `concern_questions` must carry " +
                "a counter against this same id — a concern with nothing to drill is an " +
                "objection the candidate can only read.",
            ),
            evidence_quote: str(
              "A VERBATIM span copied character-for-character out of the CANDIDATE'S CV that " +
                "genuinely answers this concern — or the EMPTY STRING when their material holds " +
                "no genuine counter. Do not paraphrase, summarise or tidy it, and do not quote " +
                "the brief here. A deterministic check runs after you: a span not found " +
                "literally in the CV is blanked, and the page then says plainly that nothing in " +
                "their material answers this. Writing a counter of your own instead of leaving " +
                "this empty is coaching fabrication, which is the one thing you may never do.",
            ),
          },
          required: ["concern", "competency_id", "evidence_quote"],
        },
      },
    }),
  ),

  // #79: raw material for the candidate's own questions. No provenance, and the asymmetry is
  // argued rather than overlooked: PanelBrief and FirstDayPrimer carry source_field_key because
  // they make CLAIMS ABOUT THE CLIENT that a candidate would act on. A question asserts nothing
  // — it is theirs to ask and the interviewer's to answer.
  QuestionsToAsk: block(
    "QuestionsToAsk",
    properties({
      intro: str(
        "One or two sentences framing these as raw material to make their own, never a script.",
      ),
      questions: strings(
        "Questions the candidate could ask the interviewer, drawn from the brief and the client " +
          "knowledge you were given. Specific to THIS role and THIS client — a question that " +
          "would fit any employer is worth nothing. Never a question whose answer is already in " +
          "the brief, and never one that reveals what the agency told us privately.",
      ),
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
    //
    // THREE VALUES, NOT FOUR. `"concern"` is a counter to an objection, and objections live on
    // the second call — this decoder cannot emit a `LikelyConcerns` block to hang one on, so a
    // counter minted here is an orphan by construction. `foldConcerns` mints every counter, with
    // its `type` and its `difficulty` written in code where no prompt can drift them.
    // `assertBrief` still ACCEPTS `"concern"`, because that is what it is asserting.
    type: {
      type: "string",
      enum: ["client", "competency", "screening"],
      description:
        '"client" = what THIS manager or client tends to probe, sourced from the client ' +
        'knowledge. "competency" = verify the candidate\'s experience — never teach it. ' +
        '"screening" = availability, rate, compliance logistics.',
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
      // The five this call can be asked for — see CALL_ONE_BLOCK_NAMES for why it is not eight.
      items: { anyOf: CALL_ONE_BLOCK_NAMES.map((name) => BLOCKS[name]) },
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
 * The SECOND call: the three surfaces the first call's decoder has no room for — #79's likely
 * concerns and questions to ask, plus #50's first-day primer, which had to move here because a
 * sixth branch on the first call is a 400 (CALL_ONE_BLOCK_NAMES has the measurements).
 *
 * Small on purpose. It carries no block `name` and no nesting — `generate.js` wraps the answer
 * into `LikelyConcerns`, `QuestionsToAsk` and `FirstDayPrimer` blocks itself, so the names stay
 * pinned in code where a decoder cannot mint a ninth one, which is the same guarantee `const`
 * was buying and arguably a firmer one.
 *
 * `first_day_items` is REQUIRED here and expected to be empty for a permanent role. THE FOLD
 * DOES NOT ENFORCE THAT, and the distinction matters to anyone changing either half: the fold's
 * only rule is EMPTINESS — no block from an empty list — and it never reads `engagement`.
 * "Locum bookings only" is a prompt instruction (`concernsTaskBlock`'s branch), exactly as it
 * was before the move, and a model that filled the list for a permanent role would get its
 * block. Not a regression, and not a guarantee either; if it needs to become one, the fold is
 * where it goes, because that is the half a prompt cannot drift.
 *
 * Every item still carries its `source_field_key` and still demotes through the same check in
 * verify.js: the provenance mechanism is untouched by which call fetched the item.
 *
 * Every description is read off the block defs above rather than restated, so the prompt text
 * for a field lives in exactly one place whichever call carries it.
 *
 * `difficulty` is deliberately NOT a field here. Every concern question is minted `"probing"` by
 * generate.js, because a counter must not be the first question served on a competency: a
 * concern question reaches D1 with `axis` NULL, so `nextQuestion` treats it as core and serves
 * the EASIEST unattempted one first (src/prep/targeting.js:158-163). Marked "gentle" it would
 * open the drill with "how do you answer never having done this?" — to someone SPEC describes as
 * anxious and ready to close the tab. Leaving it off the schema is what makes that structural
 * rather than a prompt instruction nobody can enforce.
 */
const concernProps = BLOCKS.LikelyConcerns.properties.props.properties;
const asksProps = BLOCKS.QuestionsToAsk.properties.props.properties;
const primerProps = BLOCKS.FirstDayPrimer.properties.props.properties;

export const CONCERNS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    concerns_intro: concernProps.intro,
    concerns: concernProps.concerns,
    concern_questions: {
      type: "array",
      description:
        "One question per concern above, against the SAME competency_id — the counter, drilled " +
        "as an ordinary interview question. This is what makes a named objection something the " +
        "candidate can practise rather than something they only read.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          competency_id: str("The id of the competency this counter drills — the concern's own."),
          text: str("The question, as an interviewer would actually ask it."),
        },
        required: ["competency_id", "text"],
      },
    },
    questions_intro: asksProps.intro,
    questions_to_ask: asksProps.questions,
    first_day_intro: primerProps.intro,
    first_day_items: primerProps.items,
  },
  required: [
    "concerns_intro",
    "concerns",
    "concern_questions",
    "questions_intro",
    "questions_to_ask",
    "first_day_intro",
    "first_day_items",
  ],
};

/**
 * The second call's answer, folded into a first-call payload — the seam that makes the split
 * invisible from here on.
 *
 * Called BEFORE `assertBrief`, so the pairing rule below checks the folded result the same way
 * it would check a payload a single call had produced. Returns a new object; the parsed payloads
 * are not mutated, for `verify.js`'s reason.
 *
 * An absent or empty `concerns` folds NOTHING — no empty block, and no `QuestionsToAsk` either
 * if it has no questions. "An empty block is worse than an absent one" is the schema's own rule
 * (BRIEF_SCHEMA.properties.blocks) and it applies to a block we assemble ourselves.
 */
export function foldConcerns(brief, extra) {
  if (!extra || typeof extra !== "object") return brief;

  const blocks = [...(brief.blocks ?? [])];
  const questions = [...(brief.questions ?? [])];

  const concerns = Array.isArray(extra.concerns) ? extra.concerns : [];
  if (concerns.length) {
    blocks.push({
      name: "LikelyConcerns",
      props: { intro: String(extra.concerns_intro ?? ""), concerns },
    });
    // A COUNTER WITHOUT ITS CONCERN IS AN ORPHAN, and this is the only place the second call's
    // two lists can be checked against each other: `competency_id` is a free string on
    // CONCERNS_SCHEMA (structured outputs cannot express "an id from that other array"), and the
    // arrays cannot be length-paired either, because `minItems` is rejected too. So a
    // schema-valid answer can carry a counter for a competency it named no concern under.
    // Folded, that is a "probing" question the candidate drills against an objection the brief
    // never shows them. Dropped, they lose nothing they were ever told about.
    const named = new Set(concerns.map((c) => c?.competency_id));
    for (const q of Array.isArray(extra.concern_questions) ? extra.concern_questions : []) {
      if (!named.has(q?.competency_id)) continue;
      questions.push({
        competency_id: q?.competency_id,
        text: q?.text,
        axis: "core",
        // Minted here, never asked for — see CONCERNS_SCHEMA's note on why.
        difficulty: "probing",
        type: "concern",
      });
    }
  }

  const asks = Array.isArray(extra.questions_to_ask) ? extra.questions_to_ask : [];
  if (asks.length) {
    blocks.push({
      name: "QuestionsToAsk",
      props: { intro: String(extra.questions_intro ?? ""), questions: asks },
    });
  }

  // #50's primer, folded the same way. An empty list mints nothing, which is how "emit this
  // block only for a locum booking, and only when the client knowledge holds something
  // practical" stays true now that the schema asks for the field unconditionally.
  const items = Array.isArray(extra.first_day_items) ? extra.first_day_items : [];
  if (items.length) {
    blocks.push({
      name: "FirstDayPrimer",
      props: { intro: String(extra.first_day_intro ?? ""), items },
    });
  }

  return { ...brief, blocks, questions };
}

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
    // #79. Same reasoning again for the concerns: verifyBrief reaches the CV haystack through
    // this array, and skips silently when it is not one.
    if (b.name === "LikelyConcerns") {
      if (!Array.isArray(b.props.concerns)) {
        throw new Error(`brief: ${where}.props.concerns must be an array`);
      }
      // Every concern names a competency, resolved like every other reference in this file.
      resolve(
        `${where}.props.concerns`,
        b.props.concerns.map((c) => c?.competency_id),
      );
    }
    if (b.name === "QuestionsToAsk" && !Array.isArray(b.props.questions)) {
      throw new Error(`brief: ${where}.props.questions must be an array`);
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
    if (q.type !== undefined && !["client", "competency", "screening", "concern"].includes(q.type)) {
      throw new Error(`brief: questions[${i}].type is ${q.type}`);
    }
    // COUNTERS DO NOT COUNT. A `type:"concern"` question is minted by `foldConcerns`, always
    // `difficulty: "probing"`, and `nextQuestion` serves the EASIEST unattempted core question —
    // so a competency whose ONLY question is its own counter opens the drill with "how would you
    // answer, never having done this?". That is the exact regression test/prep-targeting.test.js
    // calls the one nothing else would catch, and the rule below is the only thing standing in
    // front of it: this check runs AFTER the fold, so call one's bank is never inspected alone.
    // Counting a counter here would let a first call that skipped a competency ship anyway.
    if (q.type !== "concern") asked.add(q.competency_id);
  }

  // A competency with no questions passes every shape check and hands #23 something it cannot
  // drill. The bank is minted per competency or it is not minted.
  for (const [i, c] of brief.competencies.entries()) {
    if (!asked.has(c.id)) {
      throw new Error(
        `brief: competencies[${i}] (${c.id}) has no questions of its own — a concern counter is ` +
          `not a question bank`,
      );
    }
  }

  // #79, and the same rule one level down: a concern the candidate cannot drill is a named
  // objection with nothing behind it. `type` is what tags a counter — the D1 question table is
  // type-free by decision (test/prep-send.test.js:279), so the tag rides brief_json and is
  // checked HERE or nowhere.
  //
  // TOP-LEVEL BLOCKS ONLY, and that is complete: neither new block nests, and the branch above
  // throws on `children` for anything but a CompetencyMap. `briefSummary`'s "TOP-LEVEL BLOCKS
  // ONLY" paragraph makes the same pairing from the other side.
  const concernDrilled = new Set(
    brief.questions.filter((q) => q.type === "concern").map((q) => q.competency_id),
  );
  const concernNamed = new Set();
  for (const [i, b] of brief.blocks.entries()) {
    if (b?.name !== "LikelyConcerns") continue;
    for (const [j, c] of b.props.concerns.entries()) {
      concernNamed.add(c.competency_id);
      if (!concernDrilled.has(c.competency_id)) {
        throw new Error(
          `brief: blocks[${i}].props.concerns[${j}] (${c.competency_id}) has no concern question`,
        );
      }
    }
  }

  // AND THE SAME RULE FROM THE OTHER SIDE. The loop above only catches a concern with nothing to
  // drill; the reverse — a counter whose objection appears nowhere in the brief — is a "probing"
  // question the candidate is asked to answer without ever being shown what it answers. That is
  // the worse half, because the pairing is what makes a named objection practisable rather than
  // just alarming.
  //
  // `foldConcerns` filters these at the mint and BRIEF_SCHEMA's `type` enum no longer offers the
  // value, so reaching here means a stored payload or a future minting path. Checked anyway: this
  // function is the contract, and the mint is only one of its callers.
  for (const [i, q] of brief.questions.entries()) {
    if (q.type === "concern" && !concernNamed.has(q.competency_id)) {
      throw new Error(
        `brief: questions[${i}] counters ${q.competency_id}, which no concern names`,
      );
    }
  }

  return brief;
}
