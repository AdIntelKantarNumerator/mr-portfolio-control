/**
 * One client list from three platforms' accounts (Client Evaluation).
 *
 * Scott: "consolidate the client list to a single list ... you'll have to do
 * some fuzzy matching or use your own knowledge or an LLM." Pure: no database
 * and no model here. The model's verdicts come in as `judgments`, the hand-made
 * merges and splits as `overrides`, and the caller asks the model about the
 * pairs `links()` could not settle.
 *
 * WHAT PUTS TWO ACCOUNTS TOGETHER, strongest first
 *
 *   company   Two 360 user sets under one license group: 360 says so itself.
 *   name      The same name once corporate words, punctuation and platform
 *             noise ("Inc", "Brand C", "- Canada") are taken out.
 *   domain    Most of both accounts' users share an email domain that is not a
 *             free-mail or our own, and the names agree at least partly.
 *   similar   The names share their distinctive words. Words are weighted by
 *             how rare they are across all accounts, so "Media" or "Group"
 *             count for little and "Meredith" for a lot.
 *   model     A pair that is plausible but not certain (a shared domain with
 *             unlike names, or names that are close but not close enough),
 *             judged by the model and remembered.
 *   merge     A person said so (ce_overrides), which beats all of the above.
 *
 * A split (a person said this account stands alone) removes every automatic
 * link to it. Overrides are keyed by "platform:account_id", which a refresh
 * does not change, so they outlive it.
 */
import { AGENCY } from './migration/mode'
import type { Entitlements, Platform } from './types'

/** The big agencies' own email domains (their staff, not their clients'). */
const AGENCY_DOMAIN = /^(carat|dentsu|dentsux|omc|omd|omg|groupm|wpp|wppmedia|publicis|publicismedia|publicisgroupe|starcom|starcomww|sparkfoundry|sparkfoundryww|zenith|zenithmedia|mindshare|mindshareworld|wavemaker|wavemakerglobal|essencemediacom|mediacom|horizonmedia|hearts-science|phd|phdmedia|initiative|umww|havas|havasmedia|iprospect|digitas|ipg|interpublic|mediabrands)\./i

export interface MatchAccount {
  key: string
  platform: Platform
  name: string
  company: string | null
  /** Users' email domains and how many users have each. */
  domains: Record<string, number>
  users: number
}

export type LinkKind = 'company' | 'name' | 'domain' | 'similar' | 'team' | 'model' | 'merge'
export interface Link {
  a: string
  b: string
  kind: LinkKind
  why: string
}
export interface Ask {
  a: string
  b: string
  why: string
}

/** Domains that say nothing about which company someone works for, and our own. */
export const GENERIC_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com', 'icloud.com', 'me.com', 'msn.com', 'live.com',
  'comcast.net', 'verizon.net', 'att.net', 'sbcglobal.net', 'ymail.com', 'protonmail.com', 'mail.com', 'gmx.com',
  'yahoo.ca', 'hotmail.ca', 'rogers.com', 'shaw.ca', 'sympatico.ca', 'bell.net', 'videotron.ca', 'telus.net',
  'mediaradar.com', 'vivvix.com', 'kantarmedia.com', 'kantar.com', 'competitrack.com', 'numerator.com', 'directheat.com', 'example.com', 'test.com',
])

const CORPORATE = new Set([
  'inc', 'incorporated', 'llc', 'llp', 'ltd', 'limited', 'corp', 'corporation', 'co', 'company', 'plc', 'gmbh', 'sa', 'ag', 'nv', 'bv', 'pty',
  'the', 'and', 'of', 'usa', 'us', 'na', 'ulc', 'lp',
])
/** Words platforms add to an account name that are not part of the client's name. */
const NOISE = new Set([
  'brand', 'brandc', 'brandn', 'monthly', 'canada', 'canadian', 'ca', 'test', 'trial', 'demo', 'internal', 'account',
  'media', 'buyer', 'owner', 'sellside', 'buyside', 'classic', 'magnifier', '360', 'adintel', 'freemium', 'old', 'new', 'do', 'not', 'use',
])

