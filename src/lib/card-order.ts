/**
 * Reading a reader's own arrangement of the home board.
 *
 * WHY THIS IS NOT IN app/order-actions.ts
 *
 * That module is `'use server'`, so every function it exports is a server
 * action the browser can call by name. A read that takes a person id as an
 * argument would then be an endpoint for "show me anybody's arrangement",
 * which is not much of a secret but is not something a page needs to offer
 * either. The write stays an action because a click has to reach it; the read
 * happens during the render and belongs here.
 */
import { and, eq } from 'drizzle-orm'
import { cache } from 'react'
import { db } from '@/db/client'
import { cardOrders } from '@/db/schema'
import { getCurrentUser } from '@/lib/auth/current-user'
import type { Level } from './home-types'

/**
 * Whose arrangement this is.
 *
 * In production nobody reaches the board without a session (see proxy.ts), and
 * signing in creates a `people` row, so there is always a person id. With auth
 * switched off — a local development copy, which has one reader — every
 * arrangement belongs to 'local'.
 */
export const viewerKey = cache(async (): Promise<string> => {
  const user = await getCurrentUser()
  return user.personId ?? 'local'
})

/**
 * The ids this reader last dragged into order at this level, or null if they
 * never have. Callers decide what to do about ids that have since been
 * deleted and cards the saved list has never seen.
 */
export const getCardOrder = cache(async (level: Level): Promise<string[] | null> => {
  const personId = await viewerKey()
  const [row] = await db
    .select({ ids: cardOrders.orderedIds })
    .from(cardOrders)
    .where(and(eq(cardOrders.personId, personId), eq(cardOrders.level, level)))
    .limit(1)
  const ids = row?.ids.split(',').filter(Boolean) ?? []
  return ids.length ? ids : null
})
