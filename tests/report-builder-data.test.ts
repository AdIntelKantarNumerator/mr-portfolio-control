/**
 * Report Builder's data layer (12 November 2026).
 *
 * The query model compiles to the SQL it should; entitlements wrapped around
 * any adapter limit what a person sees and refuse what is not included; and
 * the report engine, run on in-memory data, gives the reports it gives on
 * ClickHouse, with no database.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clickhouseAdapter, condSql, sourceFor } from '../src/lib/report-builder/data/clickhouse'
import { EntitlementError, entitlementsFor, withEntitlements } from '../src/lib/report-builder/data/entitlements'
import { memoryAdapter, type Fact } from '../src/lib/report-builder/data/memory'
import type { AggregateQuery, Availability } from '../src/lib/report-builder/data/types'
import { createLiveEngine } from '../src/lib/report-builder/live-engine'

// ---------------------------------------------------------------- a small world

const AVAIL: Availability = { firstComplete: '2026-08', through: '2026-10', prelim: '2026-11', prelimDay: '2026-11-05' }
const N = (dim: string, id: number, name: string, context = '') => ({ id: `${dim}:${id}`, name, context })
const NBC = { property: N('property', 1, 'NBC', 'Network TV · Comcast'), media_type: N('media_type', 101, 'Network TV'), media_owner: N('media_owner', 11, 'Comcast'), market: N('market', -1, 'National'), country: N('country', 1, 'United States', 'US') }
const CBS = { property: N('property', 2, 'CBS', 'Network TV · Paramount'), media_type: N('media_type', 101, 'Network TV'), media_owner: N('media_owner', 12, 'Paramount'), market: N('market', -1, 'National'), country: N('country', 1, 'United States', 'US') }
const ESPN = { property: N('property', 3, 'ESPN', 'Cable TV · Disney'), media_type: N('media_type', 102, 'Cable TV'), media_owner: N('media_owner', 13, 'Disney'), market: N('market', -1, 'National'), country: N('country', 1, 'United States', 'US') }
const CARS = { industry: N('industry', 1, 'Automotive'), category: N('category', 10, 'Cars & Lt Trucks', 'Automotive'), subcategory: N('subcategory', 100, 'SUVs', 'Automotive > Cars & Lt Trucks') }
const who = (adv: number, name: string) => ({ advertiser: N('advertiser', adv, name, `${name} Inc.`), top_parent: N('top_parent', adv, `${name} Inc.`), product: N('product', adv * 10, `${name} SUV`, name) })
const TOYOTA = who(1, 'Toyota')
const HONDA = who(2, 'Honda')
const FORD = who(3, 'Ford')

/** Every day of September and October 2026: Toyota on NBC and ESPN, Honda on CBS only, Ford on NBC and CBS. */
function world(): Fact[] {
  const facts: Fact[] = []
  for (let d = Date.UTC(2026, 8, 1); d <= Date.UTC(2026, 9, 31); d += 86_400_000) {
    const date = new Date(d).toISOString().slice(0, 10)
    const add = (w: object, where: object, spend: number) => facts.push({ date, ids: { ...CARS, ...w, ...where }, spend, occurrences: 2, impressions: 1000 })
    add(TOYOTA, NBC, 100)
    add(TOYOTA, ESPN, 50)
    add(HONDA, CBS, 80)
    add(FORD, NBC, 30)
    add(FORD, CBS, 30)
  }
  facts.push({ date: '2026-10-15', ids: { ...CARS, ...HONDA, ...NBC }, spend: 999, occurrences: 1, promo: true })
  return facts
}

const engineOn = (adapter = memoryAdapter(world(), AVAIL)) => {
  let mem = { saved: [], offset: 0, seq: 0 }
  return createLiveEngine({ store: { load: () => mem, save: (s) => void (mem = s as typeof mem) }, adapter, now: () => '2026-11-12T00:00:00Z' })
}
const OCT = { mode: 'static', start: '2026-10', end: '2026-10' }

// ---------------------------------------------------------------- the SQL

