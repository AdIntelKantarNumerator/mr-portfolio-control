/**
 * The Data Dictionary's reads: structure from ClickHouse, meaning from here.
 *
 * Structure — databases, tables, engines, row counts, columns — is read live
 * from ClickHouse's system tables and held for a few minutes (lib/
 * dictionary-live.ts). What people know is read from the dictionary_* tables
 * and laid over the top.
 *
 * OR FROM A STORED COPY
 *
 * Prod ClickHouse is on a private address the web app cannot reach yet
 * (deploy/AZURE.md). Until it can, a laptop on the VPN reads it and sends the
 * copy here (scripts/dictionary-snapshot.ts), and with
 * CLICKHOUSE_PROD_SOURCE=snapshot the site shows that copy instead of trying
 * a connection that would only time out on every page. The pages say it is
 * static and when it was taken (Scott, 2 November 2026). Previews need a live
 * connection, so they say so rather than showing nothing. Set the source back
 * to live (or remove it) once the network path exists.
 *
 * WHY A SHORT CACHE
 *
 * The four catalog queries take tens of milliseconds, but every tab and every
 * table page needs them, and the data only moves when a loader runs. Five
 * minutes keeps the pages instant without ever being meaningfully stale, and
 * "Re-read now" on the page clears it for the moment somebody has just loaded
 * something and wants to see it. A failed read is cached for much less, so a
 * brief outage does not stick for five minutes after it is over.
 */
import { asc, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import {
  dictionaryColumns,
  dictionaryDatabases,
  dictionaryDatasets,
  dictionaryDatasetTables,
  dictionarySnapshots,
  dictionaryTables,
} from '@/db/schema'
import { chSelect, clickhouseConfig, ClickHouseError } from './clickhouse'
import { clickhouseMessage, readLiveCatalog, readLiveColumns, type Catalog, type CatalogColumn } from './dictionary-live'
import { PREVIEW_SETTINGS, Q_PREVIEW } from './dictionary-queries'
import { ENV_LABEL, tableRef, type Environment } from './dictionary-rules'

export type { Catalog, CatalogColumn, CatalogDatabase, CatalogTable } from './dictionary-live'

export type CatalogResult =
  | { state: 'ok'; catalog: Catalog }
  | { state: 'not_connected'; env: Environment }
  | { state: 'error'; env: Environment; message: string }

const OK_TTL_MS = 5 * 60_000
const ERROR_TTL_MS = 20_000

declare global {
  // Survives Next.js dev hot reloads, like the database handle in db/client.
  var __pcrCatalogCache: Map<string, { at: number; value: unknown }> | undefined
}
const cache = (globalThis.__pcrCatalogCache ??= new Map())

function cached<T>(key: string, ttl: (v: T) => number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key) as { at: number; value: T } | undefined
  if (hit && Date.now() - hit.at < ttl(hit.value)) return Promise.resolve(hit.value)
  return load().then((value) => {
    cache.set(key, { at: Date.now(), value })
    return value
  })
}

/** Forget everything read from `env`, so the next page load reads afresh. */
export function forgetCatalog(env: Environment): void {
  for (const k of [...cache.keys()]) if (k.startsWith(`${env}:`)) cache.delete(k)
}

/** Whether this environment is shown from its stored copy: CLICKHOUSE_<ENV>_SOURCE=snapshot. */
export function readsSnapshot(env: Environment, source: Record<string, string | undefined> = process.env): boolean {
  return source[`CLICKHOUSE_${env.toUpperCase()}_SOURCE`]?.trim().toLowerCase() === 'snapshot'
}

async function storedSnapshot(env: Environment) {
  const [row] = await db.select().from(dictionarySnapshots).where(eq(dictionarySnapshots.env, env)).limit(1)
  return row ?? null
}

export function readCatalog(env: Environment): Promise<CatalogResult> {
  return cached<CatalogResult>(
    `${env}:catalog`,
    (v) => (v.state === 'ok' ? OK_TTL_MS : ERROR_TTL_MS),
    async () => {
      if (readsSnapshot(env)) {
        const row = await storedSnapshot(env)
        if (!row) {
          return { state: 'error', env, message: `No copy of ClickHouse ${ENV_LABEL[env]} has been taken yet. Run the snapshot from a laptop on the VPN (npm run dictionary:snapshot).` }
        }
        const catalog = JSON.parse(row.catalog) as Catalog
        return { state: 'ok', catalog: { ...catalog, snapshot: { takenAt: row.takenAt.toISOString(), takenBy: row.takenBy } } }
      }
      const config = clickhouseConfig(env)
      if (!config) return { state: 'not_connected', env }
      try {
        return { state: 'ok', catalog: await readLiveCatalog(config) }
      } catch (err) {
        return { state: 'error', env, message: clickhouseMessage(err) }
      }
    },
  )
}

