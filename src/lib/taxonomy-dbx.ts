/**
 * Taxonomy Comparison: VX1, VX2 and GPC, read from Databricks (mrdpp_prod, US).
 *
 * The three taxonomies share one set of dollars. Spend sits on the
 * occurrence; each occurrence names a creative; each taxonomy assigns the
 * creative to an advertiser in its own way. So a difference between VX1, VX2
 * and GPC is always a difference in assignment or coverage, never in what a
 * dollar is. Mapped on 29 October 2026:
 *
 *   VX1  gold.creative.vx1_product_id → brandcentral.product → advertiser
 *        (source_advertiser_id is the VX1 id). CDC tables: ACTIVE rows only.
 *        A parent company is offered too, id "P<source_company_id>": P&G's
 *        spend sits under brand-named advertisers that only meet at the parent.
 *   VX2  gold.creative.vx2_product_id → vx2_taxonomy.d_product.PRSEQ →
 *        d_advertiser (by CODE; ID is the advertiser id).
 *   GPC  global_catalog.creative_entity (Advertiser role, has_spend) →
 *        entity. An entity's spend includes its children's (materialized_path),
 *        and a creative with several advertisers is split evenly among them so
 *        nothing is counted twice.
 *
 *   Digital, Social, CTV  gold.digital_gold_occurrence.final_spend by
 *        capture_month. Social = source channels 17, 18; CTV = 15, 16, 20, 21,
 *        22; Digital = the rest.
 *   Linear TV  gold.tv_gold_occurrence: final_cost once occurrence_state = 4,
 *        else prelim_cost, by broadcast_date.
 *   Print is not compared (lib/taxonomy-rules.ts MEDIA_TYPES).
 *
 * Names searched travel as named parameters. Ids are checked to be integers
 * before they are written into a statement.
 */
import { databricksConfig, DatabricksError, dbxQuery } from './databricks'
import { addToGrid, compactName, MONTHS, namePatterns, type Candidate, type Grid, type MediaType, type Month, type Taxonomy } from './taxonomy-rules'

type Dbx = Exclude<Taxonomy, 'Classic'>
type OnWait = (seconds: number) => void | Promise<void>

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

// Exact names first, then the biggest; twelve per name and taxonomy.
const TOP = `QUALIFY row_number() OVER (PARTITION BY tax, input ORDER BY CASE WHEN regexp_replace(lower(name), '[^a-z0-9]', '') = k THEN 0 ELSE 1 END, size DESC) <= 12`

const vxCandidatesSql = (values: string) => `
WITH pats AS (${values}),
a AS (SELECT pt.input, pt.k, a.advertiser_id, a.source_advertiser_id, a.advertiser_n FROM pats pt
  JOIN mrdpp_prod.brandcentral.advertiser a ON a.record_status_flag = 'ACTIVE' AND regexp_replace(lower(a.advertiser_n), '[^a-z0-9]', '') LIKE pt.pat),
p AS (SELECT advertiser_id, count(DISTINCT source_product_id) n, max_by(parent_company_id, source_product_id) parent
  FROM mrdpp_prod.brandcentral.product WHERE record_status_flag = 'ACTIVE' AND advertiser_id IN (SELECT advertiser_id FROM a) GROUP BY 1),
vx1 AS (SELECT 'VX1' tax, a.input, a.k, cast(a.source_advertiser_id AS string) id, a.advertiser_n name, coalesce(p.n, 0) size, co.company_n parent
  FROM a LEFT JOIN p ON p.advertiser_id = a.advertiser_id
  LEFT JOIN (SELECT source_company_id, max(company_n) company_n FROM mrdpp_prod.brandcentral.company WHERE record_status_flag = 'ACTIVE' GROUP BY 1) co
    ON co.source_company_id = p.parent AND p.parent <> 9999),
vx1p AS (SELECT 'VX1' tax, pt.input, pt.k, concat('P', co.source_company_id) id, co.company_n name, count(DISTINCT p.source_product_id) size, 'parent company' parent
  FROM pats pt
  JOIN (SELECT source_company_id, max(company_n) company_n FROM mrdpp_prod.brandcentral.company WHERE record_status_flag = 'ACTIVE' AND source_company_id <> 9999 GROUP BY 1) co
    ON regexp_replace(lower(co.company_n), '[^a-z0-9]', '') LIKE pt.pat
  JOIN mrdpp_prod.brandcentral.product p ON p.record_status_flag = 'ACTIVE' AND p.parent_company_id = co.source_company_id
  GROUP BY ALL),
v2 AS (SELECT pt.input, pt.k, a.ID, a.NAME, a.CODE FROM pats pt
  JOIN mrdpp_prod.vx2_taxonomy.d_advertiser a ON regexp_replace(lower(a.NAME), '[^a-z0-9]', '') LIKE pt.pat AND a.DEACTIVATED_ON IS NULL),
vx2 AS (SELECT 'VX2' tax, v2.input, v2.k, cast(v2.ID AS string) id, v2.NAME name, count(pr.PRSEQ) size, cast(NULL AS string) parent
  FROM v2 LEFT JOIN mrdpp_prod.vx2_taxonomy.d_product pr ON pr.PRINST = v2.CODE GROUP BY ALL),
u AS (SELECT tax, input, k, id, max(name) name, max(size) size, max(parent) parent FROM (SELECT * FROM vx1 UNION ALL SELECT * FROM vx1p UNION ALL SELECT * FROM vx2) GROUP BY ALL)
SELECT * FROM u ${TOP}`

