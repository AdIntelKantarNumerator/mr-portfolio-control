import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * The single deliberately unauthenticated endpoint in the app.
 *
 * Azure App Service — and any load balancer — needs a path it can probe without
 * credentials. A health check that receives 401 marks the instance unhealthy
 * and the platform restarts it in a loop, so one endpoint has to stay open.
 *
 * It returns a constant. No version, no uptime, no configuration state, no
 * database check: nothing that tells an anonymous caller anything about the
 * deployment. If it answers, the process is running and serving HTTP, which is
 * all a health probe needs to know.
 *
 * It deliberately does NOT check the database. A transient database blip
 * should not make the platform kill an otherwise healthy app, and that failure
 * is already surfaced to signed-in users where someone can act on it.
 */
export async function GET() {
  return NextResponse.json({ ok: true })
}
