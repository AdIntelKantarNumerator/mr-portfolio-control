/**
 * The portfolio's OpenRouter client keeps the residency rule Yaara keeps.
 *
 * Moved to OpenRouter and DeepSeek on 1 October 2026 so both halves of the
 * system answer with the same model. DeepSeek is served from China as well as
 * the US, and OpenRouter picks by price and falls back silently, so the only
 * thing between "we use DeepSeek" and "inference ran offshore" is the pinning
 * these tests hold in place.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_OPENROUTER_MODEL,
  ResidencyError,
  US_PROVIDERS,
  readOpenRouterConfig,
  requestBody,
  retryDelayMs,
} from '../src/lib/openrouter'
import { resolveProvider } from '../src/lib/llm'

test('residency is refused rather than assumed', async (t) => {
  await t.test('no key means no OpenRouter at all, not an error', () => {
    assert.equal(readOpenRouterConfig({}), null)
  })
  await t.test('a key with no providers named is refused: it would route by price', () => {
    assert.throws(() => readOpenRouterConfig({ OPENROUTER_API_KEY: 'k' }), ResidencyError)
  })
  await t.test('a provider not on the verified US list is refused', () => {
    assert.throws(() => readOpenRouterConfig({ OPENROUTER_API_KEY: 'k', OPENROUTER_PROVIDERS: 'Together,DeepSeek' }), /DeepSeek/)
  })
  await t.test('a verified list is accepted, in the order given', () => {
    const c = readOpenRouterConfig({ OPENROUTER_API_KEY: 'k', OPENROUTER_PROVIDERS: ' Fireworks , Together ' })!
    assert.deepEqual(c.providers, ['Fireworks', 'Together'])
    assert.equal(c.model, DEFAULT_OPENROUTER_MODEL)
  })
  await t.test('the list matches Yaara\'s, which is the same rule in the other repository', () => {
    assert.deepEqual([...US_PROVIDERS], ['Together', 'Fireworks', 'DeepInfra', 'Baseten', 'Lambda', 'CoreWeave', 'SambaNova'])
  })
})

test('every request is pinned', async (t) => {
  const config = readOpenRouterConfig({ OPENROUTER_API_KEY: 'k', OPENROUTER_PROVIDERS: 'Together' })!
  const body = requestBody(config, 'sys', 'user', 900)

  await t.test('nothing outside the pinned providers, ever', () => {
    assert.deepEqual(body.provider.order, ['Together'])
    assert.equal(body.provider.allow_fallbacks, false)
  })
  await t.test('providers that retain or train on requests are excluded', () => {
    assert.equal(body.provider.data_collection, 'deny')
  })
  await t.test('reasoning is off by default, so the budget goes to the answer', () => {
    assert.deepEqual((body as { reasoning?: unknown }).reasoning, { effort: 'none', exclude: true })
  })
  await t.test('JSON is asked for', () => {
    assert.deepEqual(body.response_format, { type: 'json_object' })
  })
})

test('a rate limit is waited out, briefly, then given up on', () => {
  assert.equal(retryDelayMs(0, null), 2000)
  assert.equal(retryDelayMs(2, null), 18000)
  assert.equal(retryDelayMs(3, null), null)
  assert.equal(retryDelayMs(0, '600'), 30000, 'a provider asking for minutes is capped')
})

test('which provider answers', async (t) => {
  const keys = [
    'SUMMARISER_PROVIDER',
    'AZURE_OPENAI_ENDPOINT',
    'AZURE_OPENAI_API_KEY',
    'AZURE_OPENAI_DEPLOYMENT',
    'OPENROUTER_API_KEY',
    'OPENROUTER_PROVIDERS',
    'GEMINI_API_KEY',
    'ANTHROPIC_API_KEY',
  ]
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]))
  const set = (env: Record<string, string>) => {
    for (const k of keys) delete process.env[k]
    Object.assign(process.env, env)
  }
  try {
    await t.test('OpenRouter alone: OpenRouter, which is how production is set up', () => {
      set({ OPENROUTER_API_KEY: 'k', OPENROUTER_PROVIDERS: 'Together' })
      assert.equal(resolveProvider()?.provider, 'openrouter')
    })
    await t.test('Azure alongside OpenRouter: Azure, the same order Yaara uses', () => {
      set({ OPENROUTER_API_KEY: 'k', AZURE_OPENAI_ENDPOINT: 'e', AZURE_OPENAI_API_KEY: 'a', AZURE_OPENAI_DEPLOYMENT: 'd' })
      assert.equal(resolveProvider()?.provider, 'azure-openai')
    })
    await t.test('OpenRouter ahead of Gemini and Anthropic', () => {
      set({ OPENROUTER_API_KEY: 'k', GEMINI_API_KEY: 'g', ANTHROPIC_API_KEY: 'a' })
      assert.equal(resolveProvider()?.provider, 'openrouter')
    })
    await t.test('nothing set: no provider, and the chat falls back to keywords', () => {
      set({})
      assert.equal(resolveProvider(), null)
    })
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  }
})
