-- The home board's order is shared again (app/order-actions.ts), in each
-- entity's sort_order. The newest arrangement anybody saved at each level in
-- card_orders becomes that shared order, so what the last person to drag saw
-- is what everybody now sees. Cards not in it keep their sort_order and sort
-- after by name. card_orders is left as it is, unread.
UPDATE "objectives" AS t SET "sort_order" = u.ord::integer - 1
FROM (
  SELECT x.id, x.ord
  FROM (SELECT "ordered_ids" FROM "card_orders" WHERE "level" = 'objective' ORDER BY "updated_at" DESC LIMIT 1) AS latest,
       unnest(string_to_array(latest."ordered_ids", ',')) WITH ORDINALITY AS x(id, ord)
) AS u
WHERE t."id" = u.id;
--> statement-breakpoint
UPDATE "initiatives" AS t SET "sort_order" = u.ord::integer - 1
FROM (
  SELECT x.id, x.ord
  FROM (SELECT "ordered_ids" FROM "card_orders" WHERE "level" = 'initiative' ORDER BY "updated_at" DESC LIMIT 1) AS latest,
       unnest(string_to_array(latest."ordered_ids", ',')) WITH ORDINALITY AS x(id, ord)
) AS u
WHERE t."id" = u.id;
--> statement-breakpoint
UPDATE "projects" AS t SET "sort_order" = u.ord::integer - 1
FROM (
  SELECT x.id, x.ord
  FROM (SELECT "ordered_ids" FROM "card_orders" WHERE "level" = 'project' ORDER BY "updated_at" DESC LIMIT 1) AS latest,
       unnest(string_to_array(latest."ordered_ids", ',')) WITH ORDINALITY AS x(id, ord)
) AS u
WHERE t."id" = u.id;
