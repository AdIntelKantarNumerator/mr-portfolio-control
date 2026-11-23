/**
 * Client Evaluation (19 November 2026): the parts that decide what the page
 * says without a database - which accounts are one client, how a Magnifier REL
 * reads, and which accounts are our own.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cluster, displayName, domainFitsName, isInternal, links, mainDomains, nameKey, type MatchAccount } from '../src/lib/client-eval/match'
import { mediaOf, parseRel, readable, schemaCountry } from '../src/lib/client-eval/rel'
import { tidy } from '../src/lib/client-eval/rel-names'
import { memberKey, parseMember } from '../src/lib/client-eval/types'

const acct = (key: string, name: string, domains: Record<string, number> = {}, company: string | null = null): MatchAccount => ({
  key,
  platform: parseMember(key)!.platform,
  name,
  company,
  domains,
  users: Object.values(domains).reduce((a, b) => a + b, 0),
})

test('names lose corporate words, platform noise and punctuation', () => {
  assert.equal(nameKey('Horizon Media, Inc.'), 'horizon')
  assert.equal(nameKey("McDonald's Corporation"), 'mcdonalds')
  assert.equal(nameKey('Coca-Cola Canada - Brand C'), 'coca cola')
  // A name made only of noise keeps its words rather than becoming empty.
  assert.equal(nameKey('Media'), 'media')
})

test('the same name on two platforms is one client', () => {
  const a = [acct('360:1', 'Horizon Media - New York NY AI'), acct('classic:9', 'Horizon Media'), acct('magnifier:HZN', 'Acme Foods')]
  const { links: l } = links(a)
  const c = cluster(a.map((x) => x.key), l, new Map(), [], [])
  assert.equal(c.length, 3, 'the location tag keeps the 360 name apart from "horizon"')
  const b = [acct('360:1', 'Horizon Media'), acct('classic:9', 'Horizon Media Inc'), acct('magnifier:X', 'Acme Foods')]
  const c2 = cluster(b.map((x) => x.key), links(b).links, new Map(), [], [])
  assert.equal(c2.length, 2)
  assert.deepEqual(c2.find((x) => x.members.length === 2)!.members, ['360:1', 'classic:9'])
})

test('360 user sets under one license group are one client', () => {
  const a = [acct('360:1', 'Publicis Starcom - AI', {}, 'Starcom Media Group'), acct('360:2', 'Publicis SparkFoundry - AI', {}, 'Starcom Media Group')]
  const { links: l } = links(a)
  assert.equal(l[0]!.kind, 'company')
  assert.equal(cluster(a.map((x) => x.key), l, new Map(), [], []).length, 1)
})

test('a shared company domain links accounts whose names agree; free mail never does', () => {
  assert.deepEqual(mainDomains({ domains: { 'gmail.com': 9, 'acme.com': 1 }, users: 10 }), [])
  assert.deepEqual(mainDomains({ domains: { 'acme.com': 6, 'gmail.com': 4 }, users: 10 }), ['acme.com'])
  assert.ok(domainFitsName('nbcuni.com', ['nbcuniversal']))
  assert.ok(domainFitsName('ca.omd.com', ['omd']))
  assert.ok(!domainFitsName('gm.com', ['general', 'motors', 'canada']))
  const a = [acct('360:1', 'NBCUniversal Local', { 'nbcuni.com': 20 }), acct('magnifier:NBC', 'NBC Universal Media', { 'nbcuni.com': 5 })]
  const r = links(a)
  assert.ok(r.links.some((x) => x.kind === 'domain' || x.kind === 'name' || x.kind === 'similar'))
})

test('a shared domain with unlike names is asked about, not assumed', () => {
  const a = [acct('360:1', 'Blue Harbor Partners', { 'bhp.com': 8 }), acct('classic:2', 'Northwind Outfitters', { 'bhp.com': 6 })]
  const r = links(a)
  assert.equal(r.links.length, 0)
  assert.equal(r.ask.length, 1)
  // The model's yes joins them; its no, or no answer, leaves them apart.
  const keys = a.map((x) => x.key)
  assert.equal(cluster(keys, r.links, new Map([['360:1|classic:2', { same: true, why: 'same agency' }]]), r.ask, []).length, 1)
  assert.equal(cluster(keys, r.links, new Map([['360:1|classic:2', { same: false, why: null }]]), r.ask, []).length, 2)
  assert.equal(cluster(keys, r.links, new Map(), r.ask, []).length, 2)
})

test("people's merges and splits win, the latest for an account counting", () => {
  const a = [acct('360:1', 'Horizon Media'), acct('classic:9', 'Horizon Media'), acct('magnifier:Z', 'Zebra Co')]
  const keys = a.map((x) => x.key)
  const { links: l } = links(a)
  assert.equal(cluster(keys, l, new Map(), [], []).length, 2)
  // Split: classic:9 stands alone, despite the name.
  assert.equal(cluster(keys, l, new Map(), [], [{ kind: 'split', member: 'classic:9', withMember: null }]).length, 3)
  // Merge: Zebra goes with Horizon.
  assert.equal(cluster(keys, l, new Map(), [], [{ kind: 'merge', member: 'magnifier:Z', withMember: '360:1' }]).length, 1)
  // A merge after a split undoes the split.
  const both = cluster(keys, l, new Map(), [], [
    { kind: 'split', member: 'classic:9', withMember: null },
    { kind: 'merge', member: 'classic:9', withMember: '360:1' },
  ])
  assert.equal(both.length, 2)
  // An override for an account no longer in the snapshot is ignored.
  assert.equal(cluster(keys, l, new Map(), [], [{ kind: 'merge', member: 'magnifier:GONE', withMember: '360:1' }]).length, 2)
})

test('our own accounts are internal by name or by who uses them', () => {
  assert.ok(isInternal({ name: 'DirectHeat Internal Support Media', domains: {} }))
  assert.ok(isInternal({ name: 'Insights Studio Demo', domains: {} }))
  assert.ok(!isInternal({ name: 'Development Counsellors International', domains: {} }), 'a word, not part of one')
  assert.ok(isInternal({ name: 'Some Account', domains: { 'mediaradar.com': 3, 'acme.com': 1 } }))
  assert.ok(!isInternal({ name: 'Ameriprise', domains: { 'numerator.com': 2 } }), 'too few people to tell')
})

test('client names lose the location and product tags platforms add', () => {
  assert.equal(displayName('Horizon Media - New York NY AI'), 'Horizon Media')
  assert.equal(displayName('Publicis Zenith Media - AI'), 'Publicis Zenith Media')
  assert.equal(displayName('Omnicom OMG PHD MB'), 'Omnicom OMG PHD')
  assert.equal(displayName('COMB'), 'COMB')
})

test('member keys round-trip, and reject an unknown platform', () => {
  assert.deepEqual(parseMember(memberKey('magnifier', ' PMPI')), { platform: 'magnifier', accountId: ' PMPI' })
  assert.equal(parseMember('oracle:1'), null)
})

test('a REL reads as the fields it restricts, its media and its dates', () => {
  const rel = parseParts([
    '# McDonalds OMD # Brand Monthly # Updated on 01/07/2026 JIRA #INTS-35418',
    'rules.ruleA1=media_t2_code:TN TP PM PN RR DO # comment, not codes',
    'rules.ruleA2=DATE_RANGE:for:media_month from:01/01/2023 to:12/31/2027',
    'rules.ruleB=advertiser_code:MCD1 MCD2 MCD3',
    'rules.ruleC=category_t2_code:X1',
    'rules.ruleN=NOT:ruleC',
    'rules.ruleFinal=AND:ruleA1 ruleA2 ruleB ruleN',
    'tlrs.online=ruleFinal',
  ])
  assert.deepEqual(rel.media, ['Digital', 'Print', 'Radio', 'TV'])
  assert.deepEqual(rel.dates, [{ for: 'media_month', from: '01/01/2023', to: '12/31/2027' }])
  const adv = rel.fields.find((f) => f.field === 'advertiser_code')!
  assert.deepEqual(adv.codes, ['MCD1', 'MCD2', 'MCD3'])
  const cat = rel.fields.find((f) => f.field === 'category_t2_code')!
  assert.equal(cat.codes.length, 0)
  assert.deepEqual(cat.excluded, ['X1'], 'a rule under NOT keeps codes out')
  assert.match(rel.notes, /McDonalds OMD/)
  assert.equal(schemaCountry('brand-c.occurrence'), 'US')
  assert.equal(schemaCountry('brand-monthly.summary'), 'Canada')
  assert.equal(schemaCountry('brand-n.occurrence'), 'Canada')
  assert.equal(schemaCountry('other'), null)
})

test('an empty or unreadable REL is no restriction, not an error', () => {
  assert.deepEqual(parseRel(null).fields, [])
  assert.deepEqual(parseRel('just a comment').fields, [])
})

test('media roll up to media, not submedia; PS is paid social', () => {
  assert.equal(mediaOf('media_t1_code', 'O'), 'Digital')
  assert.equal(mediaOf('media_t1_code', 'B'), 'Digital')
  assert.equal(mediaOf('media_t1_code', 'PS'), 'Paid social')
  assert.equal(mediaOf('media', 'T'), 'TV')
  assert.equal(mediaOf('media_t2_code', 'PM'), 'Print')
  assert.equal(mediaOf('media_t2_code', 'DE'), 'Digital')
  assert.equal(mediaOf('media_t1_code', 'Q'), null)
})

test('a REL reads as names, with wildcards and markets said plainly', () => {
  const rel = parseRel('rules.a=advertiser_code:WALMRT *IN rules.b=dma_code:USA MIAM rules.c=subcategory_code:734831 rules.d=media_t1_code:T rules.e=media_t1_code:S rules.f=NOT:e')
  const names: Record<string, string> = { 'advertiser:WALMRT': 'Walmart', 'industry:IN': 'Insurance', 'subcategory:734831': 'Insurance: Image' }
  const r = readable(rel, (kind, code) => names[`${kind}:${code}`])
  assert.deepEqual(r.media, ['TV'])
  assert.deepEqual(r.rows.find((x) => x.label === 'Advertisers')!.items, ['All of Insurance', 'Walmart'])
  assert.deepEqual(r.rows.find((x) => x.label === 'Markets')!.items, ['MIAM', 'National (US)'])
  assert.deepEqual(r.rows.find((x) => x.label === 'Subcategories')!.items, ['Insurance: Image'])
  assert.deepEqual(r.rows.find((x) => x.label === 'Media kept out')!.items, ['Social'])
})

test("Canada's capitalised names are title-cased; mixed case is left alone", () => {
  assert.equal(tidy('TD BANK FINANCIAL GROUP'), 'TD Bank Financial Group')
  assert.equal(tidy('McDonald’s'), 'McDonald’s')
})

function parseParts(lines: string[]) {
  return parseRel(lines.join(' '))
}

test('a 360 reporting profile reads as its choices, not the options it offered', async () => {
  const { summariseProfile } = await import('../src/lib/client-eval/profiles')
  const s = summariseProfile(
    JSON.stringify({
      Measures: { MeasuresList: [{ Description: 'Dollars' }, { Description: 'GRP' }], HasTVRatingsMeasures: true, MeasureFormatDesc: 'Dollars/IMPs Format: 000s' },
      Media: {
        AllMediaAreSelected: false,
        MediaList: [
          { Description: 'Network TV', MediaTypeDescription: 'TV' },
          { Description: 'Cable TV', MediaTypeDescription: 'TV' },
          { Description: 'Paid Social', MediaTypeDescription: 'Digital' },
        ],
      },
      Markets: { AllMarketsAreSelected: false, MarketsList: [{ Name: 'LOUISVILLE', LongName: 'LOUISVILLE,KY' }] },
      Demographics: { DemographicsList: [{ Description: 'Households' }] },
      AvailableDemographics: { DemographicsList: [{ Description: 'Adults 18-49' }] },
      RatingType: { Description: 'Program' },
      DemographicMarketType: { Description: 'General' },
      TotalColumnDesc: 'Include Total Column: Last',
    }),
  )
  assert.deepEqual(s.measures, ['Dollars', 'GRP'])
  assert.deepEqual(s.media, [
    { type: 'TV', media: ['Network TV', 'Cable TV'] },
    { type: 'Digital', media: ['Paid Social'] },
  ])
  assert.deepEqual(s.markets, ['LOUISVILLE,KY'])
  assert.deepEqual(s.demographics, ['Households'], 'what was offered is not what was picked')
  assert.equal(s.rating, 'Program')
  assert.deepEqual(s.options, ['Dollars/IMPs Format: 000s', 'Include Total Column: Last'])
  const all = summariseProfile(JSON.stringify({ Media: { AllMediaAreSelected: true }, Markets: { AllMarketsAreSelected: true } }))
  assert.equal(all.media, null)
  assert.equal(all.markets, null)
  assert.equal(summariseProfile('not json').measures.length, 0)
})

test('media map: what stays, drops and is added, per platform (Impact Deck)', async () => {
  const { mediaChange, MEDIA_360, GPC_MEDIA } = await import('../src/lib/client-eval/media-map')
  const m = mediaChange('360', ['Network TV', 'Cable TV', 'Local Radio', 'Search', 'Browser Display'])
  assert.deepEqual(m.kept, ['Network TV', 'Cable TV', 'Browser Display'])
  assert.deepEqual(m.dropped, ['Local Radio', 'Search'])
  assert.ok(m.added.includes('Native') && m.added.includes('Social') && !m.added.includes('Cable TV'))
  assert.equal(m.hasDigital, true)
  const mag = mediaChange('magnifier', ['TV', 'Radio', 'Paid social'])
  assert.ok(mag.kept.includes('Spot TV') && mag.kept.includes('Social'))
  assert.deepEqual(mag.dropped, ['Radio'])
  assert.equal(mag.hasDigital, false)
  assert.deepEqual(mediaChange('classic', ['Magazine', 'Website', 'Mystery']).unknown, ['Mystery'])
  // Every 360 media maps to GPC media that exist.
  for (const to of Object.values(MEDIA_360)) for (const t of to) assert.ok((GPC_MEDIA as readonly string[]).includes(t))
})

test('a from → to Sankey keeps the big flows and folds slivers into Other', async () => {
  const { sankeyOf } = await import('../src/lib/client-eval/deck-sankey')
  const f = (gpc: string, cat: string, spend: number) => ({ month: '2026-08' as const, media: 'Linear TV' as const, gpcId: gpc, gpcName: gpc, gpcParentId: gpc, gpcParentName: gpc, industry: 'I', category: cat, subcategory: null, spend })
  const s = sankeyOf('Acme', [f('Acme Inc', 'Snacks', 90), f('Acme Inc', 'Drinks', 5), f('Tiny Co', 'Snacks', 1)], 'advertiser', '360')
  assert.deepEqual(s.columns, ['360 advertiser', 'Insights Studio advertiser', 'Insights Studio category'], 'the deck never says VX1, VX2 or GPC')
  assert.deepEqual(s.nodes[1]!.map((n) => n.name), ['Acme Inc', 'Other'], 'Tiny Co is under 3%')
  assert.equal(s.nodes[0]![0]!.spend, 96)
  const flowed = s.links.filter((l) => l.col === 1).reduce((a, l) => a + l.spend, 0)
  assert.equal(flowed, 96, 'every dollar reaches a category')
})

test('a Magnifier saved search reads like a REL: its codes as fields, media rolled up (23 November 2026)', async () => {
  const { searchAsRel, codesToName } = await import('../src/lib/client-eval/saved-searches')
  const rel = searchAsRel({
    fields: [
      { name: 'brand-c.occurrence/advertiserName', include: ['ZYZXPM'], exclude: [] },
      { name: 'brand-c.occurrence/mediaTier1Name', include: ['T', 'O'], exclude: [] },
      { name: 'brand-c.occurrence/culturalNames', include: ['general_media'], exclude: [] },
      { name: 'brand-c.occurrence/productName', include: [], exclude: [] },
    ],
    summaryTags: [{ name: 'brand-n.occurrence/categoryTier2Name', include: ['734614'], exclude: ['1'] }],
  })
  assert.deepEqual(rel.media, ['Digital', 'TV'])
  assert.deepEqual(rel.fields.find((f) => f.field === 'advertiser_code')!.codes, ['ZYZXPM'])
  assert.equal(rel.fields.find((f) => f.field === 'culturalNames')!.label, 'Cultural')
  assert.ok(!rel.fields.some((f) => f.field === 'product_code'), 'an empty filter is no filter')
  const want = codesToName([rel])
  assert.deepEqual([...want.get('advertiser')!], ['ZYZXPM'])
  assert.deepEqual([...want.get('subcategory')!], ['734614', '1'])
})
