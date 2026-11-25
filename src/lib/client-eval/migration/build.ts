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
 *   - legacy ids become Insights Studio ids the way Taxonomy Comparison follows them (dbxFlows, summed: dbxAdvertiserSummary, dbxCategorySummary).
 *
 * The facts come from the snapshot (ce_*) and live 360 reads. The model only
 * groups accounts and reviews the finished plan; without it the plan is still
 * built, one account per type, and says the review did not run.
 */
import { createHash } from 'node:crypto'
import { and, eq, gte, inArray, sql } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { ceAccounts, ceClients, ceOfflineReports, ceUsers } from '@/db/schema'
import { chunks, q360, reportsForUsers } from '@/lib/import360/source'
import { completeJson } from '@/lib/llm'
import { dbxAdvertiserSummary, dbxCategorySummary, dbxGpcNameMatches, dbxMergedEntities, dbxTaxonomyTree, dbxVx2CategoryShares } from '@/lib/taxonomy-dbx'
import { MONTHS } from '@/lib/taxonomy-rules'
import { connectMagnifier, magnifierConfig } from '../load-magnifier'
import { parseRel } from '../rel'
import type { Candidate } from '@/lib/taxonomy-rules'
import { ADV_360, candidatesMagnifier, names360, plainTerms, type Candidates } from '../deck-data'
import { accountSearches, mongoUrl } from '../saved-searches'
import { premiumNote } from './premium'
import { bundleFor } from './bundle'
import { accountOfPlan, planMode, type PlanMode } from './mode'
import { currentMedia, mediaChange, type MediaChange } from '../media-map'
import { ratingsRunsBySet } from '../ratings-usage'
import { clientPeople, type PersonRow } from '../store'
import { parseMember, PLATFORM_LABEL, PLATFORMS, type Ent360, type EntClassic, type EntMagnifier, type Entitlements, type Platform } from '../types'
import { readMatches, saveMatches } from './matches'
import { ACCOUNT_TYPE_LABEL, catalogName, COUNTRIES, ENTITY_TYPE, MEDIA, packageByKey, PREMIUM_MEDIA, rollupMedia, rollupNames, SET_LABEL, type AccountType, type CountryCode, type SetKey } from './catalog'
import { PLAN_VERSION, type MigrationPlan, type PlanAccount, type PlanReport, type PlanSavedView, type PlanUser, type PlanWorkspace, type PlanWorkspaceItem } from './types'

export type PlanProgress = (step: string) => Promise<void> | void

const RECENT_MONTHS = 12
const MAX_ITEMS = 200
const MAP_ADVERTISERS = 2000
const MAP_CATEGORIES = 100
/** Advertisers a statement. Each reads 30-50 GB of occurrences however few it holds; the summary keeps 1,000 at about 45 s and 20 MB (24 November 2026). */
const FOLLOW_BATCH = 1000
/**
 * How long one Databricks step may take, waiting included. The warehouse is shared: on 24 November 2026 other
 * people's queries kept ours queued for up to 6 minutes, and Dallas Morning News lost its advertisers, categories
 * and names to the old 4-6 minute limits while waiting, not running.
 */
const FOLLOW_LIMIT = 12 * 60_000
/** Item types whose Insights Studio id is a GPC entity (subsidiary, parent, advertiser, brand): those GPC can merge. */
const GPC_ENTITY_TYPES = new Set([101, 102, 118, 139])
/**
 * Categories a statement. Full flow rows for 300 categories ran the server (1.75 GB) out of memory (24 November
 * 2026); the summary dbxCategorySummary returns is one row per category and GPC category/subcategory, so 100
 * used 15 MB in testing.
 */
const CATEGORY_BATCH = 100
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
  /** 360 reports used in 2026, or Magnifier saved searches in 2026. */
  reports: number
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
        out.push({ key: `${p}:${a.accountId}`, platform: p, id: a.accountId, name: a.name, active: a.active, activeUsers: a.activeUsers, summary: a.summary ?? '', ent, type: t.type, typeWhy: t.why, reports: a.reports })
      }
  }
  return out.sort((x, y) => y.activeUsers - x.activeUsers || x.name.localeCompare(y.name))
}

/** What the plan is built from, as a hash: a refresh that changes any of it marks the plan out of date. */
/**
 * What a plan id covers: a client (its id), or one legacy account of a holding company ("acct|360:12345", mode.ts),
 * planned on its own under its client (Scott, 24 November 2026). Null when it is gone.
 */
export async function planSubject(d: Database, id: string): Promise<{ name: string; company: string | null; members: string[]; clientId: string; clientName: string; account: string | null } | null> {
  const member = accountOfPlan(id)
  if (!member) {
    const [c] = await d.select({ name: ceClients.name, company: ceClients.company, members: ceClients.members }).from(ceClients).where(eq(ceClients.clientId, id)).limit(1)
    return c ? { name: c.name, company: c.company, members: c.members as string[], clientId: id, clientName: c.name, account: null } : null
  }
  const m = parseMember(member)
  if (!m) return null
  const [c] = await d.select({ id: ceClients.clientId, name: ceClients.name, company: ceClients.company }).from(ceClients).where(sql`${ceClients.members} ? ${member}`).limit(1)
  const [a] = await d.select({ name: ceAccounts.name, company: ceAccounts.company }).from(ceAccounts).where(and(eq(ceAccounts.platform, m.platform), eq(ceAccounts.accountId, m.accountId))).limit(1)
  if (!c || !a) return null
  return { name: a.name, company: a.company ?? c.company, members: [member], clientId: c.id, clientName: c.name, account: member }
}

