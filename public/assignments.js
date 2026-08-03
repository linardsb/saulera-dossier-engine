/* The bookings screen (#69) — the recruiter's half of the extension radar.
 *
 * WHY THIS IS A SIBLING PAGE AND NOT A COLUMN ON /counts. test/counts.test.js asserts that
 * counts.js requests exactly two paths, issues exactly one fetch, and names none of a forbidden
 * word list — a privacy gate that makes a promise to a clinical staffing client structural. A
 * bookings list shows candidate names, so extending that screen would mean loosening the gate.
 * A sibling page keeps it byte-for-byte and costs one file plus one nav entry.
 *
 * WHAT THIS FILE MAY READ:
 *
 *   /api/clients      names, for the client picker. Selects no portal column at all.
 *   /api/assignments  bookings and their dates. No compliance state, no candidate id, no email
 *                     — src/compliance/store.js's listAssignments decides that projection and
 *                     names every column it returns.
 *
 * THE AMBER THRESHOLD COMES DOWN THE WIRE. `lead_days` arrives on the GET, sourced from
 * EXTENSION_LEAD_DAYS in src/compliance/catalogue.js. There is deliberately no such number
 * written in this file: the browser cannot import src/ (it is not in the Pages build output),
 * and a literal here would give the threshold a second home while the sweep kept the first —
 * which is exactly what "thresholds live in the catalogue, not code" exists to prevent. Until
 * it arrives, nothing is amber.
 *
 * Nothing is written to browser storage and nothing candidate-shaped goes in the URL — the same
 * two rules as app.js and counts.js. Every node is built with createElement and textContent: a
 * candidate name and a client name are text somebody typed, never markup.
 */

