-- The order one reader has dragged the home board into.
--
-- The first version of the Custom sort wrote the existing `sort_order` column
-- on initiatives, projects and workstreams, which made the arrangement the
-- portfolio's: everyone opening the board saw whatever the last person to drag
-- had decided. That is the wrong default. "These four matter to me this
-- quarter" is a reader's working order, not a fact about the programme, and
-- one shared order means two people quietly fighting over it.
--
-- WHY A ROW PER READER PER LEVEL, HOLDING THE WHOLE LIST
--
-- The alternative is a row per card — (person, level, entity, position) — which
-- is more normalised and worse here. Every write rewrites the entire list
-- anyway (see order-actions.ts for why), so the row-per-card shape turns one
-- statement into a delete and forty inserts, and it invites a half-written
-- order if any of them fails. One row, one list, one write.
--
-- Comma-separated rather than jsonb, like `project_ids` on grouping_suggestions
-- and `edited_fields` on milestones: it is read whole, written whole, and never
-- queried by element. This schema has no jsonb anywhere, for portability
-- between PGlite and Postgres.
--
-- WHY NOTHING POINTS AT people(id)
--
-- No foreign key on purpose. A stale arrangement belonging to somebody who has
-- left is a few hundred bytes nobody will ever see, and it is not worth a
-- cascade that could delete a person's row less predictably. The ids inside the
-- list are checked at read time anyway, because a project can be deleted while
-- somebody's saved order still names it.
CREATE TABLE IF NOT EXISTS "card_orders" (
  -- `people.id`, or 'local' on a development copy with auth switched off.
  "person_id" text NOT NULL,
  -- initiative | project | workstream — each board is arranged separately.
  "level" text NOT NULL,
  "ordered_ids" text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "card_orders_person_level_pk" PRIMARY KEY ("person_id", "level")
);
