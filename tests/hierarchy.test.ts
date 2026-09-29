import test from 'node:test'
import assert from 'node:assert/strict'
import { ancestryOf, formatScope, idsAtOrBelow, parseScope, placeOf } from '../src/lib/hierarchy'

const parents = {
  projectOf: new Map([['w1', 'p1'], ['w2', 'p1'], ['orphan', null]]),
  initiativeOf: new Map([['p1', 'i1'], ['loose', null]]),
}

const children = {
  projectsIn: new Map([['i1', ['p1', 'p2']]]),
  workstreamsIn: new Map([['p1', ['w1', 'w2']], ['p2', ['w3']]]),
}

// --- upwards ---------------------------------------------------------------

test('the reported case: a workstream fills in its project and initiative', () => {
  // The Action Items page showed the workstream and "Unknown" twice, because
  // it only read the tier the item was filed against.
  assert.deepEqual(ancestryOf('workstream', 'w1', parents), {
    workstream: 'w1',
    project: 'p1',
    initiative: 'i1',
  })
})

test('a project fills in its initiative', () => {
  assert.deepEqual(ancestryOf('project', 'p1', parents), {
    workstream: null,
    project: 'p1',
    initiative: 'i1',
  })
})

test('a tier below stays unknown rather than being guessed', () => {
  // An action filed against an initiative is not secretly about one of its
  // workstreams, and picking one would invent a link nobody made.
  assert.deepEqual(ancestryOf('initiative', 'i1', parents), {
    workstream: null,
    project: null,
    initiative: 'i1',
  })
})

test('work with no parent reports no parent, rather than throwing', () => {
  assert.deepEqual(ancestryOf('workstream', 'orphan', parents), {
    workstream: 'orphan',
    project: null,
    initiative: null,
  })
  assert.equal(ancestryOf('project', 'loose', parents).initiative, null)
})

test('a workstream whose project has no initiative stops at the project', () => {
  const p = { projectOf: new Map([['w9', 'loose']]), initiativeOf: new Map([['loose', null]]) }
  assert.deepEqual(ancestryOf('workstream', 'w9', p), {
    workstream: 'w9',
    project: 'loose',
    initiative: null,
  })
})

// --- several links at once ---------------------------------------------------

const two = {
  projectOf: new Map([['wA', 'pA'], ['wB', 'pB']]),
  initiativeOf: new Map([['pA', 'iA'], ['pB', 'iB']]),
}

test('the reported case: a filed initiative beats one inferred from a workstream', () => {
  // A card counted three open actions and the page showed two. The third was
  // filed against both a workstream (under iA) and the initiative iB. The
  // workstream's link was read first, filled iA in, and the real iB link was
  // then discarded as "already known" — so the row vanished from iB's list.
  assert.deepEqual(placeOf([{ level: 'workstream', id: 'wA' }, { level: 'initiative', id: 'iB' }], two), {
    workstream: 'wA',
    project: 'pA',
    initiative: 'iB',
  })
})

test('and the answer does not depend on the order the links arrive in', () => {
  assert.deepEqual(placeOf([{ level: 'initiative', id: 'iB' }, { level: 'workstream', id: 'wA' }], two), {
    workstream: 'wA',
    project: 'pA',
    initiative: 'iB',
  })
})

test('a tier nobody filed is still filled in from the one below', () => {
  assert.deepEqual(placeOf([{ level: 'workstream', id: 'wA' }], two), {
    workstream: 'wA',
    project: 'pA',
    initiative: 'iA',
  })
})

test('two links at the same tier: the first wins, both orders', () => {
  // One record cannot be in two projects. Letting the later one win would
  // make the column change as rows are reordered.
  const a = placeOf([{ level: 'project', id: 'pA' }, { level: 'project', id: 'pB' }], two)
  const b = placeOf([{ level: 'project', id: 'pB' }, { level: 'project', id: 'pA' }], two)
  assert.equal(a.project, 'pA')
  assert.equal(b.project, 'pB')
})

test('a tier below the ones filed stays unknown', () => {
  assert.deepEqual(placeOf([{ level: 'initiative', id: 'iA' }], two), {
    workstream: null,
    project: null,
    initiative: 'iA',
  })
})

test('no links at all is no placement, not a crash', () => {
  assert.deepEqual(placeOf([], two), { workstream: null, project: null, initiative: null })
})

// --- downwards -------------------------------------------------------------

test('an initiative covers itself, its projects and their workstreams', () => {
  // The card's counts roll up, so a page filtered to it must use the same set
  // — otherwise you click "10 blockers" and arrive at a list of none.
  assert.deepEqual(
    [...idsAtOrBelow('initiative', 'i1', children)].sort(),
    ['i1', 'p1', 'p2', 'w1', 'w2', 'w3'],
  )
})

test('a project covers itself and its workstreams', () => {
  assert.deepEqual([...idsAtOrBelow('project', 'p1', children)].sort(), ['p1', 'w1', 'w2'])
})

test('a workstream covers only itself', () => {
  assert.deepEqual([...idsAtOrBelow('workstream', 'w1', children)], ['w1'])
})

test('a record filed against the thing itself is included', () => {
  // Leaving the initiative's own id out would drop blockers filed on it.
  assert.ok(idsAtOrBelow('initiative', 'i1', children).has('i1'))
})

test('something with nothing beneath it is just itself', () => {
  assert.deepEqual([...idsAtOrBelow('initiative', 'empty', children)], ['empty'])
})

// --- the link ---------------------------------------------------------------

test('a scope round-trips', () => {
  assert.deepEqual(parseScope(formatScope('project', 'abc')), { level: 'project', id: 'abc' })
})

test('an id containing a colon survives', () => {
  assert.deepEqual(parseScope('workstream:a:b'), { level: 'workstream', id: 'a:b' })
})

test('nonsense is no scope at all, not a crash', () => {
  for (const v of [null, undefined, '', 'nope', 'initiative:', ':abc', 'team:x']) {
    assert.equal(parseScope(v), null, `${v} should not parse`)
  }
})
