// #5 AC3 and AC4 — the boundary, as a failing test rather than a promise.
//
// "There is no candidate table" is the strongest sentence this product says out loud, and it
// is said to a clinical staffing client. "The event counter records {client, timestamp,
// duration} and nothing else" is the mechanism behind the epic's primary metric, and #5 names
// it as the first thing that gets silently descoped.
//
// Neither survives on prose. #6 is about generation and #8 is about a screen, and in both,
// `events` is a side concern somebody widens "just to make debugging easier" — a candidate_ref
// column added in thirty seconds, breaching the one boundary architecture §5.6 calls expensive
// to unpick. So this file parses the migration and fails the suite instead.
//
// It parses the FILE, not the live database: `wrangler d1 migrations apply` creates its own
// `d1_migrations` bookkeeping table, so an "exactly three tables" assertion against
// sqlite_master would fail for a reason that has nothing to do with the boundary.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sql = readFileSync(join(root, "migrations/0001_init.sql"), "utf8");

// Comments are stripped before anything is matched, because the header comment legitimately
// contains the words "candidate" and "pack" while explaining why no such table exists.
const code = sql.replace(/--[^\n]*/g, "");

/** Every `CREATE TABLE name (...)` in the file, as `{ name, body }`. */
function tables(source) {
  const found = [];
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][\w]*)\s*\(/gi;
  for (let m = re.exec(source); m; m = re.exec(source)) {
    // Balanced scan rather than a lazy `\)`: `CHECK (id = 1)` puts parens inside the body.
    let depth = 1;
    let i = re.lastIndex;
    while (i < source.length && depth > 0) {
      if (source[i] === "(") depth += 1;
      else if (source[i] === ")") depth -= 1;
      i += 1;
    }
    found.push({ name: m[1], body: source.slice(re.lastIndex, i - 1) });
  }
  return found;
}

/** The column names a `CREATE TABLE` body declares, ignoring table-level constraints. */
function columns(body) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const ch of body) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current);

  const TABLE_LEVEL = new Set(["CHECK", "PRIMARY", "FOREIGN", "UNIQUE", "CONSTRAINT"]);
  return parts
    .map((p) => p.trim().split(/\s+/)[0])
    .filter((first) => first && !TABLE_LEVEL.has(first.toUpperCase()));
}

const parsed = tables(code);
const byName = new Map(parsed.map((t) => [t.name, columns(t.body)]));

// ── the tables that exist, and the ones that must not ──────────────────────────────────

test("the schema declares exactly agency, clients and events", () => {
  assert.deepEqual(
    [...byName.keys()].sort(),
    ["agency", "clients", "events"],
    "a fourth table means the no-candidate-data boundary moved. Architecture §5.6: candidate, " +
      "CV and pack are transient — passed in, used, written nowhere.",
  );
});

test("no table or column is candidate-shaped", () => {
  const forbidden = /candidate|^cv$|resume|\bpack\b|brief/i;
  for (const [table, cols] of byName) {
    assert.ok(
      !forbidden.test(table),
      `table ${table} is candidate-shaped. Candidate, CV and pack are transient by design ` +
        `(architecture §5.6); this is the one boundary that is expensive to unpick.`,
    );
    for (const col of cols) {
      assert.ok(
        !forbidden.test(col),
        `${table}.${col} is candidate-shaped. Candidate, CV and pack are transient by design ` +
          `(architecture §5.6); this is the one boundary that is expensive to unpick.`,
      );
    }
  }
});

// ── the counter, which is the criterion most likely to erode ───────────────────────────

test("events holds exactly {client, timestamp, duration} and nothing else", () => {
  assert.deepEqual(
    [...(byName.get("events") ?? [])].sort(),
    ["client_id", "created_at", "duration_ms", "id"],
    "AC4: the event counter records {client, timestamp, duration}. A fifth column — a " +
      "candidate_ref for debugging, a role title, a pack id — is the descope this test exists " +
      "to fail on.",
  );
});

// ── the two things the product needs to be there ───────────────────────────────────────

test("clients carries the note, which is the product", () => {
  assert.ok(byName.get("clients")?.includes("note"), "clients.note is the compounding asset");
});

test("agency carries the two settings read at generation and render time", () => {
  const agency = byName.get("agency") ?? [];
  assert.ok(agency.includes("renderer"), "agency.renderer picks the provenance rendering");
  assert.ok(agency.includes("send_format"), "agency.send_format is how packs are sent");
  // Decision 6: branding is public/tokens.css, because it has to apply before first paint.
  assert.equal(
    agency.filter((c) => /colour|color|logo|brand|font/i.test(c)).length,
    0,
    "branding belongs in public/tokens.css, not in a database row (plan Decision 6)",
  );
});
