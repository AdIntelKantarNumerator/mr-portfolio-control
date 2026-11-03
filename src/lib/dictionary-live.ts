/**
 * Reading ClickHouse's structure directly, with no database of our own.
 *
 * Split out of lib/dictionary.ts (2 November 2026) so the snapshot script
 * (scripts/dictionary-snapshot.ts) can read a cluster from a laptop on the
 * VPN without opening the portfolio's database. The site reads the same
 * shapes, either live through these functions or from the stored snapshot.
 */
import { chQuery, chSelect, ClickHouseError, type ClickHouseConfig } from './clickhouse'
import { PREVIEW_SETTINGS, Q_ALL_COLUMNS, Q_COLUMNS, Q_COLUMN_COUNTS, Q_DATABASES, Q_PARTS, Q_PREVIEW, Q_TABLES } from './dictionary-queries'
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
  /**
   * Set when this is a stored copy rather than a live read: when it was taken
   * and by whom. The pages say so, with the time (Scott, 2 November 2026).
   */
  snapshot?: { takenAt: string; takenBy: string | null } | null
}

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

// ClickHouse's JSON output quotes 64-bit integers by default, so every count
// arrives as a string. Number() handles both.
export const num = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export async function readLiveCatalog(config: ClickHouseConfig): Promise<Catalog> {
  const [dbs, tables, parts, cols] = await Promise.all([
    chQuery<{ name: string; comment: string }>(config, Q_DATABASES),
    chQuery<Record<string, unknown>>(config, Q_TABLES),
    chQuery<Record<string, unknown>>(config, Q_PARTS),
    chQuery<Record<string, unknown>>(config, Q_COLUMN_COUNTS),
  ])

  const partOf = new Map(parts.map((p) => [tableRef(String(p.database), String(p.table)), p]))
  const colsOf = new Map(cols.map((c) => [tableRef(String(c.database), String(c.table)), num(c.columns)]))

  return {
    env: config.env,
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
  }
}

const toColumn = (r: Record<string, unknown>): CatalogColumn => ({
  name: String(r.name),
  type: String(r.type),
  comment: String(r.comment ?? ''),
  position: num(r.position),
  inSortingKey: num(r.is_in_sorting_key) === 1,
  inPartitionKey: num(r.is_in_partition_key) === 1,
  defaultKind: String(r.default_kind ?? ''),
  defaultExpression: String(r.default_expression ?? ''),
})

export async function readLiveColumns(config: ClickHouseConfig, database: string, table: string): Promise<CatalogColumn[]> {
  return (await chQuery<Record<string, unknown>>(config, Q_COLUMNS, { db: database, tbl: table })).map(toColumn)
}

/** Every table's columns in one read, by table ref: what a snapshot keeps. */
export async function readAllLiveColumns(config: ClickHouseConfig): Promise<Record<string, CatalogColumn[]>> {
  const out: Record<string, CatalogColumn[]> = {}
  for (const r of await chQuery<Record<string, unknown>>(config, Q_ALL_COLUMNS)) {
    ;(out[tableRef(String(r.database), String(r.table))] ??= []).push(toColumn(r))
  }
  return out
}

/** The first rows of one table, as the Preview tab reads them: capped, read-only. */
export async function readLivePreview(config: ClickHouseConfig, database: string, table: string): Promise<{ columns: Array<{ name: string; type: string }>; rows: Array<Record<string, unknown>> }> {
  const { meta, data } = await chSelect<Record<string, unknown>>(config, Q_PREVIEW, { db: database, tbl: table }, PREVIEW_SETTINGS)
  return { columns: meta, rows: data.slice(0, 10) }
}

export function clickhouseMessage(err: unknown): string {
  return err instanceof ClickHouseError ? err.message : `Reading ClickHouse failed: ${(err as Error).message}`
}
