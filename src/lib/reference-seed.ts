/**
 * What the two Reference screens start with.
 *
 * WHERE THIS CAME FROM
 *
 * The map was assembled on 1 October 2026 from five documents supplied for the
 * purpose: the "GPC - Before, Intermediate, After" deck (whose seven stages are
 * the groups), the End to End Architecture slide, the GPC workflow and logo
 * recognition draw.io diagrams, the Vivvix Central workflow pages in
 * Confluence, and the clickhouse-serving repository. It was reviewed as a mock
 * before it was written here. Owners are first guesses and are the thing most
 * worth correcting.
 *
 * The datasets, database statuses and table notes come from the GPC Serving
 * Model document (28 September 2026), a live read of Dev ClickHouse on
 * 1 October, and three decisions made that day:
 *
 *   - gpc_* plus entitlement and entitlement_ref are the client contract.
 *   - Cube and VX1 serving are being eliminated. The VX1 databases stay
 *     visible for the transition, marked as such.
 *   - entitlement_scope and entitlement_future_archive are superseded;
 *     backups, scratch tables and the lab/perftest/staging databases are out.
 *
 * WHY A MODULE AND NOT A MIGRATION
 *
 * This is data people will edit within the week. A migration that inserts it
 * would re-insert it on a fresh database long after the real map had moved
 * on, and the seed would quietly become a second source of truth. The script
 * that applies it (scripts/seed-reference.ts) only fills tables that are empty,
 * so it can run after every deploy and never overwrite a person's edit.
 *
 * Generated once from the reviewed mock, then maintained by hand. Keys are
 * stable slugs so links can name their ends without database ids.
 */
import type { ComponentKind } from './workflow-map'
import type { DatabaseStatus, EmptyReason, Intent } from './dictionary-rules'

export interface SeedGroup {
  key: string
  name: string
  kind: 'software' | 'human'
}

export interface SeedComponent {
  key: string
  name: string
  kind: ComponentKind
  group: string
  owner: string | null
  description: string | null
  detail: string | null
  aliases: string | null
  isData: boolean
}

export interface SeedDataset {
  name: string
  owner: string | null
  description: string
  intentDev: Intent
  intentProd: Intent
  explainedBy: string | null
  tables: string[]
}

export interface SeedDatabase {
  name: string
  status: DatabaseStatus
  description: string
}

export interface SeedTableNote {
  tableRef: string
  description?: string
  watchOut?: string
  emptyReason?: EmptyReason
  excluded?: boolean
}

export interface SeedColumnNote {
  tableRef: string
  column: string
  description?: string
  meaning?: string
  watchOut?: string
  source?: string
}

export const SEED_GROUPS: SeedGroup[] = [
  { key: "col", name: "Collect & Capture", kind: "software" },
  { key: "ing", name: "Ingest", kind: "software" },
  { key: "cls", name: "Classify", kind: "software" },
  { key: "ops", name: "Vivvix Central Operations", kind: "human" },
  { key: "map", name: "Map + Spend", kind: "software" },
  { key: "tax", name: "Taxonomy, Rules & Catalog", kind: "human" },
  { key: "etl", name: "Store + ETL", kind: "software" },
  { key: "qa", name: "Data QA & Ownership Review", kind: "human" },
  { key: "srv", name: "Serve", kind: "software" },
  { key: "ent", name: "Entitlements", kind: "software" },
  { key: "pm", name: "Product Management", kind: "human" },
  { key: "app", name: "Apps & Agents", kind: "software" },
  { key: "cs", name: "Client Success & Sales", kind: "human" },
]

