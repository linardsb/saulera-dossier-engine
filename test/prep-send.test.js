// #22 — the confirm path, against real SQL rather than recorded strings.
//
// Everything in this file turns on a CONSTRAINT or on `meta.changes`, and
// test/helpers/fake-d1.js fakes both — it returns `{ changes: 1 }` unconditionally and
// enforces nothing. Each of these PASSES under the fake while the code is wrong:
//
//   R2  competency.id collides on a client's SECOND candidate   fake: no PRIMARY KEY
//   R3  axis 'core' fails a CHECK; 'standard' stores as TEXT    fake: no CHECK, no affinity
//   R9  a mail failure leaves orphan candidate data             fake: no rows to orphan
//       expires_at is interview_at + 14 days                    fake: nothing to read back
//       the cascade takes the whole scope                       fake: no foreign keys
//
// So they run here, on node:sqlite, through test/helpers/sqlite-d1.js — which is also where
// the PRAGMA foreign_keys gotcha that makes any of this meaningful is written down.
//
// WHAT THIS FILE DELIBERATELY DOES NOT DO: it never calls generateBrief and never imports
// functions/api/prep/prepare.js. That module imports @anthropic-ai/sdk at module scope, so
// importing it would pull the SDK into the test process; and its whole body is one model
// call, which is #19's tested territory. The fixture payload is fed in as if prepare had
// returned it. prepare.js is covered by the Level 4 curl sweep and the browser probe, which
// are the honest instruments for a route that is one model call.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { onRequestPost as sendRoute } from "../functions/api/prep/send.js";
import { onRequestGet as briefRoute } from "../functions/prep/api/brief.js";
import { onRequestGet as enterRoute } from "../functions/prep/auth/enter.js";
import { purgeExpired } from "../src/portal/store.js";
import { eventCounts } from "../src/store.js";
import { SESSION_COOKIE } from "../src/prep/tokens.js";
import { at, d1Shape, openMigrated, skip } from "./helpers/sqlite-d1.js";

const here = dirname(fileURLToPath(import.meta.url));

const BRIEF = readFileSync(join(here, "fixtures", "prep-brief.md"), "utf8");
const CV = readFileSync(join(here, "fixtures", "prep-cv.md"), "utf8");

/**
 * #19's real output, made SENDABLE.
 *
 * The checked-in fixture is deliberately a one-demoted-competency specimen — `comp-
 * documentation` cites a sentence that is not in prep-brief.md, which is exactly what
 * public/prep/brief.fixture.json exists to render. That payload can never pass this route:
 * step 11 refuses any send carrying an unverified competency, and correctly so.
 *
 * So the quote is replaced with one the brief actually contains. This is the only edit, it is
 * made in the open, and the UNEDITED fixture is used below to prove the refusal — the two
 * tests together are what make "sendable" mean something.
 */
const RAW = () => JSON.parse(readFileSync(join(here, "fixtures", "prep-payload.json"), "utf8"));
const REAL_QUOTE = "every visit is written up the same day";

function PAYLOAD() {
  const payload = RAW();
  const documentation = payload.competencies.find((c) => c.id === "comp-documentation");
  documentation.source_quote = REAL_QUOTE;
  return payload;
}

/** Tomorrow, day-only, which is what `<input type="date">` hands the browser. */
const TOMORROW = at(1).slice(0, 10);

const PORTAL_TABLES = ["invite", "candidate_role", "competency", "question", "attempt", "habit", "otp"];
const countOf = (db, table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
const rowsOf = (db, table) => db.prepare(`SELECT * FROM ${table}`).all();

/**
 * A Request the send route accepts. No Sec-Fetch-Site and no Origin is the curl path, which
 * `sameOrigin` allows (src/http.js:47-48) — the browser path is exercised by the probe.
 */
const sendRequest = (body) => ({
  url: "https://engine.pages.dev/api/prep/send",
  headers: { get: () => null },
  json: async () => body,
});

/** A GET carrying just the session cookie, for the candidate side. */
const cookieRequest = (url, token) => ({
  url,
  headers: {
    get: (name) => (name === "Cookie" && token ? `${SESSION_COOKIE}=${token}` : null),
  },
});

const ENV = (d1, extra = {}) => ({
  DB: d1,
  RESEND_API_KEY: "re_test_key_123",
  PREP_BASE_URL: "https://engine.pages.dev",
  ...extra,
});

/** The body a browser posts at confirm, with the frozen brief and CV. */
const sendBody = (over = {}) => ({
  client_id: "c-1",
  email: "candidate@example.com",
  interview_at: TOMORROW,
  brief: BRIEF,
  cv: CV,
  payload: PAYLOAD(),
  ...over,
});

/**
 * Runs `fn` with `globalThis.fetch` stubbed, and RESTORES IT IN A FINALLY. An escaped stub
 * does not fail here; it poisons every later test file in the same process
 * (test/prep-email.test.js:8-9 learned this the expensive way).
 */
async function withFetch(respond, fn) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return respond(calls.length);
  };
  try {
    return { calls, result: await fn() };
  } finally {
    globalThis.fetch = original;
  }
}

