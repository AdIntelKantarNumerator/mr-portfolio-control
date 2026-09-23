/**
 * Route protection.
 *
 * In Next.js 16 this file is `proxy.ts` — the `middleware.ts` convention is
 * deprecated and renamed, though the behaviour is identical.
 *
 * This is a gate, not the authorization model: it checks that a valid session
 * cookie exists and redirects to sign-in when it does not. Server Components
 * and Server Actions still call `getCurrentUser()` themselves, because a proxy
 * can be bypassed in some deployment topologies and defence in one layer only
 * is not defence.
 *
 * Machine endpoints are exempt on purpose. Each carries its own, stronger
 * authentication, and a browser session would be the wrong check for them:
 *
 *   /api/webhooks/linear   HMAC signature over the raw body
 *   /api/slack/*           Slack's v0 request signature
 *   /api/sync/*, /api/digest   SYNC_TOKEN bearer
 */
import { NextResponse, type NextRequest } from 'next/server'
import { jwtVerify } from 'jose'
import { SESSION_COOKIE } from '@/lib/auth/config'

/*
 * Exempt from the BROWSER session gate — not from authentication.
 *
 * Every path here authenticates its own caller by a means appropriate to that
 * caller, because none of them is a person with a Google session:
 *
 *   /signin, /api/auth/*   the sign-in flow itself; it cannot require a session
 *   /api/webhooks/linear   HMAC signature over the raw body, plus a replay window
 *   /api/slack/*           Slack v0 request signature, plus a replay window
 *   /api/sync/*            SYNC_TOKEN bearer; refuses in production if unset
 *   /api/digest            SYNC_TOKEN bearer; refuses in production if unset
 *   /api/health            the one genuinely open endpoint — returns {ok:true}
 *                          and nothing else, so a load balancer can probe it
 */
const PUBLIC_PREFIXES = [
  '/signin',
  '/api/auth/',
  '/api/webhooks/',
  '/api/slack/',
  '/api/sync/',
  '/api/digest',
  '/api/health',
]

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p))
}

export async function proxy(req: NextRequest) {
  const secret = process.env.AUTH_SECRET?.trim()
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim()
  const production = process.env.NODE_ENV === 'production'

  // Refuse to serve an unauthenticated app in production. Enforced here, at
  // request time, rather than at import time — `next build` prerenders without
  // runtime secrets and must not fail because of their absence.
  if (production && (!clientId || !secret) && process.env.AUTH_ALLOW_ANONYMOUS !== 'true') {
    return new NextResponse(
      'This deployment has no authentication configured. Set GOOGLE_CLIENT_ID, ' +
        'GOOGLE_CLIENT_SECRET, AUTH_SECRET and AUTH_ALLOWED_DOMAINS, or set ' +
        'AUTH_ALLOW_ANONYMOUS=true if something in front of this app already ' +
        'authenticates users.',
      { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } },
    )
  }

  // Auth deliberately off for local development.
  if (!clientId || !secret) return NextResponse.next()

  const { pathname, search } = req.nextUrl
  if (isPublic(pathname)) return NextResponse.next()

  const token = req.cookies.get(SESSION_COOKIE)?.value
  if (token) {
    try {
      await jwtVerify(token, new TextEncoder().encode(secret), {
        issuer: 'mr-portfolio-control',
      })
      return NextResponse.next()
    } catch {
      // Expired or tampered — fall through to the redirect.
    }
  }

  // Built against APP_URL when it is set, for the same reason as the auth
  // routes: behind a reverse proxy, req.url carries the container's internal
  // hostname and port, and a browser sent there resolves nothing.
  const base = process.env.APP_URL?.trim() || req.url
  const signin = new URL('/signin', base)
  signin.searchParams.set('returnTo', `${pathname}${search}`)
  return NextResponse.redirect(signin)
}

export const config = {
  // Everything except Next's own assets and the favicon. Without the negative
  // match the gate would also block the CSS and JS of the sign-in page itself.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|brand/).*)'],
}
