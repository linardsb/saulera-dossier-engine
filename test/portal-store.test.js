// #17 — the portal store's SQL shapes, against the recording fake.
//
// The class of failure this file catches: the retention machinery quietly changing shape.
// The purge deleting from a child table would mask a broken cascade; the retention number
// drifting from 30 days would change what "auto-purge" means without anyone deciding it; a
// raw token reaching a SQL string would put a credential where the schema promises only
// hashes rest. Real deletion behaviour is proven against real SQLite in
// test/portal-purge.test.js — this file proves the statements themselves.

import { test } from "node:test";
import assert from "node:assert/strict";

import { fakeD1 } from "./helpers/fake-d1.js";
import { StoreError } from "../src/store.js";
import {
  briefJsonByInviteId,
  consumeOtp,
  createInvite,
  deleteInviteByTokenHash,
  hashToken,
  inviteByEmail,
  inviteByTokenHash,
  issueOtp,
  openInvite,
  persistHandover,
  purgeExpired,
  rotateSession,
} from "../src/portal/store.js";

/** The error code a call throws, or the string "did not throw". */
async function codeOf(fn) {
  try {
    await fn();
    return "did not throw";
  } catch (err) {
    assert.ok(err instanceof StoreError, `expected a StoreError, got ${err}`);
    return err.code;
  }
}

// ── the purge statement, which is the retention promise ────────────────────────────────

test("purgeExpired deletes from invite alone — the cascade does the rest", async () => {
  const db = fakeD1([null]);
  await purgeExpired(db);

  assert.equal(db.calls.length, 1, "the purge is exactly one statement");
  const sql = db.calls[0].sql;
  assert.match(sql, /^DELETE FROM invite\b/i, "the purge targets invite and only invite");
  // Naming a child table here would delete rows the cascade already takes — and would keep
  // the suite green while the cascade itself was broken. schema.test.js proves the chain;
  // this proves the purge leans on it.
  for (const child of ["candidate_role", "competency", "question", "attempt", "habit", "otp", "clients", "events", "agency"]) {
    assert.ok(!sql.includes(child), `the purge must not name ${child}: the cascade owns the children`);
  }
});

