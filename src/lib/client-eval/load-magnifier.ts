/**
 * Magnifier's clients, users, reports and entitlements, for Client Evaluation.
 *
 * Magnifier's user database is an Amazon RDS MySQL (competitrack_user_db). The
 * app reaches it; it needs TLS, verified against the RDS certificate bundle
 * mysql2 ships ("Amazon RDS") - without TLS the server answers "Access denied",
 * which reads like a wrong password. Configured by MAGNIFIER_MYSQL_HOST,
 * _PORT, _USER, _PASSWORD (a Key Vault reference in Azure) and _DATABASE.
 * The login may SELECT from seven tables and nothing else, and USER's password
 * column is not among what it may read.
 *
 *   client       ACCOUNT (not deleted, not internal) that has users or reports.
 *   users        USER through USER_ACCOUNT. Active as Scott's query has it:
 *                the link and the user both 'A', today inside VALID_FROM..UNTIL.
 *                A person on two accounts appears on both.
 *   reports      Scott's second query: each account's enabled reports
 *                (USER_ACCOUNT_REPORTING -> REPORT_CONFIGURATION), with the
 *                client REL and the default REL (CRITERIA.RULE_RAW). SCHEMA_ID
 *                brand-c is US; brand-n and brand-monthly are Canada.
 *   entitlements The account's product switches and contract, and what its
 *                RELs let in - media rolled up, and advertisers, categories and
 *                products by name (rel.ts, rel-names.ts).
 */
import type { Connection, RowDataPacket } from 'mysql2/promise'
import { FIELDS, parseRel, readable, schemaCountry, wildcardIndustry, type NameKind, type ReadableRel } from './rel'
import { relNames } from './rel-names'
import { mongoUrl, searchCounts, searchCountriesBy } from './saved-searches'
import type { AccountSnap, EntMagnifier, Progress, ReportSnap, Snapshot, UserSnap } from './types'

type Row = Record<string, unknown>
const str = (v: unknown) => (v == null ? '' : String(v).trim())
/** Codes as stored: two accounts may differ only by a leading space (" PMPI" and "PMPI"). */
const code = (v: unknown) => (v == null ? '' : String(v))
const day = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null)

export interface MagnifierConfig {
  host: string
  port: number
  user: string
  password: string
  database: string
}

export function magnifierConfig(env: Record<string, string | undefined> = process.env): MagnifierConfig | null {
  const host = env.MAGNIFIER_MYSQL_HOST?.trim()
  const user = env.MAGNIFIER_MYSQL_USER?.trim()
  const password = env.MAGNIFIER_MYSQL_PASSWORD
  if (!host || !user || !password) return null
  return { host, port: Number(env.MAGNIFIER_MYSQL_PORT || 3306), user, password, database: env.MAGNIFIER_MYSQL_DATABASE?.trim() || 'competitrack_user_db' }
}

export async function connectMagnifier(c: MagnifierConfig): Promise<Connection> {
  const mysql = await import('mysql2/promise')
  const conn = await mysql.createConnection({ ...c, connectTimeout: 20_000, dateStrings: true, ssl: 'Amazon RDS' })
  await conn.query('SET SESSION TRANSACTION READ ONLY')
  return conn
}

async function select(conn: Connection, sql: string): Promise<Row[]> {
  if (!/^\s*SELECT\b/i.test(sql)) throw new Error('Magnifier is read only: SELECT statements only.')
  const [rows] = await conn.query<RowDataPacket[]>({ sql, timeout: 300_000 })
  return rows as Row[]
}

const FLAGS: Array<[string, string]> = [
  ['IS_AD_INTEL_SEARCH', 'Ad Intel search'],
  ['IS_AD_INTEL_FULL_VIEW', 'Ad Intel full view'],
  ['CREATIVE_ANALYTICS_ACCESS', 'Creative analytics'],
  ['HAS_CITUS_ACCESS', 'Citus'],
  ['IS_STRIPE_ACCESS', 'Stripe'],
  ['OCCURRENCE_OUT_OF_ACCESS', 'Occurrences outside access'],
]

/** How many names an account's combined access keeps per restriction. */
const ACCESS_KEEP = 200