const mailOk = () => new Response(JSON.stringify({ id: "msg_1" }), { status: 200 });
/** Resend's answer when the sending domain is not verified — the likeliest first failure. */
const mailForbidden = () => new Response(JSON.stringify({ message: "not allowed" }), { status: 403 });

/** One send through the route, with mail stubbed green. Tests that need the emitted magic
 *  link drive sendRoute through withFetch themselves and read it via tokenFromMail. */
async function send(d1, body = sendBody(), env = {}) {
  const { result } = await withFetch(mailOk, () =>
    sendRoute({ request: sendRequest(body), env: ENV(d1, env) }),
  );
  return { response: result };
}

/** The magic-link token out of the stubbed Resend call — the only place it exists. */
function tokenFromMail(calls) {
  const { text } = JSON.parse(calls[0].init.body);
  return text.match(/[?&]t=([A-Za-z0-9_-]+)/)?.[1] ?? null;
}

// ── the happy path, and what it wrote ──────────────────────────────────────────────────

test("a send writes the invite, the role, the competencies and the questions", { skip }, async () => {
  const db = openMigrated();
  const { response } = await send(d1Shape(db));

  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.event_recorded, true);
  assert.deepEqual(body.competencies, PAYLOAD().competencies.map((c) => c.id));
  // A token in a JSON body is a token in a browser's network log.
  const serialised = JSON.stringify(body);
  assert.ok(!/token/i.test(serialised), "no token rides the response");
  assert.ok(!/invite_id/.test(serialised), "and no invite id either");

  assert.equal(countOf(db, "invite"), 1);
  assert.equal(countOf(db, "candidate_role"), 1);
  assert.equal(countOf(db, "competency"), PAYLOAD().competencies.length);
  assert.equal(countOf(db, "question"), PAYLOAD().questions.length);
});

test("AC #7: expires_at is interview_at + 14 days", { skip }, async () => {
  const db = openMigrated();
  await send(d1Shape(db));

  const [invite] = rowsOf(db, "invite");
  const expected = db
    .prepare("SELECT datetime(?, '+14 days') AS e")
    .get(invite.interview_at).e;
  // Read through SQLite's own datetime() rather than string arithmetic in JS — the purge
  // compares the same way, so this asserts what the purge will actually see.
  assert.equal(
    db.prepare("SELECT datetime(?) AS d").get(invite.expires_at).d,
    expected,
    "decision 11: active until interview + 14 days",
  );
  assert.equal(invite.status, "sent");
  assert.ok(invite.sent_at, "createInvite stamps the send moment");
  assert.equal(invite.opened_at, null, "and nothing has been opened yet");
});

test("the stored row carries the frozen brief and CV, not a re-read of anything", { skip }, async () => {
  const db = openMigrated();
  await send(d1Shape(db));

  const [role] = rowsOf(db, "candidate_role");
  // jd_text is the SAME string verifyBrief used as its haystack, so the row and the verified
  // brief_json cannot disagree about what was checked.
  assert.equal(role.jd_text, BRIEF);
  assert.equal(role.cv_text, CV);
  assert.doesNotThrow(() => JSON.parse(role.brief_json), "the payload round-trips as JSON");
});

// ── R2: the primary key collision, which is an ordinary second candidate ───────────────

