/**
 * Taxonomy Comparison, 16 November 2026: the swap (GPC on the left), the left
 * bar broken out by the source's own nodes, the node Sankey in the Industry
 * View, and a narrative that explains the shifts.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeFlags, explainShift, levelName, noneLabel, rankSrcNodes, sides, toCsv, type Flow } from '../src/lib/taxonomy-rules'
import { nodeChildren, nodeFlows, sankeyFiltered, type NodeSankey } from '../src/lib/taxonomy-industry-rules'

const flow = (over: Partial<Flow>): Flow => ({
  month: '2026-08',
  media: 'Linear TV',
  gpcId: '48823',
  gpcName: 'Progressive',
  gpcParentId: '1532',
  gpcParentName: 'The Progressive Corporation',
  industry: 'Insurance',
  category: 'Property & Casualty Insurance',
  subcategory: null,
  srcIndustry: 'Insurance',
  srcCategory: 'Consumer Property & Casualty',
  srcSubcategory: null,
  spend: 0,
  ...over,
})

// VX2 Progressive into GPC, as read on 16 November 2026 (in $M).
const progressive = [
  flow({ spend: 291.5 }),
  flow({ gpcId: '15504', gpcName: 'Progressive', gpcParentId: '15504', gpcParentName: 'Progressive', spend: 13.6, srcCategory: 'General Insurance' }),
  flow({ gpcId: '1532', gpcName: 'The Progressive Corporation', spend: 4.6 }),
  flow({ gpcId: '19987', gpcName: 'Cozy Earth, LLC', gpcParentId: '19987', gpcParentName: 'Cozy Earth, LLC', industry: 'Household Furnishings', spend: 0.4 }),
  flow({ gpcId: null, gpcName: null, gpcParentId: null, gpcParentName: null, spend: 0.3 }),
]

test('the reported case: duplicate Progressive entities and the Corporation, and what one entity would take', () => {
  const story = explainShift(progressive, { sourceName: 'Progressive', left: 'VX2', right: 'GPC' })!
  assert.match(story.headline, /94% lands on Progressive #48823 in GPC/)
  const related = story.details.find((d) => /aligned to a single GPC entity/.test(d))!
  assert.match(related, /GPC has 2 entities named “Progressive”, plus The Progressive Corporation/)
  assert.match(related, /99\.\d% of the spend would land on it/)
  assert.ok(!story.details.some((d) => /unrelated/.test(d)), 'Cozy Earth is 0.1%: not worth a sentence')
  assert.ok(story.details.some((d) => /By industry: mostly Insurance in VX2/.test(d)))
})

test('unrelated advertisers taking a real share are named, and so is spend with no advertiser', () => {
  const flows = [flow({ spend: 80 }), flow({ gpcId: '9', gpcName: 'Omnicom Media', gpcParentId: '9', gpcParentName: 'Omnicom', spend: 12 }), flow({ gpcId: null, gpcName: null, gpcParentId: null, gpcParentName: null, spend: 8 })]
  const d = explainShift(flows, { sourceName: 'Progressive', left: 'VX1', right: 'GPC' })!.details
  assert.ok(d.some((x) => /12% lands on an unrelated advertiser: Omnicom Media 12%/.test(x)))
  assert.ok(d.some((x) => /8(\.0)?% has no GPC advertiser/.test(x)))
})

test('swapped, the sides and their words turn round', () => {
  assert.deepEqual(sides('VX1', 'from-gpc'), { left: 'GPC', right: 'VX1' })
  assert.deepEqual(sides('VX1'), { left: 'VX1', right: 'GPC' })
  assert.equal(levelName('VX1', 'category'), 'Major')
  assert.equal(levelName('Classic', 'industry'), 'Level 1')
  assert.equal(noneLabel('VX2'), 'No VX2 advertiser')
  const flags = computeFlags({ entity: { id: '48823', name: 'Progressive', kind: 'exact' }, flows: [flow({ spend: 50 }), flow({ gpcId: null, spend: 50 })] }, 'VX1', 'from-gpc')
  assert.ok(flags.some((f) => /has no VX1 advertiser/.test(f.text)))
  const story = explainShift([flow({ gpcName: 'Progressive', spend: 99 })], { sourceName: 'Progressive', left: 'GPC', right: 'VX1' })!
  assert.match(story.headline, /of GPC spend; 100% lands on Progressive in VX1/)
})

test('the left bar is broken out by the source side, and a run from before says it cannot be', () => {
  const r = rankSrcNodes(progressive, 'category')!
  assert.deepEqual(r.map((x) => x.key), ['Consumer Property & Casualty', 'General Insurance'])
  const old = progressive.map(({ srcIndustry, srcCategory, srcSubcategory, ...f }) => (void srcIndustry, void srcCategory, void srcSubcategory, f))
  assert.equal(rankSrcNodes(old, 'category'), null)
})

test('the CSV names its columns for the sides', () => {
  const csv = toCsv('VX1', [{ input: 'Progressive', entity: { id: '48823', name: 'Progressive', kind: 'exact' }, candidates: [], flows: [flow({ spend: 1 })], flags: [], commentary: '' }], 'from-gpc')
  const head = csv.replace(/^﻿/, '').split('\r\n')[0]!
  assert.match(head, /VX1 advertiser,VX1 id/)
  assert.match(head, /VX1 major/)
  assert.match(head, /FROM category/)
})

const sankey: NodeSankey = {
  flows: {
    VX1: [
      { adv: '6944', advName: 'Progressive', l1: 'Insurance & Real Estate', l2: 'Property & Casualty', l3: 'Auto', media: 'CTV', month: '2026-09', spend: 30 },
      { adv: 'OTHER', advName: null, l1: 'Insurance & Real Estate', l2: 'Property & Casualty', l3: null, media: 'Digital', month: '2026-09', spend: 5 },
    ],
    Classic: [{ adv: '12', advName: 'Progressive Corp', l1: 'Finance', l2: null, l3: null, media: null, month: null, spend: 20 }],
  },
  children: [{ key: 'Auto Insurance', label: 'Auto Insurance', cells: [{ media: 'CTV', month: '2026-09', spend: 30 }] }],
}

test("a node's Sankey: legacy advertisers as the target, OTHER named, filters where the slices allow them", () => {
  const all = nodeFlows(sankey, 'VX1')
  assert.equal(all.length, 2)
  assert.equal(all[1]!.gpcName, 'All other advertisers')
  assert.equal(nodeFlows(sankey, 'VX1', { media: 'CTV' }).length, 1)
  assert.equal(nodeFlows(sankey, 'Classic', { media: 'CTV' }).length, 1, 'Classic has no media: kept')
  assert.equal(sankeyFiltered(sankey, 'Classic'), false)
  assert.deepEqual(nodeChildren(sankey, { media: 'Digital' }), [])
  assert.equal(nodeChildren(sankey)[0]!.spend, 30)
})
