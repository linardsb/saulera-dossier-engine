-- #23 review L1: observeHabit's UPDATE-then-INSERT had no unique backstop, so two
-- concurrent double-submitted turns could each insert an ACTIVE row for one
-- (role_id, label) — after which every later observation increments both, and habits
-- sit outside the log-replay invariant so nothing heals it. Collapse any such pairs
-- (keep the earliest row), then make the pair impossible; store.js now upserts
-- against this index (INSERT ... ON CONFLICT ... DO UPDATE). Inactive rows stay
-- unconstrained: a retired habit re-observed starts a fresh active row.
DELETE FROM habit
WHERE active = 1
  AND id NOT IN (SELECT MIN(id) FROM habit WHERE active = 1 GROUP BY role_id, label);

CREATE UNIQUE INDEX habit_one_active_per_label ON habit (role_id, label) WHERE active = 1;
