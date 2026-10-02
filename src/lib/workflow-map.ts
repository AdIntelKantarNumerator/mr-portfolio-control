/**
 * The Workflow Assessment map, as arithmetic.
 *
 * Everything here is pure: given components and the links between them, where
 * does each box go, what does the grouped view show, and what sits downstream
 * of a thing. The page and the server actions are the IO around it.
 *
 * WHY LAYOUT IS COMPUTED, NOT STORED
 *
 * The first version of this map, in the mock, carried a column number on
 * every box. Adding one connection made nineteen boxes sit in the wrong
 * column, with arrows running right to left, and fixing it meant renumbering
 * half the map by hand. Nobody will do that in an editor. So the column is
 * derived from the arrows every time: a box sits one column to the right of
 * the furthest-right thing that feeds it. Add a link and the map rearranges
 * itself correctly.
 *
 * CYCLES
 *
 * Real systems have them — a review queue feeds the catalog that feeds the
 * review queue — and longest-path layering never terminates on one. A cycle
 * is broken by setting aside the links that close it (the back edges a
 * depth-first walk finds), laying out what remains, and drawing the set-aside
 * links anyway. They are returned so the page can draw them differently; they
 * are never dropped, because a link the map silently stopped showing is a
 * dependency nobody sees.
 */

export const COMPONENT_KINDS = ['software', 'human', 'rule'] as const
export type ComponentKind = (typeof COMPONENT_KINDS)[number]

export const KIND_LABEL: Record<ComponentKind, string> = {
  software: 'Software component',
  human: 'Human workflow',
  rule: 'Rule or configuration',
}

export const GROUP_KINDS = ['software', 'human'] as const
export type GroupKind = (typeof GROUP_KINDS)[number]

export interface MapComponent {
  id: string
  name: string
  kind: ComponentKind
  groupKey: string
}

export interface MapGroup {
  key: string
  name: string
  kind: GroupKind
  sortOrder: number
}

export interface MapLink {
  from: string
  to: string
}

export interface Layout {
  /** Column per id, 0 at the left. */
  column: Map<string, number>
  /** Ids per column, top to bottom. */
  columns: string[][]
  /** Links set aside to break a cycle. Still drawn, just not used for layout. */
  backLinks: MapLink[]
}

/**
 * Columns and row order for a set of ids and the links between them.
 *
 * `rank` orders ids that land in the same place with nothing else to separate
 * them — the caller passes group order then name, so a stable map renders the
 * same way every time rather than shuffling on each load.
 */
