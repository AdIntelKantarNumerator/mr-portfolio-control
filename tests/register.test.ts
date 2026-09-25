/**
 * The two rules in the register endpoint that would fail silently.
 *
 * Both are about attribution. A blocker credited to the wrong colleague, or a
 * handle that collides with an existing one, is wrong in a way nobody reading
 * the screen can detect — which is exactly the kind of failure this file is for.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { matchPerson, nextRef } from '../src/lib/register'

const ROSTER = [
  { id: 'p1', name: 'Priya Raman' },
  { id: 'p2', name: 'Sarah Chen' },
  { id: 'p3', name: 'Sarah Okafor' },
  { id: 'p4', name: 'Rick' },
]

describe('turning a written name into a person', () => {
  test('an exact full name matches', () => {
    assert.equal(matchPerson('Priya Raman', ROSTER), 'p1')
    assert.equal(matchPerson('  priya raman  ', ROSTER), 'p1')
  })

  test('a unique first name matches', () => {
    // "Priya said staging is down" is how people actually talk, and refusing
    // that would leave almost every blocker unattributed.
    assert.equal(matchPerson('Priya', ROSTER), 'p1')
  })

  test('an ambiguous first name matches NOBODY', () => {
    // Two Sarahs. "Sarah" on the card is honest; "Sarah Chen" when it was
    // Sarah Okafor is a fabrication the reader has no way to catch, and the
    // text column exists precisely so the written name survives unmatched.
    assert.equal(matchPerson('Sarah', ROSTER), null)
  })

  test('a name nobody has stays text', () => {
    assert.equal(matchPerson('the Data Platform team', ROSTER), null)
    assert.equal(matchPerson('', ROSTER), null)
    assert.equal(matchPerson(null, ROSTER), null)
    // A single letter is noise, not a name.
    assert.equal(matchPerson('P', ROSTER), null)
  })

  test('a single-word full name still matches exactly', () => {
    assert.equal(matchPerson('Rick', ROSTER), 'p4')
  })
})

describe('handing out refs', () => {
  test('refs are per kind, and sequential', () => {
    assert.equal(nextRef('blocker', []), 'B1')
    assert.equal(nextRef('decision', []), 'D1')
    assert.equal(nextRef('blocker', ['B1', 'B2', 'D9']), 'B3')
    assert.equal(nextRef('decision', ['B1', 'B2', 'D9']), 'D10')
  })

  test('a deleted row does not make the next ref collide', () => {
    // Counting rows would return B3 here and collide with the B3 that exists.
    assert.equal(nextRef('blocker', ['B1', 'B3']), 'B4')
  })

  test('handles people typed themselves are left alone', () => {
    // The register was populated by hand with G4 and S2 long before any of
    // this. Those are not ours to renumber, and must not be collided with.
    assert.equal(nextRef('decision', ['G4', 'S2', 'D1']), 'D2')
    assert.equal(nextRef('blocker', ['G4', 'S2']), 'B1')
  })

  test('case does not let a ref be handed out twice', () => {
    assert.equal(nextRef('blocker', ['b7']), 'B8')
  })
})

describe('what a status is called', () => {
  test('a cleared blocker is Resolved, not Decided', async () => {
    // One vocabulary in the database, two on screen. "Decided" on a blocker is
    // the kind of small wrongness that makes people stop reading carefully.
    const { statusLabel } = await import('../src/lib/domain')
    assert.equal(statusLabel('blocker', 'decided'), 'Resolved')
    assert.equal(statusLabel('decision', 'decided'), 'Decided')
    assert.equal(statusLabel('blocker', 'open'), 'Open')
    assert.equal(statusLabel('decision', 'watch'), 'Watch / risk')
  })
})

describe('moving an entry to the right work', () => {
  test('a target is parsed into a type and an id', async () => {
    const { parseEntityTarget } = await import('../src/lib/register')
    assert.deepEqual(parseEntityTarget('project:abc-123'), { type: 'project', id: 'abc-123' })
    assert.deepEqual(parseEntityTarget('initiative:i1'), { type: 'initiative', id: 'i1' })
    // Ids are uuids, which contain no colons — but splitting on the FIRST one
    // means an id that ever does contain one still survives intact.
    assert.deepEqual(parseEntityTarget('project:a:b'), { type: 'project', id: 'a:b' })
  })

  test('anything that is not a real endpoint is refused', async () => {
    // A form can be posted with whatever is in it. An entry pointed at a type
    // this app does not have is invisible on every screen.
    const { parseEntityTarget } = await import('../src/lib/register')
    assert.equal(parseEntityTarget('milestone:m1'), null)
    assert.equal(parseEntityTarget('project:'), null)
    assert.equal(parseEntityTarget(':abc'), null)
    assert.equal(parseEntityTarget('abc'), null)
    assert.equal(parseEntityTarget(''), null)
  })
})

describe('what counts as ended', () => {
  test('completed and canceled, and nothing else', async () => {
    // Withdrawn is canceled and closed is completed — same states, the words
    // people say out loud. Defined once because four screens and an agent all
    // have to agree; the day two copies disagree, a project is hidden from a
    // page and still matched by Yaara.
    const { isEnded } = await import('../src/lib/domain')
    assert.equal(isEnded('completed'), true)
    assert.equal(isEnded('canceled'), true)
    assert.equal(isEnded('in_progress'), false)
    assert.equal(isEnded('backlog'), false, 'a converted intake request must not be hidden')
    assert.equal(isEnded('planned'), false)
    assert.equal(isEnded('paused'), false, 'paused work is still somebody\'s problem')
    assert.equal(isEnded('active'), false)
    assert.equal(isEnded(null), false)
  })

  test('reopening lands somewhere live, per kind', async () => {
    const { reopenedStatus, PROJECT_STATUS, INITIATIVE_STATUS, isEnded } = await import('../src/lib/domain')
    assert.equal(reopenedStatus('project'), 'planned')
    assert.equal(reopenedStatus('initiative'), 'active')
    // Whatever these are, they must be real statuses and must not be ended —
    // reopening into a closed state would be a button that does nothing.
    assert.ok((PROJECT_STATUS as readonly string[]).includes(reopenedStatus('project')))
    assert.ok((INITIATIVE_STATUS as readonly string[]).includes(reopenedStatus('initiative')))
    assert.equal(isEnded(reopenedStatus('project')), false)
    assert.equal(isEnded(reopenedStatus('initiative')), false)
  })
})
