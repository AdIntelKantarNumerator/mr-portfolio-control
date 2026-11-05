/**
 * Taxonomy Comparison, read from Databricks (mrdpp_prod, US).
 *
 * Every taxonomy shares one set of dollars. Spend sits on the occurrence;
 * each occurrence names a creative; each taxonomy assigns the creative to an
 * advertiser in its own way. So following a FROM advertiser's creatives into
 * GPC shows exactly where its dollars land there. Mapped 29–30 October 2026:
 *
 *   VX1  gold.creative.vx1_product_id → brandcentral.product → advertiser
 *        (source_advertiser_id is the VX1 id). CDC tables: ACTIVE rows only.
 *        A parent company is offered too, id "P<source_company_id>": P&G's
 *        spend sits under brand-named advertisers that only meet at the parent.
 *   VX2  gold.creative.vx2_product_id → vx2_taxonomy.d_product.PRSEQ →
 *        d_advertiser (by CODE; ID is the advertiser id).
 *   Classic  gold.creative.primary_product_id (VX0) in the products the
 *        Classic advertiser's brands map to (classic_brand_products, from the
 *        SQL Server's Vivvix.Product). There is no Classic id on a creative.
 *
 *   GPC advertiser and node  the GPC serving model's spend attribution
 *        (Scott, 4 November 2026), rebuilt here; see ATTRIBUTION below.
 *
 *   Digital, Social, CTV  gold.digital_gold_occurrence.final_spend by
 *        capture_month. Social = source channels 17, 18; CTV = 15, 16, 20, 21,
 *        22; Digital = the rest.
 *   Linear TV  gold.tv_gold_occurrence: final_cost once occurrence_state = 4,
 *        else prelim_cost, by broadcast_date.
 *
 * Names searched travel as named parameters. Ids are checked to be integers
 * before they are written into a statement.
 */
import { databricksConfig, DatabricksError, dbxQuery } from './databricks'
import { compactName, MONTHS, namePatterns, type Candidate, type Flow, type FromTaxonomy, type GpcBy, type MediaType, type Month } from './taxonomy-rules'

type OnWait = (seconds: number) => void | Promise<void>
type VxTaxonomy = Exclude<FromTaxonomy, 'Classic'>

/**
 * Who a creative's dollars belong to in GPC, as the serving model attributes
 * them (Scott, 4 November 2026):
 *
 *   1. Payers: the creative's creative_entity rows with has_spend. The
 *      product-level flag is ignored on purpose.
 *   2. Products: the creative's creative_product rows; each product's owner is
 *      product.entity_id.
 *   3. A payer qualifies for a product when it is the owner (distance 0) or an
 *      ancestor of the owner. Ancestors only: a sibling does not count, and
 *      neither does sharing an ultimate parent (that leaked spend between
 *      unrelated brands under Disney and Comcast).
 *   4. Each product keeps its closest qualifying payer.
 *   5. Each qualifying product takes 1 / (qualifying products) of the spend,
 *      for that payer, in that product's own taxonomy node.
 *   6. No product qualifies: the spend goes to the Unknown product, split
 *      evenly across the payers.
 *   7. A payer with no qualifying product gets nothing when another does.
 *   A creative with no payer has no GPC advertiser.
 *
 * ClickHouse reads ancestry from gpc_reference.entity_descendant. Databricks
 * has no such table, so ANCESTRY walks parent_entity_id up to ten levels (the
 * deepest chain was seven on 4 November 2026; a root is its own parent). Not
 * materialized_path: five entities kept a stale path after a move.
 *
 * ANCESTRY gives `anc` (descendant, ancestor, distance) and `root`
 * (entity_id, root_id). ATTRIBUTION then needs a CTE `cs` of creative ids and
 * gives `attr` (creative_id, entity_id, product_name, taxonomy_node_id, w, kind).
 */
