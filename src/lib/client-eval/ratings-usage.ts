/**
 * Ratings Usage (Scott, 23 November 2026): how many 360 reports used VideoAmp
 * ratings in a span of months, by client and user. Read live from 360's report
 * queue.
 *
 * Every report run is a row in the report middleware's queue (jobq; jobq_hist
 * once archived), one database per application: iddb_ai_custrpt_mw_prod is Ad
 * Insights Media Buyer, iddb_custrpt_mw_prod Media Owner. Each run's options
 * are in qrptset_rptopt, and option -138, "Rating Provider ID", holds
 * iddb_ratings.SOURCE: 1 Nielsen, 2 MRI, 3 VideoAmp.
 *
 * Counted: top-level runs only (a report split into sub-runs carries the same
 * options on each part), and not the ones cancelled or deleted as failed.
 * The provider option is recorded from October 2026, so earlier months have
 * none (USAGE_FROM).
 */
import { inArray, and, eq } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { ceAccounts, ceClients, ceUsers } from '@/db/schema'
import { q360 } from '@/lib/import360/source'
import { memberKey } from './types'

/** The first month 360 records a run's rating provider. */
export const USAGE_FROM = '2026-10'
const VIDEOAMP = 3
/** Cancelled, failed and deleted-as-failed runs. */
const NOT_RUN = [13, 15, 22, 23]

const LOGS = [
  { app: 'Media Buyer', live: 'iddb_ai_custrpt_mw_prod', archive: 'iddb_ai_custrpt_mw_archive_prod' },
  { app: 'Media Owner', live: 'iddb_custrpt_mw_prod', archive: 'iddb_custrpt_mw_archive_prod' },
]

/** "YYYY-MM" months from USAGE_FROM to this month, oldest first. */
export function usageMonths(now = new Date()): string[] {
  const out: string[] = []
  let [y, m] = USAGE_FROM.split('-').map(Number) as [number, number]
  const end = now.getUTCFullYear() * 12 + now.getUTCMonth()
  while (y * 12 + (m - 1) <= end) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    m++
    if (m > 12) {
      m = 1
      y++
    }
  }
  return out
}

/** The first day of a month, and of the month after another: the span [from, to] as dates. */
export function monthSpan(from: string, to: string): { start: string; end: string } {
  if (!/^\d{4}-\d{2}$/.test(from) || !/^\d{4}-\d{2}$/.test(to) || from > to) throw new Error('Pick a month range.')
  const [y, m] = to.split('-').map(Number) as [number, number]
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
  return { start: `${from}-01`, end: `${next}-01` }
}

export interface UsageUser {
  usrId: string
  name: string
  email: string | null
  login: string | null
  account: string
  app: string
  reports: number
  last: string
}
export interface UsageClient {
  id: string | null
  name: string
  internal: boolean
  reports: number
  users: UsageUser[]
}

interface RunRow {
  usrset_id: number
  usr_id: number
  n: number
  last: Date
}

function runsSql(db: string, jobq: string, opts: string, start: string, end: string): string {
  return `SELECT j.usrset_id, j.usr_id, COUNT(*) AS n, MAX(j.start_d) AS last
    FROM ${db}.dbo.${jobq} j
    WHERE j.start_d >= '${start}' AND j.start_d < '${end}'
      AND (j.masterq_id IS NULL OR j.masterq_id = -1)
      AND j.qstate_id NOT IN (${NOT_RUN.join(', ')})
      AND EXISTS (SELECT 1 FROM ${db}.dbo.${opts} o WHERE o.q_id = j.q_id AND o.rptopt_id = -138 AND o.long_v = ${VIDEOAMP})
    GROUP BY j.usrset_id, j.usr_id`
}

/** VideoAmp report runs in these months, by client and user, most first. Internal clients are marked. */
export async function videoAmpUsage(d: Database, from: string, to: string): Promise<{ clients: UsageClient[]; reports: number; users: number }> {
  const { start, end } = monthSpan(from < USAGE_FROM ? USAGE_FROM : from, to)
  const runs = new Map<string, { usrset: number; usr: number; app: string; n: number; last: string }>()
  for (const log of LOGS) {
    // Live queue, and the archive it is moved to: the same run is in one or the other.
    for (const [db, jobq, opts] of [
      [log.live, 'jobq', 'qrptset_rptopt'],
      [log.archive, 'jobq_hist', 'qrptset_rptopt_hist'],
    ] as const) {
      for (const r of await q360<RunRow>(runsSql(db, jobq, opts, start, end))) {
        const k = `${log.app}|${r.usrset_id}|${r.usr_id}`
        const last = r.last instanceof Date ? r.last.toISOString().slice(0, 10) : String(r.last).slice(0, 10)
        const x = runs.get(k) ?? runs.set(k, { usrset: Number(r.usrset_id), usr: Number(r.usr_id), app: log.app, n: 0, last: '' }).get(k)!
        x.n += Number(r.n)
        if (last > x.last) x.last = last
      }
    }
  }

  const setIds = [...new Set([...runs.values()].map((r) => String(r.usrset)))]
  const usrIds = [...new Set([...runs.values()].map((r) => String(r.usr)))]
  const users = new Map<string, typeof ceUsers.$inferSelect>()
  const accounts = new Map<string, string>()
  if (usrIds.length) for (const u of await d.select().from(ceUsers).where(and(eq(ceUsers.platform, '360'), inArray(ceUsers.userId, usrIds)))) users.set(u.userId, u)
  if (setIds.length)
    for (const a of await d.select({ id: ceAccounts.accountId, name: ceAccounts.name }).from(ceAccounts).where(and(eq(ceAccounts.platform, '360'), inArray(ceAccounts.accountId, setIds))))
      accounts.set(a.id, a.name)
  // Which client each 360 account is in.
  const clientOf = new Map<string, { id: string; name: string; internal: boolean }>()
  const want = new Set(setIds.map((id) => memberKey('360', id)))
  if (want.size)
    for (const c of await d.select({ id: ceClients.clientId, name: ceClients.name, internal: ceClients.internal, members: ceClients.members }).from(ceClients))
      for (const m of c.members as string[]) if (want.has(m)) clientOf.set(m.slice(4), { id: c.id, name: c.name, internal: c.internal })

  const clients = new Map<string, UsageClient>()
  for (const r of runs.values()) {
    const set = String(r.usrset)
    const account = accounts.get(set) ?? `360 user set ${set}`
    const c = clientOf.get(set)
    const key = c?.id ?? `set:${set}`
    const row = clients.get(key) ?? clients.set(key, { id: c?.id ?? null, name: c?.name ?? account, internal: c?.internal ?? false, reports: 0, users: [] }).get(key)!
    const u = users.get(String(r.usr))
    row.reports += r.n
    row.users.push({ usrId: String(r.usr), name: u?.name ?? `360 user ${r.usr}`, email: u?.email ?? null, login: u?.login ?? null, account, app: r.app, reports: r.n, last: r.last })
  }
  const list = [...clients.values()]
  for (const c of list) c.users.sort((a, b) => b.reports - a.reports || a.name.localeCompare(b.name))
  list.sort((a, b) => b.reports - a.reports || a.name.localeCompare(b.name))
  return { clients: list, reports: list.reduce((s, c) => s + c.reports, 0), users: new Set([...runs.values()].map((r) => r.usr)).size }
}
