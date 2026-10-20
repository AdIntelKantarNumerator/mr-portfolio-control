'use server'

/**
 * Editing Process Documentation. Every action checks the person may edit
 * documentation (Admin > Roles & access); reading needs no action at all.
 */
import { revalidatePath } from 'next/cache'
import { currentAccess } from '@/lib/auth/access'
import { logChange } from '@/lib/portfolio'
import {
  DocError,
  addArtifact,
  createFolder,
  createUploadToken,
  removeArtifact,
  removeFolder,
  renameArtifact,
  renameFolder,
  replaceArtifact,
  revokeUploadToken,
  uploadTokensFor,
} from '@/lib/docs'

export interface DocState {
  ok?: boolean
  error?: string
  id?: string
  version?: number
  /** For the parent to go to after a removal. */
  parentId?: string | null
}

async function editor() {
  const a = await currentAccess()
  if (!a.canEditDocs) throw new DocError('Editing documentation needs the editor permission. An admin can grant it.')
  return a.name || a.email || 'Someone'
}

async function run(fn: (by: string) => Promise<DocState>): Promise<DocState> {
  try {
    const out = await fn(await editor())
    revalidatePath('/process-docs', 'layout')
    return out
  } catch (err) {
    if (err instanceof DocError) return { error: err.message }
    return { error: 'That could not be saved. Try again.' }
  }
}

const log = (by: string, summary: string) => logChange({ actor: by, kind: 'change', summary: `Process Documentation: ${summary}` })

export async function newFolder(input: { parentId: string | null; name: string }): Promise<DocState> {
  return run(async (by) => {
    const id = await createFolder(input.parentId, input.name, by)
    await log(by, `new folder "${input.name.trim()}"`)
    return { ok: true, id }
  })
}

export async function renameFolderAction(input: { id: string; name: string }): Promise<DocState> {
  return run(async (by) => {
    await renameFolder(input.id, input.name)
    await log(by, `folder renamed to "${input.name.trim()}"`)
    return { ok: true, id: input.id }
  })
}

export async function removeFolderAction(input: { id: string; name: string }): Promise<DocState> {
  return run(async (by) => {
    const parentId = await removeFolder(input.id)
    await log(by, `removed folder "${input.name}" and everything in it`)
    return { ok: true, parentId }
  })
}

export async function uploadDocument(input: { folderId: string; content: string; fileName: string; name?: string }): Promise<DocState> {
  return run(async (by) => {
    const r = await addArtifact(input.folderId, { content: input.content, fileName: input.fileName, name: input.name }, by)
    await log(by, `uploaded "${input.name || input.fileName}"`)
    return { ok: true, id: r.id, version: r.version }
  })
}

export async function replaceDocument(input: { id: string; content: string; fileName: string }): Promise<DocState> {
  return run(async (by) => {
    const r = await replaceArtifact(input.id, { content: input.content, fileName: input.fileName }, by)
    await log(by, `new version (${r.version}) of a document from "${input.fileName}"`)
    return { ok: true, id: r.id, version: r.version }
  })
}

export async function renameDocument(input: { id: string; name: string }): Promise<DocState> {
  return run(async (by) => {
    await renameArtifact(input.id, input.name, by)
    await log(by, `document renamed to "${input.name.trim()}"`)
    return { ok: true, id: input.id }
  })
}

export async function removeDocument(input: { id: string; name: string }): Promise<DocState> {
  return run(async (by) => {
    const parentId = await removeArtifact(input.id)
    await log(by, `removed "${input.name}"`)
    return { ok: true, parentId }
  })
}

// ------------------------------------------------------- publish from Claude

export interface TokenState {
  error?: string
  token?: string
  tokens?: Array<{ id: string; label: string | null; createdAt: string; lastUsedAt: string | null }>
}

async function tokenList(email: string): Promise<TokenState['tokens']> {
  return (await uploadTokensFor(email)).map((t) => ({ id: t.id, label: t.label, createdAt: t.createdAt.toISOString(), lastUsedAt: t.lastUsedAt?.toISOString() ?? null }))
}

export async function myUploadTokens(): Promise<TokenState> {
  const a = await currentAccess()
  if (!a.canEditDocs || !a.email) return { error: 'Publishing from Claude needs the editor permission, signed in.' }
  return { tokens: await tokenList(a.email) }
}

export async function newUploadToken(label: string): Promise<TokenState> {
  const a = await currentAccess()
  if (!a.canEditDocs || !a.email) return { error: 'Publishing from Claude needs the editor permission, signed in.' }
  const token = await createUploadToken(a.email, label.trim() || 'Claude')
  await logChange({ actor: a.name, kind: 'change', summary: 'Process Documentation: made a token for publishing from Claude' })
  return { token, tokens: await tokenList(a.email) }
}

export async function revokeMyUploadToken(id: string): Promise<TokenState> {
  const a = await currentAccess()
  if (!a.email) return { error: 'Sign in first.' }
  await revokeUploadToken(id, a.email)
  return { tokens: await tokenList(a.email) }
}
