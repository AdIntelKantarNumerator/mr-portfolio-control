/**
 * Ticking readiness items off.
 *
 * Two bugs, both of which made a tick undo itself:
 *
 *   1. Each surface kept its own copy of the status, so the copy and the
 *      server drifted. Fixed by useOptimistic in components/readiness-toggle.
 *   2. The Readiness page's dialog held the ROW OBJECT it was opened with, so
 *      the refresh that followed a save never reached the checkboxes inside
 *      it and every tick reverted about a second later.
 *   3. `useOptimistic` — which is right for one write at a time, and wrong for
 *      a dozen: the transitions end against a prop that has not caught up, so
 *      ticking a whole checklist unticked the whole checklist.
 *
 * The toggle rule is a pure function in lib/readiness-status and is tested as
 * one. The second is a rendering fault that neither the typechecker nor a pure
 * test can see, so it is pinned by reading the source — the same approach
 * tests/nav.test.ts takes to hrefs, and for the same reason: the alternative is
 * nothing at all.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { editKey, nextStatus, settled, settleStatus } from '../src/lib/readiness-status'

test('checking an unstarted item marks it done', () => {
  assert.equal(nextStatus('not_started', 'done'), 'done')
})

test('checking a done item unchecks it, rather than leaving it done', () => {
  assert.equal(nextStatus('done', 'done'), 'not_started')
})

test('N/A and done replace one another, without a stop in between', () => {
  // Two clicks to move between two states would read as the first click
  // having failed.
  assert.equal(nextStatus('done', 'na'), 'na')
  assert.equal(nextStatus('na', 'done'), 'done')
})

test('pressing N/A on an N/A item clears it', () => {
  assert.equal(nextStatus('na', 'na'), 'not_started')
})

test('an in-progress item takes the press', () => {
  assert.equal(nextStatus('in_progress', 'done'), 'done')
  assert.equal(nextStatus('in_progress', 'na'), 'na')
})

// --- the stale snapshot -----------------------------------------------------

test('the Readiness dialog is opened by id, not by the row object', () => {
  // Holding {row, gate} froze the checkbox values at the moment the cell was
  // clicked: the save landed, the page data refreshed, and the dialog carried
  // on rendering its snapshot — so every tick flipped back.
  const src = readFileSync('src/app/readiness/matrix.tsx', 'utf8')
  assert.ok(!/useState<\{\s*row:/.test(src), 'the dialog is holding a row object again')
  assert.ok(src.includes('rowId'), 'the dialog should be opened by id')
  assert.ok(
    /rows\.find\(\(r\) => r\.id === openAt\.rowId\)/.test(src),
    'the row must be looked up from the live props on every render',
  )
})

test('neither surface disables its checkbox while saving', () => {
  // The way to fill in a checklist is to run down it. Locking each row until
  // a page round trip finished is the pause Scott reported.
  for (const file of ['src/app/readiness/matrix.tsx', 'src/components/detail/readiness-tile.tsx']) {
    const src = readFileSync(file, 'utf8')
    assert.ok(!/disabled=\{pending\}/.test(src), `${file} disables the control while saving`)
  }
})


// --- keeping a change until the server answers -------------------------------

test('the reported case: a tick holds while the server still says the old thing', () => {
  // Fourteen writes in a few seconds, and the page refreshes they trigger are
  // coalesced. An optimistic value ends its transition against a prop that is
  // still what the page first rendered with — so every tick reverts at once.
  assert.equal(settleStatus('not_started', { want: 'done', base: 'not_started' }), 'done')
})

test('once the server catches up, the server is what is drawn', () => {
  assert.equal(settleStatus('done', { want: 'done', base: 'not_started' }), 'done')
  assert.ok(settled('done', { want: 'done', base: 'not_started' }))
})

test("somebody else's change wins over a click that is still in the air", () => {
  // The server has moved to something we did not ask for, which means it knows
  // something we do not.
  assert.equal(settleStatus('na', { want: 'done', base: 'not_started' }), 'na')
  assert.ok(settled('na', { want: 'done', base: 'not_started' }))
})

test('with nothing in flight, the server is simply the answer', () => {
  assert.equal(settleStatus('done', undefined), 'done')
  assert.ok(settled('done', undefined))
})

test('clicking twice keeps waiting on the same answer', () => {
  // Tick, untick, tick again is one edit against one base, not three.
  const edit = { want: 'not_started', base: 'not_started' }
  assert.equal(settleStatus('not_started', edit), 'not_started')
  assert.equal(settled('not_started', edit), false, 'still waiting')
})

test('an edit is held per project as well as per item', () => {
  // The Readiness page shows the same checklist item for many projects at
  // once; keyed on the item alone, ticking one row would tick another.
  assert.notEqual(editKey('ws-a', 'item-1'), editKey('ws-b', 'item-1'))
})

// --- the tile that moved under the reader ------------------------------------

test('a finished checklist is still shown, and does not hop to another project', () => {
  // readinessFor used to return "the first project with something
  // outstanding", recomputed every render — so ticking the last box swapped
  // the tile to a different project whose boxes were all empty, or on a
  // project page made the tile vanish. Both read as "it unchecked
  // everything", which is how it was reported.
  const src = readFileSync('src/lib/detail.ts', 'utf8')
  assert.ok(!/if \(!behind\) return null/.test(src), 'the tile can still vanish when complete')
  assert.ok(src.includes('streams'), 'every project should be offered, not just one')

  const tile = readFileSync('src/components/detail/readiness-tile.tsx', 'utf8')
  assert.ok(/useState\(projectId\)/.test(tile), 'the shown project must be held, not recomputed')
})
