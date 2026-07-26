// The default rendering. Body reads as prose; every sourced claim carries a numbered
// citation resolving to a SOURCES footer. Approved 26 July 2026 as the version a
// consultant would actually send.
//
// Returns { text, html } — §6.2's email-body branch needs both: plain text for the paste,
// light HTML for clients whose send is a formatted email body.

import { wrap, mark, quote, escapeHtml, UNVERIFIED } from "./text.js";

function collect(pack) {
  const sources = [];
  const cite = (c) => {
    if (c.source_type === "unverified") return null;
    sources.push(c);
    return sources.length;
  };
  const tag = (c) => {
    const n = cite(c);
    return n === null ? UNVERIFIED : ` [${n}]`;
  };
  return { sources, tag };
}

export function renderAppendix(pack) {
  return { text: toText(pack), html: toHtml(pack) };
}

function toText(pack) {
  const { sources, tag } = collect(pack);
  const L = [];

  L.push(`SUBMISSION PACK — ${pack.role_title}`);
  L.push(`Candidate ${pack.candidate_ref}`);
  L.push("");
  L.push(wrap(pack.headline));

  L.push("", "AGAINST THE BRIEF", "");
  for (const c of pack.evidence) L.push(wrap(`• ${c.requirement}: ${c.text}${tag(c)}`));

  if (pack.process_fit.length) {
    L.push("", "WHAT WE KNOW ABOUT YOUR PROCESS", "");
    for (const c of pack.process_fit) L.push(wrap(`• ${c.text}${tag(c)}`));
  }

  if (pack.gaps.length) {
    L.push("", "WHERE THEY DON'T MEET THE BRIEF", "");
    for (const c of pack.gaps) L.push(wrap(`• ${c.text}${tag(c)}`));
  }

  if (pack.open_questions.length) {
    L.push("", "FOR THE RECRUITER TO CONFIRM BEFORE SENDING", "");
    for (const q of pack.open_questions) L.push(wrap(`• ${q}`));
  }

  L.push("", "-".repeat(40), "SOURCES", "");
  sources.forEach((c, i) => {
    const from = c.source_type === "cv" ? "CV" : "our note on this client";
    L.push(wrap(`[${i + 1}] ${from}: "${quote(c.source_quote)}"`, 74));
  });

  L.push("");
  L.push(
    wrap(
      "Every claim above is traceable to a line in the CV or to our own record of this " +
        "client. Anything we could not source is marked UNVERIFIED and left for you.",
    ),
  );

  return L.join("\n") + "\n";
}

function toHtml(pack) {
  const { sources, tag } = collect(pack);
  const e = escapeHtml;
  const H = [];

  const section = (title, items) => {
    if (!items.length) return;
    H.push(`<p style="margin:18px 0 6px;font-weight:600">${e(title)}</p>`);
    H.push('<ul style="margin:0 0 0 18px;padding:0">');
    for (const li of items) H.push(`<li style="margin:0 0 6px">${li}</li>`);
    H.push("</ul>");
  };

  const claimLi = (c, prefix = "") => {
    const t = tag(c);
    const marker =
      t === UNVERIFIED
        ? ' <span style="color:#a33;font-weight:600">[UNVERIFIED]</span>'
        : `<sup>${e(t.trim())}</sup>`;
    return `${prefix}${e(c.text)}${marker}`;
  };

  H.push('<div style="font-family:Georgia,serif;font-size:15px;line-height:1.5;color:#1a1a1a">');
  H.push(`<p style="margin:0;font-weight:600">${e(pack.role_title)}</p>`);
  H.push(`<p style="margin:2px 0 14px;color:#555">Candidate ${e(pack.candidate_ref)}</p>`);
  H.push(`<p style="margin:0 0 4px">${e(pack.headline)}</p>`);

  section(
    "Against the brief",
    pack.evidence.map((c) => claimLi(c, `<strong>${e(c.requirement)}:</strong> `)),
  );
  section("What we know about your process", pack.process_fit.map((c) => claimLi(c)));
  section("Where they don't meet the brief", pack.gaps.map((c) => claimLi(c)));
  section("For the recruiter to confirm before sending", pack.open_questions.map(e));

  if (sources.length) {
    H.push('<hr style="border:0;border-top:1px solid #ddd;margin:22px 0 10px">');
    H.push('<p style="margin:0 0 6px;font-weight:600;font-size:13px">Sources</p>');
    H.push('<ol style="margin:0 0 0 18px;padding:0;font-size:13px;color:#444">');
    for (const c of sources) {
      const from = c.source_type === "cv" ? "CV" : "our note on this client";
      H.push(`<li style="margin:0 0 4px">${e(from)}: &ldquo;${e(quote(c.source_quote))}&rdquo;</li>`);
    }
    H.push("</ol>");
  }

  H.push(
    '<p style="margin:14px 0 0;font-size:13px;color:#555">Every claim above is traceable ' +
      "to a line in the CV or to our own record of this client. Anything we could not " +
      "source is marked UNVERIFIED and left for you.</p>",
  );
  H.push("</div>");

  return H.join("\n");
}
