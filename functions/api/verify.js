// POST /api/verify { client_id, cv, pack_text, duration_ms }
//   -> 201 { pack, provenance, failures, renderer, text, html, event_recorded }
//
// The inbound half of the generation seam (#6 as amended, #8). The recruiter pastes back what
// their Claude session answered; this extracts the pack, checks every claim against the actual
// source text, renders it, and records the event.
//
// This is where the sourcing promise stops being a promise. The model was ASKED for verbatim
// quotes by the prompt; `verifyPack` is what checks, and anything that fails comes back demoted
// to unverified and marked — never dropped, never silently promoted (#6 AC6). Nothing in this
// file can turn a failed check back into a sourced claim, and the rendering below is of the
// VERIFIED pack rather than the pasted one, which is the difference between the property
// holding and only appearing to.
//
// ⚠ Stateless with respect to candidates. The CV and the pack are held for the life of this
// request and written nowhere: not to D1, not to a log line, not into an error message. The
// event counter is the only thing that persists and it carries neither.

import { getClient, getAgency, recordEvent, StoreError } from "../../src/store.js";
import { extractPack } from "../../src/paste.js";
import { assertPack } from "../../src/pack.js";
import { cleanInput } from "../../src/prompt.js";
import { verifyPack, provenanceSummary } from "../../src/provenance.js";
import { render } from "../../src/render/index.js";
import { json, readJson, sameOrigin, errorResponse } from "../../src/http.js";

// The whole body vocabulary. No `brief`: the brief is not a source type (pack.js:8) and
// `verifyPack` takes `{ cv, clientNote }` only, so a brief here would be a field nothing reads
// — and a body vocabulary that grows "just in case" is what ALLOWED exists to stop.
const ALLOWED = new Set(["client_id", "cv", "pack_text", "duration_ms"]);

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.DB) return json({ error: "not_configured" }, 503);
  if (!sameOrigin(request)) return json({ error: "cross_origin" }, 403);

  try {
    const body = await readJson(request);
    const unexpected = Object.keys(body).filter((key) => !ALLOWED.has(key));
    if (unexpected.length) {
      return json({ error: "unexpected_fields", fields: unexpected }, 400);
    }

    // Deployment faults before caller faults, so DEPLOY.md's triage table stays readable: an
    // unbound database and an unmigrated one are 503s the recruiter cannot fix, and finding
    // them out after a paste error would send someone to the wrong remedy.
    const client = await getClient(env.DB, body.client_id);
    const agency = await getAgency(env.DB);

    // The haystack. This must be the exact text that went into the prompt — the screen freezes
    // the inputs when the prompt is copied for that reason. If it differs the claims demote,
    // which is the check failing CLOSED and therefore correct, but it shows the recruiter a
    // pack that looks worse than it is.
    const cv = cleanInput(body.cv, "cv");

    const parsed = extractPack(body.pack_text);

    // assertPack throws a plain Error, and errorResponse maps anything that is not a StoreError
    // to 500. Without this wrap a malformed paste reads as a deployment fault. The message
    // names a field (e.g. "pack: evidence[0].source_type is probably") and never reaches the
    // wire — errorResponse forwards the code alone — so the screen supplies the human copy.
    let pack;
    try {
      pack = assertPack(parsed);
    } catch (err) {
      throw new StoreError("bad_pack", 400, err.message);
    }

    const verified = verifyPack(pack, { cv, clientNote: client.note });

    // The VERIFIED pack, in all three of these. Rendering `pack` here instead would be a
    // one-token slip that ships unverified claims looking sourced.
    const rendered = render(verified.pack, agency.renderer);
    const provenance = provenanceSummary(verified.pack);

    let eventRecorded = true;
    try {
      await recordEvent(env.DB, {
        clientId: client.id,
        durationMs: body.duration_ms,
      });
    } catch {
      // The pack is the product and the recruiter has waited minutes for it — losing it to a
      // failed COUNT insert is indefensible. But #5 names the counter as the first thing that
      // gets silently descoped, so the failure is reported rather than swallowed.
      eventRecorded = false;
    }

    return json(
      {
        pack: verified.pack,
        provenance,
        failures: verified.failures,
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
