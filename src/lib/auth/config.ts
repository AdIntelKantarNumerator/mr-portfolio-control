/**
 * Authentication configuration.
 *
 * Google sign-in is implemented directly against Google's OpenID Connect
 * endpoints rather than through an auth library. The reasoning, since it is
 * the kind of choice that deserves justifying:
 *
 *   - The requirement is one provider, one allowed domain, no roles, no
 *     account linking, no credentials. That is most of what an auth library
 *     exists to handle, and none of it is needed here.
 *   - Auth.js v5 is still beta and its published peer dependencies do not yet
 *     include Next.js 16, so installing it needs --legacy-peer-deps. That is a
 *     poor foundation for a tool another team has to maintain.
 *   - What remains is the standard authorization-code flow with PKCE, which is
 *     roughly 150 readable lines. The genuinely dangerous parts of auth —
 *     storing passwords, resetting them, linking identities — do not exist
 *     here, because Google is the identity provider.
 *
 * The security-critical pieces are all present and tested: PKCE, a signed
 * state parameter, a nonce bound to the ID token, ID token signature
 * verification against Google's JWKS, issuer and audience checks, the hosted
 * domain check, and a signed httpOnly session cookie.
 */

export interface AuthConfig {
  enabled: boolean
  /**
   * Set when the configuration is unusable. Reported at request time, never
   * thrown: `next build` prerenders pages without runtime secrets, and a build
   * that fails because production credentials are absent from a CI runner is a
   * build that fails for the wrong reason.
   */
  configError: string | null
  clientId: string
  clientSecret: string
  /** Workspace domains allowed to sign in, lowercase. */
  allowedDomains: string[]
  /**
   * Optional `hd` hint sent to Google's account chooser. Only safe to set on a
   * single-domain Workspace — see getAuthConfig for why.
   */
  hostedDomainHint: string | null
  /** Absolute base URL, used to build the redirect URI Google calls back on. */
  appUrl: string
  /** Secret for signing the session and state cookies. */
  secret: string
  /** Session lifetime in seconds. */
  maxAge: number
  /**
   * When AUTH_DEBUG=true, a failed sign-in shows the underlying reason on the
   * sign-in page instead of only in the server log.
   *
   * Off by default and meant to be switched off again: the sign-in page is
   * reachable without credentials, so the detail is visible to anyone who can
   * reach the app. It exists because a platform whose log stream is not
   * working leaves you with no way at all to tell a wrong client secret from a
   * blocked network route — and guessing at that costs more than a few minutes
   * of a slightly chattier error page.
   */
  debug: boolean
}

const DEFAULT_MAX_AGE = 60 * 60 * 24 * 7 // one week

function parseDomains(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean)
}

/**
 * Reads the configuration. Never throws.
 *
 * With no GOOGLE_CLIENT_ID set, auth is OFF — `npm run dev` stays zero-config
 * for someone evaluating the tool. In production that combination is refused
 * at request time (see src/proxy.ts) rather than quietly serving an
 * unauthenticated app, which is the failure mode that matters.
 */
export function getAuthConfig(): AuthConfig {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim() ?? ''
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() ?? ''
  const secret = process.env.AUTH_SECRET?.trim() ?? ''
  const appUrl = (process.env.APP_URL?.trim() || 'http://localhost:3000').replace(/\/$/, '')
  const allowedDomains = parseDomains(process.env.AUTH_ALLOWED_DOMAINS)
  const production = process.env.NODE_ENV === 'production'
  const debug = process.env.AUTH_DEBUG?.trim() === 'true'

  /*
   * The `hd` hint pre-filters Google's account chooser to one domain. It is
   * NOT a security control — the domain is checked against the verified email
   * on the way back — and on a multi-domain Workspace it actively hurts:
   * someone whose Google account sits under a different domain of the same
   * organisation gets "couldn't find your Google Account" instead of a
   * working sign-in.
   *
   * Workspaces that have been renamed commonly have exactly this shape: the
   * account's primary domain is the original company name and everyone's email
   * is on a secondary domain added later. So this is opt-in, never inferred
   * from the allow-list.
   */
  const hostedDomainHint = process.env.AUTH_GOOGLE_HD?.trim() || null

  const off = (configError: string | null): AuthConfig => ({
    enabled: false,
    configError,
    clientId: '',
    clientSecret: '',
    allowedDomains,
    hostedDomainHint,
    appUrl,
    secret,
    maxAge: DEFAULT_MAX_AGE,
    debug,
  })

  if (!clientId) {
    if (production && process.env.AUTH_ALLOW_ANONYMOUS !== 'true') {
      return off(
        'GOOGLE_CLIENT_ID is not set. Refusing to serve an unauthenticated app in production. ' +
          'Set the Google credentials, or set AUTH_ALLOW_ANONYMOUS=true if this deployment is ' +
          'genuinely behind something else that authenticates users.',
      )
    }
    return off(null)
  }

  // Everything below is a real misconfiguration: someone meant to switch auth
  // on and left a piece out. Failing loudly beats failing open.
  if (!clientSecret) return off('GOOGLE_CLIENT_SECRET is not set.')
  if (!secret || secret.length < 32) {
    return off(
      'AUTH_SECRET must be set to at least 32 characters. Generate one with: openssl rand -hex 32',
    )
  }
  if (allowedDomains.length === 0) {
    return off(
      'AUTH_ALLOWED_DOMAINS is not set. Without it any Google account on the internet could ' +
        'sign in. Set it to your Workspace domain, e.g. AUTH_ALLOWED_DOMAINS=mediaradar.com',
    )
  }

  return {
    enabled: true,
    configError: null,
    clientId,
    clientSecret,
    allowedDomains,
    hostedDomainHint,
    appUrl,
    secret,
    maxAge: Number(process.env.AUTH_SESSION_MAX_AGE ?? DEFAULT_MAX_AGE),
    debug,
  }
}

/** Is this email inside an allowed Workspace domain? */
export function domainAllowed(email: string, allowedDomains: string[]): boolean {
  const at = email.lastIndexOf('@')
  if (at < 0) return false
  const domain = email.slice(at + 1).toLowerCase()
  return allowedDomains.includes(domain)
}

export const SESSION_COOKIE = 'pcr_session'
export const STATE_COOKIE = 'pcr_oauth'
export const CALLBACK_PATH = '/api/auth/callback'
