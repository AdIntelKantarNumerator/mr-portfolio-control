/**
 * The model behind Report Builder, and its tool loop.
 *
 * lib/llm.ts answers one question with JSON; this needs a model that calls
 * tools, several rounds a turn, so it has its own small loop over the same two
 * providers the portfolio already uses:
 *
 *   anthropic    ANTHROPIC_API_KEY. Preferred when set: the skill was written
 *                for Claude, and it follows a one-question-at-a-time interview
 *                most reliably.
 *   openrouter   OPENROUTER_API_KEY, under the same residency rule as
 *                everything else (lib/openrouter.ts), plus require_parameters
 *                so a provider that cannot call tools is never chosen. Its own
 *                REPORT_BUILDER_MODEL and REPORT_BUILDER_PROVIDERS, so it does
 *                not move with the everyday or advanced model. Claude through
 *                OpenRouter on Bedrock is the intended setting:
 *                  REPORT_BUILDER_MODEL=anthropic/claude-sonnet-5.5
 *                  REPORT_BUILDER_PROVIDERS=amazon-bedrock/us-east-1,azure/us
 *                Unset, it falls back to the advanced model, then the everyday.
 *
 * REPORT_BUILDER_PROVIDER forces anthropic or openrouter.
 * The data is sample data, so nothing sensitive leaves either way, but the
 * conversation does.
 */
import { isTransient, readOpenRouterConfig, retryDelayMs } from '@/lib/openrouter'
import type { ToolDef } from './tools'

export interface ModelChoice {
  provider: 'anthropic' | 'openrouter'
  model: string
}

export class ReportModelError extends Error {}

const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-5-5'
const MAX_ROUNDS = 12
const TIMEOUT_MS = 120_000

/** OpenRouter as Report Builder uses it: its own model and providers when set, under the same US list. */
export function reportBuilderOpenRouter(env: Record<string, string | undefined> = process.env) {
  const model = env.REPORT_BUILDER_MODEL?.trim()
  if (model && env.REPORT_BUILDER_PROVIDERS?.trim()) {
    return readOpenRouterConfig({ ...env, OPENROUTER_MODEL: model, OPENROUTER_PROVIDERS: env.REPORT_BUILDER_PROVIDERS }, 'standard')
  }
  const or = readOpenRouterConfig(env, 'advanced')
  return or && model ? { ...or, model } : or
}

export function chooseModel(env: Record<string, string | undefined> = process.env): ModelChoice | null {
  const forced = env.REPORT_BUILDER_PROVIDER?.trim()
  const anthropic = Boolean(env.ANTHROPIC_API_KEY?.trim())
  const openrouter = Boolean(env.OPENROUTER_API_KEY?.trim())
  const provider = forced === 'anthropic' || forced === 'openrouter' ? forced : anthropic ? 'anthropic' : openrouter ? 'openrouter' : null
  if (!provider) return null
  if (provider === 'anthropic') return { provider, model: env.REPORT_BUILDER_MODEL?.trim() || DEFAULT_ANTHROPIC_MODEL }
  try {
    const or = reportBuilderOpenRouter(env)
    return or ? { provider, model: or.model } : null
  } catch {
    // OpenRouter without verified US providers is refused everywhere, here too.
    return null
  }
}

export interface Turn {
  role: 'user' | 'assistant'
  content: string
}

export interface LoopInput {
  system: string
  turns: Turn[]
  tools: ToolDef[]
  /** Runs a tool; a thrown error goes back to the model as the tool's result. */
  exec: (name: string, input: Record<string, unknown>) => unknown | Promise<unknown>
  onTool?: (name: string) => void
  signal?: AbortSignal
}

/** How one round is sent, so tests can stand in for the network. */
export type Post = (url: string, headers: Record<string, string>, body: unknown, signal?: AbortSignal) => Promise<{ ok: boolean; status: number; json: unknown; retryAfter: string | null }>

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export const httpPost: Post = async (url, headers, body, signal) => {
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    })
  } catch (err) {
    const cause = (err as { cause?: unknown }).cause
    throw new ReportModelError(`Could not reach the model — ${cause instanceof Error ? cause.message : (err as Error).message}`)
  }
  return { ok: res.ok, status: res.status, json: await res.json().catch(() => ({})), retryAfter: res.headers.get('retry-after') }
}

async function postWithRetry(post: Post, url: string, headers: Record<string, string>, body: unknown, signal?: AbortSignal) {
  for (let attempt = 0; ; attempt++) {
    const r = await post(url, headers, body, signal)
    if (r.ok) return r.json
    const delay = isTransient(r.status) ? retryDelayMs(attempt, r.retryAfter) : null
    if (delay === null) {
      const msg = (r.json as { error?: { message?: string } })?.error?.message ?? 'no detail'
      throw new ReportModelError(`The model returned ${r.status}: ${msg}`)
    }
    await sleep(delay)
  }
}

