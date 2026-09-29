import { HealthTile } from './health-tile'
import { AddEntry, type AddContext, type EntryKind } from './add-entry'
import { NewChildButton } from './edit-record'
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
  entity,
  adding,
}: {
  /** "Project" | "Workstream" | "Initiative" — used in two tile titles. */
  tier: string
  data: DetailData
  canEdit: boolean
  /** Which record this page is, so an update can be sent somewhere else. */
  entity: { entityType: string; entityId: string }
  /** What an added register entry needs: who could own it, what it could point at. */
  adding?: AddContext
}) {
  // The "+" only where somebody can actually write. Offering it to a reader
  // who cannot save would be a control that fails on submit.
  const plus = (kind: EntryKind) =>
    canEdit && adding ? <AddEntry kind={kind} ctx={adding} /> : undefined

  // The same condition as the "+": a reader who cannot write should not be
  // offered a pencil that fails on save.
  const editable = (kind: 'blocker' | 'dependency') =>
    canEdit && adding ? { kind, ctx: { people: adding.people, endpoints: adding.endpoints } } : undefined

  return (
    <>
      {/* When there is a tier beneath, the right column carries the updates
          and then that list. A workstream has no tier beneath, so its updates
          tile stretches to the height of the health tile beside it rather
          than leaving a column of empty page. */}
      {/* The top row always squares off: whatever is in the right column ends
          level with the health tile, rather than leaving a gap of page beside
          it. */}
      <div className="tiles tiles-even">
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
          canEdit={canEdit}
        />

        <div className="tilecol">
          <ListTile
            title={`${tier} Updates`}
            icon="updates"
            items={data.updates}
            perPage={5}
            // Only this tile. A blocker or a decision is a record somebody
            // filed against this work on purpose; an update is Yaara's guess
            // about where something belongs, and the guess is the thing worth
            // being able to correct.
            correctable={canEdit ? entity : undefined}
            empty="Nothing reported yet. Silence here means nothing was found, not that nothing happened."
          />

          {data.children && (
            <ListTile
              title={data.children.title}
              icon={data.children.title === 'Projects' ? 'projects' : 'workstreams'}
              items={data.children.items}
              perPage={8}
              empty={`No ${data.children.title.toLowerCase()} yet.`}
              add={
                canEdit && (entity.entityType === 'initiative' || entity.entityType === 'project') ? (
                  <NewChildButton
                    level={entity.entityType === 'initiative' ? 'project' : 'workstream'}
                    parentId={entity.entityId}
                    label={data.children.title}
                  />
                ) : undefined
              }
            />
          )}
        </div>
      </div>

      <div className="tiles">
        <ListTile
          title="Blockers"
          icon="blocker"
          items={data.blockers}
          empty="Nothing is blocked."
          add={plus('blocker')}
          editable={editable('blocker')}
        />
        <ListTile
          title="Decisions"
          icon="decision"
          items={data.decisions}
          empty="No decisions recorded."
          add={plus('decision')}
        />
      </div>

      <div className="tiles">
        <ListTile
          title="Action Items"
          icon="action"
          items={data.actions}
          empty="No open actions."
          add={plus('action')}
        />
        <ListTile
          title="Dependencies"
          icon="dependency"
          items={data.dependencies}
          empty="Nothing is waiting on anything."
          add={plus('dependency')}
          editable={editable('dependency')}
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
