/**
 * Active recurring topics.
 *
 * What keeps coming up in the meetings Yaara reads, and has not become a
 * decision or a blocker. Nobody owns these, which is the point: something
 * raised in three consecutive weeklies with no owner is the shape a blocker
 * has before anybody has called it one.
 *
 * The work each is tagged against is a guess made from the text, so each row
 * can be corrected — and says so afterwards, because a line a person fixed
 * and a line read off a document carry different authority.
 */
import { asc } from 'drizzle-orm'
import { db } from '@/db/client'
import { objectives, initiatives, projects } from '@/db/schema'
import { recentThemes } from '@/lib/portfolio'
import { Kicker } from '@/components/ui'
import { DiscussionsList, type TopicRow } from './list'

export const metadata = { title: 'Discussions' }
export const dynamic = 'force-dynamic'

const HREF: Record<string, string> = {
  objective: '/objectives',
  initiative: '/initiatives',
  project: '/projects',
}

export default async function DiscussionsPage() {
  const [themes, inits, projs, wss] = await Promise.all([
    recentThemes(60),
    db.select({ id: objectives.id, name: objectives.name }).from(objectives).orderBy(asc(objectives.name)),
    db.select({ id: initiatives.id, name: initiatives.name }).from(initiatives).orderBy(asc(initiatives.name)),
    db.select({ id: projects.id, name: projects.name }).from(projects).orderBy(asc(projects.name)),
  ])

  const named = new Map<string, string>()
  for (const i of inits) named.set(`objective:${i.id}`, i.name)
  for (const p of projs) named.set(`initiative:${p.id}`, p.name)
  for (const w of wss) named.set(`project:${w.id}`, w.name)

  const topics: TopicRow[] = themes.map((t) => {
    const key = t.entityId ? `${t.entityType}:${t.entityId}` : ''
    const where = key ? (named.get(key) ?? null) : null
    return {
      id: t.id,
      theme: t.theme,
      summary: t.summary,
      mentions: t.mentions,
      lastMeeting: t.lastMeeting,
      at: t.lastSeenAt ? t.lastSeenAt.toISOString().slice(0, 10) : '',
      where,
      // Only when the record is still there: a link to something deleted is
      // worse than none, and the name being absent is itself worth seeing.
      href: where && HREF[t.entityType] ? `${HREF[t.entityType]}/${t.entityId}` : null,
      editedBy: t.editedBy,
      editedAt: t.editedAt ? t.editedAt.toISOString().slice(0, 10) : null,
    }
  })

  return (
    <div className="stack">
      <div className="titlerow">
        <div>
          <Kicker>Work in progress</Kicker>
          <h1>Discussions</h1>
        </div>
      </div>

      <section className="tile">
        <div className="tile-head">
          <h2>Active recurring topics</h2>
        </div>
        <DiscussionsList topics={topics} objectives={inits} initiatives={projs} projects={wss} />
      </section>
    </div>
  )
}
