'use client'

/**
 * The tree icon and its family tree (Scott, 9 and 10 November 2026).
 *
 * Beside a GPC product, brand, advertiser or parent in any list, a click
 * opens the whole family it belongs to: from the top parent down through
 * every entity below it, each with its products. The item the icon was on is
 * highlighted, and the path down to it is open; everything else expands on
 * click. An entity's products are read when it is opened (tree/route.ts):
 * The Walt Disney Company has 255 entities and 11,537 products, which is a
 * tree to walk, not a page to load.
 *
 * No spend in the tree, for now (Scott, 10 November 2026). GPC labels no
 * entity as a brand, subsidiary or parent; nor does the tree, beyond marking
 * the top.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Family, FamilyEntity } from '@/lib/taxonomy-dbx'

type Load<T> = { loading: true } | { loading: false; data: T } | { loading: false; error: string }

/** What the row the icon is on is: kept for the dialog's heading. */
export type RollupRole = 'advertiser' | 'brand' | 'parent' | 'entity'

const ROLE_LABEL: Record<RollupRole, string> = { advertiser: 'Advertiser', brand: 'Brand', parent: 'Parent', entity: 'Entity' }

async function getJson<T>(url: string): Promise<Load<T>> {
  try {
    const res = await fetch(url)
    const body = (await res.json()) as T | { error: string }
    return body && typeof body === 'object' && 'error' in (body as object) ? { loading: false, error: (body as { error: string }).error } : { loading: false, data: body as T }
  } catch (err) {
    return { loading: false, error: (err as Error).message }
  }
}

export function TreeButton({ product, entity, role = 'entity', label }: { product?: string | null; entity?: string | null; role?: RollupRole; label: string }) {
  const [open, setOpen] = useState(false)
  const id = product ?? entity
  if (!id || !/^\d+$/.test(id) || id === '0') return null
  return (
    <>
      <button type="button" className={`tx-tree ${open ? 'on' : ''}`} onClick={() => setOpen(true)} title={`Family tree for ${label}`} aria-label={`Family tree for ${label}`} aria-haspopup="dialog">
        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden>
          <rect x="6" y="1" width="4" height="4" rx="1" />
          <rect x="1" y="11" width="4" height="4" rx="1" />
          <rect x="11" y="11" width="4" height="4" rx="1" />
          <path d="M8 5v3M3 11V8h10v3" fill="none" strokeWidth="1.4" />
        </svg>
      </button>
      {open ? <FamilyDialog product={product ?? null} entity={product ? null : (entity ?? null)} role={product ? 'brand' : role} label={label} onClose={() => setOpen(false)} /> : null}
    </>
  )
}

function FamilyDialog({ product, entity, role, label, onClose }: { product: string | null; entity: string | null; role: RollupRole; label: string; onClose: () => void }) {
  const [family, setFamily] = useState<Load<Family>>({ loading: true })

  useEffect(() => {
    let live = true
    void getJson<Family>(`/taxonomy-comparison/tree?${product ? `product=${product}` : `entity=${entity}`}`).then((f) => live && setFamily(f))
    return () => {
      live = false
    }
  }, [product, entity])

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onClose])

  return (
    <div className="tx-family-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="tx-family" role="dialog" aria-modal="true" aria-label={`Family tree for ${label}`}>
        <div className="tx-family-head">
          <div>
            <div className="tx-muted">Family tree · {product ? 'Product' : ROLE_LABEL[role]}</div>
            <strong className="tx-total-title">{label}</strong>
          </div>
          <button type="button" className="tx-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="tx-family-body">
          {family.loading ? (
            <span className="tx-muted">Reading GPC…</span>
          ) : 'error' in family ? (
            <span className="status crit">{family.error}</span>
          ) : (
            <FamilyTree family={family.data} />
          )}
        </div>
      </div>
    </div>
  )
}

