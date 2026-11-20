/**
 * The client and user export (Scott, 20 November 2026): for the clients a
 * person ticks on the list, every user in each of their accounts and each
 * user's last login across the apps, with the 360 user set and Magnifier
 * account code. An Excel workbook of three sheets:
 *
 *   Clients           one row per client
 *   People            one row per person per client: their accounts across
 *                     the apps, by email, and their latest login anywhere
 *   Users by account  one row per user per platform account
 *
 * Last login: 360's latest login session since 2025, Classic's latest login.
 * Magnifier records none we can read.
 *
 * Only ticked clients: the whole list made a 60 MB file nobody could use
 * (Scott, 20 November 2026), so there is no whole-list export and nothing is
 * kept on the server. A selection is built on request and sent straight back.
 * It still reads users in batches and pauses between them, so a large
 * selection cannot hold the one-core B1 server.
 */
import { PassThrough } from 'node:stream'
import { and, eq, inArray } from 'drizzle-orm'
import ExcelJS from 'exceljs'
import type { Database } from '@/db/client'
import { ceAccounts, ceClients, ceUsers } from '@/db/schema'
import { PLATFORM_LABEL, parseMember, PLATFORMS, type Platform } from './types'

type Progress = (step: string, done?: number, total?: number) => Promise<void>

const ACCOUNT_ID_LABEL: Record<Platform, string> = { '360': '360 user set', classic: 'Classic account', magnifier: 'Magnifier account code' }
const BATCH = 100

/** Give the core back: pause for as long as the last stretch of work took (at least 15 ms). */
async function yieldTo(since: number): Promise<number> {
  const worked = Date.now() - since
  await new Promise((resolve) => setTimeout(resolve, Math.max(15, worked)))
  return Date.now()
}

type UserRow = Pick<typeof ceUsers.$inferSelect, 'platform' | 'accountId' | 'userId' | 'name' | 'login' | 'email' | 'active' | 'lastSeen' | 'reports' | 'profiles' | 'logins30'>

/** The users of these clients' accounts, read per platform. */
async function usersOf(d: Database, clients: Array<{ members: unknown }>): Promise<Map<string, UserRow[]>> {
  const byPlatform = new Map<Platform, string[]>()
  for (const c of clients)
    for (const k of c.members as string[]) {
      const m = parseMember(k)
      if (m) (byPlatform.get(m.platform) ?? byPlatform.set(m.platform, []).get(m.platform)!).push(m.accountId)
    }
  const out = new Map<string, UserRow[]>()
  for (const p of PLATFORMS) {
    const ids = byPlatform.get(p)
    if (!ids?.length) continue
    for (let i = 0; i < ids.length; i += 500) {
      const rows = await d
        .select({ platform: ceUsers.platform, accountId: ceUsers.accountId, userId: ceUsers.userId, name: ceUsers.name, login: ceUsers.login, email: ceUsers.email, active: ceUsers.active, lastSeen: ceUsers.lastSeen, reports: ceUsers.reports, profiles: ceUsers.profiles, logins30: ceUsers.logins30 })
        .from(ceUsers)
        .where(and(eq(ceUsers.platform, p), inArray(ceUsers.accountId, ids.slice(i, i + 500))))
      for (const u of rows) {
        const k = `${u.platform}:${u.accountId}`
        ;(out.get(k) ?? out.set(k, []).get(k)!).push(u)
      }
    }
  }
  return out
}

/** The most clients one export may hold. */
export const EXPORT_MAX = 300