test('conditions compile to SQL: an empty list matches nothing, ids keep to their dimension, months become year_month', () => {
  assert.equal(condSql({ in: 'advertiser', values: [] }), '0')
  assert.equal(condSql({ in: 'advertiser', values: ['advertiser:7', 'property:9', 'advertiser:x'] }), 'entity_id IN (7)')
  assert.equal(condSql({ in: 'month', values: ['2026-10', '2026-09'] }), 'year_month IN (202610,202609)')
  assert.equal(condSql({ anyOf: ['property:1', 'media_type:101', 'month:2026-10'] }), '(coalesce(media_entity_id, 0) IN (1) OR coalesce(media_id, 0) IN (101))')
  assert.equal(condSql({ anyOf: [] }), '0')
  assert.equal(condSql({ not: { and: [{ in: 'property', values: ['property:1'] }, { named: 'property' }] } }), "NOT (coalesce(media_entity_id, 0) IN (1) AND media_entity_name != '')")
  assert.match(condSql({ tuples: ['advertiser', 'month'], values: [['advertiser:5', '2026-10']] }), /\(toString\(entity_id\), toString\(year_month\)\) IN \(\('5', '202610'\)\)/)
  assert.equal(condSql({ in: 'broadcast_week', values: ["2026-10-05'; DROP"] }), "toString(toMonday(start_date)) IN ('2026-10-05')")
})

test('a query becomes one grouped statement: conditional measures, having, order, limit; promos left out unless asked', () => {
  const ch = clickhouseAdapter({ query: async () => [] })
  const q: AggregateQuery = {
    period: { from: '2026-08-01', to: '2026-10-31' },
    where: { in: 'subcategory', values: ['subcategory:100'] },
    groupBy: ['advertiser'],
    measures: [{ as: 'spend', measure: 'spend' }, { as: 'mine', measure: 'spend', where: { anyOf: ['property:1'] } }],
    having: [{ as: 'mine', op: '=', value: 0 }],
    orderBy: [{ by: 'spend', desc: true }],
    limit: 10,
  }
  const sql = ch.sqlFor(q)
  assert.match(sql.rows, /FROM gpc_summary\.property_product_summary_month WHERE year_month BETWEEN 202608 AND 202610 AND coalesce\(is_promo, 0\) = 0/)
  assert.match(sql.rows, /toFloat64\(sumIf\(cost_share_v, \(coalesce\(media_entity_id, 0\) IN \(1\)\)\)\) AS m_mine/)
  assert.match(sql.rows, /GROUP BY k_advertiser HAVING m_mine = 0\) ORDER BY m_spend DESC LIMIT 10$/)
  assert.match(sql.totals, /sum\(m_spend\) AS m_spend, sum\(m_mine\) AS m_mine, count\(\) AS n/)
  assert.doesNotMatch(ch.sqlFor({ ...q, includePromos: true }).rows, /is_promo/)
  const days = ch.sqlFor({ ...q, period: { from: '2026-10-05', to: '2026-10-18', daily: true } }, '(DAILY)')
  assert.match(days.rows, /FROM \(DAILY\) WHERE year_month BETWEEN 202609 AND 202611 AND start_date BETWEEN '2026-10-05' AND '2026-10-18'/)
  assert.throws(() => ch.sqlFor({ ...q, measures: [{ as: 'x; DROP', measure: 'spend' }] }), /Bad measure name/)
})

test('results come back with full ids, totals and a count', async () => {
  const ch = clickhouseAdapter({
    query: async <T>(sql: string) =>
      (sql.includes('count() AS n') ? [{ m_v: 30, n: 2 }] : [{ k_advertiser: '7', n_advertiser: 'Toyota', m_v: 20 }, { k_advertiser: '8', n_advertiser: 'Honda', m_v: 10 }]) as T[],
  })
  const r = await ch.aggregate({ period: { from: '2026-10-01', to: '2026-10-31' }, groupBy: ['advertiser'], measures: [{ as: 'v', measure: 'spend' }], withCount: true, withTotals: true })
  assert.deepEqual(r.rows[0], { keys: { advertiser: { id: 'advertiser:7', name: 'Toyota' } }, values: { v: 20 } })
  assert.equal(r.count, 2)
  assert.deepEqual(r.totals, { v: 30 })
})

