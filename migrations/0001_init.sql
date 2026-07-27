-- Schema for the submission dossier engine (#5).
--
-- Architecture §5.3: four entities, and the interesting thing about them is which ones
-- persist. Two do. Candidate, CV and Pack are transient — passed in, used, never written
-- down. There is no candidate table, no cv table and no pack table, and test/schema.test.js
-- fails if a later ticket adds one. §5.6 calls that "the one boundary that is expensive to
-- unpick".

-- Agency: one per deployment. Configuration, not data. Branding is NOT here; it lives in
-- public/tokens.css because it has to apply before first paint (plan Decision 6).
CREATE TABLE agency (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  name        TEXT NOT NULL DEFAULT '',
  send_format TEXT NOT NULL DEFAULT 'email_body',
  renderer    TEXT NOT NULL DEFAULT 'appendix',
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO agency (id) VALUES (1);

-- Client: the durable asset. Name plus one free-text knowledge note — process, stages,
-- panel roles, standards, past rejection reasons. Owned and edited by the agency (§4).
-- The note is business-context personal data: it names hiring managers and panel members.
CREATE TABLE clients (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  note       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The non-personal event counter: client, timestamp, duration. Nothing else, ever.
-- Sole mechanism behind the epic's primary metric (PRD §7, packs generated versus
-- submissions made). No names, no CV content, no pack content.
CREATE TABLE events (
  id          INTEGER PRIMARY KEY,
  client_id   TEXT    NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  duration_ms INTEGER NOT NULL
);

CREATE INDEX events_by_client ON events (client_id);
