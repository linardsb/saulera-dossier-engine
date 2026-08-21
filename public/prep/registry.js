/* The candidate portal's component registry (#21).
 *
 * Decision 8's declarative blocks, rendered. #19 produces a validated `{name, props, children}`
 * payload over a closed vocabulary; this file is the other half of that contract — one
 * hand-built constructor per name, and a walker that looks each name up.
 *
 * This is the A2UI PATTERN and not the A2UI STACK (docs/epics/agentic-ui-research-notes.txt):
 * a JSON contract in, developer-owned components out, the frontend owning every pixel. No
 * framework, no library, no build step. The alternative — a model emitting markup — is the
 * open-ended generative UI those notes call out as a security and a brand problem.
 *
 * Portal architecture §3: "The component vocabulary is the safety rail. There *is no* component
 * that renders a finished answer in the candidate's voice, and no component that renders a score
 * or rank." That sentence is structural here rather than merely instructed: no such constructor
 * exists in REGISTRY, and a name that is not one of its keys renders nothing at all.
 *
 * AN ES MODULE, where public/app.js and public/extract.js are classic scripts wrapped in an IIFE
 * behind a global, and say so. The divergence buys exactly one thing: #21's acceptance criteria
 * assert this file's export surface, and an IIFE has no export surface to assert. A module script
 * needs no build step and no polyfill, and nothing else in public/ changes.
 *
 * ONE RULE IN THE WALKER: a block that cannot reach the screen is reported to the console and
 * skipped, and the rest of the page still renders. Three things trip it — a name REGISTRY does
 * not hold, a constructor that throws, and children handed to a constructor that does not take
 * them — and none of the three is allowed to happen in silence. Nesting, props and vocabulary
 * are `assertBrief`'s job and already ran server-side, so re-checking them here would duplicate
 * a schema this file cannot import (see BRIEF_BLOCK_NAMES). The throw-versus-warn split is
 * deliberate rather than inconsistent: a shape bug in front of a recruiter should stop a Send,
 * and the same bug in front of a candidate who can fix nothing should degrade the page rather
 * than blank it. src/prep/schema.js:212-224 and src/prep/verify.js:10-14 draw the same line from
 * the other side.
 *
 * Every constructor builds its own subtree with createElement and text nodes, never an
 * HTML-parsing assignment — public/app.js:869's rule, held for the same reason: this is model
 * output. No constructor touches the document outside the subtree it returns, none returns a
 * string, and none reads the document at module scope, which is what lets `node --test` import
 * this file with no DOM at all.
 */

/** The eight #19 emits (#50 added FirstDayPrimer; #79 added LikelyConcerns and QuestionsToAsk).
 *  Retyped rather than imported: `src/` is not
 *  served to the browser (Pages' build output is `public/`), so an import of
 *  ../../src/prep/schema.js would 404 at runtime. test/prep-registry.test.js imports BOTH and
 *  asserts they match, which is where the drift is actually caught —
 *  test/prep-schema.test.js:47-52 predicted this exact hole. */
export const BRIEF_BLOCK_NAMES = [
  "PrimerCard",
  "CompetencyMap",
  "PanelBrief",
  "StoryBankCard",
  "LogisticsRail",
  "FirstDayPrimer",
  "LikelyConcerns",
  "QuestionsToAsk",
];

/** The six the session emits (#23/#24/#25, #50 added LocumQuestions). No schema stands behind
 *  them; this file and test/fixtures/prep-session-blocks.json are the contract until one does. */
export const SESSION_BLOCK_NAMES = [
  "QuestionCard",
  "HelpLadder",
  "FeedbackNote",
  "ProgressStrip",
  "DayBeforeMode",
  "LocumQuestions",
];

/* ── copy ──────────────────────────────────────────────────────────────────────────────── */

/** Every visible string this file can produce, in one object — public/app.js:47's idiom, which
 *  is what makes the plain-language pass a single-file review. Block headings live here rather
 *  than in the payload on purpose: a heading the model writes is a heading nobody reviewed. */
