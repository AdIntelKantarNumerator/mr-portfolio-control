/**
 * Report Builder's tools: what the model may do, and what each does.
 *
 * Pure: every tool works on an engine (whose saved reports are one person's)
 * and a chat (the report in progress and the choices last offered), both
 * passed in, so tests run with no database and no model. agent.ts loads and
 * saves those around a turn.
 *
 * Why the chat keeps the report rather than the model: Open WebUI sends back
 * only what was said, never what a tool returned, so a model that had to carry
 * the report or an option's exact change from one turn to the next would lose
 * it. Here "2" or "Last 3 months" is enough; choose() looks it up.
 */
import type { Engine, Option, Patch, Result, Spec, Understanding, Validation } from './engine'

export interface ChatState {
  /** The report being built in this chat, as the engine last returned it. */
  report: Spec | null
  /** The numbered choices last shown: a question's options, a problem's fixes, or a preview's adjustments. */
  offered: Array<{ label: string; patch: Patch }>
  /** Set while a saved report is open for changes. */
  editing: { id: string; name: string } | null
}

export const emptyChat = (): ChatState => ({ report: null, offered: [], editing: null })

export interface ToolContext {
  engine: Engine
  chat: ChatState
  /** Builds the download link for a report: the portfolio's own address. */
  downloadUrl: (spec: Spec, name: string) => string
  /** What the last tool produced, for a page to draw (the Prototypes page). Chat hosts ignore it. */
  view?: View
}

/** A table as the page draws it: raw values, typed columns, so it can chart them too. */
export interface ViewTable {
  columns: Result['columns']
  rows: unknown[][]
  totals: unknown[] | null
  rowCount: number
}

/** The last thing a tool produced, in a shape a page can draw without parsing text. */
export interface View {
  kind: 'question' | 'problem' | 'ready' | 'run' | 'saved' | 'deleted' | 'data'
  /** The report's one-line summary, or the saved report's name. */
  title?: string
  question?: string
  problem?: string
  acceptsName?: boolean
  /** The numbered choices offered: a question's options, a problem's fixes, or a preview's adjustments. */
  choices?: Array<{ number: number; label: string; description?: string }>
  table?: ViewTable
  period?: string
  dataThrough?: string
  notes?: string[]
  downloadUrl?: string
  sinceLastRun?: string
  savedName?: string
  picksUpNewData?: boolean
  message?: string
}

export interface ToolDef {
  name: string
  description: string
  parameters: Record<string, unknown>
}

const PREVIEW_ROWS = 10
const RUN_ROWS = 25
const NAME_TYPES = ['top_parent', 'advertiser', 'product', 'industry', 'category', 'subcategory', 'media_type', 'media_owner', 'property']

const obj = (properties: Record<string, unknown> = {}, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false })

