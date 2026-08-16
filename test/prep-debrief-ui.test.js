// #77 — the debrief page, driven through its controller with the document double.
//
// The class of failure this file catches: a page that is green and WRONG about the one thing it
// promises. Three of those, and each has a test below named for it:
//
//   · a pick that does not survive an edit. The pickers are rebuilt every time the box changes,
//     so a placement read off the elements would be lost the moment a line above it is deleted —
//     and the candidate would find their questions filed under the wrong competency.
//   · a failed save that ALSO loses what they typed. This page is filled in on a phone on the way
//     out of an interview; a dropped request must cost the save, never the words.
//   · anything typed here reaching a URL, browser storage, or an HTML-parsing assignment. It is
//     the most candidate-owned surface in the product and the promise on it is absolute.
//
// WHAT THIS FILE CANNOT CHECK, by design: test/helpers/dom.js does not lay out, focus or
// dispatch (its header makes the argument). The tests drive the controller and reach handlers via
// node.listeners; whether the picker is operable from a phone keyboard and whether the tick
// targets clear 44px are the manual sweep in real Safari.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { initDebrief, COPY } from "../public/prep/debrief.js";
import { fakeDocument, serialize, textOf, findAll } from "./helpers/dom.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const DEBRIEF_JS = read("public/prep/debrief.js");
const DEBRIEF_HTML = read("public/prep/debrief.html");

// Mirrors debrief.html rather than parsing it (nothing in this suite parses HTML); the id-drift
// gate in test/prep-content.test.js is what keeps this mirror honest against the real document.
const SHELL_IDS = [
  "debrief-state",
  "private-note",
  "unavailable",
  "unavailable-note",
  "debrief-form",
  "asked-label",
  "asked",
  "asked-caption",
  "place-label",
  "place-caption",
  "asked-lines",
  "shaky-label",
  "shaky-caption",
  "shaky-list",
  "fix-label",
  "fix",
  "fix-caption",
  "save",
];

function shell() {
  const base = fakeDocument();
  const index = new Map();
  const doc = {
    createElement: base.createElement,
    createTextNode: base.createTextNode,
    getElementById: (id) => index.get(id) ?? null,
  };
  for (const id of SHELL_IDS) {
    const node = base.createElement("div");
    node.setAttribute("id", id);
    node.hidden = id === "unavailable" || id === "debrief-form";
    index.set(id, node);
  }
  // The two boxes carry a `value`, as the real textareas do.
  index.get("asked").value = "";
  index.get("fix").value = "";
  return { doc, node: (id) => index.get(id) };
}

const COMPETENCIES = [
  { id: "role:lone-working", label: "Lone working" },
  { id: "role:stakeholders", label: "Working with stakeholders" },
];

const AVAILABLE = (over = {}) => ({
  available: true,
  asked: [],
  shaky: [],
  fix_text: "",
  competencies: COMPETENCIES,
  ...over,
});

/**
 * A fetch double that answers GET from `payloads` (shifted, so a re-fetch can differ) and records
 * every POST body. `postStatus` is what the save is answered with.
 */
function net({ payloads, postStatus = 200 } = {}) {
  const calls = [];
  const queue = [...payloads];
  const fetchFn = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method ?? "GET", body: opts.body });
    if ((opts.method ?? "GET") === "GET") {
      const next = queue.length > 1 ? queue.shift() : queue[0];
      if (typeof next === "number") return { ok: next < 400, status: next, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => next };
    }
    return { ok: postStatus < 400, status: postStatus, json: async () => ({ ok: true }) };
  };
  return { calls, fetchFn, posts: () => calls.filter((c) => c.method === "POST") };
}

async function boot({ payloads, postStatus } = {}) {
  const s = shell();
  const wire = net({ payloads, postStatus });
  const navigated = [];
  const controller = initDebrief({
    doc: s.doc,
    fetchImpl: wire.fetchFn,
    navigate: (url) => navigated.push(url),
  });
  await controller.ready;
  return { ...s, ...wire, controller, navigated };
}

/** Every <select> the picker mount holds, in document order. */
const pickersOf = (s) => findAll(s.node("asked-lines"), (n) => n.tag === "select");
const ticksOf = (s) => findAll(s.node("shaky-list"), (n) => n.attrs.type === "checkbox");

/* ── the two states the page can open in ───────────────────────────────────────────────── */

test("before the interview the page says so and offers no form", async () => {
  const s = await boot({ payloads: [{ available: false }] });

  assert.equal(s.controller.state.phase, "too-early");
  assert.equal(textOf(s.node("unavailable-note")), COPY.tooEarly);
  assert.equal(s.node("unavailable").hidden, false);
  assert.equal(s.node("debrief-form").hidden, true, "the form is not offered before it would be refused");
  assert.equal(pickersOf(s).length, 0);
  assert.equal(ticksOf(s).length, 0);
  // The privacy line still shows: it is true either way, and it is why they are on this page.
  assert.equal(textOf(s.node("private-note")), COPY.privateNote);
});

