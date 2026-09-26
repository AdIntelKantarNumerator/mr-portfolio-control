/**
 * The rule that decides what a sync may overwrite.
 *
 * The bug it prevents: somebody corrects a date here, the next Linear sync
 * writes the whole row again, the correction reverts, and they conclude the
 * app does not save.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  lockedAfterEdit,
  mergeFromSource,
  parseEditedFields,
  serialiseEditedFields,
} from '../src/lib/milestones'

test('an untouched milestone is entirely the source to write', () => {
  const incoming = { name: 'GA', targetDate: new Date('2026-10-01') }
  assert.deepEqual(mergeFromSource(incoming, null), incoming)
  assert.deepEqual(mergeFromSource(incoming, ''), incoming)
})

test('a corrected field is held and the rest still syncs', () => {
  // The whole point: correcting the date must not freeze the name too.
  const out = mergeFromSource(
    { name: 'GA (renamed upstream)', status: 'on_track', targetDate: new Date('2026-10-01') },
    'targetDate',
  )
  assert.equal(out.name, 'GA (renamed upstream)')
  assert.equal(out.status, 'on_track')
  assert.ok(!('targetDate' in out), 'the corrected date is the person s')
})

test('a milestone corrected in every field leaves the sync nothing to say', () => {
  const out = mergeFromSource(
    { name: 'x', status: 'on_track' },
    'name,status,targetDate',
  )
  assert.deepEqual(out, {}, 'the caller skips the update rather than writing an empty set')
})

test('an unknown field name in the lock list is ignored, not trusted', () => {
  // A column that was renamed or removed must not silently lock everything.
  assert.deepEqual([...parseEditedFields('name,notAColumn,status')].sort(), ['name', 'status'])
})

test('only fields the edit actually changed are locked', () => {
  // Opening the form, changing one date and saving must not freeze the four
  // other fields that came back identical — that is how a sync quietly stops
  // working everywhere.
  const before = { name: 'GA', status: 'on_track', targetDate: new Date('2026-10-01'), details: null }
  const after = { name: 'GA', status: 'on_track', targetDate: new Date('2026-11-14'), details: null }
  const { fields, changed } = lockedAfterEdit(before, after, null)
  assert.deepEqual(changed, ['targetDate'])
  assert.equal(fields, 'targetDate')
})

test('locks accumulate across separate edits', () => {
  const { fields } = lockedAfterEdit({ name: 'GA' }, { name: 'General availability' }, 'targetDate')
  assert.deepEqual(fields?.split(',').sort(), ['name', 'targetDate'])
})

test('dates compare by instant, not by object identity', () => {
  // Two Date objects for the same moment are not ===, and treating them as a
  // change would lock a field nobody edited every time the form was opened.
  const { changed } = lockedAfterEdit(
    { targetDate: new Date('2026-10-01T00:00:00Z') },
    { targetDate: new Date('2026-10-01T00:00:00Z') },
    null,
  )
  assert.deepEqual(changed, [])
})

test('clearing a date counts as an edit', () => {
  const { changed } = lockedAfterEdit({ targetDate: new Date('2026-10-01') }, { targetDate: null }, null)
  assert.deepEqual(changed, ['targetDate'])
})

test('nothing locked serialises to null, not an empty string', () => {
  // An empty string would round-trip as a lock list of one empty name.
  assert.equal(serialiseEditedFields([]), null)
})