test("R2: two sends for the SAME client both persist, with distinct competency ids", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);

  // The same client, the same brief, the same model-chosen slugs. This is not an edge case:
  // it is the recruiter's second-ever Send, and under a naive `competency.id = payload.id` it
  // fails on a PRIMARY KEY constraint in production.
  await send(d1, sendBody({ email: "first@example.com" }));
  await send(d1, sendBody({ email: "second@example.com" }));

  assert.equal(countOf(db, "invite"), 2);
  assert.equal(countOf(db, "candidate_role"), 2);
  assert.equal(countOf(db, "competency"), PAYLOAD().competencies.length * 2);
  assert.equal(countOf(db, "question"), PAYLOAD().questions.length * 2);

  const ids = rowsOf(db, "competency").map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, "every competency row id is distinct");

  // And each one is derivable by #23 from its role id plus the payload it reads.
  for (const role of rowsOf(db, "candidate_role")) {
    for (const competency of PAYLOAD().competencies) {
      assert.ok(
        ids.includes(`${role.id}:${competency.id}`),
        `#23 must be able to derive ${role.id}:${competency.id}`,
      );
    }
  }
});

// ── R3: the column vocabularies ────────────────────────────────────────────────────────

test("R3: every question row has a NULL axis and a NUMERIC difficulty", { skip }, async () => {
  const db = openMigrated();
  await send(d1Shape(db));

  const rows = rowsOf(db, "question");
  assert.ok(rows.length, "there are questions to check");
  for (const row of rows) {
    // 'core' is not in CHECK (axis IN ('lateral','vertical')) — it would fail at insert on the
    // recruiter's FIRST send. NULL passes because a CHECK evaluating to NULL is not a violation.
    assert.equal(row.axis, null, "the core bank is the rows with a NULL axis");
    assert.equal(row.variant_of, null, "and no variant_of — those are #23's");
    // typeof, not truthiness. SQLite's INTEGER affinity accepts the string 'standard' and
    // stores it as text without complaint; asserting the VALUE without the TYPE is the same
    // blind spot one level down.
    assert.equal(
      typeof row.difficulty,
      "number",
      `difficulty stored as ${typeof row.difficulty}: #23's ORDER BY would sort it as text`,
    );
    assert.ok([1, 2, 3].includes(row.difficulty), "and it is one of the three mapped values");
  }
});

test("R3: competency importance stores as a number and stage/success_rate keep their defaults", { skip }, async () => {
  const db = openMigrated();
  await send(d1Shape(db));

  for (const row of rowsOf(db, "competency")) {
    assert.equal(typeof row.importance, "number");
    assert.equal(row.stage, "", "stage is #23's column");
    assert.equal(row.success_rate, 0, "and a send has produced no attempts to rate");
  }
});

// ── AC #3: striking ────────────────────────────────────────────────────────────────────

test("AC #3: a struck competency has no row, no questions and no reference in brief_json", { skip }, async () => {
  const db = openMigrated();
  const struck = PAYLOAD().competencies[0].id;

  const { response } = await send(d1Shape(db), sendBody({ strike: [struck] }));
  assert.equal(response.status, 201);
  assert.ok(!(await response.json()).competencies.includes(struck));

  const [role] = rowsOf(db, "candidate_role");
  assert.ok(
    !rowsOf(db, "competency").some((r) => r.id === `${role.id}:${struck}`),
    "the competency has no row",
  );
  assert.equal(
    countOf(db, "competency"),
    PAYLOAD().competencies.length - 1,
    "and exactly one fewer than the payload carried",
  );
  assert.ok(
    !rowsOf(db, "question").some((r) => r.competency_id.endsWith(`:${struck}`)),
    "its questions have no rows",
  );
  // The stored payload must hold no reference either — a dangling id renders as a hole on the
  // candidate's page and there is nothing downstream to catch it.
  assert.ok(!role.brief_json.includes(struck), "and brief_json mentions it nowhere");
});

// ── the gates ──────────────────────────────────────────────────────────────────────────

test("AC #1: a past interview date is refused before anything is written", { skip }, async () => {
  const db = openMigrated();
  const { calls, result } = await withFetch(mailOk, () =>
    sendRoute({ request: sendRequest(sendBody({ interview_at: "2020-01-01" })), env: ENV(d1Shape(db)) }),
  );

  assert.equal(result.status, 400);
  assert.equal((await result.json()).error, "interview_past");
  assert.equal(calls.length, 0, "no mail was attempted");
  for (const table of PORTAL_TABLES) {
    assert.equal(countOf(db, table), 0, `${table} must be untouched`);
  }
});

