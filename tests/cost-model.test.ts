/**
 * Cost Analysis arithmetic (lib/cost-model.ts): the Datadog → map matching,
 * the typical day, and what each lever does. The snapshot is checked against
 * the figures the 13 November GCP AI cost review published, so a change to the
 * window rule shows up as a number that no longer matches a slide.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  NO_CHANGE,
  SNAPSHOT_ROWS,
  SNAPSHOT_TODAY,
  UNALLOCATED,
  downstream,
  matchProject,
  scenario,
  typicalDay,
} from '../src/lib/cost-model'
import { rowsFromSeries } from '../src/lib/datadog-cost'

const near = (a: number, b: number, tol = 1) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`)

test('GCP projects map to components, whatever Datadog does to the name', () => {
  assert.deepEqual(matchProject('MLT Prod Deduplication'), { key: 'dedupe', env: 'prod' })
  assert.deepEqual(matchProject('mlt_prod_deduplication'), { key: 'dedupe', env: 'prod' })
  assert.deepEqual(matchProject('MLT Dev Global Product Cat'), { key: 'gpcce', env: 'dev' })
  assert.deepEqual(matchProject('DL Prod Variant Detection'), { key: 'variant', env: 'prod' })
  assert.deepEqual(matchProject('dl-dev-variant-detection'), { key: 'variant', env: 'dev' })
  assert.equal(matchProject('DL Prod Transcript Insights').key, UNALLOCATED)
})

test('the snapshot reproduces the review: about $2.9k a typical day', () => {
  const b = typicalDay(SNAPSHOT_ROWS, SNAPSHOT_TODAY)
  assert.equal(b.window[0], '2026-11-05')
  assert.equal(b.window[6], '2026-11-11')
  const per = Object.fromEntries(b.components.map((c) => [c.key, c.perDay]))
  near(per.gpcce!, 788)
  near(per.vx0ce!, 603)
  near(per.dedupe!, 884)
  near(per.logo!, 372)
  near(per.variant!, 265)
  near(b.total, 2913, 2)
})

test('the window skips the days billing has not caught up with', () => {
  const rows = [
    { day: '2026-11-20', project: 'MLT Prod Deduplication', cost: 7 },
    { day: '2026-11-19', project: 'MLT Prod Deduplication', cost: 1000 }, // inside the lag
  ]
  const b = typicalDay(rows, '2026-11-20')
  assert.equal(b.window.at(-1), '2026-11-18')
  assert.equal(b.total, 0)
})

test('dev cost and unmatched projects are kept apart, never dropped', () => {
  const b = typicalDay(
    [
      { day: '2026-11-10', project: 'MLT Dev Deduplication', cost: 70 },
      { day: '2026-11-10', project: 'DL Prod Missed Ad', cost: 140 },
    ],
    '2026-11-13',
  )
  near(b.devPerDay, 10)
  assert.deepEqual(b.unallocated, [{ project: 'DL Prod Missed Ad', perDay: 20 }])
  near(b.total, 20)
})

const base = typicalDay(SNAPSHOT_ROWS, SNAPSHOT_TODAY)

test('no lever, no change', () => {
  const s = scenario(base, NO_CHANGE)
  near(s.runRateDelta, 0)
  assert.equal(s.oneTime, 0)
})

test('coverage scales what new creatives drive, not sports', () => {
  const s = scenario(base, { ...NO_CHANGE, coveragePct: 10 })
  const row = (k: string) => s.rows.find((r) => r.key === k)!
  near(row('dedupe').next, row('dedupe').base * 1.1, 0.01)
  near(row('logo').next, row('logo').base, 0.01)
})

test('retiring the parallel run removes the VX0 engine and its share of a backfill', () => {
  const s = scenario(base, { ...NO_CHANGE, retireParallel: true, historyMonths: 1 })
  const ce = s.rows.find((r) => r.key === 'vx0ce')!
  assert.equal(ce.next, 0)
  assert.equal(ce.oneTime, 0)
})

test('batch halves batchable components, and makes a backfill cheaper too', () => {
  const online = scenario(base, { ...NO_CHANGE, historyMonths: 6 })
  const batch = scenario(base, { ...NO_CHANGE, historyMonths: 6, batch: true })
  near(batch.oneTime, online.oneTime / 2, 1)
  const logo = batch.rows.find((r) => r.key === 'logo')!
  near(logo.next, logo.base, 0.01)
})

test('downstream walks the map a bounded distance and leaves out the start', () => {
  const links = [
    { from: 'a', to: 'b' },
    { from: 'b', to: 'c' },
    { from: 'c', to: 'd' },
  ]
  assert.deepEqual([...downstream(['a'], links)].sort(), ['b', 'c'])
})

test("Datadog's series become one row per project per day", () => {
  const rows = rowsFromSeries([
    { tag_set: ['project_name:mlt_prod_deduplication'], pointlist: [[Date.parse('2026-11-10T00:00:00Z'), 880], [Date.parse('2026-11-11T00:00:00Z'), null]] },
  ])
  assert.deepEqual(rows, [{ day: '2026-11-10', project: 'mlt_prod_deduplication', cost: 880 }])
})
