import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bandOf, mentionsBonus, parseFactors, scoreOf } from '../src/lib/importance'
import { closureHealth, isInactive } from '../src/lib/item-activity'

// ------------------------------------------------------------ importance (Scott's rules, 5 October 2026)

test('an item that blocks a project, in its key deliverable, is Critical', () => {
  assert.equal(bandOf(scoreOf('blocker', ['blocks_project', 'key_deliverable'], 1)), 'critical')
})

test('an action that unblocks a project outranks one that is logistics', () => {
  const unblocks = scoreOf('action', ['unblocks_project'], 1)
  const logistics = scoreOf('action', ['logistical'], 1)
  assert.ok(unblocks > logistics)
  assert.equal(bandOf(logistics), 'low', 'set up a meeting, submit a PR, create a channel')
})

test('a blocker needing a decision is very important; a single bug, or a small part, is less', () => {
  const decision = scoreOf('blocker', ['needs_decision', 'blocks_project'], 1)
  const bug = scoreOf('blocker', ['single_bug'], 1)
  const small = scoreOf('blocker', ['minor_scope', 'far_out'], 1)
  assert.equal(bandOf(decision), 'critical')
  assert.ok(bug < decision && small < bug)
})

test('raised in more places ranks higher; raised once ranks a little lower', () => {
  assert.equal(mentionsBonus(1), -5)
  assert.ok(scoreOf('action', [], 3) > scoreOf('action', [], 1))
  assert.equal(mentionsBonus(50), 20, 'capped, so repetition does not swamp what it is')
})

test('blocking and unblocking are one importance seen from two ends, not two', () => {
  assert.equal(scoreOf('action', ['blocks_project', 'unblocks_project'], 1), scoreOf('action', ['blocks_project'], 1))
})

test('a person\'s adjustment is added on top and survives a re-score', () => {
  const base = scoreOf('decision', ['needs_decision'], 1)
  assert.equal(scoreOf('decision', ['needs_decision'], 1, 10), base + 10)
  assert.equal(scoreOf('decision', ['needs_decision', 'key_deliverable'], 2, 10) - scoreOf('decision', ['needs_decision', 'key_deliverable'], 2), 10)
})

test('scores stay between 0 and 100, and unknown factors are ignored', () => {
  assert.equal(scoreOf('blocker', ['blocks_project', 'key_deliverable', 'needs_decision'], 9, 50), 100)
  assert.equal(scoreOf('action', ['logistical', 'single_bug', 'minor_scope', 'far_out'], 1, -50), 0)
  assert.equal(scoreOf('action', ['made_up'], 1), scoreOf('action', [], 1))
  assert.deepEqual(parseFactors('["blocks_project","nope","blocks_project"]'), ['blocks_project'])
  assert.deepEqual(parseFactors('not json'), [])
  assert.equal(bandOf(null), null)
})

// ------------------------------------------------------------ activity and health

const NOW = new Date('2026-10-05T12:00:00Z')
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000)

test('an item untouched for more than seven days is inactive', () => {
  assert.equal(isInactive(daysAgo(6), NOW), false)
  assert.equal(isInactive(daysAgo(8), NOW), true)
})

test('green: closing at least as fast as opening, and mostly moving', () => {
  assert.equal(closureHealth({ opened: 4, closed: 5, activeOpen: 6, totalOpen: 8, criticalStale: 0 }).rag, 'green')
})

test('red: more than twice as many opened as closed, or a Critical item left a week', () => {
  assert.equal(closureHealth({ opened: 9, closed: 2, activeOpen: 9, totalOpen: 9, criticalStale: 0 }).rag, 'red')
  const stale = closureHealth({ opened: 1, closed: 5, activeOpen: 5, totalOpen: 6, criticalStale: 1 })
  assert.equal(stale.rag, 'red')
  assert.match(stale.reasons.join(' '), /Critical item untouched/)
})

test('a quiet project with two new items is not turned red by them', () => {
  assert.notEqual(closureHealth({ opened: 2, closed: 0, activeOpen: 2, totalOpen: 2, criticalStale: 0 }).rag, 'red')
})

test('yellow: in between, and the reasons say why', () => {
  const h = closureHealth({ opened: 5, closed: 3, activeOpen: 2, totalOpen: 10, criticalStale: 0 })
  assert.equal(h.rag, 'yellow')
  assert.match(h.reasons[0]!, /3 closed and 5 opened/)
  assert.match(h.reasons[1]!, /2 of 10 open items updated/)
})
