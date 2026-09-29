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
import { nextStatus } from '../src/lib/readiness-status'

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
