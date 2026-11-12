/**
 * A 360 Explore report, as `npm run load:360` stores it, read into plain terms
 * (12 November 2026). No database: the names come in through a Lookup.
 *
 * 360 keeps a report in pieces (scripts/load-360.ts says where): its type
 * (rpttype: Trend, Summary, Media Mix, schedules...), its layout (columns of
 * type row, col, page and data, each an entity type - entmaj - such as brand
 * 139 or media 301 or a measure such as $ 800), its options, and its
 * selections, one list per part (mpt: product, media, market, time...) and
 * entity type, with ids picked and ids excluded. Time is picked as day ranges,
 * counted from 1 January 1900 as SQL Server does: [46021, 46051] is January
 * 2026.
 */

export interface RawCol {
  type: number
  entmaj: number
  entmin: number
  order: number
  sort: number
  total: number
  calc: number
  demo: number
  name: string
}
export interface RawOpt {
  opt: number
  entmaj: number
  entmin: number
  str: string | null
  d1: string | null
  d2: string | null
  long: number | null
  dbl: number | null
}
export interface RawSel {
  mpt: number
  e: number
  ids: number[]
  ex?: number[]
  ranges?: number[][]
  masks?: Record<string, number[]>
}
export interface Raw360Spec {
  rpttype: number | null
  title: string | null
  cols: RawCol[]
  opts: RawOpt[]
  sel: RawSel[]
}

/** Names from the snapshot: of an id, of an entity type, report type, measure or calculation. */
export interface Lookup {
  name(e: number, id: number): string | undefined
  type(e: number): string | undefined
  report(id: number): string | undefined
  measure(e: number): string | undefined
  calc(id: number): string | undefined
}

export interface Picked {
  id: number
  name: string
}

export interface Described {
  type: { id: number | null; name: string }
  rows: Array<{ e: number; label: string }>
  columns: Array<{ e: number; label: string }>
  pages: Array<{ e: number; label: string }>
  data: Array<{ e: number; label: string; calc: number; demo: boolean }>
  /** A row ordered by name (or as the user typed it) rather than by the numbers. */
  sortedByName: boolean
  selections: Array<{ mpt: number; e: number; label: string; picked: Picked[]; excluded: Picked[] }>
  /** The time picked: its kind (the entity type of the buckets) and the span, or relative periods by name. */
  time: { e: number | null; label: string | null; from: string | null; to: string | null; periods: number }
  includePromos: boolean
}

/** Layout column types (meta coltype). */
export const COLTYPE = { row: 1, col: 2, data: 3, page: 4, coldata: 5 } as const
/** The time part of a report (meta mpt). */
export const MPT_TIME = 6

const DAY_MS = 86_400_000
const BASE = Date.UTC(1900, 0, 1)
/** A 360 day number as YYYY-MM-DD. */
export const dayIso = (n: number) => new Date(BASE + n * DAY_MS).toISOString().slice(0, 10)
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const monthName = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`

/** 360's own names for some entity types are internal ("mediatvrollup"); these read better. */
const LABEL: Record<number, string> = { 300: 'Submedia', 301: 'Media', 413: 'Media (TV rollup)', 328: 'Media group', 331: 'TV breakout', 333: 'House ads', 303: 'National/local', 308: 'Daypart', 316: 'Daypart', 314: 'Length', 500: 'Market', 111: 'State', 305: 'Affiliate', 141: 'Product type', 735: 'Calendar month', 728: 'Broadcast week', 703: 'Relative period' }

export function describe(raw: Raw360Spec, look: Lookup): Described {
  const typeLabel = (e: number) => LABEL[e] ?? look.type(e) ?? look.measure(e) ?? `entity type ${e}`
  const layout = (t: number) =>
    raw.cols
      .filter((c) => c.type === t)
      .sort((a, b) => a.order - b.order)
      .map((c) => ({ e: c.entmaj, label: c.name || typeLabel(c.entmaj) }))
  const data = raw.cols
    .filter((c) => c.type === COLTYPE.data || c.type === COLTYPE.coldata)
    .sort((a, b) => a.order - b.order)
    .map((c) => ({ e: c.entmaj, label: (look.measure(c.entmaj) ?? c.name) || typeLabel(c.entmaj), calc: c.calc, demo: c.demo > 0 }))

  const named = (e: number) => (id: number) => ({ id, name: look.name(e, id) ?? `#${id}` })
  const selections = raw.sel
    .filter((s) => s.mpt !== MPT_TIME)
    .map((s) => ({ mpt: s.mpt, e: s.e, label: typeLabel(s.e), picked: s.ids.map(named(s.e)), excluded: (s.ex ?? []).map(named(s.e)) }))

  // Time: day ranges give a span; picked ids are relative periods ("current calendar month").
  const t = raw.sel.filter((s) => s.mpt === MPT_TIME)
  const ranges = t.flatMap((s) => s.ranges ?? [])
  const from = ranges.length ? dayIso(Math.min(...ranges.map((r) => r[0]!))) : null
  const to = ranges.length ? dayIso(Math.max(...ranges.map((r) => r[1]!))) : null
  const relative = t.flatMap((s) => s.ids.map((id) => look.name(s.e, id) ?? `${typeLabel(s.e)} ${id}`))
  const timeLabel = from && to ? (from.slice(0, 7) === to.slice(0, 7) ? monthName(from) : `${monthName(from)} – ${monthName(to)}`) : relative.length ? relative.join(', ') : null

  return {
    type: { id: raw.rpttype, name: (raw.rpttype != null && look.report(raw.rpttype)) || 'Report' },
    rows: layout(COLTYPE.row),
    columns: layout(COLTYPE.col),
    pages: layout(COLTYPE.page),
    data,
    sortedByName: raw.cols.some((c) => (c.type === COLTYPE.row || c.type === COLTYPE.page) && (c.sort === 1 || c.sort === 2 || c.sort === 3)),
    selections,
    time: { e: t[0]?.e ?? null, label: timeLabel, from, to, periods: ranges.length + relative.length },
    includePromos: raw.opts.some((o) => o.opt === 16 && Number(o.long) === 1),
  }
}
