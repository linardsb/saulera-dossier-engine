-- #78 (epic #76): the storybank. SPEC Amendment 1, "Storybank".
--
-- It joins the PORTAL regime and no other: every row hangs off `candidate_role`, which hangs off
-- `invite`, so decision 13's two erasures — the 30-day purge and delete-now — take a candidate's
-- stories with everything else in one statement. There is no separate retention rule to remember
-- and no tombstone, because a tombstone is candidate data (src/portal/store.js:1-6). These are the
-- candidate's own words about their own life, written before an interview on the promise printed
-- on /prep/privacy; filing them under a retention rule that outlived the invite would break that
-- sentence rather than the schema.
--
-- WHY `candidate_role_id` IS NOT UNIQUE HERE — the one deliberate divergence from `debrief`
-- (0011), and the reason the routes look nothing like that one. A debrief is ONE note, so its
-- table has one row per role and the route upserts. A storybank is a COLLECTION: a role has many
-- stories, each created, edited and deleted on its own. That is why there is a `story_by_role`
-- index (the editor's read is "every story on this role", on every page load), why the routes are
-- collection/item shaped after functions/prep/compliance/api/items.js + item.js, and why the store
-- has a separate createStory and updateStory rather than one upsert — see store.js's storybank
-- section for the security argument behind that split, which is about WHERE the ownership check
-- lives and is not a style preference.
--
-- WHY THE MAPPING IS A JOIN TABLE. SPEC Amendment 1 named this shape itself, and 0011's header
-- already leaned on it ("the shape SPEC Amendment 1 already chose for the storybank's
-- `story_competency`, one ticket over"). The reason is the same as the debrief's: targeting has to
-- answer "does a story cover this competency" DETERMINISTICALLY, with no model call. The candidate
-- ticks competencies from the role's own list, so the tick IS a foreign key. A `covers_text`
-- column of prose could not be read that way, and reading it that way would need the one thing
-- this feature must never do.
--
-- WHY THIS IS NOT THE `StoryBankCard` BLOCK, and this paragraph is the point of the migration
-- header. `StoryBankCard` (src/prep/schema.js:51-66, public/prep/registry.js, src/prep/strike.js)
-- is a MODEL-WRITTEN block of the brief: a prompt, a skeleton and a competency mapping, composed
-- by the Send call before the candidate has ever opened the portal. The `story` table below is
-- CANDIDATE-WRITTEN content the tool must never write — semantically the opposite thing under a
-- near-identical name. They are never merged, never renamed into each other, and the block is
-- never fed from this table. A future reader who conflates the two will hand a candidate's own
-- sketch to a model, which is the one failure this whole ticket is built to make structurally
-- impossible. test/prep-storybank.test.js asserts the wall's matcher does not confuse them either.
--
-- Nothing here is numeric, which is deliberate rather than incidental: the INTEGER-affinity trap
-- src/portal/store.js:144-155 documents needs a numeric column to spring, and neither table has
-- one. A `position` or `order` column is also absent for a second reason — this is a flat capped
-- list of twelve, and nothing reorders it.
--
-- No `updated_at`: nothing renders it, and test/schema.test.js locks columns exactly, so a column
-- with no reader is churn that a later ticket has to argue its way past.
CREATE TABLE story (
  id                TEXT PRIMARY KEY,
  candidate_role_id TEXT NOT NULL REFERENCES candidate_role(id) ON DELETE CASCADE,
  -- The candidate's own words, and the two columns are read by different audiences on purpose.
  -- `title` is what a nudge may be shown so it can ask "which of your stories fits here?" —
  -- `storyTitlesByRole` selects this column and no other. `sketch` is selected by exactly one
  -- store function, read by exactly one route, and rendered on exactly one page: the editor's.
  -- That asymmetry is the whole of AC2, and it is a property of the queries rather than a promise
  -- about the callers.
  title             TEXT NOT NULL,
  -- Legitimately empty. A candidate who types a title and walks away has recorded something real,
  -- and the page is resumable — so the DEFAULT is '' and the route's non-blank guard covers the
  -- title alone.
  sketch            TEXT NOT NULL DEFAULT '',
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The editor reads every story on the role on every page load, and the nudge reads their titles on
-- every help turn, so the role is the access path rather than an occasional filter.
CREATE INDEX story_by_role ON story (candidate_role_id);

-- The ticks. Composite primary key rather than a surrogate id, for the reason 0011:49-56 states
-- about the debrief's: the pair IS the fact, and a duplicate tick is not a second fact. That is
-- also what lets the store's INSERT carry ON CONFLICT DO NOTHING, so two saves interleaving — two
-- tabs, or a client retry — cannot raise a constraint error that would surface as `500 internal`
-- and send an operator to re-run migrations. The store replaces the whole set per save
-- (DELETE-then-INSERT); with no transaction, a failure between the two leaves the set EMPTY rather
-- than stale, and re-ticking is one tap per box. See setStoryCompetencies for why that trade
-- stands here and would NOT stand for the sketches themselves.
--
-- Both parents cascade. From `story`, so a story's ticks die with the story and one DELETE is the
-- whole erasure. From `competency`, so a competency that vanishes under a re-handover takes its
-- ticks with it rather than leaving a dangling row — a dangling tick would make a competency the
-- candidate no longer has raw material for keep reading as covered, and the story gap would point
-- at the wrong part of the job. The story itself survives that, with no covers, and the editor
-- says so in plain words.
CREATE TABLE story_competency (
  story_id      TEXT NOT NULL REFERENCES story(id) ON DELETE CASCADE,
  competency_id TEXT NOT NULL REFERENCES competency(id) ON DELETE CASCADE,
  PRIMARY KEY (story_id, competency_id)
);
CREATE INDEX story_competency_by_competency ON story_competency (competency_id);
