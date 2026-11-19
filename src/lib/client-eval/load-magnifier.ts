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
 *   entitlements The account's product switches and contract, the media and
 *                countries its RELs name, and USER_ACCOUNT's REPORTS_* codes.
 */
import type { Connection, RowDataPacket } from 'mysql2/promise'
import { parseRel, schemaCountry } from './rel'
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

/** USER_ACCOUNT's per-media report columns. */
const USER_MEDIA: Array<[string, string]> = [
  ['REPORTS_TV', 'TV'],
  ['REPORTS_PRINT', 'Print'],
  ['REPORTS_ONLINE', 'Online'],
  ['REPORTS_ONLINEVIDEO', 'Online video'],
  ['REPORTS_RADIO', 'Radio'],
  ['REPORTS_OUTOFHOME', 'Out of home'],
  ['REPORTS_CINEMA', 'Cinema'],
]

const FLAGS: Array<[string, string]> = [
  ['IS_AD_INTEL_SEARCH', 'Ad Intel search'],
  ['IS_AD_INTEL_FULL_VIEW', 'Ad Intel full view'],
  ['CREATIVE_ANALYTICS_ACCESS', 'Creative analytics'],
  ['HAS_CITUS_ACCESS', 'Citus'],
  ['IS_STRIPE_ACCESS', 'Stripe'],
  ['OCCURRENCE_OUT_OF_ACCESS', 'Occurrences outside access'],
]

