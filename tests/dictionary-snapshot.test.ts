import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseSnapshot } from '../src/lib/dictionary-snapshot'

// Scott, 2 November 2026: Prod ClickHouse is on a private address the site
// cannot reach, so a laptop on the VPN sends a copy. A copy replaces the last
// one wholesale, so a broken one must never get in.

const table = { database: 'contact', name: 'agency', ref: 'contact.agency', engine: 'ReplicatedMergeTree', rows: 9060, bytes: 1, comment: '', sortingKey: 'winmo_agency_id', partitionKey: '', metadataModified: null, lastWrite: '2026-11-02 06:42:00', latestPartition: null, columnCount: 23 }
const good = { env: 'prod', takenAt: '2026-11-02T21:34:00.000Z', takenBy: 'Scott Bernberg', catalog: { env: 'prod', readAt: '2026-11-02T21:34:00.000Z', databases: [{ name: 'contact', comment: '' }], tables: [table] }, columns: { 'contact.agency': [] } }

test('a well-formed copy is accepted, as the environment it names', () => {
  const s = parseSnapshot(good)
  assert.notEqual(typeof s, 'string')
  if (typeof s === 'string') return
  assert.equal(s.env, 'prod')
  assert.equal(s.catalog.tables.length, 1)
  assert.equal(s.takenBy, 'Scott Bernberg')
})

test('an empty or broken copy is refused rather than emptying the dictionary', () => {
  assert.match(parseSnapshot({ ...good, catalog: { ...good.catalog, tables: [] } }) as string, /no tables/)
  assert.match(parseSnapshot({ ...good, env: 'staging' }) as string, /env/)
  assert.match(parseSnapshot({ ...good, takenAt: 'yesterday' }) as string, /ISO time/)
  assert.match(parseSnapshot({ ...good, takenAt: '2099-01-01T00:00:00Z' }) as string, /future/)
  assert.match(parseSnapshot({ ...good, catalog: { ...good.catalog, tables: [{ ...table, ref: 'agency' }] } }) as string, /ref/)
  assert.match(parseSnapshot({ ...good, columns: [] }) as string, /columns/)
})
