// Second rendering. Source quote sits under each claim, in the body.
//
// Not the default — this is the one that reads closest to a compliance form, which is the
// failure mode architecture §7 told us to watch for. It ships for the case where a client
// wants sourcing visible without turning to a footer.

import { wrap, mark, quote, escapeHtml } from "./text.js";

export function renderInline(pack) {
  return { text: toText(pack), html: toHtml(pack) };
}

function toText(pack) {
  const L = [];
  const src = (c) =>
    c.source_type !== "unverified" && L.push(wrap(`  Source: "${quote(c.source_quote)}"`, 74));

  L.push(`SUBMISSION PACK — ${pack.role_title}`);
  L.push(`Candidate ${pack.candidate_ref}`);
  L.push("");
  L.push(wrap(pack.headline));

  L.push("", "AGAINST THE BRIEF");
  for (const c of pack.evidence) {
    L.push("");
    L.push(wrap(`• ${c.requirement}`));
    L.push(wrap(`  ${c.text}${mark(c)}`));
    src(c);
  }

  if (pack.process_fit.length) {
    L.push("", "WHAT WE KNOW ABOUT YOUR PROCESS");
    for (const c of pack.process_fit) {
      L.push("");
      L.push(wrap(`• ${c.text}${mark(c)}`));
      src(c);
    }
  }

  if (pack.gaps.length) {
    L.push("", "WHERE THEY DON'T MEET THE BRIEF");
    for (const c of pack.gaps) {
      L.push("");
      L.push(wrap(`• ${c.text}${mark(c)}`));
      src(c);
    }
  }

  if (pack.open_questions.length) {
    L.push("", "FOR THE RECRUITER TO CONFIRM BEFORE SENDING", "");
    for (const q of pack.open_questions) L.push(wrap(`• ${q}`));
  }

  return L.join("\n") + "\n";
}

function toHtml(pack) {
  const e = escapeHtml;
  const H = [];

  const claim = (c, prefix = "") => {
    const marker =
      c.source_type === "unverified"
        ? ' <span style="color:#a33;font-weight:600">[UNVERIFIED]</span>'
        : "";
    const source =
      c.source_type === "unverified"
        ? ""
        : `<div style="margin:2px 0 0;font-size:13px;color:#666">Source: &ldquo;${e(quote(c.source_quote))}&rdquo;</div>`;
    return `<li style="margin:0 0 10px">${prefix}${e(c.text)}${marker}${source}</li>`;
  };

  const section = (title, items) => {
    if (!items.length) return;
    H.push(`<p style="margin:18px 0 6px;font-weight:600">${e(title)}</p>`);
    H.push('<ul style="margin:0 0 0 18px;padding:0">');
    H.push(...items);
    H.push("</ul>");
  };

  H.push('<div style="font-family:Georgia,serif;font-size:15px;line-height:1.5;color:#1a1a1a">');
  H.push(`<p style="margin:0;font-weight:600">${e(pack.role_title)}</p>`);
  H.push(`<p style="margin:2px 0 14px;color:#555">Candidate ${e(pack.candidate_ref)}</p>`);
  H.push(`<p style="margin:0 0 4px">${e(pack.headline)}</p>`);

  section(
    "Against the brief",
    pack.evidence.map((c) => claim(c, `<strong>${e(c.requirement)}:</strong> `)),
  );
  section("What we know about your process", pack.process_fit.map((c) => claim(c)));
  section("Where they don't meet the brief", pack.gaps.map((c) => claim(c)));
  section(
    "For the recruiter to confirm before sending",
    pack.open_questions.map((q) => `<li style="margin:0 0 6px">${e(q)}</li>`),
  );

  H.push("</div>");
  return H.join("\n");
}
