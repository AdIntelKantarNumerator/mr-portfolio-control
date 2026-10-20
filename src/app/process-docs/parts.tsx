/** Shared pieces of the Process Documentation pages. */
import Link from 'next/link'
import type { ArtifactRow, Crumb, FolderRow } from '@/lib/docs'

const day = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })

export function FolderGrid({ folders }: { folders: FolderRow[] }) {
  return (
    <div className="pd-grid">
      {folders.map((f) => (
        <Link key={f.id} href={`/process-docs/f/${f.id}`} className="pd-folder">
          <span className="pd-folder-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="26" height="26">
              <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.6l2 2.2h8.4A1.5 1.5 0 0 1 21 8.7v9.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z" fill="currentColor" />
            </svg>
          </span>
          <b>{f.name}</b>
          <em>
            {[f.folders ? `${f.folders} folder${f.folders === 1 ? '' : 's'}` : null, `${f.artifacts} document${f.artifacts === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
          </em>
        </Link>
      ))}
    </div>
  )
}

export function DocList({ docs }: { docs: ArtifactRow[] }) {
  return (
    <ul className="pd-docs">
      {docs.map((d) => (
        <li key={d.id}>
          <Link href={`/process-docs/a/${d.id}`} className="pd-doc">
            <b>{d.name}</b>
            <em>
              {d.version > 1 ? `v${d.version} · ` : ''}
              {day(d.updatedAt)}
              {d.updatedBy ? ` · ${d.updatedBy}` : ''}
            </em>
          </Link>
        </li>
      ))}
    </ul>
  )
}

export function Crumbs({ path, current }: { path: Crumb[]; current?: string }) {
  const trail = current ? path : path.slice(0, -1)
  return (
    <nav className="pd-crumbs" aria-label="Folders">
      <Link href="/process-docs">Process Documentation</Link>
      {trail.map((c) => (
        <span key={c.id}>
          <span aria-hidden="true">›</span>
          <Link href={`/process-docs/f/${c.id}`}>{c.name}</Link>
        </span>
      ))}
    </nav>
  )
}

export { day }
