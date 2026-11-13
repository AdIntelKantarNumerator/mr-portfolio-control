/**
 * Importing 360 Explore reports (12 November 2026).
 *
 * A 360 spec as load:360 stores it reads into plain terms; converting it
 * gives a GPC report and a note for everything that changes - dropped,
 * approximate or changed, each with why - and refuses report types Report
 * Builder cannot build, offering the nearest. Names are matched best effort:
 * several GPC entities for one 360 name is fine, and is said.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describe, dayIso, type Lookup, type Raw360Spec } from '../src/lib/import360/decode'
import { convert360, gpcSpelling, looseKey, similarNames, type Candidate, type Matcher } from '../src/lib/import360/convert'
import { normName, type DimKey } from '../src/lib/report-builder/data/types'
import { decide, landingOf } from '../src/lib/import360/creatives'

const NAMES: Record<string, string> = {
  '139:7298430': 'Tremfya',
  '139:1': 'Rinvoq',
  '102:5': 'Procter & Gamble Co',
  '301:3': 'Network TV',
  '301:14': 'Span Lang Net TV',
  '301:42': 'Search',
  '333:2': 'HOUSE',
  '500:46': 'NEW YORK,NY',
  '100:9': 'Novartis : Heart Failure',
}
const TYPES: Record<number, string> = { 139: 'Brand', 102: 'Parent', 301: 'Media', 333: 'houseadtype', 700: 'time', 735: 'cmonth', 460: 'mmcreative', 500: 'Market', 100: 'Product' }
const look: Lookup = {
  name: (e, id) => NAMES[`${e}:${id}`],
  type: (e) => TYPES[e],
  report: (id) => ({ 2301: 'Trend', 2307: 'Summary', 803: 'TV Schedule' })[id],
  measure: (e) => ({ 800: '$ - Expenditures', 801: '# - Units', 802: 'GRPs' })[e],
  calc: () => undefined,
}

// The sample from production: "tremfya 2025", a Trend by brand, media group and media, a column per month.
const TREMFYA: Raw360Spec = {
  rpttype: 2301,
  title: null,
  cols: [
    { type: 1, entmaj: 139, entmin: 2, order: 1, sort: 3, total: 0, calc: 0, demo: 0, name: 'Brand' },
    { type: 1, entmaj: 301, entmin: 2, order: 2, sort: 4, total: 0, calc: 0, demo: 0, name: 'Media' },
    { type: 1, entmaj: 460, entmin: 2, order: 3, sort: 0, total: 0, calc: 0, demo: 0, name: 'Creative' },
    { type: 2, entmaj: 700, entmin: 85, order: 4, sort: 3, total: 1, calc: 0, demo: 0, name: 'Time Period' },
    { type: 3, entmaj: 800, entmin: 36, order: 5, sort: 0, total: 0, calc: 2, demo: 0, name: ' $' },
    { type: 3, entmaj: 802, entmin: 36, order: 6, sort: 0, total: 0, calc: 0, demo: 7, name: 'GRPs' },
  ],
  opts: [{ opt: 16, entmaj: 0, entmin: 0, str: null, d1: null, d2: null, long: 0, dbl: null }],
  sel: [
    { mpt: 3, e: 139, ids: [7298430] },
    { mpt: 12, e: 301, ids: [3, 14, 42] },
    { mpt: 12, e: 333, ids: [], ex: [2] },
    { mpt: 6, e: 735, ids: [], ranges: [[45656, 45686], [45687, 45714], [45715, 45745], [45746, 45775]] },
  ],
}

/** GPC as the fake knows it: two Tremfya products, the media types, a P&G spelled GPC's way, New York. */
const GPC: Partial<Record<DimKey, Candidate[]>> = {
  product: [
    { id: 'product:1', name: 'Tremfya', context: 'Janssen', spend: 100 },
    { id: 'product:2', name: 'TREMFYA', context: 'Johnson & Johnson', spend: 50 },
    { id: 'product:3', name: 'Heart Failure', context: 'Novartis Pharmaceuticals', spend: 5 },
    { id: 'product:4', name: 'Heart Failure', context: 'Acme Labs', spend: 7 },
  ],
  media_type: [
    { id: 'media_type:101', name: 'Network TV', context: '', spend: 1 },
    { id: 'media_type:106', name: 'Spanish Language Network TV', context: '', spend: 1 },
  ],
  top_parent: [{ id: 'top_parent:9', name: 'The Procter & Gamble Company', context: '', spend: 10 }],
  market: [
    { id: 'market:46', name: 'New York', context: '', spend: 1 },
    { id: 'market:-1', name: 'National', context: '', spend: 100 },
  ],
}
const matcher: Matcher = {
  async match(dim, names) {
    const out = new Map<string, Candidate[]>()
    const want = new Set(names.map(normName))
    for (const c of GPC[dim] ?? []) if (want.has(normName(c.name))) out.set(normName(c.name), [...(out.get(normName(c.name)) ?? []), c])
    return out
  },
  async search(dim, text) {
    return (GPC[dim] ?? []).filter((c) => c.name.toLowerCase().includes(text.toLowerCase()))
  },
}

