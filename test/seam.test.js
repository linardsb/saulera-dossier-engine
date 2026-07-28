// The generation seam, end to end (#6 as amended, #8 AC3 and AC4).
//
// Both Functions are imported and driven directly, with fakeD1 standing in for the database.
// That works because `Request`, `Response` and `crypto.randomUUID` are Node globals and a Pages
// Function is a plain ES module — verified 27 Jul 2026 against functions/api/agency.js.
// (src/store.js:5-7 says a Function cannot be imported into `node --test`. That claim is wrong
// and is not this ticket's to fix, but it should not stop anyone writing this file.)
//
// It matters that these run here rather than only under curl. The property #6 AC6 turns on —
// a tampered quote comes back demoted, MARKED, and still PRESENT in both the pack and the
// rendered output — is a property of the whole path, and it is the product's central claim.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { fakeD1 } from "./helpers/fake-d1.js";
import { onRequestPost as promptRoute } from "../functions/api/prompt.js";
import { onRequestPost as verifyRoute } from "../functions/api/verify.js";
import { INPUT_MAX } from "../src/prompt.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const RAW_PACK = read("spike/pack.json");
const CV = read("spike/inputs/cv.md");
const BRIEF = read("spike/inputs/brief.md");
const NOTE = read("spike/inputs/client-note.md");

const CLIENT = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Ashdown Park Community Healthcare",
  note: NOTE,
  created_at: "2026-07-27 10:00:00",
  updated_at: "2026-07-27 10:00:00",
};

const AGENCY = {
  id: 1,
  name: "",
  send_format: "email_body",
  renderer: "appendix",
  updated_at: "2026-07-27 10:00:00",
};

const fenced = (json) => "Here is the submission pack.\n\n```json\n" + json + "\n```\n\nDone.";

/**
 * A Pages Function context.
 *
 * `Sec-Fetch-Site: same-origin` is set explicitly on every request. http.js:47 lets a request
 * with neither Sec-Fetch-Site nor Origin through — "curl and local scripts have no Origin" —
 * so a bare `new Request()` would pass sameOrigin for the wrong reason and the 403 branch would
 * be untested. The cross-origin case sets `cross-site` for the same reason.
 */
function ctx(body, { db = fakeD1([]), site = "same-origin", raw } = {}) {
  return {
    request: new Request("https://dossier.example/api/x", {
      method: "POST",
      headers: { "content-type": "application/json", "Sec-Fetch-Site": site },
      body: raw !== undefined ? raw : JSON.stringify(body),
    }),
    env: { DB: db },
  };
}

const readJson = async (res) => ({ status: res.status, body: await res.json() });

// ── POST /api/prompt ───────────────────────────────────────────────────────────────────

test("/api/prompt returns one string carrying the note, the brief and the CV", async () => {
  const db = fakeD1([CLIENT]);
  const { status, body } = await readJson(
    await promptRoute(ctx({ client_id: CLIENT.id, brief: BRIEF, cv: CV }, { db })),
  );

  assert.equal(status, 200);
  assert.ok(body.prompt.includes(NOTE.trim().slice(0, 80)), "the note must reach the prompt");
  assert.ok(body.prompt.includes(CV.trim().slice(0, 80)), "the CV must reach the prompt");
  assert.ok(body.prompt.includes(BRIEF.trim().slice(0, 80)), "the brief must reach the prompt");
  assert.match(body.prompt, /Return ONE JSON object and nothing else/);
});

test("/api/prompt returns the client's id and name and never its note", async () => {
  // The note is business-context personal data naming hiring managers (§5.3). It belongs in the
  // prompt, which is what the recruiter pastes, and in no other field of this response.
  const db = fakeD1([CLIENT]);
  const { body } = await readJson(
    await promptRoute(ctx({ client_id: CLIENT.id, brief: BRIEF, cv: CV }, { db })),
  );

  assert.deepEqual(Object.keys(body).sort(), ["client", "prompt"]);
  assert.deepEqual(body.client, { id: CLIENT.id, name: CLIENT.name });
  assert.equal(body.client.note, undefined);
});

test("/api/prompt without a DB binding is 503 not_configured", async () => {
  const { status, body } = await readJson(
    await promptRoute({
      request: new Request("https://dossier.example/api/prompt", { method: "POST" }),
      env: {},
    }),
  );
  assert.equal(status, 503);
  assert.equal(body.error, "not_configured");
});

