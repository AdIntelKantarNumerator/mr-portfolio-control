/**
 * Client Evaluation's snapshots: saving a platform's, building the one client
 * list from all three, and reading them for the page. Takes the database as an
 * argument so the laptop script (scripts/load-client-eval.ts) shares it.
 */
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { ceAccounts, ceClients, ceJudgments, ceOverrides, ceReports, ceSources, ceUsers } from '@/db/schema'
import { completeJson } from '@/lib/llm'
import { clientIdOf, clientName, cluster, isCanadian, isInternal, links, type Ask, type Link, type MatchAccount, type Override } from './match'
import { memberKey, parseMember, PLATFORMS, type Entitlements, type Platform, type Snapshot } from './types'

const BATCH = 800

const domainOf = (email: string | null) => {
  const m = email ? /@([^@\s]+)$/.exec(email) : null
  return m ? m[1]!.toLowerCase() : null
}

/** Progress for the page, written at most every second or so. */
export function progressWriter(d: Database, platform: Platform) {
  let last = 0
  return async (step: string, done = 0, total = 0) => {
    const now = Date.now()
    if (now - last < 800 && done < total) return
    last = now
    await d.update(ceSources).set({ step, done, total }).where(eq(ceSources.platform, platform))
  }
}

export async function markRunning(d: Database, platform: Platform, by: string | null): Promise<boolean> {
  const [cur] = await d.select().from(ceSources).where(eq(ceSources.platform, platform)).limit(1)
  // A refresh that has said nothing for 20 minutes died with its process; another may start.
  if (cur?.status === 'running' && cur.startedAt && Date.now() - cur.startedAt.getTime() < 20 * 60_000) return false
  const row = { platform, status: 'running', step: 'Starting', done: 0, total: 0, startedAt: new Date(), error: null, loadedBy: by }
  await d.insert(ceSources).values(row).onConflictDoUpdate({ target: ceSources.platform, set: row })
  return true
}

export async function markReady(d: Database, platform: Platform) {
  await d.update(ceSources).set({ status: 'ready', step: null }).where(eq(ceSources.platform, platform))
}

export async function markFailed(d: Database, platform: Platform, err: unknown) {
  const e = ((err as { cause?: Error })?.cause ?? err) as Error
  await d.update(ceSources).set({ status: 'failed', error: String(e?.message ?? e).slice(0, 500) }).where(eq(ceSources.platform, platform))
}

/**
 * Replace one platform's snapshot whole. With `rebuilding`, the platform stays "running" while the
 * caller rebuilds the client list, so the page does not reload the list before it is ready.
 */
export async function saveSnapshot(d: Database, platform: Platform, snap: Snapshot, by: string | null, opts: { rebuilding?: boolean } = {}) {
  const tally = new Map<string, { users: number; active: number; domains: Record<string, number> }>()
  for (const u of snap.users) {
    const t = tally.get(u.accountId) ?? tally.set(u.accountId, { users: 0, active: 0, domains: {} }).get(u.accountId)!
    t.users++
    if (u.active) t.active++
    const dom = domainOf(u.email)
    if (dom) t.domains[dom] = (t.domains[dom] ?? 0) + 1
  }
  await d.transaction(async (tx) => {
    await tx.delete(ceUsers).where(eq(ceUsers.platform, platform))
    await tx.delete(ceReports).where(eq(ceReports.platform, platform))
    await tx.delete(ceAccounts).where(eq(ceAccounts.platform, platform))
    for (let i = 0; i < snap.accounts.length; i += BATCH)
      await tx.insert(ceAccounts).values(
        snap.accounts.slice(i, i + BATCH).map((a) => {
          const t = tally.get(a.accountId)
          return { platform, accountId: a.accountId, name: a.name, company: a.company, active: a.active, users: t?.users ?? 0, activeUsers: t?.active ?? 0, reports: a.reports, domains: t?.domains ?? {}, summary: a.summary, entitlements: a.entitlements, info: a.info }
        }),
      )
    const known = new Set(snap.accounts.map((a) => a.accountId))
    const users = snap.users.filter((u) => known.has(u.accountId))
    for (let i = 0; i < users.length; i += BATCH) await tx.insert(ceUsers).values(users.slice(i, i + BATCH).map((u) => ({ platform, ...u })))
    const reports = snap.reports.filter((r) => known.has(r.accountId))
    for (let i = 0; i < reports.length; i += 200) await tx.insert(ceReports).values(reports.slice(i, i + 200).map((r) => ({ platform, ...r }))).onConflictDoNothing()
    const row = {
      platform,
      status: opts.rebuilding ? 'running' : 'ready',
      step: opts.rebuilding ? 'Rebuilding the client list' : null,
      done: 0,
      total: 0,
      loadedAt: new Date(),
      loadedBy: by,
      error: null,
      counts: { accounts: snap.accounts.length, active: snap.accounts.filter((a) => a.active).length, users: users.length, activeUsers: users.filter((u) => u.active).length, reports: platform === '360' ? snap.accounts.reduce((s, a) => s + a.reports, 0) : reports.length },
    }
    await tx.insert(ceSources).values(row).onConflictDoUpdate({ target: ceSources.platform, set: row })
  })
}

