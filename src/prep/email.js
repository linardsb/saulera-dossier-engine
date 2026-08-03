// The mail transport (#20, decision 10: Resend).
//
// By `fetch` and not by SDK. The suite runs on `node --test` with zero dependencies and the
// Functions run at the edge; one POST with three headers is less code than the adapter an SDK
// would need, and it keeps both of those true.
//
// What must never happen here: a raw code in a log line, or Resend's own error text in a
// response. The first puts a live credential in the deployment log; the second hands the
// candidate an error about a sending domain they have never heard of.

import { StoreError } from "../store.js";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

// An operator-controlled domain, never the deployment host: pages.dev cannot carry SPF or
// DKIM records, so mail from it is unauthenticated and lands in spam if it lands at all.
// `env.PREP_MAIL_FROM` overrides for an agency sending under its own name — whichever domain
// is used has to be verified in Resend, or every send answers 403.
export const MAIL_FROM_DEFAULT = "Interview prep <prep@saulera.com>";

/**
 * One email. Returns Resend's `{ id }` on success.
 *
 * The missing-key posture mirrors /api/generate's: without the secret nothing is broken and
 * one route answers 503, rather than the deployment failing in a way that needs a log to
 * diagnose. The guard is before the fetch, deliberately — a request built with
 * `Bearer undefined` would reach Resend, be rejected, and count against the account.
 */
export async function sendEmail(env, { to, subject, text, html, from } = {}) {
  if (!env?.RESEND_API_KEY) {
    throw new StoreError("not_configured", 503, "RESEND_API_KEY is not set");
  }
  if (!to || !subject || !text) {
    throw new StoreError("missing_fields", 400, "to, subject and text are required");
  }

  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    // `from` is an override, not a new default: every existing caller passes nothing and gets
    // exactly the behaviour it had. #22's invite is the one message that puts the agency's
    // name in the display name (decision 10), and it builds that value through mailFrom.
    body: JSON.stringify({
      from: from || env.PREP_MAIL_FROM || MAIL_FROM_DEFAULT,
      to,
      subject,
      text,
      html,
    }),
  });

  if (!response.ok) {
    // The STATUS and nothing else. Resend's body echoes the recipient address, which is
    // candidate data, and its message names infrastructure the candidate cannot act on.
    // 403 is the one to expect first: it means the sending domain is not verified, which is
    // a DNS job. 422 is a malformed field, 429 is rate or quota.
    console.error("resend send failed with status", response.status);
    throw new StoreError("mail_failed", 502, "the mail provider rejected the send");
  }
  return response.json();
}

/**
 * The returning-login email.
 *
 * Deliberately carries no link. An email that delivers a sign-in code AND a clickable button
 * teaches candidates that a message asking them to click is normal — which is the exact
 * lesson a phishing email needs them to have learned. The code alone means the only thing
 * they can do with this message is type six digits into a page they navigated to themselves.
 *
 * Both text and html: a text-only send scores worse in spam filters, and this message has to
 * arrive within the ten minutes it is valid for.
 */
/** Mail clients render whatever markup arrives; an agency name is not markup. */
const escapeHtml = (value) =>
  String(value).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export async function sendOtpEmail(env, { to, code, agencyName } = {}) {
  const agency = String(agencyName || "").trim() || "your recruitment agency";
  const digits = String(code ?? "");

  const text = [
    `Your sign-in code is ${digits}`,
    "",
    `Type it into the interview prep page to get back in. It works once and expires in 10 minutes.`,
    "",
    `You are getting this because ${agency} invited you to prepare for an interview.`,
    "If that wasn't you, ignore this message — nobody can use the code but you.",
  ].join("\n");

  // Inline styles and a literal colour, which is the one place in this repo that is right:
  // mail clients strip <style> blocks and none of them resolve a CSS custom property, so
  // public/tokens.css cannot reach here. No <a> and no URL anywhere in this markup — see the
  // no-link rule above; test/prep-email.test.js asserts the absence rather than trusting it.
  const html = [
    `<p>Your sign-in code is:</p>`,
    `<p style="font-size:28px;letter-spacing:4px;font-weight:700;margin:16px 0">${digits}</p>`,
    `<p>Type it into the interview prep page to get back in. It works once and expires in 10 minutes.</p>`,
    `<p style="color:#666666;font-size:13px">You are getting this because ${escapeHtml(agency)} invited`,
    `you to prepare for an interview. If that wasn't you, ignore this message — nobody can use the code but you.</p>`,
  ].join("\n");

  return sendEmail(env, { to, subject: "Your interview-prep sign-in code", text, html });
}

