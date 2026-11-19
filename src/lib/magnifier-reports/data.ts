/**
 * Magnifier Offline Reports: every ClickHouse read (Prod, the GPC serving model,
 * since 19 November 2026: Dev dropped its GPC databases; see lib/gpc-clickhouse.ts).
 *
 * All spend comes from the creative summaries, so a creative can be followed
 * from any total down to its ad:
 *   creative.creative_product_summary_monthly     month x creative x paying entity x product x property x market
 *   creative.creative_product_summary_daily       the same by day (weeks for FastTrack, the occurrence list)
 *   creative.creative                             title, lead text, first audio, AI summary
 *   reference.taxonomy_node                       the GPC taxonomy tree (ids match the summaries' *_id columns)
 * Spend is cost_share_v, the spend model's share for the paying entity and
 * product. Promos and PSAs are left out the simplest way (Scott, 16 November
 * 2026: "whatever is easiest"): the flag is only on TV airings
 * (detail.tv_product_detail), so a creative is dropped when most of its TV
 * spend in the months read is flagged. That lands within about 1% of the
 * exact flagged spend.
 *
 * Every request goes through lib/clickhouse.ts (SELECT only, readonly=2).
 * Values travel as query parameters; ids are checked to be whole numbers
 * before they are used. Results are kept for half an hour per process, which
 * is plenty for a prototype on data that loads overnight.
 */
import { chQuery } from '@/lib/clickhouse'
import { GPC_TABLES, gpcClickhouseConfig, requireGpcClickhouse } from '@/lib/gpc-clickhouse'
import { addDays, completeMonths, LEVEL_SQL, monthSlices, type CubeRow, type Level, type TaxNode, type Who } from './rules'

const MONTH = GPC_TABLES.creativeMonthly
const DAILY = GPC_TABLES.creativeDaily
// Prod ClickHouse refuses a max_execution_time above 60 (SETTING_CONSTRAINT_VIOLATION, 19 November 2026).
const SETTINGS = { max_execution_time: '60', max_bytes_before_external_group_by: '2000000000' }
const TTL = 30 * 60_000

const cache = new Map<string, { at: number; value: Promise<unknown> }>()
/**
 * A read kept for half an hour. `big` reads (the Excel downloads' detail
 * tables, up to 100,000 rows) are never kept: holding them is what a small
 * App Service plan cannot afford (17 November 2026).
 */
function kept<T>(key: string, read: () => Promise<T>, big = false): Promise<T> {
  if (big) return read()
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL) return hit.value as Promise<T>
  const value = read()
  cache.set(key, { at: Date.now(), value })
  // A failed read is not kept: the next visit tries again.
  value.catch(() => cache.delete(key))
  if (cache.size > 400) cache.delete(cache.keys().next().value!)
  return value
}

export const configured = () => Boolean(gpcClickhouseConfig())

/**
 * The Excel downloads' big reads (a whole industry group, every week since August). They had four
 * minutes on Dev; Prod allows no more than 60 seconds for any query, so they get the same as the rest.
 */
const LONG = { ...SETTINGS }

function q<T>(sql: string, params: Record<string, string> = {}, long = false): Promise<T[]> {
  return chQuery<T>(requireGpcClickhouse(), sql, params, long ? LONG : SETTINGS)
}

const n = (v: unknown) => Number(v) || 0
const whole = (v: number) => {
  if (!Number.isInteger(v)) throw new Error(`Not a whole number: ${v}`)
  return v
}

/** What a report is scoped to. */
export interface Scope {
  node: number
  level: Level
  /** Narrow to one media (a media_name), or every media. */
  media?: string | null
  /** Narrow to one advertiser (or parent, by `who`). */
  adv?: number | null
  who?: Who
}

/** Creatives that are mostly promos or PSAs in these months (see the note at the top). */
const notPromo = (ms: number[]) =>
  `creative_id NOT IN (SELECT creative_id FROM ${GPC_TABLES.tvAirings} WHERE year_month IN (${ymList(ms)})
     GROUP BY creative_id HAVING 2 * sumIf(cost_share_v, coalesce(is_promo, 0) = 1 OR coalesce(is_psa, 0) = 1) >= sum(cost_share_v)
       AND countIf(coalesce(is_promo, 0) = 1 OR coalesce(is_psa, 0) = 1) > 0)`

