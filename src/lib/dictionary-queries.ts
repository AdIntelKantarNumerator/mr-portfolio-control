/**
 * Every statement the Data Dictionary sends to ClickHouse, in one place.
 *
 * Kept apart from lib/dictionary.ts so tests/clickhouse-guard.test.ts can
 * import the real strings and prove each one is a read, without loading a
 * database driver. A query added anywhere else would escape that test, so
 * add new ones here.
 */

const NOT_SYSTEM = `database NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema')`

export const Q_DATABASES = `SELECT name, comment FROM system.databases ORDER BY name`

export const Q_TABLES = `SELECT database, name, engine,
       ifNull(total_rows, 0) AS rows, ifNull(total_bytes, 0) AS bytes,
       comment, sorting_key, partition_key,
       toString(metadata_modification_time) AS metadata_modified
  FROM system.tables
 WHERE ${NOT_SYSTEM} AND is_temporary = 0`

export const Q_PARTS = `SELECT database, table, toString(max(modification_time)) AS last_write, max(partition) AS latest_partition
  FROM system.parts
 WHERE active AND ${NOT_SYSTEM}
 GROUP BY database, table`

export const Q_COLUMN_COUNTS = `SELECT database, table, count() AS columns FROM system.columns WHERE ${NOT_SYSTEM} GROUP BY database, table`

/** Parameters: db, tbl. Passed as ClickHouse query parameters, never spliced in. */
export const Q_COLUMNS = `SELECT name, type, comment, position, is_in_sorting_key, is_in_partition_key, default_kind, default_expression
  FROM system.columns
 WHERE database = {db:String} AND table = {tbl:String}
 ORDER BY position`

export const ALL_QUERIES = { Q_DATABASES, Q_TABLES, Q_PARTS, Q_COLUMN_COUNTS, Q_COLUMNS }
