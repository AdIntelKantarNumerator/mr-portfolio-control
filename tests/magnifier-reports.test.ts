/**
 * Magnifier Offline Reports: the rules that turn the GPC cube into the
 * workbooks' rankings, shares and shifts.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { change, colourSlots, completeMonths, idParam, mediaMatrix, money, monthSlices, monthTotals, ordinal, rank, shiftYm, shifts, trail, type CubeRow } from '../src/lib/magnifier-reports/rules'
import { href, readState } from '../src/app/prototypes/magnifier-offline-reports/state'

const row = (ym: number, aid: number, media: string, spend: number, pid = aid): CubeRow => ({ ym, aid, aname: `A${aid}`, pid, pname: pid === aid ? '' : `P${pid}`, media, cid: 1, cname: 'C', spend, occ: 1 })

const rows = [
  row(202609, 1, 'TV', 100), row(202610, 1, 'TV', 50), row(202610, 1, 'Social', 50),
  row(202609, 2, 'TV', 40), row(202610, 2, 'TV', 120, 9),
  row(202610, 3, 'Social', 30, 9),
]

test('months shift across the year end', () => {
  assert.equal(shiftYm(202601, -1), 202512)
  assert.equal(shiftYm(202612, 1), 202701)
})

test('rank: spend, share of voice, rank and change on the prior month', () => {
  const r = rank(rows, 202610, [202609, 202610], 'advertiser')
  assert.deepEqual(r.map((x) => x.key), [2, 1, 3])
  assert.equal(r[0].rank, 1)
  assert.equal(r[0].sov, 120 / 250)
  assert.equal(r[0].priorRank, 2)
  assert.equal(r[0].delta, 2)
  assert.equal(r[1].delta, 0)
  assert.equal(r[2].delta, null, 'no spend last month reads as new')
  assert.deepEqual(r[1].trend, [100, 100])
})

test('rank by parent folds advertisers into their parent', () => {
  const r = rank(rows, 202610, [202609, 202610], 'parent')
  assert.equal(r[0].key, 9)
  assert.equal(r[0].spend, 150)
  assert.equal(r[0].name, 'P9')
})

test('rank works on weeks with an explicit prior period', () => {
  const w = [row(20261019, 1, 'TV', 10), row(20261026, 1, 'TV', 30)]
  const r = rank(w, 20261026, [20261019, 20261026], 'advertiser', 20261019)
  assert.equal(r[0].prior, 10)
  assert.equal(r[0].delta, 2)
})

test('month totals, media matrix and shifts', () => {
  assert.deepEqual(monthTotals(rows, [202609, 202610]), [140, 250])
  const mm = mediaMatrix(rows, 202610, 'advertiser')
  assert.deepEqual(mm.media.map((m) => m.key), ['TV', 'Social'])
  assert.equal(mm.at(1, 'Social'), 50)
  const s = shifts(rank(rows, 202610, [202609, 202610], 'advertiser'), 5)
  assert.deepEqual(s.map((x) => x.key), [2, 3], 'an unchanged advertiser is not a shift')
})

test('colours follow the entity: eight slots, then none', () => {
  const m = colourSlots(Array.from({ length: 10 }, (_, i) => ({ key: i + 100 })))
  assert.equal(m.get(100), 1)
  assert.equal(m.get(107), 8)
  assert.equal(m.get(108), undefined)
})

test('complete months: every media present, the current month left out', () => {
  const cover = [{ ym: 202607, media: 2 }, { ym: 202608, media: 17 }, { ym: 202609, media: 17 }, { ym: 202610, media: 16 }, { ym: 202611, media: 17 }]
  assert.deepEqual(completeMonths(cover, new Date(Date.UTC(2026, 10, 16))), [202608, 202609, 202610])
})

test('numbers read the way the workbooks do', () => {
  assert.equal(money(89_000), '$89K')
  assert.equal(money(1_059_447), '$1.06M')
  assert.equal(money(16_503_931), '$16.5M')
  assert.equal(money(-527_000), '-$527K')
  assert.equal(change(null), 'New')
  assert.equal(change(-0.0213), '-2.1%')
  assert.equal(ordinal(1), '1st')
  assert.equal(ordinal(4), '4th')
  assert.equal(ordinal(12), '12th')
  assert.equal(ordinal(22), '22nd')
})

test('trail runs from the top of the taxonomy to the node', () => {
  const nodes = [
    { id: 15, parentId: null, level: 'Industry Group' as const, name: 'Healthcare' },
    { id: 128, parentId: 15, level: 'Industry' as const, name: 'Health services' },
    { id: 410, parentId: 128, level: 'Category' as const, name: 'Hospitals' },
  ]
  assert.deepEqual(trail(nodes, 410).map((n) => n.id), [15, 128, 410])
})

test('the address carries the state, and junk is ignored', () => {
  const s = readState({ node: '410', tab: 'media', view: 'sov', adv: '12', w: '2026-10-26', media: 'Spot TV' })
  assert.equal(s.node, 410)
  assert.equal(s.tab, 'media')
  assert.equal(href(s, { adv: null }), '?node=410&tab=media&w=2026-10-26&media=Spot+TV&view=sov')
  const bad = readState({ node: '1; DROP', tab: 'nope', w: '26-10', m: 'x' })
  assert.equal(bad.node, null)
  assert.equal(bad.tab, 'dashboard')
  assert.equal(bad.w, null)
  assert.equal(idParam(['1']), null)
})

test('workbook: products grouped by advertiser with a total under each and a grand total', async () => {
  const { _test } = await import('../src/lib/magnifier-reports/workbook')
  const p = (aid: number, pid: number, a: number, b: number) => ({ advertiser: `A${aid}`, aid, category: 'C', subcategory: 'S', product: `P${pid}`, pid, media: '', byMonth: { 202609: a, 202610: b }, total: a + b })
  const { rows, kinds } = _test.productBlock([p(1, 1, 10, 20), p(1, 2, 5, 0), p(2, 3, 1, 1)], [202609, 202610], (x) => [x.advertiser, x.product], (n) => [n, ''])
  assert.deepEqual(kinds, [undefined, undefined, 'sub', undefined, 'sub', 'total'])
  assert.deepEqual(rows[2], ['A1 Total', '', 15, 20, 35])
  assert.deepEqual(rows[5], ['Grand Total', '', 16, 21, 37])
  assert.equal(_test.monthEnd(202602), '2026-02-28')
  assert.equal(_test.monthEnd(202612), '2026-12-31')
  assert.equal(_test.weekIso(20261026), '2026-10-26')
})

test('a long day range is read a month at a time, with no day lost or repeated', () => {
  assert.deepEqual(monthSlices('2026-08-03', '2026-11-15'), [
    { from: '2026-08-03', to: '2026-08-31' },
    { from: '2026-09-01', to: '2026-09-30' },
    { from: '2026-10-01', to: '2026-10-31' },
    { from: '2026-11-01', to: '2026-11-15' },
  ])
  assert.deepEqual(monthSlices('2026-11-09', '2026-11-15'), [{ from: '2026-11-09', to: '2026-11-15' }], 'within a month: one read')
  assert.deepEqual(monthSlices('2026-12-28', '2027-01-03'), [{ from: '2026-12-28', to: '2026-12-31' }, { from: '2027-01-01', to: '2027-01-03' }], 'across a year end')
})