export function readColumns(
  env: Environment,
  database: string,
  table: string,
): Promise<{ ok: true; columns: CatalogColumn[] } | { ok: false; message: string }> {
  return cached(
    `${env}:columns:${database}.${table}`,
    (v) => (v.ok ? OK_TTL_MS : ERROR_TTL_MS),
    async () => {
      if (readsSnapshot(env)) {
        const row = await storedSnapshot(env)
        if (!row) return { ok: false as const, message: `No copy of ClickHouse ${ENV_LABEL[env]} has been taken yet.` }
        const all = JSON.parse(row.columns) as Record<string, CatalogColumn[]>
        return { ok: true as const, columns: all[tableRef(database, table)] ?? [] }
      }
      const config = clickhouseConfig(env)
      if (!config) return { ok: false as const, message: `ClickHouse ${env} is not connected.` }
      try {
        return { ok: true as const, columns: await readLiveColumns(config, database, table) }
      } catch (err) {
        return { ok: false as const, message: err instanceof ClickHouseError ? err.message : (err as Error).message }
      }
    },
  )
}

export type PreviewResult =
  | { ok: true; readAt: string; columns: Array<{ name: string; type: string }>; rows: Array<Record<string, unknown>> }
  | { ok: false; message: string }

/**
 * The first rows of one table, for the Preview tab. Held for a minute, so
 * flicking between tabs does not re-read, and never stored anywhere - which is
 * also why a snapshot has none: it keeps structure, never rows.
 */
export function readPreview(env: Environment, database: string, table: string): Promise<PreviewResult> {
  return cached(
    `${env}:preview:${database}.${table}`,
    (v) => (v.ok ? 60_000 : ERROR_TTL_MS),
    async () => {
      if (readsSnapshot(env)) {
        return { ok: false as const, message: `${ENV_LABEL[env]} is shown from a static copy, which keeps structure but never rows. A preview needs a live connection to ClickHouse ${ENV_LABEL[env]}.` }
      }
      const config = clickhouseConfig(env)
      if (!config) return { ok: false as const, message: `ClickHouse ${env} is not connected.` }
      try {
        const { meta, data } = await chSelect<Record<string, unknown>>(config, Q_PREVIEW, { db: database, tbl: table }, PREVIEW_SETTINGS)
        return { ok: true as const, readAt: new Date().toISOString(), columns: meta, rows: data.slice(0, 10) }
      } catch (err) {
        return { ok: false as const, message: err instanceof ClickHouseError ? err.message : (err as Error).message }
      }
    },
  )
}

/** Store a copy sent from a laptop (app/api/sync/dictionary-snapshot), replacing the last. */
export async function saveSnapshot(snap: { env: Environment; takenAt: Date; takenBy: string | null; catalog: Catalog; columns: Record<string, CatalogColumn[]> }): Promise<void> {
  const values = {
    env: snap.env,
    takenAt: snap.takenAt,
    takenBy: snap.takenBy,
    catalog: JSON.stringify({ ...snap.catalog, snapshot: null }),
    columns: JSON.stringify(snap.columns),
  }
  await db.insert(dictionarySnapshots).values(values).onConflictDoUpdate({ target: dictionarySnapshots.env, set: { ...values, updatedAt: new Date() } })
  forgetCatalog(snap.env)
}

// ---------------------------------------------------------------------------
// What people know, from Postgres
// ---------------------------------------------------------------------------

export type DatabaseNote = typeof dictionaryDatabases.$inferSelect
export type TableNote = typeof dictionaryTables.$inferSelect
export type ColumnNote = typeof dictionaryColumns.$inferSelect
export type Dataset = typeof dictionaryDatasets.$inferSelect & { tables: string[] }

export async function readDictionaryNotes(): Promise<{
  databases: DatabaseNote[]
  tables: TableNote[]
  datasets: Dataset[]
}> {
  const [databases, tables, sets, links] = await Promise.all([
    db.select().from(dictionaryDatabases),
    db.select().from(dictionaryTables),
    db.select().from(dictionaryDatasets).orderBy(asc(dictionaryDatasets.sortOrder), asc(dictionaryDatasets.name)),
    db.select().from(dictionaryDatasetTables),
  ])
  const byDataset = new Map<string, string[]>()
  for (const l of links) {
    if (!byDataset.has(l.datasetId)) byDataset.set(l.datasetId, [])
    byDataset.get(l.datasetId)!.push(l.tableRef)
  }
  return {
    databases,
    tables,
    datasets: sets.map((s) => ({ ...s, tables: (byDataset.get(s.id) ?? []).sort() })),
  }
}

export async function readColumnNotes(ref: string): Promise<ColumnNote[]> {
  return db.select().from(dictionaryColumns).where(eq(dictionaryColumns.tableRef, ref))
}

/** How many columns of each table people have described, for the Tables list. */
export async function describedColumnCounts(): Promise<Map<string, number>> {
  const rows = await db
    .select({ tableRef: dictionaryColumns.tableRef, description: dictionaryColumns.description })
    .from(dictionaryColumns)
  const out = new Map<string, number>()
  for (const r of rows) if (r.description?.trim()) out.set(r.tableRef, (out.get(r.tableRef) ?? 0) + 1)
  return out
}
