// functions/prep/_middleware.js — the lazy-jobs seam itself. The purge must be awaited
// (an expired invite must not serve once more), but the reminder sends have no ordering
// dependency on the response: they ride context.waitUntil, so the one visitor who trips
// a due morning is not held hostage to N Resend calls.

import { test } from "node:test";
import assert from "node:assert/strict";

import { onRequest } from "../functions/prep/_middleware.js";
import { createInvite, hashToken } from "../src/portal/store.js";
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
    assert.equal(captured.length, 1, "the sweep was handed to waitUntil");

    // The response beat the send to the point that fetch may not even have started yet —
    // let the deferred sweep reach it, then answer.
    while (!release) await new Promise((resolve) => setImmediate(resolve));
    release();
    await captured[0];
    assert.equal(fetchCalls, 1, "and the deferred sweep did send the due reminder");
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
