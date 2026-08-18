// The prep-brief prompt (#19). One shape only — the API shape — because portal architecture §5
// puts the Send call server-side behind the per-agency ANTHROPIC_API_KEY. There is no paste path
// here, and no OUTPUT_INSTRUCTION: the contract travels as output_config.format, not as text.
//
// What this file has to get right that src/prompt.js did not: everything it renders has ALREADY
// been filtered by #18's visibleFields(). The client note is the agency's privileged knowledge
// and most of it must never reach a candidate — who was turned down last time, what the hiring
// manager really thinks. The recruiter ticks section by section, and this module renders the
// ticked sections and nothing else. It never reads `client.note`. If a future change makes it
// want to, the design has drifted — the filter is the seam, and reaching past it is the leak.
//
// The visible slice is also the cached prefix: it is the one input reused across every candidate
// for the same client, while the brief, the CV and the interview date vary per candidate.

// No imports. The input guard is `cleanInput` from src/prompt.js and it runs exactly once, in
// generateBrief — the same place generatePack runs it. Guarding in both would be a second
// definition of what a valid input is, which is how the two drift.

export const PREP_SYSTEM = `You write interview preparation for a candidate a recruitment agency has
already submitted to a client. The client has offered them an interview. Your reader is that
candidate, not the recruiter and not the client.

The agency's advantage is that it knows this client: how the stages actually run, what the panel
is listening for, why other candidates came unstuck. Some of that has been marked shareable with
the candidate and given to you below. It is the most valuable input you have. Use it.

Rules, in order of importance:

1. NEVER write the candidate's answer in their voice. Not a model answer, not a polished
   paragraph they could read out, not a "you could say something like…". A polished answer they
   cannot deliver is worse than a rough one they own, because interviewers hear the seam. What
   you may offer instead: a skeleton of HEADINGS they fill in themselves, a worked example from a
   DIFFERENT scenario than the one they will be asked about, and questions that unstick them.

2. NEVER coach fabrication. Not experience they do not have, not enthusiasm for values they do
   not hold. Help them find and evidence genuine overlap, and name a genuine mismatch plainly —
   that is useful information for the candidate, not a failure.

3. Competencies come from the CLIENT BRIEF, and each carries a VERBATIM span copied
   character-for-character out of it. Do not paraphrase, summarise, or tidy the span, and do not
   quote the CV — competencies are what the role demands, not what the candidate has. A
   deterministic check runs after you: it searches for your quote in the brief, and a quote not
   found literally is marked unverified and the recruiter sees that it failed. Paraphrasing a
   quote is the single worst thing you can do here.

4. NEVER score, rank, or rate the candidate, and never predict whether they will get the job. No
   readiness level, no percentage, no verdict. You do not know, and saying so is not modesty —
   a tool that implies it can tell them is lying to someone about their own livelihood.

5. Address the candidate as someone preparing, never as someone being evaluated. Specific over
   kind, but never a bare verdict. No streaks, no goals, no encouragement they did not earn — the
   interview date is already supplying the pressure.

6. Everything you were given about this client has already been filtered to what the recruiter
   marked shareable. Do not speculate past it, and do not fill a gap with what a company like
   this one usually does. If the material does not say, say it does not say. When you attribute
   something to the client knowledge, name the field it came from.

7. Name the objections this interviewer is most likely to raise, in a LikelyConcerns block.
   Derive each one from the GAP between the candidate's CV and the client brief — a first post
   of this kind, unfamiliar kit, a gap in the record — and put it as an interviewer would put
   it: about the record, never about the person. The evidence for each concern is a VERBATIM
   span of THEIR CV and never a sentence of your own. If their material holds no genuine
   counter, leave the quote EMPTY and write nothing further: the page has its own reviewed
   words for that, and inventing a counter is rule 2 broken where it does the most damage,
   because they will rehearse it and an interviewer who probes will hear the seam. Every
   concern also gets at least one question of type "concern" against the SAME competency, and
   every one of those is difficulty "probing" — a counter is not the first thing you put in
   front of someone, it is what they come to once they have had a win.

8. Give the candidate a short QuestionsToAsk block: questions they could ask the interviewer,
   drawn from the brief and the client knowledge above and specific to THIS role and THIS
   client. Raw material for their own, never a script — a memorised question sounds memorised
   too. Never one whose answer is already in the brief, and never one that would reveal what
   the agency knows privately.

In a clinical staffing context these are not stylistic preferences. A candidate who walks into a
room having rehearsed a fabricated answer, or having been told they are ready when nobody can
know that, is carrying our mistake into their own interview.`;

// Headings are recruiter-written markdown H2s, so a quotation mark in one is ordinary prose —
// `## What they mean by "autonomy"` closes the attribute early and malforms the field. Not a
// security boundary (the note is the agency's own text), but this block IS the cached prefix, and
// it has to be well-formed and byte-stable across every candidate for that client.
const attr = (s) => String(s ?? "").replaceAll('"', "&quot;");

/**
 * The privileged half, already filtered: what this agency knows about this client that the
 * candidate is allowed to see.
 *
 * `fields` is #18's `visibleFields(note, visibleKeys)` return value —
 * `Array<{ key, heading, level, text, chars }>`. The `key` rides along on each field so the
 * model can name it in `PanelBrief.panel[].source_field_key` and `verifyBrief` can check it
 * against the keys actually handed in. That is architecture §3's provenance mechanism applied to
 * the note half; the competency quotes cover the brief half.
 *
 * Iterated exactly as given — never sorted, deduped or re-keyed. #18 returns fields in note
 * order, which is stable across saves; anything derived here would make the cached prefix unstable
 * and it would silently stop caching rather than erroring.
 */
