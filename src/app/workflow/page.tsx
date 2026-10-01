/**
 * Workflow Assessment: what our software and our people depend on, and so
 * what a change is likely to reach.
 *
 * The map is grouped by default — a dozen stages and lanes rather than sixty
 * boxes — because the first question is usually "which part of the company
 * does this touch", and the component view answers the second one. Both are
 * the same data, laid out from the links every time (lib/workflow-map.ts).
 *
 * Beside it, the assessment chat: describe a change in plain words, and the
 * answer names what changes directly, what is likely and what is possibly
 * affected, lit on the map. It reads the map as it is at the moment of asking,
 * so an edit made a minute ago shapes the next answer; and each answer
 * remembers what it relied on, so an older one says when the map has moved on
 * since (lib/assessment.ts).
 */
import { Kicker } from '@/components/ui'
import { providerDescription } from '@/lib/llm'
import { readAssessments, readWorkflowMap } from '@/lib/workflow'
import { WorkflowMap } from './map'

export const metadata = { title: 'Workflow Assessment' }
export const dynamic = 'force-dynamic'

export default async function WorkflowPage() {
  const [map, assessments] = await Promise.all([readWorkflowMap(), readAssessments(20)])

  return (
    <div className="stack">
      <div className="titlerow">
        <div>
          <Kicker>Reference</Kicker>
          <h1>Workflow Assessment</h1>
        </div>
      </div>
      <WorkflowMap
        groups={map.groups}
        components={map.components}
        links={map.links}
        assessments={assessments}
        answeredBy={providerDescription('questions')}
      />
    </div>
  )
}
