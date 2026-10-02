/**
 * Just enough Markdown for Yaara's answers in the chat panel.
 *
 * She answers in Markdown (her surface note says so): bold, lists, links,
 * now and then a table or a code span. The panel renders that as React
 * elements from this tree, never as HTML, so nothing in an answer can become
 * markup: an answer that quotes a PR title containing <script> shows the
 * text. That is the reason this is a small parser of our own rather than an
 * HTML-producing library and a sanitiser.
 *
 * Supported: paragraphs, headings (#-####), bullet and numbered lists,
 * tables, fenced code, block quotes, and inline **bold**, *italic*, `code`
 * and [links](url). Links go only to http(s) or to a path in this app;
 * anything else is shown as its text.
 */

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'strong'; c: Inline[] }
  | { t: 'em'; c: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'link'; href: string; c: Inline[] }

export type Block =
  | { t: 'p'; c: Inline[] }
  | { t: 'h'; level: 1 | 2 | 3 | 4; c: Inline[] }
  | { t: 'ul' | 'ol'; items: Inline[][] }
  | { t: 'code'; v: string }
  | { t: 'quote'; c: Inline[] }
  | { t: 'table'; head: Inline[][]; rows: Inline[][][] }

/** A link target that is safe to follow: http(s), or a path in this app. */
export function safeHref(raw: string): string | null {
  const href = raw.trim()
  if (/^https?:\/\//i.test(href)) return href
  if (href.startsWith('/') && !href.startsWith('//')) return href
  return null
}

/** Inline formatting within one block. */
export function parseInline(src: string): Inline[] {
  const out: Inline[] = []
  let text = ''
  const flush = () => {
    if (text) out.push({ t: 'text', v: text })
    text = ''
  }
  let i = 0
  while (i < src.length) {
    const rest = src.slice(i)
    let m: RegExpMatchArray | null
    if ((m = rest.match(/^`([^`]+)`/))) {
      flush()
      out.push({ t: 'code', v: m[1]! })
    } else if ((m = rest.match(/^\*\*(.+?)\*\*/)) || (m = rest.match(/^__(.+?)__/))) {
      flush()
      out.push({ t: 'strong', c: parseInline(m[1]!) })
    } else if ((m = rest.match(/^\*(?!\s)([^*]+?)\*/)) || (m = rest.match(/^_(?!\s)([^_]+?)_(?![A-Za-z0-9])/))) {
      // `_` only when it is not inside a word, so snake_case identifiers
      // (gpc_detail.sports_sponsorship) stay as they are.
      if (rest[0] === '_' && i > 0 && /[A-Za-z0-9]/.test(src[i - 1]!)) {
        text += rest[0]
        i += 1
        continue
      }
      flush()
      out.push({ t: 'em', c: parseInline(m[1]!) })
    } else if ((m = rest.match(/^\[([^\]]+)\]\(([^)\s]+)\)/))) {
      const href = safeHref(m[2]!)
      if (href) {
        flush()
        out.push({ t: 'link', href, c: parseInline(m[1]!) })
      } else {
        text += m[1]
      }
    } else if ((m = rest.match(/^https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/))) {
      flush()
      out.push({ t: 'link', href: m[0], c: [{ t: 'text', v: m[0] }] })
    } else {
      text += rest[0]
      i += 1
      continue
    }
    i += m[0].length
  }
  flush()
  return out
}

const LIST_ITEM = /^\s*(?:[-*•+]|(\d+)[.)])\s+(.*)$/
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())
}

/** The whole answer, as blocks. */
export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let para: string[] = []
  const flushPara = () => {
    if (para.length) blocks.push({ t: 'p', c: parseInline(para.join(' ')) })
    para = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!

    if (/^\s*```/.test(line)) {
      flushPara()
      const body: string[] = []
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]!); i++) body.push(lines[i]!)
      blocks.push({ t: 'code', v: body.join('\n') })
      continue
    }
    if (!line.trim()) {
      flushPara()
      continue
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/)
    if (h) {
      flushPara()
      blocks.push({ t: 'h', level: h[1]!.length as 1 | 2 | 3 | 4, c: parseInline(h[2]!) })
      continue
    }
    if (line.trim().startsWith('|') && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1]!)) {
      flushPara()
      const head = cells(line).map(parseInline)
      const rows: Inline[][][] = []
      for (i += 2; i < lines.length && lines[i]!.trim().startsWith('|'); i++) rows.push(cells(lines[i]!).map(parseInline))
      i--
      blocks.push({ t: 'table', head, rows })
      continue
    }
    const li = line.match(LIST_ITEM)
    if (li) {
      flushPara()
      const ordered = Boolean(li[1])
      const items: Inline[][] = []
      for (; i < lines.length; i++) {
        const m = lines[i]!.match(LIST_ITEM)
        if (m && Boolean(m[1]) === ordered) items.push(parseInline(m[2]!))
        else if (m) break
        // A wrapped continuation line belongs to the item above it.
        else if (lines[i]!.trim() && /^\s{2,}/.test(lines[i]!) && items.length) {
          items[items.length - 1] = [...items[items.length - 1]!, { t: 'text', v: ' ' }, ...parseInline(lines[i]!.trim())]
        } else break
      }
      i--
      blocks.push({ t: ordered ? 'ol' : 'ul', items })
      continue
    }
    if (line.startsWith('>')) {
      flushPara()
      blocks.push({ t: 'quote', c: parseInline(line.replace(/^>\s?/, '')) })
      continue
    }
    para.push(line.trim())
  }
  flushPara()
  return blocks
}
