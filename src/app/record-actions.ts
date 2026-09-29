'use server'

/**
 * Creating a piece of work, and editing what it is.
 *
 * WHY THIS EXISTS
 *
 * Everything in the portfolio arrived from Linear, from a document Yaara
 * read, or from the intake queue. That covers how work normally starts and
 * none of the ordinary corrections afterwards: a project that should sit
 * under a different initiative, a workstream somebody agreed to in a meeting
 * and needs on the board now, a name that was a placeholder three months ago.
 * Each of those meant a trip to Linear, or waiting.
 *
 * WHAT IT WILL NOT DO
 *
 * Delete. Work that is over is `completed` or `canceled` and drops off the
 * board; deleting it would take its changelog with it, and the changelog is
 * the only record of why anything was ever arranged the way it was.
 */
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { initiatives, projects, workstreams } from '@/db/schema'
import { actorName } from '@/lib/auth/current-user'
import { logChange } from '@/lib/portfolio'
import { slugify } from '@/lib/util'

export interface RecordState {
  ok?: boolean
  error?: string
  message?: string
  /** Where to go when something was created. */
  href?: string
  stamp?: number
}

const TABLES = { initiative: initiatives, project: projects, workstream: workstreams } as const
type Level = keyof typeof TABLES
const isLevel = (v: string): v is Level => v === 'initiative' || v === 'project' || v === 'workstream'

const HREF: Record<Level, string> = {
  initiative: '/initiatives',
  project: '/projects',
  workstream: '/workstreams',
}

function refresh(level: Level, id: string, parentHref?: string) {
  try {
    revalidatePath('/')
    revalidatePath(HREF[level])
    revalidatePath(`${HREF[level]}/${id}`)
    revalidatePath('/roadmap')
    revalidatePath('/changes')
    if (parentHref) revalidatePath(parentHref)
  } catch (err) {
    if (!(err instanceof Error) || !/static generation store/i.test(err.message)) throw err
  }
}

/** A key nobody else has. Collisions resolve by suffix, never by failing. */
async function uniqueKey(level: Level, name: string): Promise<string> {
  const table = TABLES[level]
  const rows = await db.select({ key: table.key }).from(table)
  const used = new Set(rows.map((r) => r.key))
  const base = slugify(name).slice(0, 40) || level
  if (!used.has(base)) return base
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-${n}`
    if (!used.has(candidate)) return candidate
  }
  return `${base}-${Date.now()}`
}

/**
 * A new project under an initiative, or a new workstream under a project.
 *
 * The parent is required rather than optional: this is reached from the
 * parent's own page, so the one thing that is certainly known is where it
 * belongs — and an orphan created by accident is the state the grouping
 * screens exist to clean up.
 */
export async function createChild(input: {
  level: 'project' | 'workstream'
  parentId: string
  name: string
  description?: string | null
}): Promise<RecordState> {
  const name = input.name.trim()
  if (name.length < 3) return { error: 'Give it a name — three characters or more.' }

  const parentLevel: Level = input.level === 'project' ? 'initiative' : 'project'
  const parentTable = TABLES[parentLevel]
  const [parent] = await db
    .select({ id: parentTable.id, name: parentTable.name })
    .from(parentTable)
    .where(eq(parentTable.id, input.parentId))
    .limit(1)
  if (!parent) return { error: 'That record no longer exists — reload the page.' }

  const key = await uniqueKey(input.level, name)
  const values =
    input.level === 'project'
      ? { key, name, description: input.description?.trim() || null, status: 'planned', initiativeId: parent.id }
      : { key, name, description: input.description?.trim() || null, status: 'planned', projectId: parent.id }

  const table = TABLES[input.level]
  const [created] = await db
    .insert(table)
    .values(values as never)
    .returning({ id: table.id })

  await logChange({
    actor: await actorName(),
    kind: 'change',
    summary: `${input.level} created: ${name}`,
    detail: `under ${parent.name}`,
    entityType: input.level,
    entityId: created.id,
  })

  refresh(input.level, created.id, `${HREF[parentLevel]}/${parent.id}`)
  return { ok: true, stamp: Date.now(), href: `${HREF[input.level]}/${created.id}`, message: `Created ${name}.` }
}

/**
 * The name, the description, and what it rolls up to.
 *
 * Moving a record is the interesting one and the reason the parent is here:
 * a project under the wrong initiative makes every roll-up above it wrong,
 * and that was only fixable from the grouping screen, two clicks away from
 * wherever anybody noticed.
 */
export async function editRecord(input: {
  level: string
  id: string
  name: string
  description?: string | null
  /** The parent's id, '' to detach, or undefined to leave it alone. */
  parentId?: string
}): Promise<RecordState> {
  if (!isLevel(input.level)) return { error: 'Unknown kind of record.' }
  const table = TABLES[input.level]

  const [row] = await db.select().from(table).where(eq(table.id, input.id)).limit(1)
  if (!row) return { error: 'That record no longer exists — reload the page.' }

  const name = input.name.trim()
  if (name.length < 3) return { error: 'A name needs three characters or more.' }

  const changes: string[] = []
  const patch: Record<string, unknown> = {}

  if (name !== row.name) {
    patch.name = name
    changes.push(`name: ${row.name} → ${name}`)
  }

  const description = (input.description ?? '').trim() || null
  if (description !== (row.description ?? null)) {
    patch.description = description
    changes.push(description ? 'description edited' : 'description cleared')
  }

  if (input.parentId !== undefined && input.level !== 'initiative') {
    const field = input.level === 'project' ? 'initiativeId' : 'projectId'
    const parentLevel: Level = input.level === 'project' ? 'initiative' : 'project'
    const current = (row as Record<string, unknown>)[field] as string | null
    const wanted = input.parentId.trim() || null

    if (wanted !== current) {
      let label = 'nothing'
      if (wanted) {
        const parentTable = TABLES[parentLevel]
        const [parent] = await db
          .select({ id: parentTable.id, name: parentTable.name })
          .from(parentTable)
          .where(eq(parentTable.id, wanted))
          .limit(1)
        if (!parent) return { error: `That ${parentLevel} no longer exists — reload the page.` }
        label = parent.name
      }
      patch[field] = wanted
      changes.push(`${parentLevel}: ${current ? 'moved' : 'set'} → ${label}`)
    }
  }

  if (changes.length === 0) return { ok: true, stamp: Date.now(), message: 'Nothing changed.' }

  await db.update(table).set(patch).where(eq(table.id, input.id))

  await logChange({
    actor: await actorName(),
    kind: 'change',
    summary: `${input.level} edited — ${name}`,
    detail: changes.join('\n'),
    entityType: input.level,
    entityId: input.id,
  })

  refresh(input.level, input.id)
  return { ok: true, stamp: Date.now(), message: 'Saved.' }
}