export const TOOLS: ToolDef[] = [
  {
    name: 'report_options',
    description: 'The report templates and building blocks: what can be filtered and broken out, measures, calculations, period choices and rules. Call once at the start of a conversation.',
    parameters: obj(),
  },
  {
    name: 'search_names',
    description: 'Find advertisers, parent companies, products, categories, media types, media owners or properties (networks, platforms) by name. Returns matches with an id, what kind of thing it is, a short description and recent spend. An empty query returns the biggest spenders.',
    parameters: obj({ query: { type: 'string' }, types: { type: 'array', items: { type: 'string', enum: NAME_TYPES } } }, ['query']),
  },
  {
    name: 'new_report',
    description: 'Start a new report in this chat, replacing any report in progress. template: advertiser_trend (spend trend), media_mix, category_share, zero_share (who is not buying on our properties) or detail_extract. Omit it to ask the user what kind of report. Returns a question, a problem or a ready preview.',
    parameters: obj({ template: { type: 'string', enum: ['advertiser_trend', 'media_mix', 'category_share', 'zero_share', 'detail_extract'] } }),
  },
  {
    name: 'change_report',
    description:
      'Change the report in progress with what the user said. names: ids from search_names (advertisers, categories, networks...). names_mode "replace" (default) switches to these names, replacing earlier ones of the same kind; "add" keeps the earlier ones. Returns a question, a problem or a ready preview.',
    parameters: obj({
      names: { type: 'array', items: { type: 'string' }, description: 'Ids from search_names.' },
      names_mode: { type: 'string', enum: ['replace', 'add'] },
      remove_names: { type: 'array', items: { type: 'string' }, description: 'Ids to take out of the report.' },
      period: {
        type: 'object',
        description: 'Rolling: {"mode":"rolling","unit":"month|quarter|year","count":N}. Year to date: {"mode":"ytd"}. Fixed: {"mode":"static","start":"YYYY-MM","end":"YYYY-MM"}.',
      },
      breakdowns: { type: 'array', items: { type: 'string', enum: NAME_TYPES }, description: 'Extra row breakdowns, such as product or media_type.' },
      columns: { type: 'string', enum: ['month', 'quarter', 'year', 'media_type', 'property', 'none'], description: 'One column per value; "none" removes the column breakdown.' },
      measures: { type: 'array', items: { type: 'string', enum: ['occurrences', 'impressions'] } },
      top: { type: 'integer', description: 'Keep only the top N rows.' },
      include_preliminary: { type: 'boolean' },
      prior_year: { type: 'boolean', description: 'Add the change vs the same period a year earlier.' },
      share_of_total: { type: 'boolean' },
    }),
  },
  {
    name: 'offer_names',
    description:
      'Ask the user which of several matching names they mean, as choices they can pick (the Report Builder page shows them as buttons). ids: 2 to 6 ids from search_names. Use whenever a name could mean more than one thing, instead of listing the options yourself. Picking one adds it to the report the way change_report would.',
    parameters: obj(
      {
        question: { type: 'string', description: 'A short question, such as "Which do you mean?"' },
        ids: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 6 },
        names_mode: { type: 'string', enum: ['replace', 'add'] },
      },
      ['question', 'ids'],
    ),
  },
  {
    name: 'choose',
    description: 'Apply one of the numbered choices last shown (a question option, a fix or an adjustment). choice: the number, or the choice words the user replied with.',
    parameters: obj({ choice: { type: 'string' } }, ['choice']),
  },
  {
    name: 'run_report',
    description: `Run the report in progress in full. Returns the first ${RUN_ROWS} rows as a table and a link to download every row as a spreadsheet.`,
    parameters: obj({ name: { type: 'string', description: 'A short name, used for the file.' } }),
  },
  {
    name: 'save_report',
    description: 'Save the report in progress under a name, to re-run any time on the latest data. replace_saved true overwrites the saved report that was opened for changes.',
    parameters: obj({ name: { type: 'string' }, replace_saved: { type: 'boolean' } }, ['name']),
  },
  { name: 'list_saved_reports', description: "The user's saved reports, each with a one-line summary.", parameters: obj() },
  {
    name: 'open_saved_report',
    description: 'Open a saved report for changes (by name, part of a name, or id). It becomes the report in progress.',
    parameters: obj({ report: { type: 'string' } }, ['report']),
  },
  {
    name: 'run_saved_report',
    description: 'Re-run a saved report on the data loaded now (by name, part of a name, or id). Says what changed since the last run, and returns a table and a download link.',
    parameters: obj({ report: { type: 'string' } }, ['report']),
  },
  {
    name: 'delete_saved_report',
    description: 'Permanently delete a saved report. Only after the user has clearly said yes; confirmed must be true.',
    parameters: obj({ report: { type: 'string' }, confirmed: { type: 'boolean' } }, ['report', 'confirmed']),
  },
  {
    name: 'demo_load_next_month',
    description: 'Demonstration only: pretend the next month of data has loaded, so a saved report re-run shows its period moving. Only when the user explicitly asks.',
    parameters: obj(),
  },
]

/** What a tool returns when the report changed: one of question, problem or ready. */
function status(ctx: ToolContext, v: Validation) {
  const { chat, engine } = ctx
  chat.report = v.spec
  const numbered = (opts: Option[]) => {
    chat.offered = opts.map((o) => ({ label: o.label, patch: o.patch }))
    return opts.map((o, i) => ({ number: i + 1, label: o.label, ...(o.description ? { description: o.description } : {}) }))
  }
  if (v.errors.length) {
    const e = v.errors[0]!
    const fixes = numbered(e.fixes)
    ctx.view = { kind: 'problem', problem: e.message, choices: fixes }
    return { status: 'problem', problem: e.message, fixes }
  }
  if (v.questions.length) {
    const q = v.questions[0]!
    const choices = numbered(q.options)
    ctx.view = { kind: 'question', question: q.prompt, acceptsName: q.kind === 'entity', choices }
    return { status: 'question', question: q.prompt, accepts_typed_name: q.kind === 'entity', choices }
  }
  const preview = engine.preview(v.spec, PREVIEW_ROWS)
  const adjustments = numbered(v.refinements.slice(0, 7))
  const notes = Array.from(new Set(v.warnings.concat(preview.notes)))
  ctx.view = {
    kind: 'ready',
    title: preview.summary,
    table: tableOf(preview),
    period: `${preview.period.label} (${preview.period.how})`,
    notes,
    choices: adjustments,
  }
  return {
    status: 'ready',
    summary: preview.summary,
    period: `${preview.period.label} (${preview.period.how})`,
    rows_in_report: preview.row_count,
    table_markdown: engine.markdown(preview, PREVIEW_ROWS),
    notes,
    large_extract: v.delivery === 'file' ? 'The full report is large; it will be a download.' : undefined,
    adjustments,
    editing_saved_report: chat.editing?.name,
  }
}

