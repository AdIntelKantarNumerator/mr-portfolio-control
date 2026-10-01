/**
 * OpenRouter, with the residency requirement enforced rather than documented.
 *
 * Ported from Yaara (yaara/src/model/openrouter.ts) on 1 October 2026, when
 * the portfolio moved from Azure OpenAI to the same DeepSeek model Yaara runs
 * on, so both halves of the system answer with one model under one rule.
 * Read that file's header for the full reasoning; the short version:
 *
 * OpenRouter is a gateway. You name a model and it picks a company to serve
 * it, by price, and silently falls back to another when one errors. DeepSeek's
 * models are served from China by DeepSeek and from the US by several hosts.
 * OpenRouter has no country filter; what it has is provider pinning, and the
 * line that matters is `allow_fallbacks: false`. So this refuses to run
 * unless the providers are named explicitly and every one is on a short list
 * of US hosts.
 *
 * TWO COPIES OF THE LIST
 *
 * US_PROVIDERS is duplicated from Yaara because the two repositories share no
 * package. Change both together, in commits that say so; the list is the only
 * thing between the requirement and a silent violation of it.
 *
 * WHAT THIS DOES NOT DO
 *
 * Pinning controls where the compute runs. The request still leaves the Azure
 * tenant to OpenRouter and the provider. `data_collection: "deny"` excludes
 * providers that retain or train on requests; whether that is enough is a
 * policy decision, not something this file settles.
 */

export const US_PROVIDERS = ['Together', 'Fireworks', 'DeepInfra', 'Baseten', 'Lambda', 'CoreWeave', 'SambaNova'] as const

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'
export const DEFAULT_OPENROUTER_MODEL = 'deepseek/deepseek-chat-v3.1'

export interface OpenRouterConfig {
  apiKey: string
  model: string
  /** Ordered preference; every entry is on US_PROVIDERS. */
  providers: string[]
  /**
   * DeepSeek v3.1 is a hybrid reasoning model whose thinking comes out of the
   * same token budget as the answer; when it uses it all, the reply is empty.
   * Every caller here wants a short JSON object, so reasoning is off unless
   * OPENROUTER_REASONING=default asks for the model's own behaviour.
   */
  reasoning: boolean
  appUrl: string | null
}

export class ResidencyError extends Error {}

/**
 * The configuration, or null when no key is set. Throws ResidencyError when
 * a key is set but the providers are missing or not verified: a request that
 * would be routed by price is refused, never sent.
 */
export function readOpenRouterConfig(env: Record<string, string | undefined> = process.env): OpenRouterConfig | null {
  const apiKey = env.OPENROUTER_API_KEY?.trim()
  if (!apiKey) return null
  const providers = (env.OPENROUTER_PROVIDERS ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
  if (!providers.length) {
    throw new ResidencyError(
      `OPENROUTER_PROVIDERS is not set, so requests would be routed by price, possibly outside the US. ` +
        `Set it to an ordered list from: ${US_PROVIDERS.join(', ')}.`,
    )
  }
  const unknown = providers.filter((p) => !(US_PROVIDERS as readonly string[]).includes(p))
  if (unknown.length) {
    throw new ResidencyError(
      `OPENROUTER_PROVIDERS names ${unknown.join(', ')}, which is not on the verified US list (${US_PROVIDERS.join(', ')}). ` +
        'Add a provider to US_PROVIDERS in both this file and Yaara\'s, deliberately, after checking where it serves from.',
    )
  }
  return {
    apiKey,
    model: env.OPENROUTER_MODEL?.trim() || DEFAULT_OPENROUTER_MODEL,
    providers,
    reasoning: (env.OPENROUTER_REASONING ?? '').trim().toLowerCase() === 'default',
    appUrl: env.APP_URL?.trim() || null,
  }
}

/** The request body. Separate so the pinning is testable without a network. */
export function requestBody(config: OpenRouterConfig, system: string, user: string, maxTokens: number) {
  return {
    model: config.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    max_tokens: maxTokens,
    temperature: 0,
    response_format: { type: 'json_object' },
    ...(config.reasoning ? {} : { reasoning: { effort: 'none', exclude: true } }),
    provider: {
      order: config.providers,
      // This line is the requirement: nothing outside the list, ever.
      allow_fallbacks: false,
      data_collection: 'deny',
    },
  }
}

/**
 * How long to wait before retrying, or null to stop. With fallbacks refused a
 * rate limit has nobody else to go to, so the choice is wait or fail. Honours
 * Retry-After up to 30 seconds; otherwise 2s, 6s, 18s.
 */
export function retryDelayMs(attempt: number, retryAfter: string | null): number | null {
  if (attempt >= 3) return null
  const seconds = retryAfter ? Number(retryAfter) : NaN
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, 30_000)
  return 2_000 * 3 ** attempt
}

export const isTransient = (status: number) => status === 429 || status === 502 || status === 503 || status === 504

interface OpenRouterResponse {
  choices?: Array<{ message?: { content?: string; reasoning?: string }; finish_reason?: string }>
  /** Which provider actually served it. Recorded, because the point is to know. */
  provider?: string
  error?: { message?: string }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** One call. Returns the reply text and which provider served it. */
export async function callOpenRouter(
  config: OpenRouterConfig,
  system: string,
  user: string,
  o: { maxTokens: number; timeoutMs: number },
  fail: (message: string) => Error,
): Promise<{ text: string; servedBy: string | null }> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    authorization: `Bearer ${config.apiKey}`,
    'X-Title': 'MR Portfolio Control',
  }
  if (config.appUrl) headers['HTTP-Referer'] = config.appUrl
  const body = JSON.stringify(requestBody(config, system, user, o.maxTokens))

  let payload: OpenRouterResponse = {}
  for (let attempt = 0; ; attempt++) {
    let res: Response
    try {
      res = await fetch(ENDPOINT, { method: 'POST', headers, body, signal: AbortSignal.timeout(o.timeoutMs), cache: 'no-store' })
    } catch (err) {
      const cause = (err as { cause?: unknown }).cause
      throw fail(`Could not reach OpenRouter — ${cause instanceof Error ? `${cause.name}: ${cause.message}` : (err as Error).message}`)
    }
    payload = (await res.json().catch(() => ({}))) as OpenRouterResponse
    if (res.ok) break
    const delay = isTransient(res.status) ? retryDelayMs(attempt, res.headers.get('retry-after')) : null
    if (delay === null) {
      const hint =
        res.status === 404
          ? ` — none of the pinned providers (${config.providers.join(', ')}) serve ${config.model}.`
          : res.status === 429
            ? ` — ${config.providers.join(', ')} kept rate limiting; with fallbacks refused there is nobody else to ask.`
            : ''
      throw fail(`OpenRouter returned ${res.status}: ${payload.error?.message ?? 'no detail'}${hint}`)
    }
    await sleep(delay)
  }

  const choice = payload.choices?.[0]
  const content = choice?.message?.content?.trim() ?? ''
  if (!content && choice?.finish_reason === 'length') {
    throw fail(`${config.model} used its whole ${o.maxTokens}-token budget before answering.`)
  }
  // Some models put the answer in `reasoning` and leave content empty.
  return { text: content || choice?.message?.reasoning?.trim() || '', servedBy: payload.provider ?? null }
}