/** Every month from one year_month to another. */
function monthsBetween(from: number, to: number): number[] {
  const out: number[] = []
  for (let m = from; m <= to; m = m % 100 === 12 ? m + 89 : m + 1) out.push(m)
  return out
}

/** The WHERE clause and parameters for a scope, in these months, promos and PSAs left out. */
function where(s: Scope, ms: number[]) {
  const col = LEVEL_SQL[s.level].id
  const parts = [`${col} = {node:Int64}`, notPromo(ms)]
  const params: Record<string, string> = { node: String(whole(s.node)) }
  if (s.media) {
    parts.push('media_name = {media:String}')
    params.media = s.media
  }
  if (s.adv) {
    parts.push(`${s.who === 'parent' ? 'coalesce(entity_parent_id, entity_id)' : 'entity_id'} = {adv:Int64}`)
    params.adv = String(whole(s.adv))
  }
  return { sql: parts.join(' AND '), params }
}
const ymList = (months: number[]) => months.map(whole).join(',')
const scopeKey = (s: Scope) => `${s.level}:${s.node}:${s.media ?? ''}:${s.who ?? 'advertiser'}:${s.adv ?? ''}`

// ------------------------------------------------------------------ taxonomy

/** Which months hold every media, the latest last. */
export function months(): Promise<number[]> {
  return kept('months', async () => {
    const rows = await q<{ ym: number; media: number }>(
      `SELECT year_month AS ym, uniqExact(media_id) AS media FROM ${GPC_TABLES.creativeMediaMonthly} GROUP BY ym ORDER BY ym`,
    )
    return completeMonths(rows.map((r) => ({ ym: n(r.ym), media: n(r.media) })))
  })
}

/** The active GPC taxonomy, with each node's spend in a month (so empty nodes can be dimmed). */
export function taxonomy(ym: number): Promise<{ nodes: TaxNode[]; spend: Record<number, number> }> {
  return kept(`tax:${ym}`, async () => {
    const [nodes, spend] = await Promise.all([
      q<{ id: number; parent: number | null; level: Level; name: string }>(
        `SELECT taxonomy_node_id AS id, parent_node_id AS parent, level, name
         FROM ${GPC_TABLES.taxonomyNode}
         WHERE is_active AND level IN ('Industry Group', 'Industry', 'Category', 'Subcategory')
         ORDER BY name`,
      ),
      q<{ g: number | null; i: number | null; c: number | null; s: number | null; spend: number }>(
        `SELECT industry_group_id AS g, industry_id AS i, category_id AS c, subcategory_id AS s, sum(cost_share_v) AS spend
         FROM ${MONTH} WHERE year_month = {ym:Int32} GROUP BY g, i, c, s`,
        { ym: String(whole(ym)) },
      ),
    ])
    const total: Record<number, number> = {}
    for (const r of spend) for (const id of [r.g, r.i, r.c, r.s]) if (id != null) total[id] = (total[id] ?? 0) + n(r.spend)
    return {
      nodes: nodes.map((x) => ({ id: n(x.id), parentId: x.parent == null || n(x.parent) === n(x.id) ? null : n(x.parent), level: x.level, name: x.name })),
      spend: total,
    }
  })
}

// ------------------------------------------------------------------ the cube

/** Month x advertiser x media x child node: the dashboard, Advertisers and Media tabs all come from this. */
export function cube(s: Scope, ms: number[]): Promise<CubeRow[]> {
  const w = where({ ...s, adv: null }, ms)
  const child = LEVEL_SQL[s.level].child
  return kept(`cube:${scopeKey({ ...s, adv: null })}:${ms.join(',')}`, async () => {
    const rows = await q<Record<string, unknown>>(
      `SELECT year_month AS ym, entity_id AS aid, any(entity_name) AS aname,
              coalesce(entity_parent_id, entity_id) AS pid, any(entity_parent_name) AS pname,
              media_name AS media, coalesce(${child.id}, 0) AS cid, any(${child.name}) AS cname,
              sum(cost_share_v) AS spend, sum(occurrences) AS occ
       FROM ${MONTH}
       WHERE year_month IN (${ymList(ms)}) AND ${w.sql}
       GROUP BY ym, aid, pid, media, cid`,
      w.params,
    )
    return rows.map((r) => ({
      ym: n(r.ym), aid: n(r.aid), aname: String(r.aname ?? ''), pid: n(r.pid), pname: String(r.pname ?? ''),
      media: String(r.media ?? ''), cid: n(r.cid), cname: String(r.cname || 'Unclassified'), spend: n(r.spend), occ: n(r.occ),
    }))
  })
}