// ── the invite (#22, decision 10) ──────────────────────────────────────────────────────
//
// FOUR EMAILS, FOUR RULES, ON PURPOSE. `sendOtpEmail` above deliberately carries NO link,
// and test/prep-email.test.js asserts that absence for a stated anti-phishing reason. The
// invite's tokenized link is its entire mechanism: it is the one click the whole portal
// exists to make work, and it arrives unprompted rather than in answer to a code request.
// The reminder (#25, below) carries a PLAIN portal-entry link and never a token — no raw
// token exists to send (only its hash rests), and minting one would rotate `token_hash`
// under a live session.
//
// The fourth is the extension nudge (#69, at the foot), and its rule is a different KIND of
// rule: it is the first message this product sends to THE AGENCY rather than to a candidate.
// The anti-phishing argument that forbids a link in `sendOtpEmail` does not apply — the
// recipient is an operator-configured address (`RECRUITER_EMAIL`) and the link points at an
// Access-gated recruiter screen, not at a candidate door. But it must be said out loud, because
// the consequence runs the other way: this message NAMES A CANDIDATE TO A THIRD PARTY, so it
// must never be sent to a candidate address. Its recipient is validated as a single address in
// src/compliance/nudges.js before the sweep will claim anything.
//
// This module is prep-named and now carries a non-prep message. That cost was weighed: the
// stronger invariant is that EVERY email this product sends is in this file, and this note says
// why each is different. A fourth message in a second file would break that to gain tidiness.
//
// The four are different BY DESIGN. None should be "harmonised" toward another —
// removing the invite's link breaks the product, adding one to the OTP mail teaches
// candidates that a message asking them to click is normal (the lesson a phishing email
// needs them to have already learned), a tokenized reminder link would be a second
// credential in flight for a message that only needs to say "it is ready", and pointing the
// nudge at /prep/* would send the recruiter to the candidate's portal.

/** How long an agency name may get before it stops being a display name. */
const NAME_MAX = 120;

/** CR, LF and every other C0 control, plus DEL. None of them belongs in a mail header. */
const CONTROLS = /[\u0000-\u001f\u007f]/g;

/**
 * `"<Agency>" <prep@saulera.com>` — decision 10 puts the agency in the display name.
 *
 * R8 LIVES HERE. The agency name is agency-authored text going straight into a mail header,
 * and two separate things go wrong with it:
 *
 *   INJECTION   a name containing CR or LF ends the From header and starts another. A name
 *               of "Evil\r\nBcc: someone@else" is a second recipient on every invite the
 *               agency sends. Stripped FIRST, before anything else looks at the string.
 *   SYNTAX      an agency name can legally contain a comma ("Ashdown, Park & Co"), a full
 *               stop ("A.B. Recruitment") or a quote. Unquoted, RFC 5322 §3.2.4 reads the
 *               comma as an address separator and the header becomes two malformed
 *               addresses. Quoting unconditionally is cheaper than deciding case by case
 *               which character made it necessary.
 *
 * A name that survives neither pass returns the configured string unchanged: a nameless
 * agency gets today's behaviour rather than a broken header.
 */
export function mailFrom(env, agencyName) {
  const configured = String(env?.PREP_MAIL_FROM || MAIL_FROM_DEFAULT).trim();
  // The address out of whatever form the operator configured — either "Name <a@b>" or a bare
  // address. Taking the capture rather than the whole string is what stops a configured
  // display name and the agency's from both ending up in one header.
  const address = configured.match(/<([^>]+)>\s*$/)?.[1]?.trim() || configured;

  const name = String(agencyName ?? "")
    .replace(CONTROLS, " ") // header injection, closed before anything else looks at it
    .replace(/[<>]/g, "") // angle brackets would open a second address
    .trim()
    .slice(0, NAME_MAX)
    .trim();

  if (!name) return configured;

  // RFC 5322 §3.2.4: inside a quoted-string, `\` and `"` are the two characters that must be
  // escaped. Order matters — escaping the quote first and the backslash second would escape
  // the backslashes this line just added.
  const quoted = name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${quoted}" <${address}>`;
}

