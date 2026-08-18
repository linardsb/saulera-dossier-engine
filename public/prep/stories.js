/* The candidate's storybank (#78): their own real interview stories, in their own words, each
 * ticked against the parts of the job it covers.
 *
 * A page controller in debrief.js's idiom, over two routes — /prep/api/stories (the collection)
 * and /prep/api/story (one story of it).
 *
 * Four decisions carried over from public/prep/brief.js, session.js and debrief.js, for the
 * reasons stated there:
 *
 * 1. Nothing is written to browser storage of any kind — not local storage, not session storage,
 *    not cookies, not a database in the browser, not a cache. There is nothing to lose on refresh
 *    — the page refetches what was saved. (Written without the API names on purpose: the test's
 *    scan greps this file for them, and a gate that cries wolf at a comment gets deleted.)
 *
 * 2. Nothing candidate-shaped goes in the URL. Everything typed here travels in a POST body.
 *
 * 3. Text nodes, never an HTML-parsing assignment. Every string on this page is either COPY below
 *    or something the candidate typed and our own API handed back — which is exactly the value
 *    most likely to be trusted by accident.
 *
 * 4. MODULE DISCIPLINE: no document reads at module scope, so node --test can import this file
 *    with no DOM at all. stories.html boots it with an inline module script; the suite calls
 *    initStories with a document double.
 *
 * And a fifth, which belongs to this page alone:
 *
 * 5. THE SHAPE PROMPT IS A STATIC STRING AND NOTHING ELSE. `COPY.sketchCaption` names situation,
 *    action and what changed — SPEC Amendment 1's "the tool may prompt for a story's SHAPE". It is
 *    a sentence written here, once, in this file. No request is made to fill the box, no
 *    suggestion is offered, nothing is completed, summarised or rewritten into STAR. This page is
 *    where the spec's first unloosenable rule would be most tempting to break, and the absence of
 *    any fetch other than the two below is what keeps it — asserted, not promised.
 *
 * SAVE THEN RE-FETCH, never patch (passport.js's rule): what the page shows after a save is what
 * the server stored, so a local edit can never disagree with the row.
 *
 * The re-fetch has ONE exception, and it matters MORE here than on the debrief: `sentSnapshot` is
 * what the editor held when the POST left, and anything edited during the round trip is kept over
 * the row that comes back. A debrief line is a sentence; a sketch is paragraphs. Losing words
 * someone watched themselves type, under the word "Saved", is the failure this page can least
 * afford — commit 7057b2a is this codebase's recorded position on that trade.
 */

const COLLECTION = "/prep/api/stories";
const ITEM = "/prep/api/story";

/* The route's per-field caps (functions/prep/api/stories.js), mirrored so an over-long story is
   refused HERE with copy that names the limit, instead of bouncing off the route's 400 wearing
   retry advice that can never succeed — debrief.js:45-52's rule and the same reason. Nothing is
   in browser storage, so a candidate stuck on an unsatisfiable retry has only the reload, and on
   this page the reload costs them paragraphs.

   The STORY COUNT is deliberately not here: the route returns `max_stories` in its payload, so the
   refusal names the limit that is actually enforced rather than a constant that can drift. */
const TITLE_MAX = 120;
const SKETCH_MAX = 2_000;

/** Every visible string this file can produce, in one object — brief.js:25's idiom. Written for a
 *  candidate who has never used a tool like this: no jargon, no "STAR", no scores, and nothing
 *  that reads as an assessment of the stories they have or have not written. */
