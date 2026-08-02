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
    // copy, which would claim a save nobody asked for. "not connected to its database" is
    // load-bearing: the clients-screen probe matches that phrase.
    notConfigured: "This tool is not connected to its database, so nothing can be read or " +
                   "saved yet. Ask whoever set it up.",
    notMigrated: "This tool's database is empty, so nothing can be read or saved yet. Ask " +
                 "whoever set it up.",
    // Read-path failures. The save copy promises "your text is still here", which is a lie on
    // a path where nothing was being saved and there is no text.
    listFailed: "Could not load the client list. Reload the page.",
    loadFailed: "Could not open that client. Pick another, or reload the page.",
    addFailed: "Could not add that client. Try again.",
    settingFailed: "Could not change that setting. It is still what it was.",
    agencySaved: "Saved",

    deleteIdle: "Delete this client",
    deleting: "Deleting…",
    // Named, and priced: the reader decides while looking at what leaves with the row.
    deleteConfirm: function (name) {
      return "Delete " + name + "? Its note and its pack count go with it. This cannot be " +
        "undone.";
    },
    deleteFailed: "Could not delete that client. Try again.",
    deleted: function (name) { return "Deleted " + name + "."; },

    // The candidate-visibility list (#18). The database calls this note_visibility and
    // field_key; the recruiter never meets either word. Every string says what to do next.
    visibilityEmpty: "This note has no sections yet. Start a line with ## and a section name, " +
                     "like ## Their process, then save the note. You can choose what a " +
                     "candidate sees, section by section.",
    visibilityStale: "Save the note to update this list.",
    visibilityDuplicate: "Two sections have this name, so neither can be shared. Give them " +
                         "different names and save.",
    visibilitySaved: "Saved",
    // Not "It is still what it was", which claims something the browser cannot know. If the
    // PUT succeeded and its answer was lost, AND the recovery read also failed, it DID change
    // — and that is exactly the path this message is shown on. The checkbox has been put back,
    // so the screen must not also promise the server agrees with it.
    visibilityFailed: "Could not change that, so it may not have changed. Reload to check.",
    sectionMeta: function (chars) {
      return chars.toLocaleString("en-GB") + (chars === 1 ? " character" : " characters");
    },

    // The locum checklist (#48). Same register as the visibility strings: what the row means
    // and what to do next. Present/missing describes the SAVED note, like the list above it.
    locumPresent: "In the note",
    locumMissing: "Not in the note yet",
    locumAdd: function (heading) { return "Add ## " + heading + " to the note"; },
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
    deleteButton: document.getElementById("delete-button"),
    saveState: document.getElementById("save-state"),
    agencyState: document.getElementById("agency-state"),
    sendFormat: document.getElementById("send-format"),
    visibilityList: document.getElementById("visibility-list"),
    visibilityEmpty: document.getElementById("visibility-empty"),
    visibilityState: document.getElementById("visibility-state"),
    locumList: document.getElementById("locum-list"),
    // Reserved for messages the checklist may need later; empty at every paint today.
    locumState: document.getElementById("locum-state"),
  };

  // `togglingKeys` is a re-entrancy guard keyed on client id AND heading slug, not a single
  // flag: two different sections may legitimately be in flight at once, but the same section of
  // the same client twice is a double-click racing itself. The client half is load-bearing —
  // see toggleField.
  //
  // `fieldsVersion` is the OTHER half of decision 4 above, and it took a bug to notice it was
  // missing. `reqId`/`savingId` answer "is this response about the client on screen" — identity.
  // They do not answer "has newer truth already been painted" — recency. Four paint sites had
  // the first guard and not the second, so the SLOWER of two responses won simply by landing
  // last: save the note (a 100k-character PUT), tick a section 60ms later (a 40-byte PUT that
  // answers first and is stored), and the save's older snapshot repaints the box unticked. The
  // server holds true and the screen says the section is not shared — for this feature the
  // harmful direction, because the recruiter is told a section is private that the portal will
  // ship.
  //
  // It counts PAINTS, not requests. A response that lost the race must not paint; it re-reads
  // instead, because by then the headings themselves may have changed.
  var state = {
    selected: null,
    dirty: false,
    saving: false,
    adding: false,
    deleting: false,
    togglingKeys: {},
    fieldsVersion: 0,
  };

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

  /** "Note: 1,842 characters · 6 packs", or "No note yet" — the row's main content, in the
   *  words a reader acts on. "0 characters" made them do the arithmetic; the empty state is
   *  the actionable one. Same function as app.js's rowMeta, deliberately. */
  function rowMeta(client) {
    var note = client.note_chars > 0
      ? "Note: " + client.note_chars.toLocaleString("en-GB") +
        (client.note_chars === 1 ? " character" : " characters")
      : "No note yet";
    return note + " · " + client.packs + (client.packs === 1 ? " pack" : " packs");
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
    // The list below describes the note as SAVED. Say so the moment the two diverge, rather
    // than letting a heading typed a second ago look like it is already accounted for. Not an
    // error: nothing has gone wrong, there is just a step left.
    showVisibilityState(COPY.visibilityStale, false);
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
    // A load is a whole-screen reset, so it CLAIMS the next paint rather than competing for
    // it: bumping first invalidates every save or toggle already in flight, and a second load
    // invalidates the first. Without the bump, a toggle answering between this request and its
    // response would leave the note painted from one client and the section list from another.
    state.fieldsVersion += 1;
    var fieldsAt = state.fieldsVersion;
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
        paintFields(body, fieldsAt);
        showVisibilityState("", false);
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
    // Captured with them, and for the same reason: this is the request whose answer is slowest
    // and therefore likeliest to arrive after a toggle the recruiter made while waiting.
    var fieldsAt = state.fieldsVersion;

    state.saving = true;
    setBusy(el.saveButton, true);
    el.saveButton.textContent = COPY.saving;

    api("/api/clients/" + encodeURIComponent(savingId), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note: sent }),
    })
      .then(function (body) {
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

        // The sections came back with the save, so the list follows the headings without a
        // second request. A renamed heading's permission was pruned server-side; re-rendering
        // from this response is how the screen stops showing a tick that no longer exists.
        //
        // Unless a toggle answered while this was in flight. Then this snapshot predates it and
        // painting it would undo, on screen only, a permission the server has already stored —
        // so re-read instead. A re-read rather than simply skipping the paint, because a save
        // is the one request that can RENAME headings: the rows themselves may be wrong here,
        // not just the ticks.
        if (!paintFields(body, fieldsAt)) repaintFields(savingId);
        showVisibilityState(stillTyping ? COPY.visibilityStale : "", false);

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

  /* ── what a candidate can see (#18) ──────────────────────────────────────────────────── */

  /**
   * The sections of the SAVED note, each with a checkbox.
   *
   * It describes the saved note deliberately: a heading typed but not saved has no key on the
   * server, so there is nothing to tick it against. When the note goes dirty the live region
   * says so (`visibilityStale`) rather than letting the list quietly describe something else.
   * Underneath, it is fail-closed regardless — an unsaved heading cannot be flagged at all.
   */
  function showVisibilityState(text, isError) {
    el.visibilityState.textContent = text;
    el.visibilityState.classList.toggle("is-error", Boolean(isError));
    el.visibilityState.classList.toggle("is-shown", Boolean(text));
  }

  function renderFields(fields) {
    var list = fields || [];

    // Same bug as the rail: rebuilding destroys the element the keyboard was on and drops
    // focus to <body>. Remember the key and put focus on its replacement.
    var active = document.activeElement;
    var focusedKey = active && active.dataset && active.dataset.key ? active.dataset.key : null;
    var refocus = null;

    el.visibilityList.textContent = "";
    el.visibilityList.hidden = list.length === 0;
    el.visibilityEmpty.hidden = list.length > 0;
    if (!list.length) {
      el.visibilityEmpty.textContent = COPY.visibilityEmpty;
      return;
    }

    list.forEach(function (field) {
      var box = document.createElement("input");
      box.type = "checkbox";
      box.checked = Boolean(field.candidate_visible);

      var name = document.createElement("span");
      name.className = "visibility-name";
      // textContent, never innerHTML: headings are agency-authored text and this is the one
      // place they are rendered.
      name.textContent = field.heading;

      var meta = document.createElement("span");
      meta.className = "visibility-meta";

      if (field.key === null) {
        // A duplicated heading cannot be told apart from its twin, here or in the database, so
        // it is not tickable. It is still listed, because the recruiter can see it in the
        // textarea and a section silently missing from this list reads as "already handled".
        // Real `disabled`, not aria-disabled: the house rule about aria-disabled is for a
        // transient busy state on a focused control, and this is a static "there is nothing to
        // press here" whose reason is in the row's own text.
        box.disabled = true;
        meta.textContent = COPY.visibilityDuplicate;
      } else {
        box.dataset.key = field.key;
        if (field.key === focusedKey) refocus = box;
        meta.textContent = COPY.sectionMeta(field.chars);
      }

      var label = document.createElement("label");
      label.appendChild(box);
      label.appendChild(name);
      label.appendChild(meta);

      var item = document.createElement("li");
      item.appendChild(label);
      el.visibilityList.appendChild(item);
    });

    if (refocus) refocus.focus();
  }

  /**
   * The locum checklist (#48): which of the five named locum-supply facts the SAVED note
   * records. Present/missing is server truth, exactly like the visibility list — inserting a
   * heading only dirties the editor, and the row flips to present after Save.
   *
   * `locumFields` may be undefined if a stale server build answers; render nothing rather
   * than throw.
   */
  function renderLocum(locumFields) {
    var list = locumFields || [];

    // Same focus rule as the rail and the visibility list: rebuilding destroys the button the
    // keyboard was on, so remember which field it was and refocus its replacement.
    var active = document.activeElement;
    var focusedId = active && active.dataset && active.dataset.locumId
      ? active.dataset.locumId
      : null;
    var refocus = null;

    el.locumList.textContent = "";
    el.locumList.hidden = list.length === 0;

    list.forEach(function (field) {
      var name = document.createElement("span");
      name.className = "visibility-name";
      // textContent, never innerHTML — same rule as every other rendered string here.
      name.textContent = field.heading;

      var meta = document.createElement("span");
      meta.className = "visibility-meta";
      meta.textContent = field.hint;

      var item = document.createElement("li");
      item.appendChild(name);
      item.appendChild(meta);

      var status = document.createElement("span");
      status.className = "visibility-meta";
      status.textContent = field.present ? COPY.locumPresent : COPY.locumMissing;
      item.appendChild(status);

      if (!field.present) {
        var button = document.createElement("button");
        button.type = "button";
        button.className = "btn";
        button.dataset.heading = field.heading;
        button.dataset.locumId = field.id;
        button.textContent = COPY.locumAdd(field.heading);
        if (field.id === focusedId) refocus = button;
        item.appendChild(button);
      }

      el.locumList.appendChild(item);
    });

    if (refocus) refocus.focus();
  }

  /**
   * Paint both lists that describe the saved note, unless newer truth has already been
   * painted.
   *
   * `seen` is the value of `state.fieldsVersion` captured BEFORE the request that produced
   * `body` went out. If it has moved, something more recent has already been drawn and this
   * response is stale — it must not paint, whatever its own identity guard says.
   *
   * It takes the whole response body so the visibility list and the locum checklist always
   * paint together, from the same answer, under the same version check — a checklist painted
   * from a response the visibility list rejected as stale would be the recency bug again.
   *
   * Returns whether it painted, so a losing caller can decide to re-read instead of silently
   * dropping the answer.
   */
  function paintFields(body, seen) {
    if (state.fieldsVersion !== seen) return false;
    renderFields(body.fields);
    renderLocum(body.locum_fields);
    state.fieldsVersion += 1;
    return true;
  }

  /**
   * Ask the server what it actually holds now, and paint that.
   *
   * The answer for a response that lost the recency race. Re-reading rather than keeping the
   * loser's snapshot matters most on the save path: a save can RENAME headings, so the stale
   * answer is not merely out of date about which boxes are ticked, it can be out of date about
   * which rows exist. It captures its own version at request time, so it plays by the same
   * rule it was called to repair.
   */
  function repaintFields(clientId) {
    var seen = state.fieldsVersion;
    return api("/api/clients/" + encodeURIComponent(clientId))
      .then(function (body) {
        if (state.selected !== clientId) return;
        paintFields(body, seen);
      })
      .catch(function () {
        // Whatever message is on screen stands. This path exists to correct a stale PAINT, and
        // failing to correct it leaves the previous paint — which was itself a server answer.
      });
  }

  /**
   * Tick or untick one section. This mirrors saveAgency, not save: it saves the moment it is
   * made, has its own live region, and puts the control back from server truth on failure.
   *
   * It must not touch state.dirty in either direction. Setting it would make beforeunload warn
   * about a change that was already stored; clearing it would throw away the warning the note's
   * unsaved text still needs.
   */
  function toggleField(box, key, wanted) {
    // Captured before the guard, not after. A heading slug is not unique across clients —
    // `## Their process` is this screen's own worked example, so two clients sharing a slug is
    // the ordinary case. Keyed on the slug alone, a slow toggle on client A silently swallowed
    // the same-named toggle on client B: the native checkbox has already flipped by the time
    // `change` fires, the early return sent no request and put nothing back, and A's answer
    // bails on `savingId` without re-rendering B. B was then showing a permission that was
    // never stored, until a reload.
    var savingId = state.selected;
    var guard = savingId + "|" + key;
    if (state.togglingKeys[guard]) {
      // The native checkbox has ALREADY flipped by the time `change` fires, so returning here
      // without touching it leaves the screen showing a value nothing is going to store. Put
      // back what the in-flight request is writing — which is what its answer will paint
      // anyway — so the discarded tap leaves no trace instead of a silent lie.
      //
      // The window this closes is not theoretical: a 1.5s PUT plus an impatient second tap
      // showed "not shared" for ~1.4s on a section being stored as shared, then snapped. A
      // hung fetch stretches that to minutes.
      box.checked = !wanted;
      return;
    }

    state.togglingKeys[guard] = true;

    // Same rule as save: whatever is painted when this answer lands wins over this answer if it
    // is newer. Two toggles resolving out of order would otherwise leave the loser's snapshot
    // on screen, showing a tick the server does not hold.
    var fieldsAt = state.fieldsVersion;

    var patch = { visibility: {} };
    patch.visibility[key] = wanted;

    api("/api/clients/" + encodeURIComponent(savingId), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    })
      .then(function (body) {
        if (state.selected !== savingId) return;
        // Re-rendered from what the server stored, never from the checkbox that was clicked —
        // and only if nothing newer has been painted since this toggle was sent.
        if (!paintFields(body, fieldsAt)) repaintFields(savingId);
        // "Saved" must not overwrite the stale-list warning. The note can be dirty while a
        // toggle succeeds, and the list is still describing the note as it was saved — which is
        // the more important of the two things to be saying.
        showVisibilityState(state.dirty ? COPY.visibilityStale : COPY.visibilitySaved, false);
      })
      .catch(function (err) {
        if (state.selected !== savingId) return;
        // Put the control back immediately, then re-read, so the screen never shows a
        // permission that was not stored.
        box.checked = !wanted;
        showVisibilityState(messageFor(err, COPY.visibilityFailed), true);
        // The recovery read captures its own version at ITS request time, not this toggle's —
        // it is asking what the server holds now, which is exactly the newest truth available.
        // This is the site that gets missed: it is inside the `.catch`, so the happy path never
        // exercises it, and it is the one place the screen has nothing else to go on.
        return repaintFields(savingId);
      })
      .then(function () {
        delete state.togglingKeys[guard];
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
        // Not the save-note fallback: this strip has no text field, so "your text is still
        // here" describes nothing on it.
        el.agencyState.textContent = messageFor(err, COPY.settingFailed);
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

  // One delegated listener, because the list is rebuilt on every save and every toggle. A
  // listener per row would be re-attached each time and leak the ones before it.
  el.visibilityList.addEventListener("change", function (event) {
    var box = event.target;
    if (!box || box.type !== "checkbox" || !box.dataset.key) return;
    toggleField(box, box.dataset.key, box.checked);
  });

  // Delegated for the same reason as the visibility listener: the checklist is rebuilt on
  // every paint. Inserting is an ordinary edit — it appends the heading, marks the note dirty
  // and hands focus to the textarea with the caret at the end, where the body goes next. The
  // row flips to present only after Save, because present describes the SAVED note.
  el.locumList.addEventListener("click", function (event) {
    var button = event.target;
    if (!button || !button.dataset || !button.dataset.heading) return;
    el.note.value += (el.note.value ? "\n\n" : "") + "## " + button.dataset.heading + "\n";
    markDirty();
    el.note.focus();
    el.note.setSelectionRange(el.note.value.length, el.note.value.length);
  });

  el.deleteButton.addEventListener("click", function () {
    if (state.deleting || !state.selected) return;
    // The name from the heading, so the confirm names what the reader is looking at. Unsaved
    // edits need no second confirm: deleting the client is a stronger statement about the note
    // than abandoning a draft of it.
    var name = el.editorHead.textContent;
    if (!window.confirm(COPY.deleteConfirm(name))) return;

    var deletingId = state.selected;
    state.deleting = true;
    setBusy(el.deleteButton, true);
    el.deleteButton.textContent = COPY.deleting;

    api("/api/clients/" + encodeURIComponent(deletingId), { method: "DELETE" })
      .then(function () {
        if (state.selected !== deletingId) return;
        state.dirty = false; // the note went with the client; the leave-warning guards nothing
        select(null);
        showRailState(COPY.deleted(name), false);
      })
      .catch(function (err) {
        if (state.selected !== deletingId) return;
        if (err && err.code === "not_found") {
          // Already gone, likely deleted in another tab. The screen catches up rather than
          // reporting a failure about a row that no longer exists.
          state.dirty = false;
          select(null);
          showRailState(COPY.deleted(name), false);
          return;
        }
        // The editor stays as it was: same rule as a failed save.
        showSaveState(messageFor(err, COPY.deleteFailed), true);
      })
      .then(function () {
        state.deleting = false;
        setBusy(el.deleteButton, false);
        el.deleteButton.textContent = COPY.deleteIdle;
      });
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
