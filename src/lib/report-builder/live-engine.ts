/**
 * Report Builder on live GPC data (11 November 2026).
 *
 * The same report model as engine.js (templates, the interview's questions and
 * fixes, adjustments, saved reports), but every number comes from Dev
 * ClickHouse: gpc_summary.property_product_summary_month, GPC spend by month x
 * property x paying entity x product, every id with its name. Search, preview
 * and run are read-only queries through lib/clickhouse.ts (statement guard and
 * readonly=2 on every request).
 *
 * WHAT THE DATA IS (checked 11 November 2026)
 *   - All media only from August 2026. January to July 2026 hold a few media,
 *     mostly streaming; the current month is partial. "Complete" months are the
 *     ones with most media present, worked out from the data each time.
 *   - 30 to 48 million rows a month, so nothing is copied into the app: each
 *     preview is a GROUP BY over the period, about a second with a filter.
 *   - Spend is cost_share_v: the DPA-1051 spend model's share for the paying
 *     entity and product. Promos and PSAs are left out.
 *
 * Ids in a report are "<dimension>:<GPC id>", so a saved report keeps working
 * when names change. Names come back with every query and are cached for the
 * process (they do not depend on who asks).
 */
import { chQuery, clickhouseConfig, ClickHouseError, type ClickHouseConfig } from '@/lib/clickhouse'
import type { EngineState, Option, Patch, Result, SavedSummary, Spec, Understanding, Validation } from './engine'

const MONTH_TABLE = 'gpc_summary.property_product_summary_month'
const TABLE = MONTH_TABLE
const BASE = 'coalesce(is_promo, 0) = 0 AND coalesce(is_psa, 0) = 0'
const INLINE_ROW_LIMIT = 2000
const DOWNLOAD_ROW_LIMIT = 50_000
const SETTINGS = { max_execution_time: '20', max_bytes_before_external_group_by: '1000000000' }

type Dim = 'industry' | 'category' | 'subcategory' | 'top_parent' | 'advertiser' | 'product' | 'media_type' | 'media_owner' | 'property' | 'market' | 'month' | 'quarter' | 'year' | 'day' | 'week' | 'broadcast_week'
type Group = 'who' | 'what' | 'where' | 'when'

interface DimDef {
  label: string
  plural: string
  group: Group
  time?: boolean
  /** Needs the daily tables (day and week breakdowns). */
  daily?: boolean
  id: string
  name: string
  context: string
}

const DIMS: Record<Dim, DimDef> = {
  industry: { label: 'Industry', plural: 'industries', group: 'what', id: 'coalesce(industry_id, 0)', name: 'industry_name', context: "''" },
  category: { label: 'Category', plural: 'categories', group: 'what', id: 'coalesce(category_id, 0)', name: 'category_name', context: 'industry_name' },
  subcategory: { label: 'Subcategory', plural: 'subcategories', group: 'what', id: 'coalesce(subcategory_id, 0)', name: 'subcategory_name', context: "concat(industry_name, ' > ', category_name)" },
  top_parent: { label: 'Top parent', plural: 'top parents', group: 'who', id: 'coalesce(entity_parent_id, entity_id)', name: "if(entity_parent_name = '', entity_name, entity_parent_name)", context: "'Parent company'" },
  advertiser: { label: 'Advertiser', plural: 'advertisers', group: 'who', id: 'entity_id', name: 'entity_name', context: "if(entity_parent_name = '', '', entity_parent_name)" },
  product: { label: 'Product', plural: 'products', group: 'who', id: 'product_id', name: 'product_name', context: 'entity_name' },
  media_type: { label: 'Media type', plural: 'media types', group: 'where', id: 'coalesce(media_id, 0)', name: 'media_name', context: "'Media type'" },
  media_owner: { label: 'Media owner', plural: 'media owners', group: 'where', id: 'coalesce(media_root_entity_id, 0)', name: 'media_root_entity_name', context: "'Media owner'" },
  property: { label: 'Property', plural: 'properties', group: 'where', id: 'coalesce(media_entity_id, 0)', name: 'media_entity_name', context: "concat(media_name, ' · ', media_root_entity_name)" },
  market: { label: 'Market', plural: 'markets', group: 'where', id: 'coalesce(property_market_id, 0)', name: 'initcapUTF8(property_market_name)', context: "'Market'" },
  month: { label: 'Month', plural: 'months', group: 'when', time: true, id: 'year_month', name: 'toString(year_month)', context: "''" },
  quarter: { label: 'Quarter', plural: 'quarters', group: 'when', time: true, id: "concat(toString(intDiv(year_month, 100)), '-Q', toString(intDiv(year_month % 100 + 2, 3)))", name: "''", context: "''" },
  year: { label: 'Year', plural: 'years', group: 'when', time: true, id: 'toString(intDiv(year_month, 100))', name: "''", context: "''" },
  day: { label: 'Day', plural: 'days', group: 'when', time: true, daily: true, id: 'toString(start_date)', name: "''", context: "''" },
  week: { label: 'Week', plural: 'weeks', group: 'when', time: true, daily: true, id: 'toString(toStartOfWeek(start_date, 0))', name: "''", context: "''" },
  broadcast_week: { label: 'Broadcast week', plural: 'broadcast weeks', group: 'when', time: true, daily: true, id: 'toString(toMonday(start_date))', name: "''", context: "''" },
}
const NAME_DIMS = Object.keys(DIMS).filter((d) => !DIMS[d as Dim].time) as Dim[]
const GROUP_LABEL: Record<Group, string> = { who: 'Who is advertising', what: 'What is advertised', where: 'Where it runs', when: 'When' }

const MEASURES = {
  spend: { label: 'Spend', type: 'money' as const, sql: 'cost_share_v' },
  occurrences: { label: 'Occurrences', type: 'int' as const, sql: 'occurrences' },
  impressions: { label: 'Impressions', type: 'int' as const, sql: 'impressions_share_v', note: 'Not measured for every medium.' },
}
type MeasureKey = keyof typeof MEASURES
const CALCS = {
  share: { label: 'Share of total', note: 'Each row as a percent of the report total. With a column breakdown: each cell as a percent of its column total (% down), shown in the cell under the value.' },
  share_across: { label: 'Share across', note: 'With a column breakdown only: each cell as a percent of its row total (% across), shown in the cell under the value.' },
  yoy: { label: 'Change vs prior year', note: 'Same period one year earlier. Data before August 2026 covers only some media.' },
}

type TimeSpec = { mode?: string; unit?: string; count?: number; start?: string; end?: string }
const RECENT: TimeSpec = { mode: 'rolling', unit: 'month', count: 3 }
const WEEKS: TimeSpec = { mode: 'rolling', unit: 'week', count: 4 }
const QUARTER_OF_WEEKS: TimeSpec = { mode: 'rolling', unit: 'week', count: 13 }
const NO_ZERO = { mine: [], versus: [] }
const NO_COMPARE = { mine: [], rivals: [] }
const TEMPLATES = [
  { id: 'advertiser_trend', label: 'Spend trend', description: 'How spend moves month by month', spec: { template: 'advertiser_trend', rows: ['advertiser'], columns: 'month', measures: ['spend'], time: RECENT } },
  { id: 'media_mix', label: 'Media mix', description: 'How spend splits across media types', spec: { template: 'media_mix', rows: ['advertiser'], columns: 'media_type', measures: ['spend'], time: RECENT } },
  { id: 'category_share', label: 'Category share', description: 'Who holds what share of a category', spec: { template: 'category_share', rows: ['advertiser'], measures: ['spend'], calcs: ['share'], time: RECENT } },
  { id: 'zero_share', label: 'Zero share', description: 'Advertisers buying elsewhere but not on your properties', spec: { template: 'zero_share', rows: ['top_parent', 'advertiser'], measures: ['spend'], zero_share: { ...NO_ZERO, mode: 'zero' }, time: RECENT } },
  // Publisher Intel: a media owner's view, around their properties and competitors.
  { id: 'share_of_wallet', label: 'Share of wallet', description: "Your share of each advertiser's spend against your competitors", spec: { template: 'share_of_wallet', rows: ['advertiser'], measures: ['spend'], zero_share: { ...NO_ZERO, mode: 'wallet' }, time: RECENT } },
  { id: 'my_advertisers', label: 'Your advertisers', description: 'Who is buying your properties, week by week', spec: { template: 'my_advertisers', rows: ['advertiser'], columns: 'broadcast_week', measures: ['spend'], zero_share: { ...NO_ZERO, mode: 'mine' }, time: WEEKS } },
  { id: 'competitor_categories', label: 'Categories on competitors', description: 'Which categories spend with your competitors', spec: { template: 'competitor_categories', rows: ['category'], columns: 'month', measures: ['spend'], zero_share: { ...NO_ZERO, mode: 'theirs' }, time: RECENT } },
  // Competitive Intel: a brand's or buyer's view, around their brands and competitors.
  { id: 'competitive_mix', label: 'Media mix', description: 'How you and your competitors split spend across media', spec: { template: 'competitive_mix', rows: ['advertiser'], columns: 'media_type', measures: ['spend'], compare: NO_COMPARE, time: RECENT } },
  { id: 'share_of_voice', label: 'Share of voice', description: 'Your share of spend against your competitors', spec: { template: 'share_of_voice', rows: ['advertiser'], measures: ['spend'], calcs: ['share'], compare: NO_COMPARE, time: RECENT } },
  { id: 'competitive_trend', label: 'Competitive trend', description: 'Week by week: you against your competitors', spec: { template: 'competitive_trend', rows: ['advertiser'], columns: 'broadcast_week', measures: ['spend'], compare: NO_COMPARE, time: QUARTER_OF_WEEKS } },
  { id: 'competitor_placements', label: 'Where competitors run', description: 'Spend by property, for you and your competitors', spec: { template: 'competitor_placements', rows: ['advertiser', 'property'], measures: ['spend'], compare: NO_COMPARE, time: RECENT } },
  { id: 'detail_extract', label: 'Detailed extract', description: 'Product-level rows by property and month, for a spreadsheet', spec: { template: 'detail_extract', rows: ['top_parent', 'advertiser', 'product', 'subcategory', 'media_type', 'property', 'month'], measures: ['spend', 'occurrences', 'impressions'], time: { mode: 'rolling', unit: 'month', count: 1 }, output: 'csv' } },
]