// ------------------------------------------------------------------ the one client list

const MODEL_BATCH = 40
/** At most this many new pairs go to the model per build; the rest wait for the next one. */
const MODEL_PER_BUILD = 600

const SYSTEM = `You decide whether two client accounts on different MediaRadar products belong to the same client company.
Products: 360 (ad-spend analytics), Classic (publisher sales intelligence) and Magnifier (creative and ad tracking).
The same company often has differently worded account names across products, and an agency may hold accounts named after the brands it buys for.
Say "same" only when the two are the same company or the same agency office. Different brands of one parent are the same only if the names show the parent.
Reply with JSON only: {"answers":[{"i":<pair number>,"same":true|false,"why":"<under 12 words>"}]}`

async function judge(d: Database, asks: Ask[], byKey: Map<string, MatchAccount>, onProgress?: (done: number, total: number) => Promise<void> | void): Promise<number> {
  const known = new Set((await d.select({ pair: ceJudgments.pair }).from(ceJudgments)).map((r) => r.pair))
  const todo = asks.filter((a) => !known.has(`${a.a}|${a.b}`)).slice(0, MODEL_PER_BUILD)
  let asked = 0
  for (let i = 0; i < todo.length; i += MODEL_BATCH) {
    const part = todo.slice(i, i + MODEL_BATCH)
    const describe = (k: string) => {
      const a = byKey.get(k)!
      const doms = Object.entries(a.domains).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([x]) => x)
      return `${a.platform}: "${a.name}"${a.company ? ` (company "${a.company}")` : ''}${doms.length ? `, users at ${doms.join(', ')}` : ''}`
    }
    const prompt = part.map((p, j) => `${j}. ${describe(p.a)}  |  ${describe(p.b)}  [${p.why}]`).join('\n')
    try {
      const { text } = await completeJson(SYSTEM, prompt, { maxTokens: 3000 })
      const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as { answers?: Array<{ i: number; same: boolean; why?: string }> }
      const rows = (json.answers ?? [])
        .filter((x) => Number.isInteger(x.i) && part[x.i])
        .map((x) => ({ pair: `${part[x.i]!.a}|${part[x.i]!.b}`, same: x.same === true, why: String(x.why ?? '').slice(0, 200) || null }))
      if (rows.length) await d.insert(ceJudgments).values(rows).onConflictDoNothing()
      asked += rows.length
    } catch {
      // No model, or a reply that is not JSON: these pairs stay apart until the next build.
      break
    }
    await onProgress?.(Math.min(i + MODEL_BATCH, todo.length), todo.length)
  }
  return asked
}

