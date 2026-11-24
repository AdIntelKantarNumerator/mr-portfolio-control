/**
 * Build one client's Migration Plan (Scott, 23 November 2026).
 *
 * What a client becomes in Insights Studio: an organization with one or more
 * client accounts (the model proposes the split for agencies whose user sets
 * follow different brands), each with its packages, contract and coverage; the
 * users to create; the workspaces each user needs; and what changes for them.
 *
 * Rules Scott set:
 *   - one organization per client; sub-accounts where user sets serve different brands or purposes;
 *   - coverage: every medium except premium ones (Live Streaming Sports, National Newspapers), which
 *     only clients who have them today keep; no country beyond the US unless they have it today;
 *   - users: active, with a login in the last 12 months (Magnifier's logins start in September 2026,
 *     so its active users count as recent);
 *   - legacy ids become Insights Studio ids the way Taxonomy Comparison follows them (dbxFlows).
 *
 * The facts come from the snapshot (ce_*) and live 360 reads. The model only
 * groups accounts and reviews the finished plan; without it the plan is still
 * built, one account per type, and says the review did not run.
 */
import { createHash } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { ceAccounts, ceClients, ceUsers } from '@/db/schema'
import { chunks, q360 } from '@/lib/import360/source'
import { completeJson } from '@/lib/llm'
import { dbxCategoryFlows, dbxFlows, dbxGpcNameMatches, dbxTaxonomyTree, type FlowRaw } from '@/lib/taxonomy-dbx'
import type { Candidate } from '@/lib/taxonomy-rules'
import { ADV_360, candidatesMagnifier, names360, plainTerms, type Candidates } from '../deck-data'
import { currentMedia, mediaChange, type MediaChange } from '../media-map'
import { ratingsRunsBySet } from '../ratings-usage'
import { clientPeople, type PersonRow } from '../store'
import { parseMember, PLATFORM_LABEL, PLATFORMS, type Ent360, type EntClassic, type EntMagnifier, type Entitlements, type Platform } from '../types'
import { readMatches, saveMatches } from './matches'
import { ACCOUNT_TYPE_LABEL, COUNTRIES, ENTITY_TYPE, MEDIA, packageByKey, PREMIUM_MEDIA, SET_LABEL, type AccountType, type CountryCode, type SetKey } from './catalog'
import { PLAN_VERSION, type MigrationPlan, type PlanAccount, type PlanUser, type PlanWorkspace, type PlanWorkspaceItem } from './types'

export type PlanProgress = (step: string) => Promise<void> | void

const RECENT_MONTHS = 12
const MAX_ITEMS = 200
const MAP_ADVERTISERS = 2000
const MAP_CATEGORIES = 100
/** dbxFlows takes this many at a time: one statement stays a reasonable size. */
const FOLLOW_BATCH = 250
/**
 * Categories a statement: a category's flows are every product in it, far more rows than an advertiser's,
 * and 300 at once ran the server (1.75 GB) out of memory (24 November 2026).
 */
const CATEGORY_BATCH = 10
const MODEL_ACCOUNTS = 80

const monthsAgo = (n: number, now = new Date()) => {
  const d = new Date(now)
  d.setUTCMonth(d.getUTCMonth() - n)
  return d.toISOString().slice(0, 10)
}

// ------------------------------------------------------------------ the client's legacy accounts

interface Legacy {
  key: string
  platform: Platform
  id: string
  name: string
  active: boolean
  activeUsers: number
  summary: string
  ent: Entitlements
  type: AccountType
  typeWhy: string
}

function typeOf(platform: Platform, ent: Entitlements): { type: AccountType; why: string } {
  if (ent.kind === '360') {
    if (/media owner/i.test(ent.application)) return { type: 'publisher', why: `360 ${ent.application}` }
    return { type: 'brand_agency', why: `360 ${ent.application}` }
  }
  if (ent.kind === 'classic') return /sell/i.test(ent.side ?? '') ? { type: 'publisher', why: 'Classic sell side' } : { type: 'brand_agency', why: `Classic ${ent.side ?? 'buy side'}` }
  return { type: 'brand_agency', why: 'Magnifier is a buy-side product' }
}

async function legacyAccounts(d: Database, members: string[]): Promise<Legacy[]> {
  const out: Legacy[] = []
  for (const p of PLATFORMS) {
    const ids = members.map(parseMember).filter((m) => m?.platform === p).map((m) => m!.accountId)
    if (!ids.length) continue
    for (const part of chunks(ids, 500))
      for (const a of await d.select().from(ceAccounts).where(and(eq(ceAccounts.platform, p), inArray(ceAccounts.accountId, part)))) {
        const ent = a.entitlements as Entitlements
        const t = typeOf(p, ent)
        out.push({ key: `${p}:${a.accountId}`, platform: p, id: a.accountId, name: a.name, active: a.active, activeUsers: a.activeUsers, summary: a.summary ?? '', ent, type: t.type, typeWhy: t.why })
      }
  }
  return out.sort((x, y) => y.activeUsers - x.activeUsers || x.name.localeCompare(y.name))
}

/** What the plan is built from, as a hash: a refresh that changes any of it marks the plan out of date. */
export async function inputsHash(d: Database, clientId: string): Promise<string | null> {
  const [c] = await d.select({ members: ceClients.members, name: ceClients.name }).from(ceClients).where(eq(ceClients.clientId, clientId)).limit(1)
  if (!c) return null
  const members = [...(c.members as string[])].sort()
  const h = createHash('sha1').update(`v${PLAN_VERSION}|${c.name}|${members.join(',')}`)
  const cutoff = monthsAgo(RECENT_MONTHS)
  for (const p of PLATFORMS) {
    const ids = members.map(parseMember).filter((m) => m?.platform === p).map((m) => m!.accountId)
    if (!ids.length) continue
    for (const part of chunks(ids, 500)) {
      for (const a of await d.select({ id: ceAccounts.accountId, active: ceAccounts.active, ent: ceAccounts.entitlements }).from(ceAccounts).where(and(eq(ceAccounts.platform, p), inArray(ceAccounts.accountId, part))).orderBy(ceAccounts.accountId))
        h.update(`|${p}:${a.id}:${a.active}:${JSON.stringify(a.ent)}`)
      for (const u of await d.select({ id: ceUsers.userId, active: ceUsers.active, seen: ceUsers.lastSeen }).from(ceUsers).where(and(eq(ceUsers.platform, p), inArray(ceUsers.accountId, part))).orderBy(ceUsers.userId))
        h.update(`|${u.id}:${u.active}:${(u.seen ?? '') >= cutoff}`)
    }
  }
  return h.digest('hex')
}

// ------------------------------------------------------------------ accounts: the split

interface Group {
  name: string
  type: AccountType
  members: Legacy[]
  why: string
}

function parseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as T
  } catch {
    return null
  }
}

function describe(a: Legacy): string {
  const ent = a.ent
  const parts = [`${a.key}`, `"${a.name}"`, PLATFORM_LABEL[a.platform], ACCOUNT_TYPE_LABEL[a.type], `${a.activeUsers} active users`]
  if (ent.kind === '360') {
    parts.push(ent.application)
    for (const f of ent.filters.filter((x) => !/submedia|media|time|data tables/i.test(x.type)).slice(0, 4)) parts.push(`${f.type}: ${f.include.slice(0, 5).join('; ')}${f.count > 5 ? ` +${f.count - 5}` : ''}`)
  } else if (ent.kind === 'magnifier') {
    for (const x of ent.access.slice(0, 4)) parts.push(`${x.label}: ${x.items.slice(0, 5).join('; ')}${x.total > 5 ? ` +${x.total - 5}` : ''}`)
  } else if (a.summary) parts.push(a.summary.slice(0, 160))
  return parts.join(' | ')
}

