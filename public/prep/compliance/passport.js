/* The locum's compliance checklist (#68).
 *
 * Fetch the checklist, render one card per item, and let an outstanding one be handed over from
 * a phone. Everything between the topbar and the footer is built here.
 *
 * Four decisions carried over from public/prep/brief.js and public/prep/registry.js, for the
 * reasons stated there:
 *
 * 1. Nothing is written to browser storage of any kind — not local storage, not session storage,
 *    not cookies, not a database in the browser, not a cache. Compliance state is candidate data
 *    and health-adjacent; "we hold only a reference and a date" has to include the browser or
 *    the sentence is not true. There is nothing to lose on refresh: the page refetches.
 *    (Written without the API names on purpose: the Level 1 gate greps this file for them.)
 *
 * 2. Nothing candidate-shaped goes in the URL.
 *
 * 3. Text nodes, never an HTML-parsing assignment. A reference number is text a stranger typed
 *    into a phone, and it comes back out of our own API — which is exactly the value most likely
 *    to be trusted by accident.
 *
 * 4. METADATA ONLY, structurally. Nothing on this page accepts a document — not a photo, not a
 *    PDF, not a link to one — because spike #66 decided no document byte rests on our
 *    infrastructure. Documents keep moving over the agency's existing channels, and the caption
 *    under every form says so in plain words rather than leaving it to be discovered. (Written
 *    without the upload API names on purpose: test/compliance-pages.test.js greps this file for
 *    them, and a gate that cries wolf at a comment gets deleted.)
 *
 * After a successful submit the page re-fetches rather than patching the card it just wrote.
 * The count, the chip and the meta line all derive from the server's answer, so a local edit is
 * three chances for the screen to disagree with the database — over a surface whose whole
 * purpose is telling someone the truth about what is outstanding.
 */

const SOURCE = "/prep/compliance/api/items";

/** Every visible string, in one object — public/app.js:47's idiom. */
const COPY = {
  failed:
    "We could not load your checklist just now. Reload the page, and if it still will not load, " +
    "contact the agency you are registered with.",

  /* The count line. Written for someone who has never used the word "compliance" about
     themselves, and never as a score: "3 of 8 done" is a list with items left on it, not a mark
     out of eight. */
  count: (done, total) => `${done} of ${total} done`,
  awaiting: (n) =>
    n === 1 ? " · 1 is with the agency to check" : ` · ${n} are with the agency to check`,

  /* The chip WORD, per status. Short on purpose: app.css's .mark is uppercase, tracked and
     nowrap, so a sentence here would be an unbreakable bar across a 390px screen. The sentence
     goes on the line underneath, where it can wrap. A chip is a word wearing a colour. */
  chip: {
    missing: "Not started",
    submitted: "Sent in",
    verified: "Checked",
    expiring: "Expiring",
    expired: "Out of date",
  },

  /* The same five states, said properly. */
  meaning: {
    missing: "We do not have this yet.",
    submitted: "We have this. The agency is checking it.",
    verified: "Checked and in order.",
    expiring: "This runs out soon. Send us the new one.",
    expired: "This has run out. Send us the new one.",
  },

  referenceLabel: "Reference or certificate number",
  expiryLabel: "Date it runs out",
  submit: "Send this",
  sending: "Sending…",
  sendFailed: "Could not save that just now. Try again in a moment.",
  referenceMissing: "Enter the reference number.",
  expiryMissing: "Enter the date it runs out.",
  saved: "Saved. Thank you.",

  noDocuments:
    "We do not store your documents. Send those to the agency the way you always have. Here we " +
    "keep only the reference number and the date it runs out.",

  held: (reference) => `Reference: ${reference}`,
  runsOut: (date) => `Runs out ${date}`,

  deleteConfirm:
    "This erases your whole compliance record: every reference number, every date, and the " +
    "history of what you have sent. It cannot be undone, and the agency will have to start " +
    "again with you. Delete it?",
  deleting: "Deleting…",
  deleteFailed: "Could not delete just now. Try again in a moment.",

  // The deployment fault, which is nobody's fault on this side of the screen.
  notConfigured:
    "This page is not connected to its database yet. Ask the agency you are registered with.",
};

