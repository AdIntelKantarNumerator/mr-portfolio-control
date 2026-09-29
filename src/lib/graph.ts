/**
 * Dependency graph model: layering, cycle handling and critical-path analysis.
 *
 * Deliberately dependency-free. The portfolio graph is tens of nodes, not
 * thousands, so a layout library would add weight without buying anything —
 * and hand-rolling it means the "what is actually on the critical path"
 * question is answered by code we can read, rather than by a renderer.
 */
import type { DependencyRow, Portfolio } from './portfolio'
import { labelForEndpoint } from './portfolio'

export interface GraphNode {
  id: string // `${type}:${id}`
  type: string
  entityId: string
  label: string
  /** green | amber | red | unknown — from the assessment where one exists. */
  rag: string
  date: Date | null
  /** Not part of the portfolio: a vendor feed, another org's deliverable. */
  external: boolean
  layer: number
  order: number
  href?: string
}

export interface GraphEdge {
  from: string
  to: string
  dep: DependencyRow
  /** True when this edge had to be reversed to break a cycle. */
  reversed: boolean
}

export interface DependencyGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
  layers: GraphNode[][]
  /** Node ids on the longest unresolved chain, in order. */
  criticalPath: string[]
  /** Cycles detected and broken, reported rather than hidden. */
  brokenCycles: { from: string; to: string }[]
}

const key = (type: string, id: string) => `${type}:${id}`

function isLive(d: DependencyRow) {
  return d.status !== 'resolved'
}