const COPY = {
  primerHead: "What this role is really about",
  primerShape: "The shape of the role",
  primerRegister: "How a strong answer sounds here",
  primerTests: "What this first stage is testing",

  competencyHead: "What they keep coming back to",
  competencySourced: "From the client's brief",
  competencyUnverifiedMark: "Unverified",
  competencyUnverifiedNote:
    "This is our reading of the brief rather than a line from it. Worth preparing for. Do not " +
    "quote it back to them.",

  panelHead: "Who you are likely to meet",
  panelSourced: "From our notes on this client",
  panelUnverifiedMark: "Unverified",
  panelUnverifiedNote: "We could not tie this back to our notes. Treat it as our guess.",

  storyHead: "A story worth bringing",
  storyCovers: "Useful for",
  storySkeleton:
    "Headings for your own story. Work out what goes under each one before you go in.",

  logisticsHead: "The practical details",
  logisticsWhen: "When and where",
  logisticsFormat: "Format",
  logisticsBring: "Bring",
  logisticsNote: "Also worth knowing",
  logisticsSilent: "The material does not say. Ask when you confirm.",

  questionHead: "Your question",
  questionAbout: "About",
  questionDifficulty: "How hard we pitched it",

  helpHead: "If you get stuck",
  helpNudge: "A nudge",
  helpStructure: "A structure to follow",
  helpStructureNote: "Headings to answer around. The words stay yours.",

  feedbackHead: "About that answer",
  feedbackWorked: "What worked",
  feedbackImprove: "The one change to make",

  progressHead: "Where you have got to",
  progressCovered: "Covered so far",
  progressQueued: "Still to come",

  dayBeforeHead: "The day before",
  dayBeforeFocus: "Run through these",

  firstDayHead: "Your first day",

  locumQuestionsHead: "What you may be asked",
  locumClientHead: "What this manager tends to ask",
  locumCompetencyHead: "Expect to be asked about your experience",
  locumScreeningHead: "Have ready",
  locumConcernHead: "Where they may push back",

  concernsHead: "What they may push back on",
  concernsEvidence: "In your own words, from your CV",
  // The hardest sentence on this page to get right, and therefore one a person wrote and
  // reviewed once rather than one a model writes fresh per candidate (:67-69). A blank quote is
  // the ONLY way this block can say "nothing answers this" — there is no prose counter prop for
  // a model to fill — so this is the whole of what a candidate reads in that case.
  concernsNoMaterial:
    "Nothing in what you gave us answers this one. That is worth knowing before you go in. " +
    "The honest answer is usually better received than a stretched one.",

  askHead: "Questions worth asking them",
  askNote:
    "Raw material, not a script. Pick the one or two you actually want the answer to, and ask " +
    "them in your own words.",
};

/* ── shared helpers ────────────────────────────────────────────────────────────────────── */

/** A string, whatever arrived. Model output reaches every constructor below. */
function text(value) {
  return String(value === undefined || value === null ? "" : value);
}

/** Whitespace collapsed for DISPLAY only, exactly as public/app.js:835-837 does it. The stored
 *  quote keeps the brief's own line breaks, because the verifier matched against them. */
function displayQuote(value) {
  return text(value).replace(/\s+/g, " ").trim();
}

/** An element, with its text set when there is text to set. */
function el(doc, tag, className, content) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.appendChild(doc.createTextNode(text(content)));
  return node;
}

/**
 * A block's landmark: a `<section>` named by its own heading. A `<section>` earns the `region`
 * role only once it has an accessible name, which is what decision 21's "semantic landmarks"
 * means operationally, and `aria-labelledby` is what gives it one.
 *
 * `id` is generated by the walker as `block-<index>`, never a slug taken from model output —
 * a page renders many blocks and duplicate ids would point every label at the first heading.
 */
function section(doc, id, title) {
  const node = doc.createElement("section");
  node.className = "block";
  node.setAttribute("aria-labelledby", `${id}-head`);

  const head = el(doc, "h2", "block-head", title);
  head.setAttribute("id", `${id}-head`);
  node.appendChild(head);

  return { node, body: node };
}

/** The provenance mark: a WORD wearing a colour, never a colour alone. public/app.js:872-874. */
function mark(doc, word, cls) {
  return el(doc, "span", `mark ${cls}`, word);
}

