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

/** #22 replaces this with the token-gated endpoint that reads candidate_role.brief_json.
 *  Until #20's auth lands there is nothing to gate on, and a page that renders a stored
 *  payload is exactly what this ticket asks for. */
const SOURCE = "/prep/brief.fixture.json";

const state = document.getElementById("brief-state");
const mount = document.getElementById("blocks");
const roleTitle = document.getElementById("role-title");

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
    if (!res.ok) throw new Error(`brief: ${res.status}`);
    return res.json();
  })
  .then((payload) => {
    if (!payload || !Array.isArray(payload.blocks)) throw new Error("brief: no blocks");

    // Text, never an HTML-parsing assignment: the title comes out of the payload, which is
    // model output. registry.js holds the same rule for everything below it.
    const title = String(payload.role_title || "").trim();
    if (title) roleTitle.textContent = title;

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
