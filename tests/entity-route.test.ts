/**
 * A tripwire on what an agent may change.
 *
 * The behaviour of the route is checked against a real database by
 * `npm run check:entity` — nothing is created, nothing is deleted, every change
 * is logged with its reason. Those rules are about what reaches the database
 * and only a database can confirm them.
 *
 * What belongs in the fast suite is the decision, not the mechanics: WHICH
 * fields an agent is allowed to touch. That was a conversation, and adding a
 * field to the route is the kind of change that happens in passing while
 * fixing something else. Failing here is the moment to have the conversation
 * again rather than discovering later that she can edit something nobody meant
 * her to.
 */
import { strict as assert } from 'node:assert'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { INITIATIVE_STATUS, PRIORITY, PROJECT_STATUS_SET } from '../src/lib/domain'

const AGREED = [
  'appArea',
  'description',
  'devLead',
  // Moving a project between initiatives — the tier directly above it.
  'initiative',
  'name',
  // The grouping tier above initiatives. Refused for projects: they roll up
  // to an initiative, and letting one name an objective directly would build
  // a second hierarchy nothing else in the app knows about.
  'objective',
  'owner',
  'priority',
  'programLead',
  'sponsor',
  'startDate',
  'status',
  'targetDate',
  'team',
]

test('the route handles exactly the fields that were agreed', async () => {
  const source = await readFile('src/app/api/agent/entity/route.ts', 'utf8')

  // Every `case 'x':` in the switch that decides what a change may touch.
  const handled = [...source.matchAll(/^\s+case '([a-zA-Z]+)':/gm)].map((m) => m[1]!)
  const fields = [...new Set(handled)].sort()

  assert.deepEqual(
    fields,
    AGREED,
    'the editable fields changed — is the new one something an agent should be able to edit?',
  )
})

test('there is no create or delete path', async () => {
  const source = await readFile('src/app/api/agent/entity/route.ts', 'utf8')
  assert.ok(!/db\.insert\((?!changelogEntries)/.test(source), 'this route must not insert records')
  assert.ok(!/db\.delete\(/.test(source), 'this route must not delete records')
})

test('a change without a reason cannot be written', async () => {
  const source = await readFile('src/app/api/agent/entity/route.ts', 'utf8')
  // The reason is what makes a change answerable six weeks later, so the
  // early return that enforces it is worth pinning down.
  assert.match(source, /if \(!reason\) \{[\s\S]{0,400}status: 400/)
})

test('statuses come from the lifecycle lists, not from free text', () => {
  assert.ok((PROJECT_STATUS_SET as readonly string[]).includes('completed'))
  assert.ok((PROJECT_STATUS_SET as readonly string[]).includes('canceled'))
  assert.ok(!(PROJECT_STATUS_SET as readonly string[]).includes('done'))
  assert.ok((INITIATIVE_STATUS as readonly string[]).includes('paused'))
  assert.ok(!(PRIORITY as readonly string[]).includes('P0'))
})
