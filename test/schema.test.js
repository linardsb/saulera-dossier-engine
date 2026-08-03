// #5 AC3 and AC4, and — since #17 — the boundary moved deliberately rather than eroded.
//
// "There is no candidate table" was the strongest sentence this product said out loud, and it
// was said to a clinical staffing client. #17 changes it in the open: the prep portal stores
// candidate data at rest for the first time, but only inside an invite-scoped cage — every
// portal table reaches `invite` through ON DELETE CASCADE, so one `DELETE FROM invite` erases
// a candidate's entire footprint, and a 30-day post-interview purge plus a delete-now endpoint
// exercise that statement (architecture decision 13).
//
// #67 adds a THIRD regime, and the same way: spike #66's architecture doc
// (docs/epics/locum-fit-2.architecture.md) decides that compliance state — what is missing,
// what is about to expire — is durable candidate data with its own retention. It is caged
// exactly as the portal's is, at a new root: every compliance table reaches `candidate`
// through ON DELETE CASCADE, so one `DELETE FROM candidate` erases the cage, and a 12-month
// dormancy purge plus delete-now exercise that statement. It is METADATA only — statuses,
// reference numbers, expiry dates, never document bytes — and the engine's candidate-shaped
// ban below is byte-for-byte the one #17 left, because the engine still writes none of this.
//
// No regime survives on prose, so this file is a lockfile: it parses the migrations and
// locks every table's exact columns, the cascade chain, the `attempt.mode` honesty CHECK and
// the closed `events.kind` vocabulary. Widening any of it is a schema change to make in the
// open — change the assertion deliberately and say why in the PR.
//
// It parses the FILE, not the live database: `wrangler d1 migrations apply` creates its own
// `d1_migrations` bookkeeping table, so an exact-tables assertion against sqlite_master would
// fail for a reason that has nothing to do with the boundary.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrations = join(root, "migrations");

// EVERY migration, in the order wrangler applies them — not just 0001.
//
// This read one hardcoded file, which left the guard blind on the only path by which the
// boundary would actually move. An applied migration is never edited, so a NEW migration file
// is how `events` gets a sixth column or an eleventh table appears; a `0003_probe.sql` adding
// a table must fail this suite, not pass it.
const files = readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort();
const sql = files.map((f) => readFileSync(join(migrations, f), "utf8")).join("\n");

// Comments are stripped before anything is matched, because the header comments legitimately
// contain the words "candidate" and "pack" while explaining the boundary.
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
const bodyOf = new Map(parsed.map((t) => [t.name, t.body]));

// The one other statement shape the parser reads: `ALTER TABLE <t> ADD COLUMN <c> …`. That is
// the sanctioned way an applied table widens (applied migrations are never edited), and #17's
// `events.kind` is the precedent. Any other ALTER form stays invisible, which the self-guard
// below turns into a failure rather than silence. The added column is folded into `byName` so
// the exact-column locks see the table as SQLite will.
const alterStatements = code.match(/ALTER\s+TABLE[^;]*/gi) ?? [];
const alters = [];
for (const statement of alterStatements) {
  const m = statement.match(/ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(\w+)([^;]*)/i);
  if (!m) continue; // absent from `alters`, so the self-guard test fails loudly
  alters.push({ table: m[1], column: m[2], rest: m[3] });
  byName.get(m[1])?.push(m[2]);
}

// ── the parser's own blind spots, which are failures and not silence ───────────────────
//
// Both assertions below guard the assertions after them. A statement the parser cannot read is
// ABSENT from `byName`, so it passes the exact-tables lock instead of failing it — silence
// that looks identical to compliance.

test("every CREATE TABLE in the migrations is one this test could read", () => {
  assert.equal(
    parsed.length,
    (code.match(/CREATE\s+TABLE/gi) ?? []).length,
    'a CREATE TABLE the parser could not read is invisible to the assertions below, not a ' +
      'failure of them. `CREATE TABLE "candidates" (…)` is the proven case; backticks, ' +
      "brackets, main.candidates, TEMP and AS SELECT are the same class. If you added a table " +
      "in a form this parser does not handle, teach it that form — do not delete this check.",
  );
});