/** A `<ul>` of plain text items. */
function lines(doc, items, className) {
  const list = el(doc, "ul", className);
  for (const item of Array.isArray(items) ? items : []) {
    list.appendChild(el(doc, "li", null, item));
  }
  return list;
}

/** A quiet labelled line: the label, then the value. */
function labelled(doc, label, value) {
  const wrap = el(doc, "p", "prep-field");
  wrap.appendChild(el(doc, "span", "prep-label", label));
  wrap.appendChild(doc.createTextNode(text(value)));
  return wrap;
}

/* ── provenance ────────────────────────────────────────────────────────────────────────── */

/**
 * How a competency's source renders to a CANDIDATE.
 *
 * Verified shows the quote. Unverified shows the word and a plain line saying what that means —
 * and never `failed_quote`. That is the one place this screen deliberately shows less than the
 * recruiter's: public/app.js:894-899 prints "Not found in the source" because a recruiter's next
 * move is to go and check it. A candidate's next move after reading a quote is to prepare
 * against it, so printing a sentence the model invented would hand them our mistake to carry
 * into the room. The mark still tells them the claim is our reading. The diagnostic is not lost;
 * it stays in the stored payload where #22's send gate and the recruiter's preview both reach it.
 *
 * `verified` absent means the payload never went through verifyBrief, so it is treated as
 * unverified. Fail closed: an unchecked claim and a failed one are the same thing to a candidate.
 */
function provenanceNode(doc, competency) {
  if (competency && competency.verified === true) {
    // Its own container rather than `.claim-source` alone: a brief's line can be long and
    // unbreakable, and CRAFT wants wide content scrolling inside its own box rather than
    // widening the page. app.css owns how the quote itself looks; prep.css owns the box.
    const wrap = el(doc, "div", "prep-provenance");
    wrap.appendChild(el(doc, "p", "claim-source", `“${displayQuote(competency.source_quote)}”`));
    wrap.appendChild(el(doc, "p", "prep-caption", COPY.competencySourced));
    return wrap;
  }

  const wrap = el(doc, "div", "prep-provenance");
  wrap.appendChild(el(doc, "p", "prep-caption", COPY.competencyUnverifiedNote));
  return wrap;
}

/**
 * Whether a panel entry is our guess rather than the client's note, over
 * `{source_field_key, failed_field_key}`.
 *
 * ONE predicate, read by both the mark and the caption. Two copies of it disagreed on the
 * degenerate branch, and the caption's copy failed OPEN: an `entry &&` guard made a falsy entry
 * *sourced*, captioning a guess "From our notes on this client". Fail closed is the house rule
 * (provenanceNode:195) and one expression is how it stays true at both ends.
 *
 * There is deliberately no guard for a non-object entry. It throws, the walker's catch skips the
 * whole block, and the candidate sees no panel at all rather than a nameless row wearing an
 * Unverified mark — CompetencyMap:265-266 makes the same call about an empty row.
 */
function panelUnsourced(entry) {
  return "failed_field_key" in entry || !text(entry.source_field_key).trim();
}

/** How that renders. A sourced entry names where it came from in the candidate's words; the field
 *  key itself is an internal slug (#18's) and never reaches the screen. */
function panelSourceNode(doc, entry) {
  const copy = panelUnsourced(entry) ? COPY.panelUnverifiedNote : COPY.panelSourced;
  return el(doc, "p", "prep-caption", copy);
}

/* ── the six blocks #19 emits ──────────────────────────────────────────────────────────── */

/** Landmarks before detail, per SPEC's prime step: the shape of the role, the register a strong
 *  answer takes here, and what the first stage is actually testing. */
function PrimerCard(doc, props, ctx, id) {
  const { node, body } = section(doc, id, COPY.primerHead);
  body.appendChild(labelled(doc, COPY.primerShape, props.role_shape));
  body.appendChild(labelled(doc, COPY.primerRegister, props.register));
  body.appendChild(labelled(doc, COPY.primerTests, props.what_stage_one_tests));
  return node;
}

