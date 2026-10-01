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

/**
 * The chat screen (Open WebUI) calling /api/yaara/v1/*.
 *
 * Its own token, YAARA_CHAT_TOKEN, rather than SYNC_TOKEN: Open WebUI is a
 * separate deployment holding the value in its own settings, and if it ever
 * leaks from there it should open a chat with Yaara, not every machine route
 * in the app. Like SYNC_TOKEN, unset refuses in production and allows in
 * local development.
 */
export function chatRelayAuthorised(req: Request): boolean {
  const token = process.env.YAARA_CHAT_TOKEN?.trim()
  if (!token) return process.env.NODE_ENV !== 'production'
  return req.headers.get('authorization') === `Bearer ${token}`
}

/** An OpenAI-shaped error, which is what Open WebUI knows how to show. */
export function chatError(status: number, message: string) {
  return Response.json({ error: { message, type: status === 401 || status === 403 ? 'authentication_error' : 'invalid_request_error' } }, { status })
}
