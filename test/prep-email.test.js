// #20 — the mail transport, against a stubbed Resend.
//
// The class of failure this file catches: an email that carries more than it should. A raw
// code reaching a log, a provider error reaching the candidate, a recipient address reaching
// either — and the one that undoes the whole design, a clickable link in a message whose
// entire purpose is to teach candidates that sign-in emails do not have links.
//
// `globalThis.fetch` is stubbed and restored in a finally. An escaped stub does not fail
// here; it poisons every later test file in the same process, which is a debugging afternoon.

import { test } from "node:test";
import assert from "node:assert/strict";

import { StoreError } from "../src/store.js";
import { MAIL_FROM_DEFAULT, sendEmail, sendOtpEmail } from "../src/prep/email.js";

const ENV = { RESEND_API_KEY: "re_test_key_123" };
const MESSAGE = { to: "candidate@example.com", subject: "Hello", text: "body", html: "<p>body</p>" };

/**
 * Runs `fn` with fetch replaced by a recorder. Returns { calls, result, error }.
 * `respond` builds the Response each call answers with.
 */
async function withFetch(respond, fn) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return respond(calls.length);
  };
  try {
    return { calls, result: await fn().catch((error) => ({ error })) };
  } finally {
    globalThis.fetch = original;
  }
}

const ok = () => new Response(JSON.stringify({ id: "msg_1" }), { status: 200 });
const status = (code) =>
  new Response(JSON.stringify({ message: `not allowed for candidate@example.com`, statusCode: code }), { status: code });

/** The error a call threw, or "did not throw". */
async function errorOf(fn) {
  try {
    await fn();
    return "did not throw";
  } catch (err) {
    return err;
  }
}

// ── the missing secret, which must not become a wasted request ─────────────────────────

test("with no RESEND_API_KEY it answers not_configured and never calls fetch", async () => {
  const { calls, result } = await withFetch(ok, () => sendEmail({}, MESSAGE));

  assert.ok(result.error instanceof StoreError, "a missing secret is a deployment fault, not a crash");
  assert.equal(result.error.code, "not_configured");
  assert.equal(result.error.status, 503);
  // The call count is the point. A guard placed AFTER the request builds `Bearer undefined`,
  // sends the candidate's address to Resend anyway, and is rejected at their end — which is
  // the same outcome from the outside and a different one on the account.
  assert.equal(calls.length, 0, "the guard must be before the request, not after it");
});

// ── the happy path, as Resend actually receives it ─────────────────────────────────────

test("sendEmail posts to Resend with the bearer key and a complete body", async () => {
  const { calls, result } = await withFetch(ok, () => sendEmail(ENV, MESSAGE));

  assert.deepEqual(result, { id: "msg_1" }, "the provider's message id is passed back");
  assert.equal(calls.length, 1);
  const [{ url, init }] = calls;

  assert.equal(url, "https://api.resend.com/emails", "the endpoint, exactly");
  assert.equal(init.method, "POST");
  assert.equal(init.headers.Authorization, `Bearer ${ENV.RESEND_API_KEY}`);
  assert.equal(init.headers["Content-Type"], "application/json");

  const body = JSON.parse(init.body);
  assert.equal(body.from, MAIL_FROM_DEFAULT, "pages.dev cannot carry SPF/DKIM — the sender is never the host");
  assert.equal(body.to, MESSAGE.to);
  assert.equal(body.subject, MESSAGE.subject);
  // Both parts, always. A text-only send scores worse in spam filters, and this message has
  // ten minutes to arrive before the code it carries is worthless.
  assert.equal(body.text, MESSAGE.text);
  assert.equal(body.html, MESSAGE.html);
});

test("PREP_MAIL_FROM overrides the default sender", async () => {
  const env = { ...ENV, PREP_MAIL_FROM: "Ashdown Park <prep@ashdownpark.example>" };
  const { calls } = await withFetch(ok, () => sendEmail(env, MESSAGE));
  assert.equal(JSON.parse(calls[0].init.body).from, env.PREP_MAIL_FROM, "an agency may send under its own name");
});