/**
 * The invite: what this is, the link, the date, and how long it lasts.
 *
 * Both halves carry the URL, and the TEXT half carries it as bare text on its own line — a
 * plain-text client shows exactly what the text half says, and a link that exists only as an
 * `<a>` href is a link that reader cannot follow. AC #5.
 *
 * Never logs the token, the link or the recipient. `sendEmail` logs the status alone
 * (email.js:47-52) and this adds nothing to that.
 */
export async function sendInviteEmail(
  env,
  { to, agencyName, roleTitle, interviewAt, link } = {},
) {
  const agency = String(agencyName || "").trim() || "your recruitment agency";
  // `role` reaches a HEADER — it is the whole variable half of the subject line — and it arrives
  // in the browser's payload, unbounded. `mailFrom` strips, caps and quotes the same class of
  // value for the same reason and this was the one place that did not, which made the discipline
  // inconsistent rather than absent. A CR or LF in a header field is the injection; the cap
  // keeps a runaway role title out of a Resend rejection the recruiter cannot diagnose.
  const role = String(roleTitle || "")
    .replace(CONTROLS, " ")
    .trim()
    .slice(0, NAME_MAX)
    .trim();
  const url = String(link ?? "");
  // The date as the recruiter entered it, day-only: the stamp is stored to the second for the
  // retention arithmetic, but a candidate reading "2026-08-12 00:00:00" learns nothing from
  // the zeros and reasonably wonders whether their interview is at midnight.
  const when = String(interviewAt ?? "").slice(0, 10);
  // Same origin as the link, so the sentence about a dead link points somewhere real.
  const base = url.split("/prep/")[0];

  const subject = role ? `Your interview prep for ${role}` : "Your interview prep";

  const text = [
    "Hello,",
    "",
    `${agency} has put together a private preparation page for your interview${role ? ` for ${role}` : ""}.`,
    "It is built from the job brief, your CV, and what we know about this client.",
    "",
    "Open it here:",
    url,
    "",
    ...(when ? [`Your interview: ${when}`, ""] : []),
    "Everything here is deleted 30 days after your interview, and there is a delete-now",
    "button on the page if you would rather it went sooner.",
    "",
    `If the link stops working, go to ${base}/prep/login and ask for a code.`,
  ].join("\n");

  // Inline styles and literal colours, which is the one place in this repo that is right:
  // mail clients strip <style> blocks and none of them resolve a CSS custom property, so
  // public/tokens.css cannot reach here (see sendOtpEmail's note above).
  const html = [
    `<p>Hello,</p>`,
    `<p>${escapeHtml(agency)} has put together a private preparation page for your interview` +
      `${role ? ` for ${escapeHtml(role)}` : ""}. It is built from the job brief, your CV, and ` +
      `what we know about this client.</p>`,
    `<p style="margin:24px 0"><a href="${escapeHtml(url)}">Open your interview prep</a></p>`,
    ...(when ? [`<p>Your interview: ${escapeHtml(when)}</p>`] : []),
    `<p style="color:#666666;font-size:13px">Everything here is deleted 30 days after your`,
    `interview, and there is a delete-now button on the page if you would rather it went`,
    `sooner. If the link stops working, go to ${escapeHtml(base)}/prep/login and ask for a code.</p>`,
  ].join("\n");

  return sendEmail(env, { to, subject, text, html, from: mailFrom(env, agencyName) });
}

// ── the reminder (#25, decision 17) ────────────────────────────────────────────────────

/**
 * The single reminder: the interview is tomorrow and the day-before session is ready.
 *
 * One calm paragraph and the portal-entry link — `${base}/prep/login`, NEVER a token (see
 * the three-emails note above). SPEC's tone rules hold hardest here: no deadline pressure,
 * no "don't forget", no exclamation marks, no streak language, and nothing that implies
 * the tool predicts the outcome. Decision 17 says this is the only nudge that will ever
 * exist, so it reads like a courtesy, not a campaign.
 *
 * Never logs the link or the recipient. `sendEmail` logs the status alone.
 */
