/**
 * The Data Dictionary's judgements, as arithmetic.
 *
 * Which tables are noise, whether a dataset is loaded, and whether what is
 * loaded matches what people said should be. Pure, so each rule is pinned by
 * a test in the terms of the case that motivated it.
 */

export const ENVIRONMENTS = ['dev', 'prod'] as const
export type Environment = (typeof ENVIRONMENTS)[number]

export const ENV_LABEL: Record<Environment, string> = { dev: 'Dev', prod: 'Prod' }

export function readEnvironment(raw: unknown): Environment {
  return raw === 'prod' ? 'prod' : 'dev'
}

/** What people say a dataset should be, per environment. */
export const INTENTS = ['loaded', 'awaiting_feed', 'by_design', 'planned', 'undecided'] as const
export type Intent = (typeof INTENTS)[number]

export const INTENT_LABEL: Record<Intent, string> = {
  loaded: 'Loaded',
  awaiting_feed: 'Awaiting a feed',
  by_design: 'Empty by design',
  planned: 'Planned',
  undecided: 'Undecided',
}

/** Why an empty table is empty. */
export const EMPTY_REASONS = ['by_design', 'awaiting_feed', 'undecided'] as const
export type EmptyReason = (typeof EMPTY_REASONS)[number]

export const EMPTY_REASON_LABEL: Record<EmptyReason, string> = {
  by_design: 'Empty by design',
  awaiting_feed: 'Awaiting a feed',
  undecided: 'Undecided',
}

/** Whether a database is part of what clients consume. */
export const DATABASE_STATUSES = ['contract', 'internal', 'transition', 'superseded', 'excluded', 'unreviewed'] as const
export type DatabaseStatus = (typeof DATABASE_STATUSES)[number]

export const DATABASE_STATUS_LABEL: Record<DatabaseStatus, string> = {
  contract: 'Client contract',
  internal: 'Internal',
  transition: 'Being eliminated',
  superseded: 'Superseded',
  excluded: 'Excluded',
  unreviewed: 'Not reviewed',
}

/** Shown by default. Excluded and superseded are one click away, never deleted. */
export function databaseShownByDefault(status: DatabaseStatus): boolean {
  return status !== 'excluded' && status !== 'superseded'
}

/** ClickHouse's own databases. Never part of the dictionary. */
const SYSTEM_DATABASES = new Set(['system', 'information_schema', 'INFORMATION_SCHEMA'])

export function isSystemDatabase(name: string): boolean {
  return SYSTEM_DATABASES.has(name)
}

/**
 * Tables hidden by rule: backups, scratch and test tables, and ClickHouse's
 * internal storage for materialised views.
 *
 * Decided 1 October 2026 ("backup tables and stale databases can be
 * excluded"), after the live read found five backups sitting in schemas meant
 * to be browsed — property_bak_20260930, pgem_bak_preauto and friends — and
 * a _tmp_replace_ table and two iceberg_test tables in `creative`. A person
 * can still exclude any other table by hand; this only covers the ones whose
 * name already says what they are.
 */
export function excludedByRule(table: string): string | null {
  if (table.startsWith('.inner')) return 'internal storage of a materialised view'
  if (/(^|_)bak(_|\d|$)/i.test(table)) return 'a backup'
  if (/^_tmp|_tmp_/i.test(table)) return 'a temporary table'
  if (/(^|_)test(_|$)|_test\d*$/i.test(table)) return 'a test table'
  return null
}

export function tableRef(database: string, table: string): string {
  return `${database}.${table}`
}

/** "gpc_summary.tv_entity_summary_month" → its two halves, or null. */
export function parseTableRef(ref: string): { database: string; table: string } | null {
  const i = ref.indexOf('.')
  if (i <= 0 || i === ref.length - 1) return null
  return { database: ref.slice(0, i), table: ref.slice(i + 1) }
}

export type DatasetStatus = 'loaded' | 'partial' | 'not_loaded' | 'unknown'

export const DATASET_STATUS_LABEL: Record<DatasetStatus, string> = {
  loaded: 'Loaded',
  partial: 'Partial',
  not_loaded: 'Not loaded',
  unknown: 'Unknown',
}

export interface TableState {
  ref: string
  /** 'rows' has data; 'empty' exists with none; 'missing' is not in ClickHouse at all. */
  state: 'rows' | 'empty' | 'missing'
  rows: number
  emptyReason: EmptyReason | null
}

/**
 * Whether a dataset is loaded, from what its tables actually hold.
 *
 * A table that is empty *by design* counts as satisfied: account_provider_block
 * is empty because no block has been issued, and calling the Entitlements
 * dataset "partial" for it would be a false alarm people learn to ignore. A
 * table that is empty for any other reason, or missing, counts against.
 *
 * `null` catalog means the environment could not be read — Prod before it is
 * connected, or Dev when it is down — and the honest answer is "unknown", not
 * "not loaded".
 */