export const SEED_COMPONENTS: SeedComponent[] = [
  // Collect & Capture
  {
    key: "deeplisten",
    name: "DeepListen TV",
    kind: "software",
    group: "col",
    owner: "Collection",
    description: "Broadcast capture for TV, CTV and live sports. Also the upload source for the logo recognition pipeline that produces sponsorship placements.",
    detail: null,
    aliases: "deeplisten, broadcast capture, tv capture",
    isData: false,
  },
  {
    key: "providers",
    name: "Third-Party Providers",
    kind: "software",
    group: "col",
    owner: "Collection",
    description: "External occurrence feeds for the media we do not capture ourselves. Each provider maps to a source_channel the loaders filter on.",
    detail: "TROI and others",
    aliases: "provider, feed, troi, third party",
    isData: false,
  },
  {
    key: "ratings",
    name: "Ratings Feeds",
    kind: "software",
    group: "col",
    owner: "Collection",
    description: "TV ratings used for impressions and audience measures on TV occurrences.",
    detail: "Nielsen · VideoAmp",
    aliases: "nielsen, videoamp, ratings, impressions",
    isData: false,
  },
  {
    key: "vx1col",
    name: "Legacy VX1 / VX2 Collection",
    kind: "software",
    group: "col",
    owner: "Collection",
    description: "Platform-specific collection for 360 and Magnifier. Retired in the end state once GPC collection covers it.",
    detail: null,
    aliases: "vx1 collection, vx2 collection, legacy collection",
    isData: false,
  },
  {
    key: "mrcol",
    name: "Legacy MR Collection",
    kind: "software",
    group: "col",
    owner: "Collection",
    description: "MediaRadar collection feeding the Seller platform. Print coverage is the go-forward source for all platforms.",
    detail: null,
    aliases: "mr collection, print collection",
    isData: false,
  },
  // Ingest
  {
    key: "ingest",
    name: "Ingestion Layer",
    kind: "software",
    group: "ing",
    owner: "Data Platform",
    description: "Lands creatives and occurrences in raw storage, checks md5 for new creatives, and runs the Occurrence Summarizer that decides where a creative goes next.",
    detail: "raw storage · Occurrence Summarizer",
    aliases: "ingestion, raw, summarizer, landing",
    isData: false,
  },
  {
    key: "mfs",
    name: "Media File Service",
    kind: "software",
    group: "ing",
    owner: "Platform",
    description: "Stores creative files and serves asset paths to the apps. ClickHouse carries no asset paths by design.",
    detail: null,
    aliases: "media file, assets, creative api",
    isData: false,
  },
  {
    key: "uca",
    name: "Universal Creative API",
    kind: "software",
    group: "ing",
    owner: "Platform",
    description: "Copies a converted creative into staging, creates thumbnails and keyframes, and hands the creative to the automation tools.",
    detail: "staging · derivative assets",
    aliases: "uca, creative api, staging, thumbnails",
    isData: false,
  },
  {
    key: "dedupe",
    name: "Fingerprint Dedupe",
    kind: "software",
    group: "ing",
    owner: "ML",
    description: "Matches a new creative to an existing parent by signature. Writes dedupe_map in VXcentral and feeds creative_root_map downstream. A new match triggers reclassification and reattribution of the parent.",
    detail: "dedupe_map · creative_root_map",
    aliases: "dedupe, deduplication, fingerprint, parent creative",
    isData: false,
  },
  // Classify
  {
    key: "queues",
    name: "Class-Engine Queues",
    kind: "software",
    group: "cls",
    owner: "ML",
    description: "Service Bus queues per medium that carry classification requests to the engines and responses back.",
    detail: "Azure Service Bus · digital-social, tv, avod, others",
    aliases: "queue, service bus, class-engine",
    isData: false,
  },
  {
    key: "gpcce",
    name: "GPC Class Engine",
    kind: "software",
    group: "cls",
    owner: "ML",
    description: "The go-forward classifier. Assigns products, and so taxonomy, to creatives for all media and all countries. Applies the rulebook.",
    detail: "classification_gpc_jobs",
    aliases: "classifier, class engine, gpc engine, classify data, classification",
    isData: false,
  },
  {
    key: "vx0ce",
    name: "VX0 Class Engine",
    kind: "software",
    group: "cls",
    owner: "ML",
    description: "The previous classification engine. Still runs alongside GPC during Phase 1; its results are mapped to VX1 and VX2 vocabularies.",
    detail: "legacy · co-exists in Phase 1",
    aliases: "vx0, legacy classifier",
    isData: false,
  },
  {
    key: "nsfw",
    name: "NSFW Classifier",
    kind: "software",
    group: "cls",
    owner: "ML",
    description: "Flags unsafe creatives on arrival. Applied by the Populate Creative stored procedure.",
    detail: null,
    aliases: "nsfw, safety",
    isData: false,
  },
  {
    key: "junk",
    name: "JunkAd Classifier",
    kind: "software",
    group: "cls",
    owner: "ML",
    description: "Removes non-ads and chaff before classification.",
    detail: null,
    aliases: "junk, chaff, junk ad",
    isData: false,
  },
  {
    key: "attrsvc",
    name: "Attribution Service",
    kind: "software",
    group: "cls",
    owner: "ML",
    description: "Proposes creative attributes, the observed elements, from image, audio and video. Human attribution users confirm or correct in Vivvix Central.",
    detail: "creative attributes · elements",
    aliases: "attribution, creative attributes, elements, attributes",
    isData: false,
  },
  {
    key: "logo",
    name: "Logo Recognition Engine",
    kind: "software",
    group: "cls",
    owner: "ML",
    description: "Detects sponsor logos in broadcast programs using the logo library and VX1 advertiser and brand data. Produces sponsorship placements for review, then bronze and gold placement tables.",
    detail: "Logo Library · sponsorship_placements",
    aliases: "logo, sponsorship, logo recognition, sports sponsorship",
    isData: false,
  },
  {
    key: "vxcui",
    name: "Vivvix Central UI",
    kind: "software",
    group: "cls",
    owner: "VXC team",
    description: "The operations application: one set of screens for all media types, queue-driven. Classification, attribution, QA, mapping, product creation and sponsorship review all happen here.",
    detail: "media-agnostic · becomes Creative Central",
    aliases: "vxc, vivvix central, creative central, ops ui",
    isData: false,
  },
  {
    key: "vxcsp",
    name: "VXcentral Stored Procedures",
    kind: "software",
    group: "cls",
    owner: "VXC team",
    description: "Postgres jobs that copy parent classification to children, force manual classification where required, apply NSFW and junk results, and move everything else to the classification queues.",
    detail: "Populate Creative · Classify_Creatives · 15-min CRON",
    aliases: "stored procedure, cron, populate creative, classify creatives",
    isData: false,
  },
  // Vivvix Central Operations
  {
    key: "clsq",
    name: "Classification Queues",
    kind: "human",
    group: "ops",
    owner: "Operations",
    description: "Human classifiers work the queues the stored procedures fill: primary product, then secondary products where the ad type requires it.",
    detail: "manual classification · HiTL QC",
    aliases: "manual classification, classifiers, hitl, classification queue",
    isData: false,
  },
  {
    key: "attrq",
    name: "Attribution Users",
    kind: "human",
    group: "ops",
    owner: "Operations",
    description: "Confirm or correct the proposed creative attributes. A creative is in one queue at a time: attribution first, then QA.",
    detail: null,
    aliases: "attribution users, attribute entry",
    isData: false,
  },
  {
    key: "qaq",
    name: "Classification & Attribution QA",
    kind: "human",
    group: "ops",
    owner: "Operations",
    description: "Sampled review driven by the QA filter levels per module and creative type. Changing a primary product in QA sends the creative back through the attribution filters.",
    detail: "QA filters · sampling parameters",
    aliases: "qa, quality, qa filters, sampling",
    isData: false,
  },
  {
    key: "mapq",
    name: "Mapping Users",
    kind: "human",
    group: "ops",
    owner: "Operations",
    description: "Map provider records to products where auto-mapping fails. Mapping QA works at the record grain, which may carry many creatives.",
    detail: "records, not creatives",
    aliases: "mapping, mapping qa, provider records",
    isData: false,
  },
  {
    key: "prodcreate",
    name: "Product Creation",
    kind: "human",
    group: "ops",
    owner: "Operations",
    description: "Level 3 classifiers create provisional products that are reviewed before they become catalog. Volume outgrew the original workflow with VX2 Digital.",
    detail: "500+ new products a day",
    aliases: "product creation, new products, provisional",
    isData: false,
  },
  {
    key: "sponsrev",
    name: "Sponsorship Review Screen",
    kind: "human",
    group: "ops",
    owner: "Operations",
    description: "Manual QA of logo detections per program before placements move to the Databricks bronze layer.",
    detail: null,
    aliases: "sponsorship review, logo qa",
    isData: false,
  },
  {
    key: "ews",
    name: "Editorial Workstation",
    kind: "human",
    group: "ops",
    owner: "Operations",
    description: "Corrects and aligns TV occurrence, show and schedule data after classification and before it is published to the gold layer.",
    detail: "TV corrections before gold",
    aliases: "ews, editorial, tv corrections, schedule",
    isData: false,
  },
  // Taxonomy, Rules & Catalog
  {
    key: "taxo",
    name: "Industry Taxonomy",
    kind: "human",
    group: "tax",
    owner: "Taxonomy team",
    description: "Maintains the industry tree: industry group, industry, category, subcategory. Level 3 \"Major\" has no rows while Insights Studio leads with it.",
    detail: "taxonomy_node · 733 · levels 1–4",
    aliases: "taxonomy, industry, category, major",
    isData: false,
  },
  {
    key: "rule",
    name: "Classification Rulebook",
    kind: "rule",
    group: "tax",
    owner: "Taxonomy team",
    description: "The written rules for how creatives in each industry are classified and which ad types need secondary products. Automotive covers dealer, dealer association and manufacturer roles.",
    detail: "rules: Automotive, Pharma, Retail…",
    aliases: "rules, classification rules, automotive, rulebook",
    isData: false,
  },
  {
    key: "prodcat",
    name: "Product Catalog Stewardship",
    kind: "human",
    group: "tax",
    owner: "Taxonomy team",
    description: "Owns the entity hierarchy and product lines in the global catalog, and the review of provisional products.",
    detail: "product · product_line · entity hierarchy",
    aliases: "catalog, product line, entity hierarchy, brand",
    isData: false,
  },
  // Map + Spend
  {
    key: "catalog",
    name: "Global Catalog",
    kind: "software",
    group: "map",
    owner: "VXC team",
    description: "The transactional system of record: creative, creative_entity (who paid), creative_product (what was advertised), productcentral and gpc_catalog. Everything downstream is built from it.",
    detail: "Postgres VXcentral · creative_entity · creative_product",
    aliases: "global_catalog, vxcentral, postgres, catalog, creative_entity, creative_product",
    isData: true,
  },
  {
    key: "cdc",
    name: "Debezium CDC Sync",
    kind: "software",
    group: "map",
    owner: "Data Platform",
    description: "Change-data capture from the Postgres catalog toward Databricks, alongside the 20-minute sync jobs.",
    detail: null,
    aliases: "cdc, debezium, sync",
    isData: false,
  },
  {
    key: "spend",
    name: "Spend Process",
    kind: "software",
    group: "map",
    owner: "Data Platform",
    description: "Applies rate cards and models to occurrences to produce spend. For sponsorship, assigns show, episode, league and broadcaster, then calculates seconds on screen and units.",
    detail: "+ Final Spend Calculation for sponsorship",
    aliases: "spend, cost, rate card, modelled value",
    isData: false,
  },
  {
    key: "vxmap",
    name: "VX0 → VX1 / VX2 / MR Mapping",
    kind: "software",
    group: "map",
    owner: "Data Platform",
    description: "Maps VX0 classifications into each legacy platform's vocabulary. Creatives with a pending mapping wait in silver.holding and are re-processed.",
    detail: "legacy · pending mappings hold in silver",
    aliases: "vx0 mapping, company mapping, legacy mapping",
    isData: false,
  },
  // Store + ETL
  {
    key: "gold",
    name: "Databricks Gold Layer",
    kind: "software",
    group: "etl",
    owner: "Data Platform",
    description: "The medallion gold layer on Delta. The GPC load path reads mrdpp_prod.gold, global_catalog and reference, and a guard in the loader allows nothing else. The gold_360_citus tables that fed VX1 serving go with it.",
    detail: "mrdpp_prod.gold · global_catalog · reference",
    aliases: "gold, databricks, medallion, gold layer, delta",
    isData: false,
  },
  {
    key: "iceberg",
    name: "Gold on Iceberg",
    kind: "software",
    group: "etl",
    owner: "Data Platform",
    description: "The planned unified data platform: Apache Iceberg tables with dbt and Trino, operated in-house.",
    detail: "end state · dbt · Trino",
    aliases: "iceberg, dbt, trino, lakehouse",
    isData: false,
  },
  {
    key: "gpcetl",
    name: "GPC Load Path",
    kind: "software",
    group: "etl",
    owner: "Data Platform",
    description: "The GPC build in the clickhouse-serving repo. Mirrors gold into gpc_raw with the scope predicate written into each table comment, builds media levels, property groups, the ownership map and creative roots, then detail per medium per axis, the summaries, and cross-media last. Month list is discovered from raw, never hardcoded. No audit table of its own yet; the dictionary needs one.",
    detail: "scripts/gpc · rebuild_everything.sh",
    aliases: "gpc etl, loader, clickhouse-serving, rebuild, gpc load path",
    isData: false,
  },
  {
    key: "legacyetl",
    name: "Legacy Platform ETLs",
    kind: "software",
    group: "etl",
    owner: "Data Platform",
    description: "The per-platform pipelines feeding 360, Magnifier and MR Seller. Collapsed into one in the end state.",
    detail: "TV Digital Social CTV · OMNIS · Radio + Outdoor",
    aliases: "legacy etl, omnis, 360 etl, magnifier etl",
    isData: false,
  },
  {
    key: "mdb",
    name: "Property Group Builder",
    kind: "software",
    group: "etl",
    owner: "Data Platform",
    description: "Builds property_group by normalising leaf property names: 29,542 leaves become 20,809 groups. No upstream equivalent exists, so this rule is the only place media grouping lives.",
    detail: "rules: name-normalised grouping",
    aliases: "media grouping, group media, property group, publisher grouping",
    isData: false,
  },
  // Data QA & Ownership Review
  {
    key: "review",
    name: "Ownership Review Queue",
    kind: "human",
    group: "qa",
    owner: "Data Ops",
    description: "Confirms proposed property-group-to-owner mappings. Only confirmed and auto rows are visible to queries, so this queue decides ownership coverage. Television was 0% on 28 September; 1,065 rows have been auto-confirmed since.",
    detail: "1 Oct: 4,352 proposed · 1,065 auto · 18 confirmed",
    aliases: "ownership, media owner, review queue, property owner",
    isData: false,
  },
  {
    key: "triage",
    name: "Anomaly Triage",
    kind: "human",
    group: "qa",
    owner: "Data Ops",
    description: "Investigates volume and spend anomalies flagged by the nightly audits before summaries are published.",
    detail: "control.nightly_audit · data_quality_audit",
    aliases: "anomaly, audit, triage, data quality",
    isData: false,
  },
  // Serve
  {
    key: "chgpc",
    name: "ClickHouse (GPC)",
    kind: "software",
    group: "srv",
    owner: "Data Platform",
    description: "The go-forward client-consumable model: gpc_raw, gpc_reference, gpc_mapping, gpc_creative, gpc_detail, gpc_summary, gpc_entitlement. Dev today; Prod to come.",
    detail: "gpc_* · 7 schemas · 176 tables",
    aliases: "clickhouse, gpc clickhouse, serving, gpc_summary, gpc_detail",
    isData: true,
  },
  {
    key: "mcp",
    name: "MCP Server",
    kind: "software",
    group: "srv",
    owner: "Platform",
    description: "Exposes the served data to agents as tools, forwarding the real per-caller identity so entitlement scope still applies. Reads a user's default competitive set from user_profile. Query and tool-call audit lands in mcp_audit.",
    detail: "mcp_svc_prod · user_profile · mcp_audit",
    aliases: "mcp, agent access, tools, user profile",
    isData: false,
  },
  {
    key: "dapi",
    name: "Data Consumption API",
    kind: "software",
    group: "srv",
    owner: "Integrations",
    description: "Client-facing API over the summaries, applying entitlement scope per account. Feeds the Data Cloud.",
    detail: null,
    aliases: "api, data api, consumption api, delivery api",
    isData: false,
  },
  {
    key: "legacy360",
    name: "Legacy Serving (being eliminated)",
    kind: "software",
    group: "srv",
    owner: "Data Platform",
    description: "Everything that served clients before GPC and is being eliminated: the VX1 ClickHouse databases (summary, detail, reference, creative, control) and their cron-driven nightly pipeline, the Cube semantic layer, and the per-platform stores behind 360, Magnifier, MR Seller and Creative Intel. Kept on the map so a change today shows what it still touches.",
    detail: "VX1 ClickHouse · Cube · 360 SQL Server · Citus · OMNIS · Elasticsearch",
    aliases: "vx1, legacy serving, nightly, summary database, sql server, citus, omnis, elasticsearch, cube, legacy stores",
    isData: false,
  },
  {
    key: "solr",
    name: "Solr Search Index",
    kind: "software",
    group: "srv",
    owner: "Data Platform",
    description: "Search index behind Magnifier and its offline report engine.",
    detail: "Magnifier",
    aliases: "solr, search index, magnifier search",
    isData: false,
  },
  // Entitlements
  {
    key: "entpub",
    name: "Entitlement Publisher",
    kind: "software",
    group: "ent",
    owner: "Entitlements",
    description: "Resolves each account's package into pre-computed scope tables and pushes them from Postgres. A republish is a new scope_version, never an edit.",
    detail: "account_scope · scope_version",
    aliases: "entitlement service, scope, publish entitlements",
    isData: false,
  },
  {
    key: "gpcent",
    name: "GPC Data Entitlements",
    kind: "software",
    group: "ent",
    owner: "Entitlements",
    description: "The three go-forward entitlement databases in ClickHouse: per-account scope keyed by scope_version, features and filter sets, and their lookups. Postgres holds what was sold; ClickHouse holds the resolved answer. The model is still shifting.",
    detail: "gpc_entitlement · entitlement · entitlement_ref",
    aliases: "entitlements, gpc_entitlement, packages, account scope, field permissions",
    isData: true,
  },
  {
    key: "legacyent",
    name: "Legacy Entitlements",
    kind: "software",
    group: "ent",
    owner: "Entitlements",
    description: "Three separate entitlement systems, one per platform. Replaced by GPC Data Entitlements.",
    detail: "360 · Magnifier · MR",
    aliases: "legacy entitlements, 360 entitlements, magnifier entitlements",
    isData: false,
  },
  // Apps & Agents
  {
    key: "is",
    name: "GPC Insight Studio",
    kind: "software",
    group: "app",
    owner: "Insights Studio",
    description: "The one Insight Studio of the end state. Reads ClickHouse through the entitlement scope. Media grouping, filters, saved reports and export all live here.",
    detail: "media grouping · filters · saved reports · export",
    aliases: "insight studio, insights studio, app, dashboards, filters, export, saved reports",
    isData: false,
  },
  {
    key: "agents",
    name: "Agentic Experience",
    kind: "software",
    group: "app",
    owner: "Platform",
    description: "Agents and skills over the MCP Server, giving users and internal agents the same data access as the app.",
    detail: "MCP Server + Agents · skills, tools, memory",
    aliases: "agents, agentic, skills, copilots",
    isData: false,
  },
  {
    key: "datacloud",
    name: "GPC Data Cloud",
    kind: "software",
    group: "app",
    owner: "Integrations",
    description: "Client data delivery: feeds and scheduled exports built on the Data Consumption API. Replaces 360 Data Cloud, Magnifier custom feeds and MR client feeds.",
    detail: "client feeds · scheduled delivery",
    aliases: "data cloud, client feeds, scheduled exports, delivery",
    isData: false,
  },
  {
    key: "legacyapps",
    name: "Legacy Apps",
    kind: "software",
    group: "app",
    owner: "Product",
    description: "The current client applications, each on its own stack, including Insight Studio VX1 on the VX1 serving databases. All converge on GPC Insight Studio.",
    detail: "Insight Studio VX1 · 360 · Magnifier · MR Seller",
    aliases: "360, magnifier, mr seller, insight studio vx1, legacy apps, pub intel",
    isData: false,
  },
  // Entitlements
  {
    key: "entapi",
    name: "Entitlement API",
    kind: "software",
    group: "ent",
    owner: "Insights Studio",
    description: "The one place entitlement is enforced. Lives in the client application, resolves the caller to an account and scope_version, and applies the resolved scope to every data request from the app, the Data Consumption API and the MCP Server.",
    detail: "managed in the client app · replaces Cube",
    aliases: "entitlement api, access control, scope enforcement, who sees what",
    isData: false,
  },
  // Serve
  {
    key: "grafana",
    name: "Grafana Monitoring",
    kind: "software",
    group: "srv",
    owner: "Data Platform",
    description: "Dashboards over the ClickHouse system tables through a SQL-managed read-only user on Prod. Deployed with the cluster through ArgoCD. Needs a GPC load audit to watch once the VX1 control tables go.",
    detail: "grafana_ro_prod · system tables",
    aliases: "grafana, monitoring, alerting, ops dashboards",
    isData: false,
  },
  // Apps & Agents
  {
    key: "creativeintel",
    name: "Creative Intel",
    kind: "software",
    group: "app",
    owner: "Product",
    description: "The creative-level product, running on Elasticsearch fed from gold creative and digital occurrences. Moving onto the ClickHouse creative database is designed but not built; that pipeline runs manually as a POC.",
    detail: "Elasticsearch today · creative db planned",
    aliases: "creative intel, creative search, elasticsearch",
    isData: false,
  },
  // Product Management
  {
    key: "pkgdef",
    name: "Package Definition",
    kind: "rule",
    group: "pm",
    owner: "Product Management",
    description: "Defines what each client package includes: media, countries, fields, lookback, features. Any change republishes every affected account scope.",
    detail: "rules: Entitlement packages",
    aliases: "package, entitlement package, pricing, packaging",
    isData: false,
  },
  // Client Success & Sales
  {
    key: "onb",
    name: "Client Onboarding",
    kind: "human",
    group: "cs",
    owner: "Client Success",
    description: "Sets up each new account's package and trains users on the current dimensions and groupings.",
    detail: null,
    aliases: "onboarding, training, account setup",
    isData: false,
  },
  {
    key: "comms",
    name: "Release Comms",
    kind: "human",
    group: "cs",
    owner: "Client Success",
    description: "Tells clients what changed and when. Needed whenever a dimension, grouping or classification they rely on moves.",
    detail: null,
    aliases: "release notes, comms, client communication",
    isData: false,
  },
  {
    key: "train",
    name: "Sales Enablement",
    kind: "human",
    group: "cs",
    owner: "Sales",
    description: "Keeps the package sheet and demo data current with what is actually served.",
    detail: null,
    aliases: "sales, enablement, package sheet",
    isData: false,
  },
]