/**
 * The competencies this role keeps returning to, each beside the line of the brief it came from.
 *
 * IMPORTANCE RENDERS AS ORDER AND NOTHING ELSE. Every competency carries `importance: 1-5` and
 * schema.js:156-158 permits it because it is about the role and never about the candidate — but
 * a numeral, a bar or a row of stars on a candidate's first screen reads as a score whatever it
 * measures. schema.js:86 already documents `competency_ids` as arriving "in priority order", so
 * the ordering carries that weight for free and no numeral is rendered.
 */
function CompetencyMap(doc, props, ctx, id) {
  const { node, body } = section(doc, id, COPY.competencyHead);
  body.appendChild(el(doc, "p", "prep-lede", props.intro));

  for (const competencyId of Array.isArray(props.competency_ids) ? props.competency_ids : []) {
    const competency = ctx.competencies.get(competencyId);
    if (!competency) {
      // Same policy as an unknown block name, not a second one: report it and render nothing.
      // An empty row would tell the candidate there is a competency here and then not say what.
      ctx.unresolved.push(competencyId);
      console.warn(`prep registry: no competency named ${competencyId}; skipped`);
      continue;
    }

    const entry = el(doc, "div", "claim prep-entry");
    const head = el(doc, "div", "claim-head");
    head.appendChild(el(doc, "p", "claim-text", competency.label));

    if (competency.verified !== true) {
      entry.classList.add("claim-unverified");
      head.appendChild(mark(doc, COPY.competencyUnverifiedMark, "mark-unverified"));
    }

    entry.appendChild(head);
    entry.appendChild(provenanceNode(doc, competency));
    body.appendChild(entry);
  }

  // Through the same walker, so a StoryBankCard nested here is identical to one at the top level.
  ctx.render(ctx.children, body, id);
  return node;
}

/** Who the candidate is likely to meet and what each one listens for. Everything here came from
 *  the agency's own note on the client, through the candidate-visible slice #18 gates. */
function PanelBrief(doc, props, ctx, id) {
  const { node, body } = section(doc, id, COPY.panelHead);
  body.appendChild(el(doc, "p", "prep-lede", props.intro));

  for (const person of Array.isArray(props.panel) ? props.panel : []) {
    const unsourced = panelUnsourced(person);

    const entry = el(doc, "div", "claim prep-entry");
    if (unsourced) entry.classList.add("claim-unverified");

    const head = el(doc, "div", "claim-head");
    head.appendChild(el(doc, "p", "claim-text", person.who));
    if (unsourced) head.appendChild(mark(doc, COPY.panelUnverifiedMark, "mark-unverified"));

    entry.appendChild(head);
    entry.appendChild(el(doc, "p", "prep-body", person.what_they_probe));
    entry.appendChild(panelSourceNode(doc, person));
    body.appendChild(entry);
  }

  return node;
}

/**
 * One situation to find a real story for.
 *
 * `skeleton` is HEADINGS THE CANDIDATE FILLS IN, and the copy around it has to say so.
 * schema.js:61-66 spells out why: a polished answer a candidate cannot deliver is worse than a
 * rough one they own, because interviewers hear the seam. A payload can be perfectly clean and
 * this renderer can still break that rule, by framing the headings as "your answer".
 */
function StoryBankCard(doc, props, ctx, id) {
  const { node, body } = section(doc, id, COPY.storyHead);
  body.appendChild(el(doc, "p", "prep-lede", props.prompt));

  const labels = [];
  for (const competencyId of Array.isArray(props.covers_competency_ids)
    ? props.covers_competency_ids
    : []) {
    const competency = ctx.competencies.get(competencyId);
    if (!competency) {
      ctx.unresolved.push(competencyId);
      console.warn(`prep registry: no competency named ${competencyId}; skipped`);
      continue;
    }
    labels.push(text(competency.label));
  }
  if (labels.length) body.appendChild(labelled(doc, COPY.storyCovers, labels.join(", ")));

  body.appendChild(el(doc, "p", "prep-caption", COPY.storySkeleton));
  body.appendChild(lines(doc, props.skeleton, "prep-list"));
  return node;
}

/** When, where, what format, what to bring. An empty string means the material did not say, and
 *  that renders as the honest line rather than as a blank row a candidate has to interpret. */