// ---------------------------------------------------------------- entitlements

test('entitlements limit every query, search and label, whatever the adapter', async () => {
  const base = memoryAdapter(world(), AVAIL)
  const tvOnly = withEntitlements(base, { only: { media_type: ['media_type:101'] } })
  const q: AggregateQuery = { period: { from: '2026-10-01', to: '2026-10-31' }, groupBy: ['property'], measures: [{ as: 'v', measure: 'spend' }], withTotals: true }
  const open = await base.aggregate(q)
  const limited = await tvOnly.aggregate(q)
  assert.equal(open.rows.length, 3)
  assert.deepEqual(limited.rows.map((r) => r.keys.property!.name).sort(), ['CBS', 'NBC'], 'no Cable TV')
  assert.equal(limited.totals!.v, open.totals!.v - 50 * 31)
  const espn = await tvOnly.search({ parts: [{ dim: 'property', text: 'ESPN' }], month: '2026-10', limit: 5 })
  assert.deepEqual(espn, [])
  assert.deepEqual((await tvOnly.labels(['media_type:102', 'media_type:101'])).map((l) => l.name), ['Network TV'])
  assert.equal(withEntitlements(base, null), base, 'no limits: the adapter itself')
})

test('what is not included is refused, so it is never shown as zero', async () => {
  const base = memoryAdapter(world(), AVAIL)
  const e = withEntitlements(base, { measures: ['spend', 'occurrences'], daily: false, from: '2026-10' })
  const q: AggregateQuery = { period: { from: '2026-10-01', to: '2026-10-31' }, groupBy: [], measures: [{ as: 'v', measure: 'impressions' }] }
  await assert.rejects(e.aggregate(q), (err: unknown) => err instanceof EntitlementError && err.kind === 'measure' && /impressions/.test(err.message))
  await assert.rejects(e.aggregate({ ...q, measures: [{ as: 'v', measure: 'spend' }], groupBy: ['broadcast_week'] }), (err: unknown) => err instanceof EntitlementError && err.kind === 'daily')
  await assert.rejects(e.aggregate({ ...q, measures: [{ as: 'v', measure: 'spend' }], period: { from: '2026-09-01', to: '2026-10-31' } }), (err: unknown) => err instanceof EntitlementError && /Oct 2026/.test(err.message))
  assert.equal((await e.availability()).firstComplete, '2026-10')
})

test('entitlements per person come from configuration; a broken setting shows nothing rather than everything', () => {
  const env = { REPORT_BUILDER_ENTITLEMENTS: JSON.stringify({ 'pat@x.com': { measures: ['spend'] }, '*': { daily: false } }) }
  assert.deepEqual(entitlementsFor('Pat@X.com', env), { measures: ['spend'] })
  assert.deepEqual(entitlementsFor('sam@x.com', env), { daily: false })
  assert.equal(entitlementsFor('sam@x.com', {}), null)
  assert.deepEqual(entitlementsFor('sam@x.com', { REPORT_BUILDER_ENTITLEMENTS: '{oops' }), { only: { media_type: [] } })
})

// ---------------------------------------------------------------- the engine on in-memory data

test('the report engine runs on any adapter: a monthly trend adds up, and promos stay out', async () => {
  const engine = engineOn()
  const v = await engine.validate({ template: 'advertiser_trend', rows: ['advertiser'], columns: 'month', measures: ['spend'], filters: { category: ['category:10'] }, time: { mode: 'static', start: '2026-09', end: '2026-10' } })
  assert.ok(v.ok, JSON.stringify(v.errors))
  const r = await engine.run(v.spec)
  assert.deepEqual(r.columns.map((c) => c.label), ['Advertiser', 'Sep 2026', 'Oct 2026', 'Total spend'])
  assert.deepEqual(r.rows[0], ['Toyota', 150 * 30, 150 * 31, 150 * 61])
  assert.equal(r.total, (150 + 80 + 60) * 61, 'the Honda promo is not counted')
  assert.equal((await engine.search('toy', { types: ['advertiser'] }))[0]!.label, 'Toyota')
})