/** [from, to]: a change to `from` can reach `to`. */
export const SEED_LINKS: [string, string][] = [
  ["deeplisten", "ingest"], ["deeplisten", "logo"], ["providers", "ingest"], ["ratings", "ingest"],
  ["vx1col", "ingest"], ["mrcol", "ingest"], ["ingest", "mfs"], ["ingest", "uca"],
  ["uca", "dedupe"], ["uca", "queues"], ["uca", "nsfw"], ["uca", "junk"],
  ["uca", "attrsvc"], ["queues", "gpcce"], ["queues", "vx0ce"], ["gpcce", "vxcsp"],
  ["vx0ce", "vxcsp"], ["nsfw", "vxcsp"], ["junk", "vxcsp"], ["dedupe", "vxcsp"],
  ["vxcui", "clsq"], ["vxcui", "attrq"], ["vxcui", "qaq"], ["vxcui", "mapq"],
  ["vxcui", "prodcreate"], ["vxcui", "sponsrev"], ["attrsvc", "attrq"], ["logo", "sponsrev"],
  ["taxo", "catalog"], ["taxo", "gpcce"], ["rule", "gpcce"], ["rule", "clsq"], ["rule", "catalog"], ["prodcat", "catalog"],
  ["vxcsp", "catalog"], ["vxcsp", "vxcui"], ["clsq", "catalog"], ["attrq", "catalog"], ["qaq", "catalog"],
  ["mapq", "catalog"], ["prodcreate", "catalog"], ["sponsrev", "catalog"], ["ews", "gold"],
  ["catalog", "cdc"], ["catalog", "gold"], ["cdc", "gold"], ["spend", "gold"],
  ["vxmap", "legacyetl"], ["catalog", "vxmap"], ["gold", "gpcetl"], ["gold", "legacyetl"],
  ["gold", "iceberg"], ["gold", "mdb"], ["gpcetl", "review"], ["mdb", "review"],
  ["gpcetl", "triage"], ["review", "chgpc"], ["triage", "chgpc"], ["gpcetl", "chgpc"],
  ["legacyetl", "legacy360"], ["legacyetl", "solr"], ["pkgdef", "entpub"], ["pkgdef", "legacyent"],
  ["entpub", "gpcent"], ["chgpc", "mcp"], ["chgpc", "dapi"], ["chgpc", "is"],
  ["legacy360", "legacyapps"], ["solr", "legacyapps"], ["legacyent", "legacyapps"], ["gpcent", "entapi"],
  ["entapi", "is"], ["entapi", "mcp"], ["entapi", "dapi"], ["legacy360", "creativeintel"],
  ["chgpc", "grafana"], ["gold", "legacy360"], ["mcp", "agents"], ["dapi", "datacloud"],
  ["is", "onb"], ["is", "comms"], ["datacloud", "onb"], ["agents", "comms"],
  ["legacyapps", "onb"], ["gpcent", "train"],
]

