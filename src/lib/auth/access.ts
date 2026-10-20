/**
 * A person's access, read from site_users. The rules are in lib/access-rules.ts.
 *
 * Read on every request by the proxy, so it is cached briefly in memory: a
 * change made in the Admin section reaches a person within half a minute, and
 * the database is asked at most twice a minute per person.
 */
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { siteUsers } from '@/db/schema'
import { EVERYTHING, normalise, type Access } from '@/lib/access-rules'
import { getAuthConfig } from './config'
import { getCurrentUser } from './current-user'

const TTL_MS = 30_000
const cache = new Map<string, { at: number; access: Access }>()

export async function accessFor(email: string): Promise<Access> {
  const key = email.trim().toLowerCase()
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.access
  const [row] = await db.select().from(siteUsers).where(eq(siteUsers.email, key)).limit(1)
  const access = normalise(row)
  cache.set(key, { at: Date.now(), access })
  return access
}

/** Forget a person's cached access after an admin changes it, on this instance. */
export function forgetAccess(email: string) {
  cache.delete(email.trim().toLowerCase())
}

/** The signed-in person's access; everything when sign-in is switched off locally. */
export async function currentAccess(): Promise<Access & { email: string; name: string }> {
  if (!getAuthConfig().enabled) return { ...EVERYTHING, email: '', name: 'Local' }
  const user = await getCurrentUser()
  if (!user.authenticated) return { role: 'commercial', isAdmin: false, canEditDocs: false, email: '', name: '' }
  return { ...(await accessFor(user.email)), email: user.email.toLowerCase(), name: user.name }
}
