/**
 * Report Builder, answered over the same chat relay as Yaara.
 *
 * Open WebUI already talks to the portfolio as an OpenAI-style server
 * (/api/yaara/v1). That server now lists a second model, "report-builder";
 * a question addressed to it is answered here, in the portfolio, instead of
 * being queued for Yaara. The caller and the person asking were already
 * verified by the route. What this adds is the prototype rule: only people
 * with "Sees prototypes" ticked in Admin may use it.
 *
 * Tool use is never shown. What the person sees while it works is the same
 * collapsible "working" line Yaara uses, with plain notes such as "Looking up
 * names".
 */
import { randomUUID } from 'node:crypto'
import { accessFor } from '@/lib/auth/access'
import { getAuthConfig } from '@/lib/auth/config'
import { SSE_DONE, SSE_KEEPALIVE, completion, sseChunk, type Asker, type Turn } from '@/lib/yaara-chat'
import { reportBuilderTurn, REPORT_BUILDER_MODEL_ID } from './agent'

export const NOT_ENABLED =
  'Report Builder is a prototype, and it is not switched on for you yet. An admin can turn it on in the portfolio, under Admin, Roles & access: "Prototypes".'

/** Whether this person may use prototypes. Everyone may when sign-in is off for local development. */
export async function mayUsePrototypes(email: string): Promise<boolean> {
  if (!getAuthConfig().enabled) return true
  return (await accessFor(email)).canSeePrototypes
}

function appUrl(req: Request): string {
  return process.env.APP_URL?.trim() || new URL(req.url).origin
}

export async function answerReportBuilder(req: Request, asker: Asker, turns: Turn[], stream: boolean): Promise<Response> {
  const replyId = `chatcmpl-${randomUUID()}`
  const created = Math.floor(Date.now() / 1000)
  const chatId = req.headers.get('x-openwebui-chat-id')
  const allowed = await mayUsePrototypes(asker.email)

  const answer = (onProgress?: (note: string) => void, signal?: AbortSignal): Promise<string> =>
    allowed
      ? reportBuilderTurn({ email: asker.email, chatId, turns, appUrl: appUrl(req), onProgress, signal }).catch(
          (err) => `I couldn't finish that: ${(err as Error).message}`,
        )
      : Promise.resolve(NOT_ENABLED)

  if (!stream) {
    const c = completion(replyId, created, await answer())
    return Response.json({ ...c, model: REPORT_BUILDER_MODEL_ID })
  }

  const abort = new AbortController()
  req.signal.addEventListener('abort', () => abort.abort(), { once: true })
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (s: string) => {
        try {
          controller.enqueue(encoder.encode(s))
        } catch {
          abort.abort()
        }
      }
      send(sseChunk(replyId, created, { role: 'assistant', content: '' }))
      // A slow model round must not look like a dropped connection to a proxy.
      const keepAlive = setInterval(() => send(SSE_KEEPALIVE), 15_000)
      try {
        const text = await answer((note) => send(sseChunk(replyId, created, { reasoning_content: `${note}\n` })), abort.signal)
        send(sseChunk(replyId, created, { content: text }))
      } finally {
        clearInterval(keepAlive)
        send(sseChunk(replyId, created, {}, 'stop'))
        send(SSE_DONE)
        try {
          controller.close()
        } catch {
          // The client already went away.
        }
      }
    },
    cancel() {
      abort.abort()
    },
  })
  return new Response(body, {
    headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no' },
  })
}