/** One account per type, or the model's split where a type has several legacy accounts. */
async function groupAccounts(client: string, legacy: Legacy[], useModel: boolean, progress: PlanProgress): Promise<{ groups: Group[]; org: { name: string; why: string }; model: string | null }> {
  const live = legacy.filter((a) => a.active)
  const pool = live.length ? live : legacy
  const types = [...new Set(pool.map((a) => a.type))]
  const label = (t: AccountType) => (types.length > 1 ? `${client} (${ACCOUNT_TYPE_LABEL[t]})` : client)
  const fallback = (): Group[] =>
    types.map((t) => {
      const members = pool.filter((a) => a.type === t)
      return { name: label(t), type: t, members, why: members.length > 1 ? `All ${members.length} ${ACCOUNT_TYPE_LABEL[t]} accounts together.` : `Replaces ${members[0]!.name}.` }
    })
  const org = { name: client, why: 'One organization per client, as Client Evaluation groups its accounts across 360, Classic and Magnifier.' }
  if (!useModel || !types.some((t) => pool.filter((a) => a.type === t).length > 1)) return { groups: fallback(), org, model: null }

  await progress('Proposing the account split (model)')
  const shown = pool.slice(0, MODEL_ACCOUNTS)
  try {
    const { text, model } = await completeJson(
      `You plan how a MediaRadar client moves from its legacy products (360, Classic, Magnifier) to Insights Studio.
Insights Studio has an organization (like 360's license group) holding client accounts (like 360's user sets). Each client account has one type, Publisher or Brand/Agency, and its own entitlements; every user of an account sees the same data.
Group the legacy accounts below into Insights Studio client accounts:
- Never mix types in one account.
- Keep accounts together when they serve the same team or purpose (the same brand on 360 and Magnifier, a team's several user sets with the same access).
- Split when user sets clearly serve different brands, clients or business units with different restrictions (common for agencies: one user set per client brand). Each becomes its own client account.
- Prefer fewer accounts when unsure. Tiny or test-looking accounts join the main one.
- Name each account plainly (the brand, team or business unit), never with ids.
Reply with JSON only: {"organization":"name","organizationWhy":"one sentence","accounts":[{"name":"...","type":"publisher"|"brand_agency","members":["platform:id",...],"why":"one sentence"}]}`,
      `Client: ${client}\nLegacy accounts (key | name | platform | type | users | access):\n${shown.map(describe).join('\n')}${pool.length > shown.length ? `\n(${pool.length - shown.length} smaller accounts not listed; they join the largest account of their type.)` : ''}`,
      { maxTokens: 2500 },
    )
    const json = parseJson<{ organization?: string; organizationWhy?: string; accounts?: Array<{ name?: string; type?: string; members?: unknown; why?: string }> }>(text)
    if (!json?.accounts?.length) throw new Error('no accounts in the answer')
    const byKey = new Map(pool.map((a) => [a.key, a]))
    const used = new Set<string>()
    const groups: Group[] = []
    for (const g of json.accounts.slice(0, 25)) {
      const members = (Array.isArray(g.members) ? g.members : [])
        .map((k) => byKey.get(String(k)))
        .filter((a): a is Legacy => !!a && !used.has(a.key))
      if (!members.length) continue
      // One type per account: the members' own, whatever the model wrote.
      const t = members[0]!.type
      const same = members.filter((a) => a.type === t)
      for (const a of same) used.add(a.key)
      groups.push({ name: String(g.name ?? '').trim().slice(0, 120) || label(t), type: t, members: same, why: plainTerms(String(g.why ?? '').trim()).slice(0, 400) || 'Proposed by the model.' })
    }
    // Anything the model left out joins the largest account of its type, or starts one.
    for (const a of pool) {
      if (used.has(a.key)) continue
      const g = groups.filter((x) => x.type === a.type).sort((x, y) => y.members.length - x.members.length)[0]
      if (g) g.members.push(a)
      else groups.push({ name: label(a.type), type: a.type, members: [a], why: `Replaces ${a.name}.` })
      used.add(a.key)
    }
    return {
      groups,
      org: { name: String(json.organization ?? '').trim().slice(0, 120) || client, why: plainTerms(String(json.organizationWhy ?? '').trim()).slice(0, 400) || org.why },
      model,
    }
  } catch (err) {
    console.error('[migration] account split', err)
    return { groups: fallback(), org, model: null }
  }
}

// ------------------------------------------------------------------ an account's entitlements

const PRELIM = /preliminary/i

function legacyMedia(members: Legacy[]): Map<Platform, { media: Set<string>; restricted: boolean }> {
  const out = new Map<Platform, { media: Set<string>; restricted: boolean }>()
  for (const a of members) {
    const m = currentMedia(a.platform, a.ent as Ent360 | EntClassic | EntMagnifier)
    const x = out.get(a.platform) ?? out.set(a.platform, { media: new Set(), restricted: true }).get(a.platform)!
    for (const n of m.media) x.media.add(n)
    if (!m.restricted) x.restricted = false
  }
  return out
}

function features(members: Legacy[]): string[] {
  const out = new Set<string>()
  for (const a of members) {
    const e = a.ent
    for (const f of e.kind === 'magnifier' ? e.flags : e.features) out.add(f)
  }
  return [...out]
}

