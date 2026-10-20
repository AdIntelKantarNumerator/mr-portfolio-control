/**
 * People's access to the site, for the Admin section and the Slack import.
 * The rules are in lib/access-rules.ts; the cache in lib/auth/access.ts.
 */
import { asc, eq, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { siteUsers } from '@/db/schema'
import { forgetAccess } from './auth/access'
import type { Role } from './access-rules'

export interface SiteUser {
  email: string
  name: string | null
  role: Role
  isAdmin: boolean
  canEditDocs: boolean
  title: string | null
  source: string
  updatedBy: string | null
  updatedAt: string
}

export class AccessError extends Error {}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const toUser = (r: typeof siteUsers.$inferSelect): SiteUser => ({
  email: r.email,
  name: r.name,
  role: r.role === 'product' ? 'product' : 'commercial',
  isAdmin: r.isAdmin,
  canEditDocs: r.isAdmin || r.canEditDocs,
  title: r.title,
  source: r.source,
  updatedBy: r.updatedBy,
  updatedAt: r.updatedAt.toISOString(),
})

export async function listSiteUsers(): Promise<SiteUser[]> {
  return (await db.select().from(siteUsers).orderBy(asc(siteUsers.name), asc(siteUsers.email))).map(toUser)
}

async function adminCount(): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(siteUsers).where(eq(siteUsers.isAdmin, true))
  return r?.n ?? 0
}

/** One person's role or permissions, changed by an admin. Never leaves the site without an admin. */
export async function updateSiteUser(
  email: string,
  patch: { role?: Role; isAdmin?: boolean; canEditDocs?: boolean; name?: string },
  by: string,
): Promise<SiteUser> {
  const key = email.trim().toLowerCase()
  const [row] = await db.select().from(siteUsers).where(eq(siteUsers.email, key)).limit(1)
  if (!row) throw new AccessError('That person is not on the list. Add them first.')
  if (patch.isAdmin === false && row.isAdmin && (await adminCount()) <= 1) throw new AccessError('There has to be at least one admin.')
  const set: Partial<typeof siteUsers.$inferInsert> = { updatedBy: by, source: 'admin' }
  if (patch.role) set.role = patch.role
  if (patch.isAdmin !== undefined) set.isAdmin = patch.isAdmin
  if (patch.canEditDocs !== undefined) set.canEditDocs = patch.canEditDocs
  if (patch.name !== undefined) set.name = patch.name.trim().slice(0, 200) || null
  const [out] = await db.update(siteUsers).set(set).where(eq(siteUsers.email, key)).returning()
  forgetAccess(key)
  return toUser(out!)
}

export async function addSiteUser(input: { email: string; name?: string; role: Role; isAdmin?: boolean; canEditDocs?: boolean }, by: string): Promise<SiteUser> {
  const email = input.email.trim().toLowerCase()
  if (!EMAIL.test(email)) throw new AccessError('That is not an email address.')
  const [exists] = await db.select({ email: siteUsers.email }).from(siteUsers).where(eq(siteUsers.email, email)).limit(1)
  if (exists) throw new AccessError(`${email} is already on the list.`)
  const [out] = await db
    .insert(siteUsers)
    .values({
      email,
      name: input.name?.trim().slice(0, 200) || null,
      role: input.role,
      isAdmin: Boolean(input.isAdmin),
      canEditDocs: Boolean(input.canEditDocs),
      source: 'admin',
      updatedBy: by,
    })
    .returning()
  forgetAccess(email)
  return toUser(out!)
}

export interface ImportRow {
  email: string
  name?: string | null
  title?: string | null
  role: Role
  isAdmin?: boolean
  canEditDocs?: boolean
  /** slack: placed by title; review: found in Slack, role not clear, left Commercial. */
  source: 'slack' | 'review'
}

/**
 * The Slack pass, loaded in bulk. A person an admin has already set is left
 * exactly as they are: an import never undoes a decision a person made.
 */
export async function importSiteUsers(rows: ImportRow[], by: string): Promise<{ added: number; updated: number; kept: number }> {
  const existing = new Map((await db.select().from(siteUsers)).map((r) => [r.email, r]))
  let added = 0
  let updated = 0
  let kept = 0
  for (const r of rows) {
    const email = r.email.trim().toLowerCase()
    if (!EMAIL.test(email)) continue
    const was = existing.get(email)
    const values = {
      name: r.name?.trim() || null,
      title: r.title?.trim() || null,
      role: r.role,
      isAdmin: Boolean(r.isAdmin),
      canEditDocs: Boolean(r.canEditDocs || r.isAdmin),
      source: r.source,
      updatedBy: by,
    }
    if (!was) {
      await db.insert(siteUsers).values({ email, ...values })
      added++
    } else if (was.source === 'slack' || was.source === 'review') {
      await db.update(siteUsers).set(values).where(eq(siteUsers.email, email))
      updated++
    } else {
      // Set by an admin or seeded: keep their decision, fill in the title only.
      if (!was.title && values.title) await db.update(siteUsers).set({ title: values.title }).where(eq(siteUsers.email, email))
      kept++
    }
    forgetAccess(email)
  }
  return { added, updated, kept }
}
