import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanAssignment, decodeAssignment, encodeAssignment } from '../src/lib/assignment'

// David Hudzinski, 22 October 2026: reminded about items from meetings he was
// not in. The record keeps who handed each one over, and who was there.

test('who assigned it, the organizer and the attendees round-trip', () => {
  const a = cleanAssignment({ by: ' Jessica Feinberg ', organizer: 'Jessica Feinberg', attendees: ['Spencer Leeds', '', 7, 'Tauni Kentner'] })
  assert.deepEqual(a, { by: 'Jessica Feinberg', organizer: 'Jessica Feinberg', attendees: ['Spencer Leeds', 'Tauni Kentner'] })
  assert.deepEqual(decodeAssignment(encodeAssignment(a)), a)
})

test('nothing known is no assignment, not an empty one', () => {
  assert.equal(cleanAssignment({ by: null, organizer: '', attendees: [] }), null)
  assert.equal(cleanAssignment('Jessica'), null)
  assert.equal(decodeAssignment('not json'), null)
  assert.equal(encodeAssignment(null), null)
})
