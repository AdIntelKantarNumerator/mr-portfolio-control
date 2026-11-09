/**
 * Taxonomy Comparison, 9 November 2026: the GPC product breakout beside the
 * advertisers, and the Industry View - a node's top spenders as products,
 * brands, advertisers or parents, counting only what was attributed to the
 * node's own products.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NO_GPC, rankProducts, toCsv, type Flow } from '../src/lib/taxonomy-rules'
import { buildTree, industryResult, pathTo, rankIndustry, type TaxNode } from '../src/lib/taxonomy-industry-rules'

const flow = (over: Partial<Flow>): Flow => ({
  month: '2026-08',
  media: 'Digital',
  gpcId: '10',
  gpcName: 'Progressive',
  industry: 'Insurance',
  category: 'Auto',
  subcategory: null,
  spend: 100,
  ...over,
})

test('products are ranked by attributed spend; spend with no payer stays "No GPC advertiser", as on the advertiser list', () => {
  const rows = rankProducts([
    flow({ gpcProductId: '1', gpcProductName: 'Progressive Auto Insurance', spend: 300 }),
    flow({ gpcProductId: '2', gpcProductName: 'Progressive Home', spend: 100 }),
    flow({ gpcProductId: '1', gpcProductName: 'Progressive Auto Insurance', spend: 50, media: 'CTV' }),
    flow({ gpcId: null, gpcName: null, gpcProductId: null, gpcProductName: null, spend: 25 }),
  ])!
  assert.deepEqual(rows.map((r) => [r.label, r.spend]), [['Progressive Auto Insurance', 350], ['Progressive Home', 100], [NO_GPC, 25]])
})

test('a comparison run before products were recorded says so rather than showing none', () => {
  assert.equal(rankProducts([flow({})]), null)
  assert.deepEqual(rankProducts([]), [])
})

test('the CSV carries the product beside the advertiser', () => {
  const csv = toCsv('VX2', [{ input: 'Progressive', entity: { id: '6944', name: 'Progressive', kind: 'exact' }, candidates: [], flows: [flow({ gpcProductId: '1', gpcProductName: 'Progressive Auto Insurance' })], flags: [], commentary: '' }])
  const [head, row] = csv.replace(/^﻿/, '').split('\r\n')
  const cols = head!.split(',')
  const at = cols.indexOf('GPC product')
  assert.ok(at > 0)
  assert.equal(row!.split(',')[at], 'Progressive Auto Insurance')
  assert.equal(row!.split(',').length, cols.length)
})

const nodes: TaxNode[] = [
  { id: '1', parentId: null, level: 'Industry Group', name: 'Media' },
  { id: '104', parentId: '1', level: 'Industry', name: 'Streaming Media' },
  { id: '339', parentId: '104', level: 'Category', name: 'Video Streaming Media' },
  { id: '338', parentId: '104', level: 'Category', name: 'Audio Streaming Media' },
  { id: '900', parentId: '777', level: 'Category', name: 'Orphan of an inactive parent' },
]

test('the tree nests by parent, sorted by name, and keeps a node whose parent is inactive', () => {
  const roots = buildTree(nodes)
  assert.deepEqual(roots.map((r) => r.name), ['Media', 'Orphan of an inactive parent'])
  assert.deepEqual(roots[0]!.children[0]!.children.map((c) => c.name), ['Audio Streaming Media', 'Video Streaming Media'])
  assert.deepEqual(pathTo(nodes, '339'), ['Media', 'Streaming Media', 'Video Streaming Media'])
})

// Streaming Media, as Databricks returns it: the spenders kept per view by
// month and media, the node's totals, and how many there are in all.
const raw = [
  { gby: 'advertiser', key: '5', name: 'Disney+', media: 'CTV', month: '202608', spend: 600 },
  { gby: 'advertiser', key: '5', name: 'Disney+', media: 'Digital', month: '202609', spend: 200 },
  { gby: 'advertiser', key: '7', name: 'Apple', media: 'Digital', month: '202608', spend: 300 },
  { gby: 'advertiser', key: '8', name: 'Apple', media: 'CTV', month: '202609', spend: 100 },
  { gby: 'product', key: '42', name: 'Apple TV+', media: 'Digital', month: '202608', spend: 300 },
  { gby: 'total', key: null, name: null, media: 'CTV', month: '202608', spend: 600 },
  { gby: 'total', key: null, name: null, media: 'Digital', month: '202608', spend: 300 },
  { gby: 'total', key: null, name: null, media: 'Digital', month: '202609', spend: 200 },
  { gby: 'total', key: null, name: null, media: 'CTV', month: '202609', spend: 100 },
  { gby: 'count', key: 'advertiser', name: null, media: null, month: null, spend: 3 },
  { gby: 'count', key: 'product', name: null, media: null, month: null, spend: 1 },
]
const result = industryResult({ id: '104', name: 'Streaming Media', level: 'Industry', path: ['Media', 'Streaming Media'] }, raw, '2026-11-09T12:00:00Z')

test("a node's spenders: biggest first, each a share of the node's whole spend, and two of one name told apart", () => {
  const r = rankIndustry(result, 'advertiser')
  assert.equal(r.total, 1200)
  assert.deepEqual(r.rows.map((x) => [x.label, x.spend]), [['Disney+', 800], ['Apple #7', 300], ['Apple #8', 100]])
  assert.equal(r.rows[0]!.share, 800 / 1200)
  assert.equal(r.listedShare, 1)
  assert.equal(r.count, 3)
})

test('the media and month filters re-rank what was read, against the total for the same filter', () => {
  const r = rankIndustry(result, 'advertiser', { media: 'Digital' })
  assert.equal(r.total, 500)
  assert.deepEqual(r.rows.map((x) => [x.key, x.spend]), [['7', 300], ['5', 200]])
  const sep = rankIndustry(result, 'advertiser', { month: '2026-09' })
  assert.deepEqual(sep.rows.map((x) => x.key), ['5', '8'])
})

test('top N cuts the list and says what the listed take together', () => {
  const r = rankIndustry(result, 'advertiser', {}, 1)
  assert.equal(r.rows.length, 1)
  assert.equal(r.listedShare, 800 / 1200)
})

test('a view with nothing read is empty, not an error', () => {
  assert.deepEqual(rankIndustry(result, 'brand').rows, [])
})
