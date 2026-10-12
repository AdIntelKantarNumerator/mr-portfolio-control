/** The proposed agenda's pure rules (12 October 2026). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { agendaFingerprint, agendaUserPrompt, parseAgenda, type AgendaInput } from '../src/lib/series-agenda-core'

const input: AgendaInput = {
  seriesName: 'IS with GPC working sessions',
  goals: 'Ready for Nov 1.',
  forDay: '2026-10-13',
  lastDay: '2026-10-12',
  summaries: [{ meeting: 'Keystone SoS', sessionDay: '2026-10-12', text: 'Search rules are a blocker.', stamp: 's1:2026-10-12' }],
  items: [
    { ref: 'B99', kind: 'blocker', title: 'Ads with multiple paying advertisers unresolved', owner: null, due: null, place: 'Creative Intel', section: 'quiet', quiet: 3, heldUntil: null, change: null, suggested: null },
    { ref: 'A35', kind: 'action', title: 'Later thing', owner: 'Scott Bernberg', due: null, place: null, section: 'quiet', quiet: 1, heldUntil: '2026-12-01', change: null, suggested: null },
  ],
}

test('the prompt carries goals, sessions, quiet counts and holds', () => {
  const p = agendaUserPrompt(input)
  assert.match(p, /GOALS: Ready for Nov 1\./)
  assert.match(p, /B99 \[blocker\].*owner: nobody.*quiet for 3 session/)
  assert.match(p, /A35.*ON HOLD until 2026-12-01/)
})

test('an agenda is rebuilt only when what it was built from changed', () => {
  const a = agendaFingerprint(input)
  assert.equal(agendaFingerprint({ ...input }), a)
  assert.notEqual(agendaFingerprint({ ...input, items: [{ ...input.items[0]!, owner: 'Mukesh Kumar' }] }), a)
  assert.notEqual(agendaFingerprint({ ...input, goals: 'Different.' }), a)
})

test('only real refs survive, sizes are bounded, and junk is refused', () => {
  const known = new Set(['B99', 'A35'])
  const raw = JSON.stringify({
    decideFirst: [{ title: 'Rows or one cell for two paying advertisers?', why: 'Grid and exports wait on it.', refs: ['b99', 'A9999'] }],
    topics: [{ title: 'Multi-advertiser display', minutes: 500, why: 'x', refs: ['B99'] }, { title: '', refs: [] }],
    goalCheck: 'On track except the grid.',
    flags: ['Ashley is ambiguous'],
  })
  const a = parseAgenda(`Here you go:\n${raw}`, known)!
  assert.deepEqual(a.decideFirst[0]!.refs, ['B99'])
  assert.equal(a.topics.length, 1)
  assert.equal(a.topics[0]!.minutes, null)
  assert.equal(parseAgenda('not json', known), null)
  assert.equal(parseAgenda('{"decideFirst":[],"topics":[]}', known), null)
})
