-- Portal schema (#17). Architecture §4, mirroring SPEC.md's State section, plus the
-- handover/auth layer. The retention design (decision 13): every row below hangs off an
-- invite through ON DELETE CASCADE, so `DELETE FROM invite WHERE <expired>` erases a
-- candidate's entire footprint in one statement. There is no soft delete and no archive.

-- interview_at / expires_at / sent_at / opened_at are SQLite UTC datetime strings
-- ('YYYY-MM-DD HH:MM:SS', the datetime('now') format). #22 writes them; purge compares
-- them through datetime(), which also accepts ISO-8601 'T' forms. interview_at alone
-- carries a CHECK: datetime() of an unparseable string is NULL, NULL never satisfies the
-- purge's <=, and the row would outlive retention silently — rejecting the write is the
-- loud failure the fail-open middleware cannot give.

-- status carries no CHECK deliberately: its vocabulary belongs to #20/#22, and a hard
-- delete means there is never a 'deleted' state to represent. sent_at/opened_at are the
-- entire recruiter-visible surface (decision 3): delivery telemetry, never behaviour.
CREATE TABLE invite (
  id           TEXT PRIMARY KEY,
  client_id    TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  email        TEXT NOT NULL,
  interview_at TEXT NOT NULL CHECK (datetime(interview_at) IS NOT NULL),
  sent_at      TEXT,
  opened_at    TEXT,
  expires_at   TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'sent'
);
CREATE INDEX invite_by_interview ON invite (interview_at);

-- The handover payload (decision 1, 14): the same privileged inputs that power the pack,
-- carried per-invite so purge and delete-now take the CV with everything else.
CREATE TABLE candidate_role (
  id         TEXT PRIMARY KEY,
  invite_id  TEXT NOT NULL UNIQUE REFERENCES invite(id) ON DELETE CASCADE,
  jd_text    TEXT NOT NULL DEFAULT '',
  ethos_text TEXT NOT NULL DEFAULT '',
  cv_text    TEXT NOT NULL DEFAULT '',
  brief_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE competency (
  id           TEXT PRIMARY KEY,
  role_id      TEXT NOT NULL REFERENCES candidate_role(id) ON DELETE CASCADE,
  label        TEXT NOT NULL,
  source_quote TEXT NOT NULL DEFAULT '',
  importance   INTEGER NOT NULL DEFAULT 0,
  stage        TEXT NOT NULL DEFAULT '',
  success_rate REAL NOT NULL DEFAULT 0
);
CREATE INDEX competency_by_role ON competency (role_id);

CREATE TABLE question (
  id            TEXT PRIMARY KEY,
  competency_id TEXT NOT NULL REFERENCES competency(id) ON DELETE CASCADE,
  text          TEXT NOT NULL,
  variant_of    TEXT REFERENCES question(id) ON DELETE CASCADE,
  axis          TEXT CHECK (axis IN ('lateral','vertical')),
  difficulty    INTEGER
);
CREATE INDEX question_by_competency ON question (competency_id);
CREATE INDEX question_by_variant ON question (variant_of);

-- mode is the field that makes the rest honest (SPEC State): a revealed answer must never
-- count as recall. The CHECK makes that structural — #23 cannot write a fourth mode.
CREATE TABLE attempt (
  id            INTEGER PRIMARY KEY,
  competency_id TEXT NOT NULL REFERENCES competency(id) ON DELETE CASCADE,
  question_id   TEXT NOT NULL REFERENCES question(id) ON DELETE CASCADE,
  mode          TEXT NOT NULL CHECK (mode IN ('recall','nudged','revealed')),
  rating        INTEGER,
  note          TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX attempt_by_competency ON attempt (competency_id);
CREATE INDEX attempt_by_question ON attempt (question_id);

CREATE TABLE habit (
  id             INTEGER PRIMARY KEY,
  role_id        TEXT NOT NULL REFERENCES candidate_role(id) ON DELETE CASCADE,
  label          TEXT NOT NULL,
  evidence_count INTEGER NOT NULL DEFAULT 1,
  first_seen     TEXT NOT NULL DEFAULT (datetime('now')),
  active         INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX habit_by_role ON habit (role_id);

-- Returning login (decision 12). Only the hash rests; #20 mints and checks codes.
CREATE TABLE otp (
  id         INTEGER PRIMARY KEY,
  invite_id  TEXT NOT NULL REFERENCES invite(id) ON DELETE CASCADE,
  code_hash  TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX otp_by_invite ON otp (invite_id);

-- The one deliberate widening of the counter (decision 3, 23): kind distinguishes pack
-- generation from invite delivery telemetry. Still non-personal — no invite id, no email,
-- no behaviour. Per-invite sent/opened state lives on `invite` and dies with it; these rows
-- carry only aggregate counts for the sales claim, which is what lets the counts survive a
-- purge while the identities do not. The CHECK is the whole vocabulary; a fourth kind is a
-- schema change made in the open, exactly like this one.
ALTER TABLE events ADD COLUMN kind TEXT NOT NULL DEFAULT 'pack_generated'
  CHECK (kind IN ('pack_generated', 'invite_sent', 'invite_opened'));
