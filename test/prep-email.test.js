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
import { MAIL_FROM_DEFAULT, mailFrom, sendEmail, sendInviteEmail, sendOtpEmail } from "../src/prep/email.js";

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

// ── the invite email (#22, decision 10) ────────────────────────────────────────────────
//
// The class of failure here is a header. `mailFrom` takes AGENCY-AUTHORED text and puts it
// into From:, which makes it the one place in this repo where a customer's typing reaches a
// protocol field. A newline in it is a second header; a comma in it is a malformed address.
// Both are invisible until an agency is called "Ashdown, Park & Co".
//
// The second failure is quieter: an invite whose link exists only inside an <a href>. It
// looks perfect in Gmail and is unusable in a plain-text client, which is exactly the reader
// most likely to be on a work machine that strips HTML.

const INVITE = {
  to: "candidate@example.com",
  agencyName: "Ashdown Recruitment",
  roleTitle: "Community Staff Nurse",
  interviewAt: "2026-08-12 00:00:00",
  link: "https://engine.pages.dev/prep/auth/enter?t=abc123",
};

/** The JSON body of the nth (default first) recorded Resend call. */
const bodyOf = (calls, n = 0) => JSON.parse(calls[n].init.body);

test("mailFrom puts the agency in the display name and keeps the configured address", () => {
  assert.equal(mailFrom({}, "Ashdown Recruitment"), '"Ashdown Recruitment" <prep@saulera.com>');
});

test("R8: a name carrying CR or LF cannot open a second header", () => {
  // The whole reason this function exists rather than a template literal. Unstripped, this
  // name adds a Bcc to every invite the agency ever sends.
  const value = mailFrom({}, "Evil\r\nBcc: attacker@example.com");

  assert.ok(!value.includes("\r"), "no carriage return survives");
  assert.ok(!value.includes("\n"), "no line feed survives");
  assert.equal(value.split(/\r?\n/).length, 1, "the header is a single line");
  assert.ok(!/^Bcc:/im.test(value), "and no second header was opened");
  assert.ok(value.endsWith("<prep@saulera.com>"), "the real address is still the address");
});

test("R8: a name that is legal English is legal RFC 5322", () => {
  // A comma reads as an address separator unquoted; a full stop is a `.` in an atom, which
  // is not permitted either. Both are ordinary agency names.
  for (const name of ["Ashdown, Park & Co", "A.B. Recruitment", "O'Neill Search"]) {
    const value = mailFrom({}, name);
    assert.ok(value.startsWith(`"${name}"`), `${name} must be wrapped in a quoted-string`);
  }
});

test("R8: quotes and backslashes inside a name are escaped, not passed through", () => {
  assert.equal(mailFrom({}, 'A "quoted" name'), '"A \\"quoted\\" name" <prep@saulera.com>');
  // The backslash is escaped FIRST, or the escaping of the quote gets escaped in turn.
  assert.equal(mailFrom({}, "back\\slash"), '"back\\\\slash" <prep@saulera.com>');
});

test("mailFrom with no usable name falls back to the configured string unchanged", () => {
  // A nameless agency gets today's behaviour rather than a broken header — which is also
  // what happens when the name is nothing but control characters.
  for (const name of ["", "   ", null, undefined, "\r\n"]) {
    assert.equal(mailFrom({}, name), MAIL_FROM_DEFAULT, `${JSON.stringify(name)} falls back`);
  }
});

test("mailFrom reads a bare address as well as a Name <address> form", () => {
  assert.equal(
    mailFrom({ PREP_MAIL_FROM: "prep@agency.co.uk" }, "X"),
    '"X" <prep@agency.co.uk>',
    "a configured bare address is wrapped, not treated as a display name",
  );
  assert.equal(
    mailFrom({ PREP_MAIL_FROM: "Agency Mail <hello@agency.co.uk>" }, "X"),
    '"X" <hello@agency.co.uk>',
    "and a configured display name is replaced rather than doubled up",
  );
});