export async function sendReminderEmail(env, { to, agencyName, link } = {}) {
  const agency = String(agencyName || "").trim() || "your recruitment agency";
  const url = String(link ?? "");

  const text = [
    "Hello,",
    "",
    "Your interview is tomorrow. Your day-before session is ready — a short run through",
    "what you already have, and the practical details for the day.",
    "",
    "Open it here:",
    url,
    "",
    `— ${agency}`,
  ].join("\n");

  // Inline styles, as ever: mail clients strip <style> blocks and resolve no custom
  // property, so public/tokens.css cannot reach here (sendOtpEmail's note).
  const html = [
    `<p>Hello,</p>`,
    `<p>Your interview is tomorrow. Your day-before session is ready — a short run through`,
    `what you already have, and the practical details for the day.</p>`,
    `<p style="margin:24px 0"><a href="${escapeHtml(url)}">Open your day-before session</a></p>`,
    `<p style="color:#666666;font-size:13px">— ${escapeHtml(agency)}</p>`,
  ].join("\n");

  return sendEmail(env, {
    to,
    subject: "Your interview is tomorrow",
    text,
    html,
    from: mailFrom(env, agencyName),
  });
}

// ── the extension nudge (#69) ──────────────────────────────────────────────────────────

/**
 * The one nudge: a booking ends in a fortnight, extend it or redeploy them.
 *
 * THE ONLY MESSAGE IN THIS FILE ADDRESSED TO THE AGENCY. See the four-emails note above for
 * what that changes and what it does not. The link is the recruiter's own `/assignments`
 * screen — Access-gated, and never a `/prep/*` path, which would send them to the candidate's
 * portal. test/prep-email.test.js asserts that.
 *
 * `candidateName` and `clientName` both reach a HEADER — they are the whole variable half of
 * the subject — so both take `sendInviteEmail`'s treatment for `roleTitle`: the `CONTROLS` strip
 * first, because a CR or LF in a header field IS the injection, then the `NAME_MAX` cap, which
 * keeps a runaway value out of a Resend rejection nobody can diagnose.
 *
 * The date renders day-only, `sendInviteEmail`'s reason unchanged: a recruiter reading
 * "2026-09-21 00:00:00" learns nothing from the zeros.
 *
 * The candidate's name is person data going into an email. It is never logged and never put in
 * an error body — `sendEmail` logs the status alone and this adds nothing to that.
 *
 * Decision 17's tone rule holds here too: one nudge, calm, no deadline pressure. This is the
 * only extension message that will ever be sent for a given deadline.
 */
export async function sendExtensionNudgeEmail(
  env,
  { to, agencyName, candidateName, clientName, endDate, link } = {},
) {
  const header = (value) =>
    String(value ?? "")
      .replace(CONTROLS, " ")
      .trim()
      .slice(0, NAME_MAX)
      .trim();

  const name = header(candidateName) || "A candidate";
  const client = header(clientName) || "a client";
  const when = String(endDate ?? "").slice(0, 10);
  const url = String(link ?? "");

  const subject = `Booking ending: ${name} at ${client}`;

  const text = [
    "Hello,",
    "",
    `${name}'s booking at ${client} ends on ${when}.`,
    "",
    "Extend it or redeploy them — whichever, it is easier to do now than after it lapses.",
    "",
    "Your bookings:",
    url,
  ].join("\n");

  // Inline styles and literal colours, as ever: mail clients strip <style> blocks and resolve
  // no custom property, so public/tokens.css cannot reach here (sendOtpEmail's note).
  const html = [
    `<p>Hello,</p>`,
    `<p>${escapeHtml(name)}'s booking at ${escapeHtml(client)} ends on ${escapeHtml(when)}.</p>`,
    `<p>Extend it or redeploy them — whichever, it is easier to do now than after it lapses.</p>`,
    `<p style="margin:24px 0"><a href="${escapeHtml(url)}">Open your bookings</a></p>`,
  ].join("\n");

  return sendEmail(env, { to, subject, text, html, from: mailFrom(env, agencyName) });
}
