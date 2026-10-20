/**
 * Publishing an artifact straight from Claude (Scott, 20 October 2026).
 *
 *   GET  /api/docs/upload    -> who the token belongs to, and the folders
 *   POST /api/docs/upload    { folder, html | markdown, name?, fileName?, mode? }
 *
 * Authorization: Bearer <upload token>. A person makes their token in Process
 * Documentation ("Publish from Claude"); it acts as them, and only while they
 * may edit documentation - removing that permission stops their tokens too.
 *
 *   folder   "Guides/Release": made if it does not exist yet
 *   name     the document's name; defaults to the page's <title>
 *   mode     "auto" (default): a new version over a document of the same name
 *            in that folder, else a new document. "new": always a new one.
 *            "replace": must replace one of that name, else 404.
 *
 * Exempt from the browser sign-in gate (proxy.ts) because the caller is
 * Claude, not a browser; the token is the check.
 */
import { accessFor } from '@/lib/auth/access'
import { logChange } from '@/lib/portfolio'
import { DocError, addArtifact, allFolders, artifactNamed, ensureFolderPath, replaceArtifact, tokenOwner } from '@/lib/docs'
import { nameFromFile, prepareUpload } from '@/lib/docs-core'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function caller(req: Request): Promise<string | Response> {
  const header = req.headers.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  const email = token ? await tokenOwner(token) : null
  if (!email) return Response.json({ error: 'Send Authorization: Bearer <your upload token>, from Process Documentation > Publish from Claude.' }, { status: 401 })
  const access = await accessFor(email)
  if (!access.canEditDocs) return Response.json({ error: `${email} may not edit documentation. An admin can grant it in Admin.` }, { status: 403 })
  return email
}

const base = () => (process.env.APP_URL?.trim() || '').replace(/\/+$/, '')

export async function GET(req: Request) {
  const who = await caller(req)
  if (who instanceof Response) return who
  return Response.json({ you: who, folders: (await allFolders()).map((f) => f.path) })
}

export async function POST(req: Request) {
  const who = await caller(req)
  if (who instanceof Response) return who

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return Response.json({ error: 'The body must be JSON.' }, { status: 400 })
  }
  const markdown = typeof body.markdown === 'string' ? body.markdown : null
  const html = typeof body.html === 'string' ? body.html : null
  const content = html ?? markdown
  if (!content) return Response.json({ error: 'Send the artifact as "html" (or "markdown").' }, { status: 400 })
  const fileName = typeof body.fileName === 'string' && body.fileName.trim() ? body.fileName.trim() : markdown && !html ? 'artifact.md' : 'artifact.html'
  const mode = body.mode === 'new' || body.mode === 'replace' ? body.mode : 'auto'

  try {
    const folderId = await ensureFolderPath(String(body.folder ?? ''), who)
    const name =
      (typeof body.name === 'string' && body.name.trim()) ||
      prepareUpload({ content, fileName }).name ||
      nameFromFile(fileName)
    const existing = mode === 'new' ? null : await artifactNamed(folderId, name)
    if (mode === 'replace' && !existing) return Response.json({ error: `No document called "${name}" in that folder to replace.` }, { status: 404 })

    const done = existing
      ? await replaceArtifact(existing, { content, fileName }, who)
      : await addArtifact(folderId, { content, fileName, name }, who)
    await logChange({
      actor: who,
      kind: 'change',
      summary: `${existing ? `New version (${done.version}) of` : 'Published'} "${name}" in Process Documentation, from Claude`,
    })
    return Response.json({ id: done.id, version: done.version, replaced: Boolean(existing), url: `${base()}/process-docs/a/${done.id}` })
  } catch (err) {
    if (err instanceof DocError) return Response.json({ error: err.message }, { status: 400 })
    throw err
  }
}
