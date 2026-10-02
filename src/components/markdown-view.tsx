'use client'

/**
 * Renders lib/markdown-lite.ts's tree as React elements. No HTML is ever
 * injected; see that file for why.
 *
 * Links into this app navigate in place (the chat panel stays open across a
 * client-side navigation), and links elsewhere open in a new tab. Yaara writes
 * portfolio links as absolute URLs, so an absolute link to this origin is
 * treated as internal too.
 */
import { useRouter } from 'next/navigation'
import type { MouseEvent, ReactNode } from 'react'
import { parseMarkdown, type Inline } from '@/lib/markdown-lite'

function internalPath(href: string): string | null {
  if (href.startsWith('/')) return href
  try {
    const u = new URL(href)
    return u.origin === window.location.origin ? `${u.pathname}${u.search}${u.hash}` : null
  } catch {
    return null
  }
}

export function MarkdownView({ text }: { text: string }) {
  const router = useRouter()

  const follow = (href: string) => (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
    const path = internalPath(href)
    if (!path) return
    e.preventDefault()
    router.push(path)
  }

  const inline = (nodes: Inline[]): ReactNode[] =>
    nodes.map((n, i) => {
      switch (n.t) {
        case 'text':
          return n.v
        case 'strong':
          return <strong key={i}>{inline(n.c)}</strong>
        case 'em':
          return <em key={i}>{inline(n.c)}</em>
        case 'code':
          return <code key={i}>{n.v}</code>
        case 'link': {
          // Rendered only in the browser (the panel mounts client-side), so the
          // origin is known and a link back into the portfolio stays in this tab.
          const external = internalPath(n.href) === null
          return (
            <a key={i} href={n.href} onClick={follow(n.href)} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
              {inline(n.c)}
            </a>
          )
        }
      }
    })

  return (
    <div className="md">
      {parseMarkdown(text).map((b, i) => {
        switch (b.t) {
          case 'p':
            return <p key={i}>{inline(b.c)}</p>
          case 'h':
            return <p key={i} className={`md-h md-h${b.level}`}>{inline(b.c)}</p>
          case 'ul':
            return <ul key={i}>{b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ul>
          case 'ol':
            return <ol key={i}>{b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ol>
          case 'code':
            return <pre key={i}><code>{b.v}</code></pre>
          case 'quote':
            return <blockquote key={i}>{inline(b.c)}</blockquote>
          case 'table':
            return (
              <div key={i} className="md-tablewrap">
                <table>
                  <thead>
                    <tr>{b.head.map((c, j) => <th key={j}>{inline(c)}</th>)}</tr>
                  </thead>
                  <tbody>
                    {b.rows.map((r, j) => (
                      <tr key={j}>{r.map((c, k) => <td key={k}>{inline(c)}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
        }
      })}
    </div>
  )
}
