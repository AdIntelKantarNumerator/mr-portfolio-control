/**
 * Client Evaluation (19 November 2026): the parts that decide what the page
 * says without a database - which accounts are one client, how a Magnifier REL
 * reads, and which accounts are our own.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cluster, displayName, domainFitsName, isInternal, links, mainDomains, nameKey, type MatchAccount } from '../src/lib/client-eval/match'
import { parseRel, schemaCountry } from '../src/lib/client-eval/rel'
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
    'rules.ruleA1=media_t2_code:TN TP PM PN RR',
    'rules.ruleA2=DATE_RANGE:for:media_month from:01/01/2023 to:12/31/2027',
    'rules.ruleB=advertiser_code:MCD1 MCD2 MCD3',
    'rules.ruleC=category_t2_code:X1',
    'rules.ruleN=NOT:ruleC',
    'rules.ruleFinal=AND:ruleA1 ruleA2 ruleB ruleN',
    'tlrs.online=ruleFinal',
  ])
  assert.deepEqual(rel.media, ['Print', 'Radio', 'TV'])
  assert.deepEqual(rel.dates, [{ for: 'media_month', from: '01/01/2023', to: '12/31/2027' }])
  const adv = rel.fields.find((f) => f.field === 'advertiser_code')!
  assert.equal(adv.codes, 3)
  const cat = rel.fields.find((f) => f.field === 'category_t2_code')!
  assert.equal(cat.codes, 0)
  assert.equal(cat.excluded, 1, 'a rule under NOT keeps codes out')
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

function parseParts(lines: string[]) {
  return parseRel(lines.join(' '))
}
