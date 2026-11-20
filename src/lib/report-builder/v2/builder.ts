/**
 * Report Builder V2 (20 November 2026): the report in progress as the
 * right-hand builder draws it, and edits from that builder applied with no
 * model involved.
 *
 * V1 described the report in words (page-view.ts). V2 shows it as the
 * selections themselves, every field on one screen, so a person can change
 * any of them by hand or keep going in the chat. Both write the same thing:
 * the chat's report, which the engine validates on every change. So the chat
 * and the builder can never disagree; the model reads what the builder set
 * through its tools, and the builder redraws after every model turn.
 *
 * Nothing here calls a model. Opening, editing, running, exporting and
 * scheduling a report all work with no model configured.
 */
import type { Patch, Spec, Validation } from '../engine'
import type { ReportEngine } from '../engines'
import { templatesFor, type ChatState } from '../tools'

export interface Named {
  id: string
  label: string
  /** "Property", "Media type": what kind of thing it is. */
  kind: string
}

export interface BuilderState {
  status: 'empty' | 'waiting' | 'problem' | 'ready'
  statusText: string
  rowCount: number | null
  /** Set while a saved report is open: its id and name. */
  editing: { id: string; name: string } | null
  /** A suggested name, for saving. */
  name: string
  template: { id: string; label: string; description: string } | null
  rows: Array<{ key: string; label: string; na: boolean }>
  columns: { key: string; label: string; na: boolean } | null
  measures: string[]
  calcs: string[]
  filters: Array<{ dim: string; label: string; na: boolean; items: Named[] }>
  /** Reports set around the person's own properties (zero share and the rest) or brands (comparisons). */
  sides: null | {
    kind: 'zero' | 'compare'
    mode: string
    mineLabel: string
    versusLabel: string | null
    mine: Named[]
    versus: Named[]
    all: boolean
  }
  time: { mode: string; unit?: string; count?: number; start?: string; end?: string } | null
  periodText: string | null
  finalOnly: boolean
  topN: number | null
  errors: Array<{ message: string; fixes: Array<{ label: string; patch: Patch }> }>
  question: string | null
  warnings: string[]
}

export interface BuilderCatalog {
  templates: Array<{ id: string; label: string; description: string }>
  dimensions: Array<{ key: string; label: string; group: string; groupLabel: string; canFilter: boolean; canBeColumns: boolean }>
  measures: Array<{ key: string; label: string; note?: string }>
  calcs: Array<{ key: string; label: string; note?: string }>
  dataThrough: string
  prelimThrough: string
  earliest: string
}

type Cat = {
  templates: Array<{ id: string; label: string; description: string; spec: Spec }>
  dimensions: Array<{ key: string; label: string; group: string; group_label: string; can_filter: boolean; can_be_columns: boolean }>
  measures: Array<{ key: string; label: string; note?: string }>
  calcs: Array<{ key: string; label: string; note?: string }>
}

type S = Spec & {
  template?: string
  rows?: string[]
  columns?: string | null
  measures?: string[]
  calcs?: string[]
  filters?: Record<string, string[]>
  zero_share?: { mine: string[]; versus?: string[]; all?: boolean; mode?: string } | null
  compare?: { mine: string[]; rivals: string[] } | null
  time?: BuilderState['time']
  options?: { final_only?: boolean; top_n?: number | null }
}

const KIND: Record<string, string> = {
  property: 'Property',
  media_type: 'Media type',
  media_owner: 'Media owner',
  market: 'Market',
  advertiser: 'Advertiser',
  top_parent: 'Parent',
  product: 'Product',
  industry: 'Industry',
  category: 'Category',
  subcategory: 'Subcategory',
}

export async function builderCatalog(engine: ReportEngine, chat: Pick<ChatState, 'mode' | 'v2'>): Promise<BuilderCatalog> {
  const c = (await engine.catalog()) as unknown as Cat
  const a = (await engine.availability()) as { final_through_label: string; preliminary_through_label: string; earliest_label: string }
  const ids = templatesFor(chat)
  return {
    templates: ids.map((id) => c.templates.find((t) => t.id === id)).filter((t): t is Cat['templates'][number] => Boolean(t)).map((t) => ({ id: t.id, label: t.label, description: t.description })),
    dimensions: c.dimensions.map((d) => ({ key: d.key, label: d.label, group: d.group, groupLabel: d.group_label, canFilter: d.can_filter, canBeColumns: d.can_be_columns })),
    measures: c.measures,
    calcs: c.calcs,
    dataThrough: a.final_through_label,
    prelimThrough: a.preliminary_through_label,
    earliest: a.earliest_label,
  }
}

