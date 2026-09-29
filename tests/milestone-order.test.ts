import test from 'node:test'
import assert from 'node:assert/strict'
import { byTargetDate, nextUpcoming } from '../src/lib/milestone-order'

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

// --- which one goes on the card -------------------------------------------

const at = (name: string, date: string | null, status = 'on_track', sortOrder = 0) => ({
  name,
  sortOrder,
  status,
  targetDate: date ? new Date(`${date}T00:00:00Z`) : null,
})

const today = new Date('2026-09-29T14:00:00Z')

test('the reported case: a milestone three weeks past is not the next one', () => {
  // Insights Studio GPC read "3 Sept · -26d" and "100%", because the oldest
  // open milestone was chosen and the plan line for a past date is all of it.
  const got = nextUpcoming([at('Taste', '2026-09-03'), at('Data Model', '2026-11-15')], today)
  assert.equal(got?.milestone.name, 'Data Model')
  assert.equal(got?.overdue, false)
})

test('a milestone due today is still ahead, all day', () => {
  const got = nextUpcoming([at('Today', '2026-09-29'), at('Later', '2026-10-30')], today)
  assert.equal(got?.milestone.name, 'Today')
})

test('the soonest one ahead wins, not the first one written down', () => {
  const got = nextUpcoming([at('Dec', '2026-12-01', 'on_track', 0), at('Oct', '2026-10-01', 'on_track', 1)], today)
  assert.equal(got?.milestone.name, 'Oct')
})

test('completed milestones are never next, whatever their date', () => {
  const got = nextUpcoming([at('Done', '2026-11-01', 'complete'), at('Open', '2026-12-01')], today)
  assert.equal(got?.milestone.name, 'Open')
})

test('when everything left is overdue it says so rather than showing nothing', () => {
  // Hiding it would be worse than the bug: a plan entirely in the past is the
  // single most important thing that card could tell anybody.
  const got = nextUpcoming([at('June', '2026-06-01'), at('August', '2026-08-01')], today)
  assert.equal(got?.milestone.name, 'August', 'the most recently missed, not the oldest')
  assert.equal(got?.overdue, true)
})

test('an undated milestone counts as ahead, but only once the dated ones run out', () => {
  assert.equal(nextUpcoming([at('Someday', null), at('Soon', '2026-10-05')], today)?.milestone.name, 'Soon')
  assert.equal(nextUpcoming([at('Someday', null), at('Past', '2026-06-05')], today)?.milestone.name, 'Someday')
  assert.equal(nextUpcoming([at('Someday', null), at('Past', '2026-06-05')], today)?.overdue, false)
})

test('nothing open at all is nothing to show', () => {
  assert.equal(nextUpcoming([at('Done', '2026-06-01', 'complete')], today), null)
  assert.equal(nextUpcoming([], today), null)
})
