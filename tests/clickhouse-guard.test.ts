/**
 * The portfolio only ever reads ClickHouse.
 *
 * Direct access was allowed on 1 October 2026 on exactly that condition, and
 * the account it was handed that day could write: its role carried INSERT,
 * ALTER UPDATE and ALTER DELETE on every database. So these tests do not
 * trust the account. They prove that every query the app actually sends is a
 * read, that a write is refused before it leaves the process, and that every
 * request asks ClickHouse itself to refuse writes as well.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { READ_ONLY_PARAMS, assertReadOnly, readOnlyProblem } from '../src/lib/clickhouse-guard'
import { ALL_QUERIES } from '../src/lib/dictionary-queries'
import { clickhouseConfig } from '../src/lib/clickhouse'

test('every query the Data Dictionary sends is a read', () => {
  for (const [name, sql] of Object.entries(ALL_QUERIES)) {
    assert.equal(readOnlyProblem(sql), null, `${name} was refused by the read-only guard`)
  }
})

test('writes are refused before they are sent', async (t) => {
  const refused = [
    'INSERT INTO gpc_summary.tv_entity_summary_month VALUES (1)',
    'ALTER TABLE gpc_creative.creative_entity DELETE WHERE 1',
    'ALTER TABLE x UPDATE a = 1 WHERE 1',
    'DROP TABLE gpc_reference.property_group',
    'TRUNCATE TABLE x',
    'CREATE TABLE x (a UInt8) ENGINE = Memory',
    'OPTIMIZE TABLE x FINAL',
    'SYSTEM DROP QUERY CACHE',
    'GRANT SELECT ON *.* TO someone',
    'SET readonly = 0',
    'RENAME TABLE a TO b',
    'KILL QUERY WHERE 1',
  ]
  for (const sql of refused) {
    await t.test(sql, () => assert.notEqual(readOnlyProblem(sql), null))
  }

  await t.test('a write smuggled after a read, as a second statement', () => {
    assert.match(readOnlyProblem('SELECT 1; DROP TABLE x')!, /One statement/)
  })
  await t.test('a write inside a read', () => {
    assert.notEqual(readOnlyProblem('SELECT * FROM (INSERT INTO x VALUES (1))'), null)
  })
  await t.test('a read that tries to lift readonly for itself', () => {
    assert.notEqual(readOnlyProblem('SELECT 1 SETTINGS readonly = 0'), null)
  })
  await t.test('assertReadOnly throws rather than returning, so a caller cannot ignore it', () => {
    assert.throws(() => assertReadOnly('DELETE FROM x WHERE 1'), /Refused to send to ClickHouse/)
  })
})

test('reads are not refused for what they mention', async (t) => {
  await t.test('a write word inside a string literal is data, not a verb', () => {
    assert.equal(readOnlyProblem(`SELECT count() FROM system.tables WHERE name = 'drop_zone_insert'`), null)
  })
  await t.test('a write word inside a comment', () => {
    assert.equal(readOnlyProblem(`-- do not insert here\nSELECT 1`), null)
  })
  await t.test('a column whose name contains a write word', () => {
    assert.equal(readOnlyProblem(`SELECT updated_at, delete_flag FROM gpc_raw.creative`), null)
  })
  await t.test('the system database, as opposed to a SYSTEM command', () => {
    assert.equal(readOnlyProblem(`SELECT name FROM system.databases`), null)
  })
  await t.test('SHOW, DESCRIBE, EXISTS and WITH are reads', () => {
    for (const sql of ['SHOW TABLES FROM gpc_summary', 'DESCRIBE TABLE gpc_reference.media', 'EXISTS TABLE x', 'WITH 1 AS a SELECT a']) {
      assert.equal(readOnlyProblem(sql), null, sql)
    }
  })
})

test('every request asks ClickHouse to refuse writes too', () => {
  // readonly=2: writes refused, and the query cannot set readonly back to 0
  // (verified against Dev on 1 October: Code 164). 1 would also refuse the
  // max_execution_time the app sets.
  assert.equal(READ_ONLY_PARAMS.readonly, '2')
  assert.ok(Number(READ_ONLY_PARAMS.max_execution_time) > 0)
})

test('connection settings, per environment', async (t) => {
  await t.test('an environment with no URL is not connected, rather than an error', () => {
    assert.equal(clickhouseConfig('prod', {}), null)
  })
  await t.test('Dev and Prod read their own variables', () => {
    const env = {
      CLICKHOUSE_DEV_URL: 'http://20.10.60.14:8123/',
      CLICKHOUSE_DEV_USER: 'portfolio_ro',
      CLICKHOUSE_DEV_PASSWORD: 'x',
      CLICKHOUSE_PROD_URL: 'https://prod.example:8443',
    }
    const dev = clickhouseConfig('dev', env)!
    assert.equal(dev.url, 'http://20.10.60.14:8123')
    assert.equal(dev.user, 'portfolio_ro')
    assert.equal(clickhouseConfig('prod', env)!.url, 'https://prod.example:8443')
  })
})
