// #22 step one — the route that spends the ~30p Opus call, and the two things about it that
// nothing else executes.
//
// This file exists because the PR #32 review found `functions/api/prep/prepare.js` had NO test
// of any kind: test/prep-send.test.js says in its header that it deliberately does not import
// this module, the browser probes stub the route with a canned body, and the curl sweep only
// ever exercised the past-date 400. So AC #2's data-minimisation on the RECRUITER side — the
// one line keeping the client note's TEXT out of the recruiter's browser — had no assertion at
// all, while the identical rule on the candidate side got a whole test file.
//
// TWO REGISTERS, and the split is not arbitrary.
//
//   1. THE ROUTE, DRIVEN FOR REAL. Every guard that returns BEFORE the model call is reachable
//      here: the module imports the SDK at its top, but constructing a client happens inside
//      the handler after all six guards, so importing this file costs a package load and no
//      network. That is what makes `sameOrigin` — deleted from both new routes and still green
//      in the review's mutation run — assertable.
//
//   2. A SOURCE SCAN for the projection. That line sits AFTER the model call, so reaching it
//      would mean faking @anthropic-ai/sdk's streaming wire format — a test coupled to a third
//      party's transport, which is the kind that rots into a false green. The constraint
//      decision 2 imposes is on WHAT THIS FILE IS ALLOWED TO SEND, which is a property of the
//      source text. test/counts.test.js:3-7 makes exactly this argument about counts.js, and
//      test/prep-registry.test.js's group 2 is the same move.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { onRequestPost as prepareRoute } from "../functions/api/prep/prepare.js";
import { at, d1Shape, openMigrated, skip } from "./helpers/sqlite-d1.js";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "functions", "api", "prep", "prepare.js"), "utf8");

const TOMORROW = at(1).slice(0, 10);

/** The curl path: no Sec-Fetch-Site and no Origin, which `sameOrigin` allows by design. */
const request = (body, headers = {}) => ({
  url: "https://engine.pages.dev/api/prep/prepare",
  headers: { get: (name) => headers[name] ?? null },
  json: async () => body,
});

const body = (over = {}) => ({
  client_id: "c-1",
  brief: "Band 6 community nurse. Current NMC pin required.",
  cv: "Registered nurse. NMC registration current to Mar 2027.",
  interview_at: TOMORROW,
  ...over,
});

const ENV = (d1, extra = {}) => ({ DB: d1, ANTHROPIC_API_KEY: "sk-ant-test", ...extra });

async function codeOf(response) {
  return { status: response.status, error: (await response.json()).error };
}

/* ── the guards that run before a penny is spent ────────────────────────────────────────── */

test("a cross-site POST is refused, and never reaches the model call", { skip }, async () => {
  // THE ONE THE REVIEW PROVED UNEXECUTED: every existing test passes `headers: {get: () => null}`,
  // which is the curl path `sameOrigin` allows on purpose — so deleting the check from this
  // route left the suite green. Cloudflare Access is the door and it authenticates with a
  // cookie; this is the bolt against a cross-site POST riding it (src/http.js:36-39).
  const db = openMigrated();
  const cross = await prepareRoute({
    request: request(body(), { "Sec-Fetch-Site": "cross-site" }),
    env: ENV(d1Shape(db)),
  });
  assert.deepEqual(await codeOf(cross), { status: 403, error: "cross_origin" });

  // And the browser's own same-origin POST is NOT refused, so the bolt is a bolt and not a wall.
  const same = await prepareRoute({
    request: request(body({ interview_at: "2020-01-01" }), { "Sec-Fetch-Site": "same-origin" }),
    env: ENV(d1Shape(db)),
  });
  assert.equal(same.status, 400, "same-origin gets past the bolt and is judged on its content");
  assert.equal((await same.json()).error, "interview_past");
});

