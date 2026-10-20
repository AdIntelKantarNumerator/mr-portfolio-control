'use client'

/** Everyone's role and permissions, changed in place. Each change saves at once. */
import { useMemo, useState } from 'react'
import { Modal } from '@/components/items/parts'
import { ROLE_LABEL } from '@/lib/access-rules'
import type { SiteUser } from '@/lib/site-users'
import { addPerson, changeAccess } from './actions'

type Filter = 'all' | 'product' | 'commercial' | 'admins' | 'editors' | 'review'

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'all', label: 'Everyone' },
  { key: 'product', label: 'Product Focused' },
  { key: 'commercial', label: 'Commercial' },
  { key: 'admins', label: 'Admins' },
  { key: 'editors', label: 'Doc editors' },
  { key: 'review', label: 'To review' },
]

const SOURCE: Record<string, string> = { slack: 'Slack', review: 'To review', seed: 'Seed', admin: 'Set by admin' }

export function PeopleTable({ people: initial, me }: { people: SiteUser[]; me: string }) {
  const [people, setPeople] = useState(initial)
  const [find, setFind] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const counts = useMemo(
    () => ({
      product: people.filter((p) => p.role === 'product').length,
      commercial: people.filter((p) => p.role === 'commercial').length,
      admins: people.filter((p) => p.isAdmin).length,
      review: people.filter((p) => p.source === 'review').length,
    }),
    [people],
  )

  const q = find.trim().toLowerCase()
  const shown = people.filter((p) => {
    if (q && !`${p.name ?? ''} ${p.email} ${p.title ?? ''}`.toLowerCase().includes(q)) return false
    if (filter === 'product') return p.role === 'product'
    if (filter === 'commercial') return p.role === 'commercial'
    if (filter === 'admins') return p.isAdmin
    if (filter === 'editors') return p.canEditDocs
    if (filter === 'review') return p.source === 'review'
    return true
  })

  async function change(p: SiteUser, patch: { role?: string; isAdmin?: boolean; canEditDocs?: boolean }) {
    setBusy(p.email)
    setError(null)
    const r = await changeAccess({ email: p.email, ...patch })
    setBusy(null)
    if (r.error || !r.user) return setError(`${p.name ?? p.email}: ${r.error ?? 'not saved'}`)
    setPeople((all) => all.map((x) => (x.email === p.email ? r.user! : x)))
  }

  return (
    <>
      <div className="ad-stats">
        <button type="button" className="ad-stat" style={{ borderTopColor: 'var(--c1)' }} onClick={() => setFilter('product')}>
          <b style={{ color: 'var(--c1)' }}>{counts.product}</b>
          <span>Product Focused</span>
        </button>
        <button type="button" className="ad-stat" style={{ borderTopColor: 'var(--accent)' }} onClick={() => setFilter('commercial')}>
          <b style={{ color: 'var(--accent)' }}>{counts.commercial}</b>
          <span>Commercial</span>
        </button>
        <button type="button" className="ad-stat" style={{ borderTopColor: 'var(--c4)' }} onClick={() => setFilter('admins')}>
          <b style={{ color: 'var(--c4)' }}>{counts.admins}</b>
          <span>Admins</span>
        </button>
        <button type="button" className="ad-stat" style={{ borderTopColor: 'var(--warn)' }} onClick={() => setFilter('review')}>
          <b style={{ color: 'var(--warn)' }}>{counts.review}</b>
          <span>To review</span>
        </button>
      </div>

      <div className="filters">
        <label className="fpill">
          <span>
            <span className="lab">Find</span>
            <input className="ffind" type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Name, email or title" aria-label="Find a person" />
          </span>
        </label>
        <label className={`fpill${filter !== 'all' ? ' active' : ''}`}>
          <span>
            <span className="lab">Showing</span>
            <select className="fsel" value={filter} onChange={(e) => setFilter(e.target.value as Filter)} aria-label="Which people to show">
              {FILTERS.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>
          </span>
        </label>
        <button type="button" className="btn btn-primary ad-add" onClick={() => setAdding(true)}>
          Add person
        </button>
      </div>

      {error ? (
        <p className="mr-said mr-bad" role="alert">
          {error}
        </p>
      ) : null}

      <div className="ad-table">
        <table className="dtable">
          <thead>
            <tr>
              <th>Person</th>
              <th>Role</th>
              <th title="Sees the Admin section and can change anyone's access">Admin</th>
              <th title="Can create folders and upload, rename, replace and remove in Process Documentation">Edits docs</th>
              <th>From</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => (
              <tr key={p.email} className={busy === p.email ? 'ad-busy' : undefined}>
                <td>
                  <b>{p.name ?? p.email}</b>
                  {p.email === me ? <span className="ad-you">you</span> : null}
                  <div className="ad-sub">
                    {p.email}
                    {p.title ? ` · ${p.title}` : ''}
                  </div>
                </td>
                <td>
                  <select
                    id={`role-${p.email}`}
                    className={`ad-role ad-${p.role}`}
                    value={p.role}
                    disabled={busy === p.email}
                    onChange={(e) => change(p, { role: e.target.value })}
                    aria-label={`Role for ${p.name ?? p.email}`}
                  >
                    <option value="product">{ROLE_LABEL.product}</option>
                    <option value="commercial">{ROLE_LABEL.commercial}</option>
                  </select>
                </td>
                <td className="ad-check">
                  <input
                    id={`admin-${p.email}`}
                    type="checkbox"
                    checked={p.isAdmin}
                    disabled={busy === p.email}
                    onChange={(e) => change(p, { isAdmin: e.target.checked })}
                    aria-label={`Admin: ${p.name ?? p.email}`}
                  />
                </td>
                <td className="ad-check">
                  <input
                    id={`docs-${p.email}`}
                    type="checkbox"
                    checked={p.canEditDocs}
                    // Admins always may: the box shows it, and cannot take it away.
                    disabled={busy === p.email || p.isAdmin}
                    onChange={(e) => change(p, { canEditDocs: e.target.checked })}
                    aria-label={`Edits documentation: ${p.name ?? p.email}`}
                  />
                </td>
                <td>
                  <span className={`ad-src ad-src-${p.source}`}>{SOURCE[p.source] ?? p.source}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!shown.length ? <p className="tile-empty">Nobody matches.</p> : null}
      </div>
      <p className="ad-foot">Anyone not on this list sees Commercial until an admin adds them.</p>

      {adding ? (
        <AddPerson
          onClose={() => setAdding(false)}
          onAdded={(u) => {
            setPeople((all) => [...all, u].sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email)))
            setAdding(false)
          }}
        />
      ) : null}
    </>
  )
}