(function () {
  "use strict";

  var COPY = {
    loading: "Loading…",
    empty: "No bookings recorded yet. Add the first one above and we will watch its end date.",
    failed: "Could not load the bookings. Reload the page.",
    sessionExpired: "Your sign-in has expired. Reload the page to sign in again.",
    noClients: "Add a client on the Client knowledge screen first — a booking has to belong to one.",

    saving: "Saving…",
    saved: "Booking recorded.",
    saveFailed: "Could not record that booking. Check the dates and try again.",
    needName: "Enter the candidate's name.",
    needEmail: "Enter the candidate's email address.",
    needClient: "Choose a client.",
    needStart: "Choose a start date.",
    endBeforeStart: "The end date is before the start date.",
    clientGone: "That client no longer exists. Reload the page.",

    updating: "Saving the change…",
    extended: "End date updated. We will nudge you again fourteen days before the new one.",
    ended: "Booking marked as ended.",
    updateFailed: "Could not save that change. Reload the page and try again.",
    needNewEnd: "Choose the new end date first.",

    // The state cell, in the recruiter's words. `assignment.status` holds booked/active/ended/
    // cancelled; none of those four words is shown raw except where it is already plain English.
    open: "Open — no end date",
    lapsed: "End date has passed",
    endsToday: "Ends today",
    endsIn: function (days) { return "Ends in " + days + (days === 1 ? " day" : " days"); },
    stateEnded: "Ended",
    stateCancelled: "Cancelled",

    noDate: "—",
    extend: "Extend",
    markEnded: "Mark ended",
    newEndFor: function (name) { return "New end date for " + name; },
    extendFor: function (name) { return "Save the new end date for " + name; },
    endFor: function (name) { return "Mark " + name + "'s booking as ended"; },
    clientPlaceholder: "Choose a client"
  };

  var el = {
    form: document.getElementById("booking-form"),
    name: document.getElementById("candidate-name"),
    contact: document.getElementById("candidate-email"),
    client: document.getElementById("booking-client"),
    start: document.getElementById("booking-start"),
    end: document.getElementById("booking-end"),
    submit: document.getElementById("booking-submit"),
    formState: document.getElementById("form-state"),
    body: document.getElementById("assignments-body"),
    listState: document.getElementById("list-state")
  };

  /* The catalogue's lead time, once the first GET has answered. Null until then, and null means
     nothing is amber — a threshold guessed in the browser is worse than a row that is merely
     plain for one paint. */
  var leadDays = null;

  /**
   * One fetch, with the two checks that matter. res.ok is not enough on this deployment:
   * Cloudflare Access answers an expired session with the sign-in page's HTML at 200, so
   * res.json() throws a parse error and the screen reports a generic failure when the fix is
   * "sign in again". counts.js:42-57 and clients.js:90-101, unchanged.
   */
  function api(path, options) {
    return fetch(path, options).then(function (res) {
      var type = res.headers.get("content-type") || "";
      if (type.indexOf("application/json") === -1) throw { code: "session_expired" };
      return res.json().then(function (body) {
        if (!res.ok) throw { code: body.error || "failed", status: res.status };
        return body;
      });
    });
  }

  /** A write, through the same helper. This screen legitimately writes; counts.js does not. */
  function send(path, method, payload) {
    return api(path, {
      method: method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  }

  function showState(node, text, isError) {
    node.textContent = text;
    node.classList.toggle("is-error", Boolean(isError));
    node.classList.add("is-shown");
  }

  /** The full clear, `is-shown` included — emptying textContent alone leaves a shown box
   *  occupying its own padding (app.js:271's pattern). */
  function clearState(node) {
    node.textContent = "";
    node.classList.remove("is-error", "is-shown");
  }

  /** A cell, built the only way anything is built on this deployment. */
  function cell(tag, text, className) {
    var node = document.createElement(tag);
    node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  /**
   * Whole days from today to a 'YYYY-MM-DD' date, both read as UTC.
   *
   * `Date.parse(d + "T00:00:00Z")` and not `Date.parse(d)`: a zone-less string is read as LOCAL
   * time, and across midnight in British Summer Time that is a whole day — src/prep/tokens.js's
   * rule, and the same one src/compliance/store.js's `date()` comparisons keep server-side. Both
   * sides of the subtraction are UTC midnights, so the result is a whole number of days.
   */
  function daysUntil(dateOnly) {
    var target = Date.parse(dateOnly + "T00:00:00Z");
    var today = Date.parse(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
    if (!isFinite(target)) return null;
    return Math.round((target - today) / 86400000);
  }

  /**
   * The state cell for one booking: the word, and whether it is amber.
   *
   * A booking whose end date has already passed is reported plainly and NOT flagged. That is
   * scope, not an oversight — the at-risk surface belongs to #71's dashboard, and this screen's
   * amber means one thing only: inside the window the radar nudges on.
   */
  function stateOf(booking) {
    if (booking.status === "ended") return { text: COPY.stateEnded, tone: "is-resolved" };
    if (booking.status === "cancelled") return { text: COPY.stateCancelled, tone: "is-resolved" };
    if (!booking.end_date) return { text: COPY.open, tone: "" };

    var days = daysUntil(booking.end_date);
    if (days === null) return { text: COPY.noDate, tone: "" };
    if (days < 0) return { text: COPY.lapsed, tone: "" };

    var amber = leadDays !== null && days <= leadDays;
    if (days === 0) return { text: COPY.endsToday, tone: amber ? "is-amber" : "" };
    return { text: COPY.endsIn(days), tone: amber ? "is-amber" : "" };
  }

  /** The per-row controls: a new end date, and the resolve. Resolved bookings carry neither. */
  function controls(booking) {
    var td = document.createElement("td");
    td.className = "assignments-actions";
    if (booking.status === "ended" || booking.status === "cancelled") {
      td.textContent = COPY.noDate;
      return td;
    }

    var name = booking.candidate_name || "";

    var date = document.createElement("input");
    date.type = "date";
    date.className = "input assignments-date";
    date.setAttribute("aria-label", COPY.newEndFor(name));

    var extend = cell("button", COPY.extend, "btn assignments-action");
    extend.type = "button";
    extend.setAttribute("aria-label", COPY.extendFor(name));
    extend.addEventListener("click", function () {
      if (!date.value) {
        showState(el.listState, COPY.needNewEnd, true);
        return;
      }
      // Extending RE-ARMS the radar: the store clears nudge_sent_at in the same statement that
      // moves end_date, so the new deadline produces a new nudge. The copy says so, because a
      // recruiter who has already had one email should know a second one is coming.
      update(booking.id, { end_date: date.value }, COPY.extended);
    });

    var close = cell("button", COPY.markEnded, "btn assignments-action");
    close.type = "button";
    close.setAttribute("aria-label", COPY.endFor(name));
    close.addEventListener("click", function () {
      // `status` alone, with no end_date key in the body: the route builds its patch with
      // Object.hasOwn, so this does NOT clear the nudge stamp. Resolving settles the nudge; it
      // does not re-ask the question.
      update(booking.id, { status: "ended" }, COPY.ended);
    });

    td.appendChild(date);
    td.appendChild(extend);
    td.appendChild(close);
    return td;
  }

  function update(id, patch, doneMessage) {
    showState(el.listState, COPY.updating, false);
    send("/api/assignments/" + encodeURIComponent(id), "PUT", patch)
      .then(function () {
        return load(doneMessage);
      })
      .catch(function (err) {
        showState(
          el.listState,
          err && err.code === "session_expired" ? COPY.sessionExpired : COPY.updateFailed,
          true
        );
      });
  }

  function render(bookings) {
    el.body.textContent = "";
    bookings.forEach(function (booking) {
      var state = stateOf(booking);
      var tr = document.createElement("tr");

      tr.appendChild(cell("th", booking.candidate_name || ""));
      tr.firstChild.setAttribute("scope", "row");
      tr.appendChild(cell("td", booking.client_name || ""));
      tr.appendChild(cell("td", booking.start_date || COPY.noDate, "assignments-date-cell"));
      tr.appendChild(cell("td", booking.end_date || COPY.noDate, "assignments-date-cell"));

      var stateCell = document.createElement("td");
      // The chip carries the word, so the colour ranks it rather than being the only thing that
      // says it — tokens.css's rule for every tint on this deployment.
      stateCell.appendChild(cell("span", state.text, ("assignments-chip " + state.tone).trim()));
      tr.appendChild(stateCell);

      tr.appendChild(controls(booking));
      el.body.appendChild(tr);
    });
  }

  function fillClients(clients) {
    el.client.textContent = "";
    var placeholder = cell("option", COPY.clientPlaceholder);
    placeholder.value = "";
    el.client.appendChild(placeholder);
    clients.forEach(function (client) {
      var option = cell("option", client.name);
      option.value = client.id;
      el.client.appendChild(option);
    });
    if (!clients.length) showState(el.formState, COPY.noClients, true);
  }

  /** Both reads, together. `doneMessage` is what the list box says once the repaint lands. */
  function load(doneMessage) {
    return Promise.all([api("/api/clients"), api("/api/assignments")])
      .then(function (results) {
        // The shapes are fixed contracts: { clients } and { assignments, lead_days }. Defending
        // against other shapes here would only hide the day one of them changed.
        fillClients(results[0].clients);
        leadDays = results[1].lead_days;
        render(results[1].assignments);
        if (doneMessage) showState(el.listState, doneMessage, false);
        else if (!results[1].assignments.length) showState(el.listState, COPY.empty, false);
        else clearState(el.listState);
      })
      .catch(function (err) {
        showState(
          el.listState,
          err && err.code === "session_expired" ? COPY.sessionExpired : COPY.failed,
          true
        );
      });
  }

  el.form.addEventListener("submit", function (event) {
    event.preventDefault();

    var name = el.name.value.trim();
    var contact = el.contact.value.trim();
    var clientId = el.client.value;
    var start = el.start.value;
    var end = el.end.value;

    // Checked here so the recruiter is told which box, in a sentence, before a round trip. The
    // route validates all of it again — this is a courtesy, never the guard.
    if (!name) return showState(el.formState, COPY.needName, true);
    if (!contact) return showState(el.formState, COPY.needEmail, true);
    if (!clientId) return showState(el.formState, COPY.needClient, true);
    if (!start) return showState(el.formState, COPY.needStart, true);
    if (end && end < start) return showState(el.formState, COPY.endBeforeStart, true);

    showState(el.formState, COPY.saving, false);
    el.submit.disabled = true;

    send("/api/assignments", "POST", {
      candidate_name: name,
      candidate_email: contact,
      client_id: clientId,
      start_date: start,
      end_date: end
    })
      .then(function () {
        el.form.reset();
        showState(el.formState, COPY.saved, false);
        return load(null);
      })
      .catch(function (err) {
        var code = err && err.code;
        showState(
          el.formState,
          code === "session_expired"
            ? COPY.sessionExpired
            : code === "not_found"
              ? COPY.clientGone
              : COPY.saveFailed,
          true
        );
      })
      .then(function () {
        el.submit.disabled = false;
      });
  });

  showState(el.listState, COPY.loading, false);
  load(null);
})();
