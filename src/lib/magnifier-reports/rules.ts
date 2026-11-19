/**
 * Magnifier Offline Reports (Prototypes, 16 November 2026): the pure rules.
 *
 * Scott asked for the Magnifier offline Excel reports (Summary Report,
 * Occurrence Table, Weekly FastTrack) rebuilt as a dashboard on GPC data, for
 * one GPC taxonomy node at any level. data.ts reads ClickHouse; everything
 * that turns rows into rankings, shares and shifts lives here, with no
 * database import, so the tests can run while a dev server holds PGlite.
 */

export type Level = 'Industry Group' | 'Industry' | 'Category' | 'Subcategory'
export const LEVELS: Level[] = ['Industry Group', 'Industry', 'Category', 'Subcategory']

/** Where a node's id sits in the GPC summaries, and what its children are. */
export const LEVEL_SQL: Record<Level, { id: string; child: { id: string; name: string; label: string } }> = {
  'Industry Group': { id: 'industry_group_id', child: { id: 'industry_id', name: 'industry_name', label: 'Industry' } },
  Industry: { id: 'industry_id', child: { id: 'category_id', name: 'category_name', label: 'Category' } },
  Category: { id: 'category_id', child: { id: 'subcategory_id', name: 'subcategory_name', label: 'Subcategory' } },
  // A subcategory has no taxonomy below it; its split is by brand.
  Subcategory: { id: 'subcategory_id', child: { id: 'coalesce(product_brand_id, product_id)', name: "if(product_brand_name = '', product_name, product_brand_name)", label: 'Brand' } },
}

export const isLevel = (s: unknown): s is Level => typeof s === 'string' && (LEVELS as string[]).includes(s)

export interface TaxNode {
  id: number
  parentId: number | null
  level: Level
  name: string
}

/** The trail from the top of the taxonomy down to a node, the node last. */
export function trail(nodes: TaxNode[], id: number): TaxNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const out: TaxNode[] = []
  for (let n = byId.get(id); n && !out.includes(n); n = n.parentId == null ? undefined : byId.get(n.parentId)) out.unshift(n)
  return out
}

// ------------------------------------------------------------------ periods

/** 202610 -> "Oct 2026"; short -> "Oct". */
export function monthLabel(ym: number, short = false): string {
  const d = new Date(Date.UTC(Math.floor(ym / 100), (ym % 100) - 1, 1))
  return d.toLocaleString('en-US', short ? { month: 'short', timeZone: 'UTC' } : { month: 'short', year: 'numeric', timeZone: 'UTC' })
}
export function shiftYm(ym: number, n: number): number {
  const i = Math.floor(ym / 100) * 12 + (ym % 100) - 1 + n
  return Math.floor(i / 12) * 100 + (i % 12) + 1
}
/** "2026-10-26" -> "Oct 26". */
export function dayLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}
export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// ------------------------------------------------------------------ numbers

