// The two date rules the Send path turns on (#22). Pure: no D1, no HTTP, no env, and
// deliberately no `node:` anything — this module is imported by a Function and runs at the
// edge, where `Date` is all there is.
//
// ONE READING OF A TIMESTAMP. `src/prep/tokens.js:113-119` states the rule these functions
// repeat: SQLite writes 'YYYY-MM-DD HH:MM:SS' in UTC with nothing in the string saying so,
// and `Date.parse` reads a space-separated string as LOCAL time. In British Summer Time that
// is an hour of drift in whichever direction hurts — a cookie outliving its invite, or a
// candidate signed out an hour early holding a link that still claims to work. So every parse
// here goes through `toUtcDate` below, which is `maxAgeFrom`'s rule written once more rather
// than a second reading of the same format. test/prep-dates.test.js pins the two together.
//
// Why this exists at all rather than inline `new Date()` calls in the Function: `invite
// .interview_at` carries `CHECK (datetime(interview_at) IS NOT NULL)` (migrations/0002),
// so a stamp SQLite cannot read is a 500 at the database rather than a 400 at the door.
// Refusing it here is the loud, caller-fixable failure.

import { StoreError } from "../store.js";

/** SQLite's own datetime('now') format, which is what every column in 0002 holds. */
const SQLITE_STAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/** Date-only, which is exactly what `<input type="date">` hands over. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse a stamp as UTC, whatever separator and zone it arrived with.
 *
 * The `T` and the `Z` are the load-bearing part, for the reason in the header. A value that
 * already carries a zone (an ISO 'Z' or a ±hh:mm offset) is left alone — it says what it means
 * and we are not entitled to overwrite it.
 */
export function toUtcDate(value) {
  const iso = String(value ?? "").trim().replace(" ", "T");
  if (!iso) return null;
  const stamped = /[Zz]$|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`;
  const ms = Date.parse(stamped);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

/** A Date back out as SQLite's UTC form. `toISOString` is already UTC; this only reshapes it. */
function format(date) {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

/**
 * An interview date in the form the schema accepts: 'YYYY-MM-DD HH:MM:SS', UTC.
 *
 * Accepts what `<input type="date">` gives ('YYYY-MM-DD' → midnight UTC), a full ISO string,
 * and its own output — idempotence matters because the confirm step re-normalises a value the
 * prepare step already normalised, and two passes must not walk the stamp forward.
 *
 * Throws rather than defaulting. A silently-substituted date would write an invite whose
 * retention window is not the one the recruiter agreed to.
 */
export function toSqliteUtc(value) {
  const raw = String(value ?? "").trim();
  const date = toUtcDate(DATE_ONLY.test(raw) ? `${raw}T00:00:00` : raw);
  if (!date) {
    throw new StoreError("missing_fields", 400, "interview_at: not a date this schema can store");
  }

  // THE ROUND TRIP, asserted rather than assumed. V8 rejects a bad month (`2026-13-01` does not
  // parse) but silently ROLLS a bad day: `2027-02-31` becomes 3 March. Left alone that is
  // exactly the "silently-substituted date" the paragraph above refuses — a 201, an invite
  // stored against a day nobody chose, and an email printing it to the candidate with both
  // retention windows shifted to match.
  //
  // Only for the forms that state no zone. A value carrying an offset is ENTITLED to land on a
  // different UTC day — that is the point of stating one — and `toUtcDate` leaves it alone.
  const stamp = format(date);
  if ((DATE_ONLY.test(raw) || SQLITE_STAMP.test(raw)) && stamp.slice(0, raw.length) !== raw) {
    throw new StoreError("missing_fields", 400, "interview_at: not a date this schema can store");
  }
  return stamp;
}

/**
 * `stamp` plus whole days, same format in and out — decision 11's `interview_at + 14 days`.
 *
 * Arithmetic on the epoch rather than on `setDate`, which is a LOCAL-time mutator: across a
 * BST boundary `setDate(d.getDate() + 14)` keeps the local wall-clock hour and moves the UTC
 * instant by an hour, which is the same drift the header is about, arriving through a
 * different door.
 */
export function addDays(stamp, days) {
  const date = toUtcDate(SQLITE_STAMP.test(String(stamp ?? "").trim()) ? stamp : toSqliteUtc(stamp));
  if (!date) {
    throw new StoreError("missing_fields", 400, "interview_at: not a date this schema can store");
  }
  return format(new Date(date.getTime() + Number(days) * 86_400_000));
}

/**
 * How far ahead an interview may be booked.
 *
 * Not a guess about how far out diaries go — a RETENTION bound. `purgeExpired`
 * (src/portal/store.js:44-49) deletes on `datetime(interview_at,'+30 days') <= datetime('now')`,
 * so the interview date is the clock the whole promise hangs off, and nothing else caps it. A
 * one-character year typo — `2226-08-12` for `2026-08-12` — makes that DELETE match nothing for
 * two centuries: the candidate's `cv_text`, `jd_text`, `ethos_text` and address sit in D1, and
 * the magic link stays live, while src/prep/email.js tells that same candidate in writing that
 * "Everything here is deleted 30 days after your interview." Decision 13 gates the pilot on
 * exactly that sentence, and the failure is silent — it surfaces at an audit, not in a test.
 *
 * Two years is deliberately generous. This is not a diary rule and must never refuse a real
 * booking; it exists to catch the typo, which misses by centuries rather than by months.
 */
export const MAX_MONTHS_AHEAD = 24;

/**
 * Is this interview inside the retention horizon? Same DAY granularity as `isNotPast`, and the
 * same fail-closed answer for a stamp that will not parse.
 *
 * `setUTCMonth` rather than epoch arithmetic, because "24 months" is a calendar span and no
 * fixed number of milliseconds is one. UTC throughout, for the reason in the header.
 */
export function isWithinHorizon(stamp, now = new Date()) {
  const date = toUtcDate(stamp);
  if (!date) return false;
  const horizon = new Date(now.getTime());
  horizon.setUTCMonth(horizon.getUTCMonth() + MAX_MONTHS_AHEAD);
  return date.toISOString().slice(0, 10) <= horizon.toISOString().slice(0, 10);
}

/**
 * Is this interview today or later? DAY granularity, not instant.
 *
 * The distinction is the whole point: an interview at 09:00 today is still an interview the
 * recruiter must be able to send prep for at 14:00. Comparing instants would lock the CTA at
 * the moment it is most likely to be wanted — the morning of, when the date was just confirmed.
 *
 * Both sides are compared as UTC calendar days, because `interview_at` is a UTC stamp and
 * `now.toISOString()` is the same clock. A recruiter in BST sending at 00:30 local on the day
 * of a same-day interview is the edge this rounds against, and it rounds toward allowing.
 */
export function isNotPast(stamp, now = new Date()) {
  const date = toUtcDate(stamp);
  if (!date) return false; // unparseable is not sendable — fail closed
  return date.toISOString().slice(0, 10) >= now.toISOString().slice(0, 10);
}