/** The same cube by week, from the daily summary (FastTrack). `ym` on each row is the week start as 20261026. */
export function weekCube(s: Scope, from: string, to: string): Promise<CubeRow[]> {
  const ymFrom = Number(from.slice(0, 7).replace('-', '')), ymTo = Number(addDays(to, 6).slice(0, 7).replace('-', ''))
  const w = where({ ...s, adv: null }, monthsBetween(ymFrom, ymTo))
  return kept(`week:${scopeKey({ ...s, adv: null })}:${from}:${to}`, async () => {
    const rows = await q<Record<string, unknown>>(
      `SELECT toYYYYMMDD(toMonday(start_date)) AS ym, entity_id AS aid, any(entity_name) AS aname,
              coalesce(entity_parent_id, entity_id) AS pid, any(entity_parent_name) AS pname,
              media_name AS media, 0 AS cid, '' AS cname, sum(cost_share_v) AS spend, sum(occurrences) AS occ
       FROM ${DAILY}
       WHERE year_month BETWEEN {ymFrom:Int32} AND {ymTo:Int32}
         AND start_date BETWEEN toDate({from:String}) AND toDate({to:String}) + 6 AND ${w.sql}
       GROUP BY ym, aid, pid, media`,
      { ...w.params, ymFrom: String(ymFrom), ymTo: String(ymTo), from, to },
    )
    return rows.map((r) => ({
      ym: n(r.ym), aid: n(r.aid), aname: String(r.aname ?? ''), pid: n(r.pid), pname: String(r.pname ?? ''),
      media: String(r.media ?? ''), cid: 0, cname: '', spend: n(r.spend), occ: n(r.occ),
    }))
  })
}

/** The Mondays of every whole week the daily summary holds from the first complete month on. */
export function weeks(firstYm: number): Promise<string[]> {
  return kept(`weeks:${firstYm}`, async () => {
    const rows = await q<{ w: string; media: number }>(
      `SELECT toString(toMonday(start_date)) AS w, uniqExact(media_id) AS media, uniqExact(start_date) AS days
       FROM ${DAILY} WHERE year_month >= {ym:Int32} GROUP BY w HAVING days = 7 ORDER BY w`,
      { ym: String(whole(firstYm)) },
    )
    const most = Math.max(0, ...rows.map((r) => n(r.media)))
    const first = `${String(firstYm).slice(0, 4)}-${String(firstYm).slice(4)}-01`
    return rows.filter((r) => n(r.media) >= most - 2 && r.w >= first).map((r) => r.w)
  })
}

// ------------------------------------------------------------------ drill-downs

/** What a drill-down reads: whole months (the monthly summary) or days from..to, inclusive (the daily one). */
export type Period = { months: number[] } | { from: string; to: string }

/** The table, the date condition and the period bucket (month, or week start as 20261026) for a period. */
function span(p: Period) {
  if ('months' in p) {
    return { table: MONTH, cond: `year_month IN (${ymList(p.months)})`, params: {} as Record<string, string>, ms: p.months, bucket: 'year_month', key: p.months.join(',') }
  }
  const ymFrom = Number(p.from.slice(0, 7).replace('-', '')), ymTo = Number(p.to.slice(0, 7).replace('-', ''))
  return {
    table: DAILY,
    cond: 'year_month BETWEEN {ymFrom:Int32} AND {ymTo:Int32} AND start_date BETWEEN toDate({from:String}) AND toDate({to:String})',
    params: { ymFrom: String(ymFrom), ymTo: String(ymTo), from: p.from, to: p.to },
    ms: monthsBetween(ymFrom, ymTo),
    bucket: 'toYYYYMMDD(toMonday(start_date))',
    key: `${p.from}..${p.to}`,
  }
}

