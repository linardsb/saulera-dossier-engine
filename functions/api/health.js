// POST /api/health  { }  →  { ok, service, key, sdk }
// Answers whether this deployment is wired up: the Function is routed and the model key is
// bound server-side. It reports the key's presence as a boolean and never its value — the
// key is the one thing on this deployment that must never reach a browser.
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

  // Constructed and discarded. The generation route is a later ticket, but its dependency
  // has to be proven to bundle and initialise on Pages now — a bare import can resolve
  // without ever touching the paths that need nodejs_compat. No network call is made.
  let sdk = false;
  try {
    new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    sdk = true;
  } catch {
    sdk = false;
  }

  return json({ ok: true, service: SERVICE, key: true, sdk }, 200);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