test('country: a breakout and a filter that narrows like market', async () => {
  const engine = engineOn()
  const r = await engine.run({ template: 'summary', rows: ['country'], measures: ['spend'], filters: { country: ['country:1'], media_type: ['media_type:102'] }, time: OCT })
  assert.deepEqual(r.rows, [['United States', 50 * 31]])
  const none = await engine.run({ template: 'summary', rows: ['advertiser'], measures: ['spend'], filters: { country: ['country:190'] }, time: OCT })
  assert.equal(none.rows.length, 0)
  assert.equal(condSql({ in: 'country', values: ['country:190'] }), 'coalesce(country_id, 0) IN (190)')
})

test('reports keep to the US unless they name a country or break out by country', async () => {
  const uk = { date: '2026-10-10', ids: { ...TOYOTA, property: N('property', 9, 'UK AVOD'), media_type: N('media_type', 110, 'AVOD'), media_owner: N('media_owner', 19, 'Owner'), market: N('market', -1, 'National'), country: N('country', 190, 'United Kingdom', 'UK') }, spend: 1000, occurrences: 1 }
  const engine = engineOn(memoryAdapter([...world(), uk], AVAIL))
  const q = { template: 'summary', rows: ['advertiser'], measures: ['spend'], filters: { advertiser: ['advertiser:1'] }, time: OCT }
  assert.equal((await engine.run(q)).total, 150 * 31, 'the UK spend is left out by default')
  assert.equal((await engine.run({ ...q, filters: { ...q.filters, country: ['country:190'] } })).total, 1000, 'named, it is the UK only')
  const by = await engine.run({ ...q, rows: ['country'] })
  assert.deepEqual(by.rows.map((r) => r[0]).sort(), ['United Kingdom', 'United States'], 'broken out by country: every country')
})

test('a market narrows the media, never widens it: market AND media type', async () => {
  const engine = engineOn()
  const none = await engine.run({ template: 'summary', rows: ['market'], measures: ['spend'], filters: { market: ['market:999'], media_type: ['media_type:101'] }, time: OCT })
  assert.equal(none.rows.length, 0, 'no spend in market 999, whatever the media type')
  const nat = await engine.run({ template: 'summary', rows: ['market'], measures: ['spend'], filters: { market: ['market:-1'], media_type: ['media_type:102'] }, time: OCT })
  assert.deepEqual(nat.rows, [['National', 50 * 31]], 'National and Cable TV: Toyota on ESPN only')
})

test('broadcast months:the Monday-to-Sunday weeks ending in each month, read by day', async () => {
  const engine = engineOn()
  const r = await engine.run({ template: 'advertiser_trend', rows: ['advertiser'], columns: 'broadcast_month', measures: ['spend'], filters: { advertiser: ['advertiser:1'] }, time: { mode: 'static', start: '2026-09', end: '2026-10' } })
  assert.deepEqual(r.columns.filter((c) => c.colId).map((c) => c.label), ['Bcst Sep 2026', 'Bcst Oct 2026'])
  // Bcst Sep 2026 is Mon 31 Aug - Sun 27 Sep (the data starts 1 Sep: 27 days); Bcst Oct is Mon 28 Sep - Sun 25 Oct (28 days).
  assert.deepEqual(r.rows[0], ['Toyota', 150 * 27, 150 * 28, 150 * 55])
  assert.ok(r.notes.some((n) => /Broadcast months: Aug 31, 2026 to Oct 25, 2026/.test(n)), r.notes.join(' | '))
})

