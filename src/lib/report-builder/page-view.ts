/**
 * What the Report Builder page shows beside the chat: the report being built,
 * in plain words, and the person's saved reports. Pure, from the engine and
 * the chat's state, so it is the same whatever produced the last change.
 */
import type { Spec } from './engine'
import type { ReportEngine } from './engines'
import type { ChatState } from './tools'

interface ReportSpec extends Spec {
  template?: string
  rows?: string[]
  columns?: string | null
  measures?: string[]
  calcs?: string[]
  filters?: Record<string, string[]>
  zero_share?: { mine: string[]; versus?: string[]; all?: boolean; mode?: string } | null
  compare?: { mine: string[]; rivals: string[] } | null
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
  /** groups: the same value in parts, each under a name the page shows in bold. */
  rows: Array<{ label: string; value: string; groups?: Array<{ label: string; items: string }> }>
  period: string | null
  picksUpNewData: boolean
}

/** "Toyota & Ford media mix", from the report's subject and template. */
export async function suggestName(engine: ReportEngine, spec: ReportSpec): Promise<string> {
  await engine.ensureLabels(spec)
  const tpl = (await engine.catalog()).templates.find((t) => t.id === spec.template)
  const names: string[] = []
  for (const [dim, ids] of Object.entries(spec.filters ?? {})) for (const id of ids) names.push(engine.labelOf(dim, id))
  for (const id of [...(spec.zero_share?.mine ?? []), ...(spec.compare?.mine ?? [])]) names.push(engine.labelOf(id.split(':')[0]!, id))
  const subject = names.length ? names.slice(0, 2).join(' & ') + (names.length > 2 ? ` +${names.length - 2}` : '') : 'All advertisers'
  return `${subject} ${tpl ? tpl.label.toLowerCase() : 'report'}`
}

export async function describeReport(engine: ReportEngine, chat: ChatState): Promise<ReportPanel> {
  const spec = (chat.report ?? {}) as ReportSpec
  if (!chat.report || !spec.rows?.length) {
    return { name: '', editing: chat.editing?.name ?? null, status: 'empty', statusText: 'Nothing chosen yet', rows: [], period: null, picksUpNewData: false }
  }
  const v = await engine.validate(spec)
  const s = v.spec as ReportSpec
  await engine.ensureLabels(s)
  const cat = (await engine.catalog()) as unknown as {
    dimensions: Array<{ key: string; label: string }>
    measures: Array<{ key: string; label: string }>
    calcs: Array<{ key: string; label: string }>
  }
  const dim = (k: string) => cat.dimensions.find((d) => d.key === k)?.label ?? k
  // Each kind of filter under its own name ("Market: National, Laredo"); a name GPC repeats (three products called Truly) once.
  const names = (labels: string[]) => [...new Set(labels)].join(', ')
  const filters: Array<{ label: string; items: string }> = Object.entries(s.filters ?? {})
    .filter(([, ids]) => ids.length)
    .map(([k, ids]) => ({ label: dim(k), items: names(ids.map((id) => engine.labelOf(k, id))) }))
  // Whose properties or brands, and who they are set against, in the words of each kind of report.
  const lab = (ids: string[] | undefined) => names((ids ?? []).map((id) => engine.labelOf(id.split(':')[0]!, id)))
  const f = (label: string, items: string) => ({ label, items })
  const z = s.zero_share
  if (z) {
    const mine = lab(z.mine) || 'not chosen yet'
    const vs = lab(z.versus) || (z.all ? 'every other property' : 'not chosen yet')
    const mode = z.mode ?? 'zero'
    if (mode === 'zero') filters.unshift(f('Not buying on', mine), f('Buying on', vs))
    else if (mode === 'wallet') filters.unshift(f('Yours', mine), f('Against', vs))
    else if (mode === 'mine') filters.unshift(f('Yours', mine))
    else filters.unshift(f('Competitors', vs), f('Not on', mine))
  }
  // The engine keeps a report to the US unless it names countries or breaks out by country: say so.
  if (!s.filters?.country?.length && !(s.rows ?? []).includes('country') && s.columns !== 'country') filters.push(f('Country', 'United States'))
  if (s.compare) filters.unshift(f('Yours', lab(s.compare.mine) || 'not chosen yet'), f('Competitors', lab(s.compare.rivals) || 'not chosen yet'))
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
  const rows: ReportPanel['rows'] = [
    { label: 'Showing', value: measures.join(', ') },
    { label: 'Broken out by', value: (s.rows ?? []).map(dim).join(' › ') + (s.columns ? `, with a column per ${dim(s.columns).toLowerCase()}` : '') },
    { label: 'Limited to', value: filters.length ? filters.map((x) => `${x.label}: ${x.items}`).join(' · ') : 'Everything', ...(filters.length ? { groups: filters } : {}) },
    { label: 'Data', value: s.options?.final_only === false ? 'Final and preliminary' : 'Final only' },
  ]
  if (s.options?.top_n) rows.push({ label: 'Rows kept', value: `Top ${s.options.top_n}` })
  return {
    name: chat.editing?.name ?? (await suggestName(engine, s)),
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
  /** Imported from 360: where from, and the changes the conversion made. */
  imported?: { client: string; user: string; report: string; type: string; imported: string; notes: Array<{ impact: string; what: string; why: string; did: string }> }
}

export async function savedList(engine: ReportEngine): Promise<SavedItem[]> {
  return (await engine.listSaved()).map((r) => ({ id: r.id, name: r.name, summary: r.summary, picksUpNewData: r.moves_with_new_data, lastRun: r.last_run?.period_label ?? null, ...(r.imported ? { imported: r.imported } : {}) }))
}
