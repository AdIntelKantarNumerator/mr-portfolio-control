'use client'

/**
 * Ask Yaara, in a panel on the right of the portfolio.
 *
 * WHY A PANEL OF OUR OWN RATHER THAN OPEN WEBUI IN A FRAME
 *
 * Open WebUI lives on its own address, and azurewebsites.net is a public
 * suffix, so to the browser it is an unrelated site: framed inside the
 * portfolio it would get its own partitioned sign-in, and Google's sign-in
 * page refuses to load in a frame at all. So the panel talks to Yaara through
 * the portfolio itself (POST /api/ask-yaara), as whoever is signed in here,
 * over the same relay Open WebUI uses. "Open Full Chat" at the top still opens
 * Open WebUI for long conversations and history, with its own Google sign-in.
 *
 * WHAT IT KEEPS
 *
 * It lives in the shell, so it stays open, mid-answer, across navigation
 * between pages. The conversation and whether the panel is open are kept in
 * sessionStorage, so a reload keeps them and closing the tab forgets them:
 * chat history is not the record. Each question carries the page it was asked
 * from, so "what about this one?" means something to her.
 */
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent } from 'react'
import { MarkdownView } from './markdown-view'

const OPEN_EVENT = 'pcr:yaara-open'
const STORE_CHAT = 'pcr:yaara-chat'
const STORE_OPEN = 'pcr:yaara-open'

/** Opens the panel from anywhere in the app. */
export function openYaara() {
  window.dispatchEvent(new Event(OPEN_EVENT))
}

