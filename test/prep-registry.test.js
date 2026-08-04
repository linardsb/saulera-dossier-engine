// #21 — the component vocabulary is a safety rail, and the renderer holds it.
//
// Portal architecture §3: "The component vocabulary is the safety rail. There *is no* component
// that renders a finished answer in the candidate's voice, and no component that renders a score
// or rank." #19's half of that is a schema. This half is a registry of ten constructors and a
// walker, and the sentence is only true if something fails when it stops being true.
//
// Eleven groups, in increasing order of how easily they rot:
//
//    1. the export surface — the ten names, reconciled against src/prep/schema.js
//    2. the source scans: nothing parses HTML, nothing reaches browser storage
//    3. the real stored payload renders, landmarks and all
//    4. the session specimens render
//    5. a block that cannot render — an unknown name, a throw, dropped children — degrades
//    6. provenance renders honestly, and a failed quote does not reach the candidate
//    7. nothing anywhere carries a rank
//    8. the help ladder's rungs are disclosures
//    9. the shipped fixture is derived from #19's own fixtures, not drawn by hand
//   10. prep.css keeps the custom-property discipline
//   11. the serializer's OWN coverage, because a tree it cannot reach is invisible to groups
//       3-7 rather than a failure of them — the lesson of test/schema.test.js:84-112.
//
// WHAT THIS FILE CANNOT CHECK, by design (plan R1): test/helpers/dom.js does not lay out, does
// not compute style, does not move focus and does not dispatch events. Visible focus, tab order
// and real keyboard operation are checked by hand in real Safari and real Chrome. A fake DOM
// stretched far enough to "prove" those would hand this ticket a green tick on the one criterion
// it cannot reach.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { BRIEF_BLOCK_NAMES, SESSION_BLOCK_NAMES, REGISTRY, renderBlocks } from "../public/prep/registry.js";
import { BLOCK_NAMES, assertBrief } from "../src/prep/schema.js";
import { verifyBrief } from "../src/prep/verify.js";
import { fakeDocument, serialize, textOf, findAll } from "./helpers/dom.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const BRIEF_MD = read("test/fixtures/prep-brief.md");
const FIELD_KEYS = JSON.parse(read("test/fixtures/prep-visible-fields.json")).map((f) => f.key);
const SOURCE_PAYLOAD = JSON.parse(read("test/fixtures/prep-payload.json"));
const STORED = JSON.parse(read("public/prep/brief.fixture.json"));
const SESSION_BLOCKS = JSON.parse(read("test/fixtures/prep-session-blocks.json"));

/** A deep copy per test, so a mutation case cannot leak into the next — prep-schema.test.js:28. */
const stored = () => structuredClone(STORED);
const sessionPayload = () => ({ blocks: structuredClone(SESSION_BLOCKS), competencies: [] });

/** Render a payload and hand back everything the assertions need. */
function render(payload, ctx = {}) {
  const doc = fakeDocument();
  const mount = doc.createElement("div");
  const result = renderBlocks(payload, mount, { doc, ...ctx });
  return { mount, result, html: serialize(mount) };
}

/**
 * Render with console.warn captured rather than printed.
 *
 * Two jobs at once: the skip policy IS a console warning, so it has to be asserted; and a suite
 * that prints warnings on its happy path trains the reader to ignore them.
 */
function renderCapturingWarnings(payload, ctx = {}) {
  const original = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(" "));
  try {
    return { ...render(payload, ctx), warnings };
  } finally {
    console.warn = original;
  }
}

/** Every block in a payload, nested children included. */
function countBlocks(blocks) {
  return (blocks ?? []).reduce((n, b) => n + 1 + countBlocks(b.children), 0);
}

/* ── group 1: the export surface ───────────────────────────────────────────────────────── */

test("REGISTRY is exactly decision 22's ten names plus #50's two", () => {
  // Written out literally rather than derived from the arrays above: this is the assertion that
  // catches a name being added to BOTH the array and the registry without a decision behind it.
  // #50 (epic #45, slice 3) extended the vocabulary deliberately: FirstDayPrimer on the brief
  // side, LocumQuestions on the session side. Twelve names.
  const DECIDED = [
    "PrimerCard",
    "CompetencyMap",
    "QuestionCard",
    "HelpLadder",
    "FeedbackNote",
    "ProgressStrip",
    "PanelBrief",
    "StoryBankCard",
    "LogisticsRail",
    "DayBeforeMode",
    "FirstDayPrimer",
    "LocumQuestions",
  ];
  assert.deepEqual(Object.keys(REGISTRY).sort(), [...DECIDED].sort());
});

test("the two exported name lists are the registry, with nothing over and nothing missing", () => {
  assert.deepEqual(
    [...BRIEF_BLOCK_NAMES, ...SESSION_BLOCK_NAMES].sort(),
    Object.keys(REGISTRY).sort(),
  );
  for (const name of [...BRIEF_BLOCK_NAMES, ...SESSION_BLOCK_NAMES]) {
    assert.equal(typeof REGISTRY[name], "function", `${name} has no constructor`);
  }
});

test("BRIEF_BLOCK_NAMES still equals the schema's BLOCK_NAMES", () => {
  // The drift test/prep-schema.test.js:47-52 predicted. registry.js cannot import the schema —
  // Pages serves public/ only, so the import would 404 in a browser — so the list is retyped
  // there and reconciled HERE, in the one place that can load both.
  assert.deepEqual(
    BRIEF_BLOCK_NAMES,
    BLOCK_NAMES,
    "the registry's brief-time names have drifted from src/prep/schema.js. A name the schema " +
      "emits and the registry does not hold renders as nothing at all.",
  );
});

