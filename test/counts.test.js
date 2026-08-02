// #22 AC #4 — the counts page reads two aggregate endpoints and nothing else.
//
// This is a SOURCE SCAN, not a render test, and the difference is the whole point. A page can
// display exactly the right two numbers today and be one `fetch` away from not doing so: the
// constraint decision 3 actually imposes is on what this file is ALLOWED TO ASK FOR, and that
// is a property of the source text rather than of any particular render.
//
// The precedent is test/prep-registry.test.js's group 2, which scans public/prep/*.js for HTML
// sinks and storage APIs for the same reason.
//
// Why it can be this strict: neither permitted endpoint CAN return per-candidate data.
// `eventCounts` selects client_id and three COUNT()s (src/store.js:524-534) and `listClients`
// selects no portal column at all. So "reads only these two" really does mean "cannot learn
// anything about a candidate", rather than merely "does not today".

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "public", "counts.js"), "utf8");
const markup = readFileSync(join(here, "..", "public", "counts.html"), "utf8");

/** Every string literal that looks like a path this file might request. */
const requestedPaths = [...source.matchAll(/api\(\s*"([^"]+)"/g)].map((m) => m[1]);

test("counts.js requests exactly the two aggregate endpoints", () => {
  assert.deepEqual(requestedPaths.sort(), ["/api/clients", "/api/events"]);
});

test("counts.js issues no fetch outside its own api() helper", () => {
  // One `fetch(` — the one inside api(). A second would be a request the assertion above
  // cannot see, which is the only way this file could grow a third source quietly.
  const fetches = source.match(/\bfetch\s*\(/g) ?? [];
  assert.equal(fetches.length, 1, "exactly one fetch, and it is the api() helper's");
});

test("AC #4: counts.js names no per-candidate table or field", () => {
  // Decision 3: sent and opened only. Delivery telemetry, never behaviour. Each of these is a
  // thing a well-meaning "it would be useful to see…" change would reach for first.
  //
  // Scoped OUTSIDE the COPY object, because COPY is prose for a recruiter and prose may
  // legitimately contain these words — "they will get an email" is a sentence this screen
  // could reasonably want. The constraint is on the CODE: what this file reads and renders.
  // A gate that fails on a correct sentence gets deleted, which would cost the real check.
  const copyStart = source.indexOf("var COPY = {");
  const copyEnd = source.indexOf("\n  };", copyStart);
  const code = source.slice(0, copyStart) + source.slice(copyEnd);

  for (const forbidden of ["attempt", "habit", "invite_id", "email", "competency", "question", "brief_json"]) {
    assert.ok(
      !new RegExp(forbidden, "i").test(code),
      `counts.js reads or renders ${forbidden}, which is not delivery telemetry`,
    );
  }
});

test("counts.js parses no HTML and reaches no browser storage", () => {
  for (const sink of ["innerHTML", "outerHTML", "insertAdjacentHTML", "document.write"]) {
    assert.ok(!source.includes(sink), `counts.js uses ${sink}`);
  }
  for (const store of ["localStorage", "sessionStorage", "indexedDB", "document.cookie"]) {
    assert.ok(!source.includes(store), `counts.js reaches ${store}`);
  }
});

test("the counts page states the claim and its bound in the same breath", () => {
  // Decision 23 is a PROCESS claim, and the sentence that makes it honest is the one saying
  // what it is not. A page that dropped the second half would be selling something else.
  //
  // Matched on whitespace-collapsed markup: the sentence wraps across source lines, and an
  // exact-indentation assertion would fail the next time anyone reflows the paragraph — a
  // failure about formatting wearing the costume of a failure about honesty.
  const text = markup.replace(/\s+/g, " ");
  assert.ok(text.includes("how many opened it"), "the claim");
  assert.ok(text.includes("Nothing about what any candidate did."), "and its bound");
});

// ── the locum checklist on /clients (#48) — same source-scan idiom ──────────────────────

const clientsSource = readFileSync(join(here, "..", "public", "clients.js"), "utf8");
const clientsMarkup = readFileSync(join(here, "..", "public", "clients.html"), "utf8");

test("clients.html carries the locum checklist and names all five fields in the scaffold", () => {
  assert.ok(clientsMarkup.includes('id="locum-list"'), "the checklist's list element");
  const text = clientsMarkup.replace(/\s+/g, " ");
  for (const phrase of [
    "credentialing quirks",
    "VMS or portal",
    "protocol expectations",
    "site access and parking",
    "extension habits",
  ]) {
    assert.ok(text.includes(phrase), `the locum scaffold line is missing "${phrase}"`);
  }
});

test("clients.js renders the locum readout, parses no HTML and reaches no browser storage", () => {
  assert.ok(clientsSource.includes("locum_fields"), "the checklist paints from the API readout");
  // Matched with the leading dot, unlike the counts.js gate above: clients.js's comments
  // legitimately say "never innerHTML", and a gate that cries wolf at a comment gets deleted.
  // Every real sink use is a property access, and comments never spell the dotted form.
  for (const sink of [".innerHTML", ".outerHTML", ".insertAdjacentHTML", "document.write"]) {
    assert.ok(!clientsSource.includes(sink), `clients.js uses ${sink}`);
  }
  for (const store of ["localStorage", "sessionStorage", "indexedDB", "document.cookie"]) {
    assert.ok(!clientsSource.includes(store), `clients.js reaches ${store}`);
  }
  // Inserting into an empty note must not open with blank lines: the separator is conditional
  // on there being content to separate from.
  assert.ok(
    clientsSource.includes('(el.note.value ? "\\n\\n" : "")'),
    "the heading insert prepends its separator only when the note already has content",
  );
});

test("all three screens carry the same three-link nav", () => {
  // The bar is what says the screens are one tool (index.html's own comment). A screen that
  // gained a link and left the others behind is how that stops being true.
  for (const file of ["index.html", "clients.html", "counts.html"]) {
    const html = readFileSync(join(here, "..", "public", file), "utf8");
    for (const href of ['href="/"', 'href="/clients"', 'href="/counts"']) {
      assert.ok(html.includes(href), `${file} is missing ${href}`);
    }
    // Linked as /counts, matching the two existing links — Pages' built-in HTML handling is
    // what already serves clients.html at /clients, and this is the identical mechanism.
    assert.ok(!html.includes('href="/counts.html"'), `${file} links the .html form`);
  }
});
