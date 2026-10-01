/**
 * The one place the portfolio talks to a language model.
 *
 * Moved out of summarize.ts when the Workflow Assessment chat became the
 * second caller. Two copies of "which provider answers, and how to call it"
 * would drift — one would learn about a new Azure API version and the other
 * would not — and the residency decision (Azure OpenAI keeps material inside
 * the tenant) must be made once for the whole app, not per feature.
 *
 * Callers own their prompt and their parsing. This module only picks the
 * provider, sends one system and one user message, asks for JSON, and returns
 * the text.
 *
 * PRODUCTION RUNS ON OPENROUTER
 *
 * Since 1 October 2026 the deployed portfolio answers with DeepSeek through
 * OpenRouter, pinned to US providers, the same model and rule as Yaara
 * (lib/openrouter.ts). The Azure OpenAI resource it used before was deleted.
 * Azure, Gemini and Anthropic stay supported: which one runs is a deployment
 * setting, and Azure still wins when it is configured alongside OpenRouter,
 * matching Yaara's own order.
 */

import { callOpenRouter, DEFAULT_OPENROUTER_MODEL, readOpenRouterConfig, type OpenRouterConfig } from './openrouter'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-5'
const DEFAULT_AZURE_API_VERSION = '2024-10-21'
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models'
const DEFAULT_GEMINI_MODEL = 'gemini-2.0-flash'

export type Provider = 'azure-openai' | 'openrouter' | 'gemini' | 'anthropic'

export interface ProviderConfig {
  provider: Provider
  /** What gets recorded on whatever the model produced, so an odd answer can be traced. */
  model: string
}

export class ModelError extends Error {}

const azureReady = () =>
  Boolean(
    process.env.AZURE_OPENAI_ENDPOINT?.trim() &&
      process.env.AZURE_OPENAI_API_KEY?.trim() &&
      process.env.AZURE_OPENAI_DEPLOYMENT?.trim(),
  )
const openrouterReady = () => Boolean(process.env.OPENROUTER_API_KEY?.trim())
const geminiReady = () => Boolean(process.env.GEMINI_API_KEY?.trim())
const anthropicReady = () => Boolean(process.env.ANTHROPIC_API_KEY?.trim())

function describe(provider: Provider): ProviderConfig {
  switch (provider) {
    case 'azure-openai':
      return { provider, model: `azure:${process.env.AZURE_OPENAI_DEPLOYMENT?.trim() ?? 'unset'}` }
    case 'openrouter':
      return { provider, model: `openrouter:${process.env.OPENROUTER_MODEL?.trim() || DEFAULT_OPENROUTER_MODEL}` }
    case 'gemini':
      return { provider, model: process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL }
    default:
      return { provider, model: process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_ANTHROPIC_MODEL }
  }
}

/**
 * Which provider answers.
 *
 * SUMMARISER_PROVIDER forces one (the name predates the second caller and is
 * kept so no deployment has to change a setting); otherwise the first
 * configured wins, in an order that prefers keeping material inside
 * infrastructure the organisation already controls.
 */
export function resolveProvider(): ProviderConfig | null {
  const forced = process.env.SUMMARISER_PROVIDER?.trim() as Provider | undefined
  if (forced === 'azure-openai' || forced === 'openrouter' || forced === 'gemini' || forced === 'anthropic') return describe(forced)
  if (azureReady()) return describe('azure-openai')
  if (openrouterReady()) return describe('openrouter')
  if (geminiReady()) return describe('gemini')
  if (anthropicReady()) return describe('anthropic')
  return null
}

/** Where the material goes, in words a person can act on. `what` names it: "transcripts", "questions". */
export function providerDescription(what: string): string | null {
  const config = resolveProvider()
  if (!config) return null
  switch (config.provider) {
    case 'azure-openai':
      return `Azure OpenAI deployment "${process.env.AZURE_OPENAI_DEPLOYMENT?.trim()}" — ${what} stay in your Azure tenant.`
    case 'openrouter': {
      try {
        const or = readOpenRouterConfig()
        if (!or) return null
        return `DeepSeek (${or.model}) through OpenRouter, pinned to US providers ${or.providers.join(', ')} — ${what} leave the Azure tenant for OpenRouter and that provider.`
      } catch (err) {
        return `OpenRouter is configured incorrectly: ${(err as Error).message}`
      }
    }
    case 'gemini':
      return `Google Gemini (${config.model}) — ${what} are sent to Google.`
    default:
      return `Anthropic API (${config.model}) — ${what} are sent to Anthropic.`
  }
}