export const COPY = {
  loading: "Loading…",
  notReady:
    "Your prep is not ready yet. Your recruiter is still putting it together, so check back " +
    "later today.",
  failed:
    "We could not load this just now. Reload the page, and if it still will not load, reply to " +
    "the email that invited you.",

  privateNote:
    "A few things that have actually happened to you at work. Write them once here, and you can " +
    "reach for one in practice instead of starting from nothing. Your recruiter never sees any " +
    "of it.",

  /* The forward-looking sentence. Never a count, never "0 of 5 covered", and never the words gap,
     missing or weakness — this is a thing to go and think about before Thursday, not a mark. */
  gap: (label) =>
    `Nothing in your stories covers ${label} yet — and it is one of the things most likely to ` +
    `come up. Worth thinking of one before the interview.`,

  empty: "Nothing here yet. Start with one thing that went well, or badly, and stuck with you.",
  add: "Add a story",

  titleLabel: "What do you call this one?",
  titleCaption:
    "Something short you would recognise — “the escalation on nights” is plenty. Nobody else " +
    "reads it.",

  sketchLabel: "What happened?",
  /* THE SHAPE PROMPT. A static string: it names the three parts of a story worth telling and then
     stops. Nothing on this page offers to write any of them. */
  sketchCaption:
    "Rough notes are fine — this is for you, not for them. What was going on, what you actually " +
    "did, and what was different afterwards.",

  coversLabel: "Which parts of the job does it show?",
  coversCaption:
    "Tick as many as fit. This is how practice knows to point you at this story. You can change " +
    "it whenever you like.",
  /* Every tick needs a programmatic label naming its story, or a screen reader moving control to
     control announces the same competency five times with nothing to tell the rows apart —
     debrief.js:78-81's argument, on a page with several stories rather than one form. */
  coverFor: (label, title) => `Does “${title}” show ${label}?`,

  /* A story with no ticks says so in words. Without this the row shows a title and an unexplained
     blank, and the candidate cannot tell "I have not done it yet" from "something removed it" —
     which is a real state: a re-handover that drops a competency takes its ticks by cascade
     (0012's second edge). Same class of state, same remedy, as debrief.js:317-327. */
  noCovers: "This story is not linked to any part of the job yet.",

  editFor: (title) => `Edit “${title}”`,
  deleteFor: (title) => `Delete “${title}”`,
  edit: "Edit",
  remove: "Delete",
  /* Two-step, in the page. `window.confirm` is untestable here (the document double cannot
     dispatch) and a modal a candidate taps through by reflex is not a confirmation. The button
     changes its own words and waits. */
  confirmRemove: "Really delete?",
  /* The same two-step, guarding the other way a story's words vanish: opening a different one over
     an editor that has unsaved words in it. Says what would be lost and exactly what a second tap
     does, because the button that triggers it ("Add a story") is full-width and a thumb's width
     above the editor. */
  unsavedWarning:
    "You have words here that are not saved yet. Tap again to leave them behind, or Save this " +
    "story first.",

  save: "Save this story",
  saving: "Saving…",
  saved: "Saved.",
  saveFailed: "Could not save that just now. Try again in a moment. Your words are still below.",
  /* A 404 means the story is gone or a tick points at something that no longer exists — a retry
     can never succeed, so "try again in a moment" would be a dead end on a page with nothing in
     browser storage to reload from. Says what happened, and says the words are still there,
     because that is the question being asked. */
  saveGone:
    "That story is no longer there — it may have been deleted in another tab. Your words are " +
    "still below: tap Save this story again to keep them as a new one.",
  cancel: "Cancel",

  deleting: "Deleting…",
  deleted: "Deleted.",
  deleteFailed: "Could not delete that just now. Try again in a moment.",

  /* The three refusals. Each names the box and the actual limit, because "try again" is the one
     thing that cannot help — and each says the words are safe, because on this page that is the
     question the candidate is really asking. */
  titleMissing: "Give this story a name first — anything you would recognise it by.",
  titleTooLong: `That name is longer than this box can save. Keep it under ${TITLE_MAX} characters.`,
  sketchTooLong:
    `That is longer than this box can save. Keep it under ${SKETCH_MAX} characters — rough notes ` +
    "are the point, and your words are still below.",
  tooMany: (max) =>
    `There is room for ${max} stories here, and you have them all. Delete one you need least, ` +
    "then add this one — nothing goes anywhere until you do.",
};

