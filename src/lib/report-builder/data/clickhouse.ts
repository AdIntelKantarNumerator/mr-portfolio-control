/**
 * The data adapter for ClickHouse (12 November 2026): the only place Report
 * Builder writes SQL.
 *
 * Reads the new taxonomy's summary data on Dev ClickHouse:
 * gpc_summary.property_product_summary_month (spend by month x property x
 * paying entity x product, every id with its name), and for day and week
 * detail the seven per-media daily tables, read as one union in the monthly
 * table's shape. Every request goes through lib/clickhouse.ts, which only
 * sends SELECTs and adds readonly=2.
 *
 * WHAT THE DATA IS (checked 11 November 2026)
 *   - All media only from August 2026; earlier months hold a few media, mostly
 *     streaming; the current month is partial. "Complete" months are the ones
 *     with most media present, worked out from the data each time.
 *   - 30 to 48 million rows a month, sorted by month first, so every query
 *     names its months.
 *   - Spend is cost_share_v: the spend model's share for the paying entity and
 *     product. Promos and PSAs are left out unless a query asks for them.
 *   - The daily tables add up to the monthly one, medium by medium; TV files a
 *     few days under the neighbouring broadcast month, so day queries read a
 *     month either side and keep to the days asked for.
 *   - Daypart and league (the sports entity) are recorded only in the daily
 *     tables (TV and live streaming), so any query that reads them is answered
 *     from the daily tables, even for a whole month (Scott, 12 November 2026).
 *   - Spot length and the creative itself are recorded only in the creative
 *     summaries, which add up to within 0.4% of the monthly table (October
 *     2026). A query that reads either is answered from them:
 *       gpc_creative.creative_product_media_summary_month / _daily, the
 *         smaller, when nothing else is needed;
 *       gpc_creative.creative_product_summary_month / _daily, about nine times
 *         larger, when the query also reads market or master property, which
 *         only these record (17 November 2026, for creative rows: a quarter of
 *         360 reports have them, beside market and property).
 *     Neither records program, genre, daypart or league; a creative meets those
 *     only through its airings (Scott, 17 November 2026). So a query that reads
 *     creative or spot length together with any of them is answered from the
 *     airings themselves (AIRINGS): gpc_detail.tv_product_detail, which adds up
 *     exactly to the summaries' six TV media, and live_stream_product_detail, to
 *     Live Streaming Sports (October 2026; sports_ and tv_clearance_ overlap them
 *     and are left out). Each row is one occurrence. The airings carry ids, not
 *     names: names come from labels() after the query. Only TV and live sports
 *     are in such a report, which is where programs are anyway. Direct/indirect,
 *     digital only, is in no creative table: a query that reads it with creative
 *     or spot length is refused, through supports(), before it runs.
 *     The summaries have no promo or PSA flags: a creative whose TV spend in the
 *     months read is mostly flagged as promo or PSA is left out instead (the flag
 *     is only on TV airings), within about 1% of the exact figure. The airings
 *     carry the flag, so they leave promos out exactly.
 *   - A creative's name is its title, from gpc_creative.creative, looked up
 *     after the query (creativeInfo): the summaries carry only its id.
 */
import { chQuery, clickhouseConfig, ClickHouseError, type ClickHouseConfig } from '@/lib/clickhouse'
import { DIMENSIONS, dimOf, normName, queryDims, type AggregateQuery, type AggregateResult, type Availability, type Cond, type DataAdapter, type DimKey, type MeasureKey, type NameHit, type SearchRequest } from './types'

const MONTH_TABLE = 'gpc_summary.property_product_summary_month'
const CREATIVE_MONTH = 'gpc_creative.creative_product_media_summary_month'
const CREATIVE_DAY = 'gpc_creative.creative_product_media_summary_daily'
const CREATIVE_FULL_MONTH = 'gpc_creative.creative_product_summary_month'
const CREATIVE_FULL_DAY = 'gpc_creative.creative_product_summary_daily'
/** What only the fuller creative summaries record. */
const FULL_ONLY: DimKey[] = ['market', 'master_property']
/** Where search and labels look up a dimension that the monthly table does not record. */
const LOOKUP_TABLE: Partial<Record<DimKey, string>> = { daypart: 'gpc_summary.tv_product_summary_daily', league: 'gpc_summary.tv_product_summary_daily', length: CREATIVE_MONTH, creative: CREATIVE_MONTH }
/** What a creative meets only through its airings (TV and live sports). */
const AIRING_ONLY: DimKey[] = ['program', 'program_genre', 'daypart', 'league']
/** What no creative data records at all. */
const NOT_IN_CREATIVE: DimKey[] = ['direct_indirect']
const AIRINGS_NOTE = 'Creatives with program, genre, daypart or league come from TV and live-sports airings, so other media are not in this report.'
/**
 * The airings as one source in the summaries' shape: the ids they carry, the date, one occurrence a
 * row, and every name the SQL map reads, empty (names come from labels() after the query).
 */