/** Everyday words for GPC's own names: "fast food" is QSRs-Quick Serve Restaurants. */
const ALIASES: Array<[string, Dim, string]> = [
  ['fast food', 'subcategory', 'QSRs-Quick Serve Restaurants'],
  ['quick serve', 'subcategory', 'QSRs-Quick Serve Restaurants'],
  ['quick service', 'subcategory', 'QSRs-Quick Serve Restaurants'],
  ['quick service restaurants', 'subcategory', 'QSRs-Quick Serve Restaurants'],
  ['qsr', 'subcategory', 'QSRs-Quick Serve Restaurants'],
  ['burgers', 'subcategory', 'QSRs-Quick Serve Restaurants'],
  ['pizza', 'subcategory', 'Pizza Restaurants'],
  ['casual dining', 'subcategory', 'Casual Dining Restaurants'],
  ['coffee shops', 'subcategory', 'Coffee & Specialty Restaurants'],
  ['car insurance', 'subcategory', 'Vehicle Insurance'],
  ['auto insurance', 'subcategory', 'Vehicle Insurance'],
  ['home insurance', 'subcategory', 'Home Insurance'],
  ['life insurance', 'subcategory', 'Personal Life Insurance'],
  ['restaurants', 'industry', 'National Restaurants'],
  ['tv', 'media_type', 'Network TV'],
  ['ctv', 'media_type', 'AVOD'],
  ['streaming tv', 'media_type', 'AVOD'],
  ['connected tv', 'media_type', 'AVOD'],
  ['social', 'media_type', 'Social'],
  ['display', 'media_type', 'Browser Display'],
]

// ---------------------------------------------------------------- helpers

const clone = <T>(x: T): T => (x == null ? x : (JSON.parse(JSON.stringify(x)) as T))
const uniq = <T>(a: T[]) => Array.from(new Set(a))
const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const toIdx = (ym: number) => Math.floor(ym / 100) * 12 + ((ym % 100) - 1)
const toYm = (idx: number) => Math.floor(idx / 12) * 100 + (idx % 12) + 1
const monthId = (idx: number) => `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`
const monthLabel = (idx: number) => `${MONTHS[idx % 12]} ${Math.floor(idx / 12)}`
function parseMonth(id: unknown): number | null {
  const m = /^(\d{4})-(\d{2})$/.exec(String(id ?? ''))
  if (!m) return null
  const mm = Number(m[2])
  return mm >= 1 && mm <= 12 ? Number(m[1]) * 12 + mm - 1 : null
}
interface Period {
  start: number
  end: number
  d0: number
  d1: number
  label: string
  how: string
  moves: boolean
  notes: string[]
}

// Days as whole numbers since 1970-01-01 (UTC), for day and week periods.
const DAY_MS = 86_400_000
const dParse = (s: unknown): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? ''))
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS : null
}
const dStr = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10)
const dShort = (n: number) => {
  const d = new Date(n * DAY_MS)
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
}
const dLabel = (n: number) => `${dShort(n)}, ${new Date(n * DAY_MS).getUTCFullYear()}`
const monthFirstDay = (idx: number) => Date.UTC(Math.floor(idx / 12), idx % 12, 1) / DAY_MS
const monthLastDay = (idx: number) => monthFirstDay(idx + 1) - 1
const dayToIdx = (n: number) => {
  const d = new Date(n * DAY_MS)
  return d.getUTCFullYear() * 12 + d.getUTCMonth()
}
const weekday = (n: number) => new Date(n * DAY_MS).getUTCDay()
/** The longest period each day or week breakdown may cover, in days. */
const DAILY_LIMIT: Partial<Record<Dim, number>> = { day: 92, week: 371, broadcast_week: 371 }

function listText(items: string[], max = 4) {
  return items.length <= max ? items.join(', ') : `${items.slice(0, max).join(', ')} and ${items.length - max} more`
}

export function applyPatch(spec: Spec, patch?: Patch | null): Spec {
  const out = (clone(spec) || {}) as Record<string, unknown>
  if (!patch) return out
  const at = (path: string, make: boolean): [Record<string, unknown>, string] | null => {
    const parts = path.split('.')
    let o = out
    for (let i = 0; i < parts.length - 1; i++) {
      if (o[parts[i]!] == null || typeof o[parts[i]!] !== 'object') {
        if (!make) return null
        o[parts[i]!] = {}
      }
      o = o[parts[i]!] as Record<string, unknown>
    }
    return [o, parts[parts.length - 1]!]
  }
  for (const [path, value] of Object.entries(patch.set ?? {})) {
    const [o, k] = at(path, true)!
    if (value === null) delete o[k]
    else o[k] = clone(value)
  }
  for (const [path, values] of Object.entries(patch.add ?? {})) {
    const [o, k] = at(path, true)!
    o[k] = uniq([...(Array.isArray(o[k]) ? (o[k] as unknown[]) : []), ...values])
  }
  for (const [path, values] of Object.entries(patch.remove ?? {})) {
    const ref = at(path, false)
    if (ref && Array.isArray(ref[0][ref[1]])) ref[0][ref[1]] = (ref[0][ref[1]] as unknown[]).filter((v) => !values.includes(v))
  }
  return out
}

interface NSpec {
  template?: string
  rows: Dim[]
  columns: Dim | null
  measures: MeasureKey[]
  calcs: Array<'share' | 'share_across' | 'yoy'>
  filters: Record<string, string[]>
  options: { final_only: boolean; top_n: number | null }
  /** mine and versus hold ids of properties, media types, media owners or markets; all: compare with everything else; own: the person chose not to use their usual set. */
  zero_share?: { mine: string[]; versus: string[]; all?: boolean; own?: boolean; mode?: 'zero' | 'wallet' | 'mine' | 'theirs' } | null
  /** Competitive Intel: the person's brands and who they compete with (advertisers, products or categories). */
  compare?: { mine: string[]; rivals: string[]; own?: boolean } | null
  /** Drill-down (the tree view): only rows under these values, AND-ed with everything else. */
  path?: Record<string, string>
  /** Fixed column values, so a tree's lower levels line up with the top. */
  col_ids?: string[]
  time?: { mode?: string; unit?: string; count?: number; start?: string; end?: string } | null
  scope?: string
  [k: string]: unknown
}

function normalize(specIn: Spec): NSpec {
  const s = (clone(specIn) || {}) as NSpec
  s.rows = Array.isArray(s.rows) ? uniq(s.rows) : []
  s.columns = s.columns || null
  s.measures = Array.isArray(s.measures) && s.measures.length ? uniq(s.measures) : ['spend']
  s.calcs = Array.isArray(s.calcs) ? uniq(s.calcs) : []
  s.filters = s.filters && typeof s.filters === 'object' ? s.filters : {}
  for (const k of Object.keys(s.filters)) if (!Array.isArray(s.filters[k]) || !s.filters[k]!.length) delete s.filters[k]
  s.options = Object.assign({ final_only: true, top_n: null }, s.options ?? {})
  if (s.zero_share) s.zero_share = { mine: s.zero_share.mine ?? [], versus: s.zero_share.versus ?? [], all: Boolean(s.zero_share.all), own: Boolean(s.zero_share.own), mode: s.zero_share.mode ?? 'zero' }
  if (s.compare) s.compare = { mine: s.compare.mine ?? [], rivals: s.compare.rivals ?? [], own: Boolean(s.compare.own) }
  return s
}

/** Ids of properties, media types, owners or markets as one SQL condition ('0' when none). */
function idSql(ids: string[]): string {
  const by = new Map<Dim, number[]>()
  for (const id of ids) {
    const d = String(id).split(':')[0] as Dim
    const n = num(id)
    if (!DIMS[d] || DIMS[d].time || n === null) continue
    by.set(d, [...(by.get(d) ?? []), n])
  }
  const parts = [...by].map(([d, ns]) => `${DIMS[d].id} IN (${ns.join(',')})`)
  return parts.length ? `(${parts.join(' OR ')})` : '0'
}
const dimOf = (id: string) => String(id).split(':')[0]!

const num = (id: string) => {
  const n = Number(String(id).split(':')[1])
  return Number.isFinite(n) ? Math.trunc(n) : null
}
const idsOf = (ids: string[]) => ids.map(num).filter((n): n is number => n !== null)

// ---------------------------------------------------------------- shared state

interface Availability {
  firstComplete: number
  through: number
  prelim: number
  /** The last day loaded in the daily tables. */
  prelimDay: number
  at: number
}
let availCache: Availability | null = null
const labels = new Map<string, string>()
const contexts = new Map<string, string>()

function config(): ClickHouseConfig {
  const c = clickhouseConfig('dev')
  if (!c) throw new ClickHouseError('Dev ClickHouse is not configured (CLICKHOUSE_DEV_URL).')
  return c
}

/** Whether this deployment reads live GPC data. */
export function liveConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return env.REPORT_BUILDER_DATA?.trim().toLowerCase() === 'gpc' && Boolean(clickhouseConfig('dev', env))
}

async function availability(): Promise<Availability> {
  if (availCache && Date.now() - availCache.at < 10 * 60_000) return availCache
  const rows = await chQuery<{ ym: number; media: number }>(config(), `SELECT year_month AS ym, uniqExact(media_id) AS media FROM ${TABLE} GROUP BY ym ORDER BY ym`, {}, SETTINGS)
  const maxMedia = Math.max(1, ...rows.map((r) => Number(r.media)))
  const complete = rows.filter((r) => Number(r.media) >= maxMedia * 0.7).map((r) => Number(r.ym))
  const prelim = Math.max(...rows.map((r) => Number(r.ym)))
  // The current month is still loading: complete months stop before it.
  const done = complete.filter((ym) => ym < prelim)
  const through = done.length ? done[done.length - 1]! : prelim
  let first = through
  for (let i = done.length - 1; i > 0 && toIdx(done[i - 1]!) === toIdx(done[i]!) - 1; i--) first = done[i - 1]!
  const [last] = await chQuery<{ d: string }>(config(), `SELECT toString(max(start_date)) AS d FROM gpc_summary.video_product_summary_daily WHERE year_month >= ${prelim}`, {}, SETTINGS)
  const prelimDay = Math.min(dParse(last?.d) ?? monthLastDay(toIdx(prelim)), monthLastDay(toIdx(prelim)))
  availCache = { firstComplete: toIdx(first), through: toIdx(through), prelim: toIdx(prelim), prelimDay, at: Date.now() }
  return availCache
}

