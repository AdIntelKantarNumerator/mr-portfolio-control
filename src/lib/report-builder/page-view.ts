/**
 * What the Report Builder page shows beside the chat: the report being built,
 * in plain words, and the person's saved reports. Pure, from the engine and
 * the chat's state, so it is the same whatever produced the last change.
 */
import type { Engine, Spec } from './engine'
import type { ChatState } from './tools'

interface ReportSpec extends Spec {
  template?: string
  rows?: string[]
  columns?: string | null
  measures?: string[]
  calcs?: string[]
  filters?: Record<string, string[]>
  zero_share?: { mine: string[] } | null
  time?: { mode?: string; unit?: string; count?: number; start?: string; end?: string } | null
  options?: { final_only?: boolean; top_n?: number | null }
}

export interface ReportPanel {
  /** A suggested name, for saving. */
  name: string
  /** Set while a saved report is open for changes. */
  editing: string | null
  status: 'empty' | 'waiting' | 'problem' | 'ready'
  statusText: string
  rows: Array<{ label: string; value: string }>
  period: string | null
  picksUpNewData: boolean
}

/** "Toyota & Ford media mix", from the report's subject and template. */
export function suggestName(engine: Engine, spec: ReportSpec): string {
  const tpl = engine.catalog().templates.find((t) => t.id === spec.template)
  const names: string[] = []
  for (const [dim, ids] of Object.entries(spec.filters ?? {})) for (const id of ids) names.push(engine.labelOf(dim, id))
  for (const id of spec.zero_share?.mine ?? []) names.push(engine.labelOf('property', id))
  const subject = names.length ? names.slice(0, 2).join(' & ') + (names.length > 2 ? ` +${names.length - 2}` : '') : 'All advertisers'
  return `${subject} ${tpl ? tpl.label.toLowerCase() : 'report'}`
}

export function describeReport(engine: Engine, chat: ChatState): ReportPanel {
  const spec = (chat.report ?? {}) as ReportSpec
  if (!chat.report || !spec.rows?.length) {
    return { name: '', editing: chat.editing?.name ?? null, status: 'empty', statusText: 'Nothing chosen yet', rows: [], period: null, picksUpNewData: false }
  }
  const v = engine.validate(spec)
  const s = v.spec as ReportSpec
  const cat = engine.catalog() as unknown as {
    dimensions: Array<{ key: string; label: string }>
    measures: Array<{ key: string; label: string }>
    calcs: Array<{ key: string; label: string }>
  }
  const dim = (k: string) => cat.dimensions.find((d) => d.key === k)?.label ?? k
  const filters = Object.entries(s.filters ?? {}).map(([k, ids]) => ids.map((id) => engine.labelOf(k, id)).join(', '))
  if (s.zero_share) filters.unshift(`Not buying on: ${s.zero_share.mine.map((id) => engine.labelOf('property', id)).join(', ') || 'not chosen yet'}`)
  const t = s.time
  const period = !t
    ? null
    : t.mode === 'rolling'
      ? `Last ${(t.count ?? 1) > 1 ? `${t.count} ` : ''}complete ${t.unit}${(t.count ?? 1) > 1 ? 's' : ''}`
      : t.mode === 'ytd'
        ? 'Year to date'
        : `${engine.labelOf('month', t.start ?? '')} to ${engine.labelOf('month', t.end ?? '')}`
  const measures = (s.measures ?? [])
    .map((m) => cat.measures.find((x) => x.key === m)?.label ?? m)
    .concat((s.calcs ?? []).map((c) => cat.calcs.find((x) => x.key === c)?.label ?? c))
  const status: ReportPanel['status'] = v.errors.length ? 'problem' : v.questions.length ? 'waiting' : 'ready'
  const rows = [
    { label: 'Showing', value: measures.join(', ') },
    { label: 'Broken out by', value: (s.rows ?? []).map(dim).join(' › ') + (s.columns ? `, with a column per ${dim(s.columns).toLowerCase()}` : '') },
    { label: 'Limited to', value: filters.length ? filters.join(' · ') : 'Everything' },
    { label: 'Data', value: s.options?.final_only === false ? 'Final and preliminary' : 'Final only' },
  ]
  if (s.options?.top_n) rows.push({ label: 'Rows kept', value: `Top ${s.options.top_n}` })
  return {
    name: chat.editing?.name ?? suggestName(engine, s),
    editing: chat.editing?.name ?? null,
    status,
    statusText: status === 'problem' ? 'Needs a fix' : status === 'waiting' ? 'Waiting on your answer' : `Ready · ${(v.row_count ?? 0).toLocaleString('en-US')} ${v.row_count === 1 ? 'row' : 'rows'}`,
    rows,
    period,
    picksUpNewData: Boolean(t && t.mode !== 'static'),
  }
}

export interface SavedItem {
  id: string
  name: string
  summary: string
  picksUpNewData: boolean
  lastRun: string | null
}

export function savedList(engine: Engine): SavedItem[] {
  return engine.listSaved().map((r) => ({ id: r.id, name: r.name, summary: r.summary, picksUpNewData: r.moves_with_new_data, lastRun: r.last_run?.period_label ?? null }))
}
