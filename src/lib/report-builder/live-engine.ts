/**
 * The report engine (11 November 2026; on a data adapter from 12 November).
 *
 * The same report model as engine.js (templates, the interview's questions and
 * fixes, adjustments, saved reports), with every number from a data adapter
 * (data/types.ts): ClickHouse in the portfolio, in-memory data in tests.
 * The engine never writes SQL. It describes each query (dimensions, measures
 * under their own conditions, conditions on totals, order, totals and a
 * count); the adapter answers it, and an entitlements wrapper around the
 * adapter limits what each person sees.
 *
 * Ids in a report are "<dimension>:<id>", so a saved report keeps working
 * when names change. Names come back with every query and are cached for the
 * process (they do not depend on who asks).
 */
import type { EngineState, Option, Patch, Result, SavedSummary, Spec, Understanding, Validation } from './engine'
import { EntitlementError } from './data/entitlements'
import { DIMENSIONS, MEASURE_INFO, all, any, normName, type AggregateQuery, type Cond, type DataAdapter, type DimGroup, type DimKey, type MeasureKey, type MeasureSpec } from './data/types'

const INLINE_ROW_LIMIT = 2000
const DOWNLOAD_ROW_LIMIT = 50_000

type Dim = DimKey
type Group = DimGroup
const DIMS = DIMENSIONS
const NAME_DIMS = (Object.keys(DIMS) as Dim[]).filter((d) => !DIMS[d].time)
/** A search that names no kinds leaves out what lives in other tables (daypart, league, spot length): ask for those by name. */
const DEFAULT_SEARCH = NAME_DIMS.filter((d) => !DIMS[d].daily && !DIMS[d].creative)
const GROUP_LABEL: Record<Group, string> = { who: 'Who is advertising', what: 'What is advertised', where: 'Where it runs', detail: 'Program, daypart, length and other details', when: 'When' }
/** Filters in who, what or where are OR-ed within the group; each detail narrows on its own. */
const filterGroup = (d: Dim): string => (DIMS[d].group === 'detail' ? d : DIMS[d].group)
const MEASURES = MEASURE_INFO
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

/** Everyday words for the taxonomy's own names: "fast food" is QSRs-Quick Serve Restaurants. */
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
const DAILY_LIMIT: Partial<Record<Dim, number>> = { day: 92, week: 371, broadcast_week: 371, broadcast_month: 1100, daypart: 371, league: 371 }

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

const dimOf = (id: string) => String(id).split(':')[0]!

/** Every dimension a report reads: breakouts, filters, a drill-down, and the ids in its competitive set. */
function dimsOf(s: NSpec): Dim[] {
  const ids = [...(s.zero_share ? [...s.zero_share.mine, ...s.zero_share.versus] : []), ...(s.compare ? [...s.compare.mine, ...s.compare.rivals] : [])]
  return uniq([...s.rows, ...(s.columns ? [s.columns] : []), ...Object.keys(s.filters), ...Object.keys(s.path ?? {}), ...ids.map(dimOf)].filter((d) => DIMS[d as Dim]) as Dim[])
}

/**
 * Whether a report needs data by day: a day or week breakdown, a period in
 * weeks or days, or anything only the daily tables record - daypart and
 * league, as a breakout or a filter (Scott, 12 November 2026). The adapter
 * reads the daily tables for those on its own; this also tells the engine to
 * keep such a report within the daily limits.
 */
function needsDaily(s: NSpec): boolean {
  const t = s.time ?? {}
  return dimsOf(s).some((d) => DIMS[d]?.daily) || t.unit === 'week' || t.unit === 'day' || dParse(t.start) !== null
}

/** The report's filters as conditions: OR within a group (who, what, where), the groups AND-ed by the caller; each detail AND-ed on its own. */
function filterConds(s: NSpec): Record<'who' | 'what' | 'where' | 'detail', Cond | undefined> {
  const groups: Record<'who' | 'what' | 'where', Cond[]> = { who: [], what: [], where: [] }
  const details: Cond[] = []
  for (const [dim, ids] of Object.entries(s.filters)) {
    const d = DIMS[dim as Dim]
    if (!d || d.time || !ids.length) continue
    // Markets and countries narrow wherever the media is: "these 3 markets" AND "these media types", never OR (Scott, 12 November 2026).
    if (d.group === 'detail' || dim === 'market' || dim === 'country') details.push({ in: dim as Dim, values: ids })
    else groups[d.group as 'who' | 'what' | 'where'].push({ in: dim as Dim, values: ids })
  }
  return { who: any(...groups.who), what: any(...groups.what), where: any(...groups.where), detail: all(...details) }
}