const $ = (id) => document.getElementById(id);

const countLine = $("count");
const mount = $("items");
const state = $("state");
const deleteButton = $("delete");

/** The state line, in app.js's grammar: `.is-shown` to reveal, `.is-error` for a failure. */
function showState(message, isError) {
  state.textContent = message;
  state.classList.toggle("is-error", Boolean(isError));
  state.classList.add("is-shown");
}

function clearState() {
  state.textContent = "";
  state.classList.remove("is-error", "is-shown");
}

/* aria-disabled rather than disabled: setting `disabled` on the focused button drops focus to
   <body> and does not give it back, so someone working through the list by keyboard loses their
   place at the moment they act. app.css styles both the same way. */
function busy(button, isBusy) {
  button.setAttribute("aria-disabled", isBusy ? "true" : "false");
}
const isBusy = (button) => button.getAttribute("aria-disabled") === "true";

/**
 * A stored 'YYYY-MM-DD' as a date a person reads.
 *
 * Parsed as UTC and formatted in UTC. A date-only string is read as LOCAL midnight by every
 * engine, so west of Greenwich "2027-03-01" renders as 28 February — a date that is one day
 * wrong on the one screen that exists to tell someone when their certificate lapses.
 */
function readableDate(value) {
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(ms)) return value;
  return new Date(ms).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** An element with text, built the only way anything is built here. */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.appendChild(document.createTextNode(text));
  return node;
}

/** A labelled field. The `.input` class is what raises the control to 16px (prep.css). */
function field(id, labelText, type) {
  const label = el("label", "field", labelText);
  label.setAttribute("for", id);
  const input = el("input", "input");
  input.id = id;
  input.type = type;
  // The one hint a date field needs on a browser that renders it as plain text.
  if (type === "date") input.setAttribute("placeholder", "YYYY-MM-DD");
  return { label, input };
}

/** The hand-over form for one outstanding item. */
function formFor(item) {
  const form = document.createElement("form");
  form.noValidate = true;

  const reference = field(`ref-${item.item_key}`, COPY.referenceLabel, "text");
  reference.input.value = item.reference || "";
  form.appendChild(reference.label);
  form.appendChild(reference.input);

  let expiry = null;
  if (item.expires) {
    expiry = field(`exp-${item.item_key}`, COPY.expiryLabel, "date");
    expiry.input.value = item.expiry_date || "";
    form.appendChild(expiry.label);
    form.appendChild(expiry.input);
  }

  form.appendChild(el("p", "prep-caption", COPY.noDocuments));

  const actions = el("div", "actions");
  const button = el("button", "btn btn-primary btn-block", COPY.submit);
  button.type = "submit";
  actions.appendChild(button);
  form.appendChild(actions);

  const line = el("p", "state");
  line.setAttribute("role", "status");
  form.appendChild(line);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (isBusy(button)) return;

    const referenceValue = reference.input.value.trim();
    if (!referenceValue) {
      say(line, COPY.referenceMissing, true);
      reference.input.focus();
      return;
    }
    const expiryValue = expiry ? expiry.input.value.trim() : "";
    if (expiry && !expiryValue) {
      say(line, COPY.expiryMissing, true);
      expiry.input.focus();
      return;
    }

    busy(button, true);
    say(line, COPY.sending, false);

    const payload = { item_key: item.item_key, reference: referenceValue };
    if (expiry) payload.expiry_date = expiryValue;

    fetch("/prep/compliance/api/item", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then((res) => {
        if (res.status === 401) return bounce();
        if (!res.ok) throw new Error(`item: ${res.status}`);
        // Re-read rather than patch: the count and the chip must never disagree with the server.
        return load(COPY.saved);
      })
      .catch((err) => {
        console.error("compliance passport: could not save", err);
        busy(button, false);
        say(line, COPY.sendFailed, true);
      });
  });

  return form;
}

