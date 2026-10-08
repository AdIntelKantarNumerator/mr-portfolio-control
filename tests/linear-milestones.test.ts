import assert from 'node:assert/strict'
import test from 'node:test'
import { milestoneStatusFrom, syncedMilestoneStatus } from '../src/lib/sources/linear-map'
import { markTitle, railLabels } from '../src/lib/rail-labels'

// Scott, 8 October 2026: "Does the Milestone list stay in sync with Linear?"
// It did not: 35 milestones done in Linear read "planning" here.

test('done in Linear is complete here, overdue is at risk; next and unstarted say nothing about health', () => {
  assert.equal(milestoneStatusFrom('done'), 'complete')
  assert.equal(milestoneStatusFrom('overdue'), 'at_risk')
  assert.equal(milestoneStatusFrom('next'), null)
  assert.equal(milestoneStatusFrom('unstarted'), null)
  assert.equal(milestoneStatusFrom(undefined), null)
})

test('the reported case: a milestone done in Linear becomes complete', () => {
  assert.equal(syncedMilestoneStatus('done', undefined, 'planning'), 'complete', 'first sync to read the status')
  assert.equal(syncedMilestoneStatus('overdue', 'unstarted', 'planning'), 'at_risk')
})

test('when Linear stops saying done or overdue, what the sync set goes back to planning', () => {
  assert.equal(syncedMilestoneStatus('next', 'done', 'complete'), 'planning', 'reopened in Linear')
  assert.equal(syncedMilestoneStatus('unstarted', 'overdue', 'at_risk'), 'planning', 'its date moved')
})

test("but a status the sync did not set is somebody else's, and is left alone", () => {
  assert.equal(syncedMilestoneStatus('next', undefined, 'complete'), undefined, 'complete from the deck, Linear never said done')
  assert.equal(syncedMilestoneStatus('next', 'done', 'on_track'), undefined, 'changed here since the sync set it')
  assert.equal(syncedMilestoneStatus('unstarted', 'unstarted', 'blocked'), undefined)
})

test('the home rail hover says which work a milestone comes from', () => {
  // Scott, 8 October 2026: "In the milestone mouseover on the home page,
  // please include the project or initiative that the milestone comes from."
  assert.equal(markTitle({ name: 'Rollout', on: '2026-10-15', from: 'Project: GPC Platform' }), 'Rollout — 2026-10-15 · Project: GPC Platform')
  assert.equal(markTitle({ name: 'Rollout', on: null, from: 'Initiative: Sports' }), 'Rollout · Initiative: Sports')
  assert.equal(markTitle({ name: 'Rollout', on: '2026-10-15' }), 'Rollout — 2026-10-15', 'unchanged when nothing is known')
  const [label] = railLabels([
    { id: 'a', name: 'Rollout', at: 40, on: '2026-10-15', from: 'Project: GPC Platform' },
    { id: 'b', name: 'Beta', at: 41, on: '2026-10-16', from: 'Project: Sports Data' },
  ])
  assert.equal(label!.title, 'Rollout — 2026-10-15 · Project: GPC Platform\nBeta — 2026-10-16 · Project: Sports Data', 'and so does a cluster of them')
})
