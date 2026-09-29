import test from 'node:test'
import assert from 'node:assert/strict'
import { byTargetDate, byTargetDateText, pageOf } from '../src/lib/milestone-order'

const m = (name: string, sortOrder: number, date: string | null) => ({
  name,
  sortOrder,
  targetDate: date ? new Date(date) : null,
})

const names = (ms: ReadonlyArray<{ name: string }>) => ms.map((x) => x.name)

test('the reported case: hand order is not date order', () => {
  // Creative Central's card, exactly as it drew: the rail ran Initial Launch
  // (Oct 12), UAT (Oct 7), RDM TEST (Oct 9), and called the Oct 12 one next.
  const rail = [
    m('Initial Launch of Creative Central', 0, '2026-10-12'),
    m('Creative Central UAT', 1, '2026-10-07'),
    m('RDM TEST', 2, '2026-10-09'),
  ]
  assert.deepEqual(names(byTargetDate(rail)), [
    'Creative Central UAT',
    'RDM TEST',
    'Initial Launch of Creative Central',
  ])
})

test('the soonest open milestone is the one that comes first', () => {
  const rail = byTargetDate([m('late', 0, '2026-12-01'), m('soon', 1, '2026-10-01')])
  assert.equal(rail[0].name, 'soon')
})

test('undated milestones go last, not first', () => {
  // A null date sorts to the front in every naive comparator. The least
  // certain work must not become "next".
  const rail = byTargetDate([m('unscheduled', 0, null), m('dated', 1, '2026-11-05')])
  assert.deepEqual(names(rail), ['dated', 'unscheduled'])
})

test('undated milestones keep the order somebody arranged them in', () => {
  const rail = byTargetDate([m('third', 2, null), m('first', 0, null), m('second', 1, null)])
  assert.deepEqual(names(rail), ['first', 'second', 'third'])
})

test('two milestones on one date hold a stable order', () => {
  const a = [m('beta', 5, '2026-10-09'), m('alpha', 5, '2026-10-09')]
  assert.deepEqual(names(byTargetDate(a)), ['alpha', 'beta'])
  assert.deepEqual(names(byTargetDate(a.slice().reverse())), ['alpha', 'beta'])
})

test('sorting does not disturb the caller’s array', () => {
  const rail = [m('b', 0, '2026-10-12'), m('a', 1, '2026-10-01')]
  const before = names(rail)
  byTargetDate(rail)
  assert.deepEqual(names(rail), before)
})

// --- the detail tile ---------------------------------------------------------

test('the string-date order matches the Date order', () => {
  // The editor is a client component, so its dates arrive as ISO strings. Two
  // orderings of one list is how a rail and a tile end up disagreeing.
  const rows = [
    { name: 'undated', targetDate: null, sortOrder: 0 },
    { name: 'oct', targetDate: '2026-10-11', sortOrder: 1 },
    { name: 'sep', targetDate: '2026-09-24', sortOrder: 2 },
  ]
  assert.deepEqual(byTargetDateText(rows).map((r) => r.name), ['sep', 'oct', 'undated'])
})

test('two undated milestones keep the order somebody arranged them in', () => {
  const rows = [
    { name: 'b', targetDate: null, sortOrder: 2 },
    { name: 'a', targetDate: null, sortOrder: 1 },
  ]
  assert.deepEqual(byTargetDateText(rows).map((r) => r.name), ['a', 'b'])
})

test('a tile shows six at a time and says where you are', () => {
  const rows = Array.from({ length: 14 }, (_, i) => i)
  const first = pageOf(rows, 0, 6)
  assert.deepEqual(first.rows, [0, 1, 2, 3, 4, 5])
  assert.equal(first.pages, 3)
  assert.equal(`${first.from + 1}-${first.to}`, '1-6')

  const last = pageOf(rows, 2, 6)
  assert.deepEqual(last.rows, [12, 13])
  assert.equal(`${last.from + 1}-${last.to}`, '13-14')
})

test('a page past the end shows the last page, not an empty one', () => {
  // The list shrinks under a reader when somebody else deletes a milestone.
  const out = pageOf([1, 2, 3], 9, 6)
  assert.deepEqual(out.rows, [1, 2, 3])
  assert.equal(out.page, 0)
})

test('an empty list is one page, not zero', () => {
  const out = pageOf([], 0, 6)
  assert.deepEqual(out.rows, [])
  assert.equal(out.pages, 1)
})

test('six or fewer does not page at all', () => {
  assert.equal(pageOf([1, 2, 3, 4, 5, 6], 0, 6).pages, 1)
})
