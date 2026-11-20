/**
 * Report Builder V2 (20 November 2026): the builder's edits, the report
 * types it offers, and when a schedule runs. None of it needs a model.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sampleEngine } from '../src/lib/report-builder/engines'
import { emptyChat, runTool, status, templatesFor, MODE_TEMPLATES_V2, type ToolContext } from '../src/lib/report-builder/tools'
import { builderCatalog, builderState, cleanPatch, switchTemplate, unknownFields } from '../src/lib/report-builder/v2/builder'
import { nextRun, whenText, zoned } from '../src/lib/report-builder/v2/cadence'
import { suggestName } from '../src/lib/report-builder/page-view'

function context(): ToolContext {
  const mem = { saved: [], offset: 0, seq: 0 }
  const engine = sampleEngine({ load: () => mem, save: () => {} })
  const chat = { ...emptyChat(), v2: true, mode: 'buyer' as const }
  return { engine, chat, downloadUrl: (spec, name) => `https://portfolio/x?name=${name}&n=${Object.keys(spec).length}` }
}
const state = (ctx: ToolContext) => builderState(ctx.engine, ctx.chat, (s) => suggestName(ctx.engine, s))

test('V2 offers the PRD templates for each mode, and V1 still offers its own', async () => {
  assert.equal(templatesFor({ v2: true, mode: 'buyer' })[0], 'competitive_media_mix')
  assert.equal(templatesFor({ v2: true, mode: 'publisher' })[0], 'zero_share')
  assert.ok(!templatesFor({ mode: 'buyer' }).includes('competitive_media_mix'), 'V1 unchanged')
  const ctx = context()
  const cat = await builderCatalog(ctx.engine, ctx.chat)
  // The sample engine has no markets, days or programs: those templates are left out rather than offered broken.
  assert.ok(cat.templates.some((t) => t.id === 'competitive_media_mix'))
  assert.ok(!cat.templates.some((t) => t.id === 'local_market_footprint'))
  for (const t of cat.templates) assert.ok(MODE_TEMPLATES_V2.buyer.includes(t.id))
})

test('the start question lists V2 report types, and choosing one fills the builder', async () => {
  const ctx = context()
  const out = (await runTool(ctx, 'new_report', {})) as { choices: Array<{ label: string }> }
  assert.equal(out.choices[0]!.label, 'Competitive media mix')
  await runTool(ctx, 'choose', { choice: '1' })
  const b = await state(ctx)
  assert.equal(b.template?.id, 'competitive_media_mix')
  assert.deepEqual(b.rows.map((r) => r.key), ['top_parent', 'advertiser', 'product'])
  assert.equal(b.columns?.key, 'media_type')
  assert.deepEqual(b.measures, ['spend', 'impressions', 'occurrences'])
  assert.equal(b.sides?.kind, 'compare')
  assert.equal(b.status, 'waiting', 'it still needs your brands')
})

test('a builder edit changes the report the tools read, with no model', async () => {
  const ctx = context()
  await runTool(ctx, 'new_report', { template: 'category_competitive_view' })
  const auto = (await ctx.engine.search('Auto Insurance', { types: ['subcategory'], limit: 1 }))[0]!
  await status(ctx, await ctx.engine.validate(ctx.chat.report!, cleanPatch({ add: { 'filters.subcategory': [auto.id] } })))
  let b = await state(ctx)
  assert.equal(b.status, 'ready')
  assert.deepEqual(b.filters.map((f) => f.items.map((i) => i.label)), [['Auto Insurance']])
  await status(ctx, await ctx.engine.validate(ctx.chat.report!, cleanPatch({ set: { columns: null, measures: ['spend'], time: { mode: 'ytd' } } })))
  b = await state(ctx)
  assert.equal(b.columns, null)
  assert.equal(b.periodText, 'Year to date')
  // Run, as the Run button does: the same tool V1 uses, no model.
  const run = (await runTool(ctx, 'run_report', { name: 'Auto' })) as { download_url: string }
  assert.ok(run.download_url.includes('name=Auto'))
})

test('a patch from the page keeps to the builder paths', () => {
  const p = cleanPatch({ set: { rows: ['advertiser'], template: 'x', 'zero_share.mode': 'wallet', 'options.top_n': 25, 'filters.market': null }, add: { 'filters.property': ['property:1'], output: ['csv'] } })
  assert.deepEqual(p, { set: { rows: ['advertiser'], 'options.top_n': 25, 'filters.market': null }, add: { 'filters.property': ['property:1'] } })
  assert.equal(cleanPatch({ set: { template: 'zero_share' } }), null)
  assert.equal(cleanPatch('nonsense'), null)
})

test('switching report type keeps who the report is about', () => {
  const cur = { template: 'competitive_mix', rows: ['advertiser'], filters: { subcategory: ['subcategory:3'] }, compare: { mine: ['advertiser:1'], rivals: ['advertiser:2'] }, options: { final_only: false } }
  const next = switchTemplate(cur, { spec: { template: 'competitive_media_mix', rows: ['top_parent', 'advertiser', 'product'], compare: { mine: [], rivals: [] } } }) as typeof cur
  assert.deepEqual(next.rows, ['top_parent', 'advertiser', 'product'])
  assert.deepEqual(next.compare, { mine: ['advertiser:1'], rivals: ['advertiser:2'] })
  assert.deepEqual(next.filters, { subcategory: ['subcategory:3'] })
  assert.equal(next.options.final_only, false)
})

test('schedules: weekly, monthly on a day, the first Monday, the last day, and once', () => {
  const tz = 'America/New_York'
  const base = { timeOfDay: '08:00', timezone: tz, dayOfWeek: null as number | null, dayOfMonth: null as number | null, runs: 0 }
  const start = zoned(2026, 11, 20, 8, 0, tz) // a Friday
  assert.equal(start.toISOString(), '2026-11-20T13:00:00.000Z', 'EST is UTC-5 in November')
  const after = new Date('2026-11-20T15:00:00Z')

  const weekly = { ...base, cadence: 'weekly', startAt: start, dayOfWeek: 1 }
  assert.equal(nextRun(weekly, after)!.toISOString(), '2026-11-23T13:00:00.000Z', 'the next Monday at 8')
  assert.equal(whenText(weekly), 'Every Monday at 08:00')

  const monthly = { ...base, cadence: 'monthly', startAt: start, dayOfMonth: 1 }
  assert.equal(nextRun(monthly, after)!.toISOString(), '2026-12-01T13:00:00.000Z')

  const firstMonday = { ...base, cadence: 'monthly', startAt: start, dayOfWeek: 1 }
  assert.equal(nextRun(firstMonday, after)!.toISOString(), '2026-12-07T13:00:00.000Z')
  assert.equal(whenText(firstMonday), 'First Monday of each month at 08:00')

  const last = { ...base, cadence: 'monthly', startAt: start, dayOfMonth: -1 }
  assert.equal(nextRun(last, after)!.toISOString(), '2026-11-30T13:00:00.000Z')

  // Summer time: 8am in New York is 12:00 UTC in July.
  const daily = { ...base, cadence: 'daily', startAt: zoned(2027, 7, 1, 8, 0, tz) }
  assert.equal(nextRun(daily, after)!.toISOString(), '2027-07-01T12:00:00.000Z', 'not before the start')

  const once = { ...base, cadence: 'once', startAt: start }
  assert.equal(nextRun(once, new Date('2026-11-01T00:00:00Z'))!.toISOString(), start.toISOString())
  assert.equal(nextRun({ ...once, runs: 1 }, after), null, 'a one-off runs once')
})

test('a field the data does not have is refused before it breaks the report', async () => {
  const ctx = context()
  const cat = (await ctx.engine.catalog()) as unknown as { dimensions: Array<{ key: string }> }
  const known = cat.dimensions.map((d) => d.key)
  // The sample data has calendar months only: the builder's Broadcast calendar would ask for broadcast_month.
  assert.deepEqual(unknownFields({ set: { rows: ['advertiser', 'broadcast_month'] } }, known), ['broadcast_month'])
  assert.deepEqual(unknownFields({ set: { columns: 'broadcast_week' } }, known), ['broadcast_week'])
  assert.deepEqual(unknownFields({ set: { rows: ['advertiser', 'month'], columns: null } }, known), [])
})

test('Azure email: the connection string, the signed request and the message', async () => {
  const { acsConfig, acsSign, acsBody, mailBlockedReason } = await import('../src/lib/report-builder/v2/mail')
  const { createHash, createHmac } = await import('node:crypto')
  const key = Buffer.from('a test key, not a real one').toString('base64')
  const env = { ACS_CONNECTION_STRING: `endpoint=https://x.unitedstates.communication.azure.com/;accesskey=${key}`, ACS_EMAIL_SENDER: 'DoNotReply@d.azurecomm.net' }
  assert.deepEqual(acsConfig(env), { endpoint: 'https://x.unitedstates.communication.azure.com', key, sender: 'DoNotReply@d.azurecomm.net' })
  assert.equal(acsConfig({ ACS_CONNECTION_STRING: env.ACS_CONNECTION_STRING }), null, 'a sender is needed too')
  assert.equal(mailBlockedReason(env), null)
  assert.match(mailBlockedReason({}) ?? '', /not set up/)

  const url = 'https://x.unitedstates.communication.azure.com/emails:send?api-version=2023-03-31'
  const now = new Date('2026-11-20T19:00:00Z')
  const h = acsSign('POST', url, '{"a":1}', key, now)
  const hash = createHash('sha256').update('{"a":1}').digest('base64')
  const sig = createHmac('sha256', Buffer.from(key, 'base64')).update(`POST\n/emails:send?api-version=2023-03-31\nFri, 20 Nov 2026 19:00:00 GMT;x.unitedstates.communication.azure.com;${hash}`).digest('base64')
  assert.deepEqual(h, { 'x-ms-date': 'Fri, 20 Nov 2026 19:00:00 GMT', 'x-ms-content-sha256': hash, authorization: `HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature=${sig}` })

  const b = acsBody({ to: ['a@b.com', 'c@d.com'], subject: 'S', text: 'T', attachments: [{ filename: 'r.xlsx', content: Buffer.from('xl'), contentType: 'application/x' }] }, 'DoNotReply@d.azurecomm.net')
  assert.deepEqual(b, { senderAddress: 'DoNotReply@d.azurecomm.net', recipients: { to: [{ address: 'a@b.com' }, { address: 'c@d.com' }] }, content: { subject: 'S', plainText: 'T' }, attachments: [{ name: 'r.xlsx', contentType: 'application/x', contentInBase64: Buffer.from('xl').toString('base64') }] })
})
