import test from 'node:test'
import assert from 'node:assert/strict'
import { updateMix, updateMixText } from '../src/lib/update-mix'

const b = (...kinds: string[]) => kinds.map((kind) => ({ kind }))

test('the composition replaces what the arc was gesturing at', () => {
  // The ring drew 2/3 and the reader saw "67% done". This says what is
  // actually in the tile.
  assert.equal(updateMixText(b('progress', 'progress', 'blocker')), '1 blocker · 2 progress')
})

test('problems come first, whatever order they arrived in', () => {
  const got = updateMix(b('progress', 'change', 'blocker', 'risk')).map((p) => p.kind)
  assert.deepEqual(got, ['blocker', 'risk', 'change', 'progress'])
})

test('the awkward plurals are right', () => {
  assert.equal(updateMixText(b('decision_needed')), '1 decision needed')
  assert.equal(updateMixText(b('decision_needed', 'decision_needed')), '2 decisions needed')
  assert.equal(updateMixText(b('decision_made', 'decision_made')), '2 decisions made')
})

test('progress is not "2 progresss"', () => {
  assert.equal(updateMixText(b('progress', 'progress')), '2 progress')
})

test('one blocker is not "1 blockers"', () => {
  assert.equal(updateMixText(b('blocker')), '1 blocker')
})

test('a kind this list has never heard of is still counted', () => {
  // Yaara's vocabulary can grow, and a bullet that vanishes from the count
  // because of that is worse than one labelled awkwardly.
  assert.equal(updateMixText(b('blocker', 'something_new')), '1 blocker · 1 something new')
})

test('an empty list has no composition', () => {
  assert.deepEqual(updateMix([]), [])
  assert.equal(updateMixText([]), '')
})
