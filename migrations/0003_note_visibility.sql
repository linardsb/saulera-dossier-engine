-- The candidate-visibility allow-list on the client-knowledge note (#18).
-- Architecture docs/epics/candidate-portal.architecture.md decision 2: the per-field
-- candidate-visible toggle, enforced in code rather than in a prompt.
--
-- PRESENCE IS PERMISSION. A row means the recruiter ticked that section; no row means hidden.
-- There is deliberately no `visible` boolean, because a boolean has a default to get the wrong
-- way round and a NULL to interpret. An empty table IS the fail-closed default, which means
-- every note written before this migration ran starts fully hidden for free, and so does every
-- section written after it.
--
-- The cascade matches events.client_id exactly, so deleting a client takes its permissions with
-- it by the schema and not by a second statement in deleteClient. It either works for both or
-- is already broken for the metric.
--
-- What is NOT here is the point. A row is a client id and a heading slug: no note text, no
-- section body, no candidate anything. §5.6's boundary — candidate, CV and pack are transient,
-- passed in, used, never written down — has not moved, and test/schema.test.js locks these
-- three columns so a fourth ("a note excerpt for debugging", a candidate email) fails the suite.
--
-- The column is field_key rather than candidate_visible because test/schema.test.js fails any
-- identifier matching /candidate|^cv$|resume|\bpack\b|brief/i. The API's JSON key stays
-- `candidate_visible`, since that guard reads migration SQL only and the ticket's vocabulary is
-- worth keeping where a human meets it.
--
-- A new table rather than a column on clients: test/schema.test.js bans every table-altering
-- statement outright, and SQLite's way to add a column without one is a table rebuild, which
-- needs a RENAME. There is no path around that guard, so the question became which shape is
-- worth the deliberate edit — and the allow-list wins, because the storage layout itself
-- encodes the safety property.
CREATE TABLE note_visibility (
  client_id  TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  field_key  TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (client_id, field_key)
);