export interface CreativeRow {
  id: string
  aid: number
  advertiser: string
  product: string
  subcategory: string
  media: string[]
  type: string
  length: number | null
  firstSeen: string | null
  spend: number
  occ: number
  advTotal: number
  title: string
  lead: string
  summary: string
  format: string
}

/** The ranges a day period is read in: a month at a time when it spans more than one (see monthSlices). */
const slicesOf = (p: Period): Period[] => ('months' in p ? [p] : monthSlices(p.from, p.to))

/** The top creatives in a period, with their text. `firstSeen` within the period marks a new ad. */
export function creatives(s: Scope, p: Period, limit = 60): Promise<CreativeRow[]> {
  const sp = span(p)
  const w = where(s, sp.ms)
  if (slicesOf(p).length > 1) return kept(`cre:${scopeKey(s)}:${sp.key}:${limit}`, () => creativesBySlice(s, p as { from: string; to: string }, limit), limit >= 1000)
  return kept(`cre:${scopeKey(s)}:${sp.key}:${limit}`, async () => {
    const rows = await q<Record<string, unknown>>(
      `WITH base AS (
         SELECT creative_id, entity_id, any(entity_name) AS advertiser, any(product_name) AS product, any(subcategory_name) AS subcategory,
                groupUniqArray(media_name) AS media, any(creative_type) AS type, max(length_v) AS length,
                min(first_seen_date) AS first_seen, sum(cost_share_v) AS spend, sum(occurrences) AS occ
         FROM ${sp.table} WHERE ${sp.cond} AND ${w.sql}
         GROUP BY creative_id, entity_id
       ),
       adv AS (SELECT entity_id, sum(spend) AS total FROM base GROUP BY entity_id),
       top AS (SELECT * FROM base ORDER BY spend DESC LIMIT ${whole(limit)})
       SELECT toString(top.creative_id) AS id, top.entity_id AS aid, advertiser, product, subcategory, media, type, length, toString(first_seen) AS first_seen,
              spend, occ, adv.total AS adv_total,
              coalesce(c.title, '') AS title, coalesce(nullIf(c.lead_text, ''), c.first_audio, '') AS lead,
              coalesce(c.ai_summary, c.summary, c.description, '') AS summary, coalesce(c.ad_format, '') AS format
       FROM top
       LEFT JOIN adv ON adv.entity_id = top.entity_id
       LEFT JOIN (SELECT creative_id, title, lead_text, first_audio, ai_summary, summary, description, ad_format
                  FROM ${GPC_TABLES.creative} WHERE creative_id IN (SELECT creative_id FROM top)) AS c ON c.creative_id = top.creative_id
       ORDER BY spend DESC`,
      { ...w.params, ...sp.params },
      limit >= 1000,
    )
    return rows.map((r) => ({
      id: String(r.id), aid: n(r.aid), advertiser: String(r.advertiser ?? ''), product: String(r.product ?? ''), subcategory: String(r.subcategory ?? ''),
      media: (r.media as string[]) ?? [], type: String(r.type ?? ''), length: r.length == null ? null : n(r.length),
      firstSeen: r.first_seen ? String(r.first_seen) : null, spend: n(r.spend), occ: n(r.occ), advTotal: n(r.adv_total),
      title: String(r.title ?? '').trim(), lead: String(r.lead ?? '').trim(), summary: String(r.summary ?? '').trim(), format: String(r.format ?? ''),
    }))
  }, limit >= 1000)
}

/**
 * creatives() for a day range longer than a month: each month is grouped by
 * creative and advertiser on its own, the months are added up here, and the
 * text is read for the top ones only. The promo rule still looks at the whole
 * range, so the result matches a single read.
 */
