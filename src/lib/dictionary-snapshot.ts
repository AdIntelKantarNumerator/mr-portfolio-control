/**
 * What a snapshot upload must look like before it replaces the stored copy
 * (app/api/sync/dictionary-snapshot). Pure, so it is tested on its own.
 *
 * A snapshot replaces the last one wholesale, so a broken upload would empty
 * the dictionary for everyone. Refused rather than stored: no tables at all, a
 * table with no ref, or a time that is not a time.
 */
import type { Catalog, CatalogColumn } from './dictionary-live'
import { ENVIRONMENTS, type Environment } from './dictionary-rules'

/**
 * One table's sample in a copy: the rows the live preview would have shown
 * then, or why there are none.
 */
export type StoredPreview = { columns: Array<{ name: string; type: string }>; rows: Array<Record<string, unknown>> } | { error: string }

export interface SnapshotUpload {
  env: Environment
  takenAt: Date
  takenBy: string | null
  catalog: Catalog
  columns: Record<string, CatalogColumn[]>
  /** Absent from a copy taken before samples (3 November 2026). */
  previews: Record<string, StoredPreview> | null
}

/** Longest text kept in a sample cell; the cell says it was cut. */
export const SAMPLE_TEXT_MAX = 300
/** Most a table's sample may take, as JSON. Rows are dropped from the end past it. */
export const SAMPLE_BYTES_MAX = 60_000

/**
 * Sample rows as stored: long text cut, and rows dropped from the end until
 * the table's sample fits. Every sample is kept with the copy and sent on each
 * snapshot, so one table with a JSON blob in each row must not make the copy
 * hundreds of megabytes. Arrays and objects are cut as their JSON.
 */
export function trimSample(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const cut = (v: unknown): unknown => {
    if (typeof v === 'string') return v.length > SAMPLE_TEXT_MAX ? `${v.slice(0, SAMPLE_TEXT_MAX)}… [cut from ${v.length} characters]` : v
    if (v && typeof v === 'object') {
      const json = JSON.stringify(v)
      return json.length > SAMPLE_TEXT_MAX ? `${json.slice(0, SAMPLE_TEXT_MAX)}… [cut from ${json.length} characters]` : v
    }
    return v
  }
  const out = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, cut(v)])))
  while (out.length > 1 && JSON.stringify(out).length > SAMPLE_BYTES_MAX) out.pop()
  return out
}

export function parseSnapshot(body: unknown): SnapshotUpload | string {
  const b = (body ?? {}) as Record<string, unknown>
  const env = b.env
  if (!ENVIRONMENTS.includes(env as Environment)) return `"env" must be one of ${ENVIRONMENTS.join(', ')}.`
  const takenAt = new Date(String(b.takenAt ?? ''))
  if (Number.isNaN(takenAt.getTime())) return '"takenAt" must be an ISO time.'
  if (takenAt.getTime() > Date.now() + 5 * 60_000) return '"takenAt" is in the future.'
  const catalog = b.catalog as Catalog | undefined
  if (!catalog || !Array.isArray(catalog.databases) || !Array.isArray(catalog.tables)) return '"catalog" must have databases and tables.'
  if (catalog.tables.length === 0) return 'The catalog has no tables; refusing to replace the stored copy with an empty one.'
  if (catalog.tables.some((t) => !t || typeof t.ref !== 'string' || !t.ref.includes('.'))) return 'Every table needs a "ref" like "database.table".'
  const columns = b.columns as Record<string, CatalogColumn[]> | undefined
  if (!columns || typeof columns !== 'object' || Array.isArray(columns)) return '"columns" must be an object of column lists by table ref.'
  const takenBy = typeof b.takenBy === 'string' && b.takenBy.trim() ? b.takenBy.trim().slice(0, 120) : null
  const raw = b.previews
  if (raw !== undefined && raw !== null && (typeof raw !== 'object' || Array.isArray(raw))) return '"previews" must be an object of samples by table ref.'
  const previews = raw ? (raw as Record<string, StoredPreview>) : null
  return { env: env as Environment, takenAt, takenBy, catalog: { ...catalog, env: env as Environment }, columns, previews }
}