test('a stored 360 spec reads as its type, layout, measures, selections and period', () => {
  assert.equal(dayIso(46021), '2026-01-01', '360 counts days from 1 January 1900')
  const d = describe(TREMFYA, look)
  assert.equal(d.type.name, 'Trend')
  assert.deepEqual(d.rows.map((r) => r.label), ['Brand', 'Media', 'Creative'])
  assert.deepEqual(d.columns.map((r) => r.label), ['Time Period'])
  assert.deepEqual(d.data.map((r) => r.label), ['$ - Expenditures', 'GRPs'])
  assert.deepEqual(d.selections.find((s) => s.e === 139)!.picked, [{ id: 7298430, name: 'Tremfya' }])
  assert.equal(d.time.label, 'Jan 2025 – Apr 2025')
  assert.equal(d.time.e, 735)
})

test('the Tremfya report becomes a GPC trend, and every change is explained', async () => {
  const c = await convert360(describe(TREMFYA, look), matcher)
  assert.equal(c.verdict, 'partial')
  assert.deepEqual(c.spec.rows, ['product', 'media_type'])
  assert.equal(c.spec.columns, 'month')
  assert.deepEqual(c.spec.measures, ['spend'])
  assert.deepEqual(c.spec.calcs, ['share_across'], 'horizontal % is % across')
  assert.deepEqual(c.spec.time, { mode: 'static', start: '2026-08', end: '2026-10' })
  const filters = c.spec.filters as Record<string, string[]>
  assert.deepEqual(filters.product, ['product:1', 'product:2'], 'one 360 brand, two GPC products: both, and said')
  assert.deepEqual(filters.media_type, ['media_type:101', 'media_type:106'], '"Span Lang Net TV" is Spanish Language Network TV')
  const say = (re: RegExp) => c.notes.find((n) => re.test(n.what))
  assert.equal(say(/^Brand$/), undefined, "GPC's product is the brand: no caveat")
  assert.equal(say(/Creative rows/)!.impact, 'dropped')
  assert.match(say(/^GRPs$/)!.why, /no ratings/)
  assert.equal(say(/^Media: Search/)!.impact, 'dropped')
  assert.match(say(/matched more than one GPC entity/)!.did, /All of them are included/)
  assert.match(say(/house ads/i)!.why, /promos and public service announcements/)
  assert.match(say(/^Period: Jan 2025 – Apr 2025$/)!.did, /Aug – Oct 2026/)
  assert.equal(say(/Row order/)!.impact, 'changed')
  for (const n of c.notes) assert.ok(n.why && n.did, `every note says why and what was done: ${n.what}`)
})

test('a TV schedule is refused with the reason, and the nearest report is offered as a summary', async () => {
  const d = describe({ ...TREMFYA, rpttype: 803 }, look)
  const refused = await convert360(d, matcher)
  assert.equal(refused.verdict, 'refused')
  assert.match(refused.refusal!, /individual airings/)
  const nearest = await convert360(d, matcher, { nearest: true })
  assert.equal(nearest.spec.template, 'summary')
  assert.match(nearest.notes[0]!.did, /nearest report/)
})

