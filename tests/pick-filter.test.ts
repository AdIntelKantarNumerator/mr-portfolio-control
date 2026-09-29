/**
 * Typing to find one thing in a list of several hundred.
 *
 * The rule that matters is the one about word order: people type what they
 * remember, and what they remember is two words from the middle of a name.
 * Anchoring to the start, or requiring the words in order, turns a search into
 * a guessing game about how somebody else named the thing.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { filterOptions, groupsOf, moveHighlight } from '../src/lib/pick-filter'

const options = [
  { value: 'w1', label: 'Insight Studio — Client Launch (MVP)', group: 'Projects' },
  { value: 'w2', label: 'Global Product Catalog (GPC)', group: 'Projects' },
  { value: 'p1', label: 'Creative Intel', group: 'Initiatives' },
  { value: 'p2', label: 'Globalization', group: 'Initiatives' },
  { value: 'i1', label: 'Insights Studio GPC', group: 'Objectives' },
  { value: 'm1', label: 'GPC + Creative Central GA', group: 'Milestones' },
]
const names = (rows: Array<{ value: string }>) => rows.map((r) => r.value)

test('two words from the middle, in any order, find the thing', () => {
  assert.deepEqual(names(filterOptions(options, 'studio launch')), ['w1'])
  assert.deepEqual(names(filterOptions(options, 'launch studio')), ['w1'])
})

test('a word from the middle is enough — no prefix anchoring', () => {
  assert.deepEqual(names(filterOptions(options, 'catalog')), ['w2'])
})

test('case is not something anybody should have to get right', () => {
  assert.deepEqual(names(filterOptions(options, 'GPC')), names(filterOptions(options, 'gpc')))
})

test('the group counts as part of the option', () => {
  // "project gpc" is how people describe what they want when the list in
  // front of them is grouped.
  assert.deepEqual(names(filterOptions(options, 'project gpc')), ['w2'])
})

test('an empty box means nothing has been said yet, not that nothing matches', () => {
  assert.equal(filterOptions(options, '').length, options.length)
  assert.equal(filterOptions(options, '   ').length, options.length)
})

test('every word has to match something, not just one of them', () => {
  assert.deepEqual(names(filterOptions(options, 'gpc nonsense')), [])
})

test('no match is an empty list, not everything', () => {
  // Falling back to the whole list would look like the search had been
  // ignored, which is worse than being told nothing matches.
  assert.deepEqual(filterOptions(options, 'zzzz'), [])
})

test('the groups come back in the order they first appear', () => {
  assert.deepEqual(groupsOf(options), ['Projects', 'Initiatives', 'Objectives', 'Milestones'])
})

test('the groups of a narrowed list are only the ones still in it', () => {
  assert.deepEqual(groupsOf(filterOptions(options, 'creative')), ['Initiatives', 'Milestones'])
})

// --- the keyboard ------------------------------------------------------------

test('the highlight stops at both ends rather than wrapping', () => {
  // Holding Down past the last item should stay there. A list that wraps
  // silently returns you to the top, and on three hundred options nobody
  // notices they have been round.
  assert.equal(moveHighlight(4, 1, 5), 4)
  assert.equal(moveHighlight(0, -1, 5), 0)
})

test('the first press moves onto the first option', () => {
  assert.equal(moveHighlight(-1, 1, 5), 0)
})

test('an empty list has nothing to highlight', () => {
  assert.equal(moveHighlight(-1, 1, 0), -1)
  assert.equal(moveHighlight(3, -1, 0), -1)
})
