# Implementation Report — Redesign the Submission pack flow, acts 1, 2 and 4 (#59)

**Plan**: `.claude/plans/redesign-pack-flow-acts-1-2-4.md`
**Branch**: `feature/redesign-pack-flow` (off `origin/main` @ `b4d89b3`)
**Worktree**: `/Users/Berzins/Desktop/saulera-worktrees/redesign-pack-flow` (linked — see Issues)
**Status**: **PARTIAL** — every task implemented and every automated gate green; the
**visual/browser passes could not be run** (no browser automation in this session). Details below.

## Summary

The build-a-pack journey is re-laid-out on the epic's decided direction. Two additive tokens
(`--text-display: 35px`, `--space-16: 64px`) join the ramp and the 4px grid; the page title takes
the ramp's top step; the four acts stop being 12px uppercase muted labels and become `--text-h3`
sentence-case headings beside a 24px numeral chip; the steps map stops being a wrapping inline row
and becomes a four-column band; and acts 1, 2 and 4 get their internal hierarchy fixed. The act
entrance gains an 8px rise inside the existing reduced-motion guard. `--radius` is decided at 9px,
closing #58's open question 5.

`public/app.js` is not touched — not one line. Both markup edits only wrap existing elements, so
every id resolves and DOM order (and therefore tab order) is unchanged. Act 3's internals are
#60's and were not touched; it inherits the new act shell, which is intended.

## Tasks completed