function LogisticsRail(doc, props, ctx, id) {
  const { node, body } = section(doc, id, COPY.logisticsHead);
  const list = el(doc, "dl", "prep-dl");

  const rows = [
    [COPY.logisticsWhen, props.when],
    [COPY.logisticsFormat, props.format],
    [COPY.logisticsBring, props.bring],
    [COPY.logisticsNote, props.note],
  ];
  for (const [label, value] of rows) {
    list.appendChild(el(doc, "dt", null, label));
    const said = text(value).trim();
    list.appendChild(el(doc, "dd", said ? null : "prep-caption", said || COPY.logisticsSilent));
  }

  body.appendChild(list);
  return node;
}

/**
 * The locum candidate's day one (#50): what the agency knows that they can't — logistics,
 * kit, who to report to. Each item carries the same {source_field_key, failed_field_key}
 * provenance as a PanelBrief entry, and renders through the same predicate: the mark, the
 * caption, and never the internal slug — sourced and demoted alike.
 */
function FirstDayPrimer(doc, props, ctx, id) {
  const { node, body } = section(doc, id, COPY.firstDayHead);
  body.appendChild(el(doc, "p", "prep-lede", props.intro));

  for (const item of Array.isArray(props.items) ? props.items : []) {
    const unsourced = panelUnsourced(item);

    const entry = el(doc, "div", "claim prep-entry");
    if (unsourced) entry.classList.add("claim-unverified");

    const head = el(doc, "div", "claim-head");
    head.appendChild(el(doc, "p", "claim-text", item.topic));
    if (unsourced) head.appendChild(mark(doc, COPY.panelUnverifiedMark, "mark-unverified"));

    entry.appendChild(head);
    entry.appendChild(el(doc, "p", "prep-body", item.detail));
    entry.appendChild(panelSourceNode(doc, item));
    body.appendChild(entry);
  }

  return node;
}

/**
 * The objections this interviewer is likeliest to raise (#79), each with the line of the
 * candidate's OWN CV that answers it — or the honest sentence saying nothing does.
 *
 * NO MARK ON A CONCERN WITH NO MATERIAL. An "Unverified" pill here would read as the CONCERN
 * being doubtful, when the concern is real and it is the counter that is missing; that is the
 * opposite of what the page has to say. The sentence carries it instead.
 *
 * `failed_evidence_quote` is never printed — provenanceNode:195-202's rule, and it never
 * arrives either (projection.js blanks it). A demoted quote and an honest gap render
 * identically to a candidate, which is correct: in both cases their material holds nothing we
 * could stand up, and the difference is a diagnostic for us rather than news for them.
 */
function LikelyConcerns(doc, props, ctx, id) {
  const { node, body } = section(doc, id, COPY.concernsHead);
  body.appendChild(el(doc, "p", "prep-lede", props.intro));

  for (const item of Array.isArray(props.concerns) ? props.concerns : []) {
    const entry = el(doc, "div", "claim prep-entry");
    const head = el(doc, "div", "claim-head");
    head.appendChild(el(doc, "p", "claim-text", item.concern));
    entry.appendChild(head);

    const quote = text(item.evidence_quote).trim();
    if (quote) {
      const wrap = el(doc, "div", "prep-provenance");
      wrap.appendChild(el(doc, "p", "claim-source", `“${displayQuote(item.evidence_quote)}”`));
      wrap.appendChild(el(doc, "p", "prep-caption", COPY.concernsEvidence));
      entry.appendChild(wrap);
    } else {
      entry.appendChild(el(doc, "p", "prep-caption", COPY.concernsNoMaterial));
    }

    body.appendChild(entry);
  }

  return node;
}

/** Questions the candidate could ask, offered as raw material rather than a script (#79). No
 *  provenance: a question asserts nothing about the client, so there is nothing to stand up.
 *  schema.js's QuestionsToAsk comment carries the argument. */
function QuestionsToAsk(doc, props, ctx, id) {
  const { node, body } = section(doc, id, COPY.askHead);
  body.appendChild(el(doc, "p", "prep-lede", props.intro));
  body.appendChild(lines(doc, props.questions, "prep-list"));
  body.appendChild(el(doc, "p", "prep-caption", COPY.askNote));
  return node;
}