function accountPlan(g: Group, i: number, ratings: Map<number, { nielsen: number; videoamp: number }> | null): PlanAccount {
  const feats = features(g.members)
  const has = (re: RegExp) => feats.find((f) => re.test(f))
  const packages: PlanAccount['packages'] = []
  const add = (key: string, why: string) => {
    const p = packageByKey.get(key)!
    if (!packages.some((x) => x.key === key)) packages.push({ key, name: p.name, kind: p.kind, why })
  }
  add('competitive', 'The base package: spend, units, impressions and creative for every account.')
  const contactFeat = has(/contact|sales opportunit|agency module/i)
  if (g.type === 'publisher') add('commercial', 'Publisher account: sales opportunities, contacts and agency data are what sellers use.')
  else if (contactFeat) add('commercial', `Uses ${contactFeat} today.`)
  const creativeFeat = has(/creative analytics|creative attribute|creative id reporting|creative light/i)
  if (creativeFeat) add('creative', `Uses ${creativeFeat} today.`)
  const sports = has(/sports module/i)
  if (sports) add('sports', `Uses the ${sports} today.`)
  const sponsor = has(/sponsorship/i)
  if (sponsor) add('sponsorship', `Uses the ${sponsor} today.`)
  if (ratings) {
    let n = 0
    let v = 0
    for (const a of g.members) if (a.platform === '360') {
      const r = ratings.get(Number(a.id))
      if (r) {
        n += r.nielsen
        v += r.videoamp
      }
    }
    if (n + v > 0) add('ratings_us_linear_tv', `${n + v} report runs with TV ratings since October 2026 (${[n ? `${n} Nielsen` : '', v ? `${v} VideoAmp` : ''].filter(Boolean).join(', ')}).`)
  }
  const concierge = has(/concierge/i)
  if (concierge) add('custom_concierge_requests', `Has ${concierge} today.`)

  // Contract.
  const years = g.members.map((a) => (a.ent.kind === '360' ? a.ent.years : null)).filter((y): y is number => typeof y === 'number' && y > 0)
  const lookback = years.length ? { value: Math.max(...years), why: `The most history any of its 360 user sets has today (${Math.max(...years)} years).` } : { value: 3, why: 'No history setting today; 3 complete years plus the current year is the standard.' }
  const prelim = has(PRELIM)
  const includePreliminary = prelim ? { value: true, why: `Has ${prelim} today.` } : { value: false, why: 'No preliminary data today.' }

  // Coverage: every medium except premium ones they lack; no country beyond the US unless they have it.
  const legacy = legacyMedia(g.members)
  const keptNames = new Set<string>()
  let lss = false
  for (const [p, m] of legacy) {
    const ch = mediaChange(p, [...m.media], m.restricted)
    for (const k of ch.kept) keptNames.add(k)
    if (ch.kept.includes('Live Streaming Sports')) lss = true
  }
  const premiumHeld = new Set<number>(lss ? [502] : [])
  const media: PlanAccount['coverage']['media'] = []
  const withheld: PlanAccount['coverage']['withheld'] = []
  for (const m of MEDIA.filter((x) => x.active)) {
    if (PREMIUM_MEDIA.has(m.id) && !premiumHeld.has(m.id)) {
      withheld.push({ name: m.name, why: 'Premium: only clients who have it today keep it.' })
      continue
    }
    media.push({ id: m.id, name: m.name, type: m.type, status: PREMIUM_MEDIA.has(m.id) ? 'premium' : keptNames.has(m.name) ? 'kept' : 'added' })
  }
  const countries: PlanAccount['coverage']['countries'] = [{ code: 'US', name: COUNTRIES.US, why: 'Every client has US data.' }]
  const canada =
    g.members.some((a) => a.ent.kind === 'magnifier' && a.ent.countries.some((c) => /canada/i.test(c))) ||
    g.members.some((a) => a.ent.kind === '360' && !!a.ent.media && a.ent.media.include.some((m) => /canadian/i.test(m)))
  if (canada) countries.push({ code: 'CA' as CountryCode, name: COUNTRIES.CA, why: 'Has Canadian data today.' })

  const widened: string[] = []
  for (const a of g.members) {
    const e = a.ent
    if (e.kind === '360')
      for (const f of e.filters.filter((x) => !/submedia|^media|time|data tables/i.test(x.type) && x.include.length))
        widened.push(`${a.name} (360): ${f.type} limited to ${f.include.slice(0, 3).join(', ')}${f.count > 3 ? ` and ${f.count - 3} more` : ''}`)
    if (e.kind === 'magnifier')
      for (const x of e.access.filter((y) => !/countr|flag/i.test(y.label)))
        widened.push(`${a.name} (Magnifier): ${x.label} limited to ${x.items.slice(0, 3).join(', ')}${x.total > 3 ? ` and ${x.total - 3} more` : ''}`)
  }

  return {
    key: `A${i + 1}`,
    name: g.name,
    type: { value: g.type, why: [...new Set(g.members.map((a) => a.typeWhy))].join('; ') },
    from: g.members.map((a) => ({ key: a.key, platform: a.platform, name: a.name, activeUsers: a.activeUsers })),
    why: g.why,
    contract: { lookbackYears: lookback, includePreliminary },
    packages,
    coverage: { media, withheld, countries, widened: widened.slice(0, 40) },
    seats: 0,
  }
}

// ------------------------------------------------------------------ users

function usersPlan(people: PersonRow[], accounts: PlanAccount[], now: Date): PlanUser[] {
  const cutoff = monthsAgo(RECENT_MONTHS, now)
  const accountOf = new Map<string, string>()
  for (const a of accounts) for (const f of a.from) accountOf.set(f.key, a.key)
  const out: PlanUser[] = []
  for (const p of people) {
    const live = p.accounts.filter((a) => a.active)
    const best = [...(live.length ? live : p.accounts)].sort((x, y) => (y.lastSeen ?? '').localeCompare(x.lastSeen ?? ''))[0]
    const account = best ? (accountOf.get(`${best.platform}:${best.accountId}`) ?? null) : null
    const magnifier = live.some((a) => a.platform === 'magnifier')
    let create: PlanUser['create']
    if (!p.active) create = { value: false, why: 'Inactive in every application.' }
    else if (p.lastSeen && p.lastSeen >= cutoff) create = { value: true, why: `Active; last login ${p.lastSeen}.` }
    else if (magnifier) create = { value: true, why: "Active in Magnifier, whose login record starts in September 2026, so a missing login is not held against them." }
    else if (p.lastSeen) create = { value: false, why: `No login since ${p.lastSeen}: not created unless confirmed.` }
    else create = { value: false, why: 'No login on record: not created unless confirmed.' }
    if (create.value && !account) create = { value: false, why: 'Their accounts are not part of the plan.' }
    out.push({
      key: p.key,
      name: p.name,
      email: p.email,
      account,
      role: { value: 'analyst', why: 'The default role; legacy admin rights are not carried over yet.' },
      create,
      lastSeen: p.lastSeen,
      logins: p.accounts.map((a) => ({ platform: a.platform, account: a.accountName, login: a.login, lastSeen: a.lastSeen, active: a.active })),
    })
  }
  return out.sort((x, y) => Number(y.create.value) - Number(x.create.value) || (y.lastSeen ?? '').localeCompare(x.lastSeen ?? '') || x.name.localeCompare(y.name))
}

// ------------------------------------------------------------------ workspaces

const PROFILE_SET: Record<number, { set: SetKey; list: string }> = {
  1: { set: 'advertisers', list: 'My Brands' },
  2: { set: 'advertisers', list: 'My Competitive Brands' },
  3: { set: 'advertisers', list: 'My Accounts' },
  4: { set: 'advertisers', list: 'My Prospects' },
  5: { set: 'properties', list: 'My Properties' },
  6: { set: 'competitiveProperties', list: 'My Competitive Properties' },
  7: { set: 'categories', list: 'My Categories' },
  8: { set: 'markets', list: 'My Markets' },
}
const ALLOWED: Record<SetKey, number[]> = {
  advertisers: [100, 101, 102, 118, 139],
  properties: [373, 476, 477, 478],
  competitiveProperties: [373, 476, 477, 478],
  categories: [103, 104, 105, 107, 135],
  markets: [500],
}
const setFor = (e: number): SetKey | null => (ALLOWED.advertisers.includes(e) ? 'advertisers' : ALLOWED.categories.includes(e) ? 'categories' : e === 500 ? 'markets' : ALLOWED.properties.includes(e) ? 'properties' : null)

interface RawItem {
  set: SetKey
  e: number
  id: number
  list: string
}

