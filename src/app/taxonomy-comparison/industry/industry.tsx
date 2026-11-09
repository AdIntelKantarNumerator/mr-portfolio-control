'use client'

/**
 * The Industry View: the GPC taxonomy as a tree on the left, a node's top 50
 * spenders on the right (Scott, 9 November 2026).
 *
 * Expanding the tree costs nothing - it was read once (actions.ts). The arrow
 * beside a node asks for its spenders: kept from an earlier read, or read now
 * from Databricks with the steps shown while it works, as the comparison
 * does. Product / Brand / Advertiser / Parent and the media and month filters
 * re-rank what was read; they never read again.
 */
import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  buildTree,
  INDUSTRY_BY,
  INDUSTRY_BY_LABEL,
  rankIndustry,
  TOP_SPENDERS,
  type IndustryBy,
  type IndustryResult,
  type TaxNode,
  type TreeNode,
} from '@/lib/taxonomy-industry-rules'
import { MEDIA_TYPES, MONTH_LABEL, MONTHS, money, pct, type MediaType, type Month } from '@/lib/taxonomy-rules'
import type { IndustryView } from '@/lib/taxonomy-industry'
import { Progress, Seg } from '../comparison'
import { TreeButton } from '../rollup'
import { openNode, pollNode, pollTree, rereadTree } from './actions'

export function IndustryExplorer({
  initialTree,
  initialNodeId,
  initialNode,
}: {
  initialTree: IndustryView<TaxNode[]> | null
  initialNodeId: string | null
  initialNode: IndustryView<IndustryResult> | null
}) {
  const router = useRouter()
  const [tree, setTree] = useState(initialTree)
  const [nodeId, setNodeId] = useState<string | null>(initialNodeId)
  const [node, setNode] = useState(initialNode)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  // Poll whichever read is running.
  useEffect(() => {
    if (tree?.status !== 'running') return
    const t = setTimeout(async () => setTree(await pollTree()), 2000)
    return () => clearTimeout(t)
  }, [tree])
  useEffect(() => {
    if (!nodeId || node?.status !== 'running') return
    const t = setTimeout(async () => {
      const next = await pollNode(nodeId)
      if (next) setNode(next)
    }, 2000)
    return () => clearTimeout(t)
  }, [nodeId, node])

  const nodes = useMemo(() => (tree?.status === 'done' ? (tree.result ?? []) : []), [tree])
  const roots = useMemo(() => buildTree(nodes), [nodes])

  const show = (id: string, again = false) =>
    start(async () => {
      setError(null)
      setNodeId(id)
      if (!again) setNode(null)
      router.replace(`/taxonomy-comparison/industry?node=${id}`, { scroll: false })
      const out = await openNode(id, again)
      if (out.error) setError(out.error)
      else setNode(out.view ?? null)
    })

  return (
    <div className="ix-grid">
      <div className="tile ix-tree-tile">
        <div className="tile-head">
          <h2>GPC taxonomy</h2>
          {tree?.status === 'done' ? (
            <button type="button" className="btn" onClick={() => start(async () => setTree(await rereadTree()))} title="Read the taxonomy again from Databricks">
              Re-read
            </button>
          ) : null}
        </div>
        {tree?.status === 'done' ? (
          <TaxTree roots={roots} selected={nodeId} onPick={(id) => show(id)} initialOpen={nodeId ? ancestorsOf(nodes, nodeId) : []} />
        ) : (
          <Progress steps={tree?.steps ?? []} failed={tree?.status === 'failed' ? (tree.error ?? 'Reading the taxonomy failed.') : null} what="Reading the taxonomy" />
        )}
      </div>

      <div className="ix-side">
        {error ? <p className="status crit">{error}</p> : null}
        {!nodeId ? (
          <div className="blank">
            <h2>Pick a node</h2>
            <p>Expand the taxonomy and press → beside a node to see its top {TOP_SPENDERS} spenders.</p>
          </div>
        ) : !node || node.status !== 'done' || !node.result ? (
          <Progress
            steps={node?.steps ?? [{ key: 'start', label: 'Starting', state: 'running' }]}
            failed={node?.status === 'failed' ? (node.error ?? 'Reading the node failed.') : null}
            what="Reading the node"
          />
        ) : (
          <Spenders result={node.result} updatedAt={node.updatedAt} busy={pending} onReread={() => show(node.result!.nodeId, true)} />
        )}
      </div>
    </div>
  )
}

/** The node and its ancestors, so a node opened from a link shows expanded to it. */
function ancestorsOf(nodes: readonly TaxNode[], id: string): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const out: string[] = []
  for (let n = byId.get(id); n?.parentId && !out.includes(n.parentId); n = byId.get(n.parentId)) out.push(n.parentId)
  return out
}