/* ── the six the session emits ─────────────────────────────────────────────────────────── */

/**
 * One question, as an interviewer would actually ask it.
 *
 * PROVISIONAL until #23 settles it. `difficulty` describes the QUESTION and never the candidate,
 * which is the whole reason it is safe to show at all (SPEC:99 forbids displaying a rank).
 * Amend test/fixtures/prep-session-blocks.json and this comment together, never one alone.
 */
function QuestionCard(doc, props, ctx, id) {
  const { node, body } = section(doc, id, COPY.questionHead);
  body.appendChild(el(doc, "p", "prep-lede", props.question));
  if (text(props.competency_label).trim()) {
    body.appendChild(labelled(doc, COPY.questionAbout, props.competency_label));
  }
  if (text(props.difficulty).trim()) {
    body.appendChild(labelled(doc, COPY.questionDifficulty, props.difficulty));
  }
  return node;
}

/**
 * The help ladder's upper two rungs. The first rung is the attempt itself and has no control.
 *
 * PROVISIONAL until #23 settles it. `structure` is an array of HEADINGS, exactly like
 * StoryBankCard.skeleton — SPEC:74-75 calls the reveal "a model structure, still not their
 * answer", and an array of headings is a shape that cannot hold a finished answer even if a
 * later prompt tries to put one there. Amend test/fixtures/prep-session-blocks.json with it.
 *
 * Two native disclosures and nothing else. A `<button>` carrying `aria-expanded` is operable by
 * keyboard with no key handlers of our own, which is the entire reason to use one. This
 * component persists nothing: `onRung` is called and the caller decides. Logging the rung
 * (`mode: recall|nudged|revealed`) is #23's.
 */
function HelpLadder(doc, props, ctx, id) {
  const { node, body } = section(doc, id, COPY.helpHead);

  const rung = (rungId, label, rungName, fill) => {
    const wrap = el(doc, "div", "help-rung");

    const button = el(doc, "button", "btn help-rung-toggle", label);
    button.setAttribute("type", "button");
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-controls", rungId);

    const panel = el(doc, "div", "help-panel");
    panel.setAttribute("id", rungId);
    // The property, not the attribute, matching clients.js. app.css:441-445 records the trap on
    // the other side: give this panel a `display` of its own in prep.css and the author rule
    // beats the user agent's, so the panel never hides.
    panel.hidden = true;
    fill(panel);

    // The rung's state lives here rather than being read back off the attribute: one place holds
    // it, and the two things that must agree — what assistive technology is told, and whether the
    // panel is hidden — are written from it together.
    let open = false;
    button.addEventListener("click", () => {
      open = !open;
      button.setAttribute("aria-expanded", open ? "true" : "false");
      panel.hidden = !open;
      // Only on the way open: reaching a rung is what the caller records, and closing a panel
      // again is not a third rung.
      if (open && typeof ctx.onRung === "function") ctx.onRung(rungName);
    });

    wrap.appendChild(button);
    wrap.appendChild(panel);
    return wrap;
  };

  body.appendChild(
    rung(`${id}-nudge`, COPY.helpNudge, "nudged", (panel) => {
      panel.appendChild(el(doc, "p", "prep-body", props.nudge));
    }),
  );
  body.appendChild(
    rung(`${id}-structure`, COPY.helpStructure, "revealed", (panel) => {
      panel.appendChild(el(doc, "p", "prep-caption", COPY.helpStructureNote));
      panel.appendChild(lines(doc, props.structure, "prep-list"));
    }),
  );

  return node;
}

/**
 * What worked, and the single change that would most improve the answer.
 *
 * PROVISIONAL until #23 settles it. SINGULAR BY CONSTRUCTION: SPEC:76-77 asks for one
 * improvement and not five, and an array here would structurally permit what the spec forbids.
 * A sixth field, or a plural one, is an amendment to the plan and to
 * test/fixtures/prep-session-blocks.json rather than an edit here.
 */
