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
import { briefProfile } from "../../../src/domain.js";
import { assertBrief } from "../../../src/prep/schema.js";
import { verifyBrief } from "../../../src/prep/verify.js";
import {
  MAX_MONTHS_AHEAD,
  addDays,
  isNotPast,
  isWithinHorizon,
  toSqliteUtc,
} from "../../../src/prep/dates.js";
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
import { cleanInput } from "../../../src/prompt.js";
import { json, readJson, sameOrigin, errorResponse } from "../../../src/http.js";

const ALLOWED = new Set([
  "client_id",
  "email",
  "interview_at",
  "brief",
  "cv",
  "payload",
  "strike",
  "send_key",
]);

/** Decision 11: active until interview + 14 days, which covers a second stage. */
const ACCESS_DAYS = 14;

/**
 * The origin the magic link is built against. CONFIGURATION ONLY — never the request.
 *
 * `PREP_BASE_URL` wins only if it is a plausible origin — https, and nothing after the host.
 * A malformed override mints links nobody notices until a candidate clicks one and lands on
 * `https://example.com/prep/prep/auth/enter`, so it is validated rather than concatenated.
 *
 * WHY THERE IS NO FALLBACK TO `request.url`. That is what this used to do, and its sibling
 * functions/prep/auth/enter.js:30-31 refuses exactly the same move in exactly the same words:
 * "an absolute URL would inherit whatever Host the edge saw, which is a header an attacker
 * controls." What that one would have produced is a redirect; what this one produces is a
 * sign-in link, emailed to a candidate, carrying a live token — strictly the worse of the two,
 * and the reason to answer plainly instead of arguing about reachability.
 *
 * The cost is that `PREP_BASE_URL` is now REQUIRED rather than an improvement: a deployment
 * without it answers 503 and sends nothing. That is the right direction to fail. An operator
 * reading `no_base_url` sets one variable; a candidate holding a link built from a header
 * nobody chose has no signal at all. DEPLOY.md section 5b and the triage table say so.
 */
