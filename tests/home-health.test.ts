import test from 'node:test'
import assert from 'node:assert/strict'
// From home-types, which imports nothing: calling a pure rule must not
// open a database connection.
import { healthOf } from '../src/lib/home-types'
import { concernOf, milestoneProgress } from '../src/lib/milestone-progress'

/** A card's next milestone, as the board computes it. */
function next(status: string, expected: number, items?: { done: number; total: number }) {
  const p = milestoneProgress({ status, expected, done: items?.done, total: items?.total })
  return {
    card: { id: 'm', name: 'A milestone', due: null, days: 3, pct: p.pct, expected, basis: p.basis, basisLabel: '' },
    concern: concernOf(status, expected),
  }
}

const health = (status: string, expected: number, items?: { done: number; total: number }, blockers = 0) => {
  const n = next(status, expected, items)
  // Activity and age chosen so neither the "quiet" nor the blocker rule fires
  // and the milestone is what decides.
  return healthOf(n.card, blockers, 5, 3, n.concern)
}

test('the reported case: on track the day before its date is not a crisis', () => {
  // Sports read 55% against 99% expected and went red on the arithmetic alone,
  // a day before a milestone its own status called on track.
  assert.equal(health('on_track', 99), 'good')
})

test('on track early is also fine', () => {
  assert.equal(health('on_track', 10), 'good')
})

test('a status of at risk is a warning wherever the date sits', () => {
  assert.equal(health('at_risk', 10), 'warn')
  assert.equal(health('at_risk', 95), 'warn')
})

test('blocked is critical even early, which the old arithmetic could not say', () => {
  // expected 5 minus any fixed shortfall clamps at zero, leaving a gap of 5 —
  // which read as healthier than an on-track milestone near its date.
  assert.equal(health('blocked', 5), 'crit')
})

test('work nobody has started is judged by how much time has gone', () => {
  assert.equal(health('planning', 10), 'good')
  assert.equal(health('planning', 60), 'warn')
  assert.equal(health('planning', 95), 'crit')
})

test('a real count that has fallen behind the plan still warns', () => {
  // The one case where the gap means something: both numbers are measured.
  assert.equal(health('on_track', 90, { done: 1, total: 10 }), 'crit')
  assert.equal(health('on_track', 50, { done: 4, total: 10 }), 'warn')
  assert.equal(health('on_track', 50, { done: 5, total: 10 }), 'good')
})

test('a count ahead of the plan is not a warning', () => {
  assert.equal(health('on_track', 20, { done: 9, total: 10 }), 'good')
})

test('an open blocker close to the date still outranks everything', () => {
  assert.equal(health('on_track', 20, undefined, 2), 'crit')
})

test('silence is still reported as silence, not as health', () => {
  const n = next('on_track', 99)
  assert.equal(healthOf(n.card, 0, 0, 30, n.concern), 'quiet')
})
