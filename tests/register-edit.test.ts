import test from 'node:test'
import assert from 'node:assert/strict'
import { blockerPatch, dependencyPatch, describeChange, parseDay, parseEndpoint } from '../src/lib/register-edit'

const fault = (r: ReturnType<typeof blockerPatch> | ReturnType<typeof dependencyPatch>) =>
  r.ok ? null : r.error

// --- blockers --------------------------------------------------------------

test('a blocker keeps the same bar on edit as on raise', () => {
  assert.equal(fault(blockerPatch({ title: 'no', body: 'waiting on the entity rules' }))?.field, 'title')
  assert.equal(fault(blockerPatch({ title: 'Entitlements UI cannot start', body: 'x' }))?.field, 'body')
})

test('an edited blocker carries every field the form offered', () => {
  const r = blockerPatch({
    title: '  Entitlements UI cannot start  ',
    body: '  waiting on the entity rules decision  ',
    status: 'watch',
    category: 'risk',
    ownerId: 'p1',
    dueBy: ' next leads call ',
    at: 'project:abc',
  })
  assert.ok(r.ok)
  assert.deepEqual(r.value, {
    title: 'Entitlements UI cannot start',
    body: 'waiting on the entity rules decision',
    status: 'watch',
    category: 'risk',
    ownerId: 'p1',
    dueBy: 'next leads call',
    level: 'project',
    entityId: 'abc',
  })
})

test('a blocker can be filed against nothing in particular', () => {
  const r = blockerPatch({ title: 'Vendor has gone quiet', body: 'no reply in three weeks', at: '' })
  assert.ok(r.ok)
  assert.equal(r.value.level, null)
  assert.equal(r.value.entityId, null)
})

test('a milestone is not something a blocker can be filed against', () => {
  // The endpoint list a dependency uses includes milestones. A blocker's
  // "against" comes from the same list, and the two are not the same set.
  const r = blockerPatch({ title: 'Cannot start', body: 'waiting on the rules', at: 'milestone:m1' })
  assert.equal(fault(r)?.field, 'at')
})

test('an unknown status or category falls back rather than failing', () => {
  // These come from a <select>; a value outside it means a stale page, not a
  // reader to scold. The safe default is the one the record started life with.
  const r = blockerPatch({ title: 'Cannot start', body: 'waiting on the rules', status: 'banana', category: 'fruit' })
  assert.ok(r.ok)
  assert.equal(r.value.status, 'open')
  assert.equal(r.value.category, 'delivery')
})

// --- dependencies ----------------------------------------------------------

test('both ends are required, and named separately', () => {
  assert.equal(fault(dependencyPatch({ from: '', to: 'project:b' }))?.field, 'from')
  assert.equal(fault(dependencyPatch({ from: 'project:a', to: '' }))?.field, 'to')
})

test('nothing may depend on itself', () => {
  const r = dependencyPatch({ from: 'project:a', to: 'project:a' })
  assert.equal(fault(r)?.message, 'Something cannot depend on itself.')
})

test('the same id at two different levels is two different things', () => {
  const r = dependencyPatch({ from: 'project:a', to: 'workstream:a' })
  assert.ok(r.ok)
})

test('a required date that is not a date is refused, not dropped', () => {
  // Writing null here would lose the only thing the reader typed, and the row
  // would come back saying "No date" as though they had left it blank.
  const r = dependencyPatch({ from: 'project:a', to: 'project:b', dueDate: 'next tuesday' })
  assert.equal(fault(r)?.field, 'dueDate')
})

test('an empty required date means no date, which is a real answer', () => {
  const r = dependencyPatch({ from: 'project:a', to: 'project:b', dueDate: '' })
  assert.ok(r.ok)
  assert.equal(r.value.dueDate, null)
})

test('a required date is read as UTC midnight, not the server timezone', () => {
  const r = dependencyPatch({ from: 'project:a', to: 'project:b', dueDate: '2026-10-07' })
  assert.ok(r.ok)
  assert.equal(r.value.dueDate?.toISOString(), '2026-10-07T00:00:00.000Z')
})

// --- the bits both use -----------------------------------------------------

test('an endpoint id containing a colon survives the split', () => {
  assert.deepEqual(parseEndpoint('project:a:b'), { type: 'project', id: 'a:b' })
})

test('parseDay names the field it was given', () => {
  const r = parseDay('rubbish', 'requiredBy')
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.error.field, 'requiredBy')
})

// --- the changelog line ----------------------------------------------------

test('the log says which fields moved and what they became', () => {
  const said = describeChange(
    { title: 'Old title', status: 'open', dueBy: null },
    { title: 'New title', status: 'watch', dueBy: 'next leads' },
    { title: 'Title', status: 'Status', dueBy: 'Needed by' },
  )
  assert.deepEqual(said, ['Title Old title → New title', 'Status open → watch', 'Needed by set to next leads'])
})

test('a field emptied is described as cleared, not as becoming nothing', () => {
  assert.deepEqual(describeChange({ dueBy: 'Friday' }, { dueBy: null }, { dueBy: 'Needed by' }), ['Needed by cleared'])
})

test('a save that changed nothing says nothing', () => {
  // Opening a dialog and pressing Save is not an event, and a changelog full
  // of those is one nobody reads.
  assert.deepEqual(describeChange({ title: 'Same' }, { title: 'Same' }, { title: 'Title' }), [])
})

test('dates compare by day, so an untouched date is not a change', () => {
  const before = { dueDate: new Date('2026-10-07T00:00:00Z') }
  const after = { dueDate: new Date('2026-10-07T00:00:00Z') }
  assert.deepEqual(describeChange(before, after, { dueDate: 'Required by' }), [])
})

test('a long value is shortened in the log rather than pasted whole', () => {
  const said = describeChange({ body: 'a' }, { body: 'x'.repeat(200) }, { body: 'Detail' })
  assert.ok(said[0].length < 80)
})
