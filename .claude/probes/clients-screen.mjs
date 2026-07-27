// Browser probes for public/clients.js (#5, PR #13 review).
//
// WHY THIS EXISTS. Five of the six High findings in the PR #13 review live in clients.js, and
// this project's test runner is `node --test` with a fake D1 — there is no DOM, and the plan
// forbids adding tooling to get one. The findings are all about ASYNC SEQUENCING: which
// response lands first, what the screen does with a response that arrived after the user moved
// on. Reasoning about that in prose is what let the bugs ship, so it is measured here instead.
//
// It drives real Chrome over CDP and stubs `window.fetch` before clients.js runs, which is what
// makes response ORDER controllable — the property every one of these findings turns on. No npm
// dependency: Node >= 22 has a global WebSocket, and Chrome is already on the machine.
//
// Not part of `npm test` on purpose. It needs a browser, so it is a thing you run, not a gate.
//
//   node --version   # must be >= 22
//   node .claude/probes/clients-screen.mjs

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
const PORT = 8788;
const CDP_PORT = 9333;

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

/* ── the two long-lived processes ────────────────────────────────────────────────────── */

function serveStatic() {
  const server = createServer(async (req, res) => {
    const path = req.url.split("?")[0];
    const file = join(PUBLIC, path === "/clients" ? "clients.html" : path);
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
    /** Evaluate in the page and return the value, awaiting promises. */
    async eval(expression) {
      const { result, exceptionDetails } = await send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
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

/* ── the fetch stub, installed before clients.js runs ────────────────────────────────── */

/**
 * `routes` is an ordered list of { method, match, status, delay, body }. The first entry whose
 * method and regexp match wins, so a probe overrides one route and inherits the rest.
 */
function harness(config) {
  return `
    window.__probe = { calls: [], config: ${JSON.stringify(config)}, confirms: 0 };

    window.confirm = function () {
      window.__probe.confirms += 1;
      return window.__probe.config.confirm !== false;
    };

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
  `;
}

const A = "11111111-1111-4111-8111-1111111111aa";
const B = "22222222-2222-4222-8222-2222222222bb";

const LIST = {
  clients: [
    { id: A, name: "Ashdown Park Community Healthcare", updated_at: "", note_chars: 12, packs: 1 },
    { id: B, name: "Sussex Care Partners", updated_at: "", note_chars: 34, packs: 0 },
  ],
};
const AGENCY = { agency: { name: "", send_format: "email_body", renderer: "appendix" } };

/** The routes every probe starts from. */
function baseRoutes(extra = []) {
  return [
    ...extra,
    { method: "GET", match: "^/api/agency$", status: 200, body: AGENCY },
    { method: "PUT", match: "^/api/agency$", status: 200, body: AGENCY },
    { method: "GET", match: "^/api/clients$", status: 200, body: LIST },
    { method: "POST", match: "^/api/clients$", status: 201, body: { client: { id: B } } },
    {
      method: "GET",
      match: `^/api/clients/${A}$`,
      status: 200,
      body: { client: { id: A, name: LIST.clients[0].name, note: "A's note" } },
    },
    {
      method: "GET",
      match: `^/api/clients/${B}$`,
      status: 200,
      body: { client: { id: B, name: LIST.clients[1].name, note: "B's note" } },
    },
    { method: "PUT", match: "^/api/clients/", status: 200, body: { client: {} } },
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
  await page.send("Page.navigate", { url: `http://127.0.0.1:${PORT}/clients${query}` });
  await page.waitFor("Page.loadEventFired");
  if (viewport) {
    // Re-applied after load: setting it before navigate alone raced often enough to report the
    // host's own 1440px, which would silently measure the wrong viewport.
    await page.send("Emulation.setDeviceMetricsOverride", {
      width: viewport, height: 720, deviceScaleFactor: 1, mobile: false,
    });
  }
  await page.eval("new Promise(r => setTimeout(r, 150))");
  return page;
}

/* ── helpers the probes use inside the page ──────────────────────────────────────────── */

const CLICK_ROW = (id) =>
  `document.querySelector('.client-row[data-id="${id}"]').click(), true`;
const TYPE = (text) => `
  (function () {
    var n = document.getElementById("note");
    n.value = ${JSON.stringify(text)};
    n.dispatchEvent(new Event("input", { bubbles: true }));
    return n.value;
  })()`;
const SETTLE = (ms) => `new Promise(r => setTimeout(r, ${ms}))`;
// Null-safe throughout, so the same battery runs against the pre-fix revision — where
// #rail-state does not exist yet — and reports a failure rather than an exception.
const READ = `(function () {
  var rail = document.getElementById("rail-state");
  var save = document.getElementById("save-state");
  return {
    head: document.getElementById("editor-head").textContent,
    note: document.getElementById("note").value,
    saveState: save ? save.textContent : null,
    railState: rail ? rail.textContent : null,
    railVisible: rail ? rail.offsetParent !== null : false,
    url: location.search,
    calls: window.__probe.calls,
    confirms: window.__probe.confirms,
    activeId: document.activeElement ? document.activeElement.id : null,
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

async function probeH1() {
  // A's GET is slow, B's is fast: A's response lands AFTER B's, so arrival order and click
  // order disagree. That is the whole finding.
  const page = await openScreen({
    routes: baseRoutes([
      { method: "GET", match: `^/api/clients/${A}$`, status: 200, delay: 400,
        body: { client: { id: A, name: LIST.clients[0].name, note: "A's note" } } },
      { method: "GET", match: `^/api/clients/${B}$`, status: 200, delay: 40,
        body: { client: { id: B, name: LIST.clients[1].name, note: "B's note" } } },
    ]),
  });

  await page.eval(CLICK_ROW(A));
  await page.eval(SETTLE(30));
  await page.eval(CLICK_ROW(B));
  await page.eval(SETTLE(700));

  // Then the consequence the finding names: type one word and save.
  await page.eval(TYPE("B's note plus a word"));
  await page.eval(`document.getElementById("save-button").click(), true`);
  await page.eval(SETTLE(300));

  const r = await page.eval(READ);
  const put = r.calls.find((c) => c.method === "PUT" && c.path.startsWith("/api/clients/"));
  check(
    "H1", "a stale GET does not overwrite a different client's note",
    r.head === "Sussex Care Partners" && r.url.includes(B) &&
      put.path === `/api/clients/${B}` && put.body.includes("plus a word"),
    `editor head=${JSON.stringify(r.head)} url=${r.url} → PUT ${put.path}\n` +
      `        body=${put.body}`,
  );
  await page.close();
}

async function probeH2() {
  const page = await openScreen({
    routes: baseRoutes([
      { method: "PUT", match: "^/api/clients/", status: 200, delay: 400, body: { client: {} } },
    ]),
  });
  await page.eval(CLICK_ROW(A));
  await page.eval(SETTLE(150));
  await page.eval(TYPE("hello"));
  await page.eval(`document.getElementById("save-button").click(), true`);
  await page.eval(SETTLE(80));
  await page.eval(TYPE("hello world"));       // typed WHILE the PUT is in flight
  await page.eval(SETTLE(600));

  const r = await page.eval(READ);
  const put = r.calls.find((c) => c.method === "PUT");
  check(
    "H2", "keystrokes during a save are not silently discarded",
    (r.saveState ?? "") === "Unsaved changes" && !put.body.includes("hello world"),
    `sent=${put.body} · textarea now=${JSON.stringify(r.note)} · ` +
      `save-state=${JSON.stringify(r.saveState)}`,
  );
  await page.close();
}

async function probeH3add() {
  const page = await openScreen({ confirm: false, routes: baseRoutes() });
  await page.eval(CLICK_ROW(A));
  await page.eval(SETTLE(150));
  await page.eval(TYPE("half a note I care about"));
  await page.eval(`
    document.getElementById("new-client-name").value = "New Client";
    document.getElementById("add-form").dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }));
    true`);
  await page.eval(SETTLE(300));

  const r = await page.eval(READ);
  const posts = r.calls.filter((c) => c.method === "POST" && c.path === "/api/clients");
  check(
    "H3a", "declining the add-client confirm keeps the note AND creates no orphan row",
    r.note === "half a note I care about" && r.confirms === 1 && posts.length === 0,
    `confirms=${r.confirms} · POST /api/clients issued ${posts.length} time(s) · ` +
      `note=${JSON.stringify(r.note)}`,
  );
  await page.close();
}

async function probeH3back() {
  const page = await openScreen({ confirm: false, routes: baseRoutes() }, { query: `?client=${A}` });
  await page.eval(SETTLE(150));
  await page.eval(CLICK_ROW(B));
  await page.eval(SETTLE(200));
  await page.eval(TYPE("edits to B I have not saved"));
  await page.eval(`history.back(), true`);
  await page.eval(SETTLE(400));

  const r = await page.eval(READ);
  check(
    "H3b", "browser Back on a dirty note asks first, and declining keeps the text",
    r.note === "edits to B I have not saved" && r.head === "Sussex Care Partners" &&
      r.confirms === 1 && r.url.includes(B),
    `confirms=${r.confirms} · head=${JSON.stringify(r.head)} · url=${r.url} · ` +
      `note=${JSON.stringify(r.note)}`,
  );
  await page.close();
}

async function probeM9() {
  const page = await openScreen({
    confirm: true,
    routes: baseRoutes([
      { method: "PUT", match: "^/api/clients/", status: 200, delay: 500, body: { client: {} } },
    ]),
  });
  await page.eval(CLICK_ROW(A));
  await page.eval(SETTLE(150));
  await page.eval(TYPE("A's edits"));
  await page.eval(`document.getElementById("save-button").click(), true`);
  await page.eval(SETTLE(60));
  await page.eval(CLICK_ROW(B));               // switch while A's PUT is in flight
  await page.eval(SETTLE(800));

  const r = await page.eval(READ);
  check(
    "M9", "a save resolving after a client switch reports nothing against the new client",
    r.head === "Sussex Care Partners" && !/^Saved \d\d:\d\d$/.test(r.saveState),
    `head=${JSON.stringify(r.head)} · save-state=${JSON.stringify(r.saveState)} ` +
      `(must not be "Saved HH:MM" — B was never saved)`,
  );
  await page.close();
}

async function probeM3() {
  // /clients with NO ?client: #editor-body is hidden, so #save-state is in a hidden subtree.
  const page = await openScreen({
    routes: baseRoutes([
      { method: "GET", match: "^/api/clients$", status: 500, body: { error: "internal" } },
    ]),
  });
  await page.eval(SETTLE(250));

  const r = await page.eval(READ);
  const saveStateVisible = await page.eval(
    `document.getElementById("save-state").offsetParent !== null`);
  check(
    "M3", "a list-load failure is visible when no client is selected",
    r.railVisible && (r.railState ?? "").length > 0 && !saveStateVisible,
    `rail-state visible=${r.railVisible} text=${JSON.stringify(r.railState)}\n` +
      `        save-state visible=${saveStateVisible} (it is inside the hidden editor body)`,
  );
  await page.close();
}

async function probeM4() {
  // The save succeeds; the list refresh that follows it fails.
  const page = await openScreen({
    routes: [
      { method: "PUT", match: "^/api/clients/", status: 200, body: { client: {} } },
      { method: "GET", match: "^/api/clients$", status: 200, body: LIST, once: true },
      ...baseRoutes(),
    ],
  });
  await page.eval(CLICK_ROW(A));
  await page.eval(SETTLE(150));
  await page.eval(TYPE("saved for real"));
  // Break the list route only now, so the save's own refresh is the one that fails.
  await page.eval(`
    window.__probe.config.routes.unshift(
      { method: "GET", match: "^/api/clients$", status: 500, body: { error: "internal" } });
    true`);
  await page.eval(`document.getElementById("save-button").click(), true`);
  await page.eval(SETTLE(300));

  const r = await page.eval(READ);
  check(
    "M4", "a successful save never reports 'Could not save'",
    /^Saved \d\d:\d\d$/.test(r.saveState ?? "") && (r.railState ?? "").length > 0,
    `save-state=${JSON.stringify(r.saveState)} · rail-state=${JSON.stringify(r.railState)}`,
  );
  await page.close();
}

async function probeM7() {
  const page = await openScreen({
    routes: [{ match: "^/api/", status: 503, body: { error: "not_configured" } }],
  }, { query: `?client=${A}` });
  await page.eval(SETTLE(250));

  const r = await page.eval(READ);
  const empty = await page.eval(`document.getElementById("editor-empty").textContent`);
  const agency = await page.eval(`document.getElementById("agency-state").textContent`);
  const saveCopy = "Could not save. Your text is still here. Try again.";
  check(
    "M7", "a 503 on first paint says what is wrong, not 'Could not save'",
    empty.includes("not connected to its database") && empty !== saveCopy &&
      r.railState.includes("not connected") && agency.includes("not connected"),
    `editor=${JSON.stringify(empty)}\n        rail=${JSON.stringify(r.railState)}\n` +
      `        agency=${JSON.stringify(agency)}`,
  );
  await page.close();
}

async function probeM8() {
  const page = await openScreen({
    routes: baseRoutes([
      { method: "PUT", match: "^/api/clients/", status: 200, delay: 200, body: { client: {} } },
    ]),
  });
  await page.eval(CLICK_ROW(A));
  await page.eval(SETTLE(150));
  await page.eval(TYPE("x"));
  await page.eval(`document.getElementById("save-button").focus(), true`);
  const during = await (async () => {
    await page.eval(`document.getElementById("save-button").click(), true`);
    await page.eval(SETTLE(60));
    return page.eval(`document.activeElement.id`);
  })();
  await page.eval(SETTLE(400));
  const after = await page.eval(`document.activeElement.id`);

  check(
    "M8", "the save button keeps focus across a save",
    during === "save-button" && after === "save-button",
    `activeElement during the save=${JSON.stringify(during)} · after=${JSON.stringify(after)}`,
  );
  await page.close();
}

async function probeH6() {
  // The reviewer's case: a 120-character name with no whitespace in it at all. The seeded name
  // has spaces, which is why the original probe measured clean.
  const long = "A".repeat(120);
  const page = await openScreen({
    routes: baseRoutes([
      { method: "GET", match: "^/api/clients$", status: 200,
        body: { clients: [{ id: A, name: long, updated_at: "", note_chars: 12, packs: 1 }] } },
      { method: "GET", match: `^/api/clients/${A}$`, status: 200,
        body: { client: { id: A, name: long, note: "note" } } },
    ]),
  }, { query: `?client=${A}`, viewport: 360 });
  await page.eval(SETTLE(300));

  const r = await page.eval(READ);
  check(
    "H6", "no horizontal page scroll at 360px with a 120-character unbroken client name",
    r.scrollWidth <= r.innerWidth,
    `viewport=${r.innerWidth}  scrollWidth=${r.scrollWidth}  ` +
      `overflow=${r.scrollWidth - r.innerWidth}  (name = "A" × 120)`,
  );
  await page.close();
}

async function probeM10() {
  // CRAFT.md: effective target >= 44x44px on touch, >= 24px minimum anywhere. app.css claimed
  // 44px in a comment while resolving --space-8, which is 32px.
  const page = await openScreen({ routes: baseRoutes() }, { query: `?client=${A}` });
  await page.eval(SETTLE(250));

  const sizes = await page.eval(`
    (function () {
      var h = function (sel) {
        var n = document.querySelector(sel);
        return n ? Math.round(n.getBoundingClientRect().height) : null;
      };
      return {
        save: h("#save-button"),
        add: h("#add-button"),
        radio: h('.radio-row label'),
      };
    })()`);
  check(
    "M10", "touch targets meet CRAFT's 44px floor",
    sizes.save >= 44 && sizes.add >= 44 && sizes.radio >= 44,
    `save=${sizes.save}px · add=${sizes.add}px · radio label=${sizes.radio}px (floor 44)`,
  );
  await page.close();
}

/* ── run ─────────────────────────────────────────────────────────────────────────────── */

const server = await serveStatic();
const chrome = await startChrome();
try {
  for (const probe of [probeH1, probeH2, probeH3add, probeH3back, probeM9,
                       probeM3, probeM4, probeM7, probeM8, probeM10, probeH6]) {
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