test("no component is answer-shaped or score-shaped", () => {
  // The absence IS the mechanism: you cannot render what has no constructor. This asserts the
  // absence rather than trusting the ten names to speak for themselves.
  for (const name of Object.keys(REGISTRY)) {
    assert.doesNotMatch(
      name,
      /answer|score|rank|level|grade|rating/i,
      `${name} names something architecture §3 says has no component`,
    );
  }
});

test("importing the module under Node is itself the assertion", () => {
  // registry.js must touch no document at module scope, or `node --test` dies on import and
  // takes every group above and below with it. Keeping this as its own named test means the
  // failure says WHICH rule broke instead of arriving as a stack trace on the whole file.
  assert.equal(typeof renderBlocks, "function");
  assert.equal(typeof globalThis.document, "undefined", "this suite runs with no DOM, on purpose");
});

/* ── group 2: the source scans ─────────────────────────────────────────────────────────── */

/** Comments stripped before matching. The files under test describe these APIs in prose on
 *  purpose (public/app.js:19-21's convention), so a scan that read comments would be satisfiable
 *  by rewording one — and this repo has already dropped a Level 1 grep for exactly that. */
const withoutComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const REGISTRY_SOURCE = withoutComments(read("public/prep/registry.js"));
const BRIEF_SOURCE = withoutComments(read("public/prep/brief.js"));

test("nothing in the renderer parses HTML", () => {
  // The whole reason the vocabulary is closed. A constructor that assigned markup would let the
  // model reach the page directly, and the registry would stop being a rail at all.
  assert.doesNotMatch(
    REGISTRY_SOURCE,
    /innerHTML|outerHTML|insertAdjacentHTML|document\.write|createContextualFragment/,
    "model output reaches this file. It is built with createElement and text nodes only.",
  );
});

test("neither page file parses HTML", () => {
  assert.doesNotMatch(
    BRIEF_SOURCE,
    /innerHTML|outerHTML|insertAdjacentHTML|document\.write|createContextualFragment/,
  );
});

test("the dashboard writes nothing to browser storage", () => {
  // CHECKLIST's data-posture MUST, and public/app.js:15-22's first decision: transient has to
  // include the browser or the sentence is not true.
  for (const source of [REGISTRY_SOURCE, BRIEF_SOURCE]) {
    assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|document\.cookie/);
  }
});

test("the scans are reading something, not an empty string", () => {
  // A guard on the guard: a path typo would make every assertion above pass vacuously.
  assert.match(REGISTRY_SOURCE, /export const REGISTRY/);
  assert.match(BRIEF_SOURCE, /renderBlocks/);
});

/* ── group 3: the stored payload renders ───────────────────────────────────────────────── */

/** Which props are DISPLAY strings, per block. Deliberately not "every string in props":
 *  `source_field_key` is an internal slug that must not reach a candidate, and the
 *  `*_competency_ids` are resolved to labels rather than printed. Group 6 asserts that. */
const VISIBLE_PROPS = {
  PrimerCard: ["role_shape", "register", "what_stage_one_tests"],
  CompetencyMap: ["intro"],
  PanelBrief: ["intro"],
  StoryBankCard: ["prompt"],
  LogisticsRail: ["when", "format", "bring", "note"],
  QuestionCard: ["question", "competency_label", "difficulty"],
  HelpLadder: ["nudge"],
  FeedbackNote: ["worked", "improve"],
  ProgressStrip: ["note"],
  DayBeforeMode: ["intro", "note"],
  FirstDayPrimer: ["intro"],
  LocumQuestions: [],
};

/** The props that are arrays of display strings. */
const VISIBLE_LISTS = {
  StoryBankCard: ["skeleton"],
  HelpLadder: ["structure"],
  ProgressStrip: ["covered", "queued"],
  DayBeforeMode: ["focus"],
  LocumQuestions: ["client", "competency", "screening"],
};

/** Assert every visible string of every block in `blocks` reached `html`. */
function assertPropsRendered(blocks, html) {
  for (const block of blocks ?? []) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(VISIBLE_PROPS, block.name),
      `${block.name} has no entry in VISIBLE_PROPS, so this walk is not checking it`,
    );
    for (const key of VISIBLE_PROPS[block.name]) {
      const value = String(block.props[key] ?? "").trim();
      if (value) assert.ok(html.includes(value), `${block.name}.${key} did not render`);
    }
    for (const key of VISIBLE_LISTS[block.name] ?? []) {
      for (const item of block.props[key] ?? []) {
        assert.ok(html.includes(item), `${block.name}.${key} item did not render: ${item}`);
      }
    }
    assertPropsRendered(block.children, html);
  }
}

