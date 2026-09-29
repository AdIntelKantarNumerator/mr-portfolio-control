'use server'

/**
 * Correcting a recurring topic.
 *
 * These are read out of meeting notes, and the attribution is a guess made
 * from the text — some of them land on the wrong piece of work. Until now the
 * next pass would rewrite the summary and re-attach it to the same wrong
 * thing, so the only remedy was to stop reading the page.
 *
 * WHY THE EDIT IS RECORDED RATHER THAN JUST APPLIED
 *
 * Two reasons, and the second is the one that matters. A reader needs to know
 * a line has a person behind it rather than a document. And a later sync
 * needs to know, so it stops overwriting the correction — the same rule this
 * app already applies to a pinned value and to an edited milestone.
 */
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { entityThemes, objectives, initiatives, projects } from '@/db/schema'
import { actorName } from '@/lib/auth/current-user'
import { logChange } from '@/lib/portfolio'

export interface TopicState {
  ok?: boolean
  error?: string
  message?: string
  stamp?: number
}

const LEVELS = { objective: objectives, initiative: initiatives, project: projects } as const
type Level = keyof typeof LEVELS
const isLevel = (v: string): v is Level => v === 'objective' || v === 'initiative' || v === 'project'

export async function editTopic(input: {
  id: string
  /** "type:id", or empty for "not about anything in particular". */
  at: string
  theme: string
  summary: string
}): Promise<TopicState> {
  const [row] = await db.select().from(entityThemes).where(eq(entityThemes.id, input.id)).limit(1)
  if (!row) return { error: 'That topic no longer exists — reload the page.' }

  const theme = input.theme.trim()
  const summary = input.summary.trim()
  if (theme.length < 2) return { error: 'A topic needs a name.' }

  let entityType: string | null = null
  let entityId: string | null = null
  const at = input.at.trim()
  if (at) {
    const [level, id] = at.split(':')
    if (!level || !id || !isLevel(level)) return { error: 'That is not a record this portfolio has.' }
    const table = LEVELS[level]
    const [found] = await db.select({ id: table.id }).from(table).where(eq(table.id, id)).limit(1)
    if (!found) return { error: 'That record no longer exists — reload the page.' }
    entityType = level
    entityId = id
  }

  // Only what actually moved, so a sync is told to leave alone exactly the
  // fields a person touched and no more. Re-saving a row unchanged should not
  // freeze its summary against every future reading.
  const touched: string[] = []
  if (theme !== row.theme) touched.push('theme')
  if (summary !== row.summary) touched.push('summary')
  if (entityType !== row.entityType || entityId !== row.entityId) touched.push('entity')

  if (touched.length === 0) return { ok: true, stamp: Date.now(), message: 'Nothing changed.' }

  const who = await actorName()
  const already = (row.editedFields ?? '').split(',').filter(Boolean)
  await db
    .update(entityThemes)
    .set({
      theme,
      summary,
      entityType: entityType ?? row.entityType,
      // A topic detached from everything keeps its type column consistent
      // with its id: both, or neither.
      entityId: entityId ?? (entityType ? row.entityId : ''),
      editedBy: who,
      editedAt: new Date(),
      editedFields: [...new Set([...already, ...touched])].join(','),
    })
    .where(eq(entityThemes.id, input.id))

  await logChange({
    actor: who,
    kind: 'change',
    summary: `Discussion topic corrected: ${theme.slice(0, 80)}`,
    detail: touched.join(', '),
    entityType,
    entityId,
  })

  try {
    revalidatePath('/discussions')
    revalidatePath('/changes')
  } catch (err) {
    if (!(err instanceof Error) || !/static generation store/i.test(err.message)) throw err
  }

  return { ok: true, stamp: Date.now(), message: 'Saved.' }
}
