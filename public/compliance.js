/* The compliance dashboard (#71) — the recruiter's half of concurrent vetting.
 *
 * WHY THIS IS A SIBLING PAGE AND NOT A COLUMN ON /counts OR /assignments. test/counts.test.js
 * asserts that counts.js requests exactly two paths and names none of a forbidden word list — a
 * privacy gate that makes a promise to a clinical staffing client structural, and compliance
 * state is per-candidate, so extending that screen would mean loosening it. public/assignments.js
 * made the same call for the same reason and it holds a third time. A sibling page costs one file
 * and one nav entry.
 *
 * WHAT THIS FILE MAY READ:
 *
 *   /api/compliance   every candidate's checklist. No email — src/compliance/store.js's
 *                     listComplianceState decides that projection and names every column.
 *
 * THE AT-RISK FLAGS ARE DECIDED ON THE SERVER, EVERY REQUEST. `risk` arrives already computed
 * from the expiry date against that item type's own lead time in the catalogue. There is
 * deliberately no threshold and no date arithmetic in this file: the browser cannot import src/
 * (it is not in the Pages build output), and a number written here would give the catalogue's
 * thresholds a second home while the sweep kept the first.
 *
 * EACH ROW SHOWS TWO CHIPS BECAUSE IT HOLDS TWO FACTS. The chase chip is `status` — not sent in,
 * waiting for you, verified. The risk chip is computed from the date. A row reading "Waiting for
 * you" beside "Ran out four days ago" is not a contradiction; it is true, and it is the row that
 * most needs reading.
 *
 * Nothing is written to browser storage and nothing candidate-shaped goes in the URL. The
 * candidate's id travels in the PATH OF THE PUT, which is a request and not a location. Every
 * node is built with createElement and textContent: a candidate name and a reference number are
 * text somebody typed, never markup.
 *
 * NO UPLOAD CONTROL OF ANY KIND. Metadata-only is spike #66's first decision, and this screen is
 * the most plausible place in the whole product for someone to add "attach the certificate".
 */

