import test from 'node:test'
import assert from 'node:assert/strict'
import { cardHealth, type HealthFacts } from '../src/lib/card-health'

const facts = (over: Partial<HealthFacts> = {}): HealthFacts => ({
  blockers: 0,
  oldestBlockerDays: null,
  lateDependencies: 0,
  overdueMilestones: 0,
  troubledChildren: 0,
  totalChildren: 6,
  daysSinceActivity: 2,
  ...over,
})

test('the reported case: a milestone added today cannot move the health at all', () => {
  // The ring read 80% on a milestone nobody had started, because 80% of the
  // calendar between the objective's start and that date had gone. Nothing
  // here reads a date against today, so adding a milestone changes nothing
  // until something is actually blocked, overdue, or in trouble.
  const before = cardHealth(facts())
  const after = cardHealth(facts())
  assert.equal(before.health, 'good')
  assert.deepEqual(before, after)
})

test('a blocker is the loudest thing, and says how old it is', () => {
  const h = cardHealth(facts({ blockers: 3, oldestBlockerDays: 12 }))
  assert.equal(h.health, 'crit')
  assert.equal(h.reasons[0].text, '3 blockers, oldest open 12 days')
})

test('one blocker is not "1 blockers"', () => {
  const h = cardHealth(facts({ blockers: 1, oldestBlockerDays: 1 }))
  assert.equal(h.reasons[0].text, '1 blocker, oldest open 1 day')
})

test('a blocker raised today does not claim an age', () => {
  const h = cardHealth(facts({ blockers: 2, oldestBlockerDays: 0 }))
  assert.equal(h.reasons[0].text, '2 blockers')
})

test('a dependency about to be missed is a blocker in all but name', () => {
  const h = cardHealth(facts({ lateDependencies: 1 }))
  assert.equal(h.health, 'crit')
  assert.equal(h.reasons[0].text, '1 dependency will miss the date')
})

test('dependencies pluralises properly', () => {
  assert.equal(cardHealth(facts({ lateDependencies: 2 })).reasons[0].text, '2 dependencies will miss the date')
})

test('an overdue milestone is a warning, not a crisis', () => {
  const h = cardHealth(facts({ overdueMilestones: 2 }))
  assert.equal(h.health, 'warn')
  assert.equal(h.reasons[0].text, '2 milestones overdue')
})

test('children in trouble are counted against how many there are', () => {
  const h = cardHealth(facts({ troubledChildren: 4, totalChildren: 9 }))
  assert.equal(h.health, 'warn')
  assert.equal(h.reasons[0].text, '4 of 9 in trouble')
})

test('trouble outranks silence rather than being hidden by it', () => {
  // This was the old behaviour: quiet was checked first, so an objective
  // with four open blockers that nobody had written about in a month
  // reported "No signal" and sat there grey.
  const h = cardHealth(facts({ blockers: 4, oldestBlockerDays: 30, daysSinceActivity: 40 }))
  assert.equal(h.health, 'crit')
  assert.ok(h.reasons.some((r) => r.text.startsWith('4 blockers')))
  assert.ok(h.reasons.some((r) => r.text.includes('nothing recorded')))
})

test('silence with nothing else wrong is still not health', () => {
  const h = cardHealth(facts({ daysSinceActivity: 21 }))
  assert.equal(h.health, 'quiet')
  assert.equal(h.reasons[0].text, 'nothing recorded in 3 weeks')
})

test('work nobody has ever reported on says so', () => {
  const h = cardHealth(facts({ daysSinceActivity: null }))
  assert.equal(h.health, 'quiet')
  assert.equal(h.reasons[0].text, 'nothing recorded yet')
})

test('a long silence is given in months rather than sixty-three days', () => {
  assert.equal(cardHealth(facts({ daysSinceActivity: 90 })).reasons[0].text, 'nothing recorded in 3 months')
})

test('a fortnight is where silence starts being worth saying', () => {
  assert.equal(cardHealth(facts({ daysSinceActivity: 13 })).health, 'good')
  assert.equal(cardHealth(facts({ daysSinceActivity: 14 })).health, 'quiet')
})

test('good health is earned, and says what was checked', () => {
  // A green state with no reason asks the reader to take it on trust, which
  // is exactly what the old ring did.
  const h = cardHealth(facts())
  assert.equal(h.health, 'good')
  assert.deepEqual(h.reasons, [{ tone: 'muted', text: 'nothing blocked, nothing overdue, active this week' }])
})

test('every state carries at least one reason', () => {
  for (const f of [facts(), facts({ blockers: 1 }), facts({ overdueMilestones: 1 }), facts({ daysSinceActivity: null })]) {
    assert.ok(cardHealth(f).reasons.length > 0)
  }
})

test('the reasons run worst first', () => {
  const h = cardHealth(facts({ blockers: 1, overdueMilestones: 1, daysSinceActivity: 30 }))
  assert.deepEqual(
    h.reasons.map((r) => r.tone),
    ['crit', 'warn', 'muted'],
  )
})

test('the summary is the reasons, in order', () => {
  const h = cardHealth(facts({ blockers: 1, oldestBlockerDays: 3, overdueMilestones: 1 }))
  assert.equal(h.summary, '1 blocker, oldest open 3 days · 1 milestone overdue')
})