/** The dimensions a "cannot be combined" problem is about: the ones its fixes would drop. */
function clashing(v: Validation, spec: S): Set<string> {
  const out = new Set<string>()
  for (const e of v.errors) {
    if (e.code !== 'cannot_combine') continue
    for (const f of e.fixes) {
      const set = f.patch.set ?? {}
      const kept = set.rows as string[] | undefined
      if (kept) for (const r of spec.rows ?? []) if (!kept.includes(r)) out.add(r)
      if ('columns' in set && set.columns === null && spec.columns) out.add(spec.columns)
      for (const k of Object.keys(set)) if (k.startsWith('filters.') && set[k] === null) out.add(k.slice(8))
    }
  }
  return out
}

export async function builderState(engine: ReportEngine, chat: ChatState, suggestName: (s: Spec) => Promise<string>): Promise<BuilderState> {
  const empty: BuilderState = {
    status: 'empty',
    statusText: 'Pick a report type to start',
    rowCount: null,
    editing: chat.editing,
    name: '',
    template: null,
    rows: [],
    columns: null,
    measures: [],
    calcs: [],
    filters: [],
    sides: null,
    time: null,
    periodText: null,
    finalOnly: true,
    topN: null,
    errors: [],
    question: null,
    warnings: [],
  }
  if (!chat.report || !((chat.report as S).rows ?? []).length) return empty
  const v = await engine.validate(chat.report)
  const s = v.spec as S
  await engine.ensureLabels(s)
  const cat = (await engine.catalog()) as unknown as Cat
  const dimLabel = (k: string) => cat.dimensions.find((d) => d.key === k)?.label ?? k
  const na = clashing(v, s)
  const named = (id: string): Named => {
    const dim = id.split(':')[0]!
    return { id, label: engine.labelOf(dim, id), kind: KIND[dim] ?? dimLabel(dim) }
  }
  const tpl = cat.templates.find((t) => t.id === s.template)

  let sides: BuilderState['sides'] = null
  const z = s.zero_share
  if (z) {
    const mode = z.mode ?? 'zero'
    const words: Record<string, [string, string | null]> = {
      zero: ['Your properties (not buying here)', 'Competing properties (buying here)'],
      wallet: ['Your properties', 'Against'],
      mine: ['Your properties', null],
      theirs: ['Your properties (not on)', 'Competitors'],
    }
    const [mineLabel, versusLabel] = words[mode] ?? words.zero!
    sides = { kind: 'zero', mode, mineLabel, versusLabel, mine: z.mine.map(named), versus: (z.versus ?? []).map(named), all: Boolean(z.all) }
  } else if (s.compare) {
    sides = { kind: 'compare', mode: 'compare', mineLabel: 'Your brands', versusLabel: 'Competitors', mine: s.compare.mine.map(named), versus: s.compare.rivals.map(named), all: false }
  }

  const t = s.time ?? null
  const periodText = !t
    ? null
    : t.mode === 'rolling'
      ? `Last ${(t.count ?? 1) > 1 ? `${t.count} ` : ''}complete ${t.unit ?? 'month'}${(t.count ?? 1) > 1 ? 's' : ''}`
      : t.mode === 'ytd'
        ? 'Year to date'
        : `${t.start ?? '?'} to ${t.end ?? '?'}`

  const status: BuilderState['status'] = v.errors.length ? 'problem' : v.questions.length ? 'waiting' : 'ready'
  return {
    status,
    statusText: status === 'problem' ? 'Needs a fix' : status === 'waiting' ? 'Needs an answer' : `Ready · ${(v.row_count ?? 0).toLocaleString('en-US')} ${v.row_count === 1 ? 'row' : 'rows'}`,
    rowCount: v.row_count,
    editing: chat.editing,
    name: chat.editing?.name ?? (await suggestName(s)),
    template: tpl ? { id: tpl.id, label: tpl.label, description: tpl.description } : null,
    rows: (s.rows ?? []).map((k) => ({ key: k, label: dimLabel(k), na: na.has(k) })),
    columns: s.columns ? { key: s.columns, label: dimLabel(s.columns), na: na.has(s.columns) } : null,
    measures: s.measures ?? [],
    calcs: s.calcs ?? [],
    filters: Object.entries(s.filters ?? {})
      .filter(([, ids]) => ids.length)
      .map(([dim, ids]) => ({ dim, label: dimLabel(dim), na: na.has(dim), items: ids.map(named) })),
    sides,
    time: t,
    periodText,
    finalOnly: s.options?.final_only !== false,
    topN: s.options?.top_n ?? null,
    errors: v.errors.map((e) => ({ message: e.message, fixes: e.fixes.map((f) => ({ label: f.label, patch: f.patch })) })),
    question: v.questions[0]?.prompt ?? null,
    warnings: v.warnings,
  }
}