const ANCESTRY_DEPTH = 10
const ANCESTRY = `
ent AS (SELECT entity_id, nullif(parent_entity_id, entity_id) par FROM mrdpp_prod.global_catalog.entity),
chain AS (SELECT e0.entity_id, array(e0.entity_id, e0.par${Array.from({ length: ANCESTRY_DEPTH - 1 }, (_, i) => `, e${i + 1}.par`).join('')}) up
  FROM ent e0${Array.from({ length: ANCESTRY_DEPTH - 1 }, (_, i) => ` LEFT JOIN ent e${i + 1} ON e${i + 1}.entity_id = e${i}.par`).join('')}),
anc AS (SELECT entity_id descendant, a ancestor, d distance FROM chain LATERAL VIEW posexplode(up) t AS d, a WHERE a IS NOT NULL),
root AS (SELECT descendant entity_id, max_by(ancestor, distance) root_id FROM anc GROUP BY 1)`
const ATTRIBUTION = `
payer AS (SELECT DISTINCT creative_id, entity_id payer FROM mrdpp_prod.global_catalog.creative_entity
  WHERE has_spend AND creative_id IN (SELECT creative_id FROM cs)),
prods AS (SELECT DISTINCT cp.creative_id, cp.product_id, p.entity_id owner, p.product_name, p.taxonomy_node_id
  FROM mrdpp_prod.global_catalog.creative_product cp JOIN mrdpp_prod.global_catalog.product p ON p.product_id = cp.product_id
  WHERE cp.creative_id IN (SELECT creative_id FROM cs)),
closest AS (SELECT pr.creative_id, pr.product_id, pr.product_name, pr.taxonomy_node_id, py.payer, a.distance
  FROM prods pr JOIN payer py ON py.creative_id = pr.creative_id
  JOIN anc a ON a.descendant = pr.owner AND a.ancestor = py.payer
  QUALIFY row_number() OVER (PARTITION BY pr.creative_id, pr.product_id ORDER BY a.distance) = 1),
attr AS (
  SELECT creative_id, payer entity_id, product_name, taxonomy_node_id, 1.0 / count(*) OVER (PARTITION BY creative_id) w,
    CASE WHEN distance = 0 THEN 'payer' ELSE 'below_payer' END kind
  FROM closest
  UNION ALL
  SELECT py.creative_id, py.payer, 'Unknown product', CAST(NULL AS int), 1.0 / count(*) OVER (PARTITION BY py.creative_id), 'unknown'
  FROM payer py LEFT ANTI JOIN closest c ON c.creative_id = py.creative_id)`

/** The label a node takes when the spend went to the Unknown product. */
const UNKNOWN_NODE = 'Unknown product'

function config() {
  const c = databricksConfig()
  if (!c) throw new DatabricksError('Databricks is not configured (DATABRICKS_HOST, DATABRICKS_HTTP_PATH, DATABRICKS_TOKEN).')
  return c
}

function patternValues(names: string[]) {
  const params: { name: string; value: string }[] = []
  const rows: string[] = []
  names.forEach((n, i) => {
    params.push({ name: `n${i}`, value: n }, { name: `k${i}`, value: compactName(n) })
    namePatterns(n).forEach((p, j) => {
      params.push({ name: `p${i}_${j}`, value: p })
      rows.push(`(:n${i}, :k${i}, :p${i}_${j})`)
    })
  })
  return { params, values: `SELECT * FROM VALUES ${rows.join(', ')} AS t(input, k, pat)` }
}

// Exact names first, then the biggest; twelve per name.
const TOP = `QUALIFY row_number() OVER (PARTITION BY input ORDER BY CASE WHEN regexp_replace(lower(name), '[^a-z0-9]', '') = k THEN 0 ELSE 1 END, size DESC) <= 12`