/** Every `<section>` is a named landmark whose label points at a heading that exists. */
function assertLandmarks(mount) {
  const ids = new Map();
  for (const node of findAll(mount, (n) => n.attrs.id !== undefined)) {
    assert.ok(!ids.has(node.attrs.id), `duplicate id ${node.attrs.id}: a label would point at the first`);
    ids.set(node.attrs.id, node);
  }

  const sections = findAll(mount, (n) => n.tag === "section");
  assert.ok(sections.length > 0, "nothing rendered a section");
  for (const node of sections) {
    const label = node.attrs["aria-labelledby"];
    assert.ok(label, "a <section> with no accessible name is not a region");
    const heading = ids.get(label);
    assert.ok(heading, `aria-labelledby=${label} points at no element`);
    assert.equal(heading.tag, "h2", `${label} is a ${heading.tag}, not a heading`);
    assert.ok(textOf(heading).trim(), `${label} is an empty heading`);
  }
  return sections;
}

test("the stored payload renders every block it carries", () => {
  const payload = stored();
  const { mount, result, html } = render(payload);

  assert.equal(result.rendered, countBlocks(payload.blocks));
  assert.deepEqual(result.skipped, []);
  assert.deepEqual(result.unresolved, []);
  assert.equal(assertLandmarks(mount).length, result.rendered);
  assertPropsRendered(payload.blocks, html);
});

test("every competency the map names renders under its label, not its id", () => {
  const payload = stored();
  const { html } = render(payload);
  for (const competency of payload.competencies) {
    assert.ok(html.includes(competency.label), `${competency.id} did not render its label`);
  }
});

test("a re-render replaces the page rather than appending to it", () => {
  const doc = fakeDocument();
  const mount = doc.createElement("div");
  renderBlocks(stored(), mount, { doc });
  const first = serialize(mount);
  renderBlocks(stored(), mount, { doc });
  assert.equal(serialize(mount), first);
});

/* ── group 4: the session specimens ────────────────────────────────────────────────────── */

test("the six session-time blocks render from their specimen props", () => {
  const payload = sessionPayload();
  const { mount, result, html } = render(payload);

  assert.equal(result.rendered, SESSION_BLOCKS.length);
  assert.deepEqual(result.skipped, []);
  assertLandmarks(mount);
  assertPropsRendered(payload.blocks, html);
});

test("the specimen fixture covers every session-time name", () => {
  // The artifact #23/#24/#25 inherit. A name with no specimen is a props contract nobody wrote
  // down, which is the whole failure this fixture exists to prevent.
  assert.deepEqual(SESSION_BLOCKS.map((b) => b.name).sort(), [...SESSION_BLOCK_NAMES].sort());
});

test("HelpLadder.structure is headings, never a finished answer", () => {
  // schema.js:61-66 makes this argument for StoryBankCard.skeleton, and SPEC:74-75 makes it for
  // the reveal rung: a model structure, still not their answer. A specimen that broke it would
  // teach #23 the wrong contract, and the fixture is the only thing #23 inherits.
  const ladder = SESSION_BLOCKS.find((b) => b.name === "HelpLadder");
  for (const heading of ladder.props.structure) {
    assert.doesNotMatch(heading, /^I /, `"${heading}" is written in the candidate's voice`);
    assert.doesNotMatch(heading, /\.\s*\S/, `"${heading}" is more than one heading`);
  }
});

/* ── group 5: a block that cannot render ───────────────────────────────────────────────── */

test("an unknown block name is skipped, reported, and leaves no trace", () => {
  const payload = stored();
  payload.blocks.splice(1, 0, { name: "ModelAnswerCard", props: { text: "a finished answer" } });

  const { result, html, warnings } = renderCapturingWarnings(payload);

  assert.deepEqual(result.skipped, ["ModelAnswerCard"]);
  assert.equal(result.rendered, countBlocks(payload.blocks) - 1);
  assert.ok(warnings.some((w) => w.includes("ModelAnswerCard")), "the skip was not reported");
  assert.ok(!html.includes("ModelAnswerCard"), "the unknown name reached the page");
  assert.ok(!html.includes("a finished answer"), "the unknown block's props reached the page");
});

test("an unknown name nested in children is skipped the same way", () => {
  const payload = stored();
  const map = payload.blocks.find((b) => b.name === "CompetencyMap");
  map.children.push({ name: "AnswerCard", props: { text: "a finished answer" } });

  const { result, html, warnings } = renderCapturingWarnings(payload);

  assert.deepEqual(result.skipped, ["AnswerCard"]);
  assert.ok(warnings.some((w) => w.includes("AnswerCard")));
  assert.ok(!html.includes("AnswerCard"));
  assert.ok(!html.includes("a finished answer"));
});

test("a block whose constructor throws is skipped rather than allowed to blank the page", () => {
  // registry.js:22-28's rule, reached by a malformed PROP rather than by an unknown name. A null
  // panel entry throws inside PanelBrief; before the walker's guard the throw escaped renderBlocks
  // entirely, and brief.js:79-82 then printed "We could not load your prep" underneath a page that
  // was already half-rendered — two contradictory statements on screen at once.
  const payload = stored();
  payload.blocks.find((b) => b.name === "PanelBrief").props.panel.push(null);

  const { result, mount, warnings } = renderCapturingWarnings(payload);

  assert.deepEqual(result.skipped, ["PanelBrief"]);
  assert.equal(result.rendered, countBlocks(payload.blocks) - 1);
  assert.ok(
    warnings.some((w) => w.includes("PanelBrief") && w.includes("threw")),
    "the throw was swallowed rather than reported",
  );
  // The degrade is one block wide. Everything either side of it is still on the page.
  assert.ok(textOf(mount).includes("What this role is really about"), "an earlier block was lost");
  assert.ok(textOf(mount).includes("The practical details"), "a later block never rendered");
  // And the block that threw left nothing behind: the constructor builds its subtree and the
  // walker appends it afterwards, so a throw means nothing was appended at all.
  assert.ok(!textOf(mount).includes("Who you are likely to meet"), "half a panel reached the page");
});

