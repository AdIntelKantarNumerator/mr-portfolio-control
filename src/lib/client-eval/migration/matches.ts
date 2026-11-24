/**
 * Matches already found, shared by every Migration Plan (Scott, 24 November 2026): the same advertisers
 * (Ford, P&G...) sit in thousands of clients' lists, and following each through Databricks again in every
 * plan made the big plans slow. A match, or the fact that there was none, is kept for a week.
 */
import { and, eq, gt, inArray, sql } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { ceGpcMatches } from '@/db/schema'

export type MatchKind = 'adv' | 'cat' | 'mag' | 'name'
const KEEP_DAYS = 7

/** What is known for these ids: a value, or null when it was looked for and nothing was found. Ids not in the map are unknown. */
export async function readMatches<T>(d: Database, kind: MatchKind, ids: string[]): Promise<Map<string, T | null>> {
  const out = new Map<string, T | null>()
  const since = new Date(Date.now() - KEEP_DAYS * 86_400_000)
  for (let i = 0; i < ids.length; i += 1000) {
    const part = ids.slice(i, i + 1000)
    if (!part.length) continue
    for (const r of await d
      .select({ id: ceGpcMatches.legacyId, gpc: ceGpcMatches.gpc })
      .from(ceGpcMatches)
      .where(and(eq(ceGpcMatches.kind, kind), inArray(ceGpcMatches.legacyId, part), gt(ceGpcMatches.checkedAt, since))))
      out.set(r.id, (r.gpc as T | null) ?? null)
  }
  return out
}

export async function saveMatches<T>(d: Database, kind: MatchKind, list: Array<[string, T | null]>): Promise<void> {
  // One row per id: an insert naming the same key twice fails as a whole ("SAN BENEDETTO" and "San Benedetto").
  const entries = [...new Map(list)]
  for (let i = 0; i < entries.length; i += 500) {
    const rows = entries.slice(i, i + 500).map(([legacyId, gpc]) => ({ kind, legacyId, gpc: gpc as unknown, checkedAt: new Date() }))
    if (!rows.length) continue
    await d
      .insert(ceGpcMatches)
      .values(rows)
      .onConflictDoUpdate({ target: [ceGpcMatches.kind, ceGpcMatches.legacyId], set: { gpc: sql`excluded.gpc`, checkedAt: sql`excluded.checked_at` } })
  }
}