test('spelling: markets lose their state, products their advertiser, companies their Inc and Co', async () => {
  assert.deepEqual(gpcSpelling('market', 'ABILENE-SWEETWATER,TX'), { name: 'ABILENE-SWEETWATER', context: null })
  assert.deepEqual(gpcSpelling('market', '* TOTAL US'), { name: 'National', context: null })
  assert.deepEqual(gpcSpelling('product', 'Novartis : Heart Failure'), { name: 'Heart Failure', context: 'Novartis' })
  assert.equal(looseKey('Procter & Gamble Co'), looseKey('The Procter & Gamble Company'))

  const spec: Raw360Spec = {
    rpttype: 2307,
    title: null,
    cols: [
      { type: 1, entmaj: 102, entmin: 2, order: 1, sort: 0, total: 0, calc: 0, demo: 0, name: 'Parent' },
      { type: 3, entmaj: 801, entmin: 36, order: 2, sort: 0, total: 0, calc: 0, demo: 0, name: '#' },
    ],
    opts: [],
    sel: [
      { mpt: 3, e: 102, ids: [5] },
      { mpt: 3, e: 100, ids: [9] },
      { mpt: 2, e: 500, ids: [46] },
    ],
  }
  const c = await convert360(describe(spec, look), matcher)
  const filters = c.spec.filters as Record<string, string[]>
  assert.deepEqual(filters.top_parent, ['top_parent:9'], 'found on the second, looser pass')
  assert.ok(c.notes.some((n) => /different spelling/.test(n.what) && /Procter & Gamble Co → The Procter & Gamble Company/.test(n.did)))
  assert.deepEqual(filters.product, ['product:3'], "Novartis's Heart Failure, not Acme's")
  assert.deepEqual(filters.market, ['market:46'])
  assert.deepEqual(c.spec.measures, ['occurrences'])
  assert.ok(!c.notes.some((n) => /occurrences/i.test(n.why + n.what)), 'units and occurrences are the same thing: no note')
})

test('360 Total US (market -1) is the GPC National market, not every market', async () => {
  const spec: Raw360Spec = {
    rpttype: 2307,
    title: null,
    cols: [{ type: 1, entmaj: 118, entmin: 2, order: 1, sort: 0, total: 0, calc: 0, demo: 0, name: 'Advertiser' }, { type: 3, entmaj: 800, entmin: 36, order: 2, sort: 0, total: 0, calc: 0, demo: 0, name: '$' }],
    opts: [],
    sel: [{ mpt: 12, e: 500, ids: [-1] }],
  }
  const totalUs: Lookup = { ...look, name: (e, id) => (e === 500 && id === -1 ? '* TOTAL US' : look.name(e, id)) }
  const c = await convert360(describe(spec, totalUs), matcher)
  assert.deepEqual((c.spec.filters as Record<string, string[]>).market, ['market:-1'])
  assert.ok(!c.notes.some((n) => /market/i.test(n.what)), `no note: ${c.notes.map((n) => n.what).join('; ')}`)
})

// ---------------------------------------------------------------- names found by their creatives

