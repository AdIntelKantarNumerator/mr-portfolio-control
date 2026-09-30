/**
 * One initiative.
 *
 * Thin on purpose: the shape of a detail page lives in components/detail and
 * the data behind it in lib/detail, so this file says what an initiative is and
 * nothing about how a tile is drawn. The project and objective pages are
 * the same file with two words changed, which is the point - the three tiers
 * used to be three different screens.
 */
import { notFound } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { objectives } from '@/db/schema'
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
import { LifecycleControl } from '@/app/lifecycle/control'

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
// What a <input type="date"> takes, and what an empty one means: no typed
// date, so that end of the window comes from the work beneath.
const ymd = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : '')

export default async function InitiativeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [p, data, plan, user, adding] = await Promise.all([
    getPortfolio(),
    getDetail('initiative', id),
    milestoneRows('initiative', id),
    getCurrentUser(),
    addContext(),
  ])

  const i = p.initiatives.find((x) => x.id === id)
  if (!i) notFound()

  const [parent] = i.objectiveId
    ? await db
        .select({ id: objectives.id, name: objectives.name })
        .from(objectives)
        .where(eq(objectives.id, i.objectiveId))
        .limit(1)
    : []

  const people = p.people.map((x) => ({ id: x.id, name: x.name }))

  return (
    <div className="stack">
      <DetailHead
        edit={
          user.personId ? (
            <EditRecordButton
              level="initiative"
              id={id}
              name={i.name}
              description={i.description ?? ''}
              parentId={i.objectiveId ?? null}
              parents={
                parent && !adding.objectives.some((o) => o.id === parent.id)
                  ? [...adding.objectives, parent]
                  : adding.objectives
              }
              window={{
                startDate: ymd(i.startDate),
                targetDate: ymd(i.targetDate),
                rolledStart: ymd(i.derivedStart),
                rolledTarget: ymd(i.derivedTarget),
              }}
            />
          ) : null
        }
        tier={{ label: 'Initiative', href: '/initiatives' }}
        name={i.name}
        parent={parent ? { label: 'in', name: parent.name, href: `/objectives/${parent.id}` } : null}
        orphan="Not in an objective"
        status={{
          level: 'initiative',
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
              level="initiative"
              id={i.id}
              rag={i.health.rag}
              rationale={i.health.rationale}
              evidence={i.health.evidence}
              origin={i.health.origin}
            />
          </span>
          <span>
            <i>Owner</i>
            <Editable level="initiative" id={i.id} field="owner" kind="person" people={people} value={i.owner?.name ?? null} prompt="no owner" />
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
            {!i.targetDate && i.derivedTarget ? <b title="Rolled up from the projects; nobody typed it.">rolled up</b> : null}
          </span>
        </div>
      </DetailHead>

      {user.personId ? <LifecycleControl kind="initiative" id={id} status={i.status} /> : null}

      <MilestoneEditor level="initiative" entityId={id} milestones={plan} />

      <DetailBody
        tier="Initiative"
        data={data}
        canEdit={Boolean(user.personId)}
        entity={{ entityType: 'initiative', entityId: id }}
        adding={{ level: 'initiative', entityId: id, ...adding }}
      />
    </div>
  )
}