const vx1CandidatesSql = (values: string) => `
WITH pats AS (${values}),
a AS (SELECT pt.input, pt.k, a.advertiser_id, a.source_advertiser_id, a.advertiser_n FROM pats pt
  JOIN mrdpp_prod.brandcentral.advertiser a ON a.record_status_flag = 'ACTIVE' AND regexp_replace(lower(a.advertiser_n), '[^a-z0-9]', '') LIKE pt.pat),
p AS (SELECT advertiser_id, count(DISTINCT source_product_id) n, max_by(parent_company_id, source_product_id) parent
  FROM mrdpp_prod.brandcentral.product WHERE record_status_flag = 'ACTIVE' AND advertiser_id IN (SELECT advertiser_id FROM a) GROUP BY 1),
co AS (SELECT source_company_id, max(company_n) company_n FROM mrdpp_prod.brandcentral.company WHERE record_status_flag = 'ACTIVE' AND source_company_id <> 9999 GROUP BY 1),
adv AS (SELECT a.input, a.k, cast(a.source_advertiser_id AS string) id, a.advertiser_n name, coalesce(p.n, 0) size, co.company_n parent
  FROM a LEFT JOIN p ON p.advertiser_id = a.advertiser_id LEFT JOIN co ON co.source_company_id = p.parent),
par AS (SELECT pt.input, pt.k, concat('P', co.source_company_id) id, co.company_n name, count(DISTINCT pr.source_product_id) size, 'parent company' parent
  FROM pats pt JOIN co ON regexp_replace(lower(co.company_n), '[^a-z0-9]', '') LIKE pt.pat
  JOIN mrdpp_prod.brandcentral.product pr ON pr.record_status_flag = 'ACTIVE' AND pr.parent_company_id = co.source_company_id
  GROUP BY ALL),
u AS (SELECT input, k, id, max(name) name, max(size) size, max(parent) parent FROM (SELECT * FROM adv UNION ALL SELECT * FROM par) GROUP BY ALL)
SELECT * FROM u ${TOP}`

const vx2CandidatesSql = (values: string) => `
WITH pats AS (${values}),
v2 AS (SELECT pt.input, pt.k, a.ID, a.NAME, a.CODE FROM pats pt
  JOIN mrdpp_prod.vx2_taxonomy.d_advertiser a ON regexp_replace(lower(a.NAME), '[^a-z0-9]', '') LIKE pt.pat AND a.DEACTIVATED_ON IS NULL),
u AS (SELECT v2.input, v2.k, cast(v2.ID AS string) id, max(v2.NAME) name, count(pr.PRSEQ) size, cast(NULL AS string) parent
  FROM v2 LEFT JOIN mrdpp_prod.vx2_taxonomy.d_product pr ON pr.PRINST = v2.CODE GROUP BY ALL)
SELECT * FROM u ${TOP}`

/** FROM candidates for VX1 or VX2, by name. Classic's come from the snapshot (lib/taxonomy-run.ts). */
export async function dbxCandidates(from: VxTaxonomy, names: string[], onWait?: OnWait): Promise<Map<string, Candidate[]>> {
  const { params, values } = patternValues(names)
  const rows = await dbxQuery(config(), from === 'VX1' ? vx1CandidatesSql(values) : vx2CandidatesSql(values), params, { onWait })
  const out = new Map<string, Candidate[]>()
  for (const r of rows) {
    const size = Number(r.size ?? 0)
    const list = out.get(r.input!) ?? []
    list.push({
      id: r.id!,
      name: r.name ?? '',
      size: `${size.toLocaleString('en-US')} product${size === 1 ? '' : 's'}`,
      weight: size,
      level: from === 'VX1' ? (r.parent === 'parent company' ? 'Parent company' : 'Advertiser') : undefined,
      via: r.parent === 'parent company' ? undefined : r.parent && r.parent !== r.name ? `parent "${r.parent}"` : undefined,
    })
    out.set(r.input!, list)
  }
  return out
}

const isInt = (id: string | number) => /^\d{1,12}$/.test(String(id))
const inList = (ids: (string | number)[]) => (ids.length ? ids.join(', ') : 'NULL')

const MONTH_INTS = MONTHS.map((m) => m.replace('-', '')).join(', ')
const FIRST_DAY = `${MONTHS[0]}-01`
const LAST_DAY = (() => {
  const [y, m] = MONTHS[MONTHS.length - 1].split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
})()