test("an available payload prefills both boxes and pre-ticks what was ticked", async () => {
  const s = await boot({
    payloads: [
      AVAILABLE({
        asked: [
          { text: "A lone visit that went wrong.", competency_id: "role:lone-working" },
          { text: "Why this trust?", competency_id: null },
        ],
        shaky: ["role:stakeholders"],
        fix_text: "Lead with the result.",
      }),
    ],
  });

  assert.equal(s.controller.state.phase, "ready");
  assert.equal(s.node("asked").value, "A lone visit that went wrong.\nWhy this trust?");
  assert.equal(s.node("fix").value, "Lead with the result.");

  const pickers = pickersOf(s);
  assert.equal(pickers.length, 2);
  assert.equal(pickers[0].value, "role:lone-working", "a placed line comes back on its competency");
  assert.equal(pickers[1].value, "", "an unplaced line comes back on 'Not sure yet'");

  const ticks = ticksOf(s);
  assert.deepEqual(ticks.map((t) => t.checked), [false, true]);

  // Every label on the page comes from COPY — nothing is written in the markup where it could
  // drift from the object the tone rules are reviewed against.
  assert.equal(textOf(s.node("asked-label")), COPY.askedLabel);
  assert.equal(textOf(s.node("shaky-caption")), COPY.shakyCaption);
  assert.equal(textOf(s.node("save")), COPY.save);
});

test("typing lines renders one labelled picker each, carrying every competency plus 'Not sure yet'", async () => {
  const s = await boot({ payloads: [AVAILABLE()] });

  s.node("asked").value = "First question?\n\nSecond question?\n   \nThird question?";
  s.node("asked").listeners.input[0]();

  const pickers = pickersOf(s);
  assert.equal(pickers.length, 3, "blank lines are not questions");
  for (const picker of pickers) {
    assert.deepEqual(
      picker.children.map(textOf),
      [COPY.unplaced, "Lone working", "Working with stakeholders"],
      "'Not sure yet' is first, and is what an unplaced line means",
    );
    assert.ok(picker.attrs["aria-label"], "every picker carries a label of its own");
  }
  assert.notEqual(
    pickers[0].attrs["aria-label"],
    pickers[1].attrs["aria-label"],
    "identical labels would be three indistinguishable dropdowns to a screen reader",
  );
});

test("a pick survives an edit to the line above it", async () => {
  // The failure this test is named for: placements read off the elements would shuffle up onto
  // the wrong questions the moment a line is deleted.
  const s = await boot({ payloads: [AVAILABLE()] });

  s.node("asked").value = "First question?\nSecond question?";
  s.node("asked").listeners.input[0]();
  const second = pickersOf(s)[1];
  second.value = "role:stakeholders";
  second.listeners.change[0]();

  s.node("asked").value = "Second question?";
  s.node("asked").listeners.input[0]();

  assert.deepEqual(pickersOf(s).map((p) => p.value), ["role:stakeholders"]);
});

/* ── saving ────────────────────────────────────────────────────────────────────────────── */

test("save posts exactly the current form state, then re-fetches", async () => {
  const s = await boot({ payloads: [AVAILABLE()] });

  s.node("asked").value = "What went wrong on a lone visit?\nWhy this trust?";
  s.node("asked").listeners.input[0]();
  pickersOf(s)[0].value = "role:lone-working";
  pickersOf(s)[0].listeners.change[0]();
  ticksOf(s)[1].checked = true;
  ticksOf(s)[1].listeners.change[0]();
  s.node("fix").value = "Lead with the result.";

  const before = s.calls.length;
  await s.controller.save();

  const posts = s.posts();
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, "/prep/api/debrief");
  assert.deepEqual(JSON.parse(posts[0].body), {
    asked: [
      { text: "What went wrong on a lone visit?", competency_id: "role:lone-working" },
      { text: "Why this trust?", competency_id: null },
    ],
    shaky: ["role:stakeholders"],
    fix_text: "Lead with the result.",
  });
  assert.equal(s.calls.length, before + 2, "a POST and then a re-read — never a local patch");
  assert.equal(textOf(s.node("debrief-state")), COPY.saved);
  assert.equal(s.node("save").attrs["aria-disabled"], "false", "the button comes back");
});

test("a failed save says so and keeps every word that was typed", async () => {
  const s = await boot({ payloads: [AVAILABLE()], postStatus: 500 });

  s.node("asked").value = "A question they will not get back.";
  s.node("asked").listeners.input[0]();
  s.node("fix").value = "A fix they will not get back.";

  await s.controller.save();

  assert.equal(textOf(s.node("debrief-state")), COPY.saveFailed);
  assert.equal(s.node("asked").value, "A question they will not get back.");
  assert.equal(s.node("fix").value, "A fix they will not get back.");
  assert.equal(s.node("save").attrs["aria-disabled"], "false", "and it can be tried again");
});

