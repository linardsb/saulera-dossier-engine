/* The one screen (#8), and the recruiter's half of the generation seam (#6 as amended).
 *
 * Vanilla, no framework, no build step — the same idiom as clients.js, which this file mirrors
 * closely enough that the two are one system rather than two.
 *
 * Three acts: paste the inputs and copy the prompt, go to Claude and come back with the reply,
 * read the verified pack and copy it. The model call happens in the recruiter's own Claude
 * session, so act 2 is a designed wait for work happening in another application rather than a
 * spinner over a request this deployment made.
 *
 * Six behaviours here are decisions rather than implementation details:
 *
 * 1. Nothing is written to browser storage of any kind: not local storage, not session storage,
 *    not cookies, not IndexedDB. A brief, a CV and a generated pack are candidate data, and
 *    "transient" has to include the browser or the sentence is not true. Losing a paste on
 *    refresh is a designed moment, which is what the beforeunload guard at the bottom is for.
 *    (Written without the API names on purpose: the Level 1 gate greps this file for them, and
 *    a gate that cries wolf at a comment gets deleted.)
 *
 * 2. Nothing candidate-shaped goes in the URL. Only ?client=<uuid>, an id and never a name.
 *
 * 3. The clipboard write for the prompt is started in the SAME TASK as the click. Safari drops
 *    transient user activation across an await, so a write issued after the round trip returned
 *    rejects silently — the single most likely functional bug in this file. The item is built
 *    synchronously with the in-flight request's promise as its value. See copyPrompt.
 *
 * 4. The brief and the CV freeze when the prompt is copied, and what gets sent to /api/verify is
 *    that frozen text rather than the live textarea. The verifier searches for each quote in the
 *    CV; if the CV it searches is not the CV the model read, claims demote. That fails closed,
 *    which is correct, but it shows a pack that looks worse than it is for no reason.
 *
 * 5. Every response is checked against the request that asked for it before it writes anything.
 *    A pack rendered under a client the recruiter has already moved away from is a pack about to
 *    be sent to the wrong trust.
 *
 * 6. The clock is stopped in exactly one place, setPhase. Success, Start again, a client switch
 *    and a failed read are four exits from the wait and three of them are easy to forget; two
 *    live intervals double the tick rate, and a stale one keeps the elapsed arithmetic alive
 *    across a reset so the next pack records a duration including the abandoned attempt.
 */