/** The FROM entities' creatives, as (from_id, creative_id). */
function fromCreativesSql(from: FromTaxonomy, ids: string[], classicProducts: Map<string, number[]>): string {
  if (from === 'VX1') {
    const adv = ids.filter(isInt)
    const parents = ids.filter((id) => id.startsWith('P') && isInt(id.slice(1))).map((id) => id.slice(1))
    return `
bc_prod AS (SELECT source_product_id vx1_product_id, max(advertiser_id) a, max(parent_company_id) parent_id FROM mrdpp_prod.brandcentral.product WHERE record_status_flag = 'ACTIVE' GROUP BY 1),
bc_adv AS (SELECT advertiser_id, source_advertiser_id FROM mrdpp_prod.brandcentral.advertiser WHERE record_status_flag = 'ACTIVE' AND source_advertiser_id IN (${inList(adv)})),
from_crtv AS (
  SELECT DISTINCT cast(a.source_advertiser_id AS string) from_id, c.creative_id FROM mrdpp_prod.gold.creative c
    JOIN bc_prod p ON p.vx1_product_id = c.vx1_product_id JOIN bc_adv a ON a.advertiser_id = p.a
  UNION
  SELECT DISTINCT concat('P', p.parent_id), c.creative_id FROM mrdpp_prod.gold.creative c
    JOIN bc_prod p ON p.vx1_product_id = c.vx1_product_id WHERE p.parent_id IN (${inList(parents)}))`
  }
  if (from === 'VX2') {
    return `
from_crtv AS (
  SELECT DISTINCT cast(a.ID AS string) from_id, c.creative_id FROM mrdpp_prod.gold.creative c
    JOIN mrdpp_prod.vx2_taxonomy.d_product p ON p.PRSEQ = c.vx2_product_id
    JOIN mrdpp_prod.vx2_taxonomy.d_advertiser a ON a.CODE = p.PRINST
  WHERE a.ID IN (${inList(ids.filter(isInt))}))`
  }
  const pairs: string[] = []
  for (const id of ids.filter(isInt)) for (const p of classicProducts.get(id) ?? []) if (isInt(p)) pairs.push(`(${id}, ${p})`)
  if (!pairs.length) pairs.push('(NULL, NULL)')
  return `
links AS (SELECT * FROM VALUES ${pairs.join(', ')} AS t(from_id, product_id)),
from_crtv AS (
  SELECT DISTINCT cast(l.from_id AS string) from_id, c.creative_id FROM mrdpp_prod.gold.creative c
    JOIN links l ON l.product_id = c.primary_product_id)`
}

const flowsSql = (fromCte: string) => `
WITH ${fromCte},
occ AS (
  SELECT o.creative_id, o.capture_month month,
    CASE WHEN o.source_channel_id IN (17, 18) THEN 'Social' WHEN o.source_channel_id IN (15, 16, 20, 21, 22) THEN 'CTV' ELSE 'Digital' END media,
    sum(o.final_spend) spend
  FROM mrdpp_prod.gold.digital_gold_occurrence o
  WHERE o.country_iso_2_code = 'US' AND o.capture_month IN (${MONTH_INTS}) AND NOT o.delete_flag AND o.creative_id IN (SELECT creative_id FROM from_crtv)
  GROUP BY ALL
  UNION ALL
  SELECT t.creative_id, int(date_format(t.broadcast_date, 'yyyyMM')), 'Linear TV', sum(CASE WHEN t.occurrence_state = 4 THEN t.final_cost ELSE t.prelim_cost END)
  FROM mrdpp_prod.gold.tv_gold_occurrence t
  WHERE t.country_iso_2_code = 'US' AND t.broadcast_date BETWEEN '${FIRST_DAY}' AND '${LAST_DAY}' AND NOT t.delete_flag AND t.creative_id IN (SELECT creative_id FROM from_crtv)
  GROUP BY ALL),
cs AS (SELECT DISTINCT creative_id FROM occ),
${ANCESTRY},
${ATTRIBUTION}
SELECT f.from_id, o.month, o.media, cast(g.entity_id AS string) gpc_id, e.display_name gpc_name,
  cast(rt.entity_id AS string) gpc_parent_id, rt.display_name gpc_parent_name,
  CASE WHEN g.kind = 'unknown' THEN '${UNKNOWN_NODE}' ELSE n.industry_name END industry, n.category_name category, n.subcategory_name subcategory,
  sum(o.spend * coalesce(g.w, 1)) spend
FROM occ o JOIN from_crtv f ON f.creative_id = o.creative_id
LEFT JOIN attr g ON g.creative_id = o.creative_id
LEFT JOIN mrdpp_prod.global_catalog.taxonomy_node_flattened_view n ON n.leaf_category_node_id = g.taxonomy_node_id
LEFT JOIN mrdpp_prod.global_catalog.entity e ON e.entity_id = g.entity_id
LEFT JOIN root r ON r.entity_id = g.entity_id
LEFT JOIN mrdpp_prod.global_catalog.entity rt ON rt.entity_id = r.root_id
GROUP BY ALL`

