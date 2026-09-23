/**
 * Google OpenID Connect: the authorization-code flow with PKCE.
 *
 * Endpoints are hardcoded rather than read from Google's discovery document.
 * They have been stable for years, and a sign-in page that breaks because a
 * discovery fetch timed out is a worse failure than one that breaks if Google
 * ever moves an endpoint — which would be announced well in advance.
 */
import { createHash, randomBytes } from 'node:crypto'
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'
import type { AuthConfig } from './config'

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const JWKS_URI = 'https://www.googleapis.com/oauth2/v3/certs'
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com']

export class OidcError extends Error {}

/** Cached across requests — refetching Google's keys on every sign-in is waste. */
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null
function getJwks() {
  // A bounded timeout so a network that cannot reach Google fails in seconds
  // with a clear message, rather than leaving the browser on a blank tab.
  jwks ??= createRemoteJWKSet(new URL(JWKS_URI), { timeoutDuration: 8000 })
  return jwks
}

function base64url(input: Buffer): string {
  return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export interface PendingAuth {
  state: string
  nonce: string
  codeVerifier: string
  /** Where to send the user once they are signed in. */
  returnTo: string
}

export function createPendingAuth(returnTo: string): PendingAuth {
  return {
    state: base64url(randomBytes(32)),
    nonce: base64url(randomBytes(32)),
    codeVerifier: base64url(randomBytes(64)),
    returnTo,
  }
}

/**
 * Only same-origin paths are accepted as a return destination. Without this
 * check, `/api/auth/signin?returnTo=https://evil.example` would turn the
 * sign-in route into an open redirect.
 */
export function safeReturnTo(raw: string | null | undefined): string {
  if (!raw) return '/'
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/'
  return raw
}

export function authorizationUrl(config: AuthConfig, pending: PendingAuth): string {
  const challenge = base64url(createHash('sha256').update(pending.codeVerifier).digest())
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: `${config.appUrl}/api/auth/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    state: pending.state,
    nonce: pending.nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  })

  // Sent only when explicitly configured. On a Workspace with more than one
  // domain, hinting a single domain makes sign-in fail for everyone on the
  // others — and it buys nothing, because the real check is against the
  // verified email address after Google responds.
  if (config.hostedDomainHint) params.set('hd', config.hostedDomainHint)

  return `${AUTH_ENDPOINT}?${params.toString()}`
}

export interface GoogleIdentity {
  sub: string
  email: string
  emailVerified: boolean
  name: string
  picture?: string
  hostedDomain?: string
}

interface TokenResponse {
  id_token?: string
  error?: string
  error_description?: string
}

/**
 * Exchanges the authorization code and verifies the ID token.
 *
 * The signature is verified against Google's JWKS even though the token came
 * straight from Google's token endpoint over TLS. Belt and braces: it costs a
 * cached key lookup and removes a whole class of mistake if this code is ever
 * refactored to accept a token from somewhere less trustworthy.
 */
export async function exchangeCode(
  config: AuthConfig,
  code: string,
  pending: PendingAuth,
): Promise<GoogleIdentity> {
  let res: Response
  try {
    res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: `${config.appUrl}/api/auth/callback`,
        grant_type: 'authorization_code',
        code_verifier: pending.codeVerifier,
      }),
      cache: 'no-store',
      // Node's fetch waits indefinitely by default. Without this, a blocked
      // egress route shows up as a page that hangs for minutes and then fails
      // with nothing to go on.
      signal: AbortSignal.timeout(10_000),
    })
  } catch (err) {
    throw new OidcError(
      `Could not reach Google's token endpoint (${TOKEN_ENDPOINT}): ${(err as Error).message}. ` +
        'This is the app\'s own outbound connection, not the browser\'s.',
    )
  }

  const body = (await res.json().catch(() => ({}))) as TokenResponse
  if (!res.ok || body.error) {
    throw new OidcError(
      `Token exchange failed: ${body.error ?? res.status}${
        body.error_description ? ` — ${body.error_description}` : ''
      }`,
    )
  }
  if (!body.id_token) throw new OidcError('Google returned no ID token.')

  let payload: JWTPayload
  try {
    const verified = await jwtVerify(body.id_token, getJwks(), {
      issuer: ISSUERS,
      audience: config.clientId,
      maxTokenAge: '10 minutes',
    })
    payload = verified.payload
  } catch (err) {
    throw new OidcError(`ID token failed verification: ${(err as Error).message}`)
  }

  // Binding the nonce is what stops a token minted for another sign-in
  // attempt being replayed into this one.
  if (payload.nonce !== pending.nonce) {
    throw new OidcError('ID token nonce did not match this sign-in attempt.')
  }

  const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : ''
  if (!email) throw new OidcError('Google returned no email address.')

  return {
    sub: String(payload.sub),
    email,
    emailVerified: payload.email_verified === true,
    name: typeof payload.name === 'string' && payload.name ? payload.name : email,
    picture: typeof payload.picture === 'string' ? payload.picture : undefined,
    hostedDomain: typeof payload.hd === 'string' ? payload.hd.toLowerCase() : undefined,
  }
}
