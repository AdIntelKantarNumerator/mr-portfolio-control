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
 */
import { chQuery, clickhouseConfig, ClickHouseError, type ClickHouseConfig } from '@/lib/clickhouse'
import { DIMENSIONS, dimOf, type AggregateQuery, type AggregateResult, type Availability, type Cond, type DataAdapter, type DimKey, type MeasureKey, type NameHit, type SearchRequest } from './types'

const MONTH_TABLE = 'gpc_summary.property_product_summary_month'
const NO_PROMOS = 'coalesce(is_promo, 0) = 0 AND coalesce(is_psa, 0) = 0'
const SETTINGS = { max_execution_time: '20', max_bytes_before_external_group_by: '1000000000' }

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
  month: { id: "concat(toString(intDiv(year_month, 100)), '-', leftPad(toString(year_month % 100), 2, '0'))", name: "''", context: "''" },
  quarter: { id: "concat(toString(intDiv(year_month, 100)), '-Q', toString(intDiv(year_month % 100 + 2, 3)))", name: "''", context: "''" },
  year: { id: 'toString(intDiv(year_month, 100))', name: "''", context: "''" },
  day: { id: 'toString(start_date)', name: "''", context: "''" },
  week: { id: 'toString(toStartOfWeek(start_date, 0))', name: "''", context: "''" },
  broadcast_week: { id: 'toString(toMonday(start_date))', name: "''", context: "''" },
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
  'property_market_id', 'property_market_name', 'cost_share_v', 'occurrences', 'impressions_share_v', 'is_promo', 'is_psa',
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
    const isDaily = Boolean(q.period.daily || q.groupBy.some((d) => DIMENSIONS[d].daily))
    const from = q.period.from
    const to = q.period.to
    const time = isDaily
      ? `year_month BETWEEN ${ymShift(ymOf(from), -1)} AND ${ymShift(ymOf(to), 1)} AND start_date BETWEEN '${from}' AND '${to}'`
      : `year_month BETWEEN ${ymOf(from)} AND ${ymOf(to)}`
    const source = isDaily ? daily! : MONTH_TABLE
    const where = [time, q.includePromos ? '' : NO_PROMOS, q.where ? condSql(q.where) : ''].filter(Boolean).join(' AND ')
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

    async aggregate(q): Promise<AggregateResult> {
      const isDaily = Boolean(q.period.daily || q.groupBy.some((d) => DIMENSIONS[d].daily))
      const sql = sqlFor(q, isDaily ? await dailySource() : undefined)
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
      if (q.withCount) out.count = Number(totals[0]?.n ?? 0)
      if (q.withTotals) out.totals = Object.fromEntries(q.measures.map((m) => [m.as, Number(totals[0]?.[alias(m.as)] ?? 0)]))
      return out
    },

    async search(req: SearchRequest): Promise<NameHit[]> {
      const params: Record<string, string> = {}
      const ym = ymOf(`${req.month}-01`)
      const extra = req.where ? ` AND ${condSql(req.where)}` : ''
      const parts = req.parts.map((p, i) => {
        const d = SQL[p.dim]
        let match = ''
        if (p.text != null) {
          params[`t${i}`] = p.text
          match = ` AND positionCaseInsensitiveUTF8(${d.name}, {t${i}:String}) > 0`
        }
        return `SELECT '${p.dim}' AS dim, toString(${d.id}) AS id, any(${d.name}) AS name, any(${d.context}) AS ctx, toFloat64(sum(cost_share_v)) AS spend
          FROM ${MONTH_TABLE} WHERE year_month = ${ym} AND ${d.name} != ''${match}${extra} GROUP BY id ORDER BY spend DESC LIMIT ${Math.max(1, Math.floor(req.limit))}`
      })
      if (!parts.length) return []
      const rows = await query<{ dim: DimKey; id: string; name: string; ctx: string; spend: number }>(`SELECT * FROM (${parts.map((p) => `(${p})`).join(' UNION ALL ')})`, params)
      return rows.map((r) => ({ id: `${r.dim}:${r.id}`, dim: r.dim, name: r.name, context: r.ctx, spend: Number(r.spend) }))
    },

    async labels(ids) {
      const by = new Map<DimKey, number[]>()
      for (const id of ids) {
        const d = dimOf(id) as DimKey
        const n = num(id)
        if (!DIMENSIONS[d] || DIMENSIONS[d].time || n === null) continue
        by.set(d, [...(by.get(d) ?? []), n])
      }
      const parts = [...by].map(([d, nums]) => `SELECT '${d}' AS dim, toString(${SQL[d].id}) AS id, any(${SQL[d].name}) AS name, any(${SQL[d].context}) AS ctx FROM ${MONTH_TABLE} WHERE ${SQL[d].id} IN (${nums.join(',')}) AND year_month >= 202601 GROUP BY id`)
      if (!parts.length) return []
      const rows = await query<{ dim: string; id: string; name: string; ctx: string }>(parts.join(' UNION ALL '))
      return rows.filter((r) => r.name).map((r) => ({ id: `${r.dim}:${r.id}`, name: r.name, context: r.ctx }))
    },
  }
}