function FamilyTree({ family }: { family: Family }) {
  const children = useMemo(() => {
    const m = new Map<string | null, FamilyEntity[]>()
    for (const e of family.entities) {
      const list = m.get(e.parentId) ?? []
      list.push(e)
      m.set(e.parentId, list)
    }
    for (const list of m.values()) list.sort((a, b) => a.name.localeCompare(b.name))
    return m
  }, [family])

  // Open from the top down to the item; for a product, its brand's products too.
  const [open, setOpen] = useState<Set<string>>(() => {
    const byId = new Map(family.entities.map((e) => [e.id, e]))
    const path = new Set<string>()
    for (let e = byId.get(family.focusId); e?.parentId && !path.has(e.parentId); e = byId.get(e.parentId)) path.add(e.parentId)
    if (family.product) path.add(`p:${family.focusId}`)
    return path
  })
  const toggle = (key: string) =>
    setOpen((s) => {
      const n = new Set(s)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })

  // In a family of hundreds, the item asked about is brought into view.
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    box.current?.querySelector('.tx-frow.focus')?.scrollIntoView({ block: 'center' })
  }, [])

  const roots = children.get(null) ?? []
  const render = (list: FamilyEntity[], depth: number) => (
    <ul className="tx-ftree" role={depth ? 'group' : 'tree'}>
      {list.map((e) => {
        const kids = children.get(e.id) ?? []
        const hasAny = kids.length > 0 || e.products > 0
        const expanded = open.has(e.id)
        return (
          <li key={e.id} role="treeitem" aria-expanded={hasAny ? expanded : undefined} aria-selected={e.id === family.focusId}>
            <div className={`tx-frow ${e.id === family.focusId ? 'focus' : ''}`} style={{ ['--depth' as string]: depth }}>
              {hasAny ? (
                <button type="button" className="ix-caret" onClick={() => toggle(e.id)} aria-label={expanded ? `Collapse ${e.name}` : `Expand ${e.name}`}>
                  {expanded ? '▾' : '▸'}
                </button>
              ) : (
                <span className="ix-caret ix-leaf" aria-hidden />
              )}
              <span className="tx-fname">{e.name}</span>
              {e.id === family.rootId ? <span className="tx-chain-level">Parent</span> : null}
              <span className="tx-muted tx-chain-id">#{e.id}</span>
              {kids.length ? <span className="tx-muted tx-fcount">{kids.length} below</span> : null}
            </div>
            {expanded ? (
              <>
                {kids.length ? render(kids, depth + 1) : null}
                {e.products ? (
                  <ProductsOf
                    entity={e}
                    depth={depth + 1}
                    open={open.has(`p:${e.id}`)}
                    onToggle={() => toggle(`p:${e.id}`)}
                    highlight={family.product?.id ?? null}
                  />
                ) : null}
              </>
            ) : null}
          </li>
        )
      })}
    </ul>
  )

  return (
    <div ref={box}>
      {render(roots, 0)}
      {family.cut ? <p className="tx-muted">This family is very large; only part of it is listed.</p> : null}
    </div>
  )
}

function ProductsOf({ entity, depth, open, onToggle, highlight }: { entity: FamilyEntity; depth: number; open: boolean; onToggle: () => void; highlight: string | null }) {
  const [list, setList] = useState<Load<{ id: string; name: string }[]> | null>(null)
  useEffect(() => {
    if (!open || list) return
    let live = true
    void getJson<{ id: string; name: string }[]>(`/taxonomy-comparison/tree?products=${entity.id}${highlight ? `&first=${highlight}` : ''}`).then((l) => live && setList(l))
    return () => {
      live = false
    }
  }, [open, list, entity.id, highlight])

  return (
    <ul className="tx-ftree" role="group">
      <li role="treeitem" aria-expanded={open} aria-selected={false}>
        <div className="tx-frow tx-fproducts" style={{ ['--depth' as string]: depth }}>
          <button type="button" className="ix-caret" onClick={onToggle} aria-label={open ? 'Hide products' : 'Show products'}>
            {open ? '▾' : '▸'}
          </button>
          <span className="tx-fname">
            {entity.products.toLocaleString('en-US')} product{entity.products === 1 ? '' : 's'}
          </span>
        </div>
        {open ? (
          !list || list.loading ? (
            <div className="tx-frow tx-muted" style={{ ['--depth' as string]: depth + 1 }}>
              <span className="ix-caret ix-leaf" aria-hidden />
              Reading…
            </div>
          ) : 'error' in list ? (
            <div className="tx-frow" style={{ ['--depth' as string]: depth + 1 }}>
              <span className="status crit">{list.error}</span>
            </div>
          ) : (
            <ul className="tx-ftree" role="group">
              {list.data.map((p) => (
                <li key={p.id} role="treeitem" aria-selected={p.id === highlight}>
                  <div className={`tx-frow tx-fproduct ${p.id === highlight ? 'focus' : ''}`} style={{ ['--depth' as string]: depth + 1 }}>
                    <span className="ix-caret ix-leaf" aria-hidden />
                    <span className="tx-fname">{p.name}</span>
                    <span className="tx-muted tx-chain-id">#{p.id}</span>
                  </div>
                </li>
              ))}
              {entity.products > list.data.length ? (
                <li className="tx-frow tx-muted" style={{ ['--depth' as string]: depth + 1 }}>
                  <span className="ix-caret ix-leaf" aria-hidden />+{(entity.products - list.data.length).toLocaleString('en-US')} more
                </li>
              ) : null}
            </ul>
          )
        ) : null}
      </li>
    </ul>
  )
}
