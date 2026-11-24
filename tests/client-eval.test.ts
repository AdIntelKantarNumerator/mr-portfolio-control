/**
 * Client Evaluation (19 November 2026): the parts that decide what the page
 * says without a database - which accounts are one client, how a Magnifier REL
 * reads, and which accounts are our own.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clientName, cluster, displayName, domainFitsName, isCanadian, isInternal, links, mainDomains, nameKey, type MatchAccount } from '../src/lib/client-eval/match'
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

test('SSO sign-ins: the last successful sign-in, and how many in 30 days', async () => {
  const { summariseEvents } = await import('../src/lib/client-eval/cognito-signins')
  const now = Date.parse('2026-11-23T12:00:00Z')
  const day = (n: number) => new Date(now - n * 86_400_000)
  const s = summariseEvents(
    [
      { EventType: 'SignIn', EventResponse: 'Fail', CreationDate: day(0) },
      { EventType: 'SignIn', EventResponse: 'Pass', CreationDate: day(1) },
      { EventType: 'ForgotPassword', EventResponse: 'Pass', CreationDate: day(2) },
      { EventType: 'SignIn', EventResponse: 'Pass', CreationDate: day(10) },
      { EventType: 'SignIn', EventResponse: 'Pass', CreationDate: day(40) },
    ],
    now,
  )
  assert.equal(s.last?.toISOString(), day(1).toISOString())
  assert.equal(s.logins30, 2)
  assert.deepEqual(summariseEvents([], now), { last: null, logins30: 0 })
})

test('users CSV: fields are quoted when they need it, and formulas are defused', async () => {
  const { csvField } = await import('../src/lib/client-eval/csv')
  assert.equal(csvField('Jane Doe'), 'Jane Doe')
  assert.equal(csvField('Doe, Jane'), '"Doe, Jane"')
  assert.equal(csvField('Say "hi"'), '"Say ""hi"""')
  assert.equal(csvField('=HYPERLINK(1)'), "'=HYPERLINK(1)")
  assert.equal(csvField(null), '')
})

test('Ratings Usage: months run from October 2026, and a span ends at the next month', async () => {
  const { usageMonths, monthSpan } = await import('../src/lib/client-eval/ratings-usage')
  assert.deepEqual(usageMonths(new Date('2027-01-15T00:00:00Z')), ['2026-10', '2026-11', '2026-12', '2027-01'])
  assert.deepEqual(monthSpan('2026-10', '2026-12'), { start: '2026-10-01', end: '2027-01-01' })
  assert.throws(() => monthSpan('2026-11', '2026-10'))
  assert.throws(() => monthSpan("2026-10'; --", '2026-11'))
})

test('No Recent Logins: the day must be a real YYYY-MM-DD', async () => {
  const { validSince } = await import('../src/lib/client-eval/inactive')
  assert.equal(validSince('2026-05-23'), '2026-05-23')
  assert.throws(() => validSince(null))
  assert.throws(() => validSince('2026-5-23'))
  assert.throws(() => validSince("2026-05-23'; --"))
  assert.throws(() => validSince('2026-13-40'))
})

test('360: a user set is active only when its license group is too', async () => {
  const { isSetActive } = await import('../src/lib/client-eval/load-360')
  assert.equal(isSetActive({ active_f: 1, grp_active: 1 }), true)
  assert.equal(isSetActive({ active_f: 1, grp_active: 0 }), false)
  assert.equal(isSetActive({ active_f: 0, grp_active: 1 }), false)
  assert.equal(isSetActive({ active_f: 1, grp_active: null }), true)
})

test('Migration Plan: Social, AVOD and Live Streaming Sports are premium (National Newspapers is not)', async () => {
  const { MEDIA, PREMIUM_MEDIA, packageByKey } = await import('../src/lib/client-eval/migration/catalog')
  const premium = MEDIA.filter((m) => PREMIUM_MEDIA.has(m.id)).map((m) => m.name)
  assert.deepEqual(premium, ['Social', 'AVOD', 'Live Streaming Sports'])
  assert.equal(packageByKey.get('competitive')?.id, 2)
  assert.equal(packageByKey.get('ratings_us_linear_tv')?.kind, 'add_on')
})

test('Migration Plan: the Word document builds from a plan', async () => {
  const { planDocx } = await import('../src/lib/client-eval/migration/plan-docx')
  const buf = await planDocx({
    version: 1,
    clientId: '360:1',
    client: 'Test Client',
    built: '2026-11-23T00:00:00.000Z',
    depth: 'full',
    summary: ['One account.'],
    organization: { name: 'Test Client', why: 'One organization per client.' },
    accounts: [
      {
        key: 'A1',
        name: 'Test Client',
        type: { value: 'brand_agency', why: '360 Ad Insights - US - Media Buyer' },
        from: [{ key: '360:1', platform: '360', name: 'Test', activeUsers: 2 }],
        why: 'Replaces Test.',
        contract: { lookbackYears: { value: 3, why: 'Standard.' }, includePreliminary: { value: false, why: 'None today.' } },
        packages: [{ key: 'competitive', name: 'Competitive', kind: 'base', why: 'Base.' }],
        coverage: { media: [{ id: 101, name: 'Network TV', type: 'Television', status: 'kept' }], withheld: [{ name: 'Live Streaming Sports', why: 'Premium.' }], countries: [{ code: 'US', name: 'United States', why: 'US.' }], widened: [] },
        seats: 1,
      },
    ],
    users: [{ key: 'a@b.com', name: 'A B', email: 'a@b.com', account: 'A1', role: { value: 'analyst', why: 'Default.' }, create: { value: true, why: 'Recent.' }, lastSeen: '2026-11-01', logins: [{ platform: '360', account: 'Test', login: 'ab', lastSeen: '2026-11-01', active: true }] }],
    workspaces: [{ key: 'W1', account: 'A1', name: 'Ford', source: '360 default reporting profile', users: ['a@b.com'], sets: [{ set: 'advertisers', items: [{ entityType: 139, name: 'Ford', legacy: { platform: '360', list: 'My Brands', id: '1' }, gpc: { id: '2150', name: 'Ford', how: 'Followed' } }], more: 0 }], why: 'Their profile.' }],
    impact: { media: [], gains: ['More media.'], losses: [], notInV1: [] },
    checklist: ['Confirm.'],
    review: { verdict: 'ok', issues: [], model: null },
    deckFocus: [],
    notes: [],
  })
  assert.ok(buf.length > 5000)
  assert.equal(buf.subarray(0, 2).toString(), 'PK')
})

test('Migration Plan: one cache row per key, the last answer kept', () => {
  const list: Array<[string, number | null]> = [['san benedetto', 1], ['ford', 2], ['san benedetto', 3]]
  assert.deepEqual([...new Map(list)], [['san benedetto', 3], ['ford', 2]])
})

test('Client name: the shared name when no account holds half the users', () => {
  const m = (name: string, users: number) => ({ name, users })
  const dmn = m('Dallas Morning News-Dallas DH', 198)
  const hearst = [dmn, m('Hearst TV - Sacramento CA MO', 116), m('Hearst TV - Baltimore MD MO', 82), m('Hearst News - San Antonio Express News', 96), m('Hearst Newspapers - Northeast', 79)]
  assert.equal(clientName(dmn, hearst), 'Hearst')
  // One account with most of the users keeps its own name.
  assert.equal(clientName(m('Horizon Media - New York NY AI', 500), [m('Horizon Media - New York NY AI', 500), m('Other', 10), m('Another', 10)]), 'Horizon Media')
  // Words that begin the other name are no change; hyphens and ampersands inside a word stay.
  assert.equal(clientName(m('The New York Times', 7), [m('The New York Times', 7), m('New York Times Digital', 400), m('New York Times Ads', 500)]), 'The New York Times')
  assert.equal(clientName(m('U.S Bank - MN', 13), [m('U.S Bank - MN', 13), m('M&T Bank Corp', 60), m('M&T Bank - NY', 59)]), 'M&T Bank')
})

test('Canada: an account is Canadian only when all its data is', () => {
  const mag = (countries: string[], searchCountries?: string[]) => ({ kind: 'magnifier' as const, contract: { start: null, end: null }, flags: [], countries, searchCountries, media: [], access: [], namesNote: null, reports: 0 })
  assert.equal(isCanadian(mag(['Canada'])), true)
  assert.equal(isCanadian(mag(['Canada', 'US'])), false)
  assert.equal(isCanadian(mag([], ['Canada'])), true, 'no reports: its saved searches decide')
  assert.equal(isCanadian(mag(['US'], ['Canada'])), false, 'its reports decide when it has some')
  assert.equal(isCanadian(mag([])), false, 'nothing known: not Canadian')
  const s360 = (include: string[]) => ({ kind: '360' as const, application: 'Ad Insights', years: 3, media: { include, exclude: [] }, features: [], filters: [] })
  assert.equal(isCanadian(s360(['Canadian TV', 'Canadian Newspapers'])), true)
  assert.equal(isCanadian(s360(['Canadian TV', 'Network TV'])), false)
  assert.equal(isCanadian(s360([])), false)
  // Named for Canada, with nothing in the data either way: left out (Scott). US data in it wins over the name.
  assert.equal(isCanadian(mag([]), 'General Mills Canada'), true)
  assert.equal(isCanadian(mag(['US']), 'Air Canada'), false)
  assert.equal(isCanadian(s360([]), 'Omnicom Canada MB - AI'), true)
  assert.equal(isCanadian(null, 'Yahoo! Sports Canada'), true)
  assert.equal(isCanadian(mag([]), 'Canadaigua Wine'), false)
})

test('Migration Plan: the premium note says what they keep and what is not included', async () => {
  const { premiumNote } = await import('../src/lib/client-eval/migration/premium')
  const acct = (premium: string[]) => ({ coverage: { media: premium.map((name, i) => ({ id: i, name, type: 'x', status: 'premium' as const })) } }) as never
  assert.match(premiumNote([acct(['Social'])])!, /They keep Social; AVOD and Live Streaming Sports are not included\./)
  assert.match(premiumNote([acct([])])!, /None is included/)
  assert.match(premiumNote([acct(['Social', 'AVOD', 'Live Streaming Sports'])])!, /keep all three/)
})

test('Migration Plan: holding companies go account by account; market-split clients get one account', async () => {
  const { planMode } = await import('../src/lib/client-eval/migration/mode')
  const s360 = (filters: Array<{ type: string; include: string[] }>) => ({ type: 'brand_agency' as const, ent: { kind: '360' as const, application: 'Media Buyer', years: 3, media: null, features: [], filters: filters.map((f) => ({ ...f, exclude: [], count: f.include.length })) } })
  const three = [s360([]), s360([]), s360([])]
  assert.equal(planMode('Publicis Zenith Media', null, three).mode, 'holding')
  assert.equal(planMode('Zenith Solar', 'Publicis Groupe', three).mode, 'holding', 'by its license group')
  assert.equal(planMode('Publicis Zenith Media', null, three.slice(0, 2)).mode, 'standard', 'two accounts are not a holding company')
  const pub = (m: string) => ({ ...s360([{ type: 'Markets', include: [m, '* TOTAL US'] }]), type: 'publisher' as const })
  assert.equal(planMode('Sinclair Broadcasting Corporate', null, [pub('MACON,GA'), pub('TULSA,OK'), pub('ALBANY,GA')]).mode, 'markets')
  assert.equal(planMode('Acme', null, [s360([]), s360([]), s360([])]).mode, 'standard')
})

test('Migration Plan: TV, magazines and newspapers are shown as one each', async () => {
  const { rollupMedia, rollupNames } = await import('../src/lib/client-eval/migration/catalog')
  const m = (name: string, status: 'kept' | 'added' | 'premium') => ({ name, status })
  const r = rollupMedia([m('Network TV', 'added'), m('Cable TV', 'kept'), m('Medical Journals', 'added'), m('Sunday Magazines', 'added'), m('National Newspapers', 'added'), m('Social', 'premium')])
  assert.deepEqual(r.map((x) => [x.name, x.status]), [['Linear TV', 'kept'], ['Magazines', 'added'], ['Newspapers', 'added'], ['Social', 'premium']])
  assert.deepEqual(rollupNames(['Spot TV', 'Syndication', 'Browser Display']), ['Linear TV', 'Browser Display'])
})
