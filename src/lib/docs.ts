/**
 * Process Documentation, read from and written to the database. The rules for
 * an uploaded file are in ./docs-core.ts; who may do what is checked by the
 * callers (the page's server actions and the upload route).
 */
import { createHash, randomBytes } from 'node:crypto'
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { docArtifacts, docFolders, docUploadTokens, docVersions } from '@/db/schema'
import { MAX_ARTIFACT_BYTES, folderPathParts, prepareUpload, snippet } from './docs-core'

export interface FolderRow {
  id: string
  name: string
  parentId: string | null
  folders: number
  artifacts: number
  updatedAt: Date
}

export interface ArtifactRow {
  id: string
  folderId: string
  name: string
  version: number
  bytes: number
  updatedAt: Date
  updatedBy: string | null
}

export interface Crumb {
  id: string
  name: string
}

export class DocError extends Error {}

const clean = (s: string, what: string) => {
  const v = s.replace(/\s+/g, ' ').trim().slice(0, 200)
  if (!v) throw new DocError(`Give the ${what} a name.`)
  return v
}

// ---------------------------------------------------------------- reading

/** A folder's own row, its path from the top, its subfolders and its artifacts. */
export async function folderView(id: string | null): Promise<{ folder: Crumb | null; path: Crumb[]; folders: FolderRow[]; artifacts: ArtifactRow[] } | null> {
  let folder: Crumb | null = null
  if (id) {
    const [f] = await db.select({ id: docFolders.id, name: docFolders.name }).from(docFolders).where(eq(docFolders.id, id)).limit(1)
    if (!f) return null
    folder = f
  }
  const [path, subs, arts] = await Promise.all([
    id ? folderPath(id) : Promise.resolve([] as Crumb[]),
    db
      .select()
      .from(docFolders)
      .where(id ? eq(docFolders.parentId, id) : isNull(docFolders.parentId))
      .orderBy(asc(docFolders.name)),
    id
      ? db.select().from(docArtifacts).where(eq(docArtifacts.folderId, id)).orderBy(asc(docArtifacts.name))
      : Promise.resolve([] as Array<typeof docArtifacts.$inferSelect>),
  ])

  // Counts for each subfolder, in two grouped queries rather than one per row.
  const ids = subs.map((s) => s.id)
  const [childFolders, childArtifacts, sizes] = await Promise.all([
    ids.length
      ? db.select({ id: docFolders.parentId, n: sql<number>`count(*)::int` }).from(docFolders).where(inArray(docFolders.parentId, ids)).groupBy(docFolders.parentId)
      : [],
    ids.length
      ? db.select({ id: docArtifacts.folderId, n: sql<number>`count(*)::int` }).from(docArtifacts).where(inArray(docArtifacts.folderId, ids)).groupBy(docArtifacts.folderId)
      : [],
    arts.length
      ? db
          .select({ artifactId: docVersions.artifactId, version: docVersions.version, bytes: docVersions.bytes })
          .from(docVersions)
          .where(inArray(docVersions.artifactId, arts.map((a) => a.id)))
      : [],
  ])
  const nf = new Map(childFolders.map((r) => [r.id, r.n]))
  const na = new Map(childArtifacts.map((r) => [r.id, r.n]))
  const size = new Map(sizes.map((r) => [`${r.artifactId}:${r.version}`, r.bytes]))

  return {
    folder,
    path,
    folders: subs.map((s) => ({ id: s.id, name: s.name, parentId: s.parentId, folders: nf.get(s.id) ?? 0, artifacts: na.get(s.id) ?? 0, updatedAt: s.updatedAt })),
    artifacts: arts.map((a) => ({
      id: a.id,
      folderId: a.folderId,
      name: a.name,
      version: a.version,
      bytes: size.get(`${a.id}:${a.version}`) ?? 0,
      updatedAt: a.updatedAt,
      updatedBy: a.updatedBy,
    })),
  }
}

/** From the top down to this folder, inclusive. */
export async function folderPath(id: string): Promise<Crumb[]> {
  const all = await db.select({ id: docFolders.id, name: docFolders.name, parentId: docFolders.parentId }).from(docFolders)
  const byId = new Map(all.map((f) => [f.id, f]))
  const out: Crumb[] = []
  let at = byId.get(id)
  for (let guard = 0; at && guard < 50; guard++) {
    out.unshift({ id: at.id, name: at.name })
    at = at.parentId ? byId.get(at.parentId) : undefined
  }
  return out
}

/** Every folder, as paths, for moving and for the upload route. */
export async function allFolders(): Promise<Array<Crumb & { path: string }>> {
  const all = await db.select({ id: docFolders.id, name: docFolders.name, parentId: docFolders.parentId }).from(docFolders)
  const byId = new Map(all.map((f) => [f.id, f]))
  const pathOf = (id: string): string => {
    const parts: string[] = []
    let at = byId.get(id)
    for (let g = 0; at && g < 50; g++) {
      parts.unshift(at.name)
      at = at.parentId ? byId.get(at.parentId) : undefined
    }
    return parts.join(' / ')
  }
  return all.map((f) => ({ id: f.id, name: f.name, path: pathOf(f.id) })).sort((a, b) => a.path.localeCompare(b.path))
}

