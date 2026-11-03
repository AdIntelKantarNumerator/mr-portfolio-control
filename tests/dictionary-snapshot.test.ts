import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseSnapshot, SAMPLE_BYTES_MAX, SAMPLE_TEXT_MAX, trimSample } from '../src/lib/dictionary-snapshot'

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

// 3 November 2026: the copy keeps each table's first rows too (no personal
// data, anyone may see them). Every sample is sent on every snapshot, so one
// table with a blob in each row must not make the copy enormous.
test('samples keep short values as they are, cut long ones, and fit a budget per table', () => {
  assert.deepEqual(trimSample([{ id: 1, name: 'Acme', tags: ['a'] }]), [{ id: 1, name: 'Acme', tags: ['a'] }])
  const [row] = trimSample([{ blob: 'x'.repeat(5000) }])
  assert.equal(String(row!.blob).length < SAMPLE_TEXT_MAX + 40, true)
  assert.match(String(row!.blob), /cut from 5000 characters/)
  const wide = Array.from({ length: 10 }, () => Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`c${i}`, 'y'.repeat(250)])))
  const kept = trimSample(wide)
  assert.ok(kept.length >= 1 && kept.length < 10)
  assert.ok(JSON.stringify(kept).length <= SAMPLE_BYTES_MAX || kept.length === 1)
})

test('a copy may carry samples, or not; anything else in their place is refused', () => {
  assert.equal((parseSnapshot({ ...good, previews: { 'contact.agency': { columns: [], rows: [] } } }) as { previews: object }).previews !== null, true)
  assert.equal((parseSnapshot(good) as { previews: unknown }).previews, null)
  assert.match(parseSnapshot({ ...good, previews: [] }) as string, /previews/)
})
