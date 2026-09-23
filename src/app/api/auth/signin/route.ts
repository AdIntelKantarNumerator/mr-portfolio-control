/**
 * Starts the Google sign-in flow.
 *
 * The PKCE verifier, state and nonce are stashed in a short-lived httpOnly
 * cookie rather than in server memory, so sign-in survives a restart, works
 * across multiple instances behind a load balancer, and needs no shared store.
 */
import { NextResponse } from 'next/server'
import { SignJWT } from 'jose'
import { STATE_COOKIE, getAuthConfig } from '@/lib/auth/config'
import { authorizationUrl, createPendingAuth, safeReturnTo } from '@/lib/auth/oidc'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PENDING_MAX_AGE = 600 // ten minutes to complete a sign-in

export async function GET(req: Request) {
  const config = getAuthConfig()
  if (!config.enabled) {
    return NextResponse.redirect(new URL('/', config.appUrl))
  }

  const returnTo = safeReturnTo(new URL(req.url).searchParams.get('returnTo'))
  const pending = createPendingAuth(returnTo)

  // Signed, so a tampered state cookie cannot smuggle a different verifier or
  // return destination into the callback.
  const stateToken = await new SignJWT({ ...pending })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${PENDING_MAX_AGE}s`)
    .sign(new TextEncoder().encode(config.secret))

  const response = NextResponse.redirect(authorizationUrl(config, pending))
  response.cookies.set({
    name: STATE_COOKIE,
    value: stateToken,
    httpOnly: true,
    sameSite: 'lax',
    secure: config.appUrl.startsWith('https://'),
    path: '/',
    maxAge: PENDING_MAX_AGE,
  })
  return response
}