// ---------------------------------------------------------------- edits from the builder

/** The paths the builder may set. Anything else in a patch from the page is dropped. */
const PATH = /^(rows|columns|measures|calcs|time|options\.final_only|options\.top_n|filters\.[a-z_]{2,30}|zero_share\.(mine|versus|all|own)|compare\.(mine|rivals|own))$/

const cleanValue = (v: unknown): unknown => {
  if (v === null || typeof v === 'boolean' || typeof v === 'number') return v
  if (typeof v === 'string') return v.slice(0, 120)
  if (Array.isArray(v)) return v.slice(0, 200).map((x) => (typeof x === 'string' ? x.slice(0, 120) : null)).filter((x) => x !== null)
  if (v && typeof v === 'object') {
    // Only a period is an object: mode, unit, count, start, end.
    const o = v as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const k of ['mode', 'unit', 'start', 'end']) if (typeof o[k] === 'string') out[k] = (o[k] as string).slice(0, 20)
    if (typeof o.count === 'number') out.count = Math.max(1, Math.min(60, Math.round(o.count)))
    return out
  }
  return undefined
}

/** A patch from the page, kept to the builder's own paths and plain values. */
export function cleanPatch(raw: unknown): Patch | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const p = raw as Record<string, unknown>
  const out: Patch = {}
  for (const part of ['set', 'add', 'remove'] as const) {
    const o = p[part]
    if (!o || typeof o !== 'object' || Array.isArray(o)) continue
    const kept: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(o as Record<string, unknown>).slice(0, 30)) {
      if (!PATH.test(k)) continue
      const c = cleanValue(v)
      if (c === undefined) continue
      if (part !== 'set' && !Array.isArray(c)) continue
      kept[k] = c
    }
    if (Object.keys(kept).length) (out as Record<string, unknown>)[part] = kept
  }
  return Object.keys(out).length ? out : null
}

/**
 * Switching the report type from the builder: the new type's layout, keeping
 * who and what the report is about (its filters, its own brands or
 * properties where the new type has the same kind) and its options.
 */
export function switchTemplate(current: Spec | null, tpl: { spec: Spec }): Spec {
  const cur = (current ?? {}) as S
  const next = structuredClone(tpl.spec) as S
  if (cur.filters) next.filters = structuredClone(cur.filters)
  if (cur.options) next.options = structuredClone(cur.options)
  if (next.compare && cur.compare) next.compare = { ...next.compare, mine: cur.compare.mine, rivals: cur.compare.rivals }
  if (next.zero_share && cur.zero_share) next.zero_share = { ...next.zero_share, mine: cur.zero_share.mine, versus: cur.zero_share.versus ?? [], all: cur.zero_share.all }
  return next
}

/** Rows or columns a patch asks for that this data does not have (the sample has no broadcast calendar, markets or days). */
export function unknownFields(patch: Patch, known: Iterable<string>): string[] {
  const k = new Set(known)
  const asked = [...((patch.set?.rows as string[] | undefined) ?? []), ...((patch.add?.rows as string[] | undefined) ?? []), ...(typeof patch.set?.columns === 'string' ? [patch.set.columns] : [])]
  return asked.filter((d) => !k.has(d))
}
