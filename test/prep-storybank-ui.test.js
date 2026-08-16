// #78 — the storybank page, driven through its controller with the document double.
//
// The class of failure this file catches: a page that is green and WRONG about the one thing it
// promises. Four of those, and each has a test below named for it:
//
//   · a failed save that ALSO loses what they typed. A debrief line is a sentence; a sketch is
//     paragraphs about something that happened to them. A dropped request must cost the save,
//     never the words — commit 7057b2a is this codebase's recorded position on that trade.
//   · a save landing while they are still typing, overwriting it under the word "Saved".
//   · the EDITOR CARRYING STATE BETWEEN STORIES. Opening story B with story A's ticks still set
//     would silently re-file A's competencies onto B on the next save, and the candidate's own
//     bookkeeping — which is the whole input to the story gap — would be quietly wrong.
//   · anything typed here reaching a URL, browser storage, an HTML-parsing assignment, or a model.
//     The last one is the ticket: this is the page where writing the candidate's story for them
//     would feel most like helpfulness.
//
// WHAT THIS FILE CANNOT CHECK, by design: test/helpers/dom.js does not lay out, focus or dispatch
// (its header makes the argument). The tests drive the controller and reach handlers via
// node.listeners; whether the tick targets and the two row buttons clear 44px, and whether the
// delete two-step is operable from a phone keyboard, are the manual sweep in real Safari.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { initStories, COPY } from "../public/prep/stories.js";
import { fakeDocument, serialize, textOf, findAll } from "./helpers/dom.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const STORIES_JS = read("public/prep/stories.js");
const STORIES_HTML = read("public/prep/stories.html");

// Mirrors stories.html rather than parsing it (nothing in this suite parses HTML); the id-drift
// gate in test/prep-content.test.js is what keeps this mirror honest against the real document.
const SHELL_IDS = [
  "stories-state",
  "private-note",
  "unavailable",
  "unavailable-note",
  "storybank",
  "story-gap",
  "stories-list",
  "add-story",
  "editor",
  "title-label",
  "title",
  "title-caption",
  "sketch-label",
  "sketch",
  "sketch-caption",
  "covers-label",
  "covers-caption",
  "covers-list",
  "save",
  "cancel",
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
    node.hidden = ["unavailable", "storybank", "editor", "story-gap"].includes(id);
    index.set(id, node);
  }
  // The two boxes carry a `value`, as the real input and textarea do.
  index.get("title").value = "";
  index.get("sketch").value = "";
  return { doc, node: (id) => index.get(id) };
}

const COMPETENCIES = [
  { id: "role:lone-working", label: "Lone working" },
  { id: "role:stakeholders", label: "Working with stakeholders" },
];

const PAYLOAD = (over = {}) => ({
  stories: [],
  competencies: COMPETENCIES,
  story_gap: null,
  max_stories: 12,
  ...over,
});

const STORY = (over = {}) => ({
  id: "story-1",
  title: "The escalation on nights",
  sketch: "The family refused the plan at 2am.",
  competency_ids: ["role:lone-working"],
  ...over,
});

/**
 * A fetch double that answers GET from `payloads` (shifted, so a re-fetch can differ) and records
 * every POST body. `postStatus` is what a write is answered with.
 *
 * `duringPost` runs while the request is out — the only way to model, with no event loop to
 * interleave on, a candidate who carries on typing between tapping Save and the answer landing.
 */
function net({ payloads, postStatus = 200, postBody = { ok: true, id: "story-new" }, duringPost } = {}) {
  const calls = [];
  const queue = [...payloads];
  const fetchFn = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method ?? "GET", body: opts.body });
    if ((opts.method ?? "GET") === "GET") {
      const next = queue.length > 1 ? queue.shift() : queue[0];
      if (typeof next === "number") return { ok: next < 400, status: next, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => next };
    }
    if (duringPost) duringPost();
    return { ok: postStatus < 400, status: postStatus, json: async () => postBody };
  };
  return { calls, fetchFn, posts: () => calls.filter((c) => c.method === "POST") };
}

