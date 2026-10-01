/**
 * The Workflow Assessment map's layout, grouping and reach.
 *
 * The case that shaped this: the first mock stored a column number on every
 * box, and one added connection left nineteen arrows running right to left.
 * Layout is computed from the links now, so the tests pin the two promises
 * that replaced the stored numbers — every arrow runs left to right unless it
 * closes a cycle, and a cycle never loses a link.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  downstream,
  groupLinks,
  layout,
  linkProblem,
  readComponentInput,
  tidyAliases,
  type MapLink,
} from '../src/lib/workflow-map'

const L = (from: string, to: string): MapLink => ({ from, to })

test('layout', async (t) => {
  await t.test('a box sits one column right of the furthest thing that feeds it', () => {
    const { column } = layout(['a', 'b', 'c', 'd'], [L('a', 'b'), L('b', 'c'), L('a', 'c'), L('c', 'd')])
    assert.deepEqual([...['a', 'b', 'c', 'd'].map((id) => column.get(id))], [0, 1, 2, 3])
  })

  await t.test('adding a link moves everything downstream of it, with no renumbering by hand', () => {
    const before = layout(['src', 'x', 'y'], [L('src', 'y')]).column
    assert.equal(before.get('y'), 1)
    const after = layout(['src', 'x', 'y'], [L('src', 'x'), L('x', 'y'), L('src', 'y')]).column
    assert.equal(after.get('y'), 2)
  })

  await t.test('every arrow runs left to right when there is no cycle', () => {
    const ids = ['a', 'b', 'c', 'd', 'e']
    const links = [L('a', 'c'), L('b', 'c'), L('c', 'e'), L('d', 'e'), L('a', 'd')]
    const { column, backLinks } = layout(ids, links)
    assert.equal(backLinks.length, 0)
    for (const l of links) assert.ok(column.get(l.from)! < column.get(l.to)!, `${l.from} → ${l.to}`)
  })

  await t.test('a cycle is broken by setting one link aside, and that link is kept', () => {
    // The real shape: the review queue feeds the catalog, which feeds the queue.
    const { backLinks, column } = layout(['catalog', 'review', 'serve'], [L('catalog', 'review'), L('review', 'catalog'), L('review', 'serve')])
    assert.equal(backLinks.length, 1)
    assert.ok(column.size === 3)
    for (const id of ['catalog', 'review', 'serve']) assert.ok(Number.isFinite(column.get(id)))
  })

  await t.test('a source sits just before what it feeds, not at the far left', () => {
    // The real case: the rulebook feeds nothing until classification, three
    // stages in. Left in column 0 it dragged the queues it feeds out of place.
    const { column } = layout(
      ['capture', 'ingest', 'classify', 'queue', 'rulebook'],
      [L('capture', 'ingest'), L('ingest', 'classify'), L('classify', 'queue'), L('rulebook', 'queue')],
    )
    assert.equal(column.get('queue'), 3)
    assert.equal(column.get('rulebook'), 2)
    assert.equal(column.get('capture'), 0, 'a source that feeds column 1 stays in column 0')
  })

  await t.test('the same map lays out the same way every time', () => {
    const ids = ['m', 'k', 'z', 'a']
    const links = [L('a', 'z'), L('k', 'z'), L('m', 'z')]
    assert.deepEqual(layout(ids, links).columns, layout([...ids].reverse(), [...links].reverse()).columns)
  })

  await t.test('links to unknown ids and self-links are ignored rather than thrown on', () => {
    const { column, backLinks } = layout(['a'], [L('a', 'ghost'), L('a', 'a')])
    assert.equal(column.get('a'), 0)
    assert.equal(backLinks.length, 0)
  })

  await t.test('a long chain does not overflow the stack', () => {
    const ids = Array.from({ length: 5000 }, (_, i) => `n${i}`)
    const links = ids.slice(1).map((id, i) => L(ids[i]!, id))
    assert.equal(layout(ids, links).column.get('n4999'), 4999)
  })
})

test('the grouped view', async (t) => {
  const comps = [
    { id: 'x1', name: 'X1', kind: 'software' as const, groupKey: 'x' },
    { id: 'x2', name: 'X2', kind: 'software' as const, groupKey: 'x' },
    { id: 'y1', name: 'Y1', kind: 'software' as const, groupKey: 'y' },
  ]

  await t.test('one arrow per pair of groups, counting the component links behind it', () => {
    assert.deepEqual(groupLinks(comps, [L('x1', 'y1'), L('x2', 'y1')]), [{ from: 'x', to: 'y', count: 2 }])
  })

  await t.test('links inside a group draw nothing in the grouped view', () => {
    assert.deepEqual(groupLinks(comps, [L('x1', 'x2')]), [])
  })
})

test('what a change reaches', async (t) => {
  await t.test('direct is one hop; all is everything reachable, without the starting point', () => {
    const r = downstream('rules', [L('rules', 'engine'), L('engine', 'catalog'), L('catalog', 'clickhouse'), L('other', 'clickhouse')])
    assert.deepEqual(r.direct, ['engine'])
    assert.deepEqual(r.all, ['engine', 'catalog', 'clickhouse'])
  })

  await t.test('a cycle is walked once, not forever', () => {
    const r = downstream('a', [L('a', 'b'), L('b', 'a'), L('b', 'c')])
    assert.deepEqual(r.all.sort(), ['b', 'c'])
  })

  await t.test('upstream is never reached: arrows are followed one way only', () => {
    assert.deepEqual(downstream('mid', [L('top', 'mid'), L('mid', 'bottom')]).all, ['bottom'])
  })
})

test('adding a connection', async (t) => {
  const known = new Set(['a', 'b'])
  await t.test('refuses a self-link, a duplicate, and an end that no longer exists', () => {
    assert.match(linkProblem('a', 'a', [], known)!, /itself/)
    assert.match(linkProblem('a', 'b', [L('a', 'b')], known)!, /already/)
    assert.match(linkProblem('a', 'gone', [], known)!, /no longer exists/)
  })
  await t.test('the reverse of an existing link is a different link, and allowed', () => {
    assert.equal(linkProblem('b', 'a', [L('a', 'b')], known), null)
  })
})

test('reading a component from a form', async (t) => {
  const groups = new Set(['cls'])
  await t.test('blank optional fields become null, so "not described" is one state', () => {
    const r = readComponentInput({ name: ' GPC Class Engine ', kind: 'software', groupKey: 'cls', owner: '', description: '   ' }, groups)
    assert.ok(r.ok)
    if (r.ok) {
      assert.equal(r.value.name, 'GPC Class Engine')
      assert.equal(r.value.owner, null)
      assert.equal(r.value.description, null)
    }
  })
  await t.test('a name, a known kind and a known group are required', () => {
    const r = readComponentInput({ name: '', kind: 'robot', groupKey: 'nowhere' }, groups)
    assert.ok(!r.ok)
    if (!r.ok) assert.deepEqual(Object.keys(r.fieldErrors).sort(), ['groupKey', 'kind', 'name'])
  })
  await t.test('aliases are tidied, because a stray comma would match everything', () => {
    assert.equal(tidyAliases('Classifier, ,classify data,CLASSIFIER,'), 'classifier, classify data')
    assert.equal(tidyAliases(' , '), null)
  })
})
