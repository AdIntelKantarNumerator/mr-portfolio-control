/**
 * Prototypes and Report Builder (11 November 2026).
 *
 * The permission is its own flag, not a role and not implied by admin; the
 * tools run an interview from a chat's stored state; and the model loop runs
 * tools and returns the model's last words, with no network.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canSee, navSectionsFor, normalise } from '../src/lib/access-rules'
import ReportEngine from '../src/lib/report-builder/engine.js'
import { TOOLS, emptyChat, runTool, type ToolContext } from '../src/lib/report-builder/tools'
import { chooseModel, reportBuilderOpenRouter, runLoop, type Post } from '../src/lib/report-builder/model'

test('the Prototypes section needs its own flag, whatever the role, and admin does not imply it', () => {
  const product = normalise({ role: 'product' })
  const admin = normalise({ role: 'product', isAdmin: true })
  const tester = normalise({ role: 'commercial', canSeePrototypes: true })
  for (const a of [product, admin]) {
    assert.ok(!canSee(a, '/prototypes/report-builder'))
    assert.ok(!navSectionsFor(a).has('prototypes'))
  }
  assert.ok(canSee(tester, '/prototypes/report-builder'))
  assert.ok(canSee(tester, '/prototypes/report-builder/export'))
  assert.ok(navSectionsFor(tester).has('prototypes'))
  assert.ok(navSectionsFor(tester).has('reference'), 'still sees what Commercial sees')
  assert.ok(!canSee(tester, '/objectives'), 'and nothing more')
})

function context(): ToolContext {
  const mem = { saved: [], offset: 0, seq: 0 }
  const engine = ReportEngine.create({ store: { load: () => mem, save: () => {} } })
  return { engine, chat: emptyChat(), downloadUrl: (spec, name) => `https://portfolio/prototypes/report-builder/export?name=${name}&n=${Object.keys(spec).length}` }
}

const call = (ctx: ToolContext, name: string, input: Record<string, unknown> = {}) => runTool(ctx, name, input) as Record<string, unknown>

test('an interview from nothing: a question with numbered choices, answered by number', () => {
  const ctx = context()
  const q = call(ctx, 'new_report')
  assert.equal(q.status, 'question')
  const choices = q.choices as Array<{ number: number; label: string }>
  const mix = choices.find((c) => c.label === 'Media mix')!
  const who = call(ctx, 'choose', { choice: String(mix.number) })
  assert.equal(who.status, 'question')
  const toyota = (call(ctx, 'search_names', { query: 'Toyota', types: ['advertiser'] }).matches as Array<{ id: string }>)[0]!
  const ready = call(ctx, 'change_report', { names: [toyota.id] })
  assert.equal(ready.status, 'ready')
  assert.match(String(ready.table_markdown), /\| Toyota \|/)
  const adj = ready.adjustments as Array<{ number: number; label: string }>
  const three = call(ctx, 'choose', { choice: 'last 3 months' })
  assert.match(String(three.summary), /last 3 complete months/)
  assert.ok(adj.length > 0)
})

test('naming a new category switches the report; "add" keeps both', () => {
  const ctx = context()
  call(ctx, 'new_report', { template: 'category_share' })
  const ins = (call(ctx, 'search_names', { query: 'Auto Insurance', types: ['subcategory'] }).matches as Array<{ id: string }>)[0]!
  const qsr = (call(ctx, 'search_names', { query: 'Quick Service Restaurants', types: ['subcategory'] }).matches as Array<{ id: string }>)[0]!
  call(ctx, 'change_report', { names: [ins.id] })
  const switched = call(ctx, 'change_report', { names: [qsr.id] })
  assert.ok(!/Progressive|GEICO/.test(String(switched.table_markdown)))
  const both = call(ctx, 'change_report', { names: [ins.id], names_mode: 'add' })
  assert.match(String(both.table_markdown), /Progressive/)
  assert.match(String(both.table_markdown), /Burger King/)
})

test('asking for share of total on a column breakdown drops the columns rather than failing', () => {
  const ctx = context()
  call(ctx, 'new_report', { template: 'media_mix' })
  const ford = (call(ctx, 'search_names', { query: 'Ford', types: ['advertiser'] }).matches as Array<{ id: string }>)[0]!
  call(ctx, 'change_report', { names: [ford.id] })
  const share = call(ctx, 'change_report', { share_of_total: true })
  assert.equal(share.status, 'ready')
  assert.match(String(share.table_markdown), /Share of total/)
  assert.doesNotMatch(String(share.table_markdown), /Linear TV/, 'the media-type columns are gone')
})

test('a choice that was never offered is refused with the choices that were', () => {
  const ctx = context()
  call(ctx, 'new_report')
  assert.throws(() => call(ctx, 'choose', { choice: '9' }), /Spend trend/)
})

test('run gives a table and a download link; save, open and replace keep one saved report', () => {
  const ctx = context()
  call(ctx, 'new_report', { template: 'advertiser_trend' })
  const t = (call(ctx, 'search_names', { query: 'T-Mobile', types: ['advertiser'] }).matches as Array<{ id: string }>)[0]!
  call(ctx, 'change_report', { names: [t.id] })
  const run = call(ctx, 'run_report', { name: 'T-Mobile trend' })
  assert.match(String(run.download_url), /export\?name=T-Mobile trend/)
  call(ctx, 'save_report', { name: 'T-Mobile trend' })
  call(ctx, 'new_report')
  const opened = call(ctx, 'open_saved_report', { report: 't-mobile' })
  assert.equal(opened.opened, 'T-Mobile trend')
  call(ctx, 'change_report', { period: { mode: 'ytd' } })
  const replaced = call(ctx, 'save_report', { name: 'T-Mobile trend', replace_saved: true })
  assert.equal(replaced.replaced, true)
  assert.equal((call(ctx, 'list_saved_reports').reports as unknown[]).length, 1)
  assert.throws(() => call(ctx, 'delete_saved_report', { report: 't-mobile', confirmed: false }), /confirm/)
})

test('every tool the model is offered is one runTool knows', () => {
  const ctx = context()
  for (const t of TOOLS) {
    try {
      runTool(ctx, t.name, {})
    } catch (err) {
      assert.doesNotMatch((err as Error).message, /Unknown tool/, t.name)
    }
  }
})

test('the model is Claude when an Anthropic key is set, OpenRouter only with pinned providers', () => {
  assert.equal(chooseModel({})?.provider, undefined)
  assert.equal(chooseModel({ ANTHROPIC_API_KEY: 'k' })?.provider, 'anthropic')
  assert.equal(chooseModel({ OPENROUTER_API_KEY: 'k' }), null, 'no pinned providers: refused, not routed by price')
  assert.equal(chooseModel({ OPENROUTER_API_KEY: 'k', OPENROUTER_PROVIDERS: 'DeepInfra' })?.provider, 'openrouter')
})

test('Report Builder can run Claude through OpenRouter on its own US hosts, without moving the everyday model', () => {
  const env = {
    OPENROUTER_API_KEY: 'k',
    OPENROUTER_PROVIDERS: 'CoreWeave,DeepInfra',
    OPENROUTER_MODEL: 'deepseek/deepseek-chat-v3.1',
    REPORT_BUILDER_MODEL: 'anthropic/claude-sonnet-5.5',
    REPORT_BUILDER_PROVIDERS: 'amazon-bedrock/us-east-1,azure/us',
  }
  assert.deepEqual(chooseModel(env), { provider: 'openrouter', model: 'anthropic/claude-sonnet-5.5' })
  assert.deepEqual(reportBuilderOpenRouter(env)?.providers, ['amazon-bedrock/us-east-1', 'azure/us'])
  assert.equal(chooseModel({ ...env, REPORT_BUILDER_PROVIDERS: 'Anthropic' }), null, 'a host off the US list is refused')
})

test('the loop runs the tools the model asks for and returns its final answer', async () => {
  const ran: string[] = []
  let round = 0
  const post: Post = async (_url, _h, body) => {
    round++
    const msgs = (body as { messages: Array<{ role: string; content: unknown }> }).messages
    if (round === 1) return { ok: true, status: 200, retryAfter: null, json: { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'new_report', input: {} }] } }
    const last = msgs[msgs.length - 1]!.content as Array<{ type: string; content: string }>
    assert.equal(last[0]!.type, 'tool_result')
    assert.match(last[0]!.content, /question/)
    return { ok: true, status: 200, retryAfter: null, json: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'What kind of report do you want?' }] } }
  }
  const text = await runLoop(
    { system: 's', turns: [{ role: 'user', content: 'I need a report' }], tools: TOOLS, exec: (name, input) => (ran.push(name), runTool(context(), name, input)) },
    { provider: 'anthropic', model: 'm' },
    post,
    { ANTHROPIC_API_KEY: 'k' },
  )
  assert.equal(text, 'What kind of report do you want?')
  assert.deepEqual(ran, ['new_report'])
})

test('every header sent to OpenRouter is plain ASCII (an em dash once broke every request)', async () => {
  let sent: Record<string, string> = {}
  let body: Record<string, unknown> = {}
  const post: Post = async (_u, headers, b) => ((sent = headers), (body = b as Record<string, unknown>), { ok: true, status: 200, retryAfter: null, json: { choices: [{ message: { content: 'Hi' } }] } })
  const env = { OPENROUTER_API_KEY: 'k', REPORT_BUILDER_MODEL: 'anthropic/claude-sonnet-5.5', REPORT_BUILDER_PROVIDERS: 'amazon-bedrock/us-east-1', APP_URL: 'https://x' }
  await runLoop({ system: 's', turns: [{ role: 'user', content: 'hi' }], tools: TOOLS, exec: () => ({}) }, { provider: 'openrouter', model: 'anthropic/claude-sonnet-5.5' }, post, env)
  for (const [k, v] of Object.entries(sent)) assert.match(v, /^[ -~]*$/, k)
  assert.equal('temperature' in body, false, 'the US Claude hosts refuse a temperature')
})

test('OpenRouter tool turns ask for low reasoning and hand the model its reasoning back', async () => {
  const bodies: Array<Record<string, unknown>> = []
  const post: Post = async (_u, _h, b) => {
    bodies.push(b as Record<string, unknown>)
    if (bodies.length === 1) {
      return { ok: true, status: 200, retryAfter: null, json: { choices: [{ message: { content: '', reasoning_details: [{ type: 'reasoning.text', text: 't' }], tool_calls: [{ id: 'c1', function: { name: 'new_report', arguments: '{}' } }] } }] } }
    }
    return { ok: true, status: 200, retryAfter: null, json: { choices: [{ message: { content: 'Which kind?' } }] } }
  }
  const env = { OPENROUTER_API_KEY: 'k', REPORT_BUILDER_MODEL: 'anthropic/claude-sonnet-5.5', REPORT_BUILDER_PROVIDERS: 'amazon-bedrock/us-east-1' }
  const text = await runLoop({ system: 's', turns: [{ role: 'user', content: 'hi' }], tools: TOOLS, exec: (n, i) => runTool(context(), n, i) }, { provider: 'openrouter', model: 'm' }, post, env)
  assert.equal(text, 'Which kind?')
  assert.deepEqual(bodies[0]!.reasoning, { effort: 'low' })
  const assistant = (bodies[1]!.messages as Array<Record<string, unknown>>).find((m) => m.role === 'assistant')!
  assert.deepEqual(assistant.reasoning_details, [{ type: 'reasoning.text', text: 't' }])
})
