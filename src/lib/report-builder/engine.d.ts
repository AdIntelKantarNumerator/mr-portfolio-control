/**
 * Types for engine.js, the plain-JavaScript report engine. Only what the
 * portfolio calls is typed; a report spec stays an open record, because the
 * engine owns its shape and checks it (validate) on every step.
 */
export type Spec = Record<string, unknown>
export interface Patch {
  set?: Record<string, unknown>
  add?: Record<string, unknown[]>
  remove?: Record<string, unknown[]>
}
export interface Column {
  key: string
  label: string
  type: 'text' | 'money' | 'int' | 'pct' | 'change'
  /** With a column breakdown: the value this column belongs to (a month, a media type). */
  colId?: string
  /** The heading several measures share; the page stacks them in one cell. */
  group?: string
  measure?: string
}
export interface Result {
  columns: Column[]
  rows: unknown[][]
  /** Each row's ids (dimension:id, or the period), for drilling into it. */
  keys?: string[][]
  totals: unknown[] | null
  row_count: number
  rows_shown: number
  total: number
  total_measure: string
  period: { start: string; end: string; label: string; how: string; moves_with_new_data: boolean }
  data_through: string
  data_through_label: string
  summary: string
  notes: string[]
}
export interface Option {
  label: string
  description?: string
  patch: Patch
}
export interface Validation {
  ok: boolean
  spec: Spec & { rows: string[]; filters: Record<string, string[]>; zero_share?: { mine: string[] } }
  summary: string | null
  errors: Array<{ code: string; message: string; fixes: Option[] }>
  warnings: string[]
  questions: Array<{ id: string; prompt: string; kind: 'choice' | 'entity'; entity_types?: string[]; patch_path?: string; options: Option[] }>
  refinements: Option[]
  row_count: number | null
  delivery: 'inline' | 'file'
}
export interface SavedSummary {
  id: string
  name: string
  summary: string
  moves_with_new_data: boolean
  last_run: { period_label: string; total: number } | null
  /** Brought in from a 360 Explore report: where from, and what the conversion changed. */
  imported?: { client: string; user: string; report: string; type: string; imported: string; notes: Array<{ impact: string; what: string; why: string; did: string }> }
}
export interface Understanding {
  template?: string
  entities?: Array<{ id: string; type: string; label?: string }>
  time?: Record<string, unknown>
  rows?: string[]
  columns?: string | null
  measures?: string[]
  top_n?: number
  yoy?: boolean
  share?: boolean
  preliminary?: boolean
  add?: boolean
}
export interface EngineState {
  saved: unknown[]
  offset: number
  seq: number
}
export interface Engine {
  catalog(): Record<string, unknown> & { templates: Array<{ id: string; label: string; description: string; spec: Spec }> }
  availability(): { final_through_label: string; preliminary_through_label: string; earliest_label: string }
  search(query: string, opts?: { types?: string[]; limit?: number }): Array<{ id: string; type: string; type_label: string; label: string; context: string; spend_last_12_months: number }>
  validate(spec: Spec, patch?: Patch | null): Validation
  preview(spec: Spec, limit?: number): Result
  run(spec: Spec, opts?: { limit?: number }): Result
  csv(result: Result): string
  markdown(result: Result, max?: number): string
  fmtCell(type: string, value: unknown): string
  saveReport(name: string, spec: Spec, id?: string): SavedSummary
  listSaved(): SavedSummary[]
  getSaved(id: string): SavedSummary & { spec: Spec }
  findSaved(text: string): { id: string; name: string } | null
  runSaved(idOrName: string, opts?: { limit?: number }): Result & { saved_report: { id: string; name: string }; since_last_run: { text: string; period_changed?: boolean } }
  deleteSaved(id: string): { deleted: string; name: string }
  advanceData(n?: number): { final_through_label: string }
  resetData(): { final_through_label: string }
  patchFromUnderstanding(spec: Spec, u: Understanding): Patch
  labelOf(dim: string, id: string): string
}
declare const ReportEngine: {
  create(config?: { store?: { load(): EngineState; save(s: EngineState): void }; now?: () => string }): Engine
}
export default ReportEngine
