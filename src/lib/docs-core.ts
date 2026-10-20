/**
 * Process Documentation: the rules for an uploaded artifact, kept apart from
 * the database so they can be tested (Scott, 20 October 2026).
 *
 * WHY "COMPLETE" A DOCUMENT
 *
 * A Claude artifact is usually written as a fragment - a <title>, a <style>,
 * the content - and Claude's publisher wraps it in a document skeleton before
 * showing it: a charset and viewport, light color-scheme, the phone's
 * safe-area padding, zero body margin, a 14px system font on an off-white
 * ground. Shown bare, the same file renders in quirks mode with browser
 * defaults and looks wrong. So a fragment is wrapped here in the same
 * skeleton, and a file that is already a whole document is left exactly as it
 * is. A Markdown artifact becomes plain, readable HTML inside it.
 */
import { parseInline, parseMarkdown, type Block, type Inline } from './markdown-lite'

/** The most an artifact may weigh, as on Claude: 16MB. */
export const MAX_ARTIFACT_BYTES = 16 * 1024 * 1024

const SKELETON_STYLE =
  ':root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}' +
  'body{margin:0;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;background:#fafaf8;color:#1f1f1f}' +
  'img{max-width:100%}[hidden]{display:none!important}'

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Whether this is already a whole document rather than a fragment. */
export function isWholeDocument(html: string): boolean {
  const head = html.slice(0, 2000).trimStart().toLowerCase()
  return head.startsWith('<!doctype') || /^<html[\s>]/.test(head) || /<html[\s>]/.test(head.slice(0, 400))
}

/** A fragment in Claude's skeleton; a whole document unchanged. */
export function completeDocument(html: string): string {
  if (isWholeDocument(html)) return html
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">' +
    `<style>${SKELETON_STYLE}</style></head><body>${html}</body></html>`
  )
}

function inline(c: Inline[]): string {
  return c
    .map((i) =>
      i.t === 'text'
        ? escape(i.v)
        : i.t === 'code'
          ? `<code>${escape(i.v)}</code>`
          : i.t === 'strong'
            ? `<strong>${inline(i.c)}</strong>`
            : i.t === 'em'
              ? `<em>${inline(i.c)}</em>`
              : `<a href="${escape(i.href)}" target="_blank" rel="noreferrer">${inline(i.c)}</a>`,
    )
    .join('')
}

function block(b: Block): string {
  switch (b.t) {
    case 'p':
      return `<p>${inline(b.c)}</p>`
    case 'h':
      return `<h${b.level}>${inline(b.c)}</h${b.level}>`
    case 'ul':
    case 'ol':
      return `<${b.t}>${b.items.map((it) => `<li>${inline(it)}</li>`).join('')}</${b.t}>`
    case 'code':
      return `<pre><code>${escape(b.v)}</code></pre>`
    case 'quote':
      return `<blockquote>${inline(b.c)}</blockquote>`
    case 'table':
      return `<table><thead><tr>${b.head.map((h) => `<th>${inline(h)}</th>`).join('')}</tr></thead><tbody>${b.rows
        .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
        .join('')}</tbody></table>`
  }
}

/** A Markdown artifact as a readable page. */
export function markdownToHtml(md: string, title: string): string {
  const css =
    'main{max-width:46rem;margin:0 auto;padding:32px 16px 64px;line-height:1.6;font-size:15px}' +
    'h1,h2,h3,h4{line-height:1.25;margin:1.6em 0 .5em}h1{font-size:1.9em;margin-top:0}' +
    'code{font-family:ui-monospace,Consolas,monospace;font-size:.9em;background:#efeeea;padding:1px 4px;border-radius:4px}' +
    'pre{background:#efeeea;padding:12px;border-radius:8px;overflow:auto}pre code{background:none;padding:0}' +
    'table{border-collapse:collapse;display:block;overflow-x:auto}th,td{border:1px solid #ddd;padding:6px 10px;text-align:left}' +
    'blockquote{margin:1em 0;padding-left:1em;border-left:3px solid #ccc;color:#555}a{color:#2f5fd0}'
  return completeDocument(`<title>${escape(title)}</title><style>${css}</style><main>${parseMarkdown(md).map(block).join('\n')}</main>`)
}

/** The text a reader sees, for search: no scripts, styles or tags. */
export function readableText(html: string, max = 200_000): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

/** The page's own <title>, for a name when the uploader gave none. */
export function titleOf(html: string): string | null {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  const t = m ? readableText(m[1]!) : ''
  return t || null
}

/** A name from a file name: "Release-process_v2.html" -> "Release process v2". */
export function nameFromFile(fileName: string): string {
  return fileName.replace(/\.(html?|md|markdown)$/i, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Untitled'
}

/** What an uploaded file becomes, ready to store. */
export function prepareUpload(input: { content: string; fileName?: string | null; name?: string | null }): { html: string; name: string; text: string } {
  const isMarkdown = /\.(md|markdown)$/i.test(input.fileName ?? '')
  const given = input.name?.trim()
  // A Markdown artifact's first heading is its title, as Claude shows it.
  const heading = isMarkdown ? /^#{1,2}\s+(.+)$/m.exec(input.content)?.[1]?.replace(/[*_`]/g, '').trim() : undefined
  const fallback = heading || (input.fileName ? nameFromFile(input.fileName) : 'Untitled')
  const html = isMarkdown ? markdownToHtml(input.content, given || fallback) : completeDocument(input.content)
  const name = (given || titleOf(html) || fallback).slice(0, 200)
  return { html, name, text: readableText(html) }
}

/** A search hit's surrounding words, for the results list. */
export function snippet(text: string, q: string, around = 80): string | null {
  const at = text.toLowerCase().indexOf(q.toLowerCase())
  if (at < 0) return null
  const start = Math.max(0, at - around)
  const end = Math.min(text.length, at + q.length + around)
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`
}

/** "Guides / Release / Hotfix" -> ["Guides", "Release", "Hotfix"] */
export function folderPathParts(path: string | null | undefined): string[] {
  return String(path ?? '')
    .split('/')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => p.slice(0, 120))
}

export { parseInline }