/** The words of a name that identify the client. */
export function nameWords(name: string): string[] {
  const w = name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\(([^)]*)\)/g, ' ')
    .replace(/['’.]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((x) => x && !CORPORATE.has(x))
  const core = w.filter((x) => !NOISE.has(x) && !/^[a-z]$/.test(x))
  return core.length ? core : w
}

/** A name with its noise removed, for exact matching. */
export const nameKey = (name: string) => nameWords(name).join(' ')

/** The domains most of an account's users have: a third or more of them, and at least two people unless the account is tiny. */
export function mainDomains(a: Pick<MatchAccount, 'domains' | 'users'>): string[] {
  const total = Object.values(a.domains).reduce((s, n) => s + n, 0)
  if (!total) return []
  return Object.entries(a.domains)
    .filter(([d, n]) => !GENERIC_DOMAINS.has(d) && n / total >= 0.3 && (n >= 2 || total <= 2))
    .map(([d]) => d)
}

/** The part of a domain that is a name ("nbcuni" from "nbcuni.com", "omd" from "ca.omd.com"). */
export const domainStem = (d: string) => {
  const parts = d.split('.')
  // "acme.co.uk", "acme.com.au": the name is one further left.
  const second = parts.length >= 3 && parts[parts.length - 1]!.length === 2 && ['co', 'com', 'org', 'net', 'ac', 'gov'].includes(parts[parts.length - 2]!)
  return parts[Math.max(0, parts.length - (second ? 3 : 2))] ?? d
}

/** Weighted word overlap, 0 to 1: shared words over all words, each weighted by how rare it is. */
export function nameScore(a: string[], b: string[], weight: (w: string) => number): number {
  const A = new Set(a)
  const B = new Set(b)
  let shared = 0
  let all = 0
  for (const w of new Set([...A, ...B])) {
    const x = weight(w)
    all += x
    if (A.has(w) && B.has(w)) shared += x
  }
  return all ? shared / all : 0
}

/** Whether a domain is plainly this name's ("nbcuni.com" and "NBCUniversal", "omd.com" and "OMD Canada"). */
export function domainFitsName(domain: string, words: string[]): boolean {
  const stem = domainStem(domain).replace(/[^a-z0-9]/g, '')
  if (stem.length < 3) return false
  const joined = words.join('')
  const initials = words.map((w) => w[0]).join('')
  return words.includes(stem) || (joined.length >= 3 && (joined.startsWith(stem) || stem.startsWith(joined))) || (initials.length >= 3 && initials === stem)
}

const SURE = 0.86
const MAYBE = 0.6
/** A domain this many accounts share is a holding company's or a network's, not a client's. */
const CROWDED = 12

/** Every automatic link, and the pairs to ask the model about. */
export function links(accounts: MatchAccount[]): { links: Link[]; ask: Ask[] } {
  const out: Link[] = []
  const ask = new Map<string, Ask>()
  const words = new Map(accounts.map((a) => [a.key, nameWords(a.name)]))
  const byKey = new Map(accounts.map((a) => [a.key, a]))
  const pair = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)
  const linked = new Set<string>()
  const add = (a: string, b: string, kind: LinkKind, why: string) => {
    if (a === b || linked.has(pair(a, b))) return
    linked.add(pair(a, b))
    ask.delete(pair(a, b))
    out.push({ a, b, kind, why })
  }
  const maybe = (a: string, b: string, why: string) => {
    if (a === b || linked.has(pair(a, b)) || ask.has(pair(a, b))) return
    ask.set(pair(a, b), { a: a < b ? a : b, b: a < b ? b : a, why })
  }

  // Word rarity across every account name.
  const df = new Map<string, number>()
  for (const w of words.values()) for (const x of new Set(w)) df.set(x, (df.get(x) ?? 0) + 1)
  const n = accounts.length || 1
  const weight = (w: string) => Math.log(1 + n / (df.get(w) ?? 1))

  // company: 360's license groups.
  const byCompany = new Map<string, string[]>()
  for (const a of accounts) if (a.platform === '360' && a.company) (byCompany.get(a.company.toLowerCase()) ?? byCompany.set(a.company.toLowerCase(), []).get(a.company.toLowerCase())!).push(a.key)
  for (const [company, keys] of byCompany) for (const k of keys.slice(1)) add(keys[0]!, k, 'company', `Same 360 license group, ${company}`)

  // name: the same name, noise removed. A license group's name counts as one of its accounts' names.
  const byName = new Map<string, string[]>()
  const note = (k: string, key: string) => {
    if (!key) return
    const list = byName.get(key) ?? byName.set(key, []).get(key)!
    if (!list.includes(k)) list.push(k)
  }
  for (const a of accounts) {
    note(a.key, nameKey(a.name))
    if (a.company) note(a.key, nameKey(a.company))
  }
  for (const [key, keys] of byName) for (const k of keys.slice(1)) add(keys[0]!, k, 'name', `Same name, "${key}"`)

  // domain: accounts on different platforms whose users share a company's domain.
  const byDomain = new Map<string, string[]>()
  for (const a of accounts) for (const d of mainDomains(a)) (byDomain.get(d) ?? byDomain.set(d, []).get(d)!).push(a.key)
  for (const [d, keys] of byDomain) {
    const crowded = keys.length > CROWDED
    for (let i = 0; i < keys.length; i++)
      for (let j = i + 1; j < keys.length; j++) {
        const A = byKey.get(keys[i]!)!
        const B = byKey.get(keys[j]!)!
        if (A.platform === B.platform) continue
        // A big agency's domain does not tie an account in a brand's 360 license group to anything: its staff serve
        // many brands. Carat Detroit, in General Motors' group, linked by carat.com to Carat's Home Depot team, which
        // brought Home Depot's own accounts into General Motors (Scott, 25 November 2026).
        if (AGENCY_DOMAIN.test(d) && [A, B].some((x) => x.company && !AGENCY.test(x.company))) continue
        const wa = words.get(A.key)!
        const wb = words.get(B.key)!
        const score = nameScore(wa, wb, weight)
        if (score >= MAYBE / 2 || (domainFitsName(d, wa) && domainFitsName(d, wb))) add(A.key, B.key, 'domain', `Users share ${d}`)
        else if (!crowded) maybe(A.key, B.key, `Users share ${d}, names differ`)
      }
  }

  // similar: distinctive words in common, compared within each rare-enough word's bucket.
  const byWord = new Map<string, string[]>()
  for (const a of accounts) for (const w of new Set(words.get(a.key)!)) if (w.length >= 3) (byWord.get(w) ?? byWord.set(w, []).get(w)!).push(a.key)
  for (const [, keys] of byWord) {
    if (keys.length > 150) continue
    for (let i = 0; i < keys.length; i++)
      for (let j = i + 1; j < keys.length; j++) {
        const A = byKey.get(keys[i]!)!
        const B = byKey.get(keys[j]!)!
        if (A.platform === B.platform) continue
        const score = nameScore(words.get(A.key)!, words.get(B.key)!, weight)
        if (score >= SURE) add(A.key, B.key, 'similar', `Names agree (${Math.round(score * 100)}%)`)
        else if (score >= MAYBE) maybe(A.key, B.key, `Names are close (${Math.round(score * 100)}%)`)
      }
  }
  // brand + agency team: a Magnifier account named for a brand and an agency ("Home Depot- DDB", "JWT Inside - Home
  // Depot", "Merck - Publicis") joins the brand's account (Scott, 25 November 2026). Magnifier gives each agency team
  // its own account, with the agency's people, so neither domains nor whole names tie it to the brand. Only the brand
  // side links, never the agency's own account, so nothing chains through an agency.
  const byNameKey = new Map<string, string>()
  for (const a of accounts) {
    const k = words.get(a.key)!.join(' ')
    if (k && !byNameKey.has(k)) byNameKey.set(k, a.key)
  }
  // A team account belongs with its brand: its other ties (to the agency's other teams, by the agency's domain or
  // name) are dropped, or it would carry the brand into the agency ("Kimberly Clark - Mindshare" took Kimberly-Clark
  // into GroupM Mindshare). Ties to accounts that name the same brand stay.
  const brandOfTeam = new Map<string, string>()
  for (const b of accounts) {
    if (b.platform !== 'magnifier') continue
    const split = splitTeam(b.name)
    if (!split) continue
    const brand = nameWords(split.brand).join(' ')
    const a = byNameKey.get(brand)
    if (!a || a === b.key || brand.replace(/\s/g, '').length < 4 || NOT_A_BRAND.has(brand)) continue
    brandOfTeam.set(b.key, brand)
    add(a, b.key, 'team', `"${b.name}" is ${split.agency}'s team for ${byKey.get(a)!.name}`)
  }
  const namesBrand = (key: string, brand: string) => ` ${words.get(key)!.join(' ')} `.includes(` ${brand} `)
  const keep = (l: { a: string; b: string; kind?: LinkKind }) =>
    l.kind === 'team' || [l.a, l.b].every((k, i) => { const brand = brandOfTeam.get(k); return !brand || namesBrand(i ? l.a : l.b, brand) })
  return { links: out.filter(keep), ask: [...ask.values()].filter(keep) }
}

