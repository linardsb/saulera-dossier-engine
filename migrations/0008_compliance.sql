-- Compliance cage (#67, epic #65). The THIRD schema regime, decided in the open by spike
-- #66 (docs/epics/locum-fit-2.architecture.md): durable candidate compliance METADATA —
-- statuses, reference numbers, expiry dates — never document bytes. Every row below reaches
-- `candidate` through ON DELETE CASCADE, so one `DELETE FROM candidate` erases the whole
-- cage: that statement IS delete-now, and the 12-month dormancy purge
-- (src/compliance/store.js) is the same statement with the schema's own clock as its WHERE.
-- The engine's "candidate data is transient" ban (§5.6) is untouched — test/schema.test.js
-- proves all three regimes.

-- The cage root: identity + contact, nothing else (minimal-fields posture — even metadata
-- here is health-adjacent under UK GDPR). created_at feeds the dormancy purge for a
-- candidate who never gained an assignment, so it carries the 0002 interview_at treatment:
-- an unparseable date would make the row immortal, and the CHECK moves that failure to
-- write time.
CREATE TABLE candidate (
  id         TEXT PRIMARY KEY,
  full_name  TEXT NOT NULL,
  email      TEXT NOT NULL,
  phone      TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')) CHECK (datetime(created_at) IS NOT NULL)
);

-- One booking of one candidate at one client. Feeds BOTH clocks: the dormancy purge (a
-- candidate whose every assignment ended 12+ months ago) and #69's extension radar
-- (end_date - 14 days). client_id cascades from clients exactly as invite does — deleting
-- a client takes its bookings by the schema, not by a second statement.
--
-- start_date and end_date get 0002's interview_at treatment for the same reason candidate
-- .created_at does: datetime() of an unparseable string is NULL, NULL never satisfies the
-- purge's comparison, and the candidate would outlive retention silently. end_date is
-- nullable because an open booking is a real state — and a NULL end_date deliberately keeps
-- its candidate alive, which is the one immortality the purge grants.
CREATE TABLE assignment (
  id           TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidate(id) ON DELETE CASCADE,
  client_id    TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  start_date   TEXT NOT NULL CHECK (datetime(start_date) IS NOT NULL),
  end_date     TEXT CHECK (end_date IS NULL OR datetime(end_date) IS NOT NULL),
  status       TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('booked','active','ended','cancelled')),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX assignment_by_candidate ON assignment (candidate_id);
CREATE INDEX assignment_by_client ON assignment (client_id);

-- One checklist row per candidate per catalogue item. Metadata-only is structural here:
-- {status, reference, expiry_date, checked_at} and NO fifth data column — no url, no blob,
-- no note. item_key's vocabulary lives in src/compliance/catalogue.js (thresholds in the
-- catalogue, not code); the store validates it, deliberately not a CHECK, so adding an item
-- is a catalogue edit and not a migration. status IS a CHECK: five states, closed, exactly
-- like attempt.mode — #70's sweep must not invent a sixth.
CREATE TABLE compliance_item (
  id           INTEGER PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidate(id) ON DELETE CASCADE,
  item_key     TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'missing' CHECK (status IN ('missing','submitted','verified','expiring','expired')),
  reference    TEXT NOT NULL DEFAULT '',
  expiry_date  TEXT CHECK (expiry_date IS NULL OR datetime(expiry_date) IS NOT NULL),
  checked_at   TEXT,
  UNIQUE (candidate_id, item_key)
);
CREATE INDEX item_by_candidate ON compliance_item (candidate_id);