(function () {
  "use strict";

  var COPY = {
    loading: "Loading…",
    empty: "No candidates yet. Record a booking on the Bookings screen. That is what starts a candidate's checklist.",
    failed: "Could not load the compliance list. Reload the page.",
    sessionExpired: "Your sign-in has expired. Reload the page to sign in again.",

    // The completeness headline. Built from clauses so a clean candidate reads as clean rather
    // than as a row of zeroes.
    verifiedOf: function (done, total) { return done + " of " + total + " verified"; },
    awaiting: function (count) { return count + " waiting for you"; },
    atRisk: function (count) { return count + " at risk"; },
    summaryJoin: " · ",

    // The chase state, in a recruiter's words. `compliance_item.status` holds missing/submitted/
    // verified/expiring/expired, and none of those five words is shown raw.
    stateMissing: "Not sent in",
    stateSubmitted: "Waiting for you",
    stateVerified: "Verified",
    stateExpiring: "Running out",
    stateExpired: "Ran out",

    // The risk state, computed from the date on the server.
    runsOutToday: "Runs out today",
    runsOutIn: function (days) { return "Runs out in " + days + (days === 1 ? " day" : " days"); },
    ranOutAgo: function (days) { return "Ran out " + days + (days === 1 ? " day" : " days") + " ago"; },

    noValue: "—",
    verify: "Verify",
    sendBack: "Send back",
    reasonPlaceholder: "Why are you sending it back?",

    verifyFor: function (name, item) { return "Verify " + name + "'s " + item; },
    sendBackFor: function (name, item) { return "Send " + name + "'s " + item + " back"; },
    reasonFor: function (name, item) { return "Why " + name + "'s " + item + " is being sent back"; },

    updating: "Saving the change…",
    verified: "Marked as verified.",
    sentBack: "Sent back. We have emailed them the reason.",
    sentBackNoEmail: "The item was sent back, but we could not email them. Give them a call.",
    needReason: "Type one line saying why, then press Send back.",
    notSubmitted: "That item is not waiting for you any more. Something has changed it. Reload the page.",
    mailNotConfigured: "Nothing was changed. This tool cannot send email yet, so they could not be told why.",
    candidateGone: "That candidate is no longer on file. Reload the page.",
    updateFailed: "Could not save that change. Reload the page and try again."
  };

  var el = {
    list: document.getElementById("compliance-list"),
    listState: document.getElementById("list-state")
  };

  /**
   * One fetch, with the two checks that matter. res.ok is not enough on this deployment:
   * Cloudflare Access answers an expired session with the sign-in page's HTML at 200, so
   * res.json() throws a parse error and the screen reports a generic failure when the fix is
   * "sign in again". assignments.js:96-105, unchanged.
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

  /** A write, through the same helper. */
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

  /** A node, built the only way anything is built on this deployment. */
  function cell(tag, text, className) {
    var node = document.createElement(tag);
    node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  /** The chase chip's word. A status the page has never heard of falls back to a dash rather
   *  than rendering the raw column value at a recruiter. */
  function chaseWord(status) {
    if (status === "missing") return COPY.stateMissing;
    if (status === "submitted") return COPY.stateSubmitted;
    if (status === "verified") return COPY.stateVerified;
    if (status === "expiring") return COPY.stateExpiring;
    if (status === "expired") return COPY.stateExpired;
    return COPY.noValue;
  }

  /** The risk chip, or null. `days_left` and `risk` both arrive on the wire — nothing here
   *  computes a threshold or parses a date. */
  function riskChip(item) {
    if (!item.risk) return null;
    var days = item.days_left;
    if (item.risk === "expired") return cell("span", COPY.ranOutAgo(Math.abs(days)), "compliance-chip is-red");
    var text = days === 0 ? COPY.runsOutToday : COPY.runsOutIn(days);
    return cell("span", text, "compliance-chip is-amber");
  }

  /** The completeness sentence. Clauses that are zero are omitted, so a clean candidate reads
   *  as clean rather than as a row of noughts. */
  function summaryOf(candidate) {
    var parts = [COPY.verifiedOf(candidate.verified, candidate.total)];
    if (candidate.awaiting_review) parts.push(COPY.awaiting(candidate.awaiting_review));
    if (candidate.at_risk) parts.push(COPY.atRisk(candidate.at_risk));
    return parts.join(COPY.summaryJoin);
  }

  /**
   * The two controls, on a submitted item ONLY — which matches the compare-and-swap the routes
   * guard with, so the page never offers an action the server will refuse.
   *
   * Every control names the candidate AND the item in its aria-label. "Verify" on its own is
   * meaningless to a screen reader working down a page with forty of them.
   */
  function controls(candidate, item) {
    var wrap = document.createElement("div");
    wrap.className = "compliance-actions";

    var reason = document.createElement("input");
    reason.type = "text";
    reason.className = "input compliance-reason";
    reason.placeholder = COPY.reasonPlaceholder;
    reason.setAttribute("aria-label", COPY.reasonFor(candidate.full_name, item.label));

    var verify = cell("button", COPY.verify, "btn compliance-action");
    verify.type = "button";
    verify.setAttribute("aria-label", COPY.verifyFor(candidate.full_name, item.label));
    verify.addEventListener("click", function () {
      write(candidate.id, { item_key: item.item_key, action: "verify" }, COPY.verified);
    });

    var reject = cell("button", COPY.sendBack, "btn compliance-action");
    reject.type = "button";
    reject.setAttribute("aria-label", COPY.sendBackFor(candidate.full_name, item.label));
    reject.addEventListener("click", function () {
      var text = reason.value.trim();
      // Checked here so the recruiter is told which box before a round trip. The route validates
      // it again — this is a courtesy, never the guard.
      if (!text) {
        showState(el.listState, COPY.needReason, true);
        return;
      }
      write(candidate.id, { item_key: item.item_key, action: "reject", reason: text }, COPY.sentBack);
    });

    wrap.appendChild(reason);
    wrap.appendChild(verify);
    wrap.appendChild(reject);
    return wrap;
  }

  function itemRow(candidate, item) {
    var li = document.createElement("li");
    li.className = "compliance-item";

    li.appendChild(cell("span", item.label, "compliance-item-label"));
    li.appendChild(cell("span", item.reference || COPY.noValue, "compliance-ref"));
    li.appendChild(cell("span", item.expiry_date || COPY.noValue, "compliance-date"));
    li.appendChild(cell("span", chaseWord(item.status), "compliance-chip"));

    var risk = riskChip(item);
    if (risk) li.appendChild(risk);

    if (item.status === "submitted") li.appendChild(controls(candidate, item));
    return li;
  }

  function render(candidates) {
    el.list.textContent = "";
    candidates.forEach(function (candidate) {
      var card = document.createElement("section");
      card.className = "compliance-card";

      card.appendChild(cell("h2", candidate.full_name || COPY.noValue, "compliance-name"));
      card.appendChild(cell("p", summaryOf(candidate), "compliance-summary"));

      var items = document.createElement("ul");
      items.className = "compliance-items";
      candidate.items.forEach(function (item) {
        items.appendChild(itemRow(candidate, item));
      });
      card.appendChild(items);

      el.list.appendChild(card);
    });
  }

  /** A verify or a send-back, then a full reload — the counts and the at-risk ordering are both
   *  the server's answer, and recomputing either here would give them a second home. */
  function write(candidateId, payload, doneMessage) {
    showState(el.listState, COPY.updating, false);
    send("/api/compliance/" + encodeURIComponent(candidateId), "PUT", payload)
      .then(function (body) {
        // `emailed: false` can now mean exactly one thing — the mail provider threw — because the
        // route settles configuration AND recipient before it writes anything. So the copy can
        // say plainly that the item moved and the message did not.
        return load(body && body.emailed === false ? COPY.sentBackNoEmail : doneMessage);
      })
      .catch(function (err) {
        var code = err && err.code;
        showState(
          el.listState,
          code === "session_expired"
            ? COPY.sessionExpired
            : code === "not_submitted"
              ? COPY.notSubmitted
              : code === "mail_not_configured"
                ? COPY.mailNotConfigured
                : code === "not_found"
                  ? COPY.candidateGone
                  : COPY.updateFailed,
          true
        );
      });
  }

  /** The one read. `doneMessage` is what the status line says once the repaint lands. */
  function load(doneMessage) {
    return api("/api/compliance")
      .then(function (body) {
        // The shape is a fixed contract: { candidates }. Defending against another shape here
        // would only hide the day it changed.
        render(body.candidates);
        if (doneMessage) showState(el.listState, doneMessage, false);
        else if (!body.candidates.length) showState(el.listState, COPY.empty, false);
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

  showState(el.listState, COPY.loading, false);
  load(null);
})();
