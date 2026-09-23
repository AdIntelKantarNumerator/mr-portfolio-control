/**
 * Authorisation for the machine endpoints.
 *
 * These routes are exempt from the browser session gate because their callers
 * are schedulers and webhooks, not people. That exemption makes them the app's
 * public attack surface, so each one must authenticate its own caller — and a
 * GET that merely *reads* is not exempt from that. `GET /api/digest` returned
 * the full portfolio digest to anyone who asked until this was added.
 *
 * With no SYNC_TOKEN configured these refuse in production rather than falling
 * open, matching how the rest of the app treats missing configuration.
 */
export function machineCallerAuthorised(req: Request): boolean {
  const token = process.env.SYNC_TOKEN?.trim()
  if (!token) return process.env.NODE_ENV !== 'production'

  const header = req.headers.get('authorization')
  if (!header) return false

  // Constant-time-ish: compare full strings rather than prefix-matching, so a
  // partially correct token is no more informative than a wrong one.
  return header === `Bearer ${token}`
}

export function unauthorised() {
  return Response.json(
    { error: 'unauthorized', hint: 'Send Authorization: Bearer <SYNC_TOKEN>.' },
    { status: 401 },
  )
}