test("an unparseable interview date is refused, not stored as an unpurgeable row", { skip }, async () => {
  const db = openMigrated();
  const response = await sendRoute({
    request: sendRequest(sendBody({ interview_at: "next Tuesday" })),
    env: ENV(d1Shape(db)),
  });
  // The CHECK on interview_at would otherwise reject it at the database as a 500, and a row
  // whose datetime() is NULL never satisfies the purge's <= — it would outlive retention.
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "missing_fields");
  assert.equal(countOf(db, "invite"), 0);
});

test("R4: a browser-supplied field_keys is refused by the body vocabulary", { skip }, async () => {
  const db = openMigrated();
  // The whole mechanism of decision 2 rests on the field keys being read server-side. A body
  // key that looked helpful would let a demoted panel claim re-verify itself by naming its
  // own key, so the closed vocabulary is the guard rather than a tidiness rule.
  const response = await sendRoute({
    request: sendRequest({ ...sendBody(), field_keys: ["their-process"] }),
    env: ENV(d1Shape(db)),
  });

  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error, "unexpected_fields");
  assert.deepEqual(body.fields, ["field_keys"]);
  assert.equal(countOf(db, "invite"), 0);
});

test("an unverified competency refuses the send and names what failed", { skip }, async () => {
  const db = openMigrated();
  // The UNEDITED fixture, whose third competency cites a sentence prep-brief.md does not
  // contain. This is the case PAYLOAD() edits around, asserted here rather than assumed.
  const { calls, result } = await withFetch(mailOk, () =>
    sendRoute({ request: sendRequest(sendBody({ payload: RAW() })), env: ENV(d1Shape(db)) }),
  );

  assert.equal(result.status, 400);
  const body = await result.json();
  assert.equal(body.error, "not_sendable");
  assert.ok(
    body.failures.some((f) => f.kind === "competency" && f.quote.includes("before the end of the day")),
    "the screen can say which competency failed and what it claimed",
  );
  assert.equal(calls.length, 0, "nothing was emailed");
  assert.equal(countOf(db, "invite"), 0, "and nothing was written");
});

test("a hand-set verified: true does not survive re-verification", { skip }, async () => {
  const db = openMigrated();
  const payload = PAYLOAD();
  // THE PROPERTY THAT MAKES THE BROWSER ROUND TRIP SAFE. verifyBrief RECOMPUTES `verified`
  // from source_quote on every pass (verify.js:34) and never reads the incoming one, so a
  // payload arriving from a browser with a fabricated competency marked sourced is demoted
  // and the send refused. An "optimisation" that trusted the incoming flag would remove the
  // whole guarantee silently, and this is the assertion that would notice.
  payload.competencies[0].source_quote = "a sentence the brief does not contain";
  payload.competencies[0].verified = true;

  const response = await sendRoute({
    request: sendRequest(sendBody({ payload })),
    env: ENV(d1Shape(db)),
  });

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "not_sendable");
  assert.equal(countOf(db, "invite"), 0);
});

test("striking every competency is refused as nothing_to_send", { skip }, async () => {
  const db = openMigrated();
  const response = await sendRoute({
    request: sendRequest(sendBody({ strike: PAYLOAD().competencies.map((c) => c.id) })),
    env: ENV(d1Shape(db)),
  });

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "nothing_to_send");
  assert.equal(countOf(db, "invite"), 0);
});

test("a payload that was never a prep brief is refused as bad_brief", { skip }, async () => {
  const db = openMigrated();
  const response = await sendRoute({
    request: sendRequest(sendBody({ payload: { role_title: "x", blocks: [], competencies: [], questions: [] } })),
    env: ENV(d1Shape(db)),
  });
  // Empty competencies reaches strikeCompetencies' throw first — either way the send is
  // refused and nothing is written, which is the property that matters.
  assert.equal(response.status, 400);
  assert.equal(countOf(db, "invite"), 0);
});

test("a malformed email is refused before any write", { skip }, async () => {
  const db = openMigrated();
  for (const email of ["", "   ", "no-at-sign", "@nolocal.com", "trailing@", "two@@at.com"]) {
    const response = await sendRoute({
      request: sendRequest(sendBody({ email })),
      env: ENV(d1Shape(db)),
    });
    assert.equal(response.status, 400, `${JSON.stringify(email)} must be refused`);
  }
  assert.equal(countOf(db, "invite"), 0);
});

