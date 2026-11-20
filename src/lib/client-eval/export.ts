/**
 * The client and user export (Scott, 20 November 2026): every client, every
 * user in each of its accounts, and each user's last login across the apps,
 * with the 360 user set and Magnifier account code. From the snapshots, as an
 * Excel workbook of three sheets:
 *
 *   Clients           one row per client (the consolidated list)
 *   People            one row per person per client: their accounts across
 *                     the apps, by email, and their latest login anywhere
 *   Users by account  one row per user per platform account
 *
 * Last login: 360's latest login session since 2025, Classic's latest login.
 * Magnifier records none we can read.
 */
import { PassThrough } from 'node:stream'
import ExcelJS from 'exceljs'
import type { Database } from '@/db/client'
import { ceAccounts, ceClients, ceUsers } from '@/db/schema'
import { PLATFORM_LABEL, parseMember, type Platform } from './types'

type Progress = (step: string, done?: number, total?: number) => Promise<void>

const ACCOUNT_ID_LABEL: Record<Platform, string> = { '360': '360 user set', classic: 'Classic account', magnifier: 'Magnifier account code' }

export async function buildExport(d: Database, progress: Progress): Promise<Buffer> {
  await progress('Reading clients and accounts')
  const clients = await d.select().from(ceClients)
  const accounts = await d.select({ platform: ceAccounts.platform, accountId: ceAccounts.accountId, name: ceAccounts.name, company: ceAccounts.company, active: ceAccounts.active, reports: ceAccounts.reports }).from(ceAccounts)
  const acct = new Map(accounts.map((a) => [`${a.platform}:${a.accountId}`, a]))
  await progress('Reading users')
  const users = await d.select().from(ceUsers)
  const usersOf = new Map<string, typeof users>()
  for (const u of users) {
    const k = `${u.platform}:${u.accountId}`
    ;(usersOf.get(k) ?? usersOf.set(k, []).get(k)!).push(u)
  }
  const clientOf = new Map<string, (typeof clients)[number]>()
  for (const c of clients) for (const k of c.members as string[]) clientOf.set(k, c)

  const out = new PassThrough()
  const chunks: Buffer[] = []
  out.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<void>((resolve, reject) => {
    out.on('end', resolve)
    out.on('error', reject)
  })
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: out, useStyles: true })
  const head = (ws: ExcelJS.Worksheet) => {
    ws.getRow(1).font = { bold: true }
    ws.getRow(1).commit()
  }
  const sorted = [...clients].sort((a, b) => a.name.localeCompare(b.name))

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
  for (const c of sorted)
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
  await wc.commit()

  // People: one per person per client, by email.
  await progress('Writing people', 0, sorted.length)
  const wp = wb.addWorksheet('People', { views: [{ state: 'frozen', ySplit: 1 }] })
  wp.columns = [
    { header: 'Client', key: 'client', width: 36 },
    { header: 'Person', key: 'name', width: 28 },
    { header: 'Email', key: 'email', width: 34 },
    { header: 'Active', key: 'active', width: 8 },
    { header: 'Platforms', key: 'platforms', width: 22 },
    { header: 'Last login (any app)', key: 'last', width: 18 },
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
  let i = 0
  for (const c of sorted) {
    if (++i % 500 === 0) await progress('Writing people', i, sorted.length)
    const people = new Map<string, { name: string; email: string | null; active: boolean; platforms: Set<Platform>; last: string; last360: string; lastClassic: string; sets: Set<string>; logins: Set<string>; mag: Set<string>; classic: Set<string>; reports: number; profiles: number }>()
    for (const k of c.members as string[]) {
      for (const u of usersOf.get(k) ?? []) {
        const p = u.platform as Platform
        const key = u.email || `${p}:${u.userId}`
        const x =
          people.get(key) ??
          people
            .set(key, { name: u.name, email: u.email, active: false, platforms: new Set(), last: '', last360: '', lastClassic: '', sets: new Set(), logins: new Set(), mag: new Set(), classic: new Set(), reports: 0, profiles: 0 })
            .get(key)!
        x.active ||= u.active
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
    }
    for (const x of [...people.values()].sort((a, b) => a.name.localeCompare(b.name)))
      wp.addRow({
        client: c.name,
        name: x.name,
        email: x.email ?? '',
        active: x.active ? 'Yes' : 'No',
        platforms: [...x.platforms].map((p) => PLATFORM_LABEL[p]).join(', '),
        last: x.last,
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
  await wp.commit()

  // Users by account
  await progress('Writing users by account', 0, users.length)
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
    { header: '360 reports (2026)', key: 'reports', width: 17 },
    { header: '360 reporting profiles', key: 'profiles', width: 20 },
  ]
  head(wu)
  let n = 0
  const order = [...users].sort((a, b) => (clientOf.get(`${a.platform}:${a.accountId}`)?.name ?? '').localeCompare(clientOf.get(`${b.platform}:${b.accountId}`)?.name ?? '') || a.platform.localeCompare(b.platform) || a.name.localeCompare(b.name))
  for (const u of order) {
    if (++n % 20000 === 0) await progress('Writing users by account', n, users.length)
    const k = `${u.platform}:${u.accountId}`
    const a = acct.get(k)
    const p = u.platform as Platform
    wu.addRow({
      client: clientOf.get(k)?.name ?? '',
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
      reports: p === '360' ? u.reports : '',
      profiles: p === '360' ? u.profiles : '',
    }).commit()
  }
  await wu.commit()

  // Notes
  const wn = wb.addWorksheet('Notes')
  wn.columns = [{ header: 'About this export', key: 't', width: 120 }]
  for (const t of [
    `Exported ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC from the Client Evaluation snapshots.`,
    'Last login: 360 is the latest login session since January 2025; Classic is the latest entry in its login history; Magnifier does not record logins in the tables we can read.',
    'People: one row per person per client, matched by email across the apps; a user with no email is their own row.',
    'Account ids: 360 user set id, Magnifier account code, Classic customer account id.',
  ])
    wn.addRow({ t }).commit()
  await wn.commit()

  await progress('Finishing the workbook')
  await wb.commit()
  await done
  return Buffer.concat(chunks)
}