const AIRING_COLS = (date: string) =>
  // The summaries copy a level down where a product has none ("QSRs" is category and subcategory 404);
  // the airings leave it empty. Copied the same way, every category and subcategory matches the
  // summaries to the dollar (TV, October 2026).
  `year_month, ${date} AS start_date, industry_id, coalesce(category_id, industry_id) AS category_id, coalesce(subcategory_id, category_id, industry_id) AS subcategory_id,
   entity_id, entity_parent_id, product_id, media_id, media_root_entity_id, media_entity_id,
   property_market_id, country_id, master_property_id, show_id, show_type_id, daypart_id, sports_entity_id, language_id, length_v, creative_id,
   cost_share_v, toUInt64(1) AS occurrences, impressions_share_v, is_promo, is_psa,
   '' AS industry_name, '' AS category_name, '' AS subcategory_name, '' AS entity_name, '' AS entity_parent_name, '' AS product_name, '' AS media_name,
   '' AS media_root_entity_name, '' AS media_entity_name, '' AS property_market_name, '' AS country_name, '' AS country_iso_2_code, '' AS master_property_name,
   '' AS show_display_name, '' AS show_type_name, '' AS sports_entity_name, '' AS daypart_name, '' AS language_name,
   CAST(NULL AS Nullable(Int32)) AS direct_indirect_id, '' AS direct_indirect_name, '' AS creative_type`
// TV files an airing under its broadcast date; live streaming has only the capture date.
const AIRINGS = `(SELECT ${AIRING_COLS('broadcast_date')} FROM gpc_detail.tv_product_detail UNION ALL SELECT ${AIRING_COLS('capture_date')} FROM gpc_detail.live_stream_product_detail)`
const AIRING_TIME: DimKey[] = ['day', 'week', 'broadcast_week', 'broadcast_month']
const CREATIVE_NOTE = 'Spot length and creatives come from the creative data, which has no promo flag; a creative whose TV spend is mostly promos or public service announcements is left out instead, so totals can differ slightly from other reports.'
/** Creatives that are mostly promos or PSAs in these months (the flag is only on TV airings): left out of creative-data queries. */
const notPromoCreative = (fromYm: number, toYm: number) =>
  `creative_id NOT IN (SELECT creative_id FROM gpc_detail.tv_product_detail WHERE year_month BETWEEN ${fromYm} AND ${toYm}
     GROUP BY creative_id HAVING 2 * sumIf(cost_share_v, coalesce(is_promo, 0) = 1 OR coalesce(is_psa, 0) = 1) >= sum(cost_share_v)
       AND countIf(coalesce(is_promo, 0) = 1 OR coalesce(is_psa, 0) = 1) > 0)`

type Source = 'month' | 'daily' | 'creative_month' | 'creative_daily' | 'airings'
/**
 * Which table answers a query: spot length and creative need the creative data, daypart and league
 * (and days and weeks) the daily data, and creative or spot length with program, genre, daypart or
 * league the airings.
 */
export function sourceFor(q: Pick<AggregateQuery, 'groupBy' | 'where' | 'measures' | 'period'>): Source {
  const dims = [...queryDims(q)]
  const daily = Boolean(q.period.daily) || dims.some((d) => DIMENSIONS[d].daily)
  if (dims.some((d) => DIMENSIONS[d].creative)) {
    if (dims.some((d) => AIRING_ONLY.includes(d))) return 'airings'
    return daily ? 'creative_daily' : 'creative_month'
  }
  return daily ? 'daily' : 'month'
}
const NO_PROMOS = 'coalesce(is_promo, 0) = 0 AND coalesce(is_psa, 0) = 0'
// 60 seconds: a deep detailed extract (a 360 import can have a dozen row levels) needs more than the 20 it had.
const SETTINGS = { max_execution_time: '60', max_bytes_before_external_group_by: '1000000000' }

