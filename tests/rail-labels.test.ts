/**
 * The milestone rail's labels.
 *
 * Two things went wrong on real cards: names written over each other when
 * milestones were days apart, and a first label hanging off the left end of
 * the rail. Both are geometry, so both are checked here as geometry.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { MIN_WIDTH, railLabels, type RailLabel, type RailMark } from '../src/lib/rail-labels'

const mark = (id: string, at: number, name = `Milestone ${id}`): RailMark => ({ id, name, at, on: '2026-10-01' })

/** The span a label can occupy, in points of the rail. */
function box(l: RailLabel): [number, number] {
  if (l.anchor === 'left') return [l.at, l.at + l.width]
  if (l.anchor === 'right') return [l.at - l.width, l.at]
  return [l.at - l.width / 2, l.at + l.width / 2]
}

const EPS = 1e-9

test('milestones days apart share one label instead of writing over each other', () => {
  const labels = railLabels([mark('a', 50), mark('b', 52), mark('c', 53), mark('d', 55)])
  assert.equal(labels.length, 1)
  assert.equal(labels[0].text, 'Milestone a +3 more')
  for (const id of ['a', 'b', 'c', 'd']) assert.match(labels[0].title, new RegExp(`Milestone ${id}`))
})

test('a lone milestone at either end grows inwards and stays on the rail', () => {
  const [start] = railLabels([mark('a', 0)])
  assert.equal(start.anchor, 'left')
  assert.ok(box(start)[0] >= -EPS && box(start)[1] <= 100 + EPS)

  const [end] = railLabels([mark('z', 100)])
  assert.equal(end.anchor, 'right')
  assert.ok(box(end)[0] >= -EPS && box(end)[1] <= 100 + EPS)
})

test('a label near an end is aligned to it, not centred off it', () => {
  const labels = railLabels([mark('a', 4), mark('b', 50), mark('c', 96)])
  assert.deepEqual(
    labels.map((l) => l.anchor),
    ['left', 'center', 'right'],
  )
})

test('evenly spaced milestones keep a label each', () => {
  const labels = railLabels([mark('a', 0), mark('b', 25), mark('c', 50), mark('d', 75), mark('e', 100)])
  assert.equal(labels.length, 5)
  assert.ok(labels.every((l) => l.text.startsWith('Milestone')))
})

test('a label with no real room says nothing rather than two letters', () => {
  // Clusters 9 points apart: each gets under MIN_WIDTH either side of centre.
  const tight = railLabels([mark('a', 40), mark('b', 49), mark('c', 51.1), mark('d', 60)])
  for (const l of tight) {
    if (l.width < MIN_WIDTH) assert.equal(l.text, '')
    else assert.notEqual(l.text, '')
  }
})

test('no two labels ever overlap, and none leaves the rail', () => {
  // Deterministic pseudo-random sets, so a failure reproduces.
  let seed = 7
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)

  for (let run = 0; run < 500; run++) {
    const n = 1 + Math.floor(rand() * 8)
    const marks = Array.from({ length: n }, (_, i) => mark(String(i), Math.round(rand() * 100)))
    const labels = railLabels(marks)

    // Every mark is named somewhere, even when its label is shared.
    for (const m of marks) assert.ok(labels.some((l) => l.title.includes(m.name)), `run ${run}: ${m.name} lost`)

    const boxes = labels.map(box).sort((a, b) => a[0] - b[0])
    for (const [lo, hi] of boxes) {
      assert.ok(lo >= -EPS && hi <= 100 + EPS, `run ${run}: label off the rail [${lo}, ${hi}]`)
    }
    for (let i = 1; i < boxes.length; i++) {
      assert.ok(boxes[i][0] >= boxes[i - 1][1] - EPS, `run ${run}: labels overlap`)
    }
  }
})
