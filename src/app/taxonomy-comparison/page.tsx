/**
 * Taxonomy Comparison (Scott, 29 October 2026; temporary).
 *
 * Pick a FROM taxonomy (VX1, VX2 or MediaRadar Classic), paste advertisers,
 * and see where each one's Aug–Sep 2026 dollars land in GPC — which GPC
 * advertisers and taxonomy nodes — as a Sankey per advertiser.
 * lib/taxonomy-run.ts does the work; this page starts it and shows it.
 */
import { Kicker } from '@/components/ui'
import { readRun } from '@/lib/taxonomy-run'
import { Comparison } from './comparison'

export const metadata = { title: 'Taxonomy Comparison' }
export const dynamic = 'force-dynamic'

type Search = Promise<Record<string, string | string[] | undefined>>

export default async function TaxonomyComparisonPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams
  const runId = typeof sp.run === 'string' ? sp.run : ''
  const run = runId ? await readRun(runId) : null

  return (
    <div className="stack">
      <div className="titlerow">
        <div>
          <Kicker>Reference</Kicker>
          <h1>Taxonomy Comparison</h1>
        </div>
      </div>
      <Comparison key={runId || 'new'} initial={run} />
    </div>
  )
}
