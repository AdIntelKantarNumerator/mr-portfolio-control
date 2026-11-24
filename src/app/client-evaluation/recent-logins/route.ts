/**
 * "Recent Login Usage" (Scott, 24 November 2026): every 360 user who logged in within the last 90 days, with what
 * they used in that time, as an Excel workbook. The columns follow Scott's sample sheet: name, email, platform,
 * account, active Salesforce account, username, created, last login, then the reporting profiles and reports used
 * in the 90 days (how many, and which), and the date of their last report.
 *
 *   GET   the workbook, read from the snapshot (people, logins) and live from 360 (profiles, reports)
 *
 * "Active Salesforce Account" is left empty: neither 360 nor the app holds Salesforce data.
 * Under /client-evaluation, so the gate already requires "Sees Client Evaluation"; checked again here because the
 * gate does not enforce roles on the embedded local database.
 */
import { and, eq, gte } from 'drizzle-orm'
import ExcelJS from 'exceljs'
import { NextResponse } from 'next/server'
import { db } from '@/db/client'
import { ceAccounts, ceUsers } from '@/db/schema'
import { currentAccess } from '@/lib/auth/access'
import { live360Configured, profileUsage, reportUsage } from '@/lib/import360/source'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const DAYS = 90
/** How many names a cell lists before "and N more": Excel cells hold 32,767 characters. */
const NAMES = 40

const asDate = (d: string | null) => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? new Date(`${d.slice(0, 10)}T00:00:00Z`) : null)
const names = (xs: string[]) => (xs.length > NAMES ? `${xs.slice(0, NAMES).join('; ')}; and ${xs.length - NAMES} more` : xs.join('; '))

export async function GET() {
  const who = await currentAccess()
  if (!who.canSeeClientEvaluation) return NextResponse.json({ error: 'Client Evaluation is not switched on for you.' }, { status: 403 })
  if (!live360Configured()) return NextResponse.json({ error: '360 is not configured here, so profiles and reports cannot be read.' }, { status: 503 })

  const since = new Date(Date.now() - DAYS * 86_400_000).toISOString().slice(0, 10)
  const accounts = new Map((await db.select({ id: ceAccounts.accountId, name: ceAccounts.name }).from(ceAccounts).where(eq(ceAccounts.platform, '360'))).map((a) => [a.id, a.name]))
  const users = await db
    .select({ accountId: ceUsers.accountId, userId: ceUsers.userId, name: ceUsers.name, email: ceUsers.email, login: ceUsers.login, created: ceUsers.created, lastSeen: ceUsers.lastSeen })
    .from(ceUsers)
    .where(and(eq(ceUsers.platform, '360'), gte(ceUsers.lastSeen, since)))

  let profiles: Map<number, string[]>
  let reports: Map<number, { recent: string[]; last: string | null }>
  try {
    ;[profiles, reports] = await Promise.all([profileUsage(since), reportUsage(since)])
  } catch (err) {
    return NextResponse.json({ error: `360 could not be read: ${(err as Error).message}` }, { status: 502 })
  }

  const wb = new ExcelJS.Workbook()
  wb.created = new Date()
  const ws = wb.addWorksheet('360', { views: [{ state: 'frozen', ySplit: 1 }] })
  ws.columns = [
    { header: 'Name', key: 'name', width: 26 },
    { header: 'Email', key: 'email', width: 34 },
    { header: 'Platform', key: 'platform', width: 9 },
    { header: 'Account', key: 'account', width: 36 },
    { header: 'Active Salesforce Account', key: 'sf', width: 16 },
    { header: 'Username', key: 'login', width: 22 },
    { header: 'Created', key: 'created', width: 12, style: { numFmt: 'm/d/yyyy' } },
    { header: 'Last login', key: 'lastSeen', width: 12, style: { numFmt: 'm/d/yyyy' } },
    { header: `Reporting Profiles (${DAYS} days)`, key: 'profiles', width: 14 },
    { header: 'Reporting Profiles used', key: 'profileNames', width: 50 },
    { header: `Reports (${DAYS} days)`, key: 'reports', width: 12 },
    { header: 'Reports used', key: 'reportNames', width: 60 },
    { header: 'Date of Last Run Report', key: 'lastReport', width: 14, style: { numFmt: 'm/d/yyyy' } },
  ]
  ws.getRow(1).font = { bold: true }
  users.sort((a, b) => (accounts.get(a.accountId) ?? '').localeCompare(accounts.get(b.accountId) ?? '') || (b.lastSeen ?? '').localeCompare(a.lastSeen ?? ''))
  for (const u of users) {
    const id = Number(u.userId)
    const p = profiles.get(id) ?? []
    const r = reports.get(id)
    ws.addRow({
      name: u.name,
      email: u.email ?? '',
      platform: '360',
      account: accounts.get(u.accountId) ?? u.accountId.trim(),
      sf: '',
      login: u.login ?? '',
      created: asDate(u.created),
      lastSeen: asDate(u.lastSeen),
      profiles: p.length,
      profileNames: names(p),
      reports: r?.recent.length ?? 0,
      reportNames: names(r?.recent ?? []),
      lastReport: asDate(r?.last ?? null),
    })
  }
  ws.autoFilter = { from: 'A1', to: 'M1' }

  const buf = Buffer.from(await wb.xlsx.writeBuffer())
  const day = new Date().toISOString().slice(0, 10)
  return new Response(new Uint8Array(buf), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="360 Recent Login Usage ${day}.xlsx"`,
      'cache-control': 'no-store',
    },
  })
}