export async function buildExport(d: Database, clientIds: string[], progress: Progress = async () => {}): Promise<Buffer> {
  const ids = [...new Set(clientIds)].slice(0, EXPORT_MAX)
  if (!ids.length) throw new Error('Tick the clients to export.')
  const clients = await d.select().from(ceClients).where(inArray(ceClients.clientId, ids))
  if (!clients.length) throw new Error('Those clients are no longer in the list. It may have changed with a refresh.')
  const accounts: Array<{ platform: string; accountId: string; name: string; active: boolean }> = []
  for (const p of PLATFORMS) {
    const mine = clients.flatMap((c) => (c.members as string[]).map(parseMember)).filter((m): m is NonNullable<ReturnType<typeof parseMember>> => m?.platform === p).map((m) => m.accountId)
    for (let i = 0; i < mine.length; i += 500)
      accounts.push(...(await d.select({ platform: ceAccounts.platform, accountId: ceAccounts.accountId, name: ceAccounts.name, active: ceAccounts.active }).from(ceAccounts).where(and(eq(ceAccounts.platform, p), inArray(ceAccounts.accountId, mine.slice(i, i + 500))))))
  }
  const acct = new Map(accounts.map((a) => [`${a.platform}:${a.accountId}`, a]))
  const sorted = clients.map((c) => ({ c, k: c.name.toLowerCase() })).sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0)).map((x) => x.c)

  const out = new PassThrough()
  const chunks: Buffer[] = []
  out.on('data', (c: Buffer) => chunks.push(c))
  const ended = new Promise<void>((resolve, reject) => {
    out.on('end', resolve)
    out.on('error', reject)
  })
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: out, useStyles: true, useSharedStrings: false })
  const head = (ws: ExcelJS.Worksheet) => {
    ws.getRow(1).font = { bold: true }
    ws.getRow(1).commit()
  }
  let t = Date.now()

  // Clients
  await progress('Writing clients', 0, sorted.length)
  const wc = wb.addWorksheet('Clients', { views: [{ state: 'frozen', ySplit: 1 }] })
  wc.columns = [
    { header: 'Client', key: 'client', width: 40 },
    { header: 'Platforms', key: 'platforms', width: 22 },
    { header: 'Active', key: 'active', width: 8 },
    { header: 'Internal', key: 'internal', width: 9 },
    { header: 'People', key: 'users', width: 9 },
    { header: 'Active people', key: 'activeUsers', width: 13 },
    { header: '360 reports (2026)', key: 'reports', width: 17 },
    { header: 'Accounts', key: 'accounts', width: 9 },
    { header: '360 company', key: 'company', width: 30 },
    { header: '360 user sets', key: 'sets', width: 50 },
    { header: 'Magnifier accounts', key: 'mag', width: 50 },
    { header: 'Classic accounts', key: 'classic', width: 50 },
  ]
  head(wc)
  const list = (c: (typeof clients)[number], p: Platform) =>
    (c.members as string[])
      .map(parseMember)
      .filter((m): m is NonNullable<typeof m> => m?.platform === p)
      .map((m) => `${acct.get(`${p}:${m.accountId}`)?.name ?? ''} (${m.accountId.trim()})`)
      .join('; ')
  for (const [i, c] of sorted.entries()) {
    wc.addRow({
      client: c.name,
      platforms: (c.platforms as Platform[]).map((p) => PLATFORM_LABEL[p]).join(', '),
      active: c.active ? 'Yes' : 'No',
      internal: c.internal ? 'Yes' : '',
      users: c.users,
      activeUsers: c.activeUsers,
      reports: c.reports,
      accounts: (c.members as string[]).length,
      company: c.company ?? '',
      sets: list(c, '360'),
      mag: list(c, 'magnifier'),
      classic: list(c, 'classic'),
    }).commit()
    if (i % 1000 === 999) {
      t = await yieldTo(t)
    }
  }
  await wc.commit()

  // People: one per person per client, by email.
  const wp = wb.addWorksheet('People', { views: [{ state: 'frozen', ySplit: 1 }] })
  wp.columns = [
    { header: 'Client', key: 'client', width: 36 },
    { header: 'Person', key: 'name', width: 28 },
    { header: 'Email', key: 'email', width: 34 },
    { header: 'Active', key: 'active', width: 8 },
    { header: 'Platforms', key: 'platforms', width: 22 },
    { header: 'Last login (any app)', key: 'last', width: 18 },
    { header: 'Logins, last 30 days', key: 'logins30', width: 18 },
    { header: 'Last login 360', key: 'last360', width: 15 },
    { header: 'Last login Classic', key: 'lastClassic', width: 17 },
    { header: '360 user sets', key: 'sets', width: 40 },
    { header: '360 logins', key: 'logins', width: 28 },
    { header: 'Magnifier account codes', key: 'mag', width: 30 },
    { header: 'Classic account ids', key: 'classic', width: 20 },
    { header: '360 reports (2026)', key: 'reports', width: 17 },
    { header: '360 reporting profiles', key: 'profiles', width: 20 },
  ]
  head(wp)
  for (let b = 0; b < sorted.length; b += BATCH) {
    await progress('Writing people', b, sorted.length)
    const part = sorted.slice(b, b + BATCH)
    const users = await usersOf(d, part)
    for (const c of part) {
      const people = new Map<string, { name: string; email: string | null; active: boolean; platforms: Set<Platform>; last: string; last360: string; lastClassic: string; sets: Set<string>; logins: Set<string>; mag: Set<string>; classic: Set<string>; reports: number; profiles: number; recent: Map<string, number> }>()
      for (const k of c.members as string[])
        for (const u of users.get(k) ?? []) {
          const p = u.platform as Platform
          const key = u.email || `${p}:${u.userId}`
          const x =
            people.get(key) ??
            people
              .set(key, { name: u.name, email: u.email, active: false, platforms: new Set(), last: '', last360: '', lastClassic: '', sets: new Set(), logins: new Set(), mag: new Set(), classic: new Set(), reports: 0, profiles: 0, recent: new Map() })
              .get(key)!
          x.active ||= u.active
          // One login on several 360 user sets is one set of sessions: the busiest counts.
          if (u.logins30) {
            const lk = `${p}:${(u.login ?? u.userId).toLowerCase()}`
            x.recent.set(lk, Math.max(x.recent.get(lk) ?? 0, u.logins30))
          }
          x.platforms.add(p)
          const seen = u.lastSeen ?? ''
          if (seen > x.last) x.last = seen
          if (p === '360') {
            if (seen > x.last360) x.last360 = seen
            x.sets.add(`${acct.get(k)?.name ?? ''} (${u.accountId})`)
            if (u.login) x.logins.add(u.login)
            x.reports += u.reports
            x.profiles += u.profiles
          } else if (p === 'magnifier') x.mag.add(u.accountId.trim())
          else {
            if (seen > x.lastClassic) x.lastClassic = seen
            x.classic.add(u.accountId)
          }
        }
      for (const x of [...people.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)))
        wp.addRow({
          client: c.name,
          name: x.name,
          email: x.email ?? '',
          active: x.active ? 'Yes' : 'No',
          platforms: [...x.platforms].map((p) => PLATFORM_LABEL[p]).join(', '),
          last: x.last,
          logins30: [...x.recent.values()].reduce((a, b) => a + b, 0) || '',
          last360: x.last360,
          lastClassic: x.lastClassic,
          sets: [...x.sets].join('; '),
          logins: [...x.logins].join('; '),
          mag: [...x.mag].join('; '),
          classic: [...x.classic].join('; '),
          reports: x.reports || '',
          profiles: x.profiles || '',
        }).commit()
    }
    t = await yieldTo(t)
  }
  await wp.commit()

  // Users by account
  const wu = wb.addWorksheet('Users by account', { views: [{ state: 'frozen', ySplit: 1 }] })
  wu.columns = [
    { header: 'Client', key: 'client', width: 36 },
    { header: 'Platform', key: 'platform', width: 11 },
    { header: 'Account id', key: 'accountId', width: 16 },
    { header: 'Account id is', key: 'idKind', width: 22 },
    { header: 'Account', key: 'account', width: 36 },
    { header: 'Account active', key: 'accountActive', width: 14 },
    { header: 'User id', key: 'userId', width: 12 },
    { header: 'Login', key: 'login', width: 28 },
    { header: 'Name', key: 'name', width: 28 },
    { header: 'Email', key: 'email', width: 34 },
    { header: 'User active', key: 'active', width: 11 },
    { header: 'Last login', key: 'last', width: 12 },
    { header: 'Logins, last 30 days', key: 'logins30', width: 18 },
    { header: '360 reports (2026)', key: 'reports', width: 17 },
    { header: '360 reporting profiles', key: 'profiles', width: 20 },
  ]
  head(wu)
  for (let b = 0; b < sorted.length; b += BATCH) {
    await progress('Writing users by account', b, sorted.length)
    const part = sorted.slice(b, b + BATCH)
    const users = await usersOf(d, part)
    for (const c of part)
      for (const k of c.members as string[]) {
        const a = acct.get(k)
        const list = (users.get(k) ?? []).sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0))
        for (const u of list) {
          const p = u.platform as Platform
          wu.addRow({
            client: c.name,
            platform: PLATFORM_LABEL[p],
            accountId: u.accountId.trim(),
            idKind: ACCOUNT_ID_LABEL[p],
            account: a?.name ?? '',
            accountActive: a?.active ? 'Yes' : 'No',
            userId: u.userId.trim(),
            login: u.login ?? '',
            name: u.name,
            email: u.email ?? '',
            active: u.active ? 'Yes' : 'No',
            last: u.lastSeen ?? (p === 'magnifier' ? 'not recorded' : ''),
            logins30: p === 'magnifier' ? '' : u.logins30,
            reports: p === '360' ? u.reports : '',
            profiles: p === '360' ? u.profiles : '',
          }).commit()
        }
      }
    t = await yieldTo(t)
  }
  await wu.commit()

  const wn = wb.addWorksheet('Notes')
  wn.columns = [{ header: 'About this export', key: 't', width: 120 }]
  for (const text of [
    `Exported ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC from the Client Evaluation snapshots: ${sorted.length} selected client${sorted.length === 1 ? '' : 's'}.`,
    'Last login: 360 is the latest login session since January 2025; Classic is the latest entry in its login history; Magnifier does not record logins in the tables we can read. Logins, last 30 days: as of the snapshot.',
    'People: one row per person per client, matched by email across the apps; a user with no email is their own row.',
    'Account ids: 360 user set id, Magnifier account code, Classic customer account id.',
  ])
    wn.addRow({ t: text }).commit()
  await wn.commit()

  await progress('Finishing the workbook', sorted.length, sorted.length)
  await wb.commit()
  await ended
  return Buffer.concat(chunks)
}
