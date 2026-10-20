/** One folder of Process Documentation: its subfolders and its documents. */
import { notFound } from 'next/navigation'
import { currentAccess } from '@/lib/auth/access'
import { folderView } from '@/lib/docs'
import { Crumbs, DocList, FolderGrid } from '../../parts'
import { FolderTools } from '../../tools'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const v = await folderView(id)
  return { title: v?.folder?.name ?? 'Process Documentation' }
}

export default async function FolderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [access, view] = await Promise.all([currentAccess(), folderView(id)])
  if (!view?.folder) notFound()

  const empty = !view.folders.length && !view.artifacts.length
  return (
    <div className="stack">
      <div className="titlerow">
        <div>
          <Crumbs path={view.path} />
          <h1>{view.folder.name}</h1>
        </div>
        {access.canEditDocs ? <FolderTools folder={view.folder} /> : null}
      </div>

      {view.folders.length ? <FolderGrid folders={view.folders} /> : null}
      {view.artifacts.length ? <DocList docs={view.artifacts} /> : null}
      {empty ? (
        <div className="blank">
          <h2>This folder is empty</h2>
        </div>
      ) : null}
    </div>
  )
}
