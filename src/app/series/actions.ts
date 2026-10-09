'use server'

/**
 * Creating, editing and closing a meeting series. Each is recorded in
 * Activity with who did it, like every other edit on the site.
 */
import { revalidatePath } from 'next/cache'
import { and, eq, notInArray } from 'drizzle-orm'
import { db } from '@/db/client'
import { meetingSeries, meetingSeriesMeetings } from '@/db/schema'
import { editor } from '@/lib/auth/editor'
import { logChange } from '@/lib/portfolio'
import { baseMeetingName } from '@/lib/series'
import { knownMeetings } from '@/lib/series-data'

export interface SeriesState {
  ok?: boolean
  error?: string
  id?: string
}

function clean(meetings: readonly string[]): string[] {
  const out = new Map<string, string>()
  for (const m of meetings) {
    const name = baseMeetingName(String(m)).slice(0, 300)
    if (name) out.set(name.toLowerCase(), name)
  }
  return [...out.values()]
}

function refresh(id?: string) {
  revalidatePath('/series')
  if (id) revalidatePath(`/series/${id}`)
}

export async function saveSeries(input: { id?: string; name: string; meetings: string[] }): Promise<SeriesState> {
  const who = await editor()
  if (!who.ok) return { error: who.error }
  const name = input.name.trim().slice(0, 200)
  if (name.length < 2) return { error: 'Give it a name.' }
  const meetings = clean(input.meetings)
  if (!meetings.length) return { error: 'Pick at least one meeting.' }

  let id = input.id
  if (id) {
    const [found] = await db.select().from(meetingSeries).where(eq(meetingSeries.id, id)).limit(1)
    if (!found) return { error: 'That series no longer exists.' }
    await db.update(meetingSeries).set({ name }).where(eq(meetingSeries.id, id))
    await db
      .delete(meetingSeriesMeetings)
      .where(and(eq(meetingSeriesMeetings.seriesId, id), notInArray(meetingSeriesMeetings.meeting, meetings)))
  } else {
    const [row] = await db.insert(meetingSeries).values({ name, createdBy: who.name }).returning({ id: meetingSeries.id })
    id = row!.id
  }
  await db
    .insert(meetingSeriesMeetings)
    .values(meetings.map((meeting) => ({ seriesId: id!, meeting })))
    .onConflictDoNothing()

  await logChange({
    actor: who.name,
    kind: 'change',
    summary: `${input.id ? 'Edited' : 'Created'} meeting series "${name}"`,
    detail: meetings.join('\n'),
  })
  refresh(id)
  return { ok: true, id }
}

/** The meeting picker's choices, fetched when the dialog opens rather than with every page. */
export async function meetingChoices(): Promise<Array<{ name: string; sessions: number; last: string | null }>> {
  return knownMeetings()
}

export async function setSeriesClosed(input: { id: string; closed: boolean }): Promise<SeriesState> {
  const who = await editor()
  if (!who.ok) return { error: who.error }
  const [found] = await db.select().from(meetingSeries).where(eq(meetingSeries.id, input.id)).limit(1)
  if (!found) return { error: 'That series no longer exists.' }
  await db
    .update(meetingSeries)
    .set(input.closed ? { status: 'closed', closedAt: new Date(), closedBy: who.name } : { status: 'open', closedAt: null, closedBy: null })
    .where(eq(meetingSeries.id, input.id))
  await logChange({ actor: who.name, kind: 'change', summary: `${input.closed ? 'Closed' : 'Reopened'} meeting series "${found.name}"` })
  refresh(input.id)
  return { ok: true, id: input.id }
}
