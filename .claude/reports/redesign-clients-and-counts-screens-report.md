# Implementation Report — Redesign Client knowledge and Prep sent screens (#61)

**Plan**: `.claude/plans/redesign-clients-and-counts-screens.md`
**Branch**: `feature/redesign-clients-and-counts-screens` (worktree at `../saulera-worktrees/redesign-clients-and-counts`, branched from `origin/main` = `b4d89b3`, which carries #58)
**Status**: COMPLETE

## Summary

`/clients` becomes a document column: the note box takes its height from the viewport instead of
from `rows="16"`, the save row sticks to the bottom of the viewport on desktop so Save and its
live region stay in view while you write, and the two readouts that describe the *saved* note
move into one named `.note-facts` zone under a single hairline with eyebrow legends. The locum
checklist gets the layout it has never had — #48 shipped it with no CSS at all. `/counts` puts
its body numerals in DM Mono, quiets the zeros, and gives the rows air. One shared-chrome bug is
fixed on the way through: `.topbar-nav` now wraps, which removes the horizontal page scroll at
360px on all three screens and takes the browser probe from 16/18 to 18/18.

No behaviour in `clients.js`'s async layer changed, no element id moved, and no visible string on
either screen changed.

## Tasks completed

| # | Task | File | Action |
|---|---|---|---|
| 1 | The id contract gate, written first | `test/screens.test.js` | CREATE |
| 2 | `.topbar-nav { flex-wrap: wrap }` | `public/app.css` | UPDATE |
| 3 | `--note-height`, `--sticky-save` | `public/tokens.css` | UPDATE |
| 4 | `.note-facts` wrapper, two `zone-head` legends | `public/clients.html` | UPDATE |
| 5 | Note height, sticky save row, zone + eyebrow rules | `public/app.css` | UPDATE |
| 6 | Row separators for both readouts, the locum grid | `public/app.css` | UPDATE |
| 7 | `renderLocum` child order, `locum-detail` class | `public/clients.js` | UPDATE |
| 8 | `is-zero` on a zero cell | `public/counts.js` | UPDATE |
| 9 | Mono body numerals, muted zeros, row air, nowrap | `public/app.css` | UPDATE |
| 10 | Copy pass on every changed string | — | no change needed (see below) |
| 11 | Full validation and the browser pass | — | this report |

Five commits, with the shared-chrome line kept separate so it can be dropped in a rebase if #59
lands the same fix first:

```
cff8854 fix: drop the editor measure that measured nothing
ba715b5 feat: the prep-sent numbers become the subject (#61)
2fa5af5 feat: the client note reads as a document, not a form (#61)
1cda572 fix: the topbar nav wraps, so no screen scrolls sideways at 360px
12a28e3 test: the id contract between each recruiter screen and its script
```

## Tests added

`test/screens.test.js` — two tests, one per screen: every `document.getElementById("x")` in the
script has a matching `id="x"` in the page it drives. Source scan, no DOM, no dependency, same
idiom as `test/chrome.test.js`. Ids are matched with both quote characters so `id="locum"` cannot
be satisfied by `id="locum-list"`.

Written before any markup moved and confirmed to pass against the unmodified markup. Also
confirmed to **fail** correctly: renaming `id="locum-list"` in `clients.html` produced

```
public/clients.html is missing id="locum-list" — public/clients.js resolves each of these to
null and fails silently, so put the id back on whichever element now does that job rather than
removing the query
```

## Validation results

All commands on Node **v24.11.0** (the ambient shell is 20.20.2, where the suite reports a false
pass with ~160 skips).

| Gate | Result |
|---|---|
| `$NODE --test test/*.test.js` | **827 pass, 0 fail, 0 skipped** (baseline on `origin/main` was 825; +2 is `screens.test.js`) |
| `$NODE .claude/probes/clients-screen.mjs` | **18/18** (baseline 16/18; H6 and V18t were both failing on the nav overflow) |
| `test/chrome.test.js` | green — no raw hex, no transition outside the motion guard |
| `test/tokens.test.js` | green, unchanged — neither new token is a colour |
| `test/counts.test.js` | green — frozen prose, endpoints, sinks, nav, locum scaffold all intact |
| Em/en dash in visible copy | none on either screen (comments stripped first) |
| Banned-word scan on new `counts.js` code and comments | no violations |
| `grep -c 'class="field"' public/clients.html` | 4 (was 6) — the two legends are now `zone-head` |
| `grep -c 'id="' public/clients.html` | 26, unchanged |

### Measured in the browser, not asserted

The plan's ACs are geometry, and the suite has no DOM, so these were measured over CDP in real
Chrome and confirmed in real Safari rather than eyeballed.

**AC #2 — the note editor at real note lengths** (4,073-character note):

| Window | Note box | Save + state visible without scrolling | Save row |
|---|---|---|---|
| 1440×1000 | **520px** (was ~400) | yes | `sticky`, 69px |
| 1280×700 | **402px** — the `clamp()` floor, exactly what `rows="16"` renders | yes | `sticky`, 69px |
| 390×844 | 439px | n/a | `static` — correctly below the 860px breakpoint, `scroll-padding-bottom: auto` |

The sticky row released at the end of the editor and never overlapped the delete button
(`coversDelete: false`) at every size, and focusing every control in `#editor-body` in turn put
**none** of them under the row (`focusUnderRow: []`). `--sticky-save: 72px` was checked against
the row's real rendered height of 69px, so the token's arithmetic holds.

**The locum rows** — nothing in the probe suite covers them, so they were measured directly at
1440 and 360 with two of the five headings present:

- every row ≥44px (minimum 59px)
- heading and status on one line, status right-aligned to the row edge at both widths
- hint on its own row below, left-aligned
- the "Add ## …" button on its own line at its natural width (241–293px), 44px tall — not a
  full-width bar
- `documentElement.scrollWidth` = 360 at a 360px viewport

**`/counts`** — computed styles read back from the rendered table: header cells Geist **600**
(no synthetic bold against single-weight DM Mono), body number cells **DM Mono 400**, zeros at
`--text-muted` `rgb(92,103,100)` and real numbers at `--text-primary` `rgb(46,51,50)`, body cell
padding 16px.

**`/` is unchanged except the nav** — the strongest form of that AC: `/` was rendered from
`origin/main`'s `public/` and from this branch's, and every element's bounding box compared.

- at **1440px: 0 geometry diffs** across all 114 elements
- at **360px**: `documentElement.scrollWidth` 375 → 360, and of 56 diffs, 49 are a pure +52px
  vertical shift (the nav's second line) and the other 7 are the topbar, its inner, the nav and
  its four links — i.e. the wrap itself. Nothing else on `/` moved.

**Real Safari** (CHECKLIST's "MUST: eyeball every new layout in real Safari AND real Chrome") —
the page was made to report its own computed values on screen, since `osascript` has no
Accessibility permission on this machine to drive scrolling:

```
innerHeight 748  innerWidth 1300
note        330..732 (h402)  minH=400px
save-row    519..588 (h69)   position=sticky
scrollPadBot 72px
-- after scrolling to the zone --
save-row    -117..-48 (h69)      <- released, scrolled off above
delete-button 835..879 (h44)
row covers delete: false
```

Screenshots confirmed both eyebrow heads render as uppercase tracked captions rather than field
labels, the `.note-facts` hairline, the row separators, the locum grid, and on `/counts` the
sans-bold headers with mono body digits and visibly quieter zeros.

## Deviations from the plan

**1. `.editor { max-width: 75ch }` was implemented, then removed.** This is the one substantive
deviation and it is a correction to the plan, verified in both engines.

The plan (task 5) asserted the editor column is "712px, which at `--text-note` is about 89
characters — past CRAFT.md's 65-75ch ceiling. 75ch lands at about 656px here." Measured, `1ch` on
that column is **10.59px** (Geist at 16px), so:

- `75ch` = **795px** — above a column that can never exceed 712px, so the rule was **inert**
- the column is **67.2ch**, already inside CRAFT's 65–75ch measure
- even `68ch` (the value `.pack` uses for the same 16px reading measure) is 720px, also inert here

`.pack` needs its `68ch` because it is full-width under `--max-width`; the editor column is held
by the grid instead. Shipping a no-op whose comment states a wrong measurement is the opposite of
this file's discipline, so the rule is gone and the comment now records the arithmetic and why
the column needs no `max-width` — so nobody adds one back. The plan's design intent (the note,
the readouts and the delete action sharing one edge) was already true: they are all in the same
grid column.

**2. Task 10 changed no strings.** The plan predicted this ("expect this task to change few or no
strings"). Confirmed mechanically: with comments stripped and whitespace collapsed, the visible
copy of both `clients.html` and `counts.html` is byte-identical to `origin/main`, and no `COPY`
string in either script changed.

**3. `clients.html`'s wrapped block was re-indented one level.** Adding `<div class="note-facts">`
around the two fieldsets left 20 lines at the same indent as their new parent. `clients.html` is
not a contested file (#59 owns `index.html`, #62 owns `prep/*`), so the nesting was corrected.
This is why `clients.html`'s diff is larger than the three edits the plan describes.

**4. Commit shape.** Tasks 6 (CSS) and 7 (JS) are in one commit as the plan requires — an earlier
split that would have committed the CSS without the JS was amended away before anything was
pushed.

**5. The plan's baseline counts were stale.** The suite on `origin/main` is **825**, not the 802
the plan states; the target is therefore 827, not "802 + new". The probe baseline of 16/18 was
exactly as the plan measured.

## Issues encountered

**The session started in the wrong worktree.** The primary checkout was on
`feature/candidate-portal-shell-redesign` (#62) with another session actively editing it — staged
`app.css` and `tokens.css` changes disappeared between two consecutive commands. #61 was moved to
its own linked worktree branched from `origin/main` before any work began. The untracked plan file
and the probes were copied across.

Note that local `main` is 7 commits behind `origin/main` and does **not** contain #58; branching
from it would have produced a tree with no palette, no motion guard and no type ramp.

**`osascript` cannot send keystrokes or run JavaScript in Safari** on this machine (no
Accessibility permission, and "Allow JavaScript from Apple Events" is off). Worked around by
serving a variant of `clients.html` with an overlay that reports its own computed geometry on
screen, which is what the Safari numbers above come from.

**Not done: the `npm run dev` / wrangler pass.** Every route was exercised against a stub API
instead, in both engines, which reaches the same markup and CSS. Nothing in this ticket touches a
server file, an endpoint or a migration, so a live D1 adds no coverage the stub lacks — but if you
want the dev-server walk-through before merging, it is the one Level 4 line not run as written.

**Reduced motion** was not toggled by hand. It is covered more strictly by
`test/chrome.test.js`: this ticket declares no `transition`, `animation` or `@keyframes` anywhere,
and that gate fails the build if one exists outside the `prefers-reduced-motion: no-preference`
block. The count is still 6, all inside the guard.

## Ready for the next step

Working tree is clean, all validations pass. Next: `piv-create-pr`, then `piv-review-pr`.

The PR body should say out loud that this ticket touches **one** shared rule above `app.css:264` —
`.topbar-nav { flex-wrap: wrap }`, in its own commit — because #59 and #62 are working the same
file in parallel.