test("every ALTER TABLE in the migrations is an ADD COLUMN this test could read", () => {
  assert.equal(
    alters.length,
    (code.match(/ALTER\s+TABLE/gi) ?? []).length,
    "an ALTER TABLE the parser could not read is invisible to the assertions below. " +
      "`ALTER TABLE <t> ADD COLUMN <c> …` is the one sanctioned form — #17 widened events " +
      "that way, deliberately and in the open. RENAME, DROP COLUMN and every other form " +
      "change the schema where no assertion can see it. If you need one, teach the parser " +
      "that form — do not delete this check.",
  );
});

// ── the tables that exist, and the three regimes that govern them ──────────────────────

// note_visibility (#18) is an ENGINE table, not a portal one: a row is a client id and a
// heading slug from the agency's own note, so it holds no candidate data and no note text and
// §5.6's boundary has not moved. It is deliberately inside the regime that BANS candidate
// shapes rather than the one that cages them — the candidate-shaped regex below runs over it,
// which is why the column is `field_key` and not `candidate_visible`. Presence is permission,
// so an empty table is the fail-closed default for every note that already exists.
const ENGINE_TABLES = ["agency", "clients", "events", "note_visibility"];
const PORTAL_TABLES = ["attempt", "candidate_role", "competency", "habit", "invite", "otp", "question"];

// The third regime (#67, decided by spike #66): durable compliance METADATA, caged to a
// `candidate` root with its own retention — a 12-month dormancy purge and delete-now, both
// one `DELETE FROM candidate`. The name `candidate` is legal HERE and still banned in the
// engine regime below, which is the whole point of naming the regimes separately: the engine
// pipeline writes no candidate data anywhere, and this cage is the second place — after the
// portal's — where a decision moved that line on purpose.
const COMPLIANCE_TABLES = ["assignment", "candidate", "compliance_item"];

test("the schema declares exactly the engine's four, the portal's seven and the compliance cage's three", () => {
  assert.deepEqual(
    [...byName.keys()].sort(),
    [...ENGINE_TABLES, ...PORTAL_TABLES, ...COMPLIANCE_TABLES].sort(),
    "a fifteenth table means a boundary moved without a decision. The engine's four carry " +
      "no candidate data (architecture §5.6); the portal's seven are candidate data inside " +
      "decision 13's retention cage; the compliance cage's three are durable candidate " +
      "metadata inside spike #66's. A new table must pick a regime, in the open.",
  );
});

test("no engine table or column is candidate-shaped", () => {
  // #17 moved the no-candidate-data boundary deliberately: the portal tables ARE candidate
  // data, governed by decision 13's retention cage (cascade + 30-day purge + delete-now)
  // instead of by absence. The ENGINE tables keep the original rule unchanged — the pack
  // pipeline still writes no candidate data anywhere, and `events` in particular must never
  // grow a candidate-shaped column, which is exactly what this regex would catch.
  const forbidden = /candidate|^cv$|resume|\bpack\b|brief/i;
  for (const table of ENGINE_TABLES) {
    assert.ok(
      !forbidden.test(table),
      `table ${table} is candidate-shaped. Candidate, CV and pack are transient in the engine ` +
        `by design (architecture §5.6); this is the one boundary that is expensive to unpick.`,
    );
    for (const col of byName.get(table) ?? []) {
      assert.ok(
        !forbidden.test(col),
        `${table}.${col} is candidate-shaped. Candidate, CV and pack are transient in the ` +
          `engine by design (architecture §5.6); candidate data belongs only inside the ` +
          `portal's invite-scoped cage.`,
      );
    }
  }
});

// ── every table's exact shape, locked ──────────────────────────────────────────────────
//
// Column lists are sorted and exact, so a drive-by column — a candidate_ref on events, a
// score on attempt, a plaintext token on invite — fails here by name.

