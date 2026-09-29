/**
 * Narrowing a register page to one piece of work.
 *
 * The home board's cards carry counts — "10 blockers", "3 open actions" — and
 * those counts roll up: an initiative's ten are ten across everything beneath
 * it. Clicking one used to land on the whole list, or on a page that does not
 * exist. Now it lands on that page narrowed to the same set the count came
 * from, which is the only version of the link that tells the truth: filter to
 * the initiative row alone and a count of ten opens a list of none.
 *
 * Built here rather than in each page because three pages need it and the
 * definition of "beneath" has to be the same on all of them — it is the same
 * definition the counts use. See lib/hierarchy.ts.
 */
import { idsAtOrBelow, parseScope, type Children } from './hierarchy'

export interface ScopeFilter {
  /** True when a record filed against this id belongs in the narrowed list. */
  covers: (entityId: string | null | undefined) => boolean
  /** What to show on the chip, or null when nothing is narrowed. */
  label: string | null
}

const ALL: ScopeFilter = { covers: () => true, label: null }

export function scopeFilter(
  raw: string | null | undefined,
  projects: ReadonlyArray<{ id: string; name: string; initiativeId: string | null }>,
  workstreams: ReadonlyArray<{ id: string; name: string; projectId: string | null }>,
  initiatives: ReadonlyArray<{ id: string; name: string }> = [],
): ScopeFilter {
  const scope = parseScope(raw)
  if (!scope) return ALL

  const children: Children = {
    projectsIn: groupBy(projects, (p) => p.initiativeId),
    workstreamsIn: groupBy(workstreams, (w) => w.projectId),
  }

  const ids = idsAtOrBelow(scope.level, scope.id, children)
  const name =
    initiatives.find((i) => i.id === scope.id)?.name ??
    projects.find((p) => p.id === scope.id)?.name ??
    workstreams.find((w) => w.id === scope.id)?.name ??
    null

  return {
    covers: (entityId) => Boolean(entityId && ids.has(entityId)),
    // Named where the name is known. An id whose record has since been
    // removed still filters — to nothing — and says so, rather than silently
    // showing the whole list as though no filter had been asked for.
    label: name ?? 'a record that no longer exists',
  }
}

function groupBy<T extends { id: string }>(
  rows: ReadonlyArray<T>,
  parent: (row: T) => string | null,
): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const row of rows) {
    const key = parent(row)
    if (!key) continue
    out.set(key, [...(out.get(key) ?? []), row.id])
  }
  return out
}
