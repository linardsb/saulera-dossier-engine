// functions/prep/_middleware.js — the lazy-jobs seam itself. The purge must be awaited
// (an expired invite must not serve once more), but the reminder sends have no ordering
// dependency on the response: they ride context.waitUntil, so the one visitor who trips
// a due morning is not held hostage to N Resend calls.
//
// #69 puts a SECOND sweep in that deferred slot — the extension radar — and both are deferred
// for the same reason. The waitUntil count below therefore moves from 1 to 2, deliberately and
// in the same PR as the middleware change rather than as a red run someone discovers.
//
// The radar is registered SECOND, and captured[0] below is still the reminder: this file awaits
// that promise to prove the deferred sweep really sent, and a sweep that bails instantly (no
// RECRUITER_EMAIL in either env here) would make that assertion say nothing. The third test
// makes the independence measurable — the middleware's two catch blocks exist so one broken or
// unconfigured sweep cannot take the other, or the response, down with it.
//
// #70 puts one job in EACH tier, which is what this file's last test is for. Its MAIL half is
// the third deferred sweep, registered last for the reason above, so the waitUntil count moves
// from 2 to 3 — again deliberately and in the same PR. Its STATE half is AWAITED, beside the
// two purges rather than beside the sends, because `compliance_item.status` is what the next
// handler renders: a lapsed certificate must not draw as "Sent in" one last time, which is the
// purge argument at the top of this file at a new root. That half is also the one sweep here
// that depends on NO mail configuration at all, and the test proves both properties at once.

import { test } from "node:test";
import assert from "node:assert/strict";

import { onRequest } from "../functions/prep/_middleware.js";
import { createInvite, hashToken } from "../src/portal/store.js";
import { createAssignment, createCandidate, setItemState } from "../src/compliance/store.js";
import { at, d1Shape, openMigrated, skip } from "./helpers/sqlite-d1.js";

// sent_at is backdated to yesterday because #39 made "sent today" mean "no reminder" — the
// writer stamps NOW, and an un-backdated seed here would leave nothing due, which this
// file's first test would wait on forever (its release loop spins until the send starts).
const seedInvite = async (d1, { id, days }) => {
  const tokenHash = await hashToken(`token-${id}`);
  await createInvite(d1, {
    id,
    clientId: "c-1",
    email: "c@example.com",
    interviewAt: at(days),
    tokenHash,
    expiresAt: at(days + 14),
  });
  await d1.prepare("UPDATE invite SET sent_at = ? WHERE id = ?").bind(at(-1), id).run();
};

test("the response does not wait for the sends: the sweep rides waitUntil", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  await seedInvite(d1, { id: "inv-due", days: 1 });

  // A Resend that never answers until we let it — if the middleware awaited the sweep,
  // onRequest below would hang instead of returning the page.
  const original = globalThis.fetch;
  let release;
  let fetchCalls = 0;
  globalThis.fetch = () => {
    fetchCalls += 1;
    return new Promise((resolve) => {
      release = () => resolve(new Response(JSON.stringify({ id: "msg_1" }), { status: 200 }));
    });
  };
  const captured = [];
  try {
    const response = await onRequest({
      env: { DB: d1, RESEND_API_KEY: "re_test_key", PREP_BASE_URL: "https://engine.pages.dev" },
      next: async () => new Response("page"),
      waitUntil: (promise) => captured.push(promise),
    });
    assert.equal(await response.text(), "page", "answered while the send is still in flight");
    assert.equal(
      captured.length,
      3,
      "all three sends — reminder, extension radar and expiry mail — were handed to waitUntil",
    );

    // The response beat the send to the point that fetch may not even have started yet —
    // let the deferred sweep reach it, then answer.
    while (!release) await new Promise((resolve) => setImmediate(resolve));
    release();
    await captured[0];
    assert.equal(fetchCalls, 1, "and the deferred sweep did send the due reminder");

    // captured[0] must STAY the reminder — this file awaits it to prove the deferred slot really
    // delivers, and a sweep that bails instantly in that slot would make the assertion say
    // nothing. #70's mail is registered last for that reason; with nothing claimed it settles
    // without throwing and without spending a request.
    await captured[2];
    assert.equal(fetchCalls, 1, "the expiry mail had nothing to send, so the quiet day cost nothing");
  } finally {
    globalThis.fetch = original;
  }
});

