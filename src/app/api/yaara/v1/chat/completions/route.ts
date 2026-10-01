/**
 * A question for Yaara, from the chat screen, answered as an OpenAI chat
 * completion.
 *
 *   POST /api/yaara/v1/chat/completions
 *
 * Open WebUI sends the whole conversation each time. It is queued in
 * yaara_chats, Yaara collects it over /api/agent/chat, and this handler
 * streams back what she says she is doing and then her answer. Why she is not
 * called directly is in lib/yaara-chat.ts.
 *
 * Authentication is two things: YAARA_CHAT_TOKEN proves the caller is our
 * Open WebUI, and its signed user token proves who is asking (verified against
 * YAARA_CHAT_USER_SECRET). The person's email must be on AUTH_ALLOWED_DOMAINS,
 * the same rule as signing in to the portfolio.
 */
import { randomUUID } from 'node:crypto'
import { chatError, chatRelayAuthorised } from '@/lib/machine-auth'
import {
  ANSWER_TIMEOUT_MS,
  CLAIM_TIMEOUT_MS,
  SSE_DONE,
  SSE_KEEPALIVE,
  completion,
  emailAllowed,
  readAsker,
  readConversation,
  sseChunk,
  unansweredText,
} from '@/lib/yaara-chat'
import { abandonChat, enqueueChat, readChat, waitForChat } from '@/lib/yaara-chat-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Event = { type: 'progress'; note: string } | { type: 'reply'; text: string } | { type: 'idle' }

/**
 * Follow one queued question until it has an answer or the wait runs out.
 * Re-reads the row on every wake-up rather than trusting the signal, because
 * the signal only reaches this instance (lib/yaara-chat-store.ts).
 */
async function* follow(id: string, signal: AbortSignal): AsyncGenerator<Event> {
  const started = Date.now()
  let seen = 0
  for (;;) {
    const row = await readChat(id)
    if (!row) {
      yield { type: 'reply', text: unansweredText('failed', 'the question was lost before I saw it') }
      return
    }
    const progress = JSON.parse(row.progress) as string[]
    for (; seen < progress.length; seen++) yield { type: 'progress', note: progress[seen]! }

    if (row.status === 'answered') {
      yield { type: 'reply', text: row.reply ?? '' }
      return
    }
    if (row.status === 'failed') {
      yield { type: 'reply', text: unansweredText('failed', row.error) }
      return
    }
    if (row.status === 'abandoned') {
      yield { type: 'reply', text: unansweredText('timeout') }
      return
    }
    if (row.status === 'queued' && Date.now() - row.askedAt.getTime() > CLAIM_TIMEOUT_MS) {
      await abandonChat(id, 'Nobody collected the question.')
      yield { type: 'reply', text: unansweredText('unclaimed') }
      return
    }
    if (Date.now() - started > ANSWER_TIMEOUT_MS) {
      await abandonChat(id, 'The chat stopped waiting.')
      yield { type: 'reply', text: unansweredText('timeout') }
      return
    }
    if (signal.aborted) {
      // The person pressed stop or closed the tab. Marking it abandoned
      // tells Yaara her answer would reach nobody.
      await abandonChat(id, 'The person stopped waiting.')
      return
    }
    yield { type: 'idle' }
    await waitForChat(id, 2_000, signal)
  }
}

export async function POST(req: Request) {
  if (!chatRelayAuthorised(req)) return chatError(401, 'Send Authorization: Bearer <YAARA_CHAT_TOKEN>.')

  const secret = process.env.YAARA_CHAT_USER_SECRET?.trim() || undefined
  if (!secret && process.env.NODE_ENV === 'production') {
    return chatError(503, 'YAARA_CHAT_USER_SECRET is not set, so who is asking cannot be verified. Set it here and as FORWARD_USER_INFO_HEADER_JWT_SECRET in Open WebUI.')
  }
  const asker = await readAsker(req.headers, secret)
  if ('error' in asker) return chatError(401, asker.error)
  if (!emailAllowed(asker.email, process.env.AUTH_ALLOWED_DOMAINS)) return chatError(403, `${asker.email} is not on a domain allowed to use the portfolio.`)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return chatError(400, 'The request body is not JSON.')
  }
  const conversation = readConversation(body)
  if ('error' in conversation) return chatError(400, conversation.error)

  const id = await enqueueChat(asker, req.headers.get('x-openwebui-chat-id'), conversation.turns)
  const replyId = `chatcmpl-${randomUUID()}`
  const created = Math.floor(Date.now() / 1000)
  const opening = conversation.droppedParts ? ['Attachments are not passed to me in this chat, so I am reading only the text.'] : []

  if ((body as { stream?: unknown }).stream !== true) {
    let text = ''
    for await (const e of follow(id, req.signal)) if (e.type === 'reply') text = e.text
    return Response.json(completion(replyId, created, text))
  }

  const abort = new AbortController()
  req.signal.addEventListener('abort', () => abort.abort(), { once: true })
  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (s: string) => {
        try {
          controller.enqueue(encoder.encode(s))
        } catch {
          abort.abort()
        }
      }
      let lastWrite = Date.now()
      const write = (s: string) => {
        send(s)
        lastWrite = Date.now()
      }

      write(sseChunk(replyId, created, { role: 'assistant', content: '' }))
      for (const note of opening) write(sseChunk(replyId, created, { reasoning_content: `${note}\n` }))
      try {
        for await (const e of follow(id, abort.signal)) {
          if (e.type === 'progress') write(sseChunk(replyId, created, { reasoning_content: `${e.note}\n` }))
          else if (e.type === 'reply') write(sseChunk(replyId, created, { content: e.text }))
          else if (Date.now() - lastWrite > 15_000) write(SSE_KEEPALIVE)
        }
        write(sseChunk(replyId, created, {}, 'stop'))
        write(SSE_DONE)
      } catch (err) {
        write(sseChunk(replyId, created, { content: unansweredText('failed', (err as Error).message) }, 'stop'))
        write(SSE_DONE)
      } finally {
        try {
          controller.close()
        } catch {
          // Already closed by the client going away.
        }
      }
    },
    cancel() {
      abort.abort()
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      // Stops any proxy on the way from holding the stream until it ends.
      'x-accel-buffering': 'no',
    },
  })
}
