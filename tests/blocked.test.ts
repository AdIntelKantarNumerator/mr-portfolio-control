/**
 * The rule that decides whether the mix bar calls something blocked.
 *
 * This existed as `blocked.has(id)` inline, and it produced a home page where
 * an initiative was flagged Blocked, listed fourteen open blockers beside it,
 * and drew a bar saying six of six projects on track. The two readings came
 * from the same table; only one of them looked beneath the row.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { blockedAtOrBelow } from '../src/lib/blocked'

test('blocked at or below', async (t) => {
  await t.test('a blocker on the thing itself counts', () => {
    assert.equal(blockedAtOrBelow('p1', [], new Set(['p1'])), true)
  })

  await t.test('so does one on anything beneath it — the case that was wrong', () => {
    // The real shape: nothing filed against the project, one workstream stuck.
    assert.equal(blockedAtOrBelow('p1', ['w1', 'w2'], new Set(['w2'])), true)
  })

  await t.test('nothing stuck anywhere is not blocked', () => {
    assert.equal(blockedAtOrBelow('p1', ['w1', 'w2'], new Set(['other'])), false)
  })

  await t.test('a childless thing falls back to its own blockers', () => {
    assert.equal(blockedAtOrBelow('w1', [], new Set(['w1'])), true)
    assert.equal(blockedAtOrBelow('w1', [], new Set()), false)
  })

  await t.test("a sibling's blocker is not borrowed", () => {
    assert.equal(blockedAtOrBelow('p1', ['w1'], new Set(['p2', 'w9'])), false)
  })

  await t.test('an empty blocker set blocks nothing', () => {
    assert.equal(blockedAtOrBelow('p1', ['w1', 'w2'], new Set()), false)
  })
})
