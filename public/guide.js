/* The walkthrough layer (TEMPORARY) — a pill beside each step, a card explaining it.
 *
 * ⚠ SCHEDULED FOR DELETION. See the header of public/guide.css for the full removal list, and
 * test/guide.test.js for the contract that fails if the removal is only half done.
 *
 * WHY IT IS ITS OWN FILE AND NOT PART OF EACH SCREEN'S SCRIPT. Three reasons, in the order they
 * bite:
 *
 *   1. REMOVAL. Every word of the walkthrough lives here. Taking it down is deleting two files
 *      and two lines per page, rather than unpicking prose out of five working scripts.
 *   2. THE SCREENS' OWN GATES. clients.js, app.js, counts.js, assignments.js and compliance.js
 *      are each held to rules this file would break on sight — every visible string in one COPY
 *      object, exactly one `fetch(`, a forbidden-word scan, an id contract in
 *      test/screens.test.js. A walkthrough is nothing but visible strings; folding it into those
 *      files would mean loosening five gates for something that is leaving.
 *   3. BLAST RADIUS. This file touches no product state, sends no request, and reads nothing
 *      but the pathname. If it throws, the screen it annotates still works.
 *
 * It reads `location.pathname` and nothing else. No storage, no cookie, no fetch, no candidate
 * data — there is nothing here that could learn anything about anybody.
 */