const EXPECTED_COLUMNS = {
  agency: ["id", "name", "renderer", "send_format", "updated_at"],
  clients: ["created_at", "id", "name", "note", "updated_at"],
  // AC4, amended by #17: {client, timestamp, duration, kind} and nothing else. kind is the
  // one deliberate widening (decision 3, 23) and its vocabulary is locked further down.
  events: ["client_id", "created_at", "duration_ms", "id", "kind"],
  // #18. Three columns and no fourth: no note text, no section body, no candidate anything.
  // There is deliberately no `visible` boolean — presence IS permission, so there is no
  // default to get the wrong way round and no NULL to interpret.
  note_visibility: ["client_id", "created_at", "field_key"],
  // #25 adds reminder_sent_at: the nullable set-exactly-once stamp that IS decision 17's
  // idempotency (claimed with UPDATE ... WHERE reminder_sent_at IS NULL). Still no plaintext
  // token, and the column dies with the row.
  // #34 adds send_key: the browser-minted per-prepared-payload key whose UNIQUE index IS the
  // send's idempotency — a standing key means the send fully succeeded (the rollback deletes
  // the row and frees it), so a retry answers 409 already_sent instead of a second invite.
  // Nullable, and NULL for every pre-#34 row and key-less caller.
  invite: ["client_id", "email", "expires_at", "id", "interview_at", "opened_at", "reminder_sent_at", "send_key", "sent_at", "status", "token_hash"],
  candidate_role: ["brief_json", "cv_text", "ethos_text", "id", "invite_id", "jd_text"],
  competency: ["id", "importance", "label", "role_id", "source_quote", "stage", "success_rate"],
  question: ["axis", "competency_id", "difficulty", "id", "text", "variant_of"],
  attempt: ["competency_id", "created_at", "id", "mode", "note", "question_id", "rating"],
  habit: ["active", "evidence_count", "first_seen", "id", "label", "role_id"],
  // #20. `attempts` is the OTP cap's whole storage: the counter rides the row it caps, and
  // dies with it. Still no `code` column and no email — the invite the row hangs off owns
  // the identity, and this table owns only the guess count.
  otp: ["attempts", "code_hash", "expires_at", "id", "invite_id"],
  // #67. The cage root: identity and contact, and nothing that describes a person's health,
  // right to work or criminal record — those live one table down as a status word. created_at
  // is load-bearing, not bookkeeping: it is the dormancy clock for a candidate who never
  // gained an assignment.
  candidate: ["created_at", "email", "full_name", "id", "phone"],
  // #67. Dates and a booking state. It is the other half of the dormancy clock and all of
  // #69's extension radar, which is why end_date is a real column and not a derived guess.
  assignment: ["candidate_id", "client_id", "created_at", "end_date", "id", "start_date", "status"],
  // #67, and metadata-only is exactly this lock. Spike #66's first decision was that no
  // document byte rests on our infrastructure: a `document_url`, an `evidence_blob` or a
  // `photo` column here is the descope this test exists to fail on, and it would put
  // special-category data in a table whose entire claim is that it holds only a status word,
  // a reference number and a date.
  compliance_item: ["candidate_id", "checked_at", "expiry_date", "id", "item_key", "reference", "status"],
};

test("every table's columns are exactly the locked list", () => {
  assert.deepEqual(
    Object.keys(EXPECTED_COLUMNS).sort(),
    [...ENGINE_TABLES, ...PORTAL_TABLES, ...COMPLIANCE_TABLES].sort(),
  );
  for (const [table, expected] of Object.entries(EXPECTED_COLUMNS)) {
    assert.deepEqual(
      [...(byName.get(table) ?? [])].sort(),
      expected,
      `${table}'s columns moved. Architecture §4 is the shape record for the portal tables ` +
        `and §5.3 for the engine's; a new column is a decision to make in the open, in a new ` +
        `migration, with this lock changed in the same PR and the reason said out loud.`,
    );
  }
});

// ── the retention cages: one DELETE takes a whole scope, in both of them ───────────────

