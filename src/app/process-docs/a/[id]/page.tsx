/**
 * One document, shown as it looks on Claude: the uploaded page in a frame,
 * served sandboxed from /docs-raw (see that route for why).
 */
import { notFound } from 'next/navigation'
import { currentAccess } from '@/lib/auth/access'
import { artifactView } from '@/lib/docs'
import { Crumbs, day } from '../../parts'
import { DocTools } from '../../tools'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const v = await artifactView(id)
  return { title: v?.artifact.name ?? 'Process Documentation' }
}

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [access, view] = await Promise.all([currentAccess(), artifactView(id)])
  if (!view) notFound()
  const { artifact } = view
  const src = `/docs-raw/${artifact.id}?v=${artifact.version}`

  return (
    <div className="stack pd-viewer">
      <div className="titlerow">
        <div>
          <Crumbs path={view.path} current={artifact.name} />
          <h1>{artifact.name}</h1>
          <div className="pd-meta">
            {artifact.version > 1 ? `Version ${artifact.version} · ` : ''}
            {day(artifact.updatedAt)}
            {artifact.updatedBy ? ` · ${artifact.updatedBy}` : ''}
            {' · '}
            <a href={src} target="_blank" rel="noreferrer">
              Open in a new tab
            </a>
          </div>
        </div>
        {access.canEditDocs ? <DocTools doc={{ id: artifact.id, name: artifact.name, folderId: artifact.folderId }} /> : null}
      </div>
      <iframe
        key={src}
        className="pd-frame"
        src={src}
        title={artifact.name}
        // No sandbox attribute here: /docs-raw sends the sandbox as a
        // Content-Security-Policy, which the browser enforces wherever the
        // page loads, framed or not. Both at once left the frame blank in
        // Chromium-based browsers (tested 20 October 2026).
      />
    </div>
  )
}
