/**
 * Session summaries for a meeting series (12 October 2026).
 *
 * Yaara writes one when she reads a session's notes: she has the text, the
 * portfolio never stores it. A person can edit a summary; their version is
 * shown instead of hers and she never overwrites it. If the notes change after
 * an edit, the edit stays and the summary says the notes have changed since.
 */
import { and, asc, desc, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { seriesSummaries } from '@/db/schema'

export interface SummaryListing {
  id: string
  meeting: string
  sessionDay: string
  documentTitle: string | null
}

export interface SummaryView extends SummaryListing {
  markdown: string
  /** True when a person's edit is what is shown. */
  edited: boolean
  editedBy: string | null
  editedAt: Date | null
  notesChangedAt: Date | null
  documentUrl: string | null
  model: string | null
  generatedAt: Date
}

export interface SummaryWrite {
  seriesId: string
  meeting: string
  sessionDay: string
  document: { externalId: string; title?: string | null; url?: string | null; revision?: string | null }
  markdown: string
  model?: string | null
}

/** Store Yaara's summary of one session document. Returns whether it was new, replaced, or kept a person's edit. */
export async function upsertSummary(w: SummaryWrite): Promise<{ id: string; outcome: 'created' | 'updated' | 'kept-edit' }> {
  const [found] = await db
    .select()
    .from(seriesSummaries)
    .where(and(eq(seriesSummaries.seriesId, w.seriesId), eq(seriesSummaries.documentExternalId, w.document.externalId)))
    .limit(1)
  const values = {
    meeting: w.meeting.slice(0, 300),
    sessionDay: w.sessionDay,
    documentTitle: w.document.title?.slice(0, 500) ?? null,
    documentUrl: w.document.url?.slice(0, 1000) ?? null,
    revision: w.document.revision ?? null,
    markdown: w.markdown.slice(0, 200_000),
    model: w.model?.slice(0, 200) ?? null,
    generatedAt: new Date(),
  }
  if (!found) {
    const [row] = await db.insert(seriesSummaries).values({ seriesId: w.seriesId, documentExternalId: w.document.externalId, ...values }).returning({ id: seriesSummaries.id })
    return { id: row!.id, outcome: 'created' }
  }
  // Yaara's text is always refreshed underneath; a person's edit stays on top.
  const changedUnderEdit = Boolean(found.editedMarkdown) && found.revision !== values.revision
  await db
    .update(seriesSummaries)
    .set({ ...values, ...(changedUnderEdit ? { notesChangedAt: new Date() } : {}) })
    .where(eq(seriesSummaries.id, found.id))
  return { id: found.id, outcome: found.editedMarkdown ? 'kept-edit' : 'updated' }
}

/** Every session summarised in a series, newest first. */
export async function listSummaries(seriesId: string): Promise<SummaryListing[]> {
  const rows = await db
    .select({ id: seriesSummaries.id, meeting: seriesSummaries.meeting, sessionDay: seriesSummaries.sessionDay, documentTitle: seriesSummaries.documentTitle })
    .from(seriesSummaries)
    .where(eq(seriesSummaries.seriesId, seriesId))
    .orderBy(desc(seriesSummaries.sessionDay), asc(seriesSummaries.meeting))
  return rows
}

function toView(r: typeof seriesSummaries.$inferSelect): SummaryView {
  return {
    id: r.id,
    meeting: r.meeting,
    sessionDay: r.sessionDay,
    documentTitle: r.documentTitle,
    markdown: r.editedMarkdown ?? r.markdown,
    edited: Boolean(r.editedMarkdown),
    editedBy: r.editedBy,
    editedAt: r.editedAt,
    notesChangedAt: r.notesChangedAt,
    documentUrl: r.documentUrl,
    model: r.model,
    generatedAt: r.generatedAt,
  }
}

/** One summary, or the newest when no id is given (or the id is not in this series). */
export async function getSummary(seriesId: string, id?: string | null): Promise<SummaryView | null> {
  if (id) {
    const [row] = await db.select().from(seriesSummaries).where(and(eq(seriesSummaries.seriesId, seriesId), eq(seriesSummaries.id, id))).limit(1)
    if (row) return toView(row)
  }
  const [latest] = await db
    .select()
    .from(seriesSummaries)
    .where(eq(seriesSummaries.seriesId, seriesId))
    .orderBy(desc(seriesSummaries.sessionDay), desc(seriesSummaries.generatedAt))
    .limit(1)
  return latest ? toView(latest) : null
}

/** The last few summaries' text, oldest first, for building an agenda. */
export async function recentSummaryText(seriesId: string, count = 3): Promise<Array<{ id: string; meeting: string; sessionDay: string; text: string; stamp: string }>> {
  const rows = await db
    .select()
    .from(seriesSummaries)
    .where(eq(seriesSummaries.seriesId, seriesId))
    .orderBy(desc(seriesSummaries.sessionDay), desc(seriesSummaries.generatedAt))
    .limit(count)
  return rows.reverse().map((r) => ({
    id: r.id,
    meeting: r.meeting,
    sessionDay: r.sessionDay,
    text: r.editedMarkdown ?? r.markdown,
    stamp: `${r.id}:${(r.editedAt ?? r.generatedAt).toISOString()}`,
  }))
}

/** A person's edit. Empty text puts Yaara's version back. */
export async function editSummary(seriesId: string, id: string, markdown: string, who: string): Promise<boolean> {
  const text = markdown.trim()
  const res = await db
    .update(seriesSummaries)
    .set(text ? { editedMarkdown: text.slice(0, 200_000), editedBy: who, editedAt: new Date(), notesChangedAt: null } : { editedMarkdown: null, editedBy: null, editedAt: null, notesChangedAt: null })
    .where(and(eq(seriesSummaries.seriesId, seriesId), eq(seriesSummaries.id, id)))
    .returning({ id: seriesSummaries.id })
  return res.length > 0
}

/** Which documents already have a summary, and at which revision: so Yaara writes each once per revision. */
export async function summarisedDocuments(): Promise<Array<{ seriesId: string; externalId: string; revision: string | null }>> {
  return db
    .select({ seriesId: seriesSummaries.seriesId, externalId: seriesSummaries.documentExternalId, revision: seriesSummaries.revision })
    .from(seriesSummaries)
}

export { linkRefs } from './series'