test("the retention number is 30 days, compared through datetime(), and binds nothing", async () => {
  const db = fakeD1([null]);
  await purgeExpired(db);

  const call = db.calls[0];
  // The load-bearing number. A drive-by change to 60 — or to '+30 minutes' — is a change to
  // the privacy notice, the data note and decision 13, and it must fail a test first.
  assert.ok(call.sql.includes("'+30 days'"), "the retention window is exactly 30 days");
  assert.match(call.sql, /datetime\(/, "dates compare through datetime(), which also reads ISO-8601 forms");
  assert.equal(call.args.length, 0, "the purge boundary is the schema's clock — no caller value can move it");
});

test("purgeExpired reports the count from meta.changes", async () => {
  assert.deepEqual(await purgeExpired(fakeD1([null])), { purged: 1 }); // fake-d1 run() reports changes: 1
});

// ── delete-now, which must be idempotent and hash-only ─────────────────────────────────

test("deleteInviteByTokenHash binds the hash and answers ok regardless of matched rows", async () => {
  const db = fakeD1([null]);
  const hash = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
  const result = await deleteInviteByTokenHash(db, hash);

  // {ok: true} even though the fake reports changes — and the same shape at changes 0: a
  // candidate holding a stale link is already in the clean state the button promises. The
  // count rides alongside so the route can pick between two credentials; whether it reads
  // 0 correctly is provable only against real SQL, in test/portal-purge.test.js.
  assert.deepEqual(result, { ok: true, deleted: 1 }); // fake-d1 run() reports changes: 1
  assert.equal(db.calls.length, 1, "delete-now is exactly one statement");
  assert.match(db.calls[0].sql, /^DELETE FROM invite WHERE token_hash = \?$/i);
  assert.deepEqual(db.calls[0].args, [hash], "the hash travels as a bound parameter, never in the SQL");
});

// ── the hash, which is the only form a token may take at rest ──────────────────────────

test("hashToken produces the SHA-256 hex of the token", async () => {
  // A known vector, so a quiet switch of algorithm or encoding fails by value: every stored
  // token_hash would stop matching and every candidate's delete link would break.
  assert.equal(
    await hashToken("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

test("hashToken rejects an empty or non-string token", async () => {
  // hashToken takes no db at all — validation cannot touch one by construction. The reject
  // matters because an empty-string hash is still a valid-looking hex digest, and deleting
  // by it would answer ok while meaning nothing.
  for (const bad of ["", null, undefined, 42, {}]) {
    assert.equal(
      await codeOf(() => hashToken(bad)),
      "missing_fields",
      `token ${JSON.stringify(bad)} should be rejected`,
    );
  }
});

// ── #20's auth statements, as SQL shapes ───────────────────────────────────────────────
//
// Shapes only. Every behaviour these statements have — whether a reused token rotates,
// whether the attempt cap counts to five or six — branches on meta.changes or on real row
// state, and fake-d1's run() hard-codes changes: 1. Under this fake those assertions pass
// while the logic is wrong, so they live in test/prep-auth.test.js against real SQLite.
// What IS provable here is the thing a real database only implies: that no user value ever
// reaches the SQL string, and that a statement never reads a column it has no business
// reading.

const HASH = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
const HASH2 = "3a985da74fe225b2045c172d6bd390bd855f086e3e9d525b46bfe24511431532";

test("createInvite writes one row, binds every value, and opens at status 'sent'", async () => {
  const db = fakeD1([null]);
  await createInvite(db, {
    id: "inv-1",
    clientId: "c-1",
    email: "a@example.com",
    interviewAt: "2026-08-04 09:00:00",
    tokenHash: HASH,
    expiresAt: "2026-08-18 09:00:00",
  });

  assert.equal(db.calls.length, 1, "creating an invite is exactly one statement");
  const { sql, args } = db.calls[0];
  assert.match(sql, /^INSERT INTO invite\b/i);
  assert.ok(sql.includes("'sent'"), "0002 left the status vocabulary to #20; it opens at 'sent'");
  assert.ok(sql.includes("datetime('now')"), "sent_at is the schema's clock, not a caller's");
  assert.deepEqual(
    args,
    ["inv-1", "c-1", HASH, "a@example.com", "2026-08-04 09:00:00", "2026-08-18 09:00:00", null],
    "every value travels bound — an email in a SQL string is an injection and a log leak at once; " +
      "a key-less caller binds NULL, which the #34 unique index ignores",
  );
  // The raw token must never reach the statement. Only its hash was passed in, and this is
  // the assertion that fails if someone "helpfully" adds a token column later.
  assert.ok(!sql.includes("token,"), "invite has no plaintext token column and never will");
});

test("createInvite binds the #34 idempotency key when one is passed", async () => {
  const db = fakeD1([null]);
  await createInvite(db, {
    id: "inv-1",
    clientId: "c-1",
    email: "a@example.com",
    interviewAt: "2026-08-04 09:00:00",
    tokenHash: HASH,
    expiresAt: "2026-08-18 09:00:00",
    sendKey: "key-abc",
  });
  const { sql, args } = db.calls[0];
  assert.match(sql, /send_key/i, "the key has a column, not a template slot");
  assert.equal(args[args.length - 1], "key-abc", "and it travels bound like everything else");
});

test("createInvite refuses a half-built invite rather than writing one", async () => {
  const full = {
    id: "inv-1",
    clientId: "c-1",
    email: "a@example.com",
    interviewAt: "2026-08-04 09:00:00",
    tokenHash: HASH,
    expiresAt: "2026-08-18 09:00:00",
  };
  // An invite missing expires_at would never purge; one missing token_hash could not be
  // opened. Both are worse than a 400, and both are what a partially-wired #22 would send.
  for (const field of Object.keys(full)) {
    const db = fakeD1([null]);
    assert.equal(
      await codeOf(() => createInvite(db, { ...full, [field]: "" })),
      "missing_fields",
      `a blank ${field} must be rejected`,
    );
    assert.equal(db.calls.length, 0, `nothing may be written when ${field} is missing`);
  }
});

test("inviteByTokenHash never selects token_hash, and never filters on expiry", async () => {
  const db = fakeD1([{ id: "inv-1" }]);
  await inviteByTokenHash(db, HASH);

  const { sql, args } = db.calls[0];
  // A hash that is never read cannot reach a log line or an error body. It is matched in the
  // WHERE, which is not the same as returning it.
  assert.ok(!/SELECT[^]*token_hash[^]*FROM/i.test(sql), `the select list must not name token_hash: ${sql}`);
  for (const column of ["id", "client_id", "email", "opened_at", "expires_at", "status"]) {
    assert.ok(sql.includes(column), `enter.js needs ${column} to decide what to tell the candidate`);
  }
  // No datetime guard on purpose: the caller needs the expired row in order to say "expired"
  // rather than "invalid". Adding one here would collapse the two answers into one.
  assert.ok(!/datetime\(/.test(sql), "expiry is the caller's policy, not this statement's");
  assert.deepEqual(args, [HASH]);
});

test("openInvite rotates the hash and guards on expiry in the same statement", async () => {
  const db = fakeD1([null]);
  const result = await openInvite(db, { oldHash: HASH, newHash: HASH2 });

  assert.deepEqual(result, { rotated: true }); // fake-d1 run() reports changes: 1
  assert.equal(db.calls.length, 1, "the exchange must be ONE statement — a read-then-write races");
  const { sql, args } = db.calls[0];
  assert.match(sql, /^UPDATE invite\b/i);
  // The old hash in the WHERE is the atomicity guard AND the single-use guarantee: two
  // simultaneous clicks both match, exactly one updates, the loser sees changes 0.
  assert.match(sql, /WHERE\s+token_hash\s*=\s*\?/i, "the old hash must be in the WHERE, not just the SET");
  assert.ok(sql.includes("COALESCE(opened_at"), "opened_at is a first-open stamp, not a last-seen one");
  assert.ok(sql.includes("'opened'"), "the exchange is what moves status to 'opened'");
  assert.match(
    sql,
    /datetime\('now'\)\s*<=\s*datetime\(expires_at\)/i,
    "an expired link must not be exchangeable, and <= means the last second still works",
  );
  assert.deepEqual(args, [HASH2, HASH], "new hash to SET, old hash to WHERE — in that order");
});

test("rotateSession touches the token alone — a returning login is not a new open", async () => {
  const db = fakeD1([null]);
  await rotateSession(db, { inviteId: "inv-1", newHash: HASH2 });

  const { sql, args } = db.calls[0];
  assert.match(sql, /^UPDATE invite SET token_hash = \?/i);
  // Decision 23 counts invites opened as a sales claim. If signing back in from a second
  // device re-stamped opened_at, that number would climb with device count rather than reach.
  assert.ok(!sql.includes("opened_at"), "rotateSession must never touch opened_at");
  assert.ok(!sql.includes("status"), "rotateSession must never touch status");
  assert.match(sql, /datetime\('now'\)\s*<=\s*datetime\(expires_at\)/i, "an expired invite issues no session");
  assert.deepEqual(args, [HASH2, "inv-1"]);
});

test("inviteByEmail matches case-insensitively, filters expiry, and takes the newest", async () => {
  const db = fakeD1([{ id: "inv-1" }]);
  await inviteByEmail(db, "A.Patel@Example.com");

  const { sql, args } = db.calls[0];
  assert.match(sql, /lower\(email\)\s*=\s*lower\(\?\)/i, "a candidate retypes their address by hand");
  assert.match(sql, /datetime\('now'\)\s*<=\s*datetime\(expires_at\)/i, "a dead invite issues no code");
  assert.match(sql, /ORDER BY sent_at DESC\s+LIMIT 1/i, "several live invites: the newest is the one they mean");
  assert.deepEqual(args, ["A.Patel@Example.com"], "the address travels bound, and uncased — lower() is SQL's job");
});

test("issueOtp clears the old code before writing the new one, and binds the TTL", async () => {
  const db = fakeD1([null, null]);
  await issueOtp(db, { inviteId: "inv-1", codeHash: HASH, ttlMinutes: 10 });

  assert.equal(db.calls.length, 2, "one live code per invite: delete, then insert");
  assert.match(db.calls[0].sql, /^DELETE FROM otp WHERE invite_id = \?$/i);
  assert.deepEqual(db.calls[0].args, ["inv-1"]);

  const { sql, args } = db.calls[1];
  assert.match(sql, /^INSERT INTO otp\b/i);
  // The TTL modifier is assembled by SQLite from a bound value. Templating the number into
  // the string would work today and be the template that accepts a caller's value tomorrow.
  assert.ok(sql.includes("'+' || ? || ' minutes'"), "the TTL is concatenated by SQLite from a bound value");
  assert.ok(!sql.includes("10"), "the number must not appear in the SQL text");
  assert.deepEqual(args, ["inv-1", HASH, 10]);
});

test("issueOtp refuses a TTL that is not a positive integer", async () => {
  // '10 minutes; DROP' concatenated into a datetime modifier is the shape this guard exists
  // for, and a NaN or a 0 would write a code that is dead on arrival or never dies.
  for (const bad of [0, -5, 1.5, "10", null, undefined, NaN]) {
    const db = fakeD1([null, null]);
    assert.equal(
      await codeOf(() => issueOtp(db, { inviteId: "inv-1", codeHash: HASH, ttlMinutes: bad })),
      "missing_fields",
      `ttlMinutes ${JSON.stringify(bad)} should be rejected`,
    );
    assert.equal(db.calls.length, 0, "a bad TTL must not delete the code the candidate already has");
  }
});

test("issueOtp refuses a cooldown that is negative, fractional, or >= the TTL", async () => {
  // The cooldown rides the same bound-modifier idiom as the TTL, so it gets the same guard —
  // and >= TTL is refused because freshness implying liveness depends on cooldown < TTL.
  for (const bad of [-1, 1.5, 10, 11]) {
    const db = fakeD1([null, null]);
    assert.equal(
      await codeOf(() => issueOtp(db, { inviteId: "inv-1", codeHash: HASH, ttlMinutes: 10, cooldownMinutes: bad })),
      "missing_fields",
      `cooldownMinutes ${JSON.stringify(bad)} should be rejected`,
    );
    assert.equal(db.calls.length, 0, "a bad cooldown must not delete the code the candidate already has");
  }
  // Zero and omitted are both today's behaviour, exactly — every pre-existing caller keeps it.
  for (const fine of [{ cooldownMinutes: 0 }, {}]) {
    const db = fakeD1([null, null]);
    const result = await issueOtp(db, { inviteId: "inv-1", codeHash: HASH, ttlMinutes: 10, ...fine });
    assert.deepEqual(result, { ok: true, issued: true });
    assert.equal(db.calls.length, 2, "no freshness read on the zero-cooldown path: delete, then insert");
  }
});

test("consumeOtp reads the row's liveness and attempt count before deciding anything", async () => {
  const db = fakeD1([{ id: 7, code_hash: HASH, attempts: 0, live: 1 }, null]);
  const result = await consumeOtp(db, { inviteId: "inv-1", codeHash: HASH, maxAttempts: 5 });

  assert.deepEqual(result, { ok: true });
  const select = db.calls[0];
  assert.match(select.sql, /^SELECT[^]*FROM otp\b/i);
  assert.match(
    select.sql,
    /datetime\('now'\)\s*<=\s*datetime\(expires_at\)\s+AS live/i,
    "liveness is computed by SQLite, so the route never compares clocks itself",
  );
  assert.ok(select.sql.includes("attempts"), "the cap cannot be applied without reading the counter");
  assert.deepEqual(select.args, ["inv-1"]);

  // Single-use is the delete. There is no `used` flag, because a flag can be checked in the
  // wrong order and a missing row cannot.
  assert.match(db.calls[1].sql, /^DELETE FROM otp WHERE id = \?$/i);
  assert.deepEqual(db.calls[1].args, [7]);
});

test("consumeOtp increments on a mismatch and deletes on cap-out", async () => {
  const wrong = fakeD1([{ id: 7, code_hash: HASH, attempts: 2, live: 1 }, null]);
  assert.deepEqual(
    await consumeOtp(wrong, { inviteId: "inv-1", codeHash: HASH2, maxAttempts: 5 }),
    { ok: false, reason: "invalid_code" },
  );
  assert.match(wrong.calls[1].sql, /^UPDATE otp SET attempts = attempts \+ 1 WHERE id = \?$/i);
  assert.deepEqual(wrong.calls[1].args, [7], "the counter increments in SQL, never read-modify-write in JS");

  // At the cap the row is deleted WITHOUT comparing the code — there is no oracle left to
  // ask. Note attempts 5 with maxAttempts 5: five guesses were spent, so this call is the
  // sixth and it is refused rather than counted.
  const capped = fakeD1([{ id: 7, code_hash: HASH, attempts: 5, live: 1 }, null]);
  assert.deepEqual(
    await consumeOtp(capped, { inviteId: "inv-1", codeHash: HASH, maxAttempts: 5 }),
    { ok: false, reason: "too_many_attempts" },
    "the RIGHT code at the cap is still refused — the cap is checked before the comparison",
  );
  assert.match(capped.calls[1].sql, /^DELETE FROM otp WHERE id = \?$/i);
});

test("consumeOtp treats a missing row and a dead row as the same answer", async () => {
  // A candidate whose code timed out and one who never asked for a code are told the same
  // thing. The difference between them is not the candidate's to see, and telling them apart
  // would say whether an invite exists for that address.
  for (const row of [null, { id: 7, code_hash: HASH, attempts: 0, live: 0 }]) {
    const db = fakeD1([row]);
    assert.deepEqual(
      await consumeOtp(db, { inviteId: "inv-1", codeHash: HASH, maxAttempts: 5 }),
      { ok: false, reason: "expired" },
    );
    assert.equal(db.calls.length, 1, "a dead code is read and left alone — nothing to increment");
  }
});

// ── the handover writers (#22) ─────────────────────────────────────────────────────────
//
// What a recording fake CAN prove here: that no payload value reaches a SQL string, that the
// three inserts happen in dependency order, and that the brief read takes one column. What it
// CANNOT prove — the competency PRIMARY KEY collision and the INTEGER affinity that swallows
// a string — needs constraints, and lives in test/prep-send.test.js against node:sqlite.

/** #19's payload shape, small enough to read and wide enough to bind every column. */
const PAYLOAD = {
  role_title: "Community Staff Nurse",
  blocks: [],
  competencies: [
    { id: "lone-working", label: "Lone working", source_quote: "rural caseload", importance: 5 },
    { id: "documentation", label: "Documentation", source_quote: "before end of day", importance: 3 },
  ],
  questions: [
    { competency_id: "lone-working", text: "Tell me about a solo visit.", axis: "core", difficulty: "gentle" },
    { competency_id: "lone-working", text: "When did you escalate?", axis: "core", difficulty: "probing" },
    { competency_id: "documentation", text: "How do you keep notes current?", axis: "core", difficulty: "standard" },
  ],
};

test("persistHandover writes the role, then its competencies, then their questions", async () => {
  const db = fakeD1([]);
  const result = await persistHandover(db, {
    inviteId: "inv-1",
    jdText: "the brief",
    ethosText: "## Their process\nslow",
    cvText: "the cv",
    payload: PAYLOAD,
  });

  assert.deepEqual(result, { roleId: result.roleId, competencies: 2, questions: 3 });
  assert.match(result.roleId, /^[0-9a-f-]{36}$/i, "the role id is a UUID, not a payload value");

  const tables = db.calls.map(({ sql }) => sql.match(/INSERT INTO (\w+)/i)[1]);
  assert.deepEqual(
    tables,
    ["candidate_role", "competency", "question", "question", "competency", "question"],
    "dependency order: a competency cannot precede its role, nor a question its competency",
  );
});

test("persistHandover interpolates nothing — every value is a bound parameter", async () => {
  const db = fakeD1([]);
  await persistHandover(db, {
    inviteId: "inv-1",
    jdText: "the brief",
    ethosText: "## Their process\nslow and consensual",
    cvText: "the cv",
    payload: PAYLOAD,
  });

  // The values that would hurt most in a SQL string: the CV, the brief, the agency's private
  // ethos text, and every label and quote the model wrote. Each is chosen NOT to be a
  // substring of a column name — 'ethos' alone matches `ethos_text` and fails while the code
  // is correct, and a gate that cries wolf gets deleted.
  const values = [
    "the brief", "the cv", "slow and consensual", "rural caseload", "before end of day",
    "Lone working", "Documentation", "Tell me about a solo visit.",
  ];
  for (const { sql } of db.calls) {
    for (const value of values) {
      assert.ok(!sql.includes(value), `a payload value reached the SQL text: ${sql}`);
    }
  }
});

test("R2: a competency row id is namespaced on the role, so two candidates cannot collide", async () => {
  const db = fakeD1([]);
  const { roleId } = await persistHandover(db, { inviteId: "inv-1", payload: PAYLOAD });

  const competencyRows = db.calls.filter(({ sql }) => /INSERT INTO competency/i.test(sql));
  assert.equal(competencyRows.length, 2);
  for (const [i, call] of competencyRows.entries()) {
    assert.equal(
      call.args[0],
      `${roleId}:${PAYLOAD.competencies[i].id}`,
      "the model's slug alone is not unique across a client's candidates",
    );
    assert.equal(call.args[1], roleId, "and it hangs off the role it was written for");
  }
});

test("R3: axis is bound NULL and difficulty is bound as a NUMBER", async () => {
  const db = fakeD1([]);
  const { roleId } = await persistHandover(db, { inviteId: "inv-1", payload: PAYLOAD });

  const questionRows = db.calls.filter(({ sql }) => /INSERT INTO question/i.test(sql));
  assert.equal(questionRows.length, 3);

  const expected = [1, 3, 2]; // gentle, probing, standard — in payload order per competency
  for (const [i, call] of questionRows.entries()) {
    const [, , , axis, difficulty] = call.args;
    // 'core' would fail CHECK (axis IN ('lateral','vertical')) at insert. NULL passes because
    // a CHECK that evaluates to NULL is not a violation.
    assert.equal(axis, null, "the core bank is the rows with a NULL axis");
    assert.equal(
      typeof difficulty,
      "number",
      "SQLite stores 'standard' in an INTEGER column silently; #23's ORDER BY would sort as text",
    );
    assert.equal(difficulty, expected[i]);
  }

  // Question ids are namespaced on the competency ROW id, which is itself namespaced on the
  // role — so two candidates' question banks cannot collide either.
  assert.equal(questionRows[0].args[0], `${roleId}:lone-working#0`);
  assert.equal(questionRows[1].args[0], `${roleId}:lone-working#1`);
  assert.equal(questionRows[2].args[0], `${roleId}:documentation#0`);
});

test("persistHandover leaves stage and success_rate to their DDL defaults", async () => {
  const db = fakeD1([]);
  await persistHandover(db, { inviteId: "inv-1", payload: PAYLOAD });

  const { sql } = db.calls.find((c) => /INSERT INTO competency/i.test(c.sql));
  assert.ok(!/\bstage\b/.test(sql), "stage is #23's column, not this ticket's");
  assert.ok(!/success_rate/.test(sql), "and a send has produced no attempts to rate");
});

test("persistHandover refuses a handover with no invite to hang off", async () => {
  const db = fakeD1([]);
  assert.equal(await codeOf(() => persistHandover(db, { payload: PAYLOAD })), "missing_fields");
  assert.equal(db.calls.length, 0, "nothing may be written without the scope that purges it");
});

test("briefJsonByInviteId selects one column and mentions no other", async () => {
  const db = fakeD1([{ brief_json: "{}" }]);
  await briefJsonByInviteId(db, "inv-1");

  const { sql, args } = db.calls[0];
  // The CV, the brief and the agency's private ethos text live in this row. A SELECT * here
  // would put all three one JSON.parse away from a candidate's browser.
  assert.doesNotMatch(sql, /cv_text|jd_text|ethos_text|\*/, `too wide: ${sql}`);
  assert.match(sql, /^SELECT brief_json FROM candidate_role WHERE invite_id = \?$/i);
  assert.deepEqual(args, ["inv-1"]);
});
