/**
 * Workflow Assessment: what our software and our people depend on, and so
 * what a change is likely to reach.
 *
 * The map is grouped by default — a dozen stages and lanes rather than sixty
 * boxes — because the first question is usually "which part of the company
 * does this touch", and the component view answers the second one. Both are
 * the same data, laid out from the links every time (lib/workflow-map.ts).
 *
 * The assessment chat that will sit beside it is the next phase. It will
 * stand on exactly what this page already shows: a component's name, aliases
 * and description to match a request against, and the downstream walk the
 * card already draws.
 */
import { Kicker } from '@/components/ui'
import { readWorkflowMap } from '@/lib/workflow'
import { WorkflowMap } from './map'

export const metadata = { title: 'Workflow Assessment' }
export const dynamic = 'force-dynamic'

export default async function WorkflowPage() {
  const map = await readWorkflowMap()

  return (
    <div className="stack">
      <div className="titlerow">
        <div>
          <Kicker>Reference</Kicker>
          <h1>Workflow Assessment</h1>
        </div>
      </div>
      <WorkflowMap groups={map.groups} components={map.components} links={map.links} />
    </div>
  )
}
