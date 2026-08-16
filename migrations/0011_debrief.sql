-- #77 (epic #76): the private debrief. SPEC Amendment 1, "Debrief — private, same-day".
--
-- It joins the PORTAL regime and no other: every row hangs off `candidate_role`, which hangs off
-- `invite`, so decision 13's two erasures — the 30-day purge and delete-now — take a debrief with
-- everything else in one statement. There is no separate retention rule to remember and no
-- tombstone, because a tombstone is candidate data (src/portal/store.js:1-6).
--
-- ONE ROW PER ROLE, not one per interview. `candidate_role_id` is UNIQUE and the route upserts, so
-- "resumable, partial save, re-editable" is one row rewritten rather than a history to reconcile.
-- Decision 11 keeps the portal open to interview + 14 days for second stages; the candidate edits
-- the same row.
--
-- WHY `shaky` IS A JOIN TABLE AND NOT THE SPEC'S `shaky_text` COLUMN. The spec's State line named
-- one, and this migration deliberately does not write it — SPEC.md is amended in the same PR
-- rather than forked (DECISIONS.md decision 1: if behaviour and spec diverge, one of them changes,
-- never silently). The reason is the ticket's own constraint: targeting must treat a shaky
-- competency as less ready with NO MODEL CALL, and a line of prose cannot be read that way. The
-- candidate ticks competencies from the role's own list, so the tick IS a foreign key. It is also
-- the shape SPEC Amendment 1 already chose for the storybank's `story_competency`, one ticket over.
--
-- AND WHY THE FLAG IS NOT A COLUMN ON `competency`. That table's two mutable columns are
-- recompute-then-write CACHES of the attempt log (src/prep/ladder.js:6-11,
-- src/portal/store.js:615-618). A third mutable column that is NOT derivable from the log would
-- make every future reader learn an exemption to the one invariant the drill leans on.
--
-- Nothing here is numeric, which is deliberate rather than incidental: the INTEGER-affinity trap
-- src/portal/store.js:144-155 documents needs a numeric column to spring, and this table has none.
--
-- No `updated_at`: nothing renders it, and test/schema.test.js locks columns exactly, so a column
-- with no reader is churn that a later ticket has to argue its way past.
CREATE TABLE debrief (
  id                TEXT PRIMARY KEY,
  candidate_role_id TEXT NOT NULL UNIQUE REFERENCES candidate_role(id) ON DELETE CASCADE,
  -- The candidate's own words, verbatim, plus where they put each one:
  -- `[{"text": "…", "competency_id": "…" | null}]`. JSON in a TEXT column is
  -- `candidate_role.brief_json`'s precedent, one table over, and it is here for the reason that
  -- one is: the ROUND TRIP is the feature. A line's placement is state the candidate set, so it
  -- has to be stored, not re-derived — re-deriving it from the `question` rows this form creates
  -- cannot answer "which competency did they pick LAST" after a line is moved, because a moved
  -- line deliberately leaves its first question row standing (deleting a question cascades its
  -- attempts away, migrations/0002_portal.sql) and `question` carries no stamp to order them by.
  -- The form would then prefill the wrong pick on the one page whose whole promise is "come back
  -- and add to this".
  asked_json        TEXT NOT NULL DEFAULT '[]',
  fix_text          TEXT NOT NULL DEFAULT '',
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The ticks. Composite primary key rather than a surrogate id: the pair IS the fact, and a
-- duplicate tick is not a second fact — which is also what lets the store's INSERT carry
-- ON CONFLICT DO NOTHING, so two saves interleaving cannot raise a constraint error. The route
-- replaces the whole set per save (the store's DELETE-then-INSERT, issueOtp's idiom); with no
-- transaction, a failure between the two leaves the set EMPTY rather than stale, and the next
-- save restores it from the page. See store.js's setShakyCompetencies for why that trade stands.
-- Both parents cascade: the debrief dies with the role, and a competency that somehow goes takes
-- its ticks rather than leaving a dangling one that would dampen nothing.
CREATE TABLE debrief_competency (
  debrief_id    TEXT NOT NULL REFERENCES debrief(id) ON DELETE CASCADE,
  competency_id TEXT NOT NULL REFERENCES competency(id) ON DELETE CASCADE,
  PRIMARY KEY (debrief_id, competency_id)
);
CREATE INDEX debrief_competency_by_competency ON debrief_competency (competency_id);
