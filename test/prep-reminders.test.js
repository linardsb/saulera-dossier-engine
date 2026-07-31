// #25 — the one-reminder sweep, end to end on real sqlite-d1 with a stubbed Resend.
//
// Everything here MUST run on node:sqlite, never fake-d1: `claimReminder` branches on
// `meta.changes`, and the fake returns `{changes: 1}` unconditionally — the exact trap
// test/helpers/sqlite-d1.js's header documents. The class of failure this file pins is
// decision 17's: a candidate must receive exactly ONE reminder, ever, whatever races,
// outages or re-sweeps happen around it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { createInvite, hashToken, dueReminders, claimReminder } from "../src/portal/store.js";
import { sendDueReminders } from "../src/prep/reminders.js";
import { at, d1Shape, openMigrated, skip } from "./helpers/sqlite-d1.js";

const BASE = "https://engine.pages.dev";

/**
 * Runs `fn` with fetch replaced by a recorder (prep-email.test.js's pattern). `respond`
 * builds the Response each call answers with.
 */
async function withFetch(respond, fn) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return respond(calls.length);
  };
  try {
    return { calls, result: await fn().catch((error) => ({ error })) };
  } finally {
    globalThis.fetch = original;
  }
}

const ok = () => new Response(JSON.stringify({ id: "msg_1" }), { status: 200 });

/** An invite seeded through the production writer, interview `days` out. */
async function seedInvite(d1, { id = "inv-1", days = 1, email = "c@example.com" } = {}) {
  await createInvite(d1, {
    id,
    clientId: "c-1",
    email,
    interviewAt: at(days),
    tokenHash: await hashToken(`token-${id}`),
    expiresAt: at(days + 14),
  });
}

const ENV = (d1) => ({ DB: d1, RESEND_API_KEY: "re_test_key", PREP_BASE_URL: BASE });

const reminderStamp = (db, id) =>
  db.prepare("SELECT reminder_sent_at FROM invite WHERE id = ?").get(id).reminder_sent_at;

test("sends exactly once: a second sweep over the same invite mails nothing", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  await seedInvite(d1);

  const { calls } = await withFetch(ok, async () => {
    await sendDueReminders(ENV(d1));
    await sendDueReminders(ENV(d1));
  });

  assert.equal(calls.length, 1, "one Resend call across two sweeps");
  assert.ok(reminderStamp(db, "inv-1"), "the claim column is set");

  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.to, "c@example.com");
  assert.ok(body.text.includes(`${BASE}/prep/login`), "the portal-entry link, bare in the text half");
  assert.ok(!JSON.stringify(body).includes("t="), "no token-shaped query param anywhere");
});

test("the due window is strictly tomorrow: day-of, two days out and past all stay silent", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  await seedInvite(d1, { id: "inv-today", days: 0 });
  await seedInvite(d1, { id: "inv-two", days: 2 });
  await seedInvite(d1, { id: "inv-past", days: -1 });

  const { calls } = await withFetch(ok, () => sendDueReminders(ENV(d1)));
  assert.equal(calls.length, 0, "only days === 1 is 'tomorrow'");
  for (const id of ["inv-today", "inv-two", "inv-past"]) {
    assert.equal(reminderStamp(db, id), null, `${id} is unclaimed`);
  }
});

test("the claim race has exactly one winner", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  await seedInvite(d1);

  const first = await claimReminder(d1, "inv-1");
  const second = await claimReminder(d1, "inv-1");
  assert.equal(first, true, "the first claim lands");
  assert.equal(second, false, "the loser sees changes === 0 and skips");
});

test("a failed send claims anyway — at-most-once is the pinned behaviour", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  await seedInvite(d1);

  const fail = () => new Response(JSON.stringify({ message: "boom" }), { status: 500 });
  const { calls } = await withFetch(fail, async () => {
    await sendDueReminders(ENV(d1));
    await sendDueReminders(ENV(d1));
  });

  assert.equal(calls.length, 1, "one attempt across two sweeps — no retry after the claim");
  assert.ok(reminderStamp(db, "inv-1"), "claimed despite the 500: never rolled back");
});

test("unconfigured means no claim: the sweep bails BEFORE spending the one reminder", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  await seedInvite(d1);

  for (const env of [
    { DB: d1, PREP_BASE_URL: BASE }, // no key
    { DB: d1, RESEND_API_KEY: "re_test_key" }, // no base url
    { DB: d1, RESEND_API_KEY: "re_test_key", PREP_BASE_URL: "http://insecure.example" }, // not https
  ]) {
    const { calls } = await withFetch(ok, () => sendDueReminders(env));
    assert.equal(calls.length, 0, "nothing sent");
    assert.equal(reminderStamp(db, "inv-1"), null, "and, crucially, nothing claimed");
  }
});

test("no further email, ever: the next day's sweep sends nothing, opened or not", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  // Never opened — decision 17's one reminder still goes, and only the one.
  await seedInvite(d1);
  assert.equal(db.prepare("SELECT opened_at FROM invite WHERE id = 'inv-1'").get().opened_at, null);

  const first = await withFetch(ok, () => sendDueReminders(ENV(d1)));
  assert.equal(first.calls.length, 1, "the never-opened invite gets its one reminder");

  // Tomorrow arrives: the interview is now day-of. Nothing more, ever.
  db.prepare("UPDATE invite SET interview_at = ? WHERE id = 'inv-1'").run(at(0));
  const second = await withFetch(ok, () => sendDueReminders(ENV(d1)));
  assert.equal(second.calls.length, 0, "decision 17: no other nudge exists");
});

test("dueReminders selects id and email and nothing else", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  await seedInvite(d1);
  const due = await dueReminders(d1);
  assert.equal(due.length, 1);
  assert.deepEqual(Object.keys(due[0]).sort(), ["email", "id"], "data minimisation, structurally");
});

test("the copy passes the tone gate: no exclamation, no streak, the subject exact", { skip }, async () => {
  const db = openMigrated();
  const d1 = d1Shape(db);
  await seedInvite(d1);

  const { calls } = await withFetch(ok, () => sendDueReminders(ENV(d1)));
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.subject, "Your interview is tomorrow");
  for (const [part, content] of Object.entries({ text: body.text, html: body.html })) {
    assert.ok(!content.includes("!"), `no exclamation mark in the ${part} half`);
    assert.ok(!/streak|don't forget|dont forget/i.test(content), `no guilt language in the ${part} half`);
  }
});
