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
 *   GPC advertiser  global_catalog.creative_entity (Advertiser role,
 *        has_spend) → entity; a creative with several is split evenly. Its
 *        top parent is the root of its materialized_path.
 *   GPC node  global_catalog.creative_product → product.taxonomy_node_id →
 *        taxonomy_node_flattened_view (industry › category › subcategory);
 *        a creative with several products is split evenly.
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
import { compactName, MONTHS, namePatterns, type Candidate, type Flow, type FromTaxonomy, type MediaType, type Month } from './taxonomy-rules'

type OnWait = (seconds: number) => void | Promise<void>
type VxTaxonomy = Exclude<FromTaxonomy, 'Classic'>

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
adv AS (SELECT ce.creative_id, ce.entity_id, 1.0 / count(*) OVER (PARTITION BY ce.creative_id) w FROM mrdpp_prod.global_catalog.creative_entity ce
  WHERE ce.has_spend AND ce.entity_role = 'Advertiser' AND ce.creative_id IN (SELECT creative_id FROM from_crtv)),
cat AS (SELECT cp.creative_id, n.industry_name, n.category_name, n.subcategory_name, 1.0 / count(*) OVER (PARTITION BY cp.creative_id) w
  FROM mrdpp_prod.global_catalog.creative_product cp JOIN mrdpp_prod.global_catalog.product p ON p.product_id = cp.product_id
  LEFT JOIN mrdpp_prod.global_catalog.taxonomy_node_flattened_view n ON n.leaf_category_node_id = p.taxonomy_node_id
  WHERE cp.creative_id IN (SELECT creative_id FROM from_crtv))
SELECT f.from_id, o.month, o.media, cast(a.entity_id AS string) gpc_id, e.display_name gpc_name,
  cast(rt.entity_id AS string) gpc_parent_id, rt.display_name gpc_parent_name,
  c.industry_name industry, c.category_name category, c.subcategory_name subcategory,
  sum(o.spend * coalesce(a.w, 1) * coalesce(c.w, 1)) spend
FROM occ o JOIN from_crtv f ON f.creative_id = o.creative_id
LEFT JOIN adv a ON a.creative_id = o.creative_id
LEFT JOIN mrdpp_prod.global_catalog.entity e ON e.entity_id = a.entity_id
LEFT JOIN mrdpp_prod.global_catalog.entity rt ON rt.entity_id = int(element_at(split(e.materialized_path, '[.]'), 1))
LEFT JOIN cat c ON c.creative_id = o.creative_id
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
