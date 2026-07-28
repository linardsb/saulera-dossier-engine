# Implementation Report — least-friction-loop

**Plan**: `.claude/plans/least-friction-loop.md`   **Branch**: `feature/ux-ui-uplift`   **Status**: COMPLETE

## Summary

Every removable click and paste around the unavoidable Claude round trip is gone. A sole client
selects itself on load (replaceState, no history entry). Picking a client puts the caret in the
brief box. A CV or brief file can be dropped straight on its column and goes through the same
extractor as the picker, same honest failures. And the return path is now one paste: during the
wait, ⌘V anywhere on the page fills the reply and, when the text carries a pack (`"role_title"`,
a required field, quoted in any real reply), runs the check itself — context-menu paste fires
the same event, so mouse-only recruiters get the same path. The server stays the only judge of
what a pack is; the frontend just presses the button.

## Tasks completed

- Auto-select the only client → `public/app.js` (`adoptOnlyClient`, called from `refreshList`) (UPDATE)
- Focus the brief on a click-selection → `public/app.js` (`select`) (UPDATE)
- Drag-and-drop files → `public/app.js` (`readFileInto` split into wrapper + `readFile`; new
  `wireDrop` on both `.input-col`s) (UPDATE)
- Paste-anywhere during the wait → `public/app.js` (document `paste` listener; delegates to
  `readPack()`, inheriting busy/frozen/one-event guards) (UPDATE)
- Copy updates → `public/index.html` (act-2 note, both file labels), `public/app.js`
  (`COPY.promptCopied`, `COPY.promptCopiedNoTab`) (UPDATE)
- Drag-over state → `public/app.css` (`.input-col.is-dragover .textarea`, tokens only) (UPDATE)
- Probes 11–14 → `.claude/probes/one-screen.mjs` (UPDATE)

## Tests added

`.claude/probes/one-screen.mjs`: probe 11 (sole client auto-selected, selection real enough to
copy a prompt, no confirm), probe 12 (one paste fills the reply, fires exactly one `/api/verify`
carrying the FROZEN cv, renders the pack), probe 13 (a non-pack paste fills the box and fires
nothing), probe 14 (a dropped file lands in the textarea via the extractor; dragover claimed,
state cleared). No unit tests added — `app.js` is a browser IIFE tested by probes by repo
convention; no `src/` or `functions/` code changed.

## Validation results

- Level 1: no raw hex in `app.css`, no `transition: all`, no em dashes in `index.html`, no
  storage APIs and no HTML-parsing assignment in `app.js` — all clean
- Level 2: `npm test` — 223/223 pass
- Level 3: one-screen probes 14/14 (probes 1–10 unmodified and green); clients-screen 11/11
- CHECKLIST.md: the one new colour use is `--accent` as a drag-over border (≥3:1 decorative,
  paired with "drop one on the box" in the file label — never colour alone); no new motion; no
  storage; new copy is plain en-GB, active voice, no em dashes

## Deviations from the plan

1. Probe 12 pastes a bare JSON object rather than a fenced block — avoids backtick escaping
   inside the probe's template literal; `src/paste.js` attempt 1 (trimmed parse) covers the
   bare shape, and the sniff key is identical either way.
2. No ids added to the input columns — `el.brief.closest(".input-col")` reaches them without
   touching the HTML structure (plan offered both options).
3. Probes run with `~/.nvm/versions/node/v24.11.0/bin/node` — the default `node` on PATH is
   v20, below the probe file's documented Node ≥ 22 floor (global WebSocket).

## Issues encountered

Safari could not be eyeballed from this session (same standing caveat as the ux-ui-uplift
pass). Risk is low: no new layout, one token-only state rule; the drag/paste APIs used are
baseline across this deployment's engines. The full manual loop against a real Claude session
(plan Level 4 step 3) remains a thing the user does once on the dev server.
