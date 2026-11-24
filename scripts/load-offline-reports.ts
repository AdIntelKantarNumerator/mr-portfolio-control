/**
 * Load who receives Magnifier's offline reports, for Client Evaluation's Migration Plans.
 *
 *   npm run load:offline                               # into DATABASE_URL (or local PGlite)
 *
 * Magnifier's offline reports (custom weekly FastTrack, monthly and quarterly workbooks) are kept in its Oracle
 * back end, not its MySQL: CUSTOMER.CRM_REPORT_CONFIG is the reports, CRM_REPORTS who subscribes (by CCID) and
 * when they last downloaded, CRM_PEOPLE the person behind a CCID, with their email. A client with someone who
 * downloaded one in 2026 gets the Competitive package (Scott, 24 November 2026: about 198 clients, close to the
 * count he knows of).
 *
 * Reads Oracle through ../oracle-query.py (read-only; Oracle 11.2 needs thick mode on Instant Client, and the
 * password stays in ../.oracle.env), so it runs from a machine with both: the deployed app has neither. Replaces
 * ce_offline_reports whole. People are kept by email; the plan matches them to its users by email.
 */
import 'dotenv/config'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connect, warnIfServerRunning } from './_connect'

const HELPER = process.env.ORACLE_QUERY ?? join(process.cwd(), '..', 'oracle-query.py')

// Live subscriptions (DELETE_FLAG N), one row per subscriber's email: their latest download and one report's name.
const SQL = `
SELECT LOWER(TRIM(p.EMAIL_ADDRESS)) AS email,
  TO_CHAR(MAX(r.IREPORT_DOWNLOADDATE), 'YYYY-MM-DD') AS last_download,
  COUNT(DISTINCT r.RID) AS reports,
  MAX(c.REPORT_NAME) KEEP (DENSE_RANK LAST ORDER BY r.IREPORT_DOWNLOADDATE NULLS FIRST) AS example
FROM CUSTOMER.CRM_REPORTS r
JOIN CUSTOMER.CRM_PEOPLE p ON p.CCID = r.CCID
LEFT JOIN CUSTOMER.CRM_REPORT_CONFIG c ON c.RID = r.RID
WHERE r.DELETE_FLAG = 'N' AND p.EMAIL_ADDRESS IS NOT NULL AND INSTR(p.EMAIL_ADDRESS, '@') > 0
GROUP BY LOWER(TRIM(p.EMAIL_ADDRESS))`

function readOracle(): Array<{ email: string; lastDownload: string | null; reports: number; example: string | null }> {
  const dir = mkdtempSync(join(tmpdir(), 'offline-'))
  try {
    const file = join(dir, 'q.sql')
    writeFileSync(file, SQL)
    const out = execFileSync('python', [HELPER, '-f', file, '--max-rows', '200000'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
    // The helper prints "-- N row(s)", then a header, then tab-separated rows.
    const lines = out.split(/\r?\n/).filter((l) => l && !l.startsWith('--'))
    const head = lines.shift()?.toLowerCase().split('\t') ?? []
    const col = (name: string) => head.indexOf(name)
    if (col('email') < 0) throw new Error(`Unexpected output from ${HELPER}: ${out.slice(0, 300)}`)
    return lines.map((l) => {
      const f = l.split('\t')
      const v = (name: string) => (f[col(name)] ?? '').trim()
      return { email: v('email'), lastDownload: v('last_download') || null, reports: Number(v('reports')) || 0, example: v('example') || null }
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

async function main() {
  const rows = readOracle().filter((r) => r.email.includes('@'))
  const byEmail = new Map(rows.map((r) => [r.email, r]))
  const { db, close, embedded } = await connect()
  const s = await import('../src/db/schema')
  try {
    const all = [...byEmail.values()]
    await db.transaction(async (tx) => {
      await tx.delete(s.ceOfflineReports)
      const now = new Date()
      for (let i = 0; i < all.length; i += 2000) await tx.insert(s.ceOfflineReports).values(all.slice(i, i + 2000).map((r) => ({ ...r, loadedAt: now })))
    })
    const recent = all.filter((r) => r.lastDownload && r.lastDownload >= '2026-01-01').length
    console.log(`Loaded ${all.length} offline-report subscribers; ${recent} downloaded a report in 2026.`)
    await warnIfServerRunning(embedded)
  } finally {
    await close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
