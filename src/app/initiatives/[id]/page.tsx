/**
 * One initiative. Same page as a project, one tier up.
 *
 * It keeps two things the other tiers do not have: the projects inside it,
 * and the form that renames or retires it. Everything else - health, updates,
 * the registers, readiness - rolls up from the work underneath, because the
 * grouping tier owns almost no records of its own.
 */
import { notFound } from 'next/navigation'
import { asc, eq, inArray } from 'drizzle-orm'
import { db } from '@/db/client'
import { initiatives, projects, workstreams } from '@/db/schema'
import { isEnded } from '@/lib/domain'
import { DetailHead } from '@/components/detail-head'
import { DetailBody } from '@/components/detail/body'
import { MilestoneEditor } from '@/components/milestone-editor'
import { milestoneRows } from '@/lib/milestone-rows'
import { getDetail } from '@/lib/detail'
import { getCurrentUser } from '@/lib/auth/current-user'
import { EditInitiative } from './edit'

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

export default async function InitiativeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const [row] = await db.select().from(initiatives).where(eq(initiatives.id, id)).limit(1)
  if (!row) notFound()

  const [mine, data, plan, user] = await Promise.all([
    db.select().from(projects).where(eq(projects.initiativeId, id)).orderBy(asc(projects.name)),
    getDetail('initiative', id),
    milestoneRows('initiative', id),
    getCurrentUser(),
  ])

  const streams = mine.length
    ? await db
        .select({ id: workstreams.id, projectId: workstreams.projectId, status: workstreams.status })
        .from(workstreams)
        .where(inArray(workstreams.projectId, mine.map((m) => m.id)))
    : []

  const countFor = new Map<string, number>()
  for (const s of streams) {
    if (!s.projectId || isEnded(s.status)) continue
    countFor.set(s.projectId, (countFor.get(s.projectId) ?? 0) + 1)
  }

  const live = mine.filter((x) => !isEnded(x.status))

  return (
    <div className="stack">
      <DetailHead
        tier={{ label: 'Initiative', href: '/initiatives' }}
        name={row.name}
        status={{
          level: 'initiative',
          id: row.id,
          value: row.status,
          label: STATUS.find((s) => s.value === row.status)?.label ?? row.status,
          tone: TONE[row.status] ?? 'var(--line-2)',
          options: STATUS,
        }}
      >
        <div className="ir-facts dfacts">
          <span>
            <i>Projects</i>
            {live.length} active of {mine.length}
          </span>
          <span>
            <i>Workstreams</i>
            {streams.filter((s) => !isEnded(s.status)).length}
          </span>
        </div>
        {row.description ? <p className="dnote">{row.description}</p> : null}
      </DetailHead>

      <MilestoneEditor level="initiative" entityId={id} milestones={plan} />

      <DetailBody tier="Initiative" data={data} canEdit={Boolean(user.personId)} />

      <EditInitiative
        initiative={{ id: row.id, name: row.name, description: row.description ?? '', status: row.status }}
      />
    </div>
  )
}