async function creativesBySlice(s: Scope, p: { from: string; to: string }, limit: number): Promise<CreativeRow[]> {
  const w = where(s, span(p).ms)
  type Agg = Omit<CreativeRow, 'advTotal' | 'title' | 'lead' | 'summary' | 'format'>
  const by = new Map<string, Agg>()
  for (const slice of monthSlices(p.from, p.to)) {
    const sp = span(slice)
    const rows = await q<Record<string, unknown>>(
      `SELECT toString(creative_id) AS id, entity_id AS aid, any(entity_name) AS advertiser, any(product_name) AS product, any(subcategory_name) AS subcategory,
              groupUniqArray(media_name) AS media, any(creative_type) AS type, max(length_v) AS length,
              toString(min(first_seen_date)) AS first_seen, sum(cost_share_v) AS spend, sum(occurrences) AS occ
       FROM ${sp.table} WHERE ${sp.cond} AND ${w.sql}
       GROUP BY creative_id, entity_id`,
      { ...w.params, ...sp.params },
      true,
    )
    for (const r of rows) {
      const key = `${r.id}|${r.aid}`
      const first = r.first_seen ? String(r.first_seen) : null
      const len = r.length == null ? null : n(r.length)
      const e = by.get(key)
      if (!e) {
        by.set(key, {
          id: String(r.id), aid: n(r.aid), advertiser: String(r.advertiser ?? ''), product: String(r.product ?? ''), subcategory: String(r.subcategory ?? ''),
          media: [...((r.media as string[]) ?? [])], type: String(r.type ?? ''), length: len, firstSeen: first, spend: n(r.spend), occ: n(r.occ),
        })
        continue
      }
      for (const m of (r.media as string[]) ?? []) if (!e.media.includes(m)) e.media.push(m)
      if (len != null && (e.length == null || len > e.length)) e.length = len
      if (first && (!e.firstSeen || first < e.firstSeen)) e.firstSeen = first
      e.spend += n(r.spend)
      e.occ += n(r.occ)
    }
  }
  const advTotal = new Map<number, number>()
  for (const e of by.values()) advTotal.set(e.aid, (advTotal.get(e.aid) ?? 0) + e.spend)
  const top = [...by.values()].sort((a, b) => b.spend - a.spend).slice(0, whole(limit))
  const text = new Map<string, Record<string, unknown>>()
  const ids = [...new Set(top.map((t) => t.id))].filter((id) => /^\d{1,20}$/.test(id))
  for (let i = 0; i < ids.length; i += 5000) {
    const rows = await q<Record<string, unknown>>(
      `SELECT toString(creative_id) AS id, title, lead_text, first_audio, ai_summary, summary, description, ad_format
       FROM ${GPC_TABLES.creative} WHERE creative_id IN (${ids.slice(i, i + 5000).join(',')})`,
      {},
      true,
    )
    for (const r of rows) text.set(String(r.id), r)
  }
  // The same fallbacks as the single read's SQL: the first value that is there.
  const firstOf = (...v: unknown[]) => String(v.find((x) => x != null) ?? '')
  return top.map((t) => {
    const c = text.get(t.id) ?? {}
    return {
      ...t,
      advTotal: advTotal.get(t.aid) ?? 0,
      title: firstOf(c.title).trim(),
      lead: firstOf(c.lead_text ? c.lead_text : null, c.first_audio).trim(),
      summary: firstOf(c.ai_summary, c.summary, c.description).trim(),
      format: firstOf(c.ad_format),
    }
  })
}

export interface ProductRow {
  advertiser: string
  aid: number
  category: string
  subcategory: string
  product: string
  pid: number
  media: string
  /** Spend by period: by month (202610), or by week start (20261026) for a day range. */
  byMonth: Record<number, number>
  total: number
}

