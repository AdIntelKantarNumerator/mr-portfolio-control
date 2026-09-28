'use server'

/**
 * Changing one field on one project or workstream, from wherever it is shown.
 *
 * WHY THIS EXISTS RATHER THAN A FORM PER PAGE
 *
 * The owner, the status, the lead and the dates appear on the list pages, the
 * detail pages and inside the workstream table. Wiring each of those to its
 * own action would mean five implementations of "is this a valid status" and
 * five changelog lines that say it slightly differently — and the first one
 * somebody forgot to write would be a field you could see but not fix.
 *
 * One action, one vocabulary, one log line. The UI decides what to offer; this
 * decides what is allowed.
 *
 * WHAT IT WILL NOT DO
 *
 * It does not create people, teams or projects. An owner has to be somebody
 * the portfolio already knows, because the alternative is a table of
 * near-duplicate names nobody can reconcile later. Where a name is wanted and
 * absent, the caller gets the closest matches back and asks.
 */
import { revalidatePath } from 'next/cache'
import { asc, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { initiatives, people, projects, workstreams } from '@/db/schema'
import { isLevel, isSameValue, parseDate, parsePercent, specFor } from '@/lib/field-rules'
import { actorName } from '@/lib/auth/current-user'
import { logChange } from '@/lib/portfolio'
import { closest, exact } from '@/lib/match-name'

export interface FieldState {
  ok?: boolean
  error?: string
  message?: string
  /** Near misses, when a name did not resolve. The UI asks rather than guessing. */
  suggestions?: string[]
  stamp?: number
}

/*
 * What each level accepts lives in lib/field-rules.ts, with the parsing and
 * the no-op rule, so it can be tested without a database. This file is the
 * IO: read the row, resolve the person, write, log, revalidate.
 */

function show(v: unknown): string {
  if (v === null || v === undefined || v === '') return '(none)'
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return String(v)
}

export async function setField(_prev: FieldState, formData: FormData): Promise<FieldState> {
  const level = String(formData.get('level') ?? '')
  const id = String(formData.get('id') ?? '')
  const field = String(formData.get('field') ?? '')
  const raw = String(formData.get('value') ?? '')

  if (!isLevel(level)) return { error: 'Unknown kind of record.' }
  const spec = specFor(level, field)
  if (!spec) return { error: `A ${level} has no editable "${field}".` }

  const table = level === 'initiative' ? initiatives : level === 'project' ? projects : workstreams
  const [row] = await db.select().from(table).where(eq(table.id, id)).limit(1)
  if (!row) return { error: `That ${level} no longer exists — reload the page.` }

  const before = (row as Record<string, unknown>)[spec.column]
  let value: unknown

  if (spec.allowed) {
    if (!spec.allowed.has(raw)) return { error: `"${raw}" is not a ${field} this app uses.` }
    value = raw
  } else if (spec.person) {
    if (!raw.trim()) {
      value = null
    } else {
      const folk = await db.select({ id: people.id, name: people.name }).from(people).orderBy(asc(people.name))
      const found = exact(raw, folk)
      if (!found) {
        // Named back rather than guessed at. Picking the top match is how one
        // person's work ends up attributed to somebody with a similar name.
        const near = closest(raw, folk)
        return {
          error: near.length
            ? `Nobody here is called exactly "${raw}".`
            : `Nobody here is called "${raw}", and nothing is close. People are added by the sync, not here.`,
          suggestions: near.map((n) => n.name),
        }
      }
      value = found.id
    }
  } else if (spec.date) {
    const d = parseDate(raw)
    if (!d.ok) return { error: 'That is not a date.' }
    value = d.value
  } else if (spec.percent) {
    const n = parsePercent(raw)
    if (!n.ok) return { error: n.why }
    value = n.value
  } else {
    value = raw.trim() || null
  }

  if (isSameValue(before, value)) return { ok: true, stamp: Date.now(), message: 'Unchanged.' }

  await db
    .update(table)
    .set({ [spec.column]: value, updatedAt: new Date() } as never)
    .where(eq(table.id, id))

  // People are stored by id and read by name. The changelog is read by a
  // person six weeks later, so it gets the name.
  let fromText = show(before)
  let toText = show(value)
  if (spec.person) {
    const folk = await db.select({ id: people.id, name: people.name }).from(people)
    const nameOf = new Map(folk.map((p) => [p.id, p.name]))
    fromText = before ? (nameOf.get(String(before)) ?? show(before)) : '(nobody)'
    toText = value ? (nameOf.get(String(value)) ?? show(value)) : '(nobody)'
  }

  const who = await actorName()
  await logChange({
    actor: who,
    kind: 'change',
    summary: `${(row as { name: string }).name}: ${field} changed`,
    detail: `${fromText} → ${toText}`,
    entityType: level,
    entityId: id,
  })

  revalidatePath('/')
  revalidatePath('/changes')
  revalidatePath(`/${level}s`)
  revalidatePath(`/${level}s/${id}`)
  if (level === 'workstream' && (row as { projectId?: string }).projectId) {
    revalidatePath(`/projects/${(row as { projectId?: string }).projectId}`)
  }

  return { ok: true, stamp: Date.now(), message: `${fromText} → ${toText}` }
}
