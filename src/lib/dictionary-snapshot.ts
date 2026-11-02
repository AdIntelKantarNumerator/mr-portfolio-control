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

export interface SnapshotUpload {
  env: Environment
  takenAt: Date
  takenBy: string | null
  catalog: Catalog
  columns: Record<string, CatalogColumn[]>
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
  return { env: env as Environment, takenAt, takenBy, catalog: { ...catalog, env: env as Environment }, columns }
}
