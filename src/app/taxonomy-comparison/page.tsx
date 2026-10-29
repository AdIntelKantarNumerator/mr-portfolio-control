/**
 * Taxonomy Comparison (Scott, 29 October 2026; temporary).
 *
 * Paste advertisers; see their Aug–Sep 2026 spend by media type in VX1, VX2,
 * GPC and MediaRadar Classic side by side, which entity was taken as the
 * advertiser in each, and where they disagree. lib/taxonomy-run.ts does the
 * work; this page starts it and shows it.
 */
import Link from 'next/link'
import { desc } from 'drizzle-orm'
import { db } from '@/db/client'
import { taxonomyRuns } from '@/db/schema'
import { Kicker } from '@/components/ui'
import { readRun } from '@/lib/taxonomy-run'
import { Comparison } from './comparison'

export const metadata = { title: 'Taxonomy Comparison' }
export const dynamic = 'force-dynamic'

type Search = Promise<Record<string, string | string[] | undefined>>

export default async function TaxonomyComparisonPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams
  const runId = typeof sp.run === 'string' ? sp.run : ''
  const [run, recent] = await Promise.all([
    runId ? readRun(runId) : null,
    db
      .select({ id: taxonomyRuns.id, input: taxonomyRuns.input, askedBy: taxonomyRuns.askedBy, status: taxonomyRuns.status, createdAt: taxonomyRuns.createdAt })
      .from(taxonomyRuns)
      .orderBy(desc(taxonomyRuns.createdAt))
      .limit(8),
  ])

  return (
    <div className="stack">
      <div className="titlerow">
        <div>
          <Kicker>Reference</Kicker>
          <h1>Taxonomy Comparison</h1>
        </div>
      </div>
      <Comparison key={runId || 'new'} initial={run} />
      {recent.length ? (
        <div className="tile">
          <div className="tile-head">
            <h2>Recent comparisons</h2>
          </div>
          <div className="tx-recent">
            {recent.map((r) => {
              const names = JSON.parse(r.input) as string[]
              return (
                <Link key={r.id} href={`/taxonomy-comparison?run=${r.id}`} className="tx-recent-row">
                  <span className="tx-recent-names">
                    {names.slice(0, 4).join(', ')}
                    {names.length > 4 ? ` +${names.length - 4}` : ''}
                  </span>
                  <span className="tx-muted">
                    {r.askedBy ?? ''} · {r.createdAt.toISOString().slice(0, 16).replace('T', ' ')} UTC
                    {r.status !== 'done' ? ` · ${r.status}` : ''}
                  </span>
                </Link>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}
