/**
 * One initiative: what it is, what is in it, and what has been done to it.
 *
 * Kept deliberately thin. The health picture lives on the home card, which is
 * built for exactly that question and would be a second, slightly different
 * answer if it were rebuilt here.
 */
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { and, desc, eq, asc } from 'drizzle-orm'
import { db } from '@/db/client'
import { initiatives, projects, workstreams, changelogEntries } from '@/db/schema'
import { Card, Empty, Kicker, Muted, Pill, type Tone } from '@/components/ui'
import { isEnded } from '@/lib/domain'
import { fmtDate } from '@/lib/util'
import { EditInitiative } from './edit'

export const dynamic = 'force-dynamic'

const TONE: Record<string, Tone> = {
  active: 'blue',
  paused: 'amber',
  completed: 'green',
  canceled: 'slate',
}

export default async function InitiativePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const [row] = await db.select().from(initiatives).where(eq(initiatives.id, id)).limit(1)
  if (!row) notFound()

  const [mine, streams, history] = await Promise.all([
    db.select().from(projects).where(eq(projects.initiativeId, id)).orderBy(asc(projects.name)),
    db.select({ id: workstreams.id, projectId: workstreams.projectId, status: workstreams.status }).from(workstreams),
    db
      .select()
      .from(changelogEntries)
      .where(and(eq(changelogEntries.entityType, 'initiative'), eq(changelogEntries.entityId, id)))
      .orderBy(desc(changelogEntries.at))
      .limit(20),
  ])

  const countFor = new Map<string, number>()
  for (const s of streams) {
    if (!s.projectId || isEnded(s.status)) continue
    countFor.set(s.projectId, (countFor.get(s.projectId) ?? 0) + 1)
  }

  const live = mine.filter((p) => !isEnded(p.status))

  return (
    <div className="stack">
      <div>
        <Kicker>
          <Link href="/initiatives">Initiatives</Link>
        </Kicker>
        <h1>{row.name}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={TONE[row.status] ?? 'slate'}>{row.status}</Pill>
          <Muted>
            {live.length} active project{live.length === 1 ? '' : 's'} of {mine.length}
          </Muted>
          <Link href="/?level=initiative" className="underline decoration-dotted underline-offset-2 text-sm">
            See its card on the home page →
          </Link>
        </div>
        {row.description && <p className="mt-2">{row.description}</p>}
      </div>

      <Card>
        <strong>Projects</strong>
        {mine.length === 0 ? (
          <Muted className="mt-2">
            Nothing in it yet. Group projects into it from the{' '}
            <Link href="/initiatives" className="underline decoration-dotted underline-offset-2">
              initiatives page
            </Link>
            .
          </Muted>
        ) : (
          <div className="chips mt-2">
            {mine.map((p) => (
              <Link key={p.id} href={`/projects/${p.id}`}>
                {p.name}
                <span className="w">{countFor.get(p.id) ?? 0} WS</span>
              </Link>
            ))}
          </div>
        )}
      </Card>

      <EditInitiative
        initiative={{
          id: row.id,
          name: row.name,
          description: row.description ?? '',
          status: row.status,
        }}
      />

      <Card>
        <strong>What has been done to it</strong>
        {history.length === 0 ? (
          <Empty>Nothing recorded yet.</Empty>
        ) : (
          <ul className="mt-2 text-sm">
            {history.map((h) => (
              <li key={h.id} className="border-b border-[var(--line)] py-1.5 last:border-0">
                <div>{h.summary}</div>
                <Muted>
                  {h.actor} · {fmtDate(h.at)}
                </Muted>
                {h.detail && <pre className="mt-1 whitespace-pre-wrap text-xs opacity-80">{h.detail}</pre>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
