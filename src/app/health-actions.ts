'use server'

/**
 * Recording a health judgement from wherever the badge is shown.
 *
 * "Needs input" is the app asking a question, and until now the only place to
 * answer it was a different screen. A prompt you cannot answer where you read
 * it is a prompt everybody learns to scroll past, which is how a portfolio
 * ends up with forty unassessed rows and a green summary.
 *
 * WHY A NEW ROW RATHER THAN AN UPDATE
 *
 * Assessments supersede, they do not overwrite. The previous judgement stays
 * in the table with `current` cleared, because "it was amber in June and
 * green in July" is the single most useful thing this table knows, and an
 * UPDATE would throw it away every time somebody corrected a typo.
 *
 * WHY A RATIONALE IS REQUIRED
 *
 * A colour with no sentence behind it cannot be checked, argued with, or
 * acted on — it is decoration that looks like information. The whole premise
 * of keeping assessments apart from `sourceHealth` is that these ones say
 * why.
 */
import { revalidatePath } from 'next/cache'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { assessments, initiatives, projects, workstreams } from '@/db/schema'
import { RAG } from '@/lib/domain'
import { actorName, actorPersonId } from '@/lib/auth/current-user'
import { logChange } from '@/lib/portfolio'

export interface HealthState {
  ok?: boolean
  error?: string
  message?: string
  /** Bumped on every settled attempt, so a popover knows to close. */
  stamp?: number
}

/**
 * The tables behind each level, and the paths a change to one invalidates.
 *
 * Named here rather than inferred, because the post-rotation mapping is not
 * guessable: the `projects` table holds what the UI calls projects and the
 * `workstreams` table holds workstreams, while `initiatives` sits above both.
 */
const LEVELS = {
  initiative: { table: initiatives, path: '/initiatives' },
  project: { table: projects, path: '/projects' },
  workstream: { table: workstreams, path: '/workstreams' },
} as const

type Level = keyof typeof LEVELS

function isLevel(v: string): v is Level {
  return v === 'initiative' || v === 'project' || v === 'workstream'
}

const RAG_WORD: Record<string, string> = {
  green: 'On track',
  amber: 'At risk',
  red: 'In trouble',
  unknown: 'Needs input',
}

export async function setHealth(_prev: HealthState, formData: FormData): Promise<HealthState> {
  const level = String(formData.get('level') ?? '')
  const id = String(formData.get('id') ?? '')
  const rag = String(formData.get('rag') ?? '')
  const rationale = String(formData.get('rationale') ?? '').trim()
  const evidence = String(formData.get('evidence') ?? '').trim()

  if (!isLevel(level)) return { error: 'Unknown kind of record.' }
  if (!(RAG as readonly string[]).includes(rag)) return { error: `"${rag}" is not a health this app uses.` }
  if (!rationale) return { error: 'Say why in a sentence — a colour on its own moves nothing.' }
  if (rationale.length > 600) return { error: 'Keep it to a few lines; the row shows it under the badge.' }

  const { table, path } = LEVELS[level]
  const [row] = await db
    .select({ id: table.id, name: table.name })
    .from(table)
    .where(eq(table.id, id))
    .limit(1)
  if (!row) return { error: `That ${level} no longer exists — reload the page.` }

  const [previous] = await db
    .select({ rag: assessments.rag })
    .from(assessments)
    .where(
      and(
        eq(assessments.entityType, level),
        eq(assessments.entityId, id),
        eq(assessments.current, true),
      ),
    )
    .limit(1)

  // Retire whatever was current before inserting, so the partial read a
  // concurrent request could make is "no current assessment" rather than two.
  await db
    .update(assessments)
    .set({ current: false })
    .where(
      and(
        eq(assessments.entityType, level),
        eq(assessments.entityId, id),
        eq(assessments.current, true),
      ),
    )

  const who = await actorName()
  const personId = await actorPersonId()

  await db.insert(assessments).values({
    entityType: level,
    entityId: id,
    rag,
    confidence: 'medium',
    rationale,
    evidence: evidence || null,
    asOf: new Date(),
    assessorId: personId,
    // Typed by a person on this screen. The byline matters: a human judgement
    // wearing an agent's name, or the reverse, is the one thing this table
    // must never do.
    authoredBy: 'human',
    current: true,
  })

  await logChange({
    actor: who,
    kind: 'assessment',
    summary: `${row.name}: health set to ${RAG_WORD[rag] ?? rag}`,
    detail: previous?.rag
      ? `${RAG_WORD[previous.rag] ?? previous.rag} → ${RAG_WORD[rag] ?? rag}. ${rationale}`
      : rationale,
    entityType: level,
    entityId: id,
  })

  revalidatePath('/')
  revalidatePath('/changes')
  revalidatePath(path)
  revalidatePath(`${path}/${id}`)

  return { ok: true, stamp: Date.now(), message: `Recorded as ${RAG_WORD[rag] ?? rag}.` }
}
