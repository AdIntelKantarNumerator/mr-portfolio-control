import { redirect } from 'next/navigation'
import { LogoMark } from '@/components/logo'
import { BRAND_NAME, BRAND_ORG, BRAND_TAGLINE } from '@/lib/brand'
import { getAuthConfig } from '@/lib/auth/config'
import { getCurrentUser } from '@/lib/auth/current-user'
import { safeReturnTo } from '@/lib/auth/oidc'

export const metadata = { title: 'Sign in' }
export const dynamic = 'force-dynamic'

/**
 * Every message names what to do next. "Authentication failed" tells a person
 * nothing they can act on, which turns a self-service problem into a support
 * request.
 */
const MESSAGES: Record<string, string> = {
  cancelled: 'Sign-in was cancelled. Try again when you are ready.',
  wrong_domain:
    'That account is outside the organisation. Sign in with your work Google account — ' +
    'or, if it is a work account, ask whoever set this up to check the allowed domain list.',
  unverified:
    'That Google account has no verified email address, so it cannot be used to sign in.',
  state_mismatch:
    'That sign-in link did not match this browser. Start again from this page.',
  expired: 'The sign-in attempt timed out. Please try again.',
  missing_code: 'Google did not complete the sign-in. Please try again.',
  exchange_failed:
    'Could not complete sign-in with Google. If this keeps happening, the app credentials may need checking.',
  provider: 'Google refused the sign-in request. Please try again.',
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string
    returnTo?: string
    signedout?: string
    detail?: string
  }>
}) {
  const { error, returnTo, signedout, detail } = await searchParams
  const config = getAuthConfig()

  // Nothing to sign into when auth is off, and an already-signed-in person
  // should not be looking at a sign-in page.
  if (!config.enabled) redirect('/')
  const user = await getCurrentUser()
  if (user.authenticated && !signedout) redirect(safeReturnTo(returnTo))

  const target = `/api/auth/signin?returnTo=${encodeURIComponent(safeReturnTo(returnTo))}`

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="card w-full max-w-[420px] p-7 text-center">
        <div className="flex justify-center">
          <LogoMark size={52} />
        </div>

        <div
          className="mt-4 text-[10.5px] font-bold uppercase tracking-[0.06em]"
          style={{ color: 'var(--brand-2)' }}
        >
          {BRAND_ORG}
        </div>
        <h1 className="m-0 mt-1 text-[20px] font-bold tracking-[-0.02em]">{BRAND_NAME}</h1>
        {BRAND_TAGLINE ? (
          <div className="mt-1 text-[11px] italic" style={{ color: 'var(--muted)' }}>
            {BRAND_TAGLINE}
          </div>
        ) : null}

        {signedout ? (
          <p
            className="tone-green mt-5 mb-0 rounded-lg px-3 py-2 text-[12.5px]"
            role="status"
          >
            You are signed out.
          </p>
        ) : null}

        {error ? (
          <p className="tone-red mt-5 mb-0 rounded-lg px-3 py-2 text-[12.5px]" role="alert">
            {MESSAGES[error] ?? 'Sign-in did not complete. Please try again.'}
          </p>
        ) : null}

        {detail && config.debug ? (
          <div
            className="mt-3 rounded-lg px-3 py-2 text-left text-[11px] leading-relaxed"
            style={{ background: 'var(--surface-2)', color: 'var(--muted)' }}
          >
            <strong>Diagnostic (AUTH_DEBUG is on):</strong>
            <div className="mt-1 font-mono break-words">{detail}</div>
            <div className="mt-1">Unset AUTH_DEBUG once this is sorted.</div>
          </div>
        ) : null}

        <a href={target} className="btn btn-primary mt-6 w-full !py-2.5">
          <GoogleGlyph />
          Sign in with Google
        </a>

        <p className="m-0 mt-4 text-[11.5px]" style={{ color: 'var(--muted)' }}>
          Open to anyone with an {config.allowedDomains.join(' or ')} account.
        </p>
      </div>
    </div>
  )
}

function GoogleGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden className="shrink-0">
      <path
        fill="#4285F4"
        d="M45.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h11.8c-.5 2.7-2 5-4.4 6.6v5.5h7.1c4.1-3.8 6.6-9.4 6.6-16.1z"
      />
      <path
        fill="#34A853"
        d="M24 46c5.9 0 10.9-2 14.5-5.4l-7.1-5.5c-2 1.3-4.5 2.1-7.4 2.1-5.7 0-10.5-3.8-12.2-9H4.5v5.7C8.1 41.1 15.4 46 24 46z"
      />
      <path
        fill="#FBBC05"
        d="M11.8 28.2c-.4-1.3-.7-2.7-.7-4.2s.3-2.9.7-4.2v-5.7H4.5C3 17.1 2.1 20.4 2.1 24s.9 6.9 2.4 9.9l7.3-5.7z"
      />
      <path
        fill="#EA4335"
        d="M24 10.8c3.2 0 6.1 1.1 8.4 3.3l6.3-6.3C34.9 4.2 29.9 2 24 2 15.4 2 8.1 6.9 4.5 14.1l7.3 5.7c1.7-5.2 6.5-9 12.2-9z"
      />
    </svg>
  )
}