async function boot({ payloads, postStatus, postBody, duringPost } = {}) {
  const s = shell();
  const wire = net({ payloads, postStatus, postBody, duringPost });
  const navigated = [];
  const controller = initStories({
    doc: s.doc,
    fetchImpl: wire.fetchFn,
    navigate: (url) => navigated.push(url),
  });
  await controller.ready;
  return { ...s, ...wire, controller, navigated };
}

const rowsOf = (s) => findAll(s.node("stories-list"), (n) => n.classes.includes("story-row"));
const ticksOf = (s) => findAll(s.node("covers-list"), (n) => n.attrs.type === "checkbox");
const buttonsOf = (s) => findAll(s.node("stories-list"), (n) => n.tag === "button");

/* ── the states the page can open in ───────────────────────────────────────────────────── */

test("with no handover the page says so plainly and offers no list", async () => {
  const s = await boot({ payloads: [404] });

  assert.equal(s.controller.state.phase, "not-ready");
  assert.equal(textOf(s.node("unavailable-note")), COPY.notReady);
  assert.equal(s.node("unavailable").hidden, false);
  assert.equal(s.node("storybank").hidden, true);
});

test("with no session the page leaves for login and says nothing", async () => {
  const s = await boot({ payloads: [401] });
  assert.deepEqual(s.navigated, ["/prep/login"]);
  assert.equal(s.node("storybank").hidden, true);
});

test("an empty storybank invites a first story rather than showing a blank", async () => {
  const s = await boot({ payloads: [PAYLOAD()] });

  assert.equal(s.controller.state.phase, "ready");
  assert.equal(rowsOf(s).length, 0);
  assert.match(textOf(s.node("stories-list")), /Nothing here yet/);
  assert.equal(textOf(s.node("add-story")), COPY.add);
  assert.equal(s.node("editor").hidden, true, "the editor is shut until they ask for it");
});

/* ── the list ──────────────────────────────────────────────────────────────────────────── */

test("a story renders its name and what it covers, by label and never by id", async () => {
  const s = await boot({ payloads: [PAYLOAD({ stories: [STORY()] })] });

  const row = rowsOf(s)[0];
  assert.match(textOf(row), /The escalation on nights/);
  assert.match(textOf(row), /Lone working/);
  assert.ok(!serialize(row).includes("role:lone-working"), "an internal id must never reach the page");
});

test("a story with no covers says so in words, rather than showing a blank", async () => {
  // Two different states look identical without this line: "I have not linked it yet" and "a
  // re-handover removed the competency I linked it to" (0012's cascade takes the tick). The
  // candidate cannot act on a blank.
  const s = await boot({ payloads: [PAYLOAD({ stories: [STORY({ competency_ids: [] })] })] });
  assert.match(textOf(rowsOf(s)[0]), /not linked to any part of the job yet/);
});

test("a tick pointing at a competency that no longer exists renders as no covers, not as a blank", async () => {
  const s = await boot({
    payloads: [PAYLOAD({ stories: [STORY({ competency_ids: ["role:deleted-by-a-re-handover"] })] })],
  });
  assert.match(textOf(rowsOf(s)[0]), /not linked to any part of the job yet/);
  assert.ok(!serialize(rowsOf(s)[0]).includes("role:deleted"), "and the dead id is not shown either");
});

test("every row button names the story it acts on", async () => {
  // Five identical "Delete" buttons are unnavigable: a screen reader moving control to control
  // would announce the same word five times with nothing to tell the rows apart.
  const s = await boot({
    payloads: [PAYLOAD({ stories: [STORY(), STORY({ id: "story-2", title: "The audit nobody wanted" })] })],
  });

  const labels = buttonsOf(s).map((b) => b.attrs["aria-label"]);
  assert.deepEqual(labels, [
    'Edit “The escalation on nights”',
    'Delete “The escalation on nights”',
    'Edit “The audit nobody wanted”',
    'Delete “The audit nobody wanted”',
  ]);
});

/* ── the editor ────────────────────────────────────────────────────────────────────────── */