export const visibleNoteBlock = (clientName, fields = []) =>
  `Here is what our agency knows about ${clientName} that the recruiter has marked shareable ` +
  `with this candidate:\n\n<client_knowledge>\n` +
  fields
    .map((f) => `<field key="${f.key}" heading="${attr(f.heading)}">\n${f.text}\n</field>`)
    .join("\n\n") +
  `\n</client_knowledge>`;

/**
 * The engagement branch (#50), rendered per candidate and therefore strictly AFTER the cache
 * breakpoint — src/domain.js's deterministic read decides it, never the model. PREP_SYSTEM must
 * not carry any of this: it sits inside the cached prefix and may only gain unconditional text.
 */
const engagementBlock = (engagement) =>
  engagement === "locum"
    ? "This is a locum booking, not an interview process: there is usually no panel — an " +
      "informal call with the manager at most. Keep the question bank " +
      'slim: mostly type "client" questions drawn from what this manager tends to probe, a few ' +
      'type "competency" questions phrased to verify experience rather than teach it ("Which ' +
      'scanners have you run solo?"), one or two type "screening" questions on availability, ' +
      "rate and compliance logistics, and the concern counters rule 7 asks for, which are type " +
      '"concern" — a booking has its own likely concerns, unfamiliar kit and a site this ' +
      "candidate has not worked. Never generic clinical coaching — the " +
      "reader is an expert, and this page only tells them what the agency knows that they " +
      "cannot.\n\n"
    : 'This is not a locum booking: give every question type "competency" — except the concern ' +
      'counters rule 7 asks for, which are type "concern".\n\n';

/**
 * The second call's closing instruction, and the competencies it has to reference.
 *
 * These three surfaces cannot ride the first call: six block variants is a 400 under the
 * thinking mode this product uses, and `src/prep/schema.js`'s CALL_ONE_BLOCK_NAMES carries the
 * measurements. The call is SECOND rather than concurrent because every concern names a
 * `competency_id`, and those ids do not exist until the first call has answered — so the first
 * call's competencies are handed back in, as the ids-and-labels the model must choose from.
 *
 * It appends to the SAME per-candidate block, after the cache breakpoint, so the expensive prefix
 * (PREP_SYSTEM plus the visible slice) is a cache READ on this call rather than a second write.
 *
 * The first-day paragraph is CONDITIONAL on the engagement and appears only for a locum booking
 * — the same branch `engagementBlock` makes, in the same place relative to the breakpoint, and
 * for the same reason: this text is per-candidate and must never reach the cached prefix.
 */
export const concernsTaskBlock = (competencies = [], engagement) =>
  `Now write the remaining parts of this same brief, and nothing else.\n\n` +
  `These are the competencies you just extracted. Every concern and every counter question must ` +
  `name one of these ids exactly:\n\n<competencies>\n` +
  competencies.map((c) => `<competency id="${attr(c?.id)}">${c?.label ?? ""}</competency>`).join("\n") +
  `\n</competencies>\n\n` +
  `Rule 7's likely concerns, with a counter question for each, and rule 8's questions to ask ` +
  `them. Both rules apply exactly as stated above — in particular, a concern whose counter is ` +
  `not literally in the CV gets an EMPTY evidence_quote rather than a sentence of yours.\n\n` +
  (engagement === "locum"
    ? "This is a locum booking, so also fill first_day_items from the client knowledge above: " +
      "how to get in on day one, the scanner fleet and its protocols, PACS and RIS, who to " +
      "report to. Each item names the field it came from, exactly as the panel does. If the " +
      "client knowledge holds nothing practical, return an EMPTY list — an empty block is worse " +
      "than an absent one, and an empty list is how you say there is nothing to say here."
    : "This is not a locum booking, so first_day_items is an EMPTY list and first_day_intro is " +
      "an empty string. Do not invent a first day for a permanent role.");

/** The per-candidate half, and the instruction that closes the prompt. */
export const prepInputsBlock = ({ brief, cv, interviewAt, engagement, task }) =>
  `Here is the client's brief for the role:\n\n<brief>\n${brief}\n</brief>\n\n` +
  `Here is the candidate's CV:\n\n<cv>\n${cv}\n</cv>\n\n` +
  `The interview is on ${interviewAt}.\n\n` +
  engagementBlock(engagement) +
  (task ?? `Compose the candidate's prep brief.`);

/**
 * The visible slice goes FIRST and is the cache breakpoint: it is the one input reused across
 * every candidate for the same client, and the prefix has to be byte-identical for a cache read.
 * The brief, the CV, the date and the engagement branch vary per candidate and therefore come
 * after it.
 */
export function buildPrepMessages({ clientName, visibleFields, brief, cv, interviewAt, engagement, task }) {
  return [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: visibleNoteBlock(clientName, visibleFields),
          cache_control: { type: "ephemeral" },
        },
        {
          type: "text",
          // `task` swaps only the CLOSING instruction, which sits after the breakpoint — so #79's
          // second call reads the same cached prefix rather than writing a second one. It is a
          // choice between instructions this file already holds, never a channel a caller can
          // put text through: nothing here interpolates it into the note or the inputs.
          text: prepInputsBlock({ brief, cv, interviewAt, engagement, task }),
        },
      ],
    },
  ];
}