const tableOf = (r: Result): ViewTable => ({ columns: r.columns, rows: r.rows, totals: r.totals, rowCount: r.row_count })

function shown(ctx: ToolContext, result: Result, spec: Spec, name: string) {
  ctx.view = {
    kind: 'run',
    title: result.summary,
    table: { ...tableOf(result), rows: result.rows.slice(0, RUN_ROWS) },
    period: `${result.period.label} (${result.period.how})`,
    dataThrough: result.data_through_label,
    notes: result.notes,
    downloadUrl: ctx.downloadUrl(spec, name),
  }
  return {
    summary: result.summary,
    period: `${result.period.label} (${result.period.how})`,
    data_through: result.data_through_label,
    rows_in_report: result.row_count,
    table_markdown: ctx.engine.markdown(result, RUN_ROWS),
    notes: result.notes,
    download_url: ctx.downloadUrl(spec, name),
  }
}

function needReport(ctx: ToolContext): Spec {
  if (!ctx.chat.report) throw new Error('There is no report in progress in this chat. Start one with new_report.')
  return ctx.chat.report
}

function readyReport(ctx: ToolContext): Spec {
  const v = ctx.engine.validate(needReport(ctx))
  if (!v.ok) throw new Error('The report is not finished yet: ' + (v.errors[0]?.message ?? v.questions[0]?.prompt) + ' Ask that first.')
  return v.spec
}

const str = (x: unknown) => (typeof x === 'string' ? x : '')
const strs = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : [])