test("a session that has gone lands on the sign-in page, not on an error line", async () => {
  const s = await boot({ payloads: [401] });
  assert.deepEqual(s.navigated, ["/prep/login"]);
});

test("a route failure says so rather than rendering an empty form", async () => {
  const s = await boot({ payloads: [503] });
  assert.equal(s.controller.state.phase, "failed");
  assert.equal(textOf(s.node("debrief-state")), COPY.failed);
  assert.equal(s.node("debrief-form").hidden, true);
});

test("a handover that was never written is a state, not a failure", async () => {
  // Nearly unreachable — neither entry link is shown without a handover — so a typed URL is how
  // you get here. It still gets brief.js's register rather than "something went wrong": nothing
  // has gone wrong, their prep is simply not built yet.
  const s = await boot({ payloads: [404] });
  assert.equal(s.controller.state.phase, "not-ready");
  assert.equal(textOf(s.node("unavailable-note")), COPY.notReady);
  assert.equal(s.node("unavailable").hidden, false);
  assert.equal(s.node("debrief-form").hidden, true);
  assert.equal(textOf(s.node("debrief-state")), "", "and no error line over a page that is fine");
});

/* ── the source gates ──────────────────────────────────────────────────────────────────── */

test("the scans are reading something, not an empty string", () => {
  assert.match(DEBRIEF_JS, /initDebrief/);
  assert.match(DEBRIEF_HTML, /asked-lines/);
});

test("importing the module under Node is itself the assertion", () => {
  assert.equal(typeof initDebrief, "function");
  assert.equal(typeof globalThis.document, "undefined", "this suite runs with no DOM, on purpose");
});

test("neither the page nor its markup parses HTML or reaches browser storage", () => {
  for (const source of [DEBRIEF_JS, DEBRIEF_HTML]) {
    assert.doesNotMatch(
      source,
      /innerHTML|outerHTML|insertAdjacentHTML|document\.write|createContextualFragment/,
      "everything here is either the candidate's own text or our API's echo of it; built with " +
        "createElement and text nodes only",
    );
    assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|document\.cookie/);
  }
});

test("nothing the candidate types reaches a URL", async () => {
  const s = await boot({ payloads: [AVAILABLE()] });
  const marker = "a-string-that-must-never-reach-a-url";
  s.node("asked").value = marker;
  s.node("asked").listeners.input[0]();
  s.node("fix").value = marker;
  await s.controller.save();

  for (const call of s.calls) {
    assert.ok(!call.url.includes(marker), `candidate text leaked into ${call.url}`);
    assert.equal(call.url, "/prep/api/debrief", `an unexpected URL shape: ${call.url}`);
  }
  // And it did travel, so this test is not passing on a save that never happened.
  assert.ok(s.posts()[0].body.includes(marker));
});

test("no score, rank, level or percentage anywhere on a filled page", async () => {
  const s = await boot({
    payloads: [
      AVAILABLE({
        asked: [{ text: "A question.", competency_id: "role:lone-working" }],
        shaky: ["role:lone-working"],
        fix_text: "A fix.",
      }),
    ],
  });
  const page = [
    "private-note", "unavailable-note", "debrief-form", "asked-label", "asked-caption",
    "place-label", "place-caption", "asked-lines", "shaky-label", "shaky-caption", "shaky-list",
    "fix-label", "fix-caption", "save", "debrief-state",
  ].map((id) => serialize(s.node(id))).join(" ");

  assert.doesNotMatch(
    page,
    /\bscore\b|\brank(ed|ing)?\b|\blevel\b|\bstage\b|\b\d+%|\b\d+ of \d+\b|assess(ed|ment)?\b/i,
    "the dampening moves a queue and is never shown; this page is a note, not a mark",
  );
});

test("debrief.html carries every id the controller reads", () => {
  for (const id of SHELL_IDS) {
    assert.ok(DEBRIEF_HTML.includes(`id="${id}"`), `debrief.html lost #${id}`);
  }
});

test("COPY holds every visible string, and none of them is an instruction to a model", () => {
  // The ticket's constraint made a property of this file: v1 is a deterministic mapping the
  // candidate makes by ticking. Nothing here drafts, summarises or infers.
  for (const [key, value] of Object.entries(COPY)) {
    const text = typeof value === "function" ? value("a line") : value;
    assert.equal(typeof text, "string", `COPY.${key} must render to a string`);
    assert.ok(text.trim().length > 0, `COPY.${key} is empty`);
  }
  assert.doesNotMatch(DEBRIEF_JS, /anthropic|@anthropic-ai|messages\.stream/i, "no model call on this page");
});
