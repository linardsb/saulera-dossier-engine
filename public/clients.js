/* The client knowledge editor (#5).
 *
 * Vanilla, no framework, no build step — the same idiom as the saulera site's site.js.
 *
 * Four behaviours here are decisions rather than implementation details:
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
 *
 * 4. Every response is checked against the request that asked for it before it is allowed to
 *    write anything. Two clicks in a row resolve in arrival order, not click order, and this
 *    screen's whole job is one editable note per client: a response applied under the wrong id
 *    means the next save overwrites a different client's note, which decision 1 makes
 *    unrecoverable. So `load` carries `reqId` and `save` carries `savingId`, and both bail
 *    rather than write when the screen has moved on.
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
    // The two deployment faults, which are separate problems with separate remedies. They are
    // the likeliest thing on this screen on the day it is first stood up, and they fire on
    // first paint before the agency has touched anything — so neither can borrow the save
    // copy, which would claim a save nobody asked for.
    notConfigured: "This deployment is not connected to its database. Nothing can be read or " +
                   "saved yet.",
    notMigrated: "This deployment's database has no tables yet. Nothing can be read or saved " +
                 "yet.",
    // Read-path failures. The save copy promises "your text is still here", which is a lie on
    // a path where nothing was being saved and there is no text.
    listFailed: "Could not load the client list. Reload the page.",
    loadFailed: "Could not open that client. Pick another, or reload the page.",
    addFailed: "Could not add that client. Try again.",
    agencySaved: "Saved",
  };

  var el = {
    list: document.getElementById("client-list"),
    railEmpty: document.getElementById("rail-empty"),
    railState: document.getElementById("rail-state"),
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

  var state = { selected: null, dirty: false, saving: false, adding: false };

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

  /**
   * The message for an error, with the caller naming its own fallback.
   *
   * The fallback is a parameter rather than a constant because the same store codes surface on
   * paths that are not saves. A read failing back to "your text is still here" describes a
   * situation the user is not in.
   */
  function messageFor(err, fallback) {
    var otherwise = fallback || COPY.saveFailed;
    if (!err) return otherwise;
    if (err.code === "session_expired") return COPY.sessionExpired;
    if (err.code === "not_configured") return COPY.notConfigured;
    if (err.code === "not_migrated") return COPY.notMigrated;
    if (err.code === "too_long") return COPY.tooLong;
    if (err.code === "not_found") return COPY.unknownClient;
    if (err.code === "missing_fields") return COPY.nameMissing;
    return otherwise;
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
    // The rail is rebuilt from scratch on every refresh, which destroys the element the
    // keyboard was on and drops focus to <body>. Remember which row it was and put focus on
    // its replacement, so a save does not cost a keyboard user their place.
    var active = document.activeElement;
    var focusedId = active && active.classList && active.classList.contains("client-row")
      ? active.dataset.id
      : null;
    var refocus = null;

    el.list.textContent = "";
    el.railEmpty.hidden = clients.length > 0;

    clients.forEach(function (client) {
      var row = document.createElement("button");
      row.type = "button";
      row.className = "client-row";
      row.dataset.id = client.id;
      if (client.id === state.selected) row.setAttribute("aria-current", "true");
      if (client.id === focusedId) refocus = row;

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

    if (refocus) refocus.focus();
  }

  function refreshList() {
    return api("/api/clients")
      .then(function (body) { renderList(body.clients); })
      // Into the rail's own live region, never the editor's. #save-state sits inside a subtree
      // that is hidden until a client is selected, so on /clients with no ?client an error
      // written there is invisible — and a role="status" inside a hidden subtree is not in the
      // accessibility tree either, so it is not announced. It also belongs to the save
      // lifecycle: a list failure written into it is what let a successful save report
      // "Could not save".
      .catch(function (err) { showRailState(messageFor(err, COPY.listFailed), true); });
  }

  /* ── the editor ──────────────────────────────────────────────────────────────────────── */

  function showSaveState(text, isError) {
    el.saveState.textContent = text;
    el.saveState.classList.toggle("is-error", Boolean(isError));
    el.saveState.classList.add("is-shown");
  }

  function showRailState(text, isError) {
    el.railState.textContent = text;
    el.railState.classList.toggle("is-error", Boolean(isError));
    el.railState.classList.add("is-shown");
  }

  /**
   * Busy without `disabled`.
   *
   * Setting `disabled` on the focused button moves focus to <body> in every engine and does not
   * give it back, so a keyboard user loses their place in the tab order on every save.
   * aria-disabled says the same thing to assistive technology and keeps the control focusable;
   * the real guard is the `state.saving` / `state.adding` early return, which was always doing
   * the work anyway.
   */
  function setBusy(button, busy) {
    if (busy) button.setAttribute("aria-disabled", "true");
    else button.removeAttribute("aria-disabled");
  }

  function savedAt() {
    var now = new Date();
    return "Saved " + String(now.getHours()).padStart(2, "0") + ":" +
      String(now.getMinutes()).padStart(2, "0");
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

  /**
   * Put a client on screen.
   *
   * Navigation only. The unsaved-changes confirm deliberately does not live here: this is also
   * the step that runs after a client is created, and a confirm on that path would leave a row
   * in the database that was never shown. The three places a person can leave a dirty note —
   * a row click, the add form, and Back — each ask for themselves.
   */
  function load(id) {
    state.selected = id;
    state.dirty = false;

    if (!id) {
      el.editorBody.hidden = true;
      el.editorEmpty.hidden = false;
      el.editorEmpty.textContent = "Pick a client to read or edit its note.";
      return refreshList();
    }

    var reqId = id;
    return api("/api/clients/" + encodeURIComponent(id))
      .then(function (body) {
        // A later click already owns the screen. Writing this response now would put one
        // client's name and note under another client's id, and the next save would send that
        // text to the wrong client.
        if (state.selected !== reqId) return;
        el.editorEmpty.hidden = true;
        el.editorBody.hidden = false;
        el.editorHead.textContent = body.client.name;
        el.note.value = body.client.note;
        showSaveState(body.client.note ? "" : COPY.notSaved, false);
        return refreshList();
      })
      .catch(function (err) {
        if (state.selected !== reqId) return;
        // An unknown id in the URL says so and offers the list, rather than rendering an empty
        // editor that looks saveable.
        state.selected = null;
        el.editorBody.hidden = true;
        el.editorEmpty.hidden = false;
        el.editorEmpty.textContent = messageFor(err, COPY.loadFailed);
        return refreshList();
      });
  }

  function save() {
    if (state.saving || !state.selected) return;

    // Both captured before the request goes out. `savingId` is the client this answer will be
    // about; `sent` is the exact text the server was given, which is the only text a success
    // proves was stored.
    var savingId = state.selected;
    var sent = el.note.value;

    state.saving = true;
    setBusy(el.saveButton, true);
    el.saveButton.textContent = COPY.saving;

    api("/api/clients/" + encodeURIComponent(savingId), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note: sent }),
    })
      .then(function () {
        // The client changed while this was in flight. This answer says nothing about what is
        // on screen now: reporting it would claim a save the visible client never had, and the
        // dirty recomputation below would compare this client's sent text against a different
        // client's note and warn about edits that do not exist.
        if (state.selected !== savingId) return;

        // Keystrokes typed during the round trip are real edits that were never sent. Clearing
        // dirty unconditionally is what let them leave the page with no warning.
        var stillTyping = el.note.value !== sent;
        state.dirty = stillTyping;
        showSaveState(stillTyping ? COPY.unsaved : savedAt(), false);
        return refreshList();
      })
      .catch(function (err) {
        if (state.selected !== savingId) return;
        // The text stays exactly where it is. Never cleared, never navigated away from, never
        // replaced by an error.
        state.dirty = true;
        showSaveState(messageFor(err), true);
      })
      .then(function () {
        state.saving = false;
        setBusy(el.saveButton, false);
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
        el.agencyState.textContent = messageFor(err, COPY.loadFailed);
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
        el.agencyState.textContent = COPY.agencySaved;
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
    if (state.adding) return;

    var name = el.addName.value.trim();
    if (!name) {
      showRailState(COPY.nameMissing, true);
      el.addName.focus();
      return;
    }

    // Asked before the POST, not after. Adding a client navigates to it, which replaces the
    // note on screen — but if the confirm sat on that navigation instead, declining it would
    // leave a client created in the database and never shown.
    if (state.dirty && !window.confirm(COPY.leaving)) return;

    state.adding = true;
    setBusy(el.addButton, true);
    api("/api/clients", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: name }),
    })
      .then(function (body) {
        el.addName.value = "";
        select(body.client.id);
      })
      .catch(function (err) { showRailState(messageFor(err, COPY.addFailed), true); })
      .then(function () {
        state.adding = false;
        setBusy(el.addButton, false);
      });
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
    var next = new URL(window.location.href).searchParams.get("client");
    // beforeunload does not fire for same-document history navigation, so Back is the one way
    // out of a dirty note that nothing else catches.
    if (next !== state.selected && state.dirty && !window.confirm(COPY.leaving)) {
      // The address bar has already moved. Push the current client back onto it, so what the
      // URL says and what the screen shows do not disagree.
      var url = new URL(window.location.href);
      if (state.selected) url.searchParams.set("client", state.selected);
      else url.searchParams.delete("client");
      window.history.pushState({ client: state.selected }, "", url);
      return;
    }
    load(next);
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