test("a child that throws degrades the child and leaves its parent standing", () => {
  // The granularity claim behind where that guard sits: inside the per-block loop, so a nested
  // block's throw is caught by its OWN iteration. `assertBrief` would reject this payload — a
  // PanelBrief does not nest — but the session path (#23/#24/#25) has no assertBrief in front of
  // it, and this walker is the contract those tickets inherit.
  const payload = {
    blocks: [
      {
        name: "CompetencyMap",
        props: { intro: "What they keep asking about", competency_ids: ["c1"] },
        children: [
          { name: "PanelBrief", props: { intro: "Who you will meet", panel: [null] } },
          { name: "StoryBankCard", props: { prompt: "A time you shipped late", skeleton: ["Situation"] } },
        ],
      },
    ],
    competencies: [
      { id: "c1", label: "Shipping under pressure", verified: true, source_quote: "ships on time" },
    ],
  };

  const { result, mount, warnings } = renderCapturingWarnings(payload);

  assert.deepEqual(result.skipped, ["PanelBrief"]);
  assert.equal(result.rendered, 2, "a bad child took its parent or its sibling down with it");
  assert.ok(warnings.some((w) => w.includes("PanelBrief") && w.includes("threw")));
  assert.ok(textOf(mount).includes("Shipping under pressure"), "the parent block did not render");
  assert.ok(textOf(mount).includes("A time you shipped late"), "the sibling child did not render");
});

test("exactly one constructor takes children, and the nine that do not say so out loud", () => {
  // Derived over the whole registry rather than asserted about CompetencyMap by name. Two things
  // this catches that a single warning check would not: a child dropped in silence by any of the
  // nine (no warning, no `skipped` entry, `rendered` still counting the parent — so brief.js:76's
  // empty state never fires either), and the day #23 makes a SECOND name nest without telling the
  // walker. The walker holds no list of names; this is where that stays honest.
  const consumers = [];

  for (const name of Object.keys(REGISTRY)) {
    const payload = {
      blocks: [
        {
          name,
          props: {},
          children: [{ name: "StoryBankCard", props: { prompt: "A nested story", skeleton: [] } }],
        },
      ],
      competencies: [],
    };
    const { html, warnings } = renderCapturingWarnings(payload);

    if (html.includes("A nested story")) consumers.push(name);
    else {
      assert.ok(
        warnings.some((w) => w.includes(name) && w.includes("does not nest")),
        `${name} dropped a child block in silence`,
      );
    }
  }

  assert.deepEqual(consumers, ["CompetencyMap"]);
});

test("a competency id that resolves to nothing is reported and renders no empty row", () => {
  const payload = stored();
  const map = payload.blocks.find((b) => b.name === "CompetencyMap");
  const before = render(payload).mount;
  const rows = findAll(before, (n) => n.classes.includes("prep-entry")).length;

  map.props.competency_ids.push("comp-does-not-exist");
  const { mount, result, warnings } = renderCapturingWarnings(payload);

  assert.deepEqual(result.unresolved, ["comp-does-not-exist"]);
  assert.ok(warnings.some((w) => w.includes("comp-does-not-exist")));
  assert.equal(
    findAll(mount, (n) => n.classes.includes("prep-entry")).length,
    rows,
    "a dangling id rendered a row with nothing in it",
  );
});

test("an empty blocks array renders nothing and says so in the return value", () => {
  const { result, mount } = render({ blocks: [], competencies: [] });
  assert.equal(result.rendered, 0);
  assert.deepEqual(result.skipped, []);
  assert.equal(serialize(mount), "<div></div>");
});

test("a block missing a prop renders without it rather than throwing", () => {
  const payload = { blocks: [{ name: "PrimerCard", props: {} }], competencies: [] };
  const { result, mount } = render(payload);
  assert.equal(result.rendered, 1);
  assert.ok(textOf(mount).includes("What this role is really about"));
});

test("LogisticsRail says the material was silent rather than leaving a blank row", () => {
  const payload = {
    blocks: [{ name: "LogisticsRail", props: { when: "", format: "Panel", bring: "", note: "" } }],
    competencies: [],
  };
  const { html } = render(payload);
  assert.ok(html.includes("The material does not say"), "an empty field rendered as a blank row");
  assert.ok(html.includes("Panel"));
});

/* ── group 6: provenance ───────────────────────────────────────────────────────────────── */

test("a verified competency shows the line of the brief it came from", () => {
  const payload = stored();
  const verified = payload.competencies.filter((c) => c.verified === true);
  assert.ok(verified.length, "the shipped fixture carries no verified competency to check");

  const { html } = render(payload);
  for (const competency of verified) {
    assert.ok(html.includes(competency.source_quote), `${competency.id}'s quote did not render`);
  }
  assert.ok(html.includes("From the client's brief"));
});

