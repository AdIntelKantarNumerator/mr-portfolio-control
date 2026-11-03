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
 * the same guarded, readonly=2 reads the site makes (lib/dictionary-live.ts):
 * names, types, counts, last writes, and since 3 November 2026 the first rows
 * of each table, as the Preview tab reads them, with long values cut
 * (trimSample). The site shows it, marked static with this time, while
 * CLICKHOUSE_<ENV>_SOURCE=snapshot.
 */
import { clickhouseConfig } from '../src/lib/clickhouse'
import { clickhouseMessage, readAllLiveColumns, readLiveCatalog, readLivePreview } from '../src/lib/dictionary-live'
import { previewProblem, readEnvironment } from '../src/lib/dictionary-rules'
import { trimSample, type StoredPreview } from '../src/lib/dictionary-snapshot'

/** Six tables at a time: quick, without asking the cluster for 460 reads at once. */
async function samples(config: NonNullable<ReturnType<typeof clickhouseConfig>>, tables: Array<{ database: string; name: string; ref: string; engine: string }>) {
  const out: Record<string, StoredPreview> = {}
  const queue = tables.filter((t) => !previewProblem(t.engine))
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      for (let t = queue.shift(); t; t = queue.shift()) {
        try {
          const p = await readLivePreview(config, t.database, t.name)
          out[t.ref] = { columns: p.columns, rows: trimSample(p.rows) }
        } catch (err) {
          out[t.ref] = { error: clickhouseMessage(err).slice(0, 300) }
        }
      }
    }),
  )
  return out
}

async function main() {
  const args = process.argv.slice(2)
  const env = readEnvironment(args.find((a) => !a.startsWith('--')) ?? 'prod')
  const dryRun = args.includes('--dry-run')
  const config = clickhouseConfig(env)
  if (!config) throw new Error(`CLICKHOUSE_${env.toUpperCase()}_URL is not set.`)

  const started = Date.now()
  const [catalog, columns] = await Promise.all([readLiveCatalog(config), readAllLiveColumns(config)])
  const previews = await samples(config, catalog.tables)
  const columnCount = Object.values(columns).reduce((n, c) => n + c.length, 0)
  const sampled = Object.values(previews).filter((p) => !('error' in p)).length
  const failed = Object.entries(previews).filter(([, p]) => 'error' in p)
  const body = JSON.stringify({ env, takenAt: catalog.readAt, takenBy: process.env.SNAPSHOT_BY?.trim() || null, catalog, columns, previews })
  console.log(
    `Read ${env} (${config.url}) in ${((Date.now() - started) / 1000).toFixed(1)}s: ${catalog.databases.length} databases, ${catalog.tables.length} tables, ${columnCount} columns, ` +
      `${sampled} samples${failed.length ? ` (${failed.length} tables would not show rows)` : ''}; ${(body.length / 1_048_576).toFixed(1)} MB to send.`,
  )
  for (const [ref, p] of failed.slice(0, 5)) console.log(`  ${ref}: ${'error' in p ? p.error.slice(0, 140) : ''}`)
  if (dryRun) return

  const base = (process.env.PORTFOLIO_URL?.trim() || 'https://mr-portfolio-control.azurewebsites.net').replace(/\/+$/, '')
  const token = process.env.SYNC_TOKEN?.trim()
  if (!token) throw new Error('SYNC_TOKEN is not set.')
  const res = await fetch(`${base}/api/sync/dictionary-snapshot`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body,
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
