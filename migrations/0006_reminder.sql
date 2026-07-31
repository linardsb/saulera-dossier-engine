-- #25: the one reminder (architecture decision 17). Nullable set-exactly-once stamp;
-- the claim is UPDATE ... WHERE reminder_sent_at IS NULL, so this column IS the idempotency.
-- Nullable TEXT needs no default (0004's note), and the column dies with the invite row.
ALTER TABLE invite ADD COLUMN reminder_sent_at TEXT;
