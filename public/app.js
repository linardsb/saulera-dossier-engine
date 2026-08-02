/* The one screen (#8, and the 28 Jul 2026 model-access supersession).
 *
 * Vanilla, no framework, no build step — the same idiom as clients.js, which this file mirrors
 * closely enough that the two are one system rather than two.
 *
 * Three acts and two routes through them. Primary: add the inputs, generate the pack here
 * (POST /api/generate — this deployment calls the model), read the verified pack and copy it.
 * Fallback: copy the prompt, run it in the recruiter's own Claude session, paste the reply
 * back. Act 2 is one section in two modes — an honest clock over our own request, or a
 * designed wait for work happening in another application. Both routes end at the same
 * verify-shaped body, so act 3 cannot tell them apart.
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
    generateIdle: "Generate the pack",
    generating: "Writing the pack…",
    waitHeadGenerating: "Writing the pack",
    waitHeadManual: "In Claude",
    // Model-side failures name the other route, because the other route is the remedy that
    // always exists: it needs no key and it is one button to the left.
    noModelKey: "This deployment has no model key yet, so it cannot write the pack here. " +
                "Copy the prompt and run it in your own Claude instead, and ask whoever set " +
                "this up to add the key.",
    modelRefused: "The model declined to write this pack. Try again, or copy the prompt and " +
                  "run it in your own Claude.",
    truncated: "The pack came back cut off. Try again, or copy the prompt and run it in " +
               "your own Claude.",
    generateFailed: "Could not write the pack. Your text is still here. Try again, or copy " +
                    "the prompt and run it in your own Claude.",

    copyIdle: "Or copy the prompt and open Claude",
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
    // risk is sending one client's pack under another client's name. Route-neutral wording:
    // on the generate route there is no reply to speak of.
    //
    // `prepared` widens it to cover act 4. Both confirm paths (select and popstate) already
    // fire whenever the phase is not "inputs", and phase "pack" is where act 4 lives — so the
    // dialogue was already appearing and simply describing the wrong thing.
    leavingClient: function (name, prepared) {
      var what = prepared ? "a pack and a candidate's prepared interview prep" : "a pack";
      return (name ? "You are part way through " + what + " for " + name + ". "
                   : "You are part way through " + what + ". ") +
        "Switching client abandons it.";
    },

    marks: {
      cv: "CV",
      client_note: "Our note",
      // Act 4's own word. A prep competency's `verified` flag is computed against the cleaned
      // BRIEF — the schema tells the model to quote the brief and never the CV — so labelling it
      // "Our note" said the wrong thing about every row. The enum above is act 3's, where a pack
      // claim really can come from either source; there is no right value in it for this.
      brief: "Brief",
      unverified: "Unverified",
      failed: "Quote not found"
    },

    sections: {
      evidence: "Against the brief",
      process_fit: "What we know about your process",
      gaps: "Where they do not meet the brief"
    },

    // The label on every claim's evidence expander. Fixed, never toggled: the disclosure marker
    // the browser draws carries the open/closed state, so the label never has to be kept in sync
    // with it — which is the whole reason this is a <details> and not a button wired to
    // aria-expanded. Recruiter words, so not "source" and not "provenance".
    evidenceToggle: "Where this came from",

    questionsHead: "Before you send this",
    renderers: {
      appendix: "Sources go in an appendix.",
      inline: "Sources sit beside each claim."
    },

    /* ── act 4 ─────────────────────────────────────────────────────────────────────────
       Plain first-time-recruiter language throughout. No "token", no "invite", no
       "payload": the recruiter is sending a person a web page, and every word here says
       so. */
    sendIdle: "Send to candidate",
    sendIt: "Send it",
    sendPreparing: "Getting the preparation ready…",
    sendNeedDate: "Add the interview date and the candidate's email address first.",
    sendDatePast: "That date has already gone. Use the date of the interview itself.",
    // Names the year, because a date this far out is a typo in the year essentially always,
    // and "out of range" would send the recruiter looking at the day.
    sendDateTooFar: "That date is more than two years away. Check the year.",
    sendSending: "Sending…",
    sendPreviewLede: "This is what the candidate will get. Untick anything you would rather " +
                     "not send, then send it.",
    // Already unticked when this shows, and deliberately NOT an invitation to tick it back
    // on: the server refuses any send that includes an unsourced line, so offering that would
    // be a control that cannot be confirmed. It says what happened and stops.
    sendPreviewUnverified: "Anything ticked below was found in the brief. One or more lines " +
                           "could not be, so they are not being sent.",
    sendAllUnverified: "None of these could be found in the brief, so there is nothing to " +
                       "send. Generate the pack again, or check the brief you pasted.",
    // The empty preview used to lock "Send it" and say NOTHING at all — a disabled button over
    // a blank list, which reads as the screen having broken rather than as an outcome. The
    // remedy is the same as sendAllUnverified's; the cause is not, so the sentence is not.
    sendNothingExtracted: "Nothing was pulled out of the brief, so there is nothing to send. " +
                          "Check the brief you pasted, or generate the pack again.",
    // Said rather than done silently: "Not yet" cannot take effect while the send it would
    // cancel is already on the wire, and a button that does visibly nothing reads as broken.
    sendBusyWait: "The send is already going. Wait for it to finish.",
    sendFieldsNone: "Nothing from your client note will be shared. You have not ticked any " +
                    "sections as shareable.",
    sendFieldsSome: "These sections of your note travel with it, because you ticked them as " +
                    "shareable:",
    sendNothingTicked: "Everything is unticked, so there is nothing left to send.",
    sendDone: function (email) {
      return "Sent to " + email + ". They will get an email with a link to their own " +
        "preparation page. To send another, press Start again.";
    },
    // A dedicated message rather than the success sentence in error styling, which is act 3's
    // precedent (packReady vs eventFailed). The send WORKED and the count did not move, and
    // that count is the number the process claim on the Prep sent screen rests on — so it is
    // worth its own sentence rather than a red tint the recruiter has to interpret.
    sendDoneUncounted: function (email) {
      return "Sent to " + email + ". They will get an email with a link to their own " +
        "preparation page. The Prep sent counter did not record this one.";
    },
    // #34: the server refused a duplicate because the FIRST try landed — the retry after a
    // timeout. Success wording, because from the recruiter's side it is: the candidate has
    // their email, and nothing was sent or counted twice.
    sendAlreadyDone: function (email) {
      return "Already sent to " + email + " — your earlier try went through. They have " +
        "their email with the link. To send another, press Start again.";
    },

    // Failures. Each one names what happened AND what is still true, because the expensive
    // thing on this screen is the prepared brief and a recruiter who thinks it is gone will
    // press the two-minute button again.
    sendFailed: "Could not send that. Nothing was sent and nothing was saved. Try again.",
    sendMailFailed: "The email was not accepted, so nothing was sent and nothing was saved. " +
                    "Try again. You do not need to prepare it a second time.",
    sendNoMail: "This deployment cannot send email yet. Ask whoever set it up to add the " +
                "email key, then try again.",
    // Refused before anything is minted or written, so "nothing was sent" is a fact, not a
    // hope — and without this string a misconfigured deployment read as a transient failure.
    sendNoBaseUrl: "This deployment does not know the web address candidate pages live at, " +
                   "so the link cannot be built. Nothing was sent. Ask whoever set it up to " +
                   "add the page address, then try again.",
    sendNotSendable: function (labels) {
      return "These lines could not be found in the brief, so they cannot be sent: " +
        labels + ". Untick them, or generate the pack again.";
    },
    sendNothingToSend: "You have unticked everything, so there is nothing to send.",
    // Points at the two fields on THIS screen. The reachable causes are all one of them: an
    // address the server would not accept, or a date it could not read.
    sendCheckFields: "The email address or the interview date was not accepted. Check them both " +
                     "and try again.",
    sendBadBrief: "The prepared brief was not accepted. Press Not yet, then prepare it again.",
    sendPrepareFailed: "Could not get the preparation ready. Nothing was sent. Try again.",
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
    generate: document.getElementById("generate"),
    copyPrompt: document.getElementById("copy-prompt"),
    inputsState: document.getElementById("inputs-state"),
    fallback: document.getElementById("prompt-fallback"),
    promptText: document.getElementById("prompt-text"),

    actWaiting: document.getElementById("act-waiting"),
    waitingWord: document.getElementById("waiting-word"),
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
    startAgain2: document.getElementById("start-again-2"),

    actSend: document.getElementById("act-send"),
    interviewDate: document.getElementById("interview-date"),
    candidateEmail: document.getElementById("candidate-email"),
    prepareSend: document.getElementById("prepare-send"),
    sendState: document.getElementById("send-state"),
    sendElapsed: document.getElementById("send-elapsed"),
    sendPreview: document.getElementById("send-preview"),
    sendPreviewLede: document.getElementById("send-preview-lede"),
    strikeList: document.getElementById("strike-list"),
    sendFieldsNote: document.getElementById("send-fields-note"),
    sendFieldsList: document.getElementById("send-fields-list"),
    sendNoteLink: document.getElementById("send-note-link"),
    confirmSend: document.getElementById("confirm-send"),
    cancelSend: document.getElementById("cancel-send")
  };

  var state = {
    selected: null,
    clientName: "",
    phase: "inputs",
    // Which route the pack in progress is taking: "api" (this deployment calls the model) or
    // "claude" (the recruiter's own session). Decides act 2's mode and nothing else — every
    // guard keys off phase, so the two routes cannot drift apart in behaviour.
    route: null,
    sent: null,
    startedAt: null,
    tick: null,
    clipboard: null,
    reqId: 0,
    busy: false,

    // ── act 4 ──────────────────────────────────────────────────────────────────────────
    // The prepared payload lives HERE and nowhere else — not in browser storage, not in a
    // hidden input, not in a data attribute, not in the URL. It is the most expensive object
    // on this screen (two minutes and real model spend) and it is deliberately not durable,
    // because it contains the candidate's CV-derived brief. Behaviour 1 at the top of this
    // file is the rule; this is the object it costs the most to obey it for.
    sendPrepared: null,
    sendStruck: null,
    // #34: the idempotency key for the prepared payload above; minted in renderPreview,
    // posted by confirmSend, lives and dies with sendPrepared.
    sendKey: null,
    // R7's terminal flag. Set in the SUCCESS handler and NOWHERE ELSE — see confirmSend.
    sendDone: false,
    sendStartedAt: null,
    sendTick: null
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
    // Act 2's mode. In phase "pack" the section stays on screen (see below), so the mode has
    // to hold there too: after a generated pack it shows the final clock reading rather than
    // an empty reply box that was never part of that route.
    var generating = state.route === "api" && (next === "generating" || next === "pack");
    el.actWaiting.classList.toggle("is-generating", generating);
    el.waitingWord.textContent = generating ? COPY.waitHeadGenerating : COPY.waitHeadManual;
    showAct(el.actInputs, true); // act 1 stays readable while checking the pack, see below
    showAct(el.actWaiting, next === "generating" || next === "waiting" || next === "pack");
    showAct(el.actPack, next === "pack");
    // Act 4 appears exactly when a pack does and goes on Start again — architecture §1 puts
    // the Send after a pack exists, and it reuses the frozen state.sent that pack was built
    // from. The gate is re-evaluated because leaving and re-entering phase "pack" must not
    // leave a live-looking button over a cleared date field.
    showAct(el.actSend, next === "pack");
    updateSendGate();
    if (next === "waiting" || next === "generating") startClock();
    // Say so rather than only refusing. Act 2 stays on screen in phase "pack" so the recruiter
    // can still see what they pasted, which leaves a live-looking button that no longer does
    // anything — aria-disabled is how the rest of this screen says "not right now".
    setBusy(el.readPack, next === "pack");
    // The arriving act comes to the reader. Act 3 otherwise renders two viewports down and
    // "nothing happened" is what a recruiter sees. Never on "inputs": that is the load and
    // reset path, where jumping the page is the bug. Smooth only when motion is welcome.
    if (next === "waiting" || next === "generating" || next === "pack") {
      var arrived = next === "pack" ? el.actPack : el.actWaiting;
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
    // FIRST, and it is not bookkeeping. Every other path that changes what the screen is about
    // bumps this — each load, each request — and `mine()` is what stops a response landing on a
    // screen that has moved on. Neither Start again button is guarded by state.busy and both are
    // on screen throughout act 4, so without this line a send still in flight comes back after
    // the reset and sets the terminal sendDone state on the NEXT candidate: a locked CTA, frozen
    // fields, and "Sent to <the previous address>" over a pack that was never sent.
    state.reqId += 1;
    state.route = null;
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

    // Act 4, cleared through the same single reset path. This is the ONLY way out of the
    // terminal sendDone state, deliberately: after a successful send the two fields are
    // frozen and both buttons are locked, so sending a second candidate is a decision the
    // recruiter makes by starting again rather than by pressing a button twice.
    stopSendClock();
    state.sendPrepared = null;
    state.sendStruck = null;
    state.sendKey = null;
    state.sendDone = false;
    state.sendStartedAt = null;
    el.interviewDate.value = "";
    el.candidateEmail.value = "";
    el.interviewDate.readOnly = false;
    el.candidateEmail.readOnly = false;
    el.sendPreview.hidden = true;
    el.strikeList.textContent = "";
    el.sendFieldsList.textContent = "";
    el.sendElapsed.textContent = "";
    clearState(el.sendState);
    updateSendGate();
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
    if (state.phase !== "inputs" && !window.confirm(COPY.leavingClient(state.clientName, Boolean(state.sendPrepared)))) return;

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
    state.route = "claude";
    state.sent = { brief: brief, cv: cv };
    el.brief.readOnly = true;
    el.cv.readOnly = true;
    setPhase("waiting");
    el.reply.focus();
  }

  /* ── act 1 straight to act 3: the generate route ─────────────────────────────────────── */

  /**
   * The message for a generate failure. Not messageFor(): two of the shared codes read wrong
   * on this route. A 502 no_pack here means the MODEL's output was not a pack — "copy the
   * whole of Claude's reply" would describe a paste that never happened — and every model-side
   * failure should name the fallback route, because the fallback is the remedy that always
   * exists.
   */
  function generateMessageFor(err) {
    if (err) {
      if (err.code === "no_model_key") return COPY.noModelKey;
      if (err.code === "model_refused") return COPY.modelRefused;
      if (err.code === "truncated") return COPY.truncated;
      if (err.code === "no_pack" || err.code === "bad_pack") return COPY.generateFailed;
    }
    return messageFor(err, COPY.generateFailed);
  }

  /**
   * One click, one pack. POST /api/generate runs the model from this deployment, verifies
   * every quote and renders — the response is shaped exactly like /api/verify's, so act 3
   * cannot tell which route produced the pack.
   *
   * The inputs freeze for the same reason they do on the other route: the pack's quotes were
   * checked against this exact text, and act 1 stays on screen for reading against the marks.
   * On failure the screen returns to act 1 with the text kept and thawed — a failed generation
   * must never cost the recruiter their paste (CHECKLIST: "a failed generation says what
   * failed and keeps the pasted inputs on screen").
   */
  function generate() {
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

    var clientId = state.selected;
    var brief = el.brief.value;
    var cv = el.cv.value;
    state.reqId += 1;
    var reqId = state.reqId;
    var mine = function () { return state.reqId === reqId && state.selected === clientId; };

    state.busy = true;
    setBusy(el.generate, true);
    el.generate.textContent = COPY.generating;
    el.fallback.hidden = true;
    clearState(el.inputsState);

    state.route = "api";
    state.sent = { brief: brief, cv: cv };
    el.brief.readOnly = true;
    el.cv.readOnly = true;
    setPhase("generating");

    postJson("/api/generate", { client_id: clientId, brief: brief, cv: cv })
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
        el.copyPack.focus({ preventScroll: true });
      })
      .catch(function (err) {
        if (!mine()) return;
        // Back to act 1, inputs thawed and kept. The wait ends here, honestly, rather than
        // leaving a stopped clock over a request that already answered.
        state.route = null;
        state.sent = null;
        el.brief.readOnly = false;
        el.cv.readOnly = false;
        setPhase("inputs");
        var link = err && err.code === "note_empty" && state.selected
          ? { href: "/clients?client=" + encodeURIComponent(state.selected),
              text: COPY.noteEmptyLink }
          : null;
        showState(el.inputsState, generateMessageFor(err), true, link);
      })
      .then(function () {
        state.busy = false;
        setBusy(el.generate, false);
        el.generate.textContent = COPY.generateIdle;
      });
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
    // The quote sits behind a native disclosure rather than under the claim: the CHIP is the
    // provenance and it is always on screen, the quote is the evidence behind it and evidence is
    // the thing you go and look at. <details> because the platform already ships the keyboard and
    // screen-reader behaviour correctly, with no state of ours to keep in sync.
    //
    // Never expanded by default, and note which claims reach here at all: a failed check has no
    // .claim-source to hide, so it builds no expander and its failure line below stays as visible
    // as it is today. The disclosure only ever hides a quote that PASSED.
    var quote = claim.failed_quote ? "" : displayQuote(claim.source_quote);
    if (quote) {
      var evidence = document.createElement("details");
      evidence.className = "claim-evidence";

      var toggle = document.createElement("summary");
      toggle.className = "claim-evidence-toggle";
      toggle.textContent = COPY.evidenceToggle;
      evidence.appendChild(toggle);

      var source = document.createElement("p");
      source.className = "claim-source";
      source.textContent = "“" + quote + "”";
      evidence.appendChild(source);

      block.appendChild(evidence);
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
      // The one block of the pack that is neither sourced nor unsourced — it is the recruiter's
      // own list of things to confirm — so it gets the info tint rather than a provenance one.
      questions.className = "pack-section pack-questions-panel";

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

    // The headline number, worn in the marks' own colours and now on the marks' own grounds —
    // word plus colour plus ground, never colour alone, same rule as the marks. Built element by
    // element: model-adjacent numbers still go nowhere near an HTML-parsing assignment.
    //
    // The middle dot between the two counts is gone: the gap and the two grounds separate them
    // now, and a separator between two chips reads as punctuation inside one of them.
    var sourced = body.provenance.cv + body.provenance.client_note;
    var unverified = body.provenance.unverified;
    el.provenanceSummary.textContent = "";
    var sourcedNode = document.createElement("span");
    sourcedNode.className = "summary-sourced";
    sourcedNode.textContent = sourced + " sourced";
    el.provenanceSummary.appendChild(sourcedNode);
    var unverifiedNode = document.createElement("span");
    // A pack with nothing unverified must not wear a warning chip saying so. It keeps the chip's
    // box and loses the ground, so the two counts still sit on one baseline.
    unverifiedNode.className = unverified > 0 ? "summary-unverified" : "summary-unverified-none";
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

  /* ── act 4: send to candidate ────────────────────────────────────────────────────────
   *
   * Two steps, because decision 15 requires the recruiter to SEE the extracted competencies
   * before anything is sent, and those competencies do not exist until the model call has
   * run. Prepare → preview → confirm is the only ordering that satisfies that without
   * persisting a draft of somebody's CV for a send that may never happen.
   *
   * The prepared payload round-trips through state.sendPrepared, in memory. The server
   * re-runs the entire contract on what comes back — shape, strike, shape again, then a
   * literal re-verification against field keys it reads from the database — so the browser
   * is trusted for convenience and for nothing else.
   */

  /** Today, as `<input type="date">` writes it. Local, because the recruiter picked it that
   *  way; the server normalises to UTC and is the authority on what "past" means. */
  function todayLocal() {
    var now = new Date();
    return now.getFullYear() + "-" +
      String(now.getMonth() + 1).padStart(2, "0") + "-" +
      String(now.getDate()).padStart(2, "0");
  }

  /**
   * The far end of the date field, two years out — src/prep/dates.js's MAX_MONTHS_AHEAD, stated
   * once more here because this file has no import of it and duplicating the number is cheaper
   * than a build step. It is a RETENTION bound rather than a diary one: the interview date is
   * the clock the 30-day purge runs on, so a mistyped year keeps a candidate's CV alive for
   * centuries and nothing anywhere says so.
   *
   * The server is the enforcement; both routes refuse `interview_too_far` before the model call.
   * This is the courtesy, in the idiom of updateSendGate's own note about the past end.
   *
   * Computed in UTC with `setUTCMonth`, the exact arithmetic isWithinHorizon uses, so the
   * picker's far end IS the server's far end. Local `getFullYear() + 2` disagreed with it by a
   * day for any recruiter east of UTC — the picker offered a date the server then refused —
   * and, computed on Feb 29, produced an invalid max the browser silently ignored.
   */
  function maxUtc() {
    var horizon = new Date();
    horizon.setUTCMonth(horizon.getUTCMonth() + 24);
    return horizon.toISOString().slice(0, 10);
  }

  /**
   * AC #1's BROWSER HALF. The CTA is locked until an interview date exists (decision 9) and
   * an email address has been typed.
   *
   * A courtesy, not the enforcement: /api/prep/prepare refuses a missing or past date with a
   * 400 before any model call. This exists so the recruiter is not told off after a wait.
   */
  function updateSendGate() {
    var date = el.interviewDate.value;
    var ready = Boolean(date) && date >= todayLocal() && date <= maxUtc() &&
      el.candidateEmail.value.trim().indexOf("@") > 0;
    // Locked over an open preview too — see prepareSend. aria-disabled is how the rest of this
    // screen says "not right now", and a live-looking button that re-spends ~30p is worse than
    // one that says so.
    setBusy(el.prepareSend, state.sendDone || Boolean(state.sendPrepared) || !ready);
  }

  /**
   * Act 4's own clock, and its own interval.
   *
   * setPhase is documented as "the only place the clock is stopped" (behaviour 6 at the top of
   * this file), and that remains true of the PACK clock. This is a different wait with a
   * different lifetime: it starts inside phase "pack", it can run and finish several times
   * without the phase changing, and Start again must stop it. Sharing state.tick would make
   * two live intervals double the tick rate and let a stale one keep the pack's elapsed
   * arithmetic alive. Separate interval, separate pair of functions, and this comment — or a
   * reviewer reads it as exactly the bug setPhase exists to prevent.
   */
  function startSendClock() {
    stopSendClock();
    state.sendStartedAt = Date.now();
    renderSendElapsed();
    state.sendTick = window.setInterval(renderSendElapsed, 1000);
  }

  function stopSendClock() {
    if (state.sendTick !== null) {
      window.clearInterval(state.sendTick);
      state.sendTick = null;
    }
  }

  function renderSendElapsed() {
    if (state.sendStartedAt === null) {
      el.sendElapsed.textContent = "";
      return;
    }
    var seconds = Math.floor((Date.now() - state.sendStartedAt) / 1000);
    el.sendElapsed.textContent =
      String(Math.floor(seconds / 60)).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0");
  }

  /** The message for a send failure. Act 3's generateMessageFor is the pattern: the codes that
   *  need their own words get them, and everything else falls through to a named default. */
  function sendMessageFor(err, fallback) {
    if (err) {
      if (err.code === "no_model_key") return COPY.noModelKey;
      if (err.code === "interview_past") return COPY.sendDatePast;
      if (err.code === "interview_too_far") return COPY.sendDateTooFar;
      if (err.code === "nothing_to_send") return COPY.sendNothingToSend;
      if (err.code === "mail_failed") return COPY.sendMailFailed;
      // NAMED HERE rather than left to messageFor, whose `missing_fields` copy is act 1's —
      // "Paste the brief and the CV before you copy the prompt." — and would be shown on a
      // screen where both are frozen, filled and visible two acts above. That is the exact
      // hazard messageFor's own doc-comment names: a message describing the wrong act is worse
      // than a generic one. An address that clears the browser's `indexOf("@") > 0` and fails
      // the server's `cleanEmail` is the ordinary way to get here.
      if (err.code === "missing_fields") return COPY.sendCheckFields;
      if (err.code === "bad_brief") return COPY.sendBadBrief;
      // `not_configured` from the mail path and from a missing DB binding share a code. The
      // mail one is the only one reachable at confirm on a working deployment, and naming the
      // email key is the remedy that gets it fixed.
      if (err.code === "not_configured") return COPY.sendNoMail;
      // The other one-setting refusal, same remedy shape as sendNoMail. DEPLOY.md's triage
      // row covers the operator; this sentence covers the recruiter reading the screen.
      if (err.code === "no_base_url") return COPY.sendNoBaseUrl;
      if (err.code === "not_sendable") {
        var labels = (err.failures || [])
          .filter(function (f) { return f.kind === "competency"; })
          .map(function (f) { return f.label; })
          .join(", ");
        return labels ? COPY.sendNotSendable(labels) : COPY.sendFailed;
      }
    }
    return messageFor(err, fallback || COPY.sendFailed);
  }

  /**
   * Step one: run the model and show the recruiter what is about to leave the building.
   *
   * Persists nothing and sends nothing. The brief and the CV posted are the FROZEN ones from
   * state.sent, never the live textareas — the competency quotes are checked against exactly
   * this text server-side, and posting an edited brief would demote claims for no reason.
   */
  function prepareSend() {
    // `state.sendPrepared` is the third guard, and it is about MONEY as much as state: this
    // button stayed live over an open preview, so a second press silently ran the ~30p model
    // call again and replaced the preview the recruiter was reading with a new one. "Not yet"
    // is the way back — it drops the preview, which unlocks this.
    if (state.busy || state.sendDone || state.sendPrepared) return;

    var date = el.interviewDate.value;
    var email = el.candidateEmail.value.trim();
    if (!date || date < todayLocal() || date > maxUtc() || email.indexOf("@") <= 0) {
      showState(
        el.sendState,
        date && date < todayLocal()
          ? COPY.sendDatePast
          : date && date > maxUtc()
            ? COPY.sendDateTooFar
            : COPY.sendNeedDate,
        true,
      );
      return;
    }
    if (!state.sent) return;

    var clientId = state.selected;
    state.reqId += 1;
    var reqId = state.reqId;
    var mine = function () { return state.reqId === reqId && state.selected === clientId; };

    state.busy = true;
    // Frozen for the duration, for the reason interviewDateChanged gives: the date is an INPUT
    // to the call now going out, so an edit made while it is in flight would be accepted on
    // screen and then overwritten by a preview prepared against the old day.
    el.interviewDate.readOnly = true;
    setBusy(el.prepareSend, true);
    el.prepareSend.textContent = COPY.sendPreparing;
    el.sendPreview.hidden = true;
    clearState(el.sendState);
    startSendClock();

    postJson("/api/prep/prepare", {
      client_id: clientId,
      brief: state.sent.brief,
      cv: state.sent.cv,
      interview_at: date
    })
      .then(function (body) {
        if (!mine()) return;
        renderPreview(body);
      })
      .catch(function (err) {
        if (!mine()) return;
        // A failed RE-prepare hid the preview at the top of this function, so leaving the
        // previous payload in memory would leave beforeunload warning about something the
        // recruiter can no longer see or send. Dropped, exactly as cancelSend does.
        state.sendPrepared = null;
        state.sendStruck = null;
        showState(el.sendState, sendMessageFor(err, COPY.sendPrepareFailed), true);
      })
      .then(function () {
        stopSendClock();
        state.busy = false;
        el.interviewDate.readOnly = false;
        el.prepareSend.textContent = COPY.sendIdle;
        updateSendGate();
      });
  }

  /**
   * The preview: one row per competency, and the note sections that travel with it.
   *
   * Every node is built with createElement and textContent — no HTML-parsing assignment
   * anywhere, for the reason at the top of this file and in registry.js, and the Level 1 grep
   * gate enforces it.
   */
  function renderPreview(body) {
    // The whole prepare response, held as it arrived — including `interview_at`, which the
    // SERVER normalised and which confirm posts back verbatim, so the two steps cannot
    // disagree about which day this is in which zone.
    state.sendPrepared = body;
    state.sendStruck = Object.create(null);
    // #34: one idempotency key per PREPARED payload, minted here so a retry of this same
    // payload carries the same key (the server answers 409 already_sent if the earlier try
    // actually landed) while a fresh prepare — a deliberate re-send — mints a fresh one.
    state.sendKey = crypto.randomUUID();

    var competencies = (body.payload && body.payload.competencies) || [];
    var unverified = competencies.filter(function (c) { return c.verified !== true; });

    el.strikeList.textContent = "";
    competencies.forEach(function (competency, index) {
      var verified = competency.verified === true;

      var row = document.createElement("li");
      // The third of the three signals act 3 uses, and act 4 was missing it: the WORD, the
      // colour, and on an unverified row a left border on the whole claim. A recruiter who
      // cannot distinguish the colours reads the word; one scanning the list sees the border.
      row.className = verified ? "claim strike-row" : "claim strike-row claim-unverified";

      var label = document.createElement("label");
      label.className = "strike-label";

      var box = document.createElement("input");
      box.type = "checkbox";
      box.className = "strike-box";
      box.dataset.id = competency.id;
      // AN UNVERIFIED COMPETENCY ARRIVES UNTICKED, and this is mechanical rather than
      // cosmetic: the server refuses any send that includes one, so "ticked" would be a
      // default that cannot be confirmed — a dead end with an error message where a control
      // should be.
      box.checked = verified;
      if (!box.checked) state.sendStruck[competency.id] = true;
      box.addEventListener("change", function () {
        if (box.checked) delete state.sendStruck[box.dataset.id];
        else state.sendStruck[box.dataset.id] = true;
        // Announces: ticking the last box back on must take the warning away with it.
        updateConfirmGate(true);
      });

      var text = document.createElement("span");
      text.className = "claim-text";
      text.textContent = competency.label;

      label.appendChild(box);
      label.appendChild(text);

      var mark = document.createElement("span");
      // The verified branch used to set a bare "mark" with no colour modifier, so it inherited
      // --text-primary while every other provenance mark on the screen carried its own colour.
      mark.className = verified ? "mark mark-brief" : "mark mark-unverified";
      mark.textContent = verified ? COPY.marks.brief : COPY.marks.unverified;
      // The mark sits OUTSIDE the label, because .claim-head lays the two out side by side and
      // moving it inside would change the row's grammar. So it is wired to the checkbox instead:
      // without this a screen-reader user hears the competency and the tick state and never the
      // reason the box arrived unticked, which is the one thing that row is telling them.
      mark.id = "strike-mark-" + index;
      box.setAttribute("aria-describedby", mark.id);

      var head = document.createElement("div");
      head.className = "claim-head";
      head.appendChild(label);
      head.appendChild(mark);
      row.appendChild(head);

      if (competency.source_quote) {
        var quote = document.createElement("p");
        quote.className = "claim-source";
        quote.textContent = "“" + displayQuote(competency.source_quote) + "”";
        row.appendChild(quote);
      }

      el.strikeList.appendChild(row);
    });

    // The lede says which situation this is, so an all-unverified brief explains itself
    // rather than offering a send the server would refuse. An EMPTY list is its own situation,
    // and used to be the only one with no sentence at all — a locked button over a blank list,
    // which reads as the screen having broken rather than as an outcome with a remedy.
    var allUnverified = competencies.length > 0 && unverified.length === competencies.length;
    el.sendPreviewLede.textContent =
      competencies.length === 0
        ? COPY.sendNothingExtracted
        : allUnverified
          ? COPY.sendAllUnverified
          : unverified.length
            ? COPY.sendPreviewUnverified
            : COPY.sendPreviewLede;

    // The note sections: HEADINGS AND COUNTS, never the section text. The recruiter read
    // those sections on /clients with the note in front of them, and a second copy of
    // business-context personal data on a second screen widens where it appears for one
    // click of convenience. The link goes to the note instead.
    var fields = body.visible_fields || [];
    el.sendFieldsNote.textContent = fields.length ? COPY.sendFieldsSome : COPY.sendFieldsNone;
    el.sendFieldsList.textContent = "";
    fields.forEach(function (field) {
      var item = document.createElement("li");
      item.className = "send-field-row";
      var heading = document.createElement("span");
      // The same two classes the /clients list uses for the same two facts, so a recruiter
      // reading both screens is reading one system rather than two lists that look alike.
      heading.className = "visibility-name";
      heading.textContent = field.heading;
      var meta = document.createElement("span");
      meta.className = "visibility-meta";
      meta.textContent = field.chars.toLocaleString("en-GB") +
        (field.chars === 1 ? " character" : " characters");
      item.appendChild(heading);
      item.appendChild(meta);
      el.sendFieldsList.appendChild(item);
    });
    el.sendNoteLink.href = state.selected
      ? "/clients?client=" + encodeURIComponent(state.selected)
      : "/clients";

    el.sendPreview.hidden = false;

    // NOT announcing when the lede already owns the situation. `updateConfirmGate(true)` writes
    // "Everything is unticked, so there is nothing left to send" whenever nothing is ticked —
    // which is true of an all-unverified preview the moment it renders, and blames the recruiter
    // for unticking they did not do, in a second sentence contradicting the first. The lede says
    // what happened; the gate only locks the button.
    updateConfirmGate(!allUnverified && competencies.length > 0);

    // THE ARRIVING PREVIEW COMES TO THE READER, and focus goes to the first thing to READ rather
    // than to the irreversible thing to press. `focus({preventScroll: true})` on "Send it" left
    // a recruiter who had scrolled up holding focus on a button they could not see: one Space
    // and the email is gone, before a single competency has been looked at. So: scroll the
    // preview into view (setPhase's own idiom, motion only where it is welcome) and land focus on
    // the first checkbox — where Space toggles a tick and costs nothing.
    el.sendPreview.scrollIntoView({
      block: "nearest",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
    var first = el.strikeList.querySelector(".strike-box");
    if (first) first.focus({ preventScroll: true });
    else el.cancelSend.focus({ preventScroll: true });
  }

  /**
   * Confirm is locked when every competency has been unticked — the server refuses that
   * outright, so offering it would be the same dead end the unticking rule avoids.
   *
   * `announce` decides whether this OWNS the state line, and it is not a convenience flag.
   * Ticking a box back on has to clear "everything is unticked", or the message outlives the
   * situation it describes and sits there contradicting an unlocked button. But the same
   * clear must NOT run from confirmSend's final .then(), which lands after the catch has
   * written a mail failure — clearing there would wipe the one message telling the recruiter
   * their payload is still on screen and worth retrying. So the checkbox handler announces;
   * the request's tail only re-locks the button.
   */
  function updateConfirmGate(announce) {
    var competencies = (state.sendPrepared &&
      state.sendPrepared.payload &&
      state.sendPrepared.payload.competencies) || [];
    var left = competencies.filter(function (c) { return !state.sendStruck[c.id]; }).length;
    setBusy(el.confirmSend, state.sendDone || left === 0);

    if (!announce) return;
    if (left === 0 && competencies.length) showState(el.sendState, COPY.sendNothingTicked, true);
    else clearState(el.sendState);
  }

  /**
   * Step two: confirm. The payload goes back exactly as it arrived, plus the struck ids.
   *
   * TWO RULES HERE PULL IN OPPOSITE DIRECTIONS AND THE OBVIOUS IMPLEMENTATION GETS IT WRONG.
   *
   * R7 wants a terminal state, because pressing this twice sends a SECOND invite and records
   * a SECOND `invite_sent` — one candidate, two counts, and decision 23's number is the thing
   * the epic sells on. readPack's "one event per pack" guard is this repo's own answer to the
   * identical problem.
   *
   * R9 wants the payload KEPT on failure, because a mail outage must cost a retry rather than
   * another two-minute, ~30p model call.
   *
   * They meet here: this catch cannot tell a `502 mail_failed` from a network timeout, so a
   * sendDone set anywhere in the error path would kill the retry that is the entire point of
   * keeping the payload. So: SUCCESS SETS IT, FAILURE LEAVES IT FALSE and leaves the preview
   * live. This is the single line in act 4 that a tidy-up will break.
   *
   * THE RESIDUAL, CLOSED BY #34: a request that times out in this browser but succeeded on
   * the server leaves sendDone false, so the retry goes out — and the server now recognises
   * it by `send_key` (one per prepared payload, minted in renderPreview) and answers
   * `409 already_sent`, which the catch below treats as the success it is. The guard here
   * stays exactly as it was: it is still what stops the DOUBLE-CLICK, and the server key is
   * what stops the double-SEND.
   */
  function confirmSend() {
    if (state.busy || state.sendDone) return;
    if (!state.sendPrepared || !state.sent) return;

    var competencies = state.sendPrepared.payload.competencies || [];
    var strike = competencies
      .map(function (c) { return c.id; })
      .filter(function (id) { return state.sendStruck[id]; });
    if (strike.length >= competencies.length) {
      showState(el.sendState, COPY.sendNothingTicked, true);
      return;
    }

    var clientId = state.selected;
    var email = el.candidateEmail.value.trim();
    state.reqId += 1;
    var reqId = state.reqId;
    var mine = function () { return state.reqId === reqId && state.selected === clientId; };

    state.busy = true;
    // Same freeze as prepareSend's: the stamp being posted below is the one prepared earlier,
    // so an edit landing between here and the response would never reach the server.
    el.interviewDate.readOnly = true;
    setBusy(el.confirmSend, true);
    // "Not yet" cannot take effect while this is on the wire, so it says so rather than looking
    // live — the same rule setPhase applies to "Check this reply" once act 3 has arrived.
    setBusy(el.cancelSend, true);
    el.confirmSend.textContent = COPY.sendSending;
    clearState(el.sendState);
    startSendClock();

    // The terminal state, reached from the success handler and from 409 already_sent — the
    // two ways this candidate ends up holding exactly one email.
    function settleSent(message, warn) {
      state.sendDone = true;
      state.sendPrepared = null;
      state.sendStruck = null;
      state.sendKey = null;
      el.sendPreview.hidden = true;
      el.interviewDate.readOnly = true;
      el.candidateEmail.readOnly = true;
      setBusy(el.prepareSend, true);
      showState(el.sendState, message, warn);
    }

    postJson("/api/prep/send", {
      client_id: clientId,
      email: email,
      interview_at: state.sendPrepared.interview_at,
      brief: state.sent.brief,
      cv: state.sent.cv,
      payload: state.sendPrepared.payload,
      strike: strike,
      send_key: state.sendKey
    })
      .then(function (body) {
        if (!mine()) return;
        // THE ONE SUCCESS SHAPE, shared with the already_sent branch below — sendDone is set
        // HERE and in that branch and NOWHERE ELSE. See the note above before moving this.
        settleSent(
          body.event_recorded ? COPY.sendDone(email) : COPY.sendDoneUncounted(email),
          !body.event_recorded,
        );
      })
      .catch(function (err) {
        if (!mine()) return;
        // #34: the server refused a duplicate key, which means the try that timed out in
        // THIS browser actually landed. From here that is success — the candidate has their
        // email — so it takes the terminal shape, not the retry shape below.
        if (err && err.code === "already_sent") {
          settleSent(COPY.sendAlreadyDone(email), false);
          return;
        }
        // The payload, the strikes and the preview stay exactly as they are. One line, and
        // it will be deleted by accident if this comment is not here: it is the difference
        // between a DNS problem costing a retry and costing another two-minute model call.
        showState(el.sendState, sendMessageFor(err), true);
      })
      .then(function () {
        stopSendClock();
        state.busy = false;
        // Not on the success path: sendDone freezes both fields deliberately, and thawing the
        // date here would undo the terminal state the success handler just set.
        if (!state.sendDone) el.interviewDate.readOnly = false;
        setBusy(el.cancelSend, state.sendDone);
        el.confirmSend.textContent = COPY.sendIt;
        // NO announce: the catch above may just have written a mail failure, and that
        // message is what tells the recruiter their payload is still here to retry.
        if (!state.sendDone) updateConfirmGate(false);
      });
  }

  /** The clearing half of "Not yet", without the busy guard — so the one caller that must run
   *  whatever the button would have done can reach it. */
  function dropPreparedSend() {
    state.sendPrepared = null;
    state.sendKey = null;
    state.sendStruck = null;
    el.sendPreview.hidden = true;
    el.strikeList.textContent = "";
    el.sendFieldsList.textContent = "";
    clearState(el.sendState);
    updateSendGate();
  }

  /** "Not yet" — drop the prepared brief and go back to the two fields. */
  function cancelSend() {
    // SAID, not done silently. Mid-send this button cannot do what it says — the request it
    // would cancel is already on the wire — and it used to early-return with no message and no
    // aria-disabled, so it read as broken at the one moment a recruiter is most likely to press
    // it. The lock is set by confirmSend for the duration; this is the answer to a press that
    // beats the lock.
    if (state.busy) {
      showState(el.sendState, COPY.sendBusyWait, false);
      return;
    }
    dropPreparedSend();
  }

  /**
   * A changed interview date invalidates the preview it was prepared against.
   *
   * `confirmSend` posts `state.sendPrepared.interview_at` — the stamp the SERVER normalised at
   * prepare time — and never re-reads this field. So an edit made while a preview is open was
   * accepted on screen and then discarded: the client moves the interview a week, the recruiter
   * retypes it, presses Send it, and the candidate's email, their portal and the retention
   * window all say the old day. Nothing ever said the edit was ignored.
   *
   * Dropping the preview is the honest answer rather than re-stamping it, because the date is an
   * INPUT to the model call — `interviewAt` reaches generateBrief and the LogisticsRail block
   * built from it. A payload prepared for one date is not a payload for another; it has to be
   * prepared again, which is what pressing "Send to candidate" now does.
   *
   * This also settles the two gates: `updateConfirmGate` never consults the date, so a past date
   * used to lock "Send to candidate" while leaving a live "Send it" beside it. With no preview
   * to send, that pairing cannot occur.
   */
  function interviewDateChanged() {
    if (state.sendPrepared) dropPreparedSend();
    else updateSendGate();
  }

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

  el.generate.addEventListener("click", generate);
  el.copyPrompt.addEventListener("click", copyPrompt);
  el.readPack.addEventListener("click", readPack);
  el.copyPack.addEventListener("click", copyPack);
  el.startAgain.addEventListener("click", resetToInputs);
  el.startAgain2.addEventListener("click", resetToInputs);

  el.prepareSend.addEventListener("click", prepareSend);
  el.confirmSend.addEventListener("click", confirmSend);
  el.cancelSend.addEventListener("click", cancelSend);
  // Both fields, on input: the gate is a live answer to "can this be sent yet", and a date
  // picker can change the value without a keystroke.
  el.interviewDate.addEventListener("input", interviewDateChanged);
  el.interviewDate.addEventListener("change", interviewDateChanged);
  el.candidateEmail.addEventListener("input", updateSendGate);

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
    if (state.phase !== "inputs" && !window.confirm(COPY.leavingClient(state.clientName, Boolean(state.sendPrepared)))) {
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
    var hasText = el.brief.value.trim() || el.cv.value.trim() || el.reply.value.trim() ||
      el.interviewDate.value || el.candidateEmail.value.trim();
    // A PREPARED-BUT-UNSENT BRIEF is the most expensive thing this screen ever holds: two
    // minutes of waiting and real model spend, unrecoverable on reload because nothing goes
    // to browser storage. It is worth more than the pasted CV this guard was written for,
    // and it can exist with both text areas frozen and every field already filled in.
    if (!hasText && !state.sendPrepared && state.phase === "inputs") return;
    event.preventDefault();
    event.returnValue = "";
  });

  // The picker's own far end. Set here rather than written into the markup, because an
  // attribute with a date in it goes stale the day after it is typed.
  el.interviewDate.max = maxUtc();

  setPhase("inputs");
  load(new URL(window.location.href).searchParams.get("client"), "");
})();