/** Rebuild ce_clients from the snapshots, the model's verdicts and people's merges and splits. */
export async function buildClients(d: Database, opts: { useModel?: boolean; progress?: (step: string, done?: number, total?: number) => Promise<void> | void } = {}) {
  const accts = await d
    .select({ platform: ceAccounts.platform, accountId: ceAccounts.accountId, name: ceAccounts.name, company: ceAccounts.company, domains: ceAccounts.domains, users: ceAccounts.users, active: ceAccounts.active, reports: ceAccounts.reports, entitlements: ceAccounts.entitlements })
    .from(ceAccounts)
  const match: MatchAccount[] = accts.map((a) => ({ key: memberKey(a.platform as Platform, a.accountId), platform: a.platform as Platform, name: a.name, company: a.company, domains: (a.domains ?? {}) as Record<string, number>, users: a.users }))
  const byKey = new Map(match.map((m) => [m.key, m]))
  await opts.progress?.('Matching clients across platforms')
  const found = links(match)
  // Our own accounts (staff, demo, development) join only each other: a demo account under a client's
  // license group would otherwise make the client look internal, or the internal group look like a client.
  const internal = new Set(match.filter(isInternal).map((m) => m.key))
  // Canadian accounts join only each other too (Scott, 24 November 2026): a client is Canadian or not, so leaving
  // Canada out of the analysis leaves no Canadian account inside another client's counts or plan.
  const canadian = new Set(accts.filter((a) => isCanadian(a.entitlements as Entitlements | null, a.name)).map((a) => memberKey(a.platform as Platform, a.accountId)))
  const apart = (l: { a: string; b: string }) => internal.has(l.a) !== internal.has(l.b) || canadian.has(l.a) !== canadian.has(l.b)
  found.links = found.links.filter((l) => !apart(l))
  found.ask = found.ask.filter((l) => !apart(l))
  if (opts.useModel !== false && found.ask.length) await judge(d, found.ask, byKey, (done, total) => opts.progress?.('Asking the model about close calls', done, total))
  const judgments = new Map((await d.select().from(ceJudgments)).map((j) => [j.pair, { same: j.same, why: j.why }]))
  const overrides: Override[] = (await d.select().from(ceOverrides).orderBy(ceOverrides.at, ceOverrides.id)).map((o) => ({ kind: o.kind === 'merge' ? 'merge' : 'split', member: o.member, withMember: o.withMember }))
  const clusters = cluster(match.map((m) => m.key), found.links, judgments, found.ask, overrides)

  await opts.progress?.('Counting people across platforms')
  const people = await d.select({ platform: ceUsers.platform, accountId: ceUsers.accountId, userId: ceUsers.userId, email: ceUsers.email, login: ceUsers.login, active: ceUsers.active, reports: ceUsers.reports, logins30: ceUsers.logins30 }).from(ceUsers)
  const usersOf = new Map<string, typeof people>()
  for (const p of people) {
    const k = memberKey(p.platform as Platform, p.accountId)
    ;(usersOf.get(k) ?? usersOf.set(k, []).get(k)!).push(p)
  }
  const acctOf = new Map(accts.map((a) => [memberKey(a.platform as Platform, a.accountId), a]))
  const PREF: Record<string, number> = { '360': 0, magnifier: 1, classic: 2 }

  const rows = clusters.map((c) => {
    const members = c.members.map((k) => acctOf.get(k)!).filter(Boolean)
    const named = [...members].sort((a, b) => PREF[a.platform]! - PREF[b.platform]! || Number(b.active) - Number(a.active) || b.users - a.users)[0]!
    const companies = new Map<string, number>()
    for (const m of members) if (m.company) companies.set(m.company, (companies.get(m.company) ?? 0) + m.users)
    const company = [...companies].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
    const everyone = new Map<string, boolean>()
    let reports = 0
    let magSearches = 0
    // Recent logins: one login on two 360 user sets is one person's sessions, counted once.
    const logins = new Map<string, number>()
    for (const k of c.members)
      for (const u of usersOf.get(k) ?? []) {
        const who = u.email || `${u.platform}:${u.userId}`
        everyone.set(who, everyone.get(who) === true || u.active)
        if (u.platform === '360') reports += u.reports
        else if (u.platform === 'magnifier') magSearches += u.reports
        if (u.logins30) {
          const key = `${u.platform}:${(u.login ?? u.userId).toLowerCase()}`
          logins.set(key, Math.max(logins.get(key) ?? 0, u.logins30))
        }
      }
    return {
      clientId: clientIdOf(c.members),
      // The biggest account's name, tags off. 360's license-group names are often a holding company's
      // or an old one ("MPG" for Havas), so they are shown beside it rather than used.
      name: clientName(named, members),
      company,
      internal: c.members.every((k) => internal.has(k)),
      canada: c.members.every((k) => canadian.has(k)),
      members: c.members,
      platforms: [...new Set(members.map((m) => m.platform))].sort((a, b) => PREF[a]! - PREF[b]!),
      users: everyone.size,
      activeUsers: [...everyone.values()].filter(Boolean).length,
      reports,
      logins30: [...logins.values()].reduce((a, b) => a + b, 0),
      magSearches,
      active: members.some((m) => m.active),
      how: c.how as Link[],
    }
  })
  await opts.progress?.('Saving the client list')
  await d.transaction(async (tx) => {
    await tx.delete(ceClients)
    for (let i = 0; i < rows.length; i += BATCH) await tx.insert(ceClients).values(rows.slice(i, i + BATCH))
  })
  return { clients: rows.length, asked: found.ask.length }
}

