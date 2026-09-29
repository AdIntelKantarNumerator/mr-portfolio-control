import test from 'node:test'
import assert from 'node:assert/strict'
import { basisLabel, concernOf, milestoneProgress } from '../src/lib/milestone-progress'

test('the reported case: on-track work reads as on track, not as 55%', () => {
  // Sports, the day before its milestone: status on_track, 99% of the calendar
  // gone. It was showing 55% and colouring itself red off the 44-point gap.
  const p = milestoneProgress({ status: 'on_track', expected: 99 })
  assert.equal(p.pct, 99)
  assert.equal(p.basis, 'plan')
  assert.equal(concernOf('on_track', 99), 'none')
})

test('two on-track milestones at different points no longer read the same', () => {
  // The tell that the old number was a constant: unrelated work, same figure.
  const early = milestoneProgress({ status: 'on_track', expected: 20 })
  const late = milestoneProgress({ status: 'on_track', expected: 99 })
  assert.notEqual(early.pct, late.pct)
})

test('a checklist beats the plan, and can disagree with it', () => {
  const p = milestoneProgress({ status: 'on_track', done: 3, total: 7, expected: 90 })
  assert.equal(p.pct, 43)
  assert.equal(p.basis, 'items')
  assert.equal(basisLabel(p), '3 of 7 done')
})

test('an empty checklist is no checklist', () => {
  const p = milestoneProgress({ status: 'on_track', done: 0, total: 0, expected: 40 })
  assert.equal(p.basis, 'plan')
  assert.equal(p.pct, 40)
})

test('a checklist nobody has ticked reads as nothing done, not as the plan', () => {
  const p = milestoneProgress({ status: 'on_track', done: 0, total: 5, expected: 80 })
  assert.equal(p.pct, 0)
  assert.equal(p.basis, 'items')
})

test('complete is 100 whatever the checklist says', () => {
  assert.deepEqual(milestoneProgress({ status: 'complete', done: 1, total: 9, expected: 12 }), {
    pct: 100,
    basis: 'done',
  })
})

test('more done than there are items cannot exceed 100', () => {
  const p = milestoneProgress({ status: 'on_track', done: 9, total: 4, expected: 10 })
  assert.equal(p.pct, 100)
})

test('the plan line is clamped, so an overdue milestone does not read 140%', () => {
  assert.equal(milestoneProgress({ status: 'on_track', expected: 140 }).pct, 100)
  assert.equal(milestoneProgress({ status: 'on_track', expected: -5 }).pct, 0)
})

// --- concern, which is the colour ------------------------------------------

test('concern comes from the status, not from a manufactured gap', () => {
  assert.equal(concernOf('blocked', 10), 'crit')
  assert.equal(concernOf('at_risk', 10), 'warn')
  assert.equal(concernOf('on_track', 99), 'none')
})

test('blocked early is still blocked', () => {
  // The old arithmetic could not say this: subtracting a fixed shortfall from
  // a small expected clamps at zero and reads as barely behind.
  assert.equal(concernOf('blocked', 5), 'crit')
})

test('work nobody has started is judged by the date, not by the word', () => {
  assert.equal(concernOf('planning', 10), 'none')
  assert.equal(concernOf('planning', 60), 'warn')
  assert.equal(concernOf('planning', 95), 'crit')
})

test('an unfamiliar status is not treated as trouble', () => {
  // Statuses arrive from Linear and from documents Yaara reads. An unknown
  // word is a gap in this list, and colouring every card red on one would be
  // the map making the territory look broken.
  assert.equal(concernOf('in_review', 50), 'none')
})

test('the label always says where the number came from', () => {
  assert.equal(basisLabel(milestoneProgress({ status: 'on_track', expected: 99 })), 'no checklist — this is the plan')
  assert.equal(basisLabel(milestoneProgress({ status: 'complete', expected: 99 })), 'complete')
})