test("/api/prompt refuses a cross-origin post", async () => {
  const db = fakeD1([CLIENT]);
  const { status, body } = await readJson(
    await promptRoute(ctx({ client_id: CLIENT.id, brief: BRIEF, cv: CV }, { db, site: "cross-site" })),
  );
  assert.equal(status, 403);
  assert.equal(body.error, "cross_origin");
});

test("/api/prompt answers 400 bad_json for a null or non-object body", async () => {
  for (const raw of ["null", "[]", "42", "not json at all"]) {
    const { status, body } = await readJson(
      await promptRoute(ctx(null, { db: fakeD1([CLIENT]), raw })),
    );
    assert.equal(status, 400, `for body ${raw}`);
    assert.equal(body.error, "bad_json", `for body ${raw}`);
  }
});

test("/api/prompt answers 400 unexpected_fields for a key outside the vocabulary", async () => {
  const { status, body } = await readJson(
    await promptRoute(
      ctx(
        { client_id: CLIENT.id, brief: BRIEF, cv: CV, candidate_name: "Aoife Brennan" },
        { db: fakeD1([CLIENT]) },
      ),
    ),
  );
  assert.equal(status, 400);
  assert.equal(body.error, "unexpected_fields");
  assert.deepEqual(body.fields, ["candidate_name"]);
});

test("/api/prompt answers 404 for an unknown client, before doing any work", async () => {
  const db = fakeD1([null]);
  const { status, body } = await readJson(
    await promptRoute(ctx({ client_id: "nope", brief: BRIEF, cv: CV }, { db })),
  );
  assert.equal(status, 404);
  assert.equal(body.error, "not_found");
  assert.equal(db.calls.length, 1, "an unknown client id should cost one SELECT and nothing else");
});

test("/api/prompt refuses a client whose note is empty or only whitespace", async () => {
  for (const note of ["", "   \n\t  "]) {
    const db = fakeD1([{ ...CLIENT, note }]);
    const { status, body } = await readJson(
      await promptRoute(ctx({ client_id: CLIENT.id, brief: BRIEF, cv: CV }, { db })),
    );
    assert.equal(status, 400, `for note ${JSON.stringify(note)}`);
    assert.equal(body.error, "note_empty", `for note ${JSON.stringify(note)}`);
  }
});

test("/api/prompt rejects an empty brief or CV with missing_fields", async () => {
  for (const patch of [{ brief: "" }, { cv: "   " }, { brief: null }, { cv: undefined }]) {
    const db = fakeD1([CLIENT]);
    const { status, body } = await readJson(
      await promptRoute(ctx({ client_id: CLIENT.id, brief: BRIEF, cv: CV, ...patch }, { db })),
    );
    assert.equal(status, 400, `for ${JSON.stringify(patch)}`);
    assert.equal(body.error, "missing_fields", `for ${JSON.stringify(patch)}`);
  }
});

test("/api/prompt rejects an over-long CV with too_long", async () => {
  const db = fakeD1([CLIENT]);
  const { status, body } = await readJson(
    await promptRoute(
      ctx({ client_id: CLIENT.id, brief: BRIEF, cv: "x".repeat(INPUT_MAX + 1) }, { db }),
    ),
  );
  assert.equal(status, 400);
  assert.equal(body.error, "too_long");
});

// ── POST /api/verify ───────────────────────────────────────────────────────────────────
//
// fakeD1 queues ONE result per prepare(), in call order. /api/verify calls getClient (1),
// getAgency (2), then recordEvent -> requireClient (3) + INSERT (4). Queue four, in that order.
// Get it wrong and the agency row answers as the client row and the assertions pass for the
// wrong reason.
const verifyDb = (overrides = {}) =>
  fakeD1([
    overrides.client === undefined ? CLIENT : overrides.client,
    overrides.agency === undefined ? AGENCY : overrides.agency,
    overrides.eventClient === undefined ? { id: CLIENT.id } : overrides.eventClient,
    {},
  ]);

test("/api/verify renders a clean pack and records the event", async () => {
  const db = verifyDb();
  const { status, body } = await readJson(
    await verifyRoute(
      ctx({ client_id: CLIENT.id, cv: CV, pack_text: fenced(RAW_PACK), duration_ms: 254_000 }, { db }),
    ),
  );

  assert.equal(status, 201);
  assert.deepEqual(body.failures, [], "the spike pack verifies clean");
  assert.equal(body.provenance.total, 14);
  assert.equal(body.provenance.cv + body.provenance.client_note + body.provenance.unverified, 14);
  assert.equal(body.renderer, "appendix", "the renderer comes from the agency row, not a menu");
  assert.ok(body.text.length > 0 && body.html.length > 0);
  assert.equal(body.event_recorded, true);
});