export function buildGraph(p: Portfolio, opts: { includeResolved?: boolean } = {}): DependencyGraph {
  const deps = opts.includeResolved ? p.dependencies : p.dependencies.filter(isLive)

  // --- nodes -------------------------------------------------------------
  const nodes = new Map<string, GraphNode>()

  const ensure = (type: string, id: string, fallbackLabel?: string | null) => {
    const k = key(type, id)
    const existing = nodes.get(k)
    if (existing) return existing

    let label = fallbackLabel ?? ''
    let rag = 'unknown'
    let date: Date | null = null
    let href: string | undefined

    if (type === 'project') {
      const pr = p.projects.find((x) => x.id === id)
      if (pr) {
        label = pr.name
        rag = pr.health.rag
        date = pr.targetDate
        href = `/readiness/${pr.id}`
      }
    } else if (type === 'initiative') {
      const it = p.initiatives.find((x) => x.id === id)
      if (it) {
        label = it.name
        rag = it.health.rag
        date = it.targetDate ?? it.derivedTarget
        href = `/initiatives#${it.key}`
      }
    } else if (type === 'milestone') {
      const m = p.milestones.find((x) => x.id === id)
      if (m) {
        label = `${m.project.name} — ${m.name}`
        rag = m.contested ? 'red' : 'unknown'
        date = m.targetDate
      }
    }

    if (!label) label = fallbackLabel || labelForEndpoint(p, type, id)

    const node: GraphNode = {
      id: k,
      type,
      entityId: id,
      label,
      rag,
      date,
      external: type === 'external',
      layer: 0,
      order: 0,
      href,
    }
    nodes.set(k, node)
    return node
  }

  const edges: GraphEdge[] = []
  for (const d of deps) {
    const from = ensure(d.fromType, d.fromId, d.fromLabel)
    const to = ensure(d.toType, d.toId, d.toLabel)
    if (from.id === to.id) continue // self-dependency: meaningless, drop it
    edges.push({ from: from.id, to: to.id, dep: d, reversed: false })
  }

  // --- break cycles so layering terminates --------------------------------
  // A real portfolio graph does contain cycles (two teams each waiting on the
  // other). Reporting them is more useful than silently producing a broken
  // layout, so we record every edge we had to reverse.
  const brokenCycles: { from: string; to: string }[] = []
  const state = new Map<string, 0 | 1 | 2>() // unvisited | in-stack | done
  const adjacency = new Map<string, GraphEdge[]>()
  for (const e of edges) {
    if (!adjacency.has(e.from)) adjacency.set(e.from, [])
    adjacency.get(e.from)!.push(e)
  }

  const visit = (id: string) => {
    state.set(id, 1)
    for (const e of adjacency.get(id) ?? []) {
      const s = state.get(e.to) ?? 0
      if (s === 1) {
        e.reversed = true
        brokenCycles.push({ from: e.from, to: e.to })
      } else if (s === 0) {
        visit(e.to)
      }
    }
    state.set(id, 2)
  }
  for (const id of nodes.keys()) if ((state.get(id) ?? 0) === 0) visit(id)

  const forward = edges.filter((e) => !e.reversed)

  // --- longest-path layering ---------------------------------------------
  const incoming = new Map<string, GraphEdge[]>()
  for (const e of forward) {
    if (!incoming.has(e.to)) incoming.set(e.to, [])
    incoming.get(e.to)!.push(e)
  }

  const layerOf = new Map<string, number>()
  const resolveLayer = (id: string, seen = new Set<string>()): number => {
    if (layerOf.has(id)) return layerOf.get(id)!
    if (seen.has(id)) return 0
    seen.add(id)
    const parents = incoming.get(id) ?? []
    const value = parents.length === 0 ? 0 : Math.max(...parents.map((e) => resolveLayer(e.from, seen) + 1))
    layerOf.set(id, value)
    return value
  }
  for (const id of nodes.keys()) resolveLayer(id)
  for (const [id, l] of layerOf) nodes.get(id)!.layer = l

  const maxLayer = Math.max(0, ...[...layerOf.values()])
  const layers: GraphNode[][] = Array.from({ length: maxLayer + 1 }, () => [])
  for (const n of nodes.values()) layers[n.layer].push(n)

  // Order within a layer by the mean position of parents (one barycenter
  // pass). Two passes buy little on a graph this size; one visibly reduces
  // crossings over insertion order.
  const indexIn = (layer: GraphNode[], id: string) => layer.findIndex((n) => n.id === id)
  for (let l = 1; l < layers.length; l++) {
    const prev = layers[l - 1]
    layers[l].sort((a, b) => {
      const bary = (n: GraphNode) => {
        const parents = (incoming.get(n.id) ?? []).map((e) => indexIn(prev, e.from)).filter((i) => i >= 0)
        return parents.length ? parents.reduce((x, y) => x + y, 0) / parents.length : Number.MAX_SAFE_INTEGER
      }
      const diff = bary(a) - bary(b)
      return diff !== 0 ? diff : a.label.localeCompare(b.label)
    })
  }
  layers.forEach((layer) => layer.forEach((n, i) => (n.order = i)))

  // --- critical path ------------------------------------------------------
  // "Longest chain of unresolved dependencies", with critical edges weighted
  // more heavily than normal ones. This answers the question a program lead
  // actually asks — if one thing slips, what is the longest tail behind it —
  // rather than classic CPM, which needs durations we deliberately do not have.
  const weight = (e: GraphEdge) =>
    (e.dep.criticality === 'critical' ? 3 : e.dep.criticality === 'high' ? 2 : 1) +
    (e.dep.status === 'at_risk' ? 2 : 0)

  const best = new Map<string, { score: number; path: string[] }>()
  const outgoing = new Map<string, GraphEdge[]>()
  for (const e of forward) {
    if (!outgoing.has(e.from)) outgoing.set(e.from, [])
    outgoing.get(e.from)!.push(e)
  }

  const walk = (id: string, seen = new Set<string>()): { score: number; path: string[] } => {
    if (best.has(id)) return best.get(id)!
    if (seen.has(id)) return { score: 0, path: [id] }
    seen.add(id)
    let top = { score: 0, path: [id] }
    for (const e of outgoing.get(id) ?? []) {
      const sub = walk(e.to, seen)
      const score = sub.score + weight(e)
      if (score > top.score) top = { score, path: [id, ...sub.path] }
    }
    seen.delete(id)
    best.set(id, top)
    return top
  }

  let criticalPath: string[] = []
  let bestScore = 0
  for (const id of nodes.keys()) {
    const r = walk(id)
    if (r.score > bestScore && r.path.length > 1) {
      bestScore = r.score
      criticalPath = r.path
    }
  }

  return { nodes: [...nodes.values()], edges, layers, criticalPath, brokenCycles }
}

/**
 * Which teams depend on which other teams, derived from project dependencies.
 * Cross-team edges are where dependencies actually go wrong; same-team ones
 * are usually just sequencing, so they are reported separately.
 */
export function teamDependencyMatrix(p: Portfolio) {
  const cells = new Map<string, { count: number; atRisk: number }>()
  for (const d of p.dependencies) {
    if (d.fromType !== 'project' || d.toType !== 'project') continue
    const from = p.projects.find((x) => x.id === d.fromId)
    const to = p.projects.find((x) => x.id === d.toId)
    if (!from?.teamId || !to?.teamId) continue
    const k = `${from.teamId}|${to.teamId}`
    const cur = cells.get(k) ?? { count: 0, atRisk: 0 }
    cur.count += 1
    if (d.status === 'at_risk') cur.atRisk += 1
    cells.set(k, cur)
  }
  return cells
}