export async function artifactView(id: string): Promise<{ artifact: ArtifactRow; path: Crumb[]; versions: Array<{ version: number; uploadedBy: string | null; createdAt: Date; bytes: number }> } | null> {
  const [a] = await db.select().from(docArtifacts).where(eq(docArtifacts.id, id)).limit(1)
  if (!a) return null
  const [path, versions] = await Promise.all([
    folderPath(a.folderId),
    db
      .select({ version: docVersions.version, uploadedBy: docVersions.uploadedBy, createdAt: docVersions.createdAt, bytes: docVersions.bytes })
      .from(docVersions)
      .where(eq(docVersions.artifactId, id))
      .orderBy(desc(docVersions.version)),
  ])
  return {
    artifact: { id: a.id, folderId: a.folderId, name: a.name, version: a.version, bytes: versions[0]?.bytes ?? 0, updatedAt: a.updatedAt, updatedBy: a.updatedBy },
    path,
    versions,
  }
}

/** The page itself: the newest version, or the one asked for. */
export async function artifactHtml(id: string, version?: number): Promise<string | null> {
  const [a] = await db.select({ version: docArtifacts.version }).from(docArtifacts).where(eq(docArtifacts.id, id)).limit(1)
  if (!a) return null
  const [v] = await db
    .select({ html: docVersions.html })
    .from(docVersions)
    .where(and(eq(docVersions.artifactId, id), eq(docVersions.version, version ?? a.version)))
    .limit(1)
  return v?.html ?? null
}

export interface SearchHit {
  kind: 'folder' | 'artifact'
  id: string
  name: string
  path: string
  snippet: string | null
}

/** Folders by name; artifacts by name or by the words on the page. */
export async function searchDocs(q: string): Promise<SearchHit[]> {
  const term = q.trim()
  if (term.length < 2) return []
  const like = `%${term.replace(/[\\%_]/g, (m) => `\\${m}`)}%`
  const [folders, artifacts, paths] = await Promise.all([
    db.select().from(docFolders).where(ilike(docFolders.name, like)).limit(50),
    db
      .select({ id: docArtifacts.id, name: docArtifacts.name, folderId: docArtifacts.folderId, text: docArtifacts.searchText })
      .from(docArtifacts)
      .where(or(ilike(docArtifacts.name, like), ilike(docArtifacts.searchText, like)))
      .limit(100),
    allFolders(),
  ])
  const pathOf = new Map(paths.map((p) => [p.id, p.path]))
  return [
    ...folders.map((f) => ({ kind: 'folder' as const, id: f.id, name: f.name, path: pathOf.get(f.parentId ?? '') ?? '', snippet: null })),
    ...artifacts.map((a) => ({ kind: 'artifact' as const, id: a.id, name: a.name, path: pathOf.get(a.folderId) ?? '', snippet: snippet(a.text ?? '', term) })),
  ]
}

// ---------------------------------------------------------------- writing

export async function createFolder(parentId: string | null, name: string, by: string): Promise<string> {
  if (parentId) {
    const [p] = await db.select({ id: docFolders.id }).from(docFolders).where(eq(docFolders.id, parentId)).limit(1)
    if (!p) throw new DocError('That folder no longer exists.')
  }
  const [row] = await db.insert(docFolders).values({ parentId, name: clean(name, 'folder'), createdBy: by }).returning({ id: docFolders.id })
  return row!.id
}

export async function renameFolder(id: string, name: string): Promise<void> {
  const r = await db.update(docFolders).set({ name: clean(name, 'folder') }).where(eq(docFolders.id, id)).returning({ id: docFolders.id })
  if (!r.length) throw new DocError('That folder no longer exists.')
}

/** Removes the folder, everything under it, and every artifact in them. */
export async function removeFolder(id: string): Promise<string | null> {
  const [f] = await db.select({ parentId: docFolders.parentId }).from(docFolders).where(eq(docFolders.id, id)).limit(1)
  if (!f) throw new DocError('That folder no longer exists.')
  await db.delete(docFolders).where(eq(docFolders.id, id))
  return f.parentId
}

/** A new artifact in a folder, as version 1. */
export async function addArtifact(folderId: string, file: { content: string; fileName?: string | null; name?: string | null }, by: string): Promise<{ id: string; version: number }> {
  const [f] = await db.select({ id: docFolders.id }).from(docFolders).where(eq(docFolders.id, folderId)).limit(1)
  if (!f) throw new DocError('That folder no longer exists.')
  const up = checked(file)
  const [a] = await db
    .insert(docArtifacts)
    .values({ folderId, name: up.name, version: 1, searchText: up.text, createdBy: by, updatedBy: by })
    .returning({ id: docArtifacts.id })
  await db.insert(docVersions).values({ artifactId: a!.id, version: 1, html: up.html, bytes: Buffer.byteLength(up.html), fileName: file.fileName ?? null, uploadedBy: by })
  return { id: a!.id, version: 1 }
}

