/* The candidate's prep-brief dashboard (#21).
 *
 * Fetch a stored brief payload, hand it to the registry, and own the three states the registry
 * does not: waiting, empty, and failed. Everything between the topbar and the footer is built by
 * public/prep/registry.js.
 *
 * Two decisions carried over from public/app.js, for the same reasons stated there:
 *
 * 1. Nothing is written to browser storage of any kind — not local storage, not session storage,
 *    not cookies, not a database in the browser, not a cache. A candidate's brief is candidate
 *    data, and "transient" has to include the browser or the sentence is not true. There is
 *    nothing to lose on refresh here: this page holds no input, so the reload simply refetches.
 *    (Written without the API names on purpose: the Level 1 gate greps this file for them, and a
 *    gate that cries wolf at a comment gets deleted.)
 *
 * 2. Nothing candidate-shaped goes in the URL.
 *
 * No model call happens here. This page renders a payload that was generated and verified at
 * Send; #23's session engine and #24's drill surface own every live call.
 */

import { renderBlocks } from "./registry.js";

/** Every visible string, in one object — public/app.js:47's idiom. */
const COPY = {
  loading: "Loading your prep…",
  empty:
    "Your prep is not ready yet. Your recruiter is still putting it together, so check back " +
    "later today.",
  failed:
    "We could not load your prep just now. Reload the page, and if it still will not load, " +
    "reply to the email that invited you.",
};

/** The session-gated projection of this candidate's own stored brief (#22).
 *
 *  Not the stored row: functions/prep/api/brief.js runs it through candidateProjection first,
 *  so the model's failed guesses, the importance scores and the question bank stay server-side.
 *  This page could not display them if it wanted to, which is the point — the guarantee is
 *  about what is DELIVERED, not about what is rendered. */
const SOURCE = "/prep/api/brief";

const state = document.getElementById("brief-state");
const mount = document.getElementById("blocks");
const roleTitle = document.getElementById("role-title");
// A LITERAL lookup like the three above, not a `$` helper: test/prep-content.test.js derives this
// page's reached ids from literal getElementById calls, and a helper here would leave that gate
// parsing nothing while still passing.
const debriefCta = document.getElementById("debrief-cta");

/** The state line, in app.js's grammar: `.is-shown` to reveal, `.is-error` for a failure. */
function showState(message, isError) {
  state.textContent = message;
  state.classList.toggle("is-error", Boolean(isError));
  state.classList.add("is-shown");
}

function clearState() {
  state.textContent = "";
  state.classList.remove("is-error", "is-shown");
}

showState(COPY.loading, false);

fetch(SOURCE, { headers: { accept: "application/json" } })
  .then((res) => {
    // A candidate whose session has gone is a person in front of a browser, not a caller
    // parsing a body — /prep/login can explain itself and offer the code path, which an
    // error line on a page they cannot use cannot. `replace`, not `assign`: a dead page
    // should not sit in the history for Back to land on.
    if (res.status === 401) {
      window.location.replace("/prep/login");
      // Never resolves, deliberately: the navigation is already under way and settling this
      // chain would flash an error line over a page that is leaving.
      return new Promise(() => {});
    }
    // The handover has not been written yet — a real state, not a failure. It gets the
    // "not ready yet" copy below rather than the "something went wrong" copy.
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`brief: ${res.status}`);
    return res.json();
  })
  .then((payload) => {
    if (payload === null) {
      showState(COPY.empty, false);
      return;
    }
    if (!payload || !Array.isArray(payload.blocks)) throw new Error("brief: no blocks");

    // Text, never an HTML-parsing assignment: the title comes out of the payload, which is
    // model output. registry.js holds the same rule for everything below it.
    const title = String(payload.role_title || "").trim();
    if (title) roleTitle.textContent = title;

    // The debrief link (#77), offered only once the interview day has arrived. The flag is the
    // route's — derived from the same `interview_at` the debrief route gates on — so the link and
    // the page it opens can never disagree about whether there is anything to write down.
    if (payload.debrief_available === true) debriefCta.hidden = false;

    const { rendered } = renderBlocks(payload, mount);

    // A skipped block is deliberately invisible here. The console already carries it, and a
    // candidate cannot act on "your portal is older than your brief" — but nothing rendering at
    // all is a blank page, and a blank page has to say something.
    if (rendered === 0) showState(COPY.empty, false);
    else clearState();
  })
  .catch((err) => {
    console.error("prep brief: could not render", err);
    showState(COPY.failed, true);
  });
