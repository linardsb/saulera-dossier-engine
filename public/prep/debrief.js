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
 *
 * The re-fetch has ONE exception, and it is the same failure on the path where the save WORKED:
 * anything edited between the POST leaving and the answer landing is not in the row that comes
 * back, so rendering the row over it would erase words the candidate watched themselves type
 * while the state line said "Saved". `sentSnapshot` is what makes that difference visible.
 */

const SOURCE = "/prep/api/debrief";

/* The route's caps (functions/prep/api/debrief.js:59,63,67), mirrored so an over-long note is
   refused HERE with copy that names the limit, instead of bouncing off the route's 400 wearing
   retry advice that can never succeed — session.js:32-33's rule, and the same reason. It matters
   more on this page than on that one: nothing is written to browser storage here, so a candidate
   stuck on an unsatisfiable retry has only the reload, and the reload costs them everything. */
const MAX_ASKED = 20;
const LINE_MAX = 500;
const FIX_MAX = 2_000;

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

  /* The three refusals. Each names the box and the actual limit, because "try again" is the one
     thing that cannot help here — and each says the words are safe, because on this page that is
     the question the candidate is really asking. */
  tooManyAsked:
    `There is room for ${MAX_ASKED} questions here, and there are more than that below. Take out ` +
    "the ones you need least, then save again. Nothing goes anywhere until you do.",
  lineTooLong:
    `One of those lines is very long. Keep each question under ${LINE_MAX} characters. It is ` +
    "meant to be roughly what they said, not word for word.",
  fixTooLong: `That is longer than this box can save. Keep it under ${FIX_MAX} characters.`,

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
       deleted.

       KEYED BY ROW INDEX, not by the line's text (#82). A text key made three states wrong at
       once: fixing a typo in a placed line minted a new key per keystroke and silently reset the
       pick, two identical lines collapsed to one entry so the second saved with a pick its picker
       never showed, and a deleted-then-retyped line came back pre-placed at a pick the candidate
       had removed. An index key is only meaningful against ONE reading of the box, so
       `carryPlacements` re-keys the map whenever the line set changes — that diff is what keeps
       the delete-a-sibling property the old key bought for free. The server still keys
       `asked_json` on trimmed text; `save` builds that pairing per row, so nothing on the wire
       changed. */
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

  /* What the form held when the last POST went out, or null when no save is in flight. The
     candidate is the ONLY thing that edits this form, so anything that differs from this when the
     re-fetch lands was typed during the round trip and is not in the row the server handed back. */
  let sentSnapshot = null;

  /* The lines as they stood at the last render — what an index into `state.placements` is an
     index INTO. `carryPlacements` diffs against this; `render` resets it with the server's row. */
  let renderedLines = [];

  /**
   * Re-key an index-keyed placement map from one reading of the box to the next.
   *
   * The alignment is common-prefix, common-suffix, and the middle carried only when it is one
   * row on both sides — the typo fix, the only middle whose pairing is certain. A wider middle
   * (a select-all paste, a reorder) offers no evidence which old line became which new one, so
   * its picks are dropped rather than guessed: an unplaced picker is visible on screen, a pick
   * carried onto the wrong question is not.
   *
   *   · delete a sibling — the survivors are all prefix or suffix, so their picks shift with them
   *   · edit a line in place — a one-row middle both sides, so the row keeps its pick
   *   · delete a line — its middle row pairs with nothing, so the pick goes with the line
   *   · retype a deleted line — a fresh row, arriving unplaced, because its pick already went
   *   · paste over several lines — every replaced row arrives unplaced, never pre-placed
   */
  function carryPlacements(oldLines, newLines, placements) {
    let prefix = 0;
    while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) {
      prefix += 1;
    }
    let suffix = 0;
    while (
      suffix < oldLines.length - prefix &&
      suffix < newLines.length - prefix &&
      oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
    ) {
      suffix += 1;
    }

    const next = new Map();
    const shift = newLines.length - oldLines.length;
    const middleIsOneForOne =
      oldLines.length - prefix - suffix === 1 && newLines.length - prefix - suffix === 1;
    for (const [index, id] of placements) {
      if (index < prefix) next.set(index, id);
      else if (index >= oldLines.length - suffix) next.set(index + shift, id);
      else if (middleIsOneForOne) next.set(index, id);
    }
    return next;
  }

  /** The four candidate-owned values as one comparable string — the two boxes, the ticks and the
   *  picks. Everything else on the page is the server's to decide. */
  function formSnapshot() {
    return JSON.stringify([
      String(askedBox.value ?? ""),
      String(fixBox.value ?? ""),
      [...state.shaky].sort(),
      [...state.placements].sort(),
    ]);
  }

  /** Refuse a save the route would answer 400, in the state line, with the box at fault focused.
   *  `focus` is guarded because the suite's document double does not move focus (session.js:509). */
  function refuse(message, box) {
    showState(message, true);
    if (typeof box.focus === "function") box.focus();
    return Promise.resolve();
  }

  /**
   * One labelled picker per line, rebuilt from the box.
   *
   * A surviving line keeps its pick because `carryPlacements` re-keys the map before every
   * rebuild the box's edits cause — deleting the first of three lines must not shuffle the other
   * two pickers up onto the wrong questions, and fixing a typo in a placed line must not reset
   * its picker to "Not sure yet" (#82).
   */
  function renderLines() {
    const lines = linesOf();
    renderedLines = lines;
    linesMount.textContent = "";
    for (const [index, line] of lines.entries()) {
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
      picker.value = state.placements.get(index) ?? "";
      picker.addEventListener("change", () => {
        const chosen = String(picker.value ?? "");
        if (chosen) state.placements.set(index, chosen);
        else state.placements.delete(index);
      });

      row.appendChild(picker);
      linesMount.appendChild(row);
    }
  }

  /**
   * The box's two listeners land here, not on `renderLines` directly (#83 M7). `change` on a
   * textarea fires during the blur of a focus transfer, and an unconditional rebuild at that
   * moment destroys the node focus is moving TO — tab out of the box into a picker and the
   * keyboard user lands back on <body>, restarting from the top of the document. By blur time
   * `input` has already rendered every content edit, so a guard on the line set actually having
   * changed makes that `change` a no-op — and stops edits that alter no trimmed line (a trailing
   * space, a blank line) rebuilding N selects per keystroke.
   */
  function linesEdited() {
    const lines = linesOf();
    if (lines.join("\n") === renderedLines.join("\n")) return;
    state.placements = carryPlacements(renderedLines, lines, state.placements);
    renderLines();
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
    /* A save is in flight and the form no longer matches what it carried, so every difference was
       typed DURING the round trip. The row that just came back cannot contain it. Writing that row
       over the four controls here is the same failure as a wiped box on a failed save — a
       candidate on a phone taps Save, remembers question eight, types it while the request is out,
       and watches it vanish under the word "Saved". The re-fetch still decides everything else. */
    const keepLive = sentSnapshot !== null && formSnapshot() !== sentSnapshot;

    if (!keepLive) {
      state.shaky = new Set((payload.shaky ?? []).map(String));

      // Row order in the box IS the index the placements are keyed by, so both are built from
      // one walk over the payload — a second walk with its own filter could disagree by one row.
      const asked = Array.isArray(payload.asked) ? payload.asked : [];
      state.placements = new Map();
      const lines = [];
      for (const entry of asked) {
        const text = String(entry?.text ?? "").trim();
        if (!text) continue;
        if (entry?.competency_id) state.placements.set(lines.length, String(entry.competency_id));
        lines.push(text);
      }
      askedBox.value = lines.join("\n");
      fixBox.value = String(payload.fix_text ?? "");
    } else {
      /* The competency list is still the server's, even here — so a kept placement can be left
         pointing at a competency a re-handover removed while the request was out. The next save
         would post an id the route answers 404 for, and 404 is not 401, so the page would offer
         "try again in a moment" about a request that can never succeed: the dead end the cap
         guard above exists to remove, re-entered through this exception. The route applies this
         same rule on the way out (`askedFrom`'s `known` set); this is it on the way in. */
      const known = new Set(state.competencies.map((c) => c.id));
      for (const [index, id] of state.placements) {
        if (!known.has(id)) state.placements.delete(index);
      }
    }

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
    /* A screen-reader user has heard "Loading…" from the live region and then, without this,
       nothing — `clearState` empties the page's only role="status" and the answer sits in a
       plain <p> (#83 M8). Announced by a focus move rather than by `showState`, because the
       state line and this note are both on screen: the same copy twice, once as an answer and
       once as a status, reads as two messages. session.js:611-615 is the precedent — negative
       tabindex only, so the note is focusable but never in the tab order, and the focus call is
       guarded because the suite's document double does not move focus. */
    unavailableNote.setAttribute("tabindex", "-1");
    if (typeof unavailableNote.focus === "function") unavailableNote.focus();
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

    /* The caps first, because the route's answer to any of them is a 400 and everything below
       reads a non-401 failure as transient — an unguarded save would tell someone to "try again
       in a moment" about a request that can never succeed, on a page with nothing in browser
       storage to reload from. */
    const lines = linesOf();
    if (lines.length > MAX_ASKED) return refuse(COPY.tooManyAsked, askedBox);
    if (lines.some((line) => line.length > LINE_MAX)) return refuse(COPY.lineTooLong, askedBox);
    if (String(fixBox.value ?? "").length > FIX_MAX) return refuse(COPY.fixTooLong, fixBox);

    busy(true);
    showState(COPY.saving, false);

    const body = {
      asked: lines.map((text, index) => ({ text, competency_id: state.placements.get(index) ?? null })),
      shaky: [...state.shaky],
      fix_text: String(fixBox.value ?? ""),
    };
    sentSnapshot = formSnapshot();

    return fetchFn(SOURCE, {
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
        if (!res.ok) throw new Error(`debrief: ${res.status}`);
        // Re-read rather than patch: what the page shows is what the server stored — except for
        // anything edited while this request was out, which `render` keeps.
        return load(COPY.saved).then(() => busy(false));
      })
      .catch((err) => {
        console.error("prep debrief: could not save", err);
        busy(false);
        // The boxes are deliberately untouched. A failed save that also cleared what someone
        // typed on the way out of an interview is the one failure this page cannot afford.
        showState(COPY.saveFailed, true);
      })
      .finally(() => {
        sentSnapshot = null;
      });
  }

  /* ── wiring ──────────────────────────────────────────────────────────────────────────── */

  // Both, because a phone keyboard's autocomplete fires `change` without an `input` on some
  // engines, and a desktop keyboard fires `input` without a `change` until blur. `linesEdited`'s
  // guard is what makes the pair safe — see its comment.
  askedBox.addEventListener("input", () => linesEdited());
  askedBox.addEventListener("change", () => linesEdited());
  saveButton.addEventListener("click", () => save());

  showState(COPY.loading, false);

  const controller = { state, save, render, renderLines };
  controller.ready = load();
  return controller;
}
