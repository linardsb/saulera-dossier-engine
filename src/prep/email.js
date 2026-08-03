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
// SIX EMAILS, SIX RULES, ON PURPOSE. `sendOtpEmail` above deliberately carries NO link,
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
// The fifth and sixth are the expiry pair (#70). The candidate's nudge takes the REMINDER's
// rule, not the OTP's: a plain portal-entry link to the compliance sign-in page and never a
// token, because no raw token exists to send and minting one would rotate `session_hash` under
// a live session. It carries no reference number — the candidate typed it and does not need it
// read back to them in a message that could sit in an inbox for years. The recruiter's digest
// takes the extension nudge's rule (it names candidates to a third party, so its recipient is
// validated as a single operator-configured address in src/compliance/nudges.js) with one
// difference: it carries NO LINK AT ALL, because there is no recruiter compliance surface until
// #71 and `/assignments` deliberately shows no compliance state.
//
// This module is prep-named and now carries non-prep messages. That cost was weighed: the
// stronger invariant is that EVERY email this product sends is in this file, and this note says
// why each is different. A message in a second file would break that to gain tidiness.
//
// The six are different BY DESIGN. None should be "harmonised" toward another —
// removing the invite's link breaks the product, adding one to the OTP mail teaches
// candidates that a message asking them to click is normal (the lesson a phishing email
// needs them to have already learned), a tokenized reminder link would be a second
// credential in flight for a message that only needs to say "it is ready", pointing the
// nudge at /prep/* would send the recruiter to the candidate's portal, and adding a link to
// the expiry digest would point the recruiter at a screen that cannot show what it is about.

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

// ── the expiry pair (#70) ──────────────────────────────────────────────────────────────

/**
 * The candidate's nudge: these things we hold for you are running out.
 *
 * ONE MESSAGE PER SWEEP, not one per item. `items` is every checklist row of theirs that
 * changed state in this sweep, so a locum whose DBS and immunisations lapse the same week gets
 * one email and not two. The cap is structural rather than counted: an item can only change
 * state twice per expiry date (amber, then red), and a renewal is what re-arms it.
 *
 * The link is the compliance sign-in page and never a token — sendReminderEmail's rule, for
 * its reason. `/prep/compliance/login`, not `/prep/login`: the two portals have independent
 * cookies and a candidate sent to the wrong door would sign in to the wrong product.
 *
 * NO REFERENCE NUMBER anywhere in either half. It is theirs, they typed it, and the message
 * has to say what to renew rather than read their own paperwork back to them.
 *
 * The subject's tense turns on the worst state in the batch, which is the one distinction the
 * whole ticket is about: "has run out" and "runs out soon" are different problems and an inbox
 * preview is the first surface either one reaches. Per-item tense lives on each line below.
 *
 * Dates render as the stored `YYYY-MM-DD` — sendInviteEmail's `.slice(0, 10)` discipline. The
 * passport renders prose dates through its own readableDate; an email has no Intl guarantee
 * worth a second copy of that function, and an ISO date is unambiguous on the one message
 * where a day either way matters.
 *
 * Decision 17's tone rule holds: calm, no deadline pressure, no exclamation mark, no streak
 * language, nothing that implies a consequence we cannot know.
 */
