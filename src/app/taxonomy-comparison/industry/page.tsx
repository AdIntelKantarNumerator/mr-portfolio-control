/**
 * Taxonomy Comparison › Industry View (Scott, 9 November 2026).
 *
 * The GPC taxonomy as a tree on the left; pick a node and its top 50
 * spenders in Aug–Sep 2026 show on the right, as products, brands,
 * advertisers or parents (lib/taxonomy-industry-rules.ts). The tree is read
 * from Databricks once and kept; so is each node once someone opens it.
 */
import { Kicker } from '@/components/ui'
import { editor } from '@/lib/auth/editor'
import type { IndustryResult, TaxNode } from '@/lib/taxonomy-industry-rules'
import { nodeKey, readIndustry, startIndustry, TREE_KEY } from '@/lib/taxonomy-industry'
import { TaxonomyTabs } from '../tabs'
import { IndustryExplorer } from './industry'

export const metadata = { title: 'Industry View · Taxonomy Comparison' }
export const dynamic = 'force-dynamic'

type Search = Promise<Record<string, string | string[] | undefined>>

export default async function IndustryViewPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams
  const nodeId = typeof sp.node === 'string' && /^\d{1,12}$/.test(sp.node) ? sp.node : null

  // The tree, read once for everybody; the first visitor starts the read.
  let tree = await readIndustry<TaxNode[]>(TREE_KEY)
  if (!tree || tree.status === 'failed') {
    const who = await editor()
    await startIndustry(TREE_KEY, who.ok ? who.name : null, true)
    tree = await readIndustry<TaxNode[]>(TREE_KEY)
  }
  const node = nodeId ? await readIndustry<IndustryResult>(nodeKey(nodeId)) : null

  return (
    <div className="stack">
      <div className="titlerow">
        <div>
          <Kicker>Reference</Kicker>
          <h1>Taxonomy Comparison</h1>
        </div>
      </div>
      <TaxonomyTabs current="industry" />
      <IndustryExplorer initialTree={tree} initialNodeId={nodeId} initialNode={node} />
    </div>
  )
}
