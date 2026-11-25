/**
 * Client Evaluation (Scott, 19 November 2026): the shapes the snapshots hold.
 *
 * Each platform has its own entitlements, and they are kept apart on purpose:
 * Scott, "Magnifier and Classic entitlements are different -- don't assume
 * they are the same." So there is no common entitlement model, only one shape
 * per platform and a one-line summary each writes for the table.
 */

export type Platform = '360' | 'classic' | 'magnifier'
export const PLATFORMS: Platform[] = ['360', 'classic', 'magnifier']
export const PLATFORM_LABEL: Record<Platform, string> = { '360': '360', classic: 'Classic', magnifier: 'Magnifier' }
export const isPlatform = (s: unknown): s is Platform => s === '360' || s === 'classic' || s === 'magnifier'

/**
 * Where each snapshot can be refreshed from. Classic's SQL Server does not let
 * the app in (Prod-SQL-nsg), so it is refreshed from Scott's laptop.
 */
export const SNAPSHOT_ONLY: Record<Platform, boolean> = { '360': false, classic: true, magnifier: false }
export const REFRESH_CONTACT = 'Scott Bernberg'

/** "platform:account_id": an account on one platform, the unit the client list is built from. */
export const memberKey = (platform: Platform, accountId: string) => `${platform}:${accountId}`
export function parseMember(key: string): { platform: Platform; accountId: string } | null {
  const i = key.indexOf(':')
  const platform = key.slice(0, i)
  return i > 0 && isPlatform(platform) ? { platform, accountId: key.slice(i + 1) } : null
}

export interface Ent360 {
  kind: '360'
  application: string
  /** Years of history the client may see. */
  years: number | null
  /** Media the client may see, rolled up from submedia; null when not restricted. */
  media: { include: string[]; exclude: string[] } | null
  features: string[]
  /** Other restrictions by entity type (not media, data tables or time): what is let in, what is kept out. Lists are capped; count is the full number. */
  filters: Array<{ type: string; include: string[]; exclude: string[]; count: number }>
}

export interface EntClassic {
  kind: 'classic'
  accountType: string
  subAccountType: string | null
  /** Sell side (publishers) or buy side (Magnifier 2.0 in Classic). */
  side: string | null
  expires: string | null
  /** Sell side: the formats of the properties the account owns, with counts. */
  owned: Array<{ format: string; count: number }>
  /** Sell side: extra properties granted to its users beyond their own. */
  extra: Array<{ what: string; users: number; items: number }>
  /** Buy side: the media its features open. */
  media: string[]
  /** Account features in force (not expired, not disabled). */
  features: string[]
}

export interface EntMagnifier {
  kind: 'magnifier'
  contract: { start: string | null; end: string | null }
  /** Product switches on the account. */
  flags: string[]
  countries: string[]
  /** The latest end date among its reports' RELs; null when none has one (load-magnifier.ts expireMagnifier). */
  relEnd?: string | null
  /** Countries of the data its saved searches since 2025 run on: the account's country when it has no reports. */
  searchCountries?: string[]
  /** Media its RELs let in, rolled up (TV, Print, Digital...). */
  media: string[]
  /** What the account's RELs let in, together across its reports: names per restriction (capped), and how many. */
  access: Array<{ label: string; items: string[]; total: number }>
  /** Set when the REL codes could not all be named. */
  namesNote: string | null
  reports: number
}

export type Entitlements = Ent360 | EntClassic | EntMagnifier

export interface AccountSnap {
  accountId: string
  name: string
  company: string | null
  active: boolean
  reports: number
  summary: string
  entitlements: Entitlements
  info: Record<string, unknown>
}

export interface UserSnap {
  accountId: string
  userId: string
  name: string
  login: string | null
  email: string | null
  active: boolean
  lastSeen: string | null
  reports: number
  /** 360 reporting profiles. */
  profiles?: number
  /** Logins in the 30 days before the snapshot. */
  logins30?: number
  /** When the user was created (YYYY-MM-DD), from the application's own records; Classic: first login. */
  created?: string | null
}

export interface ReportSnap {
  accountId: string
  reportId: string
  name: string
  kind: string | null
  detail: Record<string, unknown>
}

export interface Snapshot {
  accounts: AccountSnap[]
  users: UserSnap[]
  reports: ReportSnap[]
}

/** How a loader says how far it has got. */
export type Progress = (step: string, done?: number, total?: number) => void | Promise<void>