export const SEED_DATASETS: SeedDataset[] = [
  {
    name: "Sports Sponsorship",
    owner: "Data Platform",
    description: "Logo exposure in sports broadcasts: who sponsored, which asset, for how long, and its modelled value. A different grain from an airing.",
    intentDev: "awaiting_feed",
    intentProd: "planned",
    explainedBy: "1 Oct: 829k placements landed in gpc_raw.sponsorship_gold_placements; not yet built into detail or summaries",
    tables: [
      "gpc_raw.sponsorship_gold_placements",
      "gpc_detail.sports_sponsorship_entity_detail",
      "gpc_summary.sports_sponsorship_entity_summary_daily",
      "gpc_summary.sports_sponsorship_entity_summary_month",
      "gpc_reference.sponsorship_asset",
      "gpc_reference.sponsorship_asset_category",
      "gpc_reference.sponsorship_detection_source",
      "gpc_reference.sponsorship_segment_type",
      "gpc_reference.sports_entity",
    ],
  },
  {
    name: "Television",
    owner: "Data Platform",
    description: "National, cable, spot, syndication and Spanish-language TV. Occurrence detail per axis and daily and monthly rollups.",
    intentDev: "loaded",
    intentProd: "planned",
    explainedBy: "Watch: 0% property ownership coverage on TV",
    tables: [
      "gpc_detail.tv_entity_detail",
      "gpc_detail.tv_product_detail",
      "gpc_summary.tv_entity_summary_daily",
      "gpc_summary.tv_entity_summary_month",
      "gpc_summary.tv_product_summary_daily",
      "gpc_summary.tv_product_summary_month",
      "gpc_raw.tv_gold_occurrence",
      "gpc_raw.tv_gold_occurrence_syndication",
    ],
  },
  {
    name: "CTV / AVOD",
    owner: "Data Platform",
    description: "Connected TV and ad-supported streaming. The largest detail tables on the instance.",
    intentDev: "loaded",
    intentProd: "planned",
    explainedBy: null,
    tables: [
      "gpc_detail.avod_entity_detail",
      "gpc_detail.avod_product_detail",
      "gpc_summary.avod_entity_summary_daily",
      "gpc_summary.avod_entity_summary_month",
      "gpc_summary.avod_product_summary_daily",
      "gpc_summary.avod_product_summary_month",
      "gpc_raw.ctv_occurrence",
    ],
  },
  {
    name: "Digital · Display, Video, Social",
    owner: "Data Platform",
    description: "Browser display, browser video and social placements from the digital gold occurrence feed.",
    intentDev: "loaded",
    intentProd: "planned",
    explainedBy: null,
    tables: [
      "gpc_detail.display_entity_detail",
      "gpc_detail.display_product_detail",
      "gpc_summary.display_entity_summary_daily",
      "gpc_summary.display_entity_summary_month",
      "gpc_summary.display_product_summary_daily",
      "gpc_summary.display_product_summary_month",
      "gpc_detail.video_entity_detail",
      "gpc_detail.video_product_detail",
      "gpc_summary.video_entity_summary_daily",
      "gpc_summary.video_entity_summary_month",
      "gpc_summary.video_product_summary_daily",
      "gpc_summary.video_product_summary_month",
      "gpc_detail.social_entity_detail",
      "gpc_detail.social_product_detail",
      "gpc_summary.social_entity_summary_daily",
      "gpc_summary.social_entity_summary_month",
      "gpc_summary.social_product_summary_daily",
      "gpc_summary.social_product_summary_month",
      "gpc_raw.digital_gold_occurrence",
    ],
  },
  {
    name: "Print",
    owner: "Data Platform",
    description: "Magazine and newspaper occurrences. Tables exist with the 20 print-specific columns.",
    intentDev: "awaiting_feed",
    intentProd: "planned",
    explainedBy: null,
    tables: [
      "gpc_detail.print_entity_detail",
      "gpc_detail.print_product_detail",
      "gpc_summary.print_entity_summary_daily",
      "gpc_summary.print_entity_summary_month",
      "gpc_summary.print_product_summary_daily",
      "gpc_summary.print_product_summary_month",
    ],
  },
  {
    name: "Radio",
    owner: "Data Platform",
    description: "Local radio occurrences.",
    intentDev: "awaiting_feed",
    intentProd: "planned",
    explainedBy: null,
    tables: [
      "gpc_detail.radio_entity_detail",
      "gpc_detail.radio_product_detail",
      "gpc_summary.radio_entity_summary_daily",
      "gpc_summary.radio_entity_summary_month",
      "gpc_summary.radio_product_summary_daily",
      "gpc_summary.radio_product_summary_month",
    ],
  },
  {
    name: "Local Cable",
    owner: "Data Platform",
    description: "Local cable occurrences.",
    intentDev: "awaiting_feed",
    intentProd: "planned",
    explainedBy: null,
    tables: [
      "gpc_detail.localcable_entity_detail",
      "gpc_detail.localcable_product_detail",
      "gpc_summary.localcable_entity_summary_daily",
      "gpc_summary.localcable_entity_summary_month",
      "gpc_summary.localcable_product_summary_daily",
      "gpc_summary.localcable_product_summary_month",
    ],
  },
  {
    name: "Out of Home",
    owner: "Data Platform",
    description: "Outdoor placements.",
    intentDev: "awaiting_feed",
    intentProd: "planned",
    explainedBy: null,
    tables: [
      "gpc_detail.ooh_entity_detail",
      "gpc_detail.ooh_product_detail",
      "gpc_summary.ooh_entity_summary_daily",
      "gpc_summary.ooh_entity_summary_month",
      "gpc_summary.ooh_product_summary_daily",
      "gpc_summary.ooh_product_summary_month",
    ],
  },
  {
    name: "Summary-only media",
    owner: null,
    description: "Search, cinema, outdoor, network radio and NSR have summary tables and no detail table by design. None are loaded.",
    intentDev: "undecided",
    intentProd: "undecided",
    explainedBy: "Decision needed: awaiting a feed, or will never populate?",
    tables: [
      "gpc_summary.search_entity_summary_daily",
      "gpc_summary.search_entity_summary_month",
      "gpc_summary.search_product_summary_daily",
      "gpc_summary.search_product_summary_month",
      "gpc_summary.cinema_entity_summary_daily",
      "gpc_summary.cinema_entity_summary_month",
      "gpc_summary.cinema_product_summary_daily",
      "gpc_summary.cinema_product_summary_month",
      "gpc_summary.outdoor_entity_summary_daily",
      "gpc_summary.outdoor_entity_summary_month",
      "gpc_summary.outdoor_product_summary_daily",
      "gpc_summary.outdoor_product_summary_month",
      "gpc_summary.networkradio_entity_summary_daily",
      "gpc_summary.networkradio_entity_summary_month",
      "gpc_summary.networkradio_product_summary_daily",
      "gpc_summary.networkradio_product_summary_month",
      "gpc_summary.nsr_entity_summary_daily",
      "gpc_summary.nsr_entity_summary_month",
      "gpc_summary.nsr_product_summary_daily",
      "gpc_summary.nsr_product_summary_month",
    ],
  },
  {
    name: "Cross-media rollups",
    owner: "Data Platform",
    description: "Market and property summaries across all loaded media. Identical but for property_id. They drop every medium-specific column.",
    intentDev: "loaded",
    intentProd: "planned",
    explainedBy: "Trap: legacy media_type string disagrees with media_type_id",
    tables: [
      "gpc_summary.market_entity_summary_daily",
      "gpc_summary.market_entity_summary_month",
      "gpc_summary.market_product_summary_daily",
      "gpc_summary.market_product_summary_month",
      "gpc_summary.property_entity_summary_daily",
      "gpc_summary.property_entity_summary_month",
      "gpc_summary.property_product_summary_daily",
      "gpc_summary.property_product_summary_month",
    ],
  },
  {
    name: "Creative Elements",
    owner: "Classification",
    description: "The element vocabulary, which elements apply to which industry, and the values observed per creative-product link.",
    intentDev: "loaded",
    intentProd: "planned",
    explainedBy: "Candidate for entitlement packaging",
    tables: [
      "gpc_reference.master_element_definition",
      "gpc_reference.master_element_class_map",
      "gpc_reference.observed_element_definition",
      "gpc_creative.observed_element_value",
    ],
  },
  {
    name: "Property Ownership",
    owner: "Data Ops",
    description: "Leaf properties, name-normalised groups, and the group-to-owner map that the review queue confirms.",
    intentDev: "loaded",
    intentProd: "planned",
    explainedBy: "1 Oct: 1,083 of 5,435 owner mappings visible (auto or confirmed); TV was 0% on 28 Sep",
    tables: [
      "gpc_reference.property",
      "gpc_reference.property_group",
      "gpc_mapping.property_group_entity_map",
    ],
  },
  {
    name: "Live Events",
    owner: null,
    description: "Live event occurrences are mirrored raw, but no served table or definition exists yet.",
    intentDev: "undecided",
    intentProd: "undecided",
    explainedBy: "Decision needed: what counts as a live event",
    tables: [
      "gpc_raw.live_events_gold_occurrence",
      "gpc_reference.live_event_type",
      "gpc_reference.sports_entity",
    ],
  },
  {
    name: "Entitlements",
    owner: "Entitlements",
    description: "What each account may see, read by the Entitlement API in the client app: pre-computed per-account scope, the feature and filter-set model, and their lookups. The model is still shifting.",
    intentDev: "loaded",
    intentProd: "planned",
    explainedBy: "gpc_entitlement's database comment still says placeholder; its tables are loaded",
    tables: [
      "gpc_entitlement.account_scope",
      "gpc_entitlement.account_row_scope",
      "gpc_entitlement.account_media",
      "gpc_entitlement.account_country",
      "gpc_entitlement.account_media_country_withheld",
      "gpc_entitlement.account_field",
      "gpc_entitlement.account_provider_block",
      "entitlement.application_feature",
      "entitlement.feature",
      "entitlement.filter",
      "entitlement.filterset",
      "entitlement.usrset",
      "entitlement.usrset_feature",
      "entitlement.entmaj",
      "entitlement.entmaj_dimension_map",
      "entitlement.majmin",
      "entitlement_ref.country",
      "entitlement_ref.language",
      "entitlement_ref.market",
      "entitlement_ref.region",
    ],
  },
]

