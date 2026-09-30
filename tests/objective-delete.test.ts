/**
 * Ending and deleting a Strategic Objective.
 *
 * Delete is the one irreversible thing a person can do to the portfolio's
 * structure, so the rule that guards it is tested here rather than trusted
 * to the page that hides the button.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { canDeleteObjective, deleteBlockers, describeRemoval } from '../src/lib/objective-delete'
import {
  INITIATIVE_STATUS,
  OBJECTIVE_STATUS,
  isEnded,
  reopenedStatus,
  tierStatusLabel,
} from '../src/lib/domain'
import { FIELDS, pillMayChangeStatus } from '../src/lib/field-rules'

const none = {
  milestones: 0,
  actionLinks: 0,
  assessments: 0,
  observations: 0,
  updates: 0,
  sources: 0,
}

test('deleting an objective', async (t) => {
  const named = { name: 'Grow revenue', typed: 'Grow revenue' }

  await t.test('refused while any initiative is in it, closed ones included', () => {
    const one = canDeleteObjective({ initiativeCount: 1, decisionCount: 0, ...named })
    assert.equal(one.ok, false)
    assert.match(!one.ok ? one.reason : '', /1 initiative is still in this objective/)

    const many = canDeleteObjective({ initiativeCount: 3, decisionCount: 0, ...named })
    assert.match(!many.ok ? many.reason : '', /3 initiatives are still/)
  })

  await t.test('refused while any decision or blocker is filed on it, and says where to move it', () => {
    const one = canDeleteObjective({ initiativeCount: 0, decisionCount: 1, ...named })
    assert.equal(one.ok, false)
    assert.match(!one.ok ? one.reason : '', /1 decision or blocker is filed here/)
    assert.match(!one.ok ? one.reason : '', /Filed against/)
  })

  await t.test('both blockers are named at once, so nobody fixes one and meets the other', () => {
    const both = deleteBlockers({ initiativeCount: 2, decisionCount: 3 })
    assert.match(both ?? '', /2 initiatives are still/)
    assert.match(both ?? '', /3 decisions or blockers are filed here/)
    assert.equal(deleteBlockers({ initiativeCount: 0, decisionCount: 0 }), null)
  })

  await t.test('needs the name typed, exactly, once nothing blocks it', () => {
    const empty = { initiativeCount: 0, decisionCount: 0, name: 'Grow revenue' }
    assert.equal(canDeleteObjective({ ...empty, typed: 'grow revenue' }).ok, false)
    assert.equal(canDeleteObjective({ ...empty, typed: '' }).ok, false)
    assert.equal(canDeleteObjective({ ...empty, typed: ' Grow revenue ' }).ok, true)
  })

  await t.test('the confirm says what goes and what stays', () => {
    assert.equal(describeRemoval(none), 'Nothing else is filed on it.')
    const text = describeRemoval({ ...none, milestones: 2, actionLinks: 1, observations: 1 })
    assert.match(text, /2 milestones/)
    assert.match(text, /1 action item link \(the actions themselves stay\)/)
    assert.match(text, /Yaara’s assessments/)
    // Decisions block a delete now, so the confirm never mentions them.
    assert.doesNotMatch(text, /decision|unfiled/)
  })
})

test('the objective status vocabulary', async (t) => {
  await t.test('one list, which the click-to-edit rules use', () => {
    assert.deepEqual([...OBJECTIVE_STATUS], [...INITIATIVE_STATUS])
    assert.deepEqual([...FIELDS.objective.status!.allowed!].sort(), [...OBJECTIVE_STATUS].sort())
  })

  await t.test('reopening an objective makes it active, which is live', () => {
    assert.equal(reopenedStatus('objective'), 'active')
    assert.equal(isEnded(reopenedStatus('objective')), false)
    assert.ok((OBJECTIVE_STATUS as readonly string[]).includes(reopenedStatus('objective')))
  })

  await t.test('every tier gets its own words, not the milestone legend', () => {
    assert.equal(tierStatusLabel('objective', 'active'), 'Active')
    assert.equal(tierStatusLabel('initiative', 'active'), 'Active')
    assert.equal(tierStatusLabel('project', 'in_progress'), 'In progress')
    assert.equal(tierStatusLabel('project', 'canceled'), 'Canceled')
  })
})

test('the status pill moves between live states only', async (t) => {
  await t.test('live to live is allowed', () => {
    assert.equal(pillMayChangeStatus('active', 'paused'), true)
    assert.equal(pillMayChangeStatus('backlog', 'in_progress'), true)
  })

  await t.test('ending is refused: it needs a reason, which the pill cannot ask for', () => {
    assert.equal(pillMayChangeStatus('active', 'completed'), false)
    assert.equal(pillMayChangeStatus('paused', 'canceled'), false)
  })

  await t.test('reopening is refused for the same reason', () => {
    assert.equal(pillMayChangeStatus('completed', 'active'), false)
    assert.equal(pillMayChangeStatus('canceled', 'completed'), false)
  })
})
