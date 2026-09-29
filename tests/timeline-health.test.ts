/**
 * What colour a bar or a milestone draws in.
 *
 * Five states, and the ORDER they are tested in is the rule. Getting the
 * order wrong is how a delivered quarter ends up looking like a disaster
 * (finished work drawn red) or how a slip hides (an overdue thing drawn amber
 * because somebody last assessed it as merely at risk).
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { healthOf, markHealth } from '../src/lib/timeline-model'

const NOW = new Date('2026-09-28T12:00:00Z')
const past = new Date('2026-08-01T00:00:00Z')
const future = new Date('2026-12-01T00:00:00Z')

test('the colour of a bar', async (t) => {
  await t.test('finished beats everything, including a date it missed', () => {
    assert.equal(healthOf('completed', 'red', past, NOW), 'done')
    assert.equal(healthOf('canceled', null, past, NOW), 'done')
  })

  await t.test('a date that has passed is late, whatever anybody assessed', () => {
    assert.equal(healthOf('in_progress', 'green', past, NOW), 'late')
    assert.equal(healthOf('in_progress', null, past, NOW), 'late')
  })

  await t.test('assessed trouble with time left is amber, not red', () => {
    // The distinction the whole change is for.
    assert.equal(healthOf('in_progress', 'red', future, NOW), 'risk')
    assert.equal(healthOf('in_progress', 'amber', future, NOW), 'risk')
    assert.equal(healthOf('blocked', null, future, NOW), 'risk')
  })

  await t.test('committed to but not started is grey, not green', () => {
    assert.equal(healthOf('planned', null, future, NOW), 'planned')
    assert.equal(healthOf('backlog', null, null, NOW), 'planned')
  })

  await t.test('running with nothing against it is green', () => {
    assert.equal(healthOf('in_progress', null, future, NOW), 'good')
    assert.equal(healthOf('in_progress', 'green', null, NOW), 'good')
  })

  await t.test('no date means it cannot be late', () => {
    assert.equal(healthOf('in_progress', null, null, NOW), 'good')
  })

  await t.test('trouble beats not-started: a blocked plan is a problem, not a plan', () => {
    assert.equal(healthOf('planned', 'red', future, NOW), 'risk')
  })
})

test('the colour of a milestone', async (t) => {
  await t.test('complete is blue even long after its date', () => {
    assert.equal(markHealth('complete', past, NOW), 'done')
  })

  await t.test('overdue and open is red', () => {
    assert.equal(markHealth('pending', past, NOW), 'late')
    assert.equal(markHealth('on_track', past, NOW), 'late')
  })

  await t.test('at risk with time left is amber', () => {
    assert.equal(markHealth('at_risk', future, NOW), 'risk')
  })

  await t.test('pending with time left is grey, and on track is green', () => {
    assert.equal(markHealth('pending', future, NOW), 'planned')
    assert.equal(markHealth('on_track', future, NOW), 'good')
  })
})

// ---------------------------------------------------------------------------
// The window a bar covers
// ---------------------------------------------------------------------------

import { effectiveWindow } from '../src/lib/timeline-model'

const d = (s: string) => new Date(`${s}T00:00:00Z`)

test('the window a bar covers', async (t) => {
  await t.test('its own dates win when it has them', () => {
    const w = effectiveWindow({ startDate: d('2026-01-01'), targetDate: d('2026-06-01') }, [d('2025-01-01'), d('2027-01-01')])
    assert.deepEqual([w.start, w.end], [d('2026-01-01'), d('2026-06-01')])
    assert.equal(w.rolledUp, false)
  })

  await t.test('with no dates of its own it spans what is beneath', () => {
    // The reported bug: milestones moved, the detail page said June 17 to
    // Nov 2, the chart drew nothing.
    const w = effectiveWindow({ startDate: null, targetDate: null }, [d('2026-06-17'), d('2026-09-01'), d('2026-11-02')])
    assert.deepEqual([w.start, w.end], [d('2026-06-17'), d('2026-11-02')])
    assert.equal(w.rolledUp, true)
  })

  await t.test('each end falls back on its own', () => {
    // A typed start and no target should extend to the last milestone, not
    // lose the start somebody typed.
    const w = effectiveWindow({ startDate: d('2026-01-01'), targetDate: null }, [d('2026-05-01'), d('2026-11-02')])
    assert.deepEqual([w.start, w.end], [d('2026-01-01'), d('2026-11-02')])
    assert.equal(w.rolledUp, true)
  })

  await t.test('nothing anywhere is honestly nothing', () => {
    const w = effectiveWindow({ startDate: null, targetDate: null }, [])
    assert.deepEqual([w.start, w.end, w.rolledUp], [null, null, false])
  })

  await t.test('nulls beneath are ignored rather than counted as an epoch', () => {
    const w = effectiveWindow({ startDate: null, targetDate: null }, [null, undefined, d('2026-06-17')])
    assert.deepEqual([w.start, w.end], [d('2026-06-17'), d('2026-06-17')])
  })
})