test("editing story B does not carry story A's ticks into the editor", async () => {
  // The failure this page could most easily ship green: `state.covers` is the EDITOR's set, and a
  // set that is merged rather than replaced would silently re-file A's competencies onto B on the
  // next save — corrupting the candidate's own bookkeeping, which is the whole input to the gap.
  const s = await boot({
    payloads: [
      PAYLOAD({
        stories: [
          STORY({ id: "a", title: "A", competency_ids: ["role:lone-working", "role:stakeholders"] }),
          STORY({ id: "b", title: "B", competency_ids: [] }),
        ],
      }),
    ],
  });

  await s.controller.openEditor("a");
  assert.deepEqual([...s.controller.state.covers].sort(), ["role:lone-working", "role:stakeholders"]);

  await s.controller.openEditor("b");
  assert.deepEqual([...s.controller.state.covers], [], "B has no ticks and the editor must agree");
  assert.equal(s.node("title").value, "B");
  assert.equal(ticksOf(s).filter((t) => t.checked).length, 0);
});

test("opening a story fills the boxes; cancel empties them and shuts the editor", async () => {
  const s = await boot({ payloads: [PAYLOAD({ stories: [STORY()] })] });

  await s.controller.openEditor("story-1");
  assert.equal(s.node("editor").hidden, false);
  assert.equal(s.node("title").value, "The escalation on nights");
  assert.equal(s.node("sketch").value, "The family refused the plan at 2am.");

  s.node("cancel").listeners.click[0]();
  assert.equal(s.node("editor").hidden, true);
  assert.equal(s.node("sketch").value, "", "an abandoned draft does not sit in the box for the next story");
});

test("a new story POSTs to the collection; an edit POSTs to the item route", async () => {
  const s = await boot({ payloads: [PAYLOAD({ stories: [STORY()] })] });

  await s.controller.openEditor(null);
  s.node("title").value = "A new one";
  s.node("sketch").value = "What happened.";
  await s.controller.save();

  const created = s.posts()[0];
  assert.equal(created.url, "/prep/api/stories");
  const createdBody = JSON.parse(created.body);
  assert.deepEqual(Object.keys(createdBody).sort(), ["competency_ids", "sketch", "title"]);
  assert.ok(!("id" in createdBody), "the collection route has no id in its vocabulary");
  assert.ok(!("action" in createdBody));

  await s.controller.openEditor("story-1");
  s.node("title").value = "Renamed";
  await s.controller.save();

  const edited = s.posts()[1];
  assert.equal(edited.url, "/prep/api/story");
  const editedBody = JSON.parse(edited.body);
  assert.equal(editedBody.action, "save");
  assert.equal(editedBody.id, "story-1");
  assert.equal(editedBody.title, "Renamed");
});

test("a save re-fetches rather than patching what is on screen", async () => {
  const s = await boot({
    payloads: [PAYLOAD(), PAYLOAD({ stories: [STORY({ id: "story-new", title: "A new one" })] })],
  });

  await s.controller.openEditor(null);
  s.node("title").value = "A new one";
  await s.controller.save();

  assert.equal(rowsOf(s).length, 1, "the list came back from the server, not from local state");
  assert.equal(textOf(s.node("stories-state")), COPY.saved);
  assert.deepEqual(s.calls.map((c) => c.method), ["GET", "POST", "GET"]);
});

/* ── the two failures this page cannot afford ──────────────────────────────────────────── */

test("a failed save leaves every word in the box", async () => {
  const s = await boot({ payloads: [PAYLOAD()], postStatus: 500 });

  await s.controller.openEditor(null);
  s.node("title").value = "The escalation on nights";
  s.node("sketch").value = "Three paragraphs about a night I would rather forget.";
  await s.controller.save();

  assert.equal(s.node("title").value, "The escalation on nights");
  assert.equal(
    s.node("sketch").value,
    "Three paragraphs about a night I would rather forget.",
    "a dropped request costs the save and never the words",
  );
  assert.equal(textOf(s.node("stories-state")), COPY.saveFailed);
  assert.equal(s.controller.state.inFlight, false, "and the button is usable again");
});

