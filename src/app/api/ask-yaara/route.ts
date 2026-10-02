/**
 * A question for Yaara from the chat panel inside the portfolio.
 *
 *   POST /api/ask-yaara   { messages: [{role, content}], page?: {path, title} }
 *
 * The panel's counterpart to /api/yaara/v1/chat/completions, which serves
 * Open WebUI. Same relay (yaara_chats, collected by Yaara over
 * /api/agent/chat), different front door:
 *
 * - The person is whoever is signed in to the portfolio. This route is NOT
 *   exempt from the session gate in proxy.ts, so there is no second sign-in
 *   and no token to forward. That is the whole reason the panel exists rather
 *   than Open WebUI in a frame: a frame from another site cannot share the
 *   portfolio's sign-in, and Google's sign-in page refuses to load in one.
 * - It carries the page the person has open, so "what about this one?"
 *   means something.
 * - It streams one JSON object per line, {"type":"progress","note"} then
 *   {"type":"reply","text"}, which the panel reads without an SSE parser.
 */
import { getCurrentUser } from '@/lib/auth/current-user'
import { readConversation, readPage } from '@/lib/yaara-chat'
import { enqueueChat } from '@/lib/yaara-chat-store'
import { followChat } from '@/lib/yaara-chat-follow'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const fail = (status: number, error: string) => Response.json({ error }, { status })

export async function POST(req: Request) {
  const user = await getCurrentUser()
  // The proxy has already turned away anyone without a session. This is the
  // second layer it asks every route to keep.
  if (!user.authenticated && process.env.NODE_ENV === 'production') return fail(401, 'Sign in to ask Yaara.')

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return fail(400, 'The request body is not JSON.')
  }
  const conversation = readConversation(body)
  if ('error' in conversation) return fail(400, conversation.error)
  const page = readPage((body as { page?: unknown }).page)

  const id = await enqueueChat({ email: user.email, name: user.name || null }, null, conversation.turns, { surface: 'sidebar', page })

  const abort = new AbortController()
  req.signal.addEventListener('abort', () => abort.abort(), { once: true })
  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let lastWrite = Date.now()
      const send = (event: object) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
          lastWrite = Date.now()
        } catch {
          abort.abort()
        }
      }
      send({ type: 'queued' })
      try {
        for await (const e of followChat(id, abort.signal)) {
          if (e.type === 'progress') send({ type: 'progress', note: e.note })
          else if (e.type === 'reply') send({ type: 'reply', text: e.text })
          // A line every 15 seconds keeps proxies from closing a quiet stream.
          else if (Date.now() - lastWrite > 15_000) send({ type: 'waiting' })
        }
      } catch (err) {
        send({ type: 'reply', text: `I couldn't answer that: ${(err as Error).message}.` })
      } finally {
        try {
          controller.close()
        } catch {
          // Already closed by the panel going away.
        }
      }
    },
    cancel() {
      abort.abort()
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
    },
  })
}
