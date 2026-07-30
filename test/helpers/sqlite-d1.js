// A REAL database in the D1 shape (#17, #20, #22). The counterpart to test/helpers/fake-d1.js,
// and the two are not interchangeable — fake-d1 records what SQL was built, this runs it.
//
// Extracted here when the third file needed it (#22's send path). What each caller needs it for
// is the same class of failure, and it is one no recorded-SQL assertion can see: behaviour that
// branches on a CONSTRAINT or on `meta.changes`, both of which test/helpers/fake-d1.js fakes —
// it returns `{ changes: 1 }` unconditionally and enforces nothing.
//
//   #17  the ON DELETE CASCADE chain, and the purge boundary's <=
//   #20  a reused token (changes === 0), an expired token, opened_at set exactly once
//   #22  the competency PRIMARY KEY collision on a client's second candidate, and the
//        INTEGER affinity that stores 'standard' in a numeric column without complaint
//
// Every one of them PASSES under the fake while the logic is wrong.
//
// THE D1 GOTCHA THAT MAKES THE PRAGMA NON-OPTIONAL: D1 enforces `PRAGMA foreign_keys = ON` by
// default and plain SQLite defaults OFF. Without the line in openMigrated below, every cascade
// assertion in every caller passes while proving nothing.
//
// Engine: `node:sqlite`, which this machine's default Node v20.20.2 does not have. Callers pass
// the exported `skip` to `test(name, { skip }, fn)`, so the suite stays green on Node 20 with
// the remedy in the message, and Node 24 proves the rest.
//
// `test/*.test.js` does not glob into `test/helpers/`, so this is never collected as a suite —
// the same note both existing helpers carry.

import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const migrations = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");

let DatabaseSync;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch {
  // Node < 22.5: ERR_UNKNOWN_BUILTIN_MODULE. The skip below carries the remedy.
}

/** Falsy under Node 24 (so tests run), a reason string under Node 20 (so they skip, explained). */
export const skip =
  !DatabaseSync && "node:sqlite unavailable (Node < 22.5); run under Node 24 for full coverage";

/** The one client every caller's fixtures hang off. */
export const SEED_CLIENT =
  "INSERT INTO clients (id, name) VALUES ('c-1', 'Ashdown Park Community Healthcare')";

/**
 * The same client, but with a REAL note and a REAL allow-list — one section ticked, one not.
 *
 * `SEED_CLIENT` inserts `(id, name)` only, so `client.note` is the column default `''`. For the
 * auth and purge callers that is correct and irrelevant. For #22's send path it is a trap:
 * `visibleFields('', anything)` returns `[]` whatever the second argument is, so
 * `candidate_role.ethos_text` comes out `''` whether the #18 gate is applied or replaced with
 * `String(client.note ?? "")` — decision 2's whole mechanism deleted, and nothing fails.
 *
 * So this seed exists to make the gate observable. Two headings, exactly one ticked, and the
 * keys are the two `source_field_key` values test/fixtures/prep-payload.json's PanelBrief
 * already names — so one panel claim must verify against the database's list and the other must
 * demote, which is what proves the list is read from D1 rather than from the body.
 *
 * `what-they-actually-care-about` is deliberately a REAL heading the recruiter did not tick,
 * not an invented key: that is the case the gate exists for, and the one that leaks if it goes.
 */
export const SEED_CLIENT_WITH_NOTE = `
INSERT INTO clients (id, name, note) VALUES ('c-1', 'Ashdown Park Community Healthcare',
'## Their process
Two stages, both in person. Dr Anwar sits in on the second and asks about lone visits.

## What they actually care about
Careful record-keeping. The last two hires were let go over their notes.');
INSERT INTO note_visibility (client_id, field_key) VALUES ('c-1', 'their-process');
`;

/** The strings the seed above is asserted with, so a caller cannot drift from the note text. */
export const NOTE_TICKED = { key: "their-process", heading: "Their process", text: "Dr Anwar" };
export const NOTE_UNTICKED = {
  key: "what-they-actually-care-about",
  heading: "What they actually care about",
  text: "let go over their notes",
};

/** ~20 lines wrapping DatabaseSync in the D1 shape src/portal/store.js expects. */
export function d1Shape(db) {
  return {
    prepare(sql) {
      let args = [];
      const statement = {
        bind(...bound) {
          args = bound;
          return statement;
        },
        async first(column) {
          const row = db.prepare(sql).get(...args) ?? null;
          return column === undefined || row === null ? row : row[column];
        },
        async all() {
          return { results: db.prepare(sql).all(...args), success: true, meta: {} };
        },
        async run() {
          const { changes } = db.prepare(sql).run(...args);
          return { success: true, meta: { changes: Number(changes) } };
        },
      };
      return statement;
    },
  };
}

/**
 * EVERY migration in wrangler's order, then the seed — 0004 widens otp, and a caller that
 * applied only the two it had heard of would be testing a schema this deployment does not run.
 *
 * `seedSql` is a parameter with the single-client default so no caller changed behaviour when
 * this moved out of test/prep-auth.test.js. Pass "" for an empty database.
 */
export function openMigrated(seedSql = SEED_CLIENT) {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON"); // D1's default; SQLite's is OFF
  for (const file of readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort()) {
    db.exec(readFileSync(join(migrations, file), "utf8"));
  }
  if (seedSql) db.exec(seedSql);
  return db;
}

/** A UTC timestamp in SQLite's own datetime('now') format, offset by whole days. */
export const at = (days) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 19).replace("T", " ");
