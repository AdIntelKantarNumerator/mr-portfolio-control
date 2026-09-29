'use server'

/**
 * The order somebody has dragged the home board into.
 *
 * WHOSE ORDER IT IS
 *
 * Theirs. The first version wrote the `sort_order` column on the three
 * entity tables, which made one arrangement stand for everybody: the last
 * person to drag decided what the next person saw, and nobody could tell
 * that had happened. "These four matter to me this quarter" is a reader's
 * working order, not a fact about the programme.
 *
 * So it lives in `card_orders`, one row per reader per level, and the
 * `sort_order` column goes back to meaning only what it meant before. Nothing
 * is written to the changelog either — a changelog records changes to the
 * portfolio, and rearranging your own view is not one. A log line saying
 * "Scott changed the order" that nobody else can even see would be noise in
 * the one place that has to stay signal.
 *
 * WHY THE WHOLE LIST IS REWRITTEN
 *
 * Moving one card and renumbering around it needs the rows either side and
 * gets the edges wrong. Writing the list the browser just showed is one
 * statement of intent. Within a single reader there is no concurrency to
 * speak of, but the same reasoning held when this was shared and there is no
 * reason to make it more complicated now that it is not.
 *
 * WHAT A READER WHO HAS NEVER DRAGGED SEES
 *
 * The `sort_order` column, exactly as before — see lib/home.ts. The Custom
 * sort is a starting point they can rearrange, not an empty board they have
 * to build.
 */
import { revalidatePath } from 'next/cache'
import { inArray } from 'drizzle-orm'
import { db } from '@/db/client'
import { cardOrders, objectives, initiatives, projects } from '@/db/schema'
import { viewerKey } from '@/lib/card-order'

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

  const table = TABLES[level]

  // Only ids that exist. A stale tab could send one that has since been
  // deleted, and storing it would leave a saved order that quietly disagrees
  // with the board every time it is read.
  const known = await db.select({ id: table.id }).from(table).where(inArray(table.id, orderedIds))
  const live = new Set(known.map((r) => r.id))
  const keep = orderedIds.filter((id) => live.has(id))
  if (keep.length === 0) return { error: 'None of those still exist — reload the page.' }

  const personId = await viewerKey()

  await db
    .insert(cardOrders)
    .values({ personId, level, orderedIds: keep.join(',') })
    .onConflictDoUpdate({
      target: [cardOrders.personId, cardOrders.level],
      set: { orderedIds: keep.join(','), updatedAt: new Date() },
    })

  // The board already moved in the browser; this is for the reader's next
  // visit, and for the other tab they have open on the same page.
  //
  // The try/catch is the same one objectives/actions.ts carries, for the same
  // reason: revalidatePath needs a request context and throws this one
  // invariant without it, and the caller with no request is
  // scripts/check-card-order.ts, which is testing what reaches the database.
  // Every other error still propagates.
  try {
    revalidatePath('/')
  } catch (err) {
    if (!(err instanceof Error) || !/static generation store/i.test(err.message)) throw err
  }

  return { ok: true, stamp: Date.now() }
}