function FeedbackNote(doc, props, ctx, id) {
  const { node, body } = section(doc, id, COPY.feedbackHead);
  body.appendChild(labelled(doc, COPY.feedbackWorked, props.worked));
  body.appendChild(labelled(doc, COPY.feedbackImprove, props.improve));
  return node;
}

/**
 * Movement, never a level.
 *
 * PROVISIONAL until #23 settles it. SPEC:186 sanctions "competencies covered" as real progress;
 * SPEC:99 and architecture §3 forbid showing a rank. So this renders two lists of competency
 * names and one line of prose. No percentage, no meter, no "N of M", and deliberately no
 * progressbar role — reaching for one to satisfy "semantic landmarks" would expose a numeric
 * rank to assistive technology, which is the same rule broken somewhere a visual review cannot
 * see it. Amend test/fixtures/prep-session-blocks.json alongside this.
 */
function ProgressStrip(doc, props, ctx, id) {
  const { node, body } = section(doc, id, COPY.progressHead);
  if (Array.isArray(props.covered) && props.covered.length) {
    body.appendChild(el(doc, "p", "prep-label", COPY.progressCovered));
    body.appendChild(lines(doc, props.covered, "prep-list"));
  }
  if (Array.isArray(props.queued) && props.queued.length) {
    body.appendChild(el(doc, "p", "prep-label", COPY.progressQueued));
    body.appendChild(lines(doc, props.queued, "prep-list"));
  }
  body.appendChild(el(doc, "p", "prep-body", props.note));
  return node;
}

/**
 * What to run through tomorrow, and the one practical line.
 *
 * PROVISIONAL until #25 settles it. #25 owns WHEN this appears — the day-before flow, its single
 * reminder (decision 17) and the session it opens. This block only renders from props. Amend
 * test/fixtures/prep-session-blocks.json with any change.
 */
function DayBeforeMode(doc, props, ctx, id) {
  const { node, body } = section(doc, id, COPY.dayBeforeHead);
  body.appendChild(el(doc, "p", "prep-lede", props.intro));
  if (Array.isArray(props.focus) && props.focus.length) {
    body.appendChild(el(doc, "p", "prep-label", COPY.dayBeforeFocus));
    body.appendChild(lines(doc, props.focus, "prep-list"));
  }
  body.appendChild(el(doc, "p", "prep-body", props.note));
  return node;
}

/**
 * The locum question mix (#50), grouped by what each question is FOR. Pure data already in the
 * brief payload — session.js groups `questions[]` by `type` and hands the three lists in as
 * props, the DayBeforeMode idiom. Headings come from COPY; a type slug never reaches the
 * screen. Empty groups render nothing at all.
 */
function LocumQuestions(doc, props, ctx, id) {
  const { node, body } = section(doc, id, COPY.locumQuestionsHead);

  const groups = [
    [COPY.locumClientHead, props.client],
    [COPY.locumCompetencyHead, props.competency],
    [COPY.locumScreeningHead, props.screening],
    [COPY.locumConcernHead, props.concern],
  ];
  for (const [label, items] of groups) {
    if (!Array.isArray(items) || !items.length) continue;
    body.appendChild(el(doc, "p", "prep-label", label));
    body.appendChild(lines(doc, items, "prep-list"));
  }

  return node;
}

/* ── the registry and the walker ───────────────────────────────────────────────────────── */

/**
 * The closed vocabulary, as constructors. Fourteen keys: decision 22's ten names, plus #50's
 * FirstDayPrimer and LocumQuestions, plus #79's LikelyConcerns and QuestionsToAsk.
 *
 * `Object.freeze` is a statement rather than a security boundary. What actually enforces
 * architecture §3 is the ABSENCE of a constructor that renders a finished answer or a score —
 * you cannot render what has no builder — and the test asserts this key set so that absence is
 * checked rather than claimed.
 */
export const REGISTRY = Object.freeze({
  PrimerCard,
  CompetencyMap,
  PanelBrief,
  StoryBankCard,
  LogisticsRail,
  QuestionCard,
  HelpLadder,
  FeedbackNote,
  ProgressStrip,
  DayBeforeMode,
  FirstDayPrimer,
  LocumQuestions,
  LikelyConcerns,
  QuestionsToAsk,
});

