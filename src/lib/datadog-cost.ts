/**
 * Cost Analysis's baseline, read from Datadog (lib/cost-model.ts does the
 * arithmetic). Read-only: one metrics query, GCP AI cost per project per day.
 *
 * Without DATADOG_API_KEY and DATADOG_APP_KEY the page uses the 5–11 November
 * snapshot and says so. A failed read falls back the same way and shows why,
 * so a lapsed key is visible instead of looking like a quiet week.
 */
import { SNAPSHOT_ROWS, SNAPSHOT_TODAY, type CostRow } from './cost-model'

/** GCP AI only: what the Workflow map's AI components bill. Other GCP services and projects are out of scope for now. */
export const COST_QUERY =
  'sum:gcp.cost.amortized.shared.resources.allocated{servicename IN (GeminiAPI,VertexAI)} by {project_name}.rollup(sum, 86400)'

export interface CostSource {
  kind: 'datadog' | 'snapshot'
  rows: CostRow[]
  /** The day the typical-day window counts back from. */
  today: string
  /** Why the snapshot is showing, when Datadog is configured but the read failed. */
  error?: string
  readAt: string
}

const TTL = 6 * 60 * 60 * 1000
let cache: { at: number; value: CostSource } | null = null

export function datadogConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.DATADOG_API_KEY?.trim() && env.DATADOG_APP_KEY?.trim())
}

function snapshot(error?: string): CostSource {
  return { kind: 'snapshot', rows: SNAPSHOT_ROWS, today: SNAPSHOT_TODAY, error, readAt: new Date().toISOString() }
}

interface Series {
  tag_set?: string[]
  scope?: string
  pointlist?: [number, number | null][]
}

/** Datadog's series → one row per project per UTC day. Exported for the tests. */
export function rowsFromSeries(series: Series[]): CostRow[] {
  const rows: CostRow[] = []
  for (const s of series) {
    const tag = (s.tag_set ?? []).find((t) => t.startsWith('project_name:')) ?? s.scope ?? ''
    const project = tag.replace(/^project_name:/, '')
    if (!project) continue
    for (const [ms, value] of s.pointlist ?? []) {
      if (value == null || !Number.isFinite(value)) continue
      rows.push({ day: new Date(ms).toISOString().slice(0, 10), project, cost: value })
    }
  }
  return rows
}

export async function readCostSource(now = new Date()): Promise<CostSource> {
  if (!datadogConfigured()) return snapshot()
  if (cache && Date.now() - cache.at < TTL) return cache.value

  const site = process.env.DATADOG_SITE?.trim() || 'datadoghq.com'
  const to = Math.floor(now.getTime() / 1000)
  const from = to - 12 * 86_400
  const url = `https://api.${site}/api/v1/query?from=${from}&to=${to}&query=${encodeURIComponent(COST_QUERY)}`
  try {
    const res = await fetch(url, {
      headers: { 'DD-API-KEY': process.env.DATADOG_API_KEY!.trim(), 'DD-APPLICATION-KEY': process.env.DATADOG_APP_KEY!.trim() },
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return snapshot(`Datadog answered ${res.status}`)
    const body = (await res.json()) as { series?: Series[] }
    const rows = rowsFromSeries(body.series ?? [])
    if (!rows.length) return snapshot('Datadog returned no GCP AI cost for the last 12 days')
    const value: CostSource = { kind: 'datadog', rows, today: now.toISOString().slice(0, 10), readAt: now.toISOString() }
    cache = { at: Date.now(), value }
    return value
  } catch (e) {
    return snapshot(`Could not reach Datadog: ${e instanceof Error ? e.message : String(e)}`)
  }
}
