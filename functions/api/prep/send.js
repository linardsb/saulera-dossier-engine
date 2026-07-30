// POST /api/prep/send { client_id, email, interview_at, brief, cv, payload, strike }
//   -> 201 { ok, sent_at, competencies, event_recorded }
//
// Step two of the two-step Send (#22): the recruiter has read the preview and struck what they
// disagreed with. This re-runs the whole contract on what arrived, writes the invite scope,
// mints the magic link, emails it, and records the count LAST.
//
// ⚠ RECRUITER ROUTE — see functions/api/prep/prepare.js's header. A file at
// functions/prep/send.js would be an unauthenticated endpoint that mints magic links, because
// scripts/setup-access.py:110-111 puts `Bypass → Everyone` on that whole tree.
//
// ⚠ THIS FILE MUST NOT IMPORT THE ANTHROPIC SDK, and has no reason to: the payload arrives in
// the body. Keeping that import out is what makes the module importable into `node --test`,
// and test/prep-send.test.js is the only place the constraints below are proved against real
// SQL. A well-meaning "regenerate if the payload looks stale" branch would cost this ticket
// its integration test. (Written without the package name on purpose: a Level 1 gate greps
// this file for it, and a gate that cries wolf at a comment gets deleted — public/app.js:19-20
// makes the same move for the browser-storage APIs.)
//
// WHY TRUSTING THE BROWSER FOR THE PAYLOAD IS SAFE ENOUGH. The alternatives were worse: a
// second ~30p Opus call at confirm would describe different competencies from the ones the
// recruiter just struck, and persisting a draft at prepare means storing a CV for a send that
// may never happen. What makes the round trip acceptable is that re-verification is not a
// formality — `verifyBrief` RECOMPUTES `verified` from `source_quote` on every pass
// (src/prep/verify.js:34) and never reads the incoming one, so a payload arriving with
// `verified: true` hand-set on a fabricated competency is demoted and the send refused. An
// "optimisation" that skipped re-verification for already-verified competencies would silently
// remove the whole guarantee. And the field keys come from the DATABASE, not the body (step 6).

import { strikeCompetencies } from "../../../src/prep/strike.js";
import { assertBrief } from "../../../src/prep/schema.js";
import { verifyBrief } from "../../../src/prep/verify.js";
import { addDays, isNotPast, toSqliteUtc } from "../../../src/prep/dates.js";
import { sendInviteEmail } from "../../../src/prep/email.js";
import { mintToken } from "../../../src/prep/tokens.js";
import {
  createInvite,
  deleteInviteByTokenHash,
  hashToken,
  persistHandover,
} from "../../../src/portal/store.js";
import { visibleFields } from "../../../src/note-fields.js";
import {
  getAgency,
  getClient,
  listVisibleKeys,
  recordInviteEvent,
  StoreError,
} from "../../../src/store.js";
import { json, readJson, sameOrigin, errorResponse } from "../../../src/http.js";

const ALLOWED = new Set([
  "client_id",
  "email",
  "interview_at",
  "brief",
  "cv",
  "payload",
  "strike",
]);

/** Decision 11: active until interview + 14 days, which covers a second stage. */
const ACCESS_DAYS = 14;

/**
 * The origin the magic link is built against.
 *
 * `PREP_BASE_URL` wins only if it is a plausible origin — https, and nothing after the host.
 * A malformed override mints links nobody notices until a candidate clicks one and lands on
 * `https://example.com/prep/prep/auth/enter`, so it is validated and fallen back from rather
 * than concatenated blindly. Unset, the request's own origin is right on production and wrong
 * only on a preview deployment, which matches DEPLOY.md's "until it is set, nothing is broken".
 */
function baseUrl(env, request) {
  const configured = String(env?.PREP_BASE_URL ?? "").trim();
  if (configured) {
    try {
      const url = new URL(configured);
      if (url.protocol === "https:" && (url.pathname === "/" || !url.pathname) && !url.search && !url.hash) {
        return url.origin;
      }
    } catch {
      // Fall through to the request origin. Not logged: the value is operator configuration
      // and the fallback is correct, so a log line here would be noise on every request.
    }
  }
  return new URL(request.url).origin;
}

