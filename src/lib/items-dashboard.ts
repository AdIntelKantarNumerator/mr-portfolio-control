/**
 * Everything one work-in-progress dashboard shows, for one kind of item and,
 * when a card linked here, one piece of work and what sits beneath it.
 *
 * See components/items/parts.tsx for the tiles and lib/items.ts for the data.
 */
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { initiatives, objectives, projects } from '@/db/schema'
import { byImportance, inScope, loadItems, scopeIds, type Item } from './items'
import { closureHealth, HEALTH_WINDOW_DAYS, type Rag } from './item-activity'
import { parseScope } from './hierarchy'
import type { ItemKind } from './importance'
import type { ItemInfo } from '@/components/items/parts'

export interface Dashboard {
  /** The piece of work it is narrowed to, by name, or null for everything. */
  scopeName: string | null
  scope: string | null
  health: { rag: Rag; reasons: string[] }
  top: ItemInfo[]
  /** ref → what the lists need about each open item. */
  info: Record<string, ItemInfo>
  activeRefs: Set<string>
  inactiveRefs: Set<string>
  /** Where each open item sits (entity ids), for narrowing a page's own rows. */
  ids: Set<string> | null
}

export function toInfo(i: Item): ItemInfo {
  return {
    ref: i.ref,
    kind: i.kind,
    title: i.title,
    owner: i.ownerName,
    places: i.places.map((p) => p.name),
    score: i.score,
    band: i.band,
    bandNote: i.bandNote,

    factors: i.factors,
    reasons: i.reasons.map((r) => ({ factor: r.factor, why: r.why, quote: r.quote ?? null, source: r.source ?? null, url: r.url ?? null })),
    adjust: i.adjust,
    mentions: i.mentions,
    createdAt: i.createdAt.toISOString(),
    lastActivityAt: i.lastActivityAt.toISOString(),
    inactive: i.inactive,
  }
}

async function nameOf(level: string, id: string): Promise<string | null> {
  const table = level === 'objective' ? objectives : level === 'initiative' ? initiatives : projects
  const [row] = await db.select({ name: table.name }).from(table).where(eq(table.id, id)).limit(1)
  return row?.name ?? null
}

/** Settled, as opposed to withdrawn or merged: what counts as closing for the health tile. */
const SETTLED = new Set(['decided', 'done'])

export async function dashboardFor(kind: ItemKind, scopeParam: string | null | undefined, now = new Date()): Promise<Dashboard> {
  const cutoff = new Date(now.getTime() - HEALTH_WINDOW_DAYS * 86_400_000)
  const parsed = parseScope(scopeParam)
  const ids = parsed ? await scopeIds(parsed.level, parsed.id) : null
  const items = inScope(await loadItems({ kinds: [kind], closedSince: cutoff, now }), ids)

  const open = items.filter((i) => i.open)
  const active = open.filter((i) => !i.inactive)
  const health = closureHealth({
    opened: items.filter((i) => i.createdAt >= cutoff).length,
    closed: items.filter((i) => !i.open && SETTLED.has(i.status) && i.closedAt && i.closedAt >= cutoff).length,
    activeOpen: active.length,
    totalOpen: open.length,
    // Inactive items are never banded Critical (lib/importance.ts), so this
    // counts by score: an item important enough to be Critical, left a week.
    criticalStale: open.filter((i) => i.inactive && (i.score ?? 0) >= 60).length,
  })

  const info: Record<string, ItemInfo> = {}
  for (const i of open) info[i.ref] = toInfo(i)

  return {
    scopeName: parsed ? ((await nameOf(parsed.level, parsed.id)) ?? 'a record that no longer exists') : null,
    scope: parsed ? `${parsed.level}:${parsed.id}` : null,
    health,
    // The top five come from the open list, not the inactive one: something
    // nobody has touched in a week is a candidate for withdrawal, not for
    // the top of the page.
    top: [...active].sort(byImportance).slice(0, 5).map(toInfo),
    info,
    activeRefs: new Set(active.map((i) => i.ref)),
    inactiveRefs: new Set(open.filter((i) => i.inactive).map((i) => i.ref)),
    ids,
  }
}
