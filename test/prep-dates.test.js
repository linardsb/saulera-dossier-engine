// #22 — the interview date, and the retention window hung off it.
//
// The class of failure this file catches is an hour. Every assertion below passes with a
// naive `new Date(string)` implementation when the machine running it is on UTC, and fails
// in London between late March and late October — which is when the pilot runs. A CI box on
// UTC would report green for the entire British summer while invites expired an hour early.
// So every test injects its own `now` and its own stamps rather than reading the wall clock,
// exactly as test/prep-tokens.test.js:156-158 argues for maxAgeFrom.

import { test } from "node:test";
import assert from "node:assert/strict";

import { addDays, isNotPast, toSqliteUtc } from "../src/prep/dates.js";
import { maxAgeFrom } from "../src/prep/tokens.js";
import { StoreError } from "../src/store.js";

test("toSqliteUtc turns what <input type=\"date\"> gives into midnight UTC", () => {
  assert.equal(toSqliteUtc("2026-08-12"), "2026-08-12 00:00:00");
  assert.equal(toSqliteUtc("  2026-08-12  "), "2026-08-12 00:00:00", "surrounding space is trimmed");
});

test("toSqliteUtc is idempotent, which the confirm step depends on", () => {
  // prepare normalises the date, the browser posts it back, and confirm normalises it again.
  // A second pass that moved the stamp would write an invite whose retention window is not
  // the one the recruiter saw.
  const once = toSqliteUtc("2026-08-12");
  assert.equal(toSqliteUtc(once), once);
  assert.equal(toSqliteUtc(toSqliteUtc(once)), once);
});

test("toSqliteUtc honours a stamp that already states its zone", () => {
  assert.equal(toSqliteUtc("2026-08-12T09:30:00Z"), "2026-08-12 09:30:00");
  // 09:30 at +01:00 is 08:30 UTC. Re-stamping this as UTC would move a real interview an
  // hour, which is the bug this module exists to not have.
  assert.equal(toSqliteUtc("2026-08-12T09:30:00+01:00"), "2026-08-12 08:30:00");
});

test("toSqliteUtc throws a 400 StoreError on anything the schema could not store", () => {
  // The alternative is a CHECK (datetime(interview_at) IS NOT NULL) violation at the
  // database, which surfaces as a 500 — a deployment fault by DEPLOY.md's triage table, for
  // what is plainly a caller's typo.
  for (const bad of ["not a date", "", "   ", null, undefined, "2026-13-45"]) {
    assert.throws(
      () => toSqliteUtc(bad),
      (err) => err instanceof StoreError && err.status === 400,
      `${JSON.stringify(bad)} must be refused at the door`,
    );
  }
});

test("addDays keeps the format and crosses a month boundary", () => {
  assert.equal(addDays("2026-08-12 00:00:00", 14), "2026-08-26 00:00:00");
  assert.equal(addDays("2026-08-25 00:00:00", 14), "2026-09-08 00:00:00", "August has 31 days");
  assert.equal(addDays("2026-12-28 00:00:00", 14), "2027-01-11 00:00:00", "and years roll");
  assert.equal(addDays("2026-08-25", 14), "2026-09-08 00:00:00", "a date-only value is accepted too");
});

test("addDays crosses the BST boundary without gaining or losing an hour", () => {
  // 25 October 2026 is the day British Summer Time ends. Epoch arithmetic moves 14 whole
  // days; `setDate` would preserve the local wall-clock hour and move the UTC instant by one.
  assert.equal(addDays("2026-10-18 12:00:00", 14), "2026-11-01 12:00:00");
  assert.equal(addDays("2026-03-22 12:00:00", 14), "2026-04-05 12:00:00", "and the spring one");
});

test("the pair: dates.js and tokens.js read one timestamp the same way", () => {
  // THE POINT OF THIS FILE. `expires_at` is written by addDays here and read by maxAgeFrom
  // there to size the session cookie, so two readings that disagree by an hour give a
  // candidate a cookie that outlives their invite — or dies before it. Neither is visible in
  // either module's own tests, which is why the assertion has to span both.
  //
  // `now` is derived from the stamp rather than read off the wall clock: with the default
  // `now = new Date()` this would measure 14 days minus however much of today has elapsed.
  const interviewAt = toSqliteUtc("2026-08-12");
  const expiresAt = addDays(interviewAt, 14);
  const now = new Date(Date.parse(`${interviewAt.replace(" ", "T")}Z`));

  assert.equal(maxAgeFrom(expiresAt, now), 14 * 86_400, "decision 11's fourteen days, to the second");
});

test("isNotPast is a question about the DAY, not the instant", () => {
  // An interview at 09:00 today must still be sendable at 14:00 — the morning of a confirmed
  // interview is when the recruiter is most likely to press Send.
  const now = new Date("2026-08-12T14:00:00Z");

  assert.equal(isNotPast("2026-08-11 09:00:00", now), false, "yesterday is past");
  assert.equal(isNotPast("2026-08-12 09:00:00", now), true, "this morning is still today");
  assert.equal(isNotPast("2026-08-12 23:59:59", now), true, "so is tonight");
  assert.equal(isNotPast("2026-08-13 09:00:00", now), true, "and tomorrow");
});

test("isNotPast fails closed on a stamp it cannot read", () => {
  // The server-side half of AC #1. An unparseable date must not open the gate on the way to
  // being rejected by toSqliteUtc — the two guards are independent on purpose.
  const now = new Date("2026-08-12T14:00:00Z");
  assert.equal(isNotPast("next Tuesday", now), false);
  assert.equal(isNotPast("", now), false);
  assert.equal(isNotPast(null, now), false);
});