export function datasetStatus(
  refs: string[],
  catalog: Map<string, { rows: number }> | null,
  emptyReasons: Map<string, EmptyReason>,
): { status: DatasetStatus; tables: TableState[] } {
  if (!catalog) {
    return {
      status: 'unknown',
      tables: refs.map((ref) => ({ ref, state: 'missing', rows: 0, emptyReason: emptyReasons.get(ref) ?? null })),
    }
  }
  const tables: TableState[] = refs.map((ref) => {
    const hit = catalog.get(ref)
    const emptyReason = emptyReasons.get(ref) ?? null
    if (!hit) return { ref, state: 'missing', rows: 0, emptyReason }
    return { ref, state: hit.rows > 0 ? 'rows' : 'empty', rows: hit.rows, emptyReason }
  })
  if (!tables.length) return { status: 'not_loaded', tables }
  const satisfied = tables.filter((t) => t.state === 'rows' || (t.state === 'empty' && t.emptyReason === 'by_design'))
  const status: DatasetStatus =
    satisfied.length === tables.length ? 'loaded' : satisfied.some((t) => t.state === 'rows') ? 'partial' : 'not_loaded'
  return { status, tables }
}

/**
 * Whether what is loaded disagrees with what people said should be, or
 * nobody has said.
 *
 * The count of these is the number at the top of the Datasets tab, because it
 * is the list of things somebody has to decide or chase. "Planned" against
 * "not loaded" is not a disagreement — that is what planned means — and an
 * environment that could not be read cannot disagree with anything.
 */
export function needsAttention(status: DatasetStatus, intent: Intent): boolean {
  if (status === 'unknown') return false
  if (intent === 'undecided') return true
  if (intent === 'loaded') return status !== 'loaded'
  if (intent === 'awaiting_feed' || intent === 'planned') return status === 'loaded'
  // by_design: the dataset is meant to be empty
  return status !== 'not_loaded'
}

export function readIntent(raw: unknown): Intent | null {
  return (INTENTS as readonly string[]).includes(String(raw)) ? (raw as Intent) : null
}

export function readEmptyReason(raw: unknown): EmptyReason | null {
  return (EMPTY_REASONS as readonly string[]).includes(String(raw)) ? (raw as EmptyReason) : null
}

export function readDatabaseStatus(raw: unknown): DatabaseStatus | null {
  return (DATABASE_STATUSES as readonly string[]).includes(String(raw)) ? (raw as DatabaseStatus) : null
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

/**
 * Engines whose rows are read from ClickHouse's own storage, or from a query
 * over it. Anything in the MergeTree family is covered by the suffix test in
 * previewProblem, Replicated and Shared variants included.
 */
const LOCAL_ENGINES = new Set([
  'View',
  'MaterializedView',
  'Memory',
  'Log',
  'TinyLog',
  'StripeLog',
  'Distributed',
  'Merge',
  'Dictionary',
  'Buffer',
  'Join',
  'Null',
])

/**
 * Engines where a SELECT is not a harmless read: it consumes messages, so the
 * preview would take them from whatever was meant to load them.
 */
const STREAM_ENGINES = new Set(['Kafka', 'RabbitMQ', 'NATS', 'FileLog', 'S3Queue', 'AzureQueue', 'Redis'])

/**
 * Why a table is not previewed, or null when it may be.
 *
 * Everything else (MySQL, PostgreSQL, S3, URL, the lake formats) is refused
 * too, because a SELECT on one of those is a query against another system,
 * made with ClickHouse's credentials for it. The preview is for looking at
 * what is loaded here, not for reaching through to there.
 */
export function previewProblem(engine: string): string | null {
  const e = engine.trim()
  if (/MergeTree$/.test(e) || LOCAL_ENGINES.has(e)) return null
  if (STREAM_ENGINES.has(e)) return `Reading a ${e} table consumes its messages, so it is never previewed.`
  return `A ${e || 'table with no engine'} table is read from another system when it is queried, so the preview does not reach into it.`
}

export type PreviewCell = { kind: 'null' | 'empty' | 'text' | 'number' | 'json'; text: string; title?: string }

const CELL_CHARS = 120
const TITLE_CHARS = 2000

/**
 * One value as the preview shows it. Long text is cut so one wide JSON column
 * does not push the rest of the row off the screen; the hover carries more of
 * it. NULL is shown as NULL, distinct from an empty string, because the
 * difference is exactly what someone previewing a table is checking for.
 *
 * `type` is the ClickHouse column type. It matters for one case: JSON output
 * sends 64-bit integers and decimals as strings, so JavaScript does not round
 * them, and without the type they would be shown as text.
 */
export function previewCell(value: unknown, type = ''): PreviewCell {
  if (value === null || value === undefined) return { kind: 'null', text: 'NULL' }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return { kind: 'number', text: String(value) }
  }
  if (typeof value === 'string' && /^(?:Nullable\()?(?:LowCardinality\()?(?:U?Int\d+|Float\d+|Decimal)/.test(type)) {
    return { kind: 'number', text: value }
  }
  const kind = typeof value === 'string' ? 'text' : 'json'
  const full = typeof value === 'string' ? value : JSON.stringify(value)
  if (full === '') return { kind: 'empty', text: '' }
  if (full.length <= CELL_CHARS) return { kind, text: full }
  return {
    kind,
    text: `${full.slice(0, CELL_CHARS)}…`,
    title: full.length > TITLE_CHARS ? `${full.slice(0, TITLE_CHARS)}…` : full,
  }
}

/** 5,450,000,000 → "5.45bn". Row counts read better compact; the exact figure is on hover. */
export function compactCount(n: number): string {
  if (!Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}bn`
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (abs >= 1e4) return `${Math.round(n / 1e3)}k`
  return n.toLocaleString('en-US')
}

export function readableBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  let v = n
  let u = 0
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024
    u++
  }
  return `${v >= 100 || u === 0 ? Math.round(v) : v.toFixed(1)} ${units[u]}`
}
