/**
 * One objective. Same page as an initiative, one tier up.
 *
 * It keeps two things the other tiers do not have: the initiatives inside it,
 * and the form that renames or retires it. Everything else - health, updates,
 * the registers, readiness - rolls up from the work underneath, because the
 * grouping tier owns almost no records of its own.
 */
import { TIER_LABEL } from '@/lib/home-types'
import { notFound } from 'next/navigation'
import { asc, eq, inArray } from 'drizzle-orm'
import { db } from '@/db/client'
import { objectives, milestones, initiatives, projects } from '@/db/schema'
import { OBJECTIVE_STATUS, isEnded, tierStatusLabel } from '@/lib/domain'
import { DetailHead } from '@/components/detail-head'
import { DetailBody } from '@/components/detail/body'
import { MilestoneEditor } from '@/components/milestone-editor'
import { milestoneRows } from '@/lib/milestone-rows'
import { getDetail } from '@/lib/detail'
import { getCurrentUser } from '@/lib/auth/current-user'
import { addContext } from '@/lib/add-context'
import { EditRecordButton } from '@/components/detail/edit-record'
import { rollUpWindow } from '@/lib/rollup-window'
import { calendarRange } from '@/lib/calendar-date'
import { LifecycleControl } from '@/app/lifecycle/control'
import { objectiveFootprint } from '@/lib/objective-footprint'
import { deleteBlockers, describeRemoval } from '@/lib/objective-delete'

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null)
// What a <input type="date"> takes; empty means nobody typed one, so that end
// of the window comes from the work beneath.
const ymd = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : '')

export const dynamic = 'force-dynamic'

const STATUS = OBJECTIVE_STATUS.map((value) => ({ value, label: tierStatusLabel('objective', value) }))

const TONE: Record<string, string> = {
  planned: 'var(--line-2)',
  active: 'var(--c5)',
  paused: 'var(--c2)',
  completed: 'var(--c1)',
  canceled: 'var(--ended)',
}

export default async function ObjectiveDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const [row] = await db.select().from(objectives).where(eq(objectives.id, id)).limit(1)
  if (!row) notFound()

  const [mine, data, plan, user, adding] = await Promise.all([
    db.select().from(initiatives).where(eq(initiatives.objectiveId, id)).orderBy(asc(initiatives.name)),
    getDetail('objective', id),
    milestoneRows('objective', id),
    getCurrentUser(),
    addContext(),
  ])

  const streams = mine.length
    ? await db
        .select({ id: projects.id, initiativeId: projects.initiativeId, status: projects.status })
        .from(projects)
        .where(inArray(projects.initiativeId, mine.map((m) => m.id)))
    : []

  const countFor = new Map<string, number>()
  for (const s of streams) {
    if (!s.initiativeId || isEnded(s.status)) continue
    countFor.set(s.initiativeId, (countFor.get(s.initiativeId) ?? 0) + 1)
  }

  const live = mine.filter((x) => !isEnded(x.status))

  // Delete is always offered to editors, and says what has to move first when
  // something blocks it: a button that only appears on empty objectives is one
  // nobody finds. The action checks again, because this page can be minutes
  // old by the time somebody clicks.
  const footprint = user.personId ? await objectiveFootprint(id) : null
  const deletion = footprint
    ? {
        name: row.name,
        summary: describeRemoval(footprint),
        blockers: deleteBlockers({ initiativeCount: footprint.initiatives, decisionCount: footprint.decisions }),
      }
    : undefined

  /*
   * The window, rolled up the one way.
   *
   * Every dated thing beneath — the initiatives' own dates, and every milestone
   * at this tier or below — through the same function the initiative page and the
   * timeline use, so an objective cannot read one window here and be drawn
   * with another there. Ended children count: a window is a fact about the
   * work, not about which rows a screen is listing. See lib/rollup-window.ts.
   */
  const ms = await db
    .select({ targetDate: milestones.targetDate })
    .from(milestones)
    .where(inArray(milestones.entityId, [id, ...mine.map((m) => m.id), ...streams.map((s) => s.id)]))

  const win = rollUpWindow({ startDate: row.startDate, targetDate: row.targetDate }, [
    ...mine.flatMap((m) => [m.startDate, m.targetDate]),
    ...ms.map((m) => m.targetDate),
  ])

  return (
    <div className="stack">
      <DetailHead
        edit={
          user.personId ? (
            <EditRecordButton
              level="objective"
              id={id}
              name={row.name}
              description={row.description ?? ''}
              parentId={null}
              parents={[]}
              window={{
                startDate: ymd(row.startDate),
                targetDate: ymd(row.targetDate),
                rolledStart: row.startDate ? '' : ymd(win.start),
                rolledTarget: row.targetDate ? '' : ymd(win.end),
              }}
            />
          ) : null
        }
        tier={{ label: TIER_LABEL.objective, href: '/objectives' }}
        name={row.name}
        status={{
          level: 'objective',
          id: row.id,
          value: row.status,
          label: STATUS.find((s) => s.value === row.status)?.label ?? row.status,
          tone: TONE[row.status] ?? 'var(--line-2)',
          options: STATUS,
        }}
      >
        <div className="ir-facts dfacts">
          <span>
            <i>Initiatives</i>
            {live.length} active of {mine.length}
          </span>
          {win.start || win.end ? (
            <span>
              <i>Window</i>
              {calendarRange(iso(win.start), iso(win.end))}
              {win.rolledUp ? (
                <b title="Rolled up from the initiatives and milestones beneath; nobody typed it.">rolled up</b>
              ) : null}
            </span>
          ) : null}
          <span>
            <i>Projects</i>
            {streams.filter((s) => !isEnded(s.status)).length}
          </span>
        </div>
        {row.description ? <p className="dnote">{row.description}</p> : null}
      </DetailHead>

      {user.personId ? (
        <LifecycleControl
          kind="objective"
          id={id}
          status={row.status}
          liveChildren={live.length}
          deletion={deletion}
        />
      ) : null}

      <MilestoneEditor level="objective" entityId={id} milestones={plan} />

      <DetailBody
        tier={TIER_LABEL.objective}
        data={data}
        canEdit={Boolean(user.personId)}
        entity={{ entityType: 'objective', entityId: id }}
        adding={{ level: 'objective', entityId: id, ...adding }}
      />
    </div>
  )
}
