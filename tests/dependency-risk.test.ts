/**
 * When a dependency's required date turns the delivering work red.
 *
 * The date used to sit on the row and be read by nothing: the dependency
 * stayed open and green while the date went past, and the first anybody knew
 * was the week it mattered. These pin what fires and — more important — what
 * does not, because a rule that cries wolf is one people turn off.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { lateness, lateDependencies, type DependencyLike } from '../src/lib/dependency-risk'

const TODAY = new Date('2026-09-28T12:00:00Z')

const dep = (over: Partial<DependencyLike> = {}): DependencyLike => ({
  id: 'd1',
  fromType: 'project',
  fromId: 'w1',
  toType: 'initiative',
  toId: 'p1',
  status: 'open',
  dueDate: '2026-10-15',
  ...over,
})

test('what makes a dependency late', async (t) => {
  await t.test('a required date that has passed, with the work unfinished', () => {
    assert.equal(lateness(dep({ dueDate: '2026-09-20' }), { targetDate: null, done: false }, TODAY), 'overdue')
  })

  await t.test('a target date later than the date somebody is waiting on', () => {
    // The useful one: it fires the day a target moves, months before the miss.
    assert.equal(lateness(dep(), { targetDate: '2026-11-30', done: false }, TODAY), 'will-miss')
  })

  await t.test('a target on the required date is fine — that is the commitment', () => {
    assert.equal(lateness(dep(), { targetDate: '2026-10-15', done: false }, TODAY), null)
  })

  await t.test('a target before it is fine', () => {
    assert.equal(lateness(dep(), { targetDate: '2026-10-01', done: false }, TODAY), null)
  })

  await t.test('work with no date of its own is not assumed to be late', () => {
    // Undated is unknown, and unknown is not the same as bad. Guessing here
    // would turn every undated piece of work red the moment anybody depended
    // on it, which is most of them.
    assert.equal(lateness(dep(), { targetDate: null, done: false }, TODAY), null)
  })

  await t.test('finished work is never late, whatever the dates say', () => {
    assert.equal(lateness(dep({ dueDate: '2026-01-01' }), { targetDate: '2027-01-01', done: true }, TODAY), null)
  })

  await t.test('a dependency with no required date says nothing', () => {
    assert.equal(lateness(dep({ dueDate: null }), { targetDate: '2030-01-01', done: false }, TODAY), null)
  })

  await t.test('resolved and accepted risks stay quiet', () => {
    // Somebody has already looked at these and decided. Re-raising one is
    // arguing with the person who closed it.
    for (const status of ['resolved', 'accepted_risk']) {
      assert.equal(lateness(dep({ status, dueDate: '2026-01-01' }), { targetDate: null, done: false }, TODAY), null)
    }
  })

  await t.test('at_risk and open both still fire', () => {
    for (const status of ['open', 'at_risk']) {
      assert.equal(lateness(dep({ status, dueDate: '2026-01-01' }), null, TODAY), 'overdue')
    }
  })

  await t.test('an external or deleted delivering end can still be overdue', () => {
    // The date passing is a fact about the calendar, not about the row.
    assert.equal(lateness(dep({ dueDate: '2026-09-01' }), null, TODAY), 'overdue')
    // But nothing is known about its plan, so nothing is predicted.
    assert.equal(lateness(dep(), null, TODAY), null)
  })
})

test('who goes red', async (t) => {
  await t.test('the delivering end, not the one waiting', () => {
    const late = lateDependencies(
      [dep({ id: 'd1', fromId: 'w1', toId: 'p1', dueDate: '2026-09-01' })],
      () => ({ targetDate: null, done: false }),
      TODAY,
    )
    assert.deepEqual([...late.keys()], ['w1'])
    assert.equal(late.get('w1')?.[0]?.reason, 'overdue')
  })

  await t.test('one item late on two dependencies carries both', () => {
    const late = lateDependencies(
      [
        dep({ id: 'd1', dueDate: '2026-09-01' }),
        dep({ id: 'd2', dueDate: '2026-09-10' }),
        dep({ id: 'd3', dueDate: '2027-01-01' }),
      ],
      () => ({ targetDate: null, done: false }),
      TODAY,
    )
    assert.deepEqual(late.get('w1')?.map((l) => l.depId), ['d1', 'd2'])
  })

  await t.test('nothing late means an empty map, not a map of empties', () => {
    assert.equal(lateDependencies([dep()], () => ({ targetDate: null, done: false }), TODAY).size, 0)
  })
})
