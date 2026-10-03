'use server'

/**
 * "Reassess now" on a home page card: ask, then ask how it is going.
 * See src/lib/reassess-rules.ts for why it is a request rather than a call.
 */
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { initiatives, objectives, projects } from '@/db/schema'
import { editor } from '@/lib/auth/editor'
import { logChange } from '@/lib/portfolio'
import { readReassessment, requestReassessment } from '@/lib/reassess-queue'
import { isLevel, reassessView, type ReassessView } from '@/lib/reassess-rules'

const TABLES = { objective: objectives, initiative: initiatives, project: projects } as const

export async function startReassess(level: string, entityId: string): Promise<{ id?: string; error?: string }> {
  if (!isLevel(level)) return { error: 'Unknown kind of record.' }
  // It rewrites what everybody sees on the card, so it needs a name on it,
  // like any other edit.
  const who = await editor()
  if (!who.ok) return { error: who.error }

  const table = TABLES[level]
  const [row] = await db.select({ name: table.name }).from(table).where(eq(table.id, entityId))
  if (!row) return { error: 'That record no longer exists.' }

  const { id, joined } = await requestReassessment(level, entityId, who.name)
  if (!joined) {
    await logChange({
      actor: who.name,
      summary: `Asked Yaara to reassess ${row.name}`,
      detail: 'From the home page. She re-reads the evidence and publishes a new assessment for it and what it sits under.',
      entityType: level,
      entityId,
    })
  }
  return { id }
}

export async function reassessStatus(id: string): Promise<ReassessView> {
  const row = await readReassessment(id)
  if (!row) return { state: 'failed', message: 'This request has gone.' }
  const view = reassessView(row)
  // Her new assessment is already in; make sure the next render reads it
  // rather than a cached page.
  if (view.state === 'done') {
    try {
      revalidatePath('/')
    } catch {
      // No request context (a script); nothing to revalidate.
    }
  }
  return view
}
