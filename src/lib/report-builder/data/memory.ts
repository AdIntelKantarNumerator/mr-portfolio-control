/**
 * A data adapter over rows held in memory (12 November 2026).
 *
 * Answers the same queries as the ClickHouse adapter, so the report engine,
 * and entitlements around it, can be run and checked without a database.
 * Each fact is one day of spend for one combination of the named dimensions.
 */
import { DIMENSIONS, dimOf, type AggregateQuery, type AggregateResult, type Availability, type Cond, type DataAdapter, type DimKey, type MeasureKey, type NameHit, type SearchRequest } from './types'

type Named = Exclude<DimKey, 'month' | 'quarter' | 'year' | 'day' | 'week' | 'broadcast_week'>

export interface Fact {
  /** YYYY-MM-DD */
  date: string
  ids: Partial<Record<Named, { id: string; name: string; context?: string }>>
  spend: number
  occurrences: number
  impressions?: number
  promo?: boolean
}

const DAY_MS = 86_400_000
const dayNum = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / DAY_MS
const isoDay = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10)

function timeValue(d: DimKey, date: string): string {
  if (d === 'month') return date.slice(0, 7)
  if (d === 'year') return date.slice(0, 4)
  if (d === 'quarter') return `${date.slice(0, 4)}-Q${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}`
  if (d === 'day') return date
  const n = dayNum(date)
  const wd = new Date(n * DAY_MS).getUTCDay()
  return d === 'week' ? isoDay(n - wd) : isoDay(n - ((wd + 6) % 7))
}

const valueOf = (f: Fact, d: DimKey): string | undefined => (DIMENSIONS[d].time ? timeValue(d, f.date) : f.ids[d as Named]?.id)

function test(c: Cond | undefined, f: Fact): boolean {
  if (!c) return true
  if ('and' in c) return c.and.every((x) => test(x, f))
  if ('or' in c) return c.or.some((x) => test(x, f))
  if ('not' in c) return !test(c.not, f)
  if ('named' in c) return Boolean(f.ids[c.named as Named]?.name)
  if ('in' in c) {
    const v = valueOf(f, c.in)
    return v !== undefined && c.values.includes(v)
  }
  if ('anyOf' in c) return c.anyOf.some((id) => valueOf(f, dimOf(id) as DimKey) === id)
  if ('tuples' in c) return c.values.some((vals) => c.tuples.every((d, i) => valueOf(f, d) === vals[i]))
  return false
}

const cmp = (a: number, op: string, b: number) => (op === '=' ? a === b : op === '!=' ? a !== b : op === '>' ? a > b : op === '<' ? a < b : op === '>=' ? a >= b : a <= b)
const measureOf = (f: Fact, m: MeasureKey) => (m === 'impressions' ? (f.impressions ?? 0) : f[m])

export function memoryAdapter(facts: Fact[], availability: Availability): DataAdapter {
  function inPeriod(f: Fact, q: AggregateQuery) {
    const daily = q.period.daily || q.groupBy.some((d) => DIMENSIONS[d].daily)
    return daily ? f.date >= q.period.from && f.date <= q.period.to : f.date.slice(0, 7) >= q.period.from.slice(0, 7) && f.date.slice(0, 7) <= q.period.to.slice(0, 7)
  }

  return {
    name: 'Memory',
    async availability() {
      return availability
    },

    async aggregate(q): Promise<AggregateResult> {
      const groups = new Map<string, { keys: AggregateResult['rows'][number]['keys']; values: Record<string, number> }>()
      for (const f of facts) {
        if (!inPeriod(f, q) || (!q.includePromos && f.promo) || !test(q.where, f)) continue
        const vals = q.groupBy.map((d) => valueOf(f, d) ?? `${d}:0`)
        const k = vals.join('\u0001')
        let g = groups.get(k)
        if (!g) {
          g = {
            keys: Object.fromEntries(
              q.groupBy.map((d, i) => {
                const named = DIMENSIONS[d].time ? undefined : f.ids[d as Named]
                return [d, { id: vals[i]!, name: named?.name ?? '', ...(q.context ? { context: named?.context ?? '' } : {}) }]
              }),
            ),
            values: Object.fromEntries(q.measures.map((m) => [m.as, 0])),
          }
          groups.set(k, g)
        }
        for (const m of q.measures) if (test(m.where, f)) g.values[m.as]! += measureOf(f, m.measure)
      }
      let rows = [...groups.values()].filter((g) => (q.having ?? []).every((h) => cmp(g.values[h.as] ?? 0, h.op, h.value)))
      const totals = Object.fromEntries(q.measures.map((m) => [m.as, rows.reduce((a, r) => a + (r.values[m.as] ?? 0), 0)]))
      const count = rows.length
      for (const o of [...(q.orderBy ?? [])].reverse()) {
        const get = (r: (typeof rows)[number]) => (DIMENSIONS[o.by as DimKey] ? (r.keys[o.by as DimKey]?.id ?? '') : (r.values[o.by] ?? 0))
        rows = [...rows].sort((a, b) => {
          const x = get(a)
          const y = get(b)
          const c = x < y ? -1 : x > y ? 1 : 0
          return o.desc ? -c : c
        })
      }
      if (q.limit != null) rows = rows.slice(0, q.limit)
      return { rows, ...(q.withCount ? { count } : {}), ...(q.withTotals ? { totals } : {}) }
    },

    async search(req: SearchRequest): Promise<NameHit[]> {
      const out: NameHit[] = []
      for (const p of req.parts) {
        const by = new Map<string, NameHit>()
        for (const f of facts) {
          const named = f.ids[p.dim as Named]
          if (!named?.name || f.date.slice(0, 7) !== req.month || !test(req.where, f)) continue
          if (p.text != null && !named.name.toLowerCase().includes(p.text.toLowerCase())) continue
          const hit = by.get(named.id) ?? { id: named.id, dim: p.dim, name: named.name, context: named.context ?? '', spend: 0 }
          hit.spend += f.spend
          by.set(named.id, hit)
        }
        out.push(...[...by.values()].sort((a, b) => b.spend - a.spend).slice(0, req.limit))
      }
      return out
    },

    async labels(ids) {
      const found = new Map<string, { id: string; name: string; context: string }>()
      for (const f of facts)
        for (const v of Object.values(f.ids)) if (v && ids.includes(v.id) && !found.has(v.id)) found.set(v.id, { id: v.id, name: v.name, context: v.context ?? '' })
      return [...found.values()]
    },
  }
}
