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
  defaultLegacyLevel,
  INDUSTRY_BY,
  INDUSTRY_BY_LABEL,
  LEGACY_LABEL,
  LEGACY_LEVELS,
  LEGACY_TAXONOMIES,
  LEGACY_VIEWS,
  matchName,
  rankIndustry,
  TOP_SPENDERS,
  type IndustryBy,
  type IndustryRanking,
  type IndustryResult,
  type LegacyTaxonomy,
  type TaxNode,
  type TreeNode,
} from '@/lib/taxonomy-industry-rules'
import { MEDIA_TYPES, MONTH_LABEL, MONTHS, money, pct, type MediaType, type Month } from '@/lib/taxonomy-rules'
import type { IndustryView } from '@/lib/taxonomy-industry'
import { Progress, Seg } from '../comparison'
import { TreeButton } from '../rollup'
import { openLegacy, openNode, pollLegacy, pollNode, pollTree, rereadTree } from './actions'

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
          <Spenders key={node.result.nodeId} result={node.result} updatedAt={node.updatedAt} busy={pending} onReread={() => show(node.result!.nodeId, true)} />
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

/** The legacy node picked under "Compare to". */
type Pick = { tax: LegacyTaxonomy; level: string; id: string }

/**
 * A node's spenders, and under "Compare to" a legacy node's beside them
 * (Scott, 10 November 2026). The legacy taxonomy, then its level (defaulting
 * near the GPC node's depth), then one of the up-to-50 legacy nodes the GPC
 * node's own spend falls into, most first. The legacy list is all of that
 * node's spend, read separately and kept; the By, media and month choices
 * apply to both lists, and a name in both is marked.
 */
