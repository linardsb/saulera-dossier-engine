/* The candidate's sign-in page (#20).
 *
 * Vanilla, no framework, no build step, the same idiom as public/clients.js.
 *
 * Four behaviours here are decisions rather than implementation details:
 *
 * 1. Nothing is written to browser storage of any kind. The email address a candidate types
 *    is personal data belonging to someone who has not signed in yet, and the six-digit code
 *    is a live credential. Both stay in the DOM for as long as the page is open and nowhere
 *    else. (Written without the storage API names on purpose: the plan's Level 1 gate greps
 *    this directory for them, and a gate that cries wolf at a comment gets deleted.)
 *
 * 2. The ?e= value is never put on the page. It is a key into the COPY table below, and an
 *    unknown key renders nothing. Reflecting the query string into the DOM is how a login
 *    page becomes an XSS vector, and this one is the only page on the deployment a stranger
 *    can be sent a crafted URL for.
 *
 * 3. Act 1 says the same thing whether or not the address matched an invite, because the
 *    server answers the same thing. If this page said "no invite for that address" it would
 *    undo the enumeration guard in functions/prep/auth/otp.js from the outside. The copy is
 *    written to be honest about that rather than to imply a match: "if it matches an invite".
 *
 * 4. A failed verify keeps the typed code on screen and re-focuses it. The candidate is one
 *    character away from being right, and clearing the field would make them retype six
 *    digits they can no longer see.
 */

(function () {
  "use strict";

  var COPY = {
    // What a dead magic link lands on. Two messages, because there are two different things
    // worth telling someone: their prep has closed, or their link is spent.
    invalid: "That link has already been used, or it is not valid any more. Enter your email " +
             "below and we will send you a code.",
    expired: "That link has expired. Your prep stays available until 14 days after your " +
             "interview.",

    sending: "Sending…",
    // Deliberately non-committal about whether the address matched. See note 3 above.
    sent: "We have sent a code to that address if it matches an invite. It expires in 10 " +
          "minutes.",
    emailMissing: "Enter the email address your invite was sent to.",
    sendFailed: "Could not send a code just now. Try again in a moment.",

    verifying: "Signing in…",
    codeLength: "Enter the 6-digit code from the email.",
    codeWrong: "That code is not right. Check the email and try again.",
    codeExpired: "That code has expired. Ask for a new one above.",
    codeCapped: "Too many tries. Ask for a new code above.",
    verifyFailed: "Could not sign you in just now. Try again in a moment.",

    // The deployment fault, which is nobody's fault on this side of the screen. It fires on
    // first stand-up before an agency has touched anything, so it cannot borrow the copy
    // above, which would blame the candidate's code for a missing database binding.
    notConfigured: "This portal is not connected to its database yet. Ask the agency that " +
                   "invited you.",
  };

  var $ = function (id) { return document.getElementById(id); };

  var notice = $("notice");
  var noticeText = $("notice-text");
  var actCode = $("act-code");
  var sentNote = $("sent-note");
  var formEmail = $("form-email");
  var formCode = $("form-code");
  var emailInput = $("email");
  var codeInput = $("code");
  var sendButton = $("send");
  var verifyButton = $("verify");
  var emailState = $("email-state");
  var codeState = $("code-state");

  /** A state line, with the tone that decides its colour. Text only, never markup. */
  function say(node, message, tone) {
    node.textContent = message || "";
    if (tone) node.setAttribute("data-tone", tone);
    else node.removeAttribute("data-tone");
  }

  /* aria-disabled rather than disabled: setting `disabled` on the focused button drops focus
     to <body> and does not give it back, so a keyboard user loses their place mid-sign-in.
     app.css styles both the same way. */
  function busy(button, isBusy) {
    button.setAttribute("aria-disabled", isBusy ? "true" : "false");
  }
  var isBusy = function (button) { return button.getAttribute("aria-disabled") === "true"; };

  /** POST JSON, and hand back the status alongside the parsed body. */
  function post(url, payload) {
    return fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (body) {
        return { status: response.status, body: body };
      });
    });
  }

  // ── the ?e= notice ───────────────────────────────────────────────────────────────────

  var reason = new URLSearchParams(window.location.search).get("e");
  if (reason === "invalid" || reason === "expired") {
    noticeText.textContent = COPY[reason];
    notice.hidden = false;
  }

  // ── act 1: ask for a code ────────────────────────────────────────────────────────────

  formEmail.addEventListener("submit", function (event) {
    event.preventDefault();
    if (isBusy(sendButton)) return;

    var email = emailInput.value.trim();
    if (!email) {
      say(emailState, COPY.emailMissing, "error");
      emailInput.focus();
      return;
    }

    busy(sendButton, true);
    say(emailState, COPY.sending);

    post("/prep/auth/otp", { email: email }).then(function (result) {
      busy(sendButton, false);

      if (result.status === 503) {
        say(emailState, COPY.notConfigured, "error");
        return;
      }
      // 202 is the only success, and it means "accepted", not "an email is on its way to a
      // real invite". The copy says so.
      if (result.status !== 202) {
        say(emailState, COPY.sendFailed, "error");
        return;
      }

      say(emailState, "");
      sentNote.textContent = COPY.sent;
      actCode.hidden = false;
      // One task at a time: the candidate has done act 1, so put the cursor in act 2 rather
      // than leaving them to find it.
      codeInput.focus();
    }).catch(function () {
      busy(sendButton, false);
      say(emailState, COPY.sendFailed, "error");
    });
  });

  // ── act 2: spend it ──────────────────────────────────────────────────────────────────

  formCode.addEventListener("submit", function (event) {
    event.preventDefault();
    if (isBusy(verifyButton)) return;

    // Candidates paste what their mail client shows them, which is sometimes '123 456'. The
    // server strips non-digits too; doing it here as well is what lets the page tell a typo
    // of the wrong length apart from a wrong code without spending one of the five tries.
    var code = codeInput.value.replace(/\D/g, "");
    if (code.length !== 6) {
      say(codeState, COPY.codeLength, "error");
      codeInput.focus();
      return;
    }

    busy(verifyButton, true);
    say(codeState, COPY.verifying);

    post("/prep/auth/verify", { email: emailInput.value.trim(), code: code }).then(function (result) {
      if (result.status === 200 && result.body.ok) {
        // The cookie arrived with this response. A full navigation rather than a history
        // push, so the prep page loads with the session already in place.
        window.location.href = "/prep/";
        return;
      }

      busy(verifyButton, false);
      if (result.status === 410) say(codeState, COPY.codeExpired, "error");
      else if (result.status === 429) say(codeState, COPY.codeCapped, "error");
      else if (result.status === 401) say(codeState, COPY.codeWrong, "error");
      else if (result.status === 503) say(codeState, COPY.notConfigured, "error");
      else say(codeState, COPY.verifyFailed, "error");
      // The typed code stays on screen and keeps focus: they are one character from right.
      codeInput.focus();
      codeInput.select();
    }).catch(function () {
      busy(verifyButton, false);
      say(codeState, COPY.verifyFailed, "error");
    });
  });
})();