test("an unverified competency shows the WORD, and its failed quote never reaches the page", () => {
  // The one place this screen deliberately shows less than the recruiter's. app.js:894-899 prints
  // the failed quote because a recruiter's next move is to check it; a candidate's next move
  // would be to prepare against a sentence the model invented, and carry our mistake into the
  // room. The mark stays so they know the claim is our reading. The text does not.
  const payload = stored();
  const failed = payload.competencies.filter((c) => c.verified === false);
  assert.ok(failed.length, "the shipped fixture carries no unverified competency to check");

  const { mount, html } = render(payload);
  assert.ok(html.includes("mark-unverified"), "no unverified mark rendered");
  assert.ok(textOf(mount).includes("Unverified"), "the mark carries no word, only a colour");

  for (const competency of failed) {
    assert.ok(
      !html.includes(competency.failed_quote),
      `${competency.id}'s fabricated quote reached the candidate's screen`,
    );
  }
});

test("the mark is not hidden behind a disclosure", () => {
  // CHECKLIST MUST: unverified claims render visibly, never behind hover or a collapsed
  // disclosure. Nothing on the way from the mark up to the mount may be hidden.
  const { mount } = render(stored());
  const hiddenBranches = findAll(mount, (n) => n.hidden === true);
  for (const branch of hiddenBranches) {
    assert.ok(
      !serialize(branch).includes("mark-unverified"),
      "an unverified mark is inside a hidden panel",
    );
  }
});

test("a competency with no `verified` at all is treated as unverified", () => {
  // A payload that never went through verifyBrief. Fail closed: an unchecked claim and a failed
  // one are the same thing to a candidate. The shipped fixture cannot reach this branch, because
  // verifyBrief stamps every competency — so it is built by hand here.
  const payload = {
    blocks: [{ name: "CompetencyMap", props: { intro: "x", competency_ids: ["c1"] }, children: [] }],
    competencies: [{ id: "c1", label: "Never checked", source_quote: "a quote", importance: 3 }],
  };
  const { mount, html } = render(payload);
  assert.ok(html.includes("mark-unverified"), "an unchecked competency rendered as verified");
  assert.ok(!html.includes("a quote"), "an unchecked quote was shown as though it were sourced");
  assert.ok(textOf(mount).includes("Unverified"));
});

test("a panel entry whose field key failed shows the word and never the key", () => {
  // The other half of §3, and the other branch the shipped fixture cannot reach: the derivation
  // comes back panel_unsourced: 0, so this pair is built by hand.
  const payload = {
    blocks: [
      {
        name: "PanelBrief",
        props: {
          intro: "Who you will meet",
          panel: [
            { who: "Governance lead", what_they_probe: "Record-keeping", source_field_key: "their-process" },
            {
              who: "A guessed person",
              what_they_probe: "Something we invented",
              source_field_key: "",
              failed_field_key: "their-processes",
            },
          ],
        },
      },
    ],
    competencies: [],
  };
  const { mount, html } = render(payload);

  assert.ok(html.includes("mark-unverified"), "the demoted panel entry carries no mark");
  assert.ok(textOf(mount).includes("Unverified"));
  assert.ok(html.includes("From our notes on this client"), "the sourced entry names its source");
  // #18's slug is an internal key. A candidate has no use for it and no way to read it.
  assert.ok(!html.includes("their-process"), "an internal field key reached the candidate's screen");
});

test("the panel's mark and its caption cannot disagree about where an entry came from", () => {
  // ONE predicate behind both (registry.js:panelUnsourced). There were two, and they disagreed on
  // the degenerate branch: the caption's copy carried an `entry &&` guard and so failed OPEN,
  // captioning a guess "From our notes on this client" — a mark saying our guess and a caption
  // saying the client's note, on the same row. No input below changes behaviour today; what this
  // pins is that the two ends are computed from the same expression and cannot drift apart again.
  const payload = {
    blocks: [
      {
        name: "PanelBrief",
        props: {
          intro: "Who you will meet",
          panel: [
            { who: "Governance lead", what_they_probe: "Record-keeping", source_field_key: "their-process" },
            { who: "Whitespace key", what_they_probe: "How you decide", source_field_key: "   " },
            { who: "Missing key", what_they_probe: "How you plan", what_else: "" },
            {
              who: "Failed key",
              what_they_probe: "How you prioritise",
              source_field_key: "",
              failed_field_key: "their-processes",
            },
          ],
        },
      },
    ],
    competencies: [],
  };

  const { mount } = render(payload);
  const rows = findAll(mount, (n) => n.classes.includes("prep-entry"));
  assert.equal(rows.length, 4);

  for (const row of rows) {
    const marked = serialize(row).includes("mark-unverified");
    const sourced = textOf(row).includes("From our notes on this client");
    assert.equal(marked, !sourced, `${textOf(row)}: the mark and the caption tell different stories`);
  }

  // Not vacuous: one row is genuinely sourced and three are genuinely not.
  assert.equal(rows.filter((r) => serialize(r).includes("mark-unverified")).length, 3);
});