/** Unwraps Node's uniformly unhelpful "fetch failed" into something actionable. */
function transportDetail(err: unknown): string {
  const cause = (err as { cause?: unknown }).cause
  if (cause instanceof Error) return `${cause.name}: ${cause.message}`
  if (cause) return String(cause)
  return (err as Error).message
}

interface CallOptions {
  maxTokens: number
  timeoutMs: number
}

async function callAzure(system: string, user: string, o: CallOptions): Promise<string> {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT!.trim().replace(/\/$/, '')
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT!.trim()
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION?.trim() || DEFAULT_AZURE_API_VERSION
  const url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'api-key': process.env.AZURE_OPENAI_API_KEY!.trim() },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        max_tokens: o.maxTokens,
        temperature: 0,
        // Asking for JSON rather than hoping for it. Every caller's parser is
        // strict either way, but this removes the most common reason it has to be.
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(o.timeoutMs),
      cache: 'no-store',
    })
  } catch (err) {
    throw new ModelError(`Could not reach the Azure OpenAI endpoint — ${transportDetail(err)}`)
  }

  const body = (await res.json().catch(() => ({}))) as {
    choices?: Array<{ message?: { content?: string } }>
    error?: { message?: string }
  }
  if (!res.ok) {
    throw new ModelError(
      `Azure OpenAI returned ${res.status}${body.error?.message ? `: ${body.error.message}` : ''}` +
        (res.status === 404 ? ` — check AZURE_OPENAI_DEPLOYMENT matches a deployment name, not a model name.` : ''),
    )
  }
  return body.choices?.[0]?.message?.content ?? ''
}

async function callGemini(system: string, user: string, o: CallOptions): Promise<string> {
  const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL
  let res: Response
  try {
    res = await fetch(`${GEMINI_URL}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY!.trim() },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { temperature: 0, maxOutputTokens: o.maxTokens, responseMimeType: 'application/json' },
      }),
      signal: AbortSignal.timeout(o.timeoutMs),
      cache: 'no-store',
    })
  } catch (err) {
    throw new ModelError(`Could not reach the Gemini API — ${transportDetail(err)}`)
  }
  const body = (await res.json().catch(() => ({}))) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    error?: { message?: string }
  }
  if (!res.ok) throw new ModelError(`Gemini returned ${res.status}${body.error?.message ? `: ${body.error.message}` : ''}`)
  return (body.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('')
}

async function callAnthropic(system: string, user: string, model: string, o: CallOptions): Promise<string> {
  let res: Response
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY!.trim(),
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model, max_tokens: o.maxTokens, system, messages: [{ role: 'user', content: user }] }),
      signal: AbortSignal.timeout(o.timeoutMs),
      cache: 'no-store',
    })
  } catch (err) {
    throw new ModelError(`Could not reach the Anthropic API — ${transportDetail(err)}`)
  }
  const body = (await res.json().catch(() => ({}))) as {
    content?: Array<{ type: string; text?: string }>
    error?: { message?: string }
  }
  if (!res.ok) throw new ModelError(`Anthropic API returned ${res.status}${body.error?.message ? `: ${body.error.message}` : ''}`)
  return (body.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
}

/**
 * Send one system and one user message and return the reply text, which the
 * caller parses. Throws ModelError when no provider is configured or the call
 * fails, with a message a person can act on.
 */
export async function completeJson(
  system: string,
  user: string,
  options: Partial<CallOptions> = {},
): Promise<{ text: string; model: string }> {
  const config = resolveProvider()
  if (!config) {
    throw new ModelError('No language model is configured. Set OpenRouter (key and pinned US providers), an Azure OpenAI deployment, a Gemini key or an Anthropic key.')
  }
  const o: CallOptions = { maxTokens: options.maxTokens ?? 1500, timeoutMs: options.timeoutMs ?? 120_000 }

  if (config.provider === 'openrouter') {
    let or: OpenRouterConfig | null
    try {
      or = readOpenRouterConfig()
    } catch (err) {
      // A residency failure is a configuration error, reported like any other
      // model failure, so callers fall back rather than send the request.
      throw new ModelError((err as Error).message)
    }
    if (!or) throw new ModelError('OPENROUTER_API_KEY is not set.')
    const reply = await callOpenRouter(or, system, user, o, (m) => new ModelError(m))
    // Which provider served it is recorded on whatever the reply produced: the
    // pinning says where it may run; this says where it did.
    return { text: reply.text, model: `openrouter:${or.model}${reply.servedBy ? ` via ${reply.servedBy}` : ''}` }
  }

  const text =
    config.provider === 'azure-openai'
      ? await callAzure(system, user, o)
      : config.provider === 'gemini'
        ? await callGemini(system, user, o)
        : await callAnthropic(system, user, config.model, o)
  return { text, model: config.model }
}
