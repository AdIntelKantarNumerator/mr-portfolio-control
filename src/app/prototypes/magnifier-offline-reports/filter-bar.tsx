'use client'
/**
 * The filter pills. Each option's value is the address it leads to (built on
 * the server from state.ts), so picking one is just a navigation.
 */
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'

export interface PillSpec {
  label: string
  value: string
  options: Array<{ label: string; href: string }>
}

export function FilterBar({ pills, focus, excel }: { pills: PillSpec[]; focus: { name: string; clear: string } | null; excel: { href: string; label: string } }) {
  const router = useRouter()
  const [busy, start] = useTransition()
  return (
    <div className="mor-bar" aria-busy={busy}>
      {pills.map((p) => (
        <label key={p.label} className="mor-pill">
          <span className="lab">{p.label}</span>
          <select value={p.value} onChange={(e) => start(() => router.push(e.target.value, { scroll: false }))}>
            {p.options.map((o) => (
              <option key={o.href} value={o.href}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      ))}
      {focus ? (
        <div className="mor-pill focus">
          <span className="lab">Focus</span>
          <span className="val">
            {focus.name}
            <Link className="x" href={focus.clear} scroll={false} aria-label="Clear the focus" title="Clear the focus">
              ×
            </Link>
          </span>
        </div>
      ) : null}
      <span className="grow" />
      {busy ? <span className="mor-pill" style={{ border: 0, minWidth: 0, color: 'var(--mor-muted)', fontSize: 13 }}>Loading…</span> : null}
      <a className="mor-btn" href={excel.href} download title={`Download the ${excel.label} workbook (.xlsx), laid out like the Magnifier offline report`}>
        ↓ {excel.label} (.xlsx)
      </a>
    </div>
  )
}
