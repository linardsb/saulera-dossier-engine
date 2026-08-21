/* The worked example (SHOWCASE BRANCH ONLY) — one button that fills the two input boxes.
 *
 * demo/lewis-showcase carries this so a first look at the tool does not stall on "I have no
 * brief to hand": press the button, the two boxes fill with an invented brief and CV for the
 * Manchester MSK client, and Generate is one click away. THE BUTTON ONLY FILLS THE BOXES.
 * The client row it picks, the model call, the quote checks and every provenance mark are the
 * product's own — nothing here touches the pipeline, so what the demo shows is what a real
 * pack does.
 *
 * Its own file for guide.js's three reasons: removal is deleting this file, one block and one
 * tag in index.html, and test/example.test.js; app.js's gates (one COPY object, storage and
 * network rules) stay untouched; and if this throws, the screen still works. It reads and
 * writes two textarea values and clicks one rail row. No storage, no cookie, no fetch — the
 * fixtures are the two constants below, shipped inline exactly as guide.js ships its cards.
 *
 * Both documents are invented. The brief is written as the trust's imaging directorate would
 * write a locum requirement; the CV as a real sonographer would paste hers. Every person and
 * number in them is made up, matched to the seeded Manchester client note so the pack's
 * "Our note" marks have something true to point at.
 *
 * A merge to main must not carry this file, the block and script tag in index.html, or
 * test/example.test.js.
 */

(function () {
  "use strict";

  // The seeded client this example belongs to. The note behind it (protocol expectations,
  // NHSP, credentialing) is what the pack's process-fit section draws on.
  var CLIENT_ID = "client-manchester-msk";

  var BRIEF = [
    "LOCUM REQUIREMENT - RADIOLOGY DIRECTORATE, ULTRASOUND",
    "Ref: RAD-2026-0834",
    "Post: Sonographer, Band 7 equivalent (MSK), agency locum",
    "Sessions: 3 sessions per week (Tuesday all day, Thursday AM), 12 weeks in the first instance",
    "Start: w/c 7 September 2026, subject to compliance clearance and local induction",
    "",
    "Background",
    "The directorate requires an experienced MSK sonographer to hold the shoulder and knee",
    "lists while the substantive post is out to advert. The post holder will run MSK",
    "ultrasound lists without direct supervision. Lists are templated at 12 to 14 patients",
    "per session at 20-minute intervals, with two urgent slots held each session for the",
    "consultant-led injection clinic.",
    "",
    "Reporting",
    "All examinations must be reported by the operator on the day of acquisition. Reports go",
    "on PACS through the departmental RIS templates. Unexpected significant findings are",
    "telephoned to the referrer and the call documented, in line with the local scheme of",
    "work. Participation in the monthly discrepancy meeting is expected for bookings that",
    "run beyond eight weeks.",
    "",
    "Essential",
    "- HCPC registration as a radiographer",
    "- CASE-accredited postgraduate qualification in medical ultrasound (PgC, PgD or MSc)",
    "- Recent MSK scanning across shoulder, elbow, wrist, hip, knee and ankle",
    "- Independent reporting of own MSK examinations",
    "- Experience scanning for ultrasound-guided injection lists",
    "- Enhanced DBS",
    "",
    "Desirable",
    "- Canon Aplio experience",
    "- General lists (abdominal, small parts) to cover leave",
    "",
    "Engagement",
    "Inside IR35, via framework agency only. The department does not pay for induction time",
    "beyond the first half-day. Rate to be agreed with the agency; the trust will not exceed",
    "the framework cap.",
    "",
    "Contact: bookings via the imaging service manager's office, not direct to the department."
  ].join("\n");

  var CV = [
    "Rebecca Shaw",
    "Sonographer (MSK and general)",
    "Stockport, Greater Manchester",
    "07700 900614 | r.shaw.sono@outlook.com",
    "HCPC Radiographer RA74921 | Society of Radiographers member, indemnity through membership",
    "",
    "Profile",
    "Sonographer with nine years in ultrasound, the last four mostly MSK. Runs her own lists",
    "and reports her own scans, and is comfortable as the only sonographer on site. Currently",
    "booked Mondays and Fridays at a community MSK service; available Tuesday to Thursday.",
    "",
    "Employment",
    "Jan 2023 to date - Locum sonographer, NHS trusts and community providers, North West",
    "- Solo MSK lists (shoulder, elbow, wrist, hip, knee, ankle and foot) with own reporting",
    "  on PACS the same day",
    "- Scanning operator for consultant-led ultrasound-guided injection lists, two sessions a",
    "  week through 2024 and 2025",
    "- General lists where booked: abdominal, renal, small parts, DVT",
    "- Machines: Canon Aplio i800, GE Logiq E10, Samsung RS85",
    "",
    "Jan 2022 to Dec 2022 - Senior sonographer, community diagnostic centre, Greater Manchester",
    "- Mixed MSK and general lists, 13 patients per list, own reporting through RIS templates",
    "- Ran the monthly discrepancy meeting for an ultrasound team of five",
    "",
    "Feb 2021 to Dec 2021 - Career break, family reasons",
    "- Returned through a supervised return-to-scanning plan agreed with the imaging lead,",
    "  signed back to full lists in six weeks",
    "",
    "Sep 2017 to Feb 2021 - Sonographer, acute trust, Merseyside",
    "- Trained in MSK from 2019 under a consultant radiologist while keeping general and DVT",
    "  lists",
    "- Personal audit of 200 shoulder scans against arthroscopy findings, presented at the",
    "  regional ultrasound group in 2020",
    "",
    "Aug 2015 to Sep 2017 - Radiographer (rotational), acute trust, Merseyside",
    "- General radiography and CT, IR(ME)R operator",
    "",
    "Qualifications",
    "- PgD Medical Ultrasound (CASE accredited), University of Salford, 2019",
    "- BSc (Hons) Diagnostic Radiography, Sheffield Hallam University, 2015",
    "",
    "Compliance",
    "- Enhanced DBS on the Update Service",
    "- Occupational health clearance and immunisations current, last checked March 2026",
    "- Mandatory training current to February 2027",
    "",
    "References: two clinical, most recent bookings, on request."
  ].join("\n");

  var button = document.getElementById("load-example");
  if (!button) return;

  button.addEventListener("click", function () {
    var brief = document.getElementById("brief");
    var cv = document.getElementById("cv");
    if (!brief || !cv) return;

    // Mid-pack the product freezes both boxes (app.js behaviour 4), and every phase past
    // act 1 holds them readOnly — so this check is also what keeps the rail click below from
    // ever reaching app.js's switch-client confirm. The example respects the freeze rather
    // than fighting it; Start again thaws the screen and the button works again.
    if (brief.readOnly || cv.readOnly) return;

    // Pick the client the example belongs to through its own rail row, so history, the
    // note behind the pack and every guard behave exactly as a real click. If the rail has
    // not painted yet the boxes still fill, and Generate answers with the product's own
    // "Pick a client first."
    var row = document.querySelector('.client-row[data-id="' + CLIENT_ID + '"]');
    if (row && row.getAttribute("aria-current") !== "true") row.click();

    brief.value = BRIEF;
    cv.value = CV;
  });
})();
