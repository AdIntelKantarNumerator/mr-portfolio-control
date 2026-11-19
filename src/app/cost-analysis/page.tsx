/**
 * Cost Analysis (Scott, 16 November 2026): a typical day of cloud cost, pinned
 * to the components on the Workflow map, and what a decision would do to it.
 * Admins only for now (lib/access-rules.ts ADMIN_PATHS).
 *
 * Not a cost tracker: Datadog is that. This page is for the question asked
 * before a decision — more coverage, a backfill, deeper dedup, a cheaper
 * model — "what does it add, or save?" The arithmetic is lib/cost-model.ts;
 * the baseline is lib/datadog-cost.ts, or the 5–11 November snapshot until
 * Datadog is connected.
 */
import { Kicker } from '@/components/ui'
import { COST_COMPONENTS, typicalDay } from '@/lib/cost-model'
import { readCostSource } from '@/lib/datadog-cost'
import { readWorkflowMap } from '@/lib/workflow'
import { CostAnalysis } from './analysis'

export const metadata = { title: 'Cost Analysis' }
export const dynamic = 'force-dynamic'

export default async function CostAnalysisPage() {
  const [source, map] = await Promise.all([readCostSource(), readWorkflowMap()])
  const baseline = typicalDay(source.rows, source.today)

  return (
    <div className="stack">
      <div className="titlerow">
        <div>
          <Kicker>Reference · admins only</Kicker>
          <h1>Cost Analysis</h1>
        </div>
      </div>
      <CostAnalysis
        baseline={baseline}
        source={{ kind: source.kind, error: source.error ?? null, readAt: source.readAt }}
        defs={COST_COMPONENTS}
        map={{
          groups: map.groups.map((g) => ({ key: g.key, name: g.name })),
          components: map.components.map((c) => ({ id: c.id, name: c.name, groupKey: c.groupKey, kind: c.kind })),
          links: map.links.map((l) => ({ from: l.from, to: l.to })),
        }}
      />
    </div>
  )
}