/**
 * Where each FROM entity's Aug–Sep dollars land in GPC. `classicProducts` is
 * needed only when FROM is Classic: entity id → its VX0 product ids.
 */
export async function dbxFlows(
  from: FromTaxonomy,
  ids: string[],
  classicProducts: Map<string, number[]>,
  onWait?: OnWait,
): Promise<Map<string, Flow[]>> {
  const out = new Map<string, Flow[]>()
  if (!ids.length) return out
  const rows = await dbxQuery(config(), flowsSql(fromCreativesSql(from, ids, classicProducts)), [], { onWait })
  for (const r of rows) {
    const month = `${r.month!.slice(0, 4)}-${r.month!.slice(4, 6)}` as Month
    if (!(MONTHS as readonly string[]).includes(month)) continue
    const spend = Number(r.spend ?? 0)
    if (!spend) continue
    const list = out.get(r.from_id!) ?? []
    list.push({
      month,
      media: r.media as MediaType,
      gpcId: r.gpc_id,
      gpcName: r.gpc_name,
      gpcParentId: r.gpc_parent_id ?? r.gpc_id,
      gpcParentName: r.gpc_parent_name ?? r.gpc_name,
      industry: r.industry,
      category: r.category,
      subcategory: r.subcategory || null,
      spend,
    })
    out.set(r.from_id!, list)
  }
  return out
}

// --- the creatives behind a comparison ----------------------------------------

const occSql = (inSet: string) => `
occ AS (
  SELECT o.creative_id, o.capture_month month,
    CASE WHEN o.source_channel_id IN (17, 18) THEN 'Social' WHEN o.source_channel_id IN (15, 16, 20, 21, 22) THEN 'CTV' ELSE 'Digital' END media,
    sum(o.final_spend) spend
  FROM mrdpp_prod.gold.digital_gold_occurrence o
  WHERE o.country_iso_2_code = 'US' AND o.capture_month IN (${MONTH_INTS}) AND NOT o.delete_flag AND o.creative_id IN (${inSet})
  GROUP BY ALL
  UNION ALL
  SELECT t.creative_id, int(date_format(t.broadcast_date, 'yyyyMM')), 'Linear TV', sum(CASE WHEN t.occurrence_state = 4 THEN t.final_cost ELSE t.prelim_cost END)
  FROM mrdpp_prod.gold.tv_gold_occurrence t
  WHERE t.country_iso_2_code = 'US' AND t.broadcast_date BETWEEN '${FIRST_DAY}' AND '${LAST_DAY}' AND NOT t.delete_flag AND t.creative_id IN (${inSet})
  GROUP BY ALL)`

const [AUG, SEP] = MONTHS.map((m) => m.replace('-', ''))

