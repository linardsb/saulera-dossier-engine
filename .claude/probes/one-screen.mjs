// Browser probes for public/app.js (#8).
//
// WHY THIS EXISTS. The same reason clients-screen.mjs exists, and the same class of bug: this
// screen's real hazards are ASYNC SEQUENCING — which response lands first, what the screen does
// with a response that arrived after the recruiter moved on — plus one hazard that screen did
// not have, a clipboard write that must survive a round trip without losing its user gesture.
// `node --test` has no DOM and the plan forbids adding tooling to get one, so it is measured in
// a real browser instead of reasoned about in prose. Reasoning about it in prose is what let
// five High findings ship in PR #13.
//
// It drives real Chrome over CDP and stubs `window.fetch` AND `navigator.clipboard` before
// app.js runs, which is what makes response order and clipboard outcomes controllable.
// No npm dependency: Node >= 22 has a global WebSocket, and Chrome is already on the machine.
//
// Not part of `npm test` on purpose. It needs a browser, so it is a thing you run, not a gate.
//
//   node --version   # must be >= 22
//   node .claude/probes/one-screen.mjs

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PUBLIC = join(ROOT, "public");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 8790;
const CDP_PORT = 9335;

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

/* ── the two long-lived processes ────────────────────────────────────────────────────── */

function serveStatic() {
  const server = createServer(async (req, res) => {
    const path = req.url.split("?")[0];
    const file = join(PUBLIC, path === "/" ? "index.html" : path === "/clients" ? "clients.html" : path);
    try {
      const body = await readFile(file);
      const ext = file.slice(file.lastIndexOf("."));
      res.writeHead(200, { "content-type": TYPES[ext] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}

async function startChrome() {
  const profile = mkdtempSync(join(tmpdir(), "probe-chrome-"));
  const proc = spawn(CHROME, [
    "--headless=new",
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
  ], { stdio: "ignore" });

  for (let i = 0; i < 100; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
      if (res.ok) return { proc, profile };
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Chrome did not open a debugging port");
}

/* ── a minimal CDP client ────────────────────────────────────────────────────────────── */

async function newPage() {
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: "PUT" });
  const target = await res.json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error("could not attach to the page"));
  });

  let id = 0;
  const pending = new Map();
  const waiters = [];
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    } else if (msg.method) {
      for (const w of waiters.splice(0)) w(msg);
    }
  };

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      id += 1;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

  const page = {
    send,
    targetId: target.id,
    async waitFor(method, timeout = 10_000) {
      const deadline = Date.now() + timeout;
      for (;;) {
        const msg = await Promise.race([
          new Promise((r) => waiters.push(r)),
          new Promise((r) => setTimeout(() => r(null), Math.max(0, deadline - Date.now()))),
        ]);
        if (!msg) throw new Error(`timed out waiting for ${method}`);
        if (msg.method === method) return msg.params;
      }
    },
    async eval(expression) {
      const { result, exceptionDetails } = await send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
        userGesture: true,
      });
      if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? "threw");
      return result.value;
    },
    close: () => fetch(`http://127.0.0.1:${CDP_PORT}/json/close/${target.id}`),
  };

  await send("Page.enable");
  await send("Runtime.enable");
  return page;
}

/* ── the stubs, installed before app.js runs ─────────────────────────────────────────── */

