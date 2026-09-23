/**
 * Google calls back here with an authorization code.
 *
 * Order matters: state is checked before the code is spent, the ID token is
 * verified before anything is read from it, and the domain is checked before a
 * session is issued. Every failure lands on the sign-in page with a reason
 * rather than a stack trace.
 */
import { NextResponse } from 'next/server'
import { jwtVerify } from 'jose'
import { STATE_COOKIE, domainAllowed, getAuthConfig } from '@/lib/auth/config'
import { exchangeCode, safeReturnTo, type PendingAuth } from '@/lib/auth/oidc'
import { sessionCookieOptions, signSession } from '@/lib/auth/session'
import { linkPerson } from '@/lib/auth/current-user'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/*
 * Redirects are built against the configured APP_URL, never against req.url.
 *
 * Behind a reverse proxy — App Service, any container platform — the request
 * the app sees carries the CONTAINER's hostname and port, not the address the
 * browser used. Redirecting relative to it sends the browser to something like
 * http://74ab73c30ec3:3000/signin, which resolves nowhere. APP_URL is the only
 * thing here that knows the public address.
 */
function fail(
  config: { appUrl: string; debug: boolean },
  reason: string,
  detail?: string,
) {
  const url = new URL('/signin', config.appUrl)
  url.searchParams.set('error', reason)
  // Only with AUTH_DEBUG=true. See the note on AuthConfig.debug.
  if (config.debug && detail) url.searchParams.set('detail', detail.slice(0, 400))
  const response = NextResponse.redirect(url)
  response.cookies.delete(STATE_COOKIE)
  return response
}

export async function GET(req: Request) {
  const config = getAuthConfig()
  if (!config.enabled) return NextResponse.redirect(new URL('/', config.appUrl))

  const params = new URL(req.url).searchParams

  // The user declined, or Google refused. Not an error worth alarming about.
  const googleError = params.get('error')
  if (googleError) {
    return fail(config, googleError === 'access_denied' ? 'cancelled' : 'provider')
  }

  const code = params.get('code')
  const state = params.get('state')
  if (!code || !state) return fail(config, 'missing_code')

  const stateCookie = req.headers
    .get('cookie')
    ?.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${STATE_COOKIE}=`))
    ?.slice(STATE_COOKIE.length + 1)

  if (!stateCookie) return fail(config, 'expired')

  let pending: PendingAuth
  try {
    const { payload } = await jwtVerify(
      decodeURIComponent(stateCookie),
      new TextEncoder().encode(config.secret),
    )
    pending = payload as unknown as PendingAuth
  } catch {
    return fail(config, 'expired')
  }

  // The state comparison is what ties this callback to a sign-in this browser
  // actually started, which is the CSRF defence for the whole flow.
  if (!pending.state || pending.state !== state) return fail(config, 'state_mismatch')

  let identity
  try {
    identity = await exchangeCode(config, code, pending)
  } catch (err) {
    console.error('[auth] code exchange failed', err)
    return fail(config, 'exchange_failed', (err as Error).message)
  }

  if (!identity.emailVerified) return fail(config, 'unverified')

  // Checked against the email domain rather than the `hd` claim alone: `hd` is
  // absent for consumer accounts, and trusting its absence would let any
  // gmail.com address through.
  if (!domainAllowed(identity.email, config.allowedDomains)) {
    /*
     * Log what was actually seen, server-side only.
     *
     * The user is told "that account is outside the organisation" and nothing
     * more — echoing the domain back to an anonymous browser would confirm
     * which domains are valid to anyone probing. But whoever is setting this
     * up needs to tell a typo in the allow-list apart from a genuinely outside
     * account, and without this they are guessing. On Azure it shows up in the
     * App Service log stream.
     *
     * It is also how you discover a Workspace whose accounts sit under an
     * older domain than the one everyone uses for email.
     */
    const seen = identity.email.slice(identity.email.lastIndexOf('@') + 1)
    console.warn(
      `[auth] sign-in refused: domain "${seen}" is not in AUTH_ALLOWED_DOMAINS ` +
        `(currently: ${config.allowedDomains.join(', ')}). ` +
        `Google reported hosted domain: ${identity.hostedDomain ?? 'none'}. ` +
        `If this address belongs to your organisation, add its domain to the list.`,
    )
    return fail(config, 'wrong_domain')
  }

  const session = {
    sub: identity.sub,
    email: identity.email,
    name: identity.name,
    picture: identity.picture,
  }
  const personId = await linkPerson(session)

  const token = await signSession({ ...session, personId }, config)
  const response = NextResponse.redirect(
    new URL(safeReturnTo(pending.returnTo), config.appUrl),
  )
  response.cookies.set({ ...sessionCookieOptions(config), value: token })
  response.cookies.delete(STATE_COOKIE)
  return response
}