/** Each dimension in SQL: its id, its name, and a line of context. Time dimensions give their canonical value as id. */
const SQL: Record<DimKey, { id: string; name: string; context: string }> = {
  industry: { id: 'coalesce(industry_id, 0)', name: 'industry_name', context: "''" },
  category: { id: 'coalesce(category_id, 0)', name: 'category_name', context: 'industry_name' },
  subcategory: { id: 'coalesce(subcategory_id, 0)', name: 'subcategory_name', context: "concat(industry_name, ' > ', category_name)" },
  top_parent: { id: 'coalesce(entity_parent_id, entity_id)', name: "if(entity_parent_name = '', entity_name, entity_parent_name)", context: "'Parent company'" },
  advertiser: { id: 'entity_id', name: 'entity_name', context: "if(entity_parent_name = '', '', entity_parent_name)" },
  product: { id: 'product_id', name: 'product_name', context: 'entity_name' },
  media_type: { id: 'coalesce(media_id, 0)', name: 'media_name', context: "'Media type'" },
  media_owner: { id: 'coalesce(media_root_entity_id, 0)', name: 'media_root_entity_name', context: "'Media owner'" },
  property: { id: 'coalesce(media_entity_id, 0)', name: 'media_entity_name', context: "concat(media_name, ' · ', media_root_entity_name)" },
  market: { id: 'coalesce(property_market_id, 0)', name: 'initcapUTF8(property_market_name)', context: "'Market'" },
  country: { id: 'coalesce(country_id, 0)', name: 'country_name', context: 'country_iso_2_code' },
  master_property: { id: 'coalesce(master_property_id, 0)', name: 'master_property_name', context: 'media_name' },
  program: { id: 'coalesce(show_id, 0)', name: 'show_display_name', context: 'media_entity_name' },
  program_genre: { id: 'coalesce(show_type_id, 0)', name: 'initcapUTF8(show_type_name)', context: "'Program genre'" },
  league: { id: 'coalesce(sports_entity_id, 0)', name: 'sports_entity_name', context: "'League'" },
  daypart: { id: 'coalesce(daypart_id, 0)', name: 'daypart_name', context: "'Daypart'" },
  language: { id: 'coalesce(language_id, 0)', name: 'language_name', context: "'Language'" },
  direct_indirect: { id: 'coalesce(direct_indirect_id, 0)', name: 'direct_indirect_name', context: "'Buying type'" },
  length: { id: 'coalesce(length_v, 0)', name: "if(length_v IS NULL, '', concat(toString(length_v), ' sec'))", context: "'Spot length'" },
  // The summaries carry only the id; the title replaces this name after the query (creativeInfo).
  creative: { id: 'creative_id', name: 'toString(creative_id)', context: "coalesce(creative_type, '')" },
  month: { id: "concat(toString(intDiv(year_month, 100)), '-', leftPad(toString(year_month % 100), 2, '0'))", name: "''", context: "''" },
  quarter: { id: "concat(toString(intDiv(year_month, 100)), '-Q', toString(intDiv(year_month % 100 + 2, 3)))", name: "''", context: "''" },
  year: { id: 'toString(intDiv(year_month, 100))', name: "''", context: "''" },
  day: { id: 'toString(start_date)', name: "''", context: "''" },
  week: { id: 'toString(toStartOfWeek(start_date, 0))', name: "''", context: "''" },
  broadcast_week: { id: 'toString(toMonday(start_date))', name: "''", context: "''" },
  broadcast_month: { id: "formatDateTime(toMonday(start_date) + 6, '%Y-%m')", name: "''", context: "''" },
}

const MEASURE_SQL: Record<MeasureKey, string> = { spend: 'cost_share_v', occurrences: 'occurrences', impressions: 'impressions_share_v' }

// ---------------------------------------------------------------- small helpers

