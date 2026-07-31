// src/prompt.js — the paste-prompt builder and the input guard (#6 as amended).
//
// Two jobs. The first is a REGRESSION PIN: buildMessages was refactored to share its two block
// strings with the paste path, and its output has to be byte-identical to what the spike timed
// and reviewed. A refactor that quietly reworded the API prompt would invalidate the only
// evidence we have that the prompt works, and nothing else in the suite would notice.
//
// The second is that the paste prompt carries everything the API path carried as configuration:
// the note, the inputs, and the schema — which travels as text now, because a chat session has
// no output_config.format. It asserts the properties, not the prose.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  INPUT_MAX,
  OUTPUT_INSTRUCTION,
  SYSTEM,
  buildMessages,
  buildPastePrompt,
  cleanInput,
  domainBlock,
  inputsBlock,
  noteBlock,
} from "../src/prompt.js";
import { briefProfile } from "../src/domain.js";
import { PACK_SCHEMA, assertPack } from "../src/pack.js";
import { extractPack } from "../src/paste.js";
import { StoreError } from "../src/store.js";

const INPUTS = {
  clientName: "Ashdown Park Community Healthcare",
  clientNote: "## Their process\n\nTwo stages. Kate Nwosu chairs the panel.",
  brief: "Band 6 community nurse. Must hold a current NMC pin.",
  cv: "Registered nurse. NMC registration current to Mar 2027.",
};

/** The error code a call throws, or "did not throw". store.test.js's helper. */
function codeOf(fn) {
  try {
    fn();
    return "did not throw";
  } catch (err) {
    assert.ok(err instanceof StoreError, `expected a StoreError, got ${err}`);
    return err.code;
  }
}

// ── the regression pin ─────────────────────────────────────────────────────────────────

test("buildMessages is byte-identical to the shape the spike validated", () => {
  const [message] = buildMessages(INPUTS);

  assert.equal(message.role, "user");
  assert.equal(message.content.length, 2);

  assert.equal(
    message.content[0].text,
    "Here is what our agency knows about Ashdown Park Community Healthcare, from our own " +
      "notes:\n\n<client_note>\n## Their process\n\nTwo stages. Kate Nwosu chairs the panel." +
      "\n</client_note>",
  );
  assert.equal(
    message.content[1].text,
    "Here is the client's brief:\n\n<brief>\nBand 6 community nurse. Must hold a current NMC " +
      "pin.\n</brief>\n\nHere is the candidate's CV:\n\n<cv>\nRegistered nurse. NMC " +
      "registration current to Mar 2027.\n</cv>\n\nWrite the submission pack.",
  );
});

test("the cache breakpoint is still on the client note and only there", () => {
  // The note is the one input reused across every pack for the same client. If the breakpoint
  // moved to the second block the prefix would change per submission and cache nothing.
  const [message] = buildMessages(INPUTS);
  assert.deepEqual(message.content[0].cache_control, { type: "ephemeral" });
  assert.equal(message.content[1].cache_control, undefined);
});

test("both shapes are built from the same blocks, so they cannot drift", () => {
  const [message] = buildMessages(INPUTS);
  const prompt = buildPastePrompt(INPUTS);
  assert.ok(prompt.includes(message.content[0].text), "the note block differs between shapes");
  assert.ok(prompt.includes(message.content[1].text), "the inputs block differs between shapes");
});

// ── the paste prompt ───────────────────────────────────────────────────────────────────

test("the paste prompt carries SYSTEM verbatim", () => {
  // SYSTEM was validated against a real pack under timing (#2). A paste path that paraphrased
  // it would be a different prompt with the same name.
  assert.ok(buildPastePrompt(INPUTS).includes(SYSTEM));
});

test("the paste prompt carries the client name, the note, the brief and the CV", () => {
  const prompt = buildPastePrompt(INPUTS);
  for (const value of Object.values(INPUTS)) {
    assert.ok(prompt.includes(value), `the prompt is missing ${JSON.stringify(value)}`);
  }
});

test("the note comes before the brief and the CV", () => {
  // The reason the API path cached it first is also the reason a reader meets it first: it is
  // the lens the brief and the CV are read through.
  const prompt = buildPastePrompt(INPUTS);
  assert.ok(prompt.indexOf(INPUTS.clientNote) < prompt.indexOf(INPUTS.brief));
  assert.ok(prompt.indexOf(INPUTS.clientNote) < prompt.indexOf(INPUTS.cv));
});

test("SYSTEM comes before everything", () => {
  const prompt = buildPastePrompt(INPUTS);
  assert.ok(prompt.startsWith(SYSTEM));
});

