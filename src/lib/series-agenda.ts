/**
 * The proposed agenda for a series' next session: reading the record, calling
 * the advanced model, saving the result. The rules are in series-agenda-core.
 *
 * Generated on request (the button on the series page, or Yaara the evening
 * before when the series posts to Slack) and saved per session date with a
 * fingerprint of what it was built from. Opening it again shows the saved one;
 * it says when it is out of date, and regenerating replaces it.
 */
import { and, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { seriesAgendas } from '@/db/schema'
import { completeJson } from './llm'
import { agendaFingerprint, agendaUserPrompt, AGENDA_SYSTEM, parseAgenda, type Agenda, type AgendaInput } from './series-agenda-core'
import { changeLine, latestChange } from './series'
import { seriesContext } from './series-data'
import { recentSummaryText } from './series-summaries'

export interface SavedAgenda {
  forDay: string
  agenda: Agenda
  generatedAt: Date
  generatedBy: string | null
  model: string | null
  /** False when the items, summaries or goals have changed since it was written. */
  current: boolean
}

async function buildInput(seriesId: string): Promise<{ input: AgendaInput; refs: Set<string> } | null> {
  const ctx = await seriesContext(seriesId)
  if (!ctx) return null
  const summaries = await recentSummaryText(seriesId, 3)
  const items = ctx.members
    // Open work only: decisions are a record (lib/decision-recency.ts), and
    // closed items have nothing to bring to a meeting.
    .filter(({ item }) => item.open && !item.mergedInto && item.kind !== 'decision')
    .map(({ item, bucket, quiet }) => ({
      ref: item.ref,
      kind: item.kind,
      title: item.title,
      owner: item.owner,
      due: item.dueDate ? item.dueDate.toISOString().slice(0, 10) : null,
      place: item.place ?? null,
      section: bucket,
      quiet,
      heldUntil: item.heldUntil ? item.heldUntil.toISOString().slice(0, 10) : null,
      change: bucket === 'changed' ? changeLine(latestChange(item, ctx.lastDay)) : null,
      suggested: item.suggestedDone?.note ?? null,
    }))
    .sort((a, b) => a.ref.localeCompare(b.ref, undefined, { numeric: true }))
  const forDay = ctx.next ?? ctx.now
  return {
    input: { seriesName: ctx.series.name, goals: ctx.series.goals, forDay, lastDay: ctx.last, summaries, items },
    refs: new Set(items.map((i) => i.ref.toUpperCase())),
  }
}

/** The saved agenda for the next session, if there is one, and whether it is still current. */
export async function savedAgenda(seriesId: string): Promise<SavedAgenda | null> {
  const built = await buildInput(seriesId)
  if (!built) return null
  const [row] = await db
    .select()
    .from(seriesAgendas)
    .where(and(eq(seriesAgendas.seriesId, seriesId), eq(seriesAgendas.forDay, built.input.forDay)))
    .limit(1)
  if (!row) return null
  return {
    forDay: row.forDay,
    agenda: JSON.parse(row.content) as Agenda,
    generatedAt: row.generatedAt,
    generatedBy: row.generatedBy,
    model: row.model,
    current: row.fingerprint === agendaFingerprint(built.input),
  }
}

/** Write (or rewrite) the agenda for the next session, on the advanced model. */
export async function generateAgenda(seriesId: string, who: string): Promise<SavedAgenda> {
  const built = await buildInput(seriesId)
  if (!built) throw new Error('That series no longer exists.')
  const { text, model } = await completeJson(AGENDA_SYSTEM, agendaUserPrompt(built.input), {
    tier: 'advanced',
    maxTokens: 16_000,
    timeoutMs: 200_000,
  })
  const agenda = parseAgenda(text, built.refs)
  if (!agenda) throw new Error('The model did not return a usable agenda. Try again.')
  const values = {
    content: JSON.stringify(agenda),
    fingerprint: agendaFingerprint(built.input),
    model,
    generatedBy: who.slice(0, 200),
    generatedAt: new Date(),
  }
  await db
    .insert(seriesAgendas)
    .values({ seriesId, forDay: built.input.forDay, ...values })
    .onConflictDoUpdate({ target: [seriesAgendas.seriesId, seriesAgendas.forDay], set: { ...values, postedAt: null } })
  return { forDay: built.input.forDay, agenda, generatedAt: values.generatedAt, generatedBy: values.generatedBy, model, current: true }
}