// Every foreign key a caged table declares, and the parent it must cascade from. The portal
// chain bottoms out at invite, which itself cascades from clients — so deleting a client,
// purging an expired invite and delete-now all erase whole scopes through the same mechanism.
//
// note_visibility is the one engine table here. It cascades from clients for the same reason
// events does: deleting a client must take its permissions with it by the schema, not by a
// second statement in deleteClient. It either works for both or is already broken.
//
// The compliance rows (#67) bottom out at `candidate` instead — a second root, the same
// mechanism. `candidate` itself has no foreign key, exactly as `clients` has none: it is a
// root, and a root that cascaded from something else would put the cage inside another
// lifetime. assignment.client_id is the one edge that leaves the cage sideways: deleting a
// client must take its bookings, and it does so by the schema.
const CASCADE_CHAIN = {
  note_visibility: { client_id: "clients" },
  invite: { client_id: "clients" },
  candidate_role: { invite_id: "invite" },
  competency: { role_id: "candidate_role" },
  question: { competency_id: "competency", variant_of: "question" },
  attempt: { competency_id: "competency", question_id: "question" },
  habit: { role_id: "candidate_role" },
  otp: { invite_id: "invite" },
  assignment: { candidate_id: "candidate", client_id: "clients" },
  compliance_item: { candidate_id: "candidate" },
};

test("every foreign key in the chain declares ON DELETE CASCADE toward its parent", () => {
  for (const [table, fks] of Object.entries(CASCADE_CHAIN)) {
    const body = bodyOf.get(table) ?? "";
    for (const [column, parent] of Object.entries(fks)) {
      assert.match(
        body,
        new RegExp(`${column}[^,]*REFERENCES\\s+${parent}\\s*\\(\\s*id\\s*\\)\\s+ON\\s+DELETE\\s+CASCADE`, "i"),
        `${table}.${column} must cascade from ${parent}. Decision 13's purge and delete-now ` +
          `are one \`DELETE FROM invite\` statement each, and spike #66's are one ` +
          `\`DELETE FROM candidate\` — a missing cascade leaves orphaned candidate data ` +
          `behind the very mechanism that promises there is none.`,
      );
    }
  }
});

test("candidate_role.invite_id is UNIQUE — one brief behind one link", () => {
  // `columns()` above filters UNIQUE out as a table-level keyword, so this constraint is
  // invisible to every exact-column lock in this file. It is not decoration: two handovers for
  // one invite would put two briefs behind one magic link, and it is also the constraint that
  // makes `persistHandover` throw on a retry — which is the branch
  // functions/api/prep/send.js's handover rollback exists to clean up.
  assert.match(
    bodyOf.get("candidate_role") ?? "",
    /invite_id\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i,
    "candidate_role.invite_id must be UNIQUE: one invite is one candidate's one brief.",
  );
});

test("attempt.mode is CHECK-typed to recall|nudged|revealed — the honesty rule, structural", () => {
  const body = bodyOf.get("attempt") ?? "";
  assert.match(
    body,
    /mode\s+TEXT\s+NOT\s+NULL\s+CHECK/i,
    "SPEC State: mode is the field that makes the rest honest. Without the CHECK, #23 can " +
      "write a fourth mode and a revealed answer can count as recall.",
  );
  for (const mode of ["'recall'", "'nudged'", "'revealed'"]) {
    assert.ok(
      body.includes(mode),
      `attempt.mode must admit ${mode}: the HelpLadder has exactly three rungs, and a ` +
        `revealed answer must never raise success_rate.`,
    );
  }
});

