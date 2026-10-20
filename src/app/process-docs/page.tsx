/**
 * Process Documentation: shared guides published from Claude, in folders,
 * for everyone with access to the site - Commercial included (Scott, 20
 * October 2026). See lib/docs.ts.
 */
import Link from 'next/link'
import { Kicker } from '@/components/ui'
import { currentAccess } from '@/lib/auth/access'
import { folderView, searchDocs } from '@/lib/docs'
import { FolderGrid } from './parts'
import { FolderTools, PublishFromClaude } from './tools'

export const metadata = { title: 'Process Documentation' }
export const dynamic = 'force-dynamic'

export default async function ProcessDocsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = '' } = await searchParams
  const [access, view, hits] = await Promise.all([currentAccess(), folderView(null), q.trim() ? searchDocs(q) : Promise.resolve(null)])

  return (
    <div className="stack">
      <div className="titlerow">
        <div>
          <Kicker>Reference</Kicker>
          <h1>Process Documentation</h1>
        </div>
        {access.canEditDocs ? (
          <div className="pd-head-tools">
            <FolderTools folder={null} />
            <PublishFromClaude />
          </div>
        ) : null}
      </div>

      <form className="filters" action="/process-docs">
        <label className="fpill pd-search">
          <span>
            <span className="lab">Search</span>
            <input className="ffind" type="search" name="q" defaultValue={q} placeholder="Folders, documents and what is in them" aria-label="Search documentation" />
          </span>
        </label>
      </form>

      {hits ? (
        hits.length ? (
          <ul className="pd-hits">
            {hits.map((h) => (
              <li key={`${h.kind}:${h.id}`}>
                <Link href={h.kind === 'folder' ? `/process-docs/f/${h.id}` : `/process-docs/a/${h.id}`} className="pd-hit">
                  <span className={`pd-kind pd-k-${h.kind}`}>{h.kind === 'folder' ? 'Folder' : 'Document'}</span>
                  <b>{h.name}</b>
                  {h.path ? <em>{h.path}</em> : null}
                </Link>
                {h.snippet ? <p className="pd-snip">{h.snippet}</p> : null}
              </li>
            ))}
          </ul>
        ) : (
          <div className="blank">
            <h2>Nothing matches “{q}”</h2>
          </div>
        )
      ) : view && view.folders.length ? (
        <FolderGrid folders={view.folders} />
      ) : (
        <div className="blank">
          <h2>No documentation yet</h2>
        </div>
      )}
    </div>
  )
}
