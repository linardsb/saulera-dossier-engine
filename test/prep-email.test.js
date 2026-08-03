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
import {
  MAIL_FROM_DEFAULT,
  mailFrom,
  sendEmail,
  sendExpiryDigestEmail,
  sendExpiryNudgeEmail,
  sendExtensionNudgeEmail,
  sendInviteEmail,
  sendOtpEmail,
  sendRejectionEmail,
  sendReminderEmail,
} from "../src/prep/email.js";

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

test("R8, applied to the subject too: a role title cannot open a second header", async () => {
  // `mailFrom` strips, caps and quotes the agency name for exactly this reason, and the subject
  // was the one header field taking a browser-supplied value straight through. `role_title` is
  // model-written and arrives in the send body — unbounded, and never checked for CR or LF.
  const { calls } = await withFetch(ok, () =>
    sendInviteEmail(ENV, { ...INVITE, roleTitle: "Nurse\r\nBcc: attacker@example.com" }),
  );
  const body = bodyOf(calls);

  assert.ok(!body.subject.includes("\r"), "no carriage return survives");
  assert.ok(!body.subject.includes("\n"), "no line feed survives");
  assert.equal(body.subject.split(/\r?\n/).length, 1, "the subject is a single line");

  // And it is capped, so a runaway title becomes a long subject rather than a provider
  // rejection the recruiter cannot diagnose.
  const long = await withFetch(ok, () =>
    sendInviteEmail(ENV, { ...INVITE, roleTitle: "x".repeat(5_000) }),
  );
  assert.ok(bodyOf(long.calls).subject.length < 200, "the subject stays a subject");

  // A legitimate title is untouched — the discipline must not cost the ordinary case.
  const plain = await withFetch(ok, () => sendInviteEmail(ENV, INVITE));
  assert.equal(bodyOf(plain.calls).subject, "Your interview prep for Community Staff Nurse");
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

// ── the reminder (#25, decision 17) ────────────────────────────────────────────────────
//
// The third email, the third rule: a PLAIN portal-entry link, never a token. And the
// hardest tone gate of the three — this message lands the evening before an interview.

const REMINDER = {
  to: "candidate@example.com",
  agencyName: "Ashdown Recruitment",
  link: "https://engine.pages.dev/prep/login",
};

test("the reminder hits the endpoint with the bearer key and the exact subject", async () => {
  const { calls } = await withFetch(ok, () => sendReminderEmail(ENV, REMINDER));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.resend.com/emails");
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${ENV.RESEND_API_KEY}`);
  assert.equal(bodyOf(calls).subject, "Your interview is tomorrow");
});

test("the reminder's link is bare text in the text half and an anchor in the html half", async () => {
  const { calls } = await withFetch(ok, () => sendReminderEmail(ENV, REMINDER));
  const body = bodyOf(calls);
  assert.ok(body.text.split("\n").includes(REMINDER.link), "bare on its own line, for plain-text clients");
  assert.ok(body.html.includes(`href="${REMINDER.link}"`), "the html half links it");
});

test("the reminder carries no token-shaped query param anywhere", async () => {
  const { calls } = await withFetch(ok, () => sendReminderEmail(ENV, REMINDER));
  const whole = JSON.stringify(bodyOf(calls));
  // Only the hash of a token ever rests; there is nothing to send, and minting one would
  // rotate token_hash under a live session.
  assert.ok(!whole.includes("t="), "no ?t= — the reminder is not a magic link");
});

test("the reminder's From carries the agency name through mailFrom", async () => {
  const { calls } = await withFetch(ok, () => sendReminderEmail(ENV, REMINDER));
  assert.equal(bodyOf(calls).from, '"Ashdown Recruitment" <prep@saulera.com>');

  const bare = await withFetch(ok, () => sendReminderEmail(ENV, { ...REMINDER, agencyName: "" }));
  assert.equal(bodyOf(bare.calls).from, MAIL_FROM_DEFAULT, "a nameless agency falls back");
  assert.ok(bodyOf(bare.calls).text.includes("your recruitment agency"), "and the sign-off still parses");
});

test("with no RESEND_API_KEY the reminder makes zero fetch calls", async () => {
  const { calls, result } = await withFetch(ok, () => sendReminderEmail({}, REMINDER));
  assert.equal(calls.length, 0);
  assert.equal(result.error?.code, "not_configured");
});

test("the reminder's tone: no exclamation mark, no pressure, in either half", async () => {
  const { calls } = await withFetch(ok, () => sendReminderEmail(ENV, REMINDER));
  const body = bodyOf(calls);
  for (const [part, content] of Object.entries({ text: body.text, html: body.html })) {
    assert.ok(!content.includes("!"), `no exclamation mark in the ${part} half`);
    assert.ok(!/streak|don't forget|good luck|you've got this/i.test(content), `no pressure in the ${part} half`);
  }
});

// ── the extension nudge (#69), the one message addressed to the agency ─────────────────

const NUDGE = {
  to: "desk@ttrhealthcare.example",
  agencyName: "TTR Healthcare",
  candidateName: "Priya Nair",
  clientName: "Ashdown Park Community Healthcare",
  endDate: "2026-09-21",
  link: "https://engine.pages.dev/assignments",
};

test("the nudge names the candidate, the client and the day in both halves", async () => {
  const { calls } = await withFetch(ok, () => sendExtensionNudgeEmail(ENV, NUDGE));
  const body = bodyOf(calls);

  assert.equal(body.subject, "Booking ending: Priya Nair at Ashdown Park Community Healthcare");
  for (const [part, content] of Object.entries({ text: body.text, html: body.html })) {
    assert.ok(content.includes(NUDGE.candidateName), `the ${part} half names the candidate`);
    assert.ok(content.includes(NUDGE.clientName), `the ${part} half names the client`);
    assert.ok(content.includes("2026-09-21"), `the ${part} half carries the end date`);
    // sendInviteEmail's treatment: a recruiter reading "2026-09-21 00:00:00" learns nothing
    // from the zeros.
    assert.ok(!content.includes("00:00:00"), `the ${part} half renders the date day-only`);
  }
});

test("the nudge's link is the recruiter's screen, bare in the text half — and never a portal path", async () => {
  const { calls } = await withFetch(ok, () => sendExtensionNudgeEmail(ENV, NUDGE));
  const body = bodyOf(calls);

  assert.ok(body.text.split("\n").includes(NUDGE.link), "bare on its own line, for plain-text clients");
  assert.ok(body.html.includes(`href="${NUDGE.link}"`), "the html half links it");
  // The recipient is the recruiter. A /prep/* link would send them to the candidate's door, and
  // /prep/* is the one tree the two Access bypass apps leave open.
  assert.ok(!JSON.stringify(body).includes("/prep/"), "the nudge never points at the candidate portal");
});

test("R8 on the nudge's subject: neither name can open a second header", async () => {
  const { calls } = await withFetch(ok, () =>
    sendExtensionNudgeEmail(ENV, {
      ...NUDGE,
      candidateName: "Priya\r\nBcc: someone@else.example",
      clientName: "Ashdown\nX-Evil: yes",
    }),
  );
  const { subject } = bodyOf(calls);
  assert.ok(!subject.includes("\r"), "no carriage return survives");
  assert.ok(!subject.includes("\n"), "no line feed survives");
  assert.equal(subject.split(/\r?\n/).length, 1, "the subject is a single line");
  // The smuggled words survive as TEXT, which is correct and is what sendInviteEmail does too:
  // the injection is the line break, not the string "Bcc:". Stripping words would be a
  // denylist, and a denylist is the wrong shape for a header-safety rule.
  assert.ok(subject.includes("Bcc: someone@else.example"), "stripped to a space, not censored");

  // A legitimate pair is untouched — the discipline must not cost the ordinary case.
  const plain = await withFetch(ok, () => sendExtensionNudgeEmail(ENV, NUDGE));
  assert.equal(
    bodyOf(plain.calls).subject,
    "Booking ending: Priya Nair at Ashdown Park Community Healthcare",
  );
});

test("a name over the cap is sliced rather than rejected", async () => {
  const { calls } = await withFetch(ok, () =>
    sendExtensionNudgeEmail(ENV, { ...NUDGE, clientName: "A".repeat(400) }),
  );
  // The cap keeps a runaway value out of a Resend rejection the recruiter cannot diagnose.
  assert.ok(bodyOf(calls).subject.length < 300);
});

test("a candidate name containing markup is escaped in the html half", async () => {
  const { calls } = await withFetch(ok, () =>
    sendExtensionNudgeEmail(ENV, { ...NUDGE, candidateName: "<script>alert(1)</script>" }),
  );
  const body = bodyOf(calls);
  assert.ok(!body.html.includes("<script>"), "mail clients render whatever markup arrives");
  assert.ok(body.html.includes("&lt;script&gt;"), "and it survives as text");
});

test("the nudge's From carries the agency name through mailFrom", async () => {
  const { calls } = await withFetch(ok, () => sendExtensionNudgeEmail(ENV, NUDGE));
  assert.equal(bodyOf(calls).from, '"TTR Healthcare" <prep@saulera.com>');

  const bare = await withFetch(ok, () => sendExtensionNudgeEmail(ENV, { ...NUDGE, agencyName: "" }));
  assert.equal(bodyOf(bare.calls).from, MAIL_FROM_DEFAULT, "a nameless agency falls back");
});

test("with no RESEND_API_KEY the nudge makes zero fetch calls", async () => {
  const { calls, result } = await withFetch(ok, () => sendExtensionNudgeEmail({}, NUDGE));
  assert.equal(calls.length, 0);
  assert.equal(result.error?.code, "not_configured");
});

test("the nudge's tone: one calm ask, no pressure, in either half", async () => {
  const { calls } = await withFetch(ok, () => sendExtensionNudgeEmail(ENV, NUDGE));
  const body = bodyOf(calls);
  for (const [part, content] of Object.entries({ text: body.text, html: body.html })) {
    assert.ok(!content.includes("!"), `no exclamation mark in the ${part} half`);
    assert.ok(!/urgent|act now|don't forget|last chance/i.test(content), `no pressure in the ${part} half`);
  }
});

// ── the expiry pair (#70) ──────────────────────────────────────────────────────────────

const EXPIRY_LINK = "https://engine.pages.dev/prep/compliance/login";

const EXPIRING = {
  to: "locum@example.com",
  agencyName: "TTR Healthcare",
  link: EXPIRY_LINK,
  items: [
    { label: "Immunisation record", status: "expiring", expiryDate: "2026-09-02" },
    { label: "HCPC registration", status: "expiring", expiryDate: "2026-09-30" },
  ],
};

test("the candidate's nudge lists every item that crossed, in one message", async () => {
  const { calls } = await withFetch(ok, () => sendExpiryNudgeEmail(ENV, EXPIRING));
  const body = bodyOf(calls);

  // ONE message per sweep, not one per item: a locum whose DBS and immunisations lapse the same
  // week gets one email and not two.
  for (const [part, content] of Object.entries({ text: body.text, html: body.html })) {
    assert.ok(content.includes("Immunisation record"), `the ${part} half names the first item`);
    assert.ok(content.includes("HCPC registration"), `the ${part} half names the second`);
    assert.ok(content.includes("2026-09-02"), `the ${part} half carries the date`);
    assert.ok(!content.includes("00:00:00"), `the ${part} half renders the date day-only`);
  }
  // Three items, three lines — the batch is a list rather than a sentence that grows. The item
  // lines are the indented ones; matching on "runs out" would also catch the closing sentence
  // about what we do and do not store.
  const itemLines = (text) => text.split("\n").filter((line) => line.startsWith("  "));
  assert.equal(itemLines(body.text).length, 2);
  const three = await withFetch(ok, () =>
    sendExpiryNudgeEmail(ENV, {
      ...EXPIRING,
      items: [...EXPIRING.items, { label: "Fit-to-work check", status: "expiring", expiryDate: "2026-10-01" }],
    }),
  );
  assert.equal(itemLines(bodyOf(three.calls).text).length, 3);
});

test("the nudge's subject turns on the WORST state in the batch", async () => {
  const soon = await withFetch(ok, () => sendExpiryNudgeEmail(ENV, EXPIRING));
  assert.equal(bodyOf(soon.calls).subject, "Something we hold for you runs out soon");

  // "has run out" and "runs out soon" are different problems, and an inbox preview is the first
  // surface either one reaches.
  const lapsed = await withFetch(ok, () =>
    sendExpiryNudgeEmail(ENV, {
      ...EXPIRING,
      items: [EXPIRING.items[0], { label: "HCPC registration", status: "expired", expiryDate: "2026-07-01" }],
    }),
  );
  const body = bodyOf(lapsed.calls);
  assert.equal(body.subject, "Something we hold for you has run out");
  assert.ok(body.text.includes("ran out 2026-07-01"), "and the per-item tense is per item");
  assert.ok(body.text.includes("runs out 2026-09-02"), "the amber one still reads as amber");
});

test("the nudge's link is the COMPLIANCE door, bare in the text half — never /prep/login", async () => {
  const { calls } = await withFetch(ok, () => sendExpiryNudgeEmail(ENV, EXPIRING));
  const body = bodyOf(calls);

  assert.ok(body.text.split("\n").includes(EXPIRY_LINK), "bare on its own line, for plain-text clients");
  assert.ok(body.html.includes(`href="${EXPIRY_LINK}"`), "the html half links it");
  // The two portals hold independent cookies: a candidate sent to /prep/login would sign in to
  // the interview-prep product instead of their checklist.
  assert.ok(!/\/prep\/login/.test(JSON.stringify(body)), "never the interview-prep door");
  // sendReminderEmail's rule: no raw token exists to send, and minting one would rotate
  // session_hash under a live session.
  assert.ok(!/\/prep\/auth\/enter/.test(JSON.stringify(body)), "and never a tokenized path");
});

test("the nudge never reads the candidate's own reference number back to them", async () => {
  const { calls } = await withFetch(ok, () =>
    sendExpiryNudgeEmail(ENV, {
      ...EXPIRING,
      items: [{ ...EXPIRING.items[0], reference: "IMM-2024-118" }],
    }),
  );
  // It is theirs, they typed it, and this message could sit in an inbox for years. It has to say
  // what to renew, not recite their paperwork.
  assert.ok(!JSON.stringify(bodyOf(calls)).includes("IMM-2024-118"));
});

test("the nudge's From carries the agency name, and its body escapes it", async () => {
  const { calls } = await withFetch(ok, () => sendExpiryNudgeEmail(ENV, EXPIRING));
  const body = bodyOf(calls);
  assert.equal(body.from, '"TTR Healthcare" <prep@saulera.com>');
  assert.ok(body.text.includes("TTR Healthcare"));

  const evil = await withFetch(ok, () =>
    sendExpiryNudgeEmail(ENV, { ...EXPIRING, agencyName: "<script>alert(1)</script>" }),
  );
  assert.ok(!bodyOf(evil.calls).html.includes("<script>"), "mail clients render whatever markup arrives");

  const bare = await withFetch(ok, () => sendExpiryNudgeEmail(ENV, { ...EXPIRING, agencyName: "" }));
  assert.ok(bodyOf(bare.calls).text.includes("your recruitment agency"), "a nameless agency still parses");
});

test("the nudge's tone: calm, no pressure, no consequence we cannot know", async () => {
  const { calls } = await withFetch(ok, () => sendExpiryNudgeEmail(ENV, EXPIRING));
  const body = bodyOf(calls);
  for (const [part, content] of Object.entries({ text: body.text, html: body.html })) {
    assert.ok(!content.includes("!"), `no exclamation mark in the ${part} half`);
    assert.ok(
      !/urgent|act now|don't forget|last chance|immediately/i.test(content),
      `no pressure in the ${part} half`,
    );
  }
});

test("with no RESEND_API_KEY the nudge makes zero fetch calls", async () => {
  const { calls, result } = await withFetch(ok, () => sendExpiryNudgeEmail({}, EXPIRING));
  assert.equal(calls.length, 0);
  assert.equal(result.error?.code, "not_configured");
});

const DIGEST = {
  to: "desk@ttrhealthcare.example",
  agencyName: "TTR Healthcare",
  rows: [
    { candidateName: "Priya Nair", label: "Immunisation record", status: "expiring", expiryDate: "2026-09-02" },
    { candidateName: "Tom Okafor", label: "Enhanced DBS check", status: "expired", expiryDate: "2026-07-14" },
  ],
};

test("the digest names every candidate and item, with each one's own tense", async () => {
  const { calls } = await withFetch(ok, () => sendExpiryDigestEmail(ENV, DIGEST));
  const body = bodyOf(calls);

  for (const [part, content] of Object.entries({ text: body.text, html: body.html })) {
    assert.ok(content.includes("Priya Nair"), `the ${part} half names the first candidate`);
    assert.ok(content.includes("Tom Okafor"), `the ${part} half names the second`);
    assert.ok(content.includes("Immunisation record"), `the ${part} half names the first item`);
    assert.ok(content.includes("Enhanced DBS check"), `the ${part} half names the second`);
  }
  assert.ok(body.text.includes("runs out 2026-09-02"), "amber reads as amber");
  assert.ok(body.text.includes("ran out 2026-07-14"), "and red reads as red");
});

test("WITH NO LINK THE DIGEST IS #70'S MESSAGE, UNCHANGED", async () => {
  const { calls } = await withFetch(ok, () => sendExpiryDigestEmail(ENV, DIGEST));
  const body = bodyOf(calls);

  // #71 gave this message an OPTIONAL link. Optional is the whole point: the caller's two
  // configuration guards are independent, so a deployment carrying RECRUITER_EMAIL and no
  // PREP_BASE_URL must keep receiving exactly the digest it receives today. This is that
  // guarantee, and it is what stops the link becoming a precondition by accident.
  assert.doesNotMatch(body.text, /https?:\/\//, "no URL in the text half");
  assert.doesNotMatch(body.html, /https?:\/\//, "nor in the html half");
  assert.ok(!body.html.includes("<a "), "and no anchor at all");
  assert.ok(!JSON.stringify({ text: body.text, html: body.html }).includes("/prep/"));
});

test("with a link the digest points at the recruiter's screen, never at a candidate door", async () => {
  const { calls } = await withFetch(ok, () =>
    sendExpiryDigestEmail(ENV, { ...DIGEST, link: "https://engine.pages.dev/compliance" }),
  );
  const body = bodyOf(calls);

  for (const [half, content] of Object.entries({ text: body.text, html: body.html })) {
    assert.ok(content.includes("https://engine.pages.dev/compliance"), `the ${half} half carries it`);
    // The rule #70 asserted for the extension nudge, at a second root: a /prep/* link would send
    // the recruiter to the candidate's portal, which holds a different product's cookies.
    assert.ok(!content.includes("/prep/"), `the ${half} half points at no portal path`);
  }
  // The TEXT half carries it as bare text on its own line — a plain-text client shows exactly
  // what the text half says, and a link that exists only as an <a> href cannot be followed.
  assert.ok(body.text.split("\n").includes("https://engine.pages.dev/compliance"));
});

test("the digest's subject carries a COUNT and no name", async () => {
  const { calls } = await withFetch(ok, () => sendExpiryDigestEmail(ENV, DIGEST));
  const { subject } = bodyOf(calls);

  // An inbox preview naming a locum's compliance problem on a shared desk is a disclosure
  // nobody chose.
  assert.equal(subject, "Compliance expiries — 2 to chase");
  assert.ok(!subject.includes("Priya"));
  assert.ok(!subject.includes("Nair"));
});

test("R8 on the digest: a candidate name cannot open a second header, and a runaway one is capped", async () => {
  const { calls } = await withFetch(ok, () =>
    sendExpiryDigestEmail(ENV, {
      ...DIGEST,
      rows: [
        { ...DIGEST.rows[0], candidateName: "Priya\r\nBcc: someone@else.example" },
        { ...DIGEST.rows[1], candidateName: "A".repeat(400) },
      ],
    }),
  );
  const body = bodyOf(calls);

  const stripped = body.text.split("\n").find((line) => line.includes("Priya"));
  assert.ok(!stripped.includes("\r"), "no carriage return survives");
  // The smuggled words survive as TEXT, exactly as sendExtensionNudgeEmail's do: the injection
  // is the line break, not the string "Bcc:". Stripping words would be a denylist.
  assert.ok(stripped.includes("Bcc: someone@else.example"), "stripped to a space, not censored");
  assert.ok(!body.text.includes("A".repeat(200)), "and a runaway name is capped");
});

test("a candidate name containing markup is escaped in the digest's html half", async () => {
  const { calls } = await withFetch(ok, () =>
    sendExpiryDigestEmail(ENV, {
      ...DIGEST,
      rows: [{ ...DIGEST.rows[0], candidateName: "<script>alert(1)</script>" }],
    }),
  );
  const body = bodyOf(calls);
  assert.ok(!body.html.includes("<script>"), "mail clients render whatever markup arrives");
  assert.ok(body.html.includes("&lt;script&gt;"), "and it survives as text");
});

test("the digest's From carries the agency name through mailFrom", async () => {
  const { calls } = await withFetch(ok, () => sendExpiryDigestEmail(ENV, DIGEST));
  assert.equal(bodyOf(calls).from, '"TTR Healthcare" <prep@saulera.com>');

  const bare = await withFetch(ok, () => sendExpiryDigestEmail(ENV, { ...DIGEST, agencyName: "" }));
  assert.equal(bodyOf(bare.calls).from, MAIL_FROM_DEFAULT, "a nameless agency falls back");
});

test("with no RESEND_API_KEY the digest makes zero fetch calls", async () => {
  const { calls, result } = await withFetch(ok, () => sendExpiryDigestEmail({}, DIGEST));
  assert.equal(calls.length, 0);
  assert.equal(result.error?.code, "not_configured");
});

// ── the rejection (#71) ────────────────────────────────────────────────────────────────
//
// The seventh message, and the only one in this file whose CONTENT exists nowhere else: the
// reason is not stored (src/compliance/store.js's rejectItem writes no note and this ticket adds
// no column), which is why functions/api/compliance/[id].js refuses to write the reset unless it
// can send this. These assertions are what that refusal is protecting.

const REJECTION = {
  to: "priya@example.com",
  agencyName: "TTR Healthcare",
  label: "Enhanced DBS check",
  reason: "the certificate is in a different name from your right to work",
  link: "https://engine.pages.dev/prep/compliance/login",
};

test("the rejection's subject carries the ITEM and never the reason", async () => {
  const { calls } = await withFetch(ok, () => sendRejectionEmail(ENV, REJECTION));
  const { subject } = bodyOf(calls);

  // An inbox preview is the first surface this reaches, and a preview reading why a locum's DBS
  // was refused — on a shared phone, on a ward desk — is a disclosure nobody chose. The digest's
  // argument at a message that names one person instead of N.
  assert.ok(subject.includes("Enhanced DBS check"), "the label, so it is openable");
  assert.ok(!subject.includes("different name"), "and not a word of the reason");
  assert.ok(!subject.includes("right to work"));
});

test("the reason is in BOTH halves of the body, and nowhere else", async () => {
  const { calls } = await withFetch(ok, () => sendRejectionEmail(ENV, REJECTION));
  const body = bodyOf(calls);

  assert.ok(body.text.includes(REJECTION.reason), "the text half");
  assert.ok(body.html.includes(REJECTION.reason), "and the html half — a plain-text client sees only the first");
  // NO REFERENCE NUMBER anywhere: the item was just cleared, so there is nothing valid to quote,
  // and reading their own paperwork back to them is what sendExpiryNudgeEmail refuses.
  assert.ok(!body.text.includes("reference number is"), "no paperwork read back at them");
});

test("a reason containing markup is escaped in the html half", async () => {
  const { calls } = await withFetch(ok, () =>
    sendRejectionEmail(ENV, { ...REJECTION, reason: "<script>alert(1)</script>" }),
  );
  const body = bodyOf(calls);

  assert.ok(!body.html.includes("<script>"), "mail clients render whatever markup arrives");
  assert.ok(body.html.includes("&lt;script&gt;"), "and it survives as text");
  assert.ok(body.text.includes("<script>"), "the text half is text and needs no escape");
});

test("R8 on the rejection: a label cannot open a second header, and a runaway one is capped", async () => {
  // The label is OURS — it comes from COMPLIANCE_CATALOGUE — and that is not a reason to skip
  // the treatment. A catalogue edit is one careless paste away from carrying a newline, and this
  // value reaches a Subject header.
  const { calls } = await withFetch(ok, () =>
    sendRejectionEmail(ENV, { ...REJECTION, label: "DBS\r\nBcc: someone@else.example" }),
  );
  const { subject } = bodyOf(calls);
  assert.ok(!subject.includes("\r"), "no carriage return survives");
  assert.ok(!subject.includes("\n"), "nor a line feed");
  // The smuggled words survive as TEXT, exactly as the digest's do: the injection is the line
  // break, not the string "Bcc:". Stripping words would be a denylist.
  assert.ok(subject.includes("Bcc: someone@else.example"), "stripped to a space, not censored");

  const runaway = await withFetch(ok, () => sendRejectionEmail(ENV, { ...REJECTION, label: "A".repeat(400) }));
  assert.ok(!bodyOf(runaway.calls).subject.includes("A".repeat(200)), "and a runaway label is capped");
});

test("the reason is NOT capped here — the route owns that number", async () => {
  // Capping twice with two different numbers is how a message ends up truncated at a length
  // nobody chose. functions/api/compliance/[id].js's REASON_MAX is the one bound on this value.
  const long = "z".repeat(400);
  const { calls } = await withFetch(ok, () => sendRejectionEmail(ENV, { ...REJECTION, reason: long }));
  assert.ok(bodyOf(calls).text.includes(long), "whatever the route allowed through, arrives whole");
});

test("a reason with a line break in it is put back on one line", async () => {
  // "One line" is the ticket's word. A newline inside it would break the quoted block in the
  // text half into something that reads as two separate remarks.
  const { calls } = await withFetch(ok, () =>
    sendRejectionEmail(ENV, { ...REJECTION, reason: "wrong name\r\nand it has expired" }),
  );
  const body = bodyOf(calls);
  const quoted = body.text.split("\n").find((line) => line.includes("wrong name"));
  assert.ok(quoted.includes("and it has expired"), "both clauses on one line");
});

test("the rejection points at the COMPLIANCE door and never the interview-prep one", async () => {
  const { calls } = await withFetch(ok, () => sendRejectionEmail(ENV, REJECTION));
  const body = bodyOf(calls);

  for (const [half, content] of Object.entries({ text: body.text, html: body.html })) {
    assert.ok(content.includes("/prep/compliance/login"), `the ${half} half opens the checklist`);
  }
  // The two portals hold independent cookies: a candidate sent to /prep/login signs in to the
  // interview-prep product and never finds the item they were asked to replace.
  assert.ok(!body.text.includes("https://engine.pages.dev/prep/login"));
  // The text half carries the URL as bare text on its own line — sendInviteEmail's rule.
  assert.ok(body.text.split("\n").includes(REJECTION.link));
});

test("the rejection's From carries the agency name through mailFrom", async () => {
  const { calls } = await withFetch(ok, () => sendRejectionEmail(ENV, REJECTION));
  assert.equal(bodyOf(calls).from, '"TTR Healthcare" <prep@saulera.com>');

  const bare = await withFetch(ok, () => sendRejectionEmail(ENV, { ...REJECTION, agencyName: "" }));
  assert.equal(bodyOf(bare.calls).from, MAIL_FROM_DEFAULT, "a nameless agency falls back");
  assert.ok(bodyOf(bare.calls).text.includes("your recruitment agency"), "and so does the body");
});

test("decision 17's tone rule holds on the hardest message to hold it on", async () => {
  const { calls } = await withFetch(ok, () => sendRejectionEmail(ENV, REJECTION));
  const body = bodyOf(calls);

  // Calm, no deadline pressure, no exclamation mark, nothing implying a consequence we cannot
  // know. This is the message most likely to acquire "or you cannot be booked" in a later edit.
  assert.ok(!body.text.includes("!"), "no exclamation mark");
  assert.doesNotMatch(body.text, /urgent|immediately|as soon as possible|at risk|booking/i);
});

test("with no RESEND_API_KEY the rejection makes zero fetch calls", async () => {
  const { calls, result } = await withFetch(ok, () => sendRejectionEmail({}, REJECTION));
  assert.equal(calls.length, 0);
  assert.equal(result.error?.code, "not_configured");
});