/** An address shaped like one. Deliberately not a full RFC parser — the mail provider is the
 *  authority, and this only exists so an obvious typo fails at the door rather than at Resend. */
function cleanEmail(value) {
  const email = String(value ?? "").trim();
  const at = email.indexOf("@");
  if (!email || at <= 0 || at !== email.lastIndexOf("@") || at === email.length - 1) {
    throw new StoreError("missing_fields", 400, "email: that does not look like an email address");
  }
  return email;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  // No ANTHROPIC_API_KEY guard: this route calls no model. A deployment with mail configured
  // and no model key can still send a payload prepared elsewhere, and refusing here would be
  // a guard about a dependency this file does not have.
  if (!env.DB) return json({ error: "not_configured" }, 503);
  if (!sameOrigin(request)) return json({ error: "cross_origin" }, 403);

  try {
    const body = await readJson(request);
    const unexpected = Object.keys(body).filter((key) => !ALLOWED.has(key));
    if (unexpected.length) {
      return json({ error: "unexpected_fields", fields: unexpected }, 400);
    }

    const interviewAt = toSqliteUtc(body.interview_at);
    if (!isNotPast(interviewAt)) {
      throw new StoreError("interview_past", 400, "interview_at: that date has already passed");
    }

    const email = cleanEmail(body.email);

    // Bounded for the same reason VISIBILITY_KEYS_MAX is: one request may not ask for
    // unbounded work. The ceiling is the payload's own competency count, because a strike
    // list longer than that is either a bug or an attempt to make this loop expensive.
    const strike = body.strike ?? [];
    if (!Array.isArray(strike) || strike.some((id) => typeof id !== "string")) {
      throw new StoreError("missing_fields", 400, "strike: must be an array of competency ids");
    }
    // The bound is only checkable once we know the payload HAS competencies; a malformed
    // payload is `assertBrief`'s to name, and reporting it as a strike problem would send the
    // recruiter looking at the wrong control.
    if (Array.isArray(body.payload?.competencies) && strike.length > body.payload.competencies.length) {
      throw new StoreError("missing_fields", 400, "strike: more ids than there are competencies");
    }

    const client = await getClient(env.DB, body.client_id);

    // R4 — THE ONE THAT MATTERS. The visible-field keys are read from the DATABASE, never from
    // the browser. `verifyBrief` checks each PanelBrief claim's `source_field_key` against this
    // list; a browser-supplied list would let a demoted panel claim re-verify itself by naming
    // its own key, and decision 2's entire mechanism would become a suggestion.
    const fieldKeys = await listVisibleKeys(env.DB, client.id);

    // Shape first — on what arrived, before anything touches it. verify.js:100 asks for this
    // by name: "#22 calling this on a stored payload must run assertBrief first."
    try {
      assertBrief(body.payload);
    } catch (err) {
      throw new StoreError("bad_brief", 400, String(err?.message ?? "the payload is not a prep brief"));
    }

    let struck;
    try {
      struck = strikeCompetencies(body.payload, strike);
    } catch {
      throw new StoreError("nothing_to_send", 400, "every competency was struck");
    }

    // Belt and braces: the strike is pure and tested, and this is the assertion that would
    // catch it having produced a dangling reference anyway. Cheap, and the alternative is
    // discovering it as a foreign-key error halfway through the writes.
    try {
      assertBrief(struck);
    } catch (err) {
      throw new StoreError("bad_brief", 400, String(err?.message ?? "the struck payload is not a prep brief"));
    }

    // The haystack is `body.brief` — the SAME string persisted as `jd_text` below, so the row
    // and the verified `brief_json` cannot disagree. The browser posts its frozen `state.sent
    // .brief` rather than the live textarea, for the reason public/app.js:796-798 gives about
    // the CV.
    //
    // The client note may have changed between prepare and confirm — the recruiter has
    // /clients open in another tab and unticks a section. Reading `fieldKeys` fresh means a
    // panel claim that was sourced at prepare demotes here and renders to the candidate
    // wearing an Unverified mark. That is fail-closed and needs no extra code; it is written
    // down so a reviewer does not read it as a race nobody thought about.
    const { payload, failures } = verifyBrief(struck, { brief: body.brief, fieldKeys });

    if (payload.competencies.some((c) => !c.verified)) {
      // The JD half of architecture §3 as a gate. An unsourced PANEL claim does NOT block:
      // demote-don't-drop means it renders wearing its mark, which is the rule working as
      // designed (scripts/gen-brief.js uses the same definition of "sendable").
      return json({ error: "not_sendable", failures }, 400);
    }

    const token = mintToken();
    const tokenHash = await hashToken(token);
    const inviteId = crypto.randomUUID();
    const expiresAt = addDays(interviewAt, ACCESS_DAYS);

    // ── the failure ordering, and what each step costs ────────────────────────────────
    //
    //   invite ──► role + competencies + questions ──► email ──► invite_sent
    //      │                    │                        │
    //      └────────────────────┴── on throw: DELETE FROM invite (the cascade takes the rest)
    //
    // The invite is written FIRST because it is the scope everything else hangs off: there is
    // no transaction available at the edge, so the rollback is one delete by a hash we already
    // hold, and the schema's ON DELETE CASCADE removes whatever got written before the throw.
    await createInvite(env.DB, {
      id: inviteId,
      clientId: client.id,
      email,
      interviewAt,
      tokenHash,
      expiresAt,
    });

    try {
      // Decision 16's toggle half: the ethos material is the visible slice rendered as text.
      // The paste box the decision also names is deferred (see the plan's Open Questions), so
      // #23 has something to read either way. The client's note appears here as this call's
      // first argument and nowhere else — the same rule as prepare.js, and the same reason
      // the package name is spelled out in prose at the top of this file.
      const ethosText = visibleFields(client.note, fieldKeys)
        .map((field) => `## ${field.heading}\n${field.text}`)
        .join("\n\n");

      await persistHandover(env.DB, {
        inviteId,
        jdText: body.brief,
        ethosText,
        cvText: body.cv,
        payload,
      });
    } catch (err) {
      await deleteInviteByTokenHash(env.DB, tokenHash);
      throw err;
    }

    try {
      // The agency's name makes the email recognisable rather than anonymous, and its absence
      // is not worth failing a send over — the same call and the same reasoning as
      // functions/prep/auth/otp.js:59. `mailFrom` falls back on a blank name.
      const agency = await getAgency(env.DB).catch(() => null);
      await sendInviteEmail(env, {
        to: email,
        agencyName: agency?.name,
        roleTitle: payload.role_title,
        interviewAt,
        link: `${baseUrl(env, request)}/prep/auth/enter?t=${token}`,
      });
    } catch (err) {
      // R9. A mail failure must leave NO orphan candidate data: the CV and the brief were
      // written a few lines ago for a message that never arrived. Roll back by the hash we
      // still hold, then let the mail code (not_configured 503, mail_failed 502) surface so
      // the screen can tell the recruiter which it was — and, crucially, so the browser knows
      // to keep the prepared payload and offer a retry rather than another ~30p model call.
      await deleteInviteByTokenHash(env.DB, tokenHash);
      throw err;
    }

    // LAST, and after the send actually succeeded. `invite_sent` is decision 23's evidence for
    // the sentence the agency sells on — "every candidate we submit gets our prep portal" — so
    // a rolled-back send that already counted makes that sentence false in the one direction
    // nobody would check. A failure HERE is reported and never costs the send, the same trade
    // functions/api/generate.js:70-81 makes about the pack.
    let eventRecorded = true;
    try {
      await recordInviteEvent(env.DB, { clientId: client.id, kind: "invite_sent" });
    } catch {
      eventRecorded = false;
    }

    // No token and no invite id in the response. Nothing on the recruiter's screen needs
    // either, and a token in a JSON body is a token in a browser's network log.
    return json(
      {
        ok: true,
        // The moment of sending, not the interview date. The row's own `sent_at` is stamped by
        // `datetime('now')` inside createInvite and is never read back — one extra SELECT to
        // return a value the screen only prints would be a query for nothing.
        sent_at: new Date().toISOString().slice(0, 19).replace("T", " "),
        competencies: payload.competencies.map((c) => c.id),
        event_recorded: eventRecorded,
      },
      201,
    );
  } catch (err) {
    return errorResponse(err);
  }
}