(function () {
  "use strict";

  /* Every word the walkthrough says, per screen, in the order the steps happen.
   *
   * `anchor` is a selector already on the page — an id the screen's own script uses, or a
   * structural class. The pill is injected in a row directly ABOVE that element, so it reads as
   * an annotation on the thing rather than as a control belonging to it. Several steps may share
   * one anchor; they stack into the same row.
   *
   * `theirSide` is what the CANDIDATE sees at this point. It is told here, on the recruiter's own
   * screen, rather than by putting pills on a locum's portal — that portal is theirs, and
   * shipping learning material for the agency into it would be the wrong audience entirely.
   *
   * `watch` is the thing that will catch them out. Every one of them is deliberate behaviour, and
   * each is written so the reader can tell that from a bug. */
  var SCREENS = {
    "/": [
      {
        anchor: "#rail-head",
        pill: "Start here",
        title: "Pick the client first",
        body: [
          "Every pack is built from what you have written about this client, so a pack is only " +
            "as good as the note behind it. The note is worth keeping up to date.",
          "No clients yet, or no note on this one? Write it on <ui>Client knowledge</ui> and come " +
            "back. The pack cannot be built without it."
        ]
      },
      {
        anchor: "#act-inputs",
        pill: "The two inputs",
        title: "Paste the brief and the CV",
        body: [
          "The client's brief in the first box, the candidate's CV in the second. You can paste " +
            "the text, open a file, or drop one on the box. It reads PDF, Word and plain text.",
          "If a file is a scan, no text comes out of it. Open it, copy the text, and paste that " +
            "instead; the screen will tell you when this has happened."
        ]
      },
      {
        anchor: "#act-waiting",
        pill: "Two ways to build it",
        title: "Generate here, or run it in your own Claude",
        body: [
          "<ui>Generate the pack</ui> writes it here and takes a minute or two.",
          "If the tool cannot write packs here, use <ui>Or copy the prompt and open Claude</ui> " +
            "instead. It copies the prompt and opens Claude in another tab. Paste the whole reply " +
            "back, including the code block at the end, then press <ui>Show the pack</ui>."
        ]
      },
      {
        anchor: "#act-pack",
        pill: "Read the marks",
        title: "Check where each claim came from",
        body: [
          "This is the step that makes the tool worth using, and the easiest one to skip. Every " +
            "claim carries a mark: <ui>CV</ui>, <ui>Our note</ui>, <ui>Brief</ui>, " +
            "<ui>Unverified</ui> or <ui>Quote not found</ui>.",
          "Open <ui>Where this came from</ui> on anything you intend to say out loud to a client. " +
            "Then <ui>Copy the pack</ui>. It pastes with formatting into an email, and as plain " +
            "text into a field that wants plain text."
        ],
        watch: "<ui>Unverified</ui> means the tool guessed it rather than read it. Often worth " +
          "preparing for, never worth quoting."
      },
      {
        anchor: "#act-send",
        pill: "Send their prep",
        title: "What the candidate actually receives",
        body: [
          "You get a preview of exactly what they will get, with everything tickable. Untick " +
            "anything you would rather not send.",
          "Only the sections of your client note you ticked as shareable travel with it. Anything " +
            "the tool cannot find word for word in the brief you pasted is left out rather than " +
            "sent, so a candidate never walks into a room quoting something nobody wrote."
        ],
        theirSide: "They get an email with a private link that works once. After that they type " +
          "their email and we send a six-digit code. We never send them a link to click, so they " +
          "never learn to trust one.",
        watch: "Their practice answers are never shown to you. <ui>Prep sent</ui> counts how many " +
          "opened their prep and nothing else, and that limit is not configurable."
      }
    ],

    "/clients": [
      {
        anchor: "#add-form",
        pill: "Start here",
        title: "A client, before anything else",
        body: [
          "Every other screen hangs off a client. Type a name and press <ui>Add client</ui>, then " +
            "write down what you know in the box on the right."
        ]
      },
      {
        anchor: "#note",
        pill: "The note",
        title: "Write it as you would tell a colleague",
        body: [
          "Their process and stages, who sits on the panel, what each stage tests, why candidates " +
            "were turned down. Plain notes beat blank perfection.",
          "Start a line with <ui>##</ui> to make it a section. That matters: sections are the unit " +
            "you can choose to share with a candidate, so a note with no headings has nothing you " +
            "can share."
        ]
      },
      {
        anchor: "#visibility",
        pill: "What they can see",
        title: "Nothing reaches a candidate unless you tick it",
        body: [
          "These are the <ui>##</ui> headings from your note. Tick only what would help someone " +
            "get ready for the interview, and never anything you would not say to their face.",
          "Untouched, this list shares nothing. It is opt-in, one section at a time."
        ]
      },
      {
        anchor: "#locum",
        pill: "For locum work",
        title: "The five that make bookings move",
        body: [
          "Credentialing quirks, which portal bookings go through, what the department expects, " +
            "getting in on day one, and how they extend.",
          "Each row has a button that drops the heading into your note for you, so you only have " +
            "to write the part you know."
        ]
      },
      {
        anchor: "#agency-head",
        pill: "Pack settings",
        title: "How finished packs are shaped",
        body: [
          "Whether each claim's source quote sits beside it or in an appendix at the end, and " +
            "where your packs usually land: an email body, an attachment, or a field in your ATS.",
          "These are agency-wide rather than per-client, and they save as you change them."
        ]
      }
    ],

    "/assignments": [
      {
        anchor: "#booking-form",
        pill: "Does more than it looks",
        title: "Recording a booking creates the candidate",
        body: [
          "This is the only place in the tool that creates a candidate. The moment you press " +
            "<ui>Record booking</ui>, their compliance file starts and all eight checklist " +
            "items appear on the <ui>Compliance</ui> screen.",
          "Use the same email address you use for them everywhere else. A second booking for the " +
            "same address reuses the person you already have and leaves the checklist they have " +
            "already filled in alone."
        ],
        theirSide: "They cannot sign in to their compliance checklist until a booking exists for " +
          "that exact address. If a locum says the code never arrives, check this screen first.",
        watch: "An end date is optional, but a booking with no end date never produces the " +
          "fourteen-day email, because there is no deadline to count back from."
      },
      {
        anchor: "#assignments-table",
        pill: "Extend, or close",
        title: "What the two buttons do differently",
        body: [
          "<ui>Extend</ui> takes a new end date and sets the fourteen-day email again, so the new " +
            "deadline gets its own nudge. Extending is what the first nudge was for.",
          "<ui>Mark ended</ui> settles it instead and sinks the row to the bottom. It does not " +
            "re-ask the question."
        ],
        watch: "Two emails about one booking usually means someone extended it in between. " +
          "That is the tool working, not a duplicate."
      }
    ],

    "/compliance": [
      {
        anchor: ".page-head",
        pill: "How this is ordered",
        title: "Worst first, always",
        body: [
          "Whatever has already run out comes first, then whatever is running out, then whatever " +
            "is still missing. The candidate who most needs you is at the top, and you never " +
            "have to sort anything.",
          "The line under each name reads like <ui>5 of 8 verified · 2 waiting for you · 1 at " +
            "risk</ui>. <em>Verified</em> counts what you have checked, not what they have sent. " +
            "The gap between those two numbers is the work on your desk."
        ]
      },
      {
        anchor: "#compliance-list",
        pill: "The two labels",
        title: "Each row answers two different questions",
        body: [
          "The first label is where the item has got to: <ui>Not sent in</ui>, <ui>Waiting for " +
            "you</ui>, <ui>Verified</ui>.",
          "The second only appears when there is a deadline in play: <ui>Runs out in 12 days</ui> " +
            "or <ui>Ran out 4 days ago</ui>. It is worked out from the date every time you open " +
            "this screen, so it is right even if nothing has happened for a fortnight."
        ],
        watch: "<ui>Waiting for you</ui> beside <ui>Ran out 4 days ago</ui> is not a mistake. " +
          "They sent something, nobody has checked it, and it has since lapsed. Deal with that " +
          "row first."
      },
      {
        anchor: "#compliance-list",
        pill: "Verify, or send back",
        title: "The two things you can do",
        body: [
          "<ui>Verify</ui> means you have looked at the document and it is in order. The reference " +
            "number and the date stay exactly as they were.",
          "<ui>Send back</ui> takes one line saying what is wrong. The item returns to <ui>Not " +
            "sent in</ui>, its reference and date are cleared, and the candidate is emailed your " +
            "line. That line is the only record of why. It is not stored anywhere, so write it " +
            "as if it is the only thing they will read, because it is."
        ],
        watch: "An item that runs out while it is sitting on your desk can no longer be " +
          "verified, and the button will refuse it. The candidate has to send it again. Verify " +
          "things while they are still in date."
      },
      {
        anchor: "#compliance-list",
        pill: "Their half",
        title: "What the candidate does",
        body: [
          "They sign in at their own compliance door with a six-digit code, and see the same eight " +
            "items in plainer words: <ui>Not started</ui>, <ui>Sent in</ui>, <ui>Checked</ui>.",
          "Each one asks for a <ui>Reference or certificate number</ui>, and the six that expire " +
            "also ask for <ui>Date it runs out</ui>. References and the 48-hour week choice do not.",
          "The documents themselves keep travelling the way they always have. This tool never " +
            "accepts an upload, and their page says so."
        ],
        theirSide: "Their sign-in code email is titled \"Your interview-prep sign-in code\" even " +
          "when they asked for it here. There is one code email and it is worded for the prep " +
          "side. If a locum says they got the wrong email, they did not.",
        watch: "<ui>Send back</ui> needs the tool to be able to send email. If it cannot, you " +
          "are told so and nothing changes: the item stays waiting for you, because your reason " +
          "lives only in that email. <ui>Verify</ui> sends nothing and always works."
      }
    ],

    "/counts": [
      {
        anchor: "#counts-table",
        pill: "What this proves",
        title: "Deliberately not very much",
        body: [
          "Per client: how many packs, how much prep was sent, how much was opened. That is the " +
            "whole of it.",
          "This screen cannot tell you anything about one candidate: not who opened theirs, not " +
            "what they practised, not how long they spent. You can put that promise to a client " +
            "in writing. It is how the tool is built, not a setting anyone can switch off."
        ]
      }
    ]
  };

  /* `/clients.html` and `/clients` are the same screen: Pages serves the pretty path, a local
     file open does not. `/index.html` and `/` likewise. Normalised so the layer appears in both. */
  function screenKey() {
    var path = location.pathname.replace(/\.html$/, "").replace(/\/+$/, "");
    if (path === "" || path === "/index") return "/";
    return path;
  }

  var steps = SCREENS[screenKey()];
  if (!steps || !steps.length) return;

  /* Built with createElement and textContent throughout, the same rule every script on this
     deployment keeps. The one exception is `body` and `theirSide`, which carry <ui> and <em>
     marks — those are parsed by the tiny reader below rather than by innerHTML, so this file
     still has no HTML sink in it. */
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  /* A two-tag reader: <ui>…</ui> becomes a boxed interface label, <em>…</em> an emphasis, and
     everything else is a text node. Deliberately not innerHTML — this copy is ours, but a sink
     here would be a sink on five product screens, and the rule this deployment keeps is that
     there is no sink at all rather than that ours are safe. */
  function paragraph(markup, className) {
    var node = el("p", className);
    var pattern = /<(ui|em)>([\s\S]*?)<\/\1>/g;
    var at = 0;
    var match = pattern.exec(markup);
    while (match) {
      if (match.index > at) node.appendChild(document.createTextNode(markup.slice(at, match.index)));
      node.appendChild(el(match[1] === "ui" ? "span" : "em", match[1] === "ui" ? "guide-card-ui" : "", match[2]));
      at = match.index + match[0].length;
      match = pattern.exec(markup);
    }
    if (at < markup.length) node.appendChild(document.createTextNode(markup.slice(at)));
    return node;
  }

  /* One card, reused. It lives on <body> rather than beside its pill because two of the
     containers annotated here carry `overflow-x: auto`, which would clip a card positioned
     inside them — on the two screens with the most to explain. */
  var card = el("div", "guide-card");
  card.hidden = true;
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "false");
  card.setAttribute("aria-labelledby", "guide-card-title");
  card.id = "guide-card";

  var head = el("div", "guide-card-head");
  var headText = el("div");
  var eyebrow = el("p", "guide-card-eyebrow");
  var title = el("h2", "guide-card-title");
  title.id = "guide-card-title";
  headText.appendChild(eyebrow);
  headText.appendChild(title);

  var close = el("button", "guide-card-close", "✕");
  close.type = "button";
  close.setAttribute("aria-label", "Close this explanation");

  head.appendChild(headText);
  head.appendChild(close);

  var bodyWrap = el("div", "guide-card-body");

  var footer = el("p", "guide-card-footer", "Walkthrough: temporary, and not part of the tool");

  card.appendChild(head);
  card.appendChild(bodyWrap);
  card.appendChild(footer);
  document.body.appendChild(card);

  var openPill = null;

  function closeCard(returnFocus) {
    if (!openPill) return;
    openPill.setAttribute("aria-expanded", "false");
    var previous = openPill;
    openPill = null;
    card.hidden = true;
    if (returnFocus) previous.focus();
  }

  /* Clamped to the viewport rather than trusted to fit: a pill low on a long page would open a
     card off the bottom, and one at the right edge would open it off the side. Below the
     stylesheet's 560px breakpoint the card is a sheet at the foot of the screen and needs no
     arithmetic at all — the CSS owns it there, so this leaves the properties alone. */
  function place(pill) {
    if (window.innerWidth < 560) {
      card.style.top = "";
      card.style.left = "";
      return;
    }
    var rect = pill.getBoundingClientRect();
    var width = card.offsetWidth;
    var height = card.offsetHeight;
    var margin = 12;

    var left = Math.min(rect.left, window.innerWidth - width - margin);
    if (left < margin) left = margin;

    // ABOVE THE PILL BY PREFERENCE, WHICH IS THE OPPOSITE OF THE USUAL POPOVER RULE, and the
    // reason is this layer's whole geometry: a pill is injected directly ABOVE the thing it
    // explains. Opening downward therefore drops the card straight onto that thing — on
    // /assignments the first card covered the very form its second sentence is about. Opening
    // upward covers what the reader has already scrolled past instead.
    var above = rect.top - height - 8;
    var top = above >= margin ? above : rect.bottom + 8;

    // Neither side fits: sit it against whichever edge leaves the card whole. It scrolls
    // internally, so a clamped card is readable rather than truncated.
    if (top + height > window.innerHeight - margin) {
      top = Math.max(margin, window.innerHeight - height - margin);
    }

    card.style.top = top + "px";
    card.style.left = left + "px";
  }

  function openCard(pill, step, number) {
    closeCard(false);

    eyebrow.textContent = "Step " + number + " of " + steps.length;
    title.textContent = step.title;

    bodyWrap.textContent = "";
    step.body.forEach(function (line) {
      bodyWrap.appendChild(paragraph(line));
    });
    if (step.theirSide) {
      bodyWrap.appendChild(paragraph(step.theirSide, "guide-card-their-side"));
    }
    if (step.watch) {
      var watch = el("div", "guide-card-watch");
      watch.appendChild(el("p", "guide-card-watch-label", "Watch out"));
      watch.appendChild(paragraph(step.watch));
      bodyWrap.appendChild(watch);
    }

    card.hidden = false;
    pill.setAttribute("aria-expanded", "true");
    openPill = pill;
    place(pill);
    card.focus();
  }

  card.tabIndex = -1;

  close.addEventListener("click", function () {
    closeCard(true);
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") closeCard(true);
  });

  // A press anywhere that is not the card and not a pill closes it. The pill's own handler runs
  // first and toggles, so this must not undo that — hence the openPill check inside.
  document.addEventListener("click", function (event) {
    if (!openPill) return;
    if (card.contains(event.target)) return;
    if (event.target.closest && event.target.closest(".guide-pill")) return;
    closeCard(false);
  });

  // Re-place rather than close: closing a card because the page scrolled would fight a reader
  // who is scrolling to see the control the card is describing.
  window.addEventListener("resize", function () {
    if (openPill) place(openPill);
  });
  window.addEventListener("scroll", function () {
    if (openPill) place(openPill);
  }, true);

  /* The row of pills for one anchor, created on first use so several steps sharing an anchor
     stack into one row rather than stacking three rows on top of each other. */
  function pinsFor(target) {
    var previous = target.previousElementSibling;
    if (previous && previous.classList.contains("guide-pins")) return previous;
    var pins = el("div", "guide-pins");
    target.parentNode.insertBefore(pins, target);
    return pins;
  }

  steps.forEach(function (step, index) {
    var target = document.querySelector(step.anchor);
    // A screen whose markup has moved on loses that one pill rather than the whole layer. This
    // file is temporary and must never be the reason a working screen fails to paint.
    if (!target || !target.parentNode) return;

    var number = index + 1;
    var pill = el("button", "guide-pill");
    pill.type = "button";
    pill.setAttribute("aria-expanded", "false");
    pill.setAttribute("aria-controls", "guide-card");
    pill.setAttribute("aria-label", "Step " + number + ": " + step.title);
    pill.appendChild(el("span", "guide-pill-mark", String(number)));
    pill.appendChild(el("span", "", step.pill));

    pill.addEventListener("click", function () {
      if (openPill === pill) closeCard(true);
      else openCard(pill, step, number);
    });

    pinsFor(target).appendChild(pill);
  });
})();