// ---------------------------------------------------------------- the daily source

/**
 * Day and week breakdowns read the daily tables, one per media family. Together
 * they hold exactly what the monthly table does (checked for October 2026,
 * medium by medium), so a report by week adds up to the same months. Their
 * columns differ a little, so each is read into the monthly table's shape:
 * a missing column is empty, and a different type is cast.
 */
const DAILY_TABLES = ['tv', 'video', 'avod', 'display', 'social', 'print', 'live_stream'].map((t) => `${t}_product_summary_daily`)
const DAILY_COLS = [
  'year_month', 'start_date', 'industry_id', 'industry_name', 'category_id', 'category_name', 'subcategory_id', 'subcategory_name',
  'entity_id', 'entity_name', 'entity_parent_id', 'entity_parent_name', 'product_id', 'product_name',
  'media_id', 'media_name', 'media_root_entity_id', 'media_root_entity_name', 'media_entity_id', 'media_entity_name',
  'property_market_id', 'property_market_name', 'cost_share_v', 'occurrences', 'impressions_share_v', 'is_promo', 'is_psa',
]
let dailySql: Promise<string> | null = null
function dailySource(): Promise<string> {
  dailySql ??= (async () => {
    const tables = ['property_product_summary_month', ...DAILY_TABLES]
    const cols = await chQuery<{ table: string; name: string; type: string }>(
      config(),
      `SELECT table, name, type FROM system.columns WHERE database = 'gpc_summary' AND table IN (${tables.map((t) => `'${t}'`).join(',')}) AND name IN (${DAILY_COLS.map((c) => `'${c}'`).join(',')})`,
      {},
      SETTINGS,
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

/** Whether a report needs the daily tables: a day or week breakdown, or a period in weeks or days. */
function needsDaily(s: NSpec): boolean {
  const t = s.time ?? {}
  return [...s.rows, ...(s.columns ? [s.columns] : [])].some((d) => DIMS[d]?.daily) || t.unit === 'week' || t.unit === 'day' || dParse(t.start) !== null
}

// ---------------------------------------------------------------- the engine

export interface LiveEngineConfig {
  store: { load(): EngineState; save(s: EngineState): void }
  now?: () => string
}

export function createLiveEngine(cfg: LiveEngineConfig) {
  const store = cfg.store
  const now = cfg.now ?? (() => new Date().toISOString())
  const state = () => {
    const s = (store.load() ?? {}) as EngineState & { saved: SavedRec[] }
    s.saved = (s.saved ?? []) as SavedRec[]
    s.seq = s.seq ?? 0
    return s
  }
  // Results of the last few queries, so a preview right after a validation does not run twice.
  const memo = new Map<string, Promise<Result>>()

  function labelOf(dim: string, id: string): string {
    if (dim === 'month') {
      const t = parseMonth(id)
      return t == null ? id : monthLabel(t)
    }
    if (dim === 'quarter') {
      const m = /^(\d{4})-Q(\d)$/.exec(id)
      return m ? `Q${m[2]} ${m[1]}` : id
    }
    if (dim === 'year') return id
    if (dim === 'day' || dim === 'week' || dim === 'broadcast_week') {
      const n = dParse(id)
      return n === null ? id : dim === 'day' ? dShort(n) : `${dim === 'week' ? 'Wk' : 'Bcst wk'} ${dShort(n)}`
    }
    return labels.get(id) ?? id
  }

  async function ensureLabels(specIn: Spec): Promise<void> {
    const s = normalize(specIn)
    const want = new Map<Dim, string[]>()
    for (const [dim, ids] of Object.entries(s.filters)) if (DIMS[dim as Dim] && !DIMS[dim as Dim].time) want.set(dim as Dim, ids.filter((id) => !labels.has(id)))
    const extra = [...(s.zero_share ? [...s.zero_share.mine, ...s.zero_share.versus] : []), ...(s.compare ? [...s.compare.mine, ...s.compare.rivals] : [])]
    if (extra.length)
      for (const id of extra) {
        const d = dimOf(id) as Dim
        if (DIMS[d] && !labels.has(id)) want.set(d, [...(want.get(d) ?? []), id])
      }
    const parts: string[] = []
    for (const [dim, ids] of want) {
      const nums = idsOf(ids)
      if (!nums.length) continue
      const d = DIMS[dim]
      parts.push(`SELECT '${dim}' AS dim, toString(${d.id}) AS id, any(${d.name}) AS name, any(${d.context}) AS ctx FROM ${TABLE} WHERE ${d.id} IN (${nums.join(',')}) AND year_month >= 202601 GROUP BY id`)
    }
    if (!parts.length) return
    const rows = await chQuery<{ dim: string; id: string; name: string; ctx: string }>(config(), parts.join(' UNION ALL '), {}, SETTINGS)
    for (const r of rows) {
      if (!r.name) continue
      labels.set(`${r.dim}:${r.id}`, r.name)
      contexts.set(`${r.dim}:${r.id}`, r.ctx)
    }
  }

  async function search(query: string, opts: { types?: string[]; limit?: number } = {}) {
    const a = await availability()
    const types = (opts.types?.length ? opts.types.filter((t) => NAME_DIMS.includes(t as Dim)) : NAME_DIMS) as Dim[]
    const limit = Math.max(1, Math.min(opts.limit ?? 8, 25))
    const q = String(query ?? '').trim()
    const aliasTargets = ALIASES.filter(([alias, dim]) => types.includes(dim) && q && (norm(q) === alias || norm(q).includes(alias)))
    const one = (dim: Dim, needle: string | null, paramName: string) => {
      const d = DIMS[dim]
      const match = needle === null ? '' : ` AND positionCaseInsensitiveUTF8(${d.name}, {${paramName}:String}) > 0`
      return `SELECT '${dim}' AS dim, toString(${d.id}) AS id, any(${d.name}) AS name, any(${d.context}) AS ctx, toFloat64(sum(cost_share_v)) AS spend
        FROM ${TABLE} WHERE year_month = ${toYm(a.through)} AND ${d.name} != ''${match} GROUP BY id ORDER BY spend DESC LIMIT ${limit}`
    }
    const parts = types.map((dim) => one(dim, q ? q : null, 'q'))
    const params: Record<string, string> = q ? { q } : {}
    aliasTargets.forEach(([, dim, label], i) => {
      parts.push(one(dim, label, `a${i}`))
      params[`a${i}`] = label
    })
    const rows = await chQuery<{ dim: Dim; id: string; name: string; ctx: string; spend: number }>(config(), `SELECT * FROM (${parts.map((p) => `(${p})`).join(' UNION ALL ')})`, params, SETTINGS)
    const lq = q.toLowerCase()
    const aliasNames = new Set(aliasTargets.map(([, , l]) => l.toLowerCase()))
    const scored = rows.map((r) => {
      const n = r.name.toLowerCase()
      const score = aliasNames.has(n) ? 95 : !q ? 1 : n === lq ? 100 : n.startsWith(lq) ? 80 : 40
      const id = `${r.dim}:${r.id}`
      labels.set(id, r.name)
      contexts.set(id, r.ctx)
      return { id, type: r.dim, type_label: DIMS[r.dim].label, label: r.name, context: r.ctx, spend_last_month: Number(r.spend), score }
    })
    const seen = new Set<string>()
    return scored
      .sort((x, y) => y.score - x.score || y.spend_last_month - x.spend_last_month)
      .filter((h) => (seen.has(h.id) ? false : (seen.add(h.id), true)))
      .slice(0, limit)
      .map((h) => ({ id: h.id, type: h.type, type_label: h.type_label, label: h.label, context: h.context, spend_last_month: h.spend_last_month }))
  }

  /**
   * The period: months (start, end) and days (d0, d1). Weeks are broadcast
   * weeks, Monday to Sunday, and only whole ones: "last 4 weeks" ends on the
   * last Sunday the data covers.
   */
  function resolveTime(time: NSpec['time'], through: number, firstComplete: number, throughDay: number = monthLastDay(through)): Period | { error: string } {
    const t: TimeSpec = time ?? RECENT
    if (t.mode === 'rolling' && (t.unit === 'week' || t.unit === 'day')) {
      const n = Math.max(1, Math.min(t.unit === 'week' ? 104 : 366, Number(t.count) || 1))
      let d1 = throughDay
      if (t.unit === 'week') while (weekday(d1) !== 0) d1--
      const d0 = t.unit === 'week' ? d1 - 7 * n + 1 : d1 - n + 1
      const how = t.unit === 'week' ? (n === 1 ? 'latest complete week' : `last ${n} complete weeks`) : n === 1 ? 'latest day' : `last ${n} days`
      const notes: string[] = []
      if (dayToIdx(d0) < firstComplete) notes.push(`Data before ${monthLabel(firstComplete)} covers only some media (mostly streaming), so earlier weeks look smaller than they were.`)
      return { start: dayToIdx(d0), end: dayToIdx(d1), d0, d1, label: `${dLabel(d0)} – ${dLabel(d1)}`, how, moves: true, notes }
    }
    if (t.mode === 'static' && dParse(t.start) !== null) {
      const d0 = dParse(t.start)!
      let d1 = dParse(t.end) ?? d0
      const notes: string[] = []
      if (d1 < d0) return { error: 'The fixed period needs an end on or after its start, written like 2026-10-05.' }
      if (d0 > throughDay) return { error: `That period starts after the latest available data (${dLabel(throughDay)}).` }
      if (d1 > throughDay) {
        notes.push(`Data runs through ${dLabel(throughDay)}, so the period stops there.`)
        d1 = throughDay
      }
      return { start: dayToIdx(d0), end: dayToIdx(d1), d0, d1, label: d0 === d1 ? dLabel(d0) : `${dLabel(d0)} – ${dLabel(d1)}`, how: 'fixed period', moves: false, notes }
    }
    const m = resolveMonths(t, through, firstComplete)
    if (m.error !== undefined) return { error: m.error }
    const ok = m as Omit<Period, 'd0' | 'd1'>
    return { ...ok, d0: monthFirstDay(ok.start), d1: monthLastDay(ok.end) }
  }

  function resolveMonths(t: TimeSpec, through: number, firstComplete: number) {
    const notes: string[] = []
    let start: number
    let end: number
    let how: string
    let moves = true
    if (t.mode === 'static') {
      const s = parseMonth(t.start)
      const e = parseMonth(t.end)
      moves = false
      how = 'fixed period'
      if (s == null || e == null || e < s) return { error: 'The fixed period needs a start and end month written like 2026-08, with the end on or after the start.' }
      if (s > through) return { error: `That period starts after the latest available data (${monthLabel(through)}).` }
      start = s
      end = e
      if (end > through) {
        notes.push(`Data runs through ${monthLabel(through)}, so the period stops there instead of ${monthLabel(end)}.`)
        end = through
      }
    } else if (t.mode === 'ytd') {
      end = through
      start = through - (through % 12)
      how = 'year to date'
    } else {
      const n = Math.max(1, Math.min(36, Number(t.count) || 1))
      end = through
      if (t.unit === 'quarter') {
        while (end % 3 !== 2) end--
        start = end - 3 * n + 1
        how = n === 1 ? 'last complete quarter' : `last ${n} complete quarters`
      } else if (t.unit === 'year') {
        while (end % 12 !== 11) end--
        start = end - 12 * n + 1
        how = n === 1 ? 'last complete year' : `last ${n} complete years`
      } else {
        start = end - n + 1
        how = n === 1 ? 'latest complete month' : `last ${n} complete months`
      }
    }
    if (start < firstComplete) notes.push(`Data before ${monthLabel(firstComplete)} covers only some media (mostly streaming), so earlier months look smaller than they were.`)
    const label = start === end ? monthLabel(start) : `${monthLabel(start)} – ${monthLabel(end)}`
    return { start, end, label, how, moves, notes }
  }

  const throughOf = (s: NSpec, a: Availability) => (s.options.final_only ? a.through : a.prelim)
  const throughDayOf = (s: NSpec, a: Availability) => (s.options.final_only ? monthLastDay(a.through) : a.prelimDay)
  const periodOf = (s: NSpec, a: Availability) => resolveTime(s.time, throughOf(s, a), a.firstComplete, throughDayOf(s, a))

  function filterLabels(filters: Record<string, string[]>, groups: Group[]) {
    const out: string[] = []
    for (const [dim, ids] of Object.entries(filters)) {
      const d = DIMS[dim as Dim]
      if (d && groups.includes(d.group)) for (const id of ids) out.push(labelOf(dim, id))
    }
    return out
  }

  function summarizeSync(s: NSpec, a: Availability): string {
    const parts: string[] = []
    const who = filterLabels(s.filters, ['who'])
    const what = filterLabels(s.filters, ['what'])
    const where = filterLabels(s.filters, ['where'])
    const rows = s.rows.map((d) => (DIMS[d] ? DIMS[d].label.toLowerCase() : d))
    const named = (id: string) => (['property', 'advertiser', 'top_parent', 'product'].includes(dimOf(id)) ? labelOf(dimOf(id), id) : dimOf(id) === 'market' ? `the ${labelOf('market', id)} market` : `all ${labelOf(dimOf(id), id)}`)
    if (s.zero_share) {
      const z = s.zero_share
      const mine = z.mine.length ? listText(z.mine.map((id) => labelOf(dimOf(id), id))) : 'your properties'
      const vs = z.versus.length ? listText(z.versus.map(named)) : z.all ? 'any other property' : 'other properties'
      const by = rows.length ? ` by ${rows.join(', then ')}` : ''
      if (z.mode === 'wallet') parts.push(`Share of wallet: ${mine} against ${vs}${by}`)
      else if (z.mode === 'mine') parts.push(`Spend on ${mine}${by}`)
      else if (z.mode === 'theirs') parts.push(`Spend on ${vs}, not ${mine},${by}`)
      else {
        parts.push(`Advertisers spending on ${vs} but nothing on ${mine}`)
        if (rows.length) parts.push(`listed by ${rows.join(', then ')}`)
      }
      if (z.mode !== 'zero' && s.columns && DIMS[s.columns]) parts[parts.length - 1] += `, with a column per ${DIMS[s.columns].label.toLowerCase()}`
    } else {
      let lead = s.measures.map((k) => MEASURES[k]?.label ?? k).join(', ') + (rows.length ? ` by ${rows.join(', then ')}` : '')
      if (s.columns && DIMS[s.columns]) lead += `, with a column per ${DIMS[s.columns].label.toLowerCase()}`
      parts.push(lead)
    }
    const scope: string[] = []
    if (s.compare) scope.push(`${s.compare.mine.length ? listText(s.compare.mine.map(named)) : 'your brands'} vs ${s.compare.rivals.length ? listText(s.compare.rivals.map(named)) : 'competitors'}`)
    if (who.length) scope.push(listText(who))
    if (what.length) scope.push(listText(what))
    if (where.length) scope.push(`${s.zero_share ? 'competing media limited to ' : 'on '}${listText(where)}`)
    if (scope.length || !s.zero_share) parts.push(scope.length ? scope.join(' · ') : 'all advertisers')
    const per = periodOf(s, a)
    if (!('error' in per)) parts.push(`${per.label} (${per.how})`)
    parts.push(s.options.final_only ? 'final data only' : 'including preliminary data')
    if (s.calcs.includes('share')) parts.push(s.columns ? 'with % down' : 'with share of total')
    if (s.calcs.includes('share_across') && s.columns) parts.push('with % across')
    if (s.calcs.includes('yoy')) parts.push('with change vs prior year')
    if (s.options.top_n) parts.push(`top ${s.options.top_n} rows`)
    return parts.join(' · ')
  }

  async function summarize(specIn: Spec): Promise<string> {
    await ensureLabels(specIn)
    return summarizeSync(normalize(specIn), await availability())
  }

  // ---- the query

  function whereParts(s: NSpec, start: number, end: number, days?: { d0: number; d1: number }) {
    const groups: Record<'who' | 'what' | 'where', string[]> = { who: [], what: [], where: [] }
    for (const [dim, ids] of Object.entries(s.filters)) {
      const d = DIMS[dim as Dim]
      const nums = idsOf(ids)
      if (!d || d.time || !nums.length) continue
      groups[d.group as 'who' | 'what' | 'where'].push(`${d.id} IN (${nums.join(',')})`)
    }
    const or = (xs: string[]) => (xs.length ? `(${xs.join(' OR ')})` : '')
    const path: string[] = []
    for (const [dim, id] of Object.entries(s.path ?? {})) {
      const d = DIMS[dim as Dim]
      if (!d) continue
      if (dim === 'month') {
        const t = parseMonth(id)
        if (t != null) path.push(`year_month = ${toYm(t)}`)
      } else if (d.time) path.push(`${d.id} = '${String(id).replace(/[^0-9Q-]/g, '')}'`)
      else {
        const n = num(id)
        if (n !== null) path.push(`${d.id} = ${n}`)
      }
    }
    return {
      path: path.join(' AND '),
      // The daily tables: the days, and a month either side for the sort key (TV files a few days under the next or last broadcast month).
      time: days
        ? `year_month BETWEEN ${toYm(start - 1)} AND ${toYm(end + 1)} AND start_date BETWEEN '${dStr(days.d0)}' AND '${dStr(days.d1)}'`
        : `year_month BETWEEN ${toYm(start)} AND ${toYm(end)}`,
      who: or(groups.who),
      what: or(groups.what),
      where: or(groups.where),
    }
  }

  async function run(specIn: Spec, opts: { limit?: number } = {}): Promise<Result> {
    const key = JSON.stringify([specIn, opts.limit ?? 0])
    const hit = memo.get(key)
    if (hit) return hit
    const p = runUncached(specIn, opts)
    memo.set(key, p)
    if (memo.size > 30) memo.delete(memo.keys().next().value!)
    p.catch(() => memo.delete(key))
    return p
  }

  async function runUncached(specIn: Spec, opts: { limit?: number }): Promise<Result> {
    const s = normalize(specIn)
    await ensureLabels(s)
    const a = await availability()
    const through = throughOf(s, a)
    const per = periodOf(s, a)
    if ('error' in per) throw new Error(per.error)
    const notes = [...per.notes]
    const daily = needsDaily(s)
    const TABLE = daily ? await dailySource() : MONTH_TABLE
    const zs = s.zero_share
    const wallet = zs?.mode === 'wallet'
    const R = s.rows.filter((d) => DIMS[d])
    const C = s.columns && DIMS[s.columns] ? s.columns : null
    const M = s.measures.filter((k) => MEASURES[k])
    const primary: MeasureKey = M[0] ?? 'spend'
    // With a column breakdown only the percents work (in each cell); prior year needs rows alone.
    const calcs: NSpec['calcs'] = wallet ? [] : C ? s.calcs.filter((c) => c === 'share' || c === 'share_across') : s.calcs.filter((c) => c !== 'share_across')
    const down = Boolean(C) && calcs.includes('share')
    const across = Boolean(C) && calcs.includes('share_across')
    const w = whereParts(s, per.start, per.end, daily ? per : undefined)
    const mineIds = new Set(s.compare?.mine ?? [])

    // Rows in scope, and which of their spend counts.
    const subject = [w.who, w.what, w.path, s.compare ? idSql([...s.compare.mine, ...s.compare.rivals]) : ''].filter(Boolean)
    let scope: string
    let counted: string
    let mineSql = ''
    if (zs) {
      // Publisher Intel: zero (competitors, not you), wallet (you and competitors), mine (only you), theirs (only competitors).
      mineSql = idSql(zs.mine)
      scope = [w.time, BASE, ...subject].join(' AND ')
      const theirs = [`NOT ${mineSql}`, zs.versus.length ? idSql(zs.versus) : '', w.where].filter(Boolean).join(' AND ')
      counted = zs.mode === 'mine' ? [mineSql, w.where].filter(Boolean).join(' AND ') : wallet ? `(${mineSql} OR (${theirs}))` : theirs
    } else {
      scope = [w.time, BASE, ...subject, w.where].filter(Boolean).join(' AND ')
      counted = '1'
    }
    const agg = (k: MeasureKey, cond = counted) => `toFloat64(sumIf(${MEASURES[k].sql}, ${cond}))`

    // Column breakdown: its values first (every month in the period; the 12 largest otherwise).
    let colVals: Array<{ id: string; name: string }> = []
    let moreCols = 0
    if (C && Array.isArray(s.col_ids)) {
      const d = DIMS[C]
      colVals = s.col_ids.map((id) => ({ id, name: d.time ? (C === 'month' ? monthLabel(toIdx(Number(id))) : labelOf(C, id)) : (labels.get(`${C}:${id}`) ?? id) }))
      void d
    } else if (C) {
      const d = DIMS[C]
      const vals = await chQuery<{ id: string; name: string; v: number; n: number }>(
        config(),
        `SELECT toString(${d.id}) AS id, any(${d.name}) AS name, ${agg(primary)} AS v, count() OVER () AS n FROM ${TABLE} WHERE ${scope} GROUP BY id HAVING v != 0 ORDER BY ${d.time ? 'id ASC' : 'v DESC'} LIMIT ${d.time ? 100 : 12}`,
        {},
        SETTINGS,
      )
      colVals = vals.map((r) => ({ id: r.id, name: d.time ? (C === 'month' ? labelOf('month', monthId(toIdx(Number(r.id)))) : labelOf(C, r.id)) : r.name }))
      moreCols = vals.length ? Math.max(0, Number(vals[0]!.n) - vals.length) : 0
      for (const v of vals) if (!d.time) labels.set(`${C}:${v.id}`, v.name)
    }

    const selects: string[] = []
    R.forEach((dim, i) => {
      const d = DIMS[dim]
      selects.push(`toString(${d.id}) AS r${i}`, `any(${d.name}) AS n${i}`)
    })
    for (const k of M) selects.push(`${agg(k)} AS m_${k}`)
    const withMine = zs && (zs.mode === 'zero' || wallet)
    if (withMine) selects.push(`toFloat64(sumIf(cost_share_v, ${mineSql})) AS mine_spend`)
    // Share of wallet by column: spend with you and in all, per value, as well as the measures.
    const walletKeys: string[] = wallet ? ['spend', 'mine'] : M
    colVals.forEach((c, j) => {
      const inCol = `toString(${DIMS[C!].id}) = '${c.id.replace(/'/g, '')}'`
      for (const k of M) selects.push(`toFloat64(sumIf(${MEASURES[k].sql}, (${counted}) AND ${inCol})) AS c${j}_${k}`)
      if (wallet) {
        if (!M.includes('spend')) selects.push(`toFloat64(sumIf(cost_share_v, (${counted}) AND ${inCol})) AS c${j}_spend`)
        selects.push(`toFloat64(sumIf(cost_share_v, ${mineSql} AND ${inCol})) AS c${j}_mine`)
      }
    })
    const groupBy = R.length ? ` GROUP BY ${R.map((_, i) => `r${i}`).join(', ')}` : ''
    const having = zs?.mode === 'zero' ? ' HAVING mine_spend = 0 AND m_spend > 0' : ` HAVING m_${primary} != 0`
    const grouped = `SELECT ${selects.join(', ')} FROM ${TABLE} WHERE ${scope}${groupBy}${having}`
    const firstTime = R.length && DIMS[R[0]!].time
    const order = firstTime ? 'r0 ASC' : `m_${primary} DESC`
    const cap = Math.min(opts.limit ?? DOWNLOAD_ROW_LIMIT, s.options.top_n ?? Infinity, DOWNLOAD_ROW_LIMIT)

    type Row = Record<string, string | number>
    const [rows, totals] = await Promise.all([
      chQuery<Row>(config(), `SELECT *, count() OVER () AS __n FROM (${grouped}) ORDER BY ${order} LIMIT ${cap}`, {}, SETTINGS),
      chQuery<Row>(
        config(),
        `SELECT ${[...M.map((k) => `sum(m_${k}) AS m_${k}`), ...(withMine ? ['sum(mine_spend) AS mine_spend'] : []), ...colVals.flatMap((_, j) => Array.from(new Set([...M, ...(wallet ? walletKeys : [])])).map((k) => `sum(c${j}_${k}) AS c${j}_${k}`))].join(', ')}, count() AS n FROM (${grouped})`,
        {},
        SETTINGS,
      ),
    ])
    const matched = Number(totals[0]?.n ?? 0)
    for (const r of rows) R.forEach((dim, i) => !DIMS[dim].time && labels.set(`${dim}:${r[`r${i}`]}`, String(r[`n${i}`])))

    // Prior year, for the rows shown.
    const prior = new Map<string, number>()
    let priorTotal = 0
    if (calcs.includes('yoy')) {
      const ps = per.start - 12
      const pe = per.end - 12
      if (pe < a.firstComplete) notes.push(`A year earlier, the data covers only some media (all media start in ${monthLabel(a.firstComplete)}), so the change is not like for like.`)
      const pw = whereParts(s, ps, pe)
      const pscope = [pw.time, BASE, pw.who, pw.what, pw.where].filter(Boolean).join(' AND ')
      const keys = R.length ? rows.map((r) => `(${R.map((_, i) => `'${String(r[`r${i}`]).replace(/'/g, '')}'`).join(',')})`) : []
      const keyExpr = R.length ? `(${R.map((d) => `toString(${DIMS[d].id})`).join(',')})` : ''
      const pr = await chQuery<Row>(
        config(),
        `SELECT ${R.length ? `${R.map((d, i) => `toString(${DIMS[d].id}) AS r${i}`).join(', ')}, ` : ''}toFloat64(sum(${MEASURES[primary].sql})) AS v FROM ${TABLE} WHERE ${pscope}${keys.length ? ` AND ${keyExpr} IN (${keys.join(',')})` : ''}${groupBy}`,
        {},
        SETTINGS,
      )
      for (const r of pr) prior.set(R.map((_, i) => r[`r${i}`]).join('\u0001'), Number(r.v))
      const pt = await chQuery<Row>(config(), `SELECT toFloat64(sum(${MEASURES[primary].sql})) AS v FROM ${TABLE} WHERE ${pscope}`, {}, SETTINGS)
      priorTotal = Number(pt[0]?.v ?? 0)
    }

    const columns: Result['columns'] = R.map((d) => ({ key: d, label: DIMS[d].label, type: 'text' }))
    const mLabel = (k: MeasureKey) => (zs && k === 'spend' ? (zs.mode === 'mine' ? 'Spend on your properties' : 'Spend on competing properties') : MEASURES[k].label)
    if (wallet) {
      // With a column breakdown, each value gets the three, stacked in one cell on the page.
      const three = (key: string, group?: string, colId?: string) => [
        { key: `${key}yours`, label: group ? `${group} · With you` : 'Spend with you', type: 'money' as const, ...(group ? { group, measure: 'With you', ...(colId ? { colId } : {}) } : {}) },
        { key: `${key}theirs`, label: group ? `${group} · With competitors` : 'Spend with competitors', type: 'money' as const, ...(group ? { group, measure: 'With competitors', ...(colId ? { colId } : {}) } : {}) },
        { key: `${key}wallet`, label: group ? `${group} · Your share` : 'Your share', type: 'pct' as const, ...(group ? { group, measure: 'Your share', ...(colId ? { colId } : {}) } : {}) },
      ]
      if (C) {
        colVals.forEach((c) => columns.push(...three(`c:${c.id}:`, c.name, c.id)))
        columns.push(...three('total:', 'Total'))
        if (moreCols) notes.push(`Showing the 12 largest ${DIMS[C].plural}; ${moreCols} smaller ones are in the total.`)
      } else columns.push(...three(''))
    } else if (C) {
      // One column per value and measure. With several measures the page stacks a value's
      // measures in one cell (group); the spreadsheet keeps a column each.
      // The percents sit right after the first measure, in the same cell.
      const many = M.length > 1 || down || across
      const pcts = [...(down ? [{ key: 'down', label: '% of column' }] : []), ...(across ? [{ key: 'across', label: '% of row' }] : [])]
      colVals.forEach((c) =>
        M.forEach((k, i) => {
          columns.push({ key: `c:${c.id}${many ? `:${k}` : ''}`, label: `${c.name}${many ? ` · ${MEASURES[k].label}` : ''}`, type: MEASURES[k].type, colId: c.id, group: c.name, measure: MEASURES[k].label })
          if (i === 0) for (const p of pcts) columns.push({ key: `c:${c.id}:${p.key}`, label: `${c.name} · ${p.label}`, type: 'pct', colId: c.id, group: c.name, measure: p.label })
        }),
      )
      M.forEach((k, i) => {
        columns.push({ key: many ? `total:${k}` : 'total', label: `Total ${MEASURES[k].label.toLowerCase()}`, type: MEASURES[k].type, group: 'Total', measure: MEASURES[k].label })
        if (i === 0 && down) columns.push({ key: 'total:down', label: 'Total · % of column', type: 'pct', group: 'Total', measure: '% of column' })
      })
      if (moreCols) notes.push(`Showing the 12 largest ${DIMS[C].plural}; ${moreCols} smaller ones are in the total.`)
    } else {
      M.forEach((k, i) => {
        columns.push({ key: k, label: mLabel(k), type: MEASURES[k].type })
        if (i === 0 && calcs.includes('share')) columns.push({ key: 'share', label: 'Share of total', type: 'pct' })
        if (i === 0 && calcs.includes('yoy')) {
          columns.push({ key: 'prior', label: 'Same period, prior year', type: MEASURES[k].type })
          columns.push({ key: 'change', label: 'Change', type: 'change' })
        }
      })
    }
    const totalPrimary = Number(totals[0]?.[`m_${primary}`] ?? 0)
    const pct = (x: number, y: number) => (y ? Math.round((x / y) * 1000) / 10 : null)
    // Cents for money, whole numbers for counts: the spreadsheet should not carry float noise.
    const tidy = (k: MeasureKey, v: number) => (MEASURES[k].type === 'money' ? Math.round(v * 100) / 100 : Math.round(v))
    const cells = (r: Row | undefined, isTotal: boolean): unknown[] => {
      const out: unknown[] = isTotal
        ? R.map((_, i) => (i === 0 ? 'Total' : ''))
        : R.map((dim, i) =>
            DIMS[dim].time
              ? dim === 'month'
                ? monthLabel(toIdx(Number(r![`r${i}`])))
                : labelOf(dim, String(r![`r${i}`]))
              : String(r![`n${i}`]) + (mineIds.has(`${dim}:${r![`r${i}`]}`) ? ' (you)' : ''),
          )
      if (wallet) {
        const split = (all: number, yours: number) => out.push(tidy('spend', yours), tidy('spend', all - yours), pct(yours, all))
        if (C) colVals.forEach((_, j) => split(Number(r?.[`c${j}_spend`] ?? 0), Number(r?.[`c${j}_mine`] ?? 0)))
        split(Number(r?.m_spend ?? 0), Number(r?.mine_spend ?? 0))
      } else if (C) {
        const rowTotal = Number(r?.[`m_${primary}`] ?? 0)
        colVals.forEach((_, j) =>
          M.forEach((k, i) => {
            const v = Number(r?.[`c${j}_${k}`] ?? 0)
            out.push(tidy(k, v))
            if (i === 0 && down) out.push(pct(v, Number(totals[0]?.[`c${j}_${primary}`] ?? 0)))
            if (i === 0 && across) out.push(pct(v, rowTotal))
          }),
        )
        M.forEach((k, i) => {
          out.push(tidy(k, Number(r?.[`m_${k}`] ?? 0)))
          if (i === 0 && down) out.push(pct(rowTotal, totalPrimary))
        })
      } else {
        M.forEach((k, i) => {
          const v = Number(r?.[`m_${k}`] ?? 0)
          out.push(tidy(k, v))
          if (i === 0 && calcs.includes('share')) out.push(pct(v, totalPrimary))
          if (i === 0 && calcs.includes('yoy')) {
            const pv = isTotal ? priorTotal : (prior.get(R.map((_, j) => r?.[`r${j}`]).join('\u0001')) ?? 0)
            out.push(pv ? tidy(k, pv) : null)
            out.push(pv ? Math.round(((v - pv) / pv) * 1000) / 10 : null)
          }
        })
      }
      return out
    }

    const rowCount = Math.min(matched, s.options.top_n ?? Infinity)
    if (s.options.top_n && matched > s.options.top_n) notes.push(`Showing the top ${s.options.top_n} of ${matched.toLocaleString('en-US')} rows; the total covers all of them.`)
    if (!opts.limit && matched > DOWNLOAD_ROW_LIMIT) notes.push(`The spreadsheet holds the first ${DOWNLOAD_ROW_LIMIT.toLocaleString('en-US')} rows of ${matched.toLocaleString('en-US')}. Narrow the report for the rest.`)
    if (!s.options.final_only) notes.push(`Figures for ${monthLabel(through)} are preliminary and still loading.`)
    if (!matched) notes.push(zs?.mode === 'zero' ? 'No advertisers matched: everyone in scope who spent on the competing properties also spent on yours.' : 'No spend matched these selections in this period.')
    const outRows = rows.map((r) => cells(r, false))
    // Each row's ids, as filters and paths use them, for drilling into it.
    const keys = rows.map((r) => R.map((dim, i) => (dim === 'month' ? monthId(toIdx(Number(r[`r${i}`]))) : DIMS[dim].time ? String(r[`r${i}`]) : `${dim}:${r[`r${i}`]}`)))
    return {
      columns,
      rows: outRows,
      keys,
      totals: R.length ? cells(totals[0], true) : null,
      row_count: rowCount,
      rows_shown: outRows.length,
      total: totalPrimary,
      total_measure: MEASURES[primary].label,
      period: { start: daily ? dStr(per.d0) : monthId(per.start), end: daily ? dStr(per.d1) : monthId(per.end), label: per.label, how: per.how, moves_with_new_data: per.moves },
      data_through: monthId(through),
      data_through_label: monthLabel(through),
      summary: summarizeSync(s, a),
      notes,
    }
  }

  // ---- the interview

  async function topOptions(types: Dim[], n: number, toPatch: (h: { id: string; type: string }) => Patch): Promise<Option[]> {
    const hits = await search('', { types, limit: n })
    return hits.map((h) => ({ label: h.label, description: h.type_label + (h.context && h.type !== 'top_parent' && h.type !== 'industry' ? ` · ${h.context}` : ''), patch: toPatch(h) }))
  }

  /** Choices for "who do you compete with": the biggest properties in your media, all of your media, or everything. */
  async function competitorOptions(mine: string[]): Promise<Option[]> {
    const a = await availability()
    const ym = toYm(a.through)
    const mineSql = idSql(mine)
    const out: Option[] = []
    const [media] = await chQuery<{ id: string; name: string }>(config(), `SELECT toString(coalesce(media_id, 0)) AS id, any(media_name) AS name FROM ${TABLE} WHERE year_month = ${ym} AND ${mineSql} GROUP BY id ORDER BY sum(cost_share_v) DESC LIMIT 1`, {}, SETTINGS)
    if (media) {
      const P = DIMS.property
      const props = await chQuery<{ id: string; name: string; ctx: string }>(
        config(),
        `SELECT toString(${P.id}) AS id, any(${P.name}) AS name, any(${P.context}) AS ctx FROM ${TABLE} WHERE year_month = ${ym} AND coalesce(media_id, 0) = ${Number(media.id)} AND NOT ${mineSql} AND ${P.name} != '' GROUP BY id ORDER BY sum(cost_share_v) DESC LIMIT 4`,
        {},
        SETTINGS,
      )
      for (const p of props) {
        const id = `property:${p.id}`
        labels.set(id, p.name)
        contexts.set(id, p.ctx)
        out.push({ label: p.name, description: `Property · ${p.ctx}`, patch: { add: { 'zero_share.versus': [id] } } })
      }
      const mid = `media_type:${media.id}`
      labels.set(mid, media.name)
      out.push({ label: `All other ${media.name}`, description: `Every ${media.name} property but yours`, patch: { set: { 'zero_share.versus': [mid] } } })
    }
    out.push({ label: 'All other properties', description: 'Any media, any property but yours', patch: { set: { 'zero_share.all': true } } })
    return out
  }

  /** Choices for a brand's competitors: the biggest advertisers in its subcategory, the subcategory, or the category. */
  async function rivalOptions(mine: string[]): Promise<Option[]> {
    const a = await availability()
    const ym = toYm(a.through)
    const mineSql = idSql(mine)
    const out: Option[] = []
    const [sub] = await chQuery<{ id: string; name: string; cid: string; cname: string }>(
      config(),
      `SELECT toString(coalesce(subcategory_id, 0)) AS id, any(subcategory_name) AS name, toString(any(coalesce(category_id, 0))) AS cid, any(category_name) AS cname FROM ${TABLE} WHERE year_month = ${ym} AND ${BASE} AND ${mineSql} GROUP BY id ORDER BY sum(cost_share_v) DESC LIMIT 1`,
      {},
      SETTINGS,
    )
    if (sub) {
      const A = DIMS.advertiser
      const top = await chQuery<{ id: string; name: string; ctx: string }>(
        config(),
        `SELECT toString(${A.id}) AS id, any(${A.name}) AS name, any(${A.context}) AS ctx FROM ${TABLE} WHERE year_month = ${ym} AND ${BASE} AND coalesce(subcategory_id, 0) = ${Number(sub.id)} AND NOT ${mineSql} GROUP BY id ORDER BY sum(cost_share_v) DESC LIMIT 4`,
        {},
        SETTINGS,
      )
      for (const r of top) {
        const id = `advertiser:${r.id}`
        labels.set(id, r.name)
        out.push({ label: r.name, description: `Advertiser${r.ctx ? ` · ${r.ctx}` : ''}`, patch: { add: { 'compare.rivals': [id] } } })
      }
      labels.set(`subcategory:${sub.id}`, sub.name)
      labels.set(`category:${sub.cid}`, sub.cname)
      out.push({ label: `All of ${sub.name}`, description: 'Every advertiser in your subcategory', patch: { set: { 'compare.rivals': [`subcategory:${sub.id}`] } } })
      if (sub.cname && sub.cname !== sub.name) out.push({ label: `All of ${sub.cname}`, description: 'Every advertiser in your category', patch: { set: { 'compare.rivals': [`category:${sub.cid}`] } } })
    }
    return out
  }

  async function validate(specIn: Spec, patch?: Patch | null): Promise<Validation> {
    const spec = normalize(applyPatch(specIn ?? {}, patch))
    await ensureLabels(spec)
    const a = await availability()
    const errors: Validation['errors'] = []
    const warnings: string[] = []
    const questions: Validation['questions'] = []
    const isDim = (d: string) => Boolean(DIMS[d as Dim])
    const badDims = [...spec.rows, ...(spec.columns ? [spec.columns] : []), ...Object.keys(spec.filters)].filter((d) => !isDim(d))
    if (badDims.length) errors.push({ code: 'unknown_dimension', message: `Unknown dimension: ${uniq(badDims).join(', ')}.`, fixes: [] })
    const badM = spec.measures.filter((m) => !MEASURES[m])
    if (badM.length) errors.push({ code: 'unknown_measure', message: `Unknown measure: ${badM.join(', ')}.`, fixes: [{ label: 'Use spend', patch: { set: { measures: ['spend'] } } }] })
    const badC = spec.calcs.filter((c) => !CALCS[c])
    if (badC.length) errors.push({ code: 'unknown_calc', message: `Unknown calculation: ${badC.join(', ')}.`, fixes: [{ label: 'Remove it', patch: { remove: { calcs: badC } } }] })
    for (const [dim, ids] of Object.entries(spec.filters)) {
      if (!isDim(dim) || DIMS[dim as Dim].time) continue
      const bad = ids.filter((id) => !labels.has(id))
      if (bad.length) errors.push({ code: 'unknown_value', message: `These ${DIMS[dim as Dim].plural} are not in the data: ${bad.join(', ')}. Look names up with search_names.`, fixes: [{ label: 'Remove them', patch: { remove: { [`filters.${dim}`]: bad } } }] })
    }
    if (spec.columns && spec.rows.includes(spec.columns))
      errors.push({ code: 'dimension_twice', message: `${DIMS[spec.columns]?.label ?? 'A dimension'} is used for both rows and columns.`, fixes: [{ label: 'Keep it as columns', patch: { remove: { rows: [spec.columns] } } }, { label: 'Keep it as rows', patch: { set: { columns: null } } }] })
    if (spec.columns && spec.calcs.includes('yoy'))
      errors.push({
        code: 'calc_with_columns',
        message: `Change vs prior year cannot be combined with a column per ${DIMS[spec.columns]?.label.toLowerCase() ?? 'value'}.`,
        fixes: [{ label: 'Drop the column breakdown', patch: { set: { columns: null } } }, { label: 'Drop the prior-year change', patch: { remove: { calcs: ['yoy'] } } }],
      })
    if (!spec.columns && spec.calcs.includes('share_across'))
      errors.push({
        code: 'across_without_columns',
        message: '% across needs a column breakdown to go across.',
        fixes: [{ label: 'Add a column per month', patch: { set: { columns: 'month' } } }, { label: 'Use share of total instead', patch: { remove: { calcs: ['share_across'] }, add: { calcs: ['share'] } } }],
      })
    const per = spec.time ? periodOf(spec, a) : null
    if (per && 'error' in per) errors.push({ code: 'bad_period', message: per.error!, fixes: [{ label: 'Use the last 3 complete months', patch: { set: { time: RECENT } } }] })
    if (per && !('error' in per)) {
      const span = per.d1 - per.d0 + 1
      for (const d of [...spec.rows, ...(spec.columns ? [spec.columns] : [])]) {
        const max = DAILY_LIMIT[d]
        if (max && span > max)
          errors.push({
            code: 'period_too_long',
            message: `A breakdown by ${DIMS[d].label.toLowerCase()} covers at most ${d === 'day' ? '3 months' : 'a year'}; this period is ${span} days.`,
            fixes: d === 'day' ? [{ label: 'Last 4 weeks', patch: { set: { time: WEEKS } } }, { label: 'By broadcast week instead', patch: { set: spec.columns === 'day' ? { columns: 'broadcast_week' } : { rows: spec.rows.map((r) => (r === 'day' ? 'broadcast_week' : r)) } } }] : [{ label: 'Last 13 weeks', patch: { set: { time: QUARTER_OF_WEEKS } } }],
          })
      }
    }
    if (needsDaily(spec) && spec.calcs.includes('yoy'))
      errors.push({ code: 'yoy_daily', message: 'Change vs prior year works with months, not days or weeks.', fixes: [{ label: 'Drop the prior-year change', patch: { remove: { calcs: ['yoy'] } } }, { label: 'Use the last 3 complete months', patch: { set: { time: RECENT, columns: null } } }] })

    const hasSubject = Object.keys(spec.filters).some((d) => isDim(d) && (DIMS[d as Dim].group === 'who' || DIMS[d as Dim].group === 'what'))
    const hasWhat = Object.keys(spec.filters).some((d) => isDim(d) && DIMS[d as Dim].group === 'what')
    const addFilter = (h: { id: string; type: string }): Patch => ({ add: { [`filters.${h.type}`]: [h.id] } })

    if (!spec.rows.length) {
      questions.push({ id: 'template', prompt: 'What kind of report do you want?', kind: 'choice', options: TEMPLATES.map((t) => ({ label: t.label, description: t.description, patch: { set: clone(t.spec) } })) })
    } else if (spec.zero_share && !spec.zero_share.mine.length) {
      questions.push({ id: 'my_properties', prompt: 'Which properties are yours?', kind: 'entity', entity_types: ['property', 'media_owner'], patch_path: 'zero_share.mine', options: await topOptions(['property'], 6, (h) => ({ add: { 'zero_share.mine': [h.id] } })) })
    } else if (spec.zero_share && spec.zero_share.mode !== 'mine' && !spec.zero_share.versus.length && !spec.zero_share.all) {
      questions.push({ id: 'competitors', prompt: 'Which properties do you compete with?', kind: 'entity', entity_types: ['property', 'media_type', 'media_owner', 'market'], patch_path: 'zero_share.versus', options: await competitorOptions(spec.zero_share.mine) })
    } else if (spec.compare && !spec.compare.mine.length) {
      questions.push({ id: 'my_brands', prompt: 'Which brands are yours?', kind: 'entity', entity_types: ['advertiser', 'top_parent', 'product'], patch_path: 'compare.mine', options: await topOptions(['advertiser'], 6, (h) => ({ add: { 'compare.mine': [h.id] } })) })
    } else if (spec.compare && !spec.compare.rivals.length) {
      questions.push({ id: 'rivals', prompt: 'Who do you compete with?', kind: 'entity', entity_types: ['advertiser', 'top_parent', 'product', 'industry', 'category', 'subcategory'], patch_path: 'compare.rivals', options: await rivalOptions(spec.compare.mine) })
    } else if (spec.template === 'category_share' && !hasWhat && spec.scope !== 'all') {
      questions.push({
        id: 'category',
        prompt: 'Which category should the shares be measured in?',
        kind: 'entity',
        entity_types: ['industry', 'category', 'subcategory'],
        options: [...(await topOptions(['category'], 5, addFilter)), { label: 'All categories', description: 'Share of total spend', patch: { set: { scope: 'all' } } }],
      })
    } else if (!spec.zero_share && !spec.compare && !hasSubject && spec.scope !== 'all') {
      questions.push({
        id: 'subject',
        prompt: 'Which advertisers, products or categories?',
        kind: 'entity',
        entity_types: ['top_parent', 'advertiser', 'product', 'industry', 'category', 'subcategory'],
        options: [...(await topOptions(['advertiser'], 5, addFilter)), { label: 'Everything', description: 'No filter', patch: { set: { scope: 'all' } } }],
      })
    } else if (!spec.time) {
      questions.push({
        id: 'time',
        prompt: 'What time period?',
        kind: 'choice',
        options: [
          { label: 'Last 3 months', patch: { set: { time: RECENT } } },
          { label: 'Last 4 weeks', patch: { set: { time: WEEKS } } },
          { label: 'Latest month', patch: { set: { time: { mode: 'rolling', unit: 'month', count: 1 } } } },
          { label: 'Year to date', patch: { set: { time: { mode: 'ytd' } } } },
        ],
      })
    }

    const ok = !errors.length && !questions.length
    let rowCount: number | null = null
    const refinements: Option[] = []
    if (ok) {
      const res = await run(spec, { limit: 10 })
      rowCount = res.row_count
      if (rowCount > INLINE_ROW_LIMIT) warnings.push(`This is a large extract (${rowCount.toLocaleString('en-US')} rows). It will be delivered as a file.`)
      if (spec.time?.mode === 'static') warnings.push('This period is fixed. If the report is saved, re-running it will not pick up newer months.')
      const tm = spec.time ?? {}
      const isRolling = (u: string, c: number) => tm.mode === 'rolling' && (tm.unit ?? 'month') === u && Number(tm.count) === c
      const add = (label: string, p: Patch) => refinements.push({ label, patch: p })
      if (!spec.columns && !spec.rows.some((d) => DIMS[d]?.time)) add('Add a column per month', { set: { columns: 'month' }, remove: { calcs: ['yoy'] } })
      if (spec.columns) add('Remove the column breakdown', { set: { columns: null } })
      if (!spec.rows.includes('product')) add('Break out by product', { add: { rows: ['product'] } })
      if (!spec.rows.includes('media_type') && spec.columns !== 'media_type') add('Break out by media type', { add: { rows: ['media_type'] } })
      if (!spec.rows.includes('property') && spec.columns !== 'property') add('Break out by property', { add: { rows: ['property'] } })
      if (!isRolling('month', 3)) add('Last 3 months', { set: { time: RECENT } })
      if (!isRolling('month', 1)) add('Latest month', { set: { time: { mode: 'rolling', unit: 'month', count: 1 } } })
      if (!isRolling('week', 4)) add('Last 4 weeks', { set: { time: WEEKS } })
      if (spec.columns === 'month') add('By broadcast week', { set: { columns: 'broadcast_week', time: QUARTER_OF_WEEKS } })
      if (!spec.columns && !spec.zero_share && !spec.calcs.includes('share')) add('Add share of total', { add: { calcs: ['share'] } })
      if (spec.columns && spec.zero_share?.mode !== 'wallet' && !spec.calcs.includes('share')) add('Add % down', { add: { calcs: ['share'] } })
      if (spec.columns && spec.zero_share?.mode !== 'wallet' && !spec.calcs.includes('share_across')) add('Add % across', { add: { calcs: ['share_across'] } })
      if (spec.zero_share?.versus.length) add('Compare with all other properties', { set: { 'zero_share.versus': [], 'zero_share.all': true } })
      if (!spec.measures.includes('occurrences')) add('Add occurrences', { add: { measures: ['occurrences'] } })
        if (!spec.measures.includes('impressions')) add('Add impressions', { add: { measures: ['impressions'] } })
      if (!spec.options.top_n && rowCount > 25) add('Top 25 only', { set: { 'options.top_n': 25 } })
      add(spec.options.final_only ? 'Include the current month' : 'Complete months only', { set: { 'options.final_only': !spec.options.final_only } })
    }
    return {
      ok,
      spec: spec as Validation['spec'],
      summary: spec.rows.length ? summarizeSync(spec, a) : null,
      errors,
      warnings,
      questions,
      refinements,
      row_count: rowCount,
      delivery: rowCount != null && rowCount > INLINE_ROW_LIMIT ? 'file' : 'inline',
    }
  }

  // ---- saved reports

  interface SavedRec {
    id: string
    name: string
    spec: Spec
    created_at: string
    updated_at: string
    last_run: { at: string; period_label: string; data_through: string; total: number; row_count: number } | null
  }

  async function describeSaved(rec: SavedRec, a: Availability): Promise<SavedSummary> {
    const s = normalize(rec.spec)
    const per = resolveTime(s.time, throughOf(s, a), a.firstComplete)
    return { id: rec.id, name: rec.name, summary: summarizeSync(s, a), moves_with_new_data: !('error' in per) && per.moves, last_run: rec.last_run }
  }

  async function listSaved(): Promise<SavedSummary[]> {
    const a = await availability()
    const saved = state().saved as SavedRec[]
    for (const r of saved) await ensureLabels(r.spec)
    return Promise.all(saved.map((r) => describeSaved(r, a)))
  }

  function findSaved(text: string): { id: string; name: string } | null {
    const q = norm(text)
    const all = state().saved as SavedRec[]
    return all.find((r) => r.id === text) ?? all.find((r) => norm(r.name) === q) ?? all.find((r) => q && norm(r.name).includes(q)) ?? null
  }

  async function getSaved(id: string): Promise<SavedSummary & { spec: Spec }> {
    const rec = (state().saved as SavedRec[]).find((r) => r.id === id)
    if (!rec) throw new Error(`No saved report with id ${id}.`)
    await ensureLabels(rec.spec)
    return { ...(await describeSaved(rec, await availability())), spec: clone(rec.spec) }
  }

  async function saveReport(name: string, specIn: Spec, id?: string): Promise<SavedSummary> {
    const v = await validate(specIn)
    if (!v.ok) throw new Error(`This report is not ready to save: ${v.errors[0]?.message ?? v.questions[0]?.prompt}`)
    const s = state()
    const saved = s.saved as SavedRec[]
    let rec = id ? saved.find((r) => r.id === id) : undefined
    if (id && !rec) throw new Error(`No saved report with id ${id}.`)
    if (!rec) {
      s.seq += 1
      rec = { id: `rpt_${s.seq}`, name: '', spec: {}, created_at: now(), updated_at: now(), last_run: null }
      saved.push(rec)
    }
    rec.name = String(name ?? '').trim() || 'Untitled report'
    rec.spec = v.spec
    rec.updated_at = now()
    store.save(s)
    return describeSaved(rec, await availability())
  }

  async function runSaved(idOrName: string, opts: { limit?: number } = {}) {
    const s = state()
    const saved = s.saved as SavedRec[]
    const found = saved.find((r) => r.id === idOrName) ?? (findSaved(idOrName) ? saved.find((r) => r.id === findSaved(idOrName)!.id) : undefined)
    if (!found) throw new Error(`No saved report matches "${idOrName}".`)
    const result = await run(found.spec, opts)
    const prev = found.last_run
    let since: { text: string; period_changed?: boolean }
    if (!prev) since = { text: 'First run of this saved report.' }
    else {
      const periodChanged = prev.period_label !== result.period.label
      const change = prev.total ? Math.round(((result.total - prev.total) / prev.total) * 1000) / 10 : null
      const bits: string[] = []
      if (periodChanged) bits.push(`The period moved from ${prev.period_label} to ${result.period.label}.`)
      else if (prev.data_through !== result.data_through) bits.push('New data has loaded, but this report uses a fixed period, so the period did not move.')
      else bits.push('No new month has loaded since the last run.')
      if (change != null && result.total !== prev.total) bits.push(`Total ${result.total_measure.toLowerCase()} is ${change >= 0 ? 'up' : 'down'} ${Math.abs(change)}% on the last run.`)
      since = { text: bits.join(' '), period_changed: periodChanged }
    }
    found.last_run = { at: now(), period_label: result.period.label, data_through: result.data_through, total: result.total, row_count: result.row_count }
    store.save(s)
    return { ...result, saved_report: { id: found.id, name: found.name }, since_last_run: since }
  }

  function deleteSaved(id: string) {
    const s = state()
    const saved = s.saved as SavedRec[]
    const i = saved.findIndex((r) => r.id === id)
    if (i < 0) throw new Error(`No saved report with id ${id}.`)
    const [rec] = saved.splice(i, 1)
    store.save(s)
    return { deleted: rec!.id, name: rec!.name }
  }

  // ---- the model's words, as a change

  function patchFromUnderstanding(spec: Spec, u: Understanding): Patch {
    const cur = normalize(spec)
    const p: Required<Patch> = { set: {}, add: {}, remove: {} }
    const tpl = u.template ? TEMPLATES.find((t) => t.id === u.template) : undefined
    if (tpl && cur.template !== tpl.id) {
      Object.assign(p.set, clone(tpl.spec))
      if (!('columns' in tpl.spec)) p.set.columns = null
      if (!('calcs' in tpl.spec)) p.set.calcs = []
      if (!('zero_share' in tpl.spec)) p.set.zero_share = null
      if (!('compare' in tpl.spec)) p.set.compare = null
    }
    const zero = tpl ? 'zero_share' in tpl.spec : Boolean(cur.zero_share)
    const comparing = tpl ? 'compare' in tpl.spec : Boolean(cur.compare)
    const named = new Set<Group>()
    for (const e of u.entities ?? []) {
      if (zero && e.type === 'property') {
        ;(p.add['zero_share.mine'] ??= []).push(e.id)
        continue
      }
      const d = DIMS[e.type as Dim]
      if (!d || d.time) continue
      // Comparing: brands named are the person's own; categories are who they compete with.
      if (comparing && (d.group === 'who' || d.group === 'what')) {
        ;(p.add[d.group === 'who' ? 'compare.mine' : 'compare.rivals'] ??= []).push(e.id)
        continue
      }
      ;(p.add[`filters.${e.type}`] ??= []).push(e.id)
      named.add(d.group)
    }
    if (!u.add) {
      for (const dim of Object.keys(cur.filters)) if (DIMS[dim as Dim] && named.has(DIMS[dim as Dim].group)) p.set[`filters.${dim}`] = null
      if (zero && p.add['zero_share.mine'] && cur.zero_share && !tpl) p.set['zero_share.mine'] = []
      if (named.size && cur.scope === 'all') p.set.scope = null
    }
    if (tpl && 'zero_share' in tpl.spec && p.add['zero_share.mine']) {
      p.set.zero_share = { ...(tpl.spec.zero_share as object), mine: p.add['zero_share.mine'], versus: [] }
      delete p.add['zero_share.mine']
    }
    if (comparing && (p.add['compare.mine'] || p.add['compare.rivals'])) {
      const base = tpl ? { mine: [], rivals: [] } : (cur.compare ?? { mine: [], rivals: [] })
      if (tpl || !u.add) {
        p.set.compare = { ...base, mine: p.add['compare.mine'] ?? base.mine, rivals: p.add['compare.rivals'] ?? base.rivals }
        delete p.add['compare.mine']
        delete p.add['compare.rivals']
      }
    }
    if (u.time) p.set.time = u.time
    if (u.rows?.length) {
      const base = tpl ? (tpl.spec.rows as string[]) : cur.rows
      if (base.length || tpl) p.add.rows = u.rows
      else p.set.rows = u.rows
    }
    if (u.columns != null) {
      p.set.columns = u.columns
      p.set.calcs = []
    }
    if (u.measures?.length) p.add.measures = [...(cur.measures.length ? [] : ['spend']), ...u.measures]
    if (u.top_n) p.set['options.top_n'] = u.top_n
    if (u.preliminary) p.set['options.final_only'] = false
    // A share keeps the columns (it shows in each cell); prior year needs them gone.
    if (u.yoy || u.share) p.add.calcs = [...(u.yoy ? ['yoy'] : []), ...(u.share ? ['share'] : [])]
    if (u.yoy) p.set.columns = null
    return p
  }

  async function catalog() {
    const a = await availability()
    return {
      data: {
        source: 'Live data (development server)',
        all_media_from: monthLabel(a.firstComplete),
        final_through: monthLabel(a.through),
        current_month_loading: monthLabel(a.prelim),
      },
      dimensions: (Object.keys(DIMS) as Dim[]).map((key) => ({ key, label: DIMS[key].label, group: DIMS[key].group, group_label: GROUP_LABEL[DIMS[key].group], can_filter: !DIMS[key].time, can_be_columns: ['month', 'quarter', 'year', 'day', 'week', 'broadcast_week', 'media_type', 'property', 'industry', 'category'].includes(key) })),
      measures: (Object.keys(MEASURES) as MeasureKey[]).map((key) => ({ key, label: MEASURES[key].label })),
      calcs: Object.entries(CALCS).map(([key, c]) => ({ key, label: c.label, note: c.note })),
      time: [
        { mode: 'rolling', example: RECENT, note: 'Last N complete months. Moves forward when new data loads, so it suits saved reports. All media start in ' + monthLabel(a.firstComplete) + '.' },
        { mode: 'rolling', example: WEEKS, note: 'Last N complete broadcast weeks (Monday to Sunday), or unit "day" for the last N days. Moves forward with new data.' },
        { mode: 'ytd', example: { mode: 'ytd' }, note: 'January through the latest complete month.' },
        { mode: 'static', example: { mode: 'static', start: monthId(a.firstComplete), end: monthId(a.through) }, note: 'A fixed range of months (YYYY-MM), or of days (YYYY-MM-DD). Does not move.' },
      ],
      templates: TEMPLATES.map((t) => ({ id: t.id, label: t.label, description: t.description, spec: clone(t.spec) as Spec })),
      rules: [
        'Filters inside one group (who, what, where) are combined with OR; the groups are combined with AND.',
        'Change vs prior year cannot be combined with a column breakdown. Share of total can: with columns it is % down (of each column), and share_across adds % across (of each row); both show inside each cell.',
        'Day breakdowns cover up to 3 months; week and broadcast week up to a year. "week" starts on Sunday; "broadcast_week" on Monday.',
        `The data covers all media from ${monthLabel(a.firstComplete)}; earlier months hold only some media, so default to the last 3 complete months.`,
        'Spend is the spend for the paying advertiser and product (promos and PSAs excluded).',
      ],
    }
  }

  async function availabilityPublic() {
    const a = await availability()
    return { final_through_label: monthLabel(a.through), preliminary_through_label: monthLabel(a.prelim), earliest_label: monthLabel(a.firstComplete) }
  }

  return {
    live: true as const,
    catalog,
    availability: availabilityPublic,
    search,
    validate,
    preview: (spec: Spec, limit?: number) => run(spec, { limit: limit ?? 10 }),
    run,
    summarize,
    ensureLabels,
    labelOf,
    contextOf: (id: string) => contexts.get(id) ?? '',
    saveReport,
    listSaved,
    getSaved,
    findSaved,
    runSaved,
    deleteSaved,
    patchFromUnderstanding,
  }
}
