'use server'

/**
 * The order somebody dragged the board into.
 *
 * WHY THIS WRITES THE EXISTING sortOrder COLUMN
 *
 * All three tables already have one, and it already means "the order these
 * read in" — theme order has used it since the beginning. Adding a second
 * column for a second kind of order would leave two answers to "which comes
 * first", and the first screen to read the wrong one would be a bug nobody
 * could see.
 *
 * WHY THE WHOLE LIST IS REWRITTEN
 *
 * The alternative is to move one row and renumber around it, which needs the
 * rows either side and gets the edges wrong when two people drag at once.
 * Writing every position from the list the browser just showed is one
 * statement of intent, and the last writer wins cleanly rather than
 * interleaving with somebody else's half-renumber.
 *
 * WHOSE ORDER IT IS
 *
 * The portfolio's, not the reader's. A board arranged for a Monday review
 * should look the same to everyone who opens it, and a per-browser order
 * would mean the person who arranged it is the only one who sees it. The
 * changelog records who moved things, so a surprise has an answer.
 */
import { revalidatePath } from 'next/cache'
import { eq, inArray } from 'drizzle-orm'
import { db } from '@/db/client'
import { initiatives, projects, workstreams } from '@/db/schema'
import { actorName } from '@/lib/auth/current-user'
import { logChange } from '@/lib/portfolio'

const TABLES = { initiative: initiatives, project: projects, workstream: workstreams } as const

type Level = keyof typeof TABLES

function isLevel(v: string): v is Level {
  return v === 'initiative' || v === 'project' || v === 'workstream'
}

export interface OrderState {
  ok?: boolean
  error?: string
  stamp?: number
}

export async function setCardOrder(level: string, orderedIds: string[]): Promise<OrderState> {
  if (!isLevel(level)) return { error: 'Unknown kind of record.' }
  if (orderedIds.length === 0) return { ok: true, stamp: Date.now() }
  if (orderedIds.length > 500) return { error: 'That is more rows than this board can order.' }

  const table = TABLES[level]

  // Only ids that exist, in the order they were given. A stale tab could
  // send an id that has since been deleted, and the update would be a no-op
  // that silently shifted everything after it by one.
  const known = await db.select({ id: table.id, name: table.name }).from(table).where(inArray(table.id, orderedIds))
  const byId = new Map(known.map((r) => [r.id, r.name]))
  const live = orderedIds.filter((id) => byId.has(id))
  if (live.length === 0) return { error: 'None of those still exist — reload the page.' }

  // Positions start at 1: zero is what every never-ordered row already has,
  // and keeping it free means "nobody has placed this" stays distinguishable
  // from "somebody put this first".
  await db.transaction(async (tx) => {
    for (const [ix, id] of live.entries()) {
      await tx.update(table).set({ sortOrder: ix + 1 }).where(eq(table.id, id))
    }
  })

  await logChange({
    actor: await actorName(),
    kind: 'change',
    summary: `${level} order changed on the home board`,
    detail: live.map((id, ix) => `${ix + 1}. ${byId.get(id)}`).join('\n'),
  })

  revalidatePath('/')
  revalidatePath(`/${level}s`)

  return { ok: true, stamp: Date.now() }
}
