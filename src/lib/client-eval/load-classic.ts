/**
 * MediaRadar Classic's clients, users and entitlements, for Client Evaluation.
 *
 * Classic's SQL Server (magradar_dev on Prod-SQL) does not let the app in, so
 * this runs from a laptop: `npm run load:client-eval -- classic`. The page says
 * so, and who to ask (Scott).
 *
 *   client       magradar_public.customer_accounts of type Client (1), Agency
 *                (2) or Disabled (3); trials (0) are left out. Active while it
 *                is a Client account that has not expired.
 *   users        magradar_public.users in those accounts. The password, hash
 *                and salt columns are never read. Classic has no per-user
 *                switch, so a user is active while their account is; last seen
 *                is their latest loginHistory row.
 *   entitlements Classic has no category or product restrictions (Scott): it is
 *                media only, and media works differently on the two sides.
 *                Sell side (publishers): the formats of the properties the
 *                account owns (publications.accountId), plus extra properties
 *                granted to its users (user_additional*). Buy side (Magnifier
 *                2.0 in Classic): the media its account features open
 *                (ClientApplication_Media_Feature). Plus account features.
 *   reports      Classic keeps no saved reports like 360's.
 */
import type { AccountSnap, EntClassic, Progress, Snapshot, UserSnap } from './types'

type Row = Record<string, unknown>
export type Query = (sql: string) => Promise<Row[]>
const str = (v: unknown) => (v == null ? '' : String(v).trim())
const day = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null)

const ACCOUNTS = `a.accountType IN (1, 2, 3)`

const EXTRA: Array<[string, string, string]> = [
  ['Publications', 'user_additionalPublications', 'pubId'],
  ['Digital sites', 'user_additionalSites', 'DigitalSiteId'],
  ['TV networks', 'user_additionalTvNetworks', 'TvNetworkId'],
  ['Radio stations', 'user_additionalRadioStations', 'RadioStationId'],
  ['Outdoor markets', 'user_additionalOutdoorMarkets', 'OutdoorMarketId'],
  ['Events', 'user_additionalEvents', 'EventId'],
]

