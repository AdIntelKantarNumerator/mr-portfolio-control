import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decodeDelegation, encodeDelegation, newDelegation } from '../src/lib/delegation'

// Sadiya, 26 October 2026: delegate, rather than reassign - the person asked
// accepts or declines, and only an acceptance moves the item.

const NOW = new Date('2026-10-26T15:00:00Z')

test('a delegation records who it is offered to, by whom, and that it has not reached them yet', () => {
  const d = newDelegation({ to: ' Priya Shah ', toRef: 'slack:U1', by: 'Sadiya Khan (told Yaara)', byRef: 'slack:U2', note: 'You run entitlements now' }, NOW)
  assert.notEqual(typeof d, 'string')
  assert.deepEqual(d, { to: 'Priya Shah', toRef: 'slack:U1', by: 'Sadiya Khan (told Yaara)', byRef: 'slack:U2', at: NOW.toISOString(), note: 'You run entitlements now', sentAt: null })
})

test('delegating to nobody is refused rather than recorded', () => {
  assert.equal(typeof newDelegation({ to: '  ', by: 'Sadiya' }, NOW), 'string')
})

test('it survives the round trip through the column, and anything unreadable is no delegation', () => {
  const d = newDelegation({ to: 'Priya Shah', by: 'Sadiya' }, NOW)
  assert.deepEqual(decodeDelegation(encodeDelegation(d as never)), d)
  assert.equal(decodeDelegation(null), null)
  assert.equal(decodeDelegation('not json'), null)
  assert.equal(decodeDelegation('{"to":"Priya"}'), null, 'no one offering it, no delegation')
})