// ---------------------------------------------------------------------------
// Which databases are the contract. Decided 1 October 2026.
// ---------------------------------------------------------------------------

export const SEED_DATABASES: SeedDatabase[] = [
  { name: 'gpc_reference', status: 'contract', description: 'Dimensions meant to be browsed: entity, product, taxonomy, media, property, geography.' },
  { name: 'gpc_mapping', status: 'contract', description: 'Derived mappings the platform does not supply. Built by the GPC load path; never queried directly by the app.' },
  { name: 'gpc_creative', status: 'contract', description: 'The hub: creative attributes plus the two link tables, who paid (creative_entity) and what was advertised (creative_product).' },
  { name: 'gpc_detail', status: 'contract', description: 'One row per occurrence per participant: nine media times two axes, plus sports sponsorship.' },
  { name: 'gpc_summary', status: 'contract', description: 'Daily and monthly rollups per medium and cross-media. The main read path.' },
  { name: 'gpc_entitlement', status: 'contract', description: 'Pre-computed per-account scope keyed by account and scope_version, pushed from Postgres. Read by the Entitlement API.' },
  { name: 'entitlement', status: 'contract', description: 'The feature and filter-set entitlement model: application features, filters, filter sets, user sets. Go-forward; still shifting.' },
  { name: 'entitlement_ref', status: 'contract', description: 'Lookups the entitlement model keys on: country, language, market, region. Overlaps gpc_reference; which one the app keys on is not yet stated.' },
  { name: 'gpc_raw', status: 'internal', description: 'Verbatim mirror of mrdpp_prod gold and global_catalog. Each table comment records its source and the exact scope predicate. Not part of the client contract.' },
  { name: 'summary', status: 'transition', description: 'VX1 serving: per-media daily, weekly and monthly summaries. Being eliminated with VX1 serving.' },
  { name: 'detail', status: 'transition', description: 'VX1 serving: per-media occurrence detail. Being eliminated with VX1 serving.' },
  { name: 'reference', status: 'transition', description: 'VX1 serving: the 181 reference_360 dimensions mirrored nightly. Being eliminated with VX1 serving.' },
  { name: 'creative', status: 'transition', description: 'VX1 serving: the earlier creative model behind Creative Intel. Being eliminated with VX1 serving.' },
  { name: 'control', status: 'transition', description: 'Load watermarks and audits for the VX1 nightly pipeline. Being eliminated with it; the GPC load path has no equivalent yet.' },
  { name: 'entitlement_scope', status: 'superseded', description: 'An earlier copy of the account-scope tables now in gpc_entitlement.' },
  { name: 'entitlement_future_archive', status: 'superseded', description: 'An earlier full account, package and provisioning model. Superseded.' },
  { name: 'lab', status: 'excluded', description: 'Storage tests.' },
  { name: 'perftest', status: 'excluded', description: 'Performance tests.' },
  { name: 'staging', status: 'excluded', description: 'Transient load scratch, created and dropped within each run.' },
  { name: 'default', status: 'excluded', description: 'Empty default database.' },
]

