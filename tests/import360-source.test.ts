/**
 * The live 360 source's pure parts (lib/import360/source.ts): the spec a
 * report's rows become, the guards on what reaches SQL, and the settings.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { assembleSpecs, namesSql, partsSql, q360, safePrefix, sql360Config } from '../src/lib/import360/source'

test('a report\'s rows become one compact spec, keyed by client and report', () => {
  const { specs, wantNames } = assembleSpecs({
    cols: [{ p: 'ZMNYAI', reportset_id: 7, coltype_id: 1, entmaj_id: 3, entmin_id: 0, order_id: 1, sortkey_id: 0, totalkey_f: 0, calc_id: 0, demoset_id: 0, reportcol_n: ' Brand ' }],
    opts: [{ p: 'ZMNYAI', reportset_id: 7, rptopt_id: 5, entmaj_id: 0, entmin_id: 0, string_n: null, date1_d: new Date('2026-01-01T00:00:00Z'), date2_d: null, long_v: 3, double_v: null }],
    sels: [
      { p: 'ZMNYAI', reportset_id: 7, mpt_id: 3, entmaj_id: 10, master_id: 100, secondary_id: 0, optmask_id: 0 },
      { p: 'ZMNYAI', reportset_id: 7, mpt_id: 3, entmaj_id: 10, master_id: 101, secondary_id: 0, optmask_id: 64 },
      { p: 'ZMNYAI', reportset_id: 7, mpt_id: 6, entmaj_id: 20, master_id: 20260101, secondary_id: 20260131, optmask_id: 0 },
    ],
    titles: [{ p: 'ZMNYAI', reportset_id: 7, title1: ' Top brands ' }],
  })
  const s = specs.get('zmnyai:7')!
  assert.equal(s.title, 'Top brands')
  assert.equal(s.cols[0]!.name, 'Brand')
  assert.equal(s.opts[0]!.d1, '2026-01-01T00:00:00.000Z')
  assert.deepEqual(s.sel.find((x) => x.e === 10), { mpt: 3, e: 10, ids: [100], ex: [101] }, 'optmask 64 is an exclusion')
  assert.deepEqual(s.sel.find((x) => x.e === 20)!.ranges, [[20260101, 20260131]], 'a second id is a range')
  assert.deepEqual([...wantNames.get(10)!], [100, 101])
})

test('only plain identifiers reach SQL as table names', () => {
  assert.equal(safePrefix('zmnyai_2'), 'zmnyai_2')
  assert.throws(() => safePrefix('x]; DROP TABLE y--'))
  assert.throws(() => partsSql(new Map([['bad name', [1]]])))
  assert.throws(() => partsSql(new Map([['ok', [1.5]]])), /whole number/)
  assert.equal(namesSql({ table_n: 'brand; --', id_field: 'id', name_field: 'n' }, [1]), null)
  assert.match(namesSql({ table_n: 'brand', id_field: 'brand_id', name_field: 'brand_n' }, [1, 2])!, /FROM iddb_master\.dbo\.brand WHERE brand_id IN \(1,2\)/)
})

test('360 is read only: anything but a SELECT is refused before a connection is made', async () => {
  await assert.rejects(q360('UPDATE x SET y = 1'), /SELECT statements only/)
  await assert.rejects(q360('EXEC ai_AddMasterJobQ 1'), /SELECT statements only/)
})

test('the connection needs a server, a login and a password; a port may follow the server', () => {
  assert.equal(sql360Config({}), null)
  assert.equal(sql360Config({ SQL360_SERVER: 'h', SQL360_USERNAME: 'u' }), null, 'no password, no connection')
  const c = sql360Config({ SQL360_SERVER: 'tcp:sql-360-prod.ad.vivvix.com,1444', SQL360_USERNAME: 'svc', SQL360_PASSWORD: 'x' })!
  assert.equal(c.server, 'sql-360-prod.ad.vivvix.com')
  assert.equal(c.port, 1444)
  assert.equal(c.database, 'iddb_custrpt')
  assert.equal(c.options?.readOnlyIntent, true)
})
