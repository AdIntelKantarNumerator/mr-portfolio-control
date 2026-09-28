import { HealthTile } from './health-tile'
import { ListTile } from './tile'
import { ReadinessTile } from './readiness-tile'
import type { DetailData } from '@/lib/detail'

/**
 * The body of every detail page, in one order.
 *
 * Health beside the latest updates, because "how is it going" and "what has
 * happened" are the two questions people arrive with and neither answers the
 * other. Then the two registers that name work somebody has to do — blockers
 * and decisions — then the two that name work somebody has promised. Then the
 * checklist, and only when something on it is outstanding.
 *
 * The tiers differ in what rolls up into these, never in which tiles appear
 * or what order they are in. A reader who has learned the project page has
 * learned all three.
 */
export function DetailBody({
  tier,
  data,
  canEdit,
}: {
  /** "Project" | "Workstream" | "Initiative" — used in two tile titles. */
  tier: string
  data: DetailData
  canEdit: boolean
}) {
  return (
    <>
      <div className="tiles">
        <HealthTile
          tier={tier}
          assessmentId={data.health.assessmentId}
          rag={data.health.rag}
          confidence={data.health.confidence}
          summary={data.health.summary}
          authoredBy={data.health.authoredBy}
          stakeholder={data.stakeholder}
          engineering={data.engineering}
          evidence={data.evidence}
          pct={data.health.pct}
          expected={data.health.expected}
          canEdit={canEdit}
        />

        <ListTile
          title={`${tier} Updates`}
          icon="updates"
          items={data.updates}
          perPage={5}
          empty="Nothing reported yet. Silence here means nothing was found, not that nothing happened."
        />
      </div>

      <div className="tiles">
        <ListTile title="Blockers" icon="blocker" items={data.blockers} empty="Nothing is blocked." />
        <ListTile title="Decisions" icon="decision" items={data.decisions} empty="No decisions recorded." />
      </div>

      <div className="tiles">
        <ListTile title="Action Items" icon="action" items={data.actions} empty="No open actions." />
        <ListTile
          title="Dependencies"
          icon="dependency"
          items={data.dependencies}
          empty="Nothing is waiting on anything."
        />
      </div>

      {data.readiness && (
        <div className="tiles">
          <ReadinessTile
            workstreamId={data.readiness.workstreamId}
            gates={data.readiness.gates}
            href={`/readiness/${data.readiness.workstreamId}`}
          />
        </div>
      )}
    </>
  )
}
