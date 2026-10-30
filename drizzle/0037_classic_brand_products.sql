-- Taxonomy Comparison, FROM → GPC (30 October 2026): Classic advertiser → VX0
-- product links, so a Classic advertiser can reach creatives. See src/db/schema.ts.
CREATE TABLE IF NOT EXISTS "classic_brand_products" (
	"advertiser_id" integer NOT NULL,
	"vx_product_id" integer NOT NULL,
	CONSTRAINT "classic_brand_products_advertiser_id_vx_product_id_pk" PRIMARY KEY("advertiser_id","vx_product_id")
);
