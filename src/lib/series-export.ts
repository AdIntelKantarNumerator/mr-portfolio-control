/**
 * A session's summary and the next session's agenda as one Word document
 * (13 October 2026), for sending round or keeping with the meeting's notes.
 *
 * Two parts, each starting on its own page under a top-level heading, so
 * Word's navigation pane (and Google Docs' outline, when the file is opened
 * there) shows them as the two "tabs" asked for. True Google Docs tabs need
 * the Docs API and write access to Drive, which nothing here has; see
 * SERIES-QUESTIONS.md in the parent folder.
 *
 * Pure: it takes text and returns bytes, so it is tested without a database.
 * The summary's Markdown goes through the same parser the page uses
 * (lib/markdown-lite), so the document and the screen cannot disagree about
 * what is a heading, a table or a list.
 */
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  Packer,
  PageBreak,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ParagraphChild,
} from 'docx'
import { parseMarkdown, type Inline } from './markdown-lite'
import type { Agenda } from './series-agenda-core'

export interface SeriesExportInput {
  seriesName: string
  goals: string | null
  summary: { meeting: string; sessionDay: string; markdown: string; edited: boolean } | null
  agenda: { forDay: string; agenda: Agenda; current: boolean; generatedAt: Date } | null
  /** Absolute URL of the series page, for the footer line. */
  pageUrl: string | null
}

const BRAND = '1F3A68'
const MUTED = '6B7280'

function runs(inl: Inline[], style: { bold?: boolean; italics?: boolean } = {}): ParagraphChild[] {
  return inl.flatMap((n): ParagraphChild[] => {
    switch (n.t) {
      case 'text':
        return [new TextRun({ text: n.v, ...style })]
      case 'code':
        return [new TextRun({ text: n.v, font: 'Consolas', ...style })]
      case 'strong':
        return runs(n.c, { ...style, bold: true })
      case 'em':
        return runs(n.c, { ...style, italics: true })
      case 'link':
        // Only absolute links survive into a file; a path in this app means
        // nothing once the document leaves it.
        return /^https?:\/\//.test(n.href)
          ? [new ExternalHyperlink({ link: n.href, children: [new TextRun({ text: plain(n.c), style: 'Hyperlink', ...style })] })]
          : runs(n.c, style)
    }
  })
}

const plain = (inl: Inline[]): string => inl.map((n) => (n.t === 'text' || n.t === 'code' ? n.v : plain(n.c))).join('')

const HEADING = { 1: HeadingLevel.HEADING_2, 2: HeadingLevel.HEADING_3, 3: HeadingLevel.HEADING_4, 4: HeadingLevel.HEADING_5 } as const

function cell(content: Inline[], head: boolean): TableCell {
  return new TableCell({
    children: [new Paragraph({ children: runs(content, head ? { bold: true } : {}) })],
    shading: head ? { type: ShadingType.CLEAR, color: 'auto', fill: 'E8EDF5' } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
  })
}

const BORDER = { style: BorderStyle.SINGLE, size: 4, color: 'C9D1DD' }

/** The summary's Markdown as Word blocks. Its own headings sit one level under the part's title. */
export function markdownBlocks(markdown: string): Array<Paragraph | Table> {
  return parseMarkdown(markdown).flatMap((b): Array<Paragraph | Table> => {
    switch (b.t) {
      case 'h':
        return [new Paragraph({ heading: HEADING[b.level], children: runs(b.c) })]
      case 'p':
        return [new Paragraph({ children: runs(b.c), spacing: { after: 120 } })]
      case 'quote':
        return [new Paragraph({ children: runs(b.c, { italics: true }), indent: { left: 360 } })]
      case 'code':
        return [new Paragraph({ children: [new TextRun({ text: b.v, font: 'Consolas' })] })]
      case 'ul':
        return b.items.map((it) => new Paragraph({ children: runs(it), bullet: { level: 0 } }))
      case 'ol':
        return b.items.map((it, i) => new Paragraph({ children: [new TextRun(`${i + 1}. `), ...runs(it)], indent: { left: 360, hanging: 360 } }))
      case 'table':
        return [
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER, insideHorizontal: BORDER, insideVertical: BORDER },
            rows: [new TableRow({ tableHeader: true, children: b.head.map((h) => cell(h, true)) }), ...b.rows.map((r) => new TableRow({ children: r.map((c) => cell(c, false)) }))],
          }),
          new Paragraph({ text: '' }),
        ]
    }
  })
}

const note = (text: string) => new Paragraph({ children: [new TextRun({ text, color: MUTED, italics: true, size: 20 })], spacing: { after: 160 } })
const refs = (r: string[]) => (r.length ? [new TextRun({ text: `  (${r.join(', ')})`, color: MUTED })] : [])

