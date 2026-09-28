-- "This update is on the wrong initiative."
--
-- Yaara attaches what she reads to the work it is about, and the last of the
-- three ways she does it is a guess: the entity's name appeared in the text.
-- It is right often enough to be worth having and wrong often enough that an
-- initiative's card ends up carrying a Slack channel that has nothing to do
-- with it. Until now there was nothing to do about that. The correction lived
-- in somebody's head, the next pass made the same mistake, and the remedy on
-- offer was to stop trusting the page.
--
-- A row here is one person saying, once, where a thing actually belongs.
--
-- WHY THE SOURCE'S COORDINATES ARE COPIED IN RATHER THAN REFERENCED
--
-- `source`, `location` and `author` are what the rule will match on, and they
-- are written here as they stood when the correction was made. The evidence
-- row they came from is a snapshot of one window that will be superseded on
-- the next pass — pointing at it would leave the correction dangling within
-- the hour. What is being recorded is not "this item was wrong", it is "things
-- like this belong there", and these three columns are the "things like this".
--
-- WHY A NULL DESTINATION IS A REAL ANSWER
--
-- "This is not ours" and "this is Ratings'" are different corrections, and
-- only the second is safe to generalise. Somebody who knows a channel is not
-- theirs usually does not know whose it is, and making them name a destination
-- would make them guess — which is the failure this exists to fix, moved one
-- step along. A null right_entity_id means the evidence belongs to nothing.
--
-- WHY consumed_at RATHER THAN A DELETE
--
-- Yaara reads the unconsumed ones each pass and turns each into a routing
-- rule. Keeping the row afterwards is what makes "why is this rule here"
-- answerable months later, and what stops a failed pass losing a correction
-- somebody took the trouble to make.
CREATE TABLE IF NOT EXISTS "routing_corrections" (
  "id" text PRIMARY KEY NOT NULL,
  -- Where it was wrongly attached. Kept for the audit trail and so the same
  -- correction is not offered twice on the same card.
  "wrong_entity_type" text NOT NULL,
  "wrong_entity_id" text NOT NULL,
  -- Where it belongs. Both null together means "nothing".
  "right_entity_type" text,
  "right_entity_id" text,
  -- The coordinates a rule will match on.
  "source" text NOT NULL,
  "location" text,
  "author" text,
  -- The evidence that prompted it, for the trail. Not a foreign key: the
  -- observation it belongs to is replaced on the next pass.
  "evidence_id" text,
  "evidence_title" text,
  -- Why, in the words of whoever made the correction.
  "note" text,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  -- When Yaara turned it into a rule, and which rule she made.
  "consumed_at" timestamp with time zone,
  "rule_id" text
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "routing_corrections_pending_idx"
  ON "routing_corrections" ("consumed_at", "created_at");