function harness(config) {
  return `
    window.__probe = { calls: [], config: ${JSON.stringify(config)}, confirms: 0,
                       clipboard: [], elapsedTicks: 0 };

    window.confirm = function () {
      window.__probe.confirms += 1;
      return window.__probe.config.confirm !== false;
    };

    // navigator.clipboard is read-only, so it is replaced rather than assigned. The stub READS
    // the item's value, which is what makes a promise-valued ClipboardItem behave here the way
    // it does in a real write: if the value rejects, the write rejects.
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        write: function (items) {
          if (window.__probe.config.clipboardDenied) return Promise.reject(new Error("denied"));
          return items[0].getType("text/plain")
            .then(function (blob) { return blob.text(); })
            .then(function (text) {
              window.__probe.clipboard.push({ kind: "write", text: text });
            });
        },
        writeText: function (text) {
          if (window.__probe.config.clipboardDenied) return Promise.reject(new Error("denied"));
          window.__probe.clipboard.push({ kind: "writeText", text: text });
          return Promise.resolve();
        },
      },
    });

    window.fetch = function (path, options) {
      options = options || {};
      var method = (options.method || "GET").toUpperCase();
      path = String(path);
      window.__probe.calls.push({ method: method, path: path, body: options.body || null });

      var route = null;
      for (var i = 0; i < window.__probe.config.routes.length; i += 1) {
        var r = window.__probe.config.routes[i];
        if (r.method && r.method !== method) continue;
        if (!new RegExp(r.match).test(path)) continue;
        route = r;
        break;
      }
      if (!route) route = { status: 500, body: { error: "no stub for " + method + " " + path } };

      return new Promise(function (resolve) {
        setTimeout(function () {
          resolve({
            ok: route.status >= 200 && route.status < 300,
            status: route.status,
            headers: {
              get: function (n) {
                return String(n).toLowerCase() === "content-type" ? "application/json" : null;
              },
            },
            json: function () { return Promise.resolve(route.body); },
          });
        }, route.delay || 0);
      });
    };

    // Counts every write to #elapsed, which is how probe 7 detects two live intervals.
    document.addEventListener("DOMContentLoaded", function () {
      var node = document.getElementById("elapsed");
      if (!node) return;
      new MutationObserver(function (records) {
        window.__probe.elapsedTicks += records.length;
      }).observe(node, { childList: true, characterData: true, subtree: true });
    });
  `;
}

const A = "11111111-1111-4111-8111-1111111111aa";
const B = "22222222-2222-4222-8222-2222222222bb";

const LIST = {
  clients: [
    { id: A, name: "Ashdown Park Community Healthcare", updated_at: "", note_chars: 1842, packs: 6 },
    { id: B, name: "Sussex Care Partners", updated_at: "", note_chars: 340, packs: 0 },
  ],
};

const claim = (over = {}) => ({
  text: "Holds a current NMC registration.",
  source_quote: "NMC registration current to Mar 2027",
  source_type: "cv",
  ...over,
});

const PACK = {
  candidate_ref: "Candidate A",
  role_title: "Band 6 Community Nurse",
  headline: "A registered nurse with a current pin and community experience.",
  evidence: [claim({ requirement: "Current NMC pin" })],
  process_fit: [claim({ source_type: "client_note", source_quote: "Kate Nwosu chairs the panel" })],
  gaps: [],
  open_questions: ["Confirm availability from September."],
};

const VERIFIED = {
  pack: PACK,
  provenance: { cv: 1, client_note: 1, unverified: 0, total: 2 },
  failures: [],
  renderer: "appendix",
  text: "SUBMISSION PACK",
  html: "<p>SUBMISSION PACK</p>",
  event_recorded: true,
};

function baseRoutes(extra = []) {
  return [
    ...extra,
    { method: "GET", match: "^/api/clients$", status: 200, body: LIST },
    { method: "POST", match: "^/api/prompt$", status: 200,
      body: { prompt: "THE PROMPT FOR A", client: { id: A, name: LIST.clients[0].name } } },
    { method: "POST", match: "^/api/verify$", status: 201, body: VERIFIED },
  ];
}

async function openScreen(config, { query = "", viewport = null } = {}) {
  const page = await newPage();
  if (viewport) {
    await page.send("Emulation.setDeviceMetricsOverride", {
      width: viewport, height: 720, deviceScaleFactor: 1, mobile: false,
    });
  }
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: harness(config) });
  await page.send("Page.navigate", { url: `http://127.0.0.1:${PORT}/${query}` });
  await page.waitFor("Page.loadEventFired");
  if (viewport) {
    await page.send("Emulation.setDeviceMetricsOverride", {
      width: viewport, height: 720, deviceScaleFactor: 1, mobile: false,
    });
  }
  await page.eval("new Promise(r => setTimeout(r, 150))");
  return page;
}

/* ── helpers the probes use inside the page ──────────────────────────────────────────── */

