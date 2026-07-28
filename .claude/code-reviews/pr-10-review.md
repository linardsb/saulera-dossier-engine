## Review — PR #10 · deploy A: public shell, health function, test script (#3)

**Recommendation: APPROVE.** No critical or high issues. Validation is green on this branch, including on a
clean clone. The Function matches the `contact.js` pattern line for line, and the one hard constraint — the key
never reaching a browser — holds by construction.

Two Medium findings, both on `public/tokens.css` / `public/index.html`. Neither blocks this merge: on a
`noindex` placeholder behind Access their impact today is nil. They are worth fixing because **`tokens.css` is
the durable artifact #8 inherits**, and both are cheaper to correct now than after a recruiter-facing screen is
built on top of them.

Reviewed with fresh eyes — this session did not write the code. Note: the skill's `code-reviewer` agent has no
definition at either scope (`.claude/agents/` does not exist in this repo or in `~/.claude/`), so this is a
direct clean-context review rather than a delegated one.

Read against: `.claude/plans/deploy-skeleton.md`, `.claude/reports/deploy-skeleton-report.md` (both untracked,
read from disk), and `README.md`. There is no `CLAUDE.md` in this repo; the plan's **Patterns to Follow** and
the README's **Decisions** were used as the rubric.

---

### Validation

Run on `feature/deploy-skeleton-a` at `b13eb04`, after `gh pr checkout 10`.

| Check | Command | Result |
|---|---|---|
| Unit tests | `npm test` | **11/11**, `# fail 0` — no regression |
| Unit tests, clean clone | `git clone --branch feature/deploy-skeleton-a` → `npm test` | **11/11** — the new `test` script works with no `node_modules` |
| Syntax | `node --check` on `functions/api/health.js` + all 7 `src/` files | clean |
| `package.json` parses | `JSON.parse` | ok |
| Lint / type-check | — | none configured (deliberate; repo is dependency-free on this branch) |
| CI checks | `gh pr checks 10` | none reported on this branch |
| Plan Level 3 (live curl) | — | **not run** — needs the Pages project (Task 6), which is dashboard work |
| Plan Level 4 (authenticated) | — | **not run** — needs the Access door |

The clean-clone run is the one worth naming: `test/smoke.test.js` imports only `node:*` builtins and relative
paths into `src/`, so `"test": "node --test test/"` is genuinely dependency-free on this branch. The PR's 11/11
claim stands on a fresh checkout of `main`, not just on a tree that happens to have `node_modules/` lying
around from branch B.

---

### Issues

#### Medium — `--text-muted` is below WCAG AA and is used on live body copy

`public/tokens.css:15` · used at `public/index.html:44,73`

`--text-muted: #8c8c8c` on `--surface: #f5f5f5` computes to **3.08:1**; on `--background: #ffffff`, **3.36:1**.
AA for normal-size text is 4.5:1. `index.html:73` applies `.muted` to a 16px `<p>` inside the card, so this is
shipped, not hypothetical.

The rest of the palette, measured against both surfaces:

| Token | on `#ffffff` | on `#f5f5f5` | |
|---|---|---|---|
| `--text-primary` `#1d1d1d` | 16.86 | 15.46 | ok |
| `--border` `#595959` | 7.00 | 6.42 | ok |
| `--danger` `#78350f` | 9.07 | 8.32 | ok |
| `--text-muted` `#8c8c8c` | 3.36 | 3.08 | fails 4.5:1 text |
| `--accent` `#0099ff` | 3.00 | 2.75 | fails 4.5:1 text; **2.75 also fails 3:1 non-text** |
| `--warning` / `--unverified` `#c68a0b` | 2.98 | 2.74 | fails 3:1 |
| `--success` / `--verified` `#22c55e` | 2.28 | 2.09 | fails 3:1 |

Two knock-ons beyond the muted paragraph:

- `index.html:51-52` styles `a { color: var(--accent) }` and a `2px solid var(--accent)` focus ring. There are
  no anchors on the page yet, so nothing fails today — but as written, link text lands at 2.75:1 on the card
  and the focus indicator fails 1.4.11 Non-text Contrast (3:1).
- `--verified` / `--unverified` land at 2.09:1 and 2.74:1. `tokens.css:27-29` explicitly defers this
  (*"#8 makes them legible; #3 only reserves them"*), so it is a documented deferral, not an undocumented
  divergence — I am not counting it as a separate finding. It is worth noting anyway, because the plan's own
  NOTES make #8's job *"make verified vs unverified visible without reading"*, and a value that has to change
  before it can carry that meaning is a weak reservation.

**Why nothing caught it:** the plan's Task 1 validation asserts only *"every colour is a custom property, no
literal hex outside `:root`"*, and Level 4 step 3 checks *"no off-palette colour"*. Both are palette-provenance
checks. Contrast was never in any gate, at any level.

**Fix:** darkening `--text-muted` to roughly `#6b6b6b` clears 4.5:1 on both surfaces and stays inside the
neutral ramp. `--accent` is a stackai value and a bigger call — the usual resolution is to keep `#0099ff` for
large text and non-text fills, and define a separate darker token for link-sized text. Worth deciding at #8 with
the numbers above in hand rather than at the point of building the screen. All ratios are plain WCAG 2.x
relative luminance and reproduce in any contrast checker.

