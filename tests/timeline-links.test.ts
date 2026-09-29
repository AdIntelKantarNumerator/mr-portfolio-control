import assert from 'node:assert/strict'
import test from 'node:test'
import { buildTimeline, type DepInput, type SourceRow } from '../src/lib/timeline-model'

const day = (s: string) => new Date(`${s}T00:00:00Z`)

const child = (id: string, start: string | null, target: string | null) => ({
  id,
  name: id,
  href: `/x/${id}`,
  startDate: start ? day(start) : null,
  targetDate: target ? day(target) : null,
  status: 'active',
  rag: null as string | null,
})

const row = (id: string, children: ReturnType<typeof child>[]): SourceRow => ({
  id,
  name: id,
  href: `/r/${id}`,
  status: 'active',
  rank: 0,
  activity: 0,
  children,
  marks: [],
})

const dep = (from: string, to: string, fromRow: string, toRow: string): DepInput => ({
  id: `${from}->${to}`,
  fromRow,
  toRow,
  fromId: from,
  toId: to,
  fromAt: null,
  toAt: null,
  late: false,
  label: `${from} → ${to}`,
})

const horizon = { start: day('2026-05-01'), end: day('2027-01-31'), now: day('2026-09-28') }

test('the reported case: two projects inside one initiative are joined', () => {
  // Looked at from the initiative level, both ends of this dependency are
  // bars of the SAME row. Resolving only as far as the row made it a line
  // from something to itself, and it was dropped — so nothing was drawn,
  // while both bars sat there plainly on screen.
  const model = buildTimeline([row('init', [child('clickhouse', '2026-07-01', '2026-09-15'), child('gpc', '2026-09-01', '2026-10-31')])], {
    ...horizon,
    deps: [dep('clickhouse', 'gpc', 'init', 'init')],
  })
  assert.equal(model.links.length, 1)
  const [l] = model.links
  assert.equal(l.fromRow, 'init')
  assert.equal(l.toRow, 'init')
  // It leaves the delivering bar's right edge and arrives at the waiting
  // bar's left edge — the two are different places, which is what makes it a
  // line rather than a dot.
  const [clickhouse, gpc] = model.rows[0].bars
  assert.ok(Math.abs(l.fromPct - (clickhouse.leftPct + clickhouse.widthPct)) < 0.001)
  assert.ok(Math.abs(l.toPct - gpc.leftPct) < 0.001)
  assert.notEqual(l.fromLane, l.toLane, 'the bars overlap, so they stack and the line has somewhere to go')
})

test('a line still joins two different rows', () => {
  const model = buildTimeline(
    [row('a', [child('a1', '2026-06-01', '2026-07-01')]), row('b', [child('b1', '2026-08-01', '2026-09-01')])],
    { ...horizon, deps: [dep('a1', 'b1', 'a', 'b')] },
  )
  assert.equal(model.links.length, 1)
  assert.equal(model.links[0].fromRow, 'a')
  assert.equal(model.links[0].toRow, 'b')
})

test('a line anchors to the bar named, not to the row’s outermost edges', () => {
  // The row holds a later bar too. Before, every line left from the row's
  // rightmost edge, so it appeared to come out of work it had nothing to do
  // with.
  const model = buildTimeline(
    [
      row('a', [child('a1', '2026-06-01', '2026-07-01'), child('a2', '2026-11-01', '2026-12-01')]),
      row('b', [child('b1', '2026-08-01', '2026-09-01')]),
    ],
    { ...horizon, deps: [dep('a1', 'b1', 'a', 'b')] },
  )
  const wide = buildTimeline([row('a', [child('a1', '2026-06-01', '2026-07-01')])], horizon)
  const a1 = wide.rows[0].bars[0]
  assert.ok(Math.abs(model.links[0].fromPct - (a1.leftPct + a1.widthPct)) < 0.001)
})

test('a dependency from a thing to itself is still not a line', () => {
  const model = buildTimeline([row('init', [child('one', '2026-06-01', '2026-07-01')])], {
    ...horizon,
    deps: [dep('one', 'one', 'init', 'init')],
  })
  assert.equal(model.links.length, 0)
})

test('a whole row depending on itself, with no bar to tell apart, is not a line', () => {
  // Both ends roll up to the row and neither names a bar: there is nothing to
  // draw between.
  const model = buildTimeline([row('init', [child('one', '2026-06-01', '2026-07-01')])], {
    ...horizon,
    deps: [{ ...dep('x', 'y', 'init', 'init'), fromId: undefined, toId: undefined }],
  })
  assert.equal(model.links.length, 0)
})

test('an end that is off the chart draws nothing', () => {
  const model = buildTimeline([row('a', [child('a1', '2026-06-01', '2026-07-01')])], {
    ...horizon,
    deps: [dep('a1', 'elsewhere', 'a', 'not-a-row')],
  })
  assert.equal(model.links.length, 0)
})

test('an end whose bar is not drawn falls back to the row', () => {
  // Undated work has no bar. The row is still the honest answer for where
  // that end lives, and a line to the row is better than no line.
  const undated = child('a2', null, null)
  const model = buildTimeline(
    [row('a', [child('a1', '2026-06-01', '2026-07-01')]), row('b', [undated, child('b1', '2026-08-01', '2026-09-01')])],
    { ...horizon, deps: [dep('a1', 'a2', 'a', 'b')] },
  )
  assert.equal(model.links.length, 1)
  assert.equal(model.links[0].toLane, 0)
})