/** Places and words an agency's office or unit is named for, not a brand ("JWT-Chicago", "Leo Burnett - Chicago"). */
const NOT_A_BRAND = new Set(['chicago', 'new york', 'ny', 'nyc', 'los angeles', 'la', 'san francisco', 'sf', 'detroit', 'atlanta', 'dallas', 'boston', 'miami', 'seattle', 'minneapolis', 'st louis', 'philadelphia', 'toronto', 'london', 'new business', 'health', 'healthcare', 'creative', 'media', 'digital', 'research', 'corporate', 'national', 'hispanic', 'multicultural'])

/** A name made of a brand and one agency ("Home Depot- DDB", "JWT Inside - Home Depot"): the two parts; null otherwise. */
export function splitTeam(name: string): { brand: string; agency: string } | null {
  const parts = name.split(/\s*[-–/|@:]\s*|\s+at\s+|\s*\(\s*|\s*\)\s*/i).map((p) => p.trim()).filter(Boolean)
  if (parts.length < 2) return null
  const agency = parts.filter((p) => TEAM_AGENCY.test(p))
  const brand = parts.filter((p) => !TEAM_AGENCY.test(p) && !/^inactivated?$/i.test(p))
  if (agency.length !== 1 || brand.length !== 1) return null
  // "Horizon Media - New York NY AI" is the agency's office, not its team for a brand called New York.
  const key = nameWords(brand[0]!).join(' ')
  const plain = brand[0]!.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!key || NOT_A_BRAND.has(key) || [...NOT_A_BRAND].some((w) => plain === w || plain.startsWith(`${w} `))) return null
  return { brand: brand[0]!, agency: agency[0]! }
}

