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
  computeFlags,
  filterFlows,
  flowTotal,
  NO_GPC,
  OTHER,
  rankAdvertisers,
  sankeyData,
  UNCLASSIFIED,
  type Flow,
  matchKind,
  normaliseName,
  parseAdvertisers,
  compactName,
  namePatterns,
  toCsv,
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

test('punctuation never hides a candidate: both sides compare letters and digits only', () => {
  assert.equal(compactName("Wendy's"), compactName('Wendys'))
  assert.equal(compactName('AT&T'), 'att')
  assert.ok(namePatterns('Wendys').includes('%wendys%'))
  assert.ok(namePatterns("Wendy's").includes('%wendys%'))
  assert.deepEqual(namePatterns('The Procter & Gamble Company'), ['%theproctergamblecompany%', '%procter%gamble%', '%procter%'])
  assert.equal(matchKind("Wendy's", 'Wendys'), 'close')
})

const flow = (gpcId: string | null, gpcName: string | null, category: string | null, spend: number, media = 'Digital', month = '2026-08'): Flow => ({
  month: month as Flow['month'],
  media: media as Flow['media'],
  gpcId,
  gpcName,
  industry: category ? 'Insurance' : null,
  category,
  subcategory: null,
  spend,
})

const entity = { id: '1', name: 'Acme', kind: 'exact' as const }

test('several material GPC advertisers and unmapped dollars are each flagged', () => {
  const flows = [flow('10', 'Acme', 'P&C', 700_000), flow('11', 'Acme', 'P&C', 200_000), flow(null, null, null, 100_000)]
  const kinds = computeFlags({ entity, flows }, 'VX1').map((f) => f.kind)
  assert.deepEqual(kinds.sort(), ['split', 'unmapped'])
})

test('one GPC advertiser with a sliver elsewhere is clean', () => {
  const flows = [flow('10', 'Acme', 'P&C', 990_000), flow('11', 'Acme Dealer', 'P&C', 10_000)]
  assert.deepEqual(computeFlags({ entity, flows }, 'VX2'), [])
})

test('a renamed match is flagged with its VX1 level; a missing one stops there', () => {
  const flags = computeFlags({ entity: { id: 'P1', name: 'Acme Co', kind: 'close', level: 'Parent company' }, flows: [flow('10', 'Acme', 'P&C', 1)] }, 'VX1')
  assert.ok(flags[0].text.includes('(parent company)'))
  assert.deepEqual(computeFlags({ entity: null, flows: [] }, 'Classic').map((f) => f.kind), ['missing'])
})

test('Classic always says its own total and the linked creative total are different estimates', () => {
  const flags = computeFlags({ entity, flows: [flow('10', 'Acme', 'P&C', 5)], classicReported: 9 }, 'Classic')
  assert.ok(flags.some((f) => f.kind === 'coverage'))
})

test('same-named GPC advertisers are told apart by id', () => {
  const ranked = rankAdvertisers([flow('48823', 'Progressive', 'P&C', 9), flow('15504', 'Progressive', 'P&C', 1)])
  assert.deepEqual(ranked.map((r) => r.label), ['Progressive #48823', 'Progressive #15504'])
})

test('the Sankey folds the tail into Other but keeps "none" and "unclassified" apart, and its links add up', () => {
  const flows = [
    ...Array.from({ length: 10 }, (_, i) => flow(String(i), `Adv ${i}`, `Cat ${i}`, 100 - i)),
    flow(null, null, null, 50),
  ]
  const d = sankeyData(flows, 'category', 3)
  assert.deepEqual(d.advertisers.map((r) => r.key), ['0', '1', '2', OTHER, NO_GPC])
  assert.ok(d.nodes.some((r) => r.key === UNCLASSIFIED))
  assert.equal(Math.round(d.links.reduce((a, l) => a + l.spend, 0)), Math.round(flowTotal(flows)))
})

test('filters narrow by media and month', () => {
  const flows = [flow('1', 'A', 'C', 1, 'Digital', '2026-08'), flow('1', 'A', 'C', 2, 'CTV', '2026-09')]
  assert.equal(flowTotal(filterFlows(flows, { media: 'CTV' })), 2)
  assert.equal(flowTotal(filterFlows(flows, { month: '2026-08' })), 1)
})

test('the CSV has a row per flow and names the FROM taxonomy', () => {
  const r = { input: 'Acme', entity, candidates: [], flows: [flow('1', 'Acme, Inc.', 'P&C', 10), flow('2', 'B', 'P&C', 5)], flags: [], commentary: '' }
  const lines = toCsv('VX2', [r]).trim().split(String.fromCharCode(13, 10))
  assert.equal(lines.length, 3)
  assert.ok(lines[1].includes(',VX2,') && lines.some((l) => l.includes('"Acme, Inc."')))
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
