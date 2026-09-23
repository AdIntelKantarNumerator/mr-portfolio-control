import { NextResponse } from 'next/server'
import { SESSION_COOKIE, getAuthConfig } from '@/lib/auth/config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Clears the session cookie.
 *
 * POST only: a GET sign-out can be triggered by any image tag on any page,
 * which is a silly way to be logged out.
 *
 * It does not revoke the Google session — the next sign-in will show the
 * account chooser rather than silently signing the same person back in, which
 * is what people expect from "sign out" on a shared machine.
 */
export async function POST() {
  const config = getAuthConfig()
  const response = NextResponse.redirect(new URL('/signin?signedout=1', config.appUrl), 303)
  response.cookies.set({
    name: SESSION_COOKIE,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.appUrl.startsWith('https://'),
    path: '/',
    maxAge: 0,
  })
  return response
}
