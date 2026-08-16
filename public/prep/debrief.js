/* The candidate's private debrief (#77): what they were asked, what felt shaky, one thing to fix.
 *
 * A page controller in session.js's idiom, over one route (GET and POST /prep/api/debrief).
 *
 * Four decisions carried over from public/prep/brief.js and public/prep/session.js, for the
 * reasons stated there:
 *
 * 1. Nothing is written to browser storage of any kind — not local storage, not session storage,
 *    not cookies, not a database in the browser, not a cache. This is the most candidate-owned
 *    surface in the product: it holds what a stranger asked them and what they think went badly,
 *    and "your recruiter never sees any of it" has to include the browser or the sentence is not
 *    true. There is nothing to lose on refresh — the page refetches what was saved. (Written
 *    without the API names on purpose: the test's scan greps this file for them, and a gate that
 *    cries wolf at a comment gets deleted.)
 *
 * 2. Nothing candidate-shaped goes in the URL. Everything typed here travels in a POST body.
 *
 * 3. Text nodes, never an HTML-parsing assignment. Every string on this page is either COPY below
 *    or something the candidate typed and our own API handed back — which is exactly the value
 *    most likely to be trusted by accident.
 *
 * 4. MODULE DISCIPLINE: no document reads at module scope, so node --test can import this file
 *    with no DOM at all. debrief.html boots it with an inline module script; the suite calls
 *    initDebrief with a document double.
 *
 * NO MODEL CALL HAPPENS ANYWHERE IN THIS FEATURE, and this page is where that is most visible:
 * the competency a question belongs under is the CANDIDATE'S pick from a list, made by tapping.
 * Nothing infers it from the question text, nothing summarises the debrief, and nothing drafts
 * the "one thing to fix" — the first unloosenable rule of the spec, on the surface where it would
 * be most tempting to break.
 *
 * SAVE THEN RE-FETCH, never patch (passport.js's rule): what the page shows after a save is what
 * the server stored, so a local edit can never disagree with the row. The one thing kept locally
 * across a FAILED save is the text in the two boxes — losing what someone typed because the
 * network dropped is the failure this page can least afford.
 */

const SOURCE = "/prep/api/debrief";

/** Every visible string this file can produce, in one object — brief.js:25's idiom. Written for a
 *  candidate who has just walked out of an interview: no scores, no ranks, nothing that reads as
 *  an assessment of how they did. */
export const COPY = {
  loading: "Loading…",
  tooEarly:
    "This page opens after your interview. Come back once you have been, and you can note down " +
    "what you were asked while it is fresh.",
  notReady:
    "Your prep is not ready yet. Your recruiter is still putting it together, so check back " +
    "later today.",
  failed:
    "We could not load this just now. Reload the page, and if it still will not load, reply to " +
    "the email that invited you.",

  askedLabel: "What were you asked?",
  askedCaption:
    "One question per line, as close to their words as you remember. Half-remembered is fine.",

  placeLabel: "Put each question with the part of the job it was about",
  placeCaption:
    "This is how a question comes back to you next time you practise. Leave any of them on " +
    "“Not sure yet” and it stays on this page until you do.",
  unplaced: "Not sure yet",
  /* Every picker needs a programmatic label of its own. The line sitting next to it is not one:
     a screen reader moving control to control would announce five identical "Not sure yet"
     dropdowns with nothing to tell them apart. */
  placeFor: (line) => `Which part of the job was this about: ${line}`,

  shakyLabel: "Anything that felt shaky?",
  shakyCaption:
    "Tick whatever you would want another go at. Nothing here is a mark, and nobody sees it.",

  fixLabel: "One thing to do differently next time",
  fixCaption: "One is enough. It is easier to change one thing than five.",

  save: "Save this",
  saving: "Saving…",
  saved: "Saved. You can come back and add to this whenever you like.",
  saveFailed: "Could not save that just now. Try again in a moment. Your words are still below.",

  privateNote: "This page is yours. Your recruiter never sees any of it.",
};

