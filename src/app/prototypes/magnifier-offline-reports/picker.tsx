'use client'
/**
 * The entry screen: the GPC category taxonomy as a tree, any level pickable.
 * Each node shows its spend in the latest complete month, so an empty branch
 * reads as empty before anyone opens it.
 */
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { money, type TaxNode } from '@/lib/magnifier-reports/rules'

interface Branch extends TaxNode {
  children: Branch[]
  spend: number
}

export function CategoryPicker({ nodes, spend, monthName }: { nodes: TaxNode[]; spend: Record<number, number>; monthName: string }) {
  const roots = useMemo(() => {
    const byId = new Map<number, Branch>(nodes.map((n) => [n.id, { ...n, children: [], spend: spend[n.id] ?? 0 }]))
    const top: Branch[] = []
    for (const b of byId.values()) {
      const p = b.parentId == null ? undefined : byId.get(b.parentId)
      if (p) p.children.push(b)
      else top.push(b)
    }
    const sort = (l: Branch[]) => {
      l.sort((a, b) => b.spend - a.spend || a.name.localeCompare(b.name))
      l.forEach((x) => sort(x.children))
    }
    sort(top)
    return top
  }, [nodes, spend])

  const [open, setOpen] = useState<Set<number>>(new Set())
  const [find, setFind] = useState('')
  const q = find.trim().toLowerCase()
  const keep = useMemo(() => {
    if (q.length < 2) return null
    const k = new Set<number>()
    const walk = (b: Branch): boolean => {
      let below = false
      for (const c of b.children) below = walk(c) || below
      const hit = b.name.toLowerCase().includes(q)
      if (hit || below) k.add(b.id)
      return hit || below
    }
    roots.forEach(walk)
    return k
  }, [q, roots])

  const toggle = (id: number) =>
    setOpen((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const render = (list: Branch[], depth: number) => (
    <ul className="mor-tree" role={depth ? 'group' : 'tree'}>
      {list
        .filter((b) => !keep || keep.has(b.id))
        .map((b) => {
          const expanded = keep ? true : open.has(b.id)
          return (
            <li key={b.id} role="treeitem" aria-selected={false} aria-expanded={b.children.length ? expanded : undefined}>
              <div className={`row ${b.spend ? '' : 'empty'}`} style={{ ['--depth' as string]: depth }}>
                {b.children.length ? (
                  <button type="button" className="caret" onClick={() => toggle(b.id)} aria-label={expanded ? `Collapse ${b.name}` : `Expand ${b.name}`}>
                    {expanded ? '▾' : '▸'}
                  </button>
                ) : (
                  <span />
                )}
                <Link className="name" href={`?node=${b.id}`} title={`Open the ${b.level.toLowerCase()} dashboard`}>
                  {b.name}
                </Link>
                <span className="lvl">{b.level}</span>
                <span className="amt" title={`Spend in ${monthName}`}>
                  {b.spend ? money(b.spend) : '—'}
                </span>
              </div>
              {b.children.length && expanded ? render(b.children, depth + 1) : null}
            </li>
          )
        })}
    </ul>
  )

  return (
    <div className="mor-pick">
      <input className="mor-find" type="search" placeholder="Find an industry, category or subcategory" value={find} onChange={(e) => setFind(e.target.value)} autoFocus />
      <div className="mor-card w12">{render(roots, 0)}</div>
    </div>
  )
}
