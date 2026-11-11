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
import { dataSource, sampleEngine } from '../src/lib/report-builder/engines'
import { TOOLS, emptyChat, runTool, type ToolContext } from '../src/lib/report-builder/tools'
import { chooseModel, reportBuilderOpenRouter, runLoop, type Post } from '../src/lib/report-builder/model'
import { describeReport, suggestName } from '../src/lib/report-builder/page-view'

test('the Prototypes section needs its own flag, whatever the role, and admin does not imply it', async () => {
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
  const engine = sampleEngine({ load: () => mem, save: () => {} })
  return { engine, chat: emptyChat(), downloadUrl: (spec, name) => `https://portfolio/prototypes/report-builder/export?name=${name}&n=${Object.keys(spec).length}` }
}

const call = async (ctx: ToolContext, name: string, input: Record<string, unknown> = {}) => (await runTool(ctx, name, input)) as Record<string, unknown>

test('an interview from nothing: a question with numbered choices, answered by number', async () => {
  const ctx = context()
  const q = await call(ctx, 'new_report')
  assert.equal(q.status, 'question')
  const choices = q.choices as Array<{ number: number; label: string }>
  const mix = choices.find((c) => c.label === 'Media mix')!
  const who = await call(ctx, 'choose', { choice: String(mix.number) })
  assert.equal(who.status, 'question')
  const toyota = ((await call(ctx, 'search_names', { query: 'Toyota', types: ['advertiser'] })).matches as Array<{ id: string }>)[0]!
  const ready = await call(ctx, 'change_report', { names: [toyota.id] })
  assert.equal(ready.status, 'ready')
  assert.match(String(ready.table_markdown), /\| Toyota \|/)
  const adj = ready.adjustments as Array<{ number: number; label: string }>
  const three = await call(ctx, 'choose', { choice: 'last 3 months' })
  assert.match(String(three.summary), /last 3 complete months/)
  assert.ok(adj.length > 0)
})

test('naming a new category switches the report; "add" keeps both', async () => {
  const ctx = context()
  await call(ctx, 'new_report', { template: 'category_share' })
  const ins = ((await call(ctx, 'search_names', { query: 'Auto Insurance', types: ['subcategory'] })).matches as Array<{ id: string }>)[0]!
  const qsr = ((await call(ctx, 'search_names', { query: 'Quick Service Restaurants', types: ['subcategory'] })).matches as Array<{ id: string }>)[0]!
  await call(ctx, 'change_report', { names: [ins.id] })
  const switched = await call(ctx, 'change_report', { names: [qsr.id] })
  assert.ok(!/Progressive|GEICO/.test(String(switched.table_markdown)))
  const both = await call(ctx, 'change_report', { names: [ins.id], names_mode: 'add' })
  assert.match(String(both.table_markdown), /Progressive/)
  assert.match(String(both.table_markdown), /Burger King/)
})

test('asking for share of total on a column breakdown drops the columns rather than failing', async () => {
  const ctx = context()
  await call(ctx, 'new_report', { template: 'media_mix' })
  const ford = ((await call(ctx, 'search_names', { query: 'Ford', types: ['advertiser'] })).matches as Array<{ id: string }>)[0]!
  await call(ctx, 'change_report', { names: [ford.id] })
  const share = await call(ctx, 'change_report', { share_of_total: true })
  assert.equal(share.status, 'ready')
  assert.match(String(share.table_markdown), /Share of total/)
  assert.doesNotMatch(String(share.table_markdown), /Linear TV/, 'the media-type columns are gone')
})

test('a choice that was never offered is refused with the choices that were', async () => {
  const ctx = context()
  await call(ctx, 'new_report')
  await assert.rejects(() => call(ctx, 'choose', { choice: '9' }), /Spend trend/)
})

test('run gives a table and a download link; save, open and replace keep one saved report', async () => {
  const ctx = context()
  await call(ctx, 'new_report', { template: 'advertiser_trend' })
  const t = ((await call(ctx, 'search_names', { query: 'T-Mobile', types: ['advertiser'] })).matches as Array<{ id: string }>)[0]!
  await call(ctx, 'change_report', { names: [t.id] })
  const run = await call(ctx, 'run_report', { name: 'T-Mobile trend' })
  assert.match(String(run.download_url), /export\?name=T-Mobile trend/)
  await call(ctx, 'save_report', { name: 'T-Mobile trend' })
  await call(ctx, 'new_report')
  const opened = await call(ctx, 'open_saved_report', { report: 't-mobile' })
  assert.equal(opened.opened, 'T-Mobile trend')
  await call(ctx, 'change_report', { period: { mode: 'ytd' } })
  const replaced = await call(ctx, 'save_report', { name: 'T-Mobile trend', replace_saved: true })
  assert.equal(replaced.replaced, true)
  assert.equal(((await call(ctx, 'list_saved_reports')).reports as unknown[]).length, 1)
  await assert.rejects(() => call(ctx, 'delete_saved_report', { report: 't-mobile', confirmed: false }), /confirm/)
})

test('every tool the model is offered is one runTool knows', async () => {
  const ctx = context()
  for (const t of TOOLS) {
    try {
      await runTool(ctx, t.name, {})
    } catch (err) {
      assert.doesNotMatch((err as Error).message, /Unknown tool/, t.name)
    }
  }
})

test('the model is Claude when an Anthropic key is set, OpenRouter only with pinned providers', async () => {
  assert.equal(chooseModel({})?.provider, undefined)
  assert.equal(chooseModel({ ANTHROPIC_API_KEY: 'k' })?.provider, 'anthropic')
  assert.equal(chooseModel({ OPENROUTER_API_KEY: 'k' }), null, 'no pinned providers: refused, not routed by price')
  assert.equal(chooseModel({ OPENROUTER_API_KEY: 'k', OPENROUTER_PROVIDERS: 'DeepInfra' })?.provider, 'openrouter')
})

test('Report Builder can run Claude through OpenRouter on its own US hosts, without moving the everyday model', async () => {
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

test('the page gets what to draw: choices, then a table it can chart, and the report in plain words', async () => {
  const ctx = context()
  await call(ctx, 'new_report', { template: 'media_mix' })
  assert.equal(ctx.view?.kind, 'question')
  assert.ok((ctx.view?.choices ?? []).length > 1)
  const ford = ((await call(ctx, 'search_names', { query: 'Ford', types: ['advertiser'] })).matches as Array<{ id: string }>)[0]!
  await call(ctx, 'change_report', { names: [ford.id] })
  assert.equal(ctx.view?.kind, 'ready')
  assert.ok(ctx.view?.table?.columns.some((c) => c.type === 'money'))
  await call(ctx, 'run_report', {})
  assert.equal(ctx.view?.kind, 'run')
  assert.match(String(ctx.view?.downloadUrl), /export/)
  const panel = await describeReport(ctx.engine, ctx.chat)
  assert.equal(panel.status, 'ready')
  assert.equal(panel.name, 'Ford media mix')
  assert.equal(await suggestName(ctx.engine, ctx.chat.report!), 'Ford media mix')
  assert.ok(panel.rows.some((r) => r.label === 'Limited to' && r.value === 'Ford'))
})

test('everyday words find the right thing: fast food is Quick Service Restaurants', async () => {
  const ctx = context()
  const hits = (await call(ctx, 'search_names', { query: 'Fast Food' })).matches as Array<{ label: string }>
  assert.equal(hits[0]!.label, 'Quick Service Restaurants')
})

test('the model can put its own which-one choices on the buttons, and picking one applies it', async () => {
  const ctx = context()
  await call(ctx, 'new_report', { template: 'advertiser_trend' })
  const qsr = ((await call(ctx, 'search_names', { query: 'Quick Service Restaurants', types: ['subcategory'] })).matches as Array<{ id: string }>)[0]!
  const rest = ((await call(ctx, 'search_names', { query: 'Restaurants', types: ['category'] })).matches as Array<{ id: string }>)[0]!
  const asked = await call(ctx, 'offer_names', { question: 'Which one?', ids: [qsr.id, rest.id] })
  assert.equal(asked.status, 'question')
  assert.deepEqual(ctx.view?.choices?.map((c) => c.label), ['Quick Service Restaurants', 'Restaurants'])
  assert.match(String(ctx.view?.choices?.[1]?.description), /Category/)
  const picked = await call(ctx, 'choose', { choice: '1' })
  assert.equal(picked.status, 'ready')
  assert.match(String(picked.summary), /Quick Service Restaurants/)
})

test('live GPC data only when asked for and Dev ClickHouse is configured; the sample otherwise', () => {
  assert.equal(dataSource({}), 'sample')
  assert.equal(dataSource({ REPORT_BUILDER_DATA: 'gpc' }), 'sample', 'no ClickHouse: stays on the sample')
  assert.equal(dataSource({ CLICKHOUSE_DEV_URL: 'http://ch:8123' }), 'sample', 'ClickHouse alone does not switch it')
  assert.equal(dataSource({ REPORT_BUILDER_DATA: 'gpc', CLICKHOUSE_DEV_URL: 'http://ch:8123' }), 'gpc')
})