export function layout(ids: string[], links: MapLink[], rank: (id: string) => string = (id) => id): Layout {
  const known = new Set(ids)
  const usable = links.filter((l) => known.has(l.from) && known.has(l.to) && l.from !== l.to)

  const out = new Map<string, string[]>()
  for (const id of ids) out.set(id, [])
  for (const l of usable) out.get(l.from)!.push(l.to)

  // Back edges from a depth-first walk, started in rank order so the same
  // cycle is always broken at the same link.
  const order = [...ids].sort((a, b) => rank(a).localeCompare(rank(b)))
  const state = new Map<string, 0 | 1 | 2>() // 0 unseen, 1 on stack, 2 done
  const back = new Set<string>()
  const key = (a: string, b: string) => `${a}\u0000${b}`
  for (const start of order) {
    if (state.get(start)) continue
    // Iterative, so a long chain cannot overflow the stack.
    const stack: { id: string; next: number }[] = [{ id: start, next: 0 }]
    state.set(start, 1)
    while (stack.length) {
      const top = stack[stack.length - 1]!
      const targets = out.get(top.id)!
      if (top.next >= targets.length) {
        state.set(top.id, 2)
        stack.pop()
        continue
      }
      const to = targets[top.next++]!
      const s = state.get(to) ?? 0
      if (s === 1) back.add(key(top.id, to))
      else if (s === 0) {
        state.set(to, 1)
        stack.push({ id: to, next: 0 })
      }
    }
  }

  const forward = usable.filter((l) => !back.has(key(l.from, l.to)))
  const backLinks = usable.filter((l) => back.has(key(l.from, l.to)))

  // Longest path from the sources, in topological order.
  const indegree = new Map<string, number>(ids.map((id) => [id, 0]))
  const succ = new Map<string, string[]>(ids.map((id) => [id, []]))
  const preds = new Map<string, string[]>(ids.map((id) => [id, []]))
  for (const l of forward) {
    indegree.set(l.to, indegree.get(l.to)! + 1)
    succ.get(l.from)!.push(l.to)
    preds.get(l.to)!.push(l.from)
  }
  const column = new Map<string, number>(ids.map((id) => [id, 0]))
  const queue = order.filter((id) => indegree.get(id) === 0)
  while (queue.length) {
    const id = queue.shift()!
    for (const to of succ.get(id)!) {
      column.set(to, Math.max(column.get(to)!, column.get(id)! + 1))
      indegree.set(to, indegree.get(to)! - 1)
      if (indegree.get(to) === 0) queue.push(to)
    }
  }

  // A source — something nothing feeds — is pulled right to sit just before
  // the first thing it feeds. Longest-path layering alone puts every source
  // in column 0, and on the real map that sent the classification rulebook
  // and the Vivvix Central UI to the far left, dragging the operations queues
  // they feed into the ingest columns. Moving a source cannot disturb anyone
  // else's column: nothing depends on where a source sits.
  for (const id of order) {
    if (preds.get(id)!.length) continue
    const next = succ.get(id)!
    if (!next.length) continue
    column.set(id, Math.max(0, Math.min(...next.map((s) => column.get(s)!)) - 1))
  }

  // Row order: one barycentre pass, left to right. Each box sits near the
  // average height of what feeds it, which keeps most arrows short and
  // nearly flat. One pass is enough at this size; more mostly reshuffles.
  const width = Math.max(0, ...column.values()) + 1
  const columns: string[][] = Array.from({ length: width }, () => [])
  for (const id of order) columns[column.get(id)!]!.push(id)
  const row = new Map<string, number>()
  columns[0]?.forEach((id, i) => row.set(id, i))
  for (let c = 1; c < width; c++) {
    const col = columns[c]!
    const weight = (id: string) => {
      const ps = preds.get(id)!.filter((p) => row.has(p))
      return ps.length ? ps.reduce((sum, p) => sum + row.get(p)!, 0) / ps.length : Number.POSITIVE_INFINITY
    }
    col.sort((a, b) => weight(a) - weight(b) || rank(a).localeCompare(rank(b)))
    col.forEach((id, i) => row.set(id, i))
  }

  return { column, columns, backLinks }
}

/**
 * The grouped view's arrows: group A points at group B when any component in
 * A feeds any component in B. `count` is how many component links that one
 * arrow stands for, so the page can say so on hover.
 */
export function groupLinks(components: MapComponent[], links: MapLink[]): (MapLink & { count: number })[] {
  const groupOf = new Map(components.map((c) => [c.id, c.groupKey]))
  const counts = new Map<string, { from: string; to: string; count: number }>()
  for (const l of links) {
    const a = groupOf.get(l.from)
    const b = groupOf.get(l.to)
    if (!a || !b || a === b) continue
    const k = `${a}\u0000${b}`
    const hit = counts.get(k)
    if (hit) hit.count++
    else counts.set(k, { from: a, to: b, count: 1 })
  }
  return [...counts.values()]
}

/**
 * What a change to `id` can reach: the components it feeds directly, and
 * everything reachable from those.
 *
 * This is the mechanism the assessment answer will stand on, so it follows the
 * arrows and nothing else. It does not guess at relevance and it does not stop
 * at a group boundary; deciding what is "likely" versus "possible" is for the
 * layer that explains the answer, not for the walk.
 */