// ------------------------------------------------------------------ reading, for the page

export interface SourceInfo {
  platform: Platform
  status: string
  step: string | null
  done: number
  total: number
  loadedAt: string | null
  loadedBy: string | null
  error: string | null
  counts: Record<string, number> | null
}

export async function sources(d: Database): Promise<SourceInfo[]> {
  const rows = await d.select().from(ceSources)
  return PLATFORMS.map((p) => {
    const r = rows.find((x) => x.platform === p)
    const stale = r?.status === 'running' && r.startedAt && Date.now() - r.startedAt.getTime() > 20 * 60_000
    return {
      platform: p,
      status: stale ? 'failed' : (r?.status ?? 'empty'),
      step: r?.step ?? null,
      done: r?.done ?? 0,
      total: r?.total ?? 0,
      loadedAt: r?.loadedAt?.toISOString() ?? null,
      loadedBy: r?.loadedBy ?? null,
      error: stale ? 'The refresh stopped without finishing.' : (r?.error ?? null),
      counts: (r?.counts as Record<string, number> | null) ?? null,
    }
  })
}

export interface ClientRow {
  id: string
  name: string
  platforms: Platform[]
  users: number
  activeUsers: number
  /** 360 reports used in 2026. */
  reports: number
  /** Logins in the last 30 days across its people (360 and Classic). */
  logins30: number
  /** Distinct Magnifier reports set up across the client's Magnifier accounts (one report can be on several). */
  magnifierReports: number
  /** Magnifier saved searches saved or updated in 2026. */
  magnifierSearches: number
  active: boolean
  internal: boolean
  canada: boolean
  company: string | null
  members: Array<{ key: string; platform: Platform; accountId: string; name: string; active: boolean; users: number; activeUsers: number; reports: number; summary: string | null }>
  how: Link[]
}