const ymOf = (iso: string) => Number(iso.slice(0, 4)) * 100 + Number(iso.slice(5, 7))
const ymShift = (ym: number, n: number) => {
  const i = Math.floor(ym / 100) * 12 + (ym % 100) - 1 + n
  return Math.floor(i / 12) * 100 + (i % 12) + 1
}
const isoYm = (ym: number) => `${Math.floor(ym / 100)}-${String(ym % 100).padStart(2, '0')}`
/** The number part of "advertiser:123"; null when it is not one. */
const num = (id: string) => {
  const n = Number(String(id).split(':')[1])
  return Number.isFinite(n) ? Math.trunc(n) : null
}
/** A time value, kept to the characters a period can have. */
const timeLit = (v: string) => `'${String(v).replace(/[^0-9Q-]/g, '')}'`
const alias = (s: string) => {
  if (!/^[A-Za-z0-9_]+$/.test(s)) throw new Error(`Bad measure name: ${s}`)
  return `m_${s}`
}

/** A condition as SQL. An empty list matches nothing. */
export function condSql(c: Cond | undefined): string {
  if (!c) return '1'
  if ('and' in c) return c.and.length ? `(${c.and.map(condSql).join(' AND ')})` : '1'
  if ('or' in c) return c.or.length ? `(${c.or.map(condSql).join(' OR ')})` : '0'
  if ('not' in c) return `NOT ${condSql(c.not)}`
  if ('named' in c) return `${SQL[c.named].name} != ''`
  if ('nameIn' in c) {
    const names = [...new Set(c.names.map(normName).filter(Boolean))]
    // Letters and digits only after normName, so nothing in them can break out of the string.
    return names.length ? `replaceRegexpAll(lowerUTF8(normalizeUTF8NFD(${SQL[c.nameIn].name})), '[^a-z0-9]', '') IN (${names.map((n) => `'${n}'`).join(',')})` : '0'
  }
  if ('in' in c) return inSql(c.in, c.values)
  if ('anyOf' in c) {
    const by = new Map<DimKey, string[]>()
    for (const id of c.anyOf) {
      const d = dimOf(id) as DimKey
      if (!DIMENSIONS[d] || DIMENSIONS[d].time) continue
      by.set(d, [...(by.get(d) ?? []), id])
    }
    const parts = [...by].map(([d, ids]) => inSql(d, ids))
    return parts.length ? `(${parts.join(' OR ')})` : '0'
  }
  if ('tuples' in c) {
    if (!c.values.length) return '0'
    const keyExpr = `(${c.tuples.map((d) => (DIMENSIONS[d].time ? (d === 'month' ? 'toString(year_month)' : SQL[d].id) : `toString(${SQL[d].id})`)).join(', ')})`
    const tup = (vals: string[]) =>
      `(${vals
        .map((v, i) => {
          const d = c.tuples[i]!
          if (d === 'month') return `'${ymOf(`${v}-01`)}'`
          if (DIMENSIONS[d].time) return timeLit(v)
          return `'${num(v) ?? ''}'`
        })
        .join(', ')})`
    return `${keyExpr} IN (${c.values.map(tup).join(', ')})`
  }
  throw new Error('Unknown condition')
}

function inSql(d: DimKey, values: string[]): string {
  if (!DIMENSIONS[d]) throw new Error(`Unknown dimension ${d}`)
  if (d === 'month') {
    const yms = values.filter((v) => /^\d{4}-\d{2}$/.test(v)).map((v) => ymOf(`${v}-01`))
    return yms.length ? `year_month IN (${yms.join(',')})` : '0'
  }
  if (DIMENSIONS[d].time) return values.length ? `${SQL[d].id} IN (${values.map(timeLit).join(',')})` : '0'
  const nums = values.filter((id) => dimOf(id) === d).map(num).filter((n): n is number => n !== null)
  return nums.length ? `${SQL[d].id} IN (${nums.join(',')})` : '0'
}

// ---------------------------------------------------------------- the daily source

const DAILY_TABLES = ['tv', 'video', 'avod', 'display', 'social', 'print', 'live_stream'].map((t) => `${t}_product_summary_daily`)
const DAILY_COLS = [
  'year_month', 'start_date', 'industry_id', 'industry_name', 'category_id', 'category_name', 'subcategory_id', 'subcategory_name',
  'entity_id', 'entity_name', 'entity_parent_id', 'entity_parent_name', 'product_id', 'product_name',
  'media_id', 'media_name', 'media_root_entity_id', 'media_root_entity_name', 'media_entity_id', 'media_entity_name',
  'property_market_id', 'property_market_name', 'country_id', 'country_name', 'country_iso_2_code', 'cost_share_v', 'occurrences', 'impressions_share_v', 'is_promo', 'is_psa',
  'master_property_id', 'master_property_name', 'show_id', 'show_display_name', 'show_type_id', 'show_type_name',
  'language_id', 'language_name', 'direct_indirect_id', 'direct_indirect_name',
  // Only in the daily tables (TV and live streaming): typed from the first table that has them.
  'daypart_id', 'daypart_name', 'sports_entity_id', 'sports_entity_name',
]