/** Spend the way the workbooks read it, without their "$000s": $1.2M, $89K, $640. */
export function money(v: number): string {
  const a = Math.abs(v)
  const s = v < 0 ? '-' : ''
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(a >= 1e10 ? 1 : 2)}B`
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(a >= 1e4 ? 0 : 1)}K`
  return `${s}$${Math.round(a)}`
}
export function pct(v: number | null, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return `${(v * 100).toFixed(digits)}%`
}
/** A change as +12.3% / -4.0%; null (no base) as "New". */
export function change(v: number | null): string {
  if (v == null) return 'New'
  if (!Number.isFinite(v)) return '—'
  return `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`
}
export const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`
}
export const int = (n: number) => Math.round(n).toLocaleString('en-US')

// ------------------------------------------------------------------ the cube

/** One row of the node's spend: month x advertiser x media x child node. */
export interface CubeRow {
  ym: number
  aid: number
  aname: string
  pid: number
  pname: string
  media: string
  cid: number
  cname: string
  spend: number
  occ: number
}

export type Who = 'advertiser' | 'parent'
export const keyOf = (r: CubeRow, who: Who) => (who === 'parent' ? r.pid : r.aid)
export const nameOf = (r: CubeRow, who: Who) => (who === 'parent' ? r.pname || r.aname : r.aname)

export interface Ranked {
  key: number
  name: string
  spend: number
  prior: number
  /** Share of the market's spend in the month. */
  sov: number
  priorSov: number
  rank: number
  priorRank: number | null
  /** Spend change on the prior month as a fraction; null when there was none. */
  delta: number | null
  /** Spend in each of the months asked for, in order. */
  trend: number[]
  occ: number
}

/**
 * Each advertiser (or parent) in a period, ranked by spend, with the prior
 * period beside it. Periods are months (202610) for the monthly reports and
 * week starts (20261026) for FastTrack; `ym` on a row is whichever it is.
 */
export function rank(rows: CubeRow[], ym: number, months: number[], who: Who, prior: number = shiftYm(ym, -1)): Ranked[] {
  const m = new Map<number, Ranked>()
  const idx = new Map(months.map((x, i) => [x, i]))
  let total = 0, priorTotal = 0
  for (const r of rows) {
    const k = keyOf(r, who)
    let e = m.get(k)
    if (!e) {
      e = { key: k, name: nameOf(r, who), spend: 0, prior: 0, sov: 0, priorSov: 0, rank: 0, priorRank: null, delta: null, trend: months.map(() => 0), occ: 0 }
      m.set(k, e)
    }
    const i = idx.get(r.ym)
    if (i != null) e.trend[i] += r.spend
    if (r.ym === ym) { e.spend += r.spend; e.occ += r.occ; total += r.spend }
    if (r.ym === prior) { e.prior += r.spend; priorTotal += r.spend }
  }
  const list = [...m.values()].filter((e) => e.spend > 0 || e.prior > 0)
  const priorOrder = [...list].filter((e) => e.prior > 0).sort((a, b) => b.prior - a.prior)
  priorOrder.forEach((e, i) => (e.priorRank = i + 1))
  list.sort((a, b) => b.spend - a.spend || b.prior - a.prior)
  list.forEach((e, i) => {
    e.rank = e.spend > 0 ? i + 1 : 0
    e.sov = total ? e.spend / total : 0
    e.priorSov = priorTotal ? e.prior / priorTotal : 0
    e.delta = e.prior > 0 ? e.spend / e.prior - 1 : null
  })
  return list
}

/** Spend by month across the months asked for. */
export function monthTotals(rows: CubeRow[], months: number[]): number[] {
  const idx = new Map(months.map((x, i) => [x, i]))
  const out = months.map(() => 0)
  for (const r of rows) {
    const i = idx.get(r.ym)
    if (i != null) out[i] += r.spend
  }
  return out
}

/** Spend summed by any key, biggest first. */
export function sumBy<K extends string | number>(rows: CubeRow[], key: (r: CubeRow) => K, name: (r: CubeRow) => string, keep: (r: CubeRow) => boolean = () => true) {
  const m = new Map<K, { key: K; name: string; spend: number; occ: number }>()
  for (const r of rows) {
    if (!keep(r)) continue
    const k = key(r)
    const e = m.get(k) ?? { key: k, name: name(r), spend: 0, occ: 0 }
    e.spend += r.spend
    e.occ += r.occ
    m.set(k, e)
  }
  return [...m.values()].sort((a, b) => b.spend - a.spend)
}

/** The first n, and everything after folded into one "Other" entry (key null). */
export function topWithOther<T extends { spend: number; name: string }>(list: T[], n: number): Array<{ key: T | null; name: string; spend: number }> {
  const head = list.slice(0, n).map((x) => ({ key: x as T | null, name: x.name, spend: x.spend }))
  const rest = list.slice(n).reduce((s, x) => s + x.spend, 0)
  return rest > 0 ? [...head, { key: null, name: 'Other', spend: rest }] : head
}

/** advertiser x media spend matrix for one month (or all months when ym is null). */
export function mediaMatrix(rows: CubeRow[], ym: number | null, who: Who) {
  const keep = (r: CubeRow) => ym == null || r.ym === ym
  const media = sumBy(rows, (r) => r.media, (r) => r.media, keep).filter((x) => x.spend > 0)
  const people = sumBy(rows, (r) => keyOf(r, who), (r) => nameOf(r, who), keep).filter((x) => x.spend > 0)
  const cell = new Map<string, number>()
  for (const r of rows) if (keep(r)) cell.set(`${keyOf(r, who)}|${r.media}`, (cell.get(`${keyOf(r, who)}|${r.media}`) ?? 0) + r.spend)
  const at = (k: number, media: string) => cell.get(`${k}|${media}`) ?? 0
  return { media, people, at }
}

/** The biggest movers between the prior month and this one, by absolute change. */
export function shifts(ranked: Ranked[], n: number) {
  return [...ranked].sort((a, b) => Math.abs(b.spend - b.prior) - Math.abs(a.spend - a.prior)).slice(0, n).filter((r) => r.spend !== r.prior)
}

/**
 * The fixed colour for each entity, by its place in the whole window, so an
 * advertiser keeps its colour from chart to chart and month to month
 * (dataviz: colour follows the entity, never its rank in one view). Eight
 * slots; everyone after them is grey.
 */
export function colourSlots(ranked: Array<{ key: number }>): Map<number, number> {
  return new Map(ranked.slice(0, 8).map((r, i) => [r.key, i + 1]))
}

/** "Complete" months: the ones with most media present (the GPC data has all media only from August 2026). */
export function completeMonths(cover: Array<{ ym: number; media: number }>, today: Date = new Date()): number[] {
  const most = Math.max(0, ...cover.map((c) => c.media))
  const thisYm = today.getUTCFullYear() * 100 + today.getUTCMonth() + 1
  return cover
    .filter((c) => c.ym < thisYm && c.media >= most - 2)
    .map((c) => c.ym)
    .sort((a, b) => a - b)
}

/**
 * A day range, inclusive, cut at month ends: 2026-08-03..2026-11-15 becomes
 * four ranges, one per month. Prod ClickHouse stops any query that reads more
 * than 46.57 GiB, and the daily creative summary for a whole industry group
 * since August is more than that (19 November 2026), so long ranges are read a
 * month at a time.
 */
export function monthSlices(from: string, to: string): Array<{ from: string; to: string }> {
  const out: Array<{ from: string; to: string }> = []
  let start = from
  while (start <= to) {
    const [y, m] = start.split('-').map(Number) as [number, number]
    const monthEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
    const end = monthEnd < to ? monthEnd : to
    out.push({ from: start, to: end })
    start = addDays(end, 1)
  }
  return out
}

/** Parse a whole number from a search parameter, or null. */
export function idParam(v: string | string[] | undefined): number | null {
  return typeof v === 'string' && /^\d{1,12}$/.test(v) ? Number(v) : null
}
