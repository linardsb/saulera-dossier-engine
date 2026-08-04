-- The candidate-rooted session (#68, epic #65). The compliance cage gains a door of its own.
--
-- WHY A COLUMN ON THE CAGE ROOT AND NOT A SESSION TABLE. `session_hash` is `invite.token_hash`
-- at a second root: one credential column, so one candidate holds one live session and a
-- second device signing in ROTATES the first out. That is the same call
-- functions/prep/auth/verify.js:82-84 made for the portal, restated here because the surface
-- is phone-first and a locum signing in from a new handset is the ordinary case, not an
-- attack. Concurrent devices would be a `candidate_session` table and a decision to make in
-- the open — not a column that quietly grew a second row.
--
-- WHY THE OTP IS A CHILD TABLE. `attempts` is the cap's whole storage, and it has to ride the
-- row it caps and die with it — the `otp` table's design (0002/0004), which is why this one is
-- its exact shape with a new parent. A counter on `candidate` would outlive the code it was
-- counting guesses against.
--
-- WHY BOTH COLUMNS ARE NULLABLE. A candidate who has never signed in is the honest default,
-- and it is also the only form ADD COLUMN takes on a populated table: SQLite cannot add a
-- NOT NULL column without a constant default, and there is no honest constant for "the hash of
-- a session nobody has". The date CHECK gets 0008's treatment for 0002's reason — datetime()
-- of an unparseable string is NULL, and a session whose expiry never compares is a session
-- that never ends.
ALTER TABLE candidate ADD COLUMN session_hash TEXT;
ALTER TABLE candidate ADD COLUMN session_expires_at TEXT CHECK (session_expires_at IS NULL OR datetime(session_expires_at) IS NOT NULL);

-- One live sign-in code per candidate, and the guess counter that caps it. Still no `code`
-- column and still no email: only the hash rests (test/schema.test.js locks that), and the
-- candidate the row hangs off owns the identity. It cascades from `candidate`, so one
-- `DELETE FROM candidate` — delete-now, or the 12-month dormancy purge — takes a live code
-- with the cage rather than leaving a credential behind the mechanism that promises there is
-- nothing left.
CREATE TABLE candidate_otp (
  id           INTEGER PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidate(id) ON DELETE CASCADE,
  code_hash    TEXT NOT NULL,
  expires_at   TEXT NOT NULL CHECK (datetime(expires_at) IS NOT NULL),
  attempts     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX otp_by_candidate ON candidate_otp (candidate_id);