test("a save landing while they are still typing does not overwrite what they typed", async () => {
  // `sentSnapshot`: the editor's contents when the POST left. The re-fetched row cannot contain
  // anything typed after that, so rendering it over these controls would erase words the
  // candidate watched themselves type, under the word "Saved".
  const s = await boot({
    payloads: [PAYLOAD({ stories: [STORY({ id: "story-1", sketch: "The first half." })] })],
  });

  await s.controller.openEditor("story-1");
  s.node("sketch").value = "The first half.";

  // The save is started and NOT awaited, so the box can be edited before the fetch double's
  // promise chain resolves — which is the only way to model a candidate still typing, with no
  // event loop to interleave on.
  const saving = s.controller.save();
  s.node("sketch").value = "The first half. And the rest, typed while it saved.";
  await saving;

  assert.equal(
    s.node("sketch").value,
    "The first half. And the rest, typed while it saved.",
    "the re-fetched row must not be written over words typed during the round trip",
  );
  assert.deepEqual(
    [...s.controller.state.covers],
    ["role:lone-working"],
    "and the ticks the server confirmed are still the ones on screen",
  );
});

test("a save that lands with nothing typed since DOES take the server's row", async () => {
  // The other half of the same rule, and the reason `sentSnapshot` compares rather than simply
  // never re-rendering: when the editor has not moved, what the server stored is the truth and the
  // page must show it — otherwise a value the route normalised would sit on screen disagreeing
  // with the row forever.
  const s = await boot({
    payloads: [
      PAYLOAD({ stories: [STORY({ id: "story-1", sketch: "Draft." })] }),
      PAYLOAD({ stories: [STORY({ id: "story-1", sketch: "What the server actually stored." })] }),
    ],
  });

  await s.controller.openEditor("story-1");
  await s.controller.save();

  assert.equal(s.node("sketch").value, "What the server actually stored.");
});

/* ── delete ────────────────────────────────────────────────────────────────────────────── */

test("delete takes two taps, and the first one arms nothing else", async () => {
  const s = await boot({
    payloads: [PAYLOAD({ stories: [STORY({ id: "a", title: "A" }), STORY({ id: "b", title: "B" })] })],
  });

  const deleteA = () => buttonsOf(s).filter((b) => b.attrs["aria-label"].startsWith("Delete"))[0];
  assert.equal(textOf(deleteA()), COPY.remove);

  deleteA().listeners.click[0]();
  assert.equal(s.posts().length, 0, "the first tap asks rather than deletes");
  assert.equal(textOf(deleteA()), COPY.confirmRemove);
  const deleteB = () => buttonsOf(s).filter((b) => b.attrs["aria-label"].startsWith("Delete"))[1];
  assert.equal(textOf(deleteB()), COPY.remove, "and it arms one row, never both");

  deleteA().listeners.click[0]();
  const post = s.posts()[0];
  assert.equal(post.url, "/prep/api/story");
  assert.deepEqual(JSON.parse(post.body), { action: "delete", id: "a" });
});

test("arming a second row disarms the first", async () => {
  const s = await boot({
    payloads: [PAYLOAD({ stories: [STORY({ id: "a", title: "A" }), STORY({ id: "b", title: "B" })] })],
  });
  const deletes = () => buttonsOf(s).filter((b) => b.attrs["aria-label"].startsWith("Delete"));

  deletes()[0].listeners.click[0]();
  deletes()[1].listeners.click[0]();
  assert.equal(textOf(deletes()[0]), COPY.remove, "there is never more than one primed Delete on screen");
  assert.equal(textOf(deletes()[1]), COPY.confirmRemove);
  assert.equal(s.posts().length, 0);
});

test("a failed delete disarms the button and says so", async () => {
  const s = await boot({ payloads: [PAYLOAD({ stories: [STORY({ id: "a", title: "A" })] })], postStatus: 500 });
  const deleteA = () => buttonsOf(s).filter((b) => b.attrs["aria-label"].startsWith("Delete"))[0];

  deleteA().listeners.click[0]();
  await deleteA().listeners.click[0]();

  assert.equal(textOf(s.node("stories-state")), COPY.deleteFailed);
  assert.equal(textOf(deleteA()), COPY.remove, "a failed delete must not leave the button primed");
});

/* ── the caps, refused in the page ─────────────────────────────────────────────────────── */

