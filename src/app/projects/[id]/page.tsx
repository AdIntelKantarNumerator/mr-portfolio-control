/**
 * One project.
 *
 * Thin on purpose: the shape of a detail page lives in components/detail and
 * the data behind it in lib/detail, so this file says what a project is and
 * nothing about how a tile is drawn. The workstream and initiative pages are
 * the same file with two words changed, which is the point - the three tiers
 * used to be three different screens.
 */
import { notFound } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { initiatives } from '@/db/schema'
import { DetailHead } from '@/components/detail-head'
import { DetailBody } from '@/components/detail/body'
import { MilestoneEditor } from '@/components/milestone-editor'
import { milestoneRows } from '@/lib/milestone-rows'
import { getDetail } from '@/lib/detail'
import { getPortfolio } from '@/lib/portfolio'
import { getCurrentUser } from '@/lib/auth/current-user'
import { addContext } from '@/lib/add-context'
import { EditRecordButton } from '@/components/detail/edit-record'
import { HealthEditable } from '@/components/health-editable'
import { Editable } from '@/components/editable'
import { SourceBadge } from '@/components/ui'
import { calendarRange } from '@/lib/calendar-date'

export const dynamic = 'force-dynamic'

const STATUS = [
  { value: 'planned', label: 'Planned' },
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'completed', label: 'Completed' },
  { value: 'canceled', label: 'Canceled' },
]

const TONE: Record<string, string> = {
  planned: 'var(--line-2)',
  active: 'var(--c5)',
  paused: 'var(--c2)',
  completed: 'var(--c1)',
  canceled: 'var(--ended)',
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null)

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [p, data, plan, user, adding] = await Promise.all([
    getPortfolio(),
    getDetail('project', id),
    milestoneRows('project', id),
    getCurrentUser(),
    addContext(),
  ])

  const i = p.projects.find((x) => x.id === id)
  if (!i) notFound()

  const [parent] = i.initiativeId
    ? await db
        .select({ id: initiatives.id, name: initiatives.name })
        .from(initiatives)
        .where(eq(initiatives.id, i.initiativeId))
        .limit(1)
    : []

  const people = p.people.map((x) => ({ id: x.id, name: x.name }))

  return (
    <div className="stack">
      <DetailHead
        edit={
          user.personId ? (
            <EditRecordButton
              level="project"
              id={id}
              name={i.name}
              description={i.description ?? ''}
              parentId={i.initiativeId ?? null}
              parents={adding.initiatives}
            />
          ) : null
        }
        tier={{ label: 'Project', href: '/projects' }}
        name={i.name}
        parent={parent ? { label: 'in', name: parent.name, href: `/initiatives/${parent.id}` } : null}
        orphan="Not in an initiative"
        status={{
          level: 'project',
          id: i.id,
          value: i.status,
          label: STATUS.find((s) => s.value === i.status)?.label ?? i.status,
          tone: TONE[i.status] ?? 'var(--line-2)',
          options: STATUS,
        }}
        pills={i.sources.map((s) => (
          <SourceBadge key={`${s.system}-${s.url ?? ''}`} system={s.system} url={s.url} />
        ))}
      >
        <div className="ir-facts dfacts">
          <span>
            <HealthEditable
              level="project"
              id={i.id}
              rag={i.health.rag}
              rationale={i.health.rationale}
              evidence={i.health.evidence}
              origin={i.health.origin}
            />
          </span>
          <span>
            <i>Owner</i>
            <Editable level="project" id={i.id} field="owner" kind="person" people={people} value={i.owner?.name ?? null} prompt="no owner" />
          </span>
          {i.sponsor ? (
            <span>
              <i>Sponsor</i>
              {i.sponsor.name}
            </span>
          ) : null}
          <span>
            <i>Window</i>
            {calendarRange(iso(i.startDate ?? i.derivedStart), iso(i.targetDate ?? i.derivedTarget))}
            {!i.targetDate && i.derivedTarget ? <b title="Rolled up from the workstreams; nobody typed it.">rolled up</b> : null}
          </span>
        </div>
      </DetailHead>

      <MilestoneEditor level="project" entityId={id} milestones={plan} />

      <DetailBody
        tier="Project"
        data={data}
        canEdit={Boolean(user.personId)}
        entity={{ entityType: 'project', entityId: id }}
        adding={{ level: 'project', entityId: id, ...adding }}
      />
    </div>
  )
}