export async function sendExpiryNudgeEmail(env, { to, agencyName, items = [], link } = {}) {
  const agency = String(agencyName || "").trim() || "your recruitment agency";
  const url = String(link ?? "");
  const anyExpired = items.some((item) => item.status === "expired");

  // Labels come from the catalogue and are ours, but they reach a body a mail client renders,
  // so they take the same escape every other value in this file does.
  const line = (item) =>
    `${item.label} — ${item.status === "expired" ? "ran out" : "runs out"} ` +
    `${String(item.expiryDate ?? "").slice(0, 10)}`;

  const subject = anyExpired
    ? "Something we hold for you has run out"
    : "Something we hold for you runs out soon";

  const text = [
    "Hello,",
    "",
    `${agency} keeps a short list of the things they need on file before you can be booked.`,
    "These need your attention:",
    "",
    ...items.map((item) => `  ${line(item)}`),
    "",
    `Send the new one to ${agency} the way you always have. Then open your checklist and`,
    "update the reference number and the date:",
    "",
    url,
    "",
    "We do not store your documents — only the reference number and the date it runs out.",
  ].join("\n");

  // Inline styles and literal colours, as ever: mail clients strip <style> blocks and resolve
  // no custom property, so public/tokens.css cannot reach here (sendOtpEmail's note).
  const html = [
    `<p>Hello,</p>`,
    `<p>${escapeHtml(agency)} keeps a short list of the things they need on file before you can`,
    `be booked. These need your attention:</p>`,
    `<ul>`,
    ...items.map((item) => `<li>${escapeHtml(line(item))}</li>`),
    `</ul>`,
    `<p>Send the new one to ${escapeHtml(agency)} the way you always have. Then open your`,
    `checklist and update the reference number and the date.</p>`,
    `<p style="margin:24px 0"><a href="${escapeHtml(url)}">Open your checklist</a></p>`,
    `<p style="color:#666666;font-size:13px">We do not store your documents — only the`,
    `reference number and the date it runs out.</p>`,
  ].join("\n");

  return sendEmail(env, { to, subject, text, html, from: mailFrom(env, agencyName) });
}

/**
 * The recruiter's digest: everything that changed state in this sweep, in one message.
 *
 * THE SECOND MESSAGE IN THIS FILE ADDRESSED TO THE AGENCY, and the one that names the most
 * people at once. sendExtensionNudgeEmail names one candidate; this names N. Its recipient is
 * validated as a single operator-configured address in src/compliance/nudges.js BEFORE the
 * sweep sends anything, and the comma check matters more here for the same reason it mattered
 * there, multiplied.
 *
 * IT CARRIES NO LINK, deliberately, and that is not an omission to be tidied up. There is no
 * recruiter compliance surface until #71: `/assignments` shows bookings and dates and
 * deliberately projects no compliance state (src/compliance/store.js, listAssignments), so a
 * link to it would point at a screen that cannot show what this email is about. #71 adds the
 * link when it adds the screen. This is also why the digest states the facts in full rather
 * than teasing them — it has to be readable as the whole answer.
 *
 * It says nothing about whether the candidates were emailed. They usually were, and the
 * sentence would still be a claim this function cannot check: the candidate half runs under its
 * own configuration guard and its own try/catch, and a digest asserting a send that failed is
 * worse than a digest that stays quiet about it.
 *
 * `candidateName` is agency-entered text reaching a mail body; it takes sendExtensionNudgeEmail's
 * CONTROLS strip and NAME_MAX cap for that function's reason. The subject carries a COUNT and
 * no name — an inbox preview naming a locum's compliance problem on a shared desk is a
 * disclosure nobody chose.
 */
export async function sendExpiryDigestEmail(env, { to, agencyName, rows = [] } = {}) {
  const header = (value) =>
    String(value ?? "")
      .replace(CONTROLS, " ")
      .trim()
      .slice(0, NAME_MAX)
      .trim();

  const line = (row) =>
    `${header(row.candidateName) || "A candidate"} — ${row.label} — ` +
    `${row.status === "expired" ? "ran out" : "runs out"} ` +
    `${String(row.expiryDate ?? "").slice(0, 10)}`;

  const subject = `Compliance expiries — ${rows.length} to chase`;

  const text = [
    "Hello,",
    "",
    "These compliance items have just changed state:",
    "",
    ...rows.map((row) => `  ${line(row)}`),
  ].join("\n");

  const html = [
    `<p>Hello,</p>`,
    `<p>These compliance items have just changed state:</p>`,
    `<ul>`,
    ...rows.map((row) => `<li>${escapeHtml(line(row))}</li>`),
    `</ul>`,
  ].join("\n");

  return sendEmail(env, { to, subject, text, html, from: mailFrom(env, agencyName) });
}