test("the events kind vocabulary is closed to exactly the three kinds", () => {
  const alter = alters.find((a) => a.table === "events" && a.column === "kind");
  assert.ok(alter, "events.kind must arrive by the parsed ADD COLUMN form");
  const check = alter.rest.match(/CHECK\s*\(([^)]*)/i);
  assert.ok(check, "events.kind must carry a CHECK — an open vocabulary is how the counter drifts personal");
  assert.deepEqual(
    [...check[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort(),
    ["invite_opened", "invite_sent", "pack_generated"],
    "decision 3 and 23: the counter records pack generation and invite delivery, never " +
      "behaviour. A fourth kind is a schema change to make in the open, exactly like #17's.",
  );
});

test("only hashes rest: invite carries token_hash, otp carries code_hash, never the secret", () => {
  // The columns are already locked exactly above; this names the property so a future rename
  // cannot trade the hash for the plaintext without reading why. A stored raw token or code
  // is a credential at rest — anyone with database access could impersonate a candidate.
  const invite = byName.get("invite") ?? [];
  assert.ok(invite.includes("token_hash"), "invite holds the token's hash");
  assert.ok(!invite.includes("token"), "the raw magic-link token must never rest");
  const otp = byName.get("otp") ?? [];
  assert.ok(otp.includes("code_hash"), "otp holds the code's hash");
  assert.ok(!otp.includes("code"), "the raw one-time code must never rest");
});

test("note_visibility holds exactly {client, field, timestamp} and nothing else", () => {
  assert.deepEqual(
    [...(byName.get("note_visibility") ?? [])].sort(),
    ["client_id", "created_at", "field_key"],
    "#18: the allow-list stores which heading of the agency's own note a candidate may see. " +
      "A fourth column — a note excerpt 'for debugging', a candidate email, a copy of the " +
      "section body — is exactly the descope this test exists to fail on, and it would put " +
      "personal data in a table whose entire claim is that it holds none.",
  );
});

// ── the compliance cage's own structural promises (#67) ────────────────────────────────

test("compliance_item.status is CHECK-typed to the five checklist states", () => {
  const body = bodyOf.get("compliance_item") ?? "";
  assert.match(
    body,
    /status\s+TEXT\s+NOT\s+NULL\s+DEFAULT\s+'missing'\s+CHECK/i,
    "the checklist vocabulary is closed, and it opens at 'missing': a candidate who has " +
      "handed over nothing is the honest starting state, and the DDL default is the one " +
      "place that decides it.",
  );
  for (const status of ["'missing'", "'submitted'", "'verified'", "'expiring'", "'expired'"]) {
    assert.ok(
      body.includes(status),
      `compliance_item.status must admit ${status}: #70's expiry sweep writes 'expiring' ` +
        `and 'expired', the recruiter writes 'verified', and a sixth state invented at ` +
        `write time would make the dashboard's "7 of 12 complete" mean something new.`,
    );
  }
});

test("assignment.status is CHECK-typed to the four booking states", () => {
  const body = bodyOf.get("assignment") ?? "";
  assert.match(
    body,
    /status\s+TEXT\s+NOT\s+NULL\s+DEFAULT\s+'booked'\s+CHECK/i,
    "a booking's state is a closed vocabulary like attempt.mode, not free text",
  );
  for (const status of ["'booked'", "'active'", "'ended'", "'cancelled'"]) {
    assert.ok(
      body.includes(status),
      `assignment.status must admit ${status}. The dormancy purge deliberately ignores this ` +
        `column and answers to end_date alone — a status and a date can disagree, and ` +
        `retention must not be extendable by a bookkeeping error.`,
    );
  }
});

test("one checklist row per candidate per item — compliance_item (candidate_id, item_key) is UNIQUE", () => {
  // `columns()` filters UNIQUE out as a table-level keyword, so this constraint is invisible
  // to every exact-column lock above. It is not decoration: two rows for one candidate's HCPC
  // registration would let the passport show 'verified' and 'expired' at once, and it is also
  // what makes a second createCandidate for the same id throw instead of doubling the
  // checklist.
  assert.match(
    bodyOf.get("compliance_item") ?? "",
    /UNIQUE\s*\(\s*candidate_id\s*,\s*item_key\s*\)/i,
    "compliance_item must be UNIQUE (candidate_id, item_key): one candidate, one row per item.",
  );
});

test("the compliance cage stores no document bytes — metadata columns only", () => {
  // Spike #66's first decision, in its structural form. Documents keep moving over the
  // agency's existing channels; what rests here is a status word, a reference number and a
  // date. A column named for a file — even a URL pointing at one — is the moment this
  // product takes custody of health documents, and that is a DPIA and a paid milestone
  // (the R2 vault), not a drive-by column.
  const forbidden = /blob|bytes|image|photo|document|file|url|evidence/i;
  for (const table of COMPLIANCE_TABLES) {
    for (const col of byName.get(table) ?? []) {
      assert.ok(
        !forbidden.test(col),
        `${table}.${col} looks like document custody. The compliance epic is metadata-only ` +
          `(architecture "Storage: metadata-only") — bytes need their own spike, their own ` +
          `retention and a commercial agreement first.`,
      );
    }
  }
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
