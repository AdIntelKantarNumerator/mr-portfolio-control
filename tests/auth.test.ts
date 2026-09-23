/**
 * Tests for the authentication rules.
 *
 * These cover the checks whose failure mode is silent and serious: a session
 * that survives tampering, a domain check that lets an outside account
 * through, an open redirect in the return-to parameter. None of these would
 * show up as a broken page — the app would simply be less safe than it looks.
 *
 *   npm test
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { SignJWT } from 'jose'

import { domainAllowed } from '../src/lib/auth/config'
import { readSession, signSession, sessionCookieOptions } from '../src/lib/auth/session'
import { createPendingAuth, safeReturnTo } from '../src/lib/auth/oidc'

const config = {
  enabled: true,
  configError: null,
  clientId: 'test-client',
  clientSecret: 'test-secret',
  allowedDomains: ['mediaradar.com'],
  hostedDomainHint: null,
  appUrl: 'https://portfolio.example.com',
  secret: 'a'.repeat(48),
  maxAge: 3600,
  debug: false,
}

describe('domain restriction', () => {
  test('an address in the allowed domain is accepted', () => {
    assert.equal(domainAllowed('scott.bernberg@mediaradar.com', ['mediaradar.com']), true)
  })

  test('an outside address is rejected', () => {
    assert.equal(domainAllowed('someone@gmail.com', ['mediaradar.com']), false)
  })

  test('a lookalike domain is rejected', () => {
    // The check must compare the whole domain, not a suffix: otherwise
    // "evil-mediaradar.com" and "mediaradar.com.attacker.net" both pass.
    assert.equal(domainAllowed('a@evil-mediaradar.com', ['mediaradar.com']), false)
    assert.equal(domainAllowed('a@mediaradar.com.attacker.net', ['mediaradar.com']), false)
  })

  test('an address with the domain in the local part is rejected', () => {
    assert.equal(domainAllowed('mediaradar.com@gmail.com', ['mediaradar.com']), false)
  })

  test('case is ignored', () => {
    assert.equal(domainAllowed('Person@MediaRadar.com', ['mediaradar.com']), true)
  })

  test('multiple domains are supported', () => {
    assert.equal(domainAllowed('a@second.com', ['mediaradar.com', 'second.com']), true)
  })

  test('a malformed address is rejected rather than throwing', () => {
    assert.equal(domainAllowed('not-an-email', ['mediaradar.com']), false)
    assert.equal(domainAllowed('', ['mediaradar.com']), false)
  })
})

describe('session cookie', () => {
  const session = { sub: 'g-123', email: 'a@mediaradar.com', name: 'A Person' }

  test('a signed session round-trips', async () => {
    const token = await signSession(session, config)
    const back = await readSession(token, config)
    assert.equal(back?.email, 'a@mediaradar.com')
    assert.equal(back?.sub, 'g-123')
  })

  test('the person id is carried for attribution', async () => {
    const token = await signSession({ ...session, personId: 'p-1' }, config)
    assert.equal((await readSession(token, config))?.personId, 'p-1')
  })

  test('a token signed with another secret is rejected', async () => {
    const token = await signSession(session, { ...config, secret: 'b'.repeat(48) })
    assert.equal(await readSession(token, config), null)
  })

  test('a tampered payload is rejected', async () => {
    const token = await signSession(session, config)
    const [header, , signature] = token.split('.')
    const forged = Buffer.from(
      JSON.stringify({ sub: 'g-123', email: 'attacker@evil.com' }),
    ).toString('base64url')
    assert.equal(await readSession(`${header}.${forged}.${signature}`, config), null)
  })

  test('an expired token is rejected', async () => {
    const past = Math.floor(Date.now() / 1000) - 7200
    const token = await signSession(session, { ...config, maxAge: 60 }, past)
    assert.equal(await readSession(token, config), null)
  })

  test('a token from another issuer is rejected', async () => {
    // Guards against a token minted by some other service that happens to
    // share the signing secret being accepted here.
    const token = await new SignJWT({ email: 'a@mediaradar.com' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('g-123')
      .setIssuer('some-other-app')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(config.secret))
    assert.equal(await readSession(token, config), null)
  })

  test('garbage and absence are both simply null', async () => {
    assert.equal(await readSession('not-a-jwt', config), null)
    assert.equal(await readSession(undefined, config), null)
  })
})

describe('cookie options', () => {
  test('the cookie is httpOnly so scripts cannot read it', () => {
    assert.equal(sessionCookieOptions(config).httpOnly, true)
  })

  test('secure is set on https and not on localhost', () => {
    assert.equal(sessionCookieOptions(config).secure, true)
    assert.equal(
      sessionCookieOptions({ ...config, appUrl: 'http://localhost:3000' }).secure,
      false,
    )
  })

  test('sameSite is lax, so the redirect back from Google keeps the cookie', () => {
    assert.equal(sessionCookieOptions(config).sameSite, 'lax')
  })
})

describe('return-to handling', () => {
  test('a relative path is kept', () => {
    assert.equal(safeReturnTo('/dependencies?all=1'), '/dependencies?all=1')
  })

  test('an absolute URL is refused, closing the open redirect', () => {
    assert.equal(safeReturnTo('https://evil.example/steal'), '/')
  })

  test('a protocol-relative URL is refused', () => {
    // "//evil.example" is a URL the browser resolves against the current
    // scheme — it looks relative and is not.
    assert.equal(safeReturnTo('//evil.example'), '/')
  })

  test('missing input falls back to the home page', () => {
    assert.equal(safeReturnTo(null), '/')
    assert.equal(safeReturnTo(undefined), '/')
    assert.equal(safeReturnTo(''), '/')
  })
})

describe('PKCE and CSRF material', () => {
  test('state, nonce and verifier are all distinct and long enough', () => {
    const p = createPendingAuth('/')
    assert.notEqual(p.state, p.nonce)
    assert.notEqual(p.state, p.codeVerifier)
    // RFC 7636 requires a verifier of at least 43 characters.
    assert.ok(p.codeVerifier.length >= 43)
    assert.ok(p.state.length >= 32)
  })

  test('every sign-in attempt gets fresh values', () => {
    const a = createPendingAuth('/')
    const b = createPendingAuth('/')
    assert.notEqual(a.state, b.state)
    assert.notEqual(a.nonce, b.nonce)
    assert.notEqual(a.codeVerifier, b.codeVerifier)
  })
})

describe('machine endpoint authorisation', () => {
  // These routes are exempt from the browser session gate, which makes them
  // the app's public surface once it is exposed to the internet.
  const withToken = (token: string) =>
    new Request('https://example.com/api/digest', {
      headers: { authorization: `Bearer ${token}` },
    })
  const bare = () => new Request('https://example.com/api/digest')

  const withEnv = async (env: Record<string, string | undefined>, fn: () => void) => {
    const saved = { ...process.env }
    Object.assign(process.env, env)
    for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k]
    try {
      fn()
    } finally {
      process.env = saved
    }
  }

  test('the correct bearer token is accepted', async () => {
    const { machineCallerAuthorised } = await import('../src/lib/machine-auth')
    await withEnv({ SYNC_TOKEN: 'correct-horse', NODE_ENV: 'production' }, () => {
      assert.equal(machineCallerAuthorised(withToken('correct-horse')), true)
    })
  })

  test('a wrong or absent token is refused', async () => {
    const { machineCallerAuthorised } = await import('../src/lib/machine-auth')
    await withEnv({ SYNC_TOKEN: 'correct-horse', NODE_ENV: 'production' }, () => {
      assert.equal(machineCallerAuthorised(withToken('wrong')), false)
      assert.equal(machineCallerAuthorised(bare()), false)
    })
  })

  test('a prefix of the real token is refused', async () => {
    const { machineCallerAuthorised } = await import('../src/lib/machine-auth')
    await withEnv({ SYNC_TOKEN: 'correct-horse', NODE_ENV: 'production' }, () => {
      assert.equal(machineCallerAuthorised(withToken('correct')), false)
    })
  })

  test('no token configured fails closed in production', async () => {
    // The digest contains the whole portfolio summary. Falling open here is
    // the difference between an internal tool and a public one.
    const { machineCallerAuthorised } = await import('../src/lib/machine-auth')
    await withEnv({ SYNC_TOKEN: undefined, NODE_ENV: 'production' }, () => {
      assert.equal(machineCallerAuthorised(bare()), false)
    })
  })

  test('no token configured stays open in development', async () => {
    const { machineCallerAuthorised } = await import('../src/lib/machine-auth')
    await withEnv({ SYNC_TOKEN: undefined, NODE_ENV: 'development' }, () => {
      assert.equal(machineCallerAuthorised(bare()), true)
    })
  })
})

describe('multi-domain Workspace', () => {
  // A renamed company commonly keeps its original domain as the Workspace
  // account's primary and adds the new one as a secondary. Accounts can then
  // exist under either, so the allow-list has to name both.
  const both = ['mediaradar.com', 'magazineradar.com']

  test('accounts on either domain of the same Workspace are accepted', () => {
    assert.equal(domainAllowed('scott@mediaradar.com', both), true)
    assert.equal(domainAllowed('someone@magazineradar.com', both), true)
  })

  test('listing only the new domain locks out anyone still on the old one', () => {
    // The failure this guards against: sign-in works for most of the company
    // and mysteriously refuses a handful of long-serving people.
    assert.equal(domainAllowed('someone@magazineradar.com', ['mediaradar.com']), false)
  })

  test('outside accounts are still refused with both listed', () => {
    assert.equal(domainAllowed('someone@gmail.com', both), false)
    assert.equal(domainAllowed('a@magazineradar.com.evil.net', both), false)
  })
})

describe('hosted-domain hint', () => {
  const base = { ...config, allowedDomains: ['mediaradar.com', 'magazineradar.com'] }

  test('no hd parameter is sent unless one is configured', async () => {
    const { authorizationUrl, createPendingAuth } = await import('../src/lib/auth/oidc')
    const url = new URL(authorizationUrl(base, createPendingAuth('/')))
    // Hinting one domain of a multi-domain Workspace breaks sign-in for
    // everyone on the others.
    assert.equal(url.searchParams.get('hd'), null)
  })

  test('an explicit hint is passed through', async () => {
    const { authorizationUrl, createPendingAuth } = await import('../src/lib/auth/oidc')
    const url = new URL(
      authorizationUrl({ ...base, hostedDomainHint: 'mediaradar.com' }, createPendingAuth('/')),
    )
    assert.equal(url.searchParams.get('hd'), 'mediaradar.com')
  })

  test('PKCE and state are present either way', async () => {
    const { authorizationUrl, createPendingAuth } = await import('../src/lib/auth/oidc')
    const url = new URL(authorizationUrl(base, createPendingAuth('/')))
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
    assert.ok(url.searchParams.get('state'))
    assert.ok(url.searchParams.get('nonce'))
  })
})
