'use client'

/**
 * "Reassess now", under the pencil on a home page card.
 *
 * Asks Yaara to re-read the evidence for this item and publish a fresh
 * assessment, then waits for her to finish and refreshes the page so the new
 * sentence appears. She is reached by request, not by call (see
 * lib/reassess-rules.ts), so this polls every few seconds until she says she
 * is done, or until it is clear she will not.
 *
 * Returned as a button and a note rather than one element: the button sits in
 * the narrow column beside the assessment, and anything she has to say ("there
 * is nothing attached to this") needs the width of the card.
 *
 * WHILE SHE WORKS (Scott, 3 October 2026: "some kind of indication that the
 * reassessment is being done"). Four signs, so nobody wonders whether the
 * click took: the icon spins; the assessment it is replacing is dimmed and
 * marked busy; a line under it says whether she has picked it up yet, with a
 * running count of seconds; and the hover text says the same.
 */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { reassessStatus, startReassess } from '@/app/reassess-actions'

type Phase =
  | { kind: 'idle' }
  | { kind: 'running'; id: string; working: boolean; since: number }
  | { kind: 'said'; text: string; failed: boolean }

const POLL_MS = 4_000

export function useReassess(level: string, entityId: string) {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })

  const runningId = phase.kind === 'running' ? phase.id : null

  // A clock for the "12s" in the note, ticking only while she works.
  const [now, setNow] = useState(() => Date.now())
  const isRunning = phase.kind === 'running'
  useEffect(() => {
    if (!isRunning) return
    const t = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(t)
  }, [isRunning])

  useEffect(() => {
    if (!runningId) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      try {
        const view = await reassessStatus(runningId)
        if (stopped) return
        if (view.state === 'done') {
          router.refresh()
          setPhase(view.message ? { kind: 'said', text: view.message, failed: false } : { kind: 'idle' })
          return
        }
        if (view.state === 'failed') {
          setPhase({ kind: 'said', text: view.message ?? 'Yaara could not reassess this.', failed: true })
          return
        }
        setPhase((p) => (p.kind === 'running' ? { ...p, working: view.state === 'working' } : p))
      } catch {
        // A blip between here and the server; the next tick asks again.
      }
      if (!stopped) timer = setTimeout(tick, POLL_MS)
    }
    timer = setTimeout(tick, POLL_MS)
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [runningId, router])

  async function start() {
    if (phase.kind === 'running') return
    const since = Date.now()
    setNow(since)
    setPhase({ kind: 'running', id: '', working: false, since })
    // A request that throws (the server down, a database error) must end the
    // wait, not leave the card saying "waiting for her" forever - which is
    // what it did the first time this was tried against a database missing
    // the queue table.
    const res = await startReassess(level, entityId).catch(() => ({
      id: undefined,
      error: 'The request could not be made. Try again in a moment.',
    }))
    if (res.error || !res.id) {
      setPhase({ kind: 'said', text: res.error ?? 'The request could not be made.', failed: true })
      return
    }
    setPhase({ kind: 'running', id: res.id, working: false, since })
  }

  const running = phase.kind === 'running'
  const title = running
    ? phase.working
      ? 'Yaara is reassessing this now. The text updates when she has finished.'
      : 'Waiting for Yaara to pick this up…'
    : 'Reassess now: Yaara re-reads the latest evidence and rewrites this assessment, and the one above it. Usually a minute or two.'

  const button = (
    <button
      type="button"
      className={`pencil reassess${running ? ' spinning' : ''}`}
      onClick={start}
      disabled={running}
      title={title}
      aria-label={running ? 'Reassessing' : 'Reassess now'}
      aria-busy={running}
    >
      {/* Two arrows chasing round a circle: "go round again". */}
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M13.5 8a5.5 5.5 0 0 1-9.6 3.7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M2.5 8a5.5 5.5 0 0 1 9.6-3.7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M12.6 1.8v2.7H9.9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M3.4 14.2v-2.7h2.7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  )

  const seconds = running ? Math.max(0, Math.round((now - phase.since) / 1000)) : 0
  const note = running ? (
    <p className="reassess-note busy" role="status">
      <span className="reassess-dot" aria-hidden="true" />
      {phase.working
        ? 'Yaara is reassessing this: reading the evidence and rewriting the assessment.'
        : 'Asked Yaara to reassess this. Waiting for her to pick it up.'}{' '}
      <span className="reassess-time">
        {seconds}s · usually a minute or two
      </span>
    </p>
  ) : phase.kind === 'said' ? (
    <p className={`reassess-note${phase.failed ? ' bad' : ''}`} role="status">
      {phase.text}{' '}
      <button type="button" className="linkish" onClick={() => setPhase({ kind: 'idle' })}>
        Dismiss
      </button>
    </p>
  ) : null

  return { button, note, running }
}