/** Each 360 user's default reporting profile lists. */
async function profileItems(usrIds: number[]): Promise<Map<number, RawItem[]>> {
  const out = new Map<number, RawItem[]>()
  for (const part of chunks(usrIds, 500)) {
    if (!part.length) continue
    for (const r of await q360<{ usr_id: number; t: number; e: number; id: number }>(
      `SELECT d.usr_id, s.entity_set_type_id AS t, i.entity_type_id AS e, i.entity_id AS id
       FROM iddb_appl.dbo.user_default_reporting_profile d
       JOIN iddb_appl.dbo.entity_set s ON s.reporting_profile_id = d.reporting_profile_id AND s.active_f = 1
       JOIN iddb_appl.dbo.entity_item i ON i.entity_set_id = s.entity_set_id
       WHERE d.usr_id IN (${part.join(',')}) AND i.entity_id > 0 AND s.entity_set_type_id IN (1,2,3,4,5,6,7,8)
       ORDER BY d.usr_id, s.entity_set_type_id, i.order_id`,
    )) {
      const s = PROFILE_SET[Number(r.t)]
      if (!s || !ALLOWED[s.set].includes(Number(r.e))) continue
      ;(out.get(Number(r.usr_id)) ?? out.set(Number(r.usr_id), []).get(Number(r.usr_id))!).push({ set: s.set, e: Number(r.e), id: Number(r.id), list: s.list })
    }
  }
  return out
}

/** Each 360 user set's own restrictions (FILTER), the ones that become a shared workspace. */
async function filterItems(usrsets: number[]): Promise<Map<number, RawItem[]>> {
  const out = new Map<number, RawItem[]>()
  for (const part of chunks(usrsets, 500)) {
    if (!part.length) continue
    for (const r of await q360<{ s: number; e: number; id: number }>(
      `SELECT fs.usrset_id AS s, f.entmaj_id AS e, f.master_id AS id FROM iddb_ar.dbo.FILTER f JOIN iddb_ar.dbo.FILTERSET fs ON fs.filterset_id = f.filterset_id
       WHERE fs.active_f = 1 AND f.include_f = 1 AND fs.usrset_id IN (${part.join(',')}) AND f.entmaj_id IN (100,101,102,118,139,103,104,105,107,135,373,476,477,478,500)`,
    )) {
      const set = setFor(Number(r.e))
      if (!set) continue
      ;(out.get(Number(r.s)) ?? out.set(Number(r.s), []).get(Number(r.s))!).push({ set, e: Number(r.e), id: Number(r.id), list: 'Access today' })
    }
  }
  return out
}

const ADV_ID = (e: number, id: number) => ADV_360[e]?.(id) ?? null
const CAT_ID = (e: number, id: number) => ([103, 104, 135].includes(e) ? `C${id}` : null)

interface Matcher {
  adv: Map<string, { id: string; name: string; parent: boolean }>
  cat: Map<string, { id: string; name: string; e: number }>
  /** Magnifier names (lowercased) to GPC. */
  magnifier: Map<string, { id: string; name: string }>
}

const LEVEL_E: Array<[RegExp, number]> = [
  [/sub/i, 135],
  [/group/i, 107],
  [/industry/i, 105],
  [/categ/i, 103],
]

function topBy<T>(rows: T[], key: (r: T) => string | null, spend: (r: T) => number): string | null {
  const t = new Map<string, number>()
  for (const r of rows) {
    const k = key(r)
    if (k) t.set(k, (t.get(k) ?? 0) + spend(r))
  }
  return [...t].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}

/** Follow the legacy advertisers and categories into Insights Studio, as Taxonomy Comparison does. */
async function buildMatcher(d: Database, advIds: string[], catIds: string[], magnifierAccounts: string[], progress: PlanProgress): Promise<{ m: Matcher; magnifierFocus: Candidates | null; notes: string[] }> {
  const m: Matcher = { adv: new Map(), cat: new Map(), magnifier: new Map() }
  const notes: string[] = []
  const fromFlows = (flows: Map<string, FlowRaw[]>, into: Map<string, { id: string; name: string; parent: boolean }>) => {
    for (const [id, fl] of flows) {
      const top = topBy(fl, (f) => f.gpcId, (f) => f.spend)
      if (!top) continue
      const f = fl.find((x) => x.gpcId === top)!
      into.set(id, { id: top, name: f.gpcName ?? top, parent: f.gpcParentId === top })
    }
  }
  // Matches other plans already found are reused; only the rest are followed, and what that finds is kept.
  const knownAdv = await readMatches<{ id: string; name: string; parent: boolean }>(d, 'adv', advIds)
  for (const [id, g] of knownAdv) if (g) m.adv.set(id, g)
  const followAdv = advIds.filter((id) => !knownAdv.has(id))
  if (followAdv.length) {
    await progress(`Following ${followAdv.length} advertisers into Insights Studio (${knownAdv.size} already known)`)
    try {
      for (let i = 0; i < followAdv.length; i += FOLLOW_BATCH) {
        if (i) await progress(`Following advertisers into Insights Studio (${i} of ${followAdv.length})`)
        const part = followAdv.slice(i, i + FOLLOW_BATCH)
        fromFlows(await within(6 * 60_000, 'Following advertisers', () => dbxFlows('VX1', part, new Map(), undefined, { large: true })), m.adv)
        await saveMatches(d, 'adv', part.map((id) => [id, m.adv.get(id) ?? null]))
      }
    } catch (err) {
      notes.push(`360 advertisers could not be followed into Insights Studio: ${(err as Error).message}`.slice(0, 200))
    }
  }
  const knownCat = await readMatches<{ id: string; name: string; e: number }>(d, 'cat', catIds)
  for (const [id, g] of knownCat) if (g) m.cat.set(id, g)
  catIds = catIds.filter((id) => !knownCat.has(id))
  if (catIds.length) {
    await progress(`Following ${catIds.length} categories into Insights Studio (${knownCat.size} already known)`)
    try {
      const tree = await within(4 * 60_000, 'Reading the taxonomy', () => dbxTaxonomyTree())
      const byName = new Map<string, { id: string; e: number }>()
      for (const n of tree) {
        const e = LEVEL_E.find(([re]) => re.test(n.level))?.[1]
        if (e && !byName.has(`${e}|${n.name.toLowerCase()}`)) byName.set(`${e}|${n.name.toLowerCase()}`, { id: n.id, e })
      }
      // A few at a time, each batch reduced to its answer before the next is read: the rows are many.
      for (let i = 0; i < catIds.length; i += CATEGORY_BATCH) {
        if (i) await progress(`Following categories into Insights Studio (${i} of ${catIds.length})`)
        const part = catIds.slice(i, i + CATEGORY_BATCH)
        const flows = await within(6 * 60_000, 'Following categories', () => dbxCategoryFlows('VX1', part))
        for (const [id, fl] of flows) {
          const sub = topBy(fl, (f) => f.subcategory, (f) => f.spend)
          const cat = topBy(fl, (f) => f.category, (f) => f.spend)
          const hit = (sub && byName.get(`135|${sub.toLowerCase()}`)) || (cat && byName.get(`103|${cat.toLowerCase()}`))
          if (hit) m.cat.set(id, { id: hit.id, name: (hit.e === 135 ? sub : cat)!, e: hit.e })
        }
        flows.clear()
        await saveMatches(d, 'cat', part.map((id) => [id, m.cat.get(id) ?? null]))
      }
    } catch (err) {
      notes.push(`360 categories could not be followed into Insights Studio: ${(err as Error).message}`.slice(0, 200))
    }
  }
  let magnifierFocus: Candidates | null = null
  if (magnifierAccounts.length) {
    await progress("Following Magnifier's advertisers into Insights Studio")
    try {
      const c = await within(3 * 60_000, "Reading Magnifier's report criteria", () => candidatesMagnifier(magnifierAccounts))
      if (c.c?.kind === 'advertiser' && c.c.items.length) {
        magnifierFocus = c.c
        const ids = c.c.items.map((i) => i.id)
        const into = new Map<string, { id: string; name: string; parent: boolean }>()
        const known = await readMatches<{ id: string; name: string; parent: boolean }>(d, 'mag', ids)
        for (const [id, g] of known) if (g) into.set(id, g)
        const follow = ids.filter((id) => !known.has(id))
        if (follow.length) {
          fromFlows(await within(6 * 60_000, 'Following Magnifier advertisers', () => dbxFlows('VX2', follow, new Map(), undefined, { large: true })), into)
          await saveMatches(d, 'mag', follow.map((id) => [id, into.get(id) ?? null]))
        }
        for (const i of c.c.items) {
          const g = into.get(i.id)
          if (g) m.magnifier.set(i.name.toLowerCase(), { id: g.id, name: g.name })
        }
      }
    } catch (err) {
      notes.push(`Magnifier advertisers could not be followed into Insights Studio: ${(err as Error).message}`.slice(0, 200))
    }
  }
  return { m, magnifierFocus, notes }
}

