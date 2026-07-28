-- The OTP attempt cap (#20). A 6-digit code is 10^6 wide: without a cap, the returning-login
-- endpoint is a free oracle — an attacker who knows a candidate's email address can walk the
-- space. The counter lives on the row rather than in a rate limiter because the row already
-- dies twice over: with its invite through 0002's cascade, and with its own TTL. So the cap
-- needs no storage of its own and no cleanup. #20's verify deletes the row on success and on
-- cap-out; there is no state left to leak and nothing to reset.
--
-- NOT NULL with a non-NULL default, because SQLite's ALTER cannot add a NOT NULL column
-- without one and every otp row that already exists has made zero attempts.
ALTER TABLE otp ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