// ── the OTP email itself ───────────────────────────────────────────────────────────────

test("sendOtpEmail carries the six digits and names the agency, in both parts", async () => {
  const { calls } = await withFetch(ok, () =>
    sendOtpEmail(ENV, { to: MESSAGE.to, code: "049217", agencyName: "Ashdown Park Recruitment" }),
  );

  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.subject, "Your interview-prep sign-in code");
  for (const [part, content] of Object.entries({ text: body.text, html: body.html })) {
    assert.ok(content.includes("049217"), `the ${part} part must carry the code, leading zero and all`);
    assert.ok(content.includes("Ashdown Park Recruitment"), `the ${part} part must say who invited them`);
    assert.ok(content.includes("10 minutes"), `the ${part} part must say how long the code lasts`);
  }
});

test("the OTP email contains no link of any kind — the phishing lesson we refuse to teach", async () => {
  const { calls } = await withFetch(ok, () =>
    sendOtpEmail(ENV, { to: MESSAGE.to, code: "049217", agencyName: "Ashdown Park Recruitment" }),
  );

  const body = JSON.parse(calls[0].init.body);
  for (const [part, content] of Object.entries({ text: body.text, html: body.html })) {
    // An email that delivers a code AND a button teaches candidates that a message asking
    // them to click is normal, which is exactly what a phishing email needs them to believe.
    assert.ok(!content.includes("http"), `the ${part} part must contain no URL: ${content}`);
    assert.ok(!/<a[\s>]/i.test(content), `the ${part} part must contain no anchor`);
  }
});

test("an agency name cannot inject markup into the html part", async () => {
  const { calls } = await withFetch(ok, () =>
    sendOtpEmail(ENV, { to: MESSAGE.to, code: "049217", agencyName: '<script>alert(1)</script>' }),
  );
  const { html } = JSON.parse(calls[0].init.body);
  assert.ok(!html.includes("<script>"), "an agency name is content, not markup");
  assert.ok(html.includes("&lt;script&gt;"), "it is escaped rather than dropped");
});

test("sendOtpEmail with no agency name still says something a candidate can parse", async () => {
  const { calls } = await withFetch(ok, () => sendOtpEmail(ENV, { to: MESSAGE.to, code: "049217" }));
  const body = JSON.parse(calls[0].init.body);
  assert.ok(body.text.includes("your recruitment agency"), "a missing name must not print 'undefined' at a candidate");
});

// ── the provider's failures, which are the operator's to see and nobody else's ─────────

test("a 403 from Resend becomes mail_failed 502 and leaks neither address nor provider text", async () => {
  // 403 is the single most likely first failure in production: it means the sending domain
  // is not verified in Resend, which is a DNS job. The candidate must not be shown that.
  const { result } = await withFetch(() => status(403), () => sendEmail(ENV, MESSAGE));

  assert.ok(result.error instanceof StoreError);
  assert.equal(result.error.code, "mail_failed");
  assert.equal(result.error.status, 502);
  assert.ok(!result.error.message.includes(MESSAGE.to), "the recipient address must not ride the error");
  assert.ok(!result.error.message.includes("403"), "the provider's status is for the log, not the message");
});

test("422 and 429 fail the same way — the shape does not vary with the provider's mood", async () => {
  for (const code of [422, 429, 500]) {
    const thrown = await errorOf(async () => {
      const { result } = await withFetch(() => status(code), () => sendEmail(ENV, MESSAGE));
      if (result.error) throw result.error;
    });
    assert.ok(thrown instanceof StoreError, `status ${code} should throw a StoreError`);
    assert.equal(thrown.code, "mail_failed", `status ${code} maps to mail_failed`);
  }
});

test("sendEmail refuses an incomplete message before spending a request", async () => {
  for (const missing of ["to", "subject", "text"]) {
    const { calls, result } = await withFetch(ok, () => sendEmail(ENV, { ...MESSAGE, [missing]: "" }));
    assert.equal(result.error?.code, "missing_fields", `a blank ${missing} should be rejected`);
    assert.equal(calls.length, 0, `nothing may be sent with a blank ${missing}`);
  }
});
