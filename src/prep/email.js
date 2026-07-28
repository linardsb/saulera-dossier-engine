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
export async function sendEmail(env, { to, subject, text, html } = {}) {
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
    body: JSON.stringify({ from: env.PREP_MAIL_FROM || MAIL_FROM_DEFAULT, to, subject, text, html }),
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
