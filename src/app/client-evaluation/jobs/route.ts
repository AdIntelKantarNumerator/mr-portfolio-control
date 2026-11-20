/**
 * Client Evaluation's background jobs (lib/client-eval/jobs.ts).
 *
 *   POST { kind: 'deck', scope }   start an Impact Deck for a client, account or person
 *   POST { kind: 'export' }        start the client and user export
 *   GET  ?id=<job>                 how far along it is
 *   GET  ?id=<job>&file=1          the finished file: the PowerPoint or the workbook
 *
 * Under /client-evaluation, so the gate
 * already requires "Sees Client Evaluation"; checked again here because the
 * gate does not enforce roles on the embedded local database.
 */
import { NextResponse } from 'next/server'
import { db } from '@/db/client'
import { currentAccess } from '@/lib/auth/access'
import { buildDeck } from '@/lib/client-eval/deck-pptx'
import { deckData, type DeckScope } from '@/lib/client-eval/deck-data'
import { buildExport } from '@/lib/client-eval/export'
import { readJob, readJobFile, runningJob, startJob } from '@/lib/client-eval/jobs'
import { parseMember } from '@/lib/client-eval/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status })

function readScope(raw: unknown): DeckScope | null {
  const s = (raw ?? {}) as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' && v.length <= 300 ? v : null)
  if (s.kind === 'client' && str(s.clientId)) return { kind: 'client', clientId: str(s.clientId)! }
  if (s.kind === 'account' && str(s.key) && parseMember(str(s.key)!)) return { kind: 'account', key: str(s.key)! }
  if (s.kind === 'person' && str(s.clientId) && str(s.person)) return { kind: 'person', clientId: str(s.clientId)!, person: str(s.person)! }
  return null
}

const fileSafe = (s: string) => s.replace(/[^A-Za-z0-9 ._-]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Client'

export async function POST(req: Request) {
  const who = await currentAccess()
  if (!who.canSeeClientEvaluation) return bad('Client Evaluation is not switched on for you.', 403)
  const body = (await req.json().catch(() => ({}))) as { kind?: string; scope?: unknown; title?: string }
  const by = who.email || who.name || null
  const day = new Date().toISOString().slice(0, 10)
  try {
    if (body.kind === 'deck') {
      const scope = readScope(body.scope)
      if (!scope) return bad('Unknown client, account or person.')
      const title = String(body.title ?? 'Client').slice(0, 200)
      const id = await startJob('deck', `Impact Deck: ${title}`, { scope }, by, async (progress, out) => {
        const data = await deckData(scope, progress)
        await progress('Building the PowerPoint')
        out.write(await buildDeck(data))
        return { fileName: `${fileSafe(data.title)} - Insights Studio impact ${day}.pptx`, fileType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }
      })
      return NextResponse.json({ id })
    }
    if (body.kind === 'export') {
      // One export at a time: it is the same file for everyone, and two at once slow the server for every other request.
      const already = await runningJob('export')
      if (already) return NextResponse.json({ id: already })
      const id = await startJob('export', 'Clients and users export', {}, by, async (progress, out) => {
        await buildExport(db, progress, out)
        return { fileName: `Client Evaluation - clients and users ${day}.xlsx`, fileType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
      })
      return NextResponse.json({ id })
    }
    return bad('Unknown request.')
  } catch (err) {
    console.error('[client-eval] job start', err)
    return bad((err as Error).message || 'That could not be started.', 500)
  }
}

export async function GET(req: Request) {
  const who = await currentAccess()
  if (!who.canSeeClientEvaluation) return bad('Client Evaluation is not switched on for you.', 403)
  const u = new URL(req.url).searchParams
  const id = u.get('id') ?? ''
  if (!/^[0-9a-f-]{36}$/.test(id)) return bad('Unknown job.')
  if (u.get('file') === '1') {
    const f = await readJobFile(id)
    if (!f) return new Response('That file is not ready, or is no longer here.', { status: 404 })
    const ascii = f.fileName.replace(/[^ -~]/g, '_').replace(/"/g, '')
    return new Response(f.stream, {
      headers: {
        'content-type': f.fileType,
        'content-disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(f.fileName)}`,
        'cache-control': 'no-store',
      },
    })
  }
  const job = await readJob(id)
  return job ? NextResponse.json(job) : bad('That job is no longer here. Start it again.', 404)
}