function item360(r: RawItem, names: Map<string, string>, m: Matcher | null, list: string): PlanWorkspaceItem {
  const name = names.get(`${r.e}:${r.id}`) ?? `#${r.id}`
  let gpc: PlanWorkspaceItem['gpc'] = null
  let e = r.e
  const adv = ADV_ID(r.e, r.id)
  const cat = CAT_ID(r.e, r.id)
  if (m && adv && m.adv.get(adv)) {
    const g = m.adv.get(adv)!
    gpc = { id: g.id, name: g.name, how: 'Followed by its ads (Taxonomy Comparison)' }
    e = g.parent ? 102 : r.e === 102 ? 102 : 139
  } else if (r.e === 373) {
    // Properties carry the same id in Insights Studio as in 360 (Scott, 23 November 2026).
    gpc = { id: String(r.id), name, how: 'Same property id in Insights Studio' }
  } else if (m && cat && m.cat.get(cat)) {
    const g = m.cat.get(cat)!
    gpc = { id: g.id, name: g.name, how: 'Followed by its ads (Taxonomy Comparison)' }
    e = g.e
  }
  return { entityType: e, name, legacy: { platform: '360', list, id: String(r.id) }, gpc }
}

function signature(sets: PlanWorkspace['sets']): string {
  return JSON.stringify(sets.map((s) => [s.set, s.items.map((i) => `${i.legacy.platform}:${i.entityType}:${i.legacy.id}`).sort()]).sort())
}

function setsOf(items: PlanWorkspaceItem[], setOf: (i: PlanWorkspaceItem) => SetKey): PlanWorkspace['sets'] {
  const by = new Map<SetKey, PlanWorkspaceItem[]>()
  for (const i of items) {
    const s = setOf(i)
    const list = by.get(s) ?? by.set(s, []).get(s)!
    if (!list.some((x) => x.entityType === i.entityType && x.legacy.id === i.legacy.id)) list.push(i)
  }
  return (Object.keys(SET_LABEL) as SetKey[]).filter((k) => by.get(k)?.length).map((k) => ({ set: k, items: by.get(k)!.slice(0, MAX_ITEMS), more: Math.max(0, by.get(k)!.length - MAX_ITEMS) }))
}

function wsName(sets: PlanWorkspace['sets'], fallback: string): string {
  const first = sets.find((s) => s.set === 'advertisers') ?? sets[0]
  if (!first) return fallback
  const names = first.items.slice(0, 2).map((i) => i.gpc?.name ?? i.name)
  const rest = first.items.length + first.more - names.length
  return `${names.join(', ')}${rest > 0 ? ` +${rest}` : ''}`.slice(0, 80)
}

const NAME_BATCH = 40
const NAME_MAX = 600

/**
 * Advertisers Taxonomy Comparison could not follow (no recent spend): Insights Studio entities with a similar
 * name are found as Taxonomy Comparison searches them, and the model picks the one that is the same company
 * or brand, or none. Every match made this way is marked as a best guess (Scott, 23 November 2026).
 */
interface NameGuess {
  id: string
  name: string
  level: string
  confidence: 'high' | 'medium'
}

async function nameMatch(d: Database, workspaces: PlanWorkspace[], progress: PlanProgress): Promise<{ guessed: number }> {
  const want = new Map<string, PlanWorkspaceItem[]>()
  for (const w of workspaces)
    for (const s of w.sets)
      if (s.set === 'advertisers')
        for (const i of s.items) if (!i.gpc && i.name && !i.name.startsWith('#')) (want.get(i.name) ?? want.set(i.name, []).get(i.name)!).push(i)
  let guessed = 0
  const apply = (name: string, g: NameGuess) => {
    for (const item of want.get(name) ?? []) {
      item.gpc = { id: g.id, name: g.name, how: `Best guess by name (model, ${g.confidence} confidence)`, guess: true }
      item.entityType = g.level === 'Parent' ? 102 : 139
      guessed++
    }
  }
  // Names another plan already had judged: reused, whatever the answer was.
  const keyOf = (n: string) => n.trim().toLowerCase()
  const known = await readMatches<NameGuess>(d, 'name', [...want.keys()].map(keyOf))
  for (const n of want.keys()) {
    const g = known.get(keyOf(n))
    if (g) apply(n, g)
  }
  const names = [...want.keys()].filter((n) => !known.has(keyOf(n))).slice(0, NAME_MAX)
  if (!names.length) return { guessed }
  await progress(`Finding ${names.length} advertisers by name in Insights Studio`)
  const cands = new Map<string, Candidate[]>()
  for (let i = 0; i < names.length; i += 400) for (const [k, v] of await within(4 * 60_000, 'Finding advertisers by name', () => dbxGpcNameMatches(names.slice(i, i + 400)))) cands.set(k, v)
  // Names with nothing similar in Insights Studio: kept as no match.
  await saveMatches<NameGuess>(d, 'name', names.filter((n) => !cands.get(n)?.length).map((n) => [keyOf(n), null]))
  const batches: string[][] = []
  for (let i = 0; i < names.length; i += NAME_BATCH) batches.push(names.slice(i, i + NAME_BATCH).filter((n) => cands.get(n)?.length))
  let done = 0
  // Three at a time: each call is a model round trip of 10–30 seconds.
  for (let b = 0; b < batches.length; b += 3) {
    await progress(`Matching advertisers by name (model): ${done} of ${names.length}`)
    await Promise.all(batches.slice(b, b + 3).map((part) => judge(part)))
    done += batches.slice(b, b + 3).reduce((s, x) => s + x.length, 0)
  }
  return { guessed }

  async function judge(part: string[]) {
    if (!part.length) return
    const ask = part
      .map((n) => ({
        name: n,
        type: ENTITY_TYPE[want.get(n)![0]!.entityType] ?? 'Advertiser',
        candidates: (cands.get(n) ?? []).slice(0, 8).map((c) => ({ id: c.id, name: c.name, level: c.level, under: c.via ?? null, size: c.size })),
      }))
      .filter((x) => x.candidates.length)
    if (!ask.length) return
    const { text } = await completeJson(
      `You match advertisers from MediaRadar's legacy taxonomy to entities in the Insights Studio taxonomy by name.
For each legacy name, pick the candidate that is the same company or brand, or null when none clearly is. A parent company is right for a legacy parent; a brand for a legacy brand or product. Different companies with similar names are not a match. Prefer null to a weak guess.
Reply with JSON only: {"matches":[{"name":"legacy name as given","id":"candidate id" or null,"confidence":"high"|"medium"|"low"}]}`,
      JSON.stringify(ask),
      { maxTokens: 3000 },
    )
    const json = parseJson<{ matches?: Array<{ name?: string; id?: string | null; confidence?: string }> }>(text)
    if (!json) {
      console.error('[migration] name match: unreadable answer', text.length, text.slice(0, 300), '…', text.slice(-200))
      return
    }
    if (process.env.PLAN_DEBUG) console.error('[migration] name match', ask.length, 'asked', (json.matches ?? []).length, 'answered', (json.matches ?? []).filter((m) => m.id).length, 'with an id')
    const judged = new Map<string, NameGuess | null>(ask.map((a) => [a.name, null]))
    for (const m of json.matches ?? []) {
      const name = String(m.name ?? '')
      if (!judged.has(name)) continue
      const c = (cands.get(name) ?? []).find((x) => x.id === String(m.id ?? ''))
      if (!c || m.confidence === 'low') continue
      const g: NameGuess = { id: c.id, name: c.name, level: c.level ?? 'Entity', confidence: m.confidence === 'high' ? 'high' : 'medium' }
      judged.set(name, g)
      apply(name, g)
    }
    await saveMatches(d, 'name', [...judged].map(([n, g]) => [keyOf(n), g]))
  }
}

