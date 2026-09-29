/**
 * The sparkline beside the activity score.
 *
 * It used to be the score repeated eight times, scaled by its own maximum —
 * so every card drew eight full-height bars, identical on every row. These
 * pin that it now has a shape, and that the shape means the same thing on
 * every card.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { activitySeries, BUCKETS } from '../src/lib/activity-series'

const NOW = new Date('2026-09-28T12:00:00Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString()

test('activity per week', async (t) => {
  await t.test('always the same number of buckets, so cards line up', () => {
    assert.equal(activitySeries([], NOW).length, BUCKETS)
    assert.deepEqual(activitySeries([], NOW), [0, 0, 0, 0, 0, 0, 0, 0])
  })

  await t.test('this week lands in the last bucket', () => {
    assert.deepEqual(activitySeries([{ at: daysAgo(0) }, { at: daysAgo(3) }], NOW), [0, 0, 0, 0, 0, 0, 0, 2])
  })

  await t.test('older events land further left', () => {
    // 10 days ago is two buckets back; 30 days is five.
    assert.deepEqual(activitySeries([{ at: daysAgo(10) }, { at: daysAgo(30) }], NOW), [0, 0, 0, 1, 0, 0, 1, 0])
  })

  await t.test('two entities with the same total but different shapes differ', () => {
    // The whole point: before this, both of these drew the same picture.
    const steady = activitySeries([{ at: daysAgo(3) }, { at: daysAgo(10) }, { at: daysAgo(17) }], NOW)
    const burst = activitySeries([{ at: daysAgo(3) }, { at: daysAgo(4) }, { at: daysAgo(5) }], NOW)
    assert.notDeepEqual(steady, burst)
    assert.equal(steady.reduce((a, b) => a + b, 0), burst.reduce((a, b) => a + b, 0))
  })

  await t.test('anything older than the window is off the chart, not piled on the end', () => {
    assert.deepEqual(activitySeries([{ at: daysAgo(200) }], NOW), [0, 0, 0, 0, 0, 0, 0, 0])
  })

  await t.test('an undated event is not evidence that something happened this week', () => {
    assert.deepEqual(activitySeries([{ at: null }, { at: 'not a date' }], NOW), [0, 0, 0, 0, 0, 0, 0, 0])
  })

  await t.test('a few minutes of clock skew does not fall off the chart', () => {
    assert.deepEqual(activitySeries([{ at: daysAgo(-0.01) }], NOW), [0, 0, 0, 0, 0, 0, 0, 1])
  })
})