const gpcCandidatesSql = (values: string) => `
WITH pats AS (${values}),
hits AS (SELECT DISTINCT pt.input, pt.k, e.entity_id, e.display_name, e.parent_entity_id FROM pats pt
  JOIN mrdpp_prod.global_catalog.entity e ON regexp_replace(lower(e.display_name), '[^a-z0-9]', '') LIKE pt.pat),
direct AS (SELECT entity_id, count(*) n FROM mrdpp_prod.global_catalog.creative_entity WHERE has_spend AND entity_role = 'Advertiser' GROUP BY 1),
subtree AS (SELECT int(anc) entity_id, sum(d.n) n FROM direct d
  JOIN mrdpp_prod.global_catalog.entity e ON e.entity_id = d.entity_id
  LATERAL VIEW explode(split(e.materialized_path, '[.]')) x AS anc
  WHERE int(anc) IN (SELECT entity_id FROM hits) GROUP BY 1),
u AS (SELECT 'GPC' tax, h.input, h.k, cast(h.entity_id AS string) id, h.display_name name, coalesce(s.n, 0) size,
    CASE WHEN h.parent_entity_id <> h.entity_id THEN par.display_name END parent
  FROM hits h LEFT JOIN subtree s ON s.entity_id = h.entity_id
  LEFT JOIN mrdpp_prod.global_catalog.entity par ON par.entity_id = h.parent_entity_id)
SELECT * FROM u WHERE size > 0 ${TOP}`

export async function dbxCandidates(names: string[], onWait?: OnWait): Promise<Record<Dbx, Map<string, Candidate[]>>> {
  const c = config()
  const { params, values } = patternValues(names)
  const [vx, gpc] = await Promise.all([
    dbxQuery(c, vxCandidatesSql(values), params, { onWait }),
    dbxQuery(c, gpcCandidatesSql(values), params),
  ])
  const out: Record<Dbx, Map<string, Candidate[]>> = { VX1: new Map(), VX2: new Map(), GPC: new Map() }
  for (const r of [...vx, ...gpc]) {
    const tax = r.tax as Dbx
    const size = Number(r.size ?? 0)
    const unit = tax === 'GPC' ? 'creative' : 'product'
    const list = out[tax].get(r.input!) ?? []
    list.push({
      id: r.id!,
      name: r.name ?? '',
      size: `${size.toLocaleString('en-US')} ${unit}${size === 1 ? '' : 's'}`,
      weight: size,
      level: tax === 'VX1' ? (r.parent === 'parent company' ? 'Parent company' : 'Advertiser') : undefined,
      via: r.parent === 'parent company' ? undefined : r.parent && r.parent !== r.name ? `parent "${r.parent}"` : undefined,
    })
    out[tax].set(r.input!, list)
  }
  return out
}

const ints = (ids: string[]) => ids.filter((id) => /^\d{1,12}$/.test(id))
const inList = (ids: string[]) => (ids.length ? ids.join(', ') : 'NULL')
const strList = (ids: string[]) => (ids.length ? ids.map((i) => `'${i}'`).join(', ') : 'NULL')

const MONTH_INTS = MONTHS.map((m) => m.replace('-', '')).join(', ')
const FIRST_DAY = `${MONTHS[0]}-01`
const LAST_DAY = (() => {
  const [y, m] = MONTHS[MONTHS.length - 1].split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
})()