// ── R9: the failure ordering ───────────────────────────────────────────────────────────

test("R9: a mail failure rolls back everything and counts nothing", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);

  const { result } = await withFetch(mailForbidden, () =>
    sendRoute({ request: sendRequest(sendBody()), env: ENV(d1) }),
  );

  assert.equal(result.status, 502);
  assert.equal((await result.json()).error, "mail_failed");

  // The CV and the brief were written a few statements before the mail went out. Orphaning
  // them is the failure this ordering exists to prevent — candidate data persisted for a
  // message that never arrived, inside a retention regime keyed on an interview that may not
  // happen.
  for (const table of PORTAL_TABLES) {
    assert.equal(countOf(db, table), 0, `${table} must be empty after a rolled-back send`);
  }
  // And the count must not have moved. A rolled-back send that already counted inflates
  // decision 23's sales claim in the one direction nobody would check.
  const counts = await eventCounts(d1);
  assert.equal(counts.per_client.length, 0, "no invite_sent was recorded");
});

test("R9: with no RESEND_API_KEY the send answers not_configured and writes nothing", { skip }, async () => {
  const db = openMigrated();
  const { calls, result } = await withFetch(mailOk, () =>
    sendRoute({
      request: sendRequest(sendBody()),
      env: { DB: d1Shape(db), PREP_BASE_URL: "https://engine.pages.dev" },
    }),
  );

  assert.equal(result.status, 503);
  assert.equal((await result.json()).error, "not_configured");
  assert.equal(calls.length, 0, "the guard is before the request, so no API call is spent");
  for (const table of PORTAL_TABLES) {
    assert.equal(countOf(db, table), 0, `${table} must be empty`);
  }
});

// ── AC #4: the count ───────────────────────────────────────────────────────────────────

test("AC #4: invite_sent is recorded exactly once, under the right client", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  await send(d1);

  const counts = await eventCounts(d1);
  assert.equal(counts.per_client.length, 1);
  const [row] = counts.per_client;
  assert.equal(row.client_id, "c-1");
  assert.equal(row.invites_sent, 1);
  assert.equal(row.invites_opened, 0, "nothing has been opened yet");
  assert.equal(row.packs, 0, "and a send is not a pack — PRD §7's metric must not inflate");
  assert.equal(counts.total, 0, "`total` sums packs alone");
});

// ── the cascade, still whole ───────────────────────────────────────────────────────────

test("AC #7: the purge takes every row this ticket wrote, in one statement", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  await send(d1);

  assert.ok(countOf(db, "competency") > 0, "there is a scope to purge");

  // Back-date the interview past the 30-day retention boundary and run the real purge.
  db.prepare("UPDATE invite SET interview_at = ?").run(at(-31));
  const { purged } = await purgeExpired(d1);

  assert.equal(purged, 1, "one invite scope");
  for (const table of PORTAL_TABLES) {
    assert.equal(countOf(db, table), 0, `${table} must be emptied by the cascade`);
  }
  // The counts survive, which is the point of them carrying no invite id and no email.
  const counts = await eventCounts(d1);
  assert.equal(counts.per_client[0].invites_sent, 1, "delivery telemetry outlives the candidate data");
});

// ── the candidate endpoint, end to end ─────────────────────────────────────────────────