// ---------------------------------------------------------------------------
// What is known about individual tables: the GPC Serving Model's traps and
// gaps, and why each empty table is empty where that has been said.
// ---------------------------------------------------------------------------

const MEDIA_AWAITING_FEED = ['localcable', 'ooh', 'print', 'radio']
const SUMMARY_ONLY_UNDECIDED = ['cinema', 'networkradio', 'nsr', 'outdoor', 'search']
const AXES = ['entity', 'product']
const GRAINS = ['daily', 'month']

const CROSS_MEDIA_TRAP =
  'Carries both a legacy media_type string and media_type_id, and they disagree: for four media the string holds the leaf medium, for TV it holds the bucket. Filter on media_type_id.'

export const SEED_TABLE_NOTES: SeedTableNote[] = [
  // --- traps that produce a wrong number
  {
    tableRef: 'gpc_creative.creative_entity',
    description: 'Who paid for each creative: one row per creative per participating company, with the role it played.',
    watchOut:
      'has_spend is the only authority on payment. gpc_reference.entity_role.is_spender_role disagrees with it: 77,534 Advertiser links never paid and 8 Retailer links did. Detail tables INNER JOIN this table, so a missing link silently drops the occurrence. Never UNION with the product axis; the same spot is counted on both.',
  },
  {
    tableRef: 'gpc_creative.creative_product',
    description: 'What each creative advertised: one row per creative per product.',
    watchOut: 'has_spend is true on every row. product.entity_id is who makes the product, never who paid for the ad.',
  },
  {
    tableRef: 'gpc_reference.entity_role',
    description: 'Advertiser, Local Dealer, Retailer, Manufacturer, Dealer Assn.',
    watchOut:
      'is_spender_role is a property of the role, but payment is a fact about the link. Filter on creative_entity.has_spend, never on this flag. Manufacturer has never appeared in a row.',
  },
  {
    tableRef: 'gpc_summary.property_product_summary_month',
    watchOut:
      'Has no column for the advertiser who paid. "What did a dealer advertise?" returns zero rows here, because a dealer owns no products. ' + CROSS_MEDIA_TRAP,
  },
  ...['market', 'property'].flatMap((x) =>
    AXES.flatMap((axis) =>
      GRAINS.map((grain) => ({ tableRef: `gpc_summary.${x}_${axis}_summary_${grain}`, watchOut: CROSS_MEDIA_TRAP })),
    ),
  ).filter((n) => n.tableRef !== 'gpc_summary.property_product_summary_month'),
  {
    tableRef: 'gpc_reference.property_group',
    description: 'Media rollups, e.g. Hulu. 29,542 leaf properties collapse to 20,809 groups by normalised name.',
    watchOut:
      'Derived here: there is no upstream property-group concept and nothing to appeal to if a grouping is disputed. Ownership hangs off property_group_id, so a wrong grouping assigns a wrong owner to every leaf beneath it.',
  },
  {
    tableRef: 'gpc_mapping.property_group_entity_map',
    description: 'Property group to owning company, plus two levels up.',
    watchOut: 'Only confirmed and auto rows are visible to queries; proposed rows are invisible. On 1 October: 4,352 proposed, 1,065 auto, 18 confirmed. Television ownership coverage was 0% on 28 September.',
  },
  {
    tableRef: 'gpc_reference.country',
    watchOut: 'country_c is three characters and does not join to country_iso_2_code on the facts. Use country_id.',
  },
  {
    tableRef: 'gpc_reference.market',
    watchOut: 'Not the DMA: 214 distinct markets in the data against 224 DMAs, and they do not line up. There is no DMA table anywhere.',
  },
  {
    tableRef: 'gpc_reference.taxonomy_flat',
    watchOut:
      'Level 3 "Major" has no rows, but Insights Studio leads with "Total major spend". Evidence suggests their Major is our Industry. Confirm the level mapping before building share-of-market on it.',
  },
  {
    tableRef: 'gpc_reference._oldmap',
    description: 'Build-time crosswalk from the pre-27-September 43-row property table.',
    watchOut: 'Not browsable reference data; should not be in this schema.',
  },
  {
    tableRef: 'gpc_reference.catalog_source',
    watchOut: 'Duplicate of gpc_reference.source. Should be dropped.',
    emptyReason: 'undecided',
  },
  {
    tableRef: 'gpc_detail.sports_sponsorship_entity_detail',
    description: 'One detected logo placement per row, from the logo recognition pipeline.',
    watchOut: 'Different grain: logo exposure, not an airing. modelled_value_v must never be summed with cost_share_v from other detail tables.',
    emptyReason: 'awaiting_feed',
  },

  // --- why empty tables are empty
  ...MEDIA_AWAITING_FEED.flatMap((m) => [
    ...AXES.map((axis) => ({ tableRef: `gpc_detail.${m}_${axis}_detail`, emptyReason: 'awaiting_feed' as const })),
    ...AXES.flatMap((axis) =>
      GRAINS.map((grain) => ({ tableRef: `gpc_summary.${m}_${axis}_summary_${grain}`, emptyReason: 'awaiting_feed' as const })),
    ),
  ]),
  ...SUMMARY_ONLY_UNDECIDED.flatMap((m) =>
    AXES.flatMap((axis) =>
      GRAINS.map((grain) => ({ tableRef: `gpc_summary.${m}_${axis}_summary_${grain}`, emptyReason: 'undecided' as const })),
    ),
  ),
  ...GRAINS.map((grain) => ({ tableRef: `gpc_summary.sports_sponsorship_entity_summary_${grain}`, emptyReason: 'awaiting_feed' as const })),
  ...['sponsorship_asset', 'sponsorship_asset_category', 'sponsorship_detection_source', 'sponsorship_segment_type'].map((t) => ({
    tableRef: `gpc_reference.${t}`,
    emptyReason: 'awaiting_feed' as const,
  })),
  { tableRef: 'gpc_reference.live_event_type', emptyReason: 'undecided', watchOut: 'Waiting on a definition of what counts as a live event.' },
  { tableRef: 'gpc_reference.sports_entity', emptyReason: 'undecided', watchOut: 'Waiting on a definition of what counts as a live event.' },
  { tableRef: 'gpc_entitlement.account_provider_block', emptyReason: 'by_design', description: 'Providers an account may not read. None issued yet.' },
]