test("the body vocabulary is closed, so field_keys can never become a suggestion", { skip }, async () => {
  // `field_keys` is the key a well-meaning change would add here "so the client does not have to
  // look them up twice". Answering 400 is what keeps decision 2's gate a database read.
  const db = openMigrated();
  const response = await prepareRoute({
    request: request({ ...body(), field_keys: ["their-process"] }),
    env: ENV(d1Shape(db)),
  });
  assert.equal(response.status, 400);
  const answered = await response.json();
  assert.equal(answered.error, "unexpected_fields");
  assert.deepEqual(answered.fields, ["field_keys"]);
});

test("both ends of the interview date are refused before the model call", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);

  assert.deepEqual(
    await codeOf(await prepareRoute({ request: request(body({ interview_at: "2020-01-01" })), env: ENV(d1) })),
    { status: 400, error: "interview_past" },
  );
  // The far end matters as much: the interview date is the clock the 30-day purge runs on, and
  // this route refuses a mistyped year so the ~30p call is never spent on one.
  assert.deepEqual(
    await codeOf(await prepareRoute({ request: request(body({ interview_at: "2226-08-12" })), env: ENV(d1) })),
    { status: 400, error: "interview_too_far" },
  );
  assert.deepEqual(
    await codeOf(await prepareRoute({ request: request(body({ interview_at: "2027-02-31" })), env: ENV(d1) })),
    { status: 400, error: "missing_fields" },
  );
});

test("a missing binding or key is answered before anything else is read", { skip }, async () => {
  const db = openMigrated();
  assert.deepEqual(
    await codeOf(await prepareRoute({ request: request(body()), env: { ANTHROPIC_API_KEY: "sk-ant-test" } })),
    { status: 503, error: "not_configured" },
  );
  assert.deepEqual(
    await codeOf(await prepareRoute({ request: request(body()), env: { DB: d1Shape(db) } })),
    { status: 503, error: "no_model_key" },
  );
});

test("an unknown client is a 404 before the model call, not after it", { skip }, async () => {
  const db = openMigrated();
  const response = await prepareRoute({
    request: request(body({ client_id: "nope" })),
    env: ENV(d1Shape(db)),
  });
  assert.deepEqual(await codeOf(response), { status: 404, error: "not_found" });
});

/* ── AC #2, recruiter side: headings and counts, never the section text ─────────────────── */

test("the visible_fields projection carries key, heading and chars — and nothing else", () => {
  // THE ASSERTION THAT WAS MISSING. This one line is all that keeps the client note's TEXT out
  // of the recruiter's browser on this screen, and adding `text` to it would have passed the
  // whole suite, the probes and the curl sweep. The recruiter is one link away from the note on
  // /clients; a second copy of business-context personal data on a second screen widens where it
  // appears for one click of convenience.
  const projection = source.match(/visible_fields:\s*slice\.map\(\(\{([^}]*)\}\)/);
  assert.ok(projection, "the response still projects the slice rather than sending it whole");

  const fields = projection[1].split(",").map((f) => f.trim()).filter(Boolean);
  assert.deepEqual(
    fields.sort(),
    ["chars", "heading", "key"],
    "exactly three fields. `text` here would ship every ticked section's body to the browser.",
  );

  // And the whole slice must not travel by another name alongside it.
  assert.doesNotMatch(
    source,
    /visible_fields:\s*slice\s*[,}]/,
    "`visible_fields: slice` sends every field's text, which is the same leak with no map to read",
  );
});

test("the client note appears in this file exactly once, as the gate's first argument", () => {
  // src/note-fields.js:5-12 states the rule and a Level 1 grep enforces it; this is the same
  // rule as a test, so it survives a refactor that moves the grep. A bug of omission must hide,
  // never leak — which is only true while `.note` cannot be read except through visibleFields.
  const noteReads = [...source.matchAll(/\.note\b/g)];
  assert.equal(noteReads.length, 1, "one read, and it is the argument below");
  assert.match(source, /visibleFields\(client\.note,/);
});