test("the prompt asks for one JSON object in a fenced block", () => {
  const prompt = buildPastePrompt(INPUTS);
  assert.match(prompt, /Return ONE JSON object and nothing else/);
  assert.match(prompt, /```json/);
});

test("the whole schema travels, descriptions included", () => {
  const prompt = buildPastePrompt(INPUTS);
  assert.ok(
    prompt.includes(JSON.stringify(PACK_SCHEMA, null, 2)),
    "the schema must reach the model as text, since a chat session has no output_config.format",
  );
  // The one description that is not documentation. It is the verbatim-quote rule, and the
  // entire provenance mechanism is downstream of the model having read it.
  assert.match(prompt, /VERBATIM span copied character-for-character/);
});

test("the output instruction closes the prompt", () => {
  assert.ok(buildPastePrompt(INPUTS).endsWith(OUTPUT_INSTRUCTION));
});

test("a missing field builds a prompt rather than throwing 'undefined' into it", () => {
  // Validation is cleanInput's job and the Function's ordering. This one only has to not put
  // the string "undefined" in front of the model.
  const prompt = buildPastePrompt({});
  assert.doesNotMatch(prompt, /undefined/);
  assert.doesNotMatch(prompt, /\[object Object\]/);
});

test("the two blocks are the only place the wording lives", () => {
  assert.equal(noteBlock("X", "Y"), "Here is what our agency knows about X, from our own " +
    "notes:\n\n<client_note>\nY\n</client_note>");
  assert.match(inputsBlock("B", "C"), /^Here is the client's brief:/);
  assert.match(inputsBlock("B", "C"), /Write the submission pack\.$/);
});

// ── the imaging domain block (#46) ─────────────────────────────────────────────────────

const IMAGING_INPUTS = {
  clientName: "East Sussex Imaging",
  clientNote: "## Their process\n\nInformal call with the modality lead.",
  brief:
    "Locum MRI/CT Radiographer. Siemens Aera and Vida plus Canon CT and one GE MRI. " +
    "HCPC registration essential. Day rate DOE.",
  cv:
    "HCPC-registered Diagnostic Radiographer, 8 years. Siemens and GE MRI; Canon CT. " +
    "IV cannulation certified.",
};

test("an imaging brief's paste prompt carries HCPC and the never-NMC instruction", () => {
  const prompt = buildPastePrompt(IMAGING_INPUTS);
  assert.match(prompt, /HCPC \(Health and Care Professions Council\)/);
  assert.match(prompt, /Never write about NMC registration/);
});

test("the domain block rides the second content item; the cached note block is untouched", () => {
  // The cache-prefix pin: system + note is the byte-identical prefix. A brief-dependent
  // string in content[0] would fork the prefix per submission and cache nothing.
  const [message] = buildMessages(IMAGING_INPUTS);
  assert.equal(
    message.content[0].text,
    noteBlock(IMAGING_INPUTS.clientName, IMAGING_INPUTS.clientNote),
  );
  assert.deepEqual(message.content[0].cache_control, { type: "ephemeral" });
  assert.match(message.content[1].text, /HCPC/);
});

test("the locum bullet appears for a locum brief and not for a permanent one", () => {
  const locum = domainBlock(briefProfile(IMAGING_INPUTS.brief, IMAGING_INPUTS.cv));
  assert.match(locum, /a locum booking, not a permanent hire/);

  const permanent = domainBlock(
    briefProfile("Permanent Band 7 MRI Radiographer, salary per annum. HCPC essential."),
  );
  assert.match(permanent, /HCPC/);
  assert.doesNotMatch(permanent, /locum booking/);
});

test("the domain block is empty for the nursing inputs, so the perm prompt is unchanged", () => {
  assert.equal(domainBlock(briefProfile(INPUTS.brief, INPUTS.cv)), "");
  assert.doesNotMatch(buildPastePrompt(INPUTS), /HCPC/);
});

test("both shapes carry the same domain text, so they cannot drift", () => {
  const [message] = buildMessages(IMAGING_INPUTS);
  const prompt = buildPastePrompt(IMAGING_INPUTS);
  assert.ok(prompt.includes(message.content[1].text), "the domain+inputs block differs");
});

// ── the input guard ────────────────────────────────────────────────────────────────────

test("cleanInput rejects empty, whitespace-only, null and undefined", () => {
  for (const value of ["", "   ", "\n\t ", null, undefined]) {
    assert.equal(codeOf(() => cleanInput(value, "cv")), "missing_fields", `for ${value}`);
  }
});

test("cleanInput rejects one character over INPUT_MAX", () => {
  assert.equal(codeOf(() => cleanInput("x".repeat(INPUT_MAX + 1), "brief")), "too_long");
});

test("cleanInput accepts exactly INPUT_MAX", () => {
  const exact = "x".repeat(INPUT_MAX);
  assert.equal(cleanInput(exact, "brief").length, INPUT_MAX);
});

test("cleanInput trims, and the length rule applies to the trimmed value", () => {
  assert.equal(cleanInput("  a CV  ", "cv"), "a CV");
  // Padding is not content: INPUT_MAX characters wrapped in whitespace is still a valid paste.
  assert.doesNotThrow(() => cleanInput("\n\n" + "x".repeat(INPUT_MAX) + "\n\n", "cv"));
});

test("the message names the field and never carries the value", () => {
  try {
    cleanInput("Sister Aoife Brennan, NMC 12A3456B".repeat(5000), "cv");
    assert.fail("should have thrown");
  } catch (err) {
    assert.match(err.message, /^cv: /);
    assert.doesNotMatch(err.message, /Aoife|Brennan|12A3456B/);
  }
});

// ── the round trip ─────────────────────────────────────────────────────────────────────

test("the schema asked for is the schema that comes back parseable", () => {
  // A minimal reply in exactly the shape the prompt requests. If the instruction and the
  // extractor ever disagree about fencing, this is where it shows.
  const pack = {
    candidate_ref: "Candidate A",
    role_title: "Band 6 Community Nurse",
    headline: "A registered nurse with a current pin.",
    evidence: [
      {
        requirement: "Current NMC pin",
        text: "Holds a current NMC registration.",
        source_quote: "NMC registration current to Mar 2027",
        source_type: "cv",
      },
    ],
    process_fit: [],
    gaps: [],
    open_questions: ["Confirm availability."],
  };
  const reply = "Here is the pack.\n\n```json\n" + JSON.stringify(pack, null, 2) + "\n```";

  assert.doesNotThrow(() => assertPack(extractPack(reply)));
  assert.deepEqual(assertPack(extractPack(reply)), pack);
});
