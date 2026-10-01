/**
 * The Data Dictionary's judgements: what is noise, what is loaded, and what
 * needs somebody's attention.
 *
 * The cases are the ones found on the live Dev read of 1 October 2026: the
 * backup tables sitting in browsable schemas, Sports Sponsorship's eight
 * empty tables, and Entitlements' one table that is empty on purpose.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  compactCount,
  datasetStatus,
  excludedByRule,
  needsAttention,
  parseTableRef,
  readEnvironment,
  type EmptyReason,
} from '../src/lib/dictionary-rules'

test('tables hidden by rule', async (t) => {
  await t.test('the backups and scratch tables actually found on Dev', () => {
    for (const name of [
      'property_bak_20260930',
      'property_group_bak_20260930',
      'property_group_entity_map_bak_20260930',
      'pgem_bak_preauto',
      '_tmp_replace_4824245b7735f341_eqajwvtzbfd4bfeb',
      'creative_iceberg_test',
      'creative_iceberg_v3_test',
      '.inner_id.0f8e',
    ]) {
      assert.notEqual(excludedByRule(name), null, name)
    }
  })

  await t.test('real tables whose names merely contain the letters', () => {
    for (const name of [
      'property_group',
      'creative_text_search',
      'tv_gold_occurrence_stage',
      'latest_metrics',
      'contest_entries',
      'backlog',
      '_oldmap',
    ]) {
      assert.equal(excludedByRule(name), null, name)
    }
  })
})

test('whether a dataset is loaded', async (t) => {
  const rows = (entries: [string, number][]) => new Map(entries.map(([ref, n]) => [ref, { rows: n }]))
  const none = new Map<string, EmptyReason>()

  await t.test('Sports Sponsorship: every table exists and every one is empty', () => {
    const refs = ['gpc_detail.sports_sponsorship_detail', 'gpc_reference.sponsorship_asset']
    const reasons = new Map<string, EmptyReason>(refs.map((r) => [r, 'awaiting_feed']))
    assert.equal(datasetStatus(refs, rows([[refs[0]!, 0], [refs[1]!, 0]]), reasons).status, 'not_loaded')
  })

  await t.test('Entitlements: a table empty by design does not make it partial', () => {
    const refs = ['gpc_entitlement.account_scope', 'gpc_entitlement.account_provider_block']
    const reasons = new Map<string, EmptyReason>([['gpc_entitlement.account_provider_block', 'by_design']])
    const catalog = rows([
      ['gpc_entitlement.account_scope', 12],
      ['gpc_entitlement.account_provider_block', 0],
    ])
    assert.equal(datasetStatus(refs, catalog, reasons).status, 'loaded')
  })

  await t.test('an empty table with no stated reason counts against, so it gets asked about', () => {
    const refs = ['a.loaded', 'a.empty']
    assert.equal(datasetStatus(refs, rows([['a.loaded', 5], ['a.empty', 0]]), none).status, 'partial')
  })

  await t.test('a table the dataset names but ClickHouse does not have is missing, not loaded', () => {
    const r = datasetStatus(['a.here', 'a.gone'], rows([['a.here', 5]]), none)
    assert.equal(r.status, 'partial')
    assert.equal(r.tables.find((x) => x.ref === 'a.gone')!.state, 'missing')
  })

  await t.test('an environment that could not be read is unknown, not "not loaded"', () => {
    assert.equal(datasetStatus(['a.b'], null, none).status, 'unknown')
  })
})

test('what needs attention', async (t) => {
  await t.test('loaded when it should be: fine', () => assert.equal(needsAttention('loaded', 'loaded'), false))
  await t.test('should be loaded and is not', () => assert.equal(needsAttention('partial', 'loaded'), true))
  await t.test('awaiting a feed and still empty: fine', () => assert.equal(needsAttention('not_loaded', 'awaiting_feed'), false))
  await t.test('planned for Prod and not there yet: that is what planned means', () =>
    assert.equal(needsAttention('not_loaded', 'planned'), false))
  await t.test('nobody has said: always needs attention', () => assert.equal(needsAttention('loaded', 'undecided'), true))
  await t.test('an environment that cannot be read cannot disagree with anything', () =>
    assert.equal(needsAttention('unknown', 'loaded'), false))
})

test('small things', async (t) => {
  await t.test('table refs split on the first dot only', () => {
    assert.deepEqual(parseTableRef('gpc_reference.property_group'), { database: 'gpc_reference', table: 'property_group' })
    assert.deepEqual(parseTableRef('reference..inner.x'), { database: 'reference', table: '.inner.x' })
    assert.equal(parseTableRef('nodot'), null)
    assert.equal(parseTableRef('.x'), null)
  })
  await t.test('anything but "prod" is Dev, so a mistyped link never reads Prod by accident', () => {
    assert.equal(readEnvironment('prod'), 'prod')
    assert.equal(readEnvironment('PROD'), 'dev')
    assert.equal(readEnvironment(undefined), 'dev')
  })
  await t.test('row counts read compactly', () => {
    assert.equal(compactCount(5_450_000_000), '5.45bn')
    assert.equal(compactCount(861_551), '862k')
    assert.equal(compactCount(1_080), '1,080')
  })
})
