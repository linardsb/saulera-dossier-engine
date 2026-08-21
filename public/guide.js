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
    ],

    /* ── SHOWCASE BRANCH ONLY (demo/louis-showcase) ─────────────────────────────────────────
       Every /prep entry below puts pills on CANDIDATE pages, which the header above calls
       the wrong audience entirely — and on main it is: a locum's portal must not carry learning
       material for the agency. On this demo the person browsing the candidate portal IS the
       recruiter learning the product, so here it is right. A merge to main must not carry any
       of these entries, the guide tags on the pages under public/prep/, the candidate-side
       wiring (`candidateSide` below), or their rows in test/guide.test.js. */

    "/prep/stories": [
      {
        anchor: ".page-head",
        pill: "Start here",
        title: "A bank of real stories, written once",
        body: [
          "Here the candidate writes down a few things that actually happened to them at " +
            "work, once, in their own words. In practice they reach for one instead of " +
            "starting from nothing, and the same story serves again at the next interview.",
          "Nothing here writes for them or tidies their words. It is raw material, kept " +
            "where their practice can reach it."
        ],
        watch: "None of it is ever visible to you. That is how the tool is built, not a " +
          "setting."
      },
      {
        anchor: "#story-gap",
        pill: "The line above the list",
        title: "What to think about next",
        body: [
          "This line names one part of the job: the one most likely to come up that no story " +
            "covers yet. It moves on as ticks cover it and goes away once every part has a " +
            "story behind it. Never a count, never a score."
        ],
        watch: "A tick only covers a part when the story has words in it. A saved title over " +
          "an empty <ui>What happened?</ui> box leaves this line standing."
      },
      {
        anchor: "#add-story",
        pill: "Their own ticks",
        title: "The candidate does the mapping, not the tool",
        body: [
          "<ui>Add a story</ui> opens three boxes: a name, <ui>What happened?</ui> and " +
            "<ui>Which parts of the job does it show?</ui>. The ticks are the mapping, made " +
            "by the candidate and nobody else. Nothing reads the story and guesses; a tick " +
            "is the entire mechanism."
        ]
      }
    ],

    "/prep/debrief": [
      {
        anchor: ".page-head",
        pill: "Opens on the day",
        title: "Nothing to write until there has been an interview",
        body: [
          "This page opens on the interview day, never before. Until then it is one line and " +
            "no form, because there is nothing to remember yet. You can see the form because " +
            "the demo candidate's day has arrived."
        ],
        watch: "The whole page stays on their side. What a candidate writes after an " +
          "interview never crosses to you."
      },
      {
        anchor: "#asked-label",
        pill: "While it is fresh",
        title: "The questions, as they remember them",
        body: [
          "<ui>What were you asked?</ui> takes one question per line, as close to the " +
            "interviewer's words as they can manage on the way out. Half-remembered is fine: " +
            "a rough line written today beats a perfect one forgotten by the evening."
        ]
      },
      {
        anchor: "#place-label",
        pill: "Filed by their pick",
        title: "Each question goes where the candidate says",
        body: [
          "Every line gets its own picker and the candidate files it under a part of the " +
            "job. Nothing reads the question and guesses. <ui>Not sure yet</ui> is a real " +
            "answer; once filed, a question comes back the next time practice serves that " +
            "part."
        ]
      },
      {
        anchor: "#shaky-label",
        pill: "Never a score",
        title: "Shaky ticks quietly steer their practice",
        body: [
          "<ui>Anything that felt shaky?</ui> is one tick per part of the job. A tick moves " +
            "that part up the practice queue, and that is all it does: never a mark, never a " +
            "report, to them or to anyone.",
          "Under it, <ui>One thing to do differently next time</ui> asks for exactly one, " +
            "because it is easier to change one thing than five."
        ]
      }
    ],

    "/prep/brief": [
      {
        anchor: ".page-head",
        pill: "Their front door",
        title: "What their invite opens",
        body: [
          "The page a candidate's invite opens: their prep for one interview, built from the " +
            "brief you pasted and the note sections you ticked as shareable, nothing else. " +
            "<ui>Practise for it</ui> opens their drill; <ui>Your stories</ui> their " +
            "storybank."
        ],
        watch: "<ui>How did the interview go?</ui> stays hidden until the interview day, " +
          "because a debrief before the interview is meaningless. You can see it because the " +
          "demo candidate's day has come."
      },
      {
        anchor: "#blocks",
        pill: "The marks travel",
        title: "The pack's blocks, with their sources",
        body: [
          "Everything below renders from the pack, in pack order: the role, what they keep " +
            "coming back to, who they are likely to meet, a story worth bringing, the " +
            "practical details.",
          "Claims name their source on this side too: a quoted line from the brief or your " +
            "note, or <ui>Unverified</ui> with plain advice not to quote it. The model's " +
            "failed guesses, the importance scores and the question bank never leave the " +
            "server."
        ]
      }
    ],

    "/prep/session": [
      {
        anchor: ".page-head",
        pill: "Never a mark",
        title: "Practice, on their side only",
        body: [
          "The drill <ui>Practise for it</ui> opens. Their answers are read to write " +
            "feedback and to pick what comes next, and that is all: no mark is ever shown, " +
            "to them or to you, and nothing they type reaches your side."
        ]
      },
      {
        anchor: "#act-prime",
        pill: "How the queue thinks",
        title: "What gets served, and when",
        body: [
          "A session opens with the primer and where they got to, then serves one question " +
            "at a time: the part of the job most in need of work first. A part ticked as " +
            "shaky after an interview comes round sooner, and a session already under way " +
            "reopens the drill where it stopped.",
          "The interview date sets the pace. Weeks out, each part rests a few days between " +
            "goes. Inside the final three days only the most pressing half stays in play, " +
            "and the day before becomes a short run through what they already have."
        ]
      },
      {
        anchor: "#act-prime",
        pill: "Help, then the close",
        title: "Two rungs of help, and an honest ending",
        body: [
          "<ui>If you get stuck</ui> sits under every question: <ui>A nudge</ui>, then " +
            "<ui>A structure to follow</ui>. Opening one is never held against them; it only " +
            "shapes what later sessions serve. With the structure open, sending an empty " +
            "answer is a legal way to move on.",
          "<ui>Wrap up for now</ui> ends at an honest close: what improved, what is queued, " +
            "and when nothing moved, it says so rather than inventing praise."
        ],
        watch: "An empty send with no help open is refused. That is the guard working, not " +
          "a fault."
      }
    ],

    "/prep/privacy": [
      {
        anchor: ".page-head",
        pill: "The whole promise",
        title: "What is held, why, and when it goes",
        body: [
          "Every page in the portal ends with a link here. Two tables carry it: what is " +
            "held, why, and when it is deleted. Prep data goes 30 days after the interview; " +
            "the compliance record, kept separately, 12 months after the last booking ends. " +
            "Both deletions are automatic and permanent, and <ui>Delete it now</ui> is the " +
            "early exit: no reason needed, and nobody is told.",
          "The line candidates ask about most: <ui>Your recruiter sees whether the invite " +
            "was sent and opened. That is all.</ui>"
        ]
      }
    ],

    "/prep/compliance": [
      {
        anchor: ".page-head",
        pill: "The other checklist",
        title: "The same eight items, in their words",
        body: [
          "A locum's own view of what your <ui>Compliance</ui> screen tracks: the eight " +
            "things the agency needs on file before a booking, two facts per item, the " +
            "reference number and the date it runs out. The count reads like <ui>3 of 8 " +
            "done</ui>: a list with items left on it, never a mark. An item sent in and " +
            "unchecked here is the one your side lists as <ui>Waiting for you</ui>."
        ]
      },
      {
        anchor: "#items",
        pill: "A word and a sentence",
        title: "Where each item stands",
        body: [
          "Each card wears a short state, <ui>Not started</ui>, <ui>Sent in</ui>, " +
            "<ui>Checked</ui>, <ui>Expiring</ui> or <ui>Out of date</ui>, with a plain " +
            "sentence under it. Anything unchecked keeps its form, so a wrongly typed " +
            "reference is fixed by sending it again; the newest send is what you check.",
          "There is no upload control anywhere, and <ui>We do not store your documents.</ui> " +
            "sits under every form. Documents keep going to the agency the way they always " +
            "have. At the foot, <ui>Delete everything you hold about me</ui> erases the " +
            "whole record after one confirmation."
        ]
      }
    ],

    "/prep/compliance/login": [
      {
        anchor: ".page-head",
        pill: "The real door",
        title: "How a locum signs in when it is not a demo",
        body: [
          "Every compliance email points here. The demo door signs you straight in, so you " +
            "never saw it: a real locum types the email address the agency has for them and " +
            "presses <ui>Send me a code</ui>. Six digits arrive and there is deliberately " +
            "no link to click, so a locum never learns to trust one."
        ],
        watch: "The code email is titled <ui>Your interview-prep sign-in code</ui> even " +
          "when it is asked for from this page. There is one code email, worded for the " +
          "prep side; a locum who says they got the wrong email did not."
      }
    ]
  };

  /* `/clients.html` and `/clients` are the same screen: Pages serves the pretty path, a local
     file open does not. `/index.html` and `/` likewise — and any `/index` tail folds into its
     directory, so `/prep/compliance/` and `/prep/compliance/index.html` share one entry. */
  function screenKey() {
    var path = location.pathname.replace(/\.html$/, "").replace(/\/+$/, "");
    if (path.slice(-6) === "/index") path = path.slice(0, -6);
    if (path === "") return "/";
    return path;
  }

  var key = screenKey();
  var steps = SCREENS[key];
  if (!steps || !steps.length) return;

  /* SHOWCASE BRANCH ONLY (demo/louis-showcase): which side of the tool this screen sits on.
     Everything under /prep is the candidate's portal; everything else is the recruiter's tool.
     The card's eyebrow names the side in words; the owner chose ONE colour for both sides, so
     the --candidate classes set below are hooks with no rules behind them in guide.css —
     kept because the words are the split, and a later accent needs only CSS to return.
     On main the layer never loads on a candidate page, so this is always false there — delete
     with the /prep entries above. */
  var candidateSide = key.lastIndexOf("/prep", 0) === 0;

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
  var card = el("div", candidateSide ? "guide-card guide-card--candidate" : "guide-card");
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

    // The candidate eyebrow says whose side the page is on — the words ARE the split, since
    // both sides wear one colour (SHOWCASE BRANCH ONLY — see `candidateSide` above).
    eyebrow.textContent = candidateSide
      ? "The candidate's side · step " + number + " of " + steps.length
      : "Step " + number + " of " + steps.length;
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
    var pill = el("button", candidateSide ? "guide-pill guide-pill--candidate" : "guide-pill");
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
