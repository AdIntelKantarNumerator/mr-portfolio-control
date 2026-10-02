/**
 * Chatting with Yaara from the portfolio: the rules, with no I/O.
 *
 * THE SHAPE OF IT
 *
 *   person ── Open WebUI ──► /api/yaara/v1/chat/completions   (this app)
 *                                   │ queues the question
 *                                   ▼
 *                              yaara_chats  ◄── Yaara collects it over
 *                                   │           /api/agent/chat, answers,
 *                                   ▼           and posts progress and reply
 *            streamed back to Open WebUI as an OpenAI-style reply
 *
 * Open WebUI (github.com/open-webui/open-webui) is the chat screen. It speaks
 * the OpenAI chat API to whatever it is pointed at, and it is pointed here,
 * where one model is listed: Yaara.
 *
 * WHY THROUGH THE PORTFOLIO, NOT STRAIGHT TO YAARA
 *
 * Yaara is deliberately unreachable from outside her cluster. Her Slack chat
 * runs over an outbound socket for exactly that reason ("nothing about her is
 * exposed to the internet"), and the seam between the two repositories is
 * that she calls the portfolio's agent API and nothing else. Giving Open
 * WebUI a route into the cluster would break both. Instead the question waits
 * here and she collects it, outbound, the same way she already reads and
 * writes everything else. The cost is a database row per question and a
 * second or so of latency; the benefit is that nothing about her changes
 * shape.
 *
 * WHO IS ASKING
 *
 * Open WebUI signs in with Google and forwards the person on every request
 * as a short-lived HS256 token (FORWARD_USER_INFO_HEADER_JWT_SECRET there,
 * YAARA_CHAT_USER_SECRET here). The bearer token proves the request came from
 * our Open WebUI; the signed token proves who it says is asking. Plain
 * X-OpenWebUI-User-* headers prove nothing, so they are accepted only in local
 * development with no secret set.
 */
import { jwtVerify } from 'jose'

export const YAARA_MODEL_ID = 'yaara'
export const YAARA_MODEL_NAME = 'Yaara'

/** A conversation longer than this has stopped being one; Yaara keeps 30 turns too. */
export const MAX_TURNS = 30
/** Per message. A pasted document is fine; a pasted export is not a question. */
export const MAX_MESSAGE_CHARS = 20_000

/** How long a question may wait for Yaara to collect it before the person is told she is not answering. */
export const CLAIM_TIMEOUT_MS = 90_000
/**
 * How long an answer may take once she has it. Long, because some of what she
 * does is slow: an Engineering Weekly rebuild reads three hosts. A person who
 * gives up can stop the reply; she finishes either way, and the answer is
 * dropped rather than delivered to nobody.
 */
export const ANSWER_TIMEOUT_MS = 20 * 60_000

export interface Turn {
  role: 'user' | 'assistant'
  content: string
}

export interface Asker {
  email: string
  name: string | null
}

/** Text from an OpenAI message's content, which is a string or a list of parts. */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((p) => (p && typeof p === 'object' && (p as { type?: string }).type === 'text' ? String((p as { text?: unknown }).text ?? '') : ''))
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

/**
 * The conversation as Yaara should see it, or why it cannot be sent.
 *
 * System messages are dropped: Yaara has her own instructions, and a system
 * prompt typed into the chat screen's settings must not be able to replace
 * them. Images and files are dropped too, with the question still sent, since
 * this surface does not carry attachments to her.
 */
export function readConversation(body: unknown): { turns: Turn[]; droppedParts: boolean } | { error: string } {
  const messages = (body as { messages?: unknown })?.messages
  if (!Array.isArray(messages) || messages.length === 0) return { error: 'No messages.' }

  let droppedParts = false
  const turns: Turn[] = []
  for (const m of messages) {
    const role = (m as { role?: unknown })?.role
    if (role !== 'user' && role !== 'assistant') continue
    const content = (m as { content?: unknown }).content
    if (Array.isArray(content) && content.some((p) => (p as { type?: string })?.type !== 'text')) droppedParts = true
    const text = textOf(content).trim()
    if (!text) continue
    turns.push({ role, content: text.length > MAX_MESSAGE_CHARS ? `${text.slice(0, MAX_MESSAGE_CHARS)}\n[cut: the message was longer than ${MAX_MESSAGE_CHARS.toLocaleString('en-US')} characters]` : text })
  }

  const recent = turns.slice(-MAX_TURNS)
  // A conversation cut to its last turns must still start with the person.
  while (recent.length && recent[0]!.role !== 'user') recent.shift()
  if (!recent.length || recent[recent.length - 1]!.role !== 'user') return { error: 'The last message must be from the person asking.' }
  return { turns: recent, droppedParts }
}