export async function loadMagnifier(conn: Connection, progress: Progress): Promise<Snapshot> {
  await progress('Reading Magnifier accounts', 0, 5)
  const accts = await select(conn, `SELECT ACCOUNT_CODE, ACCOUNT_NAME, SUBSCRIBER, SUPER_CATEGORY_CODE, CONTRACT_START_DATE, CONTRACT_END_DATE, CREATION_DATE,
      SPOTFIRE_CLIENT, ${FLAGS.map(([c]) => c).join(', ')}
    FROM ACCOUNT WHERE DELETE_FLAG = 'N' AND IS_INTERNAL = 0`)

  // USER_ACCOUNT's REPORTS_<media> columns are legacy and mean nothing now (Scott, 20 November 2026): not read.
  await progress('Reading Magnifier users', 1, 5)
  const users = await select(conn, `SELECT ua.ACCOUNT_CODE, u.USER_CODE, u.FIRST_NAME, u.LAST_NAME, u.EMAIL_ADDRESS, u.CREATION_DATE,
      (ua.STATUS = 'A' AND u.STATUS = 'A' AND CURDATE() BETWEEN u.VALID_FROM AND u.VALID_UNTIL) AS active
    FROM USER_ACCOUNT ua
    JOIN \`USER\` u ON u.USER_CODE = ua.USER_CODE
    JOIN ACCOUNT a ON a.ACCOUNT_CODE = ua.ACCOUNT_CODE AND a.DELETE_FLAG = 'N' AND a.IS_INTERNAL = 0
    WHERE IFNULL(u.DELETE_FLAG, 'N') = 'N' AND IFNULL(ua.DELETE_FLAG, 'N') = 'N'`)

  await progress('Reading Magnifier reports and RELs', 2, 5)
  const reports = await select(conn, `SELECT a.ACCOUNT_CODE, rc.REPORT_ID, rc.EXTERNAL_NAME, rc.DESCRIPTION, rc.SCHEMA_ID, rc.REPORT_TYPE,
      rc.CRITERIA_ID, c.NAME AS client_rel_name, c.RULE_RAW AS client_rel, c.CONTRACT_END_DATE AS rel_end,
      rc.DEFAULT_CRITERIA_ID, d.NAME AS default_rel_name, d.RULE_RAW AS default_rel
    FROM (SELECT DISTINCT USER_ACCOUNT_CODE, REPORT_ID FROM USER_ACCOUNT_REPORTING) r
    JOIN ACCOUNT a ON a.ACCOUNT_CODE = r.USER_ACCOUNT_CODE AND a.DELETE_FLAG = 'N' AND a.IS_INTERNAL = 0
    JOIN REPORT_CONFIGURATION rc ON rc.REPORT_ID = r.REPORT_ID AND rc.IS_ENABLED = 1
    LEFT JOIN CRITERIA c ON c.ID = rc.CRITERIA_ID
    LEFT JOIN CRITERIA d ON d.ID = rc.DEFAULT_CRITERIA_ID`)

  // The REL codes' names, from Databricks, all at once.
  const parsed = reports.map((r) => ({ r, rel: parseRel(str(r.client_rel)), def: parseRel(str(r.default_rel)) }))
  const want = new Map<NameKind, Set<string>>()
  for (const p of parsed)
    for (const f of [...p.rel.fields, ...p.def.fields]) {
      const kind = FIELDS[f.field]?.kind
      if (!kind) continue
      for (const c of [...f.codes, ...f.excluded]) {
        const ind = kind === 'advertiser' ? wildcardIndustry(c) : null
        const k: NameKind = ind ? 'industry' : kind
        ;(want.get(k) ?? want.set(k, new Set()).get(k)!).add(ind ?? c)
      }
    }
  await progress('Naming the advertisers, categories and products in RELs', 3, 5)
  const { lookup, error: namesError } = await relNames(want, (done, total) => progress(`Naming REL codes from Databricks (${done} of ${total})`, 3, 5))

  await progress('Putting Magnifier together', 4, 5)
  const outReports: ReportSnap[] = parsed.map(({ r, rel, def }) => ({
    accountId: code(r.ACCOUNT_CODE),
    reportId: code(r.REPORT_ID),
    name: str(r.EXTERNAL_NAME) || code(r.REPORT_ID),
    kind: str(r.REPORT_TYPE) || null,
    detail: {
      description: str(r.DESCRIPTION) || null,
      schema: str(r.SCHEMA_ID) || null,
      country: schemaCountry(str(r.SCHEMA_ID)),
      rel: { id: str(r.CRITERIA_ID) || null, name: str(r.client_rel_name) || null, end: day(r.rel_end), readable: readable(rel, lookup) },
      defaultRel: { id: str(r.DEFAULT_CRITERIA_ID) || null, name: str(r.default_rel_name) || null, readable: readable(def, lookup) },
    },
  }))
  const reportsBy = new Map<string, ReportSnap[]>()
  for (const r of outReports) (reportsBy.get(r.accountId) ?? reportsBy.set(r.accountId, []).get(r.accountId)!).push(r)

  const outUsers: UserSnap[] = []
  const seen = new Set<string>()
  for (const u of users) {
    const accountId = code(u.ACCOUNT_CODE)
    const userId = code(u.USER_CODE)
    if (seen.has(`${accountId}|${userId}`)) continue
    seen.add(`${accountId}|${userId}`)
    const email = str(u.EMAIL_ADDRESS).toLowerCase()
    outUsers.push({
      accountId,
      userId,
      name: [str(u.FIRST_NAME), str(u.LAST_NAME)].filter(Boolean).join(' ') || email || userId,
      login: userId,
      email: email || null,
      active: Number(u.active) === 1,
      lastSeen: null,
      reports: 0,
      created: u.CREATION_DATE instanceof Date ? u.CREATION_DATE.toISOString().slice(0, 10) : str(u.CREATION_DATE).slice(0, 10) || null,
    })
  }
  // Saved searches saved or updated in 2026, from Magnifier's MongoDB (saved-searches.ts): each user's count, kept as their reports.
  let searchCountries = new Map<string, string[]>()
  if (mongoUrl()) {
    await progress('Counting Magnifier saved searches (2026)', 4, 5)
    try {
      const counts = await searchCounts()
      for (const u of outUsers) u.reports = counts.get(`${u.accountId.trim()}|${u.userId.trim()}`.toLowerCase()) ?? 0
      searchCountries = await searchCountriesBy()
    } catch (err) {
      console.error('[client-eval] Magnifier saved searches', err)
    }
  }
  const withUsers = new Set(outUsers.map((u) => u.accountId))
  const activeBy = new Set(outUsers.filter((u) => u.active).map((u) => u.accountId))

  const accounts: AccountSnap[] = accts
    .filter((a) => withUsers.has(code(a.ACCOUNT_CODE)) || reportsBy.has(code(a.ACCOUNT_CODE)))
    .map((a) => {
      const id = code(a.ACCOUNT_CODE)
      const mine = reportsBy.get(id) ?? []
      const rels = mine.map((r) => (r.detail as { rel: { readable: ReadableRel } }).rel.readable)
      // The account's access across its reports: each restriction's names, together.
      const access = new Map<string, { items: Set<string>; total: number }>()
      for (const rr of rels)
        for (const row of rr.rows) {
          const x = access.get(row.label) ?? access.set(row.label, { items: new Set(), total: 0 }).get(row.label)!
          for (const i of row.items) if (x.items.size < ACCESS_KEEP) x.items.add(i)
          x.total = Math.max(x.total, x.items.size, row.total)
        }
      const ent: EntMagnifier = {
        kind: 'magnifier',
        contract: { start: day(a.CONTRACT_START_DATE), end: day(a.CONTRACT_END_DATE) },
        flags: FLAGS.filter(([c]) => Number(a[c]) === 1).map(([, label]) => label),
        countries: [...new Set(mine.map((r) => (r.detail as { country: string | null }).country).filter((c): c is string => !!c))].sort(),
        searchCountries: searchCountries.get(id.trim().toLowerCase()) ?? [],
        media: [...new Set(rels.flatMap((r) => r.media))].sort(),
        access: [...access].map(([label, x]) => ({ label, items: [...x.items].sort((p, q) => p.localeCompare(q)), total: x.total })),
        reports: mine.length,
        namesNote: mine.length ? namesError : null,
        // The latest end date among its reports' RELs (CRITERIA.CONTRACT_END_DATE): see expireMagnifier.
        relEnd: mine.map((r) => (r.detail as { rel: { end: string | null } }).rel.end).filter((e): e is string => !!e && !e.startsWith('0000')).sort().at(-1) ?? null,
      }
      return {
        accountId: id,
        name: str(a.ACCOUNT_NAME) || id,
        company: null,
        active: activeBy.has(id),
        reports: mine.length,
        summary: summaryMagnifier(ent),
        entitlements: ent,
        info: { subscriber: str(a.SUBSCRIBER) || null, superCategory: str(a.SUPER_CATEGORY_CODE) || null, created: day(a.CREATION_DATE), spotfire: str(a.SPOTFIRE_CLIENT) || null },
      }
    })
  const kept = new Set(accounts.map((a) => a.accountId))
  await progress('Magnifier read', 5, 5)
  return { accounts, users: outUsers.filter((u) => kept.has(u.accountId)), reports: outReports.filter((r) => kept.has(r.accountId)) }
}