export function agendaBlocks(a: Agenda): Paragraph[] {
  const out: Paragraph[] = []
  if (a.goalCheck) out.push(new Paragraph({ children: [new TextRun({ text: a.goalCheck, italics: true })], spacing: { after: 200 } }))
  if (a.decideFirst.length) {
    out.push(new Paragraph({ heading: HeadingLevel.HEADING_3, text: 'Decide first' }))
    a.decideFirst.forEach((d, i) => {
      out.push(new Paragraph({ children: [new TextRun({ text: `${i + 1}. ${d.title}`, bold: true }), ...refs(d.refs)], spacing: { before: 80 } }))
      if (d.why) out.push(new Paragraph({ children: [new TextRun({ text: d.why, color: MUTED })], indent: { left: 360 } }))
    })
  }
  if (a.topics.length) {
    out.push(new Paragraph({ heading: HeadingLevel.HEADING_3, text: 'Topics' }))
    a.topics.forEach((t, i) => {
      out.push(
        new Paragraph({
          children: [new TextRun({ text: `${i + 1}. ${t.title}`, bold: true }), ...(t.minutes ? [new TextRun({ text: ` · ${t.minutes} min` })] : []), ...refs(t.refs)],
          spacing: { before: 80 },
        }),
      )
      if (t.why) out.push(new Paragraph({ children: [new TextRun({ text: t.why, color: MUTED })], indent: { left: 360 } }))
    })
  }
  if (a.flags.length) {
    out.push(new Paragraph({ heading: HeadingLevel.HEADING_3, text: 'Flags' }))
    for (const f of a.flags) out.push(new Paragraph({ text: f, bullet: { level: 0 } }))
  }
  return out
}

const longDay = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

export function exportFilename(seriesName: string, day: string | null): string {
  const base = seriesName.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'meeting-series'
  return `${base}${day ? `-${day}` : ''}.docx`
}

export async function buildSeriesDocx(input: SeriesExportInput): Promise<Buffer> {
  const { summary, agenda } = input
  const children: Array<Paragraph | Table> = [
    new Paragraph({ children: [new TextRun({ text: input.seriesName.toUpperCase(), color: MUTED, size: 18, bold: true })] }),
  ]

  // Part 1: the summary.
  children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, text: 'Meeting summary' }))
  if (summary) {
    children.push(note(`${summary.meeting} · ${longDay(summary.sessionDay)}${summary.edited ? ' · edited' : ' · written by Yaara from the meeting notes'}`))
    children.push(...markdownBlocks(summary.markdown))
  } else {
    children.push(note('No session has been summarised yet.'))
  }

  // Part 2: the agenda, on its own page.
  children.push(new Paragraph({ children: [new PageBreak()] }))
  children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, text: 'Proposed agenda for the next meeting' }))
  if (agenda) {
    children.push(
      note(
        `For ${longDay(agenda.forDay)}${agenda.current ? '' : ' · written before the latest changes; rewrite it on the series page for an up-to-date one'}`,
      ),
    )
    if (input.goals?.trim()) children.push(new Paragraph({ children: [new TextRun({ text: 'Goals: ', bold: true }), new TextRun(input.goals.trim())], spacing: { after: 200 } }))
    children.push(...agendaBlocks(agenda.agenda))
  } else {
    children.push(note('No agenda has been written yet. "Proposed agenda" on the series page writes one.'))
  }

  if (input.pageUrl) {
    children.push(new Paragraph({ text: '', spacing: { before: 400 } }))
    children.push(
      new Paragraph({
        alignment: AlignmentType.LEFT,
        children: [new TextRun({ text: 'Series page: ', color: MUTED, size: 18 }), new ExternalHyperlink({ link: input.pageUrl, children: [new TextRun({ text: input.pageUrl, style: 'Hyperlink', size: 18 })] })],
      }),
    )
  }

  const doc = new Document({
    title: `${input.seriesName}${summary ? ` · ${summary.sessionDay}` : ''}`,
    creator: 'MR Portfolio Control',
    styles: {
      default: { document: { run: { font: 'Calibri', size: 22 } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 36, bold: true, color: BRAND }, paragraph: { spacing: { before: 120, after: 120 } } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 30, bold: true }, paragraph: { spacing: { before: 240, after: 100 } } },
        { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 26, bold: true, color: BRAND }, paragraph: { spacing: { before: 220, after: 80 } } },
        { id: 'Heading4', name: 'Heading 4', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 23, bold: true }, paragraph: { spacing: { before: 160, after: 60 } } },
      ],
    },
    sections: [{ properties: { page: { margin: { top: 1000, bottom: 1000, left: 1100, right: 1100 } } }, children }],
  })
  return Packer.toBuffer(doc)
}
