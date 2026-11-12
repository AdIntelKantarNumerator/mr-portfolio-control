/**
 * What a person may see, enforced around any data adapter (12 November 2026).
 *
 * withEntitlements(adapter, e) returns an adapter that answers the same
 * queries, but only inside the person's entitlement: every query and search
 * is AND-ed with what they may see, labels outside it are withheld, and a
 * query for something not included (a measure, day-level detail, months
 * before their data starts) is refused with an EntitlementError the report
 * engine turns into a plain message with fixes. Because it wraps the adapter
 * rather than living inside one, the same rules hold for ClickHouse, the
 * in-memory test data, or an MCP-backed source.
 *
 * In the prototype entitlements come from configuration
 * (REPORT_BUILDER_ENTITLEMENTS); in the product they come from the account.
 */
import { DIMENSIONS, all, dimOf, type AggregateQuery, type Cond, type DataAdapter, type DimKey, type MeasureKey } from './types'

export interface Entitlements {
  /** Only these values are visible, per dimension (ids such as "media_type:101"). Dimensions not listed are not limited. */
  only?: Partial<Record<DimKey, string[]>>
  /** The measures included. All when not set. */
  measures?: MeasureKey[]
  /** The first month included, YYYY-MM. */
  from?: string
  /** Whether day and week detail is included. Yes when not set. */
  daily?: boolean
}

export type EntitlementKind = 'measure' | 'daily' | 'period'

export class EntitlementError extends Error {
  constructor(
    readonly kind: EntitlementKind,
    message: string,
    readonly detail: { measures?: MeasureKey[]; from?: string } = {},
  ) {
    super(message)
    this.name = 'EntitlementError'
  }
}

const MEASURE_WORD: Record<MeasureKey, string> = { spend: 'spend', occurrences: 'occurrences', impressions: 'impressions' }
const monthName = (ym: string) => {
  const [y, m] = ym.split('-').map(Number)
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][(m ?? 1) - 1]} ${y}`
}

/** The condition every query is limited to: each listed dimension's values, AND-ed. */
export function entitlementCond(e: Entitlements | null | undefined): Cond | undefined {
  const parts = Object.entries(e?.only ?? {})
    .filter(([d, ids]) => DIMENSIONS[d as DimKey] && !DIMENSIONS[d as DimKey].time && Array.isArray(ids))
    .map(([d, ids]): Cond => ({ in: d as DimKey, values: ids as string[] }))
  return all(...parts)
}

/** Whether nothing is limited. */
export const unrestricted = (e: Entitlements | null | undefined) => !e || (!Object.keys(e.only ?? {}).length && !e.measures && !e.from && e.daily !== false)

export function withEntitlements(inner: DataAdapter, e: Entitlements | null | undefined): DataAdapter {
  if (unrestricted(e)) return inner
  const ent = e!
  const limit = entitlementCond(ent)

  function check(q: AggregateQuery) {
    if (ent.measures) {
      const missing = Array.from(new Set(q.measures.map((m) => m.measure))).filter((m) => !ent.measures!.includes(m))
      if (missing.length) throw new EntitlementError('measure', `Your subscription does not include ${missing.map((m) => MEASURE_WORD[m]).join(' or ')}.`, { measures: missing })
    }
    if (ent.daily === false && (q.period.daily || q.groupBy.some((d) => DIMENSIONS[d].daily))) throw new EntitlementError('daily', 'Your subscription includes data by month, not by day or week.')
    if (ent.from && q.period.from.slice(0, 7) < ent.from) throw new EntitlementError('period', `Your data starts in ${monthName(ent.from)}.`, { from: ent.from })
  }

  return {
    name: `${inner.name} (entitled)`,
    supports: inner.supports ? (dims) => inner.supports!(dims) : undefined,
    async availability() {
      const a = await inner.availability()
      return ent.from && ent.from > a.firstComplete ? { ...a, firstComplete: ent.from } : a
    },
    async aggregate(q) {
      check(q)
      return inner.aggregate({ ...q, where: all(limit, q.where) })
    },
    async search(req) {
      // A listed dimension only finds its allowed values; everything else only what has data inside the entitlement.
      return inner.search({ ...req, where: all(limit, req.where) })
    },
    async labels(ids) {
      const allowed = (id: string) => {
        const list = ent.only?.[dimOf(id) as DimKey]
        return !list || list.includes(id)
      }
      return inner.labels(ids.filter(allowed))
    },
  }
}

/**
 * A person's entitlements. Prototype: REPORT_BUILDER_ENTITLEMENTS holds JSON
 * keyed by email, with "*" for everyone else; unset means no limits.
 */
export function entitlementsFor(email: string | null | undefined, env: Record<string, string | undefined> = process.env): Entitlements | null {
  const raw = env.REPORT_BUILDER_ENTITLEMENTS?.trim()
  if (!raw) return null
  try {
    const map = JSON.parse(raw) as Record<string, Entitlements>
    const key = (email ?? '').trim().toLowerCase()
    return map[key] ?? map['*'] ?? null
  } catch {
    // A broken setting must not open everything up silently: see nothing until it is fixed.
    return { only: { media_type: [] } }
  }
}
