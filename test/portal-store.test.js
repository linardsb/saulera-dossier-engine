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
import { deleteInviteByTokenHash, hashToken, purgeExpired } from "../src/portal/store.js";

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
  // candidate holding a stale link is already in the clean state the button promises.
  assert.deepEqual(result, { ok: true });
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
