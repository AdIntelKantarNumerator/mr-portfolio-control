/**
 * Take a copy of a ClickHouse catalog and send it to the portfolio
 * (Scott, 2 November 2026).
 *
 *   npm run dictionary:snapshot -- prod            read Prod, send it
 *   npm run dictionary:snapshot -- prod --dry-run  read Prod, say what it would send
 *
 * Run from a machine that can reach the cluster - for Prod today, a laptop on
 * the VPN. Needs CLICKHOUSE_<ENV>_URL/_USER/_PASSWORD, and for sending,
 * SYNC_TOKEN and PORTFOLIO_URL (default the production site). The reads are
 * the same guarded, readonly=2 reads the site makes (lib/dictionary-live.ts);
 * what is sent is structure only - names, types, counts, last writes - never
 * a row. The site shows it, marked static with this time, while
 * CLICKHOUSE_<ENV>_SOURCE=snapshot.
 */
import { clickhouseConfig } from '../src/lib/clickhouse'
import { readAllLiveColumns, readLiveCatalog } from '../src/lib/dictionary-live'
import { readEnvironment } from '../src/lib/dictionary-rules'

async function main() {
  const args = process.argv.slice(2)
  const env = readEnvironment(args.find((a) => !a.startsWith('--')) ?? 'prod')
  const dryRun = args.includes('--dry-run')
  const config = clickhouseConfig(env)
  if (!config) throw new Error(`CLICKHOUSE_${env.toUpperCase()}_URL is not set.`)

  const started = Date.now()
  const [catalog, columns] = await Promise.all([readLiveCatalog(config), readAllLiveColumns(config)])
  const columnCount = Object.values(columns).reduce((n, c) => n + c.length, 0)
  console.log(`Read ${env} (${config.url}) in ${((Date.now() - started) / 1000).toFixed(1)}s: ${catalog.databases.length} databases, ${catalog.tables.length} tables, ${columnCount} columns.`)
  if (dryRun) return

  const base = (process.env.PORTFOLIO_URL?.trim() || 'https://mr-portfolio-control.azurewebsites.net').replace(/\/+$/, '')
  const token = process.env.SYNC_TOKEN?.trim()
  if (!token) throw new Error('SYNC_TOKEN is not set.')
  const res = await fetch(`${base}/api/sync/dictionary-snapshot`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ env, takenAt: catalog.readAt, takenBy: process.env.SNAPSHOT_BY?.trim() || null, catalog, columns }),
    signal: AbortSignal.timeout(120_000),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${base} answered ${res.status}: ${text.slice(0, 300)}`)
  console.log(`Sent to ${base}: ${text}`)
}

main().catch((err) => {
  console.error((err as Error).message)
  process.exit(1)
})