(function () {
  "use strict";

  var COPY = {
    copyIdle: "Copy the prompt and open Claude",
    copying: "Building the prompt…",
    promptCopied: "Copied, and Claude is open in the other tab. Paste it there. When it " +
                  "answers, copy the whole reply and press ⌘V back on this page.",
    // The tab was blocked, so the recruiter has the prompt but nowhere obvious to put it. Say
    // where, rather than leaving "paste it into Claude" pointing at nothing.
    promptCopiedNoTab: "Copied. Open Claude and paste it there. When it answers, copy the " +
                       "whole reply and press ⌘V back on this page.",
    openClaude: "Open Claude",
    promptManual: "Your browser would not let this page use the clipboard. The prompt is " +
                  "below. Select it and copy it by hand.",
    readIdle: "Show the pack",
    reading: "Checking the sources…",
    packReady: "Every claim is checked. Read the marks before you send it.",
    packCopied: "Copied. Paste it into your email.",
    packCopyFailed: "Could not copy. Select the pack and copy it by hand.",

    pickClient: "Pick a client first.",
    needInputs: "Paste the brief and the CV before you copy the prompt.",
    needReply: "Paste Claude's reply first.",

    sessionExpired: "Your session expired. Reload the page to sign in again.",
    // Setup faults a recruiter cannot fix. "not connected to its database" is load-bearing:
    // the clients-screen probe matches it, and DEPLOY.md's triage table keys off the two codes.
    notConfigured: "This tool is not connected to its database, so nothing can be read or " +
                   "saved yet. Ask whoever set it up.",
    notMigrated: "This tool's database is empty, so nothing can be read or saved yet. Ask " +
                 "whoever set it up.",
    noteEmpty: "There is no note for this client yet. Write down how they hire, then come back.",
    noteEmptyLink: "Write the note",
    unknownClient: "That client does not exist. Pick one from the list.",
    missingFields: "Paste the brief and the CV before you copy the prompt.",
    tooLong: "That is longer than 100,000 characters. Shorten it and try again. Your text is " +
             "still here.",
    noPack: "That does not look like a pack. Copy the whole of Claude's reply, including the " +
            "code block at the end, and paste it again.",
    badPack: "Claude's reply is missing something the pack needs. Ask it to try again, then " +
             "paste the new reply.",

    listFailed: "Could not load the client list. Reload the page.",
    promptFailed: "Could not build the prompt. Your text is still here. Try again.",
    verifyFailed: "Could not read that pack. Your reply is still here. Try again.",
    eventFailed: "The pack is ready. The counter did not record this one.",

    fileNotText: "This reads PDF, Word (.docx) and plain text. Open the file and paste the " +
                 "text instead.",
    fileFailed: "Could not read that file. Paste the text instead.",
    // A scanned CV is the common case here, and naming it is the difference between a
    // recruiter retrying the same file and a recruiter pasting the text.
    fileUnreadable: "No text could be read from that file. It is most likely a scan or an " +
                    "image. Open it, copy the text, and paste it instead.",
    fileReading: "Reading the file…",

    // Named, because "you have a pack in progress" is not enough to decide by when the whole
    // risk is sending one client's pack under another client's name.
    leavingClient: function (name) {
      return (name ? "You are part way through a pack for " + name + ". " : "You are part way " +
        "through a pack. ") + "Switching client clears the reply and the pack.";
    },

    marks: {
      cv: "CV",
      client_note: "Our note",
      unverified: "Unverified",
      failed: "Quote not found"
    },

    sections: {
      evidence: "Against the brief",
      process_fit: "What we know about your process",
      gaps: "Where they do not meet the brief"
    },

    questionsHead: "Before you send this",
    renderers: {
      appendix: "Sources go in an appendix.",
      inline: "Sources sit beside each claim."
    }
  };

  var el = {
    list: document.getElementById("client-list"),
    railEmpty: document.getElementById("rail-empty"),
    railState: document.getElementById("rail-state"),

    actInputs: document.getElementById("act-inputs"),
    brief: document.getElementById("brief"),
    cv: document.getElementById("cv"),
    briefFile: document.getElementById("brief-file"),
    cvFile: document.getElementById("cv-file"),
    copyPrompt: document.getElementById("copy-prompt"),
    inputsState: document.getElementById("inputs-state"),
    fallback: document.getElementById("prompt-fallback"),
    promptText: document.getElementById("prompt-text"),

    actWaiting: document.getElementById("act-waiting"),
    elapsed: document.getElementById("elapsed"),
    reply: document.getElementById("reply"),
    readPack: document.getElementById("read-pack"),
    waitingState: document.getElementById("waiting-state"),
    startAgain: document.getElementById("start-again"),

    actPack: document.getElementById("act-pack"),
    provenanceSummary: document.getElementById("provenance-summary"),
    packBody: document.getElementById("pack-body"),
    copyPack: document.getElementById("copy-pack"),
    rendererNote: document.getElementById("renderer-note"),
    packState: document.getElementById("pack-state"),
    startAgain2: document.getElementById("start-again-2")
  };

  var state = {
    selected: null,
    clientName: "",
    phase: "inputs",
    sent: null,
    startedAt: null,
    tick: null,
    clipboard: null,
    reqId: 0,
    busy: false
  };

  // A pre-check on the upload path only, so a 2 MB file fails here rather than after a round
  // trip carrying it. src/prompt.js holds the real one and the server is authoritative; this
  // number existing in two places is the cost of having no build step to share it.
  var INPUT_MAX = 100000;

  // The recruiter's own Claude session — the deployment holds no key and calls no model, so
  // this is where generation actually happens. A new conversation, so a previous candidate's
  // pack is never in the context of the next one.
  var CLAUDE_URL = "https://claude.ai/new";

  /* ── talking to the API ──────────────────────────────────────────────────────────────── */

  /**
   * One fetch, with the two checks that matter. res.ok is not enough on this deployment:
   * Cloudflare Access answers an expired session with the sign-in page's HTML at 200, so
   * res.json() throws a parse error and the screen reports a generic failure when the fix is
   * "sign in again". clients.js:90-101, unchanged.
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

  function postJson(path, body) {
    return api(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
  }

  /**
   * The message for an error, with the caller naming its own fallback.
   *
   * The fallback is a parameter because the same codes surface in three acts and a message
   * describing the wrong one is worse than a generic message. "Your reply is still here" on the
   * act where there is no reply describes a situation the recruiter is not in.
   */
  function messageFor(err, fallback) {
    var otherwise = fallback || COPY.promptFailed;
    if (!err) return otherwise;
    if (err.code === "session_expired") return COPY.sessionExpired;
    if (err.code === "not_configured") return COPY.notConfigured;
    if (err.code === "not_migrated") return COPY.notMigrated;
    if (err.code === "note_empty") return COPY.noteEmpty;
    if (err.code === "not_found") return COPY.unknownClient;
    if (err.code === "missing_fields") return COPY.missingFields;
    if (err.code === "too_long") return COPY.tooLong;
    if (err.code === "no_pack") return COPY.noPack;
    if (err.code === "bad_pack") return COPY.badPack;
    return otherwise;
  }

  /* ── state lines ─────────────────────────────────────────────────────────────────────── */

  /** @param link  optional { href, text } appended after the message, for note_empty. */
  function showState(node, text, isError, link) {
    node.textContent = text;
    if (link) {
      node.appendChild(document.createTextNode(" "));
      var anchor = document.createElement("a");
      anchor.href = link.href;
      anchor.textContent = link.text;
      node.appendChild(anchor);
    }
    node.classList.toggle("is-error", Boolean(isError));
    node.classList.add("is-shown");
  }

  function clearState(node) {
    node.textContent = "";
    node.classList.remove("is-error");
  }

  /**
   * Busy without `disabled`. Setting `disabled` on the focused button moves focus to <body> in
   * every engine and does not give it back, so a keyboard user loses their place on every
   * action. The real guard is the state.busy early return. clients.js:215-218.
   */
  function setBusy(button, busy) {
    if (busy) button.setAttribute("aria-disabled", "true");
    else button.removeAttribute("aria-disabled");
  }

  /* ── the acts ────────────────────────────────────────────────────────────────────────── */

  function showAct(node, visible) {
    if (!visible) {
      node.hidden = true;
      return;
    }
    if (!node.hidden) return;
    node.hidden = false;
    // The one authored moment. Two frames, because a class set in the same frame as the
    // unhide is coalesced and nothing transitions. Under reduced motion the duration is
    // ~0ms and the final state renders instantly, which is the required behaviour.
    node.classList.add("is-entering");
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () {
        node.classList.remove("is-entering");
      });
    });
  }

  /**
   * The only transition function, and the only place the clock is stopped.
   *
   * Every exit from the wait goes through here, which is what makes "the interval is always
   * cleared" a property of one line rather than a promise repeated at four call sites.
   */
  function setPhase(next) {
    stopClock();
    state.phase = next;
    showAct(el.actInputs, true); // act 1 stays readable while checking the pack, see below
    showAct(el.actWaiting, next === "waiting" || next === "pack");
    showAct(el.actPack, next === "pack");
    if (next === "waiting") startClock();
    // Say so rather than only refusing. Act 2 stays on screen in phase "pack" so the recruiter
    // can still see what they pasted, which leaves a live-looking button that no longer does
    // anything — aria-disabled is how the rest of this screen says "not right now".
    setBusy(el.readPack, next === "pack");
    // The arriving act comes to the reader. Act 3 otherwise renders two viewports down and
    // "nothing happened" is what a recruiter sees. Never on "inputs": that is the load and
    // reset path, where jumping the page is the bug. Smooth only when motion is welcome.
    if (next === "waiting" || next === "pack") {
      var arrived = next === "waiting" ? el.actWaiting : el.actPack;
      arrived.scrollIntoView({
        block: "start",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth"
      });
    }
  }

  function startClock() {
    stopClock();
    state.startedAt = Date.now();
    renderElapsed();
    state.tick = window.setInterval(renderElapsed, 1000);
  }

  function stopClock() {
    if (state.tick !== null) {
      window.clearInterval(state.tick);
      state.tick = null;
    }
  }

  function renderElapsed() {
    if (state.startedAt === null) {
      el.elapsed.textContent = "";
      return;
    }
    var seconds = Math.floor((Date.now() - state.startedAt) / 1000);
    var mm = String(Math.floor(seconds / 60)).padStart(2, "0");
    var ss = String(seconds % 60).padStart(2, "0");
    el.elapsed.textContent = mm + ":" + ss;
  }

  /** Back to act 1, keeping the brief and the CV. Losing a paste is the real error state. */
  function resetToInputs() {
    setPhase("inputs");
    state.sent = null;
    state.startedAt = null;
    state.clipboard = null;
    el.reply.value = "";
    el.packBody.textContent = "";
    el.provenanceSummary.textContent = "";
    el.rendererNote.textContent = "";
    el.brief.readOnly = false;
    el.cv.readOnly = false;
    el.elapsed.textContent = "";
    el.fallback.hidden = true;
    el.promptText.value = "";
    clearState(el.inputsState);
    clearState(el.waitingState);
    clearState(el.packState);
  }

  /* ── the rail ────────────────────────────────────────────────────────────────────────── */

  /** "Note: 1,842 characters · 6 packs", or "No note yet" — the words a recruiter acts on.
   *  "0 characters" made the reader do the arithmetic; the empty state is the actionable one. */
  function rowMeta(client) {
    var note = client.note_chars > 0
      ? "Note: " + client.note_chars.toLocaleString("en-GB") +
        (client.note_chars === 1 ? " character" : " characters")
      : "No note yet";
    return note + " · " + client.packs + (client.packs === 1 ? " pack" : " packs");
  }

  function renderList(clients) {
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
      if (client.id === state.selected) {
        row.setAttribute("aria-current", "true");
        // The list is the only place a name is known on the paths that do not carry one: a deep
        // link into ?client=<id> and a popstate both call load() with no name. Without this the
        // switch-client confirm falls back to its unnamed wording in exactly the case it was
        // written for, which is a recruiter who arrived by bookmark and is one click from
        // carrying one client's pack into another's.
        state.clientName = client.name;
      }
      if (client.id === focusedId) refocus = row;

      var name = document.createElement("span");
      name.className = "client-name";
      // textContent, never an HTML-parsing assignment: agency-authored text, and the same rule
      // the pack preview below is held to for model output. (The property name is spelled out
      // nowhere in this file on purpose — the Level 1 gate greps for it, and a gate that fires
      // on a comment gets deleted. clients.js:11-12 does the same for the storage APIs.)
      name.textContent = client.name;

      var meta = document.createElement("span");
      meta.className = "client-meta";
      meta.textContent = rowMeta(client);

      row.appendChild(name);
      row.appendChild(meta);
      row.addEventListener("click", function () { select(client.id, client.name); });

      var item = document.createElement("li");
      item.appendChild(row);
      el.list.appendChild(item);
    });

    if (refocus) refocus.focus();
  }

  function refreshList() {
    return api("/api/clients")
      .then(function (body) {
        renderList(body.clients);
        adoptOnlyClient(body.clients);
      })
      .catch(function (err) { showState(el.railState, messageFor(err, COPY.listFailed), true); });
  }

  /**
   * One client and none picked: pick it. The MVP is literally one client (PRD §6), so the
   * common case should not open on a list of one asking to be clicked.
   *
   * replaceState, never pushState — the recruiter made no choice, so Back must not have to
   * step through one. A deep link to a different id wins: state.selected is already set by
   * the time the list lands, and the guard below does not fire. Re-entry is safe the same
   * way: load() runs refreshList() again, but by then the client is selected.
   */
  function adoptOnlyClient(clients) {
    if (clients.length !== 1 || state.selected !== null) return;
    var only = clients[0];
    var url = new URL(window.location.href);
    url.searchParams.set("client", only.id);
    window.history.replaceState({ client: only.id }, "", url);
    load(only.id, only.name);
  }

  /**
   * Switch client.
   *
   * Asked before anything moves. Past act 1 there is a reply or a pack on screen that belongs to
   * the client being left, and carrying either into a different client is how a pack reaches the
   * wrong trust. The brief and the CV survive the switch: they are the recruiter's typing.
   */
  function select(id, name) {
    if (id === state.selected) return;
    if (state.phase !== "inputs" && !window.confirm(COPY.leavingClient(state.clientName))) return;

    var url = new URL(window.location.href);
    if (id) url.searchParams.set("client", id);
    else url.searchParams.delete("client");
    window.history.pushState({ client: id }, "", url);
    // After a picked client the next action is always a paste, so the caret goes where the
    // paste goes. Click path only: a deep link or a Back must not steal focus from the rail.
    // Chained after load() so it lands after renderList's row refocus, and wins.
    load(id, name).then(function () { el.brief.focus(); });
  }

  function load(id, name) {
    // Any response still in flight was asked for under the previous client and must write
    // nothing when it lands.
    state.reqId += 1;
    state.selected = id;
    state.clientName = name || "";
    resetToInputs();
    clearState(el.railState);
    return refreshList();
  }

  /* ── the clipboard ───────────────────────────────────────────────────────────────────── */

  /**
   * Write to the clipboard, keeping the user gesture.
   *
   * `textPromise` is passed as the ClipboardItem's VALUE rather than awaited first. Safari
   * treats an await before the write as losing transient user activation and rejects silently,
   * and this write happens after a round trip by construction. Building the item synchronously
   * with a pending value is the documented way to hold the gesture across it.
   *
   * Resolves true or false, never rejects: the caller decides what a refusal means, and there is
   * always something better to do than an unhandled error.
   */
  function writeText(textPromise) {
    var clipboard = navigator.clipboard;
    var yes = function () { return true; };
    var no = function () { return false; };

    if (clipboard && window.ClipboardItem) {
      try {
        var item = new window.ClipboardItem({
          "text/plain": textPromise.then(function (text) {
            return new Blob([text], { type: "text/plain" });
          })
        });
        return clipboard.write([item]).then(yes, no);
      } catch (err) {
        // A browser whose ClipboardItem refuses a promise value. Fall through to writeText,
        // which loses the gesture in Safari but is correct everywhere it is reached.
      }
    }
    if (clipboard && clipboard.writeText) {
      return textPromise.then(function (text) { return clipboard.writeText(text); })
        .then(yes, no);
    }
    return Promise.resolve(false);
  }

  /* ── act 1 to act 2 ──────────────────────────────────────────────────────────────────── */

  function copyPrompt() {
    if (state.busy) return;

    if (!state.selected) {
      showState(el.inputsState, COPY.pickClient, true);
      return;
    }
    if (!el.brief.value.trim()) {
      showState(el.inputsState, COPY.needInputs, true);
      el.brief.focus();
      return;
    }
    if (!el.cv.value.trim()) {
      showState(el.inputsState, COPY.needInputs, true);
      el.cv.focus();
      return;
    }

    // Opened here, synchronously inside the click, for the same reason the clipboard item is
    // built here: a popup opened after an await has lost its user gesture and is blocked.
    //
    // The tab carries no payload. A prompt is the note plus the brief plus the CV plus the
    // schema — tens of thousands of characters — and putting that in a query string is a length
    // limit waiting to truncate a CV silently. The clipboard carries it; the tab just means the
    // recruiter is not left holding a string with nowhere to put it, which is what "paste the
    // prompt into Claude" meant before this.
    var claudeTab = window.open(CLAUDE_URL, "_blank", "noopener");

    var clientId = state.selected;
    var brief = el.brief.value;
    var cv = el.cv.value;
    state.reqId += 1;
    var reqId = state.reqId;
    var mine = function () { return state.reqId === reqId && state.selected === clientId; };

    state.busy = true;
    setBusy(el.copyPrompt, true);
    el.copyPrompt.textContent = COPY.copying;
    el.fallback.hidden = true;
    clearState(el.inputsState);

    // Started here, in the click handler's own task, so its promise can be the clipboard item's
    // value while the gesture is still live.
    var pending = postJson("/api/prompt", { client_id: clientId, brief: brief, cv: cv });

    // The stale check lives INSIDE the clipboard's value, not only around the screen update.
    // A promise-valued clipboard write is committed at click time and completes whenever the
    // value resolves, so a recruiter who switches client mid-flight would otherwise end up
    // holding the previous client's prompt with nothing on screen saying so — and paste it.
    // Rejecting here is the only way to withdraw a write that is already in flight.
    var promptText = pending.then(function (body) {
      if (!mine()) throw new Error("stale");
      return body.prompt;
    });
    // Marked handled: it is consumed by the clipboard write below, but a browser that never
    // reads the item's value would otherwise leave this rejection unobserved.
    promptText.catch(function () {});

    var wrote = writeText(promptText);

    pending
      .then(function (body) {
        return wrote.then(function (ok) {
          if (!mine()) return;
          if (ok) {
            enterWaiting(brief, cv);
            showState(
              el.waitingState,
              claudeTab ? COPY.promptCopied : COPY.promptCopiedNoTab,
              false
            );
          } else {
            // Not a dead end. The prompt is the one thing the whole flow depends on, so a
            // refused clipboard puts it on screen to be selected by hand.
            el.fallback.hidden = false;
            el.promptText.value = body.prompt;
            showState(el.inputsState, COPY.promptManual, true);
          }
        });
      })
      .catch(function (err) {
        if (!mine()) return;
        // A client with no note is the one failure with a remedy on another screen, so it gets
        // the link rather than a message the recruiter has to interpret.
        var link = err && err.code === "note_empty" && state.selected
          ? { href: "/clients?client=" + encodeURIComponent(state.selected),
              text: COPY.noteEmptyLink }
          : null;
        showState(el.inputsState, messageFor(err, COPY.promptFailed), true, link);
      })
      .then(function () {
        state.busy = false;
        setBusy(el.copyPrompt, false);
        el.copyPrompt.textContent = COPY.copyIdle;
      });
  }

  /**
   * Freeze what was sent and start the clock.
   *
   * The freeze is the point. /api/verify searches the CV for each quote, and the CV it searches
   * has to be the CV the model read or every claim demotes for a reason that is not the model's
   * fault. readOnly rather than disabled, so the text stays selectable and readable while the
   * recruiter checks the pack against it.
   */
  function enterWaiting(brief, cv) {
    state.sent = { brief: brief, cv: cv };
    el.brief.readOnly = true;
    el.cv.readOnly = true;
    setPhase("waiting");
    el.reply.focus();
  }

  /* ── act 2 to act 3 ──────────────────────────────────────────────────────────────────── */

  function readPack() {
    if (state.busy) return;
    if (!state.sent) return;
    // Only from the wait. A pack is already on screen in phase "pack", and pressing this again
    // would record a SECOND event whose duration is measured from the original copy-prompt —
    // one pack, two events, the later one carrying a span that includes the first attempt.
    // "One event per pack" is the acceptance line, so a different pack means Start again, which
    // keeps the brief and the CV and costs one more click.
    if (state.phase !== "waiting") return;

    if (!el.reply.value.trim()) {
      showState(el.waitingState, COPY.needReply, true);
      el.reply.focus();
      return;
    }

    var clientId = state.selected;
    state.reqId += 1;
    var reqId = state.reqId;
    var mine = function () { return state.reqId === reqId && state.selected === clientId; };

    state.busy = true;
    setBusy(el.readPack, true);
    el.readPack.textContent = COPY.reading;
    clearState(el.waitingState);

    postJson("/api/verify", {
      client_id: clientId,
      // The frozen CV, never el.cv.value. See enterWaiting.
      cv: state.sent.cv,
      pack_text: el.reply.value,
      duration_ms: Date.now() - state.startedAt
    })
      .then(function (body) {
        if (!mine()) return;
        renderPack(body);
        state.clipboard = { text: body.text, html: body.html };
        setPhase("pack");
        showState(
          el.packState,
          body.event_recorded ? COPY.packReady : COPY.eventFailed,
          !body.event_recorded
        );
        // preventScroll, so the smooth scroll setPhase just started lands on the pack's TOP
        // rather than being yanked to this button below it. Engines without the option object
        // ignore it and scroll, which is the old behaviour rather than a break.
        el.copyPack.focus({ preventScroll: true });
      })
      .catch(function (err) {
        if (!mine()) return;
        // Stay in the wait with the reply still on screen. It took a trip to another
        // application to get, and it is the one thing on this act worth keeping.
        showState(el.waitingState, messageFor(err, COPY.verifyFailed), true);
      })
      .then(function () {
        state.busy = false;
        // Not an unconditional false: this cleanup runs after setPhase("pack") on the success
        // path and would hand the button back at the one moment it must stay inert.
        setBusy(el.readPack, state.phase === "pack");
        el.readPack.textContent = COPY.readIdle;
      });
  }

  /* ── the pack preview ────────────────────────────────────────────────────────────────── */

  /** Whitespace collapsed for DISPLAY only. The stored quote keeps the source document's own
   *  line breaks because the verifier matched against them. src/render/text.js:33. */
  function displayQuote(s) {
    return String(s === undefined || s === null ? "" : s).replace(/\s+/g, " ").trim();
  }

  /** The mark's word and colour. A failed check reads differently from an honest "I could not
   *  source this", because the recruiter's next move differs: one is a retry, one is a check. */
  function markFor(claim) {
    if (claim.source_type === "cv") return { word: COPY.marks.cv, cls: "mark-cv" };
    if (claim.source_type === "client_note") {
      return { word: COPY.marks.client_note, cls: "mark-note" };
    }
    if (claim.failed_quote) return { word: COPY.marks.failed, cls: "mark-failed" };
    return { word: COPY.marks.unverified, cls: "mark-unverified" };
  }

  function claimNode(claim) {
    var mark = markFor(claim);

    var block = document.createElement("div");
    block.className = "claim";
    if (mark.cls === "mark-failed") block.classList.add("claim-failed");
    else if (mark.cls === "mark-unverified") block.classList.add("claim-unverified");

    var head = document.createElement("div");
    head.className = "claim-head";

    var text = document.createElement("p");
    text.className = "claim-text";
    if (claim.requirement) {
      var requirement = document.createElement("span");
      requirement.className = "claim-requirement";
      requirement.textContent = claim.requirement + ": ";
      text.appendChild(requirement);
    }
    // textContent, never an HTML-parsing assignment. This is model output rendered into the page.
    text.appendChild(document.createTextNode(String(claim.text || "")));

    var badge = document.createElement("span");
    badge.className = "mark " + mark.cls;
    badge.textContent = mark.word;

    head.appendChild(text);
    head.appendChild(badge);
    block.appendChild(head);

    // A failed claim shows its quote ONCE, under the failure line below. verifyPack demotes by
    // copying source_quote into failed_quote and leaving source_quote where it was, so rendering
    // both prints the same sentence twice — once looking like evidence and once as the thing
    // that is not evidence, which is the opposite of what the mark is telling the recruiter.
    var quote = claim.failed_quote ? "" : displayQuote(claim.source_quote);
    if (quote) {
      var source = document.createElement("p");
      source.className = "claim-source";
      source.textContent = "“" + quote + "”";
      block.appendChild(source);
    }

    // What the model thought it was citing, kept so a bad pack is diagnosable rather than
    // merely rejected. Without it the recruiter knows something failed and not what.
    if (claim.failed_quote) {
      var failed = document.createElement("p");
      failed.className = "claim-failed-quote";
      failed.textContent = "Not found in the source: “" + displayQuote(claim.failed_quote) + "”";
      block.appendChild(failed);
    }

    return block;
  }

  function sectionNode(title, claims) {
    if (!claims || !claims.length) return null;
    var section = document.createElement("section");
    section.className = "pack-section";

    var head = document.createElement("h3");
    head.className = "pack-section-head";
    head.textContent = title;
    section.appendChild(head);

    claims.forEach(function (claim) { section.appendChild(claimNode(claim)); });
    return section;
  }

  function renderPack(body) {
    var pack = body.pack;
    el.packBody.textContent = "";

    var role = document.createElement("h3");
    role.className = "pack-role";
    role.textContent = String(pack.role_title || "");
    el.packBody.appendChild(role);

    var meta = document.createElement("p");
    meta.className = "pack-meta";
    meta.textContent = "Candidate " + String(pack.candidate_ref || "");
    el.packBody.appendChild(meta);

    var headline = document.createElement("p");
    headline.className = "pack-headline";
    headline.textContent = String(pack.headline || "");
    el.packBody.appendChild(headline);

    ["evidence", "process_fit", "gaps"].forEach(function (key) {
      var section = sectionNode(COPY.sections[key], pack[key]);
      if (section) el.packBody.appendChild(section);
    });

    if (pack.open_questions && pack.open_questions.length) {
      var questions = document.createElement("section");
      questions.className = "pack-section";

      var head = document.createElement("h3");
      head.className = "pack-section-head";
      head.textContent = COPY.questionsHead;
      questions.appendChild(head);

      var list = document.createElement("ul");
      list.className = "pack-questions";
      pack.open_questions.forEach(function (question) {
        var item = document.createElement("li");
        item.textContent = String(question);
        list.appendChild(item);
      });
      questions.appendChild(list);
      el.packBody.appendChild(questions);
    }

    // The headline number, worn in the marks' own colours — word plus colour, never colour
    // alone, same rule as the marks. Built element by element: model-adjacent numbers still
    // go nowhere near an HTML-parsing assignment.
    var sourced = body.provenance.cv + body.provenance.client_note;
    var unverified = body.provenance.unverified;
    el.provenanceSummary.textContent = "";
    var sourcedNode = document.createElement("span");
    sourcedNode.className = "summary-sourced";
    sourcedNode.textContent = sourced + " sourced";
    el.provenanceSummary.appendChild(sourcedNode);
    el.provenanceSummary.appendChild(document.createTextNode(" · "));
    var unverifiedNode = document.createElement("span");
    if (unverified > 0) unverifiedNode.className = "summary-unverified";
    unverifiedNode.textContent = unverified + " unverified";
    el.provenanceSummary.appendChild(unverifiedNode);

    el.rendererNote.textContent = COPY.renderers[body.renderer] || "";
  }

  /* ── the copy action ─────────────────────────────────────────────────────────────────── */

  /**
   * Both flavours on the clipboard at once: text/html so a paste into an email client keeps the
   * formatting, text/plain so a paste into an ATS field is not a wall of markup. One action, not
   * a menu — which rendering the plain text carries is agency config (GET /api/agency), read
   * server-side and reported by #renderer-note.
   *
   * Built synchronously from state that is already in memory, so the gesture is never at risk.
   */
  function copyPack() {
    if (!state.clipboard) return;
    var clipboard = navigator.clipboard;

    if (clipboard && window.ClipboardItem) {
      try {
        var item = new window.ClipboardItem({
          "text/html": new Blob([state.clipboard.html], { type: "text/html" }),
          "text/plain": new Blob([state.clipboard.text], { type: "text/plain" })
        });
        clipboard.write([item]).then(
          function () { showState(el.packState, COPY.packCopied, false); },
          function () { copyPackPlain(); }
        );
        return;
      } catch (err) {
        // Fall through to plain text.
      }
    }
    copyPackPlain();
  }

  function copyPackPlain() {
    var clipboard = navigator.clipboard;
    if (!clipboard || !clipboard.writeText) {
      showState(el.packState, COPY.packCopyFailed, true);
      return;
    }
    clipboard.writeText(state.clipboard.text).then(
      function () { showState(el.packState, COPY.packCopied, false); },
      function () { showState(el.packState, COPY.packCopyFailed, true); }
    );
  }

  /* ── upload ──────────────────────────────────────────────────────────────────────────── */

  /**
   * PDF, Word and plain text, via extract.js. A CV is a .pdf or a .docx essentially always, so
   * refusing them put the friction PRD §6 AC3 warns about on the first step of the flow.
   *
   * Nothing here is best-effort: extract.js rejects rather than returning text it could not
   * read cleanly, because a garbled CV would fail every literal-quote check in the verifier and
   * demote a whole pack to unverified — a silent wrong answer, which is the one outcome this
   * product cannot ship.
   */
  function readFileInto(input, textarea, stateNode) {
    var file = input.files && input.files[0];
    if (!file) return;

    input.value = "";
    readFile(file, textarea, stateNode);
  }

  function readFile(file, textarea, stateNode) {
    showState(stateNode, COPY.fileReading, false);

    window.DossierExtract.extractText(file).then(
      function (result) {
        if (result.text.length > INPUT_MAX) {
          showState(stateNode, COPY.tooLong, true);
          return;
        }
        textarea.value = result.text;
        clearState(stateNode);
      },
      function (err) {
        var code = err && err.reason;
        showState(
          stateNode,
          code === "unsupported" ? COPY.fileNotText :
          code === "unreadable" ? COPY.fileUnreadable : COPY.fileFailed,
          true
        );
      }
    );
  }

  /**
   * A dropped file goes through the same extractor as the picker. The drag is only claimed
   * when it carries files and the inputs are live: a text selection dragged into a textarea
   * keeps the browser's own behaviour, and a drop during the wait cannot thaw the frozen
   * inputs. Everywhere else on the page a stray drop keeps its native meaning too — claiming
   * it at window level would swallow the recruiter's own habits.
   */
  function wireDrop(column, textarea, stateNode) {
    var live = function (event) {
      var types = event.dataTransfer ? event.dataTransfer.types : null;
      var hasFiles = types && Array.prototype.indexOf.call(types, "Files") !== -1;
      return Boolean(hasFiles) && state.phase === "inputs" && !textarea.readOnly;
    };

    column.addEventListener("dragover", function (event) {
      if (!live(event)) return;
      event.preventDefault();
      column.classList.add("is-dragover");
    });
    column.addEventListener("dragleave", function () {
      column.classList.remove("is-dragover");
    });
    column.addEventListener("drop", function (event) {
      column.classList.remove("is-dragover");
      if (!live(event)) return;
      var file = event.dataTransfer.files && event.dataTransfer.files[0];
      if (!file) return;
      event.preventDefault();
      readFile(file, textarea, stateNode);
    });
  }

  /* ── wiring ──────────────────────────────────────────────────────────────────────────── */

  el.copyPrompt.addEventListener("click", copyPrompt);
  el.readPack.addEventListener("click", readPack);
  el.copyPack.addEventListener("click", copyPack);
  el.startAgain.addEventListener("click", resetToInputs);
  el.startAgain2.addEventListener("click", resetToInputs);

  el.briefFile.addEventListener("change", function () {
    readFileInto(el.briefFile, el.brief, el.inputsState);
  });
  el.cvFile.addEventListener("change", function () {
    readFileInto(el.cvFile, el.cv, el.inputsState);
  });

  wireDrop(el.brief.closest(".input-col"), el.brief, el.inputsState);
  wireDrop(el.cv.closest(".input-col"), el.cv, el.inputsState);

  // One paste finishes the loop. During the wait, a paste anywhere on this page is the reply
  // coming back, so it lands in the reply box wherever the caret happens to be — and when it
  // carries a pack, the check runs without another click. "role_title" is a required pack
  // field (src/pack.js), so any real reply contains it quoted; the server stays the only
  // judge of what a pack is, this just presses the button. A paste that is not a pack fills
  // the box and waits, which is exactly what the button path did. readPack() carries the
  // busy, frozen-input and one-event-per-pack guards, so this adds no second verify path.
  document.addEventListener("paste", function (event) {
    if (state.phase !== "waiting") return;
    var data = event.clipboardData;
    var text = data ? data.getData("text/plain") : "";
    if (!text || !text.trim()) return;
    event.preventDefault();
    el.reply.value = text;
    if (text.indexOf('"role_title"') !== -1) readPack();
  });

  window.addEventListener("popstate", function () {
    var next = new URL(window.location.href).searchParams.get("client");
    if (next === state.selected) return;
    // beforeunload does not fire for same-document history navigation, so Back is the one way
    // out of a part-built pack that nothing else catches.
    if (state.phase !== "inputs" && !window.confirm(COPY.leavingClient(state.clientName))) {
      var url = new URL(window.location.href);
      if (state.selected) url.searchParams.set("client", state.selected);
      else url.searchParams.delete("client");
      window.history.pushState({ client: state.selected }, "", url);
      return;
    }
    load(next, "");
  });

  // Nothing is kept in the browser, so leaving with pasted text loses it. CHECKLIST mandates
  // this for pasted input, and a CV pasted out of a PDF is the most expensive thing on screen.
  window.addEventListener("beforeunload", function (event) {
    var hasText = el.brief.value.trim() || el.cv.value.trim() || el.reply.value.trim();
    if (!hasText && state.phase === "inputs") return;
    event.preventDefault();
    event.returnValue = "";
  });

  setPhase("inputs");
  load(new URL(window.location.href).searchParams.get("client"), "");
})();