/** A per-form state line. Text only, never markup. */
function say(node, message, isError) {
  node.textContent = message || "";
  if (isError) node.setAttribute("data-tone", "error");
  else node.removeAttribute("data-tone");
}

/** One item's card. */
function cardFor(item) {
  const card = el("div", "block passport-item");

  const head = el("div", "passport-item-head");
  head.appendChild(el("h2", null, item.label));
  const chipWord = COPY.chip[item.status] || COPY.chip.missing;
  head.appendChild(el("span", `mark mark-${item.status}`, chipWord));
  card.appendChild(head);

  card.appendChild(el("p", "passport-item-meta", COPY.meaning[item.status] || COPY.meaning.missing));

  // What we already hold, when we hold anything. Two facts, and never a third.
  if (item.reference) card.appendChild(el("p", "passport-item-meta", COPY.held(item.reference)));
  if (item.expiry_date) {
    card.appendChild(el("p", "passport-item-meta", COPY.runsOut(readableDate(item.expiry_date))));
  }

  // A verified item needs nothing from the candidate. Everything else does — including one that
  // is merely `submitted`, because a reference typed wrongly is fixed by typing it again.
  if (item.status !== "verified") card.appendChild(formFor(item));

  return card;
}

/**
 * The session has gone — rotated away by a sign-in on another phone, run out, or erased by
 * delete-now. That is a person in front of a browser, not a caller parsing a body, so the
 * sign-in page explains it. `replace`, not `assign`: a dead page should not sit in the history
 * for Back to land on. The promise never resolves, deliberately — the navigation is already
 * under way and settling this chain would flash an error over a page that is leaving.
 */
function bounce() {
  window.location.replace("/prep/compliance/login?e=session");
  return new Promise(() => {});
}

/** Fetch and render the whole checklist. `note` is what the state line says afterwards. */
function load(note) {
  return fetch(SOURCE, { headers: { accept: "application/json" } })
    .then((res) => {
      if (res.status === 401) return bounce();
      if (res.status === 503) throw new Error("not_configured");
      if (!res.ok) throw new Error(`items: ${res.status}`);
      return res.json();
    })
    .then((payload) => {
      if (!payload || !Array.isArray(payload.items)) throw new Error("items: no checklist");

      countLine.textContent =
        COPY.count(payload.done, payload.total) +
        (payload.awaiting_review ? COPY.awaiting(payload.awaiting_review) : "");

      mount.replaceChildren(...payload.items.map(cardFor));

      if (note) showState(note, false);
      else clearState();
    })
    .catch((err) => {
      console.error("compliance passport: could not render", err);
      // The count line's markup placeholder still reads "Loading your checklist…", which after a
      // failure is the one thing on the page that is no longer true. Clearing it leaves the
      // state line as the only claim, and the state line is the one that just failed honestly.
      countLine.textContent = "";
      showState(err.message === "not_configured" ? COPY.notConfigured : COPY.failed, true);
    });
}

// ── delete-now ───────────────────────────────────────────────────────────────────────

deleteButton.addEventListener("click", () => {
  if (isBusy(deleteButton)) return;
  if (!window.confirm(COPY.deleteConfirm)) return;

  busy(deleteButton, true);
  showState(COPY.deleting, false);

  // A body of `{}` and the JSON content type, not a bodyless POST: `readJson` throws bad_json on
  // a body it cannot parse, BEFORE the route's empty field vocabulary is ever consulted — so the
  // button would fail on the happy path with an error that looks like a server fault.
  fetch("/prep/compliance/api/delete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  })
    .then((res) => {
      // 401 included: a cookie pointing at a row that is already gone means the erasure this
      // button promises has happened. Either way the honest next screen is the sign-in page.
      if (res.ok || res.status === 401) return bounce();
      throw new Error(`delete: ${res.status}`);
    })
    .catch((err) => {
      console.error("compliance passport: could not delete", err);
      busy(deleteButton, false);
      showState(COPY.deleteFailed, true);
    });
});

// No "loading…" on the state line: the count line's markup already carries that sentence, and
// two live regions announcing the same thing is one announcement too many for a screen reader.
load();
