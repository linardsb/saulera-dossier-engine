# Code review — PR #14, "feat: the generation seam and the one screen (#6 as amended, #8)"

**Recommendation: request changes.** Not for the reason the PR body gives.

## Summary

The production code is in good shape. The two seam Functions, the one screen, the extractor and
the token fix all hold up against the README's Decisions and Standing constraints, and I could
not find a correctness, security or provenance defect in them.

The blocker is the **test gate**, and the headline finding is an inversion of the PR's own
disclosure:

> **The wrong-client clipboard bug described in the PR body does not exist. The stale-write
> guard in `app.js:520-533` works exactly as documented. Probe 1 is defective — it stopped
> exercising the race it asserts, and it is red at head for that reason.**

That matters beyond bookkeeping: the PR body directs the human reviewer to investigate a
wrong-client-data failure mode "before merge". That is the gate this review exists to serve, and
it is currently pointed at a phantom.

---

## Issues

### High — 1. Probe 1 no longer exercises the race it asserts, and the gate is red at head

`.claude/probes/one-screen.mjs` exits 1 (9/10). Three consecutive runs at head, all 9/10 with
probe 1 failing, so the PR's "not flaky" characterisation is correct. The diagnosis is not.

**What actually happens.** I instrumented `mine()`, `select()` and `load()` against a scratch
copy of `public/app.js`, and traced the real `ClipboardItem` value:

```
- ClipboardItem constructed
- clipboard.write() called
- mine()=true  stateReqId=3 reqId=3 selected=1111 clientId=1111
- item value RESOLVED, size=16
- getType RESOLVED
- mine()=true  stateReqId=3 reqId=3 selected=1111 clientId=1111
- select(2222) phase=waiting busy=false     <-- the switch happens HERE, after the fact
- load(2222)
```

`mine()` returned **true**, correctly — the switch to client B had not happened yet. `phase=waiting`
proves the app had already completed the copy for client A and entered act 2. The switch then
ran `load(B)` → `resetToInputs()`, which is what clears `#elapsed`, unfreezes the brief and hides
act 2. The probe reads that reset state and reports it as a stale write.

**Root cause.** `copyPrompt()` calls `window.open("https://claude.ai/new", ...)` synchronously
inside the click handler (`public/app.js:501`, added in `2d53882` — the same commit as the probe).
In headless Chrome that popup does DNS + TLS to `claude.ai` inside the click, which stalls the
CDP `Runtime.evaluate` round trip for `CLICK("copy-prompt")`. Measured:

| `window.open` | `await page.eval(CLICK("copy-prompt"))` returns after |
|---|---|
| real (head) | **544 ms** |
| stubbed to `return null` | **1 ms** |

The probe's `/api/prompt` route delay is **500 ms**. So `SETTLE(60)` and `CLICK_ROW(B)` are issued
~544 ms after the click — *after* the response has already landed. The intended race window is
`routeDelay − clickEvalRoundTrip`, and that round trip depends on an external network fetch, so
the window is an accident that can land either side of zero. That is why the implementation
report recorded 10/10 and head gives 9/10 on identical code: network latency, not a regression.

**The guard is correct.** Two independent confirmations:

1. **Against real Chrome, in isolation** — `new ClipboardItem({"text/plain": p})` where `p`
   rejects: `getType()` **rejects**, both when asked before and after the rejection lands
   (control with a resolving promise resolves normally). So the PR body's claim that "a rejected
   promise-valued `ClipboardItem` does not withdraw an in-flight write" is not what Chrome does.
2. **With the race actually exercised** — scheduling the switch from inside the page so it fires
   at +60 ms of real page time, everything behaves as `app.js:520-531` documents, and probe 1
   passes unmodified:

```
- clipboard.write() called
- select(2222) phase=inputs busy=true
- load(2222)
- mine()=false stateReqId=4 reqId=3 selected=2222 clientId=1111
- item value REJECTED: stale
- getType REJECTED: stale
PASS  1  ... clipboard writes=0 []
```

**Fix — (a) is the one I'd take:**

- **(a) Fire the switch from inside the page**, so it cannot be delayed by the CDP round trip.
  Replace probe 1's `SETTLE(60)` + `CLICK_ROW(B)` with a switch scheduled *before* the click:
  ```js
  await page.eval(`(function(){ setTimeout(function(){
      document.querySelector('.client-row[data-id="${B}"]').click();
    }, 60); return true; })()`);
  await page.eval(CLICK("copy-prompt"));
  await page.eval(SETTLE(1200));
  ```
  **Verified: this change alone takes the full suite to 10/10 against unmodified `public/`.** It
  is probe-local — no other probe's timing moves.
- **(b)** Stub `window.open` in `harness()` (`window.open = function () { return null; };`).
  Simpler, but I only verified it for probe 1 in isolation, and it puts every probe on the
  `promptCopiedNoTab` path — every other probe also calls `CLICK("copy-prompt")` and so also eats
  the 544 ms stall, so their timing shifts too. Check probe 8's wording before taking it.

**Worth doing beyond the fix:** the probe should assert its own precondition — that the switch
landed while the request was still in flight — so it fails loudly rather than silently ceasing
to test the race. That is the actual defect class here, and it would have caught this.

Probe 2's race is genuine (`read-pack` opens no window), so the defect is isolated to probe 1.

Context for severity, not an excuse: the probes are deliberately not part of `npm test`. But this
one covers the product's central safety property — the wrong client's knowledge note reaching the
clipboard — and it is the one gate that currently reports red.