/** A new version over the top of an artifact; earlier versions are kept. */
export async function replaceArtifact(id: string, file: { content: string; fileName?: string | null }, by: string): Promise<{ id: string; version: number }> {
  const [a] = await db.select().from(docArtifacts).where(eq(docArtifacts.id, id)).limit(1)
  if (!a) throw new DocError('That document no longer exists.')
  const up = checked({ ...file, name: a.name })
  const version = a.version + 1
  await db.insert(docVersions).values({ artifactId: id, version, html: up.html, bytes: Buffer.byteLength(up.html), fileName: file.fileName ?? null, uploadedBy: by })
  await db.update(docArtifacts).set({ version, searchText: up.text, updatedBy: by }).where(eq(docArtifacts.id, id))
  return { id, version }
}

export async function renameArtifact(id: string, name: string, by: string): Promise<void> {
  const r = await db.update(docArtifacts).set({ name: clean(name, 'document'), updatedBy: by }).where(eq(docArtifacts.id, id)).returning({ id: docArtifacts.id })
  if (!r.length) throw new DocError('That document no longer exists.')
}

export async function removeArtifact(id: string): Promise<string> {
  const [a] = await db.select({ folderId: docArtifacts.folderId }).from(docArtifacts).where(eq(docArtifacts.id, id)).limit(1)
  if (!a) throw new DocError('That document no longer exists.')
  await db.delete(docArtifacts).where(eq(docArtifacts.id, id))
  return a.folderId
}

function checked(file: { content: string; fileName?: string | null; name?: string | null }) {
  if (!file.content?.trim()) throw new DocError('That file is empty.')
  if (file.fileName && !/\.(html?|md|markdown)$/i.test(file.fileName)) throw new DocError('Upload an .html or .md file: the artifact as Claude saved it.')
  const up = prepareUpload(file)
  if (Buffer.byteLength(up.html) > MAX_ARTIFACT_BYTES) throw new DocError('That file is over 16MB, the most an artifact can be.')
  return up
}

/** Finds a folder by path ("Guides / Release"), making the missing parts. For the upload route. */
export async function ensureFolderPath(path: string, by: string): Promise<string> {
  const parts = folderPathParts(path)
  if (!parts.length) throw new DocError('Say which folder: "folder": "Guides/Release".')
  let parent: string | null = null
  for (const part of parts) {
    const [found]: Array<{ id: string }> = await db
      .select({ id: docFolders.id })
      .from(docFolders)
      .where(and(parent ? eq(docFolders.parentId, parent) : isNull(docFolders.parentId), ilike(docFolders.name, part.replace(/[\\%_]/g, (m) => `\\${m}`))))
      .limit(1)
    parent = found ? found.id : await createFolder(parent, part, by)
  }
  return parent!
}

/** An artifact in a folder with this name, for the upload route's "replace if it exists". */
export async function artifactNamed(folderId: string, name: string): Promise<string | null> {
  const [a] = await db
    .select({ id: docArtifacts.id })
    .from(docArtifacts)
    .where(and(eq(docArtifacts.folderId, folderId), ilike(docArtifacts.name, name.trim().replace(/[\\%_]/g, (m) => `\\${m}`))))
    .limit(1)
  return a?.id ?? null
}

// ---------------------------------------------------------------- upload tokens

const hash = (token: string) => createHash('sha256').update(token).digest('hex')

/** A new token for publishing from Claude. Returned once; only its hash is kept. */
export async function createUploadToken(email: string, label: string | null): Promise<string> {
  const token = `pcd_${randomBytes(24).toString('base64url')}`
  await db.insert(docUploadTokens).values({ email: email.toLowerCase(), tokenHash: hash(token), label: label?.slice(0, 100) || null })
  return token
}

export async function uploadTokensFor(email: string) {
  return db
    .select({ id: docUploadTokens.id, label: docUploadTokens.label, createdAt: docUploadTokens.createdAt, lastUsedAt: docUploadTokens.lastUsedAt })
    .from(docUploadTokens)
    .where(and(eq(docUploadTokens.email, email.toLowerCase()), isNull(docUploadTokens.revokedAt)))
    .orderBy(desc(docUploadTokens.createdAt))
}

export async function revokeUploadToken(id: string, email: string): Promise<void> {
  await db.update(docUploadTokens).set({ revokedAt: new Date() }).where(and(eq(docUploadTokens.id, id), eq(docUploadTokens.email, email.toLowerCase())))
}

/** The email a live token belongs to, or null. */
export async function tokenOwner(token: string): Promise<string | null> {
  if (!token.startsWith('pcd_')) return null
  const [row] = await db
    .select({ id: docUploadTokens.id, email: docUploadTokens.email })
    .from(docUploadTokens)
    .where(and(eq(docUploadTokens.tokenHash, hash(token)), isNull(docUploadTokens.revokedAt)))
    .limit(1)
  if (!row) return null
  await db.update(docUploadTokens).set({ lastUsedAt: new Date() }).where(eq(docUploadTokens.id, row.id))
  return row.email
}
