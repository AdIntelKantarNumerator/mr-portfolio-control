/**
 * Ending and deleting a Strategic Objective.
 *
 * Delete is the one irreversible thing a person can do to the portfolio's
 * structure, so the rule that guards it is tested here rather than trusted
 * to the page that hides the button.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { canDeleteObjective, describeRemoval } from '../src/lib/objective-delete'
import {
  INITIATIVE_STATUS,
  OBJECTIVE_STATUS,
  isEnded,
  reopenedStatus,
  tierStatusLabel,
} from '../src/lib/domain'
import { FIELDS } from '../src/lib/field-rules'

const none = {
  milestones: 0,
  actionLinks: 0,
  assessments: 0,
  observations: 0,
  updates: 0,
  sources: 0,
  decisions: 0,
}

test('deleting an objective', async (t) => {
  await t.test('refused while any initiative is in it, closed ones included', () => {
    const one = canDeleteObjective({ initiativeCount: 1, name: 'Grow revenue', typed: 'Grow revenue' })
    assert.equal(one.ok, false)
    assert.match(!one.ok ? one.reason : '', /1 initiative is still in this objective/)

    const many = canDeleteObjective({ initiativeCount: 3, name: 'Grow revenue', typed: 'Grow revenue' })
    assert.match(!many.ok ? many.reason : '', /3 initiatives are still/)
  })

  await t.test('needs the name typed, exactly', () => {
    assert.equal(canDeleteObjective({ initiativeCount: 0, name: 'Grow revenue', typed: 'grow revenue' }).ok, false)
    assert.equal(canDeleteObjective({ initiativeCount: 0, name: 'Grow revenue', typed: '' }).ok, false)
    assert.equal(canDeleteObjective({ initiativeCount: 0, name: 'Grow revenue', typed: ' Grow revenue ' }).ok, true)
  })

  await t.test('the confirm says what goes and what stays', () => {
    assert.equal(describeRemoval(none), 'Nothing else is filed on it.')
    const text = describeRemoval({ ...none, milestones: 2, actionLinks: 1, observations: 1, decisions: 3 })
    assert.match(text, /2 milestones/)
    assert.match(text, /1 action item link \(the actions themselves stay\)/)
    assert.match(text, /Yaara’s assessments/)
    // Register entries are unfiled, never deleted.
    assert.match(text, /3 decisions and blockers filed here will stay in the register, unfiled/)
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
