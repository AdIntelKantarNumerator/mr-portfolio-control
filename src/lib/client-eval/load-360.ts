/**
 * 360's clients, users and entitlements, for Client Evaluation. Read live from
 * the 360 SQL Server (lib/import360/source.ts q360), which the app reaches.
 *
 *   client       iddb_ar USRSET (a user set), under a LICENSEGRP (the company),
 *                in an APPLICATION (Ad Insights Media Buyer, Media Owner,
 *                Insights Studio).
 *   users        USR, with the person from MASTERUSER through MASTERUSER_XREF.
 *                MASTERUSER's password column is never read.
 *   last seen    The latest LOGIN_SESSION(_ARCHIVE) for the login, since 2025.
 *   reports      Reports used in 2026, counted as Report Builder's import does.
 *   entitlements USRSET.availableyears; USRSET_FEATURE; and FILTERSET/FILTER,
 *                the restrictions by entity type (category, parent, media,
 *                market...), named from iddb_master as the importer names them.
 */
import { chunks, liveReportCounts, META_SQL, NAME_FIELDS_SQL, namesSql, q360 } from '@/lib/import360/source'
import { profileCounts } from './profiles'
import type { AccountSnap, Ent360, Progress, Snapshot, UserSnap } from './types'

type Row = Record<string, unknown>
const str = (v: unknown) => (v == null ? '' : String(v).trim())
const day = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null)
const LIST_CAP = 40
const SUBMEDIA = 300
const MEDIA = 301
/** Restrictions not shown: data tables and time. */
const HIDDEN = [63, 700]

/** 360's own names for the restricted entity types are internal ("adtable", "time"); these read better. */
const TYPE_LABEL: Record<number, string> = { 63: 'Data tables', 300: 'Submedia', 500: 'Markets', 700: 'Time', 102: 'Parents', 103: 'Categories', 135: 'Subcategories', 118: 'Advertisers', 139: 'Brands', 373: 'Properties' }