/** Product x period spend (the Product|Campaign and Product|Media|Trend sheets). With `byMedia`, one row per product and media. */
export function products(s: Scope, p: Period, byMedia: boolean, limit = 400): Promise<ProductRow[]> {
  const sp = span(p)
  // The promo rule looks at the whole period even when it is read a month at a time.
  const w = where(s, sp.ms)
  return kept(`prod:${scopeKey(s)}:${sp.key}:${byMedia}:${limit}`, async () => {
    const rows: Record<string, unknown>[] = []
    for (const slice of slicesOf(p)) {
      const ss = span(slice)
      // A plain loop: spreading hundreds of thousands of rows into push() overflows the stack.
      const got = await q<Record<string, unknown>>(
          `SELECT entity_id AS aid, any(entity_name) AS advertiser, product_id AS pid, any(product_name) AS product,
                  any(category_name) AS category, any(subcategory_name) AS subcategory, ${byMedia ? 'media_name' : "''"} AS media,
                  ${ss.bucket} AS ym, sum(cost_share_v) AS spend
           FROM ${ss.table} WHERE ${ss.cond} AND ${w.sql}
           GROUP BY aid, pid, media, ym`,
          { ...w.params, ...ss.params },
          limit >= 1000,
        )
      for (const r of got) rows.push(r)
    }
    const m = new Map<string, ProductRow>()
    for (const r of rows) {
      const k = `${r.aid}|${r.pid}|${r.media}`
      const e = m.get(k) ?? { advertiser: String(r.advertiser), aid: n(r.aid), category: String(r.category ?? ''), subcategory: String(r.subcategory ?? ''), product: String(r.product), pid: n(r.pid), media: String(r.media ?? ''), byMonth: {}, total: 0 }
      e.byMonth[n(r.ym)] = (e.byMonth[n(r.ym)] ?? 0) + n(r.spend)
      e.total += n(r.spend)
      m.set(k, e)
    }
    // The biggest advertisers' products first, as the workbooks group them.
    const advTotal = new Map<number, number>()
    for (const e of m.values()) advTotal.set(e.aid, (advTotal.get(e.aid) ?? 0) + e.total)
    return [...m.values()]
      .filter((e) => e.total > 0)
      .sort((a, b) => advTotal.get(b.aid)! - advTotal.get(a.aid)! || a.aid - b.aid || b.total - a.total)
      .slice(0, limit)
  }, limit >= 1000)
}

export interface OutletRow {
  media: string
  market: string
  outlet: string
  owner: string
  byAdv: Record<number, number>
  total: number
}

/** Spend by media outlet (property) and market, split across advertisers (the MediaOutlet sheet). */
export function outlets(s: Scope, p: Period, limit = 150): Promise<OutletRow[]> {
  const sp = span(p)
  const w = where(s, sp.ms)
  const who = s.who === 'parent' ? 'coalesce(entity_parent_id, entity_id)' : 'entity_id'
  return kept(`out:${scopeKey(s)}:${sp.key}:${limit}`, async () => {
    const rows = await q<Record<string, unknown>>(
      `WITH o AS (
         SELECT media_name AS media, coalesce(property_market_name, '') AS market, media_entity_name AS outlet,
                any(media_root_entity_name) AS owner, ${who} AS adv, sum(cost_share_v) AS spend
         FROM ${sp.table} WHERE ${sp.cond} AND ${w.sql}
         GROUP BY media, market, outlet, adv
       ),
       top AS (SELECT media, market, outlet FROM o GROUP BY media, market, outlet ORDER BY sum(spend) DESC LIMIT ${whole(limit)})
       SELECT o.* FROM o INNER JOIN top USING (media, market, outlet)`,
      { ...w.params, ...sp.params },
      limit >= 1000,
    )
    const m = new Map<string, OutletRow>()
    for (const r of rows) {
      const k = `${r.media}|${r.market}|${r.outlet}`
      const e = m.get(k) ?? { media: String(r.media), market: titleCase(String(r.market || 'National')), outlet: String(r.outlet || '—'), owner: String(r.owner ?? ''), byAdv: {}, total: 0 }
      e.byAdv[n(r.adv)] = (e.byAdv[n(r.adv)] ?? 0) + n(r.spend)
      e.total += n(r.spend)
      m.set(k, e)
    }
    return [...m.values()].sort((a, b) => b.total - a.total)
  }, limit >= 1000)
}

export interface DetailRow {
  advertiser: string
  parent: string
  category: string
  subcategory: string
  product: string
  media: string
  market: string
  outlet: string
  /** 202610, or the week start as 20261026. */
  period: number
  spend: number
  occ: number
}

