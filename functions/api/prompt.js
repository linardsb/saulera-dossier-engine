// POST /api/prompt { client_id, brief, cv } -> 200 { prompt, client: { id, name } }
//
// The outbound half of the generation seam (#6 as amended, #8). It assembles the one string a
// recruiter pastes into their own Claude session: SYSTEM, the client note, the brief, the CV,
// and the pack schema as text.
//
// There is no model call here and there is not going to be one. A Pages Function cannot use
// subscription auth — that is a short-lived OAuth token in a local credential file, and a V8
// isolate has no filesystem and no process to refresh it — so a call from here would mean a
// per-token API key, and the standing decision is that this deployment has no key (README,
// Decisions). The model call happens in the recruiter's session; `/api/verify` is the half that
// takes the answer back.
//
// ⚠ Stateless with respect to candidates (also in #5). The brief and the CV are held for the
// life of this request and written nowhere: not to D1, not to a log line, not into an error
// message. The event counter is the only thing that persists and it carries neither.

import { getClient } from "../../src/store.js";
import { buildPastePrompt, cleanInput } from "../../src/prompt.js";
import { json, readJson, sameOrigin, errorResponse } from "../../src/http.js";

// The whole body vocabulary, guarded the way POST /api/events guards its own. This is an
// endpoint a well-meaning change would extend with a `candidate_name` "just so the pack can
// address them" — answering 400 rather than ignoring the key is what makes that fail loudly.
const ALLOWED = new Set(["client_id", "brief", "cv"]);

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

    // 404 before any work, not after: an unknown client id should cost nothing.
    const client = await getClient(env.DB, body.client_id);

    // A client with no note is a real state — the agency added it and has not written anything
    // down yet — and refusing is the honest answer rather than a validation nicety. The note is
    // the one thing this pack has that a job board does not, so generating without it produces
    // a pack whose whole premise is missing. The screen sends the recruiter to /clients instead.
    //
    // Trimmed, so a note of only whitespace counts as empty. `cleanNote` deliberately stores
    // the note untouched, which means "  \n  " is a value the store will happily keep.
    if (!String(client.note ?? "").trim()) {
      return json({ error: "note_empty" }, 400);
    }

    const prompt = buildPastePrompt({
      clientName: client.name,
      clientNote: client.note,
      brief: cleanInput(body.brief, "brief"),
      cv: cleanInput(body.cv, "cv"),
    });

    // The id and the name only. The note travels inside `prompt` because that is what the
    // prompt is for, and nowhere else: store.js:44-48 makes the same argument about the list
    // query, and the screen has no use for a second copy of it.
    return json({ prompt, client: { id: client.id, name: client.name } });
  } catch (err) {
    return errorResponse(err);
  }
}