test("mailFrom caps a name that is no longer a display name", () => {
  const value = mailFrom({}, "A".repeat(500));
  assert.ok(value.length < 200, "an unbounded header field is a header field nobody reads");
  assert.ok(value.endsWith("<prep@saulera.com>"));
});

test("AC #5: the invite's TEXT half carries the URL as bare text on its own line", () => {
  return withFetch(ok, () => sendInviteEmail(ENV, INVITE)).then(({ calls }) => {
    const body = bodyOf(calls);
    // A plain-text client renders exactly this. A link that lives only in the html half is a
    // link that reader cannot follow.
    assert.ok(
      body.text.split("\n").includes(INVITE.link),
      `the link must stand alone on a line:\n${body.text}`,
    );
  });
});

test("AC #5: the invite's HTML half carries the URL inside an href", () => {
  return withFetch(ok, () => sendInviteEmail(ENV, INVITE)).then(({ calls }) => {
    const body = bodyOf(calls);
    assert.ok(body.html.includes(`href="${INVITE.link}"`), "the html half links it");
  });
});

test("the invite names the role, the date and the retention rule", async () => {
  const { calls } = await withFetch(ok, () => sendInviteEmail(ENV, INVITE));
  const body = bodyOf(calls);

  assert.equal(body.subject, "Your interview prep for Community Staff Nurse");
  assert.ok(body.text.includes("2026-08-12"), "the interview date, day-only");
  assert.ok(!body.text.includes("00:00:00"), "and not the retention machinery's zeros");
  assert.ok(/deleted 30 days/.test(body.text), "decision 13's retention sentence");
  assert.ok(/delete-now/.test(body.text), "and the button that does it sooner");
  assert.ok(body.text.includes("/prep/login"), "and where to go when the link stops working");
});

test("the invite's From carries the agency name; the OTP's does not change", async () => {
  const { calls } = await withFetch(ok, () => sendInviteEmail(ENV, INVITE));
  assert.equal(bodyOf(calls).from, '"Ashdown Recruitment" <prep@saulera.com>');

  // The existing message is untouched by the `from` parameter being added to sendEmail.
  const otp = await withFetch(ok, () => sendOtpEmail(ENV, { to: INVITE.to, code: "123456" }));
  assert.equal(bodyOf(otp.calls).from, MAIL_FROM_DEFAULT);
});

test("an agency name cannot inject markup into the invite's html half", async () => {
  const { calls } = await withFetch(ok, () =>
    sendInviteEmail(ENV, { ...INVITE, agencyName: "<script>alert(1)</script>Agency" }),
  );
  const body = bodyOf(calls);
  assert.ok(!body.html.includes("<script>"), "the tag does not survive as markup");
  assert.ok(body.html.includes("&lt;script&gt;"), "it survives as text, which is the point");
});

test("a blank role title degrades to a subject that still says what this is", async () => {
  const { calls } = await withFetch(ok, () => sendInviteEmail(ENV, { ...INVITE, roleTitle: "" }));
  assert.equal(bodyOf(calls).subject, "Your interview prep");
});

test("with no RESEND_API_KEY the invite throws before any fetch", async () => {
  // The same assertion the file already makes for sendEmail: the guard is BEFORE the request,
  // so a misconfigured deployment does not spend an API call to find out.
  const { calls, result } = await withFetch(ok, () => sendInviteEmail({}, INVITE));
  assert.equal(calls.length, 0, "nothing may reach Resend without a key");
  assert.ok(result.error instanceof StoreError);
  assert.equal(result.error.code, "not_configured");
});

test("a 403 on the invite becomes mail_failed and leaks neither address nor provider text", async () => {
  const { result } = await withFetch(() => status(403), () => sendInviteEmail(ENV, INVITE));
  assert.equal(result.error.code, "mail_failed");
  assert.equal(result.error.status, 502);
  assert.ok(!String(result.error.message).includes(INVITE.to), "the recipient stays out of the error");
});
