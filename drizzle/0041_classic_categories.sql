-- Classic's categories, for the Industry View's "Compare to" (10 November
-- 2026). Loaded with the rest of the Classic snapshot (npm run load:classic)
-- from the SQL Server the web app cannot reach:
--   classic_categories     magradar_public.productCategories, enabled only
--   classic_brand_spend    Aug-Sep 2026 spend by brand, with the brand's one
--                          category (DW.BrandCategoryInfo) and its top company
--   classic_vx_categories  VX0 product -> Classic category, through the brand
--                          Vivvix.Product maps it to: how GPC's creatives (which
--                          carry a VX0 primary_product_id) land in Classic
CREATE TABLE IF NOT EXISTS "classic_categories" (
  "id" integer PRIMARY KEY NOT NULL,
  "parent_id" integer,
  "name" text NOT NULL,
  "depth" integer NOT NULL,
  "chain" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "classic_brand_spend" (
  "brand_id" integer NOT NULL,
  "brand_name" text NOT NULL,
  "advertiser_id" integer NOT NULL,
  "advertiser_name" text NOT NULL,
  "category_id" integer,
  "media_type" text NOT NULL,
  "month" text NOT NULL,
  "spend" double precision NOT NULL,
  CONSTRAINT "classic_brand_spend_pk" PRIMARY KEY ("brand_id", "advertiser_id", "media_type", "month")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "classic_brand_spend_category_idx" ON "classic_brand_spend" ("category_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "classic_vx_categories" (
  "vx_product_id" integer NOT NULL,
  "category_id" integer NOT NULL,
  CONSTRAINT "classic_vx_categories_pk" PRIMARY KEY ("vx_product_id", "category_id")
);