function TaxTree({ roots, selected, onPick, initialOpen }: { roots: TreeNode[]; selected: string | null; onPick: (id: string) => void; initialOpen: string[] }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(initialOpen))
  const [find, setFind] = useState('')
  const q = find.trim().toLowerCase()

  // Searching shows every node whose name matches, with the path down to it open.
  const matches = useMemo(() => {
    if (!q) return null
    const keep = new Set<string>()
    const walk = (t: TreeNode, trail: string[]): boolean => {
      const hit = t.name.toLowerCase().includes(q)
      let below = false
      for (const c of t.children) below = walk(c, [...trail, t.id]) || below
      if (hit || below) keep.add(t.id)
      return hit || below
    }
    for (const r of roots) walk(r, [])
    return keep
  }, [q, roots])

  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const render = (list: TreeNode[], depth: number) => (
    <ul className="ix-tree" role={depth ? 'group' : 'tree'}>
      {list
        .filter((t) => !matches || matches.has(t.id))
        .map((t) => {
          const expanded = matches ? true : open.has(t.id)
          return (
            <li key={t.id} role="treeitem" aria-expanded={t.children.length ? expanded : undefined} aria-selected={t.id === selected}>
              <div className={`ix-row ${t.id === selected ? 'on' : ''}`} style={{ ['--depth' as string]: depth }}>
                {t.children.length ? (
                  <button type="button" className="ix-caret" onClick={() => toggle(t.id)} aria-label={expanded ? `Collapse ${t.name}` : `Expand ${t.name}`}>
                    {expanded ? '▾' : '▸'}
                  </button>
                ) : (
                  <span className="ix-caret ix-leaf" aria-hidden />
                )}
                <span className="ix-name" title={t.level}>
                  {t.name}
                </span>
                <button type="button" className="ix-go" onClick={() => onPick(t.id)} title={`Top spenders in ${t.name}`} aria-label={`Top spenders in ${t.name}`}>
                  →
                </button>
              </div>
              {t.children.length && expanded ? render(t.children, depth + 1) : null}
            </li>
          )
        })}
    </ul>
  )

  return (
    <>
      <input className="tx-select ix-find" type="search" placeholder="Find a node" value={find} onChange={(e) => setFind(e.target.value)} />
      <div className="ix-tree-scroll">{render(roots, 0)}</div>
    </>
  )
}

const TREE_ROLE: Record<IndustryBy, 'brand' | 'advertiser' | 'parent' | null> = { product: null, brand: 'brand', advertiser: 'advertiser', parent: 'parent' }

function Spenders({ result, updatedAt, busy, onReread }: { result: IndustryResult; updatedAt: string; busy: boolean; onReread: () => void }) {
  const [by, setBy] = useState<IndustryBy>('advertiser')
  const [media, setMedia] = useState<MediaType | ''>('')
  const [month, setMonth] = useState<Month | ''>('')
  const r = useMemo(() => rankIndustry(result, by, { media: media || null, month: month || null }), [result, by, media, month])
  const top = r.rows[0]?.spend ?? 0

  return (
    <div className="tile ix-spenders">
      <div className="ix-path tx-muted">{result.path.slice(0, -1).join(' › ') || result.level}</div>
      <div className="tile-head">
        <h2 className="tx-title">{result.name}</h2>
        <div className="tile-right">
          <span className="tx-muted" title={`Read ${new Date(updatedAt).toLocaleString()}`}>
            Read {new Date(updatedAt).toLocaleDateString()}
          </span>
          <button type="button" className="btn" onClick={onReread} disabled={busy} title="Read this node again from Databricks">
            Re-read
          </button>
        </div>
      </div>

      <div className="ix-totals">
        <div className="tx-stat">
          <span className="tx-muted">Spend · Aug–Sep 2026</span>
          <strong className="ix-big">{money(r.total)}</strong>
        </div>
        <div className="tx-stat">
          <span className="tx-muted">
            Top {Math.min(TOP_SPENDERS, r.rows.length)} of {r.count.toLocaleString('en-US')} {INDUSTRY_BY_LABEL[by].toLowerCase()}s
          </span>
          <strong className="ix-big">{pct(r.listedShare)}</strong>
        </div>
      </div>

      <div className="tx-filters">
        <Seg label="By" value={by} onChange={(v) => setBy(v as IndustryBy)} options={INDUSTRY_BY.map((b) => [b, INDUSTRY_BY_LABEL[b]] as [string, string])} />
        <Seg label="Media" value={media} onChange={(v) => setMedia(v as MediaType | '')} options={[['', 'All'], ...MEDIA_TYPES.map((m) => [m, m] as [string, string])]} />
        <Seg label="Month" value={month} onChange={(v) => setMonth(v as Month | '')} options={[['', 'Both'], ...MONTHS.map((m) => [m, MONTH_LABEL[m].slice(0, 3)] as [string, string])]} />
      </div>

      {r.rows.length ? (
        <table className="tx-table ix-table">
          <thead>
            <tr>
              <th className="num">#</th>
              <th>{INDUSTRY_BY_LABEL[by]}</th>
              <th className="num">Spend</th>
              <th className="ix-share-head">Share of {result.name}</th>
            </tr>
          </thead>
          <tbody>
            {r.rows.map((x, i) => (
              <tr key={x.key}>
                <td className="num tx-muted">{i + 1}</td>
                <td>
                  {x.label}
                  {by === 'product' ? (
                    <TreeButton product={x.key} label={x.label} />
                  ) : (
                    <TreeButton entity={x.key} role={TREE_ROLE[by] ?? 'entity'} label={x.label} />
                  )}
                </td>
                <td className="num">{money(x.spend)}</td>
                <td>
                  <div className="ix-share">
                    <span className="ix-bar" aria-hidden>
                      <span style={{ width: `${top ? (x.spend / top) * 100 : 0}%` }} />
                    </span>
                    <span className="tx-muted">{pct(x.share)}</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="tx-muted">No spend on products in {result.name} for this media and month.</p>
      )}
    </div>
  )
}
