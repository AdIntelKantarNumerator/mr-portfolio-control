import test from 'node:test'
import assert from 'node:assert/strict'
import { progressFraction, progressPercent } from '../src/lib/progress'

test('the reported case: a synced row no longer reads as zero', () => {
  // Linear reports 0.62. Three screens rounded that to 0 and printed "0%",
  // with a progress bar 0.62% wide — which is why nobody knew the app had a
  // real completion figure at all.
  assert.equal(progressPercent(0.62), 62)
})

test('a value somebody typed as a percentage still reads correctly', () => {
  // Editing the field on a list row used to store 62 into the same column the
  // sync fills with 0.62.
  assert.equal(progressPercent(62), 62)
})

test('both scales agree on the ends', () => {
  assert.equal(progressPercent(0), 0)
  assert.equal(progressPercent(100), 100)
  assert.equal(progressFraction(1), 1)
})

test('nothing runs past 100', () => {
  assert.equal(progressPercent(140), 100)
})

test('just above 1 is a percentage somebody typed, not a fraction out of range', () => {
  // The rule is "at or below 1 is a fraction", so 1.4 is 1.4 per cent. A
  // fraction cannot exceed 1, so there is no reading of 1.4 that means 140%.
  assert.equal(progressPercent(1.4), 1)
})

test('missing or nonsense reads as nothing done, not as an error', () => {
  for (const v of [null, undefined, NaN, -5]) assert.equal(progressPercent(v as number), 0)
})

test('a fraction rounds to the nearest whole percent', () => {
  assert.equal(progressPercent(0.005), 1)
  assert.equal(progressPercent(0.004), 0)
})
