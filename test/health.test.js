// Contract coverage for the health Function. The handler is called directly with a
// constructed Request and an explicit `env`, never `process.env` — the result must not
// depend on whose machine runs the suite, or on a `.dev.vars` being present.

import { test } from "node:test";
import assert from "node:assert/strict";

import { onRequestPost } from "../functions/api/health.js";

// Shaped nothing like a real credential on purpose: this is a public repo and secret
// scanners key on the `sk-ant-` prefix.
const KEY = "dummy-value-not-a-real-credential";

const post = (body, env) =>
  onRequestPost({
    request: new Request("http://localhost/api/health", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    }),
    env,
  });

test("no key bound answers 503, which is the correct answer rather than a bug", async () => {
  const res = await post("{}", {});
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { error: "not_configured" });
});

test("a malformed body is rejected", async () => {
  const res = await post("not json", { ANTHROPIC_API_KEY: KEY });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: "bad_json" });
});

test("a malformed body answers 400 even with no key bound", async () => {
  // DEPLOY.md's post-deploy checklist runs this step before the secret exists. Checking the
  // body first is what lets it mean "the Function is routed and parsing" rather than
  // re-reporting the missing secret.
  const res = await post("not json", {});
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: "bad_json" });
});

test("a fully wired deployment reports ok with the sdk constructed", async () => {
  const res = await post("{}", { ANTHROPIC_API_KEY: KEY });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    ok: true,
    service: "saulera-dossier-engine",
    key: true,
    sdk: true,
  });
});

test("ok tracks sdk: a failed construction never reads green", async () => {
  // The catch in health.js covers "constructing the client threw". Throwing from the env
  // getter reproduces that state without a module loader: the first read is the presence
  // check, the second is the one inside the try, at `new Anthropic({ apiKey: ... })`.
  let reads = 0;
  const env = {
    get ANTHROPIC_API_KEY() {
      if (++reads > 1) throw new Error("simulated construction failure");
      return KEY;
    },
  };

  const logged = [];
  const realError = console.error;
  console.error = (...args) => logged.push(args.join(" "));

  let body;
  try {
    const res = await post("{}", env);
    assert.equal(res.status, 200);
    body = await res.json();
  } finally {
    console.error = realError;
  }

  assert.equal(body.sdk, false);
  assert.equal(body.ok, false, "ok must not read green while sdk is false");
  assert.equal(body.key, true, "the key was bound; it is the SDK that failed");

  // The diagnostic reaches the Pages log and stays out of the response body.
  assert.equal(logged.length, 1);
  assert.match(logged[0], /simulated construction failure/);
  assert.doesNotMatch(JSON.stringify(body), /simulated/);
});

test("the key's value never appears in a response body", async () => {
  for (const env of [{}, { ANTHROPIC_API_KEY: KEY }]) {
    const res = await post("{}", env);
    assert.doesNotMatch(await res.text(), new RegExp(KEY));
  }
});