/** A name without its agency part, for naming a client ("Grey - Volvo" reads "Volvo"). */
export const withoutAgency = (name: string) => splitTeam(name)?.brand ?? name

/**
 * Agencies whose teams have their own Magnifier accounts, named with the brand they serve: the big media agencies
 * (AGENCY) and the creative and specialist ones seen in Magnifier's account names. A whole name part must be one.
 */
const TEAM_AGENCY = new RegExp(
  `^(?:${AGENCY.source.replace(/^\b\(|\)\b$/g, '')}|ddb|tribal ?ddb|spike ?ddb|chi ?ddb|jwt|jwt inside|wunderman|ogilvy|ogilvy (?:&|and) mather|bbdo|mccann|mccann-erickson|deutsch|tracy ?locke|grey|lowe|vml|cpb|crispin porter(?: \+ bogusky)?|fallon|arnold|hill holiday|mcgarry ?bowen|richards|the richards group|richards group|schawk|big red rooster|olson|uniworld(?: group)?|dieste|lopez negrete|leo burnett|saatchi(?: & saatchi)?|droga5|wieden(?: \\+ kennedy)?|w\\+k|goodby|tbwa(?:\\chiat\\day)?|bbh|72andsunny|anomaly|mullen|mullenlowe|gsd&m|the martin agency|martin agency|r\/ga|razorfish|sapient|isobar|edelman|draftfcb|fcb|y&r|young (?:&|and) rubicam|bromley|tg madison|northlich|source communications|david (?:&|and) goliath|mediavest|starcom mediavest|powerpact(?: llc)?|ecomm)$`,
  'i',
)

export interface Override {
  kind: 'merge' | 'split'
  member: string
  withMember: string | null
}

export interface Cluster {
  members: string[]
  how: Link[]
}

/**
 * The clients: accounts joined by links, the model's yeses, and people's merges;
 * with split accounts on their own (unless a person merged them since).
 */
