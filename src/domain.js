// The imaging-locum taxonomy, read deterministically (#46, epic #45 slice 1). No model in
// the loop: this profile decides whether the prompt gets the imaging domain block, and gives
// downstream slices (#48, #49, #50) a flag they can branch on without a model call.
//
// Pure on purpose — no imports at all, same discipline as src/note-fields.js — so it is
// testable in `node --test` and importable from src/prep/* and Functions alike.
//
// The lists are a starting taxonomy. Extending one (a new scanner make, a new locum
// indicator) is a one-line-plus-one-test change; nothing downstream re-runs the fragments,
// because only the assembled profile is exported.

/** The values pack.role_shape may take. pack.js imports and re-exports this. */
export const ROLE_SHAPES = ["locum", "permanent", "unknown"];

// Modalities (brief only). CT is case-sensitive: lowercase "ct" is not an English word,
// and case-insensitive \bct\b would still be safe — uppercase-only just documents intent.
const MODALITIES = [
  ["mri",        /\bMRI\b|magnetic resonance/i],
  ["ct",         /\bCT\b/],
  ["ct",         /computed tomography/i],
  ["ultrasound", /ultrasound|ultrasonograph|sonograph/i],
  // "US" as an abbreviation, case-sensitive. Known and accepted: "US" the country matches
  // too; these are UK-domestic clinical briefs, so it is documented rather than solved.
  ["ultrasound", /\bU\/?S\b/],
];

// Specialisms (brief only). "general" is guarded to an imaging noun within the same
// clause, because "East Grinstead General Hospital" must NOT read as a specialism.
const SPECIALISMS = [
  ["msk",       /\bMSK\b|musculoskeletal/i],
  ["obstetric", /obstetric|antenatal|f(?:o)?etal (?:anomaly|medicine|scan)/i],
  ["general",   /\bgeneral\b(?!\s+hospital\b|\s+infirmary\b)[^.\n]{0,40}(?:sonograph|ultrasound|abdominal|scan|list)/i],
  ["general",   /(?:sonograph\w*|ultrasound|abdominal)[^.\n]{0,40}\bgeneral\b(?!\s+hospital\b|\s+infirmary\b)/i],
  ["general",   /\bgeneral\b\s*(?:&|and)\s*msk/i],
];

// Scanner makes (brief + CV), lowercase slugs. GE is case-sensitive: "ge" is a syllable
// in half the dictionary.
const SCANNER_MAKES = [
  ["siemens",  /\bsiemens\b/i],   ["philips", /\bphilips\b/i],
  ["canon",    /\bcanon\b/i],     ["toshiba", /\btoshiba\b/i],
  ["hitachi",  /\bhitachi\b/i],   ["fujifilm", /fujifilm|\bfuji\b/i],
  ["esaote",   /\besaote\b/i],    ["samsung", /\bsamsung\b/i],
  ["mindray",  /\bmindray\b/i],   ["ge",      /\bGE\b/],
];

// Role shape (brief only). Locum wins when both classes hit — locum briefs routinely
// dangle "possibility of a permanent contract" (decision D3).
const LOCUM = [
  /\blocums?\b/i, /\bIR35\b/, /\bday rate\b/i,
  /£\s?\d+[^.\n]{0,15}per (?:day|hour)/i, /\btemp(?:orary)? cover\b/i,
];
const PERMANENT = [
  /\bpermanent\b/i, /\bperm\b/i, /\bsubstantive\b/i,
  // "p.a." needs the lookahead, not \b: after a literal "." a \b would demand a word
  // character next, so "£38k p.a. plus benefits" would never match.
  /per annum|\bp\.a\.(?!\w)|annual salary/i,
];

// imaging: any modality or specialism hit, or an imaging-department term in the brief.
const IMAGING_CONTEXT = /radiograph|sonograph|imaging department|\bPACS\b|\bRIS\b/i;

/** The slugs whose patterns hit `text`, deduped, in list order. */
const hits = (pairs, text) => [
  ...new Set(pairs.filter(([, re]) => re.test(text)).map(([slug]) => slug)),
];

/**
 * The deterministic read of a brief (and CV, for scanner makes only — a make on the CV that
 * the brief does not name is still evidence worth surfacing).
 *
 * Never throws: a brief is whatever the recruiter pasted, and this runs on the prompt-build
 * path, where a throw would be a 500 in front of a recruiter.
 *
 * @returns {{ imaging: boolean, role_shape: "locum"|"permanent"|"unknown",
 *             modalities: string[], specialisms: string[], scanner_makes: string[] }}
 */
export function briefProfile(brief, cv = "") {
  const briefText = String(brief ?? "");
  const cvText = String(cv ?? "");

  const modalities = hits(MODALITIES, briefText);
  const specialisms = hits(SPECIALISMS, briefText);
  const scanner_makes = hits(SCANNER_MAKES, briefText + "\n" + cvText);

  const role_shape = LOCUM.some((re) => re.test(briefText))
    ? "locum"
    : PERMANENT.some((re) => re.test(briefText))
      ? "permanent"
      : "unknown";

  return {
    imaging:
      modalities.length > 0 || specialisms.length > 0 || IMAGING_CONTEXT.test(briefText),
    role_shape,
    modalities,
    specialisms,
    scanner_makes,
  };
}