test("/api/verify records the duration the browser measured, and nothing else", async () => {
  const db = verifyDb();
  await verifyRoute(
    ctx({ client_id: CLIENT.id, cv: CV, pack_text: fenced(RAW_PACK), duration_ms: 254_000 }, { db }),
  );

  const insert = db.calls.find((c) => /INSERT INTO events/i.test(c.sql));
  assert.ok(insert, "the event must be inserted");
  assert.deepEqual(insert.args, [CLIENT.id, 254_000]);
  // AC4, asserted against the SQL because that is the only place it is visible. A candidate_ref
  // column added "just for debugging" breaches the boundary architecture §5.6 calls expensive
  // to unpick, and this is the runtime half of the guard schema.test.js holds on the migration.
  for (const forbidden of ["candidate", "cv", "pack", "brief", "name", "role"]) {
    assert.doesNotMatch(
      insert.sql,
      new RegExp(`\\b${forbidden}\\b`, "i"),
      `the events insert must not mention ${forbidden}`,
    );
  }
});

test("a tampered quote comes back demoted, marked, and still present", async () => {
  // The central property. The claim is NOT dropped and NOT silently promoted: it is in the
  // pack, its source_type is unverified, failed_quote preserves what the model thought it was
  // citing, and the rendered output the recruiter copies says UNVERIFIED.
  const tampered = JSON.parse(RAW_PACK);
  const original = tampered.evidence[0].source_quote;
  tampered.evidence[0].source_quote = "registration is current and valid";

  const db = verifyDb();
  const { status, body } = await readJson(
    await verifyRoute(
      ctx(
        { client_id: CLIENT.id, cv: CV, pack_text: fenced(JSON.stringify(tampered)), duration_ms: 1 },
        { db },
      ),
    ),
  );

  assert.equal(status, 201);
  assert.equal(body.failures.length, 1);
  assert.equal(body.failures[0].reason, "quote not found in source");

  const claim = body.pack.evidence[0];
  assert.equal(claim.source_type, "unverified");
  assert.equal(claim.failed_quote, "registration is current and valid");
  assert.equal(claim.text, tampered.evidence[0].text, "the claim must still be present");
  assert.notEqual(claim.source_quote, original);

  assert.equal(body.provenance.total, 14, "demotion moves a claim between counts, never out");

  // The rendering is of the VERIFIED pack. Rendering the pasted one instead would ship a
  // demoted claim looking sourced, which is the failure mode this whole seam exists to prevent.
  //
  // Asserted against a clean baseline rather than as `match(/UNVERIFIED/)`. The spike pack
  // already contains one honestly-unverified claim, so a bare match is satisfied by the
  // boilerplate and by that claim, and passes identically whether the verified or the pasted
  // pack was rendered — measured: it did. The count is what actually moves.
  const clean = await readJson(
    await verifyRoute(
      ctx({ client_id: CLIENT.id, cv: CV, pack_text: fenced(RAW_PACK), duration_ms: 1 }, {
        db: verifyDb(),
      }),
    ),
  );
  const marks = (s) => (String(s).match(/UNVERIFIED/g) ?? []).length;

  assert.equal(
    marks(body.text),
    marks(clean.body.text) + 1,
    "the demoted claim must be marked in the text the recruiter copies",
  );
  assert.equal(
    marks(body.html),
    marks(clean.body.html) + 1,
    "the demoted claim must be marked in the html the recruiter copies",
  );
  // A demoted claim loses its numbered citation: it is no longer standing on a source.
  const citations = (s) => (String(s).match(/^\[\d+\] /gm) ?? []).length;
  assert.equal(citations(body.text), citations(clean.body.text) - 1);
  // And the quote it could not stand up never appears in the SOURCES appendix.
  assert.doesNotMatch(body.text.split("SOURCES")[1], /registration is current and valid/);
});

test("/api/verify answers 400 no_pack for a paste with no object in it", async () => {
  const db = verifyDb();
  const { status, body } = await readJson(
    await verifyRoute(
      ctx(
        { client_id: CLIENT.id, cv: CV, pack_text: "Sorry, I need more information.", duration_ms: 1 },
        { db },
      ),
    ),
  );
  assert.equal(status, 400);
  assert.equal(body.error, "no_pack");
});