export async function listClients(
  d: Database,
  o: { q?: string; platform?: Platform | 'all' | 'multi'; sort?: 'reports' | 'name' | 'users' | 'logins'; active?: boolean; internal?: boolean; canada?: boolean; limit?: number; offset?: number },
): Promise<{ rows: ClientRow[]; total: number }> {
  const all = await d.select().from(ceClients)
  const needle = (o.q ?? '').trim().toLowerCase()
  const accts = await d.select({ platform: ceAccounts.platform, accountId: ceAccounts.accountId, name: ceAccounts.name, company: ceAccounts.company, active: ceAccounts.active, users: ceAccounts.users, activeUsers: ceAccounts.activeUsers, reports: ceAccounts.reports, summary: ceAccounts.summary }).from(ceAccounts)
  const acct = new Map(accts.map((a) => [memberKey(a.platform as Platform, a.accountId), a]))
  const mreports = new Map<string, string[]>()
  for (const r of await d.select({ accountId: ceReports.accountId, reportId: ceReports.reportId }).from(ceReports).where(eq(ceReports.platform, 'magnifier')))
    (mreports.get(r.accountId) ?? mreports.set(r.accountId, []).get(r.accountId)!).push(r.reportId)
  const magnifierOf = (members: string[]) => {
    const ids = new Set<string>()
    for (const k of members) {
      const m = parseMember(k)
      if (m?.platform === 'magnifier') for (const id of mreports.get(m.accountId) ?? []) ids.add(id)
    }
    return ids.size
  }
  const mcount = new Map(all.map((c) => [c.clientId, magnifierOf(c.members as string[])]))
  let rows = all.filter((c) => {
    const ps = c.platforms as Platform[]
    if (o.platform === 'multi' ? ps.length < 2 : o.platform && o.platform !== 'all' && !ps.includes(o.platform)) return false
    if (o.active && !c.active) return false
    if (!o.internal && c.internal) return false
    if (!o.canada && c.canada) return false
    if (!needle) return true
    if (c.name.toLowerCase().includes(needle) || (c.company ?? '').toLowerCase().includes(needle)) return true
    return (c.members as string[]).some((k) => {
      const a = acct.get(k)
      return !!a && (a.name.toLowerCase().includes(needle) || (a.company ?? '').toLowerCase().includes(needle) || a.accountId.toLowerCase() === needle)
    })
  })
  const sort = o.sort ?? 'reports'
  rows = rows.sort((a, b) =>
    sort === 'name' ? a.name.localeCompare(b.name) : sort === 'logins' ? b.logins30 - a.logins30 || b.activeUsers - a.activeUsers || a.name.localeCompare(b.name) : sort === 'users' ? b.users - a.users || a.name.localeCompare(b.name) : b.reports - a.reports || b.magSearches - a.magSearches || mcount.get(b.clientId)! - mcount.get(a.clientId)! || b.activeUsers - a.activeUsers || a.name.localeCompare(b.name),
  )
  const total = rows.length
  const page = rows.slice(o.offset ?? 0, (o.offset ?? 0) + (o.limit ?? 100))
  return {
    total,
    rows: page.map((c) => ({
      id: c.clientId,
      name: c.name,
      platforms: c.platforms as Platform[],
      users: c.users,
      activeUsers: c.activeUsers,
      reports: c.reports,
      logins30: c.logins30,
      magnifierReports: mcount.get(c.clientId) ?? 0,
      magnifierSearches: c.magSearches,
      active: c.active,
      internal: c.internal,
      canada: c.canada,
      company: c.company,
      how: c.how as Link[],
      members: (c.members as string[])
        .map((k) => {
          const a = acct.get(k)
          const m = parseMember(k)!
          return { key: k, platform: m.platform, accountId: m.accountId, name: a?.name ?? k, active: a?.active ?? false, users: a?.users ?? 0, activeUsers: a?.activeUsers ?? 0, reports: a?.reports ?? 0, summary: a?.summary ?? null }
        })
        .sort((x, y) => PLATFORMS.indexOf(x.platform) - PLATFORMS.indexOf(y.platform) || y.reports - x.reports || y.activeUsers - x.activeUsers || y.users - x.users),
    })),
  }
}

/** One account's entitlement detail and facts, for the popup. */
export async function accountDetail(d: Database, key: string) {
  const m = parseMember(key)
  if (!m) return null
  const [a] = await d.select().from(ceAccounts).where(and(eq(ceAccounts.platform, m.platform), eq(ceAccounts.accountId, m.accountId))).limit(1)
  if (!a) return null
  const reports = m.platform === 'magnifier' ? await d.select().from(ceReports).where(and(eq(ceReports.platform, m.platform), eq(ceReports.accountId, m.accountId))) : []
  return { key, platform: m.platform, accountId: a.accountId, name: a.name, company: a.company, active: a.active, users: a.users, activeUsers: a.activeUsers, reports: a.reports, summary: a.summary, entitlements: a.entitlements, info: a.info, magnifierReports: reports.map((r) => ({ id: r.reportId, name: r.name, kind: r.kind, detail: r.detail })) }
}

