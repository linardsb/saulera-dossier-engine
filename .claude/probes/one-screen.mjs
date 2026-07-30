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
import { MAX_MONTHS_AHEAD } from "../../src/prep/dates.js";

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
    // Pages' built-in HTML handling, reproduced: an extensionless path resolves to its .html
    // file. The map is explicit rather than a suffix rule so a typo 404s here the way it
    // would in production instead of silently resolving to something else.
    const EXTENSIONLESS = {
      "/": "index.html",
      "/clients": "clients.html",
      "/counts": "counts.html",
      "/prep/brief": "prep/brief.html",
    };
    const file = join(PUBLIC, EXTENSIONLESS[path] ?? path);
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

async function openScreen(config, { query = "", viewport = null, timezone = null } = {}) {
  const page = await newPage();
  if (viewport) {
    await page.send("Emulation.setDeviceMetricsOverride", {
      width: viewport, height: 720, deviceScaleFactor: 1, mobile: false,
    });
  }
  // Set before navigation, so everything app.js computes at load — the date input's max
  // included — already sees the overridden local clock.
  if (timezone) await page.send("Emulation.setTimezoneOverride", { timezoneId: timezone });
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
    // Cleared in the copy chain's final .then(), which runs whether or not the response was
    // still the recruiter's. Null therefore means "/api/prompt landed and was dealt with",
    // which is how probe 1 tells a withheld write from a write that has not happened YET.
    copyBusy: (function () {
      var n = document.getElementById("copy-prompt");
      return n ? n.getAttribute("aria-disabled") : null;
    })(),
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

    // ── act 4 ──────────────────────────────────────────────────────────────────────────
    sendHidden: hidden("act-send"),
    previewHidden: hidden("send-preview"),
    sendState: t("send-state"),
    sendLede: t("send-preview-lede"),
    prepareBusy: (function () {
      var n = document.getElementById("prepare-send");
      return n ? n.getAttribute("aria-disabled") : null;
    })(),
    confirmBusy: (function () {
      var n = document.getElementById("confirm-send");
      return n ? n.getAttribute("aria-disabled") : null;
    })(),
    // id + ticked, per preview row, so a probe can assert WHICH box arrived unticked rather
    // than only how many did.
    strikeBoxes: Array.prototype.map.call(
      document.querySelectorAll("#strike-list .strike-box"),
      function (n) { return { id: n.dataset.id, checked: n.checked }; }),
    fieldRows: Array.prototype.map.call(
      document.querySelectorAll("#send-fields-list .send-field-row"),
      function (n) { return n.textContent; }),
    dateReadOnly: (function () {
      var n = document.getElementById("interview-date");
      return n ? n.readOnly : null;
    })(),
    dateValue: v("interview-date"),
    emailValue: v("candidate-email"),
    cancelBusy: (function () {
      var n = document.getElementById("cancel-send");
      return n ? n.getAttribute("aria-disabled") : null;
    })(),
    // The provenance grammar of the preview rows: the word, the colour class, the row's own
    // border class, and the wiring that gets the word to a screen reader.
    strikeMarks: Array.prototype.map.call(
      document.querySelectorAll("#strike-list .mark"),
      function (n) { return { text: n.textContent, cls: n.className, colour: getComputedStyle(n).color }; }),
    strikeRowClasses: Array.prototype.map.call(
      document.querySelectorAll("#strike-list .strike-row"), function (n) { return n.className; }),
    strikeDescribedBy: Array.prototype.map.call(
      document.querySelectorAll("#strike-list .strike-box"),
      function (n) {
        var id = n.getAttribute("aria-describedby");
        var target = id ? document.getElementById(id) : null;
        return target ? target.textContent : null;
      }),
    focused: (function () {
      var a = document.activeElement;
      return a ? { id: a.id || null, cls: a.className || "", tag: a.tagName } : null;
    })(),
    // The picker's own far end, set from app.js at load rather than written into the markup.
    dateMax: (function () {
      var n = document.getElementById("interview-date");
      return n ? n.getAttribute("max") : null;
    })(),

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
  // That does not stall the page — `window.open` returns in ~10ms — but it delays the CDP
  // `Runtime.evaluate` REPLY for the click to ~544ms, and it backgrounds the page, after which
  // Chrome clamps timers to ~1s buckets. The 500ms response therefore landed before the next
  // CDP call could be issued, and the switch ran `load(B)` → `resetToInputs()` on a completed
  // copy. The probe read that reset screen and called it a stale write: a red gate accusing
  // correct code, and a race window of `routeDelay − clickReplyRoundTrip` that depends on an
  // external network fetch and can land either side of zero.
  //
  // Scheduling from inside the page takes the CDP channel out of the race, and the guarantee is
  // an ordering one rather than a margin: both timers live in this page, and the switch's due
  // time (registration + 60ms) is always earlier than the response's (a strictly LATER
  // registration, inside the click handler, + 500ms). Chrome fires expired timers in due-time
  // order, so the switch precedes the response under any throttling — which matters, because in
  // a backgrounded page both routinely fire a second late.
  //
  // A probe that quietly ceases to exercise its race is the defect class here, not a one-off, so
  // the preconditions are asserted rather than assumed: `switchedInFlight` for "the switch was
  // made while the copy was out", `copyBusy` for "the response then actually landed" (without
  // it, a response still in flight at READ time looks identical to a correctly withheld write),
  // and `url` for "the switch took" (without it, a switch that silently no-ops reads as a guard
  // failure and points the next reader back at app.js:526 — the exact misdiagnosis this exists
  // to prevent).
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
    inFlight === true && r.url.includes(B) && r.copyBusy === null &&
      r.waitingHidden === true && r.clipboard.length === 0 &&
      (r.elapsed ?? "") === "" && r.briefReadOnly === false,
    `switch landed while the request was in flight=${inFlight} · switch took=${r.url.includes(B)} ` +
      `· response landed=${r.copyBusy === null} ` +
      `(any of the three false = this probe tested nothing)\n` +
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

async function probe11() {
  // The MVP is one client (PRD §6). With exactly one and no deep link, the screen picks it:
  // no click, no confirm, and the selection is real enough to build a prompt with. The URL
  // gains the id via replaceState, so there is no extra history entry to Back through.
  const page = await openScreen({
    routes: baseRoutes([
      { method: "GET", match: "^/api/clients$", status: 200,
        body: { clients: [LIST.clients[0]] } },
    ]),
  });
  await page.eval(SETTLE(250));
  const current = await page.eval(`
    (function () {
      var row = document.querySelector('.client-row[aria-current="true"]');
      return row ? row.dataset.id : null;
    })()`);
  await page.eval(FILL("brief", "Band 6 community nurse."));
  await page.eval(FILL("cv", "Registered nurse. NMC registration current to Mar 2027."));
  await page.eval(CLICK("copy-prompt"));
  await page.eval(SETTLE(300));

  const r = await page.eval(READ);
  check(
    "11", "a sole client is selected on load, without a click, well enough to copy a prompt",
    current === A && r.url.includes(A) && r.confirms === 0 &&
      r.waitingHidden === false && r.clipboard.length === 1,
    `aria-current row=${current} · url=${r.url} · confirms=${r.confirms}\n` +
      `        reached act 2=${!r.waitingHidden} · clipboard writes=${r.clipboard.length}`,
  );
  await page.close();
}

async function probe12() {
  // The return path is one paste. During the wait, ⌘V anywhere fills the reply, and a paste
  // that carries a pack runs the check itself — no click into the textarea, no button. The
  // check must still send the FROZEN cv, exactly as the button path does.
  const page = await openScreen({ routes: baseRoutes() });
  await primeInputs(page);
  await page.eval(CLICK("copy-prompt"));
  await page.eval(SETTLE(250));
  await page.eval(`
    (function () {
      var dt = new DataTransfer();
      dt.setData("text/plain", '{"role_title":"Band 6 Community Nurse"}');
      document.dispatchEvent(new ClipboardEvent("paste",
        { clipboardData: dt, bubbles: true, cancelable: true }));
      return true;
    })()`);
  await page.eval(SETTLE(400));

  const r = await page.eval(READ);
  const verifies = r.calls.filter((c) => c.path === "/api/verify");
  const sentCv = verifies.length ? JSON.parse(verifies[0].body).cv : null;
  check(
    "12", "one paste during the wait fills the reply and runs the check itself",
    (r.reply ?? "").includes('"role_title"') && verifies.length === 1 &&
      r.packHidden === false &&
      sentCv === "Registered nurse. NMC registration current to Mar 2027.",
    `reply=${JSON.stringify(r.reply)} · /api/verify calls=${verifies.length} ` +
      `· pack rendered=${!r.packHidden}\n` +
      `        cv sent=${JSON.stringify(sentCv)} (must be the frozen one)`,
  );
  await page.close();
}

async function probe13() {
  // A paste that is not a pack fills the box and fires nothing. An error flash over a partial
  // copy would punish the recruiter for a habit the previous act just taught them.
  const page = await openScreen({ routes: baseRoutes() });
  await primeInputs(page);
  await page.eval(CLICK("copy-prompt"));
  await page.eval(SETTLE(250));
  await page.eval(`
    (function () {
      var dt = new DataTransfer();
      dt.setData("text/plain", "Here is what Claude said so far.");
      document.dispatchEvent(new ClipboardEvent("paste",
        { clipboardData: dt, bubbles: true, cancelable: true }));
      return true;
    })()`);
  await page.eval(SETTLE(300));

  const r = await page.eval(READ);
  const verifies = r.calls.filter((c) => c.path === "/api/verify");
  check(
    "13", "a paste that is not a pack fills the reply and does not fire the check",
    r.reply === "Here is what Claude said so far." && verifies.length === 0 &&
      r.waitingHidden === false && r.packHidden === true,
    `reply=${JSON.stringify(r.reply)} · /api/verify calls=${verifies.length} ` +
      `· still in act 2=${!r.waitingHidden}`,
  );
  await page.close();
}

async function probe14() {
  // A file dropped on the CV column lands in the textarea through the extractor — the same
  // path as the picker, so the same honest failures. The dragover must be claimed (or the
  // browser navigates to the file) and the drag state must clear after the drop.
  const page = await openScreen({ routes: baseRoutes() });
  await page.eval(CLICK_ROW(A));
  await page.eval(SETTLE(120));
  await page.eval(`
    (function () {
      var f = new File(
        ["Registered nurse. NMC registration current to Mar 2027. Community caseload " +
         "experience across Sussex."],
        "cv.txt", { type: "text/plain" });
      var dt = new DataTransfer();
      dt.items.add(f);
      var col = document.getElementById("cv").closest(".input-col");
      col.dispatchEvent(new DragEvent("dragover",
        { dataTransfer: dt, bubbles: true, cancelable: true }));
      window.__probe.dragClaimed = col.classList.contains("is-dragover");
      col.dispatchEvent(new DragEvent("drop",
        { dataTransfer: dt, bubbles: true, cancelable: true }));
      return true;
    })()`);
  await page.eval(SETTLE(400));

  const r = await page.eval(READ);
  const claimed = await page.eval("window.__probe.dragClaimed");
  const cleared = await page.eval(
    `!document.getElementById("cv").closest(".input-col").classList.contains("is-dragover")`);
  check(
    "14", "a file dropped on the CV column lands in the textarea through the extractor",
    claimed === true && cleared === true &&
      (r.cv ?? "").includes("NMC registration current") &&
      (r.inputsState ?? "").trim() === "",
    `dragover claimed=${claimed} · drag state cleared after drop=${cleared}\n` +
      `        cv=${JSON.stringify((r.cv ?? "").slice(0, 60))} ` +
      `· state line=${JSON.stringify(r.inputsState)}`,
  );
  await page.close();
}

async function probe15() {
  // The primary route (28 Jul 2026): one click on Generate produces a rendered, verified pack
  // with zero trips through /api/verify, the inputs frozen while it runs, and the same act 3
  // as the manual route — including the copy action.
  const page = await openScreen({
    routes: baseRoutes([
      { method: "POST", match: "^/api/generate$", status: 201, delay: 300, body: VERIFIED },
    ]),
  });
  await primeInputs(page);
  await page.eval(CLICK("generate"));
  await page.eval(SETTLE(100));

  const during = await page.eval(READ);
  const mode = await page.eval(
    `document.getElementById("act-waiting").classList.contains("is-generating")`);
  await page.eval(SETTLE(500));

  const r = await page.eval(READ);
  const generateCalls = r.calls.filter((c) => c.path === "/api/generate").length;
  const verifyCalls = r.calls.filter((c) => c.path === "/api/verify").length;
  await page.eval(CLICK("copy-pack"));
  await page.eval(SETTLE(200));
  const after = await page.eval(READ);

  check(
    "15", "Generate runs the whole loop in the page: one POST, frozen inputs, pack, copy",
    during.waitingHidden === false && during.briefReadOnly === true && mode === true &&
      r.packHidden === false && r.claimCount === 2 && generateCalls === 1 &&
      verifyCalls === 0 && after.clipboard.some((c) => c.text === "SUBMISSION PACK"),
    `mid-flight: act 2 shown=${!during.waitingHidden} · inputs frozen=${during.briefReadOnly} ` +
      `· generating mode=${mode}\n` +
      `        pack rendered=${!r.packHidden} · claims=${r.claimCount} · ` +
      `/api/generate=${generateCalls} · /api/verify=${verifyCalls}\n` +
      `        pack copied=${JSON.stringify(after.clipboard.map((c) => c.text))}`,
  );
  await page.close();
}

async function probe16() {
  // The deployment with no key yet. Generate must fail back to act 1 with the inputs kept and
  // thawed, a message naming both remedies, and the manual route still working — day one of a
  // fresh deployment is exactly this state.
  const page = await openScreen({
    routes: baseRoutes([
      { method: "POST", match: "^/api/generate$", status: 503, body: { error: "no_model_key" } },
    ]),
  });
  await primeInputs(page);
  await page.eval(CLICK("generate"));
  await page.eval(SETTLE(300));

  const r = await page.eval(READ);
  await page.eval(CLICK("copy-prompt"));
  await page.eval(SETTLE(300));
  const manual = await page.eval(READ);

  check(
    "16", "no_model_key falls back to act 1 with inputs kept, and the manual route still works",
    r.waitingHidden === true && r.briefReadOnly === false &&
      r.cv.includes("NMC registration current") &&
      (r.inputsState ?? "").includes("no model key") &&
      (r.inputsState ?? "").includes("your own Claude") &&
      manual.waitingHidden === false && manual.clipboard.length === 1,
    `back in act 1=${r.waitingHidden} · inputs thawed=${!r.briefReadOnly} · kept=${r.cv.includes("NMC")}\n` +
      `        message=${JSON.stringify(r.inputsState)}\n` +
      `        manual route after: act 2=${!manual.waitingHidden} · ` +
      `prompt copied=${manual.clipboard.length}`,
  );
  await page.close();
}

async function probe17() {
  // /api/generate is slow and the recruiter switches client mid-flight. The landing pack must
  // render nothing — same stale-write class as probes 1 and 2, on the new route.
  const page = await openScreen({
    confirm: true,
    routes: baseRoutes([
      { method: "POST", match: "^/api/generate$", status: 201, delay: 500, body: VERIFIED },
    ]),
  });
  await primeInputs(page);
  await page.eval(`
    (function () {
      setTimeout(function () {
        document.querySelector('.client-row[data-id="${B}"]').click();
      }, 60);
      return true;
    })()`);
  await page.eval(CLICK("generate"));   // switch fires at +60ms, response at +500ms
  await page.eval(SETTLE(1200));

  const r = await page.eval(READ);
  check(
    "17", "an /api/generate landing after a client switch renders no pack",
    r.url.includes(B) && r.packHidden === true && r.claimCount === 0 &&
      r.briefReadOnly === false && (r.elapsed ?? "") === "",
    `url=${r.url} · act-pack hidden=${r.packHidden} · claims=${r.claimCount}\n` +
      `        inputs thawed by the switch=${!r.briefReadOnly} · ` +
      `clock cleared=${JSON.stringify(r.elapsed)} · confirms=${r.confirms}`,
  );
  await page.close();
}

/* ── act 4: send to candidate (#22) ──────────────────────────────────────────────────────
 *
 * These measure what the plan's AC #1 and R7 assert in prose. The CTA being "provably locked"
 * is a claim about REQUESTS ISSUED, not about an attribute — an aria-disabled button whose
 * handler still fires is exactly as broken as no guard at all, and only a count of fetches
 * can tell the two apart.
 */

const COMPETENCIES = [
  { id: "comp-lone-working", label: "Lone working", source_quote: "rural caseload", importance: 5, verified: true },
  { id: "comp-documentation", label: "Same-day documentation", source_quote: "written up the same day", importance: 3, verified: true },
];

/** A prepare response, with `verified` overridable so probe 22 can send an unsourced one. */
/**
 * A real interview date, computed rather than written down.
 *
 * These probes used `2099-08-12`, which src/prep/dates.js's MAX_MONTHS_AHEAD now refuses: the
 * interview date is the clock decision 13's 30-day purge runs on, so a date centuries out is a
 * retention failure and both routes answer `interview_too_far`. Sixty days is an ordinary
 * booking, and deriving it means this file cannot go stale the way a literal year does.
 */
const INTERVIEW_DATE = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
const INTERVIEW_STAMP = `${INTERVIEW_DATE} 00:00:00`;

const PREPARED = (competencies = COMPETENCIES) => ({
  payload: {
    role_title: "Band 6 Community Nurse",
    blocks: [],
    competencies,
    questions: competencies.map((c) => ({ competency_id: c.id, text: "Tell me about it.", axis: "core", difficulty: "standard" })),
  },
  provenance: { sourced: competencies.filter((c) => c.verified).length, unverified: 0, total: competencies.length },
  failures: [],
  interview_at: INTERVIEW_STAMP,
  visible_fields: [{ key: "their-process", heading: "Their process", chars: 412 }],
  duration_ms: 1200,
});

const SENT = { ok: true, sent_at: `${INTERVIEW_DATE} 09:00:00`, competencies: ["comp-lone-working"], event_recorded: true };

/** Reach phase "pack" by the generate route, which is where act 4 lives. */
async function reachPack(page, routes) {
  await primeInputs(page);
  await page.eval(CLICK("generate"));
  await page.eval(SETTLE(300));
  return routes;
}

const GENERATE_OK = { method: "POST", match: "^/api/generate$", status: 201, body: VERIFIED };
const PREPARE_OK = { method: "POST", match: "^/api/prep/prepare$", status: 200, body: PREPARED() };

async function probe18() {
  // AC #1, MEASURED. A click with the date field empty must issue ZERO requests — the button
  // carrying aria-disabled proves nothing on its own, because the handler is still bound.
  const page = await openScreen({ routes: baseRoutes([GENERATE_OK, PREPARE_OK]) });
  await reachPack(page);

  const before = await page.eval(READ);
  await page.eval(CLICK("prepare-send"));
  await page.eval(SETTLE(300));
  const r = await page.eval(READ);

  const prepares = r.calls.filter((c) => c.path === "/api/prep/prepare");
  check(
    "18", "the CTA is locked without a date: clicking issues no request and says what is missing",
    before.sendHidden === false && before.prepareBusy === "true" &&
      prepares.length === 0 && (r.sendState ?? "").includes("interview date"),
    `act-send visible=${!before.sendHidden} · aria-disabled=${before.prepareBusy}\n` +
      `        /api/prep/prepare calls=${prepares.length} · state=${JSON.stringify(r.sendState)}`,
  );
  await page.close();
}

async function probe19() {
  // The gate opens on both fields and closes again when either is cleared.
  const page = await openScreen({ routes: baseRoutes([GENERATE_OK, PREPARE_OK]) });
  await reachPack(page);

  await page.eval(FILL("interview-date", INTERVIEW_DATE));
  await page.eval(FILL("candidate-email", "candidate@example.com"));
  const open = await page.eval(READ);

  await page.eval(FILL("interview-date", ""));
  const shut = await page.eval(READ);

  check(
    "19", "filling both fields unlocks the CTA; clearing the date locks it again",
    open.prepareBusy === null && shut.prepareBusy === "true",
    `both filled -> aria-disabled=${JSON.stringify(open.prepareBusy)} · ` +
      `date cleared -> aria-disabled=${JSON.stringify(shut.prepareBusy)}`,
  );
  await page.close();
}

async function probe20() {
  // AC #3, measured on the WIRE: the strike array carries exactly the unticked id, and the
  // payload posted is the one prepare returned rather than a rebuilt approximation.
  const page = await openScreen({
    routes: baseRoutes([GENERATE_OK, PREPARE_OK, { method: "POST", match: "^/api/prep/send$", status: 201, body: SENT }]),
  });
  await reachPack(page);
  await page.eval(FILL("interview-date", INTERVIEW_DATE));
  await page.eval(FILL("candidate-email", "candidate@example.com"));
  await page.eval(CLICK("prepare-send"));
  await page.eval(SETTLE(300));

  // Untick the second competency.
  await page.eval(`
    (function () {
      var box = document.querySelectorAll("#strike-list .strike-box")[1];
      box.checked = false;
      box.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`);
  await page.eval(CLICK("confirm-send"));
  await page.eval(SETTLE(300));

  const r = await page.eval(READ);
  const sent = r.calls.filter((c) => c.path === "/api/prep/send");
  const body = sent.length ? JSON.parse(sent[0].body) : {};
  check(
    "20", "the send body carries exactly the unticked id, and prepare's own payload",
    sent.length === 1 &&
      JSON.stringify(body.strike) === JSON.stringify(["comp-documentation"]) &&
      body.payload && body.payload.competencies.length === 2 &&
      body.interview_at === INTERVIEW_STAMP,
    `sends=${sent.length} · strike=${JSON.stringify(body.strike)}\n` +
      `        payload competencies=${body.payload ? body.payload.competencies.length : "none"} · ` +
      `interview_at=${JSON.stringify(body.interview_at)} (the SERVER's normalised stamp)`,
  );
  await page.close();
}

async function probe21() {
  // R7, MEASURED. Two invites for one candidate is two `invite_sent` events, and decision 23's
  // number is the thing the epic sells on. After a success the state is terminal: further
  // clicks must issue nothing at all.
  const page = await openScreen({
    routes: baseRoutes([GENERATE_OK, PREPARE_OK, { method: "POST", match: "^/api/prep/send$", status: 201, body: SENT }]),
  });
  await reachPack(page);
  await page.eval(FILL("interview-date", INTERVIEW_DATE));
  await page.eval(FILL("candidate-email", "candidate@example.com"));
  await page.eval(CLICK("prepare-send"));
  await page.eval(SETTLE(300));

  await page.eval(CLICK("confirm-send"));
  await page.eval(SETTLE(300));
  await page.eval(CLICK("confirm-send"));
  await page.eval(CLICK("confirm-send"));
  await page.eval(CLICK("prepare-send"));
  await page.eval(SETTLE(300));

  const r = await page.eval(READ);
  const sends = r.calls.filter((c) => c.path === "/api/prep/send");
  const prepares = r.calls.filter((c) => c.path === "/api/prep/prepare");
  check(
    "21", "R7: after a successful send, further clicks issue exactly nothing",
    sends.length === 1 && prepares.length === 1 &&
      r.previewHidden === true && r.dateReadOnly === true && r.confirmBusy === "true",
    `sends=${sends.length} (must be 1) · prepares=${prepares.length} (must be 1)\n` +
      `        preview collapsed=${r.previewHidden} · fields frozen=${r.dateReadOnly} · ` +
      `confirm locked=${r.confirmBusy}\n        state=${JSON.stringify(r.sendState)}`,
  );
  await page.close();
}

async function probe22() {
  // R9's browser half. A mail outage must cost a retry, not another two-minute ~30p model
  // call — so the second confirm reuses the SAME payload and issues no second prepare.
  const page = await openScreen({
    routes: baseRoutes([
      GENERATE_OK, PREPARE_OK,
      { method: "POST", match: "^/api/prep/send$", status: 502, body: { error: "mail_failed" } },
    ]),
  });
  await reachPack(page);
  await page.eval(FILL("interview-date", INTERVIEW_DATE));
  await page.eval(FILL("candidate-email", "candidate@example.com"));
  await page.eval(CLICK("prepare-send"));
  await page.eval(SETTLE(300));

  await page.eval(CLICK("confirm-send"));
  await page.eval(SETTLE(300));
  const afterFailure = await page.eval(READ);
  await page.eval(CLICK("confirm-send"));
  await page.eval(SETTLE(300));

  const r = await page.eval(READ);
  const sends = r.calls.filter((c) => c.path === "/api/prep/send");
  const prepares = r.calls.filter((c) => c.path === "/api/prep/prepare");
  const same = sends.length === 2 && sends[0].body === sends[1].body;
  check(
    "22", "a mail failure keeps the payload: the retry re-sends it and prepares nothing again",
    same && prepares.length === 1 && afterFailure.previewHidden === false &&
      (afterFailure.sendState ?? "").includes("not accepted"),
    `sends=${sends.length} · identical bodies=${same} · prepares=${prepares.length} (must stay 1)\n` +
      `        preview still live after the failure=${!afterFailure.previewHidden}\n` +
      `        state=${JSON.stringify(afterFailure.sendState)}`,
  );
  await page.close();
}

async function probe23() {
  // An unverified competency arrives UNTICKED and is struck by default. Ticked would be a
  // default the server refuses (step 11 of the send contract) — a dead end wearing a control.
  const unsourced = [
    COMPETENCIES[0],
    { ...COMPETENCIES[1], verified: false },
  ];
  const page = await openScreen({
    routes: baseRoutes([
      GENERATE_OK,
      { method: "POST", match: "^/api/prep/prepare$", status: 200, body: PREPARED(unsourced) },
      { method: "POST", match: "^/api/prep/send$", status: 201, body: SENT },
    ]),
  });
  await reachPack(page);
  await page.eval(FILL("interview-date", INTERVIEW_DATE));
  await page.eval(FILL("candidate-email", "candidate@example.com"));
  await page.eval(CLICK("prepare-send"));
  await page.eval(SETTLE(300));

  const preview = await page.eval(READ);
  await page.eval(CLICK("confirm-send"));
  await page.eval(SETTLE(300));

  const r = await page.eval(READ);
  const sent = r.calls.filter((c) => c.path === "/api/prep/send");
  const body = sent.length ? JSON.parse(sent[0].body) : {};
  const boxes = preview.strikeBoxes;
  check(
    "23", "an unsourced competency arrives unticked and is struck by default",
    boxes.length === 2 && boxes[0].checked === true && boxes[1].checked === false &&
      JSON.stringify(body.strike) === JSON.stringify(["comp-documentation"]) &&
      // The lede must EXPLAIN the untick. An unexplained unticked box reads as a mistake the
      // recruiter should correct — which is the one correction the server would refuse.
      (preview.sendLede ?? "").includes("not being sent"),
    `boxes=${JSON.stringify(boxes)}\n` +
      `        strike posted=${JSON.stringify(body.strike)}\n` +
      `        lede=${JSON.stringify(preview.sendLede)}`,
  );
  await page.close();
}

async function probe27() {
  // The state line must not outlive the situation it describes. Untick everything and the
  // screen says so and locks confirm; tick one back and BOTH have to come undone. The first
  // cut only ever set the message, so an unlocked Send it sat under "there is nothing left
  // to send" — a screen contradicting itself, which is worse than either state alone.
  const page = await openScreen({
    routes: baseRoutes([GENERATE_OK, PREPARE_OK, { method: "POST", match: "^/api/prep/send$", status: 201, body: SENT }]),
  });
  await reachPack(page);
  await page.eval(FILL("interview-date", INTERVIEW_DATE));
  await page.eval(FILL("candidate-email", "candidate@example.com"));
  await page.eval(CLICK("prepare-send"));
  await page.eval(SETTLE(300));

  const toggle = (index, checked) => `
    (function () {
      var box = document.querySelectorAll("#strike-list .strike-box")[${index}];
      box.checked = ${checked};
      box.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`;

  await page.eval(toggle(0, false));
  await page.eval(toggle(1, false));
  const emptied = await page.eval(READ);

  await page.eval(toggle(0, true));
  const restored = await page.eval(READ);

  check(
    "27", "unticking everything warns and locks; ticking one back clears both",
    emptied.confirmBusy === "true" && (emptied.sendState ?? "").includes("nothing left to send") &&
      restored.confirmBusy === null && (restored.sendState ?? "") === "",
    `all unticked -> locked=${emptied.confirmBusy} · state=${JSON.stringify(emptied.sendState)}\n` +
      `        one re-ticked -> locked=${JSON.stringify(restored.confirmBusy)} · ` +
      `state=${JSON.stringify(restored.sendState)}`,
  );
  await page.close();
}

/* ── the three act-4 hazards PR #32's review found (H4, H5, H6) ─────────────────────────
 *
 * All three are async-sequencing or stale-input bugs, which is what this file is for: none is
 * reachable from `node --test`, and all three shipped past a green suite and 27 green probes.
 */

async function probe28() {
  // H4. Both "Start again" buttons are on screen throughout act 4 and are guarded by NOTHING —
  // not state.busy, and `resetToInputs` was the one reset path that never bumped state.reqId.
  // So a send still in flight came back AFTER the reset and set the terminal sendDone state:
  // the NEXT candidate's act 4 opened with a locked CTA, frozen fields and "Sent to <the
  // previous address>" over a pack that was never sent. Nothing on screen said why, and nothing
  // said that pressing Start again a second time was the way out.
  const page = await openScreen({
    routes: baseRoutes([
      GENERATE_OK, PREPARE_OK,
      { method: "POST", match: "^/api/prep/send$", status: 201, body: SENT, delay: 600 },
    ]),
  });
  await reachPack(page);
  await page.eval(FILL("interview-date", INTERVIEW_DATE));
  await page.eval(FILL("candidate-email", "first@example.com"));
  await page.eval(CLICK("prepare-send"));
  await page.eval(SETTLE(300));

  await page.eval(CLICK("confirm-send"));
  await page.eval(SETTLE(120)); // in flight
  await page.eval(CLICK("start-again-2"));
  await page.eval(SETTLE(900)); // the send's own response now lands, on a screen that moved on

  const r = await page.eval(READ);
  check(
    "28", "a send in flight cannot land on the screen Start again just cleared",
    r.dateReadOnly === false && r.emailValue === "" && r.dateValue === "" &&
      r.previewHidden === true && (r.sendState ?? "") === "" &&
      r.prepareBusy === "true" && r.inputsHidden === false,
    `fields thawed=${r.dateReadOnly === false} · date=${JSON.stringify(r.dateValue)} · ` +
      `email=${JSON.stringify(r.emailValue)}\n` +
      `        state=${JSON.stringify(r.sendState)} (must be empty — no "Sent to first@…")\n` +
      `        back on act 1=${r.inputsHidden === false} · CTA locked by the empty fields, ` +
      `not by sendDone=${r.prepareBusy}`,
  );
  await page.close();
}

async function probe29() {
  // H5. `confirmSend` posts `state.sendPrepared.interview_at` — the stamp the SERVER normalised
  // at prepare time — and never re-reads the field. The field was live throughout, so an edit
  // made over an open preview was accepted on screen and then discarded: the client moves the
  // interview a week, the recruiter retypes it, presses Send it, and the candidate's email,
  // their portal and the retention window all say the old day. Nothing said the edit was
  // ignored, and the date is never restated in the preview either.
  const page = await openScreen({
    routes: baseRoutes([GENERATE_OK, PREPARE_OK, { method: "POST", match: "^/api/prep/send$", status: 201, body: SENT }]),
  });
  await reachPack(page);
  await page.eval(FILL("interview-date", INTERVIEW_DATE));
  await page.eval(FILL("candidate-email", "candidate@example.com"));
  await page.eval(CLICK("prepare-send"));
  await page.eval(SETTLE(300));
  const prepared = await page.eval(READ);

  // The interview moves a week. The preview on screen was built for the old day.
  const MOVED = new Date(Date.now() + 67 * 86_400_000).toISOString().slice(0, 10);
  await page.eval(FILL("interview-date", MOVED));
  const afterEdit = await page.eval(READ);

  // And "Send it" must now be unreachable rather than silently sending the old stamp.
  await page.eval(CLICK("confirm-send"));
  await page.eval(SETTLE(300));

  const r = await page.eval(READ);
  const sends = r.calls.filter((c) => c.path === "/api/prep/send");
  check(
    "29", "editing the interview date drops the preview it was prepared against",
    prepared.previewHidden === false && afterEdit.previewHidden === true && sends.length === 0,
    `preview open after prepare=${prepared.previewHidden === false} · ` +
      `dropped by the edit=${afterEdit.previewHidden}\n` +
      `        sends after clicking "Send it"=${sends.length} (must be 0 — the old stamp is gone, ` +
      `not posted)\n        the recruiter re-prepares against ${MOVED}, which is the only way ` +
      `the date reaches the model call again`,
  );
  await page.close();
}

async function probe30() {
  // H6, the browser courtesy half. `purgeExpired` deletes on interview_at + 30 days, so a
  // one-character year typo — 2226 for 2026 — keeps a candidate's CV, brief, note slice, address
  // and live magic link in D1 for two centuries, while their email says it is all deleted after
  // 30 days. Nothing anywhere capped the far end: not the input, not the gate, not the purge.
  const page = await openScreen({ routes: baseRoutes([GENERATE_OK, PREPARE_OK]) });
  await reachPack(page);
  await page.eval(FILL("candidate-email", "candidate@example.com"));
  await page.eval(FILL("interview-date", "2226-08-12"));
  const typo = await page.eval(READ);

  await page.eval(CLICK("prepare-send"));
  await page.eval(SETTLE(300));

  const r = await page.eval(READ);
  const prepares = r.calls.filter((c) => c.path === "/api/prep/prepare");
  const maxYear = Number((typo.dateMax ?? "0").slice(0, 4));
  const thisYear = new Date().getFullYear();
  check(
    "30", "a mistyped year is caught before it becomes a two-century retention window",
    typo.dateMax !== null && maxYear === thisYear + 2 &&
      typo.prepareBusy === "true" && prepares.length === 0 &&
      (r.sendState ?? "").includes("Check the year"),
    `input max=${JSON.stringify(typo.dateMax)} (two years out, computed at load)\n` +
      `        CTA locked=${typo.prepareBusy} · prepares issued=${prepares.length} (must be 0 — ` +
      `the ~30p call is never spent on a typo)\n        state=${JSON.stringify(r.sendState)}`,
  );
  await page.close();
}

async function probe31() {
  // The preview rows are provenance rows, so they have to speak act 3's grammar — and they were
  // speaking a dialect of it. Every verified competency was badged "Our note", which is the one
  // thing it cannot be: `verified` is computed against the cleaned BRIEF, and the schema tells
  // the model to quote the brief and never the CV. The verified branch also set a bare "mark"
  // with no colour modifier, and the unverified row never got `claim-unverified` — so two of the
  // three signals act 3 promises (the word, the colour, the border) were missing or wrong.
  const unsourced = [COMPETENCIES[0], { ...COMPETENCIES[1], verified: false }];
  const page = await openScreen({
    routes: baseRoutes([
      GENERATE_OK,
      { method: "POST", match: "^/api/prep/prepare$", status: 200, body: PREPARED(unsourced) },
    ]),
  });
  await reachPack(page);
  await page.eval(FILL("interview-date", INTERVIEW_DATE));
  await page.eval(FILL("candidate-email", "candidate@example.com"));
  await page.eval(CLICK("prepare-send"));
  await page.eval(SETTLE(300));

  const r = await page.eval(READ);
  const [ok, bad] = r.strikeMarks;
  const [okRow, badRow] = r.strikeRowClasses;
  check(
    "31", "a preview row carries the right word, its colour and its border",
    ok && ok.text === "Brief" && ok.cls.includes("mark-brief") &&
      bad && bad.text === "Unverified" && bad.cls.includes("mark-unverified") &&
      // Distinct colours, and neither inheriting the body colour by omission.
      ok.colour !== bad.colour &&
      okRow === "claim strike-row" && (badRow ?? "").includes("claim-unverified") &&
      // And the word reaches a screen reader with the checkbox rather than beside it.
      JSON.stringify(r.strikeDescribedBy) === JSON.stringify(["Brief", "Unverified"]),
    `marks=${JSON.stringify(r.strikeMarks.map((m) => m.text))} · ` +
      `classes=${JSON.stringify(r.strikeMarks.map((m) => m.cls))}\n` +
      `        colours=${JSON.stringify(r.strikeMarks.map((m) => m.colour))} (must differ)\n` +
      `        row classes=${JSON.stringify(r.strikeRowClasses)}\n` +
      `        each box describedby its own mark=${JSON.stringify(r.strikeDescribedBy)}`,
  );
  await page.close();
}

async function probe32() {
  // Two defects that only appear together. An all-unverified preview said BOTH "None of these
  // could be found in the brief" (the lede) and "Everything is unticked, so there is nothing
  // left to send" (the gate, announcing) — a screen contradicting itself, the second sentence
  // blaming the recruiter for an unticking they did not do. And focus landed on the irreversible
  // "Send it" with preventScroll, so a recruiter who had scrolled up held focus on a button they
  // could not see: one Space and the email is gone, before a competency has been read.
  const allBad = COMPETENCIES.map((c) => ({ ...c, verified: false }));
  const page = await openScreen({
    routes: baseRoutes([
      GENERATE_OK,
      { method: "POST", match: "^/api/prep/prepare$", status: 200, body: PREPARED(allBad) },
    ]),
  });
  await reachPack(page);
  await page.eval(FILL("interview-date", INTERVIEW_DATE));
  await page.eval(FILL("candidate-email", "candidate@example.com"));
  await page.eval(CLICK("prepare-send"));
  await page.eval(SETTLE(400));

  const r = await page.eval(READ);
  await page.close();

  // And the emptiest case of all, which used to lock the button and say NOTHING — a disabled
  // control over a blank list reads as the screen having broken, not as an outcome.
  const empty = await openScreen({
    routes: baseRoutes([
      GENERATE_OK,
      { method: "POST", match: "^/api/prep/prepare$", status: 200, body: PREPARED([]) },
    ]),
  });
  await reachPack(empty);
  await empty.eval(FILL("interview-date", INTERVIEW_DATE));
  await empty.eval(FILL("candidate-email", "candidate@example.com"));
  await empty.eval(CLICK("prepare-send"));
  await empty.eval(SETTLE(400));
  const e = await empty.eval(READ);

  check(
    "32", "an all-unverified preview says one thing, and focus is not on the irreversible button",
    (r.sendLede ?? "").includes("None of these could be found") &&
      (r.sendState ?? "") === "" &&
      r.confirmBusy === "true" &&
      r.focused && r.focused.id !== "confirm-send" && (r.focused.cls ?? "").includes("strike-box") &&
      // The empty preview explains itself too, and does not double up either.
      (e.sendLede ?? "").includes("Nothing was pulled out of the brief") &&
      (e.sendState ?? "") === "" && e.confirmBusy === "true" && e.strikeBoxes.length === 0,
    `lede=${JSON.stringify(r.sendLede)}\n` +
      `        state=${JSON.stringify(r.sendState)} (must be empty — the lede owns this)\n` +
      `        confirm locked=${r.confirmBusy} · focus on ${JSON.stringify(r.focused)}\n` +
      `        zero competencies -> lede=${JSON.stringify(e.sendLede)} · ` +
      `state=${JSON.stringify(e.sendState)} · locked=${e.confirmBusy}`,
  );
  await empty.close();
}

async function probe33() {
  // "Send to candidate" stayed live over an open preview, so a second press silently ran the
  // ~30p model call again and swapped the preview underneath the recruiter. "Not yet" is the way
  // back — and IT was the silent one mid-send: an early return on state.busy with no message and
  // no aria-disabled, so it read as broken at the moment it is most likely to be pressed.
  const page = await openScreen({
    routes: baseRoutes([
      GENERATE_OK, PREPARE_OK,
      { method: "POST", match: "^/api/prep/send$", status: 201, body: SENT, delay: 500 },
    ]),
  });
  await reachPack(page);
  await page.eval(FILL("interview-date", INTERVIEW_DATE));
  await page.eval(FILL("candidate-email", "candidate@example.com"));
  await page.eval(CLICK("prepare-send"));
  await page.eval(SETTLE(300));

  // Over an open preview: locked, and pressing it spends nothing.
  const open = await page.eval(READ);
  await page.eval(CLICK("prepare-send"));
  await page.eval(SETTLE(200));
  const afterSecondPress = await page.eval(READ);

  // Mid-send: "Not yet" cannot do what it says, and now says so instead of doing nothing.
  await page.eval(CLICK("confirm-send"));
  await page.eval(SETTLE(120));
  const sending = await page.eval(READ);
  await page.eval(CLICK("cancel-send"));
  const cancelled = await page.eval(READ);
  await page.eval(SETTLE(600));

  const prepares = afterSecondPress.calls.filter((c) => c.path === "/api/prep/prepare");
  check(
    "33", "the model call cannot be re-run over an open preview, and \"Not yet\" never does nothing",
    open.prepareBusy === "true" && prepares.length === 1 &&
      afterSecondPress.previewHidden === false &&
      sending.cancelBusy === "true" &&
      (cancelled.sendState ?? "").includes("already going") &&
      cancelled.previewHidden === false,
    `preview open -> "Send to candidate" locked=${open.prepareBusy} · ` +
      `prepares after a second press=${prepares.length} (must stay 1)\n` +
      `        mid-send "Not yet" locked=${sending.cancelBusy} · ` +
      `pressed anyway -> ${JSON.stringify(cancelled.sendState)}\n` +
      `        and the payload it would have dropped is still there=${!cancelled.previewHidden}`,
  );
  await page.close();
}

async function probe34() {
  // A send failure must describe THIS act. `sendMessageFor` had no case for `missing_fields`, so
  // it fell through to messageFor, whose copy for that code is act 1's — "Paste the brief and the
  // CV before you copy the prompt." — shown in act 4, where both are frozen, filled and visible
  // two acts above. An address that clears the browser's `indexOf("@") > 0` and fails the
  // server's cleanEmail is the ordinary way to get here.
  const page = await openScreen({
    routes: baseRoutes([
      GENERATE_OK, PREPARE_OK,
      { method: "POST", match: "^/api/prep/send$", status: 400, body: { error: "missing_fields" } },
    ]),
  });
  await reachPack(page);
  await page.eval(FILL("interview-date", INTERVIEW_DATE));
  await page.eval(FILL("candidate-email", "candidate@example..com"));
  await page.eval(CLICK("prepare-send"));
  await page.eval(SETTLE(300));
  await page.eval(CLICK("confirm-send"));
  await page.eval(SETTLE(300));

  const r = await page.eval(READ);
  check(
    "34", "a send failure names this screen's fields, not act 1's",
    (r.sendState ?? "").includes("email address or the interview date") &&
      !(r.sendState ?? "").includes("copy the prompt") &&
      // And the payload is kept, so the remedy is an edit and a retry rather than another call.
      r.previewHidden === false,
    `state=${JSON.stringify(r.sendState)}\n` +
      `        must not mention the prompt, and the preview is still here=${!r.previewHidden}`,
  );
  await page.close();
}

async function probe35() {
  // The picker's far end must BE the server's far end. maxUtc() used to be maxLocal() — the
  // local calendar +2 years, where isWithinHorizon compares UTC +24 months — so a recruiter
  // east of UTC picking the exact day the picker offered got a server `interview_too_far` the
  // browser had said was fine. The two zones below sit 14h ahead of and 12h behind UTC, so at
  // ANY real instant at least one of them is on a different calendar day than UTC: local
  // arithmetic cannot satisfy both, which is what makes this falsifiable at any hour.
  const horizon = new Date();
  horizon.setUTCMonth(horizon.getUTCMonth() + MAX_MONTHS_AHEAD);
  const expected = horizon.toISOString().slice(0, 10);

  const maxes = [];
  for (const timezone of ["Pacific/Kiritimati", "Etc/GMT+12"]) {
    const page = await openScreen({ routes: baseRoutes() }, { timezone });
    const r = await page.eval(READ);
    maxes.push({ timezone, max: r.dateMax });
    await page.close();
  }
  check(
    "35", "the picker's far end is the server's horizon, whichever side of UTC the recruiter is on",
    maxes.every((m) => m.max === expected),
    `${maxes.map((m) => `${m.timezone} max=${JSON.stringify(m.max)}`).join(" · ")}\n` +
      `        server horizon=${expected} (UTC + ${MAX_MONTHS_AHEAD} months, same arithmetic)`,
  );
}

async function probe36() {
  // A deployment with no PREP_BASE_URL answers `503 no_base_url` before anything is minted or
  // written — and until this string existed, that read on screen as the generic "Could not
  // send that", a transient failure the recruiter would retry forever. The remedy is one
  // deployment setting; the sentence has to say so, and say that nothing was sent.
  const page = await openScreen({
    routes: baseRoutes([
      GENERATE_OK, PREPARE_OK,
      { method: "POST", match: "^/api/prep/send$", status: 503, body: { error: "no_base_url" } },
    ]),
  });
  await reachPack(page);
  await page.eval(FILL("interview-date", INTERVIEW_DATE));
  await page.eval(FILL("candidate-email", "candidate@example.com"));
  await page.eval(CLICK("prepare-send"));
  await page.eval(SETTLE(300));
  await page.eval(CLICK("confirm-send"));
  await page.eval(SETTLE(300));

  const r = await page.eval(READ);
  check(
    "36", "a deployment that cannot build the link says so, instead of reading as transient",
    (r.sendState ?? "").includes("page address") && (r.sendState ?? "").includes("Nothing was sent") &&
      !(r.sendState ?? "").includes("Could not send that"),
    `state=${JSON.stringify(r.sendState)}\n` +
      `        must name the missing setting and say nothing was sent`,
  );
  await page.close();
}

/* ── the other two screens (#22) ─────────────────────────────────────────────────────────
 *
 * These exist because nothing else executes either file. test/counts.test.js is a SOURCE
 * SCAN — it proves what counts.js does not fetch, not that it renders — and the candidate
 * page's 401 branch is client-side, so the integration test that drives
 * functions/prep/api/brief.js never reaches it. Both were shipping on "reads correct".
 */

async function probe24() {
  // AC #4's rendering half, and the one line of it a source scan cannot see: a client with no
  // invites must show 0, not a blank. A blank reads as "we do not know", and we do know.
  const page = await openScreen({
    routes: [
      { method: "GET", match: "^/api/clients$", status: 200, body: LIST },
      { method: "GET", match: "^/api/events$", status: 200, body: {
        total: 6,
        // Only client A has any history. B must still render a full row of zeros.
        per_client: [{ client_id: A, packs: 6, invites_sent: 4, invites_opened: 3 }],
      } },
    ],
  }, { query: "counts" });
  await page.eval(SETTLE(300));

  const r = await page.eval(`(function () {
    var rows = Array.prototype.map.call(document.querySelectorAll("#counts-body tr"), function (tr) {
      return Array.prototype.map.call(tr.children, function (c) { return c.textContent; });
    });
    var state = document.getElementById("counts-state");
    return {
      rows: rows,
      stateText: state.textContent,
      stateShown: state.classList.contains("is-shown"),
      calls: window.__probe.calls.map(function (c) { return c.path; }),
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    };
  })()`);

  const a = r.rows[0] ?? [];
  const b = r.rows[1] ?? [];
  check(
    "24", "the counts page renders a row per client, and zeros where there is no history",
    r.rows.length === 2 &&
      a[1] === "6" && a[2] === "4" && a[3] === "3" &&
      b[1] === "0" && b[2] === "0" && b[3] === "0" &&
      r.calls.length === 2 && r.stateShown === false &&
      r.scrollWidth <= r.innerWidth,
    `rows=${JSON.stringify(r.rows)}\n` +
      `        requests=${JSON.stringify(r.calls)} (must be exactly the two aggregates)\n` +
      `        state cleared=${!r.stateShown} · no horizontal page scroll=${r.scrollWidth <= r.innerWidth}`,
  );
  await page.close();
}

async function probe25() {
  // A candidate whose session has gone must land on /prep/login, not on an error line over a
  // page they cannot use. This is brief.js's 401 branch, which no server-side test reaches.
  const page = await openScreen({
    routes: [{ method: "GET", match: "^/prep/api/brief$", status: 401, body: { error: "invalid_token" } }],
  }, { query: "prep/brief" });
  await page.eval(SETTLE(400));

  // `window.__probe.calls` is NOT read here: it belongs to the document that made the
  // request, and the navigation this probe is about replaced that document. The landing IS
  // the assertion — the request must have been issued and answered 401 for it to have
  // happened at all, since nothing else on this page navigates.
  const r = await page.eval(`({ path: location.pathname, search: location.search })`);
  check(
    "25", "a candidate with no session is sent to /prep/login rather than shown an error",
    r.path === "/prep/login",
    `landed on ${r.path}${r.search} (from /prep/brief, via the 401 branch)`,
  );
  await page.close();
}

async function probe26() {
  // 404 is a REAL STATE, not a failure: the invite exists and the handover has not been
  // written. It must get the "not ready yet" copy and stay on the page.
  const page = await openScreen({
    routes: [{ method: "GET", match: "^/prep/api/brief$", status: 404, body: { error: "not_found" } }],
  }, { query: "prep/brief" });
  await page.eval(SETTLE(400));

  const r = await page.eval(`({
    path: location.pathname,
    state: (document.getElementById("brief-state") || {}).textContent,
    isError: (document.getElementById("brief-state") || { classList: { contains: function () { return null; } } })
      .classList.contains("is-error"),
  })`);
  check(
    "26", "a brief that is not ready yet says so, and does not read as a failure",
    r.path === "/prep/brief" && (r.state ?? "").includes("not ready yet") && r.isError === false,
    `stayed on ${r.path} · state=${JSON.stringify(r.state)} · styled as an error=${r.isError}`,
  );
  await page.close();
}

/* ── run ─────────────────────────────────────────────────────────────────────────────── */

const server = await serveStatic();
const chrome = await startChrome();
try {
  for (const probe of [probe1, probe2, probe3, probe4, probe5, probe6, probe7,
                       probe8, probe9, probe10, probe11, probe12, probe13, probe14,
                       probe15, probe16, probe17,
                       probe18, probe19, probe20, probe21, probe22, probe23,
                       probe24, probe25, probe26, probe27,
                       probe28, probe29, probe30, probe31, probe32, probe33, probe34,
                       probe35, probe36]) {
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