export async function load360(progress: Progress): Promise<Snapshot> {
  await progress('Reading 360 clients', 0, 6)
  const sets = await q360<Row>(`SELECT s.usrset_id, s.usrset_n, s.mnemonic_a, s.active_f, s.availableyears, s.application_id, a.application_n, l.LicenseGrp_n
    FROM iddb_ar.dbo.USRSET s
    LEFT JOIN iddb_ar.dbo.LICENSEGRP l ON l.LicenseGrp_id = s.licensegrp_id
    LEFT JOIN iddb_ar.dbo.APPLICATION a ON a.application_id = s.application_id`)

  await progress('Reading 360 users', 1, 6)
  const users = await q360<Row>(`SELECT u.Usr_id, u.usrset_id, u.Usr_n, u.active_f, u.admin_f, m.first_n, m.last_n, m.login_n, m.email_s, m.active_f AS m_active
    FROM iddb_ar.dbo.USR u
    OUTER APPLY (SELECT TOP 1 x.masteruser_id FROM iddb_ar.dbo.MASTERUSER_XREF x WHERE x.usr_id = u.Usr_id ORDER BY x.active_f DESC) x
    LEFT JOIN iddb_ar.dbo.MASTERUSER m ON m.masteruser_id = x.masteruser_id`)
  const seen = new Map<string, string>()
  // And how many sessions in the last 30 days (Scott, 20 November 2026: sort by recent logins).
  const recent = new Map<string, number>()
  for (const r of await q360<Row>(`SELECT username_s, MAX(created_d) AS d, SUM(CASE WHEN created_d >= DATEADD(day, -30, GETDATE()) THEN 1 ELSE 0 END) AS n30 FROM (
      SELECT username_s, created_d FROM iddb_ar.dbo.LOGIN_SESSION_ARCHIVE WHERE created_d >= '2025-01-01'
      UNION ALL SELECT username_s, created_d FROM iddb_ar.dbo.LOGIN_SESSION) s GROUP BY username_s`)) {
    seen.set(str(r.username_s).toLowerCase(), day(r.d)!)
    if (Number(r.n30)) recent.set(str(r.username_s).toLowerCase(), Number(r.n30))
  }

  await progress('Counting 360 reports used in 2026', 2, 6)
  const reportsByUser = new Map<number, number>()
  for (const c of await liveReportCounts()) reportsByUser.set(c.usrId, (reportsByUser.get(c.usrId) ?? 0) + c.n)

  const profiles = await profileCounts()

  await progress('Reading 360 features', 3, 6)
  const features = new Map<number, string[]>()
  for (const r of await q360<Row>(`SELECT uf.usrset_id, f.feature_n FROM iddb_ar.dbo.USRSET_FEATURE uf JOIN iddb_ar.dbo.FEATURE f ON f.feature_id = uf.feature_id WHERE uf.active_f = 1 AND f.active_f = 1`)) {
    const id = Number(r.usrset_id)
    ;(features.get(id) ?? features.set(id, []).get(id)!).push(str(r.feature_n))
  }

  await progress('Reading 360 restrictions', 4, 6)
  // Data tables (63) and time (700) say nothing useful about a client (Scott, 20 November 2026): left out.
  const filters = await q360<Row>(`SELECT fs.usrset_id, f.entmaj_id, f.master_id, f.include_f FROM iddb_ar.dbo.FILTER f JOIN iddb_ar.dbo.FILTERSET fs ON fs.filterset_id = f.filterset_id WHERE fs.active_f = 1 AND f.entmaj_id NOT IN (${HIDDEN.join(', ')})`)
  // Submedia roll up to media (Scott: "roll it up to MEDIA, not submedia"): iddb_master submedia_ai.media_id.
  const mediaOfSubmedia = new Map<number, string>()
  const mediaName = new Map<number, string>()
  for (const r of await q360<Row>(`SELECT s.submedia_id, m.media_id, m.media_n FROM iddb_master.dbo.submedia_ai s JOIN iddb_master.dbo.media m ON m.media_id = s.media_id`)) {
    mediaOfSubmedia.set(Number(r.submedia_id), str(r.media_n))
    mediaName.set(Number(r.media_id), str(r.media_n))
  }
  const typeName = new Map<number, string>()
  for (const r of await q360<{ id: number; n: string }>(META_SQL.find(([e]) => e === -1)![1])) typeName.set(Number(r.id), str(r.n))
  const where = new Map((await q360<{ entmaj_id: number; table_n: string; id_field: string; name_field: string }>(NAME_FIELDS_SQL)).map((f) => [Number(f.entmaj_id), f]))
  const want = new Map<number, Set<number>>()
  for (const f of filters) (want.get(Number(f.entmaj_id)) ?? want.set(Number(f.entmaj_id), new Set()).get(Number(f.entmaj_id))!).add(Number(f.master_id))
  const names = new Map<string, string>()
  for (const [e, ids] of want) {
    const f = where.get(e)
    if (!f) continue
    for (const part of chunks([...ids], 2000)) {
      const text = namesSql(f, part)
      if (!text) break
      for (const r of await q360<{ id: number; n: string | null }>(text)) if (str(r.n)) names.set(`${e}:${Number(r.id)}`, str(r.n))
    }
  }

  await progress('Putting 360 together', 5, 6)
  const restrict = new Map<number, Map<number, { include: string[]; exclude: string[] }>>()
  const media = new Map<number, { include: Set<string>; exclude: Set<string> }>()
  for (const f of filters) {
    const set = Number(f.usrset_id)
    const e = Number(f.entmaj_id)
    if (e === SUBMEDIA || e === MEDIA) {
      const id = Number(f.master_id)
      const m = e === SUBMEDIA ? mediaOfSubmedia.get(id) : mediaName.get(id)
      // Three submedia ids in FILTER exist nowhere in 360 any more (retired): left out rather than shown as numbers.
      if (!m) continue
      const x = media.get(set) ?? media.set(set, { include: new Set(), exclude: new Set() }).get(set)!
      ;(Number(f.include_f) === 0 ? x.exclude : x.include).add(m)
      continue
    }
    const bySet = restrict.get(set) ?? restrict.set(set, new Map()).get(set)!
    const r = bySet.get(e) ?? bySet.set(e, { include: [], exclude: [] }).get(e)!
    const name = names.get(`${e}:${Number(f.master_id)}`) ?? `#${f.master_id}`
    ;(Number(f.include_f) === 0 ? r.exclude : r.include).push(name)
  }

  const out: UserSnap[] = []
  const tally = new Map<number, { users: number; active: number; reports: number }>()
  const setActive = new Map(sets.map((s) => [Number(s.usrset_id), Number(s.active_f) === 1]))
  for (const u of users) {
    const set = Number(u.usrset_id)
    if (!setActive.has(set)) continue
    const login = str(u.login_n) || str(u.Usr_n)
    const email = str(u.email_s).toLowerCase() || (login.includes('@') ? login.toLowerCase() : '')
    const active = Number(u.active_f) === 1 && u.m_active !== 0 && u.m_active !== false && setActive.get(set) === true
    const name = [str(u.first_n), str(u.last_n)].filter(Boolean).join(' ') || str(u.Usr_n) || login
    out.push({
      accountId: String(set),
      userId: String(Number(u.Usr_id)),
      name,
      login: login || null,
      email: email || null,
      active,
      lastSeen: seen.get(login.toLowerCase()) ?? null,
      reports: reportsByUser.get(Number(u.Usr_id)) ?? 0,
      profiles: profiles.get(Number(u.Usr_id)) ?? 0,
      logins30: recent.get(login.toLowerCase()) ?? 0,
    })
    const t = tally.get(set) ?? tally.set(set, { users: 0, active: 0, reports: 0 }).get(set)!
    t.users++
    t.reports += reportsByUser.get(Number(u.Usr_id)) ?? 0
    if (active) t.active++
  }

  const accounts: AccountSnap[] = sets.map((s) => {
    const id = Number(s.usrset_id)
    const app = str(s.application_n) || `Application ${s.application_id}`
    const years = s.availableyears == null ? null : Number(s.availableyears)
    const feats = (features.get(id) ?? []).sort()
    const r = [...(restrict.get(id) ?? new Map())]
      .map(([e, v]) => ({ type: TYPE_LABEL[e] ?? (typeName.get(e) || `Entity type ${e}`), include: v.include.slice(0, LIST_CAP), exclude: v.exclude.slice(0, LIST_CAP), count: v.include.length + v.exclude.length }))
      .sort((a, b) => a.type.localeCompare(b.type))
    const m = media.get(id)
    const ent: Ent360 = { kind: '360', application: app, years, media: m ? { include: [...m.include].sort(), exclude: [...m.exclude].sort() } : null, features: feats, filters: r }
    const reports = tally.get(id)?.reports ?? 0
    return {
      accountId: String(id),
      name: str(s.usrset_n) || `User set ${id}`,
      company: str(s.LicenseGrp_n) || null,
      active: Number(s.active_f) === 1,
      reports,
      summary: summary360(ent),
      entitlements: ent,
      info: { mnemonic: str(s.mnemonic_a).toLowerCase(), users: tally.get(id)?.users ?? 0 },
    }
  })
  await progress('360 read', 6, 6)
  return { accounts, users: out, reports: [] }
}

/** "Ad Insights - US - Media Buyer" -> "Media Buyer". */
const appShort = (a: string) => a.replace(/^Ad Insights\s*-\s*(US\s*-\s*)?/i, '')

/** A media restriction in a few words: what is in, or what is kept out. */
export function media360(m: NonNullable<Ent360['media']>): string {
  const list = (xs: string[]) => xs.slice(0, 4).join(', ') + (xs.length > 4 ? ` +${xs.length - 4}` : '')
  if (m.include.length) return list(m.include)
  return m.exclude.length ? `all but ${list(m.exclude)}` : 'all'
}

export function summary360(e: Ent360): string {
  const parts = [appShort(e.application)]
  if (e.years) parts.push(`${e.years} yr`)
  parts.push(e.media ? `Media: ${media360(e.media)}` : 'All media')
  if (e.filters.length) parts.push(e.filters.map((f) => `${f.type} ${f.count}`).slice(0, 3).join(', ') + (e.filters.length > 3 ? ` +${e.filters.length - 3}` : ''))
  if (e.features.length) parts.push(`${e.features.length} feature${e.features.length === 1 ? '' : 's'}`)
  return parts.join(' · ')
}