test('zero share, share of wallet by broadcast week, and a comparison with % across, on in-memory data', async () => {
  const engine = engineOn()
  const zero = await engine.run({ template: 'zero_share', rows: ['advertiser'], measures: ['spend'], zero_share: { mine: ['property:1'], versus: ['media_type:101'], mode: 'zero' }, time: OCT })
  assert.deepEqual(zero.rows, [['Honda', 80 * 31]], 'Honda buys CBS, not NBC; Toyota and Ford already buy NBC')

  const wallet = await engine.run({ template: 'share_of_wallet', rows: ['advertiser'], columns: 'broadcast_week', measures: ['spend'], zero_share: { mine: ['property:1'], versus: ['media_type:101'], mode: 'wallet' }, time: { mode: 'static', start: '2026-10-05', end: '2026-10-18' } })
  assert.deepEqual(wallet.columns.filter((c) => c.colId).map((c) => c.colId), ['2026-10-05', '2026-10-05', '2026-10-05', '2026-10-12', '2026-10-12', '2026-10-12'])
  const ford = wallet.rows.find((r) => r[0] === 'Ford')!
  assert.deepEqual(ford.slice(1, 4), [30 * 7, 30 * 7, 50], 'a week: half with you, half with competitors')

  const sov = await engine.run({ template: 'share_of_voice', rows: ['advertiser'], columns: 'month', measures: ['spend'], calcs: ['share', 'share_across'], compare: { mine: ['advertiser:1'], rivals: ['advertiser:2'] }, time: { mode: 'static', start: '2026-09', end: '2026-10' } })
  assert.equal(sov.rows[0]![0], 'Toyota (you)')
  assert.equal(sov.rows.length, 2, 'only you and your competitors')
  const sep = sov.columns.findIndex((c) => c.colId === '2026-09' && c.measure === '% of row')
  assert.equal(sov.rows[0]![sep], Math.round((30 / 61) * 1000) / 10)
})

test('a report outside the entitlement becomes a problem with a fix, not an error or a zero', async () => {
  const engine = engineOn(withEntitlements(memoryAdapter(world(), AVAIL), { only: { media_type: ['media_type:101'] }, measures: ['spend', 'occurrences'] }))
  const v = await engine.validate({ template: 'advertiser_trend', rows: ['advertiser'], columns: 'month', measures: ['spend', 'impressions'], filters: { category: ['category:10'] }, time: OCT })
  assert.equal(v.ok, false)
  assert.equal(v.errors[0]!.code, 'not_entitled')
  assert.match(v.errors[0]!.message, /impressions/)
  const fixed = await engine.validate(v.spec, v.errors[0]!.fixes[0]!.patch)
  assert.ok(fixed.ok)
  const r = await engine.run(fixed.spec)
  assert.equal(r.total, (100 + 80 + 60) * 31, 'Network TV only: no ESPN')
})

// ---------------------------------------------------------------- more dimensions (12 November 2026)

