/**
 * No Recent Logins (Scott, 23 November 2026): active accounts where nobody has
 * logged in since a date, for cleaning up accounts that should be switched off
 * (Avrett, Free & Ginsberg in Magnifier was the first: 29 active users, no
 * reports, no logins).
 *
 * Read from the snapshot, not live: each user's latest login (ce_users.last_seen)
 * as the platform's loader recorded it. Only the latest is kept, so the question
 * is "no login since", not "no login between two dates".
 *
 * How far back each platform's logins reach (LOGIN_FROM) matters: before it, no
 * login on record does not mean nobody logged in.
 */
import { eq, sql } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { ceAccounts, ceClients, ceUsers } from '@/db/schema'
import { memberKey, type Platform } from './types'

/**
 * The first day each platform's login record covers. 360: LOGIN_SESSION(_ARCHIVE)
 * from 2025 (load-360.ts). Classic: its whole loginHistory. Magnifier: the SSO
 * pool, which Magnifier signs in through from 20 September 2026 (cognito-signins.ts).
 */
export const LOGIN_FROM: Record<Platform, string | null> = { '360': '2025-01-01', classic: null, magnifier: '2026-09-20' }

export interface InactiveAccount {
  platform: Platform
  accountId: string
  name: string
  client: string | null
  internal: boolean
  users: number
  activeUsers: number
  reports: number
  /** The latest login by any of its users, YYYY-MM-DD; null when none is on record. */
  lastLogin: string | null
  /** When its first user was created. */
  created: string | null
}

export function validSince(s: string | null | undefined): string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw new Error('Pick a date.')
  return s
}

/** Active accounts (with an active user) where no user has logged in on or after `since`, longest quiet first. */
export async function inactiveAccounts(d: Database, since: string): Promise<InactiveAccount[]> {
  validSince(since)
  const seen = await d
    .select({
      platform: ceUsers.platform,
      accountId: ceUsers.accountId,
      last: sql<string | null>`max(${ceUsers.lastSeen})`,
      created: sql<string | null>`min(${ceUsers.created})`,
    })
    .from(ceUsers)
    .groupBy(ceUsers.platform, ceUsers.accountId)
  const by = new Map(seen.map((s) => [memberKey(s.platform as Platform, s.accountId), s]))

  const clientOf = new Map<string, { name: string; internal: boolean }>()
  for (const c of await d.select({ name: ceClients.name, internal: ceClients.internal, members: ceClients.members }).from(ceClients))
    for (const m of c.members as string[]) clientOf.set(m, { name: c.name, internal: c.internal })

  const out: InactiveAccount[] = []
  for (const a of await d.select().from(ceAccounts).where(eq(ceAccounts.active, true))) {
    const key = memberKey(a.platform as Platform, a.accountId)
    const s = by.get(key)
    const last = s?.last ?? null
    if (last && last >= since) continue
    const c = clientOf.get(key)
    out.push({
      platform: a.platform as Platform,
      accountId: a.accountId,
      name: a.name,
      client: c?.name ?? null,
      internal: c?.internal ?? false,
      users: a.users,
      activeUsers: a.activeUsers,
      reports: a.reports,
      lastLogin: last,
      created: s?.created ?? null,
    })
  }
  // None on record first, then the longest quiet; the most active users first within that.
  out.sort((x, y) => (x.lastLogin ?? '').localeCompare(y.lastLogin ?? '') || y.activeUsers - x.activeUsers || x.name.localeCompare(y.name))
  return out
}