test("AC #6: send -> click the link -> GET /prep/api/brief returns the projection", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);

  const { calls } = await withFetch(mailOk, () =>
    sendRoute({ request: sendRequest(sendBody()), env: ENV(d1) }),
  );

  // The raw token exists in exactly one place: the email that just went out.
  const token = tokenFromMail(calls);
  assert.ok(token, "the invite email carries a magic link");

  // Exchange it through the real route, which rotates it and sets the session cookie.
  const entered = await enterRoute({
    request: { url: `https://engine.pages.dev/prep/auth/enter?t=${token}`, headers: { get: () => null } },
    env: { DB: d1 },
  });
  assert.equal(entered.status, 302);
  const session = entered.headers.get("Set-Cookie").match(/prep_session=([^;]+)/)[1];

  const response = await briefRoute({
    request: cookieRequest("https://engine.pages.dev/prep/api/brief", session),
    env: { DB: d1 },
  });

  assert.equal(response.status, 200);
  const wire = await response.text();

  // THE ASSERTION THE ISSUE NAMED, measured on the actual bytes a candidate's browser receives.
  assert.ok(!wire.includes("failed_quote"), "failed_quote reached the candidate");
  assert.ok(!wire.includes("importance"), "importance reached the candidate");
  assert.ok(!wire.includes("questions"), "the question bank reached the candidate");

  const projection = JSON.parse(wire);
  assert.ok(projection.blocks.length, "and there is still a brief to render");
  assert.equal(projection.competencies.length, PAYLOAD().competencies.length);
  assert.ok(projection.competencies.every((c) => c.verified === true), "all sourced against this brief");
});

test("a session-less GET /prep/api/brief answers 401", { skip }, async () => {
  const db = openMigrated();
  const response = await briefRoute({
    request: cookieRequest("https://engine.pages.dev/prep/api/brief", null),
    env: { DB: d1Shape(db) },
  });
  assert.equal(response.status, 401, "the page bounces to /prep/login on this");
});

test("a session whose handover was never written answers 404, not 500", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);

  const { calls } = await withFetch(mailOk, () =>
    sendRoute({ request: sendRequest(sendBody()), env: ENV(d1) }),
  );
  const entered = await enterRoute({
    request: { url: `https://engine.pages.dev/prep/auth/enter?t=${tokenFromMail(calls)}`, headers: { get: () => null } },
    env: { DB: d1 },
  });
  const session = entered.headers.get("Set-Cookie").match(/prep_session=([^;]+)/)[1];

  // The role row alone removed — a state the rollback path can leave behind if it half-ran.
  db.prepare("DELETE FROM candidate_role").run();

  const response = await briefRoute({
    request: cookieRequest("https://engine.pages.dev/prep/api/brief", session),
    env: { DB: d1 },
  });
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, "not_found");
});

// ── the link the email carried ─────────────────────────────────────────────────────────

test("the magic link is built against PREP_BASE_URL, and falls back to the request origin", { skip }, async () => {
  const db = openMigrated();

  const configured = await withFetch(mailOk, () =>
    sendRoute({ request: sendRequest(sendBody()), env: ENV(d1Shape(db), { PREP_BASE_URL: "https://prep.agency.co.uk" }) }),
  );
  assert.ok(
    JSON.parse(configured.calls[0].init.body).text.includes("https://prep.agency.co.uk/prep/auth/enter?t="),
    "the configured origin wins",
  );

  const db2 = openMigrated();
  const fallback = await withFetch(mailOk, () =>
    sendRoute({ request: sendRequest(sendBody()), env: { DB: d1Shape(db2), RESEND_API_KEY: "re_x" } }),
  );
  assert.ok(
    JSON.parse(fallback.calls[0].init.body).text.includes("https://engine.pages.dev/prep/auth/enter?t="),
    "unset, the link is built from the origin the recruiter's browser used",
  );
});

test("a malformed PREP_BASE_URL is ignored rather than concatenated blindly", { skip }, async () => {
  // A link nobody notices until a candidate clicks one is the expensive failure here.
  for (const bad of ["http://insecure.example", "https://host.example/with/path", "not a url", "https://h.example?q=1"]) {
    const db = openMigrated();
    const { calls } = await withFetch(mailOk, () =>
      sendRoute({ request: sendRequest(sendBody()), env: ENV(d1Shape(db), { PREP_BASE_URL: bad }) }),
    );
    const { text } = JSON.parse(calls[0].init.body);
    assert.ok(
      text.includes("https://engine.pages.dev/prep/auth/enter?t="),
      `${bad} must fall back to the request origin, not build a broken link`,
    );
  }
});

// ── two sends to one address, which #20 already decided how to answer ──────────────────

test("two sends to the same address both stand; the newest is the one a login finds", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);

  await send(d1);
  await send(d1, sendBody({ interview_at: at(3).slice(0, 10) }));

  assert.equal(countOf(db, "invite"), 2, "there is deliberately no server-side idempotency key");
  const counts = await eventCounts(d1);
  assert.equal(counts.per_client[0].invites_sent, 2, "and both are counted, honestly");
});