// ---------------------------------------------------------------------------
// Column notes, as drafts. Marked draftedBy 'seed' so the page says so until
// somebody confirms them.
// ---------------------------------------------------------------------------

export const SEED_COLUMN_NOTES: SeedColumnNote[] = [
  // gpc_creative.creative_entity — the payer side of the diamond
  { tableRef: 'gpc_creative.creative_entity', column: 'creative_entity_id', description: 'Upstream surrogate key of the link row.', source: 'global_catalog.creative_entity' },
  {
    tableRef: 'gpc_creative.creative_entity',
    column: 'creative_id',
    description: 'The ad. One row per creative per participating company.',
    meaning: 'Joins to gpc_creative.creative.',
    watchOut: 'Detail tables INNER JOIN on this. A creative with no link row silently drops its occurrences.',
    source: 'global_catalog.creative_entity',
  },
  {
    tableRef: 'gpc_creative.creative_entity',
    column: 'entity_id',
    description: 'The company on this side of the diamond.',
    meaning: 'Who paid. Compare with product.entity_id, who makes the product; they differ on about 14.5% of creatives.',
    watchOut: 'Never UNION with the product axis. The same spot is counted on both.',
    source: 'gpc_reference.entity',
  },
  { tableRef: 'gpc_creative.creative_entity', column: 'confidence_score', watchOut: 'Not described in the serving model document. Range and threshold unknown.' },
  {
    tableRef: 'gpc_creative.creative_entity',
    column: 'entity_role',
    description: 'Advertiser, Local Dealer, Retailer, Manufacturer or Dealer Assn.',
    meaning: 'Dealer roles are how automotive co-op shows up.',
    watchOut: 'A string here while gpc_reference.entity_role carries entity_role_id. The ids-or-strings rule is undecided.',
    source: 'gpc_reference.entity_role',
  },
  {
    tableRef: 'gpc_creative.creative_entity',
    column: 'has_spend',
    description: 'Whether this company paid for this creative.',
    meaning: 'The only authority on payment.',
    watchOut: 'Do not use entity_role.is_spender_role as a proxy. Nullable: what NULL means is not stated.',
  },
  { tableRef: 'gpc_creative.creative_entity', column: 'source', description: 'How the link was made.', watchOut: 'A string while gpc_reference.source exists.' },

  // gpc_reference.property_group — media grouping
  { tableRef: 'gpc_reference.property_group', column: 'property_group_id', description: 'Our id. No upstream equivalent.' },
  { tableRef: 'gpc_reference.property_group', column: 'property_group_name', description: 'Display name, e.g. Hulu.' },
  {
    tableRef: 'gpc_reference.property_group',
    column: 'canonical_key',
    description: 'The normalised leaf name the group is formed on.',
    meaning: 'The grouping rule, made visible.',
    watchOut: 'Name matching errs both ways: distinct companies sharing a name merge, and one company under two spellings stays split.',
  },
  { tableRef: 'gpc_reference.property_group', column: 'leaf_count', description: 'How many leaf properties collapsed into this group.' },

  // gpc_summary.tv_entity_summary_month — the non-additive counts
  {
    tableRef: 'gpc_summary.tv_entity_summary_month',
    column: 'occurrences',
    description: 'Distinct airings within this group.',
    watchOut: 'Computed per group. Summing across groups counts airings once per participant, not distinct airings.',
  },
  {
    tableRef: 'gpc_summary.tv_entity_summary_month',
    column: 'creatives',
    description: 'Distinct creatives within this group.',
    watchOut: 'Does not sum across groups.',
  },
  {
    tableRef: 'gpc_summary.tv_entity_summary_month',
    column: 'media_parent_entity_id',
    watchOut: 'Not a fixed rung despite the name: whatever sits immediately above the property owner. Equals media_root_entity_id on about 90% of rows.',
  },
]
