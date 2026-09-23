import Link from 'next/link'
import type { DependencyGraph, GraphNode } from '@/lib/graph'
import { fmtDate } from '@/lib/util'
import { label as vocab } from '@/lib/domain'

const NODE_W = 172
const NODE_H = 58
const COL_GAP = 78
const ROW_GAP = 20
const PAD = 16

const RAG_STROKE: Record<string, string> = {
  green: 'var(--green)',
  amber: '#d97706',
  red: 'var(--red)',
  unknown: 'var(--slate)',
}

const RAG_FILL: Record<string, string> = {
  green: 'var(--green-bg)',
  amber: 'var(--amber-bg)',
  red: 'var(--red-bg)',
  unknown: 'var(--raised)',
}

/**
 * Layered left-to-right dependency graph, drawn as inline SVG.
 *
 * Reads as "what has to be true first" — anything to the left must land before
 * the things it points at. Nodes on the critical path are outlined heavily so
 * the eye finds the chain before reading a single label.
 */
export function DependencyGraphView({ graph }: { graph: DependencyGraph }) {
  if (graph.nodes.length === 0) {
    return (
      <div
        className="rounded-lg border border-dashed px-4 py-8 text-center text-[12.5px]"
        style={{ borderColor: 'var(--line)', color: 'var(--muted)' }}
      >
        No open dependencies recorded yet.
      </div>
    )
  }

  const tallest = Math.max(...graph.layers.map((l) => l.length))
  const width = PAD * 2 + graph.layers.length * NODE_W + (graph.layers.length - 1) * COL_GAP
  const height = PAD * 2 + tallest * NODE_H + (tallest - 1) * ROW_GAP

  const pos = new Map<string, { x: number; y: number }>()
  graph.layers.forEach((layer, li) => {
    // Centre each column vertically so short columns do not hug the top.
    const colHeight = layer.length * NODE_H + (layer.length - 1) * ROW_GAP
    const offset = (height - PAD * 2 - colHeight) / 2
    layer.forEach((n, ni) => {
      pos.set(n.id, {
        x: PAD + li * (NODE_W + COL_GAP),
        y: PAD + offset + ni * (NODE_H + ROW_GAP),
      })
    })
  })

  const critical = new Set(graph.criticalPath)
  const criticalEdge = (from: string, to: string) => {
    const i = graph.criticalPath.indexOf(from)
    return i >= 0 && graph.criticalPath[i + 1] === to
  }

  return (
    <div className="scroll-x">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ minWidth: width }}
        role="img"
        aria-label="Dependency graph, read left to right"
      >
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="var(--muted)" />
          </marker>
          <marker id="arrow-risk" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="var(--red)" />
          </marker>
        </defs>

        {graph.edges.map((e, i) => {
          const a = pos.get(e.from)
          const b = pos.get(e.to)
          if (!a || !b) return null
          const x1 = a.x + NODE_W
          const y1 = a.y + NODE_H / 2
          const x2 = b.x
          const y2 = b.y + NODE_H / 2
          const mid = (x1 + x2) / 2
          const onPath = criticalEdge(e.from, e.to)
          const risky = e.dep.status === 'at_risk' || e.dep.criticality === 'critical'
          const stroke = risky ? 'var(--red)' : onPath ? 'var(--brand)' : 'var(--muted)'

          return (
            <path
              key={`${e.from}-${e.to}-${i}`}
              d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`}
              fill="none"
              stroke={stroke}
              strokeWidth={onPath ? 2.6 : risky ? 2 : 1.3}
              strokeDasharray={e.dep.kind === 'shares_resource' ? '5 4' : undefined}
              markerEnd={risky ? 'url(#arrow-risk)' : 'url(#arrow)'}
              opacity={onPath || risky ? 1 : 0.55}
            >
              <title>
                {`${vocab('dependencyKind', e.dep.kind)} · ${vocab('dependencyStatus', e.dep.status)}${
                  e.dep.description ? `\n${e.dep.description}` : ''
                }${e.reversed ? '\nThis edge was reversed to break a cycle.' : ''}`}
              </title>
            </path>
          )
        })}

        {graph.nodes.map((n) => {
          const p = pos.get(n.id)
          if (!p) return null
          return <NodeBox key={n.id} node={n} x={p.x} y={p.y} onCriticalPath={critical.has(n.id)} />
        })}
      </svg>
    </div>
  )
}

function NodeBox({
  node,
  x,
  y,
  onCriticalPath,
}: {
  node: GraphNode
  x: number
  y: number
  onCriticalPath: boolean
}) {
  const body = (
    <g>
      <rect
        x={x}
        y={y}
        width={NODE_W}
        height={NODE_H}
        rx={9}
        fill={RAG_FILL[node.rag] ?? 'var(--raised)'}
        stroke={onCriticalPath ? 'var(--brand)' : (RAG_STROKE[node.rag] ?? 'var(--line)')}
        strokeWidth={onCriticalPath ? 2.8 : 1.4}
        strokeDasharray={node.external ? '6 4' : undefined}
      />
      <foreignObject x={x + 1} y={y + 1} width={NODE_W - 2} height={NODE_H - 2}>
        <div
          className="flex h-full flex-col justify-center gap-0.5 px-2.5"
          style={{ fontSize: 11, lineHeight: 1.25, color: 'var(--ink)' }}
        >
          <div className="line-clamp-2 font-semibold">{node.label}</div>
          <div className="flex items-center gap-1.5" style={{ color: 'var(--muted)', fontSize: 9.5 }}>
            {node.external ? <span>external</span> : <span>{node.type}</span>}
            {node.date ? <span>· {fmtDate(node.date)}</span> : null}
          </div>
        </div>
      </foreignObject>
      <title>
        {`${node.label}\n${node.external ? 'Outside the portfolio' : node.type}${
          node.date ? `\nTarget ${fmtDate(node.date, { year: true })}` : ''
        }\nHealth: ${vocab('rag', node.rag)}${onCriticalPath ? '\nOn the critical chain' : ''}`}
      </title>
    </g>
  )

  if (!node.href) return body
  return (
    <Link href={node.href} className="cursor-pointer">
      {body}
    </Link>
  )
}

export function GraphLegend() {
  return (
    <div
      className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px]"
      style={{ color: 'var(--muted)' }}
    >
      <span className="font-semibold">Reads left to right — anything left must land first.</span>
      <span className="inline-flex items-center gap-1.5">
        <svg width="26" height="8" aria-hidden>
          <line x1="0" y1="4" x2="26" y2="4" stroke="var(--red)" strokeWidth="2" />
        </svg>
        At risk or critical
      </span>
      <span className="inline-flex items-center gap-1.5">
        <svg width="26" height="8" aria-hidden>
          <line x1="0" y1="4" x2="26" y2="4" stroke="var(--brand)" strokeWidth="2.6" />
        </svg>
        Critical chain
      </span>
      <span className="inline-flex items-center gap-1.5">
        <svg width="26" height="8" aria-hidden>
          <line x1="0" y1="4" x2="26" y2="4" stroke="var(--muted)" strokeWidth="1.5" strokeDasharray="5 4" />
        </svg>
        Shares people
      </span>
      <span className="inline-flex items-center gap-1.5">
        <svg width="16" height="12" aria-hidden>
          <rect x="1" y="1" width="14" height="10" rx="3" fill="none" stroke="var(--muted)" strokeDasharray="4 3" />
        </svg>
        Outside the portfolio
      </span>
    </div>
  )
}