test('daypart and league switch a report to the daily tables, as a breakout or only a filter; spot length to the creative data', () => {
  const m = { from: '2026-10-01', to: '2026-10-31' }
  const spend = [{ as: 'v', measure: 'spend' as const }]
  assert.equal(sourceFor({ period: m, groupBy: ['advertiser'], measures: spend }), 'month')
  assert.equal(sourceFor({ period: m, groupBy: ['daypart'], measures: spend }), 'daily')
  assert.equal(sourceFor({ period: m, groupBy: ['advertiser'], where: { in: 'league', values: ['league:1'] }, measures: spend }), 'daily', 'a filter alone is enough')
  assert.equal(sourceFor({ period: m, groupBy: ['advertiser'], measures: [{ as: 'v', measure: 'spend', where: { anyOf: ['daypart:3'] } }] }), 'daily', 'and inside a measure')
  assert.equal(sourceFor({ period: m, groupBy: ['length'], measures: spend }), 'creative_month')
  assert.equal(sourceFor({ period: { ...m, daily: true }, groupBy: ['length', 'broadcast_week'], measures: spend }), 'creative_daily')

  const ch = clickhouseAdapter({ query: async () => [] })
  const byDaypart = ch.sqlFor({ period: m, groupBy: ['daypart'], measures: spend }, '(DAILY)')
  assert.match(byDaypart.rows, /FROM \(DAILY\) WHERE year_month BETWEEN 202609 AND 202611 AND start_date BETWEEN '2026-10-01' AND '2026-10-31' AND coalesce\(is_promo/)
  const byLength = ch.sqlFor({ period: m, groupBy: ['length'], measures: spend })
  assert.match(byLength.rows, /FROM gpc_creative\.creative_product_media_summary_month WHERE year_month BETWEEN 202610 AND 202610 GROUP BY k_length/)
  assert.doesNotMatch(byLength.rows, /is_promo/, 'the creative data has no promo flags')
  assert.equal(ch.supports!(['length', 'advertiser', 'media_type']), null)
  assert.deepEqual(ch.supports!(['length', 'program', 'market'])!.conflicts, ['program', 'market'])
})

const CC = (dim: string, id: number, name: string) => ({ id: `${dim}:${id}`, name })
function detailWorld(): Fact[] {
  const out: Fact[] = []
  for (const date of ['2026-10-05', '2026-10-06']) {
    const base = { ...CARS, ...TOYOTA, ...NBC }
    out.push({ date, ids: { ...base, daypart: CC('daypart', 1, 'Prime Time'), language: CC('language', 1, 'English') }, spend: 100, occurrences: 1 })
    out.push({ date, ids: { ...base, daypart: CC('daypart', 1, 'Prime Time'), language: CC('language', 2, 'Spanish') }, spend: 10, occurrences: 1 })
    out.push({ date, ids: { ...base, daypart: CC('daypart', 2, 'Early Fringe'), language: CC('language', 2, 'Spanish') }, spend: 1, occurrences: 1 })
  }
  return out
}

test('details each narrow on their own: Prime Time and Spanish means both, and they break out as rows or columns', async () => {
  const engine = engineOn(memoryAdapter(detailWorld(), AVAIL))
  const both = await engine.run({ template: 'x', rows: ['advertiser'], measures: ['spend'], filters: { daypart: ['daypart:1'], language: ['language:2'] }, time: OCT })
  assert.equal(both.total, 20, 'Spanish in Prime Time only')
  assert.match(both.summary, /Prime Time, Spanish/)
  const grid = await engine.run({ template: 'x', rows: ['daypart'], columns: 'language', measures: ['spend'], scope: 'all', time: OCT })
  assert.deepEqual(grid.columns.map((c) => c.label), ['Daypart', 'English', 'Spanish', 'Total spend'])
  assert.deepEqual(grid.rows[0], ['Prime Time', 200, 20, 220])
})

test('spot length with program cannot be read together: a problem with both fixes, and suggestions skip what would clash', async () => {
  const ch = clickhouseAdapter({ query: async () => [] })
  const adapter = { ...memoryAdapter(world(), AVAIL), supports: ch.supports }
  const engine = engineOn(adapter)
  const v = await engine.validate({ template: 'x', rows: ['length', 'program'], measures: ['spend'], scope: 'all', time: OCT })
  assert.equal(v.errors[0]!.code, 'cannot_combine')
  assert.match(v.errors[0]!.message, /Spot length comes from the creative data, which does not record program/)
  assert.deepEqual(v.errors[0]!.fixes.map((f) => f.label), ['Drop spot length', 'Drop program'])
  const fixed = await engine.validate(v.spec, v.errors[0]!.fixes[1]!.patch)
  assert.deepEqual(fixed.spec.rows, ['length'])

  const zero = await engine.validate({ template: 'zero_share', rows: ['advertiser'], measures: ['spend'], zero_share: { mine: ['property:1'], versus: ['media_type:101'], mode: 'zero' }, time: OCT })
  const labels = zero.refinements.map((r) => r.label)
  assert.ok(labels.includes('Break out by daypart') && labels.includes('Break out by program'), labels.join(' | '))
  const buyer = await engine.validate({ template: 'share_of_voice', rows: ['advertiser'], measures: ['spend'], calcs: ['share'], compare: { mine: ['advertiser:1'], rivals: ['advertiser:2'] }, time: OCT })
  assert.ok(buyer.refinements.some((r) => r.label === 'Break out by spot length'))
})