function Spenders({ result, updatedAt, busy, onReread }: { result: IndustryResult; updatedAt: string; busy: boolean; onReread: () => void }) {
  const [by, setBy] = useState<IndustryBy>('advertiser')
  const [media, setMedia] = useState<MediaType | ''>('')
  const [month, setMonth] = useState<Month | ''>('')
  const r = useMemo(() => rankIndustry(result, by, { media: media || null, month: month || null }), [result, by, media, month])

  const [tax, setTax] = useState<LegacyTaxonomy | ''>('')
  const [level, setLevel] = useState('')
  const [picked, setPicked] = useState<Pick | null>(null)
  const [legacy, setLegacy] = useState<IndustryView<IndustryResult> | null>(null)
  const [legacyError, setLegacyError] = useState<string | null>(null)
  const [, start] = useTransition()
  const options = tax && level ? (result.legacy?.[tax]?.[level] ?? []) : []

  useEffect(() => {
    if (!picked || legacy?.status !== 'running') return
    const t = setTimeout(async () => {
      const next = await pollLegacy(picked.tax, picked.level, picked.id)
      if (next) setLegacy(next)
    }, 2000)
    return () => clearTimeout(t)
  }, [picked, legacy])

  const clearPick = () => {
    setPicked(null)
    setLegacy(null)
    setLegacyError(null)
  }
  const pickTax = (v: string) => {
    const t = (v || '') as LegacyTaxonomy | ''
    setTax(t)
    setLevel(t ? defaultLegacyLevel(t, result.level) : '')
    clearPick()
  }
  const pickNode = (id: string, again = false) => {
    if (!tax || !level || !id) return clearPick()
    const p = { tax, level, id }
    setPicked(p)
    if (!again) setLegacy(null)
    setLegacyError(null)
    start(async () => {
      const out = await openLegacy(p.tax, p.level, p.id, again)
      if (out.error) setLegacyError(out.error)
      else setLegacy(out.view ?? null)
    })
  }

  const legacyRanking = useMemo(
    () =>
      legacy?.status === 'done' && legacy.result && picked && LEGACY_VIEWS[picked.tax].includes(by)
        ? rankIndustry(legacy.result, by, { media: media || null, month: month || null })
        : null,
    [legacy, picked, by, media, month],
  )
  // Names in both lists (Scott: exact matches only), ignoring the "#id" that
  // tells two of one name apart within a list.
  const both = useMemo(() => {
    if (!legacyRanking) return new Set<string>()
    const bare = (l: string) => matchName(l.replace(/ #\w+$/, ''))
    const theirs = new Set(legacyRanking.rows.map((x) => bare(x.label)))
    return new Set(r.rows.map((x) => bare(x.label)).filter((n) => theirs.has(n)))
  }, [r, legacyRanking])

  return (
    <div className="tile ix-spenders">
      <div className="ix-path tx-muted">{result.path.slice(0, -1).join(' › ') || result.level}</div>
      <div className="tile-head ix-head">
        <h2 className="tx-title">{result.name}</h2>
        <div className="tile-right ix-compare">
          <span className="tx-muted">Compare to</span>
          <select className="tx-select" value={tax} onChange={(e) => pickTax(e.target.value)} aria-label="Legacy taxonomy">
            <option value="">—</option>
            {LEGACY_TAXONOMIES.map((t) => (
              <option key={t} value={t}>
                {LEGACY_LABEL[t]}
              </option>
            ))}
          </select>
          {tax ? (
            <>
              <select
                className="tx-select"
                value={level}
                onChange={(e) => {
                  setLevel(e.target.value)
                  clearPick()
                }}
                aria-label={`${LEGACY_LABEL[tax]} level`}
              >
                {LEGACY_LEVELS[tax].map((l) => (
                  <option key={l.key} value={l.key}>
                    {l.label}
                  </option>
                ))}
              </select>
              <select
                className="tx-select ix-node-pick"
                value={picked?.tax === tax && picked.level === level ? picked.id : ''}
                onChange={(e) => pickNode(e.target.value)}
                disabled={!result.legacy}
                aria-label={`${LEGACY_LABEL[tax]} node`}
                title={result.legacy ? `Where ${result.name}'s spend falls in ${LEGACY_LABEL[tax]}, most first` : 'Re-read this node to compare it'}
              >
                <option value="">{!result.legacy ? 'Re-read this node to compare' : options.length ? `Pick one of ${options.length}` : 'None of its spend lands here'}</option>
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name} · {money(o.spend)}
                  </option>
                ))}
              </select>
            </>
          ) : null}
          <span className="tx-muted ix-read" title={`Read ${new Date(updatedAt).toLocaleString()}`}>
            Read {new Date(updatedAt).toLocaleDateString()}
          </span>
          <button type="button" className="btn" onClick={onReread} disabled={busy} title="Read this node again from Databricks">
            Re-read
          </button>
        </div>
      </div>

      <div className="tx-filters">
        <Seg label="By" value={by} onChange={(v) => setBy(v as IndustryBy)} options={INDUSTRY_BY.map((b) => [b, INDUSTRY_BY_LABEL[b]] as [string, string])} />
        <Seg label="Media" value={media} onChange={(v) => setMedia(v as MediaType | '')} options={[['', 'All'], ...MEDIA_TYPES.map((m) => [m, m] as [string, string])]} />
        <Seg label="Month" value={month} onChange={(v) => setMonth(v as Month | '')} options={[['', 'Both'], ...MONTHS.map((m) => [m, MONTH_LABEL[m].slice(0, 3)] as [string, string])]} />
      </div>

      <div className={picked ? 'ix-pair' : ''}>
        <SpenderList title={picked ? `GPC · ${result.name}` : null} name={result.name} ranking={r} by={by} both={both} tree />
        {picked ? (
          <div className="ix-legacy">
            {legacyError ? <p className="status crit">{legacyError}</p> : null}
            {!legacy || legacy.status !== 'done' || !legacy.result ? (
              <Progress
                steps={legacy?.steps ?? [{ key: 'start', label: 'Starting', state: 'running' }]}
                failed={legacy?.status === 'failed' ? (legacy.error ?? 'The read failed.') : null}
                what={`Reading ${LEGACY_LABEL[picked.tax]}`}
              />
            ) : legacyRanking ? (
              <SpenderList
                title={`${LEGACY_LABEL[picked.tax]} · ${legacy.result.name}`}
                subtitle={`${legacy.result.level}${legacy.result.path.length > 1 ? ` · ${legacy.result.path.slice(0, -1).join(' › ')}` : ''}`}
                name={legacy.result.name}
                ranking={legacyRanking}
                by={by}
                both={both}
                onReread={() => pickNode(picked.id, true)}
                readAt={legacy.updatedAt}
                note={picked.tax === 'Classic' ? 'Classic tracks no CTV.' : null}
              />
            ) : (
              <div className="blank">
                <p>
                  {LEGACY_LABEL[picked.tax]} has no {INDUSTRY_BY_LABEL[by].toLowerCase()}s. Pick {LEGACY_VIEWS[picked.tax].map((b) => INDUSTRY_BY_LABEL[b]).join(', ')}.
                </p>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function SpenderList({
  title,
  subtitle,
  name,
  ranking,
  by,
  both,
  tree,
  onReread,
  readAt,
  note,
}: {
  title: string | null
  subtitle?: string
  name: string
  ranking: IndustryRanking
  by: IndustryBy
  both: Set<string>
  /** GPC rows only: a legacy id is not a GPC entity. */
  tree?: boolean
  onReread?: () => void
  readAt?: string
  note?: string | null
}) {
  const top = ranking.rows[0]?.spend ?? 0
  return (
    <div className="ix-list">
      {title ? (
        <div className="ix-list-head">
          <div>
            <strong>{title}</strong>
            {subtitle ? <div className="tx-muted ix-list-sub">{subtitle}</div> : null}
          </div>
          {onReread ? (
            <button type="button" className="btn" onClick={onReread} title={readAt ? `Read ${new Date(readAt).toLocaleString()}` : undefined}>
              Re-read
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="ix-totals">
        <div className="tx-stat">
          <span className="tx-muted">Spend · Aug–Sep 2026</span>
          <strong className="ix-big">{money(ranking.total)}</strong>
        </div>
        <div className="tx-stat">
          <span className="tx-muted">
            Top {Math.min(TOP_SPENDERS, ranking.rows.length)} of {ranking.count.toLocaleString('en-US')} {INDUSTRY_BY_LABEL[by].toLowerCase()}s
          </span>
          <strong className="ix-big">{pct(ranking.listedShare)}</strong>
        </div>
      </div>
      {note ? <p className="tx-muted ix-note">{note}</p> : null}
      {ranking.rows.length ? (
        <table className="tx-table ix-table">
          <thead>
            <tr>
              <th className="num">#</th>
              <th>{INDUSTRY_BY_LABEL[by]}</th>
              <th className="num">Spend</th>
              <th className="ix-share-head">Share of {name}</th>
            </tr>
          </thead>
          <tbody>
            {ranking.rows.map((x, i) => {
              const match = both.has(matchName(x.label.replace(/ #\w+$/, '')))
              return (
                <tr key={x.key} className={match ? 'ix-match' : ''}>
                  <td className="num tx-muted">{i + 1}</td>
                  <td>
                    {match ? (
                      <span className="ix-match-dot" title="The same name is in both lists" aria-label="In both lists">
                        ●
                      </span>
                    ) : null}
                    {x.label}
                    {tree ? (
                      by === 'product' ? (
                        <TreeButton product={x.key} label={x.label} />
                      ) : (
                        <TreeButton entity={x.key} role={TREE_ROLE[by] ?? 'entity'} label={x.label} />
                      )
                    ) : null}
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
              )
            })}
          </tbody>
        </table>
      ) : (
        <p className="tx-muted">No spend in {name} for this media and month.</p>
      )}
    </div>
  )
}
