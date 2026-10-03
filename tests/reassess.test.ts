import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isLevel, reassessView, stillGoing, UNCLAIMED_AFTER_MS, WORKING_LIMIT_MS } from '../src/lib/reassess-rules'

const NOW = new Date('2026-10-03T12:00:00Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms)
const row = (over: Partial<Parameters<typeof reassessView>[0]>) => ({
  status: 'queued',
  requestedAt: ago(10_000),
  claimedAt: null,
  note: null,
  error: null,
  ...over,
})

test('a fresh request is waiting, and one Yaara has collected is working', () => {
  assert.deepEqual(reassessView(row({}), NOW), { state: 'waiting', message: null })
  assert.deepEqual(reassessView(row({ status: 'working', claimedAt: ago(5_000) }), NOW), { state: 'working', message: null })
})

test('done carries what she had to say, and failed carries why', () => {
  assert.deepEqual(reassessView(row({ status: 'done' }), NOW), { state: 'done', message: null })
  assert.deepEqual(reassessView(row({ status: 'done', note: 'Nothing is attached to this.' }), NOW), {
    state: 'done',
    message: 'Nothing is attached to this.',
  })
  assert.equal(reassessView(row({ status: 'failed', error: 'model down' }), NOW).message, 'model down')
})

test('a request nobody collects is reported as her not running, not left spinning', () => {
  const view = reassessView(row({ requestedAt: ago(UNCLAIMED_AFTER_MS + 1) }), NOW)
  assert.equal(view.state, 'failed')
  assert.match(view.message ?? '', /did not pick this up/)
})

test('a request she collected and never finished times out', () => {
  const view = reassessView(row({ status: 'working', requestedAt: ago(WORKING_LIMIT_MS + 60_000), claimedAt: ago(WORKING_LIMIT_MS + 1) }), NOW)
  assert.equal(view.state, 'failed')
  assert.match(view.message ?? '', /did not finish/)
})

test('a second click joins a request still going, but not a finished or abandoned one', () => {
  assert.equal(stillGoing(row({}), NOW), true)
  assert.equal(stillGoing(row({ status: 'working', claimedAt: ago(60_000) }), NOW), true)
  assert.equal(stillGoing(row({ status: 'done' }), NOW), false)
  assert.equal(stillGoing(row({ requestedAt: ago(UNCLAIMED_AFTER_MS + 1) }), NOW), false)
})

test('only the three tiers can be reassessed', () => {
  assert.equal(isLevel('objective'), true)
  assert.equal(isLevel('project'), true)
  assert.equal(isLevel('milestone'), false)
})