export async function loadMagnifier(conn: Connection, progress: Progress): Promise<Snapshot> {
  await progress('Reading Magnifier accounts', 0, 4)
  const accts = await select(conn, `SELECT ACCOUNT_CODE, ACCOUNT_NAME, SUBSCRIBER, SUPER_CATEGORY_CODE, CONTRACT_START_DATE, CONTRACT_END_DATE, CREATION_DATE,
      SPOTFIRE_CLIENT, ${FLAGS.map(([c]) => c).join(', ')}
    FROM ACCOUNT WHERE DELETE_FLAG = 'N' AND IS_INTERNAL = 0`)

  await progress('Reading Magnifier users', 1, 4)
  const users = await select(conn, `SELECT ua.ACCOUNT_CODE, u.USER_CODE, u.FIRST_NAME, u.LAST_NAME, u.EMAIL_ADDRESS, u.COUNTRY, ua.USERGROUP_CODE,
      (ua.STATUS = 'A' AND u.STATUS = 'A' AND CURDATE() BETWEEN u.VALID_FROM AND u.VALID_UNTIL) AS active,
      u.VALID_UNTIL, ${USER_MEDIA.map(([c]) => `ua.${c}`).join(', ')}
    FROM USER_ACCOUNT ua
    JOIN \`USER\` u ON u.USER_CODE = ua.USER_CODE
    JOIN ACCOUNT a ON a.ACCOUNT_CODE = ua.ACCOUNT_CODE AND a.DELETE_FLAG = 'N' AND a.IS_INTERNAL = 0
    WHERE IFNULL(u.DELETE_FLAG, 'N') = 'N' AND IFNULL(ua.DELETE_FLAG, 'N') = 'N'`)

  await progress('Reading Magnifier reports and RELs', 2, 4)
  const reports = await select(conn, `SELECT a.ACCOUNT_CODE, rc.REPORT_ID, rc.EXTERNAL_NAME, rc.DESCRIPTION, rc.SCHEMA_ID, rc.REPORT_TYPE,
      rc.CRITERIA_ID, c.NAME AS client_rel_name, c.RULE_RAW AS client_rel, c.CONTRACT_END_DATE AS rel_end,
      rc.DEFAULT_CRITERIA_ID, d.NAME AS default_rel_name, d.RULE_RAW AS default_rel
    FROM (SELECT DISTINCT USER_ACCOUNT_CODE, REPORT_ID FROM USER_ACCOUNT_REPORTING) r
    JOIN ACCOUNT a ON a.ACCOUNT_CODE = r.USER_ACCOUNT_CODE AND a.DELETE_FLAG = 'N' AND a.IS_INTERNAL = 0
    JOIN REPORT_CONFIGURATION rc ON rc.REPORT_ID = r.REPORT_ID AND rc.IS_ENABLED = 1
    LEFT JOIN CRITERIA c ON c.ID = rc.CRITERIA_ID
    LEFT JOIN CRITERIA d ON d.ID = rc.DEFAULT_CRITERIA_ID`)

  await progress('Putting Magnifier together', 3, 4)
  const outReports: ReportSnap[] = reports.map((r) => {
    const rel = parseRel(str(r.client_rel))
    return {
      accountId: code(r.ACCOUNT_CODE),
      reportId: code(r.REPORT_ID),
      name: str(r.EXTERNAL_NAME) || code(r.REPORT_ID),
      kind: str(r.REPORT_TYPE) || null,
      detail: {
        description: str(r.DESCRIPTION) || null,
        schema: str(r.SCHEMA_ID) || null,
        country: schemaCountry(str(r.SCHEMA_ID)),
        rel: { id: str(r.CRITERIA_ID) || null, name: str(r.client_rel_name) || null, end: day(r.rel_end), summary: rel, raw: str(r.client_rel).slice(0, 20_000) },
        defaultRel: { id: str(r.DEFAULT_CRITERIA_ID) || null, name: str(r.default_rel_name) || null, summary: parseRel(str(r.default_rel)) },
      },
    }
  })
  const reportsBy = new Map<string, ReportSnap[]>()
  for (const r of outReports) (reportsBy.get(r.accountId) ?? reportsBy.set(r.accountId, []).get(r.accountId)!).push(r)

  const outUsers: UserSnap[] = []
  const media = new Map<string, Map<string, Record<string, number>>>()
  const seen = new Set<string>()
  for (const u of users) {
    const accountId = code(u.ACCOUNT_CODE)
    const userId = code(u.USER_CODE)
    if (seen.has(`${accountId}|${userId}`)) continue
    seen.add(`${accountId}|${userId}`)
    const email = str(u.EMAIL_ADDRESS).toLowerCase()
    const active = Number(u.active) === 1
    outUsers.push({
      accountId,
      userId,
      name: [str(u.FIRST_NAME), str(u.LAST_NAME)].filter(Boolean).join(' ') || email || userId,
      login: userId,
      email: email || null,
      active,
      lastSeen: null,
      reports: 0,
    })
    if (!active) continue
    const byMedia = media.get(accountId) ?? media.set(accountId, new Map()).get(accountId)!
    for (const [col, label] of USER_MEDIA) {
      const value = str(u[col]) || '?'
      const c = byMedia.get(label) ?? byMedia.set(label, {}).get(label)!
      c[value] = (c[value] ?? 0) + 1
    }
  }
  const withUsers = new Set(outUsers.map((u) => u.accountId))
  const activeBy = new Set(outUsers.filter((u) => u.active).map((u) => u.accountId))

  const accounts: AccountSnap[] = accts
    .filter((a) => withUsers.has(code(a.ACCOUNT_CODE)) || reportsBy.has(code(a.ACCOUNT_CODE)))
    .map((a) => {
      const id = code(a.ACCOUNT_CODE)
      const mine = reportsBy.get(id) ?? []
      const ent: EntMagnifier = {
        kind: 'magnifier',
        contract: { start: day(a.CONTRACT_START_DATE), end: day(a.CONTRACT_END_DATE) },
        flags: FLAGS.filter(([c]) => Number(a[c]) === 1).map(([, label]) => label),
        countries: [...new Set(mine.map((r) => (r.detail as { country: string | null }).country).filter((c): c is string => !!c))].sort(),
        media: [...new Set(mine.flatMap((r) => (r.detail as { rel: { summary: { media: string[] } } }).rel.summary.media))].sort(),
        userMedia: [...(media.get(id) ?? new Map<string, Record<string, number>>())].map(([m, codes]) => ({ media: m, codes })),
        reports: mine.length,
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
  await progress('Magnifier read', 4, 4)
  return { accounts, users: outUsers.filter((u) => kept.has(u.accountId)), reports: outReports.filter((r) => kept.has(r.accountId)) }
}

export function summaryMagnifier(e: EntMagnifier): string {
  const parts: string[] = []
  if (e.reports) parts.push(`${e.reports} report${e.reports === 1 ? '' : 's'}${e.countries.length ? ` (${e.countries.join(', ')})` : ''}`)
  if (e.media.length) parts.push(e.media.slice(0, 4).join(', ') + (e.media.length > 4 ? ` +${e.media.length - 4}` : ''))
  if (e.flags.length) parts.push(e.flags.slice(0, 2).join(', ') + (e.flags.length > 2 ? ` +${e.flags.length - 2}` : ''))
  return parts.join(' · ') || 'No reports'
}
