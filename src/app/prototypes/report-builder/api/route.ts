/**
 * The Report Builder page's conversation.
 *
 *   POST /prototypes/report-builder/api
 *     { chatId, action }   a click: applied at once, no model (lib/report-builder/agent.ts)
 *     { chatId, turns }    a typed message: the model runs, with the page's instructions
 *
 * Returns what to show: the assistant's words, the last table or question
 * (view), the report's details for the side panel, and the saved reports.
 * Under /prototypes, so the request gate already requires "Sees prototypes";
 * checked again here because the gate does not enforce roles on the embedded
 * local database.
 */
import { currentAccess } from '@/lib/auth/access'
import { getAuthConfig } from '@/lib/auth/config'
import { reportBuilderAction, reportBuilderCompEdit, reportBuilderCompSearch, reportBuilderExpand, reportBuilderPageTurn, type CompEdit, type PageAction } from '@/lib/report-builder/agent'
import { ReportModelError, type Turn } from '@/lib/report-builder/model'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ACTIONS = new Set(['start', 'choose', 'run', 'save', 'open_saved', 'run_saved', 'delete_saved', 'demo_month', 'save_comp_set'])
const MAX_TURNS = 30
const MAX_CHARS = 4000

function readTurns(raw: unknown): Turn[] | null {
  if (!Array.isArray(raw)) return null
  const turns = raw
    .filter((t): t is { role: string; content: string } => !!t && typeof t === 'object' && typeof (t as Turn).content === 'string')
    .filter((t) => t.role === 'user' || t.role === 'assistant')
    .map((t) => ({ role: t.role as Turn['role'], content: t.content.slice(0, MAX_CHARS) }))
    .filter((t) => t.content.trim())
    .slice(-MAX_TURNS)
  while (turns.length && turns[0]!.role !== 'user') turns.shift()
  return turns.length && turns[turns.length - 1]!.role === 'user' ? turns : null
}

function readAction(raw: unknown): PageAction | null {
  const a = raw as Record<string, unknown> | null
  if (!a || typeof a.type !== 'string' || !ACTIONS.has(a.type)) return null
  const str = (k: string) => (typeof a[k] === 'string' ? (a[k] as string).slice(0, 200) : '')
  switch (a.type) {
    case 'choose':
      return { type: 'choose', choice: str('choice') }
    case 'run':
      return { type: 'run', name: str('name') || undefined }
    case 'save':
      return { type: 'save', name: str('name') || 'Untitled report', replace: a.replace === true }
    case 'open_saved':
    case 'run_saved':
    case 'delete_saved':
      return { type: a.type, report: str('report') }
    default:
      return { type: a.type as 'start' | 'demo_month' | 'save_comp_set' }
  }
}

export async function POST(req: Request) {
  const access = await currentAccess()
  const authOn = getAuthConfig().enabled
  if (authOn && !access.canSeePrototypes) return Response.json({ error: 'Report Builder is not switched on for you.' }, { status: 403 })
  const email = access.email || 'local@localhost'

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return Response.json({ error: 'The body must be JSON.' }, { status: 400 })
  }
  // Expanding a row in the tree view: a read, keyed by the report itself, not the chat.
  if (body.expand && typeof body.expand === 'object') {
    const e = body.expand as { spec?: unknown; path?: unknown; colIds?: unknown }
    const path = Array.isArray(e.path) ? e.path.filter((p): p is string => typeof p === 'string').slice(0, 8) : []
    const colIds = Array.isArray(e.colIds) ? e.colIds.filter((c): c is string => typeof c === 'string').slice(0, 60) : null
    if (!e.spec || typeof e.spec !== 'object' || !path.length) return Response.json({ error: 'Nothing to expand.' }, { status: 400 })
    try {
      return Response.json(await reportBuilderExpand(email, e.spec as Record<string, unknown>, path, colIds))
    } catch (err) {
      return Response.json({ error: (err as Error).message }, { status: 400 })
    }
  }

  // The competitive-set panel: a search for names, and edits to the stored set.
  if (body.compSearch && typeof body.compSearch === 'object') {
    const s = body.compSearch as { q?: unknown; side?: unknown }
    const q = typeof s.q === 'string' ? s.q.trim().slice(0, 80) : ''
    if (!q) return Response.json([])
    try {
      return Response.json(await reportBuilderCompSearch(email, q, s.side === 'mine' ? 'mine' : 'versus'))
    } catch (err) {
      return Response.json({ error: (err as Error).message }, { status: 400 })
    }
  }
  if (body.compEdit && typeof body.compEdit === 'object') {
    const e = body.compEdit as Record<string, unknown>
    const s = (k: string) => (typeof e[k] === 'string' ? (e[k] as string).slice(0, 120) : '')
    let edit: CompEdit | null = null
    if (e.op === 'add' && s('id')) edit = { op: 'add', side: e.side === 'mine' ? 'mine' : 'versus', id: s('id'), label: s('label') || s('id') }
    else if (e.op === 'remove' && s('id')) edit = { op: 'remove', id: s('id') }
    else if (e.op === 'all') edit = { op: 'all', value: e.value === true }
    else if (e.op === 'clear') edit = { op: 'clear' }
    if (!edit) return Response.json({ error: 'Unknown edit.' }, { status: 400 })
    try {
      return Response.json({ compSet: await reportBuilderCompEdit(email, edit) })
    } catch (err) {
      return Response.json({ error: (err as Error).message }, { status: 400 })
    }
  }

  const id = typeof body.chatId === 'string' && /^[a-z0-9-]{8,64}$/i.test(body.chatId) ? `page:${body.chatId}` : null
  if (!id) return Response.json({ error: 'A chatId is needed.' }, { status: 400 })
  const appUrl = process.env.APP_URL?.trim() || new URL(req.url).origin

  const action = body.action === undefined ? null : readAction(body.action)
  if (body.action !== undefined && !action) return Response.json({ error: 'Unknown action.' }, { status: 400 })
  if (action) return Response.json(await reportBuilderAction(email, id, appUrl, action))

  const turns = readTurns(body.turns)
  if (!turns) return Response.json({ error: 'The last message must be from you.' }, { status: 400 })
  try {
    return Response.json(await reportBuilderPageTurn({ email, chatId: id, turns, appUrl, signal: req.signal }))
  } catch (err) {
    const msg = err instanceof ReportModelError ? err.message : 'Something went wrong on my side.'
    return Response.json({ text: `I couldn't finish that: ${msg}`, view: null, panel: null, saved: null, dataThrough: null })
  }
}
