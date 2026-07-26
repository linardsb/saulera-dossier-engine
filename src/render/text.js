// Shared text helpers for the renderers.

export const WIDTH = 78;

export function wrap(s, width = WIDTH) {
  const out = [];
  for (const para of String(s ?? "").split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      if (!word) continue;
      if (line && (line + " " + word).length > width) {
        out.push(line);
        line = word;
      } else {
        line = line ? line + " " + word : word;
      }
    }
    out.push(line);
  }
  return out.join("\n");
}

export const UNVERIFIED = " [UNVERIFIED]";

export const mark = (c) => (c.source_type === "unverified" ? UNVERIFIED : "");

/**
 * Quotes are stored VERBATIM so the provenance check can match them, which means they
 * carry the source document's own line breaks. Collapse those for display only — never
 * for the value the verifier reads. Getting this backwards silently breaks the check.
 */
export const quote = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

export const escapeHtml = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