| # | Task | File | Action |
|---|---|---|---|
| 1 | `--text-display: 35px`, `--space-16: 64px`, `--radius` decision recorded | `public/tokens.css` | UPDATE |
| 2 | `h1` takes `--text-display` + `-0.02em` optical tracking | `public/app.css` | UPDATE |
| 3 | `.page-head` → `--space-16`; `.workspace` gutter → `--space-12` at ≥860px | `public/app.css` | UPDATE |
| 4 | `.act-head` becomes a section heading; the `.rail-head` pairing split and the reversal recorded | `public/app.css` | UPDATE |
| 5 | `.act-num` 20px → 24px, `flex-shrink: 0` added, dead `letter-spacing: 0` removed | `public/app.css` | UPDATE |
| 6 | `.act + .act` → `--space-16`; `.steps` becomes a 4-column band; `.step-label` spans added | `public/app.css`, `public/index.html` | UPDATE |
| 7 | `.input-pair .field` promoted; `.input-pair` bottom margin; `.act-head-row .elapsed` → `--text-h3`; generating note → `--text-note` | `public/app.css` | UPDATE |
| 8 | Act 4's date + email paired into `.field-pair` / `.field-col`, replacing the 32ch id cap; `.send-preview` → `--space-16` | `public/index.html`, `public/app.css` | UPDATE |
| 9 | `.act.is-entering` gains `translateY(--space-2)`; `transform` added to the transition inside the guard | `public/app.css` | UPDATE |
| 10 | Phone counterparts: `.act + .act`, `.send-preview`, `h1` step-downs | `public/app.css` | UPDATE |
| 11 | Decisions log entry (2 Aug 2026, #59) | `README.md` | UPDATE |

Committed as two commits, deliberately: `077312c` is the shared-chrome half (tokens + `h1` +
`.page-head` + `.workspace`) so it stays **one revert** if the owner wants it scoped back to `/`,
which is what the plan's Phase 2 rationale asked for. `f1720ab` is the act work.

## Tests added

**None** — as the plan specifies, and deliberately. The three invariants a layout change could
break are already gated by tests #58 built for this ticket to run against:
`test/chrome.test.js` (transitions must sit inside the `no-preference` block; no raw hex),
`test/tokens.test.js` (the palette is measurable), `test/counts.test.js:119-131` (the three-link
nav on `index.html`), and the two cross-file selector-clash tripwires.

**The motion gate was proven to bite** rather than assumed: planting `.act { transition: all 1s; }`
outside the guard made `test/chrome.test.js` fail (4 pass / 1 fail); removing it restored 5/5.

## Validation results

| Level | Check | Result |
|---|---|---|
| Baseline | Full suite before any edit | **825 pass / 0 fail / 0 skipped** (Node 24.11.0) |
| 1 | `grep -c "transition:" app.css` | 6 — unchanged |
| 1 | Distinct breakpoint values | 3 (`600`, `859`, `860`) — no fourth introduced |
| 1 | `font-weight: 500` in `app.css` | 0 — Geist has no 500 face |
| 1 | `var(--text-display)` uses in `app.css` | 1 (the `h1` rule) |
| 1 | `step-label` / `class="act-num"` in `index.html` | 4 / 8 |
| 1 | `git diff --stat public/app.js` | **empty — untouched** |
| 1 | 40-id sweep from `app.js:237-281` | no `MISSING` lines |
| 1 | CSS brace balance | balanced (185/185) |
| 2 | `chrome.test.js` + `tokens.test.js` + `counts.test.js` | green |
| 3 | `prep-registry.test.js` + `prep-session-ui.test.js` (clash tripwires) | 88/88 green |
| 3 | **Full suite after every task** | **825 / 0 / 0** — never moved |
| 4 | Route statuses on the dev server | `/`, `/clients`, `/counts`, `/prep/`, `/prep/login`, `/prep/privacy` → 200; `/nope` → **404** |
| 4 | `404.html` leaks nothing | 0 nav links, 0 mentions of the product name |
| 4 | ARIA structure | 4 `aria-labelledby` targets, 6 `role="status"`, `aria-label="How this works"` — all intact |

## Deviations from the plan

1. **The baseline is 825/0/0, not the plan's 802/0/0.** The plan was written at `64f551e`;
   `origin/main` has since gained #56's locum-portal work (`b4d89b3`), which added 23 tests. The
   four files this ticket edits are **byte-identical** between the two commits, so nothing else
   about the plan is affected. 825 is the number that held before and after every task.

2. **The `@media` count is 8, not the plan's stated 6.** This is the plan's own arithmetic being
   stale, not a stray block: Tasks 6 and 8 each *add* a `min-width: 860px` block (for `.steps` and
   `.field-pair`), which the plan specifies but forgot to count. The constraint that matters —
   "do not introduce a third/fourth breakpoint **value**" — holds: still exactly `600`, `859`,
   `860`.

3. **Task 6's justification for the `.step-label` span was corrected.** The plan claims a newline
   between the two spans "becomes an anonymous flex item and adds an unwanted third track". That
   is false — per Flexbox §4, an anonymous flex item containing only whitespace is *not rendered*.
   The spans are still written adjacent (it costs nothing), but the comment in the file carries the
   plan's **other**, sound reason: a bare text node becomes an anonymous flex item that cannot be
   selected, so it can carry no `min-width: 0` and no later rule can reach it.

4. **Work was moved to a linked worktree mid-implementation.** See Issues.

5. **`.act-head`'s type declarations restate what the base `h2` rule already sets.** Kept
   (the plan specifies them, and `.rail-head` restates its own the same way), but the comment says
   explicitly that they restate rather than implying they do work.

## Issues encountered

**The shared worktree changed branches underneath this session.** Repo memory warned about exactly
this. Partway through — with Tasks 1–3 edited but uncommitted — a parallel session (#62, the portal
shell) checked out `feature/candidate-portal-shell-redesign` in
`/Users/Berzins/Desktop/saulera-dossier-engine` and began editing `public/prep/*`. My staged files
were briefly sitting on **their** branch.

Nothing was lost and nothing of theirs was disturbed. The work was moved to a linked worktree at
`/Users/Berzins/Desktop/saulera-worktrees/redesign-pack-flow` (both branches sat on `b4d89b3` and
the four files were identical on both, so the transplant was clean), and the shared worktree was
restored so the parallel session sees only its own changes. **No commit was ever made on their
branch.** `npm install` was needed in the fresh worktree (`@anthropic-ai/sdk` is a real dependency);
the `package-lock.json` it touched was restored rather than committed.

**Port 8788 was already taken** by the parallel session's dev server, so this build was served on
**:8790** via `wrangler pages dev --port 8790` (the D1 migration from `scripts/dev.py` had already
run successfully). Verified the server serves *this* worktree's build before trusting any result.

## What could NOT be validated — the visual pass

There is no browser automation in this session, so **Level 4's visual half and the reduced-motion,
360/390px and keyboard passes were not run.** These need a human at `http://localhost:8790` (the
server is still up):

- [ ] The 35px title over the four-column steps band; does it read as considered?
- [ ] **The two act head rows.** `.act-head` is a flex container, so its baseline comes from its
      first flex item — the `.act-num` chip — not from the heading text. `.act-head-row` aligns on
      `baseline`, so **act 2's 20px clock and act 3's 14px `.pack-summary` beside a 20px heading
      are the two things to look at.** Structurally correct; whether it *looks* right is a judgment.
- [ ] Act 3 under the new shell before #60 runs — deliberate, or half-migrated?
- [ ] Both generate routes at the new sizes (API `is-generating` mode and the Claude-tab mode).
- [ ] Reduce motion ON → acts appear instantly, fully opaque, **not offset 8px**.
- [ ] 390px and 360px on `/`, `/clients`, `/counts` — no horizontal scroll; `h1` stepped to 29px.
- [ ] Keyboard: focus ring size on the two file inputs and the two newly-paired fields.
- [ ] `/prep/`, `/prep/login`, `/prep/privacy` inherit the 35px `h1` (#62's to tune).
      `/prep/brief` and the session pages are **verified unaffected in source**: the new `h1` rule
      adds `letter-spacing: -0.02em` as well as the size, and `prep.css:38-42` overrides *both* —
      `font-size: var(--text-h1)` **and** `letter-spacing: -0.02em`, the identical value. So the
      role titles change in neither size nor tracking. (Worth confirming by eye anyway, but the
      cascade is settled: this was the one property the plan's "prep.css overrides h1" claim did
      not name, and it happens to be covered.)

**Open question worth answering after that first look** (from the plan, un-litigated): is 35px
timid? The next 1.2 step is 42px, a one-token change whose only consequence is that Task 10's phone
step-down should go to `--text-h2` instead of `--text-h1`.

## Ready for the next step

Two commits are on `feature/redesign-pack-flow`. Next: the visual pass above, then
`piv-create-pr`. The PR body should name the shared-chrome blast radius (`/clients`, `/counts`,
`404.html`, three portal pages), state that `app.js` was not touched, and warn the second merger of
#59/#61 to expect a trivial both-sides-keep conflict in the `max-width: 859px` and `no-preference`
blocks.
