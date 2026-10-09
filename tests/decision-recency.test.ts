/** Decisions are recent for sixty days, then inactive (Scott, 8 October 2026). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decidedAt, isRecentDecision } from '../src/lib/decision-recency'

const now = new Date('2026-10-08T12:00:00Z')

test('a decision is dated by when it was settled, else when it was raised', () => {
  const raised = new Date('2026-10-07T13:40:00Z')
  const settled = new Date('2026-10-08T14:41:00Z')
  assert.equal(decidedAt({ raisedAt: raised }), raised)
  assert.equal(decidedAt({ raisedAt: raised, resolvedAt: settled }), settled)
})

test('recent for sixty days, inactive after', () => {
  assert.equal(isRecentDecision({ raisedAt: new Date('2026-08-10T12:00:00Z') }, now), true)
  assert.equal(isRecentDecision({ raisedAt: new Date('2026-08-08T11:00:00Z') }, now), false)
  assert.equal(isRecentDecision({}, now), false)
})
