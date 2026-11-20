'use client'

/**
 * Starts an Impact Deck, follows it, and downloads it (../jobs). Also used by
 * the client list's export button through useJob.
 */
import { useEffect, useRef, useState } from 'react'
import { Kicker } from '@/components/ui'

export interface JobState {
  id: string
  status: 'running' | 'done' | 'failed'
  step: string | null
  done: number
  total: number
  error: string | null
  fileName: string | null
}

/** Start a job, poll it every two seconds, and download its file when it is done. */
export function useJob() {
  const [job, setJob] = useState<JobState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [started, setStarted] = useState<number | null>(null)
  /** Checks are failing for now (the server is busy); still trying. */
  const [waiting, setWaiting] = useState(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const downloadWhenDone = useRef(true)

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current)
  }, [])

  async function start(body: Record<string, unknown>) {
    setError(null)
    setJob(null)
    setStarted(Date.now())
    const res = await fetch('/client-evaluation/jobs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const out = await res.json().catch(() => ({}))
    if (!res.ok || !out.id) {
      setError(out.error ?? 'That could not be started.')
      return
    }
    follow(String(out.id), true)
  }

  /** Follow a job already running; download its file when it is done, if asked to. */
  function follow(id: string, download: boolean) {
    downloadWhenDone.current = download
    setError(null)
    setStarted((s) => s ?? Date.now())
    setJob((j) => (j?.id === id ? j : { id, status: 'running', step: 'Starting', done: 0, total: 0, error: null, fileName: null }))
    if (timer.current) clearInterval(timer.current)
    // A check can fail while the server is busy (another export writing, a
    // restart): keep checking, and give up only after three minutes of failures.
    let failingSince: number | null = null
    let checking = false
    timer.current = setInterval(async () => {
      if (checking) return
      checking = true
      try {
        const r = await fetch(`/client-evaluation/jobs?id=${id}`, { cache: 'no-store', signal: AbortSignal.timeout(20_000) })
        const j = (await r.json().catch(() => ({}))) as JobState & { error?: string }
        if (!r.ok) throw new Error(j.error ?? `The server answered ${r.status}.`)
        failingSince = null
        setWaiting(false)
        setJob({ ...j, id })
        if (j.status !== 'running') {
          if (timer.current) clearInterval(timer.current)
          if (j.status === 'done' && downloadWhenDone.current) {
            // A file, not a page: a link the browser downloads.
            const a = document.createElement('a')
            a.href = `/client-evaluation/jobs?id=${id}&file=1`
            a.download = j.fileName ?? ''
            document.body.appendChild(a)
            a.click()
            a.remove()
          }
        }
      } catch (err) {
        failingSince ??= Date.now()
        setWaiting(true)
        if (Date.now() - failingSince > 180_000) {
          setError(`Lost touch with the server for three minutes (${(err as Error).message}). The job may still finish: try again in a few minutes.`)
          if (timer.current) clearInterval(timer.current)
        }
      } finally {
        checking = false
      }
    }, 2000)
  }
  /** Download when the followed job is done (a background build the person has now asked for). */
  function wantDownload() {
    downloadWhenDone.current = true
  }
  return { job, error, started, start, follow, wantDownload, waiting }
}

export function JobProgress({ job, error, started, what, waiting = false }: { job: JobState | null; error: string | null; started: number | null; what: string; waiting?: boolean }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (job?.status !== 'running') return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [job?.status])
  const secs = started ? Math.max(0, Math.round((now - started) / 1000)) : 0
  const elapsed = secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`
  if (error || job?.status === 'failed') return <p className="mr-said mr-bad">{error ?? job?.error ?? 'It failed.'}</p>
  if (!job) return null
  const pct = job.total ? Math.round((100 * job.done) / job.total) : null
  return (
    <div className="ce-progress ce-job">
      {job.status === 'done' ? (
        <div className="ce-progress-step">
          <b>{what} is ready.</b> The download should start by itself.{' '}
          <a className="ce-link" href={`/client-evaluation/jobs?id=${job.id}&file=1`}>
            Download {job.fileName ?? 'the file'}
          </a>
        </div>
      ) : (
        <>
          <div className="ce-progress-step">
            {job.step ?? 'Working'}… <span className="ce-muted">{elapsed}{waiting ? ' · the server is busy, still checking' : ''}</span>
          </div>
          <div className="ce-track">
            <div className={`ce-bar${pct === null ? ' ce-indet' : ''}`} style={pct === null ? undefined : { width: `${Math.max(4, pct)}%` }} />
          </div>
        </>
      )}
    </div>
  )
}

export function DeckRunner({ scope, title }: { scope: string; title: string }) {
  const { job, error, started, start, waiting } = useJob()
  const once = useRef(false)
  useEffect(() => {
    if (once.current) return
    once.current = true
    let parsed: unknown = null
    try {
      parsed = JSON.parse(scope)
    } catch {
      parsed = null
    }
    void start({ kind: 'deck', scope: parsed, title })
    // Start once, when the window opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <div className="stack ce-deck">
      <div>
        <Kicker>Client Evaluation · Impact Deck</Kicker>
        <h1>{title || 'Impact Deck'}</h1>
        <p className="ce-lede">
          Building a PowerPoint of what changes in media coverage and taxonomy on the move to Insights Studio. It reads each platform&apos;s data, so it takes a few minutes. Keep this window open.
        </p>
      </div>
      <JobProgress job={job} error={error} started={started} what="The deck" waiting={waiting} />
      {job?.status === 'done' ? (
        <button type="button" className="btn" onClick={() => window.close()}>
          Close this window
        </button>
      ) : null}
    </div>
  )
}