/** The flat table under the workbooks' pivot tables: advertiser x product x media x market x outlet x period, biggest first. */
export function detail(s: Scope, p: Period, limit = 100_000): Promise<{ rows: DetailRow[]; more: boolean }> {
  const sp = span(p)
  const w = where(s, sp.ms)
  return kept(`det:${scopeKey(s)}:${sp.key}:${limit}`, async () => {
    const rows = await q<Record<string, unknown>>(
      `SELECT any(entity_name) AS advertiser, any(entity_parent_name) AS parent, any(category_name) AS category, any(subcategory_name) AS subcategory,
              any(product_name) AS product, media_name AS media, coalesce(property_market_name, '') AS market, media_entity_name AS outlet,
              ${sp.bucket} AS period, sum(cost_share_v) AS spend, sum(occurrences) AS occ
       FROM ${sp.table} WHERE ${sp.cond} AND ${w.sql}
       GROUP BY entity_id, product_id, media, market, outlet, period
       HAVING spend > 0
       ORDER BY advertiser, product, media, period, spend DESC
       LIMIT ${whole(limit) + 1}`,
      { ...w.params, ...sp.params },
      limit >= 1000,
    )
    const list = rows.map((r) => ({
      advertiser: String(r.advertiser ?? ''), parent: String(r.parent || r.advertiser || ''), category: String(r.category ?? ''), subcategory: String(r.subcategory ?? ''),
      product: String(r.product ?? ''), media: String(r.media ?? ''), market: titleCase(String(r.market || 'National')), outlet: String(r.outlet || '—'),
      period: n(r.period), spend: n(r.spend), occ: n(r.occ),
    }))
    return { rows: list.slice(0, limit), more: list.length > limit }
  }, limit >= 1000)
}

export interface OccurrenceRow {
  date: string
  advertiser: string
  creative: string
  title: string
  media: string
  product: string
  subcategory: string
  market: string
  outlet: string
  firstSeen: string | null
  spend: number
  occ: number
}

/**
 * The occurrence list: one row per creative x outlet x market x day, from the
 * daily summary (the closest the serving model keeps to a single airing).
 */
export function occurrences(s: Scope, from: string, to: string, limit = 500): Promise<{ rows: OccurrenceRow[]; more: boolean }> {
  const ymFrom = Number(from.slice(0, 7).replace('-', '')), ymTo = Number(to.slice(0, 7).replace('-', ''))
  const w = where(s, monthsBetween(ymFrom, ymTo))
  return kept(`occ:${scopeKey(s)}:${from}:${to}:${limit}`, async () => {
    const rows = await q<Record<string, unknown>>(
      `WITH o AS (
         SELECT start_date AS d, creative_id, any(entity_name) AS advertiser, media_name AS media, any(product_name) AS product,
                any(subcategory_name) AS subcategory, coalesce(property_market_name, '') AS market, media_entity_name AS outlet,
                min(first_seen_date) AS first_seen, sum(cost_share_v) AS spend, sum(occurrences) AS occ
         FROM ${DAILY}
         WHERE year_month BETWEEN {ymFrom:Int32} AND {ymTo:Int32} AND start_date BETWEEN toDate({from:String}) AND toDate({to:String}) AND ${w.sql}
         GROUP BY d, creative_id, entity_id, media, market, outlet
         ORDER BY d DESC, spend DESC
         LIMIT ${whole(limit) + 1}
       )
       SELECT toString(d) AS date, toString(o.creative_id) AS creative, advertiser, media, product, subcategory, market, outlet,
              toString(first_seen) AS first_seen, spend, occ, coalesce(c.title, '') AS title
       FROM o LEFT JOIN (SELECT creative_id, title FROM ${GPC_TABLES.creative} WHERE creative_id IN (SELECT creative_id FROM o)) AS c
         ON c.creative_id = o.creative_id
       ORDER BY d DESC, spend DESC`,
      { ...w.params, ymFrom: String(ymFrom), ymTo: String(ymTo), from, to },
      limit >= 1000,
    )
    const list = rows.map((r) => ({
      date: String(r.date), advertiser: String(r.advertiser ?? ''), creative: String(r.creative), title: String(r.title ?? '').trim(),
      media: String(r.media ?? ''), product: String(r.product ?? ''), subcategory: String(r.subcategory ?? ''),
      market: titleCase(String(r.market || 'National')), outlet: String(r.outlet || '—'), firstSeen: r.first_seen ? String(r.first_seen) : null,
      spend: n(r.spend), occ: n(r.occ),
    }))
    return { rows: list.slice(0, limit), more: list.length > limit }
  }, limit >= 1000)
}

function titleCase(s: string) {
  return s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase())
}
