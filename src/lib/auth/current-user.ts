/**
 * Who is making this request.
 *
 * Server Components and Server Actions call `getCurrentUser()`; nothing else
 * should read the session cookie directly.
 */
import { cache } from 'react'
import { cookies } from 'next/headers'
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { people } from '@/db/schema'
import { SESSION_COOKIE, getAuthConfig } from './config'
import { readSession, type Session } from './session'

export interface CurrentUser {
  email: string
  name: string
  picture?: string
  /** `people.id`, when this person has a row. Used to attribute edits. */
  personId?: string
  /** False when auth is switched off for local development. */
  authenticated: boolean
}

/**
 * The signed-in user, or an anonymous stand-in when auth is disabled.
 *
 * Cached per request: a page that renders six components that each want the
 * current user should verify the cookie once.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser> => {
  const config = getAuthConfig()
  if (!config.enabled) {
    return { email: '', name: 'Anonymous', authenticated: false }
  }

  const jar = await cookies()
  const session = await readSession(jar.get(SESSION_COOKIE)?.value, config)
  if (!session) return { email: '', name: 'Anonymous', authenticated: false }

  return {
    email: session.email,
    name: session.name,
    picture: session.picture,
    personId: session.personId,
    authenticated: true,
  }
})

/**
 * The name to record against an edit.
 *
 * Falls back to "manual" when auth is off, so a local evaluation copy still
 * writes a sensible changelog rather than empty strings.
 */
export async function actorName(): Promise<string> {
  const user = await getCurrentUser()
  return user.authenticated ? user.name : 'manual'
}

export async function actorPersonId(): Promise<string | null> {
  const user = await getCurrentUser()
  return user.personId ?? null
}

/**
 * Links a Google identity to a row in `people`, so an edit made by someone who
 * also leads projects in Linear is attributed to the same person rather than a
 * duplicate.
 *
 * Matching is by email, which is the only identifier the two systems share.
 * Someone who signs in but leads nothing gets a row created for them — they
 * are a real participant in the portfolio even if Linear has never heard of
 * them.
 */
export async function linkPerson(session: Session): Promise<string | undefined> {
  if (!session.email) return undefined
  try {
    const [existing] = await db
      .select({ id: people.id })
      .from(people)
      .where(eq(people.email, session.email))
      .limit(1)
    if (existing) return existing.id

    const [created] = await db
      .insert(people)
      .values({ name: session.name, email: session.email, active: true })
      .returning({ id: people.id })
    return created?.id
  } catch (err) {
    // Attribution is a nice-to-have; never let it block a sign-in.
    console.error('[auth] could not link person record', err)
    return undefined
  }
}