async function safeExec(input: LoopInput, name: string, args: Record<string, unknown>): Promise<string> {
  input.onTool?.(name)
  try {
    return JSON.stringify((await input.exec(name, args)) ?? { ok: true })
  } catch (err) {
    return JSON.stringify({ error: (err as Error).message })
  }
}

async function loopAnthropic(input: LoopInput, model: string, post: Post, env: Record<string, string | undefined>): Promise<string> {
  const headers = { 'x-api-key': env.ANTHROPIC_API_KEY!.trim(), 'anthropic-version': '2023-06-01' }
  const tools = input.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }))
  const messages: Array<{ role: string; content: unknown }> = input.turns.map((t) => ({ role: t.role, content: t.content }))
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const reply = (await postWithRetry(post, 'https://api.anthropic.com/v1/messages', headers, { model, max_tokens: 4000, system: input.system, tools, messages }, input.signal)) as {
      content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>
      stop_reason?: string
    }
    const blocks = reply.content ?? []
    const uses = blocks.filter((b) => b.type === 'tool_use')
    if (reply.stop_reason !== 'tool_use' || !uses.length) return blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('').trim()
    messages.push({ role: 'assistant', content: blocks })
    messages.push({ role: 'user', content: await Promise.all(uses.map(async (u) => ({ type: 'tool_result', tool_use_id: u.id, content: await safeExec(input, u.name ?? '', u.input ?? {}) }))) })
  }
  throw new ReportModelError('The model kept calling tools without answering.')
}

async function loopOpenRouter(input: LoopInput, model: string, post: Post, env: Record<string, string | undefined>): Promise<string> {
  const or = reportBuilderOpenRouter(env)
  if (!or) throw new ReportModelError('OPENROUTER_API_KEY is not set.')
  const headers: Record<string, string> = { authorization: `Bearer ${or.apiKey}`, 'X-Title': 'MR Portfolio Control - Report Builder' }
  if (or.appUrl) headers['HTTP-Referer'] = or.appUrl
  const tools = input.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }))
  const messages: Array<Record<string, unknown>> = [{ role: 'system', content: input.system }, ...input.turns.map((t) => ({ role: t.role, content: t.content }))]
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const reply = (await postWithRetry(
      post,
      'https://openrouter.ai/api/v1/chat/completions',
      headers,
      {
        model,
        messages,
        tools,
        tool_choice: 'auto',
        max_tokens: 4000,
        // Low, not off: Claude on these hosts refuses to have reasoning disabled
        // (OpenRouter 400, 11 November 2026). Low keeps a turn quick.
        reasoning: { effort: 'low' },
        // No temperature: Claude on the US Bedrock and Azure hosts does not take one, and with
        // require_parameters an unsupported parameter rules a host out (11 November 2026).
        // The residency rule, as in lib/openrouter.ts, plus: only a provider that can call tools.
        provider: { order: or.providers, allow_fallbacks: false, data_collection: 'deny', zdr: true, require_parameters: true },
      },
      input.signal,
    )) as {
      choices?: Array<{
        message?: {
          content?: string | null
          tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>
          reasoning?: string | null
          reasoning_details?: unknown[]
        }
      }>
    }
    const msg = reply.choices?.[0]?.message
    const calls = msg?.tool_calls ?? []
    if (!calls.length) return (msg?.content ?? '').trim()
    // The reasoning goes back with the tool calls: Claude needs its own earlier
    // thinking to continue a tool turn, and OpenRouter carries it as reasoning_details.
    messages.push({
      role: 'assistant',
      content: msg?.content ?? '',
      tool_calls: calls,
      ...(msg?.reasoning_details ? { reasoning_details: msg.reasoning_details } : {}),
      ...(msg?.reasoning ? { reasoning: msg.reasoning } : {}),
    })
    for (const c of calls) {
      let args: Record<string, unknown> = {}
      try {
        args = JSON.parse(c.function.arguments || '{}') as Record<string, unknown>
      } catch {
        args = {}
      }
      messages.push({ role: 'tool', tool_call_id: c.id, content: await safeExec(input, c.function.name, args) })
    }
  }
  throw new ReportModelError('The model kept calling tools without answering.')
}

/** Runs the conversation's next turn to a final answer. */
export async function runLoop(input: LoopInput, choice: ModelChoice, post: Post = httpPost, env: Record<string, string | undefined> = process.env): Promise<string> {
  const text = choice.provider === 'anthropic' ? await loopAnthropic(input, choice.model, post, env) : await loopOpenRouter(input, choice.model, post, env)
  if (!text) throw new ReportModelError('The model finished without saying anything.')
  return text
}
