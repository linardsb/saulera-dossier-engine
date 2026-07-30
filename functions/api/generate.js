// POST /api/generate { client_id, brief, cv }
//   -> 201 { pack, provenance, failures, renderer, text, html, event_recorded }
//
// The pack's model call (#6, superseded 28 Jul 2026). Architecture §5.6: "Every model call goes
// through one Function, which is also the boundary that lets the data posture in §6.4 stay
// switchable." The switchability is the whole reason a call lives in a Function rather than in a
// helper anyone can reach for.
//
// THIS IS NO LONGER THE ONLY CALL SITE, and the rule this header used to state — "do not add a
// second" — has one sanctioned exception, so it is written down here rather than left for the
// next reader to discover as a contradiction. Architecture §5 names exactly TWO: "at Send
// (claude-opus-5)" and "in session (claude-sonnet-5)". The first of those is
// functions/api/prep/prepare.js, whose header claims the exemption and argues it. A THIRD call
// site that is not in §5 is still wrong.
//
// The response shape is deliberately IDENTICAL to /api/verify's: the screen renders a pack the
// same way whichever route produced it, and a divergence here would fork the one renderer path
// the product has. A thin adapter otherwise, the same shape as the other five: parse, guard,
// delegate, serialise.
//
// ⚠ Stateless with respect to candidates (also in #5 and #8). The brief, the CV and the pack
// are held for the life of the request and written nowhere — not to D1, not to a log. The
// event counter is the only thing that persists, and it carries no name and no CV content.

import Anthropic from "@anthropic-ai/sdk";

import { generatePack } from "../../src/generate.js";
import { getClient, getAgency, recordEvent } from "../../src/store.js";
import { render } from "../../src/render/index.js";
import { json, readJson, sameOrigin, errorResponse } from "../../src/http.js";

// The whole body vocabulary, guarded the same way `POST /api/events` guards its own. This is
// the endpoint a well-meaning change would extend with a `candidate_name` "just so the pack
// can address them" — answering 400 rather than ignoring the key is what makes that fail
// loudly, and it costs three lines.
const ALLOWED = new Set(["client_id", "brief", "cv"]);

export async function onRequestPost(context) {
  const { request, env } = context;

  // Two separate deployment faults with two separate remedies: no database binding, and no
  // model key. Both are 503 — neither is something the caller can fix — but a screen that
  // says which one is a screen that gets fixed in a minute rather than an afternoon.
  if (!env.DB) return json({ error: "not_configured" }, 503);
  if (!env.ANTHROPIC_API_KEY) return json({ error: "no_model_key" }, 503);
  if (!sameOrigin(request)) return json({ error: "cross_origin" }, 403);

  try {
    const body = await readJson(request);
    const unexpected = Object.keys(body).filter((key) => !ALLOWED.has(key));
    if (unexpected.length) {
      return json({ error: "unexpected_fields", fields: unexpected }, 400);
    }

    // 404 before the model call, not after: an unknown client id should cost nothing.
    const client = await getClient(env.DB, body.client_id);
    const agency = await getAgency(env.DB);

    const result = await generatePack(
      new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }),
      {
        clientName: client.name,
        clientNote: client.note,
        brief: body.brief,
        cv: body.cv,
      },
    );

    // The VERIFIED pack — generatePack has already run the literal-quote check and demoted
    // anything that failed it. Same one-token trap as verify.js: rendering anything else here
    // would ship unverified claims looking sourced.
    const rendered = render(result.pack, agency.renderer);

    // The duration is measured server-side, around the model call. A caller who can set the
    // time can rewrite the metric, which is the same reason the timestamp is the database's.
    let eventRecorded = true;
    try {
      await recordEvent(env.DB, {
        clientId: client.id,
        durationMs: result.duration_ms,
      });
    } catch {
      // The pack is the product and the recruiter has waited minutes for it — losing it to a
      // failed COUNT insert is indefensible. But #5 names the counter as the first thing that
      // gets silently descoped, so the failure is reported rather than swallowed.
      eventRecorded = false;
    }

    return json(
      {
        pack: result.pack,
        provenance: result.provenance,
        failures: result.failures,
        renderer: agency.renderer,
        text: rendered.text,
        html: rendered.html,
        event_recorded: eventRecorded,
      },
      201,
    );
  } catch (err) {
    return errorResponse(err);
  }
}
