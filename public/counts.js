/* The process claim, as two numbers per client (#22, decision 23).
 *
 * "Every candidate we submit gets our prep portal" is the sentence the agency sells on, and
 * this page is the evidence for it. It exists so there is somewhere to point.
 *
 * WHAT THIS FILE MAY READ, and why the list is this short:
 *
 *   /api/clients   names and pack counts. Selects no portal column at all.
 *   /api/events    client_id and three COUNT()s (src/store.js:524-534).
 *
 * That is the whole surface, and neither endpoint CAN identify a candidate or report anything
 * one of them did — decision 3 puts per-invite state on the `invite` row, where it dies with
 * the rest of their data, and keeps these rows non-personal so the counts survive a purge.
 *
 * A source-scan test in test/counts.test.js asserts that this file fetches nothing else and
 * names none of the per-candidate fields. The point of scanning the SOURCE rather than the
 * rendered page is that a page can be correct today and one fetch away from not being: the
 * constraint is on what this file may ask for, not on what it happens to display. (That test
 * greps this file for those field names, so they are deliberately not written out here — a
 * gate that cries wolf at a comment gets deleted, which is app.js:19-20's argument verbatim.)
 *
 * Nothing is written to browser storage and nothing candidate-shaped goes in the URL — the
 * same two rules as app.js, and there is nothing here that would want to.
 */

(function () {
  "use strict";

  var COPY = {
    loading: "Loading…",
    empty: "No prep has been sent yet. Generate a pack, then send the candidate their prep " +
           "from the bottom of that screen.",
    failed: "Could not load the numbers. Reload the page.",
    sessionExpired: "Your sign-in has expired. Reload the page to sign in again."
  };

  var el = {
    body: document.getElementById("counts-body"),
    state: document.getElementById("counts-state")
  };

  /**
   * One fetch, with the two checks that matter. res.ok is not enough on this deployment:
   * Cloudflare Access answers an expired session with the sign-in page's HTML at 200, so
   * res.json() throws a parse error and the screen reports a generic failure when the fix is
   * "sign in again". clients.js:90-101 and app.js:212, unchanged.
   */
  function api(path) {
    return fetch(path).then(function (res) {
      var type = res.headers.get("content-type") || "";
      if (type.indexOf("application/json") === -1) throw { code: "session_expired" };
      return res.json().then(function (body) {
        if (!res.ok) throw { code: body.error || "failed", status: res.status };
        return body;
      });
    });
  }

  function showState(text, isError) {
    el.state.textContent = text;
    el.state.classList.toggle("is-error", Boolean(isError));
    el.state.classList.add("is-shown");
  }

  /** The full clear, `is-shown` included. Emptying textContent alone leaves a shown
   *  `.save-state` box occupying its own padding under the table (app.js:271's pattern). */
  function clearState() {
    el.state.textContent = "";
    el.state.classList.remove("is-error", "is-shown");
  }

  /** A cell, built the only way anything is built on this deployment: createElement and
   *  textContent. A client name is agency-authored text and never markup. */
  function cell(tag, text, className) {
    var node = document.createElement(tag);
    node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  /** One number cell. `|| 0` is where a client with no row at all becomes a nought. */
  function number(value) {
    var n = value || 0;
    return cell("td", String(n), n === 0 ? "counts-number is-zero" : "counts-number");
  }

  function render(clients, events) {
    // Keyed by client_id so the join is a lookup rather than a scan per row. A client with no
    // events at all simply has no entry, which is what the zeros below are for.
    var counts = Object.create(null);
    (events.per_client || []).forEach(function (row) { counts[row.client_id] = row; });

    el.body.textContent = "";
    clients.forEach(function (client) {
      var row = counts[client.id] || {};
      var tr = document.createElement("tr");
      tr.appendChild(cell("th", client.name));
      tr.firstChild.setAttribute("scope", "row");
      // ZERO, never a blank. A blank cell reads as "we do not know", and we do know: the
      // answer is none. That distinction is the whole reliability of a sales number.
      //
      // The zero is printed in full and then marked, never dropped. `is-zero` only quiets it in
      // the CSS so the eye lands on the numbers that are not zero; the digit still carries what
      // a blank cell would fail to say.
      tr.appendChild(number(row.packs));
      tr.appendChild(number(row.invites_sent));
      tr.appendChild(number(row.invites_opened));
      el.body.appendChild(tr);
    });

    var anySent = (events.per_client || []).some(function (r) { return r.invites_sent > 0; });
    if (!clients.length || !anySent) showState(COPY.empty, false);
    else clearState();
  }

  showState(COPY.loading, false);

  Promise.all([api("/api/clients"), api("/api/events")])
    .then(function (results) {
      // The shapes are fixed contracts: { clients } and { total, per_client }. Defending
      // against other shapes here would only hide the day one of them changed.
      render(results[0].clients, results[1]);
    })
    .catch(function (err) {
      showState(err && err.code === "session_expired" ? COPY.sessionExpired : COPY.failed, true);
    });
})();