export function cluster(keys: string[], auto: Link[], judgments: Map<string, { same: boolean; why: string | null }>, asked: Ask[], overrides: Override[]): Cluster[] {
  const known = new Set(keys)
  // The latest override for a member wins: a split after a merge undoes it, and the other way round.
  const last = new Map<string, Override>()
  for (const o of overrides) if (known.has(o.member)) last.set(o.member, o)
  const alone = new Set([...last.values()].filter((o) => o.kind === 'split').map((o) => o.member))

  const parent = new Map(keys.map((k) => [k, k]))
  const find = (k: string): string => {
    let r = k
    while (parent.get(r) !== r) r = parent.get(r)!
    let c = k
    while (parent.get(c) !== r) {
      const next = parent.get(c)!
      parent.set(c, r)
      c = next
    }
    return r
  }
  const used: Link[] = []
  const join = (l: Link) => {
    if (!known.has(l.a) || !known.has(l.b)) return
    used.push(l)
    const ra = find(l.a)
    const rb = find(l.b)
    if (ra !== rb) parent.set(ra, rb)
  }
  for (const l of auto) if (!alone.has(l.a) && !alone.has(l.b)) join(l)
  for (const q of asked) {
    const j = judgments.get(`${q.a}|${q.b}`)
    if (j?.same && !alone.has(q.a) && !alone.has(q.b)) join({ a: q.a, b: q.b, kind: 'model', why: j.why ? `Model: ${j.why}` : `Model: same client (${q.why})` })
  }
  for (const o of last.values()) if (o.kind === 'merge' && o.withMember) join({ a: o.member, b: o.withMember, kind: 'merge', why: 'Merged by hand' })

  const groups = new Map<string, string[]>()
  for (const k of keys) (groups.get(find(k)) ?? groups.set(find(k), []).get(find(k))!).push(k)
  const linkOf = new Map<string, Link[]>()
  for (const l of used) (linkOf.get(find(l.a)) ?? linkOf.set(find(l.a), []).get(find(l.a))!).push(l)
  return [...groups].map(([root, members]) => ({ members: members.sort(), how: linkOf.get(root) ?? [] }))
}

const OUR_DOMAINS = new Set(['mediaradar.com', 'vivvix.com', 'kantarmedia.com', 'kantar.com', 'competitrack.com', 'numerator.com', 'directheat.com'])
const INTERNAL_NAME = /\b(internal|demo|dev|devs|stage|staging|qa|sandbox|test account|do not use)\b/i

/** Our own accounts: a staff, demo or development name, or users who are mostly our own people. */
export function isInternal(a: Pick<MatchAccount, 'name' | 'domains'>): boolean {
  if (INTERNAL_NAME.test(a.name)) return true
  const total = Object.values(a.domains).reduce((s, n) => s + n, 0)
  if (!total) return false
  const ours = Object.entries(a.domains).filter(([d]) => OUR_DOMAINS.has(d)).reduce((s, [, n]) => s + n, 0)
  return total >= 3 && ours / total > 0.5
}

/** A client's name from an account's: the location and product tags platforms add taken off ("Horizon Media - New York NY AI" -> "Horizon Media"). */
export function displayName(name: string): string {
  let s = name.replace(/\s+/g, ' ').trim()
  for (let i = 0; i < 3; i++)
    s = s
      .replace(/\s*[-–]?\s*\b(AI|MB|MO|DH|PH|AI V2|V2|Trial|AI Trial)\s*$/i, '')
      .replace(/\s+-\s+[A-Z][A-Za-z .]+ [A-Z]{2}$/, '')
      .replace(/\s+(New York NY|NY|Chicago IL|Los Angeles CA)$/, '')
      .trim()
  return s || name
}

/**
 * A Canadian account (Scott, 24 November 2026: Canada is left out of the analysis by default). Its data decides
 * first: Magnifier's reports, or when it has none its saved searches, on Canadian data only; a 360 user set limited
 * to Canadian media. Data with the US in it means it is not. With nothing in the data either way, an account
 * named for Canada ("General Mills Canada", "Omnicom Canada MB") is Canadian too (Scott: "leave it out").
 */