export function downstream(id: string, links: MapLink[]): { direct: string[]; all: string[] } {
  const succ = new Map<string, string[]>()
  for (const l of links) {
    if (l.from === l.to) continue
    if (!succ.has(l.from)) succ.set(l.from, [])
    succ.get(l.from)!.push(l.to)
  }
  const direct = [...new Set(succ.get(id) ?? [])]
  const seen = new Set<string>([id])
  const all: string[] = []
  const queue = [...direct]
  while (queue.length) {
    const next = queue.shift()!
    if (seen.has(next)) continue
    seen.add(next)
    all.push(next)
    for (const to of succ.get(next) ?? []) if (!seen.has(to)) queue.push(to)
  }
  return { direct, all }
}

/**
 * Why a group cannot take this name, or null when it can. Names are what
 * people read on the map and what the assessment chat is shown, so two
 * groups with one name would make both ambiguous.
 */
export function groupNameProblem(name: string, key: string, groups: Array<{ key: string; name: string }>): string | null {
  const n = name.replace(/\s+/g, ' ').trim()
  if (!n) return 'A group needs a name.'
  if (n.length > 80) return 'Keep the name under 80 characters.'
  if (!groups.some((g) => g.key === key)) return 'That group no longer exists. Reload the page.'
  const clash = groups.find((g) => g.key !== key && g.name.trim().toLowerCase() === n.toLowerCase())
  if (clash) return `Another group is already called "${clash.name}".`
  return null
}

/** Why a proposed link cannot be added, or null when it can. */
export function linkProblem(from: string, to: string, existing: MapLink[], knownIds: Set<string>): string | null {
  if (!from || !to) return 'Pick a component for both ends.'
  if (!knownIds.has(from) || !knownIds.has(to)) return 'One end of that connection no longer exists. Reload the page.'
  if (from === to) return 'A component cannot feed itself.'
  if (existing.some((l) => l.from === from && l.to === to)) return 'Those two are already connected that way round.'
  return null
}

export interface ComponentInput {
  name: string
  kind: ComponentKind
  groupKey: string
  owner: string | null
  description: string | null
  detail: string | null
  aliases: string | null
}

/**
 * Turn a submitted form into a component, or say what is wrong with it.
 *
 * Blank optional fields become null rather than empty strings, so "nobody has
 * described this" is one state and not two. Aliases are tidied to a single
 * comma-and-space form because they are matched word by word, and a stray
 * double comma would otherwise match the empty string against everything.
 */
export function readComponentInput(
  raw: Record<string, unknown>,
  groupKeys: Set<string>,
): { ok: true; value: ComponentInput } | { ok: false; fieldErrors: Record<string, string> } {
  const text = (k: string) => String(raw[k] ?? '').trim()
  const optional = (k: string, max: number) => {
    const v = text(k)
    return v ? v.slice(0, max) : null
  }
  const fieldErrors: Record<string, string> = {}

  const name = text('name')
  if (!name) fieldErrors.name = 'Give it the name people use for it.'
  else if (name.length > 120) fieldErrors.name = 'Keep the name under 120 characters; put the rest in the description.'

  const kind = text('kind') as ComponentKind
  if (!(COMPONENT_KINDS as readonly string[]).includes(kind)) fieldErrors.kind = 'Pick a kind.'

  const groupKey = text('groupKey')
  if (!groupKeys.has(groupKey)) fieldErrors.groupKey = 'Pick a group.'

  if (Object.keys(fieldErrors).length) return { ok: false, fieldErrors }

  return {
    ok: true,
    value: {
      name,
      kind,
      groupKey,
      owner: optional('owner', 120),
      description: optional('description', 4000),
      detail: optional('detail', 240),
      aliases: tidyAliases(text('aliases')),
    },
  }
}

export function tidyAliases(raw: string): string | null {
  const words = raw
    .split(',')
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean)
  const unique = [...new Set(words)]
  return unique.length ? unique.join(', ').slice(0, 1000) : null
}
