/**
 * The Data Dictionary's reads: structure from ClickHouse, meaning from here.
 *
 * Structure — databases, tables, engines, row counts, columns — is read live
 * from ClickHouse's system tables and held for a few minutes. Nothing about
 * it is written to Postgres; a stored copy is wrong the next time a loader
 * runs. What people know is read from the dictionary_* tables and laid over
 * the top.
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
  dictionaryTables,
} from '@/db/schema'
import { chQuery, chSelect, clickhouseConfig, ClickHouseError } from './clickhouse'
import { PREVIEW_SETTINGS, Q_COLUMNS, Q_COLUMN_COUNTS, Q_DATABASES, Q_PARTS, Q_PREVIEW, Q_TABLES } from './dictionary-queries'
import { isSystemDatabase, tableRef, type Environment } from './dictionary-rules'

export interface CatalogDatabase {
  name: string
  comment: string
}

export interface CatalogTable {
  database: string
  name: string
  ref: string
  engine: string
  rows: number
  bytes: number
  comment: string
  sortingKey: string
  partitionKey: string
  metadataModified: string | null
  lastWrite: string | null
  latestPartition: string | null
  columnCount: number
}

export interface Catalog {
  env: Environment
  readAt: string
  databases: CatalogDatabase[]
  tables: CatalogTable[]
}

export type CatalogResult =
  | { state: 'ok'; catalog: Catalog }
  | { state: 'not_connected'; env: Environment }
  | { state: 'error'; env: Environment; message: string }

export interface CatalogColumn {
  name: string
  type: string
  comment: string
  position: number
  inSortingKey: boolean
  inPartitionKey: boolean
  defaultKind: string
  defaultExpression: string
}

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

// ClickHouse's JSON output quotes 64-bit integers by default, so every count
// arrives as a string. Number() handles both.
const num = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export function readCatalog(env: Environment): Promise<CatalogResult> {
  return cached<CatalogResult>(
    `${env}:catalog`,
    (v) => (v.state === 'ok' ? OK_TTL_MS : ERROR_TTL_MS),
    async () => {
      const config = clickhouseConfig(env)
      if (!config) return { state: 'not_connected', env }
      try {
        const [dbs, tables, parts, cols] = await Promise.all([
          chQuery<{ name: string; comment: string }>(config, Q_DATABASES),
          chQuery<Record<string, unknown>>(config, Q_TABLES),
          chQuery<Record<string, unknown>>(config, Q_PARTS),
          chQuery<Record<string, unknown>>(config, Q_COLUMN_COUNTS),
        ])

        const partOf = new Map(parts.map((p) => [tableRef(String(p.database), String(p.table)), p]))
        const colsOf = new Map(cols.map((c) => [tableRef(String(c.database), String(c.table)), num(c.columns)]))

        return {
          state: 'ok',
          catalog: {
            env,
            readAt: new Date().toISOString(),
            databases: dbs.filter((d) => !isSystemDatabase(d.name)).map((d) => ({ name: d.name, comment: d.comment ?? '' })),
            tables: tables.map((t) => {
              const ref = tableRef(String(t.database), String(t.name))
              const p = partOf.get(ref)
              return {
                database: String(t.database),
                name: String(t.name),
                ref,
                engine: String(t.engine ?? ''),
                rows: num(t.rows),
                bytes: num(t.bytes),
                comment: String(t.comment ?? ''),
                sortingKey: String(t.sorting_key ?? ''),
                partitionKey: String(t.partition_key ?? ''),
                metadataModified: t.metadata_modified ? String(t.metadata_modified) : null,
                lastWrite: p?.last_write ? String(p.last_write) : null,
                // An unpartitioned MergeTree reports its single partition as 'tuple()'.
                latestPartition: p?.latest_partition && String(p.latest_partition) !== 'tuple()' ? String(p.latest_partition) : null,
                columnCount: colsOf.get(ref) ?? 0,
              }
            }),
          },
        }
      } catch (err) {
        const message = err instanceof ClickHouseError ? err.message : `Reading ClickHouse failed: ${(err as Error).message}`
        return { state: 'error', env, message }
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
      const config = clickhouseConfig(env)
      if (!config) return { ok: false as const, message: `ClickHouse ${env} is not connected.` }
      try {
        const rows = await chQuery<Record<string, unknown>>(config, Q_COLUMNS, { db: database, tbl: table })
        return {
          ok: true as const,
          columns: rows.map((r) => ({
            name: String(r.name),
            type: String(r.type),
            comment: String(r.comment ?? ''),
            position: num(r.position),
            inSortingKey: num(r.is_in_sorting_key) === 1,
            inPartitionKey: num(r.is_in_partition_key) === 1,
            defaultKind: String(r.default_kind ?? ''),
            defaultExpression: String(r.default_expression ?? ''),
          })),
        }
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
 * flicking between tabs does not re-read, and never stored anywhere.
 */
export function readPreview(env: Environment, database: string, table: string): Promise<PreviewResult> {
  return cached(
    `${env}:preview:${database}.${table}`,
    (v) => (v.ok ? 60_000 : ERROR_TTL_MS),
    async () => {
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