test("a FirstDayPrimer renders its items with the panel's own marks, sourced and demoted alike", () => {
  // #50: the primer rides the same {source_field_key, failed_field_key} provenance as the
  // panel, through the same single predicate — so the mark and the caption cannot disagree.
  const payload = {
    blocks: [
      {
        name: "FirstDayPrimer",
        props: {
          intro: "What we know that will help on day one.",
          items: [
            { topic: "Who to report to", detail: "The imaging services manager.", source_field_key: "their-process" },
            {
              topic: "Scanners and protocols",
              detail: "A fleet we could not tie back.",
              source_field_key: "",
              failed_field_key: "their-processes",
            },
          ],
        },
      },
    ],
    competencies: [],
  };
  const { mount, html } = render(payload);

  assert.ok(html.includes("Your first day"), "the COPY heading renders");
  assert.ok(html.includes("What we know that will help on day one."), "the intro renders");
  assert.ok(html.includes("Who to report to") && html.includes("The imaging services manager."));
  assert.ok(html.includes("A fleet we could not tie back."), "demoted items still render");
  assert.ok(html.includes("mark-unverified"), "the demoted item wears the mark");
  assert.ok(html.includes("From our notes on this client"), "the sourced item names its source");

  const rows = findAll(mount, (n) => n.classes.includes("prep-entry"));
  assert.equal(rows.length, 2);
  for (const row of rows) {
    const marked = serialize(row).includes("mark-unverified");
    const sourced = textOf(row).includes("From our notes on this client");
    assert.equal(marked, !sourced, `${textOf(row)}: the mark and the caption tell different stories`);
  }

  // #18's slug is internal, and the failed key doubly so — neither reaches the candidate.
  assert.ok(!html.includes("their-process"), "an internal field key reached the candidate's screen");
});

test("LocumQuestions renders its groups under COPY headings, skips empty ones, and prints no type slug", () => {
  const payload = {
    blocks: [
      {
        name: "LocumQuestions",
        props: {
          client: ["What the manager asks about start dates."],
          competency: [],
          screening: ["Documents where you can reach them."],
        },
      },
    ],
    competencies: [],
  };
  const { mount, html } = render(payload);

  assert.ok(html.includes("What this manager tends to ask"), "the client group heading renders");
  assert.ok(html.includes("Have ready"), "the screening group heading renders");
  assert.ok(
    !html.includes("Expect to be asked about your experience"),
    "an empty group renders no heading at all",
  );
  assert.ok(html.includes("What the manager asks about start dates."));
  assert.ok(html.includes("Documents where you can reach them."));

  // The slug is data plumbing; the heading is the candidate's language. "screening" appears in
  // no COPY string and no question above, so its absence is the assertion.
  assert.ok(!html.includes("screening"), "a raw type slug reached the page");
  const labels = findAll(mount, (n) => n.classes.includes("prep-label"));
  assert.equal(labels.length, 2, "exactly the two non-empty groups rendered labels");
});

test("no field key from the stored payload reaches the page either", () => {
  const payload = stored();
  const { html } = render(payload);
  for (const block of payload.blocks) {
    for (const person of block.props.panel ?? []) {
      if (person.source_field_key) {
        assert.ok(!html.includes(person.source_field_key), `${person.source_field_key} rendered`);
      }
    }
  }
});

/* ── group 7: nothing carries a rank ───────────────────────────────────────────────────── */

// Run over the WHOLE rendered output of both fixtures rather than over ProgressStrip alone.
// Two numeric fields could reach a candidate's screen and only one of them is obvious:
// ProgressStrip is the one a reviewer looks at, and `competency.importance` (1-5) is the one
// that would render as a score whatever it measures. schema.js:156-158 permits the field
// because it is about the role; SPEC:99 and architecture §3 forbid showing it as a level.
const RANK_PATTERNS = [
  [/aria-valuenow/i, "a numeric value exposed to assistive technology"],
  [/progressbar/i, "a progressbar role"],
  [/<progress/i, "a progress element"],
  [/%/, "a percentage"],
  [/level|of \d/i, "a level, or an N-of-M"],
  [/\b\d\s*\/\s*5\b/, "an importance numeral"],
];

for (const [label, payload] of [
  ["the stored brief", stored],
  ["the session specimens", sessionPayload],
]) {
  test(`nothing in ${label} renders a rank`, () => {
    const { html } = render(payload());
    for (const [pattern, why] of RANK_PATTERNS) {
      assert.doesNotMatch(html, pattern, `the rendered output carries ${why}`);
    }
  });
}

test("importance renders as order and never as a numeral", () => {
  // schema.js:86 documents competency_ids as arriving "in priority order", so the ordering
  // carries the weight and nothing has to print the number. This asserts both halves: the
  // numeral is absent, and the order the payload asked for is the order that rendered.
  const payload = stored();
  const map = payload.blocks.find((b) => b.name === "CompetencyMap");
  const { mount } = render(payload);

  const labels = findAll(mount, (n) => n.classes.includes("claim-text")).map((n) => textOf(n));
  const expected = map.props.competency_ids.map(
    (id) => payload.competencies.find((c) => c.id === id).label,
  );
  assert.deepEqual(labels.slice(0, expected.length), expected, "priority order did not survive");

  for (const competency of payload.competencies) {
    assert.ok(
      !serialize(mount).includes(`>${competency.importance}<`),
      `${competency.id}'s importance rendered as a numeral`,
    );
  }
});

/* ── group 8: the help ladder ──────────────────────────────────────────────────────────── */

