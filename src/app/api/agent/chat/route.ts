/**
 * Yaara's side of the portfolio chat: collect a question, report progress,
 * answer it.
 *
 *   GET  /api/agent/chat?wait=25
 *        The oldest waiting question, held open up to `wait` seconds (25 at
 *        most) for one to arrive: { chat: { id, askedAt, askedBy, chatId,
 *        messages } } or { chat: null }.
 *   POST /api/agent/chat
 *        { id, progress }                      one line of "what I am doing"
 *        { id, reply, model?, servedBy? }      the answer
 *        { id, error }                         why there is none
 *        Answers { ok, live }: live is false when the person had already
 *        stopped waiting, so the answer reached nobody.
 *
 * Protected by SYNC_TOKEN, like every agent route: the caller is Yaara, from
 * src/publish/portfolio.ts in her repository. A change here is a change there.
 *
 * The long hold on GET is what makes the chat feel immediate without her
 * being reachable: she always has one request waiting, and a question
 * arriving answers it at once.
 */
import { machineCallerAuthorised, unauthorised } from '@/lib/machine-auth'
import { addProgress, claimNextChat, finishChat } from '@/lib/yaara-chat-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  if (!machineCallerAuthorised(req)) return unauthorised()
  const wait = Math.max(0, Math.min(25, Number(new URL(req.url).searchParams.get('wait') ?? 0) || 0))
  const chat = await claimNextChat(wait * 1000, req.signal)
  return Response.json({ chat })
}

export async function POST(req: Request) {
  if (!machineCallerAuthorised(req)) return unauthorised()
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return Response.json({ error: 'The body is not JSON.' }, { status: 400 })
  }
  const id = typeof body.id === 'string' ? body.id : ''
  if (!id) return Response.json({ error: 'id is required.' }, { status: 400 })

  if (typeof body.progress === 'string') {
    const live = await addProgress(id, body.progress)
    return Response.json({ ok: true, live })
  }
  if (typeof body.reply === 'string') {
    const live = await finishChat(id, {
      reply: body.reply,
      model: typeof body.model === 'string' ? body.model : null,
      servedBy: typeof body.servedBy === 'string' ? body.servedBy : null,
    })
    return Response.json({ ok: true, live })
  }
  if (typeof body.error === 'string') {
    const live = await finishChat(id, { error: body.error })
    return Response.json({ ok: true, live })
  }
  return Response.json({ error: 'Send one of progress, reply or error.' }, { status: 400 })
}
