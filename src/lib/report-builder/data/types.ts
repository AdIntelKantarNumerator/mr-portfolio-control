/**
 * Report Builder's data layer: the one way the report engine asks for data
 * (12 November 2026).
 *
 * The engine describes what it wants as a structured query (AggregateQuery):
 * which dimensions to group by, which measures, each optionally under its own
 * condition ("spend with you", "spend in October"), conditions on the
 * results ("spent nothing with you"), order, paging, totals and a count. It
 * never writes SQL. A DataAdapter answers those queries for one backend:
 * ClickHouse today (clickhouse.ts), an in-memory table for tests
 * (memory.ts), and later whatever the MCP server reads.
 *
 * Entitlements (entitlements.ts) wrap any adapter, so what a person may see
 * is enforced in one place, whatever answers the query.
 *
 * Ids: every value of a named dimension is "<dimension>:<id>" (advertiser:123).
 * Time values are plain: month "2026-10", quarter "2026-Q4", year "2026",
 * day and both kinds of week "2026-10-05" (a week by its first day).
 */

export type DimKey =
  | 'industry'
  | 'category'
  | 'subcategory'
  | 'top_parent'
  | 'advertiser'
  | 'product'
  | 'media_type'
  | 'media_owner'
  | 'property'
  | 'market'
  | 'month'
  | 'quarter'
  | 'year'
  | 'day'
  | 'week'
  | 'broadcast_week'

export type DimGroup = 'who' | 'what' | 'where' | 'when'

export interface DimInfo {
  label: string
  plural: string
  group: DimGroup
  /** A time dimension: its values are dates or periods, not ids. */
  time?: boolean
  /** Needs data by day (day and week breakdowns). */
  daily?: boolean
}

/** The dimensions every adapter answers for. */
export const DIMENSIONS: Record<DimKey, DimInfo> = {
  industry: { label: 'Industry', plural: 'industries', group: 'what' },
  category: { label: 'Category', plural: 'categories', group: 'what' },
  subcategory: { label: 'Subcategory', plural: 'subcategories', group: 'what' },
  top_parent: { label: 'Top parent', plural: 'top parents', group: 'who' },
  advertiser: { label: 'Advertiser', plural: 'advertisers', group: 'who' },
  product: { label: 'Product', plural: 'products', group: 'who' },
  media_type: { label: 'Media type', plural: 'media types', group: 'where' },
  media_owner: { label: 'Media owner', plural: 'media owners', group: 'where' },
  property: { label: 'Property', plural: 'properties', group: 'where' },
  market: { label: 'Market', plural: 'markets', group: 'where' },
  month: { label: 'Month', plural: 'months', group: 'when', time: true },
  quarter: { label: 'Quarter', plural: 'quarters', group: 'when', time: true },
  year: { label: 'Year', plural: 'years', group: 'when', time: true },
  day: { label: 'Day', plural: 'days', group: 'when', time: true, daily: true },
  week: { label: 'Week', plural: 'weeks', group: 'when', time: true, daily: true },
  broadcast_week: { label: 'Broadcast week', plural: 'broadcast weeks', group: 'when', time: true, daily: true },
}

export type MeasureKey = 'spend' | 'occurrences' | 'impressions'

export const MEASURE_INFO: Record<MeasureKey, { label: string; type: 'money' | 'int'; note?: string }> = {
  spend: { label: 'Spend', type: 'money' },
  occurrences: { label: 'Occurrences', type: 'int' },
  impressions: { label: 'Impressions', type: 'int', note: 'Not measured for every medium.' },
}

/** The dimension an id belongs to: "advertiser:123" is an advertiser. */
export const dimOf = (id: string) => String(id).split(':')[0]!

/**
 * A condition on the data. Combine with and / or / not.
 *   in        values of one dimension (ids, or time values)
 *   anyOf     ids of several dimensions, any of them ("my brands, or this whole category")
 *   tuples    rows whose values across several dimensions match one of these
 *   named     the dimension has a name (leaves out unnamed values)
 */
export type Cond =
  | { in: DimKey; values: string[] }
  | { anyOf: string[] }
  | { tuples: DimKey[]; values: string[][] }
  | { named: DimKey }
  | { and: Cond[] }
  | { or: Cond[] }
  | { not: Cond }

export const all = (...cs: Array<Cond | null | undefined | false>): Cond | undefined => {
  const xs = cs.filter((c): c is Cond => Boolean(c))
  return xs.length === 0 ? undefined : xs.length === 1 ? xs[0] : { and: xs }
}
export const any = (...cs: Array<Cond | null | undefined | false>): Cond | undefined => {
  const xs = cs.filter((c): c is Cond => Boolean(c))
  return xs.length === 0 ? undefined : xs.length === 1 ? xs[0] : { or: xs }
}

/** One measure in the result, under its own name, optionally counted only where a condition holds. */
export interface MeasureSpec {
  as: string
  measure: MeasureKey
  where?: Cond
}

export interface AggregateQuery {
  /** Days, inclusive, as YYYY-MM-DD. Without daily, whole months: the months these days fall in. */
  period: { from: string; to: string; daily?: boolean }
  /** Rows in scope. */
  where?: Cond
  /** Promos and public service announcements are left out unless this is set. */
  includePromos?: boolean
  groupBy: DimKey[]
  /** Also return each grouped value's context (an advertiser's parent, a property's media and owner). */
  context?: boolean
  measures: MeasureSpec[]
  /** Conditions on the grouped results, AND-ed. */
  having?: Array<{ as: string; op: '=' | '!=' | '>' | '<' | '>=' | '<='; value: number }>
  /** By a measure's name or a grouped dimension. */
  orderBy?: Array<{ by: string; desc?: boolean }>
  limit?: number
  /** How many grouped rows there are in all (after having). */
  withCount?: boolean
  /** Each measure summed over all grouped rows (after having). */
  withTotals?: boolean
}

export interface GroupKey {
  id: string
  name: string
  context?: string
}

export interface AggregateResult {
  rows: Array<{ keys: Partial<Record<DimKey, GroupKey>>; values: Record<string, number> }>
  count?: number
  totals?: Record<string, number>
}

export interface Availability {
  /** First month with every medium, YYYY-MM. */
  firstComplete: string
  /** Last complete month, YYYY-MM. */
  through: string
  /** The month still loading, YYYY-MM. */
  prelim: string
  /** The last day loaded, YYYY-MM-DD. */
  prelimDay: string
}

export interface NameHit {
  id: string
  dim: DimKey
  name: string
  context: string
  /** Spend in the month searched. */
  spend: number
}

export interface SearchRequest {
  /** One lookup per dimension and text; text null lists the biggest. */
  parts: Array<{ dim: DimKey; text: string | null }>
  /** The month whose spend ranks the matches, YYYY-MM. */
  month: string
  /** At most this many per part. */
  limit: number
  where?: Cond
}

export interface DataAdapter {
  readonly name: string
  availability(): Promise<Availability>
  aggregate(q: AggregateQuery): Promise<AggregateResult>
  search(req: SearchRequest): Promise<NameHit[]>
  /** Names and context for ids. Unknown ids are left out. */
  labels(ids: string[]): Promise<Array<{ id: string; name: string; context: string }>>
}