/** Run something with a time limit: a Databricks statement can wait on the warehouse for a long time. */
async function within<T>(ms: number, what: string, f: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([f(), new Promise<T>((_, reject) => (timer = setTimeout(() => reject(new Error(`${what} took longer than ${Math.round(ms / 60_000)} minutes`)), ms)))])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

// ------------------------------------------------------------------ the plan

export async function buildPlan(d: Database, clientId: string, opts: { depth: 'full' | 'light'; useModel?: boolean; progress?: PlanProgress; now?: Date }): Promise<MigrationPlan> {
  const progress = opts.progress ?? (() => {})
  const useModel = opts.useModel ?? true
  const now = opts.now ?? new Date()
  const notes: string[] = []
  await progress('Reading the client')
  const [c] = await d.select().from(ceClients).where(eq(ceClients.clientId, clientId)).limit(1)
  if (!c) throw new Error('That client is not in the list. It may have changed with a refresh.')
  const legacy = await legacyAccounts(d, c.members as string[])
  if (!legacy.length) throw new Error('The client has no accounts in the snapshot.')

  const { groups, org, model: splitModel } = await groupAccounts(c.name, legacy, useModel, progress)

  // Ratings evidence (360 report runs with Nielsen or VideoAmp).
  const sets360 = groups.flatMap((g) => g.members).filter((a) => a.platform === '360').map((a) => Number(a.id))
  let ratings: Map<number, { nielsen: number; videoamp: number }> | null = null
  if (sets360.length) {
    await progress('Reading 360 ratings use')
    try {
      ratings = await ratingsRunsBySet(sets360, now)
    } catch (err) {
      notes.push(`360 ratings use could not be read: ${(err as Error).message}`.slice(0, 200))
    }
  }
  const accounts = groups.map((g, i) => accountPlan(g, i, ratings))

  await progress('Reading the people')
  const people = (await clientPeople(d, clientId))?.people ?? []
  const users = usersPlan(people, accounts, now)
  for (const a of accounts) a.seats = users.filter((u) => u.create.value && u.account === a.key).length

  // Workspaces: the users' default 360 profile lists, and each user set's restrictions shared by its users.
  await progress('Reading 360 reporting profiles and restrictions')
  const created = users.filter((u) => u.create.value)
  const usrOf = new Map<number, PlanUser>()
  for (const u of created) for (const l of people.find((p) => p.key === u.key)?.accounts ?? []) if (l.platform === '360' && l.active) usrOf.set(Number(l.userId), u)
  let profiles = new Map<number, RawItem[]>()
  let filters = new Map<number, RawItem[]>()
  try {
    if (usrOf.size) profiles = await profileItems([...usrOf.keys()])
    if (sets360.length) filters = await filterItems(sets360)
  } catch (err) {
    notes.push(`360 profiles or restrictions could not be read: ${(err as Error).message}`.slice(0, 200))
  }
  // Name every 360 item once.
  const want = new Map<number, Set<number>>()
  for (const list of [...profiles.values(), ...filters.values()]) for (const r of list.slice(0, MAX_ITEMS * 4)) (want.get(r.e) ?? want.set(r.e, new Set()).get(r.e)!).add(r.id)
  let names = new Map<string, string>()
  try {
    names = await names360(want)
  } catch (err) {
    notes.push(`360 names could not be read: ${(err as Error).message}`.slice(0, 200))
  }

  // Follow advertisers and categories into Insights Studio (full plans only).
  const freq = new Map<string, number>()
  const catFreq = new Map<string, number>()
  for (const list of [...profiles.values(), ...filters.values()])
    for (const r of list) {
      const a = ADV_ID(r.e, r.id)
      if (a) freq.set(a, (freq.get(a) ?? 0) + 1)
      const k = CAT_ID(r.e, r.id)
      if (k) catFreq.set(k, (catFreq.get(k) ?? 0) + 1)
    }
  const topAdv = [...freq].sort((a, b) => b[1] - a[1]).slice(0, MAP_ADVERTISERS).map(([k]) => k)
  const topCat = [...catFreq].sort((a, b) => b[1] - a[1]).slice(0, MAP_CATEGORIES).map(([k]) => k)
  const magAccounts = groups.flatMap((g) => g.members).filter((a) => a.platform === 'magnifier' && a.ent.kind === 'magnifier' && a.ent.access.length).map((a) => a.id)
  let matcher: Matcher | null = null
  let magnifierFocus: Candidates | null = null
  if (opts.depth === 'full') {
    const r = await buildMatcher(d, topAdv, topCat, magAccounts.slice(0, 50), progress)
    matcher = r.m
    magnifierFocus = r.magnifierFocus
    notes.push(...r.notes)
  }

  await progress('Proposing workspaces')
  const accountOfLegacy = new Map<string, string>()
  for (const a of accounts) for (const f of a.from) accountOfLegacy.set(f.key, a.key)
  const workspaces: PlanWorkspace[] = []
  const bySig = new Map<string, PlanWorkspace>()
  const addWs = (account: string, sets: PlanWorkspace['sets'], user: PlanUser, source: string, why: string, fallbackName: string) => {
    if (!sets.length) return
    const sig = `${account}|${signature(sets)}`
    const have = bySig.get(sig)
    if (have) {
      if (!have.users.includes(user.key)) have.users.push(user.key)
      return
    }
    const ws: PlanWorkspace = { key: `W${workspaces.length + 1}`, account, name: wsName(sets, fallbackName), source, users: [user.key], sets, why }
    bySig.set(sig, ws)
    workspaces.push(ws)
  }
  for (const [usr, u] of usrOf) {
    if (!u.account) continue
    const own = profiles.get(usr) ?? []
    if (own.length)
      addWs(
        u.account,
        setsOf(own.map((r) => item360(r, names, matcher, r.list)), (i) => (own.find((r) => String(r.id) === i.legacy.id && r.list === i.legacy.list)?.set ?? setFor(i.entityType) ?? 'advertisers')),
        u,
        '360 default reporting profile',
        'The lists in their default 360 reporting profile, which is what they look at day to day.',
        `${u.name}'s focus`,
      )
  }
  // A user set's restrictions: everyone created from it shares one workspace, as their access today.
  for (const [set, items] of filters) {
    const account = accountOfLegacy.get(`360:${set}`)
    if (!account) continue
    const legacyName = legacy.find((a) => a.key === `360:${set}`)?.name ?? `360 user set ${set}`
    const sets = setsOf(items.map((r) => item360(r, names, matcher, 'Access today')), (i) => items.find((r) => String(r.id) === i.legacy.id)?.set ?? 'advertisers')
    for (const [usr, u] of usrOf) {
      const p = people.find((x) => x.key === u.key)
      if (p?.accounts.some((l) => l.platform === '360' && Number(l.userId) === usr && Number(l.accountId) === set)) addWs(account, sets, u, `360 access today: ${legacyName}`, `Their 360 user set is limited to these today. Insights Studio gives the account more; this workspace keeps their view where it was.`, legacyName)
    }
  }
  // Magnifier: an account's REL restrictions, shared by its users.
  for (const a of groups.flatMap((g) => g.members).filter((x) => x.platform === 'magnifier')) {
    if (a.ent.kind !== 'magnifier') continue
    const account = accountOfLegacy.get(a.key)
    if (!account) continue
    const items: PlanWorkspaceItem[] = []
    for (const x of a.ent.access) {
      const set: SetKey | null = /advertiser|product|brand/i.test(x.label) ? 'advertisers' : /categor|industr/i.test(x.label) ? 'categories' : /market/i.test(x.label) ? 'markets' : null
      if (!set) continue
      const e = /parent/i.test(x.label) ? 102 : /product/i.test(x.label) ? 100 : /sub/i.test(x.label) ? 135 : /industr/i.test(x.label) ? 107 : set === 'categories' ? 103 : set === 'markets' ? 500 : 118
      for (const name of x.items) {
        const g = set === 'advertisers' ? matcher?.magnifier.get(name.toLowerCase()) : undefined
        items.push({ entityType: g ? 139 : e, name, legacy: { platform: 'magnifier', list: x.label, id: name }, gpc: g ? { id: g.id, name: g.name, how: 'Followed by its ads (Taxonomy Comparison)' } : null })
      }
    }
    const sets = setsOf(items, (i) => (/advertiser|product|brand/i.test(i.legacy.list) ? 'advertisers' : /market/i.test(i.legacy.list) ? 'markets' : 'categories'))
    for (const u of created) {
      const p = people.find((x) => x.key === u.key)
      if (p?.accounts.some((l) => l.platform === 'magnifier' && l.accountId === a.id && l.active)) addWs(account, sets, u, `Magnifier access today: ${a.name}`, "The account's Magnifier reports are limited to these today; the workspace keeps that focus while the account gets more.", a.name)
    }
  }

  // Advertisers with no spend to follow: matched by name, the model judging among the candidates.
  if (opts.depth === 'full' && useModel) {
    try {
      const n = await nameMatch(d, workspaces, progress)
      if (n.guessed) notes.push(`${n.guessed} workspace items were matched by name as the model's best guess; they are marked.`)
    } catch (err) {
      notes.push(`Matching advertisers by name did not run: ${(err as Error).message}`.slice(0, 200))
    }
  }

  // Several legacy items can land on one Insights Studio entity (a company's brands): a workspace holds each once.
  for (const w of workspaces)
    for (const s of w.sets) {
      const seen = new Set<string>()
      const before = s.items.length
      s.items = s.items.filter((i) => {
        if (!i.gpc) return true
        const k = `${i.entityType}:${i.gpc.id}`
        if (seen.has(k)) return false
        seen.add(k)
        return true
      })
      if (s.items.length < before) w.why = w.why.replace(/\.?$/, `. ${before - s.items.length} legacy ${s.set === 'advertisers' ? 'advertisers' : 'items'} land on the same Insights Studio entity as another and are merged.`).replace(/\.\. /, '. ')
    }

  // Impact, per platform.
  const media: MigrationPlan['impact']['media'] = []
  const legacyAll = legacyMedia(groups.flatMap((g) => g.members))
  for (const p of PLATFORMS) {
    const m = legacyAll.get(p)
    if (m) media.push({ platform: p, change: mediaChange(p, [...m.media], m.restricted) })
  }
  const gains: string[] = []
  const losses: string[] = []
  const notInV1: string[] = []
  const anyAccount = accounts[0]!
  const added = anyAccount.coverage.media.filter((x) => x.status === 'added').map((x) => x.name)
  if (added.length) gains.push(`${added.length} media new to them, including ${added.slice(0, 4).join(', ')}.`)
  for (const a of accounts) for (const pk of a.packages.filter((x) => x.key !== 'competitive')) gains.push(`${a.name}: ${pk.name} (${pk.why.replace(/\.$/, '')}).`)
  if (accounts.some((a) => a.coverage.widened.length)) gains.push('Restrictions on advertisers and categories are lifted: the whole account sees all brands and categories, with workspaces keeping each user’s focus.')
  // Lost: legacy media with nowhere to go, unless Insights Studio's catalogue has it under the same name (Search).
  const offered = new Set(MEDIA.filter((x) => x.active).map((x) => x.name.toLowerCase()))
  for (const x of media as Array<{ platform: Platform; change: MediaChange }>) {
    const gone = x.change.dropped.filter((d) => !offered.has(d.toLowerCase()))
    x.change.dropped = gone
    if (gone.length) losses.push(`${PLATFORM_LABEL[x.platform]}: ${gone.join(', ')} not in Insights Studio yet.`)
  }
  for (const a of accounts) for (const w of a.coverage.withheld) notInV1.push(`${a.name}: ${w.name} is premium and not included (they do not have it today).`)
  if (accounts.some((a) => a.packages.some((p) => p.key === 'ratings_us_linear_tv'))) notInV1.push('Ratings access by book and market is not carried by Insights Studio V1: ratings scope is set up separately.')
  if (workspaces.some((w) => w.sets.some((s) => s.set === 'markets'))) notInV1.push('Market lists are kept in workspaces, but Insights Studio does not apply workspace markets yet.')

  // Checklist.
  const checklist: string[] = []
  if (accounts.length > 1) checklist.push(`Confirm the split into ${accounts.length} Insights Studio accounts.`)
  const skipped = users.filter((u) => !u.create.value && u.logins.some((l) => l.active))
  if (skipped.length) checklist.push(`${skipped.length} active ${skipped.length === 1 ? 'user has' : 'users have'} not logged in for ${RECENT_MONTHS} months and ${skipped.length === 1 ? 'is' : 'are'} not proposed; confirm before migrating.`)
  const unmatched = workspaces.reduce((s, w) => s + w.sets.reduce((t, x) => t + x.items.filter((i) => !i.gpc && x.set !== 'markets').length, 0), 0)
  if (unmatched) checklist.push(`${unmatched} workspace items are not matched to Insights Studio ids yet (${opts.depth === 'light' ? 'this is a light plan, so advertisers and categories were not followed' : 'no recent spend to follow and no convincing match by name'}).`)
  const guesses = workspaces.reduce((s, w) => s + w.sets.reduce((t, x) => t + x.items.filter((i) => i.gpc?.guess).length, 0), 0)
  if (guesses) checklist.push(`${guesses} workspace items were matched by name as a best guess (marked); check them.`)
  if (legacy.some((a) => a.platform === 'classic')) checklist.push("Classic users' own lists (properties, competitive sets, categories) are not read yet, so their workspaces are not proposed.")
  if (accounts.some((a) => a.packages.some((p) => p.key === 'ratings_us_linear_tv'))) checklist.push('Set up ratings scope (books and markets) outside Insights Studio V1.')
  const inactive = legacy.filter((a) => !a.active)
  if (inactive.length) checklist.push(`${inactive.length} inactive legacy ${inactive.length === 1 ? 'account is' : 'accounts are'} not migrated.`)

  // Which advertisers the Impact Deck leads with.
  const deckFocus: MigrationPlan['deckFocus'] = []
  if (topAdv.length) {
    const nm = (k: string) => {
      const e = k.startsWith('P') ? 102 : k.startsWith('B') ? 139 : k.startsWith('V') ? 100 : 118
      return names.get(`${e}:${k.replace(/^[PBV]/, '')}`) ?? k
    }
    deckFocus.push({ platform: '360', taxonomy: 'VX1', items: topAdv.slice(0, 40).map((id) => ({ id, name: nm(id) })) })
  }
  if (magnifierFocus) deckFocus.push({ platform: 'magnifier', taxonomy: 'VX2', items: magnifierFocus.items.slice(0, 40) })

  const plan: MigrationPlan = {
    version: PLAN_VERSION,
    clientId,
    client: c.name,
    built: now.toISOString(),
    depth: opts.depth,
    summary: [],
    organization: org,
    accounts,
    users,
    workspaces,
    impact: { media, gains, losses, notInV1 },
    checklist,
    review: { verdict: 'check', issues: [], model: splitModel },
    deckFocus,
    notes,
  }
  if (useModel) await review(plan, progress)
  else plan.review.issues.push('The model review did not run.')
  if (!plan.summary.length) plan.summary = computedSummary(plan)
  return plan
}

function computedSummary(p: MigrationPlan): string[] {
  const out = [`${p.accounts.length} Insights Studio ${p.accounts.length === 1 ? 'account' : 'accounts'} under ${p.organization.name}.`]
  const users = p.users.filter((u) => u.create.value).length
  out.push(`${users} ${users === 1 ? 'user' : 'users'} to create; ${p.workspaces.length} ${p.workspaces.length === 1 ? 'workspace' : 'workspaces'} proposed.`)
  out.push(...p.impact.gains.slice(0, 2))
  out.push(...p.impact.losses.slice(0, 1))
  return out
}

/** The model reads the finished plan: does it hang together, and what should the client hear first. */
async function review(plan: MigrationPlan, progress: PlanProgress) {
  await progress('Reviewing the plan (model)')
  const brief = {
    client: plan.client,
    organization: plan.organization.name,
    accounts: plan.accounts.map((a) => ({
      name: a.name,
      type: a.type.value,
      replaces: a.from.map((f) => `${PLATFORM_LABEL[f.platform]} ${f.name} (${f.activeUsers} users)`),
      packages: a.packages.map((p) => `${p.name}: ${p.why}`),
      lookbackYears: a.contract.lookbackYears.value,
      mediaKept: a.coverage.media.filter((m) => m.status === 'kept').length,
      mediaAdded: a.coverage.media.filter((m) => m.status === 'added').map((m) => m.name),
      premium: a.coverage.media.filter((m) => m.status === 'premium').map((m) => m.name),
      withheld: a.coverage.withheld.map((w) => w.name),
      countries: a.coverage.countries.map((c) => c.name),
      restrictionsLifted: a.coverage.widened.slice(0, 8),
      seats: a.seats,
    })),
    users: { create: plan.users.filter((u) => u.create.value).length, notCreated: plan.users.filter((u) => !u.create.value).length },
    workspaces: plan.workspaces.slice(0, 30).map((w) => ({ account: plan.accounts.find((a) => a.key === w.account)?.name, name: w.name, source: w.source, users: w.users.length, sets: w.sets.map((s) => `${SET_LABEL[s.set]}: ${s.items.length + s.more} (${s.items.filter((i) => i.gpc).length} matched)`) })),
    mediaDropped: plan.impact.losses,
    notInV1: plan.impact.notInV1,
    checklist: plan.checklist,
  }
  try {
    const { text, model } = await completeJson(
      `You review a plan for moving a MediaRadar client from its legacy products (360, Classic, Magnifier) to Insights Studio, before client support uses it.
Insights Studio: an organization holds client accounts (Publisher or Brand/Agency). Each account has intelligence packages (Competitive, Commercial, Creative, Sports; add-ons such as Ratings) and coverage (media, countries). Clients get broader access than today; workspaces narrow what each user sees to their old focus (advertisers, categories, properties). Premium media (Live Streaming Sports, National Newspapers) only for clients who have it today; no non-US data unless they have it today.
Check that the plan makes sense for this client: account types and split, packages against what they use, users with no account or workspace, workspaces in an account that cannot see them, publisher accounts with advertiser-only workspaces or the reverse, anything lost that the client would notice, anything contradictory between platforms.
Name things only as 360, Classic, Magnifier and Insights Studio. Never write VX1, VX2, VX0 or GPC.
Reply with JSON only: {"verdict":"ok"|"check"|"problem","issues":["short, specific, actionable"],"summary":["4 to 6 client-facing bullets, under 25 words each, on what changes for them"]}`,
      JSON.stringify(brief),
      { maxTokens: 1800 },
    )
    const json = parseJson<{ verdict?: string; issues?: unknown; summary?: unknown }>(text)
    if (!json) throw new Error('unreadable answer')
    const verdict = json.verdict === 'ok' || json.verdict === 'problem' ? json.verdict : 'check'
    plan.review = {
      verdict,
      issues: Array.isArray(json.issues) ? json.issues.map((x) => plainTerms(String(x)).trim()).filter(Boolean).slice(0, 12) : [],
      model: plan.review.model ? `${plan.review.model}; ${model}` : model,
    }
    plan.summary = Array.isArray(json.summary) ? json.summary.map((x) => plainTerms(String(x)).trim()).filter(Boolean).slice(0, 6) : []
  } catch (err) {
    console.error('[migration] review', err)
    plan.review = { verdict: 'check', issues: [`The model review did not run: ${(err as Error).message}`.slice(0, 200)], model: plan.review.model }
  }
}

/** The plan's deck advertisers, as the Impact Deck takes them. */
export function deckFocusOf(plan: MigrationPlan): Partial<Record<Platform, Candidates>> {
  const out: Partial<Record<Platform, Candidates>> = {}
  for (const f of plan.deckFocus) if (f.items.length) out[f.platform] = { kind: 'advertiser', source: 'plan', taxonomy: f.taxonomy, items: f.items }
  return out
}

export { ENTITY_TYPE }
