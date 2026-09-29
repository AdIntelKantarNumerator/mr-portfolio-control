/**
 * Building a Linear query that the server will actually accept.
 *
 * The sync failed every run for days with
 *
 *   Field "status" of type "InitiativeStatus!" must have a selection of subfields
 *
 * Linear had turned Initiative.status from an enum into an object. The schema
 * probe checked that a field called "status" still existed, which it did, and
 * went on asking for it as a leaf — and one invalid field takes the entire
 * query down, which is exactly what probing the schema was meant to prevent.
 *
 * These pin the two halves of the fix: the probe now knows a field's type, and
 * the mapper reads either shape, so the next move in either direction is a
 * no-op rather than an outage.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { mapObjectiveStatus } from '../src/lib/sources/linear-map'

test('the objective status maps from either shape Linear has used', async (t) => {
  await t.test('the old enum string', () => {
    assert.equal(mapObjectiveStatus('active'), 'active')
    assert.equal(mapObjectiveStatus('completed'), 'completed')
    assert.equal(mapObjectiveStatus('canceled'), 'canceled')
    assert.equal(mapObjectiveStatus('paused'), 'paused')
  })

  await t.test('the object Linear sends now', () => {
    assert.equal(mapObjectiveStatus({ name: 'In Progress', type: 'started' }), 'active')
    assert.equal(mapObjectiveStatus({ name: 'Backlog', type: 'backlog' }), 'planned')
    assert.equal(mapObjectiveStatus({ name: 'Done', type: 'completed' }), 'completed')
    assert.equal(mapObjectiveStatus({ name: 'Cancelled', type: 'canceled' }), 'canceled')
  })

  await t.test('type beats name, because names are workspace-editable', () => {
    // Somebody renaming their "Done" column to "Shipped" must not silently
    // turn every completed objective back into a planned one.
    assert.equal(mapObjectiveStatus({ name: 'Shipped', type: 'completed' }), 'completed')
  })

  await t.test('falls back to the name when there is no type', () => {
    assert.equal(mapObjectiveStatus({ name: 'paused' }), 'paused')
  })

  await t.test('anything unrecognised is planned, not a crash', () => {
    assert.equal(mapObjectiveStatus(undefined), 'planned')
    assert.equal(mapObjectiveStatus(null), 'planned')
    assert.equal(mapObjectiveStatus({}), 'planned')
    assert.equal(mapObjectiveStatus('something new they added'), 'planned')
  })
})

// ---------------------------------------------------------------------------
// Building the selection set
// ---------------------------------------------------------------------------

// From the schema module, not from linear.ts: that one opens a database
// connection on import, and these rules have nothing to do with a database.
import { PROBE_TYPES, capabilitiesFrom, pick, probeQuery, probeToIntrospection, type LinearCapabilities } from '../src/lib/sources/graphql-schema'

/** A schema the way Linear's introspection returns one. */
function schema(fields: Record<string, Array<[string, string]>>) {
  return {
    __schema: {
      queryType: { name: 'Query' },
      types: [
        { name: 'Query', kind: 'OBJECT', fields: [{ name: 'initiatives', type: { kind: 'OBJECT', name: 'C' } }] },
        ...Object.entries(fields).map(([name, fs]) => ({
          name,
          kind: 'OBJECT',
          fields: fs.map(([f, kind]) =>
            // Wrapped the way a non-null field really arrives, so the
            // unwrapping is exercised rather than assumed.
            kind === 'OBJECT'
              ? { name: f, type: { kind: 'NON_NULL', name: null, ofType: { kind: 'OBJECT', name: 'InitiativeStatus' } } }
              : { name: f, type: { kind: kind, name: 'String' } },
          ),
        })),
      ],
    },
  }
}

function capsFor(fields: Record<string, Array<[string, string]>>): LinearCapabilities {
  return capabilitiesFrom(schema(fields) as never)
}

test('the selection set', async (t) => {
  const caps = capsFor({
    Initiative: [
      ['id', 'SCALAR'],
      ['name', 'SCALAR'],
      ['status', 'OBJECT'],
      ['url', 'SCALAR'],
    ],
  })

  await t.test('knows an object from a scalar, through NON_NULL', () => {
    assert.equal(caps.isLeaf('Initiative', 'name'), true)
    assert.equal(caps.isLeaf('Initiative', 'status'), false)
  })

  await t.test('an object field is asked for with its subfields, never bare', () => {
    const got = pick(caps, 'Initiative', ['id', 'name', 'status', 'url'], { status: 'status { name type }' })
    assert.deepEqual(got, ['id', 'name', 'status { name type }', 'url'])
  })

  await t.test('an object nobody said how to select is dropped, not sent bare', () => {
    // This is the whole fix: the query loses one field instead of returning
    // 400 and losing every field.
    const got = pick(caps, 'Initiative', ['id', 'status'])
    assert.deepEqual(got, ['id'])
  })

  await t.test('a field this schema does not have is dropped as before', () => {
    assert.deepEqual(pick(caps, 'Initiative', ['id', 'notAThing']), ['id'])
  })

  await t.test('a candidate that already carries a selection is passed through', () => {
    assert.deepEqual(pick(caps, 'Initiative', ['status { type }']), ['status { type }'])
  })
})

// ---------------------------------------------------------------------------
// "Query too complex"
// ---------------------------------------------------------------------------

import { complexityRatio, shrinkPage } from '../src/lib/sources/graphql-schema'

