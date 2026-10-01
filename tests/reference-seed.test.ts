/**
 * The starting map and dictionary are internally consistent, and say what
 * was decided.
 *
 * The seed was generated from a reviewed mock and then edited by hand, which
 * is exactly how a link ends up naming a component that was renamed. The seed
 * script would fail loudly on that; this fails before it ever runs. It also
 * pins the three scope decisions of 1 October 2026, so a later edit to the
 * seed cannot quietly put Cube or VX1 serving back into the contract.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  SEED_COLUMN_NOTES,
  SEED_COMPONENTS,
  SEED_DATABASES,
  SEED_DATASETS,
  SEED_GROUPS,
  SEED_LINKS,
  SEED_TABLE_NOTES,
} from '../src/lib/reference-seed'
import { COMPONENT_KINDS, layout } from '../src/lib/workflow-map'
import { DATABASE_STATUSES, EMPTY_REASONS, INTENTS, excludedByRule, parseTableRef } from '../src/lib/dictionary-rules'

test('the map', async (t) => {
  const keys = new Set(SEED_COMPONENTS.map((c) => c.key))
  const groups = new Set(SEED_GROUPS.map((g) => g.key))

  await t.test('component keys are unique', () => assert.equal(keys.size, SEED_COMPONENTS.length))

  await t.test('every component is in a group that exists, and of a kind the app knows', () => {
    for (const c of SEED_COMPONENTS) {
      assert.ok(groups.has(c.group), `${c.key} is in unknown group ${c.group}`)
      assert.ok((COMPONENT_KINDS as readonly string[]).includes(c.kind), `${c.key} has kind ${c.kind}`)
    }
  })

  await t.test('every link names two components that exist, and none links to itself or repeats', () => {
    const seen = new Set<string>()
    for (const [from, to] of SEED_LINKS) {
      assert.ok(keys.has(from), `link from unknown ${from}`)
      assert.ok(keys.has(to), `link to unknown ${to}`)
      assert.notEqual(from, to)
      assert.ok(!seen.has(`${from}>${to}`), `duplicate link ${from} → ${to}`)
      seen.add(`${from}>${to}`)
    }
  })

  await t.test('nothing is an island: every component has at least one connection', () => {
    const touched = new Set(SEED_LINKS.flat())
    const islands = SEED_COMPONENTS.filter((c) => !touched.has(c.key)).map((c) => c.key)
    assert.deepEqual(islands, [])
  })

  await t.test('it lays out with every arrow running left to right', () => {
    const r = layout(
      SEED_COMPONENTS.map((c) => c.key),
      SEED_LINKS.map(([from, to]) => ({ from, to })),
    )
    assert.deepEqual(r.backLinks, [])
  })

  await t.test('every component says what it handles', () => {
    const undescribed = SEED_COMPONENTS.filter((c) => !c.description).map((c) => c.key)
    assert.deepEqual(undescribed, [])
  })

  await t.test('Cube is not a live component: it was eliminated', () => {
    const live = SEED_COMPONENTS.filter((c) => /\bcube\b/i.test(c.name))
    assert.deepEqual(live.map((c) => c.key), [])
  })
})

test('the dictionary', async (t) => {
  const status = new Map(SEED_DATABASES.map((d) => [d.name, d.status]))

  await t.test('the client contract, as decided', () => {
    for (const db of ['gpc_reference', 'gpc_mapping', 'gpc_creative', 'gpc_detail', 'gpc_summary', 'gpc_entitlement', 'entitlement', 'entitlement_ref']) {
      assert.equal(status.get(db), 'contract', db)
    }
  })

  await t.test('VX1 serving is being eliminated, not part of the contract', () => {
    for (const db of ['summary', 'detail', 'reference', 'creative', 'control']) assert.equal(status.get(db), 'transition', db)
  })

  await t.test('the superseded entitlement models and the stale databases are out', () => {
    assert.equal(status.get('entitlement_scope'), 'superseded')
    assert.equal(status.get('entitlement_future_archive'), 'superseded')
    for (const db of ['lab', 'perftest', 'staging']) assert.equal(status.get(db), 'excluded', db)
  })

  await t.test('every status, intent and empty reason is one the app knows', () => {
    for (const d of SEED_DATABASES) assert.ok((DATABASE_STATUSES as readonly string[]).includes(d.status), d.name)
    for (const d of SEED_DATASETS) {
      assert.ok((INTENTS as readonly string[]).includes(d.intentDev), d.name)
      assert.ok((INTENTS as readonly string[]).includes(d.intentProd), d.name)
    }
    for (const n of SEED_TABLE_NOTES) if (n.emptyReason) assert.ok((EMPTY_REASONS as readonly string[]).includes(n.emptyReason), n.tableRef)
  })

  await t.test('every table a dataset names is a database.table, and none is a backup', () => {
    for (const d of SEED_DATASETS) {
      for (const ref of d.tables) {
        const parsed = parseTableRef(ref)
        assert.ok(parsed, `${d.name}: ${ref}`)
        assert.equal(excludedByRule(parsed!.table), null, `${d.name} includes ${ref}`)
      }
    }
  })

  await t.test('no dataset is built on a database that is being eliminated', () => {
    for (const d of SEED_DATASETS) {
      for (const ref of d.tables) {
        const db = parseTableRef(ref)!.database
        assert.notEqual(status.get(db), 'transition', `${d.name} includes ${ref}`)
        assert.notEqual(status.get(db), 'superseded', `${d.name} includes ${ref}`)
      }
    }
  })

  await t.test('Sports Sponsorship is defined above the schemas, with its own intent', () => {
    const sports = SEED_DATASETS.find((d) => d.name === 'Sports Sponsorship')
    assert.ok(sports)
    assert.equal(sports!.intentDev, 'awaiting_feed')
    // Renamed on Dev on 1 October from sports_sponsorship_detail; the seed follows.
    assert.ok(sports!.tables.includes('gpc_detail.sports_sponsorship_entity_detail'))
    const schemas = new Set(sports!.tables.map((r) => parseTableRef(r)!.database))
    assert.ok(schemas.size > 1, 'a dataset spans schemas; that is the point of it')
  })

  await t.test('column notes name real table refs and one column each', () => {
    const seen = new Set<string>()
    for (const c of SEED_COLUMN_NOTES) {
      assert.ok(parseTableRef(c.tableRef), c.tableRef)
      const k = `${c.tableRef}.${c.column}`
      assert.ok(!seen.has(k), `duplicate column note ${k}`)
      seen.add(k)
    }
  })
})
