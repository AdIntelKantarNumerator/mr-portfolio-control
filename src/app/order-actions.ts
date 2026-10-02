'use server'

/**
 * The order the home board, the timeline and the list pages are dragged into.
 *
 * WHOSE ORDER IT IS
 *
 * Everybody's, again, since 2 October 2026. It was one shared order first,
 * then each reader's own (card_orders, one row per person per level), on the
 * reasoning that the last person to drag silently decided what the next
 * person saw. Scott asked for it to be shared, the same as the Data
 * Dictionary's tiles, and recorded: so the order is the `sort_order` column on
 * the three entity tables, and every move is written to Activity with who made
 * it. That answers the old objection directly. Anybody who wonders why the
 * board changed can see who moved what, and when.
 *
 * card_orders is no longer read or written. Its rows were the starting point:
 * migration 0025 copied the most recent arrangement at each level into
 * sort_order, so what the last person to drag saw is what everybody now sees.
 *
 * A FILTERED BOARD
 *
 * The board often shows a subset: a health filter, ended work hidden. The
 * caller sends the order of what it shows; it is merged into the order of
 * everything at that level (lib/reorder.ts mergeOrder), so the hidden cards
 * keep their places and only the visible ones move among their own slots.
 *
 * WHY THE WHOLE LEVEL IS REWRITTEN
 *
 * Moving one card and renumbering around it needs the rows either side and
 * gets the edges wrong. Writing the merged list is one statement of intent,
 * in one transaction.
 */
import { revalidatePath } from 'next/cache'
import { asc, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { objectives, initiatives, projects } from '@/db/schema'
import { editor } from '@/lib/auth/editor'
import { logChange } from '@/lib/portfolio'
import { describeMove, mergeOrder } from '@/lib/reorder'
import { TIER_LABEL } from '@/lib/home-types'

const TABLES = { objective: objectives, initiative: initiatives, project: projects } as const

type Level = keyof typeof TABLES

function isLevel(v: string): v is Level {
  return v === 'objective' || v === 'initiative' || v === 'project'
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

  // A shared order is a change to the portfolio, so it needs somebody signed
  // in to put their name to it, like any other edit.
  const who = await editor()
  if (!who.ok) return { error: who.error }

  const table = TABLES[level]
  const rows = await db
    .select({ id: table.id, name: table.name, sortOrder: table.sortOrder })
    .from(table)
    .orderBy(asc(table.sortOrder), asc(table.name))
  const before = rows.map((r) => r.id)
  // Only ids that exist: a stale tab could send one that has since been
  // deleted. mergeOrder drops anything not in the whole list.
  const after = mergeOrder(before, orderedIds)
  const moved = describeMove(before, after)
  if (!moved) return { ok: true, stamp: Date.now() }

  await db.transaction(async (tx) => {
    for (const [i, id] of after.entries()) {
      await tx.update(table).set({ sortOrder: i }).where(eq(table.id, id))
    }
  })

  const name = rows.find((r) => r.id === moved.id)?.name ?? 'A card'
  const word = level === 'objective' ? TIER_LABEL.objective.toLowerCase() : level
  await logChange({
    actor: who.name,
    summary: `Order: moved ${name} from ${ordinal(moved.from)} to ${ordinal(moved.to)}`,
    detail: `The shared order of every ${word}, on the home board, the timeline and the list.`,
    entityType: level,
    entityId: moved.id,
  })

  // The board already moved in the browser; this is for everybody else's
  // next visit, and for the other tabs open on the same pages.
  //
  // The try/catch is the same one objectives/actions.ts carries, for the same
  // reason: revalidatePath needs a request context and throws this one
  // invariant without it, and scripts/check-card-order.ts calls this with no
  // request. Every other error still propagates.
  try {
    revalidatePath('/')
    revalidatePath('/roadmap')
    revalidatePath('/objectives')
    revalidatePath('/initiatives')
    revalidatePath('/projects')
    revalidatePath('/changes')
  } catch (err) {
    if (!(err instanceof Error) || !/static generation store/i.test(err.message)) throw err
  }

  return { ok: true, stamp: Date.now() }
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`
}
