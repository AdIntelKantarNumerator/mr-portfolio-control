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
import { editSummary } from '@/lib/series-summaries'
import { generateAgenda, savedAgenda, type SavedAgenda } from '@/lib/series-agenda'
import type { Agenda } from '@/lib/series-agenda-core'
import { applyItemUpdate } from '@/lib/items'

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

/** Goals, when the form sent them. */
function extras(input: { goals?: string }) {
  const out: { goals?: string | null } = {}
  if (input.goals !== undefined) out.goals = input.goals.trim().slice(0, 4000) || null
  return out
}

function refresh(id?: string) {
  revalidatePath('/series')
  if (id) revalidatePath(`/series/${id}`)
}

export async function saveSeries(input: { id?: string; name: string; meetings: string[]; goals?: string }): Promise<SeriesState> {
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
    await db.update(meetingSeries).set({ name, ...extras(input) }).where(eq(meetingSeries.id, id))
    await db
      .delete(meetingSeriesMeetings)
      .where(and(eq(meetingSeriesMeetings.seriesId, id), notInArray(meetingSeriesMeetings.meeting, meetings)))
  } else {
    const [row] = await db.insert(meetingSeries).values({ name, createdBy: who.name, ...extras(input) }).returning({ id: meetingSeries.id })
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

// ------------------------------------------------- summaries, agenda, cleanup

/** A person's edit of a session summary. Empty text puts Yaara's back. */
export async function saveSummaryEdit(input: { seriesId: string; summaryId: string; markdown: string }): Promise<SeriesState> {
  const who = await editor()
  if (!who.ok) return { error: who.error }
  const ok = await editSummary(input.seriesId, input.summaryId, input.markdown, who.name)
  if (!ok) return { error: 'That summary no longer exists.' }
  await logChange({ actor: who.name, kind: 'change', summary: input.markdown.trim() ? 'Edited a session summary' : 'Put back Yaara\'s session summary' })
  refresh(input.seriesId)
  return { ok: true }
}

export interface AgendaResult {
  error?: string
  saved?: { forDay: string; agenda: Agenda; generatedAt: string; generatedBy: string | null; model: string | null; current: boolean } | null
}

const asResult = (a: SavedAgenda | null): AgendaResult => ({ saved: a && { ...a, generatedAt: a.generatedAt.toISOString() } })

/** The saved agenda for the next session, without writing a new one. */
export async function loadAgenda(seriesId: string): Promise<AgendaResult> {
  try {
    return asResult(await savedAgenda(seriesId))
  } catch (err) {
    return { error: (err as Error).message }
  }
}

/** Write the agenda for the next session now. Takes up to a minute. */
export async function writeAgenda(seriesId: string): Promise<AgendaResult> {
  const who = await editor()
  if (!who.ok) return { error: who.error }
  try {
    return asResult(await generateAgenda(seriesId, who.name))
  } catch (err) {
    return { error: (err as Error).message }
  }
}

export type CleanupAction = 'done' | 'still-open' | 'withdraw' | 'dismiss'

/**
 * The cleanup buttons on the series page (12 October 2026). Each is the same
 * change the item's own page makes, recorded as the person's, with the series
 * as where it was said.
 */
export async function cleanUp(input: { seriesId: string; seriesName: string; refs: string[]; action: CleanupAction }): Promise<SeriesState & { done?: number }> {
  const who = await editor()
  if (!who.ok) return { error: who.error }
  const source = { title: `Meeting series: ${input.seriesName}`, url: null }
  let done = 0
  const errors: string[] = []
  for (const ref of input.refs.slice(0, 100)) {
    const r = await applyItemUpdate({
      ref,
      actor: who.name,
      source,
      ...(input.action === 'done'
        ? { action: 'resolve', note: 'Done (series cleanup).' }
        : input.action === 'withdraw'
          ? { action: 'drop', note: 'Withdrawn (series cleanup).' }
          : input.action === 'dismiss'
            ? { action: 'dismiss_suggestion', note: 'Not done (series cleanup).' }
            : { action: 'progress', note: 'Still open (confirmed in series cleanup).' }),
    })
    if (r.ok) done++
    else errors.push(`${ref}: ${r.error}`)
  }
  refresh(input.seriesId)
  return errors.length ? { error: errors.join('; '), done } : { ok: true, done }
}