export function isCanadian(e: Entitlements | null | undefined, name = ''): boolean {
  const named = /\bcanad(a|ian)\b/i.test(name)
  if (!e) return named
  if (e.kind === 'magnifier') {
    const cs = e.countries.length ? e.countries : (e.searchCountries ?? [])
    if (cs.length) return cs.every((c) => /canad/i.test(c))
    return named
  }
  if (e.kind === '360' && e.media && e.media.include.length && e.media.include.every((m) => /canad/i.test(m))) return true
  return named
}

const NAME_SKIP = new Set(['the', 'a', 'an'])

/**
 * A client's name. Usually its biggest account's (`named`). But when no account holds half the users and most
 * accounts start with the same word, that word: 53 of the 54 accounts under "Dallas Morning News-Dallas" were
 * Hearst's, and the Dallas paper's own was only the biggest of them (Scott, 24 November 2026).
 */
export function clientName(named: { name: string; users: number }, members: { name: string; users: number }[]): string {
  // A brand's agency team is named for the brand ("Grey - Volvo" reads "Volvo").
  const own = displayName(withoutAgency(named.name))
  // An agency's teams with the brands they serve: named for the agency (Scott, 25 November 2026: "the client name
  // should reflect the agency"). Two or more accounts named for one agency, among accounts that are not.
  // An agency's own accounts only: a brand's agency team ("Merck - Publicis") is the brand's.
  const agencyOf = (n: string) => (splitTeam(n) ? null : (AGENCY.exec(n)?.[0] ?? null))
  const agencies = new Map<string, { n: number; spell: string }>()
  for (const m of members) {
    const a = agencyOf(m.name)
    if (!a) continue
    const e = agencies.get(a.toLowerCase()) ?? agencies.set(a.toLowerCase(), { n: 0, spell: a }).get(a.toLowerCase())!
    e.n++
  }
  const lead = [...agencies.values()].sort((a, b) => b.n - a.n)[0]
  if (lead && lead.n >= 2 && members.some((m) => !agencyOf(m.name)) && !agencyOf(own))
    return lead.spell.length <= 4 ? lead.spell.toUpperCase() : lead.spell.replace(/\b\w/g, (c) => c.toUpperCase())
  const total = members.reduce((n, m) => n + m.users, 0)
  if (members.length < 3 || named.users * 2 >= total) return own
  const words = (name: string) => {
    // Words split at spaces and spaced separators only: "T-Mobile" and "M&T" stay whole.
    const w = displayName(name).replace(/\([^)]*\)/g, ' ').split(/\s+[-–/:|]\s+|,\s*|\s+/).filter((x) => x && !/^[-–/:|]+$/.test(x))
    while (w.length && NAME_SKIP.has(w[0]!.toLowerCase())) w.shift()
    return w
  }
  const lists = members.map((m) => words(withoutAgency(m.name)))
  // The longest run of leading words more than half the accounts share: "Weight Watchers", not "Weight". A word is
  // added only while nearly all who share the shorter name share it too: Hearst's papers are not "Hearst TV".
  let best: string[] | null = null
  let shared = 0
  for (let k = 1; k <= 4; k++) {
    const count = new Map<string, { n: number; spell: Map<string, number> }>()
    for (const w of lists) {
      if (w.length < k) continue
      const spelt = w.slice(0, k).join(' ')
      const c = count.get(spelt.toLowerCase()) ?? count.set(spelt.toLowerCase(), { n: 0, spell: new Map() }).get(spelt.toLowerCase())!
      c.n++
      c.spell.set(spelt, (c.spell.get(spelt) ?? 0) + 1)
    }
    const top = [...count.values()].sort((a, b) => b.n - a.n)[0]
    if (!top || top.n * 2 <= members.length || (shared && top.n < shared * 0.8)) break
    best = [...top.spell].sort((a, b) => b[1] - a[1])[0]![0].split(' ')
    shared = top.n
  }
  const flat = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (!best || flat(best.join('')).length < 3) return own
  // No change worth making when one name begins the other ("Lamar", "Lamar Advertising"; "Yahoo", "Yahoo!").
  const mine = flat(words(withoutAgency(named.name)).join(''))
  if (mine.startsWith(flat(best.join(''))) || flat(best.join('')).startsWith(mine)) return own
  return best.join(' ')
}

/** A stable id for a client: its first member, which changes only if that account leaves it. */
export const clientIdOf = (members: string[]) => [...members].sort()[0]!