/** The message Linear actually sent, from the failing run. */
const REAL =
  'Linear returned 400: {"errors":[{"message":"Query too complex","extensions":{"type":"invalid input",' +
  '"code":"INPUT_ERROR","statusCode":400,"userError":true,"userPresentableMessage":"The query is too complex. ' +
  'Complexity: 65536. Maximum allowed complexity: 10000.","http":{"status":400}}}]}'

test('shrinking a page Linear refused', async (t) => {
  await t.test('reads both numbers out of the real message', () => {
    const ratio = complexityRatio(REAL)
    assert.ok(ratio !== null)
    assert.ok(Math.abs(ratio! - 10000 / 65536) < 1e-9)
  })

  await t.test('the next page is small enough, with room to spare', () => {
    // 50 x (10000/65536) x 0.8 = 6. Six projects a page against a score
    // that was six and a half times the ceiling.
    const next = shrinkPage(50, REAL)
    assert.equal(next, 6)
    // And the score that follows is comfortably under, not on, the line.
    assert.ok((next! / 50) * 65536 < 10000)
  })

  await t.test('a message about something else does not shrink anything', () => {
    assert.equal(shrinkPage(50, 'Linear returned 400: field "status" must have a selection of subfields'), null)
    assert.equal(complexityRatio('no numbers here'), null)
  })

  await t.test('a page of one cannot shrink, so the error is raised instead', () => {
    assert.equal(shrinkPage(1, REAL), null)
  })

  await t.test('a ratio that would not actually shrink stops rather than looping', () => {
    // Already under the ceiling: retrying at the same size would spin.
    assert.equal(shrinkPage(4, 'Complexity: 100. Maximum allowed complexity: 10000.'), null)
  })

  await t.test('nonsense numbers are refused rather than producing a zero page', () => {
    assert.equal(complexityRatio('Complexity: 0. Maximum allowed complexity: 10000.'), null)
    assert.equal(complexityRatio('Complexity: abc. Maximum allowed complexity: 10000.'), null)
  })
})

test('the ceiling is never mistaken for the score', () => {
  // "Complexity:" occurs inside "Maximum allowed complexity:" too. Reading
  // them with two separate searches matched the ceiling twice and returned a
  // ratio of 1 — a shrink to the same size, which is a retry loop.
  assert.equal(complexityRatio('Complexity: abc. Maximum allowed complexity: 10000.'), null)
  assert.equal(complexityRatio('Maximum allowed complexity: 10000.'), null)
})

// --- the probe -------------------------------------------------------------

test('the probe asks for four types, not the whole schema', () => {
  // The full introspection is the most expensive query a sync sends and the
  // first one it sends, so when Linear refuses it on complexity the run dies
  // before writing anything — and the page-shrink cannot help, because a
  // schema probe has no page size to shrink.
  const q = probeQuery()
  assert.equal((q.match(/__type\(name:/g) ?? []).length, 4)
  assert.ok(!/types\s*\{/.test(q), 'it must not ask for every type in the schema')
})

test('every type the sync asks about is in the probe', () => {
  // The two lists drifting apart is silent: a type left out of the probe has
  // no capabilities, so every optional field on it is quietly dropped and the
  // sync carries on writing nulls.
  for (const t of ['Team', 'User', 'Initiative', 'Project']) {
    assert.ok(PROBE_TYPES.includes(t as (typeof PROBE_TYPES)[number]), `${t} is missing from PROBE_TYPES`)
  }
})

test('the probe response reads exactly as a full introspection did', () => {
  const caps = capabilitiesFrom(
    probeToIntrospection({
      __schema: { queryType: { name: 'Query', fields: [{ name: 'teams' }, { name: 'initiatives' }] } },
      t0: { name: 'Team', kind: 'OBJECT', fields: [{ name: 'id', type: { kind: 'SCALAR', name: 'String' } }] },
      t1: null,
      t2: {
        name: 'Initiative',
        kind: 'OBJECT',
        fields: [{ name: 'status', type: { kind: 'OBJECT', name: 'InitiativeStatus' } }],
      },
      t3: null,
    } as never),
  )
  assert.equal(caps.hasQuery('teams'), true)
  assert.equal(caps.hasQuery('issues'), false)
  assert.equal(caps.has('Team', 'id'), true)
  assert.equal(caps.isLeaf('Team', 'id'), true)
  // An object still needs a selection; that rule is what the probe exists for.
  assert.equal(caps.isLeaf('Initiative', 'status'), false)
})

test('a type the schema does not have simply has no capabilities', () => {
  const caps = capabilitiesFrom(
    probeToIntrospection({
      __schema: { queryType: { name: 'Query', fields: [] } },
      t0: null,
      t1: null,
      t2: null,
      t3: null,
    } as never),
  )
  assert.equal(caps.has('Project', 'anything'), false)
  assert.equal(caps.isLeaf('Project', 'anything'), false)
})

test('a single-type probe aliases to t0, which the fallback reads', () => {
  // The per-type fallback merges `one.t0` into the combined shape. If the
  // alias ever stopped being t0 the fallback would silently produce a schema
  // with no capabilities at all — every optional field dropped, sync still
  // "succeeding".
  const q = probeQuery(['Initiative'])
  assert.match(q, /t0: __type\(name: "Initiative"\)/)
  assert.equal((q.match(/__type\(name:/g) ?? []).length, 1)
})

test('the probe still asks for the type of each field, not just its name', () => {
  // This is the rule the whole module exists for: a field name alone is not
  // enough, because an object asked for bare is a 400.
  assert.match(probeQuery(['Team']), /type \{ kind name ofType/)
})