test("the purge IS awaited: an expired invite is gone before next() runs", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  await seedInvite(d1, { id: "inv-expired", days: -31 });

  const rows = () => db.prepare("SELECT COUNT(*) AS n FROM invite").get().n;
  const response = await onRequest({
    env: { DB: d1 },
    next: async () => new Response(String(rows())),
    waitUntil: () => {},
  });
  assert.equal(await response.text(), "0", "purged before the request was served");
});

test("one unconfigured sweep does not take the other, or the response, down (#69)", { skip }, async () => {
  // The two-catch-blocks argument at the top of the middleware, made measurable. This env is
  // fully configured for the reminder and missing RECRUITER_EMAIL for the radar — the exact
  // state of a deployment the morning #69 ships, before the operator sets the new variable.
  const db = openMigrated();
  const d1 = d1Shape(db);
  await seedInvite(d1, { id: "inv-due", days: 1 });

  // A booking well inside the fourteen-day window, so the radar has something it WOULD claim if
  // it were not bailing. Dates from SQLite's own clock, so the fixture and the query agree.
  const endDate = db.prepare("SELECT date('now', '+7 days') AS d").get().d;
  await createCandidate(d1, { id: "cand-1", fullName: "Priya Nair", email: "p@example.com" });
  await createAssignment(d1, {
    id: "asg-1",
    candidateId: "cand-1",
    clientId: "c-1",
    startDate: db.prepare("SELECT date('now', '-30 days') AS d").get().d,
    endDate,
  });

  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ id: "msg_1" }), { status: 200 });
  const captured = [];
  try {
    const response = await onRequest({
      env: { DB: d1, RESEND_API_KEY: "re_test_key", PREP_BASE_URL: "https://engine.pages.dev" },
      next: async () => new Response("page"),
      waitUntil: (promise) => captured.push(promise),
    });
    assert.equal(await response.text(), "page", "the response served regardless");
    assert.equal(captured.length, 3, "all three sends were still handed over");

    // Neither rejects. A sweep that throws past its own catch would reject here and take the
    // request's waitUntil with it on the real runtime.
    await Promise.all(captured);

    // BAILED BEFORE THE CLAIM, which is the whole guard: nothing was burned, so the radar
    // recovers by itself the moment RECRUITER_EMAIL is set.
    const stamp = db.prepare("SELECT nudge_sent_at FROM assignment WHERE id = 'asg-1'").get();
    assert.equal(stamp.nudge_sent_at, null, "the radar claimed nothing it could not send");

    // And the sweep that WAS configured still did its job.
    const reminded = db.prepare("SELECT reminder_sent_at FROM invite WHERE id = 'inv-due'").get();
    assert.ok(reminded.reminder_sent_at, "the reminder sweep was unaffected by its neighbour");
  } finally {
    globalThis.fetch = original;
  }
});

test("the expiry STATE sweep is awaited, and needs no mail configuration (#70)", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);

  // A certificate that lapsed yesterday. The date comes from SQLite's own clock, so the fixture
  // and the sweep's comparison are the same arithmetic.
  await createCandidate(d1, { id: "cand-1", fullName: "Priya Nair", email: "p@example.com" });
  await setItemState(d1, {
    candidateId: "cand-1",
    itemKey: "immunisations",
    status: "submitted",
    reference: "IMM-2024-118",
    expiryDate: db.prepare("SELECT date('now', '-1 days') AS d").get().d,
  });

  const statusIn = () =>
    db.prepare("SELECT status FROM compliance_item WHERE candidate_id = 'cand-1' AND item_key = 'immunisations'")
      .get().status;

  // NO MAIL CONFIGURATION AT ALL — no RESEND_API_KEY, no PREP_BASE_URL, no RECRUITER_EMAIL. This
  // asserts both halves of #70's one inversion of #69 at once: the state moves anyway (the claim
  // IS the product state the passport renders, so refusing to claim would mean refusing to know),
  // and it has already moved by the time next() runs (the purge argument at the top of this file
  // — a lapsed certificate must not draw as "Sent in" one last time).
  const response = await onRequest({
    env: { DB: d1 },
    next: async () => new Response(statusIn()),
    waitUntil: () => {},
  });
  assert.equal(await response.text(), "expired", "swept before the request was served");
  assert.equal(statusIn(), "expired");
});