test("/api/verify answers 400 bad_pack for a malformed pack, never 500", async () => {
  // 500 means deployment fault on this deployment (DEPLOY.md's triage table). A paste the
  // recruiter can fix must not pollute that signal.
  const bad = JSON.parse(RAW_PACK);
  bad.evidence[0].source_type = "probably";

  const db = verifyDb();
  const { status, body } = await readJson(
    await verifyRoute(
      ctx(
        { client_id: CLIENT.id, cv: CV, pack_text: fenced(JSON.stringify(bad)), duration_ms: 1 },
        { db },
      ),
    ),
  );
  assert.equal(status, 400);
  assert.equal(body.error, "bad_pack");
  // assertPack's message names a field. errorResponse forwards the code alone, so it stays off
  // the wire — the screen supplies the human copy.
  assert.deepEqual(Object.keys(body), ["error"]);
});

test("a failed event insert still returns the pack, with event_recorded false", async () => {
  // The recruiter has waited minutes for this. Losing it to a failed COUNT insert is
  // indefensible; hiding the failure is how the counter gets silently descoped.
  const db = verifyDb({ eventClient: null }); // requireClient finds nothing -> recordEvent throws
  const { status, body } = await readJson(
    await verifyRoute(
      ctx({ client_id: CLIENT.id, cv: CV, pack_text: fenced(RAW_PACK), duration_ms: 1 }, { db }),
    ),
  );

  assert.equal(status, 201);
  assert.equal(body.event_recorded, false);
  assert.equal(body.provenance.total, 14, "the pack survives a counter failure intact");
  assert.ok(body.text.length > 0);
});

test("/api/verify answers 400 missing_fields for an empty CV rather than demoting everything", async () => {
  const db = verifyDb();
  const { status, body } = await readJson(
    await verifyRoute(
      ctx({ client_id: CLIENT.id, cv: "  ", pack_text: fenced(RAW_PACK), duration_ms: 1 }, { db }),
    ),
  );
  assert.equal(status, 400);
  assert.equal(body.error, "missing_fields");
});

test("/api/verify rejects a brief, which is not a source type", async () => {
  const db = verifyDb();
  const { status, body } = await readJson(
    await verifyRoute(
      ctx(
        { client_id: CLIENT.id, cv: CV, pack_text: fenced(RAW_PACK), duration_ms: 1, brief: BRIEF },
        { db },
      ),
    ),
  );
  assert.equal(status, 400);
  assert.equal(body.error, "unexpected_fields");
  assert.deepEqual(body.fields, ["brief"]);
});

test("/api/verify without a DB binding is 503, and refuses cross-origin", async () => {
  const noDb = await verifyRoute({
    request: new Request("https://dossier.example/api/verify", { method: "POST" }),
    env: {},
  });
  assert.equal(noDb.status, 503);
  assert.equal((await noDb.json()).error, "not_configured");

  const crossed = await verifyRoute(
    ctx({ client_id: CLIENT.id, cv: CV, pack_text: fenced(RAW_PACK), duration_ms: 1 }, {
      db: verifyDb(),
      site: "cross-site",
    }),
  );
  assert.equal(crossed.status, 403);
  assert.equal((await crossed.json()).error, "cross_origin");
});

test("/api/verify answers 503 not_migrated when the agency row is missing", async () => {
  const db = verifyDb({ agency: null });
  const { status, body } = await readJson(
    await verifyRoute(
      ctx({ client_id: CLIENT.id, cv: CV, pack_text: fenced(RAW_PACK), duration_ms: 1 }, { db }),
    ),
  );
  assert.equal(status, 503);
  assert.equal(body.error, "not_migrated");
});

test("an edited client note demotes the claims that were sourced against the old text", async () => {
  // Open Question 5, asserted rather than left to be reported as a bug. The verifier reads the
  // note fresh, so editing it between prompt and verify fails claims CLOSED. That is correct
  // and it is worth knowing before someone files it.
  const db = verifyDb({ client: { ...CLIENT, note: "Rewritten. Nothing in common." } });
  const { body } = await readJson(
    await verifyRoute(
      ctx({ client_id: CLIENT.id, cv: CV, pack_text: fenced(RAW_PACK), duration_ms: 1 }, { db }),
    ),
  );

  assert.ok(body.failures.length > 0, "note-sourced claims must fail against a rewritten note");
  for (const failure of body.failures) {
    assert.equal(failure.claimed_source, "client_note");
  }
  assert.equal(body.provenance.total, 14, "failed claims are demoted, never dropped");
});