export async function inputsHash(d: Database, clientId: string): Promise<string | null> {
  const c = await planSubject(d, clientId)
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
  /** The legacy account's restrictions stay on the Insights Studio account (holding companies), not lifted. */
  keepLimits?: boolean
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

/** What an account may see today, as a key: its advertiser, category, market and property restrictions, if any. */
function accessKey(a: Legacy): string {
  const e = a.ent
  if (e.kind === '360') return e.filters.filter((f) => !/submedia|^media|time|data tables/i.test(f.type) && f.include.length).map((f) => `${f.type}:${[...f.include].sort().join(',')}`).sort().join('|')
  if (e.kind === 'magnifier') return e.access.filter((x) => !/countr|flag/i.test(x.label)).map((x) => `${x.label}:${[...x.items].sort().join(',')}`).sort().join('|')
  return ''
}

/**
 * Accounts of one type with the same access are one account: a split gains nothing when every user would see the
 * same data (Scott, 25 November 2026: General Motors' Market Research and Corporate Magnifier accounts, set up alike,
 * came out as their own accounts because the model read purposes into their names).
 */
function mergeAlike(groups: Group[], label: (t: AccountType) => string): Group[] {
  const keyOf = (g: Group) => `${g.type}#${[...new Set(g.members.map(accessKey))].sort().join('||')}`
  const byKey = new Map<string, Group[]>()
  for (const g of groups) (byKey.get(keyOf(g)) ?? byKey.set(keyOf(g), []).get(keyOf(g))!).push(g)
  const out: Group[] = []
  for (const same of byKey.values()) {
    if (same.length === 1 || same.some((g) => g.keepLimits)) {
      out.push(...same)
      continue
    }
    const members = same.flatMap((g) => g.members)
    const t = same[0]!.type
    out.push({
      name: groups.filter((g) => g.type === t).length === same.length ? label(t) : same.sort((a, b) => b.members.length - a.members.length)[0]!.name,
      type: t,
      members,
      why: `One account: ${members.length} legacy accounts with the same access, so separate accounts would gain nothing (the model had proposed ${same.length}: ${same.map((g) => g.name).join(', ')}).`,
    })
  }
  return out
}

/** One account per type, or the model's split where a type has several legacy accounts. */
async function groupAccounts(client: string, pool: Legacy[], mode: PlanMode, useModel: boolean, progress: PlanProgress): Promise<{ groups: Group[]; org: { name: string; why: string }; model: string | null }> {
  const types = [...new Set(pool.map((a) => a.type))]
  const label = (t: AccountType) => (types.length > 1 ? `${client} (${ACCOUNT_TYPE_LABEL[t]})` : client)
  const fallback = (): Group[] =>
    types.map((t) => {
      const members = pool.filter((a) => a.type === t)
      return { name: label(t), type: t, members, why: members.length > 1 ? `All ${members.length} ${ACCOUNT_TYPE_LABEL[t]} accounts together.` : `Replaces ${members[0]!.name}.` }
    })
  const org = { name: client, why: 'One organization per client, as Client Evaluation groups its accounts across 360, Classic and Magnifier.' }
  if (mode === 'holding') {
    // One Insights Studio account per legacy agency account, its restrictions kept; anything else by type.
    const groups: Group[] = pool
      .filter((a) => a.type === 'brand_agency')
      .map((a) => ({ name: a.name, type: a.type, members: [a], why: `Replaces ${a.name} on its own, keeping what it may see today.`, keepLimits: true }))
    for (const t of types.filter((x) => x !== 'brand_agency')) {
      const members = pool.filter((a) => a.type === t)
      groups.push({ name: label(t), type: t, members, why: `All ${members.length} ${ACCOUNT_TYPE_LABEL[t]} accounts together.` })
    }
    return { groups, org: { name: client, why: 'An agency holding company: one organization, an account for each agency account.' }, model: null }
  }
  if (mode === 'markets') return { groups: fallback().map((g) => ({ ...g, why: `One account with every market; each market's users get a workspace limited to their market.` })), org, model: null }
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
      groups: mergeAlike(groups, label),
      org: { name: String(json.organization ?? '').trim().slice(0, 120) || client, why: plainTerms(String(json.organizationWhy ?? '').trim()).slice(0, 400) || org.why },
      model,
    }
  } catch (err) {
    console.error('[migration] account split', err)
    return { groups: fallback(), org, model: null }
  }
}

/**
 * The legacy accounts to migrate. Left out: inactive ones, and dormant ones, still flagged active but with no
 * sign of use: no user has logged in within RECENT_MONTHS and nothing was run or saved in 2026 (Scott, 24 November
 * 2026: Amazon Project Kuiper, a lost client, had 7 "active" users and no login on record). Magnifier's login record
 * starts in September 2026, so a Magnifier account counts as used while it has active users. If nothing is left,
 * everything active is kept, so the plan still says something.
 */