test("the rungs are native disclosures that start closed", () => {
  const { mount } = render(sessionPayload());
  const buttons = findAll(mount, (n) => n.tag === "button");
  assert.equal(buttons.length, 2, "the ladder should expose exactly two rungs; the first is silent");

  for (const button of buttons) {
    assert.equal(button.attrs["aria-expanded"], "false");
    assert.equal(button.attrs.type, "button");
    assert.ok(button.attrs["aria-controls"], "a disclosure that controls nothing named");
    assert.ok(textOf(button).trim(), "a button with no label");
  }

  const panels = findAll(mount, (n) => n.classes.includes("help-panel"));
  assert.equal(panels.length, 2);
  for (const panel of panels) assert.equal(panel.hidden, true, "a rung started open");

  // Each button names a panel that exists.
  const ids = new Set(findAll(mount, (n) => n.attrs.id !== undefined).map((n) => n.attrs.id));
  for (const button of buttons) assert.ok(ids.has(button.attrs["aria-controls"]));
});

test("the reveal rung's structure renders as list items", () => {
  const { mount } = render(sessionPayload());
  const ladder = SESSION_BLOCKS.find((b) => b.name === "HelpLadder");
  const items = findAll(mount, (n) => n.tag === "li").map((n) => textOf(n));
  for (const heading of ladder.props.structure) {
    assert.ok(items.includes(heading), `"${heading}" did not render as its own item`);
  }
});

test("opening a rung toggles it and reports which rung was reached", () => {
  // The handler is invoked directly. test/helpers/dom.js records listeners and never dispatches,
  // so this asserts what the handler DOES — not that a click or a key would reach it. That is a
  // manual check, and the plan (R1) says so rather than faking it here.
  const reached = [];
  const { mount } = render(sessionPayload(), { onRung: (rung) => reached.push(rung) });

  const buttons = findAll(mount, (n) => n.tag === "button");
  const panels = findAll(mount, (n) => n.classes.includes("help-panel"));

  buttons[0].listeners.click[0]();
  assert.equal(buttons[0].attrs["aria-expanded"], "true");
  assert.equal(panels[0].hidden, false);
  assert.deepEqual(reached, ["nudged"]);

  buttons[1].listeners.click[0]();
  assert.equal(panels[1].hidden, false);
  assert.deepEqual(reached, ["nudged", "revealed"]);

  // Closing again is not a third rung.
  buttons[0].listeners.click[0]();
  assert.equal(buttons[0].attrs["aria-expanded"], "false");
  assert.equal(panels[0].hidden, true);
  assert.deepEqual(reached, ["nudged", "revealed"]);
});

test("a ladder with no onRung still toggles", () => {
  const { mount } = render(sessionPayload());
  const button = findAll(mount, (n) => n.tag === "button")[0];
  button.listeners.click[0]();
  assert.equal(button.attrs["aria-expanded"], "true");
});

/* ── group 9: the shipped fixture is derived, not drawn ────────────────────────────────── */

test("the shipped fixture is derived from #19's own fixtures, never drawn by hand", () => {
  // The demo page renders a payload the generator can actually produce, or it demonstrates
  // nothing. This fails the day either side drifts — which is worth stopping for in both
  // directions: a hand-edited fixture, or a change under src/prep/.
  const { payload } = verifyBrief(assertBrief(structuredClone(SOURCE_PAYLOAD)), {
    brief: BRIEF_MD,
    fieldKeys: FIELD_KEYS,
  });
  assert.deepEqual(STORED, payload);
  // Byte-identical too, so "derived by script, never by hand" covers the formatting as well.
  assert.equal(read("public/prep/brief.fixture.json"), `${JSON.stringify(payload, null, 2)}\n`);
});

test("the shipped fixture carries a demotion, and that is the point", () => {
  // The instinct is to ship a clean payload so the demo looks good. This one comes back
  // sourced: 2, unverified: 1, because comp-documentation's quote is a paraphrase — recorded as
  // deliberate at test/prep-verify.test.js:9. Shipping it is what makes CHECKLIST's "unverified
  // claims render visibly" true on evidence in the default state rather than on faith.
  const verified = STORED.competencies.filter((c) => c.verified === true).length;
  const unverified = STORED.competencies.filter((c) => c.verified === false).length;
  assert.equal(verified, 2);
  assert.equal(unverified, 1);
});

/* ── group 10: the stylesheet's discipline ─────────────────────────────────────────────── */

