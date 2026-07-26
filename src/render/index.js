// Rendering is the dumb half of architecture §5.5: canonical pack in, sendable text out.
// Adding a target is an implementation here, never a change to generation.
//
// Both renderings were approved on 26 July 2026 (spike #2). Appendix is the default —
// one copy action, not a menu. Which one an agency gets is Agency config, not a decision
// the recruiter makes per pack.

import { renderAppendix } from "./appendix.js";
import { renderInline } from "./inline.js";

export const RENDERERS = {
  appendix: {
    id: "appendix",
    label: "Sources in an appendix",
    description: "Body reads as prose; numbered citations resolve to a footer. Default.",
    render: renderAppendix,
  },
  inline: {
    id: "inline",
    label: "Sources inline",
    description: "Source quote under each claim, for a client who wants it in the body.",
    render: renderInline,
  },
};

export const DEFAULT_RENDERER = "appendix";

export function render(pack, rendererId = DEFAULT_RENDERER) {
  const renderer = RENDERERS[rendererId] ?? RENDERERS[DEFAULT_RENDERER];
  return renderer.render(pack);
}

export { renderAppendix, renderInline };
