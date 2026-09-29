/**
 * "Did you mean…" — what it should and should not offer.
 *
 * The failure worth guarding against is not a missed suggestion. It is a
 * confident wrong one: two project names that look alike, one offered as
 * though it were obvious, and somebody says yes without reading it properly.
 * So most of these are about what it declines to suggest.
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { closest, exact, editDistance, similarity } from '../src/lib/match-name'

const named = (...names: string[]) => names.map((name) => ({ name }))

const INITIATIVES = named(
  'Keystone Data Migration',
  'Sports Dashboard',
  'GPC Taxonomy',
  'TV Ratings Integration',
  'Export API',
  'Viewership Panel',
)

test('an exact match ignores case and punctuation', () => {
  assert.equal(exact('sports dashboard', INITIATIVES)?.name, 'Sports Dashboard')
  assert.equal(exact('GPC  Taxonomy', INITIATIVES)?.name, 'GPC Taxonomy')
  assert.equal(exact('Sports-Dashboard', INITIATIVES)?.name, 'Sports Dashboard')
  assert.equal(exact('Dashboard', INITIATIVES), null, 'a partial name is not an exact match')
})

test('the name somebody actually says comes back first', () => {
  assert.equal(closest('Keystone', INITIATIVES)[0]?.name, 'Keystone Data Migration')
  assert.equal(closest('Taxonomy', INITIATIVES)[0]?.name, 'GPC Taxonomy')
  assert.equal(closest('the dashboard', INITIATIVES)[0]?.name, 'Sports Dashboard')
})

test('a typo still finds it', () => {
  assert.equal(closest('GPC Taxonmy', INITIATIVES)[0]?.name, 'GPC Taxonomy')
  assert.equal(closest('Viewship Panel', INITIATIVES)[0]?.name, 'Viewership Panel')
})

test('words in a different order still match', () => {
  assert.equal(closest('Dashboard for Sports', INITIATIVES)[0]?.name, 'Sports Dashboard')
})

test('nothing close comes back empty rather than as a bad guess', () => {
  // The caller says "I do not know that one" instead of offering something
  // the person has to read carefully to reject.
  assert.deepEqual(closest('Payroll Rewrite', INITIATIVES), [])
  assert.deepEqual(closest('zzzz', INITIATIVES), [])
  assert.deepEqual(closest('', INITIATIVES), [])
})

test('generic words alone are not a match', () => {
  // Every one of these contains "project" or "data" somewhere nearby; that is
  // not a reason to suggest anything.
  assert.deepEqual(closest('the project', INITIATIVES), [])
  assert.deepEqual(closest('data', named('Keystone Data Migration', 'Data Platform Work')), [])
})

test('two similar names both come back, so she has to ask', () => {
  const similar = named('Sports Dashboard', 'Sports Dashboard v2')
  const found = closest('Sports Dashboard v', similar)
  assert.equal(found.length, 2, 'both, because picking one would be a guess')
})

test('short unrelated names are not treated as typos of each other', () => {
  // Without a length-aware cap, "Export API" and "Export UI" — or worse, two
  // unrelated four-letter names — score as near-identical.
  assert.equal(similarity('Dev', 'Ops'), 0)
  assert.equal(similarity('UAT', 'QA'), 0)
})

test('suggestions are ordered best first and capped', () => {
  const many = named('Alpha One', 'Alpha Two', 'Alpha Three', 'Alpha Four', 'Alpha Five', 'Alpha Six')
  const found = closest('Alpha', many)
  assert.ok(found.length <= 4, 'a list somebody has to read should be short')
  assert.ok(found[0]!.score >= found[found.length - 1]!.score)
})

test('edit distance is the ordinary one', () => {
  assert.equal(editDistance('kitten', 'sitting'), 3)
  assert.equal(editDistance('same', 'same'), 0)
  assert.equal(editDistance('', 'abc'), 3)
})

test('a person or team is matched the same way as a project', () => {
  const people = named('Priya Raman', 'Dan Okoro', 'Scott Bernberg')
  assert.equal(closest('Priya', people)[0]?.name, 'Priya Raman')
  assert.equal(closest('Scott', people)[0]?.name, 'Scott Bernberg')
  assert.deepEqual(closest('Alex', people), [])
})