/** An element with its text set — debrief.js:110's helper, retyped for the same reason. */
function el(doc, tag, className, content) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.appendChild(doc.createTextNode(String(content ?? "")));
  return node;
}

/**
 * The page controller.
 *
 * `doc`, `fetchImpl` and `navigate` are injectable because the suite drives this module with no
 * browser at all. `navigate` defaults to a location replace (brief.js:67's reasoning — a candidate
 * whose session has gone is a person in front of a browser, and `replace` keeps the dead page out
 * of Back's reach).
 *
 * Returns `{ state, save, remove, render, openEditor, ready }` — the DOM handlers delegate to
 * these, and the tests call them directly because the document double records listeners without
 * dispatching. `ready` settles when the initial load has routed.
 */
export function initStories({ doc, fetchImpl, navigate } = {}) {
  doc = doc ?? globalThis.document;
  const fetchFn = fetchImpl ?? ((...args) => globalThis.fetch(...args));
  const go = navigate ?? ((url) => globalThis.location.replace(url));

  const $ = (id) => doc.getElementById(id);
  const stateLine = $("stories-state");
  const privateNote = $("private-note");
  const unavailable = $("unavailable");
  const unavailableNote = $("unavailable-note");
  const storybank = $("storybank");
  const gapLine = $("story-gap");
  const listMount = $("stories-list");
  const addButton = $("add-story");
  const editor = $("editor");
  const titleLabel = $("title-label");
  const titleBox = $("title");
  const titleCaption = $("title-caption");
  const sketchLabel = $("sketch-label");
  const sketchBox = $("sketch");
  const sketchCaption = $("sketch-caption");
  const coversLabel = $("covers-label");
  const coversCaption = $("covers-caption");
  const coversMount = $("covers-list");
  const saveButton = $("save");
  const cancelButton = $("cancel");

  const state = {
    phase: "loading", // loading | not-ready | ready | failed
    competencies: [], // [{id, label}] — the tick list
    stories: [], // [{id, title, sketch, competency_ids}] as the server last reported them
    gap: null, // {id, label} | null
    maxStories: 0, // the route's own cap, never a constant here
    /* Which story the editor is on: an id for an edit, null for a new one, and `undefined` when
       the editor is shut. Kept here rather than read off the DOM because the list is rebuilt on
       every render and the elements are transient. */
    editingId: undefined,
    covers: new Set(), // competency ids ticked IN THE EDITOR, not on the stored row
    confirmingId: null, // the story whose Delete button is waiting for a second tap
    /* Which story a second tap would open THROUGH unsaved words: an id, or `null` for the new
       story, and `undefined` when nothing is armed — `null` cannot be the unarmed value here
       because it is a real target. */
    discardArmed: undefined,
    inFlight: false, // one write at a time
  };

  /** The state line, in app.js's grammar. Assigned as a whole class string rather than toggled, so
   *  the document double's minimal class support can carry it (session.js:188-193). */
  function showState(message, isError) {
    stateLine.textContent = message;
    stateLine.className = `save-state is-shown${isError ? " is-error" : ""}`;
  }

  function clearState() {
    stateLine.textContent = "";
    stateLine.className = "save-state";
  }

  /* aria-disabled rather than disabled: setting `disabled` on the focused button drops focus to
     <body> and does not give it back, so someone saving by keyboard loses their place at the
     moment they act. app.css styles both the same way (passport.js:116-122). */
  function busy(isBusy) {
    state.inFlight = isBusy;
    saveButton.setAttribute("aria-disabled", isBusy ? "true" : "false");
  }

  /* What the editor held when the last POST went out, or null when no save is in flight. Read by
     `save` alone now — the render guard below used to key off it, which is the bug this pair of
     variables exists to fix. */
  let sentSnapshot = null;

  /* WHAT THE SERVER HOLDS for the row the editor is on, or null when the editor is shut.
     `editorSnapshot() !== editorBaseline` therefore means "the editor holds words the server does
     not", which is the only question worth asking before overwriting the boxes.

     WHY THIS REPLACED THE IN-FLIGHT CHECK. The guard used to be `sentSnapshot !== null && …`, and
     `sentSnapshot` is assigned in exactly one place: `save`. So the guard could only ever fire
     during a save's own round trip. Delete a DIFFERENT story while editing one, and `remove`'s
     re-fetch landed with `sentSnapshot` null, `editingId` still set — and `render` wrote the
     stored row over a rewritten sketch, under the word "Deleted." Nothing is in browser storage
     by design, so there is no undo. Any round trip can now land safely, not just a save's.

     It is refreshed in four places and all four are load-bearing: `openEditor` (the boxes came
     from a stored row), the overwrite branch in `render` (they just did again), `closeEditor`
     (there is no row), and a successful save — where it becomes `sentSnapshot`, NOT the current
     editor content, because what the server now holds is what was POSTED. Setting it to the live
     content there would mark words typed during the round trip as saved, which is the same
     data loss through the opposite door. */
  let editorBaseline = null;

  /** The three candidate-owned values as one comparable string. Everything else on the page is the
   *  server's to decide. */
  function editorSnapshot() {
    return JSON.stringify([
      String(titleBox.value ?? ""),
      String(sketchBox.value ?? ""),
      [...state.covers].sort(),
    ]);
  }

  /** Does the editor hold anything the server has not been told about? `false` when it is shut. */
  function isDirty() {
    return state.editingId !== undefined && editorBaseline !== null && editorSnapshot() !== editorBaseline;
  }

  /** Refuse a write the route would answer 400, in the state line, with the box at fault focused.
   *  `focus` is guarded because the suite's document double does not move focus. */
  function refuse(message, box) {
    showState(message, true);
    if (box && typeof box.focus === "function") box.focus();
    return Promise.resolve();
  }

  const labelOf = (id) => state.competencies.find((c) => c.id === id)?.label ?? null;

  /** One row per story: its name, what it covers, and the two things you can do to it. */
  function renderList() {
    listMount.textContent = "";

    if (!state.stories.length) {
      listMount.appendChild(el(doc, "p", "prep-body", COPY.empty));
      return;
    }

    for (const story of state.stories) {
      const row = el(doc, "div", "story-row");
      row.appendChild(el(doc, "p", "story-row-title", story.title));

      /* A competency the candidate ticked can vanish under a re-handover, and the cascade takes
         the tick with it (0012). Mapping through the CURRENT list rather than rendering the raw
         ids is what stops a removed competency showing as a blank chip — and `noCovers` is what
         tells the two empty states apart in words. */
      const covers = (story.competency_ids ?? []).map(labelOf).filter(Boolean);
      row.appendChild(
        covers.length
          ? el(doc, "p", "story-row-covers", covers.join(" · "))
          : el(doc, "p", "story-row-covers", COPY.noCovers),
      );

      const editButton = el(doc, "button", "btn story-row-action", COPY.edit);
      editButton.setAttribute("type", "button");
      // Five identical "Edit" buttons are unnavigable by keyboard or screen reader, so each names
      // the story it acts on (debrief.js:78-81's argument).
      editButton.setAttribute("aria-label", COPY.editFor(story.title));
      editButton.addEventListener("click", () => openEditor(story.id));
      row.appendChild(editButton);

      const removeButton = el(
        doc,
        "button",
        "btn story-row-action",
        state.confirmingId === story.id ? COPY.confirmRemove : COPY.remove,
      );
      removeButton.setAttribute("type", "button");
      removeButton.setAttribute("aria-label", COPY.deleteFor(story.title));
      removeButton.addEventListener("click", () => {
        // Two taps, in the page. The first arms this row only — arming a second row disarms the
        // first, so there is never more than one primed Delete on screen.
        if (state.confirmingId !== story.id) {
          state.confirmingId = story.id;
          renderList();
          return undefined;
        }
        // Returned rather than fired and forgotten: the suite reaches this handler directly
        // (`node.listeners.click[0]()`) and has no other way to await the write it starts.
        return remove(story.id);
      });
      row.appendChild(removeButton);

      listMount.appendChild(row);
    }
  }

  /** One tick per competency on this role, reflecting the EDITOR's set rather than any stored row.
   *  An empty list is a real state — a handover that wrote no competencies still gets a page whose
   *  stories save. */
  function renderCovers() {
    coversMount.textContent = "";
    const title = String(titleBox.value ?? "") || COPY.titleLabel;
    for (const [index, competency] of state.competencies.entries()) {
      const row = el(doc, "div", "story-tick");
      const box = doc.createElement("input");
      box.setAttribute("type", "checkbox");
      box.setAttribute("id", `cover-${index}`);
      box.setAttribute("aria-label", COPY.coverFor(competency.label, title));
      box.checked = state.covers.has(competency.id);
      box.addEventListener("change", () => {
        if (box.checked) state.covers.add(competency.id);
        else state.covers.delete(competency.id);
      });
      const label = el(doc, "label", "story-tick-label", competency.label);
      label.setAttribute("for", `cover-${index}`);
      row.appendChild(box);
      row.appendChild(label);
      coversMount.appendChild(row);
    }
  }

  /** Every static string on the page, written once from COPY. */
  function renderChrome() {
    privateNote.textContent = COPY.privateNote;
    addButton.textContent = COPY.add;
    titleLabel.textContent = COPY.titleLabel;
    titleCaption.textContent = COPY.titleCaption;
    sketchLabel.textContent = COPY.sketchLabel;
    sketchCaption.textContent = COPY.sketchCaption;
    coversLabel.textContent = COPY.coversLabel;
    coversCaption.textContent = COPY.coversCaption;
    saveButton.textContent = COPY.save;
    cancelButton.textContent = COPY.cancel;
  }

  /** The forward-looking line, or nothing. Hidden rather than blank so the space closes up. */
  function renderGap() {
    if (state.gap) {
      gapLine.textContent = COPY.gap(state.gap.label);
      gapLine.hidden = false;
    } else {
      gapLine.textContent = "";
      gapLine.hidden = true;
    }
  }

  /**
   * Open the editor on a story, or on a new one when `storyId` is null.
   *
   * The editor's three controls are filled from the STORED row every time it opens, which is what
   * stops story B opening with story A's ticks still set — `state.covers` is the editor's set, not
   * the page's, and it is replaced rather than merged.
   */
  function openEditor(storyId) {
    if (storyId === null && state.stories.length >= state.maxStories) {
      return refuse(COPY.tooMany(state.maxStories), null);
    }
    const story = storyId === null ? null : state.stories.find((s) => s.id === storyId);
    // A story that vanished between the render and the tap (another tab deleted it) is not an
    // error worth a line — the list is about to be re-fetched anyway.
    if (storyId !== null && !story) return load();

    /* TWO TAPS TO DISCARD, on the delete button's own idiom. "Add a story" is full-width and sits
       directly above the editor, and nothing here is disabled while the editor is open — so the
       mis-tap that throws away 1,500 characters is a thumb's width away at all times. Armed per
       TARGET rather than as a flag, so arming on one row and then tapping another re-arms rather
       than opening the second row unwarned. `undefined` is the unarmed value because `null` is a
       real target: the new story. */
    if (isDirty()) {
      if (state.discardArmed !== storyId) {
        state.discardArmed = storyId;
        showState(COPY.unsavedWarning, true);
        return Promise.resolve();
      }
    }
    state.discardArmed = undefined;

    /* A primed "Really delete?" was cleared here without redrawing the row that says it, so the
       label survived on screen and lied about its state — the next tap on it deleted a story the
       candidate believed they had backed out of. */
    const wasConfirming = state.confirmingId !== null;

    state.editingId = storyId;
    /* Pruned to the competencies the server currently knows, exactly as the keepLive branch in
       `render` does. Loading them raw was the one path that did not, and it is the path that POSTs
       them: an id removed by a re-handover would come back 404 from the route, and 404 is not 401,
       so the page would offer "try again in a moment" about a request that can never succeed. */
    const known = new Set(state.competencies.map((c) => c.id));
    state.covers = new Set((story?.competency_ids ?? []).filter((id) => known.has(id)));
    state.confirmingId = null;
    titleBox.value = story?.title ?? "";
    sketchBox.value = story?.sketch ?? "";
    renderCovers();
    if (wasConfirming) renderList();
    editor.hidden = false;
    // The boxes now hold exactly what the server holds — a new story's blank pair included.
    editorBaseline = editorSnapshot();
    clearState();
    return Promise.resolve();
  }

  function closeEditor() {
    state.editingId = undefined;
    state.covers = new Set();
    state.discardArmed = undefined;
    editorBaseline = null;
    titleBox.value = "";
    sketchBox.value = "";
    editor.hidden = true;
    coversMount.textContent = "";
  }

  /** Fill the whole page from a GET payload. */
  function render(payload) {
    state.competencies = (payload.competencies ?? []).map((c) => ({
      id: String(c.id),
      label: String(c.label ?? ""),
    }));
    state.stories = (payload.stories ?? []).map((s) => ({
      id: String(s.id),
      title: String(s.title ?? ""),
      sketch: String(s.sketch ?? ""),
      competency_ids: (s.competency_ids ?? []).map(String),
    }));
    state.gap = payload.story_gap
      ? { id: String(payload.story_gap.id), label: String(payload.story_gap.label ?? "") }
      : null;
    state.maxStories = Number(payload.max_stories ?? 0);

    /* The editor holds something the server does not, so the row that just came back cannot
       contain it. Writing that row over these three controls is the same failure as a wiped box on
       a failed save — a candidate on a phone taps Save, remembers the rest of the story, types it
       while the request is out, and watches it vanish under the word "Saved". Everything OUTSIDE
       the editor still re-renders from the server.

       ANY round trip, not just a save's: this used to ask whether a save was in flight, which left
       `remove`'s re-fetch free to overwrite a rewritten sketch under the word "Deleted." */
    const keepLive = isDirty();

    if (!keepLive && state.editingId !== undefined) {
      const still = state.stories.find((s) => s.id === state.editingId);
      if (still) {
        titleBox.value = still.title;
        sketchBox.value = still.sketch;
        state.covers = new Set(still.competency_ids);
        // These boxes now hold the server's row, so nothing is outstanding against it.
        editorBaseline = editorSnapshot();
      }
    } else if (keepLive) {
      /* The competency list is still the server's, even here — so a kept tick can be left pointing
         at a competency a re-handover removed while the request was out. The next save would post
         an id the route answers 404 for, and 404 is not 401, so the page would offer "try again in
         a moment" about a request that can never succeed: the dead end the cap guards exist to
         remove, re-entered through this exception. debrief.js:317-327 applies the same rule. */
      const known = new Set(state.competencies.map((c) => c.id));
      for (const id of [...state.covers]) if (!known.has(id)) state.covers.delete(id);
    }

    renderChrome();
    renderGap();
    renderList();
    if (state.editingId !== undefined) renderCovers();
    storybank.hidden = false;
    unavailable.hidden = true;
    state.phase = "ready";
  }

  /**
   * The session has gone — rotated away by a sign-in elsewhere, run out, or erased by delete-now.
   * The login page can explain itself; an error line on a page they cannot use cannot. `replace`,
   * not `assign`: a dead page should not sit in the history for Back to land on.
   *
   * It returns the BOUNCED sentinel rather than a never-resolving promise (debrief.js:338-348's
   * argument): this controller's `ready` is what the suite awaits, and a chain that never settles
   * is a suite that hangs rather than fails.
   */
  const BOUNCED = Symbol("bounced");
  /** The 404 answer, carried through the chain the same way, so neither state is a thrown error. */
  const NOT_READY = Symbol("not_ready");
  function bounce() {
    go("/prep/login");
    return BOUNCED;
  }

  /** The section that stands in for the page: a real state, said plainly, with the way back. */
  function nothingYet(message) {
    state.phase = "not-ready";
    privateNote.textContent = COPY.privateNote;
    unavailableNote.textContent = message;
    unavailable.hidden = false;
    storybank.hidden = true;
    clearState();
  }

  /** Fetch and render. `note` is what the state line says afterwards. */
  function load(note) {
    return fetchFn(COLLECTION, { headers: { accept: "application/json" } })
      .then((res) => {
        if (res.status === 401) return bounce();
        // The handover has not been written yet — a real state, not a failure, and it gets the
        // "not ready yet" copy rather than the "something went wrong" copy (brief.js:74-75's
        // register).
        if (res.status === 404) return NOT_READY;
        if (!res.ok) throw new Error(`stories: ${res.status}`);
        return res.json();
      })
      .then((payload) => {
        if (payload === BOUNCED) return;
        if (payload === NOT_READY) return nothingYet(COPY.notReady);
        if (!payload || !Array.isArray(payload.stories)) throw new Error("stories: no state");

        render(payload);
        if (note) showState(note, false);
        else clearState();
      })
      .catch((err) => {
        console.error("prep stories: could not load", err);
        state.phase = "failed";
        showState(COPY.failed, true);
      });
  }

  /**
   * Save the editor — a POST to the collection for a new story, to the item route for an edit —
   * then re-fetch.
   *
   * The two routes are one function here because the page's job is identical either way; only the
   * URL and the body's vocabulary differ, and the collection route deliberately has no `id` to
   * send it.
   */
  function save() {
    if (state.inFlight) return Promise.resolve();
    if (state.editingId === undefined) return Promise.resolve();

    /* The caps first, because the route's answer to any of them is a 400 and everything below
       reads a non-401 failure as transient — an unguarded save would tell someone to "try again in
       a moment" about a request that can never succeed, on a page with nothing in browser storage
       to reload from. */
    const title = String(titleBox.value ?? "").trim();
    const sketch = String(sketchBox.value ?? "");
    if (!title) return refuse(COPY.titleMissing, titleBox);
    if (title.length > TITLE_MAX) return refuse(COPY.titleTooLong, titleBox);
    if (sketch.length > SKETCH_MAX) return refuse(COPY.sketchTooLong, sketchBox);

    const isNew = state.editingId === null;
    if (isNew && state.stories.length >= state.maxStories) {
      return refuse(COPY.tooMany(state.maxStories), null);
    }

    busy(true);
    showState(COPY.saving, false);

    const body = isNew
      ? { title, sketch, competency_ids: [...state.covers] }
      : { action: "save", id: state.editingId, title, sketch, competency_ids: [...state.covers] };
    sentSnapshot = editorSnapshot();

    return fetchFn(isNew ? COLLECTION : ITEM, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
      .then((res) => {
        if (res.status === 401) {
          // Released BEFORE leaving: if `replace` is slow, blocked or ignored, the page must not
          // be left dead on "Saving…" with the button refusing every click.
          busy(false);
          bounce();
          return;
        }
        /* 404 IS NOT TRANSIENT and must not be funnelled into "try again in a moment". The route
           answers it when the story was deleted elsewhere, or when a posted competency_id is
           unknown — a retry can never succeed and no amount of waiting repairs it. Re-fetch the
           list so the page stops lying about what exists, and leave the boxes alone: the words are
           the one thing here that cannot be re-derived. `keepLive` protects them through the
           re-fetch, because the editor is dirty against a row the server no longer has. */
        if (res.status === 404) {
          /* THE EDITOR MOVES TO A NEW STORY, and the copy below is why. Leaving `editingId` on the
             dead row would make the next Save re-POST to the item route and 404 again — the copy
             would be promising a way out the code did not have, which is the same dead end this
             branch exists to close, one turn further on. Their words stay in the boxes; `keepLive`
             carries them through the re-fetch, because the editor is now dirty against a row the
             server no longer holds. */
          state.editingId = null;
          return load().then(() => {
            busy(false);
            showState(COPY.saveGone, true);
          });
        }
        if (!res.ok) throw new Error(`stories: ${res.status}`);
        return res.json().then((answer) => {
          /* A new story's id comes back, so the editor stays on the row it just created rather
             than guessing which of the re-fetched stories is the one. Guarded on the editor STILL
             being on that new story: Cancel during the round trip sets `editingId` to `undefined`
             and hides the editor, and assigning the id here regardless left a hidden editor
             pointing at a real row — a later Save would then focus an invisible input. */
          if (isNew && answer && answer.id && state.editingId === null) {
            state.editingId = String(answer.id);
          }
          // What the server now holds is what was POSTED, not what the boxes hold — see
          // `editorBaseline`. Read before `load`, which renders against it.
          const stored = sentSnapshot;
          // Re-read rather than patch: what the page shows is what the server stored — except for
          // anything edited while this request was out, which `render` keeps.
          return load(COPY.saved).then(() => {
            if (state.editingId !== undefined) editorBaseline = stored;
            busy(false);
          });
        });
      })
      .catch((err) => {
        console.error("prep stories: could not save", err);
        busy(false);
        // The boxes are deliberately untouched. A failed save that also cleared a story someone
        // spent five minutes writing is the one failure this page cannot afford.
        showState(COPY.saveFailed, true);
      })
      .finally(() => {
        sentSnapshot = null;
      });
  }

  /** Delete one story, then re-fetch. Reached only from the second tap of its own button. */
  function remove(storyId) {
    if (state.inFlight) return Promise.resolve();
    busy(true);
    showState(COPY.deleting, false);

    return fetchFn(ITEM, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "delete", id: storyId }),
    })
      .then((res) => {
        if (res.status === 401) {
          busy(false);
          bounce();
          return;
        }
        if (!res.ok) throw new Error(`stories: ${res.status}`);
        state.confirmingId = null;
        // The editor cannot stay open on a row that no longer exists.
        if (state.editingId === storyId) closeEditor();
        return load(COPY.deleted).then(() => busy(false));
      })
      .catch((err) => {
        console.error("prep stories: could not delete", err);
        busy(false);
        state.confirmingId = null;
        renderList();
        showState(COPY.deleteFailed, true);
      });
  }

  /* ── wiring ──────────────────────────────────────────────────────────────────────────── */

  addButton.addEventListener("click", () => openEditor(null));
  saveButton.addEventListener("click", () => save());
  cancelButton.addEventListener("click", () => {
    closeEditor();
    clearState();
  });
  // The tick labels name the story being edited, so they follow the title as it is typed. Both
  // events, because a phone keyboard's autocomplete fires `change` without an `input` on some
  // engines and a desktop keyboard fires `input` without a `change` until blur; re-rendering twice
  // is harmless, and every tick survives it because `state.covers` is what the boxes read from.
  titleBox.addEventListener("input", () => renderCovers());
  titleBox.addEventListener("change", () => renderCovers());

  showState(COPY.loading, false);

  const controller = { state, save, remove, render, renderList, openEditor, closeEditor };
  controller.ready = load();
  return controller;
}
