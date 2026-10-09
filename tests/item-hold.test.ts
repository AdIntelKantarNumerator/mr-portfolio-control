/** On hold until a date (9 October 2026): the hold's end wakes the item. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { activityWithHold, isInactive } from '../src/lib/item-activity'

const last = new Date('2026-10-09T15:00:00Z')
const dec1 = new Date('2026-12-01T00:00:00Z')

test('A35 held until December is inactive while held, and live again from 1 December', () => {
  const nov20 = new Date('2026-11-20T12:00:00Z')
  assert.equal(isInactive(activityWithHold(last, dec1, nov20), nov20), true, 'quiet while held')
  const dec1Morning = new Date('2026-12-01T13:30:00Z')
  assert.equal(isInactive(activityWithHold(last, dec1, dec1Morning), dec1Morning), false, 'remindable on the day')
  const dec9 = new Date('2026-12-09T13:30:00Z')
  assert.equal(isInactive(activityWithHold(last, dec1, dec9), dec9), true, 'and inactive again a week after, if nobody touches it')
})

test('no hold, or a hold that ended before the last update, changes nothing', () => {
  assert.equal(activityWithHold(last, null), last)
  assert.equal(activityWithHold(last, new Date('2026-10-01T00:00:00Z'), new Date('2026-10-10T00:00:00Z')), last)
})
