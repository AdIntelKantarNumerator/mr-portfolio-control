'use server'

/**
 * What the work-in-progress dashboards do to items: make one more or less
 * important, show its history, withdraw everything gone inactive.
 *
 * Through lib/items.ts applyItemUpdate, the one way anything changes an item,
 * so a change made here leaves the same trail as one Yaara makes.
 */
import { revalidatePath } from 'next/cache'
import { editor } from '@/lib/auth/editor'
import { applyItemUpdate, inactiveRefs, itemHistory, scopeIds } from '@/lib/items'
import { parseScope } from '@/lib/hierarchy'
import type { ItemKind } from '@/lib/importance'

function refresh() {
  for (const p of ['/', '/blockers', '/decisions', '/actions']) {
    try {
      revalidatePath(p)
    } catch {
      // No request context (a script).
    }
  }
}

export async function adjustItem(ref: string, delta: 1 | -1): Promise<{ ok?: boolean; score?: number | null; error?: string }> {
  const who = await editor()
  if (!who.ok) return { error: who.error }
  const res = await applyItemUpdate({ ref, action: 'adjust', delta, actor: who.name })
  if (!res.ok) return { error: res.error }
  refresh()
  return { ok: true, score: res.score }
}

export interface HistoryEntry {
  kind: string
  at: string
  actor: string | null
  note: string | null
  source: string | null
  url: string | null
}

export async function loadItemHistory(ref: string): Promise<HistoryEntry[]> {
  const rows = await itemHistory(ref)
  return rows.map((r) => ({ ...r, at: r.at.toISOString() }))
}

const KINDS = new Set<ItemKind>(['blocker', 'decision', 'action'])

/**
 * Withdraw every inactive item of one kind on this page - the scope it is
 * narrowed to, or everything. Recorded on each item and in Activity, and each
 * can be reopened.
 */
export async function withdrawInactive(kind: string, scope: string | null): Promise<{ ok?: boolean; count?: number; error?: string }> {
  if (!KINDS.has(kind as ItemKind)) return { error: 'Unknown kind.' }
  const who = await editor()
  if (!who.ok) return { error: who.error }
  const narrowed = parseScope(scope)
  const ids = narrowed ? await scopeIds(narrowed.level, narrowed.id) : null
  const refs = await inactiveRefs(kind as ItemKind, ids)
  let count = 0
  for (const ref of refs) {
    const res = await applyItemUpdate({
      ref,
      action: 'drop',
      actor: who.name,
      note: 'Withdrawn with every other item that had no update for seven days.',
    })
    if (res.ok) count++
  }
  refresh()
  return { ok: true, count }
}