const SETTLE = (ms) => `new Promise(r => setTimeout(r, ${ms}))`;
const CLICK_ROW = (id) => `document.querySelector('.client-row[data-id="${id}"]').click(), true`;
const CLICK = (id) => `document.getElementById(${JSON.stringify(id)}).click(), true`;
const FILL = (id, text) => `
  (function () {
    var n = document.getElementById(${JSON.stringify(id)});
    n.value = ${JSON.stringify(text)};
    n.dispatchEvent(new Event("input", { bubbles: true }));
    return n.value;
  })()`;

// Null-safe throughout, so a missing element reports a failure rather than an exception.
const READ = `(function () {
  var t = function (id) { var n = document.getElementById(id); return n ? n.textContent : null; };
  var v = function (id) { var n = document.getElementById(id); return n ? n.value : null; };
  var hidden = function (id) { var n = document.getElementById(id); return n ? n.hidden : null; };
  return {
    inputsHidden: hidden("act-inputs"),
    waitingHidden: hidden("act-waiting"),
    packHidden: hidden("act-pack"),
    elapsed: t("elapsed"),
    inputsState: t("inputs-state"),
    waitingState: t("waiting-state"),
    packState: t("pack-state"),
    railState: t("rail-state"),
    reply: v("reply"),
    brief: v("brief"),
    cv: v("cv"),
    briefReadOnly: document.getElementById("brief").readOnly,
    cvReadOnly: document.getElementById("cv").readOnly,
    packText: t("pack-body"),
    summary: t("provenance-summary"),
    stateLink: (function () {
      var a = document.querySelector("#inputs-state a");
      return a ? { href: a.getAttribute("href"), text: a.textContent } : null;
    })(),
    marks: Array.prototype.map.call(
      document.querySelectorAll("#pack-body .mark"), function (n) { return n.textContent; }),
    failedQuotes: Array.prototype.map.call(
      document.querySelectorAll("#pack-body .claim-failed-quote"),
      function (n) { return n.textContent; }),
    claimCount: document.querySelectorAll("#pack-body .claim").length,
    url: location.search,
    calls: window.__probe.calls,
    confirms: window.__probe.confirms,
    clipboard: window.__probe.clipboard,
    elapsedTicks: window.__probe.elapsedTicks,
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  };
})()`;

/* ── the probes ──────────────────────────────────────────────────────────────────────── */

