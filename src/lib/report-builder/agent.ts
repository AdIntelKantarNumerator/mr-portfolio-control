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
import { REPORT_BUILDER_SKILL } from './skill'
import { TOOLS, emptyChat, progressNote, runTool, type ChatState } from './tools'

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

/** Answers the turn. Throws ReportModelError when no model is configured or it fails. */
export async function reportBuilderTurn(input: TurnInput): Promise<string> {
  const choice = chooseModel()
  if (!choice) throw new ReportModelError('No model is configured for Report Builder. Set ANTHROPIC_API_KEY, or OpenRouter with pinned providers.')
  const email = input.email.trim().toLowerCase()
  const chatKey = input.chatId?.trim() || `default:${email}`

  const before = await loadUser(email)
  const { engine, state } = engineFor(before)
  const chat = await loadChat(chatKey, email)
  const chatBefore = JSON.stringify(chat)
  const userBefore = JSON.stringify(state())

  let last = ''
  const text = await runLoop(
    {
      system: REPORT_BUILDER_SKILL,
      turns: input.turns,
      tools: TOOLS,
      exec: (name, args) => runTool({ engine, chat, downloadUrl: (spec, n) => downloadUrl(input.appUrl, spec, n) }, name, args),
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

  if (!before || JSON.stringify(state()) !== userBefore) await saveUser(email, state())
  if (JSON.stringify(chat) !== chatBefore) await saveChat(chatKey, email, chat)
  return text
}
