-- Seed for the Louis demo preview (demo/louis-showcase, D1 database dossier-engine-preview).
-- DATA ONLY, no schema. Run from the repo root:
--
--   npx wrangler d1 execute dossier-engine-preview --remote --file scripts/seed-louis-demo.sql
--
-- Written 21 Aug 2026 against that day's state of the preview database; it is a one-shot
-- record, not an idempotent fixture. It assumes the five TTR-board clients, the `inv-demo`
-- invite, `role-demo` and its three competencies, and the `cand-demo` passport candidate are
-- already there (they were seeded for the 4 Aug demo), and every date below was chosen
-- relative to 21 Aug 2026 so the boards show a deliberate mix of states on the demo day.
--
-- Every row mirrors the shape its production writer would leave:
--   bookings    - functions/api/assignments.js: candidate reused by email or created with a
--                 UUID, eight compliance_item rows seeded 'missing' (createCandidate), then
--                 the assignment with the store's date-only strings. In-flight rows keep the
--                 route's 'booked'; only "mark ended" writes another status.
--   compliance  - states written as setItemState would: status, reference, expiry_date, and
--                 checked_at stamped when a person touched the row. Statuses AGREE with
--                 targetFor(days_left, amberDays), so the /prep/* sweep finds no transition
--                 to claim and no nudge email is ever owed by this seed.
--   events      - the counter's three CHECK'd kinds only; invite rows carry duration_ms 0
--                 exactly as recordInviteEvent writes them.
--   portal      - stories/debrief/ticks/attempts under role-demo; the two placed debrief
--                 lines get their question rows the way insertAskedQuestion derives ids:
--                 `${competencyId}#asked-` + first 16 hex of the text's SHA-256, axis
--                 'lateral', variant_of NULL, difficulty NULL.
--
-- The one edit to an existing row: cand-demo's full_name. "Demo Locum" on a recruiter board
-- reads as staging; the passport demo door only ever looks the row up by id, so the rename is
-- invisible to it. Its expiring immunisations row (IMM-2024-118, 2026-08-29) is deliberately
-- left as the door seeded it.

-- ── candidates (the four the bookings create; cand-demo already exists) ────────────────

INSERT INTO candidate (id, full_name, email, phone, created_at) VALUES
  ('27c67c1e-3794-4fab-9146-7ac6e5ab2d8a', 'Priya Nair',        'priya.nair@example.com',        '', '2026-08-07 09:58:12'),
  ('d10137ec-f7d4-4139-8113-7bc91177055d', 'Amara Adeyemi',     'amara.adeyemi@example.com',     '', '2026-05-27 15:41:20'),
  ('564a8cd1-4441-470a-bb0c-6cbf5cdcb88d', 'Tomasz Zielinski',  'tomasz.zielinski@example.com',  '', '2026-07-02 10:05:51'),
  ('37fa7274-17b6-45d7-83a4-c416ad12f0f0', 'Eleanor Whitfield', 'eleanor.whitfield@example.com', '', '2026-05-14 13:20:08');

UPDATE candidate SET full_name = 'Daniel Okafor' WHERE id = 'cand-demo';

-- createCandidate's checklist seed: eight rows per candidate, bare, defaults deciding.

INSERT INTO compliance_item (candidate_id, item_key) VALUES
  ('27c67c1e-3794-4fab-9146-7ac6e5ab2d8a', 'hcpc_registration'),
  ('27c67c1e-3794-4fab-9146-7ac6e5ab2d8a', 'dbs_enhanced'),
  ('27c67c1e-3794-4fab-9146-7ac6e5ab2d8a', 'right_to_work'),
  ('27c67c1e-3794-4fab-9146-7ac6e5ab2d8a', 'immunisations'),
  ('27c67c1e-3794-4fab-9146-7ac6e5ab2d8a', 'indemnity'),
  ('27c67c1e-3794-4fab-9146-7ac6e5ab2d8a', 'references'),
  ('27c67c1e-3794-4fab-9146-7ac6e5ab2d8a', 'wtr_choice'),
  ('27c67c1e-3794-4fab-9146-7ac6e5ab2d8a', 'fit_to_work'),
  ('d10137ec-f7d4-4139-8113-7bc91177055d', 'hcpc_registration'),
  ('d10137ec-f7d4-4139-8113-7bc91177055d', 'dbs_enhanced'),
  ('d10137ec-f7d4-4139-8113-7bc91177055d', 'right_to_work'),
  ('d10137ec-f7d4-4139-8113-7bc91177055d', 'immunisations'),
  ('d10137ec-f7d4-4139-8113-7bc91177055d', 'indemnity'),
  ('d10137ec-f7d4-4139-8113-7bc91177055d', 'references'),
  ('d10137ec-f7d4-4139-8113-7bc91177055d', 'wtr_choice'),
  ('d10137ec-f7d4-4139-8113-7bc91177055d', 'fit_to_work'),
  ('564a8cd1-4441-470a-bb0c-6cbf5cdcb88d', 'hcpc_registration'),
  ('564a8cd1-4441-470a-bb0c-6cbf5cdcb88d', 'dbs_enhanced'),
  ('564a8cd1-4441-470a-bb0c-6cbf5cdcb88d', 'right_to_work'),
  ('564a8cd1-4441-470a-bb0c-6cbf5cdcb88d', 'immunisations'),
  ('564a8cd1-4441-470a-bb0c-6cbf5cdcb88d', 'indemnity'),
  ('564a8cd1-4441-470a-bb0c-6cbf5cdcb88d', 'references'),
  ('564a8cd1-4441-470a-bb0c-6cbf5cdcb88d', 'wtr_choice'),
  ('564a8cd1-4441-470a-bb0c-6cbf5cdcb88d', 'fit_to_work'),
  ('37fa7274-17b6-45d7-83a4-c416ad12f0f0', 'hcpc_registration'),
  ('37fa7274-17b6-45d7-83a4-c416ad12f0f0', 'dbs_enhanced'),
  ('37fa7274-17b6-45d7-83a4-c416ad12f0f0', 'right_to_work'),
  ('37fa7274-17b6-45d7-83a4-c416ad12f0f0', 'immunisations'),
  ('37fa7274-17b6-45d7-83a4-c416ad12f0f0', 'indemnity'),
  ('37fa7274-17b6-45d7-83a4-c416ad12f0f0', 'references'),
  ('37fa7274-17b6-45d7-83a4-c416ad12f0f0', 'wtr_choice'),
  ('37fa7274-17b6-45d7-83a4-c416ad12f0f0', 'fit_to_work');

-- ── bookings: five, across the five clients, states deliberately mixed ─────────────────
-- Priya: the long active one, booked the day after her 6 Aug interview (ends 4 Oct).
-- Daniel: ends 11 Sep, three weeks out, radar not yet due.
-- Amara: ends 30 Aug, inside the 14-day window; the radar claimed its one nudge on 16 Aug.
-- Tomasz: open-ended, so no deadline and no nudge, ever.
-- Eleanor: marked ended 14 Aug after the nudge landed 31 Jul; the resolved row.

INSERT INTO assignment (id, candidate_id, client_id, start_date, end_date, status, nudge_sent_at, created_at) VALUES
  ('18892133-a40d-4c3d-bb88-b28925f9680f', '27c67c1e-3794-4fab-9146-7ac6e5ab2d8a', 'client-demo',           '2026-08-10', '2026-10-04', 'booked', NULL,                  '2026-08-07 09:58:12'),
  ('8a06f2c8-0f15-4297-98a9-1f0afc2a88f5', 'cand-demo',                            'client-cambs-us',       '2026-06-16', '2026-09-11', 'booked', NULL,                  '2026-06-10 11:24:37'),
  ('d0327981-10a4-41cd-8939-3f7f72fa7bb9', 'd10137ec-f7d4-4139-8113-7bc91177055d', 'client-surrey-obs',     '2026-06-01', '2026-08-30', 'booked', '2026-08-16 07:12:04', '2026-05-27 15:41:20'),
  ('7e0d902b-03d5-4f00-90ed-08a19612c086', '564a8cd1-4441-470a-bb0c-6cbf5cdcb88d', 'client-manchester-msk', '2026-07-07', NULL,         'booked', NULL,                  '2026-07-02 10:05:51'),
  ('13f2419f-3469-4656-8fb2-7769598434d7', '37fa7274-17b6-45d7-83a4-c416ad12f0f0', 'client-london-physio',  '2026-05-19', '2026-08-14', 'ended',  '2026-07-31 08:03:41', '2026-05-14 13:20:08');

-- ── compliance states, per candidate archetype ─────────────────────────────────────────

-- Priya Nair: nearly done. Seven verified; immunisations verified in Aug, now inside the
-- 30-day amber window, so it stands 'expiring' (checked_at keeps the verification stamp,
-- because the sweep never touches that column).
UPDATE compliance_item SET status='verified', reference='RA71234',                              expiry_date='2028-02-28', checked_at='2026-08-07 10:12:04' WHERE candidate_id='27c67c1e-3794-4fab-9146-7ac6e5ab2d8a' AND item_key='hcpc_registration';
UPDATE compliance_item SET status='verified', reference='001548221907',                         expiry_date='2027-08-01', checked_at='2026-08-07 10:15:41' WHERE candidate_id='27c67c1e-3794-4fab-9146-7ac6e5ab2d8a' AND item_key='dbs_enhanced';
UPDATE compliance_item SET status='verified', reference='UK passport',                          expiry_date='2031-05-20', checked_at='2026-08-07 10:18:22' WHERE candidate_id='27c67c1e-3794-4fab-9146-7ac6e5ab2d8a' AND item_key='right_to_work';
UPDATE compliance_item SET status='expiring', reference='OH record: Hep B, MMR, varicella',     expiry_date='2026-09-12', checked_at='2026-08-07 10:21:37' WHERE candidate_id='27c67c1e-3794-4fab-9146-7ac6e5ab2d8a' AND item_key='immunisations';
UPDATE compliance_item SET status='verified', reference='SoR membership M-88231',               expiry_date='2027-01-31', checked_at='2026-08-08 09:02:10' WHERE candidate_id='27c67c1e-3794-4fab-9146-7ac6e5ab2d8a' AND item_key='indemnity';
UPDATE compliance_item SET status='verified', reference='Two clinical references on file',      expiry_date=NULL,         checked_at='2026-08-11 14:37:55' WHERE candidate_id='27c67c1e-3794-4fab-9146-7ac6e5ab2d8a' AND item_key='references';
UPDATE compliance_item SET status='verified', reference='Opted out, signed 09 Aug 2026',        expiry_date=NULL,         checked_at='2026-08-09 08:44:16' WHERE candidate_id='27c67c1e-3794-4fab-9146-7ac6e5ab2d8a' AND item_key='wtr_choice';
UPDATE compliance_item SET status='verified', reference='OH clearance',                         expiry_date='2027-08-01', checked_at='2026-08-10 11:29:03' WHERE candidate_id='27c67c1e-3794-4fab-9146-7ac6e5ab2d8a' AND item_key='fit_to_work';

-- Daniel Okafor (cand-demo): mid-flight. Four submitted awaiting verification, one verified,
-- the expiring immunisations left exactly as the passport demo seeded it, two untouched.
UPDATE compliance_item SET status='submitted', reference='RA65410',                             expiry_date='2028-02-28', checked_at='2026-08-15 09:40:12' WHERE candidate_id='cand-demo' AND item_key='hcpc_registration';
UPDATE compliance_item SET status='submitted', reference='001098776541',                        expiry_date='2027-03-15', checked_at='2026-08-15 09:44:56' WHERE candidate_id='cand-demo' AND item_key='dbs_enhanced';
UPDATE compliance_item SET status='verified',  reference='UK passport',                         expiry_date='2030-11-02', checked_at='2026-08-16 11:02:33' WHERE candidate_id='cand-demo' AND item_key='right_to_work';
UPDATE compliance_item SET status='submitted', reference='SoR membership M-79644',              expiry_date='2027-04-30', checked_at='2026-08-15 09:51:28' WHERE candidate_id='cand-demo' AND item_key='indemnity';
UPDATE compliance_item SET status='submitted', reference='Referee details given, two previous trusts', expiry_date=NULL,  checked_at='2026-08-15 09:57:44' WHERE candidate_id='cand-demo' AND item_key='references';

-- Amara Adeyemi: barely started. One submitted, seven untouched.
UPDATE compliance_item SET status='submitted', reference='RA58821',                             expiry_date='2028-02-28', checked_at='2026-08-18 17:25:09' WHERE candidate_id='d10137ec-f7d4-4139-8113-7bc91177055d' AND item_key='hcpc_registration';

-- Tomasz Zielinski: established file with one red flag. DBS verified 3 Jul against the date
-- the certificate carried, which then passed on 19 Jul; the sweep moved it to 'expired'.
UPDATE compliance_item SET status='verified',  reference='RA69102',                             expiry_date='2028-02-28', checked_at='2026-07-03 10:14:27' WHERE candidate_id='564a8cd1-4441-470a-bb0c-6cbf5cdcb88d' AND item_key='hcpc_registration';
UPDATE compliance_item SET status='expired',   reference='001355420917',                        expiry_date='2026-07-19', checked_at='2026-07-03 10:20:08' WHERE candidate_id='564a8cd1-4441-470a-bb0c-6cbf5cdcb88d' AND item_key='dbs_enhanced';
UPDATE compliance_item SET status='verified',  reference='Settled status share code SC-77219',  expiry_date='2027-10-01', checked_at='2026-07-03 10:26:51' WHERE candidate_id='564a8cd1-4441-470a-bb0c-6cbf5cdcb88d' AND item_key='right_to_work';
UPDATE compliance_item SET status='verified',  reference='OH record 2025',                      expiry_date='2027-02-10', checked_at='2026-07-04 09:12:36' WHERE candidate_id='564a8cd1-4441-470a-bb0c-6cbf5cdcb88d' AND item_key='immunisations';
UPDATE compliance_item SET status='verified',  reference='SoR membership M-81455',              expiry_date='2027-04-30', checked_at='2026-07-04 09:17:20' WHERE candidate_id='564a8cd1-4441-470a-bb0c-6cbf5cdcb88d' AND item_key='indemnity';
UPDATE compliance_item SET status='verified',  reference='Two references on file',              expiry_date=NULL,         checked_at='2026-07-05 16:03:47' WHERE candidate_id='564a8cd1-4441-470a-bb0c-6cbf5cdcb88d' AND item_key='references';
UPDATE compliance_item SET status='verified',  reference='Opted out, signed 04 Jul 2026',       expiry_date=NULL,         checked_at='2026-07-04 09:20:02' WHERE candidate_id='564a8cd1-4441-470a-bb0c-6cbf5cdcb88d' AND item_key='wtr_choice';
UPDATE compliance_item SET status='submitted', reference='OH questionnaire returned',           expiry_date='2027-05-31', checked_at='2026-08-12 12:41:19' WHERE candidate_id='564a8cd1-4441-470a-bb0c-6cbf5cdcb88d' AND item_key='fit_to_work';

-- Eleanor Whitfield: the finished file, all eight verified, sitting at the calm end of the
-- worst-first board.
UPDATE compliance_item SET status='verified', reference='PH48213',                              expiry_date='2028-04-30', checked_at='2026-05-15 10:05:18' WHERE candidate_id='37fa7274-17b6-45d7-83a4-c416ad12f0f0' AND item_key='hcpc_registration';
UPDATE compliance_item SET status='verified', reference='001200483356',                         expiry_date='2027-05-01', checked_at='2026-05-15 10:09:42' WHERE candidate_id='37fa7274-17b6-45d7-83a4-c416ad12f0f0' AND item_key='dbs_enhanced';
UPDATE compliance_item SET status='verified', reference='UK passport',                          expiry_date='2029-09-14', checked_at='2026-05-15 10:12:57' WHERE candidate_id='37fa7274-17b6-45d7-83a4-c416ad12f0f0' AND item_key='right_to_work';
UPDATE compliance_item SET status='verified', reference='OH record, full course',               expiry_date='2026-12-01', checked_at='2026-05-16 09:31:24' WHERE candidate_id='37fa7274-17b6-45d7-83a4-c416ad12f0f0' AND item_key='immunisations';
UPDATE compliance_item SET status='verified', reference='CSP membership 077912',                expiry_date='2027-02-28', checked_at='2026-05-16 09:36:08' WHERE candidate_id='37fa7274-17b6-45d7-83a4-c416ad12f0f0' AND item_key='indemnity';
UPDATE compliance_item SET status='verified', reference='Two references on file',               expiry_date=NULL,         checked_at='2026-05-19 15:22:31' WHERE candidate_id='37fa7274-17b6-45d7-83a4-c416ad12f0f0' AND item_key='references';
UPDATE compliance_item SET status='verified', reference='Declined opt-out, 48-hour limit kept', expiry_date=NULL,         checked_at='2026-05-16 09:40:53' WHERE candidate_id='37fa7274-17b6-45d7-83a4-c416ad12f0f0' AND item_key='wtr_choice';
UPDATE compliance_item SET status='verified', reference='OH clearance',                         expiry_date='2027-05-31', checked_at='2026-05-16 09:44:10' WHERE candidate_id='37fa7274-17b6-45d7-83a4-c416ad12f0f0' AND item_key='fit_to_work';

-- ── events: four weeks of use, different numbers per client ────────────────────────────
-- pack_generated rows ride the DDL default kind and carry real-looking durations; invite
-- telemetry carries duration 0, recordInviteEvent's shape.

INSERT INTO events (client_id, created_at, duration_ms) VALUES
  ('client-demo',           '2026-07-24 09:41:12', 18425),
  ('client-demo',           '2026-07-28 11:03:55', 12980),
  ('client-demo',           '2026-08-03 16:22:40', 21730),
  ('client-demo',           '2026-08-06 08:15:27', 15112),
  ('client-demo',           '2026-08-12 10:47:03', 26340),
  ('client-demo',           '2026-08-18 14:31:48', 11876),
  ('client-cambs-us',       '2026-07-27 15:12:33', 14205),
  ('client-cambs-us',       '2026-08-04 09:58:21', 19871),
  ('client-cambs-us',       '2026-08-11 13:26:54', 10442),
  ('client-cambs-us',       '2026-08-17 16:05:37', 23610),
  ('client-surrey-obs',     '2026-07-30 10:31:26', 17093),
  ('client-surrey-obs',     '2026-08-07 14:44:11', 13567),
  ('client-surrey-obs',     '2026-08-14 09:21:49', 20125),
  ('client-manchester-msk', '2026-08-05 11:36:02', 16704),
  ('client-manchester-msk', '2026-08-13 15:52:28', 12318),
  ('client-london-physio',  '2026-08-10 10:14:45', 24957);

INSERT INTO events (client_id, created_at, duration_ms, kind) VALUES
  ('client-demo',           '2026-07-24 09:52:30', 0, 'invite_sent'),
  ('client-demo',           '2026-07-24 18:20:14', 0, 'invite_opened'),
  ('client-demo',           '2026-07-31 10:36:38', 0, 'invite_sent'),
  ('client-demo',           '2026-07-31 10:37:45', 0, 'invite_opened'),
  ('client-demo',           '2026-08-12 11:02:19', 0, 'invite_sent'),
  ('client-cambs-us',       '2026-08-04 10:11:52', 0, 'invite_sent'),
  ('client-cambs-us',       '2026-08-04 19:44:06', 0, 'invite_opened'),
  ('client-cambs-us',       '2026-08-17 16:18:23', 0, 'invite_sent'),
  ('client-surrey-obs',     '2026-08-07 15:01:38', 0, 'invite_sent'),
  ('client-surrey-obs',     '2026-08-08 07:32:50', 0, 'invite_opened'),
  ('client-manchester-msk', '2026-08-13 16:04:15', 0, 'invite_sent');

-- ── Priya's portal: the storybank, written before the 6 Aug interview ──────────────────
-- Three stories ticked against the role's competencies and a fourth left unmapped, so the
-- coverage gap and the "no ticks yet" state both show.

INSERT INTO story (id, candidate_role_id, title, sketch, created_at) VALUES
  ('ff66b2ae-e858-4ca9-900e-56d891165e1e', 'role-demo', 'Contrast extravasation on a solo evening list',
   'Evening MSK list, radiologist off site. Extravasation on an outpatient: stopped the injection, elevated the arm, followed the protocol pack and had the on-call registrar on the phone inside five minutes. Wrote up volumes and timings before the patient left the department.',
   '2026-08-03 20:15:42'),
  ('fe5a7477-2d31-4ca8-896f-621ff9b7e85e', 'role-demo', 'The scanner fault nobody had logged',
   'The Aera kept throwing a coil error mid-sequence on a Saturday. The previous locum had been working round it without logging it. I logged the fault, rang Siemens with the error codes, and left a handover note so the Monday team knew which sequences were affected.',
   '2026-08-04 21:02:17'),
  ('ce2defc8-957e-419f-bffa-fd5189ce2b62', 'role-demo', 'The dressing that was not on the request card',
   'Inpatient down for a lumbar spine scan arrived with a saturated dressing over a sacral wound the request never mentioned. Flagged it to the ward before scanning and got it re-dressed. It turned out to be an ungraded pressure injury.',
   '2026-08-04 21:38:50'),
  ('9261e53d-d2f9-46d6-b8d7-8ca37f49b291', 'role-demo', 'Ten minutes'' notice to take the Vida list',
   'Cover call at 8:50 for a 9:00 list on a scanner I had not used at that site. Prioritised the safety checks, asked the department''s own assistant to stay for the first three patients, and ran the list without a cancellation.',
   '2026-08-05 07:55:33');

INSERT INTO story_competency (story_id, competency_id) VALUES
  ('ff66b2ae-e858-4ca9-900e-56d891165e1e', 'comp-lone-working'),
  ('fe5a7477-2d31-4ca8-896f-621ff9b7e85e', 'comp-documentation'),
  ('fe5a7477-2d31-4ca8-896f-621ff9b7e85e', 'comp-lone-working'),
  ('ce2defc8-957e-419f-bffa-fd5189ce2b62', 'comp-wound-management');

-- ── Priya's debrief, saved the evening after the interview ─────────────────────────────
-- Five asked lines, two placed on competencies, one shaky tick, a one-line fix.

INSERT INTO debrief (id, candidate_role_id, asked_json, fix_text, created_at) VALUES
  ('437baaa7-b01d-44a0-9f31-56aeae6807d4', 'role-demo',
   '[{"text":"Why locum rather than a substantive post?","competency_id":null},{"text":"Talk me through a time you were the only radiographer on site and something went wrong.","competency_id":"comp-lone-working"},{"text":"If an incident from one of your lists was reviewed six months later, would your notes stand up?","competency_id":"comp-documentation"},{"text":"What would you want from us in your first week?","competency_id":null},{"text":"Have you scanned on a Vida before?","competency_id":null}]',
   'Lead with the structure next time: situation, action, what the notes showed, instead of finding it halfway through the answer.',
   '2026-08-06 18:41:27');

INSERT INTO debrief_competency (debrief_id, competency_id) VALUES
  ('437baaa7-b01d-44a0-9f31-56aeae6807d4', 'comp-documentation');

-- The two placed lines become drillable questions exactly as insertAskedQuestion writes
-- them: id derived from the text's SHA-256, axis 'lateral', no variant, no difficulty.

INSERT INTO question (id, competency_id, text, variant_of, axis, difficulty) VALUES
  ('comp-lone-working#asked-0e9b0191d6aeeb19', 'comp-lone-working',
   'Talk me through a time you were the only radiographer on site and something went wrong.', NULL, 'lateral', NULL),
  ('comp-documentation#asked-9801823d030a65cc', 'comp-documentation',
   'If an incident from one of your lists was reviewed six months later, would your notes stand up?', NULL, 'lateral', NULL);

-- ── Priya's practice: attempts before and after the interview, mixed modes ─────────────
-- Lone working firming up (a 4 on recall), documentation still wobbly in nudged mode (the
-- shaky tick above says the same thing), wound management barely opened; the two real
-- interview questions drilled after the debrief filed them.

INSERT INTO attempt (competency_id, question_id, mode, rating, note, created_at) VALUES
  ('comp-lone-working',    'q-lone-1',                                  'recall',   3,    '', '2026-08-03 20:41:10'),
  ('comp-lone-working',    'q-lone-2',                                  'nudged',   2,    '', '2026-08-03 20:47:33'),
  ('comp-documentation',   'q-doc-1',                                   'nudged',   2,    '', '2026-08-04 21:12:05'),
  ('comp-documentation',   'q-doc-2',                                   'revealed', NULL, '', '2026-08-04 21:19:48'),
  ('comp-lone-working',    'q-lone-3',                                  'recall',   4,    '', '2026-08-05 08:03:29'),
  ('comp-documentation',   'comp-documentation#asked-9801823d030a65cc', 'nudged',   2,    '', '2026-08-10 19:22:41'),
  ('comp-documentation',   'q-doc-3',                                   'recall',   3,    '', '2026-08-14 19:05:12'),
  ('comp-lone-working',    'comp-lone-working#asked-0e9b0191d6aeeb19',  'recall',   3,    '', '2026-08-17 18:57:36'),
  ('comp-wound-management','q-wound-1',                                 'revealed', NULL, '', '2026-08-19 20:31:02'),
  ('comp-wound-management','q-wound-2',                                 'nudged',   2,    '', '2026-08-19 20:39:55');
