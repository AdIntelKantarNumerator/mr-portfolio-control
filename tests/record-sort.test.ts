/**
 * Ordering a register by a column.
 *
 * Most of these guard one rule: a blank is not a value. An action with no due
 * date sorts to the bottom whichever way round the column is, because a sort
 * by date has nothing to say about a row that has no date — and the reverse,
 * where reversing the order fills the first screen with exactly the rows
 * nobody asked about, is the failure that makes a sorted table useless.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { comparing, nextOrder, sortRows } from '../src/lib/record-sort'

const by = <T,>(rows: T[], keyOf: (r: T) => string | null, kind: 'text' | 'date' | 'number', dir: 1 | -1) =>
  sortRows(rows, keyOf, kind, dir).map((r) => (r as { id: string }).id)

// --- blanks -----------------------------------------------------------------

const dated = [
  { id: 'none', due: null },
  { id: 'oct', due: '2026-10-11' },
  { id: 'sep', due: '2026-09-24' },
  { id: 'empty', due: '' },
]

test('the soonest date first, and the undated rows at the bottom', () => {
  assert.deepEqual(by(dated, (r) => r.due, 'date', 1), ['sep', 'oct', 'none', 'empty'])
})

test('reversing the dates does not bring the undated rows to the top', () => {
  const out = by(dated, (r) => r.due, 'date', -1)
  assert.deepEqual(out.slice(0, 2), ['oct', 'sep'])
  assert.deepEqual(out.slice(2).sort(), ['empty', 'none'])
})

test('a blank name sorts last too, not under whatever we would have shown', () => {
  // The Owner column displays "Nobody named" for an unowned row. Sorting on
  // that string would file it under N, in among the people.
  const rows = [{ id: 'z', o: 'Zoe' }, { id: 'none', o: null }, { id: 'a', o: 'Anthony' }]
  assert.deepEqual(by(rows, (r) => r.o, 'text', 1), ['a', 'z', 'none'])
  assert.deepEqual(by(rows, (r) => r.o, 'text', -1), ['z', 'a', 'none'])
})

// --- dates that are not dates ----------------------------------------------

test('the reported shape of Needed by: dates first, then the words', () => {
  // `dueBy` is free text. Sorting the lot as text files 2026-10-01 after
  // "ASAP" and calls it done.
  const rows = [
    { id: 'asap', d: 'ASAP' },
    { id: 'oct', d: '2026-10-01' },
    { id: 'board', d: 'before the board' },
    { id: 'sep', d: '2026-09-30' },
    { id: 'none', d: null },
  ]
  assert.deepEqual(by(rows, (r) => r.d, 'date', 1), ['sep', 'oct', 'asap', 'board', 'none'])
})

test('a date column with no real dates in it still sorts sensibly', () => {
  const rows = [{ id: 'b', d: 'soon' }, { id: 'a', d: 'ASAP' }]
  assert.deepEqual(by(rows, (r) => r.d, 'date', 1), ['a', 'b'])
})

test('a date with a time on it is read by its day', () => {
  const rows = [{ id: 'late', d: '2026-09-24T23:00:00Z' }, { id: 'early', d: '2026-09-23' }]
  assert.deepEqual(by(rows, (r) => r.d, 'date', 1), ['early', 'late'])
})

// --- text and numbers -------------------------------------------------------

test('references order the way people read them, not the way bytes do', () => {
  // B10 after B2 is the whole reason the Ref column is worth sorting.
  const rows = [{ id: 'b10', r: 'B10' }, { id: 'b2', r: 'B2' }, { id: 'b1', r: 'B1' }]
  assert.deepEqual(by(rows, (r) => r.r, 'text', 1), ['b1', 'b2', 'b10'])
})

test('case does not split a column of names into two halves', () => {
  const rows = [{ id: 'b', n: 'beta' }, { id: 'A', n: 'Alpha' }, { id: 'C', n: 'Charlie' }]
  assert.deepEqual(by(rows, (r) => r.n, 'text', 1), ['A', 'b', 'C'])
})

test('a rank column sorts by the rank, not by its label', () => {
  // Status sorts open, watching, resolved, dropped. Alphabetically "Resolved"
  // would come before "Watching", which is not an order anybody means.
  const RANK = ['open', 'watch', 'decided', 'dropped']
  const rows = [
    { id: 'dropped', s: 'dropped' },
    { id: 'open', s: 'open' },
    { id: 'decided', s: 'decided' },
    { id: 'watch', s: 'watch' },
  ]
  const out = sortRows(rows, (r) => RANK.indexOf(r.s) + 1 || null, 'number', 1).map((r) => r.id)
  assert.deepEqual(out, ['open', 'watch', 'decided', 'dropped'])
})

test('a status nobody recognises goes to the bottom rather than to the top', () => {
  // indexOf returns -1 for an unknown value; +1 || null turns that into a
  // blank, which is the honest answer — we do not know where it belongs.
  const RANK = ['open', 'watch']
  const rows = [{ id: 'odd', s: 'gone_weird' }, { id: 'open', s: 'open' }]
  const out = sortRows(rows, (r) => RANK.indexOf(r.s) + 1 || null, 'number', 1).map((r) => r.id)
  assert.deepEqual(out, ['open', 'odd'])
})

// --- what a sort does NOT throw away ----------------------------------------

test('rows that tie keep the order the page put them in', () => {
  // Every one of these lists arrives deliberately ordered — overdue first on
  // Action items. Sorting by Owner should leave each owner's rows still in
  // that order underneath, not shuffled.
  const rows = [
    { id: 'overdue', o: 'Anthony' },
    { id: 'soon', o: 'Anthony' },
    { id: 'later', o: 'Anthony' },
  ]
  assert.deepEqual(by(rows, (r) => r.o, 'text', 1), ['overdue', 'soon', 'later'])
  assert.deepEqual(by(rows, (r) => r.o, 'text', -1), ['overdue', 'soon', 'later'])
})

test('sorting leaves the given array alone', () => {
  const rows = [{ id: 'b' }, { id: 'a' }]
  sortRows(rows, (r) => r.id, 'text', 1)
  assert.deepEqual(rows.map((r) => r.id), ['b', 'a'])
})

// --- clicking the heading ---------------------------------------------------

test('a heading goes ascending, descending, then back to the page order', () => {
  // The third state is the point: a table you can only ever leave sorted by a
  // column has thrown away the order somebody thought about.
  const a = nextOrder(null, 'due')
  assert.deepEqual(a, { key: 'due', dir: 1 })
  const b = nextOrder(a, 'due')
  assert.deepEqual(b, { key: 'due', dir: -1 })
  assert.equal(nextOrder(b, 'due'), null)
})

test('clicking a different heading starts that one ascending', () => {
  assert.deepEqual(nextOrder({ key: 'due', dir: -1 }, 'owner'), { key: 'owner', dir: 1 })
})

test('the comparator is usable on its own and reports a tie as zero', () => {
  const cmp = comparing<{ d: string | null }>((r) => r.d, 'date', 1)
  assert.equal(cmp({ d: '2026-01-01' }, { d: '2026-01-01' }), 0)
  assert.equal(cmp({ d: null }, { d: null }), 0)
})

// --- the four pages actually use it -----------------------------------------

/*
 * A column declares its own sorting, so a page can have the feature and still
 * not offer it on the column somebody wanted. These read the source for the
 * same reason tests/nav.test.ts reads hrefs: nothing else in the build would
 * notice.
 */