/** The home page's button. */
export function AskYaaraButton({ className = '' }: { className?: string }) {
  return (
    <button type="button" className={`home-ask ${className}`.trim()} onClick={openYaara} title="Ask Yaara anything about the portfolio">
      {/* A 64px file that ships with the app, as in the shell: the optimiser would add a request to save nothing. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/yaara-64.png" alt="" width={22} height={22} />
      Ask Yaara
    </button>
  )
}

interface Message {
  role: 'user' | 'assistant'
  content: string
  /** What she said she was doing while answering. */
  working?: string[]
  pending?: boolean
  /** The answer is an error from the panel, not something she said; not sent back to her. */
  failed?: boolean
}

function readStore<T>(key: string, fallback: T): T {
  try {
    const raw = window.sessionStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}
function writeStore(key: string, value: unknown) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Private browsing or storage full: the panel still works, it just forgets.
  }
}

const SUGGESTIONS = [
  'What should I know about what is on this page?',
  'What is blocked right now, and who owns clearing it?',
  'If we change how we classify automotive ads, what would that affect?',
]

/**
 * What the page is about, in words. The page's own heading first: many pages
 * share the tab title "MR Portfolio Control", and a path like
 * /initiatives/9eb68b9d-... names nothing Yaara can look up. Found on the first
 * try of the panel, when she was asked "how is this one going?" and could
 * not say which one.
 */
function pageTitle(): string {
  const heading = document.querySelector('main h1')?.textContent?.replace(/\s+/g, ' ').trim()
  return [heading, document.title].filter(Boolean).join(' · ')
}

const noop = () => () => {}

/**
 * The shell renders this. It mounts its real content only in the browser,
 * so restoring a conversation from sessionStorage can never disagree with
 * what the server rendered.
 */
export function YaaraPanel({ chatUrl }: { chatUrl: string | null }) {
  const inBrowser = useSyncExternalStore(noop, () => true, () => false)
  return inBrowser ? <Panel chatUrl={chatUrl} /> : null
}

function Panel({ chatUrl }: { chatUrl: string | null }) {
  const pathname = usePathname()
  const [open, setOpen] = useState<boolean>(() => readStore(STORE_OPEN, false))
  const [messages, setMessages] = useState<Message[]>(() =>
    // A question still pending when the page was reloaded will never finish here.
    readStore<Message[]>(STORE_CHAT, []).filter((m) => !m.pending),
  )
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const abort = useRef<AbortController | null>(null)
  const list = useRef<HTMLDivElement | null>(null)
  const input = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    const show = () => {
      setOpen(true)
      setTimeout(() => input.current?.focus(), 50)
    }
    window.addEventListener(OPEN_EVENT, show)
    return () => window.removeEventListener(OPEN_EVENT, show)
  }, [])

  useEffect(() => {
    writeStore(STORE_OPEN, open)
    // The page makes room for the panel on wide screens; see globals.css.
    if (open) document.body.dataset.yaara = 'open'
    else delete document.body.dataset.yaara
  }, [open])

  useEffect(() => {
    writeStore(STORE_CHAT, messages)
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  // Stop a running answer if the panel itself goes away.
  useEffect(() => () => abort.current?.abort(), [])

  const patchLast = useCallback((patch: (m: Message) => Message) => {
    setMessages((prev) => (prev.length ? [...prev.slice(0, -1), patch(prev[prev.length - 1]!)] : prev))
  }, [])

  async function ask(question: string) {
    const text = question.trim()
    if (!text || busy) return
    const history = [...messages.filter((m) => !m.pending && !m.failed), { role: 'user' as const, content: text }]
    setMessages([...messages, { role: 'user', content: text }, { role: 'assistant', content: '', working: [], pending: true }])
    setDraft('')
    setBusy(true)
    const controller = new AbortController()
    abort.current = controller

    try {
      const res = await fetch('/api/ask-yaara', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: history.map((m) => ({ role: m.role, content: m.content })),
          page: { path: `${window.location.pathname}${window.location.search}`, title: pageTitle() },
        }),
        signal: controller.signal,
      })
      const type = res.headers.get('content-type') ?? ''
      if (!res.ok || !type.includes('ndjson') || !res.body) {
        const why = type.includes('text/html')
          ? 'Your portfolio sign-in has expired. Reload the page and ask again.'
          : ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `The portfolio answered ${res.status}.`
        patchLast((m) => ({ ...m, content: why, pending: false, failed: true }))
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let nl: number
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim()
          buffer = buffer.slice(nl + 1)
          if (!line) continue
          const event = JSON.parse(line) as { type: string; note?: string; text?: string }
          if (event.type === 'progress' && event.note) patchLast((m) => ({ ...m, working: [...(m.working ?? []), event.note!] }))
          if (event.type === 'reply') patchLast((m) => ({ ...m, content: event.text ?? '', pending: false }))
        }
      }
      patchLast((m) => (m.pending ? { ...m, content: 'The answer did not arrive. Ask again.', pending: false, failed: true } : m))
    } catch (err) {
      const stopped = (err as Error).name === 'AbortError'
      patchLast((m) =>
        m.pending ? { ...m, content: stopped ? 'Stopped.' : `Could not reach the portfolio (${(err as Error).message}).`, pending: false, failed: true } : m,
      )
    } finally {
      setBusy(false)
      abort.current = null
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    void ask(draft)
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void ask(draft)
    }
  }

  if (!open || pathname === '/signin') return null

  return (
    <aside className="yp no-print" aria-label="Ask Yaara">
      <div className="yp-head">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/yaara-64.png" alt="" width={28} height={28} />
        <div className="yp-title">
          <b>Yaara</b>
          <span>Asks the portfolio and the sources she reads</span>
        </div>
        {messages.length ? (
          <button type="button" className="yp-icon" onClick={() => !busy && setMessages([])} disabled={busy} title="Start a new conversation">
            New
          </button>
        ) : null}
        <button type="button" className="yp-icon yp-close" onClick={() => setOpen(false)} aria-label="Close the Yaara panel" title="Close">
          ×
        </button>
      </div>

      {chatUrl ? (
        <div className="yp-full-row">
          <a className="yp-full" href={chatUrl} target="yaara-chat" rel="noopener" aria-describedby="yp-full-tip">
            Open Full Chat
            <span className="yp-tip" role="tooltip" id="yp-full-tip">
              Google Sign In Required
            </span>
          </a>
          <span className="yp-powered">Powered by Open WebUI</span>
        </div>
      ) : null}

      <div className="yp-list" ref={list}>
        {messages.length === 0 ? (
          <div className="yp-empty">
            <p>Ask about anything in the portfolio: how work is going, what is blocked, what was decided, what is in intake, what a change would affect, or what is loaded in ClickHouse. She can see which page you are on.</p>
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" className="yp-suggest" onClick={() => void ask(s)}>
                {s}
              </button>
            ))}
          </div>
        ) : (
          messages.map((m, i) =>
            m.role === 'user' ? (
              <div key={i} className="yp-msg yp-user">
                {m.content}
              </div>
            ) : (
              <div key={i} className={`yp-msg yp-bot${m.failed ? ' yp-failed' : ''}`}>
                {m.working?.length ? (
                  <details className="yp-working" open={m.pending}>
                    <summary>{m.pending ? 'Working' : `Worked through ${m.working.length} step${m.working.length === 1 ? '' : 's'}`}</summary>
                    <ul>{m.working.map((w, j) => <li key={j}>{w}</li>)}</ul>
                  </details>
                ) : null}
                {m.pending ? <span className="yp-dots" aria-label="Yaara is answering"><i /><i /><i /></span> : <MarkdownView text={m.content} />}
              </div>
            ),
          )
        )}
      </div>

      <form className="yp-compose" onSubmit={submit}>
        <textarea
          ref={input}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          placeholder="Ask Yaara…"
          rows={2}
          aria-label="Your question for Yaara"
        />
        {busy ? (
          <button type="button" className="yp-send" onClick={() => abort.current?.abort()}>
            Stop
          </button>
        ) : (
          <button type="submit" className="yp-send" disabled={!draft.trim()}>
            Send
          </button>
        )}
      </form>
      <p className="yp-foot">
        Enter to send, Shift+Enter for a new line. She can be wrong: check anything you act on.
      </p>
    </aside>
  )
}