test("the caps are refused here, with the real limit named, and no request is made", async () => {
  const s = await boot({ payloads: [PAYLOAD()] });
  await s.controller.openEditor(null);

  s.node("title").value = "   ";
  await s.controller.save();
  assert.equal(textOf(s.node("stories-state")), COPY.titleMissing);

  s.node("title").value = "x".repeat(121);
  await s.controller.save();
  assert.match(textOf(s.node("stories-state")), /120/, "the refusal names the limit that is enforced");

  s.node("title").value = "ok";
  s.node("sketch").value = "x".repeat(2001);
  await s.controller.save();
  assert.match(textOf(s.node("stories-state")), /2000|2,000/);

  assert.equal(s.posts().length, 0, "a 400 dressed in retry advice is a dead end; none of these left the page");
  assert.equal(s.node("sketch").value.length, 2001, "and the words are untouched");
});

test("the story cap is the ROUTE's number, not a constant in this file", async () => {
  // `max_stories` travels in the payload so the page's refusal cannot drift from the limit the
  // route actually enforces. Serving a deliberately different number is how that gets proven.
  const stories = Array.from({ length: 3 }, (_, n) => STORY({ id: `s-${n}`, title: `Story ${n}` }));
  const s = await boot({ payloads: [PAYLOAD({ stories, max_stories: 3 })] });

  await s.controller.openEditor(null);
  assert.match(textOf(s.node("stories-state")), /There is room for 3 stories/);
  assert.equal(s.node("editor").hidden, true, "and the editor does not open on a story that cannot be saved");
  assert.equal(s.posts().length, 0);
});

test("the cap is re-checked at save, not only when the editor opens", async () => {
  // Both guards are real and neither covers the other. `openEditor` refuses to open a form that
  // cannot be submitted; `save` refuses to send. The window between them is not theoretical: the
  // editor stays open across a re-fetch (a delete on another row triggers one), so a second tab
  // filling the last slot lands the page here with a composed story and no room for it. Without
  // this branch the page would post it and read the route's 400 as transient — "try again in a
  // moment" about a request that can never succeed, with nothing in browser storage to reload.
  const s = await boot({
    payloads: [PAYLOAD({ stories: [STORY({ id: "s-0", title: "One" })], max_stories: 2 })],
  });

  await s.controller.openEditor(null);
  assert.equal(s.node("editor").hidden, false, "one story, room for two — the editor opens");
  s.node("title").value = "A story composed while there was still room";

  // The other tab's stories arrive on a re-fetch while this editor is open.
  s.controller.render(
    PAYLOAD({
      stories: [STORY({ id: "s-0", title: "One" }), STORY({ id: "s-1", title: "Two" })],
      max_stories: 2,
    }),
  );
  await s.controller.save();

  assert.match(textOf(s.node("stories-state")), /There is room for 2 stories/);
  assert.equal(s.posts().length, 0, "nothing was sent");
  assert.equal(
    s.node("title").value,
    "A story composed while there was still room",
    "and their words are untouched — the refusal is not a reason to clear the box",
  );
});

/* ── the gap line ──────────────────────────────────────────────────────────────────────── */

test("the gap names a part of the job and carries no number", async () => {
  const s = await boot({
    payloads: [PAYLOAD({ story_gap: { id: "role:stakeholders", label: "Working with stakeholders" } })],
  });

  const gap = textOf(s.node("story-gap"));
  assert.match(gap, /Working with stakeholders/);
  assert.equal(s.node("story-gap").hidden, false);
  assert.doesNotMatch(gap, /\d/, "no count, no '0 of 5 covered', no score — SPEC's ladder rule, twice");
  assert.doesNotMatch(gap, /\bgap\b|\bweak|\bmissing\b|\bbehind\b/i, "it is a thing to think about, not a mark");
});

test("with nothing to flag the gap line is absent rather than blank", async () => {
  const s = await boot({ payloads: [PAYLOAD({ story_gap: null })] });
  assert.equal(s.node("story-gap").hidden, true);
  assert.equal(textOf(s.node("story-gap")), "");
});

