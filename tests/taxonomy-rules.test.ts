/**
 * Taxonomy Comparison (Scott, 29 October 2026): parsing the pasted list,
 * telling an exact name from a near one, and the flags — which are computed,
 * so the same numbers always raise the same ones.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canSee, NO_ROLE } from '../src/lib/access-rules'
import { assertSelect } from '../src/lib/databricks'
import {
  addToGrid,
  computeFlags,
  matchKind,
  normaliseName,
  parseAdvertisers,
  searchTerms,
  toCsv,
  type Grid,
  type Taxonomy,
  type TaxonomyResult,
} from '../src/lib/taxonomy-rules'

test('one advertiser per line; commas stay inside a name; repeats and bullets dropped', () => {
  const { names, error } = parseAdvertisers('Procter & Gamble Co., The\n\n- Toyota\n2. Progressive\ntoyota\n')
  assert.equal(error, undefined)
  assert.deepEqual(names, ['Procter & Gamble Co., The', 'Toyota', 'Progressive'])
})

test('an empty paste and an oversized one are refused', () => {
  assert.ok(parseAdvertisers('  \n ').error)
  assert.ok(parseAdvertisers(Array.from({ length: 26 }, (_, i) => `Advertiser ${i}`).join('\n')).error)
})

test('a leading number that is the name is kept', () => {
  assert.deepEqual(parseAdvertisers('3M\n7-Eleven').names, ['3M', '7-Eleven'])
})

test('names normalise past case, punctuation and legal suffixes', () => {
  assert.equal(normaliseName('The Procter & Gamble Company'), 'procter and gamble')
  assert.equal(normaliseName('Procter and Gamble Co.'), 'procter and gamble')
  assert.equal(matchKind('Progressive', 'progressive'), 'exact')
  assert.equal(matchKind('Progressive', 'The Progressive Corporation'), 'close')
  assert.equal(matchKind('Progressive', 'Progressive Lighting'), 'different')
})

test('search terms lead with the whole name, then its longest words', () => {
  assert.deepEqual(searchTerms('The Procter & Gamble Company'), ['procter and gamble', 'procter', 'gamble'])
  assert.deepEqual(searchTerms('3M'), ['3m'])
})

const result = (name: string | null, spend: [string, string, number][] = [], kind: 'exact' | 'close' | 'different' = 'exact'): TaxonomyResult => {
  const grid: Grid = {}
  for (const [m, mo, v] of spend) addToGrid(grid, m as never, mo as never, v)
  return { entity: name ? { id: '1', name, kind } : null, grid }
}

test('a missing advertiser, a renamed match, a gap and a spread are each flagged', () => {
  const t: Record<Taxonomy, TaxonomyResult> = {
    VX1: result('Acme', [['Digital', '2026-08', 100_000], ['Linear TV', '2026-08', 50_000]]),
    VX2: result('Acme Corp', [['Digital', '2026-08', 400_000], ['Linear TV', '2026-09', 50_000]], 'close'),
    GPC: result(null),
    Classic: result('Acme', [['Digital', '2026-09', 110_000]]),
  }
  const flags = computeFlags('Acme', t)
  const kinds = flags.map((f) => `${f.kind}:${f.taxonomy ?? f.media}`)
  assert.ok(kinds.includes('missing:GPC'))
  assert.ok(kinds.includes('name:VX2'))
  assert.ok(kinds.includes('spread:Digital'), kinds.join())
  assert.ok(kinds.includes('gap:Linear TV'), kinds.join())
})

test('Classic is not flagged for CTV, which it does not track', () => {
  const t: Record<Taxonomy, TaxonomyResult> = {
    VX1: result('Acme', [['CTV', '2026-08', 80_000]]),
    VX2: result('Acme', [['CTV', '2026-08', 80_000]]),
    GPC: result('Acme', [['CTV', '2026-08', 80_000]]),
    Classic: result('Acme'),
  }
  assert.deepEqual(computeFlags('Acme', t), [])
})

test('small amounts are not flagged', () => {
  const t: Record<Taxonomy, TaxonomyResult> = {
    VX1: result('Acme', [['Print', '2026-08', 900]]),
    VX2: result('Acme'),
    GPC: result('Acme'),
    Classic: result('Acme'),
  }
  assert.deepEqual(computeFlags('Acme', t), [])
})

test('the CSV has a row per taxonomy, media type and month, and marks untracked media', () => {
  const t: Record<Taxonomy, TaxonomyResult> = { VX1: result('Acme, Inc.'), VX2: result('Acme'), GPC: result('Acme'), Classic: result('Acme') }
  const csv = toCsv([{ input: 'Acme', taxonomies: t, flags: [], commentary: '' }])
  const lines = csv.trim().split('\r\n')
  assert.equal(lines.length, 1 + 4 * 5 * 2)
  assert.ok(lines.some((l) => l.includes('"Acme, Inc."')))
  assert.ok(lines.some((l) => l.startsWith('Acme,MediaRadar Classic') && l.includes(',CTV,') && l.includes('not tracked')))
})

test('every role may open the comparison', () => {
  assert.ok(canSee(NO_ROLE, '/taxonomy-comparison'))
  assert.ok(canSee(NO_ROLE, '/taxonomy-comparison/csv'))
})

test('only a single SELECT reaches Databricks', () => {
  assert.doesNotThrow(() => assertSelect('SELECT a FROM t WHERE name ILIKE :q'))
  assert.doesNotThrow(() => assertSelect("WITH x AS (SELECT 1) SELECT * FROM x -- note; here"))
  assert.throws(() => assertSelect('DROP TABLE t'))
  assert.throws(() => assertSelect('SELECT 1; DELETE FROM t'))
})
