/**
 * Joining each assessment point to the evidence it cites.
 *
 * The card puts a point's source marks at the end of its sentence, so the
 * join has to be right per point: a meeting icon next to the sentence the
 * meeting did not support is worse than no icon.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { citedPoints, dedupePoints } from '../src/lib/cited-points'

const evidence = JSON.stringify([
  { id: 'm1', source: 'meeting', title: 'Tuesday taxonomy call', url: 'https://docs.google.com/document/d/abc' },
  { id: 's1', source: 'slack', title: 'Slack #gpc', url: 'https://slack.com/archives/C1/p1' },
  { id: 's2', source: 'slack', title: 'Slack #gpc', url: 'https://slack.com/archives/C1/p1' },
  { id: 't1', source: 'meeting', title: 'weekly sync', url: null },
  { id: 'g1', source: 'github', title: 'org/repo', url: 'https://github.com/org/repo/pull/4' },
])

test('each point gets only the sources it cites, with their links', () => {
  const items = JSON.stringify([
    { kind: 'risk', text: 'Entity rules are undefined.', citations: ['m1'] },
    { kind: 'progress', text: 'The pipeline shipped.', citations: ['g1', 's1'] },
  ])
  const [a, b] = citedPoints(items, evidence)
  assert.deepEqual(a.cites, [
    { source: 'meeting', title: 'Tuesday taxonomy call', url: 'https://docs.google.com/document/d/abc' },
  ])
  assert.deepEqual(
    b.cites.map((c) => c.source),
    ['github', 'slack'],
  )
})

test('two messages from one place are one mark', () => {
  const [p] = citedPoints(JSON.stringify([{ kind: 'progress', text: 'x', citations: ['s1', 's2'] }]), evidence)
  assert.equal(p.cites.length, 1)
})

test('a meeting with no document keeps its mark, without a link', () => {
  const [p] = citedPoints(JSON.stringify([{ kind: 'risk', text: 'x', citations: ['t1'] }]), evidence)
  assert.deepEqual(p.cites, [{ source: 'meeting', title: 'weekly sync', url: null }])
})

test('citations to evidence that is not there are dropped, and a point still shows', () => {
  const [p] = citedPoints(JSON.stringify([{ kind: 'risk', text: 'Still said.', citations: ['gone'] }]), evidence)
  assert.equal(p.text, 'Still said.')
  assert.deepEqual(p.cites, [])
})

test('bad JSON is no points, not a crash', () => {
  assert.deepEqual(citedPoints('not json', evidence), [])
  assert.deepEqual(citedPoints(null, null), [])
})

test('a rolled-up card shows each point once, first occurrence kept', () => {
  const a = citedPoints(JSON.stringify([{ kind: 'risk', text: 'Same.', citations: ['m1'] }]), evidence)
  const b = citedPoints(JSON.stringify([{ kind: 'risk', text: 'Same.', citations: ['g1'] }]), evidence)
  const out = dedupePoints([...a, ...b])
  assert.equal(out.length, 1)
  assert.equal(out[0].cites[0].source, 'meeting')
})
