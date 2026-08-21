-- Client knowledge notes for the four TTR-board clients that had none (demo/lewis-showcase,
-- D1 database dossier-engine-preview). Companion to seed-lewis-demo.sql, same rules: DATA ONLY,
-- a one-shot record written 21 Aug 2026, not an idempotent fixture. Run from the repo root:
--
--   npx wrangler d1 execute dossier-engine-preview --remote --file scripts/seed-lewis-demo-notes.sql
--
-- Each note mirrors the shape its production writer would leave: updateClient saves the whole
-- note into clients.note (markdown, '## ' headings are the tickable sections) and stamps
-- updated_at; setFieldVisibility writes one note_visibility row per ticked heading, field_key
-- derived by src/note-fields.js's fieldKey() — the keys below were generated THROUGH that
-- function, not typed by hand. created_at on note_visibility keeps its DDL default, exactly as
-- the store leaves it. Every client keeps ticked AND unticked sections, because the sharing
-- gate is only demonstrable when both exist.
--
-- The East Sussex note (client-demo, 1,649 chars) is deliberately not touched.
-- Every person named is invented.

-- Imaging provider — Surrey (obstetric ultrasound): 972 chars, 5 sections (their-process, lists-and-reporting, chaperone-policy, site-access-and-parking, extension-habits); ticked: lists-and-reporting, site-access-and-parking.
UPDATE clients SET note = '## Their process
No interview as such. Fiona Marsh, clinical services manager, reads the CV then rings the candidate for ten minutes, mostly to hear how they talk to anxious patients. She has turned people down on that call alone. Confirmation usually next working day.

## Lists and reporting
Community obstetric lists, mostly dating and growth scans. 20-minute slots, 14 to a list. The sonographer writes their own report in Viewpoint before the woman leaves. Anomaly scans stay with the two permanent staff, so a locum is not walking into FASP audit in week one.

## Chaperone policy
Chaperone offered on every scan and the offer documented either way. A CQC action in 2024 made them strict about it.

## Site access and parking
Free parking behind the clinic. First morning, ask reception for Fiona; the badge takes five minutes.

## Extension habits
Rolling four-week extensions decided in the final week. They pay above framework and expect Saturday cover in return.',
  updated_at = '2026-08-14 09:31:22' WHERE id = 'client-surrey-obs';
INSERT OR IGNORE INTO note_visibility (client_id, field_key) VALUES ('client-surrey-obs', 'lists-and-reporting');
INSERT OR IGNORE INTO note_visibility (client_id, field_key) VALUES ('client-surrey-obs', 'site-access-and-parking');

-- NHS trust — Manchester (MSK ultrasound): 1080 chars, 5 sections (their-process, protocol-expectations, vms-or-portal, credentialing-quirks, extension-habits); ticked: protocol-expectations, credentialing-quirks.
UPDATE clients SET note = '## Their process
Submissions go to Raj Chauhan, superintendent sonographer. He books a 20-minute Teams call inside the week and asks the same two things: which MSK lists the candidate has run alone, and what they do when the scan does not match the request card. No panel for locum bookings.

## Protocol expectations
Shoulder and knee lists run alongside Dr Emmott''s injection clinic, and the locum reports their own scans on PACS the same day. Canon Aplio i800 in both rooms. Department protocol book, not what the last hospital did. 12 to 14 patients a list in 20-minute slots.

## VMS or portal
NHSP first; agency release lands Thursday afternoon. Timesheets go through the NHSP portal weekly and Raj authorises them on Mondays.

## Credentialing quirks
ID is re-checked at imaging reception on day one, so the badge eats the first morning. DBS on the Update Service or issued inside the last twelve months, or the start date moves.

## Extension habits
First booking is always six weeks. If the reporting holds up they extend in twelve-week blocks without reopening the rate.',
  updated_at = '2026-08-17 16:12:48' WHERE id = 'client-manchester-msk';
INSERT OR IGNORE INTO note_visibility (client_id, field_key) VALUES ('client-manchester-msk', 'protocol-expectations');
INSERT OR IGNORE INTO note_visibility (client_id, field_key) VALUES ('client-manchester-msk', 'credentialing-quirks');

-- NHS trust — Peterborough & Cambridge (ultrasound): 951 chars, 4 sections (their-process, protocol-expectations, site-access-and-parking, extension-habits); ticked: protocol-expectations, site-access-and-parking.
UPDATE clients SET note = '## Their process
Everything goes through Marta Wilcox, lead sonographer, who is off Wednesdays. She wants the CV plus a scope-of-practice list and only calls if something on it worries her. Slowest of our trusts to confirm; allow a week and chase on the Friday.

## Protocol expectations
General lists across two sites 40 minutes apart: abdo, small parts, DVT and renal, obstetrics at the Peterborough end only. 16 patients a list with two urgent slots held back. Own reporting through voice recognition, and a sample of locum reports is audited monthly.

## Site access and parking
The badge office needs two weeks'' notice. Book it the day the booking confirms or the start date slips. Parking is fine at Peterborough; at the Cambridgeshire site use the park and ride, the staff permit list has a two-year wait.

## Extension habits
When they like someone they block-book to the end of the financial year, and they say so in week three or not at all.',
  updated_at = '2026-08-11 08:57:03' WHERE id = 'client-cambs-us';
INSERT OR IGNORE INTO note_visibility (client_id, field_key) VALUES ('client-cambs-us', 'protocol-expectations');
INSERT OR IGNORE INTO note_visibility (client_id, field_key) VALUES ('client-cambs-us', 'site-access-and-parking');

-- Private clinic — London (permanent physiotherapy): 998 chars, 4 sections (their-process, who-sits-on-the-panel, what-each-stage-tests, why-people-get-turned-down); ticked: their-process, what-each-stage-tests.
UPDATE clients SET note = '## Their process
Three stages and slow. A phone screen with Anita, the practice manager, then an hour with the panel, then a working session where the candidate assesses a shoulder patient with the lead physio watching. Four to six weeks start to finish; warn candidates or they drop out in the middle.

## Who sits on the panel
Daniel Rees, clinic director, and Sophie Tan, lead physio, with Anita taking notes. Daniel decides. Sophie can veto on clinical grounds and has done, twice.

## What each stage tests
The screen tests commitment to private practice, not skills. The panel digs into caseload numbers and rebooking rates. The working session decides it: they watch the candidate explain a treatment plan to someone who is paying for it.

## Why people get turned down
Three in two years. One talked in NHS terms the whole way through. One could not name their own rebooking rate. One asked about cutting hours in the first month. All three read to Daniel as not serious about private work.',
  updated_at = '2026-08-15 14:24:36' WHERE id = 'client-london-physio';
INSERT OR IGNORE INTO note_visibility (client_id, field_key) VALUES ('client-london-physio', 'their-process');
INSERT OR IGNORE INTO note_visibility (client_id, field_key) VALUES ('client-london-physio', 'what-each-stage-tests');

