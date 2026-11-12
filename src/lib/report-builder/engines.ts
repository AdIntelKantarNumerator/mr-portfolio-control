/**
 * Which data Report Builder reads, behind one interface.
 *
 *   live    the report engine (live-engine.ts) on the ClickHouse data adapter
 *           (data/clickhouse.ts), when REPORT_BUILDER_DATA=gpc and
 *           CLICKHOUSE_DEV_URL are set, limited to the person's entitlements
 *           (data/entitlements.ts). Every number is a query.
 *   sample  engine.js: real names, illustrative figures, all in memory. Used
 *           for tests and local work without ClickHouse.
 *
 * Both answer the same calls, all asynchronous, so the tools, the page and
 * the download never need to know which one they have.
 */
import SampleEngine, { type EngineState, type Patch, type Result, type SavedSummary, type Spec, type Understanding, type Validation } from './engine.js'
import { createLiveEngine } from './live-engine'
import { clickhouseAdapter, liveConfigured } from './data/clickhouse'
import { withEntitlements, type Entitlements } from './data/entitlements'

export interface Hit {
  id: string
  type: string
  type_label: string
  label: string
  context: string
}

export interface ReportEngine {
  live: boolean
  catalog(): Promise<Record<string, unknown> & { templates: Array<{ id: string; label: string; description: string; spec: Spec }> }>
  availability(): Promise<{ final_through_label: string; preliminary_through_label: string; earliest_label: string }>
  search(query: string, opts?: { types?: string[]; limit?: number }): Promise<Hit[]>
  validate(spec: Spec, patch?: Patch | null): Promise<Validation>
  preview(spec: Spec, limit?: number): Promise<Result>
  run(spec: Spec, opts?: { limit?: number }): Promise<Result>
  ensureLabels(spec: Spec): Promise<void>
  labelOf(dim: string, id: string): string
  contextOf(id: string): string
  saveReport(name: string, spec: Spec, id?: string): Promise<SavedSummary>
  listSaved(): Promise<SavedSummary[]>
  getSaved(id: string): Promise<SavedSummary & { spec: Spec }>
  findSaved(text: string): { id: string; name: string } | null
  runSaved(idOrName: string, opts?: { limit?: number }): Promise<Result & { saved_report: { id: string; name: string }; since_last_run: { text: string; period_changed?: boolean } }>
  deleteSaved(id: string): { deleted: string; name: string }
  patchFromUnderstanding(spec: Spec, u: Understanding): Patch
  /** Sample data only: pretend the next month has loaded. */
  advanceData?(): { final_through_label: string }
}

export interface Store {
  load(): EngineState
  save(s: EngineState): void
}

/** The sample engine, behind the same asynchronous calls. */
export function sampleEngine(store: Store): ReportEngine {
  const e = SampleEngine.create({ store })
  return {
    live: false,
    catalog: async () => e.catalog(),
    availability: async () => e.availability(),
    search: async (q, o) => e.search(q, o),
    validate: async (s, p) => e.validate(s, p),
    preview: async (s, l) => e.preview(s, l),
    run: async (s, o) => e.run(s, o),
    ensureLabels: async () => {},
    labelOf: (d, id) => e.labelOf(d, id),
    contextOf: (id) => e.search(e.labelOf(id.split(':')[0]!, id), { types: [id.split(':')[0]!], limit: 10 }).find((h) => h.id === id)?.context ?? '',
    saveReport: async (n, s, id) => e.saveReport(n, s, id),
    listSaved: async () => e.listSaved(),
    getSaved: async (id) => e.getSaved(id),
    findSaved: (t) => e.findSaved(t),
    runSaved: async (id, o) => e.runSaved(id, o),
    deleteSaved: (id) => e.deleteSaved(id),
    patchFromUnderstanding: (s, u) => e.patchFromUnderstanding(s, u),
    advanceData: () => e.advanceData(),
  }
}

// One ClickHouse adapter for the process: it caches what the data covers and the daily tables' shape.
let shared: ReturnType<typeof clickhouseAdapter> | null = null

/** Live data when this deployment is set up for it, limited to the person's entitlements; the sample otherwise. */
export function engineFor(store: Store, env: Record<string, string | undefined> = process.env, entitlements: Entitlements | null = null): ReportEngine {
  if (!liveConfigured(env)) return sampleEngine(store)
  shared ??= clickhouseAdapter()
  return createLiveEngine({ store, adapter: withEntitlements(shared, entitlements) }) as ReportEngine
}

export const dataSource = (env: Record<string, string | undefined> = process.env): 'gpc' | 'sample' => (liveConfigured(env) ? 'gpc' : 'sample')

// ---------------------------------------------------------------- formatting (the same for both)

export function fmtCell(type: string, v: unknown): string {
  if (v == null || v === '') return type === 'text' ? '' : '–'
  const n = Number(v)
  if (type === 'money') return '$' + Math.round(n).toLocaleString('en-US')
  if (type === 'int') return Math.round(n).toLocaleString('en-US')
  if (type === 'pct') return `${n.toFixed(1)}%`
  if (type === 'change') return `${n > 0 ? '+' : ''}${n.toFixed(1)}%`
  return String(v)
}

/** A ready-to-show Markdown table, so the chat model never reformats numbers. */
export function markdown(result: Result, max?: number): string {
  const cols = result.columns
  const esc = (s: unknown) => String(s).replace(/\|/g, '\\|')
  const line = (cells: unknown[]) => `| ${cells.map(esc).join(' | ')} |`
  const out = [line(cols.map((c) => c.label)), `| ${cols.map((c) => (c.type === 'text' ? '---' : '---:')).join(' | ')} |`]
  for (const r of result.rows.slice(0, max ?? result.rows.length)) out.push(line(r.map((v, i) => fmtCell(cols[i]!.type, v))))
  if (result.totals) out.push(line(result.totals.map((v, i) => (fmtCell(cols[i]!.type, v) ? `**${fmtCell(cols[i]!.type, v)}**` : ''))))
  return out.join('\n')
}

export function csv(result: Result): string {
  const esc = (v: unknown) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
  const lines = [result.columns.map((c) => esc(c.label)).join(',')]
  for (const r of result.rows) lines.push(r.map(esc).join(','))
  if (result.totals) lines.push(result.totals.map(esc).join(','))
  return `${lines.join('\r\n')}\r\n`
}
