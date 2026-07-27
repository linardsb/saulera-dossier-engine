// #5 — the HTTP helpers the four Functions share.
//
// `sameOrigin` is the CSRF bolt behind Decision 2: Cloudflare Access is the door and it
// authenticates with a cookie, so a cross-site POST riding a reader's Access cookie is the
// thing this function exists to refuse. It is a pure function with no D1 dependency and it was
// the only security-relevant code in `src/` with no test at all.
//
// `readJson` is here for the same reason one file's worth of parsing bugs used to reach four
// handlers: it is the single place every mutating endpoint's body passes through.

import { test } from "node:test";
import assert from "node:assert/strict";

import { json, readJson, sameOrigin, errorResponse } from "../src/http.js";
import { StoreError } from "../src/store.js";

const URL_UNDER_TEST = "https://saulera-dossier-engine.pages.dev/api/clients";

/** A POST carrying exactly the headers named, and nothing the runtime adds by default. */
function post(headers, body) {
  return new Request(URL_UNDER_TEST, { method: "POST", headers, body });
}

// ── sameOrigin ─────────────────────────────────────────────────────────────────────────

test("sameOrigin trusts Sec-Fetch-Site when the browser sends it", () => {
  assert.equal(sameOrigin(post({ "Sec-Fetch-Site": "same-origin" })), true);

  // same-site is NOT same-origin: a sibling subdomain is a different origin and shares the
  // cookie, which is exactly the shape of the attack this refuses.
  for (const site of ["cross-site", "same-site", "none"]) {
    assert.equal(sameOrigin(post({ "Sec-Fetch-Site": site })), false, `Sec-Fetch-Site: ${site}`);
  }
});

test("sameOrigin falls back to Origin, and lets a request with neither through", () => {
  // curl and local scripts send no Origin. Refusing them would break every debugging session
  // for no gain: a browser is what carries the cookie, and a browser sends Sec-Fetch-Site.
  assert.equal(sameOrigin(post({})), true, "no Sec-Fetch-Site and no Origin is curl");

  assert.equal(
    sameOrigin(post({ Origin: "https://saulera-dossier-engine.pages.dev" })),
    true,
  );
  assert.equal(sameOrigin(post({ Origin: "https://evil.example" })), false);
  // A different scheme or port is a different origin, however similar the host looks.
  assert.equal(
    sameOrigin(post({ Origin: "http://saulera-dossier-engine.pages.dev" })),
    false,
    "http is not https",
  );
});

test("Sec-Fetch-Site wins over Origin when both are present", () => {
  assert.equal(
    sameOrigin(post({ "Sec-Fetch-Site": "cross-site", Origin: URL_UNDER_TEST })),
    false,
    "a forged Origin must not talk the guard round the browser's own header",
  );
});

// ── readJson ───────────────────────────────────────────────────────────────────────────

test("readJson returns an object body unchanged", async () => {
  const body = await readJson(post({ "content-type": "application/json" }, '{"note":"  x  "}'));
  assert.deepEqual(body, { note: "  x  " }, "the note is not touched on the way in");
});

test("readJson answers 400 for JSON that is valid but is not an object", async () => {
  // All four parse without throwing, so the `= {}` defaults downstream never fired — those
  // apply to `undefined` only — and every mutating endpoint answered 500. On this deployment
  // 500 means deployment fault, and a caller-fault body must not pollute that signal.
  for (const raw of ["null", "[]", "42", '"a string"', "true"]) {
    const err = await readJson(post({ "content-type": "application/json" }, raw))
      .then(() => null, (e) => e);
    assert.ok(err instanceof StoreError, `${raw} should throw a StoreError`);
    assert.equal(err.code, "bad_json", raw);
    assert.equal(err.status, 400, raw);
  }
});

test("readJson answers 400 for a body that is not JSON at all", async () => {
  const err = await readJson(post({ "content-type": "application/json" }, "{not json"))
    .then(() => null, (e) => e);
  assert.equal(err.code, "bad_json");
  assert.equal(err.status, 400);
});

// ── the response shapes ────────────────────────────────────────────────────────────────

test("json() defaults to 200 and no-store", async () => {
  const res = json({ ok: true });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Content-Type"), "application/json");
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await res.json(), { ok: true });
});

test("errorResponse maps a StoreError and leaks nothing from anything else", async () => {
  const mapped = errorResponse(new StoreError("not_found", 404, "no client with id abc"));
  assert.equal(mapped.status, 404);
  assert.deepEqual(await mapped.json(), { error: "not_found" });

  // A bug in this code is not a fault the caller can fix, and its message may name internals.
  const leaky = errorResponse(new Error("D1_ERROR: no such table: clients at /src/store.js:51"));
  assert.equal(leaky.status, 500);
  const body = await leaky.json();
  assert.deepEqual(body, { error: "internal" });
  assert.ok(!JSON.stringify(body).includes("store.js"), "no internal detail reaches the caller");
});
