/**
 * What a history entry changed (8 October 2026).
 *
 * The 10/7 search rule was recorded as decided; on 10/8 Nick called it a
 * blocker with no agreed end state. Continuing D84 overwrote its body and kept
 * nothing of what it said before. These are the rules for keeping that.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decodeChanges, describeChange, diffChanges, encodeChanges } from '../src/lib/item-changes'

const D84 = {
  title: 'Search results display rules for entity hierarchy',
  body: 'Show one entity if only one layer exists.',
  status: 'decided',
  owner: null,
}

test('a reversed decision keeps what it said before, field by field', () => {
  const changes = diffChanges(
    D84,
    { title: 'Search results end state undefined', status: 'open', body: 'Nick: search works one way, end state not defined.' },
    ['title', 'status', 'owner', 'body'],
  )
  assert.deepEqual(
    changes.map((c) => c.field),
    ['title', 'status', 'body'],
  )
  assert.equal(changes[1]!.from, 'decided')
  assert.equal(changes[1]!.to, 'open')
})

test('silence about a field is not a change to it', () => {
  assert.deepEqual(diffChanges(D84, { owner: undefined }, ['owner']), [])
  assert.deepEqual(diffChanges({ owner: 'Brian Shullaw' }, { owner: '' }, ['owner']), [], 'blank is not "remove the owner"')
})

test('the same value said differently is not a change', () => {
  assert.deepEqual(diffChanges(D84, { status: 'Decided' }, ['status']), [])
})

test('a field set for the first time says so', () => {
  const [c] = diffChanges(D84, { owner: 'Brian Shullaw' }, ['owner'])
  assert.equal(describeChange(c!), 'Owner set to "Brian Shullaw"')
})

test('a change reads as from and to', () => {
  assert.equal(
    describeChange({ field: 'owner', from: 'Ashley Campbell', to: 'Yael' }),
    'Owner: "Ashley Campbell" → "Yael"',
  )
})

test('stored and read back unchanged, and a mangled column costs only the changes', () => {
  const changes = diffChanges(D84, { status: 'open' }, ['status'])
  assert.deepEqual(decodeChanges(encodeChanges(changes)), changes)
  assert.equal(encodeChanges([]), null, 'a mention stores nothing')
  assert.deepEqual(decodeChanges('{not json'), [])
  assert.deepEqual(decodeChanges(null), [])
})
