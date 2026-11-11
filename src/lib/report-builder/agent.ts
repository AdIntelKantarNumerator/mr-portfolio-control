/**
 * One Report Builder turn, for one person in one chat.
 *
 *   load   the person's saved reports, and this chat's report in progress
 *   run    the model's tool loop (model.ts) over the tools (tools.ts)
 *   save   both back, only if they changed
 *
 * Saved reports belong to the person (report_builder_users, by email); the
 * report in progress belongs to the chat (report_builder_chats, by Open
 * WebUI's chat id), so two chats can build two reports at once.
 */
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { reportBuilderChats, reportBuilderUsers } from '@/db/schema'
import ReportEngine, { type Engine, type EngineState, type Spec } from './engine.js'
import { chooseModel, runLoop, ReportModelError, type Post, type Turn } from './model'
import { describeReport, savedList } from './page-view'
import { REPORT_BUILDER_PAGE_SKILL, REPORT_BUILDER_SKILL } from './skill'
import { TOOLS, emptyChat, progressNote, runTool, type ChatState, type ToolContext, type View } from './tools'

export const REPORT_BUILDER_MODEL_ID = 'report-builder'
export const REPORT_BUILDER_MODEL_NAME = 'Report Builder'

/** A saved report, as the person's examples start out: one to re-run on the first day. */
function starterState(engine: Engine): void {
  const sub = engine.search('Auto Insurance', { types: ['subcategory'], limit: 1 })[0]
  if (sub) engine.saveReport('Auto insurance share', { template: 'category_share', rows: ['advertiser'], measures: ['spend'], calcs: ['share'], filters: { subcategory: [sub.id] }, time: { mode: 'rolling', unit: 'month', count: 12 } })
}

/** An engine over one person's saved reports, held in memory for the turn. */
export function engineFor(state: EngineState | null): { engine: Engine; state: () => EngineState } {
  let mem: EngineState = state ?? { saved: [], offset: 0, seq: 0 }
  const engine = ReportEngine.create({ store: { load: () => mem, save: (s) => (mem = s) } })
  if (!state) starterState(engine)
  return { engine, state: () => mem }
}

export async function loadUser(email: string): Promise<EngineState | null> {
  const [row] = await db.select().from(reportBuilderUsers).where(eq(reportBuilderUsers.email, email)).limit(1)
  return (row?.state as EngineState | undefined) ?? null
}

async function saveUser(email: string, state: EngineState) {
  await db.insert(reportBuilderUsers).values({ email, state }).onConflictDoUpdate({ target: reportBuilderUsers.email, set: { state, updatedAt: new Date() } })
}

async function loadChat(chatId: string, email: string): Promise<ChatState> {
  const [row] = await db.select().from(reportBuilderChats).where(eq(reportBuilderChats.chatId, chatId)).limit(1)
  // A chat id is Open WebUI's; it is honoured only for the person who owns it.
  if (!row || row.email !== email) return emptyChat()
  return { ...emptyChat(), ...(row.state as Partial<ChatState>) }
}

async function saveChat(chatId: string, email: string, state: ChatState) {
  await db.insert(reportBuilderChats).values({ chatId, email, state }).onConflictDoUpdate({ target: reportBuilderChats.chatId, set: { email, state, updatedAt: new Date() } })
}

/** The download link for a report: the spec rides in the link, and is recomputed for whoever opens it. */
export function downloadUrl(base: string, spec: Spec, name: string): string {
  const r = Buffer.from(JSON.stringify(spec)).toString('base64url')
  return `${base.replace(/\/+$/, '')}/prototypes/report-builder/export?r=${r}&name=${encodeURIComponent(name.slice(0, 80))}`
}

export interface TurnInput {
  email: string
  /** Open WebUI's chat id; without one the person has a single running chat. */
  chatId: string | null
  turns: Turn[]
  appUrl: string
  onProgress?: (note: string) => void
  signal?: AbortSignal
  /** Stands in for the network in checks. */
  post?: Post
}

/**
 * Loads one person's saved reports and one chat's state, runs `work` on them,
 * and saves whichever changed. Every turn and every page action goes through here.
 */
async function withSession<T>(email: string, chatId: string | null, appUrl: string, work: (ctx: ToolContext) => Promise<T> | T): Promise<T> {
  const who = email.trim().toLowerCase()
  const chatKey = chatId?.trim() || `default:${who}`
  const before = await loadUser(who)
  const { engine, state } = engineFor(before)
  const chat = await loadChat(chatKey, who)
  const chatBefore = JSON.stringify(chat)
  const userBefore = JSON.stringify(state())
  const ctx: ToolContext = { engine, chat, downloadUrl: (spec, n) => downloadUrl(appUrl, spec, n) }

  const out = await work(ctx)

  if (!before || JSON.stringify(state()) !== userBefore) await saveUser(who, state())
  if (JSON.stringify(chat) !== chatBefore) await saveChat(chatKey, who, chat)
  return out
}