/**
 * Walk a `{name, props, children}` payload and mount it.
 *
 * Mirrors the traversal `assertBrief` already ran server-side (src/prep/schema.js:254-295), so
 * the two read as one system, and applies exactly one rule of its own: a block that cannot be
 * rendered — a name that is not in REGISTRY, or a constructor that throws on its props — is
 * reported to the console and skipped, and the walk carries on. Nothing is injected and no
 * placeholder is rendered in its place.
 *
 * @param payload  a stored brief: `{ blocks, competencies }`
 * @param mount    the element to render into; its previous contents are replaced
 * @param ctx      `{ doc, competencies, onRung, idPrefix }`, all optional. `idPrefix` seeds the
 *                 generated ids (`<prefix>-<index>`, default `"block"`): a caller that renders
 *                 into a page more than once — session.js appends a log entry per turn — passes
 *                 a fresh prefix each call, so no two renders ever mint the same id and every
 *                 `aria-labelledby` keeps pointing at its own heading.
 * @returns `{ rendered, skipped, unresolved }` — a count and the offending names, so the caller
 *          can show an honest empty state rather than a blank page. Children dropped by a
 *          constructor that does not nest are NOT in `skipped`: the parent rendered and still
 *          counts, so the caller has a page to show. The console is where that one lands.
 */
export function renderBlocks(payload, mount, ctx = {}) {
  const doc = ctx.doc ?? globalThis.document;

  const competencies =
    ctx.competencies instanceof Map
      ? ctx.competencies
      : new Map(
          ((payload && payload.competencies) || [])
            .filter((c) => c && typeof c.id === "string")
            .map((c) => [c.id, c]),
        );

  const skipped = [];
  const unresolved = [];
  let rendered = 0;

  /** Every block in `blocks`, appended to `parent`. `prefix` seeds the ids the landmarks use. */
  function render(blocks, parent, prefix) {
    for (const [index, block] of (Array.isArray(blocks) ? blocks : []).entries()) {
      const name = block && block.name;
      const build = Object.prototype.hasOwnProperty.call(REGISTRY, name)
        ? REGISTRY[name]
        : undefined;

      if (!build) {
        console.warn(`prep registry: no component named ${name}; skipped`);
        skipped.push(text(name));
        continue;
      }

      const id = `${prefix}-${index}`;
      const children = (block && block.children) || [];

      // A getter, so the walker learns whether the constructor TOOK its children without holding
      // a list of which names nest. That fact already lives in src/prep/schema.js:281-292 and in
      // CompetencyMap itself; a third copy here would be the one that rots, and it would make
      // this walker know names, which is the one thing it does not do.
      let tookChildren = false;
      const blockCtx = {
        competencies,
        onRung: ctx.onRung,
        get children() {
          tookChildren = true;
          return children;
        },
        unresolved,
        render,
      };

      try {
        parent.appendChild(build(doc, (block && block.props) || {}, blockCtx, id));
        rendered += 1;
      } catch (err) {
        // An unknown name and a malformed prop are the same event to a candidate, so they get the
        // same handling. `mount.textContent = ""` has already run and earlier blocks are already
        // on screen, so a throw escaping here would leave a half-rendered brief under the red
        // "we could not load your prep" line — two contradictory statements at once, which is
        // worse than either. src/prep/schema.js is what stops this reaching a recruiter's Send.
        console.warn(`prep registry: ${name} threw while rendering; skipped`, err);
        skipped.push(text(name));
        continue;
      }

      // Thirteen of the fourteen constructors take no children, and `assertBrief` rejects them there — but
      // only on the brief path. The session names (#23/#24/#25) have no schema behind them yet,
      // and a child that vanishes with no count, no warning and nothing in `skipped` is the exact
      // silence the rule above exists to prevent, arriving through a different door.
      if (!tookChildren && children.length) {
        console.warn(
          `prep registry: ${name} does not nest; ${children.length} child block(s) skipped`,
        );
      }
    }
  }

  // So a re-render replaces rather than appends.
  mount.textContent = "";
  render(payload && payload.blocks, mount, ctx.idPrefix ?? "block");

  return { rendered, skipped, unresolved };
}