function AddPerson({ onClose, onAdded }: { onClose: () => void; onAdded: (u: SiteUser) => void }) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState('product')
  const [isAdmin, setIsAdmin] = useState(false)
  const [canEditDocs, setCanEditDocs] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <Modal title="Add person" onClose={onClose}>
      <form
        className="pd-form"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          const r = await addPerson({ email, name, role, isAdmin, canEditDocs })
          setBusy(false)
          if (r.error || !r.user) return setError(r.error ?? 'Not saved.')
          onAdded(r.user)
        }}
      >
        <input id="add-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@mediaradar.com" aria-label="Email" autoFocus />
        <input id="add-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" aria-label="Name" />
        <select id="add-role" value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role">
          <option value="product">{ROLE_LABEL.product}</option>
          <option value="commercial">{ROLE_LABEL.commercial}</option>
        </select>
        <label className="ad-tick">
          <input id="add-admin" type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} /> Admin
        </label>
        <label className="ad-tick">
          <input id="add-docs" type="checkbox" checked={canEditDocs || isAdmin} disabled={isAdmin} onChange={(e) => setCanEditDocs(e.target.checked)} /> Edits documentation
        </label>
        <div className="pd-actions">
          {error ? <span className="mr-said mr-bad">{error}</span> : null}
          <button type="submit" className="btn btn-primary" disabled={busy || !email.trim()}>
            {busy ? 'Adding…' : 'Add'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
