/**
 * Session cookie: a signed JWT, httpOnly, no server-side session store.
 *
 * The session holds only what the UI needs — name, email, and the local person
 * id used for attribution. It is signed, not encrypted: nothing in it is
 * secret, and a signed token that anyone can inspect is easier to debug than
 * an opaque one. Tampering is what matters, and the signature covers that.
 *
 * No database session table, because with one identity provider and no
 * revocation requirement it would add a query to every request and buy
 * nothing. If you later need "sign this person out everywhere immediately",
 * that is when a session store earns its place.
 */
import { SignJWT, jwtVerify } from 'jose'
import { SESSION_COOKIE, type AuthConfig } from './config'

export interface Session {
  /** Google's stable subject id. */
  sub: string
  email: string
  name: string
  picture?: string
  /** Row id in `people`, so edits can be attributed. */
  personId?: string
}

const ISSUER = 'mr-portfolio-control'

function key(secret: string): Uint8Array {
  return new TextEncoder().encode(secret)
}

export async function signSession(
  session: Session,
  config: AuthConfig,
  now = Math.floor(Date.now() / 1000),
): Promise<string> {
  return new SignJWT({
    email: session.email,
    name: session.name,
    picture: session.picture,
    personId: session.personId,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(session.sub)
    .setIssuer(ISSUER)
    .setIssuedAt(now)
    .setExpirationTime(now + config.maxAge)
    .sign(key(config.secret))
}

/** Returns null for anything invalid — expired, tampered, or wrong issuer. */
export async function readSession(
  token: string | undefined,
  config: AuthConfig,
): Promise<Session | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, key(config.secret), { issuer: ISSUER })
    if (!payload.sub || typeof payload.email !== 'string') return null
    return {
      sub: payload.sub,
      email: payload.email,
      name: typeof payload.name === 'string' ? payload.name : payload.email,
      picture: typeof payload.picture === 'string' ? payload.picture : undefined,
      personId: typeof payload.personId === 'string' ? payload.personId : undefined,
    }
  } catch {
    // An unreadable cookie is an absent one. Distinguishing "expired" from
    // "forged" for the caller would leak information and change nothing.
    return null
  }
}

export function sessionCookieOptions(config: AuthConfig) {
  return {
    name: SESSION_COOKIE,
    httpOnly: true,
    // Lax rather than Strict: Strict would drop the cookie on the redirect
    // back from Google and the user would land signed out.
    sameSite: 'lax' as const,
    secure: config.appUrl.startsWith('https://'),
    path: '/',
    maxAge: config.maxAge,
  }
}