const results = [];
function check(id, title, pass, detail) {
  results.push({ id, title, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${id}  ${title}`);
  console.log(`        ${detail}`);
}

/** Fill the inputs for client A and be ready to press Copy the prompt. */
async function primeInputs(page, id = A) {
  await page.eval(CLICK_ROW(id));
  await page.eval(SETTLE(120));
  await page.eval(FILL("brief", "Band 6 community nurse. Current NMC pin required."));
  await page.eval(FILL("cv", "Registered nurse. NMC registration current to Mar 2027."));
}

async function probe1() {
  // /api/prompt is slow. The recruiter switches client while it is in flight.
  //
  // THE SWITCH IS SCHEDULED FROM INSIDE THE PAGE, before the click, and the probe asserts it
  // landed while the copy was still out. Both halves matter, and the reason is that the obvious
  // way to write this — CLICK, SETTLE(60), CLICK_ROW(B) — silently stopped testing anything.
  //
  // `copyPrompt()` opens a real tab to claude.ai synchronously inside the click (app.js:501).
  // In headless Chrome that popup's DNS and TLS happen before the click dispatch returns, so
  // `Runtime.evaluate` for the click takes ~544ms rather than ~1ms. The next CDP call is issued
  // after that, i.e. AFTER the 500ms response has already landed, and the switch then runs
  // `load(B)` → `resetToInputs()` on a completed copy. The probe read that reset screen and
  // called it a stale write: a red gate accusing correct code, and an intended race window of
  // `routeDelay − clickRoundTrip` that depends on an external network fetch and can land either
  // side of zero. Scheduling the timer BEFORE the click takes the CDP channel out of the race:
  // it is overdue when the click's stall ends, so it fires ahead of the response either way.
  //
  // A probe that quietly ceases to exercise its race is the defect class here, not a one-off,
  // so `switchedInFlight` makes the precondition an assertion rather than an assumption.
  const page = await openScreen({
    confirm: true,
    routes: baseRoutes([
      { method: "POST", match: "^/api/prompt$", status: 200, delay: 500,
        body: { prompt: "THE PROMPT FOR A", client: { id: A, name: LIST.clients[0].name } } },
    ]),
  });
  await primeInputs(page);
  await page.eval(`
    (function () {
      window.__probe.switchedInFlight = null;
      setTimeout(function () {
        // Act 2 not yet shown and Copy still busy = the response has not been acted on, which
        // is the only condition under which this probe tests the stale-write guard at all.
        window.__probe.switchedInFlight =
          document.getElementById("act-waiting").hidden === true &&
          document.getElementById("copy-prompt").getAttribute("aria-disabled") === "true";
        document.querySelector('.client-row[data-id="${B}"]').click();
      }, 60);
      return true;
    })()`);
  await page.eval(CLICK("copy-prompt"));   // moved on at +60ms, while /api/prompt is still out
  await page.eval(SETTLE(1200));

  const r = await page.eval(READ);
  const inFlight = await page.eval("window.__probe.switchedInFlight");
  check(
    "1", "a /api/prompt landing after a client switch copies nothing and starts no clock",
    inFlight === true && r.waitingHidden === true && r.clipboard.length === 0 &&
      (r.elapsed ?? "") === "" && r.briefReadOnly === false,
    `switch landed while the request was in flight=${inFlight} ` +
      `(false or null = this probe tested nothing)\n` +
      `        act-waiting hidden=${r.waitingHidden} · clipboard writes=${r.clipboard.length} ` +
      `${JSON.stringify(r.clipboard.map((c) => c.text))}\n` +
      `        elapsed=${JSON.stringify(r.elapsed)} · brief frozen=${r.briefReadOnly} ` +
      `(a stale prompt in the clipboard is one paste away from the wrong client)`,
  );
  await page.close();
}

async function probe2() {
  // The pack lands after the recruiter switched client. It must not render under B.
  const page = await openScreen({
    confirm: true,
    routes: baseRoutes([
      { method: "POST", match: "^/api/verify$", status: 201, delay: 500, body: VERIFIED },
    ]),
  });
  await primeInputs(page);
  await page.eval(CLICK("copy-prompt"));
  await page.eval(SETTLE(200));
  await page.eval(FILL("reply", '```json\n{"ok":true}\n```'));
  await page.eval(CLICK("read-pack"));
  await page.eval(SETTLE(60));
  await page.eval(CLICK_ROW(B));      // switch while /api/verify is out
  await page.eval(SETTLE(800));

  const r = await page.eval(READ);
  check(
    "2", "a /api/verify landing after a client switch renders no pack",
    r.packHidden === true && r.claimCount === 0 && r.url.includes(B),
    `act-pack hidden=${r.packHidden} · claims rendered=${r.claimCount} · url=${r.url} ` +
      `· confirms=${r.confirms}`,
  );
  await page.close();
}

async function probe3() {
  // A failed read keeps the reply and the frozen inputs. Losing either costs a trip to Claude.
  const page = await openScreen({
    routes: baseRoutes([
      { method: "POST", match: "^/api/verify$", status: 400, body: { error: "no_pack" } },
    ]),
  });
  await primeInputs(page);
  await page.eval(CLICK("copy-prompt"));
  await page.eval(SETTLE(200));
  await page.eval(FILL("reply", "Claude said something that was not a pack."));
  await page.eval(CLICK("read-pack"));
  await page.eval(SETTLE(300));

  const r = await page.eval(READ);
  check(
    "3", "a failed /api/verify keeps the reply and the frozen inputs on screen",
    r.reply === "Claude said something that was not a pack." && r.packHidden === true &&
      r.briefReadOnly === true && r.cvReadOnly === true &&
      (r.waitingState ?? "").includes("does not look like a pack") &&
      r.cv.includes("NMC registration current"),
    `reply kept=${JSON.stringify(r.reply)}\n` +
      `        inputs still frozen: brief=${r.briefReadOnly} cv=${r.cvReadOnly}\n` +
      `        message=${JSON.stringify(r.waitingState)}`,
  );
  await page.close();
}

async function probe4() {
  // note_empty is the one failure whose remedy is on another screen, so it gets a link there.
  const page = await openScreen({
    routes: baseRoutes([
      { method: "POST", match: "^/api/prompt$", status: 400, body: { error: "note_empty" } },
    ]),
  });
  await primeInputs(page);
  await page.eval(CLICK("copy-prompt"));
  await page.eval(SETTLE(300));

  const r = await page.eval(READ);
  check(
    "4", "note_empty renders its own copy and a link to the note editor",
    (r.inputsState ?? "").includes("no note for this client yet") &&
      r.stateLink !== null && r.stateLink.href === `/clients?client=${A}` &&
      r.waitingHidden === true,
    `message=${JSON.stringify(r.inputsState)}\n        link=${JSON.stringify(r.stateLink)}`,
  );
  await page.close();
}

async function probe5() {
  // The product's central rendering property: a demoted claim is MARKED, its failed quote is
  // shown so the pack is diagnosable, and the claim is still on screen.
  const demoted = {
    ...VERIFIED,
    pack: {
      ...PACK,
      evidence: [claim({
        requirement: "Current NMC pin",
        source_type: "unverified",
        source_quote: "",
        failed_quote: "registration is current and valid",
      })],
    },
    provenance: { cv: 0, client_note: 1, unverified: 1, total: 2 },
    failures: [{ section: "evidence", index: 0, reason: "quote not found in source" }],
  };
  const page = await openScreen({
    routes: baseRoutes([
      { method: "POST", match: "^/api/verify$", status: 201, body: demoted },
    ]),
  });
  await primeInputs(page);
  await page.eval(CLICK("copy-prompt"));
  await page.eval(SETTLE(200));
  await page.eval(FILL("reply", '```json\n{"ok":true}\n```'));
  await page.eval(CLICK("read-pack"));
  await page.eval(SETTLE(300));

  const r = await page.eval(READ);
  check(
    "5", "a demoted claim renders its word, its failed quote, and is still present",
    r.packHidden === false && r.claimCount === 2 &&
      r.marks.includes("Quote not found") &&
      r.failedQuotes.some((q) => q.includes("registration is current and valid")) &&
      (r.packText ?? "").includes("Holds a current NMC registration") &&
      (r.summary ?? "").includes("1 unverified"),
    `claims in the DOM=${r.claimCount} · marks=${JSON.stringify(r.marks)}\n` +
      `        failed quote shown=${JSON.stringify(r.failedQuotes)}\n` +
      `        summary=${JSON.stringify(r.summary)}`,
  );
  await page.close();
}

async function probe6() {
  // The exact bug app.css:272-277 records, on this screen's own content: a 120-character
  // unbroken client name in the rail and a 400-character unbroken line in a pasted CV.
  const long = "A".repeat(120);
  const page = await openScreen({
    routes: baseRoutes([
      { method: "GET", match: "^/api/clients$", status: 200,
        body: { clients: [{ id: A, name: long, updated_at: "", note_chars: 12, packs: 1 }] } },
      { method: "POST", match: "^/api/verify$", status: 201,
        body: {
          ...VERIFIED,
          pack: {
            ...PACK,
            headline: "B".repeat(400),
            evidence: [claim({ requirement: "C".repeat(200), text: "D".repeat(300),
                               source_quote: "E".repeat(400) })],
          },
        } },
    ]),
  }, { viewport: 360 });

  await page.eval(CLICK_ROW(A));
  await page.eval(SETTLE(120));
  await page.eval(FILL("brief", "F".repeat(400)));
  await page.eval(FILL("cv", "G".repeat(400)));
  await page.eval(CLICK("copy-prompt"));
  await page.eval(SETTLE(250));
  await page.eval(FILL("reply", "H".repeat(400)));
  await page.eval(CLICK("read-pack"));
  await page.eval(SETTLE(350));

  const r = await page.eval(READ);
  check(
    "6", "no horizontal page scroll at 360px through the whole flow",
    r.scrollWidth <= r.innerWidth && r.packHidden === false,
    `viewport=${r.innerWidth} scrollWidth=${r.scrollWidth} ` +
      `overflow=${r.scrollWidth - r.innerWidth} · pack rendered=${!r.packHidden}\n` +
      `        (120-char name, 400-char unbroken brief, CV, reply, headline and quote)`,
  );
  await page.close();
}

async function probe7() {
  // Two live intervals double the tick rate on #elapsed, and a stale one keeps the elapsed
  // arithmetic alive across a reset so the next pack records a duration including the abandoned
  // attempt. Three of the four exits from the wait are easy to forget.
  const page = await openScreen({
    routes: baseRoutes([
      { method: "POST", match: "^/api/verify$", status: 400, body: { error: "no_pack" } },
    ]),
  });
  await primeInputs(page);

  // Exit 1: Start again.
  await page.eval(CLICK("copy-prompt"));
  await page.eval(SETTLE(250));
  await page.eval(CLICK("start-again"));
  await page.eval(SETTLE(100));

  // Exit 2: a failed read, then Start again.
  await page.eval(CLICK("copy-prompt"));
  await page.eval(SETTLE(250));
  await page.eval(FILL("reply", "not a pack"));
  await page.eval(CLICK("read-pack"));
  await page.eval(SETTLE(250));
  await page.eval(CLICK("start-again"));
  await page.eval(SETTLE(100));

  // Third wait. Count the ticks over three seconds: three, not six or nine.
  await page.eval(CLICK("copy-prompt"));
  await page.eval(SETTLE(250));
  await page.eval("window.__probe.elapsedTicks = 0, true");
  await page.eval(SETTLE(3200));

  const r = await page.eval(READ);
  check(
    "7", "the clock is stopped on every exit from the wait, so only one interval ever runs",
    r.elapsedTicks <= 4 && r.elapsedTicks >= 2,
    `#elapsed updates over 3.2s after three separate waits = ${r.elapsedTicks} ` +
      `(one interval ≈ 3; two would be ≈ 6, three ≈ 9) · showing ${JSON.stringify(r.elapsed)}`,
  );
  await page.close();
}

async function probe8() {
  // The negative control for probe 1, and the plan's own "single most likely functional bug".
  // Probe 1 passes if the clipboard is never written for the RIGHT reason or the WRONG one —
  // a write that silently never works looks identical there. This is the one that tells them
  // apart: the item is built synchronously with an in-flight promise as its value, and this
  // asserts that value actually reaches the clipboard after the round trip resolves.
  const page = await openScreen({
    routes: baseRoutes([
      { method: "POST", match: "^/api/prompt$", status: 200, delay: 300,
        body: { prompt: "THE PROMPT FOR A", client: { id: A, name: LIST.clients[0].name } } },
    ]),
  });
  await primeInputs(page);
  await page.eval(CLICK("copy-prompt"));
  await page.eval(SETTLE(600));

  const afterPrompt = await page.eval(READ);
  await page.eval(FILL("reply", '```json\n{"ok":true}\n```'));
  await page.eval(CLICK("read-pack"));
  await page.eval(SETTLE(300));
  await page.eval(CLICK("copy-pack"));
  await page.eval(SETTLE(200));

  const r = await page.eval(READ);
  const prompt = r.clipboard[0];
  const pack = r.clipboard[1];
  check(
    "8", "the prompt survives the round trip onto the clipboard, and so does the pack",
    prompt && prompt.text === "THE PROMPT FOR A" &&
      afterPrompt.waitingHidden === false && afterPrompt.briefReadOnly === true &&
      pack && pack.text === "SUBMISSION PACK" &&
      (r.packState ?? "").includes("Copied"),
    `clipboard=${JSON.stringify(r.clipboard.map((c) => c.kind + ":" + c.text))}\n` +
      `        inputs froze on copy=${afterPrompt.briefReadOnly} · ` +
      `pack state=${JSON.stringify(r.packState)}`,
  );
  await page.close();
}

async function probe9() {
  // An insecure context or a denied permission. The prompt is the one thing the whole flow
  // depends on, so a refused write must not be a dead end.
  const page = await openScreen({ clipboardDenied: true, routes: baseRoutes() });
  await primeInputs(page);
  await page.eval(CLICK("copy-prompt"));
  await page.eval(SETTLE(400));

  const r = await page.eval(READ);
  const fallback = await page.eval(`
    (function () {
      var f = document.getElementById("prompt-fallback");
      var t = document.getElementById("prompt-text");
      return { hidden: f ? f.hidden : null, text: t ? t.value : null,
               readOnly: t ? t.readOnly : null };
    })()`);
  check(
    "9", "a refused clipboard shows the prompt to copy by hand and stays in act 1",
    fallback.hidden === false && fallback.text === "THE PROMPT FOR A" &&
      fallback.readOnly === true && r.waitingHidden === true && r.briefReadOnly === false,
    `fallback shown=${!fallback.hidden} readonly=${fallback.readOnly} ` +
      `text=${JSON.stringify(fallback.text)}\n` +
      `        stayed in act 1=${r.waitingHidden} · message=${JSON.stringify(r.inputsState)}`,
  );
  await page.close();
}

async function probe10() {
  // Two defects that only show on the deep-link path, which is how a bookmarked client opens.
  //
  // (a) The switch-client confirm names the client the pack was built for. state.clientName is
  //     only handed in by a row click, so on ?client=<id> and on popstate it was empty and the
  //     confirm fell back to its unnamed wording in exactly the case it was written for.
  // (b) Pressing "Read the pack" once the pack is on screen recorded a SECOND event whose
  //     duration ran from the original copy-prompt. "One event per pack" is the acceptance line.
  const page = await openScreen({ confirm: false, routes: baseRoutes() },
                                { query: `?client=${A}` });
  await page.eval(SETTLE(250));
  await page.eval(FILL("brief", "Band 6 community nurse."));
  await page.eval(FILL("cv", "Registered nurse. NMC registration current to Mar 2027."));
  await page.eval(CLICK("copy-prompt"));
  await page.eval(SETTLE(300));
  await page.eval(FILL("reply", '```json\n{"ok":true}\n```'));
  await page.eval(CLICK("read-pack"));
  await page.eval(SETTLE(300));

  // (b): press it again with the pack already on screen.
  await page.eval(CLICK("read-pack"));
  await page.eval(SETTLE(300));
  const verifyCalls = await page.eval(
    `window.__probe.calls.filter(function (c) { return c.path === "/api/verify"; }).length`);
  const readPackInert = await page.eval(
    `document.getElementById("read-pack").getAttribute("aria-disabled")`);

  // (a): now switch client and read what the confirm was asked.
  await page.eval(`
    window.__probe.confirmText = null;
    window.confirm = function (text) { window.__probe.confirmText = text; return false; };
    true`);
  await page.eval(CLICK_ROW(B));
  await page.eval(SETTLE(200));
  const confirmText = await page.eval("window.__probe.confirmText");

  check(
    "10", "the confirm names the deep-linked client, and a re-read records no second event",
    verifyCalls === 1 && readPackInert === "true" &&
      typeof confirmText === "string" &&
      confirmText.includes("Ashdown Park Community Healthcare"),
    `POST /api/verify issued ${verifyCalls} time(s) after two presses (must be 1) · ` +
      `read-pack aria-disabled=${readPackInert}\n` +
      `        confirm text=${JSON.stringify(confirmText)}`,
  );
  await page.close();
}

/* ── run ─────────────────────────────────────────────────────────────────────────────── */

const server = await serveStatic();
const chrome = await startChrome();
try {
  for (const probe of [probe1, probe2, probe3, probe4, probe5, probe6, probe7,
                       probe8, probe9, probe10]) {
    await probe();
  }
} finally {
  chrome.proc.kill();
  // Chrome writes to its profile as it shuts down, so removing it immediately races and throws
  // ENOTEMPTY over a run whose probes all passed.
  await new Promise((r) => chrome.proc.once("exit", r));
  rmSync(chrome.profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  server.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} probes pass`);
process.exit(failed.length ? 1 : 0);