test("no score, rank, level or percentage anywhere on a filled page", async () => {
  const s = await boot({
    payloads: [
      PAYLOAD({
        stories: [STORY()],
        story_gap: { id: "role:stakeholders", label: "Working with stakeholders" },
      }),
    ],
  });
  await s.controller.openEditor("story-1");

  const page = SHELL_IDS.map((id) => serialize(s.node(id))).join(" ");
  assert.doesNotMatch(
    page,
    /\bscore\b|\brank(ed|ing)?\b|\blevel\b|\bstage\b|\b\d+%|\b\d+ of \d+\b|assess(ed|ment)?\b/i,
    "the ranking decides which competency the gap names and is never shown; this page is a " +
      "notebook, not a mark",
  );
});

/* ── the promises, as source facts ─────────────────────────────────────────────────────── */

test("nothing typed here reaches a URL, and only two endpoints are ever called", async () => {
  const marker = "a-string-that-must-never-reach-a-url";
  const s = await boot({ payloads: [PAYLOAD()] });

  await s.controller.openEditor(null);
  s.node("title").value = marker;
  s.node("sketch").value = marker;
  await s.controller.save();

  for (const call of s.calls) {
    assert.ok(!call.url.includes(marker), `candidate text leaked into ${call.url}`);
    assert.ok(
      ["/prep/api/stories", "/prep/api/story"].includes(call.url),
      `an unexpected URL shape: ${call.url}. This page calls two endpoints and no third — there ` +
        `is no model call from here, and the absence of any other fetch is what keeps that true.`,
    );
  }
  // And it did travel, so this test is not passing on a save that never happened.
  assert.ok(s.posts()[0].body.includes(marker));
});

test("nothing reaches browser storage, and no string is ever parsed as HTML", () => {
  assert.doesNotMatch(
    STORIES_JS,
    /innerHTML|outerHTML|insertAdjacentHTML|document\.write|createContextualFragment/,
    "every string on this page is either COPY or something the candidate typed — the value most " +
      "likely to be trusted by accident",
  );
  assert.doesNotMatch(
    STORIES_JS,
    /localStorage|sessionStorage|indexedDB|document\.cookie|caches\b/,
    "this is the most candidate-owned surface in the product; 'your recruiter never sees any of " +
      "it' has to include the browser or the sentence is not true",
  );
});

test("the shape prompt is a static string, and nothing on this page asks a model to fill a box", () => {
  // THE TICKET, as a test. SPEC Amendment 1 allows prompting for a story's SHAPE and forbids
  // drafting its content — so the shape prompt has to be a sentence written here once, and this
  // asserts that it is not a function of anything, not a fetch, and not a template of a response.
  assert.equal(typeof COPY.sketchCaption, "string");
  assert.match(COPY.sketchCaption, /What was going on/, "it names the situation");
  assert.match(COPY.sketchCaption, /what you actually\s+did/, "the action");
  assert.match(COPY.sketchCaption, /different afterwards/, "and what changed");

  // Every path this file can reach, read off its string literals rather than off its call sites:
  // the save picks its URL with a ternary, so a regex following `fetchFn(` would have to parse
  // expressions, and one that half-parses them is a gate asserting less than it claims.
  const paths = [...new Set([...STORIES_JS.matchAll(/["'](\/[^"'\s]*)["']/g)].map((m) => m[1]))].sort();
  assert.deepEqual(
    paths,
    ["/prep/api/stories", "/prep/api/story", "/prep/login"],
    "the two endpoints and the bounce, and no third path. A fetch to anything else on this page " +
      "is how 'nothing drafts a sketch' stops being true.",
  );
  const fetchSites = [...STORIES_JS.matchAll(/fetchFn\(/g)].length;
  assert.equal(fetchSites, 3, `found ${fetchSites} fetch call sites, expected the load, the save and the delete`);
  assert.ok(
    !/@anthropic-ai|\bmessages\.stream\b|\bcompletion/i.test(STORIES_JS),
    "structurally model-free, on the surface where breaking that would feel most helpful",
  );
});

test("stories.html carries every id the controller reads", () => {
  for (const id of SHELL_IDS) {
    assert.ok(STORIES_HTML.includes(`id="${id}"`), `stories.html lost #${id}`);
  }
});
