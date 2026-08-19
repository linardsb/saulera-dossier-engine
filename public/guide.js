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

    /* ── SHOWCASE BRANCH ONLY (demo/lewis-showcase) ─────────────────────────────────────────
       Every /prep entry below puts pills on CANDIDATE pages, which the header above calls
       the wrong audience entirely — and on main it is: a locum's portal must not carry learning
       material for the agency. On this demo the person browsing the candidate portal IS the
       recruiter learning the product, so here it is right. A merge to main must not carry any
       of these entries, the guide tags on the pages under public/prep/, the candidate-side
       accent (`candidateSide` below and the --candidate rules in guide.css), or their rows in
       test/guide.test.js. */

    "/prep/stories": [
      {
        anchor: ".page-head",
        pill: "Start here",
        title: "A bank of real stories, written once",
        body: [
          "You are on the candidate's side of the tool now. This page is where they write down " +
            "a few things that actually happened to them at work, once, in their own words. In " +
            "practice they reach for one instead of starting from nothing, and the same story " +
            "serves again at the next interview.",
          "Nothing here writes for them, tidies their words, or turns a story into anything " +
            "else. It is raw material, kept where their practice can reach it."
        ],
        watch: "None of this is ever visible to you. <ui>Your recruiter never sees any of " +
          "it.</ui> is the page's own promise, and it is how the tool is built rather than a " +
          "setting. There is nothing to switch on from your side."
      },
      {
        anchor: "#story-gap",
        pill: "The line above the list",
        title: "What to think about next",
        body: [
          "This line names exactly one part of the job: the one most likely to come up that " +
            "none of their stories covers yet. It moves on as ticks cover it, and goes away " +
            "once every part has a story behind it.",
          "It is deliberately never a count and never a score. The candidate is not told how " +
            "many parts are covered. They are given the one thing worth thinking about next, " +
            "which is the whole point of it."
        ],
        watch: "A tick only covers a part when the story behind it has words in it. A checkbox " +
          "is not a story, so a saved title with an empty <ui>What happened?</ui> box leaves " +
          "this line standing."
      },
      {
        anchor: "#add-story",
        pill: "Their own ticks",
        title: "The candidate does the mapping, not the tool",
        body: [
          "<ui>Add a story</ui> opens three boxes: <ui>What do you call this one?</ui>, " +
            "<ui>What happened?</ui> and <ui>Which parts of the job does it show?</ui>. Rough " +
            "notes are the point, and the box says so itself.",
          "The last one is the mapping: one tick per part of this job, made by the candidate " +
            "and nobody else. Nothing reads the story and infers what it shows. <ui>This is " +
            "how practice knows to point you at this story.</ui> is the caption's own wording, " +
            "and the tick is the entire mechanism."
        ]
      }
    ],

    "/prep/debrief": [
      {
        anchor: ".page-head",
        pill: "Opens on the day",
        title: "Nothing to write until there has been an interview",
        body: [
          "This page opens on the interview day, never before. Until then it carries a single " +
            "line, <ui>This page opens after your interview.</ui>, and no form at all, because " +
            "there is nothing to remember yet. You can see the form now because this " +
            "candidate's interview day has arrived."
        ],
        watch: "The whole page stays on their side. <ui>This page is yours. Your recruiter " +
          "never sees any of it.</ui> sits under the heading, and it is how the tool is built " +
          "rather than a setting. What a candidate writes after an interview never crosses to " +
          "you."
      },
      {
        anchor: "#asked-label",
        pill: "While it is fresh",
        title: "The questions, as they remember them",
        body: [
          "<ui>What were you asked?</ui> takes one question per line, as close to the " +
            "interviewer's words as the candidate can manage on the way out. " +
            "<ui>Half-remembered is fine.</ui> is the caption's own promise: a rough line " +
            "written today beats a perfect one forgotten by the evening."
        ]
      },
      {
        anchor: "#place-label",
        pill: "Filed by their pick",
        title: "Each question goes where the candidate says",
        body: [
          "Every line from the box gets its own picker, and the candidate files the question " +
            "under a part of the job by choosing from the list. Nothing reads the question and " +
            "guesses. The pick is theirs, every time.",
          "<ui>Not sure yet</ui> is a real answer: a question left on it stays on this page " +
            "until they place it. Once filed, a question comes back to them the next time " +
            "practice serves that part of the job."
        ]
      },
      {
        anchor: "#shaky-label",
        pill: "Never a score",
        title: "Shaky ticks quietly steer their practice",
        body: [
          "<ui>Anything that felt shaky?</ui> is one tick per part of the job. A tick quietly " +
            "moves that part up the queue of what their practice serves next, and that is the " +
            "whole of what it does.",
          "It is never shown as a mark, a number or a report, to them or to anyone else. " +
            "<ui>Nothing here is a mark, and nobody sees it.</ui> is the caption's promise, " +
            "and the tool keeps it.",
          "Below it, <ui>One thing to do differently next time</ui> asks for exactly one. The " +
            "caption's reason: <ui>It is easier to change one thing than five.</ui>"
        ]
      }
    ],

    "/prep/brief": [
      {
        anchor: ".page-head",
        pill: "Their front door",
        title: "What their invite opens",
        body: [
          "The page a candidate's invite opens: their prep for one interview. The line under " +
            "the title says where it comes from: <ui>Built from what this agency knows about " +
            "the client, not from the job advert.</ui> That means your client note and the " +
            "brief you pasted, nothing else.",
          "<ui>Practise for it</ui> opens their drill, and <ui>Your stories</ui> their " +
            "storybank; both are theirs from day one."
        ],
        watch: "The third button, <ui>How did the interview go?</ui>, stays hidden until the " +
          "interview day arrives, because a debrief before the interview is meaningless. You " +
          "can see it because the demo candidate's day has come."
      },
      {
        anchor: "#blocks",
        pill: "The five blocks",
        title: "What fills the page, in pack order",
        body: [
          "Everything below renders from the pack: <ui>What this role is really about</ui>, " +
            "<ui>What they keep coming back to</ui>, <ui>Who you are likely to meet</ui>, " +
            "<ui>A story worth bringing</ui>, then <ui>The practical details</ui>.",
          "It is a projection of the stored pack, not the pack itself. The model's failed " +
            "guesses, the importance scores and the question bank never leave the server, so " +
            "this page could not show them even by mistake."
        ]
      },
      {
        anchor: "#blocks",
        pill: "The marks travel",
        title: "Claims name their source on this side too",
        body: [
          "The rule your pack lives by follows the candidate here. A claim they can lean on " +
            "carries the quoted line and where it came from: <ui>From the client's brief</ui> " +
            "or <ui>From our notes on this client</ui>.",
          "A guess stays on the page and wears <ui>Unverified</ui>, with a caption saying " +
            "what to do with it: <ui>Do not quote it back to them.</ui> The candidate gets " +
            "the same honesty about sources that you do."
        ]
      }
    ],

    "/prep/session": [
      {
        anchor: ".page-head",
        pill: "Never a mark",
        title: "Practice, on their side only",
        body: [
          "The drill that <ui>Practise for it</ui> opens. The promise under the heading is " +
            "the page's whole posture: <ui>You are preparing here, never being marked, and " +
            "nothing you do is shown to your recruiter.</ui>",
          "Their answers are read to write feedback and to decide what to serve next, and " +
            "that is all. No mark is ever shown, to them or to you, and nothing they type " +
            "ever reaches your side."
        ]
      },
      {
        anchor: "#act-prime",
        pill: "Before you start",
        title: "Where they pick up from",
        body: [
          "<ui>Before you start</ui> is what returning makes useful: the role primer again, " +
            "then <ui>Where you have got to</ui>, listing <ui>Covered so far</ui> and " +
            "<ui>Still to come</ui>, so no session starts from nothing.",
          "<ui>Start practising</ui> is the only button. A session already under way skips " +
            "this act entirely and reopens the drill where it stopped, which is what the page " +
            "means by <ui>This page brings you back to where you stopped.</ui>"
        ]
      },
      {
        anchor: "#act-prime",
        pill: "How the queue thinks",
        title: "What gets served, and when",
        body: [
          "One question at a time, chosen rather than listed: the part of the job most in " +
            "need of work is served first. A part the candidate ticked under <ui>Anything " +
            "that felt shaky?</ui> after an interview sinks in readiness, so it comes round " +
            "sooner.",
          "The interview date sets the pace. Weeks out, each part rests a few days between " +
            "goes; inside the final three days the resting stops and only the most pressing " +
            "half of the list stays in play, trading depth for coverage. The day before, the " +
            "session becomes a short run-through: <ui>Your interview is tomorrow. This is a " +
            "short run through what you already have, not new practice.</ui>"
        ]
      },
      {
        anchor: "#act-prime",
        pill: "Help, then the close",
        title: "Two rungs of help, and an honest ending",
        body: [
          "<ui>If you get stuck</ui> sits under every question with two rungs: <ui>A " +
            "nudge</ui>, then <ui>A structure to follow</ui>. Opening one is never held " +
            "against them; it changes only what a later session serves. With the structure " +
            "open, sending an empty answer is a legal way to move on.",
          "<ui>Wrap up for now</ui> appears once there is something worth closing on, and " +
            "ends at <ui>Where you got to</ui>: <ui>What improved today</ui> when something " +
            "moved, <ui>Queued for next time</ui> naming the next thing, and when nothing " +
            "moved, the honest line instead: <ui>It will not always feel like progress while " +
            "you are doing it.</ui>"
        ],
        watch: "An empty send with no help open is refused: <ui>Type your answer first.</ui> " +
          "That is the guard working, not a fault. And an empty send after opening the " +
          "structure earns no invented praise; <ui>Nothing to look at this time.</ui> is all " +
          "that comes back."
      }
    ],

    "/prep/privacy": [
      {
        anchor: ".page-head",
        pill: "The whole promise",
        title: "What is held, why, and when it goes",
        body: [
          "Every page in the portal ends with a link here. Two tables carry the substance: " +
            "what is held, why, and when it is deleted. Prep data is erased 30 days after " +
            "the interview date; the compliance record, kept separately, goes 12 months " +
            "after the last booking ends. Both deletions are automatic and permanent: " +
            "<ui>there is no archive and no copy kept</ui>.",
          "One line under the first table answers the question a candidate is most likely " +
            "to ask you: <ui>Your recruiter sees whether the invite was sent and opened. " +
            "That is all.</ui>"
        ]
      },
      {
        anchor: "#delete-now",
        pill: "The delete-now door",
        title: "Sooner than the timetable, no reason needed",
        body: [
          "<ui>Delete it now</ui> is the early exit: the same data the automatic deletion " +
            "would take, removed the moment the candidate asks. The compliance checklist " +
            "carries its own control at its foot, and the two records are separate, so " +
            "deleting one leaves the other standing.",
          "The page states the terms plainly: <ui>You do not have to give a reason, and " +
            "nobody is told you pressed it.</ui>"
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
            "things the agency needs on file before a booking. The page asks for exactly two " +
            "facts per item and says so up front: <ui>Send us the reference number and the " +
            "date each one runs out.</ui>",
          "The count line reads like <ui>3 of 8 done</ui>: a list with items left on it, " +
            "never a mark out of eight. When something is sent in and unchecked, <ui>1 is " +
            "with the agency to check</ui> joins it, and that item is the one your side " +
            "lists as <ui>Waiting for you</ui>."
        ]
      },
      {
        anchor: "#items",
        pill: "A word and a sentence",
        title: "Where each item stands",
        body: [
          "Each card carries a short word for the state: <ui>Not started</ui>, <ui>Sent " +
            "in</ui>, <ui>Checked</ui>, and when a date presses, <ui>Expiring</ui> or " +
            "<ui>Out of date</ui>. The sentence under it says the same thing properly, like " +
            "<ui>We do not have this yet.</ui>",
          "Anything not yet <ui>Checked</ui> keeps a form: <ui>Reference or certificate " +
            "number</ui> for all of them, <ui>Date it runs out</ui> for the six that lapse. " +
            "References and the 48-hour week choice never ask for a date, because neither " +
            "expires. <ui>Send this</ui> hands the item over."
        ],
        watch: "A card already <ui>Sent in</ui> keeps its form too. That is deliberate: a " +
          "reference typed wrongly is fixed by typing it again, and the newest send is what " +
          "the agency checks."
      },
      {
        anchor: "#items",
        pill: "Never a document",
        title: "Reference numbers, never the documents",
        body: [
          "Under every form sits the same caption: <ui>We do not store your documents.</ui> " +
            "There is no upload control on this page at all, which is structural rather than " +
            "polite: what is stored is a reference, a date, and whether it has been checked. " +
            "The documents keep going to the agency the way they always have.",
          "At the very foot, <ui>Delete everything you hold about me</ui> erases the whole " +
            "compliance record after one confirmation. It is a button rather than a link so " +
            "that nothing, scanner or browser, can fire it by fetching a URL."
        ]
      }
    ],

    "/prep/compliance/login": [
      {
        anchor: ".page-head",
        pill: "The real door",
        title: "How a locum signs in when it is not a demo",
        body: [
          "Every compliance email the tool sends, the expiry nudges included, points at this " +
            "page. The demo never showed it to you because the demo door signs you straight " +
            "in; a real locum lands here, types the email address the agency has for them, " +
            "and presses <ui>Send me a code</ui>.",
          "One task at a time: the <ui>6-digit code</ui> box appears only after a code has " +
            "been asked for, and the cursor is put in it."
        ]
      },
      {
        anchor: "#act-email",
        pill: "Codes, never links",
        title: "Six digits, and deliberately no link",
        body: [
          "The lede carries the promise: <ui>We will not send you a link to click.</ui> The " +
            "email that arrives holds a 6-digit code and no link, so a locum never learns to " +
            "trust one.",
          "The code box is built for a phone: it offers the code straight from the " +
            "notification, and a pasted code survives a stray space in the middle."
        ],
        watch: "The code email is titled <ui>Your interview-prep sign-in code</ui> even when " +
          "it is asked for from this page. There is one code email, worded for the prep " +
          "side; a locum who says they got the wrong email did not."
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

  /* SHOWCASE BRANCH ONLY (demo/lewis-showcase): which side of the tool this screen sits on.
     Everything under /prep is the candidate's portal; everything else is the recruiter's tool.
     The pills and the card wear a different accent per side (guide.css's --candidate rules),
     and the card's eyebrow names the side in words, so the split never rests on colour alone.
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

    // The candidate eyebrow says whose side the page is on, so the accent never carries the
    // split by colour alone (SHOWCASE BRANCH ONLY — see `candidateSide` above).
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