async function modelTurn(ctx: ToolContext, input: TurnInput, system: string): Promise<string> {
  const choice = chooseModel()
  if (!choice) throw new ReportModelError('No model is configured for Report Builder. Set REPORT_BUILDER_MODEL and REPORT_BUILDER_PROVIDERS (OpenRouter), or ANTHROPIC_API_KEY.')
  let last = ''
  return runLoop(
    {
      system,
      turns: input.turns,
      tools: TOOLS,
      exec: (name, args) => runTool(ctx, name, args),
      onTool: (name) => {
        const note = progressNote(name)
        if (note !== last) input.onProgress?.(note)
        last = note
      },
      signal: input.signal,
    },
    choice,
    input.post,
  )
}

/** Answers a turn in Open WebUI. Throws ReportModelError when no model is configured or it fails. */
export async function reportBuilderTurn(input: TurnInput): Promise<string> {
  return withSession(input.email, input.chatId, input.appUrl, (ctx) => modelTurn(ctx, input, REPORT_BUILDER_SKILL))
}

// ---------------------------------------------------------------------------
// The Prototypes page: typed messages go to the model; clicks are applied
// directly, with no model round, so a choice takes effect at once.
// ---------------------------------------------------------------------------

export type PageAction =
  | { type: 'start' }
  | { type: 'choose'; choice: string }
  | { type: 'run'; name?: string }
  | { type: 'save'; name: string; replace?: boolean }
  | { type: 'open_saved'; report: string }
  | { type: 'run_saved'; report: string }
  | { type: 'delete_saved'; report: string }
  | { type: 'demo_month' }

const ACTION_TOOL: Record<PageAction['type'], string> = {
  start: 'new_report',
  choose: 'choose',
  run: 'run_report',
  save: 'save_report',
  open_saved: 'open_saved_report',
  run_saved: 'run_saved_report',
  delete_saved: 'delete_saved_report',
  demo_month: 'demo_load_next_month',
}

function actionInput(a: PageAction): Record<string, unknown> {
  switch (a.type) {
    case 'choose':
      return { choice: a.choice }
    case 'run':
      return { name: a.name }
    case 'save':
      return { name: a.name, replace_saved: a.replace === true }
    case 'open_saved':
    case 'run_saved':
      return { report: a.report }
    case 'delete_saved':
      return { report: a.report, confirmed: true }
    default:
      return {}
  }
}

/** What the assistant says after a click: the page shows the rest. */
function cannedText(view: View | undefined): string {
  if (!view) return 'Done.'
  switch (view.kind) {
    case 'question':
      return view.question ?? 'What next?'
    case 'problem':
      return `${view.problem} Which would you like?`
    case 'ready':
      return 'Here is the preview. Run it for the full report, save it, or adjust it below.'
    case 'run':
      return view.sinceLastRun ? `Here it is on the data loaded now, through ${view.dataThrough}.` : `Here is the full report, with data through ${view.dataThrough}.`
    case 'saved':
      return `Saved as "${view.savedName}". ${view.picksUpNewData ? 'Its period is rolling, so each run picks up the newest data.' : 'Its period is fixed, so re-running it will not pick up newer months.'}`
    case 'deleted':
      return `Deleted "${view.savedName}".`
    default:
      return view.message ?? 'Done.'
  }
}

export interface PageReply {
  text: string
  view: View | null
  panel: ReturnType<typeof describeReport>
  saved: ReturnType<typeof savedList>
  dataThrough: string
}

function reply(ctx: ToolContext, text: string): PageReply {
  return { text, view: ctx.view ?? null, panel: describeReport(ctx.engine, ctx.chat), saved: savedList(ctx.engine), dataThrough: ctx.engine.availability().final_through_label }
}

/** A click on the page: applied directly. Errors come back as the assistant's words. */
export function reportBuilderAction(email: string, chatId: string, appUrl: string, action: PageAction): Promise<PageReply> {
  return withSession(email, chatId, appUrl, (ctx) => {
    try {
      runTool(ctx, ACTION_TOOL[action.type], actionInput(action))
      return reply(ctx, cannedText(ctx.view))
    } catch (err) {
      return reply(ctx, (err as Error).message)
    }
  })
}

/** A typed message on the page: the model, with the page's instructions. */
export function reportBuilderPageTurn(input: TurnInput & { chatId: string }): Promise<PageReply> {
  return withSession(input.email, input.chatId, input.appUrl, async (ctx) => {
    const text = await modelTurn(ctx, input, REPORT_BUILDER_PAGE_SKILL)
    return reply(ctx, text)
  })
}

/** The page's first look: saved reports and data freshness, with no chat yet. */
export async function reportBuilderOverview(email: string): Promise<Pick<PageReply, 'saved' | 'dataThrough'>> {
  const { engine } = engineFor(await loadUser(email.trim().toLowerCase()))
  return { saved: savedList(engine), dataThrough: engine.availability().final_through_label }
}
