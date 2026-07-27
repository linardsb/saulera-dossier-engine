/* The client knowledge editor (#5).
 *
 * Vanilla, no framework, no build step — the same idiom as the saulera site's site.js.
 *
 * Three behaviours here are decisions rather than implementation details:
 *
 * 1. Nothing is written to browser storage of any kind: not local storage, not session storage,
 *    not cookies, not IndexedDB. The note is business-context personal data — it names hiring
 *    managers and panel members (§5.3) — and keeping the browser-side rule one sentence rather
 *    than two is worth more than a draft-recovery feature. A dirty textarea warns on
 *    beforeunload instead. (Written without the API names on purpose: the Level 1 gate in the
 *    plan greps this file for them, and a gate that cries wolf at a comment gets deleted.)
 *
 * 2. The selected client travels in the URL as ?client=<uuid>, an id and never a name. A name
 *    in a URL leaks into browser history and referrers.
 *
 * 3. A failed save keeps the text on screen and leaves the editor dirty. Losing an agency's
 *    in-progress edits to the product's compounding asset is the real error state, so every
 *    failure path below ends with the text still there and a message that says what to do.
 */

(function () {
  "use strict";

  var COPY = {
    saveIdle: "Save note",
    saving: "Saving…",
    notSaved: "Not saved yet",
    unsaved: "Unsaved changes",
    saveFailed: "Could not save. Your text is still here. Try again.",
    sessionExpired: "Your session expired. Reload the page to sign in again.",
    tooLong: "That note is longer than 100,000 characters. Shorten it and save again. " +
             "Your text is still here.",
    nameMissing: "Enter a client name.",
    unknownClient: "That client does not exist. Pick one from the list.",
    leaving: "You have unsaved changes to this note.",
  };

  var el = {
    list: document.getElementById("client-list"),
    railEmpty: document.getElementById("rail-empty"),
    addForm: document.getElementById("add-form"),
    addName: document.getElementById("new-client-name"),
    addButton: document.getElementById("add-button"),
    editorEmpty: document.getElementById("editor-empty"),
    editorBody: document.getElementById("editor-body"),
    editorHead: document.getElementById("editor-head"),
    note: document.getElementById("note"),
    saveButton: document.getElementById("save-button"),
    saveState: document.getElementById("save-state"),
    agencyState: document.getElementById("agency-state"),
    sendFormat: document.getElementById("send-format"),
  };

  var state = { selected: null, dirty: false, saving: false };

  /* ── talking to the API ──────────────────────────────────────────────────────────────── */

  /**
   * One fetch, with the two checks that matter.
   *
   * res.ok is not enough on this deployment. Cloudflare Access sits in front of every route,
   * and an expired session answers a fetch with the sign-in page's HTML at 200 — res.json()
   * then throws a parse error and the screen reports a generic failure when the fix is "sign in
   * again". So the content type is checked too, and that case gets its own message.
   */
  function api(path, options) {
    return fetch(path, options).then(function (res) {
      var type = res.headers.get("content-type") || "";
      if (type.indexOf("application/json") === -1) {
        throw { code: "session_expired" };
      }
      return res.json().then(function (body) {
        if (!res.ok) throw { code: body.error || "failed", status: res.status };
        return body;
      });
    });
  }

  function messageFor(err) {
    if (!err) return COPY.saveFailed;
    if (err.code === "session_expired") return COPY.sessionExpired;
    if (err.code === "too_long") return COPY.tooLong;
    if (err.code === "not_found") return COPY.unknownClient;
    if (err.code === "missing_fields") return COPY.nameMissing;
    return COPY.saveFailed;
  }

  /* ── the rail ────────────────────────────────────────────────────────────────────────── */

  /** "1,842 characters · 6 packs" — the row's main content, because the point is how much is
   *  written down. Grouped thousands, because a note's length is read at a glance. */
  function rowMeta(client) {
    var chars = client.note_chars.toLocaleString("en-GB");
    return chars + (client.note_chars === 1 ? " character · " : " characters · ") +
      client.packs + (client.packs === 1 ? " pack" : " packs");
  }

  function renderList(clients) {
    el.list.textContent = "";
    el.railEmpty.hidden = clients.length > 0;

    clients.forEach(function (client) {
      var row = document.createElement("button");
      row.type = "button";
      row.className = "client-row";
      row.dataset.id = client.id;
      if (client.id === state.selected) row.setAttribute("aria-current", "true");

      var name = document.createElement("span");
      name.className = "client-name";
      // textContent, never innerHTML: this is agency-authored text and this screen is the only
      // place it is rendered.
      name.textContent = client.name;

      var meta = document.createElement("span");
      meta.className = "client-meta";
      meta.textContent = rowMeta(client);

      row.appendChild(name);
      row.appendChild(meta);

      row.addEventListener("click", function () {
        if (client.id === state.selected) return;
        if (state.dirty && !window.confirm(COPY.leaving)) return;
        select(client.id);
      });

      var item = document.createElement("li");
      item.appendChild(row);
      el.list.appendChild(item);
    });
  }

  function refreshList() {
    return api("/api/clients")
      .then(function (body) { renderList(body.clients); })
      .catch(function (err) { showSaveState(messageFor(err), true); });
  }

  /* ── the editor ──────────────────────────────────────────────────────────────────────── */

  function showSaveState(text, isError) {
    el.saveState.textContent = text;
    el.saveState.classList.toggle("is-error", Boolean(isError));
    el.saveState.classList.add("is-shown");
  }

  function markDirty() {
    state.dirty = true;
    showSaveState(COPY.unsaved, false);
  }

  function select(id) {
    var url = new URL(window.location.href);
    if (id) url.searchParams.set("client", id);
    else url.searchParams.delete("client");
    window.history.pushState({ client: id }, "", url);
    load(id);
  }

  function load(id) {
    state.selected = id;
    state.dirty = false;

    if (!id) {
      el.editorBody.hidden = true;
      el.editorEmpty.hidden = false;
      el.editorEmpty.textContent = "Pick a client to read or edit its note.";
      return refreshList();
    }

    return api("/api/clients/" + encodeURIComponent(id))
      .then(function (body) {
        el.editorEmpty.hidden = true;
        el.editorBody.hidden = false;
        el.editorHead.textContent = body.client.name;
        el.note.value = body.client.note;
        showSaveState(body.client.note ? "" : COPY.notSaved, false);
        return refreshList();
      })
      .catch(function (err) {
        // An unknown id in the URL says so and offers the list, rather than rendering an empty
        // editor that looks saveable.
        state.selected = null;
        el.editorBody.hidden = true;
        el.editorEmpty.hidden = false;
        el.editorEmpty.textContent = messageFor(err);
        return refreshList();
      });
  }

  function save() {
    if (state.saving || !state.selected) return;

    state.saving = true;
    el.saveButton.disabled = true;
    el.saveButton.textContent = COPY.saving;

    api("/api/clients/" + encodeURIComponent(state.selected), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note: el.note.value }),
    })
      .then(function () {
        state.dirty = false;
        var now = new Date();
        showSaveState(
          "Saved " + String(now.getHours()).padStart(2, "0") + ":" +
            String(now.getMinutes()).padStart(2, "0"),
          false,
        );
        return refreshList();
      })
      .catch(function (err) {
        // The text stays exactly where it is. Never cleared, never navigated away from, never
        // replaced by an error.
        state.dirty = true;
        showSaveState(messageFor(err), true);
      })
      .then(function () {
        state.saving = false;
        el.saveButton.disabled = false;
        el.saveButton.textContent = COPY.saveIdle;
      });
  }

  /* ── the agency strip ────────────────────────────────────────────────────────────────── */

  function loadAgency() {
    return api("/api/agency")
      .then(function (body) {
        var renderer = document.querySelector(
          'input[name="renderer"][value="' + body.agency.renderer + '"]',
        );
        if (renderer) renderer.checked = true;
        el.sendFormat.value = body.agency.send_format;
      })
      .catch(function (err) {
        el.agencyState.textContent = messageFor(err);
        el.agencyState.classList.add("is-shown", "is-error");
      });
  }

  function saveAgency(patch) {
    return api("/api/agency", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    })
      .then(function () {
        el.agencyState.classList.remove("is-error");
        el.agencyState.classList.add("is-shown");
        el.agencyState.textContent = "Saved";
      })
      .catch(function (err) {
        el.agencyState.classList.add("is-shown", "is-error");
        el.agencyState.textContent = messageFor(err);
        // Put the controls back to what the deployment actually holds, so the screen never
        // shows a setting that was not stored.
        return loadAgency();
      });
  }

  /* ── wiring ──────────────────────────────────────────────────────────────────────────── */

  el.addForm.addEventListener("submit", function (event) {
    event.preventDefault();
    var name = el.addName.value.trim();
    if (!name) {
      showSaveState(COPY.nameMissing, true);
      el.addName.focus();
      return;
    }

    el.addButton.disabled = true;
    api("/api/clients", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: name }),
    })
      .then(function (body) {
        el.addName.value = "";
        select(body.client.id);
      })
      .catch(function (err) { showSaveState(messageFor(err), true); })
      .then(function () { el.addButton.disabled = false; });
  });

  el.saveButton.addEventListener("click", save);
  el.note.addEventListener("input", function () {
    if (!state.dirty) markDirty();
  });

  document.querySelectorAll('input[name="renderer"]').forEach(function (input) {
    input.addEventListener("change", function () {
      saveAgency({ renderer: input.value });
    });
  });

  el.sendFormat.addEventListener("change", function () {
    saveAgency({ send_format: el.sendFormat.value });
  });

  window.addEventListener("popstate", function () {
    load(new URL(window.location.href).searchParams.get("client"));
  });

  // CHECKLIST.md mandates this for pasted input. It applies to the note for the same reason:
  // nothing is kept in the browser, so leaving with unsaved edits loses them.
  window.addEventListener("beforeunload", function (event) {
    if (!state.dirty) return;
    event.preventDefault();
    event.returnValue = "";
  });

  loadAgency();
  load(new URL(window.location.href).searchParams.get("client"));
})();
