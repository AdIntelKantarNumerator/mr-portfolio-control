import test from 'node:test'
import assert from 'node:assert/strict'
import { ancestryOf, formatScope, idsAtOrBelow, parseScope, placeOf } from '../src/lib/hierarchy'

const parents = {
  initiativeOf: new Map([['w1', 'p1'], ['w2', 'p1'], ['orphan', null]]),
  objectiveOf: new Map([['p1', 'i1'], ['loose', null]]),
}

const children = {
  initiativesIn: new Map([['i1', ['p1', 'p2']]]),
  projectsIn: new Map([['p1', ['w1', 'w2']], ['p2', ['w3']]]),
}

// --- upwards ---------------------------------------------------------------

test('the reported case: a project fills in its initiative and objective', () => {
  // The Action Items page showed the project and "Unknown" twice, because
  // it only read the tier the item was filed against.
  assert.deepEqual(ancestryOf('project', 'w1', parents), {
    project: 'w1',
    initiative: 'p1',
    objective: 'i1',
  })
})

test('an initiative fills in its objective', () => {
  assert.deepEqual(ancestryOf('initiative', 'p1', parents), {
    project: null,
    initiative: 'p1',
    objective: 'i1',
  })
})

test('a tier below stays unknown rather than being guessed', () => {
  // An action filed against an objective is not secretly about one of its
  // projects, and picking one would invent a link nobody made.
  assert.deepEqual(ancestryOf('objective', 'i1', parents), {
    project: null,
    initiative: null,
    objective: 'i1',
  })
})

test('work with no parent reports no parent, rather than throwing', () => {
  assert.deepEqual(ancestryOf('project', 'orphan', parents), {
    project: 'orphan',
    initiative: null,
    objective: null,
  })
  assert.equal(ancestryOf('initiative', 'loose', parents).objective, null)
})

test('a project whose initiative has no objective stops at the initiative', () => {
  const p = { initiativeOf: new Map([['w9', 'loose']]), objectiveOf: new Map([['loose', null]]) }
  assert.deepEqual(ancestryOf('project', 'w9', p), {
    project: 'w9',
    initiative: 'loose',
    objective: null,
  })
})

// --- several links at once ---------------------------------------------------

const two = {
  initiativeOf: new Map([['wA', 'pA'], ['wB', 'pB']]),
  objectiveOf: new Map([['pA', 'iA'], ['pB', 'iB']]),
}

test('the reported case: a filed objective beats one inferred from a project', () => {
  // A card counted three open actions and the page showed two. The third was
  // filed against both a project (under iA) and the objective iB. The
  // project's link was read first, filled iA in, and the real iB link was
  // then discarded as "already known" — so the row vanished from iB's list.
  assert.deepEqual(placeOf([{ level: 'project', id: 'wA' }, { level: 'objective', id: 'iB' }], two), {
    project: 'wA',
    initiative: 'pA',
    objective: 'iB',
  })
})

test('and the answer does not depend on the order the links arrive in', () => {
  assert.deepEqual(placeOf([{ level: 'objective', id: 'iB' }, { level: 'project', id: 'wA' }], two), {
    project: 'wA',
    initiative: 'pA',
    objective: 'iB',
  })
})

test('a tier nobody filed is still filled in from the one below', () => {
  assert.deepEqual(placeOf([{ level: 'project', id: 'wA' }], two), {
    project: 'wA',
    initiative: 'pA',
    objective: 'iA',
  })
})

test('two links at the same tier: the first wins, both orders', () => {
  // One record cannot be in two initiatives. Letting the later one win would
  // make the column change as rows are reordered.
  const a = placeOf([{ level: 'initiative', id: 'pA' }, { level: 'initiative', id: 'pB' }], two)
  const b = placeOf([{ level: 'initiative', id: 'pB' }, { level: 'initiative', id: 'pA' }], two)
  assert.equal(a.initiative, 'pA')
  assert.equal(b.initiative, 'pB')
})

test('a tier below the ones filed stays unknown', () => {
  assert.deepEqual(placeOf([{ level: 'objective', id: 'iA' }], two), {
    project: null,
    initiative: null,
    objective: 'iA',
  })
})

test('no links at all is no placement, not a crash', () => {
  assert.deepEqual(placeOf([], two), { project: null, initiative: null, objective: null })
})

// --- downwards -------------------------------------------------------------

test('an objective covers itself, its initiatives and their projects', () => {
  // The card's counts roll up, so a page filtered to it must use the same set
  // — otherwise you click "10 blockers" and arrive at a list of none.
  assert.deepEqual(
    [...idsAtOrBelow('objective', 'i1', children)].sort(),
    ['i1', 'p1', 'p2', 'w1', 'w2', 'w3'],
  )
})

test('an initiative covers itself and its projects', () => {
  assert.deepEqual([...idsAtOrBelow('initiative', 'p1', children)].sort(), ['p1', 'w1', 'w2'])
})

test('a project covers only itself', () => {
  assert.deepEqual([...idsAtOrBelow('project', 'w1', children)], ['w1'])
})

test('a record filed against the thing itself is included', () => {
  // Leaving the objective's own id out would drop blockers filed on it.
  assert.ok(idsAtOrBelow('objective', 'i1', children).has('i1'))
})

test('something with nothing beneath it is just itself', () => {
  assert.deepEqual([...idsAtOrBelow('objective', 'empty', children)], ['empty'])
})

// --- the link ---------------------------------------------------------------

test('a scope round-trips', () => {
  assert.deepEqual(parseScope(formatScope('initiative', 'abc')), { level: 'initiative', id: 'abc' })
})

test('an id containing a colon survives', () => {
  assert.deepEqual(parseScope('project:a:b'), { level: 'project', id: 'a:b' })
})

test('nonsense is no scope at all, not a crash', () => {
  for (const v of [null, undefined, '', 'nope', 'objective:', ':abc', 'team:x']) {
    assert.equal(parseScope(v), null, `${v} should not parse`)
  }
})