/** Run one tool. Throws Error with a message the model can act on. */
export function runTool(ctx: ToolContext, name: string, input: Record<string, unknown>): unknown {
  const { engine, chat } = ctx
  switch (name) {
    case 'report_options':
      return engine.catalog()

    case 'search_names': {
      const types = strs(input.types).filter((t) => NAME_TYPES.includes(t))
      return { matches: engine.search(str(input.query), { types: types.length ? types : undefined, limit: 6 }) }
    }

    case 'new_report': {
      const tpl = engine.catalog().templates.find((t) => t.id === input.template)
      chat.editing = null
      return status(ctx, engine.validate(tpl ? structuredClone(tpl.spec) : {}))
    }

    case 'change_report': {
      const report = needReport(ctx)
      const u: Understanding = { entities: [], rows: [], measures: [] }
      for (const id of strs(input.names)) {
        const type = id.split(':')[0]!
        if (NAME_TYPES.includes(type)) u.entities!.push({ id, type })
      }
      u.add = input.names_mode === 'add'
      if (input.period && typeof input.period === 'object') u.time = input.period as Record<string, unknown>
      u.rows = strs(input.breakdowns).filter((d) => NAME_TYPES.includes(d))
      if (typeof input.columns === 'string' && input.columns !== 'none') u.columns = input.columns
      u.measures = strs(input.measures).filter((m) => m === 'occurrences' || m === 'impressions')
      if (typeof input.top === 'number' && input.top > 0) u.top_n = Math.round(input.top)
      if (input.prior_year === true) u.yoy = true
      if (input.share_of_total === true) u.share = true
      if (input.include_preliminary === true) u.preliminary = true
      const patch = engine.patchFromUnderstanding(report, u)
      patch.set ??= {}
      patch.remove ??= {}
      if (input.columns === 'none') patch.set.columns = null
      if (input.include_preliminary === false) patch.set['options.final_only'] = true
      if (input.prior_year === false || input.share_of_total === false) {
        patch.remove.calcs = [...(input.prior_year === false ? ['yoy'] : []), ...(input.share_of_total === false ? ['share'] : [])]
      }
      for (const id of strs(input.remove_names)) {
        const key = `filters.${id.split(':')[0]}`
        patch.remove[key] = [...(patch.remove[key] ?? []), id]
      }
      return status(ctx, engine.validate(report, patch))
    }

    case 'offer_names': {
      const report = needReport(ctx)
      const ids = strs(input.ids).filter((id) => NAME_TYPES.includes(id.split(':')[0]!)).slice(0, 6)
      if (ids.length < 2) throw new Error('Give at least two ids from search_names.')
      const question = str(input.question).trim() || 'Which do you mean?'
      const add = input.names_mode === 'add'
      const choices = ids.map((id, i) => {
        const type = id.split(':')[0]!
        const label = engine.labelOf(type, id)
        const hit = engine.search(label, { types: [type], limit: 10 }).find((h) => h.id === id)
        chat.offered[i] = { label, patch: engine.patchFromUnderstanding(report, { entities: [{ id, type }], add }) }
        return { number: i + 1, label, description: hit ? `${hit.type_label}${hit.context && hit.context !== hit.type_label ? ` · ${hit.context}` : ''}` : undefined }
      })
      chat.offered.length = choices.length
      ctx.view = { kind: 'question', question, acceptsName: true, choices }
      return { status: 'question', question, choices }
    }

    case 'choose': {
      const said = str(input.choice).trim().toLowerCase().replace(/^#/, '').replace(/[.)]$/, '')
      if (!chat.offered.length) throw new Error('No choices are waiting. Ask the user what they want, or start with new_report.')
      const n = Number(said)
      const pick =
        Number.isInteger(n) && n >= 1 && n <= chat.offered.length
          ? chat.offered[n - 1]
          : chat.offered.find((o) => o.label.toLowerCase() === said) ?? chat.offered.find((o) => said && o.label.toLowerCase().includes(said))
      if (!pick) throw new Error(`"${input.choice}" is not one of the choices last shown: ${chat.offered.map((o, i) => `${i + 1}. ${o.label}`).join('; ')}.`)
      return status(ctx, engine.validate(chat.report ?? {}, pick.patch))
    }

    case 'run_report': {
      const spec = readyReport(ctx)
      const name = str(input.name).trim() || chat.editing?.name || 'Report'
      return shown(ctx, engine.run(spec), spec, name)
    }

    case 'save_report': {
      const spec = readyReport(ctx)
      const replace = input.replace_saved === true && chat.editing
      const saved = engine.saveReport(str(input.name).trim() || chat.editing?.name || 'Untitled report', spec, replace ? chat.editing!.id : undefined)
      chat.editing = { id: saved.id, name: saved.name }
      ctx.view = { kind: 'saved', savedName: saved.name, title: saved.summary, picksUpNewData: saved.moves_with_new_data }
      return { saved: saved.name, replaced: Boolean(replace), summary: saved.summary, picks_up_new_data: saved.moves_with_new_data }
    }

    case 'list_saved_reports':
      return {
        data_through: engine.availability().final_through_label,
        reports: engine.listSaved().map((r) => ({ name: r.name, summary: r.summary, picks_up_new_data: r.moves_with_new_data, last_run: r.last_run?.period_label ?? 'never' })),
      }

    case 'open_saved_report': {
      const found = engine.findSaved(str(input.report))
      if (!found) throw new Error(`No saved report matches "${input.report}". list_saved_reports shows what there is.`)
      const rec = engine.getSaved(found.id)
      chat.editing = { id: rec.id, name: rec.name }
      return { opened: rec.name, ...status(ctx, engine.validate(rec.spec)) }
    }

    case 'run_saved_report': {
      const found = engine.findSaved(str(input.report))
      if (!found) throw new Error(`No saved report matches "${input.report}". list_saved_reports shows what there is.`)
      const r = engine.runSaved(found.id)
      const spec = engine.getSaved(found.id).spec
      const out = { report: r.saved_report.name, since_last_run: r.since_last_run.text, ...shown(ctx, r, spec, r.saved_report.name) }
      ctx.view = { ...ctx.view!, savedName: r.saved_report.name, sinceLastRun: r.since_last_run.text }
      return out
    }

    case 'delete_saved_report': {
      if (input.confirmed !== true) throw new Error('Ask the user to confirm first; deleting cannot be undone.')
      const found = engine.findSaved(str(input.report))
      if (!found) throw new Error(`No saved report matches "${input.report}".`)
      if (chat.editing?.id === found.id) chat.editing = null
      const deleted = engine.deleteSaved(found.id).name
      ctx.view = { kind: 'deleted', savedName: deleted }
      return { deleted }
    }

    case 'demo_load_next_month': {
      const through = engine.advanceData(1).final_through_label
      ctx.view = { kind: 'data', message: `New data arrived. Final data now runs through ${through}.` }
      return { final_data_through: through }
    }

    default:
      throw new Error(`Unknown tool ${name}.`)
  }
}

/** A short, plain progress line for each tool, shown in Open WebUI's collapsible "working" line. */
export function progressNote(name: string): string {
  switch (name) {
    case 'search_names':
      return 'Looking up names'
    case 'run_report':
    case 'run_saved_report':
      return 'Running the report'
    case 'save_report':
      return 'Saving'
    case 'list_saved_reports':
    case 'open_saved_report':
      return 'Opening your saved reports'
    case 'report_options':
      return 'Reading the report options'
    default:
      return 'Updating the report'
  }
}
