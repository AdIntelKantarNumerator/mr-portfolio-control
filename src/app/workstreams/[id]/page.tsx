/**
 * One workstream. Same page as a project, one tier down.
 */
import { notFound } from 'next/navigation'
import { DetailHead } from '@/components/detail-head'
import { DetailBody } from '@/components/detail/body'
import { MilestoneEditor } from '@/components/milestone-editor'
import { milestoneRows } from '@/lib/milestone-rows'
import { getDetail } from '@/lib/detail'
import { getPortfolio } from '@/lib/portfolio'
import { getCurrentUser } from '@/lib/auth/current-user'
import { addContext } from '@/lib/add-context'
import { HealthEditable } from '@/components/health-editable'
import { Editable } from '@/components/editable'
import { SourceBadge } from '@/components/ui'
import { calendarRange } from '@/lib/calendar-date'

export const dynamic = 'force-dynamic'

const STATUS = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'planned', label: 'Planned' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'paused', label: 'Paused' },
  { value: 'completed', label: 'Completed' },
  { value: 'canceled', label: 'Canceled' },
]

const PRIORITY = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
  { value: 'no_priority', label: 'None' },
]

const TONE: Record<string, string> = {
  backlog: 'var(--line-2)',
  planned: 'var(--line-2)',
  in_progress: 'var(--c5)',
  paused: 'var(--c2)',
  completed: 'var(--c1)',
  canceled: 'var(--ended)',
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null)

export default async function WorkstreamDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [p, data, plan, user, adding] = await Promise.all([
    getPortfolio(),
    getDetail('workstream', id),
    milestoneRows('workstream', id),
    getCurrentUser(),
    addContext(),
  ])

  const w = p.workstreams.find((x) => x.id === id)
  if (!w) notFound()

  const parent = w.projectId ? (p.projects.find((x) => x.id === w.projectId) ?? null) : null
  const people = p.people.map((x) => ({ id: x.id, name: x.name }))

  return (
    <div className="stack">
      <DetailHead
        tier={{ label: 'Workstream', href: '/workstreams' }}
        name={w.name}
        parent={parent ? { label: 'in', name: parent.name, href: `/projects/${parent.id}` } : null}
        orphan="Not under a project"
        status={{
          level: 'workstream',
          id: w.id,
          value: w.status,
          label: STATUS.find((s) => s.value === w.status)?.label ?? w.status,
          tone: TONE[w.status] ?? 'var(--line-2)',
          options: STATUS,
        }}
        pills={
          <>
            <Editable
              level="workstream"
              id={w.id}
              field="priority"
              kind="choice"
              options={PRIORITY}
              raw={w.priority ?? 'medium'}
              value={w.priority ? (PRIORITY.find((x) => x.value === w.priority)?.label ?? w.priority) : null}
              prompt="no priority"
              className="dpriority"
            />
            {w.sources.map((s) => (
              <SourceBadge key={`${s.system}-${s.url ?? ''}`} system={s.system} url={s.url} />
            ))}
          </>
        }
      >
        <div className="ir-facts dfacts">
          <span>
            <HealthEditable
              level="workstream"
              id={w.id}
              rag={w.health.rag}
              rationale={w.health.rationale}
              evidence={w.health.evidence}
              origin={w.health.origin}
            />
          </span>
          <span>
            <i>Lead</i>
            <Editable level="workstream" id={w.id} field="lead" kind="person" people={people} value={w.lead?.name ?? null} prompt="no lead" />
          </span>
          {w.team ? (
            <span>
              <i>Team</i>
              {w.team.name}
            </span>
          ) : null}
          <span>
            <i>Window</i>
            {calendarRange(iso(w.startDate), iso(w.targetDate))}
          </span>
        </div>
      </DetailHead>

      <MilestoneEditor level="workstream" entityId={id} milestones={plan} />

      <DetailBody
        tier="Workstream"
        data={data}
        canEdit={Boolean(user.personId)}
        entity={{ entityType: 'workstream', entityId: id }}
        adding={{ level: 'workstream', entityId: id, ...adding }}
      />
    </div>
  )
}