#### Medium — type sizes are not tokenised, contradicting the file's own header and the README decision

`public/tokens.css:1-3, 22-25` · `public/index.html:18, 36, 48`

`tokens.css` opens with: *"Every colour, **size**, radius and font in this deployment resolves through one of
these custom properties."* Its only consumer does not do that. `index.html` hardcodes three font sizes —
`font-size: 16px` (`:18`), `24px` (`:36`), `14px` (`:48`) — while `tokens.css` defines `--font-*` **families**
and no size scale at all.

This is the one place the PR diverges from a recorded repo decision without recording it. `README.md` →
Decisions → *"Visual base"* states: *"Every colour, **type** and radius value goes through CSS custom
properties from day one, so an agency's branding is a variable swap and never a fork."* As it stands, an agency
that wants a different type scale has to edit `index.html` — a fork of the markup, which is precisely the
property the decision exists to prevent. Colour, spacing and radius all hold this property correctly; type is
the gap.

Same root cause as above: Task 1's validation was colour-scoped (`no literal hex outside :root`), so it passed
while the type half went unchecked.

Two sub-points, folded in here rather than raised separately:

- `code { font-size: 14px }` (`:48`) breaks the plan's own **"4px grid — every dimension is a multiple of 4"**
  rule. `--radius: 9px` and the `2px` focus outline are both explicitly spec'd, so 14px is the only real
  violation.
- `body { font-size: 16px }` in px overrides a user's browser font-size preference. Zoom still works, so this
  is not a 1.4.4 failure, but a `rem`-based or token-based scale would respect it.

**Fix:** add a small size scale to `:root` — e.g. `--text-sm: 14px; --text-base: 16px; --text-lg: 24px` (or
their `rem` equivalents) — and reference them from `index.html`. Roughly six lines, and it makes #8's inherited
contract match what `tokens.css` already claims. Alternatively, narrow the header comment and the README line
to say *colour, spacing and radius*, and leave type to #8 — but then it should be recorded as a deferral the
way the provenance tokens were.

#### Low — `--font-ui: "Aspekta 500"` bakes a weight into a family name

`public/tokens.css:23`

Harmless today: no `.woff2` exists, so it falls through to `system-ui`. It becomes a quiet debugging problem at
#8, when an `@font-face` block declaring `font-family: "Aspekta"` will not match a `font-family` request for
`"Aspekta 500"`, and the page will silently keep rendering in `system-ui`. The working form is
`font-family: "Aspekta"` plus `font-weight: 500`. One line now.

---

### What's good

- **`functions/api/health.js` mirrors `contact.js` exactly**, including the parts that are easy to drop: the
  leading comment block naming the route, the secret *and where to set it*; `not_configured` as the literal
  first statement; the module-local `json()` at the bottom with `Cache-Control: no-store`. The error vocabulary
  is reused rather than reinvented.
- **The key constraint holds by construction.** `key: true` is a literal, never a value, prefix or length, and
  there is no path through the handler that can return `env.ANTHROPIC_API_KEY`. The comment explains *why*
  rather than restating the code.
- **The parsed body is discarded and never logged** — `await request.json()` with no assignment. That is the
  "no candidate data store" constraint honoured in the first Function written, at the point where it is easiest
  to be careless.
- **The `405`→`404` correction is real work.** The plan predicted a 405 method guard; the author checked
  empirically against a production Function of identical shape, found 404, and recorded it in AMENDMENTS
  *without* changing code to chase the wrong prediction. Same for the Task 3 grep going stale after Task 12 —
  the file was left correct and the assertion was widened. Both are documented deviations and neither is
  treated as a finding here.
- **The A/B split is the right call** and the report explains why the plan's push-to-`main` would have lost it.
  Deploy A carries zero dependencies, so a red Pages build after merging this can only be configuration.
- **The report is honest about what was not run** — Levels 3 and 4 are marked NOT RUN with the reason, rather
  than quietly implied. That is what made this review's validation table quick to write.

### Out of scope — not counted against this PR

Read on branch A, not branch B. All of the following are absent here **by explicit plan decision** and land in
PR B or a later ticket: `wrangler.toml` / `nodejs_compat` / `compatibility_date` and the committed lockfile
(Phase 4 / Task 12); the README **Status** update and **Engine and config** section (Task 14); `DEPLOY.md`
(Task 15); `_headers` (Open Question 5); web fonts (Open Question 2).

---

### Recommendation

**Approve and merge**, then do the Cloudflare dashboard work (plan Tasks 6–11) before merging PR B — the
isolation this split buys only pays off in that order.

The two Medium findings are `tokens.css` polish and can be taken either as a follow-up commit on this branch or
folded into #8. If they go to #8, the numbers above belong in the ticket, because the reason they exist is that
no validation level ever checked contrast or type tokenisation.

*Posting as a comment rather than a formal approval: GitHub rejects `--approve` on your own PR (author and
reviewer are both `linardsb`). The verdict above is the review.*
