-- #34: the send's idempotency key. The browser mints one per PREPARED payload; a retry of the
-- same payload carries the same key, a deliberate re-send is a new prepared payload and a new
-- key. The invite INSERT is the send's FIRST write and the rollback deletes the row, so this
-- index IS the discrimination (0006's "the column IS the idempotency" precedent): a key
-- already standing means the earlier send fully succeeded, and the route answers 409
-- already_sent instead of minting a second invite. NULLs are free — SQLite UNIQUE indexes
-- admit any number of them — so every existing row and every key-less caller is untouched.
ALTER TABLE invite ADD COLUMN send_key TEXT;
CREATE UNIQUE INDEX invite_send_key ON invite (send_key);