/**
 * An account whose every REL has ended and none of whose users has ever signed in through SSO is inactive (Scott,
 * 25 November 2026), whatever its users' flags say. Run after the users' SSO sign-ins are known (applySignins).
 * Returns how many accounts it turned inactive.
 */
export function expireMagnifier(snap: Snapshot, today = new Date().toISOString().slice(0, 10)): number {
  const signedIn = new Set(snap.users.filter((u) => u.lastSeen).map((u) => u.accountId))
  let n = 0
  for (const a of snap.accounts) {
    const e = a.entitlements as EntMagnifier
    if (!a.active || e.kind !== 'magnifier' || !e.relEnd || e.relEnd >= today || signedIn.has(a.accountId)) continue
    a.active = false
    a.info = { ...(a.info as Record<string, unknown>), inactiveWhy: `Every REL ended (latest ${e.relEnd}) and no SSO sign-in on record.` }
    n++
  }
  return n
}

export function summaryMagnifier(e: EntMagnifier): string {
  const parts: string[] = []
  if (e.media.length) parts.push(`Media: ${e.media.slice(0, 4).join(', ')}${e.media.length > 4 ? ` +${e.media.length - 4}` : ''}`)
  const adv = e.access.find((x) => x.label === 'Advertisers' || x.label === 'Parent advertisers')
  if (adv) parts.push(`${adv.label} ${adv.total.toLocaleString('en-US')}`)
  if (e.reports) parts.push(`${e.reports} report${e.reports === 1 ? '' : 's'}${e.countries.length ? ` (${e.countries.join(', ')})` : ''}`)
  return parts.join(' · ') || 'No reports'
}