// Comments are stripped first. tokens.css:19-22 sets the house precedent of citing a measured
// hex value in prose while explaining a contrast decision, and prep.css is entitled to the same.
const PREP_CSS = read("public/prep/prep.css").replace(/\/\*[\s\S]*?\*\//g, "");

test("prep.css carries no raw colour and no raw size", () => {
  assert.doesNotMatch(PREP_CSS, /#[0-9a-fA-F]{3,8}\b/, "a raw hex belongs in tokens.css");
  // Media query breakpoints are px by nature and are not a component value; everything inside a
  // declaration resolves through a custom property.
  const declarations = PREP_CSS.replace(/@media[^{]*/g, "@media ");
  assert.doesNotMatch(declarations, /\d+px/, "a raw px belongs in tokens.css");
});

test("prep.css does not fight app.css's one focus rule, and animates only behind reduced-motion", () => {
  assert.doesNotMatch(PREP_CSS, /outline\s*:\s*none/);
  assert.doesNotMatch(PREP_CSS, /:focus/, "app.css:71-77 is the one focus rule for everything");
  assert.doesNotMatch(PREP_CSS, /transition\s*:\s*all/);
  // #21 shipped this file fully static. The owner's 31 Jul call added one authored entrance,
  // so the invariant is now the guard, not the ban: any animation lives inside a
  // `prefers-reduced-motion: no-preference` block, and nothing transitions.
  let outsideGuard = PREP_CSS;
  for (
    let at = outsideGuard.search(/@media[^{]*prefers-reduced-motion:\s*no-preference/);
    at !== -1;
    at = outsideGuard.search(/@media[^{]*prefers-reduced-motion:\s*no-preference/)
  ) {
    let depth = 0;
    let end = outsideGuard.indexOf("{", at);
    do {
      const ch = outsideGuard[end];
      if (ch === "{") depth += 1;
      if (ch === "}") depth -= 1;
      end += 1;
    } while (depth > 0 && end < outsideGuard.length);
    outsideGuard = outsideGuard.slice(0, at) + outsideGuard.slice(end);
  }
  assert.doesNotMatch(outsideGuard, /transition|animation|@keyframes/, "animation must sit behind the reduced-motion guard");
});

test("prep.css restates no selector app.css already owns", () => {
  // R6's tripwire. This file supplements; a selector in both is a rule fighting itself, and the
  // cascade decides which one wins by link order rather than by anybody's intent.
  const selectorsOf = (source) => {
    const found = new Set();
    for (const m of source.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(^|\}|\{)([^{}]*?)\s*\{/g)) {
      for (const part of m[2].split(",")) {
        const selector = part.trim();
        // An at-rule prelude is not a component selector, and sharing app.css's 600px
        // breakpoint is the point rather than a restatement of it.
        if (selector && !selector.startsWith("@")) found.add(selector);
      }
    }
    return found;
  };
  const app = selectorsOf(read("public/app.css"));
  const prep = selectorsOf(PREP_CSS);
  assert.ok(prep.size > 0, "no selectors parsed out of prep.css");
  const clashes = [...prep].filter((s) => app.has(s));
  assert.deepEqual(clashes, [], `prep.css restates app.css: ${clashes.join(", ")}`);
});

/**
 * Every file under public/prep, at any depth, relative to it.
 *
 * RECURSIVE, and that is the decision rather than the implementation. This walk read one flat
 * directory until #68 put the compliance passport in public/prep/compliance/ — at which point
 * `readFileSync` on the subdirectory threw EISDIR and the sweep below died rather than failing
 * an assertion. The cheap fix is to skip directories; it is also the wrong one, because the
 * gate would then silently stop covering every page the portal grows from here, which is
 * exactly the class of failure this suite writes tests about. Recursing keeps the coverage.
 */
function portalFiles(dir, prefix = "") {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? portalFiles(join(dir, entry.name), `${prefix}${entry.name}/`)
      : [{ name: `${prefix}${entry.name}`, path: join(dir, entry.name) }],
  );
}

test("nothing in the portal forces a tab order", () => {
  // A positive tabindex overrides the document order for the WHOLE page, which is how a
  // keyboard path that reads fine in the markup becomes unusable in the browser.
  const files = portalFiles(join(root, "public/prep"));
  // A guard on the guard: a walk that returned nothing would pass while checking nothing, and
  // the recursion above is new enough to be worth pinning.
  assert.ok(files.length >= 12, `walked ${files.length} portal files, expected at least 12`);
  for (const file of files) {
    assert.doesNotMatch(
      readFileSync(file.path, "utf8"),
      /tabindex\s*=\s*["']?[1-9]/,
      `${file.name} sets a positive tabindex`,
    );
  }
});

/* ── group 11: guarding the guard ──────────────────────────────────────────────────────── */

test("the serializer reached the deepest node, so the groups above measured a whole tree", () => {
  // Groups 3-7 all rest on "this string is / is not in the serialized output". A serializer that
  // stopped at the first level would make every absence assertion pass for the wrong reason.
  // This asserts the deepest thing in the payload is present: a StoryBankCard nested inside
  // CompetencyMap, its heading, its skeleton items, and its generated landmark id.
  const payload = stored();
  const map = payload.blocks.find((b) => b.name === "CompetencyMap");
  const nested = map.children[0];
  const { mount, html } = render(payload);

  assert.ok(nested, "the fixture no longer nests anything, so this guard checks nothing");
  assert.ok(html.includes(nested.props.prompt), "the nested block's own prompt is missing");
  assert.ok(html.includes(nested.props.skeleton.at(-1)), "the nested block's last item is missing");
  assert.ok(html.includes('aria-labelledby="block-1-0-head"'), "the nested landmark id is missing");

  // And that a nested section really is inside its parent rather than a sibling that happened
  // to render — the traversal, not just the strings.
  const parent = findAll(mount, (n) => n.attrs["aria-labelledby"] === "block-1-head")[0];
  const inside = findAll(parent, (n) => n.attrs["aria-labelledby"] === "block-1-0-head");
  assert.equal(inside.length, 1, "the nested card did not render inside its map");
});

test("the serializer carries attributes and class names, not only tags and text", () => {
  // The two load-bearing absence assertions (an unknown name, a failed quote) would both pass
  // against a serializer that dropped attributes while the page leaked through a title or a
  // data-*. This is the assertion that the absence checks can see attributes at all.
  const doc = fakeDocument();
  const node = doc.createElement("div");
  node.className = "a-class";
  node.setAttribute("title", "an-attribute-value");
  node.appendChild(doc.createTextNode("some text"));

  const html = serialize(node);
  assert.match(html, /class="a-class"/);
  assert.match(html, /title="an-attribute-value"/);
  assert.match(html, /some text/);
});