export function migratable(legacy: Legacy[], people: PersonRow[], now: Date): { pool: Legacy[]; notMigrated: NonNullable<MigrationPlan['notMigrated']>; allDormant: boolean } {
  const cutoff = monthsAgo(RECENT_MONTHS, now)
  const lastLogin = new Map<string, string>()
  for (const p of people)
    for (const a of p.accounts) {
      const k = `${a.platform}:${a.accountId}`
      if (a.lastSeen && a.lastSeen > (lastLogin.get(k) ?? '')) lastLogin.set(k, a.lastSeen)
    }
  const notMigrated: NonNullable<MigrationPlan['notMigrated']> = []
  const pool: Legacy[] = []
  for (const a of legacy) {
    if (!a.active) {
      notMigrated.push({ name: a.name, platform: a.platform, why: 'Inactive today.' })
      continue
    }
    const last = lastLogin.get(a.key) ?? null
    const used = a.platform === 'magnifier' ? a.activeUsers > 0 || a.reports > 0 : (last !== null && last >= cutoff) || a.reports > 0
    if (used) pool.push(a)
    else
      notMigrated.push({
        name: a.name,
        platform: a.platform,
        why: a.platform === 'magnifier' ? 'No active users and no saved searches in 2026.' : `Dormant: ${last ? `no login since ${last}` : 'no login on record'} and no reports in 2026, though still flagged active.`,
      })
  }
  if (!pool.length) return { pool: legacy.filter((a) => a.active).length ? legacy.filter((a) => a.active) : legacy, notMigrated: [], allDormant: legacy.some((a) => a.active) }
  return { pool, notMigrated, allDormant: false }
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

/**
 * Magnifier's category-based grant (Scott, 16 November 2026, "the intent is for the new entitlements to be GPC
 * category based", applied to Migration Plans 25 November 2026): each advertiser or category a Magnifier account's
 * RELs name grants the GPC categories holding at least a quarter of its spend, if it spent enough to judge. The rule
 * was $25K over May-October; the spend read here covers MONTHS, so the bar is scaled to them.
 */
/** The most history Insights Studio holds (Scott, 25 November 2026). */
const MAX_HISTORY = 5
const GRANT_SHARE = 0.25
const GRANT_MIN_SPEND = Math.round((25_000 * MONTHS.length) / 6)

interface MagnifierGrant {
  categories: string[]
  /** REL advertisers and categories it was drawn from. */
  items: number
  /** Of those, how many spent too little to grant anything. */
  weak: number
}

/** Each Magnifier account's REL advertisers and categories, by account code: its client RELs, not the default ones. */
async function relItems(accountIds: string[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>()
  const cfg = magnifierConfig()
  if (!cfg || !accountIds.length) return out
  const conn = await connectMagnifier(cfg)
  try {
    const [rows] = await conn.query({
      sql: `SELECT DISTINCT r.USER_ACCOUNT_CODE a, c.RULE_RAW raw FROM (SELECT DISTINCT USER_ACCOUNT_CODE, REPORT_ID FROM USER_ACCOUNT_REPORTING) r
       JOIN REPORT_CONFIGURATION rc ON rc.REPORT_ID = r.REPORT_ID AND rc.IS_ENABLED = 1
       JOIN CRITERIA c ON c.ID = rc.CRITERIA_ID
       WHERE r.USER_ACCOUNT_CODE IN (?)`,
      values: [accountIds],
      timeout: 60_000,
    })
    for (const r of rows as Array<{ a: string; raw: string | null }>) {
      const set = out.get(String(r.a).trim()) ?? out.set(String(r.a).trim(), new Set()).get(String(r.a).trim())!
      for (const f of parseRel(String(r.raw ?? '')).fields)
        for (const code of f.codes) {
          if (/^\d+$/.test(code)) continue // Canadian ids: Canada is left out
          if (f.field === 'advertiser_code' || f.field === 'parent_advertiser_code') set.add(code)
          else if (f.field === 'category_code' || f.field === 'category_t1_code') set.add(`C${code}`)
          else if (f.field === 'subcategory_code' || f.field === 'category_t2_code') set.add(`S${code}`)
        }
    }
  } finally {
    await conn.end().catch(() => {})
  }
  return out
}

/** The GPC categories each Magnifier account's REL items grant, by legacy key ("magnifier:CODE"). */
async function magnifierGrants(members: Legacy[], progress: PlanProgress, notes: string[]): Promise<Map<string, MagnifierGrant>> {
  const out = new Map<string, MagnifierGrant>()
  const mag = members.filter((a) => a.platform === 'magnifier')
  if (!mag.length) return out
  await progress("Granting GPC categories for Magnifier's advertisers")
  try {
    const items = await within(3 * 60_000, "Reading Magnifier's RELs", () => relItems(mag.map((a) => a.id)))
    const all = [...new Set([...items.values()].flatMap((s) => [...s]))]
    if (!all.length) return out
    const shares = await within(FOLLOW_LIMIT, "Following Magnifier's advertisers into GPC categories", () => dbxVx2CategoryShares(all))
    const grants = new Map<string, string[]>()
    for (const id of all) {
      const rows = shares.get(id) ?? []
      const total = rows.reduce((s, r) => s + r.spend, 0)
      grants.set(id, total >= GRANT_MIN_SPEND ? rows.filter((r) => r.spend / total >= GRANT_SHARE).map((r) => r.category) : [])
    }
    for (const a of mag) {
      const mine = [...(items.get(a.id.trim()) ?? [])]
      if (!mine.length) continue
      const cats = new Set(mine.flatMap((id) => grants.get(id) ?? []))
      out.set(a.key, { categories: [...cats].sort(), items: mine.length, weak: mine.filter((id) => !(grants.get(id) ?? []).length).length })
    }
  } catch (err) {
    notes.push(`Magnifier's GPC categories could not be granted: ${(err as Error).message}`.slice(0, 200))
  }
  return out
}

/** Offline reports since this day count (Scott, 24 November 2026: someone downloaded one in 2026). */
const OFFLINE_SINCE = '2026-01-01'
const OUR_DOMAINS = /@(mediaradar|vivvix|kantar|competitrack)\./i

interface OfflineEvidence {
  people: number
  example: string | null
  last: string
}

/**
 * Per account group: its people who downloaded a Magnifier offline report since OFFLINE_SINCE, matched by email
 * (ce_offline_reports, loaded from a laptop). Our own staff, who download on clients' behalf, do not count.
 */
async function offlineByAccount(d: Database, groups: Group[], people: PersonRow[], notes: string[]): Promise<Map<number, OfflineEvidence>> {
  const out = new Map<number, OfflineEvidence>()
  const emails = [...new Set(people.map((p) => p.email?.toLowerCase()).filter((e): e is string => !!e && !OUR_DOMAINS.test(e)))]
  if (!emails.length) return out
  try {
    const rows = await d.select().from(ceOfflineReports).where(and(inArray(ceOfflineReports.email, emails), gte(ceOfflineReports.lastDownload, OFFLINE_SINCE)))
    const byEmail = new Map(rows.map((r) => [r.email, r]))
    const groupOf = new Map<string, number>()
    groups.forEach((g, i) => g.members.forEach((m) => groupOf.set(m.key, i)))
    for (const p of people) {
      const r = p.email ? byEmail.get(p.email.toLowerCase()) : undefined
      if (!r) continue
      for (const i of new Set(p.accounts.map((a) => groupOf.get(`${a.platform}:${a.accountId}`)).filter((x): x is number => x !== undefined))) {
        const e = out.get(i) ?? out.set(i, { people: 0, example: null, last: '' }).get(i)!
        e.people++
        if ((r.lastDownload ?? '') > e.last) {
          e.last = r.lastDownload ?? ''
          e.example = r.example?.trim() || e.example
        }
      }
    }
  } catch (err) {
    notes.push(`Offline reports could not be read: ${(err as Error).message}`.slice(0, 200))
  }
  return out
}

function accountPlan(g: Group, i: number, ratings: Map<number, { nielsen: number; videoamp: number }> | null, offline: OfflineEvidence | null, grants: Map<string, MagnifierGrant>): PlanAccount {
  const feats = features(g.members)
  const has = (re: RegExp) => feats.find((f) => re.test(f))
  const packages: PlanAccount['packages'] = []
  const add = (key: string, why: string, starting?: boolean) => {
    const p = packageByKey.get(key)!
    if (!packages.some((x) => x.key === key)) packages.push({ key, name: p.name, kind: p.kind, why, ...(starting ? { starting: true } : {}) })
  }
  // The bundle: the commercial team's rule, platform by platform (bundle.ts). It replaces the earlier guesses from
  // account type and features (a publisher getting Commercial; Classic getting Competitive).
  const from = new Set(g.members.map((a) => a.platform))
  for (const b of bundleFor(from)) add(b.key, b.why, true)
  // Offline reports are spend reports: a client that receives them gets Competitive too (Scott, 24 November 2026).
  if (offline)
    add(
      'competitive',
      `Receives Magnifier offline reports: ${offline.people} ${offline.people === 1 ? 'person' : 'people'} downloaded one in 2026${offline.example ? ` ("${offline.example}")` : ''}, last on ${offline.last}.`,
    )
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
  // Insights Studio keeps at most MAX_HISTORY years (Scott, 25 November 2026): more than that today is a loss.
  const most = years.length ? Math.max(...years) : null
  const lookback =
    most === null
      ? { value: 3, why: 'No history setting today; 3 complete years plus the current year is the standard.' }
      : most > MAX_HISTORY
        ? { value: MAX_HISTORY, why: `They have ${most} years in 360 today; Insights Studio keeps at most ${MAX_HISTORY}, so the years beyond are lost.`, lost: most - MAX_HISTORY }
        : { value: most, why: `The most history any of its 360 user sets has today (${most} years).` }
  const prelim = has(PRELIM)
  const includePreliminary = prelim ? { value: true, why: `Has ${prelim} today.` } : { value: false, why: 'No preliminary data today.' }

  // Coverage: every medium except premium ones they lack; no country beyond the US unless they have it.
  const legacy = legacyMedia(g.members)
  const keptNames = new Set<string>()
  for (const [p, m] of legacy) {
    for (const k of mediaChange(p, [...m.media], m.restricted).kept) keptNames.add(k)
    // A medium Insights Studio offers under its own name is kept too, though the Impact Deck's GPC media list lacks it
    // (Search, Medical Journals...): what a client has today it keeps (Scott, 24 November 2026).
    for (const n of m.media) {
      const c = catalogName(n)
      if (c) keptNames.add(c)
    }
  }
  const premiumHeld = new Set(MEDIA.filter((m) => PREMIUM_MEDIA.has(m.id) && keptNames.has(m.name)).map((m) => m.id))
  const media: PlanAccount['coverage']['media'] = []
  const withheld: PlanAccount['coverage']['withheld'] = []
  for (const m of MEDIA.filter((x) => x.active)) {
    if (PREMIUM_MEDIA.has(m.id) && !premiumHeld.has(m.id)) {
      withheld.push({ name: m.name, why: 'Premium: included only for clients who have it today, and they do not.' })
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
  // Holding companies keep their restrictions on the account itself: nothing is lifted.
  let limits: PlanAccount['coverage']['limits']
  let limitsWhy: string | undefined
  if (g.keepLimits) {
    limits = []
    for (const a of g.members) {
      const e = a.ent
      if (e.kind === '360') for (const f of e.filters.filter((x) => !/submedia|^media|time|data tables/i.test(x.type) && x.include.length)) limits.push({ label: f.type, items: f.include.slice(0, 60), total: f.count })
      if (e.kind === 'magnifier') {
        // Magnifier's advertisers and categories become the GPC categories they grant, as everywhere else.
        const grant = grants.get(a.key)
        if (grant?.categories.length) limits.push({ label: 'GPC categories', items: grant.categories.slice(0, 60), total: grant.categories.length })
        else for (const x of e.access.filter((y) => !/countr|flag/i.test(y.label))) limits.push({ label: x.label, items: x.items.slice(0, 60), total: x.total })
      }
    }
    widened.length = 0
  } else {
    // A Magnifier account limited to advertisers or categories is entitled to the GPC categories they grant; its
    // users get workspaces limited to the advertisers themselves. Unless the account also has a 360 user set limited
    // to no advertisers or categories: then it gets every category, and the Magnifier workspaces still (Scott,
    // 25 November 2026).
    const open360 = g.members.some((a) => a.ent.kind === '360' && !a.ent.filters.some((f) => /advertiser|brand|product|parent|subsidiar|categor|industr|major/i.test(f.type) && f.include.length))
    const granted = g.members.filter((a) => a.platform === 'magnifier').map((a) => grants.get(a.key)).filter((x): x is MagnifierGrant => !!x)
    const cats = [...new Set(granted.flatMap((x) => x.categories))].sort()
    if (!open360 && cats.length) {
      limits = [{ label: 'GPC categories', items: cats.slice(0, 60), total: cats.length }]
      // What Magnifier limited is now a category entitlement, not a lifted restriction.
      for (let k = widened.length - 1; k >= 0; k--) if (widened[k]!.includes('(Magnifier):')) widened.splice(k, 1)
      const items = granted.reduce((s, x) => s + x.items, 0)
      const weak = granted.reduce((s, x) => s + x.weak, 0)
      limitsWhy = `The GPC categories covering its ${items} Magnifier advertisers and categories: each grants the categories holding a quarter of its spend${weak ? `; ${weak} spent too little to grant one and stay in the users' workspaces` : ''}.`
    }
  }

  return {
    key: `A${i + 1}`,
    name: g.name,
    type: { value: g.type, why: [...new Set(g.members.map((a) => a.typeWhy))].join('; ') },
    from: g.members.map((a) => ({ key: a.key, platform: a.platform, name: a.name, activeUsers: a.activeUsers })),
    why: g.why,
    contract: { lookbackYears: lookback, includePreliminary },
    packages,
    coverage: { media, withheld, countries, widened: widened.slice(0, 40), ...(limits ? { limits } : {}), ...(limitsWhy ? { limitsWhy } : {}) },
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

/** 360 reporting profiles last used on or after this day become workspaces (Scott, 24 November 2026: "only those used in 2026"). */
export const PROFILES_SINCE = '2026-01-01'

interface Profile {
  id: number
  name: string
  lastUsed: string
  isDefault: boolean
  items: RawItem[]
}

/**
 * Each 360 user's reporting profiles used since PROFILES_SINCE (reporting_profile.lastused_d), with their lists.
 * Every one of them, not just the default: a user who switches between profiles has a workspace for each.
 */
async function profileItems(usrIds: number[]): Promise<Map<number, Profile[]>> {
  const out = new Map<number, Profile[]>()
  for (const part of chunks(usrIds, 500)) {
    if (!part.length) continue
    const byId = new Map<number, Profile>()
    for (const r of await q360<{ usr_id: number; p: number; n: string | null; used: Date | string; dflt: number; t: number; e: number; id: number }>(
      `SELECT rp.usr_id, rp.reporting_profile_id AS p, rp.reporting_profile_n AS n, rp.lastused_d AS used,
         CASE WHEN d.reporting_profile_id IS NULL THEN 0 ELSE 1 END AS dflt, s.entity_set_type_id AS t, i.entity_type_id AS e, i.entity_id AS id
       FROM iddb_appl.dbo.reporting_profile rp
       LEFT JOIN iddb_appl.dbo.user_default_reporting_profile d ON d.usr_id = rp.usr_id AND d.reporting_profile_id = rp.reporting_profile_id
       JOIN iddb_appl.dbo.entity_set s ON s.reporting_profile_id = rp.reporting_profile_id AND s.active_f = 1
       JOIN iddb_appl.dbo.entity_item i ON i.entity_set_id = s.entity_set_id
       WHERE rp.usr_id IN (${part.join(',')}) AND rp.lastused_d >= '${PROFILES_SINCE}' AND i.entity_id > 0 AND s.entity_set_type_id IN (1,2,3,4,5,6,7,8)
       ORDER BY rp.usr_id, rp.lastused_d DESC, s.entity_set_type_id, i.order_id`,
    )) {
      const s = PROFILE_SET[Number(r.t)]
      if (!s || !ALLOWED[s.set].includes(Number(r.e))) continue
      const pid = Number(r.p)
      let prof = byId.get(pid)
      if (!prof) {
        const used = r.used instanceof Date ? r.used.toISOString() : String(r.used)
        prof = { id: pid, name: String(r.n ?? '').trim() || `Profile ${pid}`, lastUsed: used.slice(0, 10), isDefault: Number(r.dflt) === 1, items: [] }
        byId.set(pid, prof)
        ;(out.get(Number(r.usr_id)) ?? out.set(Number(r.usr_id), []).get(Number(r.usr_id))!).push(prof)
      }
      prof.items.push({ set: s.set, e: Number(r.e), id: Number(r.id), list: s.list })
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
  const fromFlows = (flows: Awaited<ReturnType<typeof dbxAdvertiserSummary>>, into: Map<string, { id: string; name: string; parent: boolean }>) => {
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
        fromFlows(await within(FOLLOW_LIMIT, 'Following advertisers', () => dbxAdvertiserSummary('VX1', part)), m.adv)
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
      // Summed in Databricks to one row per category and GPC category/subcategory, so 100 fit in one query
      // (24 November 2026: about 35 seconds for 100, where batches of 10 full rows took 20 seconds each).
      for (let i = 0; i < catIds.length; i += CATEGORY_BATCH) {
        if (i) await progress(`Following categories into Insights Studio (${i} of ${catIds.length})`)
        const part = catIds.slice(i, i + CATEGORY_BATCH)
        const flows = await within(FOLLOW_LIMIT, 'Following categories', () => dbxCategorySummary(part))
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
          fromFlows(await within(FOLLOW_LIMIT, 'Following Magnifier advertisers', () => dbxAdvertiserSummary('VX2', follow)), into)
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
  for (let i = 0; i < names.length; i += 400) for (const [k, v] of await within(FOLLOW_LIMIT, 'Finding advertisers by name', () => dbxGpcNameMatches(names.slice(i, i + 400)))) cands.set(k, v)
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
  const c = await planSubject(d, clientId)
  if (!c) throw new Error('That client or account is not in the list. It may have changed with a refresh.')
  const legacy = await legacyAccounts(d, c.members)
  // Why these accounts are one client, in the grouping's words (Scott, 25 November 2026: "the plan should explain
  // the consolidation").
  const grouping: NonNullable<MigrationPlan['grouping']> = []
  if (!c.account) {
    const [row] = await d.select({ how: ceClients.how }).from(ceClients).where(eq(ceClients.clientId, c.clientId)).limit(1)
    const nameOf = new Map(legacy.map((a) => [a.key, a.name]))
    for (const l of (row?.how ?? []) as Array<{ a: string; b: string; why: string }>) if (nameOf.has(l.a) && nameOf.has(l.b)) grouping.push({ a: nameOf.get(l.a)!, b: nameOf.get(l.b)!, why: l.why })
  }
  if (!legacy.length) throw new Error('The client has no accounts in the snapshot.')

  await progress('Reading the people')
  // An account's plan: its client's people, as far as they use this account.
  const people = ((await clientPeople(d, c.clientId))?.people ?? [])
    .map((p) => (c.account ? { ...p, accounts: p.accounts.filter((a) => `${a.platform}:${a.accountId}` === c.account) } : p))
    .filter((p) => p.accounts.length)
  // Accounts not migrated: inactive ones, and dormant ones (Scott, 24 November 2026: Amazon Project Kuiper was lost
  // as a client yet is still flagged active in 360, which keeps no end date).
  const { pool, notMigrated, allDormant } = migratable(legacy, people, now)
  if (allDormant) notes.push('Every account here looks dormant (no login in 12 months, nothing run in 2026); the plan is drawn anyway. Confirm before migrating.')
  // A holding company's account is planned on its own and keeps what it may see today.
  const { mode, why: modeWhy } = c.account
    ? { mode: 'holding' as const, why: `One of ${c.clientName}'s accounts, planned on its own: it becomes its own Insights Studio account and keeps the advertisers and categories it may see today.` }
    : planMode(c.name, c.company, pool)
  const grouped = await groupAccounts(c.name, pool, mode, useModel, progress)
  const { groups, model: splitModel } = grouped
  const org = c.account ? { name: c.clientName, why: `The organization is ${c.clientName}; this plan covers one of its accounts.` } : grouped.org

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
  const offline = await offlineByAccount(d, groups, people, notes)
  // Magnifier's RELs become GPC categories (full plans: it reads Databricks).
  const grants = opts.depth === 'full' ? await magnifierGrants(groups.flatMap((g) => g.members), progress, notes) : new Map<string, MagnifierGrant>()
  const accounts = groups.map((g, i) => accountPlan(g, i, ratings, offline.get(i) ?? null, grants))

  const users = usersPlan(people, accounts, now)
  for (const a of accounts) a.seats = users.filter((u) => u.create.value && u.account === a.key).length

  // Workspaces: the users' default 360 profile lists, and each user set's restrictions shared by its users.
  await progress('Reading 360 reporting profiles and restrictions')
  const created = users.filter((u) => u.create.value)
  const usrOf = new Map<number, PlanUser>()
  for (const u of created) for (const l of people.find((p) => p.key === u.key)?.accounts ?? []) if (l.platform === '360' && l.active) usrOf.set(Number(l.userId), u)
  let profiles = new Map<number, Profile[]>()
  let filters = new Map<number, RawItem[]>()
  try {
    if (usrOf.size) profiles = await profileItems([...usrOf.keys()])
    if (sets360.length) filters = await filterItems(sets360)
  } catch (err) {
    notes.push(`360 profiles or restrictions could not be read: ${(err as Error).message}`.slice(0, 200))
  }
  // Name every 360 item once.
  const want = new Map<number, Set<number>>()
  const profileLists = [...profiles.values()].flatMap((ps) => ps.map((x) => x.items))
  for (const list of [...profileLists, ...filters.values()]) for (const r of list.slice(0, MAX_ITEMS * 4)) (want.get(r.e) ?? want.set(r.e, new Set()).get(r.e)!).add(r.id)
  let names = new Map<string, string>()
  try {
    names = await names360(want)
  } catch (err) {
    notes.push(`360 names could not be read: ${(err as Error).message}`.slice(0, 200))
  }

  // Follow advertisers and categories into Insights Studio (full plans only).
  const freq = new Map<string, number>()
  const catFreq = new Map<string, number>()
  for (const list of [...profileLists, ...filters.values()])
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
  const addWs = (account: string, sets: PlanWorkspace['sets'], user: PlanUser, source: string, why: string, fallbackName: string, keepName = false) => {
    if (!sets.length) return
    const sig = `${account}|${signature(sets)}`
    const have = bySig.get(sig)
    if (have) {
      if (!have.users.includes(user.key)) have.users.push(user.key)
      return
    }
    const ws: PlanWorkspace = { key: `W${workspaces.length + 1}`, account, name: keepName ? fallbackName.slice(0, 80) : wsName(sets, fallbackName), source, users: [user.key], sets, why }
    bySig.set(sig, ws)
    workspaces.push(ws)
  }
  for (const [usr, u] of usrOf) {
    if (!u.account) continue
    for (const prof of profiles.get(usr) ?? []) {
      const own = prof.items
      addWs(
        u.account,
        setsOf(own.map((r) => item360(r, names, matcher, r.list)), (i) => (own.find((r) => String(r.id) === i.legacy.id && r.list === i.legacy.list)?.set ?? setFor(i.entityType) ?? 'advertisers')),
        u,
        `360 reporting profile "${prof.name}"${prof.isDefault ? ' (their default)' : ''}`,
        `The lists in their 360 reporting profile "${prof.name}", last used ${prof.lastUsed}. Profiles not used since ${PROFILES_SINCE} are not carried over.`,
        prof.name,
        true,
      )
    }
  }
  // A user set's restrictions: everyone created from it shares one workspace, as their access today.
  for (const [set, items] of filters) {
    const account = accountOfLegacy.get(`360:${set}`)
    if (!account) continue
    const legacyName = legacy.find((a) => a.key === `360:${set}`)?.name ?? `360 user set ${set}`
    // "* TOTAL US" sits beside a station's market in 360: it is not a market to keep.
    const own = items.map((r) => item360(r, names, matcher, 'Access today')).filter((i) => !(i.entityType === 500 && /^\*\s*total/i.test(i.name)))
    const sets = setsOf(own, (i) => items.find((r) => String(r.id) === i.legacy.id)?.set ?? 'advertisers')
    const marketWs = mode === 'markets' && sets.some((s) => s.set === 'markets')
    for (const [usr, u] of usrOf) {
      const p = people.find((x) => x.key === u.key)
      if (!p?.accounts.some((l) => l.platform === '360' && Number(l.userId) === usr && Number(l.accountId) === set)) continue
      if (marketWs)
        addWs(account, sets, u, `Market: ${legacyName}`, `${legacyName} is limited to its market today. The account gets every market; this workspace keeps its users on theirs.`, legacyName, true)
      else addWs(account, sets, u, `360 access today: ${legacyName}`, `Their 360 user set is limited to these today. Insights Studio gives the account more; this workspace keeps their view where it was.`, legacyName)
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

  // Magnifier saved searches saved or updated in 2026 become Insights Studio saved views, for the users created.
  const savedViews: PlanSavedView[] = []
  const magCodes = [...new Set(groups.flatMap((g) => g.members).filter((a) => a.platform === 'magnifier').map((a) => a.id))]
  if (magCodes.length && mongoUrl()) {
    await progress('Reading Magnifier saved searches (2026)')
    try {
      const owner = new Map<string, PlanUser>()
      for (const u of created)
        for (const l of people.find((p) => p.key === u.key)?.accounts ?? []) if (l.platform === 'magnifier') owner.set(`${l.accountId.trim()}|${String(l.userId).trim()}`.toLowerCase(), u)
      const { searches, namesNote } = await within(FOLLOW_LIMIT, 'Reading Magnifier saved searches', () => accountSearches(magCodes))
      let canadian = 0
      for (const s of searches) {
        const u = owner.get(s.owner)
        if (!u) continue
        // Canada is left out of the analysis (Scott, 24 November 2026).
        if (s.country === 'Canada') {
          canadian++
          continue
        }
        savedViews.push({ key: `V${savedViews.length + 1}`, user: u.key, account: u.account, title: s.title, report: s.report, country: s.country, period: s.period, keyword: s.keyword, shared: s.shared, updated: s.updated ?? s.saved, filters: s.rel.rows, media: s.rel.media })
      }
      if (canadian) notes.push(`${canadian} Magnifier saved ${canadian === 1 ? 'search is' : 'searches are'} on Canadian data and not carried over.`)
      if (namesNote) notes.push(`Some saved-search filters could not be named: ${namesNote}`.slice(0, 200))
    } catch (err) {
      notes.push(`Magnifier saved searches could not be read: ${(err as Error).message}`.slice(0, 200))
    }
  }

  // 360 reports used in 2026, proposed for migration once Insights Studio has a report builder (Scott, 24 November 2026).
  const reports: PlanReport[] = []
  if (usrOf.size) {
    await progress('Reading 360 reports used in 2026')
    try {
      const mine = await within(FOLLOW_LIMIT, 'Reading 360 reports', () => reportsForUsers([...usrOf.keys()]))
      for (const [usr, list] of mine) {
        const u = usrOf.get(usr)
        if (!u) continue
        for (const r of list) reports.push({ key: `R${reports.length + 1}`, user: u.key, account: u.account, name: r.name, type: r.type, lastUsed: r.lastUsed })
      }
      reports.sort((x, y) => (y.lastUsed ?? '').localeCompare(x.lastUsed ?? ''))
    } catch (err) {
      notes.push(`360 reports could not be read: ${(err as Error).message}`.slice(0, 200))
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

  // Merged entities: a match that names one is moved to the entity it went into, or dropped if there is none.
  // Spend never leads to one; a name search or an old cached match can (24 November 2026: 321 cached name matches).
  if (opts.depth === 'full') {
    const entityItems = workspaces.flatMap((w) => w.sets.flatMap((s) => s.items)).filter((i) => i.gpc && GPC_ENTITY_TYPES.has(i.entityType))
    try {
      const merged = await within(FOLLOW_LIMIT, 'Checking for merged entities', () => dbxMergedEntities(entityItems.map((i) => i.gpc!.id)))
      let moved = 0
      for (const i of entityItems) {
        if (!merged.has(i.gpc!.id)) continue
        const to = merged.get(i.gpc!.id)
        moved++
        i.gpc = to ? { ...i.gpc!, id: to.id, name: to.name, how: `${i.gpc!.how}; merged in GPC into this entity` } : null
      }
      if (moved) notes.push(`${moved} matches named an entity merged into another in GPC; they now name the one it went into.`)
    } catch (err) {
      notes.push(`Merged entities could not be checked: ${(err as Error).message}`.slice(0, 200))
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
  // Every medium new to them, all listed, TV, magazines and newspapers each as one (Scott, 24 November 2026).
  const added = rollupMedia(accounts.flatMap((a) => a.coverage.media))
    .filter((m) => m.status === 'added')
    .map((m) => m.name)
  if (added.length) gains.push(`${added.length} ${added.length === 1 ? 'medium' : 'media'} new to them: ${added.join(', ')}.`)
  // Packages added, once for the whole plan, not per account (Scott, 24 November 2026).
  const addedPackages = [...new Set(accounts.flatMap((a) => a.packages.filter((x) => !x.starting).map((x) => x.name)))]
  if (addedPackages.length) gains.push(`${addedPackages.length === 1 ? 'Package' : 'Packages'} added: ${addedPackages.join(', ')}.`)
  if (accounts.some((a) => a.coverage.widened.length)) gains.push('Restrictions on advertisers and categories are lifted: the whole account sees all brands and categories, with workspaces keeping each user’s focus.')
  // Lost: legacy media with nowhere to go, unless Insights Studio's catalogue has it under the same name (Search).
  const withheldAll = new Set(accounts.flatMap((a) => a.coverage.withheld.map((w) => w.name)))
  for (const x of media as Array<{ platform: Platform; change: MediaChange }>) {
    // What the catalogue offers under its own name is kept (Search), not dropped.
    const offeredToo = x.change.dropped.map(catalogName).filter((n): n is string => !!n)
    const gone = x.change.dropped.filter((d) => !catalogName(d))
    x.change.dropped = gone
    if (gone.length) losses.push(`${PLATFORM_LABEL[x.platform]}: ${gone.join(', ')} not in Insights Studio yet.`)
    // Shown rolled up: Linear TV, Magazines, Newspapers. A group they keep is not also "added", and a premium medium
    // they do not get is never "added" (Tinuiti, 25 November 2026: AVOD and Social showed as added here).
    type Names = typeof x.change.kept
    x.change.kept = rollupNames([...x.change.kept, ...offeredToo]) as Names
    x.change.added = rollupNames(x.change.added).filter((n) => !(x.change.kept as string[]).includes(n) && !withheldAll.has(n)) as Names
  }
  for (const a of accounts) {
    const l = a.contract.lookbackYears as { value: number; lost?: number }
    if (l.lost) losses.push(`${a.name}: ${l.value + l.lost} years of history today; Insights Studio keeps ${MAX_HISTORY}, so ${l.lost} ${l.lost === 1 ? 'year is' : 'years are'} lost.`)
  }
  // Premium media they lack are neither gained nor lost, so they are not impact; the plan notes the rule instead.
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
  if (savedViews.length) checklist.push(`Recreate ${savedViews.length} Magnifier saved ${savedViews.length === 1 ? 'search' : 'searches'} from 2026 as Insights Studio saved views; their filters need Insights Studio ids.`)
  if (reports.length) checklist.push(`${reports.length} 360 ${reports.length === 1 ? 'report' : 'reports'} used in 2026 to migrate once Insights Studio's report builder exists.`)
  const dormant = notMigrated.filter((x) => x.why !== 'Inactive today.')
  if (dormant.length) checklist.push(`${dormant.length} ${dormant.length === 1 ? 'account is' : 'accounts are'} flagged active but dormant and not migrated: ${dormant.slice(0, 5).map((x) => x.name).join(', ')}${dormant.length > 5 ? ` and ${dormant.length - 5} more` : ''}. Confirm.`)
  const inactive = notMigrated.length - dormant.length
  if (inactive) checklist.push(`${inactive} inactive legacy ${inactive === 1 ? 'account is' : 'accounts are'} not migrated.`)
  if (mode === 'holding') checklist.push('Set each account’s advertiser and category access in Insights Studio from its limits, so no team sees another’s data (Creative Intel included).')

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
    mode: { kind: mode, why: modeWhy },
    grouping,
    notMigrated,
    workspaces,
    savedViews,
    reports,
    impact: { media, gains, losses, notInV1 },
    checklist,
    review: { verdict: 'check', issues: [], model: splitModel },
    deckFocus,
    notes,
  }
  if (useModel) await review(plan, progress)
  else plan.review.issues.push('The model review did not run.')
  if (!plan.summary.length) plan.summary = computedSummary(plan)
  const premium = premiumNote(accounts)
  if (premium) plan.summary.push(premium)
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
