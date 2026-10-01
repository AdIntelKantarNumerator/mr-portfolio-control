/**
 * Who may edit the Reference screens, checked inside every action.
 *
 * The rule is the app's rule: anyone signed in on an allowed domain. There are
 * no roles in this app (lib/auth/config.ts says why), and the Workflow
 * Assessment map and the Data Dictionary are meant to be corrected by whoever
 * notices something wrong.
 *
 * It is checked here and not only in proxy.ts because a Server Action is a
 * plain POST endpoint: the proxy is a gate, not the authorization model, and
 * the Next.js docs are explicit that every action must verify its caller. With
 * sign-in switched off for local work, edits are allowed and recorded as
 * "manual", the same as every other edit in the app.
 */
import { getAuthConfig } from './config'
import { actorName, getCurrentUser } from './current-user'

export async function editor(): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  if (getAuthConfig().enabled) {
    const user = await getCurrentUser()
    if (!user.authenticated) return { ok: false, error: 'Your session has expired. Sign in again to save.' }
  }
  return { ok: true, name: await actorName() }
}