const creativesSql = (fromCte: string) => `
WITH ${fromCte},
${occSql('SELECT creative_id FROM from_crtv')},
spend AS (SELECT creative_id, media, sum(CASE WHEN month = ${AUG} THEN spend END) aug, sum(CASE WHEN month = ${SEP} THEN spend END) sep FROM occ GROUP BY ALL),
cs AS (SELECT DISTINCT creative_id FROM spend),
${ANCESTRY},
${ATTRIBUTION},
adv AS (SELECT g.creative_id,
    array_join(array_sort(collect_set(concat(e.display_name, ' #', e.entity_id))), '; ') gpc_advertisers,
    array_join(array_sort(collect_set(concat(coalesce(rt.display_name, e.display_name), ' #', coalesce(rt.entity_id, e.entity_id)))), '; ') gpc_top_parents,
    array_join(array_sort(collect_list(concat(e.display_name, ' #', e.entity_id, ' <- ', g.product_name, ' (', g.kind, ', ', round(g.w * 100, 1), '%)'))), '; ') gpc_attribution
  FROM attr g
  JOIN mrdpp_prod.global_catalog.entity e ON e.entity_id = g.entity_id
  LEFT JOIN root r ON r.entity_id = g.entity_id
  LEFT JOIN mrdpp_prod.global_catalog.entity rt ON rt.entity_id = r.root_id
  GROUP BY 1),
prod AS (SELECT cp.creative_id,
    array_join(array_sort(collect_set(p.product_name)), '; ') gpc_products,
    array_join(array_sort(collect_set(concat_ws(' > ', n.industry_name, n.category_name, n.subcategory_name))), '; ') gpc_nodes
  FROM mrdpp_prod.global_catalog.creative_product cp JOIN mrdpp_prod.global_catalog.product p ON p.product_id = cp.product_id
  LEFT JOIN mrdpp_prod.global_catalog.taxonomy_node_flattened_view n ON n.leaf_category_node_id = p.taxonomy_node_id
  WHERE cp.creative_id IN (SELECT creative_id FROM from_crtv)
  GROUP BY 1)
SELECT f.from_id, s.creative_id, s.media, s.aug, s.sep,
  c.source_channel, c.provider_code, c.creative_type, c.creative_width, c.creative_height, c.creative_duration,
  c.creative_title, c.creative_headline, c.classification_type, c.gpc_classification_type,
  c.created_timestamp, c.first_seen_occurrence_timestamp, c.last_seen_timestamp,
  c.first_seen_media_property_name, c.first_seen_provider_advertiser_name, c.first_seen_provider_product_name, c.first_seen_provider_creative_link_url,
  c.primary_product_id, c.vx1_product_id, c.vx2_product_id, c.additional_multi_product_flag, c.additional_coop_product_flag,
  a.gpc_advertisers, a.gpc_top_parents, a.gpc_attribution, pr.gpc_products, pr.gpc_nodes
FROM spend s JOIN from_crtv f ON f.creative_id = s.creative_id
JOIN mrdpp_prod.gold.creative c ON c.creative_id = s.creative_id
LEFT JOIN adv a ON a.creative_id = s.creative_id
LEFT JOIN prod pr ON pr.creative_id = s.creative_id
ORDER BY f.from_id, coalesce(s.aug, 0) + coalesce(s.sep, 0) DESC`

/** Every creative with Aug–Sep spend behind the FROM entities, one row per creative and media type, with its metadata. */
export async function dbxCreatives(from: FromTaxonomy, ids: string[], classicProducts: Map<string, number[]>): Promise<Record<string, string | null>[]> {
  if (!ids.length) return []
  return dbxQuery(config(), creativesSql(fromCreativesSql(from, ids, classicProducts)), [], { large: true })
}

// --- a GPC entity's whole spend, by FROM entity --------------------------------

export interface GpcTotalRaw {
  gby: GpcBy
  key: string
  fromId: string | null
  fromName: string | null
  fromParentId: string | null
  fromParentName: string | null
  month: Month
  media: MediaType
  spend: number
}

/**
 * The chart follows one FROM entity's creatives, so a GPC entity on it shows
 * only that share. This is the other direction: ALL the Aug–Sep spend of the
 * given GPC entities (as advertisers, or as top parents), by the FROM entity
 * each creative belongs to. For Classic the FROM key is the creative's VX0
 * product; lib/taxonomy-run.ts folds products into Classic advertisers.
 */
