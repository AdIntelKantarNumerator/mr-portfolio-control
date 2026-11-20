/**
 * Report Builder V2's page calls (20 November 2026).
 *
 *   POST /prototypes/report-builder-v2/api
 *     { chatId, action }   a click in the chat or the builder: applied at once, no model
 *     { chatId, turns }    a typed message: the model runs, with V2's instructions
 *     { search }           names for the builder's boxes
 *     { expand }           a row's children in the tree view (V1's)
 *     { compSearch } / { compEdit }   the stored competitive set (V1's)
 *     { schedule }         list, create, update, pause, delete or run a schedule
 *
 * Under /prototypes, so the request gate already requires "Sees prototypes";
 * checked again here because the gate does not enforce roles on the embedded
 * local database.
 */
import { currentAccess } from '@/lib/auth/access'
import { getAuthConfig } from '@/lib/auth/config'
import { reportBuilderCompEdit, reportBuilderCompSearch, reportBuilderExpand, type CompEdit } from '@/lib/report-builder/agent'
import { ReportModelError, type Turn } from '@/lib/report-builder/model'
import { v2Action, v2Search, v2Turn, type V2Action } from '@/lib/report-builder/v2/service'
import { checkInput, createSchedule, deleteSchedule, listSchedules, runNow, setActive, updateSchedule } from '@/lib/report-builder/v2/schedule'
import { mailBlockedReason } from '@/lib/report-builder/v2/mail'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_TURNS = 30
const MAX_CHARS = 4000
const NAME_TYPES = ['top_parent', 'advertiser', 'product', 'industry', 'category', 'subcategory', 'media_type', 'media_owner', 'property', 'master_property', 'market', 'country', 'program', 'program_genre', 'league', 'daypart', 'language', 'direct_indirect', 'length', 'creative']

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

function readAction(raw: unknown): V2Action | null {
  const a = raw as Record<string, unknown> | null
  if (!a || typeof a.type !== 'string') return null
  const str = (k: string) => (typeof a[k] === 'string' ? (a[k] as string).slice(0, 200) : '')
  switch (a.type) {
    case 'start':
      return { type: 'start', mode: a.mode === 'buyer' || a.mode === 'publisher' ? a.mode : undefined }
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
    case 'save_comp_set':
      return { type: 'save_comp_set' }
    case 'edit':
      return { type: 'edit', patch: a.patch }
    case 'template':
      return { type: 'template', id: str('id') }
    case 'export':
      return { type: 'export' }
    default:
      return null
  }
}

export async function POST(req: Request) {
  const access = await currentAccess()
  if (getAuthConfig().enabled && !access.canSeePrototypes) return Response.json({ error: 'Report Builder is not switched on for you.' }, { status: 403 })
  const email = (access.email || 'local@localhost').trim().toLowerCase()
  const appUrl = process.env.APP_URL?.trim() || new URL(req.url).origin

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return Response.json({ error: 'The body must be JSON.' }, { status: 400 })
  }

  try {
    if (body.search && typeof body.search === 'object') {
      const s = body.search as { q?: unknown; types?: unknown }
      const q = typeof s.q === 'string' ? s.q.trim().slice(0, 80) : ''
      const types = Array.isArray(s.types) ? s.types.filter((t): t is string => typeof t === 'string' && NAME_TYPES.includes(t)) : []
      return Response.json(await v2Search(email, q, types))
    }

    if (body.expand && typeof body.expand === 'object') {
      const e = body.expand as { spec?: unknown; path?: unknown; colIds?: unknown }
      const path = Array.isArray(e.path) ? e.path.filter((p): p is string => typeof p === 'string').slice(0, 8) : []
      const colIds = Array.isArray(e.colIds) ? e.colIds.filter((c): c is string => typeof c === 'string').slice(0, 400) : null
      if (!e.spec || typeof e.spec !== 'object' || !path.length) return Response.json({ error: 'Nothing to expand.' }, { status: 400 })
      return Response.json(await reportBuilderExpand(email, e.spec as Record<string, unknown>, path, colIds))
    }

    if (body.compSearch && typeof body.compSearch === 'object') {
      const s = body.compSearch as { q?: unknown; side?: unknown; set?: unknown }
      const q = typeof s.q === 'string' ? s.q.trim().slice(0, 80) : ''
      if (!q) return Response.json([])
      return Response.json(await reportBuilderCompSearch(email, q, s.side === 'mine' ? 'mine' : 'versus', s.set === 'brands' ? 'brands' : 'properties'))
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
      return Response.json({ compSet: await reportBuilderCompEdit(email, edit, e.set === 'brands' ? 'brands' : 'properties') })
    }

    if (body.schedule && typeof body.schedule === 'object') {
      const s = body.schedule as Record<string, unknown>
      const id = typeof s.id === 'string' ? s.id.slice(0, 64) : ''
      const out = { mail: mailBlockedReason() }
      switch (s.op) {
        case 'list':
          return Response.json({ ...out, schedules: await listSchedules(email) })
        case 'create':
          await createSchedule(email, checkInput((s.input ?? {}) as Record<string, unknown>))
          break
        case 'update':
          await updateSchedule(email, id, checkInput((s.input ?? {}) as Record<string, unknown>))
          break
        case 'pause':
        case 'resume':
          await setActive(email, id, s.op === 'resume')
          break
        case 'delete':
          await deleteSchedule(email, id)
          break
        case 'run':
          await runNow(email, id, appUrl.replace(/\/+$/, ''))
          break
        default:
          return Response.json({ error: 'Unknown schedule step.' }, { status: 400 })
      }
      return Response.json({ ...out, schedules: await listSchedules(email) })
    }
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 })
  }

  const chatId = typeof body.chatId === 'string' && /^[a-z0-9-]{8,64}$/i.test(body.chatId) ? `v2:${body.chatId}` : null
  if (!chatId) return Response.json({ error: 'A chatId is needed.' }, { status: 400 })

  if (body.action !== undefined) {
    const action = readAction(body.action)
    if (!action) return Response.json({ error: 'Unknown action.' }, { status: 400 })
    return Response.json(await v2Action(email, chatId, appUrl, action))
  }

  const turns = readTurns(body.turns)
  if (!turns) return Response.json({ error: 'The last message must be from you.' }, { status: 400 })
  try {
    return Response.json(await v2Turn({ email, chatId, turns, appUrl, signal: req.signal }))
  } catch (err) {
    const msg = err instanceof ReportModelError ? err.message : 'Something went wrong on my side.'
    return Response.json({ text: `I couldn't finish that: ${msg}`, view: null })
  }
}
