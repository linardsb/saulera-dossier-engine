// POST /api/health  { }  →  { ok, service, key, sdk }
// Answers whether this deployment is wired up: the Function is routed, the model key is
// bound server-side, and the SDK bundles and constructs. `ok` is the roll-up of those — it
// is true only when `sdk` is. It reports the key's presence as a boolean and never its
// value — the key is the one thing on this deployment that must never reach a browser.
//
// Needs one Pages secret (Dashboard → Workers & Pages → saulera-dossier-engine →
// Settings → Variables and Secrets), set for Production and Preview:
//   ANTHROPIC_API_KEY — an Anthropic API key (sk-ant-...). Without it this returns 503;
//                       that is the correct answer, not a bug.

import Anthropic from "@anthropic-ai/sdk";

const SERVICE = "saulera-dossier-engine";

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.ANTHROPIC_API_KEY) {
    return json({ error: "not_configured" }, 503);
  }

  try {
    await request.json();
  } catch {
    return json({ error: "bad_json" }, 400);
  }

  // Constructed and discarded, so the generation route's dependency is proven to bundle and
  // initialise on Pages before #6 depends on it. No network call is made.
  //
  // What this does and does not prove. Passing apiKey explicitly is precisely what makes the
  // SDK's credential-resolution chain unnecessary — and `lib/credentials/*` is where its
  // `node:` imports live. So this proves the module graph loads and the constructor runs; it
  // does not exercise the code nodejs_compat exists for. The flag is still required for the
  // bundle to be valid, and the first real `messages.create()` in #6 remains the actual test.
  let sdk = false;
  try {
    new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    sdk = true;
  } catch (err) {
    // To the Pages log (`wrangler tail`), never the response body: `sdk: false` on its own
    // is not actionable. Only the message is logged, and constructor errors do not echo the
    // key — the never-leak-the-key constraint holds.
    console.error("SDK construction failed:", err?.message);
    sdk = false;
  }

  // `ok` means fully wired, so it tracks `sdk`. A 200 body reading `{ ok: true, sdk: false }`
  // would report green for exactly the bundling failure this endpoint exists to catch.
  return json({ ok: sdk, service: SERVICE, key: true, sdk }, 200);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