function baseUrl(env) {
  const configured = String(env?.PREP_BASE_URL ?? "").trim();
  if (!configured) return null;
  try {
    const url = new URL(configured);
    if (url.protocol === "https:" && (url.pathname === "/" || !url.pathname) && !url.search && !url.hash) {
      return url.origin;
    }
  } catch {
    // Falls to null, which the route answers as 503. Not logged: the value is operator
    // configuration and the response already names it.
  }
  return null;
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

/**
 * A pasted input that is actually text, then bounded.
 *
 * `cleanInput` bounds the LENGTH and is the right tool for it, but it coerces first — and
 * `String({secret: "obj"})` is `"[object Object]"`, fifteen characters that pass every length
 * check and land in `candidate_role.cv_text` as a candidate's entire CV. The shape is refused
 * here rather than inside `cleanInput` because that function is also /api/generate's, and
 * tightening a shared gate is a change to a route this ticket did not touch.
 */
function cleanText(value, field) {
  if (typeof value !== "string") {
    throw new StoreError("missing_fields", 400, `${field}: must be text`);
  }
  return cleanInput(value, field);
}

/**
 * Undo the invite — and never at the cost of the error that caused the undo.
 *
 * A bare `await deleteInviteByTokenHash(...)` before `throw err` is the trap this exists to
 * close: if the DELETE itself rejects, that rejection throws PAST the `throw err` below it and
 * the outer catch sees a database error instead of the one that actually happened. Two things
 * go wrong at once. The recruiter reads `500 internal` where they should read `502 mail_failed`
 * — the wording that tells them the payload is still on screen and worth retrying rather than
 * worth another ~30p model call — and the orphan candidate data this rollback exists to prevent
 * is left behind regardless, silently.
 *
 * So it is reported and swallowed: the same trade `recordInviteEvent` makes at the end of this
 * file, for the same reason — a second failure must not hide the first.
 *
 * The message is the D1 error's own, which names the constraint or the connection. It carries
 * no bound parameters, so the hash does not travel; the log line itself stays clear of the
 * words the Level 1 credential grep looks for.
 *
 * WHAT THE SWALLOW COSTS SINCE #34: the orphaned row keeps its `send_key`, so the browser's
 * retry of this same payload is answered `409 already_sent` — success copy for a send whose
 * email never went out. The 409 branch logs when it fires and the recruiter's recovery is a
 * fresh prepare; accepted, because the alternative (rethrowing here) buys the worse trade
 * this comment opens with.
 */
async function rollbackInvite(env, tokenHash) {
  try {
    await deleteInviteByTokenHash(env.DB, tokenHash);
  } catch (err) {
    const reason = err?.message ?? "unknown";
    console.error("prep/send: invite rollback failed; candidate data may be orphaned:", reason);
  }
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
    // The far end, which nothing used to check. See MAX_MONTHS_AHEAD: this date is the clock
    // decision 13's 30-day purge runs on, so a mistyped year is a retention failure and not a
    // diary one, and it fails silently everywhere else.
    if (!isWithinHorizon(interviewAt)) {
      throw new StoreError(
        "interview_too_far",
        400,
        `interview_at: that date is more than ${MAX_MONTHS_AHEAD} months away — check the year`,
      );
    }

    const email = cleanEmail(body.email);

    // BOUNDED HERE TOO, not only at prepare. /api/prep/prepare runs both through this same
    // function before the model call (src/prep/generate.js:61-62) — but that route only SHOWS
    // them, and this one PERSISTS them, and it bound neither: `String(x ?? "")` took a
    // 600,000-character brief and a 900,000-character CV into D1 in full, and `cv: {…}` stored
    // the literal "[object Object]". Past D1's 2 MB row limit that becomes another `500
    // internal` where a 400 belongs. src/prompt.js:15 states the "runs exactly once" invariant
    // the browser round trip was quietly sidestepping.
    //
    // It also makes the two haystacks the same string: a quote that verified at prepare, against
    // the cleaned brief, verifies here against the cleaned brief rather than against an untrimmed
    // near-copy of it.
    const brief = cleanText(body.brief, "brief");
    const cv = cleanText(body.cv, "cv");

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

    // #34: the idempotency key, one per PREPARED payload. Optional, because a browser that
    // predates it (or a curl) simply gets today's behaviour — NULL, which the UNIQUE index
    // ignores. Bounded like everything else in this request: a key is a UUID's worth of
    // opaque string, not a free text field.
    let sendKey = null;
    if (body.send_key != null) {
      if (typeof body.send_key !== "string" || !body.send_key.trim() || body.send_key.length > 64) {
        throw new StoreError("missing_fields", 400, "send_key: must be a non-blank string of at most 64 characters");
      }
      sendKey = body.send_key;
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

    // The haystack is the cleaned `brief` — the SAME string persisted as `jd_text` below, so the
    // row and the verified `brief_json` cannot disagree. The browser posts its frozen `state.sent
    // .brief` rather than the live textarea, for the reason public/app.js:796-798 gives about
    // the CV.
    //
    // The client note may have changed between prepare and confirm — the recruiter has
    // /clients open in another tab and unticks a section. Reading `fieldKeys` fresh means a
    // panel claim that was sourced at prepare demotes here and renders to the candidate
    // wearing an Unverified mark. That is fail-closed and needs no extra code; it is written
    // down so a reviewer does not read it as a race nobody thought about.
    const { payload, failures } = verifyBrief(struck, { brief, fieldKeys });

    if (payload.competencies.some((c) => !c.verified)) {
      // The JD half of architecture §3 as a gate. An unsourced PANEL claim does NOT block:
      // demote-don't-drop means it renders wearing its mark, which is the rule working as
      // designed (scripts/gen-brief.js uses the same definition of "sendable").
      return json({ error: "not_sendable", failures }, 400);
    }

    // #50, R4's rule applied to the flag: `engagement` is recomputed from the cleaned brief and
    // CV — the same strings persisted below — and re-stamped, so whatever the browser posted
    // inside `payload` is overwritten and the stored row can never disagree with its own
    // jd_text. `briefProfile` is pure; this route still imports no model SDK.
    const engagement = briefProfile(brief, cv).role_shape;

    // THE LAST GATE BEFORE ANYTHING IS MINTED OR WRITTEN, and last on purpose. The link is the
    // whole product of this route, so a deployment that cannot say where it points has nothing
    // to send — but a body that was going to be refused anyway should be refused by NAME, so
    // every 400 above runs first. Here, nothing has been written, nothing counted and no token
    // exists, so the send is safe to retry the moment PREP_BASE_URL is set.
    const origin = baseUrl(env);
    if (!origin) throw new StoreError("no_base_url", 503, "PREP_BASE_URL is not set to an https origin");

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
    // #34's R7 closes HERE, on the first write. A retry of a send that fully succeeded finds
    // its key already standing and trips `invite_send_key` before anything is written, sent
    // or counted; a retry of a send that ROLLED BACK finds the key free again, because the
    // rollback deleted the row that held it. That is the exact retry-vs-resend distinction —
    // a deliberate re-send is a new prepared payload carrying a new key, and sails through.
    try {
      await createInvite(env.DB, {
        id: inviteId,
        clientId: client.id,
        email,
        interviewAt,
        tokenHash,
        expiresAt,
        sendKey,
      });
    } catch (err) {
      // Both halves required, so a UNIQUE trip on invite.id or invite.token_hash (fresh
      // randoms — negligible, but not this branch's to claim) surfaces as the error it is.
      // Message shapes this was checked against: node:sqlite says "UNIQUE constraint failed:
      // invite.send_key"; D1 wraps it as "D1_ERROR: UNIQUE constraint failed:
      // invite.send_key: SQLITE_CONSTRAINT". A future wrapping that matches neither degrades
      // to a 500 and a retry loop — never to a second invite; the INDEX enforces, not this.
      const reason = err?.message ?? "";
      if (sendKey && /UNIQUE/i.test(reason) && /send_key/.test(reason)) {
        // 409, not 201: the browser reads this as success (the candidate HAS their link),
        // but the server must not pretend it did work it refused — and must not count it.
        //
        // THE RESIDUAL THIS BRANCH CARRIES: "standing key" is evidence the earlier send
        // fully succeeded ONLY because the failure paths below roll the row back. If that
        // rollback itself failed (it is swallowed, see rollbackInvite) or the isolate died
        // mid-send, the key stands for a send whose email never went out — and this 409
        // then wears success copy for a candidate with an empty inbox. Low odds, wrong
        // direction, so it is logged here to be diagnosable, and the recruiter's recovery
        // is a fresh prepare (Start again), which mints a fresh key.
        console.error("prep/send: duplicate send_key refused as already_sent for client", client.id);
        return json({ error: "already_sent" }, 409);
      }
      throw err;
    }

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
        jdText: brief,
        ethosText,
        cvText: cv,
        payload: { ...payload, engagement },
      });
    } catch (err) {
      // The same rollback as the mail failure below, and it matters more than it looks: this is
      // the branch `candidate_role.invite_id UNIQUE` reaches on a retry, and a partial scope —
      // the role row plus some competencies — is the orphan CV R9 is about, arriving through a
      // door the mail path does not have.
      await rollbackInvite(env, tokenHash);
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
        link: `${origin}/prep/auth/enter?t=${token}`,
      });
    } catch (err) {
      // R9. A mail failure must leave NO orphan candidate data: the CV and the brief were
      // written a few lines ago for a message that never arrived. Roll back by the hash we
      // still hold, then let the mail code (not_configured 503, mail_failed 502) surface so
      // the screen can tell the recruiter which it was — and, crucially, so the browser knows
      // to keep the prepared payload and offer a retry rather than another ~30p model call.
      await rollbackInvite(env, tokenHash);
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