function gpcTotalsSql(from: FromTaxonomy, advIds: string[], parentIds: string[]): string {
  const vx1 = `fa AS (SELECT c.creative_id, cast(a.source_advertiser_id AS string) from_id, a.advertiser_n from_name,
      CASE WHEN p.parent_id <> 9999 THEN concat('P', p.parent_id) END from_parent_id, co.company_n from_parent_name
    FROM mrdpp_prod.gold.creative c
    JOIN (SELECT source_product_id, max(advertiser_id) a, max(parent_company_id) parent_id FROM mrdpp_prod.brandcentral.product WHERE record_status_flag = 'ACTIVE' GROUP BY 1) p ON p.source_product_id = c.vx1_product_id
    JOIN mrdpp_prod.brandcentral.advertiser a ON a.advertiser_id = p.a AND a.record_status_flag = 'ACTIVE'
    LEFT JOIN (SELECT source_company_id, max(company_n) company_n FROM mrdpp_prod.brandcentral.company WHERE record_status_flag = 'ACTIVE' GROUP BY 1) co ON co.source_company_id = p.parent_id
    WHERE c.creative_id IN (SELECT creative_id FROM g))`
  const vx2 = `fa AS (SELECT c.creative_id, cast(a.ID AS string) from_id, a.NAME from_name, cast(NULL AS string) from_parent_id, cast(NULL AS string) from_parent_name
    FROM mrdpp_prod.gold.creative c
    JOIN mrdpp_prod.vx2_taxonomy.d_product p ON p.PRSEQ = c.vx2_product_id
    JOIN mrdpp_prod.vx2_taxonomy.d_advertiser a ON a.CODE = p.PRINST
    WHERE c.creative_id IN (SELECT creative_id FROM g))`
  const classic = `fa AS (SELECT c.creative_id, cast(c.primary_product_id AS string) from_id, cast(NULL AS string) from_name, cast(NULL AS string) from_parent_id, cast(NULL AS string) from_parent_name
    FROM mrdpp_prod.gold.creative c WHERE c.creative_id IN (SELECT creative_id FROM g) AND c.primary_product_id IS NOT NULL)`
  const fa = from === 'VX1' ? vx1 : from === 'VX2' ? vx2 : classic
  // Classic keys are products, folded into advertisers afterwards, so they are not capped here.
  const cap = from === 'Classic' ? 1000000 : 40
  return `
WITH ${ANCESTRY},
targets AS (SELECT descendant entity_id FROM anc WHERE ancestor IN (${inList(parentIds)}) UNION SELECT entity_id FROM ent WHERE entity_id IN (${inList(advIds)})),
cs AS (SELECT DISTINCT creative_id FROM mrdpp_prod.global_catalog.creative_entity WHERE has_spend AND entity_id IN (SELECT entity_id FROM targets)),
${occSql('SELECT creative_id FROM cs')},
${ATTRIBUTION},
g AS (
  SELECT 'advertiser' gby, cast(entity_id AS string) gpc_key, creative_id, w FROM attr WHERE entity_id IN (${inList(advIds)})
  UNION ALL
  SELECT 'parent', cast(r.root_id AS string), attr.creative_id, attr.w FROM attr JOIN root r ON r.entity_id = attr.entity_id
  WHERE r.root_id IN (${inList(parentIds)})),
${fa},
r AS (SELECT g.gby, g.gpc_key, fa.from_id, fa.from_name, fa.from_parent_id, fa.from_parent_name, o.month, o.media, sum(o.spend * g.w) spend
  FROM occ o JOIN g ON g.creative_id = o.creative_id LEFT JOIN fa ON fa.creative_id = o.creative_id GROUP BY ALL),
t AS (SELECT *, dense_rank() OVER (PARTITION BY gby, gpc_key ORDER BY tot DESC, from_id) rk
  FROM (SELECT *, sum(spend) OVER (PARTITION BY gby, gpc_key, from_id) tot FROM r))
SELECT gby, gpc_key,
  CASE WHEN rk <= ${cap} THEN from_id ELSE 'OTHER' END from_id,
  CASE WHEN rk <= ${cap} THEN from_name END from_name,
  CASE WHEN rk <= ${cap} THEN from_parent_id END from_parent_id,
  CASE WHEN rk <= ${cap} THEN from_parent_name END from_parent_name,
  month, media, sum(spend) spend
FROM t GROUP BY ALL`
}

export async function dbxGpcTotals(from: FromTaxonomy, advIds: string[], parentIds: string[], onWait?: OnWait): Promise<GpcTotalRaw[]> {
  const adv = [...new Set(advIds.filter(isInt))]
  const parents = [...new Set(parentIds.filter(isInt))]
  if (!adv.length && !parents.length) return []
  const rows = await dbxQuery(config(), gpcTotalsSql(from, adv, parents), [], { onWait, large: true })
  const out: GpcTotalRaw[] = []
  for (const r of rows) {
    const month = `${r.month!.slice(0, 4)}-${r.month!.slice(4, 6)}` as Month
    const spend = Number(r.spend ?? 0)
    if (!(MONTHS as readonly string[]).includes(month) || !spend) continue
    out.push({
      gby: r.gby as GpcBy,
      key: r.gpc_key!,
      fromId: r.from_id,
      fromName: r.from_name,
      fromParentId: r.from_parent_id,
      fromParentName: r.from_parent_name,
      month,
      media: r.media as MediaType,
      spend,
    })
  }
  return out
}