test('an advertiser not found by name is listed for the creative lookup; a choice settles it, or drops it', async () => {
  const spec: Raw360Spec = {
    rpttype: 2307,
    title: null,
    cols: [{ type: 1, entmaj: 118, entmin: 2, order: 1, sort: 0, total: 0, calc: 0, demo: 0, name: 'Advertiser' }, { type: 3, entmaj: 800, entmin: 36, order: 2, sort: 0, total: 0, calc: 0, demo: 0, name: '$' }],
    opts: [],
    sel: [{ mpt: 3, e: 118, ids: [2580834, 4780822] }],
  }
  const names: Lookup = { ...look, name: (e, id) => (e === 118 ? ({ 2580834: 'McDonalds Restaurant', 4780822: 'Michelob Ultra' } as Record<number, string>)[id] : look.name(e, id)) }
  const d = describe(spec, names)
  const before = await convert360(d, matcher)
  assert.deepEqual(before.unresolved.map((u) => u.name), ['McDonalds Restaurant', 'Michelob Ultra'])

  const after = await convert360(d, matcher, {
    choices: {
      '118:2580834': { ids: ['advertiser:13663'], names: ["McDonald's"], how: 'creatives', why: "99% of its creatives' spend is on McDonald's in GPC" },
      '118:4780822': null,
    },
  })
  assert.deepEqual(after.unresolved, [])
  assert.deepEqual((after.spec.filters as Record<string, string[]>).advertiser, ['advertiser:13663'])
  assert.ok(after.notes.some((n) => /found by its creatives/.test(n.what) && /McDonalds Restaurant → McDonald's/.test(n.did)))
  assert.ok(after.notes.some((n) => n.impact === 'dropped' && /Michelob Ultra/.test(n.what) && /You chose to leave it out/.test(n.did)))
  assert.ok(!after.notes.some((n) => /not found in GPC \(/.test(n.what)), 'nothing left unexplained')
  assert.deepEqual(after.lists.find((l) => l.from.includes('Michelob Ultra')), { label: after.lists.find((l) => l.from.includes('Michelob Ultra'))!.label, from: ['McDonalds Restaurant', 'Michelob Ultra'], to: [{ id: 'advertiser:13663', name: "McDonald's" }] })
})

test('the creative lookup decides: one GPC entity with most of the spend, unless it is far bigger than the 360 advertiser', () => {
  const flows = (rows: Array<[string, string, string, string, number]>) => rows.map(([gpcId, gpcName, gpcProductId, gpcProductName, spend]) => ({ gpcId, gpcName, gpcParentId: gpcId, gpcParentName: gpcName, gpcProductId, gpcProductName, spend }))
  // McDonalds Restaurant: 98.7% on McDonald's.
  const mcd = landingOf(flows([['13663', "McDonald's", '1', 'Big Mac', 987], ['11310', 'Red Bull', '2', 'Red Bull', 13]]))
  const sure = decide(118, mcd, () => 1500)
  assert.equal(sure.status, 'matched')
  assert.deepEqual(sure.pick!.ids, ['advertiser:13663'])
  assert.match(sure.pick!.why, /99% of its creatives' spend is on McDonald's/)

  // A brand-named advertiser landing on its whole brewer: the products instead.
  const ultra = landingOf(flows([['500', 'Anheuser-Busch', '7', 'Michelob Ultra', 900], ['500', 'Anheuser-Busch', '8', 'Michelob Ultra Zero', 100]]))
  const narrowed = decide(118, ultra, () => 1_000_000)
  assert.equal(narrowed.status, 'matched')
  assert.deepEqual(narrowed.pick!.ids, ['product:7'])

  // Spread over several: the person picks, from suggestions.
  const spread = landingOf(flows([['1', 'A', '11', 'a', 40], ['2', 'B', '12', 'b', 35], ['3', 'C', '13', 'c', 25]]))
  const ask = decide(118, spread)
  assert.equal(ask.status, 'uncertain')
  assert.deepEqual(ask.suggestions.slice(0, 3).map((s) => s.name), ['A', 'B', 'C'])
  assert.equal(decide(118, landingOf([])).status, 'uncertain', 'no creatives: uncertain')
})

test('markets match by id, which 360 and GPC share; a name that differs too much is said', async () => {
  assert.ok(similarNames('EL PASO(LAS CRUCES),TX', 'EL PASO'))
  assert.ok(similarNames('* TOTAL US', 'National'))
  assert.ok(!similarNames('BOSTON,MA', 'Seattle'))
  const spec: Raw360Spec = {
    rpttype: 2307,
    title: null,
    cols: [{ type: 1, entmaj: 500, entmin: 2, order: 1, sort: 0, total: 0, calc: 0, demo: 0, name: 'Market' }, { type: 3, entmaj: 800, entmin: 36, order: 2, sort: 0, total: 0, calc: 0, demo: 0, name: '$' }],
    opts: [],
    sel: [{ mpt: 2, e: 500, ids: [91, 7, 999] }],
  }
  const names: Lookup = { ...look, name: (e, id) => (e === 500 ? ({ 91: 'EL PASO(LAS CRUCES),TX', 7: 'BOSTON,MA', 999: 'NOWHERE,ZZ' } as Record<number, string>)[id] : look.name(e, id)) }
  const gpc: Record<string, string> = { 'market:91': 'EL PASO', 'market:7': 'Seattle' }
  const byId: Matcher = { ...matcher, byId: async (ids) => new Map(ids.filter((id) => gpc[id]).map((id) => [id, gpc[id]!])) }
  const c = await convert360(describe(spec, names), byId)
  assert.deepEqual((c.spec.filters as Record<string, string[]>).market, ['market:91', 'market:7'])
  assert.ok(c.notes.some((n) => /differ in GPC/.test(n.what) && /BOSTON,MA → Seattle/.test(n.did)))
  assert.ok(c.notes.some((n) => /not found in GPC \(NOWHERE,ZZ\)/.test(n.what)), 'an id GPC lacks still falls back to the name, and is said')
})
