/**
 * The arithmetic behind dragging a card up or down the board.
 *
 * A browser proves the pointer reaches the grip; these prove the list ends up
 * in the order the hand asked for. Dragging *down* is the case worth pinning:
 * lifting the card out first shifts everything after it, so an implementation
 * that reads the target index afterwards drops the card one place short.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { moveCard, dropsBelow } from '../src/lib/reorder'

const ids = ['a', 'b', 'c', 'd', 'e']

test('moving a card', async (t) => {
  await t.test('a card lifted from below lands above the one it was dropped on', () => {
    assert.deepEqual(moveCard(ids, 'c', 'a'), ['c', 'a', 'b', 'd', 'e'])
  })

  await t.test('a card dragged down takes the place it was dropped on', () => {
    assert.deepEqual(moveCard(ids, 'a', 'd'), ['b', 'c', 'd', 'a', 'e'])
  })

  await t.test('a neighbour moves exactly one place, either way', () => {
    assert.deepEqual(moveCard(ids, 'b', 'a'), ['b', 'a', 'c', 'd', 'e'])
    assert.deepEqual(moveCard(ids, 'b', 'c'), ['a', 'c', 'b', 'd', 'e'])
  })

  await t.test('both ends are reachable', () => {
    assert.deepEqual(moveCard(ids, 'e', 'a'), ['e', 'a', 'b', 'c', 'd'])
    assert.deepEqual(moveCard(ids, 'a', 'e'), ['b', 'c', 'd', 'e', 'a'])
  })

  await t.test('every id survives exactly once, wherever it is dropped', () => {
    for (const from of ids) {
      for (const to of ids) {
        assert.deepEqual([...moveCard(ids, from, to)].sort(), [...ids].sort(), `${from} onto ${to}`)
      }
    }
  })

  await t.test('nothing that cannot move is written', () => {
    // Identity, not equality: the caller uses it to decide whether to tell the
    // server, and a no-op write would leave a changelog line nobody caused.
    assert.equal(moveCard(ids, 'c', 'c'), ids)
    assert.equal(moveCard(ids, 'zz', 'a'), ids)
    assert.equal(moveCard(ids, 'a', 'zz'), ids)
  })

  await t.test('the list it was given is left alone', () => {
    const before = [...ids]
    moveCard(ids, 'a', 'd')
    assert.deepEqual(ids, before)
  })
})

test('which edge the guide line goes on', async (t) => {
  await t.test('below going down, above coming up', () => {
    assert.equal(dropsBelow(ids, 'a', 'd'), true)
    assert.equal(dropsBelow(ids, 'd', 'a'), false)
  })

  await t.test('it agrees with where the card actually lands', () => {
    for (const from of ids) {
      for (const to of ids) {
        if (from === to) continue
        const after = moveCard(ids, from, to)
        assert.equal(after.indexOf(from) > after.indexOf(to), dropsBelow(ids, from, to), `${from} onto ${to}`)
      }
    }
  })

  await t.test('no line when either card has gone', () => {
    assert.equal(dropsBelow(ids, 'zz', 'a'), false)
    assert.equal(dropsBelow(ids, 'a', 'zz'), false)
  })
})

test('one shared order: a filtered board reorders only what it shows', async (t) => {
  const { mergeOrder, describeMove } = await import('../src/lib/reorder')
  await t.test('the visible cards swap within their own slots and the hidden ones stay put', () => {
    // a, c and e are on screen (say, the Blocked filter); b and d are hidden.
    assert.deepEqual(mergeOrder(['a', 'b', 'c', 'd', 'e'], ['e', 'a', 'c']), ['e', 'b', 'a', 'd', 'c'])
  })
  await t.test('the whole list reordered is just the new order', () => {
    assert.deepEqual(mergeOrder(['a', 'b', 'c'], ['c', 'a', 'b']), ['c', 'a', 'b'])
  })
  await t.test('an id that has gone is ignored', () => {
    assert.deepEqual(mergeOrder(['a', 'b'], ['b', 'gone', 'a']), ['b', 'a'])
  })
  await t.test('the Activity line names the card that moved and where to', () => {
    assert.deepEqual(describeMove(['a', 'b', 'c', 'd'], ['d', 'a', 'b', 'c']), { id: 'd', from: 4, to: 1 })
    assert.equal(describeMove(['a', 'b'], ['a', 'b']), null)
  })
})
