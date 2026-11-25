/**
 * Refreshing a Client Evaluation snapshot from the app (the Refresh button).
 *
 * 360 and Magnifier are read from here; Classic only from a laptop, because
 * its SQL Server does not let the app in. A refresh runs in the background of
 * this server process and writes its progress to ce_sources, which the page
 * polls. It takes a few minutes, mostly 360's per-client report counts.
 */
import { db } from '@/db/client'
import { live360Configured } from '@/lib/import360/source'
import { applySignins, cognitoConfig } from './cognito-signins'
import { load360 } from './load-360'
import { connectMagnifier, expireMagnifier, loadMagnifier, magnifierConfig } from './load-magnifier'
import { buildClients, markFailed, markReady, markRunning, progressWriter, saveSnapshot } from './store'
import { PLATFORM_LABEL, REFRESH_CONTACT, SNAPSHOT_ONLY, type Platform } from './types'

export function canRefreshHere(p: Platform): boolean {
  if (SNAPSHOT_ONLY[p]) return false
  if (p === '360') return live360Configured()
  if (p === 'magnifier') return magnifierConfig() !== null
  return false
}

/** Start a refresh; returns at once. Refuses if that platform is already refreshing. */
export async function startRefresh(p: Platform, by: string | null): Promise<{ ok: true } | { error: string }> {
  if (SNAPSHOT_ONLY[p]) return { error: `${PLATFORM_LABEL[p]} can only be refreshed from a laptop. Ask ${REFRESH_CONTACT}.` }
  if (!canRefreshHere(p)) return { error: `${PLATFORM_LABEL[p]} is not configured on this server.` }
  if (!(await markRunning(db, p, by))) return { error: `${PLATFORM_LABEL[p]} is already refreshing.` }
  void run(p, by)
  return { ok: true }
}

async function run(p: Platform, by: string | null) {
  const progress = progressWriter(db, p)
  try {
    let snap
    if (p === '360') snap = await load360(progress)
    else {
      const conn = await connectMagnifier(magnifierConfig()!)
      try {
        snap = await loadMagnifier(conn, progress)
        // Last logins from the SSO pool, by email (cognito-signins.ts).
        await applySignins(db, snap.users, progress).catch((err) => console.error('[client-eval] SSO sign-ins', err))
        // Every REL ended and nobody ever signed in: inactive (Scott, 25 November 2026).
        // Only with sign-ins read: without them nobody would have one, and every ended REL would read as inactive.
        if (cognitoConfig()) expireMagnifier(snap)
      } finally {
        await conn.end().catch(() => {})
      }
    }
    await progress('Saving the snapshot', 0, 0)
    await saveSnapshot(db, p, snap, by, { rebuilding: true })
    await buildClients(db, { progress: (step, done = 0, total = 0) => progress(step, done, total) })
    await markReady(db, p)
  } catch (err) {
    console.error(`[client-eval] ${p} refresh failed`, err)
    await markFailed(db, p, err).catch(() => {})
  }
}