export async function loadClassic(q: Query, progress: Progress): Promise<Snapshot> {
  await progress('Reading Classic accounts', 0, 6)
  const accts = await q(`SELECT a.accountId, a.companyId, a.name, a.customName, a.expires, a.accountType, t.name AS typeName, s.Name AS subName, s.ClientApplicationId, a.activeSince, a.ContractDate
    FROM magradar_public.customer_accounts a
    LEFT JOIN magradar_public.customer_accountTypes t ON t.typeId = a.accountType
    LEFT JOIN magradar_public.Customer_SubAccountTypes s ON s.SubAccountId = a.SubAccountType
    WHERE ${ACCOUNTS}`)

  await progress('Reading Classic users', 1, 6)
  const users = await q(`SELECT u.userId, u.accountId, u.firstName, u.lastName, u.fullName, u.email, h.last, h.n30, h.first
    FROM magradar_public.users u
    JOIN magradar_public.customer_accounts a ON a.accountId = u.accountId
    LEFT JOIN (SELECT userId, MAX(loginTime) AS last, MIN(loginTime) AS first, SUM(CASE WHEN loginTime >= DATEADD(day, -30, GETDATE()) THEN 1 ELSE 0 END) AS n30
      FROM magradar_public.loginHistory GROUP BY userId) h ON h.userId = u.userId
    WHERE ${ACCOUNTS}`)

  await progress('Reading the properties Classic accounts own', 2, 6)
  const owned = await q(`SELECT p.accountId, f.format, COUNT(*) AS n
    FROM magradar_public.publications p
    JOIN magradar_public.customer_accounts a ON a.accountId = p.accountId
    LEFT JOIN magradar_public.publicationFormats f ON f.formatId = p.formatId
    WHERE ${ACCOUNTS} GROUP BY p.accountId, f.format`)

  await progress('Reading extra properties granted to Classic users', 3, 6)
  const extra: Row[] = []
  for (const [what, table, col] of EXTRA) {
    try {
      for (const r of await q(`SELECT u.accountId, COUNT(DISTINCT x.userId) AS users, COUNT(DISTINCT x.${col}) AS items
        FROM magradar_public.${table} x
        JOIN magradar_public.users u ON u.userId = x.userId
        JOIN magradar_public.customer_accounts a ON a.accountId = u.accountId
        WHERE x.include = 1 AND ${ACCOUNTS} GROUP BY u.accountId`))
        extra.push({ ...r, what })
    } catch {
      // A column named differently on one of these tables leaves that kind out, not the whole load.
    }
  }

  await progress('Reading Classic account features and media', 4, 6)
  const features = await q(`SELECT af.accountId, f.name
    FROM magradar_public.account_features af
    JOIN magradar_public.features f ON f.featureId = af.featureId
    JOIN magradar_public.customer_accounts a ON a.accountId = af.accountId
    WHERE ISNULL(af.disabled, 0) = 0 AND (af.expires IS NULL OR af.expires >= GETDATE()) AND ${ACCOUNTS}`)
  const media = await q(`SELECT DISTINCT af.accountId, m.Name
    FROM magradar_public.account_features af
    JOIN magradar_public.ClientApplication_Media_Feature cmf ON cmf.FeatureId = af.featureId
    JOIN magradar_public.Media m ON m.MediaId = cmf.MediaId
    JOIN magradar_public.customer_accounts a ON a.accountId = af.accountId
    WHERE ISNULL(af.disabled, 0) = 0 AND (af.expires IS NULL OR af.expires >= GETDATE()) AND ${ACCOUNTS}`)

  await progress('Putting Classic together', 5, 6)
  const group = <T>(rows: Row[], f: (r: Row) => T) => {
    const m = new Map<string, T[]>()
    for (const r of rows) {
      const k = String(Number(r.accountId))
      ;(m.get(k) ?? m.set(k, []).get(k)!).push(f(r))
    }
    return m
  }
  const ownedBy = group(owned, (r) => ({ format: str(r.format) || 'Other', count: Number(r.n) }))
  const extraBy = group(extra, (r) => ({ what: str(r.what), users: Number(r.users), items: Number(r.items) }))
  const featBy = group(features, (r) => str(r.name))
  const mediaBy = group(media, (r) => str(r.Name))

  const today = new Date().toISOString().slice(0, 10)
  const activeAcct = new Map<string, boolean>()
  const accounts: AccountSnap[] = accts.map((a) => {
    const id = String(Number(a.accountId))
    const expires = day(a.expires)
    const active = Number(a.accountType) === 1 && !!expires && expires >= today
    activeAcct.set(id, active)
    const buy = Number(a.ClientApplicationId) === 2
    const ent: EntClassic = {
      kind: 'classic',
      accountType: str(a.typeName) || `Type ${a.accountType}`,
      subAccountType: str(a.subName) || null,
      side: a.ClientApplicationId == null ? null : buy ? 'Buy side (Magnifier 2.0)' : 'Sell side',
      expires,
      owned: (ownedBy.get(id) ?? []).sort((x, y) => y.count - x.count),
      extra: (extraBy.get(id) ?? []).sort((x, y) => y.items - x.items),
      media: [...new Set(mediaBy.get(id) ?? [])].sort(),
      features: [...new Set(featBy.get(id) ?? [])].sort(),
    }
    return {
      accountId: id,
      name: str(a.customName) || str(a.name) || `Account ${id}`,
      company: null,
      active,
      reports: 0,
      summary: summaryClassic(ent),
      entitlements: ent,
      info: { companyId: a.companyId == null ? null : Number(a.companyId), accountName: str(a.name), activeSince: day(a.activeSince), contract: day(a.ContractDate) },
    }
  })

  const out: UserSnap[] = users.map((u) => {
    const email = str(u.email).toLowerCase()
    const accountId = String(Number(u.accountId))
    return {
      accountId,
      userId: String(Number(u.userId)),
      name: str(u.fullName) || [str(u.firstName), str(u.lastName)].filter(Boolean).join(' ') || email || `User ${u.userId}`,
      login: email || null,
      email: email || null,
      active: activeAcct.get(accountId) === true,
      lastSeen: day(u.last),
      reports: 0,
      logins30: Number(u.n30 ?? 0),
      // Classic keeps no creation date: the first login stands in.
      created: day(u.first),
    }
  })
  await progress('Classic read', 6, 6)
  return { accounts, users: out, reports: [] }
}

export function summaryClassic(e: EntClassic): string {
  const parts = [e.subAccountType ?? e.accountType]
  if (e.media.length) parts.push(e.media.slice(0, 4).join(', ') + (e.media.length > 4 ? ` +${e.media.length - 4}` : ''))
  else if (e.owned.length) parts.push(e.owned.map((o) => `${o.format} ${o.count}`).slice(0, 3).join(', '))
  const extra = e.extra.reduce((s, x) => s + x.items, 0)
  if (extra) parts.push(`+${extra} extra properties`)
  if (e.features.length) parts.push(`${e.features.length} feature${e.features.length === 1 ? '' : 's'}`)
  return parts.join(' · ')
}
