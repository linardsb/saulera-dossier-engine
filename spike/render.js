// Two renderings of the same canonical pack, so the spike can settle architecture §7's
// second decision rule by comparison rather than by argument:
//
//   "If the evidence-anchored output reads like a compliance form rather than a
//    submission, provenance moves to a footer or appendix and stays out of the body."
//
// Read both. Whichever one you would actually send is the answer, and it becomes #7's
// default rendering.

import { allClaims } from "./schema.js";

const wrap = (s, width = 78) => {
  const out = [];
  for (const para of s.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      if (!word) continue;
      if ((line + " " + word).trim().length > width) {
        out.push(line.trim());
        line = word;
      } else {
        line += " " + word;
      }
    }
    out.push(line.trim());
  }
  return out.join("\n");
};

const mark = (c) => (c.source_type === "unverified" ? " [UNVERIFIED]" : "");

// Quotes are stored verbatim so the check can match them, which means they carry the
// source document's own line breaks. Collapse those for display only — never for the
// stored value the verifier reads.
const quote = (s) => s.replace(/\s+/g, " ").trim();

// Variant A — provenance inline. Every claim carries its source in the body.
export function renderInline(pack) {
  const L = [];
  L.push(`SUBMISSION PACK — ${pack.role_title}`);
  L.push(`Candidate ${pack.candidate_ref}`);
  L.push("");
  L.push(wrap(pack.headline));
  L.push("");
  L.push("AGAINST THE BRIEF");
  for (const c of pack.evidence) {
    L.push("");
    L.push(wrap(`• ${c.requirement}`));
    L.push(wrap(`  ${c.text}${mark(c)}`));
    if (c.source_type !== "unverified") L.push(wrap(`  Source: "${quote(c.source_quote)}"`, 74));
  }
  L.push("");
  L.push("WHAT WE KNOW ABOUT YOUR PROCESS");
  for (const c of pack.process_fit) {
    L.push("");
    L.push(wrap(`• ${c.text}${mark(c)}`));
    if (c.source_type !== "unverified") L.push(wrap(`  Source: "${quote(c.source_quote)}"`, 74));
  }
  if (pack.gaps.length) {
    L.push("");
    L.push("WHERE THEY DON'T MEET THE BRIEF");
    for (const c of pack.gaps) L.push(wrap(`• ${c.text}${mark(c)}`));
  }
  return L.join("\n") + "\n";
}

// Variant B — provenance in an appendix. Body reads as prose; sources are numbered.
export function renderAppendix(pack) {
  const L = [];
  const sources = [];
  const cite = (c) => {
    if (c.source_type === "unverified") return " [UNVERIFIED]";
    sources.push(c);
    return ` [${sources.length}]`;
  };

  L.push(`SUBMISSION PACK — ${pack.role_title}`);
  L.push(`Candidate ${pack.candidate_ref}`);
  L.push("");
  L.push(wrap(pack.headline));
  L.push("");
  L.push("AGAINST THE BRIEF");
  L.push("");
  for (const c of pack.evidence) L.push(wrap(`• ${c.requirement}: ${c.text}${cite(c)}`));
  L.push("");
  L.push("WHAT WE KNOW ABOUT YOUR PROCESS");
  L.push("");
  for (const c of pack.process_fit) L.push(wrap(`• ${c.text}${cite(c)}`));
  if (pack.gaps.length) {
    L.push("");
    L.push("WHERE THEY DON'T MEET THE BRIEF");
    L.push("");
    for (const c of pack.gaps) L.push(wrap(`• ${c.text}${cite(c)}`));
  }
  if (pack.open_questions.length) {
    L.push("");
    L.push("FOR THE RECRUITER TO CONFIRM BEFORE SENDING");
    L.push("");
    for (const q of pack.open_questions) L.push(wrap(`• ${q}`));
  }
  L.push("");
  L.push("—".repeat(40));
  L.push("SOURCES");
  L.push("");
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

export function renderFailures(failures, pack) {
  if (!failures.length) {
    return `Provenance check: PASS — all ${allClaims(pack).length} claims verified or self-declared unverified.\n`;
  }
  const L = [`Provenance check: ${failures.length} claim(s) demoted to UNVERIFIED.`, ""];
  for (const f of failures) {
    L.push(`  ${f.section}[${f.index}] claimed ${f.claimed_source} — ${f.reason}`);
    L.push(`    claim: ${f.text}`);
    L.push(`    quote: ${f.quote || "(empty)"}`);
    L.push("");
  }
  return L.join("\n");
}