const REGISTERS: Array<{ file: string; name: string; dateColumn: string }> = [
  { file: 'src/app/actions/list.tsx', name: 'Action items', dateColumn: "key: 'due'" },
  { file: 'src/components/records/register-list.tsx', name: 'Blockers and decisions', dateColumn: "key: 'dueBy'" },
  { file: 'src/app/dependencies/list.tsx', name: 'Dependencies', dateColumn: "key: 'required'" },
]

for (const reg of REGISTERS) {
  test(`${reg.name} can be sorted, including by its date column`, () => {
    const src = readFileSync(reg.file, 'utf8')
    const at = src.indexOf(reg.dateColumn)
    assert.ok(at > 0, `${reg.file} no longer has ${reg.dateColumn}`)
    // Within the column's own literal, not somewhere else in the file.
    const block = src.slice(at, at + 600)
    assert.ok(/sort: \{ kind: 'date'/.test(block), `${reg.name}: the date column does not sort by date`)
    assert.ok((src.match(/\n\s+sort: /g) ?? []).length >= 4, `${reg.name}: barely any column sorts`)
  })
}

test('a column of controls is not a sort control', () => {
  // The Done/Edit column has no fact in it to sort on, and a heading you can
  // click that does nothing is worse than one you cannot.
  for (const file of REGISTERS.map((r) => r.file)) {
    const src = readFileSync(file, 'utf8')
    for (const key of ["key: 'do'", "key: 'edit'"]) {
      const at = src.indexOf(key)
      if (at < 0) continue
      assert.ok(!/sort: /.test(src.slice(at, at + 400)), `${file}: ${key} declares a sort`)
    }
  }
})