/** An element with its text set — session.js:97's helper, retyped for the same reason. */
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
 * browser at all. `navigate` defaults to a location replace (brief.js:67's reasoning — a
 * candidate whose session has gone is a person in front of a browser, and `replace` keeps the
 * dead page out of Back's reach).
 *
 * Returns `{ state, save, render, ready }` — the DOM handlers delegate to these, and the tests
 * call them directly because the document double records listeners without dispatching. `ready`
 * settles when the initial load has routed.
 */
export function initDebrief({ doc, fetchImpl, navigate } = {}) {
  doc = doc ?? globalThis.document;
  const fetchFn = fetchImpl ?? ((...args) => globalThis.fetch(...args));
  const go = navigate ?? ((url) => globalThis.location.replace(url));

  const $ = (id) => doc.getElementById(id);
  const stateLine = $("debrief-state");
  const privateNote = $("private-note");
  const unavailable = $("unavailable");
  const unavailableNote = $("unavailable-note");
  const formSection = $("debrief-form");
  const askedLabel = $("asked-label");
  const askedBox = $("asked");
  const askedCaption = $("asked-caption");
  const placeLabel = $("place-label");
  const placeCaption = $("place-caption");
  const linesMount = $("asked-lines");
  const shakyLabel = $("shaky-label");
  const shakyCaption = $("shaky-caption");
  const shakyMount = $("shaky-list");
  const fixLabel = $("fix-label");
  const fixBox = $("fix");
  const fixCaption = $("fix-caption");
  const saveButton = $("save");

  const state = {
    phase: "loading", // loading | too-early | ready | failed
    competencies: [], // [{id, label}] — the picker's options and the tick list
    /* Placement is kept HERE rather than read back off the <select> elements at save time. The
       rows are rebuilt every time the box is edited, so the elements are transient and this map
       is what survives a rebuild — which is how a line keeps its pick when the line above it is
       deleted. Keyed by the trimmed line text, because that is what the server keys on too. */
    placements: new Map(),
    shaky: new Set(), // competency ids ticked
    inFlight: false, // one save at a time
  };

  /** The state line, in app.js's grammar. Assigned as a whole class string rather than toggled,
   *  so the document double's minimal class support can carry it (session.js:188-193). */
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

  /** The non-blank lines of the asked box, trimmed — the same normalisation the route applies,
   *  so what the page thinks it is saving is what the route stores and hashes. */
  function linesOf() {
    return String(askedBox.value ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }

  /**
   * One labelled picker per line, rebuilt from the box.
   *
   * A surviving line keeps its pick because `state.placements` is keyed by the line's own text,
   * not by its position — deleting the first of three lines must not shuffle the other two
   * pickers up onto the wrong questions.
   */
  function renderLines() {
    const lines = linesOf();
    linesMount.textContent = "";
    for (const line of lines) {
      const row = el(doc, "div", "debrief-line");
      row.appendChild(el(doc, "span", "debrief-line-text", line));

      const picker = el(doc, "select", "select");
      picker.setAttribute("aria-label", COPY.placeFor(line));
      // "Not sure yet" first and selected by default: an unplaced line is a real state, and the
      // list must not open on a competency the candidate has not chosen.
      const none = el(doc, "option", null, COPY.unplaced);
      none.setAttribute("value", "");
      picker.appendChild(none);
      for (const competency of state.competencies) {
        const option = el(doc, "option", null, competency.label);
        option.setAttribute("value", competency.id);
        picker.appendChild(option);
      }
      picker.value = state.placements.get(line) ?? "";
      picker.addEventListener("change", () => {
        const chosen = String(picker.value ?? "");
        if (chosen) state.placements.set(line, chosen);
        else state.placements.delete(line);
      });

      row.appendChild(picker);
      linesMount.appendChild(row);
    }
  }

  /** One tick per competency on this role. An empty list is a real state — a handover that wrote
   *  no competencies still gets a page whose text saves. */
  function renderShaky() {
    shakyMount.textContent = "";
    for (const [index, competency] of state.competencies.entries()) {
      const row = el(doc, "div", "debrief-tick");
      const box = doc.createElement("input");
      box.setAttribute("type", "checkbox");
      box.setAttribute("id", `shaky-${index}`);
      box.checked = state.shaky.has(competency.id);
      box.addEventListener("change", () => {
        if (box.checked) state.shaky.add(competency.id);
        else state.shaky.delete(competency.id);
      });
      const label = el(doc, "label", "debrief-tick-label", competency.label);
      label.setAttribute("for", `shaky-${index}`);
      row.appendChild(box);
      row.appendChild(label);
      shakyMount.appendChild(row);
    }
  }

  /** Every static string on the form, written once from COPY. */
  function renderChrome() {
    privateNote.textContent = COPY.privateNote;
    askedLabel.textContent = COPY.askedLabel;
    askedCaption.textContent = COPY.askedCaption;
    placeLabel.textContent = COPY.placeLabel;
    placeCaption.textContent = COPY.placeCaption;
    shakyLabel.textContent = COPY.shakyLabel;
    shakyCaption.textContent = COPY.shakyCaption;
    fixLabel.textContent = COPY.fixLabel;
    fixCaption.textContent = COPY.fixCaption;
    saveButton.textContent = COPY.save;
  }

  /** Fill the whole form from a GET payload. */
  function render(payload) {
    state.competencies = (payload.competencies ?? []).map((c) => ({
      id: String(c.id),
      label: String(c.label ?? ""),
    }));
    state.shaky = new Set((payload.shaky ?? []).map(String));

    const asked = Array.isArray(payload.asked) ? payload.asked : [];
    state.placements = new Map();
    for (const entry of asked) {
      const text = String(entry?.text ?? "").trim();
      if (text && entry?.competency_id) state.placements.set(text, String(entry.competency_id));
    }
    askedBox.value = asked.map((entry) => String(entry?.text ?? "").trim()).filter(Boolean).join("\n");
    fixBox.value = String(payload.fix_text ?? "");

    renderChrome();
    renderLines();
    renderShaky();
    formSection.hidden = false;
    unavailable.hidden = true;
    state.phase = "ready";
  }

  /**
   * The session has gone — rotated away by a sign-in elsewhere, run out, or erased by delete-now.
   * The login page can explain itself; an error line on a page they cannot use cannot. `replace`,
   * not `assign`: a dead page should not sit in the history for Back to land on.
   *
   * It returns the BOUNCED sentinel rather than brief.js's never-resolving promise, and the
   * difference is deliberate: this controller's `ready` is what the suite awaits, and a chain
   * that never settles is a suite that hangs rather than fails. Every caller checks for the
   * sentinel and says nothing — which is the property the never-resolving promise was buying
   * (no error line flashing over a page that is already leaving), reached without the deadlock.
   */
  const BOUNCED = Symbol("bounced");
  /** The 404 answer, carried through the chain the same way, so neither state is a thrown error. */
  const NOT_READY = Symbol("not_ready");
  function bounce() {
    go("/prep/login");
    return BOUNCED;
  }

  /** The section that stands in for the form: a real state, said plainly, with the way back. It
   *  is the same section for both, because to a candidate they are the same answer — there is
   *  nothing to fill in here yet — and two sections would be two places for the copy to drift. */
  function nothingYet(phase, message) {
    state.phase = phase;
    privateNote.textContent = COPY.privateNote;
    unavailableNote.textContent = message;
    unavailable.hidden = false;
    formSection.hidden = true;
    clearState();
  }

  /** Fetch and render. `note` is what the state line says afterwards. */
  function load(note) {
    return fetchFn(SOURCE, { headers: { accept: "application/json" } })
      .then((res) => {
        if (res.status === 401) return bounce();
        // The handover has not been written yet — a real state, not a failure, and it gets the
        // "not ready yet" copy rather than the "something went wrong" copy. It is the same
        // register brief.js:74-75 and session.js:228-232 draw, and it is nearly unreachable here
        // because neither entry link is shown without a handover: a typed URL is how you get it.
        if (res.status === 404) return NOT_READY;
        if (!res.ok) throw new Error(`debrief: ${res.status}`);
        return res.json();
      })
      .then((payload) => {
        if (payload === BOUNCED) return;
        if (payload === NOT_READY) return nothingYet("not-ready", COPY.notReady);
        if (!payload || typeof payload.available !== "boolean") throw new Error("debrief: no state");

        if (!payload.available) {
          // Not a failure: the interview has not happened yet, so there is nothing to write down.
          nothingYet("too-early", COPY.tooEarly);
          return;
        }

        render(payload);
        if (note) showState(note, false);
        else clearState();
      })
      .catch((err) => {
        console.error("prep debrief: could not load", err);
        state.phase = "failed";
        showState(COPY.failed, true);
      });
  }

  /**
   * Save the whole form state, then re-fetch.
   *
   * The body is built from `linesOf()` and `state.placements` rather than from what was last
   * rendered, so a line typed after the last picker render is still saved — it simply saves
   * unplaced, which is exactly what it is.
   */
  function save() {
    if (state.inFlight) return Promise.resolve();
    busy(true);
    showState(COPY.saving, false);

    const body = {
      asked: linesOf().map((text) => ({ text, competency_id: state.placements.get(text) ?? null })),
      shaky: [...state.shaky],
      fix_text: String(fixBox.value ?? ""),
    };

    return fetchFn(SOURCE, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
      .then((res) => {
        if (res.status === 401) {
          bounce();
          return;
        }
        if (!res.ok) throw new Error(`debrief: ${res.status}`);
        // Re-read rather than patch: what the page shows is what the server stored.
        return load(COPY.saved).then(() => busy(false));
      })
      .catch((err) => {
        console.error("prep debrief: could not save", err);
        busy(false);
        // The boxes are deliberately untouched. A failed save that also cleared what someone
        // typed on the way out of an interview is the one failure this page cannot afford.
        showState(COPY.saveFailed, true);
      });
  }

  /* ── wiring ──────────────────────────────────────────────────────────────────────────── */

  // Both, because a phone keyboard's autocomplete fires `change` without an `input` on some
  // engines, and a desktop keyboard fires `input` without a `change` until blur. Re-rendering
  // twice is harmless — every pick survives it.
  askedBox.addEventListener("input", () => renderLines());
  askedBox.addEventListener("change", () => renderLines());
  saveButton.addEventListener("click", () => save());

  showState(COPY.loading, false);

  const controller = { state, save, render, renderLines };
  controller.ready = load();
  return controller;
}
