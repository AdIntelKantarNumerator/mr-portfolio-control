'use client'

/**
 * The tree icon and its popup (Scott, 9 November 2026): beside a GPC product,
 * advertiser or entity in any list, a click shows the full rollup to the
 * parent company - product, its brand (the entity on the product), whatever
 * sits between, and the top parent. Read on click from tree/route.ts; nothing
 * is fetched for rows nobody opens.
 *
 * GPC labels no entity as a brand or parent. The labels here are positions:
 * the entity on a product is its brand and the top of the chain is the
 * parent. Every level between is shown, unlabelled (Scott, 9 November 2026:
 * nothing needs to be called a subsidiary).
 */
import { useEffect, useRef, useState } from 'react'
import type { Rollup } from '@/lib/taxonomy-dbx'

type State = { loading: true } | { loading: false; data: Rollup } | { loading: false; error: string }

/** What the first entity in the chain is, for its label: a product's brand, or the advertiser, brand or parent the row is. */
export type RollupRole = 'advertiser' | 'brand' | 'parent' | 'entity'

const ROLE_LABEL: Record<RollupRole, string> = { advertiser: 'Advertiser', brand: 'Brand', parent: 'Parent', entity: 'Entity' }

export function TreeButton({ product, entity, role = 'entity', label }: { product?: string | null; entity?: string | null; role?: RollupRole; label: string }) {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<State | null>(null)
  const box = useRef<HTMLSpanElement>(null)
  const id = product ?? entity
  const valid = Boolean(id && /^\d+$/.test(id) && id !== '0')

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  if (!valid) return null

  const toggle = async () => {
    const next = !open
    setOpen(next)
    if (!next || (state && !('error' in state))) return
    setState({ loading: true })
    try {
      const res = await fetch(`/taxonomy-comparison/tree?${product ? `product=${product}` : `entity=${entity}`}`)
      const body = (await res.json()) as Rollup | { error: string }
      setState('error' in body ? { loading: false, error: body.error } : { loading: false, data: body })
    } catch (err) {
      setState({ loading: false, error: (err as Error).message })
    }
  }

  return (
    <span className="tx-tree-wrap" ref={box}>
      <button type="button" className={`tx-tree ${open ? 'on' : ''}`} onClick={toggle} title={`Rollup tree for ${label}`} aria-label={`Rollup tree for ${label}`} aria-expanded={open}>
        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden>
          <rect x="6" y="1" width="4" height="4" rx="1" />
          <rect x="1" y="11" width="4" height="4" rx="1" />
          <rect x="11" y="11" width="4" height="4" rx="1" />
          <path d="M8 5v3M3 11V8h10v3" fill="none" strokeWidth="1.4" />
        </svg>
      </button>
      {open ? (
        <div className="tx-tree-pop" role="dialog" aria-label={`Rollup tree for ${label}`}>
          {!state || state.loading ? (
            <span className="tx-muted">Reading GPC…</span>
          ) : 'error' in state ? (
            <span className="status crit">{state.error}</span>
          ) : (
            <Chain data={state.data} role={product ? 'brand' : role} />
          )}
        </div>
      ) : null}
    </span>
  )
}

function Chain({ data, role }: { data: Rollup; role: RollupRole }) {
  // Top parent first, as a tree reads, down to the product.
  const links = [...data.chain].reverse()
  const last = links.length - 1
  const labelAt = (i: number) => {
    if (i === last) return links.length === 1 ? `${ROLE_LABEL[role]} · top parent` : ROLE_LABEL[role]
    if (i === 0) return 'Parent'
    return ''
  }
  return (
    <ol className="tx-chain">
      {links.map((l, i) => (
        <li key={l.id} style={{ ['--depth' as string]: i }}>
          <span className="tx-chain-level">{labelAt(i)}</span>
          <span className="tx-chain-name">{l.name}</span>
          <span className="tx-muted tx-chain-id">#{l.id}</span>
        </li>
      ))}
      {data.product ? (
        <li style={{ ['--depth' as string]: links.length }} className="tx-chain-product">
          <span className="tx-chain-level">Product</span>
          <span className="tx-chain-name">{data.product.name}</span>
          <span className="tx-muted tx-chain-id">#{data.product.id}</span>
        </li>
      ) : null}
    </ol>
  )
}