export interface PersonRow {
  /** Email, or "platform:user id" for someone without one. */
  key: string
  name: string
  email: string | null
  active: boolean
  reports: number
  /** Logins in the last 30 days, 360 and Classic together. */
  logins30: number
  lastSeen: string | null
  /** The earliest creation date across their applications (Classic: first login). */
  created: string | null
  /** reports: 360 reports this person used in 2026. accountReports: the reports set up for the account (Magnifier). */
  accounts: Array<{ platform: Platform; accountId: string; accountName: string; userId: string; login: string | null; active: boolean; reports: number; accountReports: number; profiles: number; logins30: number; lastSeen: string | null; created: string | null }>
}

/** A client's people across its platforms, one row per person (by email). */
export async function clientPeople(d: Database, clientId: string): Promise<{ name: string; people: PersonRow[] } | null> {
  const [c] = await d.select().from(ceClients).where(eq(ceClients.clientId, clientId)).limit(1)
  if (!c) return null
  const members = (c.members as string[]).map(parseMember).filter((m): m is NonNullable<typeof m> => !!m)
  const people = new Map<string, PersonRow>()
  for (const p of PLATFORMS) {
    const ids = members.filter((m) => m.platform === p).map((m) => m.accountId)
    if (!ids.length) continue
    const acctRows = await d.select({ id: ceAccounts.accountId, name: ceAccounts.name, reports: ceAccounts.reports }).from(ceAccounts).where(and(eq(ceAccounts.platform, p), inArray(ceAccounts.accountId, ids)))
    const names = new Map(acctRows.map((r) => [r.id, r.name]))
    const acctReports = new Map(acctRows.map((r) => [r.id, p === 'magnifier' ? r.reports : 0]))
    for (const part of chunk(ids, 500))
      for (const u of await d.select().from(ceUsers).where(and(eq(ceUsers.platform, p), inArray(ceUsers.accountId, part)))) {
        const key = u.email || `${p}:${u.userId}`
        const row = people.get(key) ?? people.set(key, { key, name: u.name, email: u.email, active: false, reports: 0, logins30: 0, lastSeen: null, created: null, accounts: [] }).get(key)!
        row.active ||= u.active
        row.reports += u.reports
        if (u.lastSeen && (!row.lastSeen || u.lastSeen > row.lastSeen)) row.lastSeen = u.lastSeen
        if (u.created && (!row.created || u.created < row.created)) row.created = u.created
        if (row.name === row.email && u.name !== u.email) row.name = u.name
        row.accounts.push({ platform: p, accountId: u.accountId, accountName: names.get(u.accountId) ?? u.accountId, userId: u.userId, login: u.login, active: u.active, reports: u.reports, accountReports: acctReports.get(u.accountId) ?? 0, profiles: u.profiles, logins30: u.logins30, lastSeen: u.lastSeen, created: u.created })
      }
  }
  // A person's recent logins: per platform, their busiest login (one login can sit on several user sets), added up.
  for (const p of people.values()) {
    const best = new Map<string, number>()
    for (const a of p.accounts) {
      const k = `${a.platform}:${(a.login ?? a.userId).toLowerCase()}`
      best.set(k, Math.max(best.get(k) ?? 0, a.logins30))
    }
    p.logins30 = [...best.values()].reduce((x, y) => x + y, 0)
  }
  return { name: c.name, people: [...people.values()] }
}

const chunk = <T>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n))

/** A merge or split made on the page. Applied straight away, and kept for every later build. */
export async function addOverride(d: Database, o: { kind: 'merge' | 'split'; member: string; withMember?: string | null; by: string | null }) {
  if (!parseMember(o.member) || (o.kind === 'merge' && !parseMember(o.withMember ?? ''))) throw new Error('Unknown account.')
  await d.insert(ceOverrides).values({ kind: o.kind, member: o.member, withMember: o.kind === 'merge' ? o.withMember! : null, by: o.by })
  return buildClients(d, { useModel: false })
}

export async function overrideCount(d: Database): Promise<number> {
  const [r] = await d.select({ n: sql<number>`count(*)::int` }).from(ceOverrides)
  return r?.n ?? 0
}