const spendSql = (vx1: string[], vx1Parents: string[], vx2: string[], gpc: string[]) => `
WITH bc_prod AS (SELECT source_product_id vx1_product_id, max(advertiser_id) bc_advertiser_id, max(parent_company_id) parent_id FROM mrdpp_prod.brandcentral.product WHERE record_status_flag = 'ACTIVE' GROUP BY 1),
bc_adv AS (SELECT advertiser_id, source_advertiser_id vx1_id FROM mrdpp_prod.brandcentral.advertiser WHERE record_status_flag = 'ACTIVE' AND source_advertiser_id IN (${inList(vx1)})),
vx1_prod AS (
  SELECT p.vx1_product_id, cast(a.vx1_id AS string) vx1_id FROM bc_prod p JOIN bc_adv a ON a.advertiser_id = p.bc_advertiser_id
  UNION ALL
  SELECT vx1_product_id, concat('P', parent_id) FROM bc_prod WHERE parent_id IN (${inList(vx1Parents)})),
vx2_prod AS (SELECT p.PRSEQ vx2_product_id, a.ID vx2_id FROM mrdpp_prod.vx2_taxonomy.d_product p JOIN mrdpp_prod.vx2_taxonomy.d_advertiser a ON a.CODE = p.PRINST WHERE a.ID IN (${inList(vx2)})),
gpc_w AS (SELECT creative_id, entity_id, 1.0 / count(*) OVER (PARTITION BY creative_id) w FROM mrdpp_prod.global_catalog.creative_entity WHERE has_spend AND entity_role = 'Advertiser'),
crtv AS (
  SELECT 'VX1' tax, v.vx1_id id, c.creative_id, 1.0 w FROM mrdpp_prod.gold.creative c JOIN vx1_prod v ON v.vx1_product_id = c.vx1_product_id
  UNION ALL
  SELECT 'VX2', cast(v.vx2_id AS string), c.creative_id, 1.0 FROM mrdpp_prod.gold.creative c JOIN vx2_prod v ON v.vx2_product_id = c.vx2_product_id
  UNION ALL
  SELECT 'GPC', anc, g.creative_id, g.w FROM gpc_w g JOIN mrdpp_prod.global_catalog.entity e ON e.entity_id = g.entity_id
    LATERAL VIEW explode(split(e.materialized_path, '[.]')) x AS anc WHERE anc IN (${strList(gpc)})),
occ AS (
  SELECT o.creative_id, o.capture_month month,
    CASE WHEN o.source_channel_id IN (17, 18) THEN 'Social' WHEN o.source_channel_id IN (15, 16, 20, 21, 22) THEN 'CTV' ELSE 'Digital' END media,
    sum(o.final_spend) spend
  FROM mrdpp_prod.gold.digital_gold_occurrence o
  WHERE o.country_iso_2_code = 'US' AND o.capture_month IN (${MONTH_INTS}) AND NOT o.delete_flag AND o.creative_id IN (SELECT creative_id FROM crtv)
  GROUP BY ALL
  UNION ALL
  SELECT t.creative_id, int(date_format(t.broadcast_date, 'yyyyMM')), 'Linear TV', sum(CASE WHEN t.occurrence_state = 4 THEN t.final_cost ELSE t.prelim_cost END)
  FROM mrdpp_prod.gold.tv_gold_occurrence t
  WHERE t.country_iso_2_code = 'US' AND t.broadcast_date BETWEEN '${FIRST_DAY}' AND '${LAST_DAY}' AND NOT t.delete_flag AND t.creative_id IN (SELECT creative_id FROM crtv)
  GROUP BY ALL)
SELECT c.tax, c.id, o.month, o.media, sum(o.spend * c.w) spend FROM occ o JOIN crtv c ON c.creative_id = o.creative_id GROUP BY ALL`

export async function dbxSpend(ids: Record<Dbx, string[]>, onWait?: OnWait): Promise<Record<Dbx, Map<string, Grid>>> {
  const parents = ids.VX1.filter((id) => id.startsWith('P')).map((id) => id.slice(1))
  const rows = await dbxQuery(config(), spendSql(ints(ids.VX1), ints(parents), ints(ids.VX2), ints(ids.GPC)), [], { onWait })
  const out: Record<Dbx, Map<string, Grid>> = { VX1: new Map(), VX2: new Map(), GPC: new Map() }
  for (const r of rows) {
    const tax = r.tax as Dbx
    const month = `${r.month!.slice(0, 4)}-${r.month!.slice(4, 6)}` as Month
    if (!out[tax] || !(MONTHS as readonly string[]).includes(month)) continue
    const grid = out[tax].get(r.id!) ?? {}
    addToGrid(grid, r.media as MediaType, month, Number(r.spend ?? 0))
    out[tax].set(r.id!, grid)
  }
  return out
}