### High — 2. The PR body and the implementation report assert a defect that does not exist

The "Not run — these need a human" section describes a wrong-client-data bug in confident,
specific terms and defers it to the reviewer. Following that instruction means auditing correct
code, and merging on the strength of it means shipping a probe that has quietly stopped testing
the thing it names.

The author's own instrumentation — "`window.location.search` is `?client=<B>` at t≈140 ms" — was
read through the same stalled CDP channel, so that "t≈140 ms" reading was actually taken after
the response had landed. Same root cause as the probe.

**Fix:** replace that bullet with the probe-timing defect, and correct report deviation 3, whose
"Probe 1 covers it" is true only once the probe is fixed.

### Low — 3. `.claude/reports/generation-seam-and-one-screen-report.md` is stale

Records 161 tests and 10/10 probes; head is 219 tests and 9/10. It predates the last two commits.
Its documented-deviations list is still accurate and was used as intended; only its validation
section is out of date.

---

## Validation

Run at branch head, `feature/generation-and-screen`:

| Gate | Result |
|---|---|
| `npm test` (Node v20.20.2) | **219/219 pass** |
| `npm test` (Node v24.11.0) | **219/219 pass** |
| `node .claude/probes/extract-docx.mjs` | **11/11 pass** |
| `node .claude/probes/one-screen.mjs` | **9/10 — probe 1 FAILS, exit 1** (3 consecutive runs) |
| same, with fix (a) applied to probe 1 | **10/10** — against unmodified `public/` |
| `npm run spike` | **PASS** — all 14 claims verified or self-declared |
| `npm run spike:tamper` | **PASS** — 1 claim demoted, as designed |
| type-check / lint | none in this project (zero runtime deps, no build step) — by design, not a gap |

Both Node versions confirmed independently, as the PR claims.

**Standing constraints, checked by reading rather than by grep** (the report notes the gates were
sharpened to avoid firing on comments, which is exactly the case for a fresh read):

- **No candidate data store** — clean. No `localStorage`/`sessionStorage`/`indexedDB`/`cookie` and
  no `console.` anywhere in `public/*.js`, `src/` or `functions/`. `INSERT INTO events` binds
  `(client_id, duration_ms)` only. The assembled prompt carries the note, and `/api/prompt`
  returns `{prompt, client:{id,name}}` with no second copy of it.
- **Nothing unsourced reaches a client** — `functions/api/verify.js` renders `verified.pack`, not
  the pasted pack, and `provenanceSummary` reads the verified pack too. Demoted claims are marked
  and kept. `scripts/pack.mjs` does the same on the local path.
- **No model call, no key, no `nodejs_compat`** — confirmed; `@anthropic-ai/sdk` is a devDependency.
- **No DOM injection** — `renderPack` and `renderList` are `textContent` throughout. The only
  `html` use is the `text/html` clipboard blob, and both renderers run model output through
  `escapeHtml` (`src/render/text.js:34`).

I checked the architecture doc's Amendment of 27 July 2026 directly. It says what the PR says it
says, so the voiding of #6 AC3/4/5 and the reshaping of AC1/7/8 are **documented deviations, not
findings**. I did not relitigate the no-API-key decision.

---

## What's good

- **The disclosure discipline is unusual and worth saying plainly.** The failing probe, the
  unmeasured AC8 number, the provably-unreachable `unwrap` bullet guard, and the assertion that
  didn't catch its bug on the first attempt were all surfaced rather than buried. The diagnosis
  of probe 1 was wrong; the honesty was not, and it is what made this reviewable at all.
- **The AC disposition table** is the right way to carry a ticket across a decision that
  postdates it — per-criterion, with Void distinguished from Changed.
- **`src/paste.js`** is the strongest single file here. The string-aware `balancedSpan` handles
  the two cases the naive `indexOf`/`lastIndexOf` version gets wrong, and the module recovers
  without repairing — the right stance for a product whose whole claim is that it invents nothing.
- **The token fix** is a real bug caught: `--verified`/`--unverified` at 2.28:1 and 2.98:1 would
  have made the product's central marking illegible, and `test/tokens.test.js` now gates it for
  every agency that swaps a colour.
- **`public/extract.js`** ends every path at `looksLikeText` and refuses rather than returning
  best-effort mush. Given that a garbled CV would demote a whole pack and the recruiter would
  blame the product, that is the correct failure posture.
- **Verifying assertions by breaking the code first**, and recording the one that failed to catch
  its bug, is a habit worth keeping.

---

## Residual — still needs a human

Unchanged from the PR's list, and legitimately outside what I can drive:

- **The timed walkthrough** through a real Claude session (#8 AC8, PRD §6 condition 2). No
  round-trip number exists yet.
- **Real Safari**, where the clipboard gesture rule is strictest.
- **Keyboard-only, start to finish**, and a paste into a real email client and ATS field.

One scoping note on my own finding: I verified the stale-write guard against the probe's model of
the clipboard, which faithfully implements the spec (value rejects → write rejects → clipboard
untouched), plus a direct `ClipboardItem` test in real Chrome. Behaviour against a **real system
clipboard** under a rejecting item belongs in the same bucket as the Safari pass.

---

## Recommendation

**Request changes** — fix probe 1 so the gate is green and actually exercises the race, and
correct the PR body and report so the next reader is not sent after a bug that isn't there. The
production diff itself I would approve.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