export type Surface = 'open-webui' | 'sidebar'

export interface PageContext {
  path: string
  title: string | null
}

/**
 * The page a sidebar question was asked from, or null. A path in this app
 * and a short title, nothing else: it goes into Yaara's prompt, so it is
 * held to what the browser would show in its address bar and tab.
 */
export function readPage(raw: unknown): PageContext | null {
  const p = raw as { path?: unknown; title?: unknown } | null
  if (!p || typeof p.path !== 'string') return null
  const path = p.path.trim()
  if (!path.startsWith('/') || path.startsWith('//') || path.length > 300 || /[\s<>"]/.test(path)) return null
  const title = typeof p.title === 'string' ? p.title.replace(/\s+/g, ' ').trim().slice(0, 200) || null : null
  return { path, title }
}

/** The domains a person's email may be on, from AUTH_ALLOWED_DOMAINS. Empty means any. */
export function emailAllowed(email: string, allowedDomains: string | undefined): boolean {
  const domains = (allowedDomains ?? '')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean)
  if (!domains.length) return true
  const at = email.lastIndexOf('@')
  return at > 0 && domains.includes(email.slice(at + 1).toLowerCase())
}

/**
 * Who is asking, from Open WebUI's signed user token.
 *
 * `secret` unset means local development: the plain headers are taken at
 * their word, because there is nobody to forge them. The caller refuses that
 * combination in production.
 */
export async function readAsker(headers: Headers, secret: string | undefined): Promise<Asker | { error: string }> {
  if (secret) {
    const token = headers.get('x-openwebui-user-jwt')
    if (!token) return { error: 'No signed user token. Set FORWARD_USER_INFO_HEADER_JWT_SECRET in Open WebUI to the same value as YAARA_CHAT_USER_SECRET here.' }
    try {
      const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), { algorithms: ['HS256'], issuer: 'open-webui' })
      const email = typeof payload.email === 'string' ? payload.email.trim() : ''
      if (!email) return { error: 'The signed user token carries no email.' }
      const name = typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim() : null
      return { email, name }
    } catch (err) {
      return { error: `The signed user token did not verify (${(err as Error).message}).` }
    }
  }
  const email = headers.get('x-openwebui-user-email')?.trim() || 'local@localhost'
  const rawName = headers.get('x-openwebui-user-name')
  let name: string | null = null
  if (rawName) {
    try {
      name = decodeURIComponent(rawName).trim() || null
    } catch {
      name = rawName.trim() || null
    }
  }
  return { email, name }
}

/** The model list Open WebUI reads to know what it can talk to: Yaara and nobody else. */
export function modelList(created: number) {
  return {
    object: 'list',
    data: [{ id: YAARA_MODEL_ID, object: 'model', created, owned_by: 'mediaradar', name: YAARA_MODEL_NAME }],
  }
}

/**
 * One server-sent event in the OpenAI streaming format.
 *
 * `reasoning_content` is what Open WebUI shows as a collapsible "thinking"
 * block above the answer. Yaara's progress ("Reading the decisions register")
 * goes there, so the wait is visibly work and the answer itself stays clean.
 */
export function sseChunk(
  id: string,
  created: number,
  delta: { role?: 'assistant'; content?: string; reasoning_content?: string },
  finish: 'stop' | null = null,
): string {
  const body = { id, object: 'chat.completion.chunk', created, model: YAARA_MODEL_ID, choices: [{ index: 0, delta, finish_reason: finish }] }
  return `data: ${JSON.stringify(body)}\n\n`
}

export const SSE_DONE = 'data: [DONE]\n\n'
/** A comment line: ignored by the client, keeps every proxy on the way from closing an idle stream. */
export const SSE_KEEPALIVE = ': still working\n\n'

/** The non-streamed reply, for a client that did not ask for a stream. */
export function completion(id: string, created: number, content: string) {
  return {
    id,
    object: 'chat.completion',
    created,
    model: YAARA_MODEL_ID,
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
  }
}

/** What the person is told when Yaara does not answer, by why. */
export function unansweredText(why: 'unclaimed' | 'timeout' | 'failed', detail?: string | null): string {
  switch (why) {
    case 'unclaimed':
      return "I'm not picking up questions here at the moment, so this one went unanswered. Nothing was lost on your side: ask again in a few minutes, or ask me in Slack. If it keeps happening, my web chat connection to the portfolio is down and someone should check on me."
    case 'timeout':
      return "This one took me too long, so the chat stopped waiting. I may still finish it, but the answer will not appear here. Ask again with a narrower question, or ask me in Slack where long jobs can report back."
    default:
      return `I couldn't answer that: ${detail ?? 'something went wrong on my side'}.`
  }
}