/** Whether this deployment reads live data: REPORT_BUILDER_DATA=gpc and Dev ClickHouse configured. */
export function liveConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return env.REPORT_BUILDER_DATA?.trim().toLowerCase() === 'gpc' && Boolean(clickhouseConfig('dev', env))
}

// ---------------------------------------------------------------- the adapter

export interface ClickHouseAdapterOptions {
  /** Sends one query. Defaults to Dev ClickHouse through lib/clickhouse.ts; tests pass their own. */
  query?: <T>(sql: string, params?: Record<string, string>) => Promise<T[]>
}

export function clickhouseAdapter(opts: ClickHouseAdapterOptions = {}): DataAdapter & { sqlFor(q: AggregateQuery, daily?: string): { rows: string; totals: string } } {
  const config = (): ClickHouseConfig => {
    const c = clickhouseConfig('dev')
    if (!c) throw new ClickHouseError('Dev ClickHouse is not configured (CLICKHOUSE_DEV_URL).')
    return c
  }
  const query = opts.query ?? (<T>(sql: string, params: Record<string, string> = {}) => chQuery<T>(config(), sql, params, SETTINGS))

  let avail: { at: number; value: Availability } | null = null
  let dailySql: Promise<string> | null = null

  /** The daily tables as one source in the monthly table's shape: a missing column is empty, a different type is cast. */
  function dailySource(): Promise<string> {
    dailySql ??= (async () => {
      const tables = ['property_product_summary_month', ...DAILY_TABLES]
      const cols = await query<{ table: string; name: string; type: string }>(
        `SELECT table, name, type FROM system.columns WHERE database = 'gpc_summary' AND table IN (${tables.map((t) => `'${t}'`).join(',')}) AND name IN (${DAILY_COLS.map((c) => `'${c}'`).join(',')})`,
      )
      const want = new Map(cols.filter((c) => c.table === 'property_product_summary_month').map((c) => [c.name, c.type]))
      for (const c of cols) if (!want.has(c.name)) want.set(c.name, c.type)
      const parts = DAILY_TABLES.map((t) => {
        const have = new Map(cols.filter((c) => c.table === t).map((c) => [c.name, c.type]))
        const sel = DAILY_COLS.map((c) => {
          const ty = want.get(c) ?? 'String'
          const got = have.get(c)
          if (got === ty) return c
          if (got) return `CAST(${c} AS ${ty}) AS ${c}`
          const empty = ty.includes('Nullable') ? 'NULL' : ty.includes('String') ? "''" : '0'
          return `CAST(${empty} AS ${ty}) AS ${c}`
        })
        return `SELECT ${sel.join(', ')} FROM gpc_summary.${t}`
      })
      return `(${parts.join(' UNION ALL ')})`
    })()
    dailySql.catch(() => (dailySql = null))
    return dailySql
  }

  /** The two statements for a query: its rows, and its totals and count. */
  function sqlFor(q: AggregateQuery, daily?: string): { rows: string; totals: string } {
    const src = sourceFor(q)
    // The airings hold both year_month and the day: read by day only when the query asks for days or weeks.
    const isDaily = src === 'daily' || src === 'creative_daily' || (src === 'airings' && (Boolean(q.period.daily) || [...queryDims(q)].some((d) => AIRING_TIME.includes(d))))
    const from = q.period.from
    const to = q.period.to
    const time = isDaily
      ? `year_month BETWEEN ${ymShift(ymOf(from), -1)} AND ${ymShift(ymOf(to), 1)} AND start_date BETWEEN '${from}' AND '${to}'`
      : `year_month BETWEEN ${ymOf(from)} AND ${ymOf(to)}`
    // Market and master property are only in the fuller creative summaries; the smaller ones answer the rest faster.
    const full = [...queryDims(q)].some((d) => FULL_ONLY.includes(d))
    const source =
      src === 'airings'
        ? AIRINGS
        : src === 'daily'
          ? daily!
          : src === 'creative_daily'
            ? (full ? CREATIVE_FULL_DAY : CREATIVE_DAY)
            : src === 'creative_month'
              ? (full ? CREATIVE_FULL_MONTH : CREATIVE_MONTH)
              : MONTH_TABLE
    // The creative data has no promo or PSA flags: mostly-promo creatives are left out by their TV airings instead.
    const promos = q.includePromos
      ? ''
      : src.startsWith('creative')
        ? notPromoCreative(isDaily ? ymShift(ymOf(from), -1) : ymOf(from), isDaily ? ymShift(ymOf(to), 1) : ymOf(to))
        : NO_PROMOS
    const where = [time, promos, q.where ? condSql(q.where) : ''].filter(Boolean).join(' AND ')
    const selects: string[] = []
    for (const d of q.groupBy) {
      selects.push(`toString(${SQL[d].id}) AS k_${d}`, `any(${SQL[d].name}) AS n_${d}`)
      if (q.context) selects.push(`any(${SQL[d].context}) AS x_${d}`)
    }
    for (const m of q.measures) selects.push(m.where ? `toFloat64(sumIf(${MEASURE_SQL[m.measure]}, ${condSql(m.where)})) AS ${alias(m.as)}` : `toFloat64(sum(${MEASURE_SQL[m.measure]})) AS ${alias(m.as)}`)
    const groupBy = q.groupBy.length ? ` GROUP BY ${q.groupBy.map((d) => `k_${d}`).join(', ')}` : ''
    const having = q.having?.length ? ` HAVING ${q.having.map((h) => `${alias(h.as)} ${h.op} ${Number(h.value)}`).join(' AND ')}` : ''
    const grouped = `SELECT ${selects.join(', ')} FROM ${source} WHERE ${where}${groupBy}${having}`
    const order = q.orderBy?.length ? ` ORDER BY ${q.orderBy.map((o) => `${DIMENSIONS[o.by as DimKey] ? `k_${o.by}` : alias(o.by)}${o.desc ? ' DESC' : ' ASC'}`).join(', ')}` : ''
    const limit = q.limit != null ? ` LIMIT ${Math.max(0, Math.floor(q.limit))}` : ''
    return {
      rows: `SELECT * FROM (${grouped})${order}${limit}`,
      totals: `SELECT ${[...q.measures.map((m) => `sum(${alias(m.as)}) AS ${alias(m.as)}`), 'count() AS n'].join(', ')} FROM (${grouped})`,
    }
  }

  return {
    name: 'ClickHouse',
    sqlFor,

    async availability() {
      if (avail && Date.now() - avail.at < 10 * 60_000) return avail.value
      const rows = await query<{ ym: number; media: number }>(`SELECT year_month AS ym, uniqExact(media_id) AS media FROM ${MONTH_TABLE} GROUP BY ym ORDER BY ym`)
      const maxMedia = Math.max(1, ...rows.map((r) => Number(r.media)))
      const complete = rows.filter((r) => Number(r.media) >= maxMedia * 0.7).map((r) => Number(r.ym))
      const prelim = Math.max(...rows.map((r) => Number(r.ym)))
      // The current month is still loading: complete months stop before it.
      const done = complete.filter((ym) => ym < prelim)
      const through = done.length ? done[done.length - 1]! : prelim
      let first = through
      for (let i = done.length - 1; i > 0 && ymShift(done[i - 1]!, 1) === done[i]!; i--) first = done[i - 1]!
      const [last] = await query<{ d: string }>(`SELECT toString(max(start_date)) AS d FROM gpc_summary.video_product_summary_daily WHERE year_month >= ${prelim}`)
      const monthEnd = new Date(Date.UTC(Math.floor(prelim / 100), prelim % 100, 0)).toISOString().slice(0, 10)
      const prelimDay = last?.d && /^\d{4}-\d{2}-\d{2}$/.test(last.d) && last.d < monthEnd ? last.d : monthEnd
      const value = { firstComplete: isoYm(first), through: isoYm(through), prelim: isoYm(prelim), prelimDay }
      avail = { at: Date.now(), value }
      return value
    },

    supports(dims) {
      if (!dims.some((d) => DIMENSIONS[d]?.creative)) return null
      const conflicts = dims.filter((d) => NOT_IN_CREATIVE.includes(d))
      return conflicts.length
        ? { conflicts, reason: `${creativeLabels(dims)} from the creative data, which does not record ${conflicts.map((d) => DIMENSIONS[d].label.toLowerCase()).join(', ')}.` }
        : null
    },

    async aggregate(q): Promise<AggregateResult> {
      const src = sourceFor(q)
      const sql = sqlFor(q, src === 'daily' ? await dailySource() : undefined)
      type Row = Record<string, string | number>
      const [rows, totals] = await Promise.all([query<Row>(sql.rows), q.withCount || q.withTotals ? query<Row>(sql.totals) : Promise.resolve([] as Row[])])
      const out: AggregateResult = {
        rows: rows.map((r) => ({
          keys: Object.fromEntries(
            q.groupBy.map((d) => {
              const raw = String(r[`k_${d}`])
              return [d, { id: DIMENSIONS[d].time ? raw : `${d}:${raw}`, name: String(r[`n_${d}`] ?? ''), ...(q.context ? { context: String(r[`x_${d}`] ?? '') } : {}) }]
            }),
          ),
          values: Object.fromEntries(q.measures.map((m) => [m.as, Number(r[alias(m.as)] ?? 0)])),
        })),
      }
      if (q.groupBy.includes('creative')) {
        const info = await creativeInfo(out.rows.map((r) => r.keys.creative?.id).filter((x): x is string => Boolean(x)))
        for (const r of out.rows) {
          const k = r.keys.creative
          const i = k && info.get(k.id)
          if (k && i) Object.assign(k, { name: i.name, ...(q.context ? { context: i.context } : {}) })
        }
      }
      // The airings carry ids only: every other name, and its context, from labels().
      if (src === 'airings') {
        const want = new Set<string>()
        for (const r of out.rows) for (const d of q.groupBy) if (!DIMENSIONS[d].time && d !== 'creative' && d !== 'length' && r.keys[d]) want.add(r.keys[d]!.id)
        const named = new Map((await labelsOf([...want])).map((l) => [l.id, l]))
        for (const r of out.rows)
          for (const d of q.groupBy) {
            const k = r.keys[d]
            if (!k || DIMENSIONS[d].time || d === 'creative' || d === 'length') continue
            const l = named.get(k.id)
            k.name = l?.name ?? ''
            if (q.context) k.context = l?.context ?? ''
          }
        out.notes = [AIRINGS_NOTE]
      } else if (src.startsWith('creative')) out.notes = [CREATIVE_NOTE]
      if (q.withCount) out.count = Number(totals[0]?.n ?? 0)
      if (q.withTotals) out.totals = Object.fromEntries(q.measures.map((m) => [m.as, Number(totals[0]?.[alias(m.as)] ?? 0)]))
      return out
    },

    async search(req: SearchRequest): Promise<NameHit[]> {
      const params: Record<string, string> = {}
      const ym = ymOf(`${req.month}-01`)
      const extra = req.where ? ` AND ${condSql(req.where)}` : ''
      // Creatives are found by their title, which only gpc_creative.creative holds.
      const creatives = await Promise.all(req.parts.filter((p) => p.dim === 'creative').map((p) => searchCreatives(p.text, ym, extra, req.limit)))
      const parts = req.parts.filter((p) => p.dim !== 'creative').map((p, i) => {
        const d = SQL[p.dim]
        let match = ''
        if (p.text != null) {
          params[`t${i}`] = p.text
          match = ` AND positionCaseInsensitiveUTF8(${d.name}, {t${i}:String}) > 0`
        }
        return `SELECT '${p.dim}' AS dim, toString(${d.id}) AS id, any(${d.name}) AS name, any(${d.context}) AS ctx, toFloat64(sum(cost_share_v)) AS spend
          FROM ${LOOKUP_TABLE[p.dim] ?? MONTH_TABLE} WHERE year_month = ${ym} AND ${d.name} != ''${match}${extra} GROUP BY id ORDER BY spend DESC LIMIT ${Math.max(1, Math.floor(req.limit))}`
      })
      const rows = parts.length ? await query<{ dim: DimKey; id: string; name: string; ctx: string; spend: number }>(`SELECT * FROM (${parts.map((p) => `(${p})`).join(' UNION ALL ')})`, params) : []
      return [...rows.map((r) => ({ id: `${r.dim}:${r.id}`, dim: r.dim, name: r.name, context: r.ctx, spend: Number(r.spend) })), ...creatives.flat()]
    },

    labels: labelsOf,
  }

  /** Names and context for ids; unknown ids are left out. */
  async function labelsOf(ids: string[]): Promise<Array<{ id: string; name: string; context: string }>> {
    {
      const by = new Map<DimKey, number[]>()
      for (const id of ids) {
        const d = dimOf(id) as DimKey
        const n = num(id)
        if (!DIMENSIONS[d] || DIMENSIONS[d].time || n === null || d === 'creative') continue
        by.set(d, [...(by.get(d) ?? []), n])
      }
      const creatives = [...(await creativeInfo(ids.filter((id) => dimOf(id) === 'creative')))].map(([id, i]) => ({ id, name: i.name, context: i.context }))
      const parts = [...by].map(([d, nums]) => `SELECT '${d}' AS dim, toString(${SQL[d].id}) AS id, any(${SQL[d].name}) AS name, any(${SQL[d].context}) AS ctx FROM ${LOOKUP_TABLE[d] ?? MONTH_TABLE} WHERE ${SQL[d].id} IN (${nums.join(',')}) AND year_month >= 202601 GROUP BY id`)
      if (!parts.length) return creatives
      const rows = await query<{ dim: string; id: string; name: string; ctx: string }>(parts.join(' UNION ALL '))
      return [...rows.filter((r) => r.name).map((r) => ({ id: `${r.dim}:${r.id}`, name: r.name, context: r.ctx })), ...creatives]
    }
  }

  /**
   * Each creative's name and a line of context, by id ("creative:123"): its
   * title (or lead text), and its media, length and first airing. Without a
   * title it is "Creative 123", so a row is never blank.
   */
  async function creativeInfo(ids: string[]): Promise<Map<string, { name: string; context: string }>> {
    const nums = [...new Set(ids.map(num).filter((n): n is number => n !== null))]
    const out = new Map<string, { name: string; context: string }>()
    for (let i = 0; i < nums.length; i += 5000) {
      const rows = await query<{ id: string; title: string; media: string; secs: number | null; first: string | null }>(
        `SELECT toString(creative_id) AS id, coalesce(nullIf(trim(title), ''), nullIf(trim(lead_text), ''), '') AS title, coalesce(first_seen_media, '') AS media,
                duration AS secs, toString(toDate(first_seen_occurrence_timestamp)) AS first
         FROM gpc_creative.creative WHERE creative_id IN (${nums.slice(i, i + 5000).join(',')})`,
      )
      for (const r of rows) {
        const context = [r.media, r.secs ? `${r.secs}s` : '', r.first ? `first seen ${r.first}` : ''].filter(Boolean).join(' · ')
        out.set(`creative:${r.id}`, { name: r.title || `Creative ${r.id}`, context })
      }
    }
    for (const n of nums) if (!out.has(`creative:${n}`)) out.set(`creative:${n}`, { name: `Creative ${n}`, context: '' })
    return out
  }

  /** Creatives by title (or the biggest, with no text), ranked by the month's spend. */
  async function searchCreatives(text: string | null, ym: number, extra: string, limit: number): Promise<NameHit[]> {
    const params: Record<string, string> = text != null ? { t: text } : {}
    const byTitle = text != null ? ` AND creative_id IN (SELECT creative_id FROM gpc_creative.creative WHERE positionCaseInsensitiveUTF8(coalesce(title, ''), {t:String}) > 0)` : ''
    const rows = await query<{ id: string; spend: number }>(
      `SELECT toString(creative_id) AS id, toFloat64(sum(cost_share_v)) AS spend FROM ${CREATIVE_MONTH}
       WHERE year_month = ${ym}${byTitle}${extra} GROUP BY id ORDER BY spend DESC LIMIT ${Math.max(1, Math.floor(limit))}`,
      params,
    )
    const info = await creativeInfo(rows.map((r) => `creative:${r.id}`))
    return rows.map((r) => ({ id: `creative:${r.id}`, dim: 'creative' as DimKey, name: info.get(`creative:${r.id}`)?.name ?? `Creative ${r.id}`, context: info.get(`creative:${r.id}`)?.context ?? '', spend: Number(r.spend) }))
  }
}

/** "Spot length comes" or "Spot length and Creative come": what a query reads from the creative data. */
function creativeLabels(dims: DimKey[]): string {
  const c = dims.filter((d) => DIMENSIONS[d]?.creative).map((d) => DIMENSIONS[d].label)
  return `${c.join(' and ')} ${c.length > 1 ? 'come' : 'comes'}`
}