/** A drill-down path (the tree view) as a condition. */
const pathCond = (s: NSpec): Cond | undefined => all(...Object.entries(s.path ?? {}).filter(([d]) => DIMS[d as Dim]).map(([d, id]): Cond => ({ in: d as Dim, values: [String(id)] })))

// ---------------------------------------------------------------- shared state

interface Availability {
  firstComplete: number
  through: number
  prelim: number
  /** The last day loaded. */
  prelimDay: number
}
const labels = new Map<string, string>()
const contexts = new Map<string, string>()

// ---------------------------------------------------------------- the engine

export interface LiveEngineConfig {
  store: { load(): EngineState; save(s: EngineState): void }
  /** Where the numbers come from, already limited to what this person may see. */
  adapter: DataAdapter
  now?: () => string
}

export function createLiveEngine(cfg: LiveEngineConfig) {
  const store = cfg.store
  const data = cfg.adapter
  const now = cfg.now ?? (() => new Date().toISOString())
  const state = () => {
    const s = (store.load() ?? {}) as EngineState & { saved: SavedRec[] }
    s.saved = (s.saved ?? []) as SavedRec[]
    s.seq = s.seq ?? 0
    return s
  }
  // Results of the last few queries, so a preview right after a validation does not run twice.
  const memo = new Map<string, Promise<Result>>()

  async function availability(): Promise<Availability> {
    const a = await data.availability()
    return { firstComplete: parseMonth(a.firstComplete)!, through: parseMonth(a.through)!, prelim: parseMonth(a.prelim)!, prelimDay: dParse(a.prelimDay)! }
  }
  /** One month, as a query period. */
  const monthPeriod = (idx: number) => ({ from: dStr(monthFirstDay(idx)), to: dStr(monthLastDay(idx)) })

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
    if (dim === 'broadcast_month') {
      const t = parseMonth(id)
      return t == null ? id : `Bcst ${monthLabel(t)}`
    }
    if (dim === 'day' || dim === 'week' || dim === 'broadcast_week') {
      const n = dParse(id)
      return n === null ? id : dim === 'day' ? dShort(n) : `${dim === 'week' ? 'Wk' : 'Bcst wk'} ${dShort(n)}`
    }
    return labels.get(id) ?? id
  }

  async function ensureLabels(specIn: Spec): Promise<void> {
    const s = normalize(specIn)
    const ids: string[] = []
    for (const [dim, vals] of Object.entries(s.filters)) if (DIMS[dim as Dim] && !DIMS[dim as Dim].time) ids.push(...vals)
    if (s.zero_share) ids.push(...s.zero_share.mine, ...s.zero_share.versus)
    if (s.compare) ids.push(...s.compare.mine, ...s.compare.rivals)
    const want = uniq(ids.filter((id) => DIMS[dimOf(id) as Dim] && !labels.has(id)))
    if (!want.length) return
    for (const r of await data.labels(want)) {
      labels.set(r.id, r.name)
      contexts.set(r.id, r.context)
    }
  }

  async function search(query: string, opts: { types?: string[]; limit?: number } = {}) {
    const a = await availability()
    const types = (opts.types?.length ? opts.types.filter((t) => NAME_DIMS.includes(t as Dim)) : DEFAULT_SEARCH) as Dim[]
    const limit = Math.max(1, Math.min(opts.limit ?? 8, 25))
    const q = String(query ?? '').trim()
    const aliasTargets = ALIASES.filter(([alias, dim]) => types.includes(dim) && q && (norm(q) === alias || norm(q).includes(alias)))
    const parts = [...types.map((dim) => ({ dim, text: q ? q : null })), ...aliasTargets.map(([, dim, label]) => ({ dim, text: label }))]
    const rows = await data.search({ parts, month: monthId(a.through), limit })
    const lq = q.toLowerCase()
    const aliasNames = new Set(aliasTargets.map(([, , l]) => l.toLowerCase()))
    const scored = rows.map((r) => {
      const n = r.name.toLowerCase()
      const score = aliasNames.has(n) ? 95 : !q ? 1 : n === lq ? 100 : n.startsWith(lq) ? 80 : 40
      labels.set(r.id, r.name)
      contexts.set(r.id, r.context)
      return { id: r.id, type: r.dim, type_label: DIMS[r.dim].label, label: r.name, context: r.context, spend_last_month: r.spend, score }
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
  const periodOf = (s: NSpec, a: Availability) => broadcastMonths(s, resolveTime(s.time, throughOf(s, a), a.firstComplete, throughDayOf(s, a)), throughDayOf(s, a))

  /**
   * By broadcast month, a period in months covers whole broadcast months: from
   * the Monday of the week holding the first month's 1st to the last Sunday of
   * the last month (or the last Sunday the data reaches).
   */
  function broadcastMonths(s: NSpec, p: Period | { error: string }, throughDay: number): Period | { error: string } {
    if ('error' in p || !dimsOf(s).includes('broadcast_month' as Dim) || dParse(s.time?.start) !== null || s.time?.unit === 'week' || s.time?.unit === 'day') return p
    const d0 = p.d0 - ((weekday(p.d0) + 6) % 7)
    let d1 = Math.min(p.d1, throughDay)
    while (weekday(d1) !== 0) d1--
    if (d1 <= d0) return p
    return { ...p, d0, d1, notes: [...p.notes, `Broadcast months: ${dLabel(d0)} to ${dLabel(d1)}, Monday to Sunday weeks.`] }
  }

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
    const detail = filterLabels(s.filters, ['detail'])
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
    if (detail.length) scope.push(listText(detail))
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
    const period: AggregateQuery['period'] = { from: dStr(per.d0), to: dStr(per.d1), daily }
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
    const f = filterConds(s)
    const mineIds = new Set(s.compare?.mine ?? [])

    // Rows in scope, and which of their spend counts.
    const subject = all(f.who, f.what, f.detail, pathCond(s), s.compare ? { anyOf: [...s.compare.mine, ...s.compare.rivals] } : undefined)
    let scope: Cond | undefined
    let counted: Cond | undefined
    let mine: Cond | undefined
    if (zs) {
      // Publisher Intel: zero (competitors, not you), wallet (you and competitors), mine (only you), theirs (only competitors).
      mine = { anyOf: zs.mine }
      scope = subject
      const theirs = all({ not: mine }, zs.versus.length ? { anyOf: zs.versus } : undefined, f.where)
      counted = zs.mode === 'mine' ? all(mine, f.where) : wallet ? any(mine, theirs) : theirs
    } else {
      scope = all(subject, f.where)
    }
    const measure = (as: string, k: MeasureKey, where?: Cond): MeasureSpec => ({ as, measure: k, ...(where ? { where } : {}) })

    // Column breakdown: its values first (every month in the period; the 12 largest otherwise).
    let colVals: Array<{ id: string; name: string }> = []
    let moreCols = 0
    if (C && Array.isArray(s.col_ids)) {
      colVals = s.col_ids.map((id) => ({ id, name: DIMS[C].time ? labelOf(C, id) : (labels.get(id) ?? id) }))
    } else if (C) {
      const time = Boolean(DIMS[C].time)
      const vals = await data.aggregate({
        period,
        where: scope,
        groupBy: [C],
        measures: [measure('v', primary, counted)],
        having: [{ as: 'v', op: '!=', value: 0 }],
        orderBy: [time ? { by: C } : { by: 'v', desc: true }],
        limit: time ? 100 : 12,
        withCount: true,
      })
      colVals = vals.rows.map((r) => {
        const k = r.keys[C]!
        if (!time && k.name) labels.set(k.id, k.name)
        return { id: k.id, name: time ? labelOf(C, k.id) : k.name || 'Not specified' }
      })
      moreCols = Math.max(0, (vals.count ?? 0) - vals.rows.length)
    }

    const ms: MeasureSpec[] = M.map((k) => measure(k, k, counted))
    const withMine = zs && (zs.mode === 'zero' || wallet)
    if (withMine) ms.push(measure('mine', 'spend', mine))
    if (withMine && !M.includes('spend')) ms.push(measure('spend', 'spend', counted))
    colVals.forEach((c, j) => {
      const inCol: Cond = { in: C!, values: [c.id] }
      for (const k of M) ms.push(measure(`c${j}_${k}`, k, all(counted, inCol)))
      // Share of wallet by column: spend with you and in all, per value.
      if (wallet) {
        if (!M.includes('spend')) ms.push(measure(`c${j}_spend`, 'spend', all(counted, inCol)))
        ms.push(measure(`c${j}_mine`, 'spend', all(mine, inCol)))
      }
    })
    const firstTime = R.length && DIMS[R[0]!].time
    const cap = Math.min(opts.limit ?? DOWNLOAD_ROW_LIMIT, s.options.top_n ?? Infinity, DOWNLOAD_ROW_LIMIT)
    const res = await data.aggregate({
      period,
      where: scope,
      groupBy: R,
      measures: ms,
      having: zs?.mode === 'zero' ? [{ as: 'mine', op: '=', value: 0 }, { as: 'spend', op: '>', value: 0 }] : [{ as: primary, op: '!=', value: 0 }],
      orderBy: [firstTime ? { by: R[0]! } : { by: primary, desc: true }],
      limit: cap,
      withCount: true,
      withTotals: true,
    })
    const rows = res.rows
    for (const n of res.notes ?? []) if (!notes.includes(n)) notes.push(n)
    const totals = res.totals ?? {}
    const matched = res.count ?? 0
    for (const r of rows) for (const d of R) if (!DIMS[d].time) labels.set(r.keys[d]!.id, r.keys[d]!.name)
    const keyOf = (r: (typeof rows)[number]) => R.map((d) => r.keys[d]!.id)

    // Prior year, for the rows shown.
    const prior = new Map<string, number>()
    let priorTotal = 0
    if (calcs.includes('yoy')) {
      const ps = per.start - 12
      const pe = per.end - 12
      if (pe < a.firstComplete) notes.push(`A year earlier, the data covers only some media (all media start in ${monthLabel(a.firstComplete)}), so the change is not like for like.`)
      const pp = { from: dStr(monthFirstDay(ps)), to: dStr(monthLastDay(pe)) }
      const pscope = all(f.who, f.what, f.detail, f.where)
      const [pr, pt] = await Promise.all([
        data.aggregate({ period: pp, where: all(pscope, R.length ? { tuples: R, values: rows.map(keyOf) } : undefined), groupBy: R, measures: [measure('v', primary)] }),
        data.aggregate({ period: pp, where: pscope, groupBy: [], measures: [measure('v', primary)] }),
      ])
      for (const r of pr.rows) prior.set(keyOf(r).join('\u0001'), r.values.v ?? 0)
      priorTotal = pt.rows[0]?.values.v ?? 0
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
    const totalPrimary = totals[primary] ?? 0
    const pct = (x: number, y: number) => (y ? Math.round((x / y) * 1000) / 10 : null)
    // Cents for money, whole numbers for counts: the spreadsheet should not carry float noise.
    const tidy = (k: MeasureKey, v: number) => (MEASURES[k].type === 'money' ? Math.round(v * 100) / 100 : Math.round(v))
    const cells = (row: (typeof rows)[number] | null): unknown[] => {
      const v = row ? row.values : totals
      const out: unknown[] = row
        ? R.map((dim) => {
            const k = row.keys[dim]!
            return DIMS[dim].time ? labelOf(dim, k.id) : (k.name || 'Not specified') + (mineIds.has(k.id) ? ' (you)' : '')
          })
        : R.map((_, i) => (i === 0 ? 'Total' : ''))
      if (wallet) {
        const split = (whole: number, yours: number) => out.push(tidy('spend', yours), tidy('spend', whole - yours), pct(yours, whole))
        if (C) colVals.forEach((_, j) => split(v[`c${j}_spend`] ?? 0, v[`c${j}_mine`] ?? 0))
        split(v.spend ?? 0, v.mine ?? 0)
      } else if (C) {
        const rowTotal = v[primary] ?? 0
        colVals.forEach((_, j) =>
          M.forEach((k, i) => {
            const x = v[`c${j}_${k}`] ?? 0
            out.push(tidy(k, x))
            if (i === 0 && down) out.push(pct(x, totals[`c${j}_${primary}`] ?? 0))
            if (i === 0 && across) out.push(pct(x, rowTotal))
          }),
        )
        M.forEach((k, i) => {
          out.push(tidy(k, v[k] ?? 0))
          if (i === 0 && down) out.push(pct(rowTotal, totalPrimary))
        })
      } else {
        M.forEach((k, i) => {
          const x = v[k] ?? 0
          out.push(tidy(k, x))
          if (i === 0 && calcs.includes('share')) out.push(pct(x, totalPrimary))
          if (i === 0 && calcs.includes('yoy')) {
            const pv = row ? (prior.get(keyOf(row).join('\u0001')) ?? 0) : priorTotal
            out.push(pv ? tidy(k, pv) : null)
            out.push(pv ? Math.round(((x - pv) / pv) * 1000) / 10 : null)
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
    return {
      columns,
      rows: rows.map((r) => cells(r)),
      // Each row's ids, as filters and paths use them, for drilling into it.
      keys: rows.map(keyOf),
      totals: R.length ? cells(null) : null,
      row_count: rowCount,
      rows_shown: rows.length,
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
  async function competitorOptions(mineIds: string[]): Promise<Option[]> {
    const a = await availability()
    const period = monthPeriod(a.through)
    const mine: Cond = { anyOf: mineIds }
    const top = (where: Cond, d: Dim, n: number, context = false) =>
      data.aggregate({ period, includePromos: true, where, groupBy: [d], context, measures: [{ as: 'v', measure: 'spend' }], orderBy: [{ by: 'v', desc: true }], limit: n })
    const out: Option[] = []
    const media = (await top(mine, 'media_type', 1)).rows[0]?.keys.media_type
    if (media) {
      const props = await top(all({ in: 'media_type', values: [media.id] }, { not: mine }, { named: 'property' })!, 'property', 4, true)
      for (const r of props.rows) {
        const p = r.keys.property!
        labels.set(p.id, p.name)
        contexts.set(p.id, p.context ?? '')
        out.push({ label: p.name, description: `Property · ${p.context ?? ''}`, patch: { add: { 'zero_share.versus': [p.id] } } })
      }
      const mid = media.id
      labels.set(mid, media.name)
      out.push({ label: `All other ${media.name}`, description: `Every ${media.name} property but yours`, patch: { set: { 'zero_share.versus': [mid] } } })
    }
    out.push({ label: 'All other properties', description: 'Any media, any property but yours', patch: { set: { 'zero_share.all': true } } })
    return out
  }

  /** Choices for a brand's competitors: the biggest advertisers in its subcategory, the subcategory, or the category. */
  async function rivalOptions(mineIds: string[]): Promise<Option[]> {
    const a = await availability()
    const period = monthPeriod(a.through)
    const mine: Cond = { anyOf: mineIds }
    const out: Option[] = []
    const [first] = (await data.aggregate({ period, where: mine, groupBy: ['subcategory', 'category'], measures: [{ as: 'v', measure: 'spend' }], orderBy: [{ by: 'v', desc: true }], limit: 1 })).rows
    if (first) {
      const sub = first.keys.subcategory!
      const cat = first.keys.category!
      const top = await data.aggregate({ period, where: all({ in: 'subcategory', values: [sub.id] }, { not: mine }), groupBy: ['advertiser'], context: true, measures: [{ as: 'v', measure: 'spend' }], orderBy: [{ by: 'v', desc: true }], limit: 4 })
      for (const r of top.rows) {
        const adv = r.keys.advertiser!
        labels.set(adv.id, adv.name)
        out.push({ label: adv.name, description: `Advertiser${adv.context ? ` · ${adv.context}` : ''}`, patch: { add: { 'compare.rivals': [adv.id] } } })
      }
      labels.set(sub.id, sub.name)
      labels.set(cat.id, cat.name)
      out.push({ label: `All of ${sub.name}`, description: 'Every advertiser in your subcategory', patch: { set: { 'compare.rivals': [sub.id] } } })
      if (cat.name && cat.name !== sub.name) out.push({ label: `All of ${cat.name}`, description: 'Every advertiser in your category', patch: { set: { 'compare.rivals': [cat.id] } } })
    }
    return out
  }

  /** A query outside the person's subscription, as a problem with ways round it. */
  function notEntitled(err: EntitlementError, spec: NSpec): Validation['errors'][number] {
    const fixes: Option[] = []
    if (err.kind === 'measure') {
      const left = spec.measures.filter((m) => !err.detail.measures?.includes(m))
      if (left.length) fixes.push({ label: `Drop ${(err.detail.measures ?? []).map((m) => MEASURES[m].label.toLowerCase()).join(' and ')}`, patch: { set: { measures: left } } })
    } else if (err.kind === 'daily') {
      const monthly = (d: Dim) => (DIMS[d]?.daily ? 'month' : d)
      fixes.push({ label: 'By month instead', patch: { set: { time: RECENT, rows: uniq(spec.rows.map(monthly)), columns: spec.columns ? monthly(spec.columns) : null } } })
    } else fixes.push({ label: 'Use the last 3 complete months', patch: { set: { time: RECENT } } })
    return { code: 'not_entitled', message: err.message, fixes }
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
    // Some dimensions live in different tables and cannot be read together (spot length with program, say).
    const clash = data.supports?.(dimsOf(spec))
    if (clash) {
      const drop = (ds: Dim[]): Patch => {
        const set: Record<string, unknown> = { rows: spec.rows.filter((r) => !ds.includes(r)) }
        if (spec.columns && ds.includes(spec.columns)) set.columns = null
        for (const d of ds) if (spec.filters[d]) set[`filters.${d}`] = null
        return { set }
      }
      const creative = dimsOf(spec).filter((d) => DIMS[d].creative)
      errors.push({
        code: 'cannot_combine',
        message: `${clash.reason} Choose one.`,
        fixes: [
          { label: `Drop ${creative.map((d) => DIMS[d].label.toLowerCase()).join(' and ')}`, patch: drop(creative) },
          { label: `Drop ${clash.conflicts.map((d) => DIMS[d].label.toLowerCase()).join(' and ')}`, patch: drop(clash.conflicts) },
        ],
      })
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

    let ok = !errors.length && !questions.length
    let rowCount: number | null = null
    const refinements: Option[] = []
    let res: Result | null = null
    if (ok) {
      try {
        res = await run(spec, { limit: 10 })
      } catch (err) {
        if (!(err instanceof EntitlementError)) throw err
        errors.push(notEntitled(err, spec))
        ok = false
      }
    }
    if (ok && res) {
      rowCount = res.row_count
      if (rowCount > INLINE_ROW_LIMIT) warnings.push(`This is a large extract (${rowCount.toLocaleString('en-US')} rows). It will be delivered as a file.`)
      if (spec.time?.mode === 'static') warnings.push('This period is fixed. If the report is saved, re-running it will not pick up newer months.')
      const tm = spec.time ?? {}
      const isRolling = (u: string, c: number) => tm.mode === 'rolling' && (tm.unit ?? 'month') === u && Number(tm.count) === c
      const add = (label: string, p: Patch) => refinements.push({ label, patch: p })
      if (!spec.columns && !spec.rows.some((d) => DIMS[d]?.time)) add('Add a column per month', { set: { columns: 'month' }, remove: { calcs: ['yoy'] } })
      if (spec.columns) add('Remove the column breakdown', { set: { columns: null } })
      // Two of the newer breakouts, chosen by the kind of report, ahead of the everyday ones.
      const used = new Set(dimsOf(spec))
      const fits = (d: Dim) => !used.has(d) && !data.supports?.([...used, d])
      const likely: Dim[] = spec.zero_share ? ['daypart', 'program', 'market'] : spec.compare ? ['length', 'market', 'daypart'] : ['market', 'daypart', 'length']
      for (const d of likely.filter(fits).slice(0, 2)) add(`Break out by ${DIMS[d].label.toLowerCase()}`, { add: { rows: [d] } })
      if (!spec.rows.includes('product')) add('Break out by product', { add: { rows: ['product'] } })
      if (!spec.rows.includes('media_type') && spec.columns !== 'media_type') add('Break out by media type', { add: { rows: ['media_type'] } })
      if (!spec.rows.includes('property') && spec.columns !== 'property') add('Break out by property', { add: { rows: ['property'] } })
      if (!isRolling('month', 3)) add('Last 3 months', { set: { time: RECENT } })
      if (!isRolling('month', 1)) add('Latest month', { set: { time: { mode: 'rolling', unit: 'month', count: 1 } } })
      if (!isRolling('week', 4)) add('Last 4 weeks', { set: { time: WEEKS } })
      if (spec.columns === 'month') add('By broadcast week', { set: { columns: 'broadcast_week', time: QUARTER_OF_WEEKS } })
      if (spec.columns === 'month') add('By broadcast month', { set: { columns: 'broadcast_month' } })
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
    const imported = (rec.spec as { import_360?: SavedSummary['imported'] }).import_360
    return { id: rec.id, name: rec.name, summary: summarizeSync(s, a), moves_with_new_data: !('error' in per) && per.moves, last_run: rec.last_run, ...(imported ? { imported } : {}) }
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
    const named = new Set<string>()
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
      named.add(filterGroup(e.type as Dim))
    }
    if (!u.add) {
      for (const dim of Object.keys(cur.filters)) if (DIMS[dim as Dim] && named.has(filterGroup(dim as Dim))) p.set[`filters.${dim}`] = null
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

  /**
   * GPC entities of one kind whose names match these (as normName compares
   * them), with their spend in August to October 2026: the 360 import matches
   * a report's selections this way, thousands at a time.
   */
  async function matchNames(dim: Dim, names: string[]) {
    const out = new Map<string, Array<{ id: string; name: string; context: string; spend: number }>>()
    const want = uniq(names.filter((n) => normName(n)))
    for (let i = 0; i < want.length; i += 1000) {
      const r = await data.aggregate({ period: { from: '2026-08-01', to: '2026-10-31' }, where: { nameIn: dim, names: want.slice(i, i + 1000) }, groupBy: [dim], context: true, measures: [{ as: 'v', measure: 'spend' }] })
      for (const row of r.rows) {
        const k = row.keys[dim]!
        if (!k.name) continue
        labels.set(k.id, k.name)
        const key = normName(k.name)
        out.set(key, [...(out.get(key) ?? []), { id: k.id, name: k.name, context: k.context ?? '', spend: row.values.v ?? 0 }])
      }
    }
    return out
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
      dimensions: (Object.keys(DIMS) as Dim[]).map((key) => ({ key, label: DIMS[key].label, group: DIMS[key].group, group_label: GROUP_LABEL[DIMS[key].group], can_filter: !DIMS[key].time, can_be_columns: ['month', 'broadcast_month', 'quarter', 'year', 'day', 'week', 'broadcast_week', 'media_type', 'media_owner', 'property', 'master_property', 'market', 'country', 'industry', 'category', 'program_genre', 'league', 'daypart', 'language', 'direct_indirect', 'length'].includes(key) })),
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
        'Day breakdowns cover up to 3 months; week and broadcast week up to a year. "week" starts on Sunday; "broadcast_week" on Monday. "broadcast_month" is the Monday-to-Sunday weeks ending in that month; a period in months then covers whole broadcast months.',
        'Daypart and league are recorded for TV and live streaming, and only day by day: a report with either reads the daily data, for up to a year. Program and program genre cover TV and live sports; direct/indirect covers digital.',
        'Spot length comes from the creative data and cannot be combined with market, master property, program, program genre, direct/indirect, daypart or league.',
        'Details (program, program genre, league, daypart, language, direct/indirect, spot length) each narrow the report on their own.',
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
    matchNames: (dim: string, names: string[]) => matchNames(dim as Dim, names),
  }
}
